import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Modal,
  TextInput, ActivityIndicator, FlatList, Platform, Dimensions,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { confirmDialog, alertDialog } from '../lib/platformHelpers';
import RadarChart from './RadarChart';

type Props = {
  currentUserId: string;
  isAdmin: boolean;
  renderHeader: (title: string, action?: React.ReactNode) => React.ReactNode;
};

type Profile = { id: string; display_name: string; role?: string };

type Tab = 'achievements' | 'skills' | 'assessment';

type Category = {
  id: string;
  label: string;
  description: string | null;
  sort_order: number;
  is_default: boolean;
  archived: boolean;
};

type Assessment = {
  id: string;
  user_id: string;
  period_label: string;
  self_completed_at: string | null;
  manager_id: string | null;
  manager_completed_at: string | null;
  overall_comment: string | null;
  created_at: string;
  updated_at: string;
};

type Score = {
  id: string;
  assessment_id: string;
  category_id: string;
  self_score: number | null;
  manager_score: number | null;
  self_note: string | null;
  manager_note: string | null;
};

type Achievement = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  category: string | null;
  period_from: string | null;
  period_to: string | null;
  self_rating: number | null;
  self_comment: string | null;
  manager_id: string | null;
  manager_rating: number | null;
  manager_comment: string | null;
  manager_reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

