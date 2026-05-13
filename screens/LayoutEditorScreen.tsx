import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, ActivityIndicator,
  StyleSheet, Alert, Platform,
} from 'react-native';
import { supabase } from '../lib/supabase';

// ─── Types ────────────────────────────────────────────────────
type Layout = {
  id: string;
  title: string;
  description: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  profiles?: { display_name: string } | null;
};

type LayoutData = {
  version: number;
  title: string;
  canvas: { w: number; h: number };
  shapes: any[];
};

type Props = {
  onBack: () => void;
  currentUserId: string;
};

const EMPTY_LAYOUT: LayoutData = {
  version: 1,
  title: '無題のレイアウト',
  canvas: { w: 50, h: 40 },
  shapes: [],
};

export default function LayoutEditorScreen({ onBack, currentUserId }: Props) {
  const [layouts, setLayouts] = useState<Layout[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ id?: string; data: LayoutData } | null>(null);
  const [saving, setSaving] = useState(false);
  const iframeRef = useRef<any>(null);
  const editingRef = useRef<typeof editing>(null);
  editingRef.current = editing;

  // ── 一覧取得 ──
  const fetchLayouts = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('warehouse_layouts')
      .select('id, title, description, created_by, created_at, updated_at, profiles:created_by(display_name)')
      .order('updated_at', { ascending: false });
    if (error) {
      Alert.alert('読込エラー', error.message);
    } else {
      setLayouts((data as any) || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchLayouts();
  }, [fetchLayouts]);

  // ── 保存処理 ──
  const saveLayout = useCallback(async (payload: LayoutData) => {
    const cur = editingRef.current;
    if (!cur) return;
    setSaving(true);
    const targetId = cur.id;
    try {
      if (targetId) {
        const { error } = await supabase
          .from('warehouse_layouts')
          .update({
            title: payload.title || '無題のレイアウト',
            data: payload,
            updated_by: currentUserId,
          })
          .eq('id', targetId);
        if (error) throw error;
        iframeRef.current?.contentWindow?.postMessage({ type: 'save-completed' }, '*');
      } else {
        const { data, error } = await supabase
          .from('warehouse_layouts')
          .insert({
            title: payload.title || '無題のレイアウト',
            data: payload,
            created_by: currentUserId,
          })
          .select()
          .single();
        if (error) throw error;
        // 以後はUPDATE扱いに切り替え
        setEditing({ id: data.id, data: payload });
        iframeRef.current?.contentWindow?.postMessage({ type: 'save-completed' }, '*');
      }
      await fetchLayouts();
    } catch (e: any) {
      iframeRef.current?.contentWindow?.postMessage({
        type: 'save-error',
        message: e?.message || '保存失敗',
      }, '*');
      Alert.alert('保存エラー', e?.message || '不明なエラー');
    } finally {
      setSaving(false);
    }
  }, [currentUserId, fetchLayouts]);

  // ── iframe メッセージ受信 ──
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (e: MessageEvent) => {
      const msg = e.data || {};
      const cur = editingRef.current;
      if (!cur) return;
      if (msg.type === 'editor-ready') {
        iframeRef.current?.contentWindow?.postMessage({
          type: 'load-layout',
          payload: cur.data,
        }, '*');
      } else if (msg.type === 'editor-save' && msg.payload) {
        saveLayout(msg.payload);
      } else if (msg.type === 'editor-close') {
        setEditing(null);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [saveLayout]);

  // ── 編集開始 ──
  const handleEdit = async (layout: Layout) => {
    const { data, error } = await supabase
      .from('warehouse_layouts')
      .select('id, data')
      .eq('id', layout.id)
      .single();
    if (error) { Alert.alert('読込エラー', error.message); return; }
    setEditing({ id: data.id, data: (data.data as LayoutData) || EMPTY_LAYOUT });
  };

  const handleNew = () => {
    setEditing({ data: { ...EMPTY_LAYOUT } });
  };

  const handleDelete = (layout: Layout) => {
    if (Platform.OS === 'web') {
      if (!window.confirm(`「${layout.title}」を削除しますか？\n（元に戻せません）`)) return;
      doDelete(layout);
    } else {
      Alert.alert('削除確認', `「${layout.title}」を削除しますか？`, [
        { text: 'キャンセル', style: 'cancel' },
        { text: '削除', style: 'destructive', onPress: () => doDelete(layout) },
      ]);
    }
  };

  const doDelete = async (layout: Layout) => {
    const { error } = await supabase.from('warehouse_layouts').delete().eq('id', layout.id);
    if (error) { Alert.alert('削除エラー', error.message); return; }
    fetchLayouts();
  };

  // ── 編集モード（iframe表示） ──
  if (editing) {
    if (Platform.OS !== 'web') {
      return (
        <View style={styles.nativeFallback}>
          <Text style={styles.nativeFallbackTitle}>📐 倉庫レイアウト編集</Text>
          <Text style={styles.nativeFallbackText}>
            この機能はWeb版（ブラウザ）でのみご利用いただけます。
          </Text>
          <TouchableOpacity onPress={() => setEditing(null)} style={styles.nativeFallbackBtn}>
            <Text style={styles.nativeFallbackBtnText}>← 一覧に戻る</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={{ flex: 1, backgroundColor: '#0f1419', position: 'relative' }}>
        {/* @ts-ignore — Web専用iframe */}
        <iframe
          ref={iframeRef as any}
          src="/warehouse-layout.html"
          style={{ width: '100%', height: '100%', border: 0, display: 'block' } as any}
          title="warehouse-layout-editor"
        />
        {saving && (
          <View style={styles.savingOverlay} pointerEvents="none">
            <ActivityIndicator color="#fff" />
            <Text style={styles.savingText}>保存中...</Text>
          </View>
        )}
      </View>
    );
  }

  // ── 一覧モード ──
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.backBtn}>← 戻る</Text>
        </TouchableOpacity>
        <Text style={styles.title}>📐 倉庫レイアウト</Text>
        <TouchableOpacity onPress={handleNew} style={styles.newBtn}>
          <Text style={styles.newBtnText}>+ 新規作成</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#1A3C8F" style={{ marginTop: 60 }} />
      ) : layouts.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📐</Text>
          <Text style={styles.emptyText}>まだレイアウトがありません</Text>
          <Text style={styles.emptyHint}>「+ 新規作成」から始めてください</Text>
        </View>
      ) : (
        <FlatList
          data={layouts}
          keyExtractor={(l) => l.id}
          contentContainerStyle={{ padding: 12 }}
          renderItem={({ item }) => (
            <TouchableOpacity onPress={() => handleEdit(item)} style={styles.card}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.cardMeta}>
                  {item.profiles?.display_name || '不明'} ・ {formatDate(item.updated_at)}
                </Text>
                {item.description ? (
                  <Text style={styles.cardDesc} numberOfLines={1}>{item.description}</Text>
                ) : null}
              </View>
              <View style={styles.cardActions}>
                <TouchableOpacity
                  onPress={() => handleEdit(item)}
                  style={styles.editBtn}
                >
                  <Text style={styles.editBtnText}>編集</Text>
                </TouchableOpacity>
                {item.created_by === currentUserId && (
                  <TouchableOpacity
                    onPress={() => handleDelete(item)}
                    style={styles.delBtn}
                  >
                    <Text style={styles.delBtnText}>🗑️</Text>
                  </TouchableOpacity>
                )}
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleString('ja-JP', {
    year: sameYear ? undefined : 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    backgroundColor: '#fff',
    gap: 12,
  },
  backBtn: { color: '#1A3C8F', fontSize: 15 },
  title: { flex: 1, fontSize: 17, fontWeight: '600', textAlign: 'center', color: '#1f2937' },
  newBtn: {
    backgroundColor: '#10b981',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
  },
  newBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  empty: { padding: 48, alignItems: 'center' },
  emptyIcon: { fontSize: 56 },
  emptyText: { marginTop: 16, color: '#374151', fontSize: 15 },
  emptyHint: { marginTop: 4, color: '#9ca3af', fontSize: 12 },
  card: {
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 8,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#1f2937' },
  cardMeta: { fontSize: 11, color: '#6b7280', marginTop: 3 },
  cardDesc: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  editBtn: { backgroundColor: '#3b82f6', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 4 },
  editBtnText: { color: '#fff', fontSize: 13, fontWeight: '500' },
  delBtn: { paddingHorizontal: 8, paddingVertical: 6 },
  delBtnText: { fontSize: 18 },
  savingOverlay: {
    position: 'absolute',
    top: 16,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  savingText: { color: '#fff', fontSize: 13 },
  nativeFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#f5f7fa' },
  nativeFallbackTitle: { fontSize: 18, fontWeight: '600', color: '#1f2937' },
  nativeFallbackText: { marginTop: 12, color: '#6b7280', textAlign: 'center' },
  nativeFallbackBtn: { marginTop: 24, backgroundColor: '#1A3C8F', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 6 },
  nativeFallbackBtnText: { color: '#fff', fontWeight: '600' },
});
