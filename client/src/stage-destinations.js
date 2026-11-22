const locations = {
  '': { title: 'Cloud', accent: 'Atlas', reel: 'vault', azimuth: .08, elevation: .51, distance: .99 },
  environments: { title: 'Source', accent: 'Stations', reel: 'vault', azimuth: -.49, elevation: .67, distance: 1.12 },
  topology: { title: 'Resource', accent: 'Topology', reel: 'signal', azimuth: .56, elevation: .72, distance: 1.12 },
  findings: { title: 'Finding', accent: 'Signals', reel: 'signal', azimuth: -.38, elevation: .39, distance: .94 },
  assets: { title: 'Asset', accent: 'Registry', reel: 'vault', azimuth: .44, elevation: .49, distance: 1.04 },
  identity: { title: 'Identity', accent: 'Access', reel: 'signal', azimuth: .68, elevation: .36, distance: 1.07 },
  threats: { title: 'Incident', accent: 'Trace', reel: 'trace', azimuth: -.66, elevation: .40, distance: 1.03 },
  analyst: { title: 'Evidence', accent: 'Analyst', reel: 'trace', azimuth: .32, elevation: .33, distance: .94 },
  audit: { title: 'Audit', accent: 'Archive', reel: 'vault', azimuth: -.21, elevation: .87, distance: 1.08 },
};

export const stageDestination = route => locations[route] ?? locations[''];
