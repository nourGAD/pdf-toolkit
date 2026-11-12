import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { File, Paths } from 'expo-file-system';

export type Theme = {
  dark: boolean;
  bg: string; // screen background
  bg2: string; // reader canvas / segmented track
  card: string; // cards, inputs, sheets
  card2: string; // thumbnails, subtle fills
  text: string;
  sub: string;
  muted: string;
  faint: string;
  border: string;
  accent: string;
  accentSoft: string;
  overlay: string;
  barBg: string;
};

const light: Theme = {
  dark: false,
  bg: '#F6F7FB',
  bg2: '#E9EBF0',
  card: '#FFFFFF',
  card2: '#EEF0F4',
  text: '#1B1E28',
  sub: '#5B6170',
  muted: '#8A8F9C',
  faint: '#B5B9C4',
  border: '#E1E4EC',
  accent: '#1F8FE5',
  accentSoft: '#E8F2FC',
  overlay: 'rgba(0,0,0,0.35)',
  barBg: 'rgba(246,247,251,0.97)',
};

const dark: Theme = {
  dark: true,
  bg: '#0E0F12',
  bg2: '#16181D',
  card: '#1A1C22',
  card2: '#24272F',
  text: '#E6E8EE',
  sub: '#A3A9B6',
  muted: '#7D8392',
  faint: '#5A606C',
  border: '#2C2F38',
  accent: '#4BA8F0',
  accentSoft: '#15283A',
  overlay: 'rgba(0,0,0,0.6)',
  barBg: 'rgba(14,15,18,0.97)',
};

export type ThemeMode = 'system' | 'light' | 'dark';

type Ctx = { theme: Theme; mode: ThemeMode; setMode: (m: ThemeMode) => void; cycle: () => void };
const ThemeContext = createContext<Ctx>({ theme: light, mode: 'system', setMode: () => {}, cycle: () => {} });

const settingsFile = () => new File(Paths.document, 'settings.json');
function readSettings(): Record<string, unknown> {
  try {
    const f = settingsFile();
    return f.exists ? JSON.parse(f.textSync()) : {};
  } catch {
    return {};
  }
}
function writeSettings(patch: Record<string, unknown>) {
  try {
    const f = settingsFile();
    const next = { ...readSettings(), ...patch };
    if (!f.exists) f.create();
    f.write(JSON.stringify(next));
  } catch {}
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>(() => (readSettings().theme as ThemeMode) ?? 'system');
  const setMode = (m: ThemeMode) => {
    setModeState(m);
    writeSettings({ theme: m });
  };
  const isDark = mode === 'dark' || (mode === 'system' && system === 'dark');
  const value = useMemo<Ctx>(
    () => ({
      theme: isDark ? dark : light,
      mode,
      setMode,
      cycle: () => setMode(mode === 'system' ? (isDark ? 'light' : 'dark') : mode === 'dark' ? 'light' : 'dark'),
    }),
    [isDark, mode],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

/** Memoised themed StyleSheet: const styles = useStyles(makeStyles) */
const cache = new WeakMap<object, { light?: unknown; dark?: unknown }>();
export function useStyles<T>(make: (t: Theme) => T): T {
  const { theme } = useTheme();
  let entry = cache.get(make);
  if (!entry) cache.set(make, (entry = {}));
  const key = theme.dark ? 'dark' : 'light';
  if (!entry[key]) entry[key] = make(theme);
  return entry[key] as T;
}

/** small helper for the reader's resume prefs etc. */
export const settings = { read: readSettings, write: writeSettings };
