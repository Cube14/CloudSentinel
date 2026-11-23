import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const place = (shape, x = 0, y = 0, z = 0) => shape.translate(x, y, z);
const box = (w, h, d, x, y, z) => place(new THREE.BoxGeometry(w, h, d), x, y, z);
const drum = (r, h, y, sides = 24) => place(new THREE.CylinderGeometry(r, r, h, sides), 0, y);
const ring = (r, tube, y) => place(new THREE.TorusGeometry(r, tube, 5, 24).rotateX(Math.PI / 2), 0, y);

function alloy(parts) {
  const nonIndexed = parts.map(part => part.index ? part.toNonIndexed() : part);
  const geometry = mergeGeometries(nonIndexed);
  for (const part of new Set([...parts, ...nonIndexed])) part.dispose();
  return geometry;
}

function networkJunction() {
  const outline = new THREE.Shape();
  outline.moveTo(-.29, .27);
  outline.lineTo(.29, .27);
  outline.lineTo(.25, -.12);
  outline.lineTo(0, -.34);
  outline.lineTo(-.25, -.12);
  outline.closePath();
  return new THREE.ExtrudeGeometry(outline, {
    depth: .13, bevelEnabled: true, bevelSize: .035, bevelThickness: .03, bevelSegments: 2, steps: 1,
  }).translate(0, .1, -.065);
}

export function buildResource(type) {
  const plinth = drum(.39, .065, -.27, 8);
  let body;
  let edges;
  if (type === 'storage') {
    const levels = [-.17, .035, .24];
    body = [plinth, ...levels.flatMap(y => [
      place(new THREE.CylinderGeometry(.29, .22, .105, 6).rotateY(Math.PI / 6), 0, y),
      place(new THREE.CylinderGeometry(.20, .29, .065, 6).rotateY(Math.PI / 6), 0, y + .085),
    ])];
    edges = levels.map(y => drum(.292, .025, y + .035, 6).rotateY(Math.PI / 6));
  } else if (type === 'identity') {
    const crystal = new THREE.OctahedronGeometry(.34).scale(.64, 1.29, .64).rotateY(.32);
    body = [plinth, place(crystal, 0, .15), drum(.25, .048, -.19, 10)];
    edges = [ring(.32, .012, .065).rotateX(.44), ring(.26, .012, -.145).rotateZ(-.28)];
  } else if (type === 'firewall') {
    body = [plinth, networkJunction(), box(.14, .24, .14, 0, -.09, -.13),
      box(.095, .38, .19, -.34, -.035, 0), box(.095, .38, .19, .34, -.035, 0)];
    edges = [box(.32, .031, .022, 0, .19, .104), box(.17, .032, .022, 0, .06, .104),
      box(.044, .26, .024, -.34, -.025, .101), box(.044, .26, .024, .34, -.025, .101)];
  } else {
    const racks = [-.205, 0, .205];
    body = [plinth, ...racks.map((x, i) => box(.155, i === 1 ? .65 : .51, .46, x, i === 1 ? .052 : -.01, 0)),
      box(.58, .055, .45, 0, -.235, 0)];
    edges = racks.flatMap(x => [-.13, -.025, .08, .185].map(y => box(.116, .016, .025, x, y, .232)));
  }
  return [alloy(body), alloy(edges)];
}

export const waveVertex = `
  varying vec2 coords;
  void main() {
    coords = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
  }
`;

export const waveFragment = `
  varying vec2 coords;
  uniform float sweep;
  void main() {
    float distanceToWave = abs(coords.y - sweep);
    float beam = exp(-distanceToWave * distanceToWave * 9800.);
    float glow = exp(-distanceToWave * distanceToWave * 450.);
    float edge = smoothstep(0., .19, coords.x) * smoothstep(0., .19, 1. - coords.x);
    gl_FragColor = vec4(.42, .68, .94, (.65 * beam + .14 * glow) * edge);
  }
`;
