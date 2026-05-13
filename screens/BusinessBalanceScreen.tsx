import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';

const INVOICE_API = 'https://nccognptoprhwsbjnwcu.supabase.co/functions/v1/invoice-sheet';
const PAYMENT_SUMMARY_API = 'https://nccognptoprhwsbjnwcu.supabase.co/functions/v1/payment-summary';
const ASKUL_API = 'https://erfcsnzdooswgpvgrapb.supabase.co/functions/v1/monthly-balance';
const ASKUL_KEY = 'sb_publishable_hPNI8drbzHlBsNQlcqyByg_X6pgj64a';

const AREA_ORDER = ['立川', '城北', '川越', '川崎高津'];

type Tab = 'shimbun' | 'askul' | 'total';

type ToolBalance = {
  sales: number;
  payment: number;
  profit: number;
  rate: number;
  outsource: number;
  employee: number;
  employee_count: number;
};
type MonthTrend = {
  ym: string;
  shimbun: ToolBalance;
  askul: ToolBalance;
};

type AskulBalance = {
  period: { from: string; to: string };
  revenue: number;
  payment: number;
  driver_payment?: number;
  employee_salary_total?: number;
  employee_count?: number;
  profit: number;
  profit_rate: number;
  invoice: number;
  driver_count: number;
};

// アスクルの締めサイクル: 前月21日〜当月20日
function askulCycle(yearMonth: string): { from: string; to: string } {
  const [y, m] = yearMonth.split('-').map(Number);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const from = new Date(y, m - 2, 21);
  const to = new Date(y, m - 1, 20);
  return { from: fmt(from), to: fmt(to) };
}

type ConfirmedSale = {
  row_number: number;
  year_month: string;
  area: string;
  course: string;
  grand_total: number;
  am_total: number;
  pm_total: number;
  confirmed_at: string;
};

type WorkRecord = {
  row_number: number;
  date: string;
  staff: string;
  course: string;
  category: string;
  amount: string;
};

interface Props {
  onBack: () => void;
}

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function previousYearMonth(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function parseAmount(s: string): number {
  if (!s) return 0;
  return Number(String(s).replace(/[¥,\s]/g, '')) || 0;
}

async function invApi(action: string, params: Record<string, any> = {}) {
  const resp = await fetch(INVOICE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...params }),
  });
  return resp.json();
}

// 支払い明細スナップショット (shift-manager 管理→支払い明細→「NexPortに反映」 で保存される)
type PaymentBreakdown = { total: number; outsource: number; employee: number };
async function fetchPaymentSummary(ym: string): Promise<Map<string, PaymentBreakdown>> {
  const m = new Map<string, PaymentBreakdown>();
  try {
    const resp = await fetch(PAYMENT_SUMMARY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_summary', year_month: ym }),
    });
    const data = await resp.json();
    if (Array.isArray(data.summaries)) {
      for (const s of data.summaries) {
        if (s && s.area) m.set(String(s.area), {
          total: Number(s.amount) || 0,
          outsource: Number(s.outsource_amount) || 0,
          employee: Number(s.employee_amount) || 0,
        });
      }
    }
  } catch (_) { /* ignore - フォールバック側に任せる */ }
  return m;
}

