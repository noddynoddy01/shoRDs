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
        self.assertEqual(c.AGENT_VERSION, "r8.0")             # an r4, r5, r6 or r7 dry-run marker (agent_version r4.0 ... r7.0) can never unlock r8 Live
        self.assertIn("Version          = 'r8.0'", LIB)

# ---------------------------------------------------------------------------------------------------------------------------------------------
# r6: the two defects the owner's Windows PowerShell 5.1 run of r5 found. Both are behaviours of the real PowerShell runtime, which these Python
# tests cannot execute; they therefore (a) model the PowerShell rule in a few lines, (b) assert the exact source text, (c) make the static analyser
# reject the r5 constructs. The proof on Windows is Test-AgentLogic.ps1 (shape:* and outcome:* checks, 26 gate cases) and Test-FileOps.ps1.
FILEOPS = rd("Test-FileOps.ps1")
ALL_PS1 = {f: rd(f) for f in sorted(os.listdir(PKG)) if f.endswith(".ps1")}
TESTAGENT = rd("Test-AgentLogic.ps1")

def ps_pipeline(returned, comma):
    """Model of what a PowerShell function emits for 'return $x' (comma=False) and 'return ,$x' (comma=True) when $x is a collection:
    the first emits the ITEMS one by one, the second emits ONE object (the collection itself)."""
    return [returned] if comma else list(returned)

def ps_at(objs):
    """@(...) around a function call: the pipeline objects as an array (nothing -> empty array)."""
    return list(objs)

def ps_join(objs, sep=","):
    """-join over an array: a nested collection becomes its .ToString(), i.e. its type name."""
    return sep.join("System.Collections.ArrayList" if isinstance(o, list) else str(o) for o in objs)

class R6GateReturnShape(unittest.TestCase):
    def test_model_reproduces_the_r5_symptom_and_the_r6_contract(self):
        for failed in ([], ["ram"], ["ram", "vram", "disk"]):
            r5 = ps_join(ps_at(ps_pipeline(failed, comma=True)))
            r6 = ps_join(ps_at(ps_pipeline(failed, comma=False)))
            self.assertEqual(r5, "System.Collections.ArrayList")          # exactly what the owner saw for [], [ram], [vram], [disk]
            self.assertEqual(r6, ",".join(failed))

    def test_the_26_failing_cases_are_the_26_gate_vectors(self):
        cases = json.load(open(os.path.join(VEC, "gate-vectors.json")))["cases"]
        self.assertEqual(len(cases), 26)
        self.assertIn("$f = @(Get-FailedCheckNames $checks) -join ','", TESTAGENT)
        for case in cases:       # the Python oracle produces the exact lists the PowerShell must now produce
            got = c.failed_checks(c.start_gate_checks(case["m"], case["ngl"], case["ctx"]))
            self.assertEqual(got, case["failed"], case["name"])

    def test_no_function_returns_its_list_wrapped(self):
        for name, src in ALL_PS1.items():
            code = sc.strip_code(src)[0]
            self.assertIsNone(re.search(r"\breturn\s+,", code), name)
        self.assertRegex(fn_body(LIB, "Get-FailedCheckNames"), r"return \$f\s*\}")
        self.assertRegex(fn_body(LIB, "Get-StartGateChecks"), r"return \$out\s*\}")

    def test_every_caller_wraps_the_call_in_at_parentheses(self):
        for name, src in ALL_PS1.items():
            code = sc.strip_code(src)[0]
            for fn in ("Get-StartGateChecks", "Get-FailedCheckNames"):
                for m in re.finditer(re.escape(fn), code):
                    before = code[max(0, m.start() - 12):m.start()]
                    if re.search(r"function\s+$", before):
                        continue
                    self.assertTrue(before.rstrip().endswith("@("), "%s: %s is not wrapped in @(): ...%s" % (name, fn, before))

    def test_no_function_result_is_counted_without_at_wrapping(self):
        # (Get-X ...).Count on a function result is wrong when the function emits 0 or 1 items; always @(Get-X ...).Count
        for name, src in ALL_PS1.items():
            code = sc.strip_code(src)[0]
            for m in re.finditer(r"(?<!@)\((?:Get|Test|Invoke|Read|New)-[A-Za-z]+[^()\n]*(?:\([^()\n]*\)[^()\n]*)*\)\.Count\b", code):
                self.fail("%s: unwrapped .Count on a function result: %s" % (name, m.group(0)[:80]))

    def test_failed_names_function_builds_strings_only(self):
        body = fn_body(LIB, "Get-FailedCheckNames")
        self.assertIn("[void]$f.Add([string]$c.name)", body)

    def test_static_analyser_rejects_the_r5_return_and_accepts_r6(self):
        bad = "function Get-FailedCheckNames {\n  param($Checks)\n  $f = New-Object System.Collections.ArrayList\n  return ,$f\n}\n"
        good = bad.replace("return ,$f", "return $f")
        for text, expect in ((bad, True), (good, False)):
            found = []
            sc.check_file("X.ps1", text, found)
            self.assertEqual(any("return ,x" in m for (_n, _l, m) in found), expect)

