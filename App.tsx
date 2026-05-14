import React, { useState, useEffect } from 'react';
import { Platform, View, Text, TouchableOpacity, AppState } from 'react-native';
import { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import notifee from '@notifee/react-native';

const VAPID_PUBLIC = 'BMn6G55iWDnmQZ7nZ79iHX2npyXgNI6fU63HK25SV9XMHmk0aIZtQMh0r2yM3Sm0GiFdJLVPlMWoyMe7NNiM420';

// Native push通知のフォアグラウンド時挙動 (バナー + サウンド + バッジ)
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

async function registerPushWeb(userId: string) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: VAPID_PUBLIC,
  });
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys) return;
  await fetch('https://nccognptoprhwsbjnwcu.supabase.co/functions/v1/web-push', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'subscribe', user_id: userId, subscription: json }),
  });
}

async function registerPushNative(userId: string) {
  if (!Device.isDevice) {
    console.log('Push notifications only work on physical devices');
    return;
  }
  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (existing !== 'granted') {
    const { status: req } = await Notifications.requestPermissionsAsync();
    status = req;
  }
  if (status !== 'granted') return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'NexPort',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#1A3C8F',
    });
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  const tokenData = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  const token = tokenData.data; // "ExponentPushToken[xxx]"

  const subscription = {
    endpoint: `expo:${token}`,
    type: 'expo',
    token,
    platform: Platform.OS,
  };
  await fetch('https://nccognptoprhwsbjnwcu.supabase.co/functions/v1/web-push', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'subscribe', user_id: userId, subscription }),
  });
}

async function registerPush(userId: string) {
  try {
    if (Platform.OS === 'web') await registerPushWeb(userId);
    else await registerPushNative(userId);
  } catch (e) {
    console.log('Push registration failed:', e);
  }
}
import AuthScreen from './screens/AuthScreen';
import ChatScreen from './screens/ChatScreen';
import ChannelListScreen from './screens/ChannelListScreen';
import MemberListScreen from './screens/MemberListScreen';
import DMScreen from './screens/DMScreen';
import SearchScreen from './screens/SearchScreen';
import ProfileScreen from './screens/ProfileScreen';
import AdminScreen from './screens/AdminScreen';
import ScheduleScreen from './screens/ScheduleScreen';
import NotificationSettingsScreen from './screens/NotificationSettingsScreen';
import ChannelTabScreen from './screens/ChannelTabScreen';
import PendingApprovalScreen from './screens/PendingApprovalScreen';
import BusinessScreen from './screens/BusinessScreen';
import { ErrorBoundary } from './lib/ErrorBoundary';
import VoiceCallScreen from './screens/VoiceCallScreen';
import { useVoiceCall } from './lib/useVoiceCall';

