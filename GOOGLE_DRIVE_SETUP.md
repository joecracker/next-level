# Google Drive Backup — one-time setup

All 4 of Tim's apps (Field Layout Tracker, Proposal Builder, Fantasy Draft Assistant, Crackerbox Studio) share the same pattern: a client-side "Save to Drive / Restore from Drive" button, plus a local JSON export/import that always works with zero setup.

The Drive button needs **one Google OAuth Client ID**. It's a public identifier (not a secret) — the same Client ID can be reused across all 4 apps, you just list every app's URL as an "authorized origin."

## 1. Create the OAuth Client ID (5 minutes, one-time)

1. Go to [console.cloud.google.com](https://console.cloud.google.com/) and create a new project (or reuse one) — e.g. "Personal Apps".
2. **APIs & Services → Library** → search "Google Drive API" → **Enable**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External** (unless you have Workspace) → Create.
   - App name: anything, e.g. "Tim's Apps". Support email: your email.
   - Scopes: skip / leave default (the apps request `drive.file` at runtime, no need to pre-declare it here).
   - Test users: add `timthetoolmangraham@gmail.com`. (While the app is in "Testing" mode only listed test users can sign in — that's fine for personal use, no need to publish it.)
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Name: "Personal Apps Web Client".
   - **Authorized JavaScript origins** — add one line per place these apps actually run. As of this doc:
     - `http://localhost:5173` (local dev)
     - `https://nextlevel.crackerbox.app` (Field Layout Tracker — live on Cloudflare Pages)
     - Add a line for each of the other 3 apps' *current* live domain — Netlify is no longer in use for any of Tim's apps, so don't reuse the old `.netlify.app` entries. Check each app's actual host before adding it here.
   - Leave "Authorized redirect URIs" blank — this flow doesn't use redirects.
   - Create → copy the **Client ID** (looks like `123456789-abc...apps.googleusercontent.com`).

## 2. Add the Client ID to each app

In each repo, set the env var (both locally and wherever each app is actually deployed — check each app's own hosting dashboard for environment variable settings):

```
VITE_GOOGLE_CLIENT_ID="123456789-abc...apps.googleusercontent.com"
```

Same value in all 4 apps. Redeploy after adding it.

## 3. How it works / what it can access

- Uses Google Identity Services' client-side "token client" flow — no backend, no client secret, nothing to keep private.
- Scope requested: `drive.file` — this only lets the app see/write files **it created itself**. It cannot browse, read, or touch anything else in your Drive. Revoke access anytime at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).
- Each app writes one JSON file into its own `backups/` folder under `Apps/<App Name>/backups` in your Drive (already created):

| App | Drive folder | Backup file |
|---|---|---|
| Field Layout Tracker | `Apps/Field Layout Tracker/backups` | `nextlevel-projects-backup.json` |
| Proposal Builder | `Apps/Proposal Builder/backups` | `proposal-builder-backup.json` |
| Fantasy Draft Assistant | `Apps/Fantasy Draft Assistant/backups` | `fantasy-draft-assistant-backup.json` |
| Crackerbox Studio | `Apps/Crackerbox Studio/backups` | `crackerbox-studio-backup.json` |

- The sign-in token lives only in `sessionStorage` (cleared when you close the tab) — you'll reconnect roughly once per browsing session.
- **Not synced to Drive, on purpose:** Fantasy Draft Assistant's AI API key, and Crackerbox Studio's encrypted GitHub/OpenRouter deploy tokens. Those stay local-only.

## 4. Without any setup at all

Every app also has plain **Export JSON** / **Import JSON** buttons that work immediately, no Google account or Client ID needed — a manual backup you can save anywhere (a USB drive, another cloud folder, email to yourself). That's the fallback if you'd rather skip the Google Cloud step entirely.

## Changing the folder a specific app saves to

Each app has `src/lib/backup.ts` with a `FOLDER_ID` constant. Grab a new folder's ID from its Drive URL (`drive.google.com/drive/folders/<THIS PART>`) and swap it in.
