/* ════════════════════════════════════════════════════════════════════════
   photoBooth.ts — Full-screen photo markup, ported from the Cut Once app.

   WHAT IT DOES
   ------------
   Opens a full-screen overlay showing a photo, with a transparent draw canvas
   on top. The estimator can:
     • Tool-cycle button: pencil → straight-line (drag point-to-point, locks
       straight on release) → eraser → back to pencil.
     • Undo (~12 deep).
     • Ink-cycle (acid green / red / white / black) so marks stay visible on both
       light and dark parts of a photo. Manual cycle only — no auto contrast.
     • Numeric voice: tap the mic, tap a spot on the photo, speak a measurement,
       it drops there as a number. Words/fractions → real digits and typeset
       fractions (to 1/16", occasionally 1/32"). STRICTLY numeric by design.
     • Save = bake the photo and the markup together into ONE flat image.

   These marks are REFERENCE ONLY — for the estimator's own eye when they sit down
   to draw/estimate. They do NOT feed square footage or any math. That's the
   draw-it-out flow's job, unchanged.

   The module is self-contained: it injects its own DOM + styles on first open,
   returns the flattened composite as a Blob via onSave, and cleans up on close.
   Storage/downscaling is the caller's job (keeps storage policy in one place).
   ════════════════════════════════════════════════════════════════════════ */

declare global {
  interface Window { SpeechRecognition: any; webkitSpeechRecognition: any; }
}

export interface PhotoBoothOptions {
  imageBlob: Blob;                                  // the photo to mark up
  onSave: (composite: Blob) => void | Promise<void>; // flattened PNG (photo + ink)
  title?: string;
}

const MAX_UNDO = 12;
const FONT_SIZE = 22;
const INK_PALETTE = ['#c6ff00', '#ff2d2d', '#f4f4f2', '#0b0b0c']; // acid green, red, white, black

let injected = false;

function injectStyles() {
  if (injected) return;
  injected = true;
  const css = `
  #pb-overlay{position:fixed;inset:0;z-index:9999;background:#0b0b0c;display:none;
    touch-action:none;-webkit-user-select:none;user-select:none;overscroll-behavior:none;}
  #pb-overlay.show{display:block;}
  #pb-photo{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;
    -webkit-user-drag:none;pointer-events:none;}
  #pb-pad{position:absolute;inset:0;width:100%;height:100%;touch-action:none;}
  #pb-cursor{position:fixed;width:14px;height:14px;border:2px solid #fff;border-radius:50%;
    pointer-events:none;transform:translate(-50%,-50%);opacity:0;transition:opacity .15s ease;
    box-shadow:0 0 0 3px rgba(0,0,0,.25);z-index:10001;}
  #pb-cursor.show{opacity:.85;animation:pb-pulse 1.1s ease-in-out infinite;}
  @keyframes pb-pulse{0%,100%{transform:translate(-50%,-50%) scale(1);}50%{transform:translate(-50%,-50%) scale(1.35);}}
  .pb-bar{position:fixed;display:flex;align-items:center;background:rgba(20,20,22,0.85);
    backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
    box-shadow:0 4px 24px rgba(0,0,0,.35);z-index:10000;}
  .pb-bar.primary{left:50%;bottom:max(16px,env(safe-area-inset-bottom));transform:translateX(-50%);
    gap:5px;padding:7px;border-radius:18px;max-width:98vw;overflow-x:auto;touch-action:pan-x;}
  .pb-bar.secondary{right:max(10px,env(safe-area-inset-right));top:max(10px,env(safe-area-inset-top));
    gap:3px;padding:5px;border-radius:14px;}
  .pb-div{width:1px;height:24px;background:rgba(255,255,255,0.15);flex:none;}
  button.pb-tool{flex:none;width:44px;height:44px;border-radius:14px;border:none;
    background:rgba(255,255,255,0.08);color:#f4f4f2;display:flex;align-items:center;
    justify-content:center;-webkit-tap-highlight-color:transparent;cursor:pointer;font-size:15px;font-weight:700;}
  button.pb-tool svg{width:22px;height:22px;}
  button.pb-tool.small{width:34px;height:34px;border-radius:10px;}
  button.pb-tool.small svg{width:17px;height:17px;}
  button.pb-tool.active{background:rgba(244,244,242,0.92);color:#0b0b0c;}
  button.pb-tool:active{filter:brightness(1.15);}
  button.pb-tool.danger{color:#e85c4a;background:rgba(232,92,74,0.14);}
  button.pb-tool.save{background:var(--maize,#ffcb05);color:#0b2a4a;}
  #pb-draw svg{display:none;}
  #pb-draw.mode-pencil .pb-i-pencil{display:block;}
  #pb-draw.mode-line .pb-i-line{display:block;}
  #pb-draw.mode-erase .pb-i-erase{display:block;}
  #pb-draw.mode-line,#pb-draw.mode-erase{background:rgba(244,244,242,0.92);color:#0b0b0c;}
  button.pb-tool.mic.listening{background:#e85c4a;color:#fff;}
  #pb-ink-swatch{width:16px;height:16px;border-radius:50%;border:1.5px solid rgba(255,255,255,0.45);display:block;}
  #pb-toast{position:fixed;left:50%;top:max(18px,env(safe-area-inset-top));
    transform:translateX(-50%) translateY(-12px);background:rgba(20,20,22,0.92);color:#f4f4f2;
    padding:9px 16px;border-radius:12px;font:500 14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    opacity:0;pointer-events:none;transition:opacity .2s ease,transform .2s ease;max-width:80vw;
    text-align:center;z-index:10002;}
  #pb-toast.show{opacity:1;transform:translateX(-50%) translateY(0);}`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}

