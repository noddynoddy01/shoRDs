#!/usr/bin/env python3
"""Reference implementation (Linux/cloud side) of the Phase 6C file-mailbox job protocol.

This module is the ORACLE for the Windows PowerShell 5.1 agent: Phase6C.Lib.ps1 re-implements the same pure functions, and the
shared conformance vectors in ../vectors/ are generated here and re-checked by Test-AgentLogic.ps1 on Windows.
It is also the signing side used by pilot_submit.py. Standard library only. Nothing here talks to a network or starts a process.
"""
import calendar, hashlib, hmac, json, re, time

AGENT_VERSION = "r4.0"
SCHEMA_JOB = "shords-pilot-job/1"
SCHEMA_RESULT = "shords-pilot-result/1"
SCHEMA_SUITE = "shords-pilot-suite/1"
TYPES = ("preflight", "verify-integrity", "server-start", "server-stop", "health", "sweep", "run-suite", "collect")
CTX_ALLOWED = (4096, 8192, 12288)
NGL_MAX = 20
MAX_LIFETIME_S = 1800
CLOCK_SKEW_S = 120
MAX_JOB_BYTES = 16384
ID_RE = re.compile(r"[a-z0-9][a-z0-9-]{6,63}")
TS_RE = re.compile(r"([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})Z")
SUITE_NAME_RE = re.compile(r"[a-z0-9][a-z0-9_-]{1,40}")
HEX64_RE = re.compile(r"[0-9a-f]{64}")
TOP_KEYS = ("schema", "id", "type", "created_utc", "expires_utc", "params", "hmac")

# ---- resource policy (identical constants live in Phase6C.Lib.ps1; vectors check both) ----
POLICY = {
    "vram_hard_limit_mib": 3700,     # emergency brake while the server runs
    "vram_margin_mib": 250,          # extra free VRAM required at start
    "ram_floor_gib": 1.0,            # emergency brake (loading and serving)
    "ram_base_gib": 6.5,             # minimum available RAM at start for ctx 4096
    "ram_per_4096_ctx_gib": 1.2,     # added per extra 4096 of context
    "disk_min_gib": 20,
    "port": 8080,
}

# ------------------------------------------------------------------------------------------------ strict JSON (control files)
class JsonError(ValueError):
    pass

def parse_strict_json(text, rich=False):
    """Strict JSON used for control files. rich=False (job files): strings are printable ASCII with only the escapes \\" \\\\ \\/ ; nesting at most 4 deep.
    rich=True (suite files): any character from U+0020 up, plus the escapes \\b \\f \\n \\r \\t \\uXXXX; nesting at most 6 deep.
    Both: one top-level object, integers up to 15 digits (no floats/exponents), true/false/null, duplicate keys refused, nothing after the value."""
    if text.startswith("\ufeff"):
        text = text[1:]
    pos = [0]
    n = len(text)

    def ws():
        while pos[0] < n and text[pos[0]] in " \t\r\n":
            pos[0] += 1

    def val(depth):
        if depth > (6 if rich else 4):
            raise JsonError("depth")
        ws()
        if pos[0] >= n:
            raise JsonError("eof")
        c = text[pos[0]]
        if c == "{":
            pos[0] += 1
            d = {}
            ws()
            if pos[0] < n and text[pos[0]] == "}":
                pos[0] += 1
                return d
            while True:
                ws()
                k = string()
                ws()
                if pos[0] >= n or text[pos[0]] != ":":
                    raise JsonError("colon")
                pos[0] += 1
                if k in d:
                    raise JsonError("duplicate-key")
                d[k] = val(depth + 1)
                ws()
                if pos[0] >= n:
                    raise JsonError("eof")
                if text[pos[0]] == ",":
                    pos[0] += 1
                    continue
                if text[pos[0]] == "}":
                    pos[0] += 1
                    return d
                raise JsonError("object")
        if c == "[":
            pos[0] += 1
            a = []
            ws()
            if pos[0] < n and text[pos[0]] == "]":
                pos[0] += 1
                return a
            while True:
                a.append(val(depth + 1))
                ws()
                if pos[0] >= n:
                    raise JsonError("eof")
                if text[pos[0]] == ",":
                    pos[0] += 1
                    continue
                if text[pos[0]] == "]":
                    pos[0] += 1
                    return a
                raise JsonError("array")
        if c == '"':
            return string()
        for lit, v in (("true", True), ("false", False), ("null", None)):
            if text.startswith(lit, pos[0]):
                pos[0] += len(lit)
                return v
        m = re.compile(r"-?(0|[1-9][0-9]{0,14})").match(text, pos[0])
        if m:
            nxt = text[m.end():m.end() + 1]
            if nxt and nxt in ".eE0123456789":
                raise JsonError("number")
            pos[0] = m.end()
            return int(m.group(0))
        raise JsonError("token")

    def string():
        if pos[0] >= n or text[pos[0]] != '"':
            raise JsonError("string")
        pos[0] += 1
        out = []
        while True:
            if pos[0] >= n:
                raise JsonError("string-eof")
            c = text[pos[0]]
            pos[0] += 1
            if c == '"':
                return "".join(out)
            if c == "\\":
                if pos[0] >= n:
                    raise JsonError("escape")
                e = text[pos[0]]
                pos[0] += 1
                if e in '"\\/':
                    out.append(e)
                    continue
                if rich and e in "bfnrt":
                    out.append({"b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t"}[e])
                    continue
                if rich and e == "u":
                    hx = text[pos[0]:pos[0] + 4]
                    if not re.fullmatch(r"[0-9a-fA-F]{4}", hx):
                        raise JsonError("escape")
                    pos[0] += 4
                    out.append(chr(int(hx, 16)))
                    continue
                raise JsonError("escape")
            if ord(c) < 32 or (not rich and ord(c) > 126):
                raise JsonError("char")
            out.append(c)

    ws()
    if pos[0] >= n or text[pos[0]] != "{":
        raise JsonError("top-level")
    v = val(0)
    ws()
    if pos[0] != n:
        raise JsonError("trailing")
    return v

