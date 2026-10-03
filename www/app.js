/* Полка 2.0 — локальная библиотека аудио */
const {get,set,del} = idbKeyval;
const $ = id => document.getElementById(id);
const main = $('main');
const modalRoot = $('modalRoot');
const audio = new Audio();
audio.preload = 'metadata';
audio.crossOrigin = 'anonymous';
let audioContext = null;
let audioSource = null;
let analyser = null;
let visualizerFrame = 0;
let visualizerOpen = false;

const AUDIO_EXT = /\.(mp3|m4a|m4b|aac|ogg|opus|flac|wav|wma)$/i;
const NAV = ['shelf','player','playlists','settings'];
const DEFAULT_PLAYLISTS = [
  ['fav','Избранное','♥'],['road','Для дороги','▣'],['fantasy','Фантастика','◉'],
  ['classic','Классика','▤'],['psychology','Психология','◌'],['nonfiction','Нон-фикшн','▧']
];
const ICONS = {
  search:'<path d="m20 20-4.3-4.3"/><circle cx="11" cy="11" r="6.5"/>',
  menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',
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
  bookmark:'<path d="M7 4h10v17l-5-3-5 3V4Z"/>', heart:'<path d="M20 8.5c0 5-8 10-8 10s-8-5-8-10a4 4 0 0 1 7-2.5A4 4 0 0 1 20 8.5Z"/>',
  folder:'<path d="M3 7h7l2 2h9v10H3V7Z"/>', check:'<path d="m5 12 4 4L19 6"/>', trash:'<path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5M14 11v5"/>',
  moon:'<path d="M20 15.5A8 8 0 0 1 8.5 4 8 8 0 1 0 20 15.5Z"/>', sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 10v6M12 7h.01"/>', download:'<path d="M12 3v11m0 0 4-4m-4 4-4-4M4 20h16"/>', headset:'<path d="M4 14v-2a8 8 0 0 1 16 0v2M4 14v4h3v-6H4m16 2v4h-3v-6h3"/>',
  music:'<path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>', sliders:'<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="8" cy="7" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="10" cy="17" r="2"/>',
  eye:'<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>', folderPlus:'<path d="M3 7h7l2 2h9v10H3V7Z"/><path d="M12 12v5m-2.5-2.5h5"/>',
  refresh:'<path d="M20 11a8 8 0 0 0-14-4L4 9m0-5v5h5M4 13a8 8 0 0 0 14 4l2-2m0 5v-5h-5"/>', shuffle:'<path d="M16 3h5v5M3 7h3c3 0 5 10 9 10h6M16 21h5v-5M3 17h3c1.6 0 2.7-1.4 3.6-3"/>', repeat:'<path d="M17 2l4 4-4 4M3 6h18M7 22l-4-4 4-4M21 18H3"/>'
};
function icon(name, cls='icon'){return `<span class="${cls}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]||ICONS.info}</svg></span>`}
function escapeHtml(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function fmt(sec){sec=Number(sec)||0;if(sec<0)sec=0;const h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),s=Math.floor(sec%60);return h?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${m}:${String(s).padStart(2,'0')}`}
function durationOfBook(b){return (b.files||[]).reduce((a,f)=>a+(Number(f.duration)||0),0)}
function uid(){return 'b'+Date.now().toString(36)+Math.random().toString(36).slice(2,7)}

let state = {
  screen:'shelf', books:[], folders:[], playlists:[], settings:{theme:'dark',threeD:true,coverSize:'Средний',autoscan:true},
  query:'', librarySort:'recent', selectedFolderIds:[], current:null, currentIndex:0, currentPos:0, blobUrl:'', playing:false, speed:1, sleepTimer:null,
  searchTimer:null
};
let scanResult=[];
let toastTimer;
let progressSaveTimer = null;
let lastPersistedPosition = 0;
const LAST_PLAYBACK_KEY = 'shelf:lastPlayback';
function readLastPlayback(){try{return JSON.parse(localStorage.getItem(LAST_PLAYBACK_KEY)||'null')}catch{return null}}
function writeLastPlayback(){if(!state.current)return;try{localStorage.setItem(LAST_PLAYBACK_KEY,JSON.stringify({bookId:state.current.id,index:state.currentIndex,pos:Number(state.currentPos)||0}))}catch{}}

async function loadState(){
  state.books=(await get('books'))||[];
  state.folders=(await get('folders'))||[];
  state.playlists=(await get('playlists'))||DEFAULT_PLAYLISTS.map(([id,name,emoji])=>({id,name,emoji,bookIds:[]}));
  state.settings={...state.settings,...((await get('settings'))||{})};
  document.documentElement.dataset.theme=state.settings.theme||'dark';
  const last=readLastPlayback();
  if(last?.bookId){const b=state.books.find(x=>x.id===last.bookId);if(b){state.current=b;state.currentIndex=Math.max(0,Math.min(Number(last.index)||0,b.files.length-1));state.currentPos=Math.max(0,(Number(last.pos)||0)-10);b.pos={...(b.pos||{}),i:state.currentIndex,t:state.currentPos};}}
  render();
  if(state.settings.autoscan && state.folders.length && isNative()) setTimeout(()=>scanAllFolders(true),500);
}
function isNative(){return !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform())}
function plugin(name){return window.Capacitor?.Plugins?.[name] || null}
async function persist(){await Promise.all([set('books',state.books),set('folders',state.folders),set('playlists',state.playlists),set('settings',state.settings)])}
function showToast(msg){clearTimeout(toastTimer);const t=$('toast');t.textContent=msg;t.classList.add('show');toastTimer=setTimeout(()=>t.classList.remove('show'),2300)}
function setScreen(screen){state.screen=screen;state.query='';if(screen==='player' && !state.current){showToast('Сначала выберите книгу на полке');state.screen='shelf'}document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.nav===state.screen));render();if(state.screen==='player'&&state.current&&!state.blobUrl)loadChapter(state.currentIndex,state.currentPos,false)}
function render(){
  if(state.screen==='shelf') renderShelf();
  if(state.screen==='player') renderCurrentPlayer();
  if(state.screen==='playlists') renderPlaylists();
  if(state.screen==='settings') renderSettings();
  bindNav();
  updateMiniPlayer();
}
function renderCurrentPlayer(){ if(state.current) renderPlayer(); else renderShelf(); }

function bindNav(){document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>setScreen(b.dataset.nav));document.querySelectorAll('[data-action]').forEach(b=>{const a=b.dataset.action;const fn={openAddSheet,openLibraryFilter,openSort,newPlaylist}[a];if(fn)b.onclick=fn});document.querySelectorAll('.nav-ico').forEach(n=>{n.innerHTML=ICONS[n.dataset.icon]||'';n.querySelectorAll('*').forEach(()=>{});n.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[n.dataset.icon]||''}</svg>`})}
function header(title,subtitle,actions=''){return `<div class="topbar"><div><h2>${title}</h2>${subtitle?`<p>${subtitle}</p>`:''}</div><div class="top-actions">${actions}</div></div>`}
function bookCover(b,extra=''){const title=escapeHtml(b.title||'Без названия');const author=escapeHtml(b.author||'');const body=b.cover?`<img class="cover-image ${extra}" src="${escapeHtml(b.cover)}" alt="" draggable="false">`:`<div class="fallback-cover ${extra}"><div class="cover-title">${title}</div>${author?`<div class="cover-author">${author}</div>`:''}</div>`;return `<div class="cover-frame">${body}</div>`}
function progress(b){const files=b.files||[];if(!files.length)return 0;const i=Math.max(0,Math.min(Number(b.pos?.i)||0,files.length-1));const t=Math.max(0,Number(b.pos?.t)||0);const d=Math.max(0,Number(files[i]?.duration)||0);return Math.max(0,Math.min(100,((i+(d?t/d:0))/files.length)*100))}
function renderShelf(){
  const books=state.books;
  let html=`<section class="screen shelf-screen shelf-hero ${state.settings.threeD?'':'flat-shelf'}">`;
  html+=header('Полка', `${books.length} ${plural(books.length,'книга','книги','книг')}`, `${iconBtn('folderPlus','Добавить книги','openAddSheet')}`);
  html+=`<div class="shelf-area">`;
  if(!books.length){html+=`<div class="shelf-empty"><div><div class="empty-art">▥</div><div>Полка пока пуста</div><div style="font-size:12px;margin-top:5px">Добавьте папку с аудиокнигами или отдельные файлы.</div><button id="emptyAdd">Добавить книги</button></div></div>`}
  else {for(let i=0;i<books.length;i+=3){html+=`<div class="shelf-row">${books.slice(i,i+3).map(bookCard).join('')}</div>`}}
  html+=`</div></section>`;
  main.innerHTML=html;
  $('emptyAdd')?.addEventListener('click',openAddSheet);
  document.querySelectorAll('.book-card').forEach(el=>el.onclick=()=>openPlayer(el.dataset.id));
}
function bookCard(b){return `<div class="book-card" data-id="${escapeHtml(b.id)}">${bookCover(b)}<div class="book-title">${escapeHtml(b.title)}</div><i class="progress" style="width:${progress(b)}%"></i></div>`}
function iconBtn(ic,label,action){return `<button class="icon-btn" aria-label="${label}" data-action="${action}">${icon(ic)}</button>`}
function plural(n,a,b,c){const x=n%10,y=n%100;return x===1&&y!==11?a:x>=2&&x<=4&&(y<10||y>=20)?b:c}

