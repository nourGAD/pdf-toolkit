import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { readBytes } from '../lib/files';
import { FormField, FormValues, readForm } from '../lib/forms';
import { Theme, useStyles, useTheme } from '../theme';

export type FormState = { values: FormValues; flatten: boolean; fields: number };

/** Lists the form's fields as normal inputs. Arabic answers are supported. */
export default function FormFiller({
  fileUri,
  value,
  onChange,
  color,
}: {
  fileUri: string;
  value: FormState;
  onChange: (v: FormState) => void;
  color: string;
}) {
  const styles = useStyles(makeStyles);
  const { theme } = useTheme();
  const [fields, setFields] = useState<FormField[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setFields(null);
    readBytes(fileUri)
      .then(readForm)
      .then((f) => {
        if (!alive) return;
        setFields(f);
        const values: FormValues = {};
        f.forEach((x) => (values[x.name] = x.value));
        onChange({ values, flatten: value.flatten, fields: f.filter((x) => !x.readOnly).length });
      })
      .catch((e) => alive && setError(e?.message ?? String(e)));
    return () => {
      alive = false;
    };
  }, [fileUri]);

  const set = (name: string, v: string | boolean) => onChange({ ...value, values: { ...value.values, [name]: v } });
  const pretty = (n: string) => n.replace(/[_.\-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();

  if (error) return <Text style={styles.err}>{error}</Text>;
  if (!fields)
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={color} />
        <Text style={styles.muted}>Reading the form…</Text>
      </View>
    );
  if (!fields.length)
    return (
      <View style={styles.none}>
        <Text style={styles.noneTitle}>This PDF has no fillable fields</Text>
        <Text style={styles.muted}>
          Use “Edit PDF” to type text anywhere on the page instead. · الملف ده مفيهوش خانات، استخدم Edit PDF وتكتب فوقه.
        </Text>
      </View>
    );

  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.muted}>{fields.length} fields · اكتب في الخانات (عربي أو إنجليزي)</Text>
      {fields.map((f) => (
        <View key={f.name} style={[styles.field, f.readOnly && { opacity: 0.5 }]}>
          <Text style={styles.label}>{pretty(f.name)}</Text>
          {f.type === 'text' && (
            <TextInput
              style={[styles.input, f.multiline && { minHeight: 80, textAlignVertical: 'top' }]}
              value={String(value.values[f.name] ?? '')}
              onChangeText={(t) => set(f.name, t)}
              editable={!f.readOnly}
              multiline={f.multiline}
              placeholderTextColor={theme.muted}
            />
          )}
          {f.type === 'checkbox' && (
            <Switch
              value={!!value.values[f.name]}
              onValueChange={(v) => set(f.name, v)}
              disabled={f.readOnly}
              trackColor={{ true: color, false: theme.border }}
            />
          )}
          {(f.type === 'dropdown' || f.type === 'radio' || f.type === 'list') && (
            <View style={styles.opts}>
              {(f.options ?? []).map((o) => {
                const on = value.values[f.name] === o;
                return (
                  <Pressable
                    key={o}
                    disabled={f.readOnly}
                    onPress={() => set(f.name, on && f.type !== 'radio' ? '' : o)}
                    style={[styles.opt, on && { backgroundColor: color, borderColor: color }]}
                  >
                    <Text style={[styles.optText, on && { color: '#fff' }]}>{o}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      ))}
      <View style={styles.flat}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Lock answers (flatten)</Text>
          <Text style={styles.muted}>The result can't be edited any more — best for sending.</Text>
        </View>
        <Switch value={value.flatten} onValueChange={(flatten) => onChange({ ...value, flatten })} trackColor={{ true: color, false: theme.border }} />
      </View>
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    loading: { alignItems: 'center', padding: 24, gap: 8 },
    err: { color: '#C0392B' },
    muted: { color: t.muted, fontSize: 12, lineHeight: 17 },
    none: { borderWidth: 1, borderColor: t.border, borderRadius: 14, padding: 14, backgroundColor: t.card, gap: 6 },
    noneTitle: { fontWeight: '800', color: t.text },
    field: { backgroundColor: t.card, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: t.border, gap: 8 },
    label: { fontSize: 14, fontWeight: '700', color: t.text },
    input: { borderWidth: 1, borderColor: t.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: t.text, textAlign: 'auto' },
    opts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    opt: { borderWidth: 1, borderColor: t.border, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
    optText: { fontWeight: '700', color: t.text },
    flat: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: t.card, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: t.border },
  });
