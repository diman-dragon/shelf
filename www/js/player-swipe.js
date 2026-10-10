/* player-swipe.js — horizontal swipe gesture handler (thresholds + direction lock).
 * Vertical scroll is never blocked; only a locked horizontal gesture is captured.
 * Usage: bindSwipe(rootElement, (dir, target) => { ... })   dir = 'left' | 'right'
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
  let rail = null, railLeft = 0;   // a sideways-scrolling row under the finger, and where it was scrolled to at the start

  root.addEventListener('touchstart', e => {
    active = false; mode = ''; rail = null;
    if(e.touches.length !== 1) return;
    const t = e.touches[0];
    if(t.clientX < EDGE || t.clientX > window.innerWidth - EDGE) return;
    // sliders handle their own drag; rows that scroll sideways, open modals and side panels keep their own gestures
    if(e.target.closest('input[type="range"], #modalRoot, .side-panel')) return;
    // A row that really scrolls sideways (shelves on «Для вас», filter chips) keeps its own gesture — but only while it scrolls:
    // a row that fits on the screen, or one already at its end, must not swallow the swipe (that made «Для вас» dead in places).
    const r = e.target.closest('[data-noswipe], .library-filters-bar');
    if(r && r.scrollWidth > r.clientWidth + 1){ rail = r; railLeft = r.scrollLeft; }
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
    if(mode === 'h' && !rail && e.cancelable) e.preventDefault();       // over a scrolling row the browser scrolls it itself
  }, {passive:false});

  root.addEventListener('touchend', e => {
    const wasH = active && mode === 'h';
    active = false;
    if(!wasH) return;                                      // vertical / undecided → plain scroll or tap
    if(rail && Math.abs(rail.scrollLeft - railLeft) > 2) return;   // the row scrolled: that was its swipe, not ours
    const t = e.changedTouches[0];
    if(!t) return;
    const dx = t.clientX - x0, dy = t.clientY - y0;
    if(Math.abs(dx) < MIN_DX || Math.abs(dx) < Math.abs(dy) * RATIO) return;
    if(Date.now() - t0 > MAX_MS) return;
    onSwipe(dx > 0 ? 'right' : 'left', e.target);
  }, {passive:true});

  root.addEventListener('touchcancel', () => { active = false; mode = ''; }, {passive:true});
}
