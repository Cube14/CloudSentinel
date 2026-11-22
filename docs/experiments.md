# Experimental evaluation and benchmark protocol

## Current measured fixture benchmark

Run `npm test` and `npm run benchmark`. The benchmark generates `results/benchmark.json` with true positives, false positives, true negatives, false negatives, precision, recall, and false-positive rate. Eight hand-constructed configuration examples are used. These provide **unit-style correctness evidence**, not operational validation. Results from this small set are not a generalizable accuracy estimate.

## External comparator (not yet executed)

Choose Prowler OSS for runtime cloud configuration posture assessment, or Checkov for *infrastructure-as-code* checks. Comparing CloudSentinel's simulated runtime inventory with Checkov's Terraform-oriented scanning without equivalent resource representations would be methodologically invalid.

For a defensible comparison:

1. Define at least 20 vulnerable and 20 safe configurations with independently reviewed ground-truth labels.
2. Use a common set of rules such as public object storage, unrestricted SSH, missing encryption and administrative IAM rights. Document exact semantic differences among cloud providers.
3. Provision the same controls in a supported **authorized test environment**. Use Floci only where each API and check is demonstrated compatible; otherwise clearly separate results from JSON-fixture results.
4. Record detector/check IDs, tested versions, checks skipped, false positives/negatives, execution time and resource use. Do not count unsupported checks as detection successes.
5. Report both tool coverage and precision/recall over *shared supported cases*. Avoid claiming overall superiority from a subset or the UI.
6. Evaluate CloudSentinel's additional attack-chain correlation and local incident narration separately from CSPM recall.

**Current evidence:** Tests of CloudSentinel itself are automated. No Prowler or Checkov baseline has been executed within this repository. Therefore no claim that CloudSentinel outperforms them is justified.

## Notes on Floci

Floci is an open-source local cloud emulator, not a real AWS deployment. It can be used to populate emulated cloud resources in a future connector. Its capabilities and API semantics should be tested per resource and per release. A simulator's success is not proof that a tool works on AWS production accounts.
