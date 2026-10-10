package com.shelf.player;

import android.content.Context;
import android.media.AudioFormat;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.net.Uri;
import android.os.SystemClock;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.nio.ShortBuffer;

/**
 * Measures how loud a file is by decoding about 15 seconds of it (taken from the first third, past an intro).
 * Runs on the background thread of Normalizer, never on the audio or the UI thread. Needs no libraries and adds nothing
 * to the app size: it uses the phone's own decoders.
 */
final class LoudnessAnalyzer {
  private static final long WINDOW_US = 25_000_000L;     // how much of the file the extractor may read
  private static final double ENOUGH_SECONDS = 15;       // stop decoding when this much sound was measured
  private static final long TIMEOUT_MS = 20_000;         // a slow SD card or provider must not hold the thread forever

  private LoudnessAnalyzer() {}

  /** The correction in dB, or NaN when the file could not be measured (unknown format, unreadable, too short). */
  static float analyze(Context ctx, Uri uri) {
    MediaExtractor ex = new MediaExtractor();
    MediaCodec codec = null;
    try {
      ex.setDataSource(ctx, uri, null);
      int track = -1;
      MediaFormat fmt = null;
      for (int i = 0; i < ex.getTrackCount(); i++) {
        MediaFormat f = ex.getTrackFormat(i);
        String mime = f.getString(MediaFormat.KEY_MIME);
        if (mime != null && mime.startsWith("audio/")) { track = i; fmt = f; break; }
      }
      if (track < 0) return Float.NaN;
      ex.selectTrack(track);
      long durUs = fmt.containsKey(MediaFormat.KEY_DURATION) ? fmt.getLong(MediaFormat.KEY_DURATION) : 0;
      if (durUs > 90_000_000L) ex.seekTo(durUs / 3, MediaExtractor.SEEK_TO_CLOSEST_SYNC);
      long startUs = Math.max(0, ex.getSampleTime());

      codec = MediaCodec.createDecoderByType(fmt.getString(MediaFormat.KEY_MIME));
      codec.configure(fmt, null, null, 0);
      codec.start();

      int rate = fmt.containsKey(MediaFormat.KEY_SAMPLE_RATE) ? fmt.getInteger(MediaFormat.KEY_SAMPLE_RATE) : 44100;
      int ch = fmt.containsKey(MediaFormat.KEY_CHANNEL_COUNT) ? fmt.getInteger(MediaFormat.KEY_CHANNEL_COUNT) : 2;
      int enc = AudioFormat.ENCODING_PCM_16BIT;
      Loudness meter = null;

      MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
      boolean inDone = false, outDone = false;
      final long deadline = SystemClock.elapsedRealtime() + TIMEOUT_MS;
      while (!outDone && SystemClock.elapsedRealtime() < deadline) {
        if (!inDone) {
          int ii = codec.dequeueInputBuffer(10_000);
          if (ii >= 0) {
            ByteBuffer ib = codec.getInputBuffer(ii);
            int n = ib == null ? -1 : ex.readSampleData(ib, 0);
            long t = ex.getSampleTime();
            if (n < 0 || (t >= 0 && t - startUs > WINDOW_US)) {
              codec.queueInputBuffer(ii, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
              inDone = true;
            } else {
              codec.queueInputBuffer(ii, 0, n, Math.max(0, t), 0);
              ex.advance();
            }
          }
        }
        int oi = codec.dequeueOutputBuffer(info, 10_000);
        if (oi == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
          MediaFormat of = codec.getOutputFormat();
          if (of.containsKey(MediaFormat.KEY_SAMPLE_RATE)) rate = of.getInteger(MediaFormat.KEY_SAMPLE_RATE);
          if (of.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) ch = of.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
          if (of.containsKey(MediaFormat.KEY_PCM_ENCODING)) enc = of.getInteger(MediaFormat.KEY_PCM_ENCODING);
          meter = null;
        } else if (oi >= 0) {
          ByteBuffer ob = codec.getOutputBuffer(oi);
          if (ob != null && info.size > 0) {
            if (meter == null) meter = new Loudness(rate);
            ob.position(info.offset);
            ob.limit(info.offset + info.size);
            ob.order(ByteOrder.nativeOrder());
            if (!feed(meter, ob, Math.max(1, ch), enc)) { codec.releaseOutputBuffer(oi, false); return Float.NaN; }
          }
          codec.releaseOutputBuffer(oi, false);
          if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) outDone = true;
          if (meter != null && meter.seconds() >= ENOUGH_SECONDS) outDone = true;
        }
      }
      if (meter == null) return Float.NaN;
      return meter.loudBlocks() < 30 ? Float.NaN : meter.gainDb();
    } catch (Throwable e) {
      return Float.NaN;
    } finally {
      if (codec != null) { try { codec.stop(); } catch (Throwable ignored) { } try { codec.release(); } catch (Throwable ignored) { } }
      ex.release();
    }
  }

  /** Mixes the interleaved channels down to mono and feeds the meter. false = a sample format we do not read (8 / 24 bit). */
  private static boolean feed(Loudness meter, ByteBuffer ob, int ch, int enc) {
    if (enc == AudioFormat.ENCODING_PCM_FLOAT) {
      FloatBuffer fb = ob.asFloatBuffer();
      while (fb.remaining() >= ch) {
        float m = 0;
        for (int c = 0; c < ch; c++) m += fb.get();
        meter.add(m / ch);
      }
      return true;
    }
    if (enc == AudioFormat.ENCODING_PCM_16BIT) {
      ShortBuffer sb = ob.asShortBuffer();
      while (sb.remaining() >= ch) {
        float m = 0;
        for (int c = 0; c < ch; c++) m += sb.get();
        meter.add(m / ch / 32768f);
      }
      return true;
    }
    return false;
  }
}
