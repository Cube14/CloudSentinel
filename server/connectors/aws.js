'use strict';

const { defaultProvider } = require('@aws-sdk/credential-provider-node');
const s3 = require('@aws-sdk/client-s3');
const iam = require('@aws-sdk/client-iam');
const ec2 = require('@aws-sdk/client-ec2');
const { STSClient, GetCallerIdentityCommand } = require('@aws-sdk/client-sts');
const { connector } = require('./interface');
const { read, readPages, normalizeGroup, normalizeInstance, isBucketName } = require('./aws-read');

const endpointOptions = { ignoreConfiguredEndpointUrls: true, useDualstackEndpoint: false, useFipsEndpoint: false };
const authErrors = /CredentialsProviderError|ExpiredToken|InvalidClientTokenId|UnrecognizedClient|InvalidIdentityToken|SSO|TokenProviderError|InvalidGrant|InvalidToken/;
const invalidResponse = () => Object.assign(new Error('Unexpected response'), { name: 'InvalidResponse' });

function openClients(config, credentials) {
  const base = { ...endpointOptions, credentials, region: config.regions[0], maxAttempts: 2 };
  const created = [];
  function create(Client, options) {
    const client = new Client({ ...base, ...options });
    created.push(client);
    return client;
  }
  return {
    sts: create(STSClient),
    iam: create(iam.IAMClient),
    region: region => ({ storage: create(s3.S3Client, { region, forcePathStyle: true, followRegionRedirects: false,
      useGlobalEndpoint: false }),
      compute: create(ec2.EC2Client, { region }) }),
    close: () => created.forEach(client => client.destroy())
  };
}

async function resolveCredentials(provider, signal) {
  signal.throwIfAborted();
  let abort;
  try {
    return await Promise.race([provider(), new Promise((_, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
    })]);
  } finally {
    if (abort) signal.removeEventListener('abort', abort);
  }
}

function safeCode(error, signal) {
  if (signal.aborted) return 'Timeout';
  const cause = error.cause || error;
  const name = [cause.name, cause.code, cause.Code].filter(Boolean).join(' ');
  if (authErrors.test(name) || cause.$metadata?.httpStatusCode === 401) return 'AuthenticationRequired';
  if (cause.$metadata?.httpStatusCode === 403 || /AccessDenied|UnauthorizedOperation|Forbidden|AuthFailure/.test(name)) return 'AccessDenied';
  if (/Timeout|Abort/.test(name)) return 'Timeout';
  if (/Throttl|RequestLimitExceeded|SlowDown|TooManyRequests/.test(name)) return 'Throttled';
  if (/InvalidResponse/.test(name) || /Invalid pagination/.test(error.message)) return 'InvalidResponse';
  return 'ApiError';
}

