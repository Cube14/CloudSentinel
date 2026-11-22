'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { configuredConnectors } = require('../server/connectors/config');
const { awsSource } = require('../server/connectors/aws');
const { createScanner } = require('../server/scans');
const { createApp } = require('../server/server');
const { client, login, listen, seedAdmin } = require('./session');

const accountId = '123456789012';
const regions = ['us-east-1', 'us-west-2'];
const config = { id: 'aws-team', provider: 'aws', label: 'Team AWS', accountId, regions, profile: 'team-audit' };
const caller = { Account: accountId, Arn: 'arn:aws:sts::' + accountId + ':assumed-role/ReadOnly/session' };
const defaultEncryption = { ServerSideEncryptionConfiguration: { Rules: [
  { ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }
] } };
const accessDenied = () => Object.assign(new Error('Private identity details'), { name: 'AccessDenied' });

test('local source configuration validates profiles, scope, secrets, IDs and loopback endpoints', () => {
  const sources = configuredConnectors([config,
    { id: 'azure-team', label: 'Azure team', provider: 'azure' },
    { id: 'gcp-team', label: 'GCP team', provider: 'gcp' },
    { id: 'other-floci', label: 'Other Floci', provider: 'aws', kind: 'emulator', endpoint: 'http://localhost:4567' }]);
  const scanner = createScanner(sources);
  const labels = scanner.selected(null).map(scanner.describe);
  assert.deepEqual(labels.map(source => [source.kind, source.status]), [
    ['live', 'idle'], ['live', 'not-connected'], ['live', 'not-connected'], ['emulator', 'idle']
  ]);
  assert.equal(labels[0].schedule, false);
  assert.equal(labels[3].schedule, true);
  assert.ok(!JSON.stringify(labels).includes(config.profile));
  assert.ok(!JSON.stringify(labels).includes(config.accountId));
  assert.throws(() => configuredConnectors([config, config]), /unique/);
  assert.throws(() => configuredConnectors([config], [config.id]), /unique/);
  assert.throws(() => configuredConnectors([{ ...config, accessKeyId: 'ignored' }]), /unsupported configuration field/);
  assert.throws(() => configuredConnectors([{ ...config, endpoint: 'https://example.com' }]), /unsupported configuration field/);
  assert.throws(() => configuredConnectors([{ ...config, accountId: 123456789012 }]), /12-digit/);
  assert.throws(() => configuredConnectors([{ ...config, regions: [regions[0], regions[0]] }]), /unique commercial/);
  assert.throws(() => configuredConnectors([{ ...config, regions: ['us-gov-west-1'] }]), /commercial/);
  assert.throws(() => configuredConnectors([{ ...config, kind: 'emulator', endpoint: 'https://example.com',
    profile: undefined, accountId: undefined, regions: undefined }]), /unsupported|loopback/);
});