function renderLibrary(){
  const q=escapeHtml(state.query);const books=sortBooks(filterBooks(state.books));
  const html=`<section class="screen"><div class="topbar"><div><h2>Библиотека</h2><p>${state.books.length} ${plural(state.books.length,'книга','книги','книг')}</p></div><div class="top-actions">${iconBtn('filter','Фильтр','openLibraryFilter')}${iconBtn('sort','Сортировка','openSort')}</div></div>
    <label class="search">${icon('search')}<input id="librarySearch" value="${q}" placeholder="Поиск по названию, автору..." autocomplete="off"><button id="clearSearch" class="hidden">${icon('close')}</button></label>
    <div id="libraryList" class="library-list">${books.length?books.map(listRow).join(''):`<div class="shelf-empty" style="height:55vh"><div><div style="font-size:40px">⌕</div><div>${state.books.length?'Ничего не найдено':'Библиотека пуста'}</div></div></div>`}</div></section>`;
  main.innerHTML=html;
  const input=$('librarySearch');input?.addEventListener('input',e=>{state.query=e.target.value;renderLibrary();setTimeout(()=>{const x=$('librarySearch');x?.focus();x?.setSelectionRange(x.value.length,x.value.length)},0)});
  $('clearSearch')?.addEventListener('click',()=>{state.query='';renderLibrary()});
  document.querySelectorAll('.list-row[data-id]').forEach(el=>el.onclick=e=>{if(e.target.closest('.more'))return;openPlayer(el.dataset.id)});
  document.querySelectorAll('[data-book-menu]').forEach(el=>el.onclick=e=>{e.stopPropagation();openBookMenu(el.dataset.bookMenu)});
  document.querySelectorAll('[data-action="openLibraryFilter"]').forEach(el=>el.onclick=openLibraryFilter);
  document.querySelectorAll('[data-action="openSort"]').forEach(el=>el.onclick=openSort);
}
function filterBooks(books){const q=state.query.trim().toLowerCase();return q?books.filter(b=>(b.title+' '+b.author).toLowerCase().includes(q)):books}
function sortBooks(books){return [...books].sort((a,b)=>state.librarySort==='title'?a.title.localeCompare(b.title,'ru'):state.librarySort==='author'?(a.author||'').localeCompare(b.author||'','ru'):((b.added||0)-(a.added||0)))}
function listRow(b){return `<div class="list-row" data-id="${escapeHtml(b.id)}"><div class="thumb">${bookCover(b)}</div><div class="list-main"><div class="list-title">${escapeHtml(b.title)}</div><div class="list-author">${escapeHtml(b.author||'Автор не указан')}</div><div class="list-meta">${b.files.length} ${plural(b.files.length,'глава','главы','глав')} · ${fmt(durationOfBook(b))}</div></div><button class="more" data-book-menu="${escapeHtml(b.id)}">${icon('more')}</button></div>`}

