import React, { useEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';

const tau = Math.PI * 2;
const columns = 18;
const heights = [-.86, -.58, -.26, .08, .42, .74, .91];
const latitudePoints = heights.flatMap((y, row) => Array.from({ length: columns }, (_, column) => {
  const angle = (column + (row % 2) * .5) / columns * tau;
  const radius = Math.sqrt(1 - y ** 2);
  return [radius * Math.cos(angle), y, radius * Math.sin(angle)];
}));
const points = [...latitudePoints, [0, -1, 0], [0, 1, 0]];
const links = latitudePoints.flatMap((_, index) => {
  const column = index % columns;
  const rowStart = index - column;
  const result = [[index, rowStart + (column + 1) % columns]];
  if (rowStart === 0) result.push([index, latitudePoints.length]);
  if (index < latitudePoints.length - columns) {
    result.push([index, index + columns], [index, rowStart + columns + (column + (rowStart / columns % 2 ? 1 : columns - 1)) % columns]);
  } else result.push([index, latitudePoints.length + 1]);
  return result;
});
const orbits = [-1.01, -.42, .48].map(tilt => Array.from({ length: 88 }, (_, index) => {
  const angle = index / 88 * tau;
  return [1.33 * Math.cos(angle), 1.33 * Math.sin(angle) * Math.sin(tilt), 1.33 * Math.sin(angle) * Math.cos(tilt)];
}));
const satellites = [[1.14, .13, .17], [-1.22, -.49, .08], [.1, -.38, 1.23], [.37, 1.1, -.14], [.7, -.83, -.6]];
const stars = Array.from({ length: 70 }, (_, index) => [
  ((index * 343 + 11) % 863) / 863, ((index ** 2 * 29 + index * 73 + 91) % 787) / 787, index % 8 === 0
]);

function render(context, width, height, yaw, pitch) {
  context.clearRect(0, 0, width, height);
  const radius = Math.min(width, height) * .298;
  const centerX = width * .515;
  const centerY = height * .51;
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sx = Math.sin(pitch), cx = Math.cos(pitch);
  const project = ([px, py, pz]) => {
    const x = px * cy + pz * sy;
    const z = pz * cy - px * sy;
    const y = py * cx - z * sx;
    const depth = py * sx + z * cx;
    const scale = 3.8 / (3.8 - depth) * radius;
    return [centerX + x * scale, centerY + y * scale, depth];
  };
  const path = (from, to) => { context.moveTo(from[0], from[1]); context.lineTo(to[0], to[1]); };
  const dot = (point, size) => {
    context.moveTo(point[0] + size, point[1]);
    context.arc(point[0], point[1], size, 0, tau);
  };

  context.fillStyle = '#8198ab42';
  context.beginPath();
  for (const [x, y, bright] of stars) dot([x * width, y * height], bright ? 1.25 : .65);
  context.fill();

  for (const [index, orbit] of orbits.entries()) {
    const projected = orbit.map(project);
    context.strokeStyle = index === 1 ? '#8daec66e' : '#63829c55';
    context.setLineDash(index === 1 ? [3, 6] : []);
    context.lineWidth = .85;
    context.beginPath();
    for (let i = 1; i <= projected.length; i++) path(projected[i - 1], projected[i % projected.length]);
    context.stroke();
  }
  context.setLineDash([]);

  const globe = points.map(project);
  for (const [threshold, color, lineWidth] of [[-1.5, '#34516786', .65], [0, '#8fadc3a3', .78], [.56, '#c2dce9b3', .88]]) {
    context.beginPath();
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    for (const [a, b] of links) {
      const depth = (globe[a][2] + globe[b][2]) / 2;
      if (depth >= threshold && depth < (threshold < 0 ? 0 : threshold === 0 ? .56 : 2)) path(globe[a], globe[b]);
    }
    context.stroke();
  }

  context.fillStyle = '#d3e9f1bb';
  context.beginPath();
  globe.forEach((point, i) => { if (point[2] > -.18 && i % 2 === 0) dot(point, 1.34 + point[2] * .62); });
  context.fill();

  satellites.forEach((satellite, index) => {
    const point = project(satellite);
    const nearby = globe[20 + index * 19];
    context.beginPath();
    context.strokeStyle = index === 0 ? '#e5484d9c' : '#90cbdc88';
    context.lineWidth = 1;
    path(nearby, point);
    context.stroke();
    context.beginPath();
    context.fillStyle = index === 0 ? '#ff8180' : '#b1e9f1';
    dot(point, 3 + point[2] * .5);
    context.fill();
    context.beginPath();
    dot(point, 7 + point[2] * .9);
    context.stroke();
  });
}

export default function NetworkScene({ auth, camera }) {
  const wrapper = useRef(null);
  const canvas = useRef(null);
  const controls = useRef(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    const target = canvas.current;
    const context = target.getContext('2d', { alpha: true });
    if (!context) return;
    let width = 0, height = 0, frame = 0, last = 0, tracking = false, visible = false;
    let yaw = auth ? .93 : .66, pitch = auth ? -.33 : -.24, pointerX = 0, pointerY = 0;
    let cameraOffset = reduce ? 0 : camera?.get() || 0;
    const defaultPitch = pitch;
    function repaint() {
      if (width && height) render(context, width, height, yaw + cameraOffset * .9, pitch - cameraOffset * .16);
    }
    function tick(now) {
      if (now - last > 32) {
        const step = Math.min(now - last, 60);
        yaw += tracking ? pointerX * .015 : step * .00013;
        pitch += ((defaultPitch + pointerY * .37) - pitch) * .08;
        repaint();
        last = now;
      }
      frame = requestAnimationFrame(tick);
    }
    function sync() {
      cancelAnimationFrame(frame);
      if (!reduce && visible && !document.hidden) { last = 0; frame = requestAnimationFrame(tick); }
    }
    const measured = new ResizeObserver(([entry]) => {
      width = entry.contentRect.width;
      height = entry.contentRect.height;
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      target.width = Math.round(width * ratio);
      target.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      repaint();
    });
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); }, { threshold: .05 });
    measured.observe(target);
    observer.observe(target);
    document.addEventListener('visibilitychange', sync);
    const stopCamera = reduce ? undefined : camera?.on('change', value => { cameraOffset = value; });
    controls.current = {
      steer(event) {
        if (reduce || event.pointerType !== 'mouse') return;
        const rect = wrapper.current.getBoundingClientRect();
        pointerX = (event.clientX - rect.left) / rect.width - .5;
        pointerY = (event.clientY - rect.top) / rect.height - .5;
        tracking = true;
      },
      reset() { tracking = false; pointerY = 0; },
      rotate(amount) { yaw += amount; repaint(); }
    };
    return () => {
      cancelAnimationFrame(frame); measured.disconnect(); observer.disconnect(); stopCamera?.();
      document.removeEventListener('visibilitychange', sync); controls.current = null;
    };
  }, [reduce, auth, camera]);
  return <div className="network-scene" ref={wrapper} tabIndex={auth ? undefined : 0}
    role={auth ? undefined : 'group'} aria-label={auth ? undefined : 'Cloud network illustration. Use left and right arrow keys to rotate.'}
    aria-hidden={auth || undefined}
    onPointerMove={event => controls.current?.steer(event)} onPointerLeave={() => controls.current?.reset()}
    onKeyDown={event => {
      if (!auth && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault();
        controls.current?.rotate(event.key === 'ArrowRight' ? .19 : -.19);
      }
    }}>
    <canvas ref={canvas} aria-hidden="true" />
  </div>;
}
