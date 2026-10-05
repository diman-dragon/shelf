package com.shelf.player;

/**
 * Pure-Java DSP chain (no Android dependencies, unit-testable):
 *   low shelf + high shelf + 10 peaking bands  ->  auto pre-gain  ->  peak limiter.
 *
 * Why it exists: the old Web Audio graph boosted bands without any headroom and without a limiter,
 * so presets like "Bass"/"Voice" clipped (the "хрип"). Here the pre-gain is derived from the REAL
 * combined frequency response of the cascade, and the limiter guarantees the output never exceeds
 * the ceiling, whatever the user drags.
 */
public final class AudioFx {
  public static final int[] BANDS = {60, 120, 250, 500, 1000, 2000, 4000, 8000, 12000, 16000};
  private static final double Q_PEAK = 1.4;
  private static final double Q_SHELF = 0.7071;
  private static final double BASS_HZ = 180, TREBLE_HZ = 4200;
  private static final int NB = BANDS.length + 2;          // 0 = bass shelf, 1 = treble shelf, 2.. = peaking
  private static final float CEILING = 0.97f;               // about -0.26 dBFS
  private static final double HEADROOM_FACTOR = 0.85;       // compensate 85% of the peak boost, limiter handles the rest
  private static final int FFT_N = 256;

  private static final class Params {
    final float[] gains = new float[NB];                     // dB per filter
    final float gainDb;
    final float volume;
    Params(float[] eq, float bass, float treble, float gainDb, float volume) {
      gains[0] = clamp(bass, -15, 15);
      gains[1] = clamp(treble, -15, 15);
      for (int i = 0; i < BANDS.length; i++) gains[2 + i] = i < eq.length ? clamp(eq[i], -15, 15) : 0;
      this.gainDb = clamp(gainDb, -24, 12);
      this.volume = clamp(volume, 0, 1);
    }
  }

  private volatile Params params = new Params(new float[BANDS.length], 0, 0, 0, 1);

  // ---- per-stream state (audio thread only) ----
  private int sampleRate = 44100, channels = 2;
  private Params applied;
  private int appliedRate;
  private final double[] b0 = new double[NB], b1 = new double[NB], b2 = new double[NB], a1 = new double[NB], a2 = new double[NB];
  private final boolean[] on = new boolean[NB];
  private double[][] z1 = new double[8][NB], z2 = new double[8][NB];
  private float preCur = 1f, preTarget = 1f, preCoef = 0.999f;
  private float limGain = 1f, relCoef = 0.9999f;

  // ---- spectrum tap ----
  private volatile boolean spectrumOn;
  private final float[] ring = new float[FFT_N];
  private volatile int ringPos;
  private final float[] smooth = new float[FFT_N / 2];
  private final double[] re = new double[FFT_N], im = new double[FFT_N], win = new double[FFT_N];

  private AudioFx() {
    for (int i = 0; i < FFT_N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (FFT_N - 1));
  }

  // ======================= public API =======================

  /** Called from any thread. eq = 10 values in dB, bass/treble shelves in dB, gainDb = user pre-gain, volume 0..1 */
  public void set(float[] eq, float bass, float treble, float gainDb, float volume) {
    params = new Params(eq == null ? new float[BANDS.length] : eq, bass, treble, gainDb, volume);
  }

  public void setSpectrum(boolean enabled) { spectrumOn = enabled; }

  /** Called when the audio pipeline is (re)configured or flushed. */
  public void configure(int sampleRate, int channels) {
    this.sampleRate = Math.max(8000, sampleRate);
    this.channels = Math.max(1, Math.min(8, channels));
    applied = null;                                          // force coefficient rebuild
    for (double[] z : z1) java.util.Arrays.fill(z, 0);
    for (double[] z : z2) java.util.Arrays.fill(z, 0);
    limGain = 1f;
    preCoef = (float) Math.exp(-1.0 / (0.02 * this.sampleRate));
    relCoef = (float) Math.exp(-1.0 / (0.25 * this.sampleRate));
    update();
    preCur = preTarget;                                      // no ramp at start
  }

