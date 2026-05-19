import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, Modal, ScrollView } from 'react-native';
import { supabase } from '../lib/supabase';

export interface SharedInvoice {
  id: string;
  source_app: string;
  period_year: number;
  period_month: number;
  title: string;
  driver_name: string | null;
  total_amount: number;
  details: Record<string, unknown> | null;
  external_id: string | null;
  created_by_email: string | null;
  created_at: string;
}

const APP_LABEL: Record<string, { label: string; color: string }> = {
  'delivery-manager': { label: '🚚 配送', color: '#0F766E' },
  'askul-manager':    { label: '📦 アスクル', color: '#DC2626' },
  'shift-manager':    { label: '📰 新聞',   color: '#1E40AF' },
};

interface Props {
  renderHeader: (title: string, right?: React.ReactNode) => React.ReactNode;
}

export function SharedInvoicesView({ renderHeader }: Props) {
  const [invoices, setInvoices] = useState<SharedInvoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<string>('all');  // app filter
  const [view, setView] = useState<SharedInvoice | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('shared_invoices')
      .select('*')
      .order('period_year', { ascending: false })
      .order('period_month', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) console.log('shared_invoices load error', error.message);
    setInvoices((data ?? []) as SharedInvoice[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = filter === 'all' ? invoices : invoices.filter((i) => i.source_app === filter);
  const apps = Array.from(new Set(invoices.map((i) => i.source_app))).sort();

  return (
    <View style={styles.container}>
      {renderHeader('🧾 共有請求書', (
        <TouchableOpacity style={styles.refreshBtn} onPress={load}>
          <Text style={styles.refreshBtnText}>🔄</Text>
        </TouchableOpacity>
      ))}

      {/* フィルタ */}
      <View style={styles.filterRow}>
        <TouchableOpacity
          style={[styles.filterChip, filter === 'all' && styles.filterChipActive]}
          onPress={() => setFilter('all')}
        >
          <Text style={[styles.filterChipText, filter === 'all' && styles.filterChipTextActive]}>
            全て ({invoices.length})
          </Text>
        </TouchableOpacity>
        {apps.map((app) => {
          const meta = APP_LABEL[app] ?? { label: app, color: '#64748B' };
          const count = invoices.filter((i) => i.source_app === app).length;
          const active = filter === app;
          return (
            <TouchableOpacity
              key={app}
              style={[styles.filterChip, active && { backgroundColor: meta.color, borderColor: meta.color }]}
              onPress={() => setFilter(app)}
            >
              <Text style={[styles.filterChipText, active && { color: '#fff' }]}>
                {meta.label} ({count})
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color="#0F766E" />
      ) : filtered.length === 0 ? (
        <Text style={styles.empty}>共有された請求書はまだありません</Text>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ paddingBottom: 40 }}
          renderItem={({ item }) => {
            const meta = APP_LABEL[item.source_app] ?? { label: item.source_app, color: '#64748B' };
            return (
              <TouchableOpacity style={styles.card} onPress={() => setView(item)}>
                <View style={styles.cardHeader}>
                  <View style={[styles.appBadge, { backgroundColor: meta.color }]}>
                    <Text style={styles.appBadgeText}>{meta.label}</Text>
                  </View>
                  <Text style={styles.period}>
                    {item.period_year}年{item.period_month}月分
                  </Text>
                </View>
                <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
                <View style={styles.cardFooter}>
                  <Text style={styles.driver}>{item.driver_name ?? '—'}</Text>
                  <Text style={styles.amount}>
                    ¥{Number(item.total_amount).toLocaleString()}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      {/* 詳細モーダル */}
      <Modal visible={!!view} animationType="slide" transparent onRequestClose={() => setView(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>請求書詳細</Text>
              <TouchableOpacity onPress={() => setView(null)}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={{ flex: 1 }}>
              {view && (
                <View style={{ padding: 16 }}>
                  <Text style={styles.modalLabel}>タイトル</Text>
                  <Text style={styles.modalValue}>{view.title}</Text>

                  <Text style={styles.modalLabel}>対象月</Text>
                  <Text style={styles.modalValue}>{view.period_year}年{view.period_month}月</Text>

                  <Text style={styles.modalLabel}>請求者</Text>
                  <Text style={styles.modalValue}>{view.driver_name ?? '—'} ({view.created_by_email ?? '—'})</Text>

                  <Text style={styles.modalLabel}>金額</Text>
                  <Text style={[styles.modalValue, { fontSize: 20, fontWeight: '700', color: '#0F766E' }]}>
                    ¥{Number(view.total_amount).toLocaleString()}
                  </Text>

                  <Text style={styles.modalLabel}>送信元</Text>
                  <Text style={styles.modalValue}>{view.source_app}</Text>

                  <Text style={styles.modalLabel}>共有日時</Text>
                  <Text style={styles.modalValue}>{new Date(view.created_at).toLocaleString('ja-JP')}</Text>

                  {view.details && (
                    <>
                      <Text style={styles.modalLabel}>内訳</Text>
                      <View style={styles.detailsBox}>
                        <Text style={styles.detailsText}>{JSON.stringify(view.details, null, 2)}</Text>
                      </View>
                    </>
                  )}
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  refreshBtn: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#0F766E', borderRadius: 6 },
  refreshBtnText: { color: '#fff', fontSize: 14 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, padding: 12 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: '#fff' },
  filterChipActive: { backgroundColor: '#0F766E', borderColor: '#0F766E' },
  filterChipText: { fontSize: 12, color: '#475569' },
  filterChipTextActive: { color: '#fff', fontWeight: '600' },
  empty: { textAlign: 'center', color: '#94A3B8', marginTop: 60 },
  card: { backgroundColor: '#fff', marginHorizontal: 12, marginBottom: 8, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  appBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  appBadgeText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  period: { fontSize: 12, color: '#64748B' },
  title: { fontSize: 14, fontWeight: '600', color: '#0F172A', marginBottom: 8 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  driver: { fontSize: 12, color: '#475569' },
  amount: { fontSize: 18, fontWeight: '700', color: '#0F766E' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '85%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderColor: '#E2E8F0' },
  modalTitle: { fontSize: 16, fontWeight: '600' },
  modalClose: { fontSize: 22, color: '#64748B', paddingHorizontal: 8 },
  modalLabel: { fontSize: 11, color: '#64748B', marginTop: 12, fontWeight: '600' },
  modalValue: { fontSize: 14, color: '#0F172A', marginTop: 2 },
  detailsBox: { backgroundColor: '#F1F5F9', padding: 8, borderRadius: 6, marginTop: 4 },
  detailsText: { fontSize: 11, fontFamily: 'monospace', color: '#334155' },
});
