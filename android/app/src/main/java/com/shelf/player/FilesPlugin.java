package com.shelf.player;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.PluginMethod;

@CapacitorPlugin(name = "ShelfFiles")
public class FilesPlugin extends Plugin {
    private static final String PICK_FOLDER_CALLBACK = "folderPickerResult";
    private final ExecutorService scanExecutor = Executors.newSingleThreadExecutor();
    private final AtomicInteger scanSequence = new AtomicInteger(0);
    private final AtomicBoolean scanRunning = new AtomicBoolean(false);

    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
        );
        startActivityForResult(call, intent, PICK_FOLDER_CALLBACK);
    }

    @ActivityCallback
    private void folderPickerResult(PluginCall call, ActivityResult result) {
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
            int takeFlags = result.getData().getFlags()
                & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            getContext().getContentResolver().takePersistableUriPermission(treeUri, takeFlags);
        } catch (Exception ignored) {}

        JSObject folder = new JSObject();
        folder.put("uri", treeUri.toString());
        folder.put("name", getTreeName(treeUri));
        // IMPORTANT: do not scan here. The picker must return immediately so the UI
        // can move to the Library while the actual scan runs on the worker thread.
        call.resolve(folder);
    }

    @PluginMethod
    public void scanFolder(PluginCall call) {
        String uriString = call.getString("uri", null);
        if (uriString == null || uriString.trim().isEmpty()) {
            call.reject("Не передан URI папки");
            return;
        }
        if (!scanRunning.compareAndSet(false, true)) {
            call.reject("Сканирование уже выполняется");
            return;
        }

        final String scanId = "scan-" + System.currentTimeMillis() + "-" + scanSequence.incrementAndGet();
        final Uri treeUri = Uri.parse(uriString);
        JSObject accepted = new JSObject();
        accepted.put("scanId", scanId);
        accepted.put("name", getTreeName(treeUri));
        call.resolve(accepted);

        scanExecutor.execute(() -> {
            ScanState state = new ScanState(scanId);
            try {
                notifyScanStarted(state);
                scanChildrenAsGroups(treeUri, "", state);
                JSObject done = new JSObject();
                done.put("scanId", scanId);
                done.put("files", state.filesFound);
                done.put("groups", state.groupsFound);
                notifyListeners("scanFinished", done);
            } catch (Exception e) {
                JSObject err = new JSObject();
                err.put("scanId", scanId);
                err.put("message", e.getMessage() == null ? "Ошибка сканирования" : e.getMessage());
                notifyListeners("scanError", err);
            } finally {
                scanRunning.set(false);
            }
        });
    }

    @PluginMethod
    public void listFiles(PluginCall call) {
        scanFolder(call);
    }

    private static final class ScanState {
        final String scanId;
        int filesFound = 0;
        int groupsFound = 0;
        ScanState(String scanId) { this.scanId = scanId; }
    }

    private void notifyScanStarted(ScanState state) {
        JSObject o = new JSObject();
        o.put("scanId", state.scanId);
        o.put("files", 0);
        o.put("groups", 0);
        notifyListeners("scanStarted", o);
    }

    private void emitGroup(ScanState state, String relativeDir, JSArray files) {
        if (files == null || files.length() == 0) return;
        state.groupsFound++;
        JSObject event = new JSObject();
        event.put("scanId", state.scanId);
        event.put("path", relativeDir.isEmpty() ? "__root__" : relativeDir);
        event.put("files", files);
        event.put("filesFound", state.filesFound);
        event.put("groupsFound", state.groupsFound);
        notifyListeners("scanGroup", event);
        notifyProgress(state, false);
    }

    private void notifyProgress(ScanState state, boolean finished) {
        JSObject p = new JSObject();
        p.put("scanId", state.scanId);
        p.put("filesFound", state.filesFound);
        p.put("groupsFound", state.groupsFound);
        p.put("finished", finished);
        notifyListeners("scanProgress", p);
    }

    /**
     * Scans one directory at a time. A directory containing audio is emitted as a
     * complete book immediately after that directory has been read. Root-level
     * audio files are emitted one-by-one. No MediaMetadataRetriever calls happen
     * here: SAF traversal remains cheap and never blocks the WebView thread.
     */
    private void scanChildrenAsGroups(Uri treeUri, String relativeDir, ScanState state) {
        Uri parentUri = relativeDir.isEmpty()
            ? DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, DocumentsContract.getTreeDocumentId(treeUri))
            : null;

        if (relativeDir.isEmpty()) {
            scanDirectory(treeUri, treeUri, relativeDir, state);
        } else {
            // This overload is only reached from scanDirectory with the concrete document URI.
        }
        notifyProgress(state, true);
    }

    private void scanDirectory(Uri treeUri, Uri directoryUri, String relativeDir, ScanState state) {
        String documentId = relativeDir.isEmpty()
            ? DocumentsContract.getTreeDocumentId(treeUri)
            : DocumentsContract.getDocumentId(directoryUri);
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, documentId);
        Cursor cursor = null;
        JSArray directAudio = new JSArray();
        try {
            cursor = getContext().getContentResolver().query(
                childrenUri,
                new String[] {
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_MIME_TYPE,
                    DocumentsContract.Document.COLUMN_SIZE,
                    DocumentsContract.Document.COLUMN_LAST_MODIFIED
                }, null, null,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME + " COLLATE NOCASE ASC"
            );
            if (cursor == null) return;
            int idCol = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID);
            int nameCol = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
            int mimeCol = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE);
            int sizeCol = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_SIZE);
            int modifiedCol = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED);

            while (cursor.moveToNext()) {
                String id = idCol >= 0 ? cursor.getString(idCol) : "";
                String name = nameCol >= 0 ? cursor.getString(nameCol) : "";
                String mime = mimeCol >= 0 ? cursor.getString(mimeCol) : "";
                long size = sizeCol >= 0 && !cursor.isNull(sizeCol) ? cursor.getLong(sizeCol) : 0L;
                long modified = modifiedCol >= 0 && !cursor.isNull(modifiedCol) ? cursor.getLong(modifiedCol) : 0L;
                Uri childUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, id);
                String childPath = relativeDir.isEmpty() ? name : relativeDir + "/" + name;

                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                    // A physical directory is the book boundary. Scan it completely,
                    // then immediately publish it to JS before continuing to the next one.
                    scanDirectory(treeUri, childUri, childPath, state);
                    continue;
                }
                if (!isAudio(name, mime)) continue;
                JSObject audioFile = makeFile(childUri, name, childPath, mime, size, modified);
                state.filesFound++;
                if (relativeDir.isEmpty()) {
                    // Each root-level audio file is a standalone book.
                    JSArray one = new JSArray();
                    one.put(audioFile);
                    emitGroup(state, childPath, one);
                } else {
                    // Files inside one physical directory form one book.
                    directAudio.put(audioFile);
                }
                // No metadata extraction here: it is intentionally deferred until playback.
            }
        } catch (Exception e) {
            JSObject err = new JSObject();
            err.put("scanId", state.scanId);
            err.put("path", relativeDir);
            err.put("message", e.getMessage() == null ? "Не удалось прочитать папку" : e.getMessage());
            notifyListeners("scanWarning", err);
        } finally {
            if (cursor != null) cursor.close();
        }
        if (directAudio.length() > 0) {
            emitGroup(state, relativeDir, directAudio);
        }
    }

    private JSObject makeFile(Uri uri, String name, String path, String mime, long size, long modified) {
        JSObject file = new JSObject();
        file.put("uri", uri.toString());
        file.put("name", name);
        file.put("path", path);
        file.put("relativePath", path);
        file.put("mimeType", mime);
        file.put("size", size);
        file.put("lastModified", modified);
        return file;
    }

    @PluginMethod
    public void readFile(PluginCall call) {
        String uriString = call.getString("uri", null);
        if (uriString == null || uriString.trim().isEmpty()) {
            call.reject("Не передан URI файла"); return;
        }
        Uri uri = Uri.parse(uriString);
        try (InputStream in = getContext().getContentResolver().openInputStream(uri);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            if (in == null) { call.reject("Не удалось открыть файл"); return; }
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
            JSObject result = new JSObject();
            result.put("base64", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Не удалось прочитать аудиофайл");
        }
    }

    private String getTreeName(Uri uri) {
        Cursor cursor = null;
        try {
            cursor = getContext().getContentResolver().query(uri,
                new String[] { DocumentsContract.Document.COLUMN_DISPLAY_NAME }, null, null, null);
            if (cursor != null && cursor.moveToFirst()) return cursor.getString(0);
        } catch (Exception ignored) {}
        finally { if (cursor != null) cursor.close(); }
        return "Music";
    }

    private boolean isAudio(String name, String mime) {
        String lower = name == null ? "" : name.toLowerCase(Locale.ROOT);
        if (mime != null && mime.toLowerCase(Locale.ROOT).startsWith("audio/")) return true;
        return lower.endsWith(".mp3") || lower.endsWith(".m4a") || lower.endsWith(".m4b")
            || lower.endsWith(".aac") || lower.endsWith(".flac") || lower.endsWith(".ogg")
            || lower.endsWith(".opus") || lower.endsWith(".wav") || lower.endsWith(".wma")
            || lower.endsWith(".aiff") || lower.endsWith(".ape");
    }

    @Override
    protected void handleOnDestroy() {
        scanExecutor.shutdownNow();
        super.handleOnDestroy();
    }
}
