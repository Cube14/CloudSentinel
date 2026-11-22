'use strict';

const { flociSource } = require('../server/floci');
const { scan } = require('../security-engine/engine');

async function main() {
  if (!process.env.FLOCI_ENDPOINT) throw new Error('Set FLOCI_ENDPOINT to the running local Floci endpoint');
  const source = flociSource(process.env.FLOCI_ENDPOINT);
  const inventory = (await source.collect()).map(asset => ({
    ...asset, provider: source.provider, environment: source.id, source: source.kind
  }));
  const { assets, counts, findings } = scan(inventory);
  console.log(JSON.stringify({
    endpoint: source.endpoint, source: source.kind, assets, counts,
    inventory: inventory.map(({ id, type }) => ({ id, type })),
    findings: findings.map(({ ruleId, resourceId, evidence }) => ({ ruleId, resourceId, evidence }))
  }, null, 2));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
