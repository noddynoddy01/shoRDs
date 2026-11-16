#!/usr/bin/env python3
"""Generates the cross-language conformance vectors (../vectors/*.json) from pilot_core.py. The same files are checked by
Test-AgentLogic.ps1 on Windows against Phase6C.Lib.ps1. Deterministic. Usage: gen_vectors.py [--check]"""
import copy, hashlib, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import pilot_core as c

VEC = os.path.join(HERE, "..", "vectors")
KEY = hashlib.sha256(b"shords-pilot-test-key-not-a-secret").hexdigest()
OTHER_KEY = hashlib.sha256(b"another-test-key").hexdigest()
NOW = 1793800000  # 2026-11-04T13:46:40Z

def jtext(job):
    return json.dumps(job, separators=(",", ":"), ensure_ascii=True)

def base(jtype, params, jid="job-aaaa-0001", created=NOW - 10, life=600, key=KEY):
    return c.make_job(jid, jtype, params, key, created, life)

def resign(job, key=KEY):
    job = copy.deepcopy(job)
    try:
        job["hmac"] = c.sign(job, key)
    except (ValueError, AttributeError, TypeError):
        pass  # un-signable on purpose (invalid parameter shapes): the agent must reject these before it looks at the signature
    return job

def case(name, text, stem="job-aaaa-0001", now=NOW, seen=(), key=None):
    ok, reason, _ = c.validate_job(text, stem, key or KEY, now, set(seen))
    d = {"name": name, "stem": stem, "now": now, "seen": list(seen), "text": text, "expect": reason}
    if key:
        d["key"] = key
    return d

