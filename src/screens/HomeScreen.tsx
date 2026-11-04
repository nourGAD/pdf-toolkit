import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { TOOLS, Tool } from '../tools';
import { pickPdfs } from '../lib/files';
import { LibraryDoc, openInLibrary, recentDocs, removeDoc } from '../lib/library';

type Props = { onOpen: (t: Tool) => void; onRead: (d: LibraryDoc) => void };

export default function HomeScreen({ onOpen, onRead }: Props) {
  const [recent, setRecent] = useState<LibraryDoc[]>([]);
  const refresh = useCallback(() => {
    recentDocs().then(setRecent).catch(() => setRecent([]));
  }, []);
  useEffect(refresh, [refresh]);

  async function openReader() {
    try {
      const [f] = await pickPdfs(false);
      if (f) onRead(await openInLibrary(f));
    } catch (e: any) {
      Alert.alert('Could not open file', e?.message ?? String(e));
    }
  }

  function confirmRemove(d: LibraryDoc) {
    Alert.alert('Remove from recent?', d.name, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => (await removeDoc(d.id), refresh()) },
    ]);
  }

  return (
    <FlatList
      data={TOOLS}
      keyExtractor={(t) => t.id}
      numColumns={2}
      contentContainerStyle={styles.list}
      columnWrapperStyle={{ gap: 12 }}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.brand}>PDF Toolkit</Text>
          <Text style={styles.tagline}>كل أدوات الـ PDF على موبايلك — بدون إنترنت</Text>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>🔒 Files never leave your phone</Text>
          </View>

          <Pressable style={({ pressed }) => [styles.reader, pressed && { opacity: 0.8 }]} onPress={openReader}>
            <Text style={styles.readerIcon}>📖</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.readerTitle}>Read PDF · قراءة</Text>
              <Text style={styles.readerSub}>Viewer, read aloud 🔊 and bookmarks 🔖</Text>
            </View>
            <Text style={styles.readerArrow}>›</Text>
          </Pressable>

          {recent.length > 0 && (
            <View style={{ marginTop: 16 }}>
              <Text style={styles.section}>Continue reading</Text>
              {recent.slice(0, 5).map((d) => (
                <Pressable key={d.id} style={styles.recent} onPress={() => onRead(d)} onLongPress={() => confirmRemove(d)}>
                  <Text style={styles.recentName} numberOfLines={1}>
                    {d.name}
                  </Text>
                  <Text style={styles.recentMeta}>
                    p. {d.lastPage}
                    {d.pages ? `/${d.pages}` : ''}
                    {d.bookmarks.length ? `  ·  🔖 ${d.bookmarks.length}` : ''}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          <Text style={[styles.section, { marginTop: 20 }]}>Tools</Text>
        </View>
      }
      renderItem={({ item }) => (
        <Pressable
          onPress={() => onOpen(item)}
          style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}
          accessibilityRole="button"
          accessibilityLabel={item.title}
        >
          <View style={[styles.icon, { backgroundColor: item.color + '1A' }]}>
            <Text style={styles.iconText}>{item.icon}</Text>
          </View>
          <Text style={styles.title}>{item.title}</Text>
          <Text style={styles.titleAr}>{item.titleAr}</Text>
          <Text style={styles.desc} numberOfLines={3}>
            {item.description}
          </Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 12 },
  header: { marginBottom: 0, marginTop: 8 },
  brand: { fontSize: 28, fontWeight: '800', color: '#1B1E28' },
  tagline: { fontSize: 15, color: '#5B6170', marginTop: 4 },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#E8F6EC',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 10,
  },
  badgeText: { color: '#1E7B3A', fontSize: 12, fontWeight: '600' },
  reader: {
    marginTop: 16,
    backgroundColor: '#1F8FE5',
    borderRadius: 18,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  readerIcon: { fontSize: 30 },
  readerTitle: { color: '#fff', fontSize: 17, fontWeight: '800' },
  readerSub: { color: '#D9ECFC', fontSize: 13, marginTop: 2 },
  readerArrow: { color: '#fff', fontSize: 30, marginTop: -4 },
  section: { fontSize: 13, fontWeight: '700', color: '#8A8F9C', textTransform: 'uppercase', marginBottom: 8 },
  recent: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  recentName: { flex: 1, fontSize: 14, fontWeight: '600', color: '#1B1E28' },
  recentMeta: { fontSize: 12, color: '#8A8F9C' },
  card: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  icon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  iconText: { fontSize: 22 },
  title: { fontSize: 15, fontWeight: '700', color: '#1B1E28', marginTop: 10 },
  titleAr: { fontSize: 13, color: '#5B6170', marginTop: 2 },
  desc: { fontSize: 12, color: '#8A8F9C', marginTop: 6, lineHeight: 16 },
});
