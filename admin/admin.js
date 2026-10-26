/* 康护通 KanghuCare — care management system (staff side).
   Demo data lives in this browser's localStorage, so every page shares one set of patients, orders and caregivers. */
(function () {
  "use strict";

  /* ---------- Codes and business rules (see the system design report) ---------- */
  var DEPTS = { "01": "普外科", "02": "呼吸科", "03": "骨科", "04": "肿瘤科", "05": "神经内科", "06": "重症康复", "07": "妇产科", "08": "心内科" };
  var LEVELS = ["完全失能", "半失能", "基本自理"];           // 护理等级代码 0/1/2
  var GRADES = { 1: "高级", 2: "中级", 3: "初级" };           // 护工等级（护工编号第 1 位）
  var STATUS = { 0: "待派单", 1: "服务中", 2: "待支付", 3: "已结清", 9: "已取消" };
  var RULE = [                                                  // 判断表：护理等级 → 护工等级、服务方式、标准日价
    { grade: 1, mode: "一对一", rate: 280, action: "派高级护工一对一" },
    { grade: 2, mode: "一对一", rate: 200, action: "派中级护工一对一" },
    { grade: 3, mode: "一对多（1:3）", rate: 120, action: "派初级护工一对多" }
  ];
  var NEEDS = { turning: "翻身拍背", tube: "鼻饲喂养", catheter: "导尿护理", night: "夜间陪护", rehab: "康复训练" };
  var EXTRAS = { night: 20, rehab: 30 };                        // 附加服务（元/天）
  var DEPOSIT = 500;
  var PAY_TYPES = { 1: "微信支付", 2: "支付宝", 3: "银行卡" };

  function discountFor(days) { return days < 3 ? 1 : days <= 7 ? 0.95 : 0.9; }
  function discountLabel(k) { return k === 1 ? "标准日价" : k === 0.95 ? "九五折（3～7天）" : "九折（>7天）"; }
  function ruleNo(level, days) { return level * 3 + (days < 3 ? 1 : days <= 7 ? 2 : 3); }

  /* 校验位：加权求和后模 11，校验位 = (11 − r) mod 11，结果为 10 的流水号跳过不用 */
  function checkDigit(body, weights) {
    var s = 0;
    for (var i = 0; i < body.length; i++) s += Number(body[i]) * weights[i];
    return (11 - (s % 11)) % 11;
  }
  var ORDER_W = [2, 3, 4, 5, 6, 7, 2, 3, 4, 5, 6];
  var CARER_W = [2, 3, 4, 5, 6, 7, 2];
  function validOrderId(id) { return /^\d{12}$/.test(id) && checkDigit(id.slice(0, 11), ORDER_W) === Number(id[11]); }

  /* ---------- Helpers ---------- */
  function pad(n, w) { n = String(n); while (n.length < (w || 2)) n = "0" + n; return n; }
  function today() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function iso(d) { d = new Date(d); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function md(d) { d = new Date(d); return pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function ymd6(d) { d = new Date(d); return String(d.getFullYear()).slice(2) + pad(d.getMonth() + 1) + pad(d.getDate()); }
  function parse(s) { var p = String(s).slice(0, 10).split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function dayDiff(a, b) { return Math.round((parse(iso(b)) - parse(iso(a))) / 864e5); }
  function now() { var d = new Date(); return iso(d) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function money(n) { return Number(n).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function param(name) { return new URLSearchParams(location.search).get(name); }
  function stars(n) { return "★★★★★".slice(0, n) + "☆☆☆☆☆".slice(0, 5 - n); }
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  function toast(msg, kind) {
    var t = document.createElement("div");
    t.className = "toast" + (kind ? " is-" + kind : "");
    t.setAttribute("role", "status");
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }
  function modal(title, html, buttons) {
    var d = document.createElement("dialog");
    d.className = "modal";
    d.innerHTML = '<div class="modal-head"><span>' + esc(title) + '</span><button type="button" aria-label="关闭">×</button></div><div class="modal-body">' + html + "</div>";
    if (buttons) { var a = document.createElement("div"); a.className = "actions"; a.style.margin = "0 0 1.1rem"; buttons.forEach(function (b) { a.appendChild(b); }); d.appendChild(a); }
    $(".modal-head button", d).addEventListener("click", function () { d.close(); });
    d.addEventListener("close", function () { d.remove(); });
    document.body.appendChild(d);
    d.showModal();
    return d;
  }
  function button(text, cls, fn) { var b = document.createElement("button"); b.type = "button"; b.className = "btn " + (cls || ""); b.textContent = text; b.addEventListener("click", fn); return b; }

  /* ---------- Demo data ---------- */
  var KEY = "kht-admin-v1";
  var SESSION = "kht-admin-session";

  function newOrderId(db, dept, date) {
    for (var serial = 1; serial < 1000; serial++) {
      var body = dept + ymd6(date) + pad(serial, 3);
      var c = checkDigit(body, ORDER_W);
      if (c === 10) continue;
      var id = body + c;
      if (!db.orders.some(function (o) { return o.id === id; })) return id;
    }
    throw new Error("当日该科室订单已满");
  }
  function carerId(grade, yy, seq, taken) {
    for (;; seq++) {
      var body = String(grade) + pad(yy) + pad(seq, 4);
      var c = checkDigit(body, CARER_W);
      if (c !== 10 && taken.indexOf(body + c) < 0) return body + c;
    }
  }

  function seed() {
    var r = rng(20261026), T = today();
    function pick(a) { return a[Math.floor(r() * a.length)]; }
    function weighted(pairs) { var x = r(), acc = 0; for (var i = 0; i < pairs.length; i++) { acc += pairs[i][1]; if (x <= acc) return pairs[i][0]; } return pairs[pairs.length - 1][0]; }
    var surnames = "王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾萧田董袁潘蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤".split("");
    var given = "秀兰桂芳玉梅红英华敏静丽娟霞凤琴云莲珍燕萍芬洁淑明建国伟强军平志永春海".split("");
    var db = { v: 1, seeded: iso(T), caregivers: [], orders: [], alerts: [], logs: {} };
    var taken = [];

    // Caregivers: a few named ones used in the walkthrough, then a generated roster
    var featured = [
      ["李秀兰", 1, 24, 158, 5, 98.6, { "03": 3, "01": 1 }, "女", 18],
      ["周桂芳", 1, 23, 110, 4, 97.1, { "03": 2 }, "女", 20],
      ["陈玉梅", 1, 22, 133, 4, 95.4, { "01": 4 }, "女", 21],
      ["赵淑珍", 1, 21, 87, 5, 99.1, { "03": 5 }, "女", 27],
      ["刘红", 2, 23, 94, 4, 96.8, { "03": 1, "05": 2 }, "女", 16],
      ["孙丽娟", 2, 24, 201, 4, 95.0, { "05": 3 }, "女", 19],
      ["黄建国", 2, 22, 65, 4, 93.7, { "06": 2 }, "男", 22],
      ["马春燕", 3, 25, 12, 4, 94.2, { "08": 1 }, "女", 14],
      ["高云", 3, 24, 230, 3, 91.5, { "02": 2 }, "女", 17]
    ];
    featured.forEach(function (f) {
      var id = carerId(f[1], f[2], f[3], taken); taken.push(id);
      db.caregivers.push({ id: id, name: f[0], grade: f[1], star: f[4], good: f[5], exp: f[6], gender: f[7], monthDays: f[8], status: "在岗", featured: true, joined: "20" + f[2] + "-03-01", certExpire: iso(addDays(T, 200 + f[3])) });
    });
    for (var i = 0; i < 40; i++) {
      var grade = weighted([[1, 0.3], [2, 0.4], [3, 0.3]]);
      var yy = 19 + Math.floor(r() * 7);
      var id = carerId(grade, yy, 300 + Math.floor(r() * 600), taken); taken.push(id);
      var exp = {}; exp[pick(Object.keys(DEPTS))] = 1 + Math.floor(r() * 5);
      db.caregivers.push({
        id: id, name: pick(surnames) + pick(given) + (r() < 0.5 ? pick(given) : ""), grade: grade,
        star: weighted([[5, 0.3], [4, 0.5], [3, 0.2]]), good: Math.round((90 + r() * 9.5) * 10) / 10, exp: exp,
        gender: r() < 0.85 ? "女" : "男", monthDays: 10 + Math.floor(r() * 15), status: r() < 0.08 ? "休假" : "在岗",
        joined: "20" + yy + "-0" + (1 + Math.floor(r() * 9)) + "-15", certExpire: iso(addDays(T, 60 + Math.floor(r() * 700)))
      });
    }
    var roster = db.caregivers.filter(function (c) { return !c.featured && c.status === "在岗"; });

    function patient(name) {
      return {
        name: name || pick(surnames) + "*" + (r() < 0.6 ? pick(given) : ""),
        gender: r() < 0.55 ? "男" : "女", age: 60 + Math.floor(r() * 32),
        contact: pick(surnames) + "*（" + pick(["儿子", "女儿", "配偶", "儿媳"]) + "）",
        phone: "1" + pick(["39", "38", "37", "58", "86"]) + "****" + pad(Math.floor(r() * 10000), 4)
      };
    }
    function needs(level) {
      var n = [];
      if (level === 0 || r() < 0.3) n.push("turning");
      if (level === 0 && r() < 0.5) n.push("tube");
      if (r() < 0.2) n.push("catheter");
      if (r() < 0.35) n.push("night");
      if (level < 2 && r() < 0.3) n.push("rehab");
      return n;
    }
    var busy = {};
    var deptW = [["03", 0.26], ["05", 0.2], ["01", 0.14], ["08", 0.12], ["06", 0.1], ["02", 0.08], ["04", 0.06], ["07", 0.04]];

    // Order history over the past 35 days
    for (var d = -35; d <= -1; d++) {
      var created = addDays(T, d), count = 3 + Math.floor(r() * 3);
      for (var k = 0; k < count; k++) {
        var dept = weighted(deptW), level = weighted([[0, 0.32], [1, 0.42], [2, 0.26]]);
        var days = weighted([[2, 0.12], [3, 0.12], [4, 0.1], [5, 0.12], [6, 0.08], [7, 0.12], [8, 0.08], [10, 0.12], [12, 0.08], [14, 0.06]]);
        var start = addDays(created, r() < 0.6 ? 0 : 1), end = addDays(start, days - 1);
        var o = {
          id: newOrderId(db, dept, created), created: iso(created), dept: dept, bed: 1 + Math.floor(r() * 40),
          patient: patient(), level: level, start: iso(start), days: days, needs: needs(level), slot: "24小时",
          inpatient: "ZY" + ymd6(created).slice(0, 4) + pad(Math.floor(r() * 1000), 3), status: 3, caregiver: null, note: ""
        };
        var cap = RULE[level].grade === 3 ? 3 : 1;
        var pool = roster.filter(function (c) {
          return c.grade === RULE[level].grade && (busy[c.id] || []).filter(function (b) { return b[0] <= end && b[1] >= start; }).length < cap;
        });
        if (!pool.length) continue;
        o.caregiver = pick(pool).id;
        (busy[o.caregiver] = busy[o.caregiver] || []).push([start, end]);
        if (r() < 0.03) { o.status = 9; o.caregiver = null; }
        else if (end >= T) o.status = 1;
        else if (dayDiff(end, T) <= 2 && r() < 0.6) o.status = 2;
        else { o.status = 3; o.payType = weighted([[1, 0.62], [2, 0.3], [3, 0.08]]); o.paidAt = iso(addDays(end, 1)); }
        if (o.status === 3) o.rating = weighted([[5, 0.6], [4, 0.28], [3, 0.09], [2, 0.03]]);
        db.orders.push(o);
      }
    }
    // Orders waiting for dispatch, created today
    [["钱*", "05", 9, 1, 7, ["turning", "rehab"]], ["吴*芬", "08", 2, 2, 5, []], ["孙*英", "03", 18, 0, 12, ["turning", "tube", "night"]],
     ["郑*", "02", 6, 1, 3, ["night"]], ["冯*兰", "06", 3, 0, 8, ["turning", "catheter"]]].forEach(function (p) {
      db.orders.push({ id: newOrderId(db, p[1], T), created: iso(T), dept: p[1], bed: p[2], patient: patient(p[0]), level: p[3],
        start: iso(addDays(T, 1)), days: p[4], needs: p[5], slot: "24小时", inpatient: "ZY" + ymd6(T).slice(0, 4) + pad(100 + p[2], 3), status: 0, caregiver: null, note: "" });
    });
    // Two live alerts on orders in service
    var live = db.orders.filter(function (o) { return o.status === 1; });
    if (live.length > 1) {
      db.alerts.push({ id: 1, order: live[0].id, type: "体温异常", detail: "体温 38.6℃（≥38.5℃）", time: iso(T) + " 07:42", handled: false });
      db.alerts.push({ id: 2, order: live[1].id, type: "漏打卡", detail: "“翻身拍背”超过 2 小时未打卡", time: iso(T) + " 08:15", handled: false });
    }
    db.alerts.push({ id: 3, order: db.orders[3].id, type: "护工上报", detail: "患者夜间躁动，已通知值班护士", time: iso(addDays(T, -6)) + " 02:10", handled: true });
    return db;
  }

  function load() {
    try { var db = JSON.parse(localStorage.getItem(KEY)); if (db && db.v === 1) return db; } catch (e) {}
    var fresh = seed(); save(fresh); return fresh;
  }
  function save(db) { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} }
  var db = load();

  function carer(id) { return db.caregivers.filter(function (c) { return c.id === id; })[0]; }
  function order(id) { return db.orders.filter(function (o) { return o.id === id; })[0]; }
  function endDate(o) { return addDays(parse(o.start), o.days - 1); }
  function bedLabel(o) { return DEPTS[o.dept] + " " + o.bed + "床"; }
  function needText(o) { return o.needs.length ? o.needs.map(function (n) { return NEEDS[n]; }).join("、") : "无"; }

  /* 费用计算（P-10）：应收 = 天数 × 日价 × 折扣 + 附加服务费；本次应付 = 应收 − 押金 */
  function bill(o) {
    var n = o.status === 1 ? Math.max(1, Math.min(o.days, dayDiff(o.start, today()) + 1)) : o.days;
    var rate = RULE[o.level].rate, k = discountFor(n);
    var base = Math.round(n * rate * k * 100) / 100;
    var extras = o.needs.filter(function (x) { return EXTRAS[x]; }).map(function (x) { return { name: NEEDS[x] + "附加", price: EXTRAS[x], qty: n, amount: EXTRAS[x] * n }; });
    var receivable = base + extras.reduce(function (s, e) { return s + e.amount; }, 0);
    return { days: n, rate: rate, k: k, base: base, extras: extras, receivable: receivable, deposit: DEPOSIT, payable: receivable - DEPOSIT };
  }
  function orderAmount(o) { return o.status === 9 ? 0 : o.status <= 1 ? estimate(o.level, o.days, o.needs).total : bill(o).receivable; }
  function estimate(level, days, needs) {
    var k = discountFor(days), base = days * RULE[level].rate * k;
    var extra = needs.reduce(function (s, x) { return s + (EXTRAS[x] || 0) * days; }, 0);
    return { k: k, base: base, extra: extra, total: base + extra };
  }

  /* ---------- Accounts and menus ---------- */
  var ACCOUNTS = {
    kf001: { name: "陈晓", role: "客服专员", dept: "客户服务部", menus: ["客户服务", "服务监管", "财务结算"] },
    pb001: { name: "何静", role: "排班专员", dept: "人员排班部", menus: ["客户服务", "护工管理", "调度排班", "服务监管"] },
    hs001: { name: "骨科护士站", role: "护士站", dept: "医院护士站", menus: ["服务监管"] },
    yy001: { name: "周敏", role: "运营经理", dept: "运营管理部", menus: ["客户服务", "护工管理", "调度排班", "服务监管", "财务结算", "统计决策"] },
    admin: { name: "管理员", role: "系统管理员", dept: "信息中心", menus: ["客户服务", "护工管理", "调度排班", "服务监管", "财务结算", "统计决策", "系统管理"] }
  };
  ACCOUNTS[db.caregivers[0].id] = { name: db.caregivers[0].name, role: "护工", dept: "高级护工", menus: [], carer: db.caregivers[0].id, home: "nurse.html" };
  var PASSWORD = "123456";

  var MENU = [
    ["客户服务", [["患者建档", "booking.html"], ["需求登记", null], ["预约受理", "booking.html"], ["订单查询", "orders.html"], ["投诉反馈", null]]],
    ["护工管理", [["护工登记", null], ["资质审核", null], ["培训考核", null], ["等级评定", null]]],
    ["调度排班", [["智能派单", "dispatch.html"], ["排班总览", null], ["临时换班", null], ["冲突检测", "dispatch.html"]]],
    ["服务监管", [["护理日志", "nurse.html"], ["异常预警", "home.html#todo"], ["日常巡查", null], ["满意度测评", "stats.html"], ["护士站对接", null]]],
    ["财务结算", [["费用结算", "bill.html"], ["收款对账", "orders.html?status=2"], ["护工薪酬", null], ["成本统计", null]]],
    ["统计决策", [["运营统计", "stats.html"], ["质量分析", "stats.html"], ["报表输出", "orders.html"]]],
    ["系统管理", [["用户权限", null], ["修改密码", null], ["基础数据", null], ["数据备份", "#reset"], ["退出系统", "#logout"]]]
  ];

  function session() { try { return JSON.parse(localStorage.getItem(SESSION)); } catch (e) { return null; } }
  function account() { var s = session(); return s && ACCOUNTS[s.account] ? Object.assign({ id: s.account }, ACCOUNTS[s.account]) : null; }
  function logout() { localStorage.removeItem(SESSION); location.href = "index.html"; }
  function resetData() {
    if (!confirm("将清除本机上的全部演示数据并恢复为初始示例数据，确定吗？")) return;
    localStorage.removeItem(KEY); db = load(); toast("演示数据已重置", "ok"); setTimeout(function () { location.reload(); }, 700);
  }

  function shell(page) {
    var user = account();
    if (!user) { location.replace("index.html?next=" + encodeURIComponent(location.pathname.split("/").pop() + location.search)); return false; }
    var body = document.body, main = $("main");
    var crumb = (body.getAttribute("data-crumb") || "").split("›").map(function (s) { return s.trim(); });
    var group = crumb[0], current = crumb[1];
    var menus = MENU.filter(function (m) { return user.menus.indexOf(m[0]) >= 0; });

    function itemLink(it, cls) {
      var href = it[1] || "#soon";
      var c = (it[1] ? "" : "is-soon") + (cls ? " " + cls : "");
      return '<a href="' + href + '" class="' + c + '"' + (it[1] ? "" : ' title="演示版暂未开放"') + ">" + esc(it[0]) + "</a>";
    }
    var s = document.createElement("div");
    s.className = "shell";
    s.innerHTML =
      '<header class="topbar"><a class="topbar-brand" href="home.html"><img src="../assets/img/logo.svg" alt="">康护通<small>陪护管理信息系统</small></a>' +
      '<span class="topbar-title">' + esc(body.getAttribute("data-title") || "") + "</span>" +
      '<div class="topbar-right"><span class="user-chip"><span class="avatar">' + esc(user.name.slice(0, 1)) + "</span>" + esc(user.role + " " + user.name) + "</span>" +
      '<a href="../index.html">官网首页</a><button type="button" data-logout>退出</button></div></header>' +
      '<nav aria-label="系统菜单"><ul class="menubar">' + menus.map(function (m) {
        return '<li class="' + (m[0] === group ? "is-current" : "") + '"><button type="button" aria-expanded="false">' + esc(m[0]) + "</button><ul>" +
          m[1].map(function (it) { return "<li>" + itemLink(it) + "</li>"; }).join("") + "</ul></li>";
      }).join("") + "</ul></nav>" +
      '<aside class="sidenav" aria-label="功能树">' + menus.map(function (m) {
        return "<details" + (m[0] === group || m[0] === "客户服务" || m[0] === "调度排班" ? " open" : "") + "><summary>" + esc(m[0]) + "</summary><ul>" +
          m[1].map(function (it) { return "<li>" + itemLink(it, m[0] === group && it[0] === current ? "is-current" : "") + "</li>"; }).join("") + "</ul></details>";
      }).join("") + "</aside>" +
      '<footer class="statusbar"><span>当前用户：' + esc(user.role + " " + user.name + " | " + user.dept) + '</span><span data-clock></span></footer>';
    body.insertBefore(s, main);
    s.insertBefore(main, $(".statusbar", s));
    main.classList.add("main");
    if (crumb[0]) main.insertAdjacentHTML("afterbegin", '<div class="crumb"><b>' + esc(crumb[0]) + "</b>" + crumb.slice(1).map(function (c) { return " › " + esc(c); }).join("") + "</div>");

    $all(".menubar > li > button", s).forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        var li = b.parentNode, open = !li.classList.contains("is-open");
        $all(".menubar > li", s).forEach(function (x) { x.classList.remove("is-open"); x.firstChild.setAttribute("aria-expanded", "false"); });
        if (open) { li.classList.add("is-open"); b.setAttribute("aria-expanded", "true"); }
      });
    });
    document.addEventListener("click", function () { $all(".menubar > li", s).forEach(function (x) { x.classList.remove("is-open"); }); });
    s.addEventListener("click", function (e) {
      var a = e.target.closest("a"); if (!a) return;
      var h = a.getAttribute("href");
      if (h === "#soon") { e.preventDefault(); toast("“" + a.textContent + "”在演示版中暂未开放"); }
      if (h === "#reset") { e.preventDefault(); resetData(); }
      if (h === "#logout") { e.preventDefault(); logout(); }
    });
    $("[data-logout]", s).addEventListener("click", logout);
    var clock = $("[data-clock]", s);
    (function tick() { var d = new Date(); clock.textContent = now() + ":" + pad(d.getSeconds()); setTimeout(tick, 1000); })();
    return user;
  }

  /* ---------- Pages ---------- */
  var pages = {};

  /* 用户登录：账号 + 密码 + 验证码，连续 3 次错误锁定账号 */
  pages.login = function () {
    var form = $("#login-form"), msg = $(".login-msg"), cap = $(".captcha");
    var code = "";
    function newCode() { code = ""; var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; for (var i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)]; cap.textContent = code; }
    newCode();
    cap.addEventListener("click", newCode);
    cap.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); newCode(); } });
    $all("[data-fill]").forEach(function (b) {
      b.addEventListener("click", function () { form.account.value = b.getAttribute("data-fill"); form.password.value = PASSWORD; form.captcha.value = code; form.role.value = ACCOUNTS[b.getAttribute("data-fill")].role; msg.textContent = ""; form.account.focus(); });
    });
    var acct = $("[data-carer-account]"); if (acct) { acct.setAttribute("data-fill", db.caregivers[0].id); acct.textContent = db.caregivers[0].id; }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var id = form.account.value.trim(), a = ACCOUNTS[id];
      var fails = JSON.parse(localStorage.getItem("kht-admin-fails") || "{}");
      msg.textContent = "";
      if (!id || !form.password.value || !form.captcha.value) { msg.textContent = "请填写账号、密码和验证码。"; return; }
      if (form.captcha.value.trim().toUpperCase() !== code) { msg.textContent = "验证码不正确，请重新输入。"; newCode(); form.captcha.value = ""; return; }
      if ((fails[id] || 0) >= 3) { msg.textContent = "该账号已因连续 3 次密码错误被锁定，请联系系统管理员解锁。"; return; }
      if (!a || form.password.value !== PASSWORD || a.role !== form.role.value) {
        if (a) fails[id] = (fails[id] || 0) + 1;
        localStorage.setItem("kht-admin-fails", JSON.stringify(fails));
        msg.textContent = !a ? "账号不存在。" : a.role !== form.role.value ? "所选角色与账号不符。" : "密码错误，还可尝试 " + Math.max(0, 3 - fails[id]) + " 次。";
        newCode(); form.captcha.value = ""; return;
      }
      delete fails[id]; localStorage.setItem("kht-admin-fails", JSON.stringify(fails));
      localStorage.setItem(SESSION, JSON.stringify({ account: id, at: now() }));
      var next = param("next");
      location.href = a.home || (next && /^[a-z]+\.html/.test(next) ? next : "home.html");
    });
    $("[data-unlock]").addEventListener("click", function () { localStorage.removeItem("kht-admin-fails"); msg.textContent = ""; toast("已解除所有账号锁定", "ok"); });
  };

  /* 系统主界面：关键指标 + 待办事项 */
  pages.home = function () {
    var active = db.orders.filter(function (o) { return o.status === 1; });
    var pending = db.orders.filter(function (o) { return o.status === 0; });
    var toPay = db.orders.filter(function (o) { return o.status === 2; });
    var alerts = db.alerts.filter(function (a) { return !a.handled; });
    var onDuty = db.caregivers.filter(function (c) { return c.status === "在岗"; });
    var working = {}; active.forEach(function (o) { if (o.caregiver) working[o.caregiver] = 1; });
    $("[data-kpi=active]").textContent = active.length;
    $("[data-kpi=pending]").textContent = pending.length;
    $("[data-kpi=alerts]").textContent = alerts.length;
    $("[data-kpi=carers]").innerHTML = Object.keys(working).length + "<small>/ " + onDuty.length + "</small>";

    var rows = [];
    pending.forEach(function (o) { rows.push([o, '<span class="tag tag-0">待派单</span>', '<a href="dispatch.html?order=' + o.id + '">智能派单</a>']); });
    alerts.forEach(function (a) { var o = order(a.order); if (o) rows.push([o, '<span class="tag tag-alert">' + esc(a.type) + "</span>", '<button type="button" class="link-btn" data-alert="' + a.id + '">处理</button>']); });
    toPay.slice(0, 4).forEach(function (o) { rows.push([o, '<span class="tag tag-2">待支付</span>', '<a href="bill.html?order=' + o.id + '">结算</a>']); });
    $("#todo tbody").innerHTML = rows.map(function (r) {
      var o = r[0];
      return "<tr><td>" + o.id + "</td><td>" + esc(o.patient.name) + "</td><td>" + bedLabel(o) + "</td><td>" + LEVELS[o.level] + "</td><td>" + r[1] + "</td><td>" + r[2] + "</td></tr>";
    }).join("") || '<tr><td colspan="6">暂无待办事项</td></tr>';
    $("#todo-count").textContent = "共 " + rows.length + " 项";
    $("#todo").addEventListener("click", function (e) {
      var b = e.target.closest("[data-alert]"); if (!b) return;
      var a = db.alerts.filter(function (x) { return String(x.id) === b.getAttribute("data-alert"); })[0], o = order(a.order), c = carer(o.caregiver) || {};
      var d = modal("处理异常预警", "<dl><dt>订单编号</dt><dd>" + o.id + "</dd><dt>科室床位</dt><dd>" + bedLabel(o) + "</dd><dt>患者</dt><dd>" + esc(o.patient.name) + "</dd><dt>护工</dt><dd>" + esc((c.name || "—") + " " + (c.id || "")) +
        "</dd><dt>异常类型</dt><dd>" + esc(a.type) + "</dd><dt>详情</dt><dd>" + esc(a.detail) + "</dd><dt>发生时间</dt><dd>" + a.time + '</dd><dt>处理结果</dt><dd><textarea id="alert-result" placeholder="例如：已通知护士站复测体温，医生已查看"></textarea></dd></dl>',
        [button("标记为已处理", "btn-primary", function () {
          a.handled = true; a.result = $("#alert-result").value || "已处理"; a.handledAt = now(); save(db); d.close(); toast("预警已处理，处理记录已存入巡查评价记录", "ok"); setTimeout(function () { location.reload(); }, 600);
        })]);
    });
  };

  /* 陪护预约登记：自动带出护工等级、服务方式与费用（判断表），校验后生成订单 */
  pages.booking = function (user) {
    var f = $("#booking-form");
    f.start.min = iso(today());
    if (!f.start.value) f.start.value = iso(addDays(today(), 1));
    function level() { var r = f.querySelector("[name=level]:checked"); return r ? Number(r.value) : null; }
    function needs() { return $all("[name=needs]:checked", f).map(function (x) { return x.value; }); }
    function update() {
      var lv = level(), days = Number(f.days.value) || 0;
      if (lv === null) return;
      f.mode.value = RULE[lv].mode;
      var ok = days >= 1 && days <= 365, e = estimate(lv, ok ? days : 1, needs());
      $("[data-est=rate]").textContent = money(RULE[lv].rate);
      $("[data-est=days]").textContent = ok ? days : "—";
      $("[data-est=k]").textContent = ok ? discountLabel(e.k) : "—";
      $("[data-est=extra]").textContent = ok ? money(e.extra) : "—";
      $("[data-est=total]").textContent = ok ? money(e.total) : "—";
      $("[data-est=deposit]").textContent = money(DEPOSIT);
      $("#rule-note").innerHTML = ok ? "判断表规则 <b>" + ruleNo(lv, days) + "</b>：护理等级“" + LEVELS[lv] + "”、预约 " + days + " 天 → <b>" + RULE[lv].action + "</b>，" + (e.k === 1 ? "按标准日价收费" : e.k === 0.95 ? "九五折收费" : "九折收费") + "。" : "填写预计天数后，系统按判断表确定护工等级与折扣。";
    }
    f.addEventListener("input", update);
    f.addEventListener("change", update);
    update();
    function clearErr(e) {
      var name = e.target.name; if (!name) return;
      if (e.target.classList) e.target.classList.remove("is-invalid");
      var box = $("#err-" + name); if (box) box.textContent = "";
    }
    f.addEventListener("input", clearErr);
    f.addEventListener("change", clearErr);

    function setErr(name, text) {
      var el = f.elements[name], box = $("#err-" + name);
      if (el && el.classList) el.classList.toggle("is-invalid", !!text);
      if (box) box.textContent = text || "";
      return !text;
    }
    function validate() {
      var ok = true, v = function (n) { return String(f.elements[n].value || "").trim(); };
      ok = setErr("name", v("name") ? "" : "请填写患者姓名") && ok;
      var age = Number(v("age")); ok = setErr("age", v("age") && (age < 0 || age > 120) ? "年龄应在 0～120 之间" : "") && ok;
      ok = setErr("dept", v("dept") ? "" : "请选择科室") && ok;
      var bed = Number(v("bed"));
      var clash = db.orders.filter(function (o) { return (o.status === 0 || o.status === 1) && o.dept === v("dept") && o.bed === bed; })[0];
      ok = setErr("bed", !v("bed") ? "请填写床号" : !(bed >= 1 && bed <= 60) ? "床号应在 1～60 之间（与医院床位表核对）" : clash ? "该床位已有在护订单 " + clash.id : "") && ok;
      ok = setErr("phone", !v("phone") ? "请填写联系电话" : !/^1[3-9]\d{9}$/.test(v("phone")) ? "请填写 11 位手机号码" : "") && ok;
      ok = setErr("level", level() === null ? "请选择护理等级" : "") && ok;
      ok = setErr("start", !v("start") ? "请选择开始日期" : parse(v("start")) < today() ? "开始日期不能早于今天" : "") && ok;
      var days = Number(v("days")); ok = setErr("days", !(days >= 1 && days <= 365) ? "预计天数应在 1～365 之间" : "") && ok;
      return ok;
    }
    var draftKey = "kht-admin-draft";
    try {
      var draft = JSON.parse(localStorage.getItem(draftKey) || "null");
      if (draft) { Object.keys(draft).forEach(function (k) { var el = f.elements[k]; if (!el) return; if (k === "needs") $all("[name=needs]", f).forEach(function (x) { x.checked = draft.needs.indexOf(x.value) >= 0; }); else if (el.length && el[0] && el[0].type === "radio") $all("[name=" + k + "]", f).forEach(function (x) { x.checked = x.value === draft[k]; }); else el.value = draft[k]; }); update(); toast("已恢复上次保存的草稿"); }
    } catch (e) {}
    $("[data-draft]").addEventListener("click", function () {
      var d = {}; ["name", "gender", "age", "inpatient", "dept", "bed", "contact", "phone", "start", "days", "slot", "carerGender", "note"].forEach(function (k) { d[k] = f.elements[k].value; });
      d.level = level() === null ? "" : String(level()); d.needs = needs();
      localStorage.setItem(draftKey, JSON.stringify(d)); toast("草稿已保存", "ok");
    });
    f.addEventListener("reset", function () { localStorage.removeItem(draftKey); setTimeout(function () { $all(".is-invalid", f).forEach(function (x) { x.classList.remove("is-invalid"); }); $all(".err", f).forEach(function (x) { x.textContent = ""; }); f.start.value = iso(addDays(today(), 1)); update(); }, 0); });
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!validate()) { toast("请检查标红的项目", "err"); var bad = $(".is-invalid", f); if (bad) bad.focus(); return; }
      var lv = level(), dept = f.dept.value;
      var o = {
        id: newOrderId(db, dept, today()), created: iso(today()), dept: dept, bed: Number(f.bed.value), level: lv,
        patient: { name: f.name.value.trim(), gender: f.gender.value, age: Number(f.age.value) || null, contact: f.contact.value.trim(), phone: f.phone.value.trim().replace(/^(\d{3})\d{4}(\d{4})$/, "$1****$2") },
        inpatient: f.inpatient.value.trim(), start: f.start.value, days: Number(f.days.value), needs: needs(), slot: f.slot.value, carerGender: f.carerGender.value,
        note: f.note.value.trim(), status: 0, caregiver: null, createdBy: user.name
      };
      db.orders.push(o); save(db); localStorage.removeItem(draftKey);
      var go = e.submitter && e.submitter.hasAttribute("data-dispatch");
      toast("订单 " + o.id + " 已生成，预估金额 " + money(estimate(lv, o.days, o.needs).total) + " 元", "ok");
      setTimeout(function () { location.href = go ? "dispatch.html?order=" + o.id : "orders.html?q=" + o.id; }, 1100);
    });
  };

  /* 智能派单：按判断表确定护工等级，剔除档期冲突和本月超时护工，按匹配分降序推荐前 3 名 */
  function candidates(o) {
    var grade = RULE[o.level].grade, s = parse(o.start), e = endDate(o);
    var busy = {};
    db.orders.forEach(function (x) {
      if (x.status !== 1 || !x.caregiver) return;
      if (parse(x.start) <= e && endDate(x) >= s) busy[x.caregiver] = (busy[x.caregiver] || 0) + 1;
    });
    var out = { list: [], conflict: 0, overtime: 0, cert: 0 };
    db.caregivers.forEach(function (c) {
      if (c.grade !== grade || c.status !== "在岗") return;
      if (o.carerGender && o.carerGender !== "不限" && c.gender !== o.carerGender) return;
      if (parse(c.certExpire) < e) { out.cert++; return; }
      if (busy[c.id] >= (grade === 3 ? 3 : 1)) { out.conflict++; return; }
      if (c.monthDays > 26) { out.overtime++; return; }
      var years = c.exp[o.dept] || 0;
      var expScore = years ? Math.min(100, 50 + years * 12) : 30;
      var score = c.star / 5 * 100 * 0.4 + c.good * 0.3 + expScore * 0.3;
      out.list.push({ c: c, score: Math.round(score * 10) / 10, expText: years ? DEPTS[o.dept] + " " + years + "年" : Object.keys(c.exp).map(function (d) { return DEPTS[d] + " " + c.exp[d] + "年"; }).join("、"), load: busy[c.id] || 0 });
    });
    out.list.sort(function (a, b) { return b.score - a.score; });
    return out;
  }
  pages.dispatch = function (user) {
    var list = $("#pending"), detail = $("#order-detail"), table = $("#cand tbody"), offset = 0, cur = null;
    function pending() { return db.orders.filter(function (o) { return o.status === 0; }).sort(function (a, b) { return a.created < b.created ? 1 : -1; }); }
    function renderList() {
      var p = pending();
      $("#pending-count").textContent = p.length;
      list.innerHTML = p.map(function (o) {
        return '<li><button type="button" data-id="' + o.id + '" class="' + (cur && cur.id === o.id ? "is-current" : "") + '"><b>' + o.id + "</b><span>" + esc(o.patient.name) + " " + bedLabel(o) + "　" + LEVELS[o.level] + (o.manual ? "　（已转人工）" : "") + "</span></button></li>";
      }).join("") || '<li class="empty">暂无待派订单</li>';
    }
    function select(o) {
      cur = o; offset = 0; renderList();
      if (!o) { detail.innerHTML = '<p class="hint">请从左侧选择待派订单。</p>'; table.innerHTML = ""; $("#cand-note").textContent = ""; return; }
      detail.innerHTML =
        "<div><span>订单编号：</span>" + o.id + "</div><div><span>护理等级：</span>" + LEVELS[o.level] + "</div><div><span>服务方式：</span>" + RULE[o.level].mode + " " + esc(o.slot || "24小时") +
        "</div><div><span>服务时间：</span>" + md(o.start) + " 至 " + md(endDate(o)) + "（" + o.days + "天）</div><div><span>科室床位：</span>" + bedLabel(o) + "</div><div><span>患者：</span>" + esc(o.patient.name) +
        "</div><div><span>护工性别：</span>" + esc(o.carerGender || "不限") + "</div><div><span>特殊需求：</span>" + needText(o) + "</div>";
      renderCands();
    }
    function renderCands() {
      var r = candidates(cur), page = r.list.slice(offset, offset + 3);
      table.innerHTML = page.map(function (x, i) {
        return '<tr class="' + (i === 0 ? "is-selected" : "") + '"><td><input type="radio" name="carer" value="' + x.c.id + '"' + (i === 0 ? " checked" : "") + ' aria-label="选择 ' + esc(x.c.name) + '"></td><td>' + x.c.id + "</td><td>" + esc(x.c.name) + "</td><td>" + GRADES[x.c.grade] + '</td><td class="stars">' + stars(x.c.star) +
          "</td><td>" + x.c.good.toFixed(1) + "%</td><td>" + esc(x.expText) + "</td><td>" + (x.load ? "在护 " + x.load + " 床" : "空闲") + "</td><td><b>" + x.score.toFixed(1) + "</b></td></tr>";
      }).join("") || '<tr><td colspan="9">没有符合条件的护工，请转人工派单。</td></tr>';
      $("#cand-note").innerHTML = "护理等级“" + LEVELS[cur.level] + "” → 需" + GRADES[RULE[cur.level].grade] + "护工；符合条件 <b>" + r.list.length + "</b> 人，第 " + (r.list.length ? offset + 1 : 0) + "～" + Math.min(offset + 3, r.list.length) + " 名；已剔除档期冲突 <b>" + r.conflict + "</b> 人、本月超时 <b>" + r.overtime + "</b> 人" + (r.cert ? "、证书将过期 <b>" + r.cert + "</b> 人" : "") + "。";
      $("[data-more]").disabled = r.list.length <= 3;
    }
    table.addEventListener("change", function () { $all("tr", table).forEach(function (tr) { tr.classList.toggle("is-selected", $("input", tr).checked); }); });
    list.addEventListener("click", function (e) { var b = e.target.closest("[data-id]"); if (b) select(order(b.getAttribute("data-id"))); });
    $("[data-more]").addEventListener("click", function () { var n = candidates(cur).list.length; offset = offset + 3 >= n ? 0 : offset + 3; renderCands(); });
    $("[data-profile]").addEventListener("click", function () {
      var id = (table.querySelector("input:checked") || {}).value; if (!id) return;
      var c = carer(id), done = db.orders.filter(function (o) { return o.caregiver === id && o.status === 3; });
      modal("护工档案 · " + c.name, "<dl><dt>护工编号</dt><dd>" + c.id + "（校验位正确）</dd><dt>姓名 / 性别</dt><dd>" + esc(c.name) + " / " + c.gender + "</dd><dt>护工等级</dt><dd>" + GRADES[c.grade] + "护工</dd><dt>星级</dt><dd class=stars>" + stars(c.star) + "</dd><dt>好评率</dt><dd>" + c.good.toFixed(1) +
        "%</dd><dt>科室经验</dt><dd>" + Object.keys(c.exp).map(function (d) { return DEPTS[d] + " " + c.exp[d] + "年"; }).join("、") + "</dd><dt>入职日期</dt><dd>" + c.joined + "</dd><dt>证书有效期至</dt><dd>" + c.certExpire + "</dd><dt>本月服务</dt><dd>" + c.monthDays + " 天</dd><dt>累计完成订单</dt><dd>" + done.length + " 单</dd></dl>");
    });
    $("[data-manual]").addEventListener("click", function () { if (!cur) return; cur.manual = true; save(db); renderList(); toast("已转人工派单，排班组将电话联系护工", "ok"); });
    $("[data-confirm]").addEventListener("click", function () {
      if (!cur) return;
      var id = (table.querySelector("input:checked") || {}).value;
      if (!id) { toast("没有可派的护工，请转人工派单", "err"); return; }
      var c = carer(id);
      cur.caregiver = id; cur.status = 1; cur.dispatchedAt = now(); cur.dispatchedBy = user.name; delete cur.manual;
      c.monthDays = Math.min(31, c.monthDays + 1);
      save(db);
      toast("派单成功：已通知护工 " + c.name + "，并向" + DEPTS[cur.dept] + "护士站推送进科报备", "ok");
      var next = pending()[0]; select(next || null);
    });
    var want = param("order") && order(param("order"));
    select(want && want.status === 0 ? want : pending()[0] || null);
  };

  /* 护工移动端：扫码上岗、逐项打卡、体征记录，异常自动预警 */
  pages.nurse = function () {
    var user = account();
    if (!user) { location.replace("index.html?next=nurse.html"); return; }
    var carerId = user.carer || param("carer");
    var sel = $("#carer-switch");
    var withOrders = db.caregivers.filter(function (c) { return db.orders.some(function (o) { return o.caregiver === c.id && o.status === 1; }); });
    if (!user.carer) {
      sel.hidden = false;
      $("select", sel).innerHTML = withOrders.map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + "（" + c.id + "）</option>"; }).join("");
      if (!carerId || !withOrders.some(function (c) { return c.id === carerId; })) carerId = withOrders.length ? withOrders[0].id : null;
      $("select", sel).value = carerId;
      $("select", sel).addEventListener("change", function () { location.search = "?carer=" + this.value; });
    }
    var c = carer(carerId);
    var o = db.orders.filter(function (x) { return x.caregiver === carerId && x.status === 1; }).sort(function (a, b) { return a.start < b.start ? 1 : -1; })[0];
    $("#who").textContent = c ? c.name + " · " + GRADES[c.grade] + "护工 · " + c.id : "";
    if (!o) { $("#task-area").innerHTML = '<div class="card"><h2>今日暂无护理任务</h2><p class="hint">派单成功后，任务会出现在这里。</p></div>'; return; }
    if (parse(o.start) > today()) { $("#patient").textContent = o.patient.name + " · " + bedLabel(o); $("#task-area").innerHTML = '<div class="card"><h2>已接单，待上岗</h2><p class="hint">服务将于 ' + o.start + " 开始，届时在这里扫码上岗并逐项打卡。</p></div>"; return; }
    $("#patient").textContent = o.patient.name + " · " + bedLabel(o) + " · " + LEVELS[o.level] + " · 第 " + Math.max(1, dayDiff(o.start, today()) + 1) + " 天";

    var key = o.id + "@" + iso(today());
    var plan = [["08:00", "晨间护理（洗漱、口腔清洁）"], ["08:30", o.needs.indexOf("tube") >= 0 ? "鼻饲喂养（早餐）" : "协助早餐"]];
    if (o.level === 0 || o.needs.indexOf("turning") >= 0) plan.push(["10:00", "翻身拍背"]);
    plan.push(["10:30", "体征测量与记录"], ["12:00", o.needs.indexOf("tube") >= 0 ? "鼻饲喂养（午餐）" : "协助午餐"]);
    if (o.level === 0 || o.needs.indexOf("turning") >= 0) plan.push(["14:00", "翻身拍背"]);
    if (o.needs.indexOf("rehab") >= 0) plan.push(["15:00", "床旁康复训练"]);
    if (o.needs.indexOf("catheter") >= 0) plan.push(["16:00", "导尿管护理"]);
    plan.push(["18:00", "协助晚餐"], ["21:00", "睡前护理"]);
    if (o.needs.indexOf("night") >= 0) plan.push(["23:00", "夜间巡视与翻身"]);
    var log = db.logs[key] || (db.logs[key] = { clockIn: null, items: plan.map(function (p) { return { time: p[0], name: p[1], doneAt: null }; }), vitals: [] });

    (function tick() { var d = new Date(); $(".phone-status span").textContent = pad(d.getHours()) + ":" + pad(d.getMinutes()); setTimeout(tick, 15000); })();
    function minutes(t) { var p = t.split(":"); return +p[0] * 60 + +p[1]; }
    function render() {
      var d = new Date(), nowMin = d.getHours() * 60 + d.getMinutes(), done = 0;
      $("#clock-state").innerHTML = log.clockIn ? "已上岗 <strong>" + log.clockIn.slice(11) + "</strong>（床头码 " + o.dept + "-" + o.bed + " 核验通过）" : "尚未打卡上岗";
      $("[data-clockin]").hidden = !!log.clockIn;
      $("#tasks").innerHTML = log.items.map(function (it, i) {
        var late = !it.doneAt && !it.skipped && nowMin - minutes(it.time) > 120, due = !it.doneAt && nowMin >= minutes(it.time);
        if (it.doneAt) done++;
        return '<div class="task ' + (it.doneAt || it.skipped ? "is-done" : late ? "is-late" : "") + '"><input type="checkbox" id="t' + i + '" data-i="' + i + '"' + (it.doneAt ? " checked disabled" : "") + (log.clockIn && !it.skipped ? "" : " disabled") + '><label for="t' + i + '"><time>' + it.time + "</time>　" + esc(it.name) + "</label>" +
          '<span class="pill ' + (it.doneAt ? "pill-done" : it.skipped ? "pill-todo" : late ? "pill-late" : "pill-todo") + '">' + (it.doneAt ? "已完成 " + it.doneAt : it.skipped ? "上岗前" : late ? "漏打卡" : due ? "待执行" : "未到时间") + "</span></div>";
      }).join("");
      $("#progress").textContent = done + " / " + log.items.filter(function (x) { return !x.skipped; }).length;
      // 漏打卡超过 2 小时 → 自动预警（每个项目只预警一次）
      log.items.forEach(function (it) {
        if (log.clockIn && !it.doneAt && !it.skipped && !it.alerted && nowMin - minutes(it.time) > 120) { it.alerted = true; raise("漏打卡", "“" + it.name + "”（" + it.time + "）超过 2 小时未打卡"); }
      });
      $("#vitals-log").innerHTML = log.vitals.map(function (v) { return "<li>" + v.at.slice(11) + "　体温 " + v.temp + "℃" + (v.pulse ? "　脉搏 " + v.pulse : "") + (v.bp ? "　血压 " + esc(v.bp) : "") + (v.temp >= 38.5 ? '　<span class="pill pill-late">已预警</span>' : "") + "</li>"; }).join("");
      save(db);
    }
    function raise(type, detail) {
      db.alerts.push({ id: Date.now(), order: o.id, type: type, detail: detail, time: now(), handled: false });
      save(db); toast("已向" + DEPTS[o.dept] + "护士站推送异常预警：" + type, "err");
    }
    $("[data-clockin]").addEventListener("click", function () {
      var input = document.createElement("input"); input.type = "text"; input.placeholder = "例如 03-12"; input.id = "bedcode";
      var d = modal("扫描床头码", '<p class="hint">请对准床头二维码扫描；无法扫描时可手动输入床头码（科室代码-床号）。</p><div class="field" style="grid-template-columns:4.5em 1fr"><label for="bedcode">床头码</label></div><p class="err" id="bed-err"></p>',
        [button("模拟扫码", "", function () { input.value = o.dept + "-" + o.bed; }), button("确认上岗", "btn-primary", function () {
          if (input.value.trim() !== o.dept + "-" + o.bed) { $("#bed-err").textContent = "床头码与派单床位（" + bedLabel(o) + "）不符，请核对。"; return; }
          log.clockIn = now();
          var inMin = new Date().getHours() * 60 + new Date().getMinutes();
          log.items.forEach(function (it) { if (minutes(it.time) < inMin - 30) it.skipped = true; });  // 上岗前的项目不计漏打卡
          d.close(); toast("上岗打卡成功", "ok"); render();
        })]);
      $(".field", d).appendChild(input); input.focus();
    });
    $("#tasks").addEventListener("change", function (e) {
      var i = e.target.getAttribute("data-i"); if (i === null) return;
      var d = new Date(); log.items[i].doneAt = pad(d.getHours()) + ":" + pad(d.getMinutes()); render(); toast("已打卡：" + log.items[i].name, "ok");
    });
    $("#vitals").addEventListener("submit", function (e) {
      e.preventDefault();
      var t = Number(this.temp.value), err = $("#temp-err");
      if (!this.temp.value || !(t >= 35 && t <= 42)) { err.textContent = "体温应在 35～42℃ 之间，请复测。"; this.temp.classList.add("is-invalid"); return; }
      err.textContent = ""; this.temp.classList.remove("is-invalid");
      log.vitals.push({ at: now(), temp: t, pulse: this.pulse.value, bp: this.bp.value.trim() });
      var vit = log.items.filter(function (x) { return !x.doneAt && !x.skipped && x.name.indexOf("体征") === 0; })[0];
      if (vit && log.clockIn) vit.doneAt = now().slice(11);
      if (t >= 38.5) raise("体温异常", "体温 " + t + "℃（≥38.5℃）"); else toast("体征已记录", "ok");
      this.reset(); render();
    });
    $("[data-report]").addEventListener("click", function () {
      var d = modal("异常上报", '<div class="field" style="grid-template-columns:4.5em 1fr"><label for="ab-type">类型</label><select id="ab-type"><option>病情变化</option><option>跌倒/坠床</option><option>管路异常</option><option>家属纠纷</option><option>其他</option></select></div><div class="field" style="grid-template-columns:4.5em 1fr;margin-top:.6rem"><label for="ab-text">情况说明</label><textarea id="ab-text"></textarea></div>',
        [button("提交上报", "btn-danger", function () { raise("护工上报", $("#ab-type").value + "：" + ($("#ab-text").value || "（未填写说明）")); d.close(); })]);
    });
    $("[data-submit-log]").addEventListener("click", function () {
      var done = log.items.filter(function (x) { return x.doneAt; }).length;
      log.submittedAt = now(); save(db);
      toast("护理日报已汇总推送家属（完成 " + done + "/" + log.items.filter(function (x) { return !x.skipped; }).length + " 项）", "ok");
    });
    render();
    setInterval(render, 60000);
  };

  /* 订单信息查询：多条件筛选、分页、合计、导出 Excel */
  pages.orders = function () {
    var f = $("#filters"), tbody = $("#orders tbody"), page = 0, size = 10, rows = [];
    f.dept.innerHTML = '<option value="">全部科室</option>' + Object.keys(DEPTS).map(function (k) { return '<option value="' + k + '">' + k + " " + DEPTS[k] + "</option>"; }).join("");
    f.status.innerHTML = '<option value="">全部状态</option>' + Object.keys(STATUS).map(function (k) { return '<option value="' + k + '">' + STATUS[k] + "</option>"; }).join("");
    if (param("status")) f.status.value = param("status");
    if (param("q")) f.q.value = param("q");
    function run() {
      var q = f.q.value.trim(), cq = f.carer.value.trim(), from = f.from.value, to = f.to.value;
      rows = db.orders.filter(function (o) {
        var c = carer(o.caregiver) || {};
        return (!f.dept.value || o.dept === f.dept.value) && (f.status.value === "" || String(o.status) === f.status.value) &&
          (!q || o.id.indexOf(q) >= 0 || o.patient.name.indexOf(q) >= 0) && (!cq || (c.name || "").indexOf(cq) >= 0 || (c.id || "").indexOf(cq) >= 0) &&
          (!from || o.start >= from) && (!to || o.start <= to);
      }).sort(function (a, b) { return a.created === b.created ? (a.id < b.id ? 1 : -1) : a.created < b.created ? 1 : -1; });
      page = 0; render();
    }
    function action(o) {
      return o.status === 0 ? '<a href="dispatch.html?order=' + o.id + '">派单</a>' : o.status === 9 ? "—" : '<a href="bill.html?order=' + o.id + '">' + (o.status === 1 ? "结算预览" : o.status === 2 ? "结算" : "结算单") + "</a>";
    }
    function render() {
      var pages = Math.max(1, Math.ceil(rows.length / size)), slice = rows.slice(page * size, page * size + size);
      tbody.innerHTML = slice.map(function (o) {
        var c = carer(o.caregiver);
        return "<tr" + (o.status === 9 ? ' class="is-muted"' : "") + "><td>" + o.id + "</td><td>" + esc(o.patient.name) + "</td><td>" + bedLabel(o) + "</td><td>" + LEVELS[o.level] + "</td><td>" + (c ? esc(c.name) : "—") + "</td><td>" + o.start + '</td><td class="num">' + o.days +
          '</td><td class="num">' + money(orderAmount(o)) + '</td><td><span class="tag tag-' + o.status + '">' + STATUS[o.status] + "</span></td><td>" + action(o) + "</td></tr>";
      }).join("") || '<tr><td colspan="10">没有符合条件的订单</td></tr>';
      var sumDays = 0, sumAmt = 0; rows.forEach(function (o) { if (o.status !== 9) { sumDays += o.days; sumAmt += orderAmount(o); } });
      $("#orders tfoot").innerHTML = '<tr><td colspan="6">合计（' + rows.length + ' 单，不含已取消）</td><td class="num">' + sumDays + '</td><td class="num">' + money(sumAmt) + '</td><td colspan="2"></td></tr>';
      $("#pager-info").textContent = "第 " + (page + 1) + " / " + pages + " 页，共 " + rows.length + " 条";
      $("[data-prev]").disabled = page === 0; $("[data-next]").disabled = page >= pages - 1;
    }
    f.addEventListener("submit", function (e) { e.preventDefault(); run(); });
    f.addEventListener("reset", function () { setTimeout(run, 0); });
    $("[data-prev]").addEventListener("click", function () { page--; render(); });
    $("[data-next]").addEventListener("click", function () { page++; render(); });
    $("[data-export]").addEventListener("click", function () {
      var head = ["订单编号", "患者", "科室", "床号", "护理等级", "护工", "开始日期", "天数", "金额", "状态"];
      var lines = [head].concat(rows.map(function (o) { var c = carer(o.caregiver); return ["\t" + o.id, o.patient.name, DEPTS[o.dept], o.bed, LEVELS[o.level], c ? c.name : "", o.start, o.days, orderAmount(o).toFixed(2), STATUS[o.status]]; }));
      var csv = "﻿" + lines.map(function (l) { return l.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(","); }).join("\r\n");
      var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = "订单信息_" + iso(today()) + ".csv"; a.click();
      toast("已导出 " + rows.length + " 条订单", "ok");
    });
    $("[data-print]").addEventListener("click", function () { window.print(); });
    run();
  };

  /* 运营统计分析：订单量、服务天数、收入、在岗率、满意度、预警，按科室与日期汇总 */
  pages.stats = function () {
    var sel = $("#period");
    function range() {
      var T = today(), v = sel.value;
      if (v === "month") return [new Date(T.getFullYear(), T.getMonth(), 1), T];
      return [addDays(T, -(Number(v) - 1)), T];
    }
    function render() {
      var r = range(), from = iso(r[0]), to = iso(r[1]);
      $("#period-text").textContent = from + " 至 " + to;
      var os = db.orders.filter(function (o) { return o.created >= from && o.created <= to && o.status !== 9; });
      var days = 0, income = 0, rated = 0, good = 0, dist = { 5: 0, 4: 0, 3: 0, 2: 0 };
      var byDept = {}; Object.keys(DEPTS).forEach(function (k) { byDept[k] = { n: 0, days: 0, income: 0, rated: 0, good: 0 }; });
      os.forEach(function (o) {
        var b = byDept[o.dept]; b.n++; b.days += o.days; days += o.days;
        if (o.status === 3) { var amt = bill(o).receivable; income += amt; b.income += amt; }
        if (o.rating) { rated++; b.rated++; dist[Math.max(2, o.rating)]++; if (o.rating >= 4) { good++; b.good++; } }
      });
      var active = db.orders.filter(function (o) { return o.status === 1; }), working = {};
      active.forEach(function (o) { working[o.caregiver] = 1; });
      var onDuty = db.caregivers.filter(function (c) { return c.status === "在岗"; }).length;
      var alerts = db.alerts.filter(function (a) { return a.time.slice(0, 10) >= from && a.time.slice(0, 10) <= to; }).length;
      $("[data-s=orders]").innerHTML = os.length + "<small>单</small>";
      $("[data-s=days]").innerHTML = days + "<small>天</small>";
      $("[data-s=income]").innerHTML = (income / 10000).toFixed(2) + "<small>万元</small>";
      $("[data-s=duty]").innerHTML = (Object.keys(working).length / onDuty * 100).toFixed(1) + "<small>%</small>";
      $("[data-s=sat]").innerHTML = (rated ? good / rated * 100 : 0).toFixed(1) + "<small>%</small>";
      $("[data-s=alerts]").innerHTML = alerts + "<small>次</small>";

      // Orders by department (bar chart)
      var keys = Object.keys(DEPTS).sort(function (a, b) { return byDept[b].n - byDept[a].n; });
      var max = Math.max.apply(null, keys.map(function (k) { return byDept[k].n; }).concat([1]));
      var W = 560, H = 250, left = 34, bw = (W - left - 10) / keys.length;
      var svg = '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="各科室订单量"><defs><linearGradient id="bar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3aa6ee"/><stop offset="1" stop-color="#19b1a4"/></linearGradient></defs>';
      for (var g = 0; g <= 4; g++) { var y = 20 + (H - 60) * g / 4, val = Math.round(max * (4 - g) / 4); svg += '<line x1="' + left + '" x2="' + W + '" y1="' + y + '" y2="' + y + '" stroke="#e3e8ed"/><text x="' + (left - 6) + '" y="' + (y + 4) + '" text-anchor="end">' + val + "</text>"; }
      keys.forEach(function (k, i) {
        var h = (H - 60) * byDept[k].n / max, x = left + i * bw + bw * 0.22, y = H - 40 - h;
        svg += '<rect x="' + x + '" y="' + y + '" width="' + bw * 0.56 + '" height="' + h + '" rx="4" fill="url(#bar)"/><text x="' + (x + bw * 0.28) + '" y="' + (y - 6) + '" text-anchor="middle" style="fill:#1f2933;font-weight:600">' + byDept[k].n + '</text><text x="' + (x + bw * 0.28) + '" y="' + (H - 20) + '" text-anchor="middle">' + DEPTS[k] + "</text>";
      });
      $("#chart-dept").innerHTML = svg + "</svg>";

      // Satisfaction (donut)
      var colors = { 5: "#2e9be6", 4: "#19b1a4", 3: "#e0a35a", 2: "#c4362c" }, names = { 5: "非常满意", 4: "满意", 3: "一般", 2: "不满意" };
      var total = rated || 1, acc = 0, R = 70, C = 2 * Math.PI * R;
      var d = '<svg class="chart" viewBox="0 0 200 200" role="img" aria-label="满意度分布"><circle cx="100" cy="100" r="' + R + '" fill="none" stroke="#eef1f4" stroke-width="26"/>';
      [5, 4, 3, 2].forEach(function (k) { var len = C * dist[k] / total; d += '<circle cx="100" cy="100" r="' + R + '" fill="none" stroke="' + colors[k] + '" stroke-width="26" stroke-dasharray="' + len + " " + (C - len) + '" stroke-dashoffset="' + (-acc) + '" transform="rotate(-90 100 100)"/>'; acc += len; });
      d += '<text x="100" y="98" text-anchor="middle" style="font-size:26px;font-weight:700;fill:#1673b8">' + (rated ? Math.round(good / rated * 100) : 0) + '%</text><text x="100" y="120" text-anchor="middle">满意率</text></svg>';
      $("#chart-sat").innerHTML = d;
      $("#legend-sat").innerHTML = [5, 4, 3, 2].map(function (k) { return '<div><i style="background:' + colors[k] + '"></i>' + names[k] + "　" + dist[k] + " 单（" + (dist[k] / total * 100).toFixed(1) + "%）</div>"; }).join("") + '<div class="hint">共 ' + rated + " 单已评价</div>";

      // Daily new orders (line)
      var n = Math.max(1, dayDiff(r[0], r[1]) + 1), pts = [], vmax = 1;
      for (var i = 0; i < n; i++) { var day = iso(addDays(r[0], i)), c = os.filter(function (o) { return o.created === day; }).length; pts.push([day, c]); vmax = Math.max(vmax, c); }
      var LW = 1100, LH = 200, l = 30, step = (LW - l - 20) / Math.max(1, n - 1);
      var path = pts.map(function (p, i) { return (i ? "L" : "M") + (l + i * step).toFixed(1) + " " + (LH - 30 - (LH - 50) * p[1] / vmax).toFixed(1); }).join(" ");
      var line = '<svg class="chart" viewBox="0 0 ' + LW + " " + LH + '" role="img" aria-label="每日新增订单"><defs><linearGradient id="ln" x1="0" x2="1"><stop offset="0" stop-color="#3aa6ee"/><stop offset="1" stop-color="#19b1a4"/></linearGradient><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3aa6ee" stop-opacity=".22"/><stop offset="1" stop-color="#19b1a4" stop-opacity="0"/></linearGradient></defs>';
      for (var gy = 0; gy <= 3; gy++) { var yy = 20 + (LH - 50) * gy / 3; line += '<line x1="' + l + '" x2="' + LW + '" y1="' + yy + '" y2="' + yy + '" stroke="#e3e8ed"/><text x="' + (l - 6) + '" y="' + (yy + 4) + '" text-anchor="end">' + Math.round(vmax * (3 - gy) / 3) + "</text>"; }
      line += '<path d="' + path + " L" + (l + (n - 1) * step).toFixed(1) + " " + (LH - 30) + " L" + l + " " + (LH - 30) + ' Z" fill="url(#area)"/><path d="' + path + '" fill="none" stroke="url(#ln)" stroke-width="3" stroke-linejoin="round"/>';
      pts.forEach(function (p, i) { if (n <= 10 || i % Math.ceil(n / 10) === 0 || i === n - 1) line += '<text x="' + (l + i * step) + '" y="' + (LH - 8) + '" text-anchor="middle">' + p[0].slice(5) + "</text>"; });
      $("#chart-trend").innerHTML = line + "</svg>";

      $("#dept-table tbody").innerHTML = keys.map(function (k) { var b = byDept[k]; return "<tr><td>" + k + " " + DEPTS[k] + '</td><td class="num">' + b.n + '</td><td class="num">' + b.days + '</td><td class="num">' + money(b.income) + '</td><td class="num">' + (b.rated ? (b.good / b.rated * 100).toFixed(1) + "%" : "—") + "</td></tr>"; }).join("");
    }
    sel.addEventListener("change", render);
    $("[data-print]").addEventListener("click", function () { window.print(); });
    render();
  };

  /* 电子结算单：按实际天数 × 日价 × 折扣 + 附加服务 − 押金自动计费 */
  pages.bill = function (user) {
    var sel = $("#bill-order");
    var list = db.orders.filter(function (o) { return o.status === 1 || o.status === 2 || o.status === 3; }).sort(function (a, b) { return a.status === b.status ? (a.created < b.created ? 1 : -1) : a.status === 2 ? -1 : b.status === 2 ? 1 : a.status - b.status; });
    sel.innerHTML = list.map(function (o) { return '<option value="' + o.id + '">' + o.id + " " + esc(o.patient.name) + "（" + STATUS[o.status] + "）</option>"; }).join("");
    var o = order(param("order")) || list[0];
    if (o) sel.value = o.id;
    sel.addEventListener("change", function () { location.search = "?order=" + sel.value; });
    if (!o) return;
    var b = bill(o), c = carer(o.caregiver) || {};
    $("#bill-no").textContent = "JS" + o.id;
    $("#bill-date").textContent = o.status === 3 ? o.paidAt : iso(today());
    $("#bill-body").innerHTML =
      '<tr><td class="k">订单编号</td><td>' + o.id + '</td><td class="k">患者姓名</td><td>' + esc(o.patient.name) + "</td></tr>" +
      '<tr><td class="k">科室床位</td><td>' + bedLabel(o) + '</td><td class="k">护理等级</td><td>' + LEVELS[o.level] + "</td></tr>" +
      '<tr><td class="k">护工</td><td>' + esc(c.name || "—") + "（" + (c.id || "—") + '）</td><td class="k">服务方式</td><td>' + RULE[o.level].mode + "</td></tr>" +
      '<tr><td class="k">服务期间</td><td>' + md(o.start) + " 至 " + md(addDays(parse(o.start), b.days - 1)) + '</td><td class="k">实际天数</td><td>' + b.days + " 天" + (o.status === 1 ? "（截至今日）" : "") + "</td></tr>";
    var items = [["陪护服务费（" + GRADES[RULE[o.level].grade] + "护工" + RULE[o.level].mode + "）", b.rate, b.days, b.k === 1 ? "—" : b.k === 0.95 ? "九五折" : "九折", b.base]].concat(b.extras.map(function (e) { return [e.name, e.price, e.qty, "—", e.amount]; }));
    $("#bill-items").innerHTML = items.map(function (it) { return "<tr><td>" + esc(it[0]) + '</td><td class="num">' + money(it[1]) + '</td><td class="num">' + it[2] + ' 天</td><td style="text-align:center">' + it[3] + '</td><td class="num">' + money(it[4]) + "</td></tr>"; }).join("") +
      '<tr class="sum"><td colspan="4" style="text-align:right">应收金额</td><td class="num">' + money(b.receivable) + "</td></tr>" +
      '<tr><td colspan="4" style="text-align:right">押金抵扣</td><td class="num">−' + money(b.deposit) + "</td></tr>" +
      '<tr class="pay"><td colspan="4" style="text-align:right">本次应付</td><td class="num">' + money(b.payable) + "</td></tr>";
    $("#bill-rule").textContent = "计费规则：应收金额 = " + b.days + " 天 × " + money(b.rate) + " 元 × " + (b.k === 1 ? "1.00" : b.k.toFixed(2)) + "（" + discountLabel(b.k) + "）" + (b.extras.length ? " + 附加服务费 " + money(b.extras.reduce(function (s, e) { return s + e.amount; }, 0)) + " 元" : "") + "；本次应付 = 应收金额 − 押金 " + money(b.deposit) + " 元。";
    $("#bill-pay").textContent = o.status === 3 ? "支付方式：" + PAY_TYPES[o.payType || 1] + "　支付时间：" + (o.paidAt || "") : o.status === 2 ? "支付状态：待支付（结算单已推送家属，24 小时未支付将自动提醒）" : "支付状态：服务中，离岗结算后生成正式结算单";
    $("#bill-stamp").innerHTML = o.status === 3 ? '<span class="stamp">已结清</span>' : o.status === 2 ? '<span class="stamp" style="color:#8a5a00;border-color:#d9a441">待支付</span>' : '<span class="stamp" style="color:#1673b8;border-color:#7fb8e6">预览</span>';
    $("#bill-family").textContent = "家属确认：" + (o.status === 3 ? o.patient.contact + "（电子确认）" : "________");
    $("#bill-operator").textContent = "经办：" + user.dept + " " + user.name;
    var settle = $("[data-settle]"), paid = $("[data-paid]");
    settle.hidden = o.status !== 1; paid.hidden = o.status !== 2; $("#pay-type").hidden = o.status !== 2;
    settle.addEventListener("click", function () { o.days = b.days; o.status = 2; o.settledAt = now(); save(db); toast("已离岗结算，结算单已推送家属", "ok"); setTimeout(function () { location.reload(); }, 700); });
    paid.addEventListener("click", function () { o.status = 3; o.payType = Number($("#pay-type").value); o.paidAt = iso(today()); save(db); toast("收款成功，已写入收款台账", "ok"); setTimeout(function () { location.reload(); }, 700); });
    $("[data-push]").addEventListener("click", function () { toast("结算单已推送至家属手机（" + o.patient.phone + "）", "ok"); });
    $("[data-print]").addEventListener("click", function () { window.print(); });
  };

  /* ---------- Boot ---------- */
  var page = document.body.getAttribute("data-page");
  var user = null;
  if (page !== "login" && page !== "nurse") { user = shell(page); if (!user) return; }
  if (pages[page]) pages[page](user);
  window.KHTAdmin = { db: function () { return db; }, validOrderId: validOrderId, checkDigit: checkDigit };
})();
