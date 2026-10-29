#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把幻灯片导出成 PDF（Chromium 系浏览器无头打印，页面 @page 生效：
每页一张 16:9 幻灯片、深色底保留、fragment/代码步进全展开、GIF 截首帧）。

单独用
------
    python export_pdf.py                  # -> dist/deck.pdf
    python export_pdf.py --out D:/x.pdf   # 指定输出位置

build_zip.py 打包时也 import 本文件里的 export_pdf() 顺手导一份 PDF——
这里是唯一实现，改打印行为只动这一个文件。

为什么要有这层封装（手动跑 chrome --headless --print-to-pdf 的坑）
------------------------------------------------------------------
· --print-to-pdf 必须给绝对路径。给相对路径时 Chrome 把文件
  写到自己的安装目录（Program Files 下没有写权限），报
  「拒绝访问 (0x5)」——而且退出码仍是 0，调用方完全看不出失败。
· Chrome 正在前台运行时可能复用已有进程导致打印不触发，
  所以用独立的临时 user-data-dir 起干净的无头实例。
· file:// 下字体/图片偶尔取不齐，这里起临时本地 HTTP 服务再打印。

无头模式的 stderr 噪音（GPU、同步服务之类）不算失败，
唯一可靠的判据是「这次跑完后 PDF 文件出现了」。
"""

import argparse
import re
import shutil
import subprocess
import sys
import tempfile
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def mark():
    """终端能不能显示 ✓ —— 中文 Windows 常用 GBK，没有这个符号（build_zip.py 同款）。"""
    enc = (getattr(sys.stdout, "encoding", None) or "utf-8").lower()
    if "utf" in enc:
        return "✓"
    return "OK"


class _QuietHandler(SimpleHTTPRequestHandler):
    """http.server 默认每个请求往 stderr 打一行，无头打印用不着。"""

    def log_message(self, *args):
        pass


# 无头打印按这个顺序找 Chromium 系浏览器：macOS 看 /Applications，
# Windows 看 Program Files（Win10/11 一定有 Edge 兜底），最后再试 PATH。
BROWSER_CANDIDATES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    Path.home() / "AppData/Local/Google/Chrome/Application/chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]
BROWSER_NAMES = ["google-chrome", "chromium", "chromium-browser", "msedge"]


def find_browser():
    for candidate in BROWSER_CANDIDATES:
        if Path(candidate).is_file():
            return str(candidate)
    for name in BROWSER_NAMES:
        found = shutil.which(name)
        if found:
            return found
    return None


def pdf_page_info(path):
    """从 PDF 里数页数、读页面尺寸（Chrome 导出的结构足够简单，够用了）。"""
    data = path.read_bytes()
    pages = len(re.findall(rb"/Type\s*/Page(?![a-zA-Z])", data))
    match = re.search(rb"/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)", data)
    if match:
        w = float(match.group(3)) - float(match.group(1))
        h = float(match.group(4)) - float(match.group(2))
        return pages, f"{w:.0f}x{h:.0f} pt"
    return pages, None


def export_pdf(out_path, *, fatal=False):
    """起临时本地服务，无头浏览器打印整套幻灯片到 out_path，成功返回 True。

    fatal=False：找不到浏览器或打印失败只警告——打包场景，zip 不受影响；
    fatal=True：失败直接 SystemExit——单独跑 CLI 的场景。
    """
    browser = find_browser()
    if not browser:
        if fatal:
            raise SystemExit("找不到 Chrome/Edge/Chromium/Brave，装一个再跑。")
        print("  ⚠ 没找到 Chrome/Edge/Chromium/Brave，跳过 PDF（zip 不受影响）")
        return False

    server = ThreadingHTTPServer(
        ("127.0.0.1", 0), partial(_QuietHandler, directory=str(ROOT))
    )
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        # 先删旧文件：写失败时浏览器退出码也是 0，
        # 唯一可靠的判据是「这次跑完后文件出现了」
        out_path.unlink(missing_ok=True)
        with tempfile.TemporaryDirectory(prefix="print-pdf-") as profile:
            cmd = [
                browser,
                "--headless=new",
                # 独立临时 profile：前台正开着浏览器时会复用已有进程，打印不触发
                f"--user-data-dir={profile}",
                "--disable-gpu",
                "--disable-extensions",
                "--no-first-run",
                "--no-pdf-header-footer",
                "--hide-scrollbars",
                # 给 JS 引擎和本地图片留足虚拟时间（大 GIF 也要解码首帧）
                "--virtual-time-budget=10000",
                # 绝对路径必须：相对路径会写去浏览器安装目录且退出码仍为 0
                f"--print-to-pdf={out_path}",
                f"http://127.0.0.1:{port}/index.html",
            ]
            result = subprocess.run(cmd, capture_output=True, timeout=180, check=False)

        # 只有产物没生成（或空文件）才算失败
        if not out_path.exists() or out_path.stat().st_size == 0:
            tail = result.stderr.decode("utf-8", "replace").strip().splitlines()
            tail = tail or ["(浏览器没有任何输出)"]
            if fatal:
                sys.stderr.write("导出失败：PDF 没有生成，浏览器 stderr 末尾：\n")
                for line in tail[-5:]:
                    sys.stderr.write(f"    {line}\n")
                raise SystemExit(1)
            print("  ⚠ PDF 导出失败（zip 不受影响），浏览器 stderr 末尾：")
            for line in tail[-3:]:
                print(f"    {line}")
            return False

        pages, geom = pdf_page_info(out_path)
        size_kb = out_path.stat().st_size / 1024
        extra = f"，{geom}" if geom else ""
        print(f"{mark()} {out_path}")
        print(f"  {pages} 页{extra}，{size_kb:.0f} KB")
        return True
    finally:
        server.shutdown()
        thread.join(timeout=5)


def main():
    # 中文 Windows 终端默认 GBK，强制 UTF-8 输出（同 build_zip.py）
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(
        description="把幻灯片导出成 PDF（Chrome/Edge 无头打印）"
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=ROOT / "dist" / "deck.pdf",
        help="输出 PDF 路径（默认 dist/deck.pdf）",
    )
    args = parser.parse_args()

    return 0 if export_pdf(args.out.expanduser().resolve(), fatal=True) else 1


if __name__ == "__main__":
    sys.exit(main())
