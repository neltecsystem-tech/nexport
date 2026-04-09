import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

type Props = {
  callState: 'outgoing_ringing' | 'incoming_ringing' | 'connected';
  remoteUserName: string;
  isMuted: boolean;
  callDuration: number;
  onAnswer: () => void;
  onReject: () => void;
  onHangUp: () => void;
  onToggleMute: () => void;
};

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function VoiceCallScreen({
  callState, remoteUserName, isMuted, callDuration,
  onAnswer, onReject, onHangUp, onToggleMute,
}: Props) {
  const statusText = callState === 'outgoing_ringing' ? '呼び出し中...'
    : callState === 'incoming_ringing' ? '着信中...'
    : formatDuration(callDuration);

  return (
    <View style={styles.container}>
      <View style={styles.topSection}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{remoteUserName?.charAt(0) ?? '?'}</Text>
        </View>
        <Text style={styles.name}>{remoteUserName ?? '不明'}</Text>
        <Text style={styles.status}>{statusText}</Text>
        {callState === 'connected' && (
          <Text style={styles.connectedLabel}>🔊 通話中</Text>
        )}
      </View>

      <View style={styles.bottomSection}>
        {callState === 'incoming_ringing' && (
          <View style={styles.buttonRow}>
            <TouchableOpacity style={[styles.btn, styles.rejectBtn]} onPress={onReject}>
              <Text style={styles.btnIcon}>✕</Text>
              <Text style={styles.btnLabel}>拒否</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.answerBtn]} onPress={onAnswer}>
              <Text style={styles.btnIcon}>📞</Text>
              <Text style={styles.btnLabel}>応答</Text>
            </TouchableOpacity>
          </View>
        )}

        {callState === 'outgoing_ringing' && (
          <View style={styles.buttonRow}>
            <TouchableOpacity style={[styles.btn, styles.rejectBtn]} onPress={onHangUp}>
              <Text style={styles.btnIcon}>✕</Text>
              <Text style={styles.btnLabel}>キャンセル</Text>
            </TouchableOpacity>
          </View>
        )}

        {callState === 'connected' && (
          <View style={styles.buttonRow}>
            <TouchableOpacity style={[styles.btn, isMuted ? styles.muteActiveBtn : styles.muteBtn]} onPress={onToggleMute}>
              <Text style={styles.btnIcon}>{isMuted ? '🔇' : '🎤'}</Text>
              <Text style={styles.btnLabel}>{isMuted ? 'ミュート中' : 'ミュート'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.rejectBtn]} onPress={onHangUp}>
              <Text style={styles.btnIcon}>✕</Text>
              <Text style={styles.btnLabel}>終了</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1A1A2E',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 80,
    paddingBottom: 60,
  },
  topSection: {
    alignItems: 'center',
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#2A2A4A',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  avatarText: {
    fontSize: 40,
    color: '#fff',
    fontWeight: 'bold',
  },
  name: {
    fontSize: 24,
    color: '#fff',
    fontWeight: 'bold',
    marginBottom: 8,
  },
  status: {
    fontSize: 18,
    color: '#94A3B8',
  },
  connectedLabel: {
    fontSize: 14,
    color: '#4ADE80',
    marginTop: 8,
  },
  bottomSection: {
    width: '100%',
    paddingHorizontal: 40,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 40,
  },
  btn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  answerBtn: {
    backgroundColor: '#22C55E',
  },
  rejectBtn: {
    backgroundColor: '#EF4444',
  },
  muteBtn: {
    backgroundColor: '#475569',
  },
  muteActiveBtn: {
    backgroundColor: '#F59E0B',
  },
  btnIcon: {
    fontSize: 28,
    color: '#fff',
  },
  btnLabel: {
    fontSize: 11,
    color: '#fff',
    marginTop: 4,
  },
});
