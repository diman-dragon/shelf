/* meta.js — lazy durations & covers for books (native MediaMetadataRetriever, <audio> fallback) */
import { state, plugin, isNative } from './state.js';
import { persist } from './storage.js';
import { bookCover } from './ui-utils.js';

const { get } = window.idbKeyval || {};
const busy = new Set();
let coverJobRunning = false;

async function nativeMeta(uri, cover){
  const P = plugin('ShelfFiles');
  if(!P?.getMeta || !uri) return null;
  try { return await P.getMeta({ uri, cover: !!cover }); } catch { return null; }
}

/** Fallback for web / old native build: read duration through a detached <audio> */
async function probeWithAudio(f){
  let src = '', blobUrl = '';
  try {
    if(f.key){
      const blob = await get?.(f.key);
      if(!blob) return 0;
      src = blobUrl = URL.createObjectURL(blob);
    } else if(f.uri){
      src = isNative() ? window.Capacitor.convertFileSrc(f.uri) : f.uri;
    } else return 0;
  } catch { return 0; }
  return new Promise(resolve => {
    const a = new Audio();
    let done = false;
    const finish = v => {
      if(done) return;
      done = true;
      clearTimeout(timer);
      a.removeAttribute('src');
      try { a.load(); } catch {}
      if(blobUrl) URL.revokeObjectURL(blobUrl);
      resolve(Number.isFinite(v) && v > 0 ? v : 0);
    };
    const timer = setTimeout(() => finish(0), 7000);
    a.preload = 'metadata';
    a.onloadedmetadata = () => finish(a.duration);
    a.onerror = () => finish(0);
    a.src = src;
  });
}

export async function probeDuration(f){
  if(f.uri && isNative()){
    const m = await nativeMeta(f.uri, false);
    if(m && Number(m.duration) > 0) return Number(m.duration);
  }
  return probeWithAudio(f);
}

/**
 * Fills missing chapter durations (so the progress bar is based on the whole book)
 * and the cover for the given book. onChange() is called after every update.
 */
export async function hydrateBookMeta(b, onChange){
  if(!b || busy.has(b.id)) return;
  busy.add(b.id);
  let changed = false;
  try {
    if(!b.cover && !b.coverChecked && b.files?.[0]?.uri){
      b.coverChecked = true;
      const m = await nativeMeta(b.files[0].uri, true);
      if(m?.cover){ b.cover = m.cover; }
      changed = true;
      onChange?.();
    }
    for(const f of b.files || []){
      if(Number(f.duration) > 0) continue;
      if(!state.books.includes(b)) break;
      const d = await probeDuration(f);
      if(d > 0){ f.duration = d; changed = true; onChange?.(); }
    }
  } catch(e) {
    console.error('[hydrateBookMeta]', e);
  } finally {
    busy.delete(b.id);
  }
  if(changed){ try { await persist(); } catch {} }
}

/** Library: quietly load covers for books scanned by an older version (native only) */
export async function hydrateLibraryCovers(books){
  if(coverJobRunning || !isNative() || !plugin('ShelfFiles')?.getMeta) return;
  const todo = (books || []).filter(b => !b.cover && !b.coverChecked && b.files?.[0]?.uri).slice(0, 40);
  if(!todo.length) return;
  coverJobRunning = true;
  let changed = false;
  try {
    for(const b of todo){
      b.coverChecked = true;
      const m = await nativeMeta(b.files[0].uri, true);
      changed = true;
      if(m?.cover){
        b.cover = m.cover;
        const thumb = document.querySelector(`.library-book-item[data-id="${b.id}"] .lib-thumb`);
        if(thumb) thumb.innerHTML = bookCover(b);
      }
      await new Promise(r => setTimeout(r, 30));
    }
  } finally {
    coverJobRunning = false;
  }
  if(changed){ try { await persist(); } catch {} }
}