type Skill = {
  id: string;
  user_id: string;
  kind: 'skill' | 'certification';
  name: string;
  issuer: string | null;
  acquired_on: string | null;
  expires_on: string | null;
  self_level: number | null;
  note: string | null;
  manager_id: string | null;
  manager_verified: boolean;
  manager_level: number | null;
  manager_comment: string | null;
  manager_reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

const ACH_CATEGORIES = ['プロジェクト', '業務改善', '営業', '新人育成', '社内貢献', 'その他'];

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDate(s: string | null): string {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

function StarRating({ value, onChange, size = 22, color = '#F59E0B' }: {
  value: number | null;
  onChange?: (v: number) => void;
  size?: number;
  color?: string;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <TouchableOpacity
          key={i}
          disabled={!onChange}
          onPress={() => onChange?.(i)}
          style={{ paddingHorizontal: 2 }}
        >
          <Text style={{ fontSize: size, color: (value ?? 0) >= i ? color : '#E2E8F0' }}>★</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export default function PortfolioScreen({ currentUserId, isAdmin, renderHeader }: Props) {
  const [tab, setTab] = useState<Tab>('achievements');
  const [members, setMembers] = useState<Profile[]>([]);
  const [targetUserId, setTargetUserId] = useState<string>(currentUserId);
  const [showUserPicker, setShowUserPicker] = useState(false);

  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(false);

  const [editAch, setEditAch] = useState<Achievement | null>(null);
  const [editSkill, setEditSkill] = useState<Skill | null>(null);
  const [createAchModal, setCreateAchModal] = useState(false);
  const [createSkillModal, setCreateSkillModal] = useState(false);

  // ─ アセスメント状態 ─
  const [categories, setCategories] = useState<Category[]>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [selectedAssessmentId, setSelectedAssessmentId] = useState<string | null>(null);
  const [scores, setScores] = useState<Score[]>([]);
  const [scoresLoading, setScoresLoading] = useState(false);
  const [showNewAssessment, setShowNewAssessment] = useState(false);
  const [showCategoryEditor, setShowCategoryEditor] = useState(false);
  const [newAssessmentPeriod, setNewAssessmentPeriod] = useState('');

  const targetProfile = useMemo(() => members.find(m => m.id === targetUserId), [members, targetUserId]);
  const isViewingSelf = targetUserId === currentUserId;
  const canEditManagerFields = isAdmin && !isViewingSelf;

  useEffect(() => {
    (async () => {
      if (isAdmin) {
        const { data } = await supabase.from('profiles')
          .select('id, display_name, role')
          .eq('account_status', 'active')
          .order('display_name');
        setMembers(data ?? []);
      } else {
        const { data } = await supabase.from('profiles')
          .select('id, display_name, role')
          .eq('id', currentUserId)
          .single();
        if (data) setMembers([data]);
      }
    })();
  }, [isAdmin, currentUserId]);

  const fetchData = useCallback(async () => {
    if (!targetUserId) return;
    setLoading(true);
    const [a, s] = await Promise.all([
      supabase.from('portfolio_achievements')
        .select('*')
        .eq('user_id', targetUserId)
        .order('period_to', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false }),
      supabase.from('portfolio_skills')
        .select('*')
        .eq('user_id', targetUserId)
        .order('kind')
        .order('acquired_on', { ascending: false, nullsFirst: false }),
    ]);
    setAchievements((a.data ?? []) as Achievement[]);
    setSkills((s.data ?? []) as Skill[]);
    setLoading(false);
  }, [targetUserId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ─ アセスメント: カテゴリ取得 ─
  const fetchCategories = useCallback(async () => {
    const { data } = await supabase.from('portfolio_assessment_categories')
      .select('*').eq('archived', false).order('sort_order');
    setCategories((data ?? []) as Category[]);
  }, []);

  // ─ アセスメント一覧取得 ─
  const fetchAssessments = useCallback(async () => {
    if (!targetUserId) return;
    const { data } = await supabase.from('portfolio_assessments')
      .select('*').eq('user_id', targetUserId).order('created_at', { ascending: false });
    const list = (data ?? []) as Assessment[];
    setAssessments(list);
    setSelectedAssessmentId(prev => list.some(a => a.id === prev) ? prev : (list[0]?.id ?? null));
  }, [targetUserId]);

  // ─ スコア取得 ─
  const fetchScores = useCallback(async (assessmentId: string | null) => {
    if (!assessmentId) { setScores([]); return; }
    setScoresLoading(true);
    const { data } = await supabase.from('portfolio_assessment_scores')
      .select('*').eq('assessment_id', assessmentId);
    setScores((data ?? []) as Score[]);
    setScoresLoading(false);
  }, []);

  useEffect(() => { if (tab === 'assessment') { fetchCategories(); fetchAssessments(); } }, [tab, fetchCategories, fetchAssessments]);
  useEffect(() => { fetchScores(selectedAssessmentId); }, [selectedAssessmentId, fetchScores]);

  // ─ 新規アセスメント作成 ─
  const createAssessment = async () => {
    const label = newAssessmentPeriod.trim();
    if (!label) { alertDialog('期間名 (例: 2026上期) を入力してください'); return; }
    const { data, error } = await supabase.from('portfolio_assessments')
      .insert({ user_id: targetUserId, period_label: label })
      .select().single();
    if (error) { alertDialog('作成失敗: ' + error.message); return; }
    setNewAssessmentPeriod('');
    setShowNewAssessment(false);
    await fetchAssessments();
    setSelectedAssessmentId(data.id);
  };

  const deleteAssessment = async (id: string) => {
    if (!await confirmDialog('このアセスメントを削除しますか?\n紐づくスコアもすべて削除されます')) return;
    const { error } = await supabase.from('portfolio_assessments').delete().eq('id', id);
    if (error) { alertDialog('削除失敗: ' + error.message); return; }
    fetchAssessments();
  };

  // ─ スコア更新 (upsert) ─
  const updateScore = async (
    categoryId: string,
    patch: Partial<Pick<Score, 'self_score' | 'manager_score' | 'self_note' | 'manager_note'>>,
  ) => {
    if (!selectedAssessmentId) return;
    const existing = scores.find(s => s.category_id === categoryId);
    if (existing) {
      const { data, error } = await supabase.from('portfolio_assessment_scores')
        .update(patch).eq('id', existing.id).select().single();
      if (!error && data) setScores(prev => prev.map(s => s.id === data.id ? data as Score : s));
    } else {
      const { data, error } = await supabase.from('portfolio_assessment_scores')
        .insert({ assessment_id: selectedAssessmentId, category_id: categoryId, ...patch })
        .select().single();
      if (!error && data) setScores(prev => [...prev, data as Score]);
    }
  };

  const completeSelf = async () => {
    if (!selectedAssessmentId) return;
    const { error } = await supabase.from('portfolio_assessments')
      .update({ self_completed_at: new Date().toISOString() })
      .eq('id', selectedAssessmentId);
    if (error) { alertDialog('更新失敗: ' + error.message); return; }
    fetchAssessments();
    alertDialog('自己評価を確定しました');
  };

  const completeManager = async () => {
    if (!selectedAssessmentId) return;
    const { error } = await supabase.from('portfolio_assessments')
      .update({ manager_id: currentUserId, manager_completed_at: new Date().toISOString() })
      .eq('id', selectedAssessmentId);
    if (error) { alertDialog('更新失敗: ' + error.message); return; }
    fetchAssessments();
    alertDialog('上司評価を確定しました');
  };

  const selectedAssessment = assessments.find(a => a.id === selectedAssessmentId) ?? null;

  const deleteAch = async (id: string) => {
    if (!await confirmDialog('この成果を削除しますか?')) return;
    const { error } = await supabase.from('portfolio_achievements').delete().eq('id', id);
    if (error) { alertDialog('削除に失敗しました: ' + error.message); return; }
    setEditAch(null);
    fetchData();
  };

  const deleteSkill = async (id: string) => {
    if (!await confirmDialog('この項目を削除しますか?')) return;
    const { error } = await supabase.from('portfolio_skills').delete().eq('id', id);
    if (error) { alertDialog('削除に失敗しました: ' + error.message); return; }
    setEditSkill(null);
    fetchData();
  };

  const headerAction = (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {tab === 'assessment' && isAdmin ? (
        <TouchableOpacity
          style={[styles.headerAddBtn, { backgroundColor: '#64748B' }]}
          onPress={() => setShowCategoryEditor(true)}
        >
          <Text style={styles.headerAddBtnText}>⚙ 項目</Text>
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity
        style={[styles.headerAddBtn, { backgroundColor: '#0891B2' }]}
        onPress={() => {
          if (tab === 'achievements') setCreateAchModal(true);
          else if (tab === 'skills') setCreateSkillModal(true);
          else setShowNewAssessment(true);
        }}
      >
        <Text style={styles.headerAddBtnText}>＋ 追加</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      {renderHeader('📁 ポートフォリオ', headerAction)}

      {/* 対象ユーザー */}
      <View style={styles.userBar}>
        <TouchableOpacity
          style={styles.userBtn}
          onPress={() => isAdmin && setShowUserPicker(true)}
          disabled={!isAdmin}
        >
          <Text style={styles.userIcon}>👤</Text>
          <Text style={styles.userName}>{targetProfile?.display_name ?? '...'}</Text>
          {isAdmin ? <Text style={styles.userChevron}>▼</Text> : null}
        </TouchableOpacity>
        {!isViewingSelf ? (
          <View style={styles.managerBadge}>
            <Text style={styles.managerBadgeText}>上司モード</Text>
          </View>
        ) : null}
      </View>

      {/* タブ */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, tab === 'achievements' && styles.tabActive]}
          onPress={() => setTab('achievements')}
        >
          <Text style={[styles.tabText, tab === 'achievements' && styles.tabTextActive]}>🏆 成果</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'skills' && styles.tabActive]}
          onPress={() => setTab('skills')}
        >
          <Text style={[styles.tabText, tab === 'skills' && styles.tabTextActive]}>🎓 スキル</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'assessment' && styles.tabActive]}
          onPress={() => setTab('assessment')}
        >
          <Text style={[styles.tabText, tab === 'assessment' && styles.tabTextActive]}>🧭 アセスメント</Text>
        </TouchableOpacity>
      </View>

      {loading && tab !== 'assessment' ? (
        <ActivityIndicator style={{ marginTop: 40 }} color="#0891B2" />
      ) : tab === 'assessment' ? (
        <AssessmentView
          assessments={assessments}
          selected={selectedAssessment}
          selectedId={selectedAssessmentId}
          onSelect={setSelectedAssessmentId}
          categories={categories}
          scores={scores}
          scoresLoading={scoresLoading}
          canEditSelf={isViewingSelf || isAdmin}
          canEditManager={canEditManagerFields}
          onUpdateScore={updateScore}
          onCompleteSelf={completeSelf}
          onCompleteManager={completeManager}
          onDeleteAssessment={deleteAssessment}
        />
      ) : tab === 'achievements' ? (
        <FlatList
          data={achievements}
          keyExtractor={i => i.id}
          contentContainerStyle={{ padding: 12, paddingBottom: 60 }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🏆</Text>
              <Text style={styles.emptyTitle}>成果がまだありません</Text>
              <Text style={styles.emptyDesc}>右上の「＋ 追加」から登録できます</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => setEditAch(item)}>
              <View style={styles.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{item.title}</Text>
                  {item.category ? (
                    <View style={styles.categoryChip}>
                      <Text style={styles.categoryChipText}>{item.category}</Text>
                    </View>
                  ) : null}
                </View>
                {item.manager_reviewed_at ? (
                  <View style={styles.reviewedBadge}>
                    <Text style={styles.reviewedBadgeText}>✓ 評価済</Text>
                  </View>
                ) : null}
              </View>
              {(item.period_from || item.period_to) ? (
                <Text style={styles.cardPeriod}>
                  📅 {fmtDate(item.period_from)} 〜 {fmtDate(item.period_to)}
                </Text>
              ) : null}
              {item.description ? (
                <Text style={styles.cardDesc} numberOfLines={2}>{item.description}</Text>
              ) : null}
              <View style={styles.cardRatings}>
                <View style={styles.ratingRow}>
                  <Text style={styles.ratingLabel}>自己</Text>
                  <StarRating value={item.self_rating} size={14} />
                </View>
                {item.manager_rating ? (
                  <View style={styles.ratingRow}>
                    <Text style={styles.ratingLabel}>上司</Text>
                    <StarRating value={item.manager_rating} size={14} color="#3B82F6" />
                  </View>
                ) : null}
              </View>
            </TouchableOpacity>
          )}
        />
      ) : (
        <FlatList
          data={skills}
          keyExtractor={i => i.id}
          contentContainerStyle={{ padding: 12, paddingBottom: 60 }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🎓</Text>
              <Text style={styles.emptyTitle}>スキル・資格がまだありません</Text>
              <Text style={styles.emptyDesc}>右上の「＋ 追加」から登録できます</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => setEditSkill(item)}>
              <View style={styles.cardTop}>
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={[styles.kindChip, { backgroundColor: item.kind === 'certification' ? '#FEF3C7' : '#DBEAFE' }]}>
                    <Text style={[styles.kindChipText, { color: item.kind === 'certification' ? '#B45309' : '#1D4ED8' }]}>
                      {item.kind === 'certification' ? '資格' : 'スキル'}
                    </Text>
                  </View>
                  <Text style={styles.cardTitle}>{item.name}</Text>
                </View>
                {item.manager_verified ? (
                  <View style={styles.verifiedBadge}>
                    <Text style={styles.verifiedBadgeText}>✓ 認定</Text>
                  </View>
                ) : null}
              </View>
              {item.issuer ? <Text style={styles.cardSub}>🏢 {item.issuer}</Text> : null}
              {item.acquired_on ? <Text style={styles.cardSub}>取得: {fmtDate(item.acquired_on)}{item.expires_on ? `  /  有効期限: ${fmtDate(item.expires_on)}` : ''}</Text> : null}
              <View style={styles.cardRatings}>
                <View style={styles.ratingRow}>
                  <Text style={styles.ratingLabel}>自己レベル</Text>
                  <StarRating value={item.self_level} size={14} />
                </View>
                {item.manager_level ? (
                  <View style={styles.ratingRow}>
                    <Text style={styles.ratingLabel}>上司</Text>
                    <StarRating value={item.manager_level} size={14} color="#3B82F6" />
                  </View>
                ) : null}
              </View>
            </TouchableOpacity>
          )}
        />
      )}

      {/* ユーザー選択 */}
      <Modal visible={showUserPicker} transparent animationType="fade" onRequestClose={() => setShowUserPicker(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { maxHeight: '70%' }]}>
            <View style={styles.modalTop}>
              <Text style={styles.modalTitle}>ユーザー選択</Text>
              <TouchableOpacity onPress={() => setShowUserPicker(false)}><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
            </View>
            <ScrollView>
              {members.map(m => (
                <TouchableOpacity
                  key={m.id}
                  style={[styles.userRow, m.id === targetUserId && styles.userRowActive]}
                  onPress={() => { setTargetUserId(m.id); setShowUserPicker(false); }}
                >
                  <Text style={styles.userRowText}>{m.display_name}</Text>
                  {m.id === currentUserId ? <Text style={styles.userRowSelf}>(自分)</Text> : null}
                  {m.id === targetUserId ? <Text style={{ color: '#0891B2', fontWeight: '700' }}>✓</Text> : null}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* 成果 編集/作成モーダル */}
      <AchievementEditor
        visible={createAchModal || !!editAch}
        record={editAch}
        targetUserId={targetUserId}
        currentUserId={currentUserId}
        canEditSelf={isViewingSelf || isAdmin}
        canEditManager={canEditManagerFields}
        onClose={() => { setEditAch(null); setCreateAchModal(false); }}
        onSaved={() => { setEditAch(null); setCreateAchModal(false); fetchData(); }}
        onDelete={editAch ? () => deleteAch(editAch.id) : undefined}
      />

      {/* 新規アセスメント */}
      <Modal visible={showNewAssessment} transparent animationType="slide" onRequestClose={() => setShowNewAssessment(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { maxHeight: '50%' }]}>
            <View style={styles.modalTop}>
              <Text style={styles.modalTitle}>新規アセスメント</Text>
              <TouchableOpacity onPress={() => setShowNewAssessment(false)}><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
            </View>
            <Text style={styles.fLabel}>期間名 *</Text>
            <TextInput
              style={styles.fInput}
              value={newAssessmentPeriod}
              onChangeText={setNewAssessmentPeriod}
              placeholder="例: 2026上期 / 2026Q2"
              placeholderTextColor="#C0C0C0"
            />
            <Text style={{ fontSize: 11, color: '#94A3B8', marginTop: 6 }}>
              同じ期間名で重複作成はできません。期間ごとに記録を残せます。
            </Text>
            <View style={styles.modalButtonsRow}>
              <View style={{ flex: 1 }} />
              <TouchableOpacity style={styles.saveBtn} onPress={createAssessment}>
                <Text style={styles.saveBtnText}>作成</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* カテゴリ編集 (admin) */}
      <CategoryEditor
        visible={showCategoryEditor}
        categories={categories}
        onClose={() => setShowCategoryEditor(false)}
        onChanged={fetchCategories}
      />

      {/* スキル 編集/作成モーダル */}
      <SkillEditor
        visible={createSkillModal || !!editSkill}
        record={editSkill}
        targetUserId={targetUserId}
        currentUserId={currentUserId}
        canEditSelf={isViewingSelf || isAdmin}
        canEditManager={canEditManagerFields}
        onClose={() => { setEditSkill(null); setCreateSkillModal(false); }}
        onSaved={() => { setEditSkill(null); setCreateSkillModal(false); fetchData(); }}
        onDelete={editSkill ? () => deleteSkill(editSkill.id) : undefined}
      />
    </View>
  );
}

