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