def job_cases():
    out = []
    valid = {
        "preflight": {"ngl": 8, "ctx": 4096},
        "verify-integrity": {"scope": "quick"},
        "server-start": {"ngl": 8, "ctx": 4096, "idle_minutes": 30},
        "server-stop": {},
        "health": {"suite": "synthetic3"},
        "sweep": {"ngl_list": [8, 12, 16], "ctx_list": [4096], "gen_tokens": 64},
        "run-suite": {"suite": "synthetic-v1", "suite_sha256": "ab" * 32, "max_minutes": 20},
        "collect": {"what": "all"},
    }
    for t, p in valid.items():
        out.append(case("valid-" + t, jtext(base(t, p))))
    out.append(case("valid-ctx8192-ngl20", jtext(base("preflight", {"ngl": 20, "ctx": 8192}))))
    out.append(case("valid-sweep-max-combos", jtext(base("sweep", {"ngl_list": [4, 8, 12, 16], "ctx_list": [4096, 8192], "gen_tokens": 256}))))
    out.append(case("valid-with-bom", "\ufeff" + jtext(base("server-stop", {}))))
    out.append(case("valid-with-whitespace", json.dumps(json.loads(jtext(base("server-stop", {}))), indent=2) + "\r\n"))
    out.append(case("boundary-now-equals-expires", jtext(base("server-stop", {}, created=NOW - 600)), now=NOW - 600 + 600))
    out.append(case("boundary-created-minus-skew", jtext(base("server-stop", {}, created=NOW + 120)), now=NOW))
    out.append(case("not-yet-valid", jtext(base("server-stop", {}, created=NOW + 121)), now=NOW))
    out.append(case("expired", jtext(base("server-stop", {}, created=NOW - 700)), now=NOW))
    out.append(case("replay", jtext(base("server-stop", {})), seen=["job-aaaa-0001"]))
    out.append(case("replay-other-id-ok", jtext(base("server-stop", {})), seen=["job-zzzz-0001"]))
    # structure / json
    good = jtext(base("server-stop", {}))
    out.append(case("size", good[:-1] + " " * 17000 + "}"))
    out.append(case("json-truncated", good[:-5]))
    out.append(case("json-trailing", good + "x"))
    out.append(case("json-not-object", "[1,2]"))
    out.append(case("json-float", good.replace('"params":{}', '"params":{"x":1.5}')))
    out.append(case("json-escape-n", good.replace('"job-aaaa-0001"', '"job\\n-aaaa-0001"')))
    out.append(case("json-non-ascii", good.replace('"server-stop"', '"server-st\u00f6p"')))
    out.append(case("json-duplicate-key", good.replace('{"schema"', '{"type":"x","schema"', 1)))
    out.append(case("json-single-quotes", good.replace('"', "'")))
    out.append(case("json-depth", '{"schema":"x","params":{"a":{"b":{"c":{"d":{"e":1}}}}}}'))
    out.append(case("top-keys-missing-hmac", jtext({k: v for k, v in base("server-stop", {}).items() if k != "hmac"})))
    j = base("server-stop", {}); j2 = dict(j); j2["extra"] = 1
    out.append(case("top-keys-extra", json.dumps(j2, separators=(",", ":"))))
    j = base("server-stop", {}); j["schema"] = "shords-pilot-job/2"
    out.append(case("schema", jtext(resign(j))))
    # id
    for nm, bad in (("uppercase", "JOB-AAAA-0001"), ("short", "job-1"), ("underscore", "job_aaaa_0001"), ("leading-dash", "-job-aaaa-0001"),
                    ("too-long", "j" + "a" * 64), ("traversal", "..-aaaa-0001"), ("space", "job aaaa 0001")):
        j = base("server-stop", {}, jid=bad)
        out.append(case("id-" + nm, jtext(resign(j)), stem=bad))
    j = base("server-stop", {}); j["id"] = 12345678
    out.append(case("id-not-string", json.dumps(j, separators=(",", ":")), stem="12345678"))
    out.append(case("id-name-mismatch", jtext(base("server-stop", {})), stem="job-bbbb-0002"))
    # type
    for nm, bad in (("exec", "exec"), ("shell", "powershell"), ("upper", "Preflight"), ("empty", "")):
        j = base("server-stop", {}); j["type"] = bad
        out.append(case("type-" + nm, jtext(j)))
    j = base("server-stop", {}); j["type"] = 7
    out.append(case("type-not-string", json.dumps(j, separators=(",", ":"))))
    # timestamps
    for nm, f, v in (("no-z", "created_utc", "2026-11-04T13:46:30"), ("month13", "created_utc", "2026-13-04T13:46:30Z"), ("year2023", "created_utc", "2023-11-04T13:46:30Z"),
                     ("feb30", "created_utc", "2026-02-30T13:46:30Z"), ("fraction", "expires_utc", "2026-11-04T13:56:30.5Z"), ("hour25", "expires_utc", "2026-11-04T25:56:30Z"),
                     ("space", "expires_utc", "2026-11-04 13:56:30Z"), ("lowercase", "expires_utc", "2026-11-04t13:56:30z"), ("offset", "expires_utc", "2026-11-04T13:56:30+00:00")):
        j = base("server-stop", {}); j[f] = v
        out.append(case("timestamps-" + nm, jtext(resign(j))))
    j = base("server-stop", {}); j["created_utc"] = 5
    out.append(case("timestamps-not-string", json.dumps(j, separators=(",", ":"))))
    j = base("server-stop", {}, life=0)
    out.append(case("lifetime-zero", jtext(j)))
    j = base("server-stop", {}, life=1801)
    out.append(case("lifetime-too-long", jtext(j)))
    out.append(case("lifetime-max-ok", jtext(base("server-stop", {}, life=1800))))
    j = base("server-stop", {}); j["expires_utc"] = c.fmt_ts(NOW - 100)
    out.append(case("lifetime-negative", jtext(resign(j))))
    # params
    j = base("server-stop", {}); j["params"] = [1]
    out.append(case("params-type-list", jtext(resign(j))))
    j = base("server-stop", {}); j["params"] = "x"
    out.append(case("params-type-string", jtext(resign(j))))
    out.append(case("params-keys-missing", jtext(base("preflight", {"ngl": 8}))))
    out.append(case("params-keys-extra", jtext(base("preflight", {"ngl": 8, "ctx": 4096, "cmd": "calc"}))))
    out.append(case("params-keys-on-stop", jtext(base("server-stop", {"force": True}))))
    out.append(case("params-keys-misspelled", jtext(base("preflight", {"ngl": 8, "cxt": 4096}))))
    pv = [
        ("preflight", {"ngl": 21, "ctx": 4096}, "ngl-21"), ("preflight", {"ngl": -1, "ctx": 4096}, "ngl-neg"), ("preflight", {"ngl": "8", "ctx": 4096}, "ngl-string"),
        ("preflight", {"ngl": True, "ctx": 4096}, "ngl-bool"), ("preflight", {"ngl": [8], "ctx": 4096}, "ngl-list"), ("preflight", {"ngl": None, "ctx": 4096}, "ngl-null"),
        ("preflight", {"ngl": 8, "ctx": 5000}, "ctx-5000"), ("preflight", {"ngl": 8, "ctx": 16384}, "ctx-16384"), ("preflight", {"ngl": 8, "ctx": "4096"}, "ctx-string"),
        ("server-start", {"ngl": 8, "ctx": 4096, "idle_minutes": 4}, "idle-4"), ("server-start", {"ngl": 8, "ctx": 4096, "idle_minutes": 121}, "idle-121"),
        ("verify-integrity", {"scope": "everything"}, "scope-bad"), ("verify-integrity", {"scope": True}, "scope-bool"),
        ("health", {"suite": "other"}, "health-suite"),
        ("run-suite", {"suite": "../x", "suite_sha256": "ab" * 32, "max_minutes": 5}, "suite-traversal"),
        ("run-suite", {"suite": "A", "suite_sha256": "ab" * 32, "max_minutes": 5}, "suite-short"),
        ("run-suite", {"suite": "x" * 42, "suite_sha256": "ab" * 32, "max_minutes": 5}, "suite-long"),
        ("run-suite", {"suite": "good-name", "suite_sha256": "AB" * 32, "max_minutes": 5}, "sha-upper"),
        ("run-suite", {"suite": "good-name", "suite_sha256": "ab" * 31, "max_minutes": 5}, "sha-short"),
        ("run-suite", {"suite": "good-name", "suite_sha256": "ab" * 32, "max_minutes": 0}, "minutes-0"),
        ("run-suite", {"suite": "good-name", "suite_sha256": "ab" * 32, "max_minutes": 121}, "minutes-121"),
        ("collect", {"what": "secrets"}, "collect-what"),
        ("sweep", {"ngl_list": [], "ctx_list": [4096], "gen_tokens": 64}, "sweep-empty"),
        ("sweep", {"ngl_list": [8, 8], "ctx_list": [4096], "gen_tokens": 64}, "sweep-dupe"),
        ("sweep", {"ngl_list": [0, 2, 4, 6, 8, 10, 12], "ctx_list": [4096], "gen_tokens": 64}, "sweep-7"),
        ("sweep", {"ngl_list": [8, 99], "ctx_list": [4096], "gen_tokens": 64}, "sweep-ngl-99"),
        ("sweep", {"ngl_list": [8], "ctx_list": [], "gen_tokens": 64}, "sweep-ctx-empty"),
        ("sweep", {"ngl_list": [8], "ctx_list": [4096, 4096], "gen_tokens": 64}, "sweep-ctx-dupe"),
        ("sweep", {"ngl_list": [8], "ctx_list": [3000], "gen_tokens": 64}, "sweep-ctx-bad"),
        ("sweep", {"ngl_list": [8], "ctx_list": [4096], "gen_tokens": 15}, "sweep-gen-15"),
        ("sweep", {"ngl_list": [8], "ctx_list": [4096], "gen_tokens": 257}, "sweep-gen-257"),
        ("sweep", {"ngl_list": [4, 8, 12, 16, 18, 20], "ctx_list": [4096, 8192], "gen_tokens": 64}, "sweep-combos-12"),
        ("sweep", "notadict", "sweep-params-string"),
    ]
    for t, p, nm in pv:
        j = base(t, {}); j["params"] = p
        out.append(case("params-value-" + nm, jtext(resign(j))))
    # hmac
    j = base("server-stop", {}); j["hmac"] = "xyz"
    out.append(case("hmac-format-short", jtext(j)))
    j = base("server-stop", {}); j["hmac"] = j["hmac"].upper()
    out.append(case("hmac-format-upper", jtext(j)))
    j = base("server-stop", {}); j["hmac"] = j["hmac"][:-1] + ("0" if j["hmac"][-1] != "0" else "1")
    out.append(case("hmac-flipped", jtext(j)))
    out.append(case("hmac-other-key", jtext(base("server-stop", {}, key=OTHER_KEY))))
    j = base("preflight", {"ngl": 8, "ctx": 4096}); j["params"]["ngl"] = 12
    out.append(case("hmac-param-tampered", jtext(j)))
    j = base("preflight", {"ngl": 8, "ctx": 4096}); j["type"] = "server-stop"; j["params"] = {}
    out.append(case("hmac-type-swapped", jtext(j)))
    j = base("server-stop", {}); j["expires_utc"] = c.fmt_ts(NOW + 1700)
    out.append(case("hmac-expiry-extended", jtext(j)))
    return out

