/* ui.js — Settings (screen + its modals) */
import { state, icon, escapeHtml, $, main, seekStep, DEFAULT_SEEK_STEP } from './state.js';
import { audio, NATIVE } from './sound.js';
import { saveSettings } from './storage.js';
import { showToast, openModal, closeModal, settingToggle, applySystemBars } from './ui-utils.js';
import { header } from './header.js';
import { isPremium } from './premium.js';
import { openPremium, openSupport, gate, statusLine } from './premium-ui.js';
import { openFolderSheet, pickFolder } from './scanner.js';
import { t, plural, getLangSetting, setLangSetting } from './i18n.js';

export function renderSettings(){
  const s = state.settings;
  if(s.normalize === undefined) s.normalize = true;            // on unless the person switched it off
  const folderCount = state.folders.length;
  const keepTop = document.querySelector('#main .screen')?.scrollTop || 0;   // a toggle redraws the page: stay where you were
  main.innerHTML = `<section class="screen">${header(t('Настройки'))}
    <div class="settings-group"><p class="settings-title">${t('Хранилище')}</p>
      <div class="setting" id="settingsFolders"><div class="setting-icon">${icon('folder')}</div><div class="setting-main"><div class="setting-name">${t('Выбранные папки')}</div><div class="setting-desc">${folderCount} ${plural(folderCount,'папка','папки','папок')}</div></div><div class="chevron">${icon('chevron')}</div></div>
      <div class="setting" id="addFolder"><div class="setting-icon">${icon('folderPlus')}</div><div class="setting-main"><div class="setting-name">${t('Добавить папку')}</div><div class="setting-desc">${t('Папки с книгами и музыкой')}</div></div><div class="chevron">${icon('chevron')}</div></div>
    </div>
    <div class="settings-group"><p class="settings-title">${t('Сканирование')}</p>
      <div class="setting" id="formats"><div class="setting-icon">${icon('music')}</div><div class="setting-main"><div class="setting-name">${t('Форматы аудио')}</div><div class="setting-desc">MP3, M4A, M4B, AAC, OGG, OPUS, FLAC, WAV, WMA</div></div></div>
      ${settingToggle('autoscan',t('Автосканирование'),t('Проверять выбранные папки при запуске'),!!s.autoscan,'refresh')}
    </div>
    <div class="settings-group"><p class="settings-title">${t('Воспроизведение')}</p>
      <div class="setting" id="seekSetting"><div class="setting-icon">${icon('rewind')}</div><div class="setting-main"><div class="setting-name">${t('Шаг перемотки')}</div><div class="setting-desc">${t('Кнопки «назад» и «вперёд» в плеере, уведомлении и виджете')}</div></div><div class="setting-value">±${seekStep()} ${t('с')}</div></div>
      ${NATIVE ? settingToggle('normalize', t('Выравнивание громкости'), t('Все файлы звучат одинаково громко. Считается в фоне, место не занимает') + (isPremium() ? '' : ' · ' + t('Премиум')), !!s.normalize && isPremium(), 'music') : ''}
    </div>
    <div class="settings-group"><p class="settings-title">${t('Премиум и поддержка')}</p>
      <div class="setting" id="premiumSetting"><div class="setting-icon">${icon('spark')}</div><div class="setting-main"><div class="setting-name">${t('Премиум')}</div><div class="setting-desc">${escapeHtml(statusLine())}</div></div><div class="chevron">${icon('chevron')}</div></div>
      <div class="setting" id="supportSetting"><div class="setting-icon">${icon('bookmark')}</div><div class="setting-main"><div class="setting-name">${t('Поддержать разработчика')}</div><div class="setting-desc">${t('Чай и котик 🐱')}</div></div><div class="chevron">${icon('chevron')}</div></div>
    </div>
    <div class="settings-group"><p class="settings-title">${t('Внешний вид')}</p>
      <div class="setting" id="themeSetting"><div class="setting-icon">${icon(s.theme==='dark'?'moon':'sun')}</div><div class="setting-main"><div class="setting-name">${t('Тема оформления')}</div><div class="setting-desc">${t('Тёмная или светлая тема')}</div></div><div class="setting-value">${t(s.theme==='dark'?'Тёмная':'Светлая')}</div></div>
      <div class="setting" id="langSetting"><div class="setting-icon">${icon('info')}</div><div class="setting-main"><div class="setting-name">${t('Язык')}</div><div class="setting-desc">${t('Язык интерфейса')}</div></div><div class="setting-value">${langName(getLangSetting())}</div></div>
    </div>
    <div class="settings-group"><p class="settings-title">${t('О приложении')}</p><div class="setting"><div class="setting-icon">${icon('info')}</div><div class="setting-main"><div class="setting-name">AudioShelf</div><div class="setting-desc">${t('Локальная библиотека · без аккаунта')}</div></div><div class="setting-value">${escapeHtml(state.appVersion || '—')}</div></div>
      <div class="setting" id="privacySetting"><div class="setting-icon">${icon('info')}</div><div class="setting-main"><div class="setting-name">${t('Политика конфиденциальности')}</div><div class="setting-desc">${t('Данные не собираются и не передаются')}</div></div></div>
      <div class="setting" id="licensesSetting"><div class="setting-icon">${icon('info')}</div><div class="setting-main"><div class="setting-name">${t('Лицензии открытого ПО')}</div><div class="setting-desc">Capacitor, Media3, Play Billing, idb-keyval</div></div></div>
    </div>
  </section>`;
  const scr = document.querySelector('#main .screen'); if(scr && keepTop) scr.scrollTop = keepTop;
  $('settingsFolders').onclick = openFolderSheet;
  $('addFolder').onclick = pickFolder;
  $('formats').onclick = () => showToast(t('Поддерживаются MP3, M4A, M4B, AAC, OGG, OPUS, FLAC, WAV и WMA'));
  $('themeSetting').onclick = toggleTheme;
  $('premiumSetting').onclick = () => openPremium();
  $('supportSetting').onclick = openSupport;
  $('langSetting').onclick = openLangSheet;
  $('seekSetting').onclick = openSeekStepSheet;
  $('privacySetting').onclick = openPrivacy;
  $('licensesSetting').onclick = openLicenses;
  document.querySelectorAll('[data-setting-toggle]').forEach(el => el.onclick = async () => {
    const k = el.dataset.settingToggle;
    if(k === 'normalize' && !gate('normalize', isPremium())) return;
    state.settings[k] = !state.settings[k];
    await saveSettings();
    if(k === 'normalize') audio.setNormalize?.(state.settings.normalize !== false && isPremium());
    renderSettings();
  });
}