// ─── Achievement Editor ────────────────────────────────────────
function AchievementEditor({
  visible, record, targetUserId, currentUserId, canEditSelf, canEditManager, onClose, onSaved, onDelete,
}: {
  visible: boolean;
  record: Achievement | null;
  targetUserId: string;
  currentUserId: string;
  canEditSelf: boolean;
  canEditManager: boolean;
  onClose: () => void;
  onSaved: () => void;
  onDelete?: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [periodFrom, setPeriodFrom] = useState('');
  const [periodTo, setPeriodTo] = useState('');
  const [selfRating, setSelfRating] = useState<number | null>(null);
  const [selfComment, setSelfComment] = useState('');
  const [managerRating, setManagerRating] = useState<number | null>(null);
  const [managerComment, setManagerComment] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    if (record) {
      setTitle(record.title);
      setDescription(record.description ?? '');
      setCategory(record.category ?? '');
      setPeriodFrom(record.period_from ?? '');
      setPeriodTo(record.period_to ?? '');
      setSelfRating(record.self_rating);
      setSelfComment(record.self_comment ?? '');
      setManagerRating(record.manager_rating);
      setManagerComment(record.manager_comment ?? '');
    } else {
      setTitle(''); setDescription(''); setCategory('');
      setPeriodFrom(''); setPeriodTo(todayStr());
      setSelfRating(null); setSelfComment('');
      setManagerRating(null); setManagerComment('');
    }
  }, [visible, record]);

  const save = async () => {
    if (!title.trim()) { alertDialog('タイトルを入力してください'); return; }
    setSaving(true);
    const managerChanged = record
      ? (managerRating !== record.manager_rating || (managerComment ?? '') !== (record.manager_comment ?? ''))
      : (managerRating != null || !!managerComment.trim());

    const payload: any = {
      user_id: targetUserId,
      title: title.trim(),
      description: description.trim() || null,
      category: category || null,
      period_from: periodFrom || null,
      period_to: periodTo || null,
    };
    if (canEditSelf) {
      payload.self_rating = selfRating;
      payload.self_comment = selfComment.trim() || null;
    }
    if (canEditManager) {
      payload.manager_rating = managerRating;
      payload.manager_comment = managerComment.trim() || null;
      if (managerChanged && (managerRating != null || managerComment.trim())) {
        payload.manager_id = currentUserId;
        payload.manager_reviewed_at = new Date().toISOString();
      }
    }
    const { error } = record
      ? await supabase.from('portfolio_achievements').update(payload).eq('id', record.id)
      : await supabase.from('portfolio_achievements').insert(payload);
    setSaving(false);
    if (error) { alertDialog('保存失敗: ' + error.message); return; }
    onSaved();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          <View style={styles.modalTop}>
            <Text style={styles.modalTitle}>{record ? '成果・実績' : '成果・実績 追加'}</Text>
            <TouchableOpacity onPress={onClose}><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.fLabel}>タイトル *</Text>
            <TextInput
              style={styles.fInput}
              value={title}
              onChangeText={setTitle}
              editable={canEditSelf}
              placeholder="例: ECサイトリニューアル"
              placeholderTextColor="#C0C0C0"
            />

            <Text style={styles.fLabel}>カテゴリ</Text>
            <View style={styles.chipRow}>
              {ACH_CATEGORIES.map(c => (
                <TouchableOpacity
                  key={c}
                  disabled={!canEditSelf}
                  onPress={() => setCategory(category === c ? '' : c)}
                  style={[styles.choiceChip, category === c && styles.choiceChipActive]}
                >
                  <Text style={[styles.choiceChipText, category === c && styles.choiceChipTextActive]}>{c}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fLabel}>期間 (開始)</Text>
                <TextInput
                  style={styles.fInput}
                  value={periodFrom}
                  onChangeText={setPeriodFrom}
                  editable={canEditSelf}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#C0C0C0"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fLabel}>期間 (終了)</Text>
                <TextInput
                  style={styles.fInput}
                  value={periodTo}
                  onChangeText={setPeriodTo}
                  editable={canEditSelf}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#C0C0C0"
                />
              </View>
            </View>

            <Text style={styles.fLabel}>内容・成果</Text>
            <TextInput
              style={[styles.fInput, { minHeight: 90, textAlignVertical: 'top' }]}
              value={description}
              onChangeText={setDescription}
              editable={canEditSelf}
              multiline
              placeholder="担当業務、達成した成果、数値など"
              placeholderTextColor="#C0C0C0"
            />

            <Text style={[styles.fLabel, { marginTop: 18 }]}>自己評価</Text>
            <View style={{ marginVertical: 6 }}>
              <StarRating value={selfRating} onChange={canEditSelf ? setSelfRating : undefined} size={28} />
            </View>
            <TextInput
              style={[styles.fInput, { minHeight: 60, textAlignVertical: 'top' }]}
              value={selfComment}
              onChangeText={setSelfComment}
              editable={canEditSelf}
              multiline
              placeholder="振り返り、工夫した点、課題など"
              placeholderTextColor="#C0C0C0"
            />

            <View style={styles.managerSection}>
              <Text style={styles.managerSectionTitle}>👔 上司評価</Text>
              {!canEditManager ? (
                <Text style={styles.managerSectionNote}>※ 上司・管理者のみ編集可</Text>
              ) : null}
              <View style={{ marginVertical: 6 }}>
                <StarRating value={managerRating} onChange={canEditManager ? setManagerRating : undefined} size={28} color="#3B82F6" />
              </View>
              <TextInput
                style={[styles.fInput, { minHeight: 80, textAlignVertical: 'top' }]}
                value={managerComment}
                onChangeText={setManagerComment}
                editable={canEditManager}
                multiline
                placeholder={canEditManager ? '評価コメント、フィードバック' : ''}
                placeholderTextColor="#C0C0C0"
              />
              {record?.manager_reviewed_at ? (
                <Text style={styles.reviewMeta}>評価: {fmtDate(record.manager_reviewed_at)}</Text>
              ) : null}
            </View>

            <View style={styles.modalButtonsRow}>
              {onDelete ? (
                <TouchableOpacity style={styles.deleteBtn} onPress={onDelete}>
                  <Text style={styles.deleteBtnText}>削除</Text>
                </TouchableOpacity>
              ) : <View style={{ flex: 1 }} />}
              <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} disabled={saving} onPress={save}>
                <Text style={styles.saveBtnText}>{saving ? '保存中…' : '保存'}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Skill Editor ──────────────────────────────────────────────
function SkillEditor({
  visible, record, targetUserId, currentUserId, canEditSelf, canEditManager, onClose, onSaved, onDelete,
}: {
  visible: boolean;
  record: Skill | null;
  targetUserId: string;
  currentUserId: string;
  canEditSelf: boolean;
  canEditManager: boolean;
  onClose: () => void;
  onSaved: () => void;
  onDelete?: () => void;
}) {
  const [kind, setKind] = useState<'skill' | 'certification'>('skill');
  const [name, setName] = useState('');
  const [issuer, setIssuer] = useState('');
  const [acquiredOn, setAcquiredOn] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [selfLevel, setSelfLevel] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [managerVerified, setManagerVerified] = useState(false);
  const [managerLevel, setManagerLevel] = useState<number | null>(null);
  const [managerComment, setManagerComment] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    if (record) {
      setKind(record.kind);
      setName(record.name);
      setIssuer(record.issuer ?? '');
      setAcquiredOn(record.acquired_on ?? '');
      setExpiresOn(record.expires_on ?? '');
      setSelfLevel(record.self_level);
      setNote(record.note ?? '');
      setManagerVerified(record.manager_verified);
      setManagerLevel(record.manager_level);
      setManagerComment(record.manager_comment ?? '');
    } else {
      setKind('skill'); setName(''); setIssuer('');
      setAcquiredOn(''); setExpiresOn('');
      setSelfLevel(null); setNote('');
      setManagerVerified(false); setManagerLevel(null); setManagerComment('');
    }
  }, [visible, record]);

  const save = async () => {
    if (!name.trim()) { alertDialog('名称を入力してください'); return; }
    setSaving(true);
    const managerChanged = record
      ? (managerVerified !== record.manager_verified
          || managerLevel !== record.manager_level
          || (managerComment ?? '') !== (record.manager_comment ?? ''))
      : (managerVerified || managerLevel != null || !!managerComment.trim());

    const payload: any = {
      user_id: targetUserId,
      kind,
      name: name.trim(),
      issuer: issuer.trim() || null,
      acquired_on: acquiredOn || null,
      expires_on: expiresOn || null,
    };
    if (canEditSelf) {
      payload.self_level = selfLevel;
      payload.note = note.trim() || null;
    }
    if (canEditManager) {
      payload.manager_verified = managerVerified;
      payload.manager_level = managerLevel;
      payload.manager_comment = managerComment.trim() || null;
      if (managerChanged && (managerVerified || managerLevel != null || managerComment.trim())) {
        payload.manager_id = currentUserId;
        payload.manager_reviewed_at = new Date().toISOString();
      }
    }
    const { error } = record
      ? await supabase.from('portfolio_skills').update(payload).eq('id', record.id)
      : await supabase.from('portfolio_skills').insert(payload);
    setSaving(false);
    if (error) { alertDialog('保存失敗: ' + error.message); return; }
    onSaved();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          <View style={styles.modalTop}>
            <Text style={styles.modalTitle}>{record ? 'スキル・資格' : 'スキル・資格 追加'}</Text>
            <TouchableOpacity onPress={onClose}><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.fLabel}>種別</Text>
            <View style={styles.chipRow}>
              {(['skill', 'certification'] as const).map(k => (
                <TouchableOpacity
                  key={k}
                  disabled={!canEditSelf}
                  onPress={() => setKind(k)}
                  style={[styles.choiceChip, kind === k && styles.choiceChipActive]}
                >
                  <Text style={[styles.choiceChipText, kind === k && styles.choiceChipTextActive]}>
                    {k === 'skill' ? 'スキル' : '資格'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fLabel}>名称 *</Text>
            <TextInput
              style={styles.fInput}
              value={name}
              onChangeText={setName}
              editable={canEditSelf}
              placeholder={kind === 'skill' ? '例: TypeScript, プロジェクト管理' : '例: 基本情報技術者'}
              placeholderTextColor="#C0C0C0"
            />

            {kind === 'certification' ? (
              <>
                <Text style={styles.fLabel}>発行機関</Text>
                <TextInput
                  style={styles.fInput}
                  value={issuer}
                  onChangeText={setIssuer}
                  editable={canEditSelf}
                  placeholder="例: IPA"
                  placeholderTextColor="#C0C0C0"
                />
              </>
            ) : null}

            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fLabel}>{kind === 'certification' ? '取得日' : '習得日'}</Text>
                <TextInput
                  style={styles.fInput}
                  value={acquiredOn}
                  onChangeText={setAcquiredOn}
                  editable={canEditSelf}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#C0C0C0"
                />
              </View>
              {kind === 'certification' ? (
                <View style={{ flex: 1 }}>
                  <Text style={styles.fLabel}>有効期限</Text>
                  <TextInput
                    style={styles.fInput}
                    value={expiresOn}
                    onChangeText={setExpiresOn}
                    editable={canEditSelf}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#C0C0C0"
                  />
                </View>
              ) : null}
            </View>

            <Text style={[styles.fLabel, { marginTop: 12 }]}>自己レベル</Text>
            <View style={{ marginVertical: 6 }}>
              <StarRating value={selfLevel} onChange={canEditSelf ? setSelfLevel : undefined} size={28} />
            </View>

            <Text style={styles.fLabel}>メモ</Text>
            <TextInput
              style={[styles.fInput, { minHeight: 60, textAlignVertical: 'top' }]}
              value={note}
              onChangeText={setNote}
              editable={canEditSelf}
              multiline
              placeholder="経験年数、関連プロジェクトなど"
              placeholderTextColor="#C0C0C0"
            />

            <View style={styles.managerSection}>
              <Text style={styles.managerSectionTitle}>👔 上司認定</Text>
              {!canEditManager ? (
                <Text style={styles.managerSectionNote}>※ 上司・管理者のみ編集可</Text>
              ) : null}

              <TouchableOpacity
                style={[styles.checkRow, !canEditManager && { opacity: 0.6 }]}
                disabled={!canEditManager}
                onPress={() => setManagerVerified(v => !v)}
              >
                <View style={[styles.checkBox, managerVerified && styles.checkBoxOn]}>
                  {managerVerified ? <Text style={styles.checkMark}>✓</Text> : null}
                </View>
                <Text style={styles.checkLabel}>このスキル・資格を認定する</Text>
              </TouchableOpacity>

              <Text style={[styles.fLabel, { marginTop: 8 }]}>上司レベル評価</Text>
              <View style={{ marginVertical: 6 }}>
                <StarRating value={managerLevel} onChange={canEditManager ? setManagerLevel : undefined} size={28} color="#3B82F6" />
              </View>

              <TextInput
                style={[styles.fInput, { minHeight: 60, textAlignVertical: 'top' }]}
                value={managerComment}
                onChangeText={setManagerComment}
                editable={canEditManager}
                multiline
                placeholder={canEditManager ? 'コメント' : ''}
                placeholderTextColor="#C0C0C0"
              />
              {record?.manager_reviewed_at ? (
                <Text style={styles.reviewMeta}>評価: {fmtDate(record.manager_reviewed_at)}</Text>
              ) : null}
            </View>

            <View style={styles.modalButtonsRow}>
              {onDelete ? (
                <TouchableOpacity style={styles.deleteBtn} onPress={onDelete}>
                  <Text style={styles.deleteBtnText}>削除</Text>
                </TouchableOpacity>
              ) : <View style={{ flex: 1 }} />}
              <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} disabled={saving} onPress={save}>
                <Text style={styles.saveBtnText}>{saving ? '保存中…' : '保存'}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Assessment View ───────────────────────────────────────────
function AssessmentView({
  assessments, selected, selectedId, onSelect, categories, scores, scoresLoading,
  canEditSelf, canEditManager, onUpdateScore, onCompleteSelf, onCompleteManager, onDeleteAssessment,
}: {
  assessments: Assessment[];
  selected: Assessment | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  categories: Category[];
  scores: Score[];
  scoresLoading: boolean;
  canEditSelf: boolean;
  canEditManager: boolean;
  onUpdateScore: (categoryId: string, patch: Partial<Pick<Score, 'self_score' | 'manager_score' | 'self_note' | 'manager_note'>>) => Promise<void> | void;
  onCompleteSelf: () => void;
  onCompleteManager: () => void;
  onDeleteAssessment: (id: string) => void;
}) {
  const scoreMap = useMemo(() => {
    const m = new Map<string, Score>();
    scores.forEach(s => m.set(s.category_id, s));
    return m;
  }, [scores]);

  const chartSeries = useMemo(() => {
    const selfVals = categories.map(c => scoreMap.get(c.id)?.self_score ?? 0);
    const mgrVals = categories.map(c => scoreMap.get(c.id)?.manager_score ?? 0);
    const series = [];
    if (selfVals.some(v => v > 0)) {
      series.push({ label: '自己評価', values: selfVals, color: '#F59E0B', fillOpacity: 0.25 });
    }
    if (mgrVals.some(v => v > 0)) {
      series.push({ label: '上司評価', values: mgrVals, color: '#3B82F6', fillOpacity: 0.25 });
    }
    return series;
  }, [categories, scoreMap]);

  const fmt = (s: string | null) => s ? new Date(s).toLocaleDateString('ja-JP') : '未確定';

  if (assessments.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyIcon}>🧭</Text>
        <Text style={styles.emptyTitle}>アセスメントがまだありません</Text>
        <Text style={styles.emptyDesc}>右上の「＋ 追加」から期間ごとに作成できます</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 60 }}>
      {/* 期間タブ */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 6 }}>
        {assessments.map(a => (
          <TouchableOpacity
            key={a.id}
            style={[styles.periodChip, selectedId === a.id && styles.periodChipActive]}
            onPress={() => onSelect(a.id)}
          >
            <Text style={[styles.periodChipText, selectedId === a.id && styles.periodChipTextActive]}>
              {a.period_label}
            </Text>
            {a.self_completed_at && a.manager_completed_at ? (
              <Text style={{ fontSize: 10, color: selectedId === a.id ? '#fff' : '#94A3B8' }}>✓ 完了</Text>
            ) : a.self_completed_at ? (
              <Text style={{ fontSize: 10, color: selectedId === a.id ? '#fff' : '#94A3B8' }}>自己済</Text>
            ) : null}
          </TouchableOpacity>
        ))}
      </ScrollView>

      {!selected ? null : (
        <>
          {/* メタ情報 */}
          <View style={styles.assessmentMeta}>
            <Text style={styles.assessmentTitle}>{selected.period_label}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4 }}>
              <Text style={styles.assessmentMetaText}>自己: {fmt(selected.self_completed_at)}</Text>
              <Text style={styles.assessmentMetaText}>上司: {fmt(selected.manager_completed_at)}</Text>
            </View>
            <TouchableOpacity
              style={{ position: 'absolute', top: 10, right: 10 }}
              onPress={() => onDeleteAssessment(selected.id)}
            >
              <Text style={{ fontSize: 13, color: '#DC2626' }}>削除</Text>
            </TouchableOpacity>
          </View>

          {/* レーダーチャート */}
          {scoresLoading ? (
            <ActivityIndicator style={{ marginVertical: 30 }} color="#0891B2" />
          ) : chartSeries.length === 0 ? (
            <View style={[styles.empty, { paddingTop: 30 }]}>
              <Text style={styles.emptyIcon}>📊</Text>
              <Text style={styles.emptyDesc}>下の各項目を1〜5で評価するとチャートが表示されます</Text>
            </View>
          ) : (
            <View style={styles.chartCard}>
              <RadarChart
                axes={categories.map(c => c.label)}
                series={chartSeries}
                size={Math.min(340, Dimensions.get('window').width - 60)}
              />
            </View>
          )}

          {/* 各カテゴリの入力行 */}
          <Text style={styles.sectionTitle}>📝 評価入力</Text>
          {categories.map(c => {
            const score = scoreMap.get(c.id);
            return (
              <View key={c.id} style={styles.scoreRow}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.scoreLabel}>{c.label}</Text>
                    {c.description ? <Text style={styles.scoreDesc}>{c.description}</Text> : null}
                  </View>
                </View>
                <View style={styles.scoreRatings}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.scoreSubLabel}>自己評価</Text>
                    <StarRating
                      value={score?.self_score ?? null}
                      size={26}
                      onChange={canEditSelf ? (v) => onUpdateScore(c.id, { self_score: v }) : undefined}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.scoreSubLabel}>上司評価</Text>
                    <StarRating
                      value={score?.manager_score ?? null}
                      size={26}
                      color="#3B82F6"
                      onChange={canEditManager ? (v) => onUpdateScore(c.id, { manager_score: v }) : undefined}
                    />
                  </View>
                </View>
              </View>
            );
          })}

          {/* 確定ボタン */}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
            {canEditSelf && !selected.self_completed_at ? (
              <TouchableOpacity style={[styles.saveBtn, { backgroundColor: '#F59E0B' }]} onPress={onCompleteSelf}>
                <Text style={styles.saveBtnText}>自己評価を確定</Text>
              </TouchableOpacity>
            ) : null}
            {canEditManager && !selected.manager_completed_at ? (
              <TouchableOpacity style={[styles.saveBtn, { backgroundColor: '#3B82F6' }]} onPress={onCompleteManager}>
                <Text style={styles.saveBtnText}>上司評価を確定</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </>
      )}
    </ScrollView>
  );
}