class R6AtomicWrite(unittest.TestCase):
    def test_replace_gets_a_real_dotnet_null(self):
        body = fn_body(RUN, "Write-AtomicText")
        self.assertIn("[System.IO.File]::Replace($tmp, $Path, [NullString]::Value)", body)
        self.assertNotRegex(sc.strip_code(body)[0], r"Replace\([^)]*\$null")
        self.assertLess(body.index("[System.IO.File]::Replace"), body.index("[System.IO.File]::Copy($tmp, $Path, $true)"))
        self.assertIn("[System.IO.File]::Move($tmp, $Path)", body)         # first write: the destination does not exist yet
        self.assertIn("if (Test-Path -LiteralPath $tmp) { [System.IO.File]::Delete($tmp) }", body)

    def test_model_of_the_r5_failure_mode(self):
        # PowerShell converts $null to '' for a [string] .NET parameter; File.Replace treats '' as an illegal path. Only an EXISTING destination reaches Replace.
        def ps_arg_to_string_param(v):
            return "" if v is None else v
        def file_replace(src, dst, backup, dst_exists):
            if backup == "":
                raise ValueError("The path is not of a legal form.")
            return "replaced"
        with self.assertRaises(ValueError):
            file_replace("t", "d", ps_arg_to_string_param(None), True)          # r5: $null
        self.assertEqual(file_replace("t", "d", None, True), "replaced")        # r6: [NullString]::Value is the .NET null, not ''

    def test_static_analyser_rejects_null_to_a_dotnet_method(self):
        for text, expect in (("[System.IO.File]::Replace($a, $b, $null)\n", True), ("[System.IO.File]::Replace($a, $b, [NullString]::Value)\n", False),
                             ("[System.IO.File]::Copy($a, $b, $true)\n", False)):
            found = []
            sc.check_file("X.ps1", text, found)
            self.assertEqual(any("passed to a .NET static method" in m for (_n, _l, m) in found), expect, text)

    def test_no_other_dotnet_call_in_the_package_passes_null(self):
        for name, src in ALL_PS1.items():
            self.assertIsNone(re.search(r"::[A-Za-z]+\([^()\n]*\$null\b", sc.strip_code(src)[0]), name)

    def test_every_state_file_goes_through_the_atomic_writer(self):
        # the files the dry run rewrites repeatedly: lease, marker, outbox results, run report
        for needle in ("Write-AtomicJson $script:Ctx.P.Lease", "Write-AtomicJson $p $next", "Write-AtomicJson (Join-Path $script:Ctx.P.Outbox ($R.id + '.json')) $R"):
            self.assertIn(needle, RUN)
        self.assertIn("Write-AtomicJson (Join-Path $rd 'report.json') $summary", ORCH)

class R6RunOutcome(unittest.TestCase):
    def step(self, typ, status, checks=()):
        return {"type": typ, "status": status, "checks": list(checks)}
    RAM = {"name": "ram", "pass": False, "detail": "available=5.62 need>=6.5", "severity": "fail"}
    PORT = {"name": "port-free", "pass": True, "detail": "port 8080", "severity": "fail"}

    def test_the_exact_owner_scenario_is_a_refusal_not_a_failure(self):
        res = [self.step("preflight", "gate-failed", [self.RAM, self.PORT]), self.step("verify-integrity", "ok"), self.step("server-start", "planned"),
               self.step("health", "planned"), self.step("server-stop", "planned")]
        self.assertEqual(c.run_outcome(res), ("gate-refused", ["preflight: ram [available=5.62 need>=6.5]"]))

    def test_other_outcomes(self):
        self.assertEqual(c.run_outcome([self.step("preflight", "ok"), self.step("server-start", "planned")]), ("ok", []))
        self.assertEqual(c.run_outcome([])[0], "ok")
        self.assertEqual(c.run_outcome([self.step("preflight", "ok"), self.step("health", "failed")])[0], "failed")
        self.assertEqual(c.run_outcome([self.step("preflight", "gate-failed", [self.RAM]), self.step("health", "failed")])[0], "failed")
        self.assertEqual(c.run_outcome([self.step("x", "weird")])[0], "failed")     # an unknown status is never treated as success

    def test_powershell_twin_and_its_test_agree_with_the_oracle(self):
        body = fn_body(LIB, "Get-RunOutcome")
        for lit in ("-ceq 'gate-failed'", "-cne 'ok'", "-cne 'planned'", "'gate-refused'", "'failed'", "-ceq 'fail'"):
            self.assertIn(lit, body)
        self.assertLess(body.index("if ($failed)"), body.index("elseif ($refused.Count -gt 0)"))      # failure wins over refusal
        self.assertIn("(@($o.Refused)[0] -ceq 'preflight: ram [available=5.62 need>=6.5]')", TESTAGENT)
        for chk in ("outcome:gate-refused", "outcome:ok", "outcome:failed", "outcome:failure-wins-over-refusal", "outcome:empty-is-ok"):
            self.assertIn("'" + chk + "'", TESTAGENT)

    def test_orchestrator_cleanly_handles_a_refusal(self):
        code = sc.strip_code(ORCH)[0]
        self.assertIn("try {", ORCH); self.assertIn("} catch {", ORCH); self.assertIn("} finally {", ORCH)
        self.assertIn("RESULT: REFUSED BY A RESOURCE GATE. Nothing was started; the tool itself worked as designed.", ORCH)
        self.assertLess(ORCH.index("} finally {"), ORCH.index("RESULT: REFUSED"))
        self.assertIn("exit 5", ORCH)
        self.assertEqual(len(re.findall(r"\bexit 5\b", code)), 1)
        # the report is written inside its own try/catch so that a writer problem can never replace the clean result by a stack trace
        fin = ORCH[ORCH.index("} finally {"):ORCH.index("RESULT: the run stopped")]
        self.assertIn("Write-AtomicJson (Join-Path $rd 'report.json') $summary", fin)
        self.assertIn("WARNING: the report could not be written", fin)
        self.assertIn("outcome = $(if ($runError) { 'failed' } else { $outcome.Outcome }); refused = $outcome.Refused; error = $runError", fin)
        self.assertEqual(c.AGENT_VERSION, "r8.0")

    def test_exit_code_table_is_documented(self):
        for code_, text in ((0, "RESULT: ok."), (1, "RESULT: failed"), (5, "RESOURCE GATE")):
            self.assertIn(text, ORCH)
        readme = rd("README_FIRST.txt")
        self.assertIn("exit code 5", readme)

class R6AgentLoop(unittest.TestCase):
    def test_one_bad_cycle_does_not_end_the_agent_with_a_raw_exception(self):
        self.assertIn("Add-Audit 'cycle-error'", AGENT)
        self.assertIn("$exitReason = 'cycle-errors'", AGENT)
        self.assertIn("if ($cycleErrors -ge 5)", AGENT)
        self.assertIn("$cycleErrors = 0", AGENT)
        i = AGENT.index("$cycleErrors = 0")
        self.assertLess(AGENT.index("while", i), AGENT.index("Add-Audit 'cycle-error'"))
        self.assertIn("} finally {", AGENT)          # the finally block (stops any server, ends the lease) still runs after the catch

