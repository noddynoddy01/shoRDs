#!/usr/bin/env python3
"""Static checks for the Phase 6C PowerShell sources (no PowerShell is available in the sandbox, so this is NOT a substitute for
Parse-Check.ps1 / Test-AgentLogic.ps1 on Windows; it catches the classes of mistake that are visible without running anything).
Usage: ps_static_check.py [DIR]   exit 0 = no findings."""
import os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DIR = os.path.join(HERE, "..")

def strip_code(text):
    """Returns (code, strings): code has comments removed and string/here-string contents replaced by 'S' so that only code remains;
    positions are preserved. strings is a list of (start, end, kind) for the string literals."""
    out = list(text)
    strings = []
    i, n = 0, len(text)
    def blank(a, b):
        for k in range(a, b):
            if out[k] not in "\r\n":
                out[k] = " "
    while i < n:
        c = text[i]
        if c == "<" and text.startswith("<#", i):
            j = text.find("#>", i + 2)
            j = n if j < 0 else j + 2
            blank(i, j); i = j; continue
        if c == "#":
            j = text.find("\n", i)
            j = n if j < 0 else j
            blank(i, j); i = j; continue
        if c == "@" and i + 1 < n and text[i + 1] in "'\"" and text[i + 2:i + 3] in ("\r", "\n"):
            q = text[i + 1]
            m = re.compile(r"\n" + q + "@").search(text, i + 2)
            j = n if not m else m.end()
            strings.append((i, j, "here" + q))
            blank(i + 2, j - 2 if m else j); i = j; continue
        if c == "'":
            j = i + 1
            while j < n:
                if text[j] == "'":
                    if text[j + 1:j + 2] == "'":
                        j += 2; continue
                    break
                j += 1
            strings.append((i, j + 1, "'"))
            blank(i + 1, j); i = j + 1; continue
        if c == '"':
            j = i + 1
            depth = 0
            while j < n:
                ch = text[j]
                if ch == "`":
                    j += 2; continue
                if ch == "$" and text[j + 1:j + 2] == "(":
                    depth += 1; j += 2; continue
                if depth and ch == ")":
                    depth -= 1; j += 1; continue
                if ch == '"' and depth == 0:
                    if text[j + 1:j + 2] == '"':
                        j += 2; continue
                    break
                j += 1
            strings.append((i, j + 1, '"'))
            blank(i + 1, j); i = j + 1; continue
        if c == "`":
            i += 2; continue
        i += 1
    return "".join(out), strings

def balanced(code):
    pairs = {")": "(", "]": "[", "}": "{"}
    stack = []
    line = 1
    for ch in code:
        if ch == "\n":
            line += 1
        if ch in "([{":
            stack.append((ch, line))
        elif ch in ")]}":
            if not stack or stack[-1][0] != pairs[ch]:
                return "unbalanced %s at line %d" % (ch, line)
            stack.pop()
    if stack:
        return "unclosed %s from line %d" % (stack[-1][0], stack[-1][1])
    return None

