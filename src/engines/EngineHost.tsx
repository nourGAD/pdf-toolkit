import { forwardRef, useImperativeHandle, useRef } from 'react';
import type { ComponentType, Ref } from 'react';
import { View } from 'react-native';
import { WebView as RNWebView } from 'react-native-webview';

type WebViewHandle = { injectJavaScript: (code: string) => void };
const WebView = RNWebView as unknown as ComponentType<{
  ref?: Ref<WebViewHandle>;
  source: { html: string };
  originWhitelist: string[];
  onMessage: (e: { nativeEvent: { data: string } }) => void;
}>;

export type EngineCall = (
  fn: string,
  payloadBase64: string | null,
  args?: unknown[],
  onProgress?: (p: number) => void,
) => Promise<Record<string, any>>;
export type EngineHandle = { call: EngineCall };

const CHUNK = 900_000; // characters per message into the WebView

/**
 * Hidden WebView that runs heavy JS work (OCR, image re-encoding, Word conversion) off the main JS thread.
 * Protocol: __begin(id) + __chunk(id, piece)… then window[fn](id, ...args);
 * the page answers {type:'done', id, ...} or {type:'error', id, message}; optional {type:'progress', id, p}.
 */
const EngineHost = forwardRef<EngineHandle, { html: string }>(function EngineHost({ html }, ref) {
  const web = useRef<WebViewHandle>(null);
  const resolveReady = useRef<(err?: Error) => void>(() => {});
  const ready = useRef<Promise<void> | null>(null);
  if (!ready.current)
    ready.current = new Promise<void>((res, rej) => (resolveReady.current = (err) => (err ? rej(err) : res())));
  const waiting = useRef(new Map<string, { res: (v: any) => void; rej: (e: Error) => void; prog?: (p: number) => void }>());
  const seq = useRef(0);
  const js = (c: string) => web.current?.injectJavaScript(`${c};true;`);

  useImperativeHandle(ref, () => ({
    call: async (fn, payload, args = [], onProgress) => {
      await ready.current;
      const id = `c${++seq.current}`;
      const p = new Promise<Record<string, any>>((res, rej) => waiting.current.set(id, { res, rej, prog: onProgress }));
      if (payload !== null) {
        js(`window.__begin(${JSON.stringify(id)})`);
        for (let i = 0; i < payload.length; i += CHUNK) {
          js(`window.__chunk(${JSON.stringify(id)}, ${JSON.stringify(payload.slice(i, i + CHUNK))})`);
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      js(`window[${JSON.stringify(fn)}](${[id, ...args].map((a) => JSON.stringify(a)).join(',')})`);
      return p;
    },
  }));

  return (
    <View style={{ position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' }} pointerEvents="none">
      <WebView
        ref={web}
        source={{ html }}
        originWhitelist={['*']}
        onMessage={(e) => {
          const m = JSON.parse(e.nativeEvent.data);
          if (m.type === 'ready') return resolveReady.current();
          const w = waiting.current.get(m.id);
          if (m.type === 'error' && !m.id) return resolveReady.current(new Error(m.message)); // engine failed to start
          if (!w) return;
          if (m.type === 'progress') return w.prog?.(m.p);
          waiting.current.delete(m.id);
          if (m.type === 'error') w.rej(new Error(m.message));
          else w.res(m);
        }}
      />
    </View>
  );
});
export default EngineHost;
