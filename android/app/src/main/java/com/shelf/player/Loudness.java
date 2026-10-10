package com.shelf.player;

/**
 * Pure-Java loudness estimate (no Android dependencies, unit-testable).
 * Feed it mono samples in [-1, 1]; it keeps the average power of every 100 ms block that is not silence
 * (blocks under GATE_DB are the pauses between words or tracks: they must not make a book look quiet).
 * gainDb() turns the result into the correction that brings the file to TARGET_DB.
 */
public final class Loudness {
  /** Where every file is brought to: average level of the non-silent parts, dBFS. Speech sits near -20, loud music near -12. */
  public static final double TARGET_DB = -18;
  static final double GATE_DB = -55;
  static final float MAX_BOOST_DB = 8f;
  static final float MAX_CUT_DB = 12f;
  /** After a boost the loudest sample may reach this level; the limiter in AudioFx takes what is above 0 dBFS. */
  static final double PEAK_CEIL_DB = 1.5;
  /** Below this the correction is not worth switching the DSP chain on. */
  static final float DEAD_ZONE_DB = 0.5f;

  private final int blockLen;
  private final double gatePower = Math.pow(10, GATE_DB / 10);
  private double blockSum, powerSum, peak;
  private int blockN;
  private long blocks, samples;
  private final int rate;

  public Loudness(int sampleRate) {
    rate = Math.max(8000, sampleRate);
    blockLen = rate / 10;
  }

  /** One mono sample. */
  public void add(float s) {
    double a = Math.abs(s);
    if (a > peak) peak = a;
    blockSum += (double) s * s;
    samples++;
    if (++blockN >= blockLen) {
      double p = blockSum / blockN;
      if (p > gatePower) { powerSum += p; blocks++; }
      blockSum = 0;
      blockN = 0;
    }
  }

  /** Seconds of audio seen so far. */
  public double seconds() { return samples / (double) rate; }

  /** Number of non-silent blocks (0.1 s each). */
  public long loudBlocks() { return blocks; }

  /** Average level of the non-silent blocks, dBFS; NaN when there was nothing to measure. */
  public double rmsDb() { return blocks == 0 ? Double.NaN : 10 * Math.log10(powerSum / blocks); }

  public double peakDb() { return peak <= 0 ? Double.NEGATIVE_INFINITY : 20 * Math.log10(peak); }

  /** Correction in dB for this measurement; 0 when it is unreliable (under 3 s of sound) or already close to the target. */
  public float gainDb() {
    if (blocks < 30) return 0f;
    return gainFor(rmsDb(), peakDb());
  }

  static float gainFor(double rmsDb, double peakDb) {
    if (Double.isNaN(rmsDb)) return 0f;
    double g = TARGET_DB - rmsDb;
    if (g > MAX_BOOST_DB) g = MAX_BOOST_DB;
    if (g < -MAX_CUT_DB) g = -MAX_CUT_DB;
    if (g > 0 && peakDb + g > PEAK_CEIL_DB) g = Math.max(0, PEAK_CEIL_DB - peakDb);
    if (Math.abs(g) < DEAD_ZONE_DB) return 0f;
    return Math.round(g * 10) / 10f;
  }
}
