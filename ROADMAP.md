# Taiko Metronome - Development Roadmap

## Current Status
✅ Web app fully functional with:
- 6 instruments with custom sounds
- Pitch & volume controls
- Time signatures (4/4, 3/4, 6/8)
- Pattern sequencer
- Swing rhythm
- Save/load patterns
- Mobile responsive design

⚠️ **Known Issue:** Audio only works through Bluetooth on mobile, not phone speaker

## Goal
Convert to native iOS/Android apps for:
- App Store & Play Store distribution (especially for Chinese users)
- Fully offline functionality
- Better mobile audio handling
- All platforms: iOS, iPad, Android, Mac, Web

---

## Phase 1: Convert to PWA (Progressive Web App)
**Time estimate:** 2-3 hours  
**Why:** Makes app installable, fully offline, fixes audio issues

### Tasks:
1. **Create `manifest.json`**
   - App name, icons, theme colors
   - Display mode: standalone (fullscreen)
   - Start URL

2. **Create `service-worker.js`**
   - Cache all assets (HTML, CSS, JS, WAV files)
   - Offline-first strategy
   - Cache version management

3. **Update `index.html`**
   - Link manifest.json
   - Register service worker
   - Add apple-touch-icon meta tags

4. **Create app icons**
   - 192x192px and 512x512px PNG
   - Apple touch icon (180x180px)
   - Favicon

5. **Test PWA**
   - Chrome: Install from address bar
   - iOS Safari: Add to Home Screen
   - Verify offline functionality
   - Test audio on mobile

**Files to create:**
- `manifest.json`
- `service-worker.js`
- `icons/` directory with icon files

---

## Phase 2: Add Capacitor (Web → Native App)
**Time estimate:** 1-2 hours  
**Why:** Packages PWA into native iOS/Android apps for App Store distribution

### Tasks:
1. **Install Capacitor**
   ```bash
   npm init -y
   npm install @capacitor/core @capacitor/cli
   npx cap init "Taiko Metronome" "com.zoutong.taiko"
   ```

2. **Add platforms**
   ```bash
   npm install @capacitor/ios @capacitor/android
   npx cap add ios
   npx cap add android
   ```

3. **Configure Capacitor**
   - Edit `capacitor.config.json`
   - Set webDir to current directory
   - Configure app permissions (microphone for future BPM feature)

4. **Copy web assets**
   ```bash
   npx cap copy
   npx cap sync
   ```

5. **Open native projects**
   ```bash
   npx cap open ios      # Opens Xcode
   npx cap open android  # Opens Android Studio
   ```

**Files created automatically:**
- `capacitor.config.json`
- `ios/` directory (Xcode project)
- `android/` directory (Android Studio project)

---

## Phase 3: Build & Submit to App Stores
**Time estimate:** 2-4 hours (first time)

### iOS (Xcode):
1. Open `ios/App/App.xcworkspace` in Xcode
2. Configure signing (Apple Developer account required)
3. Set bundle identifier: `com.zoutong.taiko`
4. Build for device/simulator
5. Archive and upload to App Store Connect
6. Fill out App Store listing
7. Submit for review

### Android (Android Studio):
1. Open `android/` folder in Android Studio
2. Configure signing certificate
3. Set package name: `com.zoutong.taiko`
4. Build APK/AAB
5. Upload to Google Play Console
6. Fill out Play Store listing
7. Submit for review

**Requirements:**
- Apple Developer account ($99/year) for iOS
- Google Play Developer account ($25 one-time) for Android
- App screenshots, descriptions, privacy policy

---

## Phase 4: Add BPM Detection (Future Feature)
**Time estimate:** 3-4 hours

### Feature: Tap tempo & audio-based BPM detection
1. **Tap Tempo**
   - User taps button to rhythm
   - Calculate BPM from tap intervals
   - Display average BPM

2. **Audio Detection**
   - Request microphone permission
   - Use Web Audio API `AnalyserNode`
   - Detect beat onsets from frequency data
   - Calculate tempo from onset intervals
   - Keep history of detected tempos

3. **UI Updates**
   - Add BPM detection section
   - "Start Listening" button
   - Real-time BPM display
   - History/log of measurements

**Web Audio APIs needed:**
- `getUserMedia()` for microphone
- `AnalyserNode` for frequency analysis
- Beat detection algorithm (Onset detection)

---

## Technical Notes

### Mobile Audio Issues (Current)
- Web Audio API has strict policies on mobile
- AudioContext must be resumed on user gesture
- Silent buffer technique used but routing to Bluetooth instead of speaker
- **Solution:** Native wrapper (Capacitor) uses native audio APIs

### Offline Support Strategy
- Service worker caches all assets
- WAV files stored in app bundle
- No internet required after installation
- LocalStorage for patterns persists offline

### File Structure After PWA + Capacitor
```
taiko/
├── index.html
├── script.js
├── styles.css
├── manifest.json          # NEW
├── service-worker.js      # NEW
├── icons/                 # NEW
│   ├── icon-192.png
│   ├── icon-512.png
│   └── apple-touch-icon.png
├── split_sounds/
├── capacitor.config.json  # NEW (Phase 2)
├── package.json           # NEW (Phase 2)
├── ios/                   # NEW (Phase 2)
│   └── App/
└── android/               # NEW (Phase 2)
    └── app/
```

### Update Workflow (After App Store deployment)
1. Make changes to HTML/CSS/JS
2. Test locally
3. Commit to GitHub
4. Run `npx cap copy` to update native projects
5. Rebuild in Xcode/Android Studio
6. Submit update to App Stores
7. Users get update through App Store

---

## Resources & Documentation

### Capacitor
- Official docs: https://capacitorjs.com/
- Getting started: https://capacitorjs.com/docs/getting-started
- iOS guide: https://capacitorjs.com/docs/ios
- Android guide: https://capacitorjs.com/docs/android

### PWA
- MDN PWA guide: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps
- Service Workers: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
- Web App Manifest: https://developer.mozilla.org/en-US/docs/Web/Manifest

### App Store Submission
- Apple: https://developer.apple.com/app-store/submissions/
- Google Play: https://play.google.com/console/about/guides/releasewithconfidence/

### BPM Detection
- Web Audio API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API
- Onset detection algorithms: https://github.com/meyda/meyda

---

## Next Steps (When You Return)

1. **Start with Phase 1 (PWA conversion)**
   - Creates immediate value (installable, offline)
   - Tests app behavior as "installed app"
   - Fixes mobile audio routing issues
   - ~2 hours of work

2. **Move to Phase 2 (Capacitor)**
   - Only if Phase 1 PWA experience is acceptable
   - Enables App Store distribution
   - ~1 hour of setup

3. **Consider Phase 3 (App Store submission)**
   - Requires developer accounts
   - Plan 1-2 weeks for review process
   - Create marketing materials (screenshots, description)

**Come back to this file and pick up from Phase 1, Task 1!**
