// Builds the Job Sheet as a real PDF file (same content and 2-across picture layout as the on-screen
// sheet) so it can be handed straight to the phone's share menu / email. Loaded on demand so the
// PDF library does not slow down app start-up.
import { jsPDF } from 'jspdf';

export type JobSheetData = {
  name: string;
  customer: string;
  date: string;
  phone: string;
  email: string;
  address: string;
  jobDesc: string;
  jobNotes: string;
  scratch: Array<{ id: string; text: string }>;
  photos: Array<{ id: string; caption: string; note: string }>;
};

const MARGIN = 12;          // mm, same as the print layout
const GAP = 5;              // mm between the two picture columns
const MAX_IMG_H = 90;       // mm, same cap as the print layout
const GREEN: [number, number, number] = [74, 92, 46];
const INK: [number, number, number] = [20, 25, 26];
const GRAY: [number, number, number] = [85, 85, 85];
const LINE: [number, number, number] = [211, 218, 218];

// The built-in PDF fonts only cover basic Latin, so drop anything they cannot draw (emoji etc.).
const clean = (s: string) =>
  (s || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[^\n\t\u0020-\u007E\u00A0-\u00FF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026]/g, '');

async function loadJpeg(url: string): Promise<{ data: string; w: number; h: number } | null> {
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const maxSide = 1600;
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return { data: canvas.toDataURL('image/jpeg', 0.82), w, h };
  } catch {
    return null;
  }
}

function fileSafe(s: string): string {
  return s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, ' ');
}

