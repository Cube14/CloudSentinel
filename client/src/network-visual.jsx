import React, { lazy, Suspense } from 'react';
import { Box, ScanLine } from 'lucide-react';

const Scene = lazy(() => import('./network-scene'));

function Still() {
  return <div className="network-still" aria-hidden="true"><Box size={120} strokeWidth={.6} /></div>;
}

export function NetworkVisual({ auth = false, camera }) {
  return <div className={'network-visual' + (auth ? ' network-auth' : '')}>
    <div className="network-grid" aria-hidden="true" />
    <div className="network-align" aria-hidden="true"><ScanLine size={19} strokeWidth={1} /></div>
    <Suspense fallback={<Still />}><Scene auth={auth} camera={camera} /></Suspense>
    <div className="network-caption" aria-hidden="true"><span /> CLOUD NETWORK ILLUSTRATION</div>
  </div>;
}