function awsSource(config, dependencies = {}) {
  const { id, label, accountId, regions, profile, schedule = false } = config;
  const provider = dependencies.credentials || defaultProvider({
    ...(profile ? { profile } : {}), clientConfig: endpointOptions, timeout: 1000, maxRetries: 1
  });
  const factory = dependencies.clients || openClients;

  return connector({ id, provider: 'aws', kind: 'live', label, schedule, identity: [accountId, regions] }, async () => {
    const scanSignal = AbortSignal.timeout(45000);
    let credentials;
    try {
      credentials = await resolveCredentials(provider, AbortSignal.any([scanSignal, AbortSignal.timeout(12000)]));
    } catch {
      return { state: 'not-connected', error: 'AWS credentials unavailable. Check the configured profile or refresh the AWS session.' };
    }

    const clients = factory(config, credentials);
    try {
      const stsSignal = AbortSignal.any([scanSignal, AbortSignal.timeout(8000)]);
      let caller;
      try {
        caller = await read(clients.sts, GetCallerIdentityCommand, {}, stsSignal);
      } catch (error) {
        const code = safeCode(error, stsSignal);
        return { state: code === 'AuthenticationRequired' ? 'not-connected' : 'failed',
          error: 'AWS account identity could not be verified.', warnings: [{ service: 'STS', operation: 'GetCallerIdentity', code, count: 1 }] };
      }
      const arn = caller.Arn?.split(':');
      if (caller.Account !== accountId || arn?.[1] !== 'aws' || arn?.[4] !== accountId) {
        return { state: 'not-connected', error: 'AWS identity did not match the expected account. Discovery was skipped.' };
      }

      const assets = [];
      const warnings = new Map();
      let reads = 0;

      async function attempt(service, region, operation, run) {
        const signal = AbortSignal.any([scanSignal, AbortSignal.timeout(8000)]);
        try {
          const result = await run(signal);
          reads++;
          return result;
        } catch (error) {
          const code = safeCode(error, signal);
          const key = JSON.stringify([service, region, operation, code]);
          if (!warnings.has(key)) warnings.set(key, { service, region, operation, code, count: 0 });
          warnings.get(key).count++;
          return undefined;
        }
      }

      async function getPages(service, region, client, command, input, field, token, truncated, validate) {
        return attempt(service, region, command.name.replace(/Command$/, ''), async signal => {
          const entries = await readPages(client, command, input, field, token, truncated, signal);
          if (validate && !entries.every(validate)) throw invalidResponse();
          return entries;
        });
      }

      async function collectIam() {
        const client = clients.iam;
        const validIdentity = name => item => typeof item[name] === 'string' && !!item[name] &&
          typeof item.Arn === 'string' && item.Arn.startsWith('arn:aws:iam::' + accountId + ':');
        const validPolicy = policy => typeof policy.PolicyArn === 'string';
        const users = await getPages('IAM', null, client, iam.ListUsersCommand, {}, 'Users', 'Marker', 'IsTruncated', validIdentity('UserName'));
        for (const user of users || []) {
          const input = { UserName: user.UserName };
          const [policies, login] = await Promise.all([
            getPages('IAM', null, client, iam.ListAttachedUserPoliciesCommand, input, 'AttachedPolicies', 'Marker', 'IsTruncated', validPolicy),
            attempt('IAM', null, 'GetLoginProfile', async signal => {
              const found = await read(client, iam.GetLoginProfileCommand, input, signal, 'NoSuchEntity');
              if (found && found.LoginProfile?.UserName !== user.UserName) throw invalidResponse();
              return found !== null;
            })
          ]);
          const devices = login ? await getPages('IAM', null, client, iam.ListMFADevicesCommand, input,
            'MFADevices', 'Marker', 'IsTruncated') : undefined;
          assets.push(identityAsset(user.Arn, user.UserName, 'user', policies, { consoleLogin: login, mfaDevices: devices?.length }));
        }

        const roles = await getPages('IAM', null, client, iam.ListRolesCommand, {}, 'Roles', 'Marker', 'IsTruncated', validIdentity('RoleName'));
        for (const role of roles || []) {
          const policies = await getPages('IAM', null, client, iam.ListAttachedRolePoliciesCommand, { RoleName: role.RoleName },
            'AttachedPolicies', 'Marker', 'IsTruncated', validPolicy);
          assets.push(identityAsset(role.Arn, role.RoleName, 'role', policies));
        }
      }

      async function collectBuckets(region, client) {
        const buckets = await getPages('S3', region, client, s3.ListBucketsCommand, { BucketRegion: region, MaxBuckets: 500 },
          'Buckets', 'ContinuationToken', null, bucket => isBucketName(bucket.Name) && (!bucket.BucketRegion || bucket.BucketRegion === region));
        for (const bucket of buckets || []) {
          const input = { Bucket: bucket.Name, ExpectedBucketOwner: accountId };
          const [publicPolicy, encryptionAlgorithms] = await Promise.all([
            attempt('S3', region, 'GetBucketPolicyStatus', async signal => {
              const result = await read(client, s3.GetBucketPolicyStatusCommand, input, signal, 'NoSuchBucketPolicy');
              if (result === null) return false;
              if (typeof result.PolicyStatus?.IsPublic !== 'boolean') throw invalidResponse();
              return result.PolicyStatus.IsPublic;
            }),
            attempt('S3', region, 'GetBucketEncryption', async signal => {
              const result = await read(client, s3.GetBucketEncryptionCommand, input, signal,
                'ServerSideEncryptionConfigurationNotFoundError');
              if (result === null) return [];
              const algorithms = result.ServerSideEncryptionConfiguration?.Rules?.map(rule => rule.ApplyServerSideEncryptionByDefault?.SSEAlgorithm);
              if (!algorithms?.length || algorithms.some(name => typeof name !== 'string')) throw invalidResponse();
              return algorithms;
            })
          ]);
          assets.push({ id: bucket.Name, name: bucket.Name, type: 'storage', region, publicPolicy, encryptionAlgorithms });
        }
      }

      async function collectRegion(region) {
        const { storage, compute } = clients.region(region);
        const [groups, reservations] = await Promise.all([
          getPages('EC2', region, compute, ec2.DescribeSecurityGroupsCommand,
            { Filters: [{ Name: 'owner-id', Values: [accountId] }], MaxResults: 100 }, 'SecurityGroups',
            'NextToken', null, group => group.OwnerId === accountId && typeof group.GroupId === 'string' && typeof group.GroupName === 'string'),
          getPages('EC2', region, compute, ec2.DescribeInstancesCommand, { MaxResults: 100 }, 'Reservations',
            'NextToken', null, reservation => reservation.OwnerId === accountId &&
              (reservation.Instances || []).every(instance => typeof instance.InstanceId === 'string')),
          collectBuckets(region, storage)
        ]);
        for (const group of groups || []) assets.push(normalizeGroup(group, region));
        for (const reservation of reservations || []) {
          for (const instance of reservation.Instances || []) assets.push(normalizeInstance(instance, region));
        }
      }

      async function collectRegions() {
        for (const region of regions) await collectRegion(region);
      }

      await Promise.all([collectIam(), collectRegions()]);
      const issues = [...warnings.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      if (!reads) return { state: 'failed', connection: 'connected', error: 'AWS returned no usable discovery responses.', warnings: issues };
      return { assets, state: issues.length ? 'partial' : 'succeeded', warnings: issues };
    } finally {
      clients.close();
    }
  });
}

function identityAsset(id, name, identityKind, policies, fields) {
  const directPolicies = policies?.map(policy => policy.PolicyArn);
  return { id, name, type: 'identity', identityKind, ...fields, directPolicies,
    adminPolicyArn: directPolicies?.find(arn => arn === 'arn:aws:iam::aws:policy/AdministratorAccess') };
}

module.exports = { awsSource };
