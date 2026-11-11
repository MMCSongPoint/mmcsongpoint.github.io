#!/usr/bin/env python3
"""App version 1.<server version>.<build>: the middle number is the server version (server/Code.gs);
the last counts the commits since the server version last changed (back to 1 with each new server version).
Also writes the build log: one line per commit (its version, date and message, at most 20 words).
Major changes / new features are marked: listed in .github/buildlog-highlights.json (commit -> wording), or a commit
message with a "Build-Log: major" line (its subject is the wording). Everything else is a small change (hidden at first).
Usage: version.py [build-log-file.js]   Prints the version for HEAD."""
import json, re, subprocess, sys

def git(*a): return subprocess.check_output(['git', *a], text=True)

commits = git('rev-list', '--reverse', '--first-parent', 'HEAD').split()
touched = set(git('log', '--format=%H', '--', 'server/Code.gs').split())
sv, n, rows = 0, 0, []
for c in commits:
    if c in touched:
        try:
            m = re.search(r"app: 'MMC SongPoint server', version: (\d+)", git('show', f'{c}:server/Code.gs'))
            if m: new = int(m.group(1))
            else: new = sv
        except subprocess.CalledProcessError: new = sv
        if new != sv: sv, n = new, 0
    n += 1
    rows.append((c, sv, n))
ver = lambda sv, n: f'1.{sv}.{n}'
print(ver(rows[-1][1], rows[-1][2]))

if len(sys.argv) > 1:
    import os
    hp = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'buildlog-highlights.json')
    highlights = json.load(open(hp)) if os.path.exists(hp) else {}
    log = []
    for c, s, k in reversed(rows[-120:]):
        date, subj, body = (git('log', '-1', '--format=%cs%x09%s%x09%b', c).rstrip('\n').split('\t', 2) + [''])[:3]
        hl = next((t for k, t in highlights.items() if c.startswith(k)), None)
        major = bool(hl) or bool(re.search(r'^Build-Log:\s*major\s*$', body, re.I | re.M))
        if hl: subj = hl
        subj = re.sub(r'\s*\(#\d+\)$', '', subj).strip()
        words = subj.split()
        if len(words) > 20: subj = ' '.join(words[:20]).rstrip(',;:') + '…'
        log.append({'v': ver(s, k), 'd': date, 't': subj, **({'m': 1} if major else {})})
    with open(sys.argv[1], 'w') as f:
        f.write('// Build log, written when the app is built (.github/scripts/version.py)\nwindow.BUILD_LOG = ' + json.dumps(log, ensure_ascii=False, indent=0) + ';\n')
