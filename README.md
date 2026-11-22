# CloudSentinel

CloudSentinel is a locally hosted security operations console for comparing posture across simulated AWS, Azure, and GCP environments and a live local AWS Floci emulator. Its deterministic rules generate findings from collected configurations. The React dashboard tracks scan health, inventory, findings and resolutions, severity, scan history, and fixture-event investigations.

## Start on Windows

From the repository directory in PowerShell with Node.js 22.13 or newer:

```powershell
npm ci
npm run build
$env:PORT = '3153'
npm start
```

Open [the local console](http://127.0.0.1:3153/). The three fixture environments work offline after the dependency install and build. Floci and Ollama are optional.

Sign up in the UI for a **viewer** account. To enable manual scans, incident investigations, fixture replay, and simulated responses, provision a separate **admin** account in PowerShell:

```powershell
npm run setup:admin -- admin@example.com
```

Enter a password of at least 15 characters at the hidden prompt, confirm it, and sign in with that account. Use a fresh email address. The setup command refuses to change an existing account. The server uses the signed-in admin’s email for simulated response approvals.

Copy `.env.example` to an ignored `.env` to save settings locally. The server and admin setup command share `AUTH_DB_PATH`.

| Setting | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Local HTTP port |
| `SCAN_INTERVAL_MS` | `15000` | Scheduled scan interval, minimum 1000 ms |
| `FLOCI_ENDPOINT` | Unset | Enable the additional AWS emulator source with an HTTP loopback URL |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Optional local investigation backend |
| `OLLAMA_MODEL` | `qwen3:8b` | Installed local model used for investigation suggestions |
| `AUTH_DB_PATH` | `data/cloudsentinel.sqlite` | SQLite identities, sessions, rate limits, and audit records |
| `AUTH_SESSION_TTL_SECONDS` | `28800` | Absolute session lifetime |
| `CLIENT_DEV_ORIGIN` | Unset | Explicit loopback Vite origin for proxy development |

The dashboard polls every two seconds. **Run scan** requests an immediate scan for the selected environment or all configured environments. Requests for an already queued or running environment share its scan. Failures are visible and the last successful inventory remains available.

For Vite hot reload, set `CLIENT_DEV_ORIGIN=http://127.0.0.1:5173` in the backend environment, start the backend, run `npm run dev:client` in another terminal, and use the Vite URL. Vite reads the backend `PORT` from the shell or root `.env`. Authenticate against the built client for Google sign-in.

## Optional Google sign-in

Create a Google OAuth client of type **Web application**, configure its consent screen and test users as applicable, and register the exact local redirect URI, for example `http://localhost:3153/api/auth/google/callback`. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` in the ignored `.env`. Restart the server and open the matching origin, `http://localhost:3153` in this example. The Google button appears when all three settings are present. Google accounts must provide a verified email and start as viewers. Email/password accounts and Google accounts use distinct identities, so an existing email cannot be claimed through Google. [Google OpenID Connect configuration](https://developers.google.com/identity/openid-connect/openid-connect)

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

1. Sign in as an admin, select each fixture environment, and compare its inventory and findings.
2. On the AWS fixture, find **Public storage access** for `customer-data`. Change its `public` value to `false` in `fixtures/aws.json` and save. Wait for the scheduled scan and dashboard poll, or click **Run Scan**. Find the same issue under **Resolved findings**. Restore the value to `true` and rescan to show it reopening.
3. Switch to AWS Floci, if enabled, to see findings from emulator API responses. View the scan timeline and last successful timestamp.
4. Return to the AWS fixture and open **Threat Detection**. Replay the fixture event scenario and inspect the event evidence and attack stages. Launch an investigation. Ollama supplies optional hypotheses and verification steps when reachable. The app can show a deterministic fallback.
5. Approve a simulated response and view the audit record.
6. Run the test suite and benchmark to show reproducible project evidence.

```powershell
npm test
npm run benchmark
npm run build
```

## API

`/api/health` is public. `GET /api/auth/session` returns session state and a CSRF token. Signup, login, logout, and Google start accept POST requests with `X-CSRF-Token`. Signup and login take JSON credentials. Google returns to `GET /api/auth/google/callback`. Non-browser clients must keep the session cookies and use the current CSRF token. The console APIs require sign-in and monitoring POSTs require an admin plus CSRF. `GET /api/auth/audit` is admin-only.

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

The React interface uses locally packaged Manrope, Space Grotesk, and Instrument Serif under the SIL Open Font License. License notices ship in the [client assets](client/public/assets/). The network illustration is original SVG.
