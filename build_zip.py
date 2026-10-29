#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把幻灯片打包成可直接分发的 zip（发群文件、邮件附件都行）。

打包规则
--------
· 固定收进包里的：index.html、css/、js/、handout.md
· 素材由扫描 index.html / css / js / handout.md 里的路径得出，只带真正被引用的
  图片；没人引用的不进包
· 开发文件不进包：.git、README.md、本脚本、dist/、*.zip、.DS_Store
· zip 里带一层 deck/ 目录，解压后不会把文件散落在当前目录
· 中文文件名按 UTF-8 写入，Windows 资源管理器、macOS 解压都正常
· 顺手附一份「打开说明.txt」，观众解压就知道怎么翻页

用法
----
    python build_zip.py                 # 生成 dist/deck.zip + .pdf
    python build_zip.py --out D:/x.zip  # 指定输出位置（PDF 同名 .pdf）
    python build_zip.py --include-dev   # 连 README.md 一起打包
    python build_zip.py --no-notes      # 不附「打开说明.txt」
    python build_zip.py --no-pdf        # 只打 zip，不导 PDF

PDF 导出
--------
    打包完顺手导一份同名 .pdf，实现在 export_pdf.py（唯一版本，
    也可单独 python export_pdf.py 跑）；这里只负责调用，
    失败只警告，不影响 zip。
"""

import argparse
import re
import sys
import zipfile
from pathlib import Path

from export_pdf import export_pdf, mark

ROOT = Path(__file__).resolve().parent
ARCHIVE = "deck"                    # zip 里的顶层目录名，换成你的项目名
NOTES = "打开说明.txt"

INCLUDE_FILES = ["index.html", "handout.md"]
INCLUDE_DIRS = ["css", "js"]
DEV_FILES = ["README.md"]

# 素材文件引用：assets/... 或 css 里写法的 ../assets/...
# 路径段只允许「单词字符 + 点 + 连字符」——\w 在 Python 里是 Unicode 感知的，
# 中文文件名能匹配上，但中文标点（，。、（））会自然截断，
# 不会把后面半句话一起吞成文件名。末尾必须有扩展名，避免把注释里的
# assets/icons/ 这类目录说明误当成素材文件。
ASSET_RE = re.compile(r"""(?:\.\./)?(assets/[\w.\-]+(?:/[\w.\-]+)*\.[A-Za-z0-9]+)""")

# 已经压缩过的格式，再 deflate 一遍只会更慢更大
STORED_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".zip", ".woff2"}

# 这些后缀的文件会被扫描引用关系
SCAN_SUFFIXES = {".html", ".css", ".js", ".md"}

NOTES_TEXT = """《双击就能放的 HTML 幻灯片》模板示例稿

怎么打开
  解压后双击 index.html 即可，离线可用，不需要联网、不需要装任何东西。

翻页快捷键
  → / 空格   下一页
  ←          上一页
  o          总览（所有页缩略图，点一下直接跳）
  f          全屏
  b          黑屏（讲者备稿用）
  s          演讲者视图：下一页预览 + 备注 + 计时器（侧栏右上 × 关闭）
  ?          完整快捷键一览
  带 fragment 的页按 → 逐步亮起；带步进标记的代码页按 → 逐段点亮

其他
  配套讲义见同目录 handout.md（如有）。
  打印/导出 PDF：任意页面 ⌘P / Ctrl+P，目标选「另存为 PDF」，
  每页一张幻灯片，无页边距。
  录屏 GIF 自动循环播放；结尾页二维码可扫码，也可以直接点击。
"""


def referenced_assets(text_files):
    """扫出这些文件里引用到的 assets/... 路径（相对仓库根）。"""
    found = set()
    for path in text_files:
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for match in ASSET_RE.finditer(text):
            found.add(match.group(1))
    return sorted(found)


def collect(root, include_dev):
    """返回 [(磁盘路径, zip 内相对路径)]，按 zip 内路径排序。"""
    picked = {}

    def add(path):
        if path.is_file():
            picked[path.relative_to(root).as_posix()] = path

    for rel in INCLUDE_FILES:
        add(root / rel)
    if include_dev:
        for rel in DEV_FILES:
            add(root / rel)
    for folder in INCLUDE_DIRS:
        for path in sorted((root / folder).rglob("*")):
            add(path)

    # 素材：扫描已选中的文本文件（CSS 里的 url() 也算引用）
    text_files = [
        p for p in picked.values() if p.suffix.lower() in SCAN_SUFFIXES
    ]
    missing = []
    for rel in referenced_assets(text_files):
        path = root / rel
        if path.is_file():
            add(path)
        else:
            missing.append(rel)
    if missing:
        raise SystemExit(
            "引用的素材在仓库里找不到，页面会有坏图：\n  "
            + "\n  ".join(missing)
        )

    return sorted((picked[rel], rel) for rel in picked)


def skipped_assets(root, picked):
    """仓库里有、但没被任何文件引用的素材。"""
    assets = root / "assets"
    if not assets.is_dir():
        return []
    used = {rel for rel in picked if rel.startswith("assets/")}
    return sorted(
        p.relative_to(root).as_posix()
        for p in assets.rglob("*")
        if p.is_file() and p.relative_to(root).as_posix() not in used
    )


def build(out_path, include_dev, notes):
    root = ROOT
    files = collect(root, include_dev)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out_path, "w") as zf:
        for path, rel in files:
            method = (
                zipfile.ZIP_STORED
                if path.suffix.lower() in STORED_SUFFIXES
                else zipfile.ZIP_DEFLATED
            )
            zf.write(path, f"{ARCHIVE}/{rel}", compress_type=method)
        if notes:
            zf.writestr(f"{ARCHIVE}/{NOTES}", NOTES_TEXT.encode("utf-8"))

    with zipfile.ZipFile(out_path) as zf:
        entries = zf.infolist()

    print(f"{mark()} {out_path}")
    print(f"  {len(entries)} 个条目，压缩包 {out_path.stat().st_size / 1024:.0f} KB")
    for info in entries:
        print(f"    {info.filename}  ({info.file_size / 1024:.1f} KB)")

    skipped = skipped_assets(root, {rel for _, rel in files})
    if skipped:
        print("  未打包（没有文件引用到）：")
        for rel in skipped:
            print(f"    {rel}")
    return 0


def main():
    # 中文 Windows 终端默认是 GBK，强制 UTF-8 输出，免得中文变乱码；
    # errors="replace" 兜底，碰到显示不了的字符也不至于把脚本打挂。
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(
        description="把幻灯片打包成可分发的 zip（发群文件、邮件附件）"
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=ROOT / "dist" / f"{ARCHIVE}.zip",
        help="输出 zip 路径（默认 dist/%s.zip）" % ARCHIVE,
    )
    parser.add_argument(
        "--include-dev",
        action="store_true",
        help="连 README.md 一起打包",
    )
    parser.add_argument(
        "--no-notes",
        action="store_true",
        help="不附「打开说明.txt」",
    )
    parser.add_argument(
        "--no-pdf",
        action="store_true",
        help="只打 zip，不导出 PDF",
    )
    args = parser.parse_args()

    out_path = args.out.expanduser().resolve()
    status = build(out_path, args.include_dev, not args.no_notes)
    if not args.no_pdf:
        export_pdf(out_path.with_suffix(".pdf"))
    return status


if __name__ == "__main__":
    sys.exit(main())
