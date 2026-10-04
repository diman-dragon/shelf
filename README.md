# AudioShelf — полная сборка

Capacitor: `www/` + `android/`.

## Кнопки на мобильном (исправлено)
- `main` и `modalRoot` экспортируются из `state.js` (раньше ReferenceError ломал UI)
- Нижняя навигация: `position:fixed`, `z-index:60`, `type="button"`
- SVG/иконки: `pointer-events: none` (не перехватывают тап)
- Capture-phase обработчик nav в `app.js` + делегирование в `bindNav`
- Пустой `#modalRoot` не перекрывает экран

## Остальное
- Книга = папка с аудио (SAF), author/title из пути, dedup по `srcPath`
- Прогресс и seek по всей книге
- Звук (EQ/пресеты) на книгу
- Плеер в один экран; свайп ← визуализатор, → список глав
- Плейлисты с плеера и меню книги
- NotificationChannel + foreground mediaPlayback

## Сборка
```bash
npm install
npx cap sync android
npm run android:build
```
APK: `android/app/build/outputs/apk/debug/app-debug.apk`
