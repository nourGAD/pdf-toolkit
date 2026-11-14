import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { getContentUriAsync } from 'expo-file-system/legacy';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { Incoming } from '../../modules/doc-scanner';
import { settings } from '../theme';

/**
 * "Make PDF Toolkit your default PDF app".
 * Android never lets an app make itself the default — the user picks it once with "Always".
 * We check who opens PDFs today, and open Android's "Open with" sheet on a small sample PDF so the user can choose us.
 */
export type DefaultStatus = { state: 'self' | 'none' | 'other' | 'unknown'; pkg?: string; label?: string };

export const SAMPLE_NAME = 'PDF Toolkit default check.pdf';
const SNOOZE_DAYS = 10;

export function defaultStatus(): DefaultStatus {
  if (Platform.OS !== 'android' || !Incoming?.defaultHandler) return { state: 'unknown' };
  try {
    const r = Incoming.defaultHandler('application/pdf');
    if (r === 'self' || r === 'none') return { state: r };
    const pkg = r.replace(/^other:/, '');
    return { state: 'other', pkg, label: Incoming.appLabel?.(pkg) ?? pkg };
  } catch {
    return { state: 'unknown' };
  }
}

export function shouldShowDefaultCard(s: DefaultStatus): boolean {
  if (s.state !== 'none' && s.state !== 'other') return false;
  const until = settings.read().defaultCardSnoozeUntil as number | undefined;
  return !until || Date.now() > until;
}

export const snoozeDefaultCard = () => settings.write({ defaultCardSnoozeUntil: Date.now() + SNOOZE_DAYS * 86400000 });

async function samplePdf(): Promise<string> {
  const f = new File(Paths.cache, SAMPLE_NAME);
  if (!f.exists) {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    const page = doc.addPage([420, 300]);
    page.drawText('PDF Toolkit', { x: 40, y: 200, size: 30, font, color: rgb(0.12, 0.56, 0.9) });
    page.drawText('Choose PDF Toolkit and tap "Always".', { x: 40, y: 150, size: 14, font, color: rgb(0.2, 0.2, 0.2) });
    f.create({ overwrite: true });
    f.write(await doc.save());
  }
  return getContentUriAsync(f.uri);
}

/** Opens Android's "Open with" sheet. Returns false when it could not be shown. */
export async function askToBeDefault(): Promise<boolean> {
  if (!Incoming?.openWithChooser) return false;
  return Incoming.openWithChooser(await samplePdf(), 'application/pdf');
}

/** Another app is the default: open its App info → "Open by default" → "Clear defaults". */
export const openOtherAppInfo = (pkg: string) => Incoming?.openAppInfo?.(pkg) ?? false;

/** The sample file came back to us = the user picked PDF Toolkit. */
export const isSampleFile = (name?: string | null) => !!name && name.includes('PDF Toolkit default check');
