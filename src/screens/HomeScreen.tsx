import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, AppState, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  DefaultStatus,
  askToBeDefault,
  defaultStatus,
  openOtherAppInfo,
  shouldShowDefaultCard,
  snoozeDefaultCard,
} from '../lib/defaultApp';
import appJson from '../../app.json';
import { TOOLS, Tool } from '../tools';
import { pickDocument } from '../lib/files';
import { LibraryDoc, kindOf, openInLibrary, recentDocs, removeDoc } from '../lib/library';
import { Theme, settings, useStyles, useTheme } from '../theme';

const WHATS_NEW = [
  '🧾 Summary: key points, topics and sections of any PDF or Word file — offline',
  '📊 Dashboard: open an Excel / CSV file and get charts automatically, then choose what each chart shows',
  '⬇ Download the summary or the dashboard as PDF',
  '📂 Make PDF Toolkit your default PDF app in one tap',
  '✨ AI summary is coming soon',
];

type Props = { onOpen: (t: Tool) => void; onRead: (d: LibraryDoc) => void; onInsights: () => void; defaultTick?: number };

export default function HomeScreen({ onOpen, onRead, onInsights, defaultTick }: Props) {
  const styles = useStyles(makeStyles);
  const { theme, cycle } = useTheme();
  const version = appJson.expo.version;
  // "What's new" card: shown once after each update (not on a fresh install)
  const [showNew, setShowNew] = useState(() => {
    const s = settings.read();
    const seen = s.seenVersion as string | undefined;
    if (!seen) settings.write({ seenVersion: version });
    return !!seen && seen !== version;
  });
  const closeNew = () => {
    settings.write({ seenVersion: version });
    setShowNew(false);
  };
  const [recent, setRecent] = useState<LibraryDoc[]>([]);
  const [opening, setOpening] = useState(false);
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const tools = query
    ? TOOLS.filter((t) => `${t.title} ${t.titleAr} ${t.description} ${t.keywords ?? ''}`.toLowerCase().includes(query))
    : TOOLS;
  const refresh = useCallback(() => {
    recentDocs().then(setRecent).catch(() => setRecent([]));
  }, []);
  useEffect(refresh, [refresh]);

  // "Make PDF Toolkit your default PDF app" card (Android). Re-checked when the user comes back from Settings.
  const [def, setDef] = useState<DefaultStatus>(() => defaultStatus());
  const [hideDef, setHideDef] = useState(false);
  useEffect(() => {
    setDef(defaultStatus());
    const sub = AppState.addEventListener('change', (st) => st === 'active' && setDef(defaultStatus()));
    return () => sub.remove();
  }, [defaultTick]);
  const showDef = !hideDef && shouldShowDefaultCard(def);

  async function makeDefault() {
    if (def.state === 'other' && def.pkg) {
      Alert.alert(
        `PDFs open in ${def.label} now`,
        `To use PDF Toolkit instead:\n1. Tap “Open settings”\n2. Open by default → Clear defaults\n3. Come back and tap the button again.\n\nعشان PDF Toolkit يفتح ملفاتك: افتح الإعدادات ← Open by default ← Clear defaults، وبعدين ارجع ودوس الزرار تاني.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open settings', onPress: () => openOtherAppInfo(def.pkg!) },
        ],
      );
      return;
    }
    Alert.alert(
      'One step',
      'A sample PDF will open. Choose “PDF Toolkit” and tap “Always”.\n\nهيفتح ملف PDF تجريبي: اختار PDF Toolkit ودوس Always (دايمًا).',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          onPress: () =>
            askToBeDefault()
              .then((ok) => !ok && Alert.alert('Could not open the chooser', 'Open any PDF from Files or WhatsApp, choose PDF Toolkit and tap “Always”.'))
              .catch((e) => Alert.alert('Could not open the chooser', e?.message ?? String(e))),
        },
      ],
    );
  }

  async function openReader() {
    try {
      const f = await pickDocument();
      if (!f) return;
      const kind = kindOf(f.name, f.mimeType);
      if (kind === 'doc') {
        Alert.alert(
          'Old Word format (.doc)',
          'This reader opens .docx files. Open the file in Word or Google Docs and save it as .docx, then try again.',
        );
        return;
      }
      if (!kind) {
        Alert.alert('Unsupported file', 'Choose a PDF or a Word (.docx) file.');
        return;
      }
      setOpening(true);
      onRead(await openInLibrary(f, true));
    } catch (e: any) {
      Alert.alert('Could not open file', e?.message ?? String(e));
    } finally {
      setOpening(false);
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
      data={tools}
      keyboardShouldPersistTaps="handled"
      keyExtractor={(t) => t.id}
      numColumns={2}
      contentContainerStyle={styles.list}
      columnWrapperStyle={{ gap: 12 }}
      ListHeaderComponent={
        <View style={styles.header}>
          {showNew && (
            <View style={styles.newCard}>
              <View style={styles.newHead}>
                <Text style={styles.newTitle}>✨ What's new in v{version}</Text>
                <Pressable onPress={closeNew} hitSlop={10} accessibilityLabel="Close">
                  <Text style={styles.newClose}>✕</Text>
                </Pressable>
              </View>
              {WHATS_NEW.map((l) => (
                <Text key={l} style={styles.newLine}>
                  {l}
                </Text>
              ))}
            </View>
          )}
          <View style={styles.brandRow}>
            <Text style={styles.brand}>PDF Toolkit</Text>
            <Pressable onPress={cycle} style={styles.themeBtn} hitSlop={8} accessibilityLabel="Toggle dark mode">
              <Text style={{ fontSize: 18 }}>{theme.dark ? '☀️' : '🌙'}</Text>
            </Pressable>
          </View>
          <Text style={styles.tagline}>كل أدوات الـ PDF على موبايلك — بدون إنترنت</Text>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>🔒 Files never leave your phone</Text>
          </View>

          <Pressable
            style={({ pressed }) => [styles.reader, pressed && { opacity: 0.8 }]}
            onPress={openReader}
            disabled={opening}
          >
            {opening ? <ActivityIndicator color="#fff" style={{ width: 36 }} /> : <Text style={styles.readerIcon}>📖</Text>}
            <View style={{ flex: 1 }}>
              <Text style={styles.readerTitle}>Read PDF / Word · قراءة</Text>
              <Text style={styles.readerSub}>{opening ? 'Opening…' : 'Viewer, read aloud 🔊 and bookmarks 🔖'}</Text>
            </View>
            <Text style={styles.readerArrow}>›</Text>
          </Pressable>

          <Pressable style={({ pressed }) => [styles.insights, pressed && { opacity: 0.8 }]} onPress={onInsights}>
            <Text style={styles.readerIcon}>📊</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.insightsTitle}>Summary & Dashboard · ملخص وداشبورد</Text>
              <Text style={styles.insightsSub}>PDF, Word, Excel → key points & charts</Text>
            </View>
            <View style={styles.newPill}>
              <Text style={styles.newPillText}>NEW</Text>
            </View>
          </Pressable>

          {showDef && (
            <View style={styles.defCard}>
              <Text style={styles.defTitle}>📂 Open PDFs with PDF Toolkit</Text>
              <Text style={styles.defText}>
                {def.state === 'other'
                  ? `PDFs open in ${def.label} now. Make PDF Toolkit the default to read, summarize and edit them in one tap.`
                  : 'Make PDF Toolkit your default PDF app — files from WhatsApp, Gmail and Files open here directly.'}
              </Text>
              <View style={styles.defRow}>
                <Pressable
                  onPress={() => {
                    snoozeDefaultCard();
                    setHideDef(true);
                  }}
                  style={styles.defLater}
                >
                  <Text style={styles.defLaterText}>Not now</Text>
                </Pressable>
                <Pressable onPress={makeDefault} style={styles.defBtn}>
                  <Text style={styles.defBtnText}>Set as default · اجعله الأساسي</Text>
                </Pressable>
              </View>
            </View>
          )}

          {recent.length > 0 && (
            <View style={{ marginTop: 16 }}>
              <Text style={styles.section}>Continue reading</Text>
              {recent.slice(0, 5).map((d) => (
                <Pressable key={d.id} style={styles.recent} onPress={() => onRead(d)} onLongPress={() => confirmRemove(d)}>
                  <Text style={styles.recentName} numberOfLines={1}>
                    {d.kind === 'docx' ? '📝' : '📄'} {d.name}
                  </Text>
                  <Text style={styles.recentMeta}>
                    {d.kind === 'docx'
                      ? `${Math.round((d.pos ?? 0) * 100)}%`
                      : `p. ${d.lastPage}${d.pages ? `/${d.pages}` : ''}`}
                    {d.bookmarks.length ? `  ·  🔖 ${d.bookmarks.length}` : ''}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          <Text style={[styles.section, { marginTop: 20 }]}>Tools · {TOOLS.length}</Text>
          <TextInput
            style={styles.search}
            value={q}
            onChangeText={setQ}
            placeholder="🔍  Search tools… ابحث (ضغط، توقيع، Word…)"
            placeholderTextColor={theme.muted}
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
          {query !== '' && tools.length === 0 && <Text style={styles.empty}>No tool matches “{q}”.</Text>}
          <Text style={styles.version}>v{appJson.expo.version}</Text>
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

const makeStyles = (t: Theme) =>
  StyleSheet.create({
  list: { padding: 16, gap: 12 },
  header: { marginBottom: 0, marginTop: 8 },
  newCard: { backgroundColor: t.accentSoft, borderRadius: 16, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: t.border, gap: 4 },
  newHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  newTitle: { fontSize: 16, fontWeight: '800', color: t.text },
  newClose: { fontSize: 18, color: t.muted },
  newLine: { fontSize: 13.5, color: t.text, lineHeight: 20 },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  themeBtn: { backgroundColor: t.card, borderRadius: 999, width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: t.border },
  brand: { fontSize: 28, fontWeight: '800', color: t.text },
  tagline: { fontSize: 15, color: t.sub, marginTop: 4 },
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
    backgroundColor: t.accent,
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
  insights: { marginTop: 10, backgroundColor: t.card, borderRadius: 18, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderColor: t.border },
  insightsTitle: { color: t.text, fontSize: 16, fontWeight: '800' },
  insightsSub: { color: t.muted, fontSize: 13, marginTop: 2 },
  newPill: { backgroundColor: '#2EAD5B', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  newPillText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  defCard: { marginTop: 12, backgroundColor: t.accentSoft, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: t.border, gap: 6 },
  defTitle: { color: t.text, fontSize: 15, fontWeight: '800' },
  defText: { color: t.sub, fontSize: 13.5, lineHeight: 19 },
  defRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  defLater: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, backgroundColor: t.card },
  defLaterText: { color: t.sub, fontWeight: '700' },
  defBtn: { flex: 1, paddingVertical: 10, borderRadius: 12, backgroundColor: t.accent, alignItems: 'center' },
  defBtnText: { color: '#fff', fontWeight: '800' },
  version: { position: 'absolute', top: 6, right: 0, fontSize: 12, color: t.faint, fontWeight: '600' },
  search: { backgroundColor: t.card, borderRadius: 12, borderWidth: 1, borderColor: t.border, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: t.text, marginBottom: 12 },
  empty: { color: t.muted, textAlign: 'center', marginVertical: 12 },
  section: { fontSize: 13, fontWeight: '700', color: t.muted, textTransform: 'uppercase', marginBottom: 8 },
  recent: {
    backgroundColor: t.card,
    borderRadius: 12,
    padding: 12,
    marginBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  recentName: { flex: 1, fontSize: 14, fontWeight: '600', color: t.text },
  recentMeta: { fontSize: 12, color: t.muted },
  card: {
    flex: 1,
    backgroundColor: t.card,
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
  title: { fontSize: 15, fontWeight: '700', color: t.text, marginTop: 10 },
  titleAr: { fontSize: 13, color: t.sub, marginTop: 2 },
  desc: { fontSize: 12, color: t.muted, marginTop: 6, lineHeight: 16 },
});
