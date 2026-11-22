export function constellationState({ requesting, active, failed, partial, disconnected, lastScan }) {
  if (requesting && !active) return { tone: 'active', label: 'Scan requested' };
  if (active) return { tone: 'active', label: 'Scan in progress' };
  if (failed) return { tone: 'failed', label: 'Scan failed' };
  if (partial) return { tone: 'partial', label: 'Partial coverage' };
  if (disconnected) return { tone: 'disconnected', label: 'Source disconnected' };
  return lastScan ? { tone: 'ready', label: 'Snapshot available' } : { tone: 'idle', label: 'Awaiting snapshot' };
}
