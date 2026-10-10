package com.shelf.player;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;

/**
 * Loudness normalisation: every file is played at about the same level, so there is no reaching for the volume
 * between a quiet and a loud book / track.
 *   - the measuring runs in the BACKGROUND, one file at a time, at the lowest thread priority (LoudnessAnalyzer);
 *   - the result is one float per file in a tiny SharedPreferences file: nothing is added to the app, no copies of audio;
 *   - a file that is not measured yet simply plays as it is, and is corrected as soon as its number is ready.
 * The correction is applied by AudioFx.setNorm, on top of the person's own volume / EQ, and the limiter keeps it safe.
 */
final class Normalizer {
  private static final String PREFS = "loudness";
  private static final int MAX_ENTRIES = 4000;            // a library this large: start over rather than grow forever

  /** Settings → "Выравнивание громкости". On by default. */
  static volatile boolean enabled = true;

  interface Listener { void onMeasured(String uri); }
  static volatile Listener listener;

  private static final Set<String> queued = Collections.synchronizedSet(new HashSet<String>());
  private static final ExecutorService EXEC = Executors.newSingleThreadExecutor(new ThreadFactory() {
    @Override public Thread newThread(Runnable r) {
      Thread t = new Thread(r, "loudness");
      t.setPriority(Thread.MIN_PRIORITY);
      t.setDaemon(true);
      return t;
    }
  });

  private Normalizer() {}

  private static SharedPreferences prefs(Context c) { return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

  /** The saved correction in dB; NaN = not measured yet. */
  static float cached(Context c, String uri) {
    return prefs(c).getFloat(uri, Float.NaN);
  }

  /** Measures the files that have no number yet, in the given order, one after another. */
  static void enqueue(final Context ctx, List<String> uris) {
    if (!enabled) return;
    final Context app = ctx.getApplicationContext();
    final SharedPreferences sp = prefs(app);
    for (final String u : uris) {
      if (u == null || sp.contains(u) || !queued.add(u)) continue;
      EXEC.execute(new Runnable() {
        @Override public void run() {
          try {
            if (!enabled) return;
            float g = LoudnessAnalyzer.analyze(app, Uri.parse(u));
            SharedPreferences.Editor e = sp.edit();
            if (sp.getAll().size() > MAX_ENTRIES) e.clear();
            e.putFloat(u, Float.isNaN(g) ? 0f : g);       // unreadable: 0, so it is not retried on every start
            e.apply();
            Listener l = listener;
            if (l != null) l.onMeasured(u);
          } finally {
            queued.remove(u);
          }
        }
      });
    }
  }
}
