const {
  S3Client,
  ListBucketsCommand,
  DeleteBucketPolicyCommand,
  PutPublicAccessBlockCommand,
  GetBucketPolicyStatusCommand,
  GetPublicAccessBlockCommand
} = require('@aws-sdk/client-s3');

const { createInterface } = require('node:readline/promises');

const endpoint = 'http://127.0.0.1:4566';
const bucket = process.env.DEMO_BUCKET;

const s3 = new S3Client({
  endpoint,
  region: 'us-east-1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: 'test',
    secretAccessKey: 'test'
  }
});

async function publicPolicyStatus() {
  try {
    const result = await s3.send(
      new GetBucketPolicyStatusCommand({ Bucket: bucket })
    );
    return result.PolicyStatus?.IsPublic === true;
  } catch (error) {
    if (['NoSuchBucketPolicy', 'NoSuchBucket'].includes(error.name)) {
      if (error.name === 'NoSuchBucket') throw error;
      return false;
    }
    throw error;
  }
}

async function main() {
  if (!/^cloudsentinel-[a-z0-9-]+$/.test(bucket || '')) {
    throw new Error('Set DEMO_BUCKET to an existing CloudSentinel demo bucket.');
  }

  const response = await fetch(endpoint + '/_floci/health', {
    signal: AbortSignal.timeout(3000)
  });
  const health = await response.json();

  if (!response.ok || health.original_edition !== 'floci-always-free') {
    throw new Error('Expected the local Floci emulator.');
  }

  const buckets = (await s3.send(new ListBucketsCommand({}))).Buckets || [];
  if (!buckets.some(b => b.Name === bucket)) {
    throw new Error('Bucket not found in Floci: ' + bucket);
  }

  console.log('Bucket:', bucket);
  console.log('Public policy before:', await publicPolicyStatus());

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  let confirmation;
  try {
    confirmation = await rl.question(
      'Type FIX to remove public policy and block public access: '
    );
  } finally {
    rl.close();
  }

  if (confirmation !== 'FIX') {
    console.log('Cancelled. No changes made.');
    return;
  }

  // Remove the public bucket policy.
  await s3.send(new DeleteBucketPolicyCommand({
    Bucket: bucket
  }));

  // Prevent future public ACLs and public policies.
  await s3.send(new PutPublicAccessBlockCommand({
    Bucket: bucket,
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      IgnorePublicAcls: true,
      BlockPublicPolicy: true,
      RestrictPublicBuckets: true
    }
  }));

  const publicPolicy = await publicPolicyStatus();

  const config = (await s3.send(
    new GetPublicAccessBlockCommand({ Bucket: bucket })
  )).PublicAccessBlockConfiguration;

  const blocked = [
    'BlockPublicAcls',
    'IgnorePublicAcls',
    'BlockPublicPolicy',
    'RestrictPublicBuckets'
  ].every(key => config?.[key] === true);

  console.log('\n=== VERIFICATION ===');
  console.log('Public bucket policy:', publicPolicy);
  console.log('All public access blocks enabled:', blocked);

  if (publicPolicy || !blocked) {
    throw new Error('Bucket privacy verification failed.');
  }

  console.log('\nSUCCESS: The Floci bucket is configured as private.');
  console.log('Return to CloudSentinel and run a new Floci scan.');
}

main().catch(error => {
  console.error('ERROR:', error.message);
  process.exitCode = 1;
});
