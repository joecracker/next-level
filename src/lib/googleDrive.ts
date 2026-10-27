/**
 * Lightweight Google Drive backup engine using Google Identity Services (GIS).
 *
 * Scope used: https://www.googleapis.com/auth/drive.file
 * That scope ONLY grants access to files this app itself creates (or files the
 * user explicitly opens with a picker, which we don't use) — it can NOT see,
 * list, or touch the rest of the user's Drive. Safe by construction.
 *
 * No client secret, no backend required: this is a pure client-side OAuth
 * "token client" flow. The Client ID is public (it identifies the app, not a
 * secret) but it must be paired with an authorized JavaScript origin
 * configured in Google Cloud Console — see GOOGLE_DRIVE_SETUP.md.
 */

declare global {
  interface Window {
    google?: any;
  }
}

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const TOKEN_STORAGE_KEY = 'gdrive_backup_token_v1';

interface TokenInfo {
  accessToken: string;
  expiresAt: number;
}

let tokenClient: any = null;
let cachedToken: TokenInfo | null = loadToken();

function loadToken(): TokenInfo | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TokenInfo;
    if (parsed.expiresAt > Date.now()) return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

function storeToken(t: TokenInfo) {
  cachedToken = t;
  try {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(t));
  } catch {
    /* ignore */
  }
}

function clearToken() {
  cachedToken = null;
  try {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function loadGisScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve();
      return;
    }
    const existing = document.querySelector(`script[src="${GIS_SRC}"]`) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load Google Identity Services')));
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(script);
  });
}

export function isDriveConnected(): boolean {
  return Boolean(cachedToken);
}

export async function connectDrive(clientId: string): Promise<void> {
  if (!clientId) {
    throw new Error('Google Client ID not configured. See GOOGLE_DRIVE_SETUP.md.');
  }
  await loadGisScript();
  return new Promise((resolve, reject) => {
    tokenClient = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (resp: any) => {
        if (resp.error) {
          reject(new Error(resp.error));
          return;
        }
        storeToken({
          accessToken: resp.access_token,
          expiresAt: Date.now() + (Number(resp.expires_in || 3600) - 60) * 1000,
        });
        resolve();
      },
      error_callback: (err: any) => {
        reject(new Error(err?.type || 'Google sign-in was cancelled or failed'));
      },
    });
    tokenClient.requestAccessToken({ prompt: cachedToken ? '' : 'consent' });
  });
}

export function disconnectDrive() {
  const token = cachedToken?.accessToken;
  clearToken();
  if (token && window.google?.accounts?.oauth2?.revoke) {
    window.google.accounts.oauth2.revoke(token, () => {
      /* noop */
    });
  }
}

async function ensureToken(clientId: string): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.accessToken;
  await connectDrive(clientId);
  if (!cachedToken) throw new Error('Could not get a Google Drive access token');
  return cachedToken.accessToken;
}

async function findFile(accessToken: string, folderId: string, fileName: string): Promise<string | null> {
  const escaped = fileName.replace(/'/g, "\\'");
  const q = encodeURIComponent(`'${folderId}' in parents and name = '${escaped}' and trashed = false`);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Drive search failed (${res.status})`);
  const json = await res.json();
  return json.files?.[0]?.id ?? null;
}

// Resolves the backup folder by NAME in whichever account is currently
// connected, creating it if it doesn't exist yet — instead of a hardcoded
// folder ID that only exists in one specific person's Drive. That hardcoded
// approach broke the moment anyone other than the original account
// connected: their drive.file-scoped token has zero access to a folder ID
// it didn't create, so every save/restore would just fail for them. Cached
// in-memory per session so repeated backups don't re-search every time.
const folderIdCache = new Map<string, string>();
async function findOrCreateFolder(accessToken: string, folderName: string): Promise<string> {
  const cached = folderIdCache.get(folderName);
  if (cached) return cached;

  const escaped = folderName.replace(/'/g, "\\'");
  const q = encodeURIComponent(`mimeType='application/vnd.google-apps.folder' and name='${escaped}' and trashed=false`);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Drive folder lookup failed (${res.status})`);
  const json = await res.json();
  let folderId: string | undefined = json.files?.[0]?.id;

  if (!folderId) {
    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: folderName, mimeType: 'application/vnd.google-apps.folder' }),
    });
    if (!createRes.ok) throw new Error(`Drive folder create failed (${createRes.status})`);
    const created = await createRes.json();
    folderId = created.id;
  }

  folderIdCache.set(folderName, folderId!);
  return folderId!;
}

