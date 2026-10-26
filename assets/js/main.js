/* 康护通 Kang Hutong — site behaviour. No dependencies. */
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

  /* ---------- Photos: show the brief until a real photo exists ---------- */
  document.querySelectorAll(".photo img").forEach(function (img) {
    var fig = img.closest(".photo");
    var ok = function () { fig.classList.add("has-photo"); };
    var fail = function () { img.remove(); };
    if (img.complete) { if (img.naturalWidth) ok(); else fail(); }
    else { img.addEventListener("load", ok); img.addEventListener("error", fail); }
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
    fetch(finder.getAttribute("data-source"))
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
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
