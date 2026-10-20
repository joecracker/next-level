/* ════════════════════════════════════════════════════════════════════════
   photoBooth.ts — Full-screen photo markup, ported from the Cut Once app.

   WHAT IT DOES
   ------------
   Opens a full-screen overlay showing a photo, with a transparent draw canvas
   on top. The estimator can:
     • Tool-cycle button: pencil → straight-line (drag point-to-point, locks
       straight on release) → eraser → back to pencil.
     • Undo (~12 deep).
     • Pencil colors (tap the dot for a row of eight swatches) so marks stay visible on both
       light and dark parts of a photo. Picked by hand — no auto contrast.
     • Numeric voice (ported from Cut Once): tap the mic, then tap as many spots
       as you like — each drops a ring, and exactly one ring is lit. Speak a
       measurement and it lands on the lit ring; say "next" to move to the next
       ring, "back" to undo the last one. Tap any old spot to re-aim at it (drag
       it and its number moves too). Words/fractions → real digits and typeset
       fractions down to 1/64". STRICTLY numeric by design.
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
// Size of the measurement numbers drawn on photos. The Capture screen's
// "Number size" buttons store a value in localStorage; read fresh each time
// the booth opens so a change applies to the very next photo.
function readFontSize(): number {
  try { const v = parseInt(localStorage.getItem('nl_label_size') || '', 10); return v >= 14 && v <= 60 ? v : 22; } catch { return 22; }
}
// acid green, red, white, black, yellow, orange, sky blue, pink
const INK_PALETTE = ['#c6ff00', '#ff2d2d', '#f4f4f2', '#0b0b0c', '#ffd60a', '#ff8a00', '#2d9bff', '#ff4fd8'];

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
  #pb-labels{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;}
  #pb-marks{position:absolute;inset:0;pointer-events:none;}
  .pb-ring{position:absolute;width:14px;height:14px;border:2px solid #fff;border-radius:50%;
    pointer-events:none;transform:translate(-50%,-50%);opacity:.45;transition:opacity .15s ease;
    box-shadow:0 0 0 3px rgba(0,0,0,.25);}
  .pb-ring.active{opacity:1;animation:pb-pulse 1.1s ease-in-out infinite;}
  /* a labeled spot you've tapped to re-aim / move: solid ring, no pulse */
  .pb-ring.editing{opacity:1;animation:none;border-width:3px;}
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
  #pb-draw.mode-arrow .pb-i-arrow{display:block;}
  #pb-draw.mode-erase .pb-i-erase{display:block;}
  #pb-draw.mode-line,#pb-draw.mode-arrow,#pb-draw.mode-erase{background:rgba(244,244,242,0.92);color:#0b0b0c;}
  button.pb-tool.mic.listening{background:#e85c4a;color:#fff;}
  #pb-ink-swatch{width:16px;height:16px;border-radius:50%;border:1.5px solid rgba(255,255,255,0.45);display:block;}
  #pb-inkrow{position:fixed;display:none;z-index:10002;gap:10px;padding:12px;background:rgba(20,20,22,0.96);
    border:1px solid rgba(255,255,255,0.18);border-radius:16px;box-shadow:0 4px 16px rgba(0,0,0,0.5);}
  #pb-inkrow.show{display:grid;grid-template-columns:repeat(4,44px);}
  #pb-inkrow button{width:44px;height:44px;border-radius:50%;border:2px solid rgba(255,255,255,0.35);padding:0;cursor:pointer;}
  #pb-inkrow button.sel{border:3px solid #fff;}
  #pb-heard{position:fixed;left:max(10px,env(safe-area-inset-left));right:max(10px,env(safe-area-inset-right));
    top:calc(max(10px,env(safe-area-inset-top)) + 56px);max-height:38vh;overflow-y:auto;display:none;
    background:rgba(20,20,22,0.94);color:#f4f4f2;border-radius:14px;padding:10px 14px;z-index:10001;
    font:500 14px/1.5 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;}
  #pb-heard.show{display:block;}
  #pb-heard .h{font:700 12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;opacity:.6;margin-bottom:6px;letter-spacing:.04em;}
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
  <canvas id="pb-labels"></canvas>
  <div id="pb-marks"></div>
  <div id="pb-toast"></div>
  <div id="pb-heard"></div>
  <div class="pb-bar secondary">
    <button class="pb-tool small" id="pb-heardbtn" title="What the phone heard"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg></button>
    <button class="pb-tool small" id="pb-ink" title="Pencil color"><span id="pb-ink-swatch"></span></button>
    <button class="pb-tool small danger" id="pb-close" title="Close without saving">&times;</button>
  </div>
  <div class="pb-bar primary">
    <button class="pb-tool mode-pencil" id="pb-draw" title="Pencil (tap to cycle line / arrow / eraser)">
      <svg class="pb-i-pencil" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
      <svg class="pb-i-line" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="19" r="2" fill="currentColor" stroke="none"/><line x1="6.5" y1="17.5" x2="17.5" y2="6.5"/><circle cx="19" cy="5" r="2" fill="currentColor" stroke="none"/></svg>
      <svg class="pb-i-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="20" x2="19" y2="5"/><path d="M10 5h9v9"/></svg>
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

/* ── measurement formatting (numeric-only) ─────────────────────────────────
   Ported VERBATIM from Cut Once (index.html, "measurement formatting"). That
   copy has been tuned for hours against real recognizer output, especially
   32nds and 64ths, so treat the regex ORDER and the comments below as load
   bearing — don't "simplify" them. If a fraction comes out wrong, fix it in
   Cut Once first and re-port, so the two apps never drift apart again. */

const ONES: Record<string, number> = {zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,
  ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19};
const TENS: Record<string, number> = {twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90};

