#!/usr/bin/env python3
"""Build the 康护通 site.

Assembles src/pages/*.html with the shared header and footer into static HTML at the
repository root, expands the small <kht-*> shorthand tags, writes sitemap.xml and
robots.txt, and subsets the heading font to the characters the site actually uses.

Usage:  python3 tools/build.py
Needs:  Python 3.9+ and fonttools + brotli (pip install fonttools brotli) for the font step.
"""
import html
import json
import pathlib
import re
from datetime import date
from html.parser import HTMLParser

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src" / "pages"

# ---------------------------------------------------------------------------
# Site settings: change these before launch.
# ---------------------------------------------------------------------------
SITE = {
    "url": "https://www.example.com",       # production domain, no trailing slash
    "phone": "400-000-0000",                 # service line shown on the site
    "tel": "4000000000",                     # same number, digits only, for tel: links
    "email": "service@example.com",
    "icp": "",                               # e.g. "京ICP备00000000号-1"; leave empty to show a reminder
    # Form endpoints: each receives a JSON POST. Leave empty and the form shows a "please call us" message.
    "book_endpoint": "",
    "careers_endpoint": "",
}

NAV = [
    ("services", "服务项目", "Services"),
    ("how-it-works", "流程与收费", "How it works"),
    ("locations", "服务网点", "Locations"),
    ("guides", "照护知识", "Care guides"),
    ("about", "关于我们", "About us"),
]

# key, zh title, en title, zh description, en description, nav key, in sitemap
PAGES = [
    ("index", "康护通｜从医院到家，全程守护长者健康", "Kang Hutong | Care for older adults, from hospital to home",
     "康护通提供医院陪护、康复护理、居家照护与健康管理。持证护工，护理过程每日可查，收费规则公开透明。",
     "Kang Hutong provides hospital companion care, rehabilitation, home care and health management, with certified caregivers, daily care reports and published pricing.",
     "index", True),
    ("services", "服务项目｜康护通", "Services | Kang Hutong",
     "医院陪护、康复护理、居家照护、健康管理四项服务，覆盖从住院到回家的全过程。",
     "Hospital companion care, rehabilitation care, home care and health management, covering every stage from admission to home.",
     "services", True),
    ("how-it-works", "流程与收费｜康护通", "How it works and pricing | Kang Hutong",
     "了解康护通的预约流程、护理等级、收费标准与常见问题。",
     "How booking works, how care levels are set, what care costs, and answers to common questions.",
     "how-it-works", True),
    ("locations", "服务网点与合作医院｜康护通", "Locations and partner hospitals | Kang Hutong",
     "查询康护通服务网点与合作医院，了解医院合作方式。",
     "Find Kang Hutong service centres and partner hospitals, and learn how hospitals can work with us.",
     "locations", True),
    ("guides", "照护知识｜康护通", "Care guides | Kang Hutong",
     "选择护理等级、预防压疮、鼻饲喂养、术后防跌倒与出院回家准备等实用照护知识。",
     "Practical guides on choosing a care level, preventing pressure sores, tube feeding, fall prevention and coming home from hospital.",
     "guides", True),
    ("about", "关于我们｜康护通", "About us | Kang Hutong",
     "康护通让陪护与照护成为有标准、可追溯的专业服务。了解我们的理念、团队与平台。",
     "Kang Hutong makes companion care a standardised, traceable professional service. Learn about our approach, teams and platform.",
     "about", True),
    ("news", "新闻动态｜康护通", "News | Kang Hutong",
     "康护通的最新消息与合作动态。", "The latest news and partnerships from Kang Hutong.",
     "about", True),
    ("careers", "加入我们｜康护通护工招聘", "Careers | Join Kang Hutong as a caregiver",
     "康护通招募持证护工：稳定派单、系统培训、清晰的等级与薪酬体系。",
     "Kang Hutong is hiring certified caregivers: steady assignments, structured training and clear grades and pay.",
     "", True),
    ("book", "预约照护｜康护通", "Book care | Kang Hutong",
     "在线预约医院陪护、康复护理或居家照护，或致电康护通服务热线。",
     "Book hospital companion care, rehabilitation or home care online, or call our service line.",
     "", True),
    ("privacy", "隐私政策｜康护通", "Privacy policy | Kang Hutong",
     "康护通如何收集、使用和保护您的个人信息。", "How Kang Hutong collects, uses and protects your personal information.",
     "", True),
    ("404", "页面未找到｜康护通", "Page not found | Kang Hutong",
     "您访问的页面不存在。", "The page you’re looking for doesn’t exist.", "", False),
]


def esc(s):
    return html.escape(s, quote=True)


