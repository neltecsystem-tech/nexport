import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Switch, TextInput, Platform,
} from 'react-native';
import { supabase } from '../lib/supabase';

type Props = { onBack: () => void };

export default function NotificationSettingsScreen({ onBack }: Props) {
  const [notifEnabled, setNotifEnabled] = useState(true);
  const [notifChannel, setNotifChannel] = useState(true);
  const [notifDm, setNotifDm] = useState(true);
  const [notifMentionOnly, setNotifMentionOnly] = useState(false);
  const [quietStart, setQuietStart] = useState('');
  const [quietEnd, setQuietEnd] = useState('');
  const [notifPermission, setNotifPermission] = useState<string>('default');
  const [notifSound, setNotifSound] = useState(true);
  const [notifPreview, setNotifPreview] = useState(true);

  useEffect(() => {
    fetchSettings();
    if (Platform.OS === 'web' && 'Notification' in window) {
      setNotifPermission(Notification.permission);
    }
  }, []);

  const fetchSettings = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from('notification_settings').select('*').eq('user_id', user.id).maybeSingle();
    if (data) {
      setNotifEnabled(data.push_enabled);
      setNotifChannel(data.channel_messages);
      setNotifDm(data.dm_messages);
      setNotifMentionOnly(data.mentions_only);
      setQuietStart(data.quiet_start ?? '');
      setQuietEnd(data.quiet_end ?? '');
    }
  };

  const save = async (updates: Record<string, any>) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('notification_settings').upsert({
      user_id: user.id,
      push_enabled: notifEnabled,
      channel_messages: notifChannel,
      dm_messages: notifDm,
      mentions_only: notifMentionOnly,
      quiet_start: quietStart || null,
      quiet_end: quietEnd || null,
      updated_at: new Date().toISOString(),
      ...updates,
    });
  };

  const requestPermission = async () => {
    if (Platform.OS !== 'web' || !('Notification' in window)) { alert('この環境では通知がサポートされていません'); return; }
    const perm = await Notification.requestPermission();
    setNotifPermission(perm);
    if (perm === 'granted') alert('通知が有効になりました');
    else alert('通知がブロックされています。ブラウザの設定から許可してください。');
  };

  const Row = ({ icon, label, desc, right }: { icon: string; label: string; desc?: string; right: React.ReactNode }) => (
    <View style={s.row}>
      <Text style={s.rowIcon}>{icon}</Text>
      <View style={s.rowBody}>
        <Text style={s.rowLabel}>{label}</Text>
        {desc ? <Text style={s.rowDesc}>{desc}</Text> : null}
      </View>
      {right}
    </View>
  );

  const Sw = ({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) => (
    <Switch value={value} onValueChange={onChange} trackColor={{ false: '#E2E8F0', true: '#1A3C8F' }} thumbColor="#fff" />
  );

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={onBack}><Text style={s.back}>← 戻る</Text></TouchableOpacity>
        <Text style={s.headerTitle}>通知</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll}>
        {/* 通知許可ステータス */}
        <View style={s.permCard}>
          <View style={[s.permDot, { backgroundColor: notifPermission === 'granted' ? '#10B981' : '#EF4444' }]} />
          <View style={{ flex: 1 }}>
            <Text style={s.permTitle}>
              {notifPermission === 'granted' ? '通知は有効です' : notifPermission === 'denied' ? '通知がブロックされています' : '通知が未設定です'}
            </Text>
            <Text style={s.permDesc}>
              {notifPermission === 'granted' ? 'メッセージを受信すると通知が届きます' : 'ブラウザの通知を許可してください'}
            </Text>
          </View>
          {notifPermission !== 'granted' && (
            <TouchableOpacity style={s.permBtn} onPress={requestPermission}>
              <Text style={s.permBtnText}>許可</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* 通知全般 */}
        <Text style={s.section}>通知全般</Text>
        <View style={s.card}>
          <Row icon="🔔" label="通知" desc="すべての通知のオン/オフ"
            right={<Sw value={notifEnabled} onChange={(v) => { setNotifEnabled(v); save({ push_enabled: v }); }} />} />
          <View style={s.sep} />
          <Row icon="💬" label="チャンネルメッセージ" desc="グループチャットの通知"
            right={<Sw value={notifChannel} onChange={(v) => { setNotifChannel(v); save({ channel_messages: v }); }} />} />
          <View style={s.sep} />
          <Row icon="✉️" label="DM（個人チャット）" desc="個人メッセージの通知"
            right={<Sw value={notifDm} onChange={(v) => { setNotifDm(v); save({ dm_messages: v }); }} />} />
          <View style={s.sep} />
          <Row icon="@" label="メンションのみ" desc="@自分 の時だけ通知する"
            right={<Sw value={notifMentionOnly} onChange={(v) => { setNotifMentionOnly(v); save({ mentions_only: v }); }} />} />
        </View>

        {/* 通知スタイル */}
        <Text style={s.section}>通知スタイル</Text>
        <View style={s.card}>
          <Row icon="🔊" label="通知音" desc=""
            right={<Sw value={notifSound} onChange={setNotifSound} />} />
          <View style={s.sep} />
          <Row icon="👁️" label="メッセージプレビュー" desc="通知にメッセージ内容を表示"
            right={<Sw value={notifPreview} onChange={setNotifPreview} />} />
        </View>

        {/* おやすみモード */}
        <Text style={s.section}>おやすみモード</Text>
        <View style={s.card}>
          <View style={s.quietRow}>
            <Text style={s.quietIcon}>🌙</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.quietTitle}>通知を一時停止する時間帯</Text>
              <Text style={s.quietDesc}>この時間帯は通知が届きません</Text>
            </View>
          </View>
          <View style={s.quietInputRow}>
            <View style={s.quietInputWrap}>
              <Text style={s.quietInputLabel}>開始</Text>
              <TextInput style={s.quietInput} value={quietStart} onChangeText={setQuietStart}
                placeholder="22:00" placeholderTextColor="#C0C0C0"
                onBlur={() => save({ quiet_start: quietStart || null })} />
            </View>
            <Text style={s.quietArrow}>→</Text>
            <View style={s.quietInputWrap}>
              <Text style={s.quietInputLabel}>終了</Text>
              <TextInput style={s.quietInput} value={quietEnd} onChangeText={setQuietEnd}
                placeholder="07:00" placeholderTextColor="#C0C0C0"
                onBlur={() => save({ quiet_end: quietEnd || null })} />
            </View>
          </View>
        </View>

        {/* ヒント */}
        <View style={s.hintCard}>
          <Text style={s.hintTitle}>💡 ヒント</Text>
          <Text style={s.hintText}>チャンネルごとの通知設定は、各チャンネルのチャット画面のヘッダーにある 🔔 アイコンから変更できます。</Text>
        </View>

      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F0F2F5' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: 48, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  back: { color: '#1A3C8F', fontSize: 16, width: 60 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#111' },
  scroll: { padding: 16, paddingBottom: 40 },

  // Permission card
  permCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 20, gap: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  permDot: { width: 10, height: 10, borderRadius: 5 },
  permTitle: { fontSize: 14, fontWeight: '700', color: '#111' },
  permDesc: { fontSize: 11, color: '#6B7280', marginTop: 2 },
  permBtn: { backgroundColor: '#1A3C8F', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  permBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  // Section
  section: { fontSize: 12, fontWeight: '700', color: '#6B7280', letterSpacing: 0.5, marginBottom: 8, marginLeft: 4, marginTop: 4 },

  // Card
  card: { backgroundColor: '#fff', borderRadius: 14, overflow: 'hidden', marginBottom: 20, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },

  // Row
  row: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  rowIcon: { fontSize: 20, width: 28, textAlign: 'center' },
  rowBody: { flex: 1 },
  rowLabel: { fontSize: 15, fontWeight: '600', color: '#111' },
  rowDesc: { fontSize: 11, color: '#9CA3AF', marginTop: 1 },
  sep: { height: 1, backgroundColor: '#F3F4F6', marginLeft: 56 },

  // Quiet mode
  quietRow: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  quietIcon: { fontSize: 20 },
  quietTitle: { fontSize: 15, fontWeight: '600', color: '#111' },
  quietDesc: { fontSize: 11, color: '#9CA3AF', marginTop: 1 },
  quietInputRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
  quietInputWrap: { flex: 1 },
  quietInputLabel: { fontSize: 11, color: '#6B7280', fontWeight: '600', marginBottom: 4 },
  quietInput: { borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10, padding: 12, fontSize: 16, fontWeight: '600', textAlign: 'center', backgroundColor: '#F9FAFB' },
  quietArrow: { fontSize: 16, color: '#9CA3AF', fontWeight: '700' },

  // Hint
  hintCard: { backgroundColor: '#EFF6FF', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#BFDBFE' },
  hintTitle: { fontSize: 13, fontWeight: '700', color: '#1E40AF', marginBottom: 4 },
  hintText: { fontSize: 12, color: '#1E40AF', lineHeight: 18 },
});
