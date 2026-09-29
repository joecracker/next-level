/* ════════════════════════════════════════════════════════════════════════
   photoStore.ts — Photo byte storage for Next Level.

   WHY THIS EXISTS
   ---------------
   Photos used to live as base64 `dataUrl` strings inside each project, and the
   whole projects array was JSON.stringify'd into ONE localStorage key on every
   save. localStorage caps at ~5–10MB, so a few marked-up photos would blow it
   and silently fail to save — losing field data.

   THE FIX
   -------
   Image bytes now live in IndexedDB as real Blobs (hundreds of MB — GBs of room,
   async, offline). The project JSON keeps only lightweight photo metadata
   ({ id, caption, timestamp }) and REFERENCES the blob by id. `dataUrl` on a
   Photo is now transient-only: it exists while hydrating for export/Drive, or as
   a graceful fallback if IndexedDB is unavailable (e.g. private mode).

   Nothing here touches finances or proposals — pure storage plumbing.
   ════════════════════════════════════════════════════════════════════════ */

const DB_NAME = 'nextlevel_photos';
const STORE = 'photos';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE); // key = photo id, value = Blob
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
  return dbPromise;
}

function tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return openDB().then(db => db.transaction(STORE, mode).objectStore(STORE));
}

/* ── core blob ops ─────────────────────────────────────────────────────── */

export async function putPhoto(id: string, blob: Blob): Promise<void> {
  const store = await tx('readwrite');
  return new Promise((resolve, reject) => {
    const r = store.put(blob, id);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

export async function getPhotoBlob(id: string): Promise<Blob | null> {
  const store = await tx('readonly');
  return new Promise((resolve, reject) => {
    const r = store.get(id);
    r.onsuccess = () => resolve((r.result as Blob) || null);
    r.onerror = () => reject(r.error);
  });
}

export async function deletePhotoBlob(id: string): Promise<void> {
  revokeURL(id);
  try {
    const store = await tx('readwrite');
    await new Promise<void>((resolve, reject) => {
      const r = store.delete(id);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
  } catch { /* ignore — blob may never have been stored */ }
}

/* Wipes every stored photo blob — used by the app-wide "Clear All Data"
   reset. Clears the object store rather than deleting the whole DB so an
   open connection elsewhere doesn't get orphaned mid-transaction. */
export async function clearAllPhotos(): Promise<void> {
  try {
    const store = await tx('readwrite');
    await new Promise<void>((resolve, reject) => {
      const r = store.clear();
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
  } catch { /* ignore */ }
  urlCache.forEach((_, id) => revokeURL(id));
  urlCache.clear();
}

/* ── object-URL cache (one live URL per photo id; reused across renders) ── */

const urlCache = new Map<string, string>();

/** Returns a displayable URL for a stored photo, or null if not found. Cached. */
export async function getPhotoURL(id: string): Promise<string | null> {
  const cached = urlCache.get(id);
  if (cached) return cached;
  try {
    const blob = await getPhotoBlob(id);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    urlCache.set(id, url);
    return url;
  } catch {
    return null;
  }
}

export function revokeURL(id: string): void {
  const url = urlCache.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    urlCache.delete(id);
  }
}

/** Best display URL for a photo: inline fallback first (private mode), else IDB. */
export async function getDisplayURL(photo: { id: string; dataUrl?: string }): Promise<string | null> {
  if (photo.dataUrl) return photo.dataUrl;
  return getPhotoURL(photo.id);
}

/* ── conversions ───────────────────────────────────────────────────────── */

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',');
  const mime = /:(.*?);/.exec(head)?.[1] || 'image/jpeg';
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/* ── downscale on capture ──────────────────────────────────────────────────
   Field reference photos don't need full resolution. 1600px longest edge as
   JPEG is plenty to read a scribbled measurement, and roughly 10x smaller than
   a raw phone photo. Honors EXIF orientation so nothing lands sideways.        */

export async function downscaleImage(
  file: File | Blob,
  maxDim = 1600,
  quality = 0.82,
): Promise<Blob> {
  let width: number, height: number, source: CanvasImageSource;

  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as any);
    width = bitmap.width; height = bitmap.height; source = bitmap;
  } catch {
    // Fallback path for browsers without createImageBitmap options support
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error('image decode failed'));
        im.src = url;
      });
      width = img.naturalWidth; height = img.naturalHeight; source = img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const scale = Math.min(1, maxDim / Math.max(width, height));
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const cx = canvas.getContext('2d');
  if (!cx) throw new Error('no 2d context');
  cx.drawImage(source, 0, 0, w, h);

  const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', quality));
  if (!blob) throw new Error('canvas toBlob failed');
  return blob;
}

/* ── storage meter ─────────────────────────────────────────────────────── */

export async function estimateStorage(): Promise<{ usedMB: number; quotaMB: number; pct: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  const usedMB = usage / (1024 * 1024);
  const quotaMB = quota / (1024 * 1024);
  return { usedMB, quotaMB, pct: quota ? (usage / quota) * 100 : 0 };
}

/* ── hydrate / dehydrate (the migration + export/backup bridge) ─────────────
   The live `projects` array is kept LIGHT (no dataUrls). These helpers bridge
   to formats that need self-contained bytes.                                   */

// Minimal shapes so this module doesn't depend on app.ts's interfaces.
interface PhotoLike { id: string; dataUrl?: string; caption?: string; timestamp?: string; }
interface ProjectLike { photos?: PhotoLike[]; }

/**
 * Pull any inline `dataUrl`s OUT of the given projects into IndexedDB, stripping
 * them from the objects (mutates in place). Used on first load (migration of old
 * base64 photos), on JSON import, and on Drive restore.
 * Returns the number of photos migrated.
 */
export async function dehydrateProjects(projects: ProjectLike[]): Promise<number> {
  let migrated = 0;
  for (const p of projects) {
    if (!p.photos) continue;
    for (const photo of p.photos) {
      if (!photo.dataUrl) continue;
      try {
        await putPhoto(photo.id, dataUrlToBlob(photo.dataUrl));
        delete photo.dataUrl;
        migrated++;
      } catch {
        // IndexedDB unavailable — leave dataUrl inline so the photo still shows.
      }
    }
  }
  return migrated;
}

/**
 * Returns a DEEP COPY of projects with each photo's `dataUrl` re-attached from
 * IndexedDB. Used for JSON export and Drive backup so those stay self-contained.
 * Does NOT mutate the live (light) projects array.
 */
export async function hydrateProjects<T extends ProjectLike>(projects: T[]): Promise<T[]> {
  const copy: T[] = JSON.parse(JSON.stringify(projects));
  for (const p of copy) {
    if (!p.photos) continue;
    for (const photo of p.photos) {
      if (photo.dataUrl) continue;
      const blob = await getPhotoBlob(photo.id);
      if (blob) photo.dataUrl = await blobToDataUrl(blob);
    }
  }
  return copy;
}
