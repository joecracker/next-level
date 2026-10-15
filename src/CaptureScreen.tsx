import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';

// New Capture screen (test drive). Sits on top of the existing app and talks to
// it ONLY through window.NextLevel (bridge at the end of src/app.ts), so the
// job record, photo storage and Photo Booth markup are the same ones the old
// screens use. Nothing in the old screens is changed or removed.

export type CapturePhoto = { id: string; caption: string; note: string; timestamp: string };
export type ScratchItem = { id: string; text: string };
export type CaptureData = {
  id: string; name: string;
  customer: string; phone: string; address: string; date: string;
  jobDesc: string; jobNotes: string;
  photos: CapturePhoto[];
  scratch: ScratchItem[];
};
export type CapturePatch = Partial<Pick<CaptureData, 'customer' | 'phone' | 'address' | 'date' | 'jobDesc' | 'jobNotes'>>;

const LABEL_KEY = 'nl_label_size';
function readSize(): number {
  try { const v = parseInt(localStorage.getItem(LABEL_KEY) || '', 10); return v >= 14 && v <= 60 ? v : 22; } catch { return 22; }
}
function writeSize(v: number) { try { localStorage.setItem(LABEL_KEY, String(v)); } catch { /* ignore */ } }
function today(): string { const d = new Date(); return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`; }

const INK = '#15120F', EMBER = '#E8622C', CREAM = '#F5F3EF', MUTED = '#6B665F', LINE = '#D9D5CE';

const fieldLabel: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', fontWeight: 700, color: MUTED, minWidth: 0 };
const fieldInput: CSSProperties = {
  boxSizing: 'border-box', width: '100%', minHeight: '46px', border: '1px solid #C9C4BC', borderRadius: '10px',
  padding: '0 12px', fontSize: '17px', background: '#FAF9F6', color: INK, fontFamily: 'inherit',
};
const card: CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: '16px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' };
const heading: CSSProperties = { margin: 0, fontSize: '13px', letterSpacing: '2px', fontWeight: 800, color: '#B8481C' };
const bigBtn: CSSProperties = { minHeight: '52px', borderRadius: '12px', fontSize: '16px', fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' };
const outlineBtn: CSSProperties = { ...bigBtn, border: `2px solid ${INK}`, background: 'transparent', color: INK };
const solidBtn: CSSProperties = { ...bigBtn, border: 'none', background: EMBER, color: INK };
const headBtn: CSSProperties = {
  minHeight: '40px', padding: '0 14px', borderRadius: '10px', border: '1px solid rgba(245,243,239,0.3)',
  background: 'transparent', color: CREAM, fontSize: '14px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
};

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
    <div style={{ position: 'fixed', inset: 0, zIndex: 9100, background: CREAM, display: 'flex', flexDirection: wide ? 'row' : 'column' }}>
      {imageArea}
      {panel}
    </div>
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
  const closeViewer = useCallback(() => setViewId(null), []);

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

  const customerCard = (
    <section style={card}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h2 style={heading}>CUSTOMER</h2>
        <span style={{ fontSize: '12px', color: MUTED }}>same fields as the Excel</span>
      </div>
      {field('Customer Name', data.customer, 'customer')}
      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>{field('Date', data.date, 'date')}</div>
        <div style={{ flex: 1.3, minWidth: 0 }}>{field('Customer Phone', data.phone, 'phone', 'tel')}</div>
      </div>
      {field('Customer Address', data.address, 'address')}
      {field('Description of Job', data.jobDesc, 'jobDesc')}
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
          <div style={{ display: 'flex', gap: '8px' }}>
            <input value={newLine} onChange={e => setNewLine(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addLine(); }}
              placeholder="Type a reminder, press Enter" enterKeyHint="done" autoComplete="off" style={{ ...fieldInput, flex: 1 }} />
            <button onClick={addLine} style={{ ...solidBtn, minHeight: '46px', padding: '0 18px' }}>Add</button>
          </div>
          {noteCount === 0 && (
            <div style={{ fontSize: '15px', color: MUTED }}>One-liners go here: oak cabinets, brushed nickel faucets, tear out...</div>
          )}
          {scratch.map(s => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {dot('#8A857E')}
              <input value={s.text} onChange={e => editLine(s.id, e.target.value)} aria-label="Reminder"
                style={{ flex: 1, minWidth: 0, minHeight: '44px', border: 'none', borderBottom: '1px solid #E6E2DB', background: 'transparent', fontSize: '18px', color: INK, fontFamily: 'inherit', padding: 0 }} />
              <button aria-label="Remove reminder" onClick={() => removeLine(s.id)} style={{ flex: 'none', width: '44px', height: '44px', border: 'none', background: 'transparent', color: MUTED, fontSize: '22px', cursor: 'pointer' }}>&times;</button>
            </div>
          ))}
          {withNotes.map(({ p, i }) => (
            <button key={p.id} onClick={() => setViewId(p.id)} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', width: '100%', textAlign: 'left', padding: 0, border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit', color: INK }}>
              <span style={{ marginTop: '8px', display: 'flex' }}>{dot('#8A857E')}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: '18px', lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>{p.note}</span>
              <span style={{ flex: 'none', maxWidth: '38%', fontSize: '12px', fontWeight: 800, color: '#B8481C', border: '1px solid #E6C9BA', borderRadius: '8px', padding: '3px 8px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.caption || 'Picture ' + (i + 1)}</span>
            </button>
          ))}
        </>
      )}
    </section>
  );

  const jobNotes = (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h2 style={heading}>JOB NOTES</h2>
        <span style={{ fontSize: '12px', color: MUTED }}>tear-out to debris removal</span>
      </div>
      <textarea value={data.jobNotes} onChange={e => set({ jobNotes: e.target.value })} rows={wide ? 12 : 8}
        placeholder="Say or type what happens on this job, start to finish. (Tip: use your keyboard's mic.)"
        style={{ ...fieldInput, background: '#fff', fontSize: '17px', lineHeight: 1.45, padding: '14px', borderRadius: '14px', resize: 'vertical' }} />
      <button disabled style={{ ...solidBtn, minHeight: '54px', fontSize: '17px', opacity: 0.45, cursor: 'not-allowed' }}>Polish (coming next)</button>
    </section>
  );

  const exportBtn = (
    <button onClick={() => window.NextLevel?.exportReport()} style={{ ...outlineBtn, minHeight: '56px', fontSize: '17px' }}>Send / Export this job</button>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9000, background: CREAM, color: INK, fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif', display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: INK, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
        <button onClick={onHome} style={headBtn}>Home</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '18px', fontWeight: 500 }}><span style={{ color: CREAM }}>Next </span><span style={{ color: EMBER }}>Level</span> <span style={{ color: CREAM, fontWeight: 800, letterSpacing: '1px', fontSize: '13px' }}>CAPTURE</span></div>
          <div style={{ fontSize: '12px', color: '#B9B4AC', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{data.customer || data.name}</div>
        </div>
        <button onClick={onFull} style={headBtn}>Full app</button>
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
      {viewId && <Viewer data={data} rev={rev} startId={viewId} wide={wide} onClose={closeViewer} />}
    </div>
  );
}
