# Implementation status

## Spatial Cloud Atlas

The authenticated Overview puts the API-backed atlas first, with fullscreen, selectable inventory, a keyboard resource picker, a posture HUD, and the existing tables in an operations ledger. Scope changes stage the outgoing camera while the selected snapshot loads. GSAP coordinates camera movement, shader accents, manual scan cues, and incident reveals. Motion remains available for small UI transitions. The effects switch and OS reduced-motion preference disable cinematic cues. Mobile defaults to the selectable 2D map, and WebGL context loss falls back to that map.

The models, overlays, and lighting are procedural. The scene renders on demand, caps the Overview at 48 visible resources and lens buffer at 960 pixels on its long edge, and pauses offscreen. Scan effects follow deliberate requests and confirmed dashboard results. Scheduled scans update the status without replaying the lens or wave. Evidence-heavy routes use short decorative reveals and retain the existing data and APIs.

The four targeted tests and all 32 tests passed. The production build passed with an existing size warning for the lazy WebGL bundle, now 254 kB gzip. Edge captured Overview and Topology at 390, 768, 1440, and 1920 CSS pixels using an isolated fixture, including a long resource name and multiple findings. The browser verified native fullscreen, pointer lock-on and mesh selection, scan status during a delayed refresh, keyboard evidence, and forced WebGL context loss. The investigation used local Ollama. On the RTX 4060 Laptop GPU the measured scene made zero draw calls at rest, offscreen, and through a scheduled scan. Reduced motion skipped the lens framebuffer. The full captures are in `results/atlas-qa/`.

## Cloud topology

Verified November 23, 2026. Authenticated Overview and Topology share a procedural 3D scene drawn from inventory and finding snapshots. Compute racks, storage stacks, identity crystals, and network shields use instanced geometry. Inventory stays grouped by provider, environment, and type. Lines represent collected same-source, same-region security group attachments or ingress references.

Manual scan requests trigger a short visual sweep over existing inventory. Overview adds a one-time camera and title entrance and a 310 ms scene-only impact pass on manual scans. Scheduled scans update API status without a sweep. The manual request indicator stays visible until the post-scan dashboard refresh settles. One shared shader animates decorative accents in navigation, findings, and evidence panels. Incident evidence has previous and next controls that preserve original event order and recorded fields.

The scene loads separately, draws on demand, and pauses offscreen or in hidden tabs. The preceding Cloud Atlas section lists the current Overview node cap. Topology displays up to 320 nodes and 640 recorded references, with the full index available in its searchable list. DPR is capped at 1.35 on desktop and 1 on mobile or dense scenes. Narrow screens default to the SVG map or list, and both views fall back to those controls after context loss. Reduced motion disables the sweep and camera easing.

- Targeted tests passed 4 of 4. Full `npm test` passed 32 of 32. The synthetic benchmark matched 21 of 21 scenarios across all 12 posture rules.
- `npm run build` passed with Vite's size warning on the lazy scene chunk, approximately 252 kB gzip.
- Authenticated Edge 158 on the RTX 4060 Laptop GPU exercised mesh picking, real Floci inventory, scan requests, incident navigation, keyboard evidence, and forced WebGL context loss in both views. No JavaScript, console, or CSP errors in the passing smoke. Reviewed 390, 1440, and 1920 CSS-pixel screenshots and improved mobile risk markers and Overview warning placement. Mobile sizes were emulated. The browser smoke used fixture and local emulator data.

The visual QA pass used an isolated fixture with a 245-character resource name, three actual scanner findings for that resource, and a scrollable index. Both views were checked in Edge at 390, 768, 1440, and 1920 CSS pixels. The selected resource now has its own Overview grid row. The Topology details control and finding count stay outside the scrollable evidence area, and the index has its own scroll region. Edge confirmed the request state persisted during a delayed dashboard response. Forced WebGL loss fell back in both views. On the RTX 4060 Laptop GPU the settled scene issued zero draw calls while idle and through a scheduled scan. Reduced motion skipped the impact render pass. The four targeted tests, all 32 tests, and the production build passed. The lazy scene chunk is 253 kB gzip. Captures are stored locally in `results/visual-qa/`.

