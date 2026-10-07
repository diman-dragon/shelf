package com.shelf.player;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Base64;
import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.common.util.concurrent.ListenableFuture;
import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONObject;

/**
 * JS bridge to the native player. The whole book is handed to ExoPlayer as a playlist, so chapter changes,
 * seeking, speed and sleep timer keep working while the WebView is paused (screen off).
 * Events to JS: "state" (position/playing, ~2/s while playing), "error", "closed", "fft" (visualizer).
 */
@UnstableApi
@CapacitorPlugin(name = "Player")
public class PlayerPlugin extends Plugin {
  private static volatile PlayerPlugin inst;
  private final Handler main = new Handler(Looper.getMainLooper());

  private MediaController controller;
  private boolean connecting;
  private final List<Pending> pending = new ArrayList<>();
  private boolean vizOn;
  private final byte[] fftBuf = new byte[128];

  private interface Op { void run(MediaController c); }
  private static final class Pending {
    final Op op; final PluginCall call;
    Pending(Op op, PluginCall call) { this.op = op; this.call = call; }
  }

  @Override public void load() { inst = this; }

  @Override protected void handleOnDestroy() {
    // the WebView is gone: nobody can draw a spectrum any more, so stop the FFT tap on the audio thread too
    // (it used to stay on for as long as the service kept playing)
    AudioFx.shared.setSpectrum(false);
    main.post(new Runnable() { @Override public void run() {
      vizOn = false;
      main.removeCallbacks(tick); main.removeCallbacks(vizTick);
      if (controller != null) { controller.release(); controller = null; }
    }});
    if (inst == this) inst = null;
    super.handleOnDestroy();
  }

  /** Called by the service when it is destroyed (notification dismissed, app removed from recents). */
  static void emitClosed() {
    final PlayerPlugin p = inst;
    if (p == null) return;
    p.main.post(new Runnable() { @Override public void run() {
      // release (not just forget) the controller: while it is bound the service cannot be destroyed
      p.main.removeCallbacks(p.tick);
      if (p.controller != null) {
        try { p.controller.release(); } catch (Exception ignored) { }
        p.controller = null;
      }
      p.notifyListeners("closed", new JSObject());
    }});
  }

  // ------------------------------------------------------------------ controller plumbing
  private void withController(final PluginCall call, final Op op) {
    main.post(new Runnable() { @Override public void run() {
      if (controller != null && controller.isConnected()) { safe(call, op, controller); return; }
      pending.add(new Pending(op, call));
      if (connecting) return;
      connecting = true;
      main.postDelayed(connectTimeout, 8000);
      Context ctx = getContext();
      SessionToken token = new SessionToken(ctx, new ComponentName(ctx, PlayerService.class));
      final ListenableFuture<MediaController> f = new MediaController.Builder(ctx, token)
          .setListener(new MediaController.Listener() {
            @Override public void onDisconnected(@NonNull MediaController c) { controller = null; }
          }).buildAsync();
      f.addListener(new Runnable() { @Override public void run() {
        connecting = false;
        main.removeCallbacks(connectTimeout);
        try {
          controller = f.get();
          controller.addListener(playerListener);
        } catch (Exception e) {
          controller = null;
          for (Pending p : pending) if (p.call != null) p.call.reject("Не удалось подключиться к плееру", e);
          pending.clear();
          return;
        }
        List<Pending> run = new ArrayList<>(pending);
        pending.clear();
        for (Pending p : run) safe(p.call, p.op, controller);
        scheduleTick();
      }}, ContextCompat.getMainExecutor(ctx));
    }});
  }

  /** The player service did not answer in time: fail the waiting calls instead of leaving the UI waiting forever. */
  private final Runnable connectTimeout = new Runnable() { @Override public void run() {
    if (!connecting) return;
    connecting = false;
    for (Pending p : pending) if (p.call != null) p.call.reject("Плеер не отвечает");
    pending.clear();
  }};

  private void safe(PluginCall call, Op op, MediaController c) {
    try { op.run(c); }
    catch (Exception e) { if (call != null) call.reject("Ошибка плеера: " + e.getMessage(), e); }
  }