def icon(name, cls="icon"):
    return f'<svg class="{cls}" aria-hidden="true"><use href="assets/img/icons.svg#i-{name}"/></svg>'


def nav_items(current):
    out = []
    for key, zh, en in NAV:
        cur = ' aria-current="page"' if key == current else ""
        out.append(f'          <li><a href="{key}.html"{cur} data-en="{esc(en)}">{zh}</a></li>')
    return "\n".join(out)


def head(key, tzh, ten, dzh, den, nav_key):
    path = "" if key == "index" else f"{key}.html"
    canonical = f'{SITE["url"]}/{path}'
    noindex = '\n<meta name="robots" content="noindex">' if key == "404" else ""
    jsonld = ""
    if key == "index":
        data = {
            "@context": "https://schema.org",
            "@type": "Organization",
            "name": "康护通",
            "alternateName": "Kang Hutong",
            "url": SITE["url"] + "/",
            "logo": SITE["url"] + "/assets/img/logo.svg",
            "telephone": SITE["phone"],
            "email": SITE["email"],
            "description": dzh,
        }
        jsonld = '\n<script type="application/ld+json">' + json.dumps(data, ensure_ascii=False) + "</script>"
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title data-en="{esc(ten)}">{esc(tzh)}</title>
<meta name="description" content="{esc(dzh)}" data-en-content="{esc(den)}">{noindex}
<link rel="canonical" href="{canonical}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="康护通 Kang Hutong">
<meta property="og:title" content="{esc(tzh)}">
<meta property="og:description" content="{esc(dzh)}">
<meta property="og:url" content="{canonical}">
<meta property="og:image" content="{SITE["url"]}/assets/img/og-image.png">
<meta property="og:locale" content="zh_CN">
<meta property="og:locale:alternate" content="en_US">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0b6489">
<link rel="icon" href="assets/img/logo.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="assets/img/apple-touch-icon.png">
<link rel="manifest" href="site.webmanifest">
<link rel="preload" href="assets/fonts/kht-serif-cjk-500.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="assets/css/style.css">
<script src="assets/js/main.js" defer></script>{jsonld}
</head>
<body>
<a class="skip-link" href="#main" data-en="Skip to main content">跳到主要内容</a>
<div class="utility-bar">
  <div class="container utility-inner">
    <a class="utility-phone" href="tel:{SITE["tel"]}">{icon("phone")}<span data-en="Care line {SITE["phone"]}">服务热线 {SITE["phone"]}</span></a>
    <span class="utility-links">
      <a href="news.html" data-en="News">新闻动态</a>
    </span>
    <span class="utility-links">
      <a href="careers.html" data-en="Careers">加入我们</a>
    </span>
    <span class="utility-links">
      <a href="locations.html#hospitals" data-en="For hospitals">医院合作</a>
    </span>
  </div>
</div>
<header class="site-header">
  <div class="container header-inner">
    <a class="brand" href="./" aria-label="康护通首页" data-en-aria-label="Kang Hutong home">
      <img class="brand-mark" src="assets/img/logo.svg" alt="" width="42" height="42">
      <span class="brand-name">康护通<span class="brand-sub">KANG HUTONG</span></span>
    </a>
    <nav class="site-nav" id="site-nav" aria-label="主导航" data-en-aria-label="Main">
      <ul>
{nav_items(nav_key)}
      </ul>
      <div class="nav-extra">
        <a class="btn btn-primary" href="book.html" data-en="Book care">预约照护</a>
        <a class="btn btn-secondary" href="tel:{SITE["tel"]}">{icon("phone")}<span data-en="Call {SITE["phone"]}">致电 {SITE["phone"]}</span></a>
        <div class="nav-extra-links">
          <a href="news.html" data-en="News">新闻动态</a>
          <a href="careers.html" data-en="Careers">加入我们</a>
          <a href="locations.html#hospitals" data-en="For hospitals">医院合作</a>
        </div>
      </div>
    </nav>
    <div class="header-actions">
      <button class="lang-toggle" type="button" lang="en" aria-label="Switch to English">EN</button>
      <a class="btn btn-primary header-cta" href="book.html" data-en="Book care">预约照护</a>
      <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="site-nav" aria-label="菜单" data-en-aria-label="Menu">
        {icon("menu", "icon icon-open")}
        {icon("x", "icon icon-close")}
      </button>
    </div>
  </div>
</header>
<main id="main" tabindex="-1">
"""


def foot(key):
    action_bar = "" if key in ("book", "404") else f"""<div class="action-bar" aria-label="快捷操作" data-en-aria-label="Quick actions" role="region">
  <a class="btn btn-secondary" href="tel:{SITE["tel"]}">{icon("phone")}<span data-en="Call">致电</span></a>
  <a class="btn btn-primary" href="book.html" data-en="Book care">预约照护</a>
