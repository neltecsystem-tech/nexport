import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

type Props = { onLogout: () => void };

export default function PendingApprovalScreen({ onLogout }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.icon}>⏳</Text>
      <Text style={styles.title}>承認待ちです</Text>
      <Text style={styles.message}>
        アカウントの登録申請を受け付けました。{'\n'}
        管理者による承認をお待ちください。{'\n\n'}
        承認が完了したら、再度ログインしてください。
      </Text>
      <TouchableOpacity style={styles.logoutButton} onPress={onLogout}>
        <Text style={styles.logoutText}>ログアウト</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40, backgroundColor: '#fff' },
  icon: { fontSize: 64, marginBottom: 24 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#333', marginBottom: 16 },
  message: { fontSize: 15, color: '#666', textAlign: 'center', lineHeight: 26, marginBottom: 48 },
  logoutButton: { paddingHorizontal: 40, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: '#ddd', backgroundColor: '#fafafa' },
  logoutText: { fontSize: 15, color: '#999' },
});
