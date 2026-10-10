package com.shelf.player;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** The loudness estimate behind "Выравнивание громкости" (pure Java). */
public class LoudnessTest {
  private static final int RATE = 44100;

  /** A sine of the given RMS level (dBFS) for the given seconds. */
  private static Loudness feed(double rmsDb, double seconds, double silenceSeconds) {
    Loudness m = new Loudness(RATE);
    double amp = Math.pow(10, rmsDb / 20) * Math.sqrt(2);
    for (int i = 0; i < (int) (seconds * RATE); i++) m.add((float) (amp * Math.sin(2 * Math.PI * 220 * i / RATE)));
    for (int i = 0; i < (int) (silenceSeconds * RATE); i++) m.add(0f);
    return m;
  }

  @Test public void measuresTheAverageLevel() {
    assertEquals(-24.0, feed(-24, 6, 0).rmsDb(), 0.2);
  }

  @Test public void quietFileIsBoostedLoudFileIsCut() {
    assertEquals(6.0f, feed(-24, 6, 0).gainDb(), 0.15f);
    assertEquals(-6.0f, feed(-12, 6, 0).gainDb(), 0.15f);
  }

  @Test public void silenceDoesNotMakeAFileLookQuiet() {
    assertEquals(feed(-18, 6, 0).rmsDb(), feed(-18, 6, 8).rmsDb(), 0.2);
  }

  @Test public void correctionIsLimited() {
    assertEquals(Loudness.MAX_BOOST_DB, feed(-45, 6, 0).gainDb(), 0.01f);
    assertEquals(-Loudness.MAX_CUT_DB, feed(-3, 6, 0).gainDb(), 0.2f);
  }

  @Test public void closeToTargetIsLeftAlone() {
    assertEquals(0f, feed(-18.3, 6, 0).gainDb(), 0f);
  }

  @Test public void tooLittleSoundGivesNoCorrection() {
    assertEquals(0f, feed(-30, 1, 0).gainDb(), 0f);
    assertEquals(0f, new Loudness(RATE).gainDb(), 0f);
  }

  @Test public void aBoostNeverPushesTheLoudestSamplePastTheCeiling() {
    // quiet on average but with one near-full-scale click: boosting by 8 dB would be 8 dB over, so the boost is cut back
    Loudness m = feed(-26, 6, 0);
    m.add(0.95f);
    float g = m.gainDb();
    assertTrue("gain " + g, m.peakDb() + g <= Loudness.PEAK_CEIL_DB + 0.11);
  }
}
