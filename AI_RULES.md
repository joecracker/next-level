# Field Layout Tracker - Project Rules

## Stack & Versions
- **Framework**: React 19.0.1 with TypeScript 5.8.2
- **Build Tool**: Vite 6.2.3
- **Styling**: TailwindCSS 4.1.14 via @tailwindcss/vite plugin
- **UI Components**: Lucide React 0.546.0
- **Animations**: Framer Motion 12.23.24
- **Camera**: React Webcam 7.2.0
- **AI Integration**: Google Generative AI (@google/genai) 2.4.0
- **State Management**: Closure-based state in src/app.ts with localStorage persistence
- **Persistence**: 
  - Primary: localStorage (key: 'nextlevel_projects')
  - Photos: IndexedDB via ./lib/photoStore
  - Backup: Google Drive API via ./lib/backup
- **PWA**: Service worker (public/sw.js) and manifest (public/manifest.json)

## Entry Points
- **HTML**: index.html (root)
- **JSX Entry**: src/main.tsx (ReactDOM.createRoot)
- **Main App**: src/App.tsx (contains UI layout and launcher logic)
- **Application Logic**: src/app.ts (contains initNextLevel() which initializes all state, event handlers, and core functionality)

## Available Scripts
- `dev`: vite --port=3000 --host=0.0.0.0 (development server)
- `build`: vite build (production build)
- `preview`: vite preview (preview production build)
- `lint`: tsc --noEmit (TypeScript type checking)

## Architecture & Patterns
- **React**: Functional components with hooks (useState, useEffect, useRef, useCallback)
- **Styling**: TailwindCSS utility classes with some inline styles for dynamic values
- **State**: Centralized state management in initNextLevel() closure (projects, currentProjectId, tool states, canvas state, etc.)
- **Persistence**: Automatic saving to localStorage; Google Drive backup as secondary disaster recovery
- **Canvas**: Custom rendering with HTML5 Canvas for floor plan drawing
- **Modules**: Feature-specific libraries in src/lib/ (backup, googleDrive, photoBooth, photoStore, photoViewer)
- **Routing**: No client-side routing; single-page application with modal dialogs and sidebar panels

## Deployment
- **Platform**: Cloudflare Pages (static site hosting)
- **Build Command**: npm run build
- **Publish Directory**: dist
- **Server**: None (static-only deployment)
- **Environment**: No server-side code or APIs required for core functionality

## File Conventions Verified
- **Components**: .tsx extension for React components
- **Styles**: TailwindCSS classes; minimal CSS in src/index.css
- **Assets**: public/ directory for static assets (manifest, service worker)
- **Configuration**: vite.config.ts for Vite setup with plugins
- **Type Definitions**: vite-env.d.ts for Vite/client types
- **State Persistence**: localStorage key 'nextlevel_projects' for project data
- **Photo Storage**: IndexedDB via photoStore module
- **Alias**: '@' resolves to project root (configured in vite.config.ts)

## Verified Integrations
- **Google Drive**: For backup/restore (requires setup via GOOGLE_DRIVE_SETUP.md)
- **Web APIs**: 
  - localStorage for project persistence
  - IndexedDB for photo storage (via idb-keyval wrapper in photoStore)
  - Service Worker for PWA functionality
  - Web Speech API for voice notes (when available)
  - navigator.share for job sharing (when available)
  - canvas.toDataURL for exporting floor plans as images

## Important Notes
- The application is designed to work offline-first (PWA)
- All core data remains on the device; Google Drive is strictly for disaster recovery
- No external services are required for basic operation
- Build produces static assets only (no server-side rendering)