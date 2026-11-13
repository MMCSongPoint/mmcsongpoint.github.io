#!/usr/bin/env python3
"""Publish a folder to Firebase Hosting (site songpoint -> songpoint.web.app) with the Hosting REST API.

Usage: firebase_deploy.py <folder>   (access token in the ACCESS_TOKEN environment variable)
The token comes from GitHub's own sign-in to Google (workload identity federation), so no key is stored anywhere.
"""
import gzip, hashlib, json, os, sys, urllib.request

SITE = 'songpoint'
API = 'https://firebasehosting.googleapis.com/v1beta1'
TOKEN = os.environ['ACCESS_TOKEN']
root = sys.argv[1]


def call(method, url, body=None, raw=None, ctype='application/json'):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(url, data=data, method=method, headers={'Authorization': 'Bearer ' + TOKEN, 'Content-Type': ctype})
    with urllib.request.urlopen(req) as r:
        txt = r.read().decode() or '{}'
    return json.loads(txt)


# 1. a new version; pages and scripts are always re-checked so an update shows straight away
version = call('POST', f'{API}/sites/{SITE}/versions', {'config': {'headers': [
    {'glob': '**/*.@(html|js|json|webmanifest)', 'headers': {'Cache-Control': 'no-cache'}}]}})['name']
print('version', version)

# 2. every file, gzipped, by its hash
files, blobs = {}, {}
for dirpath, _, names in os.walk(root):
    for n in names:
        full = os.path.join(dirpath, n)
        path = '/' + os.path.relpath(full, root).replace(os.sep, '/')
        z = gzip.compress(open(full, 'rb').read(), mtime=0)
        h = hashlib.sha256(z).hexdigest()
        files[path] = h; blobs[h] = z
print(len(files), 'files')

# 3. upload the ones Firebase doesn't have yet
res = call('POST', f'{API}/{version}:populateFiles', {'files': files})
need, upurl = res.get('uploadRequiredHashes', []), res.get('uploadUrl')
for h in need:
    call('POST', f'{upurl}/{h}', raw=blobs[h], ctype='application/octet-stream')
print(len(need), 'uploaded')

# 4. finish it and make it live
call('PATCH', f'{API}/{version}?update_mask=status', {'status': 'FINALIZED'})
call('POST', f'{API}/sites/{SITE}/releases?versionName={version}', {})
print('released to https://songpoint.web.app/')
