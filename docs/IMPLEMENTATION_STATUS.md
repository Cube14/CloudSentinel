# Implementation status

Verified November 22, 2026, on Windows 11 with Node.js 24.14.1 and npm 11.11.0. The checkout started clean on `main`, tracking `origin/main` at `https://github.com/Cube14/CloudSentinel.git`.

## Completed components

| Priority | Delivered |
| --- | --- |
| P0 | Verified PowerShell startup, added a clear occupied-port error, preserved the original test suite and locked SDK dependencies. |
| P1–P2 | Environment-scoped API and dashboard for AWS, Azure and GCP fixtures and an opt-in read-only AWS Floci source. Documented and checked S3, IAM and EC2 operation support. |
| P3 | Configurable periodic scanning, manual scan requests, one shared queue, duplicate request coalescing, last-success tracking, and two-second dashboard polling. |
| P4 | Stable source-scoped finding IDs, deduplication, evidence, severity, first-detected and last-seen times, and resolve/reopen behavior. |
| P5 | Source selector, scan and failure status, inventory, open and resolved findings, severity chart, scan timeline, incident stages, investigation and simulated-response audit. |
| P6 | Validated optional loopback Qwen3 investigation through Ollama. Recorded observations come from the event engine and model output is limited to suggestions. |
| P7–P9 | Added integration and wire-contract cases, a seeded emulator validation, a repeatable benchmark, Windows and Ubuntu CI configuration, and demo and limitation documentation. |

## Tests executed and results

| Check | Result |
| --- | --- |
| Baseline `npm test` | 8 passed, 0 failed. |
| Baseline `npm run benchmark` | 8 cases with TP 4, TN 4, FP 0 and FN 0. |
| Updated `npm test` | 16 passed, 0 failed. Includes source isolation, rescans, failure recovery, schedule, queue, SDK wire parsing and AI fallback. |
| Updated `npm run benchmark` | 21/21 exact scenario matches across all 12 posture rules. TP 16, TN 31, FP 0 and FN 0. Median engine batch 0.058 ms and p95 0.209 ms. One scheduled change appeared on the findings API in 1002.021 ms with a one-second scan interval. |
| `npm run test:floci` and `npm run demo:floci` | Actual Floci 2.5.0 on Docker Desktop. The initial default inventory had one security group and zero findings. After seeding, all six expected asset outcomes matched across S3, IAM, and security groups. |
| Windows `npm start` and Microsoft Edge | Verified alternate-port PowerShell startup, isolated port-3000 conflict handling, environment selection, scheduled refresh, Run Scan, and the incident timeline. |
| Ollama | Actual `qwen3:8b` investigation returned validated suggestions and four observations from the fixture incident. Invalid-model-output fallback was covered separately by an HTTP test double. |

Floci and Ollama were initially unavailable. The SDK was verified independently with a local HTTP test double, then the emulator and installed model were tested directly. The test double result and live results are separate evidence.

## Features still simulated

- AWS, Azure and GCP fixture inventories and the replayed threat scenario.
- Simulated response actions and approvals. The collector issues no infrastructure changes. The separate Floci demo command creates disposable test resources.
- Floci is an emulated AWS control plane. Its API responses represent local emulator state.

## Blocked external integrations

- Prowler and Checkov were unavailable on the local PATH and were not run. A source-based check mapping is documented. Comparative measurements remain pending.
- The GitHub Actions workflow is updated locally. A hosted run awaits an authorized repository update.

## Known limitations

- Scope excludes production or real cloud accounts, Azure/GCP live connectors, and cloud event subscriptions.
- Floci evidence covers a bounded set of operations in one region. The seeded live demo validated security groups but did not launch instances. Instance normalization was tested against an AWS-shaped wire response.
- Failed scans retain the previous successful snapshot. State, histories and audit records reset on restart. See [security limitations](limitations.md) for coverage and trust boundaries.
- The project uses the existing checkout. Port 3000 is occupied on this workstation, so the demo verification uses port 3153.

## Next highest-priority task

Run a pinned Prowler and Checkov comparison using the paired TCP/22 cases in [the benchmark protocol](experiments.md). Record supported checks, skipped cases, and actual outputs before making comparative claims.
