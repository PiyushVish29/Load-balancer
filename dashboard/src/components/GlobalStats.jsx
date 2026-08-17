function StatTile({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-100">{value}</p>
    </div>
  );
}

export default function GlobalStats({ stats }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatTile label="Total requests" value={stats.totalRequests} />
      <StatTile label="Requests / sec" value={stats.requestsPerSecond} />
      <StatTile
        label="Avg response time"
        value={stats.avgResponseTimeMs != null ? `${stats.avgResponseTimeMs} ms` : '—'}
      />
      <StatTile label="Algorithm" value={stats.algorithm ?? '—'} />
    </div>
  );
}
