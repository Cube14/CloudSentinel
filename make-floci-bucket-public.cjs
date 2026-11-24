const {
  S3Client,
  PutPublicAccessBlockCommand,
  PutBucketPolicyCommand,
  GetBucketPolicyStatusCommand
} = require('@aws-sdk/client-s3');

const bucket = 'cloudsentinel-bf13133aea-no-default-encryption';

const s3 = new S3Client({
  endpoint: 'http://127.0.0.1:4566',
  region: 'us-east-1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: 'test',
    secretAccessKey: 'test'
  }
});

async function main() {
  await s3.send(new PutPublicAccessBlockCommand({
    Bucket: bucket,
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      IgnorePublicAcls: true,
      BlockPublicPolicy: false,
      RestrictPublicBuckets: false
    }
  }));

  await s3.send(new PutBucketPolicyCommand({
    Bucket: bucket,
    Policy: JSON.stringify({
      Version: '2012-10-17',
      Statement: [{
        Effect: 'Allow',
        Principal: '*',
        Action: 's3:GetObject',
        Resource: `arn:aws:s3:::${bucket}/*`
      }]
    })
  }));

  const result = await s3.send(
    new GetBucketPolicyStatusCommand({ Bucket: bucket })
  );

  console.log('Bucket:', bucket);
  console.log('Public policy:', result.PolicyStatus?.IsPublic);

  if (result.PolicyStatus?.IsPublic !== true) {
    throw new Error('Public policy status not confirmed');
  }
}

main().catch(e => {
  console.error(e);
  process.exitCode = 1;
});

