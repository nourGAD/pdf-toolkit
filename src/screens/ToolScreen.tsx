import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { PickedFile, pickImages, pickPdfs, shareFile } from '../lib/files';
import { Tool, ToolOptions, ToolResult } from '../tools';

export default function ToolScreen({ tool, onBack }: { tool: Tool; onBack: () => void }) {
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [opts, setOpts] = useState<ToolOptions>({ range: '', angle: 90, text: 'CONFIDENTIAL' });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ToolResult | null>(null);

  const multi = tool.input !== 'pdf';
  const minFiles = tool.input === 'pdfs' ? 2 : 1;

  async function choose() {
    try {
      const picked = tool.input === 'images' ? await pickImages() : await pickPdfs(multi);
      if (!picked.length) return;
      setResult(null);
      setFiles((prev) => (multi ? [...prev, ...picked] : picked));
    } catch (e: any) {
      Alert.alert('Could not open file', e?.message ?? String(e));
    }
  }

  function move(i: number, dir: -1 | 1) {
    setFiles((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      setResult(await tool.run(files, opts));
    } catch (e: any) {
      Alert.alert('Something went wrong', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
      <Pressable onPress={onBack} hitSlop={12}>
        <Text style={styles.back}>‹ Back</Text>
      </Pressable>

      <Text style={styles.h1}>
        {tool.icon} {tool.title}
      </Text>
      <Text style={styles.sub}>{tool.titleAr}</Text>
      <Text style={styles.desc}>{tool.description}</Text>

      <Pressable style={[styles.pick, { borderColor: tool.color }]} onPress={choose}>
        <Text style={[styles.pickText, { color: tool.color }]}>
          {files.length && multi ? '+ Add more' : tool.input === 'images' ? 'Select images' : 'Select PDF'}
        </Text>
      </Pressable>

      {files.map((f, i) => (
        <View key={f.uri + i} style={styles.file}>
          <Text style={styles.fileName} numberOfLines={1}>
            {multi ? `${i + 1}. ` : ''}
            {f.name}
          </Text>
          {multi && (
            <View style={styles.row}>
              <Pressable onPress={() => move(i, -1)} hitSlop={8}>
                <Text style={styles.ctrl}>▲</Text>
              </Pressable>
              <Pressable onPress={() => move(i, 1)} hitSlop={8}>
                <Text style={styles.ctrl}>▼</Text>
              </Pressable>
              <Pressable onPress={() => setFiles((p) => p.filter((_, k) => k !== i))} hitSlop={8}>
                <Text style={[styles.ctrl, { color: '#C0392B' }]}>✕</Text>
              </Pressable>
            </View>
          )}
        </View>
      ))}

      {tool.fields?.includes('range') && (
        <View style={styles.field}>
          <Text style={styles.label}>Pages</Text>
          <TextInput
            style={styles.input}
            value={opts.range}
            onChangeText={(range) => setOpts((o) => ({ ...o, range }))}
            placeholder={tool.rangeHint}
            keyboardType="numbers-and-punctuation"
            autoCorrect={false}
          />
        </View>
      )}

      {tool.fields?.includes('angle') && (
        <View style={styles.field}>
          <Text style={styles.label}>Rotation</Text>
          <View style={styles.row}>
            {([90, 180, 270] as const).map((a) => (
              <Pressable
                key={a}
                onPress={() => setOpts((o) => ({ ...o, angle: a }))}
                style={[styles.chip, opts.angle === a && { backgroundColor: tool.color, borderColor: tool.color }]}
              >
                <Text style={[styles.chipText, opts.angle === a && { color: '#fff' }]}>{a}°</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {tool.fields?.includes('text') && (
        <View style={styles.field}>
          <Text style={styles.label}>Watermark text</Text>
          <TextInput
            style={styles.input}
            value={opts.text}
            onChangeText={(text) => setOpts((o) => ({ ...o, text }))}
            autoCapitalize="characters"
          />
        </View>
      )}

      <Pressable
        disabled={busy || files.length < minFiles}
        onPress={run}
        style={[styles.cta, { backgroundColor: tool.color }, (busy || files.length < minFiles) && { opacity: 0.4 }]}
      >
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>{tool.title}</Text>}
      </Pressable>

      {result && (
        <View style={styles.done}>
          <Text style={styles.doneTitle}>✅ Done</Text>
          <Text style={styles.fileName} numberOfLines={1}>
            {result.label}
          </Text>
          <Pressable
            style={[styles.cta, { backgroundColor: '#1B1E28', marginTop: 12 }]}
            onPress={() => shareFile(result.uri, result.mimeType).catch((e) => Alert.alert('Share failed', e.message))}
          >
            <Text style={styles.ctaText}>Save / Share</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 20, paddingBottom: 48 },
  back: { fontSize: 17, color: '#1F8FE5', marginBottom: 12 },
  h1: { fontSize: 26, fontWeight: '800', color: '#1B1E28' },
  sub: { fontSize: 15, color: '#5B6170', marginTop: 2 },
  desc: { fontSize: 14, color: '#8A8F9C', marginTop: 8, marginBottom: 20, lineHeight: 20 },
  pick: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 16,
    paddingVertical: 28,
    alignItems: 'center',
    backgroundColor: '#fff',
    marginBottom: 12,
  },
  pickText: { fontSize: 17, fontWeight: '700' },
  file: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    gap: 8,
  },
  fileName: { flex: 1, fontSize: 14, color: '#1B1E28' },
  row: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  ctrl: { fontSize: 16, color: '#5B6170' },
  field: { marginTop: 12 },
  label: { fontSize: 13, fontWeight: '600', color: '#5B6170', marginBottom: 6 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E1E4EC',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  chip: { borderWidth: 1, borderColor: '#E1E4EC', borderRadius: 999, paddingHorizontal: 18, paddingVertical: 8 },
  chipText: { fontSize: 15, fontWeight: '600', color: '#1B1E28' },
  cta: { marginTop: 24, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  ctaText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  done: { marginTop: 24, backgroundColor: '#fff', borderRadius: 16, padding: 16 },
  doneTitle: { fontSize: 18, fontWeight: '800', marginBottom: 6 },
});
