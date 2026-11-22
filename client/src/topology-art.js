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

function shield() {
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
    const levels = [-.16, .025, .21];
    body = [plinth, ...levels.map(y => drum(.29, .14, y)), drum(.22, .045, .31)];
    edges = levels.map(y => ring(.286, .014, y + .04));
  } else if (type === 'identity') {
    body = [plinth, place(new THREE.OctahedronGeometry(.34).scale(.8, 1.15, .8), 0, .085)];
    edges = [ring(.35, .016, .08), ring(.27, .012, -.175)];
  } else if (type === 'firewall') {
    body = [plinth, shield(), box(.14, .24, .14, 0, -.09, -.13)];
    edges = [box(.32, .024, .02, 0, .24, .103), box(.22, .024, .02, 0, .13, .103),
      box(.12, .024, .02, 0, .02, .103)];
  } else {
    const levels = [-.13, .025, .18];
    body = [plinth, ...levels.map(y => box(.58, .115, .54, 0, y, 0)), box(.52, .043, .48, 0, .273, 0)];
    edges = levels.flatMap(y => [box(.38, .019, .018, -.045, y, .274), box(.046, .035, .02, .21, y, .274)]);
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
