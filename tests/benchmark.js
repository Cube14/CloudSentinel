'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { setTimeout: delay } = require('node:timers/promises');
const { scan } = require('../security-engine/engine');
const { createApp } = require('../server/server');
const { client, listen, password } = require('./session');

const rules = {
  storage: { public: ['CSPM-001'], encrypted: ['CSPM-002'], encryptionAlgorithms: ['CSPM-002'],
    logging: ['CSPM-003'], publicPolicy: ['S3-001'] },
  firewall: { ingress: ['CSPM-004', 'CSPM-005'] },
  identity: { permissions: ['CSPM-006', 'IAM-001'], mfaRequired: ['CSPM-007'], consoleLogin: ['IAM-002'],
    adminPolicyArn: ['IAM-003'], directPolicies: ['IAM-003'] },
  compute: { production: ['CSPM-008'] }
};
const adminArn = 'arn:aws:iam::aws:policy/AdministratorAccess';
const cases = [
  ['AWS public and unencrypted storage', 'aws', 'storage', { public: true, encrypted: false, logging: true }, ['CSPM-001', 'CSPM-002']],
  ['AWS private encrypted storage', 'aws', 'storage', { public: false, encrypted: true, logging: true }, []],
  ['Azure storage missing access logs', 'azure', 'storage', { public: false, encrypted: true, logging: false }, ['CSPM-003']],
  ['GCP private storage', 'gcp', 'storage', { public: false, encrypted: true, logging: true }, []],
  ['S3 public policy only', 'aws', 'storage', { publicPolicy: true, encrypted: true }, ['S3-001']],
  ['AWS TCP SSH open over IPv4', 'aws', 'firewall', { ingress: [{ port: 22, cidrs: ['0.0.0.0/0'] }] }, ['CSPM-004']],
  ['AWS TCP SSH port range open over IPv6', 'aws', 'firewall', { ingress: [{ protocol: '6', fromPort: 20, toPort: 25, cidrs: ['::/0'] }] }, ['CSPM-004']],
  ['AWS all protocols open over IPv6', 'aws', 'firewall', { ingress: [{ protocol: '-1', cidrs: ['::/0'] }] }, ['CSPM-004', 'CSPM-005']],
  ['AWS UDP rule at port 22', 'aws', 'firewall', { ingress: [{ protocol: 'udp', port: 22, cidrs: ['0.0.0.0/0'] }] }, []],
  ['Azure internet-accessible RDP', 'azure', 'firewall', { ingress: [{ port: 3389, cidrs: ['0.0.0.0/0'] }] }, ['CSPM-005']],
  ['GCP SSH restricted to private network', 'gcp', 'firewall', { ingress: [{ port: 22, cidrs: ['10.0.0.0/8'] }] }, []],
  ['AWS wildcard and missing MFA enforcement', 'aws', 'identity', { permissions: ['*', 'iam:PassRole'], mfaRequired: false }, ['CSPM-006', 'CSPM-007', 'IAM-001']],
  ['AWS console user without an MFA device', 'aws', 'identity', { consoleLogin: true, mfaDevices: 0 }, ['IAM-002']],
  ['AWS API-only user with directly attached admin policy', 'aws', 'identity', { consoleLogin: false, adminPolicyArn: adminArn }, ['IAM-003']],
  ['AWS API-only user without directly attached policies', 'aws', 'identity', { consoleLogin: false, directPolicies: [] }, []],
  ['AWS console user with MFA and scoped access', 'aws', 'identity', { consoleLogin: true, mfaDevices: 1, permissions: ['s3:GetObject'], mfaRequired: true }, []],
  ['Azure fixture administrative role', 'azure', 'identity', { permissions: ['AdministratorAccess'], mfaRequired: true }, ['CSPM-006']],
  ['GCP scoped service identity', 'gcp', 'identity', { permissions: ['storage.objects.get'], mfaRequired: true }, []],
  ['GCP public production VM', 'gcp', 'compute', { production: true, publicIp: '203.0.113.3' }, ['CSPM-008']],
  ['AWS private production VM', 'aws', 'compute', { production: true, publicIp: null }, []],
  ['Azure public nonproduction VM', 'azure', 'compute', { production: false, publicIp: '203.0.113.4' }, []]
];

const round = number => Number(number.toFixed(3));
const ratio = (numerator, denominator) => denominator ? numerator / denominator : null;

