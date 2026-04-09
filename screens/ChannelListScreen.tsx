import React, { useState, useEffect } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, TextInput, Alert, Modal, Image,
} from 'react-native';
import { supabase } from '../lib/supabase';

type Channel = { id: string; name: string; created_by: string | null };

type DMRoom = {
  partner_id: string;
  partner_name: string;
  partner_avatar: string | null;
  last_message: string;
  last_at: string;
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

export default function ChannelListScreen({ onSelectChannel, onShowMembers, onShowSearch, onShowProfile, onShowNotifications, onShowAdmin, onShowSchedule, onShowBusiness, onStartDM, onLogout, isAdmin, isSuperAdmin, currentUserId, employmentType }: Props) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [myAvatarUrl, setMyAvatarUrl] = useState<string | null>(null);
  const [myName, setMyName] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [creating, setCreating] = useState(false);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [dmRooms, setDmRooms] = useState<DMRoom[]>([]);

  useEffect(() => {
    fetchChannels();
    if (currentUserId) {
      fetchMyProfile();
      fetchUnreadCounts();
      fetchDmRooms();
    }
    const subscription = supabase
      .channel('channels-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'channels' }, () => fetchChannels())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'channel_members' }, () => fetchChannels())
      .subscribe();
    const initTimer = setTimeout(() => {
      if (currentUserId) fetchUnreadCounts();
    }, 600);
    const timer = setInterval(() => {
      if (currentUserId) fetchUnreadCounts();
    }, 15000);
    return () => {
      supabase.removeChannel(subscription);
      clearTimeout(initTimer);
      clearInterval(timer);
    };
  }, [currentUserId]);

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

  const fetchChannels = async () => {
    const { data, error } = await supabase.from('channels').select('id, name, created_by').order('created_at', { ascending: true });
    if (error) { console.log('fetchChannels error:', error.message); return; }
    if (data) setChannels(data as Channel[]);
  };

  const fetchDmRooms = async () => {
    if (!currentUserId) return;
    // 自分が送信者または受信者のDMを取得
    const { data } = await supabase
      .from('direct_messages')
      .select('*')
      .or(`sender_id.eq.${currentUserId},receiver_id.eq.${currentUserId}`)
      .order('created_at', { ascending: false });
    if (!data || data.length === 0) { setDmRooms([]); return; }
    // パートナーごとにグループ化して最新メッセージを取得
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
    // パートナーのプロフィールを取得
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
    setCreating(true);
    const { data: newChannel, error } = await supabase.from('channels').insert({ name, created_by: currentUserId }).select().single();
    if (error) { alert(error.message); setCreating(false); return; }
    if (newChannel) await supabase.from('channel_members').insert({ channel_id: newChannel.id, user_id: currentUserId });
    setNewChannelName('');
    setModalVisible(false);
    setCreating(false);
    await fetchChannels();
  };

  const deleteChannel = async (channel: Channel) => {
    const ok = window.confirm?.(`# ${channel.name} を削除しますか？\nこのチャンネルとすべてのメッセージが削除されます。`);
    if (!ok) return;
    await supabase.from('messages').delete().eq('channel_id', channel.id);
    await supabase.from('channel_members').delete().eq('channel_id', channel.id);
    await supabase.from('channels').delete().eq('id', channel.id);
    await fetchChannels();
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.profileButton} onPress={onShowProfile}>
          {myAvatarUrl ? (
            <Image source={{ uri: myAvatarUrl }} style={styles.myAvatar} />
          ) : (
            <View style={styles.myAvatarPlaceholder}>
              <Text style={styles.myAvatarText}>{myName.charAt(0).toUpperCase()}</Text>
            </View>
          )}
        </TouchableOpacity>
        <Text style={styles.title}>NexPort</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={onShowSearch} style={styles.iconButton}>
            <Text style={styles.iconText}>🔍</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onLogout}>
            <Text style={styles.logout}>ログアウト</Text>
          </TouchableOpacity>
        </View>
      </View>

      {isAdmin && (
        <TouchableOpacity style={styles.adminBar} onPress={onShowAdmin}>
          <Text style={styles.adminBarText}>👑 管理者パネルを開く →</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.menuItem} onPress={onShowProfile}>
        <Text style={styles.menuIcon}>👤</Text>
        <Text style={styles.menuText}>プロフィール編集</Text>
        <Text style={styles.arrow}>›</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.menuItem, { backgroundColor: '#EFF6FF' }]} onPress={onShowNotifications}>
        <Text style={styles.menuIcon}>🔔</Text>
        <Text style={styles.menuText}>通知設定</Text>
        <Text style={styles.arrow}>›</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.menuItem, { backgroundColor: '#f0fff4' }]} onPress={onShowMembers}>
        <Text style={styles.menuIcon}>👥</Text>
        <Text style={styles.menuText}>メンバー一覧</Text>
        <Text style={styles.arrow}>›</Text>
      </TouchableOpacity>

      {employmentType === '社員' && (
        <TouchableOpacity style={[styles.menuItem, { backgroundColor: '#f0f4ff' }]} onPress={onShowBusiness}>
          <Text style={styles.menuIcon}>💼</Text>
          <Text style={styles.menuText}>業務管理</Text>
          <Text style={styles.arrow}>›</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={[styles.menuItem, { backgroundColor: '#f8f8ff' }]} onPress={onShowSearch}>
        <Text style={styles.menuIcon}>🔍</Text>
        <Text style={styles.menuText}>メッセージを検索</Text>
        <Text style={styles.arrow}>›</Text>
      </TouchableOpacity>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionLabel}>チャンネル（メンバー制）</Text>
        {isAdmin && (
          <TouchableOpacity style={styles.addButton} onPress={() => setModalVisible(true)}>
            <Text style={styles.addButtonText}>+ 追加</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={channels}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const unread = unreadCounts[item.id] ?? 0;
          return (
            <View style={styles.channelRow}>
              <TouchableOpacity style={styles.channelItem} onPress={() => {
                setUnreadCounts(prev => ({ ...prev, [item.id]: 0 }));
                onSelectChannel(item);
              }}>
                <Text style={styles.channelHash}>🔒</Text>
                <Text style={[styles.channelName, unread > 0 && styles.channelNameUnread]}>
                  {item.name}
                </Text>
                {unread > 0 && (
                  <View style={styles.unreadBadge}>
                    <Text style={styles.unreadBadgeText}>{unread > 99 ? '99+' : unread}</Text>
                  </View>
                )}
              </TouchableOpacity>
              {isAdmin && (
                <TouchableOpacity style={styles.deleteButton} onPress={() => deleteChannel(item)}>
                  <Text style={styles.deleteIcon}>🗑</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        }}
      />

      {/* DM履歴 */}
      {dmRooms.length > 0 && (
        <>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionLabel}>ダイレクトメッセージ</Text>
          </View>
          {dmRooms.map(room => (
            <TouchableOpacity key={room.partner_id} style={styles.dmRow} onPress={() => onStartDM(room.partner_id, room.partner_name)}>
              <View style={styles.dmAvatar}>
                {room.partner_avatar ? (
                  <Image source={{ uri: room.partner_avatar }} style={styles.dmAvatarImg} />
                ) : (
                  <View style={styles.dmAvatarPlaceholder}>
                    <Text style={styles.dmAvatarText}>{room.partner_name.charAt(0)}</Text>
                  </View>
                )}
              </View>
              <View style={styles.dmInfo}>
                <Text style={[styles.dmName, room.unread > 0 && { fontWeight: 'bold', color: '#111' }]}>{room.partner_name}</Text>
                <Text style={styles.dmLastMsg} numberOfLines={1}>{room.last_message}</Text>
              </View>
              <View style={styles.dmRight}>
                <Text style={styles.dmTime}>{room.last_at.slice(5, 16).replace('T', ' ')}</Text>
                {room.unread > 0 && (
                  <View style={styles.dmUnread}>
                    <Text style={styles.dmUnreadText}>{room.unread > 99 ? '99+' : room.unread}</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          ))}
        </>
      )}

      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>新しいチャンネルを作成</Text>
            <TextInput style={styles.modalInput} value={newChannelName} onChangeText={setNewChannelName} placeholder="チャンネル名" autoCapitalize="none" autoFocus />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => { setModalVisible(false); setNewChannelName(''); }}>
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
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, paddingTop: 48, borderBottomWidth: 1, borderBottomColor: '#eee', gap: 10 },
  profileButton: {},
  myAvatar: { width: 36, height: 36, borderRadius: 18 },
  myAvatarPlaceholder: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1A3C8F', alignItems: 'center', justifyContent: 'center' },
  myAvatarText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  title: { flex: 1, fontSize: 22, fontWeight: '900', color: '#1A3C8F', letterSpacing: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconButton: { padding: 4 },
  iconText: { fontSize: 20 },
  logout: { color: '#999', fontSize: 13 },
  adminBar: { backgroundColor: '#1a1a2e', padding: 12, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#333' },
  adminBarText: { fontSize: 14, color: '#FFA500', fontWeight: 'bold' },
  menuItem: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#eee', backgroundColor: '#fafafa' },
  menuIcon: { fontSize: 18, marginRight: 10 },
  menuText: { flex: 1, fontSize: 15, color: '#333', fontWeight: '500' },
  arrow: { fontSize: 20, color: '#ccc' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#f8f8f8', borderBottomWidth: 1, borderBottomColor: '#eee' },
  sectionLabel: { fontSize: 12, color: '#999', fontWeight: '600' },
  addButton: { backgroundColor: '#1A3C8F', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  addButtonText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  channelRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  channelItem: { flex: 1, flexDirection: 'row', alignItems: 'center', padding: 16 },
  channelHash: { fontSize: 18, marginRight: 8 },
  channelName: { flex: 1, fontSize: 16, color: '#333' },
  channelNameUnread: { fontWeight: 'bold', color: '#111' },
  unreadBadge: { backgroundColor: '#1A3C8F', borderRadius: 10, minWidth: 20, height: 20, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  unreadBadgeText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  deleteButton: { paddingHorizontal: 16, paddingVertical: 12 },
  deleteIcon: { fontSize: 18 },
  // DM rooms
  dmRow: { flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0', gap: 10 },
  dmAvatar: {},
  dmAvatarImg: { width: 42, height: 42, borderRadius: 21 },
  dmAvatarPlaceholder: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#1A3C8F', alignItems: 'center', justifyContent: 'center' },
  dmAvatarText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  dmInfo: { flex: 1 },
  dmName: { fontSize: 15, color: '#333', fontWeight: '500' },
  dmLastMsg: { fontSize: 12, color: '#999', marginTop: 2 },
  dmRight: { alignItems: 'flex-end', gap: 4 },
  dmTime: { fontSize: 10, color: '#999' },
  dmUnread: { backgroundColor: '#1A3C8F', borderRadius: 10, minWidth: 20, height: 20, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  dmUnreadText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
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