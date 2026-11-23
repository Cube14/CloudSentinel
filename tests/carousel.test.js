const test = require('node:test');
const assert = require('node:assert/strict');

test('carousel selects the nearest copy of a destination on the continuous loop', async () => {
  const { nearestOffset, wrapIndex } = await import('../client/src/carousel-state.js');
  assert.equal(nearestOffset(7.7, 0), 8);
  assert.equal(nearestOffset(.17, 7), -1);
  assert.equal(nearestOffset(-16.25, 7), -17);
  for (let index = 0; index < 8; index++) {
    const target = nearestOffset(24.36, index);
    assert.equal(wrapIndex(target), index);
    assert.ok(Math.abs(target - 24.36) <= 4);
  }
});

test('all eight carousel destinations resolve to distinct routes and the topology alias stays accessible', async () => {
  const { destinationFromPath, destinations } = await import('../client/src/carousel-state.js');
  assert.equal(new Set(destinations.map(item => item.id)).size, 8);
  for (const destination of destinations) assert.equal(destinationFromPath('/workspace/' + destination.id), destination);
  assert.equal(destinationFromPath('/workspace/topology').id, 'assets');
  assert.equal(destinationFromPath('/workspace'), null);
});