// ─── Category Editor (admin) ───────────────────────────────────
function CategoryEditor({
  visible, categories, onClose, onChanged,
}: {
  visible: boolean;
  categories: Category[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [newLabel, setNewLabel] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [saving, setSaving] = useState(false);

  const addCategory = async () => {
    if (!newLabel.trim()) return;
    setSaving(true);
    const maxOrder = categories.reduce((m, c) => Math.max(m, c.sort_order), 0);
    const { error } = await supabase.from('portfolio_assessment_categories').insert({
      label: newLabel.trim(),
      description: newDesc.trim() || null,
      sort_order: maxOrder + 10,
      is_default: false,
    });
    setSaving(false);
    if (error) { alertDialog('追加失敗: ' + error.message); return; }
    setNewLabel(''); setNewDesc('');
    onChanged();
  };

  const removeCategory = async (c: Category) => {
    if (!await confirmDialog(`「${c.label}」を削除しますか?\n紐づくスコアもすべて削除されます`)) return;
    const { error } = await supabase.from('portfolio_assessment_categories').delete().eq('id', c.id);
    if (error) { alertDialog('削除失敗: ' + error.message); return; }
    onChanged();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          <View style={styles.modalTop}>
            <Text style={styles.modalTitle}>評価項目の管理</Text>
            <TouchableOpacity onPress={onClose}><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            {categories.map(c => (
              <View key={c.id} style={styles.catRow}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.catLabel}>{c.label}</Text>
                    {c.is_default ? <Text style={styles.catBadge}>標準</Text> : null}
                  </View>
                  {c.description ? <Text style={styles.catDesc}>{c.description}</Text> : null}
                </View>
                <TouchableOpacity onPress={() => removeCategory(c)}>
                  <Text style={{ fontSize: 13, color: '#DC2626' }}>削除</Text>
                </TouchableOpacity>
              </View>
            ))}

            <Text style={[styles.fLabel, { marginTop: 18 }]}>新しい項目を追加</Text>
            <TextInput
              style={styles.fInput}
              value={newLabel}
              onChangeText={setNewLabel}
              placeholder="項目名 (例: 顧客対応力)"
              placeholderTextColor="#C0C0C0"
            />
            <TextInput
              style={[styles.fInput, { marginTop: 8 }]}
              value={newDesc}
              onChangeText={setNewDesc}
              placeholder="説明 (任意)"
              placeholderTextColor="#C0C0C0"
            />
            <TouchableOpacity
              style={[styles.saveBtn, { marginTop: 12, opacity: saving ? 0.6 : 1 }]}
              disabled={saving}
              onPress={addCategory}
            >
              <Text style={styles.saveBtnText}>{saving ? '追加中…' : '＋ 追加'}</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  headerAddBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  headerAddBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  userBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 10, gap: 8 },
  userBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#E2E8F0', gap: 6 },
  userIcon: { fontSize: 14 },
  userName: { fontSize: 14, fontWeight: '700', color: '#1E293B' },
  userChevron: { fontSize: 10, color: '#94A3B8' },
  managerBadge: { backgroundColor: '#FEF3C7', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  managerBadgeText: { fontSize: 11, color: '#B45309', fontWeight: '700' },

  tabBar: { flexDirection: 'row', paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6, gap: 8 },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10, backgroundColor: '#F1F5F9' },
  tabActive: { backgroundColor: '#0891B2' },
  tabText: { fontSize: 13, fontWeight: '600', color: '#64748B' },
  tabTextActive: { color: '#fff' },

  empty: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#333', marginBottom: 8 },
  emptyDesc: { fontSize: 13, color: '#999', textAlign: 'center', lineHeight: 20 },

  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, borderLeftWidth: 4, borderLeftColor: '#0891B2', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 },
  cardTitle: { fontSize: 15, fontWeight: 'bold', color: '#1E293B' },
  categoryChip: { alignSelf: 'flex-start', backgroundColor: '#E0F2FE', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, marginTop: 4 },
  categoryChipText: { fontSize: 11, color: '#0369A1', fontWeight: '600' },
  reviewedBadge: { backgroundColor: '#DCFCE7', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  reviewedBadgeText: { fontSize: 11, color: '#15803D', fontWeight: '700' },
  cardPeriod: { fontSize: 12, color: '#64748B', marginTop: 6 },
  cardDesc: { fontSize: 13, color: '#475569', marginTop: 6, lineHeight: 18 },
  cardSub: { fontSize: 12, color: '#64748B', marginTop: 4 },
  cardRatings: { flexDirection: 'row', gap: 16, marginTop: 8, flexWrap: 'wrap' },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ratingLabel: { fontSize: 11, color: '#94A3B8', fontWeight: '600' },

  kindChip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  kindChipText: { fontSize: 11, fontWeight: '700' },
  verifiedBadge: { backgroundColor: '#FEF3C7', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  verifiedBadgeText: { fontSize: 11, color: '#B45309', fontWeight: '700' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.7)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  modalSheet: { backgroundColor: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 520, maxHeight: '90%' },
  modalTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  modalTitle: { fontSize: 17, fontWeight: 'bold', color: '#1E293B' },
  modalClose: { fontSize: 20, color: '#94A3B8' },

  userRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#F1F5F9', gap: 8 },
  userRowActive: { backgroundColor: '#ECFEFF' },
  userRowText: { flex: 1, fontSize: 14, color: '#1E293B' },
  userRowSelf: { fontSize: 11, color: '#94A3B8' },

  fLabel: { fontSize: 12, fontWeight: '700', color: '#475569', marginTop: 12, marginBottom: 4 },
  fInput: { backgroundColor: '#F8FAFC', borderRadius: 8, paddingHorizontal: 10, paddingVertical: Platform.OS === 'web' ? 10 : 8, fontSize: 14, color: '#1E293B', borderWidth: 1, borderColor: '#E2E8F0' },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  choiceChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: '#F1F5F9' },
  choiceChipActive: { backgroundColor: '#0891B2' },
  choiceChipText: { fontSize: 12, color: '#64748B', fontWeight: '600' },
  choiceChipTextActive: { color: '#fff' },

  managerSection: { marginTop: 20, padding: 12, backgroundColor: '#F8FAFC', borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0' },
  managerSectionTitle: { fontSize: 13, fontWeight: '700', color: '#1E293B' },
  managerSectionNote: { fontSize: 11, color: '#94A3B8', marginTop: 2 },
  reviewMeta: { fontSize: 11, color: '#94A3B8', marginTop: 8 },

  checkRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 8 },
  checkBox: { width: 22, height: 22, borderRadius: 5, borderWidth: 2, borderColor: '#CBD5E1', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  checkBoxOn: { backgroundColor: '#3B82F6', borderColor: '#3B82F6' },
  checkMark: { color: '#fff', fontWeight: '900' },
  checkLabel: { fontSize: 13, color: '#1E293B', fontWeight: '600' },

  modalButtonsRow: { flexDirection: 'row', gap: 10, marginTop: 18, alignItems: 'center' },
  deleteBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, backgroundColor: '#FEE2E2' },
  deleteBtnText: { color: '#DC2626', fontWeight: '700', fontSize: 13 },
  saveBtn: { flex: 1, paddingVertical: 12, borderRadius: 8, backgroundColor: '#0891B2', alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  // アセスメント
  periodChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: '#F1F5F9' },
  periodChipActive: { backgroundColor: '#0891B2' },
  periodChipText: { fontSize: 13, fontWeight: '700', color: '#475569' },
  periodChipTextActive: { color: '#fff' },

  assessmentMeta: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginTop: 8, borderLeftWidth: 4, borderLeftColor: '#0891B2', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 2 },
  assessmentTitle: { fontSize: 16, fontWeight: 'bold', color: '#1E293B' },
  assessmentMetaText: { fontSize: 12, color: '#64748B' },

  chartCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginTop: 12, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 2 },

  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#1E293B', marginTop: 18, marginBottom: 8 },
  scoreRow: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#F1F5F9' },
  scoreLabel: { fontSize: 14, fontWeight: '700', color: '#1E293B' },
  scoreDesc: { fontSize: 11, color: '#94A3B8', marginTop: 2 },
  scoreRatings: { flexDirection: 'row', marginTop: 8, gap: 10 },
  scoreSubLabel: { fontSize: 11, color: '#64748B', fontWeight: '600', marginBottom: 4 },

  catRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9', gap: 8 },
  catLabel: { fontSize: 14, fontWeight: '600', color: '#1E293B' },
  catBadge: { fontSize: 10, color: '#0891B2', backgroundColor: '#ECFEFF', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, fontWeight: '700' },
  catDesc: { fontSize: 11, color: '#94A3B8', marginTop: 2 },
});
