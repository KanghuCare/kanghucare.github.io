/* 康护通 KanghuCare — site behaviour. No dependencies. */
(function () {
  "use strict";

  var root = document.documentElement;
  root.classList.add("js");
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Language: zh-CN in the markup, English in data-en ---------- */
  var LANG_KEY = "khtLang";
  var ATTRS = ["placeholder", "aria-label", "content", "alt", "title"];
  var camel = function (s) { return s.replace(/(^|-)(\w)/g, function (_, __, c) { return c.toUpperCase(); }); };

  function storedLang() { try { return localStorage.getItem(LANG_KEY); } catch (e) { return null; } }
  function storeLang(v) { try { localStorage.setItem(LANG_KEY, v); } catch (e) { /* storage unavailable */ } }
  function isEn() { return root.lang === "en"; }

  function applyLang(lang) {
    var en = lang === "en";
    document.querySelectorAll("[data-en]").forEach(function (el) {
      if (el.dataset.zh === undefined) el.dataset.zh = el.innerHTML;
      el.innerHTML = en ? el.dataset.en : el.dataset.zh;
    });
    ATTRS.forEach(function (attr) {
      var key = "en" + camel(attr), zhKey = "zh" + camel(attr);
      document.querySelectorAll("[data-en-" + attr + "]").forEach(function (el) {
        if (el.dataset[zhKey] === undefined) el.dataset[zhKey] = el.getAttribute(attr) || "";
        el.setAttribute(attr, en ? el.dataset[key] : el.dataset[zhKey]);
      });
    });
    root.lang = en ? "en" : "zh-CN";
    var title = document.querySelector("title");
    if (title && title.dataset.en) {
      if (title.dataset.zh === undefined) title.dataset.zh = document.title;
      document.title = en ? title.dataset.en : title.dataset.zh;
    }
    document.querySelectorAll(".lang-toggle").forEach(function (btn) {
      btn.textContent = en ? "中文" : "EN";
      btn.setAttribute("aria-label", en ? "切换到中文" : "Switch to English");
      btn.setAttribute("lang", en ? "zh-CN" : "en");
    });
    document.dispatchEvent(new CustomEvent("kht:lang"));
  }

  var lang = new URLSearchParams(location.search).get("lang") || storedLang() || "zh";
  if (lang === "en") applyLang("en");
  document.querySelectorAll(".lang-toggle").forEach(function (btn) {
    btn.addEventListener("click", function () {
      lang = isEn() ? "zh" : "en";
      storeLang(lang);
      applyLang(lang);
    });
  });

  /* ---------- Mobile menu ---------- */
  var menuBtn = document.querySelector(".menu-toggle");
  var nav = document.getElementById("site-nav");
  function setMenu(open) {
    var hdr = document.querySelector(".site-header");
    if (open && hdr) root.style.setProperty("--menu-top", Math.round(hdr.getBoundingClientRect().bottom) + "px");
    root.classList.toggle("menu-open", open);
    if (menuBtn) menuBtn.setAttribute("aria-expanded", String(open));
  }
  if (menuBtn && nav) {
    menuBtn.addEventListener("click", function () { setMenu(menuBtn.getAttribute("aria-expanded") !== "true"); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && root.classList.contains("menu-open")) { setMenu(false); menuBtn.focus(); }
    });
    nav.addEventListener("click", function (e) { if (e.target.closest("a")) setMenu(false); });
    window.matchMedia("(min-width: 67rem)").addEventListener("change", function (mq) { if (mq.matches) setMenu(false); });
  }

  /* ---------- Header border once scrolled ---------- */
  var header = document.querySelector(".site-header");
  if (header) {
    var ticking = false;
    var onScroll = function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { header.classList.toggle("is-scrolled", window.scrollY > 8); ticking = false; });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  /* ---------- Photos: soft background while loading, then fade the photo in ---------- */
  document.querySelectorAll(".photo img").forEach(function (img) {
    var fig = img.closest(".photo");
    var ok = function () { fig.classList.add("has-photo"); img.style.opacity = "1"; };
    var fail = function () { img.remove(); };
    if (img.complete) { if (img.naturalWidth) ok(); else fail(); }
    else { img.style.opacity = "0"; img.addEventListener("load", ok); img.addEventListener("error", fail); }
  });

  /* ---------- Hero: one orchestrated entrance ---------- */
  var heroVisual = document.querySelector(".hero-visual");
  if (heroVisual) {
    heroVisual.querySelectorAll(".care-log li").forEach(function (li, i) { li.style.setProperty("--i", i); });
    requestAnimationFrame(function () { heroVisual.classList.add("is-live"); });
  }

  /* ---------- Reveal on scroll (photos, journey) ---------- */
  var reveals = document.querySelectorAll(".reveal, .journey");
  if ("IntersectionObserver" in window && !reduceMotion) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { entry.target.classList.add("is-visible"); io.unobserve(entry.target); }
      });
    }, { rootMargin: "0px 0px -10% 0px" });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("is-visible"); });
  }

  /* ---------- In-page subnav: highlight the section in view ---------- */
  var subLinks = document.querySelectorAll(".subnav a[href^='#']");
  if (subLinks.length && "IntersectionObserver" in window) {
    var byId = {};
    subLinks.forEach(function (a) { byId[a.getAttribute("href").slice(1)] = a; });
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        subLinks.forEach(function (a) { a.classList.remove("is-active"); a.removeAttribute("aria-current"); });
        var link = byId[entry.target.id];
        if (link) { link.classList.add("is-active"); link.setAttribute("aria-current", "true"); }
      });
    }, { rootMargin: "-40% 0px -55% 0px" });
    Object.keys(byId).forEach(function (id) { var s = document.getElementById(id); if (s) spy.observe(s); });
  }

  /* ---------- Open a guide or FAQ when its link is followed ---------- */
  var openFromHash = function () {
    var target = location.hash && document.getElementById(location.hash.slice(1));
    if (target && target.tagName === "DETAILS") target.open = true;
  };
  openFromHash();
  window.addEventListener("hashchange", openFromHash);

  /* ---------- Preselect a service from ?service= on the booking page ---------- */
  var preService = new URLSearchParams(location.search).get("service");
  if (preService) {
    var radio = document.querySelector('input[name="service"][value="' + preService.replace(/[^a-z]/g, "") + '"]');
    if (radio) radio.checked = true;
  }

  /* ---------- Preselect care level from ?level= on the booking page ---------- */
  var preLevel = new URLSearchParams(location.search).get("level");
  if (preLevel) {
    var lv = document.querySelector('input[name="level"][value="' + preLevel.replace(/[^a-z0-9]/g, "") + '"]');
    if (lv) lv.checked = true;
  }

  /* ---------- Mobile action bar and back-to-top ---------- */
  var actionBar = document.querySelector(".action-bar");
  var toTop = document.querySelector(".to-top");
  if (actionBar) document.body.classList.add("has-action-bar");
  if (actionBar || toTop) {
    var floatTick = false;
    var onFloat = function () {
      if (floatTick) return;
      floatTick = true;
      requestAnimationFrame(function () {
        var y = window.scrollY;
        if (actionBar) actionBar.classList.toggle("is-shown", y > 420);
        if (toTop) toTop.classList.toggle("is-shown", y > 1400);
        floatTick = false;
      });
    };
    window.addEventListener("scroll", onFloat, { passive: true });
    onFloat();
  }
  if (toTop) {
    toTop.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
      var main = document.getElementById("main");
      if (main) main.focus({ preventScroll: true });
    });
  }

  /* ---------- Care needs check ---------- */
  var check = document.getElementById("care-check");
  if (check) {
    var resultBox = document.getElementById("check-result");
    var bars = resultBox.querySelectorAll(".check-progress span");
    var L = function (zh, en) { return isEn() ? en : zh; };
    var SERVICE = {
      hospital: ["医院陪护", "Hospital companion care"],
      rehab: ["康复护理", "Rehabilitation care"],
      home: ["居家照护", "Home care"],
      health: ["健康管理", "Health management"]
    };
    var CAREGIVER = {
      "0": ["高级护工，一对一", "Senior caregiver, one-to-one"],
      "1": ["中级护工，一对一", "Intermediate caregiver, one-to-one"],
      "2": ["初级护工，一对多（最多 3 床）", "Junior caregiver, shared (up to 3 beds)"]
    };
    var PRICE = {
      short: ["标准日价", "Standard daily rate"],
      mid: ["九五折（3 至 7 天）", "5% off (3 to 7 days)"],
      long: ["九折（超过 7 天）", "10% off (over 7 days)"],
      unsure: ["预约 3 天以上享折扣", "Discounts from 3 days"]
    };
    var val = function (name) { var r = check.querySelector('input[name="' + name + '"]:checked'); return r ? r.value : ""; };

    var renderCheck = function (animate) {
      var where = val("where"), help = val("help"), days = val("days"), recovery = val("recovery");
      var answered = [where, help, days, recovery].filter(Boolean).length;
      bars.forEach(function (b, i) { b.classList.toggle("is-done", i < answered); });
      var body = resultBox.querySelector(".result-body");
      if (!where || !help) {
        body.innerHTML = "<h3>" + L("回答前两个问题，即可看到建议", "Answer the first two questions to see our suggestion") + "</h3><p>" +
          L("不需要填写任何个人信息。", "No personal details needed.") + "</p>";
        return;
      }
      var services = [];
      var primary;
      if (where === "hospital") { primary = "hospital"; services.push("hospital"); }
      else if (where === "home") { primary = "home"; services.push("home"); }
      else { primary = "health"; services.push("health"); if (help !== "2") services.push("home"); }
      if (recovery === "yes") services.push("rehab");

      var rows = [[L("推荐服务", "Suggested care"), services.map(function (k) { return L(SERVICE[k][0], SERVICE[k][1]); }).join(L("＋", " + "))]];
      if (where === "hospital") {
        rows.push([L("护工安排", "Caregiver"), L(CAREGIVER[help][0], CAREGIVER[help][1])]);
        rows.push([L("收费", "Pricing"), L(PRICE[days || "unsure"][0], PRICE[days || "unsure"][1])]);
      } else {
        rows.push([L("护工安排", "Caregiver"), L("上门评估后安排", "Arranged after a home assessment")]);
      }
      var levelParam = help;
      var href = "book.html?service=" + primary + "&level=" + levelParam;
      body.innerHTML =
        '<p class="result-label">' + L("我们的建议", "Our suggestion") + "</p>" +
        "<h3>" + L(SERVICE[primary][0], SERVICE[primary][1]) + "</h3>" +
        "<dl>" + rows.map(function (r) { return "<dt>" + r[0] + "</dt><dd>" + r[1] + "</dd>"; }).join("") + "</dl>" +
        '<p class="note">' + L("最终方案由护理顾问与您确认，开始前不收取任何费用。", "A care adviser confirms the final plan with you. Nothing is charged before care begins.") + "</p>" +
        '<div class="hero-actions"><a class="btn btn-primary" href="' + href + '">' + L("按此建议预约", "Book with this plan") + "</a>" +
        '<a class="btn btn-secondary" href="tel:' + check.getAttribute("data-tel") + '">' + L("先打电话问问", "Call us first") + "</a></div>";
      if (animate && !reduceMotion) {
        resultBox.classList.remove("is-updated");
        void resultBox.offsetWidth;
        resultBox.classList.add("is-updated");
      }
    };
    check.addEventListener("change", function () { renderCheck(true); });
    document.addEventListener("kht:lang", function () { renderCheck(false); });
    renderCheck(false);
  }

  /* ---------- Cost estimator ---------- */
  var est = document.getElementById("estimator");
  if (est) {
    var rateIn = document.getElementById("est-rate");
    var daysIn = document.getElementById("est-days");
    var totalOut = document.getElementById("est-total");
    var detailOut = document.getElementById("est-detail");
    var fmt = function (n) { return "¥" + Math.round(n).toLocaleString("en-US"); };
    var renderEst = function () {
      var rate = parseFloat(rateIn.value), days = parseInt(daysIn.value, 10);
      if (!(rate > 0) || !(days > 0)) {
        totalOut.textContent = "—";
        detailOut.textContent = isEn() ? "Enter a daily rate and number of days." : "请输入日价和天数。";
        return;
      }
      var k = days > 7 ? 0.9 : days >= 3 ? 0.95 : 1;
      var tier = days > 7 ? (isEn() ? "10% off for over 7 days" : "超过 7 天九折")
        : days >= 3 ? (isEn() ? "5% off for 3 to 7 days" : "3 至 7 天九五折")
        : (isEn() ? "standard rate under 3 days" : "少于 3 天按标准日价");
      totalOut.textContent = fmt(rate * days * k);
      detailOut.textContent = rate + " × " + days + (isEn() ? " days" : " 天") + (k < 1 ? " × " + k : "") + (isEn() ? " (" + tier + ")" : "（" + tier + "）");
    };
    est.addEventListener("input", renderEst);
    document.addEventListener("kht:lang", renderEst);
    renderEst();
  }

  /* ---------- Opening: remove the intro layer once it has played ---------- */
  if (root.classList.contains("intro-on")) {
    setTimeout(function () { var intro = document.querySelector(".intro"); if (intro) intro.remove(); }, 2000);
  }

  /* ---------- Large-text mode ---------- */
  document.querySelectorAll(".text-size").forEach(function (btn) {
    btn.setAttribute("aria-pressed", String(root.classList.contains("large-text")));
    btn.addEventListener("click", function () {
      var on = root.classList.toggle("large-text");
      btn.setAttribute("aria-pressed", String(on));
      try { localStorage.setItem("khtLarge", on ? "1" : "0"); } catch (e) { /* storage unavailable */ }
    });
  });

  /* ---------- Reading progress ---------- */
  var bar = document.querySelector(".read-progress span");
  if (bar) {
    var progTick = false;
    var onProg = function () {
      if (progTick) return;
      progTick = true;
      requestAnimationFrame(function () {
        var max = document.documentElement.scrollHeight - window.innerHeight;
        bar.style.transform = "scaleX(" + (max > 0 ? Math.min(1, window.scrollY / max) : 0) + ")";
        progTick = false;
      });
    };
    window.addEventListener("scroll", onProg, { passive: true });
    window.addEventListener("resize", onProg);
    onProg();
  }

  /* ---------- Site search ---------- */
  var dlg = document.getElementById("site-search");
  if (dlg && typeof dlg.showModal === "function") {
    var sInput = document.getElementById("search-input");
    var sList = document.getElementById("search-results");
    var sStatus = document.getElementById("search-status");
    var index = null;
    var escH = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
    var mark = function (text, q) {
      var i = text.toLowerCase().indexOf(q);
      return i < 0 ? escH(text) : escH(text.slice(0, i)) + "<mark>" + escH(text.slice(i, i + q.length)) + "</mark>" + escH(text.slice(i + q.length));
    };
    var runSearch = function () {
      var q = sInput.value.trim().toLowerCase();
      if (!q || !index) { sList.innerHTML = ""; sStatus.textContent = ""; return; }
      var en = isEn();
      var hits = index.filter(function (e) {
        return [e.zh, e.en, e.pz, e.pe].some(function (v) { return v && v.toLowerCase().indexOf(q) !== -1; });
      }).slice(0, 12);
      sList.innerHTML = hits.map(function (e) {
        var title = en && e.en ? e.en : e.zh;
        return '<li><a href="' + escH(e.u) + '"><strong>' + mark(title, q) + "</strong><small>" + escH(en ? e.pe : e.pz) + "</small></a></li>";
      }).join("");
      sStatus.textContent = hits.length
        ? (en ? hits.length + " results" : "找到 " + hits.length + " 条结果")
        : (en ? "No results. Try another word, or call us." : "没有找到相关内容，换个词试试，或直接致电我们。");
    };
    var openSearch = function () {
      if (dlg.open) return;
      dlg.showModal();
      sInput.focus();
      if (!index) {
        (window.KHT_DATA && window.KHT_DATA.search
          ? Promise.resolve(window.KHT_DATA.search)
          : fetch("assets/data/search.json").then(function (r) { return r.json(); }))
          .then(function (d) { index = d; runSearch(); })
          .catch(function () { sStatus.textContent = isEn() ? "Search is unavailable right now." : "搜索暂时不可用。"; });
      }
    };
    document.querySelectorAll(".search-toggle").forEach(function (b) { b.addEventListener("click", openSearch); });
    document.addEventListener("keydown", function (e) {
      var typing = /input|textarea|select/i.test((e.target && e.target.tagName) || "") || (e.target && e.target.isContentEditable);
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) { e.preventDefault(); openSearch(); }
    });
    sInput.addEventListener("input", runSearch);
    // In a search field Escape would only clear the text; close the dialog straight away instead.
    sInput.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.preventDefault(); dlg.close(); } });
    dlg.addEventListener("click", function (e) {
      if (e.target === dlg) dlg.close();                        // click on the backdrop
      if (e.target.closest && e.target.closest(".search-results a, .search-suggest a")) dlg.close();
    });
  }

  /* ---------- Count up the standards figures when they come into view ---------- */
  var figs = document.querySelectorAll(".standard-figure");
  if (figs.length && "IntersectionObserver" in window && !reduceMotion) {
    var countIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        countIO.unobserve(entry.target);
        var node = entry.target.firstChild;
        if (!node || node.nodeType !== 3) return;
        var target = parseFloat(node.nodeValue);
        if (isNaN(target) || /:/.test(node.nodeValue)) return;
        var decimals = (node.nodeValue.split(".")[1] || "").length;
        var start = null, dur = 1200;
        var step = function (t) {
          if (start === null) start = t;
          var k = Math.min(1, (t - start) / dur);
          var eased = 1 - Math.pow(1 - k, 3);
          node.nodeValue = (target * eased).toFixed(decimals);
          if (k < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    }, { threshold: 0.6 });
    figs.forEach(function (f) { countIO.observe(f); });
  }

  /* ---------- Staggered reveal for headings and card groups ---------- */
  if ("IntersectionObserver" in window && !reduceMotion) {
    var groups = [".section-head", ".section-head-row", ".needs > li", ".answers > .answer", ".standards > .standard",
      ".steps > li", ".card-grid > *", ".org > div", ".duo > *", ".path > li", ".care-check", ".service-block > div"];
    var rvIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { entry.target.classList.add("is-visible"); rvIO.unobserve(entry.target); }
      });
    }, { rootMargin: "0px 0px -8% 0px" });
    groups.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (el) {
        if (el.closest(".hero") || (sel === ".section-head" && el.parentElement.classList.contains("section-head-row"))) return;
        var sibs = el.parentElement ? Array.prototype.indexOf.call(el.parentElement.children, el) : 0;
        el.classList.add("rv");
        el.style.setProperty("--d", Math.min(sibs, 5));
        rvIO.observe(el);
      });
    });
  }

  /* ---------- Footer year ---------- */
  document.querySelectorAll("[data-year]").forEach(function (el) { el.textContent = new Date().getFullYear(); });

  /* ---------- Location finder ---------- */
  var finder = document.getElementById("location-finder");
  if (finder) {
    var list = document.getElementById("location-results");
    var empty = document.getElementById("location-empty");
    var input = document.getElementById("city-search");
    var status = document.getElementById("location-status");
    var locations = [];
    var t = function (zh, en) { return isEn() ? (en || zh) : zh; };
    var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };

    var render = function () {
      var q = input.value.trim().toLowerCase();
      var hits = locations.filter(function (l) {
        return !q || [l.city, l.cityEn, l.name, l.nameEn].some(function (v) { return v && v.toLowerCase().indexOf(q) !== -1; });
      });
      list.innerHTML = hits.map(function (l) {
        var hospitals = (isEn() ? l.hospitalsEn || l.hospitals : l.hospitals) || [];
        return '<li class="location"><h3>' + esc(t(l.name, l.nameEn)) + "</h3>" +
          "<p>" + esc(t(l.address, l.addressEn)) + "</p>" +
          '<p><a href="tel:' + esc(l.tel.replace(/[^0-9+]/g, "")) + '">' + esc(l.tel) + "</a></p>" +
          (hospitals.length ? '<div class="tags">' + hospitals.map(function (h) { return '<span class="chip">' + esc(h) + "</span>"; }).join("") + "</div>" : "") +
          "</li>";
      }).join("");
      empty.hidden = hits.length > 0;
      status.textContent = isEn()
        ? hits.length + (hits.length === 1 ? " location found" : " locations found")
        : "找到 " + hits.length + " 个服务网点";
    };

    finder.addEventListener("submit", function (e) { e.preventDefault(); render(); });
    input.addEventListener("input", render);
    document.addEventListener("kht:lang", render);
    var preset = new URLSearchParams(location.search).get("city");
    if (preset) input.value = preset;
    (window.KHT_DATA && window.KHT_DATA.locations
      ? Promise.resolve(window.KHT_DATA.locations)
      : fetch(finder.getAttribute("data-source")).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }))
      .then(function (data) { locations = data.locations || []; render(); })
      .catch(function () { status.textContent = t("网点信息加载失败，请致电服务热线查询。", "We couldn’t load locations. Please call our service line."); });
  }

  /* ---------- Forms (booking, careers, partnerships) ---------- */
  document.querySelectorAll("form[data-kht-form]").forEach(function (form) {
    var summary = form.parentElement.querySelector(".form-summary");
    var msg = function (el, kind) { return el.getAttribute("data-msg-" + kind + (isEn() ? "-en" : "")) || ""; };

    var validate = function (el) {
      var group = el.type === "radio" ? form.querySelectorAll('[name="' + el.name + '"]') : null;
      var holder = group ? group[0].closest("fieldset") : el;
      var errorEl = document.getElementById((group ? el.name : el.id) + "-error");
      var text = "";
      if (group) {
        if (!Array.prototype.some.call(group, function (r) { return r.checked; })) text = msg(holder, "required");
        group.forEach(function (r) { r.setAttribute("aria-invalid", text ? "true" : "false"); });
      } else {
        if (el.validity.valueMissing) text = msg(el, "required");
        else if (!el.validity.valid) text = msg(el, "format");
        el.setAttribute("aria-invalid", text ? "true" : "false");
      }
      if (errorEl) errorEl.textContent = text;
      return text;
    };

    var checked = form.querySelectorAll("[required], [pattern], input[type=number], input[type=date]");
    checked.forEach(function (el) {
      if (el.type === "radio" || el.type === "checkbox") {
        el.addEventListener("change", function () { validate(el); });
      } else {
        el.addEventListener("blur", function (e) {
          // Moving to the submit button validates everything anyway; validating here would shift the button mid-click.
          if (e.relatedTarget && e.relatedTarget.type === "submit") return;
          if (el.value || el.getAttribute("aria-invalid") === "true") validate(el);
        });
      }
    });
    form.querySelectorAll("input[type=date][data-min-today]").forEach(function (d) {
      var now = new Date();
      d.min = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    });

    var showResult = function (id) {
      form.hidden = true;
      if (summary) summary.hidden = true;
      var box = document.getElementById(id);
      box.hidden = false;
      box.scrollIntoView({ block: "start" });
      box.focus({ preventScroll: true });
    };

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var problems = [], seen = {};
      checked.forEach(function (el) {
        if (el.type === "radio") { if (seen[el.name]) return; seen[el.name] = true; }
        if (!el.required && !el.value) return;
        var text = validate(el);
        if (text) problems.push({ id: el.id || (el.type === "radio" && form.querySelector('[name="' + el.name + '"]').id), text: text });
      });

      if (problems.length) {
        var ul = summary.querySelector("ul");
        ul.innerHTML = "";
        problems.forEach(function (p) {
          var li = document.createElement("li"), a = document.createElement("a");
          a.href = "#" + p.id;
          a.textContent = p.text;
          a.addEventListener("click", function (ev) { ev.preventDefault(); document.getElementById(p.id).focus(); });
          li.appendChild(a);
          ul.appendChild(li);
        });
        summary.hidden = false;
        summary.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
        summary.focus({ preventScroll: true });
        return;
      }
      if (summary) summary.hidden = true;

      var endpoint = form.getAttribute("data-endpoint");
      if (!endpoint && form.getAttribute("data-demo") === "1") {
        // Demo mode: show the normal confirmation, but nothing is sent anywhere.
        var demoBtn = form.querySelector('button[type="submit"]');
        demoBtn.disabled = true;
        setTimeout(function () {
          var box = document.getElementById(form.getAttribute("data-success"));
          if (box && !box.querySelector(".demo-tag")) {
            var tag = document.createElement("p");
            tag.className = "demo-tag";
            tag.textContent = isEn() ? "Demo mode: nothing was sent." : "演示模式：本次提交未发送任何数据";
            box.appendChild(tag);
          }
          showResult(form.getAttribute("data-success"));
        }, 700);
        return;
      }
      if (!endpoint) { showResult(form.getAttribute("data-unavailable")); return; }

      var btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      var payload = {};
      new FormData(form).forEach(function (v, k) {
        if (payload[k] === undefined) payload[k] = v;
        else payload[k] = [].concat(payload[k], v);
      });
      payload.form = form.getAttribute("data-kht-form");
      payload.lang = root.lang;
      payload.page = location.pathname;

      fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        .then(function (r) { if (!r.ok) throw new Error(r.status); showResult(form.getAttribute("data-success")); })
        .catch(function () {
          btn.disabled = false;
          var err = form.querySelector(".submit-error");
          if (err) {
            err.textContent = isEn()
              ? "We couldn’t send your request. Please try again, or call us."
              : "提交没有成功，请稍后重试，或直接致电我们。";
          }
        });
    });
  });
})();
