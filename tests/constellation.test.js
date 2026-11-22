const test = require('node:test');
const assert = require('node:assert/strict');

test('constellation reports observed scan state without turning previous snapshots into current success', async () => {
  const { constellationState } = await import('../client/src/constellation-state.js');
  const lastScan = '2026-11-23T09:00:00Z';
  assert.equal(constellationState({}).tone, 'idle');
  assert.equal(constellationState({ lastScan }).tone, 'ready');
  assert.equal(constellationState({ lastScan, disconnected: true }).tone, 'disconnected');
  assert.equal(constellationState({ lastScan, partial: true }).tone, 'partial');
  assert.equal(constellationState({ lastScan, partial: true, failed: true }).tone, 'failed');
  assert.equal(constellationState({ lastScan, failed: true, requesting: true }).label, 'Scan requested');
  assert.equal(constellationState({ lastScan, failed: true, requesting: true, active: true }).label, 'Scan in progress');
});
