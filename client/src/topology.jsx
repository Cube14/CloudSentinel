import React, { Component, lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { RevealAccent } from './reveal-accent';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Box, Crosshair, Layers3, List, Minus, Plus, Waypoints } from 'lucide-react';
import { connections, Empty, Pill, SearchField, sourceName, sourceTypes, statuses, time } from './workspace-ui';
import { indexTopology, layoutTopology, topologyTypes, visibleNodes } from './topology-model';
import './topology.css';

const Scene = lazy(() => import('./topology-scene'));
const LIMIT = 320;
const PAGE_SIZE = 50;
const describe = node => [topologyTypes[node.asset.type]?.label, node.source?.label || node.asset.environment,
  node.asset.region].filter(Boolean).join(' · ');

function SourceCards({ sources }) {
  return <ul className="topology-sources" id="topology-sources" aria-label="Source states">
    {sources.map(source => <li key={source.id}>
      <span className="topology-source-name">{source.label}</span>
      <small>{source.provider?.toUpperCase()} · {sourceTypes[source.kind]} · {connections[source.connection]}</small>
      <Pill value={source.status}>{statuses[source.status]}</Pill>
      {source.coverage === 'partial' && source.status !== 'partial' && <small>Last snapshot partial</small>}
      <small title={'Last attempt: ' + time(source.lastAttempt)}>Snapshot {time(source.lastSnapshot)}</small>
      {(source.error || !!source.warnings?.length) && <details><summary>Source details</summary>
        {source.error && <p>{source.error}</p>}
        {source.warnings?.map(warning => <p key={JSON.stringify(warning)}>
          {[warning.service, warning.region, warning.operation, warning.code].filter(Boolean).join(' · ')}
          {warning.count > 1 && ' × ' + warning.count}
        </p>)}
      </details>}
    </li>)}
  </ul>;
}

function AssetList({ nodes, selected, select, query }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(nodes.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  useEffect(() => setPage(0), [query]);
  return nodes.length ? <>
    <ul className="topology-inventory" aria-label="Topology resources">
      {nodes.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map(node =>
        <li key={node.id}><button type="button" aria-pressed={selected === node.id} onClick={() => select(node.id)}>
          <Box size={16} strokeWidth={1.6} /><span><strong>{node.asset.name}</strong><small>{describe(node)}</small></span>
          {node.severity && <Pill value={node.severity} />}
        </button></li>)}
    </ul>
    {pages > 1 && <div className="topology-pagination">
      <button className="button secondary small" type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button>
      <span>{currentPage + 1} / {pages}</span>
      <button className="button secondary small" type="button" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Next</button>
    </div>}
  </> : <Empty title="No resources match this scope" />;
}

function Inspector({ node, open }) {
  return <div className="topology-inspector reveal-host">
    <AnimatePresence mode="wait" initial={false}>
      {node ? <motion.div key={node.id} initial={{ opacity: 0, x: 7 }} animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0 }} transition={{ duration: .16 }}>
        <RevealAccent />
        <p className="eyebrow">Selected resource</p>
        <h2>{node.asset.name}</h2>
        <p>{describe(node)} · {sourceTypes[node.asset.source]}</p>
        {node.asset.stale && <p>Last known inventory</p>}
        <motion.div className="topology-risk" key={node.findings.map(f => [f.id, f.severity, f.stale].join(':')).join('|')}
          initial={{ opacity: .58 }} animate={{ opacity: 1 }}>
          {node.severity && <Pill value={node.severity} />}
          <span>{node.findings.length} observed open {node.findings.length === 1 ? 'finding' : 'findings'}</span>
        </motion.div>
        {!!node.findings.length && <p className="topology-evidence">{node.findings[0].title} · {node.findings[0].evidence}</p>}
        <button type="button" className="button secondary small" onClick={() => open({ type: 'asset', id: node.id, topology: true })}>
          Open resource details
        </button>
      </motion.div> : <motion.div key="empty" className="topology-inspector-empty" initial={{ opacity: .6 }} animate={{ opacity: 1 }}>
        <Crosshair size={25} strokeWidth={1.4} /><p>Select a node or resource to inspect its evidence.</p>
      </motion.div>}
    </AnimatePresence>
  </div>;
}

