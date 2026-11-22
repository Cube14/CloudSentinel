import React from 'react';
import { Link } from 'react-router-dom';
import { ScanLine } from 'lucide-react';

export function Brand() {
  return <Link to="/" className="brand" aria-label="CloudSentinel home">
    <span className="brand-symbol"><ScanLine size={22} strokeWidth={1.65} /></span>
    <span>Cloud<span className="brand-contrast">Sentinel</span></span>
  </Link>;
}