def canon_cases():
    out = []
    for t, p in (("server-start", {"ngl": 8, "ctx": 4096, "idle_minutes": 30}), ("sweep", {"ngl_list": [16, 8], "ctx_list": [8192, 4096], "gen_tokens": 64}),
                 ("run-suite", {"suite": "synthetic-v1", "suite_sha256": "cd" * 32, "max_minutes": 7}), ("server-stop", {}), ("verify-integrity", {"scope": "full"})):
        j = base(t, p, jid="canon-case-" + t.replace("-", "")[:8])
        out.append({"text": jtext(j), "canonical": c.canonical_string(j), "hmac": c.sign(j, KEY)})
    return out

def json_cases():
    rows = [
        ("obj-simple", '{"a":1}', False, True), ("obj-empty", "{}", False, True), ("nested", '{"a":{"b":[1,2,{"c":true}]},"d":null}', False, True),
        ("neg-int", '{"a":-5}', False, True), ("zero", '{"a":0}', False, True), ("leading-zero", '{"a":01}', False, False), ("float", '{"a":1.0}', False, False),
        ("exp", '{"a":1e3}', False, False), ("big-int", '{"a":1234567890123456}', False, False), ("max-int", '{"a":123456789012345}', False, True),
        ("escape-quote", '{"a":"x\\"y"}', False, True), ("escape-slash", '{"a":"x\\/y"}', False, True), ("escape-n-strict", '{"a":"x\\ny"}', False, False),
        ("escape-n-rich", '{"a":"x\\ny"}', True, True), ("escape-u-rich", '{"a":"\\u00e9"}', True, True), ("escape-u-bad-rich", '{"a":"\\u00zz"}', True, False),
        ("escape-u-strict", '{"a":"\\u0041"}', False, False), ("raw-newline", '{"a":"x\ny"}', True, False), ("raw-tab", '{"a":"x\ty"}', True, False),
        ("non-ascii-strict", '{"a":"\u00e9"}', False, False), ("non-ascii-rich", '{"a":"\u00e9"}', True, True), ("dup", '{"a":1,"a":2}', True, False),
        ("trailing-comma-obj", '{"a":1,}', False, False), ("trailing-comma-arr", '{"a":[1,]}', False, False), ("missing-colon", '{"a" 1}', False, False),
        ("unterminated", '{"a":"x', False, False), ("top-array", "[1]", False, False), ("top-scalar", "1", False, False), ("empty", "", False, False),
        ("ws-only", "  ", False, False), ("trailing-ws", '{"a":1}  \n', False, True), ("trailing-garbage", '{"a":1} x', False, False),
        ("depth4-ok", '{"a":{"b":{"c":{"d":1}}}}', False, True), ("depth5-strict", '{"a":{"b":{"c":{"d":{"e":1}}}}}', False, False),
        ("depth6-rich-ok", '{"a":{"b":{"c":{"d":{"e":{"f":1}}}}}}', True, True), ("depth7-rich", '{"a":{"b":{"c":{"d":{"e":{"f":{"g":1}}}}}}}', True, False),
        ("literal-typo", '{"a":tru}', False, False), ("bom", "\ufeff" + '{"a":1}', False, True), ("comment", '{"a":1 /*x*/}', False, False),
        ("nan", '{"a":NaN}', False, False), ("single-quote", "{'a':1}", False, False),
    ]
    out = []
    for nm, text, rich, ok in rows:
        try:
            v = c.parse_strict_json(text, rich=rich)
            got = True
        except c.JsonError:
            got = False
        assert got == ok, (nm, got, ok)
        out.append({"name": nm, "text": text, "rich": rich, "ok": ok, "keys": sorted(v.keys()) if ok else None})
    return out

