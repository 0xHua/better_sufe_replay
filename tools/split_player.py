"""把单文件播放器拆成 MV3 扩展可直接加载的三件套。

MV3 扩展页面的默认 CSP 是 `script-src 'self'`，内联 <script> 会被直接拒绝，
所以必须把内联 JS/CSS 抽成外部文件。这个脚本做纯文本搬迁，不改任何逻辑。

用法：
    python tools/split_player.py

输入：player/index.html
输出：extension/player/index.html + player.css + player.js
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "player" / "index.html"
OUT = ROOT / "extension" / "player"


def main() -> int:
    if not SRC.exists():
        print(f"[x] 找不到源文件: {SRC}")
        return 1

    html = SRC.read_text(encoding="utf-8")
    OUT.mkdir(parents=True, exist_ok=True)

    style_re = re.compile(r"<style[^>]*>(.*?)</style>", re.S | re.I)
    styles = style_re.findall(html)
    css = "\n".join(s.strip() for s in styles)
    html = style_re.sub(
        '<link rel="stylesheet" href="player.css">', html, count=1
    )

    # 只抓没有 src 属性的内联脚本
    script_re = re.compile(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", re.S | re.I)
    scripts = script_re.findall(html)
    js = "\n".join(s.strip() for s in scripts)
    html = script_re.sub('<script src="player.js"></script>', html, count=1)

    (OUT / "player.css").write_text(css, encoding="utf-8")
    (OUT / "player.js").write_text(js, encoding="utf-8")
    (OUT / "index.html").write_text(html, encoding="utf-8")

    print(f"[+] player.css   {len(css):>7,} chars")
    print(f"[+] player.js    {len(js):>7,} chars")
    print(f"[+] index.html   {len(html):>7,} chars")
    print(f"[=] 输出目录     {OUT}")

    if "<script>" in html.lower():
        print("[!] 警告：仍有残留内联 script，MV3 会拒绝执行")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
