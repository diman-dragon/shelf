package com.shelf.player;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Pure maths of the "Album" mode: fade-out at the end of a track, fade-in after the pause, when to resume. */
public class AlbumFadeTest {

  @Test public void fullVolumeFarFromTheEnd() {
    assertEquals(1f, AlbumFade.fadeOut(600_000), 0f);
    assertEquals(1f, AlbumFade.fadeOut(AlbumFade.FADE_OUT_MS), 0f);
  }

  @Test public void fadeOutIsMonotonicAndReachesSilence() {
    float prev = 1f;
    for (long left = AlbumFade.FADE_OUT_MS; left >= 0; left -= 50) {
      float v = AlbumFade.fadeOut(left);
      assertTrue("never gets louder while fading out", v <= prev);
      prev = v;
    }
    assertEquals(0f, AlbumFade.fadeOut(0), 0f);
    assertEquals(0f, AlbumFade.fadeOut(-100), 0f);      // position may overshoot the duration slightly
  }

  @Test public void fadeOutCurveIsQuadratic() {
    assertEquals(0.25f, AlbumFade.fadeOut(AlbumFade.FADE_OUT_MS / 2), 0.001f);
  }

  @Test public void fadeInGoesFromSilenceToFull() {
    assertEquals(0f, AlbumFade.fadeIn(0), 0f);
    assertEquals(1f, AlbumFade.fadeIn(AlbumFade.FADE_IN_MS), 0f);
    assertTrue(AlbumFade.fadeIn(AlbumFade.FADE_IN_MS / 2) > 0f);
  }

  @Test public void wakesUpRarelyFarFromTheEndAndOftenDuringFades() {
    assertEquals(1000, AlbumFade.nextCheckMs(600_000, false));
    assertTrue("never sleeps through the start of the fade",
        AlbumFade.nextCheckMs(AlbumFade.FADE_OUT_MS + 400, false) <= 400);
    assertEquals(50, AlbumFade.nextCheckMs(1000, false));
    assertEquals(40, AlbumFade.nextCheckMs(60_000, true));
  }

  @Test public void resumesAfterTheGapExceptAfterTheVeryLastTrack() {
    assertTrue(AlbumFade.shouldResumeAfterGap(true, 179_900, 180_000));   // player still at the end of a middle track
    assertTrue(AlbumFade.shouldResumeAfterGap(true, 0, 200_000));         // already at the start of the next one
    assertTrue(AlbumFade.shouldResumeAfterGap(false, 0, 200_000));        // start of the last track
    assertFalse(AlbumFade.shouldResumeAfterGap(false, 199_900, 200_000)); // the book/album is over: nothing to resume
  }
}