function renderPlaylists(){
  const ps=state.playlists;main.innerHTML=`<section class="screen">${header('Плейлисты','Подборки и закладки',iconBtn('plus','Новый плейлист','newPlaylist'))}<div class="playlists">${ps.map((p,i)=>`<div class="playlist" data-pl="${escapeHtml(p.id)}"><div class="playlist-art">${p.emoji||'♫'}</div><div class="playlist-info"><div class="playlist-name">${escapeHtml(p.name)}</div><div class="playlist-count">${(p.bookIds||[]).length} ${plural((p.bookIds||[]).length,'аудиокнига','аудиокниги','аудиокниг')}</div></div>${icon('chevron')}</div>`).join('')}</div></section>`;
  document.querySelectorAll('.playlist[data-pl]').forEach(el=>el.onclick=()=>openPlaylist(el.dataset.pl));
  document.querySelectorAll('[data-action="newPlaylist"]').forEach(el=>el.onclick=newPlaylist);
}
ICONS.chevron='<path d="m9 18 6-6-6-6"/>';
function renderSettings(){
  const s=state.settings;const folderCount=state.folders.length;
  main.innerHTML=`<section class="screen">${header('Настройки')}
    <div class="settings-group"><p class="settings-title">Хранилище</p>
      <div class="setting" id="settingsFolders"><div class="setting-icon">${icon('folder')}</div><div class="setting-main"><div class="setting-name">Выбранные папки</div><div class="setting-desc">${folderCount} ${plural(folderCount,'папка','папки','папок')}</div></div><div class="chevron">${icon('chevron')}</div></div>
      <div class="setting" id="addFolder"><div class="setting-icon">${icon('folderPlus')}</div><div class="setting-main"><div class="setting-name">Добавить папку</div><div class="setting-desc">Музыка, Audiobooks, Книги и другие</div></div><div class="chevron">${icon('chevron')}</div></div>
    </div>
    <div class="settings-group"><p class="settings-title">Сканирование</p>
      ${settingToggle('autoscan','Автосканирование','Автоматически проверять выбранные папки',!!s.autoscan)}
      <div class="setting" id="formats"><div class="setting-icon">${icon('music')}</div><div class="setting-main"><div class="setting-name">Форматы аудио</div><div class="setting-desc">MP3, M4A, M4B, AAC, OGG, OPUS, FLAC, WAV, WMA</div></div></div>
    </div>
    <div class="settings-group"><p class="settings-title">Внешний вид</p>
      <div class="setting" id="themeSetting"><div class="setting-icon">${icon(s.theme==='light'?'sun':'moon')}</div><div class="setting-main"><div class="setting-name">Тема</div><div class="setting-desc">${s.theme==='dark'?'Тёмная':'Светлая'}</div></div><div class="setting-value">${s.theme==='dark'?'Тёмная':'Светлая'} ${icon('chevron')}</div></div>
      ${settingToggle('threeD','3D полка','Показывать реалистичную полку',!!s.threeD)}
      <div class="setting" id="coverSize"><div class="setting-icon">${icon('eye')}</div><div class="setting-main"><div class="setting-name">Размер обложек</div><div class="setting-desc">В библиотеке и списках</div></div><div class="setting-value">${escapeHtml(s.coverSize||'Средний')} ${icon('chevron')}</div></div>
    </div>
    <div class="settings-group"><p class="settings-title">О приложении</p><div class="setting"><div class="setting-icon">${icon('info')}</div><div class="setting-main"><div class="setting-name">Версия</div><div class="setting-desc">Локальная библиотека · без аккаунта</div></div><div class="setting-value">2.0.0</div></div></div>
  </section>`;
  $('settingsFolders').onclick=openFolderSheet;$('addFolder').onclick=pickFolder;
  $('formats').onclick=()=>showToast('Поддерживаются MP3, M4A, M4B, AAC, OGG, OPUS, FLAC, WAV и WMA');
  $('themeSetting').onclick=toggleTheme;$('coverSize').onclick=cycleCoverSize;
  document.querySelectorAll('[data-setting-toggle]').forEach(el=>el.onclick=async()=>{const k=el.dataset.settingToggle;state.settings[k]=!state.settings[k];await set('settings',state.settings);renderSettings()});
}
function settingToggle(k,name,desc,on){return `<div class="setting" data-setting-toggle="${k}"><div class="setting-icon">${icon(k==='autoscan'?'refresh':'eye')}</div><div class="setting-main"><div class="setting-name">${name}</div><div class="setting-desc">${desc}</div></div><div class="switch ${on?'on':''}"><i></i></div></div>`}
function toggleTheme(){state.settings.theme=state.settings.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=state.settings.theme;set('settings',state.settings);renderSettings()}
function cycleCoverSize(){const x=['Маленький','Средний','Большой'];let i=x.indexOf(state.settings.coverSize);state.settings.coverSize=x[(i+1)%x.length];set('settings',state.settings);renderSettings()}

