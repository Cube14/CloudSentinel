# AWS EC2 deployment readiness

The application has a Linux service profile and a DNS-based Caddy configuration. EC2 provisioning, public reachability, ACME issuance, and live AWS discovery require validation in an approved deployment.

| Mode | What runs on the host | AWS permissions |
| --- | --- | --- |
| A. Hosted emulator demo | CloudSentinel, Caddy, loopback Floci 2.5.0 and fixture collectors | No AWS discovery role. Enable the S3 Lab only for the private emulator. |
| B. Read-only AWS discovery | CloudSentinel, Caddy and a scoped AWS connector | An EC2 instance profile with read-only discovery permissions. Disable the S3 Lab if the emulator is unnecessary. |

## Host and build

Use an Ubuntu 24.04 LTS AMI and a supported Node.js 24 LTS runtime installed at `/usr/bin/node` for the supplied unit. Install Caddy from its official package and Docker only for Mode A. Start with 2 vCPUs, 4 GiB RAM and roughly 25–30 GiB of encrypted gp3 as an initial demo sizing hypothesis. Benchmark on the selected instance type with your inventory size and user load. Optional Ollama has separate model, CPU and memory requirements. Build on a CI host or on the instance with `npm ci`, `npm test`, and `npm run build`. Put the built checkout under `/opt/cloudsentinel` and keep it read-only to the service user. [Caddy Linux packages](https://caddyserver.com/docs/install)

Create the unprivileged `cloudsentinel` system account. Mount encrypted persistent EBS at `/var/lib/cloudsentinel`, owned by that account with mode 0700. Install [the systemd unit](../deploy/ec2/cloudsentinel.service) as `/etc/systemd/system/cloudsentinel.service`. The configured mount should survive reboot and the data volume should be retained on instance replacement. Supply a root-controlled `/etc/cloudsentinel/cloudsentinel.env` with mode 0600 using the following settings as a template.

```dotenv
PORT=3153
AUTH_DB_PATH=/var/lib/cloudsentinel/cloudsentinel.sqlite
AUTH_SESSION_TTL_SECONDS=28800
SCAN_INTERVAL_MS=60000
LAN_PROXY=1
LAN_HTTPS_ORIGIN=https://sentinel.example.org
LAN_PROXY_TOKEN=REPLACE_WITH_32_RANDOM_BYTES_AS_LOWERCASE_HEX
FLOCI_LAB_ENABLED=0
```

Replace the hostname with the exact approved canonical HTTPS host. Generate the shared proxy token with `openssl rand -hex 32` and put it in the Node and Caddy environment files without printing or committing it. For Mode A add `FLOCI_ENDPOINT=http://127.0.0.1:4566` and optionally set `FLOCI_LAB_ENABLED=1`. Use `CLOUD_SOURCES_FILE=/etc/cloudsentinel/cloud-sources.json` for Mode B. For Google OAuth on HTTPS use `LAN_GOOGLE_CLIENT_ID`, `LAN_GOOGLE_CLIENT_SECRET`, and `LAN_GOOGLE_REDIRECT_URI=https://sentinel.example.org/api/auth/google/callback`. Restrict configuration and backups to authorized operators.

Provision the first admin under the service account with the same absolute database path. For example, from the deployed app directory use `sudo -u cloudsentinel env AUTH_DB_PATH=/var/lib/cloudsentinel/cloudsentinel.sqlite /usr/bin/node server/setup-admin.js admin@example.org`. Systemd manages restart and logs with `systemctl` and `journalctl`. Node binds only to `127.0.0.1:3153`. For Mode A, run the pinned container with restart policy and a loopback port mapping. Keep its AWS-shaped endpoint private and configure emulator persistence separately if the demo requires bucket state after container replacement.

```bash
docker run -d --restart unless-stopped --name cloudsentinel-floci \
  -p 127.0.0.1:4566:4566 floci/floci:2.5.0
curl -fsS http://127.0.0.1:4566/_floci/info
```

## DNS and network

After approval for the chosen access model, point an owned DNS name at the deployment and install [the EC2 Caddyfile](../deploy/ec2/Caddyfile) as `/etc/caddy/Caddyfile`. Set `CS_PUBLIC_HOST=sentinel.example.org` and the shared `LAN_PROXY_TOKEN` in a root-owned `/etc/cloudsentinel/proxy.env`. Add a Caddy systemd drop-in with `[Service]` and `EnvironmentFile=/etc/cloudsentinel/proxy.env`. Validate Caddy with its service environment, reload systemd, and start the services after the hostname and network policy are ready. The default Caddy profile uses public ACME validation and redirects HTTP to HTTPS. For a private deployment, keep application ingress restricted to a VPN or approved CIDRs and arrange DNS validation or a private PKI before starting Caddy. DNS validation with public certificates requires configuring a DNS provider module under operator control. [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https)

- Allow inbound TCP 443 only from the intended audience under the approved exposure model. Public ACME validation may require public reachability on TCP 80 or 443. Scope IPv6 rules as well if an AAAA record is used.
- Prefer Session Manager or private administration. When SSH is required, restrict TCP 22 to the approved administration network.
- Keep TCP 3153, 4566, 11434, and Caddy administration ports off the instance ingress list. Restrict outbound access consistent with DNS, ACME, authorized AWS APIs, and maintenance.
- The supplied Caddyfile is for a directly connected reverse proxy. Reassess client-IP handling and trusted proxies before adding a CDN or load balancer. [Caddy reverse proxy headers](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)

## Read-only AWS discovery

Attach a dedicated least-privilege instance profile and require IMDSv2. Omit the source `profile` field so the Node SDK can obtain temporary role credentials. Do not set static AWS keys in the service. Configure the approved account ID and regions. The connector verifies its account through STS before scanning the permitted S3, IAM and EC2 metadata. Use the repository's read-only action list as the starting point and set `schedule` to false until scope and usage are verified. CloudSentinel uses no real-AWS write permissions for scans or remediation. [Read-only connector configuration and policy](cloud-sources.md) · [IAM roles for EC2](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/iam-roles-for-amazon-ec2.html)

## Operations and cost

- Use SQLite's online backup API or `sqlite3` with `.backup` to create a consistent backup. Keep backups encrypted and access-controlled, schedule snapshots, and restore-test to an isolated system. Keep the database, environment files and Caddy storage on appropriate persistent volumes. The SQLite WAL and shared-memory files must be managed by SQLite in the same filesystem directory. [EBS snapshots](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-snapshots.html)
- Run one Node service per database. Monitor disk, audit growth, failed or partial scans, and backup age. Scheduled scans append lifecycle records. Agree a retention and archival policy before long-running production use. The dashboard displays account identifiers, client IP metadata, and audit evidence to administrators.
- Model EC2 hours, EBS capacity, snapshots, DNS, public IPv4, outbound traffic and optional logging and backup fees. Use the actual region and expected runtime in the AWS calculator. Enable a budget alert before provisioning. [EC2 On-Demand Pricing](https://aws.amazon.com/ec2/pricing/on-demand/) · [AWS Pricing Calculator](https://calculator.aws/)
- Before approved exposure, review audience and signup policy, restrict access at the network boundary if open registration is unsuitable, verify role and CSRF behavior, test certificate renewal and restore, and validate that the Floci port is unreachable remotely. The prepared profile is for a single evaluation host and has not been exercised on EC2.
