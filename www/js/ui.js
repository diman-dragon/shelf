/* ui.js — Settings (screen + its modals) */
import { state, icon, escapeHtml, plural, $, main, seekStep, DEFAULT_SEEK_STEP } from './state.js';
import { audio } from './sound.js';
import { saveSettings } from './storage.js';
import { showToast, openModal, closeModal, settingToggle, applySystemBars } from './ui-utils.js';
import { header } from './header.js';
import { openFolderSheet, pickFolder } from './scanner.js';

export function renderSettings(){
  const s = state.settings;
  const folderCount = state.folders.length;
  main.innerHTML = `<section class="screen">${header('Настройки')}
    <div class="settings-group"><p class="settings-title">Хранилище</p>
      <div class="setting" id="settingsFolders"><div class="setting-icon">${icon('folder')}</div><div class="setting-main"><div class="setting-name">Выбранные папки</div><div class="setting-desc">${folderCount} ${plural(folderCount,'папка','папки','папок')}</div></div><div class="chevron">${icon('chevron')}</div></div>
      <div class="setting" id="addFolder"><div class="setting-icon">${icon('folderPlus')}</div><div class="setting-main"><div class="setting-name">Добавить папку</div><div class="setting-desc">Папки с книгами и музыкой</div></div><div class="chevron">${icon('chevron')}</div></div>
    </div>
    <div class="settings-group"><p class="settings-title">Сканирование</p>
      <div class="setting" id="formats"><div class="setting-icon">${icon('music')}</div><div class="setting-main"><div class="setting-name">Форматы аудио</div><div class="setting-desc">MP3, M4A, M4B, AAC, OGG, OPUS, FLAC, WAV, WMA</div></div></div>
      ${settingToggle('autoscan','Автосканирование','Проверять выбранные папки при запуске',!!s.autoscan,'refresh')}
    </div>
    <div class="settings-group"><p class="settings-title">Воспроизведение</p>
      <div class="setting" id="seekSetting"><div class="setting-icon">${icon('rewind')}</div><div class="setting-main"><div class="setting-name">Шаг перемотки</div><div class="setting-desc">Кнопки «назад» и «вперёд» в плеере, уведомлении и виджете</div></div><div class="setting-value">±${seekStep()} с</div></div>
    </div>
    <div class="settings-group"><p class="settings-title">Внешний вид</p>
      <div class="setting" id="themeSetting"><div class="setting-icon">${icon(s.theme==='dark'?'moon':'sun')}</div><div class="setting-main"><div class="setting-name">Тема оформления</div><div class="setting-desc">Тёмная или светлая тема</div></div><div class="setting-value">${s.theme==='dark'?'Тёмная':'Светлая'}</div></div>
    </div>
    <div class="settings-group"><p class="settings-title">О приложении</p><div class="setting"><div class="setting-icon">${icon('info')}</div><div class="setting-main"><div class="setting-name">AudioShelf</div><div class="setting-desc">Локальная библиотека · без аккаунта</div></div><div class="setting-value">${escapeHtml(state.appVersion || '—')}</div></div>
      <div class="setting" id="privacySetting"><div class="setting-icon">${icon('info')}</div><div class="setting-main"><div class="setting-name">Политика конфиденциальности</div><div class="setting-desc">Данные не собираются и не передаются</div></div></div>
      <div class="setting" id="licensesSetting"><div class="setting-icon">${icon('info')}</div><div class="setting-main"><div class="setting-name">Лицензии открытого ПО</div><div class="setting-desc">Capacitor, AndroidX Media3, idb-keyval</div></div></div>
    </div>
  </section>`;
  $('settingsFolders').onclick = openFolderSheet;
  $('addFolder').onclick = pickFolder;
  $('formats').onclick = () => showToast('Поддерживаются MP3, M4A, M4B, AAC, OGG, OPUS, FLAC, WAV и WMA');
  $('themeSetting').onclick = toggleTheme;
  $('seekSetting').onclick = openSeekStepSheet;
  $('privacySetting').onclick = openPrivacy;
  $('licensesSetting').onclick = openLicenses;
  document.querySelectorAll('[data-setting-toggle]').forEach(el => el.onclick = async () => {
    const k = el.dataset.settingToggle;
    state.settings[k] = !state.settings[k];
    await saveSettings();
    renderSettings();
  });
}

