# AudioShelf — build notes

## Versions

The project is pinned to Capacitor 6.2.0 for `@capacitor/core`, `@capacitor/android` and `@capacitor/cli`.

After extracting the project:

```bash
npm install
npm run android:build
```

The generated APK is under `android/app/build/outputs/apk/debug/`.

## Important architecture

- The library stores URI/metadata references; audio content is not loaded while rendering the library.
- Android folder scanning uses one `ContentResolver.query()` per directory and one recursive traversal.
- Scan results are upserted and written to IndexedDB in batches rather than once per book.
- Navigation uses event delegation on `#app` so replacing `main.innerHTML` does not destroy the navigation handlers.
- The bottom navigation is fixed and respects Android safe-area insets.
