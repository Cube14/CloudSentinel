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

export const impactFragment = `
  varying vec2 coords;
  uniform sampler2D image;
  uniform float energy;
  uniform float wipe;
  uniform float shift;
  uniform vec2 pointer;
  uniform float aim;
  uniform float aspect;

  void main() {
    vec2 center = vec2(.58, .50) + pointer * .20 * aim;
    vec2 offset = coords - center;
    vec2 radial = offset * vec2(aspect, 1.);
    float radius = length(radial);
    float ringWidth = abs(radius - (.10 + (1. - energy) * .40));
    float ring = exp(-ringWidth * ringWidth * 72.);
    float lines = pow(.5 + .5 * sin(atan(radial.y, radial.x) * 47.), 14.);
    float fracture = smoothstep(.4, .8, energy);
    float slice = step(.58, fract(floor(coords.y * 17.) * .618));
    vec2 warp = offset * (ring * energy * .15 + aim * .028 * exp(-radius * radius * 31.));
    warp.x += slice * fracture * shift * .035;
    vec2 sampleAt = clamp(coords + warp, .003, .997);
    vec2 fringe = vec2(energy * .004 + aim * .00075, 0.);
    vec3 imageColor = vec3(texture2D(image, clamp(sampleAt + fringe, 0., 1.)).r,
      texture2D(image, sampleAt).g, texture2D(image, clamp(sampleAt - fringe, 0., 1.)).b);
    float accents = ring * lines * smoothstep(.14,.62,radius) * fracture;
    float edge = exp(-abs(coords.x + coords.y * .19 - wipe * 1.25) * 34.);
    imageColor *= 1. - .20 * fracture * (1. - ring);
    imageColor += vec3(.30, .53, .82) * (accents * .23 + wipe * edge * .07 + ring * energy * .039);
    gl_FragColor = vec4(imageColor, 1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const atlasFloorFragment = `
  varying vec2 coords;
  uniform float aspect;
  void main() {
    vec2 field = (coords - .5) * vec2(aspect, 1.);
    float distanceToCenter = length(field);
    float halo = exp(-distanceToCenter * distanceToCenter * 10.);
    float longitude = 1. - smoothstep(.008, .032, abs(fract(field.x * 41. + .5) - .5));
    float latitude = 1. - smoothstep(.008, .032, abs(fract(field.y * 41. + .5) - .5));
    float circle = 1. - smoothstep(.018, .040, abs(fract(distanceToCenter * 8. + .5) - .5));
    float fade = (1. - smoothstep(.18, .59, distanceToCenter));
    vec3 color = vec3(.010,.021,.042) * halo;
    color += vec3(.10,.18,.31) * fade * (max(longitude,latitude) * .14 + circle * .28);
    float border = min(min(coords.x,1.-coords.x),min(coords.y,1.-coords.y));
    float opacity = (.23 + halo * .7) * smoothstep(0.,.17,border);
    gl_FragColor = vec4(color, opacity);
    #include <colorspace_fragment>
  }
`;

export const auraFragment = `
  varying vec2 coords;
  void main() {
    float d = length(coords - .5);
    float glow = exp(-d * d * 17.) * (1. - smoothstep(.21, .50, d));
    float lip = smoothstep(.19,.26,d) * (1.-smoothstep(.28,.36,d));
    gl_FragColor = vec4(.22, .43, .77, glow * .26 + lip * .12);
    #include <colorspace_fragment>
  }
`;
