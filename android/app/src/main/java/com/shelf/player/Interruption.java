package com.shelf.player;

/**
 * A phone call / notification took the audio away. Pure logic (no Android dependencies, unit-testable).
 *
 * Two independent sources can be active at the same time (audio-focus loss and "the phone is in call mode");
 * playback continues only when BOTH are over, and then it steps back REWIND_MS so no words are lost.
 */
final class Interruption {
  static final long REWIND_MS = 5000;

  private boolean active, focusLost, callMode;
  private int index;
  private long posMs;

  /** Remember the exact place of the FIRST interruption; only if something was really playing. */
  void begin(boolean wasPlaying, int mediaItemIndex, long positionMs) {
    if (active || !wasPlaying) return;
    active = true;
    index = mediaItemIndex;
    posMs = positionMs;
  }

  void setFocusLost(boolean v) { focusLost = v; }

  void setCallMode(boolean v) { callMode = v; }

  /** True exactly once: when an interruption was active and every source of it is over. */
  boolean shouldResume() {
    if (active && !focusLost && !callMode) { active = false; return true; }
    return false;
  }

  /** The person took control (pressed play themselves): do not step back or resume on their behalf. */
  void cancel() { active = false; }

  boolean isActive() { return active; }

  int index() { return index; }

  long posMs() { return posMs; }

  /**
   * Where to continue inside the same chapter: REWIND_MS before the interruption. If the chapter began less than
   * REWIND_MS ago, the start of the chapter (never the previous chapter).
   */
  static long rewindPosition(long positionMs) {
    return Math.max(0, positionMs - REWIND_MS);
  }
}
