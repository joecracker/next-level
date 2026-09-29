import { driveConfigured, isDriveConnected, connectBackup, saveBackup, restoreBackup } from './lib/backup';
import {
  putPhoto, deletePhotoBlob, getDisplayURL, getPhotoBlob, downscaleImage,
  dehydrateProjects, hydrateProjects, estimateStorage, revokeURL, clearAllPhotos,
} from './lib/photoStore';
import { openPhotoBooth } from './lib/photoBooth';
import { openPhotoViewer } from './lib/photoViewer';

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

export function initNextLevel() {
  /* ════════════════════════════════════════════════════════════════
     STATE
     ════════════════════════════════════════════════════════════════ */
  const STORAGE_KEY = 'nextlevel_projects';
  const GRID = 20;
  const SNAP = 10;
  const MIN_WALL = 10;
  const HISTORY_MAX = 50;
  const PAN_BUTTON = 1;

  interface Point { x: number; y: number; }
  interface Wall { start: Point; end: Point; wallType: string; locked?: boolean; }
  interface Opening {
    id: string;
    type?: string;
    wallIdx: number;
    distFromStart: number;
    x?: number;
    y?: number;
    angle?: number;
    width: number;
    height?: number;
    locked?: boolean;
    floating?: boolean;
    flipped?: boolean;
  }
  interface Asset {
    id: string;
    type: 'cabinet' | 'plumbing' | 'electrical' | 'custom';
    category: string;
    name: string;
    code?: string;
    x: number;
    y: number;
    width: number;
    depth: number;
    height?: number;
    rotation?: number;
    icon?: string;
    label?: string;
    color?: string;
    kneeWallWidth?: number;
    glassDoorWidth?: number;
    enclosureStyle?: 'kneewall_glass' | 'full_wall' | 'frameless_glass' | 'curbless_open';
    drainType?: 'center' | 'trench_left' | 'trench_right' | 'trench_back' | 'end_left' | 'end_right';
    hasRainHead?: boolean;
    hasWallHead?: boolean;
    glassHeight?: number;
    isKneeWallGlass?: boolean;
    fontSize?: number;
  }
  interface Note { text: string; x: number; y: number; }
  interface Page {
    id: string;
    name: string;
    walls: Wall[];
    doors: Opening[];
    windows: Opening[];
    assets: Asset[];
    notes: Note[];
    history: string[];
    historyIdx: number;
  }
  interface Photo {
    id: string;
    dataUrl?: string; // transient only: set while hydrating for export/Drive, or as private-mode fallback. Bytes live in IndexedDB keyed by id.
    caption: string;
    timestamp: string;
  }
  interface CustomTakeoffItem {
    id: string;
    name: string;
    qty: number;
    unit: string;
    notes: string;
  }
  interface TakeoffAdjustments {
    sqft: number;
    trim: number;
    studs: number;
    drywall: number;
  }
  interface Project {
    id: string;
    name: string;
    customer?: string;
    phone?: string;
    email?: string;
    address?: string;
    category: string;
    scope: string;
    pages: Page[];
    ceilingH?: number;
    studSpacing?: number;
    waste?: number;
    takeoffAdj?: TakeoffAdjustments;
    customItems?: CustomTakeoffItem[];
    _notesTa?: string;
    photos?: Photo[];
    canvas?: any;
  }

  let projects: Project[] = [];
  let currentProjectId: string | null = null;
  let currentPageIdx = 0;
  let currentView = 'before';
  let showDimensions = true;
  let smartSnapping = true;
  let currentCategory = 'Kitchen';
  let currentScope = 'Full Build';
  let currentWallType = 'existing_to_remain';

  // Canvas / view state
  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D;
  let canvasW = 0, canvasH = 0;
  let dpr = 1;
  let panX = 0, panY = 0, zoom = 1;
  let isPanning = false, panStartX = 0, panStartY = 0, panStartPx = 0, panStartPy = 0;

  // Tool state
  let tool = 'select'; // select | wall | door | window | delete
  let wallStart: Point | null = null; // {x, y} in canvas coords
  let mousePos: Point | null = null;  // current mouse in canvas coords

  // Wall edit
  let selectedWallIdx = -1;
  let selectedWallIndices: number[] = [];
  let selectedAssetIds: string[] = [];
  let rectSelectStart: Point | null = null;
  let rectSelectCurrent: Point | null = null;
  let isDraggingSelection = false;
  let selectionDragStart: Point | null = null;
  let dragHandle = -1; // -1 none, 0=start, 1=end
  let resizingAssetCorner = -1;     // -1 none, else 0-3 (which corner is grabbed)
  let resizeAnchorWorld: Point | null = null; // opposite corner, held fixed
  let draggingOpening: { type: 'door' | 'window'; id: string } | null = null;
  let openingMoved = false;
  let draggingNoteIdx = -1;

  // Copy/paste
  let clipboardWall: Wall | null = null;

  // Opening edit state
  let selectedOpening: { type: 'door' | 'window'; id: string } | null = null;

  // Placement preview (ghost on hover during door/window placement)
  interface PlacementPreview {
    wallIdx: number;
    distFromStart: number;
    x: number;
    y: number;
    angle: number;
    width: number;
  }
  let placementPreview: PlacementPreview | null = null;

  // Door placement config
  let doorConfig = { width: 32, type: 'left_swing', dist: 4 };
  // Window placement config
  let windowConfig = { width: 36, height: 36, dist: 4 };

  // Pending wall type (crosshair flow)
  let pendingWallType: string | null = null;

  // Visual guidelines & alignment state
  interface Guideline {
    x1: number; y1: number;
    x2: number; y2: number;
    color?: string;
  }
  let activeGuidelines: Guideline[] = [];

  function getWallSnapAndGuides(rawPos: Point, start: Point | null, walls: Wall[]): { snappedPos: Point; guides: Guideline[] } {
    let sx = snap(rawPos.x);
    let sy = snap(rawPos.y);
    const guides: Guideline[] = [];
    if (!smartSnapping) {
      return { snappedPos: { x: sx, y: sy }, guides };
    }
    const threshold = 18 / zoom;

    if (!start) {
      for (const w of walls) {
        for (const pt of [w.start, w.end]) {
          if (Math.abs(rawPos.x - pt.x) < threshold) {
            sx = pt.x;
            guides.push({ x1: pt.x, y1: pt.y - 2000, x2: pt.x, y2: pt.y + 2000, color: 'rgba(37, 99, 235, 0.6)' });
          }
          if (Math.abs(rawPos.y - pt.y) < threshold) {
            sy = pt.y;
            guides.push({ x1: pt.x - 2000, y1: pt.y, x2: pt.x + 2000, y2: pt.y, color: 'rgba(37, 99, 235, 0.6)' });
          }
        }
      }
      return { snappedPos: { x: sx, y: sy }, guides };
    }

    let snappedX = sx;
    let snappedY = sy;
    let xSnapped = false;
    let ySnapped = false;

    // 1. Corner alignments with existing wall endpoints
    for (const w of walls) {
      for (const pt of [w.start, w.end]) {
        if (!xSnapped && Math.abs(rawPos.x - pt.x) < threshold) {
          snappedX = pt.x;
          xSnapped = true;
          guides.push({
            x1: pt.x, y1: Math.min(start.y, rawPos.y) - 600,
            x2: pt.x, y2: Math.max(start.y, rawPos.y) + 600,
            color: 'rgba(37, 99, 235, 0.85)'
          });
        }
        if (!ySnapped && Math.abs(rawPos.y - pt.y) < threshold) {
          snappedY = pt.y;
          ySnapped = true;
          guides.push({
            x1: Math.min(start.x, rawPos.x) - 600, y1: pt.y,
            x2: Math.max(start.x, rawPos.x) + 600, y2: pt.y,
            color: 'rgba(37, 99, 235, 0.85)'
          });
        }
      }
    }

    // 2. Parallel, perpendicular, and orthogonal angle snaps
    const dx = rawPos.x - start.x;
    const dy = rawPos.y - start.y;
    const angle = Math.atan2(dy, dx);
    const distFromStart = Math.hypot(dx, dy);
    const deg = (angle * 180) / Math.PI;

    const snapAngles = [0, 90, 180, 270, -90, -180, 360, -360];
    walls.forEach(w => {
      const wAngle = wallAngle(w) * 180 / Math.PI;
      snapAngles.push(wAngle, wAngle + 90, wAngle - 90, wAngle + 180, wAngle - 180);
    });

    for (const sa of snapAngles) {
      const diff = Math.abs(deg - sa);
      if (diff < 5.0) {
        const rad = (sa * Math.PI) / 180;
        if (!xSnapped) snappedX = start.x + Math.cos(rad) * distFromStart;
        if (!ySnapped) snappedY = start.y + Math.sin(rad) * distFromStart;
        guides.push({
          x1: start.x, y1: start.y,
          x2: start.x + Math.cos(rad) * 4000, y2: start.y + Math.sin(rad) * 4000,
          color: 'rgba(234, 179, 8, 0.9)'
        });
        break;
      }
    }

    if (!xSnapped && Math.abs(rawPos.x - start.x) < 16) {
      snappedX = start.x;
      guides.push({ x1: start.x, y1: start.y - 2000, x2: start.x, y2: start.y + 2000, color: 'rgba(37, 99, 235, 0.6)' });
    }
    if (!ySnapped && Math.abs(rawPos.y - start.y) < 16) {
      snappedY = start.y;
      guides.push({ x1: start.x - 2000, y1: start.y, x2: start.x + 2000, y2: start.y, color: 'rgba(37, 99, 235, 0.6)' });
    }

    return { snappedPos: { x: snappedX, y: snappedY }, guides };
  }

  // Asset catalog state
  interface AssetPreset {
    type: 'cabinet' | 'plumbing' | 'electrical' | 'custom';
    category: string;
    name: string;
    code: string;
    width: number;
    depth: number;
    height?: number;
    desc?: string;
    kneeWallWidth?: number;
    glassDoorWidth?: number;
    enclosureStyle?: 'kneewall_glass' | 'full_wall' | 'frameless_glass' | 'curbless_open';
    drainType?: 'center' | 'trench_left' | 'trench_right' | 'trench_back' | 'end_left' | 'end_right';
    hasRainHead?: boolean;
    hasWallHead?: boolean;
  }

  let activeAssetCat = 'cabinet';
  let activePreset: AssetPreset | null = null;
  let selectedAssetId: string | null = null;
  let editingAssetId: string | null = null;
  let placingAssetRotation = 0;

  const ASSET_CATALOG: AssetPreset[] = [
    // Base Cabinets
    { type: 'cabinet', category: 'Base Cabinets', code: 'B09', name: 'Base 9"', width: 9, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: 'B12', name: 'Base 12"', width: 12, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: 'B15', name: 'Base 15"', width: 15, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: 'B18', name: 'Base 18"', width: 18, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: 'B21', name: 'Base 21"', width: 21, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: 'B24', name: 'Base 24"', width: 24, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: 'B27', name: 'Base 27"', width: 27, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: 'B30', name: 'Base 30"', width: 30, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: 'B33', name: 'Base 33"', width: 33, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: 'B36', name: 'Base 36"', width: 36, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: 'SB36', name: 'Sink Base 36"', width: 36, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: 'B42', name: 'Base 42"', width: 42, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: 'B48', name: 'Base 48"', width: 48, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: 'LS36', name: 'Corner Lazy Susan 36x36', width: 36, depth: 36, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: 'ISL60', name: 'Kitchen Island 60x36', width: 60, depth: 36, height: 34.5 },

    // Upper Cabinets
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W0930', name: 'Upper Wall 9"', width: 9, depth: 12, height: 30 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W1230', name: 'Upper Wall 12"', width: 12, depth: 12, height: 30 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W1830', name: 'Upper Wall 18"', width: 18, depth: 12, height: 30 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W2430', name: 'Upper Wall 24"', width: 24, depth: 12, height: 30 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3030', name: 'Upper Wall 30"', width: 30, depth: 12, height: 30 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3630', name: 'Upper Wall 36"', width: 36, depth: 12, height: 30 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W2424', name: 'Corner Upper 24x24', width: 24, depth: 24, height: 30 },

    // Tall & Utility Cabinets
    { type: 'cabinet', category: 'Tall/Utility', code: 'UT1884', name: 'Utility / Pantry 18" (84"H)', width: 18, depth: 24, height: 84 },
    { type: 'cabinet', category: 'Tall/Utility', code: 'UT2484', name: 'Utility / Pantry 24" (84"H)', width: 24, depth: 24, height: 84 },
    { type: 'cabinet', category: 'Tall/Utility', code: 'UT3084', name: 'Utility / Pantry 30" (84"H)', width: 30, depth: 24, height: 84 },
    { type: 'cabinet', category: 'Tall/Utility', code: 'UT3696', name: 'Utility / Pantry 36" (96"H)', width: 36, depth: 24, height: 96 },


    // Trim & Fillers
    { type: 'cabinet', category: 'Trim & Fillers', code: 'FIL3', name: 'Base Filler 3"', width: 3, depth: 0.75, height: 34.5, desc: '3-inch base filler, editable height/width' },
    { type: 'cabinet', category: 'Trim & Fillers', code: 'FIL6', name: 'Base Filler 6"', width: 6, depth: 0.75, height: 34.5, desc: '6-inch base filler, editable height/width' },
    { type: 'cabinet', category: 'Trim & Fillers', code: 'FIL3U30', name: 'Upper Filler 3" (30"H)', width: 3, depth: 0.75, height: 30, desc: '3-inch upper filler' },
    { type: 'cabinet', category: 'Trim & Fillers', code: 'FIL6U30', name: 'Upper Filler 6" (30"H)', width: 6, depth: 0.75, height: 30, desc: '6-inch upper filler' },
    { type: 'cabinet', category: 'Trim & Fillers', code: 'FIL6U36', name: 'Upper Filler 6" (36"H)', width: 6, depth: 0.75, height: 36, desc: '6-inch upper filler' },
    { type: 'cabinet', category: 'Trim & Fillers', code: 'FIL6U42', name: 'Upper Filler 6" (42"H)', width: 6, depth: 0.75, height: 42, desc: '6-inch upper filler' },
    { type: 'cabinet', category: 'Trim & Fillers', code: 'FIL3U36', name: 'Upper Filler 3" (36"H)', width: 3, depth: 0.75, height: 36, desc: '3-inch upper filler' },
    { type: 'cabinet', category: 'Trim & Fillers', code: 'FIL3U42', name: 'Upper Filler 3" (42"H)', width: 3, depth: 0.75, height: 42, desc: '3-inch upper filler' },
    { type: 'cabinet', category: 'Trim & Fillers', code: 'FIL3T84', name: 'Tall Filler 3" (84"H)', width: 3, depth: 0.75, height: 84, desc: '3-inch tall filler for pantry/oven' },
    { type: 'cabinet', category: 'Trim & Fillers', code: 'FIL3T96', name: 'Tall Filler 3" (96"H)', width: 3, depth: 0.75, height: 96, desc: '3-inch tall filler for pantry/oven' },
    { type: 'cabinet', category: 'Trim & Fillers', code: 'FIL6T84', name: 'Tall Filler 6" (84"H)', width: 6, depth: 0.75, height: 84, desc: '6-inch tall filler for pantry/oven' },
    { type: 'cabinet', category: 'Trim & Fillers', code: 'FIL6T96', name: 'Tall Filler 6" (96"H)', width: 6, depth: 0.75, height: 96, desc: '6-inch tall filler for pantry/oven' },
    { type: 'cabinet', category: 'Trim & Fillers', code: 'TOEKICK', name: 'Toe Kick (96")', width: 96, depth: 0.25, height: 4.5, desc: 'Standard 8ft toe kick' },
    { type: 'cabinet', category: 'Trim & Fillers', code: 'SCRIBE', name: 'Scribe Molding (96")', width: 96, depth: 0.25, height: 0.75, desc: 'Standard 8ft scribe molding' },
    { type: 'cabinet', category: 'Trim & Fillers', code: 'BASESHOE', name: 'Base Shoe (96")', width: 96, depth: 0.5, height: 0.75, desc: 'Standard 8ft base shoe' },

    // Vanities & Bathroom Cabinets
    { type: 'cabinet', category: 'Vanities', code: 'V24', name: 'Vanity 24" Single', width: 24, depth: 21, height: 31 },
    { type: 'cabinet', category: 'Vanities', code: 'V30', name: 'Vanity 30" Single', width: 30, depth: 21, height: 31 },
    { type: 'cabinet', category: 'Vanities', code: 'V36', name: 'Vanity 36" Single', width: 36, depth: 21, height: 31 },
    { type: 'cabinet', category: 'Vanities', code: 'V48', name: 'Vanity 48" Single/Dbl', width: 48, depth: 21, height: 31 },
    { type: 'cabinet', category: 'Vanities', code: 'V60', name: 'Vanity 60" Double Sink', width: 60, depth: 21, height: 31 },
    { type: 'cabinet', category: 'Vanities', code: 'LT1884', name: 'Linen Tower 18" (84"H)', width: 18, depth: 21, height: 84 },

    // Plumbing Fixtures
    { type: 'plumbing', category: 'Shower & Bath', code: 'SH6036', name: 'Walk-In Shower 60x36', width: 60, depth: 36, height: 80, kneeWallWidth: 0, glassDoorWidth: 30, drainType: 'center', hasWallHead: true },
    { type: 'plumbing', category: 'Shower & Bath', code: 'SH4836', name: 'Walk-In Shower 48x36', width: 48, depth: 36, height: 80, kneeWallWidth: 0, glassDoorWidth: 24, drainType: 'center', hasWallHead: true },
    { type: 'plumbing', category: 'Shower & Bath', code: 'SH7242', name: 'Walk-In Shower 72x42', width: 72, depth: 42, height: 80, kneeWallWidth: 36, glassDoorWidth: 30, drainType: 'center', hasWallHead: true },
    { type: 'plumbing', category: 'Shower & Bath', code: 'SH7248', name: 'Walk-In Shower 72x48', width: 72, depth: 48, height: 80, kneeWallWidth: 40, glassDoorWidth: 30, drainType: 'center', hasWallHead: true },
    { type: 'plumbing', category: 'Shower & Bath', code: 'KWG', name: 'Knee Wall w/ Glass Panel', width: 70, depth: 36, height: 80, kneeWallWidth: 40, glassDoorWidth: 30, enclosureStyle: 'kneewall_glass' },
    { type: 'plumbing', category: 'Shower & Bath', code: 'KWFULL', name: 'Full Height Enclosure Wall', width: 70, depth: 36, height: 96, kneeWallWidth: 40, glassDoorWidth: 30, enclosureStyle: 'full_wall' },
    { type: 'plumbing', category: 'Shower & Bath', code: 'GD30', name: 'Glass Shower Door 30"', width: 30, depth: 4, height: 76 },
    { type: 'plumbing', category: 'Shower & Bath', code: 'TUB60', name: 'Standard Tub 60x30', width: 60, depth: 30, height: 16 },
    { type: 'plumbing', category: 'Shower & Bath', code: 'STUB66', name: 'Soaker Tub 66x32', width: 66, depth: 32, height: 24 },
    { type: 'plumbing', category: 'Shower & Bath', code: 'TOI', name: 'Toilet', width: 18, depth: 28, height: 30 },
    { type: 'plumbing', category: 'Sinks & Kitchen', code: 'KSINK', name: 'Kitchen Sink 33x22', width: 33, depth: 22, height: 10 },
    { type: 'plumbing', category: 'Sinks & Kitchen', code: 'VSINK', name: 'Vanity Oval Sink', width: 20, depth: 16, height: 8 },
    { type: 'plumbing', category: 'Faucets & Valves', code: 'TSFAC', name: 'Tub & Shower Faucet w/ Head', width: 6, depth: 4, height: 48, desc: 'Tub and shower diverter valve with shower head' },
    { type: 'plumbing', category: 'Faucets & Valves', code: 'SHFAC', name: 'Shower Faucet w/ Head', width: 6, depth: 4, height: 48, desc: 'Shower pressure-balance valve with shower head' },
    { type: 'plumbing', category: 'Faucets & Valves', code: 'LAVFAC', name: 'Lavatory Faucet', width: 6, depth: 6, height: 12, desc: 'Bathroom sink faucet' },
    { type: 'plumbing', category: 'Faucets & Valves', code: 'KFAC', name: 'Kitchen Sink Faucet', width: 8, depth: 8, height: 16, desc: 'Kitchen pull-down faucet' },
    { type: 'plumbing', category: 'Utility & Rough-In', code: 'LTUB', name: 'Laundry Tub 24x24', width: 24, depth: 24, height: 34, desc: 'Utility laundry sink' },
    { type: 'plumbing', category: 'Utility & Rough-In', code: 'WBOX', name: 'Washer Supply & Drain Box', width: 8, depth: 4, height: 32, desc: 'Washing machine water supply and drain rough-in box' },
    { type: 'plumbing', category: 'Utility & Rough-In', code: 'HOSEBIB', name: 'Outside Hose Bib / Sillcock', width: 6, depth: 6, height: 18, desc: 'Exterior frost-free wall hydrant' },
    { type: 'plumbing', category: 'Utility & Rough-In', code: 'ICEMAKER', name: 'Refrigerator Ice Maker Supply', width: 6, depth: 4, height: 24, desc: 'Ice maker water supply valve box' },

    // Appliances
    { type: 'custom', category: 'Appliances', code: 'REF', name: 'Refrigerator 36"', width: 36, depth: 30, height: 70, desc: 'Standard freestanding or counter-depth refrigerator (editable)' },
    { type: 'custom', category: 'Appliances', code: 'RGE30', name: '30" Electric/Gas Range', width: 30, depth: 30, height: 36, desc: '30-inch freestanding range with oven' },
    { type: 'custom', category: 'Appliances', code: 'COOK30', name: '30" Cooktop', width: 30, depth: 21, height: 4, desc: 'Countertop drop-in electric/gas cooktop' },
    { type: 'custom', category: 'Appliances', code: 'BOVEN', name: 'Built-In Wall Oven 30"', width: 30, depth: 24, height: 30, desc: 'Built-in single wall oven for tall pantry units' },
    { type: 'custom', category: 'Appliances', code: 'OWMIC', name: 'Over-the-Range Microwave', width: 30, depth: 15, height: 16, desc: 'Space-saver microwave / hood combo' },
    { type: 'custom', category: 'Appliances', code: 'RHOOD', name: 'Range Hood 30"', width: 30, depth: 20, height: 10, desc: '30-inch range ventilation hood' },
    { type: 'custom', category: 'Appliances', code: 'DISHW', name: 'Built-in Dishwasher 24"', width: 24, depth: 24, height: 34.5, desc: 'Standard 24-inch under-counter dishwasher' },

    // Electrical Fixtures
    { type: 'electrical', category: 'Outlets', code: 'OUT', name: 'Duplex Outlet 120V', width: 12, depth: 12, height: 4, desc: 'Standard 120V 15A duplex receptacle' },
    { type: 'electrical', category: 'Outlets', code: 'GFCI', name: 'GFCI Safety Outlet', width: 12, depth: 12, height: 4, desc: 'Ground Fault Circuit Interrupter receptacle' },
    { type: 'electrical', category: 'Outlets', code: 'RANGE240', name: 'Dedicated Range 240V', width: 14, depth: 14, height: 4, desc: '240V 50A outlet for electric range' },
    { type: 'electrical', category: 'Outlets', code: 'DRYER240', name: 'Dedicated Dryer 240V', width: 14, depth: 14, height: 4, desc: '240V 30A outlet for electric dryer' },
    { type: 'electrical', category: 'Outlets', code: 'USB', name: 'USB Combo Outlet', width: 12, depth: 12, height: 4, desc: '120V duplex outlet with integrated USB charging ports' },
    { type: 'electrical', category: 'Outlets', code: 'FLOOR', name: 'Floor Outlet', width: 14, depth: 14, height: 4, desc: 'Recessed floor electrical box' },
    { type: 'electrical', category: 'Outlets', code: 'WP', name: 'Weatherproof Outlet', width: 12, depth: 12, height: 4, desc: 'GFCI outlet with weatherproof in-use cover' },
    { type: 'electrical', category: 'Switches', code: 'SW1', name: 'Single Pole Switch', width: 10, depth: 10, height: 4, desc: 'Standard single-pole light switch' },
    { type: 'electrical', category: 'Switches', code: 'SW3', name: '3-Way Switch', width: 10, depth: 10, height: 4, desc: 'Three-way switch for multi-location control' },
    { type: 'electrical', category: 'Switches', code: 'SW4', name: '4-Way Switch', width: 10, depth: 10, height: 4, desc: 'Multi-location lighting control switch' },
    { type: 'electrical', category: 'Switches', code: 'DIM', name: 'Dimmer Switch', width: 10, depth: 10, height: 4, desc: 'Slide or rotary dimmer switch' },
    { type: 'electrical', category: 'Switches', code: 'DISP', name: 'Garbage Disposal Switch', width: 10, depth: 10, height: 4, desc: 'Dedicated switch for kitchen sink disposal' },
    { type: 'electrical', category: 'Lighting & Fans', code: 'CAN', name: 'Recessed LED Can Light', width: 14, depth: 14, height: 6, desc: 'Recessed ceiling downlight fixture' },
    { type: 'electrical', category: 'Lighting & Fans', code: 'FAN', name: 'Ceiling Fan / Light', width: 36, depth: 36, height: 12, desc: 'Ceiling paddle fan with integrated light kit' },
    { type: 'electrical', category: 'Lighting & Fans', code: 'VBAR', name: 'Vanity Light Bar 30"', width: 30, depth: 6, height: 8, desc: 'Bathroom vanity lighting strip' },
    { type: 'electrical', category: 'Lighting & Fans', code: 'FANEX', name: 'Exhaust Fan / Heater', width: 16, depth: 16, height: 8, desc: 'Bathroom ventilation exhaust fan' },
    { type: 'electrical', category: 'Lighting & Fans', code: 'PEND', name: 'Pendant Light', width: 14, depth: 14, height: 18, desc: 'Hanging decorative pendant fixture' },
    { type: 'electrical', category: 'Lighting & Fans', code: 'UCAB', name: 'Under-Cabinet Light', width: 24, depth: 4, height: 2, desc: 'Task lighting strip for under cabinets' },
    { type: 'electrical', category: 'Lighting & Fans', code: 'SCONCE', name: 'Wall Sconce', width: 8, depth: 8, height: 12, desc: 'Wall-mounted accent light fixture' },
    { type: 'electrical', category: 'Lighting & Fans', code: 'SMOKE', name: 'Smoke/CO Detector', width: 6, depth: 6, height: 2, desc: 'Combination smoke and carbon monoxide detector' },
    { type: 'electrical', category: 'Appliance Circuits', code: 'MWAVE', name: 'Space-Saver Microwave', width: 24, depth: 15, height: 16, desc: 'Dedicated circuit connection for over-range microwave' },
    { type: 'electrical', category: 'Appliance Circuits', code: 'DISHW', name: 'Dishwasher Junction', width: 16, depth: 16, height: 4, desc: 'Dedicated under-counter connection for dishwasher' },
    { type: 'electrical', category: 'Appliance Circuits', code: 'HOOD', name: 'Range Hood', width: 30, depth: 12, height: 10, desc: 'Dedicated electrical connection for range ventilation hood' },
    { type: 'electrical', category: 'Panels & Service', code: 'PANEL', name: 'Main Breaker Panel', width: 24, depth: 6, height: 36, desc: 'Main electrical service panel 200A' },
    { type: 'electrical', category: 'Panels & Service', code: 'SUBPANEL', name: 'Sub-Panel', width: 16, depth: 6, height: 24, desc: 'Secondary sub-panel distribution center' },
    { type: 'electrical', category: 'Exterior', code: 'EXTOUT', name: 'Exterior Outlet', width: 12, depth: 12, height: 4, desc: 'Outdoor rated GFCI duplex receptacle' },
    { type: 'electrical', category: 'Exterior', code: 'FLOOD', name: 'Flood/Security Light', width: 16, depth: 8, height: 10, desc: 'Outdoor motion-activated security floodlight' },
    { type: 'electrical', category: 'Exterior', code: 'POST', name: 'Deck/Post Light', width: 8, depth: 8, height: 16, desc: 'Exterior pathway or post cap light fixture' },
    { type: 'electrical', category: 'Junction', code: 'JBOX', name: 'Junction Box', width: 12, depth: 12, height: 4, desc: 'Electrical wire connection box' },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W1212', name: 'Wall Single Door 12x12', width: 12, depth: 12, height: 12 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W1512', name: 'Wall Single Door 15x12', width: 15, depth: 12, height: 12 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W1812', name: 'Wall Single Door 18x12', width: 18, depth: 12, height: 12 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W2112B', name: 'Wall Double Door 21x12', width: 21, depth: 12, height: 12 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W2412B', name: 'Wall Double Door 24x12', width: 24, depth: 12, height: 12 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W2712B', name: 'Wall Double Door 27x12', width: 27, depth: 12, height: 12 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3012B', name: 'Wall Double Door 30x12', width: 30, depth: 12, height: 12 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3312B', name: 'Wall Double Door 33x12', width: 33, depth: 12, height: 12 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3612B', name: 'Wall Double Door 36x12', width: 36, depth: 12, height: 12 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3912', name: 'Wall Cabinet 39x12', width: 39, depth: 12, height: 12 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W1215', name: 'Wall Single Door 12x15', width: 12, depth: 12, height: 15 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W1515', name: 'Wall Single Door 15x15', width: 15, depth: 12, height: 15 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W1815', name: 'Wall Single Door 18x15', width: 18, depth: 12, height: 15 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W2115B', name: 'Wall Double Door 21x15', width: 21, depth: 12, height: 15 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W2415B', name: 'Wall Double Door 24x15', width: 24, depth: 12, height: 15 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W2715B', name: 'Wall Double Door 27x15', width: 27, depth: 12, height: 15 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3015B', name: 'Wall Double Door 30x15', width: 30, depth: 12, height: 15 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3315B', name: 'Wall Double Door 33x15', width: 33, depth: 12, height: 15 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3615B', name: 'Wall Double Door 36x15', width: 36, depth: 12, height: 15 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3915', name: 'Wall Cabinet 39x15', width: 39, depth: 12, height: 15 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W1218', name: 'Wall Single Door 12x18', width: 12, depth: 12, height: 18 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W1518', name: 'Wall Single Door 15x18', width: 15, depth: 12, height: 18 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W1818', name: 'Wall Single Door 18x18', width: 18, depth: 12, height: 18 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W2118', name: 'Wall Single Door 21x18', width: 21, depth: 12, height: 18 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W2418B', name: 'Wall Double Door 24x18', width: 24, depth: 12, height: 18 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W2718B', name: 'Wall Double Door 27x18', width: 27, depth: 12, height: 18 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3018B', name: 'Wall Double Door 30x18', width: 30, depth: 12, height: 18 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3318B', name: 'Wall Double Door 33x18', width: 33, depth: 12, height: 18 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3618B', name: 'Wall Double Door 36x18', width: 36, depth: 12, height: 18 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3918', name: 'Wall Cabinet 39x18', width: 39, depth: 12, height: 18 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W4218', name: 'Wall Cabinet 42x18', width: 42, depth: 12, height: 18 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W1221', name: 'Wall Single Door 12x21', width: 12, depth: 12, height: 21 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W1521', name: 'Wall Single Door 15x21', width: 15, depth: 12, height: 21 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W1821', name: 'Wall Single Door 18x21', width: 18, depth: 12, height: 21 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W2121', name: 'Wall Single Door 21x21', width: 21, depth: 12, height: 21 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W2421B', name: 'Wall Double Door 24x21', width: 24, depth: 12, height: 21 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W2721B', name: 'Wall Double Door 27x21', width: 27, depth: 12, height: 21 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3021B', name: 'Wall Double Door 30x21', width: 30, depth: 12, height: 21 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3321B', name: 'Wall Double Door 33x21', width: 33, depth: 12, height: 21 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3621B', name: 'Wall Double Door 36x21', width: 36, depth: 12, height: 21 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3921', name: 'Wall Cabinet 39x21', width: 39, depth: 12, height: 21 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W1224', name: 'Wall Single Door 12x24', width: 12, depth: 12, height: 24 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W1524', name: 'Wall Single Door 15x24', width: 15, depth: 12, height: 24 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W1824', name: 'Wall Single Door 18x24', width: 18, depth: 12, height: 24 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W2124', name: 'Wall Single Door 21x24', width: 21, depth: 12, height: 24 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W2424', name: 'Wall Single Door 24x24', width: 24, depth: 12, height: 24 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W2724B', name: 'Wall Double Door 27x24', width: 27, depth: 12, height: 24 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3024B', name: 'Wall Double Door 30x24', width: 30, depth: 12, height: 24 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3324B', name: 'Wall Double Door 33x24', width: 33, depth: 12, height: 24 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3624B', name: 'Wall Double Door 36x24', width: 36, depth: 12, height: 24 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3924', name: 'Wall Cabinet 39x24', width: 39, depth: 12, height: 24 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W4224', name: 'Wall Cabinet 42x24', width: 42, depth: 12, height: 24 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W4524', name: 'Wall Cabinet 45x24', width: 45, depth: 12, height: 24 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W4824', name: 'Wall Cabinet 48x24', width: 48, depth: 12, height: 24 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W1227', name: 'Wall Single Door 12x27', width: 12, depth: 12, height: 27 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W1527', name: 'Wall Single Door 15x27', width: 15, depth: 12, height: 27 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W1827', name: 'Wall Single Door 18x27', width: 18, depth: 12, height: 27 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W2127', name: 'Wall Single Door 21x27', width: 21, depth: 12, height: 27 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W2427', name: 'Wall Single Door 24x27', width: 24, depth: 12, height: 27 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W2727B', name: 'Wall Double Door 27x27', width: 27, depth: 12, height: 27 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3027B', name: 'Wall Double Door 30x27', width: 30, depth: 12, height: 27 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3327B', name: 'Wall Double Door 33x27', width: 33, depth: 12, height: 27 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3627B', name: 'Wall Double Door 36x27', width: 36, depth: 12, height: 27 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3927', name: 'Wall Cabinet 39x27', width: 39, depth: 12, height: 27 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W930', name: 'Wall Single Door 9x30', width: 9, depth: 12, height: 30 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W1230', name: 'Wall Single Door 12x30', width: 12, depth: 12, height: 30 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W1530', name: 'Wall Single Door 15x30', width: 15, depth: 12, height: 30 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W1830', name: 'Wall Single Door 18x30', width: 18, depth: 12, height: 30 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W2130', name: 'Wall Single Door 21x30', width: 21, depth: 12, height: 30 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W2430', name: 'Wall Single Door 24x30', width: 24, depth: 12, height: 30 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W2430B', name: 'Wall Double Door 24x30', width: 24, depth: 12, height: 30 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W2730B', name: 'Wall Double Door 27x30', width: 27, depth: 12, height: 30 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3030B', name: 'Wall Double Door 30x30', width: 30, depth: 12, height: 30 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3330B', name: 'Wall Double Door 33x30', width: 33, depth: 12, height: 30 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3630B', name: 'Wall Double Door 36x30', width: 36, depth: 12, height: 30 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3930', name: 'Wall Cabinet 39x30', width: 39, depth: 12, height: 30 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W4230', name: 'Wall Cabinet 42x30', width: 42, depth: 12, height: 30 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W4530', name: 'Wall Cabinet 45x30', width: 45, depth: 12, height: 30 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W4830', name: 'Wall Cabinet 48x30', width: 48, depth: 12, height: 30 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W933', name: 'Wall Single Door 9x33', width: 9, depth: 12, height: 33 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W1233', name: 'Wall Single Door 12x33', width: 12, depth: 12, height: 33 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W1533', name: 'Wall Single Door 15x33', width: 15, depth: 12, height: 33 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W1833', name: 'Wall Single Door 18x33', width: 18, depth: 12, height: 33 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W2133', name: 'Wall Single Door 21x33', width: 21, depth: 12, height: 33 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W2433', name: 'Wall Single Door 24x33', width: 24, depth: 12, height: 33 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W2433B', name: 'Wall Double Door 24x33', width: 24, depth: 12, height: 33 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W2733B', name: 'Wall Double Door 27x33', width: 27, depth: 12, height: 33 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3033B', name: 'Wall Double Door 30x33', width: 30, depth: 12, height: 33 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3333B', name: 'Wall Double Door 33x33', width: 33, depth: 12, height: 33 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3633B', name: 'Wall Double Door 36x33', width: 36, depth: 12, height: 33 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3933', name: 'Wall Cabinet 39x33', width: 39, depth: 12, height: 33 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W4233', name: 'Wall Cabinet 42x33', width: 42, depth: 12, height: 33 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W4533', name: 'Wall Cabinet 45x33', width: 45, depth: 12, height: 33 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W4833', name: 'Wall Cabinet 48x33', width: 48, depth: 12, height: 33 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W936', name: 'Wall Single Door 9x36', width: 9, depth: 12, height: 36 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W1236', name: 'Wall Single Door 12x36', width: 12, depth: 12, height: 36 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W1536', name: 'Wall Single Door 15x36', width: 15, depth: 12, height: 36 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W1836', name: 'Wall Single Door 18x36', width: 18, depth: 12, height: 36 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W2136', name: 'Wall Single Door 21x36', width: 21, depth: 12, height: 36 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W2436', name: 'Wall Single Door 24x36', width: 24, depth: 12, height: 36 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W2436B', name: 'Wall Double Door 24x36', width: 24, depth: 12, height: 36 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W2736B', name: 'Wall Double Door 27x36', width: 27, depth: 12, height: 36 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3036B', name: 'Wall Double Door 30x36', width: 30, depth: 12, height: 36 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3336B', name: 'Wall Double Door 33x36', width: 33, depth: 12, height: 36 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3636B', name: 'Wall Double Door 36x36', width: 36, depth: 12, height: 36 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3936', name: 'Wall Cabinet 39x36', width: 39, depth: 12, height: 36 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W4236', name: 'Wall Cabinet 42x36', width: 42, depth: 12, height: 36 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W4536', name: 'Wall Cabinet 45x36', width: 45, depth: 12, height: 36 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W4836', name: 'Wall Cabinet 48x36', width: 48, depth: 12, height: 36 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W939', name: 'Wall Single Door 9x39', width: 9, depth: 12, height: 39 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W1239', name: 'Wall Single Door 12x39', width: 12, depth: 12, height: 39 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W1539', name: 'Wall Single Door 15x39', width: 15, depth: 12, height: 39 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W1839', name: 'Wall Single Door 18x39', width: 18, depth: 12, height: 39 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W2139', name: 'Wall Single Door 21x39', width: 21, depth: 12, height: 39 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W2439', name: 'Wall Single Door 24x39', width: 24, depth: 12, height: 39 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W2439B', name: 'Wall Double Door 24x39', width: 24, depth: 12, height: 39 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W2739B', name: 'Wall Double Door 27x39', width: 27, depth: 12, height: 39 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3039B', name: 'Wall Double Door 30x39', width: 30, depth: 12, height: 39 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3339B', name: 'Wall Double Door 33x39', width: 33, depth: 12, height: 39 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3639B', name: 'Wall Double Door 36x39', width: 36, depth: 12, height: 39 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3939', name: 'Wall Cabinet 39x39', width: 39, depth: 12, height: 39 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W4239', name: 'Wall Cabinet 42x39', width: 42, depth: 12, height: 39 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W4539', name: 'Wall Cabinet 45x39', width: 45, depth: 12, height: 39 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W4839', name: 'Wall Cabinet 48x39', width: 48, depth: 12, height: 39 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W942', name: 'Wall Single Door 9x42', width: 9, depth: 12, height: 42 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W1242', name: 'Wall Single Door 12x42', width: 12, depth: 12, height: 42 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W1542', name: 'Wall Single Door 15x42', width: 15, depth: 12, height: 42 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W1842', name: 'Wall Single Door 18x42', width: 18, depth: 12, height: 42 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W2142', name: 'Wall Single Door 21x42', width: 21, depth: 12, height: 42 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W2442', name: 'Wall Single Door 24x42', width: 24, depth: 12, height: 42 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W2442B', name: 'Wall Double Door 24x42', width: 24, depth: 12, height: 42 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W2742B', name: 'Wall Double Door 27x42', width: 27, depth: 12, height: 42 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3042B', name: 'Wall Double Door 30x42', width: 30, depth: 12, height: 42 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3342B', name: 'Wall Double Door 33x42', width: 33, depth: 12, height: 42 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3642B', name: 'Wall Double Door 36x42', width: 36, depth: 12, height: 42 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W3942', name: 'Wall Cabinet 39x42', width: 39, depth: 12, height: 42 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W4242', name: 'Wall Cabinet 42x42', width: 42, depth: 12, height: 42 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W4542', name: 'Wall Cabinet 45x42', width: 45, depth: 12, height: 42 },
    { type: 'cabinet', category: 'Upper Cabinets', code: 'W4842', name: 'Wall Cabinet 48x42', width: 48, depth: 12, height: 42 },
    { type: 'cabinet', category: 'Base Cabinets', code: 'B12', name: 'Base 12"', width: 12, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: 'B15', name: 'Base 15"', width: 15, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: 'B18', name: 'Base 18"', width: 18, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: 'B21', name: 'Base 21"', width: 21, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: 'B24', name: 'Base 24"', width: 24, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: 'B24B', name: 'Base Double Door 24"', width: 24, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: 'B27B', name: 'Base Double Door 27"', width: 27, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: 'B30B', name: 'Base Double Door 30"', width: 30, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: 'B33B', name: 'Base Double Door 33"', width: 33, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: 'B36B', name: 'Base Double Door 36"', width: 36, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: 'B39', name: 'Base Double Door 39"', width: 39, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: 'B42', name: 'Base Double Door 42"', width: 42, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: 'B45', name: 'Base Double Door 45"', width: 45, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: 'B48', name: 'Base Double Door 48"', width: 48, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: 'SB21', name: 'Sink Base Single Door 21"', width: 21, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: 'SB24', name: 'Sink Base Single Door 24"', width: 24, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: 'SB24B', name: 'Sink Base 24"', width: 24, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: 'SB27B', name: 'Sink Base 27"', width: 27, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: 'SB30B', name: 'Sink Base 30"', width: 30, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: 'SB33B', name: 'Sink Base 33"', width: 33, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: 'SB36B', name: 'Sink Base 36"', width: 36, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: 'SB39', name: 'Sink Base 39"', width: 39, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: 'SB42', name: 'Sink Base 42"', width: 42, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: 'SB45', name: 'Sink Base 45"', width: 45, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: 'SB48', name: 'Sink Base 48"', width: 48, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: '2BD18', name: 'Two Drawer Base 18"', width: 18, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: '2BD21', name: 'Two Drawer Base 21"', width: 21, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: '2BD24', name: 'Two Drawer Base 24"', width: 24, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: '2BD27', name: 'Two Drawer Base 27"', width: 27, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: '2BD30', name: 'Two Drawer Base 30"', width: 30, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: '2BD33', name: 'Two Drawer Base 33"', width: 33, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: '2BD36', name: 'Two Drawer Base 36"', width: 36, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: '3BD12', name: 'Three Drawer Base 12"', width: 12, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: '3BD15', name: 'Three Drawer Base 15"', width: 15, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: '3BD18', name: 'Three Drawer Base 18"', width: 18, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: '3BD21', name: 'Three Drawer Base 21"', width: 21, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: '3BD24', name: 'Three Drawer Base 24"', width: 24, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: '3BD27', name: 'Three Drawer Base 27"', width: 27, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: '4BD12', name: 'Four Drawer Base 12"', width: 12, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: '4BD15', name: 'Four Drawer Base 15"', width: 15, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: '4BD18', name: 'Four Drawer Base 18"', width: 18, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: '4BD21', name: 'Four Drawer Base 21"', width: 21, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: '4BD24', name: 'Four Drawer Base 24"', width: 24, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: '4BD27', name: 'Four Drawer Base 27"', width: 27, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: '4BD30', name: 'Four Drawer Base 30"', width: 30, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: '4BD33', name: 'Four Drawer Base 33"', width: 33, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Base Cabinets', code: '4BD36', name: 'Four Drawer Base 36"', width: 36, depth: 24, height: 34.5 },
    { type: 'cabinet', category: 'Tall/Utility', code: 'U128412', name: 'Utility Cabinet 12x84 (12"D)', width: 12, depth: 12, height: 84 },
    { type: 'cabinet', category: 'Tall/Utility', code: 'U158412', name: 'Utility Cabinet 15x84 (12"D)', width: 15, depth: 12, height: 84 },
    { type: 'cabinet', category: 'Tall/Utility', code: 'U188412', name: 'Utility Cabinet 18x84 (12"D)', width: 18, depth: 12, height: 84 },
    { type: 'cabinet', category: 'Tall/Utility', code: 'U248412', name: 'Utility Cabinet 24x84 (12"D)', width: 24, depth: 12, height: 84 },
    { type: 'cabinet', category: 'Tall/Utility', code: 'U128424', name: 'Utility Cabinet 12x84 (24"D)', width: 12, depth: 24, height: 84 },
    { type: 'cabinet', category: 'Tall/Utility', code: 'U158424', name: 'Utility Cabinet 15x84 (24"D)', width: 15, depth: 24, height: 84 },
    { type: 'cabinet', category: 'Tall/Utility', code: 'U188424', name: 'Utility Cabinet 18x84 (24"D)', width: 18, depth: 24, height: 84 },
    { type: 'cabinet', category: 'Tall/Utility', code: 'U248424', name: 'Utility Cabinet 24x84 (24"D)', width: 24, depth: 24, height: 84 },
    { type: 'cabinet', category: 'Tall/Utility', code: 'U308424', name: 'Utility Cabinet 30x84 (24"D)', width: 30, depth: 24, height: 84 },
    { type: 'cabinet', category: 'Tall/Utility', code: 'U368424', name: 'Utility Cabinet 36x84 (24"D)', width: 36, depth: 24, height: 84 },
    { type: 'cabinet', category: 'Tall/Utility', code: 'U129024', name: 'Utility Cabinet 12x90 (24"D)', width: 12, depth: 24, height: 90 },
    { type: 'cabinet', category: 'Tall/Utility', code: 'U189024', name: 'Utility Cabinet 18x90 (24"D)', width: 18, depth: 24, height: 90 },
    { type: 'cabinet', category: 'Tall/Utility', code: 'U249024', name: 'Utility Cabinet 24x90 (24"D)', width: 24, depth: 24, height: 90 },
    { type: 'cabinet', category: 'Tall/Utility', code: 'U309024', name: 'Utility Cabinet 30x90 (24"D)', width: 30, depth: 24, height: 90 },
    { type: 'cabinet', category: 'Tall/Utility', code: 'U369024', name: 'Utility Cabinet 36x90 (24"D)', width: 36, depth: 24, height: 90 },
    { type: 'cabinet', category: 'Tall/Utility', code: 'U129624', name: 'Utility Cabinet 12x96 (24"D)', width: 12, depth: 24, height: 96 },
    { type: 'cabinet', category: 'Tall/Utility', code: 'U189624', name: 'Utility Cabinet 18x96 (24"D)', width: 18, depth: 24, height: 96 },
    { type: 'cabinet', category: 'Tall/Utility', code: 'U249624', name: 'Utility Cabinet 24x96 (24"D)', width: 24, depth: 24, height: 96 },
    { type: 'cabinet', category: 'Tall/Utility', code: 'U309624', name: 'Utility Cabinet 30x96 (24"D)', width: 30, depth: 24, height: 96 },
    { type: 'cabinet', category: 'Tall/Utility', code: 'U369624', name: 'Utility Cabinet 36x96 (24"D)', width: 36, depth: 24, height: 96 },
    { type: 'cabinet', category: 'Vanities', code: 'VSB2418B', name: 'Vanity Sink Base 24x18', width: 24, depth: 18, height: 32 },
    { type: 'cabinet', category: 'Vanities', code: 'VSB3018B', name: 'Vanity Sink Base 30x18', width: 30, depth: 18, height: 32 },
    { type: 'cabinet', category: 'Vanities', code: 'VSB3618B', name: 'Vanity Sink Base 36x18', width: 36, depth: 18, height: 32 },
    { type: 'cabinet', category: 'Vanities', code: 'VSB24B', name: 'Vanity Sink Base 24x21', width: 24, depth: 21, height: 32 },
    { type: 'cabinet', category: 'Vanities', code: 'VSB30B', name: 'Vanity Sink Base 30x21', width: 30, depth: 21, height: 32 },
    { type: 'cabinet', category: 'Vanities', code: 'VSB36B', name: 'Vanity Sink Base 36x21', width: 36, depth: 21, height: 32 },
    { type: 'cabinet', category: 'Vanities', code: 'VSB48', name: 'Vanity Sink Base 48x21', width: 48, depth: 21, height: 32 },
    { type: 'cabinet', category: 'Vanities', code: 'VSB60', name: 'Vanity Sink Base 60x21', width: 60, depth: 21, height: 32 },
    { type: 'cabinet', category: 'Vanities', code: 'VB12', name: 'Vanity Base 12"', width: 12, depth: 21, height: 32 },
    { type: 'cabinet', category: 'Vanities', code: 'VB18', name: 'Vanity Base 18"', width: 18, depth: 21, height: 32 },
    { type: 'cabinet', category: 'Vanities', code: 'VB24', name: 'Vanity Base 24"', width: 24, depth: 21, height: 32 },
    { type: 'cabinet', category: 'Vanities', code: 'VB30', name: 'Vanity Base 30"', width: 30, depth: 21, height: 32 },
    { type: 'cabinet', category: 'Vanities', code: 'VBD12', name: 'Vanity Three Drawer Base 12"', width: 12, depth: 21, height: 32 },
    { type: 'cabinet', category: 'Vanities', code: 'VBD18', name: 'Vanity Three Drawer Base 18"', width: 18, depth: 21, height: 32 },
    { type: 'cabinet', category: 'Vanities', code: 'VBD24', name: 'Vanity Three Drawer Base 24"', width: 24, depth: 21, height: 32 },
    { type: 'cabinet', category: 'Vanities', code: 'VBD30', name: 'Vanity Three Drawer Base 30"', width: 30, depth: 21, height: 32 },
    { type: 'cabinet', category: 'Vanities', code: 'VBD36', name: 'Vanity Three Drawer Base 36"', width: 36, depth: 21, height: 32 },
    { type: 'cabinet', category: 'Vanities', code: 'LT1884', name: 'Linen Tower 18x84', width: 18, depth: 21, height: 84 },
  ];

  function getRecommendedDepth(preset: AssetPreset): number {
    if (preset.type === 'cabinet') {
      if (preset.category === 'Vanities' || currentCategory === 'Bathroom') {
        return preset.depth || 21;
      }
      if (preset.category === 'Upper Cabinets') {
        return preset.depth || 12;
      }
      return preset.depth || 24;
    }
    return preset.depth;
  }

  /* ════════════════════════════════════════════════════════════════
     HELPERS
     ════════════════════════════════════════════════════════════════ */
  function uid(){ return Math.random().toString(36).slice(2,10); }
  function snap(v: number){ return Math.round(v / SNAP) * SNAP; }
  function dist(a: Point, b: Point){ return Math.hypot(b.x-a.x, b.y-a.y); }
  function lerp(a: number, b: number, t: number){ return a + (b-a)*t; }
  function clamp(v: number, lo: number, hi: number){ return Math.max(lo,Math.min(hi,v)); }
  function screenToCanvas(sx: number, sy: number): Point {
    const r = canvas.getBoundingClientRect();
    return { x: (sx - r.left - panX) / zoom, y: (sy - r.top - panY) / zoom };
  }
  function toast(msg: string, dur=2000){
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout((t as any)._t);
    (t as any)._t = setTimeout(()=>t.classList.add('hidden'), dur);
  }

  function getProject(): Project | undefined { return projects.find(p=>p.id===currentProjectId); }
  function getPage(): Page | undefined { const p=getProject(); return p && p.pages[currentPageIdx]; }

  function save(){
    if(!currentProjectId) return;
    try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(projects)); }catch(e){}
    maybeAutoBackup();
  }
  function saveAndRender(){ save(); render(); }

  // This device's local storage IS the real working copy — Drive is purely
  // disaster recovery for "the device died / cache got wiped," not live
  // sync. No reason to hit the Drive API on every keystroke for that; a
  // daily check is plenty. (Bump AUTO_BACKUP_INTERVAL_MS if weekly's
  // preferred instead.)
  const LAST_DRIVE_BACKUP_KEY = 'nextlevel_last_drive_backup';
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

  // Visible nudge when there's real work on this device that ISN'T backed
  // up anywhere — shown any time the sidebar refreshes, so it can't be
  // missed by just not opening the Drive section.
  function updateDriveBackupNudge(){
    const el = document.getElementById('drive-status');
    if(!el) return;
    if(!driveConfigured || isDriveConnected()) return; // configured+connected messages are handled elsewhere
    if(projects.length > 0){
      el.textContent = '⚠️ Not backed up — connect Google Drive below';
      el.style.color = '#fca5a5';
    }
  }

  function newPage(name?: string): Page {
    return {
      id: uid(), name: name||'Page 1',
      walls: [
        { start: {x: 100, y: 100}, end: {x: 340, y: 100}, wallType: 'existing_to_remain' },
        { start: {x: 340, y: 100}, end: {x: 340, y: 340}, wallType: 'existing_to_remain' },
        { start: {x: 340, y: 340}, end: {x: 100, y: 340}, wallType: 'existing_to_remain' },
        { start: {x: 100, y: 340}, end: {x: 100, y: 100}, wallType: 'existing_to_remain' }
      ],
      doors:[], windows:[], assets:[], notes:[], history:[], historyIdx:-1
    };
  }
  function newProject(name?: string, cat?: string): Project {
    return {
      id: uid(), name: name||'New Project', customer: '',
      category: cat||'Kitchen', scope: 'Full Build',
      pages: [newPage()], ceilingH: 96, studSpacing: 16, waste: 1.10, photos: []
    };
  }

  /* ── History ──────────────────────────────────────── */
  function pushHistory(){
    const page = getPage(); if(!page) return;
    const snapshot = JSON.stringify({ walls: page.walls, doors: page.doors, windows: page.windows, assets: page.assets });
    if(page.historyIdx < page.history.length - 1){
      page.history = page.history.slice(0, page.historyIdx + 1);
    }
    page.history.push(snapshot);
    if(page.history.length > HISTORY_MAX) page.history.shift();
    page.historyIdx = page.history.length - 1;
  }
  // Seed the pre-action state once, so the first Undo has somewhere to go back to.
  function seedHistoryIfEmpty(){
    const page = getPage(); if(!page || page.history.length > 0) return;
    page.history.push(JSON.stringify({ walls: page.walls, doors: page.doors, windows: page.windows, assets: page.assets }));
    page.historyIdx = 0;
  }
  function restoreSnapshot(snapStr: string){
    const page = getPage(); if(!page) return;
    const d = JSON.parse(snapStr);
    page.walls = d.walls; page.doors = d.doors || []; page.windows = d.windows || []; page.assets = d.assets || [];
    // A restored state may not contain what was selected — clear to avoid ghosts.
    selectedWallIdx = -1; selectedWallIndices = [];
    selectedAssetId = null; selectedAssetIds = [];
  }
  function undo(){
    const page=getPage(); if(!page||page.historyIdx<=0) return;
    page.historyIdx--;
    restoreSnapshot(page.history[page.historyIdx]);
    saveAndRender();
  }
  function redo(){
    const page=getPage(); if(!page||page.historyIdx>=page.history.length-1) return;
    page.historyIdx++;
    restoreSnapshot(page.history[page.historyIdx]);
    saveAndRender();
  }

  /* ════════════════════════════════════════════════════════════════
     WALLS
     ════════════════════════════════════════════════════════════════ */
  function wallLength(w: Wall){ return dist(w.start, w.end); }
  function wallAngle(w: Wall){ return Math.atan2(w.end.y - w.start.y, w.end.x - w.start.x); }

  // Corner welding: wall endpoints sitting on the same spot are treated as a
  // shared corner. Moving one drags the others so connected walls stay
  // connected and their lengths recompute. (Walls store independent points,
  // so without this a box is really 4 loose sticks.)
  const WELD_EPS = 2;
  function samePt(a: Point, b: Point){ return Math.abs(a.x - b.x) < WELD_EPS && Math.abs(a.y - b.y) < WELD_EPS; }

  function findWallAt(pos: Point, threshold?: number){
    const page=getPage(); if(!page) return -1;
    const th = threshold || SNAP;
    let best = -1, bestD = th;
    for(let i=0; i<page.walls.length; i++){
      const w = page.walls[i];
      const d = pointToSegmentDist(pos, w.start, w.end);
      if(d < bestD){ bestD = d; best = i; }
    }
    return best;
  }

  function pointToSegmentDist(p: Point, a: Point, b: Point){
    const dx = b.x - a.x, dy = b.y - a.y;
    const lenSq = dx*dx + dy*dy;
    if(lenSq === 0) return dist(p, a);
    let t = ((p.x-a.x)*dx + (p.y-a.y)*dy) / lenSq;
    t = clamp(t, 0, 1);
    return dist(p, {x: a.x+t*dx, y: a.y+t*dy});
  }

  function closestPointOnWall(pos: Point, w: Wall){
    const dx=w.end.x-w.start.x, dy=w.end.y-w.start.y;
    const lenSq=dx*dx+dy*dy;
    if(lenSq===0) return { ...w.start };
    let t=((pos.x-w.start.x)*dx+(pos.y-w.start.y)*dy)/lenSq;
    t=clamp(t,0,1);
    return {x:w.start.x+t*dx, y:w.start.y+t*dy};
  }

  // Wall-snap + auto-orient: if an asset lands near a wall, snap its back edge
  // flush against it and rotate it to sit against the wall (facing the room).
  // Threshold-gated — mid-room islands/peninsulas stay free. Mutates the asset.
  const WALL_SNAP_MARGIN = 18; // inches of slack beyond the asset's back edge
  function snapAssetToWall(a: Asset){
    const page = getPage(); if(!page || page.walls.length === 0) return;
    const center = { x: a.x, y: a.y };
    let best: { w: Wall; cp: Point } | null = null, bestD = Infinity;
    for(const w of page.walls){
      const cp = closestPointOnWall(center, w);
      const d = dist(center, cp);
      if(d < bestD){ bestD = d; best = { w, cp }; }
    }
    if(!best) return;
    const hd = (a.depth || 24) / 2;
    if(bestD > hd + WALL_SNAP_MARGIN) return; // too far → leave free
    let nx = center.x - best.cp.x, ny = center.y - best.cp.y;
    const nlen = Math.hypot(nx, ny);
    if(nlen < 0.001){                          // dead-on the wall: pick a side
      const wa = wallAngle(best.w);
      nx = -Math.sin(wa); ny = Math.cos(wa);
    } else { nx /= nlen; ny /= nlen; }         // room-side normal (unit)
    const rr = Math.atan2(nx, -ny);            // back faces wall, front to room
    a.rotation = ((rr * 180 / Math.PI) % 360 + 360) % 360;
    a.x = best.cp.x + nx * hd;                 // back edge flush on the wall
    a.y = best.cp.y + ny * hd;
  }

  /* ════════════════════════════════════════════════════════════════
     ROOM DETECTION
     ════════════════════════════════════════════════════════════════ */
  function findRoomCycles(){
    const page=getPage(); if(!page||page.walls.length<3) return [];
    const walls = page.walls;
    const adj: Record<string, { wall: number; neighbor: string }[]> = {};
    function addEdge(k1: string, k2: string, wi: number){
      if(!adj[k1]) adj[k1]=[];
      if(!adj[k2]) adj[k2]=[];
      adj[k1].push({wall:wi, neighbor:k2});
      adj[k2].push({wall:wi, neighbor:k1});
    }
    function key(p: Point){ return Math.round(p.x)+','+Math.round(p.y); }
    function parseKey(s: string){ const [x,y]=s.split(',').map(Number); return {x,y}; }

    walls.forEach((w,i)=>{
      const k1 = key(w.start), k2 = key(w.end);
      addEdge(k1,k2,i);
    });

    const cycles: Point[][] = [];

    function dfs(startKey: string, currentKey: string, path: string[], usedWalls: Set<number>){
      const neighbors = adj[currentKey] || [];
      for(const n of neighbors){
        if(usedWalls.has(n.wall)) continue;
        if(n.neighbor === startKey && path.length >= 3){
          cycles.push(path.map(parseKey));
          return;
        }
        if(path.includes(n.neighbor)) continue;
        const newUsed = new Set(usedWalls);
        newUsed.add(n.wall);
        dfs(startKey, n.neighbor, [...path, n.neighbor], newUsed);
      }
    }

    const allKeys = Object.keys(adj);
    for(const k of allKeys){
      dfs(k, k, [k], new Set());
      if(cycles.length > 20) break;
    }

    const seen = new Set<string>();
    const unique: Point[][] = [];
    for(const c of cycles){
      const sig = c.map(key).sort().join('|');
      if(!seen.has(sig)){
        seen.add(sig);
        unique.push(c);
      }
    }
    return unique;
  }

  function shoelaceArea(pts: Point[]){
    let area = 0;
    for(let i=0; i<pts.length; i++){
      const j = (i+1) % pts.length;
      area += pts[i].x * pts[j].y;
      area -= pts[j].x * pts[i].y;
    }
    return Math.abs(area / 2);
  }

  /* ════════════════════════════════════════════════════════════════
     DOORS / WINDOWS ON WALLS
     ════════════════════════════════════════════════════════════════ */
  function placeOpeningOnWall(wallIdx: number, distFromStart: number, opening: Opening){
    const page=getPage(); if(!page) return;
    const w = page.walls[wallIdx];
    const len = wallLength(w);
    const t = distFromStart / len;
    const x = lerp(w.start.x, w.end.x, t);
    const y = lerp(w.start.y, w.end.y, t);
    const angle = wallAngle(w);
    opening.x = x;
    opening.y = y;
    opening.angle = angle;
    opening.wallIdx = wallIdx;
    opening.distFromStart = distFromStart;
    opening.id = uid();
  }

  function recalcOpenings(){
    const page=getPage(); if(!page) return;
    [...page.doors, ...page.windows].forEach(o => {
      if(o.floating) return; // free-dragging: x/y follow the cursor, not a wall
      if(o.wallIdx >= 0 && o.wallIdx < page.walls.length){
        const w = page.walls[o.wallIdx];
        const len = wallLength(w);
        const clampedT = clamp(o.distFromStart / len, 0, 1); // distFromStart = center
        o.x = lerp(w.start.x, w.end.x, clampedT);
        o.y = lerp(w.start.y, w.end.y, clampedT);
        o.angle = wallAngle(w);
      }
    });
  }

  function deleteOpening(type: 'door' | 'window', id: string){
    const page=getPage(); if(!page) return;
    const list = type==='door' ? page.doors : page.windows;
    const target = list.find(o => o.id === id);
    if(target && target.locked){
      toast('Cannot delete locked ' + type);
      return;
    }
    if(type==='door') page.doors = page.doors.filter(d=>d.id!==id);
    else page.windows = page.windows.filter(w=>w.id!==id);
    pushHistory(); saveAndRender();
  }

  function removeWallAndOpenings(wallIdx: number){
    const page = getPage(); if(!page) return;
    page.walls.splice(wallIdx, 1);
    page.doors = page.doors.filter(d => d.wallIdx !== wallIdx);
    page.windows = page.windows.filter(w => w.wallIdx !== wallIdx);
    page.doors.forEach(d => { if(d.wallIdx > wallIdx) d.wallIdx--; });
    page.windows.forEach(w => { if(w.wallIdx > wallIdx) w.wallIdx--; });
  }

  /* ════════════════════════════════════════════════════════════════
     OPENING EDIT PANEL
     ════════════════════════════════════════════════════════════════ */
  function showOpeningEdit(opening: Opening, type: 'door' | 'window'){
    const panel = document.getElementById('opening-edit-panel');
    const title = document.getElementById('opening-edit-title');
    const hWrap = document.getElementById('opening-height-wrap');
    if(!panel || !title || !hWrap) return;

    title.textContent = type === 'door' ? 'Door Properties' : 'Window Properties';
    (document.getElementById('opening-edit-width') as HTMLInputElement).value = Math.round(opening.width).toString();
    (document.getElementById('opening-edit-height') as HTMLInputElement).value = Math.round(opening.height || 36).toString();
    hWrap.style.display = type === 'door' ? 'none' : 'block';
    const flipWrap = document.getElementById('opening-flip-wrap');
    if(flipWrap) flipWrap.style.display = type === 'door' ? 'flex' : 'none';

    const page = getPage();
    const w = page?.walls[opening.wallIdx];
    const wallLen = w ? wallLength(w) : 0;

    (document.getElementById('opening-edit-ref') as HTMLSelectElement).value = 'left';
    const distVal = getOpeningRefDist(opening, wallLen);
    (document.getElementById('opening-edit-dist') as HTMLInputElement).value = distVal.toFixed(2);
    updateOpeningDistFt(distVal);
    const lockInput = document.getElementById('opening-edit-lock') as HTMLInputElement;
    if(lockInput) lockInput.checked = !!opening.locked;

    panel.classList.remove('hidden');
  }

  function hideOpeningEdit(){
    const panel = document.getElementById('opening-edit-panel');
    if (panel) panel.classList.add('hidden');
    selectedOpening = null;
  }

  function getSelectedOpening(): Opening | null {
    const page = getPage();
    if(!page || !selectedOpening) return null;
    if(selectedOpening.type === 'door'){
      return page.doors.find(d => d.id === selectedOpening!.id) || null;
    } else {
      return page.windows.find(w => w.id === selectedOpening!.id) || null;
    }
  }

  function updateOpeningDistFt(inches: number){
    const ft = Math.floor(inches / 12);
    const rem = inches - ft * 12;
    const q = Math.round(rem * 4) / 4;
    const display = ft + "' " + q.toFixed(q % 1 === 0 ? 0 : 2) + '"';
    const el = document.getElementById('opening-edit-dist-ft');
    if (el) el.textContent = display;
  }

  function applyOpeningDistFromRef(opening: Opening, distVal: number, ref: string){
    const page = getPage();
    if(!page) return;
    const w = page.walls[opening.wallIdx];
    const wallLen = wallLength(w);
    if(ref === 'left'){
      opening.distFromStart = distVal + opening.width / 2;
    } else if(ref === 'center'){
      opening.distFromStart = distVal;
    } else if(ref === 'right'){
      opening.distFromStart = Math.max(0, wallLen - distVal - opening.width / 2);
    }
  }

  // Inverse of applyOpeningDistFromRef — what should the Distance box show for
  // the CURRENTLY selected ref, given the opening's true (center) distFromStart.
  function getOpeningRefDist(opening: Opening, wallLen: number): number {
    const ref = (document.getElementById('opening-edit-ref') as HTMLSelectElement)?.value || 'left';
    if(ref === 'left') return Math.max(0, opening.distFromStart - opening.width / 2);
    if(ref === 'right') return Math.max(0, wallLen - opening.distFromStart - opening.width / 2);
    return opening.distFromStart; // center
  }

  /* ════════════════════════════════════════════════════════════════
     DIMENSION LINES
     ════════════════════════════════════════════════════════════════ */
  function drawDimLine(x1: number, y1: number, x2: number, y2: number, label: string, side: 'left' | 'right'){
    ctx.save();
    const offset = side === 'left' ? -18 : 18;
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx*dx + dy*dy);
    if(len < 1){ ctx.restore(); return; }
    const nx = -dy/len, ny = dx/len;
    const ox = nx * offset, oy = ny * offset;
    const sx1 = x1 + ox, sy1 = y1 + oy;
    const sx2 = x2 + ox, sy2 = y2 + oy;

    ctx.strokeStyle = 'rgba(0,39,76,0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4,3]);
    ctx.beginPath();
    ctx.moveTo(sx1, sy1);
    ctx.lineTo(sx2, sy2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Tick marks
    ctx.beginPath();
    ctx.moveTo(x1 + nx*4, y1 + ny*4);
    ctx.lineTo(x1 - nx*4, y1 - ny*4);
    ctx.moveTo(x2 + nx*4, y2 + ny*4);
    ctx.lineTo(x2 - nx*4, y2 - ny*4);
    ctx.strokeStyle = 'rgba(0,39,76,0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Label
    const mx = (sx1 + sx2)/2, my = (sy1 + sy2)/2;
    const angle = Math.atan2(dy, dx);
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#00274C';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.save();
    ctx.translate(mx, my);
    let rot = angle;
    if(rot > Math.PI/2 || rot < -Math.PI/2) rot += Math.PI;
    ctx.rotate(rot);
    ctx.fillText(label, 0, -8);
    ctx.restore();
    ctx.restore();
  }

  function drawOpeningDims(opening: Opening, wallIdx: number){
    const page = getPage();
    if(!page || wallIdx < 0 || wallIdx >= page.walls.length) return;
    const w = page.walls[wallIdx];
    const wallLen = wallLength(w);
    const angle = wallAngle(w);
    const dx = Math.cos(angle), dy = Math.sin(angle);

    const leftX = w.start.x + dx * (opening.distFromStart - opening.width/2);
    const leftY = w.start.y + dy * (opening.distFromStart - opening.width/2);
    const rightX = w.start.x + dx * (opening.distFromStart + opening.width/2);
    const rightY = w.start.y + dy * (opening.distFromStart + opening.width/2);

    const distToLeft = fmtLen(opening.distFromStart - opening.width/2);
    const distToRight = fmtLen(wallLen - opening.distFromStart - opening.width/2);

    // Both segments on the SAME side of the wall — one continuous corner→jamb→jamb→corner string.
    drawDimLine(w.start.x, w.start.y, leftX, leftY, distToLeft, 'left');
    drawDimLine(rightX, rightY, w.end.x, w.end.y, distToRight, 'left');
  }

  function formatInches(inches: number){
    const ft = Math.floor(inches / 12);
    const rem = inches - ft * 12;
    const q = Math.round(rem * 4) / 4;
    if(ft > 0) return ft + "'" + (q > 0 ? ' ' + q.toFixed(q % 1 === 0 ? 0 : 2) + '"' : '"');
    return q.toFixed(q % 1 === 0 ? 0 : 2) + '"';
  }

  // All lengths display as feet-inches (US floor-plan standard, e.g. 16' 6").
  function fmtLen(inches: number){
    return formatInches(inches);
  }

  /* ════════════════════════════════════════════════════════════════
     DRAWING
     ════════════════════════════════════════════════════════════════ */
  function render(){
    seedHistoryIfEmpty();
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,canvasW/dpr,canvasH/dpr);

    const page = getPage();
    if(!page){
      ctx.save();
      ctx.translate(panX, panY);
      ctx.scale(zoom, zoom);
      drawGrid();
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    drawGrid();

    // Room cycles
    const cycles = findRoomCycles();
    cycles.forEach((pts)=>{
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for(let i=1; i<pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,203,5,0.08)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,39,76,0.15)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4,4]);
      ctx.stroke();
      ctx.setLineDash([]);

      const cx = pts.reduce((s,p)=>s+p.x,0)/pts.length;
      const cy = pts.reduce((s,p)=>s+p.y,0)/pts.length;
      const areaSqIn = shoelaceArea(pts);
      const areaSqFt = (areaSqIn / 144).toFixed(0);
      ctx.font = '10px sans-serif';
      ctx.fillStyle = 'rgba(0,39,76,0.18)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(areaSqFt + ' sq ft', cx, cy);
    });

    // Draw alignment guidelines during wall drawing
    if(tool === 'wall' && activeGuidelines.length > 0){
      activeGuidelines.forEach(g => {
        ctx.save();
        ctx.strokeStyle = g.color || 'rgba(37, 99, 235, 0.7)';
        ctx.lineWidth = 1.5 / zoom;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(g.x1, g.y1);
        ctx.lineTo(g.x2, g.y2);
        ctx.stroke();
        ctx.restore();
      });
    }

    // Walls
    page.walls.forEach((w,i)=>{
      const showNew = currentView==='after' || w.wallType!=='new_construction';
      if(!showNew) return;
      drawWall(w, i===selectedWallIdx || selectedWallIndices.includes(i));
    });

    // Rectangular selection marquee
    if(tool === 'rect_select' && rectSelectStart && rectSelectCurrent){
      ctx.save();
      ctx.fillStyle = 'rgba(37, 99, 235, 0.12)';
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 1.5 / zoom;
      ctx.setLineDash([4, 4]);
      const rx = Math.min(rectSelectStart.x, rectSelectCurrent.x);
      const ry = Math.min(rectSelectStart.y, rectSelectCurrent.y);
      const rw = Math.abs(rectSelectCurrent.x - rectSelectStart.x);
      const rh = Math.abs(rectSelectCurrent.y - rectSelectStart.y);
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.restore();
    }

    // Doors
    page.doors.forEach((d)=> { drawDoor(d); });

    // Windows
    page.windows.forEach((w)=> { drawWindowShape(w); });

    // Dimension lines for selected opening
    if(selectedOpening){
      const selOp = getSelectedOpening();
      if(selOp){
        drawOpeningDims(selOp, selOp.wallIdx);
        ctx.save();
        ctx.translate(selOp.x || 0, selOp.y || 0);
        ctx.rotate(selOp.angle || 0);
        ctx.strokeStyle = '#E8622C';
        ctx.lineWidth = 3;
        const hw2 = (selOp.width || 32) / 2;
        ctx.strokeRect(-hw2 - 4, -8, hw2 * 2 + 8, 16);
        ctx.restore();
      }
    }

    // Placement preview ghost
    if(placementPreview && (tool === 'door' || tool === 'window')){
      const pp = placementPreview;
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.translate(pp.x, pp.y);
      ctx.rotate(pp.angle || 0);
      const hw3 = pp.width / 2;

      ctx.fillStyle = '#fff';
      ctx.fillRect(-hw3 - 2, -6, hw3 * 2 + 4, 12);
      if(tool === 'door'){
        ctx.beginPath();
        ctx.arc(-hw3, 0, hw3 * 2, 0, -Math.PI/2, true);
        ctx.strokeStyle = '#00274C';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4,3]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(-hw3, 0);
        ctx.lineTo(-hw3, -hw3 * 1.4);
        ctx.stroke();
      } else {
        ctx.strokeStyle = '#00274C';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-hw3, -3);
        ctx.lineTo(hw3, -3);
        ctx.moveTo(-hw3, 3);
        ctx.lineTo(hw3, 3);
        ctx.stroke();
      }
      ctx.restore();

      const page2 = getPage();
      if(page2 && pp.wallIdx >= 0 && pp.wallIdx < page2.walls.length){
        const pw = page2.walls[pp.wallIdx];
        const pAngle = wallAngle(pw);
        const pdx = Math.cos(pAngle), pdy = Math.sin(pAngle);
        const pLeftX = pw.start.x + pdx * (pp.distFromStart - pp.width/2);
        const pLeftY = pw.start.y + pdy * (pp.distFromStart - pp.width/2);
        const pRightX = pw.start.x + pdx * (pp.distFromStart + pp.width/2);
        const pRightY = pw.start.y + pdy * (pp.distFromStart + pp.width/2);
        const pWallLen = wallLength(pw);
        drawDimLine(pw.start.x, pw.start.y, pLeftX, pLeftY, formatInches(Math.max(0, pp.distFromStart - pp.width/2)), 'left');
        drawDimLine(pRightX, pRightY, pw.end.x, pw.end.y, formatInches(Math.max(0, pWallLen - pp.distFromStart - pp.width/2)), 'left');
      }
    }

    // Asset placement ghost preview
    if(tool === 'place_asset' && mousePos && activePreset){
      ctx.save();
      ctx.globalAlpha = 0.65;
      const sx = snap(mousePos.x);
      const sy = snap(mousePos.y);
      const recDepth = getRecommendedDepth(activePreset);
      const ghostAsset: Asset = {
        id: 'ghost',
        type: activePreset.type,
        category: activePreset.category,
        name: activePreset.name,
        code: activePreset.code,
        x: sx,
        y: sy,
        width: activePreset.width,
        depth: recDepth,
        height: activePreset.height,
        rotation: placingAssetRotation,
        kneeWallWidth: activePreset.kneeWallWidth,
        glassDoorWidth: activePreset.glassDoorWidth,
        enclosureStyle: activePreset.enclosureStyle,
        drainType: activePreset.drainType,
        hasRainHead: activePreset.hasRainHead,
        hasWallHead: activePreset.hasWallHead,
      };
      snapAssetToWall(ghostAsset);
      drawAsset(ghostAsset);
      ctx.restore();
    }    // Pending wall
    if(wallStart && mousePos && tool==='wall'){
      drawPendingWall();
    }

    // Selection handles
    if(selectedWallIdx >= 0 && selectedWallIdx < page.walls.length){
      const w = page.walls[selectedWallIdx];
      drawHandle(w.start);
      drawHandle(w.end);
    }

    // Assets
    page.assets.forEach(a => drawAsset(a));

    // Voice notes
    page.notes.forEach((n, idx) => drawNote(n, idx + 1));

    ctx.restore();

    updateTakeoff();
  }

  function drawGrid(){
    ctx.save();
    const w = canvasW/dpr, h = canvasH/dpr;
    const x0 = -panX/zoom, y0 = -panY/zoom;
    const x1 = x0 + w/zoom, y1 = y0 + h/zoom;
    const startX = Math.floor(x0/GRID)*GRID;
    const startY = Math.floor(y0/GRID)*GRID;

    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 0.5/zoom;
    ctx.beginPath();
    for(let x=startX; x<=x1; x+=GRID){
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
    }
    for(let y=startY; y<=y1; y+=GRID){
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawWall(w: Wall, selected: boolean){
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(w.start.x, w.start.y);
    ctx.lineTo(w.end.x, w.end.y);

    if(w.wallType==='demolished'){
      ctx.setLineDash([8,6]);
      ctx.strokeStyle = '#c00';
      ctx.lineWidth = 3;
    } else if(w.wallType==='existing_to_remain'){
      ctx.setLineDash([]);
      ctx.strokeStyle = '#666';
      ctx.lineWidth = 3;
    } else {
      ctx.setLineDash([]);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 3;
    }
    if(selected){
      ctx.strokeStyle = '#E8622C';
      ctx.lineWidth = 4;
    }
    ctx.stroke();
    ctx.setLineDash([]);

    const len = wallLength(w);
    const mx = (w.start.x + w.end.x)/2;
    const my = (w.start.y + w.end.y)/2;
    const angle = wallAngle(w);
    const offsetX = -Math.sin(angle) * 14;
    const offsetY = Math.cos(angle) * 14;
    if (showDimensions) {
      ctx.font = '12px sans-serif';
      ctx.fillStyle = selected ? '#00274C' : '#444';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(fmtLen(len), mx + offsetX, my + offsetY);
    }

    ctx.restore();
  }

  function drawPendingWall(){
    if(!wallStart||!mousePos) return;
    const page = getPage();
    const { snappedPos } = getWallSnapAndGuides(mousePos, wallStart, page ? page.walls : []);
    const sx = snappedPos.x, sy = snappedPos.y;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(wallStart.x, wallStart.y);
    ctx.lineTo(sx, sy);
    const pt = pendingWallType || currentWallType;
    if(pt==='demolished'){
      ctx.setLineDash([8,6]); ctx.strokeStyle='#c00';
    } else if(pt==='existing_to_remain'){
      ctx.setLineDash([]); ctx.strokeStyle='#666';
    } else {
      ctx.setLineDash([]); ctx.strokeStyle='#000';
    }
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.setLineDash([]);

    const len = dist(wallStart, {x:sx,y:sy});
    const mx = (wallStart.x + sx)/2;
    const my = (wallStart.y + sy)/2;
    const angle = Math.atan2(sy-wallStart.y, sx-wallStart.x);
    const ox = -Math.sin(angle)*14, oy = Math.cos(angle)*14;
    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = '#00274C';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(fmtLen(len), mx+ox, my+oy);

    // Draw snap indicator dot on snapped endpoint
    ctx.beginPath();
    ctx.arc(sx, sy, 5 / zoom, 0, Math.PI * 2);
    ctx.fillStyle = '#2563EB';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5 / zoom;
    ctx.stroke();

    ctx.restore();
  }

  function drawHandle(pt: Point){
    const r = 6;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, r/zoom+1, 0, Math.PI*2);
    ctx.fillStyle = selectedWallIdx>=0 ? '#E8622C' : '#15120F';
    ctx.fill();
    ctx.strokeStyle = '#00274C';
    ctx.lineWidth = 2/zoom;
    ctx.stroke();
  }

  function drawDoor(d: Opening){
    ctx.save();
    ctx.translate(d.x || 0, d.y || 0);
    ctx.rotate(d.angle || 0);

    const hw = (d.width || 32) / 2;

    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.moveTo(-hw, -5);
    ctx.lineTo(hw, -5);
    ctx.lineTo(hw, 5);
    ctx.lineTo(-hw, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    if(d.type==='left_swing' || d.type==='right_swing'){
      const dir = d.type==='left_swing' ? 1 : -1;
      const flip = d.flipped ? -1 : 1;
      const swingRadius = hw * 2;
      ctx.beginPath();
      ctx.arc(-hw * dir, 0, swingRadius, 0, -Math.PI/2 * dir * flip, dir * flip > 0);
      ctx.strokeStyle = '#00274C';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4,3]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.moveTo(-hw, 0);
      ctx.lineTo(-hw, -swingRadius * 0.7 * flip);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if(d.type==='pocket'){
      ctx.beginPath();
      ctx.setLineDash([3,3]);
      ctx.strokeStyle = '#00274C';
      ctx.lineWidth = 1.5;
      ctx.moveTo(-hw, -3);
      ctx.lineTo(-hw, 3);
      ctx.moveTo(hw, -3);
      ctx.lineTo(hw, 3);
      ctx.moveTo(-hw, 0);
      ctx.lineTo(-hw + (hw*2)*0.3, 0);
      ctx.moveTo(hw, 0);
      ctx.lineTo(hw - (hw*2)*0.3, 0);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.moveTo(-hw + hw*0.4, -3);
      ctx.lineTo(-hw + hw*0.4, 3);
      ctx.strokeStyle = '#666';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawWindowShape(w: Opening){
    ctx.save();
    ctx.translate(w.x || 0, w.y || 0);
    ctx.rotate(w.angle || 0);

    const hw = (w.width || 36) / 2;
    const hh = 4;

    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.rect(-hw-2, -6, (hw+2)*2, 12);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = '#00274C';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-hw, -hh);
    ctx.lineTo(hw, -hh);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-hw, hh);
    ctx.lineTo(hw, hh);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-hw, 0);
    ctx.lineTo(hw, 0);
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 1;
    ctx.setLineDash([2,2]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#00274C';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText((w.width||36)+'"', 0, -hh-3);

    ctx.restore();
  }

  function rotatePt(p: Point, ang: number): Point {
    const c = Math.cos(ang), s = Math.sin(ang);
    return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
  }

  // Rotation-aware asset geometry. Cabinets pivot around their center when
  // drawn, so hit-testing and collision must use the ROTATED footprint —
  // otherwise a turned cabinet's clickable/collision box stays unrotated.
  function rotatedAssetCorners(a: Asset){
    const w = a.width || 24, d = a.depth || 24;
    const hw = w / 2, hd = d / 2;
    const rot = ((a.rotation || 0) * Math.PI) / 180;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    return [
      { x: -hw, y: -hd }, { x: hw, y: -hd }, { x: hw, y: hd }, { x: -hw, y: hd },
    ].map(c => ({ x: a.x + c.x * cos - c.y * sin, y: a.y + c.x * sin + c.y * cos }));
  }

  // True point-in-rotated-rectangle: bring the point into the asset's local
  // (unrotated) frame, then a plain box check.
  function pointInAsset(pos: Point, a: Asset){
    const w = a.width || 24, d = a.depth || 24;
    const rot = ((a.rotation || 0) * Math.PI) / 180;
    const cos = Math.cos(-rot), sin = Math.sin(-rot);
    const dx = pos.x - a.x, dy = pos.y - a.y;
    const lx = dx * cos - dy * sin, ly = dx * sin + dy * cos;
    return Math.abs(lx) <= w / 2 && Math.abs(ly) <= d / 2;
  }

  function getAssetBoundingBox(a: Asset) {
    const c = rotatedAssetCorners(a);
    return {
      minX: Math.min(c[0].x, c[1].x, c[2].x, c[3].x),
      maxX: Math.max(c[0].x, c[1].x, c[2].x, c[3].x),
      minY: Math.min(c[0].y, c[1].y, c[2].y, c[3].y),
      maxY: Math.max(c[0].y, c[1].y, c[2].y, c[3].y),
    };
  }

  function checkAssetCollision(a: Asset): boolean {
    const page = getPage();
    if (!page || !page.assets) return false;
    const boxA = getAssetBoundingBox(a);
    for (const other of page.assets) {
      if (other.id === a.id || other.id === 'ghost') continue;
      const boxOther = getAssetBoundingBox(other);
      const overlap = !(
        boxA.maxX <= boxOther.minX + 2 ||
        boxA.minX >= boxOther.maxX - 2 ||
        boxA.maxY <= boxOther.minY + 2 ||
        boxA.minY >= boxOther.maxY - 2
      );
      if (overlap) return true;
    }
    return false;
  }

  function checkAssetOutOfBounds(a: Asset): boolean {
    const page = getPage();
    if (!page || !page.walls || page.walls.length === 0) return false;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    page.walls.forEach(w => {
      minX = Math.min(minX, w.start.x, w.end.x);
      maxX = Math.max(maxX, w.start.x, w.end.x);
      minY = Math.min(minY, w.start.y, w.end.y);
      maxY = Math.max(maxY, w.start.y, w.end.y);
    });
    const buffer = 48;
    const box = getAssetBoundingBox(a);
    return (box.maxX < minX - buffer || box.minX > maxX + buffer || box.maxY < minY - buffer || box.minY > maxY + buffer);
  }

  const renderAsset = drawAsset;
  function drawAsset(a: Asset){
    ctx.save();
    ctx.translate(a.x, a.y);
    const rotRad = ((a.rotation || 0) * Math.PI) / 180;
    ctx.rotate(rotRad);

    const w = a.width || 24;
    const d = a.depth || 24;
    const hw = w / 2;
    const hd = d / 2;

    const isInvalid = (a.id !== 'ghost') && (checkAssetCollision(a) || checkAssetOutOfBounds(a));
    const isGhostInvalid = (a.id === 'ghost') && checkAssetCollision(a);
    const showRed = isInvalid || isGhostInvalid;

    const isSelected = selectedAssetId === a.id || selectedAssetIds.includes(a.id);

    if (a.type === 'cabinet' || a.category?.includes('Cabinet') || a.category === 'Vanities' || a.category === 'Tall/Utility') {
      if (a.category === 'Upper Cabinets') {
        // Dashed upper wall box
        ctx.fillStyle = showRed ? 'rgba(239, 68, 68, 0.25)' : 'rgba(241, 245, 249, 0.85)';
        ctx.fillRect(-hw, -hd, w, d);
        ctx.strokeStyle = showRed ? '#ef4444' : '#334155';
        ctx.lineWidth = showRed ? 2.5 : 1.5;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(-hw, -hd, w, d);
        ctx.setLineDash([]);

        // Diagonal overhead cross
        ctx.beginPath();
        ctx.moveTo(-hw, -hd); ctx.lineTo(hw, hd);
        ctx.strokeStyle = showRed ? '#ef4444' : '#94a3b8';
        ctx.lineWidth = 1;
        ctx.stroke();
      } else if (a.category === 'Tall/Utility') {
        // Solid utility / pantry box with hatch lines
        ctx.fillStyle = showRed ? 'rgba(239, 68, 68, 0.25)' : '#f8fafc';
        ctx.fillRect(-hw, -hd, w, d);
        ctx.strokeStyle = showRed ? '#ef4444' : '#00274C';
        ctx.lineWidth = showRed ? 2.5 : 2;
        ctx.strokeRect(-hw, -hd, w, d);

        // Double diagonal x
        ctx.beginPath();
        ctx.moveTo(-hw, -hd); ctx.lineTo(hw, hd);
        ctx.moveTo(hw, -hd); ctx.lineTo(-hw, hd);
        ctx.strokeStyle = showRed ? '#ef4444' : '#cbd5e1';
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        // Base Box / Vanity / Island
        ctx.fillStyle = showRed ? 'rgba(239, 68, 68, 0.25)' : '#ffffff';
        ctx.fillRect(-hw, -hd, w, d);
        ctx.strokeStyle = showRed ? '#ef4444' : '#00274C';
        ctx.lineWidth = showRed ? 2.5 : 2;
        ctx.strokeRect(-hw, -hd, w, d);

        // Front countertop lip line
        ctx.beginPath();
        ctx.moveTo(-hw, hd); ctx.lineTo(hw, hd);
        ctx.strokeStyle = showRed ? '#ef4444' : '#E8622C';
        ctx.lineWidth = 3;
        ctx.stroke();

        if (a.category === 'Vanities' || (a.name && a.name.toLowerCase().includes('sink'))) {
          // Draw sink basin oval inside
          ctx.beginPath();
          ctx.ellipse(0, 0, Math.max(2, Math.min(hw - 3, 10)), Math.max(2, Math.min(hd - 3, 7)), 0, 0, Math.PI * 2);
          ctx.strokeStyle = showRed ? '#ef4444' : '#64748b';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }

      // Label
      ctx.font = 'bold 10px sans-serif';
      ctx.fillStyle = showRed ? '#b91c1c' : '#0f172a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(showRed ? '⚠️ WON\'T FIT' : (a.code || a.name || 'CAB'), 0, -2);
      ctx.font = '8px sans-serif';
      ctx.fillStyle = showRed ? '#991b1b' : '#475569';
      ctx.fillText(`${w}"x${d}"` + (a.height ? ` x${a.height}"` : ''), 0, 8);

    } else if (a.type === 'plumbing' || a.category?.includes('Shower') || a.category?.includes('Sinks')) {
      if ((a.name && a.name.toLowerCase().includes('shower')) || a.kneeWallWidth !== undefined || a.enclosureStyle) {
        // WALK-IN SHOWER & ENCLOSURE RENDERING
        ctx.fillStyle = 'rgba(224, 242, 254, 0.4)';
        ctx.fillRect(-hw, -hd, w, d);
        ctx.strokeStyle = '#0284c7';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-hw, -hd, w, d);

        // Helper to draw circular drain grate indicator
        const drawCircularDrainGrate = (dx: number, dy: number, radius: number = 6) => {
          ctx.save();
          ctx.translate(dx, dy);
          ctx.beginPath();
          ctx.arc(0, 0, radius, 0, Math.PI * 2);
          ctx.fillStyle = '#0284c7';
          ctx.fill();
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = 1.25;
          ctx.stroke();

          // Grate crosshair
          ctx.beginPath();
          ctx.moveTo(-radius + 1.5, 0); ctx.lineTo(radius - 1.5, 0);
          ctx.moveTo(0, -radius + 1.5); ctx.lineTo(0, radius - 1.5);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1;
          ctx.stroke();

          // Inner concentric ring
          ctx.beginPath();
          ctx.arc(0, 0, radius * 0.45, 0, Math.PI * 2);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 0.75;
          ctx.stroke();
          ctx.restore();
        };

        // Render Drain
        const dType = a.drainType || 'center';
        if (dType === 'trench_left') {
          // Linear / Trench Drain on Left Edge
          ctx.fillStyle = '#0284c7';
          ctx.fillRect(-hw + 3, -hd + 4, 5, d - 8);
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = 1;
          ctx.strokeRect(-hw + 3, -hd + 4, 5, d - 8);
        } else if (dType === 'trench_right') {
          // Linear / Trench Drain on Right Edge
          ctx.fillStyle = '#0284c7';
          ctx.fillRect(hw - 8, -hd + 4, 5, d - 8);
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = 1;
          ctx.strokeRect(hw - 8, -hd + 4, 5, d - 8);
        } else if (dType === 'trench_back') {
          // Linear / Trench Drain on Back Wall
          ctx.fillStyle = '#0284c7';
          ctx.fillRect(-hw + 4, -hd + 3, w - 8, 5);
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = 1;
          ctx.strokeRect(-hw + 4, -hd + 3, w - 8, 5);
        } else if (dType === 'end_left') {
          // End Point Drain (Left) with circular grate indicator
          drawCircularDrainGrate(-hw + 14, 0, 5.5);
        } else if (dType === 'end_right') {
          // End Point Drain (Right) with circular grate indicator
          drawCircularDrainGrate(hw - 14, 0, 5.5);
        } else {
          // Center Point Drain with circular grate indicator
          drawCircularDrainGrate(0, 0, 6.5);
        }

        // Render Ceiling Rain Head if enabled
        if (a.hasRainHead) {
          ctx.beginPath();
          ctx.arc(0, -2, 8, 0, Math.PI * 2);
          ctx.strokeStyle = '#0284c7';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.fillStyle = 'rgba(2, 132, 199, 0.2)';
          ctx.fill();
          ctx.font = '7px sans-serif';
          ctx.fillStyle = '#0284c7';
          ctx.textAlign = 'center';
          ctx.fillText('RAIN', 0, -1);
        }

        // Render Wall Mounted Shower Head if enabled
        if (a.hasWallHead) {
          ctx.fillStyle = '#0284c7';
          ctx.fillRect(-3, -hd, 6, 4);
        }

        // Enclosure & Knee Wall rendering along bottom front edge
        const kw = a.kneeWallWidth || 0;
        const gd = a.glassDoorWidth || 0;
        const eStyle = a.enclosureStyle || 'kneewall_glass';

        if (eStyle === 'full_wall') {
          // Full-Height Solid Wall
          ctx.beginPath();
          ctx.moveTo(-hw, hd);
          ctx.lineTo(-hw + Math.min(kw > 0 ? kw : w - gd, w), hd);
          ctx.strokeStyle = '#00274C';
          ctx.lineWidth = 8;
          ctx.stroke();
          // Glass door or opening remainder
          if (gd > 0) {
            const doorStart = -hw + Math.min(kw > 0 ? kw : w - gd, w);
            ctx.beginPath();
            ctx.moveTo(doorStart, hd);
            ctx.lineTo(doorStart + Math.min(gd, w - kw), hd);
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 2;
            ctx.setLineDash([3, 2]);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        } else if (eStyle === 'frameless_glass') {
          // Frameless Glass Enclosure
          ctx.beginPath();
          ctx.moveTo(-hw, hd);
          ctx.lineTo(hw, hd);
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 3;
          ctx.stroke();
        } else if (eStyle === 'curbless_open') {
          // Curbless / Open Roll-In
          ctx.beginPath();
          ctx.moveTo(-hw, hd);
          ctx.lineTo(hw, hd);
          ctx.strokeStyle = '#94a3b8';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.stroke();
          ctx.setLineDash([]);
        } else {
          // Default Knee Wall w/ Glass Top
          if (kw > 0 || gd > 0) {
            ctx.beginPath();
            ctx.moveTo(-hw, hd);
            ctx.lineTo(-hw + Math.min(kw, w), hd);
            ctx.strokeStyle = '#0f172a';
            ctx.lineWidth = 5;
            ctx.stroke();

            if (gd > 0) {
              const doorStart = -hw + Math.min(kw, w);
              ctx.beginPath();
              ctx.moveTo(doorStart, hd);
              ctx.lineTo(doorStart + Math.min(gd, w - kw), hd);
              ctx.strokeStyle = '#38bdf8';
              ctx.lineWidth = 2;
              ctx.setLineDash([3, 2]);
              ctx.stroke();
              ctx.setLineDash([]);
            }
          }
        }

        ctx.font = 'bold 9px sans-serif';
        ctx.fillStyle = '#0369a1';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(a.name || 'Shower', 0, 8);
        ctx.font = '8px sans-serif';
        const styleLabel = eStyle === 'full_wall' ? 'Full Wall' : (kw > 0 ? `Knee: ${kw}"` : '');
        ctx.fillText(`${w}"x${d}"` + (styleLabel ? ` (${styleLabel})` : ''), 0, 17);

      } else if (a.name && a.name.toLowerCase().includes('tub')) {
        // TUB RENDERING
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-hw, -hd, w, d);
        ctx.strokeStyle = '#00274C';
        ctx.lineWidth = 2;
        ctx.strokeRect(-hw, -hd, w, d);

        // Tub inner oval
        ctx.beginPath();
        ctx.ellipse(0, 0, Math.max(2, hw - 3), Math.max(2, hd - 3), 0, 0, Math.PI * 2);
        ctx.strokeStyle = '#0284c7';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.font = 'bold 9px sans-serif';
        ctx.fillStyle = '#0f172a';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(a.name || 'Tub', 0, 0);

      } else if (a.name && a.name.toLowerCase().includes('toilet')) {
        // TOILET RENDERING
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(-hw, -hd, w, 8);
        ctx.strokeStyle = '#00274C';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-hw, -hd, w, 8);

        ctx.beginPath();
        ctx.ellipse(0, hd - 8, Math.max(2, hw - 2), Math.max(2, hd - 6), 0, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.stroke();

        ctx.font = '8px sans-serif';
        ctx.fillStyle = '#00274C';
        ctx.textAlign = 'center';
        ctx.fillText('TOILET', 0, hd - 8);

      } else {
        // Sink or General Plumbing
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-hw, -hd, w, d);
        ctx.strokeStyle = '#0284c7';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-hw, -hd, w, d);

        ctx.font = 'bold 9px sans-serif';
        ctx.fillStyle = '#0f172a';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(a.code || a.name || 'PLUMB', 0, 0);
      }

    } else {
      // ELECTRICAL FIXTURE RENDERING
      ctx.fillStyle = '#bbf7d0';
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(8, hw), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#16a34a';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.font = 'bold 10px sans-serif';
      ctx.fillStyle = '#166534';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(a.code || a.icon || '⚡', 0, 0);
    }

    // Draw Selection Box if selected
    if (isSelected) {
      ctx.strokeStyle = '#E8622C';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(-hw - 4, -hd - 4, w + 8, d + 8);
      ctx.setLineDash([]);

      // Corner resize handles — grab to stretch to size (like a wall).
      const hs = 11 / zoom; // constant screen size
      ctx.fillStyle = '#E8622C';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5 / zoom;
      [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].forEach(([cx, cy]) => {
        ctx.beginPath();
        ctx.rect(cx - hs / 2, cy - hs / 2, hs, hs);
        ctx.fill();
        ctx.stroke();
      });

      // Rotation handle
      ctx.beginPath();
      ctx.moveTo(0, -hd - 4);
      ctx.lineTo(0, -hd - 16);
      ctx.strokeStyle = '#E8622C';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(0, -hd - 16, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#E8622C';
      ctx.fill();
    }

    ctx.restore();
  }

  function drawNote(n: Note, index: number){
    ctx.save();
    ctx.translate(n.x, n.y);
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = '#dc2626';
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(index.toString(), 0, 0);

    const snippet = n.text ? (n.text.length > 24 ? n.text.substring(0, 24) + '...' : n.text) : 'Note #' + index;
    ctx.font = '11px sans-serif';
    ctx.save();
    ctx.translate(22, 0);
    const m = ctx.measureText(snippet);
    const pw = m.width + 12;
    const ph = 20;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.shadowColor = 'rgba(0,0,0,0.15)';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    if ((ctx as any).roundRect) {
      (ctx as any).roundRect(0, -ph/2, pw, ph, 4);
    } else {
      ctx.rect(0, -ph/2, pw, ph);
    }
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#1f2937';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(snippet, 6, 0);
    ctx.restore();

    ctx.restore();
  }

  /* ════════════════════════════════════════════════════════════════
     TAKEOFF
     ════════════════════════════════════════════════════════════════ */
  function updateTakeoff(){
    const page=getPage();
    if(!page) return;
    const visibleWalls = currentView==='after' ? page.walls : page.walls.filter(w=>w.wallType!=='new_construction');
    const spacing = parseInt((document.getElementById('stud-spacing') as HTMLSelectElement)?.value)||16;
    const waste = parseFloat((document.getElementById('waste-multiplier') as HTMLInputElement)?.value)||1.10;
    const ceilingH = parseInt((document.getElementById('ceiling-height') as HTMLInputElement)?.value)||96;

    let totalLf=0;
    visibleWalls.forEach(w => { totalLf += wallLength(w); });
    const p = getProject();
    const adj = p?.takeoffAdj || { sqft: 0, trim: 0, studs: 0, drywall: 0 };

    const calcSqFt = totalLf * ceilingH / 144 * waste;
    const totalSqFt = Math.max(0, Math.round(calcSqFt + (adj.sqft || 0))).toString();

    let cabinetLf = 0;
    const cabinetItemsMap: { [code: string]: { code: string; name: string; width: number; depth: number; height?: number; qty: number; totalLf: number } } = {};
    (page.assets || []).forEach(a => {
      if (a.type === 'cabinet' || a.category?.includes('Cabinet') || a.category === 'Vanities' || a.category === 'Tall/Utility') {
        const code = a.code || 'CAB';
        const name = a.name || 'Cabinet';
        const w = a.width || 24;
        const d = a.depth || 24;
        const h = a.height || 32;
        cabinetLf += w / 12;
        if (!cabinetItemsMap[code]) {
          cabinetItemsMap[code] = { code, name, width: w, depth: d, height: h, qty: 0, totalLf: 0 };
        }
        cabinetItemsMap[code].qty++;
        cabinetItemsMap[code].totalLf += w / 12;
      }
    });

    const wallLf = totalLf / 12;
    const trimLf = Math.max(0, Math.round((wallLf - cabinetLf + (adj.trim || 0)) * 10) / 10).toFixed(1);
    const studs = Math.max(0, Math.ceil(totalLf / spacing) + (adj.studs || 0));
    const drywall = Math.max(0, Math.ceil(parseFloat(totalSqFt) / 32) + (adj.drywall || 0));

    const cabListEl = document.getElementById('to-cabinets-list');
    if (cabListEl) {
      const keys = Object.keys(cabinetItemsMap);
      if (keys.length === 0) {
        cabListEl.innerHTML = '<div style="color: #9ca3af; font-style: italic; text-align: center; padding: 8px;">No cabinets placed yet.</div>';
      } else {
        let cabHtml = '<table style="width: 100%; border-collapse: collapse; font-size: 11px;"><thead><tr style="border-bottom: 1px solid rgba(255,255,255,0.2); text-align: left;"><th style="padding: 4px;">Code</th><th style="padding: 4px;">Description</th><th style="padding: 4px;">Size (WxDxH)</th><th style="padding: 4px; text-align: right;">Qty</th></tr></thead><tbody>';
        keys.forEach(k => {
          const item = cabinetItemsMap[k];
          cabHtml += `<tr style="border-bottom: 1px solid rgba(255,255,255,0.05);"><td style="padding: 4px; font-weight: 600;">${item.code}</td><td style="padding: 4px;">${item.name}</td><td style="padding: 4px;">${item.width}" x ${item.depth}"${item.height ? ` x ${item.height}"` : ''}</td><td style="padding: 4px; text-align: right; font-weight: 600;">${item.qty}</td></tr>`;
        });
        cabHtml += '</tbody></table>';
        cabListEl.innerHTML = cabHtml;
      }
    }

    const setEl = (id: string, val: any) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val.toString();
    };

    setEl('to-sqft', totalSqFt);
    setEl('to-trim', trimLf + ' ft');
    setEl('to-studs', studs);
    setEl('to-drywall', drywall);

    const cycles = findRoomCycles();
    let totalRoomSqFt = 0;
    cycles.forEach(pts => { totalRoomSqFt += shoelaceArea(pts) / 144; });
    setEl('to-rooms', totalRoomSqFt.toFixed(0) + ' sq ft');

    if(p){
      p.ceilingH = parseInt((document.getElementById('ceiling-height') as HTMLInputElement)?.value)||96;
      p.studSpacing = parseInt((document.getElementById('stud-spacing') as HTMLSelectElement)?.value)||16;
      p.waste = parseFloat((document.getElementById('waste-multiplier') as HTMLInputElement)?.value)||1.10;
    }
  }

  /* ════════════════════════════════════════════════════════════════
     CANVAS SIZING
     ════════════════════════════════════════════════════════════════ */
  function resizeCanvas(){
    const wrap = document.getElementById('canvas-wrap');
    if(!wrap || !canvas) return;
    const rect = wrap.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    canvasW = rect.width * dpr;
    canvasH = rect.height * dpr;
    canvas.width = canvasW;
    canvas.height = canvasH;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    render();
  }

  /* ════════════════════════════════════════════════════════════════
     UI
     ════════════════════════════════════════════════════════════════ */
  function renderSidebar(){
    const p = getProject();
    // Whatever project is actually loaded is the source of truth for its
    // category/scope — these two globals used to only get set when a project
    // was CREATED (wizard/skip-to-drawing), never when you switched to an
    // EXISTING one. That's why the Category/Scope pills could show "Kitchen"
    // highlighted while a Bathroom project was the one actually open.
    if(p){
      currentCategory = p.category || 'Kitchen';
      currentScope = p.scope || currentScope;
    }
    // No point showing empty Customer/Phone/Email/Address fields and a
    // Wizard/Save row that don't apply to anything yet — with nothing
    // loaded, the "+ New / Open Project" button above is the only thing
    // that should be competing for attention. This section reappears the
    // moment a project actually exists.
    document.getElementById('project-contact-section')?.classList.toggle('hidden', !p);
    updateDriveBackupNudge();

    const custInput = document.getElementById('customer-name') as HTMLInputElement;
    if (custInput) custInput.value = p ? (p.customer || '') : '';
    const phoneInput = document.getElementById('customer-phone') as HTMLInputElement;
    if (phoneInput) phoneInput.value = p ? p.phone || '' : '';
    const emailInput = document.getElementById('customer-email') as HTMLInputElement;
    if (emailInput) emailInput.value = p ? p.email || '' : '';
    const addressInput = document.getElementById('customer-address') as HTMLInputElement;
    if (addressInput) addressInput.value = p ? p.address || '' : '';

    const list = document.getElementById('project-list');
    const searchEl = document.getElementById('project-search') as HTMLInputElement;
    const search = searchEl ? searchEl.value.toLowerCase() : '';
    if (list) {
      list.innerHTML = '';
      projects.filter(pr => !search || pr.name.toLowerCase().includes(search)).forEach(pr => {
        const li = document.createElement('li');
        li.className = pr.id===currentProjectId ? 'active' : '';
        li.innerHTML = '<span>'+pr.name+'</span><span class="project-cat">'+pr.category+'</span><span class="del-project" data-id="'+pr.id+'">&times;</span>';
        li.addEventListener('click', (e)=>{
          const target = e.target as HTMLElement;
          if(target.classList.contains('del-project')){
            if(!window.confirm(`Delete "${pr.name}"? This removes the whole job — walls, photos, notes, everything. Can't be undone.`)) return;
            projects = projects.filter(x=>x.id!==pr.id);
            if(currentProjectId===pr.id){ currentProjectId=projects[0]?.id||null; currentPageIdx=0; }
            save(); renderSidebar(); render(); return;
          }
          currentProjectId = pr.id; currentPageIdx = 0; selectedWallIdx = -1;
          document.getElementById('wall-edit-panel')?.classList.add('hidden');
          selectedOpening = null;
          hideOpeningEdit();
          closeMobileSidebar();
          document.getElementById('project-list')?.classList.remove('open');
          (document.getElementById('project-search') as HTMLInputElement)?.blur();
          renderSidebar(); render();
        });
        list.appendChild(li);
      });
    }

    const tabs = document.getElementById('page-tabs');
    if (tabs) {
      tabs.innerHTML = '';
      if(p){
        p.pages.forEach((pg,i)=>{
          const tab = document.createElement('div');
          tab.className = 'page-tab' + (i===currentPageIdx ? ' active' : '');
          tab.title = 'Tap to switch — double-tap to rename';
          tab.innerHTML = '<span>'+pg.name+'</span>' + (p.pages.length>1 ? '<span class="close-tab" data-i="'+i+'" title="Delete page">&times;</span>' : '');
          tab.addEventListener('click',(e)=>{
            const target = e.target as HTMLElement;
            if(target.classList.contains('close-tab')){
              const idx=parseInt(target.dataset.i || '0');
              if(p.pages.length<=1) return;
              const victim = p.pages[idx];
              if(!window.confirm(`Delete page "${victim.name}"? This removes everything drawn on it — walls, doors, assets, notes. Can't be undone.`)) return;
              p.pages.splice(idx,1);
              if(currentPageIdx>=p.pages.length) currentPageIdx=p.pages.length-1;
              selectedWallIdx=-1; pushHistory(); save(); renderSidebar(); render(); return;
            }
            currentPageIdx=i; selectedWallIdx=-1;
            document.getElementById('wall-edit-panel')?.classList.add('hidden');
            selectedOpening = null;
            hideOpeningEdit();
            closeMobileSidebar();
            renderSidebar(); render();
          });
          tab.addEventListener('dblclick', ()=>{
            const newName = prompt('Rename page:', pg.name);
            if(newName && newName.trim()){
              pg.name = newName.trim();
              save(); renderSidebar();
            }
          });
          tabs.appendChild(tab);
        });
      }
    }

    document.querySelectorAll('#category-list .pill').forEach(el=>{
      const hEl = el as HTMLElement;
      hEl.classList.toggle('active', hEl.dataset.cat===currentCategory);
    });
    document.querySelectorAll('#scope-list .pill').forEach(el=>{
      const hEl = el as HTMLElement;
      hEl.classList.toggle('active', hEl.dataset.scope===currentScope);
    });
    document.querySelectorAll('#view-toggle .pill').forEach(el=>{
      const hEl = el as HTMLElement;
      hEl.classList.toggle('active', hEl.dataset.view===currentView);
    });
    const dimToggle = document.getElementById('show-dimensions-toggle') as HTMLInputElement;
    if (dimToggle) {
      dimToggle.checked = showDimensions;
    }
    const snapToggle = document.getElementById('smart-snapping-toggle') as HTMLInputElement;
    if (snapToggle) {
      snapToggle.checked = smartSnapping;
    }
    document.querySelectorAll('#wall-type-selector .pill').forEach(el=>{
      const hEl = el as HTMLElement;
      hEl.classList.toggle('active', hEl.dataset.wtype===currentWallType);
    });

    const info = document.getElementById('toolbar-info');
    if (info) {
      info.textContent = p ? (p.name + ' — ' + p.pages[currentPageIdx]?.name + ' (' + currentView + ')') : 'No project loaded';
    }

    const page = getPage();
    const ta = document.getElementById('project-notes') as HTMLTextAreaElement;
    if(ta) {
      if(page && page.notes.length){
        ta.value = page.notes.map(n=>n.text).join('\n');
      }
    }

    renderPhotoGallery();
    renderAssetPalette();
    updateConnStatus();
    renderReferenceRail();
  }

  function renderAssetPalette() {
    const container = document.getElementById('asset-palette');
    if (!container) return;

    // Active Category Tabs
    document.querySelectorAll('#asset-cat-tabs .pill').forEach(el => {
      const hEl = el as HTMLElement;
      hEl.classList.toggle('active', hEl.dataset.assetCat === activeAssetCat);
    });

    const filtered = ASSET_CATALOG.filter(item => item.type === activeAssetCat);
    const groups: { [key: string]: AssetPreset[] } = {};
    filtered.forEach(item => {
      groups[item.category] = groups[item.category] || [];
      groups[item.category].push(item);
    });

    let html = '';
    for (const groupName of Object.keys(groups)) {
      html += `<div class="asset-subgroup-title">${groupName}</div>`;
      html += `<div class="asset-grid">`;
      groups[groupName].forEach(preset => {
        const isAct = activePreset && activePreset.code === preset.code && tool === 'place_asset';
        const recD = getRecommendedDepth(preset);
        html += `
          <button class="asset-item-btn ${isAct ? 'active' : ''}" data-code="${preset.code}">
            <span class="asset-item-title">${preset.code} - ${preset.name}</span>
            <span class="asset-item-desc">${preset.width}"W x ${recD}"D${preset.height ? ` x ${preset.height}"H` : ''}</span>
          </button>
        `;
      });
      html += `</div>`;
    }

    container.innerHTML = html;

    // Bind click listeners
    container.querySelectorAll('.asset-item-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const code = (btn as HTMLElement).dataset.code;
        const preset = ASSET_CATALOG.find(p => p.code === code);
        if (preset) {
          activePreset = preset;
          tool = 'place_asset';
          placingAssetRotation = 0;
          toast(`Click canvas to place ${preset.name} (Press 'R' to rotate)`);
          renderSidebar();
          render();
        }
      });
    });
  }

  function showAssetEditModal(asset: Asset) {
    editingAssetId = asset.id;
    const modal = document.getElementById('asset-edit-modal');
    if (!modal) return;

    const titleEl = document.getElementById('asset-modal-title');
    if (titleEl) titleEl.textContent = `Edit ${asset.name || asset.code || 'Asset'} Properties`;

    (document.getElementById('asset-edit-name') as HTMLInputElement).value = asset.name || '';
    (document.getElementById('asset-edit-width') as HTMLInputElement).value = (asset.width || 24).toString();
    (document.getElementById('asset-edit-depth') as HTMLInputElement).value = (asset.depth || 24).toString();
    (document.getElementById('asset-edit-height') as HTMLInputElement).value = (asset.height || 34.5).toString();

    const isShower = asset.type === 'plumbing' || (asset.name && asset.name.toLowerCase().includes('shower')) || asset.kneeWallWidth !== undefined || asset.enclosureStyle;
    const showerFields = document.getElementById('asset-shower-fields');
    if (showerFields) {
      showerFields.classList.toggle('hidden', !isShower);
      (document.getElementById('asset-edit-kneewall') as HTMLInputElement).value = (asset.kneeWallWidth || 0).toString();
      (document.getElementById('asset-edit-glassdoor') as HTMLInputElement).value = (asset.glassDoorWidth || 0).toString();
      (document.getElementById('asset-edit-wallstyle') as HTMLSelectElement).value = asset.enclosureStyle || 'kneewall_glass';
      (document.getElementById('asset-edit-draintype') as HTMLSelectElement).value = asset.drainType || 'center';
      (document.getElementById('asset-edit-rainhead') as HTMLInputElement).checked = !!asset.hasRainHead;
      (document.getElementById('asset-edit-wallhead') as HTMLInputElement).checked = !!asset.hasWallHead;
    }

    const currentRot = asset.rotation || 0;
    const rotPills = document.getElementById('asset-rotation-pills');
    if (rotPills) {
      (rotPills as any)._rot = currentRot;
      rotPills.querySelectorAll('.pill').forEach(p => {
        const r = parseInt((p as HTMLElement).dataset.rot || '0');
        p.classList.toggle('active', r === currentRot);
      });
    }

    modal.classList.remove('hidden');
  }

  function hideAssetModal() {
    document.getElementById('asset-edit-modal')?.classList.add('hidden');
    editingAssetId = null;
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
    renderPhotoGallery();
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

  // Open a photo as a small floating, view-only window. Used by the
  // Reference Rail — at the drawing desk you're pulling info off the photo,
  // not marking it up again. The little ✏️ still hands off to full Photo
  // Booth if something needs fixing — and when that save lands, this
  // re-opens the SAME floating window with the freshly baked image (keeps
  // whatever spot/size you had it parked at) so the new marks actually show
  // up when you drop back down to it, instead of leaving the old photo showing.
  async function viewReferencePhoto(id: string){
    const blob = await fetchPhotoBlob(id);
    if(!blob){ toast('Photo not found'); return; }
    const p = getProject();
    const photo = p?.photos?.find(x => x.id === id);
    openPhotoViewer({
      imageBlob: blob,
      caption: photo?.caption,
      onEdit: () => openPhotoBooth({
        imageBlob: blob,
        onSave: async (out) => {
          await savePhotoBlob(id, out, false);
          viewReferencePhoto(id); // pull the just-saved bytes back into the same floating window
        },
      }),
    });
  }

  // ── Reference Rail ─────────────────────────────────────────────────────
  // A pinned, scrollable panel at the drawing desk showing this page's notes,
  // this project's measurements/specs, and every project photo (tap to
  // mark up) — so nobody has to leave the canvas to check a number or a
  // picture while they draw. Independent of the tool/asset sidebar drawers.
  function renderReferenceRail(){
    const p = getProject();
    const page = getPage();

    const notesEl = document.getElementById('reference-notes');
    if(notesEl){
      const text = (page?.notes || []).map(n => n.text).filter(t => t && t.trim()).join('\n');
      notesEl.textContent = text || 'No notes on this page yet — tap to add one.';
    }

    const specsEl = document.getElementById('reference-specs');
    if(specsEl){
      if(p){
        const ceil = p.ceilingH || 96;
        const spacing = p.studSpacing || 16;
        const waste = p.waste || 1.10;
        specsEl.innerHTML = `Ceiling: ${(ceil/12).toFixed(1)}ft (${ceil}")<br>Studs: ${spacing}" O.C.<br>Waste: ${Math.round((waste-1)*100)}%`;
      } else {
        specsEl.textContent = 'No project selected';
      }
    }

    const photosEl = document.getElementById('reference-photos');
    if(photosEl){
      photosEl.innerHTML = '';
      if(!p || !p.photos || p.photos.length === 0){
        photosEl.innerHTML = '<div style="font-size:11px;color:rgba(255,255,255,0.5);">No photos yet</div>';
      } else {
        p.photos.forEach(photo => {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;background:rgba(255,255,255,0.05);border-radius:6px;padding:4px;';
          row.innerHTML = `
            <img alt="Photo" style="width:56px;height:56px;object-fit:cover;border-radius:4px;flex:none;background:#222;" />
            <span style="font-size:11px;color:#f4f4f2;word-break:break-word;">${photo.caption || '(no caption)'}</span>
          `;
          const img = row.querySelector('img') as HTMLImageElement;
          getDisplayURL(photo).then(url => { if(url && img) img.src = url; });
          row.addEventListener('click', () => viewReferencePhoto(photo.id));
          photosEl.appendChild(row);
        });
      }
    }
  }

  function renderPhotoGallery(){
    const p = getProject();
    const gallery = document.getElementById('photo-gallery');
    if(!gallery) return;
    gallery.innerHTML = '';
    if(!p || !p.photos || p.photos.length === 0){
      gallery.innerHTML = '<div style="grid-column: span 2; font-size: 11px; color: rgba(255,255,255,0.5); text-align: center; padding: 6px;">No photos yet</div>';
      renderReferenceRail();
      return;
    }
    p.photos.forEach(photo => {
      const card = document.createElement('div');
      card.className = 'photo-card';
      card.innerHTML = `
        <img class="photo-thumb" alt="Photo" />
        <input type="text" class="photo-caption-input" value="${photo.caption || ''}" placeholder="Add caption..." data-id="${photo.id}" />
        <button class="photo-delete" data-id="${photo.id}" title="Delete">&times;</button>
      `;
      const img = card.querySelector('.photo-thumb') as HTMLImageElement;
      img.style.cursor = 'pointer';
      img.title = 'Tap to mark up';
      getDisplayURL(photo).then(url => { if (url && img) img.src = url; });
      img.addEventListener('click', () => editExistingPhoto(photo.id));
      card.querySelector('.photo-caption-input')?.addEventListener('input', (e)=>{
        const val = (e.target as HTMLInputElement).value;
        photo.caption = val;
        save();
      });
      card.querySelector('.photo-delete')?.addEventListener('click', ()=>{
        p.photos = p.photos.filter(x => x.id !== photo.id);
        deletePhotoBlob(photo.id);
        save();
        renderPhotoGallery();
        updateStorageMeter();
      });
      gallery.appendChild(card);
    });
    updateStorageMeter();
    renderReferenceRail();
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

  async function openBossReportModal(){
    const p = getProject();
    if(!p) { toast('No project selected'); return; }
    const modal = document.getElementById('boss-report-modal');
    const content = document.getElementById('boss-report-content');
    if(!modal || !content) return;

    const floorplanImg = canvas.toDataURL('image/png');
    const page = getPage();
    let totalLf = 0;
    if(page){
      page.walls.forEach(w => { totalLf += wallLength(w); });
    }
    const ceilingH = p.ceilingH || 96;
    const waste = p.waste || 1.10;
    const spacing = p.studSpacing || 16;
    const adj = p.takeoffAdj || { sqft: 0, trim: 0, studs: 0, drywall: 0 };

    const calcSqFt = totalLf * ceilingH / 144 * waste;
    const totalSqFt = Math.max(0, Math.round(calcSqFt + (adj.sqft || 0))).toString();

    let reportCabinetLf = 0;
    const cabinetItemsMap: { [code: string]: { code: string; name: string; width: number; depth: number; height?: number; qty: number; totalLf: number } } = {};
    if(page && page.assets){
      page.assets.forEach(a => {
        if (a.type === 'cabinet' || a.category?.includes('Cabinet') || a.category === 'Vanities' || a.category === 'Tall/Utility') {
          const code = a.code || 'CAB';
          const name = a.name || 'Cabinet';
          const w = a.width || 24;
          const d = a.depth || 24;
          const h = a.height || 32;
          reportCabinetLf += w / 12;
          if (!cabinetItemsMap[code]) {
            cabinetItemsMap[code] = { code, name, width: w, depth: d, height: h, qty: 0, totalLf: 0 };
          }
          cabinetItemsMap[code].qty++;
          cabinetItemsMap[code].totalLf += w / 12;
        }
      });
    }

    const wallLf = totalLf / 12;
    const trimLf = Math.max(0, Math.round((wallLf - reportCabinetLf + (adj.trim || 0)) * 10) / 10).toFixed(1);
    const studs = Math.max(0, Math.ceil(totalLf / spacing) + (adj.studs || 0));
    const drywall = Math.max(0, Math.ceil(parseFloat(totalSqFt) / 32) + (adj.drywall || 0));

    let cabReportRows = '';
    const cabKeys = Object.keys(cabinetItemsMap);
    if(cabKeys.length === 0){
      cabReportRows = `<tr><td colspan="3" style="text-align: center; color: #6b7280; font-style: italic;">No cabinets placed.</td></tr>`;
    } else {
      cabKeys.forEach(k => {
        const item = cabinetItemsMap[k];
        cabReportRows += `<tr><td><b>${item.code}</b> - ${item.name}</td><td><b>${item.qty} units</b></td><td>Size: ${item.width}"W x ${item.depth}"D${item.height ? ` x ${item.height}"H` : ''} (${item.totalLf.toFixed(1)} LF)</td></tr>`;
      });
    }

    let customRowsHtml = '';
    if(p.customItems && p.customItems.length > 0){
      p.customItems.forEach(ci => {
        customRowsHtml += `<tr><td>${ci.name || 'Custom Item'}</td><td><b>${ci.qty} ${ci.unit}</b></td><td>${ci.notes || 'Field added'}</td></tr>`;
      });
    }

    let html = `
      <div class="report-header">
        <div class="report-title">${p.name}</div>
        <div class="report-meta">
          <div><b>Customer:</b> ${p.customer || 'N/A'}</div>
          <div><b>Category:</b> ${p.category}</div>
          <div><b>Scope:</b> ${p.scope}</div>
          <div><b>Date:</b> ${new Date().toLocaleDateString()}</div>
        </div>
      </div>

      <div class="report-section-title">📐 Floor Plan Layout (${page ? page.name : 'Page 1'})</div>
      <div style="text-align: center; background: #f3f4f6; border-radius: 8px; padding: 8px; border: 1px solid #d1d5db;">
        <img src="${floorplanImg}" style="max-width: 100%; height: auto; max-height: 280px; border-radius: 4px;" alt="Floor Plan Drawing" />
      </div>

      <div class="report-section-title">📊 Material Takeoff Summary</div>
      <table class="report-table">
        <thead>
          <tr><th>Item</th><th>Quantity</th><th>Notes</th></tr>
        </thead>
        <tbody>
          <tr><td>Wall Surface Area</td><td><b>${totalSqFt} sq ft</b></td><td>Inc. waste (${((waste-1)*100).toFixed(0)}%) &amp; ceiling (${ceilingH}")</td></tr>
          <tr><td>Base / Crown Trim (Net of Cabs)</td><td><b>${trimLf} LF</b></td><td>Linear feet</td></tr>
          <tr><td>Wall Studs</td><td><b>${studs} pcs</b></td><td>@ ${spacing}" O.C. spacing</td></tr>
          <tr><td>Drywall Sheets (4x8)</td><td><b>${drywall} boards</b></td><td>Standard 32 sq ft sheets</td></tr>
          ${customRowsHtml}
        </tbody>
      </table>

      <div class="report-section-title">🗄️ Cabinet Order List</div>
      <table class="report-table">
        <thead>
          <tr><th>Cabinet Item / Code</th><th>Quantity</th><th>Dimensions &amp; Notes</th></tr>
        </thead>
        <tbody>
          ${cabReportRows}
        </tbody>
      </table>

      <div class="report-section-title">📝 Field Notes &amp; Observations</div>
      <div style="background: #f9fafb; border: 1px solid #d1d5db; border-radius: 6px; padding: 10px; font-size: 13px; white-space: pre-wrap; min-height: 50px;">${p._notesTa || (page && page.notes.length ? page.notes.map(n=>n.text).join('\n') : 'No notes recorded.')}</div>

      <div class="report-section-title">📷 Work Area Photos (${p.photos ? p.photos.length : 0})</div>
    `;

    if(!p.photos || p.photos.length === 0){
      html += `<p style="font-size: 13px; color: #6b7280; font-style: italic;">No photo attachments recorded.</p>`;
    } else {
      html += `<div class="report-photos-grid">`;
      for(const ph of p.photos){
        const url = await getDisplayURL(ph);
        html += `
          <div class="report-photo-item">
            <img src="${url || ''}" class="report-photo-img" alt="Photo" />
            <div class="report-photo-cap">${ph.caption || 'No caption'} <span style="font-size: 10px; color: #9ca3af; display: block;">${ph.timestamp}</span></div>
          </div>
        `;
      }
      html += `</div>`;
    }

    content.innerHTML = html;
    modal.classList.remove('hidden');
  }

  function updateConnStatus(){
    const el = document.getElementById('conn-status');
    if(!el) return;
    if(navigator.onLine){ el.className='conn-status conn-online'; el.title='Online'; }
    else { el.className='conn-status conn-offline'; el.title='Offline'; }
  }

  /* ════════════════════════════════════════════════════════════════
     EVENT HANDLERS
     ════════════════════════════════════════════════════════════════ */
  let ctxMenuWallIdx = -1;

  function toggleSidebar(forceOpen?: boolean){
    const sb = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (!sb) return;

    const isMobile = window.innerWidth <= 900;
    const isCurrentlyOpen = isMobile ? sb.classList.contains('open') : !sb.classList.contains('collapsed');
    const shouldOpen = forceOpen !== undefined ? forceOpen : !isCurrentlyOpen;

    if (shouldOpen) {
      sb.classList.add('open');
      sb.classList.remove('collapsed');
      if (isMobile) {
        overlay?.classList.remove('hidden');
      } else {
        overlay?.classList.add('hidden');
      }
    } else {
      sb.classList.remove('open');
      sb.classList.add('collapsed');
      overlay?.classList.add('hidden');
    }
    // Chevron points the direction the NEXT tap will do: ‹ (tucks the panel
    // away) while open, › (brings it back) while collapsed — clearer than a
    // static hamburger for something that's purely an in/out toggle.
    const toggleBtn = document.getElementById('btn-toggle-sidebar');
    if (toggleBtn) toggleBtn.innerHTML = shouldOpen ? '&#8249;' : '&#8250;';
    setTimeout(resizeCanvas, 260);
  }

  function closeMobileSidebar(){
    if (window.innerWidth <= 900) {
      toggleSidebar(false);
    }
  }

  // ── New Project Wizard Logic ─────────────────────────────
  let wizStep = 1;
  let wizPreviousProjectId: string | null = null;
  let wizData = {
    customer: '',
    phone: '',
    email: '',
    address: '',
    title: '',
    category: 'Kitchen',
    scope: 'Full Build',
    ceilingH: 96,
    studSpacing: 16,
    wallType: 'existing_to_remain'
  };

  function hydrateWizardFromProject(existing: Project | undefined) {
    wizData = {
      customer: existing?.customer || '',
      phone: existing?.phone || '',
      email: existing?.email || '',
      address: existing?.address || '',
      title: existing ? (existing.name.includes(' - ') ? existing.name.split(' - ').slice(1).join(' - ') : existing.name) : '',
      category: existing?.category || currentCategory || 'Kitchen',
      scope: existing?.scope || currentScope || 'Full Build',
      ceilingH: existing?.ceilingH ?? 96,
      studSpacing: existing?.studSpacing ?? 16,
      wallType: currentWallType || 'existing_to_remain'
    };

    const custEl = document.getElementById('wiz-customer-name') as HTMLInputElement;
    if (custEl) custEl.value = wizData.customer;
    const phoneEl = document.getElementById('wiz-customer-phone') as HTMLInputElement;
    if (phoneEl) phoneEl.value = wizData.phone;
    const emailEl = document.getElementById('wiz-customer-email') as HTMLInputElement;
    if (emailEl) emailEl.value = wizData.email;
    const addressEl = document.getElementById('wiz-customer-address') as HTMLInputElement;
    if (addressEl) addressEl.value = wizData.address;
    const titleEl = document.getElementById('wiz-project-title') as HTMLInputElement;
    if (titleEl) titleEl.value = wizData.title;

    document.querySelectorAll('#wiz-cat-cards .wiz-cat-card').forEach(card => {
      const cat = (card as HTMLElement).dataset.cat;
      card.classList.toggle('active', cat === wizData.category);
    });

    const scopeEl = document.getElementById('wiz-scope') as HTMLSelectElement;
    if (scopeEl) scopeEl.value = wizData.scope;
    const ceilEl = document.getElementById('wiz-ceiling-height') as HTMLSelectElement;
    if (ceilEl) ceilEl.value = wizData.ceilingH.toString();
    const studEl = document.getElementById('wiz-stud-spacing') as HTMLSelectElement;
    if (studEl) studEl.value = wizData.studSpacing.toString();
    const wallTypeEl = document.getElementById('wiz-wall-type') as HTMLSelectElement;
    if (wallTypeEl) wallTypeEl.value = wizData.wallType;

    const editingLabel = document.getElementById('wiz-editing-label');
    if (editingLabel) editingLabel.textContent = existing ? `Editing: ${existing.name}` : 'Starting a new job';
  }

  // Picking a job from the Wizard's "Switch Job" search — same idea as
  // jumpToExistingJob, but stays inside the Wizard instead of closing it,
  // since the whole point here is reviewing/editing that job's details.
  function selectWizardJob(id: string) {
    const p = projects.find(x => x.id === id);
    if (!p) return;
    currentProjectId = p.id;
    currentPageIdx = 0;
    wizStep = 1;
    hydrateWizardFromProject(p);
    document.getElementById('wiz-job-search-panel')?.classList.add('hidden');
    renderWizardStep();
    renderSidebar();
  }

  function openWizardModal() {
    wizStep = 1;
    // If a project's already open, the Wizard is EDITING it, not starting a
    // fresh one — pull its real values in instead of handing back a blank
    // form. (This used to always reset to blank, which is why Wizard looked
    // "broken" any time you opened it on an existing job.)
    hydrateWizardFromProject(getProject());
    document.getElementById('wiz-job-search-panel')?.classList.add('hidden');
    const searchInput = document.getElementById('wiz-job-search') as HTMLInputElement;
    if (searchInput) searchInput.value = '';

    renderWizardStep();
    document.getElementById('project-wizard-modal')?.classList.remove('hidden');
  }

  function closeWizardModal() {
    // If "Start a New Job" was tapped but never finished, don't strand the
    // app on "no project loaded" — go back to whatever was open before.
    if (!currentProjectId && wizPreviousProjectId) {
      currentProjectId = wizPreviousProjectId;
      renderSidebar();
      render();
    }
    wizPreviousProjectId = null;
    document.getElementById('project-wizard-modal')?.classList.add('hidden');
  }

  function renderWizardStep() {
    document.querySelectorAll('.wizard-step-indicator').forEach(ind => {
      const s = parseInt((ind as HTMLElement).dataset.step || '1');
      ind.classList.toggle('active', s === wizStep);
      ind.classList.toggle('completed', s < wizStep);
    });

    for (let i = 1; i <= 4; i++) {
      const stepEl = document.getElementById(`wizard-step-${i}`);
      if (stepEl) {
        stepEl.classList.toggle('hidden', i !== wizStep);
      }
    }

    const backBtn = document.getElementById('wiz-btn-back');
    const nextBtn = document.getElementById('wiz-btn-next');
    const finishBtn = document.getElementById('wiz-btn-finish');

    if (backBtn) backBtn.style.visibility = wizStep === 1 ? 'hidden' : 'visible';
    if (nextBtn) nextBtn.classList.toggle('hidden', wizStep === 4);
    if (finishBtn) finishBtn.classList.toggle('hidden', wizStep !== 4);

    if (wizStep === 4) {
      const custName = wizData.customer.trim() || 'New Client';
      const projTitle = wizData.title.trim() || `${wizData.category} Project`;

      const elCust = document.getElementById('wiz-confirm-customer');
      if (elCust) elCust.textContent = custName;

      const elTitle = document.getElementById('wiz-confirm-title');
      if (elTitle) elTitle.textContent = projTitle;

      const elCatScope = document.getElementById('wiz-confirm-catscope');
      if (elCatScope) elCatScope.textContent = `${wizData.category} • ${wizData.scope}`;

      const elSpecs = document.getElementById('wiz-confirm-specs');
      if (elSpecs) elSpecs.textContent = `${wizData.ceilingH / 12}ft (${wizData.ceilingH}") Ceiling, ${wizData.studSpacing}" O.C. Studs`;

      const elSummaryCat = document.getElementById('wiz-summary-cat');
      if (elSummaryCat) elSummaryCat.textContent = wizData.category;
    }
  }

  function finishWizard() {
    const custName = wizData.customer.trim() || 'New Client';
    const projTitle = wizData.title.trim() || `${wizData.category} Area`;
    const fullProjName = `${custName} - ${projTitle}`;

    // EDIT existing project if one's open — the Wizard used to always spin
    // up a brand new project here, silently leaving your real one untouched
    // and landing you on an empty duplicate. Only create new when there's
    // genuinely nothing open yet.
    const existing = getProject();
    const p = existing || newProject(fullProjName, wizData.category);

    p.name = fullProjName;
    p.customer = custName;
    p.phone = wizData.phone;
    p.email = wizData.email;
    p.address = wizData.address;
    p.category = wizData.category;
    p.scope = wizData.scope;
    p.ceilingH = wizData.ceilingH;
    p.studSpacing = wizData.studSpacing;

    currentCategory = wizData.category;
    currentScope = wizData.scope;
    currentWallType = wizData.wallType;

    if (wizData.category === 'Bathroom') {
      activeAssetCat = 'plumbing';
    } else if (wizData.category === 'Kitchen') {
      activeAssetCat = 'cabinets';
    } else {
      activeAssetCat = 'cabinets';
    }

    if (!existing) {
      projects.push(p);
      currentPageIdx = 0;
    }
    currentProjectId = p.id;

    pushHistory();
    save();
    renderSidebar();
    render();
    closeWizardModal();
    toast(existing ? `✅ "${projTitle}" updated for ${custName}!` : `🎉 "${projTitle}" created for ${custName}!`);
  }

  // Shared "arrive at the drawing desk" landing sequence — used by both a
  // brand-new blank project (needs the tools/catalog open, nothing in the
  // rail yet) and jumping to an EXISTING job (skip the tool-drawer forcing,
  // but open the reference rail since that's the whole point — the info's
  // already there, waiting).
  function landOnDrawingDesk(opts: { openTools?: boolean; openRail?: boolean }) {
    pushHistory();
    save();
    renderSidebar();
    render();
    if (opts.openTools) {
      const openIfClosed = (contentId: string, btnId: string) => {
        const content = document.getElementById(contentId);
        if (content?.classList.contains('hidden')) (document.getElementById(btnId) as HTMLElement)?.click();
      };
      openIfClosed('tools-drawer-content', 'btn-tools-drawer');
      openIfClosed('assets-drawer-content', 'btn-assets-drawer');
    }
    closeMobileSidebar(); // on phone/small tablet, drop the sidebar so the canvas is front and center
    if (opts.openRail) {
      document.getElementById('reference-rail')?.classList.remove('hidden');
      renderReferenceRail();
    }
  }

  // Bypasses the whole intro/wizard: pick a category → blank project →
  // straight to canvas with the drawing tools and matching catalog already
  // open. Built for anyone (kitchen designer, or bath-focused you/boss) who's
  // just laying out from known numbers and has zero use for client-info/notes.
  //
  // Category → asset-tab mapping lives in one place (CATEGORY_ASSET_MAP) so
  // adding Deck / Pole Barn / Addition later is just: (1) a new button in the
  // #skip-category-cards grid in App.tsx, (2) a new entry here.
  const CATEGORY_ASSET_MAP: Record<string, string> = {
    'Bathroom': 'plumbing',
    'Kitchen': 'cabinet',
    // 'Deck': 'custom',
    // 'Pole Barn': 'custom',
    // 'Addition': 'cabinet',
  };

  function openSkipCategoryModal() {
    renderSkipExistingJobsList();
    document.getElementById('skip-category-modal')?.classList.remove('hidden');
  }
  function closeSkipCategoryModal() {
    document.getElementById('skip-category-modal')?.classList.add('hidden');
  }

  // Shared searchable job-picker — one row-rendering implementation reused
  // by Skip to Drawing's "jump to an existing job" list AND the Wizard's
  // "switch job" panel, instead of two near-identical copies drifting apart.
  function renderJobPickerList(listEl: HTMLElement, searchTerm: string, onSelect: (id: string) => void, excludeId?: string) {
    listEl.innerHTML = '';
    const term = searchTerm.trim().toLowerCase();
    const filtered = projects
      .filter(p => !excludeId || p.id !== excludeId)
      .filter(p => !term || p.name.toLowerCase().includes(term))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (filtered.length === 0) {
      const msg = projects.length === 0 ? 'No jobs yet — start one above' : 'No jobs match that search';
      listEl.innerHTML = `<div style="font-size:12px;color:#64748b;text-align:center;padding:14px 0;">${msg}</div>`;
      return;
    }
    filtered.forEach(p => {
      const photoCount = p.photos?.length || 0;
      const noteCount = p.pages.reduce((sum, pg) => sum + (pg.notes?.length || 0), 0);
      const row = document.createElement('button');
      row.className = 'skip-existing-job-row';
      row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;text-align:left;width:100%;padding:10px;border-radius:8px;background:#f8fafc;border:1px solid var(--border);color:#1e293b;cursor:pointer;';
      row.innerHTML = `
        <div style="min-width:0;">
          <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.name}</div>
          <div style="font-size:11px;color:#64748b;margin-top:2px;">${p.category} &middot; ${photoCount} photo${photoCount === 1 ? '' : 's'} &middot; ${noteCount} note${noteCount === 1 ? '' : 's'}</div>
        </div>
        <span style="opacity:0.5;flex:none;">&rsaquo;</span>
      `;
      row.addEventListener('click', () => onSelect(p.id));
      listEl.appendChild(row);
    });
  }

  // The "Or jump to an existing job" list inside the Skip to Drawing popup —
  // this is the desk-side use case: you already collected a couple jobs in
  // the field (notes/photos/measurements are already there), you just don't
  // want to hunt through the sidebar list to find the right one.
  function renderSkipExistingJobsList() {
    const listEl = document.getElementById('skip-existing-jobs-list');
    if (!listEl) return;
    const searchInput = document.getElementById('skip-job-search') as HTMLInputElement;
    renderJobPickerList(listEl, searchInput?.value || '', jumpToExistingJob);
  }

  // Land on an existing job's canvas — same reset the sidebar project-list
  // click does (deselect wall/opening, close mobile sidebar) — with the
  // reference rail already open since that's the whole point of this path.
  function jumpToExistingJob(id: string) {
    const p = projects.find(x => x.id === id);
    if (!p) return;
    currentProjectId = p.id;
    currentPageIdx = 0;
    selectedWallIdx = -1;
    document.getElementById('wall-edit-panel')?.classList.add('hidden');
    selectedOpening = null;
    hideOpeningEdit();
    closeSkipCategoryModal();
    landOnDrawingDesk({ openTools: false, openRail: true });
    toast(`📂 ${p.name}`);
  }

  function skipToDrawing(category: string) {
    const p = newProject(`New ${category} Project`, category);
    currentCategory = category;
    activeAssetCat = CATEGORY_ASSET_MAP[category] || 'cabinet';

    projects.push(p);
    currentProjectId = p.id;
    currentPageIdx = 0;

    landOnDrawingDesk({ openTools: true, openRail: false });
    toast(`🎨 Blank ${category} project ready — start drawing`);
  }

  function initEvents(){
    canvas.addEventListener('mousedown', onCanvasDown);
    canvas.addEventListener('mousemove', onCanvasMove);
    canvas.addEventListener('mouseup', onCanvasUp);
    canvas.addEventListener('contextmenu', onContextMenu);

    canvas.addEventListener('touchstart', onTouchStart, {passive:false});
    canvas.addEventListener('touchmove', onTouchMove, {passive:false});
    canvas.addEventListener('touchend', onTouchEnd);

    canvas.addEventListener('wheel', onWheel, {passive:false});

    document.addEventListener('keydown', onKeyDown);

    document.getElementById('btn-open-wizard')?.addEventListener('click', ()=>{
      openWizardModal();
    });
    document.getElementById('btn-skip-to-drawing')?.addEventListener('click', ()=>{
      openSkipCategoryModal();
    });
    document.getElementById('skip-category-close-x')?.addEventListener('click', closeSkipCategoryModal);
    document.getElementById('skip-category-cards')?.addEventListener('click', e => {
      const target = e.target as HTMLElement;
      const card = target.closest('.skip-cat-card') as HTMLElement;
      if (!card) return;
      const cat = card.dataset.skipCat || 'Bathroom';
      closeSkipCategoryModal();
      skipToDrawing(cat);
    });

    // Reference rail: pull-tab open, X close. Measurement fields refresh the
    // rail's specs line live (notes/photos already refresh via their own
    // save paths above).
    document.getElementById('reference-rail-tab')?.addEventListener('click', () => {
      document.getElementById('reference-rail')?.classList.remove('hidden');
      renderReferenceRail();
    });
    document.getElementById('reference-rail-close')?.addEventListener('click', () => {
      document.getElementById('reference-rail')?.classList.add('hidden');
    });
    ['ceiling-height', 'stud-spacing', 'waste-multiplier'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', renderReferenceRail);
    });
    document.getElementById('btn-toolbar-wizard')?.addEventListener('click', ()=>{
      openWizardModal();
    });
    document.getElementById('wizard-modal-close-x')?.addEventListener('click', closeWizardModal);
    document.getElementById('wiz-btn-cancel')?.addEventListener('click', closeWizardModal);
    document.getElementById('project-wizard-modal')?.addEventListener('click', (e) => {
      if((e.target as HTMLElement).id === 'project-wizard-modal') closeWizardModal();
    });

    document.getElementById('wiz-cat-cards')?.addEventListener('click', e => {
      const target = e.target as HTMLElement;
      const card = target.closest('.wiz-cat-card') as HTMLElement;
      if (!card) return;
      document.querySelectorAll('#wiz-cat-cards .wiz-cat-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      wizData.category = card.dataset.cat || 'Kitchen';
    });

    document.getElementById('wiz-btn-back')?.addEventListener('click', () => {
      wizStep = Math.max(1, wizStep - 1);
      renderWizardStep();
    });

    document.getElementById('wiz-btn-next')?.addEventListener('click', () => {
      if (wizStep === 1) {
        wizData.customer = (document.getElementById('wiz-customer-name') as HTMLInputElement).value;
        wizData.phone = (document.getElementById('wiz-customer-phone') as HTMLInputElement).value;
        wizData.email = (document.getElementById('wiz-customer-email') as HTMLInputElement).value;
        wizData.address = (document.getElementById('wiz-customer-address') as HTMLInputElement).value;
        wizData.title = (document.getElementById('wiz-project-title') as HTMLInputElement).value;
      } else if (wizStep === 3) {
        wizData.scope = (document.getElementById('wiz-scope') as HTMLSelectElement).value;
        wizData.ceilingH = parseFloat((document.getElementById('wiz-ceiling-height') as HTMLSelectElement).value) || 96;
        wizData.studSpacing = parseInt((document.getElementById('wiz-stud-spacing') as HTMLSelectElement).value) || 16;
        wizData.wallType = (document.getElementById('wiz-wall-type') as HTMLSelectElement).value;
      }
      wizStep = Math.min(4, wizStep + 1);
      renderWizardStep();
    });

    document.getElementById('wiz-btn-finish')?.addEventListener('click', () => {
      finishWizard();
    });
    document.getElementById('btn-save-project')?.addEventListener('click', ()=>{
      save(); toast('Saved');
    });
    document.getElementById('project-search')?.addEventListener('input', ()=> renderSidebar());
    document.getElementById('project-search')?.addEventListener('focus', () => {
      document.getElementById('project-list')?.classList.add('open');
    });
    document.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('.project-search-wrap')) {
        document.getElementById('project-list')?.classList.remove('open');
      }
    });
    document.getElementById('skip-job-search')?.addEventListener('input', ()=> renderSkipExistingJobsList());

    document.getElementById('wiz-btn-switch-job')?.addEventListener('click', () => {
      const panel = document.getElementById('wiz-job-search-panel');
      const isHidden = panel?.classList.contains('hidden');
      panel?.classList.toggle('hidden');
      if (isHidden) {
        const searchInput = document.getElementById('wiz-job-search') as HTMLInputElement;
        if (searchInput) searchInput.value = '';
        const listEl = document.getElementById('wiz-job-search-list');
        if (listEl) renderJobPickerList(listEl, '', selectWizardJob, currentProjectId || undefined);
        searchInput?.focus();
      }
    });
    document.getElementById('wiz-job-search')?.addEventListener('input', (e) => {
      const listEl = document.getElementById('wiz-job-search-list');
      if (listEl) renderJobPickerList(listEl, (e.target as HTMLInputElement).value, selectWizardJob, currentProjectId || undefined);
    });
    // Detach from whatever project was active and open the Wizard in
    // blank-form mode — shared by the button inside the Wizard's own
    // Switch Job panel AND the "Full Setup Wizard" link on the Skip to
    // Drawing / New Project modal, so there's one real definition of
    // "start fresh," not two that could drift apart.
    function startNewJobInWizard() {
      wizPreviousProjectId = currentProjectId;
      currentProjectId = null;
      wizStep = 1;
      hydrateWizardFromProject(undefined);
      document.getElementById('wiz-job-search-panel')?.classList.add('hidden');
      renderWizardStep();
      document.getElementById('project-wizard-modal')?.classList.remove('hidden');
    }
    document.getElementById('wiz-btn-new-job')?.addEventListener('click', startNewJobInWizard);
    document.getElementById('skip-btn-full-setup')?.addEventListener('click', () => {
      closeSkipCategoryModal();
      startNewJobInWizard();
    });

    document.getElementById('btn-send-job')?.addEventListener('click', sendCurrentJob);
    document.getElementById('btn-open-job')?.addEventListener('click', ()=>{
      document.getElementById('job-file-input')?.click();
    });
    document.getElementById('job-file-input')?.addEventListener('change', e=>{
      const file = (e.target as HTMLInputElement).files?.[0];
      (e.target as HTMLInputElement).value = '';
      if(file) openJobFile(file);
    });

    document.getElementById('btn-add-page')?.addEventListener('click', ()=>{
      const p = getProject(); if(!p) return;
      const name = prompt('Page name:', 'Page '+(p.pages.length+1));
      if(!name) return;
      p.pages.push(newPage(name));
      currentPageIdx = p.pages.length - 1;
      pushHistory(); save(); renderSidebar(); render();
    });
    document.getElementById('btn-duplicate-page')?.addEventListener('click', ()=>{
      const p = getProject(); if(!p) return;
      const src = getPage(); if(!src) return;
      // Copies the STRUCTURAL stuff (walls/doors/windows) since that's the
      // room shape, shared no matter which trade you're drawing next.
      // Assets/notes are left empty — those are trade-specific, and carrying
      // a Plumbing page's fixtures onto a fresh Electrical page would just
      // be clutter, not a head start.
      const copy: Page = {
        id: uid(),
        name: src.name + ' (copy)',
        walls: JSON.parse(JSON.stringify(src.walls)),
        doors: JSON.parse(JSON.stringify(src.doors)),
        windows: JSON.parse(JSON.stringify(src.windows)),
        assets: [],
        notes: [],
        history: [], historyIdx: -1,
      };
      p.pages.push(copy);
      currentPageIdx = p.pages.length - 1;
      selectedWallIdx = -1;
      pushHistory(); save(); renderSidebar(); render();
      toast(`⧉ Duplicated as "${copy.name}" — same room, add your own notes/assets`);
    });

    document.getElementById('view-toggle')?.addEventListener('click', e=>{
      const target = e.target as HTMLElement;
      const pill = target.closest('.pill') as HTMLElement; if(!pill) return;
      currentView = pill.dataset.view || 'after'; renderSidebar(); render();
    });

    document.getElementById('show-dimensions-toggle')?.addEventListener('change', e=>{
      showDimensions = (e.target as HTMLInputElement).checked;
      render();
    });

    document.getElementById('smart-snapping-toggle')?.addEventListener('change', e=>{
      smartSnapping = (e.target as HTMLInputElement).checked;
      if (!smartSnapping) {
        activeGuidelines = [];
        render();
      }
    });

    document.getElementById('category-list')?.addEventListener('click', e=>{
      const target = e.target as HTMLElement;
      const pill = target.closest('.pill') as HTMLElement; if(!pill) return;
      currentCategory = pill.dataset.cat || 'Kitchen';
      const p = getProject(); if(p) p.category = currentCategory;
      renderSidebar(); save();
    });

    document.getElementById('scope-list')?.addEventListener('click', e=>{
      const target = e.target as HTMLElement;
      const pill = target.closest('.pill') as HTMLElement; if(!pill) return;
      currentScope = pill.dataset.scope || 'Full Build';
      const p = getProject(); if(p) p.scope = currentScope;
      renderSidebar(); save();
    });

    document.getElementById('wall-type-selector')?.addEventListener('click', e=>{
      const target = e.target as HTMLElement;
      const pill = target.closest('.pill') as HTMLElement; if(!pill) return;
      currentWallType = pill.dataset.wtype || 'new_construction';
      renderSidebar();
    });

    document.getElementById('btn-draw-wall')?.addEventListener('click', function(){ setTool('wall'); });
    document.getElementById('btn-select')?.addEventListener('click', function(){ setTool('select'); });
    document.getElementById('btn-rect-select')?.addEventListener('click', function(){ setTool('rect_select'); });
    document.getElementById('btn-place-door')?.addEventListener('click', function(){ setTool('door'); });
    document.getElementById('btn-place-window')?.addEventListener('click', function(){ setTool('window'); });

    document.getElementById('btn-undo')?.addEventListener('click', undo);
    document.getElementById('btn-redo')?.addEventListener('click', redo);

    document.getElementById('btn-reset-view')?.addEventListener('click', ()=>{
      const startPanX = panX;
      const startPanY = panY;
      const startZoom = zoom;
      const targetPanX = 0;
      const targetPanY = 0;
      const targetZoom = 1;
      const duration = 350;
      const startTime = performance.now();

      function animateReset(now: number) {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / duration);
        const ease = 1 - (1 - progress) * (1 - progress);

        panX = startPanX + (targetPanX - startPanX) * ease;
        panY = startPanY + (targetPanY - startPanY) * ease;
        zoom = startZoom + (targetZoom - startZoom) * ease;

        const zoomEl = document.getElementById('toolbar-zoom');
        if (zoomEl) zoomEl.textContent = Math.round(zoom * 100) + '%';
        render();

        if (progress < 1) {
          requestAnimationFrame(animateReset);
        }
      }
      requestAnimationFrame(animateReset);
    });

    const toggleBtn = document.getElementById('btn-toggle-sidebar');
    if (toggleBtn) {
      toggleBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleSidebar();
      };
    }

    const closeBtn = document.getElementById('sidebar-close');
    if (closeBtn) {
      closeBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleSidebar(false);
      };
    }

    const overlayEl = document.getElementById('sidebar-overlay');
    if (overlayEl) {
      overlayEl.onclick = (e) => {
        e.preventDefault();
        toggleSidebar(false);
      };
    }

    document.getElementById('asset-cat-tabs')?.addEventListener('click', e => {
      const target = e.target as HTMLElement;
      const pill = target.closest('.pill') as HTMLElement;
      if (!pill) return;
      activeAssetCat = pill.dataset.assetCat || 'cabinets';
      renderSidebar();
    });

    document.getElementById('asset-modal-close-x')?.addEventListener('click', hideAssetModal);
    document.getElementById('asset-modal-cancel')?.addEventListener('click', hideAssetModal);

    document.getElementById('asset-rotation-pills')?.addEventListener('click', e => {
      const target = e.target as HTMLElement;
      const pill = target.closest('.pill') as HTMLElement;
      if (!pill) return;
      const rot = parseInt(pill.dataset.rot || '0');
      document.querySelectorAll('#asset-rotation-pills .pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const rotContainer = document.getElementById('asset-rotation-pills');
      if (rotContainer) (rotContainer as any)._rot = rot;
    });

    document.getElementById('asset-modal-save')?.addEventListener('click', () => {
      if (!editingAssetId) return;
      const page = getPage();
      if (!page) return;
      const asset = page.assets.find(a => a.id === editingAssetId);
      if (!asset) return;

      const nameVal = (document.getElementById('asset-edit-name') as HTMLInputElement).value;
      const wVal = parseFloat((document.getElementById('asset-edit-width') as HTMLInputElement).value);
      const dVal = parseFloat((document.getElementById('asset-edit-depth') as HTMLInputElement).value);
      const hVal = parseFloat((document.getElementById('asset-edit-height') as HTMLInputElement).value);
      const kwVal = parseFloat((document.getElementById('asset-edit-kneewall') as HTMLInputElement).value);
      const gdVal = parseFloat((document.getElementById('asset-edit-glassdoor') as HTMLInputElement).value);
      const eStyleVal = (document.getElementById('asset-edit-wallstyle') as HTMLSelectElement).value as any;
      const drainTypeVal = (document.getElementById('asset-edit-draintype') as HTMLSelectElement).value as any;
      const rainHeadVal = (document.getElementById('asset-edit-rainhead') as HTMLInputElement).checked;
      const wallHeadVal = (document.getElementById('asset-edit-wallhead') as HTMLInputElement).checked;
      const rotContainer = document.getElementById('asset-rotation-pills');
      const rotVal = (rotContainer as any)?._rot ?? asset.rotation ?? 0;

      if (nameVal) asset.name = nameVal;
      if (!isNaN(wVal) && wVal > 0) asset.width = wVal;
      if (!isNaN(dVal) && dVal > 0) asset.depth = dVal;
      if (!isNaN(hVal) && hVal > 0) asset.height = hVal;
      if (!isNaN(kwVal)) asset.kneeWallWidth = kwVal;
      if (!isNaN(gdVal)) asset.glassDoorWidth = gdVal;
      asset.enclosureStyle = eStyleVal;
      asset.drainType = drainTypeVal;
      asset.hasRainHead = rainHeadVal;
      asset.hasWallHead = wallHeadVal;
      asset.rotation = rotVal;

      pushHistory();
      saveAndRender();
      hideAssetModal();
      toast('Asset updated');
    });

    document.getElementById('asset-modal-delete')?.addEventListener('click', () => {
      if (!editingAssetId) return;
      const page = getPage();
      if (!page) return;
      page.assets = page.assets.filter(a => a.id !== editingAssetId);
      selectedAssetId = null;
      editingAssetId = null;
      pushHistory();
      saveAndRender();
      hideAssetModal();
      toast('Asset deleted');
    });

    document.getElementById('btn-help')?.addEventListener('click', ()=>{
      document.getElementById('help-modal')?.classList.remove('hidden');
    });
    document.getElementById('help-modal-close')?.addEventListener('click', ()=>{
      document.getElementById('help-modal')?.classList.add('hidden');
    });
    document.querySelectorAll('.help-link').forEach(link=>{
      link.addEventListener('click', e=>{
        e.preventDefault();
        const target = document.querySelector(link.getAttribute('href') || '');
        if(target) target.scrollIntoView({behavior:'smooth'});
      });
    });

    // ── Photo capture + Photo Booth markup ────────────────────────────────
    // A newly captured/selected file opens the booth right away — mark it up or
    // just save it. Nothing is forced. (savePhotoBlob/editExistingPhoto are
    // defined at init scope so the gallery can reach them too.)
    function onPhotoFile(file: File){
      const id = uid();
      openPhotoBooth({ imageBlob: file, onSave: (blob) => savePhotoBlob(id, blob, true) });
    }

    const camInput = document.getElementById('photo-input-camera') as HTMLInputElement;
    const galInput = document.getElementById('photo-input-gallery') as HTMLInputElement;
    const chooser  = document.getElementById('photo-source-chooser');
    document.getElementById('btn-add-photo')?.addEventListener('click', () => {
      chooser?.classList.toggle('hidden');
    });
    document.getElementById('btn-photo-camera')?.addEventListener('click', () => {
      chooser?.classList.add('hidden'); camInput?.click();
    });
    document.getElementById('btn-photo-gallery')?.addEventListener('click', () => {
      chooser?.classList.add('hidden'); galInput?.click();
    });
    [camInput, galInput].forEach(input => {
      input?.addEventListener('change', e => {
        const file = (e.target as HTMLInputElement).files?.[0];
        (e.target as HTMLInputElement).value = '';
        if(file) onPhotoFile(file);
      });
    });

    document.getElementById('btn-export-boss')?.addEventListener('click', openBossReportModal);

    function openTakeoffEditModal(){
      const p = getProject();
      if(!p) { toast('No project selected'); return; }
      const modal = document.getElementById('takeoff-edit-modal');
      if(!modal) return;
      const adj = p.takeoffAdj || { sqft: 0, trim: 0, studs: 0, drywall: 0 };
      (document.getElementById('edit-adj-sqft') as HTMLInputElement).value = adj.sqft ? adj.sqft.toString() : '';
      (document.getElementById('edit-adj-trim') as HTMLInputElement).value = adj.trim ? adj.trim.toString() : '';
      (document.getElementById('edit-adj-studs') as HTMLInputElement).value = adj.studs ? adj.studs.toString() : '';
      (document.getElementById('edit-adj-drywall') as HTMLInputElement).value = adj.drywall ? adj.drywall.toString() : '';

      renderCustomItemsEditor();
      modal.classList.remove('hidden');
    }

    function renderCustomItemsEditor(){
      const p = getProject();
      if(!p) return;
      const listEl = document.getElementById('custom-items-list');
      if(!listEl) return;
      listEl.innerHTML = '';
      if(!p.customItems) p.customItems = [];
      if(p.customItems.length === 0){
        listEl.innerHTML = `<div style="font-size: 12px; color: #6b7280; font-style: italic;">No custom line items added yet.</div>`;
        return;
      }
      p.customItems.forEach((item, idx) => {
        const row = document.createElement('div');
        row.style.cssText = 'display: grid; grid-template-columns: 2fr 1fr 1fr 1fr auto; gap: 6px; align-items: center;';
        row.innerHTML = `
          <input type="text" class="ci-name input-field" data-idx="${idx}" value="${item.name || ''}" placeholder="Item Name" style="padding: 4px; font-size: 12px; border: 1px solid #d1d5db; border-radius: 4px; background: #fff; color: #1f2937;" />
          <input type="number" class="ci-qty input-field" data-idx="${idx}" value="${item.qty ?? 1}" placeholder="Qty" style="padding: 4px; font-size: 12px; border: 1px solid #d1d5db; border-radius: 4px; background: #fff; color: #1f2937;" />
          <input type="text" class="ci-unit input-field" data-idx="${idx}" value="${item.unit || 'pcs'}" placeholder="Unit" style="padding: 4px; font-size: 12px; border: 1px solid #d1d5db; border-radius: 4px; background: #fff; color: #1f2937;" />
          <input type="text" class="ci-notes input-field" data-idx="${idx}" value="${item.notes || ''}" placeholder="Notes" style="padding: 4px; font-size: 12px; border: 1px solid #d1d5db; border-radius: 4px; background: #fff; color: #1f2937;" />
          <button type="button" class="btn btn-sm ci-del" data-idx="${idx}" style="background: #ef4444; color: #fff; border: none; padding: 2px 6px; border-radius: 4px; cursor: pointer;">&times;</button>
        `;
        listEl.appendChild(row);
      });

      listEl.querySelectorAll('.ci-del').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const idx = parseInt((e.target as HTMLElement).dataset.idx || '0');
          p.customItems?.splice(idx, 1);
          renderCustomItemsEditor();
        });
      });
    }

    document.getElementById('btn-edit-takeoff')?.addEventListener('click', openTakeoffEditModal);
    document.getElementById('btn-add-custom-item')?.addEventListener('click', () => {
      const p = getProject();
      if(!p) return;
      if(!p.customItems) p.customItems = [];
      p.customItems.push({ id: uid(), name: '', qty: 1, unit: 'pcs', notes: '' });
      renderCustomItemsEditor();
    });

    document.getElementById('takeoff-modal-close-x')?.addEventListener('click', () => {
      document.getElementById('takeoff-edit-modal')?.classList.add('hidden');
    });
    document.getElementById('takeoff-modal-cancel')?.addEventListener('click', () => {
      document.getElementById('takeoff-edit-modal')?.classList.add('hidden');
    });
    document.getElementById('takeoff-edit-modal')?.addEventListener('click', (e) => {
      if(e.target === document.getElementById('takeoff-edit-modal')) {
        document.getElementById('takeoff-edit-modal')?.classList.add('hidden');
      }
    });
    document.getElementById('takeoff-modal-save')?.addEventListener('click', () => {
      const p = getProject();
      if(!p) return;
      p.takeoffAdj = {
        sqft: parseFloat((document.getElementById('edit-adj-sqft') as HTMLInputElement).value) || 0,
        trim: parseFloat((document.getElementById('edit-adj-trim') as HTMLInputElement).value) || 0,
        studs: parseInt((document.getElementById('edit-adj-studs') as HTMLInputElement).value) || 0,
        drywall: parseInt((document.getElementById('edit-adj-drywall') as HTMLInputElement).value) || 0,
      };

      const listEl = document.getElementById('custom-items-list');
      if(listEl && p.customItems){
        listEl.querySelectorAll('.ci-name').forEach((el, idx) => {
          if(p.customItems && p.customItems[idx]) {
            p.customItems[idx].name = (el as HTMLInputElement).value;
          }
        });
        listEl.querySelectorAll('.ci-qty').forEach((el, idx) => {
          if(p.customItems && p.customItems[idx]) {
            p.customItems[idx].qty = parseFloat((el as HTMLInputElement).value) || 0;
          }
        });
        listEl.querySelectorAll('.ci-unit').forEach((el, idx) => {
          if(p.customItems && p.customItems[idx]) {
            p.customItems[idx].unit = (el as HTMLInputElement).value;
          }
        });
        listEl.querySelectorAll('.ci-notes').forEach((el, idx) => {
          if(p.customItems && p.customItems[idx]) {
            p.customItems[idx].notes = (el as HTMLInputElement).value;
          }
        });
      }

      saveAndRender();
      document.getElementById('takeoff-edit-modal')?.classList.add('hidden');
      toast('Takeoff quantities & custom items updated');
    });
    const importInput = document.getElementById('import-file-input') as HTMLInputElement;
    if(importInput){
      importInput.addEventListener('change', e => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if(!file) return;
        const reader = new FileReader();
        reader.onload = async ev => {
          try {
            const jsonText = ev.target?.result as string;
            const imported = JSON.parse(jsonText);
            if(Array.isArray(imported)){
              projects = imported;
            } else if(imported && typeof imported === 'object'){
              projects.push(imported);
            }
            await dehydrateProjects(projects); // move any embedded photo bytes into IndexedDB
            if(projects.length > 0){
              currentProjectId = projects[projects.length - 1].id;
              currentPageIdx = 0;
            }
            saveAndRender();
            updateStorageMeter();
            toast('Project imported successfully');
          } catch(err){
            toast('Invalid project file');
          }
          importInput.value = '';
        };
        reader.readAsText(file);
      });
    }
    document.getElementById('boss-report-close')?.addEventListener('click', () => {
      document.getElementById('boss-report-modal')?.classList.add('hidden');
    });
    document.getElementById('boss-report-close-x')?.addEventListener('click', () => {
      document.getElementById('boss-report-modal')?.classList.add('hidden');
    });
    document.getElementById('boss-report-modal')?.addEventListener('click', (e) => {
      if(e.target === document.getElementById('boss-report-modal')) {
        document.getElementById('boss-report-modal')?.classList.add('hidden');
      }
    });
    document.getElementById('boss-report-print')?.addEventListener('click', () => {
      window.print();
    });

    document.getElementById('banner-btn-existing')?.addEventListener('click', ()=>{
      currentView = 'before';
      renderSidebar();
      render();
      toast('Switched to Existing Only View');
    });
    document.getElementById('banner-btn-proposed')?.addEventListener('click', ()=>{
      currentView = 'after';
      renderSidebar();
      render();
      toast('Switched to Proposed View');
    });

    document.getElementById('customer-name')?.addEventListener('input', e=>{
      const p = getProject(); if(p) p.customer = (e.target as HTMLInputElement).value; save();
    });
    document.getElementById('customer-phone')?.addEventListener('input', e=>{
      const p = getProject(); if(p) p.phone = (e.target as HTMLInputElement).value; save();
    });
    document.getElementById('customer-email')?.addEventListener('input', e=>{
      const p = getProject(); if(p) p.email = (e.target as HTMLInputElement).value; save();
    });
    document.getElementById('customer-address')?.addEventListener('input', e=>{
      const p = getProject(); if(p) p.address = (e.target as HTMLInputElement).value; save();
    });

    const setupDrawer = (btnId: string, contentId: string, arrowId: string) => {
      const btn = document.getElementById(btnId);
      const content = document.getElementById(contentId);
      const arrow = document.getElementById(arrowId);
      let isOpen = false;
      btn?.addEventListener('click', () => {
        isOpen = !isOpen;
        content?.classList.toggle('hidden', !isOpen);
        if(arrow) arrow.textContent = isOpen ? '▲' : '▼';
      });
    };

    setupDrawer('btn-pages-drawer', 'pages-drawer-content', 'pages-drawer-arrow');
    setupDrawer('btn-view-drawer', 'view-drawer-content', 'view-drawer-arrow');
    setupDrawer('btn-category-drawer', 'category-drawer-content', 'category-drawer-arrow');
    setupDrawer('btn-scope-drawer', 'scope-drawer-content', 'scope-drawer-arrow');
    setupDrawer('btn-tools-drawer', 'tools-drawer-content', 'tools-drawer-arrow');
    setupDrawer('btn-openings-drawer', 'openings-drawer-content', 'openings-drawer-arrow');
    setupDrawer('btn-assets-drawer', 'assets-drawer-content', 'assets-drawer-arrow');
    setupDrawer('btn-measurements-drawer', 'measurements-drawer-content', 'measurements-drawer-arrow');
    setupDrawer('btn-takeoff-drawer', 'takeoff-drawer-content', 'takeoff-drawer-arrow');

    document.getElementById('btn-to-tab-quantities')?.addEventListener('click', () => {
      document.getElementById('to-tab-content-quantities')?.classList.remove('hidden');
      document.getElementById('to-tab-content-cabinets')?.classList.add('hidden');
      const btnQ = document.getElementById('btn-to-tab-quantities');
      const btnC = document.getElementById('btn-to-tab-cabinets');
      if (btnQ) btnQ.style.background = '#2563eb';
      if (btnC) btnC.style.background = 'rgba(255,255,255,0.1)';
    });
    document.getElementById('btn-to-tab-cabinets')?.addEventListener('click', () => {
      document.getElementById('to-tab-content-cabinets')?.classList.remove('hidden');
      document.getElementById('to-tab-content-quantities')?.classList.add('hidden');
      const btnQ = document.getElementById('btn-to-tab-quantities');
      const btnC = document.getElementById('btn-to-tab-cabinets');
      if (btnQ) btnQ.style.background = 'rgba(255,255,255,0.1)';
      if (btnC) btnC.style.background = '#2563eb';
    });

    const openNotesModal = () => {
      const modal = document.getElementById('notes-modal-overlay');
      const ta = document.getElementById('project-notes') as HTMLTextAreaElement;
      const modalTa = document.getElementById('notes-modal-textarea') as HTMLTextAreaElement;
      if (modal && ta && modalTa) {
        modalTa.value = ta.value;
        modal.classList.remove('hidden');
        modalTa.focus();
      }
    };
    const closeNotesModal = () => {
      const modal = document.getElementById('notes-modal-overlay');
      const ta = document.getElementById('project-notes') as HTMLTextAreaElement;
      const modalTa = document.getElementById('notes-modal-textarea') as HTMLTextAreaElement;
      if (modal && ta && modalTa) {
        ta.value = modalTa.value;
        const page = getPage();
        if (page) {
          const lines = modalTa.value.split('\n').filter(l => l.trim());
          page.notes = lines.map((line, i) => page.notes[i] ? { ...page.notes[i], text: line } : { text: line, x: 100, y: 100 });
          save();
          render();
          renderReferenceRail();
        }
        modal.classList.add('hidden');
      }
    };
    document.getElementById('project-notes')?.addEventListener('focus', openNotesModal);
    document.getElementById('project-notes')?.addEventListener('click', openNotesModal);
    document.getElementById('reference-notes')?.addEventListener('click', openNotesModal);
    document.getElementById('notes-modal-close-x')?.addEventListener('click', closeNotesModal);
    document.getElementById('notes-modal-save')?.addEventListener('click', closeNotesModal);
    document.getElementById('notes-modal-overlay')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).id === 'notes-modal-overlay') closeNotesModal();
    });

    document.getElementById('project-notes')?.addEventListener('input', e=>{
      const page = getPage(); if(!page) return;
      const val = (e.target as HTMLTextAreaElement).value;
      const lines = val.split('\n').filter(l=>l.trim());
      const newNotes = lines.map((line, i) => {
        if(page.notes[i]) return { ...page.notes[i], text: line };
        return { text: line, x: 80 + (i%4)*50, y: 80 + Math.floor(i/4)*60 };
      });
      page.notes = newNotes;
      save(); render();
      renderReferenceRail();
    });

    document.getElementById('wall-edit-update')?.addEventListener('click', ()=>{
      const page=getPage(); if(!page||selectedWallIdx<0) return;
      const w = page.walls[selectedWallIdx];
      if(w && w.locked){
        toast('Cannot update locked wall');
        return;
      }
      const newLenFt = parseFloat((document.getElementById('wall-edit-length') as HTMLInputElement).value);
      if(newLenFt && newLenFt>0){
        const newLen = newLenFt * 12; // feet → inches (world units)
        const angle = wallAngle(w);
        const oldEnd = { x: w.end.x, y: w.end.y };
        w.end = { x: w.start.x + Math.cos(angle)*newLen, y: w.start.y + Math.sin(angle)*newLen };
        // Drag any wall sharing the old corner along to the new one.
        page.walls.forEach((ow, i) => {
          if(i === selectedWallIdx || ow.locked) return;
          if(samePt(ow.start, oldEnd)) ow.start = { x: w.end.x, y: w.end.y };
          if(samePt(ow.end, oldEnd)) ow.end = { x: w.end.x, y: w.end.y };
        });
      }
      const typeSelect = document.getElementById('wall-edit-type') as HTMLSelectElement;
      if(typeSelect){
        w.wallType = typeSelect.value as any;
      }
      recalcOpenings();
      pushHistory(); saveAndRender();
      toast('Wall updated');
    });
    document.getElementById('wall-edit-lock')?.addEventListener('change', (e)=>{
      const page = getPage(); if(!page || selectedWallIdx < 0) return;
      const w = page.walls[selectedWallIdx];
      if(w){
        w.locked = (e.target as HTMLInputElement).checked;
        pushHistory();
        saveAndRender();
        toast(w.locked ? 'Wall locked' : 'Wall unlocked');
      }
    });
    document.getElementById('wall-edit-delete')?.addEventListener('click', ()=>{
      deleteSelectedWall();
    });

    document.getElementById('door-modal-cancel')?.addEventListener('click', ()=>{
      document.getElementById('door-modal')?.classList.add('hidden');
      setTool('select');
    });
    // Tap the dark overlay (outside the card) to cancel, like an X.
    document.getElementById('door-modal')?.addEventListener('click', function(e){
      if(e.target === this){ this.classList.add('hidden'); setTool('select'); }
    });
    document.getElementById('door-modal-place')?.addEventListener('click', ()=>{
      document.getElementById('door-modal')?.classList.add('hidden');
    });
    document.getElementById('door-widths')?.addEventListener('click', e=>{
      const target = e.target as HTMLElement;
      const pill=target.closest('.pill') as HTMLElement; if(!pill) return;
      document.querySelectorAll('#door-widths .pill').forEach(p=>p.classList.remove('active'));
      pill.classList.add('active');
      doorConfig.width = parseInt(pill.dataset.w || '32');
    });
    document.getElementById('door-types')?.addEventListener('click', e=>{
      const target = e.target as HTMLElement;
      const pill=target.closest('.pill') as HTMLElement; if(!pill) return;
      document.querySelectorAll('#door-types .pill').forEach(p=>p.classList.remove('active'));
      pill.classList.add('active');
      doorConfig.type = pill.dataset.t || 'left_swing';
    });

    document.getElementById('window-modal-cancel')?.addEventListener('click', ()=>{
      document.getElementById('window-modal')?.classList.add('hidden');
      setTool('select');
    });
    document.getElementById('window-modal')?.addEventListener('click', function(e){
      if(e.target === this){ this.classList.add('hidden'); setTool('select'); }
    });
    document.getElementById('window-modal-place')?.addEventListener('click', function(){
      windowConfig.width = parseInt((document.getElementById('window-width') as HTMLInputElement).value)||36;
      windowConfig.height = parseInt((document.getElementById('window-height') as HTMLInputElement).value)||36;
      document.getElementById('window-modal')?.classList.add('hidden');
    });

    document.getElementById('opening-edit-dist')?.addEventListener('input', function(){
      updateOpeningDistFt(parseFloat((this as HTMLInputElement).value) || 0);
    });
    document.getElementById('opening-edit-update')?.addEventListener('click', function(){
      const opening = getSelectedOpening();
      if(!opening) return;
      const page = getPage();
      opening.width = parseFloat((document.getElementById('opening-edit-width') as HTMLInputElement).value) || opening.width;
      opening.height = parseFloat((document.getElementById('opening-edit-height') as HTMLInputElement).value) || opening.height;
      const newDist = parseFloat((document.getElementById('opening-edit-dist') as HTMLInputElement).value);
      const ref = (document.getElementById('opening-edit-ref') as HTMLSelectElement).value;
      if(!isNaN(newDist)){
        applyOpeningDistFromRef(opening, newDist, ref);
      }
      if(page){
        const w = page.walls[opening.wallIdx];
        opening.distFromStart = clamp(opening.distFromStart, 0, Math.max(0, wallLength(w) - opening.width));
        placeOpeningOnWall(opening.wallIdx, opening.distFromStart, opening);
        pushHistory(); saveAndRender();
        showOpeningEdit(opening, selectedOpening!.type);
      }
    });
    document.getElementById('opening-edit-delete')?.addEventListener('click', function(){
      if(!selectedOpening) return;
      deleteOpening(selectedOpening.type, selectedOpening.id);
      hideOpeningEdit();
    });
    document.getElementById('opening-edit-flip')?.addEventListener('click', function(){
      const opening = getSelectedOpening();
      if(!opening) return;
      opening.flipped = !opening.flipped;
      pushHistory(); saveAndRender();
    });
    document.getElementById('opening-edit-lock')?.addEventListener('change', function(e){
      const opening = getSelectedOpening();
      if(!opening) return;
      opening.locked = (e.target as HTMLInputElement).checked;
      pushHistory(); saveAndRender();
      toast(opening.locked ? 'Locked' : 'Unlocked');
    });
    document.getElementById('opening-edit-ref')?.addEventListener('change', function(){
      const opening = getSelectedOpening();
      if(!opening) return;
      const page = getPage();
      if(!page) return;
      const w = page.walls[opening.wallIdx];
      const wallLen = wallLength(w);
      const distVal = getOpeningRefDist(opening, wallLen);
      (document.getElementById('opening-edit-dist') as HTMLInputElement).value = distVal.toFixed(2);
      updateOpeningDistFt(distVal);
    });

    document.getElementById('btn-voice')?.addEventListener('click', toggleVoice);
    document.getElementById('btn-export')?.addEventListener('click', exportJSON);

    function setDriveStatus(msg: string){
      const el = document.getElementById('drive-status');
      if(el){ el.textContent = msg; el.style.color = ''; }
    }
    if(!driveConfigured){
      setDriveStatus('Not configured (missing Client ID) — see GOOGLE_DRIVE_SETUP.md');
    } else if(isDriveConnected()){
      setDriveStatus('Connected to Google Drive');
    }
    document.getElementById('btn-drive-connect')?.addEventListener('click', async () => {
      setDriveStatus('Connecting…');
      try {
        await connectBackup();
        setDriveStatus('Connected to Google Drive');
        toast('Connected to Google Drive');
      } catch(err){
        setDriveStatus(err instanceof Error ? err.message : 'Connect failed');
      }
    });
    document.getElementById('btn-drive-save')?.addEventListener('click', async () => {
      setDriveStatus('Saving…');
      try {
        const hydrated = await hydrateProjects(projects); // include photo bytes in the backup
        await saveBackup(hydrated);
        localStorage.setItem(LAST_DRIVE_BACKUP_KEY, Date.now().toString());
        setDriveStatus('Saved to Google Drive just now');
        toast('Saved to Google Drive');
      } catch(err){
        setDriveStatus(err instanceof Error ? err.message : 'Save failed');
      }
    });
    document.getElementById('btn-drive-restore')?.addEventListener('click', async () => {
      setDriveStatus('Checking Drive…');
      try {
        const data = await restoreBackup<Project[]>();
        if(!data || !Array.isArray(data) || data.length === 0){
          setDriveStatus('No backup found in Drive yet — save one first');
          return;
        }
        if(!window.confirm('Restore from Google Drive? This will replace all projects currently on this device.')) {
          setDriveStatus('Restore cancelled');
          return;
        }
        projects = data;
        await dehydrateProjects(projects); // move restored photo bytes into IndexedDB
        if(projects.length > 0){
          currentProjectId = projects[0].id;
          currentPageIdx = 0;
        }
        saveAndRender();
        renderSidebar();
        updateStorageMeter();
        setDriveStatus('Restored from Google Drive');
        toast('Restored from Google Drive');
      } catch(err){
        setDriveStatus(err instanceof Error ? err.message : 'Restore failed');
      }
    });

    document.getElementById('btn-clear-all-data')?.addEventListener('click', async () => {
      if(!window.confirm(`Erase EVERYTHING? This deletes all ${projects.length} project(s) — every wall, photo, and note on this device. Not just the current job.`)) return;
      if(!window.confirm('Really sure? This cannot be undone.')) return;

      projects = [];
      currentProjectId = null;
      currentPageIdx = 0;
      save();
      await clearAllPhotos();
      updateStorageMeter();
      renderSidebar();
      render();
      toast('🗑 All data cleared — starting fresh');
    });

    window.addEventListener('online', updateConnStatus);
    window.addEventListener('offline', updateConnStatus);

    document.getElementById('ctx-menu')?.addEventListener('click', function(e){
      const target = e.target as HTMLElement;
      const item = target.closest('.ctx-item') as HTMLElement;
      if(!item) return;
      const action = item.dataset.action;
      const page = getPage();
      if(action === 'delete' && ctxMenuWallIdx >= 0 && page){
        const w = page.walls[ctxMenuWallIdx];
        if(w && w.locked){
          toast('Cannot delete locked wall');
          document.getElementById('ctx-menu')?.classList.add('hidden');
          return;
        }
        pushHistory();
        removeWallAndOpenings(ctxMenuWallIdx);
        ctxMenuWallIdx = -1;
        pushHistory(); saveAndRender();
      } else if(action === 'change-type' && ctxMenuWallIdx >= 0 && page && page.walls[ctxMenuWallIdx]){
        const types = ['new_construction', 'existing_to_remain', 'demolished'];
        const w = page.walls[ctxMenuWallIdx];
        const idx = types.indexOf(w.wallType);
        w.wallType = types[(idx + 1) % types.length];
        pushHistory(); saveAndRender();
      }
      document.getElementById('ctx-menu')?.classList.add('hidden');
    });
    document.addEventListener('click', function(e){
      const target = e.target as HTMLElement;
      if(!target.closest('#ctx-menu')){
        document.getElementById('ctx-menu')?.classList.add('hidden');
      }
      if(!target.closest('#quick-actions-menu') && !target.closest('#canvas')){
        hideQuickActionsMenu();
      }
    });

    document.getElementById('qa-duplicate')?.addEventListener('click', () => {
      hideQuickActionsMenu();
      duplicateSelectedAsset();
    });
    document.getElementById('qa-rotate')?.addEventListener('click', () => {
      hideQuickActionsMenu();
      rotateSelectedAsset();
    });
    document.getElementById('qa-delete')?.addEventListener('click', () => {
      hideQuickActionsMenu();
      deleteSelectedQuick();
    });

    // sidebar-close is handled in toggleSidebar listeners above
  }

  function setTool(t: string){
    tool = t;
    selectedWallIdx = -1;
    selectedWallIndices = [];
    selectedAssetId = null;
    selectedAssetIds = [];
    rectSelectStart = null;
    rectSelectCurrent = null;
    isDraggingSelection = false;
    selectionDragStart = null;
    wallStart = null;
    activeGuidelines = [];
    pendingWallType = null;
    placementPreview = null;
    selectedOpening = null;
    document.getElementById('wall-edit-panel')?.classList.add('hidden');
    hideOpeningEdit();

    closeMobileSidebar();

    const bDraw = document.getElementById('btn-draw-wall');
    const bSelect = document.getElementById('btn-select');
    const bRect = document.getElementById('btn-rect-select');
    const bDoor = document.getElementById('btn-place-door');
    const bWin = document.getElementById('btn-place-window');

    if(bDraw) bDraw.classList.toggle('active', t==='wall');
    if(bSelect) bSelect.classList.toggle('active', t==='select');
    if(bRect) bRect.classList.toggle('active', t==='rect_select');
    if(bDoor) bDoor.classList.toggle('active', t==='door');
    if(bWin) bWin.classList.toggle('active', t==='window');

    const wrap = document.getElementById('canvas-wrap');
    if(wrap){
      wrap.className = '';
      if(t==='select') wrap.classList.add('mode-select');
      else if(t==='rect_select') wrap.classList.add('mode-rect-select');
      else if(t==='door') wrap.classList.add('mode-door');
      else if(t==='window') wrap.classList.add('mode-window');
    }

    if(t==='door') document.getElementById('door-modal')?.classList.remove('hidden');
    if(t==='window') document.getElementById('window-modal')?.classList.remove('hidden');

    render();
  }

  function cancelWall(){
    wallStart = null;
    activeGuidelines = [];
    pendingWallType = null;
    document.getElementById('wall-modal')?.classList.add('hidden');
    render();
  }

  function onContextMenu(e: MouseEvent){
    e.preventDefault();
    if(wallStart){ cancelWall(); return; }
    const pos = screenToCanvas(e.clientX, e.clientY);
    const wi = findWallAt(pos, SNAP * 1.5);
    if(wi >= 0){
      ctxMenuWallIdx = wi;
      const menu = document.getElementById('ctx-menu');
      if(menu){
        menu.classList.remove('hidden');
        let mx = e.clientX, my = e.clientY;
        if(mx + 170 > window.innerWidth) mx = window.innerWidth - 174;
        if(my + 90 > window.innerHeight) my = window.innerHeight - 94;
        menu.style.left = mx + 'px';
        menu.style.top = my + 'px';
      }
    }
  }

  let longPressTimer: any = null;
  let pressStartX = 0;
  let pressStartY = 0;

  function showQuickActionsMenu(x: number, y: number) {
    const menu = document.getElementById('quick-actions-menu');
    if (!menu) return;
    let mx = x, my = y;
    if (mx + 80 > window.innerWidth) mx = window.innerWidth - 85;
    if (mx - 80 < 0) mx = 85;
    if (my + 80 > window.innerHeight) my = window.innerHeight - 85;
    if (my - 80 < 0) my = 85;
    menu.style.left = mx + 'px';
    menu.style.top = my + 'px';
    menu.classList.remove('hidden');
  }

  function hideQuickActionsMenu() {
    const menu = document.getElementById('quick-actions-menu');
    if (menu) menu.classList.add('hidden');
  }

  function duplicateSelectedAsset() {
    const page = getPage();
    if(!page) return;
    const targetId = selectedAssetId || (selectedAssetIds.length > 0 ? selectedAssetIds[0] : null);
    if(!targetId) {
      toast('Select an asset to duplicate');
      return;
    }
    const asset = page.assets.find(a => a.id === targetId);
    if(!asset) return;
    const newAsset: Asset = {
      ...asset,
      id: uid(),
      x: asset.x + 24,
      y: asset.y + 24
    };
    page.assets.push(newAsset);
    selectedAssetId = newAsset.id;
    selectedAssetIds = [newAsset.id];
    pushHistory();
    saveAndRender();
    toast(`Duplicated ${asset.name || 'asset'}`);
  }

  function rotateSelectedAsset() {
    const page = getPage();
    if(!page) return;
    const targetId = selectedAssetId || (selectedAssetIds.length > 0 ? selectedAssetIds[0] : null);
    if(!targetId) {
      toast('Select an asset to rotate');
      return;
    }
    const asset = page.assets.find(a => a.id === targetId);
    if(!asset) return;
    asset.rotation = ((asset.rotation || 0) + 90) % 360;
    pushHistory();
    saveAndRender();
    toast(`Rotated to ${asset.rotation}°`);
  }

  function deleteSelectedQuick() {
    const page = getPage();
    if(!page) return;
    pushHistory();
    let deletedCount = 0;
    if(selectedAssetIds.length > 0 || selectedAssetId) {
      const ids = selectedAssetIds.length > 0 ? selectedAssetIds : [selectedAssetId!];
      page.assets = page.assets.filter(a => !ids.includes(a.id));
      deletedCount += ids.length;
      selectedAssetId = null;
      selectedAssetIds = [];
    }
    if(selectedWallIndices.length > 0 || selectedWallIdx >= 0) {
      const indices = selectedWallIndices.length > 0 ? [...selectedWallIndices] : [selectedWallIdx];
      const sorted = indices.sort((a,b)=>b-a);
      sorted.forEach(idx => {
        if(page.walls[idx] && !page.walls[idx].locked){
          removeWallAndOpenings(idx);
          deletedCount++;
        }
      });
      selectedWallIndices = [];
      selectedWallIdx = -1;
    }
    if(deletedCount > 0) {
      pushHistory();
      saveAndRender();
      document.getElementById('wall-edit-panel')?.classList.add('hidden');
      hideOpeningEdit();
      toast('Deleted selected item(s)');
    } else {
      toast('Nothing selected to delete');
    }
  }

  /* ════════════════════════════════════════════════════════════════
     CANVAS INPUT
     ════════════════════════════════════════════════════════════════ */
  function onCanvasDown(e: MouseEvent){
    const pos = screenToCanvas(e.clientX, e.clientY);
    const page = getPage();
    if(page && page.notes){
      const clickedNoteIdx = page.notes.findIndex(n => Math.hypot(pos.x - n.x, pos.y - n.y) <= 20);
      if(clickedNoteIdx >= 0){
        draggingNoteIdx = clickedNoteIdx;
        return;
      }
    }
    if(e.button === PAN_BUTTON){
      isPanning = true;
      panStartX = e.clientX; panStartY = e.clientY;
      panStartPx = panX; panStartPy = panY;
      canvas.style.cursor = 'grabbing';
      return;
    }

    // Grab a resize handle on the selected asset (stretch to size, like a wall).
    if(page){
      const selId = selectedAssetId || (selectedAssetIds.length === 1 ? selectedAssetIds[0] : null);
      const selAsset = selId ? page.assets.find(a => a.id === selId) : null;
      if(selAsset){
        const corners = rotatedAssetCorners(selAsset);
        const grabR = 14 / zoom; // ~14 screen px regardless of zoom
        for(let i = 0; i < 4; i++){
          if(dist(pos, corners[i]) <= grabR){
            resizingAssetCorner = i;
            resizeAnchorWorld = corners[(i + 2) % 4]; // opposite corner stays put
            pushHistory();
            return;
          }
        }
      }
    }
    if(isPanning) return;

    hideQuickActionsMenu();
    pressStartX = e.clientX;
    pressStartY = e.clientY;
    clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => {
      const pos = screenToCanvas(e.clientX, e.clientY);
      const page = getPage();
      if(page && page.assets) {
        const clickedAsset = page.assets.slice().reverse().find(a => pointInAsset(pos, a));
        if(clickedAsset) {
          selectedAssetId = clickedAsset.id;
          selectedAssetIds = [clickedAsset.id];
          selectedWallIdx = -1;
          selectedWallIndices = [];
          render();
          showQuickActionsMenu(e.clientX, e.clientY);
        }
      }
    }, 500);

    const sx = snap(pos.x), sy = snap(pos.y);

    if(tool==='wall'){
      const page=getPage(); if(!page) return;
      const { snappedPos, guides } = getWallSnapAndGuides(pos, wallStart, page.walls);
      activeGuidelines = guides;
      const sx = snappedPos.x, sy = snappedPos.y;

      if(!wallStart){
        wallStart = {x:sx, y:sy};
        pendingWallType = currentWallType;
      } else {
        if(dist(wallStart, {x:sx,y:sy}) < MIN_WALL){
          toast('Wall too short');
          return;
        }
        pushHistory();
        page.walls.push({
          start: {...wallStart},
          end: {x:sx, y:sy},
          wallType: pendingWallType || currentWallType
        });
        recalcOpenings();
        wallStart = null;
        activeGuidelines = [];
        pushHistory();
        saveAndRender();
      }
    } else if(tool==='rect_select'){
      rectSelectStart = { x: pos.x, y: pos.y };
      rectSelectCurrent = { x: pos.x, y: pos.y };
      if(!e.shiftKey){
        selectedWallIndices = [];
        selectedAssetIds = [];
        selectedWallIdx = -1;
        selectedAssetId = null;
        document.getElementById('wall-edit-panel')?.classList.add('hidden');
        hideOpeningEdit();
      }
      return;
    } else if(tool==='select'){
      const page=getPage();
      // ── Openings FIRST (they sit on walls; the wall must not steal the tap) ──
      if(page){
        const hitDoor = page.doors.find(d => dist(pos, {x: d.x||0, y: d.y||0}) < (d.width||32)/2 + 12);
        const hitWin = !hitDoor ? page.windows.find(w => dist(pos, {x: w.x||0, y: w.y||0}) < (w.width||36)/2 + 12) : null;
        const hit = hitDoor || hitWin;
        if(hit){
          const type: 'door'|'window' = hitDoor ? 'door' : 'window';
          selectedWallIdx = -1; selectedWallIndices = [];
          selectedAssetId = null; selectedAssetIds = [];
          document.getElementById('wall-edit-panel')?.classList.add('hidden');
          selectedOpening = { type, id: hit.id };
          if(!hit.locked) draggingOpening = { type, id: hit.id }; // arm free slide
          showOpeningEdit(hit, type);
          render();
          return;
        }
      }
      if (page && page.assets) {
        const clickedAsset = page.assets.slice().reverse().find(a => pointInAsset(pos, a));
        if (clickedAsset) {
          if (selectedAssetIds.includes(clickedAsset.id) || selectedAssetIds.length > 0 || selectedWallIndices.length > 0) {
            isDraggingSelection = true;
            selectionDragStart = pos;
            return;
          }
          selectedAssetId = clickedAsset.id;
          selectedAssetIds = [clickedAsset.id];
          selectedWallIdx = -1;
          selectedWallIndices = [];
          selectedOpening = null;
          document.getElementById('wall-edit-panel')?.classList.add('hidden');
          hideOpeningEdit();
          showAssetEditModal(clickedAsset);
          render();
          return;
        }
      }
      if(selectedWallIdx >= 0 && page){
        const sw = page.walls[selectedWallIdx];
        if(sw && !sw.locked){
          if(dist(pos, sw.start) < SNAP*1.5){ dragHandle = 0; return; }
          if(dist(pos, sw.end) < SNAP*1.5){ dragHandle = 1; return; }
        }
      }
      const wi = findWallAt(pos, SNAP*1.5);
      if(wi >= 0){
        if (selectedWallIndices.includes(wi)) {
          isDraggingSelection = true;
          selectionDragStart = pos;
          return;
        }
        selectedWallIdx = wi;
        selectedWallIndices = [wi];
        selectedAssetId = null;
        selectedAssetIds = [];
        selectedOpening = null;
        hideOpeningEdit();
        showWallEdit(wi);
        render();
      } else {
        selectedWallIdx = -1;
        selectedWallIndices = [];
        selectedAssetId = null;
        selectedAssetIds = [];
        selectedOpening = null;
        document.getElementById('wall-edit-panel')?.classList.add('hidden');
        hideOpeningEdit();
        render();
      }
    } else if(tool==='door'){
      const page=getPage(); if(!page) return;
      const wi = findWallAt(pos, SNAP*1.5);
      if(wi < 0){ toast('Click on a wall'); return; }
      const w = page.walls[wi];
      const cp = closestPointOnWall(pos, w);
      const d: Opening = {
        id: '',
        width: doorConfig.width,
        type: doorConfig.type,
        wallIdx: wi,
        distFromStart: clamp(dist(w.start, cp), doorConfig.width/2, Math.max(doorConfig.width/2, wallLength(w) - doorConfig.width/2))
      };
      placeOpeningOnWall(wi, d.distFromStart, d);
      page.doors.push(d);
      placementPreview = null;
      selectedOpening = { type: 'door', id: d.id };
      showOpeningEdit(d, 'door');
      pushHistory(); saveAndRender();
      setTool('select'); // one door per placement — don't keep dropping
    } else if(tool==='window'){
      const page=getPage(); if(!page) return;
      const wi = findWallAt(pos, SNAP*1.5);
      if(wi < 0){ toast('Click on a wall'); return; }
      const w = page.walls[wi];
      const cp = closestPointOnWall(pos, w);
      const win: Opening = {
        id: '',
        width: windowConfig.width,
        height: windowConfig.height,
        wallIdx: wi,
        distFromStart: dist(w.start, cp)
      };
      win.distFromStart = clamp(win.distFromStart, windowConfig.width/2, Math.max(windowConfig.width/2, wallLength(w) - windowConfig.width/2));
      placeOpeningOnWall(wi, win.distFromStart, win);
      page.windows.push(win);
      placementPreview = null;
      selectedOpening = { type: 'window', id: win.id };
      showOpeningEdit(win, 'window');
      pushHistory(); saveAndRender();
      setTool('select'); // one window per placement
    } else if(tool==='place_asset'){
      const page=getPage();
      if(!page || !activePreset) return;
      const recD = getRecommendedDepth(activePreset);
      const newAsset: Asset = {
        id: uid(),
        type: activePreset.type,
        category: activePreset.category,
        name: activePreset.name,
        code: activePreset.code,
        x: snap(pos.x),
        y: snap(pos.y),
        width: activePreset.width,
        depth: recD,
        height: activePreset.height,
        rotation: placingAssetRotation,
        kneeWallWidth: activePreset.kneeWallWidth,
        glassDoorWidth: activePreset.glassDoorWidth,
        enclosureStyle: activePreset.enclosureStyle,
        drainType: activePreset.drainType,
        hasRainHead: activePreset.hasRainHead,
        hasWallHead: activePreset.hasWallHead,
      };
      snapAssetToWall(newAsset);
      page.assets.push(newAsset);
      selectedAssetId = newAsset.id;
      tool = 'select';
      pushHistory(); saveAndRender();
      toast(`Placed ${newAsset.name}`);
    }
  }

  function onCanvasMove(e: MouseEvent){
    if(draggingOpening){
      const pos = screenToCanvas(e.clientX, e.clientY);
      const page = getPage();
      if(page){
        const list = draggingOpening.type === 'door' ? page.doors : page.windows;
        const op = list.find(o => o.id === draggingOpening!.id);
        if(op){
          // Find the nearest wall by perpendicular distance.
          let bestI = -1, bestCp: Point | null = null, bestD = Infinity;
          page.walls.forEach((w, i) => {
            const cp = closestPointOnWall(pos, w);
            const d = dist(pos, cp);
            if(d < bestD){ bestD = d; bestI = i; bestCp = cp; }
          });
          const SNAP_TO_WALL = 45; // within ~3.75 ft of a wall → snap flush onto it
          if(bestI >= 0 && bestCp && bestD <= SNAP_TO_WALL){
            const w = page.walls[bestI];
            const len = wallLength(w);
            op.floating = false;
            op.wallIdx = bestI;
            op.distFromStart = clamp(dist(w.start, bestCp), op.width/2, Math.max(op.width/2, len - op.width/2));
            recalcOpenings();
            const distInput = document.getElementById('opening-edit-dist') as HTMLInputElement;
            const refDist = getOpeningRefDist(op, len);
            if(distInput) distInput.value = refDist.toFixed(2);
            updateOpeningDistFt(refDist);
          } else {
            // No wall near — float freely under the cursor (swing it around).
            op.floating = true;
            op.x = pos.x; op.y = pos.y;
          }
          openingMoved = true;
          render();
        }
      }
      return;
    }
    if(resizingAssetCorner >= 0 && resizeAnchorWorld){
      const pos = screenToCanvas(e.clientX, e.clientY);
      const page = getPage();
      const selId = selectedAssetId || (selectedAssetIds.length === 1 ? selectedAssetIds[0] : null);
      const a = page && selId ? page.assets.find(x => x.id === selId) : null;
      if(a){
        const rot = ((a.rotation || 0) * Math.PI) / 180;
        // Work in the asset's own axes: rotate both points back by -rotation.
        const uDrag = rotatePt(pos, -rot);
        const uAnchor = rotatePt(resizeAnchorWorld, -rot);
        const w = Math.max(SNAP, Math.abs(uDrag.x - uAnchor.x));
        const d = Math.max(SNAP, Math.abs(uDrag.y - uAnchor.y));
        const uCenter = { x: (uDrag.x + uAnchor.x) / 2, y: (uDrag.y + uAnchor.y) / 2 };
        const center = rotatePt(uCenter, rot); // back to world
        a.width = Math.round(w);
        a.depth = Math.round(d);
        a.x = center.x;
        a.y = center.y;
        render();
      }
      return;
    }
    if(draggingNoteIdx >= 0){
      const pos = screenToCanvas(e.clientX, e.clientY);
      const page = getPage();
      if(page && page.notes[draggingNoteIdx]){
        page.notes[draggingNoteIdx].x = pos.x;
        page.notes[draggingNoteIdx].y = pos.y;
        render();
      }
      return;
    }
    if(longPressTimer && (Math.abs(e.clientX - pressStartX) > 8 || Math.abs(e.clientY - pressStartY) > 8)){
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }

    const pos = screenToCanvas(e.clientX, e.clientY);
    mousePos = pos;

    if(isPanning){
      panX = panStartPx + (e.clientX - panStartX);
      panY = panStartPy + (e.clientY - panStartY);
      render();
      return;
    }

    if(tool === 'rect_select' && rectSelectStart){
      rectSelectCurrent = pos;
      render();
      return;
    }

    if(isDraggingSelection && selectionDragStart){
      let dx = pos.x - selectionDragStart.x;
      let dy = pos.y - selectionDragStart.y;
      const page = getPage();
      if(page){
        // Ortho-lock: dragging a single near-horizontal wall moves it vertically
        // only (and vice-versa), so the room stays square instead of skewing.
        if(selectedWallIndices.length === 1){
          const w = page.walls[selectedWallIndices[0]];
          if(w){
            const adx = Math.abs(w.end.x - w.start.x), ady = Math.abs(w.end.y - w.start.y);
            if(ady < adx * 0.0875) dx = 0;      // near-horizontal → move vertically only
            else if(adx < ady * 0.0875) dy = 0; // near-vertical → move horizontally only
          }
        }
      }
      selectionDragStart = pos;
      if(page){
        // Capture the corners of the moving walls BEFORE they move, so we can
        // drag any connected (coincident) neighbor endpoints along with them.
        const movingPts: Point[] = [];
        selectedWallIndices.forEach(wi => {
          const w = page.walls[wi];
          if(w && !w.locked){ movingPts.push({x:w.start.x, y:w.start.y}, {x:w.end.x, y:w.end.y}); }
        });
        selectedWallIndices.forEach(wi => {
          const w = page.walls[wi];
          if(w && !w.locked){
            w.start.x += dx; w.start.y += dy;
            w.end.x += dx; w.end.y += dy;
          }
        });
        // Weld: any non-selected wall endpoint on a moving corner follows.
        page.walls.forEach((w, i) => {
          if(selectedWallIndices.includes(i) || w.locked) return;
          if(movingPts.some(mp => samePt(w.start, mp))){ w.start.x += dx; w.start.y += dy; }
          if(movingPts.some(mp => samePt(w.end, mp))){ w.end.x += dx; w.end.y += dy; }
        });
        selectedAssetIds.forEach(aid => {
          const a = page.assets.find(item => item.id === aid);
          if(a){
            a.x += dx; a.y += dy;
          }
        });
        recalcOpenings();
        render();
      }
      return;
    }

    if(tool==='wall'){
      const page = getPage();
      if(page){
        const { snappedPos, guides } = getWallSnapAndGuides(pos, wallStart, page.walls);
        activeGuidelines = guides;
      }
      render();
    } else if(tool==='place_asset'){
      render();
    }

    if(tool==='door' || tool==='window'){
      const page=getPage();
      if(page){
        const wi = findWallAt(pos, SNAP*1.5);
        if(wi >= 0){
          const ww = page.walls[wi];
          const cp = closestPointOnWall(pos, ww);
          const dw = tool==='door' ? doorConfig.width : windowConfig.width;
          const dfs = clamp(dist(ww.start, cp), dw/2, Math.max(dw/2, wallLength(ww) - dw/2));
          placementPreview = {
            wallIdx: wi,
            distFromStart: dfs,
            x: lerp(ww.start.x, ww.end.x, dfs / wallLength(ww)),
            y: lerp(ww.start.y, ww.end.y, dfs / wallLength(ww)),
            angle: wallAngle(ww),
            width: dw
          };
        } else {
          placementPreview = null;
        }
        render();
      }
    } else {
      placementPreview = null;
    }

    if(dragHandle >= 0 && selectedWallIdx >= 0){
      const page=getPage(); if(!page) return;
      const w = page.walls[selectedWallIdx];
      const sx = snap(pos.x), sy = snap(pos.y);
      const oldPt = dragHandle===0 ? { x: w.start.x, y: w.start.y } : { x: w.end.x, y: w.end.y };
      if(dragHandle===0) w.start = {x:sx,y:sy};
      else w.end = {x:sx,y:sy};
      // Drag along any other endpoint sitting on the same corner.
      page.walls.forEach((ow, i) => {
        if(i===selectedWallIdx || ow.locked) return;
        if(samePt(ow.start, oldPt)) ow.start = {x:sx,y:sy};
        if(samePt(ow.end, oldPt)) ow.end = {x:sx,y:sy};
      });
      recalcOpenings();
      const lenInput = document.getElementById('wall-edit-length') as HTMLInputElement;
      if (lenInput) lenInput.value = (wallLength(w)/12).toFixed(2);
      render();
    }
  }

  function onCanvasUp(e: MouseEvent){
    if(draggingOpening){
      const page = getPage();
      const list = page ? (draggingOpening.type === 'door' ? page.doors : page.windows) : [];
      const op = list.find(o => o.id === draggingOpening!.id);
      if(page && op && op.floating){
        // Dropped away from a wall — glue to the nearest one (doors live on walls).
        let bestI = -1, bestCp: Point | null = null, bestD = Infinity;
        page.walls.forEach((w, i) => {
          const cp = closestPointOnWall({x: op.x||0, y: op.y||0}, w);
          const d = dist({x: op.x||0, y: op.y||0}, cp);
          if(d < bestD){ bestD = d; bestI = i; bestCp = cp; }
        });
        if(bestI >= 0 && bestCp){
          const w = page.walls[bestI];
          const len = wallLength(w);
          op.wallIdx = bestI;
          op.distFromStart = clamp(dist(w.start, bestCp), op.width/2, Math.max(op.width/2, len - op.width/2));
        }
        op.floating = false;
        recalcOpenings();
      }
      draggingOpening = null;
      if(openingMoved){ pushHistory(); save(); }
      openingMoved = false;
      render();
      return;
    }
    if(resizingAssetCorner >= 0){
      resizingAssetCorner = -1;
      resizeAnchorWorld = null;
      pushHistory();
      save();
      render();
      return;
    }
    draggingNoteIdx = -1;
    if(longPressTimer){
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }

    if(isPanning){
      isPanning = false;
      canvas.style.cursor = '';
      return;
    }
    if(tool === 'rect_select' && rectSelectStart && rectSelectCurrent){
      const x1 = Math.min(rectSelectStart.x, rectSelectCurrent.x);
      const x2 = Math.max(rectSelectStart.x, rectSelectCurrent.x);
      const y1 = Math.min(rectSelectStart.y, rectSelectCurrent.y);
      const y2 = Math.max(rectSelectStart.y, rectSelectCurrent.y);
      const page = getPage();
      if(page){
        selectedWallIndices = [];
        page.walls.forEach((w, idx) => {
          if((w.start.x >= x1 && w.start.x <= x2 && w.start.y >= y1 && w.start.y <= y2) ||
             (w.end.x >= x1 && w.end.x <= x2 && w.end.y >= y1 && w.end.y <= y2) ||
             (Math.min(w.start.x, w.end.x) <= x2 && Math.max(w.start.x, w.end.x) >= x1 &&
              Math.min(w.start.y, w.end.y) <= y2 && Math.max(w.start.y, w.end.y) >= y1)){
            selectedWallIndices.push(idx);
          }
        });
        selectedAssetIds = [];
        page.assets.forEach(a => {
          const hw = (a.width || 24)/2;
          const hd = (a.depth || 24)/2;
          if(a.x >= x1 - hw && a.x <= x2 + hw && a.y >= y1 - hd && a.y <= y2 + hd){
            selectedAssetIds.push(a.id);
          }
        });
        toast(`Selected ${selectedWallIndices.length} walls, ${selectedAssetIds.length} assets`);
      }
      rectSelectStart = null;
      rectSelectCurrent = null;
      render();
      return;
    }

    if(isDraggingSelection){
      isDraggingSelection = false;
      selectionDragStart = null;
      const page = getPage();
      if(page){
        selectedAssetIds.forEach(aid => {
          const a = page.assets.find(item => item.id === aid);
          if(a) snapAssetToWall(a);
        });
      }
      pushHistory();
      save();
      render();
      return;
    }

    if(dragHandle >= 0){
      dragHandle = -1;
      pushHistory(); save();
      render();
    }
  }

  /* ── Touch ─────────────────────────────────────────── */
  let touchStartDist = 0;
  let touchMidX = 0, touchMidY = 0;
  function onTouchStart(e: TouchEvent){
    e.preventDefault();
    if(e.touches.length === 2){
      touchStartDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      touchMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      touchMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      return;
    }
    if(e.touches.length === 1){
      const t = e.touches[0];
      const fakeEvent = { clientX: t.clientX, clientY: t.clientY, button: 0 } as MouseEvent;
      onCanvasDown(fakeEvent);
    }
  }
  function onTouchMove(e: TouchEvent){
    e.preventDefault();
    if(e.touches.length === 2){
      const newDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const newMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const newMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const rect = canvas.getBoundingClientRect();
      if(touchStartDist > 0){
        const scale = newDist / touchStartDist;
        const newZoom = clamp(zoom * scale, 0.15, 5);
        // Zoom about the pinch center (screen coords → canvas-local coords)
        const mx = newMidX - rect.left;
        const my = newMidY - rect.top;
        panX = mx - (mx - panX) * (newZoom / zoom);
        panY = my - (my - panY) * (newZoom / zoom);
        zoom = newZoom;
        touchStartDist = newDist;
        const zoomEl = document.getElementById('toolbar-zoom');
        if (zoomEl) zoomEl.textContent = Math.round(zoom*100)+'%';
      }
      // Two fingers sliding together (no pinch) pans the view
      panX += newMidX - touchMidX;
      panY += newMidY - touchMidY;
      touchMidX = newMidX;
      touchMidY = newMidY;
      render();
      return;
    }
    if(e.touches.length === 1){
      const t = e.touches[0];
      onCanvasMove({ clientX: t.clientX, clientY: t.clientY } as MouseEvent);
    }
  }
  function onTouchEnd(e: TouchEvent){
    if(e.touches.length === 0){
      onCanvasUp({} as MouseEvent);
      touchStartDist = 0;
    }
  }

  /* ── Zoom ──────────────────────────────────────────── */
  function onWheel(e: WheelEvent){
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    const newZoom = clamp(zoom * factor, 0.15, 5);
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    panX = mx - (mx - panX) * (newZoom / zoom);
    panY = my - (my - panY) * (newZoom / zoom);
    zoom = newZoom;
    const zoomEl = document.getElementById('toolbar-zoom');
    if (zoomEl) zoomEl.textContent = Math.round(zoom*100)+'%';
    render();
  }

  /* ── Keyboard ──────────────────────────────────────── */
  function onKeyDown(e: KeyboardEvent){
    const target = e.target as HTMLElement;
    if(target.tagName==='INPUT'||target.tagName==='TEXTAREA'||target.tagName==='SELECT') return;

    if(e.key==='w'||e.key==='W'){ setTool('wall'); return; }
    if(e.key==='v'||e.key==='V'){ setTool('select'); return; }
    if(e.key==='b'||e.key==='B'){ setTool('rect_select'); return; }
    if(e.key==='d'||e.key==='D'){ setTool('door'); return; }
    if(e.key==='n'||e.key==='N'){ setTool('window'); return; }
    if(e.key==='Escape'){
      cancelWall();
      selectedWallIdx = -1;
      selectedWallIndices = [];
      selectedAssetId = null;
      selectedAssetIds = [];
      rectSelectStart = null;
      rectSelectCurrent = null;
      isDraggingSelection = false;
      selectionDragStart = null;
      selectedOpening = null;
      placementPreview = null;
      document.getElementById('wall-edit-panel')?.classList.add('hidden');
      hideOpeningEdit();
      document.getElementById('door-modal')?.classList.add('hidden');
      document.getElementById('window-modal')?.classList.add('hidden');
      document.getElementById('help-modal')?.classList.add('hidden');
      setTool('select');
      return;
    }
    if(e.ctrlKey && e.key==='z'){ e.preventDefault(); undo(); return; }
    if(e.ctrlKey && e.key==='y'){ e.preventDefault(); redo(); return; }
    if(e.ctrlKey && e.key==='c'){
      if(selectedWallIdx>=0){
        const page=getPage(); if(!page) return;
        clipboardWall = JSON.parse(JSON.stringify(page.walls[selectedWallIdx]));
      }
      return;
    }
    if(e.ctrlKey && e.key==='v'){
      if(clipboardWall){
        const page=getPage(); if(!page) return;
        pushHistory();
        const newW = JSON.parse(JSON.stringify(clipboardWall));
        newW.start = {x:newW.start.x+40, y:newW.start.y+40};
        newW.end = {x:newW.end.x+40, y:newW.end.y+40};
        page.walls.push(newW);
        pushHistory(); saveAndRender();
      }
      return;
    }
    if(e.key==='r'||e.key==='R'){
      if(tool==='place_asset'){
        placingAssetRotation = (placingAssetRotation + 90) % 360;
        toast(`Rotated ${placingAssetRotation}°`);
        render();
        return;
      }
    }
    if(e.key==='Delete' || e.key==='Backspace'){
      const page = getPage();
      if(page && (selectedWallIndices.length > 0 || selectedAssetIds.length > 0)){
        pushHistory();
        if(selectedAssetIds.length > 0){
          page.assets = page.assets.filter(a => !selectedAssetIds.includes(a.id));
        }
        if(selectedWallIndices.length > 0){
          const sorted = [...selectedWallIndices].sort((a,b)=>b-a);
          sorted.forEach(idx => {
            if(page.walls[idx] && !page.walls[idx].locked){
              removeWallAndOpenings(idx);
            }
          });
        }
        selectedWallIndices = [];
        selectedAssetIds = [];
        selectedWallIdx = -1;
        selectedAssetId = null;
        document.getElementById('wall-edit-panel')?.classList.add('hidden');
        hideOpeningEdit();
        pushHistory();
        saveAndRender();
        toast('Deleted selected items');
        return;
      }
      if(selectedAssetId){
        const page = getPage();
        if(page){
          page.assets = page.assets.filter(a => a.id !== selectedAssetId);
          selectedAssetId = null;
          pushHistory(); saveAndRender();
          toast('Asset deleted');
        }
      } else if(selectedOpening){
        deleteOpening(selectedOpening.type, selectedOpening.id);
        hideOpeningEdit();
      } else {
        deleteSelectedWall();
      }
      return;
    }
  }

  function showWallEdit(wi: number){
    const page=getPage(); if(!page) return;
    const w = page.walls[wi];
    const lenInput = document.getElementById('wall-edit-length') as HTMLInputElement;
    if (lenInput) lenInput.value = (wallLength(w)/12).toFixed(2);
    const typeSelect = document.getElementById('wall-edit-type') as HTMLSelectElement;
    if (typeSelect) typeSelect.value = w.wallType || 'existing_to_remain';
    const lockInput = document.getElementById('wall-edit-lock') as HTMLInputElement;
    if (lockInput) lockInput.checked = !!w.locked;
    document.getElementById('wall-edit-panel')?.classList.remove('hidden');
  }

  function deleteSelectedWall(){
    const page=getPage(); if(!page||selectedWallIdx<0) return;
    const w = page.walls[selectedWallIdx];
    if(w && w.locked){
      toast('Cannot delete locked wall');
      return;
    }
    pushHistory();
    removeWallAndOpenings(selectedWallIdx);
    selectedWallIdx=-1;
    document.getElementById('wall-edit-panel')?.classList.add('hidden');
    pushHistory(); saveAndRender();
  }

  /* ════════════════════════════════════════════════════════════════
     VOICE (Web Speech API)
     ════════════════════════════════════════════════════════════════ */
  let recognition: any = null;
  let isRecording = false;

  function toggleVoice(){
    if(!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)){
      toast('Voice not supported in this browser');
      return;
    }

    if(isRecording){
      recognition?.stop();
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.continuous = true;

    recognition.onresult = function(event: any){
      let text = '';
      for(let i=event.resultIndex; i<event.results.length; i++){
        if(event.results[i].isFinal) text += event.results[i][0].transcript;
      }
      if(text){
        addVoiceNote(text);
      }
    };
    recognition.onerror = function(e: any){
      console.warn('Speech error', e.error);
      if(e.error !== 'no-speech') toast('Voice error: ' + e.error);
    };
    recognition.onend = function(){
      isRecording = false;
      document.getElementById('btn-voice')?.classList.remove('recording');
      document.getElementById('voice-status')?.classList.add('hidden');
    };

    isRecording = true;
    recognition.start();
    document.getElementById('btn-voice')?.classList.add('recording');
    document.getElementById('voice-status')?.classList.remove('hidden');
    toast('Listening...');
  }

  function addVoiceNote(text: string){
    const page = getPage();
    if(!page) return;
    const ts = new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    const noteText = '[' + ts + '] ' + text;

    page.notes.push({ text: noteText, x: 100 + Math.random()*200, y: 100 + Math.random()*200 });

    const ta = document.getElementById('project-notes') as HTMLTextAreaElement;
    const p = getProject();
    if(p) p._notesTa = ta.value;
    if(ta) ta.value = (ta.value ? ta.value + '\n' : '') + noteText;
    if(p) p._notesTa = ta.value;

    pushHistory(); saveAndRender();
    toast('Note added');
  }

  /* ════════════════════════════════════════════════════════════════
     EXPORT
     ════════════════════════════════════════════════════════════════ */
  async function exportJSON(){
    const hydrated = await hydrateProjects(projects); // re-attach photo bytes so the file is self-contained
    const data = JSON.stringify(hydrated, null, 2);
    const blob = new Blob([data], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'nextlevel_projects.json';
    a.click(); URL.revokeObjectURL(url);
    toast('Exported');
  }

  // ── Send / Open a single job ──────────────────────────────────────────
  // The field-guy-to-sales-guy handoff: package ONE job (not the whole
  // project list) into a file named after the job itself, and hand it off
  // through the device's own share sheet (text/email/AirDrop/whatever) —
  // no accounts, no server, no "JSON" anywhere in the UI. Under the hood
  // it's still a small data file — that part doesn't change — but nothing
  // about how it's presented looks like a developer export tool.
  async function sendCurrentJob(){
    const p = getProject();
    if(!p){ toast('No job selected'); return; }
    toast('Packing up the job…');
    let hydrated;
    try {
      hydrated = (await hydrateProjects([p]))[0]; // pull photo bytes in so the file is self-contained
    } catch {
      toast('Could not prepare the job file'); return;
    }
    const envelope = { type: 'nextlevel-job', version: 1, project: hydrated };
    const json = JSON.stringify(envelope);
    const safeName = (p.name || 'Job').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'Job';
    const filename = `${safeName}.json`;
    const file = new File([json], filename, { type: 'application/json' });

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
    if(!incoming || !incoming.pages){ toast("That doesn't look like a job file"); return; }
    incoming.id = uid(); // always lands as a NEW entry — never silently overwrites an existing job
    try {
      await dehydrateProjects([incoming]); // pulls inline photo bytes into IndexedDB, strips them
    } catch { /* private mode etc — leave photos inline, they'll still show */ }
    projects.push(incoming);
    currentProjectId = incoming.id;
    currentPageIdx = 0;
    pushHistory(); save(); renderSidebar(); render();
    toast(`📥 Job in! "${incoming.name}" added to your list`);
  }

  /* ════════════════════════════════════════════════════════════════
     INIT
     ════════════════════════════════════════════════════════════════ */
  const canvasEl = document.getElementById('floorplan') as HTMLCanvasElement;
  if (!canvasEl) return;
  canvas = canvasEl;
  ctx = canvas.getContext('2d')!;

  try{
    projects = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  }catch(e){ projects = []; }

  projects.forEach(p => {
    p.photos = p.photos || [];
    if(p.canvas && !p.pages){
      p.pages = [newPage('Page 1')];
      p.pages[0].walls = p.canvas.walls || [];
      p.pages[0].assets = (p as any).assets || [];
      delete p.canvas;
      delete (p as any).assets;
    }
    if(!p.pages || !p.pages.length) p.pages = [newPage()];
    p.pages.forEach(pg => {
      pg.walls = pg.walls || [];
      pg.doors = pg.doors || [];
      pg.windows = pg.windows || [];
      pg.assets = pg.assets || [];
      pg.notes = pg.notes || [];
      pg.history = pg.history || [];
      pg.historyIdx = pg.historyIdx ?? -1;
    });
  });

  // One-time migration: move any legacy inline base64 photos into IndexedDB,
  // then persist the now-light projects JSON. Fire-and-forget — photos keep
  // showing via their inline dataUrl until their blob lands.
  dehydrateProjects(projects).then(n => {
    if(n > 0){ save(); renderPhotoGallery(); }
    updateStorageMeter();
  });

  if(projects.length > 0){
    currentProjectId = projects[0].id;
    currentPageIdx = 0;
    pushHistory();
  }
  // else: genuinely empty — no fake seed project. currentProjectId stays
  // null and Skip to Drawing / Wizard become the actual first move, instead
  // of forcing everyone to first delete a "Sample Kitchen Remodel / John
  // Doe" placeholder that was never theirs.

  initEvents();
  renderSidebar();

  const initPage = getPage();
  const notesTa = document.getElementById('project-notes') as HTMLTextAreaElement;
  if(notesTa && initPage && initPage.notes.length){
    notesTa.value = initPage.notes.map(n=>n.text).join('\n');
  }

  const canvasWrap = document.getElementById('canvas-wrap');
  if (canvasWrap && (window as any).ResizeObserver) {
    const observer = new (window as any).ResizeObserver(() => {
      resizeCanvas();
    });
    observer.observe(canvasWrap);
  } else {
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
  }
  setTimeout(resizeCanvas, 100);

  // Auto-save every 30 seconds
  setInterval(() => {
    save();
  }, 30000);

  // ── Bridge for the React launcher/hub ────────────────────────────────
  // Lets the launcher's New/Open doors drive real project actions that live
  // inside this closure, instead of clicking hidden DOM buttons.
  (window as any).NextLevel = {
    newJob(): string {
      const p = newProject();
      projects.push(p);
      currentProjectId = p.id;
      currentPageIdx = 0;
      selectedWallIdx = -1;
      save();
      renderSidebar();
      render();
      return p.id;
    },
    listJobs(): Array<{ id: string; name: string; category: string; photoCount: number; noteCount: number }> {
      return projects.map(p => ({
        id: p.id,
        name: p.name,
        category: p.category,
        photoCount: p.photos?.length || 0,
        noteCount: p.pages.reduce((s, pg) => s + (pg.notes?.length || 0), 0),
      }));
    },
    openJob(id: string): void {
      const p = projects.find(x => x.id === id);
      if (!p) return;
      currentProjectId = p.id;
      currentPageIdx = 0;
      selectedWallIdx = -1;
      save();
      renderSidebar();
      render();
    },
    openSkipCategory(): void { openSkipCategoryModal(); },
  };
}