## Named cloud connectors

Verified November 22, 2026. The scanner supports named fixture, emulator, and live sources with separate connection and run states. Live AWS uses the SDK credential chain, verifies the configured account through STS, and reads S3, IAM, EC2 and security groups. Partial observations preserve unverified findings and do not advance the last complete scan timestamp. Named Azure and GCP sources report **NOT CONNECTED** pending adapters and credentials.

- Targeted connector, Floci, and monitoring suite passed 12 of 12 tests.
- Full `npm test` passed 28 of 28 tests, including all 23 baseline tests. AWS discovery tests use mocked SDK responses.
- `npm run benchmark` matched all 21 synthetic scenarios across 12 posture rules. TP 16, TN 31, FP 0, FN 0.
- `npm run build` passed. The local Floci read-only smoke passed with 20 assets and 12 findings.
- Real AWS account verification was pending authorized credentials. See [SSO, configuration, least-privilege policy and scope](cloud-sources.md).

## Cinematic landing and SOC workspace

The browser UI now uses an obsidian and midnight-blue palette with silver typography and status-specific accents. The full-height landing introduces the platform through a procedural 3D network illustration and a scroll-linked architecture walkthrough. The login and signup screens share that visual language with a split desktop layout and a static atmospheric backdrop on phones. The dashboard is prepared during sign-in and shows scoped skeletons during its first fetch.

- The authenticated workspace adds a persistent collapsible sidebar, an asymmetric posture and severity overview, a real scan status strip, and searchable asset and finding explorers. The detail drawers show evidence, recommendations, source labels, and the timestamps the API actually retains. Escape closes the drawer and returns focus to its trigger.
- The incident workspace presents the recorded attack stages and individually selectable event evidence. A protected `GET /api/ollama/status` checks the configured local model. Investigations preserve recorded observations, model hypotheses, verification steps, and rule-based fallback as separate outputs.
- The network scene has its own lazy-loaded module. Drawing pauses offscreen and in hidden tabs, runs at up to about 30 frames per second, and caps the device pixel ratio at 1.5. Reduced-motion settings suspend automatic rotation and scroll parallax. The scene is a projection rendered on Canvas 2D. The public architecture walkthrough uses conceptual diagrams and contains no inventory, findings, or metric values.

Verification ran November 22, 2026 on Windows 11, Node.js 24.14.1, and Microsoft Edge 158.0.4370.33:

| Check | Result |
| --- | --- |
| Baseline `npm test` and benchmark | 22 tests passed. 21 of 21 posture scenarios matched across 12 rules. |
| Updated `npm test` | 23 tests passed. The added test checks installed and missing Ollama models and an unavailable endpoint. The auth regression test also checks that the model-status API rejects anonymous requests. |
| Updated `npm run benchmark` | 21 of 21 scenarios matched across 12 rules. TP 16, TN 31, FP 0, FN 0. The scheduled API sample took 807.451 ms at a one-second scan interval. |
| `npm run build` | Production React/Vite build succeeded. The standalone scene chunk was 2.03 kB gzip and the dashboard JavaScript chunk was 9.30 kB gzip. |
| Edge on port 3154 | Landing, sign-in, and dashboard captured and checked at 390, 768, 1440, and 1920 CSS pixels. The smoke test also covered reduced motion, keyboard scene rotation, sidebar collapse, finder filters, drawer focus restoration, real Floci polling and scans, local Ollama investigation, and authenticated audit logging. |
| Screenshot review | Aligned mobile and tablet metrics, improved tablet chart heading fit, kept primary landing actions together on tablet, and used a static network motif behind mobile authentication. |

The browser verification used an isolated SQLite database. Live Google sign-in requires provider credentials. The existing signed OIDC protocol regression still passes. Browser coverage for this visual pass is limited to Edge. Drawer history displays the backend's first-detected, last-seen, and resolution timestamps when available.

