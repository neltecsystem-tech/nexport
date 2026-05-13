import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, ActivityIndicator,
  ScrollView, StyleSheet, Alert, Platform, Modal,
} from 'react-native';
import { supabase } from '../lib/supabase';

// ─── 設定: 自社情報（必要に応じて編集） ─────────────────────
const COMPANY_INFO = {
  name: 'ネルテック株式会社',
  address: '〒100-0000 東京都千代田区...',
  phone: 'TEL: 03-0000-0000',
  email: 'info@neltec-tokyo.info',
};

// PDF アップロード先のGoogle Driveフォルダ（空文字列でボタン非表示）
// driver_fee（料金表）専用 — 必要なら他のドキュメントタイプにも適用可能
const DRIVE_FOLDER_URL_DRIVER_FEE = 'https://drive.google.com/drive/folders/19t0OICSyLevyUvTWX_S05ceds7b-04w4';

// ─── Types ───────────────────────────────────────────────────
type DocType = 'quotation' | 'order' | 'driver_fee';
type Status = '下書き' | '発行済' | '承認済' | '却下' | '完了' | 'キャンセル';

const DOC_LABELS: Record<DocType, { tab: string; tabIcon: string; title: string; counterpartyLabel: string; subjectLabel: string; printTitle: string; numberPrefix: string }> = {
  quotation: { tab: '見積書', tabIcon: '📄', title: '見積書', counterpartyLabel: '提出先（顧客）', subjectLabel: '件名', printTitle: '御 見 積 書', numberPrefix: 'Q' },
  order:     { tab: '発注書', tabIcon: '📦', title: '発注書', counterpartyLabel: '発注先（仕入先）', subjectLabel: '件名', printTitle: '発 注 書', numberPrefix: 'PO' },
  driver_fee:{ tab: '料金表', tabIcon: '💰', title: '料金表', counterpartyLabel: 'ドライバー', subjectLabel: '件名（業務範囲・契約名等）', printTitle: '料 金 表', numberPrefix: 'D' },
};

type Item = {
  name: string;
  quantity: number;
  unit: string;
  unit_price: number;
  amount: number;
  note?: string;
  fee_item_id?: string | null;
};

type Assignment = { id: string; name: string; sort_order: number };
type Office = { id: string; assignment_id: string; name: string; sort_order: number };
type FeeItem = { id: string; assignment_id: string; name: string; unit: string; default_price: number; sort_order: number };

type Doc = {
  id: string;
  doc_type: DocType;
  doc_number: string | null;
  status: Status;
  title: string;
  counterparty_name: string | null;
  counterparty_address: string | null;
  counterparty_contact: string | null;
  counterparty_phone: string | null;
  counterparty_email: string | null;
  issue_date: string;
  valid_until: string | null;
  delivery_date: string | null;
  delivery_location: string | null;
  payment_terms: string | null;
  notes: string | null;
  items: Item[];
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  withhold_tax_rate: number;
  withhold_amount: number;
  net_payable: number;
  assignment_id: string | null;
  office_id: string | null;
  source_quotation_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  profiles?: { display_name: string } | null;
};

type Mode = 'list' | 'edit' | 'print';

type Props = {
  onBack: () => void;
  currentUserId: string;
};

const STATUS_COLORS: Record<Status, { bg: string; text: string }> = {
  '下書き':     { bg: '#f3f4f6', text: '#6b7280' },
  '発行済':     { bg: '#dbeafe', text: '#1e40af' },
  '承認済':     { bg: '#d1fae5', text: '#065f46' },
  '却下':       { bg: '#fee2e2', text: '#991b1b' },
  '完了':       { bg: '#ecfccb', text: '#365314' },
  'キャンセル': { bg: '#f3f4f6', text: '#6b7280' },
};
const STATUS_LIST: Status[] = ['下書き','発行済','承認済','却下','完了','キャンセル'];

const EMPTY_ITEM: Item = { name: '', quantity: 1, unit: '', unit_price: 0, amount: 0 };

// ─── Helpers ──────────────────────────────────────────────────
const fmtMoney = (n: number) => '¥' + Math.round(n).toLocaleString('ja-JP');
const fmtDate = (s: string | null | undefined) => s || '';
const today = () => new Date().toISOString().slice(0, 10);

function calcItem(it: Item): Item {
  const amount = Math.round((Number(it.quantity) || 0) * (Number(it.unit_price) || 0));
  return { ...it, amount };
}
function calcTotals(items: Item[], taxRate: number, withholdRate: number = 0) {
  const subtotal = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  const tax_amount = Math.round(subtotal * (taxRate / 100));
  const total = subtotal + tax_amount;
  const withhold_amount = Math.round(subtotal * ((withholdRate || 0) / 100));
  const net_payable = total - withhold_amount;
  return { subtotal, tax_amount, total, withhold_amount, net_payable };
}

function newDoc(docType: DocType, currentUserId: string): Doc {
  return {
    id: '',
    doc_type: docType,
    doc_number: '',
    status: '下書き',
    title: '',
    counterparty_name: '',
    counterparty_address: '',
    counterparty_contact: '',
    counterparty_phone: '',
    counterparty_email: '',
    issue_date: today(),
    valid_until: docType === 'quotation' ? addDays(today(), 30) : null,
    delivery_date: null,
    delivery_location: '',
    payment_terms: '',
    notes: '',
    items: [{ ...EMPTY_ITEM }],
    subtotal: 0,
    tax_rate: 10,
    tax_amount: 0,
    total: 0,
    withhold_tax_rate: docType === 'driver_fee' ? 10.21 : 0,
    withhold_amount: 0,
    net_payable: 0,
    assignment_id: null,
    office_id: null,
    source_quotation_id: null,
    created_by: currentUserId,
    created_at: '',
    updated_at: '',
  };
}

function addDays(iso: string, days: number) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function generateDocNumber(docType: DocType): Promise<string> {
  const prefix = DOC_LABELS[docType].numberPrefix;
  const year = new Date().getFullYear();
  const pat = `${prefix}-${year}-`;
  const { data } = await supabase
    .from('quotations_orders')
    .select('doc_number')
    .eq('doc_type', docType)
    .like('doc_number', pat + '%')
    .order('doc_number', { ascending: false })
    .limit(1);
  let next = 1;
  if (data && data[0]?.doc_number) {
    const m = String(data[0].doc_number).match(/-(\d+)$/);
    if (m) next = parseInt(m[1], 10) + 1;
  }
  return `${pat}${String(next).padStart(4, '0')}`;
}