function openLibraryFilter(){openModal(`<h3>Фильтр библиотеки</h3><div class="modal-row"><span style="flex:1">Только избранное</span><button class="switch" id="filterFav"><i></i></button></div><div class="modal-row"><span style="flex:1">Есть прогресс</span><button class="switch" id="filterProgress"><i></i></button></div><div class="modal-actions"><button class="secondary" data-close>Закрыть</button></div>`);}
function openSort(){openModal(`<h3>Сортировка</h3>${[['recent','Недавно добавленные'],['title','Название'],['author','Автор']].map(([k,n])=>`<div class="modal-row" data-sort="${k}"><span style="flex:1">${n}</span>${state.librarySort===k?'✓':''}</div>`).join('')}`);document.querySelectorAll('[data-sort]').forEach(el=>el.onclick=()=>{state.librarySort=el.dataset.sort;closeModal();renderLibrary()})}
function openShelfMenu(){openModal(`<h3>Полка</h3><div class="modal-row" id="menuScan">${icon('folder')}<span>Выбрать папки</span></div><div class="modal-row" id="menuFile">${icon('music')}<span>Добавить аудиофайлы</span></div><div class="modal-row" id="menuRescan">${icon('refresh')}<span>Проверить выбранные папки</span></div><div class="modal-actions"><button class="secondary" data-close>Закрыть</button></div>`);$('menuScan').onclick=()=>{closeModal();openFolderSheet()};$('menuFile').onclick=()=>{closeModal();pickFiles()};$('menuRescan').onclick=()=>{closeModal();scanAllFolders(false)}}
function openBookMenu(id){const b=findBook(id);if(!b)return;const fav=playlistHas('fav',id);openModal(`<h3>${escapeHtml(b.title)}</h3><div class="modal-row" id="menuPlay">${icon('play')}<span>Слушать</span></div><div class="modal-row" id="menuFav">${icon('heart')}<span>${fav?'Убрать из избранного':'Добавить в избранное'}</span></div><div class="modal-row" id="menuPlaylist">${icon('playlist')}<span>Добавить в плейлист</span></div><div class="modal-row" id="menuRename">${icon('book')}<span>Переименовать</span></div><div class="modal-row danger" id="menuDelete">${icon('trash')}<span>Удалить книгу из библиотеки</span></div>`);$('menuPlay').onclick=()=>{closeModal();openPlayer(id)};$('menuFav').onclick=()=>{togglePlaylistBook('fav',id);closeModal();render()};$('menuPlaylist').onclick=()=>openPlaylistChooser(id);$('menuRename').onclick=()=>renameBook(id);$('menuDelete').onclick=()=>deleteBook(id)}
function newPlaylist(){openModal(`<h3>Новый плейлист</h3><input class="field" id="newPlName" placeholder="Название"><div class="modal-actions"><button class="secondary" data-close>Отмена</button><button class="primary" id="newPlSave">Создать</button></div>`);$('newPlSave').onclick=async()=>{const name=$('newPlName').value.trim();if(!name)return showToast('Введите название');state.playlists.push({id:uid(),name,emoji:'♫',bookIds:[]});await set('playlists',state.playlists);closeModal();renderPlaylists()}}
function openPlaylistChooser(bookId){openModal(`<h3>Добавить в плейлист</h3>${state.playlists.map(p=>`<div class="modal-row" data-choose-pl="${escapeHtml(p.id)}"><span style="flex:1">${p.emoji||'♫'} ${escapeHtml(p.name)}</span>${(p.bookIds||[]).includes(bookId)?'✓':''}</div>`).join('')}`);document.querySelectorAll('[data-choose-pl]').forEach(el=>el.onclick=()=>{togglePlaylistBook(el.dataset.choosePl,bookId);closeModal();showToast('Плейлист обновлён')})}
function openPlaylist(id){const p=state.playlists.find(x=>x.id===id);if(!p)return;const books=(p.bookIds||[]).map(findBook).filter(Boolean);openModal(`<h3>${escapeHtml(p.name)}</h3>${books.length?books.map(b=>`<div class="modal-row" data-pl-book="${b.id}"><div style="flex:1"><b>${escapeHtml(b.title)}</b><div style="font-size:11px;color:var(--muted)">${escapeHtml(b.author||'')}</div></div>${icon('chevron')}</div>`).join(''):`<div style="padding:22px 5px;color:var(--muted);text-align:center">В этом плейлисте пока ничего нет.</div>`}<div class="modal-actions"><button class="secondary" data-close>Закрыть</button></div>`);document.querySelectorAll('[data-pl-book]').forEach(el=>el.onclick=()=>{closeModal();openPlayer(el.dataset.plBook)})}
function renameBook(id){const b=findBook(id);if(!b)return;openModal(`<h3>Переименовать</h3><input class="field" id="rename" value="${escapeHtml(b.title)}"><div class="modal-actions"><button class="secondary" data-close>Отмена</button><button class="primary" id="renameSave">Сохранить</button></div>`);$('renameSave').onclick=async()=>{const v=$('rename').value.trim();if(v){b.title=v;await set('books',state.books);closeModal();render()}}}
async function deleteBook(id){const b=findBook(id);if(!b)return;openModal(`<h3>Удалить книгу?</h3><p style="color:var(--muted);font-size:13px">«${escapeHtml(b.title)}» будет убрана из библиотеки. Исходные файлы на телефоне не удаляются.</p><div class="modal-actions"><button class="secondary" data-close>Отмена</button><button class="primary" id="deleteConfirm" style="background:var(--danger);color:#fff">Удалить</button></div>`);$('deleteConfirm').onclick=async()=>{state.books=state.books.filter(x=>x.id!==id);state.playlists.forEach(p=>p.bookIds=(p.bookIds||[]).filter(x=>x!==id));await persist();if(state.current?.id===id)closePlayer();closeModal();render()}}
function openModal(body){modalRoot.innerHTML=`<div class="modal-back" id="modalBack"><div class="modal">${body}</div></div>`;$('modalBack').addEventListener('click',e=>{if(e.target.id==='modalBack'||e.target.closest('[data-close]'))closeModal()})}
function closeModal(){modalRoot.innerHTML=''}
function findBook(id){return state.books.find(b=>b.id===id)}
function playlistHas(pid,bid){return !!state.playlists.find(p=>p.id===pid)?.bookIds?.includes(bid)}
async function togglePlaylistBook(pid,bid){const p=state.playlists.find(x=>x.id===pid);if(!p)return;p.bookIds=p.bookIds||[];p.bookIds.includes(bid)?p.bookIds=p.bookIds.filter(x=>x!==bid):p.bookIds.push(bid);await set('playlists',state.playlists)}

