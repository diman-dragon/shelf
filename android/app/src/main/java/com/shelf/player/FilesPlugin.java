package com.shelf.player;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.database.Cursor;
import android.util.Base64;
import com.getcapacitor.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Locale;

/** Android Storage Access Framework bridge used by the library scanner. */
@CapacitorPlugin(name = "ShelfFiles")
public class FilesPlugin extends Plugin {
  private static final int PICK_TREE = 7301;
  private PluginCall pendingPick;

  @PluginMethod
  public void pickFolder(PluginCall call) {
    Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
      | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
      | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
    startActivityForResult(call, i, "folderPickerResult");
  }

  @com.getcapacitor.annotation.ActivityCallback
  private void folderPickerResult(PluginCall call, ActivityResult result) {
    if (result == null || result.getResultCode() != Activity.RESULT_OK || result.getData() == null
        || result.getData().getData() == null) {
      call.reject("Отмена");
      return;
    }

    Intent data = result.getData();
    Uri uri = data.getData();
    try {
      int takeFlags = data.getFlags() &
        (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
      if (takeFlags != 0) {
        getContext().getContentResolver().takePersistableUriPermission(uri, takeFlags);
      }
    } catch (Exception ignored) { }

    JSObject r = new JSObject();
    r.put("uri", uri.toString());
    r.put("name", queryName(uri));
    call.resolve(r);
  }

  @PluginMethod
  public void scanFolder(PluginCall call) {
    String s = call.getString("uri", "");
    if (s.isEmpty()) { call.reject("Нет папки"); return; }
    try {
      Uri root = Uri.parse(s);
      ArrayList<JSObject> out = new ArrayList<>();
      walk(root, queryName(root), out);
      JSArray a = new JSArray();
      for (JSObject o : out) a.put(o);
      JSObject r = new JSObject();
      r.put("files", a);
      r.put("name", queryName(root));
      r.put("count", out.size());
      call.resolve(r);
    } catch (SecurityException e) {
      call.reject("Доступ к папке больше не разрешён");
    } catch (Exception e) {
      call.reject("Не удалось просканировать папку: " + e.getMessage());
    }
  }

  private void walk(Uri tree, String path, ArrayList<JSObject> out) {
    Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(
      tree, DocumentsContract.getTreeDocumentId(tree));
    try (Cursor c = getContext().getContentResolver().query(children,
      new String[]{
        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
        DocumentsContract.Document.COLUMN_MIME_TYPE,
        DocumentsContract.Document.COLUMN_SIZE,
        DocumentsContract.Document.COLUMN_LAST_MODIFIED
      }, null, null, null)) {
      if (c == null) return;
      int idCol = c.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID);
      int nameCol = c.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
      int mimeCol = c.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE);
      int sizeCol = c.getColumnIndex(DocumentsContract.Document.COLUMN_SIZE);
      int modCol = c.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED);
      while (c.moveToNext()) {
        String id = c.getString(idCol);
        String name = c.getString(nameCol);
        String mime = c.getString(mimeCol);
        Uri child = DocumentsContract.buildDocumentUriUsingTree(tree, id);
        if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
          if (name != null && !name.startsWith(".") && !name.equals("Android")) {
            walk(child, path + "/" + name, out);
          }
        } else if (isAudio(name, mime)) {
          JSObject o = new JSObject();
          o.put("uri", child.toString());
          o.put("name", name);
          o.put("path", path);
          o.put("mime", mime == null ? "audio/*" : mime);
          o.put("size", sizeCol >= 0 && !c.isNull(sizeCol) ? c.getLong(sizeCol) : 0);
          o.put("modified", modCol >= 0 && !c.isNull(modCol) ? c.getLong(modCol) : 0);
          out.add(o);
        }
      }
    }
  }

  private boolean isAudio(String name, String mime) {
    if (mime != null && mime.toLowerCase(Locale.US).startsWith("audio/")) return true;
    return name != null && name.matches("(?i).+\\.(mp3|m4a|m4b|aac|ogg|opus|flac|wav|wma)$");
  }

  private String queryName(Uri uri) {
    try (Cursor c = getContext().getContentResolver().query(uri,
      new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
      if (c != null && c.moveToFirst()) return c.getString(0);
    } catch (Exception ignored) { }
    return "Музыка";
  }

  /**
   * The web layer asks for a complete Blob only for the active chapter (and the
   * first file while importing, to read tags). This avoids copying an entire
   library into IndexedDB during a scan.
   */
  @PluginMethod
  public void readFile(PluginCall call) {
    String s = call.getString("uri", "");
    if (s.isEmpty()) { call.reject("Нет файла"); return; }
    try (InputStream in = getContext().getContentResolver().openInputStream(Uri.parse(s));
         ByteArrayOutputStream out = new ByteArrayOutputStream()) {
      if (in == null) { call.reject("Не удалось открыть файл"); return; }
      byte[] buf = new byte[1024 * 1024];
      int n;
      while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
      JSObject r = new JSObject();
      r.put("base64", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
      r.put("mime", "audio/*");
      call.resolve(r);
    } catch (Exception e) {
      call.reject("Не удалось прочитать файл: " + e.getMessage());
    }
  }
}
