import * as Sentry from '@sentry/react-native';
import appJson from '../../app.json';

/**
 * Crash & error reporting (Sentry). Stays OFF until a DSN is set in app.json → expo.extra.sentryDsn
 * (or EXPO_PUBLIC_SENTRY_DSN). No file contents, file names or personal data are sent.
 */
const DSN: string = process.env.EXPO_PUBLIC_SENTRY_DSN || (appJson.expo.extra as { sentryDsn?: string }).sentryDsn || '';
export const crashReportingOn = DSN.length > 0;

export function initCrashReporting() {
  if (!crashReportingOn) return;
  Sentry.init({
    dsn: DSN,
    release: `pdf-toolkit@${appJson.expo.version}`,
    enabled: !__DEV__,
    sendDefaultPii: false,
    tracesSampleRate: 0, // errors only — no performance tracking
    // console logs can contain file names → never attach them
    beforeBreadcrumb: (b) => (b.category === 'console' ? null : b),
  });
}

/** Report a handled error (e.g. a tool failed). `where` is a short label like "tool:merge". */
export function reportError(error: unknown, where: string) {
  if (!crashReportingOn) return;
  Sentry.captureException(error instanceof Error ? error : new Error(String(error)), { tags: { where } });
}

export const wrapApp = <T,>(App: T): T => (crashReportingOn ? (Sentry.wrap(App as any) as T) : App);