/* Folder and import */
function openAddSheet(){openFolderSheet(true)}
function openFolderSheet(showAdd=false){
  const folders=state.folders;const selected=folders.filter(f=>state.selectedFolderIds.includes(f.id));
  modalRoot.innerHTML=`<div class="sheet" id="folderSheet"><div class="sheet-head"><button class="sheet-close" id="folderClose">${icon('back')}</button><h2>Выбор папок</h2><span style="font-size:11px;color:var(--muted)">${selected.length} выбрано</span></div>
    <div class="scan-hero"><strong>Папки с музыкой</strong><p>Добавьте папки Music, Audiobooks, Книги или любые каталоги с аудио. Доступ к ним сохраняется на устройстве.</p></div>
    <div id="folderList">${folders.length?folders.map(folderRow).join(''):`<div style="padding:25px 4px;text-align:center;color:var(--muted)">Папки ещё не выбраны.</div>`}</div>
    <button class="primary" id="scanNow" style="margin-top:12px">${icon('refresh')} Начать сканирование</button>
    <button class="secondary" id="addFolderNow" style="margin-top:8px">${icon('folderPlus')} Добавить папку</button>
    <div class="section-title">Сканирование</div><div id="scanInfo" class="scan-hero"><strong>${selected.length} папки выбрано</strong><p>После сканирования найденные аудиофайлы будут сгруппированы по папкам в виде книг.</p></div>
    <div id="scanProgress" class="scan-progress hidden"><div class="progress-bar"><i id="scanBar"></i></div><div class="scan-text" id="scanText"></div></div>
    <div id="scanFound"></div>
  </div>`;
  $('folderClose').onclick=closeModal;$('addFolderNow').onclick=pickFolder;$('scanNow').onclick=()=>scanAllFolders(false);
  document.querySelectorAll('[data-folder]').forEach(el=>el.onclick=()=>toggleFolder(el.dataset.folder));
}
function folderRow(f){const on=state.selectedFolderIds.includes(f.id);return `<div class="folder-card ${on?'selected':''}" data-folder="${escapeHtml(f.id)}"><div class="check"></div><div class="folder-info"><div class="folder-name">${escapeHtml(f.name)}</div><div class="folder-path">${escapeHtml(f.uri)}</div></div></div>`}
async function toggleFolder(id){if(state.selectedFolderIds.includes(id))state.selectedFolderIds=state.selectedFolderIds.filter(x=>x!==id);else state.selectedFolderIds.push(id);await set('foldersSelected',state.selectedFolderIds);openFolderSheet()}
async function pickFolder(){
  const P=plugin('ShelfFiles');
  if(!P){showToast('Выбор папки доступен в Android-версии');return}
  try{const f=await P.pickFolder();if(!f?.uri)return;let old=state.folders.find(x=>x.uri===f.uri);if(!old){old={id:uid(),name:f.name||'Музыка',uri:f.uri};state.folders.push(old)}if(!state.selectedFolderIds.includes(old.id))state.selectedFolderIds.push(old.id);await persist();openFolderSheet();showToast('Папка добавлена')}
  catch(e){if(!String(e?.message||e).includes('Отмена'))showToast(e?.message||'Не удалось выбрать папку')}
}
async function scanAllFolders(silent=false){
  const P=plugin('ShelfFiles');if(!P){showToast('Сканирование папок доступно в Android-версии');return}
  const ids=state.selectedFolderIds;const folders=state.folders.filter(f=>ids.includes(f.id));if(!folders.length){showToast('Сначала выберите папку');openFolderSheet();return}
  const prog=$('scanProgress'),bar=$('scanBar'),txt=$('scanText');if(prog){prog.classList.remove('hidden');}
  scanResult=[];
  for(let i=0;i<folders.length;i++){
    if(txt)txt.textContent=`Папка ${i+1}/${folders.length}: ${folders[i].name}\nСканирование…`;
    try{const r=await P.scanFolder({uri:folders[i].uri});(r.files||[]).forEach(f=>scanResult.push({...f,folderId:folders[i].id,folderName:folders[i].name}));}catch(e){if(!silent)showToast(e?.message||'Ошибка сканирования')}
    if(bar)bar.style.width=((i+1)/folders.length*100)+'%';
  }
  const groups=new Map();scanResult.forEach(f=>{const key=f.path;const a=groups.get(key)||[];a.push(f);groups.set(key,a)});
  if(txt)txt.textContent=`Готово · ${scanResult.length} аудиофайлов · ${groups.size} папок с аудио`;
  if(!silent)renderScanFound([...groups.entries()]);
  await mergeScan([...groups.entries()]);
  if(!silent)showToast(`Сканирование завершено: ${groups.size} ${plural(groups.size,'книга','книги','книг')}`);
}
function renderScanFound(groups){const el=$('scanFound');if(!el)return;el.innerHTML=`<div class="section-title">Найдено</div>${groups.slice(0,40).map(([path,fs])=>`<div class="folder-card"><div class="setting-icon">${icon('music')}</div><div class="folder-info"><div class="folder-name">${escapeHtml(path.split('/').pop()||path)}</div><div class="folder-path">${fs.length} файлов · ${escapeHtml(path)}</div></div></div>`).join('')}`}
async function mergeScan(groups){
  for(const [path,fs] of groups){
    const existing=state.books.find(b=>b.srcPath===path);if(existing){existing.files=fs.map(toNativeFile);existing.updated=Date.now();continue}
    const first=fs[0];let tags={};
    try{const blob=await nativeFileBlob(first);tags=await readTags(blob)}catch{}
    const cover=tags.cover||'';const title=tags.album||stripExt(first.name)||path.split('/').pop()||'Новая книга';
    state.books.unshift({id:uid(),title,author:tags.artist||'',cover,files:fs.sort(naturalFile).map(toNativeFile),srcPath:path,added:Date.now(),pos:{i:0,t:0},marks:[]});
  }
  await set('books',state.books);render();
}
function toNativeFile(f){return {uri:f.uri,name:stripExt(f.name),fileName:f.name,mime:f.mime||'audio/*',size:Number(f.size)||0,modified:Number(f.modified)||0,duration:Number(f.duration)||0}}
function naturalFile(a,b){return a.name.localeCompare(b.name,'ru',{numeric:true,sensitivity:'base'})}
async function nativeFileBlob(f){const P=plugin('ShelfFiles');const r=await P.readFile({uri:f.uri});const bin=atob(r.base64);const u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return new Blob([u],{type:f.mime||'audio/*'})}
async function readTags(blob){return new Promise(resolve=>{if(!window.jsmediatags)return resolve({});try{jsmediatags.read(blob,{onSuccess:x=>{let cover='';try{const p=x.tags?.picture;if(p){const bytes=new Uint8Array(p.data);let binary='';for(let i=0;i<bytes.length;i++)binary+=String.fromCharCode(bytes[i]);cover=`data:${p.format};base64,${btoa(binary)}`}}catch{}resolve({title:x.tags?.title||'',artist:x.tags?.artist||'',album:x.tags?.album||'',cover})},onError:()=>resolve({})})}catch{resolve({})}})}
function stripExt(s=''){return s.replace(/\.[^.]+$/,'')}
async function pickFiles(){const input=document.createElement('input');input.type='file';input.multiple=true;input.accept='audio/*';input.onchange=async()=>{const fs=[...input.files].filter(f=>AUDIO_EXT.test(f.name));if(!fs.length)return;const groups=[['Выбранные файлы',fs]];for(const [path,files] of groups){let tags={};try{tags=await readTags(files[0])}catch{}const title=files.length>1?(tags.album||stripExt(files[0].name)):(tags.title||stripExt(files[0].name));const id=uid();const fdata=[];for(let i=0;i<files.length;i++){const key=`blob:${id}:${i}`;await set(key,files[i]);fdata.push({key,name:stripExt(files[i].name),fileName:files[i].name,mime:files[i].type||'audio/*',size:files[i].size,duration:0})}state.books.unshift({id,title,author:tags.artist||'',cover:tags.cover||'',files:fdata,added:Date.now(),pos:{i:0,t:0},marks:[]});}await set('books',state.books);render();showToast(`Добавлено файлов: ${fs.length}`)};input.click()}

