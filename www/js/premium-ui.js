/* premium-ui.js — the "Premium" sheet, the "Support" sheet and the gate that premium features go through. */
import { t } from './i18n.js';
import { escapeHtml, $ } from './state.js';
import { openModal, closeModal, showToast } from './ui-utils.js';
import { status, trialDaysLeft, redeem, PRODUCTS } from './premium.js';
import { billingAvailable, loadProducts, buy, syncPurchases, onPurchase } from './billing.js';

const FALLBACK_PRICE = '4,99 €';
const TIP_LOOK = {
  tip_tea:       { ico: '🍵', name: 'Чашка чая' },
  tip_cat_treat: { ico: '🐱', name: 'Лакомство для котика' },
  tip_cat_food:  { ico: '🐟', name: 'Корм для котика' }
};
const PERKS = [
  ['sound', 'Эквалайзер и пресеты звука'],
  ['boost', 'Усиление громкости до 300 %'],
  ['normalize', 'Выравнивание громкости файлов'],
  ['visualizer', 'Визуализаторы под музыку']
];

let products = null;                                   // [{id, price, title}] from Google Play, null = unknown yet
const priceOf = id => products?.find(p => p.id === id)?.price || '';
async function ensureProducts(){ if(!products) products = await loadProducts(); return products; }

export function statusLine(){
  const s = status();
  if(s === 'owned') return t('Премиум активен. Спасибо!');
  if(s === 'trial') return t('Пробный период: осталось {n} дн.', { n: trialDaysLeft() });
  return t('Пробный период закончился');
}

/** The one door every premium feature goes through: true = go ahead, false = the Premium sheet was shown instead.
 *  The sheet opens the first time per launch; after that a short toast, so a swipe or a tap never nags twice in a row. */
const shown = new Set();
export function gate(feature, ok){
  if(ok) return true;
  if(shown.has(feature)) showToast(t('Это функция Премиум'));
  else { shown.add(feature); openPremium(feature); }
  return false;
}

export async function openPremium(feature = ''){
  const s = status();
  const perks = PERKS.map(([f, text]) => `<div class="pm-perk${f === feature ? ' hot' : ''}"><span>✓</span><b>${t(text)}</b></div>`).join('');
  const price = priceOf(PRODUCTS.premium) || FALLBACK_PRICE;
  openModal(`<h3>${t('Премиум')}</h3>
    <p class="pm-status">${escapeHtml(statusLine())}</p>
    <div class="pm-perks">${perks}</div>
    <p class="pm-note">${t('Один платёж, без подписки. Навсегда и на все ваши книги. Воспроизведение, библиотека и закладки бесплатны всегда.')}</p>
    ${s === 'owned' ? '' : `<button class="primary" id="pmBuy" style="width:100%;margin-top:10px">${t('Купить Премиум за {price}', { price })}</button>
    <div class="pm-row"><button class="secondary" id="pmRestore">${t('Восстановить покупку')}</button><button class="secondary" id="pmCode">${t('У меня есть код')}</button></div>`}
    <div class="modal-actions"><button class="secondary" data-close>${t('Закрыть')}</button></div>`);
  if(s === 'owned') return;
  $('pmBuy').onclick = async () => {
    if(!billingAvailable()){ showToast(t('Google Play недоступен на этом устройстве')); return; }
    const r = await buy(PRODUCTS.premium);
    if(!r.ok) showToast(t('Не удалось начать оплату'));
  };
  $('pmRestore').onclick = async () => {
    if(!billingAvailable()){ showToast(t('Google Play недоступен на этом устройстве')); return; }
    const ok = await syncPurchases();
    if(!ok) showToast(t('Не удалось связаться с Google Play'));
    else if(status() === 'owned'){ closeModal(); showToast(t('Покупка восстановлена. Спасибо!')); }
    else showToast(t('Покупок не найдено'));
  };
  $('pmCode').onclick = () => openCode();
  ensureProducts().then(() => { const b = $('pmBuy'); if(b && priceOf(PRODUCTS.premium)) b.textContent = t('Купить Премиум за {price}', { price: priceOf(PRODUCTS.premium) }); });
}