class R6FileOpsTest(unittest.TestCase):
    def test_file_ops_test_is_contained_in_one_temp_folder(self):
        code = sc.strip_code(FILEOPS)[0]
        self.assertIn("[System.IO.Path]::GetTempPath()", FILEOPS)
        self.assertIn("'shords-6c-selftest-' + [guid]::NewGuid()", FILEOPS)
        self.assertEqual(len(re.findall(r"Directory\]::Delete", code)), 1)
        # the one recursive delete is guarded: inside the temp folder AND carrying the test marker AND existing
        self.assertRegex(FILEOPS, r"if \(\$Root\.StartsWith\(\$tempBase, \[System\.StringComparison\]::OrdinalIgnoreCase\) -and \$Root\.Contains\('shords-6c-selftest-'\) -and \(Test-Path -LiteralPath \$Root\)\) \{\s*\n\s*try \{ \[System\.IO\.Directory\]::Delete\(\$Root, \$true\) \}")
        for banned in ("Start-Process", "Process]::Start", "Invoke-WebRequest", "HttpClient", "Add-Type", "Set-ItemProperty", "D:\\llm", "Initialize-JobGuard", "Start-PilotServer", "Invoke-PilotHttp", "New-NetFirewall"):
            self.assertNotIn(banned, code, banned)
        self.assertNotIn("D:\\", code)

    def test_it_covers_the_exact_r5_failure_and_the_surrounding_loop(self):
        for needle in ("Write-AtomicText $f1 'one'", "Write-AtomicText $f1 'two'", "Write-AtomicText $f1 'three'", "Update-Lease 'running'", "Update-DryRunMarker @{ status = 'planned'; type = 'server-stop' }",
                       "Invoke-InboxCycle", "'inbox:bad-signature-rejected'", "'inbox:replay-rejected'", "'atomic:replace-existing'", "'atomic:replace-again'", "'inbox:seen-ids-written'",
                       "'marker:rewritten-and-gate-failed-does-not-count'", "Initialize-PilotContext -Mode 'DryRun'"):
            self.assertIn(needle, FILEOPS, needle)

    def test_it_only_reads_the_machine_state_it_compares_before_and_after(self):
        self.assertIn("$procBefore", FILEOPS); self.assertIn("$procAfter", FILEOPS)
        self.assertIn("Get-NetTCPConnection -LocalPort 8080 -State Listen", FILEOPS)

    def test_only_the_dry_run_mode_is_used(self):
        self.assertNotIn("'Live'", sc.strip_code(FILEOPS)[0]); self.assertNotIn("-Mode 'Live'", FILEOPS)

    def test_signed_job_helper_matches_the_python_signer(self):
        # the helper builds {"schema","id","type","created_utc","expires_utc","params","hmac"} and signs Get-CanonicalJobString with the key text
        self.assertIn("Get-HmacSha256Hex $KeyText (Get-CanonicalJobString $parsed)", FILEOPS)
        job = c.make_job("selftest-health-0002", "health", {"suite": "synthetic3"}, "k" * 64, 1_800_000_000)
        self.assertEqual(job["hmac"], c.sign(job, "k" * 64))
        self.assertEqual(c.validate_job(c.dumps_job(job), "selftest-health-0002", "k" * 64, 1_800_000_010, set())[0], True)
        job = c.make_job("selftest-stop-0001", "server-stop", {}, "k" * 64, 1_800_000_000)
        self.assertEqual(c.validate_job(c.dumps_job(job), "selftest-stop-0001", "k" * 64, 1_800_000_010, set())[0], True)

    def test_new_job_ids_satisfy_the_id_rule(self):
        for i in ("selftest-stop-0001", "selftest-health-0002", "selftest-badsig-0003"):
            self.assertRegex(i, r"\A[a-z0-9][a-z0-9-]{6,63}\Z")


# ---------------------------------------------------------------------------------------------------------------------------------------------
# r7: the completion marker (jobs\dryrun-complete.json). r6 wrote it only after an ACCEPTED job, so a rejection after the last accepted job (the replay,
# 15:57:46Z) and the end of the run never reached it: rejected_seen 8 and last_utc 15:57:42Z against jobs_rejected 9 in the audit log and the lease.
# These tests (a) drive the pure marker logic through a Python model of the agent whose control flow mirrors the PowerShell (checked below against the
# source text), (b) reproduce the r6 behaviour with an r6 policy model, (c) assert the PowerShell call sites. The proof on Windows is
# Test-AgentLogic.ps1 (marker vectors) and Test-FileOps.ps1 (real files, real functions).
import gen_vectors as gv   # noqa: E402

class SimAgent:
    """Python model of one agent run: counters, audit list and the marker file, with the same event order as Phase6C.Runtime.ps1 / Pilot-Agent.ps1.
    policy 'r7': marker on start, every accepted job, every rejection and at the end (with read-back check). policy 'r6': marker only after an accepted job."""
    def __init__(self, store, run_id, clock, policy="r7", version=None):
        self.store, self.run_id, self.clock, self.policy = store, run_id, clock, policy
        self.version = version or c.AGENT_VERSION
        self.done = self.rejected = self.marker_errors = 0
        self.audit = []

    def now(self):
        return self.clock.now_text()

    def _marker(self, event, status="", jtype="", end_reason=""):
        try:
            if self.store.get("fail"):
                raise OSError("The process cannot access the file because it is being used by another process.")
            self.store["marker"] = c.next_marker(self.store.get("marker"), self.version, self.run_id, self.now(), event, status, jtype, self.done, self.rejected, end_reason)
        except OSError as e:
            if self.policy == "r6":
                raise
            self.marker_errors += 1
            self.audit.append(("marker-error", {"marker_event": event, "error": str(e)}))

    def start(self):
        self.audit.append(("agent-start", {"run_id": self.run_id}))
        if self.policy == "r7":
            self._marker("start")

    def accepted(self, status, jtype):
        self.done += 1
        self._marker("job", status, jtype)

    def reject(self, reason="x"):
        self.rejected += 1
        self.audit.append(("job-rejected", {"reason": reason, "ts": self.now()}))
        if self.policy == "r7":
            self._marker("reject")

    def end(self, reason):
        self.audit.append(("agent-end", {"reason": reason, "jobs_done": self.done, "jobs_rejected": self.rejected, "run_id": self.run_id}))
        if self.policy == "r7":
            self._marker("end", end_reason=reason)
            problem = c.marker_problem(self.store.get("marker"), self.run_id, "ended", self.done, self.rejected)
            if problem:
                self.marker_errors += 1
                self.audit.append(("marker-error", {"marker_event": "verify", "error": problem}))

    def exit_code(self):
        return 6 if self.marker_errors else 0

    def records(self, guard=True):
        """The audit lines as Add-Audit would write them (r8 twin c.audit_record; guard=False = the r7 Add-Audit)."""
        return [c.audit_record(ev, "DryRun", data, guard=guard) for ev, data in self.audit]

