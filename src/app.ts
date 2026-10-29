import { driveConfigured, isDriveConnected, connectBackup, saveBackup, saveJobFolder, listJobBackups, loadJobBackup } from './lib/backup';
import {
  putPhoto, deletePhotoBlob, getDisplayURL, getPhotoBlob, downscaleImage,
  dehydrateProjects, hydrateProjects, estimateStorage, revokeURL,
} from './lib/photoStore';
import { openPhotoBooth } from './lib/photoBooth';
import { hasDesign } from './design/model';
import { designPng, takeoffCsv, takeoffCsvAll } from './design/exports';

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

/* ════════════════════════════════════════════════════════════════
   JOB CORE
   Jobs, photos, job files, Google Drive hand-off and the window.NextLevel
   bridge the React screens talk to. The old drawing canvas, side menu,
   wizard and square-foot takeoff were removed when the Design Studio was
   rebuilt. A job's drawing now lives in project.design (written by the
   Design Studio screen); this file only stores and carries it.
   ════════════════════════════════════════════════════════════════ */
export function initNextLevel() {
  const STORAGE_KEY = 'nextlevel_projects';

  interface Photo {
    id: string;
    dataUrl?: string; // transient only: set while hydrating for export/Drive, or as private-mode fallback. Bytes live in IndexedDB keyed by id.
    caption: string;
    timestamp: string;
    note?: string; // Capture screen: notes written on this picture
  }
  interface DesignPage { id: string; name: string; design: any }
  interface Project {
    id: string;
    name: string;
    customer?: string;
    phone?: string;
    email?: string;
    address?: string;
    category: string;
    scope: string;
    lastUsed?: number;  // when the job was last created, opened or edited (for the job lists' order)
    photos?: Photo[];
    date?: string;      // Capture screen: matches the Excel's Date
    jobDesc?: string;  // Capture screen: matches the Excel's Description of Job
    jobNotes?: string; // Capture screen: tear-out to debris removal notes
    scratch?: Array<{ id: string; text: string }>; // Capture screen: one-line reminders
    polished?: string[];   // Capture screen: Polish result waiting for "Use this" / "Keep mine"
    polishedFrom?: string; // the Job notes text that list was made from
    polishUndo?: string;   // Job notes as they were before "Use this"
    design?: any;          // old single drawing; moved into pages the first time the job is opened
    pages?: DesignPage[];  // Design Studio: the job's drawings, one per room or version (Master bath, Kitchen, Before, After...)
    curPage?: string;      // the page that was open last
  }

  let projects: Project[] = [];
  // Capture screen listens here so it refreshes when photos change.
  const captureListeners: Array<() => void> = [];
  const notifyCapture = () => { captureListeners.slice().forEach(f => { try { f(); } catch { /* ignore */ } }); };
  let currentProjectId: string | null = null;

  function uid(){ return Math.random().toString(36).slice(2,10); }
  function toast(msg: string, dur=2000){
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout((t as any)._t);
    (t as any)._t = setTimeout(()=>t.classList.add('hidden'), dur);
  }

  function getProject(): Project | undefined { return projects.find(p=>p.id===currentProjectId); }

  function save(){
    if(!currentProjectId) return;
    try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(projects)); }catch(e){}
    maybeAutoBackup();
  }


  // This device's local storage IS the real working copy — Drive is purely
  // disaster recovery for "the device died / cache got wiped," not live
  // sync. No reason to hit the Drive API on every keystroke for that; a
  // daily check is plenty. (Bump AUTO_BACKUP_INTERVAL_MS if weekly's
  // preferred instead.)
  const LAST_DRIVE_BACKUP_KEY = 'nextlevel_last_drive_backup';
  // Jobs deleted on THIS device. The Drive copy stays in Drive, so without this the automatic pull would keep bringing them back.
  const DRIVE_SKIP_KEY = 'nextlevel_drive_skip';
  function driveSkipList(): string[] { try { return JSON.parse(localStorage.getItem(DRIVE_SKIP_KEY) || '[]'); } catch { return []; } }
  function driveSkipAdd(id: string){ try { const l = driveSkipList(); if(!l.includes(id)){ l.push(id); localStorage.setItem(DRIVE_SKIP_KEY, JSON.stringify(l)); } } catch { /* ignore */ } }
  function driveSkipRemove(id: string){ try { localStorage.setItem(DRIVE_SKIP_KEY, JSON.stringify(driveSkipList().filter(x => x !== id))); } catch { /* ignore */ } }
  const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // once a day
  let driveAutoBackupTimer: ReturnType<typeof setTimeout> | null = null;
  function maybeAutoBackup(){
    if(!isDriveConnected()) return;
    const last = parseInt(localStorage.getItem(LAST_DRIVE_BACKUP_KEY) || '0', 10);
    if(Date.now() - last < AUTO_BACKUP_INTERVAL_MS) return; // not due yet
    if(driveAutoBackupTimer) clearTimeout(driveAutoBackupTimer);
    driveAutoBackupTimer = setTimeout(async () => {
      try{
        const hydrated = await hydrateProjects(projects);
        await saveBackup(hydrated);
        localStorage.setItem(LAST_DRIVE_BACKUP_KEY, Date.now().toString());
        const el = document.getElementById('drive-status');
        if(el){ el.textContent = 'Auto-backed up just now'; el.style.color = ''; }
      }catch(e){
        // Silent on failure — don't interrupt fieldwork over a backup
        // hiccup. The manual Save to Drive button still works on demand.
      }
    }, 8000); // small debounce so a burst of edits right at the daily mark doesn't double-fire
  }
  function newProject(name?: string, cat?: string): Project {
    return { id: uid(), name: name||'New Project', customer: '', category: cat||'Kitchen', scope: 'Full Build', photos: [] };
  }

  // Design pages: a job holds a list of drawings. A job drawn before pages existed gets its one drawing as the first page.
  function pagesOf(p: Project): DesignPage[] {
    if (!p.pages) {
      p.pages = [];
      if (p.design && hasDesign(p.design)) p.pages.push({ id: uid(), name: p.design.mode === 'kitchen' ? 'Kitchen' : 'Bathroom', design: p.design });
      delete p.design;
    }
    return p.pages;
  }
  function curPageOf(p: Project): DesignPage | null { const ps = pagesOf(p); return ps.find(x => x.id === p.curPage) || ps[0] || null; }
  function pageName(p: Project, want: string, skipId?: string): string {
    const base = (want || '').trim() || 'Page'; const taken = new Set(pagesOf(p).filter(x => x.id !== skipId).map(x => x.name.toLowerCase()));
    let n = base, i = 2; while (taken.has(n.toLowerCase())) n = `${base} ${i++}`; return n;
  }

  // A job that was started but never filled in (tapping "Start a new job" saves a blank one straight away).
  // These pile up on top of the list, so the job lists skip them. Nothing is deleted.
  function isBlankJob(p: Project): boolean {
    if (p.name !== 'New Project') return false;
    if (p.customer || p.phone || p.email || p.address || p.jobDesc || p.jobNotes) return false;
    if ((p.photos || []).length || (p.scratch || []).length || (p as any).polished) return false;
    if (pagesOf(p).some(pg => hasDesign(pg.design))) return false;
    return true;
  }
  // What every job list shows: blanks hidden, most recently used on top.
  function visibleJobs(keepCurrent = true): Project[] {
    return recentFirst(projects.filter(p => (keepCurrent && p.id === currentProjectId) || !isBlankJob(p)));
  }

  // Most recently used job first. A job counts as used when it is created, opened or edited; jobs from
  // before this existed keep their old order (newest created first) until they are opened.
  function recentFirst(list: Project[]): Project[] {
    return list
      .map((p, i) => ({ p, i }))
      .sort((a, b) => ((b.p.lastUsed || 0) - (a.p.lastUsed || 0)) || (b.i - a.i))
      .map(x => x.p);
  }

  // Save a marked-up (or plain) photo blob to IndexedDB and refresh the UI.
  // isNew=true pushes a new gallery entry; isNew=false replaces an existing
  // photo's bytes in place (re-editing bakes new ink on top of the old — the
  // marks are flat pixels, same as the Cut Once tool it's ported from).
  async function savePhotoBlob(id: string, blob: Blob, isNew: boolean){
    const p = getProject();
    if(!p) return;
    if(!p.photos) p.photos = [];
    let small: Blob;
    try { small = await downscaleImage(blob); } catch { small = blob; }
    const existing = p.photos.find(x => x.id === id);
    const photo: Photo = existing || { id, caption: '', timestamp: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) };
    try {
      await putPhoto(id, small);
      revokeURL(id);                          // drop cached URL so the gallery reloads new bytes
      delete photo.dataUrl;                   // prefer IDB copy if a stale inline one existed
    } catch {
      try {
        photo.dataUrl = await new Promise<string>((res, rej) => {
          const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = () => rej(r.error); r.readAsDataURL(small);
        });
      } catch { toast('Could not read photo'); return; }
    }
    if(isNew) p.photos.push(photo);
    save();
    notifyCapture();
    updateStorageMeter();
    toast(isNew ? 'Photo saved' : 'Markup saved');
  }

  // Re-open an existing photo in the booth to add/adjust markup.
  // Shared: get a photo's bytes back out of storage (IDB, or the private-mode
  // inline dataUrl fallback), used by both the markup path and the view-only
  // reference path below.
  async function fetchPhotoBlob(id: string): Promise<Blob | null> {
    const p = getProject();
    const photo = p?.photos?.find(x => x.id === id);
    if(!photo) return null;
    let blob: Blob | null = null;
    try { blob = await getPhotoBlob(id); } catch { blob = null; }
    if(!blob && photo.dataUrl){                // private-mode inline fallback
      try { const r = await fetch(photo.dataUrl); blob = await r.blob(); } catch { blob = null; }
    }
    return blob;
  }

  // Re-open an existing photo in the booth to add/adjust markup. Used by the
  // sidebar photo gallery (capture/initial-markup flow) — full drawing tools.
  async function editExistingPhoto(id: string){
    const blob = await fetchPhotoBlob(id);
    if(!blob){ toast('Photo not found'); return; }
    openPhotoBooth({ imageBlob: blob, onSave: (out) => savePhotoBlob(id, out, false) });
  }

  async function updateStorageMeter(){
    const el = document.getElementById('storage-meter');
    if(!el) return;
    const est = await estimateStorage();
    let jobs = 0, photos = 0;
    projects.forEach(pr => { jobs++; photos += (pr.photos ? pr.photos.length : 0); });
    const usage = est ? `${est.usedMB.toFixed(0)} MB used${est.quotaMB ? ` of ~${est.quotaMB.toFixed(0)} MB` : ''}` : 'usage n/a';
    el.textContent = `🗄️ ${jobs} job${jobs===1?'':'s'} • ${photos} photo${photos===1?'':'s'} • ${usage}`;
    if(est && est.pct > 80) el.style.color = '#f87171';
    else el.style.color = 'rgba(255,255,255,0.5)';
  }

  // ── Send / Open a single job ──────────────────────────────────────────
  // The field-guy-to-sales-guy handoff: package ONE job (not the whole
  // project list) into a file named after the job itself, and hand it off
  // through the device's own share sheet (text/email/AirDrop/whatever) —
  // no accounts, no server, no "JSON" anywhere in the UI. Under the hood
  // it's still a small data file — that part doesn't change — but nothing
  // about how it's presented looks like a developer export tool.
  // Builds the single-job file (photos included) that XL or another device can import.
  // withPhotos=false gives a small file with the job info only (what XL imports); the PDF already carries the pictures.
  async function buildCurrentJobFile(withPhotos = true): Promise<File | null>{
    const p = getProject();
    if(!p){ toast('No job selected'); return null; }
    toast('Packing up the job…');
    let hydrated;
    try {
      if(withPhotos){
        hydrated = (await hydrateProjects([p]))[0]; // pull photo bytes in so the file is self-contained
      } else {
        hydrated = JSON.parse(JSON.stringify(p));
        hydrated.photos = [];
      }
    } catch {
      toast('Could not prepare the job file'); return null;
    }
    const envelope = { type: 'nextlevel-job', version: 1, project: hydrated };
    const json = JSON.stringify(envelope);
    const safeName = (p.name || 'Job').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'Job';
    // The photo-free copy goes out through the phone's share menu, which only accepts certain file types
    // (PDF and plain text are fine, .json is refused), so it is a .txt file. The contents are the same.
    if(!withPhotos) return new File([json], `${safeName}-job-info.txt`, { type: 'text/plain' });
    return new File([json], `${safeName}.json`, { type: 'application/json' });
  }

  async function sendCurrentJob(){
    const p = getProject();
    const file = await buildCurrentJobFile();
    if(!p || !file) return;
    const filename = file.name;

    // Prefer the device's native share sheet (text/email/AirDrop/etc) when available.
    const nav = navigator as any;
    if(nav.canShare && nav.canShare({ files: [file] })){
      try {
        await nav.share({ files: [file], title: p.name, text: `Job: ${p.name}` });
        toast('Sent!');
        return;
      } catch(err: any) {
        if(err?.name === 'AbortError') return; // they backed out of the share sheet — not an error
        // any other failure: fall through to the download fallback below
      }
    }
    // Fallback (desktop / unsupported browsers): plain download, attach it themselves.
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Downloaded — attach it to your email or text');
  }
  async function openJobFile(file: File){
    let text: string;
    try { text = await file.text(); } catch { toast('Could not read that file'); return; }
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { toast("That doesn't look like a job file"); return; }
    const incoming = parsed?.type === 'nextlevel-job' ? parsed.project : null;
    if(!incoming || typeof incoming !== 'object'){ toast("That doesn't look like a job file"); return; }
    incoming.id = uid(); // always lands as a NEW entry - never silently overwrites an existing job
    incoming.photos = incoming.photos || [];
    try {
      await dehydrateProjects([incoming]); // pulls inline photo bytes into IndexedDB, strips them
    } catch { /* private mode etc - leave photos inline, they'll still show */ }
    incoming.lastUsed = Date.now();
    projects.push(incoming);
    currentProjectId = incoming.id;
    save();
    toast(`📥 Job in! "${incoming.name}" added to your list`);
    notifyCapture(); // lets an open job list refresh itself
  }

  // The Design Studio's outputs for a job: for every page a plan picture and a cabinet takeoff (CSV, not PDF, so it can be edited or fed to other software), plus one combined takeoff when there is more than one page.
  async function designFiles(p: Project): Promise<Array<{ name: string; mime: string; data: string | Blob }>> {
    const out: Array<{ name: string; mime: string; data: string | Blob }> = [];
    const pgs = pagesOf(p).filter(pg => hasDesign(pg.design));
    for (const pg of pgs) {
      const safe = pg.name.replace(/[\\/:*?"<>|]+/g, '').trim() || 'Page';
      const png = await designPng(pg.design, [p.customer, p.name, pg.name].filter(Boolean).join(' - ')).catch(() => null);
      if (png) out.push({ name: `${safe} - Plan.png`, mime: 'image/png', data: png });
      const csv = takeoffCsv(pg.design, p);
      if (csv) out.push({ name: `${safe} - Takeoff.csv`, mime: 'text/csv', data: csv });
    }
    if (pgs.length > 1) { const all = takeoffCsvAll(pgs, p); if (all) out.push({ name: 'All Pages - Takeoff.csv', mime: 'text/csv', data: all }); }
    return out;
  }

  // Picture + job-file inputs that live in the page shell (hidden inputs the React screens click).
  function wireShell(){
    async function onPhotoFile(file: File){
      const id = uid();
      let src: Blob = file;
      const t = (file.type || '').toLowerCase();
      const plain = t === 'image/jpeg' || t === 'image/png' || t === 'image/webp' || t === 'image/gif';
      const byName = /hei[cf]$/i.test(file.name || '') || /hei[cf]/.test(t);
      try {
        if(byName || !plain){
          const lib = await import('heic-to');
          if(byName || await lib.isHeic(file)){
            toast('Converting picture…');
            src = await lib.heicTo({ blob: file, type: 'image/jpeg', quality: 0.9 });
          }
        }
      } catch {
        toast('This picture could not be read');
        return;
      }
      openPhotoBooth({ imageBlob: src, onSave: (blob) => savePhotoBlob(id, blob, true) });
    }
    const camInput = document.getElementById('photo-input-camera') as HTMLInputElement | null;
    const galInput = document.getElementById('photo-input-gallery') as HTMLInputElement | null;
    [camInput, galInput].forEach(input => {
      input?.addEventListener('change', e => {
        const file = (e.target as HTMLInputElement).files?.[0];
        (e.target as HTMLInputElement).value = '';
        if(file) onPhotoFile(file);
      });
    });
    document.getElementById('job-file-input')?.addEventListener('change', e => {
      const file = (e.target as HTMLInputElement).files?.[0];
      (e.target as HTMLInputElement).value = '';
      if(file) openJobFile(file);
    });
  }

  /* ── INIT ─────────────────────────────────────────── */
  try{
    projects = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  }catch(e){ projects = []; }
  projects.forEach(p => {
    p.photos = p.photos || [];
    // Old drawings from the previous Design side were test work and are dropped.
    delete (p as any).pages; delete (p as any).canvas; delete (p as any).takeoffAdj; delete (p as any).customItems;
  });

  // One-time migration: move any legacy inline base64 photos into IndexedDB,
  // then persist the now-light projects JSON.
  dehydrateProjects(projects).then(n => {
    if(n > 0){ save(); notifyCapture(); }
    updateStorageMeter();
  });

  if(projects.length > 0) currentProjectId = projects[0].id;

  wireShell();

  // Auto-save every 30 seconds
  setInterval(() => { save(); }, 30000);


  // ── Bridge for the React launcher/hub ────────────────────────────────
  // Lets the launcher's New/Open doors drive real project actions that live
  // inside this closure, instead of clicking hidden DOM buttons.
  (window as any).NextLevel = {
    newJob(): string {
      const p = newProject();
      p.lastUsed = Date.now();
      projects.push(p);
      currentProjectId = p.id;
      save();
      return p.id;
    },
    listJobs(): Array<{ id: string; name: string; category: string; photoCount: number; noteCount: number }> {
      return visibleJobs(false).map(p => ({
        id: p.id,
        name: p.name,
        category: p.category,
        photoCount: p.photos?.length || 0,
        noteCount: (p.scratch?.length || 0) + (p.photos || []).filter(ph => ph.note && ph.note.trim()).length,
      }));
    },
    openJob(id: string): void {
      const p = projects.find(x => x.id === id);
      if (!p) return;
      p.lastUsed = Date.now();
      currentProjectId = p.id;
      save();
    },

    // â”€â”€ Capture screen bridge (new) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    getCapture() {
      const p = getProject();
      if (!p) return null;
      return {
        id: p.id, name: p.name,
        customer: p.customer || '', phone: p.phone || '', address: p.address || '',
        date: p.date || '', jobDesc: p.jobDesc || '', jobNotes: p.jobNotes || '', email: p.email || '',
        polished: p.polished || null, polishedFrom: p.polishedFrom || '', polishUndo: p.polishUndo ?? null,
        scratch: (p.scratch || []).map(s => ({ id: s.id, text: s.text })),
        photos: (p.photos || []).map(ph => ({ id: ph.id, caption: ph.caption || '', note: ph.note || '', timestamp: ph.timestamp })),
      };
    },
    setCapture(patch: Record<string, string>): void {
      const p = getProject();
      if (!p) return;
      p.lastUsed = Date.now();
      const prevCustomer = p.customer || '';
      (['customer', 'phone', 'address', 'date', 'jobDesc', 'jobNotes', 'email'] as const).forEach(k => {
        if (typeof patch[k] === 'string') (p as any)[k] = patch[k];
      });
      if (typeof patch.customer === 'string' && (p.name === 'New Project' || p.name === prevCustomer)) {
        p.name = patch.customer || 'New Project';
      }
      save();
    },
    setScratch(items: Array<{ id: string; text: string }>): void {
      const p = getProject();
      if (!p) return;
      p.scratch = items.map(s => ({ id: String(s.id), text: String(s.text) }));
      save();
    },
    // Keeps the Polish result with the job so leaving the screen never loses it.
    setPolish(patch: { items?: string[] | null; source?: string; undo?: string | null }): void {
      const p = getProject();
      if (!p) return;
      if (patch.items === null) { delete p.polished; delete p.polishedFrom; }
      else if (Array.isArray(patch.items)) { p.polished = patch.items.map(x => String(x)); p.polishedFrom = String(patch.source || ''); }
      if (patch.undo === null) delete p.polishUndo;
      else if (typeof patch.undo === 'string') p.polishUndo = patch.undo;
      save();
    },
    // Removes one whole job (and its saved pictures). The job lists ask "are you sure" before calling this.
    deleteJob(id: string): void {
      const p = projects.find(x => x.id === id);
      if (!p) return;
      (p.photos || []).forEach(ph => { try { Promise.resolve(deletePhotoBlob(ph.id)).catch(() => { /* ignore */ }); } catch { /* ignore */ } });
      driveSkipAdd(id);
      projects = projects.filter(x => x.id !== id);
      if (currentProjectId === id) { currentProjectId = projects[0]?.id || null; }
      save();
      notifyCapture();
    },
    async photoUrl(id: string): Promise<string | null> {
      const ph = getProject()?.photos?.find(x => x.id === id);
      if (!ph) return null;
      try { return (await getDisplayURL(ph)) || null; } catch { return null; }
    },
    setPhoto(id: string, patch: { caption?: string; note?: string }): void {
      const ph = getProject()?.photos?.find(x => x.id === id);
      if (!ph) return;
      if (typeof patch.caption === 'string') ph.caption = patch.caption;
      if (typeof patch.note === 'string') ph.note = patch.note;
      save();
      notifyCapture();
    },
    deletePhoto(id: string): void {
      const p = getProject();
      if (!p || !p.photos) return;
      p.photos = p.photos.filter(x => x.id !== id);
      deletePhotoBlob(id);
      save();
      notifyCapture();
      updateStorageMeter();
    },
    markUpPhoto(id: string): void { editExistingPhoto(id); },
    onCapture(cb: () => void): () => void {
      captureListeners.push(cb);
      return () => { const i = captureListeners.indexOf(cb); if (i >= 0) captureListeners.splice(i, 1); };
    },
    // Same single-job send / open used by the full app's side menu, reachable from Capture and the job lists.
    sendJob(): void { sendCurrentJob(); },
    // The job file (JSON) on its own, so the Job Sheet's email button can attach it next to the PDF.
    buildJobFile(withPhotos?: boolean): Promise<File | null> { return buildCurrentJobFile(withPhotos); },
    // Google Drive hand-off: the phone saves each job as its own Drive file; the PC lists them and pulls them in.
    driveState(): { configured: boolean; connected: boolean } { return { configured: driveConfigured, connected: isDriveConnected() }; },
    async driveConnect(): Promise<void> { await connectBackup(); },
    driveSavedAt(id: string): number {
      try { return Number(JSON.parse(localStorage.getItem('nextlevel_job_drive_saved') || '{}')[id]) || 0; } catch { return 0; }
    },
    // Saves the job into its own Drive folder (JQC Jobs > year > job). The job file and a freshly built Field Report PDF
    // are saved together every time.
    async saveJobToDrive(id?: string): Promise<void> {
      const p = id ? projects.find(x => x.id === id) : getProject();
      if (!p) throw new Error('No job selected');
      if (isBlankJob(p)) throw new Error('Nothing to save yet. Add something to the job first.');
      const hydrated = (await hydrateProjects([p]))[0]; // pull picture bytes in so the Drive copy is complete
      let pdf: Blob | undefined;
      {
        const { buildJobSheetPdf } = await import('./lib/jobSheetPdf');
        const built = await buildJobSheetPdf({
          name: p.name || '', customer: p.customer || '', date: p.date || '', phone: p.phone || '', email: p.email || '',
          address: p.address || '', jobDesc: p.jobDesc || '', jobNotes: p.jobNotes || '',
          scratch: (p.scratch || []).map(s => ({ id: s.id, text: s.text })),
          photos: (p.photos || []).map(ph => ({ id: ph.id, caption: ph.caption || '', note: ph.note || '' })),
        }, async (pid: string) => {
          const ph = (p.photos || []).find(x => x.id === pid);
          if (!ph) return null;
          try { return (await getDisplayURL(ph)) || null; } catch { return null; }
        });
        pdf = built.blob;
      }
      await saveJobFolder({ id: p.id, name: p.name || '', customer: p.customer || '', jobDesc: p.jobDesc || '', date: p.date || '' }, { type: 'nextlevel-job', version: 1, project: hydrated }, pdf, await designFiles(p));
      try {
        const m = JSON.parse(localStorage.getItem('nextlevel_job_drive_saved') || '{}');
        m[p.id] = Date.now();
        localStorage.setItem('nextlevel_job_drive_saved', JSON.stringify(m));
      } catch { /* ignore */ }
    },
    async listDriveJobs(): Promise<Array<{ fileId: string; jobId: string; name: string; modified: string; onDevice: boolean; skipped: boolean }>> {
      const entries = await listJobBackups();
      return entries.map(f => {
        const onDevice = projects.some(x => x.id === f.jobId);
        return { fileId: f.fileId, jobId: f.jobId, name: f.name, modified: f.modified, onDevice, skipped: !onDevice && driveSkipList().includes(f.jobId) };
      });
    },
    // Brings one Drive job onto this device. Keeps the job's own id so a later save from the phone lines up with it.
    // Returns 'exists' (and changes nothing) when the job is already here and replace is false.
    async importDriveJob(fileId: string, replace: boolean): Promise<'added' | 'replaced' | 'exists'> {
      const parsed: any = await loadJobBackup<any>(fileId);
      const incoming = parsed?.type === 'nextlevel-job' ? parsed.project : null;
      if (!incoming || !incoming.id) throw new Error('That Drive file is not a Field & Desk job');
      const idx = projects.findIndex(x => x.id === incoming.id);
      if (idx >= 0 && !replace) return 'exists';
      incoming.photos = incoming.photos || [];
      try { await dehydrateProjects([incoming]); } catch { /* private mode etc: pictures stay inline and still show */ }
      incoming.lastUsed = Date.now();
      if (idx >= 0) {
        const keep = new Set<string>(incoming.photos.map((ph: any) => ph.id));
        (projects[idx].photos || []).forEach((ph: any) => {
          if (!keep.has(ph.id)) { try { Promise.resolve(deletePhotoBlob(ph.id)).catch(() => { /* ignore */ }); } catch { /* ignore */ } }
        });
        projects[idx] = incoming;
      } else {
        projects.push(incoming);
      }
      if (!currentProjectId) { currentProjectId = incoming.id; }
      driveSkipRemove(incoming.id);
      save(); notifyCapture();
      return idx >= 0 ? 'replaced' : 'added';
    },
    // Design Studio: a job holds pages (drawings). get/setDesign work on the page that is open.
    getPages(): { pages: Array<{ id: string; name: string; has: boolean }>; cur: string | null } {
      const p = getProject(); if (!p) return { pages: [], cur: null };
      const cur = curPageOf(p); return { pages: pagesOf(p).map(x => ({ id: x.id, name: x.name, has: hasDesign(x.design) })), cur: cur?.id ?? null };
    },
    getDesign(): any { const p = getProject(); return p ? curPageOf(p)?.design ?? null : null; },
    setDesign(d: any): void {
      const p = getProject(); if (!p) return;
      let pg = curPageOf(p);
      if (!pg) { pg = { id: uid(), name: d?.mode === 'kitchen' ? 'Kitchen' : 'Bathroom', design: d }; p.pages!.push(pg); } else pg.design = d;
      p.curPage = pg.id; p.lastUsed = Date.now(); save();
    },
    addPage(name: string, design: any): string {
      const p = getProject(); if (!p) return ''; pagesOf(p);
      const pg: DesignPage = { id: uid(), name: pageName(p, name), design }; p.pages!.push(pg); p.curPage = pg.id; p.lastUsed = Date.now(); save(); return pg.id;
    },
    openPage(id: string): void { const p = getProject(); if (!p || !pagesOf(p).some(x => x.id === id)) return; p.curPage = id; save(); },
    renamePage(id: string, name: string): void { const p = getProject(); const pg = p && pagesOf(p).find(x => x.id === id); if (!p || !pg) return; pg.name = pageName(p, name, id); save(); },
    deletePage(id: string): void { const p = getProject(); if (!p) return; p.pages = pagesOf(p).filter(x => x.id !== id); if (p.curPage === id) p.curPage = p.pages[0]?.id; save(); },
    async designPicture(): Promise<Blob | null> {
      const p = getProject(); const pg = p && curPageOf(p); return p && pg && hasDesign(pg.design) ? designPng(pg.design, [p.customer, p.name, pg.name].filter(Boolean).join(' - ')) : null;
    },
    designTakeoff(all?: boolean): { csv: string; filename: string } | null {
      const p = getProject(); if (!p) return null;
      if (all) { const csv = takeoffCsvAll(pagesOf(p).filter(pg => hasDesign(pg.design)), p); return csv ? { csv, filename: 'All Pages - Takeoff.csv' } : null; }
      const pg = curPageOf(p); const csv = pg && hasDesign(pg.design) ? takeoffCsv(pg.design, p) : null;
      return csv ? { csv, filename: `${pg!.name} - Takeoff.csv` } : null;
    },
    pickJobFile(): void { document.getElementById('job-file-input')?.click(); },
  };
}
