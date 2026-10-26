"""Inspect the portal entry page: redirects, headers, tech stack hints.

Usage:
    python tools/probe_site.py https://dm.sufe.edu.cn/
"""

from __future__ import annotations

import re
import ssl
import sys
import urllib.error
import urllib.request

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def ctx():
    c = ssl.create_default_context()
    c.check_hostname = False
    c.verify_mode = ssl.CERT_NONE
    return c


def fetch(url, follow=True):
    handlers = [urllib.request.HTTPSHandler(context=ctx())]
    if not follow:
        handlers.append(NoRedirect())
    opener = urllib.request.build_opener(*handlers)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,*/*"})
    try:
        r = opener.open(req, timeout=25)
        return r.status, dict(r.headers), r.read(200_000)
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read(20_000)


def main():
    url = sys.argv[1] if len(sys.argv) > 1 else "https://dm.sufe.edu.cn/"
    print(f"=== GET {url} (no redirect) ===")
    st, hd, body = fetch(url, follow=False)
    print("status:", st)
    for k in ("Location", "Server", "Content-Type", "Set-Cookie", "X-Powered-By"):
        if hd.get(k):
            print(f"{k}: {hd[k]}")
    if st in (301, 302, 303, 307, 308) and hd.get("Location"):
        loc = hd["Location"]
        if loc.startswith("/"):
            from urllib.parse import urljoin
            loc = urljoin(url, loc)
        print(f"\n=== follow -> {loc} ===")
        st, hd, body = fetch(loc, follow=True)
        print("status:", st, "| content-type:", hd.get("Content-Type"))

    text = body.decode("utf-8", "replace")
    print(f"\nbody bytes: {len(body)}")
    m = re.search(r"<title[^>]*>(.*?)</title>", text, re.S | re.I)
    print("title:", (m.group(1).strip() if m else "(none)"))
    for pat, label in [
        (r'<script[^>]+src="([^"]+)"', "script"),
        (r'<link[^>]+href="([^"]+\.css[^"]*)"', "css"),
    ]:
        hits = re.findall(pat, text, re.I)
        for h in hits[:12]:
            print(f"  {label}: {h}")
    for kw in ("login", "sso", "cas", "oauth", "登录", "统一身份"):
        if kw.lower() in text.lower():
            print(f"  keyword hit: {kw}")
    print("\n--- first 1200 chars ---")
    print(text[:1200])


if __name__ == "__main__":
    main()
