package com.shelf.player;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.provider.DocumentsContract;

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
    private final ExecutorService scanExecutor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    protected void handleOnDestroy() {
        scanExecutor.shutdownNow();
        super.handleOnDestroy();
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
            JSArray arr = new JSArray();
            for (JSObject f : audioHere) {
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
            book.put("cover", "");
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
