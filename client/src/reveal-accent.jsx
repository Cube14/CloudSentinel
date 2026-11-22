import React, { useEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';

const width = 256;
const height = 14;
let paint;

function makePainter() {
  const surface = document.createElement('canvas');
  surface.width = width;
  surface.height = height;
  const gl = surface.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: false });
  if (!gl) return null;
  const vertex = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vertex, 'attribute vec2 point; void main(){gl_Position=vec4(point,0.,1.);}');
  gl.compileShader(vertex);
  const fragment = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fragment, `
    precision mediump float;
    uniform float travel;
    void main() {
      vec2 uv = gl_FragCoord.xy / vec2(256., 14.);
      float grain = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.93, 78.23))) * 2376.12);
      float edge = uv.x - travel + uv.y * .09 + (grain - .5) * .044;
      float mask = 1. - smoothstep(.007, .15, abs(edge));
      float taper = sin(3.14159 * uv.x) * (1. - uv.y);
      gl_FragColor = vec4(.50, .72, .94, mask * taper * .72);
    }
  `);
  gl.compileShader(fragment);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);
  const points = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, points);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const attribute = gl.getAttribLocation(program, 'point');
  gl.enableVertexAttribArray(attribute);
  gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
  const travel = gl.getUniformLocation(program, 'travel');
  return (target, progress) => {
    if (gl.isContextLost()) return false;
    gl.uniform1f(travel, progress);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    target.clearRect(0, 0, width, height);
    target.drawImage(surface, 0, 0);
    return true;
  };
}

export function RevealAccent() {
  const ref = useRef(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced || document.hidden) return;
    const canvas = ref.current;
    let frame;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      paint ??= makePainter() || (() => false);
      const target = canvas.getContext('2d');
      if (!target) return;
      let start;
      function animate(now) {
        if (document.hidden) { target.clearRect(0, 0, width, height); return; }
        start ??= now;
        const fraction = (now - start) / 580;
        if (fraction >= 1) { target.clearRect(0, 0, width, height); return; }
        if (paint(target, - .14 + fraction * 1.34)) frame = requestAnimationFrame(animate);
      }
      frame = requestAnimationFrame(animate);
    });
    observer.observe(canvas);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [reduced]);
  return <canvas className="reveal-accent" ref={ref} width={width} height={height} aria-hidden="true" />;
}
