import React, { useState, useEffect } from 'react';
import { Platform } from 'react-native';
import { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';

const VAPID_PUBLIC = 'BIj5ekLPrEUBGswQEBrhZ4djLfSGTn5LWl1hqO7T0uBlusC4NFSZxOFwls7Np5YgaJlhytgs4lbJCSIdPhF0JJc';

async function registerPush(userId: string) {
  if (Platform.OS !== 'web' || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
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
    await supabase.from('push_subscriptions').upsert({
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    }, { onConflict: 'user_id,endpoint' });
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
      updateOnlineStatus(currentUserId, 'away');
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      // 通知チャンネル以外のRealtimeを切断（バッテリー節約）
      supabase.getChannels().forEach(ch => {
        if (!ch.topic.includes('global-notif')) {
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

  // PWAアイコンバッジ更新（LINEのような未読数表示）
  const updateAppBadge = (count: number) => {
    if (Platform.OS !== 'web') return;
    try {
      if ('setAppBadge' in navigator) {
        if (count > 0) (navigator as any).setAppBadge(count);
        else (navigator as any).clearAppBadge();
      }
    } catch (_) {}
  };

  // 未読バッジカウンター
  const unreadBadgeRef = React.useRef(0);

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

  if (!session) return <AuthScreen />;

  // Safety net: if user has a session but account is not yet approved
  if (accountStatus === 'pending_approval') {
    return <PendingApprovalScreen onLogout={handleLogout} />;
  }

  if (currentScreen === 'business') {
    return <BusinessScreen onBack={() => setCurrentScreen('channels')} currentUserId={currentUserId} isAdmin={isAdmin} />;
  }
  if (currentScreen === 'admin' && isAdmin) {
    return <AdminScreen onBack={() => setCurrentScreen('channels')} currentUserId={currentUserId} isSuperAdmin={isSuperAdmin} />;
  }
  if (currentScreen === 'profile') return <ProfileScreen onBack={() => setCurrentScreen('channels')} />;
  if (currentScreen === 'notifications') return <NotificationSettingsScreen onBack={() => setCurrentScreen('channels')} />;
  if (currentScreen === 'schedule') return <ScheduleScreen onBack={() => setCurrentScreen('channels')} currentUserId={currentUserId} />;
  if (currentScreen === 'search') {
    return <SearchScreen onBack={() => setCurrentScreen('channels')} onSelectChannel={(id, name) => { setCurrentChannel({ id, name }); setCurrentScreen('chat'); }} />;
  }
  if (currentScreen === 'dm' && dmPartner && currentUserId) {
    return <DMScreen onBack={() => setCurrentScreen('members')} partnerId={dmPartner.id} partnerName={dmPartner.name} currentUserId={currentUserId} />;
  }
  if (currentScreen === 'members') {
    return (
      <MemberListScreen
        onBack={() => setCurrentScreen('channels')}
        onStartDM={(partnerId, partnerName) => { setDmPartner({ id: partnerId, name: partnerName }); setCurrentScreen('dm'); }}
        currentUserId={currentUserId}
      />
    );
  }
  if (currentScreen === 'channel_tabs' && currentChannel) {
    return (
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
    return (
      <ChatScreen
        channelId={currentChannel.id}
        channelName={currentChannel.name}
        onBack={() => setCurrentScreen('channels')}
        onOpenTabs={() => setCurrentScreen('channel_tabs')}
        isAdmin={isAdmin}
      />
    );
  }

  return (
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
