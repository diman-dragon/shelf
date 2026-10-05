package com.shelf.player;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import androidx.annotation.Nullable;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.common.audio.AudioProcessor;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.audio.AudioSink;
import androidx.media3.exoplayer.audio.DefaultAudioSink;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.extractor.DefaultExtractorsFactory;
import androidx.media3.session.CommandButton;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;
import androidx.media3.session.SessionCommand;
import androidx.media3.session.SessionCommands;
import androidx.media3.session.SessionResult;
import com.google.common.collect.ImmutableList;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;
import java.util.ArrayList;
import java.util.List;

/**
 * Native audiobook playback. ExoPlayer lives here (not in the WebView), so sound does not depend on the
 * screen state, WebView throttling or the JS timers. MediaSessionService posts the media notification,
 * handles audio focus, headset buttons, Bluetooth, lock-screen controls.
 */
@UnstableApi
public class PlayerService extends MediaSessionService {
  static final String PREFS = "shelf_native";
  private static final Handler MAIN = new Handler(Looper.getMainLooper());

  /** The running player (main thread only). Used by the plugin, the widget and the sleep timer. */
  static volatile ExoPlayer live;
  static volatile boolean skipSilence;

  private MediaSession session;
  private ExoPlayer player;

  // ---------------- sleep timer (native: JS timers are throttled when the screen is off) ----------------
  private static long sleepEndsAt;                       // SystemClock.elapsedRealtime(); 0 = off
  private static final long FADE_MS = 15000;
  private static final Runnable SLEEP_TICK = new Runnable() {
    @Override public void run() {
      if (sleepEndsAt == 0) return;
      ExoPlayer p = live;
      long left = sleepEndsAt - SystemClock.elapsedRealtime();
      if (left <= 0) {
        sleepEndsAt = 0;
        if (p != null) { p.pause(); p.setVolume(1f); }
        return;
      }
      if (p != null && left < FADE_MS) p.setVolume(Math.max(0.05f, left / (float) FADE_MS));
      MAIN.postDelayed(this, 500);
    }
  };

  static void setSleep(final int minutes) {
    MAIN.post(new Runnable() {
      @Override public void run() {
        MAIN.removeCallbacks(SLEEP_TICK);
        ExoPlayer p = live;
        if (p != null) p.setVolume(1f);
        if (minutes > 0) {
          sleepEndsAt = SystemClock.elapsedRealtime() + minutes * 60000L;
          MAIN.postDelayed(SLEEP_TICK, 500);
        } else {
          sleepEndsAt = 0;
        }
      }
    });
  }

  static long sleepLeftMs() {
    return sleepEndsAt == 0 ? 0 : Math.max(0, sleepEndsAt - SystemClock.elapsedRealtime());
  }

  static void setSkipSilence(final boolean on) {
    skipSilence = on;
    MAIN.post(new Runnable() {
      @Override public void run() {
        ExoPlayer p = live;
        if (p != null) p.setSkipSilenceEnabled(on);
      }
    });
  }

  /** Widget buttons. Works while the service is alive (even if the Activity/WebView is gone). */
  static void handleAction(final String a) {
    MAIN.post(new Runnable() {
      @Override public void run() {
        ExoPlayer p = live;
        if (p == null) return;
        if ("toggle".equals(a)) { if (p.getPlayWhenReady()) p.pause(); else p.play(); }
        else if ("prev".equals(a)) { if (p.getCurrentPosition() > 6000) p.seekTo(0); else p.seekToPreviousMediaItem(); }
        else if ("next".equals(a)) p.seekToNextMediaItem();
        else if ("back10".equals(a)) p.seekBack();
        else if ("forward".equals(a)) p.seekForward();
      }
    });
  }

  // ---------------- close (X) button in the notification shade / lock screen ----------------
  private static final String ACTION_CLOSE = "com.shelf.player.CLOSE";
  private static final SessionCommand CLOSE_COMMAND = new SessionCommand(ACTION_CLOSE, Bundle.EMPTY);

