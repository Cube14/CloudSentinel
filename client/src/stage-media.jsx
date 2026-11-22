import React, { useEffect, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { DoubleSide, SRGBColorSpace, TextureLoader, VideoTexture } from 'three';
import { reels } from './stage-reels';

export function StageMedia({ reel, active, alive, width, depth }) {
  const [still, setStill] = useState(null);
  const [moving, setMoving] = useState(null);
  const invalidate = useThree(state => state.invalidate);
  const source = reels[reel];

  useEffect(() => {
    let live = true;
    const texture = new TextureLoader().load(source.poster, result => {
      if (!live) { result.dispose(); return; }
      result.colorSpace = SRGBColorSpace;
      setStill({ reel, texture: result });
      invalidate();
    }, undefined, () => {});
    return () => { live = false; texture.dispose(); };
  }, [reel, source, invalidate]);

  useEffect(() => {
    if (!active || !alive || navigator.connection?.saveData || matchMedia('(prefers-reduced-data: reduce)').matches) return;
    const video = document.createElement('video');
    let live = true;
    let scheduled;
    let showing = false;
    const texture = new VideoTexture(video);
    texture.colorSpace = SRGBColorSpace;
    const schedule = () => {
      if (live && video.requestVideoFrameCallback) scheduled = video.requestVideoFrameCallback(draw);
    };
    function draw() {
      if (!live) return;
      if (!showing && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        showing = true;
        texture.needsUpdate = true;
        setMoving({ reel, texture });
      }
      invalidate();
      schedule();
    }
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'none';
    video.src = source.video;
    video.play().then(() => {
      if (video.requestVideoFrameCallback) schedule();
      else draw();
    }).catch(() => {});
    return () => {
      live = false;
      if (scheduled !== undefined) video.cancelVideoFrameCallback(scheduled);
      video.pause();
      video.removeAttribute('src');
      video.load();
      texture.dispose();
      setMoving(null);
    };
  }, [active, alive, reel, source, invalidate]);

  const radius = Math.max(7.8, width * .43, depth * .51);
  const height = radius * .66;
  const lens = moving?.reel === reel && active && alive ? moving.texture : still?.reel === reel ? still.texture : null;
  const center = [Math.min(width * .09, 2.6), height / 2 + 1.55, -depth * .34 - radius];
  return <group position={center} rotation={[0, -.12, 0]}>
    <mesh>
      <cylinderGeometry args={[radius, radius, height, 42, 1, true, -.85, 1.7]} />
      <meshBasicMaterial key={moving?.texture === lens ? 'video' : lens ? 'poster' : 'standby'}
        side={DoubleSide} map={lens} color={lens ? '#d1e4ff' : '#162237'} toneMapped={false} />
    </mesh>
    {[-1, 1].map(edge => <mesh key={edge} position={[0, edge * height / 2, 0]}>
      <cylinderGeometry args={[radius + .012, radius + .012, .055, 42, 1, true, -.85, 1.7]} />
      <meshBasicMaterial color={edge === 1 ? '#8197b6' : '#3c5576'} side={DoubleSide} />
    </mesh>)}
  </group>;
}
