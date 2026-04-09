import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Image, Alert, Modal, ScrollView, Switch, Linking,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';

type Message = {
  id: string;
  content: string;
  sender_id: string;
  created_at: string;
  is_deleted: boolean;
  profiles: { display_name: string } | null;
  file_url: string | null;
  file_type: string | null;
};

type Announcement = {
  id: string;
  title: string;
  content: string;
  is_pinned: boolean;
  created_at: string;
};

type ChannelMember = {
  user_id: string;
  profiles: { display_name: string; avatar_url: string | null } | null;
};

type AllProfile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
};

type RichMenuItem = {
  id: string;
  channel_id: string;
  label: string;
  icon: string;
  action_type: 'url' | 'text' | 'screen';
  action_value: string;
  sort_order: number;
};

type Props = {
  channelId: string;
  channelName: string;
  onBack: () => void;
  onOpenTabs: () => void;
  isAdmin: boolean;
};

export default function ChatScreen({ channelId, channelName, onBack, onOpenTabs, isAdmin }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [memberModalVisible, setMemberModalVisible] = useState(false);
  const [channelMembers, setChannelMembers] = useState<ChannelMember[]>([]);
  const [allProfiles, setAllProfiles] = useState<AllProfile[]>([]);
  const [selectedMsg, setSelectedMsg] = useState<Message | null>(null);
  const [msgMenuVisible, setMsgMenuVisible] = useState(false);
  const [unreadAnnouncements, setUnreadAnnouncements] = useState<Announcement[]>([]);
  const [annDetailVisible, setAnnDetailVisible] = useState(false);
  const [selectedAnn, setSelectedAnn] = useState<Announcement | null>(null);
  // 既読情報: message_id → 読んだuser_idの配列
  const [readers, setReaders] = useState<Record<string, string[]>>({});
  const [memberCount, setMemberCount] = useState(0);
  // チャンネルメンバー一覧（既読モーダル用）
  const [allMembers, setAllMembers] = useState<{ user_id: string; display_name: string; avatar_url: string | null }[]>([]);
  // 既読詳細モーダル
  const [readDetailVisible, setReadDetailVisible] = useState(false);
  const [readDetailMsg, setReadDetailMsg] = useState<Message | null>(null);
  const [readDetailTab, setReadDetailTab] = useState<'read' | 'unread'>('read');
  // Rich menu
  const [richMenuItems, setRichMenuItems] = useState<RichMenuItem[]>([]);
  const [richMenuOpen, setRichMenuOpen] = useState(false);
  const [richMenuEditModal, setRichMenuEditModal] = useState(false);
  const [editingRmItem, setEditingRmItem] = useState<RichMenuItem | null>(null);
  const [rmLabel, setRmLabel] = useState('');
  const [rmIcon, setRmIcon] = useState('📌');
  const [rmActionType, setRmActionType] = useState<RichMenuItem['action_type']>('text');
  const [rmActionValue, setRmActionValue] = useState('');
  const [savingRm, setSavingRm] = useState(false);
  // Mention
  const [mentionQuery, setMentionQuery] = useState('');
  const [showMentionList, setShowMentionList] = useState(false);
  const [mentionMembers, setMentionMembers] = useState<{ user_id: string; display_name: string }[]>([]);
  // Channel notification settings
  const [chNotifMuted, setChNotifMuted] = useState(false);
  const [chNotifMentionOnly, setChNotifMentionOnly] = useState(false);
  const [chNotifModalVisible, setChNotifModalVisible] = useState(false);

  const flatListRef = useRef<FlatList>(null);
  const userIdRef = useRef<string | null>(null);
  const channelIdRef = useRef(channelId);
  const realtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    channelIdRef.current = channelId;
  }, [channelId]);

  const markAsRead = useCallback(async (messageIds: string[]) => {
    if (!messageIds.length || !userIdRef.current) return;
    await supabase.from('message_reads').upsert(
      messageIds.map(id => ({ message_id: id, user_id: userIdRef.current! })),
      { onConflict: 'message_id,user_id', ignoreDuplicates: true }
    );
  }, []);

  const fetchMessages = useCallback(async () => {
    const { data, error } = await supabase
      .from('messages')
      .select('id, content, sender_id, created_at, is_deleted, file_url, file_type, profiles!messages_sender_id_fkey(display_name)')
      .eq('channel_id', channelId)
      .order('created_at', { ascending: true })
      .limit(50);
    if (error) { console.log('fetchMessages error:', error.message); return; }
    if (data) {
      setMessages(data as Message[]);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 150);
      markAsRead(data.filter((m: any) => !m.is_deleted).map((m: any) => m.id));
    }
  }, [channelId, markAsRead]);

  const fetchUnreadAnnouncements = useCallback(async (uid: string) => {
    const { data: allAnns } = await supabase
      .from('channel_announcements')
      .select('id, title, content, is_pinned, created_at')
      .eq('channel_id', channelId)
      .order('created_at', { ascending: false });
    if (!allAnns?.length) { setUnreadAnnouncements([]); return; }
    const { data: reads } = await supabase
      .from('announcement_reads')
      .select('announcement_id')
      .eq('user_id', uid)
      .in('announcement_id', allAnns.map((a: any) => a.id));
    const readIds = new Set((reads ?? []).map((r: any) => r.announcement_id));
    setUnreadAnnouncements(allAnns.filter((a: any) => !readIds.has(a.id)) as Announcement[]);
  }, [channelId]);

  const fetchAllMembers = useCallback(async () => {
    const { data } = await supabase
      .from('channel_members')
      .select('user_id, profiles(display_name, avatar_url)')
      .eq('channel_id', channelId);
    if (data) {
      setAllMembers(data.map((m: any) => ({
        user_id: m.user_id,
        display_name: m.profiles?.display_name ?? '不明',
        avatar_url: m.profiles?.avatar_url ?? null,
      })));
    }
  }, [channelId]);

  const fetchReadCounts = useCallback(async () => {
    const [{ data: readerData }, { count: mc }] = await Promise.all([
      supabase.rpc('get_message_readers', { p_channel_id: channelId }),
      supabase.from('channel_members').select('*', { count: 'exact', head: true }).eq('channel_id', channelId),
    ]);
    if (readerData) {
      const map: Record<string, string[]> = {};
      readerData.forEach((r: { message_id: string; user_id: string }) => {
        if (!map[r.message_id]) map[r.message_id] = [];
        map[r.message_id].push(r.user_id);
      });
      setReaders(map);
    }
    if (mc !== null) setMemberCount(mc);
  }, [channelId]);

  // 初期データ取得
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id ?? null;
      userIdRef.current = uid;
      setCurrentUserId(uid);
      if (uid) fetchUnreadAnnouncements(uid);
    });
    fetchMessages();
    fetchReadCounts();
    fetchAllMembers();
    const timer = setInterval(fetchReadCounts, 15000);
    return () => clearInterval(timer);
  }, [channelId, fetchMessages, fetchUnreadAnnouncements, fetchReadCounts, fetchAllMembers]);

  // Realtime購読
  useEffect(() => {
    console.log('Realtime setup for channel:', channelId);

    const ch = supabase.channel(`room-${channelId}`, {
      config: { broadcast: { self: true } },
    });
    realtimeChannelRef.current = ch;

    ch
      // --- Broadcast: 新規メッセージ ---
      .on('broadcast', { event: 'new_message' }, (payload) => {
        const newMsg = payload.payload as Message;
        console.log('broadcast new_message:', newMsg);
        setMessages(prev =>
          prev.some(m => m.id === newMsg.id) ? prev : [...prev, newMsg]
        );
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
        if (!newMsg.is_deleted) markAsRead([newMsg.id]);
      })
      // --- Broadcast: メッセージ更新（取り消し） ---
      .on('broadcast', { event: 'update_message' }, (payload) => {
        const upd = payload.payload as { id: string; content: string; is_deleted: boolean };
        setMessages(prev =>
          prev.map(m =>
            m.id === upd.id ? { ...m, content: upd.content, is_deleted: upd.is_deleted } : m
          )
        );
      })
      // --- Broadcast: メッセージ削除 ---
      .on('broadcast', { event: 'delete_message' }, (payload) => {
        const { id } = payload.payload as { id: string };
        setMessages(prev => prev.filter(m => m.id !== id));
      })
      // --- postgres_changes: メッセージDB変更を直接検知（Broadcastが届かない場合のフォールバック） ---
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `channel_id=eq.${channelId}`,
        },
        async (payload) => {
          const newMsg = payload.new as any;
          // プロフィール名を取得
          const { data: prof } = await supabase.from('profiles').select('display_name').eq('id', newMsg.sender_id).single();
          const msg = { ...newMsg, profiles: prof } as Message;
          setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
          setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
          if (!msg.is_deleted && userIdRef.current) markAsRead([msg.id]);
        }
      )
      // --- postgres_changes: お知らせ ---
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'channel_announcements',
          filter: `channel_id=eq.${channelId}`,
        },
        (payload) => {
          setUnreadAnnouncements(prev => [payload.new as Announcement, ...prev]);
        }
      )
      .subscribe((status, err) => {
        console.log('[Realtime status]', status, err ?? '');
      });

    return () => {
      console.log('Realtime cleanup for channel:', channelId);
      realtimeChannelRef.current = null;
      supabase.removeChannel(ch);
    };
  }, [channelId, markAsRead]);

  const markAnnAsRead = async (ann: Announcement) => {
    if (!userIdRef.current) return;
    await supabase.from('announcement_reads').upsert(
      { announcement_id: ann.id, user_id: userIdRef.current },
      { onConflict: 'announcement_id,user_id', ignoreDuplicates: true }
    );
    setUnreadAnnouncements(prev => prev.filter(a => a.id !== ann.id));
    setAnnDetailVisible(false);
    setSelectedAnn(null);
  };

  const markAllAnnsAsRead = async () => {
    if (!userIdRef.current || !unreadAnnouncements.length) return;
    await supabase.from('announcement_reads').upsert(
      unreadAnnouncements.map(a => ({ announcement_id: a.id, user_id: userIdRef.current! })),
      { onConflict: 'announcement_id,user_id', ignoreDuplicates: true }
    );
    setUnreadAnnouncements([]);
  };

  // ─── Channel Notification Settings ───────────────────────
  const fetchChNotifSettings = async () => {
    if (!currentUserId) return;
    const { data } = await supabase.from('channel_notification_settings')
      .select('*').eq('user_id', currentUserId).eq('channel_id', channelId).maybeSingle();
    if (data) {
      setChNotifMuted(data.muted);
      setChNotifMentionOnly(data.mentions_only);
    }
  };

  useEffect(() => { fetchChNotifSettings(); }, [currentUserId, channelId]);

  const saveChNotifSetting = async (updates: Record<string, any>) => {
    if (!currentUserId) return;
    await supabase.from('channel_notification_settings').upsert({
      user_id: currentUserId,
      channel_id: channelId,
      muted: chNotifMuted,
      mentions_only: chNotifMentionOnly,
      updated_at: new Date().toISOString(),
      ...updates,
    }, { onConflict: 'user_id,channel_id' });
  };

  // ─── Rich Menu ───────────────────────────────────────────
  const RM_ICONS = ['📌', '📋', '📊', '📅', '💬', '🔗', '📝', '⭐', '🔔', '💡', '📢', '🎯', '✅', '📎', '🏠', '👥'];

  const fetchRichMenu = async () => {
    const { data } = await supabase.from('channel_rich_menus').select('*').eq('channel_id', channelId).order('sort_order');
    if (data) setRichMenuItems(data as RichMenuItem[]);
  };

  useEffect(() => { fetchRichMenu(); }, [channelId]);

  const openAddRm = () => {
    setEditingRmItem(null); setRmLabel(''); setRmIcon('📌');
    setRmActionType('text'); setRmActionValue('');
    setRichMenuEditModal(true);
  };
  const openEditRm = (item: RichMenuItem) => {
    setEditingRmItem(item); setRmLabel(item.label); setRmIcon(item.icon);
    setRmActionType(item.action_type); setRmActionValue(item.action_value);
    setRichMenuEditModal(true);
  };

  const saveRmItem = async () => {
    if (!rmLabel.trim()) { alert('ラベルを入力してください'); return; }
    setSavingRm(true);
    const payload = { label: rmLabel.trim(), icon: rmIcon, action_type: rmActionType, action_value: rmActionValue, channel_id: channelId };
    if (editingRmItem) {
      await supabase.from('channel_rich_menus').update(payload).eq('id', editingRmItem.id);
    } else {
      await supabase.from('channel_rich_menus').insert({ ...payload, sort_order: richMenuItems.length });
    }
    setRichMenuEditModal(false); await fetchRichMenu(); setSavingRm(false);
  };

  const deleteRmItem = async (item: RichMenuItem) => {
    if (!window.confirm(`「${item.label}」を削除しますか？`)) return;
    await supabase.from('channel_rich_menus').delete().eq('id', item.id);
    await fetchRichMenu();
  };

  const handleRmAction = (item: RichMenuItem) => {
    setRichMenuOpen(false);
    if (item.action_type === 'text') {
      setInputText(item.action_value);
    } else if (item.action_type === 'url') {
      Linking.openURL(item.action_value).catch(() => alert('URLを開けませんでした'));
    }
  };

  // ─── Mention ─────────────────────────────────────────────
  const handleTextChange = (text: string) => {
    setInputText(text);
    // Check if user is typing @mention
    const cursorText = text;
    const atIdx = cursorText.lastIndexOf('@');
    if (atIdx >= 0) {
      const afterAt = cursorText.slice(atIdx + 1);
      // Only show if no space after @ (still typing the name)
      if (!afterAt.includes(' ') && afterAt.length <= 20) {
        setMentionQuery(afterAt.toLowerCase());
        const filtered = allMembers.filter(m =>
          m.display_name.toLowerCase().includes(afterAt.toLowerCase())
        );
        setMentionMembers(filtered);
        setShowMentionList(filtered.length > 0);
        return;
      }
    }
    setShowMentionList(false);
  };

  const insertMention = (member: { user_id: string; display_name: string }) => {
    const atIdx = inputText.lastIndexOf('@');
    if (atIdx >= 0) {
      const before = inputText.slice(0, atIdx);
      setInputText(`${before}@${member.display_name} `);
    }
    setShowMentionList(false);
  };

  const sendMessage = async () => {
    if (!inputText.trim() || !userIdRef.current) return;
    const content = inputText.trim();
    setInputText('');
    const { data: inserted, error } = await supabase
      .from('messages')
      .insert({ sender_id: userIdRef.current, channel_id: channelId, content })
      .select('id, content, sender_id, channel_id, created_at, is_deleted, file_url, file_type')
      .single();
    if (error) { console.log('送信エラー:', error.message); return; }
    if (inserted && realtimeChannelRef.current) {
      const { data: prof } = await supabase
        .from('profiles').select('display_name').eq('id', userIdRef.current).single();
      realtimeChannelRef.current.send({
        type: 'broadcast',
        event: 'new_message',
        payload: { ...inserted, profiles: prof },
      });
      // Push通知を送信（自分以外のチャンネルメンバーへ）
      try {
        const { data: members } = await supabase.from('channel_members').select('user_id').eq('channel_id', channelId);
        const otherIds = (members ?? []).map((m: any) => m.user_id).filter((id: string) => id !== userIdRef.current);
        if (otherIds.length > 0) {
          const senderName = prof?.display_name ?? '';
          fetch('https://nccognptoprhwsbjnwcu.supabase.co/functions/v1/send-push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              user_ids: otherIds,
              title: `#${channelName}`,
              body: `${senderName}: ${content.slice(0, 100)}`,
            }),
          }).catch(() => {});
        }
      } catch (_) {}
    }
  };

  const pickAndUploadImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false, quality: 0.8,
    });
    if (result.canceled || !userIdRef.current) return;
    const asset = result.assets[0];
    setUploading(true);
    try {
      const ext = asset.uri.split('.').pop() ?? 'jpg';
      const fileName = `${userIdRef.current}/${Date.now()}.${ext}`;
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const { error: uploadError } = await supabase.storage
        .from('chat-files').upload(fileName, blob, { contentType: `image/${ext}` });
      if (uploadError) { alert(uploadError.message); return; }
      const { data: urlData } = supabase.storage.from('chat-files').getPublicUrl(fileName);
      const { data: inserted } = await supabase.from('messages').insert({
        sender_id: userIdRef.current, channel_id: channelId,
        content: '📷 画像', file_url: urlData.publicUrl, file_type: 'image',
      }).select('id, content, sender_id, channel_id, created_at, is_deleted, file_url, file_type').single();
      if (inserted && realtimeChannelRef.current) {
        const { data: prof } = await supabase
          .from('profiles').select('display_name').eq('id', userIdRef.current!).single();
        realtimeChannelRef.current.send({
          type: 'broadcast',
          event: 'new_message',
          payload: { ...inserted, profiles: prof },
        });
      }
    } catch (e: any) { alert(e.message); }
    finally { setUploading(false); }
  };

  const openMsgMenu = (msg: Message) => {
    if (msg.is_deleted) return;
    setSelectedMsg(msg);
    setMsgMenuVisible(true);
  };

  const recallMessage = async () => {
    if (!selectedMsg) return;
    setMsgMenuVisible(false);
    if (!window.confirm('このメッセージを取り消しますか？')) return;
    const msgId = selectedMsg.id;
    await supabase.from('messages').update({
      content: 'このメッセージは取り消されました',
      is_deleted: true,
      deleted_at: new Date().toISOString(),
    }).eq('id', msgId);
    realtimeChannelRef.current?.send({
      type: 'broadcast',
      event: 'update_message',
      payload: { id: msgId, content: 'このメッセージは取り消されました', is_deleted: true },
    });
  };

  const deleteMessage = async () => {
    if (!selectedMsg) return;
    setMsgMenuVisible(false);
    if (!window.confirm('完全に削除しますか？')) return;
    const msgId = selectedMsg.id;
    await supabase.from('messages').delete().eq('id', msgId);
    realtimeChannelRef.current?.send({
      type: 'broadcast',
      event: 'delete_message',
      payload: { id: msgId },
    });
  };

  const openMemberManager = async () => {
    const [{ data: cm }, { data: ap }] = await Promise.all([
      supabase.from('channel_members').select('user_id, profiles(display_name, avatar_url)').eq('channel_id', channelId),
      supabase.from('profiles').select('id, display_name, avatar_url').order('display_name'),
    ]);
    if (cm) setChannelMembers(cm as ChannelMember[]);
    if (ap) setAllProfiles(ap as AllProfile[]);
    setMemberModalVisible(true);
  };

  const addMember = async (userId: string) => {
    await supabase.from('channel_members').insert({ channel_id: channelId, user_id: userId });
    const { data } = await supabase.from('channel_members').select('user_id, profiles(display_name, avatar_url)').eq('channel_id', channelId);
    if (data) setChannelMembers(data as ChannelMember[]);
  };

  const removeMember = async (userId: string) => {
    await supabase.from('channel_members').delete().eq('channel_id', channelId).eq('user_id', userId);
    const { data } = await supabase.from('channel_members').select('user_id, profiles(display_name, avatar_url)').eq('channel_id', channelId);
    if (data) setChannelMembers(data as ChannelMember[]);
  };

  const isMember = (userId: string) => channelMembers.some(m => m.user_id === userId);

  const renderMessage = ({ item }: { item: Message }) => {
    const isMe = item.sender_id === currentUserId;
    const msgReaders = readers[item.id] ?? [];
    // 送信者自身を除いた既読数
    const readCount = msgReaders.filter(uid => uid !== item.sender_id).length;
    // チャンネルメンバーから送信者を除いた人数
    const totalOthers = Math.max(0, memberCount - 1);
    const unreadCount = Math.max(0, totalOthers - readCount);

    return (
      <TouchableOpacity onLongPress={() => openMsgMenu(item)} activeOpacity={0.8}
        style={[styles.messageRow, isMe && styles.messageRowMe]}>
        {!isMe && <Text style={styles.senderName}>{item.profiles?.display_name ?? '不明'}</Text>}
        <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleOther, item.is_deleted && styles.bubbleDeleted]}>
          {item.is_deleted ? (
            <Text style={styles.deletedText}>🚫 このメッセージは取り消されました</Text>
          ) : item.file_type === 'image' && item.file_url ? (
            <Image source={{ uri: item.file_url }} style={styles.imageMessage} resizeMode="cover" />
          ) : (
            <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>
              {item.content.split(/(@\S+)/g).map((part, i) =>
                part.startsWith('@') ? (
                  <Text key={i} style={styles.mentionHighlight}>{part}</Text>
                ) : part
              )}
            </Text>
          )}
        </View>
        <Text style={styles.timestamp}>
          {new Date(item.created_at).toLocaleString('ja-JP', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit',
          })}
        </Text>
        {!item.is_deleted && totalOthers > 0 && (
          <TouchableOpacity
            style={[styles.readStatusRow, isMe && styles.readStatusRowMe]}
            onPress={() => { setReadDetailMsg(item); setReadDetailTab('read'); setReadDetailVisible(true); }}
          >
            {readCount > 0 && <Text style={styles.readText}>既読 {readCount}</Text>}
            {unreadCount > 0 && <Text style={styles.unreadText}>未読 {unreadCount}</Text>}
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior="padding">
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.back}>← 戻る</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>🔒 {channelName}</Text>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity onPress={() => setChNotifModalVisible(true)} style={styles.headerIconBtn}>
            <Text style={styles.headerIcon}>{chNotifMuted ? '🔕' : '🔔'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onOpenTabs} style={styles.headerIconBtn}>
            <Text style={styles.headerIcon}>📋</Text>
          </TouchableOpacity>
          {isAdmin && (
            <TouchableOpacity onPress={openMemberManager} style={styles.headerIconBtn}>
              <Text style={styles.headerIcon}>👥</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {unreadAnnouncements.length > 0 && (
        <View style={styles.annBannerWrap}>
          <TouchableOpacity style={styles.annBanner} onPress={() => { setSelectedAnn(unreadAnnouncements[0]); setAnnDetailVisible(true); }}>
            <Text style={styles.annBannerIcon}>📢</Text>
            <View style={styles.annBannerText}>
              <Text style={styles.annBannerTitle} numberOfLines={1}>{unreadAnnouncements[0].title}</Text>
              <Text style={styles.annBannerSub} numberOfLines={1}>{unreadAnnouncements[0].content}</Text>
            </View>
            {unreadAnnouncements.length > 1 && (
              <View style={styles.annCountBadge}>
                <Text style={styles.annCountText}>+{unreadAnnouncements.length - 1}</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.annAllReadBtn} onPress={markAllAnnsAsRead}>
            <Text style={styles.annAllReadText}>全既読</Text>
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        contentContainerStyle={styles.messageList}
        onLayout={() => flatListRef.current?.scrollToEnd({ animated: false })}
      />

      {/* リッチメニュー */}
      {richMenuItems.length > 0 && (
        <TouchableOpacity style={styles.rmToggle} onPress={() => setRichMenuOpen(!richMenuOpen)}>
          <Text style={styles.rmToggleText}>{richMenuOpen ? '▼ メニューを閉じる' : '▲ メニュー'}</Text>
        </TouchableOpacity>
      )}
      {richMenuOpen && richMenuItems.length > 0 && (
        <View style={styles.rmPanel}>
          <View style={styles.rmGrid}>
            {richMenuItems.map(item => (
              <TouchableOpacity key={item.id} style={styles.rmItem} onPress={() => handleRmAction(item)}
                onLongPress={() => isAdmin && openEditRm(item)}>
                <Text style={styles.rmItemIcon}>{item.icon}</Text>
                <Text style={styles.rmItemLabel} numberOfLines={2}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {isAdmin && (
            <TouchableOpacity style={styles.rmEditBtn} onPress={openAddRm}>
              <Text style={styles.rmEditBtnText}>＋ メニュー追加</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      {isAdmin && richMenuItems.length === 0 && (
        <TouchableOpacity style={styles.rmEmptyAdd} onPress={openAddRm}>
          <Text style={styles.rmEmptyAddText}>＋ リッチメニューを作成</Text>
        </TouchableOpacity>
      )}

      {/* メンション候補 */}
      {showMentionList && (
        <View style={styles.mentionList}>
          {mentionMembers.slice(0, 6).map(m => (
            <TouchableOpacity key={m.user_id} style={styles.mentionItem} onPress={() => insertMention(m)}>
              <View style={styles.mentionAvatar}><Text style={styles.mentionAvatarText}>{m.display_name.charAt(0)}</Text></View>
              <Text style={styles.mentionName}>{m.display_name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={styles.inputBar}>
        <TouchableOpacity style={styles.attachButton} onPress={pickAndUploadImage} disabled={uploading}>
          <Text style={styles.attachIcon}>{uploading ? '⏳' : '📎'}</Text>
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          value={inputText}
          onChangeText={handleTextChange}
          placeholder={`🔒 ${channelName} へメッセージ... (@でメンション)`}
          placeholderTextColor="#C0C0C0"
          multiline
          returnKeyType="send"
          onSubmitEditing={sendMessage}
        />
        <TouchableOpacity style={styles.sendButton} onPress={sendMessage}>
          <Text style={styles.sendButtonText}>送信</Text>
        </TouchableOpacity>
      </View>

      {/* リッチメニュー編集モーダル */}
      <Modal visible={richMenuEditModal} transparent animationType="slide" onRequestClose={() => setRichMenuEditModal(false)}>
        <View style={styles.rmModalOverlay}>
          <View style={styles.rmModalSheet}>
            <View style={styles.rmModalTop}>
              <Text style={styles.rmModalTitle}>{editingRmItem ? 'メニュー編集' : 'メニュー追加'}</Text>
              <TouchableOpacity onPress={() => setRichMenuEditModal(false)}><Text style={styles.rmModalClose}>✕</Text></TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.rmFormLabel}>アイコン</Text>
              <View style={styles.rmIconGrid}>
                {RM_ICONS.map(ic => (
                  <TouchableOpacity key={ic} style={[styles.rmIconBtn, rmIcon === ic && styles.rmIconBtnActive]} onPress={() => setRmIcon(ic)}>
                    <Text style={styles.rmIconBtnText}>{ic}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.rmFormLabel}>ラベル *</Text>
              <TextInput style={styles.rmFormInput} value={rmLabel} onChangeText={setRmLabel} placeholder="例: 議事録テンプレ" />

              <Text style={styles.rmFormLabel}>アクション</Text>
              <View style={styles.rmActionRow}>
                {([['text', 'テキスト入力'], ['url', 'URL表示']] as const).map(([k, l]) => (
                  <TouchableOpacity key={k} style={[styles.rmActionChip, rmActionType === k && styles.rmActionChipActive]} onPress={() => setRmActionType(k)}>
                    <Text style={[styles.rmActionChipText, rmActionType === k && styles.rmActionChipTextActive]}>{l}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.rmFormLabel}>{rmActionType === 'text' ? '入力するテキスト' : 'URL'}</Text>
              <TextInput
                style={[styles.rmFormInput, rmActionType === 'text' && { minHeight: 80, textAlignVertical: 'top' }]}
                value={rmActionValue} onChangeText={setRmActionValue}
                placeholder={rmActionType === 'text' ? '例: 【議事録】\n日時：\n参加者：\n議題：' : 'https://...'}
                multiline={rmActionType === 'text'}
              />

              <View style={styles.rmModalBtns}>
                {editingRmItem && (
                  <TouchableOpacity style={styles.rmDeleteBtn} onPress={() => { setRichMenuEditModal(false); deleteRmItem(editingRmItem); }}>
                    <Text style={styles.rmDeleteBtnText}>🗑 削除</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.rmCancelBtn} onPress={() => setRichMenuEditModal(false)}>
                  <Text style={styles.rmCancelBtnText}>キャンセル</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.rmSaveBtn, savingRm && { opacity: 0.6 }]} onPress={saveRmItem} disabled={savingRm}>
                  <Text style={styles.rmSaveBtnText}>{savingRm ? '保存中...' : '保存'}</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* チャンネル通知設定モーダル */}
      <Modal visible={chNotifModalVisible} transparent animationType="fade" onRequestClose={() => setChNotifModalVisible(false)}>
        <TouchableOpacity style={styles.chNotifOverlay} activeOpacity={1} onPress={() => setChNotifModalVisible(false)}>
          <View style={styles.chNotifSheet}>
            <Text style={styles.chNotifTitle}>🔔 #{channelName} の通知設定</Text>

            <View style={styles.chNotifRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.chNotifLabel}>ミュート</Text>
                <Text style={styles.chNotifDesc}>このチャンネルの通知をすべて停止</Text>
              </View>
              <Switch value={chNotifMuted} onValueChange={(v) => { setChNotifMuted(v); saveChNotifSetting({ muted: v }); }} trackColor={{ true: '#EF4444' }} />
            </View>

            <View style={styles.chNotifRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.chNotifLabel}>メンションのみ</Text>
                <Text style={styles.chNotifDesc}>自分が@メンションされた時だけ通知</Text>
              </View>
              <Switch value={chNotifMentionOnly} onValueChange={(v) => { setChNotifMentionOnly(v); saveChNotifSetting({ mentions_only: v }); }} trackColor={{ true: '#1A3C8F' }} />
            </View>

            <View style={styles.chNotifStatusRow}>
              <Text style={{ fontSize: 12, color: '#94A3B8' }}>現在: </Text>
              <Text style={{ fontSize: 12, fontWeight: '700', color: chNotifMuted ? '#EF4444' : chNotifMentionOnly ? '#F59E0B' : '#10B981' }}>
                {chNotifMuted ? '🔕 ミュート中' : chNotifMentionOnly ? '@ メンションのみ' : '🔔 すべて通知'}
              </Text>
            </View>

            <TouchableOpacity style={styles.chNotifCloseBtn} onPress={() => setChNotifModalVisible(false)}>
              <Text style={styles.chNotifCloseBtnText}>閉じる</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* お知らせ詳細モーダル */}
      <Modal visible={annDetailVisible} transparent animationType="slide" onRequestClose={() => setAnnDetailVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.annDetailContent}>
            <View style={styles.annDetailHeader}>
              <Text style={styles.annDetailIcon}>📢</Text>
              <Text style={styles.annDetailTitle}>{selectedAnn?.title}</Text>
              <TouchableOpacity onPress={() => setAnnDetailVisible(false)}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.annDetailBody}>
              <Text style={styles.annDetailText}>{selectedAnn?.content}</Text>
              <Text style={styles.annDetailDate}>
                {selectedAnn ? new Date(selectedAnn.created_at).toLocaleString('ja-JP', {
                  year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                }) : ''}
              </Text>
            </ScrollView>
            {unreadAnnouncements.length > 1 && (
              <View style={styles.annListSection}>
                <Text style={styles.annListTitle}>他の未読お知らせ</Text>
                {unreadAnnouncements.filter(a => a.id !== selectedAnn?.id).map(ann => (
                  <TouchableOpacity key={ann.id} style={styles.annListItem} onPress={() => setSelectedAnn(ann)}>
                    <Text style={styles.annListItemTitle} numberOfLines={1}>{ann.title}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <TouchableOpacity style={styles.annReadButton} onPress={() => selectedAnn && markAnnAsRead(selectedAnn)}>
              <Text style={styles.annReadButtonText}>✓ 既読にする</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* メッセージメニューモーダル */}
      <Modal visible={msgMenuVisible} transparent animationType="fade" onRequestClose={() => setMsgMenuVisible(false)}>
        <TouchableOpacity style={styles.menuOverlay} onPress={() => setMsgMenuVisible(false)}>
          <View style={styles.menuContent}>
            <Text style={styles.menuTitle} numberOfLines={1}>「{selectedMsg?.content?.slice(0, 20)}」</Text>
            {selectedMsg?.sender_id === currentUserId && !selectedMsg?.is_deleted && (
              <TouchableOpacity style={styles.menuItem} onPress={recallMessage}>
                <Text style={styles.menuItemText}>↩️ 送信取り消し</Text>
              </TouchableOpacity>
            )}
            {isAdmin && (
              <TouchableOpacity style={styles.menuItem} onPress={deleteMessage}>
                <Text style={[styles.menuItemText, { color: '#E24B4A' }]}>🗑 完全削除（管理者）</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[styles.menuItem, { borderBottomWidth: 0 }]} onPress={() => setMsgMenuVisible(false)}>
              <Text style={[styles.menuItemText, { color: '#999' }]}>キャンセル</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* メンバー管理モーダル */}
      <Modal visible={memberModalVisible} transparent animationType="slide" onRequestClose={() => setMemberModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>🔒 # {channelName} のメンバー</Text>
              <TouchableOpacity onPress={() => setMemberModalVisible(false)}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>タップで追加/削除</Text>
            <FlatList
              data={allProfiles}
              keyExtractor={(item) => item.id}
              style={styles.memberList}
              renderItem={({ item }) => {
                const joined = isMember(item.id);
                return (
                  <TouchableOpacity style={[styles.memberRow, joined && styles.memberRowJoined]}
                    onPress={() => joined ? removeMember(item.id) : addMember(item.id)}>
                    {item.avatar_url ? (
                      <Image source={{ uri: item.avatar_url }} style={styles.memberAvatar} />
                    ) : (
                      <View style={[styles.memberAvatarPlaceholder, joined && styles.memberAvatarJoined]}>
                        <Text style={styles.memberAvatarText}>{item.display_name.charAt(0).toUpperCase()}</Text>
                      </View>
                    )}
                    <Text style={styles.memberName}>{item.display_name}</Text>
                    <View style={[styles.badge, joined ? styles.badgeJoined : styles.badgeNot]}>
                      <Text style={[styles.badgeText, joined ? styles.badgeTextJoined : styles.badgeTextNot]}>
                        {joined ? '✓ 参加中' : '+ 追加'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>

      {/* 既読詳細モーダル */}
      <Modal visible={readDetailVisible} transparent animationType="slide" onRequestClose={() => setReadDetailVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.rdModalContent}>
            <View style={styles.rdModalHeader}>
              <Text style={styles.rdModalTitle}>既読メンバー</Text>
              <TouchableOpacity onPress={() => setReadDetailVisible(false)}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            {readDetailMsg && (() => {
              const msgReaders = readers[readDetailMsg.id] ?? [];
              const readMembers = allMembers.filter(
                m => m.user_id !== readDetailMsg.sender_id && msgReaders.includes(m.user_id)
              );
              const unreadMembers = allMembers.filter(
                m => m.user_id !== readDetailMsg.sender_id && !msgReaders.includes(m.user_id)
              );
              return (
                <>
                  <View style={styles.rdTabs}>
                    <TouchableOpacity
                      style={[styles.rdTab, readDetailTab === 'read' && styles.rdTabActive]}
                      onPress={() => setReadDetailTab('read')}
                    >
                      <Text style={[styles.rdTabText, readDetailTab === 'read' && styles.rdTabTextActive]}>
                        既読（{readMembers.length}）
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.rdTab, readDetailTab === 'unread' && styles.rdTabActive]}
                      onPress={() => setReadDetailTab('unread')}
                    >
                      <Text style={[styles.rdTabText, readDetailTab === 'unread' && styles.rdTabTextActive]}>
                        未読（{unreadMembers.length}）
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <ScrollView style={styles.rdList}>
                    {(readDetailTab === 'read' ? readMembers : unreadMembers).map(m => (
                      <View key={m.user_id} style={styles.rdMemberRow}>
                        {m.avatar_url ? (
                          <Image source={{ uri: m.avatar_url }} style={styles.rdAvatar} />
                        ) : (
                          <View style={styles.rdAvatarPlaceholder}>
                            <Text style={styles.rdAvatarText}>{m.display_name.charAt(0).toUpperCase()}</Text>
                          </View>
                        )}
                        <Text style={styles.rdMemberName}>{m.display_name}</Text>
                        <Text style={readDetailTab === 'read' ? styles.rdReadLabel : styles.rdUnreadLabel}>
                          {readDetailTab === 'read' ? '既読' : '未読'}
                        </Text>
                      </View>
                    ))}
                    {(readDetailTab === 'read' ? readMembers : unreadMembers).length === 0 && (
                      <Text style={styles.rdEmpty}>
                        {readDetailTab === 'read' ? 'まだ誰も読んでいません' : '全員が既読です'}
                      </Text>
                    )}
                  </ScrollView>
                </>
              );
            })()}
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f0f0' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: 48, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee' },
  back: { color: '#1A3C8F', fontSize: 16, width: 60 },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 15, fontWeight: 'bold', color: '#333' },
  headerRight: { flexDirection: 'row', gap: 4 },
  headerIconBtn: { padding: 6 },
  headerIcon: { fontSize: 20 },
  annBannerWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF8E1', borderBottomWidth: 1, borderBottomColor: '#FFE082' },
  annBanner: { flex: 1, flexDirection: 'row', alignItems: 'center', padding: 10, gap: 8 },
  annBannerIcon: { fontSize: 18 },
  annBannerText: { flex: 1 },
  annBannerTitle: { fontSize: 13, fontWeight: 'bold', color: '#5D4037' },
  annBannerSub: { fontSize: 11, color: '#795548', marginTop: 1 },
  annCountBadge: { backgroundColor: '#FF8F00', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  annCountText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  annAllReadBtn: { paddingHorizontal: 12, paddingVertical: 10 },
  annAllReadText: { fontSize: 12, color: '#795548', fontWeight: '600' },
  messageList: { padding: 12, flexGrow: 1 },
  messageRow: { marginBottom: 12, alignItems: 'flex-start' },
  messageRowMe: { alignItems: 'flex-end' },
  senderName: { fontSize: 12, color: '#666', marginBottom: 2, marginLeft: 4 },
  bubble: { maxWidth: '75%', padding: 10, borderRadius: 12, backgroundColor: '#fff', borderBottomLeftRadius: 2 },
  bubbleMe: { backgroundColor: '#1A3C8F', borderBottomLeftRadius: 12, borderBottomRightRadius: 2 },
  bubbleOther: {},
  bubbleDeleted: { backgroundColor: '#f0f0f0', borderColor: '#ddd', borderWidth: 1 },
  bubbleText: { fontSize: 15, color: '#333' },
  bubbleTextMe: { color: '#fff' },
  deletedText: { fontSize: 13, color: '#999', fontStyle: 'italic' },
  imageMessage: { width: 200, height: 200, borderRadius: 8 },
  timestamp: { fontSize: 10, color: '#999', marginTop: 2, marginHorizontal: 4 },
  readStatusRow: { flexDirection: 'row', gap: 6, marginTop: 2, marginHorizontal: 4 },
  readStatusRowMe: { justifyContent: 'flex-end' },
  readText: { fontSize: 10, color: '#1A3C8F', fontWeight: '600' },
  unreadText: { fontSize: 10, color: '#999' },
  inputBar: { flexDirection: 'row', padding: 8, alignItems: 'flex-end', backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#eee' },
  attachButton: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center', marginRight: 4 },
  attachIcon: { fontSize: 22 },
  input: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, maxHeight: 100, fontSize: 15 },
  sendButton: { marginLeft: 8, backgroundColor: '#1A3C8F', borderRadius: 20, paddingHorizontal: 16, height: 36, justifyContent: 'center' },
  sendButtonText: { color: '#fff', fontWeight: 'bold' },
  annDetailContent: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, maxHeight: '80%' },
  annDetailHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  annDetailIcon: { fontSize: 22 },
  annDetailTitle: { flex: 1, fontSize: 17, fontWeight: 'bold', color: '#333' },
  annDetailBody: { maxHeight: 200, marginBottom: 12 },
  annDetailText: { fontSize: 15, color: '#444', lineHeight: 24 },
  annDetailDate: { fontSize: 12, color: '#999', marginTop: 12 },
  annListSection: { borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 12, marginBottom: 12 },
  annListTitle: { fontSize: 12, color: '#999', fontWeight: '600', marginBottom: 8 },
  annListItem: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  annListItemTitle: { fontSize: 14, color: '#333' },
  annReadButton: { backgroundColor: '#1A3C8F', borderRadius: 12, padding: 14, alignItems: 'center' },
  annReadButtonText: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  menuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  menuContent: { backgroundColor: '#fff', borderRadius: 16, width: 280, overflow: 'hidden' },
  menuTitle: { fontSize: 13, color: '#999', padding: 14, borderBottomWidth: 1, borderBottomColor: '#eee' },
  menuItem: { padding: 16, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  menuItemText: { fontSize: 15, color: '#333', textAlign: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '80%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  modalTitle: { fontSize: 16, fontWeight: 'bold', color: '#333', flex: 1 },
  modalClose: { fontSize: 18, color: '#999', paddingLeft: 12 },
  modalSubtitle: { fontSize: 13, color: '#999', marginBottom: 12 },
  memberList: { maxHeight: 400 },
  memberRow: { flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: 10, marginBottom: 4 },
  memberRowJoined: { backgroundColor: '#f0fff4' },
  memberAvatar: { width: 40, height: 40, borderRadius: 20, marginRight: 12 },
  memberAvatarPlaceholder: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#ddd', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  memberAvatarJoined: { backgroundColor: '#1A3C8F' },
  memberAvatarText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  memberName: { flex: 1, fontSize: 15, color: '#333' },
  badge: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  badgeJoined: { backgroundColor: '#1A3C8F' },
  badgeNot: { backgroundColor: '#f0f0f0' },
  badgeText: { fontSize: 12, fontWeight: '600' },
  badgeTextJoined: { color: '#fff' },
  badgeTextNot: { color: '#666' },
  // 既読詳細モーダル
  rdModalContent: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40, maxHeight: '70%' },
  rdModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  rdModalTitle: { fontSize: 16, fontWeight: 'bold', color: '#333' },
  rdTabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#eee', marginBottom: 8 },
  rdTab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  rdTabActive: { borderBottomColor: '#1A3C8F' },
  rdTabText: { fontSize: 14, color: '#999', fontWeight: '500' },
  rdTabTextActive: { color: '#1A3C8F', fontWeight: 'bold' },
  rdList: { maxHeight: 400 },
  rdMemberRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f5f5f5' },
  rdAvatar: { width: 40, height: 40, borderRadius: 20, marginRight: 12 },
  rdAvatarPlaceholder: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#1A3C8F', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  rdAvatarText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  rdMemberName: { flex: 1, fontSize: 15, color: '#333' },
  rdReadLabel: { fontSize: 12, color: '#1A3C8F', fontWeight: '600' },
  rdUnreadLabel: { fontSize: 12, color: '#999' },
  rdEmpty: { textAlign: 'center', color: '#999', fontSize: 14, paddingVertical: 24 },

  // Channel notification settings
  chNotifOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  chNotifSheet: { backgroundColor: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 400, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, elevation: 8 },
  chNotifTitle: { fontSize: 16, fontWeight: '700', color: '#333', marginBottom: 16, textAlign: 'center' },
  chNotifRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  chNotifLabel: { fontSize: 15, fontWeight: '600', color: '#333' },
  chNotifDesc: { fontSize: 11, color: '#94A3B8', marginTop: 2 },
  chNotifStatusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
  chNotifCloseBtn: { backgroundColor: '#F1F5F9', borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  chNotifCloseBtnText: { fontSize: 14, fontWeight: '600', color: '#64748B' },

  // Mention
  mentionList: { backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#E2E8F0', maxHeight: 200 },
  mentionItem: { flexDirection: 'row', alignItems: 'center', padding: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9', gap: 10 },
  mentionAvatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#1A3C8F', alignItems: 'center', justifyContent: 'center' },
  mentionAvatarText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  mentionName: { fontSize: 14, fontWeight: '600', color: '#333' },
  mentionHighlight: { color: '#1D4ED8', fontWeight: 'bold', backgroundColor: '#DBEAFE' },

  // Rich menu
  rmToggle: { backgroundColor: '#E0F2FE', paddingVertical: 6, alignItems: 'center', borderTopWidth: 1, borderTopColor: '#BAE6FD' },
  rmToggleText: { fontSize: 11, fontWeight: '700', color: '#0369A1' },
  rmPanel: { backgroundColor: '#F0F9FF', borderTopWidth: 1, borderTopColor: '#BAE6FD', paddingVertical: 10, paddingHorizontal: 8 },
  rmGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-start' },
  rmItem: { width: '23%', backgroundColor: '#fff', borderRadius: 12, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: '#E0F2FE', shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 3, elevation: 1 },
  rmItemIcon: { fontSize: 24, marginBottom: 4 },
  rmItemLabel: { fontSize: 10, fontWeight: '600', color: '#334155', textAlign: 'center', lineHeight: 14 },
  rmEditBtn: { marginTop: 8, alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 6, borderRadius: 14, backgroundColor: '#DBEAFE' },
  rmEditBtnText: { fontSize: 11, fontWeight: '700', color: '#1D4ED8' },
  rmEmptyAdd: { backgroundColor: '#F0F9FF', paddingVertical: 8, alignItems: 'center', borderTopWidth: 1, borderTopColor: '#E0F2FE' },
  rmEmptyAddText: { fontSize: 12, fontWeight: '600', color: '#0EA5E9' },

  // Rich menu edit modal
  rmModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  rmModalSheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36, maxHeight: '85%' },
  rmModalTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  rmModalTitle: { fontSize: 17, fontWeight: 'bold', color: '#333' },
  rmModalClose: { fontSize: 18, color: '#999', padding: 4 },
  rmFormLabel: { fontSize: 13, fontWeight: '600', color: '#475569', marginBottom: 6, marginTop: 10 },
  rmFormInput: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 10, padding: 12, fontSize: 14, marginBottom: 8, backgroundColor: '#FAFAFA' },
  rmIconGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  rmIconBtn: { width: 40, height: 40, borderRadius: 10, borderWidth: 1.5, borderColor: '#E2E8F0', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8FAFC' },
  rmIconBtnActive: { borderColor: '#0EA5E9', backgroundColor: '#E0F2FE' },
  rmIconBtnText: { fontSize: 20 },
  rmActionRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  rmActionChip: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#D1D5DB', alignItems: 'center', backgroundColor: '#F8FAFC' },
  rmActionChipActive: { backgroundColor: '#0EA5E9', borderColor: '#0EA5E9' },
  rmActionChipText: { fontSize: 13, fontWeight: '600', color: '#64748B' },
  rmActionChipTextActive: { color: '#fff' },
  rmModalBtns: { flexDirection: 'row', gap: 8, marginTop: 16 },
  rmDeleteBtn: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10, backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA', alignItems: 'center' },
  rmDeleteBtnText: { fontSize: 14, fontWeight: '600', color: '#DC2626' },
  rmCancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: '#D1D5DB', alignItems: 'center' },
  rmCancelBtnText: { fontSize: 14, color: '#666' },
  rmSaveBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: '#0EA5E9', alignItems: 'center' },
  rmSaveBtnText: { fontSize: 14, fontWeight: 'bold', color: '#fff' },
});