export interface DriveBackupConfig {
  clientId: string;
  folderName: string;
  fileName: string;
}

export interface DriveSaveResult {
  fileId: string;
  savedAt: string;
}

export async function saveToDrive(cfg: DriveBackupConfig, data: unknown): Promise<DriveSaveResult> {
  const accessToken = await ensureToken(cfg.clientId);
  const folderId = await findOrCreateFolder(accessToken, cfg.folderName);
  const existingId = await findFile(accessToken, folderId, cfg.fileName);
  const content = JSON.stringify(data, null, 2);
  const metadata = existingId ? { name: cfg.fileName } : { name: cfg.fileName, parents: [folderId] };

  const boundary = 'gdrive_backup_boundary_' + Math.random().toString(36).slice(2);
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n` +
    `--${boundary}--`;

  const url = existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;

  const res = await fetch(url, {
    method: existingId ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) throw new Error(`Drive save failed (${res.status}): ${await res.text()}`);
  const json = await res.json();
  return { fileId: json.id, savedAt: new Date().toISOString() };
}

export async function loadFromDrive<T = unknown>(cfg: DriveBackupConfig): Promise<T | null> {
  const accessToken = await ensureToken(cfg.clientId);
  const folderId = await findOrCreateFolder(accessToken, cfg.folderName);
  const fileId = await findFile(accessToken, folderId, cfg.fileName);
  if (!fileId) return null;
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Drive load failed (${res.status})`);
  return (await res.json()) as T;
}

// ---- One file per item (used for per-job saves) -------------------------------------------
export interface DriveFolderConfig {
  clientId: string;
  folderName: string;
}

export interface DriveFileInfo {
  id: string;
  name: string;
  modifiedTime: string;
  appProperties?: Record<string, string>;
}

export async function saveNamedFile(
  cfg: DriveFolderConfig,
  fileName: string,
  data: unknown,
  appProperties?: Record<string, string>,
): Promise<DriveSaveResult> {
  const accessToken = await ensureToken(cfg.clientId);
  const folderId = await findOrCreateFolder(accessToken, cfg.folderName);
  const existingId = await findFile(accessToken, folderId, fileName);
  const content = JSON.stringify(data); // compact: jobs carry their pictures
  const metadata: Record<string, unknown> = existingId ? { name: fileName } : { name: fileName, parents: [folderId] };
  if (appProperties) metadata.appProperties = appProperties;

  const boundary = 'gdrive_job_boundary_' + Math.random().toString(36).slice(2);
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n` +
    `--${boundary}--`;
  const url = existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
  const res = await fetch(url, {
    method: existingId ? 'PATCH' : 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw new Error(`Drive save failed (${res.status}): ${await res.text()}`);
  const json = await res.json();
  return { fileId: json.id, savedAt: new Date().toISOString() };
}

export async function listNamedFiles(cfg: DriveFolderConfig, namePrefix: string): Promise<DriveFileInfo[]> {
  const accessToken = await ensureToken(cfg.clientId);
  const folderId = await findOrCreateFolder(accessToken, cfg.folderName);
  const escaped = namePrefix.replace(/'/g, "\\'");
  const q = encodeURIComponent(`'${folderId}' in parents and name contains '${escaped}' and trashed = false`);
  const out: DriveFileInfo[] = [];
  let pageToken = '';
  do {
    const url =
      `https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=modifiedTime%20desc&pageSize=100` +
      `&fields=nextPageToken,files(id,name,modifiedTime,appProperties)` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`Drive list failed (${res.status})`);
    const json = await res.json();
    out.push(...((json.files || []) as DriveFileInfo[]));
    pageToken = json.nextPageToken || '';
  } while (pageToken);
  return out.filter(f => f.name.startsWith(namePrefix));
}

export async function loadFileById<T = unknown>(clientId: string, fileId: string): Promise<T> {
  const accessToken = await ensureToken(clientId);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Drive load failed (${res.status})`);
  return (await res.json()) as T;
}

