import { forwardRef, useImperativeHandle, useRef } from 'react';
import type { ComponentType, Ref } from 'react';
import { View } from 'react-native';
import { WebView as RNWebView } from 'react-native-webview';
import { TEXT_IMAGE_HTML } from '../watermark/textImageHtml';

type WebViewHandle = { injectJavaScript: (code: string) => void };
const WebView = RNWebView as unknown as ComponentType<{
  ref?: Ref<WebViewHandle>;
  source: { html: string };
  originWhitelist: string[];
  onMessage: (e: { nativeEvent: { data: string } }) => void;
}>;

export type RenderedText = { base64: string; width: number; height: number };
export type TextRendererHandle = { render: (o: { text: string; color: string; bold: boolean }) => Promise<RenderedText | null> };

/** Hidden WebView that turns text (any language, Arabic shaped correctly) into a transparent PNG. */
const TextRenderer = forwardRef<TextRendererHandle>(function TextRenderer(_, ref) {
  const web = useRef<WebViewHandle>(null);
  const ready = useRef<Promise<void>>(null as any);
  const resolveReady = useRef<() => void>(() => {});
  const pending = useRef<((r: RenderedText | null) => void) | null>(null);
  if (!ready.current) ready.current = new Promise<void>((r) => (resolveReady.current = r));

  useImperativeHandle(ref, () => ({
    render: async (o) => {
      await ready.current;
      return new Promise((resolve) => {
        pending.current = resolve;
        web.current?.injectJavaScript(`window.__render(${JSON.stringify(o)});true;`);
      });
    },
  }));

  return (
    <View style={{ position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' }} pointerEvents="none">
      <WebView
        ref={web}
        source={{ html: TEXT_IMAGE_HTML }}
        originWhitelist={['*']}
        onMessage={(e) => {
          const m = JSON.parse(e.nativeEvent.data);
          if (m.type === 'ready') resolveReady.current();
          if (m.type === 'png') {
            pending.current?.(m.data ? { base64: m.data, width: m.width, height: m.height } : null);
            pending.current = null;
          }
        }}
      />
    </View>
  );
});
export default TextRenderer;
