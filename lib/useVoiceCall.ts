import { useState, useRef, useEffect, useCallback } from 'react';
import { Platform } from 'react-native';
import { supabase } from './supabase';

export type CallState = 'idle' | 'outgoing_ringing' | 'incoming_ringing' | 'connected';

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

const RING_TIMEOUT = 30000;

export function useVoiceCall(currentUserId: string | null) {
  const [callState, setCallState] = useState<CallState>('idle');
  const [remoteUserId, setRemoteUserId] = useState<string | null>(null);
  const [remoteUserName, setRemoteUserName] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [callDuration, setCallDuration] = useState(0);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const roomChannelRef = useRef<any>(null);
  const incomingChannelRef = useRef<any>(null);
  const ringTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ringtoneRef = useRef<{ stop: () => void } | null>(null);
  const pendingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const iceCandidateBufferRef = useRef<RTCIceCandidateInit[]>([]);
  const callStateRef = useRef<CallState>('idle');

  // Keep ref in sync with state
  useEffect(() => { callStateRef.current = callState; }, [callState]);

  // Ringtone using Web Audio API
  const startRingtone = useCallback(() => {
    if (Platform.OS !== 'web') return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const interval = setInterval(() => {
        if (ctx.state === 'closed') { clearInterval(interval); return; }
        [440, 520].forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.2, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(ctx.currentTime + i * 0.15);
          osc.stop(ctx.currentTime + i * 0.15 + 0.6);
        });
      }, 2000);
      ringtoneRef.current = {
        stop: () => { clearInterval(interval); ctx.close().catch(() => {}); },
      };
    } catch (_) {}
  }, []);

  const stopRingtone = useCallback(() => {
    ringtoneRef.current?.stop();
    ringtoneRef.current = null;
  }, []);

  // Cleanup everything
  const cleanup = useCallback(() => {
    stopRingtone();
    if (ringTimerRef.current) { clearTimeout(ringTimerRef.current); ringTimerRef.current = null; }
    if (durationTimerRef.current) { clearInterval(durationTimerRef.current); durationTimerRef.current = null; }
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    if (remoteAudioRef.current) { remoteAudioRef.current.srcObject = null; }
    if (roomChannelRef.current) {
      supabase.removeChannel(roomChannelRef.current);
      roomChannelRef.current = null;
    }
    pendingOfferRef.current = null;
    iceCandidateBufferRef.current = [];
    setCallState('idle');
    setRemoteUserId(null);
    setRemoteUserName(null);
    setIsMuted(false);
    setCallDuration(0);
  }, [stopRingtone]);

  // Create hidden audio element for remote stream
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.style.display = 'none';
    document.body.appendChild(audio);
    remoteAudioRef.current = audio;
    return () => { document.body.removeChild(audio); };
  }, []);

  // Setup peer connection
  const createPC = useCallback((roomId: string) => {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    pcRef.current = pc;

    pc.onicecandidate = (e) => {
      if (e.candidate && roomChannelRef.current) {
        roomChannelRef.current.send({
          type: 'broadcast',
          event: 'ice-candidate',
          payload: { candidate: e.candidate.toJSON(), sender: currentUserId },
        });
      }
    };

    pc.ontrack = (e) => {
      if (remoteAudioRef.current && e.streams[0]) {
        remoteAudioRef.current.srcObject = e.streams[0];
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        cleanup();
      }
    };

    return pc;
  }, [currentUserId, cleanup]);

  // Join the room signaling channel
  const joinRoomChannel = useCallback((roomId: string) => {
    const channel = supabase.channel(`voice-room:${roomId}`, {
      config: { broadcast: { self: false } },
    });

    channel.on('broadcast', { event: 'offer' }, async ({ payload }) => {
      if (payload.sender === currentUserId) return;
      pendingOfferRef.current = payload.sdp;
    });

    channel.on('broadcast', { event: 'answer' }, async ({ payload }) => {
      if (payload.sender === currentUserId) return;
      const pc = pcRef.current;
      if (pc && payload.sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        // Apply buffered ICE candidates
        for (const c of iceCandidateBufferRef.current) {
          await pc.addIceCandidate(new RTCIceCandidate(c));
        }
        iceCandidateBufferRef.current = [];
        stopRingtone();
        setCallState('connected');
        setCallDuration(0);
        durationTimerRef.current = setInterval(() => {
          setCallDuration(d => d + 1);
        }, 1000);
      }
    });

    channel.on('broadcast', { event: 'ice-candidate' }, async ({ payload }) => {
      if (payload.sender === currentUserId) return;
      const pc = pcRef.current;
      if (pc && pc.remoteDescription) {
        await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
      } else {
        iceCandidateBufferRef.current.push(payload.candidate);
      }
    });

    channel.on('broadcast', { event: 'hangup' }, () => {
      cleanup();
    });

    channel.on('broadcast', { event: 'reject' }, () => {
      cleanup();
    });

    channel.subscribe();
    roomChannelRef.current = channel;
    return channel;
  }, [currentUserId, cleanup, stopRingtone]);

  // Start a call (caller)
  const startCall = useCallback(async (partnerId: string, partnerName: string) => {
    if (!currentUserId || callStateRef.current !== 'idle') return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;

      const roomId = [currentUserId, partnerId].sort().join('-');
      const pc = createPC(roomId);
      stream.getTracks().forEach(t => pc.addTrack(t, stream));

      const channel = joinRoomChannel(roomId);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      setRemoteUserId(partnerId);
      setRemoteUserName(partnerName);
      setCallState('outgoing_ringing');
      startRingtone();

      // Send invite to callee's incoming channel
      const inviteChannel = supabase.channel(`voice-incoming:${partnerId}`, {
        config: { broadcast: { self: false } },
      });
      inviteChannel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await inviteChannel.send({
            type: 'broadcast',
            event: 'call-invite',
            payload: { callerId: currentUserId, callerName: partnerName, roomId },
          });
          // Also send the caller's display name
          const { data: myProfile } = await supabase.from('profiles').select('display_name').eq('id', currentUserId).single();
          await inviteChannel.send({
            type: 'broadcast',
            event: 'call-invite',
            payload: { callerId: currentUserId, callerName: myProfile?.display_name ?? '不明', roomId },
          });
          // Send offer on room channel
          await channel.send({
            type: 'broadcast',
            event: 'offer',
            payload: { sdp: offer, sender: currentUserId },
          });
          supabase.removeChannel(inviteChannel);
        }
      });

      ringTimerRef.current = setTimeout(() => {
        if (callStateRef.current === 'outgoing_ringing') cleanup();
      }, RING_TIMEOUT);

    } catch (e: any) {
      alert('マイクへのアクセスが必要です: ' + (e.message || ''));
      cleanup();
    }
  }, [currentUserId, createPC, joinRoomChannel, startRingtone, cleanup]);

  // Answer an incoming call
  const answerCall = useCallback(async () => {
    if (!currentUserId || callStateRef.current !== 'incoming_ringing' || !remoteUserId) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;

      const roomId = [currentUserId, remoteUserId].sort().join('-');
      const pc = createPC(roomId);
      stream.getTracks().forEach(t => pc.addTrack(t, stream));

      if (!roomChannelRef.current) joinRoomChannel(roomId);

      if (pendingOfferRef.current) {
        await pc.setRemoteDescription(new RTCSessionDescription(pendingOfferRef.current));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        // Apply buffered ICE candidates
        for (const c of iceCandidateBufferRef.current) {
          await pc.addIceCandidate(new RTCIceCandidate(c));
        }
        iceCandidateBufferRef.current = [];

        roomChannelRef.current?.send({
          type: 'broadcast',
          event: 'answer',
          payload: { sdp: answer, sender: currentUserId },
        });
      }

      stopRingtone();
      if (ringTimerRef.current) { clearTimeout(ringTimerRef.current); ringTimerRef.current = null; }
      setCallState('connected');
      setCallDuration(0);
      durationTimerRef.current = setInterval(() => {
        setCallDuration(d => d + 1);
      }, 1000);
    } catch (e: any) {
      alert('マイクへのアクセスが必要です: ' + (e.message || ''));
      cleanup();
    }
  }, [currentUserId, remoteUserId, createPC, joinRoomChannel, stopRingtone, cleanup]);

  // Reject incoming call
  const rejectCall = useCallback(() => {
    roomChannelRef.current?.send({
      type: 'broadcast',
      event: 'reject',
      payload: { sender: currentUserId },
    });
    cleanup();
  }, [currentUserId, cleanup]);

  // Hang up
  const hangUp = useCallback(() => {
    roomChannelRef.current?.send({
      type: 'broadcast',
      event: 'hangup',
      payload: { sender: currentUserId },
    });
    cleanup();
  }, [currentUserId, cleanup]);

  // Toggle mute
  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (stream) {
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  }, []);

  // Global incoming call listener
  useEffect(() => {
    if (!currentUserId || Platform.OS !== 'web') return;

    const channel = supabase.channel(`voice-incoming:${currentUserId}`, {
      config: { broadcast: { self: false } },
    });

    channel.on('broadcast', { event: 'call-invite' }, ({ payload }) => {
      if (callStateRef.current !== 'idle') return; // Busy
      const { callerId, callerName, roomId } = payload;
      setRemoteUserId(callerId);
      setRemoteUserName(callerName);
      setCallState('incoming_ringing');
      startRingtone();

      // Join room channel to receive offer/ICE
      joinRoomChannel(roomId);

      ringTimerRef.current = setTimeout(() => {
        if (callStateRef.current === 'incoming_ringing') cleanup();
      }, RING_TIMEOUT);
    });

    channel.subscribe();
    incomingChannelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      incomingChannelRef.current = null;
    };
  }, [currentUserId, startRingtone, joinRoomChannel, cleanup]);

  return {
    callState,
    remoteUserId,
    remoteUserName,
    isMuted,
    callDuration,
    startCall,
    answerCall,
    rejectCall,
    hangUp,
    toggleMute,
  };
}
