/* state.js — Application State, Constants & Helpers */
export const $ = id => document.getElementById(id);
export const main = $('main');
export const modalRoot = $('modalRoot');

/** Seek step (seconds) of the player buttons, the notification, the lock screen and the widget. Chosen in the settings, default ±10 s. */
export const DEFAULT_SEEK_STEP = 10;
export const seekStep = () => {
  const n = Math.round(Number(state.settings.seekStep));
  return Number.isFinite(n) && n >= 1 && n <= 300 ? n : DEFAULT_SEEK_STEP;
};

export const DEFAULT_PLAYLISTS = [
  ['fav','Избранное','♥'],['road','Для дороги','▣'],['fantasy','Фантастика','◉'],
  ['classic','Классика','▤'],['psychology','Психология','◌'],['nonfiction','Нон-фикшн','▧']
];

export const ICONS = {
  filter:'<path d="M4 6h16M7 12h10M10 18h4"/>',
  sort:'<path d="M7 5v14M4 8l3-3 3 3M17 19V5m-3 11 3 3 3-3"/>',
  shelf:'<path d="M4 18h16M5 18V7h14v11M7 7V5h10v2M8 10h8M8 13h8"/>',
  book:'<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 0-3 0V4Z"/><path d="M8 20V7a3 3 0 0 1 3-3"/>',
  playlist:'<path d="M4 6h11M4 11h11M4 16h7"/><path d="M17 14v6a2 2 0 1 1-2-2h2V9l5-1v4"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.8 1.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-2.6v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1-1.8-1.8.1-.1A1.7 1.7 0 0 0 8 15a1.7 1.7 0 0 0-1.5-1H6v-2.6h.2A1.7 1.7 0 0 0 8 10a1.7 1.7 0 0 0-.3-1.9l-.1-.1 1.8-1.8.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V5h2.6v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 1.8 1.8-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.2V14h-.2a1.7 1.7 0 0 0-1.5 1Z"/>',
  back:'<path d="m15 18-6-6 6-6"/>', close:'<path d="m6 6 12 12M18 6 6 18"/>', plus:'<path d="M12 5v14M5 12h14"/>',
  more:'<circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/>',
  play:'<path d="m8 5 11 7-11 7V5Z" fill="currentColor" stroke="none"/>', pause:'<path d="M8 5v14M16 5v14"/>',
  prev:'<path d="m18 6-8 6 8 6V6ZM6 6v12"/>', next:'<path d="m6 6 8 6-8 6V6Zm12 0v12"/>',
  rewind:'<path d="M7 7v10l-5-5 5-5Z"/><path d="M13 7v10l-5-5 5-5Z"/><path d="M17 7h3v10h-3"/>',
  forward:'<path d="M17 7v10l5-5-5-5Z"/><path d="M11 7v10l5-5-5-5Z"/><path d="M7 7H4v10h3"/>',
  bookmark:'<path d="M7 4h10v17l-5-3-5 3V4Z"/>',
  folder:'<path d="M3 7h7l2 2h9v10H3V7Z"/>',  trash:'<path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5M14 11v5"/>',
  moon:'<path d="M20 15.5A8 8 0 0 1 8.5 4 8 8 0 1 0 20 15.5Z"/>', sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 10v6M12 7h.01"/>',
  music:'<path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>',  folderPlus:'<path d="M3 7h7l2 2h9v10H3V7Z"/><path d="M12 12v5m-2.5-2.5h5"/>',
  refresh:'<path d="M20 11a8 8 0 0 0-14-4L4 9m0-5v5h5M4 13a8 8 0 0 0 14 4l2-2m0 5v-5h-5"/>', chevron:'<path d="m9 18 6-6-6-6"/>'
};

export let state = {
  screen:'shelf', books:[], folders:[], playlists:[],
  settings:{theme:'dark',autoscan:false,speed:1,seekStep:10},
  scan:{active:false,total:0,processed:0,books:0,skipped:0,errors:0,timeouts:0,firstError:'',counting:false,name:''},
  query:'', librarySort:'recent', selectedFolderIds:[],
  current:null, currentIndex:0, currentPos:0, blobUrl:'', playing:false, speed:1, sleepTimer:null, sleepEndsAt:0, appVersion:'', resumeRewind:false
};

export function icon(name, cls='icon'){return `<span class="${cls}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]||ICONS.info}</svg></span>`}
export function escapeHtml(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
export function durationOfBook(b){return (b.files||[]).reduce((a,f)=>a+(Number(f.duration)||0),0)}
/** Removes a leading track/volume number from a book title: "01. Name", "01) Name", "01 - Name", "01_Name" -> "Name" */
export function cleanTitle(s=''){
  const raw = String(s).trim();
  const out = raw.replace(/^\d{1,3}\s*(?:[.)_](?!\d)\s*|[-–—:]\s+)/, '').trim();
  return out || raw;
}
/** SAF tree names come as "primary:Audiobooks/Sub": drop the volume prefix and keep the last path segment */
export function cleanFolderName(s=''){
  let n = String(s);
  const colon = n.indexOf(':');
  if(colon >= 0 && !n.slice(0, colon).includes('/')) n = n.slice(colon + 1);
  n = n.split('/').filter(Boolean).pop() || '';
  return n.trim() || 'Аудиокниги';
}
export function uid(){return 'b'+Date.now().toString(36)+Math.random().toString(36).slice(2,7)}
export function plural(n,a,b,c){const x=n%10,y=n%100;return x===1&&y!==11?a:x>=2&&x<=4&&(y<10||y>=20)?b:c}
export function isNative(){return !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform())}
export function plugin(name){return window.Capacitor?.Plugins?.[name] || null}
