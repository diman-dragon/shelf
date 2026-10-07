package com.shelf.player;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import androidx.media3.common.util.UnstableApi;

/**
 * Home-screen widget. The buttons control the native player directly, but ONLY while the service really holds a book:
 * with no running service they used to do nothing at all (handleAction returned silently). Now, until a book is
 * loaded, every button simply opens the app, where the person can resume or pick a book.
 */
@UnstableApi
public class PlayerWidget extends AppWidgetProvider {
  static String title = "AudioShelf", artist = "Откройте книгу";
  static boolean playing;

  private static PendingIntent broadcast(Context c, String a) {
    return PendingIntent.getBroadcast(c, a.hashCode(), new Intent(c, PlayerWidget.class).setAction(a),
        PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
  }

  private static PendingIntent openApp(Context c) {
    Intent open = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
    if (open == null) return null;
    return PendingIntent.getActivity(c, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
  }

  /** Is there a book in the native player right now? (main thread) */
  private static boolean hasBook() {
    androidx.media3.exoplayer.ExoPlayer p = PlayerService.live;
    return p != null && p.getMediaItemCount() > 0;
  }

  private static String lastSig = "";

  static void push(Context c) { push(c, false); }

  /** force = the system asked for a refresh (onUpdate): always rebuild. Otherwise identical states are skipped (no IPC storm). */
  static void push(Context c, boolean force) {
    final boolean alive = hasBook();
    final String sig = alive + "|" + title + "|" + artist + "|" + playing;
    if (!force && sig.equals(lastSig)) return;
    lastSig = sig;
    RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget);
    v.setTextViewText(R.id.wTitle, alive ? title : "AudioShelf");
    v.setTextViewText(R.id.wArtist, alive ? artist : "Откройте книгу");
    v.setImageViewResource(R.id.wPlay, alive && playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play);
    PendingIntent open = openApp(c);
    final int[] ids = {R.id.wPrev, R.id.wBack, R.id.wPlay, R.id.wForward, R.id.wNext};
    final String[] actions = {"prev", "back", "toggle", "forward", "next"};
    for (int i = 0; i < ids.length; i++) {
      PendingIntent pi = alive ? broadcast(c, actions[i]) : open;
      if (pi != null) v.setOnClickPendingIntent(ids[i], pi);
    }
    if (open != null) v.setOnClickPendingIntent(R.id.wTitle, open);
    AppWidgetManager.getInstance(c).updateAppWidget(new ComponentName(c, PlayerWidget.class), v);
  }

  @Override public void onUpdate(Context c, AppWidgetManager m, int[] ids) { push(c, true); }

  @Override public void onReceive(Context c, Intent i) {
    super.onReceive(c, i);
    String a = i.getAction();
    if ("prev".equals(a) || "next".equals(a) || "toggle".equals(a) || "back".equals(a) || "forward".equals(a)) {
      if (hasBook()) PlayerService.handleAction(a);
      else push(c, true);                 // the service went away in the meantime: switch the buttons back to "open the app"
    }
  }
}
