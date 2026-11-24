const { randomBytes } = require('node:crypto');
const {
  S3Client,
  CreateBucketCommand,
  PutBucketEncryptionCommand,
  GetBucketEncryptionCommand,
  DeleteBucketEncryptionCommand
} = require('@aws-sdk/client-s3');

const s3 = new S3Client({
  endpoint: 'http://127.0.0.1:4566',
  region: 'us-east-1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: 'test',
    secretAccessKey: 'test'
  }
});

const suffix = randomBytes(5).toString('hex');
const encrypted = `cloudsentinel-${suffix}-encrypted`;
const unconfigured = `cloudsentinel-${suffix}-no-default-encryption`;

const missing = error =>
  /ServerSideEncryptionConfigurationNotFoundError|NoSuchBucketEncryption/.test(error.name || '');

async function main() {
  // Create exactly two new uniquely named buckets.
  for (const name of [encrypted, unconfigured]) {
    await s3.send(new CreateBucketCommand({ Bucket: name }));
    console.log('Created:', name);
  }

  // Enable explicit AES-256 encryption on the first bucket.
  await s3.send(new PutBucketEncryptionCommand({
    Bucket: encrypted,
    ServerSideEncryptionConfiguration: {
      Rules: [{
        ApplyServerSideEncryptionByDefault: {
          SSEAlgorithm: 'AES256'
        }
      }]
    }
  }));

  // Ensure the second bucket has no explicit default setting.
  try {
    await s3.send(new GetBucketEncryptionCommand({
      Bucket: unconfigured
    }));
    await s3.send(new DeleteBucketEncryptionCommand({
      Bucket: unconfigured
    }));
  } catch (error) {
    if (!missing(error)) throw error;
  }

  // Verify the first bucket.
  const result = await s3.send(new GetBucketEncryptionCommand({
    Bucket: encrypted
  }));

  const algorithm = result.ServerSideEncryptionConfiguration
    ?.Rules?.[0]?.ApplyServerSideEncryptionByDefault?.SSEAlgorithm;

  if (algorithm !== 'AES256') {
    throw new Error('Encrypted bucket verification failed');
  }

  // Verify the second bucket.
  let absent = false;
  try {
    await s3.send(new GetBucketEncryptionCommand({
      Bucket: unconfigured
    }));
  } catch (error) {
    if (!missing(error)) throw error;
    absent = true;
  }

  if (!absent) {
    throw new Error('Second bucket still reports encryption configuration');
  }

  console.log('\n=== VERIFIED FLOCI BUCKETS ===');
  console.table([
    { Bucket: encrypted, Encryption: 'AES256 configured' },
    { Bucket: unconfigured, Encryption: 'No explicit configuration' }
  ]);

  console.log('\nSelect AWS Floci emulator and click Run Scan.');
}

main().catch(error => {
  console.error('ERROR:', error.message);
  process.exitCode = 1;
});
