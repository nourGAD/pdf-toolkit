import * as StoreReview from 'expo-store-review';
import { settings } from '../theme';

/**
 * Ask for a Play Store rating once, right after the user's 3rd successful result
 * (a happy moment, never in the middle of a task). Google decides whether the dialog really shows.
 */
export async function countSuccessAndMaybeAskForReview() {
  try {
    const s = settings.read();
    const done = (Number(s.successCount) || 0) + 1;
    settings.write({ successCount: done });
    if (done < 3 || s.reviewAsked) return;
    if (!(await StoreReview.isAvailableAsync())) return;
    settings.write({ reviewAsked: true });
    setTimeout(() => StoreReview.requestReview().catch(() => {}), 1200);
  } catch {
    /* never let this break a tool */
  }
}
