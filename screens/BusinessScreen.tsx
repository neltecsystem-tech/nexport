import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Modal, TextInput, Alert, ScrollView, ActivityIndicator, Linking,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { supabase } from '../lib/supabase';

// ─── Types ────────────────────────────────────────────────────
type SubScreen = 'portal' | 'bulletin' | 'tasks' | 'attendance' | 'attend_admin' | 'attend_settings' | 'schedule' | 'reports' | 'gantt' | 'cards' | 'extlinks' | 'mail' | 'mypage';

type Bookmark = {
  id: string;
  user_id: string;
  title: string;
  url: string;
  icon: string;
  sort_order: number;
};

type BulletinPost = {
  id: string;
  author_id: string;
  title: string;
  content: string;
  category: string;
  is_pinned: boolean;
  created_at: string;
  profiles: { display_name: string } | null;
  comment_count?: number;
};

type BulletinComment = {
  id: string;
  content: string;
  created_at: string;
  profiles: { display_name: string } | null;
};

type Task = {
  id: string;
  created_by: string;
  assigned_to: string | null;
  title: string;
  description: string | null;
  status: '未着手' | '進行中' | '完了';
  priority: '高' | '中' | '低';
  due_date: string | null;
  created_at: string;
  assignee?: { display_name: string } | null;
};

type Attendance = {
  id: string;
  work_date: string;
  clock_in: string | null;
  clock_out: string | null;
  clock_in2: string | null;
  clock_out2: string | null;
  break_start: string | null;
  break_end: string | null;
  break_start2: string | null;
  break_end2: string | null;
  break_minutes: number;
  note: string | null;
};

type Report = {
  id: string;
  author_id: string;
  title: string;
  report_date: string;
  category: string;
  participants: string | null;
  content: string;
  external_participants: string | null;
  status: '下書き' | '提出済' | '承認済' | '差戻し';
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  comment: string | null;
  created_at: string;
  updated_at: string;
  profiles?: { display_name: string } | null;
  approver?: { display_name: string } | null;
};

type GanttProject = {
  id: string;
  name: string;
  color: string;
  sort_order: number;
};

type GanttTask = {
  id: string;
  project_id: string;
  title: string;
  assigned_to: string | null;
  start_date: string;
  end_date: string;
  progress: number;
  dependency_id: string | null;
  sort_order: number;
};

type BusinessCard = {
  id: string;
  registered_by: string;
  company_name: string;
  department: string | null;
  person_name: string;
  title: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  address: string | null;
  website: string | null;
  image_url: string | null;
  notes: string | null;
  met_date: string | null;
  met_location: string | null;
  tags: string | null;
  created_at: string;
  registrant?: string;
};

type InternalMail = {
  id: string;
  sender_id: string;
  subject: string;
  body: string;
  is_draft: boolean;
  sent_at: string | null;
  created_at: string;
  sender_name?: string;
  recipients?: { user_id: string; recipient_type: string; display_name: string }[];
};

type ExternalLink = {
  id: string;
  title: string;
  url: string;
  icon: string;
  description: string | null;
  color: string;
  sort_order: number;
};

type WorkPattern = {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  standard_hours_min: number;
  break_minutes: number;
  overtime_threshold_min: number;
  is_default: boolean;
};

type UserWorkPattern = {
  id: string;
  user_id: string;
  work_pattern_id: string;
};

type AdminAttendRecord = Attendance & {
  user_id: string;
  profiles?: { display_name: string } | null;
};

type Member = { id: string; display_name: string };

type ScheduleEvent = {
  id: string;
  user_id: string;
  title: string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  event_type: '会議' | '出張' | '休み' | '有給' | 'その他';
  all_day: boolean;
  memo: string | null;
};

type Props = {
  onBack: () => void;
  currentUserId: string | null;
  isAdmin: boolean;
};

// ─── Helpers ─────────────────────────────────────────────────
const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  'お知らせ':  { bg: '#DBEAFE', text: '#1D4ED8' },
  '業務連絡':  { bg: '#D1FAE5', text: '#065F46' },
  'その他':    { bg: '#F3F4F6', text: '#4B5563' },
};
const PRIORITY_COLOR: Record<string, string> = { '高': '#EF4444', '中': '#F59E0B', '低': '#9CA3AF' };
const STATUS_COLOR:   Record<string, string> = { '未着手': '#9CA3AF', '進行中': '#3B82F6', '完了': '#10B981' };

function todayStr() { return new Date().toISOString().slice(0, 10); }
// 出勤できる条件: まだ1回も打っていない OR 1回目退勤済みで2回目未打刻
function canClockIn(r: Attendance | null) {
  if (!r) return true;
  return !r.clock_in || (!!r.clock_out && !r.clock_in2);
}
// 退勤できる条件: 1回目出勤済みで未退勤 OR 2回目出勤済みで未退勤
function canClockOut(r: Attendance | null) {
  if (!r) return false;
  return (!!r.clock_in && !r.clock_out) || (!!r.clock_in2 && !r.clock_out2);
}
// 中抜け開始できる条件: 出勤中（退勤前）かつ中抜け中でない
function canBreakStart(r: Attendance | null) {
  if (!r) return false;
  const working = (!!r.clock_in && !r.clock_out) || (!!r.clock_in2 && !r.clock_out2);
  if (!working) return false;
  // 1回目中抜け中（開始済み＆未終了）なら不可
  if (r.break_start && !r.break_end) return false;
  // 2回目中抜け中なら不可
  if (r.break_start2 && !r.break_end2) return false;
  // 2回とも終了済みなら不可（3回目はなし）
  if (r.break_start && r.break_end && r.break_start2 && r.break_end2) return false;
  return true;
}
// 中抜け終了できる条件: 中抜け中
function canBreakEnd(r: Attendance | null) {
  if (!r) return false;
  return (!!r.break_start && !r.break_end) || (!!r.break_start2 && !r.break_end2);
}
function totalBreakMin(r: Attendance): number {
  return pairMin(r.break_start, r.break_end) + pairMin(r.break_start2 ?? null, r.break_end2 ?? null);
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function pairMin(ci: string | null, co: string | null): number {
  if (!ci || !co) return 0;
  const [ih, im] = ci.split(':').map(Number);
  const [oh, om] = co.split(':').map(Number);
  return Math.max(0, (oh * 60 + om) - (ih * 60 + im));
}
function calcWorkRecord(r: Pick<Attendance, 'clock_in'|'clock_out'|'clock_in2'|'clock_out2'>): string | null {
  const total = pairMin(r.clock_in, r.clock_out) + pairMin(r.clock_in2 ?? null, r.clock_out2 ?? null);
  return total > 0 ? `${Math.floor(total / 60)}h${total % 60 > 0 ? `${total % 60}m` : ''}` : null;
}

// ─── Icon grid item ──────────────────────────────────────────
const NAV_ITEMS: { key: SubScreen; icon: string; label: string; color: string }[] = [
  { key: 'bulletin',   icon: '📋', label: '掲示板',    color: '#3B82F6' },
  { key: 'tasks',      icon: '✅', label: 'ToDoリスト', color: '#10B981' },
  { key: 'attendance', icon: '🕐', label: '勤怠管理',  color: '#F59E0B' },
  { key: 'schedule',   icon: '📅', label: '予定表',    color: '#8B5CF6' },
  { key: 'reports',    icon: '📝', label: '報告書',    color: '#EC4899' },
  { key: 'gantt',      icon: '📊', label: 'ガント',    color: '#0EA5E9' },
  { key: 'cards',      icon: '🪪', label: '名刺共有',  color: '#14B8A6' },
  { key: 'extlinks',   icon: '🔗', label: '他機能',    color: '#6366F1' },
  { key: 'mypage',     icon: '⭐', label: 'マイページ', color: '#F59E0B' },
];

const EVENT_TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  '会議': { bg: '#DBEAFE', text: '#1D4ED8', border: '#93C5FD' },
  '出張': { bg: '#D1FAE5', text: '#065F46', border: '#6EE7B7' },
  '休み': { bg: '#FEE2E2', text: '#DC2626', border: '#FCA5A5' },
  '有給': { bg: '#FED7AA', text: '#C2410C', border: '#FDBA74' },
  'その他': { bg: '#F3F4F6', text: '#4B5563', border: '#D1D5DB' },
};
const EVENT_TYPES = ['会議', '出張', '休み', '有給', 'その他'] as const;
const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  d.setHours(0, 0, 0, 0);
  return d;
}
function dateStr(d: Date): string { return d.toISOString().slice(0, 10); }
function isToday(d: Date): boolean { return dateStr(d) === dateStr(new Date()); }

// ═══════════════════════════════════════════════════════════════
// 権限定義（AdminScreenと同じキー）
const BIZ_PERM_DEFAULTS: Record<string, boolean> = {
  attend_admin: true, attend_settings: false,
  bulletin_admin: true, task_admin: true, schedule_admin: true,
};

