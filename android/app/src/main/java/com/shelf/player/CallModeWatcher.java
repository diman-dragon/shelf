package com.shelf.player;

import android.content.Context;
import android.media.AudioManager;
import androidx.annotation.RequiresApi;
import androidx.core.content.ContextCompat;

/**
 * Tells the moment the phone goes into a call: the ringtone starts, a call is answered, a messenger call rings or is
 * accepted. The system switches AudioManager's mode for that, which needs NO permission, and it happens even when the
 * caller app never asks for audio focus (many messengers do not) — so playback can stop at once.
 * Android 12+ only; older versions rely on the audio-focus path in PlayerService.
 */
@RequiresApi(31)
final class CallModeWatcher implements AudioManager.OnModeChangedListener {
  interface Callback { void onCallMode(boolean inCall); }

  private final Context ctx;
  private final AudioManager am;
  private final Callback cb;

  CallModeWatcher(Context ctx, Callback cb) {
    this.ctx = ctx.getApplicationContext();
    this.am = (AudioManager) this.ctx.getSystemService(Context.AUDIO_SERVICE);
    this.cb = cb;
  }

  void start() {
    if (am != null) am.addOnModeChangedListener(ContextCompat.getMainExecutor(ctx), this);
  }

  void stop() {
    if (am != null) am.removeOnModeChangedListener(this);
  }

  @Override public void onModeChanged(int mode) {
    cb.onCallMode(mode == AudioManager.MODE_RINGTONE
        || mode == AudioManager.MODE_IN_CALL
        || mode == AudioManager.MODE_IN_COMMUNICATION);
  }
}
