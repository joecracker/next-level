import { useEffect, useState, useRef, useCallback, type CSSProperties } from 'react';
import Webcam from 'react-webcam';
import { initNextLevel } from './app';

// Live-camera modal. Works on desktop (Surface) AND phones via getUserMedia,
// unlike the native <input capture> which desktop browsers ignore.
// On snap: feed the photo into the existing #photo-input-camera pipeline
// (Photo Booth markup → savePhotoBlob → IndexedDB) — zero app.ts changes.
type JobSummary = { id: string; name: string; category: string; photoCount: number; noteCount: number };
declare global {
  interface Window {
    NextLevel?: {
      newJob: () => string;
      listJobs: () => JobSummary[];
      openJob: (id: string) => void;
      openSkipCategory: () => void;
    };
  }
}

function OpenJobPicker({ onOpen, onCancel }: { onOpen: (id: string) => void; onCancel: () => void }) {
  const [q, setQ] = useState('');
  const jobs = (window.NextLevel?.listJobs() || [])
    .filter(j => !q.trim() || j.name.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9998, background: 'var(--ink)',
      display: 'flex', flexDirection: 'column', padding: '20px', boxSizing: 'border-box',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
        <button onClick={onCancel} style={{ background: 'none', border: 'none', color: 'var(--cream)', fontSize: '26px', cursor: 'pointer', lineHeight: 1 }}>&larr;</button>
        <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--cream)' }}>Open Job</div>
      </div>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search jobs…" autoFocus style={{
        padding: '12px 14px', borderRadius: '12px', border: '1px solid rgba(245,243,239,0.2)',
        background: 'rgba(245,243,239,0.06)', color: 'var(--cream)', fontSize: '16px', marginBottom: '14px', outline: 'none',
      }} />
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {jobs.length === 0 ? (
          <div style={{ color: 'var(--muted)', textAlign: 'center', marginTop: '30px', fontSize: '14px' }}>
            {q.trim() ? 'No jobs match that search' : 'No jobs yet — start one with New Job'}
          </div>
        ) : jobs.map(j => (
          <button key={j.id} onClick={() => onOpen(j.id)} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px',
            padding: '16px', borderRadius: '14px', border: '1px solid rgba(245,243,239,0.14)',
            background: 'rgba(245,243,239,0.05)', color: 'var(--cream)', cursor: 'pointer', textAlign: 'left',
          }}>
            <span style={{ minWidth: 0 }}>
              <div style={{ fontSize: '16px', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.name}</div>
              <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>{j.category} &middot; {j.photoCount} photo{j.photoCount === 1 ? '' : 's'} &middot; {j.noteCount} note{j.noteCount === 1 ? '' : 's'}</div>
            </span>
            <span style={{ color: 'var(--ember)', fontSize: '22px', flexShrink: 0 }}>&rsaquo;</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function CameraModal({ onClose }: { onClose: () => void }) {
  const webcamRef = useRef<Webcam>(null);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [err, setErr] = useState<string | null>(null);

  const snap = useCallback(() => {
    const src = webcamRef.current?.getScreenshot();
    if (!src) return;
    fetch(src).then(r => r.blob()).then(blob => {
      const file = new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' });
      const input = document.getElementById('photo-input-camera') as HTMLInputElement | null;
      if (input) {
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      onClose();
    });
  }, [onClose]);

  const round = (bg: string): CSSProperties => ({
    width: '56px', height: '56px', borderRadius: '50%', border: 'none', cursor: 'pointer',
    background: bg, fontSize: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center',
    boxShadow: '0 2px 10px rgba(0,0,0,0.4)',
  });

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000, background: '#000',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    }}>
      {err ? (
        <div style={{ color: 'var(--cream)', textAlign: 'center', padding: '24px', maxWidth: '360px' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>📷🚫</div>
          <div style={{ fontSize: '15px', lineHeight: 1.5 }}>{err}</div>
          <button onClick={onClose} style={{ marginTop: '20px', padding: '12px 24px', borderRadius: '10px', border: 'none', background: 'var(--ember)', color: 'var(--ink)', fontWeight: 800, fontSize: '15px', cursor: 'pointer' }}>Close</button>
        </div>
      ) : (
        <>
          <Webcam
            ref={webcamRef}
            {...({
              audio: false,
              screenshotFormat: 'image/jpeg',
              screenshotQuality: 0.92,
              videoConstraints: { facingMode: facing },
              onUserMediaError: () => setErr('Could not open the camera. Check that the browser has camera permission, then try again.'),
              style: { maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain' },
            } as any)}
          />
          <div style={{ position: 'absolute', bottom: '32px', display: 'flex', alignItems: 'center', gap: '36px' }}>
            <button onClick={onClose} style={round('rgba(255,255,255,0.15)')} title="Cancel">✕</button>
            <button onClick={snap} style={{ ...round('var(--ember)'), width: '76px', height: '76px', fontSize: '32px' }} title="Take photo">📸</button>
            <button onClick={() => setFacing(f => f === 'environment' ? 'user' : 'environment')} style={round('rgba(255,255,255,0.15)')} title="Flip camera">🔄</button>
          </div>
        </>
      )}
    </div>
  );
}

function Launcher({ onPick }: { onPick: (door: 'new' | 'open' | 'just' | 'quick') => void }) {
  const doorBtn: CSSProperties = {
    display: 'flex', alignItems: 'center', gap: '16px', width: '100%',
    padding: '20px 24px', borderRadius: '16px', fontSize: '20px', fontWeight: 800,
    letterSpacing: '0.3px', cursor: 'pointer', textAlign: 'left',
    border: '2px solid rgba(245,243,239,0.15)', background: 'rgba(245,243,239,0.04)',
    color: 'var(--cream)', transition: 'transform 0.08s ease, background 0.15s ease',
  };
  const iconWrap: CSSProperties = { fontSize: '30px', width: '40px', textAlign: 'center', flexShrink: 0 };
  const sub: CSSProperties = { fontSize: '12px', fontWeight: 500, color: 'var(--muted)', marginTop: '2px' };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999, background: 'var(--ink)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '24px', boxSizing: 'border-box', overflowY: 'auto',
    }}>
      <div style={{ fontSize: '42px', fontWeight: 500, letterSpacing: '0.5px', marginBottom: '6px' }}>
        <span style={{ color: 'var(--cream)' }}>Next </span><span style={{ color: 'var(--ember)' }}>Level</span>
      </div>
      <div style={{ fontSize: '22px', fontWeight: 300, letterSpacing: '3px', color: 'var(--cream)', marginBottom: '12px' }}>Field &amp; Desk</div>
      <div style={{ fontSize: '11px', letterSpacing: '3px', color: 'var(--muted)', marginBottom: '40px' }}>MEASURE &middot; DESIGN &middot; DELIVER</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: '100%', maxWidth: '440px' }}>
        <button onClick={() => onPick('new')} style={{ ...doorBtn, border: 'none', background: 'var(--ember)', color: 'var(--ink)' }}>
          <span style={iconWrap}>🔨</span>
          <span>New Job<div style={{ ...sub, color: 'rgba(21,18,15,0.65)' }}>Start capturing a fresh job</div></span>
        </button>
        <button onClick={() => onPick('open')} style={doorBtn}>
          <span style={iconWrap}>📂</span>
          <span>Open Job<div style={sub}>Pick up where you left off</div></span>
        </button>
        <button onClick={() => onPick('just')} style={doorBtn}>
          <span style={iconWrap}>✏️</span>
          <span>Just Draw<div style={sub}>Already have the info — go straight to the layout</div></span>
        </button>
        <button onClick={() => onPick('quick')} style={doorBtn}>
          <span style={iconWrap}>⚡</span>
          <span>Quick Draw<div style={sub}>Grab a fast one — photo or sketch, in and out</div></span>
        </button>
      </div>
    </div>
  );
}

const STAGES = ['capture', 'draw', 'review'] as const;
type Stage = typeof STAGES[number];
const STAGE_LABEL: Record<Stage, string> = { capture: 'Capture', draw: 'Draw', review: 'Review' };