  private CommandButton closeButton() {
    return new CommandButton.Builder()
        .setDisplayName("Закрыть")
        .setIconResId(R.drawable.ic_notif_close)
        .setSessionCommand(CLOSE_COMMAND)
        .build();
  }

  /**
   * The X in the notification shade / lock screen: remember the position, fully stop playback, remove the
   * notification and shut the service down.
   * NOTE: pauseAllPlayersAndStopSelf() alone was not enough — the app's own MediaController (PlayerPlugin) stays
   * bound to this service, and a bound service survives stopSelf(), so the notification just stayed there.
   * Therefore the player is stopped explicitly, the notification is removed by hand and the bound controller is released.
   */
  private void closePlayback() {
    persistPosition();
    MAIN.removeCallbacks(SLEEP_TICK);
    sleepEndsAt = 0;
    ExoPlayer p = player;
    if (p != null) {
      try { p.setVolume(1f); p.pause(); p.stop(); p.clearMediaItems(); } catch (Exception ignored) { }
    }
    PlayerWidget.playing = false;
    try { PlayerWidget.push(getApplicationContext()); } catch (Exception ignored) { }
    try { stopForeground(Service.STOP_FOREGROUND_REMOVE); } catch (Exception ignored) { }
    try {
      NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
      if (nm != null) nm.cancel(1001);               // default Media3 notification id
    } catch (Exception ignored) { }
    PlayerPlugin.emitClosed();                       // tells JS and releases the controller bound to this service
    pauseAllPlayersAndStopSelf();
  }

  // ---------------- lifecycle ----------------
  @Override public void onCreate() {
    super.onCreate();

    DefaultRenderersFactory renderers = new DefaultRenderersFactory(this) {
      @Override protected AudioSink buildAudioSink(Context context, boolean enableFloatOutput,
                                                   boolean enableAudioTrackPlaybackParams) {
        // EQ / headroom / limiter run inside the native pipeline, before the speed (Sonic) stage
        return new DefaultAudioSink.Builder(context)
            .setEnableFloatOutput(enableFloatOutput)
            .setEnableAudioTrackPlaybackParams(enableAudioTrackPlaybackParams)
            .setAudioProcessors(new AudioProcessor[] { new FxAudioProcessor() })
            .build();
      }
    };
    // VBR mp3 without a seek table: constant-bitrate seeking keeps the position accurate for long books
    DefaultMediaSourceFactory sources = new DefaultMediaSourceFactory(this,
        new DefaultExtractorsFactory().setConstantBitrateSeekingEnabled(true));

    player = new ExoPlayer.Builder(this, renderers, sources)
        .setAudioAttributes(new AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_SPEECH).build(), true)
        .setHandleAudioBecomingNoisy(true)
        .setWakeMode(C.WAKE_MODE_LOCAL)          // CPU stays awake while playing with the screen off
        .setSeekBackIncrementMs(10000)
        .setSeekForwardIncrementMs(30000)
        .build();
    player.setSkipSilenceEnabled(skipSilence);
    player.addListener(new Player.Listener() {
      @Override public void onIsPlayingChanged(boolean isPlaying) {
        MAIN.removeCallbacks(persistTick);
        if (isPlaying) MAIN.postDelayed(persistTick, 5000);
        persistPosition();
        pushWidget();
      }
      @Override public void onMediaItemTransition(@Nullable MediaItem item, int reason) {
        persistPosition();
        pushWidget();
      }
      @Override public void onPositionDiscontinuity(Player.PositionInfo o, Player.PositionInfo n, int reason) {
        persistPosition();
      }
    });
    live = player;

