/* native-bridge.js — glue between the Capacitor "Player" plugin (ExoPlayer service) and the UI.
 * Everything here is a no-op in the browser (NATIVE === false). The handlers `h` are supplied by player.js,
 * which owns the playback state.
 */
import { plugin } from './state.js';
import { audio, NATIVE } from './sound.js';
import { readLastPlayback, setLastPlayback } from './storage.js';

/** Fully stops the native service-side playback (book deleted / closed): clears its queue and drops the notification */
export function stopNativePlayer(){
  if(!NATIVE) return;
  audio.reset();                                           // the JS facade must not believe the old queue is still loaded
  const P = plugin('Player');
  if(P) P.stop().catch(() => {});
}

/**
 * h.trackChange(index)   ExoPlayer moved to another chapter on its own (auto-advance, notification/headset next/prev)
 * h.durationChange(sec)  real chapter duration became known to the decoder
 * h.ended()              end of the LAST chapter (chapter-to-chapter transitions are gapless inside the native playlist)
 * h.closed()             service is gone (notification X / dismissed / task removed)
 */
export function bindNativeEvents(h){
  if(!NATIVE) return;
  audio.addEventListener('trackchange', e => h.trackChange(e.detail.index));
  audio.addEventListener('durationchange', () => h.durationChange(audio.duration));
  audio.addEventListener('ended', () => h.ended());
  audio.addEventListener('closed', () => h.closed());
}

/** Take the newer of (JS last save, native service last save) before the app decides what to resume. */
export async function syncNativeResume(){
  if(!NATIVE) return;
  try {
    const st = await audio.P.getState();
    const s = st?.saved;
    if(!s?.bookId) return;
    const last = readLastPlayback();
    if(!last || (Number(s.ts) || 0) > (Number(last.ts) || 0)){
      setLastPlayback({bookId: s.bookId, index: Number(s.index) || 0, pos: Number(s.pos) || 0, ts: Number(s.ts) || Date.now()});
    }
  } catch {}
}