// Converts spoken number words ("nine", "twenty-four") to digits, but
// leaves fraction words ("half", "and") alone so the regexes below still
// catch them. Only swallows "and" when it's gluing a hundreds term
// ("two hundred and fifty"), not when it's introducing a fraction
// ("nine and a half").
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
  const sup: Record<string, string> = {'0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹'};
  const sub: Record<string, string> = {'0':'₀','1':'₁','2':'₂','3':'₃','4':'₄','5':'₅','6':'₆','7':'₇','8':'₈','9':'₉'};
  const s1 = String(n).split('').map(c => sup[c]).join('');
  const s2 = String(d).split('').map(c => sub[c]).join('');
  return s1 + '⁄' + s2;
}

// Numerators run up to 63, so the compound tens have to be listed ahead of
// the bare ones or "twenty-nine" captures as just "twenty". These run before
// wordsToDigits, which is why the numerator is still a word here.
const NUM_WORD =
  '((?:twenty|thirty|forty|fifty)[- ](?:one|two|three|four|five|six|seven|eight|nine)' +
  '|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen' +
  '|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|\\d{1,2})';

const RE_32NDS = new RegExp(
  '\\b(?:and\\s+)?(?:' + NUM_WORD + '\\s+)?(?:thirty(?:[- ]two)?|3[02])[\\s-]+seconds?\\b', 'g');

// Both arms need an explicit "fourth(s)" tail. Without it a plain whole
// number like "sixty-four inches" would be eaten as a fraction. The digit arm
// (6[34]) is there because the recognizer frequently hands back
// "sixty-fourths" as a bare cardinal "64" with no unit at all; without it
// "64 seconds" renders as 64 instead of 1/64. RE_32NDS has carried its 3[02]
// arm all along, which is why "30 seconds" -> 1/32 already worked.
const RE_64THS = new RegExp(
  '\\b(?:and\\s+)?(?:' + NUM_WORD + '\\s+)?' +
  '(?:sixty[- ]four[\\s-]+(?:seconds?|fourths?)|sixty[\\s-]+fourths?' +
  '|6[34][\\s-]+(?:seconds?|fourths?))\\b', 'g');

// The recognizer's own fraction rendering: with a numerator in front it hands
// back a slash-joined pair and then spells the unit word — "seven
// thirty-seconds" arrives as "7/30 seconds", with a stray truncated denominator
// digit sometimes left in place ("7/3 30 seconds"). Every rule below wants a
// word boundary in front of the denominator digits, and the slash provides
// one, so the digit arms grab the "30 seconds" and leave a naked "7/" painted
// on the canvas (Tim's canvas, 2026-10-02: "7/ 1/32", "3 7/ 3/32").
// These therefore run FIRST: the numerator is whatever precedes the slash, and
// the spelled unit word is the anchor. The 32nd denominator cue carries the
// optional trailing digit because the truncation shows up as "3" as often as
// "30"; the 64th cue doesn't, since that form hasn't been seen truncated.
const RE_SLASH_32 = new RegExp('\\b(and\\s+)?(\\d{1,2})\\s*\\/\\s*(?:\\d{1,2}\\s+)?3[02]?\\s*seconds?\\b', 'g');
const RE_SLASH_64 = new RegExp('\\b(and\\s+)?(\\d{1,2})\\s*\\/\\s*(?:\\d{1,2}\\s+)?6[34]\\s*(?:seconds?|fourths?)\\b', 'g');

// "over" phrasing: "three over thirty-two", "five and five over sixty-four",
// and the numerator-less "over 64". The denominator arrives as a cardinal as
// often as a spelled ordinal, so both arms are accepted.
const RE_OVER_64 = new RegExp(
  '\\b(?:and\\s+)?(?:' + NUM_WORD + '\\s+)?over[\\s-]+(?:sixty[- ]four(?:ths?)?|6[34])\\b', 'g');
const RE_OVER_32 = new RegExp(
  '\\b(?:and\\s+)?(?:' + NUM_WORD + '\\s+)?over[\\s-]+(?:thirty(?:[- ]two)?|3[02])\\b', 'g');

// Bare numerator + denominator with no unit word: "three thirty two" -> 3/32,
// "five sixty four" -> 5/64. The numerator is required here — on its own
// "thirty two" is a legitimate 32" measurement and has to survive. Any word
// between the two ("three hundred thirty two") blocks the match, so 332 still
// reads as 332.
const RE_BARE_64 = new RegExp('\\b(?:and\\s+)?' + NUM_WORD + '\\s+(?:sixty[- ]four)\\b', 'g');
const RE_BARE_32 = new RegExp('\\b(?:and\\s+)?' + NUM_WORD + '\\s+(?:thirty[- ]two)\\b', 'g');

// The recognizer also merges the numerator and denominator into ONE cardinal:
// "five and two sixty-fourths" comes back as "5 and 264" (numerator 2, denom
// 64), "seven and eight sixty-fourths" as "7 and 864". Nothing above sees
// that, because 264 is a bare number with no unit and no spelled denominator.
// These two rules split the trailing 32/64 back out, and they REQUIRE the
// "and" that introduces the fraction — that anchor is the only thing standing
// between a real 164" ("one sixty-four" -> "164") and 1/64", so do not loosen
// it to an optional "and". "and 64" ("two hundred and sixty-four") is left
// alone too: the numerator digit is mandatory here.
const RE_MERGED_64 = new RegExp('\\band\\s+([1-9]\\d?)\\s*(?:6[34])\\b', 'g');
const RE_MERGED_32 = new RegExp('\\band\\s+([1-9]\\d?)\\s*(?:3[02])\\b', 'g');