// ---- One folder per job (job file, Field Report PDF, the estimate Excel all live together) ---------------
// Everything is created by this app's Google client, so the drive.file scope can see it from every
// Next Level app that uses the same client. Folders are found by the job id stored on them, so renaming a
// folder or changing the customer name never loses track of it.
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const escQ = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

async function listAllFiles<T>(accessToken: string, baseUrl: string, what: string): Promise<T[]> {
  const out: T[] = [];
  let page = '';
  do {
    const url = baseUrl + (page ? `&pageToken=${encodeURIComponent(page)}` : '');
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`Drive ${what} failed (${res.status})`);
    const json = await res.json();
    out.push(...((json.files || []) as T[]));
    page = json.nextPageToken || '';
  } while (page);
  return out;
}

// Layout 2: JQC Jobs > year > job folder. Every folder made this way carries layout:'2', so the older
// "Next Level Jobs" folders (which have no mark) are never listed, moved or changed.
const LAYOUT = '2';

/** The year a job is filed under: taken from its Date text (any common format), else this year. */
export function jobYear(dateText?: string): string {
  const s = (dateText || '').trim();
  const now = new Date().getFullYear();
  const four = s.match(/\b(?:19|20)\d{2}\b/);
  if (four && Number(four[0]) <= now + 1) return four[0];
  const two = s.match(/^\d{1,2}[\/.-]\d{1,2}[\/.-](\d{2})$/);
  if (two) return String(2000 + Number(two[1]));
  const t = Date.parse(s);
  if (!isNaN(t)) {
    const y = new Date(t).getFullYear();
    if (y >= 1990 && y <= now + 1) return String(y);
  }
  return String(now);
}

/** Finds (or makes) a year folder inside the main folder. Not cached, so a folder deleted in Drive is simply made again. */
async function findOrCreateYearFolder(accessToken: string, parentId: string, name: string): Promise<string> {
  const q = encodeURIComponent(
    `'${parentId}' in parents and mimeType='${FOLDER_MIME}' and name='${escQ(name)}' and trashed=false`,
  );
  const found = await listAllFiles<{ id: string }>(
    accessToken,
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id)&orderBy=createdTime&pageSize=10`,
    'year folder lookup',
  );
  if (found.length) return found[0].id;
  const res = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId], appProperties: { layout: LAYOUT, kind: 'year' } }),
  });
  if (!res.ok) throw new Error(`Drive year folder create failed (${res.status})`);
  return (await res.json()).id as string;
}

/**
 * Finds (or makes) the folder for one job and returns its id. New jobs are filed under main folder > year
 * (year comes from the job's Date); a job that already has a folder keeps it, so it stays in the year it started.
 * The folder is renamed if the title changed.
 */
export async function ensureJobFolder(
  cfg: DriveFolderConfig,
  jobId: string,
  folderTitle: string,
  jobName: string,
  year?: string,
): Promise<string> {
  const accessToken = await ensureToken(cfg.clientId);
  const q = encodeURIComponent(
    `mimeType='${FOLDER_MIME}' and appProperties has { key='jobId' and value='${escQ(jobId)}' } and appProperties has { key='layout' and value='${LAYOUT}' } and trashed=false`,
  );
  const found = await listAllFiles<{ id: string; name: string }>(
    accessToken,
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name)&pageSize=10`,
    'folder lookup',
  );
  if (found.length) {
    const f = found[0];
    if (f.name !== folderTitle) {
      try {
        await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: folderTitle, appProperties: { jobId, jobName, layout: LAYOUT } }),
        });
      } catch {
        /* a failed rename is not worth stopping the save for */
      }
    }
    return f.id;
  }
  const rootId = await findOrCreateFolder(accessToken, cfg.folderName);
  const yearId = await findOrCreateYearFolder(accessToken, rootId, year || jobYear());
  const res = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: folderTitle, mimeType: FOLDER_MIME, parents: [yearId], appProperties: { jobId, jobName, layout: LAYOUT } }),
  });
  if (!res.ok) throw new Error(`Drive folder create failed (${res.status})`);
  return (await res.json()).id as string;
}

