import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Modal, TextInput, ScrollView, Alert, FlatList,
} from 'react-native';
import { supabase } from '../lib/supabase';

type Schedule = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string;
  color: string;
  profiles: { display_name: string; avatar_url: string | null } | null;
};

type Member = {
  id: string;
  display_name: string;
};

type Props = {
  onBack: () => void;
  currentUserId: string | null;
};

const COLORS = [
  '#06C755', '#FF6B6B', '#4ECDC4', '#45B7D1',
  '#FFA500', '#9B59B6', '#E74C3C', '#3498DB',
];

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

export default function ScheduleScreen({ onBack, currentUserId }: Props) {
  const [today] = useState(new Date());
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [filterUserId, setFilterUserId] = useState<string>('all');
  const [modalVisible, setModalVisible] = useState(false);
  const [editTarget, setEditTarget] = useState<Schedule | null>(null);

  // 入力フォーム
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');
  const [color, setColor] = useState('#06C755');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchMembers();
    fetchSchedules();
  }, [currentYear, currentMonth, filterUserId]);

  const fetchMembers = async () => {
    const { data } = await supabase.from('profiles').select('id, display_name').order('display_name');
    if (data) setMembers(data as Member[]);
  };

  const fetchSchedules = useCallback(async () => {
    const from = new Date(currentYear, currentMonth, 1).toISOString();
    const to = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59).toISOString();

    let query = supabase
      .from('schedules')
      .select('id, user_id, title, description, start_at, end_at, color, profiles(display_name, avatar_url)')
      .gte('start_at', from)
      .lte('start_at', to)
      .order('start_at');

    if (filterUserId !== 'all') query = query.eq('user_id', filterUserId);

    const { data, error } = await query;
    if (error) console.log('fetchSchedules error:', error.message);
    if (data) setSchedules(data as Schedule[]);
  }, [currentYear, currentMonth, filterUserId]);

  const getSchedulesForDate = (date: Date) => {
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return schedules.filter(s => s.start_at.startsWith(dateStr));
  };

  const openAddModal = (date?: Date) => {
    setEditTarget(null);
    const base = date ?? selectedDate ?? today;
    const dateStr = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
    setTitle('');
    setDescription('');
    setStartDate(dateStr);
    setStartTime('09:00');
    setEndDate(dateStr);
    setEndTime('10:00');
    setColor('#06C755');
    setModalVisible(true);
  };

  const openEditModal = (s: Schedule) => {
    if (s.user_id !== currentUserId) {
      alert('自分の予定のみ編集できます');
      return;
    }
    setEditTarget(s);
    setTitle(s.title);
    setDescription(s.description ?? '');
    setStartDate(s.start_at.slice(0, 10));
    setStartTime(s.start_at.slice(11, 16));
    setEndDate(s.end_at.slice(0, 10));
    setEndTime(s.end_at.slice(11, 16));
    setColor(s.color);
    setModalVisible(true);
  };

  const saveSchedule = async () => {
    if (!title.trim()) { alert('タイトルを入力してください'); return; }
    if (!startDate || !startTime || !endDate || !endTime) { alert('日時を入力してください'); return; }

    const start_at = new Date(`${startDate}T${startTime}:00+09:00`).toISOString();
    const end_at = new Date(`${endDate}T${endTime}:00+09:00`).toISOString();

    if (new Date(end_at) <= new Date(start_at)) { alert('終了時刻は開始時刻より後にしてください'); return; }

    setSaving(true);
    if (editTarget) {
      const { error } = await supabase.from('schedules').update({ title: title.trim(), description: description.trim() || null, start_at, end_at, color }).eq('id', editTarget.id);
      if (error) alert(error.message);
    } else {
      const { error } = await supabase.from('schedules').insert({ user_id: currentUserId, title: title.trim(), description: description.trim() || null, start_at, end_at, color });
      if (error) alert(error.message);
    }
    setSaving(false);
    setModalVisible(false);
    fetchSchedules();
  };

  const deleteSchedule = (s: Schedule) => {
    Alert.alert('予定を削除', `「${s.title}」を削除しますか？`, [
      { text: 'キャンセル', style: 'cancel' },
      { text: '削除', style: 'destructive', onPress: async () => {
        await supabase.from('schedules').delete().eq('id', s.id);
        setModalVisible(false);
        fetchSchedules();
      }},
    ]);
  };

  const prevMonth = () => {
    if (currentMonth === 0) { setCurrentYear(y => y - 1); setCurrentMonth(11); }
    else setCurrentMonth(m => m - 1);
    setSelectedDate(null);
  };

  const nextMonth = () => {
    if (currentMonth === 11) { setCurrentYear(y => y + 1); setCurrentMonth(0); }
    else setCurrentMonth(m => m + 1);
    setSelectedDate(null);
  };

  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDay = getFirstDayOfMonth(currentYear, currentMonth);
  const cells: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  const selectedSchedules = selectedDate ? getSchedulesForDate(selectedDate) : [];
  const isToday = (day: number) => day === today.getDate() && currentMonth === today.getMonth() && currentYear === today.getFullYear();
  const isSelected = (day: number) => selectedDate?.getDate() === day && selectedDate?.getMonth() === currentMonth && selectedDate?.getFullYear() === currentYear;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.back}>← 戻る</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>📅 予定表</Text>
        <TouchableOpacity style={styles.addHeaderButton} onPress={() => openAddModal()}>
          <Text style={styles.addHeaderText}>+ 追加</Text>
        </TouchableOpacity>
      </View>

      {/* メンバーフィルター */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.memberFilter}>
        <TouchableOpacity style={[styles.memberChip, filterUserId === 'all' && styles.memberChipActive]} onPress={() => setFilterUserId('all')}>
          <Text style={[styles.memberChipText, filterUserId === 'all' && styles.memberChipTextActive]}>全員</Text>
        </TouchableOpacity>
        {members.map(m => (
          <TouchableOpacity key={m.id} style={[styles.memberChip, filterUserId === m.id && styles.memberChipActive]} onPress={() => setFilterUserId(m.id)}>
            <Text style={[styles.memberChipText, filterUserId === m.id && styles.memberChipTextActive]}>{m.display_name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* カレンダーヘッダー */}
      <View style={styles.calHeader}>
        <TouchableOpacity onPress={prevMonth} style={styles.navButton}>
          <Text style={styles.navText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.monthTitle}>{currentYear}年 {currentMonth + 1}月</Text>
        <TouchableOpacity onPress={nextMonth} style={styles.navButton}>
          <Text style={styles.navText}>›</Text>
        </TouchableOpacity>
      </View>

      {/* 曜日ヘッダー */}
      <View style={styles.weekRow}>
        {WEEKDAYS.map((d, i) => (
          <Text key={d} style={[styles.weekDay, i === 0 && styles.sun, i === 6 && styles.sat]}>{d}</Text>
        ))}
      </View>

      {/* カレンダーグリッド */}
      <View style={styles.calGrid}>
        {cells.map((day, idx) => {
          if (!day) return <View key={`empty-${idx}`} style={styles.dayCell} />;
          const date = new Date(currentYear, currentMonth, day);
          const daySchedules = getSchedulesForDate(date);
          const isSun = idx % 7 === 0;
          const isSat = idx % 7 === 6;
          return (
            <TouchableOpacity
              key={day}
              style={[styles.dayCell, isSelected(day) && styles.dayCellSelected]}
              onPress={() => setSelectedDate(date)}
            >
              <View style={isToday(day) ? styles.todayCircle : null}>
                <Text style={[
                  styles.dayText,
                  isSun && styles.sunText,
                  isSat && styles.satText,
                  isToday(day) && styles.todayText,
                ]}>{day}</Text>
              </View>
              <View style={styles.dotRow}>
                {daySchedules.slice(0, 3).map((s, i) => (
                  <View key={i} style={[styles.dot, { backgroundColor: s.color }]} />
                ))}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* 選択日の予定一覧 */}
      {selectedDate && (
        <View style={styles.dayDetail}>
          <View style={styles.dayDetailHeader}>
            <Text style={styles.dayDetailTitle}>
              {currentMonth + 1}/{selectedDate.getDate()}（{WEEKDAYS[selectedDate.getDay()]}）の予定
            </Text>
            <TouchableOpacity style={styles.addDayButton} onPress={() => openAddModal(selectedDate)}>
              <Text style={styles.addDayText}>+ 追加</Text>
            </TouchableOpacity>
          </View>
          {selectedSchedules.length === 0 ? (
            <Text style={styles.emptyText}>予定はありません</Text>
          ) : (
            <FlatList
              data={selectedSchedules}
              keyExtractor={item => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.scheduleItem} onPress={() => openEditModal(item)}>
                  <View style={[styles.colorBar, { backgroundColor: item.color }]} />
                  <View style={styles.scheduleInfo}>
                    <Text style={styles.scheduleTitle}>{item.title}</Text>
                    <Text style={styles.scheduleMeta}>
                      {item.profiles?.display_name} ・ {item.start_at.slice(11, 16)} 〜 {item.end_at.slice(11, 16)}
                    </Text>
                    {item.description ? <Text style={styles.scheduleDesc} numberOfLines={1}>{item.description}</Text> : null}
                  </View>
                  {item.user_id === currentUserId && <Text style={styles.editHint}>編集 ›</Text>}
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      )}

      {/* 予定追加・編集モーダル */}
      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <ScrollView>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{editTarget ? '予定を編集' : '予定を追加'}</Text>
                <TouchableOpacity onPress={() => setModalVisible(false)}>
                  <Text style={styles.modalClose}>✕</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.fieldLabel}>タイトル *</Text>
              <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="例: 打ち合わせ" />

              <Text style={styles.fieldLabel}>開始</Text>
              <View style={styles.dateTimeRow}>
                <TextInput style={[styles.input, styles.dateInput]} value={startDate} onChangeText={setStartDate} placeholder="2026-04-01" keyboardType="numbers-and-punctuation" />
                <TextInput style={[styles.input, styles.timeInput]} value={startTime} onChangeText={setStartTime} placeholder="09:00" keyboardType="numbers-and-punctuation" />
              </View>

              <Text style={styles.fieldLabel}>終了</Text>
              <View style={styles.dateTimeRow}>
                <TextInput style={[styles.input, styles.dateInput]} value={endDate} onChangeText={setEndDate} placeholder="2026-04-01" keyboardType="numbers-and-punctuation" />
                <TextInput style={[styles.input, styles.timeInput]} value={endTime} onChangeText={setEndTime} placeholder="10:00" keyboardType="numbers-and-punctuation" />
              </View>

              <Text style={styles.fieldLabel}>メモ</Text>
              <TextInput style={[styles.input, styles.textArea]} value={description} onChangeText={setDescription} placeholder="詳細・場所など" multiline />

              <Text style={styles.fieldLabel}>カラー</Text>
              <View style={styles.colorRow}>
                {COLORS.map(c => (
                  <TouchableOpacity key={c} style={[styles.colorCircle, { backgroundColor: c }, color === c && styles.colorCircleSelected]} onPress={() => setColor(c)} />
                ))}
              </View>

              <View style={styles.modalButtons}>
                {editTarget && editTarget.user_id === currentUserId && (
                  <TouchableOpacity style={styles.deleteButton} onPress={() => deleteSchedule(editTarget)}>
                    <Text style={styles.deleteButtonText}>🗑 削除</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={[styles.saveButton, saving && { opacity: 0.6 }]} onPress={saveSchedule} disabled={saving}>
                  <Text style={styles.saveButtonText}>{saving ? '保存中...' : '保存'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: 48, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee' },
  back: { color: '#06C755', fontSize: 16, width: 60 },
  headerTitle: { fontSize: 16, fontWeight: 'bold', color: '#333' },
  addHeaderButton: { backgroundColor: '#06C755', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 5 },
  addHeaderText: { color: '#fff', fontSize: 13, fontWeight: 'bold' },
  memberFilter: { backgroundColor: '#f8f8f8', paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#eee', maxHeight: 50 },
  memberChip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 16, backgroundColor: '#f0f0f0', marginRight: 8 },
  memberChipActive: { backgroundColor: '#06C755' },
  memberChipText: { fontSize: 13, color: '#666' },
  memberChipTextActive: { color: '#fff', fontWeight: 'bold' },
  calHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
  navButton: { padding: 8 },
  navText: { fontSize: 24, color: '#06C755', fontWeight: 'bold' },
  monthTitle: { fontSize: 17, fontWeight: 'bold', color: '#333' },
  weekRow: { flexDirection: 'row', paddingHorizontal: 4, marginBottom: 4 },
  weekDay: { flex: 1, textAlign: 'center', fontSize: 12, color: '#666', fontWeight: '500' },
  sun: { color: '#E24B4A' },
  sat: { color: '#3498DB' },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 4 },
  dayCell: { width: '14.28%', minHeight: 52, alignItems: 'center', paddingVertical: 4, borderRadius: 6 },
  dayCellSelected: { backgroundColor: '#f0fff4' },
  todayCircle: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#06C755', alignItems: 'center', justifyContent: 'center' },
  dayText: { fontSize: 14, color: '#333', textAlign: 'center', lineHeight: 26 },
  sunText: { color: '#E24B4A' },
  satText: { color: '#3498DB' },
  todayText: { color: '#fff', fontWeight: 'bold' },
  dotRow: { flexDirection: 'row', gap: 2, marginTop: 2, flexWrap: 'wrap', justifyContent: 'center' },
  dot: { width: 5, height: 5, borderRadius: 3 },
  dayDetail: { flex: 1, borderTopWidth: 1, borderTopColor: '#eee', backgroundColor: '#f8f8f8' },
  dayDetailHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, paddingHorizontal: 16 },
  dayDetailTitle: { fontSize: 14, fontWeight: '600', color: '#333' },
  addDayButton: { backgroundColor: '#06C755', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  addDayText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  emptyText: { textAlign: 'center', color: '#999', fontSize: 14, paddingVertical: 20 },
  scheduleItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', marginHorizontal: 12, marginBottom: 8, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: '#eee' },
  colorBar: { width: 5, alignSelf: 'stretch' },
  scheduleInfo: { flex: 1, padding: 10 },
  scheduleTitle: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 2 },
  scheduleMeta: { fontSize: 12, color: '#999' },
  scheduleDesc: { fontSize: 12, color: '#666', marginTop: 2 },
  editHint: { fontSize: 12, color: '#06C755', paddingRight: 12 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 48 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#333' },
  modalClose: { fontSize: 18, color: '#999' },
  fieldLabel: { fontSize: 13, color: '#666', fontWeight: '600', marginBottom: 6, marginTop: 12 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 12, fontSize: 15, backgroundColor: '#fafafa' },
  dateTimeRow: { flexDirection: 'row', gap: 8 },
  dateInput: { flex: 2 },
  timeInput: { flex: 1 },
  textArea: { height: 80, textAlignVertical: 'top' },
  colorRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', marginTop: 4 },
  colorCircle: { width: 32, height: 32, borderRadius: 16 },
  colorCircleSelected: { borderWidth: 3, borderColor: '#333' },
  modalButtons: { flexDirection: 'row', gap: 10, marginTop: 24 },
  deleteButton: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#fff0f0', alignItems: 'center' },
  deleteButtonText: { fontSize: 14, color: '#E24B4A', fontWeight: '500' },
  saveButton: { flex: 2, padding: 14, borderRadius: 10, backgroundColor: '#06C755', alignItems: 'center' },
  saveButtonText: { fontSize: 15, color: '#fff', fontWeight: 'bold' },
});