function mockAws({ identity = caller, denyPolicy = false, denyEverything = false } = {}) {
  const requests = [];
  function client(service, region) {
    return {
      async send(command, options) {
        assert.ok(options.abortSignal instanceof AbortSignal);
        const op = command.constructor.name.replace(/Command$/, '');
        const input = command.input;
        requests.push({ service, region, op, input });
        if (op === 'GetCallerIdentity') return identity;
        if (denyEverything) throw accessDenied();
        switch (op) {
          case 'ListBuckets':
            assert.equal(input.BucketRegion, region);
            assert.equal(input.MaxBuckets, 500);
            if (region !== regions[0]) return { Buckets: [] };
            if (!input.ContinuationToken) return { Buckets: [{ Name: 'bucket-one', BucketRegion: region }], ContinuationToken: 'next' };
            assert.equal(input.ContinuationToken, 'next');
            return { Buckets: [{ Name: 'bucket-two', BucketRegion: region }] };
          case 'GetBucketPolicyStatus':
            assert.equal(input.ExpectedBucketOwner, accountId);
            if (denyPolicy && input.Bucket === 'bucket-one') throw accessDenied();
            return { PolicyStatus: { IsPublic: input.Bucket === 'bucket-one' } };
          case 'GetBucketEncryption':
            assert.equal(input.ExpectedBucketOwner, accountId);
            return defaultEncryption;
          case 'ListUsers':
            if (input.Marker) return { Users: [], IsTruncated: false };
            return { Users: [{ UserName: 'alice', Arn: 'arn:aws:iam::' + accountId + ':user/alice' }], IsTruncated: true, Marker: 'next' };
          case 'ListRoles':
            return { Roles: [{ RoleName: 'operator', Arn: 'arn:aws:iam::' + accountId + ':role/operator' }] };
          case 'ListAttachedUserPolicies':
            return { AttachedPolicies: [] };
          case 'ListAttachedRolePolicies':
            return { AttachedPolicies: [{ PolicyArn: 'arn:aws:iam::aws:policy/AdministratorAccess' }] };
          case 'GetLoginProfile':
            return { LoginProfile: { UserName: 'alice' } };
          case 'ListMFADevices':
            return { MFADevices: [] };
          case 'DescribeSecurityGroups':
            assert.deepEqual(input.Filters, [{ Name: 'owner-id', Values: [accountId] }]);
            if (input.NextToken) return { SecurityGroups: [] };
            return { SecurityGroups: [{ OwnerId: accountId, GroupId: 'sg-repeat', GroupName: 'app',
              IpPermissions: [{ IpProtocol: 'tcp', FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: '0.0.0.0/0' }] }] }],
            NextToken: 'next' };
          case 'DescribeInstances':
            return { Reservations: [{ OwnerId: accountId, Instances: [{ InstanceId: 'i-repeat', PublicIpAddress: '192.0.2.7' }] }] };
          default: throw new Error('Unexpected operation ' + op);
        }
      }
    };
  }
  return {
    requests,
    dependencies: {
      credentials: async () => ({}),
      clients: () => ({ sts: client('STS'), iam: client('IAM'), region: region => ({
        storage: client('S3', region), compute: client('EC2', region)
      }), close() {} })
    }
  };
}

test('AWS verifies STS identity, normalizes regional inventory and paginates read-only calls', async () => {
  const { requests, dependencies } = mockAws();
  const scanner = createScanner([awsSource(config, dependencies)]);
  await scanner.runScheduled();
  assert.equal(requests.length, 0);
  await scanner.run(config.id);
  const [entry] = scanner.selected(config.id);
  assert.equal(requests[0].op, 'GetCallerIdentity');
  assert.ok(requests.every(({ op }) => /^(Get|List|Describe)/.test(op)));
  assert.equal(requests.filter(request => request.op === 'ListBuckets').length, 3);
  assert.equal(requests.filter(request => request.op === 'ListUsers').length, 2);
  assert.equal(requests.filter(request => request.op === 'DescribeSecurityGroups').length, 4);
  assert.equal(entry.status, 'succeeded');
  assert.deepEqual(entry.inventory.filter(asset => asset.type === 'compute').map(asset => asset.id), regions.map(region => region + ':i-repeat'));
  assert.ok(entry.inventory.every(asset => asset.source === 'live' && asset.environment === config.id));
  assert.equal(entry.result.findings.filter(f => f.ruleId === 'CSPM-004').length, 2);
  assert.ok(entry.result.findings.some(f => f.ruleId === 'S3-001' && f.region === regions[0]));
  assert.ok(entry.result.findings.some(f => f.ruleId === 'IAM-002'));
  assert.ok(entry.result.findings.some(f => f.ruleId === 'IAM-003' && f.evidence.startsWith('ListAttachedRolePolicies')));
  assert.ok(entry.lastSuccess && entry.lastSnapshot === entry.lastSuccess);
});

