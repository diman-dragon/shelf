package com.shelf.player;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;

public class PlayerService extends Service {
  static volatile Bitmap cover;
  static volatile int coverHash;
  private static final int NOTIFICATION_ID = 1;
  private static final String CHANNEL_ID = "player";
  private static final String ACTION_STOP_SERVICE = "STOP_SERVICE";
  private MediaSession session;
  private String title = "Полка";
  private String artist = "";
  private boolean playing;
  private long position;
  private long duration;

  @Override public IBinder onBind(Intent intent) { return null; }

  @Override public void onCreate() {
    super.onCreate();
    if (Build.VERSION.SDK_INT >= 26) {
      NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Воспроизведение", NotificationManager.IMPORTANCE_LOW);
      ch.setDescription("Управление воспроизведением Полки");
      ch.setShowBadge(false);
      ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(ch);
    }
    session = new MediaSession(this, "Shelf");
    session.setCallback(new MediaSession.Callback() {
      @Override public void onPlay() { PlayerPlugin.emit("play"); }
      @Override public void onPause() { PlayerPlugin.emit("pause"); }
      @Override public void onSkipToNext() { PlayerPlugin.emit("next"); }
      @Override public void onSkipToPrevious() { PlayerPlugin.emit("prev"); }
      @Override public void onRewind() { PlayerPlugin.emit("back10"); }
      @Override public void onFastForward() { PlayerPlugin.emit("forward"); }
      // Close (X): pause the WebView audio, remove the notification, stop the service
      @Override public void onStop() { closePlayer(); }
      @Override public void onCustomAction(String action, Bundle extras) {
        if (ACTION_STOP_SERVICE.equals(action)) closePlayer();
      }
    });
    session.setActive(true);
  }

  @Override public int onStartCommand(Intent intent, int flags, int startId) {
    if (intent != null) {
      if (ACTION_STOP_SERVICE.equals(intent.getAction())) {
        closePlayer();
        return START_NOT_STICKY;
      }
      String t=intent.getStringExtra("title"), a=intent.getStringExtra("artist");
      if (t != null && !t.isEmpty()) title=t;
      if (a != null) artist=a;
      playing=intent.getBooleanExtra("playing",false);
      position=Math.max(0L,intent.getLongExtra("pos",0));
      duration=Math.max(0L,intent.getLongExtra("dur",0));
    }
    refresh();
    return START_NOT_STICKY;
  }

  private PendingIntent openApp() {
    Intent launch=getPackageManager().getLaunchIntentForPackage(getPackageName());
    if(launch==null)return null;
    launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP);
    return PendingIntent.getActivity(this,100,launch,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
  }

  private PendingIntent action(String a){
    if("stop".equals(a)) {
      Intent intent = new Intent(this, PlayerService.class).setAction(ACTION_STOP_SERVICE);
      return PendingIntent.getService(this, 999, intent, PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
    }
    return PlayerWidget.pi(this,a);
  }

  private void refresh() {
    if(session==null)return;
    MediaMetadata.Builder md=new MediaMetadata.Builder()
      .putString(MediaMetadata.METADATA_KEY_TITLE,title)
      .putString(MediaMetadata.METADATA_KEY_ARTIST,artist)
      .putLong(MediaMetadata.METADATA_KEY_DURATION,duration);
    if(cover!=null&&!cover.isRecycled())md.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART,cover);
    session.setMetadata(md.build());

    long actions=PlaybackState.ACTION_PLAY|PlaybackState.ACTION_PAUSE|PlaybackState.ACTION_PLAY_PAUSE|
      PlaybackState.ACTION_SKIP_TO_NEXT|PlaybackState.ACTION_SKIP_TO_PREVIOUS|PlaybackState.ACTION_REWIND|
      PlaybackState.ACTION_STOP;
    // Android 13+ builds the media controls from the session state, so the close button is also a custom action
    session.setPlaybackState(new PlaybackState.Builder().setActions(actions)
      .addCustomAction(ACTION_STOP_SERVICE,"Закрыть",android.R.drawable.ic_menu_close_clear_cancel)
      .setState(playing?PlaybackState.STATE_PLAYING:PlaybackState.STATE_PAUSED,position,1f).build());

    Notification.Builder b=Build.VERSION.SDK_INT>=26?new Notification.Builder(this,CHANNEL_ID):new Notification.Builder(this);
    b.setSmallIcon(android.R.drawable.ic_media_play)
      .setContentTitle(title).setContentText(artist)
      .setLargeIcon(cover!=null&&!cover.isRecycled()?cover:null)
      .setVisibility(Notification.VISIBILITY_PUBLIC).setOngoing(playing)
      .setDeleteIntent(action("stop"));
    PendingIntent open=openApp();if(open!=null)b.setContentIntent(open);
    b.addAction(android.R.drawable.ic_media_previous,"Назад",action("prev"))
      .addAction(android.R.drawable.ic_media_rew,"-10 с",action("back10"))
      .addAction(playing?android.R.drawable.ic_media_pause:android.R.drawable.ic_media_play,playing?"Пауза":"Пуск",action("toggle"))
      .addAction(android.R.drawable.ic_media_next,"Далее",action("next"))
      .addAction(android.R.drawable.ic_menu_close_clear_cancel,"Закрыть",action("stop"))
      .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0,2,3));
    Notification n=b.build();
    if(Build.VERSION.SDK_INT>=29)startForeground(NOTIFICATION_ID,n,ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
    else startForeground(NOTIFICATION_ID,n);
    PlayerWidget.title=title;PlayerWidget.artist=artist;PlayerWidget.playing=playing;PlayerWidget.push(this);
  }

  /** Real stop: tell JS to pause <audio>, drop foreground state + notification, stop the service */
  private void closePlayer() {
    PlayerPlugin.emit("stop");
    try { if (session != null) session.setActive(false); } catch (Exception ignored) { }
    if (Build.VERSION.SDK_INT >= 24) stopForeground(Service.STOP_FOREGROUND_REMOVE);
    else stopForeground(true);
    NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
    if (nm != null) nm.cancel(NOTIFICATION_ID);
    PlayerWidget.playing = false;
    PlayerWidget.push(this);
    stopSelf();
  }

  // App swiped away from recents: nothing can keep playing, so remove the notification too
  @Override public void onTaskRemoved(Intent rootIntent) {
    closePlayer();
    super.onTaskRemoved(rootIntent);
  }

  @Override public void onDestroy(){if(session!=null){session.setActive(false);session.release();session=null;}super.onDestroy();}
}
