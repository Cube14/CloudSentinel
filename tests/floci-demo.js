'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const s3 = require('@aws-sdk/client-s3');
const iam = require('@aws-sdk/client-iam');
const ec2 = require('@aws-sdk/client-ec2');
const { flociSource } = require('../server/floci');
const { localEndpoint } = require('../server/local-endpoint');
const { scan } = require('../security-engine/engine');

async function main() {
  if (!process.env.FLOCI_ENDPOINT) throw new Error('Set FLOCI_ENDPOINT to a dedicated local Floci instance');
  const endpoint = localEndpoint(process.env.FLOCI_ENDPOINT);
  const health = await fetch(endpoint + '/_floci/health', { signal: AbortSignal.timeout(3000), redirect: 'error' });
  if (!health.ok || (await health.json()).original_edition !== 'floci-always-free') {
    throw new Error('Expected a dedicated local Floci instance');
  }

  // Each run creates uniquely named demo resources. It only configures resources it creates.
  const suffix = randomUUID().slice(0, 8);
  const prefix = 'cloudsentinel-' + suffix;
  const options = { endpoint, region: 'us-east-1', maxAttempts: 1,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' } };
  const storage = new s3.S3Client({ ...options, forcePathStyle: true });
  const identity = new iam.IAMClient(options);
  const compute = new ec2.EC2Client(options);
  async function send(client, command) {
    try {
      return await client.send(command, { abortSignal: AbortSignal.timeout(5000) });
    } catch (error) {
      throw new Error(command.constructor.name + ': ' + error.name + ' ' + error.message);
    }
  }

  async function bucket(name, isPublic) {
    await send(storage, new s3.CreateBucketCommand({ Bucket: name }));
    await send(storage, new s3.PutBucketEncryptionCommand({
      Bucket: name, ServerSideEncryptionConfiguration: { Rules: [
        { ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }
      ] }
    }));
    if (isPublic) {
      await send(storage, new s3.PutPublicAccessBlockCommand({
        Bucket: name, PublicAccessBlockConfiguration: {
          BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: false, RestrictPublicBuckets: false
        }
      }));
      await send(storage, new s3.PutBucketPolicyCommand({
        Bucket: name,
        Policy: JSON.stringify({ Version: '2012-10-17', Statement: [
          { Effect: 'Allow', Principal: '*', Action: 's3:GetObject', Resource: 'arn:aws:s3:::' + name + '/*' }
        ] })
      }));
    }
    return name;
  }

  async function group(name, cidr) {
    const created = await send(compute, new ec2.CreateSecurityGroupCommand({
      GroupName: name, Description: 'CloudSentinel disposable posture demo'
    }));
    await send(compute, new ec2.AuthorizeSecurityGroupIngressCommand({
      GroupId: created.GroupId,
      IpPermissions: [{ IpProtocol: 'tcp', FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: cidr }] }]
    }));
    return created.GroupId;
  }

  const publicBucket = await bucket(prefix + '-public', true);
  const privateBucket = await bucket(prefix + '-private', false);
  const openGroup = await group(prefix + '-public', '0.0.0.0/0');
  const privateGroup = await group(prefix + '-private', '10.0.0.0/8');
  const userName = prefix + '-console';
  const user = await send(identity, new iam.CreateUserCommand({ UserName: userName }));
  await send(identity, new iam.CreateLoginProfileCommand({
    UserName: userName, Password: randomUUID() + 'Q7!'
  }));
  await send(identity, new iam.AttachUserPolicyCommand({
    UserName: userName, PolicyArn: 'arn:aws:iam::aws:policy/AdministratorAccess'
  }));
  const apiUser = await send(identity, new iam.CreateUserCommand({ UserName: prefix + '-api' }));

  const source = flociSource(endpoint);
  const inventory = (await source.collect()).map(asset => ({
    ...asset, provider: source.provider, environment: source.id, source: source.kind
  }));
  const expected = new Map([
    [publicBucket, ['S3-001']], [privateBucket, []],
    [openGroup, ['CSPM-004']], [privateGroup, []],
    [user.User.Arn, ['IAM-002', 'IAM-003']], [apiUser.User.Arn, []]
  ]);
  const { findings } = scan(inventory);
  const measured = [];
  for (const [id, rules] of expected) {
    assert.ok(inventory.some(asset => asset.id === id), 'Missing demo asset: ' + id);
    const detected = findings.filter(finding => finding.resourceId === id).map(finding => finding.ruleId).sort();
    assert.deepEqual(detected, rules, 'Rules for ' + id);
    measured.push({ id, detected });
  }
  console.log(JSON.stringify({ endpoint, scenario: prefix, measured }, null, 2));
}

main().catch(error => {
  console.error(error.name + ': ' + error.message);
  process.exitCode = 1;
});
