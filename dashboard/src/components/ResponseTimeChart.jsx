import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { colorForBackend } from '../colors';

export default function ResponseTimeChart({ data, backendIds }) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">Response time per server (live, ms)</p>
      <div className="mt-2 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="time" tick={{ fill: '#94a3b8', fontSize: 11 }} minTickGap={20} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {backendIds.map((id) => (
              <Line
                key={id}
                type="monotone"
                dataKey={id}
                stroke={colorForBackend(id)}
                dot={false}
                strokeWidth={2}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