const langName = v => v === 'ru' ? 'Русский' : v === 'en' ? 'English' : t('Как в телефоне');

/** Language: follows the phone by default; a change redraws the whole interface (static texts too) */
function openLangSheet(){
  const cur = getLangSetting();
  openModal(`<h3>${t('Язык')}</h3>
    ${['auto', 'ru', 'en'].map(v => `<div class="modal-row" data-lang="${v}"><span style="flex:1">${langName(v)}</span>${cur === v ? '✓' : ''}</div>`).join('')}
    <div class="modal-actions"><button class="secondary" data-close>${t('Закрыть')}</button></div>`);
  document.querySelectorAll('[data-lang]').forEach(el => el.onclick = () => {
    setLangSetting(el.dataset.lang);
    closeModal();
    renderSettings();
    showToast(t('Язык изменён'));
  });
}

function openPrivacy(){
  openModal(`<h3>${t('Политика конфиденциальности')}</h3>
    <div style="color:var(--muted);font-size:13px;line-height:1.5;max-height:55vh;overflow:auto">
      <p><b>${t('AudioShelf не собирает и не продаёт данные о вас. У приложения нет аккаунтов, аналитики и собственных серверов.')}</b></p>
      <p>${t('Библиотека, позиции прослушивания, закладки и настройки хранятся только на вашем устройстве.')}</p>
      <p>${t('Файлы выбранных вами папок читаются только для воспроизведения и сканирования: они не изменяются, не копируются и никуда не отправляются. Файл удаляется с телефона только если вы сами выберете «Удалить с диска» у трека альбома.')}</p>
      <p>${t('Премиум и добровольная поддержка оплачиваются через Google Play. Платёж и проверку покупки выполняет Google: мы не видим и не получаем ваши платёжные данные. Для этого приложение обращается к Google Play.')}</p>
      <p>${t('Участники тестирования получают Премиум навсегда по коду активации. Код проверяется на устройстве.')}</p>
      <p>${t('Сейчас в приложении нет рекламы. Если она появится, мы заранее изменим эту политику и укажем, какие данные использует рекламная сеть.')}</p>
      <p>${t('Уведомление и фоновая служба нужны только для воспроизведения и сканирования. Уведомления о звонках и других приложениях приложение не читает.')}</p>
      <p>${t('Удаление приложения удаляет все его данные.')}</p>
    </div>
    <div class="modal-actions"><button class="primary" data-close>${t('Закрыть')}</button></div>`);
}

