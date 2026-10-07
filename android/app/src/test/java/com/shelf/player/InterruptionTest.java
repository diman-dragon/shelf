package com.shelf.player;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Phone call / notification: stop at once, continue 5 s earlier, only when every source of the interruption is over. */
public class InterruptionTest {

  @Test public void focusLossAloneResumesFiveSecondsEarlier() {
    Interruption i = new Interruption();
    i.begin(true, 3, 120_000);
    i.setFocusLost(true);
    assertFalse("still interrupted", i.shouldResume());
    i.setFocusLost(false);
    assertTrue(i.shouldResume());
    assertArrayEquals(new long[] { 3, 115_000 }, Interruption.rewindTarget(i.index(), i.posMs(), 0));
    assertFalse("resumes exactly once", i.shouldResume());
  }

  @Test public void aCallWithBothSourcesWaitsForBoth() {
    Interruption i = new Interruption();
    i.begin(true, 0, 60_000);
    i.setFocusLost(true);
    i.setCallMode(true);
    i.setFocusLost(false);                        // focus came back first...
    assertFalse("...but the phone is still in the call", i.shouldResume());
    i.setCallMode(false);
    assertTrue(i.shouldResume());
  }

  @Test public void theFirstPositionWins() {
    Interruption i = new Interruption();
    i.begin(true, 1, 10_000);
    i.begin(true, 1, 14_000);                     // the second source arrives a moment later: do not move the point
    assertEquals(10_000, i.posMs());
  }

  @Test public void nothingPlayingMeansNothingToResume() {
    Interruption i = new Interruption();
    i.begin(false, 0, 5_000);                     // the person had paused before the call
    i.setCallMode(true);
    i.setCallMode(false);
    assertFalse(i.shouldResume());
  }

  @Test public void pressingPlayDuringTheCallCancelsTheAutomaticResume() {
    Interruption i = new Interruption();
    i.begin(true, 2, 30_000);
    i.setFocusLost(true);
    i.cancel();
    i.setFocusLost(false);
    assertFalse(i.shouldResume());
  }

  @Test public void stepBackStaysInsideTheTrackWhenPossible() {
    assertArrayEquals(new long[] { 4, 5_000 }, Interruption.rewindTarget(4, 10_000, 0));
    assertArrayEquals(new long[] { 4, 0 }, Interruption.rewindTarget(4, 5_000, 0));
  }

  @Test public void stepBackFromTheStartOfATrackEntersTheEndOfThePreviousOne() {
    // 2 s into track 4, previous track is 600 s long: continue 3 s before its end
    assertArrayEquals(new long[] { 3, 597_000 }, Interruption.rewindTarget(4, 2_000, 600_000));
    assertArrayEquals("unknown length of the previous track: start of this one", new long[] { 4, 0 }, Interruption.rewindTarget(4, 2_000, 0));
    assertArrayEquals("first track: clamp at 0", new long[] { 0, 0 }, Interruption.rewindTarget(0, 2_000, 0));
  }
}
