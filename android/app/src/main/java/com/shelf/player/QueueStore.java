package com.shelf.player;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.util.UnstableApi;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The playing queue, remembered on the native side (compact: uri + title per chapter).
 *
 * Why: while playback is paused the notification stays in the shade, and the system may kill the process in the
 * meantime. Pressing "play" there restarts the service with an EMPTY player — without the queue the button did nothing
 * or the player glitched. PlayerService.onPlaybackResumption() rebuilds the queue from here, together with the position
 * that PlayerService.persistPosition() keeps up to date.
 */
@UnstableApi
final class QueueStore {
  private static final String KEY_QUEUE = "queue", KEY_SPEED = "speed", KEY_ALBUM = "album", KEY_SEEK = "seekMs";
  // an interruption (call / audio focus loss) in progress: kept on disk, because the process can be killed during a long call
  private static final String KEY_INT_BOOK = "intBook", KEY_INT_IDX = "intIdx", KEY_INT_POS = "intPos", KEY_INT_TS = "intTs";

  private QueueStore() { }

  private static SharedPreferences prefs(Context c) {
    return c.getApplicationContext().getSharedPreferences(PlayerService.PREFS, Context.MODE_PRIVATE);
  }

  /** The queue items exactly as setQueue() builds them (also used when the queue is restored). */
  static List<MediaItem> build(JSONArray arr, String bookId, String bookTitle, String author, Uri art) throws JSONException {
    List<MediaItem> items = new ArrayList<>();
    for (int i = 0; i < arr.length(); i++) {
      JSONObject o = arr.getJSONObject(i);
      Uri uri = Uri.parse(o.optString("uri", ""));
      MediaMetadata.Builder md = new MediaMetadata.Builder()
          .setTitle(o.optString("title", bookTitle))
          .setArtist(author.isEmpty() ? bookTitle : author)
          .setAlbumTitle(bookTitle)
          .setTrackNumber(i + 1);
      if (art != null) md.setArtworkUri(art);
      items.add(new MediaItem.Builder()
          .setMediaId(bookId + ":" + i)
          .setUri(uri)
          .setRequestMetadata(new MediaItem.RequestMetadata.Builder().setMediaUri(uri).build())
          .setMediaMetadata(md.build())
          .build());
    }
    return items;
  }

  static void save(Context c, String bookId, String bookTitle, String author, Uri art, JSONArray arr, float speed) {
    try {
      JSONArray compact = new JSONArray();
      for (int i = 0; i < arr.length(); i++) {
        JSONObject o = arr.getJSONObject(i);
        compact.put(new JSONObject().put("uri", o.optString("uri", "")).put("title", o.optString("title", bookTitle)));
      }
      JSONObject q = new JSONObject()
          .put("bookId", bookId).put("bookTitle", bookTitle).put("author", author)
          .put("art", art == null ? "" : art.toString()).put("items", compact);
      prefs(c).edit().putString(KEY_QUEUE, q.toString()).putFloat(KEY_SPEED, speed).apply();
    } catch (Exception ignored) { }
  }

  static void saveSpeed(Context c, float speed) { prefs(c).edit().putFloat(KEY_SPEED, speed).apply(); }

  static void saveAlbum(Context c, boolean on) { prefs(c).edit().putBoolean(KEY_ALBUM, on).apply(); }

  /** Seek step of the notification / lock screen / widget buttons (chosen in the app's settings, default 10 s). */
  static void saveSeekMs(Context c, long ms) { prefs(c).edit().putLong(KEY_SEEK, ms).apply(); }

  static long loadSeekMs(Context c) { return prefs(c).getLong(KEY_SEEK, 10_000L); }

  /** The exact place where a call / notification sound stopped playback. Survives the death of the process. */
  static void saveInterruption(Context c, String bookId, int index, long posMs) {
    prefs(c).edit().putString(KEY_INT_BOOK, bookId).putInt(KEY_INT_IDX, index).putLong(KEY_INT_POS, posMs)
        .putLong(KEY_INT_TS, System.currentTimeMillis()).apply();
  }

  static void clearInterruption(Context c) {
    prefs(c).edit().remove(KEY_INT_BOOK).remove(KEY_INT_IDX).remove(KEY_INT_POS).remove(KEY_INT_TS).apply();
  }

  static final class Restored {
    final List<MediaItem> items;
    final int index;
    final long posMs;
    final float speed;
    final boolean album;
    Restored(List<MediaItem> items, int index, long posMs, float speed, boolean album) {
      this.items = items; this.index = index; this.posMs = posMs; this.speed = speed; this.album = album;
    }
  }

  /** null when nothing usable is stored. Position comes from persistPosition() (only if it belongs to the same book). */
  static Restored load(Context c) {
    SharedPreferences sp = prefs(c);
    String json = sp.getString(KEY_QUEUE, null);
    if (json == null) return null;
    try {
      JSONObject q = new JSONObject(json);
      String bookId = q.optString("bookId", "");
      String art = q.optString("art", "");
      List<MediaItem> items = build(q.getJSONArray("items"), bookId, q.optString("bookTitle", ""),
          q.optString("author", ""), art.isEmpty() ? null : Uri.parse(art));
      if (items.isEmpty()) return null;
      int index = 0;
      long posMs = 0;
      if (bookId.equals(sp.getString("bookId", ""))) {
        index = Math.max(0, Math.min(sp.getInt("index", 0), items.size() - 1));
        posMs = Math.max(0L, Math.round(sp.getFloat("pos", 0f) * 1000.0));
        // the process died while a call had paused the player: continue where the call began, minus the usual 5 s
        // (only if nothing was played since: persistPosition() stamps "ts" every few seconds while playing)
        long intTs = sp.getLong(KEY_INT_TS, 0L);
        if (bookId.equals(sp.getString(KEY_INT_BOOK, "")) && Interruption.fresh(intTs, System.currentTimeMillis())
            && sp.getLong("ts", 0L) - intTs < 3000L) {
          index = Math.max(0, Math.min(sp.getInt(KEY_INT_IDX, index), items.size() - 1));
          posMs = Interruption.rewindPosition(Math.max(0L, sp.getLong(KEY_INT_POS, posMs)));
        }
      }
      return new Restored(items, index, posMs, sp.getFloat(KEY_SPEED, 1f), sp.getBoolean(KEY_ALBUM, false));
    } catch (Exception e) {
      return null;
    }
  }
}
