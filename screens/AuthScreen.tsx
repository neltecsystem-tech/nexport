import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { supabase } from '../lib/supabase';

export default function AuthScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [registered, setRegistered] = useState(false);

  const handleAuth = async () => {
    if (!email.trim() || !password.trim()) {
      setErrorMsg('メールアドレスとパスワードを入力してください');
      return;
    }
    if (!isLogin && !displayName.trim()) {
      setErrorMsg('表示名を入力してください');
      return;
    }
    setLoading(true);
    setErrorMsg('');

    if (isLogin) {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: password.trim(),
      });
      if (error) {
        setErrorMsg(`ログインエラー: ${error.message}`);
      }
    } else {
      // 新規登録 — Edge Function経由でユーザー作成（メール確認スキップ + 承認待ち）
      try {
        const resp = await fetch('https://nccognptoprhwsbjnwcu.supabase.co/functions/v1/register-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email.trim(),
            password: password.trim(),
            display_name: displayName.trim(),
          }),
        });
        const result = await resp.json();
        if (result.error) {
          setErrorMsg(`登録エラー: ${result.error}`);
        } else {
          setRegistered(true);
        }
      } catch (e: any) {
        setErrorMsg(`登録エラー: ${e.message}`);
      }
    }
    setLoading(false);
  };

  // 登録完了画面
  if (registered) {
    return (
      <View style={styles.container}>
        <Text style={styles.logo}>NexPort</Text>
      <Text style={styles.logoSub}>NELTEC BUSINESS PLATFORM</Text>
        <View style={styles.successBox}>
          <Text style={styles.successIcon}>✓</Text>
          <Text style={styles.successTitle}>アカウント申請完了</Text>
          <Text style={styles.successText}>
            管理者が承認するまでお待ちください。{'\n'}
            承認後にログインできるようになります。
          </Text>
        </View>
        <TouchableOpacity style={styles.button} onPress={() => { setRegistered(false); setIsLogin(true); }}>
          <Text style={styles.buttonText}>ログイン画面に戻る</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.logo}>NexPort</Text>
      <Text style={styles.logoSub}>NELTEC BUSINESS PLATFORM</Text>

      {errorMsg !== '' && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{errorMsg}</Text>
        </View>
      )}

      {!isLogin && (
        <TextInput
          style={styles.input}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="表示名（例: 山田太郎）" placeholderTextColor="#C0C0C0"
          autoCapitalize="none"
        />
      )}

      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        placeholder="メールアドレス" placeholderTextColor="#C0C0C0"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        placeholder="パスワード（6文字以上）" placeholderTextColor="#C0C0C0"
        secureTextEntry
      />

      <TouchableOpacity
        style={[styles.button, loading && { opacity: 0.6 }]}
        onPress={handleAuth}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>{isLogin ? 'ログイン' : 'アカウント申請'}</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity onPress={() => { setIsLogin(!isLogin); setErrorMsg(''); }}>
        <Text style={styles.switchText}>
          {isLogin ? 'アカウントを作成する →' : 'ログインに戻る →'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 32, backgroundColor: '#fff' },
  logo: { fontSize: 36, fontWeight: '900', color: '#1A3C8F', textAlign: 'center', marginBottom: 4, letterSpacing: 2 },
  logoSub: { fontSize: 11, color: '#6B7280', textAlign: 'center', marginBottom: 40, letterSpacing: 3 },
  errorBox: { backgroundColor: '#fff0f0', borderRadius: 10, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: '#ffcccc' },
  errorText: { color: '#E24B4A', fontSize: 14, textAlign: 'center' },
  input: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 12,
    padding: 14, fontSize: 16, marginBottom: 12, backgroundColor: '#fafafa',
  },
  button: {
    backgroundColor: '#1A3C8F', borderRadius: 12,
    padding: 16, alignItems: 'center', marginTop: 8, marginBottom: 20,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  switchText: { color: '#1A3C8F', textAlign: 'center', fontSize: 14 },
  successBox: { backgroundColor: '#EFF6FF', borderRadius: 16, padding: 24, marginBottom: 24, alignItems: 'center', borderWidth: 1, borderColor: '#BFDBFE' },
  successIcon: { fontSize: 40, color: '#1A3C8F', marginBottom: 12 },
  successTitle: { fontSize: 20, fontWeight: 'bold', color: '#1E3A5F', marginBottom: 8 },
  successText: { fontSize: 14, color: '#1E40AF', textAlign: 'center', lineHeight: 22 },
});
