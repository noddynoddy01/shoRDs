#!/usr/bin/env python3
"""Phase 6C tests that run WITHOUT PowerShell (none is available in CI or in the author's sandbox): reference implementation, conformance
vectors, mutation fuzzing, source-level mirror checks of the PowerShell against the Python oracle, security assertions on the PowerShell text,
static analysis, and an end-to-end run of the submitter against a fake agent. The PowerShell itself is proven only by Test-AgentLogic.ps1 and
the supervised dry-run on Windows PowerShell 5.1."""
import hashlib, importlib.util, io, json, os, random, re, shutil, subprocess, sys, tempfile, threading, time, unittest, contextlib

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.abspath(os.path.join(HERE, ".."))
LIN = os.path.join(PKG, "linux")
sys.path.insert(0, LIN)
sys.path.insert(0, HERE)
import pilot_core as c  # noqa: E402
import pilot_submit as sub  # noqa: E402
import ps_static_check as sc  # noqa: E402

def rd(name):
    # the shipped .ps1 files have CRLF line ends; the checks below are written for LF
    return open(os.path.join(PKG, name), encoding="ascii", newline="").read().replace("\r\n", "\n")

LIB = rd("Phase6C.Lib.ps1")
RUN = rd("Phase6C.Runtime.ps1")
AGENT = rd("Pilot-Agent.ps1")
ORCH = rd("Invoke-PilotRun.ps1")
VEC = os.path.join(PKG, "vectors")
KEYV = json.load(open(os.path.join(VEC, "job-vectors.json")))["key"]

def fn_body(text, name):
    m = re.search(r"(?m)^function " + re.escape(name) + r"\b[^{]*\{", text)
    assert m, name
    i = m.end() - 1
    depth = 0
    for j in range(i, len(text)):
        if text[j] == "{":
            depth += 1
        elif text[j] == "}":
            depth -= 1
            if depth == 0:
                return text[i:j + 1]
    raise AssertionError(name)

