// Design Studio - the room drawing screen (replaces the old Design side).
// Stage 0: placeholder shell so the app wiring is in place. The drawing arrives in the next stages.
import type { CSSProperties } from 'react';

const bar: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px',
  background: 'var(--ink)', borderBottom: '1px solid rgba(238,241,238,0.12)', color: 'var(--cream)',
};
const btn: CSSProperties = {
  minHeight: '44px', padding: '0 16px', borderRadius: '10px', cursor: 'pointer', fontWeight: 700, fontSize: '15px',
  border: '1px solid rgba(238,241,238,0.25)', background: 'rgba(238,241,238,0.06)', color: 'var(--cream)',
};

export default function DesignStudio({ jobName, onHome, onCapture }: { jobName: string; onHome: () => void; onCapture: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 900, background: 'var(--ink)', display: 'flex', flexDirection: 'column' }}>
      <div style={bar}>
        <button onClick={onHome} style={btn}>Home</button>
        <div style={{ flex: 1, fontWeight: 800, fontSize: '17px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {jobName || 'Design Studio'}
        </div>
        <button onClick={onCapture} style={btn}>Capture</button>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', padding: '24px', textAlign: 'center' }}>
        Design Studio is being rebuilt. The room drawing goes here.
      </div>
    </div>
  );
}
