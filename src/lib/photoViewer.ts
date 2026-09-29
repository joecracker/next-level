/* ════════════════════════════════════════════════════════════════════════
   photoViewer.ts — small floating, view-only photo window.

   Used by the Reference Rail: tapping a photo there is a look-up, not an
   edit — the markup already happened (or didn't need to). This opens the
   photo as a small draggable/resizable window that floats over the canvas
   ("taped to the desk") so you can keep drawing while glancing at it.

   ONE AT A TIME: calling openPhotoViewer() again swaps the image into the
   SAME window (keeps wherever you dragged/sized it) rather than opening a
   second one. Closing with X resets position/size back to the default for
   next time.

   Resize three ways: pinch (two-finger), the corner handle (mouse/pen), or
   the +/- buttons. No drawing tools live here — for that, Photo Booth
   (photoBooth.ts) is still the way, reached via the small ✏️ edit button.
   ════════════════════════════════════════════════════════════════════════ */

export interface PhotoViewerOptions {
  imageBlob: Blob;
  caption?: string;
  onEdit?: () => void; // optional: hands off to Photo Booth for this same photo
}

const MIN_SIZE = 130;
const MAX_SIZE = 640;
const DEFAULT_LONG_EDGE = 320;

let injected = false;
let currentObjectURL: string | null = null;
let sized = false; // has the user already dragged/resized this session?

function injectStyles() {
  if (injected) return;
  injected = true;
  const css = `
  #pv-window{position:fixed;z-index:8000;display:none;flex-direction:column;
    background:rgba(24,24,28,0.97);border-radius:12px;overflow:hidden;
    box-shadow:0 10px 32px rgba(0,0,0,0.45);border:1px solid rgba(255,255,255,0.12);
    touch-action:none;}
  #pv-window.show{display:flex;}
  #pv-header{flex:none;display:flex;align-items:center;gap:6px;padding:6px 6px 6px 10px;
    background:rgba(255,255,255,0.06);cursor:grab;-webkit-user-select:none;user-select:none;}
  #pv-header:active{cursor:grabbing;}
  #pv-caption{flex:1;font:600 12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    color:#f4f4f2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .pv-btn{flex:none;width:26px;height:26px;border-radius:7px;border:none;
    background:rgba(255,255,255,0.1);color:#f4f4f2;font-size:14px;line-height:1;
    display:flex;align-items:center;justify-content:center;cursor:pointer;
    -webkit-tap-highlight-color:transparent;}
  .pv-btn:active{filter:brightness(1.25);}
  #pv-close{background:rgba(232,92,74,0.18);color:#e85c4a;font-size:16px;font-weight:700;}
  #pv-body{flex:1;position:relative;background:#0b0b0c;min-height:0;}
  #pv-img{width:100%;height:100%;object-fit:contain;-webkit-user-drag:none;pointer-events:none;}
  #pv-resize{position:absolute;right:2px;bottom:2px;width:20px;height:20px;cursor:nwse-resize;
    color:rgba(255,255,255,0.35);}
  #pv-resize svg{width:100%;height:100%;}`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}

const WINDOW_HTML = `
  <div id="pv-header">
    <span id="pv-caption"></span>
    <button class="pv-btn" id="pv-zoom-out" title="Smaller">&minus;</button>
    <button class="pv-btn" id="pv-zoom-in" title="Bigger">&plus;</button>
    <button class="pv-btn" id="pv-edit" title="Mark up this photo" style="display:none;">&#9998;</button>
    <button class="pv-btn" id="pv-close" title="Close">&times;</button>
  </div>
  <div id="pv-body">
    <img id="pv-img" alt="Photo" />
    <div id="pv-resize" title="Drag to resize">
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 3v14H3"/><path d="M12 17h5v-5"/></svg>
    </div>
  </div>`;