/* Player */
async function openPlayer(id){
  const b=findBook(id);if(!b)return;
  if(state.current?.id===b.id){state.screen='player';render();if(!state.blobUrl)await loadChapter(state.currentIndex,state.currentPos,false);return;}
  if(state.current) await saveProgress();
  state.current=b;
  state.playing=false;
  state.currentIndex=Math.max(0,Math.min(Number(b.pos?.i)||0,b.files.length-1));
  const saved=Number(b.pos?.t)||0;
  state.currentPos=saved>0?Math.max(0,saved-10):0;
  state.screen='player';
  render();
  await loadChapter(state.currentIndex,state.currentPos,false);
  updateMiniPlayer();
}
function renderPlayer(){
  const b=state.current;if(!b)return;
  const i=Math.min(state.currentIndex,b.files.length-1);const f=b.files[i];
  main.innerHTML=`<section class="player" id="playerScreen">
    <div class="player-inner">
      <div class="player-top"><button class="icon-btn" id="playerBack">${icon('back')}</button><div class="top-actions"><button class="icon-btn" id="playerMark">${icon('bookmark')}</button><button class="icon-btn" id="playerMore">${icon('more')}</button></div></div>
      <div class="player-cover" id="playerCover">${bookCover(b)}</div>
      <div class="player-title">${escapeHtml(b.title)}</div>
      <div class="player-author">${escapeHtml(b.author||'Автор не указан')}</div>
      <div class="chapter">Глава ${i+1} из ${b.files.length} · ${escapeHtml(f.name)}</div>
      <div class="seek"><input id="seek" type="range" min="0" max="1000" value="0" aria-label="Позиция воспроизведения"></div>
      <div class="time-row"><span id="curTime">0:00</span><span id="durTime">${fmt(f.duration)}</span></div>
      <div class="controls">
        <button class="control" id="prevBtn" aria-label="Предыдущая глава">${icon('prev')}</button>
        <button class="control" id="backBtn" aria-label="Назад 15 секунд">${icon('rewind')}</button>
        <button class="play-main" id="playBtn" aria-label="Воспроизведение">${icon(state.playing?'pause':'play')}</button>
        <button class="control" id="forwardBtn" aria-label="Вперёд 30 секунд">${icon('forward')}</button>
        <button class="control" id="nextBtn" aria-label="Следующая глава">${icon('next')}</button>
      </div>
      <div class="player-tools"><button class="tool" id="speedBtn"><strong>${state.speed.toFixed(1)}×</strong>Скорость</button><button class="tool" id="sleepBtn"><strong>◷</strong>Таймер</button><button class="tool" id="queueBtn"><strong>☷</strong>Очередь</button><button class="tool" id="bookmarkBtn"><strong>🔖</strong>Закладка</button></div>
      <div class="chapter-list" id="chapterList">${chapterRows(b)}</div>
      <div class="swipe-hint">Свайп вправо — визуализатор</div>
    </div>
    <div class="visualizer-overlay hidden" id="visualizer" aria-hidden="true">
      <canvas id="visualizerCanvas"></canvas>
      <div class="visualizer-head"><button class="icon-btn" id="visualizerClose">${icon('back')}</button><div><strong>Визуализатор</strong><span>${escapeHtml(f.name)}</span></div></div>
      <div class="visualizer-center"><span>${icon('music')}</span><b>АУДИОКНИГИ</b></div>
    </div>
  </section>`;

  $('playerBack').onclick=closePlayer;
  $('playBtn').onclick=()=>togglePlay();
  $('prevBtn').onclick=prevTrack;
  $('nextBtn').onclick=nextTrack;
  $('backBtn').onclick=()=>seekBy(-15);
  $('forwardBtn').onclick=()=>seekBy(30);
  $('seek').oninput=e=>{if(audio.duration)audio.currentTime=audio.duration*(+e.target.value/1000)};
  $('speedBtn').onclick=cycleSpeed;$('sleepBtn').onclick=setSleep;$('bookmarkBtn').onclick=addBookmark;$('playerMark').onclick=addBookmark;
  $('queueBtn').onclick=()=>showToast('Очередь следует за порядком глав');$('playerMore').onclick=()=>openBookMenu(b.id);
  document.querySelectorAll('[data-chapter]').forEach(el=>el.onclick=()=>loadChapter(+el.dataset.chapter,0,true));
  document.querySelectorAll('[data-mark]').forEach(el=>el.onclick=()=>{const m=b.marks?.[+el.dataset.mark];if(m)loadChapter(m.i,m.t,true)});
  bindPlayerSwipe();
  updatePlayerUI();
}

