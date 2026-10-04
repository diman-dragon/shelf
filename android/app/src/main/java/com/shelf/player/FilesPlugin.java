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
import android.provider.DocumentsContract;
import android.util.Base64;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

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
    private final ExecutorService scanExecutor = Executors.newSingleThreadExecutor();
    private final ExecutorService metaExecutor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    protected void handleOnDestroy() {
        scanExecutor.shutdownNow();
        metaExecutor.shutdownNow();
        super.handleOnDestroy();
    }

    /** Duration (+ optional embedded cover) of one audio file — used for books scanned by older versions */
    @PluginMethod
    public void getMeta(final PluginCall call) {
        final String u = call.getString("uri", null);
        if (u == null || u.trim().isEmpty()) {
            call.reject("Не передан URI файла");
            return;
        }
        final boolean wantCover = Boolean.TRUE.equals(call.getBoolean("cover", false));
        metaExecutor.execute(() -> {
            Meta m = readMeta(Uri.parse(u), wantCover);
            JSObject r = new JSObject();
            r.put("duration", m.duration);
            r.put("cover", m.cover);
            call.resolve(r);
        });
    }

    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
            | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
            | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        startActivityForResult(call, intent, PICK_FOLDER_CALLBACK);
    }

    @ActivityCallback
    public void folderPickerResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result == null || result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("Выбор папки отменён");
            return;
        }
        Uri treeUri = result.getData().getData();
        if (treeUri == null) {
            call.reject("Папка не выбрана");
            return;
        }
        try {
            int takeFlags = result.getData().getFlags() &
                (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
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
            call.reject("Не передан URI папки");
            return;
        }
        final Uri treeUri = Uri.parse(uriString);
        JSObject started = new JSObject();
        started.put("started", true);
        call.resolve(started);
        scanExecutor.execute(() -> runScan(treeUri, folderId, folderName));
    }

    private void runScan(Uri treeUri, String folderId, String folderName) {
        try {
            String rootDocId = DocumentsContract.getTreeDocumentId(treeUri);
            Uri rootDocUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, rootDocId);

            emit("scanStarted", new JSObject().put("folderId", folderId).put("folderName", folderName).put("totalFiles", 0));
            ScanState state = new ScanState(folderId, folderName);
            scanDirectory(treeUri, rootDocUri, "", state);
            emit("scanComplete", new JSObject().put("folderId", folderId).put("folderName", folderName)
                .put("totalFiles", state.processed).put("processedFiles", state.processed).put("books", state.books));
        } catch (Exception e) {
            emit("scanError", new JSObject().put("folderId", folderId).put("message", e.getMessage() == null ? "Ошибка сканирования" : e.getMessage()));
        }
    }

    private static class DirEntry {
        final Uri uri;
        final String relPath;
        DirEntry(Uri u, String p) { uri = u; relPath = p; }
    }

    private void scanDirectory(Uri treeUri, Uri documentUri, String relativeDir, ScanState state) {
        Cursor cursor = null;
        List<JSObject> audioHere = new ArrayList<>();
        List<DirEntry> subDirs = new ArrayList<>();
        Uri folderCover = null;
        int folderCoverScore = -1;

        try {
            String docId = DocumentsContract.getDocumentId(documentUri);
            Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, docId);
            cursor = getContext().getContentResolver().query(children,
                new String[]{
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_MIME_TYPE,
                    DocumentsContract.Document.COLUMN_SIZE,
                    DocumentsContract.Document.COLUMN_LAST_MODIFIED
                },
                null, null, DocumentsContract.Document.COLUMN_DISPLAY_NAME + " COLLATE NOCASE ASC");

            if (cursor != null) {
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
            }
        } catch (Exception ignored) { }
        finally {
            if (cursor != null) cursor.close();
        }

        if (!audioHere.isEmpty()) {
            // cover: image file in the book folder first, otherwise the art embedded in the first audio file
            String cover = "";
            if (folderCover != null) cover = encodeCover(readBytes(folderCover, COVER_FILE_LIMIT));

            JSArray arr = new JSArray();
            for (int idx = 0; idx < audioHere.size(); idx++) {
                JSObject f = audioHere.get(idx);
                boolean needCover = idx == 0 && cover.isEmpty();
                Meta m = readMeta(Uri.parse(f.optString("uri", "")), needCover);
                f.put("duration", m.duration);
                if (needCover && !m.cover.isEmpty()) cover = m.cover;
                arr.put(f);
                state.processed++;
            }

            String title;
            String author = "";
            if (relativeDir.isEmpty()) {
                title = stripExt(audioHere.get(0).optString("name", "Книга"));
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
            emitProgress(state);
        }

        for (DirEntry dir : subDirs) {
            scanDirectory(treeUri, dir.uri, dir.relPath, state);
        }
    }

    private static class Meta {
        double duration = 0.0;
        String cover = "";
    }

    private Meta readMeta(Uri fileUri, boolean wantCover) {
        Meta meta = new Meta();
        MediaMetadataRetriever r = new MediaMetadataRetriever();
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

    private void emitProgress(ScanState s) {
        emit("scanProgress", new JSObject().put("folderId", s.folderId).put("folderName", s.folderName)
            .put("totalFiles", s.processed).put("processedFiles", s.processed).put("books", s.books));
    }

    private void emit(String event, JSObject data) {
        mainHandler.post(() -> notifyListeners(event, data));
    }

    private static class ScanState {
        int processed = 0, books = 0;
        String folderId, folderName;
        ScanState(String id, String n) { folderId = id; folderName = n; }
    }

    private boolean isAudio(String name, String mime) {
        String n = name.toLowerCase(Locale.ROOT);
        return (mime != null && mime.startsWith("audio/")) || n.matches(".*\\.(mp3|m4a|m4b|aac|ogg|opus|flac|wav|wma)$");
    }

    private String stripExt(String s) {
        return s.replaceFirst("(?i)\\.[^.]+$", "");
    }

    private String getTreeName(Uri uri) {
        try {
            String p = uri.getPath();
            if (p != null) {
                int i = p.lastIndexOf('/');
                if (i >= 0 && i < p.length() - 1) return Uri.decode(p.substring(i + 1));
            }
        } catch (Exception ignored) { }
        return "Аудиокниги";
    }
}
