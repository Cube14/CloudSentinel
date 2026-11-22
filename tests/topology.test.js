'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const model = import('../client/src/topology-model.js');

const base = { provider: 'aws', environment: 'a', region: 'us-east-1', source: 'live' };
const compute = { ...base, id: 'east:vm', type: 'compute', name: 'vm', securityGroups: ['sg-web', 'unknown'] };
const firewall = { ...base, id: 'east:sg-web', nativeId: 'sg-web', type: 'firewall', name: 'web',
  ingress: [{ referencedGroups: ['sg-peer', 'sg-web'] }] };
const peer = { ...base, id: 'east:sg-peer', nativeId: 'sg-peer', type: 'firewall', name: 'peer' };

test('topology uses only same-provider, same-environment, same-region recorded references', async () => {
  const { indexTopology, topologyLinks, assetKey } = await model;
  const copied = { ...peer, id: 'west:sg-peer', region: 'us-west-2' };
  const other = { ...firewall, environment: 'b' };
  const nodes = indexTopology({ assets: [compute, firewall, peer, other, copied], findings: [], environments: [] });
  assert.deepEqual(topologyLinks(nodes), [
    { from: assetKey(compute), to: assetKey(firewall), kind: 'Attached security group' },
    { from: assetKey(firewall), to: assetKey(peer), kind: 'Ingress security group reference' }
  ]);
  assert.deepEqual(topologyLinks(nodes.filter(node => node.asset !== firewall)), []);
  const stale = indexTopology({ assets: [compute, { ...firewall, stale: true }, peer], findings: [], environments: [] });
  assert.deepEqual(topologyLinks(stale), []);
});

test('topology risk ignores ambiguous resource IDs and displays actual source provenance', async () => {
  const { indexTopology } = await model;
  const finding = { ...base, id: 'f-1', resourceId: compute.id, severity: 'CRITICAL' };
  const source = { id: 'a', label: 'Read-only account', kind: 'live' };
  const indexed = indexTopology({ assets: [compute, { ...compute, environment: 'b' }],
    findings: [finding], environments: [source] });
  assert.equal(indexed[0].severity, 'CRITICAL');
  assert.equal(indexed[0].source.label, 'Read-only account');
  assert.equal(indexed[1].severity, undefined);
  const ambiguous = indexTopology({ assets: [compute, { ...compute, type: 'identity' }], findings: [finding], environments: [] });
  assert.ok(ambiguous.every(node => node.findings.length === 0));
});

test('graph cap retains a selected resource and layout groups only real nodes', async () => {
  const { assetKey, indexTopology, layoutTopology, visibleNodes } = await model;
  const nodes = indexTopology({ assets: [compute, firewall, peer], findings: [], environments: [] });
  const visible = visibleNodes(nodes, assetKey(firewall), 2);
  const graph = layoutTopology(visible);
  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.platforms.length, 1);
  assert.ok(graph.nodes.every(node => visible.some(item => item.id === node.id)));
  assert.ok(graph.nodes.some(node => node.id === assetKey(firewall)));
  assert.ok(graph.links.every(link => graph.nodes.some(node => node.id === link.from) &&
    graph.nodes.some(node => node.id === link.to)));
  assert.deepEqual(layoutTopology([]).nodes, []);
});
