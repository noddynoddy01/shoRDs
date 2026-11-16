#!/usr/bin/env python3
"""Linux/cloud-side submitter for the Phase 6C mailbox agent. Writes SIGNED job files into <root>/jobs/inbox and reads results from
<root>/jobs/outbox. It never runs anything on Windows by itself: the jobs only do something when the owner's Pilot-Agent.ps1 window is open.
Root is the connected D:\\llm folder as seen from the device shell (default: $PILOT_ROOT or ~/mnt/llm). Standard library only.

  pilot_submit.py status
  pilot_submit.py make-suite --out PATH            writes the synthetic suite and prints its SHA-256
  pilot_submit.py submit TYPE [k=v ...] [--wait S] sign and submit one job (lists as 1,2,3)
  pilot_submit.py battery [--wait S]               the supervised dry-run battery: every job type + negative tests, with expected outcomes
"""
import argparse, hashlib, json, os, secrets, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import pilot_core as c

def root_dir(a):
    return a or os.environ.get("PILOT_ROOT") or os.path.expanduser("~/mnt/llm")

def paths(root):
    j = os.path.join(root, "jobs")
    return {"jobs": j, "inbox": os.path.join(j, "inbox"), "outbox": os.path.join(j, "outbox"), "rejected": os.path.join(j, "rejected"),
            "key": os.path.join(j, ".session-key"), "lease": os.path.join(j, "agent.lease.json"), "suites": os.path.join(root, "suites")}

def read_key(p):
    with open(p["key"], "r", encoding="ascii") as f:
        k = f.read().strip()
    if not c.HEX64_RE.fullmatch(k):
        raise SystemExit("session key has an unexpected format; is the agent running?")
    return k

def new_id(tag):
    return "job-%s-%s-%s" % (time.strftime("%Y%m%d-%H%M%S", time.gmtime()), tag, secrets.token_hex(2))

def write_inbox(p, job_id, text):
    final = os.path.join(p["inbox"], job_id + ".json")
    tmp = final + ".tmp"
    with open(tmp, "w", encoding="ascii", newline="\n") as f:
        f.write(text)
    os.replace(tmp, final)
    return final

def wait_result(p, job_id, seconds):
    deadline = time.time() + seconds
    names = (job_id + ".json", "rejected-" + job_id + ".json")
    while time.time() < deadline:
        for n in names:
            fp = os.path.join(p["outbox"], n)
            if os.path.exists(fp):
                time.sleep(0.2)
                with open(fp, "r", encoding="utf-8-sig") as f:
                    return json.load(f)
        time.sleep(1.0)
    return None

def synthetic_suite():
    """Synthetic fixtures only (no paper, no real text). Provenance 'synthetic'."""
    passage = ("The Larkfield bakery recalibrates its oven every Monday. The target temperature is 220 degrees. After calibration the oven held 219 to 221 degrees "
               "across three test loaves, and the crust colour matched the reference chart. The calibration takes forty minutes.")
    sections = "1 Introduction\\nThe bakery tests ovens.\\n2 Method\\nThree loaves were baked after calibration.\\n3 Results\\nTemperatures stayed within one degree.\\n4 Limitations\\nOnly one oven was tested."
    items = [
        {"id": "summary-2s", "system": "You write short factual summaries.", "user": "Summarise in two sentences: " + passage, "max_tokens": 120},
        {"id": "claims-list", "system": "You list only claims that are stated in the text, one per line, no extras.", "user": "List the claims: " + passage, "max_tokens": 160},
        {"id": "section-titles", "system": "You list section titles only.", "user": "List the section titles of this text, one per line:\n" + sections.replace("\\n", "\n"), "max_tokens": 60},
        {"id": "number-fact", "system": "You answer with a number only.", "user": "According to this text, how many test loaves were baked? " + passage + " Three test loaves were baked.", "max_tokens": 8},
        {"id": "unsupported-check", "system": "Answer SUPPORTED or NOT SUPPORTED only.", "user": "Text: " + passage + "\nStatement: The oven is recalibrated every Friday.", "max_tokens": 8},
        {"id": "terse", "system": "You are a terse assistant.", "user": "Reply with the single word: ready.", "max_tokens": 8},
    ]
    return {"schema": c.SCHEMA_SUITE, "name": "synthetic-v1", "provenance": "synthetic", "items": items}

def suite_bytes():
    return (json.dumps(synthetic_suite(), indent=1, sort_keys=True, ensure_ascii=True) + "\n").encode("ascii")

def parse_kv(items):
    out = {}
    for it in items:
        k, _, v = it.partition("=")
        if v in ("true", "false"):
            out[k] = (v == "true")
        elif "," in v or v.startswith("["):
            out[k] = [int(x) if x.lstrip("-").isdigit() else x for x in v.strip("[]").split(",") if x != ""]
        elif v.lstrip("-").isdigit():
            out[k] = int(v)
        else:
            out[k] = v
    return out

def cmd_status(a):
    p = paths(root_dir(a.root))
    print("root:", root_dir(a.root))
    if os.path.exists(p["lease"]):
        print(open(p["lease"], encoding="utf-8-sig").read())
    else:
        print("no lease file: the agent has not been started")
    for k in ("inbox", "outbox", "rejected"):
        d = p[k]
        print(k, len(os.listdir(d)) if os.path.isdir(d) else "missing")
    return 0

def cmd_make_suite(a):
    b = suite_bytes()
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "wb") as f:
        f.write(b)
    print("wrote", a.out, len(b), "bytes; sha256", hashlib.sha256(b).hexdigest())
    return 0