class SceneBoundary extends Component {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  componentDidCatch() { this.props.onFailure(); }
  render() { return this.state.error ? null : this.props.children; }
}

function useStageVisibility(ref) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let intersecting = false;
    const update = () => setVisible(intersecting && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => { intersecting = entry.isIntersecting; update(); });
    observer.observe(ref.current);
    document.addEventListener('visibilitychange', update);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', update); };
  }, [ref]);
  return visible;
}

export function Topology({ data, open, active, scan, scanToken, environment }) {
  const [view, setView] = useState(() => matchMedia('(max-width: 620px)').matches ? 'list' : 'scene');
  const [failed, setFailed] = useState(false);
  const loseScene = useCallback(() => setFailed(true), []);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [selected, select] = useState(null);
  const [command, setCommand] = useState(null);
  const [links, setLinks] = useState(true);
  const stage = useRef(null);
  const labels = useRef(null);
  const visible = useStageVisibility(stage);
  const [activated, setActivated] = useState(false);
  useEffect(() => { if (visible && view === 'scene') setActivated(true); }, [visible, view]);
  const all = useMemo(() => indexTopology(data), [data]);
  const query = useDeferredValue(search.trim().toLowerCase());
  const nodes = all.filter(node => (!type || node.asset.type === type) &&
    [node.asset.name, node.asset.id, describe(node)].some(value => value.toLowerCase().includes(query)));
  const chosen = nodes.find(node => node.id === selected);
  const layoutKey = JSON.stringify(layoutTopology(visibleNodes(nodes, chosen?.id, LIMIT)));
  const graph = useMemo(() => JSON.parse(layoutKey), [layoutKey]);
  const has3D = activated && view === 'scene' && !failed && graph.nodes.length > 0;
  const sceneMode = view === 'scene' && !failed;
  const affected = data.summary.providers.filter(source =>
    ['failed', 'partial', 'not-connected'].includes(source.status) || source.coverage === 'partial' || source.warnings?.length).length;
  function act(action) { setCommand({ action }); }

  return <section className="topology" aria-label="Cloud topology">
    <div className="topology-heading">
      <div><p className="eyebrow"><Waypoints size={15} /> Resource topology</p><p>Explore discovered resources by provider, environment, and type.</p>
        {affected > 0 && <a className="topology-source-link text-link" href="#topology-sources">
          {affected} {affected === 1 ? 'source needs' : 'sources need'} attention
        </a>}
      </div>
      <div className="topology-mode" aria-label="Topology display">
        <button type="button" aria-pressed={sceneMode} disabled={failed} onClick={() => setView('scene')}><Layers3 size={16} /> 3D view</button>
        <button type="button" aria-pressed={!sceneMode} onClick={() => setView('list')}><List size={16} /> Asset list</button>
      </div>
    </div>
    <div className="topology-filters">
      <SearchField label="Search topology assets" value={search} onChange={setSearch} />
      <label><span className="sr-only">Resource type</span><select value={type} onChange={event => setType(event.target.value)}>
        <option value="">All resource types</option>
        {Object.entries(topologyTypes).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
      </select></label>
      <span className="topology-count" aria-live="polite">{nodes.length} {nodes.length === 1 ? 'resource' : 'resources'}</span>
    </div>
    {failed && <p className="topology-notice" role="status">3D rendering is unavailable. Use the asset list to inspect resources.</p>}
    <div className={'topology-board' + (sceneMode ? '' : ' topology-list-mode')}>
      <div className="topology-stage" ref={stage} hidden={!sceneMode} tabIndex={has3D ? 0 : undefined}
        role="group" aria-label="3D topology camera. Arrow keys orbit or zoom. Shift and left or right arrow pans."
        onKeyDown={event => {
          if (!has3D || event.target !== event.currentTarget || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
          event.preventDefault();
          const direction = event.key === 'ArrowLeft' ? 'left' : 'right';
          act(event.key === 'Home' ? 'reset' : event.key === 'ArrowUp' ? 'in' : event.key === 'ArrowDown' ? 'out' :
            (event.shiftKey ? 'pan-' : 'orbit-') + direction);
        }}>
        {!nodes.length ? <Empty title="No resources in this view"><span>Review the source status or change your filters.</span></Empty> :
          <>
            <div className="topology-canvas">
              {has3D ? <SceneBoundary onFailure={loseScene}>
                <Suspense fallback={<p className="topology-loading" role="status">Loading 3D topology…</p>}>
                  <Scene graph={graph} selected={chosen?.id} select={select} command={command} visible={visible}
                    showLinks={links} labels={labels} onFailure={loseScene} scope={environment} scanToken={scanToken} />
                </Suspense>
              </SceneBoundary> : <p className="topology-loading">Preparing 3D topology…</p>}
            </div>
            <div className="topology-labels" aria-hidden="true" ref={labels}>
              {graph.platforms.slice(0, 12).map(group => <span key={group.id} hidden>{group.label} · {sourceTypes[group.source]}</span>)}
            </div>
            <div className="topology-viewport-tools">
              <button type="button" className="icon-button" aria-label="Reset camera" title="Reset camera" onClick={() => act('reset')}><Crosshair size={19} /></button>
              <button type="button" className="icon-button" aria-label="Zoom in" title="Zoom in" onClick={() => act('in')}><Plus size={19} /></button>
              <button type="button" className="icon-button" aria-label="Zoom out" title="Zoom out" onClick={() => act('out')}><Minus size={19} /></button>
            </div>
            <div className="topology-scene-caption">
              {active || scan.tone !== 'ready' ? <span>{scan.label}</span> : <>
                <span className="topology-mouse-hint">Drag to orbit · scroll to zoom · right-drag to pan</span>
                <span className="topology-touch-hint">Drag to orbit · pinch to zoom · two fingers to pan</span>
              </>}
              {nodes.length > LIMIT && <span>Showing {LIMIT} of {nodes.length} in 3D. Filter or select from the list.</span>}
            </div>
          </>}
      </div>
      <aside className="topology-review">
        <Inspector node={chosen} open={open} />
        <div className="topology-list-header"><h2>Resource index</h2><span>{nodes.length}</span></div>
        <AssetList {...{ nodes, selected: chosen?.id, select, query: query + type }} />
      </aside>
    </div>
    <div className="topology-legend">
      {Object.entries(topologyTypes).map(([key, value]) => <span key={key} className={'topology-key is-' + key}><i />{value.label}</span>)}
      {nodes.some(node => node.severity === 'CRITICAL') && <span className="topology-key is-critical"><i />Critical finding</span>}
      {sceneMode && !!graph.links.length && <label><input type="checkbox" checked={links} onChange={event => setLinks(event.target.checked)} />
        Observed references ({graph.links.length})</label>}
    </div>
    <p className="topology-caption">{graph.links.length ? 'Lines show collected security group attachments and ingress references.' :
      'Resources are spatially grouped. No relationships were established for this view.'}</p>
    <SourceCards sources={data.summary.providers} />
  </section>;
}

function PreviewMap({ graph, assets, selected, select }) {
  const width = Math.max(1, graph.width);
  const depth = Math.max(1, graph.depth);
  return <svg className="topology-preview-map" viewBox={[-width / 2, -depth / 2, width, depth].join(' ')}
    role="group" aria-label="Select a resource from the topology preview">
    {graph.platforms.map(group => <rect key={group.id} x={group.x} y={group.z} width={group.width} height={group.depth} rx=".45" />)}
    {graph.nodes.map(node => {
      const [x, , y] = node.position;
      const asset = assets.get(node.id);
      return <g key={node.id} role="button" tabIndex={0} aria-label={'Select ' + asset.name}
        aria-pressed={selected === node.id} onClick={() => select(node.id)} onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(node.id); }
        }} className={node.severity === 'CRITICAL' ? 'critical-node' : ''}>
        <title>{asset.name}</title><circle cx={x} cy={y} r=".7" className="preview-hit" /><circle cx={x} cy={y} r=".34" />
      </g>;
    })}
  </svg>;
}