function StageBar({ stage, setStage, onHome }: { stage: Stage; setStage: (s: Stage) => void; onHome: () => void }) {
  const idx = STAGES.indexOf(stage);
  const next = STAGES[idx + 1];
  const tab = (s: Stage): CSSProperties => ({
    flex: 1, padding: '10px 8px', fontSize: '14px', fontWeight: 800, letterSpacing: '0.3px',
    cursor: 'pointer', border: 'none', borderRadius: '10px',
    background: s === stage ? 'var(--ember)' : 'transparent',
    color: s === stage ? 'var(--ink)' : 'var(--muted)',
    transition: 'background 0.12s ease, color 0.12s ease',
  });
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0,
      background: 'var(--ink)', borderBottom: '1px solid rgba(245,243,239,0.12)',
      padding: '8px 12px', boxSizing: 'border-box',
    }}>
      <button onClick={onHome} title="Home — start or switch jobs" style={{
        flexShrink: 0, width: '40px', height: '40px', borderRadius: '10px', cursor: 'pointer',
        border: '1px solid rgba(245,243,239,0.15)', background: 'rgba(245,243,239,0.05)',
        color: 'var(--cream)', fontSize: '18px',
      }}>🏠</button>
      <div style={{ display: 'flex', flex: 1, gap: '4px', background: 'rgba(245,243,239,0.05)', padding: '4px', borderRadius: '12px' }}>
        {STAGES.map(s => (
          <button key={s} onClick={() => setStage(s)} style={tab(s)}>{STAGE_LABEL[s]}</button>
        ))}
      </div>
      {next ? (
        <button onClick={() => setStage(next)} style={{
          flexShrink: 0, padding: '10px 16px', fontSize: '14px', fontWeight: 800, cursor: 'pointer',
          border: '2px solid var(--ember)', borderRadius: '10px', background: 'transparent', color: 'var(--ember)',
        }}>{STAGE_LABEL[next]} &rarr;</button>
      ) : (
        <button disabled style={{
          flexShrink: 0, padding: '10px 16px', fontSize: '14px', fontWeight: 800,
          border: '2px solid rgba(245,243,239,0.15)', borderRadius: '10px', background: 'transparent',
          color: 'var(--muted)', opacity: 0.6,
        }}>Finish</button>
      )}
    </div>
  );
}