function chapterRows(b){let out='';(b.marks||[]).forEach((m,k)=>{out+=`<div class="chapter-row bookmark-row" data-mark="${k}"><span>🔖 ${m.i+1}. ${escapeHtml(b.files[m.i]?.name||'Глава')} · ${fmt(m.t)}</span><span>›</span></div>`});b.files.forEach((f,i)=>out+=`<div class="chapter-row ${i===state.currentIndex?'current':''}" data-chapter="${i}"><span>${i+1}. ${escapeHtml(f.name)}</span><span>${i===state.currentIndex?(state.playing?'▶':'Ⅱ'):fmt(f.duration)}</span></div>`);return out}
async function loadChapter(i,t=0,autoplay=true){const b=state.current;if(!b||!b.files[i])return;state.currentIndex=i;state.currentPos=t||0;const f=b.files[i];let blob;try{blob=f.key?await get(f.key):await nativeFileBlob(f)}catch(e){showToast('Не удалось открыть аудиофайл');return}if(!blob){showToast('Файл недоступен');return}if(state.blobUrl)URL.revokeObjectURL(state.blobUrl);state.blobUrl=URL.createObjectURL(blob);audio.src=state.blobUrl;audio.playbackRate=state.speed;audio.onloadedmetadata=async()=>{if(state.currentPos)audio.currentTime=Math.min(state.currentPos,audio.duration||state.currentPos);f.duration=audio.duration||f.duration;await set('books',state.books);updatePlayerUI();if(autoplay)togglePlay(true)};audio.onended=()=>{if(i<b.files.length-1)loadChapter(i+1,0,true);else{b.pos={i:0,t:0};saveProgress()}};updatePlayerUI();}
async function togglePlay(forcePlay=false){
  if(!state.current)return;
  try{
    if(forcePlay || audio.paused || audio.ended){
      await ensureAudioGraph();
      if(audioContext?.state==='suspended')await audioContext.resume();
      await audio.play();
    }else{
      audio.pause();
    }
    updatePlayerUI();
  }catch(e){showToast('Не удалось изменить воспроизведение')}
}
async function ensureAudioGraph(){
  if(!audioContext){
    const AC=window.AudioContext||window.webkitAudioContext;
    if(!AC)return;
    audioContext=new AC();
    audioSource=audioContext.createMediaElementSource(audio);
    analyser=audioContext.createAnalyser();
    analyser.fftSize=256;
    analyser.smoothingTimeConstant=.82;
    audioSource.connect(analyser);
    analyser.connect(audioContext.destination);
  }
  if(audioContext.state==='suspended')await audioContext.resume();
}
function bindPlayerSwipe(){
  const player=$('playerScreen');if(!player)return;
  let sx=0,sy=0;
  player.addEventListener('pointerdown',e=>{sx=e.clientX;sy=e.clientY},{passive:true});
  player.addEventListener('pointerup',e=>{
    const dx=e.clientX-sx,dy=e.clientY-sy;
    if(Math.abs(dx)<70||Math.abs(dx)<Math.abs(dy)*1.25)return;
    if(dx>0&&!visualizerOpen)openVisualizer();
    else if(dx<0&&visualizerOpen)closeVisualizer();
  },{passive:true});
  $('visualizerClose')?.addEventListener('click',closeVisualizer);
}
function openVisualizer(){
  const el=$('visualizer');if(!el)return;
  visualizerOpen=true;el.classList.remove('hidden');el.setAttribute('aria-hidden','false');
  ensureAudioGraph().then(()=>startVisualizer()).catch(()=>showToast('Визуализатор недоступен'));
}
function closeVisualizer(){
  visualizerOpen=false;const el=$('visualizer');if(el){el.classList.add('hidden');el.setAttribute('aria-hidden','true')}
  stopVisualizer();
}
function startVisualizer(){
  const canvas=$('visualizerCanvas');if(!canvas||!analyser)return;
  stopVisualizer();
  const ctx=canvas.getContext('2d');const data=new Uint8Array(analyser.frequencyBinCount);
  const draw=()=>{
    if(!visualizerOpen){visualizerFrame=0;return}
    const dpr=Math.min(window.devicePixelRatio||1,2),w=canvas.clientWidth,h=canvas.clientHeight;
    if(canvas.width!==Math.floor(w*dpr)||canvas.height!==Math.floor(h*dpr)){canvas.width=Math.floor(w*dpr);canvas.height=Math.floor(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0)}
    analyser.getByteFrequencyData(data);ctx.clearRect(0,0,w,h);
    const bars=Math.min(72,data.length);const gap=3;const bw=Math.max(2,(w-gap*(bars-1))/bars);const maxH=h*.62;
    for(let i=0;i<bars;i++){
      const v=data[Math.floor(i*data.length/bars)]/255;const hh=Math.max(4,v*maxH);const x=i*(bw+gap);const y=h*.56-hh;
      const g=ctx.createLinearGradient(0,y,0,h*.56);g.addColorStop(0,'#ffd18a');g.addColorStop(.55,'#d99a4c');g.addColorStop(1,'rgba(217,154,76,.05)');ctx.fillStyle=g;ctx.fillRect(x,y,bw,hh);
      ctx.globalAlpha=.24;ctx.fillRect(x,h*.56,bw,hh*.55);ctx.globalAlpha=1;
    }
    ctx.beginPath();ctx.strokeStyle='rgba(255,218,166,.55)';ctx.lineWidth=1.5;
    for(let i=0;i<bars;i++){const v=data[Math.floor(i*data.length/bars)]/255;const x=i*(bw+gap)+bw/2;const y=h*.56-v*maxH*.88;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y)}ctx.stroke();
    visualizerFrame=requestAnimationFrame(draw);
  };
  draw();
}
function stopVisualizer(){if(visualizerFrame){cancelAnimationFrame(visualizerFrame);visualizerFrame=0}}

function seekBy(n){if(audio.duration)audio.currentTime=Math.max(0,Math.min(audio.duration,audio.currentTime+n))}
function prevTrack(){if(audio.currentTime>6){audio.currentTime=0}else if(state.currentIndex>0)loadChapter(state.currentIndex-1,0,true)}
function nextTrack(){if(state.currentIndex<state.current.files.length-1)loadChapter(state.currentIndex+1,0,true)}
function cycleSpeed(){const a=[.8,1,1.2,1.5,1.8,2];state.speed=a[(a.indexOf(state.speed)+1)%a.length];audio.playbackRate=state.speed;$('speedBtn')?.querySelector('strong')?.replaceChildren(document.createTextNode(state.speed.toFixed(1)+'×'));}
function setSleep(){const v=prompt('Таймер сна, минут. 0 — выключить','30');if(v===null)return;clearTimeout(state.sleepTimer);const n=Number(v);if(n>0){state.sleepTimer=setTimeout(()=>audio.pause(),n*60000);showToast(`Таймер: ${n} мин`)}else showToast('Таймер выключен')}
async function addBookmark(){const b=state.current;if(!b)return;b.marks=b.marks||[];b.marks.push({i:state.currentIndex,t:audio.currentTime||0});await set('books',state.books);renderPlayer();showToast('Закладка добавлена')}
async function saveProgress(){
  const b=state.current;if(!b)return;
  const t=Number(audio.currentTime)||Number(state.currentPos)||0;
  b.pos={i:state.currentIndex,t:Math.max(0,t)};
  state.currentPos=t;
  lastPersistedPosition=t;
  writeLastPlayback();
  try{await set('books',state.books)}catch{}
}
function scheduleProgressSave(force=false){
  if(!state.current)return;
  const t=Number(audio.currentTime)||0;
  state.currentPos=t;
  state.current.pos={i:state.currentIndex,t};
  writeLastPlayback();
  if(force){clearTimeout(progressSaveTimer);progressSaveTimer=null;saveProgress();return;}
  if(progressSaveTimer)return;
  progressSaveTimer=setTimeout(()=>{progressSaveTimer=null;saveProgress()},1200);
}
function updatePlayerUI(){if(!state.current)return;const b=state.current,f=b.files[state.currentIndex];const seek=$('seek');if(seek&&audio.duration)seek.value=(audio.currentTime/audio.duration)*1000;const ct=$('curTime'),dt=$('durTime');if(ct)ct.textContent=fmt(audio.currentTime);if(dt)dt.textContent=fmt(audio.duration||f?.duration);const p=$('playBtn');if(p)p.innerHTML=icon(state.playing?'pause':'play');const ch=document.querySelector('.chapter');if(ch)ch.textContent=`Глава ${state.currentIndex+1} из ${b.files.length} · ${f?.name||''}`;updateMiniPlayer()}
function closePlayer(){closeVisualizer();scheduleProgressSave(true);state.screen='shelf';render()}

