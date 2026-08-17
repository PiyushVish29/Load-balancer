export default function BackendCard({ server }) {
  const up = server.isAlive;

  return (
    <div
      className={`rounded-xl border bg-slate-800/60 p-4 shadow-sm transition-colors duration-300 ${
        up ? 'border-green-500/40' : 'border-red-500/50'
      }`}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-100">{server.id}</h3>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
            up ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${up ? 'bg-green-500' : 'bg-red-500'}`} />
          {up ? 'UP' : 'DOWN'}
        </span>
      </div>

      <p className="mt-1 text-sm text-slate-400">
        {server.host}:{server.port}
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-slate-500">Active connections</dt>
          <dd className="text-lg font-medium text-slate-100">{server.activeConnections}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Total requests</dt>
          <dd className="text-lg font-medium text-slate-100">{server.totalRequests}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-slate-500">Avg response time</dt>
          <dd className="text-lg font-medium text-slate-100">
            {server.avgResponseTimeMs != null ? `${server.avgResponseTimeMs} ms` : '—'}
          </dd>
        </div>
      </dl>
    </div>
  );
}
