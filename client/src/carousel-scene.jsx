import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { BackSide, SRGBColorSpace, TextureLoader, Vector2, VideoTexture } from 'three';
import { destinations } from './carousel-state';
import { destinationMedia } from './destination-media';

const cameraSettings = { fov: 42, near: .08, far: 80 };
const radius = 8.5;
const interval = 2 * Math.PI / destinations.length;
const aspect = 1.96;
const arc = interval * .90;
const panelHeight = radius * arc / aspect;

const gradedMap = `
#ifdef USE_MAP
  vec2 imageUv = vec2(1. - vMapUv.x, vMapUv.y);
  vec2 center = imageUv - .5;
  float radius = dot(center, center);
  imageUv += filmPointer * .012 * filmStrength;
  imageUv += center * radius * .014 * filmStrength;
  vec4 sampledDiffuseColor = texture2D(map, clamp(imageUv, .002, .998));
  #ifdef DECODE_VIDEO_TEXTURE
    sampledDiffuseColor = sRGBTransferEOTF(sampledDiffuseColor);
  #endif
  float grain = fract(sin(dot(floor(vMapUv * vec2(758.,432.)),vec2(12.9898,78.233))
    + floor(filmTime * 24.)*.137) * 43758.5453) - .5;
  float wash = exp(-10. * abs(vMapUv.x * .94 + vMapUv.y * .19 - (.54 + sin(filmTime * .65) * .18)));
  sampledDiffuseColor.rgb = max(vec3(0.), sampledDiffuseColor.rgb * (1. - radius * .17 + grain * .105 * filmStrength)
    + filmStrength * vec3(.010,.017,.027) * wash);
  diffuseColor *= sampledDiffuseColor;
#endif
`;

function Screen({ index, selected, interactive, onSelect, film, grade }) {
  const { poster } = destinationMedia(destinations[index].id);
  const [still, setStill] = useState(null);
  const [moving, setMoving] = useState(null);
  const invalidate = useThree(state => state.invalidate);
  const strength = useMemo(() => ({ value: 0 }), []);
  const configure = useMemo(() => shader => {
    shader.uniforms.filmPointer = grade.pointer;
    shader.uniforms.filmTime = grade.time;
    shader.uniforms.filmStrength = strength;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_pars_fragment>',
      '#include <map_pars_fragment>\nuniform vec2 filmPointer;\nuniform float filmTime;\nuniform float filmStrength;')
      .replace('#include <map_fragment>', gradedMap);
  }, [grade, strength]);
  strength.value = selected ? 1 : 0;
  const angle = Math.PI - index * interval - arc / 2;
  useEffect(() => {
    if (!poster) return;
    let active = true;
    const texture = new TextureLoader().load(poster, image => {
      if (!active) return;
      image.colorSpace = SRGBColorSpace;
      setStill(image);
      invalidate();
    });
    return () => { active = false; texture.dispose(); };
  }, [poster, invalidate]);

  useEffect(() => {
    if (!film) return;
    const texture = new VideoTexture(film.element);
    texture.colorSpace = SRGBColorSpace;
    texture.needsUpdate = true;
    setMoving({ film, texture });
    invalidate();
    return () => texture.dispose();
  }, [film, invalidate]);

  const playing = film && moving?.film === film;
  const lens = playing ? moving.texture : still;
  const handlers = interactive ? { onClick: event => {
    event.stopPropagation();
    if (event.delta < 6) onSelect(index);
  } } : {};
  return <>
    <mesh position={[0, .1, 0]} {...handlers}>
      <cylinderGeometry args={[radius, radius, panelHeight, 28, 1, true, angle, arc]} />
      <meshBasicMaterial side={BackSide} map={lens} key={playing ? 'video' : lens ? 'poster' : 'empty'}
        onBeforeCompile={configure}
        color={lens ? selected ? '#f0f6ff' : '#91a4bf' : '#142035'} toneMapped={false} />
    </mesh>
    <mesh position={[0, -panelHeight - .03, 0]} scale={[1, -1, 1]}>
      <cylinderGeometry args={[radius + .02, radius + .02, panelHeight * .83, 16, 1, true, angle, arc]} />
      <meshBasicMaterial side={BackSide} map={still} key={still ? 'still' : 'empty'} color="#26354c" transparent opacity={.19} depthWrite={false} />
    </mesh>
    <mesh position={[0, -panelHeight / 2 + .09, 0]}>
      <cylinderGeometry args={[radius - .015, radius - .015, .023, 22, 1, true, angle, arc]} />
      <meshBasicMaterial side={BackSide} color={selected ? destinations[index].tone : '#22344d'} />
    </mesh>
  </>;
}

