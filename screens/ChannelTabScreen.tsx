import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  FlatList, TextInput, Alert, Modal, ScrollView,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { supabase } from '../lib/supabase';

type Tab = 'notes' | 'announcements' | 'files';

type Note = {
  id: string;
  title: string;
  content: string;
  updated_at: string;
  user_id: string;
  profiles: { display_name: string } | null;
};

type Announcement = {
  id: string;
  title: string;
  content: string;
  is_pinned: boolean;
  created_at: string;
  profiles: { display_name: string } | null;
};

type ChannelFile = {
  id: string;
  file_name: string;
  file_url: string;
  file_size: number | null;
  mime_type: string | null;
  created_at: string;
  user_id: string;
  profiles: { display_name: string } | null;
};

type Props = {
  channelId: string;
  channelName: string;
  onBack: () => void;
  isAdmin: boolean;
  currentUserId: string | null;
};

function formatBytes(bytes: number | null) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export default function ChannelTabScreen({ channelId, channelName, onBack, isAdmin, currentUserId }: Props) {
  const [tab, setTab] = useState<Tab>('announcements');
  const [notes, setNotes] = useState<Note[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [files, setFiles] = useState<ChannelFile[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editNote, setEditNote] = useState<Note | null>(null);
  const [editAnn, setEditAnn] = useState<Announcement | null>(null);
  const [inputTitle, setInputTitle] = useState('');
  const [inputContent, setInputContent] = useState('');
  const [isPinned, setIsPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (tab === 'notes') fetchNotes();
    if (tab === 'announcements') fetchAnnouncements();
    if (tab === 'files') fetchFiles();
  }, [tab]);

  const fetchNotes = async () => {
    const { data } = await supabase
      .from('channel_notes')
      .select('id, title, content, updated_at, user_id, profiles(display_name)')
      .eq('channel_id', channelId)
      .order('updated_at', { ascending: false });
    if (data) setNotes(data as Note[]);
  };

  const fetchAnnouncements = async () => {
    const { data } = await supabase
      .from('channel_announcements')
      .select('id, title, content, is_pinned, created_at, profiles(display_name)')
      .eq('channel_id', channelId)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false });
    if (data) setAnnouncements(data as Announcement[]);
  };

  const fetchFiles = async () => {
    const { data } = await supabase
      .from('channel_files')
      .select('id, file_name, file_url, file_size, mime_type, created_at, user_id, profiles(display_name)')
      .eq('channel_id', channelId)
      .order('created_at', { ascending: false });
    if (data) setFiles(data as ChannelFile[]);
  };

  const openNoteModal = (note?: Note) => {
    setEditNote(note ?? null);
    setInputTitle(note?.title ?? '');
    setInputContent(note?.content ?? '');
    setModalVisible(true);
  };

  const openAnnModal = (ann?: Announcement) => {
    setEditAnn(ann ?? null);
    setInputTitle(ann?.title ?? '');
    setInputContent(ann?.content ?? '');
    setIsPinned(ann?.is_pinned ?? false);
    setModalVisible(true);
  };

  const saveNote = async () => {
    if (!inputTitle.trim() || !inputContent.trim()) { alert('タイトルと内容を入力してください'); return; }
    setSaving(true);
    if (editNote) {
      await supabase.from('channel_notes').update({ title: inputTitle.trim(), content: inputContent.trim(), updated_at: new Date().toISOString() }).eq('id', editNote.id);
    } else {
      await supabase.from('channel_notes').insert({ channel_id: channelId, user_id: currentUserId, title: inputTitle.trim(), content: inputContent.trim() });
    }
    setSaving(false);
    setModalVisible(false);
    fetchNotes();
  };

  const saveAnnouncement = async () => {
    if (!inputTitle.trim() || !inputContent.trim()) { alert('タイトルと内容を入力してください'); return; }
    setSaving(true);
    if (editAnn) {
      await supabase.from('channel_announcements').update({ title: inputTitle.trim(), content: inputContent.trim(), is_pinned: isPinned }).eq('id', editAnn.id);
    } else {
      await supabase.from('channel_announcements').insert({ channel_id: channelId, user_id: currentUserId, title: inputTitle.trim(), content: inputContent.trim(), is_pinned: isPinned });
    }
    setSaving(false);
    setModalVisible(false);
    fetchAnnouncements();
  };

  const deleteNote = async (note: Note) => {
    if (!window.confirm(`「${note.title}」を削除しますか？`)) return;
    await supabase.from('channel_notes').delete().eq('id', note.id);
    setModalVisible(false);
    fetchNotes();
  };

  const deleteAnnouncement = async (ann: Announcement) => {
    if (!window.confirm(`「${ann.title}」を削除しますか？`)) return;
    await supabase.from('channel_announcements').delete().eq('id', ann.id);
    setModalVisible(false);
    fetchAnnouncements();
  };

  const deleteFile = async (file: ChannelFile) => {
    if (file.user_id !== currentUserId && !isAdmin) { alert('自分がアップロードしたファイルのみ削除できます'); return; }
    if (!window.confirm(`「${file.file_name}」を削除しますか？`)) return;
    await supabase.from('channel_files').delete().eq('id', file.id);
    fetchFiles();
  };

  const uploadFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (result.canceled) return;
    const asset = result.assets[0];
    setUploading(true);
    try {
      const ext = asset.name.split('.').pop() ?? 'bin';
      const fileName = `${channelId}/${Date.now()}_${asset.name}`;
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const { error: uploadError } = await supabase.storage
        .from('channel-files')
        .upload(fileName, blob, { contentType: asset.mimeType ?? 'application/octet-stream' });
      if (uploadError) { alert(uploadError.message); return; }
      const { data: urlData } = supabase.storage.from('channel-files').getPublicUrl(fileName);
      await supabase.from('channel_files').insert({
        channel_id: channelId, user_id: currentUserId,
        file_name: asset.name, file_url: urlData.publicUrl,
        file_size: asset.size ?? null, mime_type: asset.mimeType ?? null,
      });
      fetchFiles();
    } catch (e: any) { alert(e.message); }
    finally { setUploading(false); }
  };

  const getFileIcon = (mimeType: string | null) => {
    if (!mimeType) return '📄';
    if (mimeType.startsWith('image/')) return '🖼️';
    if (mimeType.startsWith('video/')) return '🎬';
    if (mimeType.includes('pdf')) return '📕';
    if (mimeType.includes('word') || mimeType.includes('document')) return '📝';
    if (mimeType.includes('sheet') || mimeType.includes('excel')) return '📊';
    if (mimeType.includes('zip') || mimeType.includes('archive')) return '📦';
    return '📄';
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.back}>← 戻る</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}># {channelName}</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.tabs}>
        {[
          { key: 'announcements', label: '📢 お知らせ' },
          { key: 'notes', label: '📝 ノート' },
          { key: 'files', label: '📁 ファイル' },
        ].map(t => (
          <TouchableOpacity key={t.key} style={[styles.tab, tab === t.key && styles.tabActive]} onPress={() => setTab(t.key as Tab)}>
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* お知らせタブ */}
      {tab === 'announcements' && (
        <View style={{ flex: 1 }}>
          {isAdmin && (
            <TouchableOpacity style={styles.addBar} onPress={() => openAnnModal()}>
              <Text style={styles.addBarText}>+ お知らせを追加</Text>
            </TouchableOpacity>
          )}
          <FlatList
            data={announcements}
            keyExtractor={i => i.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={<Text style={styles.emptyText}>お知らせはありません</Text>}
            renderItem={({ item }) => (
              <View style={[styles.annCard, item.is_pinned && styles.annCardPinned]}>
                <View style={styles.annHeader}>
                  <View style={styles.annTitleRow}>
                    {item.is_pinned && <Text style={styles.pinIcon}>📌</Text>}
                    <Text style={styles.annTitle}>{item.title}</Text>
                  </View>
                  {isAdmin && (
                    <View style={styles.annActions}>
                      <TouchableOpacity onPress={() => openAnnModal(item)}>
                        <Text style={styles.editText}>編集</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => deleteAnnouncement(item)}>
                        <Text style={styles.deleteText}>削除</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
                <Text style={styles.annContent}>{item.content}</Text>
                <Text style={styles.annMeta}>{item.profiles?.display_name} ・ {new Date(item.created_at).toLocaleDateString('ja-JP')}</Text>
              </View>
            )}
          />
        </View>
      )}

      {/* ノートタブ */}
      {tab === 'notes' && (
        <View style={{ flex: 1 }}>
          <TouchableOpacity style={styles.addBar} onPress={() => openNoteModal()}>
            <Text style={styles.addBarText}>+ ノートを追加</Text>
          </TouchableOpacity>
          <FlatList
            data={notes}
            keyExtractor={i => i.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={<Text style={styles.emptyText}>ノートはありません</Text>}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.noteCard}
                onPress={() => {
                  if (item.user_id === currentUserId || isAdmin) openNoteModal(item);
                  else alert('他のメンバーのノートは編集できません');
                }}
              >
                <Text style={styles.noteTitle}>{item.title}</Text>
                <Text style={styles.noteContent} numberOfLines={2}>{item.content}</Text>
                <Text style={styles.noteMeta}>{item.profiles?.display_name} ・ {new Date(item.updated_at).toLocaleDateString('ja-JP')}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      )}

      {/* ファイルタブ */}
      {tab === 'files' && (
        <View style={{ flex: 1 }}>
          <TouchableOpacity style={[styles.addBar, uploading && { opacity: 0.6 }]} onPress={uploadFile} disabled={uploading}>
            <Text style={styles.addBarText}>{uploading ? '⏳ アップロード中...' : '+ ファイルをアップロード'}</Text>
          </TouchableOpacity>
          <FlatList
            data={files}
            keyExtractor={i => i.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={<Text style={styles.emptyText}>ファイルはありません</Text>}
            renderItem={({ item }) => (
              <View style={styles.fileCard}>
                <Text style={styles.fileIcon}>{getFileIcon(item.mime_type)}</Text>
                <View style={styles.fileInfo}>
                  <Text style={styles.fileName} numberOfLines={1}>{item.file_name}</Text>
                  <Text style={styles.fileMeta}>
                    {item.profiles?.display_name} ・ {formatBytes(item.file_size)} ・ {new Date(item.created_at).toLocaleDateString('ja-JP')}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => deleteFile(item)}>
                  <Text style={styles.deleteText}>🗑</Text>
                </TouchableOpacity>
              </View>
            )}
          />
        </View>
      )}

      {/* ノート・お知らせ編集モーダル */}
      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {tab === 'notes' ? (editNote ? 'ノートを編集' : 'ノートを追加') : (editAnn ? 'お知らせを編集' : 'お知らせを追加')}
              </Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.fieldLabel}>タイトル *</Text>
              <TextInput style={styles.input} value={inputTitle} onChangeText={setInputTitle} placeholder="タイトルを入力" />

              <Text style={styles.fieldLabel}>内容 *</Text>
              <TextInput style={[styles.input, styles.textArea]} value={inputContent} onChangeText={setInputContent} placeholder="内容を入力..." multiline />

              {tab === 'announcements' && (
                <TouchableOpacity style={styles.pinToggle} onPress={() => setIsPinned(!isPinned)}>
                  <Text style={styles.pinToggleText}>{isPinned ? '📌 ピン留め中' : '　ピン留めする'}</Text>
                </TouchableOpacity>
              )}

              <View style={styles.modalButtons}>
                {((tab === 'notes' && editNote && (editNote.user_id === currentUserId || isAdmin)) ||
                  (tab === 'announcements' && editAnn && isAdmin)) && (
                  <TouchableOpacity style={styles.deleteModalButton} onPress={() => tab === 'notes' ? deleteNote(editNote!) : deleteAnnouncement(editAnn!)}>
                    <Text style={styles.deleteModalText}>🗑 削除</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={[styles.saveButton, saving && { opacity: 0.6 }]} onPress={tab === 'notes' ? saveNote : saveAnnouncement} disabled={saving}>
                  <Text style={styles.saveButtonText}>{saving ? '保存中...' : '保存'}</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f8f8' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: 48, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee' },
  back: { color: '#06C755', fontSize: 16, width: 60 },
  headerTitle: { fontSize: 16, fontWeight: 'bold', color: '#333' },
  tabs: { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee' },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: '#06C755' },
  tabText: { fontSize: 13, color: '#999', fontWeight: '500' },
  tabTextActive: { color: '#06C755', fontWeight: 'bold' },
  addBar: { backgroundColor: '#06C755', padding: 14, alignItems: 'center', margin: 12, borderRadius: 12 },
  addBarText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  list: { paddingHorizontal: 12, paddingBottom: 20 },
  emptyText: { textAlign: 'center', color: '#999', fontSize: 14, paddingVertical: 40 },
  annCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: '#eee' },
  annCardPinned: { borderColor: '#06C755', borderWidth: 1.5 },
  annHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  annTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  pinIcon: { fontSize: 14 },
  annTitle: { fontSize: 15, fontWeight: 'bold', color: '#333', flex: 1 },
  annActions: { flexDirection: 'row', gap: 10 },
  editText: { fontSize: 13, color: '#06C755' },
  deleteText: { fontSize: 13, color: '#E24B4A' },
  annContent: { fontSize: 14, color: '#444', lineHeight: 22, marginBottom: 8 },
  annMeta: { fontSize: 12, color: '#999' },
  noteCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: '#eee' },
  noteTitle: { fontSize: 15, fontWeight: 'bold', color: '#333', marginBottom: 4 },
  noteContent: { fontSize: 14, color: '#666', lineHeight: 20, marginBottom: 8 },
  noteMeta: { fontSize: 12, color: '#999' },
  fileCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#eee' },
  fileIcon: { fontSize: 28, marginRight: 12 },
  fileInfo: { flex: 1 },
  fileName: { fontSize: 14, fontWeight: '500', color: '#333', marginBottom: 4 },
  fileMeta: { fontSize: 12, color: '#999' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 48, maxHeight: '90%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#333' },
  modalClose: { fontSize: 18, color: '#999' },
  fieldLabel: { fontSize: 13, color: '#666', fontWeight: '600', marginBottom: 6, marginTop: 12 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 12, fontSize: 15, backgroundColor: '#fafafa' },
  textArea: { height: 160, textAlignVertical: 'top' },
  pinToggle: { marginTop: 14, padding: 12, backgroundColor: '#f0fff4', borderRadius: 10, borderWidth: 1, borderColor: '#06C755' },
  pinToggleText: { fontSize: 14, color: '#06C755', fontWeight: '500', textAlign: 'center' },
  modalButtons: { flexDirection: 'row', gap: 10, marginTop: 24 },
  deleteModalButton: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#fff0f0', alignItems: 'center' },
  deleteModalText: { fontSize: 14, color: '#E24B4A', fontWeight: '500' },
  saveButton: { flex: 2, padding: 14, borderRadius: 10, backgroundColor: '#06C755', alignItems: 'center' },
  saveButtonText: { fontSize: 15, color: '#fff', fontWeight: 'bold' },
});