import { Buffer } from 'buffer';
import { useEffect, useState } from 'react';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { BackHandler, Platform, StyleSheet, View } from 'react-native';
import HomeScreen from './src/screens/HomeScreen';
import ToolScreen from './src/screens/ToolScreen';
import ReaderScreen from './src/screens/ReaderScreen';
import { Tool } from './src/tools';
import { LibraryDoc, openInLibrary } from './src/lib/library';

// pdf-lib / jszip expect Buffer in some code paths
(globalThis as any).Buffer ??= Buffer;

type Route = { name: 'home' } | { name: 'tool'; tool: Tool } | { name: 'reader'; doc: LibraryDoc };

export default function App() {
  const [route, setRoute] = useState<Route>({ name: 'home' });
  const home = () => setRoute({ name: 'home' });

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
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <StatusBar style="dark" />
        <View style={styles.root}>
          {route.name === 'tool' && (
            <ToolScreen
              tool={route.tool}
              onBack={home}
              onRead={async (f) => setRoute({ name: 'reader', doc: await openInLibrary(f) })}
            />
          )}
          {route.name === 'reader' && <ReaderScreen key={route.doc.id} doc={route.doc} onBack={home} />}
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
