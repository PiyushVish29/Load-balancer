import { useDashboard } from './hooks/useDashboard';
import BackendCard from './components/BackendCard';
import GlobalStats from './components/GlobalStats';
import AlgorithmControl from './components/AlgorithmControl';
import RequestsChart from './components/RequestsChart';
import ResponseTimeChart from './components/ResponseTimeChart';
import LogPanel from './components/LogPanel';

export default function App() {
  const { connected, pool, stats, logs, requestChartData, responseTimeChartData, switchAlgorithm } = useDashboard();
  const backendIds = pool.map((server) => server.id);

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-6 sm:px-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Load Balancer Dashboard</h1>
          <p className="text-sm text-slate-500">Live view of backend health, traffic, and routing</p>
        </div>
        <span
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
            connected ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
          {connected ? 'Live' : 'Disconnected'}
        </span>
      </header>

      <section className="mb-6">
        <GlobalStats stats={stats} />
      </section>

      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {pool.map((server) => (
          <BackendCard key={server.id} server={server} />
        ))}
      </section>

      <section className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RequestsChart data={requestChartData} backendIds={backendIds} />
        <ResponseTimeChart data={responseTimeChartData} backendIds={backendIds} />
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <AlgorithmControl algorithm={stats.algorithm} onSwitch={switchAlgorithm} />
        </div>
        <div className="lg:col-span-2">
          <LogPanel logs={logs} />
        </div>
      </section>
    </div>
  );
}
