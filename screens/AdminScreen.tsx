import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, Alert, Modal, ScrollView, Image, TextInput,
} from 'react-native';
import { supabase } from '../lib/supabase';

type Tab = 'chat_logs' | 'members' | 'pending' | 'admin_settings';

type Message = {
  id: string;
  content: string;
  created_at: string;
  channel_id: string;
  sender_id: string;
  file_type: string | null;
  profiles: { display_name: string } | null;
  channels: { name: string } | null;
};

type Member = {
  id: string;
  display_name: string;
  status: string;
  role: string;
  phone: string | null;
  bio: string | null;
  avatar_url: string | null;
  created_at: string;
  email?: string;
  company: string | null;
  site: string | null;
  employment_type: string | null;
  position: string | null;
};

type Channel = { id: string; name: string };
type DateRange = '1week' | '1month' | '3months' | '6months' | 'custom';
type PendingMember = { id: string; display_name: string; created_at: string; email?: string };

type AdminMember = {
  id: string;
  display_name: string;
  role: 'admin' | 'super_admin';
  avatar_url: string | null;
  created_at: string;
  email?: string;
  employment_type: string | null;
  position: string | null;
  custom_permissions: string[] | null;
};

// 権限定義
const PERMISSION_DEFS: { key: string; label: string; adminOk: boolean; superAdminOk: boolean; category?: string }[] = [
  // チャット・ユーザー管理
  { key: 'approve_user',      label: '新規ユーザーの承認・拒否',       adminOk: true,  superAdminOk: true },
  { key: 'channel_members',   label: 'チャンネルメンバーの追加・削除', adminOk: true,  superAdminOk: true },
  { key: 'edit_profile',      label: 'メンバープロフィール編集',       adminOk: true,  superAdminOk: true },
  { key: 'view_chat_logs',    label: 'チャットログ閲覧・削除',         adminOk: true,  superAdminOk: true },
  { key: 'change_role',       label: '管理者権限の変更',               adminOk: false, superAdminOk: true },
  { key: 'create_channel',    label: 'チャンネルの作成・削除',         adminOk: false, superAdminOk: true },
  { key: 'delete_user',       label: 'アカウントの完全削除',           adminOk: false, superAdminOk: true },
  { key: 'update_credentials',label: 'メール・パスワード変更',         adminOk: false, superAdminOk: true },
  { key: 'create_user',       label: '管理者によるユーザー作成',       adminOk: false, superAdminOk: true },
  // 業務管理
  { key: 'attend_admin',      label: '勤怠管理（管理ページ）',         adminOk: true,  superAdminOk: true, category: '業務管理' },
  { key: 'attend_settings',   label: '勤怠設定（パターン管理）',       adminOk: false, superAdminOk: true, category: '業務管理' },
  { key: 'bulletin_admin',    label: '掲示板管理（ピン留め・削除）',   adminOk: true,  superAdminOk: true, category: '業務管理' },
  { key: 'task_admin',        label: 'タスク管理（全員分）',           adminOk: true,  superAdminOk: true, category: '業務管理' },
  { key: 'schedule_admin',    label: '予定表管理（全員分編集）',       adminOk: true,  superAdminOk: true, category: '業務管理' },
];

type Props = {
  onBack: () => void;
  currentUserId: string | null;
  isSuperAdmin: boolean;
};

const DATE_RANGE_OPTIONS: { label: string; value: DateRange }[] = [
  { label: '1週間', value: '1week' },
  { label: '1ヶ月', value: '1month' },
  { label: '3ヶ月', value: '3months' },
  { label: '6ヶ月', value: '6months' },
  { label: 'カスタム', value: 'custom' },
];

function getFromDate(range: DateRange, customFrom?: string): string {
  if (range === 'custom' && customFrom) return customFrom;
  const now = new Date();
  switch (range) {
    case '1week': now.setDate(now.getDate() - 7); break;
    case '1month': now.setMonth(now.getMonth() - 1); break;
    case '3months': now.setMonth(now.getMonth() - 3); break;
    case '6months': now.setMonth(now.getMonth() - 6); break;
  }
  return now.toISOString();
}