  private final Player.Listener playerListener = new Player.Listener() {
    @Override public void onEvents(@NonNull Player player, @NonNull Player.Events events) {
      emitState(player);
      scheduleTick();
    }
    @Override public void onPlayerError(@NonNull PlaybackException e) {
      MediaController c = controller;
      JSObject o = new JSObject();
      o.put("message", String.valueOf(e.getErrorCodeName()));
      o.put("index", c != null ? c.getCurrentMediaItemIndex() : -1);
      notifyListeners("error", o);
      // unreadable chapter: skip to the next one instead of freezing the book
      if (c != null && c.getPlayWhenReady() && c.hasNextMediaItem()) {
        c.seekToNextMediaItem();
        c.prepare();
        c.play();
      }
    }
  };

  private final Runnable tick = new Runnable() { @Override public void run() {
    MediaController c = controller;
    if (c == null || !c.isConnected()) return;
    emitState(c);
    if (c.isPlaying()) main.postDelayed(this, 500);
  }};

  private void scheduleTick() {
    main.removeCallbacks(tick);
    MediaController c = controller;
    if (c != null && c.isPlaying()) main.postDelayed(tick, 500);
  }

  private final Runnable vizTick = new Runnable() { @Override public void run() {
    if (!vizOn) return;
    AudioFx.shared.spectrum(fftBuf);
    JSArray arr = new JSArray();
    for (byte b : fftBuf) arr.put(b & 255);
    JSObject o = new JSObject();
    o.put("d", arr);
    notifyListeners("fft", o);
    main.postDelayed(this, 66);
  }};

  private void fill(JSObject o, Player c) {
    MediaItem it = c.getCurrentMediaItem();
    String mid = it != null && it.mediaId != null ? it.mediaId : "";
    int colon = mid.lastIndexOf(':');
    long dur = c.getDuration();
    o.put("bookId", colon > 0 ? mid.substring(0, colon) : "");
    o.put("index", c.getCurrentMediaItemIndex());
    o.put("count", c.getMediaItemCount());
    o.put("pos", c.getCurrentPosition() / 1000.0);
    o.put("dur", dur == C.TIME_UNSET ? 0.0 : dur / 1000.0);
    o.put("playWhenReady", c.getPlayWhenReady());
    o.put("playing", c.isPlaying());
    o.put("state", c.getPlaybackState());          // 1 idle, 2 buffering, 3 ready, 4 ended
    o.put("speed", c.getPlaybackParameters().speed);
    o.put("sleepLeft", PlayerService.sleepLeftMs() / 1000.0);
  }

  private void emitState(Player c) {
    JSObject o = new JSObject();
    fill(o, c);
    notifyListeners("state", o);
  }

  private JSObject saved() {
    SharedPreferences sp = getContext().getSharedPreferences(PlayerService.PREFS, Context.MODE_PRIVATE);
    JSObject s = new JSObject();
    String id = sp.getString("bookId", "");
    if (id == null || id.isEmpty()) return s;
    s.put("bookId", id);
    s.put("index", sp.getInt("index", 0));
    s.put("pos", (double) sp.getFloat("pos", 0f));
    s.put("ts", sp.getLong("ts", 0L));
    return s;
  }

  // ------------------------------------------------------------------ JS API
  @PluginMethod
  public void setQueue(final PluginCall call) {
    JSArray arr = call.getArray("items");
    if (arr == null || arr.length() == 0) { call.reject("Пустая очередь"); return; }
    final String bookId = call.getString("bookId", "");
    final String bookTitle = call.getString("bookTitle", "");
    final String author = call.getString("author", "");
    final int index = Math.max(0, Math.min(call.getInt("index", 0), arr.length() - 1));
    final long posMs = Math.max(0L, Math.round(call.getDouble("pos", 0.0) * 1000.0));
    final boolean play = call.getBoolean("play", false);
    final float speed = call.getFloat("speed", 1f);
    final Uri art = saveCover(call.getString("cover", ""));

    final List<MediaItem> items = new ArrayList<>();
    try {
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
    } catch (Exception e) { call.reject("Некорректный список глав", e); return; }

    withController(call, new Op() { @Override public void run(MediaController c) {
      c.setMediaItems(items, index, posMs);
      c.setPlaybackSpeed(speed);
      c.prepare();
      if (play) c.play(); else c.pause();
      call.resolve();
    }});
  }

  @PluginMethod
  public void play(final PluginCall call) {
    withController(call, new Op() { @Override public void run(MediaController c) {
      if (c.getMediaItemCount() == 0) { call.reject("Очередь пуста"); return; }
      if (c.getPlaybackState() == Player.STATE_IDLE) c.prepare();
      c.play();
      call.resolve();
    }});
  }

  @PluginMethod
  public void pause(final PluginCall call) {
    withController(call, new Op() { @Override public void run(MediaController c) { c.pause(); call.resolve(); }});
  }

