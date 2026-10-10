package com.shelf.player;

/**
 * Pure-Java DSP chain (no Android dependencies, unit-testable):
 *   10 peaking bands  ->  auto pre-gain  ->  peak limiter.
 * Constants (bands, Q, headroom, ceiling) come from DspConfig, which Gradle generates from www/config.js —
 * the web player (sound.js) reads the very same file, so there is a single place to change them.
 *
 * Why it exists: the old Web Audio graph boosted bands without any headroom and without a limiter,
 * so presets like "Bass"/"Voice" clipped (the "хрип"). Here the pre-gain is derived from the REAL
 * combined frequency response of the cascade, and the limiter guarantees the output never exceeds
 * the ceiling, whatever the user drags.
 */
public final class AudioFx {
  public static final int[] BANDS = DspConfig.BANDS;
  private static final double Q_PEAK = DspConfig.Q_PEAK;
  private static final int NB = BANDS.length;               // one peaking filter per band
  private static final float CEILING = (float) DspConfig.CEILING;   // about -0.26 dBFS
  private static final double HEADROOM_FACTOR = DspConfig.HEADROOM;  // compensate this share of the peak boost, limiter handles the rest
  private static final int FFT_N = 256;
  /** Book volume limit: 300 %. Everything above 100 % is made safe by the limiter below. */
  public static final float MAX_VOLUME = 3f;

  private static final class Params {
    final float[] gains = new float[NB];                     // dB per filter
    final float gainDb;
    final float volume;                                      // 0..3: above 1 it is a real boost, the limiter keeps the output under the ceiling
    Params(float[] eq, float gainDb, float volume) {
      for (int i = 0; i < BANDS.length; i++) gains[i] = i < eq.length ? clamp(eq[i], -15, 15) : 0;
      this.gainDb = clamp(gainDb, -24, 12);
      this.volume = clamp(volume, 0, MAX_VOLUME);
    }
    boolean sameAs(Params o) {
      return o != null && gainDb == o.gainDb && volume == o.volume && java.util.Arrays.equals(gains, o.gains);
    }
  }

  /**
   * Everything derived from (settings, sample rate): filter coefficients, which bands are active, the automatic
   * headroom and the bypass flag. It is computed ONCE, on the thread that changes the settings (never on the audio
   * thread) and cached. The audio thread only copies a few numbers when the design changes.
   */
  private static final class Design {
    final Params p;
    final int rate;
    final double[] b0 = new double[NB], b1 = new double[NB], b2 = new double[NB], a1 = new double[NB], a2 = new double[NB];
    final boolean[] on = new boolean[NB];
    final float preTarget;
    final boolean flat;
    final double boostDb;

    Design(Params p, int rate) {
      this.p = p;
      this.rate = rate;
      boolean anyOn = false;
      for (int k = 0; k < NB; k++) {
        double hz = BANDS[k];
        on[k] = Math.abs(p.gains[k]) >= 0.05f && hz < rate * 0.45;
        if (!on[k]) continue;
        anyOn = true;
        double A = Math.pow(10, p.gains[k] / 40), w0 = 2 * Math.PI * hz / rate, cs = Math.cos(w0), sn = Math.sin(w0);
        // peaking EQ (RBJ cookbook) — same maths as the browser's BiquadFilterNode type "peaking"
        double al = sn / (2 * Q_PEAK);
        double B0 = 1 + al * A, B1 = -2 * cs, B2 = 1 - al * A;
        double A0 = 1 + al / A, A1 = -2 * cs, A2 = 1 - al / A;
        b0[k] = B0 / A0; b1[k] = B1 / A0; b2[k] = B2 / A0; a1[k] = A1 / A0; a2[k] = A2 / A0;
      }
      // worst-case boost of the cascade (dB) on a log frequency grid
      double best = 0;
      if (anyOn) {
        final int pts = 160;
        for (int i = 0; i < pts; i++) {
          double fr = 25 * Math.pow(18000.0 / 25.0, i / (double) (pts - 1));
          if (fr > rate * 0.45) break;
          double w = 2 * Math.PI * fr / rate, cr = Math.cos(w), ci = -Math.sin(w), c2r = Math.cos(2 * w), c2i = -Math.sin(2 * w);
          double db = 0;
          for (int k = 0; k < NB; k++) {
            if (!on[k]) continue;
            double nr = b0[k] + b1[k] * cr + b2[k] * c2r, ni = b1[k] * ci + b2[k] * c2i;
            double dr = 1 + a1[k] * cr + a2[k] * c2r, di = a1[k] * ci + a2[k] * c2i;
            db += 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
          }
          if (db > best) best = db;
        }
      }
      boostDb = best;
      double preDb = -HEADROOM_FACTOR * Math.max(0, best) + p.gainDb;
      preTarget = (float) (Math.pow(10, preDb / 20) * p.volume);
      flat = !anyOn && Math.abs(preTarget - 1f) < 1e-6f;
      builds++;
    }
  }

