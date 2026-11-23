import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { destinations } from './carousel-state.js';

test('each carousel destination has its own local reel and poster with the expected formats', async () => {
  const root = new URL('./media/destinations/', import.meta.url);
  const reels = new Set();
  const posters = new Set();
  const digest = buffer => createHash('sha256').update(buffer).digest('hex');

  for (const { id } of destinations) {
    const [film, poster] = await Promise.all([
      readFile(new URL(id + '.webm', root)),
      readFile(new URL(id + '.webp', root)),
    ]);
    assert.equal(film.subarray(0, 4).toString('hex'), '1a45dfa3', id);
    assert.equal(poster.toString('ascii', 0, 4), 'RIFF', id);
    assert.equal(poster.toString('ascii', 8, 12), 'WEBP', id);
    reels.add(digest(film));
    posters.add(digest(poster));
  }

  assert.equal(reels.size, destinations.length);
  assert.equal(posters.size, destinations.length);
});