def gate_cases():
    meas = lambda **k: dict(dict(avail_ram_gib=8.5, vram_free_mib=3300, disk_free_gib=120.0, port_free=True, foreign_server=False, own_server=False, exe_ok=True, model_ok=True), **k)
    rows = [("all-good-8-4096", meas(), 8, 4096), ("ram-low", meas(avail_ram_gib=6.4), 8, 4096), ("ram-exact", meas(avail_ram_gib=6.5), 8, 4096),
            ("ram-unknown", meas(avail_ram_gib=None), 8, 4096), ("ram-8192-short", meas(avail_ram_gib=7.6), 8, 8192), ("ram-8192-ok", meas(avail_ram_gib=7.7), 8, 8192),
            ("ram-12288-short", meas(avail_ram_gib=8.8), 8, 12288), ("ram-12288-ok", meas(avail_ram_gib=8.9), 8, 12288),
            ("vram-short-8", meas(vram_free_mib=2057), 8, 4096), ("vram-exact-8", meas(vram_free_mib=2058), 8, 4096),
            ("vram-16-refused", meas(vram_free_mib=3200), 16, 4096), ("vram-16-ok", meas(vram_free_mib=3266), 16, 4096),
            ("vram-20-8192", meas(vram_free_mib=3900), 20, 8192), ("vram-no-smi-ngl0", meas(vram_free_mib=None), 0, 4096), ("vram-no-smi-ngl8", meas(vram_free_mib=None), 8, 4096),
            ("disk-low", meas(disk_free_gib=19.9), 8, 4096), ("disk-exact", meas(disk_free_gib=20.0), 8, 4096), ("disk-unknown", meas(disk_free_gib=None), 8, 4096),
            ("port-busy", meas(port_free=False), 8, 4096), ("foreign", meas(foreign_server=True), 8, 4096), ("own-running", meas(own_server=True), 8, 4096),
            ("exe-bad", meas(exe_ok=False), 8, 4096), ("model-bad", meas(model_ok=False), 8, 4096), ("ngl-out-of-range", meas(), 21, 4096), ("ctx-out-of-range", meas(), 8, 5000),
            ("many-failures", meas(avail_ram_gib=1.0, vram_free_mib=100, disk_free_gib=1, port_free=False, foreign_server=True, own_server=True, exe_ok=False, model_ok=False), 8, 4096)]
    out = []
    for nm, m, ngl, ctx in rows:
        checks = c.start_gate_checks(m, ngl, ctx)
        out.append({"name": nm, "m": m, "ngl": ngl, "ctx": ctx, "failed": c.failed_checks(checks), "names": [x[0] for x in checks]})
    table = []
    for ctx in c.CTX_ALLOWED:
        for ngl in range(0, c.NGL_MAX + 1):
            table.append({"ngl": ngl, "ctx": ctx, "est": c.est_vram_mib(ngl, ctx), "need": c.required_free_vram_mib(ngl, ctx), "ram": c.min_avail_ram_gib(ctx)})
    return {"cases": out, "table": table, "policy": c.POLICY}