    PendingIntent open = null;
    Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
    if (launch != null) {
      launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
      open = PendingIntent.getActivity(this, 100, launch,
          PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    final ImmutableList<CommandButton> layout = ImmutableList.of(closeButton());
    MediaSession.Builder b = new MediaSession.Builder(this, player).setCallback(new MediaSession.Callback() {
      // every controller (incl. the system notification) may use the custom CLOSE command and gets the X button
      @Override public MediaSession.ConnectionResult onConnect(MediaSession s, MediaSession.ControllerInfo c) {
        SessionCommands cmds = MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.buildUpon().add(CLOSE_COMMAND).build();
        return new MediaSession.ConnectionResult.AcceptedResultBuilder(s)
            .setAvailableSessionCommands(cmds)
            .setCustomLayout(layout)
            .build();
      }
      @Override public ListenableFuture<SessionResult> onCustomCommand(MediaSession s, MediaSession.ControllerInfo c,
                                                                       SessionCommand command, Bundle args) {
        if (ACTION_CLOSE.equals(command.customAction)) {
          closePlayback();
          return Futures.immediateFuture(new SessionResult(SessionResult.RESULT_SUCCESS));
        }
        return Futures.immediateFuture(new SessionResult(SessionResult.RESULT_ERROR_NOT_SUPPORTED));
      }
      // Controllers send items by value; make sure the playable URI survives the trip
      @Override public ListenableFuture<List<MediaItem>> onAddMediaItems(MediaSession s,
          MediaSession.ControllerInfo c, List<MediaItem> items) {
        List<MediaItem> out = new ArrayList<>(items.size());
        for (MediaItem it : items) {
          android.net.Uri uri = it.localConfiguration != null ? it.localConfiguration.uri : it.requestMetadata.mediaUri;
          out.add(uri != null ? it.buildUpon().setUri(uri).build() : it);
        }
        return Futures.immediateFuture(out);
      }
    });
    if (open != null) b.setSessionActivity(open);
    session = b.build();
    session.setCustomLayout(layout);
  }

  @Nullable @Override public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
    return session;
  }

  /** App swiped from recents: stop playback and remove the notification (same behaviour as before). */
  @Override public void onTaskRemoved(@Nullable Intent rootIntent) {
    persistPosition();
    pauseAllPlayersAndStopSelf();
  }

  @Override public void onDestroy() {
    MAIN.removeCallbacks(persistTick);
    MAIN.removeCallbacks(SLEEP_TICK);
    sleepEndsAt = 0;
    persistPosition();
    live = null;
    if (session != null) {
      session.getPlayer().release();
      session.release();
      session = null;
    }
    PlayerWidget.playing = false;
    PlayerWidget.push(getApplicationContext());
    PlayerPlugin.emitClosed();
    super.onDestroy();
  }

  // ---------------- helpers ----------------
  private final Runnable persistTick = new Runnable() {
    @Override public void run() {
      persistPosition();
      if (player != null && player.isPlaying()) MAIN.postDelayed(this, 5000);
    }
  };

  /** Survives the death of the WebView/app: JS reads it on start (Player.getState().saved). */
  private void persistPosition() {
    ExoPlayer p = player;
    if (p == null) return;
    MediaItem it = p.getCurrentMediaItem();
    if (it == null || it.mediaId == null) return;
    int colon = it.mediaId.lastIndexOf(':');
    if (colon <= 0) return;
    getSharedPreferences(PREFS, MODE_PRIVATE).edit()
        .putString("bookId", it.mediaId.substring(0, colon))
        .putInt("index", p.getCurrentMediaItemIndex())
        .putFloat("pos", p.getCurrentPosition() / 1000f)
        .putLong("ts", System.currentTimeMillis())
        .apply();
  }

  private void pushWidget() {
    ExoPlayer p = player;
    if (p == null) return;
    androidx.media3.common.MediaMetadata md = p.getMediaMetadata();
    if (md.title != null) PlayerWidget.title = md.title.toString();
    if (md.artist != null) PlayerWidget.artist = md.artist.toString();
    PlayerWidget.playing = p.getPlayWhenReady() && p.getPlaybackState() != Player.STATE_ENDED;
    PlayerWidget.push(getApplicationContext());
  }
}
