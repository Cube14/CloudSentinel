# CloudSentinel

CloudSentinel is a locally hosted security operations console for comparing posture across simulated AWS, Azure, and GCP environments and a live local AWS Floci emulator. Its deterministic rules generate findings from collected configurations. The dashboard tracks scan health, inventory, findings and resolutions, severity, scan history, and fixture-event investigations.

## Start on Windows

From the repository directory in PowerShell, with Node.js 20 or later:

```powershell
npm ci
npm start
```

Open [the local console](http://127.0.0.1:3000/). If another process owns port 3000, set `$env:PORT = '3153'` before starting and open the address printed in the terminal. The three fixture environments work in an offline checkout with Node.js alone. The SDK installation is required for Floci and the full test suite.

| Setting | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Local HTTP port |
| `SCAN_INTERVAL_MS` | `15000` | Scheduled scan interval, minimum 1000 ms |
| `FLOCI_ENDPOINT` | Unset | Enable the additional AWS emulator source with an HTTP loopback URL |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Optional local investigation backend |
| `OLLAMA_MODEL` | `qwen3:8b` | Installed local model used for investigation suggestions |

The dashboard polls every two seconds. **Run Scan** requests an immediate scan for the selected environment or all configured environments. Requests for an already queued or running environment share its scan. Failures are visible and the last successful inventory remains available.

## Optional AWS Floci demo

Start Floci in a separate PowerShell terminal. The verified Docker setup uses Floci 2.5.0, publishes only to loopback, and uses the emulator's default in-memory storage.

```powershell
docker run --detach --name cloudsentinel-floci --publish 127.0.0.1:4566:4566 floci/floci:2.5.0
Invoke-RestMethod http://127.0.0.1:4566/_floci/health
```

In the CloudSentinel terminal:

```powershell
$env:FLOCI_ENDPOINT = 'http://localhost:4566'
npm run test:floci
npm run demo:floci
npm start
```

`test:floci` reads inventory. On a fresh emulator, a default security group and zero findings are expected. Run `demo:floci` against a dedicated disposable emulator. It creates uniquely named empty S3 buckets, security groups and IAM users and checks the collector against six safe and insecure configurations. Each invocation adds resources to that emulator. Select **AWS Floci emulator** in the console. The application scanner uses only dummy credentials and read APIs. [Floci installation](https://floci.io/floci/getting-started/installation/)

## Demo walkthrough

1. Select each fixture environment and compare its inventory and findings.
2. On the AWS fixture, find **Public storage access** for `customer-data`. Change its `public` value to `false` in `fixtures/aws.json` and save. Wait for the scheduled scan and dashboard poll, or click **Run Scan**. Find the same issue under **Resolved findings**. Restore the value to `true` and rescan to show it reopening.
3. Switch to AWS Floci, if enabled, to see findings from emulator API responses. View the scan timeline and last successful timestamp.
4. Return to the AWS fixture and open **Threat Detection**. Replay the fixture event scenario and inspect the event evidence and attack stages. Launch an investigation. Ollama supplies optional hypotheses and verification steps when reachable. The app can show a deterministic fallback.
5. Approve a simulated response and view the audit record.
6. Run the test suite and benchmark to show reproducible project evidence.

```powershell
npm test
npm run benchmark
```

## API

Read routes accept an optional `?environment=aws-lab`, `azure-lab`, `gcp-lab`, or `aws-floci` when configured. Omitting the parameter selects all sources.

| Method | Route | Result |
| --- | --- | --- |
| GET | `/api/health`, `/api/environments` | Service health and source scan status |
| GET | `/api/dashboard`, `/api/dashboard/summary` | Scoped dashboard snapshot or summary |
| GET | `/api/assets`, `/api/findings`, `/api/findings/resolved`, `/api/iam` | Last successful inventory and posture results |
| GET | `/api/scans/latest` | Latest scan results by source |
| POST | `/api/scans/run` | Scan the selected scope. Returns 503 with per-source details if a scan fails |
| GET | `/api/events`, `/api/incidents`, `/api/audit` | Fixture and manually submitted event evidence, incidents, and simulated responses |
| POST | `/api/events`, `/api/simulations/run` | Add a lab event or reset event history to the fixture scenario |
| POST | `/api/incidents/:id/investigate`, `/api/incidents/:id/respond` | Optional investigation or simulated response audit entry |

See [implementation status](docs/IMPLEMENTATION_STATUS.md), [architecture](docs/architecture.md), [benchmark and comparison protocol](docs/experiments.md), and [security limitations](docs/limitations.md).
