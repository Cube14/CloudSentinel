# CloudSentinel professor demonstration

Demo scope is local Floci 2.5.0. Use only empty, disposable buckets generated in the S3 Lab. The browser does not accept an AWS endpoint, an arbitrary policy or an AWS command.

## Prepare the workspace

Start the pinned emulator only if nothing is already using port 4566. The host port must bind to loopback. The Docker command creates an isolated local emulator with ephemeral cloud state.

```powershell
docker ps --format '{{.Names}} {{.Ports}}'
docker run -d --name cloudsentinel-floci -p 127.0.0.1:4566:4566 floci/floci:2.5.0
Invoke-RestMethod http://127.0.0.1:4566/_floci/info | Select-Object emulator,cloud,version
```

From the repository root in PowerShell, use a fresh SQLite file for the session. Skip admin setup when reusing an already initialized demo database.

```powershell
$env:FLOCI_ENDPOINT = 'http://127.0.0.1:4566'
$env:FLOCI_LAB_ENABLED = '1'
$env:AUTH_DB_PATH = 'data/professor-demo.sqlite'
$env:SCAN_INTERVAL_MS = '600000'
$env:PORT = '3153'
npm ci
npm run build
npm run setup:admin -- demo-admin@example.test
npm start
```

Open `http://127.0.0.1:3153`. Use the printed address if you selected another port. For a second device, start the existing Caddy LAN profile from a shell with the same Floci and database variables, and follow the private subnet and certificate setup. Wait for the initial scan to complete before starting the live sequence. [Windows LAN HTTPS guide](lan-deployment.md)

## Demonstrate the finding

1. Try an incorrect password for the demo account and then sign in successfully. Open **Audit**, choose **Security audit**, and search for the account. Show the attempt and its outcome. Signup takes a separate sign-in step and returns the same public response for new and existing addresses.
2. Open **Environments → Floci S3 Lab** or browse to `/workspace/floci-s3` as an admin. Select **Public-policy demo bucket**, enter the prefix `professor`, type it again to confirm, and create the bucket. Copy the generated exact bucket name. The inspection shows the policy as public and the bucket-level blocks as off.
3. Select **Run complete scan**. Read the S3-001 finding or follow its timeline link. Show the open finding, its stable ID, the observed policy status and the recommendation. If a scheduled scan already found the policy, the original timestamp remains visible.
4. Select **Secure private bucket**, type the full bucket name, and select **Remediate bucket**. Show the before and after configuration. Refresh to read it again from Floci. The secure template removes the policy, enables all four bucket-level blocks, and requests explicit AES256 if supported.
5. Select **Run complete scan** again. The same S3-001 ID becomes **RESOLVED**. Its evidence shows what the complete scan observed. Use **View bucket timeline**, **View finding timeline**, or the operation ID link to inspect and export the matching audit events. Scan-start and scan-completion events can be retrieved by the operation ID on a finding event.
6. To demonstrate a restart, keep the emulator and demo SQLite file running/on disk, stop Node with Ctrl+C, and run `npm start` again in the same shell. Sign in or reload the workspace and open the bucket timeline and resolved finding.

## Demonstrate terminal remediation

Use a second terminal with the same environment variables and SQLite file. Commands that change a bucket prompt for its exact name. Replace `<bucket>` with the generated ID.

```powershell
npm run lab:s3 -- list
npm run lab:s3 -- inspect <bucket>
npm run lab:s3 -- public <bucket>
npm run lab:s3 -- inspect <bucket>
```

Rescan in the website and show **REOPENED** in Audit. Then run the secure command and inspect the final SDK response.

```powershell
npm run lab:s3 -- secure <bucket>
npm run lab:s3 -- inspect <bucket>
```

Rescan and show the finding as resolved again. Terminal commands identify their channel and leave the account blank. Finding observations also leave the account blank, while the corresponding scan request can identify its authenticated initiator. An SDK change made outside CloudSentinel is reflected in later scan observations without an inferred actor.

For an optional local EC2 posture check, run `npm run lab:ssh` and type `DEMO SSH`. It uses a detached temporary security group, prints the CSPM-004 finding observed by the collector, and removes the group.

## Evidence and limits

- Capture actual scan times and the details drawer. The dashboard uses local time for readability and the drawer and CSV retain UTC timestamps.
- A failed or partial scan preserves previously open findings. A verified bucket policy change and a finding resolution are separate records.
- The evidence records Floci's classification of the bucket policy and the explicit bucket encryption setting it reports. New Amazon S3 uploads receive default SSE-S3. [Amazon S3 default encryption](https://docs.aws.amazon.com/AmazonS3/latest/userguide/default-bucket-encryption.html)
- Only Floci 2.5.0 on the fixed loopback endpoint is enabled for writes. Replacing the emulator loses ephemeral bucket state unless its configuration provides persistence. SQLite findings and audit remain on disk.
- Google OAuth audit is exercised with a mocked OIDC provider in automated tests. For a real Google demonstration, configure an approved OAuth client and matching redirect for the browser origin.
- For an automated local run, set `FLOCI_LIVE_TEST=1` and run `node --test tests/floci-lab.test.js`. The workflow leaves a uniquely named empty bucket with a verified secure final configuration. Its test database is temporary.