def brake_cases():
    ok = dict(stop_file=False, lease_expired=False, listeners_loopback=True, external_conns=0, avail_ram_gib=3.3, vram_used_mib=1613, log_fatal=False, elapsed_s=30, budget_s=300, telemetry_unknown_streak=0, proc_alive=True)
    rows = [("healthy", {}), ("stop-file", {"stop_file": True}), ("lease", {"lease_expired": True}), ("non-loopback", {"listeners_loopback": False}), ("listeners-unknown", {"listeners_loopback": None}),
            ("external", {"external_conns": 1}), ("ram-below", {"avail_ram_gib": 0.99}), ("ram-exact", {"avail_ram_gib": 1.0}), ("ram-unknown", {"avail_ram_gib": None}),
            ("vram-above", {"vram_used_mib": 3701}), ("vram-exact", {"vram_used_mib": 3700}), ("vram-unknown", {"vram_used_mib": None}), ("log-fatal", {"log_fatal": True}),
            ("timeout", {"elapsed_s": 301}), ("timeout-exact", {"elapsed_s": 300}), ("telemetry-4", {"avail_ram_gib": None, "vram_used_mib": None, "telemetry_unknown_streak": 4}),
            ("telemetry-5", {"avail_ram_gib": None, "vram_used_mib": None, "telemetry_unknown_streak": 5}), ("exited", {"proc_alive": False}),
            ("priority-stop-over-ram", {"stop_file": True, "avail_ram_gib": 0.1}), ("priority-ram-over-vram", {"avail_ram_gib": 0.1, "vram_used_mib": 4000}),
            ("priority-nonloopback-over-ram", {"listeners_loopback": False, "avail_ram_gib": 0.1}), ("priority-vram-over-log", {"vram_used_mib": 4000, "log_fatal": True}),
            ("priority-timeout-over-exited", {"elapsed_s": 999, "proc_alive": False})]
    out = []
    for nm, delta in rows:
        s = dict(ok); s.update(delta)
        out.append({"name": nm, "s": s, "expect": c.brake_verdict(s)})
    logs = [("clean", "load_tensors: loaded", False), ("cuda-error", "CUDA error: out of memory", True), ("oom", "ggml_backend_cuda_buffer_type_alloc_buffer: allocating 1 MiB failed\nout of memory", True),
            ("assert", "GGML_ASSERT(x) failed", True), ("alloc", "failed to allocate buffer", True), ("warning-only", "W srv security: no API key", False), ("empty", "", False),
            ("mixed-case", "Out Of Memory", True), ("cudamalloc", "cudaMalloc failed: out of memory", True), ("unrelated", "slot update_slots: id 0 | task 0 | all slots are idle", False)]
    lo = [{"name": n, "text": t, "expect": c.log_has_fatal(t)} for n, t, _ in logs]
    for (n, t, e), r in zip(logs, lo):
        assert r["expect"] == e, n
    addr = [("127.0.0.1", False), ("::1", False), ("0.0.0.0", False), ("::", False), ("", False), ("192.168.1.5", True), ("8.8.8.8", True), ("fe80::1", True), ("10.0.0.2", True)]
    return {"cases": out, "logs": lo, "addresses": [{"a": a, "external": c.is_external_remote(a), "expectExternal": e} for a, e in addr]}

