import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert, Image, ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';

type Profile = {
  id: string;
  display_name: string;
  phone: string | null;
  bio: string | null;
  avatar_url: string | null;
  role: string;
  status: string;
  company: string | null;
  site: string | null;
};

type Props = {
  onBack: () => void;
};

export default function ProfileScreen({ onBack }: Props) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [bio, setBio] = useState('');
  const [company, setCompany] = useState('');
  const [site, setSite] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();
    if (error) { console.log('fetchProfile error:', error.message); return; }
    if (data) {
      setProfile(data as Profile);
      setDisplayName(data.display_name ?? '');
      setPhone(data.phone ?? '');
      setBio(data.bio ?? '');
      setCompany(data.company ?? '');
      setSite(data.site ?? '');
    }
    setLoading(false);
  };

  const saveProfile = async () => {
    if (!displayName.trim()) { alert('名前を入力してください'); return; }
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }
    const { error } = await supabase.from('profiles').update({
      display_name: displayName.trim(),
      phone: phone.trim() || null,
      bio: bio.trim() || null,
      company: company.trim() || null,
      site: site.trim() || null,
    }).eq('id', user.id);
    if (error) alert('エラー: ' + error.message);
    else alert('プロフィールを更新しました');
    setSaving(false);
  };

  const pickAndUploadAvatar = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, aspect: [1, 1], quality: 0.8,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    setUploadingAvatar(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const ext = asset.uri.split('.').pop() ?? 'jpg';
      const fileName = `${user.id}/avatar.${ext}`;
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const { error: uploadError } = await supabase.storage
        .from('avatars').upload(fileName, blob, { contentType: `image/${ext}`, upsert: true });
      if (uploadError) { alert(uploadError.message); return; }
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(fileName);
      const avatarUrl = urlData.publicUrl + '?t=' + Date.now();
      const { error: updateError } = await supabase.from('profiles').update({ avatar_url: avatarUrl }).eq('id', user.id);
      if (updateError) alert(updateError.message);
      else { setProfile(prev => prev ? { ...prev, avatar_url: avatarUrl } : prev); alert('アイコンを更新しました'); }
    } catch (e: any) { alert(e.message); }
    finally { setUploadingAvatar(false); }
  };

  if (loading) {
    return <View style={styles.loadingContainer}><ActivityIndicator size="large" color="#1A3C8F" /></View>;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.back}>← 戻る</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>プロフィール編集</Text>
        <TouchableOpacity onPress={saveProfile} disabled={saving}>
          <Text style={[styles.saveText, saving && { opacity: 0.5 }]}>{saving ? '保存中' : '保存'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* アバター */}
        <View style={styles.avatarSection}>
          <TouchableOpacity onPress={pickAndUploadAvatar} disabled={uploadingAvatar}>
            <View style={styles.avatarContainer}>
              {profile?.avatar_url ? (
                <Image source={{ uri: profile.avatar_url }} style={styles.avatarImage} />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Text style={styles.avatarInitial}>{displayName.charAt(0).toUpperCase()}</Text>
                </View>
              )}
              <View style={styles.avatarEditBadge}>
                <Text style={styles.avatarEditText}>{uploadingAvatar ? '⏳' : '📷'}</Text>
              </View>
            </View>
          </TouchableOpacity>
          <Text style={styles.avatarHint}>タップしてアイコンを変更</Text>
          {profile?.role === 'admin' && (
            <View style={styles.roleBadge}><Text style={styles.roleBadgeText}>👑 管理者</Text></View>
          )}
        </View>

        {/* フォーム */}
        <View style={styles.form}>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>基本情報</Text>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>表示名 *</Text>
            <TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} placeholder="表示名を入力" placeholderTextColor="#C0C0C0" maxLength={30} />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>電話番号</Text>
            <TextInput style={styles.input} value={phone} onChangeText={setPhone} placeholder="090-0000-0000" placeholderTextColor="#C0C0C0" keyboardType="phone-pad" maxLength={20} />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>自己紹介</Text>
            <TextInput
              style={[styles.input, styles.bioInput]}
              value={bio} onChangeText={setBio}
              placeholder="自己紹介を入力..." placeholderTextColor="#C0C0C0" multiline maxLength={200}
            />
            <Text style={styles.charCount}>{bio.length}/200</Text>
          </View>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>所属情報</Text>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>🏢 所属会社</Text>
            <TextInput
              style={styles.input}
              value={company} onChangeText={setCompany}
              placeholder="例: 株式会社〇〇" placeholderTextColor="#C0C0C0" maxLength={50}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>📍 所属現場</Text>
            <TextInput
              style={styles.input}
              value={site} onChangeText={setSite}
              placeholder="例: 〇〇工事現場" placeholderTextColor="#C0C0C0" maxLength={50}
            />
          </View>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>アカウント情報</Text>
          </View>

          <View style={styles.readOnlyField}>
            <Text style={styles.label}>ステータス</Text>
            <Text style={[styles.readOnlyText, { color: profile?.status === 'online' ? '#1A3C8F' : '#999' }]}>
              {profile?.status === 'online' ? '🟢 オンライン' : '⚫ オフライン'}
            </Text>
          </View>

        </View>

        <TouchableOpacity
          style={[styles.saveButton, saving && { opacity: 0.6 }]}
          onPress={saveProfile} disabled={saving}
        >
          <Text style={styles.saveButtonText}>{saving ? '保存中...' : 'プロフィールを保存'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: 48, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee' },
  back: { color: '#1A3C8F', fontSize: 16, width: 60 },
  headerTitle: { fontSize: 16, fontWeight: 'bold', color: '#333' },
  saveText: { color: '#1A3C8F', fontSize: 16, fontWeight: 'bold', width: 60, textAlign: 'right' },
  content: { padding: 20, paddingBottom: 40 },
  avatarSection: { alignItems: 'center', marginBottom: 28 },
  avatarContainer: { position: 'relative', marginBottom: 8 },
  avatarImage: { width: 100, height: 100, borderRadius: 50 },
  avatarPlaceholder: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#1A3C8F', alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: '#fff', fontSize: 40, fontWeight: 'bold' },
  avatarEditBadge: { position: 'absolute', bottom: 0, right: 0, width: 28, height: 28, borderRadius: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd', alignItems: 'center', justifyContent: 'center' },
  avatarEditText: { fontSize: 14 },
  avatarHint: { fontSize: 13, color: '#999', marginBottom: 8 },
  roleBadge: { backgroundColor: '#FFA500', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 4, marginTop: 4 },
  roleBadgeText: { color: '#fff', fontSize: 13, fontWeight: 'bold' },
  sectionHeader: { borderBottomWidth: 1, borderBottomColor: '#eee', paddingBottom: 6, marginTop: 8 },
  sectionTitle: { fontSize: 12, color: '#999', fontWeight: '700', letterSpacing: 0.5 },
  form: { gap: 16 },
  field: {},
  label: { fontSize: 13, color: '#666', fontWeight: '600', marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 14, fontSize: 15, backgroundColor: '#fafafa' },
  bioInput: { height: 100, textAlignVertical: 'top' },
  charCount: { fontSize: 12, color: '#999', textAlign: 'right', marginTop: 4 },
  readOnlyField: {},
  readOnlyText: { fontSize: 15, color: '#999', padding: 14, backgroundColor: '#f5f5f5', borderRadius: 10 },
  saveButton: { backgroundColor: '#1A3C8F', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 28 },
  saveButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});
