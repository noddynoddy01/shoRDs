# Phase 6C r5 - test report (cloud environment only)

**Environment:** Linux 6.18.44 (cloud container), Python 3.13.18, Node v22.23.4 and v24.22.1. **No Windows, no PowerShell of any version.** Working copy `docs/phase6/pilot6c_r5` (r4 tree `docs/phase6/pilot6c` frozen). Nothing run on the owner's laptop.

## A. Windows PowerShell 5.1 status

| Check | Status |
|---|---|
| Parser check (`Parse-Check.ps1`) on 5.1 x64 | **NOT RUN - unavailable** |
| Runtime binding tests (`Test-Orchestrator.ps1`) on 5.1 x64 | **NOT RUN - unavailable** (script written, awaiting your approval to run) |
| Dry run planning Ngl 8 / ctx 4096, no server, no HTTP, on 5.1 x64 | **NOT RUN - unavailable** |
| Pure-logic vectors (`Test-AgentLogic.ps1`) on 5.1 x64 | **NOT RUN - unavailable** |

The cloud results below are Python mirrors, text/static checks and conformance vectors against a reference implementation. They are not equivalent to executing the scripts.

## B. Commands and results

```
# 1  build the package twice (determinism) and verify it as the owner's Verify-Kit would
$ python3 -I docs/phase6/pilot6c_r5/build_pilot6c.py /tmp/claude-0/dist5/shords-pilot6c-scripts-r5.zip
files: 26 ... zip bytes: 99089   zip sha256: 777b7186da9267c144076e0bb3e766f6f3a74299bcf64cd394923fb3f8a56daf
(second build: identical hash; builder asserts: zip integrity, every member re-hashed against the manifest, file set equals manifest set, static analysis of the shipped CRLF bytes = no findings)

# 2  fresh extraction of the final zip, manifest checked with an independent tool
$ python3 -c "zipfile.ZipFile('shords-pilot6c-scripts-r5.zip').extractall('.')" ; cd shords-pilot6c-r5
$ tr -d '\r' < MANIFEST.sha256.txt > ../m.txt ; sha256sum -c ../m.txt        ->  25 OK, 0 failed

# 3  Python suite, run from the repo copy AND from the extracted zip (CRLF bytes)
$ python3 -I tests/test_pilot6c.py                                            ->  Ran 47 tests in 23.8 s - OK   (both locations)

# 4  conformance vectors regenerate byte-identically
$ python3 -I linux/gen_vectors.py --check                                     ->  OK (243 cases)

# 5  static analyser on the shipped files
$ python3 -I tests/ps_static_check.py .                                       ->  findings: 0
# negative control: the new analyser on the frozen r4 files
$ python3 -I pilot6c_r5/tests/ps_static_check.py pilot6c                      ->  findings: 4, including
     "Phase6C.Runtime.ps1 assigns/reads $script:Ctx but Invoke-PilotRun.ps1 declares the script parameter $Ctx"   (the r4 defect)
     plus two minor top-level/aliasing items (Rollback-6C $cfg, Test-AgentLogic $j) that r5 also fixed

# 6  full regression
$ source /tmp/claude-0/env.sh ; npm run test:node           (Node v22.23.4)   ->  tests 638, pass 637, fail 0, todo 1
$ PATH=/opt/node24/bin:$PATH npm run test:node              (Node v24.22.1)   ->  tests 638, pass 637, fail 0, todo 1
  (baseline before Phase 6C r4: 635/634; the 3 added tests are backend/tests/node/pilot6cBridge.test.js, now pointed at pilot6c_r5)
```

## C. The 47 Python tests (31 carried over, 16 new)

Carried over (all still pass): conformance vectors (job/gate/brake/suite/timestamp/canonical/args), mutation fuzz (6,000 mutated jobs), signature binds every field, monotonic estimates and gates, brake priority, hardened server arguments, PowerShell-vs-oracle mirror (constants, regexes, key sets, reason/gate/brake order, formulas, argument tokens), security text assertions (single `Start-Process`, loopback-only network, no dynamic invocation, every write guarded, dispatcher = allowlist, live gating, gates before start, no key logging, orphan protection), static analyser clean/catches faults, ASCII/no BOM, fake-agent battery.

New in r5 (map to your required list):

| Your item | Test(s) |
|---|---|
| 1 default binding | `test_binding_mirror_default_explicit_and_invalid_context_sizes` (Mode DryRun, Ngl 8, ContextSize 4096; agent Hours 2) |
| 2-4 explicit 4096 / 8192 / 12288 | same test, both `-ContextSize` and alias `-Ctx` |
| 5 invalid values rejected | same test (0, -1, 2048, 5000, 16384, abc, 4096.5; Ngl 21, -1, x; Hours 0, 0.2, 8.5, 9; PollSeconds 1, 31) |
| 6 dot-sourcing three dependencies does not corrupt the parameter | `test_checker_reproduces_the_r4_defect_and_accepts_the_fix`, `test_checker_catches_plain_top_level_and_case_variants`, `test_python_model_of_the_r4_failure`, `test_shipped_orchestrator_has_no_Ctx_parameter_and_keeps_the_alias`, `test_no_script_parameter_name_equals_any_script_scope_name_in_the_package` |
| 7-8 DryRun plan, no server, no HTTP | `test_dry_branches_never_start_stop_or_talk`, `test_dispatch_order_dry_branch_is_the_first_statement_after_unpacking`, `test_orchestrator_and_agent_only_reach_servers_through_the_dispatcher` (text-level; runtime proof is Dry Run A) |
| Mode spelling | `test_entry_scripts_normalise_before_first_use`, `test_context_initialiser_refuses_any_other_spelling`, `test_rollback_normalises_scope` |
| `-BindingTest` safety | `test_switch_exits_before_any_action`, `test_test_script_expectations_match_what_the_scripts_print`, `test_test_orchestrator_is_read_only_and_starts_only_powershell` |
| version binding | `test_dry_run_marker_is_bound_to_the_exact_version` |

## D. What each Windows step will prove (when approved)

| Step | Proves |
|---|---|
| `Verify-Kit.ps1` | the extracted files are the ones whose hashes are in this report |
| `Parse-Check.ps1` | all 10 scripts parse on the real parser |
| `Test-AgentLogic.ps1` | PowerShell Lib logic agrees with the 243 vectors |
| `Test-Orchestrator.ps1` (52 checks) | the r4 failure is gone on real PowerShell: default/4096/8192/12288/alias bind and survive the three dot-sources; invalid values and wrong spelling are handled; nothing is written or started |
| Dry Run A | the whole dry-run path (measurements, integrity, planned server steps) |