const OVERLAY_HTML = `
  <img id="pb-photo" alt="Photo" />
  <canvas id="pb-pad"></canvas>
  <div id="pb-cursor"></div>
  <div id="pb-toast"></div>
  <div class="pb-bar secondary">
    <button class="pb-tool small" id="pb-ink" title="Pencil color"><span id="pb-ink-swatch"></span></button>
    <button class="pb-tool small danger" id="pb-close" title="Close without saving">&times;</button>
  </div>
  <div class="pb-bar primary">
    <button class="pb-tool mode-pencil" id="pb-draw" title="Pencil (tap to cycle line / eraser)">
      <svg class="pb-i-pencil" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
      <svg class="pb-i-line" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="19" r="2" fill="currentColor" stroke="none"/><line x1="6.5" y1="17.5" x2="17.5" y2="6.5"/><circle cx="19" cy="5" r="2" fill="currentColor" stroke="none"/></svg>
      <svg class="pb-i-erase" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20H7l-4.5-4.5a2 2 0 0 1 0-2.8l9-9a2 2 0 0 1 2.8 0l6 6a2 2 0 0 1 0 2.8L13 20"/></svg>
    </button>
    <button class="pb-tool" id="pb-undo" title="Undo">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10h10a5 5 0 0 1 0 10H9"/><path d="M8 5 3 10l5 5"/></svg>
    </button>
    <div class="pb-div"></div>
    <button class="pb-tool mic" id="pb-mic" title="Speak a number">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><path d="M12 19v3"/></svg>
    </button>
    <div class="pb-div"></div>
    <button class="pb-tool save" id="pb-save" title="Save marked photo">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>
    </button>
  </div>`;

/* ── measurement formatting (numeric-only, from Cut Once) ─────────────────── */

const ONES: Record<string, number> = {zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,
  ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19};
const TENS: Record<string, number> = {twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90};

function wordsToDigits(text: string): string {
  const tokens = text.replace(/-/g, ' ').split(/\s+/);
  const out: string[] = [];
  let current = 0, hasCurrent = false;
  const flush = () => { if (hasCurrent) { out.push(String(current)); current = 0; hasCurrent = false; } };
  for (const w of tokens) {
    if (w === '') continue;
    if (Object.prototype.hasOwnProperty.call(ONES, w)) { current += ONES[w]; hasCurrent = true; }
    else if (Object.prototype.hasOwnProperty.call(TENS, w)) { current += TENS[w]; hasCurrent = true; }
    else if (w === 'hundred') { current = (hasCurrent ? current : 1) * 100; hasCurrent = true; }
    else if (w === 'and' && hasCurrent && current > 0 && current % 100 === 0) { continue; }
    else { flush(); out.push(w); }
  }
  flush();
  return out.join(' ');
}

