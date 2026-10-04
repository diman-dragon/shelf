/* scanner.js — Folder picker, Native scan listener, file import */
import { state, icon, escapeHtml, plugin, plural, isNative, AUDIO_EXT, $ } from './state.js';
import { persist } from './storage.js';
import { openModal, closeModal, showToast, render } from './ui.js';
import { readTags } from './utils.js';
import { renderShelf } from './library.js';

const { get, set } = window.idbKeyval || {};
let nativeScanListenersReady = false;

export function openAddSheet(){ openFolderSheet(true); }

export function openFolderSheet(showAdd=false){
  const folders = state.folders;
  const selected = folders.filter(f => state.selectedFolderIds.includes(f.id));
  modalRoot.innerHTML = `<div class="modal-back" id="folderBack"><div class="sheet" id="folderSheet"><div class="sheet-head"><button class="sheet-close" id="folderClose" aria-label="Закрыть">${icon('close')}</button><h2>Выбор папок</h2><span style="font-size:11px;color:var(--muted)">${selected.length} выбрано</span></div>
    <div class="scan-hero"><strong>Папки с аудио</strong><p>Добавляйте несколько папок. Доступ к ним сохраняется на устройстве, а вложенные каталоги сканируются автоматически.</p></div>
    <div id="folderList">${folders.length?folders.map(folderRow).join(''):`<div style="padding:25px 4px;text-align:center;color:var(--muted)">Папки ещё не выбраны.</div>`}</div>
    <button class="primary" id="scanNow" style="margin-top:12px">${icon('refresh')} Сканировать выбранные</button>
    <button class="secondary" id="addFolderNow" style="margin-top:8px">${icon('folderPlus')} Добавить папку</button>
    <div class="section-title">Состояние</div><div id="scanInfo" class="scan-hero"><strong>${selected.length} ${plural(selected.length,'папка выбрана','папки выбрано','папок выбрано')}</strong><p>После сканирования приложение вернётся в библиотеку.</p></div>
    <div id="scanProgress" class="scan-progress hidden"><div class="progress-bar"><i id="scanBar"></i></div><div class="scan-text" id="scanText"></div></div>
    <div id="scanFound"></div>
  </div></div>`;

  $('folderClose').onclick = closeModal;
  $('folderBack').onclick = e => { if(e.target.id === 'folderBack') closeModal(); };
  $('addFolderNow').onclick = pickFolder;
  $('scanNow').onclick = () => scanAllFolders(false, true);

  document.querySelectorAll('[data-folder]').forEach(el => el.onclick = e => {
    if(e.target.closest('[data-folder-delete]')) return;
    toggleFolder(el.dataset.folder);
  });
  document.querySelectorAll('[data-folder-delete]').forEach(el => el.onclick = e => {
    e.stopPropagation();
    deleteFolder(el.dataset.folderDelete);
  });
}

export function folderRow(f){
  const on = state.selectedFolderIds.includes(f.id);
  return `<div class="folder-card ${on?'selected':''}" data-folder="${escapeHtml(f.id)}"><div class="check"></div><div class="folder-info"><div class="folder-name">${escapeHtml(f.name)}</div><div class="folder-path">${escapeHtml(f.uri)}</div></div><button class="folder-delete" data-folder-delete="${escapeHtml(f.id)}" aria-label="Удалить папку">${icon('trash')}</button></div>`;
}

export async function toggleFolder(id){
  state.selectedFolderIds.includes(id) ? state.selectedFolderIds = state.selectedFolderIds.filter(x => x !== id) : state.selectedFolderIds.push(id);
  await set?.('foldersSelected', state.selectedFolderIds);
  openFolderSheet();
}