# ------------------------------------------------------------------------------------------------ canonical form + HMAC
def _is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)

def _canon_value(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if _is_int(v):
        return str(v)
    if isinstance(v, str):
        return v
    if isinstance(v, list):
        return ",".join(_canon_value(x) for x in v)
    raise ValueError("unsupported value")

def canonical_string(job):
    lines = [job["schema"], "id=" + job["id"], "type=" + job["type"], "created=" + job["created_utc"], "expires=" + job["expires_utc"]]
    for k in sorted(job["params"].keys()):
        lines.append("p." + k + "=" + _canon_value(job["params"][k]))
    return "\n".join(lines)

def sign(job, key_text):
    return hmac.new(key_text.encode("ascii"), canonical_string(job).encode("ascii"), hashlib.sha256).hexdigest()

def parse_ts(s):
    m = TS_RE.fullmatch(s) if isinstance(s, str) else None
    if not m:
        return None
    y, mo, d, h, mi, se = (int(x) for x in m.groups())
    if not (2024 <= y <= 2099):
        return None
    try:
        t = time.struct_time((y, mo, d, h, mi, se, 0, 0, 0))
        e = calendar.timegm(t)
        if time.gmtime(e)[:6] != (y, mo, d, h, mi, se):
            return None
        return e
    except (ValueError, OverflowError):
        return None

def fmt_ts(epoch):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(epoch))

# ------------------------------------------------------------------------------------------------ parameter specs
def _chk_int(lo, hi):
    return lambda v: _is_int(v) and lo <= v <= hi
def _chk_enum_int(allowed):
    return lambda v: _is_int(v) and v in allowed
def _chk_bool(v):
    return isinstance(v, bool)
def _chk_enum_str(allowed):
    return lambda v: isinstance(v, str) and v in allowed
def _chk_int_list(lo, hi, nmin, nmax, allowed=None):
    def f(v):
        if not isinstance(v, list) or not (nmin <= len(v) <= nmax):
            return False
        if not all(_is_int(x) and lo <= x <= hi and (allowed is None or x in allowed) for x in v):
            return False
        return len(set(v)) == len(v)
    return f

PARAM_SPECS = {
    "preflight": {"ngl": _chk_int(0, NGL_MAX), "ctx": _chk_enum_int(CTX_ALLOWED)},
    "verify-integrity": {"scope": _chk_enum_str(("quick", "runtime", "full"))},
    "server-start": {"ngl": _chk_int(0, NGL_MAX), "ctx": _chk_enum_int(CTX_ALLOWED), "idle_minutes": _chk_int(5, 120)},
    "server-stop": {},
    "health": {"suite": _chk_enum_str(("synthetic3",))},
    "sweep": {"ngl_list": _chk_int_list(0, NGL_MAX, 1, 6), "ctx_list": _chk_int_list(4096, 12288, 1, 3, CTX_ALLOWED), "gen_tokens": _chk_int(16, 256)},
    "run-suite": {"suite": lambda v: isinstance(v, str) and bool(SUITE_NAME_RE.fullmatch(v)),
                  "suite_sha256": lambda v: isinstance(v, str) and bool(HEX64_RE.fullmatch(v)),
                  "max_minutes": _chk_int(1, 120)},
    "collect": {"what": _chk_enum_str(("logs", "reports", "all"))},
}

