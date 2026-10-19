import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { BUILD_STAMP } from './buildStamp';

// New Capture screen (test drive). Sits on top of the existing app and talks to
// it ONLY through window.NextLevel (bridge at the end of src/app.ts), so the
// job record, photo storage and Photo Booth markup are the same ones the old
// screens use. Nothing in the old screens is changed or removed.

export type CapturePhoto = { id: string; caption: string; note: string; timestamp: string };
export type ScratchItem = { id: string; text: string };
export type CaptureData = {
  id: string; name: string;
  customer: string; phone: string; address: string; date: string;
  jobDesc: string; jobNotes: string; email: string;
  photos: CapturePhoto[];
  scratch: ScratchItem[];
  polished: string[] | null; polishedFrom: string; polishUndo: string | null;
};
export type CapturePatch = Partial<Pick<CaptureData, 'customer' | 'phone' | 'address' | 'date' | 'jobDesc' | 'jobNotes' | 'email'>>;

const LABEL_KEY = 'nl_label_size';
function readSize(): number {
  try { const v = parseInt(localStorage.getItem(LABEL_KEY) || '', 10); return v >= 14 && v <= 60 ? v : 22; } catch { return 22; }
}
function writeSize(v: number) { try { localStorage.setItem(LABEL_KEY, String(v)); } catch { /* ignore */ } }
function today(): string { const d = new Date(); return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`; }

const INK = '#14191A', EMBER = '#A08A58', MOSS = '#8A9A5C', CREAM = '#EEF1EE', MUTED = '#5E6968', LINE = '#D3DADA';

const fieldLabel: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', fontWeight: 700, color: MUTED, minWidth: 0 };
const fieldInput: CSSProperties = {
  boxSizing: 'border-box', width: '100%', minHeight: '46px', border: '1px solid #C9C4BC', borderRadius: '10px',
  padding: '0 12px', fontSize: '17px', background: '#FAF9F6', color: INK, fontFamily: 'inherit',
};
const card: CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: '16px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' };
const heading: CSSProperties = { margin: 0, fontSize: '13px', letterSpacing: '2px', fontWeight: 800, color: '#4A5C2E' };
const bigBtn: CSSProperties = { minHeight: '52px', borderRadius: '12px', fontSize: '16px', fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' };
const outlineBtn: CSSProperties = { ...bigBtn, border: `2px solid ${INK}`, background: 'transparent', color: INK };
const solidBtn: CSSProperties = { ...bigBtn, border: 'none', background: EMBER, color: INK };
const headBtn: CSSProperties = {
  minHeight: '40px', padding: '0 14px', borderRadius: '10px', border: '1px solid rgba(245,243,239,0.3)',
  background: 'transparent', color: CREAM, fontSize: '14px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
};

// A one-or-more-line text box that wraps long sentences and grows taller to fit,
// instead of cutting the text off at the edge. Enter commits (never adds a new line).
function AutoText({ value, onChange, onEnter, style, placeholder, ariaLabel, enterKeyHint }: {
  value: string; onChange: (v: string) => void; onEnter?: () => void; style?: CSSProperties;
  placeholder?: string; ariaLabel?: string; enterKeyHint?: 'done' | 'enter' | 'next';
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, []);
  useLayoutEffect(fit, [value, fit]);
  useEffect(() => {
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [fit]);
  return (
    <textarea ref={ref} rows={1} value={value} placeholder={placeholder} aria-label={ariaLabel} enterKeyHint={enterKeyHint} autoComplete="off"
      onChange={e => onChange(e.target.value.replace(/\n/g, ' '))}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onEnter?.(); } }}
      style={{ resize: 'none', overflow: 'hidden', ...style }} />
  );
}

function Photo({ id, rev, style }: { id: string; rev: number; style?: CSSProperties }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let on = true;
    window.NextLevel?.photoUrl(id).then(u => { if (on) setUrl(u); });
    return () => { on = false; };
  }, [id, rev]);
  if (!url) return <div style={{ background: '#E6E2DB', ...style }} />;
  return <img src={url} alt="" style={style} />;
}

function Viewer({ data, rev, startId, wide, onClose }: {
  data: CaptureData; rev: number; startId: string; wide: boolean; onClose: () => void;
}) {
  const [id, setId] = useState(startId);
  const [read, setRead] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const idx = data.photos.findIndex(p => p.id === id);
  const photo = data.photos[idx];
  useEffect(() => { if (!photo) onClose(); }, [photo, onClose]);
  if (!photo) return null;
  const go = (d: number) => {
    const n = data.photos[idx + d];
    if (n) { setId(n.id); setConfirmDel(false); }
  };
  const update = (patch: { caption?: string; note?: string }) => window.NextLevel?.setPhoto(id, patch);

  const imageArea = (
    <div style={{
      flex: wide ? 1.5 : 'none', height: wide ? 'auto' : '44vh', minHeight: 0, minWidth: 0, overflow: 'auto',
      background: read ? CREAM : '#000', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: read ? '24px' : 0, boxSizing: 'border-box',
    }}>
      {read ? (
        <div style={{ maxWidth: '640px', width: '100%', alignSelf: 'flex-start' }}>
          <div style={{ fontSize: '30px', fontWeight: 800, marginBottom: '14px' }}>{photo.caption || 'Picture ' + (idx + 1)}</div>
          <div style={{ fontSize: '26px', lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{photo.note || 'No notes on this picture yet.'}</div>
        </div>
      ) : (
        <Photo id={id} rev={rev} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
      )}
    </div>
  );

  const panel = (
    <div style={{
      flex: wide ? 'none' : 1, width: wide ? '380px' : 'auto', minHeight: 0, overflowY: 'auto', boxSizing: 'border-box',
      padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', background: CREAM,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button onClick={() => go(-1)} disabled={idx <= 0} style={{ ...outlineBtn, minHeight: '44px', padding: '0 14px', opacity: idx <= 0 ? 0.35 : 1 }}>&lsaquo;</button>
        <div style={{ flex: 1, textAlign: 'center', fontSize: '14px', fontWeight: 700, color: MUTED }}>{idx + 1} of {data.photos.length}</div>
        <button onClick={() => go(1)} disabled={idx >= data.photos.length - 1} style={{ ...outlineBtn, minHeight: '44px', padding: '0 14px', opacity: idx >= data.photos.length - 1 ? 0.35 : 1 }}>&rsaquo;</button>
      </div>
      <label style={fieldLabel}>Caption
        <input key={id + 'c'} defaultValue={photo.caption} onChange={e => update({ caption: e.target.value })} placeholder="What is this a picture of?" style={{ ...fieldInput, fontSize: '19px' }} />
      </label>
      <label style={fieldLabel}>Notes on this picture
        <textarea key={id + 'n'} defaultValue={photo.note} onChange={e => update({ note: e.target.value })} rows={wide ? 5 : 3}
          placeholder="Odd sizes, things to remember, what happens here..."
          style={{ ...fieldInput, fontSize: '21px', lineHeight: 1.4, padding: '10px 12px', resize: 'vertical' }} />
      </label>
      <button onClick={() => setRead(r => !r)} style={outlineBtn}>{read ? 'Show the picture' : 'Read notes full page'}</button>
      <button onClick={() => window.NextLevel?.markUpPhoto(id)} style={solidBtn}>Mark up this picture</button>
      <button onClick={() => {
        if (!confirmDel) { setConfirmDel(true); return; }
        setConfirmDel(false);
        window.NextLevel?.deletePhoto(id);
        const next = data.photos[idx + 1] || data.photos[idx - 1];
        if (next) setId(next.id); else onClose();
      }} style={{ ...outlineBtn, borderColor: '#B42318', color: '#B42318' }}>{confirmDel ? 'Tap again to delete' : 'Delete picture'}</button>
      <button onClick={onClose} style={{ ...bigBtn, border: 'none', background: INK, color: CREAM }}>&larr; Back to thumbnails</button>
    </div>
  );

  return (
    <div id="nl-capture-viewer" style={{ position: 'fixed', inset: 0, zIndex: 9100, background: CREAM, display: 'flex', flexDirection: wide ? 'row' : 'column' }}>
      {imageArea}
      {panel}
    </div>
  );
}

// Job Sheet: a clean, readable page built ONLY from what was captured (customer, job description, job notes,
// reminders, pictures with their captions and notes). "Print / Save as PDF" opens the phone's own print screen,
// which has a Save as PDF choice. It replaces the old Boss report on the Capture screen.
const JOBSHEET_CSS = [
  '#nl-jobsheet-root{position:fixed;inset:0;z-index:9300;background:#fff;color:#14191A;overflow-y:auto;-webkit-overflow-scrolling:touch;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}',
  '#nl-jobsheet-root .nl-js-bar{position:sticky;top:0;z-index:2;display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 14px;background:#14191A}',
  '#nl-jobsheet-root .nl-js-hint{flex-basis:100%;font-size:12px;color:#B9B4AC}',
  '#nl-jobsheet-root .nl-js-page{max-width:820px;margin:0 auto;padding:18px 16px 48px}',
  '#nl-jobsheet-root .nl-js-brand{font-size:12px;letter-spacing:2px;font-weight:800;color:#4A5C2E}',
  '#nl-jobsheet-root .nl-js-title{font-size:28px;font-weight:800;margin:2px 0 12px;border-bottom:2px solid #14191A;padding-bottom:10px;overflow-wrap:anywhere}',
  '#nl-jobsheet-root .nl-js-row{display:flex;gap:10px;font-size:15px;line-height:1.4;margin:4px 0}',
  '#nl-jobsheet-root .nl-js-k{flex:none;width:96px;font-weight:800;color:#555}',
  '#nl-jobsheet-root .nl-js-v{flex:1;min-width:0;white-space:pre-wrap;overflow-wrap:anywhere}',
  '#nl-jobsheet-root .nl-js-h{font-size:13px;letter-spacing:2px;font-weight:800;color:#4A5C2E;margin:22px 0 8px;border-bottom:1px solid #D3DADA;padding-bottom:4px}',
  '#nl-jobsheet-root .nl-js-text{font-size:15px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}',
  '#nl-jobsheet-root .nl-js-li{font-size:15px;line-height:1.45;margin:3px 0;overflow-wrap:anywhere}',
  '#nl-jobsheet-root .nl-js-photos{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}',
  '#nl-jobsheet-root .nl-js-fig{break-inside:avoid;page-break-inside:avoid;border:1px solid #D3DADA;border-radius:8px;overflow:hidden;background:#fff}',
  '#nl-jobsheet-root .nl-js-cap{padding:8px 10px;font-size:14px;line-height:1.35}',
  '#nl-jobsheet-root .nl-js-note{margin-top:3px;white-space:pre-wrap;color:#333;overflow-wrap:anywhere}',
  '@media (max-width:560px){#nl-jobsheet-root .nl-js-photos{grid-template-columns:1fr}}',
  '@media print{html,body{height:auto !important;overflow:visible !important}#root{display:none !important}#nl-jobsheet-root,#nl-jobsheet-root *{visibility:visible}#nl-jobsheet-root{position:static !important;overflow:visible !important;height:auto !important}#nl-jobsheet-root .nl-js-bar{display:none !important}#nl-jobsheet-root .nl-js-page{padding:0;max-width:none}#nl-jobsheet-root .nl-js-fig img{width:auto !important;max-width:100% !important;max-height:90mm !important;margin:0 auto}@page{margin:12mm}}',
].join(' ');

function JobSheet({ data, rev, onClose }: { data: CaptureData; rev: number; onClose: () => void }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // Back (phone button or swipe) closes the sheet first, like the big-picture viewer.
  useEffect(() => {
    window.history.pushState({ nl: 'sheet' }, '');
    const onPop = () => closeRef.current();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  // A saved PDF is named after the page title, so give it the customer's name while the sheet is open.
  useEffect(() => {
    const prev = document.title;
    document.title = (data.customer || data.name || 'Job') + ' - Job Sheet';
    return () => { document.title = prev; };
  }, [data.customer, data.name]);
  const close = () => {
    if (window.history.state && window.history.state.nl === 'sheet') window.history.back();
    else onClose();
  };
  const info = (label: string, value: string): ReactNode => value.trim() ? (
    <div className="nl-js-row"><span className="nl-js-k">{label}</span><span className="nl-js-v">{value}</span></div>
  ) : null;
  const notes = data.jobNotes.trim();
  const reminders = data.scratch.filter(s => s.text.trim());
  return createPortal(
    <div id="nl-jobsheet-root">
      <style>{JOBSHEET_CSS}</style>
      <div className="nl-js-bar">
        <button onClick={close} style={headBtn}>&larr; Back</button>
        <button onClick={() => window.print()} style={{ ...headBtn, background: EMBER, color: INK, border: 'none', fontWeight: 800 }}>Print / Save as PDF</button>
        <div className="nl-js-hint">To make a PDF: tap Print / Save as PDF, then choose Save as PDF as the printer.</div>
      </div>
      <div className="nl-js-page">
        <div className="nl-js-brand">FIELD &amp; DESK &middot; JOB SHEET</div>
        <div className="nl-js-title">{data.customer || data.name}</div>
        {info('Customer', data.customer)}
        {info('Date', data.date)}
        {info('Phone', data.phone)}
        {info('Email', data.email)}
        {info('Address', data.address)}
        {info('Job', data.jobDesc)}
        {notes && (
          <>
            <div className="nl-js-h">JOB NOTES</div>
            <div className="nl-js-text">{notes}</div>
          </>
        )}
        {reminders.length > 0 && (
          <>
            <div className="nl-js-h">REMINDERS</div>
            {reminders.map(s => <div key={s.id} className="nl-js-li">&bull; {s.text}</div>)}
          </>
        )}
        {data.photos.length > 0 && (
          <>
            <div className="nl-js-h">PICTURES ({data.photos.length})</div>
            <div className="nl-js-photos">
              {data.photos.map((p, i) => (
                <div key={p.id} className="nl-js-fig">
                  <Photo id={p.id} rev={rev} style={{ width: '100%', height: 'auto', display: 'block' }} />
                  <div className="nl-js-cap">
                    <b>{p.caption || 'Picture ' + (i + 1)}</b>
                    {p.note.trim() ? <div className="nl-js-note">{p.note}</div> : null}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

export default function CaptureScreen({ onHome, onFull, onTakePhoto }: {
  onHome: () => void; onFull: () => void; onTakePhoto: () => void;
}) {
  const [data, setData] = useState<CaptureData | null>(null);
  const [rev, setRev] = useState(0);
  const [viewId, setViewId] = useState<string | null>(null);
  const [size, setSize] = useState(readSize());
  const [newLine, setNewLine] = useState('');
  const [notesOpen, setNotesOpen] = useState(true);
  const [polishBusy, setPolishBusy] = useState(false);
  const [polishMsg, setPolishMsg] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [w, setW] = useState(window.innerWidth);
  const wide = w >= 900;

  const refresh = useCallback(() => {
    setData(window.NextLevel?.getCapture() || null);
    setRev(r => r + 1);
  }, []);

  useEffect(() => {
    refresh();
    const off = window.NextLevel?.onCapture(refresh);
    const onResize = () => setW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => { off?.(); window.removeEventListener('resize', onResize); };
  }, [refresh]);

  useEffect(() => {
    if (data && !data.date) { window.NextLevel?.setCapture({ date: today() }); refresh(); }
  }, [data, refresh]);

  const set = (p: CapturePatch) => { window.NextLevel?.setCapture(p); refresh(); };
  const bump = (d: number) => { const v = Math.max(14, Math.min(60, size + d)); setSize(v); writeSize(v); };
  // The big-picture viewer takes one Back press to close, like a normal screen.
  const closeViewer = useCallback(() => {
    if (window.history.state && window.history.state.nl === 'viewer') window.history.back();
    else setViewId(null);
  }, []);
  const viewerOpen = viewId !== null;
  useEffect(() => {
    if (!viewerOpen) return;
    window.history.pushState({ nl: 'viewer' }, '');
    const onPop = () => setViewId(null);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [viewerOpen]);

  if (!data) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 9000, background: CREAM, padding: '24px', fontFamily: 'system-ui, sans-serif' }}>
        <button onClick={onHome} style={{ ...outlineBtn, padding: '0 18px' }}>&larr; Home</button>
        <p style={{ fontSize: '18px' }}>No job is open yet.</p>
      </div>
    );
  }

  const field = (label: string, value: string, key: keyof CapturePatch, type = 'text'): ReactNode => (
    <label style={fieldLabel}>{label}
      <input type={type} value={value} onChange={e => set({ [key]: e.target.value } as CapturePatch)} autoComplete="off" style={fieldInput} />
    </label>
  );

  // Sketch: hands the Photo Booth a blank dark sheet instead of a photo. It goes through the same pipeline as a
  // gallery picture, so the line tool, pencil, arrow, eraser and numbered voice markers all work, and Save puts it
  // in the pictures list with the photos. The sheet matches the screen shape so it is as big as the booth allows.
  const startSketch = () => {
    const input = document.getElementById('photo-input-gallery') as HTMLInputElement | null;
    if (!input) return;
    const r = window.innerWidth / Math.max(1, window.innerHeight);
    const W = r >= 1 ? 1600 : Math.round(1600 * r), H = r >= 1 ? Math.round(1600 / r) : 1600;
    const sheet = document.createElement('canvas');
    sheet.width = W; sheet.height = H;
    const sctx = sheet.getContext('2d')!;
    sctx.fillStyle = '#1B1B1E'; sctx.fillRect(0, 0, W, H);
    sheet.toBlob(b => {
      if (!b) return;
      const dt = new DataTransfer();
      dt.items.add(new File([b], 'sketch.png', { type: 'image/png' }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, 'image/png');
  };

  const customerCard = (
    <section style={card}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h2 style={heading}>CUSTOMER</h2>
        <span style={{ fontSize: '12px', color: MUTED }}>same fields as the Excel</span>
      </div>
      {field('Customer Name', data.customer, 'customer')}
      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>{field('Date', data.date, 'date')}</div>
        <div style={{ flex: 1.3, minWidth: 0 }}>{field('Customer Phone', data.phone, 'phone')}</div>
      </div>
      {field('Customer Address', data.address, 'address')}
      {field('Email', data.email, 'email', 'email')}
      <label style={fieldLabel}>Description of Job
        <AutoText value={data.jobDesc} onChange={v => set({ jobDesc: v })} style={{ ...fieldInput, minHeight: '46px', padding: '11px 12px', lineHeight: 1.35 }} />
      </label>
    </section>
  );

  const pictures = (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
        <h2 style={heading}>PICTURES</h2>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: MUTED }}>
          Number size
          <button aria-label="Smaller numbers" onClick={() => bump(-2)} style={{ minWidth: '44px', minHeight: '36px', border: `1px solid ${INK}`, borderRadius: '8px', background: 'transparent', fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}>A-</button>
          <span style={{ minWidth: '24px', textAlign: 'center', fontWeight: 800, color: INK }}>{size}</span>
          <button aria-label="Bigger numbers" onClick={() => bump(2)} style={{ minWidth: '44px', minHeight: '36px', border: `1px solid ${INK}`, borderRadius: '8px', background: 'transparent', fontSize: '18px', fontWeight: 800, cursor: 'pointer' }}>A+</button>
        </span>
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button onClick={onTakePhoto} style={{ ...solidBtn, flex: 1.3 }}>PHOTO</button>
        <button onClick={() => document.getElementById('photo-input-gallery')?.click()} style={{ ...outlineBtn, flex: 1 }}>Gallery</button>
        <button onClick={startSketch} style={{ ...outlineBtn, flex: 1 }}>Sketch</button>
      </div>
      {data.photos.length === 0 ? (
        <div style={{ padding: '22px 12px', textAlign: 'center', color: MUTED, fontSize: '15px', border: `1px dashed ${LINE}`, borderRadius: '12px' }}>
          No pictures yet. Take one, or pick one from the gallery.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px' }}>
          {data.photos.map((p, i) => (
            <button key={p.id} onClick={() => setViewId(p.id)} style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: 0, border: 'none', background: 'none', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', color: INK, minWidth: 0 }}>
              <div style={{ position: 'relative', aspectRatio: '1 / 1', borderRadius: '10px', overflow: 'hidden', background: '#E6E2DB' }}>
                <Photo id={p.id} rev={rev} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                {p.note.trim() && (
                  <span style={{ position: 'absolute', right: '6px', top: '6px', width: '22px', height: '22px', borderRadius: '11px', background: EMBER, color: INK, fontSize: '12px', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>N</span>
                )}
              </div>
              <div style={{ fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.caption || 'Picture ' + (i + 1)}</div>
            </button>
          ))}
        </div>
      )}
    </section>
  );

  const scratch = data.scratch;
  const newId = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const addLine = () => {
    const t = newLine.trim();
    if (!t) return;
    window.NextLevel?.setScratch([...scratch, { id: newId(), text: t }]);
    setNewLine('');
    refresh();
  };
  const editLine = (id: string, text: string) => { window.NextLevel?.setScratch(scratch.map(s => (s.id === id ? { ...s, text } : s))); refresh(); };
  const removeLine = (id: string) => { window.NextLevel?.setScratch(scratch.filter(s => s.id !== id)); refresh(); };
  const withNotes = data.photos.map((p, i) => ({ p, i })).filter(x => x.p.note.trim());
  const noteCount = scratch.length + withNotes.length;
  const notesShown = wide || notesOpen;
  const dot = (color: string) => (
    <span aria-hidden="true" style={{ flex: 'none', width: '10px', height: '10px', borderRadius: '5px', background: color }} />
  );
  const notesCard = (
    <section style={card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <h2 style={heading}>NOTES</h2>
        {wide ? (
          <span style={{ fontSize: '12px', color: MUTED }}>quick reminders for yourself</span>
        ) : (
          <button onClick={() => setNotesOpen(o => !o)} style={{ minHeight: '40px', padding: '0 12px', border: `1px solid ${INK}`, borderRadius: '8px', background: 'transparent', color: INK, fontSize: '13px', fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
            {notesOpen ? 'Hide' : `Show (${noteCount})`}
          </button>
        )}
      </div>
      {notesShown && (
        <>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
            <AutoText value={newLine} onChange={setNewLine} onEnter={addLine} enterKeyHint="done"
              placeholder="Type a reminder, press Enter" style={{ ...fieldInput, flex: 1, minWidth: 0, padding: '11px 12px', lineHeight: 1.35 }} />
            <button onClick={addLine} style={{ ...solidBtn, minHeight: '46px', padding: '0 18px' }}>Add</button>
          </div>
          {noteCount === 0 && (
            <div style={{ fontSize: '15px', color: MUTED }}>One-liners go here: oak cabinets, brushed nickel faucets, tear out...</div>
          )}
          {scratch.map(s => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
              <span style={{ marginTop: '17px', display: 'flex' }}>{dot('#8A9190')}</span>
              <AutoText value={s.text} onChange={v => editLine(s.id, v)} ariaLabel="Reminder"
                style={{ flex: 1, minWidth: 0, minHeight: '44px', border: 'none', borderBottom: '1px solid #E6E2DB', background: 'transparent', fontSize: '18px', lineHeight: 1.35, color: INK, fontFamily: 'inherit', padding: '9px 0' }} />
              <button aria-label="Remove reminder" onClick={() => removeLine(s.id)} style={{ flex: 'none', width: '44px', height: '44px', border: 'none', background: 'transparent', color: MUTED, fontSize: '22px', cursor: 'pointer' }}>&times;</button>
            </div>
          ))}
          {withNotes.map(({ p, i }) => (
            <button key={p.id} onClick={() => setViewId(p.id)} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', width: '100%', textAlign: 'left', padding: 0, border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit', color: INK }}>
              <span style={{ marginTop: '8px', display: 'flex' }}>{dot('#8A9190')}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: '18px', lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>{p.note}</span>
              <span style={{ flex: 'none', maxWidth: '38%', fontSize: '12px', fontWeight: 800, color: '#4A5C2E', border: '1px solid #C9D2B3', borderRadius: '8px', padding: '3px 8px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.caption || 'Picture ' + (i + 1)}</span>
            </button>
          ))}
        </>
      )}
    </section>
  );

  // Polish: sends ONLY the Job notes text to /api/format-section and shows the result next to the
  // original. Nothing is replaced until the person taps "Use this".
  const runPolish = async () => {
    const raw = data.jobNotes;
    if (!raw.trim()) { setPolishMsg('Type or say your job notes first, then tap Polish.'); return; }
    setPolishBusy(true); setPolishMsg(''); window.NextLevel?.setPolish({ items: null });
    try {
      const res = await fetch('/api/format-section', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryName: 'Whole job', rawInput: raw }),
      });
      let json: any = null;
      try { json = await res.json(); } catch { json = null; }
      const items: string[] = json && Array.isArray(json.formattedItems)
        ? json.formattedItems.map((x: unknown) => String(x).trim()).filter((x: string) => x) : [];
      if (res.ok && items.length) { window.NextLevel?.setPolish({ items, source: raw }); refresh(); }
      else if (!json || json.error === 'not_configured') setPolishMsg("Polish isn't connected yet. Your notes are untouched.");
      else setPolishMsg("Polish couldn't finish this time. Your notes are untouched. Try again in a minute.");
    } catch {
      setPolishMsg("Couldn't reach Polish. Check your connection. Your notes are untouched.");
    }
    setPolishBusy(false);
  };
  const polishShown = data.polished && data.polishedFrom === data.jobNotes ? data.polished : null;
  const useTheirs = () => {
    if (!polishShown) return;
    window.NextLevel?.setPolish({ items: null, undo: data.jobNotes });
    set({ jobNotes: polishShown.map((t, i) => (i + 1) + '. ' + t).join('\n') });
  };

  const jobNotes = (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h2 style={heading}>JOB NOTES</h2>
        <span style={{ fontSize: '12px', color: MUTED }}>tear-out to debris removal</span>
      </div>
      <textarea value={data.jobNotes} onChange={e => { if (data.polishUndo !== null) window.NextLevel?.setPolish({ undo: null }); set({ jobNotes: e.target.value }); }} rows={wide ? 12 : 8}
        placeholder="Say or type what happens on this job, start to finish. (Tip: use your keyboard's mic.)"
        style={{ ...fieldInput, background: '#fff', fontSize: '17px', lineHeight: 1.45, padding: '14px', borderRadius: '14px', resize: 'vertical' }} />
      <div style={{ fontSize: '12px', color: MUTED }}>The mic is your keyboard&apos;s voice typing, so it needs a signal. If it stops, keep typing. Nothing is lost.</div>
      <button onClick={runPolish} disabled={polishBusy} style={{ ...solidBtn, minHeight: '54px', fontSize: '17px', opacity: polishBusy ? 0.6 : 1 }}>{polishBusy ? 'Polishing...' : 'Polish'}</button>
      <div style={{ fontSize: '12px', color: MUTED }}>Polishes the Job notes only. Your customer info and reminders are not sent.</div>
      {polishMsg && <div style={{ fontSize: '15px', color: INK, background: '#FFF4E5', border: '1px solid #F0D2A8', borderRadius: '10px', padding: '10px 12px' }}>{polishMsg}</div>}
      {data.polishUndo !== null && !polishShown && (
        <button onClick={() => { set({ jobNotes: data.polishUndo || '' }); window.NextLevel?.setPolish({ undo: null }); refresh(); }} style={{ ...outlineBtn, minHeight: '46px' }}>Undo polish (put my words back)</button>
      )}
      {polishShown && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'flex-start' }}>
            <div style={{ flex: '1 1 260px', minWidth: 0, background: '#fff', border: '1px solid ' + LINE, borderRadius: '12px', padding: '12px' }}>
              <div style={{ ...heading, marginBottom: '6px' }}>YOUR WORDS</div>
              <div style={{ fontSize: '16px', lineHeight: 1.45, whiteSpace: 'pre-wrap', color: INK }}>{data.jobNotes}</div>
            </div>
            <div style={{ flex: '1 1 260px', minWidth: 0, background: '#fff', border: '2px solid ' + EMBER, borderRadius: '12px', padding: '12px' }}>
              <div style={{ ...heading, marginBottom: '6px' }}>POLISHED</div>
              <ol style={{ margin: 0, paddingLeft: '24px', fontSize: '16px', lineHeight: 1.45, color: INK }}>
                {polishShown.map((t, i) => <li key={i} style={{ marginBottom: '4px' }}>{t}</li>)}
              </ol>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={useTheirs} style={{ ...solidBtn, flex: 1 }}>Use this</button>
            <button onClick={() => { window.NextLevel?.setPolish({ items: null }); refresh(); }} style={{ ...outlineBtn, flex: 1 }}>Keep mine</button>
          </div>
        </div>
      )}
    </section>
  );

  const exportBtn = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', fontWeight: 700, color: '#1F6F3D', background: '#E8F5EC', border: '1px solid #BFE0C8', borderRadius: '10px', padding: '10px 12px' }}>
        <span aria-hidden="true">&#10003;</span>
        <span>Saved. Everything saves on this device as you type, so you can close the app any time.</span>
      </div>
      <button onClick={() => setSheetOpen(true)} style={{ ...solidBtn, minHeight: '56px', fontSize: '17px' }}>Job Sheet (read, print, save as PDF)</button>
      <button onClick={onHome} style={{ ...outlineBtn, minHeight: '52px', fontSize: '16px' }}>Done &mdash; back to Jobs</button>
      <div style={{ borderTop: '1px solid ' + LINE, paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={heading}>MOVE THIS JOB</div>
        <button onClick={() => window.NextLevel?.sendJob()} style={{ ...outlineBtn, minHeight: '46px', fontSize: '15px' }}>Move this job to another device</button>
        <div style={{ fontSize: '12px', color: MUTED }}>Packs the whole job (photos, notes, sketches, customer info) into one file that your tablet or laptop can open and pick up as a job. It is not a readable page. Use the Job Sheet for that.</div>
      </div>
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9000, background: CREAM, color: INK, fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif', display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: INK, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
        <button onClick={onHome} style={headBtn}>&lsaquo; Jobs</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '18px', fontWeight: 500 }}><span style={{ color: EMBER }}>Next </span><span style={{ color: MOSS }}>Level</span> <span style={{ color: CREAM, fontWeight: 800, letterSpacing: '1px', fontSize: '13px' }}>CAPTURE</span></div>
          <div style={{ fontSize: '12px', color: '#B9B4AC', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{data.customer || data.name}</div>
          <div style={{ fontSize: '11px', color: '#9D978F', whiteSpace: 'nowrap' }}>{BUILD_STAMP}</div>
        </div>
        <button onClick={onFull} style={headBtn}>Design</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        {wide ? (
          <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '18px 16px 28px', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '22px', alignItems: 'start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>{customerCard}{pictures}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>{notesCard}{jobNotes}{exportBtn}</div>
          </div>
        ) : (
          <div style={{ padding: '18px 16px 28px', display: 'flex', flexDirection: 'column', gap: '22px' }}>
            {customerCard}{pictures}{notesCard}{jobNotes}{exportBtn}
          </div>
        )}
      </div>
      <style>{'.modal-overlay{z-index:9500 !important}.toast{z-index:9600 !important}'}</style>
      {sheetOpen && <JobSheet data={data} rev={rev} onClose={() => setSheetOpen(false)} />}
      {viewId && <Viewer data={data} rev={rev} startId={viewId} wide={wide} onClose={closeViewer} />}
    </div>
  );
}