function openLicenses(){
  openModal(`<h3>${t('Лицензии открытого ПО')}</h3>
    <div style="color:var(--muted);font-size:13px;line-height:1.5;max-height:55vh;overflow:auto">
      <p><b>Capacitor</b> — MIT, © Ionic.</p>
      <p><b>${t('AndroidX (Media3, AppCompat, Core и другие)')}</b> — Apache License 2.0, © Google.</p>
      <p><b>Google Play Billing Library, Guava</b> — Apache License 2.0, © Google.</p>
      <p><b>idb-keyval</b> — Apache License 2.0, © Jake Archibald.</p>
      <p>${t('Полные тексты лицензий входят в состав этих библиотек.')}</p>
    </div>
    <div class="modal-actions"><button class="primary" data-close>${t('Закрыть')}</button></div>`);
}

/** How many seconds the rewind / forward buttons move (default ±10). Applies everywhere: player, notification, widget. */
function openSeekStepSheet(){
  const cur = seekStep();
  const presets = [5, 10, 15, 20, 30, 60];
  openModal(`<h3>${t('Шаг перемотки')}</h3>
    <p style="color:var(--muted);font-size:13px">${t('На сколько секунд сдвигают кнопки «назад» и «вперёд». По умолчанию {n} с.', { n: DEFAULT_SEEK_STEP })}</p>
    ${presets.map(v => `<div class="modal-row" data-seek="${v}"><span style="flex:1">${v} ${t('с')}</span>${cur === v ? '✓' : ''}</div>`).join('')}
    <input class="field" id="seekCustom" type="number" min="1" max="300" inputmode="numeric" placeholder="${t('Своё значение, от 1 до 300')}" value="${presets.includes(cur) ? '' : cur}">
    <div class="modal-actions"><button class="secondary" data-close>${t('Отмена')}</button><button class="primary" id="seekCustomSave">${t('Сохранить своё')}</button></div>`);
  document.querySelectorAll('[data-seek]').forEach(el => el.onclick = () => applySeekStep(+el.dataset.seek));
  $('seekCustomSave').onclick = () => {
    const n = Math.round(Number($('seekCustom').value));
    if(!Number.isFinite(n) || n < 1 || n > 300) return showToast(t('Введите число от 1 до 300'));
    applySeekStep(n);
  };
}

async function applySeekStep(n){
  state.settings.seekStep = n;
  await saveSettings();
  audio.setSeekStep?.(n);                        // native: notification, lock screen, widget
  closeModal();
  renderSettings();
  showToast(t('Шаг перемотки: ±{n} с', { n }));
}

async function toggleTheme(){
  state.settings.theme = state.settings.theme==='dark'?'light':'dark';
  document.documentElement.dataset.theme = state.settings.theme;
  applySystemBars(state.settings.theme);
  await saveSettings();
  renderSettings();
}