let win: HTMLDivElement | null = null;
let img: HTMLImageElement | null = null;
let captionEl: HTMLSpanElement | null = null;
let editBtn: HTMLButtonElement | null = null;

let rect = { x: 0, y: 0, w: DEFAULT_LONG_EDGE, h: DEFAULT_LONG_EDGE * 0.8 };
const activePointers = new Map<number, { x: number; y: number }>();
let mode: 'idle' | 'drag' | 'pinch' | 'corner' = 'idle';
let dragOffset = { x: 0, y: 0 };
let pinchStartDist = 0;
let pinchStartRect = { ...rect };
let cornerStart = { x: 0, y: 0, w: 0, h: 0 };

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }

function applyRect() {
  if (!win) return;
  rect.w = clamp(rect.w, MIN_SIZE, Math.min(MAX_SIZE, window.innerWidth * 0.92));
  rect.h = clamp(rect.h, MIN_SIZE, Math.min(MAX_SIZE, window.innerHeight * 0.85));
  rect.x = clamp(rect.x, 4, window.innerWidth - rect.w - 4);
  rect.y = clamp(rect.y, 4, window.innerHeight - rect.h - 4);
  win.style.left = rect.x + 'px';
  win.style.top = rect.y + 'px';
  win.style.width = rect.w + 'px';
  win.style.height = rect.h + 'px';
}

function defaultRectFor(imgEl: HTMLImageElement) {
  const iw = imgEl.naturalWidth || 1, ih = imgEl.naturalHeight || 1;
  const ar = iw / ih;
  let w: number, h: number;
  if (ar >= 1) { w = DEFAULT_LONG_EDGE; h = DEFAULT_LONG_EDGE / ar; }
  else { h = DEFAULT_LONG_EDGE; w = DEFAULT_LONG_EDGE * ar; }
  const headerH = 38;
  return {
    w: clamp(w, MIN_SIZE, MAX_SIZE),
    h: clamp(h + headerH, MIN_SIZE, MAX_SIZE),
    x: Math.max(20, window.innerWidth / 2 - w / 2),
    y: 90,
  };
}