class Vectors(unittest.TestCase):
    def test_vectors_are_current(self):
        r = subprocess.run([sys.executable, "-I", os.path.join(LIN, "gen_vectors.py"), "--check"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_job_vectors_against_reference(self):
        d = json.load(open(os.path.join(VEC, "job-vectors.json")))
        self.assertGreaterEqual(len(d["cases"]), 100)
        reasons = set()
        for k in d["cases"]:
            ok, reason, _ = c.validate_job(k["text"], k["stem"], k.get("key", d["key"]), k["now"], set(k["seen"]))
            self.assertEqual(reason, k["expect"], k["name"])
            reasons.add(reason)
        for need in ("ok", "size", "json", "top-keys", "schema", "id", "id-name-mismatch", "type", "timestamps", "lifetime", "params-type", "params-keys",
                     "expired", "not-yet-valid", "hmac-format", "hmac", "replay", "params-value:ngl", "params-value:combos"):
            self.assertIn(need, reasons)

    def test_every_job_type_has_a_valid_vector_and_an_invalid_param_vector(self):
        d = json.load(open(os.path.join(VEC, "job-vectors.json")))
        ok_types = {json.loads(k["text"].lstrip("\ufeff"))["type"] for k in d["cases"] if k["expect"] == "ok"}
        self.assertEqual(ok_types, set(c.TYPES))

class Fuzz(unittest.TestCase):
    def test_mutated_jobs_never_validate_unless_semantically_identical(self):
        rng = random.Random(6)
        base = c.dumps_job(c.make_job("job-fuzz-0001", "server-start", {"ngl": 8, "ctx": 4096, "idle_minutes": 30}, KEYV, 1793800000 - 10))
        now = 1793800000
        accepted_same = 0
        for i in range(6000):
            b = bytearray(base.encode("ascii"))
            for _ in range(rng.choice((1, 1, 1, 2, 3))):
                pos = rng.randrange(len(b))
                op = rng.choice(("flip", "delete", "insert", "swap"))
                if op == "flip":
                    b[pos] = rng.randrange(256)
                elif op == "delete":
                    del b[pos]
                elif op == "insert":
                    b.insert(pos, rng.choice(b' \t\n"{}[]:,0123456789abcdefABCDEF'))
                elif pos + 1 < len(b):
                    b[pos], b[pos + 1] = b[pos + 1], b[pos]
            text = b.decode("utf-8", "replace")
            ok, reason, job = c.validate_job(text, "job-fuzz-0001", KEYV, now, set())
            if ok:
                accepted_same += 1
                self.assertEqual(c.canonical_string(job), c.canonical_string(json.loads(base)), text)
        self.assertGreaterEqual(accepted_same, 0)

    def test_signature_binds_every_field(self):
        job = c.make_job("job-bind-0001", "sweep", {"ngl_list": [8, 12], "ctx_list": [4096], "gen_tokens": 64}, KEYV, 1793800000)
        sig = job["hmac"]
        import copy
        for path in (("id",), ("type",), ("created_utc",), ("expires_utc",), ("params", "gen_tokens"), ("params", "ngl_list"), ("params", "ctx_list")):
            j = copy.deepcopy(job)
            tgt = j
            for p_ in path[:-1]:
                tgt = tgt[p_]
            v = tgt[path[-1]]
            tgt[path[-1]] = (v + "x") if isinstance(v, str) else ([x + 1 for x in v] if isinstance(v, list) else v + 1)
            self.assertNotEqual(c.sign(j, KEYV), sig, path)

class Policy(unittest.TestCase):
    def test_monotonic_estimates_and_gates(self):
        for ctx in c.CTX_ALLOWED:
            prev = -1
            for ngl in range(0, c.NGL_MAX + 1):
                e = c.est_vram_mib(ngl, ctx)
                self.assertGreater(e, prev)
                prev = e
                self.assertEqual(c.required_free_vram_mib(ngl, ctx), e + c.POLICY["vram_margin_mib"])
        self.assertLess(c.est_vram_mib(8, 4096), 1900)          # measured peak was 1,613 MiB: the estimate is conservative, not wild
        self.assertGreater(c.est_vram_mib(8, 4096), 1613)
        self.assertEqual([c.min_avail_ram_gib(x) for x in c.CTX_ALLOWED], [6.5, 7.7, 8.9])
        self.assertGreater(c.est_vram_mib(20, 8192), c.POLICY["vram_hard_limit_mib"] - 250)   # the biggest combination can never be admitted on 4 GB

    def test_gate_refuses_every_single_failure(self):
        good = dict(avail_ram_gib=8.5, vram_free_mib=3300, disk_free_gib=100.0, port_free=True, foreign_server=False, own_server=False, exe_ok=True, model_ok=True)
        self.assertEqual(c.failed_checks(c.start_gate_checks(good, 8, 4096)), [])
        for k, bad, name in (("avail_ram_gib", 1.0, "ram"), ("avail_ram_gib", None, "ram"), ("vram_free_mib", 500, "vram"), ("disk_free_gib", 5.0, "disk"), ("port_free", False, "port-free"),
                             ("foreign_server", True, "no-foreign-server"), ("own_server", True, "no-own-server"), ("exe_ok", False, "exe-matches-record"), ("model_ok", False, "model-matches-record")):
            m = dict(good); m[k] = bad
            self.assertEqual(c.failed_checks(c.start_gate_checks(m, 8, 4096)), [name], (k, bad))

    def test_brake_trips_on_each_condition_and_priority_is_stable(self):
        ok = dict(stop_file=False, lease_expired=False, listeners_loopback=True, external_conns=0, avail_ram_gib=3.3, vram_used_mib=1613, log_fatal=False,
                  elapsed_s=1, budget_s=100, telemetry_unknown_streak=0, proc_alive=True)
        self.assertIsNone(c.brake_verdict(ok))
        order = [("stop_file", True, "stop-file"), ("lease_expired", True, "lease-expired"), ("listeners_loopback", False, "non-loopback-listener"), ("external_conns", 1, "external-connection"),
                 ("avail_ram_gib", 0.5, "ram-low"), ("vram_used_mib", 3800, "vram-high"), ("log_fatal", True, "server-log-fatal"), ("elapsed_s", 101, "job-timeout"),
                 ("telemetry_unknown_streak", 5, "telemetry-lost"), ("proc_alive", False, "server-exited")]
        for i, (k, v, name) in enumerate(order):
            s = dict(ok); s[k] = v
            self.assertEqual(c.brake_verdict(s), name)
            # when this and every later condition hold at once, the earliest listed one wins
            s2 = dict(ok)
            for k2, v2, _ in order[i:]:
                s2[k2] = v2
            self.assertEqual(c.brake_verdict(s2), name)

    def test_servers_args_are_hardened(self):
        a = c.server_args("M", 8, 4096, "K")
        self.assertEqual(a[a.index("--host") + 1], "127.0.0.1")
        for need in ("--api-key-file", "--no-webui", "--no-slots", "--no-cors-credentials", "--jinja"):
            self.assertIn(need, a)
        self.assertNotIn("--api-key", a)
        self.assertNotIn("0.0.0.0", " ".join(a))
        self.assertEqual(a[a.index("--cors-origins") + 1], "http://127.0.0.1:8080")
        self.assertEqual(a[a.index("--parallel") + 1], "1")

class Mirror(unittest.TestCase):
    """The PowerShell text must state exactly the constants and orders the Python oracle uses."""
    def test_constants(self):
        g = lambda k: re.search(r"\b" + k + r"\s*=\s*([0-9.]+)", LIB).group(1)
        self.assertEqual(int(g("NglMax")), c.NGL_MAX)
        self.assertEqual(int(g("MaxLifetimeS")), c.MAX_LIFETIME_S)
        self.assertEqual(int(g("ClockSkewS")), c.CLOCK_SKEW_S)
        self.assertEqual(int(g("MaxJobBytes")), c.MAX_JOB_BYTES)
        self.assertEqual(int(g("VramHardLimitMiB")), c.POLICY["vram_hard_limit_mib"])
        self.assertEqual(int(g("VramMarginMiB")), c.POLICY["vram_margin_mib"])
        self.assertEqual(float(g("RamFloorGiB")), c.POLICY["ram_floor_gib"])
        self.assertEqual(float(g("RamBaseGiB")), c.POLICY["ram_base_gib"])
        self.assertEqual(float(g("RamPer4096GiB")), c.POLICY["ram_per_4096_ctx_gib"])
        self.assertEqual(int(g("DiskMinGiB")), c.POLICY["disk_min_gib"])
        self.assertEqual(int(g("Port")), c.POLICY["port"])
        self.assertEqual(tuple(re.findall(r"'([a-z-]+)'", re.search(r"Types\s*=\s*@\(([^)]*)\)", LIB).group(1))), c.TYPES)
        self.assertEqual(tuple(int(x) for x in re.search(r"CtxAllowed\s*=\s*@\(([^)]*)\)", LIB).group(1).split(",")), c.CTX_ALLOWED)
        for s in (c.SCHEMA_JOB, c.SCHEMA_RESULT, c.SCHEMA_SUITE, c.AGENT_VERSION):
            self.assertIn("'" + s + "'", LIB)
        pats = tuple(re.findall(r"'([a-z_ ]+(?:: [a-z ]+)?)'", re.search(r"FatalLogPatterns\s*=\s*@\(([^)]*)\)", LIB).group(1)))
        self.assertEqual(pats, c.FATAL_LOG_PATTERNS)
        self.assertEqual(sorted(re.findall(r"'([a-z_]+)'", re.search(r"TopKeys\s*=\s*@\(([^)]*)\)", LIB).group(1))), sorted(c.TOP_KEYS))

    def test_param_key_sets(self):
        block = re.search(r"ParamKeys\s*=\s*@\{(.*?)\n\}", LIB, re.S).group(1)
        for t, spec in c.PARAM_SPECS.items():
            m = re.search(r"'" + re.escape(t) + r"'\s*=\s*@\(([^)]*)\)", block)
            self.assertIsNotNone(m, t)
            self.assertEqual(sorted(re.findall(r"'([a-z_0-9]+)'", m.group(1))), sorted(spec.keys()), t)
        # every (type.key) has a value rule in Test-ParamValue and no extra rules exist
        body = fn_body(LIB, "Test-ParamValue")
        rules = set(re.findall(r"^\s*'([a-z-]+\.[a-z_0-9]+)'\s*\{", body, re.M))
        want = {t + "." + k for t, spec in c.PARAM_SPECS.items() for k in spec}
        self.assertEqual(rules, want)

    def test_regexes(self):
        for pat in (r"[a-z0-9][a-z0-9-]{6,63}", r"[a-z0-9][a-z0-9_-]{1,40}", r"[0-9a-f]{64}", r"[A-Za-z0-9_-]{1,40}"):
            self.assertIn("\\A" + pat + "\\z", LIB, pat)
        self.assertIn("\\A([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})Z\\z", LIB)
        self.assertIn("-?(0|[1-9][0-9]{0,14})", LIB)
        src = open(os.path.join(LIN, "pilot_core.py")).read()
        for pat in (r"[a-z0-9][a-z0-9-]{6,63}", r"[a-z0-9][a-z0-9_-]{1,40}", r"[0-9a-f]{64}", r"([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})Z"):
            self.assertIn(pat, src, pat)

    def test_order_of_validation_reasons(self):
        ps = re.findall(r"New-JobVerdict \$false '([a-z:-]+)'", fn_body(LIB, "Test-JobText"))
        ps_dyn = [r for r in ps]
        py_src = open(os.path.join(LIN, "pilot_core.py")).read()
        py_body = py_src[py_src.index("def validate_job"):py_src.index("def make_job")]
        py = [r for r in re.findall(r'return False, "([a-z:-]+)"', py_body)]
        norm = lambda xs: [x for x in xs if x != "params-value:"]
        self.assertEqual(norm(ps_dyn), norm(py))   # same codes in the same order (the dynamic params-value:<key> is spelled out in PS)

    def test_order_of_brake_triggers(self):
        ps = re.findall(r"return '([a-z-]+)'", fn_body(LIB, "Get-BrakeVerdict"))
        py_src = open(os.path.join(LIN, "pilot_core.py")).read()
        py = re.findall(r'return "([a-z-]+)"', py_src[py_src.index("def brake_verdict"):py_src.index("def is_loopback_address")])
        self.assertEqual(ps, py)

    def test_order_of_gate_checks(self):
        ps = re.findall(r"New-Check '([a-z-]+)'", fn_body(LIB, "Get-StartGateChecks"))
        py_src = open(os.path.join(LIN, "pilot_core.py")).read()
        py = re.findall(r'out\.append\(\("([a-z-]+)"', py_src[py_src.index("def start_gate_checks"):py_src.index("def failed_checks")])
        ps_u = []
        for x in ps:
            if x not in ps_u:
                ps_u.append(x)
        py_u = []
        for x in py:
            if x not in py_u:
                py_u.append(x)
        self.assertEqual(ps_u, py_u)

    def test_formulas(self):
        self.assertIn("600 + 135 * $Ngl + [int][math]::Floor($Ctx / 256) * $Ngl", LIB)
        self.assertIn("$script:P6C.RamBaseGiB + $script:P6C.RamPer4096GiB * ($Ctx - 4096) / 4096.0", LIB)
        self.assertEqual(c.est_vram_mib(8, 4096), 600 + 135 * 8 + (4096 // 256) * 8)

    def test_server_args_tokens_match(self):
        body = fn_body(LIB, "Get-ServerArgs")
        toks = re.findall(r"'[^']*'|\$\w+|\[string\]\$[\w:.]+|\('http[^)]*\)", body[body.index("return @("):])
        sub_ = {"$ModelPath": "MODEL", "[string]$script:P6C.Port": "8080", "[string]$Ctx": "4096", "[string]$Ngl": "8", "$KeyFile": "KEY"}
        out = []
        for t in toks:
            if t.startswith("'http") or t.startswith("('http"):
                out.append("http://127.0.0.1:8080")
            elif t.startswith("'"):
                out.append(t.strip("'"))
            else:
                out.append(sub_[t])
        self.assertEqual(out, c.server_args("MODEL", 8, 4096, "KEY"))

class SecurityText(unittest.TestCase):
    def test_only_one_program_is_ever_started(self):
        starts = re.findall(r"Start-Process\b[^\n]*", RUN)
        self.assertEqual(len(starts), 1)
        self.assertIn("-FilePath $rec.exe", starts[0])
        for f in (LIB, AGENT, ORCH):
            self.assertNotIn("Start-Process", f)
        self.assertEqual(len(re.findall(r"\$rec\.exe", fn_body(RUN, "Start-PilotServer"))) > 0, True)
        self.assertIn("(Get-FileSha256 $rec.exe)", RUN)   # hash-checked before every start (Get-StartMeasurements)

    def test_network_is_loopback_constant_only(self):
        self.assertEqual(len(re.findall(r"'http://127\.0\.0\.1:'", RUN)), 1)
        self.assertNotRegex(RUN + LIB + AGENT + ORCH, r"https?://(?!127\.0\.0\.1|evil\.example)[a-z]")   # evil.example is only a fake Origin header value sent to loopback
        self.assertIn("'refused path'", RUN)
        self.assertIn("UseProxy = $false", RUN)
        self.assertNotIn("0.0.0.0", fn_body(LIB, "Get-ServerArgs"))

    def test_job_content_never_reaches_a_command(self):
        # no job parameter is concatenated into Start-Process arguments, paths come from constants/records, the suite path is name-validated
        self.assertIn("Join-Path $script:Ctx.P.Suites ($name + '.json')", RUN)
        self.assertIn("[void](Assert-UnderRoot $path)", fn_body(RUN, "Invoke-JobRunSuite"))
        self.assertNotRegex(RUN, r"Invoke-Expression|\biex\b|&\s*\$|\.Invoke\(|ScriptBlock\]::Create|Add-Type\s+-AssemblyName\s+\$")
        self.assertNotIn("$Job['params']['suite'] +", RUN)

    def test_every_write_is_under_the_root_guard(self):
        for fn in ("Write-AtomicText", "New-KeyFile", "Initialize-PilotContext", "Move-ToFolder"):
            self.assertIn("Assert-UnderRoot", fn_body(RUN, fn), fn)
        for m in re.finditer(r"Remove-Item\b[^\n]*", RUN):
            self.assertTrue(("PidFile" in m.group(0)) or ("'Env:'" in m.group(0)), m.group(0))
        self.assertNotIn("-Recurse", RUN + LIB + AGENT + ORCH)

    def test_dispatcher_covers_exactly_the_allowlist(self):
        body = fn_body(RUN, "Invoke-PilotJob")
        self.assertEqual(tuple(re.findall(r"^\s*'([a-z-]+)'\s*\{ \$out", body, re.M)), c.TYPES)
        self.assertIn("default { $R.error = 'unsupported job type' }", body)

    def test_live_mode_is_gated(self):
        for src in (AGENT, ORCH):
            self.assertIn("Test-DryRunMarker", src)
            self.assertIn("APPROVE E-LIVE", src)
            self.assertIn("APPROVE E-DRYRUN", src)
        self.assertEqual(re.findall(r"if \(\$script:Ctx\.Mode -ceq 'DryRun'\)", fn_body(RUN, "Invoke-JobServerStart"))[:1] != [], True)
        for fn in ("Invoke-JobServerStart", "Invoke-JobServerStop", "Invoke-JobHealth", "Invoke-JobSweep", "Invoke-JobRunSuite"):
            self.assertIn("'DryRun'", fn_body(RUN, fn), fn + " must branch on DryRun before doing anything live")
        self.assertIn("Start-PilotServer", fn_body(RUN, "Invoke-JobServerStart"))
        # Start-PilotServer is only reachable from the live branches
        callers = [m.group(1) for m in re.finditer(r"(?m)^function (\S+)[^{]*\{(?:(?!^function ).)*?Start-PilotServer", RUN, re.S) if m.group(1) != "Start-PilotServer"]
        self.assertEqual(sorted(set(callers)), ["Invoke-JobServerStart", "Invoke-JobSweep"])

    def test_resource_gates_cannot_be_bypassed(self):
        b = fn_body(RUN, "Start-PilotServer")
        self.assertIn("Get-StartGateChecks", b)
        self.assertLess(b.index("Get-StartGateChecks"), b.index("New-KeyFile"))
        self.assertLess(b.index("Get-StartGateChecks"), b.index("Start-Process"))
        self.assertLess(b.index("Confirm-ModelHash"), b.index("Start-Process"))
        self.assertNotRegex(RUN, r"-SkipGates|-Force\b[^\n]*gate|NoGate")
        self.assertIn("Invoke-EmergencyShutdown", b)
        self.assertIn("Get-MonitorVerdict", fn_body(RUN, "Invoke-PilotHttp"))

    def test_api_key_never_logged(self):
        for m in re.finditer(r"Add-Audit\s+'[^']+'\s+@\{[^}]*\}", RUN):
            self.assertNotRegex(m.group(0), r"\$key\b|\.Key\b|KeyText|Bearer")
        self.assertNotRegex(RUN, r"Write-Host[^\n]*\$key\b")
        self.assertNotIn("'--api-key'", LIB)

    def test_stale_server_is_not_left_running(self):
        self.assertIn("KILL_ON_JOB_CLOSE" if False else "LimitFlags = 0x2000", RUN)
        self.assertIn("[Shords.JobGuard]::Assign($p.Handle)", RUN)
        self.assertIn("finally", AGENT)
        self.assertIn("Stop-PilotServer ('agent-exit:' + $exitReason)", AGENT)
        self.assertIn("Test-ServerIdle", AGENT)

class Static(unittest.TestCase):
    def test_static_analysis_clean(self):
        self.assertEqual(sc.check_package(PKG), [])

    def test_ascii_and_no_bom(self):
        for f in os.listdir(PKG):
            if f.endswith((".ps1", ".txt", ".py")):
                b = open(os.path.join(PKG, f), "rb").read()
                b.decode("ascii")
                self.assertFalse(b.startswith(b"\xef\xbb\xbf"))

    def test_static_checker_catches_what_it_claims(self):
        with tempfile.TemporaryDirectory() as d:
            open(os.path.join(d, "Phase6C.Lib.ps1"), "w").write(
                "function A { param($x)\n  if ($x -eq 'abc') { return 1 }\n  $y = Get-Nothing $z\n  Write-Host 'a' + $x\n  if ($x -match 'a') { }\n  $q = Get-Another -Nope 1\n}\nif ($a ?? $b) { }\n")
            msgs = " | ".join(m for _f, _l, m in sc.check_package(d))
            for need in ("case-insensitive compare", "unknown command Get-Another", "never assigned", "bare +", "case-insensitive operator -match", "null-coalescing"):
                self.assertIn(need, msgs)

class FakeAgentEndToEnd(unittest.TestCase):
    """Runs the real submitter (battery) against a Python stand-in agent that applies the reference validator. Proves the file protocol,
    atomic submit, result lookup and the battery's expectations; it does NOT prove the PowerShell agent."""
    def test_battery_against_fake_agent(self):
        with tempfile.TemporaryDirectory() as root:
            p = sub.paths(root)
            for d in ("inbox", "outbox", "rejected"):
                os.makedirs(p[d], exist_ok=True)
            key = c.make_job("x" * 8, "server-stop", {}, "0" * 64, 1793800000)  # warm import only
            keytext = "".join(random.Random(1).choice("0123456789abcdef") for _ in range(64))
            open(p["key"], "w").write(keytext)
            stop = threading.Event()
            seen = set()
            def agent():
                while not stop.is_set():
                    for n in sorted(os.listdir(p["inbox"])):
                        if not n.endswith(".json") or n.endswith(".tmp"):
                            continue
                        fp = os.path.join(p["inbox"], n)
                        text = open(fp, encoding="utf-8").read()
                        stem = n[:-5]
                        ok, reason, job = c.validate_job(text, stem, keytext, int(time.time()), seen)
                        os.replace(fp, os.path.join(p["rejected"] if not ok else p["jobs"], n))
                        if ok:
                            seen.add(job["id"])
                            planned = job["type"] in ("server-start", "server-stop", "health", "sweep", "run-suite")
                            res = {"id": job["id"], "type": job["type"], "status": "planned" if planned else "ok"}
                        else:
                            res = {"id": stem, "type": None, "status": "rejected", "error": reason}
                        out = os.path.join(p["outbox"], ("" if ok else "rejected-") + stem + ".json")
                        json.dump(res, open(out, "w"))
                    time.sleep(0.05)
            t = threading.Thread(target=agent, daemon=True); t.start()
            buf = io.StringIO()
            try:
                with contextlib.redirect_stdout(buf):
                    rc = sub.main(["--root", root, "battery", "--wait", "5"])
            finally:
                stop.set(); t.join(2)
            self.assertEqual(rc, 0, buf.getvalue())
            self.assertIn("as expected", buf.getvalue())
            self.assertTrue(os.path.exists(os.path.join(root, "suites", "synthetic-v1.json")))

    def test_suite_file_is_valid_and_synthetic(self):
        ok, reason = c.validate_suite_text(sub.suite_bytes().decode("ascii"))
        self.assertEqual((ok, reason), (True, "ok"))
        self.assertEqual(sub.synthetic_suite()["provenance"], "synthetic")

# ---------------------------------------------------------------------------------------------------------------------------------------------
# r5: parameter / script-scope collision (r4 defect), Mode spelling, dry-run containment. These are PYTHON MIRRORS and TEXT checks of PowerShell
# semantics. They are not a substitute for running Test-Orchestrator.ps1 / Test-AgentLogic.ps1 on Windows PowerShell 5.1.
TESTORCH = rd("Test-Orchestrator.ps1")

def split_top(text, sep=","):
    out, depth, cur, q = [], 0, [], None
    for ch in text:
        if q:
            cur.append(ch)
            if ch == q:
                q = None
            continue
        if ch in "'\"":
            q = ch; cur.append(ch); continue
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        if ch == sep and depth == 0:
            out.append("".join(cur)); cur = []
        else:
            cur.append(ch)
    out.append("".join(cur))
    return [x.strip() for x in out if x.strip()]

def parse_params(script_text):
    sp = sc.param_block_span(script_text)
    inner = script_text[sp[0] + 1:sp[1] - 1]
    params = []
    for item in split_top(inner):
        attrs = re.findall(r"\[(\w+)\(([^\]]*)\)\]", item)
        typ = [t for t in re.findall(r"\[(\w+)\]", item) if t.lower() in ("int", "double", "string", "switch", "long")]
        m = re.search(r"\$(\w+)\s*(?:=\s*(.+))?$", item.strip(), re.S)
        params.append(dict(name=m.group(1), type=(typ[-1].lower() if typ else "object"), attrs=attrs, default=(m.group(2) or "").strip().strip("'")))
    return params

class BindError(Exception):
    pass

def bind(params, argv):
    """Mirror of PowerShell parameter binding for the attributes used here: type conversion, Alias, ValidateSet (case-INsensitive, spelling kept), ValidateRange."""
    byname = {}
    for p_ in params:
        byname[p_["name"].lower()] = p_
        for a, args in p_["attrs"]:
            if a == "Alias":
                for al in re.findall(r"'([^']+)'", args):
                    byname[al.lower()] = p_
    vals = {}
    for p_ in params:
        if p_["type"] != "switch" and p_["default"]:
            vals[p_["name"]] = conv(p_, p_["default"])
        if p_["type"] == "switch":
            vals[p_["name"]] = False
    i = 0
    while i < len(argv):
        key = argv[i].lstrip("-").lower()
        if key not in byname:
            raise BindError("unknown parameter " + argv[i])
        p_ = byname[key]
        if p_["type"] == "switch":
            vals[p_["name"]] = True; i += 1; continue
        vals[p_["name"]] = conv(p_, argv[i + 1]); i += 2
    return vals

def conv(p_, raw):
    t = p_["type"]
    try:
        v = int(raw) if t in ("int", "long") else float(raw) if t == "double" else raw
    except ValueError:
        raise BindError("cannot convert %r to %s" % (raw, t))
    for a, args in p_["attrs"]:
        if a == "ValidateSet":
            allowed = [x.strip().strip("'") for x in split_top(args)]
            if t == "string":
                if str(v).lower() not in [x.lower() for x in allowed]:
                    raise BindError("ValidateSet")
            elif str(v) not in allowed:
                raise BindError("ValidateSet")
        if a == "ValidateRange":
            lo, hi = [float(x) for x in split_top(args)]
            if not (lo <= v <= hi):
                raise BindError("ValidateRange")
    return v

R4_ENTRY = "param(\n  [ValidateSet('DryRun', 'Live')][string]$Mode = 'DryRun',\n  [ValidateRange(0, 20)][int]$Ngl = 8,\n  [ValidateSet(4096, 8192, 12288)][int]$Ctx = 4096,\n  [string]$Root = 'D:\\llm'\n)\n. (Join-Path $PSScriptRoot 'Lib.ps1')\n"
R4_LIB = "$script:Ctx = $null\n$script:St = $null\nfunction F { return 1 }\n"
R5_ENTRY = R4_ENTRY.replace("[ValidateSet(4096, 8192, 12288)][int]$Ctx = 4096", "[Alias('Ctx')][ValidateSet(4096, 8192, 12288)][int]$ContextSize = 4096")

class ParameterScopeCollision(unittest.TestCase):
    def collide(self, entry, lib):
        with tempfile.TemporaryDirectory() as d:
            open(os.path.join(d, "Entry.ps1"), "w").write(entry)
            open(os.path.join(d, "Lib.ps1"), "w").write(lib)
            return [m for _f, _l, m in sc.check_package(d) if "collision" in m]

    def test_checker_reproduces_the_r4_defect_and_accepts_the_fix(self):
        bad = self.collide(R4_ENTRY, R4_LIB)
        self.assertTrue(any("$script:Ctx" in m and "$Ctx" in m for m in bad), bad)
        self.assertEqual(self.collide(R5_ENTRY, R4_LIB), [])

    def test_checker_catches_plain_top_level_and_case_variants(self):
        self.assertTrue(self.collide(R4_ENTRY, "$ctx = 5\n"))
        self.assertTrue(self.collide(R4_ENTRY, "$SCRIPT:CTX = 5\n"))
        self.assertTrue(self.collide(R4_ENTRY, "$Ngl = 5\n"))
        self.assertTrue(self.collide(R4_ENTRY, "foreach ($Ctx in 1..2) { }\n"))
        self.assertEqual(self.collide(R5_ENTRY, "function F { $ctx = 5; $ngl = 1 }\n"), [])   # function-local variables are separate scopes

    def test_python_model_of_the_r4_failure(self):
        # the r4 error: the script parameter is a typed, validated SCRIPT variable; $script:Ctx = $null converts null to 0 and ValidateSet(4096,...) refuses it
        r4 = parse_params(R4_ENTRY)
        ctx = [p_ for p_ in r4 if p_["name"] == "Ctx"][0]
        with self.assertRaises(BindError):
            conv(ctx, "0")
        self.assertEqual(conv(ctx, "4096"), 4096)

    def test_shipped_orchestrator_has_no_Ctx_parameter_and_keeps_the_alias(self):
        names = [p_["name"] for p_ in parse_params(ORCH)]
        self.assertNotIn("Ctx", [n.title() if n.lower() == "ctx" else n for n in names if n.lower() == "ctx"])
        self.assertIn("ContextSize", names)
        cs = [p_ for p_ in parse_params(ORCH) if p_["name"] == "ContextSize"][0]
        self.assertEqual(cs["type"], "int")
        self.assertEqual(cs["default"], "4096")
        self.assertIn(("Alias", "'Ctx'"), cs["attrs"])
        self.assertIn(("ValidateSet", "4096, 8192, 12288"), cs["attrs"])
        code = sc.strip_code(ORCH)[0]
        self.assertEqual(re.findall(r"(?<![\w:])\$Ctx\b", code), [])         # no bare $Ctx variable anywhere in the orchestrator
        self.assertEqual(len(re.findall(r"\$ContextSize\b", code)), 8)       # declaration + 7 uses (binding test, approval text, plan x2, audit, summary, ...)

    def test_no_script_parameter_name_equals_any_script_scope_name_in_the_package(self):
        allcode = {f: sc.strip_code(rd(f))[0] for f in os.listdir(PKG) if f.endswith(".ps1")}
        raw = {f: rd(f) for f in allcode}
        findings, _ = sc.scope_collisions(allcode, raw)
        self.assertEqual(findings, [])

    def test_binding_mirror_default_explicit_and_invalid_context_sizes(self):
        ps = parse_params(ORCH)
        d = bind(ps, [])
        self.assertEqual((d["Mode"], d["Ngl"], d["ContextSize"]), ("DryRun", 8, 4096))                      # 1 default
        for ctx in (4096, 8192, 12288):                                                                     # 2-4 explicit
            self.assertEqual(bind(ps, ["-Ngl", "8", "-ContextSize", str(ctx)])["ContextSize"], ctx)
            self.assertEqual(bind(ps, ["-Ctx", str(ctx)])["ContextSize"], ctx)                              # alias keeps the old command line working
        for bad in ("0", "-1", "2048", "5000", "16384", "abc", "4096.5"):                                   # 5 invalid
            with self.assertRaises(BindError, msg=bad):
                bind(ps, ["-ContextSize", bad])
            with self.assertRaises(BindError, msg=bad):
                bind(ps, ["-Ctx", bad])
        for bad in ("21", "-1", "x"):
            with self.assertRaises(BindError):
                bind(ps, ["-Ngl", bad])
        self.assertEqual(bind(ps, ["-Ngl", "0"])["Ngl"], 0)
        self.assertEqual(bind(ps, ["-Ngl", "20"])["Ngl"], 20)
        # 6: nothing that is dot-sourced may touch these variables (see the collision tests above)
        agent = parse_params(AGENT)
        self.assertEqual(bind(agent, [])["Hours"], 2.0)
        for bad in ("0", "0.2", "8.5", "9"):
            with self.assertRaises(BindError):
                bind(agent, ["-Hours", bad])
        for ok in ("0.25", "1", "8"):
            bind(agent, ["-Hours", ok])
        for bad in ("1", "31"):
            with self.assertRaises(BindError):
                bind(agent, ["-PollSeconds", bad])

class ModeSpelling(unittest.TestCase):
    """ValidateSet ignores case and keeps what was typed ('live'); the code compares with -ceq. r4 would then show the DRY RUN approval but run the live branches."""
    def normalise(self, mode):
        return "Live" if mode.lower() == "live" else "DryRun"       # the one-line normalisation in both entry scripts

    def test_entry_scripts_normalise_before_first_use(self):
        line = "if ($Mode.ToLowerInvariant() -ceq 'live') { $Mode = 'Live' } else { $Mode = 'DryRun' }"
        for name, src in (("Pilot-Agent", AGENT), ("Invoke-PilotRun", ORCH)):
            self.assertIn(line, src, name)
            first_use = min(i for i in (src.find("$Mode -ceq"), src.find("-Mode $Mode"), src.find("'BINDING-TEST Mode='")) if i >= 0)
            self.assertLess(src.index(line), first_use, name)
        for typed in ("live", "LIVE", "Live", "lIvE"):
            self.assertEqual(self.normalise(typed), "Live")
        for typed in ("dryrun", "DRYRUN", "DryRun"):
            self.assertEqual(self.normalise(typed), "DryRun")

    def test_context_initialiser_refuses_any_other_spelling(self):
        body = fn_body(RUN, "Initialize-PilotContext")
        self.assertIn("if ($Mode -cne 'DryRun' -and $Mode -cne 'Live') { throw", body)
        self.assertLess(body.index("throw"), body.index("$script:Ctx = @{"))

    def test_rollback_normalises_scope(self):
        rb = rd("Rollback-6C.ps1")
        self.assertIn("$known.ToLowerInvariant() -ceq $Scope.ToLowerInvariant()", rb)
        self.assertLess(rb.index("$known.ToLowerInvariant()"), rb.index("if ($Scope -ceq 'Jobs'"))

class BindingTestSwitch(unittest.TestCase):
    def block(self, src):
        i = src.index("if ($BindingTest) {")
        j = src.index("\n}\n", i) + 3
        return src[i:j]

    def test_switch_exits_before_any_action(self):
        for name, src in (("Pilot-Agent", AGENT), ("Invoke-PilotRun", ORCH)):
            code = sc.strip_code(src)[0]
            blk = self.block(src)
            self.assertIn("exit 0", blk)
            self.assertLess(src.index("if ($BindingTest) {"), src.index("Initialize-PilotContext -Mode"), name)
            self.assertGreater(src.index("if ($BindingTest) {"), src.index("Phase6C.Runtime.ps1"), name)   # after all three dot-sources: that is the point of the test
            for banned in ("Write-Atomic", "New-Item", "Start-Process", "Set-Content", "Add-Audit", "Invoke-Pilot", "Initialize-"):
                self.assertNotIn(banned, blk, name)
            self.assertIn("[switch]$BindingTest", src)

    def test_test_script_expectations_match_what_the_scripts_print(self):
        keys_run = ["Mode=", " Ngl=", " ContextSize=", " ContextType=", " Root=", " CfgRoot=", " ScriptCtxNull="]
        keys_agent = ["Mode=", " Hours=", " PollSeconds=", " Root=", " CfgRoot=", " ScriptCtxNull="]
        for keys, src in ((keys_run, self.block(ORCH)), (keys_agent, self.block(AGENT))):
            pos = [src.index(k) for k in keys]
            self.assertEqual(pos, sorted(pos))
        self.assertIn("'BINDING-TEST Mode=DryRun Ngl=' + $c.Ngl + ' ContextSize=' + $c.Ctx + ' ContextType=Int32 Root=D:\\llm CfgRoot=D:\\llm ScriptCtxNull=True'", TESTORCH)
        self.assertIn("'BINDING-TEST Mode=' + $c.Mode + ' Hours=' + $c.Hours + ' PollSeconds=' + $c.Poll + ' Root=D:\\llm CfgRoot=D:\\llm ScriptCtxNull=True'", TESTORCH)

    def test_test_orchestrator_is_read_only_and_starts_only_powershell(self):
        code = sc.strip_code(TESTORCH)[0]
        self.assertEqual(len(re.findall(r"Process\]::Start", code)), 1)
        self.assertIn("$script:psExe = Join-Path $PSHOME 'powershell.exe'", TESTORCH)
        for banned in ("Set-Content", "Out-File", "Add-Content", "New-Item", "Remove-Item", "WriteAllText", "Invoke-WebRequest", "Start-Process", "Add-Type", ". (Join-Path"):
            self.assertNotIn(banned, code)
        self.assertEqual(sorted(set(re.findall(r"Invoke-Child '([A-Za-z0-9.-]+)'", TESTORCH))), ["Invoke-PilotRun.ps1", "Pilot-Agent.ps1"])
        calls = [l for l in TESTORCH.split("\n") if "= Invoke-Child " in l]
        self.assertGreaterEqual(len(calls), 6)
        for l in calls:
            self.assertIn("-BindingTest", l, "every child run must carry -BindingTest: " + l)

class DryRunContainment(unittest.TestCase):
    LIVE_CALLS = ("Start-PilotServer", "Stop-PilotServer", "Invoke-PilotHttp", "Invoke-ChatCall", "Invoke-EmergencyShutdown", "Start-Process")

    def dry_block(self, fname):
        body = fn_body(RUN, fname)
        i = body.index("if ($script:Ctx.Mode -ceq 'DryRun') {")
        depth, j = 0, body.index("{", i)
        for k in range(j, len(body)):
            depth += body[k] == "{"
            depth -= body[k] == "}"
            if depth == 0:
                return body[j:k + 1], body[:i] + body[k + 1:]
        raise AssertionError

    def test_dry_branches_never_start_stop_or_talk(self):
        for fn in ("Invoke-JobServerStart", "Invoke-JobServerStop", "Invoke-JobHealth", "Invoke-JobSweep", "Invoke-JobRunSuite"):
            dry, rest = self.dry_block(fn)
            self.assertIn("return", dry, fn)
            for call in self.LIVE_CALLS:
                self.assertNotIn(call, dry, fn + " dry branch must not call " + call)
        for fn in ("Invoke-JobServerStart", "Invoke-JobSweep"):
            self.assertIn("Start-PilotServer", self.dry_block(fn)[1], fn)

    def test_dispatch_order_dry_branch_is_the_first_statement_after_unpacking(self):
        for fn in ("Invoke-JobServerStop", "Invoke-JobHealth"):
            body = fn_body(RUN, fn)
            first = body.index("if ($script:Ctx.Mode -ceq 'DryRun')")
            for call in self.LIVE_CALLS:
                if call in body:
                    self.assertGreater(body.index(call), first, fn + ": " + call)

    def test_orchestrator_and_agent_only_reach_servers_through_the_dispatcher(self):
        for name, src in (("Pilot-Agent", AGENT), ("Invoke-PilotRun", ORCH)):
            code = sc.strip_code(src)[0]
            self.assertNotIn("Start-PilotServer", code, name)
            self.assertNotIn("Invoke-PilotHttp", code, name)
            self.assertNotIn("Invoke-ChatCall", code, name)
        self.assertEqual(len(re.findall(r"Invoke-PilotJob \$job", sc.strip_code(ORCH)[0])), 1)

    def test_dry_run_marker_is_bound_to_the_exact_version(self):
        self.assertIn("$m.agent_version -cne $script:P6C.Version", fn_body(RUN, "Test-DryRunMarker"))
        self.assertEqual(c.AGENT_VERSION, "r5.0")             # an r4 dry-run marker (agent_version r4.0) can never unlock r5 Live


if __name__ == "__main__":
    unittest.main(verbosity=1)
