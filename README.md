# AudioShelf

Локальный плеер аудиокниг. Capacitor: `www/` (веб-часть) + `android/` (нативная часть: ExoPlayer/Media3, SAF-сканер, виджет).

## Структура `www/`

| Файл | Назначение |
|---|---|
| `app.js` | точка входа: регистрирует экраны/действия в роутере, загружает состояние, кнопка «Назад» |
| `js/router.js` | `render()`, `setScreen()`, реестр экранов и действий. Модули общаются через него, поэтому **нет циклических импортов** |
| `js/db.js` | обёртка над `lib/idb-keyval.js`. Если библиотека не загрузилась — ошибка, а не молчаливая потеря данных |
| `js/storage.js` | хранение: `books` (без обложек), `cover:<id>` (по ключу на обложку), `progress` (позиции), резервная позиция в `localStorage` |
| `js/progress.js` | расчёт прогресса прослушивания |
| `js/header.js` | шапка и «сейчас играет» |
| `js/player.js`, `js/sound.js`, `js/native-bridge.js` | воспроизведение (ExoPlayer в нативной сборке, `<audio>` в браузере), эквалайзер |
| `js/scanner.js`, `js/library.js`, `js/meta.js` | сканирование папок, библиотека, обложки/длительности |
| `js/visualizer.js` | визуализатор (canvas) |
| `dsp.json` | константы эквалайзера (полосы, Q, запас, потолок). **Единственное место**: их читает `sound.js`, а Gradle генерирует из них `DspConfig.java` для `AudioFx` |

## Версия

Только в `package.json` (`version`). Из неё берутся `versionName` и `versionCode` (2.2.0 → 20200) в `android/app/build.gradle`, а в «Настройках» версия читается через `@capacitor/app`.

## Хранилище

- Список книг не содержит обложек, они лежат отдельными ключами `cover:<id>` и пишутся только при изменении.
- Позиция воспроизведения пишется отдельной маленькой записью (`progress`), а не вместе со всей библиотекой.
- Дополнительно позиция дублируется в `localStorage` (синхронно) и в `SharedPreferences` нативного сервиса; при старте берётся самая свежая из трёх.
- Прослушанная до конца книга остаётся на 100 % (`finished`), при нажатии «Играть» начинается сначала.

## Безопасность

- `setWebContentsDebuggingEnabled` включается только в debug-сборке.
- CSP разрешает только `'self'`, `data:`, `blob:` (без `unsafe-eval`, без внешних хостов). `script-src` оставляет `'unsafe-inline'` только из-за инлайн-скрипта Capacitor; собственный код инлайн-обработчиков не использует.
- Доступ к папкам только на чтение, `allowBackup="false"`, `FileProvider` удалён (не использовался).

## Сборка

```bash
npm ci
npx cap sync android        # создаёт android/app/capacitor.build.gradle и android/capacitor.settings.gradle
cd android && ./gradlew assembleDebug
```

APK: `android/app/build/outputs/apk/debug/app-debug.apk`.
Файлы `capacitor.build.gradle` и `capacitor.settings.gradle` генерируются `cap sync` и добавлены в `.gitignore`.