def sweep_combo_count(params):
    return len(params["ngl_list"]) * len(params["ctx_list"])

def validate_job(raw_text, file_stem, key_text, now_epoch, seen_ids):
    """Returns (ok, reason, job). reason is a stable code; the PowerShell agent must return the same code for the same input."""
    if len(raw_text.encode("utf-8", "replace")) > MAX_JOB_BYTES:
        return False, "size", None
    try:
        job = parse_strict_json(raw_text)
    except JsonError:
        return False, "json", None
    if sorted(job.keys()) != sorted(TOP_KEYS):
        return False, "top-keys", None
    if job["schema"] != SCHEMA_JOB:
        return False, "schema", None
    jid = job["id"]
    if not isinstance(jid, str) or not ID_RE.fullmatch(jid):
        return False, "id", None
    if jid != file_stem:
        return False, "id-name-mismatch", None
    if not isinstance(job["type"], str) or job["type"] not in TYPES:
        return False, "type", None
    c = parse_ts(job["created_utc"])
    e = parse_ts(job["expires_utc"])
    if c is None or e is None:
        return False, "timestamps", None
    if e <= c or e - c > MAX_LIFETIME_S:
        return False, "lifetime", None
    params = job["params"]
    if not isinstance(params, dict):
        return False, "params-type", None
    spec = PARAM_SPECS[job["type"]]
    if sorted(params.keys()) != sorted(spec.keys()):
        return False, "params-keys", None
    for k in sorted(spec.keys()):
        if not spec[k](params[k]):
            return False, "params-value:" + k, None
    if job["type"] == "sweep" and sweep_combo_count(params) > 8:
        return False, "params-value:combos", None
    if now_epoch > e:
        return False, "expired", None
    if now_epoch < c - CLOCK_SKEW_S:
        return False, "not-yet-valid", None
    h = job["hmac"]
    if not isinstance(h, str) or not HEX64_RE.fullmatch(h):
        return False, "hmac-format", None
    if not hmac.compare_digest(h, sign(job, key_text)):
        return False, "hmac", None
    if jid in seen_ids:
        return False, "replay", None
    return True, "ok", job

def make_job(job_id, jtype, params, key_text, created_epoch, lifetime_s=600):
    job = {"schema": SCHEMA_JOB, "id": job_id, "type": jtype, "created_utc": fmt_ts(created_epoch),
           "expires_utc": fmt_ts(created_epoch + lifetime_s), "params": params}
    job["hmac"] = sign(job, key_text)
    return job

def dumps_job(job):
    order = ("schema", "id", "type", "created_utc", "expires_utc", "params", "hmac")
    return json.dumps({k: job[k] for k in order}, separators=(",", ":"), ensure_ascii=True)

