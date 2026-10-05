/* player-swipe.js — horizontal swipe gesture for the player screen (thresholds + direction lock).
 * Vertical scroll is never blocked; only a locked horizontal gesture is captured.
 * Usage: bindSwipe(rootElement, dir => { ... })   dir = 'left' | 'right'
 */
const MIN_DX = 70;      // px the finger must travel horizontally
const LOCK_PX = 12;     // movement needed before the gesture direction is decided
const RATIO = 1.8;      // |dx| must dominate |dy| by this factor
const MAX_MS = 900;     // slower drags are not swipes
const EDGE = 22;        // keep Android system back-gesture zones free

export function bindSwipe(root, onSwipe){
  if(!root || root.dataset.swipeBound) return;
  root.dataset.swipeBound = '1';

  let x0 = 0, y0 = 0, t0 = 0, active = false, mode = '';

  root.addEventListener('touchstart', e => {
    active = false; mode = '';
    if(e.touches.length !== 1) return;
    const t = e.touches[0];
    if(t.clientX < EDGE || t.clientX > window.innerWidth - EDGE) return;
    if(e.target.closest('input[type="range"]')) return;   // sliders handle their own drag
    x0 = t.clientX; y0 = t.clientY; t0 = Date.now(); active = true;
  }, {passive:true});

  root.addEventListener('touchmove', e => {
    if(!active) return;
    const t = e.touches[0];
    if(!t) return;
    const dx = t.clientX - x0, dy = t.clientY - y0;
    if(!mode){
      if(Math.abs(dx) < LOCK_PX && Math.abs(dy) < LOCK_PX) return;
      mode = Math.abs(dx) > Math.abs(dy) * RATIO ? 'h' : 'v';
    }
    if(mode === 'h' && e.cancelable) e.preventDefault();
  }, {passive:false});

  root.addEventListener('touchend', e => {
    const wasH = active && mode === 'h';
    active = false;
    if(!wasH) return;                                      // vertical / undecided → plain scroll or tap
    const t = e.changedTouches[0];
    if(!t) return;
    const dx = t.clientX - x0, dy = t.clientY - y0;
    if(Math.abs(dx) < MIN_DX || Math.abs(dx) < Math.abs(dy) * RATIO) return;
    if(Date.now() - t0 > MAX_MS) return;
    onSwipe(dx > 0 ? 'right' : 'left');
  }, {passive:true});

  root.addEventListener('touchcancel', () => { active = false; mode = ''; }, {passive:true});
}
