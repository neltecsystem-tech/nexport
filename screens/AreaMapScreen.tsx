import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { supabase } from '../lib/supabase';

type Props = {
  onBack: () => void;
  currentUserId: string | null;
};

type AreaRow = {
  id: string;
  name: string;
  color: string;
  area_data: { towns: string[]; manual: any[] } | null;
  sort_order: number;
};

type SaveUpdate = { id: string; name: string; color: string; area_data: any; sort_order: number };
type SaveInsert = { tempId: string; name: string; color: string; area_data: any; sort_order: number };

export default function AreaMapScreen({ onBack, currentUserId }: Props) {
  const iframeRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const areasRef = useRef<AreaRow[]>([]);
  const editorReadyRef = useRef(false);

  const fetchAreas = useCallback(async () => {
    const { data, error } = await supabase
      .from('business_areas')
      .select('id, name, color, area_data, sort_order')
      .order('sort_order')
      .order('created_at');
    if (error) {
      setError('読込エラー: ' + error.message);
      areasRef.current = [];
    } else {
      areasRef.current = (data ?? []) as AreaRow[];
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAreas();
  }, [fetchAreas]);

  const sendToEditor = (msg: any) => {
    iframeRef.current?.contentWindow?.postMessage(msg, '*');
  };

  const sendCurrentAreas = () => {
    sendToEditor({
      type: 'editor-load',
      payload: { areas: areasRef.current },
    });
  };

  const handleSave = useCallback(
    async (payload: { updates: SaveUpdate[]; inserts: SaveInsert[]; deletes: string[] }) => {
      setSaving(true);
      const idMap: Record<string, string> = {};
      try {
        if (payload.deletes.length > 0) {
          const { error } = await supabase.from('business_areas').delete().in('id', payload.deletes);
          if (error) throw error;
        }
        for (const u of payload.updates) {
          const { error } = await supabase
            .from('business_areas')
            .update({ name: u.name, color: u.color, area_data: u.area_data, sort_order: u.sort_order })
            .eq('id', u.id);
          if (error) throw error;
        }
        for (const ins of payload.inserts) {
          const { data, error } = await supabase
            .from('business_areas')
            .insert({
              name: ins.name,
              color: ins.color,
              area_data: ins.area_data,
              sort_order: ins.sort_order,
              created_by: currentUserId,
            })
            .select('id')
            .single();
          if (error) throw error;
          if (data) idMap[ins.tempId] = data.id;
        }
        await fetchAreas();
        sendToEditor({ type: 'editor-saved', payload: { idMap } });
      } catch (e: any) {
        sendToEditor({ type: 'editor-save-error', payload: { message: e?.message || '不明なエラー' } });
        setError('保存エラー: ' + (e?.message || '不明なエラー'));
      } finally {
        setSaving(false);
      }
    },
    [currentUserId, fetchAreas],
  );

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (e: MessageEvent) => {
      const msg = e.data || {};
      if (msg.type === 'editor-ready') {
        editorReadyRef.current = true;
        sendCurrentAreas();
      } else if (msg.type === 'editor-save' && msg.payload) {
        handleSave(msg.payload);
      } else if (msg.type === 'editor-close') {
        onBack();
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [handleSave, onBack]);

  // After fetch completes, if editor is already ready, push the new list
  useEffect(() => {
    if (editorReadyRef.current && !loading) {
      sendCurrentAreas();
    }
  }, [loading]);

  if (Platform.OS !== 'web') {
    return (
      <View style={styles.nativeFallback}>
        <Text style={styles.nativeFallbackTitle}>🗾 エリア地図</Text>
        <Text style={styles.nativeFallbackText}>この機能はWeb版（ブラウザ）でのみご利用いただけます。</Text>
        <TouchableOpacity onPress={onBack} style={styles.nativeFallbackBtn}>
          <Text style={styles.nativeFallbackBtnText}>← 戻る</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.backBtn}>← 戻る</Text>
        </TouchableOpacity>
        <Text style={styles.title}>🗾 エリア地図</Text>
        <View style={{ width: 60 }} />
      </View>
      <View style={{ flex: 1, position: 'relative' }}>
        {/* @ts-ignore — Web専用iframe */}
        <iframe
          ref={iframeRef as any}
          src="/area-map.html"
          style={{ width: '100%', height: '100%', border: 0, display: 'block' } as any}
          title="area-map-editor"
        />
        {(loading || saving) && (
          <View style={styles.savingOverlay} pointerEvents="none">
            <ActivityIndicator color="#fff" />
            <Text style={styles.savingText}>{saving ? '保存中...' : '読込中...'}</Text>
          </View>
        )}
        {error && (
          <View style={styles.errorBar} pointerEvents="box-none">
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={() => setError(null)} style={styles.errorClose}>
              <Text style={styles.errorCloseText}>×</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
  backBtn: { color: '#1A3C8F', fontSize: 15, width: 60 },
  title: { flex: 1, fontSize: 17, fontWeight: '600', textAlign: 'center', color: '#1f2937' },
  savingOverlay: {
    position: 'absolute', top: 12, right: 12,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(15,23,42,0.85)',
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6,
  },
  savingText: { color: '#fff', fontSize: 12 },
  errorBar: {
    position: 'absolute', top: 12, left: 12, right: 12,
    backgroundColor: '#FEE2E2',
    borderColor: '#FCA5A5', borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6,
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  errorText: { flex: 1, color: '#991B1B', fontSize: 12 },
  errorClose: { paddingHorizontal: 6 },
  errorCloseText: { color: '#991B1B', fontSize: 18, fontWeight: '700' },
  nativeFallback: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, backgroundColor: '#f5f7fa' },
  nativeFallbackTitle: { fontSize: 20, fontWeight: '700', color: '#1f2937', marginBottom: 12 },
  nativeFallbackText: { fontSize: 14, color: '#475569', textAlign: 'center', marginBottom: 24 },
  nativeFallbackBtn: { backgroundColor: '#1A3C8F', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 6 },
  nativeFallbackBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
