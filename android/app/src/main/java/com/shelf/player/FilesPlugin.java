package com.shelf.player;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;

import java.util.Locale;

@CapacitorPlugin(name = "ShelfFiles")
public class FilesPlugin extends Plugin {

    private static final String PICK_FOLDER_CALLBACK = "folderPickerResult";

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
        if (call == null) {
            return;
        }

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
        } catch (Exception ignored) {
            // Некоторые провайдеры не дают постоянное разрешение. В рамках текущего
            // запуска доступ всё равно остаётся действительным.
        }

        JSObject folder = new JSObject();
        folder.put("uri", treeUri.toString());
        folder.put("name", getTreeName(treeUri));

        JSArray files = scanTree(treeUri);
        folder.put("files", files);

        call.resolve(folder);
    }

    @PluginMethod
    public void readFile(PluginCall call) {
        String uriString = call.getString("uri", null);
        if (uriString == null || uriString.trim().isEmpty()) {
            call.reject("Не передан URI файла");
            return;
        }

        Uri uri = Uri.parse(uriString);
        try (InputStream in = getContext().getContentResolver().openInputStream(uri);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            if (in == null) {
                call.reject("Не удалось открыть файл");
                return;
            }

            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }

            JSObject result = new JSObject();
            result.put("base64", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Не удалось прочитать аудиофайл");
        }
    }

    @PluginMethod
    public void scanFolder(PluginCall call) {
        String uriString = call.getString("uri", null);
        if (uriString == null || uriString.trim().isEmpty()) {
            call.reject("Не передан URI папки");
            return;
        }

        try {
            Uri treeUri = Uri.parse(uriString);
            JSObject result = new JSObject();
            result.put("uri", treeUri.toString());
            result.put("name", getTreeName(treeUri));
            result.put("files", scanTree(treeUri));
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Не удалось прочитать папку", e);
        }
    }

    // Alias for older JS builds.
    @PluginMethod
    public void listFiles(PluginCall call) {
        scanFolder(call);
    }

    private JSArray scanTree(Uri treeUri) {
        JSArray result = new JSArray();
        scanChildren(treeUri, "", result);
        return result;
    }

    private void scanChildren(Uri treeUri, String relativeDir, JSArray result) {
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(
            treeUri,
            DocumentsContract.getTreeDocumentId(treeUri)
        );

        Cursor cursor = null;

        try {
            cursor = getContext().getContentResolver().query(
                childrenUri,
                new String[] {
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_MIME_TYPE,
                    DocumentsContract.Document.COLUMN_SIZE,
                    DocumentsContract.Document.COLUMN_LAST_MODIFIED
                },
                null,
                null,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME + " COLLATE NOCASE ASC"
            );

            if (cursor == null) {
                return;
            }

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

                boolean directory = DocumentsContract.Document.MIME_TYPE_DIR.equals(mime);
                String relativePath = relativeDir.isEmpty() ? name : relativeDir + "/" + name;

                Uri documentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, id);

                if (directory) {
                    // Skip Android/provider bookkeeping directories.
                    if (!name.equals(".") && !name.equals("..")) {
                        scanDocumentChildren(treeUri, documentUri, relativePath, result);
                    }
                    continue;
                }

                if (!isAudio(name, mime)) {
                    continue;
                }

                JSObject file = new JSObject();
                file.put("uri", documentUri.toString());
                file.put("name", name);
                file.put("path", relativePath);
                file.put("relativePath", relativePath);
                file.put("mimeType", mime);
                file.put("size", size);
                file.put("lastModified", modified);
                result.put(file);
            }
        } catch (Exception ignored) {
            // One inaccessible subtree must not prevent the remaining files from loading.
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
    }

    private void scanDocumentChildren(Uri treeUri, Uri documentUri, String relativeDir, JSArray result) {
        String documentId = DocumentsContract.getDocumentId(documentUri);
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, documentId);

        Cursor cursor = null;
        try {
            cursor = getContext().getContentResolver().query(
                childrenUri,
                new String[] {
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_MIME_TYPE,
                    DocumentsContract.Document.COLUMN_SIZE,
                    DocumentsContract.Document.COLUMN_LAST_MODIFIED
                },
                null,
                null,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME + " COLLATE NOCASE ASC"
            );

            if (cursor == null) {
                return;
            }

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
                    scanDocumentChildren(treeUri, childUri, childPath, result);
                } else if (isAudio(name, mime)) {
                    JSObject file = new JSObject();
                    file.put("uri", childUri.toString());
                    file.put("name", name);
                    file.put("path", childPath);
                    file.put("relativePath", childPath);
                    file.put("mimeType", mime);
                    file.put("size", size);
                    file.put("lastModified", modified);
                    result.put(file);
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
    }

    private String getTreeName(Uri uri) {
        Cursor cursor = null;
        try {
            cursor = getContext().getContentResolver().query(
                uri,
                new String[] { DocumentsContract.Document.COLUMN_DISPLAY_NAME },
                null,
                null,
                null
            );
            if (cursor != null && cursor.moveToFirst()) {
                return cursor.getString(0);
            }
        } catch (Exception ignored) {
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
        return "Папка";
    }

    private boolean isAudio(String name, String mime) {
        if (mime != null && mime.toLowerCase(Locale.ROOT).startsWith("audio/")) {
            return true;
        }

        String lower = name == null ? "" : name.toLowerCase(Locale.ROOT);
        return lower.endsWith(".mp3")
            || lower.endsWith(".m4a")
            || lower.endsWith(".m4b")
            || lower.endsWith(".aac")
            || lower.endsWith(".flac")
            || lower.endsWith(".ogg")
            || lower.endsWith(".opus")
            || lower.endsWith(".wav")
            || lower.endsWith(".wma")
            || lower.endsWith(".aiff")
            || lower.endsWith(".ape");
    }

}
