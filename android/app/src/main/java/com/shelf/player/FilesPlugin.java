package com.shelf.player;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.DocumentsContract;
import android.util.Base64;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.ArrayDeque;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicReference;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ShelfFiles")
public class FilesPlugin extends Plugin {
    private static final String PICK_FOLDER_CALLBACK = "folderPickerResult";
    private static final int COVER_MAX_PX = 360;
    private static final int COVER_FILE_LIMIT = 8 * 1024 * 1024;
    /** Reading metadata of one file must never block the scan forever (cloud / SD providers can hang) */
    private static final long META_TIMEOUT_MS = 12000;
    private static final long COVER_READ_TIMEOUT_MS = 8000;
    /** After this many timeouts in a row inside one book the rest of its files are not probed (JS fills durations lazily) */
    private static final int MAX_CONSECUTIVE_TIMEOUTS = 3;
    private static final long PROGRESS_THROTTLE_MS = 150;

    private final ExecutorService scanExecutor = Executors.newSingleThreadExecutor();
    private final ExecutorService metaExecutor = Executors.newSingleThreadExecutor();
    /** Worker threads for the timed reads: a hung read only burns its own daemon thread, not the scan thread */
    private final ExecutorService ioPool = Executors.newCachedThreadPool(new ThreadFactory() {
        @Override public Thread newThread(Runnable r) {
            Thread t = new Thread(r, "shelf-io");
            t.setDaemon(true);
            return t;
        }
    });
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    protected void handleOnDestroy() {
        scanExecutor.shutdownNow();
        metaExecutor.shutdownNow();
        ioPool.shutdownNow();
        super.handleOnDestroy();
    }

