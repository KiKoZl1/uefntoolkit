# Ralph Runbooks

This document provides operational runbooks for common Ralph incidents.

## Incident: build keeps failing
1. Confirm failing file list and root error.
2. Retry max 2 cycles with focused fixes.
3. If still failing, set run status to `failed`.
4. Raise incident type `build_failure_loop`.
5. Stop automation and request human intervention.

### Guard policy (mandatory)
1. If the same build failure signature repeats for 2 consecutive runs, disable `apply` and force `propose`.
2. Restrict next run to diagnosis and minimal compile-fix only.
3. Do not continue feature implementation while build remains red.
4. Resume `apply` only after one full green gate pass (build + test when enabled).

## Incident: tests fail without progress
1. Compare failing tests to touched files.
2. Attempt one targeted fix cycle.
3. If no progress in 2 cycles, stop run.
4. Raise incident `test_regression_unresolved`.

## Incident: DB/RPC timeout spike during dataops run
1. Stop new write-heavy steps.
2. Capture query and context in incident metadata.
3. Validate lock and statement timeouts.
4. Mark run `failed` or `rolled_back`.
5. Escalate for manual DB review.

## Incident: fail rate rises above threshold
1. Pull error breakdown.
2. Classify top error type.
3. Run narrow remediation (one hypothesis at a time).
4. Re-evaluate KPI.
5. If still above threshold, keep run non-promotable.

## Incident: missing evidence in report mode
1. Verify source RPCs.
2. Verify weekly report payload contract.
3. Rebuild once with full evidence pass.
4. If missing again, raise `report_contract_violation`.

## Rollback Rules
Rollback immediately if:
- critical incident is raised
- mandatory gate fails after retry limit
- migration side effects are unknown/unbounded
- repeated line-breaking patch behavior is detected (`find_not_line_bounded`, `find_ambiguous`, or parse-corrupting replacements)

Rollback process:
1. Revert run changes in branch
2. Mark run `rolled_back`
3. Open incident with rollback reason
4. Attach diff and gate logs

## Escalation Matrix
- `info`: log only
- `warn`: continue with caution
- `error`: continue only if gate unaffected
- `critical`: stop run immediately
