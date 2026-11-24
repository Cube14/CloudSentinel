'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createApp } = require('../server/server');
const { flociSource } = require('../server/floci');
const { endpoint, openLab } = require('../server/floci-lab');
const { demonstrateSSH } = require('../scripts/floci-ssh-demo');
const { openStore } = require('../server/auth/store');
const { adminEmail, client, listen, login, password, seedAdmin } = require('./session');

const path = '/api/lab/s3';
const post = (browser, route, body, options = {}) => browser.request(route, { method: 'POST', body, ...options });
const missing = name => Object.assign(new Error(name), { name });
const live = process.env.FLOCI_LIVE_TEST === '1';

function emulate() {
  const buckets = new Map();
  const calls = [];
  const probe = async url => {
    assert.equal(url, endpoint + '/_floci/info');
    return Response.json({ emulator: 'floci', cloud: 'aws', version: '2.5.0', services: { s3: 'enabled' } });
  };
  const storage = { async send({ constructor: command, input }) {
    calls.push(command.name);
    const bucket = buckets.get(input.Bucket);
    switch (command.name) {
      case 'ListBucketsCommand': return { Buckets: [...buckets.keys()].map(Name => ({ Name })) };
      case 'ListObjectsV2Command': return { KeyCount: bucket.objects?.length || 0, Contents: bucket.objects };
      case 'CreateBucketCommand': buckets.set(input.Bucket, {}); return {};
      case 'GetBucketTaggingCommand':
        if (!bucket.tags) throw missing('NoSuchTagSet');
        return { TagSet: bucket.tags };
      case 'PutBucketTaggingCommand': bucket.tags = input.Tagging.TagSet; return {};
      case 'GetBucketPolicyStatusCommand':
        if (!bucket.policy) throw missing('NoSuchBucketPolicy');
        return { PolicyStatus: { IsPublic: true } };
      case 'PutBucketPolicyCommand':
        assert.equal(bucket.block.BlockPublicPolicy, false);
        assert.equal(JSON.parse(input.Policy).Statement[0].Resource, 'arn:aws:s3:::' + input.Bucket + '/*');
        bucket.policy = true; return {};
      case 'DeleteBucketPolicyCommand': delete bucket.policy; return {};
      case 'GetPublicAccessBlockCommand':
        if (!bucket.block) throw missing('NoSuchPublicAccessBlockConfiguration');
        return { PublicAccessBlockConfiguration: bucket.block };
      case 'PutPublicAccessBlockCommand': bucket.block = input.PublicAccessBlockConfiguration; return {};
      case 'GetBucketEncryptionCommand':
        if (!bucket.encryption) throw missing('ServerSideEncryptionConfigurationNotFoundError');
        return { ServerSideEncryptionConfiguration: bucket.encryption };
      case 'PutBucketEncryptionCommand': bucket.encryption = input.ServerSideEncryptionConfiguration; return {};
      default: throw new Error(command.name);
    }
  } };
  const collect = async () => [...buckets].map(([id, config]) => ({ name: id, id, type: 'storage',
    publicPolicy: config.policy === true, encryptionAlgorithms: config.encryption ? ['AES256'] : [] }));
  return { buckets, calls, probe, storage, collect };
}

test('lab verifies identity before writes and accepts the fixed endpoint only', async () => {
  const store = openStore(':memory:');
  const fixture = emulate();
  try {
    assert.throws(() => openLab(store, 'https://s3.amazonaws.com', fixture), /fixed Floci endpoint/);
    const lab = openLab(store, endpoint, { ...fixture, probe: async () => Response.json({ status: 'OK' }) });
    await assert.rejects(lab.mutate({ prefix: 'demo', template: 'public', confirm: 'demo' }, {}), /Could not verify/);
    assert.deepEqual(fixture.calls, []);
  } finally { store.close(); }
});

test('lab reports unsupported encryption and refuses to make a nonempty or unapproved bucket public', async () => {
  const store = openStore(':memory:');
  const fixture = emulate();
  const unsupported = { async send(command) {
    if (command.constructor.name === 'GetBucketEncryptionCommand') throw missing('NotImplemented');
    return fixture.storage.send(command);
  } };
  const lab = openLab(store, endpoint, { probe: fixture.probe, storage: unsupported });
  try {
    const configured = await lab.mutate({ prefix: 'fixture', confirm: 'fixture', template: 'secure' }, {});
    assert.equal(configured.after.encryption.supported, false);
    assert.match(configured.warnings[0], /unsupported/);
    assert.ok(!fixture.calls.includes('PutBucketEncryptionCommand'));
    const { name } = configured;
    fixture.buckets.get(name).objects = [{ Key: 'fixture-object' }];
    await assert.rejects(lab.mutate({ bucket: name, confirm: name, template: 'public' }, {}), /verified empty/);
    assert.ok(!fixture.calls.includes('PutBucketPolicyCommand'));
    fixture.buckets.get(name).tags = [{ Key: 'cloudsentinel-disposable', Value: 'not-the-approved-marker' }];
    await assert.rejects(lab.mutate({ bucket: name, confirm: name, template: 'public' }, {}), /outside the approved/);
  } finally { store.close(); }
});

