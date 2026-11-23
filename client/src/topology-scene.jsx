import React, { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Color, Object3D, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { useReducedMotion } from 'motion/react';
import { buildResource, waveVertex, waveFragment } from './topology-art';
import { topologyTypes } from './topology-model';

const cameraSettings = { position: [18, 23, 28], fov: 40, near: .1, far: 2000 };
const homeDirection = new Vector3(.23, 1, 1.05).normalize();
const verticalAxis = new Vector3(0, 1, 0);
const floorAngle = [-Math.PI / 2, 0, 0];
const critical = '#ee686c';

function viewportDistance(camera, aspect, graph) {
  const radius = Math.hypot(graph.width, graph.depth) / 2;
  const vertical = Math.tan(camera.fov * Math.PI / 360);
  return Math.max(12, radius / (vertical * Math.min(1, aspect)) * .86);
}

function CameraRig({ width, depth, selected, command, reduced, visible, onFailure, scope }) {
  const { camera, gl, invalidate, size } = useThree();
  const controls = useRef(null);
  const move = useRef(null);
  const distance = useRef(20);
  const [selectedX, selectedY, selectedZ] = selected || [];

  useEffect(() => {
    const orbit = new OrbitControls(camera, gl.domElement);
    orbit.enableDamping = !reduced;
    orbit.dampingFactor = .12;
    orbit.minDistance = 3;
    orbit.maxPolarAngle = Math.PI / 2.16;
    const stopMove = () => { move.current = null; };
    const lost = () => onFailure();
    orbit.addEventListener('change', invalidate);
    orbit.addEventListener('start', stopMove);
    gl.domElement.addEventListener('webglcontextlost', lost);
    controls.current = orbit;
    return () => {
      orbit.removeEventListener('change', invalidate);
      orbit.removeEventListener('start', stopMove);
      gl.domElement.removeEventListener('webglcontextlost', lost);
      orbit.dispose();
      controls.current = null;
    };
  }, [camera, gl, invalidate, reduced, onFailure]);

  function travel(target, position) {
    const orbit = controls.current;
    if (!orbit) return;
    if (reduced) {
      move.current = null;
      orbit.target.copy(target);
      camera.position.copy(position);
      orbit.update();
    } else {
      move.current = { target, position };
    }
    invalidate();
  }

  useEffect(() => {
    if (!controls.current || !size.height) return;
    distance.current = viewportDistance(camera, size.width / size.height, { width, depth });
    controls.current.maxDistance = distance.current * 2.15;
    travel(new Vector3(), homeDirection.clone().multiplyScalar(distance.current));
  }, [width, depth, size.width, size.height, reduced, scope]);

  useEffect(() => {
    if (selectedX === undefined || !controls.current) return;
    const target = new Vector3(selectedX, selectedY, selectedZ);
    const direction = camera.position.clone().sub(controls.current.target).normalize();
    const near = Math.min(11, distance.current * .64);
    travel(target, target.clone().addScaledVector(direction, near));
  }, [selectedX, selectedY, selectedZ, reduced]);

  useEffect(() => {
    if (!command || !controls.current) return;
    if (command.action === 'reset') {
      travel(new Vector3(), homeDirection.clone().multiplyScalar(distance.current));
      return;
    }
    const target = controls.current.target.clone();
    const offset = camera.position.clone().sub(target);
    const side = command.action.endsWith('left') ? -1 : 1;
    if (command.action.startsWith('orbit-')) {
      travel(target, target.clone().add(offset.applyAxisAngle(verticalAxis, side * .26)));
      return;
    }
    if (command.action.startsWith('pan-')) {
      target.addScaledVector(new Vector3().crossVectors(verticalAxis, offset).normalize(), side * offset.length() * .12);
      travel(target, target.clone().add(offset));
      return;
    }
    offset.setLength(Math.max(3, Math.min(controls.current.maxDistance, offset.length() *
      (command.action === 'in' ? .76 : 1.31))));
    travel(target, target.clone().add(offset));
  }, [command]);

  useEffect(() => { if (visible) invalidate(); }, [visible, invalidate]);
  useFrame((_, delta) => {
    const orbit = controls.current;
    if (!orbit) return;
    const next = move.current;
    if (next) {
      const step = 1 - Math.exp(-Math.min(.05, Math.max(delta, .001)) * 10);
      camera.position.lerp(next.position, step);
      orbit.target.lerp(next.target, step);
      if (camera.position.distanceToSquared(next.position) + orbit.target.distanceToSquared(next.target) < .0001) {
        camera.position.copy(next.position);
        orbit.target.copy(next.target);
        move.current = null;
      } else invalidate();
    }
    orbit.update();
  });
  return null;
}

function ResourceBatch({ nodes, type, select, hover, pulse, depth }) {
  const body = useRef(null);
  const trim = useRef(null);
  const invalidate = useThree(state => state.invalidate);
  const geometry = useMemo(() => buildResource(type), [type]);
  const colors = useMemo(() => nodes.map(node => new Color(
    node.severity === 'CRITICAL' ? critical : topologyTypes[type].color).multiplyScalar(node.stale ? .52 : .88)), [nodes, type]);
  const color = useMemo(() => new Color(), []);
  const lit = useRef(false);

  useEffect(() => () => geometry.forEach(part => part.dispose()), [geometry]);
  useLayoutEffect(() => {
    const transform = new Object3D();
    nodes.forEach((node, index) => {
      transform.position.set(...node.position);
      transform.scale.setScalar(node.stale ? .98 : 1.32);
      transform.rotation.y = type === 'compute' ? .32 : 0;
      transform.updateMatrix();
      body.current.setMatrixAt(index, transform.matrix);
      trim.current.setMatrixAt(index, transform.matrix);
      trim.current.setColorAt(index, colors[index]);
    });
    for (const mesh of [body.current, trim.current]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    trim.current.instanceColor.needsUpdate = true;
    invalidate();
  }, [nodes, type, colors, invalidate]);
  useFrame(() => {
    const scan = pulse.current;
    if (scan === null && !lit.current) return;
    lit.current = scan !== null;
    nodes.forEach((node, index) => {
      const position = -node.position[2] / (depth + 2) + .5;
      const intensity = scan === null ? 0 : Math.max(0, 1 - Math.abs(position - scan) * 11);
      trim.current.setColorAt(index, color.copy(colors[index]).multiplyScalar(1 + intensity * 1.6));
    });
    trim.current.instanceColor.needsUpdate = true;
  });
  return <>
    <instancedMesh ref={body} args={[geometry[0], undefined, nodes.length]}
      onClick={event => {
        event.stopPropagation();
        if (event.delta < 4) select(nodes[event.instanceId]?.id);
      }}
      onPointerMove={event => { event.stopPropagation(); hover(nodes[event.instanceId]?.id); }}
      onPointerOut={() => hover(null)}>
      <meshStandardMaterial color={type === 'identity' ? '#6886ae' : '#587294'} roughness={.32} metalness={.43} />
    </instancedMesh>
    <instancedMesh ref={trim} args={[geometry[1], undefined, nodes.length]}>
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  </>;
}

function Atmosphere({ width, depth, compact }) {
  const points = useMemo(() => {
    const data = [];
    for (let i = 1; i <= (compact ? 30 : 74); i++) {
      data.push(((i * .618034) % 1 - .5) * (width + 16),
        .8 + ((i * .414214) % 1) * 4,
        ((i * .732051) % 1 - .5) * (depth + 12));
    }
    return new Float32Array(data);
  }, [width, depth, compact]);
  return <points>
    <bufferGeometry><bufferAttribute attach="attributes-position" args={[points, 3]} /></bufferGeometry>
    <pointsMaterial color="#91b6e2" size={.065} transparent opacity={.42} depthWrite={false} />
  </points>;
}

function ScanSweep({ width, depth, token, pulse, reduced }) {
  const invalidate = useThree(state => state.invalidate);
  const beam = useRef(null);
  const start = useRef(null);
  const uniforms = useMemo(() => ({ sweep: { value: -1 } }), []);
  useEffect(() => {
    if (reduced || token == null || performance.now() - token > 1550) return;
    start.current = token;
    invalidate();
    return () => {
      start.current = null;
      pulse.current = null;
      if (beam.current) beam.current.visible = false;
      invalidate();
    };
  }, [token, reduced, invalidate, pulse]);
  useFrame(() => {
    if (start.current === null) return;
    const time = (performance.now() - start.current) / 1550;
    beam.current.visible = time < 1;
    if (time >= 1) {
      start.current = null;
      pulse.current = null;
      return;
    }
    pulse.current = uniforms.sweep.value = -.14 + 1.28 * time;
    invalidate();
  }, -1);
  return <mesh ref={beam} visible={false} position={[0, .026, 0]} rotation={floorAngle}>
    <planeGeometry args={[width + 4, depth + 2]} />
    <shaderMaterial vertexShader={waveVertex} fragmentShader={waveFragment} uniforms={uniforms} transparent depthWrite={false} />
  </mesh>;
}

function Platforms({ graph }) {
  const borders = useMemo(() => new Float32Array(graph.platforms.flatMap(({ x, z, width, depth }) => {
    const y = -.017;
    return [x, y, z, x + width, y, z, x + width, y, z, x + width, y, z + depth,
      x + width, y, z + depth, x, y, z + depth, x, y, z + depth, x, y, z];
  })), [graph.platforms]);
  return <>
    <gridHelper args={[Math.max(graph.width, graph.depth) + 12, 34, '#304866', '#17283c']} position={[0, -.27, 0]} />
    {graph.platforms.map(group => <mesh key={group.id} position={[group.x + group.width / 2, -.13, group.z + group.depth / 2]}>
      <boxGeometry args={[group.width, .2, group.depth]} /><meshStandardMaterial color="#22354f" roughness={.54} metalness={.35} />
    </mesh>)}
    <lineSegments>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[borders, 3]} /></bufferGeometry>
      <lineBasicMaterial color="#537392" />
    </lineSegments>
  </>;
}

function Labels({ platforms, labels }) {
  const point = useMemo(() => new Vector3(), []);
  useFrame(({ camera, size }) => {
    const elements = labels.current?.children;
    if (!elements) return;
    camera.updateMatrixWorld();
    for (const [index, group] of platforms.slice(0, elements.length).entries()) {
      point.set(group.x + group.width / 2, .12, group.z - .8).project(camera);
      const hidden = Math.abs(point.x) > .83 || Math.abs(point.y) > .86 || point.z < -1 || point.z > 1;
      const element = elements[index];
      element.hidden = hidden;
      if (!hidden) element.style.transform = 'translate3d(' + ((point.x + 1) * size.width / 2) + 'px,' +
        ((1 - point.y) * size.height / 2) + 'px,0) translateX(-50%)';
    }
  });
  return null;
}

function References({ graph, nodes }) {
  const segments = useMemo(() => {
    const points = [];
    for (const { from, to } of graph.links) {
      const [x, , z] = nodes.get(from).position;
      const [endX, , endZ] = nodes.get(to).position;
      const midpoint = [(x + endX) / 2, 1.06, (z + endZ) / 2];
      points.push(x, .63, z, ...midpoint, ...midpoint, endX, .63, endZ);
    }
    return new Float32Array(points);
  }, [graph, nodes]);
  if (!segments.length) return null;
  return <lineSegments>
    <bufferGeometry><bufferAttribute attach="attributes-position" args={[segments, 3]} /></bufferGeometry>
    <lineBasicMaterial color="#83abc9" transparent opacity={.48} />
  </lineSegments>;
}

function Marker({ node, current }) {
  if (!node) return null;
  const [x, , z] = node.position;
  return <mesh position={[x, .018, z]} rotation={floorAngle}>
    <ringGeometry args={current ? [.56, .65, 24] : [.5, .54, 22]} /><meshBasicMaterial color={current && node.severity === 'CRITICAL' ? '#ee686c' : current ? '#d5eaff' : '#7ea7cb'} />
  </mesh>;
}

function Field({ graph, selected, select, visible, command, labels, showLinks, onFailure, scope, compact, scanToken, cinematic }) {
  const reduced = useReducedMotion() || cinematic === false;
  const pulse = useRef(null);
  const [hovered, hover] = useState(null);
  const nodes = useMemo(() => new Map(graph.nodes.map(node => [node.id, node])), [graph]);
  const batches = useMemo(() => Object.keys(topologyTypes).map(type =>
    [type, graph.nodes.filter(node => node.type === type)]), [graph]);
  return <>
    <ambientLight color="#9ab7e2" intensity={1.75} />
    <hemisphereLight args={['#accfff', '#19283e', 1.45]} />
    <directionalLight color="#eff7ff" intensity={3.4} position={[2, 7, 12]} />
    <directionalLight color="#558aeb" intensity={2} position={[-9, 6, -7]} />
    <CameraRig width={graph.width} depth={graph.depth} selected={nodes.get(selected)?.position}
      reduced={reduced} visible={visible} command={command} onFailure={onFailure} scope={scope} />
    <Platforms graph={graph} />
    <Atmosphere width={graph.width} depth={graph.depth} compact={compact} />
    <ScanSweep width={graph.width} depth={graph.depth} token={scanToken} pulse={pulse} reduced={reduced} />
    {showLinks && <References graph={graph} nodes={nodes} />}
    {batches.map(([type, items]) => !!items.length && <ResourceBatch key={type} nodes={items} type={type} select={select} hover={hover} pulse={pulse} depth={graph.depth} />)}
    <Marker node={nodes.get(selected)} current />
    {hovered !== selected && <Marker node={nodes.get(hovered)} />}
    <Labels platforms={graph.platforms} labels={labels} />
  </>;
}

const graphIsDense = graph => graph.nodes.length > 140;

export default memo(function TopologyScene(props) {
  const [compact] = useState(() => matchMedia('(max-width: 620px)').matches);
  return <Canvas className="topology-webgl" aria-hidden="true" frameloop={props.visible ? 'demand' : 'never'}
    dpr={compact || navigator.hardwareConcurrency <= 4 || graphIsDense(props.graph) ? 1 : [1, 1.35]} camera={cameraSettings} gl={{ antialias: !compact, alpha: false, powerPreference: 'default' }}>
    <color attach="background" args={['#0a1220']} />
    <fogExp2 attach="fog" args={['#0a1220', .009 / Math.max(1, props.graph.depth / 18)]} />
    <Field {...props} compact={compact} />
  </Canvas>;
});
