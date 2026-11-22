export const topologyTypes = {
  compute: { label: 'Compute', color: '#a6d8f5' },
  storage: { label: 'Storage', color: '#79b8ec' },
  identity: { label: 'Identity', color: '#b2c4ea' },
  firewall: { label: 'Firewall', color: '#84a7d7' }
};

const types = Object.keys(topologyTypes);
const severity = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const spacing = 1.5;
const sourceKey = asset => JSON.stringify([asset.provider, asset.environment]);
export const assetKey = asset => JSON.stringify([asset.environment, asset.type, asset.id]);
const findingKey = value => JSON.stringify([value.provider, value.environment, value.resourceId ?? value.id]);
const localGroupKey = (asset, id) => JSON.stringify([asset.provider, asset.environment, asset.region || '', id]);

export function indexTopology(data) {
  const byResource = new Map();
  const byFinding = new Map();
  const bySource = new Map(data.environments.map(source => [source.id, source]));
  const nodes = data.assets.map(asset => {
    const id = assetKey(asset);
    const key = findingKey(asset);
    const candidates = byResource.get(key) || [];
    candidates.push(asset);
    byResource.set(key, candidates);
    return { id, asset, source: bySource.get(asset.environment), findings: [] };
  });
  for (const finding of data.findings) {
    const candidates = (byResource.get(findingKey(finding)) || []).filter(asset =>
      (!finding.region || finding.region === asset.region) && (!finding.source || finding.source === asset.source));
    if (candidates.length !== 1) continue;
    const key = assetKey(candidates[0]);
    const matches = byFinding.get(key) || [];
    matches.push(finding);
    byFinding.set(key, matches);
  }
  for (const node of nodes) {
    node.findings = byFinding.get(node.id) || [];
    node.severity = severity.find(level => node.findings.some(finding => finding.severity === level));
  }
  return nodes.sort((a, b) => sourceKey(a.asset).localeCompare(sourceKey(b.asset)) ||
    types.indexOf(a.asset.type) - types.indexOf(b.asset.type) || a.asset.name.localeCompare(b.asset.name) || a.id.localeCompare(b.id));
}

export function topologyLinks(nodes) {
  const groups = new Map();
  for (const { id, asset } of nodes) {
    if (asset.type !== 'firewall' || asset.stale) continue;
    const key = localGroupKey(asset, asset.nativeId || asset.id);
    groups.set(key, groups.has(key) ? null : id);
  }
  const links = new Map();
  for (const { id, asset } of nodes) {
    if (asset.stale) continue;
    const attached = asset.type === 'compute' && Array.isArray(asset.securityGroups) ? asset.securityGroups : [];
    const references = asset.type === 'firewall' && Array.isArray(asset.ingress) ? asset.ingress.flatMap(rule =>
      Array.isArray(rule.referencedGroups) ? rule.referencedGroups : []) : [];
    for (const [kind, ids] of [['Attached security group', attached], ['Ingress security group reference', references]]) {
      for (const nativeId of ids) {
        if (typeof nativeId !== 'string') continue;
        const target = groups.get(localGroupKey(asset, nativeId));
        if (target && target !== id) links.set(JSON.stringify([id, target, kind]), { from: id, to: target, kind });
      }
    }
  }
  return [...links.values()];
}

export function visibleNodes(nodes, selected, limit) {
  if (nodes.length <= limit) return nodes;
  const sources = new Map();
  for (const node of nodes) {
    const key = sourceKey(node.asset);
    if (!sources.has(key)) sources.set(key, []);
    sources.get(key).push(node);
  }
  const visible = [];
  for (let row = 0; visible.length < limit; row++) {
    for (const assets of sources.values()) {
      if (row < assets.length) visible.push(assets[row]);
      if (visible.length === limit) break;
    }
  }
  if (selected && !visible.some(node => node.id === selected)) {
    const match = nodes.find(node => node.id === selected);
    if (match) visible[visible.length - 1] = match;
  }
  return visible;
}

export function layoutTopology(nodes) {
  const grouped = new Map();
  for (const node of nodes) {
    const key = sourceKey(node.asset);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(node);
  }
  const groups = [...grouped.entries()].map(([id, members]) => {
    let width = 2;
    let depth = 5;
    const placed = types.flatMap(type => {
      const list = members.filter(node => node.asset.type === type);
      if (!list.length) return [];
      const columns = Math.min(list.length, Math.ceil(Math.sqrt(list.length)));
      const rows = Math.ceil(list.length / columns);
      const start = width + .5;
      width += columns * spacing + 1.45;
      depth = Math.max(depth, rows * spacing + 2.9);
      return list.map(({ id, severity, asset }, index) => ({
        id, type, severity, stale: Boolean(asset.stale),
        position: [start + (index % columns) * spacing, .64, 2 + Math.floor(index / columns) * spacing]
      }));
    });
    return { id, placed, label: members[0].source?.label || members[0].asset.environment,
      source: members[0].asset.source, provider: members[0].asset.provider, width, depth };
  });

  const columns = Math.ceil(Math.sqrt(groups.length || 1));
  const rows = Math.ceil(groups.length / columns);
  const widths = Array.from({ length: columns }, (_, index) => Math.max(0, ...groups
    .filter((_, i) => i % columns === index).map(group => group.width)) + 3);
  const depths = Array.from({ length: rows }, (_, index) => Math.max(...groups
    .slice(index * columns, (index + 1) * columns).map(group => group.depth)) + 3);
  const width = widths.reduce((sum, value) => sum + value, 0);
  const depth = depths.reduce((sum, value) => sum + value, 0);
  const platforms = [];
  const placed = groups.flatMap(({ placed, ...group }, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = widths.slice(0, column).reduce((sum, value) => sum + value, -width / 2);
    const top = depths.slice(0, row).reduce((sum, value) => sum + value, -depth / 2);
    platforms.push({ ...group, x: left, z: top });
    return placed.map(node => ({ ...node, position: [node.position[0] + left, node.position[1], node.position[2] + top] }));
  });
  const ids = new Set(placed.map(node => node.id));
  return { nodes: placed, platforms, width, depth, links: topologyLinks(nodes)
    .filter(link => ids.has(link.from) && ids.has(link.to)).slice(0, 640) };
}
