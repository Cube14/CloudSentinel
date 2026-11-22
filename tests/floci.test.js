'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createServer } = require('node:http');
const { flociSource } = require('../server/floci');
const { scan } = require('../security-engine/engine');

test('Floci SDK adapter rejects endpoints outside loopback', () => {
  for (const endpoint of ['https://localhost:4566', 'http://example.org', 'http://localhost:4566/path',
    'http://test:secret@localhost:4566', 'http://localhost:4566?target=aws']) {
    assert.throws(() => flociSource(endpoint), /loopback/);
  }
});

test('Floci SDK wire contract reads posture and propagates unsupported operations', async t => {
  // AWS-shaped HTTP test double. No emulator is started by this test.
  let unsupported = false;
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const query = new URLSearchParams(body);
    const url = new URL(req.url, 'http://localhost');
    const operation = query.get('Action') || (url.pathname === '/' ? 'ListBuckets' : [...url.searchParams.keys()][0]);
    requests.push({ operation, auth: req.headers.authorization, method: req.method });
    const xml = (body, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/xml' });
      res.end(body);
    };
    switch (operation) {
      case 'ListBuckets':
        return xml('<ListAllMyBucketsResult><Buckets><Bucket><Name>test-bucket</Name></Bucket></Buckets></ListAllMyBucketsResult>');
      case 'policyStatus':
        return xml('<PolicyStatus><IsPublic>true</IsPublic></PolicyStatus>');
      case 'encryption':
        return unsupported ? xml('<Error><Code>NotImplemented</Code><Message>Unsupported API</Message></Error>', 501)
          : xml('<Error><Code>ServerSideEncryptionConfigurationNotFoundError</Code></Error>', 404);
      case 'ListUsers':
        return query.get('Marker') ? xml('<ListUsersResponse><ListUsersResult><Users></Users><IsTruncated>false</IsTruncated></ListUsersResult></ListUsersResponse>')
          : xml('<ListUsersResponse><ListUsersResult><Users><member><Arn>arn:aws:iam::000000000000:user/admin</Arn><UserName>admin</UserName></member></Users><IsTruncated>true</IsTruncated><Marker>second-page</Marker></ListUsersResult></ListUsersResponse>');
      case 'ListAttachedUserPolicies':
        return xml('<ListAttachedUserPoliciesResponse><ListAttachedUserPoliciesResult><AttachedPolicies><member><PolicyArn>arn:aws:iam::aws:policy/AdministratorAccess</PolicyArn></member></AttachedPolicies></ListAttachedUserPoliciesResult></ListAttachedUserPoliciesResponse>');
      case 'GetLoginProfile':
        return xml('<GetLoginProfileResponse><GetLoginProfileResult><LoginProfile><UserName>admin</UserName></LoginProfile></GetLoginProfileResult></GetLoginProfileResponse>');
      case 'ListMFADevices':
        return xml('<ListMFADevicesResponse><ListMFADevicesResult><MFADevices/></ListMFADevicesResult></ListMFADevicesResponse>');
      case 'DescribeSecurityGroups':
        return xml('<DescribeSecurityGroupsResponse><securityGroupInfo><item><groupId>sg-test</groupId><groupName>test-group</groupName><ipPermissions><item><ipProtocol>tcp</ipProtocol><fromPort>20</fromPort><toPort>25</toPort><ipv6Ranges><item><cidrIpv6>::/0</cidrIpv6></item></ipv6Ranges></item></ipPermissions></item></securityGroupInfo></DescribeSecurityGroupsResponse>');
      case 'DescribeInstances':
        return xml('<DescribeInstancesResponse><reservationSet><item><instancesSet><item><instanceId>i-test</instanceId><ipAddress>192.0.2.4</ipAddress></item></instancesSet></item></reservationSet></DescribeInstancesResponse>');
      default:
        return xml('<Error><Code>UnexpectedOperation</Code></Error>', 400);
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const source = flociSource('http://127.0.0.1:' + server.address().port);
  const inventory = await source.collect();
  assert.equal(inventory.length, 4);
  assert.equal(inventory[0].logging, undefined);
  assert.equal(inventory.find(asset => asset.id === 'i-test').publicIp, '192.0.2.4');
  assert.deepEqual(scan(inventory).findings.map(f => f.ruleId).sort(),
    ['CSPM-002', 'CSPM-004', 'IAM-002', 'IAM-003', 'S3-001']);
  assert.equal(requests.filter(request => request.operation === 'ListUsers').length, 2);
  assert.ok(requests.every(request => request.auth?.includes('Credential=test/')));
  assert.ok(requests.every(request => request.method === 'GET' ||
    /^(List|Describe|Get)/.test(request.operation)));
  unsupported = true;
  await assert.rejects(source.collect(), /GetBucketEncryptionCommand.*Unsupported API/);
});
