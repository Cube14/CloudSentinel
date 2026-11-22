# Constraints and limitations

- **Sources:** Only local JSON fixture assets and synthetic events. No direct AWS/Azure/GCP API access, so not suitable for scanning arbitrary intended external environments yet.
- **Cloud fidelity:** Cross-cloud normalized checks simplify real provider-specific semantics, IAM policies, inheritance, permissions and exemptions.
- **Real time:** 15-second periodic rescans and dashboard polling, not streaming and not continuously discovered remote resources.
- **Threat model:** 5 event-rule scenarios; simplistic actor-based correlation; does not detect arbitrary attacks or confirm compromise.
- **AI:** Optional Ollama with a safe fallback and output schema normalization; generated reasoning can still be wrong, and should be reviewed.
- **Response:** Explicitly simulated and logged in memory. Approval is a prompt for a name, not authenticated authorization.
- **Persistence:** Data and audit history are in RAM; restart clears runtime state and replays the sample events.
- **Security:** Local HTTP API has no authentication or rate limiting. Do not expose the server publicly.
- **Benchmarks:** Only synthetic fixture tests performed; does not establish superiority to existing security tools.
- **Production:** No compliance certifications, enterprise operations, exhaustive IAM analysis, or validated remediation.

## Priority next development milestones

1. Add read-only Floci AWS collector with explicit endpoint configuration and service compatibility tests.
2. Add read-only Azure and GCP collectors, each with a documented sandbox and account requirements.
3. Replace in-memory state with a persistent store and implement authenticated RBAC.
4. Add an appropriate same-case Prowler comparison and reproducible dataset.
5. Add SSE/WebSocket event updates rather than polling, and implement resilient scheduled scanning.