</div>
"""
    icp = (f'<a href="https://beian.miit.gov.cn/" rel="noopener">{esc(SITE["icp"])}</a>' if SITE["icp"]
           else '<span data-en="ICP filing number to be added">ICP 备案号待填写</span>')
    return f"""</main>
<footer class="site-footer">
  <div class="container">
    <div class="footer-top">
      <div>
        <a class="brand" href="./" aria-label="康护通首页" data-en-aria-label="Kang Hutong home">
          <img class="brand-mark" src="assets/img/logo-light.svg" alt="" width="42" height="42">
          <span class="brand-name">康护通<span class="brand-sub">KANG HUTONG</span></span>
        </a>
        <p style="margin-top:1.25rem" data-en="Care for older adults from hospital to home: companion care, rehabilitation, home care and health management.">从医院到家，为长者提供陪护、康复、居家照护与健康管理。</p>
        <a class="footer-phone" href="tel:{SITE["tel"]}">{SITE["phone"]}</a>
        <div class="wechat">
          <div class="wechat-code"><img src="assets/img/wechat-qr.png" alt="康护通微信公众号二维码" data-en-alt="Kang Hutong WeChat QR code" width="88" height="88" onerror="this.replaceWith(document.createTextNode('二维码待放置'))"></div>
          <p data-en="Follow us on WeChat to book care and receive daily care reports.">微信扫码关注，在线预约、接收护理日报。</p>
        </div>
      </div>
      <div class="footer-cols">
        <div>
          <h2 data-en="Services">服务</h2>
          <ul>
            <li><a href="services.html#hospital" data-en="Hospital companion care">医院陪护</a></li>
            <li><a href="services.html#rehab" data-en="Rehabilitation care">康复护理</a></li>
            <li><a href="services.html#home" data-en="Home care">居家照护</a></li>
            <li><a href="services.html#health" data-en="Health management">健康管理</a></li>
            <li><a href="how-it-works.html#pricing" data-en="Pricing">收费标准</a></li>
          </ul>
        </div>
        <div>
          <h2 data-en="For families">家属服务</h2>
          <ul>
            <li><a href="book.html" data-en="Book care">预约照护</a></li>
            <li><a href="how-it-works.html" data-en="How it works">服务流程</a></li>
            <li><a href="how-it-works.html#faq" data-en="FAQ">常见问题</a></li>
            <li><a href="locations.html" data-en="Locations">服务网点</a></li>
            <li><a href="guides.html" data-en="Care guides">照护知识</a></li>
          </ul>
        </div>
        <div>
          <h2 data-en="Company">公司</h2>
          <ul>
            <li><a href="about.html" data-en="About us">关于我们</a></li>
            <li><a href="news.html" data-en="News">新闻动态</a></li>
            <li><a href="careers.html" data-en="Careers">加入我们</a></li>
            <li><a href="locations.html#hospitals" data-en="For hospitals">医院合作</a></li>
            <li><a href="mailto:{SITE["email"]}">{SITE["email"]}</a></li>
          </ul>
        </div>
      </div>
    </div>
    <div class="footer-base">
      <p>&copy; <span data-year>{date.today().year}</span> <span data-en="Kang Hutong. All rights reserved.">康护通 版权所有</span></p>
      <ul>
        <li><a href="privacy.html" data-en="Privacy policy">隐私政策</a></li>
        <li>{icp}</li>
      </ul>
    </div>
  </div>
