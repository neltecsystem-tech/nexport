import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';

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

  const sendMessage = async () => {
    if (!inputText.trim()) return;
    const content = inputText.trim();
    setInputText('');
    await supabase.from('direct_messages').insert({
      sender_id: currentUserId,
      receiver_id: partnerId,
      content,
    });
    // Push通知
    try {
      const { data: prof } = await supabase.from('profiles').select('display_name').eq('id', currentUserId).single();
      fetch('https://nccognptoprhwsbjnwcu.supabase.co/functions/v1/send-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_ids: [partnerId],
          title: `💬 DM`,
          body: `${prof?.display_name ?? ''}: ${content.slice(0, 100)}`,
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
    return (
      <View style={[styles.msgRow, isMe ? styles.msgRowMe : styles.msgRowOther]}>
        {!isMe && (
          <View style={styles.msgAvatar}>
            <Text style={styles.msgAvatarText}>{partnerName.charAt(0)}</Text>
          </View>
        )}
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
        <TouchableOpacity onPress={onStartCall} style={{ width: 60, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 22 }}>📞</Text>
        </TouchableOpacity>
      </View>

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
});