async function fetchAskulBalance(ym: string): Promise<ToolBalance> {
  const period = askulCycle(ym);
  const resp = await fetch(ASKUL_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ASKUL_KEY}` },
    body: JSON.stringify(period),
  });
  const data = await resp.json();
  if (!resp.ok || data.error) throw new Error('アスクル: ' + (data.error ?? resp.status));
  return {
    sales: data.revenue ?? 0,
    payment: data.payment ?? 0,
    profit: data.profit ?? 0,
    rate: data.profit_rate ?? 0,
    outsource: data.driver_payment ?? (data.payment ?? 0),
    employee: data.employee_salary_total ?? 0,
    employee_count: data.employee_count ?? 0,
  };
}

async function fetchShimbunBalance(ym: string, allWork: WorkRecord[]): Promise<ToolBalance> {
  const [salesRes, summaryMap] = await Promise.all([
    invApi('get_confirmed_sales', { year_month: ym }),
    fetchPaymentSummary(ym),
  ]);
  if (salesRes.error) throw new Error('新聞売上: ' + salesRes.error);
  const sales: ConfirmedSale[] = salesRes.records ?? [];
  const totalSales = sales.reduce((a, s) => a + (s.grand_total || 0), 0);
  // 支払い: payment_summary が保存されていればそれを使う、無ければ稼働記録合計
  let totalPayment = 0;
  let totalOutsource = 0;
  let totalEmployee = 0;
  if (summaryMap.size > 0) {
    for (const v of summaryMap.values()) {
      totalPayment += v.total;
      totalOutsource += v.outsource;
      totalEmployee += v.employee;
    }
  } else {
    const [y, m] = ym.split('-');
    const prefix1 = `${y}/${m}`;
    const prefix2 = `${y}-${m}`;
    const monthWork = allWork.filter((w) => {
      const d = w.date || '';
      return d.startsWith(prefix1) || d.startsWith(prefix2);
    });
    totalPayment = monthWork.reduce((a, w) => a + parseAmount(w.amount), 0);
    totalOutsource = totalPayment;
    totalEmployee = 0;
  }
  const profit = totalSales - totalPayment;
  const rate = totalSales > 0 ? (profit / totalSales) * 100 : 0;
  return { sales: totalSales, payment: totalPayment, profit, rate, outsource: totalOutsource, employee: totalEmployee, employee_count: 0 };
}

function previousMonths(ym: string, count: number): string[] {
  const [y, m] = ym.split('-').map(Number);
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

// 会計年度 (10月〜翌年9月) の12ヶ月を返す
function fiscalYearMonths(refYm: string): string[] {
  const [y, m] = refYm.split('-').map(Number);
  // 基準年: 1〜9月なら前年10月〜当年9月、10〜12月なら当年10月〜翌年9月
  const startYear = m >= 10 ? y : y - 1;
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(startYear, 9 + i, 1); // 月は 9 (=10月)〜20 (=翌年9月)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

export default function BusinessBalanceScreen({ onBack }: Props) {
  const [tab, setTab] = useState<Tab>('shimbun');
  const [yearMonth, setYearMonth] = useState<string>(previousYearMonth());
  const [sales, setSales] = useState<ConfirmedSale[]>([]);
  const [work, setWork] = useState<WorkRecord[]>([]);
  const [askul, setAskul] = useState<AskulBalance | null>(null);
  const [totalShimbun, setTotalShimbun] = useState<ToolBalance | null>(null);
  const [totalAskul, setTotalAskul] = useState<ToolBalance | null>(null);
  const [trend, setTrend] = useState<MonthTrend[]>([]);
  const [payByArea, setPayByArea] = useState<Map<string, PaymentBreakdown>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedMonth, setLoadedMonth] = useState<string | null>(null);
  const [loadedTab, setLoadedTab] = useState<Tab | null>(null);

  const load = async (ym: string, t: Tab) => {
    setLoading(true);
    setError(null);
    try {
      if (t === 'shimbun') {
        const [salesRes, workRes, summaryMap] = await Promise.all([
          invApi('get_confirmed_sales', { year_month: ym }),
          invApi('list_work'),
          fetchPaymentSummary(ym),
        ]);
        if (salesRes.error) throw new Error('売上取得エラー: ' + salesRes.error);
        if (workRes.error) throw new Error('稼働取得エラー: ' + workRes.error);
        setSales(salesRes.records ?? []);
        setWork(workRes.records ?? []);
        setPayByArea(summaryMap);
      } else if (t === 'askul') {
        const period = askulCycle(ym);
        const resp = await fetch(ASKUL_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ASKUL_KEY}` },
          body: JSON.stringify(period),
        });
        const data = await resp.json();
        if (!resp.ok || data.error) throw new Error('アスクル取得エラー: ' + (data.error ?? resp.status));
        setAskul(data as AskulBalance);
      } else {
        // 合計タブ: 当月の新聞+アスクル + 過去6ヶ月のトレンド
        const workRes = await invApi('list_work');
        if (workRes.error) throw new Error('稼働取得エラー: ' + workRes.error);
        const allWork: WorkRecord[] = workRes.records ?? [];
        setWork(allWork);

        const months = fiscalYearMonths(ym);
        const [shimbunResults, askulResults] = await Promise.all([
          Promise.all(months.map((m) => fetchShimbunBalance(m, allWork).catch(() => ({ sales: 0, payment: 0, profit: 0, rate: 0, outsource: 0, employee: 0, employee_count: 0 })))),
          Promise.all(months.map((m) => fetchAskulBalance(m).catch(() => ({ sales: 0, payment: 0, profit: 0, rate: 0, outsource: 0, employee: 0, employee_count: 0 })))),
        ]);
        const trendData: MonthTrend[] = months.map((m, i) => ({
          ym: m,
          shimbun: shimbunResults[i],
          askul: askulResults[i],
        }));
        setTrend(trendData);
        // 選択月の値を取り出して合算カードへ反映
        const idx = months.indexOf(ym);
        const cur = idx >= 0 ? trendData[idx] : trendData[trendData.length - 1];
        setTotalShimbun(cur.shimbun);
        setTotalAskul(cur.askul);
      }
      setLoadedMonth(ym);
      setLoadedTab(t);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(yearMonth, tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // courseName → area マップ (確定売上から作る)
  const courseAreaMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of sales) {
      if (s.course && s.area) m.set(s.course, s.area);
    }
    return m;
  }, [sales]);

  // 当月の稼働記録だけ抽出 (date は YYYY/MM/DD or YYYY-MM-DD)
  const monthWork = useMemo(() => {
    if (!loadedMonth) return [];
    const [y, m] = loadedMonth.split('-');
    const prefix1 = `${y}/${m}`;
    const prefix2 = `${y}-${m}`;
    return work.filter((w) => {
      const d = w.date || '';
      return d.startsWith(prefix1) || d.startsWith(prefix2);
    });
  }, [work, loadedMonth]);

  // 営業所別集計
  const summary = useMemo(() => {
    type Row = { area: string; sales: number; expense: number; outsource: number; employee: number; profit: number; rate: number; courseCount: number };
    const map = new Map<string, Row>();
    const ensure = (area: string) => {
      let r = map.get(area);
      if (!r) {
        r = { area, sales: 0, expense: 0, outsource: 0, employee: 0, profit: 0, rate: 0, courseCount: 0 };
        map.set(area, r);
      }
      return r;
    };

    // 売上: 営業所別
    const courseByArea = new Map<string, Set<string>>();
    for (const s of sales) {
      ensure(s.area).sales += s.grand_total || 0;
      const set = courseByArea.get(s.area) ?? new Set<string>();
      set.add(s.course);
      courseByArea.set(s.area, set);
    }
    for (const [area, set] of courseByArea) {
      const row = map.get(area);
      if (row) row.courseCount = set.size;
    }

    // 支払い: payment_summary (shift-manager 管理→支払い明細→「NexPortに反映」) が保存済みなら優先、無ければ稼働記録
    if (payByArea.size > 0) {
      for (const [area, bd] of payByArea) {
        const r = ensure(area);
        r.outsource += bd.outsource;
        r.employee += bd.employee;
        r.expense += bd.total;
      }
    } else {
      for (const w of monthWork) {
        const area = courseAreaMap.get(w.course) || '未分類';
        const a = parseAmount(w.amount);
        const r = ensure(area);
        r.outsource += a;
        r.expense += a;
      }
    }

    // 粗利・粗利率
    const rows = Array.from(map.values());
    for (const r of rows) {
      r.profit = r.sales - r.expense;
      r.rate = r.sales > 0 ? (r.profit / r.sales) * 100 : 0;
    }

    // ソート: 既知の営業所順 → 未分類はその後
    rows.sort((a, b) => {
      const ai = AREA_ORDER.indexOf(a.area);
      const bi = AREA_ORDER.indexOf(b.area);
      const av = ai < 0 ? 99 : ai;
      const bv = bi < 0 ? 99 : bi;
      return av - bv;
    });

    const totals = rows.reduce(
      (acc, r) => ({
        sales: acc.sales + r.sales,
        expense: acc.expense + r.expense,
        courseCount: acc.courseCount + r.courseCount,
      }),
      { sales: 0, expense: 0, courseCount: 0 },
    );
    const totalProfit = totals.sales - totals.expense;
    const totalRate = totals.sales > 0 ? (totalProfit / totals.sales) * 100 : 0;

    return {
      rows,
      totals: { ...totals, profit: totalProfit, rate: totalRate },
    };
  }, [sales, monthWork, courseAreaMap, payByArea]);

  const isConfirmed = sales.length > 0;
  const monthLabel = loadedMonth
    ? `${loadedMonth.split('-')[0]}年${parseInt(loadedMonth.split('-')[1])}月度`
    : '';

  // 月セレクタ用の選択肢 (過去12ヶ月 + 当月)
  const monthOptions = useMemo(() => {
    const opts: string[] = [];
    const now = new Date();
    for (let i = 0; i < 13; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      opts.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return opts;
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backText}>← トップ</Text>
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={styles.title}>💰 収支</Text>
          <Text style={styles.subtitle}>{tab === 'shimbun' ? '新聞シフト管理ツール 連携' : tab === 'askul' ? 'アスクル管理ツール 連携' : '新聞 + アスクル 合算'}</Text>
        </View>
        <View style={{ width: 80 }} />
      </View>

      {/* タブ */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'shimbun' && styles.tabBtnActive]}
          onPress={() => { setTab('shimbun'); load(yearMonth, 'shimbun'); }}
        >
          <Text style={[styles.tabText, tab === 'shimbun' && styles.tabTextActive]}>📰 新聞</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'askul' && styles.tabBtnActive]}
          onPress={() => { setTab('askul'); load(yearMonth, 'askul'); }}
        >
          <Text style={[styles.tabText, tab === 'askul' && styles.tabTextActive]}>📦 アスクル</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'total' && styles.tabBtnActive]}
          onPress={() => { setTab('total'); load(yearMonth, 'total'); }}
        >
          <Text style={[styles.tabText, tab === 'total' && styles.tabTextActive]}>📊 合計</Text>
        </TouchableOpacity>
      </View>

      {/* 月セレクタ */}
      <View style={styles.controlBar}>
        <Text style={styles.controlLabel}>対象月:</Text>
        <View style={styles.monthScroll}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {monthOptions.map((ym) => {
              const active = ym === yearMonth;
              return (
                <TouchableOpacity
                  key={ym}
                  style={[styles.monthChip, active && styles.monthChipActive]}
                  onPress={() => {
                    setYearMonth(ym);
                    load(ym, tab);
                  }}
                >
                  <Text style={[styles.monthChipText, active && styles.monthChipTextActive]}>
                    {ym.split('-')[0]}/{parseInt(ym.split('-')[1])}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
        <TouchableOpacity style={styles.reloadBtn} onPress={() => load(yearMonth, tab)} disabled={loading}>
          <Text style={styles.reloadText}>{loading ? '読込中...' : '更新'}</Text>
        </TouchableOpacity>
      </View>

      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
        {loading ? (
          <ActivityIndicator size="large" color="#16A34A" style={{ marginTop: 40 }} />
        ) : tab === 'total' ? (
          (() => {
            const sh = totalShimbun ?? { sales: 0, payment: 0, profit: 0, rate: 0, outsource: 0, employee: 0, employee_count: 0 };
            const ak = totalAskul ?? { sales: 0, payment: 0, profit: 0, rate: 0, outsource: 0, employee: 0, employee_count: 0 };
            const tot = {
              sales: sh.sales + ak.sales,
              payment: sh.payment + ak.payment,
              profit: sh.profit + ak.profit,
              rate: 0,
            };
            tot.rate = tot.sales > 0 ? (tot.profit / tot.sales) * 100 : 0;
            const labelMonth = `${yearMonth.split('-')[0]}年${parseInt(yearMonth.split('-')[1])}月度`;

            return (
              <>
                <View style={styles.statusBadge}>
                  <Text style={styles.statusBadgeText}>📊 {labelMonth} 合算</Text>
                </View>

                <View style={styles.statsRow}>
                  <StatCard label="売上" value={tot.sales} color="#3B82F6" />
                  <StatCard label="支払い" value={tot.payment} color="#EF4444" />
                  <StatCard label="粗利" value={tot.profit} color="#16A34A" />
                  <StatCard label="粗利率" value={tot.rate} color="#16A34A" isPercent />
                </View>

                {/* ツール別内訳 */}
                <View style={styles.tableCard}>
                  <Text style={styles.sectionTitle}>ツール別 内訳</Text>
                  <View style={styles.tableHead}>
                    <Text style={[styles.thCell, { flex: 1.2 }]}>ツール</Text>
                    <Text style={[styles.thCell, { flex: 1.4, textAlign: 'right' }]}>売上</Text>
                    <Text style={[styles.thCell, { flex: 1.4, textAlign: 'right' }]}>支払い</Text>
                    <Text style={[styles.thCell, { flex: 1.4, textAlign: 'right' }]}>粗利</Text>
                    <Text style={[styles.thCell, { flex: 0.9, textAlign: 'right' }]}>粗利率</Text>
                  </View>
                  {[
                    { label: '📰 新聞', d: sh },
                    { label: '📦 アスクル', d: ak },
                  ].map(({ label, d }) => (
                    <View key={label} style={styles.tableRow}>
                      <Text style={[styles.tdCell, { flex: 1.2, fontWeight: '600' }]}>{label}</Text>
                      <Text style={[styles.tdCell, { flex: 1.4, textAlign: 'right' }]}>¥{d.sales.toLocaleString()}</Text>
                      <Text style={[styles.tdCell, { flex: 1.4, textAlign: 'right', color: '#B45309' }]}>¥{d.payment.toLocaleString()}</Text>
                      <Text style={[styles.tdCell, { flex: 1.4, textAlign: 'right', color: d.profit >= 0 ? '#15803D' : '#DC2626', fontWeight: '600' }]}>¥{d.profit.toLocaleString()}</Text>
                      <Text style={[styles.tdCell, { flex: 0.9, textAlign: 'right' }]}>{d.rate.toFixed(1)}%</Text>
                    </View>
                  ))}
                  <View style={[styles.tableRow, styles.totalRow]}>
                    <Text style={[styles.tdCell, { flex: 1.2, fontWeight: '700' }]}>合計</Text>
                    <Text style={[styles.tdCell, { flex: 1.4, textAlign: 'right', fontWeight: '700' }]}>¥{tot.sales.toLocaleString()}</Text>
                    <Text style={[styles.tdCell, { flex: 1.4, textAlign: 'right', color: '#B45309', fontWeight: '700' }]}>¥{tot.payment.toLocaleString()}</Text>
                    <Text style={[styles.tdCell, { flex: 1.4, textAlign: 'right', color: tot.profit >= 0 ? '#15803D' : '#DC2626', fontWeight: '700' }]}>¥{tot.profit.toLocaleString()}</Text>
                    <Text style={[styles.tdCell, { flex: 0.9, textAlign: 'right', fontWeight: '700' }]}>{tot.rate.toFixed(1)}%</Text>
                  </View>
                </View>

                {/* 通期テーブル (10月〜翌年9月) */}
                {(() => {
                  const fyLabel = trend[0]?.ym.split('-')[0] ?? '';
                  const fyTotals = trend.reduce(
                    (acc, t) => ({
                      sales: acc.sales + t.shimbun.sales + t.askul.sales,
                      payment: acc.payment + t.shimbun.payment + t.askul.payment,
                      profit: acc.profit + t.shimbun.profit + t.askul.profit,
                    }),
                    { sales: 0, payment: 0, profit: 0 },
                  );
                  const fyRate = fyTotals.sales > 0 ? (fyTotals.profit / fyTotals.sales) * 100 : 0;
                  return (
                    <View style={[styles.tableCard, { marginTop: 16 }]}>
                      <Text style={styles.sectionTitle}>{fyLabel}年度 通期 (10月〜翌年9月)</Text>
                      <View style={styles.tableHead}>
                        <Text style={[styles.thCell, { flex: 0.8 }]}>月</Text>
                        <Text style={[styles.thCell, { flex: 1.4, textAlign: 'right' }]}>売上</Text>
                        <Text style={[styles.thCell, { flex: 1.4, textAlign: 'right' }]}>支払い</Text>
                        <Text style={[styles.thCell, { flex: 1.4, textAlign: 'right' }]}>粗利</Text>
                        <Text style={[styles.thCell, { flex: 0.9, textAlign: 'right' }]}>粗利率</Text>
                      </View>
                      {trend.map((t) => {
                        const sales = t.shimbun.sales + t.askul.sales;
                        const payment = t.shimbun.payment + t.askul.payment;
                        const profit = t.shimbun.profit + t.askul.profit;
                        const rate = sales > 0 ? (profit / sales) * 100 : 0;
                        const [yy, mm] = t.ym.split('-');
                        const isCurrent = t.ym === yearMonth;
                        return (
                          <View key={t.ym} style={[styles.tableRow, isCurrent && { backgroundColor: '#ECFDF5' }]}>
                            <Text style={[styles.tdCell, { flex: 0.8, fontWeight: isCurrent ? '700' : '600' }]}>{parseInt(mm)}月 ({yy.slice(2)})</Text>
                            <Text style={[styles.tdCell, { flex: 1.4, textAlign: 'right' }]}>{sales > 0 ? `¥${sales.toLocaleString()}` : '-'}</Text>
                            <Text style={[styles.tdCell, { flex: 1.4, textAlign: 'right', color: payment > 0 ? '#B45309' : '#94A3B8' }]}>{payment > 0 ? `¥${payment.toLocaleString()}` : '-'}</Text>
                            <Text style={[styles.tdCell, { flex: 1.4, textAlign: 'right', color: sales === 0 ? '#94A3B8' : profit >= 0 ? '#15803D' : '#DC2626', fontWeight: '600' }]}>{sales > 0 ? `¥${profit.toLocaleString()}` : '-'}</Text>
                            <Text style={[styles.tdCell, { flex: 0.9, textAlign: 'right', color: sales === 0 ? '#94A3B8' : '#1E293B' }]}>{sales > 0 ? `${rate.toFixed(1)}%` : '-'}</Text>
                          </View>
                        );
                      })}
                      <View style={[styles.tableRow, styles.totalRow]}>
                        <Text style={[styles.tdCell, { flex: 0.8, fontWeight: '700' }]}>通期</Text>
                        <Text style={[styles.tdCell, { flex: 1.4, textAlign: 'right', fontWeight: '700' }]}>¥{fyTotals.sales.toLocaleString()}</Text>
                        <Text style={[styles.tdCell, { flex: 1.4, textAlign: 'right', color: '#B45309', fontWeight: '700' }]}>¥{fyTotals.payment.toLocaleString()}</Text>
                        <Text style={[styles.tdCell, { flex: 1.4, textAlign: 'right', color: fyTotals.profit >= 0 ? '#15803D' : '#DC2626', fontWeight: '700' }]}>¥{fyTotals.profit.toLocaleString()}</Text>
                        <Text style={[styles.tdCell, { flex: 0.9, textAlign: 'right', fontWeight: '700' }]}>{fyRate.toFixed(1)}%</Text>
                      </View>
                    </View>
                  );
                })()}

                {/* 月別グラフ — 売上(新聞/アスクル積上げ) */}
                {(() => {
                  const trendMaxSales = Math.max(1, ...trend.map((t) => t.shimbun.sales + t.askul.sales));
                  return (
                    <View style={[styles.tableCard, { marginTop: 16 }]}>
                      <Text style={styles.sectionTitle}>{trend[0]?.ym.split('-')[0] ?? ''}年度トレンド (10月〜翌年9月)</Text>
                      <View style={[styles.chartLegend, { flexWrap: 'wrap' }]}>
                        <View style={styles.legendItem}><View style={[styles.legendSwatch, { backgroundColor: '#1D4ED8' }]} /><Text style={styles.legendText}>売上(新聞)</Text></View>
                        <View style={styles.legendItem}><View style={[styles.legendSwatch, { backgroundColor: '#93C5FD' }]} /><Text style={styles.legendText}>売上(アスクル)</Text></View>
                      </View>
                      <View style={styles.chartArea}>
                        {trend.map((t) => {
                          const sShimbun = t.shimbun.sales;
                          const sAskul = t.askul.sales;
                          const sTotal = sShimbun + sAskul;
                          const oTotal = t.shimbun.outsource + t.askul.outsource;
                          const eTotal = t.shimbun.employee + t.askul.employee;
                          const profit = sTotal - (oTotal + eTotal);
                          const empCount = t.shimbun.employee_count + t.askul.employee_count;
                          const sShimbunH = (sShimbun / trendMaxSales) * 140;
                          const sAskulH = (sAskul / trendMaxSales) * 140;
                          const [yy, mm] = t.ym.split('-');
                          return (
                            <View key={t.ym} style={styles.chartCol}>
                              <Text style={styles.chartValue}>¥{Math.round(sTotal / 10000)}万</Text>
                              <View style={styles.chartBars}>
                                <View style={{ width: 18, alignItems: 'center' }}>
                                  <View style={{ width: 18, height: sAskulH, backgroundColor: '#93C5FD', borderTopLeftRadius: 2, borderTopRightRadius: 2 }} />
                                  <View style={{ width: 18, height: sShimbunH, backgroundColor: '#1D4ED8' }} />
                                </View>
                              </View>
                              <Text style={styles.chartLabel}>{parseInt(mm)}/{yy.slice(2)}</Text>
                              <Text style={{ fontSize: 9, color: sTotal === 0 ? '#94A3B8' : profit >= 0 ? '#15803D' : '#DC2626', marginTop: 2, fontWeight: '600' }}>{sTotal > 0 ? `粗${Math.round(profit / 10000)}万` : '—'}</Text>
                              <Text style={{ fontSize: 9, color: '#9333EA', marginTop: 1, fontWeight: '600' }}>{empCount > 0 ? `社員${empCount}名` : '—'}</Text>
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  );
                })()}

                <Text style={styles.note}>
                  ※ 新聞は確定済売上 vs 稼働記録の合算、アスクルは {askulCycle(yearMonth).from} 〜 {askulCycle(yearMonth).to} の集計です。
                  {'\n'}
                  ※ 棒は売上の積み上げ(新聞=濃青/アスクル=水色)。バー下に粗利と社員人数を表示。
                </Text>
              </>
            );
          })()
        ) : tab === 'askul' ? (
          (() => {
            const period = askulCycle(yearMonth);
            const labelMonth = `${yearMonth.split('-')[0]}年${parseInt(yearMonth.split('-')[1])}月度`;
            if (!askul) {
              return (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyIcon}>📦</Text>
                  <Text style={styles.emptyTitle}>{labelMonth} データなし</Text>
                  <Text style={styles.emptyDesc}>{period.from} 〜 {period.to}{'\n'}対象期間の配送実績がありません</Text>
                </View>
              );
            }
            return (
              <>
                <View style={styles.statusBadge}>
                  <Text style={styles.statusBadgeText}>📦 {labelMonth} ({period.from} 〜 {period.to})</Text>
                </View>
                <View style={styles.statsRow}>
                  <StatCard label="売上(税抜)" value={askul.revenue} color="#3B82F6" />
                  <StatCard label="支払い" value={askul.payment} color="#EF4444" />
                  <StatCard label="粗利" value={askul.profit} color="#16A34A" />
                  <StatCard label="粗利率" value={askul.profit_rate} color="#16A34A" isPercent />
                </View>
                <View style={styles.tableCard}>
                  <Text style={styles.sectionTitle}>サマリー</Text>
                  <View style={styles.tableRow}>
                    <Text style={[styles.tdCell, { flex: 1 }]}>対象ドライバー</Text>
                    <Text style={[styles.tdCell, { flex: 1, textAlign: 'right', fontWeight: '600' }]}>{askul.driver_count}名</Text>
                  </View>
                  {(askul.driver_payment ?? 0) > 0 && (
                    <View style={styles.tableRow}>
                      <Text style={[styles.tdCell, { flex: 1 }]}>うち ドライバー支払い</Text>
                      <Text style={[styles.tdCell, { flex: 1, textAlign: 'right', color: '#92400E' }]}>¥{(askul.driver_payment ?? 0).toLocaleString()}</Text>
                    </View>
                  )}
                  {(askul.employee_count ?? 0) > 0 && (
                    <View style={styles.tableRow}>
                      <Text style={[styles.tdCell, { flex: 1 }]}>うち 社員給与 ({askul.employee_count}名)</Text>
                      <Text style={[styles.tdCell, { flex: 1, textAlign: 'right', color: '#9333EA' }]}>¥{(askul.employee_salary_total ?? 0).toLocaleString()}</Text>
                    </View>
                  )}
                  <View style={styles.tableRow}>
                    <Text style={[styles.tdCell, { flex: 1 }]}>アスクル請求(税込)</Text>
                    <Text style={[styles.tdCell, { flex: 1, textAlign: 'right', fontWeight: '600' }]}>¥{askul.invoice.toLocaleString()}</Text>
                  </View>
                </View>
                <Text style={styles.note}>
                  ※ アスクルの締めサイクルは「前月21日〜当月20日」です。
                  {'\n'}
                  ※ 支払い = ドライバー支払い (売上-控除額) + 社員月給合計。粗利 = 控除額合計 - 社員月給。
                  {'\n'}
                  ※ 社員月給は「アスクル管理ツール」のドライバー編集 → 事業形態=社員 → 月給欄で設定します。
                  {'\n'}
                  ※ 詳細編集は「アスクル管理ツール」の月次締め画面で行ってください。
                </Text>
              </>
            );
          })()
        ) : !isConfirmed ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyTitle}>{monthLabel} は未確定です</Text>
            <Text style={styles.emptyDesc}>
              新聞シフト管理ツールの「収支管理」または「請求書作成」で
              {'\n'}
              売上確定 を行うと、ここに表示されます。
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.statusBadge}>
              <Text style={styles.statusBadgeText}>✓ {monthLabel} 確定済み</Text>
            </View>

            {/* サマリーカード */}
            <View style={styles.statsRow}>
              <StatCard label="売上" value={summary.totals.sales} color="#3B82F6" />
              <StatCard label="支払い" value={summary.totals.expense} color="#EF4444" />
              <StatCard label="粗利" value={summary.totals.profit} color="#16A34A" />
              <StatCard
                label="粗利率"
                value={summary.totals.rate}
                color="#16A34A"
                isPercent
              />
            </View>

            {/* 営業所別テーブル */}
            <View style={styles.tableCard}>
              <Text style={styles.sectionTitle}>営業所別 内訳</Text>
              <View style={styles.tableHead}>
                <Text style={[styles.thCell, { flex: 1.1 }]}>営業所</Text>
                <Text style={[styles.thCell, { flex: 0.6, textAlign: 'right' }]}>コース</Text>
                <Text style={[styles.thCell, { flex: 1.3, textAlign: 'right' }]}>売上</Text>
                <Text style={[styles.thCell, { flex: 1.2, textAlign: 'right' }]}>外注</Text>
                <Text style={[styles.thCell, { flex: 1.2, textAlign: 'right' }]}>社員</Text>
                <Text style={[styles.thCell, { flex: 1.2, textAlign: 'right' }]}>支払計</Text>
                <Text style={[styles.thCell, { flex: 1.2, textAlign: 'right' }]}>粗利</Text>
                <Text style={[styles.thCell, { flex: 0.8, textAlign: 'right' }]}>率</Text>
              </View>
              {summary.rows.map((r) => (
                <View key={r.area} style={styles.tableRow}>
                  <Text style={[styles.tdCell, { flex: 1.1, fontWeight: '600' }]}>{r.area}</Text>
                  <Text style={[styles.tdCell, { flex: 0.6, textAlign: 'right' }]}>{r.courseCount > 0 ? r.courseCount : '-'}</Text>
                  <Text style={[styles.tdCell, { flex: 1.3, textAlign: 'right' }]}>¥{r.sales.toLocaleString()}</Text>
                  <Text style={[styles.tdCell, { flex: 1.2, textAlign: 'right', color: '#92400E' }]}>¥{Math.round(r.outsource).toLocaleString()}</Text>
                  <Text style={[styles.tdCell, { flex: 1.2, textAlign: 'right', color: '#9333EA' }]}>¥{Math.round(r.employee).toLocaleString()}</Text>
                  <Text style={[styles.tdCell, { flex: 1.2, textAlign: 'right', color: '#B45309', fontWeight: '600' }]}>¥{Math.round(r.expense).toLocaleString()}</Text>
                  <Text style={[styles.tdCell, { flex: 1.2, textAlign: 'right', color: r.profit >= 0 ? '#15803D' : '#DC2626', fontWeight: '600' }]}>¥{Math.round(r.profit).toLocaleString()}</Text>
                  <Text style={[styles.tdCell, { flex: 0.8, textAlign: 'right' }]}>{r.rate.toFixed(1)}%</Text>
                </View>
              ))}
              {/* 合計行 */}
              {(() => {
                const totOutsource = summary.rows.reduce((a, r) => a + r.outsource, 0);
                const totEmployee = summary.rows.reduce((a, r) => a + r.employee, 0);
                return (
                  <View style={[styles.tableRow, styles.totalRow]}>
                    <Text style={[styles.tdCell, { flex: 1.1, fontWeight: '700' }]}>合計</Text>
                    <Text style={[styles.tdCell, { flex: 0.6, textAlign: 'right', fontWeight: '700' }]}>{summary.totals.courseCount}</Text>
                    <Text style={[styles.tdCell, { flex: 1.3, textAlign: 'right', fontWeight: '700' }]}>¥{summary.totals.sales.toLocaleString()}</Text>
                    <Text style={[styles.tdCell, { flex: 1.2, textAlign: 'right', color: '#92400E', fontWeight: '700' }]}>¥{Math.round(totOutsource).toLocaleString()}</Text>
                    <Text style={[styles.tdCell, { flex: 1.2, textAlign: 'right', color: '#9333EA', fontWeight: '700' }]}>¥{Math.round(totEmployee).toLocaleString()}</Text>
                    <Text style={[styles.tdCell, { flex: 1.2, textAlign: 'right', color: '#B45309', fontWeight: '700' }]}>¥{Math.round(summary.totals.expense).toLocaleString()}</Text>
                    <Text style={[styles.tdCell, { flex: 1.2, textAlign: 'right', color: summary.totals.profit >= 0 ? '#15803D' : '#DC2626', fontWeight: '700' }]}>¥{Math.round(summary.totals.profit).toLocaleString()}</Text>
                    <Text style={[styles.tdCell, { flex: 0.8, textAlign: 'right', fontWeight: '700' }]}>{summary.totals.rate.toFixed(1)}%</Text>
                  </View>
                );
              })()}
            </View>

            <Text style={styles.note}>
              ※ 売上は確定値、外注は支払い明細の総額、社員は月給を稼働日数で営業所別按分した金額です。
              {'\n'}
              ※ payment_summary が未保存の月は「外注列」に稼働記録合計を表示します (社員は0)。
              {'\n'}
              ※ 「支払い明細→💾 NexPortに反映」を月次で実行してください。
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function StatCard({
  label,
  value,
  color,
  isPercent,
}: {
  label: string;
  value: number;
  color: string;
  isPercent?: boolean;
}) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, { color }]}>
        {isPercent ? `${value.toFixed(1)}%` : `¥${value.toLocaleString()}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#0F172A',
  },
  backBtn: { paddingVertical: 6, paddingHorizontal: 10 },
  backText: { color: '#fff', fontSize: 14 },
  title: { color: '#fff', fontSize: 18, fontWeight: '700' },
  subtitle: { color: '#CBD5E1', fontSize: 11, marginTop: 2 },
  controlBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  controlLabel: { fontSize: 13, color: '#475569', marginRight: 10 },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  tabBtnActive: { borderBottomColor: '#16A34A' },
  tabText: { fontSize: 14, color: '#94A3B8', fontWeight: '600' },
  tabTextActive: { color: '#16A34A' },
  chartLegend: { flexDirection: 'row', gap: 16, marginBottom: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 12, height: 12, borderRadius: 2 },
  legendText: { fontSize: 12, color: '#475569' },
  chartArea: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 200,
    paddingHorizontal: 4,
    gap: 2,
  },
  chartCol: {
    flex: 1,
    minWidth: 36,
    alignItems: 'center',
    height: '100%',
    justifyContent: 'flex-end',
  },
  chartValue: { fontSize: 9, color: '#64748B', marginBottom: 4 },
  chartBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 1,
    height: 150,
  },
  chartBar: {
    width: 10,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  chartLabel: { fontSize: 10, color: '#475569', marginTop: 6, fontWeight: '600' },
  monthScroll: { flex: 1 },
  monthChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#F1F5F9',
    borderRadius: 16,
    marginRight: 6,
  },
  monthChipActive: { backgroundColor: '#16A34A' },
  monthChipText: { fontSize: 13, color: '#475569' },
  monthChipTextActive: { color: '#fff', fontWeight: '600' },
  reloadBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#16A34A',
    borderRadius: 8,
    marginLeft: 10,
  },
  reloadText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  errorBox: {
    margin: 16,
    padding: 12,
    backgroundColor: '#FEE2E2',
    borderColor: '#FCA5A5',
    borderWidth: 1,
    borderRadius: 8,
  },
  errorText: { color: '#991B1B', fontSize: 13 },
  emptyCard: {
    padding: 32,
    backgroundColor: '#fff',
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 24,
  },
  emptyIcon: { fontSize: 48, marginBottom: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: '#475569', marginBottom: 8 },
  emptyDesc: { fontSize: 13, color: '#94A3B8', textAlign: 'center', lineHeight: 20 },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#D1FAE5',
    borderRadius: 12,
    marginBottom: 12,
  },
  statusBadgeText: { color: '#065F46', fontSize: 12, fontWeight: '600' },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  statCard: {
    flex: 1,
    minWidth: 120,
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  statLabel: { fontSize: 12, color: '#64748B', marginBottom: 6 },
  statValue: { fontSize: 18, fontWeight: '700' },
  tableCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#1E293B', marginBottom: 12 },
  tableHead: {
    flexDirection: 'row',
    paddingVertical: 8,
    borderBottomWidth: 2,
    borderBottomColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
  },
  thCell: { fontSize: 12, color: '#475569', fontWeight: '600' },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    alignItems: 'center',
  },
  totalRow: { backgroundColor: '#F1F5F9', borderTopWidth: 2, borderTopColor: '#CBD5E1' },
  tdCell: { fontSize: 13, color: '#1E293B' },
  note: {
    marginTop: 16,
    fontSize: 11,
    color: '#94A3B8',
    lineHeight: 18,
  },
});