export default function AdminScreen({ onBack, currentUserId, isSuperAdmin }: Props) {
  const [tab, setTab] = useState<Tab>('chat_logs');
  const [pendingMembers, setPendingMembers] = useState<PendingMember[]>([]);

  // チャットログ
  const [messages, setMessages] = useState<Message[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<string>('all');
  const [dateRange, setDateRange] = useState<DateRange>('1month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [showCustomDate, setShowCustomDate] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const PAGE_SIZE = 50;

  // メンバー
  const [members, setMembers] = useState<Member[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [saving, setSaving] = useState(false);
  const [changingRole, setChangingRole] = useState(false);

  // プロフィール編集
  const [editProfileVisible, setEditProfileVisible] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editCompany, setEditCompany] = useState('');
  const [editSite, setEditSite] = useState('');
  const [editEmploymentType, setEditEmploymentType] = useState<string | null>(null);
  const [editPosition, setEditPosition] = useState('');

  // メール変更
  const [editEmailVisible, setEditEmailVisible] = useState(false);
  const [editEmail, setEditEmail] = useState('');

  // パスワード変更
  const [editPasswordVisible, setEditPasswordVisible] = useState(false);
  const [editPassword, setEditPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // ユーザー追加
  const [createUserVisible, setCreateUserVisible] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);

  // 管理者設定
  const [adminList, setAdminList] = useState<AdminMember[]>([]);
  const [loadingAdmins, setLoadingAdmins] = useState(false);
  const [selectedAdmin, setSelectedAdmin] = useState<AdminMember | null>(null);
  const [permModalVisible, setPermModalVisible] = useState(false);
  const [editingPerms, setEditingPerms] = useState(false);
  const [editPerms, setEditPerms] = useState<string[]>([]);
  const [savingPerms, setSavingPerms] = useState(false);

  useEffect(() => { fetchChannels(); }, []);

  useEffect(() => {
    if (tab === 'chat_logs') { setPage(0); setMessages([]); fetchMessages(0); }
    if (tab === 'members') fetchMembers();
    if (tab === 'pending') fetchPendingMembers();
    if (tab === 'admin_settings') fetchAdminList();
  }, [tab, selectedChannel, dateRange]);

  const fetchAdminList = async () => {
    setLoadingAdmins(true);
    const { data } = await supabase
      .from('profiles')
      .select('id, display_name, role, avatar_url, created_at, employment_type, position, custom_permissions')
      .in('role', ['admin', 'super_admin'])
      .order('role', { ascending: false })
      .order('display_name');
    if (!data) { setLoadingAdmins(false); return; }
    const withEmails = await Promise.all((data as AdminMember[]).map(async (m) => {
      try {
        const r = await callAdminApi('get_user_email', { user_id: m.id });
        return { ...m, email: r.email };
      } catch { return m; }
    }));
    setAdminList(withEmails as AdminMember[]);
    setLoadingAdmins(false);
  };

  const demoteToMember = async (admin: AdminMember) => {
    if (!isSuperAdmin) return;
    if (!window.confirm(`${admin.display_name} を一般メンバーに降格しますか？`)) return;
    try {
      await callAdminApi('set_role', { user_id: admin.id, role: 'member' });
      await logAdminAction('change_role', 'member', admin.id, `${admin.display_name}: ${admin.role} → member`);
      setAdminList(prev => prev.filter(a => a.id !== admin.id));
      setSelectedAdmin(null);
      setPermModalVisible(false);
    } catch (e: any) { alert('エラー: ' + e.message); }
  };

  const promoteToSuperAdmin = async (admin: AdminMember) => {
    if (!isSuperAdmin) return;
    if (!window.confirm(`${admin.display_name} を最高管理者に昇格しますか？\n自分の最高管理者権限は失われます。`)) return;
    try {
      await callAdminApi('set_role', { user_id: currentUserId!, role: 'member' });
      await callAdminApi('promote_super_admin', { user_id: admin.id });
      await logAdminAction('change_role', 'member', admin.id, `${admin.display_name}: admin → super_admin`);
      alert('昇格しました。再ログインしてください。');
      setPermModalVisible(false);
    } catch (e: any) { alert('エラー: ' + e.message); }
  };

  // 権限の実効値を計算（カスタム設定があればそれを使い、なければロールデフォルト）
  const getEffectivePerms = (admin: AdminMember): string[] => {
    if (admin.role === 'super_admin') return PERMISSION_DEFS.map(p => p.key);
    if (admin.custom_permissions && admin.custom_permissions.length > 0) return admin.custom_permissions;
    return PERMISSION_DEFS.filter(p => p.adminOk).map(p => p.key);
  };

  const startEditPerms = (admin: AdminMember) => {
    setEditPerms(getEffectivePerms(admin));
    setEditingPerms(true);
  };

  const togglePerm = (key: string) => {
    setEditPerms(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const savePerms = async () => {
    if (!selectedAdmin) return;
    setSavingPerms(true);
    try {
      await callAdminApi('update_permissions', { user_id: selectedAdmin.id, custom_permissions: editPerms });
      const updated = { ...selectedAdmin, custom_permissions: editPerms };
      setAdminList(prev => prev.map(a => a.id === selectedAdmin.id ? updated : a));
      setSelectedAdmin(updated);
      setEditingPerms(false);
      alert('保存しました');
    } catch (e: any) { alert('エラー: ' + e.message); }
    setSavingPerms(false);
  };

  const resetPermsToDefault = async () => {
    if (!selectedAdmin) return;
    setSavingPerms(true);
    try {
      await callAdminApi('update_permissions', { user_id: selectedAdmin.id, custom_permissions: [] });
      const updated = { ...selectedAdmin, custom_permissions: [] };
      setAdminList(prev => prev.map(a => a.id === selectedAdmin.id ? updated : a));
      setSelectedAdmin(updated);
      setEditingPerms(false);
      alert('デフォルトに戻しました');
    } catch (e: any) { alert('エラー: ' + e.message); }
    setSavingPerms(false);
  };

  const fetchPendingMembers = async () => {
    const { data } = await supabase
      .from('profiles')
      .select('id, display_name, created_at')
      .eq('account_status', 'pending_approval')
      .order('created_at', { ascending: true });
    if (!data) return;
    const withEmails = await Promise.all(data.map(async (m) => {
      try {
        const result = await callAdminApi('get_user_email', { user_id: m.id });
        return { ...m, email: result.email };
      } catch { return m; }
    }));
    setPendingMembers(withEmails as PendingMember[]);
  };

  const approveUser = async (member: PendingMember) => {
    try {
      await callAdminApi('approve_user', { user_id: member.id });
      await logAdminAction('approve_user', 'member', member.id, member.display_name);
      setPendingMembers(prev => prev.filter(m => m.id !== member.id));
      alert('承認しました');
    } catch (e: any) { alert('エラー: ' + e.message); }
  };

  const rejectUser = async (member: PendingMember) => {
    if (!window.confirm(`${member.display_name} を拒否してアカウントを削除しますか？`)) return;
    try {
      await callAdminApi('reject_user', { user_id: member.id });
      await logAdminAction('reject_user', 'member', member.id, member.display_name);
      setPendingMembers(prev => prev.filter(m => m.id !== member.id));
      alert('拒否しました');
    } catch (e: any) { alert('エラー: ' + e.message); }
  };

  const fetchChannels = async () => {
    const { data } = await supabase.from('channels').select('id, name').order('name');
    if (data) setChannels(data as Channel[]);
  };

  const fetchMessages = useCallback(async (pageNum: number) => {
    setLoadingLogs(true);
    const from = getFromDate(dateRange, customFrom || undefined);
    const to = (dateRange === 'custom' && customTo) ? new Date(customTo).toISOString() : new Date().toISOString();
    const offset = pageNum * PAGE_SIZE;
    let query = supabase
      .from('messages')
      .select('id, content, created_at, channel_id, sender_id, file_type, profiles!messages_sender_id_fkey(display_name), channels(name)', { count: 'exact' })
      .gte('created_at', from).lte('created_at', to)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (selectedChannel !== 'all') query = query.eq('channel_id', selectedChannel);
    const { data, error, count } = await query;
    if (error) console.log('fetchMessages error:', error.message);
    if (data) {
      if (pageNum === 0) setMessages(data as unknown as Message[]);
      else setMessages(prev => [...prev, ...data as unknown as Message[]]);
      setTotalCount(count ?? 0);
      setHasMore((offset + PAGE_SIZE) < (count ?? 0));
    }
    setLoadingLogs(false);
  }, [selectedChannel, dateRange, customFrom, customTo]);

  const loadMore = () => {
    if (!hasMore || loadingLogs) return;
    const nextPage = page + 1;
    setPage(nextPage);
    fetchMessages(nextPage);
  };

  const applyCustomDate = () => {
    setShowCustomDate(false); setPage(0); setMessages([]); fetchMessages(0);
  };

  const fetchMembers = async () => {
    setLoadingMembers(true);
    const { data } = await supabase
      .from('profiles')
      .select('id, display_name, status, role, phone, bio, avatar_url, created_at, company, site, employment_type, position')
      .order('created_at', { ascending: false });
    if (data) setMembers(data as Member[]);
    setLoadingMembers(false);
  };

  const logAdminAction = async (action: string, targetType: string, targetId: string, detail: string) => {
    try {
      await supabase.from('admin_logs').insert({
        admin_id: currentUserId, action, target_type: targetType, target_id: targetId, detail,
      });
    } catch (_) {}
  };

  // Edge Function呼び出し（セッショントークンを明示的に付与）
  const callAdminApi = async (action: string, params: Record<string, any>) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('ログインが必要です');
    const resp = await fetch('https://nccognptoprhwsbjnwcu.supabase.co/functions/v1/admin-user-ops', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action, ...params }),
    });
    const data = await resp.json();
    if (data?.error) throw new Error(data.error);
    return data;
  };

  // メンバー詳細を開く（メールアドレスも取得）
  const openMemberDetail = async (member: Member) => {
    setSelectedMember(member);
    try {
      const result = await callAdminApi('get_user_email', { user_id: member.id });
      setSelectedMember(prev => prev ? { ...prev, email: result.email } : prev);
    } catch (_) {}
  };

  // プロフィール編集を開く
  const openEditProfile = (member: Member) => {
    setEditDisplayName(member.display_name);
    setEditPhone(member.phone ?? '');
    setEditBio(member.bio ?? '');
    setEditCompany(member.company ?? '');
    setEditSite(member.site ?? '');
    setEditEmploymentType(member.employment_type ?? null);
    setEditPosition(member.position ?? '');
    setEditProfileVisible(true);
  };

  // プロフィール保存
  const saveProfile = async () => {
    if (!selectedMember) return;
    if (!editDisplayName.trim()) { alert('名前を入力してください'); return; }
    setSaving(true);
    try {
      const updateData: Record<string, any> = {
        display_name: editDisplayName.trim(),
        phone: editPhone.trim() || null,
        bio: editBio.trim() || null,
        company: editCompany.trim() || null,
        site: editSite.trim() || null,
      };
      // employment_typeはCHECK制約があるので、有効な値のみ設定
      if (editEmploymentType && ['社員', '委託', 'プランナー'].includes(editEmploymentType)) {
        updateData.employment_type = editEmploymentType;
        updateData.position = editEmploymentType === '社員' ? (editPosition.trim() || null) : null;
      } else {
        updateData.employment_type = null;
        updateData.position = null;
      }
      const { error } = await supabase.from('profiles').update(updateData).eq('id', selectedMember.id);
      if (error) throw error;
      logAdminAction('edit_profile', 'member', selectedMember.id, `${selectedMember.display_name} プロフィール編集`);
      const updated = {
        ...selectedMember,
        ...updateData,
      };
      setMembers(prev => prev.map(m => m.id === selectedMember.id ? updated : m));
      setSelectedMember(updated);
      setEditProfileVisible(false);
      alert('✓ 保存しました');
    } catch (e: any) { alert('エラー: ' + e.message); }
    setSaving(false);
  };

  // メール変更保存
  const saveEmail = async () => {
    if (!selectedMember || !editEmail.trim()) return;
    setSaving(true);
    try {
      await callAdminApi('update_email', { user_id: selectedMember.id, email: editEmail.trim() });
      await logAdminAction('update_email', 'member', selectedMember.id, `→ ${editEmail.trim()}`);
      setSelectedMember(prev => prev ? { ...prev, email: editEmail.trim() } : prev);
      setEditEmailVisible(false);
      setEditEmail('');
      alert('メールアドレスを変更しました');
    } catch (e: any) { alert('エラー: ' + e.message); }
    setSaving(false);
  };

  // パスワード変更保存
  const savePassword = async () => {
    if (!selectedMember || editPassword.length < 6) {
      alert('エラー: ' + 'パスワードは6文字以上で入力してください'); return;
    }
    setSaving(true);
    try {
      await callAdminApi('update_password', { user_id: selectedMember.id, password: editPassword });
      await logAdminAction('update_password', 'member', selectedMember.id, selectedMember.display_name);
      setEditPasswordVisible(false);
      setEditPassword('');
      alert('パスワードを変更しました');
    } catch (e: any) { alert('エラー: ' + e.message); }
    setSaving(false);
  };

  // ユーザー新規作成
  const createUser = async () => {
    if (!newEmail.trim() || !newPassword || !newDisplayName.trim()) {
      alert('エラー: ' + 'すべての項目を入力してください'); return;
    }
    if (newPassword.length < 6) {
      alert('エラー: ' + 'パスワードは6文字以上で入力してください'); return;
    }
    setSaving(true);
    try {
      const result = await callAdminApi('create_user', {
        email: newEmail.trim(),
        password: newPassword,
        display_name: newDisplayName.trim(),
      });
      await logAdminAction('create_user', 'member', result.user.id, `${newDisplayName} (${newEmail})`);
      setCreateUserVisible(false);
      setNewEmail(''); setNewPassword(''); setNewDisplayName('');
      await fetchMembers();
      alert('ユーザーを作成しました');
    } catch (e: any) { alert('エラー: ' + e.message); }
    setSaving(false);
  };

  const changeRole = async (member: Member) => {
    if (changingRole) return;
    const newRole = member.role === 'admin' ? 'member' : 'admin';
    const label = newRole === 'admin' ? '管理者に昇格' : '一般に降格';
    setChangingRole(true);
    try {
      await callAdminApi('set_role', { user_id: member.id, role: newRole });
      await logAdminAction('change_role', 'member', member.id, `${member.display_name}: ${member.role} → ${newRole}`);
      setMembers(prev => prev.map(m => m.id === member.id ? { ...m, role: newRole } : m));
      setSelectedMember(prev => prev?.id === member.id ? { ...prev, role: newRole } : prev);
      alert(`${member.display_name}を${label}しました`);
    } catch (e: any) {
      alert('エラー: ' + e.message);
    } finally {
      setChangingRole(false);
    }
  };

  const deleteMember = async (member: Member) => {
    if (!window.confirm(`${member.display_name} を完全に削除しますか？\nこの操作は取り消せません。`)) return;
    try {
      await callAdminApi('delete_user', { user_id: member.id });
      await logAdminAction('delete_member', 'member', member.id, member.display_name);
      setMembers(prev => prev.filter(m => m.id !== member.id));
      setSelectedMember(null);
      alert('ユーザーを削除しました');
    } catch (e: any) { alert('エラー: ' + e.message); }
  };

  const deleteMessage = async (msg: Message) => {
    if (!window.confirm(`「${msg.content.slice(0, 40)}」を削除しますか？`)) return;
    const { error } = await supabase.from('messages').delete().eq('id', msg.id);
    if (error) { alert('エラー: ' + error.message); return; }
    await logAdminAction('delete_message', 'message', msg.id, msg.content.slice(0, 100));
    setMessages(prev => prev.filter(m => m.id !== msg.id));
    setTotalCount(prev => prev - 1);
  };

  const filteredMembers = members.filter(m =>
    m.display_name.toLowerCase().includes(memberSearch.toLowerCase())
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return '#06C755';
      case 'away': return '#FFA500';
      default: return '#999';
    }
  };

  const formatDateTime = (iso: string) =>
    new Date(iso).toLocaleString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const renderChatLog = ({ item }: { item: Message }) => (
    <View style={styles.logItem}>
      <View style={styles.logHeader}>
        <Text style={styles.logChannel}># {item.channels?.name ?? '不明'}</Text>
        <Text style={styles.logTime}>{formatDateTime(item.created_at)}</Text>
      </View>
      <Text style={styles.logSender}>{item.profiles?.display_name ?? '不明'}</Text>
      <Text style={styles.logContent} numberOfLines={3}>
        {item.file_type === 'image' ? '📷 画像' : item.content}
      </Text>
      <TouchableOpacity style={styles.deleteLogButton} onPress={() => deleteMessage(item)}>
        <Text style={styles.deleteLogText}>🗑 削除</Text>
      </TouchableOpacity>
    </View>
  );

  const renderMember = ({ item }: { item: Member }) => (
    <TouchableOpacity style={styles.memberItem} onPress={() => openMemberDetail(item)}>
      <View style={styles.memberAvatarWrap}>
        {item.avatar_url ? (
          <Image source={{ uri: item.avatar_url }} style={styles.memberAvatarImg} />
        ) : (
          <View style={[styles.memberAvatar, item.role === 'admin' && styles.memberAvatarAdmin]}>
            <Text style={styles.memberAvatarText}>{item.display_name.charAt(0).toUpperCase()}</Text>
          </View>
        )}
        <View style={[styles.statusDot, { backgroundColor: getStatusColor(item.status) }]} />
      </View>
      <View style={styles.memberInfo}>
        <View style={styles.memberNameRow}>
          <Text style={styles.memberName}>{item.display_name}</Text>
          {item.role === 'admin' && <View style={styles.adminBadge}><Text style={styles.adminBadgeText}>管理者</Text></View>}
        </View>
        <Text style={styles.memberJoined}>登録: {new Date(item.created_at).toLocaleDateString('ja-JP')}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.back}>← 戻る</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>👑 管理者パネル</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* タブ */}
      <View style={styles.tabs}>
        <TouchableOpacity style={[styles.tab, tab === 'chat_logs' && styles.tabActive]} onPress={() => setTab('chat_logs')}>
          <Text style={[styles.tabText, tab === 'chat_logs' && styles.tabTextActive]}>💬 チャットログ</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === 'members' && styles.tabActive]} onPress={() => setTab('members')}>
          <Text style={[styles.tabText, tab === 'members' && styles.tabTextActive]}>👥 メンバー管理</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === 'pending' && styles.tabActive]} onPress={() => setTab('pending')}>
          <View style={styles.tabWithBadge}>
            <Text style={[styles.tabText, tab === 'pending' && styles.tabTextActive]}>⏳ 承認待ち</Text>
            {pendingMembers.length > 0 && (
              <View style={styles.tabBadge}><Text style={styles.tabBadgeText}>{pendingMembers.length}</Text></View>
            )}
          </View>
        </TouchableOpacity>
        {isSuperAdmin && (
          <TouchableOpacity style={[styles.tab, tab === 'admin_settings' && styles.tabActive]} onPress={() => setTab('admin_settings')}>
            <Text style={[styles.tabText, tab === 'admin_settings' && styles.tabTextActive]}>👑 管理者</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* チャットログタブ */}
      {tab === 'chat_logs' && (
        <View style={{ flex: 1 }}>
          <View style={styles.filterSection}>
            <Text style={styles.filterLabel}>📅 期間</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
              {DATE_RANGE_OPTIONS.map(opt => (
                <TouchableOpacity key={opt.value}
                  style={[styles.filterChip, dateRange === opt.value && styles.filterChipActive]}
                  onPress={() => { setDateRange(opt.value); if (opt.value === 'custom') setShowCustomDate(true); }}>
                  <Text style={[styles.filterChipText, dateRange === opt.value && styles.filterChipTextActive]}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            {dateRange === 'custom' && (
              <TouchableOpacity style={styles.customDateButton} onPress={() => setShowCustomDate(true)}>
                <Text style={styles.customDateText}>
                  {customFrom ? customFrom.slice(0, 10) : '開始日'} 〜 {customTo ? customTo.slice(0, 10) : '終了日'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.channelFilterWrap}>
            <TouchableOpacity style={[styles.channelChip, selectedChannel === 'all' && styles.channelChipActive]} onPress={() => setSelectedChannel('all')}>
              <Text style={[styles.channelChipText, selectedChannel === 'all' && styles.channelChipTextActive]}>全チャンネル</Text>
            </TouchableOpacity>
            {channels.map(c => (
              <TouchableOpacity key={c.id} style={[styles.channelChip, selectedChannel === c.id && styles.channelChipActive]} onPress={() => setSelectedChannel(c.id)}>
                <Text style={[styles.channelChipText, selectedChannel === c.id && styles.channelChipTextActive]}># {c.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.listCount}>
            {loadingLogs ? '読み込み中...' : `${totalCount.toLocaleString()}件中 ${messages.length}件表示`}
          </Text>
          <FlatList
            data={messages} keyExtractor={item => item.id} renderItem={renderChatLog}
            contentContainerStyle={styles.list} onEndReached={loadMore} onEndReachedThreshold={0.3}
            ListFooterComponent={
              hasMore ? (
                <TouchableOpacity style={styles.loadMoreButton} onPress={loadMore} disabled={loadingLogs}>
                  <Text style={styles.loadMoreText}>{loadingLogs ? '読み込み中...' : 'さらに読み込む'}</Text>
                </TouchableOpacity>
              ) : messages.length > 0 ? <Text style={styles.noMoreText}>すべてのログを表示しました</Text> : null
            }
          />
        </View>
      )}

      {/* メンバー管理タブ */}
      {tab === 'members' && (
        <View style={{ flex: 1 }}>
          <View style={styles.memberTabHeader}>
            <TextInput
              style={styles.searchInput}
              value={memberSearch}
              onChangeText={setMemberSearch}
              placeholder="メンバーを検索..."
            />
            <TouchableOpacity style={styles.addUserButton} onPress={() => setCreateUserVisible(true)}>
              <Text style={styles.addUserButtonText}>＋ 追加</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.listCount}>
            {loadingMembers ? '読み込み中...' : `${filteredMembers.length}人のメンバー`}
          </Text>
          <FlatList
            data={filteredMembers} keyExtractor={item => item.id}
            renderItem={renderMember} contentContainerStyle={styles.list}
          />
        </View>
      )}

      {/* 承認待ちタブ */}
      {tab === 'pending' && (
        <View style={{ flex: 1 }}>
          <Text style={styles.listCount}>
            {pendingMembers.length === 0 ? '承認待ちのユーザーはいません' : `${pendingMembers.length}人が承認待ちです`}
          </Text>
          <FlatList
            data={pendingMembers}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <View style={styles.pendingItem}>
                <View style={styles.pendingAvatar}>
                  <Text style={styles.pendingAvatarText}>{item.display_name.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={styles.pendingInfo}>
                  <Text style={styles.pendingName}>{item.display_name}</Text>
                  <Text style={styles.pendingEmail}>{item.email ?? '取得中...'}</Text>
                  <Text style={styles.pendingDate}>申請: {new Date(item.created_at).toLocaleDateString('ja-JP')}</Text>
                </View>
                <View style={styles.pendingActions}>
                  <TouchableOpacity style={styles.approveButton} onPress={() => approveUser(item)}>
                    <Text style={styles.approveButtonText}>承認</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.rejectButton} onPress={() => rejectUser(item)}>
                    <Text style={styles.rejectButtonText}>拒否</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          />
        </View>
      )}

      {/* 管理者設定タブ */}
      {tab === 'admin_settings' && (
        <View style={{ flex: 1 }}>
          {/* ヘッダー説明 */}
          <View style={styles.adminSettingsHeader}>
            <Text style={styles.adminSettingsTitle}>管理者一覧</Text>
            <Text style={styles.adminSettingsDesc}>管理者をタップして権限詳細を確認できます。最高管理者のみ降格・昇格が可能です。</Text>
          </View>

          {loadingAdmins
            ? null
            : <FlatList
                data={adminList}
                keyExtractor={a => a.id}
                contentContainerStyle={styles.list}
                ListEmptyComponent={<Text style={styles.listCount}>管理者がいません</Text>}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[styles.adminCard, item.role === 'super_admin' && styles.adminCardSuper]}
                    onPress={() => { setSelectedAdmin(item); setPermModalVisible(true); }}
                  >
                    {/* アバター */}
                    <View style={styles.adminCardAvatarWrap}>
                      {item.avatar_url
                        ? <Image source={{ uri: item.avatar_url }} style={styles.adminCardAvatar} />
                        : <View style={[styles.adminCardAvatarPlaceholder, item.role === 'super_admin' && styles.adminCardAvatarSuper]}>
                            <Text style={styles.adminCardAvatarText}>{item.display_name.charAt(0).toUpperCase()}</Text>
                          </View>
                      }
                    </View>
                    {/* 情報 */}
                    <View style={{ flex: 1 }}>
                      <View style={styles.adminCardNameRow}>
                        <Text style={styles.adminCardName}>{item.display_name}</Text>
                        {item.role === 'super_admin'
                          ? <View style={styles.superBadge}><Text style={styles.superBadgeText}>最高管理者</Text></View>
                          : <View style={styles.adminBadgeSmall}><Text style={styles.adminBadgeSmallText}>管理者</Text></View>
                        }
                        {item.id === currentUserId && <Text style={styles.meLabelAdmin}>(自分)</Text>}
                      </View>
                      {item.employment_type && (
                        <Text style={styles.adminCardSub}>
                          {item.employment_type}{item.position ? ` · ${item.position}` : ''}
                        </Text>
                      )}
                      {item.email && <Text style={styles.adminCardEmail}>{item.email}</Text>}
                    </View>
                    <Text style={styles.chevron}>›</Text>
                  </TouchableOpacity>
                )}
              />
          }
        </View>
      )}

      {/* 管理者権限詳細モーダル */}
      <Modal visible={permModalVisible} transparent animationType="slide" onRequestClose={() => { setPermModalVisible(false); setEditingPerms(false); }}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <TouchableOpacity style={styles.modalCloseButton} onPress={() => { setPermModalVisible(false); setEditingPerms(false); }}>
              <Text style={styles.modalCloseText}>✕</Text>
            </TouchableOpacity>
            {selectedAdmin && (
              <ScrollView showsVerticalScrollIndicator={false}>
                {/* プロフィールヘッド */}
                <View style={styles.permModalHead}>
                  {selectedAdmin.avatar_url
                    ? <Image source={{ uri: selectedAdmin.avatar_url }} style={styles.permAvatar} />
                    : <View style={[styles.permAvatarPlaceholder, selectedAdmin.role === 'super_admin' && styles.adminCardAvatarSuper]}>
                        <Text style={styles.permAvatarText}>{selectedAdmin.display_name.charAt(0).toUpperCase()}</Text>
                      </View>
                  }
                  <Text style={styles.permName}>{selectedAdmin.display_name}</Text>
                  {selectedAdmin.role === 'super_admin'
                    ? <View style={styles.superBadge}><Text style={styles.superBadgeText}>👑 最高管理者</Text></View>
                    : <View style={styles.adminBadgeSmall}><Text style={styles.adminBadgeSmallText}>🛡 管理者</Text></View>
                  }
                  {selectedAdmin.email && <Text style={styles.permEmail}>{selectedAdmin.email}</Text>}
                </View>

                {/* 権限一覧 */}
                <View style={styles.permSectionHeader}>
                  <Text style={styles.permSectionLabel}>アクセス権限</Text>
                  {isSuperAdmin && selectedAdmin.role === 'admin' && selectedAdmin.id !== currentUserId && (
                    !editingPerms ? (
                      <TouchableOpacity style={styles.editPermBtn} onPress={() => startEditPerms(selectedAdmin)}>
                        <Text style={styles.editPermBtnText}>✏️ 編集</Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity style={styles.editPermBtn} onPress={() => setEditingPerms(false)}>
                        <Text style={[styles.editPermBtnText, { color: '#999' }]}>キャンセル</Text>
                      </TouchableOpacity>
                    )
                  )}
                </View>
                <View style={styles.permTable}>
                  {(() => {
                    let lastCat = '';
                    return PERMISSION_DEFS.map(p => {
                      const effectivePerms = editingPerms ? editPerms : getEffectivePerms(selectedAdmin);
                      const allowed = effectivePerms.includes(p.key);
                      const showCatHeader = p.category && p.category !== lastCat;
                      if (p.category) lastCat = p.category;
                      return (
                        <React.Fragment key={p.key}>
                          {showCatHeader && (
                            <View style={styles.permCatHeader}>
                              <Text style={styles.permCatHeaderText}>💼 {p.category}</Text>
                            </View>
                          )}
                          <View style={styles.permRow}>
                            <Text style={styles.permRowLabel}>{p.label}</Text>
                            {editingPerms && selectedAdmin.role === 'admin' ? (
                              <TouchableOpacity
                                style={[styles.permToggle, allowed ? styles.permToggleOn : styles.permToggleOff]}
                                onPress={() => togglePerm(p.key)}
                              >
                                <Text style={[styles.permToggleText, allowed ? styles.permToggleTextOn : styles.permToggleTextOff]}>
                                  {allowed ? '✓ 可' : '✕ 不可'}
                                </Text>
                              </TouchableOpacity>
                            ) : (
                              <View style={[styles.permBadge, allowed ? styles.permBadgeAllow : styles.permBadgeDeny]}>
                                <Text style={[styles.permBadgeText, allowed ? styles.permBadgeTextAllow : styles.permBadgeTextDeny]}>
                                  {allowed ? '✓ 可' : '✕ 不可'}
                                </Text>
                              </View>
                            )}
                          </View>
                        </React.Fragment>
                      );
                    });
                  })()}
                </View>

                {/* 編集モード：保存・リセットボタン */}
                {editingPerms && (
                  <View style={styles.permEditActions}>
                    <TouchableOpacity style={styles.permResetBtn} onPress={resetPermsToDefault} disabled={savingPerms}>
                      <Text style={styles.permResetBtnText}>デフォルトに戻す</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.permSaveBtn, savingPerms && { opacity: 0.6 }]} onPress={savePerms} disabled={savingPerms}>
                      <Text style={styles.permSaveBtnText}>{savingPerms ? '保存中...' : '💾 保存'}</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* 操作ボタン（最高管理者のみ・自分以外） */}
                {isSuperAdmin && selectedAdmin.id !== currentUserId && (
                  <View style={styles.permActions}>
                    <Text style={styles.adminActionTitle}>権限操作</Text>
                    {selectedAdmin.role === 'admin' && (
                      <TouchableOpacity
                        style={styles.promoteButton}
                        onPress={() => promoteToSuperAdmin(selectedAdmin)}
                      >
                        <Text style={styles.promoteButtonText}>👑 最高管理者に昇格</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={styles.demoteButton}
                      onPress={() => demoteToMember(selectedAdmin)}
                    >
                      <Text style={styles.demoteButtonText}>
                        {selectedAdmin.role === 'super_admin' ? '👇 管理者に降格' : '👇 一般メンバーに降格'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
                <View style={{ height: 20 }} />
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* カスタム日付モーダル */}
      <Modal visible={showCustomDate} transparent animationType="slide" onRequestClose={() => setShowCustomDate(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>📅 期間を指定</Text>
            <Text style={styles.modalLabel}>開始日（YYYY-MM-DD）</Text>
            <TextInput style={styles.modalInput} value={customFrom} onChangeText={setCustomFrom} placeholder="例: 2025-10-01" keyboardType="numbers-and-punctuation" />
            <Text style={styles.modalLabel}>終了日（YYYY-MM-DD）</Text>
            <TextInput style={styles.modalInput} value={customTo} onChangeText={setCustomTo} placeholder="例: 2026-04-01" keyboardType="numbers-and-punctuation" />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => setShowCustomDate(false)}>
                <Text style={styles.cancelButtonText}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.applyButton} onPress={applyCustomDate}>
                <Text style={styles.applyButtonText}>適用</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ユーザー追加モーダル */}
      <Modal visible={createUserVisible} transparent animationType="slide" onRequestClose={() => setCreateUserVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>👤 ユーザーを追加</Text>
              <TouchableOpacity onPress={() => setCreateUserVisible(false)}>
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.modalLabel}>表示名 *</Text>
            <TextInput style={styles.modalInput} value={newDisplayName} onChangeText={setNewDisplayName} placeholder="田中 太郎" />
            <Text style={styles.modalLabel}>メールアドレス *</Text>
            <TextInput style={styles.modalInput} value={newEmail} onChangeText={setNewEmail} placeholder="user@example.com" keyboardType="email-address" autoCapitalize="none" />
            <Text style={styles.modalLabel}>パスワード * (6文字以上)</Text>
            <View style={styles.passwordRow}>
              <TextInput
                style={[styles.modalInput, { flex: 1, marginBottom: 0 }]}
                value={newPassword} onChangeText={setNewPassword}
                placeholder="••••••••" secureTextEntry={!showNewPassword}
              />
              <TouchableOpacity style={styles.eyeButton} onPress={() => setShowNewPassword(v => !v)}>
                <Text style={styles.eyeText}>{showNewPassword ? '🙈' : '👁'}</Text>
              </TouchableOpacity>
            </View>
            <View style={[styles.modalButtons, { marginTop: 20 }]}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => setCreateUserVisible(false)}>
                <Text style={styles.cancelButtonText}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.applyButton, saving && styles.buttonDisabled]} onPress={createUser} disabled={saving}>
                <Text style={styles.applyButtonText}>{saving ? '作成中...' : '作成'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* メンバー詳細モーダル */}
      <Modal visible={!!selectedMember} transparent animationType="slide" onRequestClose={() => setSelectedMember(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <TouchableOpacity style={styles.modalCloseButton} onPress={() => setSelectedMember(null)}>
              <Text style={styles.modalCloseText}>✕</Text>
            </TouchableOpacity>
            {selectedMember && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.profileHeader}>
                  {selectedMember.avatar_url ? (
                    <Image source={{ uri: selectedMember.avatar_url }} style={styles.profileAvatar} />
                  ) : (
                    <View style={[styles.profileAvatarPlaceholder, selectedMember.role === 'admin' && styles.profileAvatarAdmin]}>
                      <Text style={styles.profileAvatarText}>{selectedMember.display_name.charAt(0).toUpperCase()}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.profileName}>{selectedMember.display_name}</Text>
                <View style={styles.profileBadgeRow}>
                  {selectedMember.role === 'admin' && (
                    <View style={styles.roleBadgeAdmin}><Text style={styles.roleBadgeText}>👑 管理者</Text></View>
                  )}
                  <View style={[styles.statusBadge, { backgroundColor: getStatusColor(selectedMember.status) + '22' }]}>
                    <Text style={[styles.statusBadgeText, { color: getStatusColor(selectedMember.status) }]}>
                      ● {selectedMember.status === 'online' ? 'オンライン' : 'オフライン'}
                    </Text>
                  </View>
                </View>

                {/* プロフィール情報 */}
                <View style={styles.detailBox}>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>登録日</Text>
                    <Text style={styles.detailValue}>{new Date(selectedMember.created_at).toLocaleDateString('ja-JP')}</Text>
                  </View>
                  {selectedMember.employment_type && (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>👔 雇用形態</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View style={[{ borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 }, selectedMember.employment_type === '社員' ? { backgroundColor: '#e8f4fd' } : selectedMember.employment_type === 'プランナー' ? { backgroundColor: '#f3e8ff' } : { backgroundColor: '#fff3e0' }]}>
                          <Text style={{ fontSize: 12, fontWeight: 'bold', color: '#333' }}>{selectedMember.employment_type}</Text>
                        </View>
                        {selectedMember.employment_type === '社員' && selectedMember.position && (
                          <Text style={styles.detailValue}>{selectedMember.position}</Text>
                        )}
                      </View>
                    </View>
                  )}
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>📧 メールアドレス</Text>
                    <Text style={styles.detailValue}>
                      {selectedMember.email === undefined ? '取得中...' : (selectedMember.email ?? '不明')}
                    </Text>
                  </View>
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
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>📞 電話番号</Text>
                      <Text style={styles.detailValue}>{selectedMember.phone}</Text>
                    </View>
                  )}
                  {selectedMember.bio && (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>自己紹介</Text>
                      <Text style={styles.detailValue}>{selectedMember.bio}</Text>
                    </View>
                  )}
                </View>

                {selectedMember.id !== currentUserId && (
                  <View style={styles.adminActionBox}>
                    <Text style={styles.adminActionTitle}>管理者操作</Text>

                    {/* プロフィール編集（全管理者） + 権限変更（最高管理者のみ） */}
                    <View style={styles.adminActionRow}>
                      <TouchableOpacity style={styles.actionButton} onPress={() => openEditProfile(selectedMember)}>
                        <Text style={styles.actionButtonText}>✏️ プロフィール編集</Text>
                      </TouchableOpacity>
                      {isSuperAdmin && (
                        <TouchableOpacity
                          style={[styles.roleButton, changingRole && { opacity: 0.5 }]}
                          onPress={() => changeRole(selectedMember)}
                          disabled={changingRole}
                        >
                          <Text style={styles.roleButtonText}>
                            {changingRole ? '処理中...' : (selectedMember.role === 'admin' ? '👇 一般に降格' : '👑 管理者昇格')}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>

                    {/* メール変更・パスワード変更（最高管理者のみ） */}
                    {isSuperAdmin && (
                      <View style={styles.adminActionRow}>
                        <TouchableOpacity style={styles.actionButton} onPress={() => {
                          setEditEmail(selectedMember.email ?? '');
                          setEditEmailVisible(true);
                        }}>
                          <Text style={styles.actionButtonText}>📧 メール変更</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.actionButton} onPress={() => {
                          setEditPassword('');
                          setEditPasswordVisible(true);
                        }}>
                          <Text style={styles.actionButtonText}>🔑 パスワード変更</Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    {/* 削除（管理者以上、ただし最高管理者は削除不可） */}
                    {selectedMember.role !== 'super_admin' && (
                      <TouchableOpacity style={styles.deleteButton} onPress={() => deleteMember(selectedMember)}>
                        <Text style={styles.deleteButtonText}>🗑 アカウントを完全削除</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* プロフィール編集モーダル */}
      <Modal visible={editProfileVisible} transparent animationType="slide" onRequestClose={() => setEditProfileVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>✏️ プロフィール編集</Text>
              <TouchableOpacity onPress={() => setEditProfileVisible(false)}>
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.modalLabel}>表示名 *</Text>
            <TextInput style={styles.modalInput} value={editDisplayName} onChangeText={setEditDisplayName} placeholder="表示名" />
            <Text style={styles.modalLabel}>雇用形態</Text>
            <View style={styles.toggleRow}>
              {(['社員', '委託', 'プランナー', null] as (string | null)[]).map((v) => (
                <TouchableOpacity
                  key={String(v)}
                  style={[styles.toggleBtn, editEmploymentType === v && styles.toggleBtnActive]}
                  onPress={() => setEditEmploymentType(v)}
                >
                  <Text style={[styles.toggleBtnText, editEmploymentType === v && styles.toggleBtnTextActive]}>
                    {v ?? 'なし'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {editEmploymentType === '社員' && (
              <>
                <Text style={styles.modalLabel}>役職</Text>
                <TextInput style={styles.modalInput} value={editPosition} onChangeText={setEditPosition} placeholder="例: 現場監督" />
              </>
            )}
            <Text style={styles.modalLabel}>電話番号</Text>
            <TextInput style={styles.modalInput} value={editPhone} onChangeText={setEditPhone} placeholder="090-0000-0000" keyboardType="phone-pad" />
            <Text style={styles.modalLabel}>🏢 所属会社</Text>
            <TextInput style={styles.modalInput} value={editCompany} onChangeText={setEditCompany} placeholder="例: 株式会社〇〇" />
            <Text style={styles.modalLabel}>📍 所属現場</Text>
            <TextInput style={styles.modalInput} value={editSite} onChangeText={setEditSite} placeholder="例: 〇〇工事現場" />
            <Text style={styles.modalLabel}>自己紹介</Text>
            <TextInput
              style={[styles.modalInput, styles.textArea]}
              value={editBio} onChangeText={setEditBio}
              placeholder="自己紹介を入力..." multiline numberOfLines={3}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => setEditProfileVisible(false)}>
                <Text style={styles.cancelButtonText}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.applyButton, saving && styles.buttonDisabled]} onPress={saveProfile} disabled={saving}>
                <Text style={styles.applyButtonText}>{saving ? '保存中...' : '保存'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* メール変更モーダル */}
      <Modal visible={editEmailVisible} transparent animationType="slide" onRequestClose={() => setEditEmailVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>📧 メールアドレス変更</Text>
              <TouchableOpacity onPress={() => setEditEmailVisible(false)}>
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.modalLabel}>新しいメールアドレス</Text>
            <TextInput
              style={styles.modalInput} value={editEmail} onChangeText={setEditEmail}
              placeholder="new@example.com" keyboardType="email-address" autoCapitalize="none"
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => setEditEmailVisible(false)}>
                <Text style={styles.cancelButtonText}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.applyButton, saving && styles.buttonDisabled]} onPress={saveEmail} disabled={saving}>
                <Text style={styles.applyButtonText}>{saving ? '変更中...' : '変更'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* パスワード変更モーダル */}
      <Modal visible={editPasswordVisible} transparent animationType="slide" onRequestClose={() => setEditPasswordVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>🔑 パスワード変更</Text>
              <TouchableOpacity onPress={() => setEditPasswordVisible(false)}>
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.modalLabel}>新しいパスワード（6文字以上）</Text>
            <View style={styles.passwordRow}>
              <TextInput
                style={[styles.modalInput, { flex: 1, marginBottom: 0 }]}
                value={editPassword} onChangeText={setEditPassword}
                placeholder="••••••••" secureTextEntry={!showPassword}
              />
              <TouchableOpacity style={styles.eyeButton} onPress={() => setShowPassword(v => !v)}>
                <Text style={styles.eyeText}>{showPassword ? '🙈' : '👁'}</Text>
              </TouchableOpacity>
            </View>
            <View style={[styles.modalButtons, { marginTop: 20 }]}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => setEditPasswordVisible(false)}>
                <Text style={styles.cancelButtonText}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.applyButton, saving && styles.buttonDisabled]} onPress={savePassword} disabled={saving}>
                <Text style={styles.applyButtonText}>{saving ? '変更中...' : '変更'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f8f8' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: 48, backgroundColor: '#1a1a2e', borderBottomWidth: 1, borderBottomColor: '#333' },
  back: { color: '#FFA500', fontSize: 16, width: 60 },
  headerTitle: { fontSize: 17, fontWeight: 'bold', color: '#FFA500' },
  tabs: { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee' },
  tab: { flex: 1, paddingVertical: 14, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: '#FFA500' },
  tabText: { fontSize: 14, color: '#999', fontWeight: '500' },
  tabTextActive: { color: '#FFA500', fontWeight: 'bold' },
  filterSection: { backgroundColor: '#fff', paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: '#eee' },
  filterLabel: { fontSize: 11, color: '#999', fontWeight: '600', marginBottom: 6 },
  filterScroll: { maxHeight: 40 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#f0f0f0', marginRight: 8 },
  filterChipActive: { backgroundColor: '#FFA500' },
  filterChipText: { fontSize: 13, color: '#666' },
  filterChipTextActive: { color: '#fff', fontWeight: 'bold' },
  customDateButton: { marginTop: 8, padding: 8, backgroundColor: '#FFF3CD', borderRadius: 8, alignSelf: 'flex-start' },
  customDateText: { fontSize: 13, color: '#856404', fontWeight: '500' },
  channelFilter: { backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#eee' },
  channelFilterWrap: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#eee', gap: 6 },
  channelChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: '#f0f0f0', marginRight: 8, minHeight: 32 },
  channelChipActive: { backgroundColor: '#1a1a2e' },
  channelChipText: { fontSize: 13, color: '#666' },
  channelChipTextActive: { color: '#FFA500', fontWeight: 'bold' },
  listCount: { fontSize: 12, color: '#999', paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#f8f8f8', borderBottomWidth: 1, borderBottomColor: '#eee' },
  list: { paddingBottom: 20 },
  logItem: { backgroundColor: '#fff', marginHorizontal: 12, marginTop: 10, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#eee' },
  logHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  logChannel: { fontSize: 12, color: '#06C755', fontWeight: '600' },
  logTime: { fontSize: 11, color: '#999' },
  logSender: { fontSize: 13, color: '#666', marginBottom: 4, fontWeight: '500' },
  logContent: { fontSize: 14, color: '#333', lineHeight: 20, marginBottom: 8 },
  deleteLogButton: { alignSelf: 'flex-end', paddingHorizontal: 10, paddingVertical: 4, backgroundColor: '#fff0f0', borderRadius: 8 },
  deleteLogText: { fontSize: 12, color: '#E24B4A' },
  loadMoreButton: { margin: 16, padding: 14, backgroundColor: '#1a1a2e', borderRadius: 10, alignItems: 'center' },
  loadMoreText: { color: '#FFA500', fontWeight: 'bold', fontSize: 14 },
  noMoreText: { textAlign: 'center', color: '#999', fontSize: 13, padding: 20 },
  memberTabHeader: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 12, borderBottomWidth: 1, borderBottomColor: '#eee', gap: 10 },
  searchInput: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8, fontSize: 15, backgroundColor: '#f8f8f8' },
  addUserButton: { backgroundColor: '#FFA500', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  addUserButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  memberItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 14, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  memberAvatarWrap: { position: 'relative', marginRight: 12 },
  memberAvatarImg: { width: 48, height: 48, borderRadius: 24 },
  memberAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#06C755', alignItems: 'center', justifyContent: 'center' },
  memberAvatarAdmin: { backgroundColor: '#FFA500' },
  memberAvatarText: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  statusDot: { position: 'absolute', bottom: 0, right: 0, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: '#fff' },
  memberInfo: { flex: 1 },
  memberNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  memberName: { fontSize: 15, fontWeight: '500', color: '#333' },
  adminBadge: { backgroundColor: '#FFA500', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 },
  adminBadgeText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  memberJoined: { fontSize: 12, color: '#999' },
  chevron: { fontSize: 20, color: '#ccc' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 48, maxHeight: '90%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#333' },
  modalLabel: { fontSize: 13, color: '#666', fontWeight: '600', marginBottom: 6 },
  modalInput: { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 14, fontSize: 15, marginBottom: 16, backgroundColor: '#fafafa' },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  passwordRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 0 },
  eyeButton: { padding: 14, backgroundColor: '#f0f0f0', borderRadius: 10 },
  eyeText: { fontSize: 18 },
  modalButtons: { flexDirection: 'row', gap: 12 },
  cancelButton: { flex: 1, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#ddd', alignItems: 'center' },
  cancelButtonText: { fontSize: 15, color: '#666' },
  applyButton: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#FFA500', alignItems: 'center' },
  applyButtonText: { fontSize: 15, color: '#fff', fontWeight: 'bold' },
  buttonDisabled: { opacity: 0.5 },
  modalCloseButton: { alignSelf: 'flex-end', marginBottom: 8 },
  modalCloseText: { fontSize: 18, color: '#999' },
  profileHeader: { alignItems: 'center', marginBottom: 12 },
  profileAvatar: { width: 90, height: 90, borderRadius: 45 },
  profileAvatarPlaceholder: { width: 90, height: 90, borderRadius: 45, backgroundColor: '#06C755', alignItems: 'center', justifyContent: 'center' },
  profileAvatarAdmin: { backgroundColor: '#FFA500' },
  profileAvatarText: { color: '#fff', fontSize: 36, fontWeight: 'bold' },
  profileName: { fontSize: 22, fontWeight: 'bold', color: '#333', textAlign: 'center', marginBottom: 8 },
  profileBadgeRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 16 },
  roleBadgeAdmin: { backgroundColor: '#FFA500', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 4 },
  roleBadgeText: { color: '#fff', fontSize: 13, fontWeight: 'bold' },
  statusBadge: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 4 },
  statusBadgeText: { fontSize: 13, fontWeight: '500' },
  detailBox: { backgroundColor: '#f8f8f8', borderRadius: 12, padding: 16, marginBottom: 16, gap: 12 },
  detailRow: { gap: 2 },
  detailLabel: { fontSize: 12, color: '#999', fontWeight: '600' },
  detailValue: { fontSize: 14, color: '#333', lineHeight: 20 },
  adminActionBox: { borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 16, gap: 10 },
  adminActionTitle: { fontSize: 12, color: '#999', fontWeight: '600' },
  adminActionRow: { flexDirection: 'row', gap: 10 },
  actionButton: { flex: 1, padding: 12, borderRadius: 10, backgroundColor: '#f0f4ff', alignItems: 'center' },
  actionButtonText: { fontSize: 13, color: '#3B5BDB', fontWeight: '500' },
  roleButton: { flex: 1, padding: 12, borderRadius: 10, backgroundColor: '#FFF3CD', alignItems: 'center' },
  roleButtonText: { fontSize: 13, color: '#856404', fontWeight: '500' },
  deleteButton: { padding: 14, borderRadius: 10, backgroundColor: '#fff0f0', alignItems: 'center' },
  deleteButtonText: { fontSize: 14, color: '#E24B4A', fontWeight: 'bold' },
  tabWithBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tabBadge: { backgroundColor: '#E24B4A', borderRadius: 8, minWidth: 16, height: 16, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  tabBadgeText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  pendingItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 14, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  pendingAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFA500', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  pendingAvatarText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  pendingInfo: { flex: 1 },
  pendingName: { fontSize: 15, fontWeight: '600', color: '#333', marginBottom: 2 },
  pendingEmail: { fontSize: 12, color: '#666', marginBottom: 2 },
  pendingDate: { fontSize: 11, color: '#999' },
  pendingActions: { flexDirection: 'row', gap: 8 },
  approveButton: { backgroundColor: '#06C755', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  approveButtonText: { color: '#fff', fontSize: 13, fontWeight: 'bold' },
  rejectButton: { backgroundColor: '#fff0f0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: '#ffcccc' },
  rejectButtonText: { color: '#E24B4A', fontSize: 13, fontWeight: 'bold' },
  toggleRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  toggleBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#ddd', alignItems: 'center', backgroundColor: '#f8f8f8' },
  toggleBtnActive: { backgroundColor: '#1a1a2e', borderColor: '#FFA500' },
  toggleBtnText: { fontSize: 13, color: '#666' },
  toggleBtnTextActive: { color: '#FFA500', fontWeight: 'bold' },

  // 管理者設定タブ
  adminSettingsHeader: { backgroundColor: '#fff', padding: 16, borderBottomWidth: 1, borderBottomColor: '#eee' },
  adminSettingsTitle: { fontSize: 15, fontWeight: 'bold', color: '#1a1a2e', marginBottom: 4 },
  adminSettingsDesc: { fontSize: 12, color: '#999', lineHeight: 18 },
  adminCard: { backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  adminCardSuper: { backgroundColor: '#fffbf0', borderLeftWidth: 3, borderLeftColor: '#FFA500' },
  adminCardAvatarWrap: { marginRight: 12 },
  adminCardAvatar: { width: 48, height: 48, borderRadius: 24 },
  adminCardAvatarPlaceholder: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#06C755', alignItems: 'center', justifyContent: 'center' },
  adminCardAvatarSuper: { backgroundColor: '#FFA500' },
  adminCardAvatarText: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  adminCardNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' },
  adminCardName: { fontSize: 15, fontWeight: '600', color: '#333' },
  adminCardSub: { fontSize: 12, color: '#666', marginBottom: 2 },
  adminCardEmail: { fontSize: 11, color: '#999' },
  superBadge: { backgroundColor: '#FFA500', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  superBadgeText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  adminBadgeSmall: { backgroundColor: '#1a1a2e', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  adminBadgeSmallText: { color: '#FFA500', fontSize: 10, fontWeight: 'bold' },
  meLabelAdmin: { fontSize: 11, color: '#999' },

  // 権限モーダル
  permModalHead: { alignItems: 'center', paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#eee', marginBottom: 16, gap: 6 },
  permAvatar: { width: 72, height: 72, borderRadius: 36, marginBottom: 4 },
  permAvatarPlaceholder: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#06C755', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  permAvatarText: { color: '#fff', fontSize: 28, fontWeight: 'bold' },
  permName: { fontSize: 20, fontWeight: 'bold', color: '#333' },
  permEmail: { fontSize: 12, color: '#999', marginTop: 2 },
  permSectionLabel: { fontSize: 12, fontWeight: '700', color: '#999', marginBottom: 10 },
  permSectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  editPermBtn: { backgroundColor: '#f0f4ff', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  editPermBtnText: { fontSize: 12, color: '#3B5BDB', fontWeight: '600' },
  permToggle: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, marginLeft: 8, minWidth: 60, alignItems: 'center' },
  permToggleOn: { backgroundColor: '#d4edda', borderWidth: 1, borderColor: '#06C755' },
  permToggleOff: { backgroundColor: '#fde8e8', borderWidth: 1, borderColor: '#E24B4A' },
  permToggleText: { fontSize: 12, fontWeight: '700' },
  permToggleTextOn: { color: '#06C755' },
  permToggleTextOff: { color: '#E24B4A' },
  permEditActions: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  permResetBtn: { flex: 1, padding: 12, borderRadius: 10, backgroundColor: '#f0f0f0', alignItems: 'center' },
  permResetBtnText: { fontSize: 13, color: '#666' },
  permSaveBtn: { flex: 1, padding: 12, borderRadius: 10, backgroundColor: '#06C755', alignItems: 'center' },
  permSaveBtnText: { fontSize: 13, color: '#fff', fontWeight: 'bold' },
  permTable: { backgroundColor: '#f8f8f8', borderRadius: 12, overflow: 'hidden', marginBottom: 16 },
  permCatHeader: { backgroundColor: '#EEF2FF', paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#C7D2FE' },
  permCatHeaderText: { fontSize: 12, fontWeight: '700', color: '#4338CA' },
  permRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#eee' },
  permRowLabel: { fontSize: 13, color: '#333', flex: 1 },
  permBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3, marginLeft: 8 },
  permBadgeAllow: { backgroundColor: '#e8f8f0' },
  permBadgeDeny: { backgroundColor: '#fff0f0' },
  permBadgeText: { fontSize: 12, fontWeight: 'bold' },
  permBadgeTextAllow: { color: '#06C755' },
  permBadgeTextDeny: { color: '#ccc' },
  permActions: { borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 16, gap: 10 },
  promoteButton: { padding: 14, borderRadius: 10, backgroundColor: '#FFF3CD', alignItems: 'center' },
  promoteButtonText: { fontSize: 14, color: '#856404', fontWeight: 'bold' },
  demoteButton: { padding: 14, borderRadius: 10, backgroundColor: '#fff0f0', alignItems: 'center' },
  demoteButtonText: { fontSize: 14, color: '#E24B4A', fontWeight: 'bold' },
});