test('real API workflow persists finding history and distinguishes terminal changes (' + (live ? 'Floci 2.5.0' : 'SDK test double') + ')', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-lab-'));
  const dbPath = join(dir, 'lab.sqlite');
  const fixture = emulate();
  const source = flociSource(endpoint, { schedule: false });
  const collect = live ? source.collect : fixture.collect;
  let mode = 'complete';
  source.collect = async () => {
    if (mode === 'failed') throw new Error('Collection failed');
    const assets = await collect();
    return mode === 'partial' ? { state: 'partial', assets } : assets;
  };
  await seedAdmin(dbPath);
  let app;
  t.after(async () => {
    if (app?.listening) await new Promise(resolve => app.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  const launch = async (sourceConfig = source) => {
    ({ app } = createApp({ dbPath, sources: [sourceConfig], labDependencies: live ? undefined : fixture,
      env: { FLOCI_ENDPOINT: endpoint, FLOCI_LAB_ENABLED: '1' } }));
    return listen(app);
  };
  let base = await launch();
  let admin = client(base);
  await login(admin);
  const viewer = client(base);
  await viewer.request('/api/auth/session');
  const email = 'viewer@example.test';
  assert.equal((await post(viewer, '/api/auth/signup', { email, password })).status, 202);
  await login(viewer, email);
  const creation = { prefix: 'smoke', template: 'public', confirm: 'smoke' };
  assert.equal((await post(viewer, path, creation)).status, 403);
  assert.equal((await viewer.request(path)).status, 403);
  assert.equal((await viewer.request('/api/auth/audit/events')).status, 403);
  assert.equal((await post(admin, path, creation, { token: '' })).status, 403);
  assert.equal((await post(admin, path, { ...creation, prefix: 'Invalid.Bucket' })).status, 400);
  assert.equal((await post(admin, path, { ...creation, confirm: 'wrong' })).status, 400);
  assert.equal((await post(admin, path, { ...creation, endpoint: 'https://s3.amazonaws.com' })).status, 400);
  assert.equal((await post(admin, path + '?environment=aws-prod', creation)).status, 400);

  const create = await post(admin, path, creation);
  assert.equal(create.status, 200, await create.clone().text());
  const { name, after } = await create.json();
  if (live) t.diagnostic('Verified disposable bucket ' + name);
  assert.equal(after.policy.value, true);
  assert.equal(after.block.value.BlockPublicPolicy, false);
  const labScan = async () => {
    const result = await post(admin, path + '/scan', {});
    return { status: result.status, ...await result.json() };
  };
  const open = (await labScan()).findings.find(finding => finding.resourceId === name && finding.ruleId === 'S3-001');
  assert.equal(open.status, 'OPEN');
  const fix = await post(admin, path, { bucket: name, confirm: name, template: 'secure' });
  assert.equal(fix.status, 200, await fix.clone().text());
  const verified = await (await admin.request(path + '?bucket=' + name)).json();
  assert.equal(verified.policy.value, null);
  assert.equal(Object.values(verified.block.value).every(Boolean), true);
  mode = 'failed';
  assert.equal((await labScan()).status, 'failed');
  assert.ok((await (await admin.request('/api/findings?environment=aws-floci')).json()).some(finding => finding.id === open.id));
  mode = 'partial';
  assert.equal((await labScan()).resolved.some(finding => finding.id === open.id), false);
  mode = 'complete';
  await new Promise(resolve => app.close(resolve));

  base = await launch();
  admin = client(base);
  await login(admin);
  const fixed = (await labScan()).resolved.find(finding => finding.id === open.id);
  assert.equal(fixed.status, 'RESOLVED');
  assert.match(fixed.resolutionEvidence, /no public policy/);

  const terminalStore = openStore(dbPath);
  const terminal = openLab(terminalStore, endpoint, live ? undefined : fixture);
  try {
    await terminal.mutate({ bucket: name, confirm: name, template: 'public' }, { channel: 'terminal' });
    assert.ok((await labScan()).findings.some(finding => finding.id === open.id));
    await terminal.mutate({ bucket: name, confirm: name, template: 'secure' }, { channel: 'terminal' });
    assert.ok((await labScan()).resolved.some(finding => finding.id === open.id));
  } finally {
    terminal.close();
    terminalStore.close();
  }

  const result = await (await admin.request('/api/auth/audit/events?q=' + name + '&limit=100')).json();
  const detected = result.entries.filter(event => event.kind === 'finding' && event.details.ruleId === 'S3-001');
  assert.deepEqual(detected.map(event => event.action),
    ['finding-resolved', 'finding-reopened', 'finding-resolved', 'finding-opened']);
  assert.ok(detected.every(event => event.actor === null && event.details.findingId === open.id));
  assert.ok(result.entries.some(event => event.channel === 'terminal' && event.actor === null && event.action === 'bucket-configuration-changed'));
  assert.ok(result.entries.some(event => event.actor === adminEmail && event.action === 'bucket-created'));

  await new Promise(resolve => app.close(resolve));
  base = await launch({ ...source, kind: 'live' });
  admin = client(base);
  await login(admin);
  assert.equal((await post(admin, path, creation)).status, 503);
});

test('Floci SDK detects critical SSH on a temporary detached security group', { skip: !live }, async () => {
  const finding = await demonstrateSSH(endpoint);
  assert.equal(finding.ruleId, 'CSPM-004');
  assert.equal(finding.severity, 'CRITICAL');
});
