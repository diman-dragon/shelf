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

  @Test public void volumeAboveOneIsARealBoostButNeverOverflows() {
    AudioFx fx = AudioFx.shared;
    // quiet material: 300 % really is louder (about x3)
    fx.set(new float[DspConfig.BANDS.length], 0f, 3f);
    fx.configure(RATE, 2);
    float[] quiet = sine(440, 0.1, 9600);
    fx.process(quiet, 9600);
    assertTrue("quiet signal is boosted ~x3: " + peak(quiet), peak(quiet) > 0.27f && peak(quiet) < 0.33f);
    // loud material: whatever the boost, the output stays under the ceiling
    fx.configure(RATE, 2);
    float[] loud = sine(220, 0.95, 48000);
    fx.process(loud, 48000);
    assertTrue("limited: " + peak(loud), peak(loud) <= (float) DspConfig.CEILING + 1e-6f);
    // the request is clamped at 300 %
    fx.set(new float[DspConfig.BANDS.length], 0f, 50f);
    fx.configure(RATE, 2);
    float[] q2 = sine(440, 0.1, 9600);
    fx.process(q2, 9600);
    assertTrue("clamped at x3: " + peak(q2), peak(q2) < 0.33f);
    fx.set(new float[DspConfig.BANDS.length], 0f, 1f);     // leave the shared instance neutral for the other tests
  }

  @Test public void reportsThePeakBoostOfTheCurve() {
    AudioFx fx = AudioFx.shared;
    fx.set(new float[]{6, 0, 0, 0, 0, 0, 0, 0, 0, 0}, 0f, 1f);
    double boost = fx.peakBoostDb(RATE);
    assertTrue("a +6 dB band boosts the curve by roughly that much: " + boost, boost > 4.0 && boost < 7.0);
    fx.set(new float[DspConfig.BANDS.length], 0f, 1f);
    assertEquals(0.0, fx.peakBoostDb(RATE), 1e-6);
  }

  @Test public void identicalSettingsAreNotRecomputed() {
    AudioFx fx = AudioFx.shared;
    float[] eq = {3, 2, 1, 0, 0, 0, 0, 0, 1, 2};
    fx.set(eq, 0f, 1f);
    fx.configure(RATE, 2);
    int before = AudioFx.builds;
    for (int i = 0; i < 20; i++) fx.set(eq.clone(), 0f, 1f);   // the UI re-sends the same settings on every "play"
    fx.configure(RATE, 2);                                       // a seek / chapter change flushes the pipeline
    fx.configure(RATE, 2);
    float[] x = sine(220, 0.3, 4800);
    fx.process(x, 4800);
    assertEquals("no new design for unchanged settings", before, AudioFx.builds);
    fx.set(new float[]{3, 2, 1, 0, 0, 0, 0, 0, 1, 3}, 0f, 1f);  // a real change does rebuild, once
    assertEquals(before + 1, AudioFx.builds);
    fx.set(new float[DspConfig.BANDS.length], 0f, 1f);
    fx.configure(RATE, 2);
  }

  @Test public void generatedConfigMatchesTheSharedFile() {
    assertEquals(10, DspConfig.BANDS.length);
    assertTrue(AudioFormats.ALTERNATION.contains("mp3") && AudioFormats.ALTERNATION.contains("m4b"));
  }

  @Test public void fileNormalisationScalesTheSignalAndKeepsTheUsersSettings() {
    AudioFx fx = AudioFx.shared;
    fx.set(new float[DspConfig.BANDS.length], 0f, 1f);
    fx.setNorm(0f);
    fx.configure(RATE, 2);
    float[] a = sine(440, 0.1, 9600);
    fx.process(a, 9600);
    float base = peak(a);
    fx.setNorm(6f);                                          // +6 dB: about twice the amplitude
    fx.configure(RATE, 2);
    float[] b = sine(440, 0.1, 9600);
    fx.process(b, 9600);
    assertEquals(2.0, peak(b) / base, 0.05);
    fx.set(new float[DspConfig.BANDS.length], 0f, 1f);       // the UI re-sends its settings: the correction stays
    fx.configure(RATE, 2);
    float[] c = sine(440, 0.1, 9600);
    fx.process(c, 9600);
    assertEquals(2.0, peak(c) / base, 0.05);
    fx.setNorm(0f);
    fx.configure(RATE, 2);
  }
}