// Same merge, but with no whole number and no "and" in front: the recognizer
// returns "one thirty-second" as "132nd" and "one sixty-fourth" as "164th" —
// numerator and denominator fused, with the ordinal suffix still stuck on the
// end. That suffix is the entire anchor. This is the one shape the rules above
// deliberately skip, because a bare "164" is a perfectly good 164"; but a
// real measurement never comes back as "164th", so requiring th/nd keeps
// whole numbers safe. The numerator is mandatory and 1-2 digits: greedy match
// plus backtrack lands "132nd" on 1+32 and "564th" on 5+64.
const RE_ORD_MERGED_64 = new RegExp('\\b(\\d{1,2})(?:6[34])(?:th|ths)\\b', 'g');
const RE_ORD_MERGED_32 = new RegExp('\\b(\\d{1,2})(?:3[02])(?:nd|nds)\\b', 'g');

// ...and sometimes it fuses the numerator onto the denominator's digits while
// leaving the unit word spelled: "one thirty-second" comes back as
// "130 second" (device log 2026-10-02) — "one thirty" collapsed into 130 and
// "second" survived as a word. The digit arms in RE_32NDS/RE_64THS can't see
// this, because "3[02]" needs a word boundary in front of it and there is
// none inside 130. So the leading digits are captured here and become the
// numerator. Empty prefix is still 1/32 ("30 seconds"), matching what those
// digit arms already do.
const RE_FUSED_32 = new RegExp('\\b(\\d*?)3[02][\\s-]+seconds?\\b', 'g');
const RE_FUSED_64 = new RegExp('\\b(\\d*?)6[34][\\s-]+(?:seconds?|fourths?)\\b', 'g');

// Eighth shape, straight off Tim's canvas (2026-10-02): with a numerator word
// in front, the recognizer sometimes drops the ordinal suffix AND the unit
// word, handing back one bare fused cardinal — "six sixty-fourths" arrives as
// "664", "one sixty-four" as "164". No "and", no th/nd, no unit, so every
// rule above misses it and it renders as the whole number 664.
//
// This is the shape the earlier notes said to leave alone, and it is only
// acceptable because the spelled route still works: a real 164" spoken as
// "one hundred sixty-four" keeps words between numerator and denominator, so
// RE_BARE_64 can't match it and wordsToDigits still yields 164. The genuine
// cost is that "one sixty-four" spoken as a plain dimension now reads as
// 1/64". Tim accepted that trade; delete this one line if it ever bites.
const RE_BARE_MERGED_64 = new RegExp('\\b([1-9])6[34]\\b', 'g');

// ...and its 32nd twin, added for symmetry (Tim, 2026-10-02). Same shape, same
// cost: a bare "132" or "130" spoken as a plain dimension now reads as 1/32.
// Four-digit numbers are safe (the trailing word boundary rejects "1300"), and
// the fused form "130 second" is eaten by RE_FUSED_32 long before this runs.
const RE_BARE_MERGED_32 = new RegExp('\\b([1-9])3[02]\\b', 'g');

// The recognizer sometimes types speech as a CLOCK TIME. Tim's phone, 2026-10-14:
// "eleven and three thirty-seconds" arrived as "11:00 and 3:30 seconds" ("eleven"
// became "11:00", "three thirty" became "3:30"). The colon cut the numerator off
// from the denominator, so the 3 was stranded and the 30 became a bare 1/32.
// A measurement never contains a colon, so both repairs are safe. They run FIRST,
// ahead of every rule below: H:30 / H:32 + "seconds" is H/32, H:64 / H:63 +
// "seconds" or "fourths" is H/64, and H:00 is just H.
const RE_CLOCK_FRAC = new RegExp('\\b(?:and\\s+)?(\\d{1,2}):(3[02]|6[34])[\\s-]+(?:seconds?|fourths?)\\b', 'g');
const RE_CLOCK_ZERO = new RegExp('\\b(\\d{1,2}):00\\b', 'g');