export async function buildJobSheetPdf(
  data: JobSheetData,
  getPhotoUrl: (id: string) => Promise<string | null>,
): Promise<{ blob: Blob; filename: string }> {
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const contentW = pageW - MARGIN * 2;
  const bottom = pageH - MARGIN - 6; // leave room for the page number
  let y = MARGIN;

  const ensure = (h: number) => {
    if (y + h > bottom) {
      doc.addPage();
      y = MARGIN;
    }
  };

  const wrapped = (text: string, width: number, size: number, style: 'normal' | 'bold' = 'normal'): string[] => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    return doc.splitTextToSize(clean(text), width) as string[];
  };
  const lineH = (size: number, factor = 1.35) => (size * 0.3528) * factor; // pt -> mm

  const heading = (label: string) => {
    ensure(14);
    y += 6;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...GREEN);
    doc.text(label, MARGIN, y);
    y += 1.8;
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.25);
    doc.line(MARGIN, y, MARGIN + contentW, y);
    y += 4.5;
  };

  const paragraph = (text: string, size = 10.5) => {
    const lh = lineH(size, 1.45);
    const lines = wrapped(text, contentW, size);
    doc.setTextColor(...INK);
    for (const line of lines) {
      ensure(lh);
      doc.text(line, MARGIN, y);
      y += lh;
    }
  };

  const infoRow = (label: string, value: string) => {
    if (!value.trim()) return;
    const size = 10.5;
    const lh = lineH(size, 1.4);
    const labelW = 26;
    const lines = wrapped(value, contentW - labelW, size);
    ensure(lh);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(size);
    doc.setTextColor(...GRAY);
    doc.text(label, MARGIN, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...INK);
    for (const line of lines) {
      ensure(lh);
      doc.text(line, MARGIN + labelW, y);
      y += lh;
    }
  };

  // ---- header + job info ----
  y += 3;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...GREEN);
  doc.text('FIELD & DESK  -  JOB SHEET', MARGIN, y);
  y += 8;
  const title = data.customer || data.name || 'Job';
  const titleLines = wrapped(title, contentW, 20, 'bold');
  doc.setTextColor(...INK);
  for (const line of titleLines) {
    doc.text(line, MARGIN, y);
    y += lineH(20, 1.2);
  }
  y += 1;
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.6);
  doc.line(MARGIN, y, MARGIN + contentW, y);
  y += 6;

  infoRow('Customer', data.customer);
  infoRow('Date', data.date);
  infoRow('Phone', data.phone);
  infoRow('Email', data.email);
  infoRow('Address', data.address);
  infoRow('Job', data.jobDesc);

  const notes = data.jobNotes.trim();
  if (notes) {
    heading('JOB NOTES');
    paragraph(notes);
  }
  const reminders = data.scratch.filter(s => s.text.trim());
  if (reminders.length) {
    heading('REMINDERS');
    for (const r of reminders) {
      const lines = wrapped(r.text, contentW - 5, 10.5);
      const lh = lineH(10.5, 1.4);
      doc.setTextColor(...INK);
      lines.forEach((line, i) => {
        ensure(lh);
        if (i === 0) doc.text('\u2022', MARGIN + 1, y);
        doc.text(line, MARGIN + 5, y);
        y += lh;
      });
    }
  }

  // ---- pictures: two across, never split a picture across pages ----
  if (data.photos.length) {
    heading('PICTURES (' + data.photos.length + ')');
    const colW = (contentW - GAP) / 2;
    const capPad = 2.5;

    type Cell = { jpeg: { data: string; w: number; h: number } | null; imgW: number; imgH: number; cap: string[]; note: string[]; h: number };
    const prepare = async (idx: number): Promise<Cell> => {
      const p = data.photos[idx];
      const url = await getPhotoUrl(p.id);
      const jpeg = url ? await loadJpeg(url) : null;
      let imgW = 0;
      let imgH = 0;
      if (jpeg) {
        const ratio = Math.min((colW - 0.6) / jpeg.w, MAX_IMG_H / jpeg.h);
        imgW = jpeg.w * ratio;
        imgH = jpeg.h * ratio;
      }
      const cap = wrapped(p.caption || 'Picture ' + (idx + 1), colW - capPad * 2, 10, 'bold');
      const note = p.note.trim() ? wrapped(p.note, colW - capPad * 2, 9) : [];
      const h = (jpeg ? imgH : 0) + capPad * 2 + cap.length * lineH(10, 1.3) + note.length * lineH(9, 1.3) + (note.length ? 1 : 0);
      return { jpeg, imgW, imgH, cap, note, h };
    };

    for (let i = 0; i < data.photos.length; i += 2) {
      const left = await prepare(i);
      const right = i + 1 < data.photos.length ? await prepare(i + 1) : null;
      const rowH = Math.max(left.h, right ? right.h : 0);
      ensure(rowH + 4);
      const draw = (cell: Cell, x: number) => {
        doc.setDrawColor(...LINE);
        doc.setLineWidth(0.25);
        doc.roundedRect(x, y, colW, rowH, 1.5, 1.5);
        let cy = y;
        if (cell.jpeg) {
          doc.addImage(cell.jpeg.data, 'JPEG', x + (colW - cell.imgW) / 2, cy + 0.3, cell.imgW, cell.imgH, undefined, 'FAST');
          cy += cell.imgH + 0.3;
        }
        cy += capPad + 3;
        doc.setTextColor(...INK);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        for (const line of cell.cap) {
          doc.text(line, x + capPad, cy);
          cy += lineH(10, 1.3);
        }
        if (cell.note.length) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9);
          doc.setTextColor(51, 51, 51);
          for (const line of cell.note) {
            doc.text(line, x + capPad, cy);
            cy += lineH(9, 1.3);
          }
        }
      };
      draw(left, MARGIN);
      if (right) draw(right, MARGIN + colW + GAP);
      y += rowH + 4;
    }
  }

  // ---- page numbers ----
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...GRAY);
    doc.text('Page ' + p + ' of ' + pages, pageW - MARGIN, pageH - MARGIN + 2, { align: 'right' });
  }

  const base = fileSafe(data.customer || data.name || 'Job') || 'Job';
  const datePart = fileSafe(data.date);
  const filename = base + ' - Job Sheet' + (datePart ? ' - ' + datePart : '') + '.pdf';
  return { blob: doc.output('blob'), filename };
}