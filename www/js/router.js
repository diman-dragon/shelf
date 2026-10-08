/* router.js — screen switching + a tiny action registry.
 *
 * The screens (library, player, playlists, settings) register themselves from app.js. That lets every module call
 * render()/setScreen()/act() WITHOUT importing the screens — which is what used to create the import cycles
 * ui.js ↔ player.js ↔ library.js ↔ scanner.js.
 */
import { state } from './state.js';
import { showToast } from './ui-utils.js';

const screens = {};     // name -> { render, onEnter?, onLeave? }
const actions = {};     // name -> fn
let navBound = false;
let shown = '';         // screen that is currently drawn

export function registerScreen(name, renderFn, hooks = {}){ screens[name] = { render: renderFn, ...hooks }; }
export function registerAction(name, fn){ actions[name] = fn; }
export function act(name, ...args){ const fn = actions[name]; return fn ? fn(...args) : undefined; }

function syncNavActive(){
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.nav === state.screen));
}

export function render(){
  // leaving a screen: let it clean up while its DOM still exists (e.g. stop the visualizer loop)
  if(shown && shown !== state.screen) screens[shown]?.onLeave?.();
  shown = state.screen;
  syncNavActive();
  screens[state.screen]?.render?.();
  bindNav();
}

export function setScreen(screen){
  state.screen = screen;
  state.query = '';
  if(screen === 'player' && !state.current){ showToast('Сначала выберите книгу в библиотеке'); state.screen = 'shelf'; }
  render();
  if(state.screen === 'player') screens.player?.onEnter?.();
}

export function bindNav(){
  // Bottom nav lives outside #main — bind once with click
  if(!navBound){
    navBound = true;
    const nav = document.querySelector('.bottom-nav');
    if(nav){
      nav.addEventListener('click', e => {
        const btn = e.target.closest('[data-nav]');
        if(!btn) return;
        setScreen(btn.dataset.nav);
      }, {passive:true});
    }
  }
  // Actions inside the current screen (recreated on each render)
  document.querySelectorAll('[data-action]').forEach(b => {
    const fn = actions[b.dataset.action];
    if(fn) b.onclick = () => fn();
  });
  // SVG must never intercept taps (critical for Android WebView)
  document.querySelectorAll('button .icon, button svg, .nav-ico, .nav-ico svg').forEach(el => {
    el.style.pointerEvents = 'none';
  });
}