function miniProgress(){
  if(!state.current)return 0;
  const b=state.current, i=Math.max(0,Math.min(state.currentIndex,b.files.length-1)), f=b.files[i];
  const d=Number(audio.duration)||Number(f?.duration)||0;
  return d?Math.max(0,Math.min(100,audio.currentTime/d*100)):0;
}
function updateMiniPlayer(){
  const el=$('miniPlayer');if(!el)return;
  if(!state.current || state.screen==='player'){el.classList.add('hidden');return;}
  const b=state.current, f=b.files[state.currentIndex]||{};
  el.classList.remove('hidden');
  if(el.dataset.bookId!==b.id){
    el.dataset.bookId=b.id;
    el.innerHTML=`<button class="mini-main" id="miniOpen">${bookCover(b,'mini-cover')}<span class="mini-copy"><b>${escapeHtml(b.title)}</b><small>${escapeHtml(f.name||'')}</small></span><span class="mini-play" id="miniPlay">${icon(state.playing?'pause':'play')}</span></button><div class="mini-progress"><i></i></div>`;
    $('miniOpen').onclick=()=>openPlayer(b.id);
    $('miniPlay').onclick=e=>{e.stopPropagation();togglePlay()};
  }
  const i=$('miniPlay');if(i)i.innerHTML=icon(state.playing?'pause':'play');
  const label=el.querySelector('.mini-copy small');if(label)label.textContent=f.name||'';
  const bar=el.querySelector('.mini-progress i');if(bar)bar.style.width=`${miniProgress()}%`;
}
/* Audio events + media session */
audio.addEventListener('play',async()=>{state.playing=true;updatePlayerUI();await saveProgress();setMediaSession()});
audio.addEventListener('pause',async()=>{state.playing=false;updatePlayerUI();await saveProgress();setMediaSession()});
let lastSavedSecond=-1;
audio.addEventListener('timeupdate',()=>{
  if(!state.current)return;
  state.currentPos=audio.currentTime;
  state.current.pos={i:state.currentIndex,t:audio.currentTime};
  updatePlayerUI();
  const sec=Math.floor(audio.currentTime);
  if(sec!==lastSavedSecond && sec%5===0){lastSavedSecond=sec;scheduleProgressSave();}
});
audio.addEventListener('seeking',()=>scheduleProgressSave());
audio.addEventListener('seeked',()=>scheduleProgressSave(true));
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')scheduleProgressSave(true)});
window.addEventListener('pagehide',()=>scheduleProgressSave(true));
window.addEventListener('beforeunload',()=>scheduleProgressSave(true));
audio.addEventListener('error',()=>showToast('Ошибка воспроизведения файла'));
function setMediaSession(){if(!('mediaSession' in navigator)||!state.current)return;const b=state.current,f=b.files[state.currentIndex];try{navigator.mediaSession.metadata=new MediaMetadata({title:f?.name||b.title,artist:b.author||b.title,album:b.title,artwork:b.cover?[{src:b.cover,sizes:'512x512'}]:[]});navigator.mediaSession.playbackState=state.playing?'playing':'paused';navigator.mediaSession.setActionHandler('play',()=>togglePlay(true));navigator.mediaSession.setActionHandler('pause',()=>audio.pause());navigator.mediaSession.setActionHandler('previoustrack',prevTrack);navigator.mediaSession.setActionHandler('nexttrack',nextTrack);navigator.mediaSession.setActionHandler('seekbackward',()=>seekBy(-10));navigator.mediaSession.setActionHandler('seekforward',()=>seekBy(30))}catch{}}

/* Native foreground media controls */
(function nativeBridge(){const P=plugin('Player');if(!P)return;const push=()=>{if(!state.current)return;const b=state.current,f=b.files[state.currentIndex];P.update({title:f?.name||b.title,artist:b.author||b.title,playing:state.playing,pos:audio.currentTime||0,dur:audio.duration||f?.duration||0,cover:b.cover&&b.cover.length<400000?b.cover:''}).catch(()=>{})};['play','pause','loadedmetadata','seeked','timeupdate'].forEach(ev=>audio.addEventListener(ev,()=>{if(ev!=='timeupdate'||Math.floor(audio.currentTime)%5===0)push()}));P.addListener('action',e=>{const a=e?.a;if(a==='toggle')togglePlay();else if(a==='play')togglePlay(true);else if(a==='pause')audio.pause();else if(a==='prev'||a==='back10')a==='prev'?prevTrack():seekBy(-10);else if(a==='next')nextTrack();else if(a==='forward')seekBy(30)})})()

/* Folder browser fallback */
async function browserFolderImport(){const input=document.createElement('input');input.type='file';input.webkitdirectory=true;input.multiple=true;input.onchange=async()=>{const fs=[...input.files].filter(f=>AUDIO_EXT.test(f.name));if(!fs.length)return;const groups=new Map();fs.forEach(f=>{const p=f.webkitRelativePath.split('/').slice(0,-1).join('/');(groups.get(p)||groups.set(p,[]).get(p)).push(f)});for(const [path,files] of groups){let tags={};try{tags=await readTags(files[0])}catch{}const id=uid(),fd=[];for(let i=0;i<files.length;i++){const key=`blob:${id}:${i}`;await set(key,files[i]);fd.push({key,name:stripExt(files[i].name),fileName:files[i].name,mime:files[i].type,size:files[i].size,duration:0})}state.books.unshift({id,title:tags.album||path.split('/').pop(),author:tags.artist||'',cover:tags.cover||'',files:fd,srcPath:path,added:Date.now(),pos:{i:0,t:0},marks:[]})}await set('books',state.books);render();showToast(`Импортировано: ${groups.size} ${plural(groups.size,'книга','книги','книг')}`)};input.click()}

/* Startup */
(async()=>{
  // Restore selected folder IDs separately so deleting/replacing the folder list does not erase selection state.
  state.selectedFolderIds=(await get('foldersSelected'))||[];
  document.querySelectorAll('.nav-ico').forEach(n=>n.innerHTML=`<svg viewBox="0 0 24 24">${ICONS[n.dataset.icon]||''}</svg>`);
  await loadState();
})();
