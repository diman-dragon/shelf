package com.shelf.player;

/**
 * Pure maths of the "Album" playback mode (no Android dependencies, unit-testable).
 *
 *   book  : gapless, no fades (audiobooks)
 *   album : the last FADE_OUT_MS of every track fade out, then a short pause (GAP_MS), then the next track fades in.
 */
final class AlbumFade {
  static final long FADE_OUT_MS = 3500;   // real time (already corrected for the playback speed)
  static final long GAP_MS = 2000;        // silence between two tracks
  static final long FADE_IN_MS = 600;

  private AlbumFade() { }

  /** Gain 0..1 while the track is ending; leftRealMs = time until its end in real time (media time / speed). */
  static float fadeOut(long leftRealMs) {
    if (leftRealMs >= FADE_OUT_MS) return 1f;
    float x = Math.max(0f, leftRealMs / (float) FADE_OUT_MS);
    return x * x;                          // quadratic: sounds like a smooth, natural decay
  }

  /** Gain 0..1 right after the pause, so the next track does not start with a click. */
  static float fadeIn(long sinceStartMs) {
    if (sinceStartMs >= FADE_IN_MS) return 1f;
    float x = Math.max(0f, sinceStartMs / (float) FADE_IN_MS);
    return x * x;
  }

  /** When to look at the position again: rarely far from the end (saves wake-ups), often during a fade. */
  static long nextCheckMs(long leftRealMs, boolean fadingIn) {
    if (fadingIn) return 40;
    if (leftRealMs <= FADE_OUT_MS) return 50;
    return Math.max(100, Math.min(1000, leftRealMs - FADE_OUT_MS - 100));
  }

  /**
   * ExoPlayer paused "at the end of a media item". Is there a next track to wait for? False only when the very last
   * track of the book has just finished (position at its end and nothing after it) — then there is nothing to resume.
   * Works whether the player stays at the end of the old item or already sits at the start of the next one.
   */
  static boolean shouldResumeAfterGap(boolean hasNext, long posMs, long durMs) {
    boolean lastAndFinished = !hasNext && durMs > 0 && posMs >= durMs - 800;
    return !lastAndFinished;
  }
}
