# Shipping Iron Front as a mobile app

The web build in `dist/` _is_ the app. Capacitor wraps it in a native shell,
so nothing about the game changes between the browser and the store build.

## One-time setup

The native projects are generated, not committed (see `.gitignore`), so a fresh
clone creates them:

```bash
npm install
npm run build            # dist/ must exist before cap add
npx cap add android      # requires Android Studio + JDK 17
npx cap add ios          # macOS only: Xcode + CocoaPods
```

`capacitor.config.json` drives both: app id `com.rbsystems.ironfront`, web
directory `dist`, and a `#14130F` background so there is no white flash between
the splash screen and the first frame.

## The everyday loop

```bash
npm run android          # build + sync + open Android Studio
npm run android:run      # build + sync + run on a connected device
npm run ios              # build + sync + open Xcode
```

`cap sync` copies `dist/` into the native project and reconciles plugins. Run it
after **every** web build — a stale `dist/` is the usual reason a change does
not show up on the device.

### Live reload on a real phone

Faster than a rebuild per change. Start the dev server, point the shell at it:

```bash
npm run dev              # note the Network: http://192.168.x.x:5173 line
npx cap run android --live-reload --host 192.168.x.x --port 5173
```

Phone and computer must be on the same network. Undo it with a plain
`npm run cap:sync` before you build anything you intend to install.

## How the native half is reached

`src/platform/native.js` imports nothing. Capacitor injects its bridge on
`window.Capacitor` before the first script runs, so the shell feature-detects it
and every call is a silent no-op in a browser. The plugin packages still belong
in `package.json` — the Gradle and CocoaPods tooling reads them from there to
compile the native halves — but the browser bundle never pulls in their web
stubs.

What the shell wires up today:

| Behaviour                       | Plugin                  | Falls back to                                |
| ------------------------------- | ----------------------- | -------------------------------------------- |
| Edge-to-edge, hidden status bar | `@capacitor/status-bar` | nothing — the browser is already full-bleed  |
| Hardware back → pause menu      | `@capacitor/app`        | nothing                                      |
| Backgrounding pauses the battle | `@capacitor/app`        | `visibilitychange`, already in the engine    |
| Order confirmation tick         | `@capacitor/haptics`    | `navigator.vibrate(8)`                       |
| Screen stays lit in battle      | —                       | `navigator.wakeLock`, same code path on both |

Notches and gesture bars are handled in CSS: `src/styles/safe-area.css` reads
`env(safe-area-inset-*)`, and the shell also writes `--inset-*` on `<html>` for
webviews that report nothing.

## Icons and splash

`npm run icons` regenerates every size from one procedural emblem in
`scripts/gen-icons.mjs` — no design tool, no dependency. It writes the PWA icons
into `public/icons/` and `resources/icon.png` + `resources/splash.png` at
1024×1024 for the native shells. To push those into the native projects:

```bash
npx @capacitor/assets generate --iconBackgroundColor '#14130F' --splashBackgroundColor '#14130F'
```

Replace the emblem in `scripts/gen-icons.mjs` with real artwork before release;
everything else about the pipeline stays the same.

## Release checklist

**Android**

1. `keytool -genkey -v -keystore ironfront.keystore -alias ironfront -keyalg RSA -keysize 2048 -validity 10000`
2. Keep the keystore and its passwords out of the repo — `*.keystore` is
   git-ignored. Put them in CI secrets, not in `build.gradle`.
3. Set `versionCode` and `versionName` in `android/app/build.gradle`.
4. `cd android && ./gradlew bundleRelease` → `app-release.aab` for Play.
5. Play Console requires: a privacy policy URL, a data-safety declaration
   (this game collects nothing — say so), a content rating questionnaire, and a
   target API level no more than one year behind current.

**iOS**

1. Set the bundle identifier and team in Xcode → Signing & Capabilities.
2. Bump `CFBundleShortVersionString` and `CFBundleVersion`.
3. Product → Archive → Distribute App.
4. App Store Connect requires an age rating, a privacy nutrition label (again:
   nothing is collected), and screenshots at the current required sizes.

## Known gaps before store submission

The fonts are vendored, so a packaged app never reaches the network — but note
that `npm run fonts` does, and its output is committed. Re-run it only when the
family list in `scripts/vendor-fonts.mjs` changes.

- No orientation lock. The canvas resizes correctly either way, but decide
  deliberately and set it in `AndroidManifest.xml` / `Info.plist`.
- No crash reporting on device.
