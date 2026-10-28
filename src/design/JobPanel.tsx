// Slide-out job panel for the Design Studio, modelled on the one in XL: a tab on the left edge. Tap it to open
// the job (about a quarter of the screen), pull the edge wider (up to half), "Split screen" for half and half.
// On wide screens it pushes the drawing over; on a phone it slides over the top. Read-only.
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPE, type ReactNode } from 'react';

const PREF_KEY = 'nl.designpanel.v1';
const MIN_FRAC = 0.2, MAX_FRAC = 0.5, DEFAULT_FRAC = 0.28;
const clamp = (n: number) => Math.min(MAX_FRAC, Math.max(MIN_FRAC, n));
type Pref = { open: boolean; frac: number; back: number; tab: 'notes' | 'pictures' };
function loadPref(): Pref {
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
    const back = clamp(Number(p.back) || DEFAULT_FRAC);
    return { open: Boolean(p.open), frac: clamp(Number(p.frac) || DEFAULT_FRAC), back: back >= MAX_FRAC - 0.05 ? DEFAULT_FRAC : back, tab: p.tab === 'pictures' ? 'pictures' : 'notes' };
  } catch { return { open: false, frac: DEFAULT_FRAC, back: DEFAULT_FRAC, tab: 'notes' }; }
}


const head: CSSProperties = { fontSize: '12px', fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--moss)', borderBottom: '1px solid rgba(238,241,238,0.15)', paddingBottom: '4px', marginTop: '18px' };

