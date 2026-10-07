package com.shelf.player;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** The native DSP chain: peaking EQ + automatic headroom + peak limiter (pure Java, no Android needed). */
public class AudioFxTest {
  private static final int RATE = 48000;

  private static float[] sine(double hz, double amp, int frames) {
    float[] x = new float[2 * frames];
    for (int i = 0; i < frames; i++) x[2 * i] = x[2 * i + 1] = (float) (amp * Math.sin(2 * Math.PI * hz * i / RATE));
    return x;
  }

  private static float peak(float[] x) {
    float m = 0;
    for (float v : x) m = Math.max(m, Math.abs(v));
    return m;
  }

  @Test public void flatSettingsAreABitPerfectBypass() {
    AudioFx fx = AudioFx.shared;
    fx.set(new float[DspConfig.BANDS.length], 0f, 1f);
    fx.configure(RATE, 2);
    float[] in = sine(440, 0.5, 4800);
    float[] out = in.clone();
    fx.process(out, 4800);
    assertArrayEquals(in, out, 0f);
  }

  @Test public void boostedEqNeverExceedsTheCeiling() {
    AudioFx fx = AudioFx.shared;
    float[] eq = {12, 12, 12, 8, 0, 0, 0, 0, 0, 0};
    fx.set(eq, 0f, 1f);
    fx.configure(RATE, 2);
    float[] x = sine(100, 0.95, 24000);
    fx.process(x, 24000);
    assertTrue("limiter keeps the peak below the ceiling, got " + peak(x), peak(x) <= (float) DspConfig.CEILING + 1e-3f);
    fx.set(new float[DspConfig.BANDS.length], 0f, 1f);     // leave the shared instance flat for other tests
    fx.configure(RATE, 2);
  }

  @Test public void reportsThePeakBoostOfTheCurve() {
    AudioFx fx = AudioFx.shared;
    fx.set(new float[]{6, 0, 0, 0, 0, 0, 0, 0, 0, 0}, 0f, 1f);
    double boost = fx.peakBoostDb(RATE);
    assertTrue("a +6 dB band boosts the curve by roughly that much: " + boost, boost > 4.0 && boost < 7.0);
    fx.set(new float[DspConfig.BANDS.length], 0f, 1f);
    assertEquals(0.0, fx.peakBoostDb(RATE), 1e-6);
  }

  @Test public void generatedConfigMatchesTheSharedFile() {
    assertEquals(10, DspConfig.BANDS.length);
    assertTrue(AudioFormats.ALTERNATION.contains("mp3") && AudioFormats.ALTERNATION.contains("m4b"));
  }
}