function formatMeasurement(raw: string): string {
  // Spoken 32nds and 64ths ("three thirty-seconds", "five sixty-fourths")
  // must be rewritten to ordinal form BEFORE wordsToDigits, because that step
  // adds consecutive number words together ("three thirty" -> 33, "five
  // sixty" -> 65) and the fraction becomes unrecoverable. ordFrac below then
  // turns "3 32nds" into the stacked glyphs. Order matters: "over" phrasing
  // first, then the unit-bearing forms, then bare numerator+denominator. The
  // rewritten output ("three 32nds") can't be re-eaten by a later rule,
  // because every remaining pattern wants a spelled denominator or a "seconds"
  // tail, and "32nds" offers neither.
  const src = raw.toLowerCase()
    .replace(RE_CLOCK_FRAC, (_m: string, n: string, d: string) => ' and ' + n + (d.charAt(0) === '3' ? ' 32nds ' : ' 64ths '))
    .replace(RE_CLOCK_ZERO, (_m: string, n: string) => n)
    .replace(RE_SLASH_64, (_m: string, andG: string, n: string) => (andG ? 'and ' : ' ') + n + ' 64ths ')
    .replace(RE_SLASH_32, (_m: string, andG: string, n: string) => (andG ? 'and ' : ' ') + n + ' 32nds ')
    .replace(RE_OVER_64, (_m: string, n: string) => ' and ' + (n || 'a') + ' 64ths ')
    .replace(RE_OVER_32, (_m: string, n: string) => ' and ' + (n || 'a') + ' 32nds ')
    .replace(RE_64THS, (_m: string, n: string) => ' and ' + (n || 'a') + ' 64ths ')
    .replace(RE_32NDS, (_m: string, n: string) => ' and ' + (n || 'a') + ' 32nds ')
    .replace(RE_BARE_64, (_m: string, n: string) => ' and ' + (n || 'a') + ' 64ths ')
    .replace(RE_BARE_32, (_m: string, n: string) => ' and ' + (n || 'a') + ' 32nds ')
    .replace(RE_MERGED_64, (_m: string, n: string) => ' and ' + n + ' 64ths ')
    .replace(RE_MERGED_32, (_m: string, n: string) => ' and ' + n + ' 32nds ')
    .replace(RE_ORD_MERGED_64, (_m: string, n: string) => ' and ' + n + ' 64ths ')
    .replace(RE_ORD_MERGED_32, (_m: string, n: string) => ' and ' + n + ' 32nds ')
    .replace(RE_FUSED_64, (_m: string, n: string) => ' and ' + (n || 'a') + ' 64ths ')
    .replace(RE_FUSED_32, (_m: string, n: string) => ' and ' + (n || 'a') + ' 32nds ')
    .replace(RE_BARE_MERGED_64, (_m: string, n: string) => ' and ' + n + ' 64ths ')
    .replace(RE_BARE_MERGED_32, (_m: string, n: string) => ' and ' + n + ' 32nds ');
  let t = ' ' + wordsToDigits(src) + ' ';

  // trade vocabulary: "fifteen by sixty-seven" -> 15×67, "twelve point five"
  // -> 12.5, "sixteen inches on center" -> 16" OC. Done before the letter
  // strip so the connective words survive as symbols instead of vanishing.
  t = t.replace(/\bon\s+center\b/g, ' ¤ ');
  t = t.replace(/\b(?:by|times)\b/g, ' × ');
  t = t.replace(/\bx\b/g, ' × ');
  t = t.replace(/\s*point\s*/g, '.');

  // Word-form fractions for the other denominators. 32nds and 64ths are
  // handled above, before wordsToDigits, because their spoken forms would
  // otherwise collapse into the whole number.
  const wordFrac = /\b(?:and\s+)?(?:(a|an|one|\d{1,2})\s+)?(halves|half|quarters|quarter|eighths|eighth|sixteenths|sixteenth)\b/g;
  t = t.replace(wordFrac, (_m: string, numGroup: string, unitGroup: string) => {
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
  t = t.replace(ordFrac, (_m: string, numGroup: string, denomStr: string) => {
    const denom = parseInt(denomStr, 10);
    const num = (numGroup && /^\d+$/.test(numGroup)) ? parseInt(numGroup, 10) : 1;
    return ' ' + toFraction(num, denom) + ' ';
  });

  // Recognizers that hand back a plain "3/32" get the same stacked glyphs.
  t = t.replace(/\b(\d{1,2})\s*\/\s*(\d{1,2})\b/g, (_m: string, n: string, d: string) => toFraction(parseInt(n, 10), parseInt(d, 10)));

  t = t.replace(/\bfeet\b/g, "'")
       .replace(/\bfoot\b/g, "'")
       .replace(/\binches\b/g, '"')
       .replace(/\binch\b/g, '"');

  // strictly numbers from here on — drop any word that never converted
  t = t.replace(/[a-z]/gi, '');
  t = t.replace(/¤/g, ' OC');

  t = t.replace(/\s{2,}/g, ' ').trim();
  t = t.replace(/\s+(['"])/g, '$1');
  t = t.replace(/'\s*(?=\d)/g, "'-");
  t = t.replace(/\s*×\s*/g, '×');
  return t;
}

/* ── confirmation tones (from Cut Once) ─────────────────────────────────────
   Short synthesized beeps — no audio files, works offline. Purely a nicety:
   every call is wrapped so a missing/blocked AudioContext can never break the
   booth. (Cut Once's vibration is not ported: it sits behind a settings switch
   this app doesn't have.) */
let audioCtx: AudioContext | null = null;
function beep(freq: number, ms: number, delay = 0) {
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t = audioCtx.currentTime + delay;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(t); o.stop(t + ms / 1000 + 0.05);
  } catch { /* audio is optional */ }
}
function sfxMarker() { beep(660, 70); }
function sfxLanded(clamped: boolean) { beep(880, 110); if (clamped) beep(440, 90, 0.16); }
function sfxNext() { beep(990, 70, 0); beep(990, 70, 0.12); }

/* ── the booth ─────────────────────────────────────────────────────────── */

// A spot tapped while the mic is on. Exactly ONE spot is "active" (lit): the one
// the next spoken measurement lands on. labelId is null until it has a number.
interface VoicePoint { nx: number; ny: number; labelId: number | null; editing: boolean; el: HTMLDivElement | null; }
// A spoken measurement. Coordinates are normalized to the photo's contain-fit
// rect, so labels (and rings) stay glued to the photo through resize/rotation.
interface VoiceLabel { id: number; nx: number; ny: number; text: string; ink: string; }
type BoothAction = { kind: 'ink'; snap: ImageData } | { kind: 'label'; id: number };

const MAX_ACTIONS = 40;
const MAX_AUTO_RESTARTS = 12; // silent mic restarts before we stop listening (~90s)

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
  const labelsCanvas = overlay.querySelector('#pb-labels') as HTMLCanvasElement;
  const lctx = labelsCanvas.getContext('2d')!;
  const marksEl = overlay.querySelector('#pb-marks') as HTMLDivElement;
  const toastEl = overlay.querySelector('#pb-toast') as HTMLDivElement;
  const drawBtn = overlay.querySelector('#pb-draw') as HTMLButtonElement;
  const micBtn = overlay.querySelector('#pb-mic') as HTMLButtonElement;
  const inkBtn = overlay.querySelector('#pb-ink') as HTMLButtonElement;
  const heardBtn = overlay.querySelector('#pb-heardbtn') as HTMLButtonElement;
  const heardEl = overlay.querySelector('#pb-heard') as HTMLDivElement;

  // "Last heard": what the recognizer heard → what the booth made of it, newest first.
  // A wrong number can then be blamed on the right half (the phone's ears or our formatter).
  const heardLog: Array<{ raw: string; out: string }> = [];
  function renderHeard() {
    heardEl.innerHTML = '<div class="h">LAST HEARD  →  WHAT THE BOOTH MADE OF IT</div>';
    const body = document.createElement('div');
    body.textContent = heardLog.length
      ? heardLog.map(e => (e.out ? e.raw + '   →   ' + e.out : e.raw)).join('\n')
      : 'Nothing yet. Tap the mic and say a number.';
    heardEl.appendChild(body);
  }
  heardBtn.addEventListener('click', () => {
    const open = heardEl.classList.toggle('show');
    if (open) renderHeard();
  });
  const inkSwatch = overlay.querySelector('#pb-ink-swatch') as HTMLSpanElement;

  let dpr = Math.max(1, window.devicePixelRatio || 1);
  let tool: 'pencil' | 'line' | 'arrow' | 'erase' = 'pencil';
  let drawing = false;
  let lastX = 0, lastY = 0;
  let actions: BoothAction[] = [];   // undo history: ink snapshots + spoken labels, oldest first
  let inkIndex = 0;
  let ink = INK_PALETTE[inkIndex];
  let voiceMode = false;
  let recognition: any = null;
  let voicePoints: VoicePoint[] = [];  // spots tapped this mic session, in the order placed
  let voicePointIdx = 0;               // which spot the next spoken measurement lands on
  let labels: VoiceLabel[] = [];
  let nextLabelId = 1;
  let dragPoint: VoicePoint | null = null;
  let autoRestarts = 0;                // silent restarts since the last real result
  let lastNextAt = 0;                  // debounce for an accidental double "next"
  const listeners: Array<() => void> = []; // teardown

  inkSwatch.style.background = ink;

  function toast(msg: string) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout((toast as any)._t);
    (toast as any)._t = setTimeout(() => toastEl.classList.remove('show'), 1800);
  }

  /* ── photo frame: where the photo actually sits inside the overlay ───── */
  function photoFrame() {
    const w = overlay!.clientWidth, h = overlay!.clientHeight;
    if (photo.complete && photo.naturalWidth) {
      const ir = photo.naturalWidth / photo.naturalHeight;
      const br = w / h;
      if (ir > br) { const dh = w / ir; return { dx: 0, dy: (h - dh) / 2, dw: w, dh }; }
      const dw = h * ir; return { dx: (w - dw) / 2, dy: 0, dw, dh: h };
    }
    return { dx: 0, dy: 0, dw: w, dh: h };
  }
  function toNorm(x: number, y: number) {
    const f = photoFrame();
    return { nx: (x - f.dx) / f.dw, ny: (y - f.dy) / f.dh };
  }
  function toScreen(nx: number, ny: number) {
    const f = photoFrame();
    return { x: f.dx + nx * f.dw, y: f.dy + ny * f.dh };
  }

  function setCanvasSize() {
    const cssW = overlay!.clientWidth, cssH = overlay!.clientHeight;
    const prev = canvas.width ? ctx.getImageData(0, 0, canvas.width, canvas.height) : null;
    dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = cssW * dpr; canvas.height = cssH * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (prev) { try { ctx.putImageData(prev, 0, 0); } catch { /* size changed */ } }
    labelsCanvas.width = cssW * dpr; labelsCanvas.height = cssH * dpr;
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderLabels();
    syncRings();
  }

  /* ── labels: spoken measurements, redrawn from data so they can move ─── */
  const LABEL_FONT = '600 ' + readFontSize() + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

  // keep a label fully on-screen: dead-center unless it would clip an edge
  function clampTextX(text: string, x: number) {
    lctx.font = LABEL_FONT;
    const half = lctx.measureText(text).width / 2;
    const cssW = overlay!.clientWidth;
    let clamped = false;
    if (x - half < 6) { x = 6 + half; clamped = true; }
    if (x + half > cssW - 6) { x = cssW - 6 - half; clamped = true; }
    return { x, clamped };
  }

  function renderLabels() {
    lctx.clearRect(0, 0, labelsCanvas.width, labelsCanvas.height);
    lctx.font = LABEL_FONT;
    lctx.textAlign = 'center'; lctx.textBaseline = 'middle';
    for (const lb of labels) {
      const q = toScreen(lb.nx, lb.ny);
      lctx.fillStyle = lb.ink;
      lctx.fillText(lb.text, clampTextX(lb.text, q.x).x, q.y);
    }
    lctx.textAlign = 'start'; lctx.textBaseline = 'alphabetic';
  }

  function removeLabel(id: number, revive: boolean) {
    const i = labels.findIndex(l => l.id === id);
    if (i >= 0) labels.splice(i, 1);
    renderLabels();
    if (!revive) return;
    // undoing a measurement revives its ring and re-aims the mic at it
    const idx = voicePoints.findIndex(p => p.labelId === id);
    if (idx >= 0) {
      const p = voicePoints[idx];
      p.labelId = null; p.editing = false;
      ensureRing(p);
      voicePointIdx = idx;
      syncActiveMark();
    }
  }

  /* ── undo: ink snapshots and spoken labels share one history ─────────── */
  function capActions() {
    let inkCount = 0;
    for (const a of actions) if (a.kind === 'ink') inkCount++;
    while (inkCount > MAX_UNDO) { // ink snapshots are big — keep only the newest few
      actions.splice(actions.findIndex(a => a.kind === 'ink'), 1);
      inkCount--;
    }
    if (actions.length > MAX_ACTIONS) actions.shift();
  }
  function pushInkUndo() {
    actions.push({ kind: 'ink', snap: ctx.getImageData(0, 0, canvas.width, canvas.height) });
    capActions();
  }
  function undo() {
    const a = actions.pop();
    if (!a) return;
    if (a.kind === 'ink') ctx.putImageData(a.snap, 0, 0);
    else removeLabel(a.id, true);
  }
  // voice "back": remove the most recent spoken label and re-aim at its spot
  function undoLastLabel(): boolean {
    for (let i = actions.length - 1; i >= 0; i--) {
      const a = actions[i];
      if (a.kind === 'label') { actions.splice(i, 1); removeLabel(a.id, true); return true; }
    }
    return false;
  }

  const TOOL_ORDER: Array<'pencil' | 'line' | 'arrow' | 'erase'> = ['pencil', 'line', 'arrow', 'erase'];
  const TOOL_TITLES = {
    pencil: 'Pencil (tap for straight line)',
    line: 'Straight line (tap for arrow)',
    arrow: 'Arrow (tap for eraser)',
    erase: 'Eraser (tap for pencil)',
  };
  function setTool(name: 'pencil' | 'line' | 'arrow' | 'erase') {
    tool = name;
    drawBtn.classList.remove('mode-pencil', 'mode-line', 'mode-arrow', 'mode-erase');
    drawBtn.classList.add('mode-' + name);
    drawBtn.title = TOOL_TITLES[name];
  }

  function pos(e: PointerEvent) { return { x: e.clientX, y: e.clientY }; }

  function drawSegment(p0: {x:number;y:number}, p1: {x:number;y:number}) {
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (tool === 'erase') { ctx.globalCompositeOperation = 'destination-out'; ctx.lineWidth = 22; }
    else { ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = ink; ctx.lineWidth = 4; }
    ctx.stroke();
    if (tool === 'arrow') {
      // arrowhead at the end point: two short strokes angled back from the tip
      const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x), len = 14;
      if (Math.hypot(p1.x - p0.x, p1.y - p0.y) > 2) {
        ctx.beginPath();
        ctx.moveTo(p1.x - len * Math.cos(ang - 0.5), p1.y - len * Math.sin(ang - 0.5));
        ctx.lineTo(p1.x, p1.y);
        ctx.lineTo(p1.x - len * Math.cos(ang + 0.5), p1.y - len * Math.sin(ang + 0.5));
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ── voice markers (ported from Cut Once) ─────────────────────────────── */
  function positionRing(p: VoicePoint) {
    if (!p.el) return;
    const q = toScreen(p.nx, p.ny);
    p.el.style.left = q.x + 'px';
    p.el.style.top = q.y + 'px';
  }
  function syncRings() { for (const p of voicePoints) positionRing(p); }
  function ensureRing(p: VoicePoint) {
    if (p.el && p.el.parentNode) return;
    const dot = document.createElement('div');
    dot.className = 'pb-ring';
    dot.style.borderColor = ink;
    marksEl.appendChild(dot);
    p.el = dot;
    positionRing(p);
  }

  // Drops a marker where you tap while the mic is on. Each one waits its turn
  // to receive a spoken measurement; "next" moves down the list.
  function addVoicePoint(x: number, y: number) {
    const n = toNorm(x, y);
    const p: VoicePoint = { nx: n.nx, ny: n.ny, labelId: null, editing: false, el: null };
    voicePoints.push(p);
    ensureRing(p);
    syncActiveMark();
    sfxMarker();
  }

  // Tapping an existing spot re-aims the mic at it (and flags a labeled one for
  // replace/move) instead of dropping a brand-new ring on top of it.
  function hitVoicePoint(x: number, y: number) {
    for (let i = voicePoints.length - 1; i >= 0; i--) {
      const q = toScreen(voicePoints[i].nx, voicePoints[i].ny);
      if (Math.hypot(q.x - x, q.y - y) <= 24) return { p: voicePoints[i], idx: i };
    }
    return null;
  }

  // Exactly one marker is lit: the one the next spoken number lands on.
  function syncActiveMark() {
    const active = voicePoints[voicePointIdx];
    for (const p of voicePoints) {
      if (!p.el) continue;
      p.el.classList.toggle('active', p === active && p.labelId === null);
      p.el.classList.toggle('editing', p === active && p.labelId !== null && p.editing);
    }
  }

  function resetVoicePoints() {
    voicePoints = [];
    voicePointIdx = 0;
    dragPoint = null;
    marksEl.innerHTML = '';
  }

  // a dragged spot takes its label with it
  function moveLabelWithPoint(p: VoicePoint) {
    if (p.labelId === null) return;
    const lb = labels.find(l => l.id === p.labelId);
    if (lb) { lb.nx = p.nx; lb.ny = p.ny; renderLabels(); }
  }

  let lineStart: {x:number;y:number} | null = null;
  let lineSnapshot: ImageData | null = null;

  const onDown = (e: PointerEvent) => {
    const p = pos(e);
    if (voiceMode) {
      const hit = hitVoicePoint(p.x, p.y);
      if (hit) {
        voicePointIdx = hit.idx;
        if (hit.p.labelId !== null) hit.p.editing = true; // labeled spot: re-aim / move / replace
        ensureRing(hit.p);                                // labeled spots have no ring yet
        dragPoint = hit.p;
        syncActiveMark();
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      addVoicePoint(p.x, p.y);
      return;
    }
    pushInkUndo();
    drawing = true;
    if (tool === 'line' || tool === 'arrow') { lineStart = p; lineSnapshot = ctx.getImageData(0, 0, canvas.width, canvas.height); }
    else { lastX = p.x; lastY = p.y; }
    canvas.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    const p = pos(e);
    if (voiceMode && dragPoint) {
      const n = toNorm(p.x, p.y);
      dragPoint.nx = n.nx; dragPoint.ny = n.ny;
      positionRing(dragPoint);
      moveLabelWithPoint(dragPoint);
      return;
    }
    if (!drawing || voiceMode) return;
    if (tool === 'line' || tool === 'arrow') { if (lineSnapshot) ctx.putImageData(lineSnapshot, 0, 0); drawSegment(lineStart!, p); return; }
    drawSegment({ x: lastX, y: lastY }, p); lastX = p.x; lastY = p.y;
  };
  const endStroke = (e: PointerEvent) => {
    if (voiceMode) { dragPoint = null; return; }
    if ((tool === 'line' || tool === 'arrow') && drawing && lineStart) {
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
  // Pencil color: tap the dot for a row of swatches; tap one to pick it.
  overlay.querySelector('#pb-inkrow')?.remove(); // the overlay is reused between photos
  const inkRow = document.createElement('div');
  inkRow.id = 'pb-inkrow';
  const inkChips: HTMLButtonElement[] = [];
  function setInk(i: number) {
    inkIndex = i;
    ink = INK_PALETTE[i];
    inkSwatch.style.background = ink;
    inkChips.forEach((c, j) => c.classList.toggle('sel', j === i));
  }
  INK_PALETTE.forEach((c, i) => {
    const chip = document.createElement('button');
    chip.style.background = c;
    chip.setAttribute('aria-label', 'Pencil color ' + (i + 1));
    on(chip, 'click', () => { setInk(i); inkRow.classList.remove('show'); });
    inkRow.appendChild(chip);
    inkChips.push(chip);
  });
  overlay.appendChild(inkRow);
  setInk(inkIndex);
  on(inkBtn, 'click', () => {
    if (inkRow.classList.toggle('show')) {
      const r = inkBtn.getBoundingClientRect();
      inkRow.style.top = (r.bottom + 10) + 'px';
      inkRow.style.right = Math.max(10, window.innerWidth - r.right) + 'px';
    }
  });
  // A tap anywhere else just closes the row, and doesn't start a stroke.
  const closeInkRow = (e: Event) => {
    if (!inkRow.classList.contains('show')) return;
    const target = e.target as Node;
    if (inkRow.contains(target) || inkBtn.contains(target)) return;
    inkRow.classList.remove('show');
    e.stopPropagation();
    e.preventDefault();
  };
  overlay.addEventListener('pointerdown', closeInkRow, true);
  listeners.push(() => overlay.removeEventListener('pointerdown', closeInkRow, true));

  /* ── voice (numeric only) ─────────────────────────────────────────────── */

  // Shared "voice is done for now" teardown. Leaves marker rings alone.
  function giveUpOnVoice(message: string) {
    voiceMode = false;
    micBtn.classList.remove('listening');
    toast(message);
    if (recognition) { try { recognition.stop(); } catch { /* */ } }
  }

  // Maps an engine error onto UI copy. Returns true when the error is fatal and
  // listening should stop; false means keep going (silence, a transient blip).
  function handleVoiceError(code: string): boolean {
    if (code === 'not-allowed' || code === 'service-not-allowed') { toast('Mic permission blocked'); return true; }
    if (code === 'audio-capture') { toast('No mic found'); return true; }
    if (code === 'no-speech' || code === 'busy') return false; // keep listening quietly
    if (code === 'network') { toast('No signal — voice needs internet'); return false; }
    toast('Mic error: ' + code);
    return false;
  }

  // One spoken phrase.
  function handleTranscript(raw: string) {
    if (!raw) return;
    autoRestarts = 0;
    const entry = { raw, out: '' };
    heardLog.unshift(entry);
    if (heardLog.length > 20) heardLog.pop();
    const done = (out: string) => { entry.out = out; if (heardEl.classList.contains('show')) renderHeard(); };
    done('');
    const lower = raw.toLowerCase();

    // "next" moves on to the next spot you tapped. Past the last spot it does
    // nothing, so a stray "next" never resets the sequence.
    if (/^\s*next[.!]?\s*$/.test(lower)) {
      done('(next)');
      const now = Date.now();
      if (now - lastNextAt < 500) return; // swallow an accidental double-"next"
      lastNextAt = now;
      if (voicePointIdx < voicePoints.length - 1) {
        voicePointIdx++;
        syncActiveMark();
        sfxNext();
        toast('Next spot');
      } else if (voicePoints[voicePointIdx] && voicePoints[voicePointIdx].labelId === null) {
        toast('Last spot');
      } else {
        toast('No more spots');
      }
      return;
    }

    // "back" removes the most recent spoken label and re-aims at its spot
    if (/^\s*back[.!]?\s*$/.test(lower)) {
      done('(back)');
      if (undoLastLabel()) { sfxNext(); toast('Back one'); }
      else toast('Nothing to back up');
      return;
    }

    const text = formatMeasurement(raw);
    done(text || '(no number)');

    if (!voicePoints.length) { toast('Tap a spot first, then speak the number'); return; }
    const p = voicePoints[voicePointIdx];
    if (p.labelId !== null && !p.editing) {
      toast('That spot is labeled — tap it to change it, or say "next"');
      return;
    }
    if (!text) { toast('Didn’t catch a number'); return; }

    // re-speaking a selected spot replaces its old label instead of stacking
    if (p.labelId !== null) {
      const oldId = p.labelId;
      labels = labels.filter(l => l.id !== oldId);
      actions = actions.filter(a => !(a.kind === 'label' && a.id === oldId));
    }
    const id = nextLabelId++;
    labels.push({ id, nx: p.nx, ny: p.ny, text, ink });
    actions.push({ kind: 'label', id });
    capActions();
    p.labelId = id;
    p.editing = false;
    if (p.el && p.el.parentNode) { p.el.parentNode.removeChild(p.el); }
    p.el = null;
    renderLabels();
    sfxLanded(clampTextX(text, toScreen(p.nx, p.ny).x).clamped);
    toast(voicePointIdx === voicePoints.length - 1 ? 'Last spot labeled' : 'Say "next" when ready');
  }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR || !window.isSecureContext) {
    micBtn.style.opacity = '0.35';
    micBtn.title = SR ? 'Needs https to use the mic' : 'Speech not supported here';
  } else {
    recognition = new SR();
    recognition.continuous = true; recognition.interimResults = false; recognition.lang = 'en-US';
    // no toast on start: it also fires on every silent auto-restart
    recognition.onresult = (event: any) => {
      const res = event.results[event.results.length - 1];
      if (!res.isFinal) return;
      handleTranscript((res[0].transcript || '').trim());
    };
    recognition.onerror = (e: any) => { if (handleVoiceError(e.error)) stopVoice(); };
    recognition.onend = () => {
      if (!voiceMode) return;
      // The browser ends recognition after a few seconds of silence; restarting
      // is what keeps it "always on". The cap stops a walked-away session
      // holding the mic open forever — any real result resets the count.
      if (autoRestarts >= MAX_AUTO_RESTARTS) { giveUpOnVoice('Voice unavailable — tap mic to retry'); return; }
      autoRestarts++;
      try { recognition.start(); } catch { /* already running */ }
    };
  }
  function startVoice() {
    if (!recognition) return;
    voiceMode = true;
    autoRestarts = 0;
    resetVoicePoints();
    micBtn.classList.add('listening');
    toast('Listening… tap spots, then speak');
    try { recognition.start(); }
    catch { voiceMode = false; micBtn.classList.remove('listening'); toast('Could not start mic'); }
  }
  function stopVoice() {
    voiceMode = false;
    micBtn.classList.remove('listening');
    // clear any unlabeled marker rings so they don't linger as visual junk
    resetVoicePoints();
    if (recognition) { try { recognition.stop(); } catch { /* */ } }
  }
  on(micBtn, 'click', () => { if (voiceMode) stopVoice(); else startVoice(); });

  // Leaving the page ends the session (also covers a merely-hidden tab).
  const onVisibility = () => { if (document.hidden && voiceMode) stopVoice(); };
  document.addEventListener('visibilitychange', onVisibility);
  listeners.push(() => document.removeEventListener('visibilitychange', onVisibility));

  /* ── composite (photo contain-fit + ink + labels), flattened ──────────── */
  function drawContainFit(octx: CanvasRenderingContext2D, img: HTMLImageElement, boxW: number, boxH: number) {
    const ir = img.naturalWidth / img.naturalHeight;
    const br = boxW / boxH;
    let dw: number, dh: number, dx: number, dy: number;
    if (ir > br) { dw = boxW; dh = boxW / ir; dx = 0; dy = (boxH - dh) / 2; }
    else { dh = boxH; dw = boxH * ir; dy = 0; dx = (boxW - dw) / 2; }
    octx.drawImage(img, dx, dy, dw, dh);
  }
  // The saved picture is just the photo (no black bars from the booth screen), at the photo's own
  // size up to 1600 px on the long side, with the ink and labels scaled along with it.
  function compositeToBlob(): Promise<Blob | null> {
    if (!(photo.complete && photo.naturalWidth > 0)) {
      const fb = document.createElement('canvas');
      fb.width = canvas.width; fb.height = canvas.height;
      const fctx = fb.getContext('2d')!;
      fctx.fillStyle = '#0b0b0c'; fctx.fillRect(0, 0, fb.width, fb.height);
      fctx.drawImage(canvas, 0, 0);
      fctx.drawImage(labelsCanvas, 0, 0);
      return new Promise(res => fb.toBlob(b => res(b), 'image/png'));
    }
    // where the photo sits inside the booth canvas (contain fit)
    const ir = photo.naturalWidth / photo.naturalHeight;
    const br = canvas.width / canvas.height;
    let dw: number, dh: number, dx: number, dy: number;
    if (ir > br) { dw = canvas.width; dh = canvas.width / ir; dx = 0; dy = (canvas.height - dh) / 2; }
    else { dh = canvas.height; dw = canvas.height * ir; dy = 0; dx = (canvas.width - dw) / 2; }
    const k = Math.min(photo.naturalWidth / dw, 1600 / Math.max(dw, dh));
    const ow = Math.max(1, Math.round(dw * k)), oh = Math.max(1, Math.round(dh * k));
    const off = document.createElement('canvas');
    off.width = ow; off.height = oh;
    const octx = off.getContext('2d')!;
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(photo, 0, 0, ow, oh);
    octx.drawImage(canvas, dx, dy, dw, dh, 0, 0, ow, oh);
    octx.drawImage(labelsCanvas, dx, dy, dw, dh, 0, 0, ow, oh);
    return new Promise(res => off.toBlob(b => res(b), 'image/png'));
  }

  function close() {
    stopVoice();
    listeners.forEach(fn => fn());
    window.removeEventListener('resize', onResize);
    overlay!.classList.remove('show');
    if (currentObjectURL) { URL.revokeObjectURL(currentObjectURL); currentObjectURL = null; }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    lctx.clearRect(0, 0, labelsCanvas.width, labelsCanvas.height);
    labels = [];
    actions = [];
  }

  on(overlay.querySelector('#pb-close')!, 'click', () => {
    if (actions.length && !window.confirm('Discard markup on this photo?')) return;
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
  photo.onerror = () => {
    toast("This picture couldn't be opened");
    setTimeout(() => close(), 1800);
  };
  photo.src = currentObjectURL;
  // In case the image is cached and onload doesn't refire:
  if (photo.complete) { setCanvasSize(); }
}
