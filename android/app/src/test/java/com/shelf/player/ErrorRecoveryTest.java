package com.shelf.player;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class ErrorRecoveryTest {

  @Test public void aTransientErrorIsRetriedOnceAtTheSameSpot() {
    ErrorRecovery r = new ErrorRecovery();
    assertEquals(ErrorRecovery.Action.RETRY, r.decide(true, 4, 600_000, 1_000));
    assertEquals("the retry failed at the same place: now skip", ErrorRecovery.Action.SKIP, r.decide(true, 4, 600_200, 3_000));
  }

  @Test public void aNonTransientErrorSkipsImmediately() {
    ErrorRecovery r = new ErrorRecovery();
    assertEquals(ErrorRecovery.Action.SKIP, r.decide(false, 2, 0, 1_000));
  }

  @Test public void aLaterHiccupGetsANewRetry() {
    ErrorRecovery r = new ErrorRecovery();
    assertEquals(ErrorRecovery.Action.RETRY, r.decide(true, 4, 600_000, 1_000));
    assertEquals("another place in the same book", ErrorRecovery.Action.RETRY, r.decide(true, 4, 900_000, 5_000));
    assertEquals("same place but a minute later", ErrorRecovery.Action.RETRY, r.decide(true, 4, 900_100, 65_000));
    assertEquals("another chapter", ErrorRecovery.Action.RETRY, r.decide(true, 5, 900_100, 66_000));
  }

  @Test public void resetForgetsThePreviousFailure() {
    ErrorRecovery r = new ErrorRecovery();
    r.decide(true, 1, 1000, 1000);
    r.reset();
    assertEquals(ErrorRecovery.Action.RETRY, r.decide(true, 1, 1000, 1500));
  }
}