  @PluginMethod
  public void seekTo(final PluginCall call) {
    final int index = call.getInt("index", -1);
    final long ms = Math.max(0L, Math.round(call.getDouble("pos", 0.0) * 1000.0));
    withController(call, new Op() { @Override public void run(MediaController c) {
      if (index >= 0 && index < c.getMediaItemCount() && index != c.getCurrentMediaItemIndex()) c.seekTo(index, ms);
      else c.seekTo(ms);
      call.resolve();
    }});
  }

  @PluginMethod
  public void setSpeed(final PluginCall call) {
    final float speed = Math.max(0.5f, Math.min(3f, call.getFloat("speed", 1f)));
    withController(call, new Op() { @Override public void run(MediaController c) { c.setPlaybackSpeed(speed); call.resolve(); }});
  }

  /** eq[] dB (one per band), gain dB (preset trim), volume 0..1 — applied inside the native audio pipeline */
  @PluginMethod
  public void setFx(PluginCall call) {
    JSArray a = call.getArray("eq");
    float[] eq = new float[AudioFx.BANDS.length];
    if (a != null) for (int i = 0; i < eq.length && i < a.length(); i++) eq[i] = (float) a.optDouble(i, 0);
    AudioFx.shared.set(eq, call.getFloat("gain", 0f), call.getFloat("volume", 1f));
    JSObject r = new JSObject();
    r.put("peakBoostDb", AudioFx.shared.peakBoostDb(48000));
    call.resolve(r);
  }

  @PluginMethod
  public void setSkipSilence(PluginCall call) {
    PlayerService.setSkipSilence(call.getBoolean("on", false));
    call.resolve();
  }

  @PluginMethod
  public void setSleepTimer(PluginCall call) {
    PlayerService.setSleep(call.getInt("minutes", 0));
    call.resolve();
  }

  /** "book" = gapless, "album" = fade out at the end of each track + a short pause (remembered per book by JS) */
  @PluginMethod
  public void setAlbumMode(PluginCall call) {
    PlayerService.setAlbumMode(call.getBoolean("on", false));
    call.resolve();
  }

  @PluginMethod
  public void setVisualizer(PluginCall call) {
    final boolean on = call.getBoolean("on", false);
    AudioFx.shared.setSpectrum(on);
    main.post(new Runnable() { @Override public void run() {
      main.removeCallbacks(vizTick);
      vizOn = on;
      if (on) main.post(vizTick);
    }});
    call.resolve();
  }

  @PluginMethod
  public void getState(final PluginCall call) {
    final JSObject r = new JSObject();
    r.put("saved", saved());
    if (PlayerService.live == null) {            // don't start the service just to ask
      r.put("loaded", false);
      call.resolve(r);
      return;
    }
    withController(call, new Op() { @Override public void run(MediaController c) {
      fill(r, c);
      r.put("loaded", c.getMediaItemCount() > 0);
      call.resolve(r);
    }});
  }

  @PluginMethod
  public void stop(final PluginCall call) {
    main.post(new Runnable() { @Override public void run() {
      main.removeCallbacks(tick);
      if (controller != null) {
        controller.pause();
        controller.clearMediaItems();
        controller.release();
        controller = null;
      }
      call.resolve();
    }});
  }

  /** Opens the system "battery optimization" list so the user can set the app to "Unrestricted". */
  @PluginMethod
  public void openBatterySettings(PluginCall call) {
    try {
      Intent i = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      getContext().startActivity(i);
      call.resolve();
    } catch (Exception e) { call.reject("Не удалось открыть настройки", e); }
  }

  // ------------------------------------------------------------------ cover → file (artworkUri keeps IPC small)
  private Uri saveCover(String data) {
    if (data == null || data.length() <= 10) return null;
    try {
      int comma = data.indexOf(',');
      byte[] bytes = Base64.decode(comma >= 0 ? data.substring(comma + 1) : data, Base64.DEFAULT);
      File dir = getContext().getCacheDir();
      File f = new File(dir, "cover_" + Integer.toHexString(data.hashCode()) + ".img");
      if (!f.exists()) {
        File[] old = dir.listFiles();
        if (old != null) for (File o : old) if (o.getName().startsWith("cover_")) o.delete();
        try (FileOutputStream out = new FileOutputStream(f)) { out.write(bytes); }
      }
      return Uri.fromFile(f);
    } catch (Exception e) { return null; }
  }
}
