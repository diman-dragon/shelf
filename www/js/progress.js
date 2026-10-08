/* progress.js — pure listening-progress maths (no DOM): shared by the header, the library and the player */
import { state } from './state.js';
import { getSavedPosition } from './storage.js';

export function bookTotal(b = state.current){
  return (b?.files || []).reduce((a, f) => a + (Number(f.duration) || 0), 0);
}

/** Elapsed seconds across the whole book. state.currentPos is the canonical chapter position. */
export function bookElapsed(b = state.current){
  if(!b) return 0;
  const files = b.files || [];
  let i, t;
  if(state.current?.id === b.id){
    i = state.currentIndex;
    t = Number(state.currentPos) || 0;
  } else {
    const s = getSavedPosition(b);
    i = s.i; t = s.t;
  }
  i = Math.max(0, Math.min(i, files.length - 1));
  const before = files.slice(0, i).reduce((a, f) => a + (Number(f.duration) || 0), 0);
  return before + t;
}

/** Whole-book progress 0–100 */
export function progress(b){
  const files = b.files || [];
  if(!files.length) return 0;
  const total = files.reduce((a,f)=>a+(Number(f.duration)||0), 0);
  const isCurrent = !!state.current && state.current.id === b.id;
  let i, t;
  if(isCurrent){
    i = state.currentIndex;
    t = Number(state.currentPos) || 0;      // canonical, restored from storage even before audio is loaded
  } else {
    const s = getSavedPosition(b);
    i = s.i; t = s.t;
  }
  i = Math.max(0, Math.min(i, files.length-1));
  t = Math.max(0, t);
  if(total <= 0){
    // durations still unknown: coarse estimate by chapter index
    const d = Math.max(0, Number(files[i]?.duration)||0);
    const pct = Math.max(0, Math.min(100, ((i + (d ? t/d : 0)) / files.length) * 100));
    return b.finished ? 100 : pct;
  }
  const before = files.slice(0, i).reduce((a,f)=>a+(Number(f.duration)||0), 0);
  const pct = Math.max(0, Math.min(100, ((before + t) / total) * 100));
  return b.finished ? 100 : pct;
}
