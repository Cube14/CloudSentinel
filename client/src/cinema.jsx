import React, { useLayoutEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { destinationMedia } from './destination-media';
import { framing } from './media-framing';

export const cinemaEase = [.22, 1, .36, 1];

export function CinemaPlate({ id, film, style, className = '' }) {
  const surface = useRef(null);
  const player = film?.id === id ? film.element : null;
  useLayoutEffect(() => {
    const host = surface.current;
    if (!player || !host) return;
    host.appendChild(player);
    return () => { if (player.parentNode === host) player.remove(); };
  }, [player]);
  return <motion.div className={'cinema-plate ' + className} ref={surface} aria-hidden="true"
    style={{ '--plate-focus': framing[id].map(point => (point * 100) + '%').join(' '), ...style }}>
    <img src={destinationMedia(id).poster} alt="" draggable="false" />
  </motion.div>;
}

export function pointPlate(event) {
  if (event.pointerType !== 'mouse' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const bounds = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty('--plate-x', ((event.clientX - bounds.left) / bounds.width - .5) * 20 + 'px');
  event.currentTarget.style.setProperty('--plate-y', ((event.clientY - bounds.top) / bounds.height - .5) * 15 + 'px');
}

export function restPlate(event) {
  event.currentTarget.style.removeProperty('--plate-x');
  event.currentTarget.style.removeProperty('--plate-y');
}
