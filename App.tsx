import { Buffer } from 'buffer';
import { useEffect, useState } from 'react';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Alert, BackHandler, Platform, StyleSheet, View } from 'react-native';
import HomeScreen from './src/screens/HomeScreen';
import ToolScreen from './src/screens/ToolScreen';
import ReaderScreen from './src/screens/ReaderScreen';
import DocxReaderScreen from './src/screens/DocxReaderScreen';
import { Tool } from './src/tools';
import { LibraryDoc, openInLibrary } from './src/lib/library';
import { ThemeProvider, useTheme } from './src/theme';
import { TOOLS } from './src/tools';
import { IncomingAction, getInitialIncoming, importIncoming, onIncoming } from './src/lib/incoming';
import { reportError } from './src/lib/crash';

// pdf-lib / jszip expect Buffer in some code paths
(globalThis as any).Buffer ??= Buffer;

type Route = { name: 'home' } | { name: 'tool'; tool: Tool; autoScan?: boolean } | { name: 'reader'; doc: LibraryDoc };

export default function App() {
  return (
    <ThemeProvider>
      <Root />
    </ThemeProvider>
  );
}

function Root() {
  const { theme } = useTheme();
  const [route, setRoute] = useState<Route>({ name: 'home' });
  const home = () => setRoute({ name: 'home' });

  // "Open with" / "Share" from other apps, and the home-screen Scan widget
  useEffect(() => {
    const handle = async (a: IncomingAction) => {
      try {
        if (a.type === 'scan') {
          const scan = TOOLS.find((t) => t.id === 'jpg2pdf');
          if (scan) setRoute({ name: 'tool', tool: scan, autoScan: true });
          return;
        }
        const file = await importIncoming(a.item);
        setRoute({ name: 'reader', doc: await openInLibrary(file, true) });
      } catch (e: any) {
        reportError(e, 'incoming');
        Alert.alert('Could not open file', e?.message ?? String(e));
      }
    };
    const first = getInitialIncoming();
    if (first) handle(first);
    return onIncoming(handle);
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (route.name !== 'home') {
        home();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [route]);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={[styles.root, { backgroundColor: theme.bg }]} edges={['top', 'bottom']}>
        <StatusBar style={theme.dark ? 'light' : 'dark'} />
        <View style={[styles.root, { backgroundColor: theme.bg }]}>
          {route.name === 'tool' && (
            <ToolScreen
              key={route.tool.id + (route.autoScan ? '_scan' : '')}
              tool={route.tool}
              autoScan={route.autoScan}
              onBack={home}
              onRead={async (f) => setRoute({ name: 'reader', doc: await openInLibrary(f) })}
            />
          )}
          {route.name === 'reader' &&
            (route.doc.kind === 'docx' ? (
              <DocxReaderScreen key={route.doc.id} doc={route.doc} onBack={home} />
            ) : (
              <ReaderScreen key={route.doc.id} doc={route.doc} onBack={home} />
            ))}
          {route.name === 'home' && (
            <HomeScreen
              onOpen={(tool) => setRoute({ name: 'tool', tool })}
              onRead={(doc) => setRoute({ name: 'reader', doc })}
            />
          )}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F6F7FB' },
});
