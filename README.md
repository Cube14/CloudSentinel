# CloudSentinel

**AI-Assisted Multi-Cloud Security Operations — Academic MVP**

A zero-subscription, locally hosted security assessment dashboard with deterministic AWS/Azure/GCP **simulated** cloud inventory, posture checks, IAM checks, suspicious-event correlation, optional local Ollama investigation, and approved simulated response logging.

> **Scope:** This version scans **local JSON fixtures**, not live cloud accounts. It does **not** attest to production security. The simulated configurations are intentionally vulnerable. The dashboard labels this clearly.

## Zero-install-dependency quick start

Requirements: Node.js 20 or higher. No npm dependencies, MongoDB, Python, Docker, or cloud account required for the primary demo.

```powershell
cd cloudsentinel
npm start
```

Open **http://127.0.0.1:3000** in your browser. Start with the dashboard, open **Findings**, **IAM Analyzer**, and **Threat Detection**, then click **Investigate with local AI**.

To run validations:

```powershell
npm test
npm run benchmark
```

The local model is optional. If Ollama is already installed and Qwen3 8B is available, start Ollama separately. Override its model identifier via `OLLAMA_MODEL` if necessary. Default: `qwen3:8b`; endpoint: `http://127.0.0.1:11434`. The app falls back to a visibly labeled rule-based report if model access fails. No AI analysis is used to determine whether a security rule fired.

## Demo walkthrough

1. Run `npm start` and open the console.
2. Observe the provider counts and findings.
3. Click **Findings** and inspect the public AWS `customer-data` bucket.
4. Open `fixtures/aws.json`, change `"public":true` to `"public":false` for that bucket, save, then click **Run Scan**. Confirm `CSPM-001` disappears. Restore the vulnerable setting for further demonstrations.
5. Open **IAM Analyzer** for wildcard permissions/MFA warnings.
6. Open **Threat Detection**. The local scenario shows access-key creation → role policy attachment → bucket listing → sensitive object access.
7. Click **Investigate with local AI**. Observe either the Ollama result or explicitly labeled fallback.
8. Approve a simulated response, then inspect **Audit Trail**. No real cloud actions occur.
9. Run `npm test` and `npm run benchmark` in a terminal and show results.

## API

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/dashboard/summary` | Summary and per-provider statistics |
| GET | `/api/assets` | Normalized simulated inventory |
| GET | `/api/findings` | Deterministic CSPM findings |
| GET | `/api/scans/latest` | Scans by provider |
| POST | `/api/scans/run` | Re-read fixture files and rescan |
| GET | `/api/iam` | IAM-specific findings |
| GET / POST | `/api/events` | Inspect or ingest normalized events |
| GET | `/api/incidents` | Derived incidents |
| POST | `/api/simulations/run` | Replay controlled synthetic event scenario |
| POST | `/api/incidents/:id/investigate` | Ask Ollama for structured analysis |
| POST | `/api/incidents/:id/respond` | Record explicitly approved simulated action |
| GET | `/api/audit` | Read in-memory response history |

### Example event ingestion

```powershell
$body = @{ actor='tester'; action='CreateAccessKey'; provider='aws'; timestamp='2026-11-22T10:00:00Z'; resource='tester'; environment='aws-lab' } | ConvertTo-Json
Invoke-RestMethod -Uri http://127.0.0.1:3000/api/events -Method POST -ContentType 'application/json' -Body $body
```

## Structure

- `public/`: static web frontend (deliberately framework-free for instant zero-dependency startup)
- `server/`: Node.js HTTP API and Ollama adapter
- `security-engine/`: posture and threat rules
- `fixtures/`: three synthetic cloud inventories and events
- `tests/`: Node built-in test runner and measured synthetic benchmark
- `docs/`: architecture, test methodology, limitations, comparative analysis
- `.github/workflows/test.yml`: GitHub Actions validation

## Automatic refresh

The backend re-evaluates fixture files every **15 seconds**; the dashboard polls the API every **15 seconds**. This is periodic polling, **not push-based live event streaming**. Event ingestion triggers threat detection immediately, but incidents exist in memory until the service is restarted.

## Git/GitHub on Windows

Extract to a drive with enough space, e.g. `E:\Projects\cloudsentinel`, then use PowerShell:

```powershell
cd E:\Projects\cloudsentinel
git init
git add .
git commit -m "feat: build CloudSentinel multi-cloud security MVP"
git branch -M main
```

Create an empty repository called `CloudSentinel` in your GitHub account **without generating an initial README**, then:

```powershell
git remote add origin https://github.com/YOUR_USERNAME/CloudSentinel.git
git push -u origin main
```

Replace `YOUR_USERNAME` with your actual GitHub username. The project does not require publishing secrets or real cloud credentials. GitHub Actions runs the tests on each push.

## Key limitations

No live cloud connectors, no Floci SDK connector, no database persistence, no user login/RBAC, no externally exposed deployment, and no independently executed Prowler/Checkov comparison. These are possible follow-on engineering milestones rather than represented as complete. Do not expose this server to the public internet; it is bound to localhost for safety.

See `docs/experiments.md`, `docs/architecture.md`, and `docs/limitations.md`.