class Clock:
    def __init__(self, text="2026-11-04T10:00:00Z"):
        import calendar, time
        self.t = calendar.timegm(time.strptime(text, "%Y-%m-%dT%H:%M:%SZ"))

    def advance(self, s):
        self.t += s

    def now_text(self):
        return c.fmt_ts(self.t)

def run_timeline(policy):
    """The supplied r6 audit sequence, played through the model; returns (agent, store)."""
    store, clk = {}, Clock("2026-11-04T15:30:00Z")
    a = SimAgent(store, "sess-20261104-153000-aaaaaa", clk, policy)
    a.start()
    for row in gv.R6_TIMELINE:
        clk.t = c.parse_ts("2026-11-04T" + row[0] + "Z")
        if row[1] == "job":
            a.accepted(row[2], row[3])
        else:
            a.reject("replay" if row[0] == "15:57:46" else "bad")
    return a, store, clk

class R7MarkerBehaviour(unittest.TestCase):
    def test_exact_r6_discrepancy_is_reproduced_by_the_r6_policy(self):
        a, store, clk = run_timeline("r6")
        m = store["marker"]
        self.assertEqual((a.done, a.rejected), (10, 9))                  # what the audit log and the lease said
        self.assertEqual(m["rejected_seen"], 8)                          # what the r6 marker said
        self.assertEqual(m["last_utc"], "2026-11-04T15:57:42Z")
        # the r7 read-back check flags exactly this disagreement between the marker and the run's own counters
        self.assertEqual(c.marker_problem(m, "sess-20261104-153000-aaaaaa", "running", a.done, a.rejected), "rejected-count")
        self.assertEqual(c.marker_problem(m, "sess-20261104-153000-aaaaaa", "ended", a.done, a.rejected), "state")      # and it never says 'ended'
        self.assertNotIn("end", [e for e, _ in a.audit])

    def test_r7_policy_gives_the_final_values_for_the_same_sequence(self):
        a, store, clk = run_timeline("r7")
        clk.t = c.parse_ts("2026-11-04T16:30:00Z")
        a.end("lease-ended")
        m = store["marker"]
        self.assertEqual((m["rejected_seen"], m["jobs_done"]), (9, 10))
        self.assertEqual((m["state"], m["end_reason"], m["ended_utc"]), ("ended", "lease-ended", "2026-11-04T16:30:00Z"))
        self.assertEqual(m["last_utc"], "2026-11-04T16:30:00Z")
        self.assertEqual(m["types_ok"], sorted(c.TYPES))             # all eight job types preserved
        self.assertEqual(a.marker_errors, 0)
        self.assertEqual(c.marker_problem(m, "sess-20261104-153000-aaaaaa", "ended", a.done, a.rejected), "")
        audit_rejections = [x for x in a.audit if x[0] == "job-rejected"]
        self.assertEqual(len(audit_rejections), 9)
        self.assertEqual(audit_rejections[-1][1]["reason"], "replay")
        self.assertEqual(audit_rejections[-1][1]["ts"], "2026-11-04T15:57:46Z")

    def test_marker_is_correct_after_every_event_not_only_at_the_end(self):
        a, store, clk = run_timeline("r7")
        # replay the timeline and compare the marker after every single event with the agent's own counters
        store2, clk2 = {}, Clock("2026-11-04T15:30:00Z")
        b = SimAgent(store2, "sess-20261104-153000-aaaaaa", clk2, "r7")
        b.start()
        for row in gv.R6_TIMELINE:
            clk2.t = c.parse_ts("2026-11-04T" + row[0] + "Z")
            b.accepted(row[2], row[3]) if row[1] == "job" else b.reject()
            m = store2["marker"]
            self.assertEqual((m["rejected_seen"], m["jobs_done"], m["last_utc"]), (b.rejected, b.done, clk2.now_text()))
            self.assertEqual(c.marker_problem(m, b.run_id, "running", b.done, b.rejected), "")

    def test_eight_negative_jobs_give_rejected_seen_8_and_nine_give_9(self):
        for n in (8, 9):
            store, clk = {}, Clock()
            a = SimAgent(store, "sess-20261104-100000-aaaaaa", clk)
            a.start()
            for _ in range(n):
                clk.advance(1)
                a.reject()
            self.assertEqual(store["marker"]["rejected_seen"], n)
            self.assertEqual(a.rejected, n)

    def test_replay_rejection_after_the_last_accepted_job_is_in_the_final_count(self):
        store, clk = {}, Clock()
        a = SimAgent(store, "sess-20261104-100000-aaaaaa", clk)
        a.start(); clk.advance(5); a.accepted("planned", "health"); clk.advance(4); a.reject("replay"); clk.advance(11); a.end("stop-file")
        m = store["marker"]
        self.assertEqual((m["rejected_seen"], m["jobs_done"], m["state"], m["end_reason"]), (1, 1, "ended", "stop-file"))

    def test_marker_timestamp_and_sequence_advance_after_the_final_rejection(self):
        store, clk = {}, Clock()
        a = SimAgent(store, "sess-20261104-100000-aaaaaa", clk)
        a.start(); clk.advance(5); a.accepted("ok", "preflight")
        before = dict(store["marker"])
        clk.advance(4); a.reject("replay")
        after = store["marker"]
        self.assertGreater(after["last_utc"], before["last_utc"])         # ISO-8601 UTC text sorts like time
        self.assertEqual(after["event_seq"], before["event_seq"] + 1)
        # within the same second last_utc can not advance (1-second resolution) but event_seq still does
        store3, clk3 = {}, Clock()
        b = SimAgent(store3, "sess-20261104-100000-aaaaaa", clk3)
        b.start(); b.accepted("ok", "preflight"); s1 = store3["marker"]["event_seq"]; b.reject()
        self.assertEqual(store3["marker"]["event_seq"], s1 + 1)

    def test_natural_lease_expiry_updates_the_marker(self):
        store, clk = {}, Clock("2026-11-04T10:00:00Z")
        a = SimAgent(store, "sess-20261104-100000-aaaaaa", clk)
        lease_end = clk.t + 3600
        a.start()
        reason = "aborted"                       # Pilot-Agent.ps1: stays 'aborted' unless the loop leaves by its own exit
        try:
            while True:
                if clk.t > lease_end:
                    reason = "lease-ended"; break
                clk.advance(600)
        finally:
            a.end(reason)
        self.assertEqual((store["marker"]["state"], store["marker"]["end_reason"]), ("ended", "lease-ended"))

    def test_ctrl_c_runs_the_end_routine_with_the_reason_aborted(self):
        store, clk = {}, Clock()
        a = SimAgent(store, "sess-20261104-100000-aaaaaa", clk)
        a.start(); a.reject()
        reason = "aborted"
        with self.assertRaises(KeyboardInterrupt):
            try:
                raise KeyboardInterrupt()        # Ctrl+C inside the loop: none of the loop's own exits ran
            finally:
                a.end(reason)
        m = store["marker"]
        self.assertEqual((m["state"], m["end_reason"], m["rejected_seen"]), ("ended", "aborted", 1))

    def test_window_close_leaves_a_running_marker_that_says_so(self):
        store, clk = {}, Clock()
        a = SimAgent(store, "sess-20261104-100000-aaaaaa", clk)
        a.start(); a.reject(); a.accepted("ok", "preflight")       # killed here: no finally block runs
        m = store["marker"]
        self.assertEqual(m["state"], "running")                     # not 'ended': a reader can tell the run did not finish cleanly
        self.assertIsNone(m["ended_utc"])

    def test_previous_run_marker_cannot_be_mistaken_for_the_latest_run(self):
        store, clk = {}, Clock()
        a = SimAgent(store, "sess-20261104-100000-aaaaaa", clk)
        a.start(); clk.advance(2); a.accepted("ok", "preflight"); a.reject(); a.reject(); a.end("lease-ended")
        old = dict(store["marker"])
        clk.advance(3600)
        b = SimAgent(store, "sess-20261104-110000-bbbbbb", clk)
        b.start()
        m = store["marker"]
        self.assertEqual((m["run_id"], m["state"], m["rejected_seen"], m["jobs_done"], m["event_seq"]), ("sess-20261104-110000-bbbbbb", "running", 0, 0, 1))
        self.assertEqual(m["types_ok"], ["preflight"])                              # accumulates over runs of the same version
        self.assertEqual(m["first_utc"], old["first_utc"])
        self.assertNotEqual(c.marker_problem(old, b.run_id, "ended", 0, 0), "")     # the old marker is flagged for the new run
        self.assertEqual(c.marker_problem(old, b.run_id, "ended", 0, 0), "run-id")
        self.assertEqual(c.marker_problem(m, b.run_id, "running", 0, 0), "")

    def test_marker_of_another_agent_version_never_counts(self):
        old = {"schema": "shords-pilot-dryrun/1", "agent_version": "r6.0", "first_utc": "2026-11-04T09:00:00Z", "last_utc": "2026-11-04T09:30:00Z",
               "types_ok": sorted(c.TYPES), "rejected_seen": 8}
        m = c.next_marker(old, "r7.0", "sess-20261104-100000-aaaaaa", "2026-11-04T10:00:00Z", "start")
        self.assertEqual((m["types_ok"], m["first_utc"], m["event_seq"]), ([], "2026-11-04T10:00:00Z", 1))

    def test_marker_write_failure_is_surfaced_not_ignored(self):
        store, clk = {}, Clock()
        a = SimAgent(store, "sess-20261104-100000-aaaaaa", clk)
        a.start()
        store["fail"] = True
        clk.advance(3); a.reject("replay"); a.end("lease-ended")
        self.assertGreaterEqual(a.marker_errors, 2)                                  # the write at the rejection and the final write
        self.assertEqual(a.exit_code(), 6)
        self.assertTrue(any(ev == "marker-error" for ev, _ in a.audit))
        self.assertEqual(store["marker"]["state"], "running")                        # the stale marker still says: not finished
        self.assertEqual(c.marker_problem(store["marker"], a.run_id, "ended", a.done, a.rejected), "state")

    def test_r6_policy_would_have_aborted_the_cycle_on_a_write_failure(self):
        store, clk = {"fail": True}, Clock()
        a = SimAgent(store, "sess-20261104-100000-aaaaaa", clk, "r6")
        with self.assertRaises(OSError):
            a.accepted("ok", "preflight")

    def test_old_consumers_still_find_their_fields(self):
        m = c.next_marker(None, "r7.0", "sess-20261104-100000-aaaaaa", "2026-11-04T10:00:00Z", "start")
        for k in ("schema", "agent_version", "first_utc", "last_utc", "types_ok", "rejected_seen"):       # the r6 layout
            self.assertIn(k, m)
        self.assertEqual(m["schema"], "shords-pilot-dryrun/1")
        for k in ("run_id", "state", "event_seq", "run_started_utc", "ended_utc", "end_reason", "jobs_done", "marker_rev"):   # additive
            self.assertIn(k, m)

