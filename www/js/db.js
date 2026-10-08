/* db.js — thin wrapper over idb-keyval (lib/idb-keyval.js).
 * The old code used `const { get, set } = window.idbKeyval || {}` and `set?.(...)` everywhere, so a library that
 * failed to load made the app "work" while silently saving nothing. Here every call rejects with a clear error instead.
 */
function lib(){
  const l = window.idbKeyval;
  if(!l || typeof l.get !== 'function' || typeof l.set !== 'function' || typeof l.del !== 'function'){
    throw new Error('Хранилище недоступно: не загрузилась lib/idb-keyval.js');
  }
  return l;
}

export const dbGet = key => Promise.resolve().then(() => lib().get(key));
export const dbSet = (key, value) => Promise.resolve().then(() => lib().set(key, value));
export const dbDel = key => Promise.resolve().then(() => lib().del(key));
