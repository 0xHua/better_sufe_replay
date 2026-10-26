"""Fetch a URL and save the raw bytes into probe/ for offline inspection.

Usage:
    python tools/fetch_raw.py <url> <outfile>
"""

from __future__ import annotations

import os
import ssl
import sys
import urllib.error
import urllib.request

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "probe")


def main():
    url, name = sys.argv[1], sys.argv[2]
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    try:
        with urllib.request.urlopen(req, timeout=30, context=ctx) as r:
            data = r.read()
            status = r.status
            ctype = r.headers.get("Content-Type")
    except urllib.error.HTTPError as e:
        data, status, ctype = e.read(), e.code, e.headers.get("Content-Type")

    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, name)
    with open(path, "wb") as f:
        f.write(data)
    print(f"HTTP {status} | {ctype} | {len(data)} bytes -> {path}")


if __name__ == "__main__":
    main()