function CanvasModeToggle({ onOpenCamera }: { onOpenCamera: () => void }) {
  // Draw is the resting state (the canvas IS the drawing surface). Camera is a
  // momentary trip: fire the existing native-camera input → Photo Booth markup →
  // back to the canvas. Reused by Capture and Quick Draw.
  const btn = (active: boolean): CSSProperties => ({
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
    width: '58px', padding: '9px 0', borderRadius: '12px', cursor: 'pointer',
    fontSize: '22px', fontWeight: 700, lineHeight: 1,
    border: active ? 'none' : '1px solid rgba(255,255,255,0.18)',
    background: active ? 'var(--ember)' : 'rgba(21,18,15,0.82)',
    color: active ? 'var(--ink)' : 'var(--cream)',
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
  });
  const lbl: CSSProperties = { fontSize: '10px', fontWeight: 800, letterSpacing: '0.3px' };
  return (
    <div style={{ position: 'absolute', left: '12px', bottom: '12px', zIndex: 60, display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={btn(true)}>✏️<span style={lbl}>DRAW</span></div>
      <div onClick={onOpenCamera} style={btn(false)}>📷<span style={lbl}>PHOTO</span></div>
    </div>
  );
}

export default function App() {
  const [showLauncher, setShowLauncher] = useState(true);
  const [openPicker, setOpenPicker] = useState(false);
  const [stage, setStage] = useState<Stage>('capture');
  const [cameraOpen, setCameraOpen] = useState(false);

  useEffect(() => {
    initNextLevel();
  }, []);

  useEffect(() => {
    const sb = document.getElementById('sidebar');
    if (sb) sb.dataset.stage = stage;
  }, [stage, showLauncher]);

  const pickDoor = (door: 'new' | 'open' | 'just' | 'quick') => {
    if (door === 'open') {
      setOpenPicker(true);
      return; // launcher stays until a job is picked (or cancelled)
    }
    setStage(door === 'just' || door === 'quick' ? 'draw' : 'capture');
    setShowLauncher(false);
    setTimeout(() => {
      if (door === 'new') {
        window.NextLevel?.newJob();
      } else if (door === 'just' || door === 'quick') {
        window.NextLevel?.openSkipCategory();
      }
    }, 60);
  };

  const openExistingJob = (id: string) => {
    setStage('capture');
    setOpenPicker(false);
    setShowLauncher(false);
    setTimeout(() => window.NextLevel?.openJob(id), 60);
  };

  const goHome = () => {
    setOpenPicker(false);
    setShowLauncher(true);
  };

  return (
    <>
      {showLauncher && <Launcher onPick={pickDoor} />}
      {openPicker && <OpenJobPicker onOpen={openExistingJob} onCancel={() => setOpenPicker(false)} />}
      {cameraOpen && <CameraModal onClose={() => setCameraOpen(false)} />}
      <div id="app-shell">
        {!showLauncher && <StageBar stage={stage} setStage={setStage} onHome={goHome} />}
        <div id="app">
      <aside id="sidebar">
        <div className="sidebar-header">
          <h2 style={{ fontSize: '26px', letterSpacing: '0.5px', lineHeight: 1.1 }}><span style={{ color: 'var(--cream)' }}>Next </span><span style={{ color: 'var(--ember)' }}>Level</span></h2>
          <div style={{ fontSize: '12px', fontWeight: 400, letterSpacing: '2.5px', color: 'var(--muted)', marginTop: '3px' }}>FIELD &amp; DESK</div>
          <span id="sidebar-close" className="sidebar-close">&times;</span>
        </div>
        <section className="sidebar-section stage-section s-capture" id="project-contact-section">
          <div className="section-title">Project & Contact</div>
          <input type="text" id="customer-name" placeholder="Customer Name" autoComplete="off" />
          <input type="tel" id="customer-phone" placeholder="Phone Number" autoComplete="off" style={{ marginTop: '6px' }} />
          <input type="email" id="customer-email" placeholder="Email Address" autoComplete="off" style={{ marginTop: '6px' }} />
          <input type="text" id="customer-address" placeholder="Job Site Address" autoComplete="off" style={{ marginTop: '6px' }} />
          <div className="btn-row" style={{ marginTop: '6px' }}>
            <button id="btn-open-wizard" className="btn btn-sm btn-accent" style={{ background: 'var(--ember)', color: 'var(--ink)', border: 'none' }}>🪄 Wizard</button>
            <button id="btn-save-project" className="btn btn-sm">Save</button>
          </div>
          <div className="project-search-wrap" style={{ marginTop: '12px' }}>
            <input type="text" id="project-search" placeholder="Search or open a job..." autoComplete="off" />
            <ul id="project-list" className="project-list"></ul>
          </div>
        </section>
        <section className="sidebar-section stage-section s-draw">
          <button id="btn-pages-drawer" className="btn btn-block" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.08)', border: '1px solid var(--border)', color: '#fff', fontWeight: '600', padding: '8px 12px', cursor: 'pointer' }}>
            <span>📄 Pages</span>
            <span id="pages-drawer-arrow">&#9660;</span>
          </button>
          <div id="pages-drawer-content" className="hidden" style={{ marginTop: '8px' }}>
            <div id="page-tabs" className="page-tabs"></div>
            <button id="btn-add-page" className="btn btn-sm btn-accent btn-block" style={{ marginTop: '6px' }}>+ Add Page</button>
            <button id="btn-duplicate-page" className="btn btn-sm btn-block" style={{ marginTop: '6px', background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid var(--border)' }} title="Copies the current page's walls, doors &amp; windows into a new page — handy for a same-room, different-trade page (e.g. Plumbing → Electrical) without redrawing the outline">⧉ Duplicate Current Page</button>
            <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.45)', marginTop: '4px' }}>Double-tap a page tab to rename it</div>
          </div>
        </section>
        <section className="sidebar-section stage-section s-draw">
          <button id="btn-view-drawer" className="btn btn-block" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.08)', border: '1px solid var(--border)', color: '#fff', fontWeight: '600', padding: '8px 12px', cursor: 'pointer' }}>
            <span>👁️ View & Display</span>
            <span id="view-drawer-arrow">&#9660;</span>
          </button>
          <div id="view-drawer-content" className="hidden" style={{ marginTop: '8px' }}>
            <div id="view-toggle" className="pill-group" style={{ marginBottom: '8px' }}>
              <button className="pill" data-view="after">Proposed</button>
              <button className="pill active" data-view="before">Existing Only</button>
            </div>
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', cursor: 'pointer', color: '#cbd5e1', marginBottom: '6px' }}>
                <input type="checkbox" id="show-dimensions-toggle" defaultChecked style={{ accentColor: 'var(--ember)', width: '14px', height: '14px', cursor: 'pointer' }} />
                <span>Show Dimensions</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', cursor: 'pointer', color: '#cbd5e1' }}>
                <input type="checkbox" id="smart-snapping-toggle" defaultChecked style={{ accentColor: 'var(--ember)', width: '14px', height: '14px', cursor: 'pointer' }} />
                <span>Smart Wall Snapping</span>
              </label>
            </div>
          </div>
        </section>
        <section className="sidebar-section stage-section s-capture">
          <button id="btn-category-drawer" className="btn btn-block" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.08)', border: '1px solid var(--border)', color: '#fff', fontWeight: '600', padding: '8px 12px', cursor: 'pointer' }}>
            <span>🏷️ Project Category</span>
            <span id="category-drawer-arrow">&#9660;</span>
          </button>
          <div id="category-drawer-content" className="hidden" style={{ marginTop: '8px' }}>
            <div id="category-list" className="pill-group">
              <button className="pill active" data-cat="Kitchen">Kitchen</button>
              <button className="pill" data-cat="Bathroom">Bathroom</button>
              <button className="pill" data-cat="Deck">Deck</button>
              <button className="pill" data-cat="Pole Barn">Pole Barn</button>
              <button className="pill" data-cat="Addition">Addition</button>
              <button className="pill" data-cat="General Remodel">General Remodel</button>
            </div>
          </div>
        </section>
        <section className="sidebar-section stage-section s-capture">
          <button id="btn-scope-drawer" className="btn btn-block" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.08)', border: '1px solid var(--border)', color: '#fff', fontWeight: '600', padding: '8px 12px', cursor: 'pointer' }}>
            <span>📐 Scope of Work</span>
            <span id="scope-drawer-arrow">&#9660;</span>
          </button>
          <div id="scope-drawer-content" className="hidden" style={{ marginTop: '8px' }}>
            <div id="scope-list" className="pill-group">
              <button className="pill active" data-scope="Full Build">Full Build</button>
              <button className="pill" data-scope="Floor Only">Floor Only</button>
              <button className="pill" data-scope="Trim Work Only">Trim Work Only</button>
              <button className="pill" data-scope="Drywall Only">Drywall Only</button>
            </div>
          </div>
        </section>
        <section className="sidebar-section stage-section s-draw">
          <button id="btn-tools-drawer" className="btn btn-block" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.08)', border: '1px solid var(--border)', color: '#fff', fontWeight: '600', padding: '8px 12px', cursor: 'pointer' }}>
            <span>🛠️ Tools & Wall Types</span>
            <span id="tools-drawer-arrow">&#9660;</span>
          </button>
          <div id="tools-drawer-content" className="hidden" style={{ marginTop: '8px' }}>
            <div className="btn-row" style={{ marginTop: '6px' }}>
              <button id="btn-draw-wall" className="btn btn-sm btn-accent">Draw Wall (W)</button>
              <button id="btn-select" className="btn btn-sm">Select (V)</button>
              <button id="btn-rect-select" className="btn btn-sm">Box Select (B)</button>
            </div>
            <div id="wall-type-selector" className="pill-group" style={{ marginTop: '6px' }}>
              <button className="pill" data-wtype="new_construction">New</button>
              <button className="pill active" data-wtype="existing_to_remain">Existing</button>
              <button className="pill" data-wtype="demolished">Demo</button>
            </div>
          </div>
        </section>
        <section className="sidebar-section stage-section s-capture s-draw">
          <button id="btn-openings-drawer" className="btn btn-block" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.08)', border: '1px solid var(--border)', color: '#fff', fontWeight: '600', padding: '8px 12px', cursor: 'pointer' }}>
            <span>🚪 Openings (Doors & Windows)</span>
            <span id="openings-drawer-arrow">&#9660;</span>
          </button>
          <div id="openings-drawer-content" className="hidden" style={{ marginTop: '8px' }}>
            <div className="btn-row">
              <button id="btn-place-door" className="btn btn-sm">Door (D)</button>
              <button id="btn-place-window" className="btn btn-sm">Window (N)</button>
            </div>
          </div>
        </section>
        <section className="sidebar-section stage-section s-draw">
          <button id="btn-assets-drawer" className="btn btn-block" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.08)', border: '1px solid var(--border)', color: '#fff', fontWeight: '600', padding: '8px 12px', cursor: 'pointer' }}>
            <span>📦 Assets & Catalog</span>
            <span id="assets-drawer-arrow">&#9660;</span>
          </button>
          <div id="assets-drawer-content" className="hidden" style={{ marginTop: '8px' }}>
            <div className="pill-group" id="asset-cat-tabs" style={{ marginBottom: '8px' }}>
              <button className="pill active" data-asset-cat="cabinet">🗄️ Cabinets</button>
              <button className="pill" data-asset-cat="plumbing">🚿 Plumbing</button>
              <button className="pill" data-asset-cat="electrical">⚡ Electrical</button>
            </div>
            <div id="asset-palette" className="asset-palette"></div>
          </div>
        </section>
        <section className="sidebar-section stage-section s-capture">
          <button id="btn-measurements-drawer" className="btn btn-block" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.08)', border: '1px solid var(--border)', color: '#fff', fontWeight: '600', padding: '8px 12px', cursor: 'pointer' }}>
            <span>📏 Measurements & Specs</span>
            <span id="measurements-drawer-arrow">&#9660;</span>
          </button>
          <div id="measurements-drawer-content" className="hidden" style={{ marginTop: '8px' }}>
            <label className="calc-label">Ceiling Height (in)
              <input type="number" id="ceiling-height" defaultValue={96} min={48} max={240} />
            </label>
            <label className="calc-label">Stud Spacing
              <select id="stud-spacing" defaultValue="16">
                <option value="16">16" O.C.</option>
                <option value="24">24" O.C.</option>
              </select>
            </label>
            <label className="calc-label">Waste Multiplier
              <input type="number" id="waste-multiplier" defaultValue={1.10} min={1.00} max={2.00} step={0.05} />
            </label>
          </div>
        </section>
        <section className="sidebar-section stage-section s-review">
          <button id="btn-takeoff-drawer" className="btn btn-block" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.08)', border: '1px solid var(--border)', color: '#fff', fontWeight: '600', padding: '8px 12px', cursor: 'pointer' }}>
            <span>📋 Takeoff Summary</span>
            <span id="takeoff-drawer-arrow">&#9660;</span>
          </button>
          <div id="takeoff-drawer-content" className="hidden" style={{ marginTop: '8px' }}>
            <div style={{ display: 'flex', gap: '4px', marginBottom: '8px', borderBottom: '1px solid rgba(255,255,255,0.15)', paddingBottom: '6px' }}>
              <button id="btn-to-tab-quantities" className="btn btn-sm" style={{ flex: 1, fontSize: '11px', padding: '4px', background: 'var(--ember)', color: 'var(--ink)', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Quantities</button>
              <button id="btn-to-tab-cabinets" className="btn btn-sm" style={{ flex: 1, fontSize: '11px', padding: '4px', background: 'rgba(255,255,255,0.1)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Cabinet Order List</button>
            </div>
            
            <div id="to-tab-content-quantities">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: '600', color: '#cbd5e1' }}>Calculated Material Quantities</span>
                <button id="btn-edit-takeoff" className="btn btn-sm" style={{ fontSize: '10px', padding: '1px 6px', background: 'rgba(255,255,255,0.1)', border: '1px solid var(--border)', cursor: 'pointer', color: '#fff' }}>✏️ Adjust</button>
              </div>
              <div className="takeoff-results">
                <div className="takeoff-row"><span>Wall Sq Footage:</span><span id="to-sqft">0</span></div>
                <div className="takeoff-row"><span>Trim LF (Net of Cabs):</span><span id="to-trim">0</span></div>
                <div className="takeoff-row"><span>Studs:</span><span id="to-studs">0</span></div>
                <div className="takeoff-row"><span>Drywall (4x8):</span><span id="to-drywall">0</span></div>
                <div className="takeoff-row"><span>Room Area:</span><span id="to-rooms">0 sq ft</span></div>
              </div>
            </div>

            <div id="to-tab-content-cabinets" className="hidden">
              <div style={{ fontSize: '12px', fontWeight: '600', color: '#cbd5e1', marginBottom: '6px' }}>Placed Cabinets for Ordering</div>
              <div id="to-cabinets-list" style={{ maxHeight: '180px', overflowY: 'auto', fontSize: '12px', color: '#fff', background: 'rgba(0,0,0,0.2)', padding: '6px', borderRadius: '4px' }}>
                <div style={{ color: '#9ca3af', fontStyle: 'italic', textAlign: 'center', padding: '8px' }}>No cabinets placed yet.</div>
              </div>
            </div>
          </div>
        </section>
        <section className="sidebar-section stage-section s-capture">
          <div className="section-title">Notes & Photos</div>
          <textarea id="project-notes" rows={3} placeholder="Field notes & observations..."></textarea>
          <button id="btn-drop-pin-tool" className="btn btn-sm btn-block" style={{ marginTop: '6px', marginBottom: '6px', background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid var(--border)', cursor: 'pointer' }}>📌 Drop Note Pin on Canvas</button>
          <div style={{ marginTop: '8px' }}>
            <button id="btn-add-photo" className="btn btn-sm btn-block btn-accent" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', gap: '6px' }}>
              <span>📷 Take / Add Photo</span>
            </button>
            <div id="photo-source-chooser" className="hidden" style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
              <button id="btn-photo-camera" className="btn btn-sm" style={{ flex: 1, cursor: 'pointer', background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid var(--border)' }}>📷 Camera</button>
              <button id="btn-photo-gallery" className="btn btn-sm" style={{ flex: 1, cursor: 'pointer', background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid var(--border)' }}>🖼️ Gallery</button>
            </div>
            <input type="file" id="photo-input-camera" accept="image/*" capture="environment" style={{ display: 'none' }} />
            <input type="file" id="photo-input-gallery" accept="image/*" style={{ display: 'none' }} />
            <div id="photo-gallery" className="photo-gallery" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px', marginTop: '8px' }}></div>
            <div id="storage-meter" style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', marginTop: '8px', textAlign: 'center' }}></div>
          </div>
        </section>
        <section className="sidebar-section stage-section s-review">
          <button id="btn-export-boss" className="btn btn-block btn-accent" style={{ background: 'var(--ember)', color: 'var(--ink)', marginBottom: '6px' }}>📋 Send to Laptop (Boss Report)</button>
          <div className="btn-row" style={{ marginTop: '6px' }}>
            <button id="btn-send-job" className="btn btn-sm btn-block" style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid var(--border)' }} title="Send this one job — walls, photos, notes, everything — to someone else, by text/email/AirDrop/whatever's easiest">📤 Send This Job</button>
            <button id="btn-open-job" className="btn btn-sm btn-block" style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid var(--border)' }} title="Got a job file someone sent you? Open it here">📥 Open a Job</button>
            <input type="file" id="job-file-input" accept=".json,application/json" style={{ display: 'none' }} />
          </div>
          <div className="section-title" style={{ marginTop: '10px' }}>☁ Google Drive Backup</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginTop: '4px' }}>
            <button id="btn-drive-connect" className="btn btn-block" style={{ fontSize: '11px', opacity: 0.9 }}>Connect</button>
            <button id="btn-drive-save" className="btn btn-block" style={{ fontSize: '11px', opacity: 0.9 }}>Save to Drive</button>
          </div>
          <button id="btn-drive-restore" className="btn btn-block" style={{ fontSize: '11px', opacity: 0.9, marginTop: '6px' }}>Restore from Drive</button>
          <div id="drive-status" style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', marginTop: '6px', minHeight: '14px' }}></div>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.15)', marginTop: '14px', paddingTop: '10px' }}>
            <button id="btn-clear-all-data" className="btn btn-sm btn-block" style={{ background: 'rgba(220,38,38,0.15)', color: '#fca5a5', border: '1px solid rgba(220,38,38,0.4)' }} title="Wipe every project and photo — for starting over clean, e.g. after testing">🗑 Clear All Data</button>
          </div>
        </section>
      </aside>

      <div id="sidebar-overlay" className="sidebar-overlay hidden"></div>

      <main id="main-area">
        <div id="toolbar">
          <div className="toolbar-left">
            <button id="btn-toggle-sidebar" className="btn btn-sm toolbar-btn" title="Toggle Sidebar" style={{ fontSize: '26px', lineHeight: '1', fontWeight: 700 }}>&#8249;</button>
            <button id="btn-toolbar-wizard" className="btn btn-sm btn-accent" style={{ background: 'var(--ember)', color: 'var(--ink)', border: 'none', padding: '2px 8px', fontSize: '11px' }}>🪄 Project Wizard</button>
            <span id="toolbar-info">New project</span>
          </div>
          <div className="toolbar-right">
            <button id="btn-undo" className="btn btn-sm toolbar-btn" title="Undo (Ctrl+Z)">&#8634; Undo</button>
            <button id="btn-redo" className="btn btn-sm toolbar-btn" title="Redo (Ctrl+Shift+Z)">&#8635;</button>
            <button id="btn-help" className="btn btn-sm toolbar-btn" title="How To Use Next Level">?</button>
            <span id="conn-status" className="conn-status conn-offline" title="Connection Status" style={{ fontSize: '10px', opacity: 0.6 }}>&#9679;</span>
            <button id="btn-reset-view" className="btn btn-sm toolbar-btn" title="Recenter the view (zoom &amp; pan only — does not change your drawing)">&#8857; Recenter</button>
            <span id="toolbar-zoom">100%</span>
            <span id="build-stamp" style={{ fontSize: '9px', opacity: 0.4, marginLeft: '6px' }} title="Build marker — bumps every push, confirms new code is live">build-2026-09-01-e</span>
          </div>
        </div>
        <div id="workflow-banner" style={{ background: '#f8fafc', borderBottom: '1px solid var(--border)', padding: '6px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', color: '#334155', flexWrap: 'wrap', gap: '6px', zIndex: 5 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontWeight: '700', color: '#1e3a8a' }}>📍 Field Workflow:</span>
            <span>1️⃣ Measure &amp; Draw <b>Existing</b> walls first.</span>
            <span>2️⃣ Switch to <b>Proposed</b> to add New Construction &amp; Doors.</span>
          </div>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button id="banner-btn-existing" className="btn btn-sm" style={{ fontSize: '10px', padding: '2px 6px' }}>👁️ Existing View</button>
            <button id="banner-btn-proposed" className="btn btn-sm btn-accent" style={{ fontSize: '10px', padding: '2px 6px' }}>🚀 Proposed View</button>
          </div>
        </div>
        <div id="canvas-wrap">
          <canvas id="floorplan"></canvas>
          {stage !== 'review' && <CanvasModeToggle onOpenCamera={() => setCameraOpen(true)} />}
          <button id="reference-rail-tab" title="Reference: Notes, Photos, Measurements" style={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)', zIndex: 60, background: 'var(--ember)', color: 'var(--ink)', border: 'none', borderRadius: '8px 0 0 8px', padding: '14px 6px', fontSize: '18px', cursor: 'pointer', boxShadow: '-2px 0 8px rgba(0,0,0,0.25)' }}>🔖</button>
          <div id="reference-rail" className="hidden" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '280px', maxWidth: '85vw', background: 'rgba(20,20,26,0.97)', zIndex: 65, display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 16px rgba(0,0,0,0.35)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.15)', flex: 'none' }}>
              <span style={{ fontWeight: 700, color: '#fff', fontSize: '13px' }}>🔖 Reference</span>
              <button id="reference-rail-close" className="btn btn-sm" style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#fff' }}>&times;</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '4px' }}>📝 Notes (this page)</div>
                <div id="reference-notes" style={{ fontSize: '12px', color: '#f4f4f2', whiteSpace: 'pre-wrap', lineHeight: 1.5, background: 'rgba(255,255,255,0.05)', borderRadius: '6px', padding: '8px', cursor: 'pointer' }} title="Tap to edit notes"></div>
              </div>
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '4px' }}>📏 Measurements</div>
                <div id="reference-specs" style={{ fontSize: '12px', color: '#f4f4f2', lineHeight: 1.6 }}></div>
              </div>
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '4px' }}>📷 Photos <span style={{ opacity: 0.7, fontWeight: 400, textTransform: 'none' }}>(tap to mark up)</span></div>
                <div id="reference-photos" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}></div>
              </div>
            </div>
          </div>
        </div>
        <button id="btn-voice" className="voice-btn" title="Record Voice Note">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
            <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
          </svg>
          <span className="voice-label">Record</span>
        </button>
      </main>

      {/* WALL TYPE MODAL */}
      <div id="wall-modal" className="modal-overlay hidden">
        <div className="modal">
          <div className="modal-title">Wall Type</div>
          <p id="wall-modal-info" className="modal-sub"></p>
          <div className="modal-body">
            <button className="btn btn-block btn-wall-type" data-wtype="existing_to_remain">
              <span className="wall-swatch swatch-existing"></span> Existing to Remain
            </button>
            <button className="btn btn-block btn-wall-type" data-wtype="new_construction">
              <span className="wall-swatch swatch-new"></span> New Construction
            </button>
            <button className="btn btn-block btn-wall-type" data-wtype="demolished">
              <span className="wall-swatch swatch-demo"></span> Demolished
            </button>
          </div>
          <div className="modal-actions">
            <button id="wall-modal-close" className="btn btn-sm">Cancel</button>
          </div>
        </div>
      </div>

      {/* WALL EDIT PANEL */}
      <div id="wall-edit-panel" className="wall-edit-panel hidden">
        <div className="wall-edit-title">Wall Properties</div>
        <label className="calc-label">Length (feet)
          <input type="number" id="wall-edit-length" min="0.1" step="0.25" />
        </label>
        <label className="calc-label">Wall Type
          <select id="wall-edit-type" defaultValue="existing_to_remain">
            <option value="existing_to_remain">Existing to Remain</option>
            <option value="demolished">Demolished (Comes out)</option>
            <option value="new_construction">New Construction</option>
          </select>
        </label>
        <div style={{ marginTop: '8px', marginBottom: '8px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', cursor: 'pointer', color: 'var(--ink)' }}>
            <input type="checkbox" id="wall-edit-lock" style={{ accentColor: 'var(--ember)', width: '14px', height: '14px', cursor: 'pointer' }} />
            <span>Lock Wall (Prevent movement & deletion)</span>
          </label>
        </div>
        <div className="btn-row" style={{ marginTop: '8px' }}>
          <button id="wall-edit-update" className="btn btn-sm btn-accent">Update</button>
          <button id="wall-edit-delete" className="btn btn-sm btn-danger">Delete</button>
        </div>
      </div>

      {/* OPENING EDIT PANEL */}
      <div id="opening-edit-panel" className="wall-edit-panel hidden">
        <div className="wall-edit-title" id="opening-edit-title">Door Properties</div>
        <label className="calc-label">Width (inches)
          <input type="number" id="opening-edit-width" min="1" step="0.25" />
        </label>
        <label className="calc-label" id="opening-height-wrap">Height (inches)
          <input type="number" id="opening-edit-height" min="1" step="0.25" />
        </label>
        <label className="calc-label">Align From
          <select id="opening-edit-ref" defaultValue="left">
            <option value="left">Left End of Wall</option>
            <option value="center">Center of Opening</option>
            <option value="right">Right End of Wall</option>
          </select>
        </label>
        <label className="calc-label">Distance (inches)
          <input type="number" id="opening-edit-dist" min="0" step="0.25" />
        </label>
        <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }} id="opening-edit-dist-ft"></div>
        <div id="opening-flip-wrap" className="btn-row" style={{ marginBottom: '8px' }}>
          <button id="opening-edit-flip" className="btn btn-sm btn-block">&#8646; Flip Swing In/Out</button>
        </div>
        <div style={{ marginTop: '4px', marginBottom: '8px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', cursor: 'pointer', color: 'var(--ink)' }}>
            <input type="checkbox" id="opening-edit-lock" style={{ accentColor: 'var(--ember)', width: '14px', height: '14px', cursor: 'pointer' }} />
            <span>Lock (Prevent movement & deletion)</span>
          </label>
        </div>
        <div className="btn-row" style={{ marginTop: '8px' }}>
          <button id="opening-edit-update" className="btn btn-sm btn-accent">Update</button>
          <button id="opening-edit-delete" className="btn btn-sm btn-danger">Delete</button>
        </div>
      </div>

      {/* DOOR PLACEMENT MODAL */}
      <div id="door-modal" className="modal-overlay hidden">
        <div className="modal">
          <div className="modal-title">Place Door</div>
          <p className="modal-sub">Click on a wall to place this door.</p>
          <div className="modal-body">
            <div className="section-title">Width</div>
            <div className="pill-group" id="door-widths">
              <button className="pill" data-w="18">18"</button>
              <button className="pill" data-w="24">24"</button>
              <button className="pill" data-w="30">30"</button>
              <button className="pill active" data-w="32">32"</button>
              <button className="pill" data-w="36">36"</button>
            </div>
            <div className="section-title" style={{ marginTop: '12px' }}>Type</div>
            <div className="pill-group" id="door-types">
              <button className="pill active" data-t="left_swing">Left Swing</button>
              <button className="pill" data-t="right_swing">Right Swing</button>
              <button className="pill" data-t="opening">Opening</button>
              <button className="pill" data-t="pocket">Pocket</button>
            </div>
          </div>
          <div className="modal-actions">
            <button id="door-modal-cancel" className="btn btn-sm">Cancel</button>
            <button id="door-modal-place" className="btn btn-sm btn-accent">Place on Wall</button>
          </div>
        </div>
      </div>

      {/* WINDOW PLACEMENT MODAL */}
      <div id="window-modal" className="modal-overlay hidden">
        <div className="modal">
          <div className="modal-title">Place Window</div>
          <p className="modal-sub">Click on a wall to place this window.</p>
          <div className="modal-body">
            <label className="calc-label">Width (inches)
              <input type="number" id="window-width" defaultValue="36" min="6" max="240" />
            </label>
            <label className="calc-label">Height (inches)
              <input type="number" id="window-height" defaultValue="36" min="6" max="240" />
            </label>
            <label className="calc-label">Distance from corner (in)
              <input type="number" id="window-distance" defaultValue="4" min="0" />
            </label>
          </div>
          <div className="modal-actions">
            <button id="window-modal-cancel" className="btn btn-sm">Cancel</button>
            <button id="window-modal-place" className="btn btn-sm btn-accent">Place on Wall</button>
          </div>
        </div>
      </div>

      {/* ASSET PROPERTIES MODAL */}
      <div id="asset-edit-modal" className="modal-overlay hidden">
        <div className="modal" style={{ maxWidth: '480px', width: '92%' }}>
          <div className="modal-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span id="asset-modal-title">Edit Asset Properties</span>
            <button id="asset-modal-close-x" className="btn btn-sm" style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--ink)' }}>&times;</button>
          </div>
          <p className="modal-sub">Adjust dimensions, height, rotation, or shower enclosure parameters.</p>
          <div className="modal-body" style={{ padding: '12px 0' }}>
            <label className="calc-label">Name / Item Label
              <input type="text" id="asset-edit-name" placeholder="e.g. B24, UT2484, Walk-In Shower" />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
              <label className="calc-label">Width (in)
                <input type="number" id="asset-edit-width" min="1" step="0.5" />
              </label>
              <label className="calc-label">Depth (in)
                <input type="number" id="asset-edit-depth" min="1" step="0.5" />
              </label>
              <label className="calc-label">Height (in)
                <input type="number" id="asset-edit-height" min="1" step="0.5" />
              </label>
            </div>

            <div id="asset-shower-fields" className="hidden" style={{ background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '6px', marginTop: '10px', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--ember)', marginBottom: '8px' }}>Custom Shower & Enclosure Options</div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                <label className="calc-label">Knee Wall Width (in)
                  <input type="number" id="asset-edit-kneewall" placeholder="e.g. 40" min="0" step="0.5" />
                </label>
                <label className="calc-label">Glass Door Width (in)
                  <input type="number" id="asset-edit-glassdoor" placeholder="e.g. 30" min="0" step="0.5" />
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                <label className="calc-label">Enclosure / Wall Style
                  <select id="asset-edit-wallstyle" style={{ background: 'var(--ink)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', padding: '6px', borderRadius: '4px', width: '100%', fontSize: '11px' }}>
                    <option value="kneewall_glass">Knee Wall w/ Glass Top</option>
                    <option value="full_wall">Full-Height Solid Wall</option>
                    <option value="frameless_glass">Frameless Glass Enclosure</option>
                    <option value="curbless_open">Curbless / Open Roll-In</option>
                  </select>
                </label>

                <label className="calc-label">Drain Location & Type
                  <select id="asset-edit-draintype" style={{ background: 'var(--ink)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', padding: '6px', borderRadius: '4px', width: '100%', fontSize: '11px' }}>
                    <option value="center">Center Point Drain</option>
                    <option value="trench_left">Linear Drain (Left End)</option>
                    <option value="trench_right">Linear Drain (Right End)</option>
                    <option value="trench_back">Linear Drain (Back)</option>
                    <option value="end_left">End Point Drain (Left)</option>
                    <option value="end_right">End Point Drain (Right)</option>
                  </select>
                </label>
              </div>

              <div style={{ display: 'flex', gap: '16px', marginTop: '6px', fontSize: '11px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                  <input type="checkbox" id="asset-edit-rainhead" />
                  <span>🌧️ Ceiling Rain Head</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                  <input type="checkbox" id="asset-edit-wallhead" />
                  <span>🚿 Wall Head / Wand</span>
                </label>
              </div>
            </div>

            <div style={{ marginTop: '10px' }}>
              <label className="calc-label">Rotation Angle</label>
              <div className="pill-group" id="asset-rotation-pills">
                <button className="pill" data-rot="0">0°</button>
                <button className="pill" data-rot="90">90°</button>
                <button className="pill" data-rot="180">180°</button>
                <button className="pill" data-rot="270">270°</button>
              </div>
            </div>
          </div>
          <div className="modal-actions" style={{ display: 'flex', gap: '8px', justifyContent: 'space-between', marginTop: '16px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '12px' }}>
            <button id="asset-modal-delete" className="btn btn-sm btn-danger">🗑️ Delete Asset</button>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button id="asset-modal-cancel" className="btn btn-sm">Cancel</button>
              <button id="asset-modal-save" className="btn btn-sm btn-accent">Save Changes</button>
            </div>
          </div>
        </div>
      </div>

      {/* HELP MODAL */}
      <div id="help-modal" className="modal-overlay hidden">
        <div className="modal modal-help" style={{ maxWidth: '720px', width: '92%' }}>
          <div className="modal-title">📖 Step-by-Step Field Guide</div>
          <div className="modal-body help-body">
            <div className="help-nav" style={{ flexWrap: 'wrap', gap: '4px' }}>
              <a href="#help-step1" className="help-link">1. Project Wizard</a>
              <a href="#help-step2" className="help-link">2. Drawing Walls</a>
              <a href="#help-step3" className="help-link">3. Openings</a>
              <a href="#help-step4" className="help-link">4. Kitchen & Bath Fixtures</a>
              <a href="#help-step5" className="help-link">5. Photos & Notes</a>
              <a href="#help-step6" className="help-link">6. Boss Report / Laptop</a>
            </div>
            <div id="help-step1" className="help-section">
              <h3>Step 1: Setting Up Your Project & Contact Info</h3>
              <p>When you start a job on site, choose your preferred setup mode:</p>
              <ul>
                <li><b>🪄 Project Wizard:</b> Step-by-step guided setup that asks for Client Name, Phone Number, Email Address, Job Site Address, Project Room Title, Category, Ceiling Height, and Stud Spacing. Auto-tailors your canvas and catalogs!</li>
                <li><b>✏️ Skip to Drawing:</b> Jump straight to an existing job's canvas (skip hunting the project list), or start a blank Bathroom/Kitchen with no client info needed.</li>
                <li><b>Sidebar Contact Info:</b> Enter or update complete contact info (Name, Phone, Email, and Address) anytime directly in the left sidebar.</li>
              </ul>
            </div>
            <div id="help-step2" className="help-section">
              <h3>Step 2: Drawing Floor Plan Walls</h3>
              <ol>
                <li>Tap <b>Draw Wall (W)</b> in the sidebar or toolbar.</li>
                <li>Tap once where the wall starts, drag or move to see live dimensions, and tap to finish.</li>
                <li>To adjust, tap <b>Select (V)</b>, click any wall, and type the exact measured length in inches or drag the endpoints.</li>
                <li>Toggle between <b>Existing Walls</b> (Black), <b>New Construction</b> (Blue), and <b>Demolition</b> (Red Dash).</li>
              </ol>
            </div>
            <div id="help-step3" className="help-section">
              <h3>Step 3: Placing Doors & Windows</h3>
              <p><b>Doors:</b> Tap <b>Door (D)</b> &rarr; choose width &amp; swing &rarr; tap on the wall where it goes.</p>
              <p><b>Windows:</b> Tap <b>Window (N)</b> &rarr; enter size &amp; offset &rarr; tap on the wall.</p>
            </div>
            <div id="help-step4" className="help-section">
              <h3>Step 4: Kitchen Cabinets & Bath Shower/Plumbing Fixtures</h3>
              <p><b>Showers & Knee Walls:</b> Select <i>Plumbing</i> catalog to place Walk-In Showers or Rain Head units. Tap any placed shower to customize:</p>
              <ul>
                <li><b>Enclosure Style:</b> Knee Wall w/ Glass, Full Height Solid Wall, Frameless Glass, or Curbless Roll-In.</li>
                <li><b>Drain Position:</b> Center Point, Linear Drain (Left End, Right End, or Back).</li>
                <li><b>Shower Heads:</b> Toggle Ceiling Rain Head or Wall Mounted Head indicators.</li>
              </ul>
              <p><b>Kitchen Cabinets & Vanities:</b> Drag or tap to place base and wall cabinets (starting at 9-inch widths), pantry towers, or vanity units.</p>
              <p><b>Trim & Fillers:</b> A dedicated category is available for 3-inch and 6-inch fillers for base, upper (30", 36", 42"), and tall cabinets. You can also place 8ft lengths of Toe Kick, Scribe Molding, and Base Shoe.</p>
            </div>
            <div id="help-step5" className="help-section">
              <h3>Step 5: Field Notes & Work Area Photos</h3>
              <p><b>Photos (Google Keep Style):</b> Tap <b>📷 Take / Add Photo</b> to capture work area snapshots directly from your tablet camera or photo library. Add a short caption if desired.</p>
              <p><b>Notes & Voice Notes:</b> Type observations in the Notes box or tap the 🎤 Record button for voice notes.</p>
            </div>
            <div id="help-step6" className="help-section">
              <h3>Step 6: Sending to Laptop & Boss Report</h3>
              <p>When finished measuring and sketching:</p>
              <ul>
                <li>Tap <b>📋 Send to Laptop (Boss Report)</b> in the sidebar.</li>
                <li>A clean summary pops up showing your floor plan drawing, photo gallery, field notes, and takeoff calculations.</li>
                <li>Tap <b>🖨️ Print / Save PDF</b> to print or save a PDF to plug into your estimating spreadsheets!</li>
              </ul>
            </div>
          </div>
          <div className="modal-actions">
            <button id="help-modal-close" className="btn btn-sm btn-accent">Got it, let's work!</button>
          </div>
        </div>
      </div>

      {/* TAKEOFF EDIT / CUSTOM OVERRIDES MODAL */}
      <div id="takeoff-edit-modal" className="modal-overlay hidden">
        <div className="modal" style={{ maxWidth: '650px', width: '90%', maxHeight: '90vh', overflowY: 'auto' }}>
          <div className="modal-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>✏️ Edit & Adjust Takeoff Quantities</span>
            <button id="takeoff-modal-close-x" className="btn btn-sm" style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--ink)' }}>&times;</button>
          </div>
          <p className="modal-sub">Adjust calculated numbers or add extra items (e.g. doors in other un-drawn rooms, extra materials) for this project report.</p>
          <div className="modal-body" style={{ padding: '12px 0', color: '#1f2937' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Wall Sq Footage Adjustment (+/-)</label>
                <input type="number" id="edit-adj-sqft" className="input-field" placeholder="e.g. 120" style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #d1d5db', background: '#fff', color: '#1f2937' }} />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Trim LF Adjustment (+/-)</label>
                <input type="number" id="edit-adj-trim" className="input-field" placeholder="e.g. 24" style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #d1d5db', background: '#fff', color: '#1f2937' }} />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Studs Adjustment (+/-)</label>
                <input type="number" id="edit-adj-studs" className="input-field" placeholder="e.g. 6" style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #d1d5db', background: '#fff', color: '#1f2937' }} />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Drywall Boards Adjustment (+/-)</label>
                <input type="number" id="edit-adj-drywall" className="input-field" placeholder="e.g. 4" style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #d1d5db', background: '#fff', color: '#1f2937' }} />
              </div>
            </div>

            <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '12px', marginTop: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: '700', color: '#1f2937' }}>Custom Material Line Items</span>
                <button id="btn-add-custom-item" className="btn btn-sm" style={{ fontSize: '11px', padding: '2px 8px', background: 'var(--ember)', color: 'var(--ink)', border: 'none', cursor: 'pointer' }}>+ Add Item</button>
              </div>
              <div id="custom-items-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '180px', overflowY: 'auto' }}>
                {/* Dynamically populated */}
              </div>
            </div>
          </div>
          <div className="modal-actions" style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px', borderTop: '1px solid rgba(0,0,0,0.1)', paddingTop: '12px' }}>
            <button id="takeoff-modal-save" className="btn btn-sm btn-accent" style={{ background: 'var(--ember)', color: 'var(--ink)' }}>Save Adjustments</button>
            <button id="takeoff-modal-cancel" className="btn btn-sm">Cancel</button>
          </div>
        </div>
      </div>

      {/* BOSS REPORT MODAL / SEND TO LAPTOP */}
      <div id="boss-report-modal" className="modal-overlay hidden">
        <div className="modal modal-boss-report" style={{ maxWidth: '820px', width: '92%', maxHeight: '92vh', overflowY: 'auto' }}>
          <div className="modal-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>📋 Boss Field Summary Report</span>
            <button id="boss-report-close-x" className="btn btn-sm" style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--ink)' }}>&times;</button>
          </div>
          <p className="modal-sub">Complete field survey report including floor plan drawing, photo attachments, notes, and takeoff calculations.</p>
          <div className="modal-body" id="boss-report-content" style={{ padding: '16px 0', color: '#1f2937' }}>
            {/* Populated dynamically */}
          </div>
          <div className="modal-actions" style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '12px' }}>
            <button id="boss-report-print" className="btn btn-sm btn-accent" style={{ background: 'var(--ember)', color: 'var(--ink)' }}>🖨️ Print / Save PDF</button>
            <button id="boss-report-close" className="btn btn-sm">Close</button>
          </div>
        </div>
      </div>

      <div id="skip-category-modal" className="modal-overlay hidden">
        <div className="modal" style={{ maxWidth: '420px', width: '90%', maxHeight: '82vh', display: 'flex', flexDirection: 'column' }}>
          <div className="modal-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flex: 'none' }}>
            <span>New / Open Project</span>
            <button id="skip-category-close-x" className="btn btn-sm" style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--ink)' }}>&times;</button>
          </div>
          <p className="modal-sub" style={{ flex: 'none' }}>Jump straight to a job's canvas, or start a blank one</p>
          <div id="skip-category-cards" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', flex: 'none' }}>
            <button className="skip-cat-card" data-skip-cat="Bathroom" style={{ padding: '18px 8px', fontSize: '17px', fontWeight: 800, cursor: 'pointer', background: 'rgba(232,98,44,0.08)', border: '1px solid var(--ink)', borderRadius: '8px', color: 'var(--ink)' }}>+ Bath</button>
            <button className="skip-cat-card" data-skip-cat="Kitchen" style={{ padding: '18px 8px', fontSize: '17px', fontWeight: 800, cursor: 'pointer', background: 'rgba(232,98,44,0.08)', border: '1px solid var(--ink)', borderRadius: '8px', color: 'var(--ink)' }}>+ Kitchen</button>
          </div>
          <button id="skip-btn-full-setup" className="btn btn-sm btn-block" style={{ marginTop: '8px', flex: 'none', background: 'none', border: '1px dashed var(--border)', color: '#64748b', fontSize: '12px', fontWeight: 600 }}>🪄 Need client info first? Full Setup Wizard →</button>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.4px', borderTop: '1px solid rgba(0,0,0,0.1)', marginTop: '12px', paddingTop: '10px', flex: 'none' }}>Or jump to an existing job</div>
          <input type="text" id="skip-job-search" placeholder="Search jobs..." style={{ marginTop: '6px', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '13px', flex: 'none' }} />
          <div id="skip-existing-jobs-list" style={{ flex: 1, overflowY: 'auto', marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '6px' }}></div>
        </div>
      </div>

      {/* NEW PROJECT WIZARD MODAL */}
      <div id="project-wizard-modal" className="modal-overlay hidden">
        <div className="modal" style={{ maxWidth: '680px', width: '92%', maxHeight: '90vh', overflowY: 'auto' }}>
          <div className="modal-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>🪄 New Project Setup Wizard</span>
            <button id="wizard-modal-close-x" className="btn btn-sm" style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--ink)' }}>&times;</button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '10px' }}>
            <span id="wiz-editing-label" style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>Starting a new job</span>
            <button id="wiz-btn-switch-job" className="btn btn-sm" style={{ fontSize: '11px', padding: '3px 8px' }}>🔍 Switch Job</button>
          </div>
          <div id="wiz-job-search-panel" className="hidden" style={{ marginBottom: '12px', border: '1px solid var(--border)', borderRadius: '8px', padding: '8px' }}>
            <button id="wiz-btn-new-job" className="btn btn-sm btn-block" style={{ marginBottom: '8px', background: 'rgba(232,98,44,0.08)', border: '1px solid var(--ink)', color: 'var(--ink)', fontWeight: 700 }}>+ Start a New Job</button>
            <input type="text" id="wiz-job-search" placeholder="Or search an existing job..." style={{ width: '100%', padding: '7px 9px', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '12px' }} />
            <div id="wiz-job-search-list" style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '160px', overflowY: 'auto' }}></div>
          </div>
          
          {/* Stepper Header */}
          <div className="wizard-stepper" style={{ display: 'flex', gap: '6px', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.15)', paddingBottom: '12px', marginBottom: '16px' }}>
            <div className="wizard-step-indicator active" data-step="1">1. Client Info</div>
            <div className="wizard-step-indicator" data-step="2">2. Category</div>
            <div className="wizard-step-indicator" data-step="3">3. Specs &amp; Scope</div>
            <div className="wizard-step-indicator" data-step="4">4. Ready to Draw</div>
          </div>

          {/* STEP 1: Client Info */}
          <div className="wizard-step-content" id="wizard-step-1">
            <h3 style={{ fontSize: '15px', fontWeight: '700', marginBottom: '8px', color: 'var(--ember)' }}>Who is this project for?</h3>
            <p style={{ fontSize: '12px', color: '#cbd5e1', marginBottom: '14px' }}>Enter the customer or job site details to keep your floor plans, field notes, and takeoff reports organized.</p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Customer / Client Name *</label>
                <input type="text" id="wiz-customer-name" placeholder="e.g. John &amp; Sarah Smith" style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.2)', background: 'var(--ink)', color: '#fff', fontSize: '13px' }} />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Phone Number</label>
                <input type="tel" id="wiz-customer-phone" placeholder="e.g. (555) 123-4567" style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.2)', background: 'var(--ink)', color: '#fff', fontSize: '13px' }} />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Email Address</label>
                <input type="email" id="wiz-customer-email" placeholder="e.g. customer@example.com" style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.2)', background: 'var(--ink)', color: '#fff', fontSize: '13px' }} />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Job Site Address</label>
                <input type="text" id="wiz-customer-address" placeholder="e.g. 123 Main St, City, State" style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.2)', background: 'var(--ink)', color: '#fff', fontSize: '13px' }} />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Project Room / Area Title</label>
                <input type="text" id="wiz-project-title" placeholder="e.g. Master Bath Remodel, Main Kitchen Upgrade" style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.2)', background: 'var(--ink)', color: '#fff', fontSize: '13px' }} />
              </div>
            </div>
          </div>

          {/* STEP 2: Project Category Focus */}
          <div className="wizard-step-content hidden" id="wizard-step-2">
            <h3 style={{ fontSize: '15px', fontWeight: '700', marginBottom: '8px', color: 'var(--ember)' }}>Select Project Type &amp; Category</h3>
            <p style={{ fontSize: '12px', color: '#cbd5e1', marginBottom: '14px' }}>Picking your main project focus will auto-tailor your canvas, catalogs, and tools so you only see what you need!</p>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }} id="wiz-cat-cards">
              <div className="wiz-cat-card active" data-cat="Kitchen">
                <div style={{ fontSize: '24px', marginBottom: '4px' }}>🍳</div>
                <div style={{ fontWeight: '700', fontSize: '13px' }}>Kitchen</div>
                <div style={{ fontSize: '10px', color: '#cbd5e1', marginTop: '2px' }}>Cabinets, Islands, Sinks, Appliances</div>
              </div>
              <div className="wiz-cat-card" data-cat="Bathroom">
                <div style={{ fontSize: '24px', marginBottom: '4px' }}>🚿</div>
                <div style={{ fontWeight: '700', fontSize: '13px' }}>Bathroom / Shower</div>
                <div style={{ fontSize: '10px', color: '#cbd5e1', marginTop: '2px' }}>Walk-in Showers, Knee Walls, Glass, Drains</div>
              </div>
              <div className="wiz-cat-card" data-cat="Deck">
                <div style={{ fontSize: '24px', marginBottom: '4px' }}>🪵</div>
                <div style={{ fontWeight: '700', fontSize: '13px' }}>Deck &amp; Patio</div>
                <div style={{ fontSize: '10px', color: '#cbd5e1', marginTop: '2px' }}>Framing, Composite/Wood, Posts &amp; Railings</div>
              </div>
              <div className="wiz-cat-card" data-cat="Pole Barn">
                <div style={{ fontSize: '24px', marginBottom: '4px' }}>🏚️</div>
                <div style={{ fontWeight: '700', fontSize: '13px' }}>Pole Barn / Shop</div>
                <div style={{ fontSize: '10px', color: '#cbd5e1', marginTop: '2px' }}>Clear Span Trusses, Overhead Doors, Slab</div>
              </div>
              <div className="wiz-cat-card" data-cat="Addition">
                <div style={{ fontSize: '24px', marginBottom: '4px' }}>🏠</div>
                <div style={{ fontWeight: '700', fontSize: '13px' }}>Room Addition</div>
                <div style={{ fontSize: '10px', color: '#cbd5e1', marginTop: '2px' }}>Exterior Tie-ins, Openings, Sub-framing</div>
              </div>
              <div className="wiz-cat-card" data-cat="General Remodel">
                <div style={{ fontSize: '24px', marginBottom: '4px' }}>🛠️</div>
                <div style={{ fontWeight: '700', fontSize: '13px' }}>General Remodel</div>
                <div style={{ fontSize: '10px', color: '#cbd5e1', marginTop: '2px' }}>Catches all loose ends, multi-room, trim &amp; drywall</div>
              </div>
            </div>
          </div>

          {/* STEP 3: Scope & Field Measurements */}
          <div className="wizard-step-content hidden" id="wizard-step-3">
            <h3 style={{ fontSize: '15px', fontWeight: '700', marginBottom: '8px', color: 'var(--ember)' }}>Define Scope &amp; Field Specs</h3>
            <p style={{ fontSize: '12px', color: '#cbd5e1', marginBottom: '14px' }}>Configure wall defaults and scope to ensure accurate takeoff calculations.</p>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Work Scope</label>
                <select id="wiz-scope" defaultValue="Full Build" style={{ width: '100%', padding: '8px', borderRadius: '4px', background: 'var(--ink)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', fontSize: '12px' }}>
                  <option value="Full Build">Full Build &amp; Finish</option>
                  <option value="Floor Only">Floor Only</option>
                  <option value="Trim Work Only">Trim Work Only</option>
                  <option value="Drywall Only">Drywall &amp; Paint Only</option>
                  <option value="Demolition Only">Demolition &amp; Framing Only</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Default Ceiling Height</label>
                <select id="wiz-ceiling-height" defaultValue="96" style={{ width: '100%', padding: '8px', borderRadius: '4px', background: 'var(--ink)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', fontSize: '12px' }}>
                  <option value="96">8 ft (96") - Standard</option>
                  <option value="108">9 ft (108")</option>
                  <option value="120">10 ft (120")</option>
                  <option value="144">12 ft (144") - High/Vaulted</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Wall Stud Spacing</label>
                <select id="wiz-stud-spacing" defaultValue="16" style={{ width: '100%', padding: '8px', borderRadius: '4px', background: 'var(--ink)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', fontSize: '12px' }}>
                  <option value="16">16" O.C. (Standard Interior)</option>
                  <option value="24">24" O.C. (Advanced / Exterior)</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '600', display: 'block', marginBottom: '4px' }}>Initial Wall Type</label>
                <select id="wiz-wall-type" defaultValue="existing_to_remain" style={{ width: '100%', padding: '8px', borderRadius: '4px', background: 'var(--ink)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', fontSize: '12px' }}>
                  <option value="existing_to_remain">Existing Wall (Black)</option>
                  <option value="new_construction">New Wall Construction (Blue)</option>
                  <option value="demolished">Wall to Demolish (Red Dash)</option>
                </select>
              </div>
            </div>
          </div>

          {/* STEP 4: Ready & Tailored Palette Confirmation */}
          <div className="wizard-step-content hidden" id="wizard-step-4">
            <div style={{ textAlign: 'center', padding: '12px 0' }}>
              <div style={{ fontSize: '36px', marginBottom: '8px' }}>🚀</div>
              <h3 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--ember)', marginBottom: '6px' }}>Your Project Canvas is Ready!</h3>
              <p style={{ fontSize: '12px', color: '#e2e8f0', maxWidth: '460px', margin: '0 auto 16px auto' }}>
                We've configured your workspace for <b id="wiz-summary-cat" style={{ color: '#fff' }}>Kitchen</b> with tailored tool palettes and room specs loaded.
              </p>
              
              <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: '8px', padding: '12px', textAlign: 'left', maxWidth: '480px', margin: '0 auto', border: '1px solid rgba(255,255,255,0.1)', fontSize: '12px', color: '#cbd5e1' }}>
                <div style={{ marginBottom: '4px' }}>👤 <b>Customer:</b> <span id="wiz-confirm-customer">Smith</span></div>
                <div style={{ marginBottom: '4px' }}>📍 <b>Project Area:</b> <span id="wiz-confirm-title">Main Kitchen</span></div>
                <div style={{ marginBottom: '4px' }}>🔨 <b>Category &amp; Scope:</b> <span id="wiz-confirm-catscope">Kitchen • Full Build</span></div>
                <div>📏 <b>Field Specs:</b> <span id="wiz-confirm-specs">8ft Ceiling, 16" O.C. Studs</span></div>
              </div>
            </div>
          </div>

          {/* Footer Navigation Buttons */}
          <div className="modal-actions" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '12px' }}>
            <button id="wiz-btn-back" className="btn btn-sm" style={{ opacity: 0.7 }}>&larr; Back</button>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button id="wiz-btn-cancel" className="btn btn-sm">Cancel</button>
              <button id="wiz-btn-next" className="btn btn-sm btn-accent" style={{ background: 'var(--ember)', color: 'var(--ink)' }}>Next Step &rarr;</button>
              <button id="wiz-btn-finish" className="btn btn-sm btn-accent hidden" style={{ background: '#16a34a', color: '#fff' }}>🚀 Launch Project Canvas</button>
            </div>
          </div>
        </div>
      </div>

      {/* VOICE STATUS */}
      <div id="voice-status" className="voice-status hidden">
        <div className="voice-pulse"></div>
        <span>Listening...</span>
      </div>

      {/* TOAST */}
      <div id="toast" className="toast hidden"></div>

      {/* CONTEXT MENU */}
      <div id="ctx-menu" className="ctx-menu hidden">
        <button className="ctx-item" data-action="delete">Delete Wall</button>
        <div className="ctx-sep"></div>
        <button className="ctx-item" data-action="change-type">Change Wall Type</button>
      </div>

      {/* QUICK ACTIONS RADIAL MENU */}
      <div id="quick-actions-menu" className="quick-actions-menu hidden">
        <div className="qa-center">⚡</div>
        <button id="qa-duplicate" className="qa-btn qa-btn-dup" title="Duplicate Asset">📋</button>
        <button id="qa-rotate" className="qa-btn qa-btn-rot" title="Rotate +90°">🔄</button>
        <button id="qa-delete" className="qa-btn qa-btn-del" title="Delete Selected">🗑️</button>
      </div>

      {/* NOTES HALF-SCREEN POPUP MODAL */}
      <div id="notes-modal-overlay" className="modal-overlay hidden">
        <div className="modal" style={{ width: '85vw', maxWidth: '750px', height: '65vh', maxHeight: '85vh', display: 'flex', flexDirection: 'column', background: 'var(--ink)', border: '1px solid var(--ember)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 className="modal-title" style={{ margin: 0, color: 'var(--ember)' }}>📝 Project Field Notes & Observations</h3>
            <button id="notes-modal-close-x" className="btn btn-sm" style={{ background: 'none', border: 'none', color: '#fff', fontSize: '18px', cursor: 'pointer' }}>&times;</button>
          </div>
          <p className="modal-sub" style={{ margin: '0 0 10px 0', color: '#cbd5e1' }}>Type or view comprehensive site notes, measurements, and client requests in full detail.</p>
          <textarea id="notes-modal-textarea" style={{ flex: 1, width: '100%', padding: '12px', borderRadius: '8px', background: '#001226', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', fontSize: '14px', resize: 'none', fontFamily: 'inherit' }} placeholder="Enter field notes..."></textarea>
          <div className="modal-actions" style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button id="notes-modal-save" className="btn btn-sm btn-accent" style={{ background: 'var(--ember)', color: 'var(--ink)' }}>Done / Save</button>
          </div>
        </div>
      </div>
    </div>
    </div>
    </>
  );
}
