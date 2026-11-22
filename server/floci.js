'use strict';

const { localEndpoint } = require('./local-endpoint');

const { connector } = require('./connectors/interface');
const { read, readPages, normalizeGroup, normalizeInstance, isBucketName } = require('./connectors/aws-read');

function flociSource(value, config = {}) {
  const endpoint = localEndpoint(value);
  // Load SDK clients when explicitly enabling the emulator.
  const s3 = require('@aws-sdk/client-s3');
  const iam = require('@aws-sdk/client-iam');
  const ec2 = require('@aws-sdk/client-ec2');
  const options = {
    endpoint, region: 'us-east-1', maxAttempts: 1, followRegionRedirects: false,
    useDualstackEndpoint: false, useFipsEndpoint: false,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' }
  };
  const storage = new s3.S3Client({ ...options, forcePathStyle: true });
  const identity = new iam.IAMClient(options);
  const compute = new ec2.EC2Client(options);

  return connector({ id: 'aws-floci', label: 'AWS Floci emulator', ...config,
    provider: 'aws', kind: 'emulator', endpoint }, async () => {
    const signal = AbortSignal.timeout(20000);
    const inventory = [];
    const buckets = await readPages(storage, s3.ListBucketsCommand, {}, 'Buckets', 'ContinuationToken', null, signal);
    for (const bucket of buckets) {
      if (!isBucketName(bucket.Name)) {
        throw new Error('Invalid S3 bucket name in ListBuckets response');
      }
      const input = { Bucket: bucket.Name };
      const policy = await read(storage, s3.GetBucketPolicyStatusCommand, input, signal, 'NoSuchBucketPolicy');
      const encryption = await read(storage, s3.GetBucketEncryptionCommand, input, signal,
        'ServerSideEncryptionConfigurationNotFoundError');
      const publicPolicy = policy ? policy.PolicyStatus?.IsPublic : false;
      const algorithms = encryption ? encryption.ServerSideEncryptionConfiguration?.Rules?.map(rule =>
        rule.ApplyServerSideEncryptionByDefault?.SSEAlgorithm) : [];
      if (typeof publicPolicy !== 'boolean' ||
          (encryption && (!algorithms?.length || algorithms.some(algorithm => typeof algorithm !== 'string')))) {
        throw new Error('Incomplete S3 configuration response for ' + bucket.Name);
      }
      inventory.push({ id: bucket.Name, name: bucket.Name, type: 'storage', publicPolicy, encryptionAlgorithms: algorithms });
    }

    const users = await readPages(identity, iam.ListUsersCommand, {}, 'Users', 'Marker', 'IsTruncated', signal);
    for (const user of users) {
      const input = { UserName: user.UserName };
      const policies = await readPages(identity, iam.ListAttachedUserPoliciesCommand, input,
        'AttachedPolicies', 'Marker', 'IsTruncated', signal);
      const login = await read(identity, iam.GetLoginProfileCommand, input, signal, 'NoSuchEntity');
      if (login && !login.LoginProfile) throw new Error('Incomplete IAM login profile response');
      const devices = login ? await readPages(identity, iam.ListMFADevicesCommand, input,
        'MFADevices', 'Marker', 'IsTruncated', signal) : null;
      inventory.push({ id: user.Arn, name: user.UserName, type: 'identity', consoleLogin: Boolean(login),
        mfaDevices: devices?.length ?? null, directPolicies: policies.map(policy => policy.PolicyArn),
        adminPolicyArn: policies.find(policy => policy.PolicyArn === 'arn:aws:iam::aws:policy/AdministratorAccess')?.PolicyArn });
    }

    const groups = await readPages(compute, ec2.DescribeSecurityGroupsCommand, {}, 'SecurityGroups',
      'NextToken', null, signal);
    for (const group of groups) inventory.push(normalizeGroup(group));

    const reservations = await readPages(compute, ec2.DescribeInstancesCommand, {}, 'Reservations',
      'NextToken', null, signal);
    for (const instance of reservations.flatMap(reservation => reservation.Instances || [])) {
      inventory.push(normalizeInstance(instance));
    }
    return inventory;
  });
}

module.exports = { flociSource };