export async function deleteFolder(id){
  const f = state.folders.find(x => x.id === id);
  if(!f) return;
  openModal(`<h3>Удалить папку?</h3><p style="color:var(--muted);font-size:13px">Папка «${escapeHtml(f.name)}» перестанет сканироваться. Файлы на телефоне не удаляются.</p><div class="modal-actions"><button class="secondary" data-close>Отмена</button><button class="primary" id="folderDeleteConfirm" style="background:var(--danger);color:#fff">Удалить</button></div>`);
  $('folderDeleteConfirm').onclick = async () => {
    state.folders = state.folders.filter(x => x.id !== id);
    state.selectedFolderIds = state.selectedFolderIds.filter(x => x !== id);
    state.books = state.books.filter(b => b.sourceFolderId !== id);
    state.playlists.forEach(p => p.bookIds = (p.bookIds || []).filter(bid => state.books.some(b => b.id === bid)));
    if(state.current?.sourceFolderId === id){
      audio.pause();
      if(state.blobUrl){ URL.revokeObjectURL(state.blobUrl); state.blobUrl = ''; }
      state.current = null; state.playing = false;
    }
    await persist();
    await set?.('foldersSelected', state.selectedFolderIds);
    closeModal();
    openFolderSheet();
  };
}

export async function pickFolder(){
  const P = plugin('ShelfFiles');
  if(!P){ showToast('Модуль доступа к папкам не загружен'); return; }
  try {
    const f = await P.pickFolder();
    if(!f?.uri) return;
    let old = state.folders.find(x => x.uri === f.uri);
    if(!old){ old = {id:uid(), name:f.name||'Аудиокниги', uri:f.uri}; state.folders.push(old); }
    if(!state.selectedFolderIds.includes(old.id)) state.selectedFolderIds.push(old.id);
    await persist();
    await set?.('foldersSelected', state.selectedFolderIds);
    closeModal();
    state.screen = 'shelf';
    state.scan = {active:true, total:0, processed:0, books:0, name:old.name};
    render();
    await startFolderScan(old);
  } catch(e) { showToast(e?.message || e?.errorMessage || 'Не удалось выбрать папку'); }
}

export function scanDock(){
  const p = state.scan || {};
  const pct = p.total ? Math.min(100, p.processed/p.total*100) : 8;
  return `<div class="scan-dock" id="scanDock"><div class="scan-dock-top"><span class="scan-spinner"></span><div><b>Добавляем книги</b><small>${escapeHtml(p.name||'Сканирование')} · ${p.books} книг</small></div><strong>${Math.round(pct)}%</strong></div><div class="scan-dock-bar"><i id="scanDockBar" style="width:${pct}%"></i></div><div class="scan-dock-foot">${p.processed} из ${p.total||'…'} аудиофайлов</div></div>`;
}

export async function startFolderScan(folder){
  const P = plugin('ShelfFiles');
  if(!P) return;
  try { await P.scanFolder({uri:folder.uri, folderId:folder.id, folderName:folder.name}); }
  catch(e) { state.scan.active = false; render(); showToast(e?.message || 'Не удалось начать сканирование'); }
}

export async function scanAllFolders(silent=false, returnToShelf=false){
  const ids = [...state.selectedFolderIds], folders = state.folders.filter(f => ids.includes(f.id));
  if(!folders.length){ showToast('Сначала выберите папку'); openFolderSheet(); return; }
  closeModal();
  state.screen = 'shelf';
  state.scan = {active:true, total:0, processed:0, books:0, name:folders.length===1?folders[0].name:'Сканирование папок'};
  render();
  for(const f of folders) await startFolderScan(f);
}