function openPrivacy(){
  openModal(`<h3>Политика конфиденциальности</h3>
    <div style="color:var(--muted);font-size:13px;line-height:1.5;max-height:55vh;overflow:auto">
      <p><b>AudioShelf не собирает, не передаёт и не продаёт никаких данных.</b></p>
      <p>Библиотека, позиции прослушивания, закладки и настройки хранятся только на вашем устройстве.</p>
      <p>Приложение не использует аккаунты, рекламу, аналитику и сетевые запросы. Файлы выбранных вами папок читаются только для воспроизведения и сканирования, они не изменяются и не копируются.</p>
      <p>Уведомление и фоновая служба нужны только для воспроизведения и сканирования. Уведомления о звонках и других приложениях приложение не читает.</p>
      <p>Удаление приложения удаляет все его данные.</p>
    </div>
    <div class="modal-actions"><button class="primary" data-close>Закрыть</button></div>`);
}

function openLicenses(){
  openModal(`<h3>Лицензии открытого ПО</h3>
    <div style="color:var(--muted);font-size:13px;line-height:1.5;max-height:55vh;overflow:auto">
      <p><b>Capacitor</b> — MIT, © Ionic.</p>
      <p><b>AndroidX (Media3, AppCompat, Core и другие)</b> — Apache License 2.0, © Google.</p>
      <p><b>idb-keyval</b> — Apache License 2.0, © Jake Archibald.</p>
      <p>Полные тексты лицензий входят в состав этих библиотек.</p>
    </div>
    <div class="modal-actions"><button class="primary" data-close>Закрыть</button></div>`);
}

/** How many seconds the rewind / forward buttons move (default ±10). Applies everywhere: player, notification, widget. */
function openSeekStepSheet(){
  const cur = seekStep();
  const presets = [5, 10, 15, 20, 30, 60];
  openModal(`<h3>Шаг перемотки</h3>
    <p style="color:var(--muted);font-size:13px">На сколько секунд сдвигают кнопки «назад» и «вперёд». По умолчанию ${DEFAULT_SEEK_STEP} секунд.</p>
    ${presets.map(v => `<div class="modal-row" data-seek="${v}"><span style="flex:1">${v} секунд</span>${cur === v ? '✓' : ''}</div>`).join('')}
    <input class="field" id="seekCustom" type="number" min="1" max="300" inputmode="numeric" placeholder="Своё значение, от 1 до 300" value="${presets.includes(cur) ? '' : cur}">
    <div class="modal-actions"><button class="secondary" data-close>Отмена</button><button class="primary" id="seekCustomSave">Сохранить своё</button></div>`);
  document.querySelectorAll('[data-seek]').forEach(el => el.onclick = () => applySeekStep(+el.dataset.seek));
  $('seekCustomSave').onclick = () => {
    const n = Math.round(Number($('seekCustom').value));
    if(!Number.isFinite(n) || n < 1 || n > 300) return showToast('Введите число от 1 до 300');
    applySeekStep(n);
  };
}

async function applySeekStep(n){
  state.settings.seekStep = n;
  await saveSettings();
  audio.setSeekStep?.(n);                        // native: notification, lock screen, widget
  closeModal();
  renderSettings();
  showToast(`Шаг перемотки: ±${n} с`);
}

async function toggleTheme(){
  state.settings.theme = state.settings.theme==='dark'?'light':'dark';
  document.documentElement.dataset.theme = state.settings.theme;
  applySystemBars(state.settings.theme);
  await saveSettings();
  renderSettings();
}
