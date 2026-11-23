import { useEffect, useState } from 'react';

const files = import.meta.glob('./media/destinations/*.{webm,webp}', { eager: true, query: '?no-inline', import: 'default' });

export const destinationMedia = id => ({
  poster: files['./media/destinations/' + id + '.webp'],
  video: files['./media/destinations/' + id + '.webm'],
});

export function useMediaVisible(ref) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let inView = false;
    const update = () => setVisible(inView && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; update(); });
    if (ref.current) observer.observe(ref.current);
    document.addEventListener('visibilitychange', update);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', update); };
  }, [ref]);
  return visible;
}

export function allowsVideo() {
  return !navigator.connection?.saveData && !matchMedia('(prefers-reduced-data: reduce)').matches;
}
