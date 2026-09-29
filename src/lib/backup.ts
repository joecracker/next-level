import {
  connectDrive,
  disconnectDrive,
  isDriveConnected,
  saveToDrive,
  loadFromDrive,
  type DriveBackupConfig,
} from './googleDrive';

// Auto-created (or found) by name inside whichever Google account is
// connected — no longer a hardcoded folder ID, since that only worked for
// the one account it was originally created in. See GOOGLE_DRIVE_SETUP.md.
const FOLDER_NAME = 'Next Level Backups';
const FILE_NAME = 'nextlevel-projects-backup.json';
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

export const driveConfigured = Boolean(CLIENT_ID);

function cfg(): DriveBackupConfig {
  return { clientId: CLIENT_ID, folderName: FOLDER_NAME, fileName: FILE_NAME };
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