BANNED = [
    (r"\?\?", "PowerShell 7 null-coalescing"), (r"\?\.", "PowerShell 7 null-conditional"), (r"&&", "PowerShell 7 pipeline chain"),
    (r"\|\|", "PowerShell 7 pipeline chain"), (r"\s\?\s[^\n]*\s:\s", "ternary operator (PowerShell 7)"), (r"-Parallel\b", "ForEach-Object -Parallel"),
    (r"-AsHashtable\b", "ConvertFrom-Json -AsHashtable (PowerShell 6+)"), (r"-AsByteStream\b", "PowerShell 6+ parameter"), (r"\bJoin-String\b", "PowerShell 6+ cmdlet"),
    (r"\bTest-Json\b", "PowerShell 6+ cmdlet"), (r"::new\(", "::new() (avoid; use New-Object)"), (r"ConvertFrom-Json[^\n|]*-Depth", "ConvertFrom-Json -Depth does not exist in 5.1"),
    (r"-Encoding\s+utf8(NoBOM|BOM)", "PowerShell 6+ encoding name"), (r"\bGet-Content\b[^\n]*-Tail\b[^\n]*-Wait", "tailing"),
    (r"\bInvoke-Expression\b|\biex\b", "dynamic code"), (r"\bInvoke-WebRequest\b|\bInvoke-RestMethod\b|\bcurl(\.exe)?\b|\bwget\b|\bWebClient\b|\bBITS\b|Start-BitsTransfer", "network client other than the loopback HttpClient"),
    (r"HttpListener|TcpListener|System\.Net\.Sockets", "opens or uses sockets"), (r"Set-ExecutionPolicy|Set-NetFirewall|New-NetFirewall|netsh|Add-MpPreference|Set-MpPreference|Disable-NetAdapter|Set-NetConnection", "security/network setting"),
    (r"\bschtasks\b|Register-ScheduledTask|New-ScheduledTask|New-Service|\bsc\.exe\b|Set-Service|\bsetx\b", "persistent configuration"),
    (r"HKLM:|HKCU:|New-ItemProperty|Set-ItemProperty|Remove-ItemProperty|\breg(\.exe)?\s+(add|delete)", "registry write"),
    (r"Invoke-Command|Enter-PSSession|New-PSSession|Start-Job|Start-ThreadJob|\bwinrm\b|\bssh(\.exe)?\b|Enable-PSRemoting", "remote execution / background jobs"),
    (r"-Recurse\b", "recursive operation"), (r"SetEnvironmentVariable\s*\([^)]*'(Machine|User)'", "persistent environment change"),
    (r"\bRead-Host\b[^\n]*-AsSecureString|Get-Credential|ConvertTo-SecureString", "credential handling"), (r"\bStop-Computer\b|\bRestart-Computer\b|\bformat-volume\b", "system action"),
    # r6 (found by the owner's Windows run of r5): both of these only misbehave in the real PowerShell runtime, so the Python mirrors could not see them
    (r"\breturn\s+,\s*[\$\(@]", "'return ,x' wraps the value in a one-element array, so a collection travels as ONE object (r5 printed System.Collections.ArrayList): return the items and let the caller wrap with @()"),
    (r"::[A-Za-z]+\([^()\n]*\$null\b[^()\n]*\)", "$null passed to a .NET static method: PowerShell turns it into an EMPTY STRING for a string parameter (r5: File.Replace -> 'The path is not of a legal form'); use [NullString]::Value or leave the argument out"),
]

# files in which comparison operators must be case-sensitive (a mistake there can let "Preflight" pass a lower-case check)
STRICT_CASE_FILES = ("Phase6C.Lib.ps1",)

def check_file(path, text, findings):
    name = os.path.basename(path)
    code, strings = strip_code(text)
    if any(ord(ch) > 127 for ch in text):
        findings.append((name, 0, "non-ASCII character"))
    b = balanced(code)
    if b:
        findings.append((name, 0, b))
    for pat, why in BANNED:
        for m in re.finditer(pat, code):
            ln = code.count("\n", 0, m.start()) + 1
            findings.append((name, ln, "banned construct: " + why + " : " + code[m.start():m.start() + 40].strip()))
    for m in re.finditer(r"Write-Host\s+('[^'\n]*'|\"[^\"\n]*\")\s*\+", text):
        findings.append((name, text.count("\n", 0, m.start()) + 1, "Write-Host with a bare + (the plus becomes a second argument): wrap in parentheses"))
    for m in re.finditer(r"\bswitch\b\s*(?!-CaseSensitive|-Regex|-Wildcard)\(", code):
        if name in STRICT_CASE_FILES or "Runtime" in name:
            findings.append((name, code.count("\n", 0, m.start()) + 1, "switch without -CaseSensitive"))
    if name in STRICT_CASE_FILES:
        for m in re.finditer(r"\s-(match|notmatch|contains|notcontains|in|notin|like|notlike|replace|split)\b", code):
            lstart = text.rfind("\n", 0, m.start()) + 1
            if "# lint-ok" in text[lstart:text.find("\n", m.start())]:
                continue
            findings.append((name, code.count("\n", 0, m.start()) + 1, "case-insensitive operator " + m.group(0).strip() + " in a validator file"))
        for m in re.finditer(r"\s-(eq|ne)\s+(\$script:P6C\.(SchemaJob|SchemaSuite)|\$Stem|\$Type)\b", code):
            findings.append((name, code.count("\n", 0, m.start()) + 1, "case-insensitive string compare " + m.group(0).strip()))
        # any -eq/-ne whose right-hand side is a string literal (strings were blanked to spaces: look at the raw text)
        for m in re.finditer(r"\s-(eq|ne)\s+'", text):
            findings.append((name, text.count("\n", 0, m.start()) + 1, "case-insensitive compare with a string literal: use -ceq/-cne"))
    if "Runtime" in name or name.startswith(("Pilot-Agent", "Invoke-PilotRun")):
        for m in re.finditer(r"\s-(eq|ne)\s+'", text):
            line = text[text.rfind("\n", 0, m.start()) + 1:text.find("\n", m.start())]
            if "# lint-ok" in line:
                continue
            findings.append((name, text.count("\n", 0, m.start()) + 1, "case-insensitive compare with a string literal: use -ceq/-cne (or add # lint-ok): " + line.strip()[:70]))

