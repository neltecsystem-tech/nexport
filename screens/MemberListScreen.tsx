import React, { useState, useEffect } from 'react';
import {
  View, Text, FlatList, StyleSheet,
  TouchableOpacity, Modal, Image, ScrollView, Linking,
} from 'react-native';
import { supabase } from '../lib/supabase';

type Member = {
  id: string;
  display_name: string;
  status: string;
  role: string;
  phone: string | null;
  bio: string | null;
  avatar_url: string | null;
  company: string | null;
  site: string | null;
  employment_type: string | null;
  position: string | null;
};

type Props = {
  onBack: () => void;
  onStartDM: (partnerId: string, partnerName: string) => void;
  currentUserId: string | null;
};

export default function MemberListScreen({ onBack, onStartDM, currentUserId }: Props) {
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);

  useEffect(() => {
    fetchMembers();
    const subscription = supabase
      .channel('profiles-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => fetchMembers())
      .subscribe();
    return () => { supabase.removeChannel(subscription); };
  }, []);

  const fetchMembers = async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, display_name, status, role, phone, bio, avatar_url, company, site, employment_type, position')
      .order('display_name', { ascending: true });
    if (error) { console.log('fetchMembers error:', error.message); return; }
    if (data) setMembers(data as Member[]);
  };


  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return '#1A3C8F';
      case 'away': return '#FFA500';
      default: return '#999';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'online': return 'オンライン';
      case 'away': return '離席中';
      default: return 'オフライン';
    }
  };

  const renderMember = ({ item }: { item: Member }) => {
    const isMe = item.id === currentUserId;
    return (
      <TouchableOpacity style={styles.memberItem} onPress={() => setSelectedMember(item)}>
        <View style={styles.avatarContainer}>
          {item.avatar_url ? (
            <Image source={{ uri: item.avatar_url }} style={styles.avatarImage} />
          ) : (
            <View style={[styles.avatar, item.role === 'admin' && styles.avatarAdmin]}>
              <Text style={styles.avatarText}>{item.display_name.charAt(0).toUpperCase()}</Text>
            </View>
          )}
          <View style={[styles.statusDot, { backgroundColor: getStatusColor(item.status) }]} />
        </View>

        <View style={styles.memberInfo}>
          <View style={styles.nameRow}>
            <Text style={styles.memberName}>{item.display_name}</Text>
            {item.role === 'admin' && (
              <View style={styles.roleBadge}>
                <Text style={styles.roleBadgeText}>管理者</Text>
              </View>
            )}
            {item.employment_type && (
              <View style={[styles.empBadge, item.employment_type === '社員' ? styles.empBadgeEmployee : item.employment_type === 'プランナー' ? styles.empBadgePlanner : styles.empBadgeContract]}>
                <Text style={styles.empBadgeText}>{item.employment_type}</Text>
              </View>
            )}
            {isMe && <Text style={styles.meLabel}> (自分)</Text>}
          </View>
          <Text style={[styles.memberStatus, { color: getStatusColor(item.status) }]}>
            {getStatusLabel(item.status)}
          </Text>
          {(item.position && item.employment_type === '社員') && (
            <Text style={styles.memberSub}>{item.position}</Text>
          )}
          {(item.company || item.site) && (
            <Text style={styles.memberSub} numberOfLines={1}>
              {[item.company, item.site].filter(Boolean).join(' · ')}
            </Text>
          )}
        </View>

        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.back}>← 戻る</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>メンバー一覧</Text>
        <View style={{ width: 60 }} />
      </View>

      <Text style={styles.countText}>{members.length}人のメンバー　※タップでプロフィール確認</Text>

      <FlatList
        data={members}
        keyExtractor={(item) => item.id}
        renderItem={renderMember}
        contentContainerStyle={styles.list}
      />

      {/* プロフィールモーダル */}
      <Modal visible={!!selectedMember} transparent animationType="slide" onRequestClose={() => setSelectedMember(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <TouchableOpacity style={styles.modalClose} onPress={() => setSelectedMember(null)}>
              <Text style={styles.modalCloseText}>✕</Text>
            </TouchableOpacity>

            {selectedMember && (
              <ScrollView showsVerticalScrollIndicator={false}>
                {/* アバター */}
                <View style={styles.profileHeader}>
                  {selectedMember.avatar_url ? (
                    <Image source={{ uri: selectedMember.avatar_url }} style={styles.profileAvatar} />
                  ) : (
                    <View style={[styles.profileAvatarPlaceholder, selectedMember.role === 'admin' && styles.profileAvatarAdmin]}>
                      <Text style={styles.profileAvatarText}>
                        {selectedMember.display_name.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <View style={[styles.profileStatusDot, { backgroundColor: getStatusColor(selectedMember.status) }]} />
                </View>

                {/* 名前・役職 */}
                <Text style={styles.profileName}>{selectedMember.display_name}</Text>
                <View style={styles.profileBadgeRow}>
                  {selectedMember.role === 'admin' && (
                    <View style={styles.profileRoleBadge}>
                      <Text style={styles.profileRoleBadgeText}>👑 管理者</Text>
                    </View>
                  )}
                  <View style={[styles.profileStatusBadge, { backgroundColor: getStatusColor(selectedMember.status) + '22' }]}>
                    <Text style={[styles.profileStatusText, { color: getStatusColor(selectedMember.status) }]}>
                      ● {getStatusLabel(selectedMember.status)}
                    </Text>
                  </View>
                </View>

                {/* 詳細情報 */}
                <View style={styles.profileDetails}>
                  {selectedMember.employment_type && (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>👔 雇用形態</Text>
                      <View style={styles.detailValueRow}>
                        <View style={[styles.empBadge, selectedMember.employment_type === '社員' ? styles.empBadgeEmployee : selectedMember.employment_type === 'プランナー' ? styles.empBadgePlanner : styles.empBadgeContract]}>
                          <Text style={styles.empBadgeText}>{selectedMember.employment_type}</Text>
                        </View>
                        {selectedMember.employment_type === '社員' && selectedMember.position && (
                          <Text style={styles.detailValue}>{selectedMember.position}</Text>
                        )}
                      </View>
                    </View>
                  )}
                  {selectedMember.company && (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>🏢 所属会社</Text>
                      <Text style={styles.detailValue}>{selectedMember.company}</Text>
                    </View>
                  )}
                  {selectedMember.site && (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>📍 所属現場</Text>
                      <Text style={styles.detailValue}>{selectedMember.site}</Text>
                    </View>
                  )}
                  {selectedMember.phone && (
                    <TouchableOpacity style={styles.detailRow} onPress={() => Linking.openURL(`tel:${selectedMember.phone!.replace(/[-\s]/g, '')}`)}>
                      <Text style={styles.detailLabel}>📞 電話番号</Text>
                      <Text style={[styles.detailValue, { color: '#1D4ED8', textDecorationLine: 'underline' }]}>{selectedMember.phone}</Text>
                    </TouchableOpacity>
                  )}
                  {selectedMember.bio && (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>自己紹介</Text>
                      <Text style={styles.detailValue}>{selectedMember.bio}</Text>
                    </View>
                  )}
                  {!selectedMember.company && !selectedMember.site && !selectedMember.bio && !selectedMember.phone && (
                    <Text style={styles.noInfo}>プロフィール情報がまだ設定されていません</Text>
                  )}
                </View>

                {/* アクションボタン */}
                {selectedMember.id !== currentUserId && (
                  <TouchableOpacity
                    style={styles.dmButton}
                    onPress={() => {
                      setSelectedMember(null);
                      onStartDM(selectedMember.id, selectedMember.display_name);
                    }}
                  >
                    <Text style={styles.dmButtonText}>💬 DMを送る</Text>
                  </TouchableOpacity>
                )}

              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, paddingTop: 48, borderBottomWidth: 1, borderBottomColor: '#eee',
  },
  back: { color: '#1A3C8F', fontSize: 16, width: 60 },
  headerTitle: { fontSize: 16, fontWeight: 'bold', color: '#333' },
  countText: { fontSize: 13, color: '#999', paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#f8f8f8', borderBottomWidth: 1, borderBottomColor: '#eee' },
  list: { paddingBottom: 20 },
  memberItem: { flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  avatarContainer: { position: 'relative', marginRight: 12 },
  avatarImage: { width: 48, height: 48, borderRadius: 24 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#1A3C8F', alignItems: 'center', justifyContent: 'center' },
  avatarAdmin: { backgroundColor: '#FFA500' },
  avatarText: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  statusDot: { position: 'absolute', bottom: 0, right: 0, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: '#fff' },
  memberInfo: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  memberName: { fontSize: 15, fontWeight: '500', color: '#333' },
  roleBadge: { backgroundColor: '#FFA500', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 },
  roleBadgeText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  meLabel: { fontSize: 13, color: '#999' },
  memberStatus: { fontSize: 13, marginTop: 2 },
  memberSub: { fontSize: 12, color: '#999', marginTop: 2 },
  memberBio: { fontSize: 12, color: '#999', marginTop: 2 },
  chevron: { fontSize: 20, color: '#ccc', marginLeft: 8 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 48, maxHeight: '85%' },
  modalClose: { alignSelf: 'flex-end', padding: 4, marginBottom: 8 },
  modalCloseText: { fontSize: 18, color: '#999' },
  profileHeader: { alignItems: 'center', position: 'relative', marginBottom: 12 },
  profileAvatar: { width: 90, height: 90, borderRadius: 45 },
  profileAvatarPlaceholder: { width: 90, height: 90, borderRadius: 45, backgroundColor: '#1A3C8F', alignItems: 'center', justifyContent: 'center' },
  profileAvatarAdmin: { backgroundColor: '#FFA500' },
  profileAvatarText: { color: '#fff', fontSize: 36, fontWeight: 'bold' },
  profileStatusDot: { position: 'absolute', bottom: 4, right: '35%', width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: '#fff' },
  profileName: { fontSize: 22, fontWeight: 'bold', color: '#333', textAlign: 'center', marginBottom: 8 },
  profileBadgeRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 20 },
  profileRoleBadge: { backgroundColor: '#FFA500', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 4 },
  profileRoleBadgeText: { color: '#fff', fontSize: 13, fontWeight: 'bold' },
  profileStatusBadge: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 4 },
  profileStatusText: { fontSize: 13, fontWeight: '500' },
  profileDetails: { backgroundColor: '#f8f8f8', borderRadius: 12, padding: 16, marginBottom: 16, gap: 12 },
  detailRow: { gap: 4 },
  detailLabel: { fontSize: 12, color: '#999', fontWeight: '600' },
  detailValue: { fontSize: 15, color: '#333', lineHeight: 22 },
  noInfo: { fontSize: 14, color: '#999', textAlign: 'center', paddingVertical: 8 },
  dmButton: { backgroundColor: '#1A3C8F', borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 12 },
  dmButtonText: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  adminActions: { borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 16 },
  adminActionsTitle: { fontSize: 12, color: '#999', fontWeight: '600', marginBottom: 10 },
  adminButtonRow: { flexDirection: 'row', gap: 10 },
  roleButton: { flex: 1, padding: 12, borderRadius: 10, backgroundColor: '#f0f0f0', alignItems: 'center' },
  roleButtonText: { fontSize: 13, color: '#333', fontWeight: '500' },
  deleteButton: { flex: 1, padding: 12, borderRadius: 10, backgroundColor: '#fff0f0', alignItems: 'center' },
  deleteButtonText: { fontSize: 13, color: '#E24B4A', fontWeight: '500' },
  empBadge: { borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 },
  empBadgeEmployee: { backgroundColor: '#e8f4fd' },
  empBadgeContract: { backgroundColor: '#fff3e0' },
  empBadgePlanner: { backgroundColor: '#f3e8ff' },
  empBadgeText: { fontSize: 10, fontWeight: 'bold', color: '#333' },
  detailValueRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});