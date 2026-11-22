# Security limitations

- **Source fidelity.** AWS, Azure and GCP fixture settings are normalized examples. Floci provides local AWS-shaped API responses. Real cloud accounts are outside the supported scope.
- **Floci coverage.** The collector reads one region and a bounded set of configuration APIs. Public bucket policy status does not establish effective anonymous access. Access logging, ACL inheritance, IAM inline/group policies, permission boundaries, effective access, and EC2 network reachability are outside the assessments. EC2 instances appear as inventory without the fixture-only production flag.
- **Coverage gaps.** An unsupported or inaccessible required operation fails the environment run. Partial responses are discarded. A clean result is limited to the implemented checks and the collected inventory.
- **Monitoring.** Scheduled scans and dashboard polling create a delay. A slow source can queue other scans. The app does not subscribe to cloud events. Event correlation is a small actor-based lab demonstration.
- **AI.** Model suggestions are advisory. The model receives selected event fields and malformed responses trigger a deterministic fallback. The engine and audit trail function independently of AI.
- **Persistence and access.** Scan history, findings lifecycle, event ingestion, and audit are volatile. The loopback API assumes a trusted single-user machine and provides no authentication or RBAC. Response approval records simulation metadata only.
- **Evaluation.** The controlled scenario set and seeded emulator checks establish bounded behavior. Independent Prowler and Checkov runs remain pending.