test('missing and unexpected identity never run discovery; denied discovery and partial reads are explicit', async () => {
  const wrong = mockAws({ identity: { ...caller, Account: '999999999999' } });
  const mismatch = await awsSource(config, wrong.dependencies).collect();
  assert.equal(mismatch.state, 'not-connected');
  assert.deepEqual(wrong.requests.map(request => request.op), ['GetCallerIdentity']);
  const missing = await awsSource(config, { credentials: async () => { throw Error('private path'); },
    clients: () => assert.fail('clients must not be created') }).collect();
  assert.equal(missing.state, 'not-connected');
  assert.ok(!JSON.stringify(missing).includes('private path'));
  const blocked = mockAws({ denyEverything: true });
  const denied = await awsSource(config, blocked.dependencies).collect();
  assert.equal(denied.state, 'failed');
  assert.equal(denied.connection, 'connected');
  assert.ok(denied.warnings.every(warning => warning.code === 'AccessDenied'));
  const limited = mockAws({ denyPolicy: true });
  const partial = await awsSource(config, limited.dependencies).collect();
  assert.equal(partial.state, 'partial');
  assert.equal(partial.assets.find(asset => asset.id === 'bucket-one').publicPolicy, undefined);
  assert.ok(partial.warnings.some(warning => warning.operation === 'GetBucketPolicyStatus' && warning.code === 'AccessDenied'));
  assert.ok(!JSON.stringify(partial).includes('Private identity details'));
});

test('partial inventory retains last-known findings; full coverage resolves them per source', async () => {
  const asset = { id: 'shared', type: 'storage', name: 'shared', publicPolicy: true };
  let current = { assets: [asset], state: 'succeeded' };
  const scanner = createScanner([
    { id: 'one', provider: 'aws', kind: 'live', label: 'One', collect: async () => current },
    { id: 'two', provider: 'aws', kind: 'live', label: 'Two', collect: async () => [asset] }
  ]);
  await scanner.run();
  const [one, two] = scanner.selected(null);
  const initial = one.result.findings[0];
  const stable = one.lastSuccess;
  assert.notEqual(initial.id, two.result.findings[0].id);
  current = { assets: [], state: 'partial', warnings: [{ service: 'S3', code: 'AccessDenied' }] };
  await scanner.run('one');
  assert.equal(one.result.findings[0].id, initial.id);
  assert.equal(one.result.findings[0].stale, true);
  assert.equal(one.inventory[0].stale, true);
  assert.equal(one.result.score, null);
  assert.equal(one.lastSuccess, stable);
  assert.equal(one.resolved.length, 0);
  assert.equal(two.result.findings[0].stale, undefined);

  current = { assets: [], state: 'succeeded' };
  await scanner.run('one');
  assert.equal(one.result.findings.length, 0);
  assert.equal(one.resolved[0].id, initial.id);
  assert.equal(one.resolved[0].status, 'RESOLVED');
  assert.equal(two.result.findings.length, 1);
});

test('authenticated API loads local source definitions and refuses to scan an unavailable adapter', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudsentinel-connectors-'));
  const filename = path.join(directory, 'sources.json');
  const dbPath = path.join(directory, 'auth.sqlite');
  let app;
  try {
    await fs.writeFile(filename, JSON.stringify([
      { id: 'azure-team', label: 'Azure team', provider: 'azure' },
      { id: 'gcp-team', label: 'GCP team', provider: 'gcp' }
    ]));
    await seedAdmin(dbPath);
    ({ app } = createApp({ env: { CLOUD_SOURCES_FILE: filename }, dbPath }));
    const base = await listen(app);
    assert.equal((await fetch(base + '/api/environments')).status, 401);
    const browser = client(base);
    await login(browser);
    const dashboard = await (await browser.request('/api/dashboard')).json();
    assert.equal(dashboard.summary.assets, 12);
    for (const id of ['azure-team', 'gcp-team']) {
      const source = dashboard.environments.find(item => item.id === id);
      assert.equal(source.status, 'not-connected');
      assert.equal(source.lastSnapshot, null);
      assert.equal(source.scanEnabled, false);
    }
    const settings = { method: 'POST', body: {} };
    assert.equal((await browser.request('/api/scans/run?environment=azure-team', settings)).status, 409);
    assert.equal((await browser.request('/api/scans/run', settings)).status, 200);
  } finally {
    if (app?.listening) await new Promise(resolve => app.close(resolve));
    await fs.rm(filename, { force: true });
    await fs.rm(dbPath, { force: true });
    await fs.rmdir(directory);
  }
});
