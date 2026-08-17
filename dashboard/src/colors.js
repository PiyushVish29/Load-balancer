const PALETTE = ['#38bdf8', '#a78bfa', '#fb923c', '#34d399', '#f472b6', '#facc15'];

const assigned = new Map();
let nextIndex = 0;

// Assigns each backend id a stable color the first time it's seen, so a
// server's line/dot color never changes across re-renders or new charts.
export function colorForBackend(id) {
  if (!assigned.has(id)) {
    assigned.set(id, PALETTE[nextIndex % PALETTE.length]);
    nextIndex += 1;
  }
  return assigned.get(id);
}