    /** Duration (+ optional embedded cover) of one audio file — used for books scanned by older versions */
    @PluginMethod
    public void getMeta(final PluginCall call) {
        final String u = call.getString("uri", null);
        if (u == null || u.trim().isEmpty()) {
            call.reject("No file URI");
            return;
        }
        final boolean wantCover = Boolean.TRUE.equals(call.getBoolean("cover", false));
        metaExecutor.execute(() -> {
            Meta m = readMetaTimed(Uri.parse(u), wantCover);
            JSObject r = new JSObject();
            r.put("duration", m.duration);
            r.put("cover", m.cover);
            call.resolve(r);
        });
    }

    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        // read-only: the app never writes to the person's files
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
            | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
            | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        startActivityForResult(call, intent, PICK_FOLDER_CALLBACK);
    }

    @ActivityCallback
    public void folderPickerResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result == null || result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject(getContext().getString(R.string.pick_cancelled));
            return;
        }
        Uri treeUri = result.getData().getData();
        if (treeUri == null) {
            call.reject(getContext().getString(R.string.pick_none));
            return;
        }
        try {
            int takeFlags = result.getData().getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION;
            getContext().getContentResolver().takePersistableUriPermission(treeUri, takeFlags);
        } catch (Exception ignored) { }
        JSObject folder = new JSObject();
        folder.put("uri", treeUri.toString());
        folder.put("name", getTreeName(treeUri));
        call.resolve(folder);
    }

    @PluginMethod
    public void scanFolder(final PluginCall call) {
        final String uriString = call.getString("uri", null);
        final String folderId = call.getString("folderId", "");
        final String folderName = call.getString("folderName", "");
        if (uriString == null || uriString.trim().isEmpty()) {
            call.reject("No folder URI");
            return;
        }
        final Uri treeUri = Uri.parse(uriString);
        JSObject started = new JSObject();
        started.put("started", true);
        call.resolve(started);
        ScanService.begin(getContext());     // foreground service: the scan survives a minimised app / screen off
        try {
            scanExecutor.execute(() -> {
                try { runScan(treeUri, folderId, folderName); }
                finally { ScanService.end(getContext()); }
            });
        } catch (Exception e) {
            ScanService.end(getContext());
        }
    }

    private void runScan(Uri treeUri, String folderId, String folderName) {
        ScanState state = new ScanState(folderId, folderName);
        try {
            String rootDocId = DocumentsContract.getTreeDocumentId(treeUri);
            Uri rootDocUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, rootDocId);

            emit("scanStarted", new JSObject().put("folderId", folderId).put("folderName", folderName).put("totalFiles", 0));
            // 1) fast pass: only names / mime types, no metadata — gives the real total for an honest progress bar
            state.total = countAudio(treeUri, rootDocId, state);
            emit("scanProgress", new JSObject().put("folderId", folderId).put("folderName", folderName)
                .put("totalFiles", state.total).put("processedFiles", 0).put("books", 0));
            // 2) real scan: durations, covers, one event per book and one progress event per file
            scanDirectory(treeUri, rootDocUri, "", state);
            emitProgress(state, true);
            emit("scanComplete", new JSObject().put("folderId", folderId).put("folderName", folderName)
                .put("totalFiles", Math.max(state.total, state.processed)).put("processedFiles", state.processed)
                .put("books", state.books).put("errors", state.errors).put("timeouts", state.timeouts)
                .put("firstError", state.firstError));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            emit("scanError", new JSObject().put("folderId", folderId).put("message", getContext().getString(R.string.scan_interrupted)));
        } catch (Exception e) {
            emit("scanError", new JSObject().put("folderId", folderId).put("message", e.getMessage() == null ? getContext().getString(R.string.scan_error) : e.getMessage()));
        }
    }

    private static final String[] LIST_COLS = new String[]{
        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
        DocumentsContract.Document.COLUMN_MIME_TYPE,
        DocumentsContract.Document.COLUMN_SIZE,
        DocumentsContract.Document.COLUMN_LAST_MODIFIED
    };

    /** Lists the children of a directory; throws when the provider gives nothing (lost access, provider down) */
    private Cursor listChildren(Uri treeUri, String docId) throws Exception {
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, docId);
        Cursor c = getContext().getContentResolver().query(children, LIST_COLS, null, null,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME + " COLLATE NOCASE ASC");
        if (c == null) throw new IllegalStateException("The file provider returned no folder listing");
        return c;
    }

    /** Fast recursive count of audio files (no metadata reads). Unreadable sub-folders are reported, not hidden. */
    private int countAudio(Uri treeUri, String rootDocId, ScanState state) throws Exception {
        int total = 0;
        ArrayDeque<String> queue = new ArrayDeque<>();
        ArrayDeque<String> names = new ArrayDeque<>();
        queue.add(rootDocId);
        names.add("");
        while (!queue.isEmpty()) {
            if (Thread.currentThread().isInterrupted()) throw new InterruptedException();
            String docId = queue.poll();
            String dirName = names.poll();
            Cursor c = null;
            try {
                c = listChildren(treeUri, docId);
                int idCol = c.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID);
                int nameCol = c.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
                int mimeCol = c.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE);
                while (c.moveToNext()) {
                    String id = idCol >= 0 ? c.getString(idCol) : "";
                    String name = nameCol >= 0 ? c.getString(nameCol) : "";
                    String mime = mimeCol >= 0 ? c.getString(mimeCol) : "";
                    if (id == null || id.isEmpty() || name == null || name.isEmpty()) continue;
                    if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                        if (!name.equals(".") && !name.equals("..")) { queue.add(id); names.add(dirName.isEmpty() ? name : dirName + "/" + name); }
                    } else if (!isImage(name, mime) && isAudio(name, mime)) {
                        total++;
                    }
                }
            } catch (Exception e) {
                if (dirName.isEmpty()) throw e;                 // the root itself is unreadable: report as an error
                state.fail(dirName, e);
            } finally {
                if (c != null) c.close();
            }
        }
        return total;
    }

    private static class DirEntry {
        final Uri uri;
        final String relPath;
        DirEntry(Uri u, String p) { uri = u; relPath = p; }
    }

    private void scanDirectory(Uri treeUri, Uri documentUri, String relativeDir, ScanState state) throws Exception {
        if (Thread.currentThread().isInterrupted()) throw new InterruptedException();
        Cursor cursor = null;
        List<JSObject> audioHere = new ArrayList<>();
        List<DirEntry> subDirs = new ArrayList<>();
        Uri folderCover = null;
        int folderCoverScore = -1;

        try {
            String docId = DocumentsContract.getDocumentId(documentUri);
            cursor = listChildren(treeUri, docId);

            int idCol = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID);
            int nameCol = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
            int mimeCol = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE);
            int sizeCol = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_SIZE);
            int modCol = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED);

            while (cursor.moveToNext()) {
                String id = idCol >= 0 ? cursor.getString(idCol) : "";
                String name = nameCol >= 0 ? cursor.getString(nameCol) : "";
                String mime = mimeCol >= 0 ? cursor.getString(mimeCol) : "";
                if (id == null || id.isEmpty() || name == null || name.isEmpty()) continue;

                Uri child = DocumentsContract.buildDocumentUriUsingTree(treeUri, id);
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                    if (!name.equals(".") && !name.equals("..")) {
                        subDirs.add(new DirEntry(child, relativeDir.isEmpty() ? name : relativeDir + "/" + name));
                    }
                } else if (isImage(name, mime)) {
                    int score = coverScore(name);
                    if (score > folderCoverScore) { folderCoverScore = score; folderCover = child; }
                } else if (isAudio(name, mime)) {
                    JSObject f = new JSObject();
                    f.put("uri", child.toString());
                    f.put("name", name);
                    f.put("fileName", name);
                    f.put("path", relativeDir.isEmpty() ? name : relativeDir + "/" + name);
                    f.put("mimeType", mime);
                    if (sizeCol >= 0 && !cursor.isNull(sizeCol)) f.put("size", cursor.getLong(sizeCol));
                    if (modCol >= 0 && !cursor.isNull(modCol)) f.put("lastModified", cursor.getLong(modCol));
                    f.put("duration", 0.0);
                    audioHere.add(f);
                }
            }
        } catch (Exception e) {
            if (relativeDir.isEmpty()) throw e;                  // root: surfaces as scanError instead of "nothing found"
            state.fail(relativeDir, e);                          // sub-folder: counted and reported at the end
        } finally {
            if (cursor != null) cursor.close();
        }

        if (!audioHere.isEmpty()) {
            // cover: image file in the book folder first, otherwise the art embedded in the first audio file
            String cover = "";
            if (folderCover != null) {
                final Uri coverUri = folderCover;
                cover = encodeCover(callWithTimeout(new Callable<byte[]>() {
                    @Override public byte[] call() { return readBytes(coverUri, COVER_FILE_LIMIT); }
                }, COVER_READ_TIMEOUT_MS));
            }

            state.consecutiveTimeouts = 0;
            JSArray arr = new JSArray();
            for (int idx = 0; idx < audioHere.size(); idx++) {
                if (Thread.currentThread().isInterrupted()) throw new InterruptedException();
                JSObject f = audioHere.get(idx);
                boolean needCover = idx == 0 && cover.isEmpty();
                Meta m;
                if (state.consecutiveTimeouts >= MAX_CONSECUTIVE_TIMEOUTS) {
                    m = new Meta();                              // provider is stuck: do not wait again, durations are filled in later
                } else {
                    m = readMetaTimed(Uri.parse(f.optString("uri", "")), needCover);
                    if (m.timedOut) { state.timeouts++; state.consecutiveTimeouts++; }
                    else state.consecutiveTimeouts = 0;
                }
                f.put("duration", m.duration);
                if (needCover && !m.cover.isEmpty()) cover = m.cover;
                arr.put(f);
                state.processed++;
                emitProgress(state, false);                      // after EVERY file, not once per folder
            }

            String title;
            String author = "";
            if (relativeDir.isEmpty()) {
                title = stripExt(audioHere.get(0).optString("name", getContext().getString(R.string.default_book)));
            } else {
                int slash = relativeDir.lastIndexOf('/');
                if (slash >= 0) {
                    title = relativeDir.substring(slash + 1);
                    String parent = relativeDir.substring(0, slash);
                    int pslash = parent.lastIndexOf('/');
                    author = pslash >= 0 ? parent.substring(pslash + 1) : parent;
                } else {
                    title = relativeDir;
                }
            }

            JSObject book = new JSObject();
            book.put("folderId", state.folderId);
            book.put("folderName", state.folderName);
            book.put("path", relativeDir);
            book.put("title", title);
            book.put("author", author);
            book.put("cover", cover);
            book.put("files", arr);
            book.put("fileCount", audioHere.size());
            book.put("srcPath", state.folderId + ":" + relativeDir);
            state.books++;
            emit("scanBook", book);
            emitProgress(state, true);
        }

        for (DirEntry dir : subDirs) {
            scanDirectory(treeUri, dir.uri, dir.relPath, state);
        }
    }

    private static class Meta {
        double duration = 0.0;
        String cover = "";
        boolean timedOut = false;
    }

    /** readMeta() on a worker thread with a deadline. On timeout the retriever is released to unblock the worker. */
    private Meta readMetaTimed(final Uri fileUri, final boolean wantCover) {
        final AtomicReference<MediaMetadataRetriever> ref = new AtomicReference<>();
        Future<Meta> fut;
        try {
            fut = ioPool.submit(new Callable<Meta>() {
                @Override public Meta call() { return readMeta(fileUri, wantCover, ref); }
            });
        } catch (Exception e) {
            return new Meta();
        }
        try {
            return fut.get(META_TIMEOUT_MS, TimeUnit.MILLISECONDS);
        } catch (TimeoutException e) {
            fut.cancel(true);
            MediaMetadataRetriever r = ref.get();
            if (r != null) { try { r.release(); } catch (Exception ignored) { } }
            Meta m = new Meta();
            m.timedOut = true;
            return m;
        } catch (InterruptedException e) {
            fut.cancel(true);
            Thread.currentThread().interrupt();
            return new Meta();
        } catch (Exception e) {
            return new Meta();
        }
    }

    /** Runs a short blocking read with a deadline; returns null on timeout or failure */
    private <T> T callWithTimeout(Callable<T> job, long timeoutMs) {
        Future<T> fut;
        try { fut = ioPool.submit(job); } catch (Exception e) { return null; }
        try {
            return fut.get(timeoutMs, TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            fut.cancel(true);
            Thread.currentThread().interrupt();
            return null;
        } catch (Exception e) {
            fut.cancel(true);
            return null;
        }
    }

    private Meta readMeta(Uri fileUri, boolean wantCover, AtomicReference<MediaMetadataRetriever> ref) {
        Meta meta = new Meta();
        MediaMetadataRetriever r = new MediaMetadataRetriever();
        if (ref != null) ref.set(r);
        try {
            r.setDataSource(getContext(), fileUri);
            String d = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            if (d != null) {
                try { meta.duration = Math.max(0L, Long.parseLong(d.trim())) / 1000.0; } catch (NumberFormatException ignored) { }
            }
            if (wantCover) meta.cover = encodeCover(r.getEmbeddedPicture());
        } catch (Exception ignored) {
        } finally {
            try { r.release(); } catch (Exception ignored) { }
        }
        return meta;
    }

    private byte[] readBytes(Uri uri, int limit) {
        try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
            if (in == null) return null;
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n, total = 0;
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > limit) return null;
                out.write(buf, 0, n);
            }
            return out.toByteArray();
        } catch (Exception e) {
            return null;
        }
    }

    /** Downscale to <= COVER_MAX_PX and return as a data:image/jpeg;base64 URL ("" on failure) */
    private String encodeCover(byte[] bytes) {
        if (bytes == null || bytes.length == 0) return "";
        try {
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return "";
            int sample = 1;
            while (bounds.outWidth / sample > COVER_MAX_PX * 2 || bounds.outHeight / sample > COVER_MAX_PX * 2) sample *= 2;
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inSampleSize = sample;
            Bitmap bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, opts);
            if (bmp == null) return "";
            int w = bmp.getWidth(), h = bmp.getHeight();
            float scale = Math.min(1f, (float) COVER_MAX_PX / Math.max(w, h));
            if (scale < 1f) {
                Bitmap scaled = Bitmap.createScaledBitmap(bmp, Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)), true);
                if (scaled != bmp) { bmp.recycle(); bmp = scaled; }
            }
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            bmp.compress(Bitmap.CompressFormat.JPEG, 82, out);
            bmp.recycle();
            return "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
        } catch (Throwable t) {
            return "";
        }
    }

    private boolean isImage(String name, String mime) {
        String n = name.toLowerCase(Locale.ROOT);
        return (mime != null && mime.startsWith("image/")) || n.matches(".*\\.(jpg|jpeg|png|webp)$");
    }

    /** Prefer conventional cover names; any other image is a weaker fallback */
    private int coverScore(String name) {
        String base = stripExt(name).toLowerCase(Locale.ROOT);
        if (base.equals("cover") || base.equals("folder") || base.equals("front")) return 3;
        if (base.contains("cover") || base.contains("album") || base.contains("artwork") || base.contains("poster")) return 2;
        return 1;
    }

    /** Throttled (≈ every 150 ms) so thousands of files do not flood the WebView bridge */
    private void emitProgress(ScanState s, boolean force) {
        long now = SystemClock.elapsedRealtime();
        if (!force && now - s.lastEmit < PROGRESS_THROTTLE_MS) return;
        s.lastEmit = now;
        emit("scanProgress", new JSObject().put("folderId", s.folderId).put("folderName", s.folderName)
            .put("totalFiles", Math.max(s.total, s.processed)).put("processedFiles", s.processed).put("books", s.books));
        ScanService.progress(getContext(), s.processed, Math.max(s.total, s.processed));
    }

    private void emit(String event, JSObject data) {
        mainHandler.post(() -> notifyListeners(event, data));
    }

    private static class ScanState {
        int total = 0, processed = 0, books = 0;
        int errors = 0, timeouts = 0, consecutiveTimeouts = 0;
        String firstError = "";
        long lastEmit = 0;
        String folderId, folderName;
        ScanState(String id, String n) { folderId = id; folderName = n; }
        void fail(String where, Exception e) {
            errors++;
            if (firstError.isEmpty()) {
                String why = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
                firstError = where + ": " + why;
            }
        }
    }

    private boolean isAudio(String name, String mime) {
        String n = name.toLowerCase(Locale.ROOT);
        return (mime != null && mime.startsWith("audio/")) || n.matches(".*\\.(" + AudioFormats.ALTERNATION + ")$");   // list from www/config.js
    }

    /** Removes only a KNOWN audio extension, so "Vol. 1 Foundation" keeps its name */
    private String stripExt(String s) {
        return s.replaceFirst("(?i)\\.(" + AudioFormats.ALTERNATION + ")$", "");
    }

    private String getTreeName(Uri uri) {
        try {
            String p = uri.getPath();
            if (p != null) {
                int i = p.lastIndexOf('/');
                String name = Uri.decode(i >= 0 ? p.substring(i + 1) : p);
                // SAF tree ids look like "primary:Audiobooks/Sub": drop the storage-volume prefix and keep the last segment
                int colon = name.indexOf(':');
                if (colon >= 0) name = name.substring(colon + 1);
                int slash = name.lastIndexOf('/');
                if (slash >= 0) name = name.substring(slash + 1);
                name = name.trim();
                if (!name.isEmpty()) return name;
            }
        } catch (Exception ignored) { }
        return getContext().getString(R.string.default_folder);
    }
}
