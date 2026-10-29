#!/usr/bin/env python3
"""Package the built site as an offline demo that opens by double-clicking index.html.

Browsers block a few things on file:// pages, so this script:
  - inlines the icon sprite into every page (external <use> references don't load from files),
  - embeds the location and search data (fetch() doesn't work on files),
  - embeds the heading font in the stylesheet (font files are blocked from file:// pages),
  - points home links at index.html (a bare "./" would open a folder listing).

Usage:  python3 tools/build.py && python3 tools/offline.py
Output: dist/kanghucare-offline/ and dist/kanghucare-offline.zip
"""
import base64
import json
import pathlib
import re
import shutil
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "dist" / "kanghucare-offline"


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "assets" / "css").mkdir(parents=True)
    shutil.copytree(ROOT / "assets" / "js", OUT / "assets" / "js")
    shutil.copytree(ROOT / "assets" / "img", OUT / "assets" / "img")

    # Stylesheet with the fonts embedded as data URIs
    css = (ROOT / "assets" / "css" / "style.css").read_text(encoding="utf-8")

    def embed(m):
        data = (ROOT / "assets" / "fonts" / m.group(1)).read_bytes()
        return 'url("data:font/woff2;base64,' + base64.b64encode(data).decode() + '")'
    css = re.sub(r'url\("\.\./fonts/([\w.-]+)"\)', embed, css)
    (OUT / "assets" / "css" / "style.css").write_text(css, encoding="utf-8")

    sprite = (ROOT / "assets" / "img" / "icons.svg").read_text(encoding="utf-8")
    sprite = sprite.replace('<svg xmlns="http://www.w3.org/2000/svg">',
                            '<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">', 1)
    data = {
        "locations": json.loads((ROOT / "assets" / "data" / "locations.json").read_text(encoding="utf-8")),
        "search": json.loads((ROOT / "assets" / "data" / "search.json").read_text(encoding="utf-8")),
    }
    data_script = "<script>window.KHT_DATA = " + json.dumps(data, ensure_ascii=False) + ";</script>\n"

    pages = sorted(ROOT.glob("*.html"))
    for page in pages:
        html = page.read_text(encoding="utf-8")
        html = html.replace('href="assets/img/icons.svg#', 'href="#')
        html = html.replace('href="./#', 'href="index.html#').replace('href="./"', 'href="index.html"')
        html = re.sub(r'<link rel="preload"[^>]*>\n?', "", html)
        html = re.sub(r'<link rel="manifest"[^>]*>\n?', "", html)
        html = re.sub(r'<script src="assets/js/main\.js(\?v=\w+)?" defer></script>',
                      lambda m: data_script + m.group(0), html, count=1)
        html = html.replace("<body>\n", "<body>\n" + sprite + "\n", 1)
        (OUT / page.name).write_text(html, encoding="utf-8")

    (OUT / "使用说明.txt").write_text(
        "康护通网站离线演示版\n\n"
        "1. 解压整个文件夹（不要只拿出单个文件）。\n"
        "2. 双击 index.html，用 Chrome、Edge 或 Safari 打开即可，无需联网。\n"
        "3. 在线预约为演示模式：提交后显示成功，但不会发送任何数据。\n",
        encoding="utf-8")

    zip_path = OUT.parent / "kanghucare-offline.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(OUT.rglob("*")):
            if f.is_file():
                z.write(f, pathlib.Path("kanghucare-offline") / f.relative_to(OUT))
    print(f"offline demo: {len(pages)} pages -> {zip_path.relative_to(ROOT)} ({zip_path.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
