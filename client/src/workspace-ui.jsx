import React, { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { ArrowUpRight, Inbox, Search, X } from 'lucide-react';

export const severities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
export const time = value => value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' }) : '—';
export const shortTime = value => value ? new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '—';
export const scope = (path, id) => id ? path + '?environment=' + encodeURIComponent(id) : path;
export const sourceName = (data, id) => data.environments.find(source => source.id === id)?.label || id;
export const assetKey = asset => JSON.stringify([asset.environment, asset.type, asset.id]);
export const statuses = { succeeded: 'Succeeded', failed: 'Failed', partial: 'Partial coverage', running: 'Running',
  queued: 'Queued', idle: 'Awaiting scan', 'not-connected': 'NOT CONNECTED' };
export const sourceTypes = { fixture: 'FIXTURE', emulator: 'EMULATOR', live: 'LIVE' };
export const connections = { 'not-connected': 'Not connected', connected: 'Connected', unavailable: 'Unavailable',
  configured: 'Configured' };

export function Pill({ value, children }) {
  return <span className={'pill tone-' + value?.toLowerCase()}>{children || value}</span>;
}

export function Panel({ title, icon: Icon, action, children, className = '' }) {
  return <section className={'panel ' + className}>
    <div className="panel-head"><h2>{Icon && <Icon size={17} strokeWidth={1.7} />}{title}</h2>{action}</div>
    {children}
  </section>;
}

export function Empty({ title, children }) {
  return <div className="empty-state"><Inbox size={25} strokeWidth={1.45} /><div><strong>{title}</strong>{children && <p>{children}</p>}</div></div>;
}

export function Table({ headers, rows, empty = 'No records in this environment.' }) {
  if (!rows.length) return <Empty title={empty} />;
  return <div className="table-scroll" tabIndex={0} aria-label={headers[0] + ' table. Scroll horizontally if needed.'}>
    <table><thead><tr>{headers.map((label, index) => <th scope="col" key={label || index}>{label || <span className="sr-only">Details</span>}</th>)}</tr></thead>
      <tbody>{rows.map(({ key, cells }) => <tr key={key}>{cells.map((cell, index) => <td key={index}>{cell ?? '—'}</td>)}</tr>)}</tbody>
    </table>
  </div>;
}

export function DetailButton({ onClick, name }) {
  return <button type="button" className="icon-button detail-button" onClick={onClick} aria-label={'View details for ' + name} title={'View details for ' + name}><ArrowUpRight size={17} /></button>;
}

export function SearchField({ value, onChange, label }) {
  return <label className="search-field"><Search size={17} aria-hidden="true" /><span className="sr-only">{label}</span>
    <input type="search" placeholder={label} value={value} onChange={event => onChange(event.target.value)} />
  </label>;
}

export function Drawer({ title, subtitle, children, close }) {
  const dialog = useRef(null);
  const closeButton = useRef(null);
  useEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement;
    element.showModal();
    closeButton.current?.focus();
    return () => {
      element.close();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);
  return <dialog className="record-drawer" ref={dialog} aria-labelledby="drawer-title"
    onCancel={event => { event.preventDefault(); close(); }}
    onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <motion.div className="drawer-body" initial={{ x: 24, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ duration: .23 }}>
      <header><div><p>{subtitle}</p><h2 id="drawer-title">{title}</h2></div>
        <button className="icon-button" ref={closeButton} onClick={close} aria-label="Close details"><X size={20} /></button></header>
      {children}
    </motion.div>
  </dialog>;
}