def submit_one(p, key, jtype, params, wait, lifetime=600, tag=None, now=None):
    jid = new_id(tag or jtype.replace("-", "")[:6])
    job = c.make_job(jid, jtype, params, key, int(now if now is not None else time.time()), lifetime)
    write_inbox(p, jid, c.dumps_job(job))
    return jid, (wait_result(p, jid, wait) if wait else None)

def cmd_submit(a):
    p = paths(root_dir(a.root))
    key = read_key(p)
    jid, res = submit_one(p, key, a.type, parse_kv(a.params), a.wait)
    print("submitted", jid)
    if res is not None:
        print(json.dumps(res, indent=1)[:6000])
    return 0

def expect_ok(res, allowed):
    return res is not None and res.get("status") in allowed

def cmd_battery(a):
    """Supervised dry-run battery. Returns 0 when every expectation holds."""
    p = paths(root_dir(a.root))
    key = read_key(p)
    os.makedirs(p["suites"], exist_ok=True)
    sb = suite_bytes()
    sp = os.path.join(p["suites"], "synthetic-v1.json")
    with open(sp, "wb") as f:
        f.write(sb)
    sha = hashlib.sha256(sb).hexdigest()
    now = int(time.time())
    rows = []
    positives = [
        ("preflight", {"ngl": 8, "ctx": 4096}, ("ok", "gate-failed")),
        ("verify-integrity", {"scope": "quick"}, ("ok",)),
        ("verify-integrity", {"scope": "runtime"}, ("ok",)),
        ("server-start", {"ngl": 8, "ctx": 4096, "idle_minutes": 30}, ("planned", "gate-failed")),
        ("server-stop", {}, ("planned",)),
        ("health", {"suite": "synthetic3"}, ("planned",)),
        ("sweep", {"ngl_list": [8, 12], "ctx_list": [4096], "gen_tokens": 64}, ("planned",)),
        ("run-suite", {"suite": "synthetic-v1", "suite_sha256": sha, "max_minutes": 20}, ("planned",)),
        ("collect", {"what": "all"}, ("ok",)),
    ]
    for jtype, params, allowed in positives:
        jid, res = submit_one(p, key, jtype, params, a.wait, now=now)
        good = expect_ok(res, allowed)
        rows.append(("POS " + jtype + " " + json.dumps(params)[:60], "/".join(allowed), (res or {}).get("status", "NO RESULT"), good))
    # negative tests: each must be REJECTED with the stated reason (the agent writes outbox/rejected-<id>.json)
    def neg(name, text, jid, reason):
        write_inbox(p, jid, text)
        res = wait_result(p, jid, a.wait)
        got = (res or {}).get("error") if res and res.get("status") == "rejected" else (res or {}).get("status", "NO RESULT")
        rows.append(("NEG " + name, "rejected:" + reason, got, got == reason))
    j = c.make_job(new_id("badh"), "server-stop", {}, key, now); j["hmac"] = j["hmac"][:-1] + ("0" if j["hmac"][-1] != "0" else "1")
    neg("tampered signature", json.dumps(j, separators=(",", ":")), j["id"], "hmac")
    j = c.make_job(new_id("othk"), "server-stop", {}, secrets.token_hex(32), now)
    neg("signed with another key", c.dumps_job(j), j["id"], "hmac")
    j = c.make_job(new_id("expd"), "server-stop", {}, key, now - 4000, 600)
    neg("expired job", c.dumps_job(j), j["id"], "expired")
    j = c.make_job(new_id("badt"), "server-stop", {}, key, now); j["type"] = "run-shell"
    neg("unknown job type", json.dumps(j, separators=(",", ":")), j["id"], "type")
    j = c.make_job(new_id("xtra"), "preflight", {"ngl": 8, "ctx": 4096, "cmd": "calc.exe"}, key, now)
    neg("extra parameter (command text)", c.dumps_job(j), j["id"], "params-keys")
    j = c.make_job(new_id("ngl9"), "preflight", {"ngl": 99, "ctx": 4096}, key, now)
    neg("ngl out of range (signed)", c.dumps_job(j), j["id"], "params-value:ngl")
    j = c.make_job(new_id("trav"), "run-suite", {"suite": "../secrets/server", "suite_sha256": "0" * 64, "max_minutes": 5}, key, now)
    neg("suite name with path traversal (signed)", c.dumps_job(j), j["id"], "params-value:suite")
    neg("malformed JSON", "{not json", new_id("junk"), "json")
    jid = new_id("repl")
    j = c.make_job(jid, "server-stop", {}, key, now)
    write_inbox(p, jid, c.dumps_job(j)); first = wait_result(p, jid, a.wait)
    try:
        os.remove(os.path.join(p["outbox"], jid + ".json"))
    except OSError:
        pass
    neg("replay of an already used id", c.dumps_job(j), jid, "replay") if first else rows.append(("NEG replay (first run missing)", "-", "NO RESULT", False))
    bad = [r for r in rows if not r[3]]
    w = max(len(r[0]) for r in rows)
    for r in rows:
        print(("OK   " if r[3] else "FAIL ") + r[0].ljust(w) + "  expected " + r[1].ljust(28) + " got " + str(r[2]))
    print("battery:", len(rows) - len(bad), "of", len(rows), "as expected")
    return 1 if bad else 0

def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=None)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status")
    m = sub.add_parser("make-suite"); m.add_argument("--out", required=True)
    s = sub.add_parser("submit"); s.add_argument("type"); s.add_argument("params", nargs="*"); s.add_argument("--wait", type=int, default=0)
    b = sub.add_parser("battery"); b.add_argument("--wait", type=int, default=90)
    a = ap.parse_args(argv)
    return {"status": cmd_status, "make-suite": cmd_make_suite, "submit": cmd_submit, "battery": cmd_battery}[a.cmd](a)

if __name__ == "__main__":
    sys.exit(main())