class R7MarkerSource(unittest.TestCase):
    def test_accepted_and_rejected_jobs_both_update_the_marker(self):
        body = fn_body(RUN, "Invoke-InboxCycle")
        rej = body[body.index("if ($reason) {"):body.index("continue\n    }", body.index("if ($reason) {"))]
        self.assertLess(rej.index("$script:St.JobsRejected = $script:St.JobsRejected + 1"), rej.index("Update-DryRunMarker -Event 'reject'"))
        self.assertLess(rej.index("Add-Audit 'job-rejected'"), rej.index("Update-DryRunMarker -Event 'reject'"))
        self.assertLess(rej.index("Update-DryRunMarker -Event 'reject'"), rej.index("Move-ToFolder $work $p.Rejected"))   # a failing move can not skip it
        self.assertIn("Update-DryRunMarker $res", body)
        self.assertLess(body.index("$res = Invoke-PilotJob $job"), body.index("Update-DryRunMarker $res"))
        self.assertEqual(len(re.findall(r"Update-DryRunMarker", body)), 2)

    def test_update_function_is_atomic_safe_silent_and_failure_aware(self):
        body = fn_body(RUN, "Update-DryRunMarker")
        code = sc.strip_code(body)[0]
        self.assertIn("if ($script:Ctx.Mode -cne 'DryRun') { return }", body)       # Live writes no marker
        self.assertIn("Get-NextMarker -Old $old -Version $script:P6C.Version -RunId $script:St.RunId", body)
        self.assertIn("Write-AtomicJson $p $next", body)                           # the existing safe writer
        self.assertNotIn("WriteAllText", code)
        self.assertRegex(body, r"\} catch \{\s*\n\s*\$script:St\.MarkerErrors = \$script:St\.MarkerErrors \+ 1\s*\n\s*Add-Audit 'marker-error' @\{ marker_event = \$Event; error = \$_\.Exception\.Message \}")
        self.assertNotRegex(code, r"catch\s*\{\s*\}\s*\n\s*\}\s*$")                 # the outer catch is not empty
        self.assertNotRegex(code, r"\breturn\s+[\$@(]")                             # emits no output: InboxCycle's return value is a count
        self.assertEqual(code.count("catch {"), 2)                                   # the unreadable-old-file catch and the failure catch

    def test_confirm_reads_back_and_counts_a_mismatch(self):
        body = fn_body(RUN, "Confirm-DryRunMarker")
        self.assertIn("Get-MarkerProblem $m $script:St.RunId $State ([int]$script:St.JobsDone) ([int]$script:St.JobsRejected)", body)
        self.assertIn("$script:St.MarkerErrors = $script:St.MarkerErrors + 1", body)
        self.assertIn("Add-Audit 'marker-error' @{ marker_event = 'verify'; error = $problem }", body)
        self.assertIn("catch { $problem = 'unreadable' }", body)

    def test_shutdown_routine_order(self):
        body = fn_body(RUN, "Complete-AgentSession")
        order = [body.index(x) for x in ("Add-Audit 'agent-end'", "Update-DryRunMarker -Event 'end' -EndReason $Reason", "Confirm-DryRunMarker 'ended'", "Update-Lease 'ended'")]
        self.assertEqual(order, sorted(order))
        self.assertIn("run_id = $script:St.RunId", body)
        for key in ("reason = $Reason", "jobs_done = $script:St.JobsDone", "jobs_rejected = $script:St.JobsRejected"):    # the existing agent-end fields keep their meaning
            self.assertIn(key, body)

    def test_agent_ends_the_marker_on_every_exit_path(self):
        self.assertIn("$exitReason = 'aborted'", AGENT)
        self.assertIn("{ $exitReason = 'lease-ended'; break }", AGENT)
        self.assertIn("$exitReason = 'stop-file'", AGENT)
        self.assertIn("$exitReason = 'cycle-errors'", AGENT)
        fin = AGENT[AGENT.index("} finally {"):]
        self.assertIn("Complete-AgentSession $exitReason", fin)
        # nested try/finally: the marker is finalised even when stopping the server throws
        self.assertRegex(fin, r"try \{\s*\n\s*if \(\$script:St\.Server\) \{ \[void\]\(Stop-PilotServer \('agent-exit:' \+ \$exitReason\)\) \}\s*\n\s*\} finally \{\s*\n\s*Complete-AgentSession \$exitReason")
        self.assertIn("Update-DryRunMarker -Event 'start'", AGENT)
        self.assertLess(AGENT.index("Add-Audit 'agent-start'"), AGENT.index("Update-DryRunMarker -Event 'start'"))
        self.assertLess(AGENT.index("Update-DryRunMarker -Event 'start'"), AGENT.index("$exitReason = 'aborted'"))
        self.assertIn("run_id = $script:St.RunId", AGENT)
        self.assertIn("if ($script:St.MarkerErrors -gt 0) { exit 6 }", AGENT)
        self.assertIn("WARNING: the dry-run marker could not be written", AGENT)

    def test_orchestrator_starts_and_ends_the_marker_and_surfaces_failures(self):
        self.assertIn("Update-DryRunMarker -Event 'start'", ORCH)
        fin = ORCH[ORCH.index("} finally {"):ORCH.index("RESULT: the run stopped") if "RESULT: the run stopped" in ORCH else len(ORCH)]
        order = [fin.index(x) for x in ("Write-AtomicJson (Join-Path $rd 'report.json') $summary", "Add-Audit 'run-end'", "Update-DryRunMarker -Event 'end' -EndReason $endWhy", "Confirm-DryRunMarker 'ended'")]
        self.assertEqual(order, sorted(order))
        self.assertEqual(len(re.findall(r"\bexit 6\b", sc.strip_code(ORCH)[0])), 2)
        self.assertEqual(len(re.findall(r"\bexit 5\b", sc.strip_code(ORCH)[0])), 1)           # unchanged r6 behaviour
        self.assertLess(ORCH.index("if ($markerBad) { Write-Host $markerLine; exit 6 }"), ORCH.index("exit 5"))
        self.assertIn("RESULT: the steps were ok, but the completion marker is not trustworthy.", ORCH)
        self.assertIn("marker_run_id = $script:St.RunId", ORCH)

    def test_lease_carries_run_id_and_marker_errors(self):
        body = fn_body(RUN, "Update-Lease")
        self.assertIn("run_id = $s.RunId; marker_errors = $s.MarkerErrors", body)
        for old_key in ("jobs_done = $s.JobsDone", "jobs_rejected = $s.JobsRejected", "audit_errors = $s.AuditErrors"):   # unchanged
            self.assertIn(old_key, body)
        init = fn_body(RUN, "Initialize-PilotContext")
        self.assertIn("MarkerErrors = 0; MarkerWrites = 0", init)
        self.assertIn("RunId = ('sess-' + (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss'", init)

    def test_existing_audit_event_fields_are_unchanged_and_new_ones_additive(self):
        # r6 agent-end: reason, jobs_done, jobs_rejected. r7 adds run_id only; agent-start gains run_id; the new event marker-error exists.
        self.assertIn("Add-Audit 'agent-start' @{ version = $script:P6C.Version; pid = $PID; hours = $Hours; ps = $PSVersionTable.PSVersion.ToString(); root = $script:Cfg.Root; run_id = $script:St.RunId }", AGENT)
        self.assertEqual(len(re.findall(r"Add-Audit 'marker-error'", RUN)), 2 + 0)
        self.assertIn("job-rejected", fn_body(RUN, "Invoke-InboxCycle"))
        self.assertIn("Add-Audit 'job-rejected' @{ file = $name; reason = $reason }", RUN)
        # r8: the marker-error data key is marker_event (r7 used 'event', which replaced the record's own event name)
        self.assertEqual(len(re.findall(r"Add-Audit 'marker-error' @\{ marker_event = ", RUN)), 2)

    def test_lib_twin_mirrors_the_python_oracle(self):
        body = fn_body(LIB, "Get-NextMarker")
        m = c.next_marker(None, "r7.0", "sess-x", "2026-11-04T10:00:00Z", "start")
        ps_keys = re.findall(r"(\w+) = ", body[body.index("return [ordered]@{"):])
        self.assertEqual([k for k in ps_keys if k in m], list(m.keys()))           # same fields, same order
        self.assertIn("$script:P6C.MarkerSchema", body); self.assertIn("MarkerSchema     = 'shords-pilot-dryrun/1'", LIB)
        self.assertEqual(c.MARKER_SCHEMA, "shords-pilot-dryrun/1")
        self.assertIn("MarkerRev        = 2", LIB); self.assertEqual(c.MARKER_REV, 2)
        for lit in ("-ceq 'job'", "-ceq 'planned'", "-ceq 'ok'", "-ceq 'end'", "$state = 'running'", "$state = 'ended'", "([string]$Old.run_id -ceq $RunId)", "[int]$Old.event_seq + 1"):
            self.assertIn(lit, body)
        codes_ps = re.findall(r"return '([a-z-]+)'", fn_body(LIB, "Get-MarkerProblem"))
        self.assertEqual(codes_ps, ["missing", "run-id", "state", "rejected-count", "jobs-done-count"])
        src = open(os.path.join(LIN, "pilot_core.py")).read()
        py = src[src.index("def marker_problem"):src.index("# ----", src.index("def marker_problem"))]
        self.assertEqual(re.findall(r'return "([a-z-]+)"', py), codes_ps)

    def test_vectors_file_is_generated_from_the_oracle(self):
        v = json.load(open(os.path.join(VEC, "marker-vectors.json")))
        self.assertEqual(v["version"], c.AGENT_VERSION)
        names = [x["name"] for x in v["sequences"]]
        for needed in ("r6-battery-timeline", "eight-negative-jobs", "nine-negative-jobs", "replay-after-last-accepted-job", "end-lease-ended", "end-aborted",
                       "second-run-does-not-look-like-the-first"):
            self.assertIn(needed, names)
        self.assertIn("marker:' + $seq.name", TESTAGENT)
        self.assertIn("'r6-discrepancy:final-marker'", TESTAGENT)

