import { Platform, Alert } from 'react-native';

// Web の window.confirm 相当を非同期で扱える Promise<boolean>
export function confirmDialog(message: string, title = '確認'): Promise<boolean> {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return Promise.resolve(window.confirm(message));
  }
  return new Promise<boolean>((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: 'キャンセル', style: 'cancel', onPress: () => resolve(false) },
        { text: 'OK', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

// Web の window.alert 相当
export function alertDialog(message: string, title = ''): void {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.alert(message);
    return;
  }
  Alert.alert(title || 'お知らせ', message);
}

// localStorage 相当 (Web のみ動作、ネイティブでは no-op)
export function nxStorageGet(key: string): string | null {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  return null;
}

export function nxStorageSet(key: string, value: string): void {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    try { localStorage.setItem(key, value); } catch {}
  }
}

// CSS 注入 (Web のみ、ネイティブでは no-op)
export function injectStyleOnce(id: string, css: string): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  if (document.getElementById(id)) return;
  const el = document.createElement('style');
  el.id = id;
  el.textContent = css;
  document.head.appendChild(el);
}

// Blob ダウンロード (Web は a タグ、ネイティブはアラート表示)
export function downloadBlob(blob: Blob, filename: string): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined') {
    Alert.alert('ダウンロード未対応', `「${filename}」のダウンロードはWeb版でご利用ください。`);
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
