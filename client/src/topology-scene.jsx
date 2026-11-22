import React, { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Color, Object3D, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { useReducedMotion } from 'motion/react';
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

function CameraRig({ width, depth, selected, command, reduced, visible, onFailure }) {
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
  }, [width, depth, size.width, size.height, reduced]);

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

function Shape({ type }) {
  switch (type) {
    case 'storage': return <cylinderGeometry args={[.36, .36, .53, 14]} />;
    case 'identity': return <octahedronGeometry args={[.43, 0]} />;
    case 'firewall': return <cylinderGeometry args={[.38, .38, .59, 6]} />;
    default: return <boxGeometry args={[.59, .43, .59]} />;
  }
}

function ResourceBatch({ nodes, type, select, hover }) {
  const ref = useRef(null);
  const invalidate = useThree(state => state.invalidate);
  useLayoutEffect(() => {
    const mesh = ref.current;
    const transform = new Object3D();
    const color = new Color();
    nodes.forEach((node, index) => {
      transform.position.set(...node.position);
      transform.scale.setScalar(node.stale ? 1.04 : 1.27);
      transform.rotation.y = type === 'compute' ? Math.PI / 4 : 0;
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
      color.set(node.severity === 'CRITICAL' ? critical : topologyTypes[type].color);
      if (node.stale) color.multiplyScalar(.61);
      mesh.setColorAt(index, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    invalidate();
  }, [nodes, type, invalidate]);
  return <instancedMesh ref={ref} args={[undefined, undefined, nodes.length]}
    onClick={event => {
      event.stopPropagation();
      if (event.delta < 4) select(nodes[event.instanceId]?.id);
    }}
    onPointerMove={event => { event.stopPropagation(); hover(nodes[event.instanceId]?.id); }}
    onPointerOut={() => hover(null)}>
    <Shape type={type} />
    <meshStandardMaterial roughness={.58} metalness={.13} />
  </instancedMesh>;
}

function Platforms({ graph }) {
  const borders = useMemo(() => new Float32Array(graph.platforms.flatMap(({ x, z, width, depth }) => {
    const y = -.019;
    return [x, y, z, x + width, y, z, x + width, y, z, x + width, y, z + depth,
      x + width, y, z + depth, x, y, z + depth, x, y, z + depth, x, y, z];
  })), [graph.platforms]);
  return <>
    <gridHelper args={[Math.max(graph.width, graph.depth) + 12, 28, '#23324a', '#142037']} position={[0, -.27, 0]} />
    {graph.platforms.map(group => <mesh key={group.id} position={[group.x + group.width / 2, -.13, group.z + group.depth / 2]}>
      <boxGeometry args={[group.width, .2, group.depth]} /><meshStandardMaterial color="#263750" roughness={.97} />
    </mesh>)}
    <lineSegments>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[borders, 3]} /></bufferGeometry>
      <lineBasicMaterial color="#3c5774" />
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
    <ringGeometry args={current ? [.56, .65, 24] : [.5, .54, 22]} /><meshBasicMaterial color={current ? '#d5eaff' : '#7ea7cb'} />
  </mesh>;
}

function Field({ graph, selected, select, visible, command, labels, showLinks, onFailure }) {
  const reduced = useReducedMotion();
  const [hovered, hover] = useState(null);
  const nodes = useMemo(() => new Map(graph.nodes.map(node => [node.id, node])), [graph]);
  const batches = useMemo(() => Object.keys(topologyTypes).map(type =>
    [type, graph.nodes.filter(node => node.type === type)]), [graph]);
  return <>
    <ambientLight color="#b9d1ee" intensity={1.45} />
    <directionalLight color="#e9f3ff" intensity={2.1} position={[8, 15, 11]} />
    <CameraRig width={graph.width} depth={graph.depth} selected={nodes.get(selected)?.position}
      reduced={reduced} visible={visible} command={command} onFailure={onFailure} />
    <Platforms graph={graph} />
    {showLinks && <References graph={graph} nodes={nodes} />}
    {batches.map(([type, items]) => !!items.length && <ResourceBatch key={type} nodes={items} type={type} select={select} hover={hover} />)}
    <Marker node={nodes.get(selected)} current />
    {hovered !== selected && <Marker node={nodes.get(hovered)} />}
    <Labels platforms={graph.platforms} labels={labels} />
  </>;
}

export default memo(function TopologyScene(props) {
  const [compact] = useState(() => matchMedia('(max-width: 620px)').matches);
  return <Canvas className="topology-webgl" aria-hidden="true" frameloop={props.visible ? 'demand' : 'never'}
    dpr={compact ? 1 : [1, 1.35]} camera={cameraSettings} gl={{ antialias: !compact, alpha: false, powerPreference: 'default' }}>
    <color attach="background" args={['#0b111b']} />
    <Field {...props} />
  </Canvas>;
});