type Channel = { id: string; name: string };
type Screen = 'channels' | 'chat' | 'channel_tabs' | 'members' | 'dm' | 'search' | 'profile' | 'admin' | 'schedule' | 'business' | 'notifications';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [currentScreen, setCurrentScreen] = useState<Screen>('channels');
  const [currentChannel, setCurrentChannel] = useState<Channel | null>(null);
  const [dmPartner, setDmPartner] = useState<{ id: string; name: string } | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [accountStatus, setAccountStatus] = useState<string | null>(null);
  const [employmentType, setEmploymentType] = useState<string | null>(null);
  const voiceCall = useVoiceCall(currentUserId);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) {
        setCurrentUserId(data.session.user.id);
        updateOnlineStatus(data.session.user.id, 'online');
        fetchUserRole(data.session.user.id);
        registerPush(data.session.user.id);
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession?.user) {
        setCurrentUserId(newSession.user.id);
        updateOnlineStatus(newSession.user.id, 'online');
        registerPush(newSession.user.id);
        fetchUserRole(newSession.user.id);
      } else {
        setAccountStatus(null);
        setIsAdmin(false);
        setIsSuperAdmin(false);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const fetchUserRole = async (userId: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('role, account_status, employment_type')
      .eq('id', userId)
      .single();
    if (data) {
      setIsAdmin(data.role === 'admin' || data.role === 'super_admin');
      setIsSuperAdmin(data.role === 'super_admin');
      setAccountStatus(data.account_status ?? 'active');
      setEmploymentType(data.employment_type ?? null);
    }
  };

  // Watch for role and account_status changes in real time
  useEffect(() => {
    if (!currentUserId) return;
    const subscription = supabase
      .channel('my-profile-changes')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${currentUserId}` },
        (payload) => {
          const p = payload.new as any;
          setIsAdmin(p.role === 'admin' || p.role === 'super_admin');
          setIsSuperAdmin(p.role === 'super_admin');
          setAccountStatus(p.account_status ?? 'active');
          setEmploymentType(p.employment_type ?? null);
        })
      .subscribe();
    return () => { supabase.removeChannel(subscription); };
  }, [currentUserId]);

  // オンライン状態管理 + Realtime制御: タブアクティブ時のみリアルタイム更新
  useEffect(() => {
    if (!currentUserId || Platform.OS !== 'web') return;

    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    const goOnline = () => {
      updateOnlineStatus(currentUserId, 'online');
      if (!heartbeatTimer) {
        heartbeatTimer = setInterval(() => {
          updateOnlineStatus(currentUserId, 'online');
        }, 60000);
      }
      // Realtimeチャンネルを再接続
      supabase.getChannels().forEach(ch => {
        if (ch.state !== 'joined') ch.subscribe();
      });
    };

    const goAway = () => {
      updateOnlineStatus(currentUserId, 'offline');
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      // 通知チャンネル以外のRealtimeを切断（バッテリー節約）
      supabase.getChannels().forEach(ch => {
        if (!ch.topic.includes('global-notif') && !ch.topic.includes('voice-')) {
          supabase.removeChannel(ch);
        }
      });
    };

    const goOffline = () => {
      updateOnlineStatus(currentUserId, 'offline');
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') goOnline();
      else goAway();
    };
    const handleBeforeUnload = () => goOffline();

    if (document.visibilityState === 'visible') goOnline();

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      goOffline();
    };
  }, [currentUserId]);

  // 古いオンラインユーザーを自動オフライン化（last_seenが3分以上前）
  useEffect(() => {
    if (!currentUserId) return;
    const cleanup = setInterval(async () => {
      const threshold = new Date(Date.now() - 3 * 60 * 1000).toISOString();
      await supabase.from('profiles')
        .update({ status: 'offline' })
        .eq('status', 'online')
        .lt('last_seen', threshold)
        .neq('id', currentUserId);
    }, 120000);
    return () => clearInterval(cleanup);
  }, [currentUserId]);

  // 通知音を再生する関数
  const playNotificationSound = () => {
    if (Platform.OS !== 'web') return;
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      // チャイム音: ド→ミ→ソの和音風
      const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
      notes.forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime + i * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + i * 0.12 + 0.5);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(audioCtx.currentTime + i * 0.12);
        osc.stop(audioCtx.currentTime + i * 0.12 + 0.5);
      });
    } catch (_) {}
  };

  // アプリアイコンバッジ更新（Web PWA + ネイティブ両対応）
  const updateAppBadge = (count: number) => {
    const n = Math.max(0, count);
    if (Platform.OS === 'web') {
      try {
        if ('setAppBadge' in navigator) {
          if (n > 0) (navigator as any).setAppBadge(n);
          else (navigator as any).clearAppBadge();
        }
      } catch (_) {}
    } else {
      // Native: notifee で数値バッジ (Sony/Samsung/Huawei等のメーカー専用 Intent を内部 broadcast)
      // 加えて expo-notifications でも設定（OS標準API用）
      notifee.setBadgeCount(n).catch(() => {});
      Notifications.setBadgeCountAsync(n).catch(() => {});
    }
  };

  // 未読バッジカウンター (ネイティブ用、push受信時の即時インクリメント用)
  const unreadBadgeRef = React.useRef(0);

  // DB から実際の未読数を取得してバッジに反映
  const refreshBadgeFromDB = React.useCallback(async () => {
    if (!currentUserId) return;
    try {
      const { data, error } = await supabase.rpc('get_user_unread_count', { p_user_id: currentUserId });
      if (error) return;
      const count = typeof data === 'number' ? data : 0;
      unreadBadgeRef.current = count;
      updateAppBadge(count);
    } catch (_) {}
  }, [currentUserId]);

  // ネイティブ: AppState で フォアグラウンド復帰時に DBから未読数を再取得
  useEffect(() => {
    if (!currentUserId || Platform.OS === 'web') return;
    refreshBadgeFromDB(); // マウント時に1回
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshBadgeFromDB();
    });
    return () => sub.remove();
  }, [currentUserId, refreshBadgeFromDB]);

  // ネイティブ: 受信した push 通知でバッジカウントを進める (フォアグラウンド時はnoop)
  useEffect(() => {
    if (!currentUserId || Platform.OS === 'web') return;
    const recvSub = Notifications.addNotificationReceivedListener(() => {
      if (AppState.currentState !== 'active') {
        unreadBadgeRef.current++;
        updateAppBadge(unreadBadgeRef.current);
      }
    });
    return () => recvSub.remove();
  }, [currentUserId]);

  // ネイティブ: realtimeで新着メッセージを監視、未読数を更新
  useEffect(() => {
    if (!currentUserId || Platform.OS === 'web') return;
    const ch = supabase
      .channel('native-unread-' + currentUserId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
        const msg = payload.new as any;
        if (msg.sender_id === currentUserId) return;
        // 自分が参加しているチャンネルか確認
        const { data: mem } = await supabase.from('channel_members').select('user_id').eq('channel_id', msg.channel_id).eq('user_id', currentUserId).maybeSingle();
        if (!mem) return;
        if (AppState.currentState === 'active') refreshBadgeFromDB();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages' }, (payload) => {
        const dm = payload.new as any;
        if (dm.receiver_id !== currentUserId) return;
        if (AppState.currentState === 'active') refreshBadgeFromDB();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_reads' }, (payload) => {
        const mr = payload.new as any;
        if (mr.user_id !== currentUserId) return;
        if (AppState.currentState === 'active') refreshBadgeFromDB();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'direct_messages' }, (payload) => {
        const dm = payload.new as any;
        if (dm.receiver_id !== currentUserId) return;
        if (AppState.currentState === 'active') refreshBadgeFromDB();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [currentUserId, refreshBadgeFromDB]);

  // グローバル通知監視: 常時接続（フォアグラウンド時は通知音、バックグラウンド時はポップアップ通知）
  useEffect(() => {
    if (!currentUserId || Platform.OS !== 'web') return;

    // タブがアクティブになったらバッジをリセット
    const handleVisibilityForBadge = () => {
      if (document.visibilityState === 'visible') {
        unreadBadgeRef.current = 0;
        updateAppBadge(0);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityForBadge);

    const notifChannel = supabase
      .channel('global-notif')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' },
        async (payload) => {
          const msg = payload.new as any;
          if (msg.sender_id === currentUserId) return;
          const { data: mem } = await supabase.from('channel_members').select('user_id').eq('channel_id', msg.channel_id).eq('user_id', currentUserId).maybeSingle();
          if (!mem) return;
          // フォアグラウンド: 通知音を鳴らす
          if (document.visibilityState === 'visible') {
            playNotificationSound();
            return;
          }
          // バックグラウンド: バッジ更新 + ポップアップ通知
          unreadBadgeRef.current++;
          updateAppBadge(unreadBadgeRef.current);
          if ('Notification' in window && Notification.permission === 'granted') {
            const { data: prof } = await supabase.from('profiles').select('display_name').eq('id', msg.sender_id).single();
            const { data: ch } = await supabase.from('channels').select('name').eq('id', msg.channel_id).single();
            new Notification(`#${ch?.name ?? 'チャンネル'}`, {
              body: `${prof?.display_name ?? ''}: ${(msg.content ?? '').slice(0, 100)}`,
              icon: '/favicon.ico',
            });
          }
        }
      )
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages' },
        async (payload) => {
          const dm = payload.new as any;
          if (dm.sender_id === currentUserId || dm.receiver_id !== currentUserId) return;
          // フォアグラウンド: 通知音を鳴らす
          if (document.visibilityState === 'visible') {
            playNotificationSound();
            return;
          }
          // バックグラウンド: バッジ更新 + ポップアップ通知
          unreadBadgeRef.current++;
          updateAppBadge(unreadBadgeRef.current);
          if ('Notification' in window && Notification.permission === 'granted') {
            const { data: prof } = await supabase.from('profiles').select('display_name').eq('id', dm.sender_id).single();
            new Notification('💬 DM', {
              body: `${prof?.display_name ?? ''}: ${(dm.content ?? '').slice(0, 100)}`,
              icon: '/favicon.ico',
            });
          }
        }
      )
      .subscribe();

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityForBadge);
      supabase.removeChannel(notifChannel);
    };
  }, [currentUserId]);

  const updateOnlineStatus = async (userId: string, status: string) => {
    await supabase.from('profiles').update({ status, last_seen: new Date().toISOString() }).eq('id', userId);
  };

  const handleLogout = async () => {
    if (currentUserId) await updateOnlineStatus(currentUserId, 'offline');
    await supabase.auth.signOut();
    setCurrentScreen('channels');
    setCurrentChannel(null);
    setDmPartner(null);
    setIsAdmin(false);
    setIsSuperAdmin(false);
    setCurrentUserId(null);
    setAccountStatus(null);
    setEmploymentType(null);
  };

  // 通話オーバーレイ（全画面の上に表示）
  const voiceCallOverlay = voiceCall.callState !== 'idle' ? (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999 }}>
      <VoiceCallScreen
        callState={voiceCall.callState}
        remoteUserName={voiceCall.remoteUserName ?? '不明'}
        isMuted={voiceCall.isMuted}
        callDuration={voiceCall.callDuration}
        onAnswer={voiceCall.answerCall}
        onReject={voiceCall.rejectCall}
        onHangUp={voiceCall.hangUp}
        onToggleMute={voiceCall.toggleMute}
      />
    </View>
  ) : null;

  if (!session) return <AuthScreen />;

  // Safety net: if user has a session but account is not yet approved
  if (accountStatus === 'pending_approval') {
    return <PendingApprovalScreen onLogout={handleLogout} />;
  }

  // 強制リロード（キャッシュクリア）
  const forceReload = async () => {
    if (Platform.OS !== 'web') return;
    try {
      // Service Workerのキャッシュをクリア
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      // Service Workerを更新
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.update()));
      }
      window.location.reload();
    } catch (_) {
      window.location.reload();
    }
  };

  // ラッパー: 全画面に通話オーバーレイ + 更新ボタンを重ねる
  const withCallOverlay = (screen: React.ReactElement, showRefresh = true) => (
    <View style={{ flex: 1 }}>
      {screen}
      {voiceCallOverlay}
      {showRefresh && <TouchableOpacity
        onPress={forceReload}
        style={{ position: 'absolute', bottom: 20, right: 20, width: 48, height: 48, borderRadius: 24, backgroundColor: '#1A3C8F', justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, elevation: 5, zIndex: 100 }}
      >
        <Text style={{ fontSize: 20, color: '#fff' }}>🔄</Text>
      </TouchableOpacity>}
    </View>
  );

  if (currentScreen === 'business') {
    return withCallOverlay(
      <ErrorBoundary onReset={() => setCurrentScreen('channels')}>
        <BusinessScreen onBack={() => setCurrentScreen('channels')} currentUserId={currentUserId} isAdmin={isAdmin} />
      </ErrorBoundary>,
      false,
    );
  }
  if (currentScreen === 'admin' && isAdmin) {
    return withCallOverlay(<AdminScreen onBack={() => setCurrentScreen('channels')} currentUserId={currentUserId} isSuperAdmin={isSuperAdmin} />);
  }
  if (currentScreen === 'profile') return withCallOverlay(<ProfileScreen onBack={() => setCurrentScreen('channels')} />);
  if (currentScreen === 'notifications') return withCallOverlay(<NotificationSettingsScreen onBack={() => setCurrentScreen('channels')} />);
  if (currentScreen === 'schedule') return withCallOverlay(<ScheduleScreen onBack={() => setCurrentScreen('channels')} currentUserId={currentUserId} />);
  if (currentScreen === 'search') {
    return withCallOverlay(<SearchScreen onBack={() => setCurrentScreen('channels')} onSelectChannel={(id, name) => { setCurrentChannel({ id, name }); setCurrentScreen('chat'); }} />);
  }
  if (currentScreen === 'dm' && dmPartner && currentUserId) {
    return withCallOverlay(<DMScreen onBack={() => setCurrentScreen('members')} partnerId={dmPartner.id} partnerName={dmPartner.name} currentUserId={currentUserId} onStartCall={() => voiceCall.startCall(dmPartner.id, dmPartner.name)} />, false);
  }
  if (currentScreen === 'members') {
    return withCallOverlay(
      <MemberListScreen
        onBack={() => setCurrentScreen('channels')}
        onStartDM={(partnerId, partnerName) => { setDmPartner({ id: partnerId, name: partnerName }); setCurrentScreen('dm'); }}
        onStartCall={(partnerId, partnerName) => voiceCall.startCall(partnerId, partnerName)}
        currentUserId={currentUserId}
      />
    );
  }
  if (currentScreen === 'channel_tabs' && currentChannel) {
    return withCallOverlay(
      <ChannelTabScreen
        channelId={currentChannel.id}
        channelName={currentChannel.name}
        onBack={() => setCurrentScreen('chat')}
        isAdmin={isAdmin}
        currentUserId={currentUserId}
      />
    );
  }
  if (currentScreen === 'chat' && currentChannel) {
    return withCallOverlay(
      <ChatScreen
        channelId={currentChannel.id}
        channelName={currentChannel.name}
        onBack={() => setCurrentScreen('channels')}
        onOpenTabs={() => setCurrentScreen('channel_tabs')}
        isAdmin={isAdmin}
      />, false
    );
  }

  return withCallOverlay(
    <ChannelListScreen
      onSelectChannel={(channel) => { setCurrentChannel({ id: channel.id, name: channel.name }); setCurrentScreen('chat'); }}
      onShowMembers={() => setCurrentScreen('members')}
      onShowSearch={() => setCurrentScreen('search')}
      onShowProfile={() => setCurrentScreen('profile')}
      onShowNotifications={() => setCurrentScreen('notifications')}
      onShowAdmin={() => setCurrentScreen('admin')}
      onShowSchedule={() => setCurrentScreen('schedule')}
      onShowBusiness={() => setCurrentScreen('business')}
      onStartDM={(partnerId, partnerName) => { setDmPartner({ id: partnerId, name: partnerName }); setCurrentScreen('dm'); }}
      onLogout={handleLogout}
      isAdmin={isAdmin}
      isSuperAdmin={isSuperAdmin}
      currentUserId={currentUserId}
      employmentType={employmentType}
    />
  );
}