def defined_functions(code):
    return {m.group(1): m.start() for m in re.finditer(r"(?m)^\s*function\s+([A-Za-z][A-Za-z0-9_-]*)\b", code)}

def function_bodies(code):
    out = {}
    for m in re.finditer(r"(?m)^\s*function\s+([A-Za-z][A-Za-z0-9_-]*)\b[^{]*\{", code):
        i = m.end() - 1
        depth = 0
        for j in range(i, len(code)):
            if code[j] == "{":
                depth += 1
            elif code[j] == "}":
                depth -= 1
                if depth == 0:
                    out[m.group(1)] = (m.start(), i, j + 1)
                    break
    return out

KNOWN_CMDLETS = set("""
Add-Type Add-Content Get-ChildItem Get-Command Get-Content Get-CimInstance Get-Date Get-FileHash Get-Item Get-ItemProperty Get-NetTCPConnection Get-NetFirewallRule
Get-Process Join-Path Measure-Object Move-Item New-Item New-Object Out-Null Read-Host Remove-Item Resolve-Path Select-Object Select-String Sort-Object Split-Path
Start-Process Start-Sleep Stop-Process Test-Path Where-Object ForEach-Object Write-Host ConvertFrom-Json ConvertTo-Json Get-Variable Set-Variable Write-Output
Get-NetFirewallRule Write-Error Write-Warning Format-Table Out-String
""".split())
AUTO_VARS = set("""_ true false null args PID PSScriptRoot PSVersionTable ErrorActionPreference input matches Error MyInvocation LASTEXITCODE env script PSCmdlet this
Host StackTrace ExecutionContext ProgressPreference WarningPreference VerbosePreference ConfirmPreference PSBoundParameters foreach switch""".split())

def verb_noun_calls(code):
    return sorted({m.group(1) for m in re.finditer(r"(?<![\w$.\-:'\"])((?:Get|Set|New|Add|Remove|Test|Invoke|Write|Read|Start|Stop|Wait|Update|Initialize|Confirm|Move|Format|Resolve|Select|Sort|Out|Measure|Where|ForEach|Join|Split|Convert|ConvertTo|ConvertFrom|Take|Skip|Show|Enter|Exit|Clear)-[A-Z][A-Za-z0-9]*)\b", code)})

