import signalVideo from './media/signal.webm?no-inline';
import signalPoster from './media/signal.webp?no-inline';
import traceVideo from './media/trace.webm?no-inline';
import tracePoster from './media/trace.webp?no-inline';
import vaultVideo from './media/vault.webm?no-inline';
import vaultPoster from './media/vault.webp?no-inline';

export const reels = {
  vault: { video: vaultVideo, poster: vaultPoster },
  signal: { video: signalVideo, poster: signalPoster },
  trace: { video: traceVideo, poster: tracePoster },
};

export function stagePoster(reel) { return reels[reel].poster; }
