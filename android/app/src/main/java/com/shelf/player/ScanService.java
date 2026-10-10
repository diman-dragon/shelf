package com.shelf.player;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Foreground service that only exists while a library scan is running, so Android does not throttle or kill
 * the process when the app is minimised or the screen turns off. The scan itself runs in FilesPlugin.
 */
public class ScanService extends Service {
  private static final String CHANNEL_ID = "shelf_scan";
  private static final int NOTIF_ID = 2002;
  private static final AtomicInteger ACTIVE = new AtomicInteger();
  private static final Handler MAIN = new Handler(Looper.getMainLooper());
  private static long lastNotify = 0;

  /** A scan started. Safe to call several times; every begin() must be paired with end(). */
  static void begin(Context ctx) {
    ACTIVE.incrementAndGet();
    try {
      ContextCompat.startForegroundService(ctx.getApplicationContext(), new Intent(ctx.getApplicationContext(), ScanService.class));
    } catch (Exception ignored) { }   // scanning still works without the service, just less protected
  }

  /** A scan finished. The service stops when the last one ends (with a short delay so start-up can finish first). */
  static void end(final Context ctx) {
    if (ACTIVE.decrementAndGet() > 0) return;
    final Context app = ctx.getApplicationContext();
    MAIN.postDelayed(new Runnable() {
      @Override public void run() {
        if (ACTIVE.get() == 0) {
          try { app.stopService(new Intent(app, ScanService.class)); } catch (Exception ignored) { }
          // if the foreground service could not start, progress() posted a plain notification: remove it too
          try {
            NotificationManager nm = (NotificationManager) app.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(NOTIF_ID);
          } catch (Exception ignored) { }
        }
      }
    }, 1500);
  }

  /** Throttled progress update of the notification. */
  static void progress(Context ctx, int done, int total) {
    long now = SystemClock.elapsedRealtime();
    if (now - lastNotify < 1000) return;
    lastNotify = now;
    try {
      Context app = ctx.getApplicationContext();
      NotificationManager nm = (NotificationManager) app.getSystemService(Context.NOTIFICATION_SERVICE);
      if (nm != null) nm.notify(NOTIF_ID, build(app, done, total));
    } catch (Exception ignored) { }
  }

  private static Notification build(Context ctx, int done, int total) {
    NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_ID)
        .setSmallIcon(android.R.drawable.stat_notify_sync)
        .setContentTitle(ctx.getString(R.string.scan_title))
        .setContentText(total > 0 ? ctx.getString(R.string.scan_progress, done, total) : ctx.getString(R.string.scan_counting))
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setSilent(true)
        .setCategory(NotificationCompat.CATEGORY_PROGRESS)
        .setPriority(NotificationCompat.PRIORITY_LOW);
    if (total > 0) b.setProgress(total, Math.min(done, total), false);
    else b.setProgress(0, 0, true);
    Intent launch = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
    if (launch != null) {
      b.setContentIntent(PendingIntent.getActivity(ctx, 101, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
    }
    return b.build();
  }

  /** Android 15+: called when the system's time limit for a dataSync foreground service is reached. Must stop the service. */
  public void onTimeout(int startId, int fgsType) {
    stopSelf();
  }

  @Override public int onStartCommand(Intent intent, int flags, int startId) {
    try {
      if (Build.VERSION.SDK_INT >= 26) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
          NotificationChannel ch = new NotificationChannel(CHANNEL_ID, getString(R.string.scan_title), NotificationManager.IMPORTANCE_LOW);
          ch.setShowBadge(false);
          nm.createNotificationChannel(ch);
        }
      }
      Notification n = build(this, 0, 0);
      if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
      else startForeground(NOTIF_ID, n);
    } catch (Exception e) {
      stopSelf();
    }
    return START_NOT_STICKY;
  }

  @Override public IBinder onBind(Intent intent) { return null; }
}
