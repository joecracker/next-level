// Turns a Google Drive / sign-in failure into one plain sentence.
export function driveError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/popup/i.test(m)) return "Google's sign-in window was blocked. Allow pop-ups for this site, then try again.";
  if (/access_denied|cancel/i.test(m)) return 'Google sign-in was cancelled. Nothing was changed.';
  if (/redirect_uri|origin_mismatch|invalid_client|idpiframe/i.test(m)) return 'Google would not accept the sign-in from this address. (' + m + ')';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Could not reach Google. Check your connection and try again.';
  if (/\(40[13]\)/.test(m)) return 'Google Drive turned this request down. Try connecting again. (' + m + ')';
  return 'Google Drive said: ' + m;
}
