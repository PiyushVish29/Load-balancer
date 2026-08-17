import { useState } from 'react';

const OPTIONS = [
  { value: 'round-robin', label: 'Round Robin' },
  { value: 'least-connections', label: 'Least Connections' }
];

export default function AlgorithmControl({ algorithm, onSwitch }) {
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);

  async function handleClick(value) {
    if (value === algorithm || pending) {
      return;
    }
    setPending(value);
    setError(null);
    try {
      await onSwitch(value);
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">Algorithm</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {OPTIONS.map((opt) => {
          const active = algorithm === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleClick(opt.value)}
              disabled={pending !== null}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                active ? 'bg-blue-500 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              {opt.label}
              {pending === opt.value ? '…' : ''}
            </button>
          );
        })}
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
