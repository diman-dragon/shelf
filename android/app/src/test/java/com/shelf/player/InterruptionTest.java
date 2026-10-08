package com.shelf.player;

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
    assertEquals(115_000, Interruption.rewindPosition(i.posMs()));
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

  @Test public void stepBackIsFiveSecondsInsideTheChapter() {
    assertEquals(5_000, Interruption.rewindPosition(10_000));
    assertEquals(0, Interruption.rewindPosition(5_000));
  }

  @Test public void lessThanFiveSecondsIntoTheChapterMeansTheStartOfThatChapter() {
    assertEquals("2 s in: chapter start, not the previous chapter", 0, Interruption.rewindPosition(2_000));
    assertEquals(0, Interruption.rewindPosition(0));
    assertEquals(0, Interruption.rewindPosition(4_999));
  }
}