## React console and authentication

Verified November 22, 2026 on Windows 11 with Node.js 24.14.1, npm 11.11.0, and Edge 158. The work started from a clean `main` at `5979512`.

- The separate `client/` workspace builds React and Vite assets. The server serves the built client and its authenticated API on one loopback origin. The React console maintains environment filtering, polling, finding lifecycle, real status and severity charts, inventory, incident evidence, optional Ollama analysis, and simulated responses. The original static source remains in the repository during migration.
- SQLite persists users, SHA-256 session token digests, OAuth transactions, rate-limit buckets, and account and response audit records. Email/password uses salted scrypt. The server enforces session expiry, logout and rotation, host/origin checks, CSRF, and viewer/admin privileges. The admin setup command requires a fresh local account and prompts for its password.
- Google OIDC uses `openid-client`, Authorization Code with PKCE S256, state, nonce, one-use flow binding, and JWS validation. Google sign-in is absent from the UI when its three settings are missing.
- Windows and Ubuntu CI are configured to install dependencies, run tests and the benchmark, and build the client. Hosted execution remains pending.

| Verification | Observed result |
| --- | --- |
| Baseline `npm test` at `5979512` | 16 passed, 0 failed. |
| Baseline `npm run benchmark` | 21 of 21 scenarios matched across 12 rules. TP 16, TN 31, FP 0, FN 0. One scheduled API detection measured 993.498 ms. |
| Final `npm test` | 22 passed, 0 failed. The original 16 cases remained and monitoring API tests now sign in. Added endpoint protection, RBAC, CSRF, login rate limiting, SQLite persistence, expiry, rotation, logout, and admin provisioning coverage. |
| Google protocol test | The real client library validated a signed local provider fixture. Covered PKCE, state, browser binding, nonce, signature, replay, verified email, and protection against email-based account takeover. Live Google credentials are still required to exercise the provider. |
| Final `npm run benchmark` | 21 of 21 matched, 12 rule IDs covered. TP 16, TN 31, FP 0, FN 0. Engine median 0.062 ms and p95 0.195 ms. One scheduled change reached the authenticated findings API in 779.986 ms using a one-second interval. |
| `npm run build` | Vite 8.3.8 succeeded. The dashboard loads separately at 5.39 kB gzip. Fonts are served as local files compatible with the server’s CSP. |
| Edge browser smoke | Passed landing, signup, password sign-in, logout, viewer controls, scoped asset and findings views, live Floci polling and manual scans, fixture attack stages, actual local Qwen investigation, and identity-attributed simulated audit. Verified the 390 px landing and dashboard with reduced motion. No JavaScript exceptions or CSP violations in the passing run. |
| Floci and Vite proxy | Read-only Floci scan succeeded against 2.5.0 on the existing seeded emulator with 20 assets and 12 findings. The Vite proxy returned a 200 session bootstrap and a 401 from the backend for an invalid login. |

Google provider setup requires an OAuth web client, the matching local redirect, and credentials in an ignored `.env`. See [the provider setup instructions](../README.md#optional-google-sign-in). The browser and CLI account smoke tests use a separate, ignored SQLite database. The working database and Google credentials remain local.

## Monitoring milestone

The earlier monitoring milestone was verified November 22, 2026 on Windows 11 with Node.js 24.14.1 and npm 11.11.0.

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
- Failed scans retain the previous successful snapshot. Scan state, finding lifecycle history and events reset on restart. SQLite now persists account and response audit records. See [security limitations](limitations.md) for coverage and trust boundaries.
- The project uses the existing checkout. Port 3000 is occupied on this workstation, so the demo verification uses port 3153.

## Next highest-priority task

Run a pinned Prowler and Checkov comparison using the paired TCP/22 cases in [the benchmark protocol](experiments.md). Record supported checks, skipped cases, and actual outputs before making comparative claims.