</footer>
{action_bar}<button class="to-top" type="button" aria-label="回到顶部" data-en-aria-label="Back to top">{icon("chev")}</button>
</body>
</html>
"""


def attrs(s):
    return dict(re.findall(r'([\w-]+)="([^"]*)"', s))


def expand(body):
    # <kht-icon name="check"></kht-icon>
    body = re.sub(r'<kht-icon name="([\w-]+)"></kht-icon>', lambda m: icon(m.group(1)), body)

    # <kht-photo name="hero" alt="…" alt-en="…" brief="…" w="1200" h="900" eager class="…" ratio="4 / 3"></kht-photo>
    def photo(m):
        a = attrs(m.group(1))
        eager = " eager" in m.group(1) or m.group(1).endswith("eager")
        cls = ("photo " + a.get("class", "")).strip()
        style = f' style="--ratio: {a["ratio"]}"' if "ratio" in a else ""
        load = 'fetchpriority="high"' if eager else 'loading="lazy" decoding="async"'
        return (f'<figure class="{cls}"{style}>'
                f'<img src="assets/img/photos/{a["name"]}.jpg" alt="{a.get("alt", "")}" data-en-alt="{a.get("alt-en", "")}" '
                f'width="{a.get("w", "1200")}" height="{a.get("h", "900")}" {load}>'
                f'<p class="photo-brief" aria-hidden="true">建议画面（{a["name"]}.jpg）：{a.get("brief", "")}</p></figure>')
    body = re.sub(r"<kht-photo ([^>]*)></kht-photo>", photo, body)

    # <kht-crumb zh="服务项目" en="Services"></kht-crumb>
    def crumb(m):
        a = attrs(m.group(1))
        return ('<nav class="breadcrumb" aria-label="面包屑导航" data-en-aria-label="Breadcrumb"><ol>'
                '<li><a href="./" data-en="Home">首页</a></li>'
                f'<li aria-current="page" data-en="{a["en"]}">{a["zh"]}</li></ol></nav>')
    body = re.sub(r"<kht-crumb ([^>]*)></kht-crumb>", crumb, body)

    for k, v in SITE.items():
        body = body.replace("{{" + k.upper() + "}}", v)
    return body


def build_pages():
    for key, tzh, ten, dzh, den, nav_key, _ in PAGES:
        body = expand((SRC / f"{key}.html").read_text(encoding="utf-8"))
        out = head(key, tzh, ten, dzh, den, nav_key) + body + foot(key)
        leftover = re.findall(r"<kht-[\w-]+|\{\{[A-Z_]+\}\}", out)
        if leftover:
            raise SystemExit(f"{key}: unexpanded {leftover}")
        (ROOT / f"{key}.html").write_text(out, encoding="utf-8")
    print(f"built {len(PAGES)} pages")


def build_meta():
    today = date.today().isoformat()
    urls = []
    for key, *_rest in PAGES:
        if not _rest[-1]:
            continue
        loc = SITE["url"] + "/" + ("" if key == "index" else f"{key}.html")
        urls.append(f"  <url><loc>{loc}</loc><lastmod>{today}</lastmod></url>")
    (ROOT / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "\n".join(urls) + "\n</urlset>\n", encoding="utf-8")
    (ROOT / "robots.txt").write_text(f"User-agent: *\nAllow: /\n\nSitemap: {SITE['url']}/sitemap.xml\n", encoding="utf-8")


class SerifText(HTMLParser):
    """Collects the text (both languages) of elements set in the serif face, so the font subset stays small."""
    SERIF_TAGS = {"h1", "h2", "h3"}
    SERIF_CLASSES = {"brand-name", "care-report-title", "standard-figure", "sum", "big", "footer-phone",
                     "phone-big", "big-num", "serif", "statement", "estimate-total"}
    VOID = {"img", "input", "br", "meta", "link", "use", "hr", "source"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.text = []

    def _serif(self):
        return any(self.stack)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        on = tag in self.SERIF_TAGS or bool(self.SERIF_CLASSES & set((a.get("class") or "").split()))
        if self._serif() or on:
            self.text.append(html.unescape(a.get("data-en", "")))
        if tag not in self.VOID:
            self.stack.append(on)

    def handle_endtag(self, tag):
        if tag not in self.VOID and self.stack:
            self.stack.pop()

    def handle_data(self, data):
        if self._serif():
            self.text.append(data)


def build_fonts():
    try:
        from fontTools import subset
    except ImportError:
        print("fonttools not installed: skipped font subsetting (pip install fonttools brotli)")
        return
    chars = set()
    for p in ROOT.glob("*.html"):
        collector = SerifText()
        collector.feed(p.read_text(encoding="utf-8"))
        chars.update("".join(collector.text))
    cjk = "".join(sorted(c for c in chars if ord(c) >= 0x2E80))
    latin = "".join(chr(c) for c in range(0x20, 0x7F)) + "".join(sorted(c for c in chars if 0x7F <= ord(c) < 0x2E80))
    fonts_out = ROOT / "assets" / "fonts"
    fonts_out.mkdir(parents=True, exist_ok=True)
    src = ROOT / "tools" / "fonts-src"
    for weight in ("500", "600"):
        for part, chars_for, srcname in (("cjk", cjk, "chinese-simplified"), ("latin", latin, "latin")):
            opts = subset.Options()
            opts.flavor = "woff2"
            opts.layout_features = ["*"]
            opts.name_IDs = ["*"]
            font = subset.load_font(str(src / f"noto-serif-sc-{srcname}-{weight}-normal.woff2"), opts)
            sub = subset.Subsetter(opts)
            sub.populate(text=chars_for)
            sub.subset(font)
            out = fonts_out / f"kht-serif-{part}-{weight}.woff2"
            subset.save_font(font, str(out), opts)
            print(f"font {out.name}: {out.stat().st_size // 1024} KB")


if __name__ == "__main__":
    build_pages()
    build_meta()
    build_fonts()