export default function BusinessScreen({ onBack, currentUserId, isAdmin }: Props) {
  const [screen, setScreen] = useState<SubScreen>('portal');
  const [myPerms, setMyPerms] = useState<string[]>([]);

  // ── Permissions fetch ──────────────────────────────────────
  useEffect(() => {
    if (!currentUserId || !isAdmin) return;
    (async () => {
      const { data } = await supabase.from('profiles').select('role, custom_permissions').eq('id', currentUserId).single();
      if (!data) return;
      if (data.role === 'super_admin') {
        setMyPerms(Object.keys(BIZ_PERM_DEFAULTS));
      } else if (data.custom_permissions && data.custom_permissions.length > 0) {
        setMyPerms(data.custom_permissions);
      } else {
        setMyPerms(Object.entries(BIZ_PERM_DEFAULTS).filter(([, v]) => v).map(([k]) => k));
      }
    })();
  }, [currentUserId, isAdmin]);

  const hasPerm = (key: string) => !isAdmin ? false : myPerms.includes(key);

  // ── Portal data ───────────────────────────────────────────
  const [pinnedPost,   setPinnedPost]   = useState<BulletinPost | null>(null);
  const [latestPosts,  setLatestPosts]  = useState<BulletinPost[]>([]);
  const [myTasks,      setMyTasks]      = useState<Task[]>([]);
  const [todayRecord,  setTodayRecord]  = useState<Attendance | null>(null);
  const [portalLoading, setPortalLoading] = useState(true);
  const [myName, setMyName] = useState('');

  // ── Bulletin ──────────────────────────────────────────────
  const [posts,         setPosts]         = useState<BulletinPost[]>([]);
  const [selectedPost,  setSelectedPost]  = useState<BulletinPost | null>(null);
  const [comments,      setComments]      = useState<BulletinComment[]>([]);
  const [newComment,    setNewComment]    = useState('');
  const [postModal,     setPostModal]     = useState(false);
  const [postTitle,     setPostTitle]     = useState('');
  const [postContent,   setPostContent]   = useState('');
  const [postCategory,  setPostCategory]  = useState('お知らせ');
  const [postPinned,    setPostPinned]    = useState(false);
  const [loadingPosts,  setLoadingPosts]  = useState(false);

  // ── Tasks ─────────────────────────────────────────────────
  const [tasks,       setTasks]       = useState<Task[]>([]);
  const [taskFilter,  setTaskFilter]  = useState<'all' | '未着手' | '進行中' | '完了'>('all');
  const [taskModal,   setTaskModal]   = useState(false);
  const [taskTitle,   setTaskTitle]   = useState('');
  const [taskDesc,    setTaskDesc]    = useState('');
  const [taskPriority,setTaskPriority]= useState<'高'|'中'|'低'>('中');
  const [taskDue,     setTaskDue]     = useState('');
  const [taskAssignee,setTaskAssignee]= useState<string|null>(null);
  const [members,     setMembers]     = useState<Member[]>([]);
  const [loadingTasks,setLoadingTasks]= useState(false);

  // ── Attendance ────────────────────────────────────────────
  const [monthRecords, setMonthRecords] = useState<Attendance[]>([]);
  const [attendMonth,  setAttendMonth]  = useState(() => new Date().toISOString().slice(0, 7));
  const [attendNote,   setAttendNote]   = useState('');
  const [saving,       setSaving]       = useState(false);

  // ── Attendance Admin ─────────────────────────────────────
  const [adminAttendMonth, setAdminAttendMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [adminAttendUser,  setAdminAttendUser]  = useState<string | 'all'>('all');
  const [adminRecords,     setAdminRecords]     = useState<AdminAttendRecord[]>([]);
  const [adminMembers,     setAdminMembers]     = useState<Member[]>([]);
  const [loadingAdmin,     setLoadingAdmin]     = useState(false);
  const [editAttendModal,  setEditAttendModal]  = useState(false);
  const [editAttendRec,    setEditAttendRec]    = useState<AdminAttendRecord | null>(null);
  const [eaClockIn, setEaClockIn] = useState('');
  const [eaClockOut, setEaClockOut] = useState('');
  const [eaClockIn2, setEaClockIn2] = useState('');
  const [eaClockOut2, setEaClockOut2] = useState('');
  const [eaBreakStart, setEaBreakStart] = useState('');
  const [eaBreakEnd, setEaBreakEnd] = useState('');
  const [eaBreakStart2, setEaBreakStart2] = useState('');
  const [eaBreakEnd2, setEaBreakEnd2] = useState('');
  const [eaNote, setEaNote] = useState('');
  const [savingAdmin, setSavingAdmin] = useState(false);
  const [eaReason, setEaReason] = useState('');
  const [editLogs, setEditLogs] = useState<any[]>([]);
  const [showLogs, setShowLogs] = useState(false);

  // ── Attendance Settings ──────────────────────────────────
  const [workPatterns, setWorkPatterns] = useState<WorkPattern[]>([]);
  const [userWpAssigns, setUserWpAssigns] = useState<UserWorkPattern[]>([]);
  const [wpMembers, setWpMembers] = useState<Member[]>([]);
  const [wpModal, setWpModal] = useState(false);
  const [editingWp, setEditingWp] = useState<WorkPattern | null>(null);
  const [wpName, setWpName] = useState('');
  const [wpStartTime, setWpStartTime] = useState('09:00');
  const [wpEndTime, setWpEndTime] = useState('18:00');
  const [wpBreak, setWpBreak] = useState('60');
  const [savingWp, setSavingWp] = useState(false);

  // ── Reports ───────────────────────────────────────────────
  const [reports,        setReports]        = useState<Report[]>([]);
  const [reportFilter,   setReportFilter]   = useState<'mine' | 'draft' | 'all'>('mine');
  const [reportModal,    setReportModal]    = useState(false);
  const [editingReport,  setEditingReport]  = useState<Report | null>(null);
  const [viewReport,     setViewReport]     = useState<Report | null>(null);
  const [rpTitle,        setRpTitle]        = useState('');
  const [rpDate,         setRpDate]         = useState('');
  const [rpCategory,     setRpCategory]     = useState('会議議事録');
  const [rpParticipants, setRpParticipants] = useState('');
  const [rpExtParticipants, setRpExtParticipants] = useState('');
  const [rpContent,      setRpContent]      = useState('');
  const [rpStatus,       setRpStatus]       = useState<Report['status']>('下書き');
  const [rpComment,      setRpComment]      = useState('');
  const [savingReport,   setSavingReport]   = useState(false);
  const [loadingReports, setLoadingReports] = useState(false);

  // ── Mail ──────────────────────────────────────────────────
  const [mails, setMails] = useState<InternalMail[]>([]);
  const [mailTab, setMailTab] = useState<'inbox' | 'sent' | 'draft'>('inbox');
  const [mailModal, setMailModal] = useState(false);
  const [viewMail, setViewMail] = useState<InternalMail | null>(null);
  const [mlSubject, setMlSubject] = useState('');
  const [mlBody, setMlBody] = useState('');
  const [mlTo, setMlTo] = useState<string[]>([]);
  const [mlCc, setMlCc] = useState<string[]>([]);
  const [mailMembers, setMailMembers] = useState<Member[]>([]);
  const [savingMail, setSavingMail] = useState(false);
  const [loadingMail, setLoadingMail] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // ── My Page (Bookmarks) ──────────────────────────────────
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [bmModal, setBmModal] = useState(false);
  const [editBm, setEditBm] = useState<Bookmark | null>(null);
  const [bmTitle, setBmTitle] = useState('');
  const [bmUrl, setBmUrl] = useState('');
  const [bmIcon, setBmIcon] = useState('🔗');
  const [loadingBm, setLoadingBm] = useState(false);

  // ── External Links ────────────────────────────────────────
  const [extLinks, setExtLinks] = useState<ExternalLink[]>([]);
  const [loadingExt, setLoadingExt] = useState(false);
  const [extModal, setExtModal] = useState(false);
  const [editExt, setEditExt] = useState<ExternalLink | null>(null);
  const [elTitle, setElTitle] = useState('');
  const [elUrl, setElUrl] = useState('');
  const [elIcon, setElIcon] = useState('🔗');
  const [elDesc, setElDesc] = useState('');
  const [elColor, setElColor] = useState('#3B82F6');
  const [savingExt, setSavingExt] = useState(false);

  // ── Business Cards ────────────────────────────────────────
  const [bcards, setBcards] = useState<BusinessCard[]>([]);
  const [bcSearch, setBcSearch] = useState('');
  const [bcModal, setBcModal] = useState(false);
  const [bcView, setBcView] = useState<BusinessCard | null>(null);
  const [editBc, setEditBc] = useState<BusinessCard | null>(null);
  const [bcCompany, setBcCompany] = useState('');
  const [bcDept, setBcDept] = useState('');
  const [bcPerson, setBcPerson] = useState('');
  const [bcTitle, setBcTitle] = useState('');
  const [bcPhone, setBcPhone] = useState('');
  const [bcMobile, setBcMobile] = useState('');
  const [bcEmail, setBcEmail] = useState('');
  const [bcAddress, setBcAddress] = useState('');
  const [bcWebsite, setBcWebsite] = useState('');
  const [bcNotes, setBcNotes] = useState('');
  const [bcMetDate, setBcMetDate] = useState('');
  const [bcMetLocation, setBcMetLocation] = useState('');
  const [bcTags, setBcTags] = useState('');
  const [savingBc, setSavingBc] = useState(false);
  const [loadingBc, setLoadingBc] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);

  // ── Gantt ─────────────────────────────────────────────────
  const [ganttProjects,   setGanttProjects]   = useState<GanttProject[]>([]);
  const [ganttTasks,      setGanttTasks]      = useState<GanttTask[]>([]);
  const [ganttMembers,    setGanttMembers]    = useState<Member[]>([]);
  const [ganttStart,      setGanttStart]      = useState<Date>(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d; });
  const [ganttDays,       setGanttDays]       = useState(42);
  const [loadingGantt,    setLoadingGantt]    = useState(false);
  const [ganttProjModal,  setGanttProjModal]  = useState(false);
  const [ganttTaskModal,  setGanttTaskModal]  = useState(false);
  const [editGProj,       setEditGProj]       = useState<GanttProject | null>(null);
  const [editGTask,       setEditGTask]       = useState<GanttTask | null>(null);
  const [gpName, setGpName] = useState('');
  const [gpColor, setGpColor] = useState('#3B82F6');
  const [gtTitle, setGtTitle] = useState('');
  const [gtProjId, setGtProjId] = useState('');
  const [gtAssignee, setGtAssignee] = useState<string | null>(null);
  const [gtStart, setGtStart] = useState('');
  const [gtEnd, setGtEnd] = useState('');
  const [gtProgress, setGtProgress] = useState('0');
  const [savingGantt, setSavingGantt] = useState(false);

  // ── Schedule ──────────────────────────────────────────────
  const [schedEvents,     setSchedEvents]     = useState<ScheduleEvent[]>([]);
  const [schedMembers,    setSchedMembers]    = useState<Member[]>([]);
  const [schedView,       setSchedView]       = useState<'day' | 'week' | 'month' | 'year'>('week');
  const [schedNavDate,    setSchedNavDate]    = useState<Date>(() => new Date());
  const [loadingSched,    setLoadingSched]    = useState(false);
  const [schedFilterUser, setSchedFilterUser] = useState<string | 'all'>('all');
  const [showMemberPicker, setShowMemberPicker] = useState(false);
  const [eventModal,      setEventModal]      = useState(false);
  const [editingEvent,    setEditingEvent]    = useState<ScheduleEvent | null>(null);
  const [evTitle,         setEvTitle]         = useState('');
  const [evDate,          setEvDate]          = useState('');
  const [evType,          setEvType]          = useState<ScheduleEvent['event_type']>('その他');
  const [evStart,         setEvStart]         = useState('');
  const [evEnd,           setEvEnd]           = useState('');
  const [evMemo,          setEvMemo]          = useState('');
  const [evUserIds,       setEvUserIds]       = useState<string[]>([]);
  const [savingEvent,     setSavingEvent]     = useState(false);

  // ─── Portal load ─────────────────────────────────────────
  const loadPortal = useCallback(async () => {
    setPortalLoading(true);
    const [profileRes, postsRes, tasksRes, attendRes] = await Promise.all([
      supabase.from('profiles').select('display_name').eq('id', currentUserId).single(),
      supabase.from('bulletin_posts').select('*, profiles(display_name)').order('is_pinned', { ascending: false }).order('created_at', { ascending: false }).limit(6),
      supabase.from('tasks').select('*, assignee:assigned_to(display_name)').neq('status', '完了').or(`assigned_to.eq.${currentUserId},created_by.eq.${currentUserId}`).order('due_date', { ascending: true, nullsFirst: false }).limit(5),
      supabase.from('attendance_records').select('*').eq('user_id', currentUserId).eq('work_date', todayStr()).maybeSingle(),
    ]);
    if (profileRes.data) setMyName(profileRes.data.display_name);
    if (postsRes.data) {
      const all = postsRes.data as BulletinPost[];
      setPinnedPost(all.find(p => p.is_pinned) ?? null);
      setLatestPosts(all.filter(p => !p.is_pinned).slice(0, 4));
    }
    if (tasksRes.data) setMyTasks(tasksRes.data as unknown as Task[]);
    setTodayRecord(attendRes.data as Attendance | null);
    if (attendRes.data?.note) setAttendNote(attendRes.data.note);
    setPortalLoading(false);
  }, [currentUserId]);

  useEffect(() => { if (screen === 'portal') loadPortal(); }, [screen]);

  // ─── Bulletin ────────────────────────────────────────────
  const fetchPosts = async () => {
    setLoadingPosts(true);
    const { data } = await supabase
      .from('bulletin_posts')
      .select('*, profiles(display_name)')
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false });
    if (data) {
      const withCounts = await Promise.all((data as BulletinPost[]).map(async p => {
        const { count } = await supabase.from('bulletin_comments').select('id', { count: 'exact', head: true }).eq('post_id', p.id);
        return { ...p, comment_count: count ?? 0 };
      }));
      setPosts(withCounts);
    }
    setLoadingPosts(false);
  };

  useEffect(() => { if (screen === 'bulletin') fetchPosts(); }, [screen]);

  const openPost = async (post: BulletinPost) => {
    setSelectedPost(post);
    const { data } = await supabase.from('bulletin_comments').select('*, profiles(display_name)').eq('post_id', post.id).order('created_at');
    if (data) setComments(data as BulletinComment[]);
  };

  const submitPost = async () => {
    if (!postTitle.trim() || !postContent.trim()) { alert('タイトルと内容を入力してください'); return; }
    setSaving(true);
    await supabase.from('bulletin_posts').insert({ author_id: currentUserId, title: postTitle.trim(), content: postContent.trim(), category: postCategory, is_pinned: isAdmin && postPinned });
    setPostModal(false); setPostTitle(''); setPostContent(''); setPostCategory('お知らせ'); setPostPinned(false);
    await fetchPosts();
    setSaving(false);
  };

  const submitComment = async () => {
    if (!newComment.trim() || !selectedPost) return;
    await supabase.from('bulletin_comments').insert({ post_id: selectedPost.id, author_id: currentUserId, content: newComment.trim() });
    setNewComment('');
    const { data } = await supabase.from('bulletin_comments').select('*, profiles(display_name)').eq('post_id', selectedPost.id).order('created_at');
    if (data) setComments(data as BulletinComment[]);
    setPosts(prev => prev.map(p => p.id === selectedPost.id ? { ...p, comment_count: (p.comment_count ?? 0) + 1 } : p));
  };

  const deletePost = async (post: BulletinPost) => {
    if (!window.confirm(`「${post.title}」を削除しますか？`)) return;
    await supabase.from('bulletin_posts').delete().eq('id', post.id);
    setSelectedPost(null); await fetchPosts();
  };

  // ─── Tasks ───────────────────────────────────────────────
  useEffect(() => {
    if (screen === 'tasks') { fetchTasks(); fetchMembers(); }
  }, [screen]);

  const fetchMembers = async () => {
    const { data } = await supabase.from('profiles').select('id, display_name').order('display_name');
    if (data) setMembers(data as Member[]);
  };

  const fetchTasks = async () => {
    setLoadingTasks(true);
    const { data } = await supabase.from('tasks').select('*, assignee:assigned_to(display_name)').order('due_date', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false });
    if (data) setTasks(data as unknown as Task[]);
    setLoadingTasks(false);
  };

  const submitTask = async () => {
    if (!taskTitle.trim()) { alert('タイトルを入力してください'); return; }
    setSaving(true);
    await supabase.from('tasks').insert({ created_by: currentUserId, assigned_to: taskAssignee, title: taskTitle.trim(), description: taskDesc.trim() || null, priority: taskPriority, due_date: taskDue || null, status: '未着手' });
    setTaskModal(false); setTaskTitle(''); setTaskDesc(''); setTaskPriority('中'); setTaskDue(''); setTaskAssignee(null);
    await fetchTasks();
    setSaving(false);
  };

  const cycleStatus = async (task: Task) => {
    const next: Record<string, Task['status']> = { '未着手': '進行中', '進行中': '完了', '完了': '未着手' };
    const s = next[task.status];
    await supabase.from('tasks').update({ status: s }).eq('id', task.id);
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: s } : t));
  };

  const deleteTask = async (task: Task) => {
    if (!window.confirm(`「${task.title}」を削除しますか？`)) return;
    await supabase.from('tasks').delete().eq('id', task.id);
    setTasks(prev => prev.filter(t => t.id !== task.id));
  };

  // ─── Attendance ──────────────────────────────────────────
  useEffect(() => {
    if (screen === 'attendance') { fetchTodayRecord(); fetchMonthRecords(); }
  }, [screen]);

  useEffect(() => {
    if (screen === 'attendance') fetchMonthRecords();
  }, [attendMonth]);

  const fetchTodayRecord = async () => {
    const { data } = await supabase.from('attendance_records').select('*').eq('user_id', currentUserId).eq('work_date', todayStr()).maybeSingle();
    setTodayRecord(data as Attendance | null);
    if (data?.note) setAttendNote(data.note);
  };

  const fetchMonthRecords = async () => {
    const [y, m] = attendMonth.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    const { data } = await supabase.from('attendance_records').select('*').eq('user_id', currentUserId).gte('work_date', `${attendMonth}-01`).lte('work_date', `${attendMonth}-${String(last).padStart(2, '0')}`).order('work_date');
    if (data) setMonthRecords(data as Attendance[]);
  };

  const clockIn = async () => {
    const t = new Date(); const ts = `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`;
    setSaving(true);
    if (!todayRecord) {
      // 初回出勤
      const { data } = await supabase.from('attendance_records').insert({ user_id: currentUserId, work_date: todayStr(), clock_in: ts }).select().single();
      if (data) setTodayRecord(data as Attendance);
    } else if (todayRecord.clock_in && todayRecord.clock_out && !todayRecord.clock_in2) {
      // 2回目出勤（午後など）
      const { data } = await supabase.from('attendance_records').update({ clock_in2: ts }).eq('id', todayRecord.id).select().single();
      if (data) setTodayRecord(data as Attendance);
    }
    await fetchMonthRecords(); setSaving(false);
  };

  const clockOut = async () => {
    if (!todayRecord) return;
    const t = new Date(); const ts = `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`;
    setSaving(true);
    if (todayRecord.clock_in && !todayRecord.clock_out) {
      // 1回目退勤
      const { data } = await supabase.from('attendance_records').update({ clock_out: ts, note: attendNote || null }).eq('id', todayRecord.id).select().single();
      if (data) setTodayRecord(data as Attendance);
    } else if (todayRecord.clock_in2 && !todayRecord.clock_out2) {
      // 2回目退勤
      const { data } = await supabase.from('attendance_records').update({ clock_out2: ts, note: attendNote || null }).eq('id', todayRecord.id).select().single();
      if (data) setTodayRecord(data as Attendance);
    }
    await fetchMonthRecords(); setSaving(false);
  };

  const breakStart = async () => {
    if (!todayRecord || !canBreakStart(todayRecord)) return;
    const t = new Date(); const ts = `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`;
    setSaving(true);
    if (!todayRecord.break_start) {
      const { data } = await supabase.from('attendance_records').update({ break_start: ts }).eq('id', todayRecord.id).select().single();
      if (data) setTodayRecord(data as Attendance);
    } else if (todayRecord.break_end && !todayRecord.break_start2) {
      const { data } = await supabase.from('attendance_records').update({ break_start2: ts }).eq('id', todayRecord.id).select().single();
      if (data) setTodayRecord(data as Attendance);
    }
    await fetchMonthRecords(); setSaving(false);
  };

  const breakEnd = async () => {
    if (!todayRecord || !canBreakEnd(todayRecord)) return;
    const t = new Date(); const ts = `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`;
    setSaving(true);
    if (todayRecord.break_start && !todayRecord.break_end) {
      const { data } = await supabase.from('attendance_records').update({ break_end: ts }).eq('id', todayRecord.id).select().single();
      if (data) setTodayRecord(data as Attendance);
    } else if (todayRecord.break_start2 && !todayRecord.break_end2) {
      const { data } = await supabase.from('attendance_records').update({ break_end2: ts }).eq('id', todayRecord.id).select().single();
      if (data) setTodayRecord(data as Attendance);
    }
    await fetchMonthRecords(); setSaving(false);
  };

  const totalWorkMin = monthRecords.reduce((s, r) =>
    s + pairMin(r.clock_in, r.clock_out) + pairMin(r.clock_in2 ?? null, r.clock_out2 ?? null), 0);

  const filteredTasks = taskFilter === 'all' ? tasks : tasks.filter(t => t.status === taskFilter);

  // ─── Attendance Admin ───────────────────────────────────
  useEffect(() => {
    if (screen === 'attend_admin') { fetchAdminAttendance(); fetchAdminMembers(); }
  }, [screen, adminAttendMonth, adminAttendUser]);

  useEffect(() => {
    if (screen === 'attend_settings') fetchWorkPatterns();
  }, [screen]);

  const fetchAdminMembers = async () => {
    const { data } = await supabase.from('profiles').select('id, display_name').eq('account_status', 'active').eq('employment_type', '社員').order('display_name');
    if (data) setAdminMembers(data as Member[]);
  };

  const fetchAdminAttendance = async () => {
    setLoadingAdmin(true);
    const [y, m] = adminAttendMonth.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    let q = supabase.from('attendance_records').select('*, profiles(display_name)')
      .gte('work_date', `${adminAttendMonth}-01`).lte('work_date', `${adminAttendMonth}-${String(last).padStart(2, '0')}`)
      .order('work_date');
    if (adminAttendUser !== 'all') q = q.eq('user_id', adminAttendUser);
    const { data } = await q;
    if (data) setAdminRecords(data as unknown as AdminAttendRecord[]);
    setLoadingAdmin(false);
  };

  const openEditAttend = (rec: AdminAttendRecord) => {
    setEditAttendRec(rec);
    setEaClockIn(rec.clock_in ?? '');
    setEaClockOut(rec.clock_out ?? '');
    setEaClockIn2(rec.clock_in2 ?? '');
    setEaClockOut2(rec.clock_out2 ?? '');
    setEaBreakStart(rec.break_start ?? '');
    setEaBreakEnd(rec.break_end ?? '');
    setEaBreakStart2(rec.break_start2 ?? '');
    setEaBreakEnd2(rec.break_end2 ?? '');
    setEaNote(rec.note ?? '');
    setEaReason('');
    setEditAttendModal(true);
  };

  const saveEditAttend = async () => {
    if (!editAttendRec) return;
    if (!eaReason.trim()) { alert('修正理由を入力してください'); return; }
    setSavingAdmin(true);
    const before = {
      clock_in: editAttendRec.clock_in, clock_out: editAttendRec.clock_out,
      clock_in2: editAttendRec.clock_in2, clock_out2: editAttendRec.clock_out2,
      break_start: editAttendRec.break_start, break_end: editAttendRec.break_end,
      break_start2: editAttendRec.break_start2, break_end2: editAttendRec.break_end2,
      note: editAttendRec.note,
    };
    const after = {
      clock_in: eaClockIn || null, clock_out: eaClockOut || null,
      clock_in2: eaClockIn2 || null, clock_out2: eaClockOut2 || null,
      break_start: eaBreakStart || null, break_end: eaBreakEnd || null,
      break_start2: eaBreakStart2 || null, break_end2: eaBreakEnd2 || null,
      note: eaNote || null,
    };
    await supabase.from('attendance_records').update(after).eq('id', editAttendRec.id);
    await supabase.from('attendance_edit_logs').insert({
      attendance_id: editAttendRec.id,
      edited_by: currentUserId,
      target_user_id: editAttendRec.user_id,
      work_date: editAttendRec.work_date,
      before_data: before,
      after_data: after,
      reason: eaReason.trim(),
    });
    setEditAttendModal(false);
    await fetchAdminAttendance();
    setSavingAdmin(false);
  };

  const fetchEditLogs = async () => {
    const [y, m] = adminAttendMonth.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    let q = supabase.from('attendance_edit_logs').select('*, editor:edited_by(display_name), target:target_user_id(display_name)')
      .gte('work_date', `${adminAttendMonth}-01`).lte('work_date', `${adminAttendMonth}-${String(last).padStart(2, '0')}`)
      .order('created_at', { ascending: false });
    if (adminAttendUser !== 'all') q = q.eq('target_user_id', adminAttendUser);
    const { data } = await q;
    if (data) setEditLogs(data);
    setShowLogs(true);
  };

  // ─── Work Patterns ─────────────────────────────────────
  const fetchWorkPatterns = async () => {
    const [wpRes, assignRes, memRes] = await Promise.all([
      supabase.from('work_patterns').select('*').order('created_at'),
      supabase.from('user_work_patterns').select('*'),
      supabase.from('profiles').select('id, display_name').eq('account_status', 'active').eq('employment_type', '社員').order('display_name'),
    ]);
    if (wpRes.data) setWorkPatterns(wpRes.data as WorkPattern[]);
    if (assignRes.data) setUserWpAssigns(assignRes.data as UserWorkPattern[]);
    if (memRes.data) setWpMembers(memRes.data as Member[]);
  };

  const calcPatternMinutes = (start: string, end: string) => {
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    return Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
  };

  const openAddWp = () => {
    setEditingWp(null); setWpName(''); setWpStartTime('09:00'); setWpEndTime('18:00'); setWpBreak('60'); setWpModal(true);
  };

  const openEditWp = (wp: WorkPattern) => {
    setEditingWp(wp); setWpName(wp.name);
    setWpStartTime(wp.start_time); setWpEndTime(wp.end_time);
    setWpBreak(String(wp.break_minutes));
    setWpModal(true);
  };

  const saveWp = async () => {
    if (!wpName.trim()) { alert('パターン名を入力してください'); return; }
    setSavingWp(true);
    const totalMin = calcPatternMinutes(wpStartTime, wpEndTime);
    const breakMin = parseInt(wpBreak || '60');
    const stdMin = totalMin - breakMin;
    const payload = {
      name: wpName.trim(), start_time: wpStartTime, end_time: wpEndTime,
      standard_hours_min: stdMin, break_minutes: breakMin, overtime_threshold_min: stdMin,
    };
    if (editingWp) {
      await supabase.from('work_patterns').update(payload).eq('id', editingWp.id);
    } else {
      await supabase.from('work_patterns').insert(payload);
    }
    setWpModal(false);
    await fetchWorkPatterns();
    setSavingWp(false);
  };

  const deleteWp = async (wp: WorkPattern) => {
    if (wp.is_default) { alert('デフォルトパターンは削除できません'); return; }
    if (!window.confirm(`「${wp.name}」を削除しますか？`)) return;
    await supabase.from('work_patterns').delete().eq('id', wp.id);
    await fetchWorkPatterns();
  };

  const setDefaultWp = async (wp: WorkPattern) => {
    await supabase.from('work_patterns').update({ is_default: false }).neq('id', wp.id);
    await supabase.from('work_patterns').update({ is_default: true }).eq('id', wp.id);
    await fetchWorkPatterns();
  };

  const toggleUserPattern = async (userId: string, patternId: string) => {
    const existing = userWpAssigns.find(a => a.user_id === userId && a.work_pattern_id === patternId);
    if (existing) {
      await supabase.from('user_work_patterns').delete().eq('id', existing.id);
    } else {
      await supabase.from('user_work_patterns').insert({ user_id: userId, work_pattern_id: patternId });
    }
    const { data } = await supabase.from('user_work_patterns').select('*');
    if (data) setUserWpAssigns(data as UserWorkPattern[]);
  };

  // ─── Mail ──────────────────────────────────────────────
  useEffect(() => { if (screen === 'mail') { fetchMails(); fetchMailMembers(); } }, [screen, mailTab]);

  const fetchMailMembers = async () => {
    const { data } = await supabase.from('profiles').select('id, display_name').eq('account_status', 'active').eq('employment_type', '社員').order('display_name');
    if (data) setMailMembers(data as Member[]);
  };

  const fetchMails = async () => {
    setLoadingMail(true);
    let mailData: InternalMail[] = [];
    if (mailTab === 'inbox') {
      const { data: recData } = await supabase.from('mail_recipients').select('mail_id').eq('user_id', currentUserId).eq('is_deleted', false);
      if (recData && recData.length > 0) {
        const ids = recData.map((r: any) => r.mail_id);
        const { data } = await supabase.from('internal_mails').select('*').in('id', ids).eq('is_draft', false).order('sent_at', { ascending: false });
        if (data) mailData = data as InternalMail[];
      }
      // 未読数
      const { count } = await supabase.from('mail_recipients').select('id', { count: 'exact', head: true }).eq('user_id', currentUserId).eq('is_read', false).eq('is_deleted', false);
      setUnreadCount(count ?? 0);
    } else if (mailTab === 'sent') {
      const { data } = await supabase.from('internal_mails').select('*').eq('sender_id', currentUserId).eq('is_draft', false).order('sent_at', { ascending: false });
      if (data) mailData = data as InternalMail[];
    } else {
      const { data } = await supabase.from('internal_mails').select('*').eq('sender_id', currentUserId).eq('is_draft', true).order('created_at', { ascending: false });
      if (data) mailData = data as InternalMail[];
    }
    // 送信者名と宛先を取得
    if (mailData.length > 0) {
      const allUids = [...new Set(mailData.map(m => m.sender_id))];
      const { data: profs } = await supabase.from('profiles').select('id, display_name').in('id', allUids);
      const pmap: Record<string, string> = {};
      profs?.forEach((p: any) => { pmap[p.id] = p.display_name; });
      const mailIds = mailData.map(m => m.id);
      const { data: allRecs } = await supabase.from('mail_recipients').select('mail_id, user_id, recipient_type').in('mail_id', mailIds);
      const recUids = [...new Set((allRecs ?? []).map((r: any) => r.user_id))];
      if (recUids.length > 0) {
        const { data: rProfs } = await supabase.from('profiles').select('id, display_name').in('id', recUids);
        rProfs?.forEach((p: any) => { pmap[p.id] = p.display_name; });
      }
      mailData = mailData.map(m => ({
        ...m,
        sender_name: pmap[m.sender_id] ?? '',
        recipients: (allRecs ?? []).filter((r: any) => r.mail_id === m.id).map((r: any) => ({
          user_id: r.user_id, recipient_type: r.recipient_type, display_name: pmap[r.user_id] ?? '',
        })),
      }));
    }
    setMails(mailData);
    setLoadingMail(false);
  };

  const openComposeMail = () => {
    setViewMail(null); setMlSubject(''); setMlBody(''); setMlTo([]); setMlCc([]);
    setMailModal(true);
  };

  const openReplyMail = (mail: InternalMail) => {
    setViewMail(null);
    setMlSubject(`Re: ${mail.subject}`);
    setMlBody(`\n\n---\n${mail.sender_name} (${mail.sent_at?.slice(0, 10)}):\n${mail.body}`);
    setMlTo([mail.sender_id]);
    setMlCc([]);
    setMailModal(true);
  };

  const sendMail = async (asDraft: boolean) => {
    if (!mlSubject.trim()) { alert('件名を入力してください'); return; }
    if (!asDraft && mlTo.length === 0) { alert('宛先を選択してください'); return; }
    setSavingMail(true);
    const { data: newMail, error } = await supabase.from('internal_mails').insert({
      sender_id: currentUserId, subject: mlSubject.trim(), body: mlBody,
      is_draft: asDraft, sent_at: asDraft ? null : new Date().toISOString(),
    }).select().single();
    if (error || !newMail) { alert(error?.message ?? '送信失敗'); setSavingMail(false); return; }
    const recs = [
      ...mlTo.map(uid => ({ mail_id: newMail.id, user_id: uid, recipient_type: 'to' })),
      ...mlCc.map(uid => ({ mail_id: newMail.id, user_id: uid, recipient_type: 'cc' })),
    ];
    if (recs.length > 0) await supabase.from('mail_recipients').insert(recs);
    setMailModal(false); await fetchMails(); setSavingMail(false);
    if (!asDraft) alert('送信しました');
  };

  const markAsRead = async (mailId: string) => {
    await supabase.from('mail_recipients').update({ is_read: true, read_at: new Date().toISOString() }).eq('mail_id', mailId).eq('user_id', currentUserId);
  };

  const deleteMail = async (mail: InternalMail) => {
    if (mailTab === 'inbox') {
      await supabase.from('mail_recipients').update({ is_deleted: true }).eq('mail_id', mail.id).eq('user_id', currentUserId);
    } else {
      await supabase.from('mail_recipients').delete().eq('mail_id', mail.id);
      await supabase.from('internal_mails').delete().eq('id', mail.id);
    }
    setViewMail(null); await fetchMails();
  };

  // ─── My Page (Bookmarks) ────────────────────────────────
  useEffect(() => { if (screen === 'mypage') fetchBookmarks(); }, [screen]);

  const fetchBookmarks = async () => {
    setLoadingBm(true);
    const { data } = await supabase.from('user_bookmarks').select('*').eq('user_id', currentUserId).order('sort_order').order('created_at');
    if (data) setBookmarks(data as Bookmark[]);
    setLoadingBm(false);
  };

  const openAddBm = () => {
    setEditBm(null); setBmTitle(''); setBmUrl(''); setBmIcon('🔗'); setBmModal(true);
  };

  const openEditBm = (bm: Bookmark) => {
    setEditBm(bm); setBmTitle(bm.title); setBmUrl(bm.url); setBmIcon(bm.icon); setBmModal(true);
  };

  const saveBm = async () => {
    if (!bmTitle.trim() || !bmUrl.trim()) { alert('タイトルとURLを入力してください'); return; }
    let url = bmUrl.trim();
    if (!url.startsWith('http')) url = 'https://' + url;
    if (editBm) {
      await supabase.from('user_bookmarks').update({ title: bmTitle.trim(), url, icon: bmIcon }).eq('id', editBm.id);
    } else {
      await supabase.from('user_bookmarks').insert({ user_id: currentUserId, title: bmTitle.trim(), url, icon: bmIcon, sort_order: bookmarks.length });
    }
    setBmModal(false); await fetchBookmarks();
  };

  const deleteBm = async (bm: Bookmark) => {
    if (!window.confirm(`「${bm.title}」を削除しますか？`)) return;
    await supabase.from('user_bookmarks').delete().eq('id', bm.id);
    await fetchBookmarks();
  };

  // ─── External Links ─────────────────────────────────────
  useEffect(() => { if (screen === 'extlinks') fetchExtLinks(); }, [screen]);

  const EL_ICONS = ['🔗', '📊', '📧', '💰', '📁', '🗂', '🖥', '☁️', '📋', '🛒', '💬', '📞', '🏢', '⚙️', '🔒', '📆'];
  const EL_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EC4899', '#8B5CF6', '#EF4444', '#06B6D4', '#6366F1', '#84CC16', '#F97316'];

  const fetchExtLinks = async () => {
    setLoadingExt(true);
    const { data } = await supabase.from('external_links').select('*').order('sort_order');
    if (data) setExtLinks(data as ExternalLink[]);
    setLoadingExt(false);
  };

  const openAddExt = () => {
    setEditExt(null); setElTitle(''); setElUrl('https://'); setElIcon('🔗'); setElDesc(''); setElColor('#3B82F6');
    setExtModal(true);
  };
  const openEditExt = (l: ExternalLink) => {
    setEditExt(l); setElTitle(l.title); setElUrl(l.url); setElIcon(l.icon); setElDesc(l.description ?? ''); setElColor(l.color);
    setExtModal(true);
  };

  const saveExtLink = async () => {
    if (!elTitle.trim() || !elUrl.trim()) { alert('タイトルとURLを入力してください'); return; }
    setSavingExt(true);
    const payload = { title: elTitle.trim(), url: elUrl.trim(), icon: elIcon, description: elDesc.trim() || null, color: elColor };
    if (editExt) {
      await supabase.from('external_links').update(payload).eq('id', editExt.id);
    } else {
      await supabase.from('external_links').insert({ ...payload, created_by: currentUserId, sort_order: extLinks.length });
    }
    setExtModal(false); await fetchExtLinks(); setSavingExt(false);
  };

  const deleteExtLink = async (l: ExternalLink) => {
    if (!window.confirm(`「${l.title}」を削除しますか？`)) return;
    await supabase.from('external_links').delete().eq('id', l.id); await fetchExtLinks();
  };

  // ─── Business Cards ─────────────────────────────────────
  useEffect(() => { if (screen === 'cards') fetchBcards(); }, [screen]);

  const callCardsApi = async (action: string, card?: any) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('ログインが必要です');
    const resp = await fetch('https://nccognptoprhwsbjnwcu.supabase.co/functions/v1/sync-cards-sheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}`, 'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5jY29nbnB0b3ByaHdzYmpud2N1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNDU0NDEsImV4cCI6MjA4OTkyMTQ0MX0.M3h31uPyKYWlNevVW3OvZOonoTidC1KLZ04sB5nRKzU' },
      body: JSON.stringify({ action, card }),
    });
    return resp.json();
  };

  const fetchBcards = async () => {
    setLoadingBc(true);
    try {
      const result = await callCardsApi('list');
      if (result.cards) setBcards(result.cards as BusinessCard[]);
      else setBcards([]);
    } catch (_) { setBcards([]); }
    setLoadingBc(false);
  };

  const scanBusinessCard = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { alert('カメラの権限が必要です'); return; }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: true,
      quality: 0.7,
      allowsEditing: false,
    });

    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (!asset) return;

    let imageBase64 = asset.base64 || '';
    if (!imageBase64 && asset.uri) {
      try {
        imageBase64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      } catch (readErr) {
        console.warn('Business card scan: failed to read image base64', readErr);
      }
    }

    if (!imageBase64) {
      alert('画像を取得できませんでした。再度お試しください。');
      return;
    }

    setOcrLoading(true);
    // 新規フォームを開いておく
    openAddBc();

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        alert('ログインしてください');
        setOcrLoading(false);
        return;
      }

      const mimeType = asset.uri?.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
      const resp = await fetch('https://nccognptoprhwsbjnwcu.supabase.co/functions/v1/ocr-business-card', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5jY29nbnB0b3ByaHdzYmpud2N1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNDU0NDEsImV4cCI6MjA4OTkyMTQ0MX0.M3h31uPyKYWlNevVW3OvZOonoTidC1KLZ04sB5nRKzU',
        },
        body: JSON.stringify({
          image_base64: imageBase64,
          mime_type: mimeType,
        }),
      });

      const json = await resp.json();
      if (json.success && json.data) {
        const d = json.data;
        if (d.company_name) setBcCompany(d.company_name);
        if (d.department) setBcDept(d.department);
        if (d.person_name) setBcPerson(d.person_name);
        if (d.title) setBcTitle(d.title);
        if (d.phone) setBcPhone(d.phone);
        if (d.mobile) setBcMobile(d.mobile);
        if (d.email) setBcEmail(d.email);
        if (d.address) setBcAddress(d.address);
        if (d.website) setBcWebsite(d.website);
        alert('名刺の情報を自動入力しました。内容を確認して保存してください。');
      } else {
        console.warn('Business card OCR response error', json);
        alert(json.error || '名刺を認識できませんでした。手動で入力してください。');
      }
    } catch (e: any) {
      console.warn('Business card scan failed', e);
      alert(e.message || '通信エラーが発生しました');
    }
    setOcrLoading(false);
  };

  const openAddBc = () => {
    setEditBc(null); setBcCompany(''); setBcDept(''); setBcPerson(''); setBcTitle('');
    setBcPhone(''); setBcMobile(''); setBcEmail(''); setBcAddress('');
    setBcWebsite(''); setBcNotes(''); setBcMetDate(todayStr()); setBcMetLocation(''); setBcTags('');
    setBcModal(true);
  };
  const openEditBc = (c: BusinessCard) => {
    setEditBc(c); setBcCompany(c.company_name); setBcDept(c.department ?? ''); setBcPerson(c.person_name);
    setBcTitle(c.title ?? ''); setBcPhone(c.phone ?? ''); setBcMobile(c.mobile ?? '');
    setBcEmail(c.email ?? ''); setBcAddress(c.address ?? ''); setBcWebsite(c.website ?? '');
    setBcNotes(c.notes ?? ''); setBcMetDate(c.met_date ?? ''); setBcMetLocation(c.met_location ?? '');
    setBcTags(c.tags ?? ''); setBcModal(true);
  };

  const saveBc = async () => {
    if (!bcPerson.trim() || !bcCompany.trim()) { alert('会社名と氏名は必須です'); return; }
    setSavingBc(true);
    const payload = {
      id: editBc?.id,
      company_name: bcCompany.trim(), department: bcDept.trim() || '', person_name: bcPerson.trim(),
      title: bcTitle.trim() || '', phone: bcPhone.trim() || '', mobile: bcMobile.trim() || '',
      email: bcEmail.trim() || '', address: bcAddress.trim() || '', website: bcWebsite.trim() || '',
      notes: bcNotes.trim() || '', met_date: bcMetDate || '', met_location: bcMetLocation.trim() || '',
      tags: bcTags.trim() || '',
    };
    try {
      if (editBc) { await callCardsApi('update', payload); }
      else { await callCardsApi('add', payload); }
      setBcModal(false); setBcView(null); await fetchBcards();
    } catch (e: any) { alert('エラー: ' + e.message); }
    setSavingBc(false);
  };

  const deleteBc = async (c: BusinessCard) => {
    if (!window.confirm(`${c.company_name} ${c.person_name} の名刺を削除しますか？`)) return;
    try {
      await callCardsApi('delete', { id: c.id });
      setBcView(null); await fetchBcards();
    } catch (e: any) { alert('エラー: ' + e.message); }
  };

  const filteredBcards = bcSearch
    ? bcards.filter(c => [c.company_name, c.person_name, c.department, c.title, c.tags, c.email].filter(Boolean).join(' ').toLowerCase().includes(bcSearch.toLowerCase()))
    : bcards;

  // ─── Gantt ──────────────────────────────────────────────
  useEffect(() => { if (screen === 'gantt') fetchGantt(); }, [screen]);

  const GANTT_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EC4899', '#8B5CF6', '#EF4444', '#06B6D4', '#84CC16'];

  const fetchGantt = async () => {
    setLoadingGantt(true);
    const [pRes, tRes, mRes] = await Promise.all([
      supabase.from('gantt_projects').select('*').order('sort_order'),
      supabase.from('gantt_tasks').select('*').order('sort_order'),
      supabase.from('profiles').select('id, display_name').eq('account_status', 'active').eq('employment_type', '社員').order('display_name'),
    ]);
    if (pRes.data) setGanttProjects(pRes.data as GanttProject[]);
    if (tRes.data) setGanttTasks(tRes.data as GanttTask[]);
    if (mRes.data) setGanttMembers(mRes.data as Member[]);
    setLoadingGantt(false);
  };

  const openAddGProj = () => { setEditGProj(null); setGpName(''); setGpColor('#3B82F6'); setGanttProjModal(true); };
  const openEditGProj = (p: GanttProject) => { setEditGProj(p); setGpName(p.name); setGpColor(p.color); setGanttProjModal(true); };

  const saveGProj = async () => {
    if (!gpName.trim()) { alert('プロジェクト名を入力'); return; }
    setSavingGantt(true);
    if (editGProj) {
      await supabase.from('gantt_projects').update({ name: gpName.trim(), color: gpColor }).eq('id', editGProj.id);
    } else {
      await supabase.from('gantt_projects').insert({ name: gpName.trim(), color: gpColor, created_by: currentUserId, sort_order: ganttProjects.length });
    }
    setGanttProjModal(false); await fetchGantt(); setSavingGantt(false);
  };

  const deleteGProj = async (p: GanttProject) => {
    if (!window.confirm(`「${p.name}」と全タスクを削除しますか？`)) return;
    await supabase.from('gantt_projects').delete().eq('id', p.id); await fetchGantt();
  };

  const openAddGTask = (projId: string) => {
    setEditGTask(null); setGtTitle(''); setGtProjId(projId); setGtAssignee(null);
    setGtStart(dateStr(new Date())); const e = new Date(); e.setDate(e.getDate() + 7); setGtEnd(dateStr(e));
    setGtProgress('0'); setGanttTaskModal(true);
  };
  const openEditGTask = (t: GanttTask) => {
    setEditGTask(t); setGtTitle(t.title); setGtProjId(t.project_id); setGtAssignee(t.assigned_to);
    setGtStart(t.start_date); setGtEnd(t.end_date); setGtProgress(String(t.progress));
    setGanttTaskModal(true);
  };

  const saveGTask = async () => {
    if (!gtTitle.trim() || !gtProjId) { alert('タイトルとプロジェクトを選択'); return; }
    setSavingGantt(true);
    const payload = { title: gtTitle.trim(), project_id: gtProjId, assigned_to: gtAssignee, start_date: gtStart, end_date: gtEnd, progress: parseInt(gtProgress || '0') };
    if (editGTask) {
      await supabase.from('gantt_tasks').update(payload).eq('id', editGTask.id);
    } else {
      const projTasks = ganttTasks.filter(t => t.project_id === gtProjId);
      await supabase.from('gantt_tasks').insert({ ...payload, sort_order: projTasks.length });
    }
    setGanttTaskModal(false); await fetchGantt(); setSavingGantt(false);
  };

  const deleteGTask = async (t: GanttTask) => {
    if (!window.confirm(`「${t.title}」を削除しますか？`)) return;
    await supabase.from('gantt_tasks').delete().eq('id', t.id); await fetchGantt();
  };

  // ─── Reports ─────────────────────────────────────────────
  useEffect(() => { if (screen === 'reports') fetchReports(); }, [screen, reportFilter]);

  const REPORT_CATS = ['会議議事録', '業務報告', '出張報告', '日報', '週報', '月報', 'その他'] as const;
  const REPORT_STATUS_COLOR: Record<string, { bg: string; text: string }> = {
    '下書き': { bg: '#F1F5F9', text: '#64748B' },
    '提出済': { bg: '#DBEAFE', text: '#1D4ED8' },
    '承認済': { bg: '#D1FAE5', text: '#065F46' },
    '差戻し': { bg: '#FEE2E2', text: '#DC2626' },
  };

  const fetchReports = async () => {
    setLoadingReports(true);
    let q = supabase.from('reports').select('*').order('updated_at', { ascending: false });
    if (reportFilter === 'mine') q = q.eq('author_id', currentUserId);
    else if (reportFilter === 'draft') q = q.eq('author_id', currentUserId).eq('status', '下書き');
    const { data, error } = await q;
    if (error) { console.log('fetchReports error:', error.message); setLoadingReports(false); return; }
    if (data && data.length > 0) {
      // author名を取得
      const uids = [...new Set(data.map((r: any) => r.author_id).filter(Boolean))];
      const approverIds = [...new Set(data.map((r: any) => r.approved_by).filter(Boolean))];
      const allIds = [...new Set([...uids, ...approverIds])];
      const { data: profs } = await supabase.from('profiles').select('id, display_name').in('id', allIds);
      const profMap: Record<string, string> = {};
      profs?.forEach((p: any) => { profMap[p.id] = p.display_name; });
      setReports(data.map((r: any) => ({
        ...r,
        profiles: r.author_id ? { display_name: profMap[r.author_id] ?? '' } : null,
        approver: r.approved_by ? { display_name: profMap[r.approved_by] ?? '' } : null,
      })) as Report[]);
    } else {
      setReports([]);
    }
    setLoadingReports(false);
  };

  const openNewReport = () => {
    setEditingReport(null); setViewReport(null);
    setRpTitle(''); setRpDate(new Date().toISOString().slice(0, 10));
    setRpCategory('会議議事録'); setRpParticipants(''); setRpExtParticipants(''); setRpContent('');
    setRpStatus('下書き'); setRpComment('');
    setReportModal(true);
  };

  const openEditReport = (r: Report) => {
    setEditingReport(r); setViewReport(null);
    setRpTitle(r.title); setRpDate(r.report_date); setRpCategory(r.category);
    setRpParticipants(r.participants ?? ''); setRpExtParticipants(r.external_participants ?? ''); setRpContent(r.content);
    setRpStatus(r.status); setRpComment(r.comment ?? '');
    setReportModal(true);
  };

  const saveReport = async (asStatus: Report['status']) => {
    if (!rpTitle.trim()) { alert('タイトルを入力してください'); return; }
    setSavingReport(true);
    const payload = {
      title: rpTitle.trim(), report_date: rpDate, category: rpCategory,
      participants: rpParticipants.trim() || null, external_participants: rpExtParticipants.trim() || null, content: rpContent,
      status: asStatus, updated_at: new Date().toISOString(),
      ...(asStatus === '提出済' && !editingReport?.submitted_at ? { submitted_at: new Date().toISOString() } : {}),
    };
    if (editingReport) {
      await supabase.from('reports').update(payload).eq('id', editingReport.id);
    } else {
      await supabase.from('reports').insert({ ...payload, author_id: currentUserId });
    }
    setReportModal(false); await fetchReports();
    setSavingReport(false);
  };

  const approveReport = async (r: Report, newStatus: '承認済' | '差戻し', comment: string) => {
    await supabase.from('reports').update({
      status: newStatus, approved_by: currentUserId, approved_at: new Date().toISOString(),
      comment: comment || null, updated_at: new Date().toISOString(),
    }).eq('id', r.id);
    setViewReport(null); await fetchReports();
  };

  const deleteReport = async (r: Report) => {
    if (!window.confirm(`「${r.title}」を削除しますか？`)) return;
    await supabase.from('reports').delete().eq('id', r.id);
    setViewReport(null); await fetchReports();
  };

  // ─── Shared header ───────────────────────────────────────
  const renderHeader = (title: string, action?: React.ReactNode) => (
    <View style={styles.subHeader}>
      <TouchableOpacity onPress={() => screen === 'portal' ? onBack() : setScreen('portal')}>
        <Text style={styles.subBack}>{screen === 'portal' ? '← 戻る' : '← トップ'}</Text>
      </TouchableOpacity>
      <Text style={styles.subHeaderTitle}>{title}</Text>
      <View style={styles.subHeaderRight}>{action}</View>
    </View>
  );

  // ─── Schedule ────────────────────────────────────────────
  useEffect(() => {
    if (screen === 'schedule') fetchSchedule();
  }, [screen, schedNavDate, schedView]);

  const fetchSchedule = async () => {
    setLoadingSched(true);
    let from: string, to: string;
    if (schedView === 'day') {
      from = to = dateStr(schedNavDate);
    } else if (schedView === 'week') {
      const mon = getMonday(schedNavDate);
      const sun = new Date(mon); sun.setDate(sun.getDate() + 6);
      from = dateStr(mon); to = dateStr(sun);
    } else if (schedView === 'month') {
      const y = schedNavDate.getFullYear(), m = schedNavDate.getMonth();
      from = dateStr(new Date(y, m, 1)); to = dateStr(new Date(y, m + 1, 0));
    } else {
      const y = schedNavDate.getFullYear();
      from = `${y}-01-01`; to = `${y}-12-31`;
    }
    const [evRes, memRes] = await Promise.all([
      supabase.from('schedule_events').select('*').gte('event_date', from).lte('event_date', to).order('start_time', { ascending: true, nullsFirst: true }),
      supabase.from('profiles').select('id, display_name').eq('account_status', 'active').eq('employment_type', '社員').order('display_name'),
    ]);
    if (evRes.data) setSchedEvents(evRes.data as ScheduleEvent[]);
    if (memRes.data) setSchedMembers(memRes.data as Member[]);
    setLoadingSched(false);
  };

  const openAddEvent = (userId?: string, date?: string) => {
    setEditingEvent(null);
    setEvTitle(''); setEvType('その他'); setEvStart(''); setEvEnd(''); setEvMemo('');
    setEvUserIds(userId ? [userId] : currentUserId ? [currentUserId] : []);
    setEvDate(date || dateStr(schedNavDate));
    setEventModal(true);
  };

  const openEditEvent = (ev: ScheduleEvent) => {
    setEditingEvent(ev);
    setEvTitle(ev.title); setEvType(ev.event_type);
    setEvStart(ev.start_time?.slice(0,5) || ''); setEvEnd(ev.end_time?.slice(0,5) || '');
    setEvMemo(ev.memo || ''); setEvDate(ev.event_date); setEvUserIds([ev.user_id]);
    setEventModal(true);
  };

  const saveEvent = async () => {
    if (!evTitle.trim()) { alert('タイトルを入力してください'); return; }
    if (evUserIds.length === 0) { alert('対象メンバーを1人以上選択してください'); return; }
    setSavingEvent(true);
    const base = {
      title: evTitle.trim(), event_date: evDate, event_type: evType,
      start_time: evStart || null, end_time: evEnd || null,
      memo: evMemo.trim() || null, all_day: !evStart,
    };
    if (editingEvent) {
      await supabase.from('schedule_events').update({ ...base, user_id: evUserIds[0] }).eq('id', editingEvent.id);
    } else {
      await supabase.from('schedule_events').insert(evUserIds.map(uid => ({ ...base, user_id: uid })));
    }
    setEventModal(false);
    await fetchSchedule();
    setSavingEvent(false);
  };

  const deleteEvent = async (ev: ScheduleEvent) => {
    if (!window.confirm(`「${ev.title}」を削除しますか？`)) return;
    await supabase.from('schedule_events').delete().eq('id', ev.id);
    setSchedEvents(prev => prev.filter(e => e.id !== ev.id));
  };

  // ═══════════════════════════════════════════════════════════
  // PORTAL
  // ═══════════════════════════════════════════════════════════
  if (screen === 'portal') {
    const today = new Date();
    const dateLabel = today.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });

    return (
      <View style={styles.container}>
        {/* ヘッダー */}
        <View style={styles.portalHeader}>
          <TouchableOpacity onPress={onBack}>
            <Text style={styles.subBack}>← 戻る</Text>
          </TouchableOpacity>
          <View style={styles.portalHeaderCenter}>
            <Text style={styles.portalLogo}>💼 ビジネス</Text>
            <Text style={styles.portalDate}>{dateLabel}</Text>
          </View>
          <View style={{ width: 60 }} />
        </View>

        {/* アイコンナビゲーション */}
        <View style={styles.navGrid}>
          {NAV_ITEMS.map(item => (
            <TouchableOpacity key={item.key} style={styles.navItem} onPress={() => setScreen(item.key)}>
              <View style={[styles.navIconBox, { backgroundColor: item.color + '18' }]}>
                <Text style={styles.navIcon}>{item.icon}</Text>
              </View>
              <Text style={styles.navLabel}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {portalLoading
          ? <ActivityIndicator style={{ marginTop: 60 }} color="#1E3A5F" size="large" />
          : (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.portalScroll} showsVerticalScrollIndicator={false}>

            {/* 連絡（ピン留め投稿） */}
            {pinnedPost && (
              <View style={styles.widget}>
                <View style={styles.widgetHeader}>
                  <Text style={styles.widgetIcon}>📌</Text>
                  <Text style={styles.widgetTitle}>連絡</Text>
                </View>
                <TouchableOpacity style={styles.pinnedCard} onPress={() => { setScreen('bulletin'); openPost(pinnedPost); }}>
                  <View style={[styles.categoryTag, { backgroundColor: CATEGORY_COLORS[pinnedPost.category]?.bg ?? '#F3F4F6' }]}>
                    <Text style={[styles.categoryTagText, { color: CATEGORY_COLORS[pinnedPost.category]?.text ?? '#4B5563' }]}>{pinnedPost.category}</Text>
                  </View>
                  <Text style={styles.pinnedTitle}>{pinnedPost.title}</Text>
                  <Text style={styles.pinnedContent} numberOfLines={2}>{pinnedPost.content}</Text>
                  <Text style={styles.pinnedMeta}>{pinnedPost.profiles?.display_name} · {fmtTime(pinnedPost.created_at)}</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* 勤怠ウィジェット */}
            <View style={styles.widget}>
              <View style={styles.widgetHeader}>
                <Text style={styles.widgetIcon}>🕐</Text>
                <Text style={styles.widgetTitle}>今日の勤怠</Text>
                <TouchableOpacity onPress={() => setScreen('attendance')} style={styles.widgetMore}>
                  <Text style={styles.widgetMoreText}>詳細 ›</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.attendWidget}>
                {/* 1回目 */}
                <View style={styles.attendWidgetRow}>
                  <Text style={styles.attendWidgetSession}>①</Text>
                  <Text style={[styles.attendWidgetTime, !todayRecord?.clock_in && styles.attendWidgetEmpty]}>{todayRecord?.clock_in ?? '--:--'}</Text>
                  <Text style={styles.attendWidgetArrow}>→</Text>
                  <Text style={[styles.attendWidgetTime, !todayRecord?.clock_out && styles.attendWidgetEmpty]}>{todayRecord?.clock_out ?? '--:--'}</Text>
                </View>
                {/* 2回目（1回目退勤後に表示） */}
                {(todayRecord?.clock_out || todayRecord?.clock_in2) ? (
                  <View style={styles.attendWidgetRow}>
                    <Text style={styles.attendWidgetSession}>②</Text>
                    <Text style={[styles.attendWidgetTime, !todayRecord?.clock_in2 && styles.attendWidgetEmpty]}>{todayRecord?.clock_in2 ?? '--:--'}</Text>
                    <Text style={styles.attendWidgetArrow}>→</Text>
                    <Text style={[styles.attendWidgetTime, !todayRecord?.clock_out2 && styles.attendWidgetEmpty]}>{todayRecord?.clock_out2 ?? '--:--'}</Text>
                  </View>
                ) : null}
                <View style={styles.attendWidgetTotal}>
                  <Text style={styles.attendWidgetLabel}>本日実働</Text>
                  <Text style={[styles.attendWidgetTime, { color: '#2563EB', fontSize: 18 }]}>
                    {todayRecord ? (calcWorkRecord(todayRecord) ?? '--') : '--'}
                  </Text>
                </View>
                <View style={styles.attendWidgetBtns}>
                  <TouchableOpacity
                    style={[styles.clockMiniBtn, styles.clockMiniIn, !canClockIn(todayRecord) && styles.clockMiniBtnDone]}
                    onPress={clockIn}
                    disabled={saving || !canClockIn(todayRecord)}
                  >
                    <Text style={styles.clockMiniBtnText}>{canClockIn(todayRecord) ? '出勤' : '出勤済'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.clockMiniBtn, styles.clockMiniOut, !canClockOut(todayRecord) && styles.clockMiniBtnDone]}
                    onPress={clockOut}
                    disabled={saving || !canClockOut(todayRecord)}
                  >
                    <Text style={styles.clockMiniBtnText}>{canClockOut(todayRecord) ? '退勤' : '退勤済'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            {/* 最新情報 */}
            <View style={styles.infoRow}>
              {/* 掲示板 */}
              <View style={[styles.widget, { flex: 1 }]}>
                <View style={styles.widgetHeader}>
                  <Text style={styles.widgetIcon}>📋</Text>
                  <Text style={styles.widgetTitle}>掲示板</Text>
                  <TouchableOpacity onPress={() => setScreen('bulletin')} style={styles.widgetMore}>
                    <Text style={styles.widgetMoreText}>一覧 ›</Text>
                  </TouchableOpacity>
                </View>
                {latestPosts.length === 0
                  ? <Text style={styles.emptySmall}>投稿なし</Text>
                  : latestPosts.map(p => (
                    <TouchableOpacity key={p.id} style={styles.infoItem} onPress={() => { setScreen('bulletin'); openPost(p); }}>
                      <View style={[styles.categoryDot, { backgroundColor: CATEGORY_COLORS[p.category]?.text ?? '#9CA3AF' }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.infoItemTitle} numberOfLines={1}>{p.title}</Text>
                        <Text style={styles.infoItemSub}>{p.profiles?.display_name} · {fmtTime(p.created_at)}</Text>
                      </View>
                    </TouchableOpacity>
                  ))
                }
              </View>
            </View>

            {/* ToDoリスト */}
            <View style={styles.widget}>
              <View style={styles.widgetHeader}>
                <Text style={styles.widgetIcon}>✅</Text>
                <Text style={styles.widgetTitle}>ToDoリスト（自分のタスク）</Text>
                <TouchableOpacity onPress={() => setScreen('tasks')} style={styles.widgetMore}>
                  <Text style={styles.widgetMoreText}>一覧 ›</Text>
                </TouchableOpacity>
              </View>
              {myTasks.length === 0
                ? <Text style={styles.emptySmall}>未完了タスクなし ✓</Text>
                : myTasks.map(t => (
                  <View key={t.id} style={styles.todoItem}>
                    <TouchableOpacity onPress={() => { setScreen('tasks'); cycleStatus(t); }} style={styles.todoCheck}>
                      <View style={[styles.todoCheckBox, { borderColor: STATUS_COLOR[t.status] }]}>
                        {t.status === '完了' && <Text style={{ fontSize: 10, color: STATUS_COLOR['完了'] }}>✓</Text>}
                        {t.status === '進行中' && <View style={[styles.todoCheckFill, { backgroundColor: STATUS_COLOR['進行中'] }]} />}
                      </View>
                    </TouchableOpacity>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.todoTitle, t.status === '完了' && styles.todoDone]} numberOfLines={1}>{t.title}</Text>
                      <View style={styles.todoMeta}>
                        <View style={[styles.priorityPill, { backgroundColor: PRIORITY_COLOR[t.priority] + '22' }]}>
                          <Text style={[styles.priorityPillText, { color: PRIORITY_COLOR[t.priority] }]}>{t.priority}</Text>
                        </View>
                        {t.due_date && <Text style={[styles.todoDue, new Date(t.due_date) < new Date() && t.status !== '完了' && styles.todoOverdue]}>📅 {t.due_date}</Text>}
                      </View>
                    </View>
                  </View>
                ))
              }
            </View>

          </ScrollView>
        )}
      </View>
    );
  }

  // ═══════════════════════════════════════════════════════════
  // BULLETIN
  // ═══════════════════════════════════════════════════════════
  if (screen === 'bulletin') {
    return (
      <View style={styles.container}>
        {renderHeader('📋 掲示板',
          <TouchableOpacity style={styles.headerAddBtn} onPress={() => setPostModal(true)}>
            <Text style={styles.headerAddBtnText}>✏️ 投稿</Text>
          </TouchableOpacity>
        )}

        {/* 投稿一覧 */}
        {loadingPosts
          ? <ActivityIndicator style={{ marginTop: 40 }} color="#2563EB" />
          : <FlatList
              data={posts}
              keyExtractor={p => p.id}
              contentContainerStyle={styles.list}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.bulletinCard} onPress={() => openPost(item)}>
                  {item.is_pinned && (
                    <View style={styles.bulletinPinBadge}>
                      <Text style={styles.bulletinPinText}>📌 ピン留め</Text>
                    </View>
                  )}
                  <View style={styles.bulletinCardTop}>
                    <View style={[styles.categoryTag, { backgroundColor: CATEGORY_COLORS[item.category]?.bg ?? '#F3F4F6' }]}>
                      <Text style={[styles.categoryTagText, { color: CATEGORY_COLORS[item.category]?.text ?? '#4B5563' }]}>{item.category}</Text>
                    </View>
                    <Text style={styles.bulletinDate}>{fmtTime(item.created_at)}</Text>
                  </View>
                  <Text style={styles.bulletinTitle}>{item.title}</Text>
                  <Text style={styles.bulletinPreview} numberOfLines={2}>{item.content}</Text>
                  <View style={styles.bulletinFooter}>
                    <Text style={styles.bulletinAuthor}>{item.profiles?.display_name}</Text>
                    <Text style={styles.bulletinComment}>💬 {item.comment_count ?? 0}</Text>
                  </View>
                </TouchableOpacity>
              )}
            />
        }

        {/* 投稿作成モーダル */}
        <Modal visible={postModal} transparent animationType="slide" onRequestClose={() => setPostModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalSheet}>
              <View style={styles.modalTop}>
                <Text style={styles.modalTitle}>📋 新規投稿</Text>
                <TouchableOpacity onPress={() => setPostModal(false)}><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
              </View>
              <Text style={styles.fLabel}>カテゴリ</Text>
              <View style={styles.segRow}>
                {(['お知らせ', '業務連絡', 'その他'] as const).map(c => (
                  <TouchableOpacity key={c} style={[styles.seg, postCategory === c && { backgroundColor: CATEGORY_COLORS[c].bg, borderColor: CATEGORY_COLORS[c].text }]} onPress={() => setPostCategory(c)}>
                    <Text style={[styles.segText, postCategory === c && { color: CATEGORY_COLORS[c].text, fontWeight: 'bold' }]}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.fLabel}>タイトル *</Text>
              <TextInput style={styles.fInput} value={postTitle} onChangeText={setPostTitle} placeholder="タイトルを入力" />
              <Text style={styles.fLabel}>内容 *</Text>
              <TextInput style={[styles.fInput, styles.fTextArea]} value={postContent} onChangeText={setPostContent} placeholder="内容を入力..." multiline />
              {isAdmin && (
                <TouchableOpacity style={[styles.pinToggle, postPinned && styles.pinToggleOn]} onPress={() => setPostPinned(v => !v)}>
                  <Text style={[styles.pinToggleText, postPinned && { color: '#92400E' }]}>{postPinned ? '📌 ピン留めする' : '📌 ピン留めしない'}</Text>
                </TouchableOpacity>
              )}
              <View style={styles.modalBtns}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setPostModal(false)}><Text style={styles.cancelBtnText}>キャンセル</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.submitBtn, saving && { opacity: 0.6 }]} onPress={submitPost} disabled={saving}>
                  <Text style={styles.submitBtnText}>{saving ? '投稿中...' : '投稿する'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* 投稿詳細モーダル */}
        <Modal visible={!!selectedPost} transparent animationType="slide" onRequestClose={() => setSelectedPost(null)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalSheet, { maxHeight: '92%' }]}>
              <View style={styles.modalTop}>
                <TouchableOpacity onPress={() => setSelectedPost(null)}><Text style={styles.subBack}>← 戻る</Text></TouchableOpacity>
                {selectedPost && (selectedPost.author_id === currentUserId || isAdmin) && (
                  <TouchableOpacity onPress={() => deletePost(selectedPost)}><Text style={{ color: '#EF4444', fontSize: 14 }}>🗑 削除</Text></TouchableOpacity>
                )}
              </View>
              {selectedPost && (
                <ScrollView showsVerticalScrollIndicator={false}>
                  <View style={[styles.categoryTag, { backgroundColor: CATEGORY_COLORS[selectedPost.category]?.bg ?? '#F3F4F6', alignSelf: 'flex-start', marginBottom: 8 }]}>
                    <Text style={[styles.categoryTagText, { color: CATEGORY_COLORS[selectedPost.category]?.text ?? '#4B5563' }]}>{selectedPost.category}</Text>
                  </View>
                  <Text style={styles.detailTitle}>{selectedPost.title}</Text>
                  <Text style={styles.detailMeta}>{selectedPost.profiles?.display_name} · {fmtTime(selectedPost.created_at)}</Text>
                  <Text style={styles.detailContent}>{selectedPost.content}</Text>
                  <View style={styles.divider} />
                  <Text style={styles.commentsLabel}>コメント ({comments.length}件)</Text>
                  {comments.map(c => (
                    <View key={c.id} style={styles.commentBubble}>
                      <View style={styles.commentBubbleHeader}>
                        <View style={styles.commentAvatar}><Text style={styles.commentAvatarText}>{c.profiles?.display_name?.charAt(0) ?? '?'}</Text></View>
                        <Text style={styles.commentAuthorName}>{c.profiles?.display_name}</Text>
                        <Text style={styles.commentTime}>{fmtTime(c.created_at)}</Text>
                      </View>
                      <Text style={styles.commentText}>{c.content}</Text>
                    </View>
                  ))}
                  <View style={styles.commentInputRow}>
                    <TextInput style={styles.commentInput} value={newComment} onChangeText={setNewComment} placeholder="コメントを入力..." multiline />
                    <TouchableOpacity style={styles.commentSendBtn} onPress={submitComment}>
                      <Text style={styles.commentSendText}>送信</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={{ height: 40 }} />
                </ScrollView>
              )}
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  // ═══════════════════════════════════════════════════════════
  // TASKS
  // ═══════════════════════════════════════════════════════════
  if (screen === 'tasks') {
    return (
      <View style={styles.container}>
        {renderHeader('✅ ToDoリスト',
          <TouchableOpacity style={styles.headerAddBtn} onPress={() => setTaskModal(true)}>
            <Text style={styles.headerAddBtnText}>＋ 追加</Text>
          </TouchableOpacity>
        )}

        {/* フィルター */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterBar} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
          {(['all', '未着手', '進行中', '完了'] as const).map(f => (
            <TouchableOpacity key={f} style={[styles.filterChip, taskFilter === f && styles.filterChipActive]} onPress={() => setTaskFilter(f)}>
              <Text style={[styles.filterChipText, taskFilter === f && styles.filterChipTextActive]}>{f === 'all' ? 'すべて' : f}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {loadingTasks
          ? <ActivityIndicator style={{ marginTop: 40 }} color="#2563EB" />
          : <FlatList
              data={filteredTasks}
              keyExtractor={t => t.id}
              contentContainerStyle={styles.list}
              ListEmptyComponent={<Text style={styles.emptyText}>タスクがありません</Text>}
              renderItem={({ item }) => (
                <View style={styles.taskCard}>
                  <TouchableOpacity style={styles.taskCheckWrap} onPress={() => cycleStatus(item)}>
                    <View style={[styles.taskCheck, { borderColor: STATUS_COLOR[item.status] }, item.status !== '未着手' && { backgroundColor: STATUS_COLOR[item.status] }]}>
                      {item.status !== '未着手' && <Text style={{ color: '#fff', fontSize: 11, fontWeight: 'bold' }}>✓</Text>}
                    </View>
                  </TouchableOpacity>
                  <View style={{ flex: 1 }}>
                    <View style={styles.taskTitleRow}>
                      <Text style={[styles.taskTitleText, item.status === '完了' && styles.taskDoneText]} numberOfLines={1}>{item.title}</Text>
                      <View style={[styles.priorityPill, { backgroundColor: PRIORITY_COLOR[item.priority] + '22' }]}>
                        <Text style={[styles.priorityPillText, { color: PRIORITY_COLOR[item.priority] }]}>{item.priority}</Text>
                      </View>
                    </View>
                    {item.description ? <Text style={styles.taskDescText} numberOfLines={1}>{item.description}</Text> : null}
                    <View style={styles.taskMetaRow}>
                      <View style={[styles.statusPill, { backgroundColor: STATUS_COLOR[item.status] + '22' }]}>
                        <Text style={[styles.statusPillText, { color: STATUS_COLOR[item.status] }]}>{item.status}</Text>
                      </View>
                      <Text style={styles.taskAssignText}>👤 {(item.assignee as any)?.display_name ?? '未割当'}</Text>
                      {item.due_date && (
                        <Text style={[styles.taskDueText, new Date(item.due_date) < new Date() && item.status !== '完了' && styles.taskOverdueText]}>
                          📅 {item.due_date}
                        </Text>
                      )}
                    </View>
                  </View>
                  {(item.created_by === currentUserId || isAdmin) && (
                    <TouchableOpacity onPress={() => deleteTask(item)} style={{ padding: 8 }}>
                      <Text style={{ fontSize: 16, color: '#D1D5DB' }}>🗑</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            />
        }

        {/* タスク追加モーダル */}
        <Modal visible={taskModal} transparent animationType="slide" onRequestClose={() => setTaskModal(false)}>
          <View style={styles.modalOverlay}>
            <ScrollView contentContainerStyle={styles.modalSheet}>
              <View style={styles.modalTop}>
                <Text style={styles.modalTitle}>✅ タスク追加</Text>
                <TouchableOpacity onPress={() => setTaskModal(false)}><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
              </View>
              <Text style={styles.fLabel}>タイトル *</Text>
              <TextInput style={styles.fInput} value={taskTitle} onChangeText={setTaskTitle} placeholder="タスク名を入力" />
              <Text style={styles.fLabel}>詳細</Text>
              <TextInput style={[styles.fInput, { minHeight: 60 }]} value={taskDesc} onChangeText={setTaskDesc} placeholder="詳細内容..." multiline />
              <Text style={styles.fLabel}>優先度</Text>
              <View style={styles.segRow}>
                {(['高', '中', '低'] as const).map(p => (
                  <TouchableOpacity key={p} style={[styles.seg, taskPriority === p && { backgroundColor: PRIORITY_COLOR[p] + '22', borderColor: PRIORITY_COLOR[p] }]} onPress={() => setTaskPriority(p)}>
                    <Text style={[styles.segText, taskPriority === p && { color: PRIORITY_COLOR[p], fontWeight: 'bold' }]}>{p}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.fLabel}>期限 (YYYY-MM-DD)</Text>
              <TextInput style={styles.fInput} value={taskDue} onChangeText={setTaskDue} placeholder="例: 2026-04-30" keyboardType="numbers-and-punctuation" />
              <Text style={styles.fLabel}>担当者</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                <TouchableOpacity style={[styles.assignChip, taskAssignee === null && styles.assignChipActive]} onPress={() => setTaskAssignee(null)}>
                  <Text style={[styles.assignChipText, taskAssignee === null && styles.assignChipTextActive]}>未割当</Text>
                </TouchableOpacity>
                {members.map(m => (
                  <TouchableOpacity key={m.id} style={[styles.assignChip, taskAssignee === m.id && styles.assignChipActive]} onPress={() => setTaskAssignee(m.id)}>
                    <Text style={[styles.assignChipText, taskAssignee === m.id && styles.assignChipTextActive]}>{m.display_name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <View style={styles.modalBtns}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setTaskModal(false)}><Text style={styles.cancelBtnText}>キャンセル</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.submitBtn, saving && { opacity: 0.6 }]} onPress={submitTask} disabled={saving}>
                  <Text style={styles.submitBtnText}>{saving ? '保存中...' : '追加'}</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </Modal>
      </View>
    );
  }

  // ═══════════════════════════════════════════════════════════
  // SCHEDULE
  // ═══════════════════════════════════════════════════════════
  if (screen === 'schedule') {
    const navPrev = () => {
      const d = new Date(schedNavDate);
      if (schedView === 'day') d.setDate(d.getDate() - 1);
      else if (schedView === 'week') d.setDate(d.getDate() - 7);
      else if (schedView === 'month') d.setMonth(d.getMonth() - 1);
      else d.setFullYear(d.getFullYear() - 1);
      setSchedNavDate(d);
    };
    const navNext = () => {
      const d = new Date(schedNavDate);
      if (schedView === 'day') d.setDate(d.getDate() + 1);
      else if (schedView === 'week') d.setDate(d.getDate() + 7);
      else if (schedView === 'month') d.setMonth(d.getMonth() + 1);
      else d.setFullYear(d.getFullYear() + 1);
      setSchedNavDate(d);
    };
    let navLabel = '';
    if (schedView === 'day') {
      navLabel = schedNavDate.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
    } else if (schedView === 'week') {
      const mon = getMonday(schedNavDate);
      const sun = new Date(mon); sun.setDate(sun.getDate() + 6);
      navLabel = `${mon.getFullYear()}年${mon.getMonth()+1}月${mon.getDate()}日 〜 ${sun.getMonth()+1}月${sun.getDate()}日`;
    } else if (schedView === 'month') {
      navLabel = `${schedNavDate.getFullYear()}年${schedNavDate.getMonth()+1}月`;
    } else {
      navLabel = `${schedNavDate.getFullYear()}年`;
    }

    return (
      <View style={styles.container}>
        {renderHeader('📅 予定表',
          <TouchableOpacity style={styles.schedAddBtn} onPress={() => openAddEvent()}>
            <Text style={styles.schedAddBtnText}>＋ 予定</Text>
          </TouchableOpacity>
        )}

        {/* ビュー切り替えタブ */}
        <View style={styles.viewTabs}>
          {(['day', 'week', 'month', 'year'] as const).map(v => (
            <TouchableOpacity key={v} style={[styles.viewTab, schedView === v && styles.viewTabActive]} onPress={() => setSchedView(v)}>
              <Text style={[styles.viewTabText, schedView === v && styles.viewTabTextActive]}>
                {v === 'day' ? '日' : v === 'week' ? '週' : v === 'month' ? '月' : '年'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* メンバー選択 */}
        <View style={styles.schedControlRow}>
          <TouchableOpacity style={styles.memberPicker} onPress={() => setShowMemberPicker(true)}>
            <Text style={styles.memberPickerText} numberOfLines={1}>
              {schedFilterUser === 'all' ? '全員' : schedMembers.find(m => m.id === schedFilterUser)?.display_name ?? '全員'}
            </Text>
            <Text style={styles.memberPickerArrow}>▼</Text>
          </TouchableOpacity>
          {schedFilterUser !== 'all' && <Text style={styles.memberPickerLabel}>さんの予定</Text>}
        </View>

        {/* メンバー選択モーダル */}
        <Modal visible={showMemberPicker} transparent animationType="fade" onRequestClose={() => setShowMemberPicker(false)}>
          <TouchableOpacity style={styles.memberDropdownOverlay} activeOpacity={1} onPress={() => setShowMemberPicker(false)}>
            <View style={styles.memberDropdown}>
              <ScrollView style={{ maxHeight: 300 }}>
                <TouchableOpacity style={[styles.memberDropdownItem, schedFilterUser === 'all' && styles.memberDropdownItemActive]} onPress={() => { setSchedFilterUser('all'); setShowMemberPicker(false); }}>
                  <Text style={[styles.memberDropdownText, schedFilterUser === 'all' && styles.memberDropdownTextActive]}>全員</Text>
                </TouchableOpacity>
                {schedMembers.map(m => (
                  <TouchableOpacity key={m.id} style={[styles.memberDropdownItem, schedFilterUser === m.id && styles.memberDropdownItemActive]} onPress={() => { setSchedFilterUser(m.id); setShowMemberPicker(false); }}>
                    <Text style={[styles.memberDropdownText, schedFilterUser === m.id && styles.memberDropdownTextActive]}>{m.display_name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </TouchableOpacity>
        </Modal>

        <View style={styles.weekNav}>
          <TouchableOpacity style={styles.weekNavBtn} onPress={navPrev}>
            <Text style={styles.weekNavBtnText}>◀</Text>
          </TouchableOpacity>
          <TouchableOpacity style={{ flex: 1, alignItems: 'center' }} onPress={() => setSchedNavDate(new Date())}>
            <Text style={styles.weekLabel}>{navLabel}</Text>
            <Text style={{ fontSize: 10, color: '#94A3B8' }}>タップで今日へ</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.weekNavBtn} onPress={navNext}>
            <Text style={styles.weekNavBtnText}>▶</Text>
          </TouchableOpacity>
        </View>

        {loadingSched ? <ActivityIndicator style={{ marginTop: 40 }} color="#8B5CF6" /> : (() => {
          const filteredMembers = schedFilterUser === 'all' ? schedMembers : schedMembers.filter(m => m.id === schedFilterUser);
          const filteredEvents = schedFilterUser === 'all' ? schedEvents : schedEvents.filter(e => e.user_id === schedFilterUser);
          return (
          <>
            {/* ── 日（横時間軸） ── */}
            {schedView === 'day' && (() => {
              const ds = dateStr(schedNavDate);
              const HOUR_W = 80;
              const allDayEvs = filteredEvents.filter(e => e.event_date === ds && !e.start_time);
              const timedEvs = filteredEvents.filter(e => e.event_date === ds && e.start_time);
              const ROW_H = 56;
              return (
                <ScrollView style={{ flex: 1 }}>
                  {/* 終日イベント */}
                  {allDayEvs.length > 0 && (
                    <View style={styles.dayAllDayArea}>
                      <Text style={styles.dayAllDayLabel}>終日</Text>
                      <View style={styles.dayAllDayEvents}>
                        {allDayEvs.map(ev => {
                          const c = EVENT_TYPE_COLORS[ev.event_type];
                          const memberName = filteredMembers.find(m => m.id === ev.user_id)?.display_name ?? '';
                          return (
                            <TouchableOpacity key={ev.id} style={[styles.dayAllDayChip, { backgroundColor: c.bg, borderColor: c.border }]} onPress={() => openEditEvent(ev)}>
                              <Text style={{ fontSize: 12, color: c.text, fontWeight: '600' }} numberOfLines={1}>
                                {schedFilterUser === 'all' ? `[${memberName}] ` : ''}{ev.title}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>
                  )}
                  {/* 横スクロール時間軸 */}
                  <ScrollView horizontal showsHorizontalScrollIndicator>
                    <View>
                      {/* 時間ヘッダー行（0〜24） */}
                      <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#CBD5E1', backgroundColor: '#F8FAFC' }}>
                        <View style={styles.dayMemberCol} />
                        {Array.from({ length: 25 }, (_, h) => (
                          <View key={h} style={{ width: HOUR_W, alignItems: 'flex-start', paddingVertical: 6, borderLeftWidth: 1, borderLeftColor: '#E2E8F0' }}>
                            <Text style={{ fontSize: 11, fontWeight: '700', color: '#64748B', paddingLeft: 4 }}>{h}</Text>
                          </View>
                        ))}
                      </View>
                      {/* メンバー行 */}
                      {filteredMembers.map(member => {
                        const memberEvs = timedEvs.filter(e => e.user_id === member.id);
                        return (
                          <View key={member.id} style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#E2E8F0', minHeight: ROW_H }}>
                            <View style={styles.dayMemberCol}>
                              <Text style={styles.dayMemberColText} numberOfLines={2}>{member.display_name}</Text>
                            </View>
                            <View style={{ width: 25 * HOUR_W, position: 'relative' }}>
                              {/* 縦線（時間区切り） */}
                              {Array.from({ length: 25 }, (_, h) => (
                                <View key={h} style={{ position: 'absolute', left: h * HOUR_W, top: 0, bottom: 0, width: 1, backgroundColor: h % 6 === 0 ? '#CBD5E1' : '#F1F5F9' }} />
                              ))}
                              {/* タップで予定追加 */}
                              <TouchableOpacity style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} activeOpacity={0.6}
                                onPress={() => openAddEvent(member.id, ds)} />
                              {/* イベントバー */}
                              {memberEvs.map(ev => {
                                const c = EVENT_TYPE_COLORS[ev.event_type];
                                const [sh, sm] = (ev.start_time ?? '8:00').split(':').map(Number);
                                const [eh, em] = (ev.end_time ?? `${sh + 1}:00`).split(':').map(Number);
                                const left = (sh + sm / 60) * HOUR_W;
                                const width = Math.max(((eh - sh) * 60 + (em - sm)) / 60 * HOUR_W, 40);
                                return (
                                  <TouchableOpacity key={ev.id}
                                    style={[styles.dayHBar, { left, width, backgroundColor: c.bg, borderColor: c.border }]}
                                    onPress={() => openEditEvent(ev)}
                                  >
                                    <Text style={{ fontSize: 10, color: c.text, fontWeight: '600' }} numberOfLines={1}>
                                      {ev.start_time?.slice(0,5)}-{ev.end_time?.slice(0,5)}
                                    </Text>
                                    <Text style={{ fontSize: 11, color: c.text, fontWeight: '700' }} numberOfLines={1}>{ev.title}</Text>
                                  </TouchableOpacity>
                                );
                              })}
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  </ScrollView>
                </ScrollView>
              );
            })()}

            {/* ── 週 ── */}
            {schedView === 'week' && (() => {
              const mon = getMonday(schedNavDate);
              const weekDays = Array.from({ length: 7 }, (_, i) => { const d = new Date(mon); d.setDate(d.getDate() + i); return d; });
              return (
                <ScrollView style={{ flex: 1 }}>
                  <ScrollView horizontal showsHorizontalScrollIndicator>
                    <View>
                      <View style={styles.schedHeaderRow}>
                        <View style={styles.schedMemberCell}><Text style={styles.schedMemberHeader}>メンバー</Text></View>
                        {weekDays.map((day, i) => (
                          <View key={i} style={[styles.schedDayHeader, isToday(day) && styles.schedDayHeaderToday]}>
                            <Text style={[styles.schedDayName, i === 5 && { color: '#3B82F6' }, i === 6 && { color: '#EF4444' }, isToday(day) && { color: '#fff' }]}>{DAY_NAMES[day.getDay()]}</Text>
                            <Text style={[styles.schedDayDate, isToday(day) && { color: '#fff' }]}>{day.getDate()}</Text>
                          </View>
                        ))}
                      </View>
                      {filteredMembers.map(member => (
                        <View key={member.id} style={styles.schedMemberRow}>
                          <View style={styles.schedMemberCell}><Text style={styles.schedMemberName} numberOfLines={2}>{member.display_name}</Text></View>
                          {weekDays.map((day, i) => {
                            const dayEvs = filteredEvents.filter(e => e.user_id === member.id && e.event_date === dateStr(day));
                            return (
                              <TouchableOpacity key={i} style={[styles.schedDayCell, isToday(day) && styles.schedDayCellToday, i === 5 && { backgroundColor: '#F8FAFF' }, i === 6 && { backgroundColor: '#FFF8F8' }]} onPress={() => openAddEvent(member.id, dateStr(day))}>
                                {dayEvs.map(ev => {
                                  const c = EVENT_TYPE_COLORS[ev.event_type];
                                  return (
                                    <TouchableOpacity key={ev.id} style={[styles.schedEventChip, { backgroundColor: c.bg, borderColor: c.border }]} onPress={(e) => { (e as any).stopPropagation?.(); openEditEvent(ev); }}>
                                      <Text style={[styles.schedEventChipText, { color: c.text }]} numberOfLines={2}>
                                        {ev.start_time ? `${ev.start_time.slice(0,5)}${ev.end_time ? `-${ev.end_time.slice(0,5)}` : ''}\n` : ''}
                                        {ev.title}
                                      </Text>
                                    </TouchableOpacity>
                                  );
                                })}
                                <View style={styles.schedPlusBtn}><Text style={styles.schedPlusBtnText}>＋</Text></View>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      ))}
                    </View>
                  </ScrollView>

                  {/* メンバー別リストボックス */}
                  <View style={styles.listBoxSection}>
                    <Text style={styles.listBoxSectionTitle}>📋 予定一覧</Text>
                    {filteredMembers.map(member => {
                      const memEvs = filteredEvents.filter(e => e.user_id === member.id).sort((a, b) => a.event_date.localeCompare(b.event_date) || (a.start_time ?? '').localeCompare(b.start_time ?? ''));
                      return (
                        <View key={member.id} style={styles.listBox}>
                          <View style={styles.listBoxHeader}>
                            <Text style={styles.listBoxMemberName}>{member.display_name}</Text>
                            <TouchableOpacity style={styles.listBoxAddBtn} onPress={() => openAddEvent(member.id)}>
                              <Text style={styles.listBoxAddBtnText}>＋</Text>
                            </TouchableOpacity>
                          </View>
                          {memEvs.length === 0
                            ? <Text style={styles.listBoxEmpty}>予定なし</Text>
                            : memEvs.map(ev => {
                              const c = EVENT_TYPE_COLORS[ev.event_type];
                              const d = new Date(ev.event_date + 'T00:00:00');
                              return (
                                <TouchableOpacity key={ev.id} style={[styles.listBoxItem, { borderLeftColor: c.border }]} onPress={() => openEditEvent(ev)}>
                                  <View style={styles.listBoxDateCol}>
                                    <Text style={styles.listBoxDateNum}>{d.getDate()}</Text>
                                    <Text style={styles.listBoxDateDay}>{DAY_NAMES[d.getDay()]}</Text>
                                  </View>
                                  <View style={{ flex: 1 }}>
                                    <Text style={styles.listBoxItemTitle} numberOfLines={1}>{ev.title}</Text>
                                    <Text style={styles.listBoxItemTime}>
                                      {ev.start_time ? `${ev.start_time.slice(0,5)}${ev.end_time ? ` 〜 ${ev.end_time.slice(0,5)}` : ''}` : '終日'}
                                    </Text>
                                  </View>
                                  <View style={[styles.listBoxTypeBadge, { backgroundColor: c.bg, borderColor: c.border }]}>
                                    <Text style={[styles.listBoxTypeBadgeText, { color: c.text }]}>{ev.event_type}</Text>
                                  </View>
                                </TouchableOpacity>
                              );
                            })
                          }
                        </View>
                      );
                    })}
                  </View>
                </ScrollView>
              );
            })()}

            {/* ── 月 ── */}
            {schedView === 'month' && (() => {
              const y = schedNavDate.getFullYear(), m = schedNavDate.getMonth();
              const firstDay = new Date(y, m, 1);
              const lastDate = new Date(y, m + 1, 0).getDate();
              const startOffset = firstDay.getDay();
              const cells: (number | null)[] = [];
              for (let i = 0; i < startOffset; i++) cells.push(null);
              for (let d = 1; d <= lastDate; d++) cells.push(d);
              while (cells.length % 7 !== 0) cells.push(null);
              const rows: (number | null)[][] = [];
              for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
              return (
                <ScrollView style={{ flex: 1 }}>
                  <View style={styles.monthHeaderRow}>
                    {DAY_NAMES.map((d, i) => (
                      <View key={i} style={styles.monthDayHeaderCell}>
                        <Text style={[styles.monthDayHeaderText, i === 0 && { color: '#EF4444' }, i === 6 && { color: '#3B82F6' }]}>{d}</Text>
                      </View>
                    ))}
                  </View>
                  {rows.map((row, ri) => (
                    <View key={ri} style={styles.monthRow}>
                      {row.map((day, ci) => {
                        if (!day) return <View key={ci} style={styles.monthCell} />;
                        const ds = `${y}-${String(m+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
                        const dayEvs = filteredEvents.filter(e => e.event_date === ds);
                        const today = ds === dateStr(new Date());
                        return (
                          <TouchableOpacity key={ci} style={[styles.monthCell, today && styles.monthCellToday]} onPress={() => openAddEvent(undefined, ds)}>
                            <Text style={[styles.monthCellDate, today && styles.monthCellDateToday, ci === 0 && !today && { color: '#EF4444' }, ci === 6 && !today && { color: '#3B82F6' }]}>{day}</Text>
                            {dayEvs.slice(0, 3).map(ev => {
                              const c = EVENT_TYPE_COLORS[ev.event_type];
                              return (
                                <TouchableOpacity key={ev.id} style={[styles.monthEventChip, { backgroundColor: c.bg }]} onPress={(e) => { (e as any).stopPropagation?.(); openEditEvent(ev); }}>
                                  <Text style={[styles.monthEventChipText, { color: c.text }]} numberOfLines={1}>{ev.title}</Text>
                                </TouchableOpacity>
                              );
                            })}
                            {dayEvs.length > 3 && <Text style={styles.monthMoreText}>+{dayEvs.length - 3}</Text>}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ))}

                  {/* メンバー別リストボックス */}
                  <View style={styles.listBoxSection}>
                    <Text style={styles.listBoxSectionTitle}>📋 予定一覧</Text>
                    {filteredMembers.map(member => {
                      const memEvs = filteredEvents.filter(e => e.user_id === member.id).sort((a, b) => a.event_date.localeCompare(b.event_date) || (a.start_time ?? '').localeCompare(b.start_time ?? ''));
                      return (
                        <View key={member.id} style={styles.listBox}>
                          <View style={styles.listBoxHeader}>
                            <Text style={styles.listBoxMemberName}>{member.display_name}</Text>
                            <TouchableOpacity style={styles.listBoxAddBtn} onPress={() => openAddEvent(member.id)}>
                              <Text style={styles.listBoxAddBtnText}>＋</Text>
                            </TouchableOpacity>
                          </View>
                          {memEvs.length === 0
                            ? <Text style={styles.listBoxEmpty}>予定なし</Text>
                            : memEvs.map(ev => {
                              const c = EVENT_TYPE_COLORS[ev.event_type];
                              const d = new Date(ev.event_date + 'T00:00:00');
                              return (
                                <TouchableOpacity key={ev.id} style={[styles.listBoxItem, { borderLeftColor: c.border }]} onPress={() => openEditEvent(ev)}>
                                  <View style={styles.listBoxDateCol}>
                                    <Text style={styles.listBoxDateNum}>{d.getDate()}</Text>
                                    <Text style={styles.listBoxDateDay}>{DAY_NAMES[d.getDay()]}</Text>
                                  </View>
                                  <View style={{ flex: 1 }}>
                                    <Text style={styles.listBoxItemTitle} numberOfLines={1}>{ev.title}</Text>
                                    <Text style={styles.listBoxItemTime}>
                                      {ev.start_time ? `${ev.start_time.slice(0,5)}${ev.end_time ? ` 〜 ${ev.end_time.slice(0,5)}` : ''}` : '終日'}
                                    </Text>
                                  </View>
                                  <View style={[styles.listBoxTypeBadge, { backgroundColor: c.bg, borderColor: c.border }]}>
                                    <Text style={[styles.listBoxTypeBadgeText, { color: c.text }]}>{ev.event_type}</Text>
                                  </View>
                                </TouchableOpacity>
                              );
                            })
                          }
                        </View>
                      );
                    })}
                  </View>
                </ScrollView>
              );
            })()}

            {/* ── 年 ── */}
            {schedView === 'year' && (() => {
              const y = schedNavDate.getFullYear();
              return (
                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 8 }}>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {Array.from({ length: 12 }, (_, mi) => {
                      const firstDay = new Date(y, mi, 1);
                      const lastDate = new Date(y, mi + 1, 0).getDate();
                      const startOffset = firstDay.getDay();
                      const cells: (number | null)[] = [];
                      for (let i = 0; i < startOffset; i++) cells.push(null);
                      for (let d = 1; d <= lastDate; d++) cells.push(d);
                      while (cells.length % 7 !== 0) cells.push(null);
                      const rows: (number | null)[][] = [];
                      for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
                      return (
                        <View key={mi} style={styles.yearMonthBox}>
                          <TouchableOpacity onPress={() => { const d = new Date(y, mi, 1); setSchedNavDate(d); setSchedView('month'); }}>
                            <Text style={styles.yearMonthTitle}>{mi + 1}月</Text>
                          </TouchableOpacity>
                          <View style={styles.yearDayHeaderRow}>
                            {DAY_NAMES.map((d, i) => <Text key={i} style={[styles.yearDayHeader, i === 0 && { color: '#EF4444' }, i === 6 && { color: '#3B82F6' }]}>{d}</Text>)}
                          </View>
                          {rows.map((row, ri) => (
                            <View key={ri} style={styles.yearWeekRow}>
                              {row.map((day, ci) => {
                                if (!day) return <View key={ci} style={styles.yearDayCell} />;
                                const ds = `${y}-${String(mi+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
                                const evCount = filteredEvents.filter(e => e.event_date === ds).length;
                                const today = ds === dateStr(new Date());
                                const firstEv = filteredEvents.find(e => e.event_date === ds);
                                const dotColor = firstEv ? EVENT_TYPE_COLORS[firstEv.event_type].text : '#8B5CF6';
                                return (
                                  <TouchableOpacity key={ci} style={[styles.yearDayCell, today && styles.yearDayCellToday]} onPress={() => { setSchedNavDate(new Date(y, mi, day)); setSchedView('day'); }}>
                                    <Text style={[styles.yearDayNum, today && styles.yearDayNumToday, ci === 0 && !today && { color: '#EF4444' }, ci === 6 && !today && { color: '#3B82F6' }]}>{day}</Text>
                                    {evCount > 0 && <View style={[styles.yearEventDot, { backgroundColor: dotColor }]} />}
                                  </TouchableOpacity>
                                );
                              })}
                            </View>
                          ))}
                        </View>
                      );
                    })}
                  </View>

                  {/* メンバー別リストボックス */}
                  <View style={styles.listBoxSection}>
                    <Text style={styles.listBoxSectionTitle}>📋 予定一覧</Text>
                    {filteredMembers.map(member => {
                      const memEvs = filteredEvents.filter(e => e.user_id === member.id).sort((a, b) => a.event_date.localeCompare(b.event_date) || (a.start_time ?? '').localeCompare(b.start_time ?? ''));
                      return (
                        <View key={member.id} style={styles.listBox}>
                          <View style={styles.listBoxHeader}>
                            <Text style={styles.listBoxMemberName}>{member.display_name}</Text>
                            <TouchableOpacity style={styles.listBoxAddBtn} onPress={() => openAddEvent(member.id)}>
                              <Text style={styles.listBoxAddBtnText}>＋</Text>
                            </TouchableOpacity>
                          </View>
                          {memEvs.length === 0
                            ? <Text style={styles.listBoxEmpty}>予定なし</Text>
                            : memEvs.map(ev => {
                              const c = EVENT_TYPE_COLORS[ev.event_type];
                              const d = new Date(ev.event_date + 'T00:00:00');
                              return (
                                <TouchableOpacity key={ev.id} style={[styles.listBoxItem, { borderLeftColor: c.border }]} onPress={() => openEditEvent(ev)}>
                                  <View style={styles.listBoxDateCol}>
                                    <Text style={styles.listBoxDateNum}>{`${d.getMonth()+1}/${d.getDate()}`}</Text>
                                    <Text style={styles.listBoxDateDay}>{DAY_NAMES[d.getDay()]}</Text>
                                  </View>
                                  <View style={{ flex: 1 }}>
                                    <Text style={styles.listBoxItemTitle} numberOfLines={1}>{ev.title}</Text>
                                    <Text style={styles.listBoxItemTime}>
                                      {ev.start_time ? `${ev.start_time.slice(0,5)}${ev.end_time ? ` 〜 ${ev.end_time.slice(0,5)}` : ''}` : '終日'}
                                    </Text>
                                  </View>
                                  <View style={[styles.listBoxTypeBadge, { backgroundColor: c.bg, borderColor: c.border }]}>
                                    <Text style={[styles.listBoxTypeBadgeText, { color: c.text }]}>{ev.event_type}</Text>
                                  </View>
                                </TouchableOpacity>
                              );
                            })
                          }
                        </View>
                      );
                    })}
                  </View>
                </ScrollView>
              );
            })()}
          </>
        ); })()}

        {/* 予定追加/編集モーダル */}
        <Modal visible={eventModal} transparent animationType="slide" onRequestClose={() => setEventModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalSheet, { paddingBottom: 40 }]}>
              <View style={styles.modalTop}>
                <Text style={styles.modalTitle}>{editingEvent ? '予定を編集' : '予定を追加'}</Text>
                <TouchableOpacity onPress={() => setEventModal(false)}><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
              </View>
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={styles.fLabel}>タイトル *</Text>
                <TextInput style={styles.fInput} value={evTitle} onChangeText={setEvTitle} placeholder="例: 営業会議" />

                <Text style={styles.fLabel}>種別</Text>
                <View style={styles.segRow}>
                  {EVENT_TYPES.map(t => {
                    const c = EVENT_TYPE_COLORS[t];
                    return (
                      <TouchableOpacity key={t}
                        style={[styles.seg, evType === t && { backgroundColor: c.bg, borderColor: c.border }]}
                        onPress={() => setEvType(t)}
                      >
                        <Text style={[styles.segText, evType === t && { color: c.text, fontWeight: 'bold' }]}>{t}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={styles.fLabel}>日付 (YYYY-MM-DD)</Text>
                <TextInput style={styles.fInput} value={evDate} onChangeText={setEvDate} placeholder="例: 2026-04-07" keyboardType="numbers-and-punctuation" />

                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fLabel}>開始時刻 (HH:MM)</Text>
                    <TextInput style={styles.fInput} value={evStart} onChangeText={setEvStart} placeholder="09:00" keyboardType="numbers-and-punctuation" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fLabel}>終了時刻 (HH:MM)</Text>
                    <TextInput style={styles.fInput} value={evEnd} onChangeText={setEvEnd} placeholder="10:00" keyboardType="numbers-and-punctuation" />
                  </View>
                </View>

                {isAdmin ? (
                  <>
                    <Text style={styles.fLabel}>対象メンバー（複数選択可）</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                      {schedMembers.map(m => {
                        const selected = evUserIds.includes(m.id);
                        return (
                          <TouchableOpacity
                            key={m.id}
                            style={[styles.assignChip, selected && styles.assignChipActive]}
                            onPress={() => setEvUserIds(prev =>
                              prev.includes(m.id) ? prev.filter(id => id !== m.id) : [...prev, m.id]
                            )}
                          >
                            <Text style={[styles.assignChipText, selected && styles.assignChipTextActive]}>
                              {selected ? '✓ ' : ''}{m.display_name}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </>
                ) : null}

                <Text style={styles.fLabel}>メモ</Text>
                <TextInput style={[styles.fInput, styles.fTextArea]} value={evMemo} onChangeText={setEvMemo} placeholder="備考・詳細など" multiline />

                <View style={styles.modalBtns}>
                  {editingEvent && (
                    <TouchableOpacity style={[styles.cancelBtn, { backgroundColor: '#FEF2F2', borderColor: '#FECACA' }]} onPress={() => { setEventModal(false); deleteEvent(editingEvent); }}>
                      <Text style={[styles.cancelBtnText, { color: '#DC2626' }]}>🗑 削除</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => setEventModal(false)}>
                    <Text style={styles.cancelBtnText}>キャンセル</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.submitBtn, { backgroundColor: '#8B5CF6' }, savingEvent && { opacity: 0.6 }]} onPress={saveEvent} disabled={savingEvent}>
                    <Text style={styles.submitBtnText}>{savingEvent ? '保存中...' : '保存'}</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  // ═══════════════════════════════════════════════════════════
  // MAIL
  // ═══════════════════════════════════════════════════════════
  if (screen === 'mail') {
    return (
      <View style={styles.container}>
        {renderHeader('✉️ メール',
          <TouchableOpacity style={[styles.headerAddBtn, { backgroundColor: '#0891B2' }]} onPress={openComposeMail}>
            <Text style={styles.headerAddBtnText}>✏️ 作成</Text>
          </TouchableOpacity>
        )}

        {/* タブ */}
        <View style={styles.mailTabBar}>
          {([['inbox', `受信${unreadCount > 0 ? `(${unreadCount})` : ''}`], ['sent', '送信済'], ['draft', '下書き']] as [string, string][]).map(([k, l]) => (
            <TouchableOpacity key={k} style={[styles.mailTab, mailTab === k && styles.mailTabActive]} onPress={() => setMailTab(k as any)}>
              <Text style={[styles.mailTabText, mailTab === k && styles.mailTabTextActive]}>{l}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {loadingMail ? <ActivityIndicator style={{ marginTop: 40 }} color="#0891B2" /> : (
          <FlatList
            data={mails}
            keyExtractor={m => m.id}
            contentContainerStyle={{ paddingBottom: 40 }}
            ListEmptyComponent={<Text style={[styles.emptyText, { marginTop: 40 }]}>メールがありません</Text>}
            renderItem={({ item: m }) => {
              const toNames = m.recipients?.filter(r => r.recipient_type === 'to').map(r => r.display_name).join(', ') ?? '';
              return (
                <TouchableOpacity style={styles.mailItem} onPress={() => { setViewMail(m); if (mailTab === 'inbox') markAsRead(m.id); }}>
                  <View style={styles.mailItemLeft}>
                    <View style={[styles.mailAvatar, { backgroundColor: '#0891B2' }]}>
                      <Text style={styles.mailAvatarText}>{(mailTab === 'inbox' ? m.sender_name : toNames)?.charAt(0) ?? '?'}</Text>
                    </View>
                  </View>
                  <View style={styles.mailItemBody}>
                    <View style={styles.mailItemTop}>
                      <Text style={styles.mailItemFrom} numberOfLines={1}>
                        {mailTab === 'inbox' ? m.sender_name : `To: ${toNames}`}
                      </Text>
                      <Text style={styles.mailItemDate}>{(m.sent_at ?? m.created_at).slice(5, 16).replace('T', ' ')}</Text>
                    </View>
                    <Text style={styles.mailItemSubject} numberOfLines={1}>{m.subject}</Text>
                    <Text style={styles.mailItemPreview} numberOfLines={1}>{m.body.slice(0, 60)}</Text>
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        )}

        {/* メール閲覧モーダル */}
        <Modal visible={!!viewMail} transparent animationType="slide" onRequestClose={() => setViewMail(null)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalSheet, { maxHeight: '90%' }]}>
              <View style={styles.modalTop}>
                <Text style={styles.modalTitle}>メール</Text>
                <TouchableOpacity onPress={() => setViewMail(null)}><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
              </View>
              {viewMail && (
                <ScrollView showsVerticalScrollIndicator={false}>
                  <Text style={styles.mailViewSubject}>{viewMail.subject}</Text>
                  <View style={styles.mailViewMeta}>
                    <View style={styles.mailViewMetaRow}>
                      <Text style={styles.mailViewMetaLabel}>差出人</Text>
                      <Text style={styles.mailViewMetaVal}>{viewMail.sender_name}</Text>
                    </View>
                    <View style={styles.mailViewMetaRow}>
                      <Text style={styles.mailViewMetaLabel}>宛先</Text>
                      <Text style={styles.mailViewMetaVal}>{viewMail.recipients?.filter(r => r.recipient_type === 'to').map(r => r.display_name).join(', ')}</Text>
                    </View>
                    {viewMail.recipients?.some(r => r.recipient_type === 'cc') && (
                      <View style={styles.mailViewMetaRow}>
                        <Text style={styles.mailViewMetaLabel}>CC</Text>
                        <Text style={styles.mailViewMetaVal}>{viewMail.recipients?.filter(r => r.recipient_type === 'cc').map(r => r.display_name).join(', ')}</Text>
                      </View>
                    )}
                    <View style={styles.mailViewMetaRow}>
                      <Text style={styles.mailViewMetaLabel}>日時</Text>
                      <Text style={styles.mailViewMetaVal}>{(viewMail.sent_at ?? viewMail.created_at).slice(0, 16).replace('T', ' ')}</Text>
                    </View>
                  </View>
                  <View style={styles.mailViewBody}>
                    <Text style={styles.mailViewBodyText}>{viewMail.body}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                    {mailTab === 'inbox' && (
                      <TouchableOpacity style={[styles.submitBtn, { flex: 1, backgroundColor: '#0891B2' }]} onPress={() => openReplyMail(viewMail)}>
                        <Text style={styles.submitBtnText}>↩ 返信</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity style={[styles.cancelBtn, { flex: 1, backgroundColor: '#FEF2F2', borderColor: '#FECACA' }]} onPress={() => { if (window.confirm('このメールを削除しますか？')) deleteMail(viewMail); }}>
                      <Text style={[styles.cancelBtnText, { color: '#DC2626' }]}>🗑 削除</Text>
                    </TouchableOpacity>
                  </View>
                </ScrollView>
              )}
            </View>
          </View>
        </Modal>

        {/* メール作成モーダル */}
        <Modal visible={mailModal} transparent animationType="slide" onRequestClose={() => setMailModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalSheet, { maxHeight: '92%' }]}>
              <View style={styles.modalTop}>
                <Text style={styles.modalTitle}>メール作成</Text>
                <TouchableOpacity onPress={() => setMailModal(false)}><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
              </View>
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={styles.fLabel}>宛先 (To) *</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                  {mailMembers.filter(m => m.id !== currentUserId).map(m => {
                    const sel = mlTo.includes(m.id);
                    return (
                      <TouchableOpacity key={m.id} style={[styles.assignChip, sel && styles.assignChipActive]}
                        onPress={() => setMlTo(prev => sel ? prev.filter(id => id !== m.id) : [...prev, m.id])}>
                        <Text style={[styles.assignChipText, sel && styles.assignChipTextActive]}>{sel ? '✓ ' : ''}{m.display_name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={styles.fLabel}>CC（任意）</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                  {mailMembers.filter(m => m.id !== currentUserId && !mlTo.includes(m.id)).map(m => {
                    const sel = mlCc.includes(m.id);
                    return (
                      <TouchableOpacity key={m.id} style={[styles.assignChip, sel && { backgroundColor: '#06B6D4' }]}
                        onPress={() => setMlCc(prev => sel ? prev.filter(id => id !== m.id) : [...prev, m.id])}>
                        <Text style={[styles.assignChipText, sel && { color: '#fff', fontWeight: 'bold' }]}>{sel ? '✓ ' : ''}{m.display_name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={styles.fLabel}>件名 *</Text>
                <TextInput style={styles.fInput} value={mlSubject} onChangeText={setMlSubject} placeholder="件名を入力" />

                <Text style={styles.fLabel}>本文</Text>
                <TextInput style={[styles.fInput, { minHeight: 180, textAlignVertical: 'top' }]} value={mlBody} onChangeText={setMlBody} multiline placeholder="本文を入力" />

                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => setMailModal(false)}>
                    <Text style={styles.cancelBtnText}>キャンセル</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.submitBtn, { flex: 1, backgroundColor: '#94A3B8' }, savingMail && { opacity: 0.6 }]} onPress={() => sendMail(true)} disabled={savingMail}>
                    <Text style={styles.submitBtnText}>下書き</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.submitBtn, { flex: 1, backgroundColor: '#0891B2' }, savingMail && { opacity: 0.6 }]} onPress={() => sendMail(false)} disabled={savingMail}>
                    <Text style={styles.submitBtnText}>{savingMail ? '送信中...' : '✉️ 送信'}</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  // ═══════════════════════════════════════════════════════════
  // MY PAGE
  // ═══════════════════════════════════════════════════════════
  if (screen === 'mypage') {
    const ICON_OPTIONS = ['🔗', '📌', '📧', '📊', '📁', '🗓️', '💻', '🏢', '📝', '🔍', '💬', '🛒', '📰', '🎯', '⚙️', '🌐'];
    return (
      <View style={styles.container}>
        {renderHeader('⭐ マイページ',
          <TouchableOpacity style={[styles.headerAddBtn, { backgroundColor: '#F59E0B' }]} onPress={openAddBm}>
            <Text style={styles.headerAddBtnText}>＋ 追加</Text>
          </TouchableOpacity>
        )}

        {loadingBm ? <ActivityIndicator style={{ marginTop: 40 }} color="#F59E0B" /> : bookmarks.length === 0 ? (
          <View style={{ alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 }}>
            <Text style={{ fontSize: 48, marginBottom: 16 }}>⭐</Text>
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#333', marginBottom: 8 }}>よく使うサイトを登録しよう</Text>
            <Text style={{ fontSize: 13, color: '#999', textAlign: 'center', lineHeight: 20 }}>
              右上の「＋ 追加」ボタンからサイトを登録できます。{'\n'}登録したサイトはここからワンタップでアクセスできます。
            </Text>
          </View>
        ) : (
          <FlatList
            data={bookmarks}
            keyExtractor={item => item.id}
            numColumns={3}
            contentContainerStyle={{ padding: 12 }}
            columnWrapperStyle={{ gap: 10 }}
            ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: '#fff', borderRadius: 14, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#F1F5F9', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 2, minHeight: 100, justifyContent: 'center' }}
                onPress={() => Linking.openURL(item.url)}
                onLongPress={() => openEditBm(item)}
              >
                <Text style={{ fontSize: 32, marginBottom: 8 }}>{item.icon}</Text>
                <Text style={{ fontSize: 12, fontWeight: '600', color: '#333', textAlign: 'center' }} numberOfLines={2}>{item.title}</Text>
              </TouchableOpacity>
            )}
          />
        )}

        {/* 追加/編集モーダル */}
        <Modal visible={bmModal} transparent animationType="slide" onRequestClose={() => setBmModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalSheet}>
              <View style={styles.modalTop}>
                <Text style={styles.modalTitle}>{editBm ? 'サイト編集' : 'サイト追加'}</Text>
                <TouchableOpacity onPress={() => setBmModal(false)}><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
              </View>
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={styles.fLabel}>アイコン</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                  {ICON_OPTIONS.map(ic => (
                    <TouchableOpacity key={ic} style={{ width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: bmIcon === ic ? '#FEF3C7' : '#F8FAFC', borderWidth: bmIcon === ic ? 2 : 1, borderColor: bmIcon === ic ? '#F59E0B' : '#E2E8F0' }}
                      onPress={() => setBmIcon(ic)}>
                      <Text style={{ fontSize: 20 }}>{ic}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.fLabel}>タイトル *</Text>
                <TextInput style={styles.fInput} value={bmTitle} onChangeText={setBmTitle} placeholder="例: 勤怠システム" placeholderTextColor="#C0C0C0" />

                <Text style={styles.fLabel}>URL *</Text>
                <TextInput style={styles.fInput} value={bmUrl} onChangeText={setBmUrl} placeholder="https://..." placeholderTextColor="#C0C0C0" autoCapitalize="none" />

                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => setBmModal(false)}>
                    <Text style={styles.cancelBtnText}>キャンセル</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.submitBtn, { flex: 1, backgroundColor: '#F59E0B' }]} onPress={saveBm}>
                    <Text style={styles.submitBtnText}>{editBm ? '更新' : '追加'}</Text>
                  </TouchableOpacity>
                </View>

                {editBm && (
                  <TouchableOpacity style={{ marginTop: 12, paddingVertical: 12, alignItems: 'center', backgroundColor: '#FEF2F2', borderRadius: 10, borderWidth: 1, borderColor: '#FECACA' }}
                    onPress={() => { setBmModal(false); deleteBm(editBm); }}>
                    <Text style={{ color: '#DC2626', fontWeight: '700' }}>🗑 削除</Text>
                  </TouchableOpacity>
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  // ═══════════════════════════════════════════════════════════
  // EXTERNAL LINKS
  // ═══════════════════════════════════════════════════════════
  if (screen === 'extlinks') {
    return (
      <View style={styles.container}>
        {renderHeader('🔗 他機能',
          isAdmin ? (
            <TouchableOpacity style={[styles.headerAddBtn, { backgroundColor: '#6366F1' }]} onPress={openAddExt}>
              <Text style={styles.headerAddBtnText}>＋ 追加</Text>
            </TouchableOpacity>
          ) : undefined
        )}

        {loadingExt ? <ActivityIndicator style={{ marginTop: 40 }} color="#6366F1" /> : (
          <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 40 }}>
            {extLinks.length === 0 && <Text style={[styles.emptyText, { marginTop: 40 }]}>リンクがまだ登録されていません</Text>}

            <View style={styles.elGrid}>
              {extLinks.map(link => (
                <TouchableOpacity key={link.id} style={styles.elCard}
                  onPress={() => Linking.openURL(link.url).catch(() => alert('URLを開けませんでした'))}
                  onLongPress={() => isAdmin && openEditExt(link)}
                >
                  <View style={[styles.elIconBox, { backgroundColor: link.color + '18' }]}>
                    <Text style={styles.elIconText}>{link.icon}</Text>
                  </View>
                  <Text style={styles.elCardTitle} numberOfLines={2}>{link.title}</Text>
                  {link.description && <Text style={styles.elCardDesc} numberOfLines={2}>{link.description}</Text>}
                  <Text style={styles.elCardUrl} numberOfLines={1}>{link.url.replace(/^https?:\/\//, '').slice(0, 30)}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {isAdmin && extLinks.length > 0 && (
              <Text style={styles.elHint}>※ 長押しで編集・削除できます</Text>
            )}
          </ScrollView>
        )}

        {/* リンク追加/編集モーダル */}
        <Modal visible={extModal} transparent animationType="slide" onRequestClose={() => setExtModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalSheet}>
              <View style={styles.modalTop}>
                <Text style={styles.modalTitle}>{editExt ? 'リンク編集' : 'リンク追加'}</Text>
                <TouchableOpacity onPress={() => setExtModal(false)}><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
              </View>
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={styles.fLabel}>アイコン</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                  {EL_ICONS.map(ic => (
                    <TouchableOpacity key={ic} style={[styles.elIconBtn, elIcon === ic && styles.elIconBtnActive]} onPress={() => setElIcon(ic)}>
                      <Text style={{ fontSize: 20 }}>{ic}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.fLabel}>タイトル *</Text>
                <TextInput style={styles.fInput} value={elTitle} onChangeText={setElTitle} placeholder="例: Google スプレッドシート" />

                <Text style={styles.fLabel}>URL *</Text>
                <TextInput style={styles.fInput} value={elUrl} onChangeText={setElUrl} placeholder="https://docs.google.com/..." autoCapitalize="none" keyboardType="url" />

                <Text style={styles.fLabel}>説明（任意）</Text>
                <TextInput style={styles.fInput} value={elDesc} onChangeText={setElDesc} placeholder="例: 月報管理用シート" />

                <Text style={styles.fLabel}>カラー</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                  {EL_COLORS.map(c => (
                    <TouchableOpacity key={c} style={[styles.elColorBtn, { backgroundColor: c }, elColor === c && styles.elColorBtnActive]} onPress={() => setElColor(c)} />
                  ))}
                </View>

                {/* プレビュー */}
                <Text style={styles.fLabel}>プレビュー</Text>
                <View style={[styles.elPreview, { borderColor: elColor }]}>
                  <View style={[styles.elIconBox, { backgroundColor: elColor + '18' }]}>
                    <Text style={styles.elIconText}>{elIcon}</Text>
                  </View>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#1E293B' }}>{elTitle || 'タイトル'}</Text>
                  {elDesc ? <Text style={{ fontSize: 11, color: '#64748B' }}>{elDesc}</Text> : null}
                </View>

                <View style={styles.modalBtns}>
                  {editExt && (
                    <TouchableOpacity style={[styles.cancelBtn, { backgroundColor: '#FEF2F2', borderColor: '#FECACA' }]} onPress={() => { setExtModal(false); deleteExtLink(editExt); }}>
                      <Text style={[styles.cancelBtnText, { color: '#DC2626' }]}>🗑</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => setExtModal(false)}>
                    <Text style={styles.cancelBtnText}>キャンセル</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.submitBtn, { backgroundColor: '#6366F1' }, savingExt && { opacity: 0.6 }]} onPress={saveExtLink} disabled={savingExt}>
                    <Text style={styles.submitBtnText}>{savingExt ? '保存中...' : '保存'}</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  // ═══════════════════════════════════════════════════════════
  // BUSINESS CARDS
  // ═══════════════════════════════════════════════════════════
  if (screen === 'cards') {
    // 会社ごとにグループ化
    const grouped: Record<string, BusinessCard[]> = {};
    filteredBcards.forEach(c => {
      const key = c.company_name || '(会社名なし)';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(c);
    });

    return (
      <View style={styles.container}>
        {renderHeader('🪪 名刺共有',
          <TouchableOpacity style={[styles.headerAddBtn, { backgroundColor: '#14B8A6' }]} onPress={openAddBc}>
            <Text style={styles.headerAddBtnText}>＋ 登録</Text>
          </TouchableOpacity>
        )}

        {/* スプレッドシート連携: ヘッダー初期化ボタン（初回のみ必要） */}

        {/* AI撮影ボタン + 検索 */}
        <TouchableOpacity style={styles.bcScanBtn} onPress={scanBusinessCard} disabled={ocrLoading}>
          <Text style={styles.bcScanBtnIcon}>{ocrLoading ? '⏳' : '📷'}</Text>
          <Text style={styles.bcScanBtnText}>{ocrLoading ? 'AI読み取り中...' : '名刺を撮影してAI自動入力'}</Text>
        </TouchableOpacity>

        {/* 検索 */}
        <View style={styles.bcSearchBar}>
          <Text style={styles.bcSearchIcon}>🔍</Text>
          <TextInput style={styles.bcSearchInput} value={bcSearch} onChangeText={setBcSearch}
            placeholder="会社名・氏名・タグで検索" placeholderTextColor="#94A3B8" />
          {bcSearch ? <TouchableOpacity onPress={() => setBcSearch('')}><Text style={{ color: '#94A3B8', fontSize: 16 }}>✕</Text></TouchableOpacity> : null}
        </View>

        <Text style={styles.bcCount}>{filteredBcards.length}件の名刺</Text>

        {loadingBc ? <ActivityIndicator style={{ marginTop: 40 }} color="#14B8A6" /> : (
          <FlatList
            data={Object.entries(grouped)}
            keyExtractor={([k]) => k}
            contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
            ListEmptyComponent={<Text style={[styles.emptyText, { marginTop: 40 }]}>名刺がまだ登録されていません</Text>}
            renderItem={({ item: [company, cards] }) => (
              <View style={styles.bcCompanyGroup}>
                <Text style={styles.bcCompanyName}>🏢 {company}（{cards.length}）</Text>
                {cards.map(c => (
                  <TouchableOpacity key={c.id} style={styles.bcCard} onPress={() => setBcView(c)}>
                    <View style={styles.bcCardLeft}>
                      <View style={styles.bcCardAvatar}>
                        <Text style={styles.bcCardAvatarText}>{c.person_name.charAt(0)}</Text>
                      </View>
                    </View>
                    <View style={styles.bcCardInfo}>
                      <Text style={styles.bcCardPerson}>{c.person_name}</Text>
                      {c.title && <Text style={styles.bcCardTitle}>{c.title}{c.department ? ` / ${c.department}` : ''}</Text>}
                      {c.email && <Text style={styles.bcCardSub}>{c.email}</Text>}
                      {c.phone && <Text style={styles.bcCardSub}>{c.phone}</Text>}
                      {c.tags && <Text style={styles.bcCardTags}>{c.tags}</Text>}
                    </View>
                    <Text style={{ color: '#ccc', fontSize: 18 }}>›</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          />
        )}

        {/* 名刺詳細モーダル */}
        <Modal visible={!!bcView} transparent animationType="slide" onRequestClose={() => setBcView(null)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalSheet, { maxHeight: '90%' }]}>
              <View style={styles.modalTop}>
                <Text style={styles.modalTitle}>名刺詳細</Text>
                <TouchableOpacity onPress={() => setBcView(null)}><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
              </View>
              {bcView && (
                <ScrollView showsVerticalScrollIndicator={false}>
                  {/* カード風表示 */}
                  <View style={styles.bcDetailCard}>
                    <Text style={styles.bcDetailCompany}>{bcView.company_name}</Text>
                    {bcView.department && <Text style={styles.bcDetailDept}>{bcView.department}</Text>}
                    <Text style={styles.bcDetailPerson}>{bcView.person_name}</Text>
                    {bcView.title && <Text style={styles.bcDetailTitle}>{bcView.title}</Text>}
                    <View style={styles.bcDetailDivider} />
                    {bcView.phone && <View style={styles.bcDetailRow}><Text style={styles.bcDetailIcon}>📞</Text><Text style={styles.bcDetailVal}>{bcView.phone}</Text></View>}
                    {bcView.mobile && <View style={styles.bcDetailRow}><Text style={styles.bcDetailIcon}>📱</Text><Text style={styles.bcDetailVal}>{bcView.mobile}</Text></View>}
                    {bcView.email && <View style={styles.bcDetailRow}><Text style={styles.bcDetailIcon}>✉️</Text><Text style={styles.bcDetailVal}>{bcView.email}</Text></View>}
                    {bcView.address && <View style={styles.bcDetailRow}><Text style={styles.bcDetailIcon}>📍</Text><Text style={styles.bcDetailVal}>{bcView.address}</Text></View>}
                    {bcView.website && <View style={styles.bcDetailRow}><Text style={styles.bcDetailIcon}>🌐</Text><Text style={styles.bcDetailVal}>{bcView.website}</Text></View>}
                  </View>

                  {/* メモ・メタ */}
                  <View style={styles.bcDetailMeta}>
                    {bcView.met_date && <View style={styles.bcDetailRow}><Text style={styles.bcDetailMetaLabel}>会った日</Text><Text style={styles.bcDetailMetaVal}>{bcView.met_date}</Text></View>}
                    {bcView.met_location && <View style={styles.bcDetailRow}><Text style={styles.bcDetailMetaLabel}>場所</Text><Text style={styles.bcDetailMetaVal}>{bcView.met_location}</Text></View>}
                    {bcView.registrant && <View style={styles.bcDetailRow}><Text style={styles.bcDetailMetaLabel}>登録者</Text><Text style={styles.bcDetailMetaVal}>{bcView.registrant}</Text></View>}
                    {bcView.tags && <View style={styles.bcDetailRow}><Text style={styles.bcDetailMetaLabel}>タグ</Text><Text style={[styles.bcDetailMetaVal, { color: '#0D9488' }]}>{bcView.tags}</Text></View>}
                  </View>
                  {bcView.notes && (
                    <View style={styles.bcDetailNotes}>
                      <Text style={styles.bcDetailNotesLabel}>メモ</Text>
                      <Text style={styles.bcDetailNotesText}>{bcView.notes}</Text>
                    </View>
                  )}

                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                    {(bcView.registered_by === currentUserId || isAdmin) && (
                      <>
                        <TouchableOpacity style={[styles.submitBtn, { flex: 1, backgroundColor: '#14B8A6' }]} onPress={() => openEditBc(bcView)}>
                          <Text style={styles.submitBtnText}>✏️ 編集</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.cancelBtn, { flex: 1, backgroundColor: '#FEF2F2', borderColor: '#FECACA' }]} onPress={() => deleteBc(bcView)}>
                          <Text style={[styles.cancelBtnText, { color: '#DC2626' }]}>🗑 削除</Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                </ScrollView>
              )}
            </View>
          </View>
        </Modal>

        {/* 名刺登録/編集モーダル */}
        <Modal visible={bcModal} transparent animationType="slide" onRequestClose={() => setBcModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalSheet, { maxHeight: '92%' }]}>
              <View style={styles.modalTop}>
                <Text style={styles.modalTitle}>{editBc ? '名刺を編集' : '名刺を登録'}</Text>
                <TouchableOpacity onPress={() => setBcModal(false)}><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
              </View>
              <ScrollView showsVerticalScrollIndicator={false}>
                {!editBc && (
                  <TouchableOpacity style={styles.bcScanBtnSmall} onPress={() => { setBcModal(false); setTimeout(scanBusinessCard, 300); }} disabled={ocrLoading}>
                    <Text style={styles.bcScanBtnIcon}>{ocrLoading ? '⏳' : '📷'}</Text>
                    <Text style={styles.bcScanBtnSmallText}>{ocrLoading ? 'AI読み取り中...' : '名刺を撮影してAI自動入力'}</Text>
                  </TouchableOpacity>
                )}
                <Text style={styles.fLabel}>会社名 *</Text>
                <TextInput style={styles.fInput} value={bcCompany} onChangeText={setBcCompany} placeholder="株式会社〇〇" />
                <Text style={styles.fLabel}>部署</Text>
                <TextInput style={styles.fInput} value={bcDept} onChangeText={setBcDept} placeholder="営業部" />
                <Text style={styles.fLabel}>氏名 *</Text>
                <TextInput style={styles.fInput} value={bcPerson} onChangeText={setBcPerson} placeholder="山田 太郎" />
                <Text style={styles.fLabel}>役職</Text>
                <TextInput style={styles.fInput} value={bcTitle} onChangeText={setBcTitle} placeholder="部長" />

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fLabel}>電話</Text>
                    <TextInput style={styles.fInput} value={bcPhone} onChangeText={setBcPhone} placeholder="03-xxxx-xxxx" keyboardType="phone-pad" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fLabel}>携帯</Text>
                    <TextInput style={styles.fInput} value={bcMobile} onChangeText={setBcMobile} placeholder="090-xxxx-xxxx" keyboardType="phone-pad" />
                  </View>
                </View>

                <Text style={styles.fLabel}>メール</Text>
                <TextInput style={styles.fInput} value={bcEmail} onChangeText={setBcEmail} placeholder="yamada@example.com" keyboardType="email-address" />
                <Text style={styles.fLabel}>住所</Text>
                <TextInput style={styles.fInput} value={bcAddress} onChangeText={setBcAddress} placeholder="東京都..." />
                <Text style={styles.fLabel}>Webサイト</Text>
                <TextInput style={styles.fInput} value={bcWebsite} onChangeText={setBcWebsite} placeholder="https://..." />

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fLabel}>会った日</Text>
                    <TextInput style={styles.fInput} value={bcMetDate} onChangeText={setBcMetDate} placeholder="2026-04-07" keyboardType="numbers-and-punctuation" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fLabel}>場所</Text>
                    <TextInput style={styles.fInput} value={bcMetLocation} onChangeText={setBcMetLocation} placeholder="展示会等" />
                  </View>
                </View>

                <Text style={styles.fLabel}>タグ（カンマ区切り）</Text>
                <TextInput style={styles.fInput} value={bcTags} onChangeText={setBcTags} placeholder="例: 営業先, IT, 重要" />
                <Text style={styles.fLabel}>メモ</Text>
                <TextInput style={[styles.fInput, styles.fTextArea]} value={bcNotes} onChangeText={setBcNotes} multiline placeholder="補足情報など" />

                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => setBcModal(false)}>
                    <Text style={styles.cancelBtnText}>キャンセル</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.submitBtn, { flex: 1, backgroundColor: '#14B8A6' }, savingBc && { opacity: 0.6 }]} onPress={saveBc} disabled={savingBc}>
                    <Text style={styles.submitBtnText}>{savingBc ? '保存中...' : '保存'}</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  // ═══════════════════════════════════════════════════════════
  // GANTT
  // ═══════════════════════════════════════════════════════════
  if (screen === 'gantt') {
    const DAY_W = 36;
    const days = Array.from({ length: ganttDays }, (_, i) => { const d = new Date(ganttStart); d.setDate(d.getDate() + i); return d; });
    const todayDs = dateStr(new Date());

    const dayDiff = (a: string, b: string) => {
      return Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000);
    };

    return (
      <View style={styles.container}>
        {renderHeader('📊 ガントチャート',
          isAdmin ? (
            <TouchableOpacity style={[styles.headerAddBtn, { backgroundColor: '#0EA5E9' }]} onPress={openAddGProj}>
              <Text style={styles.headerAddBtnText}>＋ PJ</Text>
            </TouchableOpacity>
          ) : undefined
        )}

        {/* 期間ナビ */}
        <View style={styles.ganttNav}>
          <TouchableOpacity style={styles.ganttNavBtn} onPress={() => { const d = new Date(ganttStart); d.setDate(d.getDate() - 14); setGanttStart(d); }}>
            <Text style={styles.ganttNavBtnText}>◀ 2週</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { const d = new Date(); d.setDate(d.getDate() - 7); setGanttStart(d); }}>
            <Text style={styles.ganttNavLabel}>{days[0].getMonth()+1}/{days[0].getDate()} 〜 {days[days.length-1].getMonth()+1}/{days[days.length-1].getDate()}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.ganttNavBtn} onPress={() => { const d = new Date(ganttStart); d.setDate(d.getDate() + 14); setGanttStart(d); }}>
            <Text style={styles.ganttNavBtnText}>2週 ▶</Text>
          </TouchableOpacity>
        </View>

        {loadingGantt ? <ActivityIndicator style={{ marginTop: 40 }} color="#0EA5E9" /> : (
          <ScrollView style={{ flex: 1 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator>
              <View>
                {/* 月ヘッダー */}
                <View style={{ flexDirection: 'row' }}>
                  <View style={styles.ganttLabelCol} />
                  {(() => {
                    const months: { label: string; span: number }[] = [];
                    let cur = '';
                    days.forEach(d => {
                      const m = `${d.getFullYear()}/${d.getMonth()+1}`;
                      if (m !== cur) { months.push({ label: m, span: 1 }); cur = m; }
                      else months[months.length - 1].span++;
                    });
                    return months.map((m, i) => (
                      <View key={i} style={{ width: m.span * DAY_W, borderBottomWidth: 1, borderBottomColor: '#CBD5E1', backgroundColor: '#F0F9FF', paddingVertical: 4, alignItems: 'center' }}>
                        <Text style={{ fontSize: 10, fontWeight: '700', color: '#0369A1' }}>{m.label}</Text>
                      </View>
                    ));
                  })()}
                </View>
                {/* 日ヘッダー */}
                <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#CBD5E1' }}>
                  <View style={styles.ganttLabelCol}><Text style={styles.ganttLabelText}>タスク</Text></View>
                  {days.map((d, i) => {
                    const dow = d.getDay();
                    const isT = dateStr(d) === todayDs;
                    return (
                      <View key={i} style={[styles.ganttDayHeader, dow === 0 && { backgroundColor: '#FEF2F2' }, dow === 6 && { backgroundColor: '#EFF6FF' }, isT && { backgroundColor: '#DBEAFE' }]}>
                        <Text style={[styles.ganttDayHeaderText, dow === 0 && { color: '#EF4444' }, dow === 6 && { color: '#3B82F6' }, isT && { fontWeight: '800' }]}>{d.getDate()}</Text>
                        <Text style={[styles.ganttDowText, dow === 0 && { color: '#EF4444' }, dow === 6 && { color: '#3B82F6' }]}>{DAY_NAMES[dow]}</Text>
                      </View>
                    );
                  })}
                </View>

                {/* プロジェクト＋タスク行 */}
                {ganttProjects.map(proj => {
                  const projTasks = ganttTasks.filter(t => t.project_id === proj.id);
                  return (
                    <View key={proj.id}>
                      {/* プロジェクトヘッダー */}
                      <View style={{ flexDirection: 'row', backgroundColor: proj.color + '15', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' }}>
                        <TouchableOpacity style={[styles.ganttLabelCol, { flexDirection: 'row', alignItems: 'center', gap: 6 }]} onPress={() => isAdmin && openEditGProj(proj)}>
                          <View style={[styles.ganttProjDot, { backgroundColor: proj.color }]} />
                          <Text style={styles.ganttProjName} numberOfLines={1}>{proj.name}</Text>
                        </TouchableOpacity>
                        <View style={{ width: ganttDays * DAY_W, height: 32, justifyContent: 'center', paddingLeft: 8 }}>
                          {isAdmin && (
                            <View style={{ flexDirection: 'row', gap: 8 }}>
                              <TouchableOpacity onPress={() => openAddGTask(proj.id)}><Text style={{ fontSize: 11, color: '#0EA5E9', fontWeight: '700' }}>＋タスク</Text></TouchableOpacity>
                              <TouchableOpacity onPress={() => deleteGProj(proj)}><Text style={{ fontSize: 11, color: '#EF4444' }}>削除</Text></TouchableOpacity>
                            </View>
                          )}
                        </View>
                      </View>
                      {/* タスク行 */}
                      {projTasks.map(task => {
                        const startOff = dayDiff(dateStr(ganttStart), task.start_date);
                        const dur = dayDiff(task.start_date, task.end_date) + 1;
                        const left = startOff * DAY_W;
                        const width = dur * DAY_W;
                        const assigneeName = ganttMembers.find(m => m.id === task.assigned_to)?.display_name ?? '';
                        return (
                          <View key={task.id} style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#F1F5F9', minHeight: 36 }}>
                            <TouchableOpacity style={styles.ganttLabelCol} onPress={() => isAdmin && openEditGTask(task)}>
                              <Text style={styles.ganttTaskLabel} numberOfLines={1}>{task.title}</Text>
                              {assigneeName ? <Text style={styles.ganttTaskAssignee}>{assigneeName}</Text> : null}
                            </TouchableOpacity>
                            <View style={{ width: ganttDays * DAY_W, position: 'relative', height: 36 }}>
                              {/* 背景グリッド */}
                              {days.map((d, i) => {
                                const dow = d.getDay();
                                return <View key={i} style={{ position: 'absolute', left: i * DAY_W, top: 0, bottom: 0, width: DAY_W, borderRightWidth: 1, borderRightColor: '#F1F5F9', backgroundColor: dow === 0 ? '#FEF2F220' : dow === 6 ? '#EFF6FF20' : 'transparent' }} />;
                              })}
                              {/* 今日線 */}
                              {(() => { const tOff = dayDiff(dateStr(ganttStart), todayDs); return tOff >= 0 && tOff < ganttDays ? <View style={{ position: 'absolute', left: tOff * DAY_W + DAY_W / 2, top: 0, bottom: 0, width: 2, backgroundColor: '#EF444480' }} /> : null; })()}
                              {/* バー */}
                              {left + width > 0 && left < ganttDays * DAY_W && (
                                <TouchableOpacity
                                  style={[styles.ganttBar, { left: Math.max(left, 0), width: Math.min(width, ganttDays * DAY_W - Math.max(left, 0)), backgroundColor: proj.color + '30', borderColor: proj.color }]}
                                  onPress={() => isAdmin && openEditGTask(task)}
                                >
                                  {/* 進捗 */}
                                  <View style={[styles.ganttBarProgress, { width: `${task.progress}%`, backgroundColor: proj.color + '70' }]} />
                                  <Text style={[styles.ganttBarText, { color: proj.color }]} numberOfLines={1}>{task.progress}%</Text>
                                </TouchableOpacity>
                              )}
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  );
                })}
                {ganttProjects.length === 0 && <Text style={[styles.emptyText, { padding: 30 }]}>プロジェクトがありません</Text>}
              </View>
            </ScrollView>
          </ScrollView>
        )}

        {/* プロジェクト追加/編集モーダル */}
        <Modal visible={ganttProjModal} transparent animationType="slide" onRequestClose={() => setGanttProjModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalSheet}>
              <View style={styles.modalTop}>
                <Text style={styles.modalTitle}>{editGProj ? 'PJ編集' : 'PJ追加'}</Text>
                <TouchableOpacity onPress={() => setGanttProjModal(false)}><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
              </View>
              <Text style={styles.fLabel}>プロジェクト名 *</Text>
              <TextInput style={styles.fInput} value={gpName} onChangeText={setGpName} placeholder="例: Webサイトリニューアル" />
              <Text style={styles.fLabel}>カラー</Text>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                {GANTT_COLORS.map(c => (
                  <TouchableOpacity key={c} style={[styles.ganttColorBtn, { backgroundColor: c }, gpColor === c && styles.ganttColorBtnActive]} onPress={() => setGpColor(c)} />
                ))}
              </View>
              <View style={styles.modalBtns}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setGanttProjModal(false)}><Text style={styles.cancelBtnText}>キャンセル</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.submitBtn, { backgroundColor: '#0EA5E9' }, savingGantt && { opacity: 0.6 }]} onPress={saveGProj} disabled={savingGantt}>
                  <Text style={styles.submitBtnText}>{savingGantt ? '保存中...' : '保存'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* タスク追加/編集モーダル */}
        <Modal visible={ganttTaskModal} transparent animationType="slide" onRequestClose={() => setGanttTaskModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalSheet}>
              <View style={styles.modalTop}>
                <Text style={styles.modalTitle}>{editGTask ? 'タスク編集' : 'タスク追加'}</Text>
                <TouchableOpacity onPress={() => setGanttTaskModal(false)}><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
              </View>
              <ScrollView>
                <Text style={styles.fLabel}>タスク名 *</Text>
                <TextInput style={styles.fInput} value={gtTitle} onChangeText={setGtTitle} placeholder="例: デザイン作成" />

                <Text style={styles.fLabel}>プロジェクト</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                  {ganttProjects.map(p => (
                    <TouchableOpacity key={p.id} style={[styles.rpCatChip, gtProjId === p.id && { backgroundColor: p.color, borderColor: p.color }]} onPress={() => setGtProjId(p.id)}>
                      <Text style={[styles.rpCatChipText, gtProjId === p.id && { color: '#fff' }]}>{p.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.fLabel}>担当者</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                  <TouchableOpacity style={[styles.assignChip, !gtAssignee && styles.assignChipActive]} onPress={() => setGtAssignee(null)}>
                    <Text style={[styles.assignChipText, !gtAssignee && styles.assignChipTextActive]}>未定</Text>
                  </TouchableOpacity>
                  {ganttMembers.map(m => (
                    <TouchableOpacity key={m.id} style={[styles.assignChip, gtAssignee === m.id && styles.assignChipActive]} onPress={() => setGtAssignee(m.id)}>
                      <Text style={[styles.assignChipText, gtAssignee === m.id && styles.assignChipTextActive]}>{m.display_name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fLabel}>開始日</Text>
                    <TextInput style={styles.fInput} value={gtStart} onChangeText={setGtStart} placeholder="2026-04-07" keyboardType="numbers-and-punctuation" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fLabel}>終了日</Text>
                    <TextInput style={styles.fInput} value={gtEnd} onChangeText={setGtEnd} placeholder="2026-04-14" keyboardType="numbers-and-punctuation" />
                  </View>
                </View>

                <Text style={styles.fLabel}>進捗 ({gtProgress}%)</Text>
                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
                  {[0, 10, 25, 50, 75, 100].map(v => (
                    <TouchableOpacity key={v} style={[styles.rpCatChip, parseInt(gtProgress) === v && { backgroundColor: '#0EA5E9', borderColor: '#0EA5E9' }]} onPress={() => setGtProgress(String(v))}>
                      <Text style={[styles.rpCatChipText, parseInt(gtProgress) === v && { color: '#fff' }]}>{v}%</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <View style={styles.modalBtns}>
                  {editGTask && (
                    <TouchableOpacity style={[styles.cancelBtn, { backgroundColor: '#FEF2F2', borderColor: '#FECACA' }]} onPress={() => { setGanttTaskModal(false); deleteGTask(editGTask); }}>
                      <Text style={[styles.cancelBtnText, { color: '#DC2626' }]}>🗑</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => setGanttTaskModal(false)}><Text style={styles.cancelBtnText}>キャンセル</Text></TouchableOpacity>
                  <TouchableOpacity style={[styles.submitBtn, { backgroundColor: '#0EA5E9' }, savingGantt && { opacity: 0.6 }]} onPress={saveGTask} disabled={savingGantt}>
                    <Text style={styles.submitBtnText}>{savingGantt ? '保存中...' : '保存'}</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  // ═══════════════════════════════════════════════════════════
  // REPORTS
  // ═══════════════════════════════════════════════════════════
  if (screen === 'reports') {
    return (
      <View style={styles.container}>
        {renderHeader('📝 報告書',
          <TouchableOpacity style={[styles.headerAddBtn, { backgroundColor: '#EC4899' }]} onPress={openNewReport}>
            <Text style={styles.headerAddBtnText}>＋ 作成</Text>
          </TouchableOpacity>
        )}

        {/* フィルタ */}
        <View style={styles.rpFilterRow}>
          {([['mine', '自分の報告書'], ['draft', '下書き'], ...(isAdmin ? [['all', '全報告書']] : [])] as [string, string][]).map(([k, l]) => (
            <TouchableOpacity key={k} style={[styles.rpFilterChip, reportFilter === k && styles.rpFilterChipActive]} onPress={() => setReportFilter(k as any)}>
              <Text style={[styles.rpFilterChipText, reportFilter === k && styles.rpFilterChipTextActive]}>{l}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {loadingReports ? <ActivityIndicator style={{ marginTop: 40 }} color="#EC4899" /> : (
          <FlatList
            data={reports}
            keyExtractor={r => r.id}
            contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
            ListEmptyComponent={<Text style={[styles.emptyText, { marginTop: 40 }]}>報告書がありません</Text>}
            renderItem={({ item: r }) => {
              const sc = REPORT_STATUS_COLOR[r.status];
              return (
                <TouchableOpacity style={styles.rpCard} onPress={() => setViewReport(r)}>
                  <View style={styles.rpCardTop}>
                    <View style={[styles.rpStatusBadge, { backgroundColor: sc.bg }]}>
                      <Text style={[styles.rpStatusBadgeText, { color: sc.text }]}>{r.status}</Text>
                    </View>
                    <Text style={styles.rpCardCat}>{r.category}</Text>
                    <Text style={styles.rpCardDate}>{r.report_date}</Text>
                  </View>
                  <Text style={styles.rpCardTitle} numberOfLines={1}>{r.title}</Text>
                  <View style={styles.rpCardBottom}>
                    <Text style={styles.rpCardAuthor}>{r.profiles?.display_name ?? ''}</Text>
                    {r.content && <Text style={styles.rpCardPreview} numberOfLines={1}>{r.content.slice(0, 60)}</Text>}
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        )}

        {/* 報告書閲覧モーダル */}
        <Modal visible={!!viewReport} transparent animationType="slide" onRequestClose={() => setViewReport(null)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalSheet, { maxHeight: '92%' }]}>
              <View style={styles.modalTop}>
                <Text style={styles.modalTitle}>報告書</Text>
                <TouchableOpacity onPress={() => setViewReport(null)}><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
              </View>
              {viewReport && (
                <ScrollView showsVerticalScrollIndicator={false}>
                  {/* ヘッダー */}
                  <View style={styles.rpViewHeader}>
                    <Text style={styles.rpViewCat}>{viewReport.category}</Text>
                    <View style={[styles.rpStatusBadge, { backgroundColor: REPORT_STATUS_COLOR[viewReport.status].bg }]}>
                      <Text style={[styles.rpStatusBadgeText, { color: REPORT_STATUS_COLOR[viewReport.status].text }]}>{viewReport.status}</Text>
                    </View>
                  </View>

                  <Text style={styles.rpViewTitle}>{viewReport.title}</Text>

                  <View style={styles.rpViewMeta}>
                    <View style={styles.rpViewMetaRow}>
                      <Text style={styles.rpViewMetaLabel}>作成日</Text>
                      <Text style={styles.rpViewMetaVal}>{viewReport.report_date}</Text>
                    </View>
                    <View style={styles.rpViewMetaRow}>
                      <Text style={styles.rpViewMetaLabel}>作成者</Text>
                      <Text style={styles.rpViewMetaVal}>{viewReport.profiles?.display_name ?? ''}</Text>
                    </View>
                    {viewReport.participants && (
                      <View style={styles.rpViewMetaRow}>
                        <Text style={styles.rpViewMetaLabel}>参加者</Text>
                        <Text style={styles.rpViewMetaVal}>{viewReport.participants}</Text>
                      </View>
                    )}
                    {viewReport.external_participants && (
                      <View style={styles.rpViewMetaRow}>
                        <Text style={styles.rpViewMetaLabel}>社外</Text>
                        <Text style={[styles.rpViewMetaVal, { color: '#B45309' }]}>{viewReport.external_participants}</Text>
                      </View>
                    )}
                  </View>

                  {/* 本文 */}
                  <View style={styles.rpViewBody}>
                    <Text style={styles.rpViewBodyText}>{viewReport.content || '（本文なし）'}</Text>
                  </View>

                  {/* コメント */}
                  {viewReport.comment && (
                    <View style={styles.rpViewComment}>
                      <Text style={styles.rpViewCommentLabel}>コメント（{viewReport.approver?.display_name ?? '管理者'}）</Text>
                      <Text style={styles.rpViewCommentText}>{viewReport.comment}</Text>
                    </View>
                  )}

                  {/* アクション */}
                  <View style={{ gap: 8, marginTop: 12 }}>
                    {/* PDF保存 */}
                    <TouchableOpacity style={[styles.submitBtn, { backgroundColor: '#1E88E5' }]}
                      onPress={async () => {
                        const { data: { session } } = await supabase.auth.getSession();
                        if (!session) return;
                        alert('PDFを作成してGoogle Driveに保存中...');
                        try {
                          const resp = await fetch('https://nccognptoprhwsbjnwcu.supabase.co/functions/v1/export-report-pdf', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
                            body: JSON.stringify({ report_id: viewReport.id }),
                          });
                          const r = await resp.json();
                          if (r.success) alert(`✓ Google Driveに保存しました\n${r.file_name}`);
                          else alert('エラー: ' + (r.error ?? '不明'));
                        } catch (e: any) { alert('エラー: ' + e.message); }
                      }}>
                      <Text style={styles.submitBtnText}>📄 PDFをGoogle Driveに保存</Text>
                    </TouchableOpacity>

                    {/* 自分の報告書: 編集/削除 */}
                    {viewReport.author_id === currentUserId && (viewReport.status === '下書き' || viewReport.status === '差戻し') && (
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TouchableOpacity style={[styles.submitBtn, { flex: 1, backgroundColor: '#EC4899' }]} onPress={() => openEditReport(viewReport)}>
                          <Text style={styles.submitBtnText}>✏️ 編集</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.cancelBtn, { flex: 1, backgroundColor: '#FEF2F2', borderColor: '#FECACA' }]} onPress={() => deleteReport(viewReport)}>
                          <Text style={[styles.cancelBtnText, { color: '#DC2626' }]}>🗑 削除</Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    {/* 管理者: 承認/差戻し */}
                    {isAdmin && viewReport.status === '提出済' && (
                      <View style={{ gap: 8 }}>
                        <Text style={styles.fLabel}>コメント（任意）</Text>
                        <TextInput style={[styles.fInput, styles.fTextArea]} value={rpComment} onChangeText={setRpComment} multiline placeholder="フィードバックなど" />
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          <TouchableOpacity style={[styles.submitBtn, { flex: 1, backgroundColor: '#059669' }]} onPress={() => approveReport(viewReport, '承認済', rpComment)}>
                            <Text style={styles.submitBtnText}>✓ 承認</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={[styles.submitBtn, { flex: 1, backgroundColor: '#DC2626' }]} onPress={() => approveReport(viewReport, '差戻し', rpComment)}>
                            <Text style={styles.submitBtnText}>↩ 差戻し</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}
                  </View>
                </ScrollView>
              )}
            </View>
          </View>
        </Modal>

        {/* 報告書作成/編集モーダル */}
        <Modal visible={reportModal} transparent animationType="slide" onRequestClose={() => setReportModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalSheet, { maxHeight: '92%' }]}>
              <View style={styles.modalTop}>
                <Text style={styles.modalTitle}>{editingReport ? '報告書を編集' : '報告書を作成'}</Text>
                <TouchableOpacity onPress={() => setReportModal(false)}><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
              </View>
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={styles.fLabel}>種別</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                  {REPORT_CATS.map(c => (
                    <TouchableOpacity key={c} style={[styles.rpCatChip, rpCategory === c && styles.rpCatChipActive]} onPress={() => setRpCategory(c)}>
                      <Text style={[styles.rpCatChipText, rpCategory === c && styles.rpCatChipTextActive]}>{c}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.fLabel}>タイトル *</Text>
                <TextInput style={styles.fInput} value={rpTitle} onChangeText={setRpTitle} placeholder="例: 4/7 定例会議 議事録" />

                <Text style={styles.fLabel}>日付 (YYYY-MM-DD)</Text>
                <TextInput style={styles.fInput} value={rpDate} onChangeText={setRpDate} placeholder="2026-04-07" keyboardType="numbers-and-punctuation" />

                <Text style={styles.fLabel}>参加者・社内（任意）</Text>
                <TextInput style={styles.fInput} value={rpParticipants} onChangeText={setRpParticipants} placeholder="例: 小林, 佐藤, 田中" />

                <Text style={styles.fLabel}>打ち合わせ相手・社外（任意）</Text>
                <TextInput style={styles.fInput} value={rpExtParticipants} onChangeText={setRpExtParticipants} placeholder="例: 株式会社〇〇 山田様, △△商事 鈴木様" />

                <Text style={styles.fLabel}>本文</Text>
                <TextInput
                  style={[styles.fInput, { minHeight: 200, textAlignVertical: 'top' }]}
                  value={rpContent} onChangeText={setRpContent} multiline
                  placeholder={'■ 議題\n\n\n■ 決定事項\n\n\n■ 次回アクション\n'}
                />

                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => setReportModal(false)}>
                    <Text style={styles.cancelBtnText}>キャンセル</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.submitBtn, { flex: 1, backgroundColor: '#94A3B8' }, savingReport && { opacity: 0.6 }]} onPress={() => saveReport('下書き')} disabled={savingReport}>
                    <Text style={styles.submitBtnText}>下書き保存</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.submitBtn, { flex: 1, backgroundColor: '#EC4899' }, savingReport && { opacity: 0.6 }]} onPress={() => saveReport('提出済')} disabled={savingReport}>
                    <Text style={styles.submitBtnText}>提出</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  // ═══════════════════════════════════════════════════════════
  // ATTENDANCE ADMIN (管理ページ)
  // ═══════════════════════════════════════════════════════════
  if (screen === 'attend_admin' && hasPerm('attend_admin')) {
    const [aaY, aaM] = adminAttendMonth.split('-').map(Number);
    const aaWorkDays = adminRecords.filter(r => r.clock_in).length;
    // グループ化: user_id -> records
    const grouped: Record<string, AdminAttendRecord[]> = {};
    adminRecords.forEach(r => {
      if (!grouped[r.user_id]) grouped[r.user_id] = [];
      grouped[r.user_id].push(r);
    });
    const defaultWp = workPatterns.find(w => w.is_default);
    const stdMin = defaultWp?.standard_hours_min ?? 480;

    const exportCsv = () => {
      const BOM = '\uFEFF';
      const header = '氏名,日付,出勤①,退勤①,出勤②,退勤②,実働(分),備考\n';
      let rows = '';
      Object.entries(grouped).forEach(([uid, recs]) => {
        const name = recs[0]?.profiles?.display_name ?? '';
        recs.forEach(r => {
          const wm = pairMin(r.clock_in, r.clock_out) + pairMin(r.clock_in2 ?? null, r.clock_out2 ?? null);
          rows += `"${name}","${r.work_date}","${r.clock_in ?? ''}","${r.clock_out ?? ''}","${r.clock_in2 ?? ''}","${r.clock_out2 ?? ''}","${wm}","${(r.note ?? '').replace(/"/g, '""')}"\n`;
        });
      });
      // サマリー行
      rows += '\n氏名,出勤日数,総労働(分),所定(分),残業(分)\n';
      Object.entries(grouped).forEach(([uid, recs]) => {
        const name = recs[0]?.profiles?.display_name ?? '';
        const workDays = recs.filter(r => r.clock_in).length;
        const totalMin = recs.reduce((s, r) => s + pairMin(r.clock_in, r.clock_out) + pairMin(r.clock_in2 ?? null, r.clock_out2 ?? null), 0);
        const overtimeMin = Math.max(0, totalMin - (stdMin * workDays));
        rows += `"${name}","${workDays}","${totalMin}","${stdMin * workDays}","${overtimeMin}"\n`;
      });
      const csv = BOM + header + rows;
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `勤怠データ_${adminAttendMonth}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    };

    return (
      <View style={styles.container}>
        {renderHeader('🕐 勤怠管理（管理）',
          <TouchableOpacity style={[styles.headerAddBtn, { backgroundColor: '#059669' }]} onPress={exportCsv}>
            <Text style={styles.headerAddBtnText}>📥 CSV</Text>
          </TouchableOpacity>
        )}
        <View style={styles.attendTabBar}>
          <TouchableOpacity style={styles.attendTab} onPress={() => setScreen('attendance')}><Text style={styles.attendTabText}>打刻</Text></TouchableOpacity>
          {hasPerm('attend_admin') && <TouchableOpacity style={[styles.attendTab, styles.attendTabActive]}><Text style={[styles.attendTabText, styles.attendTabTextActive]}>管理</Text></TouchableOpacity>}
          {hasPerm('attend_settings') && <TouchableOpacity style={styles.attendTab} onPress={() => setScreen('attend_settings')}><Text style={styles.attendTabText}>設定</Text></TouchableOpacity>}
        </View>

        <ScrollView contentContainerStyle={styles.attendScroll}>
          {/* スプレッドシート連携 */}
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
            <TouchableOpacity style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#E8F5E9', borderRadius: 10, paddingVertical: 10, borderWidth: 1, borderColor: '#A5D6A7' }}
              onPress={async () => {
                const { data: { session } } = await supabase.auth.getSession();
                if (!session) return;
                alert('スプレッドシートに書き込み中...');
                const resp = await fetch('https://nccognptoprhwsbjnwcu.supabase.co/functions/v1/sync-attendance-sheets', {
                  method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
                  body: JSON.stringify({ action: 'write', month: adminAttendMonth }),
                });
                const r = await resp.json();
                if (r.success) alert(`✓ ${r.rows}件をスプレッドシートに書き込みました`);
                else alert('エラー: ' + (r.error ?? '不明'));
              }}>
              <Text style={{ fontSize: 16 }}>📤</Text>
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#2E7D32' }}>シートに書込</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#E3F2FD', borderRadius: 10, paddingVertical: 10, borderWidth: 1, borderColor: '#90CAF9' }}
              onPress={async () => {
                const { data: { session } } = await supabase.auth.getSession();
                if (!session) return;
                if (!window.confirm('スプレッドシートのデータでDBを更新しますか？')) return;
                alert('スプレッドシートから読み込み中...');
                const resp = await fetch('https://nccognptoprhwsbjnwcu.supabase.co/functions/v1/sync-attendance-sheets', {
                  method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
                  body: JSON.stringify({ action: 'read', month: adminAttendMonth }),
                });
                const r = await resp.json();
                if (r.success) { alert(`✓ ${r.updated}件を読み込みました`); fetchAdminAttendance(); }
                else alert('エラー: ' + (r.error ?? '不明'));
              }}>
              <Text style={{ fontSize: 16 }}>📥</Text>
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#1565C0' }}>シートから読込</Text>
            </TouchableOpacity>
          </View>

          {/* 月選択 */}
          <View style={styles.monthNavRow}>
            <TouchableOpacity onPress={() => { const d = new Date(adminAttendMonth + '-01'); d.setMonth(d.getMonth() - 1); setAdminAttendMonth(d.toISOString().slice(0, 7)); }}>
              <Text style={styles.monthNavArrow}>‹</Text>
            </TouchableOpacity>
            <Text style={styles.monthNavTitle}>{adminAttendMonth}</Text>
            <TouchableOpacity onPress={() => { const d = new Date(adminAttendMonth + '-01'); d.setMonth(d.getMonth() + 1); setAdminAttendMonth(d.toISOString().slice(0, 7)); }}>
              <Text style={styles.monthNavArrow}>›</Text>
            </TouchableOpacity>
          </View>

          {/* メンバー選択 */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            <TouchableOpacity style={[styles.aaUserChip, adminAttendUser === 'all' && styles.aaUserChipActive]} onPress={() => setAdminAttendUser('all')}>
              <Text style={[styles.aaUserChipText, adminAttendUser === 'all' && styles.aaUserChipTextActive]}>全員</Text>
            </TouchableOpacity>
            {adminMembers.map(m => (
              <TouchableOpacity key={m.id} style={[styles.aaUserChip, adminAttendUser === m.id && styles.aaUserChipActive]} onPress={() => setAdminAttendUser(m.id)}>
                <Text style={[styles.aaUserChipText, adminAttendUser === m.id && styles.aaUserChipTextActive]}>{m.display_name}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {loadingAdmin ? <ActivityIndicator style={{ marginTop: 30 }} color="#F59E0B" /> : (
            <>
              {/* サマリーカード（メンバーごと） */}
              {Object.entries(grouped).map(([uid, recs]) => {
                const name = recs[0]?.profiles?.display_name ?? uid.slice(0, 6);
                const workDays = recs.filter(r => r.clock_in).length;
                const totalMin = recs.reduce((s, r) => s + pairMin(r.clock_in, r.clock_out) + pairMin(r.clock_in2 ?? null, r.clock_out2 ?? null), 0);
                const overtimeMin = Math.max(0, totalMin - (stdMin * workDays));
                return (
                  <View key={uid} style={styles.aaSummaryCard}>
                    <Text style={styles.aaSummaryName}>{name}</Text>
                    <View style={styles.aaSummaryGrid}>
                      <View style={styles.aaSummaryItem}>
                        <Text style={styles.aaSummaryLabel}>出勤日数</Text>
                        <Text style={styles.aaSummaryVal}>{workDays}<Text style={styles.aaSummaryUnit}>日</Text></Text>
                      </View>
                      <View style={styles.aaSummaryItem}>
                        <Text style={styles.aaSummaryLabel}>総労働時間</Text>
                        <Text style={styles.aaSummaryVal}>{Math.floor(totalMin / 60)}h{totalMin % 60 > 0 ? `${totalMin % 60}m` : ''}</Text>
                      </View>
                      <View style={styles.aaSummaryItem}>
                        <Text style={styles.aaSummaryLabel}>所定時間</Text>
                        <Text style={styles.aaSummaryVal}>{Math.floor(stdMin * workDays / 60)}h</Text>
                      </View>
                      <View style={styles.aaSummaryItem}>
                        <Text style={[styles.aaSummaryLabel, { color: overtimeMin > 0 ? '#DC2626' : '#64748B' }]}>残業時間</Text>
                        <Text style={[styles.aaSummaryVal, overtimeMin > 0 && { color: '#DC2626' }]}>{Math.floor(overtimeMin / 60)}h{overtimeMin % 60 > 0 ? `${overtimeMin % 60}m` : ''}</Text>
                      </View>
                    </View>

                    {/* 日次明細 */}
                    <View style={styles.attendTable}>
                      <View style={[styles.attendTableRow, styles.attendTableHead]}>
                        <Text style={[styles.attendCol, styles.attendHeadText, { flex: 1 }]}>日付</Text>
                        <Text style={[styles.attendCol, styles.attendHeadText]}>出勤</Text>
                        <Text style={[styles.attendCol, styles.attendHeadText]}>退勤</Text>
                        <Text style={[styles.attendCol, styles.attendHeadText]}>実働</Text>
                        <Text style={[styles.attendCol, styles.attendHeadText, { flex: 0.5 }]}>修正</Text>
                      </View>
                      {recs.map(r => {
                        const wm = pairMin(r.clock_in, r.clock_out) + pairMin(r.clock_in2 ?? null, r.clock_out2 ?? null);
                        return (
                          <View key={r.id} style={styles.attendTableRow}>
                            <Text style={[styles.attendCol, { flex: 1, fontWeight: '600', color: '#374151' }]}>{r.work_date.slice(5)}</Text>
                            <Text style={styles.attendCol}>{r.clock_in ?? '--'}{r.clock_in2 ? `\n${r.clock_in2}` : ''}</Text>
                            <Text style={styles.attendCol}>{r.clock_out ?? '--'}{r.clock_out2 ? `\n${r.clock_out2}` : ''}</Text>
                            <Text style={[styles.attendCol, { color: '#2563EB', fontWeight: '600' }]}>
                              {wm > 0 ? `${Math.floor(wm / 60)}h${wm % 60 > 0 ? `${wm % 60}m` : ''}` : '--'}
                            </Text>
                            <TouchableOpacity style={{ flex: 0.5, alignItems: 'center' }} onPress={() => openEditAttend(r)}>
                              <Text style={{ fontSize: 16 }}>✏️</Text>
                            </TouchableOpacity>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                );
              })}
              {adminRecords.length === 0 && <Text style={styles.emptyText}>この月のデータはありません</Text>}

              {/* 修正ログボタン */}
              <TouchableOpacity style={styles.logToggleBtn} onPress={fetchEditLogs}>
                <Text style={styles.logToggleBtnText}>📝 修正ログを表示</Text>
              </TouchableOpacity>

              {/* 修正ログ一覧 */}
              {showLogs && (
                <View style={styles.logSection}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <Text style={styles.logSectionTitle}>修正履歴</Text>
                    <TouchableOpacity onPress={() => setShowLogs(false)}>
                      <Text style={{ fontSize: 12, color: '#94A3B8' }}>閉じる</Text>
                    </TouchableOpacity>
                  </View>
                  {editLogs.length === 0
                    ? <Text style={{ fontSize: 12, color: '#94A3B8', textAlign: 'center', paddingVertical: 12 }}>この期間の修正履歴はありません</Text>
                    : editLogs.map(log => {
                      const before = log.before_data as Record<string, string | null>;
                      const after = log.after_data as Record<string, string | null>;
                      const changes: string[] = [];
                      ['clock_in', 'clock_out', 'clock_in2', 'clock_out2', 'note'].forEach(k => {
                        if (before[k] !== after[k]) {
                          const label = k === 'clock_in' ? '出勤①' : k === 'clock_out' ? '退勤①' : k === 'clock_in2' ? '出勤②' : k === 'clock_out2' ? '退勤②' : '備考';
                          changes.push(`${label}: ${before[k] ?? '(空)'} → ${after[k] ?? '(空)'}`);
                        }
                      });
                      return (
                        <View key={log.id} style={styles.logItem}>
                          <View style={styles.logItemHeader}>
                            <Text style={styles.logItemDate}>{log.work_date}</Text>
                            <Text style={styles.logItemTarget}>{(log.target as any)?.display_name ?? ''}</Text>
                          </View>
                          <Text style={styles.logItemEditor}>修正者: {(log.editor as any)?.display_name ?? ''}</Text>
                          <Text style={styles.logItemTime}>{new Date(log.created_at).toLocaleString('ja-JP')}</Text>
                          {changes.map((c, i) => <Text key={i} style={styles.logItemChange}>{c}</Text>)}
                          <View style={styles.logItemReasonBox}>
                            <Text style={styles.logItemReasonLabel}>理由:</Text>
                            <Text style={styles.logItemReason}>{log.reason}</Text>
                          </View>
                        </View>
                      );
                    })
                  }
                </View>
              )}
            </>
          )}
        </ScrollView>

        {/* 勤怠修正モーダル */}
        <Modal visible={editAttendModal} transparent animationType="slide" onRequestClose={() => setEditAttendModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalSheet}>
              <View style={styles.modalTop}>
                <Text style={styles.modalTitle}>勤怠修正</Text>
                <TouchableOpacity onPress={() => setEditAttendModal(false)}><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
              </View>
              {editAttendRec && (
                <ScrollView>
                  <Text style={styles.fLabel}>対象: {editAttendRec.profiles?.display_name} / {editAttendRec.work_date}</Text>
                  <Text style={styles.fLabel}>出勤① (HH:MM)</Text>
                  <TextInput style={styles.fInput} value={eaClockIn} onChangeText={setEaClockIn} placeholder="09:00" keyboardType="numbers-and-punctuation" />
                  <Text style={styles.fLabel}>退勤① (HH:MM)</Text>
                  <TextInput style={styles.fInput} value={eaClockOut} onChangeText={setEaClockOut} placeholder="18:00" keyboardType="numbers-and-punctuation" />
                  <Text style={styles.fLabel}>出勤② (HH:MM)</Text>
                  <TextInput style={styles.fInput} value={eaClockIn2} onChangeText={setEaClockIn2} placeholder="" keyboardType="numbers-and-punctuation" />
                  <Text style={styles.fLabel}>退勤② (HH:MM)</Text>
                  <TextInput style={styles.fInput} value={eaClockOut2} onChangeText={setEaClockOut2} placeholder="" keyboardType="numbers-and-punctuation" />
                  <Text style={styles.fLabel}>中抜け① 開始 (HH:MM)</Text>
                  <TextInput style={styles.fInput} value={eaBreakStart} onChangeText={setEaBreakStart} placeholder="" keyboardType="numbers-and-punctuation" />
                  <Text style={styles.fLabel}>中抜け① 終了 (HH:MM)</Text>
                  <TextInput style={styles.fInput} value={eaBreakEnd} onChangeText={setEaBreakEnd} placeholder="" keyboardType="numbers-and-punctuation" />
                  <Text style={styles.fLabel}>中抜け② 開始 (HH:MM)</Text>
                  <TextInput style={styles.fInput} value={eaBreakStart2} onChangeText={setEaBreakStart2} placeholder="" keyboardType="numbers-and-punctuation" />
                  <Text style={styles.fLabel}>中抜け② 終了 (HH:MM)</Text>
                  <TextInput style={styles.fInput} value={eaBreakEnd2} onChangeText={setEaBreakEnd2} placeholder="" keyboardType="numbers-and-punctuation" />
                  <Text style={styles.fLabel}>備考</Text>
                  <TextInput style={[styles.fInput, styles.fTextArea]} value={eaNote} onChangeText={setEaNote} multiline placeholder="備考" />
                  <Text style={[styles.fLabel, { color: '#DC2626' }]}>修正理由 *（必須）</Text>
                  <TextInput style={[styles.fInput, styles.fTextArea, { borderColor: '#FCA5A5' }]} value={eaReason} onChangeText={setEaReason} multiline placeholder="例: 打刻忘れのため管理者が修正" />
                  <View style={styles.modalBtns}>
                    <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditAttendModal(false)}>
                      <Text style={styles.cancelBtnText}>キャンセル</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.submitBtn, { backgroundColor: '#F59E0B' }, savingAdmin && { opacity: 0.6 }]} onPress={saveEditAttend} disabled={savingAdmin}>
                      <Text style={styles.submitBtnText}>{savingAdmin ? '保存中...' : '保存'}</Text>
                    </TouchableOpacity>
                  </View>
                </ScrollView>
              )}
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  // ═══════════════════════════════════════════════════════════
  // ATTENDANCE SETTINGS (設定ページ)
  // ═══════════════════════════════════════════════════════════
  if (screen === 'attend_settings' && hasPerm('attend_settings')) {
    return (
      <View style={styles.container}>
        {renderHeader('🕐 勤怠設定')}
        <View style={styles.attendTabBar}>
          <TouchableOpacity style={styles.attendTab} onPress={() => setScreen('attendance')}><Text style={styles.attendTabText}>打刻</Text></TouchableOpacity>
          {hasPerm('attend_admin') && <TouchableOpacity style={styles.attendTab} onPress={() => setScreen('attend_admin')}><Text style={styles.attendTabText}>管理</Text></TouchableOpacity>}
          {hasPerm('attend_settings') && <TouchableOpacity style={[styles.attendTab, styles.attendTabActive]}><Text style={[styles.attendTabText, styles.attendTabTextActive]}>設定</Text></TouchableOpacity>}
        </View>

        <ScrollView contentContainerStyle={styles.attendScroll}>
          {/* ── 就業パターン一覧 ── */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#1E293B' }}>就業時間パターン</Text>
            <TouchableOpacity style={styles.headerAddBtn} onPress={openAddWp}>
              <Text style={styles.headerAddBtnText}>＋ 追加</Text>
            </TouchableOpacity>
          </View>

          {workPatterns.map(wp => {
            const totalMin = calcPatternMinutes(wp.start_time, wp.end_time);
            const workMin = totalMin - wp.break_minutes;
            return (
              <View key={wp.id} style={styles.wpCard}>
                <View style={styles.wpCardHeader}>
                  <Text style={styles.wpCardName}>{wp.name}</Text>
                  {wp.is_default && <View style={styles.wpDefaultBadge}><Text style={styles.wpDefaultBadgeText}>デフォルト</Text></View>}
                </View>
                <View style={styles.wpTimeRow}>
                  <Text style={styles.wpTimeBig}>{wp.start_time}</Text>
                  <Text style={styles.wpTimeSep}>〜</Text>
                  <Text style={styles.wpTimeBig}>{wp.end_time}</Text>
                </View>
                <View style={styles.wpCardGrid}>
                  <View style={styles.wpCardItem}>
                    <Text style={styles.wpCardLabel}>拘束</Text>
                    <Text style={styles.wpCardVal}>{Math.floor(totalMin / 60)}h{totalMin % 60 > 0 ? `${totalMin % 60}m` : ''}</Text>
                  </View>
                  <View style={styles.wpCardItem}>
                    <Text style={styles.wpCardLabel}>休憩</Text>
                    <Text style={styles.wpCardVal}>{wp.break_minutes}分</Text>
                  </View>
                  <View style={styles.wpCardItem}>
                    <Text style={styles.wpCardLabel}>所定労働</Text>
                    <Text style={[styles.wpCardVal, { color: '#2563EB' }]}>{Math.floor(workMin / 60)}h{workMin % 60 > 0 ? `${workMin % 60}m` : ''}</Text>
                  </View>
                </View>
                <View style={styles.wpCardActions}>
                  {!wp.is_default && (
                    <TouchableOpacity style={styles.wpActionBtn} onPress={() => setDefaultWp(wp)}>
                      <Text style={styles.wpActionBtnText}>デフォルト</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={styles.wpActionBtn} onPress={() => openEditWp(wp)}>
                    <Text style={styles.wpActionBtnText}>✏️ 編集</Text>
                  </TouchableOpacity>
                  {!wp.is_default && (
                    <TouchableOpacity style={[styles.wpActionBtn, { backgroundColor: '#FEF2F2', borderColor: '#FECACA' }]} onPress={() => deleteWp(wp)}>
                      <Text style={[styles.wpActionBtnText, { color: '#DC2626' }]}>🗑</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })}
          {workPatterns.length === 0 && <Text style={styles.emptyText}>パターンがまだ登録されていません</Text>}

          {/* ── 従業員パターン割当表 ── */}
          <View style={{ marginTop: 20 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#1E293B', marginBottom: 12 }}>従業員パターン割当</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator>
              <View>
                {/* ヘッダー */}
                <View style={styles.uwpHeaderRow}>
                  <View style={styles.uwpNameCell}><Text style={styles.uwpHeaderText}>従業員</Text></View>
                  {workPatterns.map(wp => (
                    <View key={wp.id} style={styles.uwpPatternCell}>
                      <Text style={styles.uwpHeaderText} numberOfLines={2}>{wp.name}</Text>
                      <Text style={styles.uwpHeaderSub}>{wp.start_time}〜{wp.end_time}</Text>
                    </View>
                  ))}
                </View>
                {/* 従業員行 */}
                {wpMembers.map(m => (
                  <View key={m.id} style={styles.uwpRow}>
                    <View style={styles.uwpNameCell}><Text style={styles.uwpNameText}>{m.display_name}</Text></View>
                    {workPatterns.map(wp => {
                      const assigned = userWpAssigns.some(a => a.user_id === m.id && a.work_pattern_id === wp.id);
                      return (
                        <TouchableOpacity key={wp.id} style={styles.uwpPatternCell} onPress={() => toggleUserPattern(m.id, wp.id)}>
                          <View style={[styles.uwpCheckBox, assigned && styles.uwpCheckBoxOn]}>
                            {assigned && <Text style={styles.uwpCheckMark}>✓</Text>}
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>
        </ScrollView>

        {/* パターン追加/編集モーダル */}
        <Modal visible={wpModal} transparent animationType="slide" onRequestClose={() => setWpModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalSheet}>
              <View style={styles.modalTop}>
                <Text style={styles.modalTitle}>{editingWp ? 'パターン編集' : 'パターン追加'}</Text>
                <TouchableOpacity onPress={() => setWpModal(false)}><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
              </View>
              <ScrollView>
                <Text style={styles.fLabel}>パターン名 *</Text>
                <TextInput style={styles.fInput} value={wpName} onChangeText={setWpName} placeholder="例: 日勤（9:00〜18:00）" />

                <Text style={styles.fLabel}>就業時間</Text>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 16 }}>
                  <TextInput style={[styles.fInput, { flex: 1, marginBottom: 0, textAlign: 'center', fontSize: 18, fontWeight: '700' }]}
                    value={wpStartTime} onChangeText={setWpStartTime} placeholder="09:00" keyboardType="numbers-and-punctuation" />
                  <Text style={{ fontSize: 18, color: '#475569', fontWeight: '600' }}>〜</Text>
                  <TextInput style={[styles.fInput, { flex: 1, marginBottom: 0, textAlign: 'center', fontSize: 18, fontWeight: '700' }]}
                    value={wpEndTime} onChangeText={setWpEndTime} placeholder="18:00" keyboardType="numbers-and-punctuation" />
                </View>

                {wpStartTime && wpEndTime && (
                  <View style={{ backgroundColor: '#F0F9FF', borderRadius: 8, padding: 10, marginBottom: 16 }}>
                    <Text style={{ fontSize: 12, color: '#0369A1' }}>
                      拘束時間: {(() => { const t = calcPatternMinutes(wpStartTime, wpEndTime); return `${Math.floor(t / 60)}時間${t % 60 > 0 ? `${t % 60}分` : ''}`; })()}
                      {'　→　'}休憩 {wpBreak}分 引いて 所定労働: {(() => { const t = calcPatternMinutes(wpStartTime, wpEndTime) - parseInt(wpBreak || '0'); return `${Math.floor(t / 60)}時間${t % 60 > 0 ? `${t % 60}分` : ''}`; })()}
                    </Text>
                  </View>
                )}

                <Text style={styles.fLabel}>休憩時間（分）</Text>
                <TextInput style={styles.fInput} value={wpBreak} onChangeText={setWpBreak} keyboardType="numeric" placeholder="60" />

                <View style={styles.modalBtns}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => setWpModal(false)}>
                    <Text style={styles.cancelBtnText}>キャンセル</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.submitBtn, { backgroundColor: '#F59E0B' }, savingWp && { opacity: 0.6 }]} onPress={saveWp} disabled={savingWp}>
                    <Text style={styles.submitBtnText}>{savingWp ? '保存中...' : '保存'}</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  // ═══════════════════════════════════════════════════════════
  // ATTENDANCE
  // ═══════════════════════════════════════════════════════════
  return (
    <View style={styles.container}>
      {renderHeader('🕐 勤怠管理')}
      {(hasPerm('attend_admin') || hasPerm('attend_settings')) && (
        <View style={styles.attendTabBar}>
          <TouchableOpacity style={[styles.attendTab, styles.attendTabActive]}><Text style={[styles.attendTabText, styles.attendTabTextActive]}>打刻</Text></TouchableOpacity>
          {hasPerm('attend_admin') && <TouchableOpacity style={styles.attendTab} onPress={() => { setScreen('attend_admin'); fetchWorkPatterns(); }}><Text style={styles.attendTabText}>管理</Text></TouchableOpacity>}
          {hasPerm('attend_settings') && <TouchableOpacity style={styles.attendTab} onPress={() => setScreen('attend_settings')}><Text style={styles.attendTabText}>設定</Text></TouchableOpacity>}
        </View>
      )}
      <ScrollView contentContainerStyle={styles.attendScroll}>

        {/* 今日の打刻カード */}
        <View style={styles.todayCard}>
          <Text style={styles.todayCardDate}>{todayStr()} の勤怠</Text>

          {/* 1回目 */}
          <View style={styles.sessionRow}>
            <Text style={styles.sessionLabel}>① 前半</Text>
            <View style={styles.todayTimeRow}>
              <View style={styles.todayTimeItem}>
                <Text style={styles.todayTimeLabel}>出勤</Text>
                <Text style={[styles.todayTimeValue, !todayRecord?.clock_in && styles.todayTimeEmpty]}>{todayRecord?.clock_in ?? '--:--'}</Text>
              </View>
              <View style={styles.todayTimeSep}><Text style={styles.todayTimeSepText}>〜</Text></View>
              <View style={styles.todayTimeItem}>
                <Text style={styles.todayTimeLabel}>退勤</Text>
                <Text style={[styles.todayTimeValue, !todayRecord?.clock_out && styles.todayTimeEmpty]}>{todayRecord?.clock_out ?? '--:--'}</Text>
              </View>
              <View style={styles.todayTimeItem}>
                <Text style={styles.todayTimeLabel}>時間</Text>
                <Text style={[styles.todayTimeValue, { fontSize: 16, color: '#475569' }]}>
                  {pairMin(todayRecord?.clock_in ?? null, todayRecord?.clock_out ?? null) > 0
                    ? (() => { const m = pairMin(todayRecord!.clock_in, todayRecord!.clock_out); return `${Math.floor(m/60)}h${m%60>0?`${m%60}m`:''}`; })()
                    : '--'}
                </Text>
              </View>
            </View>
          </View>

          {/* 2回目（1回目退勤後に出現） */}
          {(todayRecord?.clock_out || todayRecord?.clock_in2) ? (
            <View style={styles.sessionRow}>
              <Text style={styles.sessionLabel}>② 後半</Text>
              <View style={styles.todayTimeRow}>
                <View style={styles.todayTimeItem}>
                  <Text style={styles.todayTimeLabel}>出勤</Text>
                  <Text style={[styles.todayTimeValue, !todayRecord?.clock_in2 && styles.todayTimeEmpty]}>{todayRecord?.clock_in2 ?? '--:--'}</Text>
                </View>
                <View style={styles.todayTimeSep}><Text style={styles.todayTimeSepText}>〜</Text></View>
                <View style={styles.todayTimeItem}>
                  <Text style={styles.todayTimeLabel}>退勤</Text>
                  <Text style={[styles.todayTimeValue, !todayRecord?.clock_out2 && styles.todayTimeEmpty]}>{todayRecord?.clock_out2 ?? '--:--'}</Text>
                </View>
                <View style={styles.todayTimeItem}>
                  <Text style={styles.todayTimeLabel}>時間</Text>
                  <Text style={[styles.todayTimeValue, { fontSize: 16, color: '#475569' }]}>
                    {pairMin(todayRecord?.clock_in2 ?? null, todayRecord?.clock_out2 ?? null) > 0
                      ? (() => { const m = pairMin(todayRecord!.clock_in2!, todayRecord!.clock_out2!); return `${Math.floor(m/60)}h${m%60>0?`${m%60}m`:''}`; })()
                      : '--'}
                  </Text>
                </View>
              </View>
            </View>
          ) : null}

          {/* 合計実働 */}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>本日合計実働</Text>
            <Text style={styles.totalValue}>{todayRecord ? (calcWorkRecord(todayRecord) ?? '--') : '--'}</Text>
          </View>

          {/* ボタン */}
          <View style={styles.clockBtnRow}>
            <TouchableOpacity
              style={[styles.clockBtn, styles.clockBtnIn, !canClockIn(todayRecord) && styles.clockBtnDone]}
              onPress={clockIn}
              disabled={saving || !canClockIn(todayRecord)}
            >
              <Text style={styles.clockBtnIcon}>🟢</Text>
              <Text style={styles.clockBtnLabel}>
                {!canClockIn(todayRecord)
                  ? (todayRecord?.clock_in2 ? `②出勤済\n${todayRecord.clock_in2}` : `出勤済\n${todayRecord?.clock_in}`)
                  : (todayRecord?.clock_out ? '②出勤打刻' : '出勤打刻')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.clockBtn, styles.clockBtnOut, !canClockOut(todayRecord) && styles.clockBtnDone]}
              onPress={clockOut}
              disabled={saving || !canClockOut(todayRecord)}
            >
              <Text style={styles.clockBtnIcon}>🔴</Text>
              <Text style={styles.clockBtnLabel}>
                {!canClockOut(todayRecord)
                  ? (todayRecord?.clock_out2 ? `②退勤済\n${todayRecord.clock_out2}` : (todayRecord?.clock_out ? `退勤済\n${todayRecord.clock_out}` : '退勤打刻'))
                  : (todayRecord?.clock_in2 ? '②退勤打刻' : '退勤打刻')}
              </Text>
            </TouchableOpacity>
          </View>
          {/* 中抜けボタン */}
          <View style={styles.clockBtnRow}>
            <TouchableOpacity
              style={[styles.clockBtn, { backgroundColor: '#FEF3C7', borderWidth: 1.5, borderColor: '#FCD34D' }, !canBreakStart(todayRecord) && styles.clockBtnDone]}
              onPress={breakStart}
              disabled={saving || !canBreakStart(todayRecord)}
            >
              <Text style={styles.clockBtnIcon}>🟡</Text>
              <Text style={styles.clockBtnLabel}>
                {canBreakEnd(todayRecord) ? `中抜け中\n${todayRecord?.break_start2 ?? todayRecord?.break_start ?? ''}` : canBreakStart(todayRecord) ? '中抜け開始' : todayRecord?.break_start ? `中抜け済` : '中抜け開始'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.clockBtn, { backgroundColor: '#DBEAFE', borderWidth: 1.5, borderColor: '#93C5FD' }, !canBreakEnd(todayRecord) && styles.clockBtnDone]}
              onPress={breakEnd}
              disabled={saving || !canBreakEnd(todayRecord)}
            >
              <Text style={styles.clockBtnIcon}>🔵</Text>
              <Text style={styles.clockBtnLabel}>
                {canBreakEnd(todayRecord) ? '中抜け終了' : todayRecord?.break_end ? `戻り済\n${todayRecord?.break_end2 ?? todayRecord?.break_end ?? ''}` : '中抜け終了'}
              </Text>
            </TouchableOpacity>
          </View>
          {/* 中抜け記録表示 */}
          {todayRecord?.break_start && (
            <View style={{ backgroundColor: '#FFFBEB', borderRadius: 10, padding: 10, marginBottom: 12 }}>
              <Text style={{ fontSize: 12, color: '#92400E', fontWeight: '600', marginBottom: 4 }}>中抜け記録</Text>
              <Text style={{ fontSize: 13, color: '#78350F' }}>
                ① {todayRecord.break_start} 〜 {todayRecord.break_end ?? '---'}
                {todayRecord.break_end ? ` (${pairMin(todayRecord.break_start, todayRecord.break_end)}分)` : ''}
              </Text>
              {todayRecord.break_start2 && (
                <Text style={{ fontSize: 13, color: '#78350F' }}>
                  ② {todayRecord.break_start2} 〜 {todayRecord.break_end2 ?? '---'}
                  {todayRecord.break_end2 ? ` (${pairMin(todayRecord.break_start2, todayRecord.break_end2)}分)` : ''}
                </Text>
              )}
              <Text style={{ fontSize: 12, color: '#B45309', fontWeight: '700', marginTop: 4 }}>
                中抜け合計: {totalBreakMin(todayRecord)}分
              </Text>
            </View>
          )}
          <TextInput
            style={styles.noteInput}
            value={attendNote}
            onChangeText={setAttendNote}
            placeholder="備考（外出・早退など）"
            onBlur={async () => { if (todayRecord) { await supabase.from('attendance_records').update({ note: attendNote || null }).eq('id', todayRecord.id); }}}
          />
        </View>

        {/* 月次サマリー */}
        <View style={styles.monthCard}>
          <View style={styles.monthNavRow}>
            <TouchableOpacity onPress={() => { const d = new Date(attendMonth + '-01'); d.setMonth(d.getMonth() - 1); setAttendMonth(d.toISOString().slice(0, 7)); }}>
              <Text style={styles.monthNavArrow}>‹</Text>
            </TouchableOpacity>
            <Text style={styles.monthNavTitle}>{attendMonth}</Text>
            <TouchableOpacity onPress={() => { const d = new Date(attendMonth + '-01'); d.setMonth(d.getMonth() + 1); setAttendMonth(d.toISOString().slice(0, 7)); }}>
              <Text style={styles.monthNavArrow}>›</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.monthSummaryRow}>
            <View style={styles.monthSummaryBox}>
              <Text style={styles.monthSummaryLabel}>出勤日数</Text>
              <Text style={styles.monthSummaryValue}>{monthRecords.filter(r => r.clock_in).length}<Text style={styles.monthSummaryUnit}>日</Text></Text>
            </View>
            <View style={styles.monthSummaryBox}>
              <Text style={styles.monthSummaryLabel}>合計実働</Text>
              <Text style={styles.monthSummaryValue}>
                {Math.floor(totalWorkMin / 60)}<Text style={styles.monthSummaryUnit}>h</Text>
                {totalWorkMin % 60 > 0 ? <>{totalWorkMin % 60}<Text style={styles.monthSummaryUnit}>m</Text></> : null}
              </Text>
            </View>
          </View>

          {/* 日次一覧テーブル */}
          <View style={styles.attendTable}>
            <View style={[styles.attendTableRow, styles.attendTableHead]}>
              <Text style={[styles.attendCol, styles.attendHeadText, { flex: 1.2 }]}>日付</Text>
              <Text style={[styles.attendCol, styles.attendHeadText]}>出勤①</Text>
              <Text style={[styles.attendCol, styles.attendHeadText]}>退勤①</Text>
              <Text style={[styles.attendCol, styles.attendHeadText]}>実働</Text>
              <Text style={[styles.attendCol, styles.attendHeadText, { flex: 1.5 }]}>備考</Text>
            </View>
            {monthRecords.length === 0
              ? <Text style={[styles.emptyText, { marginVertical: 20 }]}>この月の記録はありません</Text>
              : monthRecords.map(r => (
                <View key={r.id} style={styles.attendTableGroup}>
                  {/* 1回目 */}
                  <View style={styles.attendTableRow}>
                    <Text style={[styles.attendCol, { flex: 1.2, fontWeight: '600', color: '#374151' }]}>{r.work_date.slice(5)}</Text>
                    <Text style={styles.attendCol}>{r.clock_in ?? '--'}</Text>
                    <Text style={styles.attendCol}>{r.clock_out ?? '--'}</Text>
                    <Text style={[styles.attendCol, { color: '#2563EB', fontWeight: '600' }]}>
                      {(() => { const m = pairMin(r.clock_in, r.clock_out); return m > 0 ? `${Math.floor(m/60)}h${m%60>0?`${m%60}m`:''}` : '--'; })()}
                    </Text>
                    <Text style={[styles.attendCol, { flex: 1.5, color: '#9CA3AF', fontSize: 11 }]} numberOfLines={1}>{r.note ?? ''}</Text>
                  </View>
                  {/* 2回目（ある場合のみ） */}
                  {r.clock_in2 && (
                    <View style={[styles.attendTableRow, { backgroundColor: '#F8FAFC' }]}>
                      <Text style={[styles.attendCol, { flex: 1.2, color: '#9CA3AF', fontSize: 11 }]}>　└②</Text>
                      <Text style={[styles.attendCol, { color: '#64748B' }]}>{r.clock_in2 ?? '--'}</Text>
                      <Text style={[styles.attendCol, { color: '#64748B' }]}>{r.clock_out2 ?? '--'}</Text>
                      <Text style={[styles.attendCol, { color: '#64748B', fontWeight: '500' }]}>
                        {(() => { const m = pairMin(r.clock_in2, r.clock_out2 ?? null); return m > 0 ? `${Math.floor(m/60)}h${m%60>0?`${m%60}m`:''}` : '--'; })()}
                      </Text>
                      <Text style={[styles.attendCol, { flex: 1.5 }]} />
                    </View>
                  )}
                </View>
              ))
            }
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F1F5F9' },

  // Portal header
  portalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 52, paddingBottom: 14, backgroundColor: '#1E3A5F' },
  portalHeaderCenter: { alignItems: 'center' },
  portalLogo: { fontSize: 18, fontWeight: 'bold', color: '#fff' },
  portalDate: { fontSize: 11, color: '#93C5FD', marginTop: 2 },

  // Sub-screen header
  subHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 52, paddingBottom: 14, backgroundColor: '#1E3A5F' },
  subBack: { color: '#93C5FD', fontSize: 15, width: 64 },
  subHeaderTitle: { fontSize: 16, fontWeight: 'bold', color: '#fff' },
  subHeaderRight: { width: 64, alignItems: 'flex-end' },
  headerAddBtn: { backgroundColor: '#3B82F6', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 5 },
  headerAddBtnText: { color: '#fff', fontSize: 13, fontWeight: 'bold' },

  // Nav grid
  navGrid: { flexDirection: 'row', backgroundColor: '#fff', paddingVertical: 14, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#E2E8F0', justifyContent: 'space-around' },
  navItem: { alignItems: 'center', flex: 1 },
  navIconBox: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 5 },
  navIcon: { fontSize: 26 },
  navLabel: { fontSize: 11, color: '#374151', fontWeight: '500' },

  portalScroll: { padding: 12, gap: 12, paddingBottom: 40 },

  // Widget
  widget: { backgroundColor: '#fff', borderRadius: 14, padding: 14, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 },
  widgetHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 4 },
  widgetIcon: { fontSize: 15 },
  widgetTitle: { flex: 1, fontSize: 14, fontWeight: 'bold', color: '#1E293B' },
  widgetMore: { paddingHorizontal: 4 },
  widgetMoreText: { fontSize: 12, color: '#3B82F6' },

  // Pinned
  pinnedCard: { backgroundColor: '#EFF6FF', borderRadius: 10, padding: 12, borderLeftWidth: 3, borderLeftColor: '#3B82F6' },
  pinnedTitle: { fontSize: 15, fontWeight: '700', color: '#1E3A5F', marginBottom: 4 },
  pinnedContent: { fontSize: 13, color: '#374151', lineHeight: 18, marginBottom: 6 },
  pinnedMeta: { fontSize: 11, color: '#93C5FD' },

  // Category
  categoryTag: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' },
  categoryTagText: { fontSize: 11, fontWeight: '700' },
  categoryDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4, marginRight: 8 },

  // Attendance widget (portal)
  attendWidget: { gap: 10 },
  attendWidgetItem: { alignItems: 'center', flex: 1 },
  attendWidgetLabel: { fontSize: 10, color: '#9CA3AF', marginBottom: 2 },
  attendWidgetTime: { fontSize: 20, fontWeight: 'bold', color: '#1E293B' },
  attendWidgetEmpty: { color: '#D1D5DB' },
  attendWidgetArrow: { fontSize: 18, color: '#D1D5DB', paddingTop: 16 },
  attendWidgetBtns: { flexDirection: 'row', gap: 10, marginTop: 4 },
  clockMiniBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  clockMiniIn: { backgroundColor: '#D1FAE5' },
  clockMiniOut: { backgroundColor: '#FEE2E2' },
  clockMiniBtnDone: { backgroundColor: '#F3F4F6' },
  clockMiniBtnText: { fontSize: 13, fontWeight: 'bold', color: '#374151' },

  // Info items
  infoRow: { flexDirection: 'row', gap: 12 },
  infoItem: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#F1F5F9', gap: 8 },
  infoItemTitle: { fontSize: 13, color: '#1E293B', fontWeight: '500', marginBottom: 2 },
  infoItemSub: { fontSize: 11, color: '#9CA3AF' },
  emptySmall: { fontSize: 13, color: '#9CA3AF', textAlign: 'center', paddingVertical: 12 },

  // Todo items (portal)
  todoItem: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#F1F5F9', gap: 10 },
  todoCheck: { paddingTop: 2 },
  todoCheckBox: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  todoCheckFill: { width: 10, height: 10, borderRadius: 5 },
  todoTitle: { fontSize: 14, color: '#1E293B', fontWeight: '500', flex: 1 },
  todoDone: { textDecorationLine: 'line-through', color: '#9CA3AF' },
  todoMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3 },
  todoDue: { fontSize: 11, color: '#6B7280' },
  todoOverdue: { color: '#EF4444', fontWeight: '600' },
  priorityPill: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  priorityPillText: { fontSize: 10, fontWeight: 'bold' },

  // Bulletin list
  list: { padding: 12, gap: 10, paddingBottom: 40 },
  bulletinCard: { backgroundColor: '#fff', borderRadius: 14, padding: 14, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 5, elevation: 2 },
  bulletinPinBadge: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  bulletinPinText: { fontSize: 11, color: '#D97706', fontWeight: '600' },
  bulletinCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  bulletinTitle: { fontSize: 15, fontWeight: '700', color: '#1E293B', marginBottom: 5 },
  bulletinPreview: { fontSize: 13, color: '#64748B', lineHeight: 18, marginBottom: 8 },
  bulletinFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bulletinAuthor: { fontSize: 12, color: '#94A3B8', fontWeight: '500' },
  bulletinDate: { fontSize: 11, color: '#94A3B8' },
  bulletinComment: { fontSize: 12, color: '#64748B' },

  // Bulletin detail
  detailTitle: { fontSize: 20, fontWeight: '800', color: '#0F172A', marginBottom: 6, lineHeight: 28 },
  detailMeta: { fontSize: 12, color: '#94A3B8', marginBottom: 16 },
  detailContent: { fontSize: 15, color: '#334155', lineHeight: 24, marginBottom: 20 },
  divider: { height: 1, backgroundColor: '#E2E8F0', marginBottom: 16 },
  commentsLabel: { fontSize: 13, fontWeight: '700', color: '#475569', marginBottom: 10 },
  commentBubble: { backgroundColor: '#F8FAFC', borderRadius: 12, padding: 12, marginBottom: 8 },
  commentBubbleHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 8 },
  commentAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#3B82F6', alignItems: 'center', justifyContent: 'center' },
  commentAvatarText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  commentAuthorName: { fontSize: 13, fontWeight: '600', color: '#334155', flex: 1 },
  commentTime: { fontSize: 11, color: '#94A3B8' },
  commentText: { fontSize: 14, color: '#1E293B', lineHeight: 20 },
  commentInputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginTop: 8 },
  commentInput: { flex: 1, borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, padding: 12, fontSize: 14, minHeight: 44, maxHeight: 100, backgroundColor: '#F8FAFC' },
  commentSendBtn: { backgroundColor: '#2563EB', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12 },
  commentSendText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },

  // Tasks
  filterBar: { backgroundColor: '#fff', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#E2E8F0', maxHeight: 50 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: '#F1F5F9' },
  filterChipActive: { backgroundColor: '#2563EB' },
  filterChipText: { fontSize: 13, color: '#64748B' },
  filterChipTextActive: { color: '#fff', fontWeight: 'bold' },
  taskCard: { backgroundColor: '#fff', borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 10, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 2 },
  taskCheckWrap: { paddingTop: 2 },
  taskCheck: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  taskTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  taskTitleText: { flex: 1, fontSize: 14, fontWeight: '600', color: '#1E293B' },
  taskDoneText: { textDecorationLine: 'line-through', color: '#9CA3AF' },
  taskDescText: { fontSize: 12, color: '#64748B', marginBottom: 6 },
  taskMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  statusPill: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  statusPillText: { fontSize: 11, fontWeight: '700' },
  taskAssignText: { fontSize: 11, color: '#64748B' },
  taskDueText: { fontSize: 11, color: '#64748B' },
  taskOverdueText: { color: '#EF4444', fontWeight: '700' },
  emptyText: { textAlign: 'center', color: '#94A3B8', fontSize: 14, marginTop: 40 },

  // Attendance tabs
  attendTabBar: { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  attendTab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  attendTabActive: { borderBottomWidth: 2, borderBottomColor: '#F59E0B' },
  attendTabText: { fontSize: 14, color: '#94A3B8', fontWeight: '600' },
  attendTabTextActive: { color: '#F59E0B' },

  // Admin attendance
  aaUserChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0' },
  aaUserChipActive: { backgroundColor: '#F59E0B', borderColor: '#F59E0B' },
  aaUserChipText: { fontSize: 12, color: '#64748B', fontWeight: '600' },
  aaUserChipTextActive: { color: '#fff' },
  aaSummaryCard: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 2 },
  aaSummaryName: { fontSize: 15, fontWeight: '800', color: '#1E293B', marginBottom: 10 },
  aaSummaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  aaSummaryItem: { flex: 1, minWidth: '40%', backgroundColor: '#F8FAFC', borderRadius: 10, padding: 10, alignItems: 'center' },
  aaSummaryLabel: { fontSize: 11, color: '#64748B', fontWeight: '600', marginBottom: 4 },
  aaSummaryVal: { fontSize: 18, fontWeight: '800', color: '#1E293B' },
  aaSummaryUnit: { fontSize: 12, fontWeight: '500', color: '#94A3B8' },

  // Work pattern settings
  wpCard: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 2 },
  wpCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  wpCardName: { fontSize: 15, fontWeight: '700', color: '#1E293B' },
  wpDefaultBadge: { backgroundColor: '#FEF3C7', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  wpDefaultBadgeText: { fontSize: 10, fontWeight: '700', color: '#92400E' },
  wpCardGrid: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  wpCardItem: { flex: 1, backgroundColor: '#F8FAFC', borderRadius: 8, padding: 10, alignItems: 'center' },
  wpCardLabel: { fontSize: 10, color: '#64748B', fontWeight: '600', marginBottom: 4 },
  wpCardVal: { fontSize: 15, fontWeight: '800', color: '#1E293B' },
  wpTimeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 10 },
  wpTimeBig: { fontSize: 24, fontWeight: '800', color: '#1E293B' },
  wpTimeSep: { fontSize: 18, color: '#94A3B8' },
  wpCardActions: { flexDirection: 'row', gap: 8 },
  wpActionBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center' },
  wpActionBtnText: { fontSize: 12, fontWeight: '600', color: '#475569' },

  // User-pattern assignment table
  uwpHeaderRow: { flexDirection: 'row', backgroundColor: '#F8FAFC', borderBottomWidth: 2, borderBottomColor: '#CBD5E1' },
  uwpNameCell: { width: 100, padding: 8, justifyContent: 'center', borderRightWidth: 1, borderRightColor: '#E2E8F0' },
  uwpPatternCell: { width: 100, padding: 8, alignItems: 'center', justifyContent: 'center', borderRightWidth: 1, borderRightColor: '#E2E8F0' },
  uwpHeaderText: { fontSize: 11, fontWeight: '700', color: '#475569', textAlign: 'center' },
  uwpHeaderSub: { fontSize: 9, color: '#94A3B8', marginTop: 2, textAlign: 'center' },
  uwpRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  uwpNameText: { fontSize: 12, fontWeight: '600', color: '#334155' },
  uwpCheckBox: { width: 26, height: 26, borderRadius: 6, borderWidth: 2, borderColor: '#CBD5E1', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  uwpCheckBoxOn: { backgroundColor: '#F59E0B', borderColor: '#F59E0B' },
  uwpCheckMark: { fontSize: 14, color: '#fff', fontWeight: '800' },

  // Mail
  mailTabBar: { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  mailTab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  mailTabActive: { borderBottomWidth: 2, borderBottomColor: '#0891B2' },
  mailTabText: { fontSize: 13, color: '#94A3B8', fontWeight: '600' },
  mailTabTextActive: { color: '#0891B2' },
  mailItem: { flexDirection: 'row', padding: 14, borderBottomWidth: 1, borderBottomColor: '#F1F5F9', gap: 12 },
  mailItemLeft: {},
  mailAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  mailAvatarText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  mailItemBody: { flex: 1 },
  mailItemTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  mailItemFrom: { fontSize: 13, fontWeight: '700', color: '#1E293B', flex: 1 },
  mailItemDate: { fontSize: 10, color: '#94A3B8' },
  mailItemSubject: { fontSize: 14, fontWeight: '600', color: '#334155', marginBottom: 2 },
  mailItemPreview: { fontSize: 12, color: '#94A3B8' },
  mailViewSubject: { fontSize: 20, fontWeight: '800', color: '#1E293B', marginBottom: 12 },
  mailViewMeta: { backgroundColor: '#F8FAFC', borderRadius: 10, padding: 14, marginBottom: 14, gap: 6 },
  mailViewMetaRow: { flexDirection: 'row', gap: 8 },
  mailViewMetaLabel: { fontSize: 11, fontWeight: '700', color: '#94A3B8', width: 48 },
  mailViewMetaVal: { fontSize: 13, color: '#334155', flex: 1 },
  mailViewBody: { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0', padding: 16, minHeight: 120 },
  mailViewBodyText: { fontSize: 14, color: '#1E293B', lineHeight: 24 },

  // External Links
  elGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  elCard: { width: '47%', backgroundColor: '#fff', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#E2E8F0', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 2, alignItems: 'center', gap: 6 },
  elIconBox: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  elIconText: { fontSize: 28 },
  elCardTitle: { fontSize: 14, fontWeight: '700', color: '#1E293B', textAlign: 'center' },
  elCardDesc: { fontSize: 11, color: '#64748B', textAlign: 'center' },
  elCardUrl: { fontSize: 9, color: '#94A3B8', marginTop: 2 },
  elHint: { fontSize: 11, color: '#94A3B8', textAlign: 'center', marginTop: 16 },
  elIconBtn: { width: 40, height: 40, borderRadius: 10, borderWidth: 1.5, borderColor: '#E2E8F0', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8FAFC' },
  elIconBtnActive: { borderColor: '#6366F1', backgroundColor: '#EEF2FF' },
  elColorBtn: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: 'transparent' },
  elColorBtnActive: { borderColor: '#1E293B', borderWidth: 3 },
  elPreview: { borderWidth: 1, borderRadius: 14, padding: 16, alignItems: 'center', gap: 6, marginBottom: 16, backgroundColor: '#FAFAFA' },

  // Business Cards
  bcScanBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#F0FDFA', borderBottomWidth: 1, borderBottomColor: '#99F6E4', paddingVertical: 12 },
  bcScanBtnIcon: { fontSize: 20 },
  bcScanBtnText: { fontSize: 14, fontWeight: '700', color: '#0D9488' },
  bcScanBtnSmall: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#F0FDFA', borderRadius: 10, borderWidth: 1, borderColor: '#99F6E4', paddingVertical: 12, marginBottom: 14 },
  bcScanBtnSmallText: { fontSize: 13, fontWeight: '700', color: '#0D9488' },
  bcSearchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', margin: 12, marginBottom: 0, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: '#E2E8F0', gap: 8 },
  bcSearchIcon: { fontSize: 16 },
  bcSearchInput: { flex: 1, fontSize: 14, color: '#334155' },
  bcCount: { fontSize: 11, color: '#94A3B8', paddingHorizontal: 16, paddingVertical: 4 },
  bcCompanyGroup: { marginBottom: 12 },
  bcCompanyName: { fontSize: 13, fontWeight: '700', color: '#0D9488', marginBottom: 6, paddingLeft: 4 },
  bcCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 4, borderWidth: 1, borderColor: '#F1F5F9', gap: 10 },
  bcCardLeft: {},
  bcCardAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#14B8A6', alignItems: 'center', justifyContent: 'center' },
  bcCardAvatarText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  bcCardInfo: { flex: 1 },
  bcCardPerson: { fontSize: 15, fontWeight: '700', color: '#1E293B' },
  bcCardTitle: { fontSize: 11, color: '#64748B', marginTop: 1 },
  bcCardSub: { fontSize: 11, color: '#94A3B8' },
  bcCardTags: { fontSize: 10, color: '#0D9488', marginTop: 2 },
  bcDetailCard: { backgroundColor: '#F0FDFA', borderRadius: 14, padding: 18, marginBottom: 12, borderWidth: 1, borderColor: '#99F6E4' },
  bcDetailCompany: { fontSize: 13, fontWeight: '700', color: '#0D9488', marginBottom: 2 },
  bcDetailDept: { fontSize: 11, color: '#64748B', marginBottom: 6 },
  bcDetailPerson: { fontSize: 22, fontWeight: '800', color: '#1E293B', marginBottom: 2 },
  bcDetailTitle: { fontSize: 13, color: '#475569', marginBottom: 8 },
  bcDetailDivider: { height: 1, backgroundColor: '#99F6E4', marginVertical: 10 },
  bcDetailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  bcDetailIcon: { fontSize: 14, width: 22 },
  bcDetailVal: { fontSize: 14, color: '#334155', flex: 1 },
  bcDetailMeta: { backgroundColor: '#F8FAFC', borderRadius: 10, padding: 14, marginBottom: 10, gap: 6 },
  bcDetailMetaLabel: { fontSize: 11, fontWeight: '700', color: '#94A3B8', width: 56 },
  bcDetailMetaVal: { fontSize: 13, color: '#334155', flex: 1 },
  bcDetailNotes: { backgroundColor: '#FFFBEB', borderRadius: 10, padding: 12, marginBottom: 8 },
  bcDetailNotesLabel: { fontSize: 11, fontWeight: '700', color: '#92400E', marginBottom: 4 },
  bcDetailNotesText: { fontSize: 13, color: '#78350F', lineHeight: 20 },

  // Gantt
  ganttNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#F0F9FF', borderBottomWidth: 1, borderBottomColor: '#BAE6FD' },
  ganttNavBtn: { paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#E0F2FE', borderRadius: 8 },
  ganttNavBtnText: { fontSize: 11, color: '#0369A1', fontWeight: '600' },
  ganttNavLabel: { fontSize: 12, fontWeight: '700', color: '#0C4A6E' },
  ganttLabelCol: { width: 120, paddingHorizontal: 6, paddingVertical: 6, borderRightWidth: 1, borderRightColor: '#CBD5E1', backgroundColor: '#FAFAFA', justifyContent: 'center' },
  ganttLabelText: { fontSize: 10, fontWeight: '700', color: '#94A3B8' },
  ganttDayHeader: { width: 36, alignItems: 'center', paddingVertical: 4, borderRightWidth: 1, borderRightColor: '#E2E8F0', backgroundColor: '#F8FAFC' },
  ganttDayHeaderText: { fontSize: 11, fontWeight: '700', color: '#334155' },
  ganttDowText: { fontSize: 8, color: '#94A3B8' },
  ganttProjDot: { width: 10, height: 10, borderRadius: 5 },
  ganttProjName: { fontSize: 12, fontWeight: '700', color: '#1E293B', flex: 1 },
  ganttTaskLabel: { fontSize: 11, fontWeight: '600', color: '#334155' },
  ganttTaskAssignee: { fontSize: 9, color: '#94A3B8' },
  ganttBar: { position: 'absolute', top: 4, height: 28, borderRadius: 4, borderWidth: 1, overflow: 'hidden', justifyContent: 'center' },
  ganttBarProgress: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 3 },
  ganttBarText: { fontSize: 9, fontWeight: '700', textAlign: 'center', zIndex: 1 },
  ganttColorBtn: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: 'transparent' },
  ganttColorBtnActive: { borderColor: '#1E293B', borderWidth: 3 },

  // Reports
  rpFilterRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#FDF2F8', borderBottomWidth: 1, borderBottomColor: '#FBCFE8' },
  rpFilterChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: '#fff', borderWidth: 1, borderColor: '#FBCFE8' },
  rpFilterChipActive: { backgroundColor: '#EC4899', borderColor: '#EC4899' },
  rpFilterChipText: { fontSize: 12, fontWeight: '600', color: '#9D174D' },
  rpFilterChipTextActive: { color: '#fff' },
  rpCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#F1F5F9', shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 4, elevation: 1 },
  rpCardTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  rpStatusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  rpStatusBadgeText: { fontSize: 10, fontWeight: '700' },
  rpCardCat: { fontSize: 11, color: '#64748B', fontWeight: '600' },
  rpCardDate: { fontSize: 11, color: '#94A3B8', marginLeft: 'auto' },
  rpCardTitle: { fontSize: 15, fontWeight: '700', color: '#1E293B', marginBottom: 6 },
  rpCardBottom: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rpCardAuthor: { fontSize: 11, color: '#64748B', fontWeight: '600' },
  rpCardPreview: { fontSize: 11, color: '#94A3B8', flex: 1 },
  rpCatChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0' },
  rpCatChipActive: { backgroundColor: '#EC4899', borderColor: '#EC4899' },
  rpCatChipText: { fontSize: 12, color: '#475569', fontWeight: '600' },
  rpCatChipTextActive: { color: '#fff' },
  rpViewHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  rpViewCat: { fontSize: 13, color: '#64748B', fontWeight: '600' },
  rpViewTitle: { fontSize: 20, fontWeight: '800', color: '#1E293B', marginBottom: 12 },
  rpViewMeta: { backgroundColor: '#F8FAFC', borderRadius: 10, padding: 14, marginBottom: 14, gap: 8 },
  rpViewMetaRow: { flexDirection: 'row', gap: 12 },
  rpViewMetaLabel: { fontSize: 12, fontWeight: '700', color: '#94A3B8', width: 60 },
  rpViewMetaVal: { fontSize: 13, color: '#334155', flex: 1 },
  rpViewBody: { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0', padding: 16, marginBottom: 14, minHeight: 150 },
  rpViewBodyText: { fontSize: 14, color: '#1E293B', lineHeight: 24 },
  rpViewComment: { backgroundColor: '#FEF9C3', borderRadius: 10, padding: 12, marginBottom: 8 },
  rpViewCommentLabel: { fontSize: 11, fontWeight: '700', color: '#92400E', marginBottom: 4 },
  rpViewCommentText: { fontSize: 13, color: '#78350F', lineHeight: 20 },

  // Edit logs
  logToggleBtn: { backgroundColor: '#F8FAFC', borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0', padding: 12, alignItems: 'center', marginTop: 8 },
  logToggleBtnText: { fontSize: 13, fontWeight: '600', color: '#475569' },
  logSection: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginTop: 8 },
  logSectionTitle: { fontSize: 14, fontWeight: '700', color: '#1E293B' },
  logItem: { borderBottomWidth: 1, borderBottomColor: '#F1F5F9', paddingVertical: 10 },
  logItemHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  logItemDate: { fontSize: 13, fontWeight: '700', color: '#1E293B' },
  logItemTarget: { fontSize: 12, fontWeight: '600', color: '#3B82F6', backgroundColor: '#EFF6FF', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
  logItemEditor: { fontSize: 11, color: '#64748B', marginBottom: 1 },
  logItemTime: { fontSize: 10, color: '#94A3B8', marginBottom: 4 },
  logItemChange: { fontSize: 12, color: '#334155', backgroundColor: '#FFFBEB', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, marginBottom: 2, fontWeight: '500' },
  logItemReasonBox: { flexDirection: 'row', marginTop: 4, gap: 4 },
  logItemReasonLabel: { fontSize: 11, fontWeight: '700', color: '#DC2626' },
  logItemReason: { fontSize: 11, color: '#475569', flex: 1 },

  // Attendance full screen
  attendScroll: { padding: 14, gap: 14, paddingBottom: 60 },
  todayCard: { backgroundColor: '#fff', borderRadius: 16, padding: 18, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  todayCardDate: { fontSize: 13, color: '#64748B', fontWeight: '600', marginBottom: 16 },
  todayTimeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  todayTimeItem: { flex: 1, alignItems: 'center' },
  todayTimeLabel: { fontSize: 11, color: '#94A3B8', marginBottom: 4 },
  todayTimeValue: { fontSize: 22, fontWeight: 'bold', color: '#0F172A' },
  todayTimeEmpty: { color: '#CBD5E1' },
  todayTimeSep: { alignItems: 'center', paddingBottom: 4 },
  todayTimeSepText: { fontSize: 18, color: '#CBD5E1' },
  clockBtnRow: { flexDirection: 'row', gap: 12, marginBottom: 14 },
  clockBtn: { flex: 1, borderRadius: 14, paddingVertical: 16, alignItems: 'center', gap: 4 },
  clockBtnIn: { backgroundColor: '#DCFCE7', borderWidth: 1.5, borderColor: '#86EFAC' },
  clockBtnOut: { backgroundColor: '#FEE2E2', borderWidth: 1.5, borderColor: '#FCA5A5' },
  clockBtnDone: { backgroundColor: '#F1F5F9', borderColor: '#E2E8F0' },
  clockBtnIcon: { fontSize: 22 },
  clockBtnLabel: { fontSize: 13, fontWeight: '700', color: '#374151', textAlign: 'center' },
  noteInput: { borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10, padding: 12, fontSize: 14, color: '#374151', backgroundColor: '#F8FAFC' },
  monthCard: { backgroundColor: '#fff', borderRadius: 16, padding: 16 },
  monthNavRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 14, gap: 20 },
  monthNavArrow: { fontSize: 28, color: '#2563EB', fontWeight: '300' },
  monthNavTitle: { fontSize: 16, fontWeight: 'bold', color: '#0F172A', minWidth: 90, textAlign: 'center' },
  monthSummaryRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  monthSummaryBox: { flex: 1, backgroundColor: '#EFF6FF', borderRadius: 12, padding: 14, alignItems: 'center' },
  monthSummaryLabel: { fontSize: 11, color: '#3B82F6', fontWeight: '600', marginBottom: 4 },
  monthSummaryValue: { fontSize: 24, fontWeight: '800', color: '#1D4ED8' },
  monthSummaryUnit: { fontSize: 13, fontWeight: '400' },
  attendTable: {},
  attendTableHead: { backgroundColor: '#F8FAFC', borderRadius: 8, marginBottom: 4 },
  attendTableGroup: {},
  attendTableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  attendHeadText: { fontSize: 11, color: '#94A3B8', fontWeight: '700' },
  attendCol: { flex: 1, fontSize: 13, color: '#475569', textAlign: 'center' },
  // セッション行
  sessionRow: { marginBottom: 10 },
  sessionLabel: { fontSize: 11, fontWeight: '700', color: '#94A3B8', marginBottom: 4, paddingLeft: 2 },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#EFF6FF', borderRadius: 10, paddingVertical: 10, marginBottom: 14 },
  totalLabel: { fontSize: 13, color: '#3B82F6', fontWeight: '600' },
  totalValue: { fontSize: 22, fontWeight: '800', color: '#1D4ED8' },
  // ポータル勤怠ウィジェット行
  attendWidgetRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 6 },
  attendWidgetSession: { fontSize: 11, color: '#94A3B8', fontWeight: '700', width: 14 },
  attendWidgetTotal: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 48 },
  modalTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  modalTitle: { fontSize: 17, fontWeight: 'bold', color: '#0F172A' },
  modalClose: { fontSize: 18, color: '#94A3B8' },
  modalBtns: { flexDirection: 'row', gap: 12, marginTop: 8 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center' },
  cancelBtnText: { fontSize: 15, color: '#64748B' },
  submitBtn: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#2563EB', alignItems: 'center' },
  submitBtnText: { fontSize: 15, color: '#fff', fontWeight: 'bold' },

  // Form
  fLabel: { fontSize: 12, fontWeight: '700', color: '#64748B', marginBottom: 6 },
  fInput: { borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10, padding: 14, fontSize: 15, marginBottom: 16, backgroundColor: '#F8FAFC', color: '#0F172A' },
  fTextArea: { minHeight: 100, textAlignVertical: 'top' },
  segRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  seg: { flex: 1, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center', backgroundColor: '#F8FAFC' },
  segText: { fontSize: 13, color: '#64748B' },
  pinToggle: { backgroundColor: '#FEF9C3', borderRadius: 10, padding: 12, alignItems: 'center', marginBottom: 16, borderWidth: 1, borderColor: '#FDE68A' },
  pinToggleOn: { backgroundColor: '#FEF08A', borderColor: '#EAB308' },
  pinToggleText: { fontSize: 14, color: '#713F12', fontWeight: '600' },
  // Schedule
  schedAddBtn: { backgroundColor: '#8B5CF620', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  schedAddBtnText: { fontSize: 13, color: '#8B5CF6', fontWeight: '700' },
  weekNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#F8FAFC', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  weekNavBtn: { paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#EDE9FE', borderRadius: 8 },
  weekNavBtnText: { fontSize: 12, color: '#7C3AED', fontWeight: '600' },
  weekLabel: { fontSize: 12, color: '#475569', fontWeight: '600', textAlign: 'center', flex: 1, marginHorizontal: 8 },
  schedHeaderRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#E2E8F0', backgroundColor: '#F8FAFC' },
  schedMemberCell: { width: 90, padding: 8, justifyContent: 'center', borderRightWidth: 1, borderRightColor: '#E2E8F0' },
  schedMemberHeader: { fontSize: 11, fontWeight: '700', color: '#94A3B8' },
  schedDayHeader: { width: 130, padding: 8, alignItems: 'center', borderRightWidth: 1, borderRightColor: '#E2E8F0' },
  schedDayHeaderToday: { backgroundColor: '#8B5CF6' },
  schedDayName: { fontSize: 12, fontWeight: '700', color: '#374151' },
  schedDayDate: { fontSize: 18, fontWeight: '800', color: '#1E293B', marginTop: 2 },
  schedMemberRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#E2E8F0', minHeight: 80 },
  schedMemberName: { fontSize: 12, fontWeight: '600', color: '#334155', lineHeight: 16 },
  schedDayCell: { width: 130, minHeight: 80, padding: 4, borderRightWidth: 1, borderRightColor: '#E2E8F0', gap: 2 },
  schedDayCellToday: { backgroundColor: '#FAF5FF' },
  schedEventChip: { borderRadius: 4, borderWidth: 1, padding: 4, marginBottom: 2 },
  schedEventChipText: { fontSize: 10, lineHeight: 13 },
  schedPlusBtn: { alignItems: 'center', justifyContent: 'center', opacity: 0.2 },
  schedPlusBtnText: { fontSize: 14, color: '#94A3B8' },

  assignChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F1F5F9', marginRight: 8 },
  assignChipActive: { backgroundColor: '#2563EB' },
  assignChipText: { fontSize: 13, color: '#374151' },
  assignChipTextActive: { color: '#fff', fontWeight: 'bold' },

  // View tabs
  viewTabs: { flexDirection: 'row', backgroundColor: '#F1F5F9', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  viewTab: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  viewTabActive: { borderBottomWidth: 2, borderBottomColor: '#8B5CF6', backgroundColor: '#fff' },
  viewTabText: { fontSize: 14, color: '#94A3B8', fontWeight: '600' },
  viewTabTextActive: { color: '#8B5CF6' },

  // Day view (horizontal time axis)
  dayAllDayArea: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: '#E2E8F0', backgroundColor: '#FAFAFE' },
  dayAllDayLabel: { width: 80, fontSize: 11, color: '#94A3B8', fontWeight: '700', textAlign: 'center' },
  dayAllDayEvents: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  dayAllDayChip: { borderRadius: 4, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4 },
  dayMemberCol: { width: 80, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4, borderRightWidth: 1, borderRightColor: '#CBD5E1', backgroundColor: '#F8FAFC' },
  dayMemberColText: { fontSize: 12, fontWeight: '600', color: '#334155', textAlign: 'center', lineHeight: 16 },
  dayHBar: { position: 'absolute', top: 4, bottom: 4, borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, justifyContent: 'center', overflow: 'hidden' },

  // Month view
  monthHeaderRow: { flexDirection: 'row', backgroundColor: '#F8FAFC', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  monthDayHeaderCell: { flex: 1, paddingVertical: 8, alignItems: 'center' },
  monthDayHeaderText: { fontSize: 11, fontWeight: '700', color: '#64748B' },
  monthRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  monthCell: { flex: 1, minHeight: 70, padding: 3, borderRightWidth: 1, borderRightColor: '#E2E8F0' },
  monthCellToday: { backgroundColor: '#FAF5FF' },
  monthCellDate: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 2 },
  monthCellDateToday: { color: '#8B5CF6', fontWeight: '800' },
  monthEventChip: { borderRadius: 3, paddingHorizontal: 3, paddingVertical: 1, marginBottom: 1 },
  monthEventChipText: { fontSize: 9, fontWeight: '600' },
  monthMoreText: { fontSize: 9, color: '#94A3B8' },

  // Member picker
  schedControlRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#F0EDFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  memberPicker: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: '#C4B5FD', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, minWidth: 120, gap: 6 },
  memberPickerText: { fontSize: 14, fontWeight: '700', color: '#334155', maxWidth: 120 },
  memberPickerArrow: { fontSize: 10, color: '#8B5CF6' },
  memberPickerLabel: { fontSize: 14, color: '#475569', marginLeft: 6 },
  memberDropdownOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'flex-start', paddingTop: 180, paddingHorizontal: 20 },
  memberDropdown: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#C4B5FD', overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 10 },
  memberDropdownItem: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  memberDropdownItemActive: { backgroundColor: '#7C3AED' },
  memberDropdownText: { fontSize: 15, color: '#334155' },
  memberDropdownTextActive: { color: '#fff', fontWeight: '700' },

  // List box (week/month/year)
  listBoxSection: { padding: 12, gap: 10 },
  listBoxSectionTitle: { fontSize: 13, fontWeight: '700', color: '#475569', marginBottom: 4 },
  listBox: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', overflow: 'hidden' },
  listBoxHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#F8FAFC', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  listBoxMemberName: { fontSize: 13, fontWeight: '700', color: '#334155' },
  listBoxAddBtn: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#EDE9FE', alignItems: 'center', justifyContent: 'center' },
  listBoxAddBtnText: { fontSize: 16, color: '#8B5CF6', fontWeight: '700', lineHeight: 22 },
  listBoxEmpty: { fontSize: 12, color: '#94A3B8', padding: 12, textAlign: 'center' },
  listBoxItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9', borderLeftWidth: 3, gap: 10 },
  listBoxDateCol: { width: 32, alignItems: 'center' },
  listBoxDateNum: { fontSize: 14, fontWeight: '700', color: '#334155' },
  listBoxDateDay: { fontSize: 10, color: '#94A3B8' },
  listBoxItemTitle: { fontSize: 13, fontWeight: '600', color: '#1E293B' },
  listBoxItemTime: { fontSize: 11, color: '#64748B', marginTop: 1 },
  listBoxTypeBadge: { borderRadius: 6, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2 },
  listBoxTypeBadgeText: { fontSize: 10, fontWeight: '700' },

  // Year view
  yearMonthBox: { width: '31%', backgroundColor: '#fff', borderRadius: 10, padding: 6, borderWidth: 1, borderColor: '#E2E8F0' },
  yearMonthTitle: { fontSize: 13, fontWeight: '800', color: '#334155', textAlign: 'center', marginBottom: 4 },
  yearDayHeaderRow: { flexDirection: 'row', marginBottom: 1 },
  yearDayHeader: { flex: 1, textAlign: 'center', fontSize: 7, fontWeight: '700', color: '#94A3B8' },
  yearWeekRow: { flexDirection: 'row' },
  yearDayCell: { flex: 1, alignItems: 'center', paddingVertical: 1 },
  yearDayCellToday: { backgroundColor: '#EDE9FE', borderRadius: 3 },
  yearDayNum: { fontSize: 8, color: '#374151' },
  yearDayNumToday: { color: '#8B5CF6', fontWeight: '800' },
  yearEventDot: { width: 3, height: 3, borderRadius: 2, marginTop: 1 },
});