def check_package(directory):
    findings = []
    texts = {}
    for f in sorted(os.listdir(directory)):
        if f.endswith(".ps1"):
            texts[f] = open(os.path.join(directory, f), encoding="ascii", errors="replace", newline="").read()
    allcode = {f: strip_code(t)[0] for f, t in texts.items()}
    for f, t in texts.items():
        check_file(os.path.join(directory, f), t, findings)
    defs = {}
    for f, c in allcode.items():
        for fn in defined_functions(c):
            defs.setdefault(fn, f)
    # every Verb-Noun token is a defined function or a known cmdlet
    for f, c in allcode.items():
        for call in verb_noun_calls(c):
            if call not in defs and call not in KNOWN_CMDLETS:
                findings.append((f, 0, "call to unknown command " + call))
    # parameter names used in named calls to our own functions exist
    params = {}
    for f, c in allcode.items():
        for fn, (s, ob, e) in function_bodies(c).items():
            m = re.search(r"param\s*\(", c[ob:e])
            if m:
                k = ob + m.end() - 1
                depth = 0
                for j in range(k, e):
                    if c[j] == "(":
                        depth += 1
                    elif c[j] == ")":
                        depth -= 1
                        if depth == 0:
                            params[fn] = set(x.lower() for x in re.findall(r"\$([A-Za-z_][A-Za-z0-9_]*)", c[k:j])); break
    OPS = {"eq", "ne", "gt", "lt", "ge", "le", "and", "or", "not", "band", "bor", "bxor", "join", "ceq", "cne", "cmatch", "cnotmatch", "ccontains", "cnotcontains",
           "is", "isnot", "match", "notmatch", "contains", "notcontains", "in", "notin", "like", "replace", "split", "f", "as", "cin", "xor", "shl", "shr", "cgt", "clt", "cge", "cle"}
    for f, c in allcode.items():
        for ln, line in enumerate(c.split("\n"), 1):
            if line.lstrip().startswith("function "):
                continue
            for m in re.finditer(r"(?<![\w$.\-:])([A-Z][A-Za-z]+-[A-Z][A-Za-z0-9]*)(?=[ \t]|$)", line):
                fn = m.group(1)
                if fn not in params or fn in KNOWN_CMDLETS:
                    continue
                rest = line[m.end():]
                cut = len(rest)
                for ch in "|;(){}":
                    k = rest.find(ch)
                    if k >= 0:
                        cut = min(cut, k)
                for nm in re.findall(r"(?:^|[ \t])-([A-Za-z]+)(?=[ \t:]|$)", rest[:cut]):
                    if nm.lower() in OPS or nm.lower() in params[fn] or nm.lower() in {"verbose", "erroraction", "whatif", "confirm"}:
                        continue
                    findings.append((f, ln, "named parameter -%s is not a parameter of %s" % (nm, fn)))
    # variables read but never assigned inside a function (typo finder; approximate)
    script_assigned = set()
    for f, c in allcode.items():
        script_assigned |= set(x.lower() for x in re.findall(r"\$script:([A-Za-z_][A-Za-z0-9_]*)", c))
        script_assigned |= set(x.lower() for x in re.findall(r"(?m)^\$([A-Za-z_][A-Za-z0-9_]*)\s*=", c))
    for f, c in allcode.items():
        for fn, (s, ob, e) in function_bodies(c).items():
            body = c[ob:e]
            assigned = set(params.get(fn, set()))
            assigned |= set(x.lower() for x in re.findall(r"\$([A-Za-z_][A-Za-z0-9_]*)\s*(?:\+|-|\*|/)?=(?!=)", body))
            assigned |= set(x.lower() for x in re.findall(r"foreach\s*\(\s*\$([A-Za-z_][A-Za-z0-9_]*)\s+in", body))
            assigned |= set(x.lower() for x in re.findall(r"for\s*\(\s*\$([A-Za-z_][A-Za-z0-9_]*)\s*=", body))
            assigned |= set(x.lower() for x in re.findall(r"\[(?:ref|out)\]\s*\$([A-Za-z_][A-Za-z0-9_]*)", body))
            assigned |= set(x.lower() for x in re.findall(r"-(?:OutVariable|ErrorVariable)\s+([A-Za-z_]+)", body))
            for m in re.finditer(r"(?<![\w:])\$([A-Za-z_][A-Za-z0-9_]*)\b(?!\s*:)", body):
                v = m.group(1).lower()
                if v in assigned or v in {a.lower() for a in AUTO_VARS}:
                    continue
                # property names after a dot or script-scope names are not locals
                if body[max(0, m.start() - 1):m.start()] in (":", "."):
                    continue
                if v in script_assigned:
                    continue
                findings.append((f, code_line(c, ob + m.start()), "variable $%s is read in %s() but never assigned" % (m.group(1), fn)))
    coll, leak_by_lib = scope_collisions(allcode, texts)
    findings.extend(coll)
    for f, c in allcode.items():
        leak = leak_by_lib.get(f, set())
        if not leak:
            continue
        for fn, (s_, ob, e) in function_bodies(c).items():
            body = c[ob:e]
            assigned = set(params.get(fn, set()))
            assigned |= set(x.lower() for x in re.findall(r"\bparam\s*\(([^)]*)\)", body) and re.findall(r"\$([A-Za-z_][A-Za-z0-9_]*)", " ".join(re.findall(r"\bparam\s*\(([^)]*)\)", body))))
            assigned |= set(x.lower() for x in re.findall(ASSIGN_RX, body))
            assigned |= set(x.lower() for x in re.findall(r"foreach\s*\(\s*\$([A-Za-z_][A-Za-z0-9_]*)\s+in", body))
            assigned |= set(x.lower() for x in re.findall(r"for\s*\(\s*\$([A-Za-z_][A-Za-z0-9_]*)\s*=", body))
            for m in re.finditer(r"(?<![\w:])\$([A-Za-z_][A-Za-z0-9_]*)\b(?!\s*:)", body):
                v = m.group(1).lower()
                if v in assigned or v in {a.lower() for a in AUTO_VARS} or body[max(0, m.start() - 1):m.start()] in (":", "."):
                    continue
                if v in leak:
                    findings.append((f, code_line(c, ob + m.start()), "dynamic-scope leak: %s() reads $%s without declaring it, so it would see the script-level variable of the calling script" % (fn, m.group(1))))
    return findings


ASSIGN_RX = r"\$(?:script:)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:\+|-|\*|/)?=(?!=)"

def blank_functions(code):
    """Code with every function body blanked out (what remains runs in the caller's / script scope)."""
    out = list(code)
    for fn, (s_, ob, e) in function_bodies(code).items():
        for i in range(ob, e):
            if out[i] != "\n":
                out[i] = " "
    return "".join(out)

