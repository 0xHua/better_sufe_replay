"""Probe a media URL: HEAD headers, Range support, and MP4 box layout.

Usage:
    python tools/probe_video.py <url> [--bytes N]
"""

from __future__ import annotations

import argparse
import ssl
import sys
import urllib.error
import urllib.request

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

INTERESTING = [
    "Content-Type",
    "Content-Length",
    "Content-Range",
    "Accept-Ranges",
    "Server",
    "Last-Modified",
    "ETag",
    "Content-Disposition",
    "Cache-Control",
    "Access-Control-Allow-Origin",
    "Access-Control-Expose-Headers",
]


def make_ctx():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def show(resp, label):
    print(f"--- {label} ---")
    print(f"HTTP {getattr(resp, 'status', None) or resp.getcode()}")
    headers = resp.headers
    for k in INTERESTING:
        v = headers.get(k)
        if v:
            print(f"{k}: {v}")
    extra = [h for h in headers.keys() if h.lower().startswith("x-")]
    for h in extra:
        print(f"{h}: {headers.get(h)}")


def head(url, ctx):
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30, context=ctx) as r:
            show(r, "HEAD")
    except urllib.error.HTTPError as e:
        show(e, "HEAD (HTTPError)")
    except Exception as e:
        print(f"--- HEAD ---\nERROR: {type(e).__name__}: {e}")


def get_range(url, ctx, n):
    req = urllib.request.Request(
        url, headers={"User-Agent": UA, "Range": f"bytes=0-{n - 1}"}
    )
    try:
        with urllib.request.urlopen(req, timeout=30, context=ctx) as r:
            show(r, f"GET Range 0-{n - 1}")
            data = r.read(n)
    except urllib.error.HTTPError as e:
        show(e, f"GET Range 0-{n - 1} (HTTPError)")
        data = e.read(n)
    except Exception as e:
        print(f"--- GET Range ---\nERROR: {type(e).__name__}: {e}")
        return b""
    print(f"downloaded: {len(data)} bytes")
    print("hex head : " + data[:48].hex(" "))
    print("ascii    : " + "".join(chr(b) if 32 <= b < 127 else "." for b in data[:64]))
    return data


def parse_boxes(data):
    """Walk top-level MP4 boxes in the fetched prefix."""
    print("--- MP4 boxes (top level, from prefix) ---")
    i = 0
    while i + 8 <= len(data):
        size = int.from_bytes(data[i : i + 4], "big")
        typ = data[i + 4 : i + 8].decode("latin-1")
        if size < 8:
            print(f"  offset {i}: abnormal size {size} (truncated box)")
            break
        print(f"  offset {i:>8}  size {size:>10}  type {typ!r}")
        if typ in {"ftyp"} and i + 8 + 4 <= len(data):
            print(f"        major_brand={data[i + 8 : i + 12].decode('latin-1')!r}")
        if typ in {"moov"}:
            print("        -> moov at front: fast-start / streaming friendly")
        i += size


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("--bytes", type=int, default=65536)
    args = ap.parse_args()

    ctx = make_ctx()
    head(args.url, ctx)
    data = get_range(args.url, ctx, args.bytes)
    if data[:8].find(b"ftyp") != -1:
        parse_boxes(data)
    else:
        print("not an ISO-BMFF/MP4 prefix (maybe encrypted or HTML error page)")


if __name__ == "__main__":
    sys.exit(main())
