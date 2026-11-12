# PDF Toolkit (Offline)

React Native + Expo app for Android & iOS. **Every tool runs on the device, with no internet and no server.**

## الأدوات (المرحلة الأولى)
| Tool | Library |
|---|---|
| Merge PDF | pdf-lib |
| Split PDF (range → PDF, or every page → ZIP) | pdf-lib + jszip |
| PDF → JPG (ZIP) | react-native-pdf-thumbnail (PDFKit / Android PdfRenderer) |
| JPG/PNG → PDF | pdf-lib |
| Rotate / Delete pages | pdf-lib |
| Page numbers / Watermark | pdf-lib |
| **Reader**: viewer + zoom, resume last page, recent files | pdf.js inside WebView (bundled offline) |
| **Read aloud** (Arabic + English, speed 0.8–1.5x, auto page-turn) | expo-speech (the phone's own TTS voices) |
| **Bookmarks** (named, per page, go-to-page) | local JSON in app storage |

All libraries are MIT or Apache-2.0, so they're free for commercial use.

`src/reader/pdfjsBundle.ts` is generated from `pdfjs-dist` by `npm install` (postinstall).

## v1.8
- Read aloud: Arabic PDFs are read in the correct order (shared line builder `src/reader/textLines.ts`, also used by PDF → Word)
- "What's new" card after each update
- One-click Play build from GitHub: Actions → **Build Android (.aab)** (needs the `EXPO_TOKEN` secret)
- `eas submit` goes to the Closed testing track (`alpha`) by default

## v1.7
- Crash reporting (Sentry) — OFF until you put a DSN in `app.json → expo.extra.sentryDsn`. No file data is ever sent.
- "Open with" / "Share" for PDF & Word from other apps; home-screen **Scan widget** (`pdftoolkit://scan`); rating prompt after the 3rd success
- New tools: Compress PDF, OCR (photo → text, searchable PDF; Arabic + English, fully offline via tesseract.js),
  Word → PDF (mammoth + expo-print), PDF → Word (text, RTL-aware), Protect / Unlock (AES-256, @cantoo/pdf-lib),
  Fill forms (Arabic answers drawn as images), Reorder pages (tap or hold-and-drag)
- Tool search on the home screen; heavy work runs in hidden WebView engines (`src/engines/EngineHost.tsx`)

## v1.6
- Sign PDF: finger signature pad (`src/edit/signatureHtml.ts`), saved signatures, place/resize, copy to all pages
- Edit PDF: add text (any language, rendered via phone fonts) and images; drag/resize; handles rotated pages (`src/lib/edit.ts`)
- Remove watermark (`src/lib/unwatermark.ts`): Word/Acrobat artifacts, watermark annotations, layers (OCG),
  repeated images/stamps, rotated repeated text, or any typed text — with before/after preview

## v1.5
- Word (.docx) reader: mammoth.js offline (`src/docx`), dark mode, A−/A+, read aloud with paragraph highlight, resume position
- Dark mode for the whole app (🌙 on Home, follows phone by default) + PDF night mode (inverted pages)
- Compress images tool: Strong / Medium / Light, before → after size, save to Gallery

## v1.4
- Removed react-native-document-scanner-plugin entirely (it threw NullPointerException). Android → own ML Kit module; fallback/iOS → camera + 4-corner crop
- PDF → JPG: separate photos, saved to Gallery (album "PDF Toolkit"); share one photo or ZIP only on request
- Reader: file is moved (not copied) when opened, loading shows MB read, Retry after 15 s, recovers if WebView crashes
- Version shown on the home screen

## v1.3
- Watermark: any text/language (Arabic shaped correctly via the phone's fonts → PNG), color, size, opacity, angle, center/repeat, live preview

## v1.2
- Android scanner = own ML Kit module (`modules/doc-scanner`) — fixes NullPointerException in the third-party plugin (still used on iOS)
- 4-corner crop with perspective correction + magnifier (`src/crop/cropHtml.ts`); gallery photos open it automatically

## v1.1
- Visual page picker (thumbnails, All / None / Odd / Even) instead of typing ranges
- Camera document scanner (ML Kit / VisionKit): auto edge detection + crop, like CamScanner
- Crop / rotate / reorder gallery photos before making the PDF
- Confirm step before processing
- Result preview (page thumbnails) before Save / Share, plus "Open in reader"
- Sticky action button (always visible)

## Structure
```
App.tsx                  navigation (Home ↔ Tool)
src/tools.ts             tool definitions — add a new tool here
src/lib/pdf.ts           all PDF operations (pure, testable)
src/lib/files.ts         pick / read / save / share files
src/lib/library.ts       recent files, last page, bookmarks
src/reader/readerHtml.ts offline pdf.js viewer (WebView)
src/screens/             HomeScreen, ToolScreen
```

## Run
> ما ينفعش يشتغل على **Expo Go**، لأن `react-native-pdf-thumbnail` native module. محتاج development build.

```bash
npm install
npm i -g eas-cli && eas login
eas build --profile development --platform android   # install the APK on your phone
npx expo start --dev-client
```
iOS: `eas build --profile development --platform ios`. البناء بيحصل على سيرفرات Expo، فمش محتاج Mac.

## Publish
```bash
eas build --profile production --platform all
eas submit --platform android   # Google Play
eas submit --platform ios       # App Store
```
Before submitting: change `bundleIdentifier` / `package` in `app.json`, replace the icons in `assets/`, and add a privacy policy URL. Since everything is offline, the policy is short: no data collected.

## Roadmap
- [ ] PDF → Text (on-device OCR via ML Kit)
- [ ] Compress PDF (re-encode images)
- [ ] Arabic UI + RTL, dark mode
- [ ] AdMob + "Remove ads" in-app purchase