function toFraction(n: number, d: number): string {
  const sup: Record<string, string> = {'0':'\u2070','1':'\u00b9','2':'\u00b2','3':'\u00b3','4':'\u2074','5':'\u2075','6':'\u2076','7':'\u2077','8':'\u2078','9':'\u2079'};
  const sub: Record<string, string> = {'0':'\u2080','1':'\u2081','2':'\u2082','3':'\u2083','4':'\u2084','5':'\u2085','6':'\u2086','7':'\u2087','8':'\u2088','9':'\u2089'};
  const s1 = String(n).split('').map(c => sup[c]).join('');
  const s2 = String(d).split('').map(c => sub[c]).join('');
  return s1 + '\u2044' + s2;
}

function formatMeasurement(raw: string): string {
  let t = ' ' + wordsToDigits(raw.toLowerCase()) + ' ';
  const wordFrac = /\b(?:and\s+)?(?:(a|an|one|\d{1,2})\s+)?(halves|half|quarters|quarter|eighths|eighth|sixteenths|sixteenth|thirty-seconds|thirty-second|thirty seconds|thirty second)\b/g;
  t = t.replace(wordFrac, (_m, numGroup, unitGroup) => {
    let denom: number;
    if (unitGroup.startsWith('half')) denom = 2;
    else if (unitGroup.startsWith('quarter')) denom = 4;
    else if (unitGroup.startsWith('eighth')) denom = 8;
    else if (unitGroup.startsWith('sixteenth')) denom = 16;
    else denom = 32;
    const num = (numGroup && /^\d+$/.test(numGroup)) ? parseInt(numGroup, 10) : 1;
    return ' ' + toFraction(num, denom) + ' ';
  });
  const ordFrac = /\b(?:and\s+)?(?:(a|an|one|\d{1,2})\s+)?(\d{1,2})(?:st|nd|rd|th)s?\b/g;
  t = t.replace(ordFrac, (_m, numGroup, denomStr) => {
    const denom = parseInt(denomStr, 10);
    const num = (numGroup && /^\d+$/.test(numGroup)) ? parseInt(numGroup, 10) : 1;
    return ' ' + toFraction(num, denom) + ' ';
  });
  t = t.replace(/\bfeet\b/g, "'").replace(/\bfoot\b/g, "'").replace(/\binches\b/g, '"').replace(/\binch\b/g, '"');
  t = t.replace(/[a-z]/gi, '');                 // strictly numbers from here on
  t = t.replace(/\s{2,}/g, ' ').trim();
  t = t.replace(/\s+(['"])/g, '$1');
  t = t.replace(/'\s*(?=\d)/g, "'-");
  return t;
}

/* ── the booth ─────────────────────────────────────────────────────────── */

let currentObjectURL: string | null = null;

export function openPhotoBooth(opts: PhotoBoothOptions): void {
  injectStyles();

  let overlay = document.getElementById('pb-overlay') as HTMLDivElement | null;
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'pb-overlay';
    overlay.innerHTML = OVERLAY_HTML;
    document.body.appendChild(overlay);
  }

  const photo = overlay.querySelector('#pb-photo') as HTMLImageElement;
  const canvas = overlay.querySelector('#pb-pad') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const cursorDot = overlay.querySelector('#pb-cursor') as HTMLDivElement;
  const toastEl = overlay.querySelector('#pb-toast') as HTMLDivElement;
  const drawBtn = overlay.querySelector('#pb-draw') as HTMLButtonElement;
  const micBtn = overlay.querySelector('#pb-mic') as HTMLButtonElement;
  const inkBtn = overlay.querySelector('#pb-ink') as HTMLButtonElement;
  const inkSwatch = overlay.querySelector('#pb-ink-swatch') as HTMLSpanElement;

  let dpr = Math.max(1, window.devicePixelRatio || 1);
  let tool: 'pencil' | 'line' | 'erase' = 'pencil';
  let drawing = false;
  let lastX = 0, lastY = 0;
  let undoStack: ImageData[] = [];
  let inkIndex = 0;
  let ink = INK_PALETTE[inkIndex];
  let voiceMode = false;
  let recognition: any = null;
  const cursor = { x: 40, y: 60 };
  const listeners: Array<() => void> = []; // teardown

  inkSwatch.style.background = ink;
  cursorDot.style.borderColor = ink;

  function toast(msg: string) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout((toast as any)._t);
    (toast as any)._t = setTimeout(() => toastEl.classList.remove('show'), 1800);
  }

  function setCanvasSize() {
    const cssW = overlay!.clientWidth, cssH = overlay!.clientHeight;
    const prev = canvas.width ? ctx.getImageData(0, 0, canvas.width, canvas.height) : null;
    dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = cssW * dpr; canvas.height = cssH * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (prev) { try { ctx.putImageData(prev, 0, 0); } catch { /* size changed */ } }
  }

  function pushUndo() {
    undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (undoStack.length > MAX_UNDO) undoStack.shift();
  }
  function undo() {
    const snap = undoStack.pop();
    if (snap) ctx.putImageData(snap, 0, 0);
  }

  const TOOL_ORDER: Array<'pencil' | 'line' | 'erase'> = ['pencil', 'line', 'erase'];
  const TOOL_TITLES = {
    pencil: 'Pencil (tap for straight line)',
    line: 'Straight line (tap for eraser)',
    erase: 'Eraser (tap for pencil)',
  };
  function setTool(name: 'pencil' | 'line' | 'erase') {
    tool = name;
    drawBtn.classList.remove('mode-pencil', 'mode-line', 'mode-erase');
    drawBtn.classList.add('mode-' + name);
    drawBtn.title = TOOL_TITLES[name];
  }

  function pos(e: PointerEvent) { return { x: e.clientX, y: e.clientY }; }
  function moveCursorIndicator() { cursorDot.style.left = cursor.x + 'px'; cursorDot.style.top = cursor.y + 'px'; }

  function drawSegment(p0: {x:number;y:number}, p1: {x:number;y:number}) {
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (tool === 'erase') { ctx.globalCompositeOperation = 'destination-out'; ctx.lineWidth = 22; }
    else { ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = ink; ctx.lineWidth = 4; }
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  let lineStart: {x:number;y:number} | null = null;
  let lineSnapshot: ImageData | null = null;

  const onDown = (e: PointerEvent) => {
    const p = pos(e);
    if (voiceMode) { cursor.x = p.x; cursor.y = p.y; moveCursorIndicator(); return; }
    pushUndo();
    drawing = true;
    if (tool === 'line') { lineStart = p; lineSnapshot = ctx.getImageData(0, 0, canvas.width, canvas.height); }
    else { lastX = p.x; lastY = p.y; }
    canvas.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (!drawing || voiceMode) return;
    const p = pos(e);
    if (tool === 'line') { if (lineSnapshot) ctx.putImageData(lineSnapshot, 0, 0); drawSegment(lineStart!, p); return; }
    drawSegment({ x: lastX, y: lastY }, p); lastX = p.x; lastY = p.y;
  };
  const endStroke = (e: PointerEvent) => {
    if (tool === 'line' && drawing && lineStart) {
      if (lineSnapshot) ctx.putImageData(lineSnapshot, 0, 0);
      if (e.type === 'pointerup') drawSegment(lineStart, pos(e));
      lineStart = null; lineSnapshot = null;
    }
    drawing = false;
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
  canvas.addEventListener('pointerleave', endStroke);
  listeners.push(() => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', endStroke);
    canvas.removeEventListener('pointercancel', endStroke);
    canvas.removeEventListener('pointerleave', endStroke);
  });

  function on(el: Element, ev: string, fn: (e: any) => void) {
    el.addEventListener(ev, fn);
    listeners.push(() => el.removeEventListener(ev, fn));
  }

  on(drawBtn, 'click', () => setTool(TOOL_ORDER[(TOOL_ORDER.indexOf(tool) + 1) % TOOL_ORDER.length]));
  on(overlay.querySelector('#pb-undo')!, 'click', undo);
  on(inkBtn, 'click', () => {
    inkIndex = (inkIndex + 1) % INK_PALETTE.length;
    ink = INK_PALETTE[inkIndex];
    inkSwatch.style.background = ink;
    cursorDot.style.borderColor = ink;
  });

  /* ── voice (numeric only) ─────────────────────────────────────────────── */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR || !window.isSecureContext) {
    micBtn.style.opacity = '0.35';
    micBtn.title = SR ? 'Needs https to use the mic' : 'Speech not supported here';
  } else {
    recognition = new SR();
    recognition.continuous = true; recognition.interimResults = false; recognition.lang = 'en-US';
    recognition.onstart = () => toast('Listening…');
    recognition.onresult = (event: any) => {
      const res = event.results[event.results.length - 1];
      if (!res.isFinal) return;
      const raw = (res[0].transcript || '').trim();
      if (!raw) return;
      if (raw.toLowerCase().includes('next line')) { cursor.x = 40; cursor.y += 32; moveCursorIndicator(); return; }
      const text = formatMeasurement(raw);
      if (!text) { toast('Didn\u2019t catch a number'); return; }
      pushUndo();
      ctx.globalCompositeOperation = 'source-over';
      ctx.font = '600 ' + FONT_SIZE + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillStyle = ink;
      ctx.fillText(text, cursor.x, cursor.y);
      cursor.x += ctx.measureText(text).width + 24;
      moveCursorIndicator();
    };
    recognition.onerror = (e: any) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { toast('Mic permission blocked'); stopVoice(); }
      else if (e.error === 'audio-capture') { toast('No mic found'); stopVoice(); }
      else if (e.error === 'network') { toast('No signal — voice needs internet'); }
      else if (e.error !== 'no-speech') { toast('Mic error: ' + e.error); }
    };
    recognition.onend = () => { if (voiceMode) { try { recognition.start(); } catch { /* already running */ } } };
  }
  function startVoice() {
    if (!recognition) return;
    voiceMode = true;
    micBtn.classList.add('listening');
    cursorDot.classList.add('show');
    moveCursorIndicator();
    try { recognition.start(); } catch { voiceMode = false; micBtn.classList.remove('listening'); cursorDot.classList.remove('show'); }
  }
  function stopVoice() {
    voiceMode = false;
    micBtn.classList.remove('listening');
    cursorDot.classList.remove('show');
    if (recognition) { try { recognition.stop(); } catch { /* */ } }
  }
  on(micBtn, 'click', () => { if (voiceMode) stopVoice(); else startVoice(); });

  /* ── composite (photo contain-fit + ink), flattened ───────────────────── */
  function drawContainFit(octx: CanvasRenderingContext2D, img: HTMLImageElement, boxW: number, boxH: number) {
    const ir = img.naturalWidth / img.naturalHeight;
    const br = boxW / boxH;
    let dw: number, dh: number, dx: number, dy: number;
    if (ir > br) { dw = boxW; dh = boxW / ir; dx = 0; dy = (boxH - dh) / 2; }
    else { dh = boxH; dw = boxH * ir; dy = 0; dx = (boxW - dw) / 2; }
    octx.drawImage(img, dx, dy, dw, dh);
  }
  function compositeToBlob(): Promise<Blob | null> {
    const off = document.createElement('canvas');
    off.width = canvas.width; off.height = canvas.height;
    const octx = off.getContext('2d')!;
    if (photo.complete && photo.naturalWidth) drawContainFit(octx, photo, off.width, off.height);
    else { octx.fillStyle = '#0b0b0c'; octx.fillRect(0, 0, off.width, off.height); }
    octx.drawImage(canvas, 0, 0);
    return new Promise(res => off.toBlob(b => res(b), 'image/png'));
  }

  function close() {
    stopVoice();
    listeners.forEach(fn => fn());
    window.removeEventListener('resize', onResize);
    overlay!.classList.remove('show');
    if (currentObjectURL) { URL.revokeObjectURL(currentObjectURL); currentObjectURL = null; }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    undoStack = [];
  }

  on(overlay.querySelector('#pb-close')!, 'click', () => {
    if (undoStack.length && !window.confirm('Discard markup on this photo?')) return;
    close();
  });
  on(overlay.querySelector('#pb-save')!, 'click', async () => {
    const blob = await compositeToBlob();
    if (!blob) { toast('Could not build image'); return; }
    close();
    await opts.onSave(blob);
  });

  const onResize = () => setCanvasSize();
  window.addEventListener('resize', onResize);

  // boot
  setTool('pencil');
  overlay.classList.add('show');
  if (currentObjectURL) URL.revokeObjectURL(currentObjectURL);
  currentObjectURL = URL.createObjectURL(opts.imageBlob);
  photo.onload = () => { setCanvasSize(); ctx.clearRect(0, 0, canvas.width, canvas.height); };
  photo.src = currentObjectURL;
  // In case the image is cached and onload doesn't refire:
  if (photo.complete) { setCanvasSize(); }
}