function openCode(){
  openModal(`<h3>${t('Код активации')}</h3>
    <p class="pm-note">${t('Код выдают участникам тестирования. Он открывает Премиум навсегда.')}</p>
    <input class="field" id="pmCodeInput" placeholder="XXXX-XXXX-XXXX" autocapitalize="characters" autocomplete="off" spellcheck="false">
    <div class="modal-actions"><button class="secondary" data-close>${t('Отмена')}</button><button class="primary" id="pmCodeOk">${t('Активировать')}</button></div>`);
  $('pmCodeOk').onclick = async () => {
    if(await redeem($('pmCodeInput').value)){ closeModal(); showToast(t('Премиум включён навсегда. Спасибо!')); }
    else showToast(t('Код не подошёл'));
  };
}

export async function openSupport(){
  const ids = PRODUCTS.tips;
  const rows = () => ids.map(id => `<button class="pm-tip" data-tip="${id}"><span class="pm-tip-ico">${TIP_LOOK[id]?.ico || '☕'}</span><b>${t(TIP_LOOK[id]?.name || 'Поддержка')}</b><em>${escapeHtml(priceOf(id) || '')}</em></button>`).join('');
  openModal(`<h3>${t('Поддержать разработчика')}</h3>
    <div class="cat-wrap" id="catWrap">
      <div class="cat-say" id="catSay">${t('Мяу… а на чай не найдётся?')}</div>
      <svg class="cat" viewBox="0 0 230 178" role="img" aria-label="${t('Котик просит на чай')}">
        <g class="cat-tail"><path d="M58 150c-30 2-44-14-34-34 6-12 18-8 14 2-4 10 2 18 22 20z" fill="#c98a4b"/><path d="M26 122c3-6 9-6 12-2" stroke="#8a5a2b" stroke-width="4" fill="none" stroke-linecap="round"/></g>
        <g class="cat-body">
          <ellipse cx="100" cy="136" rx="46" ry="38" fill="#d99a58"/>
          <ellipse cx="100" cy="142" rx="26" ry="26" fill="#f3d9b1"/>
          <ellipse cx="78" cy="170" rx="15" ry="7" fill="#f3d9b1"/><ellipse cx="122" cy="170" rx="15" ry="7" fill="#f3d9b1"/>
        </g>
        <g class="cat-head">
          <path d="M66 62 70 24 96 46z" fill="#d99a58"/><path d="M134 62 130 24 104 46z" fill="#d99a58"/>
          <path d="M72 54 74 34 88 46z" fill="#f0a9a0"/><path d="M128 54 126 34 112 46z" fill="#f0a9a0"/>
          <circle cx="100" cy="76" r="38" fill="#d99a58"/>
          <path d="M92 40c2 6 2 10 0 16M100 38v18M108 40c-2 6-2 10 0 16" stroke="#b9772f" stroke-width="3.2" stroke-linecap="round" fill="none"/>
          <ellipse cx="100" cy="90" rx="19" ry="14" fill="#f3d9b1"/>
          <g class="eyes-open"><ellipse class="cat-eye" cx="85" cy="74" rx="5.5" ry="7" fill="#2a1b10"/><ellipse class="cat-eye" cx="115" cy="74" rx="5.5" ry="7" fill="#2a1b10"/><circle cx="87" cy="71" r="2" fill="#fff"/><circle cx="117" cy="71" r="2" fill="#fff"/></g>
          <g class="eyes-happy"><path d="M79 76q6-9 12 0M109 76q6-9 12 0" stroke="#2a1b10" stroke-width="3.4" fill="none" stroke-linecap="round"/></g>
          <ellipse cx="72" cy="88" rx="6" ry="4" fill="#f0a9a0" opacity=".55"/><ellipse cx="128" cy="88" rx="6" ry="4" fill="#f0a9a0" opacity=".55"/>
          <path d="M96 86h8l-4 5z" fill="#d46b6b"/>
          <path class="mouth-sad" d="M92 98q8-6 16 0" stroke="#5a3a20" stroke-width="2.6" fill="none" stroke-linecap="round"/>
          <path class="mouth-happy" d="M90 94q10 12 20 0" stroke="#5a3a20" stroke-width="2.6" fill="#8a3b3b" stroke-linecap="round"/>
          <g stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".85"><path d="M78 90 54 86M78 94 54 98M122 90 146 86M122 94 146 98"/></g>
        </g>
        <g class="cat-paw"><ellipse cx="146" cy="128" rx="9" ry="14" fill="#d99a58" transform="rotate(-24 146 128)"/><ellipse cx="150" cy="118" rx="6" ry="5" fill="#f3d9b1"/></g>
        <g class="cat-cup">
          <path class="steam s1" d="M176 96c-6-8 6-12 0-20" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/>
          <path class="steam s2" d="M190 98c-6-8 6-12 0-20" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/>
          <path d="M162 108h44c0 22-8 34-22 34s-22-12-22-34z" fill="#f4f1ea"/><path d="M162 108h44" stroke="#c9c2b4" stroke-width="3"/>
          <path d="M206 114c14-2 14 18-2 18" stroke="#f4f1ea" stroke-width="5" fill="none" stroke-linecap="round"/>
          <ellipse cx="184" cy="108" rx="20" ry="4" fill="#b5702f"/>
          <ellipse cx="184" cy="147" rx="30" ry="5" fill="#e3ded2"/>
          <path d="M172 122h24" stroke="#d96a6a" stroke-width="3" stroke-linecap="round" opacity=".7"/>
        </g>
        <g class="hearts" fill="#e8657a"><path class="h1" d="M96 40c-6-8-14 2-6 8l6 5 6-5c8-6 0-16-6-8z" transform="translate(-8 0)"/><path class="h2" d="M96 40c-6-8-14 2-6 8l6 5 6-5c8-6 0-16-6-8z" transform="translate(28 6) scale(.8)"/><path class="h3" d="M96 40c-6-8-14 2-6 8l6 5 6-5c8-6 0-16-6-8z" transform="translate(-34 12) scale(.7)"/></g>
      </svg>
    </div>
    <p class="pm-note">${t('Приложение делает один человек. Если оно вам нравится, можно угостить автора чаем или порадовать котика. Ничего не открывается и не меняется, это просто «спасибо».')}</p>
    <div class="pm-tips" id="pmTips">${rows()}</div>
    <div class="modal-actions"><button class="secondary" data-close>${t('Закрыть')}</button></div>`);
  const bind = () => document.querySelectorAll('[data-tip]').forEach(b => b.onclick = async () => {
    if(!billingAvailable()){ showToast(t('Google Play недоступен на этом устройстве')); return; }
    const r = await buy(b.dataset.tip);
    if(!r.ok) showToast(t('Не удалось начать оплату'));
  });
  bind();
  const wrap = $('catWrap');
  if(wrap) wrap.onclick = () => catPurr(t('Мур-мур…'), 1800);       // a tap on the cat: it purrs for a moment
  if(await ensureProducts()){ const host = $('pmTips'); if(host){ host.innerHTML = rows(); bind(); } }
}