  /** counts real design computations (unit tests check that identical settings do not trigger new ones) */
  static volatile int builds;

  // small cache: the stream rate and the rate asked for by the plugin may differ, both must stay cached
  private final Design[] cache = new Design[3];
  private int cacheNext;

  private Design designFor(Params p, int rate) {
    synchronized (cache) {
      for (Design d : cache) if (d != null && d.p == p && d.rate == rate) return d;
    }
    Design d = new Design(p, rate);                          // the heavy part runs outside the lock
    synchronized (cache) {
      cache[cacheNext] = d;
      cacheNext = (cacheNext + 1) % cache.length;
    }
    return d;
  }

  private volatile Params params = new Params(new float[BANDS.length], 0, 1);

  // ---- per-stream state (audio thread only) ----
  private volatile int sampleRate = 44100;
  private int channels = 2;
  private Params applied;
  private int appliedRate;
  private final double[] b0 = new double[NB], b1 = new double[NB], b2 = new double[NB], a1 = new double[NB], a2 = new double[NB];
  private final boolean[] on = new boolean[NB];
  private double[][] z1 = new double[8][NB], z2 = new double[8][NB];
  private float preCur = 1f, preTarget = 1f, preCoef = 0.999f;
  private float limGain = 1f, relCoef = 0.9999f;
  private boolean flat = true;                                  // no active filter, unity gain -> bit-perfect bypass

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

  /** Called from any thread. eq = one value in dB per band, gainDb = user pre-gain, volume 0..3 (1 = unchanged, above 1 = boost) */
  public void set(float[] eq, float gainDb, float volume) {
    Params np = new Params(eq == null ? new float[BANDS.length] : eq, gainDb, volume);
    if (np.sameAs(params)) return;           // identical settings (the UI re-sends them on every "play"): nothing to do at all
    params = np;
    designFor(np, sampleRate);               // the heavy maths happen HERE, on the caller's thread, not in the audio stream
  }

  /** Sample rate of the running stream (the plugin reports the headroom for exactly this rate). */
  public int currentRate() { return sampleRate; }

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
    // flat: the limiter no longer reacts to new peaks, it only lets a previous gain reduction release (then: bypass)
    final float ceil = flat ? Float.MAX_VALUE : CEILING;
    final boolean tap = spectrumOn;
    int idx = 0;
    // Flat sound = untouched signal (no filters, no pre-gain, no limiter). Only the spectrum tap keeps running.
    if (flat && Math.abs(preCur - 1f) < 1e-4f && limGain >= 1f) {
      preCur = 1f;
      if (tap) {
        for (int f = 0; f < frames; f++) {
          float m = 0;
          for (int c = 0; c < ch; c++) m += x[idx + c];
          int p = ringPos;
          ring[p] = m / ch;
          ringPos = (p + 1) % FFT_N;
          idx += ch;
        }
      }
      return;
    }
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
      else {
        limGain = 1f - (1f - limGain) * relCoef;
        // float rounding makes the release stall just below 1.0 (~-0.003 dB); snap it so the flat bypass can engage
        if (limGain > 0.9995f) limGain = 1f;
      }
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
    return designFor(params, rate).boostDb;
  }

  // ======================= internals =======================

  private void update() {
    Params p = params;
    final int rate = sampleRate;
    Design d = designFor(p, rate);               // cache hit in practice (set()/configure() already built it)
    for (int k = 0; k < NB; k++) {
      boolean active = d.on[k];
      if (active && !on[k]) for (int c = 0; c < 8; c++) { z1[c][k] = 0; z2[c][k] = 0; }
      on[k] = active;
      b0[k] = d.b0[k]; b1[k] = d.b1[k]; b2[k] = d.b2[k]; a1[k] = d.a1[k]; a2[k] = d.a2[k];
    }
    preTarget = d.preTarget;
    flat = d.flat;
    applied = p;
    appliedRate = rate;
  }

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
