import { useEffect, useRef } from 'react';

const LEVEL_COLORS = {
  INFO: 'text-slate-300',
  WARN: 'text-amber-400',
  ERROR: 'text-red-400'
};

export default function LogPanel({ logs }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const el = containerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">Live logs</p>
      <div
        ref={containerRef}
        className="scroll-thin mt-2 h-72 overflow-y-auto rounded-lg bg-black/40 p-3 font-mono text-xs leading-relaxed"
      >
        {logs.length === 0 && <p className="text-slate-600">Waiting for logs...</p>}
        {logs.map((entry, i) => (
          <div key={i} className={LEVEL_COLORS[entry.level] || 'text-slate-300'}>
            <span className="text-slate-600">{new Date(entry.timestamp).toLocaleTimeString()}</span>{' '}
            <span className="font-semibold">[{entry.level}]</span> {entry.message}
          </div>
        ))}
      </div>
    </div>
  );
}