/** The cat is happy for a while (hearts, closed eyes, a purr in the bubble), then asks again */
let purrTimer = 0;
export function catPurr(text, ms){
  const wrap = $('catWrap'), say = $('catSay');
  if(!wrap) return;
  wrap.classList.add('happy');
  if(say) say.textContent = text;
  clearTimeout(purrTimer);
  purrTimer = setTimeout(() => {
    wrap.classList.remove('happy');
    const s = $('catSay'); if(s) s.textContent = t('Мяу… а на чай не найдётся?');
  }, ms);
}

/** One quiet listener for the whole app: thanks after a payment, a note for a pending one */
let wired = false;
export function wirePurchaseMessages(){
  if(wired) return;
  wired = true;
  onPurchase(e => {
    if(e.status === 'purchased'){
      if(e.id === PRODUCTS.premium){ closeModal(); showToast(t('Премиум включён навсегда. Спасибо!')); }
      else { catPurr(t('Мур-мур! Спасибо!'), 5000); showToast(t(e.id === 'tip_tea' ? 'Спасибо за чай! 🍵' : 'Мур! Спасибо, котик доволен 🐱')); }   // the sheet stays open: the cat says thanks
    } else if(e.status === 'pending') showToast(t('Оплата ожидает подтверждения'));
    else if(e.status === 'error') showToast(t('Оплата не прошла'));
  });
}

