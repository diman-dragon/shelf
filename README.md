# Shelf — Capacitor

Единственная реализация приложения: Capacitor (`www/` + `android/`).

## Локальный запуск

```bash
npm install
npx cap sync android
npx cap open android
```

Для сборки APK:

```bash
npm install
npm run android:build
```

APK: `android/app/build/outputs/apk/debug/app-debug.apk`.

## GitHub Actions

Workflow `.github/workflows/android.yml` автоматически собирает debug APK при push/PR в `main` или `master`, а также вручную через **Actions → Android APK → Run workflow**.

После сборки APK доступен в **Actions → workflow run → Artifacts → shelf-debug-apk**.

CI устанавливает Node.js 22, Java 21, выполняет `npm install`, `npx cap sync android` и `./gradlew assembleDebug`.


## GitHub Actions

Workflow: `.github/workflows/android.yml`. It installs Node 22 and Java 21, runs `npm install`, synchronizes Capacitor, verifies the Gradle wrapper, and builds `app-debug.apk`. The APK is published as the `shelf-debug-apk` artifact.

The repository intentionally contains only the Capacitor application (`www/` + `android/`).
