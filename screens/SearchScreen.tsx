import React, { useState } from 'react';
import {
  View, Text, TextInput, FlatList,
  TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { supabase } from '../lib/supabase';

type SearchResult = {
  id: string;
  content: string;
  created_at: string;
  channel_id: string;
  sender_id: string;
  profiles: { display_name: string } | null;
  channels: { name: string } | null;
};

type Props = {
  onBack: () => void;
  onSelectChannel: (channelId: string, channelName: string) => void;
};

export default function SearchScreen({ onBack, onSelectChannel }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setSearched(true);

    const { data, error } = await supabase
      .from('messages')
      .select('id, content, created_at, channel_id, sender_id, profiles!messages_sender_id_fkey(display_name), channels(name)')
      .ilike('content', `%${query.trim()}%`)
      .order('created_at', { ascending: false })
      .limit(30);

    if (error) console.log('検索エラー:', error.message);
    if (data) setResults(data as SearchResult[]);
    setLoading(false);
  };

  const highlight = (text: string, keyword: string) => {
    const index = text.toLowerCase().indexOf(keyword.toLowerCase());
    if (index === -1) return text;
    const start = Math.max(0, index - 20);
    const end = Math.min(text.length, index + keyword.length + 40);
    const excerpt = (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '');
    return excerpt;
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.back}>← 戻る</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>メッセージ検索</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="キーワードを入力..."
          returnKeyType="search"
          onSubmitEditing={search}
          autoFocus
        />
        <TouchableOpacity style={styles.searchButton} onPress={search}>
          <Text style={styles.searchButtonText}>検索</Text>
        </TouchableOpacity>
      </View>

      {loading && (
        <ActivityIndicator style={{ marginTop: 40 }} size="large" color="#1A3C8F" />
      )}

      {!loading && searched && results.length === 0 && (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>「{query}」に一致するメッセージが見つかりませんでした</Text>
        </View>
      )}

      {!loading && results.length > 0 && (
        <Text style={styles.resultCount}>{results.length}件見つかりました</Text>
      )}

      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.resultItem}
            onPress={() => item.channels && onSelectChannel(item.channel_id, item.channels.name)}
          >
            <View style={styles.resultHeader}>
              <Text style={styles.channelName}>
                # {item.channels?.name ?? '不明'}
              </Text>
              <Text style={styles.resultTime}>
                {new Date(item.created_at).toLocaleDateString('ja-JP', {
                  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                })}
              </Text>
            </View>
            <Text style={styles.senderName}>
              {item.profiles?.display_name ?? '不明'}
            </Text>
            <Text style={styles.resultContent}>
              {highlight(item.content, query)}
            </Text>
          </TouchableOpacity>
        )}
        contentContainerStyle={styles.list}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, paddingTop: 48, backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#eee',
  },
  back: { color: '#1A3C8F', fontSize: 16, width: 60 },
  headerTitle: { fontSize: 16, fontWeight: 'bold', color: '#333' },
  searchBar: {
    flexDirection: 'row', padding: 12, gap: 8,
    borderBottomWidth: 1, borderBottomColor: '#eee',
  },
  searchInput: {
    flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 8, fontSize: 15,
    backgroundColor: '#f8f8f8',
  },
  searchButton: {
    backgroundColor: '#1A3C8F', borderRadius: 20,
    paddingHorizontal: 16, justifyContent: 'center',
  },
  searchButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyText: { fontSize: 14, color: '#999', textAlign: 'center', lineHeight: 22 },
  resultCount: {
    fontSize: 12, color: '#999', paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: '#f8f8f8', borderBottomWidth: 1, borderBottomColor: '#eee',
  },
  list: { paddingBottom: 20 },
  resultItem: {
    padding: 16, borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  resultHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  channelName: { fontSize: 13, color: '#1A3C8F', fontWeight: '600' },
  resultTime: { fontSize: 12, color: '#999' },
  senderName: { fontSize: 13, color: '#666', marginBottom: 4 },
  resultContent: { fontSize: 14, color: '#333', lineHeight: 20 },
});