def ts_cases():
    rows = ["2026-11-04T13:46:40Z", "2026-11-04T13:46:40", "2026-13-01T00:00:00Z", "2024-02-29T00:00:00Z", "2025-02-29T00:00:00Z", "2099-12-31T23:59:59Z", "2100-01-01T00:00:00Z",
            "2023-12-31T23:59:59Z", "2026-11-04T24:00:00Z", "2026-11-04T23:60:00Z", "2026-11-04T23:59:60Z", "", "x", "2026-1-4T13:46:40Z", "1970-01-01T00:00:00Z"]
    return [{"s": r, "epoch": c.parse_ts(r)} for r in rows] + [{"fmt": e, "text": c.fmt_ts(e)} for e in (0, NOW, 1893455999)]

def suite_cases():
    item = lambda i="q1": {"id": i, "system": "You are terse.", "user": "Say ready.", "max_tokens": 8}
    ok = {"schema": c.SCHEMA_SUITE, "name": "synthetic-v1", "provenance": "synthetic", "items": [item()]}
    def v(**kw):
        d = copy.deepcopy(ok); d.update(kw); return d
    def big(field, n):
        # large texts are described, not stored: text = pre + "x" * count + post (the checkers rebuild it)
        d = v(items=[dict(item(), **{field: "@@"})])
        t = json.dumps(d, ensure_ascii=True)
        pre, post = t.split("@@")
        reason = c.validate_suite(v(items=[dict(item(), **{field: "x" * n})]))[1]
        return {"pre": pre, "fill": "x", "count": n, "post": post, "expect": reason}
    rows = [("ok", ok), ("licensed-ok", v(provenance="licensed", licence_ref="CC-BY-4.0 / arXiv:0000.00000 / owner-approved 2026-11-04")), ("licensed-no-ref", v(provenance="licensed")),
            ("provenance-bad", v(provenance="scraped")), ("schema-bad", v(schema="x")), ("name-bad", v(name="Bad Name")), ("items-empty", v(items=[])), ("items-not-list", v(items="x")),
            ("items-51", v(items=[item("i%d" % k) for k in range(51)])), ("items-50-ok", v(items=[item("i%d" % k) for k in range(50)])), ("item-extra-key", v(items=[dict(item(), extra=1)])),
            ("item-missing-key", v(items=[{"id": "a", "system": "s", "user": "u"}])), ("item-id-dupe", v(items=[item("a"), item("a")])), ("item-id-bad", v(items=[item("a b")])),
            ("item-tokens-0", v(items=[dict(item(), max_tokens=0)])), ("item-tokens-1025", v(items=[dict(item(), max_tokens=1025)])), ("item-tokens-bool", v(items=[dict(item(), max_tokens=True)]))]
    out = []
    for nm, obj in rows:
        text = json.dumps(obj, ensure_ascii=True)
        out.append({"name": nm, "text": text, "expect": c.validate_suite_text(text)[1]})
    for nm, field, n in (("item-user-long", "user", 40001), ("item-user-max-ok", "user", 40000), ("item-system-long", "system", 20001)):
        g = big(field, n); g["name"] = nm; out.append(g)
    out.append({"name": "not-json", "text": "{", "expect": "suite-json"})
    out.append({"name": "escapes-ok", "text": json.dumps(v(items=[dict(item(), user="line1\nline2 \u00e9 \"quoted\"")]), ensure_ascii=True), "expect": "ok"})
    return out