function Ring({ machine, selected, visible, interactive, effects, onSelect, onLoss, film, parallax }) {
  const group = useRef(null);
  const { camera, invalidate, gl, size } = useThree();
  const grade = useMemo(() => ({ pointer: { value: new Vector2() }, time: { value: 0 } }), []);
  useEffect(() => {
    parallax.current.invalidate = visible ? invalidate : null;
    return () => { parallax.current.invalidate = null; };
  }, [parallax, visible, invalidate]);
  useEffect(() => {
    if (visible && film) return film.subscribe(invalidate);
  }, [film, visible, invalidate]);
  useEffect(() => machine.subscribe(() => { if (visible) invalidate(); }), [machine, visible, invalidate]);
  useEffect(() => {
    const canvas = gl.domElement;
    canvas.addEventListener('webglcontextlost', onLoss);
    return () => canvas.removeEventListener('webglcontextlost', onLoss);
  }, [gl, onLoss]);
  useFrame(() => {
    if (!size.width || !size.height || !group.current) return;
    const { offset, travel, accent } = machine.frame;
    const x = interactive ? parallax.current.x : 0;
    const y = interactive ? parallax.current.y : 0;
    const look = grade.pointer.value;
    look.x += (x - look.x) * .17;
    look.y += (y - look.y) * .17;
    grade.time.value = film?.element.currentTime ?? 0;
    if (Math.abs(x - look.x) + Math.abs(y - look.y) > .007) invalidate();
    const narrow = size.width / size.height < .85;
    group.current.rotation.y = offset * interval;
    const base = narrow ? 3.1 : 1.25;
    camera.position.set(Math.sin(travel * Math.PI) * .34, .30 - travel * .29, base + (-6.7 - base) * travel);
    camera.fov = (size.width < 540 ? 64 : narrow ? 58 : 42) - accent * 2.2;
    if (accent > .015) camera.setViewOffset(size.width, size.height, accent * 8, -accent * 3, size.width, size.height);
    else if (camera.view?.enabled) camera.clearViewOffset();
    camera.lookAt(0, -.02, -radius);
    camera.updateProjectionMatrix();
  });
  const dust = useMemo(() => Float32Array.from({ length: 240 }, (_, index) => {
    const id = Math.floor(index / 3);
    const theta = id * 2.39996;
    if (index % 3 === 0) return Math.cos(theta) * (4 + id % 6);
    if (index % 3 === 1) return (id % 17) * .31 - 2;
    return Math.sin(theta) * (4 + id % 5);
  }), []);
  return <>
    <color attach="background" args={['#060912']} />
    <fogExp2 attach="fog" args={['#060912', .028]} />
    <group ref={group}>
      {destinations.map((destination, index) => <Screen key={destination.id} index={index} selected={index === selected}
        film={visible && effects && index === selected && film?.id === destination.id ? film : null}
        {...{ interactive, onSelect, grade }} />)}
    </group>
    <points>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[dust, 3]} /></bufferGeometry>
      <pointsMaterial color="#99bae7" size={.035} opacity={.48} transparent depthWrite={false} />
    </points>
  </>;
}

export default function CarouselScene(props) {
  const compact = matchMedia('(max-width: 720px)').matches || navigator.hardwareConcurrency <= 4;
  return <Canvas frameloop={props.visible ? 'demand' : 'never'} dpr={compact ? 1 : [1, 1.3]}
    camera={cameraSettings} gl={{ antialias: !compact, alpha: false }} aria-hidden="true">
    <Ring {...props} />
  </Canvas>;
}
