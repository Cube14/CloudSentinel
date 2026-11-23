export const destinations = [
  { id: 'overview', title: 'Overview', subtitle: 'Cloud posture', tone: '#8faed3', style: 'posture' },
  { id: 'environments', title: 'Environments', subtitle: 'Connected sources', tone: '#83b8bf', style: 'sources' },
  { id: 'findings', title: 'Findings', subtitle: 'Risk and evidence', tone: '#b9a2cf', style: 'signals' },
  { id: 'assets', title: 'Assets', subtitle: 'Resource inventory', tone: '#7cabeb', style: 'inventory' },
  { id: 'identity', title: 'Identity', subtitle: 'Access and permissions', tone: '#a5a4dd', style: 'access' },
  { id: 'threats', title: 'Threats', subtitle: 'Recorded incident chains', tone: '#c7a98b', style: 'incidents' },
  { id: 'analyst', title: 'AI Analyst', subtitle: 'Investigate recorded evidence', tone: '#8ec3c6', style: 'analysis' },
  { id: 'audit', title: 'Audit', subtitle: 'Workspace event history', tone: '#b1bdd0', style: 'history' },
];

export function wrapIndex(value) {
  return ((Math.round(value) % destinations.length) + destinations.length) % destinations.length;
}

export function nearestOffset(offset, index) {
  return index + Math.round((offset - index) / destinations.length) * destinations.length;
}

export function destinationFromPath(pathname) {
  const route = pathname.split('/')[2];
  if (route === 'topology') return destinations[3];
  return destinations.find(destination => destination.id === route) || null;
}

export const phases = Object.freeze({
  idle: 'CAROUSEL_IDLE',
  rotating: 'CAROUSEL_ROTATING',
  selected: 'DESTINATION_SELECTED',
  entering: 'ENTERING',
  page: 'PAGE_ACTIVE',
  exiting: 'EXITING',
  returning: 'RETURNING',
});
