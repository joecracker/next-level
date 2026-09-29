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