/** Saves (or replaces) one file inside a job folder. Text or a Blob (PDF, Excel) both work. */
export async function saveFileInFolder(
  clientId: string,
  folderId: string,
  fileName: string,
  mime: string,
  data: string | Blob,
): Promise<string> {
  const accessToken = await ensureToken(clientId);
  const existingId = await findFile(accessToken, folderId, fileName);
  const metadata = existingId ? { name: fileName } : { name: fileName, parents: [folderId] };
  const boundary = 'gdrive_folder_boundary_' + Math.random().toString(36).slice(2);
  const head =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`;
  const body = new Blob([head, data, `\r\n--${boundary}--`]);
  const url = existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
  const res = await fetch(url, {
    method: existingId ? 'PATCH' : 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw new Error(`Drive save failed (${res.status}): ${await res.text()}`);
  return (await res.json()).id as string;
}

export interface DriveJobEntry {
  jobId: string;
  name: string;
  modified: string;
  /** The job file (job.json in a job folder, or an older single job-xxxx.json file). */
  fileId: string;
  /** The job's folder, or null for an older single-file job. */
  folderId: string | null;
  /** Estimate.xlsx in the job's folder, if XL has saved one. */
  estimateFileId: string | null;
}

/** Every job filed in the JQC Jobs > year > job layout, newest first. Older "Next Level Jobs" folders are not listed. */
export async function listJobEntries(cfg: DriveFolderConfig): Promise<DriveJobEntry[]> {
  const accessToken = await ensureToken(cfg.clientId);
  const base = 'https://www.googleapis.com/drive/v3/files?pageSize=100';

  const folders = await listAllFiles<{ id: string; name: string; appProperties?: Record<string, string> }>(
    accessToken,
    `${base}&q=${encodeURIComponent(`mimeType='${FOLDER_MIME}' and appProperties has { key='layout' and value='${LAYOUT}' } and trashed=false`)}&fields=nextPageToken,files(id,name,appProperties)`,
    'folder list',
  );
  const byName = async (name: string) =>
    listAllFiles<{ id: string; parents?: string[]; modifiedTime: string }>(
      accessToken,
      `${base}&q=${encodeURIComponent(`name = '${name}' and trashed = false`)}&fields=nextPageToken,files(id,parents,modifiedTime)`,
      'file list',
    );
  const [jobFiles, estimateFiles] = await Promise.all([byName('job.json'), byName('Estimate.xlsx')]);
  const jobIn = new Map<string, { id: string; modifiedTime: string }>();
  jobFiles.forEach(f => (f.parents || []).forEach(p => jobIn.set(p, f)));
  const estIn = new Map<string, string>();
  estimateFiles.forEach(f => (f.parents || []).forEach(p => estIn.set(p, f.id)));

  const out: DriveJobEntry[] = [];
  const seen = new Set<string>();
  for (const fo of folders) {
    const jobId = fo.appProperties?.jobId; // year folders have no jobId, so they are skipped here
    const jf = jobId ? jobIn.get(fo.id) : undefined;
    if (!jobId || !jf || seen.has(jobId)) continue;
    seen.add(jobId);
    out.push({ jobId, name: fo.name, modified: jf.modifiedTime, fileId: jf.id, folderId: fo.id, estimateFileId: estIn.get(fo.id) || null });
  }
  return out.sort((a, b) => (a.modified < b.modified ? 1 : -1));
}

/** The file with this name inside a folder, or null. */
export async function findFileInFolder(clientId: string, folderId: string, fileName: string): Promise<string | null> {
  const accessToken = await ensureToken(clientId);
  return findFile(accessToken, folderId, fileName);
}

/** Downloads a file's bytes (the Excel, a PDF). */
export async function downloadFile(clientId: string, fileId: string): Promise<Blob> {
  const accessToken = await ensureToken(clientId);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Drive download failed (${res.status})`);
  return res.blob();
}