  /** In-place processing of interleaved float samples in [-1, 1]. */
  public void process(float[] x, int frames) {
    if (params != applied || appliedRate != sampleRate) update();
    final int ch = channels;
    final float ceil = CEILING;
    final boolean tap = spectrumOn;
    int idx = 0;
    for (int f = 0; f < frames; f++) {
      preCur = preTarget + (preCur - preTarget) * preCoef;
      double peak = 0;
      for (int c = 0; c < ch; c++) {
        double s = x[idx + c];
        final double[] zc1 = z1[c], zc2 = z2[c];
        for (int k = 0; k < NB; k++) {
          if (!on[k]) continue;
          // transposed direct form II
          double y = b0[k] * s + zc1[k];
          zc1[k] = b1[k] * s - a1[k] * y + zc2[k];
          zc2[k] = b2[k] * s - a2[k] * y;
          s = y;
        }
        s *= preCur;
        x[idx + c] = (float) s;
        double a = Math.abs(s);
        if (a > peak) peak = a;
      }
      // peak limiter: instant attack, 250 ms release
      float need = peak > ceil ? (float) (ceil / peak) : 1f;
      if (need < limGain) limGain = need;
      else limGain = 1f - (1f - limGain) * relCoef;
      if (limGain < 0.9999f || peak > ceil) {
        float g = Math.min(limGain, need);
        for (int c = 0; c < ch; c++) {
          float v = x[idx + c] * g;
          x[idx + c] = v > ceil ? ceil : (v < -ceil ? -ceil : v);
        }
      }
      if (tap) {
        float m = 0;
        for (int c = 0; c < ch; c++) m += x[idx + c];
        int p = ringPos;
        ring[p] = m / ch;
        ringPos = (p + 1) % FFT_N;
      }
      idx += ch;
    }
  }

  /** Fills 128 magnitude bytes (0..255), same scale/smoothing as Web Audio AnalyserNode(fftSize=256). */
  public synchronized void spectrum(byte[] out) {
    int p = ringPos;
    for (int i = 0; i < FFT_N; i++) {
      re[i] = ring[(p + i) % FFT_N] * win[i];
      im[i] = 0;
    }
    fft(re, im);
    int n = Math.min(out.length, FFT_N / 2);
    for (int k = 0; k < n; k++) {
      double mag = Math.hypot(re[k], im[k]) / FFT_N;
      smooth[k] = (float) (0.82 * smooth[k] + 0.18 * mag);
      double db = 20 * Math.log10(Math.max(smooth[k], 1e-9));
      int v = (int) Math.round((db + 100.0) / 70.0 * 255.0);
      out[k] = (byte) (v < 0 ? 0 : Math.min(v, 255));
    }
  }

  /** Worst-case boost (dB) of the filter cascade for the given params. Exposed for tests/diagnostics. */
  public double peakBoostDb(int rate) {
    Params p = params;
    return peakBoost(p, rate);
  }

  // ======================= internals =======================

  private void update() {
    Params p = params;
    final int rate = sampleRate;
    for (int k = 0; k < NB; k++) {
      boolean active = Math.abs(p.gains[k]) >= 0.05f;
      double hz = k == 0 ? BASS_HZ : (k == 1 ? TREBLE_HZ : BANDS[k - 2]);
      if (hz >= rate * 0.45) active = false;
      if (active && !on[k]) for (int c = 0; c < 8; c++) { z1[c][k] = 0; z2[c][k] = 0; }
      on[k] = active;
      if (active) design(k, hz, p.gains[k], rate);
    }
    double peak = peakBoost(p, rate);
    double preDb = -HEADROOM_FACTOR * Math.max(0, peak) + p.gainDb;
    preTarget = (float) (Math.pow(10, preDb / 20) * p.volume);
    applied = p;
    appliedRate = rate;
  }

