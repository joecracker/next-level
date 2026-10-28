import { useEffect, useState, useRef, useCallback, type CSSProperties } from 'react';
import Webcam from 'react-webcam';
import { initNextLevel } from './app';
import DesignStudio from './design/DesignStudio';
import CaptureScreen, { type CaptureData, type CapturePatch, type ScratchItem } from './CaptureScreen';
import { BUILD_STAMP } from './buildStamp';
import { driveError } from './lib/driveError';

// Live-camera modal. Works on desktop (Surface) AND phones via getUserMedia,
// unlike the native <input capture> which desktop browsers ignore.
// On snap: feed the photo into the existing #photo-input-camera pipeline
// (Photo Booth markup → savePhotoBlob → IndexedDB) — zero app.ts changes.
type JobSummary = { id: string; name: string; category: string; photoCount: number; noteCount: number };
type DriveJob = { fileId: string; jobId: string; name: string; modified: string; onDevice: boolean; skipped: boolean };
declare global {
  interface Window {
    NextLevel?: {
      newJob: () => string;
      listJobs: () => JobSummary[];
      openJob: (id: string) => void;
      getCapture: () => CaptureData | null;
      setCapture: (patch: CapturePatch) => void;
      setScratch: (items: ScratchItem[]) => void;
      setPolish: (patch: { items?: string[] | null; source?: string; undo?: string | null }) => void;
      deleteJob: (id: string) => void;
      photoUrl: (id: string) => Promise<string | null>;
      setPhoto: (id: string, patch: { caption?: string; note?: string }) => void;
      deletePhoto: (id: string) => void;
      markUpPhoto: (id: string) => void;
      onCapture: (cb: () => void) => () => void;
      sendJob: () => void;
      getDesign: () => any;
      setDesign: (d: any) => void;
      designPicture: () => Promise<Blob | null>;
      designTakeoff: () => { csv: string; filename: string } | null;
      pickJobFile: () => void;
  buildJobFile: (withPhotos?: boolean) => Promise<File | null>;
      driveState: () => { configured: boolean; connected: boolean };
      driveConnect: () => Promise<void>;
      driveSavedAt: (id: string) => number;
      saveJobToDrive: (id?: string) => Promise<void>;
      listDriveJobs: () => Promise<DriveJob[]>;
      importDriveJob: (fileId: string, replace: boolean) => Promise<'added' | 'replaced' | 'exists'>;
    };
  }
}

