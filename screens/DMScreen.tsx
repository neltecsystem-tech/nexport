import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, Image, Modal,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';
import { confirmDialog, alertDialog } from '../lib/platformHelpers';

const REPORT_REASONS = [
  '迷惑・スパム',
  '嫌がらせ・誹謗中傷',
  '不適切なコンテンツ',
  '個人情報の漏洩',
  '業務外の私的利用',
  'その他',
];

type DM = {
  id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  created_at: string;
  is_read: boolean;
  file_url: string | null;
  file_type: string | null;
};

type Props = {
  onBack: () => void;
  partnerId: string;
  partnerName: string;
  currentUserId: string;
  onStartCall?: () => void;
};

export default function DMChatScreen({ onBack, partnerId, partnerName, currentUserId, onStartCall }: Props) {
  const [messages, setMessages] = useState<DM[]>([]);
  const [inputText, setInputText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [headerMenu, setHeaderMenu] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ type: 'message' | 'user'; messageId?: string } | null>(null);
  const [reportReason, setReportReason] = useState('');
  const [reportDetail, setReportDetail] = useState('');
  const [submittingReport, setSubmittingReport] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    fetchMessages();
    markAsRead();

    const sub = supabase
      .channel(`dm-${[currentUserId, partnerId].sort().join('-')}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages' }, (payload) => {
        const msg = payload.new as DM;
        if ((msg.sender_id === partnerId && msg.receiver_id === currentUserId) ||
            (msg.sender_id === currentUserId && msg.receiver_id === partnerId)) {
          setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
          if (msg.sender_id === partnerId) {
            supabase.from('direct_messages').update({ is_read: true }).eq('id', msg.id).then(() => {});
          }
          setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(sub); };
  }, [partnerId]);

  const fetchMessages = async () => {
    const { data } = await supabase
      .from('direct_messages')
      .select('*')
      .or(`and(sender_id.eq.${currentUserId},receiver_id.eq.${partnerId}),and(sender_id.eq.${partnerId},receiver_id.eq.${currentUserId})`)
      .order('created_at', { ascending: true });
    if (data) setMessages(data as DM[]);
  };

  const markAsRead = async () => {
    await supabase.from('direct_messages')
      .update({ is_read: true })
      .eq('sender_id', partnerId)
      .eq('receiver_id', currentUserId)
      .eq('is_read', false);
  };

  // ブロック状態の確認 (相手をブロック中か)
  useEffect(() => {
    if (!currentUserId || !partnerId) return;
    supabase
      .from('user_blocks')
      .select('blocked_id')
      .eq('blocker_id', currentUserId)
      .eq('blocked_id', partnerId)
      .maybeSingle()
      .then(({ data }) => setIsBlocked(!!data));
  }, [currentUserId, partnerId]);

  const toggleBlock = async () => {
    setHeaderMenu(false);
    if (isBlocked) {
      if (!(await confirmDialog(`${partnerName} さんのブロックを解除しますか？`))) return;
      const { error } = await supabase
        .from('user_blocks')
        .delete()
        .eq('blocker_id', currentUserId)
        .eq('blocked_id', partnerId);
      if (error) { alertDialog('エラー: ' + error.message); return; }
      setIsBlocked(false);
    } else {
      if (!(await confirmDialog(`${partnerName} さんをブロックしますか？\n\n相手からのDMは届かなくなります。`))) return;
      const { error } = await supabase
        .from('user_blocks')
        .insert({ blocker_id: currentUserId, blocked_id: partnerId });
      if (error) { alertDialog('エラー: ' + error.message); return; }
      setIsBlocked(true);
    }
  };

  const openReport = (target: { type: 'message' | 'user'; messageId?: string }) => {
    setReportTarget(target);
    setReportReason('');
    setReportDetail('');
    setHeaderMenu(false);
  };

  const submitReport = async () => {
    if (!reportTarget) return;
    if (!reportReason) { alertDialog('通報理由を選択してください'); return; }
    setSubmittingReport(true);
    try {
      const payload: any = {
        reporter_id: currentUserId,
        message_type: 'dm',
        reported_user_id: partnerId,
        reason: reportReason,
        detail: reportDetail.trim() || null,
      };
      if (reportTarget.type === 'message' && reportTarget.messageId) {
        payload.message_id = reportTarget.messageId;
      } else {
        // ユーザー通報の場合は便宜上 partner との直近やりとりIDを記録する
        // (RLS の都合上 message_id NOT NULL なので、最新メッセージのIDを使う)
        const latest = messages.filter(m => m.sender_id === partnerId).slice(-1)[0];
        if (!latest) {
          alertDialog('まだメッセージがないため、ユーザー単体の通報はできません。メッセージを長押しして通報してください。');
          setSubmittingReport(false);
          return;
        }
        payload.message_id = latest.id;
      }
      const { error } = await supabase.from('message_reports').insert(payload);
      if (error) throw error;
      alertDialog('通報を受け付けました。管理者が内容を確認します。');
      setReportTarget(null);
    } catch (e: any) {
      alertDialog('通報の送信に失敗しました: ' + (e?.message || String(e)));
    } finally {
      setSubmittingReport(false);
    }
  };

  const sendMessage = async () => {
    if (!inputText.trim()) return;
    if (isBlocked) { alertDialog('ブロック中のユーザーにはメッセージを送れません。ブロックを解除してください。'); return; }
    const content = inputText.trim();
    setInputText('');
    await supabase.from('direct_messages').insert({
      sender_id: currentUserId,
      receiver_id: partnerId,
      content,
    });
    // Push通知 (web-push EF: Web Push + Expo Native push 両対応)
    try {
      const { data: prof } = await supabase.from('profiles').select('display_name').eq('id', currentUserId).single();
      fetch('https://nccognptoprhwsbjnwcu.supabase.co/functions/v1/web-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send',
          user_ids: [partnerId],
          title: `💬 DM`,
          body: `${prof?.display_name ?? ''}: ${content.slice(0, 100)}`,
          groupId: `dm-${currentUserId}`,
          groupTitle: `💬 ${prof?.display_name ?? 'DM'}`,
          type: 'dm',
        }),
      }).catch(() => {});
    } catch (_) {}
  };

  const pickAndSendImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false, quality: 0.8,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    setUploading(true);
    try {
      const ext = asset.uri.split('.').pop() ?? 'jpg';
      const fileName = `dm/${currentUserId}/${Date.now()}.${ext}`;
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const { error: uploadError } = await supabase.storage
        .from('avatars').upload(fileName, blob, { contentType: `image/${ext}`, upsert: true });
      if (uploadError) { alert('アップロードエラー: ' + uploadError.message); return; }
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(fileName);
      await supabase.from('direct_messages').insert({
        sender_id: currentUserId,
        receiver_id: partnerId,
        content: '📷 画像',
        file_url: urlData.publicUrl,
        file_type: 'image',
      });
    } catch (e: any) { alert('エラー: ' + e.message); }
    finally { setUploading(false); }
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  };

  const renderMessage = ({ item }: { item: DM }) => {
    const isMe = item.sender_id === currentUserId;
    const bubble = (
      <View style={[styles.msgBubble, isMe ? styles.msgBubbleMe : styles.msgBubbleOther]}>
        {item.file_type === 'image' && item.file_url ? (
          <Image source={{ uri: item.file_url }} style={styles.msgImage} resizeMode="cover" />
        ) : (
          <Text style={[styles.msgText, isMe && { color: '#fff' }]}>{item.content}</Text>
        )}
        <View style={styles.msgMeta}>
          <Text style={[styles.msgTime, isMe && { color: '#ffffffaa' }]}>{formatTime(item.created_at)}</Text>
          {isMe && <Text style={styles.msgRead}>{item.is_read ? '既読' : ''}</Text>}
        </View>
      </View>
    );
    return (
      <View style={[styles.msgRow, isMe ? styles.msgRowMe : styles.msgRowOther]}>
        {!isMe && (
          <View style={styles.msgAvatar}>
            <Text style={styles.msgAvatarText}>{partnerName.charAt(0)}</Text>
          </View>
        )}
        {!isMe ? (
          <TouchableOpacity
            activeOpacity={0.85}
            delayLongPress={400}
            onLongPress={() => openReport({ type: 'message', messageId: item.id })}
          >
            {bubble}
          </TouchableOpacity>
        ) : bubble}
      </View>
    );
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.back}>← 戻る</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerAvatar}>
            <Text style={styles.headerAvatarText}>{partnerName.charAt(0)}</Text>
          </View>
          <Text style={styles.headerName}>{partnerName}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <TouchableOpacity onPress={onStartCall} style={{ width: 40, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 22 }}>📞</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setHeaderMenu(true)} style={{ width: 40, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 22, color: '#475569' }}>⋮</Text>
          </TouchableOpacity>
        </View>
      </View>

      {isBlocked && (
        <View style={{ padding: 10, backgroundColor: '#FEF2F2', borderBottomWidth: 1, borderBottomColor: '#FECACA' }}>
          <Text style={{ fontSize: 12, color: '#B91C1C', textAlign: 'center' }}>
            🚫 このユーザーをブロック中です。メッセージは送れません。
          </Text>
        </View>
      )}

      {/* ヘッダーメニュー (ブロック/通報) */}
      <Modal visible={headerMenu} transparent animationType="fade" onRequestClose={() => setHeaderMenu(false)}>
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setHeaderMenu(false)}>
          <View style={styles.menuSheet}>
            <Text style={styles.menuTitle}>{partnerName}</Text>
            <TouchableOpacity style={styles.menuItem} onPress={() => openReport({ type: 'user' })}>
              <Text style={styles.menuItemText}>⚠️ このユーザーを通報</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={toggleBlock}>
              <Text style={[styles.menuItemText, { color: isBlocked ? '#1A3C8F' : '#B91C1C' }]}>
                {isBlocked ? '🔓 ブロックを解除' : '🚫 ユーザーをブロック'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.menuItem, { borderBottomWidth: 0 }]} onPress={() => setHeaderMenu(false)}>
              <Text style={[styles.menuItemText, { color: '#94A3B8' }]}>キャンセル</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 通報モーダル */}
      <Modal visible={!!reportTarget} transparent animationType="slide" onRequestClose={() => setReportTarget(null)}>
        <View style={styles.menuOverlay}>
          <View style={styles.reportSheet}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={styles.menuTitle}>
                {reportTarget?.type === 'message' ? 'メッセージを通報' : 'ユーザーを通報'}
              </Text>
              <TouchableOpacity onPress={() => setReportTarget(null)}>
                <Text style={{ fontSize: 18, color: '#94A3B8' }}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={{ fontSize: 12, color: '#64748B', marginBottom: 10 }}>
              通報内容は管理者が確認します。{'\n'}虚偽の通報はご遠慮ください。
            </Text>
            <Text style={{ fontSize: 13, fontWeight: '600', color: '#334155', marginBottom: 6 }}>理由 *</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {REPORT_REASONS.map(r => (
                <TouchableOpacity
                  key={r}
                  style={[styles.reasonChip, reportReason === r && styles.reasonChipActive]}
                  onPress={() => setReportReason(r)}
                >
                  <Text style={[styles.reasonChipText, reportReason === r && { color: '#fff' }]}>{r}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={{ fontSize: 13, fontWeight: '600', color: '#334155', marginBottom: 6 }}>詳細 (任意)</Text>
            <TextInput
              style={styles.reportDetailInput}
              value={reportDetail}
              onChangeText={setReportDetail}
              multiline
              placeholder="具体的な状況をご記入ください"
              maxLength={500}
            />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <TouchableOpacity style={styles.reportCancelBtn} onPress={() => setReportTarget(null)} disabled={submittingReport}>
                <Text style={styles.reportCancelBtnText}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.reportSubmitBtn, submittingReport && { opacity: 0.6 }]}
                onPress={submitReport}
                disabled={submittingReport}
              >
                <Text style={styles.reportSubmitBtnText}>{submittingReport ? '送信中...' : '通報を送信'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={item => item.id}
        renderItem={renderMessage}
        contentContainerStyle={styles.messageList}
        onLayout={() => flatListRef.current?.scrollToEnd({ animated: false })}
      />

      <View style={styles.inputBar}>
        <TouchableOpacity style={styles.attachBtn} onPress={pickAndSendImage} disabled={uploading}>
          <Text style={styles.attachIcon}>{uploading ? '⏳' : '📎'}</Text>
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          value={inputText}
          onChangeText={setInputText}
          placeholder={`${partnerName} へメッセージ...`}
          placeholderTextColor="#C0C0C0"
          multiline
          returnKeyType="send"
          onSubmitEditing={sendMessage}
        />
        <TouchableOpacity style={styles.sendBtn} onPress={sendMessage}>
          <Text style={styles.sendBtnText}>送信</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, paddingTop: 48, backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#eee',
  },
  back: { color: '#1A3C8F', fontSize: 16, width: 60 },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#1A3C8F', alignItems: 'center', justifyContent: 'center' },
  headerAvatarText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  headerName: { fontSize: 16, fontWeight: 'bold', color: '#333' },
  messageList: { padding: 12, paddingBottom: 8 },
  msgRow: { marginBottom: 8, flexDirection: 'row', alignItems: 'flex-end' },
  msgRowMe: { justifyContent: 'flex-end' },
  msgRowOther: { justifyContent: 'flex-start' },
  msgAvatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#1A3C8F', alignItems: 'center', justifyContent: 'center', marginRight: 6 },
  msgAvatarText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  msgBubble: { maxWidth: '75%', borderRadius: 16, padding: 10, paddingHorizontal: 14 },
  msgBubbleMe: { backgroundColor: '#1A3C8F', borderBottomRightRadius: 4 },
  msgBubbleOther: { backgroundColor: '#fff', borderBottomLeftRadius: 4, borderWidth: 1, borderColor: '#E2E8F0' },
  msgText: { fontSize: 15, color: '#333', lineHeight: 22 },
  msgImage: { width: 200, height: 200, borderRadius: 10 },
  msgMeta: { flexDirection: 'row', justifyContent: 'flex-end', gap: 6, marginTop: 4 },
  msgTime: { fontSize: 10, color: '#94A3B8' },
  msgRead: { fontSize: 10, color: '#ffffffaa' },
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', padding: 10,
    backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#eee', gap: 8,
  },
  attachBtn: { padding: 8 },
  attachIcon: { fontSize: 22 },
  input: {
    flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, maxHeight: 100, backgroundColor: '#FAFAFA',
  },
  sendBtn: { backgroundColor: '#1A3C8F', borderRadius: 20, paddingHorizontal: 18, paddingVertical: 10 },
  sendBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  menuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  menuSheet: { width: '100%', maxWidth: 360, backgroundColor: '#fff', borderRadius: 12, padding: 18 },
  menuTitle: { fontSize: 15, fontWeight: 'bold', color: '#1A3C8F', marginBottom: 8 },
  menuItem: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  menuItemText: { fontSize: 14, color: '#334155', fontWeight: '500' },
  reportSheet: { width: '100%', maxWidth: 460, backgroundColor: '#fff', borderRadius: 12, padding: 18, maxHeight: '92%' },
  reasonChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: '#fff' },
  reasonChipActive: { backgroundColor: '#B91C1C', borderColor: '#B91C1C' },
  reasonChipText: { fontSize: 12, color: '#475569' },
  reportDetailInput: { borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, padding: 10, fontSize: 13, minHeight: 80, textAlignVertical: 'top', backgroundColor: '#FAFAFA' },
  reportCancelBtn: { flex: 1, borderRadius: 8, paddingVertical: 12, alignItems: 'center', backgroundColor: '#E2E8F0' },
  reportCancelBtnText: { color: '#475569', fontWeight: '600', fontSize: 13 },
  reportSubmitBtn: { flex: 2, borderRadius: 8, paddingVertical: 12, alignItems: 'center', backgroundColor: '#B91C1C' },
  reportSubmitBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
});
