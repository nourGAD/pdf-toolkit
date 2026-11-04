import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

type DocScannerNative = { scan(pageLimit: number, allowGallery: boolean): Promise<string[]> };

/** Android only (ML Kit). On iOS the app uses VisionKit via react-native-document-scanner-plugin. */
export const DocScanner =
  Platform.OS === 'android' ? requireOptionalNativeModule<DocScannerNative>('DocScanner') : null;