// ─── Component ────────────────────────────────────────────────
export default function QuotationOrderScreen({ onBack, currentUserId }: Props) {
  const [tab, setTab] = useState<DocType>('quotation');
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>('list');
  const [editing, setEditing] = useState<Doc | null>(null);
  const [saving, setSaving] = useState(false);
  // マスタ
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [feeItems, setFeeItems] = useState<FeeItem[]>([]);
  // マスタ管理モーダル
  const [masterModal, setMasterModal] = useState<null | { type: 'assignment' | 'office' | 'fee_item'; assignment_id?: string }>(null);
  const [manageModalOpen, setManageModalOpen] = useState(false);

  // 印刷用CSS注入（web only）
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const style = document.createElement('style');
    style.id = 'qo-print-style';
    style.textContent = `
      @media print {
        body * { visibility: hidden !important; }
        .qo-print-area, .qo-print-area * { visibility: visible !important; }
        .qo-print-area { position: absolute; left: 0; top: 0; width: 100%; padding: 20mm; background: white; }
        .qo-no-print { display: none !important; }
        @page { size: A4; margin: 15mm; }
      }
    `;
    document.head.appendChild(style);
    return () => { document.getElementById('qo-print-style')?.remove(); };
  }, []);

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('quotations_orders')
      .select('*, profiles:created_by(display_name)')
      .eq('doc_type', tab)
      .order('updated_at', { ascending: false });
    if (error) Alert.alert('読込エラー', error.message);
    else setDocs((data as any) || []);
    setLoading(false);
  }, [tab]);

  const fetchMasters = useCallback(async () => {
    const [a, o, f] = await Promise.all([
      supabase.from('qo_assignments').select('*').order('sort_order').order('name'),
      supabase.from('qo_offices').select('*').order('sort_order').order('name'),
      supabase.from('qo_fee_items').select('*').order('sort_order').order('name'),
    ]);
    if (a.data) setAssignments(a.data as any);
    if (o.data) setOffices(o.data as any);
    if (f.data) setFeeItems(f.data as any);
  }, []);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);
  useEffect(() => { fetchMasters(); }, [fetchMasters]);

  // マスタ追加
  const addMaster = async (vals: { type: 'assignment' | 'office' | 'fee_item'; name: string; assignment_id?: string; unit?: string; default_price?: number }) => {
    if (!vals.name?.trim()) return;
    if (vals.type === 'assignment') {
      const { error } = await supabase.from('qo_assignments').insert({ name: vals.name.trim(), sort_order: assignments.length + 1 });
      if (error) { Alert.alert('追加エラー', error.message); return; }
    } else if (vals.type === 'office') {
      if (!vals.assignment_id) { Alert.alert('情報', '配属を先に選択してください'); return; }
      const { error } = await supabase.from('qo_offices').insert({ name: vals.name.trim(), assignment_id: vals.assignment_id, sort_order: offices.length + 1 });
      if (error) { Alert.alert('追加エラー', error.message); return; }
    } else if (vals.type === 'fee_item') {
      if (!vals.assignment_id) { Alert.alert('情報', '配属を先に選択してください'); return; }
      const { error } = await supabase.from('qo_fee_items').insert({
        name: vals.name.trim(),
        assignment_id: vals.assignment_id,
        unit: vals.unit || '',
        default_price: vals.default_price || 0,
        sort_order: feeItems.length + 1,
      });
      if (error) { Alert.alert('追加エラー', error.message); return; }
    }
    await fetchMasters();
  };

  // マスタ更新
  const updateMaster = async (type: 'assignment' | 'office' | 'fee_item', id: string, patch: any) => {
    const table = type === 'assignment' ? 'qo_assignments' : type === 'office' ? 'qo_offices' : 'qo_fee_items';
    const { error } = await supabase.from(table).update(patch).eq('id', id);
    if (error) { Alert.alert('更新エラー', error.message); return; }
    await fetchMasters();
  };

  // マスタ削除
  const deleteMaster = async (type: 'assignment' | 'office' | 'fee_item', id: string, name: string) => {
    let confirmMsg = `「${name}」を削除しますか？`;
    if (type === 'assignment') {
      confirmMsg = `配属「${name}」を削除すると、紐づく営業所・料金項目も全て削除されます。本当に削除しますか？`;
    }
    const ok = Platform.OS === 'web' ? window.confirm(confirmMsg) : true;
    if (!ok) return;
    if (Platform.OS !== 'web') {
      Alert.alert('削除確認', confirmMsg, [
        { text: 'キャンセル', style: 'cancel' },
        { text: '削除', style: 'destructive', onPress: () => doDeleteMaster(type, id) },
      ]);
    } else {
      doDeleteMaster(type, id);
    }
  };
  const doDeleteMaster = async (type: 'assignment' | 'office' | 'fee_item', id: string) => {
    const table = type === 'assignment' ? 'qo_assignments' : type === 'office' ? 'qo_offices' : 'qo_fee_items';
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) { Alert.alert('削除エラー', error.message); return; }
    await fetchMasters();
  };

  const handleNew = async () => {
    const docNumber = await generateDocNumber(tab);
    const d = newDoc(tab, currentUserId);
    d.doc_number = docNumber;
    setEditing(d);
    setMode('edit');
  };

  const handleEdit = (d: Doc) => {
    setEditing({ ...d, items: Array.isArray(d.items) && d.items.length > 0 ? d.items : [{ ...EMPTY_ITEM }] });
    setMode('edit');
  };

  const handlePrint = (d: Doc) => {
    setEditing(d);
    setMode('print');
    setTimeout(() => {
      if (Platform.OS === 'web') window.print();
    }, 250);
  };

  const handleDelete = (d: Doc) => {
    const ok = (Platform.OS === 'web')
      ? window.confirm(`「${d.title || d.doc_number}」を削除しますか？`)
      : true;
    if (!ok) return;
    if (Platform.OS !== 'web') {
      Alert.alert('削除確認', `「${d.title || d.doc_number}」を削除しますか？`, [
        { text: 'キャンセル', style: 'cancel' },
        { text: '削除', style: 'destructive', onPress: () => doDelete(d) },
      ]);
    } else {
      doDelete(d);
    }
  };
  const doDelete = async (d: Doc) => {
    const { error } = await supabase.from('quotations_orders').delete().eq('id', d.id);
    if (error) { Alert.alert('削除エラー', error.message); return; }
    fetchDocs();
  };

  const handleSave = async () => {
    if (!editing) return;
    setSaving(true);
    const totals = calcTotals(editing.items, editing.tax_rate, editing.withhold_tax_rate);
    const payload = {
      doc_type: editing.doc_type,
      doc_number: editing.doc_number || null,
      status: editing.status,
      title: editing.title || '無題',
      counterparty_name: editing.counterparty_name || null,
      counterparty_address: editing.counterparty_address || null,
      counterparty_contact: editing.counterparty_contact || null,
      counterparty_phone: editing.counterparty_phone || null,
      counterparty_email: editing.counterparty_email || null,
      issue_date: editing.issue_date,
      valid_until: editing.valid_until || null,
      delivery_date: editing.delivery_date || null,
      delivery_location: editing.delivery_location || null,
      payment_terms: editing.payment_terms || null,
      notes: editing.notes || null,
      items: editing.items,
      subtotal: totals.subtotal,
      tax_rate: editing.tax_rate,
      tax_amount: totals.tax_amount,
      total: totals.total,
      withhold_tax_rate: editing.withhold_tax_rate || 0,
      withhold_amount: totals.withhold_amount,
      net_payable: totals.net_payable,
      assignment_id: editing.assignment_id || null,
      office_id: editing.office_id || null,
      source_quotation_id: editing.source_quotation_id || null,
      updated_by: currentUserId,
    };
    if (editing.id) {
      const { error } = await supabase.from('quotations_orders').update(payload).eq('id', editing.id);
      if (error) { Alert.alert('保存エラー', error.message); setSaving(false); return; }
    } else {
      const { error } = await supabase.from('quotations_orders').insert({ ...payload, created_by: currentUserId });
      if (error) { Alert.alert('保存エラー', error.message); setSaving(false); return; }
    }
    setSaving(false);
    setMode('list');
    setEditing(null);
    fetchDocs();
  };

  const handleConvertToOrder = async (d: Doc) => {
    if (d.doc_type !== 'quotation') return;
    const ok = (Platform.OS === 'web')
      ? window.confirm(`この見積書から発注書を作成しますか？\n（明細・取引先がコピーされます）`)
      : true;
    if (!ok) return;
    const docNumber = await generateDocNumber('order');
    const newOrder: Doc = {
      ...d,
      id: '',
      doc_type: 'order',
      doc_number: docNumber,
      status: '下書き',
      issue_date: today(),
      valid_until: null,
      delivery_date: addDays(today(), 14),
      source_quotation_id: d.id,
      created_at: '', updated_at: '',
    };
    setEditing(newOrder);
    setTab('order');
    setMode('edit');
  };

  // ═══════════ 印刷モード ═══════════
  if (mode === 'print' && editing) {
    return <PrintView doc={editing} onClose={() => { setMode('list'); setEditing(null); }} assignments={assignments} offices={offices} />;
  }

  // ═══════════ 編集モード ═══════════
  if (mode === 'edit' && editing) {
    return (
      <>
        <EditView
          doc={editing}
          onChange={setEditing}
          onSave={handleSave}
          onCancel={() => { setMode('list'); setEditing(null); }}
          onPrint={() => editing.id ? handlePrint(editing) : Alert.alert('情報', '先に保存してから印刷してください')}
          saving={saving}
          assignments={assignments}
          offices={offices}
          feeItems={feeItems}
          openMasterModal={(type, assignment_id) => setMasterModal({ type, assignment_id })}
          openManageModal={() => setManageModalOpen(true)}
        />
        <MasterAddModal
          modal={masterModal}
          assignments={assignments}
          onClose={() => setMasterModal(null)}
          onSubmit={async (vals) => { await addMaster(vals); setMasterModal(null); }}
        />
        <MasterManageModal
          open={manageModalOpen}
          onClose={() => setManageModalOpen(false)}
          assignments={assignments}
          offices={offices}
          feeItems={feeItems}
          onUpdate={updateMaster}
          onDelete={deleteMaster}
          onAdd={(type, assignment_id) => setMasterModal({ type, assignment_id })}
        />
      </>
    );
  }

  // ═══════════ 一覧モード ═══════════
  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}><Text style={styles.backBtn}>← 戻る</Text></TouchableOpacity>
        <Text style={styles.title}>📋 見積/発注/料金表</Text>
        <TouchableOpacity onPress={handleNew} style={styles.newBtn}>
          <Text style={styles.newBtnText}>+ 新規 {DOC_LABELS[tab].tab}</Text>
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {(['quotation','order','driver_fee'] as DocType[]).map(t => (
          <TouchableOpacity
            key={t}
            onPress={() => setTab(t)}
            style={[styles.tab, tab === t && styles.tabActive]}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{DOC_LABELS[t].tabIcon} {DOC_LABELS[t].tab}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* List */}
      {loading ? (
        <ActivityIndicator size="large" color="#1A3C8F" style={{ marginTop: 60 }} />
      ) : docs.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>{DOC_LABELS[tab].tabIcon}</Text>
          <Text style={styles.emptyText}>まだ{DOC_LABELS[tab].tab}がありません</Text>
          <Text style={styles.emptyHint}>右上の「新規」から作成してください</Text>
        </View>
      ) : (
        <FlatList
          data={docs}
          keyExtractor={(d) => d.id}
          contentContainerStyle={{ padding: 12 }}
          renderItem={({ item }) => (
            <TouchableOpacity onPress={() => handleEdit(item)} style={styles.card}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {item.doc_number ? (
                    <Text style={styles.docNumber}>{item.doc_number}</Text>
                  ) : null}
                  <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[item.status]?.bg }]}>
                    <Text style={[styles.statusText, { color: STATUS_COLORS[item.status]?.text }]}>{item.status}</Text>
                  </View>
                  <Text style={styles.cardTitle} numberOfLines={1}>{item.title || '無題'}</Text>
                </View>
                <Text style={styles.cardMeta}>
                  {item.doc_type === 'driver_fee' && item.assignment_id
                    ? `${assignments.find(a => a.id === item.assignment_id)?.name || ''}${item.office_id ? ' / ' + (offices.find(o => o.id === item.office_id)?.name || '') : ''} ・ ${item.counterparty_name || '未入力'}`
                    : (item.counterparty_name || '取引先未入力')
                  } ・ {fmtMoney(item.total)}
                </Text>
                <Text style={styles.cardMeta2}>
                  発行: {item.issue_date} ・ {item.profiles?.display_name || '不明'} ・ 更新: {new Date(item.updated_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
              <View style={{ flexDirection: 'column', gap: 4, marginLeft: 8 }}>
                <TouchableOpacity onPress={() => handlePrint(item)} style={styles.smallBtn}>
                  <Text style={styles.smallBtnText}>🖨️ 印刷</Text>
                </TouchableOpacity>
                {item.doc_type === 'quotation' && (
                  <TouchableOpacity onPress={() => handleConvertToOrder(item)} style={[styles.smallBtn, { backgroundColor: '#10b981' }]}>
                    <Text style={[styles.smallBtnText, { color: '#fff' }]}>→発注</Text>
                  </TouchableOpacity>
                )}
                {item.created_by === currentUserId && (
                  <TouchableOpacity onPress={() => handleDelete(item)} style={[styles.smallBtn, { backgroundColor: '#fee2e2' }]}>
                    <Text style={[styles.smallBtnText, { color: '#dc2626' }]}>🗑️</Text>
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

// ═══════════════════════════════════════════════════════════════
// 編集ビュー
// ═══════════════════════════════════════════════════════════════
function EditView({ doc, onChange, onSave, onCancel, onPrint, saving, assignments, offices, feeItems, openMasterModal, openManageModal }: {
  doc: Doc;
  onChange: (d: Doc) => void;
  onSave: () => void;
  onCancel: () => void;
  onPrint: () => void;
  saving: boolean;
  assignments: Assignment[];
  offices: Office[];
  feeItems: FeeItem[];
  openMasterModal: (type: 'assignment' | 'office' | 'fee_item', assignment_id?: string) => void;
  openManageModal: () => void;
}) {
  const isQuote = doc.doc_type === 'quotation';
  const isDriverFee = doc.doc_type === 'driver_fee';
  const labels = DOC_LABELS[doc.doc_type];
  const totals = useMemo(() => calcTotals(doc.items, doc.tax_rate, doc.withhold_tax_rate), [doc.items, doc.tax_rate, doc.withhold_tax_rate]);
  const filteredOffices = useMemo(() => offices.filter(o => !doc.assignment_id || o.assignment_id === doc.assignment_id), [offices, doc.assignment_id]);
  const filteredFeeItems = useMemo(() => feeItems.filter(f => !doc.assignment_id || f.assignment_id === doc.assignment_id), [feeItems, doc.assignment_id]);

  const update = (patch: Partial<Doc>) => onChange({ ...doc, ...patch });

  const updateItem = (i: number, patch: Partial<Item>) => {
    const items = [...doc.items];
    items[i] = calcItem({ ...items[i], ...patch });
    onChange({ ...doc, items });
  };
  const setItemFromFeeItem = (i: number, feeItemId: string) => {
    const f = feeItems.find(fi => fi.id === feeItemId);
    if (!f) return;
    updateItem(i, { name: f.name, unit: f.unit || '', unit_price: f.default_price || 0, fee_item_id: feeItemId });
  };
  const addItem = () => onChange({ ...doc, items: [...doc.items, { ...EMPTY_ITEM }] });
  const removeItem = (i: number) => {
    const items = doc.items.filter((_, idx) => idx !== i);
    onChange({ ...doc, items: items.length > 0 ? items : [{ ...EMPTY_ITEM }] });
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onCancel}><Text style={styles.backBtn}>← キャンセル</Text></TouchableOpacity>
        <Text style={styles.title}>{labels.title} 編集</Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <TouchableOpacity onPress={onPrint} style={styles.editBarBtn}>
            <Text style={styles.editBarBtnText}>🖨️ 印刷</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onSave} disabled={saving} style={[styles.editBarBtn, { backgroundColor: '#10b981' }]}>
            <Text style={[styles.editBarBtnText, { color: '#fff' }]}>{saving ? '保存中...' : '💾 保存'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
        {/* 基本情報 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>基本情報</Text>
          <View style={styles.row2}>
            <Field label="文書番号">
              <TextInput value={doc.doc_number || ''} onChangeText={t => update({ doc_number: t })} style={styles.input} placeholder="例: Q-2026-0001" />
            </Field>
            <Field label="状態">
              <View style={styles.pickerWrap}>
                {STATUS_LIST.map(s => (
                  <TouchableOpacity key={s} onPress={() => update({ status: s })}
                    style={[styles.statusPick, doc.status === s && { backgroundColor: STATUS_COLORS[s].bg, borderColor: STATUS_COLORS[s].text }]}>
                    <Text style={[styles.statusPickText, doc.status === s && { color: STATUS_COLORS[s].text, fontWeight: '600' }]}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </Field>
          </View>
          <Field label={labels.subjectLabel}>
            <TextInput value={doc.title} onChangeText={t => update({ title: t })} style={styles.input} placeholder={isDriverFee ? '例: 2026年4月分 配送業務' : '例: 倉庫レイアウト変更工事 一式'} />
          </Field>
          <View style={styles.row2}>
            <Field label="発行日">
              <TextInput value={doc.issue_date} onChangeText={t => update({ issue_date: t })} style={styles.input} placeholder="YYYY-MM-DD" />
            </Field>
            {isQuote ? (
              <Field label="有効期限">
                <TextInput value={doc.valid_until || ''} onChangeText={t => update({ valid_until: t })} style={styles.input} placeholder="YYYY-MM-DD" />
              </Field>
            ) : !isDriverFee ? (
              <Field label="希望納期">
                <TextInput value={doc.delivery_date || ''} onChangeText={t => update({ delivery_date: t })} style={styles.input} placeholder="YYYY-MM-DD" />
              </Field>
            ) : <View style={{ flex: 1 }} />}
          </View>
        </View>

        {isDriverFee ? (
          /* === driver_fee 専用 簡素フォーム === */
          <View style={styles.section}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>配属・営業所・ドライバー</Text>
              <TouchableOpacity onPress={openManageModal} style={styles.miniBtn}>
                <Text style={styles.miniBtnText}>⚙️ マスタ管理（編集・削除）</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.row2}>
              <Field label="配属">
                <View style={{ flexDirection: 'row', gap: 4 }}>
                  <View style={{ flex: 1 }}>
                    {/* @ts-ignore */}
                    <select
                      value={doc.assignment_id || ''}
                      onChange={(e: any) => {
                        const aid = e.target.value || null;
                        update({ assignment_id: aid, office_id: null });
                      }}
                      style={selectStyle}>
                      <option value="">選択してください</option>
                      {assignments.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </View>
                  <TouchableOpacity onPress={() => openMasterModal('assignment')} style={styles.miniBtn}>
                    <Text style={styles.miniBtnText}>+ 追加</Text>
                  </TouchableOpacity>
                </View>
              </Field>
              <Field label="営業所">
                <View style={{ flexDirection: 'row', gap: 4 }}>
                  <View style={{ flex: 1 }}>
                    {/* @ts-ignore */}
                    <select
                      value={doc.office_id || ''}
                      onChange={(e: any) => update({ office_id: e.target.value || null })}
                      disabled={!doc.assignment_id}
                      style={{ ...selectStyle, opacity: doc.assignment_id ? 1 : 0.5 }}>
                      <option value="">{doc.assignment_id ? '選択してください' : '先に配属を選択'}</option>
                      {filteredOffices.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </View>
                  <TouchableOpacity
                    onPress={() => doc.assignment_id ? openMasterModal('office', doc.assignment_id) : Alert.alert('情報', '先に配属を選択してください')}
                    style={[styles.miniBtn, !doc.assignment_id && { opacity: 0.5 }]}>
                    <Text style={styles.miniBtnText}>+ 追加</Text>
                  </TouchableOpacity>
                </View>
              </Field>
            </View>
            <Field label="ドライバー氏名">
              <TextInput value={doc.counterparty_name || ''} onChangeText={t => update({ counterparty_name: t })} style={styles.input} placeholder="例: 山田 太郎" />
            </Field>
          </View>
        ) : (
          /* === 見積/発注 用 取引先フォーム === */
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{labels.counterpartyLabel}</Text>
            <Field label="会社名">
              <TextInput value={doc.counterparty_name || ''} onChangeText={t => update({ counterparty_name: t })} style={styles.input} />
            </Field>
            <View style={styles.row2}>
              <Field label="担当者">
                <TextInput value={doc.counterparty_contact || ''} onChangeText={t => update({ counterparty_contact: t })} style={styles.input} />
              </Field>
              <Field label="電話">
                <TextInput value={doc.counterparty_phone || ''} onChangeText={t => update({ counterparty_phone: t })} style={styles.input} />
              </Field>
            </View>
            <View style={styles.row2}>
              <Field label="メール">
                <TextInput value={doc.counterparty_email || ''} onChangeText={t => update({ counterparty_email: t })} style={styles.input} />
              </Field>
              <Field label="住所">
                <TextInput value={doc.counterparty_address || ''} onChangeText={t => update({ counterparty_address: t })} style={styles.input} />
              </Field>
            </View>
          </View>
        )}

        {/* 明細 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>明細</Text>
          <View style={styles.itemHeader}>
            <Text style={[styles.itemHeaderCell, { flex: 3 }]}>品名</Text>
            <Text style={[styles.itemHeaderCell, { width: 60 }]}>数量</Text>
            <Text style={[styles.itemHeaderCell, { width: 60 }]}>単位</Text>
            <Text style={[styles.itemHeaderCell, { width: 100 }]}>単価</Text>
            <Text style={[styles.itemHeaderCell, { width: 110, textAlign: 'right' }]}>金額</Text>
            <Text style={[styles.itemHeaderCell, { width: 32 }]}></Text>
          </View>
          {doc.items.map((it, i) => (
            <View key={i} style={styles.itemRow}>
              {isDriverFee ? (
                <View style={{ flex: 3, paddingHorizontal: 2 }}>
                  {/* @ts-ignore */}
                  <select
                    value={it.fee_item_id || ''}
                    onChange={(e: any) => {
                      const v = e.target.value;
                      if (v) setItemFromFeeItem(i, v);
                      else updateItem(i, { fee_item_id: null });
                    }}
                    style={{ ...selectStyle, padding: '6px 8px', fontSize: 13 }}>
                    <option value="">{doc.assignment_id ? '料金項目を選択' : '先に配属を選択'}</option>
                    {filteredFeeItems.map(f => <option key={f.id} value={f.id}>{f.name}{f.unit ? ` (${f.unit})` : ''}{f.default_price ? ` ¥${f.default_price.toLocaleString()}` : ''}</option>)}
                  </select>
                </View>
              ) : (
                <TextInput value={it.name} onChangeText={t => updateItem(i, { name: t })} style={[styles.itemInput, { flex: 3 }]} placeholder="品名" />
              )}
              <TextInput value={String(it.quantity ?? '')} onChangeText={t => updateItem(i, { quantity: parseFloat(t) || 0 })} keyboardType="numeric" style={[styles.itemInput, { width: 60, textAlign: 'right' }]} />
              <TextInput value={it.unit} onChangeText={t => updateItem(i, { unit: t })} style={[styles.itemInput, { width: 60 }]} placeholder="個" />
              <TextInput value={String(it.unit_price ?? '')} onChangeText={t => updateItem(i, { unit_price: parseFloat(t) || 0 })} keyboardType="numeric" style={[styles.itemInput, { width: 100, textAlign: 'right' }]} />
              <Text style={[styles.itemAmount, { width: 110 }]}>{fmtMoney(it.amount)}</Text>
              <TouchableOpacity onPress={() => removeItem(i)} style={{ width: 32, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 16, color: '#ef4444' }}>×</Text>
              </TouchableOpacity>
            </View>
          ))}
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
            <TouchableOpacity onPress={addItem} style={[styles.addItemBtn, { flex: 1 }]}>
              <Text style={styles.addItemBtnText}>+ 行を追加</Text>
            </TouchableOpacity>
            {isDriverFee && (
              <TouchableOpacity
                onPress={() => doc.assignment_id ? openMasterModal('fee_item', doc.assignment_id) : Alert.alert('情報', '先に配属を選択してください')}
                style={[styles.addItemBtn, { flex: 1, backgroundColor: '#dcfce7' }, !doc.assignment_id && { opacity: 0.5 }]}>
                <Text style={[styles.addItemBtnText, { color: '#166534' }]}>+ 料金項目をマスタに追加</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* 合計（料金表では非表示） */}
          {!isDriverFee && (
            <View style={styles.totalsBox}>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>小計</Text>
                <Text style={styles.totalValue}>{fmtMoney(totals.subtotal)}</Text>
              </View>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>消費税率</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <TextInput value={String(doc.tax_rate)} onChangeText={t => update({ tax_rate: parseFloat(t) || 0 })} keyboardType="numeric" style={[styles.input, { width: 60, marginBottom: 0, textAlign: 'right' }]} />
                  <Text>%</Text>
                </View>
              </View>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>消費税</Text>
                <Text style={styles.totalValue}>{fmtMoney(totals.tax_amount)}</Text>
              </View>
              <View style={[styles.totalRow, { borderTopWidth: 1, borderTopColor: '#e5e7eb', paddingTop: 8, marginTop: 4 }]}>
                <Text style={[styles.totalLabel, { fontSize: 16, fontWeight: '700' }]}>合計</Text>
                <Text style={[styles.totalValue, { fontSize: 18, fontWeight: '700', color: '#1A3C8F' }]}>{fmtMoney(totals.total)}</Text>
              </View>
            </View>
          )}
        </View>

        {/* 追加情報 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>その他</Text>
          {!isQuote && !isDriverFee && (
            <>
              <Field label="納入場所">
                <TextInput value={doc.delivery_location || ''} onChangeText={t => update({ delivery_location: t })} style={styles.input} />
              </Field>
              <Field label="支払条件">
                <TextInput value={doc.payment_terms || ''} onChangeText={t => update({ payment_terms: t })} style={styles.input} placeholder="例: 月末締め翌月末払い" />
              </Field>
            </>
          )}
          <Field label="備考">
            <TextInput value={doc.notes || ''} onChangeText={t => update({ notes: t })} style={[styles.input, { minHeight: 80 }]} multiline />
          </Field>
        </View>

        <View style={{ height: 60 }} />
      </ScrollView>
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 10, flex: 1 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════
// マスタ追加モーダル
// ═══════════════════════════════════════════════════════════════
function MasterAddModal({ modal, assignments, onClose, onSubmit }: {
  modal: null | { type: 'assignment' | 'office' | 'fee_item'; assignment_id?: string };
  assignments: Assignment[];
  onClose: () => void;
  onSubmit: (vals: { type: 'assignment' | 'office' | 'fee_item'; name: string; assignment_id?: string; unit?: string; default_price?: number }) => void;
}) {
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [price, setPrice] = useState('');
  useEffect(() => {
    if (modal) { setName(''); setUnit(''); setPrice(''); }
  }, [modal]);
  if (!modal) return null;
  const titles: Record<typeof modal.type, string> = {
    assignment: '配属を追加',
    office: '営業所を追加',
    fee_item: '料金項目を追加',
  };
  const parentName = modal.assignment_id ? assignments.find(a => a.id === modal.assignment_id)?.name : '';
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={modalStyles.overlay}>
        <View style={modalStyles.dialog}>
          <Text style={modalStyles.title}>{titles[modal.type]}</Text>
          {modal.type !== 'assignment' && (
            <Text style={modalStyles.subtitle}>配属: {parentName || '不明'}</Text>
          )}
          <Text style={modalStyles.label}>名前 <Text style={{ color: '#ef4444' }}>*</Text></Text>
          <TextInput
            value={name}
            onChangeText={setName}
            style={modalStyles.input}
            placeholder={modal.type === 'assignment' ? '例: ロジザード' : modal.type === 'office' ? '例: 杉並営業所' : '例: 個建単価'}
            autoFocus
          />
          {modal.type === 'fee_item' && (
            <>
              <Text style={modalStyles.label}>単位（任意）</Text>
              <TextInput
                value={unit}
                onChangeText={setUnit}
                style={modalStyles.input}
                placeholder="例: 件 / 回 / 日 / 式"
              />
              <Text style={modalStyles.label}>標準単価（任意）</Text>
              <TextInput
                value={price}
                onChangeText={setPrice}
                style={modalStyles.input}
                placeholder="例: 800"
                keyboardType="numeric"
              />
            </>
          )}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
            <TouchableOpacity onPress={onClose} style={[modalStyles.btn, { backgroundColor: '#e5e7eb' }]}>
              <Text style={modalStyles.btnText}>キャンセル</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                if (!name.trim()) { Alert.alert('情報', '名前を入力してください'); return; }
                onSubmit({
                  type: modal.type,
                  name: name.trim(),
                  assignment_id: modal.assignment_id,
                  unit: unit || undefined,
                  default_price: price ? parseFloat(price) : undefined,
                });
              }}
              style={[modalStyles.btn, { backgroundColor: '#10b981' }]}>
              <Text style={[modalStyles.btnText, { color: '#fff', fontWeight: '600' }]}>追加</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  dialog: { width: 360, maxWidth: '90%', backgroundColor: '#fff', borderRadius: 8, padding: 20 },
  title: { fontSize: 16, fontWeight: '700', color: '#1f2937', marginBottom: 4 },
  subtitle: { fontSize: 12, color: '#6b7280', marginBottom: 12 },
  label: { fontSize: 12, color: '#6b7280', marginBottom: 4, marginTop: 8 },
  input: { backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#e5e7eb', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 4, fontSize: 14 },
  btn: { flex: 1, paddingVertical: 10, borderRadius: 4, alignItems: 'center' },
  btnText: { fontSize: 14, color: '#374151' },
});

// ═══════════════════════════════════════════════════════════════
// マスタ管理モーダル（一覧・編集・削除）
// ═══════════════════════════════════════════════════════════════
type MasterType = 'assignment' | 'office' | 'fee_item';

function MasterManageModal({ open, onClose, assignments, offices, feeItems, onUpdate, onDelete, onAdd }: {
  open: boolean;
  onClose: () => void;
  assignments: Assignment[];
  offices: Office[];
  feeItems: FeeItem[];
  onUpdate: (type: MasterType, id: string, patch: any) => void | Promise<void>;
  onDelete: (type: MasterType, id: string, name: string) => void;
  onAdd: (type: MasterType, assignment_id?: string) => void;
}) {
  const [tab, setTab] = useState<MasterType>('assignment');
  const [filter, setFilter] = useState<string>('');
  if (!open) return null;

  const filtered = (() => {
    if (tab === 'assignment') return assignments;
    if (tab === 'office') return filter ? offices.filter(o => o.assignment_id === filter) : offices;
    return filter ? feeItems.filter(f => f.assignment_id === filter) : feeItems;
  })();

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={manageStyles.overlay}>
        <View style={manageStyles.dialog}>
          <View style={manageStyles.header}>
            <Text style={manageStyles.title}>⚙️ マスタ管理</Text>
            <TouchableOpacity onPress={onClose}><Text style={manageStyles.closeBtn}>✕</Text></TouchableOpacity>
          </View>
          {/* タブ */}
          <View style={manageStyles.tabs}>
            {([['assignment','配属'],['office','営業所'],['fee_item','料金項目']] as [MasterType,string][]).map(([k, label]) => (
              <TouchableOpacity
                key={k}
                onPress={() => { setTab(k); setFilter(''); }}
                style={[manageStyles.tab, tab === k && manageStyles.tabActive]}>
                <Text style={[manageStyles.tabText, tab === k && manageStyles.tabTextActive]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {/* フィルタ */}
          {tab !== 'assignment' && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, backgroundColor: '#f9fafb' }}>
              <Text style={{ fontSize: 12, color: '#6b7280' }}>配属で絞り込み:</Text>
              <View style={{ flex: 1 }}>
                {/* @ts-ignore */}
                <select value={filter} onChange={(e: any) => setFilter(e.target.value)} style={{ ...selectStyle, padding: '4px 8px', fontSize: 12 }}>
                  <option value="">全て</option>
                  {assignments.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </View>
              <TouchableOpacity
                onPress={() => onAdd(tab, filter || undefined)}
                disabled={!filter}
                style={[manageStyles.addBtn, !filter && { opacity: 0.4 }]}>
                <Text style={manageStyles.addBtnText}>+ 追加</Text>
              </TouchableOpacity>
            </View>
          )}
          {tab === 'assignment' && (
            <View style={{ padding: 10, backgroundColor: '#f9fafb', flexDirection: 'row', justifyContent: 'flex-end' }}>
              <TouchableOpacity onPress={() => onAdd('assignment')} style={manageStyles.addBtn}>
                <Text style={manageStyles.addBtnText}>+ 配属を追加</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* リスト */}
          <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ padding: 10 }}>
            {filtered.length === 0 ? (
              <Text style={{ textAlign: 'center', color: '#9ca3af', padding: 24 }}>項目がありません</Text>
            ) : (
              filtered.map((item: any) => (
                <MasterRow
                  key={item.id}
                  type={tab}
                  item={item}
                  assignments={assignments}
                  onSave={(patch) => onUpdate(tab, item.id, patch)}
                  onDelete={() => onDelete(tab, item.id, item.name)}
                />
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function MasterRow({ type, item, assignments, onSave, onDelete }: {
  type: MasterType;
  item: any;
  assignments: Assignment[];
  onSave: (patch: any) => void | Promise<void>;
  onDelete: () => void;
}) {
  const [name, setName] = useState(item.name || '');
  const [unit, setUnit] = useState(item.unit || '');
  const [price, setPrice] = useState(String(item.default_price ?? 0));
  useEffect(() => {
    setName(item.name || '');
    setUnit(item.unit || '');
    setPrice(String(item.default_price ?? 0));
  }, [item.id, item.name, item.unit, item.default_price]);

  const dirty = type === 'fee_item'
    ? (name !== item.name || unit !== (item.unit || '') || String(item.default_price ?? 0) !== price)
    : name !== item.name;

  const parentName = (type !== 'assignment')
    ? (assignments.find(a => a.id === item.assignment_id)?.name || '—')
    : '';

  const save = () => {
    if (!name.trim()) { Alert.alert('情報', '名前を入力してください'); return; }
    const patch: any = { name: name.trim() };
    if (type === 'fee_item') {
      patch.unit = unit;
      patch.default_price = parseFloat(price) || 0;
    }
    onSave(patch);
  };

  return (
    <View style={manageStyles.row}>
      {type !== 'assignment' && (
        <Text style={manageStyles.parentLabel}>{parentName}</Text>
      )}
      <View style={{ flex: 1, gap: 4 }}>
        <TextInput value={name} onChangeText={setName} style={manageStyles.rowInput} placeholder="名前" />
        {type === 'fee_item' && (
          <View style={{ flexDirection: 'row', gap: 4 }}>
            <TextInput value={unit} onChangeText={setUnit} style={[manageStyles.rowInput, { flex: 1 }]} placeholder="単位 (件/回/日)" />
            <TextInput value={price} onChangeText={setPrice} style={[manageStyles.rowInput, { flex: 1 }]} placeholder="標準単価" keyboardType="numeric" />
          </View>
        )}
      </View>
      <View style={{ flexDirection: 'column', gap: 4, marginLeft: 8 }}>
        {dirty && (
          <TouchableOpacity onPress={save} style={[manageStyles.iconBtn, { backgroundColor: '#10b981' }]}>
            <Text style={[manageStyles.iconBtnText, { color: '#fff' }]}>💾</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={onDelete} style={[manageStyles.iconBtn, { backgroundColor: '#fee2e2' }]}>
          <Text style={[manageStyles.iconBtnText, { color: '#dc2626' }]}>🗑️</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const manageStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  dialog: { width: 560, maxWidth: '95%', backgroundColor: '#fff', borderRadius: 8, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  title: { fontSize: 16, fontWeight: '700', color: '#1f2937' },
  closeBtn: { fontSize: 20, color: '#6b7280', paddingHorizontal: 8 },
  tabs: { flexDirection: 'row', backgroundColor: '#f3f4f6' },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { backgroundColor: '#fff', borderBottomColor: '#1A3C8F' },
  tabText: { fontSize: 13, color: '#6b7280' },
  tabTextActive: { color: '#1A3C8F', fontWeight: '600' },
  addBtn: { backgroundColor: '#3b82f6', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 4 },
  addBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: '#f3f4f6', gap: 8 },
  parentLabel: { fontSize: 11, color: '#6b7280', minWidth: 90, paddingHorizontal: 6, paddingVertical: 4, backgroundColor: '#f3f4f6', borderRadius: 4, textAlign: 'center' },
  rowInput: { backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#e5e7eb', paddingHorizontal: 8, paddingVertical: 6, borderRadius: 4, fontSize: 13 },
  iconBtn: { padding: 6, borderRadius: 4, minWidth: 32, alignItems: 'center' },
  iconBtnText: { fontSize: 14 },
});

// ═══════════════════════════════════════════════════════════════
// 印刷ビュー（A4）
// ═══════════════════════════════════════════════════════════════
function PrintView({ doc, onClose, assignments, offices }: {
  doc: Doc;
  onClose: () => void;
  assignments: Assignment[];
  offices: Office[];
}) {
  const isQuote = doc.doc_type === 'quotation';
  const isDriverFee = doc.doc_type === 'driver_fee';
  const labels = DOC_LABELS[doc.doc_type];
  const totals = calcTotals(doc.items, doc.tax_rate, doc.withhold_tax_rate);
  const hasWithhold = (doc.withhold_tax_rate || 0) > 0;
  const assignmentName = doc.assignment_id ? assignments.find(a => a.id === doc.assignment_id)?.name : '';
  const officeName = doc.office_id ? offices.find(o => o.id === doc.office_id)?.name : '';
  const [exportingPdf, setExportingPdf] = useState(false);

  const handleExportPDF = async () => {
    if (Platform.OS !== 'web') { Alert.alert('情報', 'PDF出力はWeb版のみ対応'); return; }
    setExportingPdf(true);
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      const el = document.querySelector('.qo-print-area') as HTMLElement | null;
      if (!el) throw new Error('印刷エリアが見つかりません');

      const canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
      });
      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      let heightLeft = imgHeight;
      let position = 0;
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      const safeName = `${doc.doc_number || labels.title}_${doc.title || ''}`.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
      pdf.save(`${safeName || 'document'}.pdf`);

      // 料金表のPDF出力後、Driveフォルダを自動で開く（手動ドラッグ&ドロップ用）
      if (isDriverFee && DRIVE_FOLDER_URL_DRIVER_FEE) {
        setTimeout(() => {
          const opened = window.open(DRIVE_FOLDER_URL_DRIVER_FEE, '_blank');
          if (!opened) {
            // ポップアップブロック時のフォールバック
            Alert.alert('Driveフォルダ', 'ポップアップがブロックされました。「📁 Driveフォルダ」ボタンから手動で開いてください。');
          }
        }, 400);
      }
    } catch (e: any) {
      Alert.alert('PDF出力エラー', e?.message || '不明なエラー');
    } finally {
      setExportingPdf(false);
    }
  };

  const openDriveFolder = () => {
    if (Platform.OS !== 'web') return;
    if (DRIVE_FOLDER_URL_DRIVER_FEE) window.open(DRIVE_FOLDER_URL_DRIVER_FEE, '_blank');
  };
  return (
    <View style={{ flex: 1, backgroundColor: '#e5e7eb' }}>
      <View style={[styles.header, { backgroundColor: '#fff' }]}  >
        <TouchableOpacity onPress={onClose}><Text style={styles.backBtn}>← 一覧</Text></TouchableOpacity>
        <Text style={styles.title}>印刷プレビュー</Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <TouchableOpacity onPress={handleExportPDF} disabled={exportingPdf} style={[styles.editBarBtn, { backgroundColor: '#dc2626' }]}>
            <Text style={[styles.editBarBtnText, { color: '#fff' }]}>{exportingPdf ? 'PDF生成中...' : '📄 PDF出力'}</Text>
          </TouchableOpacity>
          {isDriverFee && DRIVE_FOLDER_URL_DRIVER_FEE && (
            <TouchableOpacity onPress={openDriveFolder} style={[styles.editBarBtn, { backgroundColor: '#fbbf24' }]}>
              <Text style={[styles.editBarBtnText, { color: '#1f2937', fontWeight: '600' }]}>📁 Driveフォルダ</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => Platform.OS === 'web' && window.print()} style={[styles.editBarBtn, { backgroundColor: '#1A3C8F' }]}>
            <Text style={[styles.editBarBtnText, { color: '#fff' }]}>🖨️ 印刷</Text>
          </TouchableOpacity>
        </View>
      </View>
      {Platform.OS !== 'web' ? (
        <View style={{ padding: 32, alignItems: 'center' }}>
          <Text>印刷はWeb版でご利用ください</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ alignItems: 'center', padding: 24 }}>
          {/* @ts-ignore */}
          <div className="qo-print-area" style={printStyles.page}>
            {/* @ts-ignore */}
            <div style={printStyles.title as any}>{labels.printTitle}</div>

            {/* @ts-ignore */}
            <div style={printStyles.topBlock}>
              {/* @ts-ignore */}
              <div style={{ flex: 1 } as any}>
                {doc.counterparty_name && (
                  <div style={printStyles.toName as any}>
                    {doc.counterparty_name}
                    <span style={{ fontSize: 13 } as any}>{isDriverFee ? ' 様' : ' 御中'}</span>
                  </div>
                )}
                {isDriverFee && (assignmentName || officeName) && (
                  <div style={printStyles.subInfo as any}>
                    配属: {assignmentName || '—'}{officeName ? ` / ${officeName}` : ''}
                  </div>
                )}
                {!isDriverFee && doc.counterparty_contact && (
                  <div style={printStyles.subInfo as any}>ご担当: {doc.counterparty_contact} 様</div>
                )}
                {doc.counterparty_address && (
                  <div style={printStyles.subInfo as any}>
                    {isDriverFee ? `振込先: ${doc.counterparty_address}` : doc.counterparty_address}
                  </div>
                )}
                {doc.counterparty_phone && <div style={printStyles.subInfo as any}>TEL: {doc.counterparty_phone}</div>}
              </div>
              {/* @ts-ignore */}
              <div style={{ minWidth: 240, fontSize: 11 } as any}>
                {/* @ts-ignore */}
                <div style={printStyles.docMetaRow as any}><span>文書番号:</span><span>{doc.doc_number || ''}</span></div>
                {/* @ts-ignore */}
                <div style={printStyles.docMetaRow as any}><span>発行日:</span><span>{doc.issue_date}</span></div>
                {isQuote && doc.valid_until && (
                  // @ts-ignore
                  <div style={printStyles.docMetaRow as any}><span>有効期限:</span><span>{doc.valid_until}</span></div>
                )}
                {!isQuote && !isDriverFee && doc.delivery_date && (
                  // @ts-ignore
                  <div style={printStyles.docMetaRow as any}><span>希望納期:</span><span>{doc.delivery_date}</span></div>
                )}
                {/* @ts-ignore */}
                <div style={{ marginTop: 14, paddingTop: 8, borderTop: '1px solid #999', fontWeight: 600 } as any}>{COMPANY_INFO.name}</div>
                {/* @ts-ignore */}
                <div>{COMPANY_INFO.address}</div>
                {/* @ts-ignore */}
                <div>{COMPANY_INFO.phone}</div>
                {/* @ts-ignore */}
                <div>{COMPANY_INFO.email}</div>
              </div>
            </div>

            {doc.title && (
              // @ts-ignore
              <div style={printStyles.subject as any}>件名: {doc.title}</div>
            )}

            {!isDriverFee && (
              // @ts-ignore
              <div style={printStyles.totalBig as any}>
                {isQuote ? 'お見積金額（税込）' : 'ご発注金額（税込）'}:
                <span style={{ fontSize: 22, fontWeight: 700, marginLeft: 16 } as any}>{fmtMoney(totals.total)}</span>
              </div>
            )}

            {/* @ts-ignore */}
            <table style={printStyles.itemsTable as any}>
              <thead>
                {/* @ts-ignore */}
                <tr style={{ background: '#f3f4f6' } as any}>
                  {/* @ts-ignore */}
                  <th style={printStyles.th as any}>No.</th>
                  {/* @ts-ignore */}
                  <th style={printStyles.th as any}>品名</th>
                  {/* @ts-ignore */}
                  <th style={printStyles.th as any}>数量</th>
                  {/* @ts-ignore */}
                  <th style={printStyles.th as any}>単位</th>
                  {/* @ts-ignore */}
                  <th style={printStyles.th as any}>単価</th>
                  {/* @ts-ignore */}
                  <th style={printStyles.th as any}>金額</th>
                </tr>
              </thead>
              <tbody>
                {doc.items.map((it, i) => (
                  // @ts-ignore
                  <tr key={i}>
                    {/* @ts-ignore */}
                    <td style={printStyles.td as any}>{i + 1}</td>
                    {/* @ts-ignore */}
                    <td style={printStyles.td as any}>{it.name}</td>
                    {/* @ts-ignore */}
                    <td style={{ ...printStyles.td, textAlign: 'right' } as any}>{it.quantity}</td>
                    {/* @ts-ignore */}
                    <td style={printStyles.td as any}>{it.unit}</td>
                    {/* @ts-ignore */}
                    <td style={{ ...printStyles.td, textAlign: 'right' } as any}>{fmtMoney(it.unit_price)}</td>
                    {/* @ts-ignore */}
                    <td style={{ ...printStyles.td, textAlign: 'right' } as any}>{fmtMoney(it.amount)}</td>
                  </tr>
                ))}
                {/* 空行で見栄え調整 */}
                {Array.from({ length: Math.max(0, 5 - doc.items.length) }).map((_, i) => (
                  // @ts-ignore
                  <tr key={'e' + i}>
                    {/* @ts-ignore */}
                    <td style={printStyles.td as any}>&nbsp;</td>
                    {/* @ts-ignore */}
                    <td style={printStyles.td as any}></td>
                    {/* @ts-ignore */}
                    <td style={printStyles.td as any}></td>
                    {/* @ts-ignore */}
                    <td style={printStyles.td as any}></td>
                    {/* @ts-ignore */}
                    <td style={printStyles.td as any}></td>
                    {/* @ts-ignore */}
                    <td style={printStyles.td as any}></td>
                  </tr>
                ))}
              </tbody>
              {!isDriverFee && (
                <tfoot>
                  {/* @ts-ignore */}
                  <tr>
                    {/* @ts-ignore */}
                    <td colSpan={5} style={{ ...printStyles.td, textAlign: 'right', fontWeight: 600 } as any}>小計</td>
                    {/* @ts-ignore */}
                    <td style={{ ...printStyles.td, textAlign: 'right' } as any}>{fmtMoney(totals.subtotal)}</td>
                  </tr>
                  {/* @ts-ignore */}
                  <tr>
                    {/* @ts-ignore */}
                    <td colSpan={5} style={{ ...printStyles.td, textAlign: 'right', fontWeight: 600 } as any}>消費税 ({doc.tax_rate}%)</td>
                    {/* @ts-ignore */}
                    <td style={{ ...printStyles.td, textAlign: 'right' } as any}>{fmtMoney(totals.tax_amount)}</td>
                  </tr>
                  {/* @ts-ignore */}
                  <tr style={{ background: '#f3f4f6' } as any}>
                    {/* @ts-ignore */}
                    <td colSpan={5} style={{ ...printStyles.td, textAlign: 'right', fontWeight: 700, fontSize: 14 } as any}>合計</td>
                    {/* @ts-ignore */}
                    <td style={{ ...printStyles.td, textAlign: 'right', fontWeight: 700, fontSize: 14 } as any}>{fmtMoney(totals.total)}</td>
                  </tr>
                </tfoot>
              )}
            </table>

            {(!isQuote && !isDriverFee && (doc.delivery_location || doc.payment_terms)) && (
              // @ts-ignore
              <div style={{ marginTop: 16, fontSize: 11, lineHeight: 1.6 } as any}>
                {doc.delivery_location && <div>納入場所: {doc.delivery_location}</div>}
                {doc.payment_terms && <div>支払条件: {doc.payment_terms}</div>}
              </div>
            )}

            {doc.notes && (
              // @ts-ignore
              <div style={printStyles.notes as any}>
                {/* @ts-ignore */}
                <div style={{ fontWeight: 600, marginBottom: 4 } as any}>備考</div>
                {/* @ts-ignore */}
                <div style={{ whiteSpace: 'pre-wrap' } as any}>{doc.notes}</div>
              </div>
            )}
          </div>
        </ScrollView>
      )}
    </View>
  );
}

const printStyles = {
  page: {
    width: '210mm',
    minHeight: '297mm',
    background: '#fff',
    padding: '20mm',
    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
    fontFamily: '"Hiragino Mincho ProN", "MS Mincho", serif',
    color: '#1f2937',
    fontSize: 12,
    lineHeight: 1.5,
    boxSizing: 'border-box',
  },
  title: { fontSize: 28, fontWeight: 700, textAlign: 'center', letterSpacing: 8, marginBottom: 20, borderBottom: '2px solid #1f2937', paddingBottom: 12 },
  topBlock: { display: 'flex', flexDirection: 'row', gap: 24, marginBottom: 16 },
  toName: { fontSize: 18, fontWeight: 700, borderBottom: '1px solid #1f2937', paddingBottom: 4, marginBottom: 6 },
  subInfo: { fontSize: 11, marginBottom: 2 },
  docMetaRow: { display: 'flex', justifyContent: 'space-between', borderBottom: '1px dotted #9ca3af', paddingBottom: 2, marginBottom: 4 },
  subject: { fontSize: 14, fontWeight: 600, marginTop: 4, marginBottom: 8 },
  totalBig: { fontSize: 13, padding: '8px 14px', background: '#f9fafb', borderLeft: '4px solid #1A3C8F', marginBottom: 12 },
  itemsTable: { width: '100%', borderCollapse: 'collapse', marginTop: 6, fontSize: 11 },
  th: { border: '1px solid #1f2937', padding: '6px 8px', textAlign: 'left', fontWeight: 600 },
  td: { border: '1px solid #9ca3af', padding: '5px 8px' },
  notes: { marginTop: 12, padding: 8, border: '1px solid #d1d5db', fontSize: 11 },
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#e5e7eb',
    backgroundColor: '#fff', gap: 12,
  },
  backBtn: { color: '#1A3C8F', fontSize: 15 },
  title: { flex: 1, fontSize: 17, fontWeight: '600', textAlign: 'center', color: '#1f2937' },
  newBtn: { backgroundColor: '#3b82f6', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6 },
  newBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  tabs: { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: '#1A3C8F' },
  tabText: { fontSize: 14, color: '#6b7280' },
  tabTextActive: { color: '#1A3C8F', fontWeight: '600' },
  empty: { padding: 48, alignItems: 'center' },
  emptyIcon: { fontSize: 56 },
  emptyText: { marginTop: 16, color: '#374151', fontSize: 15 },
  emptyHint: { marginTop: 4, color: '#9ca3af', fontSize: 12 },
  card: {
    backgroundColor: '#fff', padding: 14, borderRadius: 8, marginBottom: 8,
    flexDirection: 'row', alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  docNumber: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12, color: '#1A3C8F', fontWeight: '600' },
  cardTitle: { fontSize: 14, fontWeight: '600', color: '#1f2937', flex: 1 },
  cardMeta: { fontSize: 12, color: '#374151', marginTop: 4 },
  cardMeta2: { fontSize: 11, color: '#6b7280', marginTop: 2 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  statusText: { fontSize: 11, fontWeight: '600' },
  smallBtn: { backgroundColor: '#e5e7eb', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 4, alignItems: 'center' },
  smallBtnText: { fontSize: 12, color: '#374151' },
  editBarBtn: { backgroundColor: '#e5e7eb', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 6 },
  editBarBtnText: { fontSize: 13, color: '#374151', fontWeight: '500' },
  section: { backgroundColor: '#fff', borderRadius: 8, padding: 14, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#1A3C8F', marginBottom: 10 },
  row2: { flexDirection: 'row', gap: 10 },
  fieldLabel: { fontSize: 11, color: '#6b7280', marginBottom: 4 },
  input: {
    backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#e5e7eb',
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 4,
    fontSize: 14, color: '#1f2937',
  },
  pickerWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  statusPick: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#f9fafb' },
  statusPickText: { fontSize: 11, color: '#6b7280' },
  itemHeader: { flexDirection: 'row', backgroundColor: '#f3f4f6', paddingHorizontal: 6, paddingVertical: 6, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  itemHeaderCell: { fontSize: 11, fontWeight: '600', color: '#374151', paddingHorizontal: 4 },
  itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  itemInput: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb', paddingHorizontal: 6, paddingVertical: 6, borderRadius: 3, fontSize: 13, marginHorizontal: 2 },
  itemAmount: { fontSize: 13, color: '#1f2937', textAlign: 'right', paddingHorizontal: 6, fontWeight: '500' },
  addItemBtn: { paddingVertical: 8, alignItems: 'center', backgroundColor: '#f3f4f6', borderRadius: 4, marginTop: 6 },
  addItemBtnText: { fontSize: 12, color: '#3b82f6', fontWeight: '500' },
  totalsBox: { marginTop: 14, padding: 12, backgroundColor: '#f9fafb', borderRadius: 6 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  totalLabel: { fontSize: 13, color: '#374151' },
  totalValue: { fontSize: 14, color: '#1f2937', fontWeight: '500' },
  miniBtn: { backgroundColor: '#dbeafe', borderWidth: 1, borderColor: '#93c5fd', paddingHorizontal: 8, paddingVertical: 7, borderRadius: 4 },
  miniBtnText: { fontSize: 11, color: '#1e40af', fontWeight: '500' },
});

const selectStyle: any = {
  width: '100%',
  background: '#f9fafb',
  border: '1px solid #e5e7eb',
  padding: '8px 10px',
  borderRadius: 4,
  fontSize: 14,
  color: '#1f2937',
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};