export function initNativeScanListeners(){
  if(nativeScanListenersReady || !isNative()) return;
  const P = plugin('ShelfFiles');
  if(!P?.addListener) return;
  nativeScanListenersReady = true;

  P.addListener('scanStarted', e => {
    state.scan.active = true;
    state.scan.total = Number(e.totalFiles) || 0;
    state.scan.processed = 0;
    state.scan.books = 0;
    state.scan.name = e.folderName || 'Сканирование';
    updateScanDock();
  });

  P.addListener('scanBook', async e => {
    const folder = state.folders.find(f => f.id === e.folderId);
    if(!folder) return;
    const fs = (e.files || []).map(f => ({...f, folderId: e.folderId, folderName: e.folderName}));
    if(!fs.length) return;
    const files = fs.sort(naturalFile).map(toNativeFile);
    const first = files[0];
    const path = String(e.path || '');
    const title = path ? path.split('/').pop() : stripExt(first?.name || e.title || folder.name);
    const book = {id:uid(), title:stripExt(e.title || title), author:'', cover:'', files, srcPath:`${folder.id}:${path}`, sourceFolderId:folder.id, added:Date.now(), pos:{i:0,t:0}, marks:[]};
    state.books.unshift(book);
    state.scan.books++;
    await set?.('books', state.books);
    if(state.screen === 'shelf') renderShelf();
    updateScanDock();
  });

  P.addListener('scanProgress', e => {
    state.scan.total = Number(e.totalFiles) || state.scan.total;
    state.scan.processed = Number(e.processedFiles) || 0;
    state.scan.books = Number(e.books) || state.scan.books;
    updateScanDock();
  });

  P.addListener('scanComplete', e => {
    state.scan.total = Number(e.totalFiles) || state.scan.total;
    state.scan.processed = Number(e.processedFiles) || state.scan.total;
    state.scan.books = Number(e.books) || state.scan.books;
    updateScanDock();
    setTimeout(() => { state.scan.active = false; render(); showToast(`Добавлено книг: ${state.scan.books}`); }, 650);
  });

  P.addListener('scanError', e => {
    state.scan.active = false;
    render();
    showToast(e?.message || 'Ошибка фонового сканирования');
  });
}

export function updateScanDock(){
  const el = $('scanDock');
  if(!el){ if(state.scan.active && state.screen === 'shelf') renderShelf(); return; }
  const p = state.scan, pct = p.total ? Math.min(100, p.processed/p.total*100) : 8;
  const bar = $('scanDockBar'); if(bar) bar.style.width = pct+'%';
  const foot = el.querySelector('.scan-dock-foot'); if(foot) foot.textContent = `${p.processed} из ${p.total||'…'} аудиофайлов`;
  const small = el.querySelector('small'); if(small) small.textContent = `${p.name||'Сканирование'} · ${p.books} книг`;
  const strong = el.querySelector('.scan-dock-top>strong'); if(strong) strong.textContent = Math.round(pct)+'%';
}

export function toNativeFile(f){
  return {
    uri: f.uri,
    name: stripExt(f.name),
    fileName: f.name,
    mime: f.mime || f.mimeType || 'audio/*',
    size: Number(f.size) || 0,
    modified: Number(f.modified || f.lastModified) || 0,
    duration: Number(f.duration) || 0,
    album: f.album || '',
    title: f.title || '',
    artist: f.artist || '',
    tags: {album:'', title:'', artist:'', cover:''},
    sound: {preset:'flat', volume:Number(state.settings.volume??1), bass:Number(state.settings.bass)||0, treble:Number(state.settings.treble)||0}
  };
}

export function naturalFile(a, b){
  return a.name.localeCompare(b.name, 'ru', {numeric:true, sensitivity:'base'});
}

export function stripExt(s=''){ return s.replace(/\.[^.]+$/, ''); }

export async function pickFiles(){
  const input = document.createElement('input');
  input.type = 'file'; input.multiple = true; input.accept = 'audio/*';
  input.onchange = async () => {
    const fs = [...input.files].filter(f => AUDIO_EXT.test(f.name));
    if(!fs.length) return;
    const groups = [['Выбранные файлы', fs]];
    for(const [path, files] of groups){
      let tags = {};
      try { tags = await readTags(files[0]); } catch {}
      const title = files.length > 1 ? (tags.album || stripExt(files[0].name)) : (tags.title || stripExt(files[0].name));
      const id = uid();
      const fdata = [];
      for(let i=0; i<files.length; i++){
        const key = `blob:${id}:${i}`;
        await set?.(key, files[i]);
        fdata.push({key, name:stripExt(files[i].name), fileName:files[i].name, mime:files[i].type||'audio/*', size:files[i].size, duration:0});
      }
      state.books.unshift({id, title, author:tags.artist||'', cover:tags.cover||'', files:fdata, added:Date.now(), pos:{i:0,t:0}, marks:[]});
    }
    await set?.('books', state.books);
    render();
    showToast(`Добавлено файлов: ${fs.length}`);
  };
  input.click();
}
