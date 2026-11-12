import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Theme, useStyles, useTheme } from '../theme';

/** "Are you sure?" step: shows exactly what will happen before processing starts. */
export default function ConfirmSheet({
  visible,
  title,
  icon,
  color,
  lines,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  icon: string;
  color: string;
  lines: string[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const styles = useStyles(makeStyles);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.bg}>
        <Pressable style={{ flex: 1 }} onPress={onCancel} />
        <View style={styles.sheet}>
          <Text style={styles.title}>
            {icon} {title}
          </Text>
          <Text style={styles.sub}>Please confirm · تأكيد قبل البدء</Text>
          <View style={styles.box}>
            {lines.map((l, i) => (
              <Text key={i} style={[styles.line, i === 0 && { fontWeight: '700' }]}>
                {i === 0 ? '' : '•  '}
                {l}
              </Text>
            ))}
          </View>
          <Text style={styles.note}>🔒 Runs on your phone. Your original file is not changed.</Text>
          <View style={styles.row}>
            <Pressable style={[styles.btn, styles.cancel]} onPress={onCancel}>
              <Text style={styles.cancelText}>Back</Text>
            </Pressable>
            <Pressable style={[styles.btn, { backgroundColor: color, flex: 1.6 }]} onPress={onConfirm}>
              <Text style={styles.okText}>Start</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
  bg: { flex: 1, backgroundColor: t.overlay },
  sheet: { backgroundColor: t.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 36 },
  title: { fontSize: 20, fontWeight: '800', color: t.text },
  sub: { fontSize: 13, color: t.muted, marginTop: 2 },
  box: { backgroundColor: t.bg, borderRadius: 14, padding: 14, marginTop: 14, gap: 6 },
  line: { fontSize: 15, color: t.text, lineHeight: 21 },
  note: { fontSize: 12, color: '#1E7B3A', marginTop: 12 },
  row: { flexDirection: 'row', gap: 10, marginTop: 18 },
  btn: { flex: 1, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  cancel: { backgroundColor: t.card2 },
  cancelText: { fontSize: 16, fontWeight: '700', color: t.text },
  okText: { fontSize: 16, fontWeight: '800', color: '#fff' },
});