# ------------------------------------------------------------------------------------------------ gates (pure)
def est_vram_mib(ngl, ctx):
    return 600 + 135 * ngl + (ctx // 256) * ngl

def required_free_vram_mib(ngl, ctx):
    return est_vram_mib(ngl, ctx) + POLICY["vram_margin_mib"]

def min_avail_ram_gib(ctx):
    return round(POLICY["ram_base_gib"] + POLICY["ram_per_4096_ctx_gib"] * (ctx - 4096) / 4096.0, 2)

def start_gate_checks(m, ngl, ctx):
    """m keys: avail_ram_gib, vram_free_mib (None = nvidia-smi unavailable), disk_free_gib, port_free, foreign_server, own_server,
    exe_ok, model_ok. Returns a list of (name, passed, detail) in a fixed order."""
    out = []
    out.append(("params-in-range", ngl in range(0, NGL_MAX + 1) and ctx in CTX_ALLOWED, "ngl=%d ctx=%d" % (ngl, ctx)))
    out.append(("exe-matches-record", bool(m["exe_ok"]), ""))
    out.append(("model-matches-record", bool(m["model_ok"]), ""))
    need_ram = min_avail_ram_gib(ctx)
    r = m["avail_ram_gib"]
    out.append(("ram", r is not None and r >= need_ram, "available=%s need>=%s" % (r, need_ram)))
    if m["vram_free_mib"] is None:
        out.append(("vram", ngl == 0, "nvidia-smi unavailable; only ngl=0 allowed"))
    else:
        need = required_free_vram_mib(ngl, ctx)
        out.append(("vram", m["vram_free_mib"] >= need, "free=%s need>=%s est=%s" % (m["vram_free_mib"], need, est_vram_mib(ngl, ctx))))
    d = m["disk_free_gib"]
    out.append(("disk", d is not None and d >= POLICY["disk_min_gib"], "free=%s need>=%s" % (d, POLICY["disk_min_gib"])))
    out.append(("port-free", bool(m["port_free"]), "port %d" % POLICY["port"]))
    out.append(("no-foreign-server", not m["foreign_server"], ""))
    out.append(("no-own-server", not m["own_server"], ""))
    return out

def failed_checks(checks):
    return [n for (n, p, _d) in checks if not p]

# ------------------------------------------------------------------------------------------------ emergency brake (pure)
FATAL_LOG_PATTERNS = ("cuda error", "out of memory", "failed to allocate", "ggml_assert", "cudamalloc failed", "ggml_cuda_init: failed", "unable to allocate")

def log_has_fatal(text):
    t = (text or "").lower()
    return any(p in t for p in FATAL_LOG_PATTERNS)

def brake_verdict(s):
    """s keys: stop_file, lease_expired, listeners_loopback (True/False/None), external_conns, avail_ram_gib (None unknown),
    vram_used_mib (None unknown), log_fatal, elapsed_s, budget_s, telemetry_unknown_streak, proc_alive.
    Returns the first trigger name or None. The agent stops the server and verifies port closure whenever this returns a name."""
    if s["stop_file"]:
        return "stop-file"
    if s["lease_expired"]:
        return "lease-expired"
    if s["listeners_loopback"] is False:
        return "non-loopback-listener"
    if s["external_conns"] > 0:
        return "external-connection"
    if s["avail_ram_gib"] is not None and s["avail_ram_gib"] < POLICY["ram_floor_gib"]:
        return "ram-low"
    if s["vram_used_mib"] is not None and s["vram_used_mib"] > POLICY["vram_hard_limit_mib"]:
        return "vram-high"
    if s["log_fatal"]:
        return "server-log-fatal"
    if s["elapsed_s"] > s["budget_s"]:
        return "job-timeout"
    if s["telemetry_unknown_streak"] >= 5:
        return "telemetry-lost"
    if not s["proc_alive"]:
        return "server-exited"
    return None

def is_loopback_address(a):
    return a in ("127.0.0.1", "::1")

def is_external_remote(a):
    """Remote address of an ESTABLISHED connection that counts as external (anything but loopback or the unspecified address)."""
    return a not in ("127.0.0.1", "::1", "0.0.0.0", "::", "")

# ------------------------------------------------------------------------------------------------ server command line (pure)
def server_args(model_path, ngl, ctx, key_file):
    return ["--model", model_path, "--host", "127.0.0.1", "--port", str(POLICY["port"]), "--alias", "qwen3-8b", "--ctx-size", str(ctx),
            "--parallel", "1", "--n-gpu-layers", str(ngl), "--jinja", "--api-key-file", key_file, "--no-webui", "--no-slots",
            "--cors-origins", "http://127.0.0.1:%d" % POLICY["port"], "--no-cors-credentials"]

# ------------------------------------------------------------------------------------------------ suite files
def validate_suite(obj):
    """Suite files are data for the local model. Returns (ok, reason)."""
    if not isinstance(obj, dict) or obj.get("schema") != SCHEMA_SUITE:
        return False, "suite-schema"
    if not isinstance(obj.get("name"), str) or not SUITE_NAME_RE.fullmatch(obj["name"]):
        return False, "suite-name"
    if obj.get("provenance") not in ("synthetic", "licensed"):
        return False, "suite-provenance"
    if obj["provenance"] == "licensed" and not (isinstance(obj.get("licence_ref"), str) and 3 <= len(obj["licence_ref"]) <= 200):
        return False, "suite-licence-ref"
    items = obj.get("items")
    if not isinstance(items, list) or not (1 <= len(items) <= 50):
        return False, "suite-items"
    seen = set()
    total = 0
    for it in items:
        if not isinstance(it, dict) or sorted(it.keys()) != ["id", "max_tokens", "system", "user"]:
            return False, "suite-item-keys"
        if not isinstance(it["id"], str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,40}", it["id"]) or it["id"] in seen:
            return False, "suite-item-id"
        seen.add(it["id"])
        if not isinstance(it["system"], str) or not isinstance(it["user"], str) or len(it["system"]) > 20000 or len(it["user"]) > 40000:
            return False, "suite-item-text"
        total += len(it["system"]) + len(it["user"])
        if not _is_int(it["max_tokens"]) or not (1 <= it["max_tokens"] <= 1024):
            return False, "suite-item-max-tokens"
    if total > 400000:
        return False, "suite-too-large"
    return True, "ok"


def validate_suite_text(text):
    """Parse (rich strict JSON) then validate. Returns (ok, reason); unparsable text -> suite-json."""
    try:
        obj = parse_strict_json(text, rich=True)
    except JsonError:
        return False, "suite-json"
    return validate_suite(obj)
