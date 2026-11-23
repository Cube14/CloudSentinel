import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { BackSide, SRGBColorSpace, TextureLoader, VideoTexture } from 'three';
import { destinations } from './carousel-state';
import { allowsVideo, destinationMedia } from './destination-media';

const cameraSettings = { fov: 42, near: .08, far: 80 };
const radius = 8.5;
const interval = 2 * Math.PI / destinations.length;
const aspect = 1.96;
const arc = interval * .90;
const panelHeight = radius * arc / aspect;

function Screen({ index, selected, interactive, onSelect, front }) {
  const { poster, video } = destinationMedia(destinations[index].id);
  const [still, setStill] = useState(null);
  const [moving, setMoving] = useState(null);
  const invalidate = useThree(state => state.invalidate);
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
    if (!front || !video || !allowsVideo()) return;
    const film = document.createElement('video');
    film.src = video;
    film.muted = true;
    film.playsInline = true;
    film.loop = true;
    const texture = new VideoTexture(film);
    texture.colorSpace = SRGBColorSpace;
    let active = true;
    let request;
    let presented = false;
    function draw() {
      if (!active) return;
      if (!presented && film.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        presented = true;
        texture.needsUpdate = true;
        setMoving(texture);
      }
      invalidate();
      if (film.requestVideoFrameCallback) request = film.requestVideoFrameCallback(draw);
    }
    film.play().then(() => {
      if (!active) return;
      if (film.requestVideoFrameCallback) request = film.requestVideoFrameCallback(draw);
      else draw();
    }).catch(() => {});
    return () => {
      active = false;
      if (request !== undefined) film.cancelVideoFrameCallback(request);
      film.pause();
      film.removeAttribute('src');
      film.load();
      texture.dispose();
      setMoving(null);
    };
  }, [front, video, invalidate]);

  const lens = (front && moving) || still;
  const handlers = interactive ? { onClick: event => {
    event.stopPropagation();
    if (event.delta < 6) onSelect(index);
  } } : {};
  return <>
    <mesh position={[0, .1, 0]} {...handlers}>
      <cylinderGeometry args={[radius, radius, panelHeight, 28, 1, true, angle, arc]} />
      <meshBasicMaterial side={BackSide} map={lens} key={lens === moving && moving ? 'video' : lens ? 'poster' : 'empty'}
        color={lens ? selected ? '#edf5ff' : '#8297b7' : '#142035'} toneMapped={false} />
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

function Ring({ machine, selected, visible, interactive, effects, onSelect, onLoss }) {
  const group = useRef(null);
  const { camera, invalidate, gl, size } = useThree();
  useEffect(() => machine.subscribe(() => { if (visible) invalidate(); }), [machine, visible, invalidate]);
  useEffect(() => {
    const canvas = gl.domElement;
    canvas.addEventListener('webglcontextlost', onLoss);
    return () => canvas.removeEventListener('webglcontextlost', onLoss);
  }, [gl, onLoss]);
  useFrame(() => {
    if (!size.width || !size.height || !group.current) return;
    const { offset, travel, accent } = machine.frame;
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
        front={visible && effects && index === selected} {...{ interactive, onSelect }} />)}
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