  private void design(int k, double f0, double dB, int rate) {
    double A = Math.pow(10, dB / 40), w0 = 2 * Math.PI * f0 / rate, cs = Math.cos(w0), sn = Math.sin(w0);
    double B0, B1, B2, A0, A1, A2;
    if (k >= 2) {                                            // peaking
      double al = sn / (2 * Q_PEAK);
      B0 = 1 + al * A; B1 = -2 * cs; B2 = 1 - al * A;
      A0 = 1 + al / A; A1 = -2 * cs; A2 = 1 - al / A;
    } else {
      double al = sn / (2 * Q_SHELF), sa = 2 * Math.sqrt(A) * al;
      if (k == 0) {                                          // low shelf
        B0 = A * ((A + 1) - (A - 1) * cs + sa);
        B1 = 2 * A * ((A - 1) - (A + 1) * cs);
        B2 = A * ((A + 1) - (A - 1) * cs - sa);
        A0 = (A + 1) + (A - 1) * cs + sa;
        A1 = -2 * ((A - 1) + (A + 1) * cs);
        A2 = (A + 1) + (A - 1) * cs - sa;
      } else {                                               // high shelf
        B0 = A * ((A + 1) + (A - 1) * cs + sa);
        B1 = -2 * A * ((A - 1) + (A + 1) * cs);
        B2 = A * ((A + 1) + (A - 1) * cs - sa);
        A0 = (A + 1) - (A - 1) * cs + sa;
        A1 = 2 * ((A - 1) - (A + 1) * cs);
        A2 = (A + 1) - (A - 1) * cs - sa;
      }
    }
    b0[k] = B0 / A0; b1[k] = B1 / A0; b2[k] = B2 / A0; a1[k] = A1 / A0; a2[k] = A2 / A0;
  }

  private double peakBoost(Params p, int rate) {
    // evaluate with a private coefficient set so this is safe to call from any thread
    double[] c = new double[5 * NB];
    boolean[] act = new boolean[NB];
    for (int k = 0; k < NB; k++) {
      double hz = k == 0 ? BASS_HZ : (k == 1 ? TREBLE_HZ : BANDS[k - 2]);
      act[k] = Math.abs(p.gains[k]) >= 0.05f && hz < rate * 0.45;
      if (!act[k]) continue;
      AudioFx t = TMP.get();
      t.design(k, hz, p.gains[k], rate);
      c[5 * k] = t.b0[k]; c[5 * k + 1] = t.b1[k]; c[5 * k + 2] = t.b2[k]; c[5 * k + 3] = t.a1[k]; c[5 * k + 4] = t.a2[k];
    }
    double best = 0;
    final int pts = 160;
    for (int i = 0; i < pts; i++) {
      double fr = 25 * Math.pow(18000.0 / 25.0, i / (double) (pts - 1));
      if (fr > rate * 0.45) break;
      double w = 2 * Math.PI * fr / rate, cr = Math.cos(w), ci = -Math.sin(w), c2r = Math.cos(2 * w), c2i = -Math.sin(2 * w);
      double db = 0;
      for (int k = 0; k < NB; k++) {
        if (!act[k]) continue;
        double nr = c[5 * k] + c[5 * k + 1] * cr + c[5 * k + 2] * c2r, ni = c[5 * k + 1] * ci + c[5 * k + 2] * c2i;
        double dr = 1 + c[5 * k + 3] * cr + c[5 * k + 4] * c2r, di = c[5 * k + 3] * ci + c[5 * k + 4] * c2i;
        db += 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
      }
      if (db > best) best = db;
    }
    return best;
  }

  /** scratch instance for coefficient design from peakBoost (avoids touching the live filter state) */
  private static final ThreadLocal<AudioFx> TMP = new ThreadLocal<AudioFx>() {
    @Override protected AudioFx initialValue() { return new AudioFx(); }
  };

  /** One instance shared by the plugin (writes params) and the audio processor (reads them). Declared last: static init order. */
  public static final AudioFx shared = new AudioFx();

  private static void fft(double[] re, double[] im) {
    int n = re.length;
    for (int i = 1, j = 0; i < n; i++) {
      int bit = n >> 1;
      for (; (j & bit) != 0; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { double t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (int len = 2; len <= n; len <<= 1) {
      double ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (int i = 0; i < n; i += len) {
        double cr = 1, ci = 0;
        for (int k = 0; k < len / 2; k++) {
          int u = i + k, v = i + k + len / 2;
          double xr = re[v] * cr - im[v] * ci, xi = re[v] * ci + im[v] * cr;
          re[v] = re[u] - xr; im[v] = im[u] - xi;
          re[u] += xr; im[u] += xi;
          double t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
  }

  private static float clamp(float v, float lo, float hi) { return v < lo ? lo : (v > hi ? hi : v); }
}