# r8: the audit record. r7 passed a data key named 'event' to Add-Audit for 'marker-error'; the key replaced the record's own event name, so the line
# said "event":"start" / "event":"verify". Found by the owner on Windows PowerShell 5.1 (Test-FileOps: marker:failed-write-is-audited and
# marker:read-back-flags-the-stale-marker). Neither the Python model of the agent nor the source-text checks modelled Add-Audit itself.
class R8AuditRecord(unittest.TestCase):
    def test_the_r7_defect_is_reproduced_by_the_unguarded_model(self):
        # r7: Add-Audit 'marker-error' @{ event = <start|verify>; error = ... } with the r7 Add-Audit (no guard)
        old = c.audit_record("marker-error", "DryRun", {"event": "start", "error": "locked"}, guard=False)
        self.assertEqual(old["event"], "start")                                    # what the owner's Windows run produced
        old = c.audit_record("marker-error", "DryRun", {"event": "verify", "error": "run-id"}, guard=False)
        self.assertEqual(old["event"], "verify")
        # both Windows failures are the same counting question: audit lines named marker-error
        self.assertEqual(len([r for r in (old,) if r["event"] == "marker-error"]), 0)

    def test_r8_keeps_the_event_name_and_the_marker_event(self):
        new = c.audit_record("marker-error", "DryRun", {"marker_event": "start", "error": "locked"})
        self.assertEqual((new["event"], new["marker_event"], new["mode"]), ("marker-error", "start", "DryRun"))
        self.assertEqual(list(new.keys()), ["ts", "event", "mode", "marker_event", "error"])    # order: ts, event, mode, then the data keys

    def test_guard_renames_reserved_data_keys_in_any_case(self):
        r = c.audit_record("selftest-reserved", "DryRun", {"event": "x", "TS": "y", "mode": "z", "a": 3})
        self.assertEqual((r["event"], r["mode"], r["a"]), ("selftest-reserved", "DryRun", 3))
        self.assertEqual((r["data_event"], r["data_TS"], r["data_mode"]), ("x", "y", "z"))
        self.assertEqual(c.audit_record("e", "m", {"Event": "q"}, guard=False)["event"], "q")   # unguarded + case-insensitive key: still replaced

    def test_failed_write_and_stale_readback_are_audited_as_marker_error_in_the_agent_model(self):
        store, clk = {}, Clock()
        a = SimAgent(store, "sess-20261104-100000-aaaaaa", clk)
        a.start()
        store["fail"] = True
        a.start()                                   # a failing 'start'-like write
        recs = [r for r in a.records() if r["event"] == "marker-error"]
        self.assertEqual(len(recs), 1)
        self.assertEqual(recs[0]["marker_event"], "start")
        # the stale-marker read-back
        store2, clk2 = {}, Clock()
        b = SimAgent(store2, "sess-20261104-100000-bbbbbb", clk2)
        b.start(); b.end("lease-ended")
        store2["marker"]["run_id"] = "sess-20261104-090000-zzzzzz"                  # an earlier run's marker
        problem = c.marker_problem(store2["marker"], b.run_id, "ended", b.done, b.rejected)
        self.assertEqual(problem, "run-id")
        # the same records through the r7 Add-Audit lose the name (what Windows showed)
        c_old = SimAgent({}, "sess-20261104-100000-cccccc", Clock())
        c_old.audit.append(("marker-error", {"event": "verify", "error": "run-id"}))
        self.assertEqual([r["event"] for r in c_old.records(guard=False)], ["verify"])

    def test_no_production_audit_call_uses_a_reserved_key(self):
        for name in ("Phase6B.Common.ps1", "Phase6C.Lib.ps1", "Phase6C.Runtime.ps1", "Pilot-Agent.ps1", "Invoke-PilotRun.ps1", "Rollback-6C.ps1"):
            code = sc.strip_code(rd(name))[0]
            self.assertEqual(sc.audit_reserved_keys(code), [], name)

    def test_the_analyser_rule_detects_the_r7_lines(self):
        for src in ("Add-Audit 'marker-error' @{ event = $Event; error = $_.Exception.Message }", "Add-Audit 'x' @{ a = 1; Mode = 'q' }",
                    "Add-Audit 'x' @{ TS = 1 }"):
            self.assertEqual(len(sc.audit_reserved_keys(sc.strip_code(src)[0])), 1, src)
        for src in ("Add-Audit 'marker-error' @{ marker_event = $Event; error = $x }", "Add-Audit 'job-end' @{ id = $R.id; type = $R.type; status = $R.status }",
                    "Add-Audit 'x' @{ data_event = 1; mode_x = 2; events = 3 }"):
            self.assertEqual(sc.audit_reserved_keys(sc.strip_code(src)[0]), [], src)

    def test_add_audit_source_has_the_guard_and_the_same_field_order(self):
        body = fn_body(RUN, "Add-Audit")
        self.assertIn("$o = [ordered]@{ ts = (Get-Date).ToUniversalTime().ToString('o'); event = $Event; mode = $script:Ctx.Mode }", body)
        for lit in ("($name -ieq 'ts')", "($name -ieq 'event')", "($name -ieq 'mode')", "$name = 'data_' + $name", "$o[$name] = $Data[$k]"):
            self.assertIn(lit, body)
        self.assertEqual(tuple(c.AUDIT_RESERVED), ("ts", "event", "mode"))
        self.assertIn("catch { $script:St.AuditErrors = $script:St.AuditErrors + 1 }", body)        # unchanged: an audit failure never throws into the job loop

    def test_file_ops_checks_parse_the_audit_lines(self):
        for needle in ("function Get-AuditObjects", "'audit:reserved-data-keys-do-not-rename-the-event'", "$_.event -ceq 'marker-error'",
                       "$mErr[0].marker_event -ceq 'start'", "$_.marker_event -ceq 'verify'", "$vErr[0].error -ceq 'run-id'", "Add-Audit 'selftest-reserved' @{ event = 'x'; TS = 'y'; mode = 'z'; a = 3 }",
                       "($resv[0].data_event -ceq 'x') -and ($resv[0].data_TS -ceq 'y') -and ($resv[0].data_mode -ceq 'z')"):
            self.assertIn(needle, FILEOPS, needle)
        self.assertNotIn("-like '*\"event\":\"marker-error\"*'", FILEOPS)                          # the two failing r7 checks no longer match text
        self.assertIn("(Get-AuditTail 3)", FILEOPS)                                              # a failure prints the audit tail as evidence