def param_block_span(code):
    m = re.search(r"(?m)^\s*param\s*\(", blank_functions(code))
    if not m:
        return None
    k = m.end() - 1
    depth = 0
    for j in range(k, len(code)):
        if code[j] == "(":
            depth += 1
        elif code[j] == ")":
            depth -= 1
            if depth == 0:
                return (k, j + 1)
    return None

def param_block_names(code):
    sp = param_block_span(code)
    if not sp:
        return []
    return [x for x in re.findall(r"\$([A-Za-z_][A-Za-z0-9_]*)", code[sp[0]:sp[1]]) if x.lower() not in {"true", "false", "null"}]

def toplevel_names(code):
    """Names assigned at script scope (outside function bodies and outside the param block)."""
    top = blank_functions(code)
    sp = param_block_span(code)
    if sp:
        top = top[:sp[0]] + " " * (sp[1] - sp[0]) + top[sp[1]:]
    names = set(x.lower() for x in re.findall(r"(?<![\w:$])\$([A-Za-z_][A-Za-z0-9_]*)\s*(?:\+|-|\*|/)?=(?!=)", top))
    names |= set(x.lower() for x in re.findall(r"foreach\s*\(\s*\$([A-Za-z_][A-Za-z0-9_]*)\s+in", top))
    names |= set(x.lower() for x in re.findall(r"for\s*\(\s*\$([A-Za-z_][A-Za-z0-9_]*)\s*=", top))
    return names

def script_prefixed(code):
    return {m.group(1).lower(): m.group(1) for m in re.finditer(r"\$script:([A-Za-z_][A-Za-z0-9_]*)", code, re.I)}

def dot_sourced(raw_text):
    return re.findall(r"(?m)^\s*\.\s+\(Join-Path \$PSScriptRoot '([^']+\.ps1)'\)", raw_text)

# Deliberate, reviewed sharing of a script parameter with a dot-sourced file: Phase6B.Common.ps1 (unchanged r3 file) does  if (-not $Root) { $Root = 'D:\llm' }
# and builds $script:Cfg from $Root. $Root is a plain unvalidated [string] in every script that dot-sources it, so the re-assignment cannot trigger a conversion error.
ALLOWED_SHARED = {("Phase6B.Common.ps1", "root")}

def scope_collisions(allcode, raw):
    """A script parameter is a SCRIPT-SCOPE variable (with its type and validation attributes). Anything running in the same scope that assigns the same
    name - $script:Name anywhere in a dot-sourced file, a plain top-level assignment in the script or a dot-sourced file - silently re-assigns the
    parameter (PowerShell variable names are case-insensitive) and runs its conversion/validation on the new value. That is the r4 defect:
    Phase6C.Runtime.ps1 did  $script:Ctx = $null  while Invoke-PilotRun.ps1 declared  [ValidateSet(4096,8192,12288)][int]$Ctx."""
    findings = []
    leak_by_lib = {}
    for f, c in allcode.items():
        pn = param_block_names(c)
        if not pn:
            continue
        closure = [f] + [g for g in dot_sourced(raw[f]) if g in allcode]
        libs = closure[1:]
        mine_params = {n.lower(): n for n in pn}
        mine_top = toplevel_names(c)
        for g in closure:
            sp = script_prefixed(allcode[g])
            for l, n in mine_params.items():
                if l in sp:
                    findings.append((g, 0, "script scope collision: %s assigns/reads $script:%s but %s declares the script parameter $%s (same variable, case-insensitive; its type and validation attributes apply)" % (g, sp[l], f, n)))
            if g != f:
                tn = toplevel_names(allcode[g])
                for l, n in mine_params.items():
                    if l in tn and (g, l) not in ALLOWED_SHARED:
                        findings.append((g, 0, "script scope collision: top-level assignment to $%s in dot-sourced %s collides with script parameter $%s of %s" % (n, g, n, f)))
                for l in mine_top:
                    if l in tn or l in sp:
                        findings.append((f, 0, "script scope collision: top-level $%s in %s is the same variable as a script-scope name in dot-sourced %s" % (l, f, g)))
        for g in libs:
            leak_by_lib.setdefault(g, set()).update(set(mine_params) | mine_top)
    return findings, leak_by_lib

def code_line(code, pos):
    return code.count("\n", 0, pos) + 1

def main():
    d = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_DIR
    findings = check_package(d)
    seen = set()
    for f, ln, msg in findings:
        key = (f, ln, msg)
        if key in seen:
            continue
        seen.add(key)
        print("%s:%s: %s" % (f, ln, msg))
    print("findings:", len(seen))
    return 1 if seen else 0

if __name__ == "__main__":
    sys.exit(main())