export function TopologyPreview({ data, open, scan, scanToken, environment }) {
  const stage = useRef(null);
  const labels = useRef(null);
  const visible = useStageVisibility(stage);
  const [activated, activate] = useState(false);
  const [flat, setFlat] = useState(() => matchMedia('(max-width: 620px), (prefers-reduced-motion: reduce)').matches);
  const [failed, setFailed] = useState(false);
  const [selection, setSelection] = useState(null);
  const [command, setCommand] = useState(null);
  const loseScene = useCallback(() => setFailed(true), []);
  const select = useCallback(id => setSelection({ scope: environment, id }), [environment]);
  useEffect(() => { if (visible && !flat) activate(true); }, [visible, flat]);
  const all = useMemo(() => indexTopology(data), [data]);
  const assets = useMemo(() => new Map(all.map(node => [node.id, node.asset])), [all]);
  const chosen = selection?.scope === environment ? assets.get(selection.id) : null;
  const layoutKey = JSON.stringify(layoutTopology(visibleNodes(all, chosen && selection.id, 36)));
  const graph = useMemo(() => JSON.parse(layoutKey), [layoutKey]);
  const map = <PreviewMap graph={graph} assets={assets} selected={chosen && selection.id} select={select} />;
  const show3D = activated && !flat && !failed && !!all.length;

  return <section className="constellation" aria-labelledby="constellation-title" data-scan={scan.tone}>
    <div className="constellation-stage" ref={stage}>
      {show3D ? <SceneBoundary onFailure={loseScene}>
        <Suspense fallback={map}>
          <Scene graph={graph} selected={chosen && selection.id} preview {...{ select, visible, command, scanToken }}
            scope={environment} showLinks labels={labels} onFailure={loseScene} />
        </Suspense>
      </SceneBoundary> : all.length ? map : <div className="constellation-void" aria-hidden="true" />}
      {show3D && <div className="topology-labels" aria-hidden="true" ref={labels}>
        {graph.platforms.slice(0, 6).map(group => <span key={group.id} hidden>{group.label}</span>)}
      </div>}
    </div>
    <div className="constellation-copy">
      <p className="eyebrow"><Waypoints size={15} /> Cloud inventory</p>
      <h2 id="constellation-title">Cloud<br />constellation</h2>
      <p>{all.length ? <><strong>{all.length}</strong> discovered {all.length === 1 ? 'resource' : 'resources'}</> :
        'Inventory appears after a source returns its first snapshot.'}</p>
      <Link className="button secondary small" to="/workspace/topology">Explore topology <Layers3 size={15} /></Link>
    </div>
    <div className="constellation-tools" aria-label="Constellation controls">
      {show3D && <button type="button" className="icon-button" aria-label="Reset constellation camera" onClick={() => {
        setSelection(null);
        setCommand({ action: 'reset' });
      }}><Crosshair size={17} /></button>}
      {!!all.length && !failed && <button type="button" className="constellation-mode" onClick={() => setFlat(!flat)}>
        {flat ? '3D view' : '2D view'}
      </button>}
    </div>
    {chosen && <div className="constellation-selection reveal-host" key={chosen.id}>
      <RevealAccent />
      <strong>{chosen.name}</strong>
      <small>{sourceName(data, chosen.environment)} · {sourceTypes[chosen.source]}</small>
      <button type="button" className="text-link" onClick={() => open({ type: 'asset', id: selection.id, topology: true })}>Resource details</button>
    </div>}
    <div className="constellation-footer">
      <span className="constellation-state" role="status" key={scan.tone}><i />{scan.label}</span>
      <span>{failed ? '3D unavailable · 2D view' : all.length > graph.nodes.length ? graph.nodes.length + ' shown' :
        show3D ? 'Drag to orbit' : all.length ? 'Select a resource' : 'No observed resources'}</span>
    </div>
  </section>;
}