function OpenJobPicker({ onOpen, onCancel, title = 'Open Job', onNew, onGetFile }: { onOpen: (id: string) => void; onCancel: () => void; title?: string; onNew?: () => void; onGetFile?: () => void }) {
  const [q, setQ] = useState('');
  const [, setTick] = useState(0);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  useEffect(() => window.NextLevel?.onCapture(() => setTick(t => t + 1)), []);
  const [driveOpen, setDriveOpen] = useState(false);
  const [driveBusy, setDriveBusy] = useState(false);
  const [driveMsg, setDriveMsg] = useState('');
  const [driveJobs, setDriveJobs] = useState<DriveJob[] | null>(null);
  // Brings in every Drive job this device does not have (never replaces one, never re-adds one deleted here).
  const pulling = useRef(false);
  const pullNew = async (list: DriveJob[]) => {
    const nl = window.NextLevel; if (!nl || pulling.current) return;
    const todo = list.filter(j => !j.onDevice && !j.skipped);
    if (!todo.length) return;
    pulling.current = true;
    setDriveBusy(true);
    let done = 0;
    try {
      for (const j of todo) {
        setDriveMsg('Bringing in ' + (done + 1) + ' of ' + todo.length + ': ' + j.name + '...');
        await nl.importDriveJob(j.fileId, false);
        done++;
      }
      setDriveJobs(await nl.listDriveJobs());
      setDriveMsg(done + ' new job' + (done === 1 ? '' : 's') + ' brought in.');
    } catch (e) { setDriveMsg((done ? done + ' brought in, then it stopped. ' : '') + driveError(e)); }
    pulling.current = false;
    setDriveBusy(false);
  };
  const loadDrive = async () => {
    const nl = window.NextLevel; if (!nl) return;
    setDriveBusy(true); setDriveMsg('');
    let list: DriveJob[] | null = null;
    try {
      if (!nl.driveState().connected) await nl.driveConnect();
      list = await nl.listDriveJobs();
      setDriveJobs(list);
    } catch (e) { setDriveMsg(driveError(e)); }
    setDriveBusy(false);
    if (list && !IS_PHONE) await pullNew(list); // PC and tablet: new phone jobs just arrive
  };
  const bringIn = async (j: DriveJob) => {
    const nl = window.NextLevel; if (!nl) return;
    if (j.onDevice && !window.confirm('"' + j.name + '" is already on this device. Replace it with the copy from Google Drive? Any changes made here since then will be lost.')) return;
    setDriveBusy(true); setDriveMsg('');
    try {
      await nl.importDriveJob(j.fileId, true);
      setDriveJobs(await nl.listDriveJobs());
      setDriveMsg('"' + j.name + '" is on this device now.');
    } catch (e) { setDriveMsg(driveError(e)); }
    setDriveBusy(false);
  };
  const bringAllNew = () => (driveJobs ? pullNew(driveJobs) : Promise.resolve());
  // PC and tablet: if Google is already connected this session, check Drive as soon as the list opens.
  useEffect(() => {
    const st = window.NextLevel?.driveState();
    if (!IS_PHONE && st?.configured && st.connected) { setDriveOpen(true); loadDrive(); }
  }, []);
  const newOnes = (driveJobs || []).filter(j => !j.onDevice && !j.skipped);
  const driveBtn: CSSProperties = { minHeight: '48px', borderRadius: '10px', border: '1px solid rgba(238,241,238,0.3)', background: 'transparent', color: 'var(--cream)', fontSize: '16px', fontWeight: 700, cursor: 'pointer', padding: '0 14px' };
  const jobs = (window.NextLevel?.listJobs() || [])
    .filter(j => !q.trim() || j.name.toLowerCase().includes(q.trim().toLowerCase())); // already most recently used first
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9998, background: 'var(--ink)',
      display: 'flex', flexDirection: 'column', padding: '20px', boxSizing: 'border-box',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
        <button onClick={onCancel} style={{ background: 'none', border: 'none', color: 'var(--cream)', fontSize: '26px', cursor: 'pointer', lineHeight: 1 }}>&larr;</button>
        <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--cream)' }}>{title}</div>
      </div>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search jobs…" style={{
        padding: '12px 14px', borderRadius: '12px', border: '1px solid rgba(238,241,238,0.2)',
        background: 'rgba(238,241,238,0.06)', color: 'var(--cream)', fontSize: '16px', marginBottom: '14px', outline: 'none',
      }} />
      {onNew && (
        <button onClick={onNew} style={{
          padding: '16px', borderRadius: '14px', border: 'none', background: 'var(--ember)', color: 'var(--ink)',
          fontSize: '17px', fontWeight: 800, cursor: 'pointer', marginBottom: '14px',
        }}>+ Start a new job</button>
      )}
      {onGetFile && (
        <button onClick={onGetFile} style={{
          padding: '14px', borderRadius: '14px', border: '1px solid rgba(238,241,238,0.3)', background: 'transparent',
          color: 'var(--cream)', fontSize: '16px', fontWeight: 700, cursor: 'pointer', marginBottom: '14px',
        }}>Get a job file</button>
      )}
      {window.NextLevel?.driveState().configured && (
        <button onClick={() => { const o = !driveOpen; setDriveOpen(o); if (o && driveJobs === null && window.NextLevel?.driveState().connected) loadDrive(); }} style={{
          padding: '14px', borderRadius: '14px', border: '1px solid rgba(138,154,92,0.6)', background: driveOpen ? 'rgba(138,154,92,0.12)' : 'transparent',
          color: 'var(--cream)', fontSize: '16px', fontWeight: 700, cursor: 'pointer', marginBottom: '14px',
        }}>Jobs from Google Drive</button>
      )}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {driveOpen && (
          <div style={{ borderRadius: '14px', border: '1px solid rgba(138,154,92,0.5)', background: 'rgba(138,154,92,0.08)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ color: 'var(--cream)', fontSize: '15px', fontWeight: 800 }}>Jobs saved to Google Drive</div>
            {driveMsg && <div style={{ color: 'var(--cream)', fontSize: '14px', lineHeight: 1.4 }}>{driveMsg}</div>}
            {driveBusy && <div style={{ color: 'var(--muted)', fontSize: '14px' }}>Working... this can take a minute when a job has many pictures.</div>}
            {!driveBusy && driveJobs === null && (
              <button onClick={loadDrive} style={driveBtn}>Connect Google Drive</button>
            )}
            {!driveBusy && driveJobs !== null && driveJobs.length === 0 && (
              <div style={{ color: 'var(--muted)', fontSize: '14px', lineHeight: 1.4 }}>Nothing saved to Drive yet. On the phone, open a job and tap Save this job to Google Drive.</div>
            )}
            {!driveBusy && newOnes.length > 1 && (
              <button onClick={bringAllNew} style={{ ...driveBtn, background: 'var(--ember)', color: 'var(--ink)', border: 'none', fontWeight: 800 }}>Bring in all new jobs ({newOnes.length})</button>
            )}
            {driveJobs && driveJobs.map(j => (
              <button key={j.fileId} disabled={driveBusy} onClick={() => bringIn(j)} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', textAlign: 'left',
                padding: '12px 14px', borderRadius: '12px', border: '1px solid rgba(238,241,238,0.14)', background: 'rgba(238,241,238,0.05)',
                color: 'var(--cream)', cursor: 'pointer', opacity: driveBusy ? 0.6 : 1,
              }}>
                <span style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '16px', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.name}</div>
                  <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>Saved {new Date(j.modified).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} &middot; {j.onDevice ? 'already on this device' : j.skipped ? 'deleted from this device' : 'new'}</div>
                </span>
                <span style={{ color: 'var(--moss)', fontSize: '14px', fontWeight: 800, flexShrink: 0 }}>{j.onDevice ? 'Replace' : 'Bring in'}</span>
              </button>
            ))}
          </div>
        )}
        {jobs.length === 0 ? (
          <div style={{ color: 'var(--muted)', textAlign: 'center', marginTop: '30px', fontSize: '14px' }}>
            {q.trim() ? 'No jobs match that search' : 'No jobs yet — start one with Capture'}
          </div>
        ) : jobs.map(j => (
          <div key={j.id} style={{
            display: 'flex', alignItems: 'stretch', gap: '8px',
            borderRadius: '14px', border: '1px solid rgba(238,241,238,0.14)', background: 'rgba(238,241,238,0.05)',
          }}>
            {confirmId === j.id ? (
              <div style={{ flex: 1, minWidth: 0, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ color: 'var(--cream)', fontSize: '15px', lineHeight: 1.4 }}>Delete <b>{j.name}</b>? This removes the whole job: pictures, notes, drawing, everything. It can&apos;t be undone.</div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => { window.NextLevel?.deleteJob(j.id); setConfirmId(null); }} style={{ flex: 1, minHeight: '48px', borderRadius: '10px', border: 'none', background: '#B42318', color: '#fff', fontSize: '16px', fontWeight: 800, cursor: 'pointer' }}>Yes, delete it</button>
                  <button onClick={() => setConfirmId(null)} style={{ flex: 1, minHeight: '48px', borderRadius: '10px', border: '1px solid rgba(238,241,238,0.3)', background: 'transparent', color: 'var(--cream)', fontSize: '16px', fontWeight: 700, cursor: 'pointer' }}>Keep it</button>
                </div>
              </div>
            ) : (
              <>
                <button onClick={() => onOpen(j.id)} style={{
                  flex: 1, minWidth: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px',
                  padding: '16px', border: 'none', background: 'transparent', color: 'var(--cream)', cursor: 'pointer', textAlign: 'left',
                }}>
                  <span style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '16px', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.name}</div>
                    <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>{j.category} &middot; {j.photoCount} photo{j.photoCount === 1 ? '' : 's'} &middot; {j.noteCount} note{j.noteCount === 1 ? '' : 's'}</div>
                  </span>
                  <span style={{ color: 'var(--moss)', fontSize: '22px', flexShrink: 0 }}>&rsaquo;</span>
                </button>
                <button aria-label={'Delete ' + j.name} onClick={() => setConfirmId(j.id)} style={{
                  flex: 'none', width: '64px', border: 'none', borderLeft: '1px solid rgba(238,241,238,0.14)', background: 'transparent',
                  color: '#F0A59B', fontSize: '13px', fontWeight: 800, cursor: 'pointer',
                }}>Delete</button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// On a phone, PHOTO opens the phone's own camera app (ultra-wide lens, autofocus, full processing)
// through the hidden native input. Tablets and desktops keep the in-page camera above.
const IS_PHONE = /Android.*Mobile|iPhone|iPod/i.test(navigator.userAgent);
function takePhoto(openModal: () => void) {
  const input = document.getElementById('photo-input-camera') as HTMLInputElement | null;
  if (IS_PHONE && input) input.click(); else openModal();
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
              // No size was ever requested, so browsers fell back to ~640x480. Ask for the
              // biggest 4:3 picture the camera can give; it picks the closest it supports.
              videoConstraints: { facingMode: facing, width: { ideal: 4096 }, height: { ideal: 3072 } },
              // Save the photo at the camera's real size, not the on-screen preview size.
              forceScreenshotSourceSize: true,
              onUserMediaError: () => setErr('Could not open the camera. Check that the browser has camera permission, then try again.'),
              style: { width: '100%', maxHeight: '80vh', objectFit: 'contain' },
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

function Launcher({ onPick }: { onPick: (door: 'open' | 'capture' | 'design') => void }) {
  const doorBtn: CSSProperties = {
    display: 'flex', alignItems: 'center', gap: '16px', width: '100%',
    padding: '20px 24px', borderRadius: '16px', fontSize: '20px', fontWeight: 800,
    letterSpacing: '0.3px', cursor: 'pointer', textAlign: 'left',
    border: '2px solid rgba(238,241,238,0.15)', background: 'rgba(238,241,238,0.04)',
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
        <span style={{ color: 'var(--ember)' }}>Next </span><span style={{ color: 'var(--moss)' }}>Level</span>
      </div>
      <div style={{ fontSize: '22px', fontWeight: 300, letterSpacing: '3px', color: 'var(--cream)', marginBottom: '12px' }}>Field &amp; Desk</div>
      <div style={{ fontSize: '11px', letterSpacing: '3px', color: 'var(--muted)', marginBottom: '40px' }}>MEASURE &middot; DESIGN &middot; DELIVER</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: '100%', maxWidth: '440px' }}>
        <button onClick={() => onPick('capture')} style={{ ...doorBtn, border: 'none', background: 'var(--ember)', color: 'var(--ink)' }}>
          <span style={iconWrap}>{'\u{1F4CB}'}</span>
          <span>Capture<div style={{ ...sub, color: 'rgba(20,25,26,0.65)' }}>Start a new job</div></span>
        </button>
        <button onClick={() => onPick('open')} style={doorBtn}>
          <span style={iconWrap}>{'\u{1F4C2}'}</span>
          <span>Open Job<div style={sub}>Pick up where you left off</div></span>
        </button>
        <button onClick={() => onPick('design')} style={doorBtn}>
          <span style={iconWrap}>{'\u{1F4D0}'}</span>
          <span>Design Studio<div style={sub}>Walls, cabinets, plumbing and takeoff</div></span>
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [showLauncher, setShowLauncher] = useState(true);
  const [openPicker, setOpenPicker] = useState(false);
  const [designOn, setDesignOn] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [captureOn, setCaptureOn] = useState(false);
  const [capturePicker, setCapturePicker] = useState(false);

  // Phone/tablet Back button (and swipe-back) should step up one level inside the
  // app - job screen -> jobs list -> start screen - instead of leaving the app.
  const navRef = useRef({ captureOn: false, capturePicker: false });
  navRef.current = { captureOn, capturePicker };
  useEffect(() => {
    const onPop = () => {
      if (document.getElementById('nl-capture-viewer') || document.getElementById('nl-jobsheet-root')) return; // the big-picture viewer and the Job Sheet handle their own Back
      const { captureOn: c, capturePicker: p } = navRef.current;
      if (c) { setCaptureOn(false); setCapturePicker(true); }
      else if (p) { setCapturePicker(false); setShowLauncher(true); }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  // On-screen buttons use the same path as the Back button so history never drifts.
  const backOne = (expect: 'picker' | 'capture', fallback: () => void) => {
    if (window.history.state && window.history.state.nl === expect) window.history.back();
    else fallback();
  };

  useEffect(() => {
    initNextLevel();
    // Ask the browser to treat this app's saved jobs and photos as keep-me data,
    // so they are not cleared when the device runs low on space.
    try { navigator.storage?.persist?.().catch(() => {}); } catch { /* ignore */ }
  }, []);

  const pickDoor = (door: 'open' | 'capture' | 'design') => {
    if (door === 'capture') { newCapture(); return; } // a fresh job, straight into Capture
    if (door === 'open') { // the job list; the job you pick opens in Capture
      window.history.pushState({ nl: 'picker' }, '');
      setShowLauncher(false);
      setCapturePicker(true);
      return;
    }
    if (door === 'design') { // pick a job, then open it in the Design Studio
      setShowLauncher(false);
      setOpenPicker(true);
      return;
    }
  };

  const openExistingJob = (id: string) => {
    window.NextLevel?.openJob(id);
    setOpenPicker(false);
    setShowLauncher(false);
    setDesignOn(true);
  };

  const startCapture = (id: string) => {
    window.history.pushState({ nl: 'capture' }, '');
    setCapturePicker(false);
    setShowLauncher(false);
    setDesignOn(false);
    window.NextLevel?.openJob(id);
    setCaptureOn(true);
  };
  // From the Design Studio back to Capture on the same job (both use the same saved job).
  const toCapture = () => {
    const id = window.NextLevel?.getCapture()?.id;
    if (id) startCapture(id);
    else { window.history.pushState({ nl: 'picker' }, ''); setDesignOn(false); setCapturePicker(true); }
  };
  const newCapture = () => {
    const id = window.NextLevel?.newJob();
    if (id) startCapture(id);
  };
  // Capture's "full app" button opens the Design Studio on the same job.
  const captureToDesign = () => {
    setCaptureOn(false);
    setDesignOn(true);
  };

  const goHome = () => {
    setCaptureOn(false);
    setCapturePicker(false);
    setOpenPicker(false);
    setDesignOn(false);
    setShowLauncher(true);
  };

  return (
    <>
      {showLauncher && <Launcher onPick={pickDoor} />}
      {openPicker && <OpenJobPicker title="Design Studio" onGetFile={() => window.NextLevel?.pickJobFile()} onOpen={openExistingJob} onCancel={() => { setOpenPicker(false); setShowLauncher(true); }} />}
      {capturePicker && <OpenJobPicker title="Open Job" onGetFile={() => window.NextLevel?.pickJobFile()} onNew={newCapture} onOpen={startCapture} onCancel={() => backOne('picker', () => { setCapturePicker(false); setShowLauncher(true); })} />}
      {captureOn && <CaptureScreen onHome={() => backOne('capture', () => { setCaptureOn(false); setCapturePicker(true); })} onFull={captureToDesign} onTakePhoto={() => takePhoto(() => setCameraOpen(true))} />}
      {designOn && <DesignStudio jobName={window.NextLevel?.getCapture()?.name || ''} onHome={goHome} onCapture={toCapture} />}
      {cameraOpen && <CameraModal onClose={() => setCameraOpen(false)} />}

      {/* Page shell the job core talks to: hidden picture/job-file inputs and the toast. */}
      <input type="file" id="photo-input-camera" accept="image/*" capture="environment" style={{ display: 'none' }} />
      <input type="file" id="photo-input-gallery" accept="image/*" style={{ display: 'none' }} />
      <input type="file" id="job-file-input" accept=".json,application/json" style={{ display: 'none' }} />

      {/* TOAST */}
      <div id="toast" className="toast hidden"></div>
    </>
  );
}
