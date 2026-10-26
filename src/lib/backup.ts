import {
  connectDrive,
  disconnectDrive,
  isDriveConnected,
  saveToDrive,
  loadFromDrive,
  ensureJobFolder,
  saveFileInFolder,
  listJobEntries,
  loadFileById,
  type DriveBackupConfig,
  type DriveJobEntry,
} from './googleDrive';

// Auto-created (or found) by name inside whichever Google account is
// connected — no longer a hardcoded folder ID, since that only worked for
// the one account it was originally created in. See GOOGLE_DRIVE_SETUP.md.
const FOLDER_NAME = 'Next Level Backups';
const FILE_NAME = 'nextlevel-projects-backup.json';
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

export const driveConfigured = Boolean(CLIENT_ID);

// The whole-device backup is ONE file, and saving replaces it. With a phone and a PC both connected to the same
// Drive, they would keep overwriting each other's copy. So the phone keeps the original file name, and every other
// device gets its own file (named with a short tag made once and kept on that device).
const IS_PHONE = /Android.*Mobile|iPhone|iPod/i.test(navigator.userAgent);
function deviceFileName(): string {
  if (IS_PHONE) return FILE_NAME;
  let tag = '';
  try {
    tag = localStorage.getItem('nextlevel_device_tag') || '';
    if (!tag) { tag = Math.random().toString(36).slice(2, 8); localStorage.setItem('nextlevel_device_tag', tag); }
  } catch { tag = 'pc'; }
  return `nextlevel-projects-backup-${tag}.json`;
}

function cfg(): DriveBackupConfig {
  return { clientId: CLIENT_ID, folderName: FOLDER_NAME, fileName: deviceFileName() };
}

export { isDriveConnected, disconnectDrive };

export async function connectBackup(): Promise<void> {
  await connectDrive(CLIENT_ID);
}

export async function saveBackup(data: unknown) {
  return saveToDrive(cfg(), data);
}

export async function restoreBackup<T = unknown>(): Promise<T | null> {
  return loadFromDrive<T>(cfg());
}

// ---- One Drive folder per job (the job file, the Field Report PDF, and later the estimate) -----
// Separate from the whole-device backup above, so the two never touch each other.
const JOBS_FOLDER_NAME = 'Next Level Jobs';
function jobsCfg() {
  return { clientId: CLIENT_ID, folderName: JOBS_FOLDER_NAME };
}

export type { DriveJobEntry };

// Folder titles read like "Smith - Hall bathroom remodel"; characters Drive or Windows dislike are dropped.
function folderTitle(customer: string, name: string, desc: string): string {
  const who = (customer || name || 'Job').trim();
  const what = (desc || '').trim();
  const t = (what && what.toLowerCase() !== who.toLowerCase() ? `${who} - ${what}` : who)
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.slice(0, 80) || 'Job';
}

/** Saves the job file (and the Field Report PDF when given) into this job's folder, replacing the older copies. */
export async function saveJobFolder(
  job: { id: string; name: string; customer: string; jobDesc: string },
  envelope: unknown,
  pdf?: Blob,
): Promise<void> {
  const title = folderTitle(job.customer, job.name, job.jobDesc);
  const folderId = await ensureJobFolder(jobsCfg(), job.id, title, title.slice(0, 40));
  await saveFileInFolder(CLIENT_ID, folderId, 'job.json', 'application/json', JSON.stringify(envelope));
  if (pdf) await saveFileInFolder(CLIENT_ID, folderId, 'Field Report.pdf', 'application/pdf', pdf);
}

export async function listJobBackups(): Promise<DriveJobEntry[]> {
  return listJobEntries(jobsCfg());
}

export async function loadJobBackup<T = unknown>(fileId: string): Promise<T> {
  return loadFileById<T>(CLIENT_ID, fileId);
}
