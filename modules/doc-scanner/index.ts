import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

type DocScannerNative = { scan(pageLimit: number, allowGallery: boolean): Promise<string[]> };

/** Android only (ML Kit). Other platforms fall back to the camera + 4-corner crop. */
export const DocScanner =
  Platform.OS === 'android' ? requireOptionalNativeModule<DocScannerNative>('DocScanner') : null;

export type IncomingItem = { uri: string; mimeType?: string | null; name?: string | null };
type IncomingNative = {
  getInitial(): IncomingItem | null;
  addListener(event: 'onIncoming', cb: (item: IncomingItem) => void): { remove(): void };
  /** "self" | "none" | "other:<package>" — added in v1.9 (missing on older native builds) */
  defaultHandler?(mimeType: string): string;
  appLabel?(pkg: string): string;
  openWithChooser?(contentUri: string, mimeType: string): boolean;
  openAppInfo?(pkg: string): boolean;
};

/** Files/links the app was opened with ("Open with", "Share", widget). Android only. */
export const Incoming = Platform.OS === 'android' ? requireOptionalNativeModule<IncomingNative>('Incoming') : null;