function ensureBuilt() {
  if (win) return;
  win = document.createElement('div');
  win.id = 'pv-window';
  win.innerHTML = WINDOW_HTML;
  document.body.appendChild(win);
  img = win.querySelector('#pv-img') as HTMLImageElement;
  captionEl = win.querySelector('#pv-caption') as HTMLSpanElement;
  editBtn = win.querySelector('#pv-edit') as HTMLButtonElement;

  const header = win.querySelector('#pv-header') as HTMLDivElement;
  const body = win.querySelector('#pv-body') as HTMLDivElement;
  const resizeHandle = win.querySelector('#pv-resize') as HTMLDivElement;

  // ── drag (header) + pinch (anywhere on the window) via unified pointer map ──
  // IMPORTANT: if the pointerdown started on a button, bail out before doing
  // anything — otherwise setPointerCapture() below hijacks the whole
  // pointerdown/up sequence and the browser never fires a real 'click' on
  // the button underneath. This was silently eating the +/- and header taps.
  const onPointerDown = (e: PointerEvent, fromHeader: boolean) => {
    if ((e.target as HTMLElement).closest('button')) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointers.size === 1 && fromHeader) {
      mode = 'drag';
      dragOffset = { x: e.clientX - rect.x, y: e.clientY - rect.y };
    } else if (activePointers.size === 2) {
      mode = 'pinch';
      const pts = Array.from(activePointers.values());
      pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      pinchStartRect = { ...rect };
    }
  };
  header.addEventListener('pointerdown', (e) => onPointerDown(e, true));
  body.addEventListener('pointerdown', (e) => onPointerDown(e, false));

  const onMove = (e: PointerEvent) => {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (mode === 'drag' && activePointers.size === 1) {
      rect.x = e.clientX - dragOffset.x;
      rect.y = e.clientY - dragOffset.y;
      applyRect();
    } else if (mode === 'pinch' && activePointers.size === 2) {
      const pts = Array.from(activePointers.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      const scale = dist / pinchStartDist;
      const cx = pinchStartRect.x + pinchStartRect.w / 2;
      const cy = pinchStartRect.y + pinchStartRect.h / 2;
      const nw = pinchStartRect.w * scale;
      const nh = pinchStartRect.h * scale;
      rect = { w: nw, h: nh, x: cx - nw / 2, y: cy - nh / 2 };
      sized = true;
      applyRect();
    }
  };
  const onUp = (e: PointerEvent) => {
    activePointers.delete(e.pointerId);
    if (mode === 'drag') sized = true; // dragged at least once — stop auto-defaulting position/size
    if (activePointers.size === 0) mode = 'idle';
    else if (activePointers.size === 1) {
      // dropped from pinch to a single finger — hand off to drag using that finger
      const pt = Array.from(activePointers.values())[0];
      mode = 'drag';
      dragOffset = { x: pt.x - rect.x, y: pt.y - rect.y };
    }
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

  // ── corner resize handle (mouse/pen precision) ──
  resizeHandle.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    resizeHandle.setPointerCapture?.(e.pointerId);
    mode = 'corner';
    cornerStart = { x: e.clientX, y: e.clientY, w: rect.w, h: rect.h };
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  });
  resizeHandle.addEventListener('pointermove', (e) => {
    if (mode !== 'corner' || !activePointers.has(e.pointerId)) return;
    rect.w = cornerStart.w + (e.clientX - cornerStart.x);
    rect.h = cornerStart.h + (e.clientY - cornerStart.y);
    sized = true;
    applyRect();
  });
  const endCorner = (e: PointerEvent) => {
    if (mode === 'corner') { mode = 'idle'; activePointers.delete(e.pointerId); }
  };
  resizeHandle.addEventListener('pointerup', endCorner);
  resizeHandle.addEventListener('pointercancel', endCorner);

  // ── +/- buttons (fallback, no pinch needed) ──
  const stepZoom = (dir: 1 | -1) => {
    const factor = 1.18;
    const nw = dir > 0 ? rect.w * factor : rect.w / factor;
    const nh = dir > 0 ? rect.h * factor : rect.h / factor;
    const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
    rect = { w: nw, h: nh, x: cx - nw / 2, y: cy - nh / 2 };
    sized = true;
    applyRect();
  };
  win.querySelector('#pv-zoom-in')?.addEventListener('click', () => stepZoom(1));
  win.querySelector('#pv-zoom-out')?.addEventListener('click', () => stepZoom(-1));

  win.querySelector('#pv-close')?.addEventListener('click', closePhotoViewer);
  editBtn.addEventListener('click', () => { currentEditCb?.(); });
}

let currentEditCb: (() => void) | undefined;

export function openPhotoViewer(opts: PhotoViewerOptions): void {
  injectStyles();
  ensureBuilt();
  if (!win || !img || !captionEl || !editBtn) return;

  if (currentObjectURL) URL.revokeObjectURL(currentObjectURL);
  currentObjectURL = URL.createObjectURL(opts.imageBlob);

  captionEl.textContent = opts.caption?.trim() || 'Photo';
  currentEditCb = opts.onEdit;
  editBtn.style.display = opts.onEdit ? 'flex' : 'none';

  img.onload = () => {
    if (!sized) { rect = defaultRectFor(img!); applyRect(); }
    else { applyRect(); } // keep whatever size/position the user already set
  };
  img.src = currentObjectURL;
  win.classList.add('show');
  if (sized) applyRect(); // window already visible at prior rect while new image loads
}

export function closePhotoViewer(): void {
  if (!win) return;
  win.classList.remove('show');
  if (currentObjectURL) { URL.revokeObjectURL(currentObjectURL); currentObjectURL = null; }
  sized = false; // next open starts fresh-sized to that photo
}
