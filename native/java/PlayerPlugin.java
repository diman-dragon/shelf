package com.shelf.player;

import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.util.Base64;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Player")
public class PlayerPlugin extends Plugin {
  static volatile PlayerPlugin inst;

  @Override public void load() { inst = this; }

  @PluginMethod
  public void update(PluginCall c) {
    final Context ctx = getContext();
    final String coverData = c.getString("cover", "");
    if (coverData.length() > 10 && coverData.hashCode() != PlayerService.coverHash) {
      try {
        int comma = coverData.indexOf(',');
        String encoded = comma >= 0 ? coverData.substring(comma + 1) : coverData;
        byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
        Bitmap next = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        if (next != null) {
          Bitmap old = PlayerService.cover;
          PlayerService.cover = next;
          PlayerService.coverHash = coverData.hashCode();
          if (old != null && old != next && !old.isRecycled()) old.recycle();
        }
      } catch (Exception ignored) { }
    } else if (coverData.isEmpty() && PlayerService.cover != null) {
      Bitmap old = PlayerService.cover;
      PlayerService.cover = null;
      PlayerService.coverHash = 0;
      if (!old.isRecycled()) old.recycle();
    }

    Intent intent = new Intent(ctx, PlayerService.class)
      .putExtra("title", c.getString("title", "Полка"))
      .putExtra("artist", c.getString("artist", ""))
      .putExtra("playing", c.getBoolean("playing", false))
      .putExtra("pos", Math.max(0L, Math.round(c.getDouble("pos", 0.0) * 1000.0)))
      .putExtra("dur", Math.max(0L, Math.round(c.getDouble("dur", 0.0) * 1000.0)));
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ContextCompat.startForegroundService(ctx, intent);
      else ctx.startService(intent);
      c.resolve();
    } catch (Exception e) { c.reject("Не удалось запустить медиасервис", e); }
  }

  @PluginMethod
  public void stop(PluginCall c) {
    getContext().stopService(new Intent(getContext(), PlayerService.class));
    c.resolve();
  }

  static void emit(String action) {
    PlayerPlugin p = inst;
    if (p != null) p.notifyListeners("action", new JSObject().put("a", action));
  }
}
