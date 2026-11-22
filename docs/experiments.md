# Evaluation and benchmark protocol

## CloudSentinel measurements

`npm run benchmark` writes `results/benchmark.json` with each expected and observed rule, aggregate metrics, platform and Node version, and latency samples. The suite covers 21 hand-labeled synthetic scenarios spanning AWS, Azure, and GCP and has at least one positive scenario for all 12 implemented posture rule IDs.

Each applicable asset-rule pair is a classification. Applicability is based on supplied evidence fields, and unexpected detections are counted as false positives even for rules outside that set. Precision is TP / (TP + FP), recall is TP / (TP + FN), and false-positive rate is FP / (FP + TN). Scenario match requires the exact expected rule set. The engine timing reports median and p95 of 150 scans of the 21-asset batch after 30 warmups. Scheduled latency is one local measurement from a controlled input change to its first appearance on the findings API, using a one-second scan interval and 50 ms benchmark polling. Browser latency also depends on the dashboard's two-second polling interval.

| Run | Samples | TP | FP | TN | FN | Precision | Recall | False-positive rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline, November 22, 2026 | 8 asset cases | 4 | 0 | 4 | 0 | 1.00 | 1.00 | 0.00 |
| Expanded, November 22, 2026 | 47 asset-rule pairs, 21 exact scenario matches | 16 | 0 | 31 | 0 | 1.00 | 1.00 | 0.00 |

The expanded Windows run on Node.js 24.14.1 measured 0.058 ms median and 0.209 ms p95 for engine batches, and one scheduled API detection at 1002.021 ms. These are controlled observations. The baseline and expanded suites use different units and cannot establish an accuracy improvement.

The separate `npm run demo:floci` test used Floci 2.5.0 and checked six seeded cases. It observed a public S3 policy, internet-wide TCP SSH ingress, a console IAM user without MFA and a directly attached administrator policy. It returned no findings for the paired private encrypted bucket, private SSH group, and API-only user under the supported checks.

## Prowler and Checkov

| Tool | Comparable check candidate | Execution |
| --- | --- | --- |
| Prowler | Runtime AWS security-group SSH rule. Its code accounts for unused resources and a separate all-ports check. Start with explicit TCP/22 groups that Prowler evaluates. | Pending |
| Checkov | Terraform `CKV_AWS_24` for unrestricted ingress on TCP/22. Keep the Terraform representation and the scanned runtime configuration equivalent, and record the resource type. | Pending |

[Prowler check source](https://github.com/prowler-cloud/prowler/blob/master/prowler/providers/aws/services/ec2/ec2_securitygroup_allow_ingress_from_internet_to_tcp_port_22/ec2_securitygroup_allow_ingress_from_internet_to_tcp_port_22.py) · [Checkov CKV_AWS_24 source](https://github.com/bridgecrewio/checkov/blob/main/checkov/terraform/checks/resource/aws/SecurityGroupUnrestrictedIngress22.py)

1. Pin each comparator release and record which checks, resource types, and endpoints run successfully.
2. Pair an IPv4 TCP/22 group with `0.0.0.0/0` and one with a private CIDR. Use matching Terraform values for Checkov and an authorized local emulator inventory for the runtime comparison. Report Prowler bootstrap or emulator incompatibilities separately.
3. Before expanding to IPv6, ranges, or all protocols, confirm each tool's scope and document semantic differences. Keep unsupported or skipped cases separate from the shared accuracy denominator.
4. Record expected labels, versions, actual outputs, status, and time. Calculate comparative metrics only from shared measured cases.

Prowler and Checkov were absent from the local PATH and were not executed in this run. Comparative accuracy and performance remain pending.