class R7WindowsTestScript(unittest.TestCase):
    def test_file_ops_covers_the_marker_requirements(self):
        for needle in ("'marker:eight-negative-jobs-give-rejected-seen-8'", "'marker:nine-negative-jobs-give-rejected-seen-9'", "'marker:replay-rejection-is-in-the-final-count-and-advances-the-marker'",
                       "'marker:end-lease-ended'", "'marker:end-aborted-as-on-ctrl-c'", "'marker:previous-run-is-detected-as-not-this-run'", "'marker:failed-write-is-counted'",
                       "'marker:failed-write-is-audited'", "'marker:read-back-flags-the-stale-marker'", "'marker:second-run-starts-clean-but-keeps-the-types'",
                       "Complete-AgentSession 'lease-ended'", "Complete-AgentSession 'aborted'", "[System.IO.FileShare]::None"):
            self.assertIn(needle, FILEOPS, needle)
        # the failure test locks only the marker file inside the temporary root
        self.assertEqual(len(re.findall(r"\[System\.IO\.File\]::Open\(", FILEOPS)), 1)
        self.assertIn("$ctxP.Marker", FILEOPS[FILEOPS.index("[System.IO.File]::Open("):FILEOPS.index("[System.IO.File]::Open(") + 120])

    R6_CHECKS = ['atomic:create', 'atomic:replace-existing', 'atomic:replace-again', 'atomic-json:replace-existing', 'atomic:no-temp-files-left', 'context:folders', 'context:mode-is-exact', 'lease:rewritten-three-times', 'audit:two-json-lines', 'marker:rewritten-and-gate-failed-does-not-count', 'marker:version', 'marker:test-ok-and-missing', 'inbox:three-files-handled', 'inbox:server-stop-planned', 'inbox:health-planned-no-request', 'inbox:bad-signature-rejected', 'inbox:files-moved', 'inbox:seen-ids-written', 'inbox:replay-rejected', 'inbox:test-started-no-process-and-opened-no-port', 'inbox:audit-has-no-error-lines']

    def test_r6_file_ops_checks_are_all_still_present(self):
        # the names of the 22 r6 checks (21 kept as they were; 'inbox:rejected-files-kept' now expects nine rejected files instead of two)
        for name in self.R6_CHECKS:
            self.assertIn("'" + name + "'", FILEOPS, name)
        self.assertIn("'inbox:rejected-files-kept'", FILEOPS)


if __name__ == "__main__":
    unittest.main(verbosity=1)
