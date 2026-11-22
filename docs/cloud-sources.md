# Local cloud source setup

Keep source configuration on the machine that runs CloudSentinel. The application administrator runs scans in the UI. A trusted local operator edits the configuration and restarts the server. Use your operating system permissions to restrict who can modify the file, AWS profiles, and environment.

## AWS IAM Identity Center

1. Install AWS CLI v2. Ask your AWS administrator for authorized access to the intended account using the read-only permissions below.
2. In PowerShell run the setup wizard. Use your organization's SSO portal, AWS account, and read-only role when prompted.

   ```powershell
   aws configure sso --profile cloudsentinel-audit
   aws sso login --profile cloudsentinel-audit
   aws sts get-caller-identity --profile cloudsentinel-audit --region us-east-1
   ```

3. Copy [the source example](cloud-sources.example.json) into an ignored local file such as `data/cloud-sources.json`. Replace the example account ID and regions with the authorized scope. Add a separate, stable `id` and profile for each named account.
4. Set the configuration path locally and start the server.

   ```powershell
   $env:CLOUD_SOURCES_FILE = 'data/cloud-sources.json'
   npm start
   ```

5. Sign in as an application admin, choose the **LIVE** AWS source, and run a scan. For a scheduled source set `"schedule": true` and choose an appropriate `SCAN_INTERVAL_MS`. Live sources start in manual-only mode. **All environments** includes configured AWS sources in a manual run. Review the selected scope and your AWS pricing and budget before enabling live scanning. Read-only discovery can incur request, logging, or related service charges.

The SDK's Node credential provider chain supports SSO and shared profiles, temporary role credentials, and the environment's default chain. For a deployment using a temporary role or AWS-managed runtime identity, omit the source's `profile` field and configure the process credential chain normally. CloudSentinel verifies the account with STS before performing discovery and reuses that credential snapshot for the scan. It ignores configured service endpoint overrides for the live clients. Keep named profiles, role credentials, and any `credential_process` entries under local administrative control. Renew expired SSO with `aws sso login --profile cloudsentinel-audit`. [AWS SDK credential chain](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/setting-credentials-node.html) · [AWS CLI SSO setup](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html) · [STS GetCallerIdentity](https://docs.aws.amazon.com/STS/latest/APIReference/API_GetCallerIdentity.html)

## Least-privilege starting policy

Replace the sample account ID and regions. Narrow the bucket and IAM resource patterns to the approved scope when possible. Narrowing access to individually inspected resources can yield partial coverage. Organizational policies, permission boundaries, and bucket policies can further restrict these requests. `GetCallerIdentity` requires no IAM grant.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListAllMyBuckets", "iam:ListUsers", "iam:ListRoles"],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": ["ec2:DescribeInstances", "ec2:DescribeSecurityGroups"],
      "Resource": "*",
      "Condition": { "StringEquals": { "aws:RequestedRegion": ["us-east-1", "us-west-2"] } }
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetBucketPolicyStatus", "s3:GetEncryptionConfiguration"],
      "Resource": "arn:aws:s3:::*"
    },
    {
      "Effect": "Allow",
      "Action": ["iam:ListAttachedUserPolicies", "iam:GetLoginProfile", "iam:ListMFADevices"],
      "Resource": "arn:aws:iam::123456789012:user/*"
    },
    {
      "Effect": "Allow",
      "Action": "iam:ListAttachedRolePolicies",
      "Resource": "arn:aws:iam::123456789012:role/*"
    }
  ]
}
```

[S3 ListBuckets](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListBuckets.html) · [S3 GetBucketEncryption](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetBucketEncryption.html) · [IAM authorization reference](https://docs.aws.amazon.com/service-authorization/latest/reference/list_iam.html) · [EC2 DescribeInstances](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeInstances.html) · [EC2 DescribeSecurityGroups](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeSecurityGroups.html)

## Coverage and source states

- **FIXTURE** is simulated JSON. **EMULATOR** reads a loopback Floci service with dummy credentials. To add named emulator sources, use `"provider":"aws","kind":"emulator","endpoint":"http://127.0.0.1:4566"` in a source entry. The existing `FLOCI_ENDPOINT` setting is also supported.
- **LIVE AWS** covers one verified commercial AWS account per source. S3 lists general-purpose buckets in the selected regions and reads policy public status and default encryption configuration. IAM lists users and roles globally, reads direct managed policy attachments, and checks modeled MFA enrollment for console users. EC2 reads instances and owned security groups in the selected regions. The connector issues no resource mutations.
- AWS coverage excludes directory buckets, effective IAM authorization, inline/inherited policies, network reachability, and cloud event ingestion. Public policy and internet-wide security group ingress describe configuration observed by the corresponding AWS APIs. Default encryption configuration evidence does not determine whether a stored object is encrypted.
- **LIVE Azure and GCP** are separate connector entries with **NOT CONNECTED** status until their discovery adapters and authorized credential setup exist. The fixture sources remain independent.
- A partial AWS scan publishes verified observations and keeps earlier unverified findings open as **Last known**. It does not compute a posture score or advance the last complete-scan timestamp. An unsuccessful paginated operation discards that operation's incomplete listing. A failed scan retains its preceding snapshot. The global scan queue coalesces requests for each source and continues to the next source after an outcome.
- The AWS scan is bounded to 45 seconds overall, with an 8-second budget for each read or paginated operation. Larger scopes can show timeout warnings. Inventory and finding-lifecycle snapshots are in memory and reset on app restart.

CI uses mocked AWS SDK responses. Perform live verification only with authorized credentials and an approved account. Verify the account identity, compare scoped inventory to the AWS console, and review coverage warnings before relying on the result.