async function scheduledLatency() {
  const intervalMs = 1000;
  const pollMs = 50;
  const asset = { id: 'benchmark-bucket', name: 'benchmark-bucket', type: 'storage', public: false };
  const { app } = createApp({
    env: { SCAN_INTERVAL_MS: String(intervalMs) },
    dbPath: ':memory:',
    sources: [{ id: 'aws-lab', provider: 'aws', kind: 'fixture', label: 'Controlled benchmark input',
      collect: () => [{ ...asset }] }]
  });
  const browser = client(await listen(app));
  try {
    await browser.request('/api/auth/session');
    const signup = await browser.request('/api/auth/signup', {
      method: 'POST', body: { email: 'benchmark@example.test', password }
    });
    if (signup.status !== 202) throw new Error('Benchmark viewer signup failed: ' + signup.status);
    const signedIn = await browser.request('/api/auth/login', {
      method: 'POST', body: { email: 'benchmark@example.test', password }
    });
    if (signedIn.status !== 200) throw new Error('Benchmark viewer sign-in failed: ' + signedIn.status);
    async function findings() {
      const response = await browser.request('/api/findings');
      if (!response.ok) throw new Error('Benchmark API failed: ' + response.status);
      return response.json();
    }
    if ((await findings()).length) throw new Error('Expected an initially clean benchmark source');
    const started = performance.now();
    asset.public = true;
    while (performance.now() - started < 5000) {
      if ((await findings()).some(f => f.ruleId === 'CSPM-001')) {
        return { milliseconds: round(performance.now() - started), samples: 1, intervalMs, pollMs };
      }
      await delay(pollMs);
    }
    throw new Error('Scheduled scan failed to surface the benchmark detection');
  } finally {
    await new Promise(resolve => app.close(resolve));
  }
}

async function main() {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  const covered = new Set();
  const casesReport = cases.map(([name, provider, type, config, expected], index) => {
    const asset = { id: String(index), name, provider, environment: 'benchmark', type, ...config };
    const detected = scan([asset]).findings.map(f => f.ruleId);
    const applicable = Object.entries(rules[type]).flatMap(([field, ruleIds]) =>
      Object.hasOwn(config, field) ? ruleIds : []);
    for (const rule of new Set([...applicable, ...expected, ...detected])) {
      const positive = expected.includes(rule);
      const predicted = detected.includes(rule);
      if (positive) covered.add(rule);
      if (positive && predicted) tp++;
      else if (predicted) fp++;
      else if (positive) fn++;
      else tn++;
    }
    return { name, provider, type, applicable: [...new Set(applicable)], expected, detected, matched: expected.length === detected.length &&
      expected.every(rule => detected.includes(rule)) };
  });

  const inputs = cases.map(([name, provider, type, config], index) =>
    ({ name, provider, type, ...config, id: String(index), environment: 'benchmark' }));
  for (let i = 0; i < 30; i++) scan(inputs);
  const timings = Array.from({ length: 150 }, () => {
    const start = performance.now();
    scan(inputs);
    return performance.now() - start;
  }).sort((a, b) => a - b);
  const report = {
    dataset: 'Hand-labeled synthetic configuration scenarios',
    node: process.version,
    platform: process.platform,
    scenarios: cases.length,
    matchedScenarios: casesReport.filter(result => result.matched).length,
    providerScenarios: Object.fromEntries(['aws', 'azure', 'gcp'].map(provider =>
      [provider, casesReport.filter(result => result.provider === provider).length])),
    coverage: { rulesWithPositiveScenarios: covered.size,
      totalPostureRules: new Set(Object.values(rules).flatMap(mapping => Object.values(mapping).flat())).size },
    tp, fp, tn, fn,
    precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn), falsePositiveRate: ratio(fp, fp + tn),
    latency: {
      engineBatchMs: { samples: timings.length, batchSize: inputs.length,
        median: round(timings[Math.floor(timings.length / 2)]), p95: round(timings[Math.ceil(timings.length * 0.95) - 1]) },
      scheduledChangeToApi: await scheduledLatency()
    },
    externalComparisons: { prowler: 'pending', checkov: 'pending' },
    cases: casesReport
  };
  const results = path.join(__dirname, '..', 'results');
  await fs.mkdir(results, { recursive: true });
  await fs.writeFile(path.join(results, 'benchmark.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, cases: undefined }, null, 2));
  if (fp || fn) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
