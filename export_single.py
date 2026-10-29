#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把幻灯片导出成单文件 HTML：CSS、JS、图片（png/jpg/gif/svg）、favicon 全部
内联成 data URI，一个 .html 发出去就能放，不依赖任何其他文件。
默认输出 dist/deck.html（体积主要看图片，特别是 GIF 的 base64）。

单独用
------
    python export_single.py                  # -> dist/deck.html
    python export_single.py --out D:/x.html  # 指定输出位置
    python export_single.py --no-qr          # 结尾页二维码不进产物

实现上的坑（改内联逻辑前先读）
------------------------------
· 本项目只有本地引用、没有 fetch/Worker，内联即完整；演讲者视图的
  localStorage、window.open 在 file:// 下都可用，无须特殊处理。
· CSS 里的 url("../assets/...") 以 CSS 文件所在目录解析，内联成
  <style> 后相对关系就断了——必须在内容里替换成 data URI，而不是
  照搬 href 那样按 HTML 位置解析。
· 内联 <script>/<style> 前先确认源码里没有 </script>、</style> 字面量，
  有就整体失败，避免悄悄产出会被浏览器截断的坏文件。
· 中文文件名按原样读字节，不做 URL 转义——data URI 是 base64，
  路径只在读文件时用到。
· --no-qr 把结尾页二维码整块摘掉（元素、图片、链接都不留在文件里，
  适合链接只面向现场观众的场合）；摘掉后收窄版式靠注入 <head> 的
  一段 override（custom.css 里那份只管打印场景）。
"""

import argparse
import base64
import re
import sys
from pathlib import Path

from export_pdf import mark

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"

MIME = {
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
}


def data_uri(ref, base):
    """把 base（HTML 或 CSS 所在目录）下的相对引用读成 data URI。"""
    path = (base / ref).resolve()
    if not path.is_file():
        raise SystemExit(f"引用的文件不存在：{path}")
    mime = MIME.get(path.suffix.lower())
    if not mime:
        raise SystemExit(f"不认识的扩展名，去 export_single.py 的 MIME 补一下：{path.name}")
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def inline_css(css_path):
    """读一个 CSS 文件，把其中的 url(...) 换成 data URI（按 CSS 目录解析）。"""
    text = css_path.read_text(encoding="utf-8")
    if "</style>" in text:
        raise SystemExit(f"{css_path.name} 里有 </style> 字面量，内联会被截断")

    def repl(match):
        quote, ref = match.group(1), match.group(2)
        if re.match(r"^(data:|https?:|#)", ref):
            return match.group(0)
        return f"url({quote}{data_uri(ref, css_path.parent)}{quote})"

    return re.sub(r"url\(\s*(['\"]?)([^'\")]+)\1\s*\)", repl, text)


def export_single(out_path, *, no_qr=False):
    html_path = ROOT / "index.html"
    html = html_path.read_text(encoding="utf-8")
    fails = []

    # 可选：结尾页二维码整块摘掉，必须在 <img> 内联之前，图片才不会进文件。
    # 锚点是紧随其后的 <aside class="notes">：非贪婪匹配到它为止，
    # 嵌套的 .qr-frame 等子 div 一并带走；没摘到就整体失败，绝不带着
    # 二维码悄悄发出去。
    if no_qr:
        html, stripped = re.subn(
            r'[ \t]*<div class="qr">.*?(?=<aside class="notes")',
            "",
            html,
            count=1,
            flags=re.DOTALL,
        )
        if stripped != 1:
            raise SystemExit(
                '结尾页二维码块没摘到（<div class="qr"> … <aside class="notes">），'
                "index.html 结构变了？"
            )
        # 屏幕版式收成单栏，避免右侧空出一列；custom.css 里的对应规则只管打印。
        html = html.replace(
            "</head>",
            "<style>\n/* 单文件版摘掉了结尾页二维码，结尾页收成单栏 */\n"
            ".deck-slide.slide-closing { grid-template-columns: minmax(0, 1fr); gap: 0; }\n"
            "</style>\n</head>",
            1,
        )

    def check(path):
        if "</script>" in path.read_text(encoding="utf-8"):
            fails.append(f"{path.name} 里有 </script> 字面量，内联会被截断")

    for link in re.findall(r'<link rel="stylesheet" href="([^"]+)"', html):
        check(ROOT / link)
    for src in re.findall(r'<script src="([^"]+)"></script>', html):
        check(ROOT / src)
    if fails:
        raise SystemExit("\n".join(fails))

    # stylesheet link -> <style>，favicon link 的 href 换成 data URI
    def repl_stylesheet(match):
        ref = match.group(1)
        return f"<style>\n/* {ref} */\n{inline_css(ROOT / ref)}\n</style>"

    def repl_other_link(match):
        tag, ref = match.group(1), match.group(2)
        return f'{tag}{data_uri(ref, ROOT)}"'

    html = re.sub(r'<link rel="stylesheet" href="([^"]+)"\s*/>', repl_stylesheet, html)
    html = re.sub(r'(<link\b[^>]*\bhref=")([^"]+)(")', repl_other_link, html)

    # <script src> -> 内联脚本
    def repl_script(match):
        ref = match.group(1)
        return f"<script>\n/* {ref} */\n{(ROOT / ref).read_text(encoding='utf-8')}\n</script>"

    html = re.sub(r'<script src="([^"]+)"></script>', repl_script, html)

    # <img src> -> data URI
    def repl_img(match):
        ref = match.group(2)
        return f'{match.group(1)}{data_uri(ref, ROOT)}{match.group(3)}'

    html = re.sub(r'(<img\b[^>]*\bsrc=")([^"]+)(")', repl_img, html)

    # 收尾自查：不该再剩任何本地引用
    leftovers = re.findall(
        r'(?:src|href)="(?!data:|https?:|#)[^"]+"|url\(\s*["\']?(?!data:|https?:|#)[^"\')]+',
        html,
    )
    if leftovers:
        raise SystemExit("还有没内联干净的引用：\n" + "\n".join(sorted(set(leftovers))[:10]))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(html.encode("utf-8"))
    return out_path


def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="把幻灯片导出成单文件 HTML（全资源内联）")
    parser.add_argument(
        "--out",
        type=Path,
        default=DIST / "deck.html",
        help="输出路径（默认 dist/deck.html）",
    )
    parser.add_argument(
        "--no-qr",
        action="store_true",
        help="结尾页二维码不进单文件版（元素、图片、链接全部摘除）",
    )
    args = parser.parse_args()

    out = export_single(args.out.expanduser().resolve(), no_qr=args.no_qr)
    print(f"{mark()} {out}")
    print(f"  {out.stat().st_size / 1024 / 1024:.1f} MB，双击就能放")
    return 0


if __name__ == "__main__":
    sys.exit(main())