function Thumb({ id, caption, note, onOpen }: { id: string; caption: string; note: string; onOpen: (url: string, cap: string, note: string) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let on = true; window.NextLevel?.photoUrl(id).then(u => { if (on) setUrl(u); }); return () => { on = false; }; }, [id]);
  return (
    <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', marginBottom: '12px' }}>
      <div onClick={() => url && onOpen(url, caption, note)} style={{ width: '96px', height: '96px', flexShrink: 0, borderRadius: '8px', background: '#222', overflow: 'hidden', cursor: 'pointer' }}>
        {url && <img src={url} alt={caption || 'Picture'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
      </div>
      <div style={{ minWidth: 0, fontSize: '14px', lineHeight: 1.4 }}>
        <div style={{ fontWeight: 700, wordBreak: 'break-word' }}>{caption || '(no name)'}</div>
        {note && <div style={{ color: 'var(--muted)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{note}</div>}
      </div>
    </div>
  );
}

/** `children` = the drawing area; the panel sits to its left. */
export default function JobPanel({ children }: { children: ReactNode }) {
  const [pref, setPref] = useState<Pref>(loadPref);
  const [vw, setVw] = useState(() => window.innerWidth);
  const [dragging, setDragging] = useState(false);
  const [big, setBig] = useState<{ url: string; cap: string; note: string } | null>(null);
  const [, setTick] = useState(0);
  const [pdfBusy, setPdfBusy] = useState(false);
  const drag = useRef<{ startX: number; startW: number; startFrac: number; moved: boolean } | null>(null);

  useEffect(() => { const f = () => setVw(window.innerWidth); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, []);
  useEffect(() => { try { localStorage.setItem(PREF_KEY, JSON.stringify(pref)); } catch { /* not saved */ } }, [pref]);
  useEffect(() => window.NextLevel?.onCapture(() => setTick(t => t + 1)), []);

  const narrow = vw < 760;
  const panelW = pref.open ? (narrow ? Math.round(vw * 0.9) - 30 : Math.round(vw * pref.frac)) : 0;
  const maxPx = vw * MAX_FRAC;
  const isSplit = pref.open && pref.frac >= MAX_FRAC - 0.02;
  const toggleSplit = () => setPref(p => p.open && p.frac >= MAX_FRAC - 0.02 ? { ...p, frac: p.back } : { ...p, open: true, frac: MAX_FRAC, back: p.open && p.frac < MAX_FRAC - 0.05 ? p.frac : p.back });

  const onDown = (e: RPE<HTMLButtonElement>) => {
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* fine */ }
    drag.current = { startX: e.clientX, startW: panelW, startFrac: pref.frac, moved: false }; setDragging(true);
  };
  const onMove = (e: RPE<HTMLButtonElement>) => {
    const d = drag.current; if (!d || narrow) return;
    const dx = e.clientX - d.startX; if (Math.abs(dx) > 4) d.moved = true; if (!d.moved) return;
    const want = d.startW + dx;
    if (want < vw * MIN_FRAC * 0.6) { setPref(p => ({ ...p, open: false, frac: d.startFrac })); return; }
    setPref(p => ({ ...p, open: true, frac: clamp(Math.min(want, maxPx) / vw) }));
  };
  const onUp = () => { const d = drag.current; drag.current = null; setDragging(false); if (d && !d.moved) setPref(p => ({ ...p, open: !p.open })); };

  const data = window.NextLevel?.getCapture() || null;
  const openReport = async () => {
    if (!data || pdfBusy) return; setPdfBusy(true);
    try {
      const { buildJobSheetPdf } = await import('../lib/jobSheetPdf');
      const built = await buildJobSheetPdf(data, id => window.NextLevel?.photoUrl(id) ?? Promise.resolve(null));
      const url = URL.createObjectURL(built.blob); window.open(url, '_blank'); setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { /* quiet: the notes and pictures are right here anyway */ } finally { setPdfBusy(false); }
  };

  const tabBtn = (key: 'notes' | 'pictures', label: string) => (
    <button key={key} onClick={() => setPref(p => ({ ...p, tab: key }))} style={{ background: 'none', border: 'none', borderBottom: `3px solid ${pref.tab === key ? 'var(--moss)' : 'transparent'}`, color: pref.tab === key ? 'var(--moss)' : 'var(--muted)', fontWeight: 800, fontSize: '12px', letterSpacing: '0.14em', textTransform: 'uppercase', padding: '10px 12px', cursor: 'pointer', minHeight: '44px' }}>{label}</button>
  );

  const panel = (
    <div style={{ width: panelW, height: '100%', overflow: 'hidden', background: 'var(--ink)', color: 'var(--cream)', borderRight: pref.open ? '2px solid rgba(138,154,91,0.6)' : 'none', transition: dragging ? 'none' : 'width 180ms ease', flexShrink: 0, ...(narrow ? { position: 'absolute', left: 30, top: 0, bottom: 0, zIndex: 20 } : {}) }}>
      {pref.open && (
        <div style={{ height: '100%', overflowY: 'auto', padding: '8px 16px 96px 16px', boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', borderBottom: '1px solid rgba(238,241,238,0.15)' }}>
            {tabBtn('notes', 'Job notes')}{tabBtn('pictures', `Pictures${data ? ` (${data.photos.length})` : ''}`)}
            {!narrow && <button onClick={toggleSplit} style={{ marginLeft: 'auto', marginBottom: '6px', background: 'none', border: 'none', color: 'var(--moss)', fontWeight: 700, fontSize: '13px', cursor: 'pointer', minHeight: '36px' }}>{isSplit ? 'Narrower' : 'Split screen'}</button>}
          </div>
          {!data ? <p style={{ color: 'var(--muted)' }}>No job is open.</p> : pref.tab === 'notes' ? (
            <>
              <div style={{ fontSize: '12px', letterSpacing: '0.1em', color: 'var(--muted)', fontWeight: 700, marginTop: '12px' }}>FROM CAPTURE</div>
              <h2 style={{ margin: '4px 0 0', fontSize: '20px', lineHeight: 1.2, wordBreak: 'break-word' }}>{data.customer || data.name || 'This job'}</h2>
              {data.address && <div style={{ color: 'var(--muted)', fontSize: '14px', wordBreak: 'break-word' }}>{data.address}</div>}
              {data.jobDesc && <div style={{ marginTop: '8px', fontWeight: 700, fontSize: '15px', wordBreak: 'break-word' }}>{data.jobDesc}</div>}
              <h3 style={head}>Job notes</h3>
              <div style={{ marginTop: '8px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '15px', lineHeight: 1.55, userSelect: 'text' }}>{data.jobNotes.trim() || <span style={{ color: 'var(--muted)' }}>No job notes were written on this job.</span>}</div>
              {data.scratch.length > 0 && (<><h3 style={head}>Reminders</h3><ul style={{ margin: '8px 0 0', paddingLeft: '20px', fontSize: '15px', lineHeight: 1.5 }}>{data.scratch.map(s => <li key={s.id} style={{ wordBreak: 'break-word' }}>{s.text}</li>)}</ul></>)}
              <button onClick={openReport} disabled={pdfBusy} style={{ marginTop: '20px', minHeight: '44px', padding: '0 16px', borderRadius: '10px', border: '1px solid rgba(238,241,238,0.25)', background: 'rgba(238,241,238,0.06)', color: 'var(--cream)', fontWeight: 700, cursor: 'pointer' }}>{pdfBusy ? 'Building…' : 'Open Field Report (PDF)'}</button>
            </>
          ) : (
            <div style={{ marginTop: '14px' }}>
              {data.photos.length === 0 && <p style={{ color: 'var(--muted)' }}>No pictures on this job yet.</p>}
              {data.photos.map(p => <div key={p.id}><Thumb id={p.id} caption={p.caption} note={p.note} onOpen={(url, cap, note) => setBig({ url, cap, note })} /></div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div style={{ position: 'relative', display: 'flex', flex: 1, minHeight: 0, minWidth: 0 }}>
      {!narrow && panel}
      <button onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} aria-label={pref.open ? 'Put the job panel away' : 'Open the job panel'} title="Tap to open or close. Pull to resize."
        style={{ flexShrink: 0, width: '30px', border: 'none', borderRight: '1px solid rgba(238,241,238,0.12)', background: pref.open ? 'rgba(138,154,91,0.25)' : 'rgba(238,241,238,0.06)', color: 'var(--cream)', cursor: 'ew-resize', touchAction: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, zIndex: 21 }}>
        <span style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontSize: '12px', fontWeight: 800, letterSpacing: '0.22em' }}>{pref.open ? 'JOB ‹' : 'JOB ›'}</span>
      </button>
      <div style={{ flex: 1, minWidth: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}>{children}</div>
      {narrow && pref.open && panel}
      {big && (
        <div onClick={() => setBig(null)} style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.9)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <img src={big.url} alt={big.cap} style={{ maxWidth: '100%', maxHeight: '78vh', objectFit: 'contain' }} />
          <div style={{ color: '#fff', marginTop: '10px', textAlign: 'center', maxWidth: '640px' }}><b>{big.cap}</b>{big.note && <div style={{ color: '#cbd5e1', whiteSpace: 'pre-wrap' }}>{big.note}</div>}<div style={{ color: '#94a3b8', fontSize: '12px', marginTop: '6px' }}>Tap anywhere to close</div></div>
        </div>
      )}
    </div>
  );
}