def args_cases():
    return [{"model": "D:\\llm\\models\\Qwen3-8B-Q4_K_M.gguf", "ngl": ngl, "ctx": ctx, "key_file": "D:\\llm\\secrets\\server.key",
             "args": c.server_args("D:\\llm\\models\\Qwen3-8B-Q4_K_M.gguf", ngl, ctx, "D:\\llm\\secrets\\server.key")} for ngl, ctx in ((8, 4096), (0, 4096), (16, 8192))]

def _run(name, run_id, steps, old=None, version=None):
    """steps: dicts {event, now, [status, type, end_reason, run_id, version]} plus the run's counters, which are tracked here exactly as the agent tracks them
    (JobsDone +1 per accepted job, JobsRejected +1 per rejection). The expected marker after every step is computed by pilot_core.next_marker()."""
    version = version or c.AGENT_VERSION
    out, prev, done, rej = [], old, 0, 0
    for st in steps:
        if st["event"] == "job":
            done += 1
        elif st["event"] == "reject":
            rej += 1
        rid = st.get("run_id", run_id)
        ver = st.get("version", version)
        if "run_id" in st:
            done, rej = st.get("jobs_done", 0), st.get("jobs_rejected", 0)
        m = c.next_marker(prev, ver, rid, st["now"], st["event"], st.get("status", ""), st.get("type", ""), done, rej, st.get("end_reason", ""))
        out.append({"event": st["event"], "now": st["now"], "status": st.get("status", ""), "type": st.get("type", ""), "end_reason": st.get("end_reason", ""),
                    "run_id": rid, "version": ver, "jobs_done": done, "jobs_rejected": rej, "expect": m})
        prev = m
    return {"name": name, "old": old, "steps": out}

R6_TIMELINE = [("15:54:10", "job", "ok", "preflight"), ("15:54:25", "job", "ok", "verify-integrity"), ("15:54:40", "reject"), ("15:54:55", "job", "planned", "server-start"),
               ("15:55:10", "reject"), ("15:55:25", "job", "planned", "server-stop"), ("15:55:40", "reject"), ("15:55:55", "job", "planned", "health"),
               ("15:56:10", "reject"), ("15:56:25", "job", "planned", "sweep"), ("15:56:40", "reject"), ("15:56:55", "job", "planned", "run-suite"),
               ("15:57:05", "reject"), ("15:57:15", "job", "ok", "collect"), ("15:57:25", "reject"), ("15:57:32", "job", "ok", "preflight"),
               ("15:57:37", "reject"), ("15:57:42", "job", "planned", "health"), ("15:57:46", "reject")]

