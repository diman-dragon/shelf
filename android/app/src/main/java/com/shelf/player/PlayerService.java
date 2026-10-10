package com.shelf.player;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import androidx.annotation.Nullable;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.ForwardingPlayer;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.audio.AudioProcessor;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.LoadControl;
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
        sleepVol = 1f;
        if (p != null) { p.pause(); applyVolume(p); }
        return;
      }
      if (p != null && left < FADE_MS) { sleepVol = Math.max(0.05f, left / (float) FADE_MS); applyVolume(p); }
      MAIN.postDelayed(this, 500);
    }
  };

  static void setSleep(final int minutes) {
    MAIN.post(new Runnable() {
      @Override public void run() {
        MAIN.removeCallbacks(SLEEP_TICK);
        ExoPlayer p = live;
        sleepVol = 1f;
        applyVolume(p);
        if (minutes > 0) {
          sleepEndsAt = SystemClock.elapsedRealtime() + minutes * 60000L;
          MAIN.postDelayed(SLEEP_TICK, 500);
        } else {
          sleepEndsAt = 0;
        }
      }
    });
  }

  // ---------------- seek step (settings: default ±10 s) ----------------
  private static volatile long seekStepMs = 10_000L;

  static void setSeekStepMs(long ms) { seekStepMs = Math.max(1000L, Math.min(300_000L, ms)); }

  /** Moves inside the current chapter by delta, never past its start or end. */
  private static void seekByMs(Player p, long deltaMs) {
    long dur = p.getDuration();
    long t = p.getCurrentPosition() + deltaMs;
    if (t < 0) t = 0;
    if (dur != C.TIME_UNSET && t > dur) t = dur;
    p.seekTo(t);
  }

  // ---------------- phone calls / notifications: stop at once, continue 5 s earlier ----------------
  // Two sources: (1) audio-focus loss (ExoPlayer suppresses playback; with the SPEECH content type this includes the
  // "may duck" notification sounds), (2) the phone switching to call mode (Android 12+, works even when the calling app
  // never requests audio focus). Playback continues only when both are over, REWIND_MS before where it stopped.
  private final ErrorRecovery recovery = new ErrorRecovery();
  private final Interruption interruption = new Interruption();
  private boolean pausedByUs;                      // we paused because of a call (ExoPlayer does not resume by itself then)
  private CallModeWatcher callWatcher;

  private long interruptionSince;                  // SystemClock.elapsedRealtime() when the current interruption began

  private void interruptionBegin() {
    ExoPlayer p = player;
    if (p == null) return;
    boolean was = interruption.isActive();
    interruption.begin(p.getPlayWhenReady(), p.getCurrentMediaItemIndex(), p.getCurrentPosition());
    if (!was && interruption.isActive()) {
      interruptionSince = SystemClock.elapsedRealtime();
      // 1) written to disk: the system may kill the process during a 15-30 minute call, flags in RAM would be lost with it
      String id = currentBookId();
      if (id != null) QueueStore.saveInterruption(this, id, interruption.index(), interruption.posMs());
      // 2) keep the service a FOREGROUND one while it is paused by the call (see onUpdateNotification)
      keepForegroundNow();
    }
  }

  private void interruptionOver() {
    QueueStore.clearInterruption(this);
    interruptionSince = 0;
  }

  /** "book id" part of the current media id ("<bookId>:<index>"), or null */
  private String currentBookId() {
    ExoPlayer p = player;
    MediaItem it = p == null ? null : p.getCurrentMediaItem();
    if (it == null || it.mediaId == null) return null;
    int colon = it.mediaId.lastIndexOf(':');
    return colon > 0 ? it.mediaId.substring(0, colon) : null;
  }

  /**
   * A call / notification sound paused the player: the service must stay in the FOREGROUND. Media3 drops the foreground
   * status as soon as playback is paused, the process then counts as an ordinary background one, and during a long call
   * (Doze, low-memory killer) the system destroys it — the shade was left with a dead "Play" button.
   * Held only while the interruption is active, and for at most INTERRUPTION_HOLD_MS (a stuck interruption must not pin the service forever).
   */
  private static final long INTERRUPTION_HOLD_MS = 3L * 60 * 60 * 1000;

  private boolean holdForeground() {
    if (!(pausedByUs || interruption.isActive())) return false;
    return interruptionSince != 0 && SystemClock.elapsedRealtime() - interruptionSince < INTERRUPTION_HOLD_MS;
  }

  /** Same call Media3 makes itself, but with "stay in foreground" forced on; the system refusing it is not an error here. */
  private void keepForegroundNow() {
    final MediaSession s = session;
    if (s == null) return;
    MAIN.post(new Runnable() {
      @Override public void run() {
        try { if (holdForeground()) onUpdateNotification(s, true); } catch (Exception ignored) { }
      }
    });
  }

  @Override public void onUpdateNotification(MediaSession s, boolean startInForegroundRequired) {
    super.onUpdateNotification(s, startInForegroundRequired || holdForeground());
  }

  private void interruptionMaybeEnd() {
    ExoPlayer p = player;
    if (p == null) { interruption.cancel(); interruptionOver(); return; }
    if (!interruption.shouldResume()) return;
    int idx = interruption.index();
    if (p.getCurrentMediaItemIndex() == idx) {     // still on the same chapter (the person did not navigate meanwhile)
      p.seekTo(idx, Interruption.rewindPosition(interruption.posMs()));   // 5 s back, but never before the chapter start
    }
    interruptionOver();
    if (pausedByUs) {
      pausedByUs = false;
      if (!p.getPlayWhenReady()) p.play();
    }
  }

  private void onCallMode(boolean inCall) {
    ExoPlayer p = player;
    if (p == null) return;
    if (inCall) {
      interruptionBegin();                          // remember the exact place BEFORE pausing
      interruption.setCallMode(true);
      if (interruption.isActive() && p.getPlayWhenReady()) { pausedByUs = true; p.pause(); }
    } else {
      interruption.setCallMode(false);
      interruptionMaybeEnd();
    }
  }

  // ---------------- playback mode: book (gapless) / album (fade out, short pause, fade in) ----------------
  private static volatile boolean albumMode;
  private static float sleepVol = 1f, albumVol = 1f;        // the sleep-timer fade and the album fade share ONE volume: the lower wins
  private static long fadeInFrom;                           // SystemClock.uptimeMillis() when the post-gap fade-in began
  private static boolean gapPending;

  private static void applyVolume(ExoPlayer p) {
    if (p != null) p.setVolume(Math.min(sleepVol, albumVol));
  }

  private static final Runnable ALBUM_TICK = new Runnable() { @Override public void run() { albumStep(); } };

  /** The pause between two tracks is over: start the next one with a short fade-in. */
  private static final Runnable ALBUM_RESUME = new Runnable() {
    @Override public void run() {
      gapPending = false;
      ExoPlayer p = live;
      if (p == null || !albumMode) return;
      if (!p.getPlayWhenReady() && p.getPlaybackState() != Player.STATE_ENDED) {
        fadeInFrom = SystemClock.uptimeMillis();
        albumVol = 0f;
        applyVolume(p);
        p.play();
      }
    }
  };

  /** Looks at the position and sets the fade volume. Cheap: wakes up rarely while the track is far from its end. */
  static void albumStep() {
    MAIN.removeCallbacks(ALBUM_TICK);
    ExoPlayer p = live;
    if (p == null) return;
    if (!albumMode) { albumVol = 1f; applyVolume(p); return; }
    if (!p.isPlaying()) return;                             // onIsPlayingChanged(true) restarts the loop
    long dur = p.getDuration(), pos = p.getCurrentPosition();
    float speed = p.getPlaybackParameters().speed;
    if (speed <= 0f) speed = 1f;
    long since = SystemClock.uptimeMillis() - fadeInFrom;
    boolean fadingIn = since < AlbumFade.FADE_IN_MS;
    float v = 1f;
    long left = Long.MAX_VALUE;
    if (dur != C.TIME_UNSET && dur > 0) {
      left = (long) ((dur - pos) / speed);
      v = AlbumFade.fadeOut(left);
    }
    if (fadingIn) v = Math.min(v, AlbumFade.fadeIn(since));
    albumVol = v;
    applyVolume(p);
    MAIN.postDelayed(ALBUM_TICK, left == Long.MAX_VALUE ? 1000 : AlbumFade.nextCheckMs(left, fadingIn));
  }

  static void setAlbumMode(final boolean on) {
    albumMode = on;
    MAIN.post(new Runnable() {
      @Override public void run() {
        ExoPlayer p = live;
        MAIN.removeCallbacks(ALBUM_RESUME);
        gapPending = false;
        albumVol = 1f;
        if (p != null) {
          p.setPauseAtEndOfMediaItems(on);
          applyVolume(p);
          if (on) albumStep();
        }
      }
    });
  }

  static long sleepLeftMs() {
    return sleepEndsAt == 0 ? 0 : Math.max(0, sleepEndsAt - SystemClock.elapsedRealtime());
  }

  /** Widget buttons. Only wired while a book is loaded in the service (see PlayerWidget.push), even if the Activity/WebView is gone. */
  static void handleAction(final String a) {
    MAIN.post(new Runnable() {
      @Override public void run() {
        ExoPlayer p = live;
        if (p == null) return;
        if ("toggle".equals(a)) { if (p.getPlayWhenReady()) p.pause(); else p.play(); }
        else if ("prev".equals(a)) { if (p.getCurrentPosition() > 6000) p.seekTo(0); else p.seekToPreviousMediaItem(); }
        else if ("next".equals(a)) p.seekToNextMediaItem();
        else if ("back".equals(a)) seekByMs(p, -seekStepMs);
        else if ("forward".equals(a)) seekByMs(p, seekStepMs);
      }
    });
  }

  // ---------------- close (X) button in the notification shade / lock screen ----------------
  private static final String ACTION_CLOSE = "com.shelf.player.CLOSE";
  private static final SessionCommand CLOSE_COMMAND = new SessionCommand(ACTION_CLOSE, Bundle.EMPTY);

  private CommandButton closeButton() {
    return new CommandButton.Builder()
        .setDisplayName(getString(R.string.close))
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
    MAIN.removeCallbacks(ALBUM_TICK);
    MAIN.removeCallbacks(ALBUM_RESUME);
    gapPending = false;
    interruption.cancel(); pausedByUs = false; interruptionOver(); recovery.reset();
    sleepEndsAt = 0;
    sleepVol = 1f; albumVol = 1f;
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

  // ---------------- loudness normalisation (see Normalizer) ----------------
  static volatile PlayerService self;

  private static String uriOf(MediaItem it) {
    return it != null && it.localConfiguration != null ? it.localConfiguration.uri.toString() : null;
  }

  /** Puts the measured correction of the file that plays now into the DSP chain (0 = none / not measured yet / switched off). */
  private void applyNorm() {
    float g = 0f;
    ExoPlayer p = player;
    if (Normalizer.enabled && p != null) {
      String u = uriOf(p.getCurrentMediaItem());
      if (u != null) {
        float c = Normalizer.cached(this, u);
        if (!Float.isNaN(c)) g = c;
      }
    }
    AudioFx.shared.setNorm(g);
  }

  /** The current file first, then the rest of the book in playing order: measured in the background, one at a time. */
  private void scheduleNorm() {
    ExoPlayer p = player;
    if (p == null || !Normalizer.enabled) return;
    int n = p.getMediaItemCount();
    if (n == 0) return;
    int cur = Math.max(0, p.getCurrentMediaItemIndex());
    List<String> order = new ArrayList<>();
    for (int k = 0; k < n && k < 300; k++) order.add(uriOf(p.getMediaItemAt((cur + k) % n)));
    Normalizer.enqueue(this, order);
  }

  private void normChanged() { applyNorm(); scheduleNorm(); }

  /** Settings switch (any thread): re-applies or removes the correction right away. */
  static void refreshNorm() {
    MAIN.post(new Runnable() {
      @Override public void run() {
        PlayerService s = self;
        if (s != null) s.normChanged();
        else AudioFx.shared.setNorm(0f);
      }
    });
  }

  // ---------------- lifecycle ----------------
  @Override public void onCreate() {
    super.onCreate();
    self = this;
    Normalizer.listener = new Normalizer.Listener() {
      @Override public void onMeasured(String uri) {
        MAIN.post(new Runnable() { @Override public void run() { PlayerService s = self; if (s != null) s.applyNorm(); } });
      }
    };

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

    // Buffering tuned for audiobooks (long files, one continuous stream, often slow SAF/SD-card/cloud sources).
    // ExoPlayer starts preparing the NEXT chapter only when the current file is fully buffered. With the default
    // 50 s ceiling that happens ~50 s before the chapter ends — too little when opening a file is slow
    // (throttled I/O under battery saver). 60..180 s keeps a big cushion, so the next chapter is already open and
    // decoded-ready when the current one ends. Bursty loading (refill below 60 s, stop at 180 s) also lets
    // storage and radio idle between bursts, which is cheaper for the battery than a trickle.
    LoadControl loadControl = new DefaultLoadControl.Builder()
        .setBufferDurationsMs(60_000, 180_000, 2_500, 5_000)
        .setTargetBufferBytes(24 * 1024 * 1024)      // cap for lossless files (FLAC/WAV), where 180 s would be huge
        .build();

    player = new ExoPlayer.Builder(this, renderers, sources)
        .setLoadControl(loadControl)
        .setAudioAttributes(new AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_SPEECH).build(), true)
        .setHandleAudioBecomingNoisy(true)
        .setWakeMode(C.WAKE_MODE_LOCAL)          // CPU stays awake while playing with the screen off
        .setSeekBackIncrementMs(10000)        // the real step is chosen in the settings: see seekStepMs / the session wrapper below
        .setSeekForwardIncrementMs(10000)
        .build();
    player.setPauseAtEndOfMediaItems(albumMode);      // "album" mode: stop after every track (the gap is timed below)
    player.addListener(new Player.Listener() {
      @Override public void onIsPlayingChanged(boolean isPlaying) {
        MAIN.removeCallbacks(persistTick);
        if (isPlaying) { MAIN.postDelayed(persistTick, 5000); if (albumMode) albumStep(); }
        persistPosition();
        pushWidget();
      }
      @Override public void onMediaItemTransition(@Nullable MediaItem item, int reason) {
        normChanged();                               // the next file may be louder or quieter than this one
        persistPosition();
        pushWidget();
        if (albumMode) albumStep();
      }
      @Override public void onPositionDiscontinuity(Player.PositionInfo o, Player.PositionInfo n, int reason) {
        persistPosition();
        if (albumMode) albumStep();                  // the user skipped/seeked in the middle of a fade: back to full volume
      }
      /**
       * A playback error. Runs in the service, so it works with the screen off and without the app UI.
       * A transient one (I/O broke after a long pause, the audio device was reset) is retried ONCE at the same spot;
       * only a repeated or a hard error (missing/unreadable file, unsupported format) skips to the next chapter.
       */
      @Override public void onPlayerError(PlaybackException e) {
        final ExoPlayer p = player;
        if (p == null) return;
        final int idx = p.getCurrentMediaItemIndex();
        final long pos = p.getCurrentPosition();
        int c = e.errorCode;
        boolean transientErr = c == PlaybackException.ERROR_CODE_IO_UNSPECIFIED
            || c == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED
            || c == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT
            || c == PlaybackException.ERROR_CODE_TIMEOUT
            || c == PlaybackException.ERROR_CODE_AUDIO_TRACK_INIT_FAILED
            || c == PlaybackException.ERROR_CODE_AUDIO_TRACK_WRITE_FAILED
            || c == PlaybackException.ERROR_CODE_UNSPECIFIED;
        if (recovery.decide(transientErr, idx, pos, SystemClock.elapsedRealtime()) == ErrorRecovery.Action.RETRY) {
          MAIN.postDelayed(new Runnable() { @Override public void run() {      // give the provider / device a moment
            ExoPlayer q = player;
            if (q != null && q.getPlaybackState() == Player.STATE_IDLE) { q.seekTo(idx, pos); q.prepare(); }
          }}, 600);
        } else {
          PlayerPlugin.emitError(e.getErrorCodeName(), idx);                    // the UI shows a message
          if (p.getPlayWhenReady() && p.hasNextMediaItem()) { p.seekToNextMediaItem(); p.prepare(); p.play(); }
        }
      }
      // audio focus taken by a call / notification sound (ExoPlayer pauses at this very moment) and given back
      @Override public void onPlaybackSuppressionReasonChanged(int reason) {
        if (reason == Player.PLAYBACK_SUPPRESSION_REASON_TRANSIENT_AUDIO_FOCUS_LOSS) {
          interruptionBegin();
          interruption.setFocusLost(true);
        } else {
          interruption.setFocusLost(false);
          interruptionMaybeEnd();
        }
      }
      // "album" mode: ExoPlayer paused at the end of a track -> wait a moment, then continue with the next one
      @Override public void onPlayWhenReadyChanged(boolean playWhenReady, int reason) {
        ExoPlayer p = player;
        // the person pressed play themselves (app, notification, headset): they decide, no automatic step back / resume
        if (playWhenReady && reason == Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST) { interruption.cancel(); pausedByUs = false; interruptionOver(); }
        if (reason == Player.PLAY_WHEN_READY_CHANGE_REASON_END_OF_MEDIA_ITEM) {
          if (albumMode && !playWhenReady && p != null && !gapPending
              && p.getPlaybackState() != Player.STATE_ENDED
              && AlbumFade.shouldResumeAfterGap(p.hasNextMediaItem(), p.getCurrentPosition(), p.getDuration())) {
            gapPending = true;
            MAIN.postDelayed(ALBUM_RESUME, AlbumFade.GAP_MS);
          }
        } else {
          MAIN.removeCallbacks(ALBUM_RESUME);        // the person pressed play/pause during the gap: their choice wins
          gapPending = false;
        }
      }
    });
    seekStepMs = QueueStore.loadSeekMs(this);
    live = player;
    if (Build.VERSION.SDK_INT >= 31) {
      callWatcher = new CallModeWatcher(this, new CallModeWatcher.Callback() {
        @Override public void onCallMode(boolean inCall) { PlayerService.this.onCallMode(inCall); }
      });
      callWatcher.start();
    }
    pushWidget();                                // widget buttons switch from "open the app" to "control the player"

    PendingIntent open = null;
    Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
    if (launch != null) {
      launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
      open = PendingIntent.getActivity(this, 100, launch,
          PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    final ImmutableList<CommandButton> layout = ImmutableList.of(closeButton());
    // The notification / lock screen / headset seek buttons use the step chosen in the settings (changes at any time,
    // an ExoPlayer cannot change its built-in increments after it was built, hence this thin wrapper).
    Player sessionPlayer = new ForwardingPlayer(player) {
      @Override public long getSeekBackIncrement() { return seekStepMs; }
      @Override public long getSeekForwardIncrement() { return seekStepMs; }
      @Override public void seekBack() { seekByMs(this, -seekStepMs); }
      @Override public void seekForward() { seekByMs(this, seekStepMs); }
    };
    MediaSession.Builder b = new MediaSession.Builder(this, sessionPlayer).setCallback(new MediaSession.Callback() {
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
      /**
       * "Play" pressed on a PAUSED notification after the system killed the process: Media3 restarts this service with an
       * empty player and asks what to play. The queue (QueueStore) and the position (persistPosition) were saved natively.
       * Without this the button did nothing / the player glitched. (No @Override on purpose: the signature differs
       * between Media3 versions; with the right one this is called, otherwise it is simply unused.)
       */
      public ListenableFuture<MediaSession.MediaItemsWithStartPosition> onPlaybackResumption(MediaSession s, MediaSession.ControllerInfo c) {
        QueueStore.Restored r = QueueStore.load(PlayerService.this);
        if (r == null) return Futures.immediateFailedFuture(new UnsupportedOperationException("nothing to resume"));
        QueueStore.clearInterruption(PlayerService.this);     // consumed: the position above already includes the 5 s step back
        ExoPlayer p = player;
        albumMode = r.album;
        if (p != null) { p.setPlaybackSpeed(r.speed); p.setPauseAtEndOfMediaItems(r.album); }
        return Futures.immediateFuture(new MediaSession.MediaItemsWithStartPosition(r.items, r.index, r.posMs));
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

  /**
   * App swiped from recents: remember the position, stop playback and REMOVE the player from the notification shade.
   * pauseAllPlayersAndStopSelf() alone leaves the notification behind (the app's own MediaController stays bound to
   * this service, and a bound service survives stopSelf()), so the full shutdown of the X button is used.
   */
  @Override public void onTaskRemoved(@Nullable Intent rootIntent) {
    closePlayback();
  }

  @Override public void onDestroy() {
    MAIN.removeCallbacks(persistTick);
    MAIN.removeCallbacks(SLEEP_TICK);
    MAIN.removeCallbacks(ALBUM_TICK);
    MAIN.removeCallbacks(ALBUM_RESUME);
    gapPending = false;
    sleepEndsAt = 0;
    persistPosition();
    if (callWatcher != null) { callWatcher.stop(); callWatcher = null; }
    interruption.cancel();
    // NOT cleared here on purpose: if the service is destroyed by the system in the middle of a call, the saved
    // interruption is exactly what "Play" in the shade needs afterwards (onPlaybackResumption)
    live = null;
    self = null;
    Normalizer.listener = null;
    AudioFx.shared.setNorm(0f);
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
