import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, TextInput, Modal, Image,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { confirmDialog } from '../lib/platformHelpers';

type Channel = { id: string; name: string; created_by: string | null };

type DMRoom = {
  partner_id: string;
  partner_name: string;
  partner_avatar: string | null;
  last_message: string;
  last_at: string;
  unread: number;
};

/** Unified talk item for channels + DMs */
type TalkItem = {
  key: string;
  type: 'channel' | 'dm';
  // channel fields
  channel?: Channel;
  // dm fields
  partnerId?: string;
  partnerName?: string;
  partnerAvatar?: string | null;
  // common
  displayName: string;
  avatarUrl: string | null;
  avatarInitial: string;
  lastMessage: string;
  lastAt: string; // ISO string for sorting
  unread: number;
};

type Props = {
  onSelectChannel: (channel: Channel) => void;
  onShowMembers: () => void;
  onShowSearch: () => void;
  onShowProfile: () => void;
  onShowNotifications: () => void;
  onShowAdmin: () => void;
  onShowSchedule: () => void;
  onShowBusiness: () => void;
  onStartDM: (partnerId: string, partnerName: string) => void;
  onLogout: () => void;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  currentUserId: string | null;
  employmentType: string | null;
};

/** Format timestamp for display: today → HH:MM, this year → MM/DD, else → YYYY/MM/DD */
function formatTime(isoStr: string): string {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (d.toDateString() === now.toDateString()) {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) {
    return '昨日';
  }
  if (d.getFullYear() === now.getFullYear()) {
    return `${d.getMonth() + 1}/${pad(d.getDate())}`;
  }
  return `${d.getFullYear()}/${d.getMonth() + 1}/${pad(d.getDate())}`;
}

