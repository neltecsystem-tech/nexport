import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';

type Props = { children: React.ReactNode; onReset?: () => void };
type State = { error: Error | null; info: any };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, info: null };
  }

  componentDidCatch(error: Error, info: any) {
    this.setState({ error, info });
    try { console.log('[ErrorBoundary]', error?.message, error?.stack); } catch (_) {}
  }

  reset = () => {
    this.setState({ error: null, info: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.error) {
      const err = this.state.error;
      return (
        <ScrollView style={styles.container}>
          <Text style={styles.title}>⚠ エラーが発生しました</Text>
          <Text style={styles.subtitle}>このページを開いた時に問題が発生しました</Text>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>エラーメッセージ:</Text>
            <Text style={styles.errorText}>{err.message || String(err)}</Text>
          </View>
          {err.stack && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>スタックトレース:</Text>
              <Text style={styles.stackText}>{err.stack.slice(0, 2000)}</Text>
            </View>
          )}
          {this.state.info?.componentStack && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>コンポーネント:</Text>
              <Text style={styles.stackText}>{String(this.state.info.componentStack).slice(0, 1500)}</Text>
            </View>
          )}
          <TouchableOpacity style={styles.button} onPress={this.reset}>
            <Text style={styles.buttonText}>← 戻る</Text>
          </TouchableOpacity>
        </ScrollView>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FEF2F2', padding: 20 },
  title: { fontSize: 22, fontWeight: 'bold', color: '#DC2626', marginTop: 40 },
  subtitle: { fontSize: 14, color: '#7F1D1D', marginTop: 4, marginBottom: 20 },
  section: { backgroundColor: '#fff', padding: 12, borderRadius: 8, marginBottom: 12, borderWidth: 1, borderColor: '#FCA5A5' },
  sectionTitle: { fontSize: 13, fontWeight: 'bold', color: '#991B1B', marginBottom: 6 },
  errorText: { fontSize: 14, color: '#1F2937', fontFamily: 'monospace' },
  stackText: { fontSize: 11, color: '#374151', fontFamily: 'monospace' },
  button: { backgroundColor: '#DC2626', padding: 14, borderRadius: 8, alignItems: 'center', marginTop: 12, marginBottom: 40 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});