def marker_cases():
    """The supplied r6 audit sequence (10 jobs done, 9 rejections, the 9th = the replay at 15:57:46Z, lease ended) and the neighbouring cases. Only 15:57:42
    (last accepted job = the r6 marker's last_utc) and 15:57:46 (replay) are real; the other times are illustrative."""
    day = "2026-11-04T"
    A, B = "sess-20261104-153000-aaaaaa", "sess-20261104-170000-bbbbbb"
    seqs = []
    steps = [{"event": "start", "now": day + "15:30:00Z"}]
    for row in R6_TIMELINE:
        steps.append({"event": row[1], "now": day + row[0] + "Z", "status": row[2] if len(row) > 2 else "", "type": row[3] if len(row) > 3 else ""})
    steps.append({"event": "end", "now": day + "16:30:00Z", "end_reason": "lease-ended"})
    seqs.append(_run("r6-battery-timeline", A, steps))
    seqs.append(_run("eight-negative-jobs", A, [{"event": "start", "now": day + "10:00:00Z"}] + [{"event": "reject", "now": day + "10:00:%02dZ" % (i + 1)} for i in range(8)]))
    seqs.append(_run("nine-negative-jobs", A, [{"event": "start", "now": day + "10:00:00Z"}] + [{"event": "reject", "now": day + "10:00:%02dZ" % (i + 1)} for i in range(9)]))
    seqs.append(_run("replay-after-last-accepted-job", A, [{"event": "start", "now": day + "10:00:00Z"}, {"event": "job", "now": day + "10:00:05Z", "status": "planned", "type": "health"},
                                                           {"event": "reject", "now": day + "10:00:09Z"}, {"event": "end", "now": day + "10:00:20Z", "end_reason": "stop-file"}]))
    for reason in ("lease-ended", "stop-file", "cycle-errors", "aborted"):
        seqs.append(_run("end-" + reason, A, [{"event": "start", "now": day + "10:00:00Z"}, {"event": "job", "now": day + "10:00:05Z", "status": "ok", "type": "preflight"},
                                              {"event": "end", "now": day + "10:00:07Z", "end_reason": reason}]))
    seqs.append(_run("gate-failed-and-failed-do-not-count", A, [{"event": "start", "now": day + "10:00:00Z"}, {"event": "job", "now": day + "10:00:02Z", "status": "gate-failed", "type": "preflight"},
                                                                {"event": "job", "now": day + "10:00:03Z", "status": "failed", "type": "health"}, {"event": "job", "now": day + "10:00:04Z", "status": "planned", "type": "server-stop"}]))
    # a second run: counters, state and run_id belong to the NEW run at once; types_ok and first_utc carry over (same agent version)
    first = _run("x", A, [{"event": "start", "now": day + "10:00:00Z"}, {"event": "job", "now": day + "10:00:05Z", "status": "ok", "type": "preflight"}, {"event": "reject", "now": day + "10:00:06Z"},
                          {"event": "end", "now": day + "10:00:09Z", "end_reason": "lease-ended"}])
    seqs.append(_run("second-run-does-not-look-like-the-first", B, [{"event": "start", "now": day + "11:00:00Z"}, {"event": "job", "now": day + "11:00:05Z", "status": "planned", "type": "health"}],
                     old=first["steps"][-1]["expect"]))
    # another agent version, and a marker without run_id (the r6 layout with the current version string): nothing carries over / the run counts as new
    old_other = dict(first["steps"][-1]["expect"], agent_version="r6.0")
    seqs.append(_run("marker-of-another-version-is-ignored", B, [{"event": "start", "now": day + "11:00:00Z"}], old=old_other))
    legacy = {"schema": "shords-pilot-dryrun/1", "agent_version": c.AGENT_VERSION, "first_utc": day + "09:00:00Z", "last_utc": day + "09:30:00Z", "types_ok": ["collect", "health"], "rejected_seen": 8}
    seqs.append(_run("marker-without-run-id-starts-a-new-run", B, [{"event": "job", "now": day + "11:00:05Z", "status": "planned", "type": "sweep"}], old=legacy))
    good = first["steps"][-1]["expect"]
    probs = [("matches", good, A, "ended", 1, 1, ""), ("missing", None, A, "ended", 1, 1, "missing"), ("other-run", good, B, "ended", 1, 1, "run-id"),
             ("still-running", dict(good, state="running"), A, "ended", 1, 1, "state"), ("r6-discrepancy-8-vs-9", dict(good, rejected_seen=8), A, "ended", 1, 9, "rejected-count"),
             ("jobs-done-differs", dict(good, jobs_done=9), A, "ended", 10, 1, "jobs-done-count")]
    return {"version": c.AGENT_VERSION, "sequences": seqs,
            "problems": [{"name": n, "marker": m, "run_id": r, "state": st, "jobs_done": d, "jobs_rejected": j, "expect": e} for (n, m, r, st, d, j, e) in probs]}

def build():
    return {
        "job-vectors.json": {"key": KEY, "otherKey": OTHER_KEY, "now": NOW, "cases": job_cases()},
        "canon-vectors.json": {"key": KEY, "cases": canon_cases()},
        "json-vectors.json": {"cases": json_cases()},
        "gate-vectors.json": gate_cases(),
        "brake-vectors.json": brake_cases(),
        "ts-vectors.json": {"cases": ts_cases()},
        "suite-vectors.json": {"cases": suite_cases()},
        "args-vectors.json": {"cases": args_cases()},
        "marker-vectors.json": marker_cases(),
    }

def main():
    files = build()
    # suite cases: the reason for non-JSON text is computed here
    check = "--check" in sys.argv
    bad = 0
    for name, obj in files.items():
        text = json.dumps(obj, indent=1, sort_keys=True, ensure_ascii=True) + "\n"
        p = os.path.join(VEC, name)
        if check:
            if not os.path.exists(p) or open(p, encoding="ascii", newline="").read() != text:
                print("DIFFERS", name); bad += 1
        else:
            os.makedirs(VEC, exist_ok=True)
            with open(p, "w", encoding="ascii", newline="\n") as f:
                f.write(text)
            print("wrote", name, len(text), "bytes")
    return 1 if bad else 0

if __name__ == "__main__":
    sys.exit(main())