export default function ChannelListScreen({ onSelectChannel, onShowMembers, onShowSearch, onShowProfile, onShowNotifications, onShowAdmin, onShowSchedule, onShowBusiness, onStartDM, onLogout, isAdmin, isSuperAdmin, currentUserId, employmentType }: Props) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [myAvatarUrl, setMyAvatarUrl] = useState<string | null>(null);
  const [myName, setMyName] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [creating, setCreating] = useState(false);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [dmRooms, setDmRooms] = useState<DMRoom[]>([]);
  const [channelLastMessages, setChannelLastMessages] = useState<Record<string, { content: string; created_at: string; sender_name: string }>>({});
  const [filter, setFilter] = useState<'all' | 'dm' | 'channel'>('all');
  const [allMembers, setAllMembers] = useState<{ id: string; display_name: string; avatar_url: string | null }[]>([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set());
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    fetchChannels();
    fetchAllMembers();
    if (currentUserId) {
      fetchMyProfile();
      fetchUnreadCounts();
      fetchDmRooms();
      if (isAdmin) fetchPendingCount();
    }
    const subscription = supabase
      .channel('channels-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'channels' }, () => fetchChannels())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'channel_members' }, () => fetchChannels())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => { fetchChannelLastMessages(); fetchUnreadCounts(); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages' }, () => fetchDmRooms())
      .subscribe();
    const initTimer = setTimeout(() => {
      if (currentUserId) { fetchUnreadCounts(); fetchDmRooms(); fetchChannelLastMessages(); }
    }, 600);
    const timer = setInterval(() => {
      if (currentUserId) { fetchUnreadCounts(); fetchDmRooms(); fetchChannelLastMessages(); }
    }, 15000);
    return () => {
      supabase.removeChannel(subscription);
      clearTimeout(initTimer);
      clearInterval(timer);
    };
  }, [currentUserId]);

  // Fetch latest messages for all channels whenever channels change
  useEffect(() => {
    if (channels.length > 0) fetchChannelLastMessages();
  }, [channels]);

  const fetchUnreadCounts = async () => {
    if (!currentUserId) return;
    const { data } = await supabase.rpc('get_unread_counts', { p_user_id: currentUserId });
    if (data) {
      const counts: Record<string, number> = {};
      data.forEach((row: { channel_id: string; unread_count: number }) => {
        counts[row.channel_id] = Number(row.unread_count);
      });
      setUnreadCounts(counts);
    }
  };

  const fetchMyProfile = async () => {
    const { data } = await supabase.from('profiles').select('display_name, avatar_url').eq('id', currentUserId).single();
    if (data) { setMyAvatarUrl(data.avatar_url); setMyName(data.display_name); }
  };

  const fetchAllMembers = async () => {
    const { data } = await supabase.from('profiles').select('id, display_name, avatar_url').eq('account_status', 'active').order('display_name');
    if (data) setAllMembers(data);
  };

  const fetchPendingCount = async () => {
    const { count } = await supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('account_status', 'pending_approval');
    setPendingCount(count ?? 0);
  };

  const openCreateModal = () => {
    setNewChannelName('');
    // 自分を最初から選択状態にする
    setSelectedMemberIds(new Set(currentUserId ? [currentUserId] : []));
    setModalVisible(true);
  };

  const toggleMember = (id: string) => {
    setSelectedMemberIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const fetchChannels = async () => {
    if (!currentUserId) return;
    // 自分が参加しているチャンネルのみ取得
    const { data: myMembers } = await supabase.from('channel_members').select('channel_id').eq('user_id', currentUserId);
    if (!myMembers || myMembers.length === 0) { setChannels([]); return; }
    const myChannelIds = myMembers.map((m: any) => m.channel_id);
    const { data, error } = await supabase.from('channels').select('id, name, created_by').in('id', myChannelIds).order('created_at', { ascending: true });
    if (error) { console.log('fetchChannels error:', error.message); return; }
    if (data) setChannels(data as Channel[]);
  };

  const fetchChannelLastMessages = async () => {
    // For each channel, get the latest non-deleted message
    const results: Record<string, { content: string; created_at: string; sender_name: string }> = {};
    await Promise.all(channels.map(async (ch) => {
      const { data } = await supabase
        .from('messages')
        .select('content, created_at, sender_id, is_deleted, profiles!messages_sender_id_fkey(display_name)')
        .eq('channel_id', ch.id)
        .eq('is_deleted', false)
        .order('created_at', { ascending: false })
        .limit(1);
      if (data && data.length > 0) {
        const msg = data[0] as any;
        results[ch.id] = {
          content: msg.content ?? '',
          created_at: msg.created_at,
          sender_name: msg.profiles?.display_name ?? '',
        };
      }
    }));
    setChannelLastMessages(results);
  };

  const fetchDmRooms = async () => {
    if (!currentUserId) return;
    const { data } = await supabase
      .from('direct_messages')
      .select('*')
      .or(`sender_id.eq.${currentUserId},receiver_id.eq.${currentUserId}`)
      .order('created_at', { ascending: false });
    if (!data || data.length === 0) { setDmRooms([]); return; }
    const roomMap: Record<string, { last_message: string; last_at: string; unread: number }> = {};
    data.forEach((dm: any) => {
      const partnerId = dm.sender_id === currentUserId ? dm.receiver_id : dm.sender_id;
      if (!roomMap[partnerId]) {
        roomMap[partnerId] = { last_message: dm.content, last_at: dm.created_at, unread: 0 };
      }
      if (dm.receiver_id === currentUserId && !dm.is_read) {
        roomMap[partnerId].unread++;
      }
    });
    const partnerIds = Object.keys(roomMap);
    const { data: profiles } = await supabase.from('profiles').select('id, display_name, avatar_url').in('id', partnerIds);
    const profMap: Record<string, { name: string; avatar: string | null }> = {};
    profiles?.forEach((p: any) => { profMap[p.id] = { name: p.display_name, avatar: p.avatar_url }; });
    const rooms: DMRoom[] = partnerIds.map(pid => ({
      partner_id: pid,
      partner_name: profMap[pid]?.name ?? '',
      partner_avatar: profMap[pid]?.avatar ?? null,
      last_message: roomMap[pid].last_message,
      last_at: roomMap[pid].last_at,
      unread: roomMap[pid].unread,
    })).sort((a, b) => b.last_at.localeCompare(a.last_at));
    setDmRooms(rooms);
  };

  const createChannel = async () => {
    const name = newChannelName.trim().toLowerCase().replace(/\s+/g, '-');
    if (!name) { alert('チャンネル名を入力してください'); return; }
    if (channels.some(c => c.name === name)) { alert('すでに同じ名前のチャンネルがあります'); return; }
    if (selectedMemberIds.size === 0) { alert('メンバーを1人以上選択してください'); return; }
    setCreating(true);
    const { data: newChannel, error } = await supabase.from('channels').insert({ name, created_by: currentUserId }).select().single();
    if (error) { alert(error.message); setCreating(false); return; }
    if (newChannel) {
      const memberRows = Array.from(selectedMemberIds).map(uid => ({ channel_id: newChannel.id, user_id: uid }));
      await supabase.from('channel_members').insert(memberRows);
    }
    // 先にモーダルを閉じてからデータ更新
    setModalVisible(false);
    setNewChannelName('');
    setSelectedMemberIds(new Set());
    setCreating(false);
    fetchChannels();
    fetchChannelLastMessages();
  };

  const deleteChannel = async (channel: Channel) => {
    const ok = await confirmDialog(`# ${channel.name} を削除しますか？\nこのチャンネルとすべてのメッセージが削除されます。`);
    if (!ok) return;
    await supabase.from('messages').delete().eq('channel_id', channel.id);
    await supabase.from('channel_members').delete().eq('channel_id', channel.id);
    await supabase.from('channels').delete().eq('id', channel.id);
    await fetchChannels();
  };

  // Build unified talk list
  const talkItems: TalkItem[] = React.useMemo(() => {
    const items: TalkItem[] = [];

    // Add channels
    channels.forEach(ch => {
      const last = channelLastMessages[ch.id];
      items.push({
        key: `ch-${ch.id}`,
        type: 'channel',
        channel: ch,
        displayName: ch.name,
        avatarUrl: null,
        avatarInitial: '#',
        lastMessage: last ? `${last.sender_name}: ${last.content}` : '',
        lastAt: last?.created_at ?? '',
        unread: unreadCounts[ch.id] ?? 0,
      });
    });

    // Add DM rooms
    dmRooms.forEach(room => {
      items.push({
        key: `dm-${room.partner_id}`,
        type: 'dm',
        partnerId: room.partner_id,
        partnerName: room.partner_name,
        partnerAvatar: room.partner_avatar,
        displayName: room.partner_name,
        avatarUrl: room.partner_avatar,
        avatarInitial: room.partner_name.charAt(0),
        lastMessage: room.last_message,
        lastAt: room.last_at,
        unread: room.unread,
      });
    });

    // Sort by latest message (items with messages first, then items without)
    items.sort((a, b) => {
      if (!a.lastAt && !b.lastAt) return 0;
      if (!a.lastAt) return 1;
      if (!b.lastAt) return -1;
      return b.lastAt.localeCompare(a.lastAt);
    });

    // Apply filter
    if (filter === 'dm') return items.filter(i => i.type === 'dm');
    if (filter === 'channel') return items.filter(i => i.type === 'channel');
    return items;
  }, [channels, dmRooms, channelLastMessages, unreadCounts, filter]);

  const renderTalkItem = useCallback(({ item }: { item: TalkItem }) => {
    const hasUnread = item.unread > 0;

    const handlePress = () => {
      if (item.type === 'channel' && item.channel) {
        setUnreadCounts(prev => ({ ...prev, [item.channel!.id]: 0 }));
        onSelectChannel(item.channel);
      } else if (item.type === 'dm' && item.partnerId && item.partnerName) {
        onStartDM(item.partnerId, item.partnerName);
      }
    };

    return (
      <View style={[styles.talkRow, hasUnread && styles.talkRowUnread]}>
        <TouchableOpacity
          style={styles.talkRowInner}
          onPress={handlePress}
          activeOpacity={0.6}
        >
          {/* Avatar */}
          <View style={styles.talkAvatarWrap}>
            {item.type === 'channel' ? (
              <View style={styles.channelAvatar}>
                <Text style={styles.channelAvatarText}>#</Text>
              </View>
            ) : item.avatarUrl ? (
              <Image source={{ uri: item.avatarUrl }} style={styles.talkAvatarImg} />
            ) : (
              <View style={styles.talkAvatarPlaceholder}>
                <Text style={styles.talkAvatarInitial}>{item.avatarInitial}</Text>
              </View>
            )}
          </View>

          {/* Content */}
          <View style={styles.talkContent}>
            <View style={styles.talkTopRow}>
              <Text style={[styles.talkName, hasUnread && styles.talkNameUnread]} numberOfLines={1}>
                {item.displayName}
              </Text>
              {item.lastAt ? (
                <Text style={[styles.talkTime, hasUnread && styles.talkTimeUnread]}>
                  {formatTime(item.lastAt)}
                </Text>
              ) : null}
            </View>
            <View style={styles.talkBottomRow}>
              <Text style={[styles.talkPreview, hasUnread && styles.talkPreviewUnread]} numberOfLines={1}>
                {item.lastMessage || (item.type === 'channel' ? 'メッセージなし' : '')}
              </Text>
              {hasUnread && (
                <View style={styles.talkBadge}>
                  <Text style={styles.talkBadgeText}>
                    {item.unread > 99 ? '99+' : item.unread}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </TouchableOpacity>

        {/* Admin delete button for channels */}
        {isAdmin && item.type === 'channel' && item.channel && (
          <TouchableOpacity style={styles.deleteBtn} onPress={() => deleteChannel(item.channel!)}>
            <Text style={styles.deleteBtnText}>🗑</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }, [isAdmin, onSelectChannel, onStartDM]);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onShowProfile}>
          {myAvatarUrl ? (
            <Image source={{ uri: myAvatarUrl }} style={styles.myAvatar} />
          ) : (
            <View style={styles.myAvatarPlaceholder}>
              <Text style={styles.myAvatarText}>{myName.charAt(0).toUpperCase()}</Text>
            </View>
          )}
        </TouchableOpacity>
        <Text style={styles.title}>トーク</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={onShowSearch} style={styles.headerIcon}>
            <Text style={styles.headerIconText}>🔍</Text>
          </TouchableOpacity>
          {isAdmin && (
            <TouchableOpacity onPress={openCreateModal} style={styles.headerIcon}>
              <Text style={styles.headerIconText}>✏️</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Admin bar */}
      {isAdmin && (
        <TouchableOpacity style={styles.adminBar} onPress={onShowAdmin}>
          <Text style={styles.adminBarText}>管理者パネル →</Text>
          {pendingCount > 0 && (
            <View style={styles.pendingBadge}>
              <Text style={styles.pendingBadgeText}>承認待ち {pendingCount}件</Text>
            </View>
          )}
        </TouchableOpacity>
      )}

      {/* Quick menu icons */}
      <View style={styles.quickMenu}>
        <TouchableOpacity style={styles.quickItem} onPress={onShowProfile}>
          <View style={styles.quickIconWrap}><Text style={styles.quickIcon}>👤</Text></View>
          <Text style={styles.quickLabel}>プロフィール</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickItem} onPress={onShowMembers}>
          <View style={styles.quickIconWrap}><Text style={styles.quickIcon}>👥</Text></View>
          <Text style={styles.quickLabel}>メンバー</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickItem} onPress={onShowNotifications}>
          <View style={styles.quickIconWrap}><Text style={styles.quickIcon}>🔔</Text></View>
          <Text style={styles.quickLabel}>通知</Text>
        </TouchableOpacity>
        {(employmentType === '社員' || employmentType === 'プランナー') && (
          <TouchableOpacity style={styles.quickItem} onPress={onShowBusiness}>
            <View style={styles.quickIconWrap}><Text style={styles.quickIcon}>💼</Text></View>
            <Text style={styles.quickLabel}>業務</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.quickItem} onPress={onLogout}>
          <View style={[styles.quickIconWrap, { backgroundColor: '#f5f5f5' }]}><Text style={styles.quickIcon}>🚪</Text></View>
          <Text style={styles.quickLabel}>ログアウト</Text>
        </TouchableOpacity>
      </View>

      {/* Filter tabs */}
      <View style={styles.filterBar}>
        {([['all', 'すべて'], ['dm', 'DM'], ['channel', 'チャンネル']] as const).map(([key, label]) => (
          <TouchableOpacity
            key={key}
            style={[styles.filterTab, filter === key && styles.filterTabActive]}
            onPress={() => setFilter(key)}
          >
            <Text style={[styles.filterTabText, filter === key && styles.filterTabTextActive]}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Unified talk list */}
      <FlatList
        data={talkItems}
        keyExtractor={(item) => item.key}
        renderItem={renderTalkItem}
        style={styles.talkList}
        contentContainerStyle={talkItems.length === 0 ? styles.emptyContainer : undefined}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyIcon}>💬</Text>
            <Text style={styles.emptyText}>トークがまだありません</Text>
          </View>
        }
      />

      {/* Create channel modal */}
      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>新しいチャンネルを作成</Text>
            <TextInput style={styles.modalInput} value={newChannelName} onChangeText={setNewChannelName} placeholder="チャンネル名" autoCapitalize="none" autoFocus />

            <Text style={styles.memberSectionTitle}>メンバーを選択（{selectedMemberIds.size}人）</Text>
            <TouchableOpacity style={styles.selectAllBtn} onPress={() => {
              if (selectedMemberIds.size === allMembers.length) setSelectedMemberIds(new Set());
              else setSelectedMemberIds(new Set(allMembers.map(m => m.id)));
            }}>
              <Text style={styles.selectAllText}>{selectedMemberIds.size === allMembers.length ? '全解除' : '全選択'}</Text>
            </TouchableOpacity>
            <FlatList
              data={allMembers}
              keyExtractor={(m) => m.id}
              style={styles.memberList}
              renderItem={({ item: m }) => {
                const selected = selectedMemberIds.has(m.id);
                return (
                  <TouchableOpacity style={styles.memberRow} onPress={() => toggleMember(m.id)}>
                    <View style={[styles.checkbox, selected && styles.checkboxChecked]}>
                      {selected && <Text style={styles.checkmark}>✓</Text>}
                    </View>
                    {m.avatar_url ? (
                      <Image source={{ uri: m.avatar_url }} style={styles.memberAvatar} />
                    ) : (
                      <View style={styles.memberAvatarPlaceholder}>
                        <Text style={styles.memberAvatarInitial}>{m.display_name.charAt(0)}</Text>
                      </View>
                    )}
                    <Text style={styles.memberName}>{m.display_name}</Text>
                    {m.id === currentUserId && <Text style={styles.youLabel}>自分</Text>}
                  </TouchableOpacity>
                );
              }}
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => { setModalVisible(false); setNewChannelName(''); setSelectedMemberIds(new Set()); }}>
                <Text style={styles.cancelButtonText}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.createButton, creating && { opacity: 0.6 }]} onPress={createChannel} disabled={creating}>
                <Text style={styles.createButtonText}>{creating ? '作成中...' : '作成'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 48, paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  myAvatar: { width: 34, height: 34, borderRadius: 17 },
  myAvatarPlaceholder: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: '#1A3C8F', alignItems: 'center', justifyContent: 'center',
  },
  myAvatarText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  title: {
    flex: 1, fontSize: 20, fontWeight: '800', color: '#111',
    marginLeft: 12,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerIcon: { padding: 8 },
  headerIconText: { fontSize: 20 },

  // Admin bar
  adminBar: {
    backgroundColor: '#1a1a2e', paddingVertical: 8, paddingHorizontal: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
  },
  adminBarText: { fontSize: 13, color: '#FFA500', fontWeight: '600' },
  pendingBadge: { backgroundColor: '#FF3B30', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, marginLeft: 10 },
  pendingBadgeText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },

  // Quick menu
  quickMenu: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 12, paddingHorizontal: 8,
    borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
    gap: 4,
  },
  quickItem: { alignItems: 'center', flex: 1, maxWidth: 72 },
  quickIconWrap: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#EDF2FF', alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  quickIcon: { fontSize: 20 },
  quickLabel: { fontSize: 10, color: '#666', textAlign: 'center' },

  // Filter tabs
  filterBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
    gap: 8,
  },
  filterTab: {
    paddingHorizontal: 16, paddingVertical: 6,
    borderRadius: 20, backgroundColor: '#f0f0f0',
  },
  filterTabActive: {
    backgroundColor: '#1A3C8F',
  },
  filterTabText: {
    fontSize: 13, fontWeight: '600', color: '#888',
  },
  filterTabTextActive: {
    color: '#fff',
  },

  // Talk list
  talkList: { flex: 1 },
  talkRow: {
    flexDirection: 'row', alignItems: 'center',
    borderBottomWidth: 0.5, borderBottomColor: '#f0f0f0',
  },
  talkRowInner: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    paddingVertical: 14, paddingHorizontal: 16,
  },
  deleteBtn: {
    paddingHorizontal: 14, paddingVertical: 14,
    justifyContent: 'center', alignItems: 'center',
  },
  deleteBtnText: { fontSize: 18 },
  talkRowUnread: {
    backgroundColor: '#FAFCFF',
  },

  // Avatar
  talkAvatarWrap: { marginRight: 14 },
  channelAvatar: {
    width: 50, height: 50, borderRadius: 16,
    backgroundColor: '#1A3C8F', alignItems: 'center', justifyContent: 'center',
  },
  channelAvatarText: { color: '#fff', fontSize: 22, fontWeight: 'bold' },
  talkAvatarImg: { width: 50, height: 50, borderRadius: 25 },
  talkAvatarPlaceholder: {
    width: 50, height: 50, borderRadius: 25,
    backgroundColor: '#6B8DD6', alignItems: 'center', justifyContent: 'center',
  },
  talkAvatarInitial: { color: '#fff', fontSize: 20, fontWeight: 'bold' },

  // Content
  talkContent: { flex: 1, justifyContent: 'center' },
  talkTopRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  talkName: { flex: 1, fontSize: 15, color: '#333', fontWeight: '500' },
  talkNameUnread: { fontWeight: '700', color: '#111' },
  talkTime: { fontSize: 11, color: '#bbb', marginLeft: 8 },
  talkTimeUnread: { color: '#1A3C8F' },
  talkBottomRow: { flexDirection: 'row', alignItems: 'center' },
  talkPreview: { flex: 1, fontSize: 13, color: '#999', lineHeight: 18 },
  talkPreviewUnread: { color: '#666' },

  // Badge
  talkBadge: {
    backgroundColor: '#FF3B30', borderRadius: 11, minWidth: 22, height: 22,
    paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center',
    marginLeft: 8,
  },
  talkBadgeText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },

  // Empty state
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyWrap: { alignItems: 'center', paddingVertical: 60 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 15, color: '#999' },

  // Member selection in modal
  memberSectionTitle: { fontSize: 13, fontWeight: '600', color: '#555', marginBottom: 6 },
  selectAllBtn: { alignSelf: 'flex-end', marginBottom: 8 },
  selectAllText: { fontSize: 13, color: '#1A3C8F', fontWeight: '600' },
  memberList: { maxHeight: 260, marginBottom: 16, borderWidth: 1, borderColor: '#eee', borderRadius: 10 },
  memberRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 0.5, borderBottomColor: '#f0f0f0' },
  checkbox: { width: 22, height: 22, borderRadius: 4, borderWidth: 2, borderColor: '#ccc', marginRight: 10, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: '#1A3C8F', borderColor: '#1A3C8F' },
  checkmark: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  memberAvatar: { width: 32, height: 32, borderRadius: 16, marginRight: 10 },
  memberAvatarPlaceholder: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#6B8DD6', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  memberAvatarInitial: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  memberName: { flex: 1, fontSize: 14, color: '#333' },
  youLabel: { fontSize: 11, color: '#999', marginLeft: 4 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#333', marginBottom: 16 },
  modalInput: { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 14, fontSize: 15, marginBottom: 20 },
  modalButtons: { flexDirection: 'row', gap: 12 },
  cancelButton: { flex: 1, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#ddd', alignItems: 'center' },
  cancelButtonText: { fontSize: 15, color: '#666' },
  createButton: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#1A3C8F', alignItems: 'center' },
  createButtonText: { fontSize: 15, color: '#fff', fontWeight: 'bold' },
});
