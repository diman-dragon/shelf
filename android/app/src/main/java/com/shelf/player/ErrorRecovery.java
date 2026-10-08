package com.shelf.player;

/**
 * What to do when the player reports an error. Pure logic (no Android dependencies, unit-testable).
 *
 * A transient error (file read broke after a long pause: the SD card or the documents provider went to sleep, the audio
 * device was reset) is retried ONCE at the same spot. The old behaviour jumped to the next chapter on ANY error, so a
 * hiccup after "pause, wait, play from the shade" silently skipped a whole chapter. If the same spot fails again right
 * away, or the error is not transient (unreadable/missing file, unsupported format), the chapter is skipped as before.
 */
final class ErrorRecovery {
  enum Action { RETRY, SKIP }

  static final long SAME_SPOT_MS = 3000;     // "the same place": within 3 s of the previous failure position
  static final long WINDOW_MS = 15000;       // ... and within 15 s of the previous failure

  private int lastIndex = -1;
  private long lastPosMs = -1, lastAtMs = -1_000_000;

  Action decide(boolean transientError, int index, long posMs, long nowMs) {
    boolean again = index == lastIndex && Math.abs(posMs - lastPosMs) <= SAME_SPOT_MS && nowMs - lastAtMs <= WINDOW_MS;
    lastIndex = index; lastPosMs = posMs; lastAtMs = nowMs;
    return transientError && !again ? Action.RETRY : Action.SKIP;
  }

  void reset() { lastIndex = -1; lastPosMs = -1; lastAtMs = -1_000_000; }
}
