package com.shelf.player;

import androidx.media3.common.C;
import androidx.media3.common.audio.AudioProcessor;
import androidx.media3.common.audio.BaseAudioProcessor;
import androidx.media3.common.util.UnstableApi;
import java.nio.ByteBuffer;

/**
 * Media3 audio processor that runs {@link AudioFx} (EQ + auto headroom + limiter) inside the
 * ExoPlayer pipeline, i.e. in the native playback thread: independent of the WebView and the screen state.
 * Sits BEFORE Sonic (speed) in the chain, so EQ frequencies stay correct at any playback speed.
 */
@UnstableApi
public final class FxAudioProcessor extends BaseAudioProcessor {
  private static final int CHUNK_FRAMES = 2048;
  private final AudioFx fx = AudioFx.shared;
  private float[] scratch = new float[0];

  @Override
  protected AudioProcessor.AudioFormat onConfigure(AudioProcessor.AudioFormat in)
      throws UnhandledAudioFormatException {
    boolean supported = (in.encoding == C.ENCODING_PCM_16BIT || in.encoding == C.ENCODING_PCM_FLOAT)
        && in.channelCount >= 1 && in.channelCount <= 8;
    // NOT_SET = processor stays inactive (pass-through) instead of failing playback
    return supported ? in : AudioProcessor.AudioFormat.NOT_SET;
  }

  @Override
  protected void onFlush() {
    fx.configure(inputAudioFormat.sampleRate, inputAudioFormat.channelCount);
    int need = CHUNK_FRAMES * inputAudioFormat.channelCount;
    if (scratch.length < need) scratch = new float[need];
  }

  @Override
  protected void onReset() {
    scratch = new float[0];
  }

  @Override
  public void queueInput(ByteBuffer in) {
    int size = in.remaining();
    if (size == 0) return;
    ByteBuffer out = replaceOutputBuffer(size);
    final int ch = inputAudioFormat.channelCount;
    final boolean pcm16 = inputAudioFormat.encoding == C.ENCODING_PCM_16BIT;
    final int frameBytes = (pcm16 ? 2 : 4) * ch;
    if (scratch.length < CHUNK_FRAMES * ch) scratch = new float[CHUNK_FRAMES * ch];

    while (in.remaining() >= frameBytes) {
      int frames = Math.min(CHUNK_FRAMES, in.remaining() / frameBytes);
      int n = frames * ch;
      if (pcm16) {
        for (int i = 0; i < n; i++) scratch[i] = in.getShort() * (1f / 32768f);
      } else {
        for (int i = 0; i < n; i++) scratch[i] = in.getFloat();
      }
      fx.process(scratch, frames);
      if (pcm16) {
        for (int i = 0; i < n; i++) {
          int v = Math.round(scratch[i] * 32768f);
          out.putShort((short) (v > 32767 ? 32767 : (v < -32768 ? -32768 : v)));
        }
      } else {
        for (int i = 0; i < n; i++) out.putFloat(scratch[i]);
      }
    }
    while (in.hasRemaining()) out.put(in.get());   // incomplete trailing frame: pass through unchanged
    out.flip();
  }
}
