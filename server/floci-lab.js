'use strict';

const { randomUUID } = require('node:crypto');
const s3 = require('@aws-sdk/client-s3');
const { isIP } = require('node:net');
const { isBucketName, readPages } = require('./connectors/aws-read');
const { record } = require('./audit');

const endpoint = 'http://127.0.0.1:4566';
const sourceEnvironment = 'aws-floci';
const markerKey = 'cloudsentinel-disposable';
const flags = ['BlockPublicAcls', 'IgnorePublicAcls', 'BlockPublicPolicy', 'RestrictPublicBuckets'];
const problem = (status, message) => Object.assign(new Error(message), { status });
const unsupported = error => ['NotImplemented', 'NotSupported', 'UnsupportedOperation'].includes(error.name) ||
  error.$metadata?.httpStatusCode === 501;

async function verifyEmulator(probe = fetch) {
  try {
    const response = await probe(endpoint + '/_floci/info', { redirect: 'error', signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error();
    const manifest = await response.json();
    if (manifest.emulator !== 'floci' || manifest.cloud !== 'aws' || manifest.version !== '2.5.0' ||
        manifest.services?.s3 !== 'enabled') throw new Error();
    return manifest.version;
  } catch {
    throw problem(503, 'Could not verify the AWS Floci 2.5.0 emulator with S3 enabled.');
  }
}


function openLab(store, configuredEndpoint, { probe = fetch, storage } = {}) {
  if (configuredEndpoint !== endpoint) throw problem(503, 'The S3 Lab requires the fixed Floci endpoint http://127.0.0.1:4566.');
  const sdk = storage || new s3.S3Client({ endpoint, region: 'us-east-1', forcePathStyle: true, maxAttempts: 1,
    followRegionRedirects: false, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } });

  async function send(Command, input, absent) {
    try {
      return await sdk.send(new Command(input), { abortSignal: AbortSignal.timeout(5000) });
    } catch (error) {
      if (absent && [absent, absent + 'Exception'].includes(error.name)) return null;
      if (error.name === 'NoSuchBucket') throw problem(404, 'This bucket is no longer present in Floci.');
      if (unsupported(error)) throw problem(501, Command.name.replace(/Command$/, '') + ' is unsupported by this Floci emulator.');
      throw problem(502, Command.name.replace(/Command$/, '') + ' failed at the Floci endpoint.');
    }
  }

  async function optional(Command, input, absent, normalize) {
    try {
      const response = await send(Command, input, absent);
      return { supported: true, value: response === null ? null : normalize(response) };
    } catch (error) {
      if (error.status === 501) return { supported: false, value: null };
      throw error;
    }
  }

  function validateName(name) {
    if (!isBucketName(name) || isIP(name) || name.includes('..') || /^(?:xn--|sthree-|amzn-s3-demo-)|(?:-s3alias|--ol-s3|\.mrap|--x-s3|--table-s3)$/.test(name)) throw problem(400, 'Enter an exact valid S3 bucket name.');
  }

  async function owned(name) {
    const marker = store.bucketMarker(name);
    if (!marker) return false;
    const tags = await optional(s3.GetBucketTaggingCommand, { Bucket: name }, 'NoSuchTagSet', result => result.TagSet);
    return tags.value?.some(tag => tag.Key === markerKey && tag.Value === marker) === true;
  }

  async function inspect(name) {
    const input = { Bucket: name };
    const [policy, block, encryption, managed] = await Promise.all([
      optional(s3.GetBucketPolicyStatusCommand, input, 'NoSuchBucketPolicy', result => {
        if (typeof result.PolicyStatus?.IsPublic !== 'boolean') throw problem(502, 'Incomplete S3 policy status.');
        return result.PolicyStatus.IsPublic;
      }),
      optional(s3.GetPublicAccessBlockCommand, input, 'NoSuchPublicAccessBlockConfiguration', result => {
        if (!flags.every(flag => typeof result.PublicAccessBlockConfiguration?.[flag] === 'boolean')) {
          throw problem(502, 'Incomplete S3 Block Public Access configuration.');
        }
        return result.PublicAccessBlockConfiguration;
      }),
      optional(s3.GetBucketEncryptionCommand, input, 'ServerSideEncryptionConfigurationNotFoundError', result => {
        const algorithms = result.ServerSideEncryptionConfiguration?.Rules?.map(rule =>
          rule.ApplyServerSideEncryptionByDefault?.SSEAlgorithm);
        if (!algorithms?.length || algorithms.some(value => typeof value !== 'string')) {
          throw problem(502, 'Incomplete S3 encryption configuration.');
        }
        return algorithms;
      }),
      owned(name)
    ]);
    return { name, managed, policy, block, encryption };
  }

  async function list() {
    const version = await verifyEmulator(probe);
    const buckets = await readPages(sdk, s3.ListBucketsCommand, {}, 'Buckets', 'ContinuationToken', null,
      AbortSignal.timeout(8000)).catch(() => { throw problem(502, 'Could not list buckets from verified Floci.'); });
    return { version, buckets: buckets.map(({ Name: name }) => {
      validateName(name);
      return { name, registered: Boolean(store.bucketMarker(name)) };
    }) };
  }

  function settings(body) {
    const { template, custom } = body;
    if (template === 'secure' && custom === undefined) return { policy: 'private', block: true, encryption: 'AES256' };
    if (template === 'public' && custom === undefined) return { policy: 'public', block: false, encryption: 'leave' };
    if (template !== 'custom' || !custom || typeof custom !== 'object' || Array.isArray(custom) ||
        Object.keys(custom).length !== 3 || !['private', 'public'].includes(custom.policy) ||
        typeof custom.block !== 'boolean' || !['leave', 'AES256'].includes(custom.encryption) ||
        (custom.policy === 'public' && custom.block)) throw problem(400, 'Invalid lab template or configuration.');
    return custom;
  }

  async function mutate(body, attribution) {
    const creating = Object.hasOwn(body, 'prefix');
    if (Object.keys(body).some(key => ![creating ? 'prefix' : 'bucket', 'template', 'custom', 'confirm'].includes(key))) {
      throw problem(400, 'Only the supported lab configuration fields are accepted.');
    }
    const proposed = settings(body);
    const requested = creating ? body.prefix : body.bucket;
    if (creating && (typeof requested !== 'string' || !/^[a-z0-9][a-z0-9-]{0,22}[a-z0-9]$/.test(requested))) {
      throw problem(400, 'Use a prefix of 2–24 lowercase letters, digits or interior hyphens.');
    }
    const name = creating ? 'cs-demo-' + requested + '-' + randomUUID().replaceAll('-', '').slice(0, 24) : requested;
    validateName(name);
    if (body.confirm !== requested) throw problem(400, 'Type the exact prefix or bucket name to confirm the change.');
    const operationId = randomUUID();
    const context = { ...attribution, sourceEnvironment, operationId, resource: name };
    const log = (action, status, details) => record(store, 'lab', action, status, { ...context, details });
    const input = { Bucket: name };
    let locked = false;
    let stage = 'verify-emulator';
    try {
      await verifyEmulator(probe);
      locked = store.lockBucket(name, operationId, Date.now());
      if (!locked) throw problem(409, 'Another lab change is in progress for this bucket.');
      if (creating) {
        stage = 'create';
        await send(s3.CreateBucketCommand, input);
        log('bucket-created', 'success', { template: body.template });
        stage = 'register-disposable';
        const marker = randomUUID();
        await send(s3.PutBucketTaggingCommand, { ...input, Tagging: { TagSet: [{ Key: markerKey, Value: marker }] } });
        const tags = await send(s3.GetBucketTaggingCommand, input);
        if (!tags.TagSet?.some(tag => tag.Key === markerKey && tag.Value === marker)) {
          throw problem(502, 'Floci did not return the disposable bucket marker.');
        }
        store.approveBucket(name, marker);
      } else {
        stage = 'verify-disposable';
        if (!await owned(name)) throw problem(403, 'This bucket is outside the approved disposable lab resources.');
      }
      if (proposed.policy === 'public') {
        stage = 'verify-empty';
        const objects = await send(s3.ListObjectsV2Command, { ...input, MaxKeys: 1 });
        if (objects.KeyCount !== 0 || objects.Contents?.length || objects.IsTruncated) {
          throw problem(409, 'A public demo policy requires a verified empty disposable bucket.');
        }
      }
      stage = 'inspect';
      const before = await inspect(name);
      if (!before.policy.supported || !before.block.supported) {
        throw problem(501, 'Bucket policy status and Block Public Access must both be supported.');
      }
      const changes = [];
      const change = async (field, command, params, absent) => {
        stage = field;
        await send(command, params, absent);
        const observed = await inspect(name);
        const valid = field === 'policy'
          ? (proposed.policy === 'public' ? observed.policy.value === true : observed.policy.supported && observed.policy.value === null)
          : field === 'block'
            ? flags.every(flag => observed.block.value?.[flag] === proposed.block)
            : observed.encryption.value?.includes('AES256');
        if (!valid) throw problem(502, 'Floci did not verify the requested ' + field + ' configuration.');
        changes.push(field);
        log('bucket-configuration-changed', 'success', { field, before: before[field].value, after: observed[field].value });
      };
      const setBlock = () => change('block', s3.PutPublicAccessBlockCommand, { ...input,
        PublicAccessBlockConfiguration: Object.fromEntries(flags.map(flag => [flag, proposed.block])) });
      if (proposed.policy === 'public') {
        await setBlock();
        await change('policy', s3.PutBucketPolicyCommand, { ...input, Policy: JSON.stringify({ Version: '2012-10-17',
          Statement: [{ Effect: 'Allow', Principal: '*', Action: 's3:GetObject', Resource: 'arn:aws:s3:::' + name + '/*' }] }) });
      } else {
        if (before.policy.value !== null) await change('policy', s3.DeleteBucketPolicyCommand, input, 'NoSuchBucketPolicy');
        await setBlock();
      }
      const warnings = [];
      if (proposed.encryption === 'AES256') {
        if (!before.encryption.supported) warnings.push('GetBucketEncryption is unsupported by this Floci emulator.');
        else if (!before.encryption.value?.includes('AES256')) {
          try {
            await change('encryption', s3.PutBucketEncryptionCommand, { ...input, ServerSideEncryptionConfiguration: {
              Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }]
            } });
          } catch (error) {
            if (error.status !== 501) throw error;
            warnings.push(error.message);
          }
        }
      }
      stage = 'verify-final';
      const after = await inspect(name);
      const policyMatches = after.policy.supported && after.policy.value === (proposed.policy === 'public' ? true : null);
      const blockMatches = flags.every(flag => after.block.value?.[flag] === proposed.block);
      const encryptionMatches = proposed.encryption === 'leave' || warnings.length > 0 ||
        after.encryption.value?.includes('AES256');
      if (!after.managed || !policyMatches || !blockMatches || !encryptionMatches) {
        throw problem(409, 'The final Floci state differs from the requested configuration. Refresh and try again.');
      }
      if (warnings.length) log('bucket-configuration-unsupported', 'unsupported', { warnings });
      return { operationId, name, before, after, changes, warnings };
    } catch (error) {
      log('bucket-operation-failed', 'failure', { stage, code: error.status || 500 });
      if (creating && stage !== 'verify-emulator') error.message += ' Lab bucket ID: ' + name;
      throw error;
    } finally {
      if (locked) store.unlockBucket(name, operationId);
    }
  }

  async function inspectVerified(name) {
    validateName(name);
    await verifyEmulator(probe);
    return inspect(name);
  }

  return { verify: () => verifyEmulator(probe), list, inspect: inspectVerified, mutate, close: () => sdk.destroy?.() };
}

module.exports = { endpoint, sourceEnvironment, openLab, verifyEmulator };
