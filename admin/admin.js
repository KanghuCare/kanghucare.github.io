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
  var NEEDS = { turning: "翻身拍背", tube: "鼻饲喂养", catheter: "导尿护理", night: "夜间陪护", rehab: "康复训练", bp: "血压监测（高血压）", glucose: "血糖监测（糖尿病）", sleep: "睡眠监测" };
  var GLU_FREQ = { d4: "每日 4 次", d2: "每日 2 次", d1: "每日 1 次（空腹）", w2: "每周 2 次（周一、周四空腹）", w1: "每周 1 次（周一空腹）" };
  var SLEEP_MODE = { device: "智能睡眠监测带", observe: "护工观察记录" };
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
    var db = { v: 8, seeded: iso(T), caregivers: [], orders: [], alerts: [], logs: {}, complaints: [] };
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
        joined: "20" + yy + "-0" + (1 + Math.floor(r() * 9)) + "-15", certExpire: iso(addDays(T, 12 + Math.floor(r() * 700)))
      });
    }
    db.caregivers[14].certExpire = iso(addDays(T, 23)); db.caregivers[27].certExpire = iso(addDays(T, 48));  // 资质审核示例：证书即将到期
    var roster = db.caregivers.filter(function (c) { return c.status === "在岗"; });

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
          return c !== db.caregivers[0] && c.grade === RULE[level].grade && (!c.featured || end < addDays(T, -1)) && (busy[c.id] || []).filter(function (b) { return b[0] <= end && b[1] >= start; }).length < cap;
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
    db.orders.forEach(function (o) {
      var h = strHash(o.id);
      if (h % 4 === 0 && o.needs.indexOf("bp") < 0) o.needs.push("bp");
      if (h % 5 === 1) { o.needs.push("glucose"); o.glucoseFreq = ["d2", "d1", "w2", "d4", "d2"][h % 7 % 5]; }
      if (h % 6 === 2) { o.needs.push("sleep"); o.sleepMode = h % 3 ? "device" : "observe"; }
    });
    // Orders in service were accepted by their caregivers and confirmed by the ward
    db.orders.forEach(function (o) { if (o.status === 1) { o.accepted = true; o.entryConfirmed = true; o.auto = true; } });
    // Orders waiting for dispatch, created today
    [["钱*", "05", 9, 1, 7, ["turning", "rehab"]], ["吴*芬", "08", 2, 2, 5, []], ["孙*英", "03", 18, 0, 12, ["turning", "tube", "night"]],
     ["郑*", "02", 6, 1, 3, ["night"]], ["冯*兰", "06", 3, 0, 8, ["turning", "catheter"]]].forEach(function (p) {
      db.orders.push({ id: newOrderId(db, p[1], T), created: iso(T), dept: p[1], bed: p[2], patient: patient(p[0]), level: p[3],
        start: iso(addDays(T, 1)), days: p[4], needs: p[5], slot: "24小时", inpatient: "ZY" + ymd6(T).slice(0, 4) + pad(100 + p[2], 3), status: 0, caregiver: null, note: "" });
    });
    // Live alerts and a caregiver waiting to be signed into the ward (orthopaedics, where the demo nurse station sits)
    var live = db.orders.filter(function (o) { return o.status === 1; });
    var ortho = live.filter(function (o) { return o.dept === "03"; });
    var hot = ortho[0] || live[0], miss = live.filter(function (o) { return o !== hot; })[0];
    if (hot) { hot.sim = "temp"; db.alerts.push({ id: 1, order: hot.id, type: "体温异常", detail: "体温 38.6℃（≥38.5℃）", level: "watch", time: iso(T) + " 07:42", handled: false }); }
    if (miss) db.alerts.push({ id: 2, order: miss.id, type: "漏打卡", detail: "昨日 23:00“夜间巡视与翻身”超过 2 小时未打卡", level: "watch", time: iso(T) + " 01:05", handled: false });
    var bpo = live.filter(function (o) { return o.dept === "05" && o !== miss; })[0];
    if (bpo) { if (bpo.needs.indexOf("bp") < 0) bpo.needs.push("bp"); bpo.sim = "bp"; db.alerts.push({ id: 4, order: bpo.id, type: "血压偏高", detail: "血压 186/112 mmHg（≥180/110）", level: "urgent", time: iso(T) + " 07:36", handled: false }); }
    var sl = live.filter(function (o) { return o.dept === "06" && o !== hot && o !== miss; })[0];
    if (sl) { if (sl.needs.indexOf("sleep") < 0) sl.needs.push("sleep"); sl.sleepMode = "device"; sl.sim = "sleep";
      db.alerts.push({ id: 5, order: sl.id, type: "离床未归", detail: "夜间 03:12 离床 22 分钟未回床（跌倒风险）", level: "urgent", time: iso(T) + " 03:34", handled: false, source: "智能睡眠监测带" }); }
    var gl = live.filter(function (o) { return o.dept === "08" && o !== miss; })[0];
    if (gl) { if (gl.needs.indexOf("glucose") < 0) gl.needs.push("glucose"); gl.glucoseFreq = "d4"; gl.sim = "glu";
      db.alerts.push({ id: 6, order: gl.id, type: "低血糖", detail: "空腹血糖 3.4 mmol/L（<3.9），请按医嘱补充糖分，15 分钟后复测", level: "urgent", time: iso(T) + " 07:04", handled: false }); }
    ["03", "05", "08", "06"].forEach(function (dept) {
      var e = live.filter(function (o) { return o.dept === dept && o !== hot && o !== miss; }).sort(function (a, b) { return a.start < b.start ? 1 : -1; })[0];
      if (e) e.entryConfirmed = false;
    });
    // Complaints waiting for a follow-up call
    var low = db.orders.filter(function (o) { return o.status === 3 && o.rating && o.rating <= 3; }).slice(-2);
    ["夜间呼叫后护工响应较慢", "交接班时与家属沟通不到位"].forEach(function (t, i) {
      if (low[i]) db.complaints.push({ id: i + 1, order: low[i].id, content: t, time: iso(addDays(T, -1 - i)) + " 1" + (4 + i) + ":20", status: "待回访" });
    });
    // 演示护工李秀兰（高级护工）：今天是张*明（骨科 8 床）的第 7 天，另有两张已结清订单
    var li = db.caregivers[0], t6 = addDays(T, -6);
    db.orders.forEach(function (o) { if (o.status <= 1 && o.dept === "03" && o.bed === 8) o.bed = 41; if (o.status <= 1 && o.dept === "03" && o.bed === 12) o.bed = 37; });
    function liHist(dept, bed, name, gender, age, start, days, needs, idx) {
      var o = { id: newOrderId(db, dept, start), created: iso(start), dept: dept, bed: bed, level: 0, status: 3, caregiver: li.id, accepted: true, entryConfirmed: true,
        patient: { name: name, gender: gender, age: age, contact: name.charAt(0) + "*（家属）", phone: "138****" + pad(3100 + idx * 37, 4) }, inpatient: "ZY" + ymd6(start).slice(0, 4) + pad(200 + idx, 3),
        start: iso(start), days: days, needs: needs, slot: "24小时", note: "", payType: idx % 2 ? 2 : 1, paidAt: iso(addDays(start, days)), rating: 5 };
      db.orders.push(o); return o;
    }
    var ordA = liHist("05", 14, "马*华", "男", 74, addDays(T, -22), 8, ["turning", "night"], 1);
    var ordB = liHist("08", 1, "杨*丽", "女", 79, addDays(T, -12), 4, ["turning", "night"], 2);
    var mine = { id: newOrderId(db, "03", t6), created: iso(t6), dept: "03", bed: 8, level: 0, status: 1, caregiver: li.id, accepted: true, entryConfirmed: true,
      patient: { name: "张*明", gender: "男", age: 81, contact: "张*（女儿）", phone: "137****2086" }, inpatient: "ZY" + ymd6(t6).slice(0, 4) + "077",
      start: iso(t6), days: 7, needs: ["turning", "tube", "night", "bp", "glucose", "sleep"], glucoseFreq: "d2", sleepMode: "device", slot: "24小时", note: "脑梗后左侧肢体偏瘫，高血压病史 10 年、2 型糖尿病（均服药控制），需每 2 小时翻身，鼻饲喂养；今日出院", acceptedAt: iso(t6) + " 07:20", entryAt: iso(t6) + " 07:35" };
    db.orders.push(mine);
    function doneItems(o, day, lateIdx, skipLast, back) {
      return planFor(o, day).map(function (p, i, arr) {
        if (skipLast && i === arr.length - 1) return { time: p[0], name: p[1], doneAt: null };
        var m = minutes(p[0]) + 2 + (i * 3 + back * 2) % 11 + (i === lateIdx ? 38 : 0);
        return { time: p[0], name: p[1], doneAt: pad(Math.floor(m / 60)) + ":" + pad(m % 60) };
      });
    }
    // 张*明前 6 天：血压、血糖随照护逐步平稳（第 2 天血压 184/108 触发紧急预警，护士站处理后复测下降）
    var sbpM = [172, 184, 164, 160, 157, 153], fast = [9.8, 9.2, 8.6, 8.1, 7.8, 7.4], dinner = [14.2, 13.0, 12.4, 11.9, 11.6, 10.9], tempD = [36.8, 37.4, 36.9, 36.7, 36.6, 36.7];
    for (var i2 = 0; i2 < 6; i2++) {
      var dd = addDays(t6, i2), sb = sbpM[i2], dia = function (x) { return Math.round(x * 0.58); }, dayS = iso(dd);
      var vs = [{ at: dayS + " 07:3" + i2, pulse: String(82 - i2), bp: sb + "/" + dia(sb) }, { at: dayS + " 10:3" + (i2 % 5), temp: tempD[i2], pulse: String(78 - i2), bp: (sb - 12) + "/" + dia(sb - 12) },
        { at: dayS + " 16:0" + (i2 + 1), pulse: String(74 + i2 % 3), bp: (sb - 18) + "/" + dia(sb - 18) }, { at: dayS + " 20:3" + (i2 % 6), pulse: String(70 + i2 % 4), bp: (sb - 24) + "/" + dia(sb - 24) },
        { at: dayS + " 07:0" + (i2 + 2), glu: fast[i2], gluCtx: "空腹", gluBy: "护士" }, { at: dayS + " 20:0" + (i2 + 3), glu: dinner[i2], gluCtx: "晚餐后 2 小时", gluBy: "护士" }];
      if (i2 === 1) vs.splice(1, 0, { at: dayS + " 08:35", pulse: "88", bp: "166/98" });
      vs.sort(function (a, b) { return a.at < b.at ? -1 : 1; });
      db.logs[mine.id + "@" + dayS] = { clockIn: dayS + " 07:" + (48 + i2), submittedAt: dayS + " 21:" + (30 + i2 * 3), vitals: vs, sleep: sleepGen(mine, dd), items: doneItems(mine, dd, i2 === 3 ? 4 : -1, false, i2) };
    }
    db.alerts.push({ id: 7, level: "urgent", order: mine.id, type: "血压偏高", detail: "血压 184/108 mmHg（≥180/110）", time: iso(addDays(t6, 1)) + " 07:34", handled: true,
      result: "护士站已复测 166/98，通知医生，调整降压药并嘱卧床休息", handledAt: iso(addDays(t6, 1)) + " 08:20", handledBy: "骨科护士站" });
    // 杨*丽最后三天的护理日志
    var notes = [{ late: null, temp: [36.6, 36.8] }, { late: 4, temp: [37.4, 36.9] }, { late: null, temp: [36.5, 36.7], skipNight: true }];
    for (var back = 0; back < Math.min(3, ordB.days); back++) {
      var day = addDays(endDate(ordB), -back), n = notes[back];
      db.logs[ordB.id + "@" + iso(day)] = { clockIn: iso(day) + " 07:" + (48 + back * 3), submittedAt: iso(day) + " 21:" + (30 + back * 7),
        vitals: [{ at: iso(day) + " 10:3" + (2 + back), temp: n.temp[0], pulse: String(74 + back * 3), bp: (126 + back * 4) + "/" + (78 + back) }, { at: iso(day) + " 16:1" + (5 + back), temp: n.temp[1], pulse: String(72 + back * 2), bp: (124 + back * 3) + "/7" + (6 + back) }],
        items: doneItems(ordB, day, n.late, !!n.skipNight, back) };
    }
    db.alerts.push({ id: 3, level: "urgent", order: db.orders[3].id, type: "护工上报", detail: "患者夜间躁动，已通知值班护士", time: iso(addDays(T, -6)) + " 02:10", handled: true });
    return db;
  }

  function load() {
    try { var db = JSON.parse(localStorage.getItem(KEY)); if (db && db.v === 8) return db; } catch (e) {}
    var fresh = seed(); save(fresh); return fresh;
  }
  function save(db) { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} }
  var db = load();

  function carer(id) { return db.caregivers.filter(function (c) { return c.id === id; })[0]; }
  function order(id) { return db.orders.filter(function (o) { return o.id === id; })[0]; }
  function endDate(o) { return addDays(parse(o.start), o.days - 1); }
  function bedLabel(o) { return DEPTS[o.dept] + " " + o.bed + "床"; }
  function needText(o) {
    return o.needs.length ? o.needs.map(function (n) {
      if (n === "glucose") return "血糖监测（糖尿病，" + GLU_FREQ[o.glucoseFreq || "d2"] + "）";
      if (n === "sleep") return "睡眠监测（" + SLEEP_MODE[o.sleepMode || "device"] + "）";
      return NEEDS[n];
    }).join("、") : "无";
  }

  /* 费用计算（P-10）：应收 = 天数 × 日价 × 折扣 + 附加服务费；本次应付 = 应收 − 押金 */
  function bill(o) {
    var n = o.status === 1 ? Math.max(1, Math.min(o.days, dayDiff(o.start, today()) + 1)) : o.days;
    var rate = RULE[o.level].rate, k = discountFor(n);
    var base = Math.round(n * rate * k * 100) / 100;
    var extras = o.needs.filter(function (x) { return EXTRAS[x]; }).map(function (x) { return { name: NEEDS[x] + "附加", price: EXTRAS[x], qty: n, amount: EXTRAS[x] * n }; });
    var receivable = base + extras.reduce(function (s, e) { return s + e.amount; }, 0);
    return { days: n, rate: rate, k: k, base: base, extras: extras, receivable: receivable, deposit: DEPOSIT, payable: Math.max(0, receivable - DEPOSIT), refund: Math.max(0, DEPOSIT - receivable) };
  }
  function orderAmount(o) { return o.status === 9 ? 0 : o.status <= 1 ? estimate(o.level, o.days, o.needs).total : bill(o).receivable; }
  function estimate(level, days, needs) {
    var k = discountFor(days), base = days * RULE[level].rate * k;
    var extra = needs.reduce(function (s, x) { return s + (EXTRAS[x] || 0) * days; }, 0);
    return { k: k, base: base, extra: extra, total: base + extra };
  }

  /* ---------- Care logs (护理日志) ---------- */
  function minutes(t) { var p = t.split(":"); return +p[0] * 60 + +p[1]; }
  function nowMinutes() { var d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
  function planFor(o, day) {
    var tube = o.needs.indexOf("tube") >= 0, turn = o.level === 0 || o.needs.indexOf("turning") >= 0;
    var plan = [["08:00", "晨间护理（洗漱、口腔清洁）"], ["08:30", tube ? "鼻饲喂养（早餐）" : "协助早餐"]];
    if (turn) plan.push(["10:00", "翻身拍背"]);
    plan.push(["10:30", "体征测量与记录"], ["12:00", tube ? "鼻饲喂养（午餐）" : "协助午餐"]);
    if (turn) plan.push(["14:00", "翻身拍背"]);
    if (o.needs.indexOf("rehab") >= 0) plan.push(["15:00", "床旁康复训练"]);
    if (o.needs.indexOf("catheter") >= 0) plan.push(["16:00", "导尿管护理"]);
    plan.push(["18:00", "协助晚餐"], ["21:00", "睡前护理"]);
    if (o.needs.indexOf("night") >= 0) plan.push(["23:00", "夜间巡视与翻身"]);
    if (o.needs.indexOf("bp") >= 0) plan.push(["07:30", "晨起血压测量（服药前）"], ["16:00", "血压测量"], ["20:30", "睡前血压测量"]);
    // 血糖按医嘱频次测量：医院病人由护士测量，护工到点提醒并记录结果
    if (o.needs.indexOf("glucose") >= 0) {
      var wd = (day || today()).getDay(), f = o.glucoseFreq || "d2", by = "（护士测量，护工记录）";
      var g = { d4: [["07:00", "空腹血糖"], ["10:30", "早餐后 2 小时血糖"], ["14:00", "午餐后 2 小时血糖"], ["20:00", "晚餐后 2 小时血糖"]], d2: [["07:00", "空腹血糖"], ["20:00", "晚餐后 2 小时血糖"]], d1: [["07:00", "空腹血糖"]],
        w2: wd === 1 || wd === 4 ? [["07:00", "空腹血糖"]] : [], w1: wd === 1 ? [["07:00", "空腹血糖"]] : [] }[f] || [];
      g.forEach(function (x) { plan.push([x[0], x[1] + by]); });
    }
    if (o.needs.indexOf("sleep") >= 0 && o.sleepMode === "observe") plan.push(["07:15", "填写昨晚睡眠记录"]);
    return plan.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
  }
  /* 床头码：二维码内容为 KHT-BED:科室代码-床号，例如 KHT-BED:03-08 */
  function bedCode(dept, bed) { return dept + "-" + pad(bed); }
  function parseBed(text) { var m = /(\d{2})\s*-\s*(\d{1,2})/.exec(String(text || "")); return m ? { dept: m[1], bed: Number(m[2]) } : null; }
  /* 体征预警分级（演示用阈值，实际应由医生按病人设定）
     紧急：体温 ≥39℃；血压 ≥180/110 或 <80/50；脉搏 >130 或 <45；血糖 <3.9 或 ≥16.7 mmol/L
     关注：体温 ≥38.5℃；一般病人血压 ≥160/100 或 <90/60，高血压病人 <100/60；脉搏 >120 或 <50；血糖 ≥13.9 mmol/L */
  function parseBP(bp) { var m = /^(\d{2,3})\s*\/\s*(\d{2,3})$/.exec(String(bp || "")); return m ? { s: +m[1], d: +m[2] } : null; }
  function vitalAlerts(o, v) {
    var out = [], hyper = o && o.needs.indexOf("bp") >= 0, b = parseBP(v.bp);
    if (v.temp && v.temp >= 39) out.push(["体温异常", "体温 " + v.temp + "℃（≥39℃）", "urgent"]);
    else if (v.temp && v.temp >= 38.5) out.push(["体温异常", "体温 " + v.temp + "℃（≥38.5℃）", "watch"]);
    if (b) {
      if (b.s >= 180 || b.d >= 110) out.push(["血压偏高", "血压 " + v.bp + " mmHg（≥180/110）", "urgent"]);
      else if (!hyper && (b.s >= 160 || b.d >= 100)) out.push(["血压偏高", "血压 " + v.bp + " mmHg（≥160/100）", "watch"]);
      if (b.s < 80 || b.d < 50) out.push(["血压偏低", "血压 " + v.bp + " mmHg（<80/50）", "urgent"]);
      else if (hyper ? b.s < 100 || b.d < 60 : b.s < 90 || b.d < 60) out.push(["血压偏低", "血压 " + v.bp + " mmHg（" + (hyper ? "高血压病人<100/60" : "<90/60") + "）", "watch"]);
    }
    var pl = Number(v.pulse);
    if (pl && (pl > 130 || pl < 45)) out.push(["脉搏异常", "脉搏 " + pl + " 次/分（" + (pl > 130 ? ">130" : "<45") + "）", "urgent"]);
    else if (pl && (pl > 120 || pl < 50)) out.push(["脉搏异常", "脉搏 " + pl + " 次/分（" + (pl > 120 ? ">120" : "<50") + "）", "watch"]);
    if (v.glu) {
      var ctx = v.gluCtx ? v.gluCtx + "血糖 " : "血糖 ";
      if (v.glu < 3.9) out.push(["低血糖", ctx + v.glu + " mmol/L（<3.9），请按医嘱补充糖分，15 分钟后复测", "urgent"]);
      else if (v.glu >= 16.7) out.push(["血糖严重偏高", ctx + v.glu + " mmol/L（≥16.7，警惕酮症）", "urgent"]);
      else if (v.glu >= 13.9) out.push(["血糖偏高", ctx + v.glu + " mmol/L（≥13.9）", "watch"]);
    }
    return out;
  }
  /* 睡眠：智能睡眠监测带自动采集，或护工观察记录 */
  function sleepGen(o, day) {
    var r = rng(strHash(o.id + "@sleep@" + iso(day))), bedMin = 21 * 60 + 35 + Math.floor(r() * 55), wakeMin = 5 * 60 + 40 + Math.floor(r() * 50);
    var wakes = 1 + Math.floor(r() * 3), leave = [], s = { mode: "device", day: iso(day) };
    var toilet = Math.floor(r() * 3);
    for (var i = 0; i < toilet; i++) leave.push({ at: pad(1 + i * 2) + ":" + pad(Math.floor(r() * 50) + 5), min: 3 + Math.floor(r() * 6) });
    if (o.sim === "sleep") { leave.push({ at: "03:12", min: 22 }); wakes = 4; }
    var awake = wakes * (8 + Math.floor(r() * 10)) + leave.reduce(function (a, x) { return a + x.min; }, 0);
    s.bed = pad(Math.floor(bedMin / 60)) + ":" + pad(bedMin % 60); s.wake = pad(Math.floor(wakeMin / 60)) + ":" + pad(wakeMin % 60);
    s.total = (24 * 60 - bedMin) + wakeMin - awake; s.wakes = wakes; s.leave = leave;
    s.hr = 58 + Math.floor(r() * 14); s.apnea = o.sim === "sleep" ? 17 : Math.floor(r() * 6);
    s.quality = s.total >= 390 && wakes <= 2 ? "好" : s.total >= 300 ? "一般" : "差";
    return s;
  }
  function sleepAlerts(s) {
    var out = [], longest = (s.leave || []).reduce(function (a, x) { return x.min > a.min ? x : a; }, { min: 0 });
    if (longest.min >= 15) out.push(["离床未归", "夜间 " + longest.at + " 离床 " + longest.min + " 分钟未回床（跌倒风险）", "urgent"]);
    if (s.apnea >= 15) out.push(["睡眠呼吸异常", "夜间呼吸暂停 " + s.apnea + " 次（疑似睡眠呼吸暂停）", "urgent"]);
    (s.events || []).forEach(function (e) { if (e.type === "躁动不安" || e.type === "呼吸异常") out.push([e.type, "夜间 " + e.at + " " + e.type + (e.type === "躁动不安" ? "（警惕谵妄）" : ""), "urgent"]); });
    if (s.total && s.total < 240) out.push(["睡眠不足", "昨晚睡眠约 " + (s.total / 60).toFixed(1) + " 小时（<4 小时）", "watch"]);
    var toilet = s.mode === "device" ? (s.leave || []).length : s.toilet;
    if (toilet >= 3) out.push(["夜间起夜多", "夜间起夜 " + toilet + " 次（跌倒风险，需加强看护）", "watch"]);
    return out;
  }
  function sleepText(s) {
    if (!s) return "";
    var h = Math.floor(s.total / 60), m = s.total % 60, toilet = s.mode === "device" ? s.leave.length : s.toilet;
    return "昨晚 " + s.bed + " 入睡，" + s.wake + " 醒来，约睡 " + h + " 小时" + (m ? " " + m + " 分" : "") + "，夜醒 " + s.wakes + " 次，起夜 " + toilet + " 次" +
      (s.mode === "device" ? "，平均心率 " + s.hr + " 次/分，呼吸暂停 " + s.apnea + " 次" : "") + "，睡眠质量" + s.quality + "（" + (s.mode === "device" ? "智能睡眠监测带" : "护工观察") + "）";
  }
  function alertTag(a) { return '<span class="tag ' + (a.level === "urgent" ? "tag-alert" : "tag-2") + '">' + (a.level === "urgent" ? "紧急 · " : "关注 · ") + esc(a.type) + "</span>"; }
  function byLevel(a, b) { return (a.level === "urgent" ? 0 : 1) - (b.level === "urgent" ? 0 : 1) || (a.time < b.time ? 1 : -1); }
  function vitalText(o, v) {
    var al = vitalAlerts(o, v);
    return v.at.slice(11) + (v.temp ? "　体温 " + v.temp + "℃" : "") + (v.pulse ? "　脉搏 " + v.pulse : "") + (v.bp ? "　血压 " + esc(v.bp) : "") +
      (v.glu ? "　" + esc(v.gluCtx || "") + "血糖 " + v.glu + "（" + (v.gluBy || "护士") + "测）" : "") +
      al.map(function (a) { return '　<span class="pill ' + (a[2] === "urgent" ? "pill-late" : "pill-todo") + '">' + a[0] + "</span>"; }).join("");
  }
  /* 最近体征：最近一次体温与血压，异常标红 */
  function latestVitals(o, lg) {
    if (!lg || !lg.vitals.length) return "—";
    var t = lg.vitals.filter(function (v) { return v.temp; }).slice(-1)[0], b = lg.vitals.filter(function (v) { return v.bp; }).slice(-1)[0], g = lg.vitals.filter(function (v) { return v.glu; }).slice(-1)[0], out = [];
    function mark(v, text) { return vitalAlerts(o, v).length ? '<b style="color:var(--alert)">' + text + "</b>" : text; }
    if (t) out.push(mark({ temp: t.temp }, t.temp + "℃"));
    if (b) out.push(mark({ bp: b.bp }, b.bp));
    if (g) out.push(mark({ glu: g.glu }, "血糖 " + g.glu));
    return out.join(" · ") || "—";
  }

  /* ---------- 体征趋势图（近 7 天） ---------- */
  /* 示例订单没有保存过去几天的日志时，按订单编号确定性地生成体征历史，仅用于趋势图 */
  function histVitals(o, d) {
    if (!o.auto || d >= today() || d < parse(o.start)) return [];
    var r = rng(strHash(o.id + iso(d))), n = dayDiff(o.start, d), hyper = o.needs.indexOf("bp") >= 0, day = iso(d), out = [];
    var base = hyper ? 166 - n * 2 : 124 + Math.floor(r() * 10), dia = function (x) { return Math.round(x * 0.58); };
    function t(x) { return Math.round(x * 10) / 10; }
    if (hyper) { var m = base + Math.floor(r() * 7 - 3); out.push({ at: day + " 07:3" + Math.floor(r() * 9), pulse: String(72 + Math.floor(r() * 12)), bp: m + "/" + dia(m) }); }
    var m2 = hyper ? base - 12 + Math.floor(r() * 7 - 3) : base;
    out.push({ at: day + " 10:3" + Math.floor(r() * 9), temp: t(36.4 + r() * 0.6 + (r() < 0.08 ? 0.7 : 0)), pulse: String(68 + Math.floor(r() * 18)), bp: m2 + "/" + dia(m2) });
    if (hyper) { var m3 = base - 20 + Math.floor(r() * 7 - 3); out.push({ at: day + " 20:3" + Math.floor(r() * 9), pulse: String(66 + Math.floor(r() * 10)), bp: m3 + "/" + dia(m3) }); }
    if (o.needs.indexOf("glucose") >= 0) {
      out.push({ at: day + " 07:0" + Math.floor(r() * 9), glu: t(6.1 + r() * 2.4 - n * 0.1), gluCtx: "空腹", gluBy: "护士" });
      if (o.glucoseFreq === "d2" || o.glucoseFreq === "d4") out.push({ at: day + " 20:0" + Math.floor(r() * 9), glu: t(9.0 + r() * 3.2 - n * 0.15), gluCtx: "晚餐后 2 小时", gluBy: "护士" });
    }
    return out.sort(function (a, b) { return a.at < b.at ? -1 : 1; });
  }
  function vitalPoints(o) {
    var T = today(), last = endDate(o) < T ? endDate(o) : T, first = addDays(last, -6);
    if (parse(o.start) > first) first = parse(o.start);
    var pts = [];
    for (var d = first; d <= last; d = addDays(d, 1)) {
      var lg = iso(d) === iso(T) ? logFor(o) : db.logs[o.id + "@" + iso(d)];
      var vs = lg ? lg.vitals : histVitals(o, d);
      vs.forEach(function (v) { pts.push({ x: dayDiff(first, d) + minutes(v.at.slice(11)) / 1440, v: v, date: iso(d) }); });
    }
    return { first: first, days: dayDiff(first, last) + 1, pts: pts };
  }
  /* 通用折线图：series 为若干折线，band 为正常范围底色，lines 为阈值虚线 */
  function lineSvg(o, vp, cfg) {
    var W = 560, H = 190, L = 38, R = 12, Tp = 14, B = 26, ys = [];
    cfg.series.forEach(function (sr) { sr.pts.forEach(function (p) { ys.push(p.y); }); });
    var lo = Math.min.apply(null, ys.concat([cfg.min])), hi = Math.max.apply(null, ys.concat([cfg.max]));
    lo = Math.floor(Math.min(lo, cfg.min) - (hi - lo) * 0.05); hi = Math.ceil(hi + (hi - lo) * 0.05);
    var sx = function (x) { return L + (W - L - R) * x / vp.days; }, sy = function (y) { return Tp + (H - Tp - B) * (1 - (y - lo) / (hi - lo)); };
    var svg = '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(cfg.title) + '趋势图">';
    if (cfg.band) svg += '<rect x="' + L + '" y="' + sy(cfg.band[1]) + '" width="' + (W - L - R) + '" height="' + (sy(cfg.band[0]) - sy(cfg.band[1])) + '" fill="#e3f6f4" opacity=".8"/>';
    for (var g = 0; g <= 3; g++) { var gv = lo + (hi - lo) * g / 3, gy = sy(gv); svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + gy + '" y2="' + gy + '" stroke="#e3e8ed"/><text x="' + (L - 5) + '" y="' + (gy + 4) + '" text-anchor="end">' + (cfg.dec ? gv.toFixed(1) : Math.round(gv)) + "</text>"; }
    (cfg.lines || []).forEach(function (ln) { if (ln.v > lo && ln.v < hi) svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + sy(ln.v) + '" y2="' + sy(ln.v) + '" stroke="' + ln.c + '" stroke-dasharray="5 4"/><text x="' + (W - R - 2) + '" y="' + (sy(ln.v) - 3) + '" text-anchor="end" style="fill:' + ln.c + '">' + ln.t + "</text>"; });
    for (var d = 0; d < vp.days; d++) svg += '<text x="' + sx(d + 0.5) + '" y="' + (H - 8) + '" text-anchor="middle">' + md(addDays(vp.first, d)) + "</text>" + (d ? '<line x1="' + sx(d) + '" x2="' + sx(d) + '" y1="' + Tp + '" y2="' + (H - B) + '" stroke="#eef1f4"/>' : "");
    cfg.series.forEach(function (sr) {
      var pts = sr.pts.slice().sort(function (a, b) { return a.x - b.x; });
      if (pts.length > 1) svg += '<polyline fill="none" stroke="' + sr.c + '" stroke-width="2.5" stroke-linejoin="round" points="' + pts.map(function (p) { return sx(p.x).toFixed(1) + "," + sy(p.y).toFixed(1); }).join(" ") + '"/>';
      pts.forEach(function (p) { svg += '<circle cx="' + sx(p.x).toFixed(1) + '" cy="' + sy(p.y).toFixed(1) + '" r="' + (p.bad ? 4.5 : 3.2) + '" fill="' + (p.bad ? "#c4362c" : sr.c) + '" stroke="#fff" stroke-width="1.2"><title>' + esc(p.tip) + "</title></circle>"; });
    });
    return svg + "</svg>";
  }
  function trendCharts(o) {
    var vp = vitalPoints(o), out = "", hyper = o.needs.indexOf("bp") >= 0;
    function fig(title, note, svg, legend) { return '<figure class="trend"><figcaption><b>' + title + "</b><span>" + note + "</span></figcaption>" + svg + (legend ? '<p class="legend-line">' + legend + "</p>" : "") + "</figure>"; }
    var sys = [], dia = [], glu = [], tmp = [];
    vp.pts.forEach(function (p) {
      var v = p.v, b = parseBP(v.bp), tm = p.date.slice(5) + " " + v.at.slice(11);
      if (b) { var bad = vitalAlerts(o, { bp: v.bp }).length > 0; sys.push({ x: p.x, y: b.s, bad: bad, tip: tm + " 收缩压 " + b.s }); dia.push({ x: p.x, y: b.d, bad: bad, tip: tm + " 舒张压 " + b.d }); }
      if (v.glu) glu.push({ x: p.x, y: v.glu, bad: vitalAlerts(o, { glu: v.glu }).length > 0, tip: tm + " " + (v.gluCtx || "") + "血糖 " + v.glu });
      if (v.temp) tmp.push({ x: p.x, y: v.temp, bad: v.temp >= 38.5, tip: tm + " 体温 " + v.temp });
    });
    if (sys.length > 1) out += fig("血压 mmHg", hyper ? "高血压病人，每日定时测 3 次" : "", lineSvg(o, vp, { title: "血压", min: 50, max: 150, band: [90, 140], lines: [{ v: 180, c: "#c4362c", t: "紧急 ≥180" }].concat(hyper ? [] : [{ v: 160, c: "#c98a1c", t: "关注 ≥160" }]),
      series: [{ c: "#2e9be6", pts: sys }, { c: "#19b1a4", pts: dia }] }), '<i style="background:#2e9be6"></i>收缩压　<i style="background:#19b1a4"></i>舒张压　<i class="band"></i>参考范围 90–140　<i class="bad"></i>超出阈值');
    if (glu.length > 1) out += fig("血糖 mmol/L", "护士测量，护工记录", lineSvg(o, vp, { title: "血糖", min: 3, max: 16, dec: true, band: [3.9, 10], lines: [{ v: 13.9, c: "#c98a1c", t: "关注 ≥13.9" }, { v: 16.7, c: "#c4362c", t: "紧急 ≥16.7" }],
      series: [{ c: "#e0a35a", pts: glu }] }), '<i style="background:#e0a35a"></i>血糖　<i class="band"></i>目标 3.9–10.0　<i class="bad"></i>超出阈值');
    if (tmp.length > 1) out += fig("体温 ℃", "", lineSvg(o, vp, { title: "体温", min: 36, max: 38.8, dec: true, band: [36, 37.3], lines: [{ v: 38.5, c: "#c4362c", t: "关注 ≥38.5" }], series: [{ c: "#3aa6ee", pts: tmp }] }), '<i style="background:#3aa6ee"></i>体温　<i class="band"></i>参考范围 36.0–37.3');
    return out || '<p class="hint">体征记录不足 2 次，暂无趋势图。</p>';
  }
  function strHash(s) { var h = 7; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
  /* 今日护理日志；示例订单按当前时间模拟护工已完成的打卡，新派的订单由护工本人打卡 */
  function logFor(o) {
    if (o.status !== 1 || !o.accepted || parse(o.start) > today()) return null;
    var key = o.id + "@" + iso(today()), lg = db.logs[key];
    if (!lg) lg = db.logs[key] = { clockIn: null, items: planFor(o, today()).map(function (p) { return { time: p[0], name: p[1], doneAt: null }; }), vitals: [], auto: !!o.auto };
    if (o.needs.indexOf("sleep") >= 0 && (o.sleepMode || "device") === "device" && !lg.sleep && parse(o.start) < today()) {
      lg.sleep = sleepGen(o, today());
      if (!o.sim) sleepAlerts(lg.sleep).forEach(function (a) { db.alerts.push({ id: Date.now() + Math.random(), order: o.id, type: a[0], detail: a[1], level: a[2], time: iso(today()) + " " + lg.sleep.wake, handled: false, source: "智能睡眠监测带" }); });
    }
    if (lg.auto) {
      var r = rng(strHash(key)), nm = nowMinutes();
      if (o.needs.indexOf("glucose") >= 0 && nm >= 435 && lg.items.some(function (x) { return x.time === "07:00"; }) && !lg.vitals.some(function (v) { return v.glu; }))
        lg.vitals.unshift({ at: iso(today()) + " 07:0" + Math.floor(r() * 9), glu: o.sim === "glu" ? 3.4 : Math.round((6.2 + r() * 3) * 10) / 10, gluCtx: "空腹", gluBy: "护士" });
      if (!lg.clockIn) lg.clockIn = iso(today()) + " 07:" + pad(40 + Math.floor(r() * 15));
      lg.items.forEach(function (it, i) {
        var m = minutes(it.time);
        if (!it.doneAt && m + 15 <= nm) { var t = m + Math.floor(rng(strHash(key + i))() * 13); it.doneAt = pad(Math.floor(t / 60)) + ":" + pad(t % 60); }
      });
      if (o.sim === "temp" && !lg.vitals.length) lg.vitals.push({ at: iso(today()) + " 07:40", temp: 38.6, pulse: "96", bp: "136/86" });
      if (o.needs.indexOf("bp") >= 0 && nm >= 470 && !lg.vitals.some(function (v) { return v.at.slice(11) < "08:00"; })) lg.vitals.unshift({ at: iso(today()) + " 07:3" + (2 + Math.floor(r() * 6)), pulse: String(74 + Math.floor(r() * 12)), bp: o.sim === "bp" ? "186/112" : (148 + Math.floor(r() * 14)) + "/" + (86 + Math.floor(r() * 8)) });
      if (nm >= 640 && !lg.vitals.some(function (v) { return v.at.slice(11) >= "10:30"; })) lg.vitals.push({ at: iso(today()) + " 10:3" + Math.floor(r() * 9), temp: o.sim === "temp" ? 37.8 : Math.round((36.3 + r() * 0.7) * 10) / 10, pulse: String(68 + Math.floor(r() * 20)), bp: (118 + Math.floor(r() * 20)) + "/" + (72 + Math.floor(r() * 12)) });
    }
    return lg;
  }
  function progress(lg) {
    var nm = nowMinutes(), items = lg.items.filter(function (x) { return !x.skipped; });
    return { done: items.filter(function (x) { return x.doneAt; }).length, due: items.filter(function (x) { return minutes(x.time) <= nm; }).length, total: items.length,
      late: items.filter(function (x) { return !x.doneAt && nm - minutes(x.time) > 120; }).length };
  }

  /* ---------- Accounts, menus and permissions ---------- */
  var ACCOUNTS = {
    kf001: { name: "陈晓", role: "客服专员", dept: "客户服务部" },
    pb001: { name: "何静", role: "排班专员", dept: "人员排班部" },
    yy001: { name: "周敏", role: "运营经理", dept: "运营管理部" },
    admin: { name: "管理员", role: "系统管理员", dept: "信息中心" }
  };
  Object.keys(DEPTS).forEach(function (k) { ACCOUNTS["hs" + k] = { name: DEPTS[k] + "护士站", role: "护士站", dept: "医院护士站（" + DEPTS[k] + "）", ward: k }; });
  ACCOUNTS[db.caregivers[0].id] = { name: db.caregivers[0].name, role: "护工", dept: "高级护工", carer: db.caregivers[0].id, home: "nurse.html" };
  var PASSWORD = "123456";
  var ROLE_KEY = { "客服专员": "cs", "排班专员": "sched", "护士站": "station", "运营经理": "ops", "系统管理员": "admin", "护工": "carer" };
  function roleOf(u) { return ROLE_KEY[u.role]; }

  // Each role sees only the subsystems its job needs (表 2.1 用户层次与表 4.10 菜单设计)
  var M = {
    cs: ["客户服务", [["工作台", "home.html"], ["预约受理", "booking.html"], ["订单查询", "orders.html"], ["投诉回访", "home.html#complaints"]]],
    csFin: ["财务结算", [["结算单", "bill.html"], ["待支付订单", "orders.html?status=2"]]],
    csWatch: ["服务监管", [["护理日志", "logs.html"]]],
    sched: ["调度排班", [["工作台", "home.html"], ["智能派单", "dispatch.html"], ["排班总览", "schedule.html"], ["临时换班", "schedule.html#swap"]]],
    carers: ["护工管理", [["护工档案", "carers.html"], ["资质审核", "carers.html?filter=cert"]]],
    schedOrders: ["订单查询", [["订单查询", "orders.html"]]],
    station: ["护士站", [["工作台", "home.html"], ["进科报备", "home.html#entry"], ["异常预警", "home.html#alerts"], ["护理日志", "logs.html"], ["床头码打印", "bedcodes.html"]]],
    ops: ["统计决策", [["经营概览", "home.html"], ["运营统计", "stats.html"], ["质量分析", "stats.html#quality"], ["报表输出", "orders.html"]]],
    opsFin: ["财务结算", [["结算单", "bill.html"], ["收款对账", "orders.html?status=2"]]],
    opsWatch: ["服务监管", [["护理日志", "logs.html"], ["护工档案", "carers.html"]]],
    adminCs: ["客户服务", [["预约受理", "booking.html"], ["订单查询", "orders.html"]]],
    adminSched: ["调度排班", [["智能派单", "dispatch.html"], ["排班总览", "schedule.html"], ["临时换班", "schedule.html#swap"]]],
    adminWatch: ["服务监管", [["护理日志", "logs.html"], ["床头码打印", "bedcodes.html"], ["护工端预览", "nurse.html"]]],
    adminFin: ["财务结算", [["费用结算", "bill.html"], ["收款对账", "orders.html?status=2"]]],
    adminStats: ["统计决策", [["运营统计", "stats.html"], ["质量分析", "stats.html#quality"]]],
    system: ["系统管理", [["系统主界面", "home.html"], ["用户权限", "users.html"], ["数据备份", "#reset"], ["退出系统", "#logout"]]]
  };
  var MENUS = {
    cs: [M.cs, M.csFin, M.csWatch],
    sched: [M.sched, M.carers, M.schedOrders],
    station: [M.station],
    ops: [M.ops, M.opsFin, M.opsWatch],
    admin: [M.adminCs, M.adminSched, M.carers, M.adminWatch, M.adminFin, M.adminStats, M.system]
  };
  var PAGE_ROLES = {
    home: ["cs", "sched", "station", "ops", "admin"], booking: ["cs", "admin"], dispatch: ["sched", "admin"], schedule: ["sched", "admin"],
    carers: ["sched", "ops", "admin"], orders: ["cs", "sched", "ops", "admin"], logs: ["cs", "station", "ops", "admin"],
    stats: ["ops", "admin"], bill: ["cs", "ops", "admin"], users: ["admin"], bedcodes: ["station", "admin"]
  };
  var WAGE = { 1: 180, 2: 140, 3: 90 };          // 护工日薪（元/天）
  var STAR_COEF = { 5: 1.1, 4: 1.0, 3: 0.9 };    // 星级系数

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
    var role = roleOf(user);
    if (role === "carer") { location.replace("nurse.html"); return false; }
    var body = document.body, main = $("main"), menus = MENUS[role];
    var here = location.pathname.split("/").pop() || "home.html", full = here + location.search + location.hash, cur = null;
    function base(h) { return h.split(/[?#]/)[0]; }
    menus.forEach(function (m) { m[1].forEach(function (it) { if (!cur && it[1] === full) cur = [m[0], it[0], it[1]]; }); });
    menus.forEach(function (m) { m[1].forEach(function (it) { if (!cur && base(it[1]) === here) cur = [m[0], it[0], it[1]]; }); });

    function link(it) { return '<a href="' + it[1] + '"' + (cur && cur[2] === it[1] ? ' class="is-current" aria-current="page"' : "") + ">" + esc(it[0]) + "</a>"; }
    var s = document.createElement("div");
    s.className = "shell";
    s.innerHTML =
      '<header class="topbar"><a class="topbar-brand" href="home.html"><img src="../assets/img/logo.svg" alt="">康护通<small>陪护管理信息系统</small></a>' +
      '<span class="topbar-title">' + esc(user.dept) + "</span>" +
      '<div class="topbar-right"><span class="user-chip"><span class="avatar">' + esc(user.name.slice(0, 1)) + "</span>" + esc(user.role + " " + user.name) + "</span>" +
      roleSwitcherHtml(user.id) + '<a href="../index.html">官网首页</a><button type="button" data-logout>退出</button></div></header>' +
      '<nav aria-label="系统菜单"><ul class="menubar">' + menus.map(function (m) {
        return '<li class="' + (cur && m[0] === cur[0] ? "is-current" : "") + '"><button type="button" aria-expanded="false">' + esc(m[0]) + "</button><ul>" +
          m[1].map(function (it) { return "<li>" + link(it) + "</li>"; }).join("") + "</ul></li>";
      }).join("") + "</ul></nav>" +
      '<aside class="sidenav" aria-label="功能树">' + menus.map(function (m) {
        return "<details open><summary>" + esc(m[0]) + "</summary><ul>" + m[1].map(function (it) { return "<li>" + link(it) + "</li>"; }).join("") + "</ul></details>";
      }).join("") + "</aside>" +
      '<footer class="statusbar"><span>当前用户：' + esc(user.role + " " + user.name + " | " + user.dept) + '</span><span data-clock></span></footer>';
    body.insertBefore(s, main);
    s.insertBefore(main, $(".statusbar", s));
    main.classList.add("main");
    var title = body.getAttribute("data-title") || "";
    main.insertAdjacentHTML("afterbegin", '<div class="crumb">' + (cur ? "<b>" + esc(cur[0]) + "</b> › " + esc(cur[1]) : "<b>" + esc(title) + "</b>") + "</div>");

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
      if (h === "#reset") { e.preventDefault(); resetData(); }
      if (h === "#logout") { e.preventDefault(); logout(); }
    });
    $("[data-logout]", s).addEventListener("click", logout);
    bindRoleSwitch(s);
    var clock = $("[data-clock]", s);
    (function tick() { var d = new Date(); clock.textContent = now() + ":" + pad(d.getSeconds()); setTimeout(tick, 1000); })();
    if (PAGE_ROLES[page] && PAGE_ROLES[page].indexOf(role) < 0) {
      main.innerHTML = '<div class="crumb"><b>无权限</b></div><section class="panel empty-state"><h2>当前角色无权访问此功能</h2><p>“' + esc(title) + "”不属于" + esc(user.role) + '的工作范围，系统已按角色隐藏相关菜单。</p><p><a class="btn btn-primary" href="home.html">返回我的工作台</a></p></section>';
      return false;
    }
    user.roleKey = role;
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
    var st = $("[data-station]");
    if (st) {
      st.innerHTML = Object.keys(DEPTS).map(function (k) { return '<option value="hs' + k + '"' + (k === "03" ? " selected" : "") + ">hs" + k + " " + DEPTS[k] + "</option>"; }).join("");
      st.addEventListener("change", function () { form.account.value = st.value; form.password.value = PASSWORD; form.captcha.value = code; form.role.value = "护士站"; msg.textContent = ""; });
    }
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

  /* ---------- Shared helpers for dashboards ---------- */
  function kpis(list) {
    return '<div class="kpis">' + list.map(function (k) { return '<div class="kpi ' + (k[3] || "") + '"><span>' + k[0] + "</span><strong>" + k[1] + "</strong>" + (k[2] ? "<em>" + k[2] + "</em>" : "") + "</div>"; }).join("") + "</div>";
  }
  function panel(title, inner, aside, id) {
    return '<section class="panel"' + (id ? ' id="' + id + '"' : "") + '><h2 class="panel-title">' + title + (aside ? ' <span class="aside">' + aside + "</span>" : "") + "</h2>" + inner + "</section>";
  }
  function table(head, rows, empty) {
    return '<div class="table-wrap"><table class="data"><thead><tr>' + head.map(function (h) { return "<th" + (h.charAt(0) === "#" ? ' class="num">' + h.slice(1) : ">" + h) + "</th>"; }).join("") + "</tr></thead><tbody>" +
      (rows.length ? rows.map(function (r) { return "<tr>" + r.map(function (c) { return typeof c === "object" && c ? '<td class="num">' + c.n + "</td>" : "<td>" + c + "</td>"; }).join("") + "</tr>"; }).join("") : '<tr><td colspan="' + head.length + '" class="hint">' + (empty || "暂无数据") + "</td></tr>") + "</tbody></table></div>";
  }
  function quick(items) { return '<div class="quick">' + items.map(function (q) { return '<a href="' + q[1] + '"><b>' + q[0] + "</b><span>" + q[2] + "</span></a>"; }).join("") + "</div>"; }
  function tag(o) {
    if (o.status === 1 && !o.accepted) return '<span class="tag tag-0">待护工接单</span>';
    if (o.status === 1 && !o.entryConfirmed) return '<span class="tag tag-1">待进科确认</span>';
    return '<span class="tag tag-' + o.status + '">' + STATUS[o.status] + "</span>";
  }
  function isIdle(c) {
    var n = db.orders.filter(function (o) { return o.status === 1 && o.caregiver === c.id; }).length;
    return c.status === "在岗" && n < (c.grade === 3 ? 3 : 1);
  }
  function lineChart(pts, W, H) {
    var vmax = Math.max.apply(null, pts.map(function (p) { return p[1]; }).concat([1])), n = pts.length, l = 30, step = (W - l - 20) / Math.max(1, n - 1);
    var path = pts.map(function (p, i) { return (i ? "L" : "M") + (l + i * step).toFixed(1) + " " + (H - 30 - (H - 50) * p[1] / vmax).toFixed(1); }).join(" ");
    var svg = '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="趋势图"><defs><linearGradient id="ln" x1="0" x2="1"><stop offset="0" stop-color="#3aa6ee"/><stop offset="1" stop-color="#19b1a4"/></linearGradient><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3aa6ee" stop-opacity=".22"/><stop offset="1" stop-color="#19b1a4" stop-opacity="0"/></linearGradient></defs>';
    for (var g = 0; g <= 3; g++) { var y = 20 + (H - 50) * g / 3; svg += '<line x1="' + l + '" x2="' + W + '" y1="' + y + '" y2="' + y + '" stroke="#e3e8ed"/><text x="' + (l - 6) + '" y="' + (y + 4) + '" text-anchor="end">' + Math.round(vmax * (3 - g) / 3) + "</text>"; }
    svg += '<path d="' + path + " L" + (l + (n - 1) * step).toFixed(1) + " " + (H - 30) + " L" + l + " " + (H - 30) + ' Z" fill="url(#area)"/><path d="' + path + '" fill="none" stroke="url(#ln)" stroke-width="3" stroke-linejoin="round"/>';
    pts.forEach(function (p, i) { if (n <= 14 || i % Math.ceil(n / 10) === 0 || i === n - 1) svg += '<text x="' + (l + i * step) + '" y="' + (H - 8) + '" text-anchor="middle">' + p[0].slice(5) + "</text>"; });
    return svg + "</svg>";
  }
  function dailyCounts(from, n) {
    var out = [];
    for (var i = 0; i < n; i++) { var day = iso(addDays(from, i)); out.push([day, db.orders.filter(function (o) { return o.created === day && o.status !== 9; }).length]); }
    return out;
  }
  function carerProfile(id) {
    var c = carer(id), done = db.orders.filter(function (o) { return o.caregiver === id && o.status === 3; });
    var cur = db.orders.filter(function (o) { return o.caregiver === id && o.status === 1; });
    modal("护工档案 · " + c.name, "<dl><dt>护工编号</dt><dd>" + c.id + "（校验位正确）</dd><dt>姓名 / 性别</dt><dd>" + esc(c.name) + " / " + c.gender + "</dd><dt>护工等级</dt><dd>" + GRADES[c.grade] + "护工</dd><dt>星级</dt><dd class=stars>" + stars(c.star) + "</dd><dt>好评率</dt><dd>" + c.good.toFixed(1) +
      "%</dd><dt>科室经验</dt><dd>" + Object.keys(c.exp).map(function (d) { return DEPTS[d] + " " + c.exp[d] + "年"; }).join("、") + "</dd><dt>入职日期</dt><dd>" + c.joined + "</dd><dt>证书有效期至</dt><dd>" + c.certExpire + "</dd><dt>本月服务</dt><dd>" + c.monthDays + " 天</dd><dt>当前在护</dt><dd>" + (cur.length ? cur.map(bedLabel).join("、") : "空闲") + "</dd><dt>累计完成订单</dt><dd>" + done.length + " 单</dd></dl>");
  }
  function handleAlert(a, by) {
    var o = order(a.order), c = carer(o.caregiver) || {};
    var d = modal("处理异常预警", "<dl><dt>订单编号</dt><dd>" + o.id + "</dd><dt>科室床位</dt><dd>" + bedLabel(o) + "</dd><dt>患者</dt><dd>" + esc(o.patient.name) + "</dd><dt>护工</dt><dd>" + esc((c.name || "—") + " " + (c.id || "")) +
      "</dd><dt>异常类型</dt><dd>" + alertTag(a) + (a.source ? "（来源：" + esc(a.source) + "）" : "") + "</dd><dt>详情</dt><dd>" + esc(a.detail) + "</dd><dt>发生时间</dt><dd>" + a.time + '</dd><dt>处理结果</dt><dd><textarea id="alert-result" placeholder="例如：已复测体温 37.6℃，值班医生已查看并开具医嘱"></textarea></dd></dl>',
      [button("处理完毕并反馈", "btn-primary", function () {
        a.handled = true; a.result = $("#alert-result").value || "已处理"; a.handledAt = now(); a.handledBy = by; save(db); d.close();
        toast("已处理，结果已反馈给护工与服务质检部", "ok"); setTimeout(function () { location.reload(); }, 600);
      })]);
  }

  /* 工作台：每个角色看到自己的待办（主控模块按角色显示菜单与信息） */
  pages.home = function (user) {
    var role = user.roleKey, box = $("#home");
    var active = db.orders.filter(function (o) { return o.status === 1; });
    var pending = db.orders.filter(function (o) { return o.status === 0; });
    var toPay = db.orders.filter(function (o) { return o.status === 2; });
    var alerts = db.alerts.filter(function (a) { return !a.handled; });
    var T = iso(today()), html = "";
    function oRow(o) { return [o.id, esc(o.patient.name), bedLabel(o), LEVELS[o.level]]; }

    if (role === "cs") {
      var todayNew = db.orders.filter(function (o) { return o.created === T && o.status !== 9; });
      var openComplaints = db.complaints.filter(function (c) { return c.status !== "已回访"; });
      html += kpis([["今日新增预约", todayNew.length, "本人与线上小程序受理"], ["等待排班部派单", pending.length, "派单由排班专员负责", "is-warn"],
        ["待家属支付", toPay.length, "合计 " + money(toPay.reduce(function (s, o) { return s + bill(o).payable; }, 0)) + " 元"], ["待回访投诉", openComplaints.length, "48 小时内回访", "is-alert"]]);
      html += panel("今日预约进度", table(["订单编号", "患者", "科室床位", "护理等级", "开始日期", "进度"], todayNew.map(function (o) {
        var c = carer(o.caregiver);
        return oRow(o).concat([o.start, o.status === 0 ? '<span class="tag tag-0">排班部派单中</span>' : tag(o) + (c ? "　" + esc(c.name) : "")]);
      }), "今天还没有新预约"), '<a class="btn btn-sm btn-primary" href="booking.html">新建预约</a>');
      html += panel("待家属支付", table(["订单编号", "患者", "科室床位", "护理等级", "#本次应付（元）", "操作"], toPay.map(function (o) {
        return oRow(o).concat([{ n: money(bill(o).payable) }, '<a href="bill.html?order=' + o.id + '">查看结算单 / 推送家属</a>']);
      }), "暂无待支付订单"));
      html += panel("投诉回访", table(["投诉时间", "订单编号", "患者", "投诉内容", "状态", "操作"], db.complaints.map(function (c) {
        var o = order(c.order);
        return [c.time, c.order, esc(o.patient.name), esc(c.content), c.status === "已回访" ? '<span class="tag tag-3">已回访</span>' : '<span class="tag tag-alert">待回访</span>',
          c.status === "已回访" ? esc(c.result || "") : '<button type="button" class="link-btn" data-complaint="' + c.id + '">登记回访</button>'];
      }), "暂无投诉"), "", "complaints");
      html += panel("常用功能", quick([["预约受理", "booking.html", "登记陪护需求，自动计算费用"], ["订单查询", "orders.html", "回答家属咨询、查询进度"], ["结算单", "bill.html", "推送结算单给家属"], ["护理日志", "logs.html", "查看患者当日护理记录"]]));
    } else if (role === "sched") {
      var idle = db.caregivers.filter(isIdle);
      var waiting = active.filter(function (o) { return !o.accepted; });
      var ending = active.filter(function (o) { var e = iso(endDate(o)); return e === T || e === iso(addDays(today(), 1)); });
      html += kpis([["待派订单", pending.length, "目标 15 分钟内派出", "is-warn"], ["空闲护工", idle.length, "在岗且仍有档期", "is-teal"], ["待护工接单", waiting.length, "已派单，等待护工确认"], ["今明两天到期", ending.length, "需续单或安排下一单"]]);
      html += panel("待派订单", table(["订单编号", "患者", "科室床位", "护理等级", "需派护工", "开始日期", "护工申请", "操作"], pending.map(function (o) {
        var ap = (o.applicants || []).map(function (id) { return carer(id).name; });
        return oRow(o).concat([GRADES[RULE[o.level].grade] + "护工" + RULE[o.level].mode, o.start, ap.length ? '<span class="tag tag-1">' + ap.join("、") + "</span>" : "—", '<a href="dispatch.html?order=' + o.id + '">智能派单</a>']);
      }), "暂无待派订单"));
      html += panel("待护工接单 / 即将到期", table(["订单编号", "患者", "科室床位", "护工", "结束日期", "状态", "操作"], waiting.concat(ending).map(function (o) {
        var c = carer(o.caregiver) || {};
        return [o.id, esc(o.patient.name), bedLabel(o), esc(c.name || "—"), iso(endDate(o)), o.accepted ? '<span class="tag tag-2">即将到期</span>' : tag(o), '<a href="schedule.html#swap">排班 / 换班</a>'];
      }), "暂无"));
      html += panel("常用功能", quick([["智能派单", "dispatch.html", "按匹配分推荐护工"], ["排班总览", "schedule.html", "未来 7 天护工排班"], ["临时换班", "schedule.html#swap", "护工请假时换人"], ["护工档案", "carers.html", "等级、证书与档期"]]));
    } else if (role === "station") {
      var ward = user.ward, mine = active.filter(function (o) { return o.dept === ward && o.accepted; });
      var entry = mine.filter(function (o) { return !o.entryConfirmed; });
      var wAlerts = alerts.filter(function (a) { var o = order(a.order); return o && o.dept === ward; }).sort(byLevel);
      var done = 0, due = 0;
      mine.forEach(function (o) { var lg = logFor(o); if (!lg) return; var p = progress(lg); done += p.done; due += p.due; });
      html += '<p class="role-note"><b>护士站</b>是医院病区的护士：护工进入病区前由护士站核对身份与床位（进科报备）；体温异常、漏打卡等预警实时推送到这里处理；也可以查看本科室患者的护理日志。</p>';
      html += kpis([["本科室在护患者", mine.length, DEPTS[ward]], ["待确认进科", entry.length, "核对护工证件与床位", "is-warn"], ["未处理预警", wAlerts.length, "其中紧急 " + wAlerts.filter(function (a) { return a.level === "urgent"; }).length + " 条，置顶显示", "is-alert"], ["今日护理完成率", due ? Math.round(done / due * 100) + "<small>%</small>" : "—", "已到时间的护理项目", "is-teal"]]);
      html += panel("进科报备", table(["订单编号", "患者", "床位", "护工", "护工等级", "派单时间", "操作"], entry.map(function (o) {
        var c = carer(o.caregiver);
        return [o.id, esc(o.patient.name), o.bed + "床", esc(c.name) + "（" + c.id + "）", GRADES[c.grade], o.dispatchedAt || o.start, '<button type="button" class="link-btn" data-entry="' + o.id + '">核对并确认进科</button>'];
      }), "暂无待进科护工"), "", "entry");
      html += panel("异常预警", table(["发生时间", "床位", "患者", "护工", "类型", "详情", "操作"], wAlerts.map(function (a) {
        var o = order(a.order), c = carer(o.caregiver) || {};
        return [a.time, o.bed + "床", esc(o.patient.name), esc(c.name || "—"), alertTag(a), esc(a.detail), '<button type="button" class="link-btn" data-alert="' + a.id + '">处理并反馈</button>'];
      }), "暂无未处理预警"), "", "alerts");
      html += panel("本科室在护患者", table(["床位", "患者", "护理等级", "护工", "上岗时间", "今日护理", "最近体征", "操作"], mine.sort(function (a, b) { return a.bed - b.bed; }).map(function (o) {
        var c = carer(o.caregiver), lg = logFor(o), p = lg ? progress(lg) : { done: 0, total: 0 }, v = lg && lg.vitals.length ? lg.vitals[lg.vitals.length - 1] : null;
        return [o.bed + "床", esc(o.patient.name), LEVELS[o.level], esc(c.name), lg && lg.clockIn ? lg.clockIn.slice(11) : "未上岗", p.done + " / " + p.total, latestVitals(o, lg), '<a href="logs.html?order=' + o.id + '">护理日志</a>'];
      }), "本科室暂无在护患者"));
    } else if (role === "ops") {
      var first = new Date(today().getFullYear(), today().getMonth(), 1), F = iso(first);
      var monthOrders = db.orders.filter(function (o) { return o.created >= F && o.status !== 9; });
      var income = db.orders.filter(function (o) { return o.status === 3 && o.paidAt >= F; }).reduce(function (s, o) { return s + bill(o).receivable; }, 0);
      var rated = db.orders.filter(function (o) { return o.rating && o.created >= iso(addDays(today(), -29)); });
      var sat = rated.length ? rated.filter(function (o) { return o.rating >= 4; }).length / rated.length * 100 : 0;
      var due = toPay.reduce(function (s, o) { return s + bill(o).payable; }, 0);
      var certSoon = db.caregivers.filter(function (c) { return dayDiff(today(), c.certExpire) <= 60; });
      var overtime = db.caregivers.filter(function (c) { return c.monthDays > 26; });
      html += kpis([["本月营业收入", (income / 10000).toFixed(2) + "<small>万元</small>", "已结清订单", "is-teal"], ["本月订单", monthOrders.length + "<small>单</small>", "不含已取消"], ["近 30 天满意度", sat.toFixed(1) + "<small>%</small>", "评分 4 星及以上", "is-teal"], ["应收未收", (due / 10000).toFixed(2) + "<small>万元</small>", toPay.length + " 单待家属支付", "is-warn"]]);
      html += '<div class="grid-2">' + panel("近 14 天每日新增订单", lineChart(dailyCounts(addDays(today(), -13), 14), 560, 220)) +
        panel("需要关注", '<ul class="watch">' +
          '<li><span>未处理异常预警</span><b class="' + (alerts.length ? "bad" : "") + '">' + alerts.length + ' 条</b><a href="logs.html">查看</a></li>' +
          '<li><span>待家属支付订单</span><b>' + toPay.length + ' 单</b><a href="orders.html?status=2">收款对账</a></li>' +
          '<li><span>待派订单</span><b>' + pending.length + ' 单</b><a href="orders.html?status=0">查看</a></li>' +
          '<li><span>60 天内证书到期护工</span><b class="' + (certSoon.length ? "warn" : "") + '">' + certSoon.length + ' 人</b><a href="carers.html?filter=cert">查看</a></li>' +
          '<li><span>本月服务超时护工（＞26 天）</span><b>' + overtime.length + ' 人</b><a href="carers.html">查看</a></li>' +
          '<li><span>待回访投诉</span><b>' + db.complaints.filter(function (c) { return c.status !== "已回访"; }).length + ' 条</b><a href="stats.html#quality">质量分析</a></li></ul>') + "</div>";
      html += panel("常用功能", quick([["运营统计", "stats.html", "订单、收入、满意度报表"], ["收款对账", "orders.html?status=2", "应收未收订单"], ["护理日志", "logs.html", "服务过程抽查"], ["护工档案", "carers.html", "人员与资质"]]));
    } else {
      var working = {}; active.forEach(function (o) { if (o.caregiver) working[o.caregiver] = 1; });
      html += kpis([["今日在护订单", active.length, "状态为“服务中”"], ["待派订单", pending.length, "需尽快派单（目标 15 分钟内）", "is-warn"], ["异常预警", alerts.length, "未处理", "is-alert"],
        ["在岗护工", Object.keys(working).length + "<small>/ " + db.caregivers.filter(function (c) { return c.status === "在岗"; }).length + "</small>", "有在护订单 / 在岗总数", "is-teal"]]);
      var rows = [];
      pending.forEach(function (o) { rows.push(oRow(o).concat(['<span class="tag tag-0">待派单</span>', '<a href="dispatch.html?order=' + o.id + '">智能派单</a>'])); });
      alerts.slice().sort(byLevel).forEach(function (a) { var o = order(a.order); if (o) rows.push(oRow(o).concat([alertTag(a), '<button type="button" class="link-btn" data-alert="' + a.id + '">处理</button>'])); });
      toPay.slice(0, 4).forEach(function (o) { rows.push(oRow(o).concat(['<span class="tag tag-2">待支付</span>', '<a href="bill.html?order=' + o.id + '">结算</a>'])); });
      html += panel("待办事项", table(["订单编号", "患者", "科室床位", "护理等级", "状态", "操作"], rows, "暂无待办事项"), "共 " + rows.length + " 项", "todo");
      html += panel("功能导航", quick([["预约受理", "booking.html", "客户服务子系统"], ["智能派单", "dispatch.html", "调度排班子系统"], ["护理日志", "logs.html", "服务监管子系统"], ["运营统计", "stats.html", "统计决策子系统"],
        ["护工档案", "carers.html", "护工管理子系统"], ["费用结算", "bill.html", "财务结算子系统"], ["用户权限", "users.html", "系统管理子系统"], ["护工端预览", "nurse.html", "护工移动端"]]));
      html += '<p class="notice"><b>系统公告</b><span>① 本月起骨科、神经内科陪护单价按价格政策执行；② 本周五 16:00 新入职护工院感培训考核；③ 演示数据保存在本机浏览器中，可在“系统管理 › 数据备份”中重置。</span></p>';
    }
    box.innerHTML = html;
    if (location.hash) { var t = $(location.hash); if (t) t.scrollIntoView(); }
    box.addEventListener("click", function (e) {
      var b = e.target.closest("[data-alert]");
      if (b) { handleAlert(db.alerts.filter(function (x) { return String(x.id) === b.getAttribute("data-alert"); })[0], user.name); return; }
      b = e.target.closest("[data-entry]");
      if (b) {
        var o = order(b.getAttribute("data-entry")), c = carer(o.caregiver);
        var d = modal("进科报备确认", "<dl><dt>护工</dt><dd>" + esc(c.name) + "（" + c.id + "，" + GRADES[c.grade] + "护工）</dd><dt>证书有效期</dt><dd>" + c.certExpire + "</dd><dt>派往床位</dt><dd>" + bedLabel(o) + "</dd><dt>患者</dt><dd>" + esc(o.patient.name) + "，" + LEVELS[o.level] + "</dd><dt>特殊需求</dt><dd>" + needText(o) + '</dd></dl><p class="hint">请核对护工工牌、健康证与床位后确认，确认后护工方可进入病区。</p>',
          [button("确认进科", "btn-primary", function () { o.entryConfirmed = true; o.entryAt = now(); save(db); d.close(); toast(c.name + " 已获准进入" + DEPTS[o.dept], "ok"); setTimeout(function () { location.reload(); }, 600); })]);
        return;
      }
      b = e.target.closest("[data-complaint]");
      if (b) {
        var cp = db.complaints.filter(function (x) { return String(x.id) === b.getAttribute("data-complaint"); })[0];
        var dd = modal("登记投诉回访", "<dl><dt>订单编号</dt><dd>" + cp.order + "</dd><dt>投诉内容</dt><dd>" + esc(cp.content) + '</dd><dt>回访结果</dt><dd><textarea id="cp-result" placeholder="例如：已电话致歉，护工已加强夜间巡视，家属表示满意"></textarea></dd></dl>',
          [button("保存回访记录", "btn-primary", function () { cp.status = "已回访"; cp.result = $("#cp-result").value || "已回访"; cp.doneAt = now(); save(db); dd.close(); toast("回访记录已保存", "ok"); setTimeout(function () { location.reload(); }, 600); })]);
      }
    });
  };

  /* 陪护预约登记：自动带出护工等级、服务方式与费用（判断表），校验后生成订单 */
  pages.booking = function (user) {
    var f = $("#booking-form");
    if (user.roleKey !== "admin") { $("[data-dispatch]").remove(); var sb = $("[data-submit]"); sb.classList.add("btn-primary"); sb.textContent = "提交订单（转排班部派单）"; }
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
    if (param("demo") === "1") {  // 演示：一键填入示例病人
      var set = function (n, v) { f.elements[n].value = v; };
      set("name", "王*华"); set("gender", "男"); set("age", "78"); set("inpatient", "ZY2610183"); set("dept", "03"); set("bed", "12"); set("contact", "王*（儿子）"); set("phone", "13912346215"); set("days", "10");
      set("note", "术后第 2 天，左股骨骨折，需协助翻身，家属白天不在院");
      $all("[name=level]", f).forEach(function (x) { x.checked = x.value === "0"; });
      $all("[name=needs]", f).forEach(function (x) { x.checked = ["turning", "tube", "night", "bp"].indexOf(x.value) >= 0; });
      update(); toast("已填入示例病人（王*华，骨科 12 床），核对后点“仅提交”");
    }
    $("[data-draft]").addEventListener("click", function () {
      var d = {}; ["name", "gender", "age", "inpatient", "dept", "bed", "contact", "phone", "start", "days", "slot", "carerGender", "note", "glucoseFreq", "sleepMode"].forEach(function (k) { d[k] = f.elements[k].value; });
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
        glucoseFreq: f.glucoseFreq.value, sleepMode: f.sleepMode.value,
        note: f.note.value.trim(), status: 0, caregiver: null, createdBy: user.name
      };
      db.orders.push(o); save(db); localStorage.removeItem(draftKey);
      var go = e.submitter && e.submitter.hasAttribute("data-dispatch");
      toast("订单 " + o.id + " 已生成，预估金额 " + money(estimate(lv, o.days, o.needs).total) + " 元" + (go ? "" : "，已推送排班部派单"), "ok");
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
      if (c.grade !== grade || c.status !== "在岗" || (o.rejected || []).indexOf(c.id) >= 0) return;
      if (o.carerGender && o.carerGender !== "不限" && c.gender !== o.carerGender) return;
      if (parse(c.certExpire) < e) { out.cert++; return; }
      if (busy[c.id] >= (grade === 3 ? 3 : 1)) { out.conflict++; return; }
      if (c.monthDays > 26) { out.overtime++; return; }
      var years = c.exp[o.dept] || 0;
      var expScore = years ? Math.min(100, 50 + years * 12) : 30;
      var score = c.star / 5 * 100 * 0.4 + c.good * 0.3 + expScore * 0.3;
      out.list.push({ applied: (o.applicants || []).indexOf(c.id) >= 0, c: c, score: Math.round(score * 10) / 10, expText: years ? DEPTS[o.dept] + " " + years + "年" : Object.keys(c.exp).map(function (d) { return DEPTS[d] + " " + c.exp[d] + "年"; }).join("、"), load: busy[c.id] || 0 });
    });
    out.list.sort(function (a, b) { return b.score - a.score; });
    return out;
  }
  pages.dispatch = function (user) {
    var list = $("#pending"), detail = $("#order-detail"), table = $("#cand tbody"), offset = 0, cur = null;
    function pending() { return db.orders.filter(function (o) { return o.status === 0; }).sort(function (a, b) { return (b.createdBy ? 1 : 0) - (a.createdBy ? 1 : 0) || (a.created < b.created ? 1 : -1); }); }
    function renderList() {
      var p = pending();
      $("#pending-count").textContent = p.length;
      list.innerHTML = p.map(function (o) {
        return '<li><button type="button" data-id="' + o.id + '" class="' + (cur && cur.id === o.id ? "is-current" : "") + '"><b>' + o.id + "</b><span>" + esc(o.patient.name) + " " + bedLabel(o) + "　" + LEVELS[o.level] + (o.manual ? "　（已转人工）" : "") + ((o.applicants || []).length ? "　护工申请 " + o.applicants.length : "") + "</span></button></li>";
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
      var r = candidates(cur), page = r.list.slice(offset, offset + 3), sel = 0;
      page.forEach(function (x, i) { if (!sel && x.applied) sel = i; });  // 有护工主动申请时默认选中申请人
      table.innerHTML = page.map(function (x, i) {
        return '<tr class="' + (i === sel ? "is-selected" : "") + '"><td><input type="radio" name="carer" value="' + x.c.id + '"' + (i === sel ? " checked" : "") + ' aria-label="选择 ' + esc(x.c.name) + '"></td><td>' + x.c.id + "</td><td>" + esc(x.c.name) + (x.applied ? ' <span class="tag tag-1">已申请</span>' : "") + "</td><td>" + GRADES[x.c.grade] + '</td><td class="stars">' + stars(x.c.star) +
          "</td><td>" + x.c.good.toFixed(1) + "%</td><td>" + esc(x.expText) + "</td><td>" + (x.load ? "在护 " + x.load + " 床" : "空闲") + "</td><td><b>" + x.score.toFixed(1) + "</b></td></tr>";
      }).join("") || '<tr><td colspan="9">没有符合条件的护工，请转人工派单。</td></tr>';
      $("#cand-note").innerHTML = "护理等级“" + LEVELS[cur.level] + "” → 需" + GRADES[RULE[cur.level].grade] + "护工；符合条件 <b>" + r.list.length + "</b> 人，第 " + (r.list.length ? offset + 1 : 0) + "～" + Math.min(offset + 3, r.list.length) + " 名；已剔除档期冲突 <b>" + r.conflict + "</b> 人、本月超时 <b>" + r.overtime + "</b> 人" + (r.cert ? "、证书将过期 <b>" + r.cert + "</b> 人" : "") + "。";
      $("[data-more]").disabled = r.list.length <= 3;
    }
    table.addEventListener("change", function () { $all("tr", table).forEach(function (tr) { tr.classList.toggle("is-selected", $("input", tr).checked); }); });
    list.addEventListener("click", function (e) { var b = e.target.closest("[data-id]"); if (b) select(order(b.getAttribute("data-id"))); });
    $("[data-more]").addEventListener("click", function () { var n = candidates(cur).list.length; offset = offset + 3 >= n ? 0 : offset + 3; renderCands(); });
    $("[data-profile]").addEventListener("click", function () { var id = (table.querySelector("input:checked") || {}).value; if (id) carerProfile(id); });
    $("[data-manual]").addEventListener("click", function () { if (!cur) return; cur.manual = true; save(db); renderList(); toast("已转人工派单，排班组将电话联系护工", "ok"); });
    $("[data-confirm]").addEventListener("click", function () {
      if (!cur) return;
      var id = (table.querySelector("input:checked") || {}).value;
      if (!id) { toast("没有可派的护工，请转人工派单", "err"); return; }
      var c = carer(id);
      cur.caregiver = id; cur.status = 1; cur.dispatchedAt = now(); cur.dispatchedBy = user.name; cur.accepted = false; cur.entryConfirmed = false; delete cur.manual;
      c.monthDays = Math.min(31, c.monthDays + 1);
      save(db);
      toast("派单成功：已推送护工 " + c.name + " 确认接单，并向" + DEPTS[cur.dept] + "护士站推送进科报备", "ok");
      var next = pending()[0]; select(next || null);
    });
    var want = param("order") && order(param("order"));
    select(want && want.status === 0 ? want : pending()[0] || null);
  };

  /* 护工工作台：今日护理打卡、派单确认与申请接单、我的排班、我的收益 */
  pages.nurse = function () {
    var user = account();
    if (!user) { location.replace("index.html?next=nurse.html"); return; }
    var role = roleOf(user);
    if (role !== "carer" && role !== "admin") { location.replace("home.html"); return; }
    var me = user.carer || param("carer") || db.caregivers[0].id, c = carer(me);
    if (role === "admin") {
      var pv = $("#preview"); pv.hidden = false;
      $("select", pv).innerHTML = db.caregivers.filter(function (x) { return x.status === "在岗"; }).map(function (x) { return '<option value="' + x.id + '">' + esc(x.name) + "（" + GRADES[x.grade] + " " + x.id + "）</option>"; }).join("");
      $("select", pv).value = me;
      $("select", pv).addEventListener("change", function () { location.href = "nurse.html?carer=" + this.value + location.hash; });
    }
    $("#me").innerHTML = '<span class="avatar">' + esc(c.name.slice(0, 1)) + "</span>" + esc(c.name) + " · " + GRADES[c.grade] + "护工";
    $("[data-logout]").addEventListener("click", logout);
    var slot = $("#role-switch-slot"); if (slot) { slot.innerHTML = roleSwitcherHtml(user.id); bindRoleSwitch(slot); }
    var coef = STAR_COEF[c.star] || 1;
    var timer = null;
    function myIncome(o, n) { return (n || o.days) * WAGE[c.grade] * coef; }

    /* ---- tabs ---- */
    function show() {
      var t = (location.hash || "#today").slice(1);
      if (["today", "logs", "orders", "schedule", "income"].indexOf(t) < 0) t = "today";
      $all("[data-tab]").forEach(function (x) { x.hidden = x.getAttribute("data-tab") !== t; });
      $all(".portal-tabs a").forEach(function (a) { var on = a.getAttribute("href") === "#" + t; a.classList.toggle("is-current", on); if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    }
    window.addEventListener("hashchange", show);

    /* ---- 今日护理 ---- */
    function renderToday() {
      var box = $("[data-tab=today]"), mine = db.orders.filter(function (o) { return o.caregiver === me && o.status === 1; });
      var waiting = mine.filter(function (o) { return !o.accepted; });
      var work = mine.filter(function (o) { return o.accepted && parse(o.start) <= today(); });
      var later = mine.filter(function (o) { return o.accepted && parse(o.start) > today(); });
      var html = waiting.length ? '<a class="banner" href="#orders">你有 <b>' + waiting.length + "</b> 条新派单待确认，点此去接单 ›</a>" : "";
      if (!work.length) {
        html += '<section class="panel empty-state"><h2>今天没有在护的病人</h2><p>' + (later.length ? "已接订单将于 " + later[0].start + " 开始（" + bedLabel(later[0]) + "）。" : "可以在“接单”里查看适合你的订单并申请接单。") + '</p><p><a class="btn btn-primary" href="#orders">去接单</a></p></section>';
        box.innerHTML = html; return;
      }
      var cur = work.filter(function (o) { return o.id === param("o"); })[0] || work[0], o = cur, lg = logFor(o);
      if (work.length > 1) html += '<div class="chips">' + work.map(function (x) { return '<a class="chip-btn' + (x === o ? " is-current" : "") + '" href="nurse.html?' + (role === "admin" ? "carer=" + me + "&" : "") + "o=" + x.id + '#today">' + bedLabel(x) + " " + esc(x.patient.name) + "</a>"; }).join("") + "</div>";
      var p = progress(lg), dayN = Math.max(1, dayDiff(o.start, today()) + 1);
      html += '<div class="portal-grid"><div>' +
        '<section class="panel patient"><h2 class="panel-title">我负责的病人</h2><div class="patient-head"><b>' + esc(o.patient.name) + "</b><span>" + bedLabel(o) + " · " + LEVELS[o.level] + " · " + (o.patient.age ? o.patient.age + "岁 · " : "") + o.patient.gender + "</span></div>" +
        "<dl><dt>服务期间</dt><dd>" + o.start + " 至 " + iso(endDate(o)) + "（第 " + dayN + " / " + o.days + " 天）</dd><dt>服务方式</dt><dd>" + RULE[o.level].mode + " " + esc(o.slot || "24小时") + "</dd><dt>特殊需求</dt><dd>" + needText(o) + "</dd><dt>备注</dt><dd>" + esc(o.note || "—") +
        "</dd><dt>家属</dt><dd>" + esc(o.patient.contact || "—") + " " + esc(o.patient.phone || "") + "</dd>" + (lg.family && lg.family.msg ? "<dt>家属留言</dt><dd>“" + esc(lg.family.msg) + "”</dd>" : "") + "<dt>进科报备</dt><dd>" + (o.entryConfirmed ? '<span class="tag tag-3">护士站已确认</span>' : '<span class="tag tag-0">待护士站确认</span>') + "</dd></dl></section>" +
        '<section class="panel"><div class="clock-in"><p id="clock-state"></p><button class="btn btn-primary btn-sm" type="button" data-clockin>扫码上岗</button></div></section>' +
        '<section class="panel"><h2 class="panel-title">护理项目打卡 <span class="aside" id="progress"></span></h2><div id="tasks"></div></section></div><div>' +
        '<form class="panel" id="vitals" novalidate><h2 class="panel-title">体征与情况记录</h2>' +
        '<div class="field"><label for="temp">体温℃</label><input id="temp" name="temp" type="number" step="0.1" inputmode="decimal" placeholder="35～42（测血压时可不填）"></div><p class="err" id="temp-err"></p>' +
        '<div class="field"><label for="pulse">脉搏</label><input id="pulse" name="pulse" type="number" inputmode="numeric" placeholder="次/分"></div>' +
        '<div class="field" style="margin-top:.6rem"><label for="sbp">血压</label><div class="bp-pair"><input id="sbp" name="sbp" type="number" inputmode="numeric" placeholder="收缩压" aria-label="收缩压"><span>/</span><input id="dbp" name="dbp" type="number" inputmode="numeric" placeholder="舒张压" aria-label="舒张压"><em>mmHg</em></div></div>' +
        (o.needs.indexOf("glucose") >= 0 ? '<div class="field" style="margin-top:.6rem"><label for="glu">血糖</label><div class="glu-row"><input id="glu" name="glu" type="number" step="0.1" inputmode="decimal" placeholder="mmol/L"><select name="gluCtx" aria-label="测量时间点"><option>空腹</option><option>早餐后 2 小时</option><option>午餐后 2 小时</option><option>晚餐后 2 小时</option><option>睡前</option><option>随机</option><option>复测</option></select><select name="gluBy" aria-label="测量人"><option>护士</option><option>护工</option></select></div></div><p class="hint" style="margin:.3rem 0 0 5.1em">医院病人由护士测量，护工录入结果</p>' : "") +
        '<button class="btn" type="submit" style="margin-top:.8rem;width:100%">记录体征</button><ul class="hint" id="vitals-log"></ul></form>' +
        (o.needs.indexOf("sleep") >= 0 ? '<section class="panel" id="sleep-card"></section>' : "") +
        '<div class="duo today-actions"><button class="btn btn-primary" type="button" data-submit-log>提交护理日志</button><button class="btn btn-danger" type="button" data-report>异常上报</button></div>' +
        '<p class="hint" style="margin:.7rem 0 0;text-align:center"><a href="family.html?order=' + o.id + '&demo=1" target="_blank" rel="noopener">家属端日报预览 ↗</a></p>' +
        "</div></div>";
      box.innerHTML = html;

      function render() {
        var nm = nowMinutes(), pr = progress(lg);
        $("#clock-state").innerHTML = lg.clockIn ? "已上岗 <strong>" + lg.clockIn.slice(11) + "</strong>（床头码 " + bedCode(o.dept, o.bed) + " 核验通过）" : o.entryConfirmed ? "尚未打卡上岗，请到床旁扫描床头码" : "待护士站确认进科后方可上岗";
        var btn = $("[data-clockin]"); btn.hidden = !!lg.clockIn; btn.disabled = !o.entryConfirmed;
        $("#tasks").innerHTML = lg.items.map(function (it, i) {
          var late = !it.doneAt && !it.skipped && nm - minutes(it.time) > 120, due = !it.doneAt && nm >= minutes(it.time);
          return '<div class="task ' + (it.doneAt || it.skipped ? "is-done" : late ? "is-late" : "") + '"><input type="checkbox" id="t' + i + '" data-i="' + i + '"' + (it.doneAt ? " checked disabled" : "") + (lg.clockIn && !it.skipped ? "" : " disabled") + '><label for="t' + i + '"><time>' + it.time + "</time>　" + esc(it.name) + "</label>" +
            '<span class="pill ' + (it.doneAt ? "pill-done" : late ? "pill-late" : "pill-todo") + '">' + (it.doneAt ? "已完成 " + it.doneAt : it.skipped ? "上岗前" : late ? "漏打卡" : due ? "待执行" : "未到时间") + "</span></div>";
        }).join("");
        $("#progress").textContent = "已完成 " + pr.done + " / " + pr.total;
        lg.items.forEach(function (it) {
          if (lg.clockIn && !lg.auto && !it.doneAt && !it.skipped && !it.alerted && nm - minutes(it.time) > 120) { it.alerted = true; raise("漏打卡", "“" + it.name + "”（" + it.time + "）超过 2 小时未打卡"); }
        });
        $("#vitals-log").innerHTML = lg.vitals.map(function (v) { return "<li>" + vitalText(o, v) + "</li>"; }).join("");
        renderSleep();
        if (typeof renderLogs === "function") renderLogs();
        save(db);
      }
      /* 昨晚睡眠：监测带数据自动显示；护工观察方式在早上填写小结，夜里可随时记录情况 */
      function renderSleep() {
        var card = $("#sleep-card"); if (!card) return;
        var mode = o.sleepMode || "device", sl = lg.sleep, html2 = '<h2 class="panel-title">昨晚睡眠 <span class="aside">' + SLEEP_MODE[mode] + "</span></h2>";
        if (sl) {
          var toilet = sl.mode === "device" ? sl.leave.length : sl.toilet, al = sleepAlerts(sl);
          html2 += '<div class="sleep-grid"><div><span>入睡</span><b>' + sl.bed + "</b></div><div><span>醒来</span><b>" + sl.wake + "</b></div><div><span>睡眠时长</span><b>" + (sl.total / 60).toFixed(1) + "<small>小时</small></b></div><div><span>夜醒</span><b>" + sl.wakes + "<small>次</small></b></div><div><span>起夜</span><b>" + toilet + "<small>次</small></b></div>" +
            (sl.mode === "device" ? "<div><span>平均心率</span><b>" + sl.hr + "</b></div><div><span>呼吸暂停</span><b>" + sl.apnea + "<small>次</small></b></div>" : "") + "<div><span>质量</span><b>" + sl.quality + "</b></div></div>" +
            al.map(function (a) { return '<span class="pill ' + (a[2] === "urgent" ? "pill-late" : "pill-todo") + '">' + a[0] + "</span> "; }).join("") +
            '<p class="hint">' + (sl.mode === "device" ? "数据由床垫下的睡眠监测带自动采集，夜间无需打扰病人；离床过久、呼吸暂停过多会自动预警。" : "护工观察记录。") + "</p>";
        } else if (mode === "observe") {
          html2 += '<form id="sleep-form" class="sleep-form" novalidate><div class="field"><label for="sl-bed">入睡</label><input id="sl-bed" name="bed" type="time" value="22:00"></div><div class="field"><label for="sl-wake">醒来</label><input id="sl-wake" name="wake" type="time" value="06:00"></div>' +
            '<div class="field"><label for="sl-wakes">夜醒</label><input id="sl-wakes" name="wakes" type="number" min="0" max="20" value="1"></div><div class="field"><label for="sl-toilet">起夜</label><input id="sl-toilet" name="toilet" type="number" min="0" max="20" value="1"></div>' +
            '<div class="field"><label for="sl-q">质量</label><select id="sl-q" name="quality"><option>好</option><option selected>一般</option><option>差</option></select></div><button class="btn btn-sm" type="submit">保存睡眠记录</button></form>';
        } else html2 += '<p class="hint">监测带数据将在明早生成。</p>';
        if (mode === "observe") {
          var ev = lg.nightEvents || [];
          html2 += '<p class="hint" style="margin-top:.8rem">夜间情况随时记录（不需要定时起身巡视）：</p><div class="order-actions">' + ["起夜", "醒来", "躁动不安", "呼吸异常"].map(function (t) { return '<button class="btn btn-sm' + (t === "躁动不安" || t === "呼吸异常" ? " btn-danger" : "") + '" type="button" data-night="' + t + '">' + t + "</button>"; }).join("") + "</div>" +
            (ev.length ? '<p class="hint">今晚已记录：' + ev.map(function (e) { return e.at + " " + e.type; }).join("；") + "</p>" : "");
        }
        card.innerHTML = html2;
      }
      $("[data-tab=today]").onsubmit = function (e) {  // 用属性赋值，重新渲染时不会重复绑定
        if (e.target.id !== "sleep-form") return;
        e.preventDefault();
        var f = e.target, bm = minutes(f.bed.value || "22:00"), wm = minutes(f.wake.value || "06:00"), wakes = Number(f.wakes.value) || 0, toilet = Number(f.toilet.value) || 0;
        var total = (bm > wm ? 24 * 60 - bm + wm : wm - bm) - wakes * 10 - toilet * 5;
        lg.sleep = { mode: "observe", bed: f.bed.value, wake: f.wake.value, total: Math.max(0, total), wakes: wakes, toilet: toilet, quality: f.quality.value, events: (db.logs[o.id + "@" + iso(addDays(today(), -1))] || {}).nightEvents || [] };
        var it = lg.items.filter(function (x) { return !x.doneAt && x.name.indexOf("睡眠") >= 0; })[0]; if (it && lg.clockIn) it.doneAt = now().slice(11);
        var al = sleepAlerts(lg.sleep).filter(function (a) { return a[2] !== "urgent"; });  // 躁动等紧急情况已在夜间即时上报
        al.forEach(function (a) { raise(a[0], a[1], a[2]); });
        if (!al.length) toast("睡眠记录已保存", "ok");
        render();
      };
      $("[data-tab=today]").onclick = function (e) {
        var b = e.target.closest("[data-night]"); if (!b) return;
        var t = b.getAttribute("data-night"), ev = { at: now().slice(11), type: t };
        (lg.nightEvents = lg.nightEvents || []).push(ev);
        if (t === "躁动不安" || t === "呼吸异常") raise(t, "夜间 " + ev.at + " " + t + (t === "躁动不安" ? "（警惕谵妄）" : ""), "urgent"); else toast("已记录：" + t, "ok");
        render();
      };
      function raise(type, detail, level) {
        db.alerts.push({ id: Date.now() + Math.random(), order: o.id, type: type, detail: detail, level: level || "watch", time: now(), handled: false });
        save(db); toast("已向" + DEPTS[o.dept] + "护士站推送" + (level === "urgent" ? "紧急" : "") + "预警：" + type, "err");
      }
      $("[data-clockin]").addEventListener("click", function () {
        var input = document.createElement("input"); input.type = "text"; input.placeholder = "例如 03-08"; input.id = "bedcode"; input.autocomplete = "off";
        var stop = function () {};
        function confirmIn() {
          var b = parseBed(input.value);
          if (!b || b.dept !== o.dept || b.bed !== o.bed) { $("#bed-err").textContent = "床头码" + (b ? " " + bedCode(b.dept, b.bed) + " " : "") + "与派单床位（" + bedLabel(o) + "，" + bedCode(o.dept, o.bed) + "）不符，请核对。"; return; }
          stop(); lg.clockIn = now(); var inMin = nowMinutes();
          lg.items.forEach(function (it) { if (minutes(it.time) < inMin - 30) it.skipped = true; });  // 上岗前的项目不计漏打卡
          d.close(); toast("床头码核验通过，上岗打卡成功", "ok"); render();
        }
        var buttons = [button("模拟扫码", "", function () { input.value = bedCode(o.dept, o.bed); }), button("确认上岗", "btn-primary", confirmIn)];
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) buttons.unshift(button("打开摄像头扫码", "", function () {
          stop = scanQR($("#scan-box"), function (text) { input.value = text.replace(/^KHT-BED:/, ""); confirmIn(); }, function (msg) { $("#bed-err").textContent = msg; });
        }));
        var d = modal("扫描床头码", '<p class="hint">点“打开摄像头扫码”对准床头二维码；没有二维码时可手动输入床头码（科室代码-床号）。</p><div id="scan-box" class="scan-box" hidden></div><div class="field"><label for="bedcode">床头码</label></div><p class="err" id="bed-err"></p>', buttons);
        d.addEventListener("close", function () { stop(); });
        $(".field", d).appendChild(input);
        input.addEventListener("keydown", function (e) { if (e.key === "Enter") confirmIn(); });
      });
      $("#tasks").addEventListener("change", function (e) {
        var i = e.target.getAttribute("data-i"); if (i === null) return;
        lg.items[i].doneAt = now().slice(11); render(); toast("已打卡：" + lg.items[i].name, "ok");
      });
      $("#vitals").addEventListener("submit", function (e) {
        e.preventDefault();
        var f = this, err = $("#temp-err"), glu = f.glu && f.glu.value ? Number(f.glu.value) : null, t = f.temp.value ? Number(f.temp.value) : null, sb = f.sbp.value ? Number(f.sbp.value) : null, db_ = f.dbp.value ? Number(f.dbp.value) : null, msg = "";
        $all("input", f).forEach(function (x) { x.classList.remove("is-invalid"); });
        if (t === null && sb === null && db_ === null && glu === null) msg = "请至少填写体温、血压或血糖中的一项。";
        else if (glu !== null && !(glu >= 1.1 && glu <= 33.3)) { msg = "血糖应在 1.1～33.3 mmol/L 之间，请复测。"; f.glu.classList.add("is-invalid"); }
        else if (t !== null && !(t >= 35 && t <= 42)) { msg = "体温应在 35～42℃ 之间，请复测。"; f.temp.classList.add("is-invalid"); }
        else if ((sb === null) !== (db_ === null)) { msg = "请同时填写收缩压和舒张压。"; (sb === null ? f.sbp : f.dbp).classList.add("is-invalid"); }
        else if (sb !== null && (!(sb >= 60 && sb <= 260) || !(db_ >= 30 && db_ <= 160) || sb <= db_)) { msg = "血压数值不合理（收缩压 60～260、舒张压 30～160，且收缩压应高于舒张压），请复测。"; f.sbp.classList.add("is-invalid"); f.dbp.classList.add("is-invalid"); }
        else if (f.pulse.value && !(Number(f.pulse.value) >= 30 && Number(f.pulse.value) <= 200)) { msg = "脉搏应在 30～200 次/分之间，请复测。"; f.pulse.classList.add("is-invalid"); }
        err.textContent = msg; if (msg) return;
        var v = { at: now(), temp: t, pulse: f.pulse.value, bp: sb !== null ? sb + "/" + db_ : "" };
        if (glu !== null) { v.glu = glu; v.gluCtx = f.gluCtx.value; v.gluBy = f.gluBy.value; }
        lg.vitals.push(v);
        // 记录体征后，自动勾选到点的“体征测量”或“血压测量”项目
        function tick(word) {  // 勾选离现在最近、已到时间的同类测量项目
          var due = lg.items.filter(function (x) { return !x.doneAt && !x.skipped && x.name.indexOf(word) >= 0 && minutes(x.time) <= nowMinutes() + 30; });
          if (due.length && lg.clockIn) due[due.length - 1].doneAt = now().slice(11);
          return due.length > 0;
        }
        if (t !== null) tick("体征");
        if (sb !== null && !tick("血压") && t === null) tick("体征");
        if (glu !== null) { if (!tick("复测")) tick("血糖"); }
        var al = vitalAlerts(o, v);
        al.forEach(function (a) { raise(a[0], a[1], a[2]); });
        if (v.glu && v.glu < 3.9) {  // 低血糖：自动安排 15 分钟后复测
          var d15 = new Date(Date.now() + 15 * 60000), rt = pad(d15.getHours()) + ":" + pad(d15.getMinutes());
          lg.items.push({ time: rt, name: "低血糖复测（15 分钟后）", doneAt: null });
          lg.items.sort(function (a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : 0; });
        }
        if (!al.length) toast("体征已记录", "ok");
        f.reset(); render();
      });
      $("[data-report]").addEventListener("click", function () {
        var d = modal("异常上报", '<div class="field"><label for="ab-type">类型</label><select id="ab-type"><option>病情变化</option><option>跌倒/坠床</option><option>管路异常</option><option>家属纠纷</option><option>其他</option></select></div><div class="field" style="margin-top:.6rem"><label for="ab-text">情况说明</label><textarea id="ab-text"></textarea></div>',
          [button("提交上报", "btn-danger", function () { raise("护工上报", $("#ab-type").value + "：" + ($("#ab-text").value || "（未填写说明）"), "urgent"); d.close(); })]);
      });
      $("[data-submit-log]").addEventListener("click", function () {
        var pr = progress(lg); lg.submittedAt = now(); save(db); render();
        toast("护理日志已提交（完成 " + pr.done + "/" + pr.total + " 项），系统已生成护理日报推送家属", "ok"); renderLogs();
      });
      render();
      clearInterval(timer); timer = setInterval(render, 60000);
    }

    /* ---- 护理日志：护工自己打卡形成的每日记录 ---- */
    function renderLogs() {
      var box = $("[data-tab=logs]"), T = today();
      var mine = db.orders.filter(function (o) { return o.caregiver === me && (o.status === 1 && o.accepted || o.status === 2 || o.status === 3) && parse(o.start) <= T; })
        .sort(function (a, b) { return a.start < b.start ? 1 : -1; }).slice(0, 3);
      var html = "";
      mine.forEach(function (o) {
        var days = [];
        for (var d = parse(o.start); d <= T && d <= endDate(o); d = addDays(d, 1)) days.unshift(d);
        var cards = days.map(function (d) {
          var key = o.id + "@" + iso(d), lg = iso(d) === iso(T) ? logFor(o) : db.logs[key];
          if (!lg) return "";
          var p = progress(lg), isToday = iso(d) === iso(T), done = lg.items.filter(function (x) { return x.doneAt; }).length;
          var sleepLine = lg.sleep ? '<p class="hint">😴 ' + sleepText(lg.sleep) + "</p>" : "";
          return '<details class="log-day"' + (isToday ? " open" : "") + "><summary><b>" + iso(d) + (isToday ? "（今天）" : "") + "</b><span>上岗 " + (lg.clockIn ? lg.clockIn.slice(11) : "—") + "　完成 " + done + " / " + lg.items.filter(function (x) { return !x.skipped; }).length + " 项　体征 " + lg.vitals.length + " 次</span>" +
            (lg.submittedAt ? '<span class="tag tag-3">已提交 · 日报已推送 ' + lg.submittedAt.slice(11) + "</span>" : isToday ? '<span class="tag tag-0">今日进行中</span>' : '<span class="tag tag-2">未提交日志</span>') + '</summary><ul class="timeline">' +
            lg.items.map(function (it) { return '<li class="' + (it.doneAt ? "is-done" : "") + '"><time>' + it.time + "</time><span>" + esc(it.name) + "</span><em>" + (it.doneAt ? "已完成 " + it.doneAt : it.skipped ? "上岗前" : isToday ? (minutes(it.time) <= nowMinutes() ? "待执行" : "未到时间") : "未打卡") + "</em></li>"; }).join("") + "</ul>" +
            sleepLine + '<p class="hint">' + (isToday ? "截至现在应完成 " + p.due + " 项，已完成 " + done + " 项" + (p.late ? "，漏打卡 " + p.late + " 项" : "") + "。" : "") + "</p>" +
            (lg.vitals.length ? '<p class="hint">体征：</p><ul class="hint">' + lg.vitals.map(function (v) { return "<li>" + vitalText(o, v) + "</li>"; }).join("") + "</ul>" : "") + "</details>";
        }).join("");
        if (cards) html += panel(esc(o.patient.name) + " · " + bedLabel(o), cards, o.start + " 至 " + iso(endDate(o)));
      });
      box.innerHTML = '<p class="role-note">护理日志按日期汇总你在“今日护理”中的打卡与体征记录，可查看今天和以往每一天的护理情况；护士站、客服可在管理端查看；提交日志后，系统汇总成护理日报推送给家属。</p>' + (html || '<section class="panel empty-state"><h2>暂无护理日志</h2><p>接单并在“今日护理”中上岗打卡后，这里会按天生成护理日志。</p></section>');
    }

    /* ---- 接单：派单确认 + 适合我的订单 ---- */
    function renderOrders() {
      var box = $("[data-tab=orders]");
      var waiting = db.orders.filter(function (o) { return o.caregiver === me && o.status === 1 && !o.accepted; });
      var fit = db.orders.filter(function (o) { return o.status === 0; }).map(function (o) {
        var r = candidates(o), rank = -1;
        r.list.forEach(function (x, i) { if (x.c.id === me) rank = i; });
        return rank < 0 ? null : { o: o, x: r.list[rank], rank: rank + 1, n: r.list.length };
      }).filter(Boolean);
      $("#badge").textContent = waiting.length || ""; $("#badge").hidden = !waiting.length;
      function card(o, extra, actions) {
        return '<article class="order-card"><header><b>' + bedLabel(o) + " · " + esc(o.patient.name) + "</b>" + extra + "</header><dl><dt>护理等级</dt><dd>" + LEVELS[o.level] + "（" + RULE[o.level].mode + "）</dd><dt>服务时间</dt><dd>" + o.start + " 起 " + o.days + " 天</dd><dt>特殊需求</dt><dd>" + needText(o) +
          "</dd><dt>预计收入</dt><dd><b>" + money(myIncome(o)) + "</b> 元（日薪 " + WAGE[c.grade] + " × " + o.days + " 天 × 星级系数 " + coef.toFixed(1) + "）</dd></dl><div class=\"order-actions\">" + actions + "</div></article>";
      }
      box.innerHTML =
        '<section class="panel"><h2 class="panel-title">派单通知 <span class="aside">排班部派给你的订单，请确认是否接单</span></h2>' +
        (waiting.length ? '<div class="cards">' + waiting.map(function (o) { return card(o, '<span class="tag tag-0">待确认</span>', '<button class="btn btn-primary btn-sm" type="button" data-accept="' + o.id + '">接单</button><button class="btn btn-sm" type="button" data-reject="' + o.id + '">拒单</button>'); }).join("") + "</div>" : '<p class="hint">暂无新的派单。</p>') + "</section>" +
        '<section class="panel"><h2 class="panel-title">适合我的订单 <span class="aside">按判断表与档期筛选，排名为智能派单中的综合匹配排名</span></h2>' +
        (fit.length ? '<div class="cards">' + fit.map(function (f) {
          var applied = (f.o.applicants || []).indexOf(me) >= 0;
          return card(f.o, '<span class="tag tag-1">匹配分 ' + f.x.score.toFixed(1) + " · 第 " + f.rank + " / " + f.n + " 名</span>", applied ? '<span class="tag tag-3">已申请，等待排班部确认</span>' : '<button class="btn btn-primary btn-sm" type="button" data-apply="' + f.o.id + '">申请接单</button>');
        }).join("") + "</div>" : '<p class="hint">当前没有与你的等级和档期匹配的待派订单。</p>') + "</section>";
    }
    $("[data-tab=orders]").addEventListener("click", function (e) {
      var b = e.target.closest("[data-accept],[data-reject],[data-apply]"); if (!b) return;
      var o = order(b.getAttribute("data-accept") || b.getAttribute("data-reject") || b.getAttribute("data-apply"));
      if (b.hasAttribute("data-accept")) { o.accepted = true; o.acceptedAt = now(); save(db); toast("已接单，请按时到" + DEPTS[o.dept] + "护士站报到", "ok"); }
      else if (b.hasAttribute("data-apply")) { (o.applicants = o.applicants || []).push(me); save(db); toast("已提交接单申请，排班部派单时会优先看到", "ok"); }
      else {
        var d = modal("拒单原因", '<div class="field"><label for="rj">原因</label><select id="rj"><option>时间冲突</option><option>身体不适</option><option>距离较远</option><option>其他</option></select></div>',
          [button("确认拒单", "btn-danger", function () { (o.rejected = o.rejected || []).push(me); o.rejectReason = $("#rj").value; o.status = 0; o.caregiver = null; o.accepted = false; save(db); d.close(); toast("已拒单，订单退回排班部重新派单"); renderAll(); })]);
        return;
      }
      renderAll();
    });

    /* ---- 我的排班 ---- */
    function renderSchedule() {
      var box = $("[data-tab=schedule]"), mine = db.orders.filter(function (o) { return o.caregiver === me && o.status === 1; }), T = today();
      var html = '<section class="panel"><h2 class="panel-title">未来 7 天</h2><div class="week">';
      for (var i = 0; i < 7; i++) {
        var d = addDays(T, i), on = mine.filter(function (o) { return parse(o.start) <= d && endDate(o) >= d; });
        html += '<div class="day' + (i === 0 ? " is-today" : "") + (on.length ? " is-busy" : "") + '"><b>' + md(d) + "</b><span>周" + "日一二三四五六"[d.getDay()] + "</span>" + (on.length ? on.map(function (o) { return "<em>" + DEPTS[o.dept] + o.bed + "床</em>"; }).join("") : "<em class=\"free\">空闲</em>") + "</div>";
      }
      html += "</div></section>";
      html += '<section class="panel"><h2 class="panel-title">我的订单</h2>' + table(["床位", "患者", "护理等级", "服务期间", "状态"], mine.map(function (o) {
        return [bedLabel(o), esc(o.patient.name), LEVELS[o.level], o.start + " 至 " + iso(endDate(o)), o.accepted ? (parse(o.start) > T ? '<span class="tag tag-1">待开始</span>' : '<span class="tag tag-1">服务中</span>') : '<span class="tag tag-0">待确认</span>'];
      }), "暂无排班") + "</section>";
      box.innerHTML = html;
    }

    /* ---- 我的收益（护工薪酬：服务天数 × 日薪 × 星级系数） ---- */
    function renderIncome() {
      var box = $("[data-tab=income]"), T = today(), F = iso(new Date(T.getFullYear(), T.getMonth(), 1));
      var rows = db.orders.filter(function (o) { return o.caregiver === me && (o.status === 1 && o.accepted || o.status === 2 || o.status === 3); }).sort(function (a, b) { return a.start < b.start ? 1 : -1; });
      var month = 0, monthDays = 0, total = 0;
      var trs = rows.map(function (o) {
        var n = o.status === 1 ? Math.max(0, Math.min(o.days, dayDiff(o.start, T) + 1)) : o.days, amt = myIncome(o, n), end = o.status === 1 ? iso(T) : iso(endDate(o));
        if (end >= F) { month += amt; monthDays += n; }
        if (o.status === 3) total += amt;
        var st = o.status === 1 ? '<span class="tag tag-1">服务中（累计）</span>' : o.status === 2 ? '<span class="tag tag-2">待家属结算</span>' : end >= F ? '<span class="tag tag-0">待发放（月底）</span>' : '<span class="tag tag-3">已发放</span>';
        return [o.id, bedLabel(o), o.start + " 至 " + iso(endDate(o)), { n: n }, { n: money(WAGE[c.grade]) }, { n: coef.toFixed(1) }, { n: money(amt) }, st];
      });
      box.innerHTML = kpis([["本月服务天数", monthDays + "<small>天</small>"], ["本月预计收入", money(month) + "<small>元</small>", "月底统一发放", "is-teal"], ["星级 / 系数", stars(c.star).replace(/☆/g, "") + "<small> × " + coef.toFixed(1) + "</small>", "好评率 " + c.good.toFixed(1) + "%"], ["累计已结算", money(total) + "<small>元</small>", rows.filter(function (o) { return o.status === 3; }).length + " 单"]]) +
        panel("收益明细", table(["订单编号", "床位", "服务期间", "#天数", "#日薪（元）", "#星级系数", "#金额（元）", "状态"], trs, "暂无收益记录"), "日薪：高级 180 · 中级 140 · 初级 90 元/天");
    }

    function renderAll() { renderToday(); renderLogs(); renderOrders(); renderSchedule(); renderIncome(); show(); }
    renderAll();
  };

  /* 订单信息查询：多条件筛选、分页、合计、导出 Excel */
  pages.orders = function (user) {
    var role = user.roleKey;
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
      if (o.status === 0) return role === "sched" || role === "admin" ? '<a href="dispatch.html?order=' + o.id + '">派单</a>' : '<span class="hint">排班部派单中</span>';
      if (o.status === 9) return "—";
      if (role === "sched") return o.status === 1 ? '<a href="schedule.html#swap">换班</a>' : "—";
      return '<a href="bill.html?order=' + o.id + '">' + (o.status === 1 ? "结算预览" : o.status === 2 ? "结算单" : "结算单") + "</a>";
    }
    function render() {
      var pages = Math.max(1, Math.ceil(rows.length / size)), slice = rows.slice(page * size, page * size + size);
      tbody.innerHTML = slice.map(function (o) {
        var c = carer(o.caregiver);
        return "<tr" + (o.status === 9 ? ' class="is-muted"' : "") + "><td>" + o.id + "</td><td>" + esc(o.patient.name) + "</td><td>" + bedLabel(o) + "</td><td>" + LEVELS[o.level] + "</td><td>" + (c ? esc(c.name) : "—") + "</td><td>" + o.start + '</td><td class="num">' + o.days +
          '</td><td class="num">' + money(orderAmount(o)) + "</td><td>" + tag(o) + "</td><td>" + action(o) + "</td></tr>";
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
      $("#chart-trend").innerHTML = lineChart(dailyCounts(r[0], Math.max(1, dayDiff(r[0], r[1]) + 1)), 1100, 200);

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
      (b.refund ? '<tr class="pay refund"><td colspan="4" style="text-align:right">应退押金</td><td class="num">' + money(b.refund) + "</td></tr>" : '<tr class="pay"><td colspan="4" style="text-align:right">本次应付</td><td class="num">' + money(b.payable) + "</td></tr>");
    $("#bill-rule").textContent = "计费规则：应收金额 = " + b.days + " 天 × " + money(b.rate) + " 元 × " + (b.k === 1 ? "1.00" : b.k.toFixed(2)) + "（" + discountLabel(b.k) + "）" + (b.extras.length ? " + 附加服务费 " + money(b.extras.reduce(function (s, e) { return s + e.amount; }, 0)) + " 元" : "") + "；本次应付 = 应收金额 − 押金 " + money(b.deposit) + " 元" + (b.refund ? "，不足部分退还家属" : "") + "。";
    $("#bill-pay").textContent = o.status === 3 ? "支付方式：" + PAY_TYPES[o.payType || 1] + "　支付时间：" + (o.paidAt || "") : o.status === 2 ? "支付状态：待支付（结算单已推送家属，24 小时未支付将自动提醒）" : "支付状态：服务中，离岗结算后生成正式结算单";
    $("#bill-stamp").innerHTML = o.status === 3 ? '<span class="stamp">已结清</span>' : o.status === 2 ? '<span class="stamp" style="color:#8a5a00;border-color:#d9a441">待支付</span>' : '<span class="stamp" style="color:#1673b8;border-color:#7fb8e6">预览</span>';
    $("#bill-family").textContent = "家属确认：" + (o.status === 3 ? o.patient.contact + "（电子确认）" : "________");
    $("#bill-operator").textContent = "经办：" + user.dept + " " + user.name;
    var settle = $("[data-settle]"), paid = $("[data-paid]"), canAct = user.roleKey !== "ops";
    settle.hidden = !canAct || o.status !== 1; paid.hidden = !canAct || o.status !== 2; $("#pay-type").hidden = !canAct || o.status !== 2;
    if (!canAct) $("[data-push]").hidden = true;
    settle.addEventListener("click", function () { o.days = b.days; o.status = 2; o.settledAt = now(); save(db); toast("已离岗结算，结算单已推送家属", "ok"); setTimeout(function () { location.reload(); }, 700); });
    paid.addEventListener("click", function () { o.status = 3; o.payType = Number($("#pay-type").value); o.paidAt = iso(today()); save(db); toast("收款成功，已写入收款台账", "ok"); setTimeout(function () { location.reload(); }, 700); });
    $("[data-push]").addEventListener("click", function () { toast("结算单已推送至家属手机（" + o.patient.phone + "）", "ok"); });
    $("[data-print]").addEventListener("click", function () { window.print(); });
  };

  /* 护理日志：按订单查看今日打卡进度、体征与预警（护士站只看本科室） */
  pages.logs = function (user) {
    var f = $("#log-filters"), ward = user.ward;
    f.dept.innerHTML = (ward ? "" : '<option value="">全部科室</option>') + Object.keys(DEPTS).filter(function (k) { return !ward || k === ward; }).map(function (k) { return '<option value="' + k + '">' + k + " " + DEPTS[k] + "</option>"; }).join("");
    function rows() {
      return db.orders.filter(function (o) { return logFor(o) && (!f.dept.value || o.dept === f.dept.value); }).sort(function (a, b) { return a.dept === b.dept ? a.bed - b.bed : a.dept < b.dept ? -1 : 1; });
    }
    function render() {
      var list = rows().filter(function (o) {
        var lg = logFor(o), p = progress(lg), al = db.alerts.some(function (a) { return a.order === o.id && !a.handled; });
        return f.view.value === "alert" ? al : f.view.value === "late" ? p.late > 0 || p.done < p.due - 1 : true;
      });
      $("#log-count").textContent = "共 " + list.length + " 位在护患者";
      $("#logs tbody").innerHTML = list.map(function (o) {
        var lg = logFor(o), p = progress(lg), c = carer(o.caregiver), v = lg.vitals[lg.vitals.length - 1];
        var al = db.alerts.filter(function (a) { return a.order === o.id && !a.handled; });
        var last = lg.items.filter(function (x) { return x.doneAt; }).slice(-1)[0];
        var pct = p.due ? Math.round(p.done / p.due * 100) : 100;
        return "<tr><td>" + bedLabel(o) + "</td><td>" + esc(o.patient.name) + "</td><td>" + LEVELS[o.level] + "</td><td>" + esc(c.name) + "</td><td>" + (lg.clockIn ? lg.clockIn.slice(11) : '<span class="tag tag-0">未上岗</span>') +
          '</td><td><div class="bar"><i style="width:' + pct + '%"></i></div>' + p.done + " / " + p.due + "（全天 " + p.total + "）</td><td>" + (last ? last.doneAt + " " + esc(last.name) : "—") + "</td><td>" + latestVitals(o, lg) +
          "</td><td>" + (al.length ? alertTag(al.slice().sort(byLevel)[0]) : '<span class="tag tag-3">正常</span>') + '</td><td><button type="button" class="link-btn" data-log="' + o.id + '">查看日志</button></td></tr>';
      }).join("") || '<tr><td colspan="10" class="hint">没有符合条件的记录</td></tr>';
    }
    function show(id) {
      var o = order(id), lg = logFor(o), c = carer(o.caregiver), nm = nowMinutes();
      modal("护理日志 · " + o.patient.name + "（" + bedLabel(o) + "）",
        '<p class="hint">护工 ' + esc(c.name) + "（" + c.id + "）　上岗 " + (lg.clockIn ? lg.clockIn.slice(11) : "—") + "　日期 " + iso(today()) + '</p><ul class="timeline">' + lg.items.map(function (it) {
          var late = lg.clockIn && !it.doneAt && !it.skipped && nm - minutes(it.time) > 120;
          return '<li class="' + (it.doneAt ? "is-done" : late ? "is-late" : "") + '"><time>' + it.time + "</time><span>" + esc(it.name) + "</span><em>" + (it.doneAt ? "已完成 " + it.doneAt : it.skipped ? "上岗前" : late ? "漏打卡" : !lg.clockIn ? "护工未上岗" : minutes(it.time) <= nm ? "待执行" : "未到时间") + "</em></li>";
        }).join("") + "</ul>" + (lg.sleep ? "<p><b>昨晚睡眠</b></p><p>" + sleepText(lg.sleep) + "</p>" : "") + (lg.vitals.length ? "<p><b>体征记录</b></p><ul>" + lg.vitals.map(function (v) { return "<li>" + vitalText(o, v) + "</li>"; }).join("") + "</ul>" : "") +
        (lg.submittedAt ? '<p class="hint">护理日志已于 ' + lg.submittedAt.slice(11) + " 提交，护理日报已推送家属</p>" : "") +
        '<h3 class="modal-sub">体征趋势（近 7 天）</h3>' + trendCharts(o) + '<p style="text-align:center;margin-top:.8rem"><a class="btn btn-sm" href="family.html?order=' + o.id + '&demo=1" target="_blank" rel="noopener">查看家属端日报 ↗</a></p>');
    }
    f.addEventListener("change", render);
    $("#logs").addEventListener("click", function (e) { var b = e.target.closest("[data-log]"); if (b) show(b.getAttribute("data-log")); });
    render(); save(db);
    if (param("order") && order(param("order"))) show(param("order"));
  };

  /* 排班总览：护工 × 未来 7 天；临时换班：为在护订单更换同等级、档期空闲的护工 */
  pages.schedule = function (user) {
    var f = $("#sch-filters"), T = today(), days = [];
    for (var i = 0; i < 7; i++) days.push(addDays(T, i));
    function covers(o, d) { return o.status === 1 && parse(o.start) <= d && endDate(o) >= d; }
    function render() {
      var g = f.grade.value, onlyBusy = f.busy.checked;
      var cs = db.caregivers.filter(function (c) { return (!g || String(c.grade) === g) && c.status === "在岗"; });
      var html = '<table class="data sched"><thead><tr><th>护工</th>' + days.map(function (d, i) { return "<th" + (i === 0 ? ' class="is-today"' : "") + ">" + md(d) + " 周" + "日一二三四五六"[d.getDay()] + "</th>"; }).join("") + "</tr></thead><tbody>";
      var idle = days.map(function () { return 0; }), shown = 0;
      cs.forEach(function (c) {
        var mine = db.orders.filter(function (o) { return o.caregiver === c.id && o.status === 1; });
        if (onlyBusy && !mine.length) return;
        shown++;
        html += "<tr><th>" + esc(c.name) + '<small>' + GRADES[c.grade] + " · " + c.id + "</small></th>" + days.map(function (d, i) {
          var on = mine.filter(function (o) { return covers(o, d); }), cap = c.grade === 3 ? 3 : 1;
          if (on.length < cap) idle[i]++;
          return '<td class="' + (i === 0 ? "is-today " : "") + (on.length > cap ? "is-clash" : "") + '">' + on.map(function (o) { return '<span class="chip' + (o.accepted ? "" : " is-wait") + '" title="' + o.id + '">' + DEPTS[o.dept] + o.bed + "床</span>"; }).join("") + "</td>";
        }).join("") + "</tr>";
      });
      html += '</tbody><tfoot><tr><th>可接单护工</th>' + idle.map(function (n) { return "<td>" + n + " 人</td>"; }).join("") + "</tr></tfoot></table>";
      $("#sched").innerHTML = html;
      $("#sch-count").textContent = "显示 " + shown + " 名在岗护工";
    }
    f.addEventListener("change", render);
    render();

    var sel = $("#swap-order"), list = $("#swap-list"), active = db.orders.filter(function (o) { return o.status === 1 && o.caregiver; }).sort(function (a, b) { return a.dept === b.dept ? a.bed - b.bed : a.dept < b.dept ? -1 : 1; });
    sel.innerHTML = active.map(function (o) { return '<option value="' + o.id + '">' + bedLabel(o) + " · " + esc(o.patient.name) + " · 现护工 " + esc(carer(o.caregiver).name) + "</option>"; }).join("");
    function swapList() {
      var o = order(sel.value); if (!o) return;
      var from = parse(o.start) > T ? parse(o.start) : T, to = endDate(o), grade = RULE[o.level].grade;
      var free = db.caregivers.filter(function (c) {
        if (c.id === o.caregiver || c.grade !== grade || c.status !== "在岗") return false;
        var n = db.orders.filter(function (x) { return x.status === 1 && x.caregiver === c.id && parse(x.start) <= to && endDate(x) >= from; }).length;
        return n < (grade === 3 ? 3 : 1);
      }).sort(function (a, b) { return (b.exp[o.dept] || 0) - (a.exp[o.dept] || 0) || b.star - a.star; }).slice(0, 5);
      $("#swap-info").textContent = "换班期间：" + iso(from) + " 至 " + iso(to) + "，需" + GRADES[grade] + "护工，以下为档期空闲的人选（按本科室经验排序）。";
      list.innerHTML = free.map(function (c, i) {
        return "<tr><td><input type=\"radio\" name=\"swap\" value=\"" + c.id + "\"" + (i ? "" : " checked") + ' aria-label="选择 ' + esc(c.name) + '"></td><td>' + c.id + "</td><td>" + esc(c.name) + '</td><td class="stars">' + stars(c.star) + "</td><td>" + (c.exp[o.dept] ? DEPTS[o.dept] + " " + c.exp[o.dept] + "年" : "无本科室经验") + "</td><td>" + c.monthDays + " 天</td></tr>";
      }).join("") || '<tr><td colspan="6" class="hint">暂无档期空闲的同等级护工，请转人工协调</td></tr>';
    }
    sel.addEventListener("change", swapList);
    swapList();
    $("[data-swap]").addEventListener("click", function () {
      var o = order(sel.value), id = (list.querySelector("input:checked") || {}).value;
      if (!o || !id) { toast("请选择接替的护工", "err"); return; }
      var old = carer(o.caregiver), c = carer(id);
      (o.swaps = o.swaps || []).push({ from: old.id, to: id, at: now(), reason: $("#swap-reason").value, by: user.name });
      o.caregiver = id; o.accepted = false; o.entryConfirmed = false;
      save(db); toast("已将" + bedLabel(o) + "改派给 " + c.name + "，已通知护工接单并推送护士站进科报备", "ok");
      render(); swapList();
    });
    if (location.hash === "#swap") $("#swap").scrollIntoView();
  };

  /* 护工档案：等级、星级、证书有效期与当前状态；资质审核筛出 60 天内到期的证书 */
  pages.carers = function () {
    var f = $("#carer-filters");
    if (param("filter") === "cert") f.view.value = "cert";
    function render() {
      var q = f.q.value.trim();
      var list = db.caregivers.filter(function (c) {
        var left = dayDiff(today(), c.certExpire);
        return (!f.grade.value || String(c.grade) === f.grade.value) && (!q || c.name.indexOf(q) >= 0 || c.id.indexOf(q) >= 0) &&
          (f.view.value !== "cert" || left <= 60) && (f.view.value !== "idle" || isIdle(c)) && (f.view.value !== "over" || c.monthDays > 26);
      }).sort(function (a, b) { return a.grade - b.grade || b.star - a.star; });
      $("#carer-count").textContent = "共 " + list.length + " 人";
      $("#carers tbody").innerHTML = list.map(function (c) {
        var left = dayDiff(today(), c.certExpire), cur = db.orders.filter(function (o) { return o.caregiver === c.id && o.status === 1; });
        return "<tr><td>" + c.id + "</td><td>" + esc(c.name) + "</td><td>" + c.gender + "</td><td>" + GRADES[c.grade] + '</td><td class="stars">' + stars(c.star) + "</td><td>" + c.good.toFixed(1) + "%</td><td>" + Object.keys(c.exp).map(function (d) { return DEPTS[d] + c.exp[d] + "年"; }).join("、") +
          "</td><td" + (left <= 60 ? ' style="color:var(--alert);font-weight:700"' : "") + ">" + c.certExpire + (left <= 60 ? "（" + left + " 天后到期）" : "") + '</td><td class="num">' + c.monthDays + (c.monthDays > 26 ? ' <span class="tag tag-alert">超时</span>' : "") + "</td><td>" +
          (c.status !== "在岗" ? '<span class="tag tag-9">' + c.status + "</span>" : cur.length ? '<span class="tag tag-1">在护 ' + cur.map(function (o) { return DEPTS[o.dept] + o.bed + "床"; }).join("、") + "</span>" : '<span class="tag tag-3">空闲</span>') +
          '</td><td><button type="button" class="link-btn" data-carer="' + c.id + '">档案</button></td></tr>';
      }).join("") || '<tr><td colspan="11" class="hint">没有符合条件的护工</td></tr>';
    }
    f.addEventListener("input", render); f.addEventListener("change", render);
    $("#carers").addEventListener("click", function (e) { var b = e.target.closest("[data-carer]"); if (b) carerProfile(b.getAttribute("data-carer")); });
    render();
  };

  /* 用户权限：账号、角色与可用子系统；解除锁定、重置密码 */
  pages.users = function () {
    var fails = JSON.parse(localStorage.getItem("kht-admin-fails") || "{}");
    $("#users tbody").innerHTML = Object.keys(ACCOUNTS).map(function (id) {
      var a = ACCOUNTS[id], k = ROLE_KEY[a.role], locked = (fails[id] || 0) >= 3;
      var menus = k === "carer" ? "护工端（今日护理、接单、排班、收益）" : MENUS[k].map(function (m) { return m[0]; }).join("、");
      return "<tr><td>" + id + "</td><td>" + esc(a.name) + "</td><td>" + a.role + "</td><td>" + esc(a.dept) + "</td><td style=\"white-space:normal\">" + menus + "</td><td>" + (locked ? '<span class="tag tag-alert">已锁定</span>' : '<span class="tag tag-3">正常</span>') +
        '</td><td><button type="button" class="link-btn" data-unlock="' + id + '">解除锁定</button>　<button type="button" class="link-btn" data-reset="' + id + '">重置密码</button></td></tr>';
    }).join("");
    $("#users").addEventListener("click", function (e) {
      var b = e.target.closest("[data-unlock]");
      if (b) { delete fails[b.getAttribute("data-unlock")]; localStorage.setItem("kht-admin-fails", JSON.stringify(fails)); toast("已解除锁定", "ok"); setTimeout(function () { location.reload(); }, 500); }
      b = e.target.closest("[data-reset]");
      if (b) toast("账号 " + b.getAttribute("data-reset") + " 的密码已重置为初始密码", "ok");
    });
  };

  /* 摄像头扫码：优先用浏览器自带的 BarcodeDetector，不支持时加载 jsQR 解码 */
  function scanQR(box, onCode, onError) {
    var stream = null, stopped = false, video = document.createElement("video"), canvas = document.createElement("canvas"), ctx = canvas.getContext("2d", { willReadFrequently: true });
    video.setAttribute("playsinline", ""); video.muted = true;
    box.hidden = false; box.innerHTML = ""; box.appendChild(video); box.insertAdjacentHTML("beforeend", '<span class="scan-frame"></span>');
    function stop() { stopped = true; if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); box.hidden = true; box.innerHTML = ""; }
    function decoder() {
      if ("BarcodeDetector" in window) { try { var bd = new window.BarcodeDetector({ formats: ["qr_code"] }); return Promise.resolve(function (src) { return bd.detect(src).then(function (r) { return r[0] && r[0].rawValue; }); }); } catch (e) {} }
      return new Promise(function (ok, fail) {
        if (window.jsQR) return ok(jsqr);
        var sc = document.createElement("script"); sc.src = "vendor/jsQR.js"; sc.onload = function () { ok(jsqr); }; sc.onerror = fail; document.head.appendChild(sc);
      });
      function jsqr() {
        canvas.width = video.videoWidth; canvas.height = video.videoHeight; ctx.drawImage(video, 0, 0);
        var img = ctx.getImageData(0, 0, canvas.width, canvas.height), r = window.jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
        return Promise.resolve(r && r.data);
      }
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false }).then(function (s) {
      if (stopped) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
      stream = s; video.srcObject = s; return video.play().then(decoder).then(function (detect) {
        (function loop() {
          if (stopped) return;
          if (video.readyState < 2) { requestAnimationFrame(loop); return; }
          detect(video).then(function (text) { if (text && !stopped) { stop(); onCode(text); } else setTimeout(loop, 180); }, function () { setTimeout(loop, 300); });
        })();
      });
    }).catch(function () { stop(); onError("无法打开摄像头：请允许浏览器使用摄像头，或手动输入床头码。"); });
    return stop;
  }

  /* 床头码打印：每张卡片含二维码 KHT-BED:科室-床号，护工上岗时扫描核验 */
  pages.bedcodes = function (user) {
    var f = $("#bc-filters"), grid = $("#bc-grid");
    f.dept.innerHTML = Object.keys(DEPTS).filter(function (k) { return !user.ward || k === user.ward; }).map(function (k) { return '<option value="' + k + '">' + k + " " + DEPTS[k] + "</option>"; }).join("");
    if (user.ward) f.dept.value = user.ward; else f.dept.value = "03";
    function card(dept, bed) {
      var text = "KHT-BED:" + bedCode(dept, bed), qr = window.qrcode(0, "M"); qr.addData(text); qr.make();
      return '<article class="bed-card"><header><img src="../assets/img/logo.svg" alt="">康护通 · 床头码</header><div class="bed-no"><span>' + DEPTS[dept] + "</span><b>" + bed + "<small>床</small></b></div>" +
        qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true, alt: "床头码 " + bedCode(dept, bed) }) + "<p>" + text + '</p><footer>护工上岗请扫码核验床位</footer></article>';
    }
    function render() {
      var list = [];
      if (param("beds") && !f.dirty) param("beds").split(",").forEach(function (b) { var x = parseBed(b); if (x) list.push([x.dept, x.bed]); });
      else if (f.range.value === "active") db.orders.filter(function (o) { return o.status === 1 && o.dept === f.dept.value; }).sort(function (a, b) { return a.bed - b.bed; }).forEach(function (o) { list.push([o.dept, o.bed]); });
      else { var r = f.range.value.split("-"); for (var b = +r[0]; b <= +r[1]; b++) list.push([f.dept.value, b]); }
      grid.innerHTML = list.map(function (x) { return card(x[0], x[1]); }).join("") || '<p class="hint">没有符合条件的床位。</p>';
      $("#bc-count").textContent = "共 " + list.length + " 张";
    }
    f.addEventListener("change", function () { f.dirty = true; render(); });
    $("[data-print]").addEventListener("click", function () { window.print(); });
    render();
  };

  /* 家属端：家属用订单号 + 手机尾号查看护理日报（护工提交护理日志后汇总生成） */
  pages.family = function () {
    var box = $("#family"), q = param("order"), pin = param("p"), demo = param("demo") === "1";
    function last4(o) { return String(o.patient.phone || "").slice(-4); }
    function latestStored(o) {
      var best = null;
      Object.keys(db.logs).forEach(function (k) { if (k.indexOf(o.id + "@") === 0) { var d = k.split("@")[1]; if (!best || d > best.d) best = { d: d, lg: db.logs[k] }; } });
      return best;
    }
    function lookup(msg) {
      var cur = db.orders.filter(function (o) { return o.status === 1 && o.accepted && parse(o.start) <= today(); }).sort(function (a, b) { return (b.caregiver === db.caregivers[0].id ? 1 : 0) - (a.caregiver === db.caregivers[0].id ? 1 : 0); }).slice(0, 8);
      box.innerHTML = '<section class="fam-card"><h1>查看护理日报</h1><p class="hint">输入预约时登记的订单编号和联系人手机号后 4 位，即可查看家人今天的护理情况。</p>' +
        '<form id="fam-form" novalidate><div class="field"><label for="f-order">订单编号</label><input id="f-order" inputmode="numeric" maxlength="12" autocomplete="off" placeholder="12 位数字"></div>' +
        '<div class="field"><label for="f-pin">手机尾号</label><input id="f-pin" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="后 4 位"></div>' +
        '<p class="err" id="f-err">' + (msg || "") + '</p><button class="btn btn-primary" type="submit" style="width:100%">查看日报</button></form></section>' +
        '<section class="fam-card"><h2 class="fam-sub">演示：选择一位病人</h2><p class="hint">课堂演示用，点一下自动填好订单号和手机尾号（实际使用时由家属自己输入）。</p><div class="chips">' +
        cur.map(function (o) { return '<button type="button" class="chip-btn" data-pick="' + o.id + '">' + esc(o.patient.name) + " · " + bedLabel(o) + "</button>"; }).join("") + "</div></section>";
      $("#fam-form").addEventListener("submit", function (e) {
        e.preventDefault();
        location.search = "?order=" + encodeURIComponent($("#f-order").value.trim()) + "&p=" + encodeURIComponent($("#f-pin").value.trim());
      });
      box.onclick = function (e) { var b = e.target.closest("[data-pick]"); if (b) { var o = order(b.getAttribute("data-pick")); location.search = "?order=" + o.id + "&p=" + last4(o); } };
    }
    if (!q) { lookup(); return; }
    var o = order(q);
    if (!o || (!demo && last4(o) !== pin)) { lookup("订单编号或手机尾号不正确，请核对后重试。"); return; }

    var T = today(), live = o.status === 1 && o.accepted && parse(o.start) <= T, lg = live ? logFor(o) : null, dayS = iso(T);
    if (!live) { var ls = latestStored(o); if (ls) { lg = ls.lg; dayS = ls.d; } }
    var c = carer(o.caregiver) || {}, pr = lg ? progress(lg) : { done: 0, total: 0, due: 0 }, dayN = Math.max(1, Math.min(o.days, dayDiff(o.start, parse(dayS)) + 1));
    if (!lg) { box.innerHTML = '<section class="fam-card"><h1>' + esc(o.patient.name) + '</h1><p class="hint">服务尚未开始，开始后这里会每天显示护理日报。预约服务开始日期：' + o.start + '。</p><p><a class="btn" href="family.html">返回</a></p></section>'; return; }

    var alerts = db.alerts.filter(function (a) { return a.order === o.id && a.time.slice(0, 10) === dayS; });
    var open = alerts.filter(function (a) { return !a.handled; }), done = alerts.filter(function (a) { return a.handled; });
    var banner = open.length ? '<div class="fam-banner is-warn"><b>今日有 ' + open.length + ' 条异常提醒，护士站已收到并正在处理</b><span>' + open.map(function (a) { return esc(a.type) + "：" + esc(a.detail); }).join("；") + "</span></div>"
      : done.length ? '<div class="fam-banner is-ok"><b>今日的异常提醒已处理</b><span>' + done.map(function (a) { return esc(a.type) + "（" + esc(a.result || "已处理") + "）"; }).join("；") + "</span></div>"
      : '<div class="fam-banner is-ok"><b>今日一切正常</b><span>各项体征和护理项目均在正常范围内</span></div>';

    var vit = lg.vitals, lastOf = function (k) { return vit.filter(function (v) { return v[k]; }).slice(-1)[0]; };
    function chip(label, value, v) { var al = vitalAlerts(o, v), bad = al.length; return '<div class="fam-chip' + (bad ? " is-bad" : "") + '"><span>' + label + "</span><b>" + value + "</b><em>" + (bad ? esc(al[0][0]) : "正常") + "</em></div>"; }
    var chips = "", t = lastOf("temp"), b = lastOf("bp"), g = lastOf("glu"), pl = lastOf("pulse");
    if (t) chips += chip("体温", t.temp + "℃", { temp: t.temp });
    if (b) chips += chip("血压", esc(b.bp), { bp: b.bp });
    if (g) chips += chip((g.gluCtx || "") + "血糖", g.glu + " mmol/L", { glu: g.glu });
    if (pl) chips += chip("脉搏", pl.pulse + " 次/分", { pulse: pl.pulse });

    var sl = lg.sleep, sleepHtml = "";
    if (sl) {
      var toilet = sl.mode === "device" ? sl.leave.length : sl.toilet, sa = sleepAlerts(sl);
      sleepHtml = '<section class="fam-card"><h2 class="fam-sub">昨晚睡眠 <small>' + (sl.mode === "device" ? "智能睡眠监测带" : "护工观察") + '</small></h2><div class="sleep-grid"><div><span>入睡</span><b>' + sl.bed + "</b></div><div><span>醒来</span><b>" + sl.wake + "</b></div><div><span>睡眠时长</span><b>" + (sl.total / 60).toFixed(1) + "<small>小时</small></b></div><div><span>夜醒</span><b>" + sl.wakes + "<small>次</small></b></div></div>" +
        '<p class="hint">起夜 ' + toilet + " 次" + (sl.mode === "device" ? "，平均心率 " + sl.hr + " 次/分，呼吸暂停 " + sl.apnea + " 次" : "") + "，睡眠质量<b>" + sl.quality + "</b>。" + (sa.length ? " 提示：" + sa.map(function (a) { return a[0]; }).join("、") + "，护理团队已关注。" : "") + "</p></section>";
    }
    var hist = db.alerts.filter(function (a) { return a.order === o.id && a.handled && a.time.slice(0, 10) !== dayS; }).sort(function (a, b) { return a.time < b.time ? 1 : -1; });
    var bl = bill(o), fee = o.status === 1 ? "已服务 " + bl.days + " 天，当前费用 <b>" + money(bl.receivable) + "</b> 元（含附加服务），已付押金 " + money(DEPOSIT) + " 元；服务结束后按实际天数结算。" : o.status === 2 ? "服务已结束，应付 <b>" + money(bl.payable) + "</b> 元，请在结算单中确认并支付。" : "服务已结束，费用已结清。";
    var fb = lg.family;

    box.innerHTML =
      '<section class="fam-card fam-hero"><div class="fam-patient"><b>' + esc(o.patient.name) + "</b><span>" + bedLabel(o) + " · " + LEVELS[o.level] + " · " + (o.patient.age ? o.patient.age + "岁" : "") + '</span></div>' +
      '<div class="fam-meta"><div><span>护工</span><b>' + esc(c.name || "—") + '</b><em>' + (c.grade ? GRADES[c.grade] + "护工 · " : "") + '<i class="stars">' + (c.star ? stars(c.star) : "") + "</i></em></div><div><span>服务进度</span><b>第 " + dayN + " / " + o.days + " 天</b><em>" + RULE[o.level].mode + " " + esc(o.slot || "") + "</em></div></div>" +
      '<p class="fam-push">' + (lg.submittedAt ? "<b>" + dayS + " 护理日报</b>已于 " + lg.submittedAt.slice(11) + " 推送至您的微信" : "<b>今日护理进行中</b>，护工提交护理日志后将推送日报，下面是实时进度") + "</p></section>" + banner +
      '<section class="fam-card"><h2 class="fam-sub">今日护理 <small>已完成 ' + pr.done + " / " + pr.total + ' 项</small></h2><div class="bar fam-bar"><i style="width:' + (pr.total ? Math.round(pr.done / pr.total * 100) : 0) + '%"></i></div><ul class="timeline">' +
        lg.items.filter(function (it) { return !it.skipped; }).map(function (it) { return '<li class="' + (it.doneAt ? "is-done" : "") + '"><time>' + it.time + "</time><span>" + esc(it.name.replace(/（护士测量，护工记录）/, "")) + "</span><em>" + (it.doneAt ? "✓ " + it.doneAt : minutes(it.time) <= nowMinutes() && live ? "待记录" : live ? "待执行" : "未完成") + "</em></li>"; }).join("") + "</ul></section>" +
      (chips ? '<section class="fam-card"><h2 class="fam-sub">今日体征</h2><div class="fam-chips">' + chips + "</div></section>" : "") +
      '<section class="fam-card"><h2 class="fam-sub">体征趋势 <small>近 7 天</small></h2>' + trendCharts(o) + "</section>" + sleepHtml +
      (hist.length ? '<section class="fam-card"><h2 class="fam-sub">近期异常与处理</h2><ul class="fam-hist">' + hist.map(function (a) { return "<li><b>" + a.time.slice(5, 16) + " " + esc(a.type) + "</b><span>" + esc(a.detail) + "</span><em>处理：" + esc(a.result || "已处理") + "</em></li>"; }).join("") + "</ul></section>" : "") +
      '<section class="fam-card"><h2 class="fam-sub">费用</h2><p>' + fee + '</p></section>' +
      '<section class="fam-card"><h2 class="fam-sub">给护理团队留言</h2>' + (fb ? '<p class="fam-ok">✓ 已收到您的反馈（' + esc(fb.rating) + '）：“' + esc(fb.msg || "（未留言）") + "”</p>" :
        '<form id="fam-fb" novalidate><div class="choices" role="radiogroup" aria-label="今日满意度"><label><input type="radio" name="rating" value="满意" checked>😊 满意</label><label><input type="radio" name="rating" value="一般">😐 一般</label><label><input type="radio" name="rating" value="不满意">😟 不满意</label></div>' +
        '<textarea name="msg" placeholder="想对护工或护士说的话，例如：今天麻烦多帮忙翻身"></textarea><button class="btn btn-primary" type="submit" style="width:100%">提交反馈</button></form>') + '</section>' +
      '<p class="fam-foot">本日报由护工的护理日志自动汇总生成。如有疑问请致电服务热线 <a href="tel:4000000000">400-000-0000</a>。<br>演示系统：页面中的病人、护工与数据均为虚构示例。</p>';
    var form = $("#fam-fb");
    if (form) form.addEventListener("submit", function (e) {
      e.preventDefault();
      lg.family = { rating: form.rating.value, msg: form.msg.value.trim(), at: now() };
      if (lg.family.rating === "不满意") db.complaints.push({ id: Date.now(), order: o.id, content: lg.family.msg || "家属对今日护理表示不满意", time: now(), status: "待回访" });
      save(db); toast("谢谢您的反馈，护理团队已收到" + (lg.family.rating === "不满意" ? "，客服会尽快联系您" : ""), "ok"); setTimeout(function () { location.reload(); }, 900);
    });
  };

  /* ---------- 演示：角色一键切换与演示向导（仅用于课堂演示） ---------- */
  function roleOptions() {
    return [["kf001", "客服专员 · 陈晓"], ["pb001", "排班专员 · 何静"], [db.caregivers[0].id, "护工 · 李秀兰"], ["hs03", "护士站 · 骨科"], ["hs05", "护士站 · 神经内科"], ["hs06", "护士站 · 重症康复"], ["hs08", "护士站 · 心内科"],
      ["yy001", "运营经理 · 周敏"], ["admin", "系统管理员"], ["__family", "家属端 · 护理日报"]];
  }
  function switchTo(id) {
    if (id === "__family") { location.href = "family.html?demo=1"; return; }
    try { localStorage.setItem(SESSION, JSON.stringify({ account: id, at: now() })); } catch (e) {}
    location.href = (ACCOUNTS[id] && ACCOUNTS[id].home) || "home.html";
  }
  function roleSwitcherHtml(current) {
    var opts = roleOptions(), has = opts.some(function (o) { return o[0] === current; });
    return '<label class="role-switch" title="演示用：无需重新登录，一键切换角色"><span>演示切换</span><select data-role-switch aria-label="演示：切换角色">' + (has ? "" : '<option value="" selected disabled>选择角色…</option>') +
      opts.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === current ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></label>";
  }
  function bindRoleSwitch(root) { var sel = $("[data-role-switch]", root || document); if (sel) sel.addEventListener("change", function () { if (sel.value) switchTo(sel.value); }); }

  function guideSteps() {
    var li = db.caregivers[0].id;
    return [
      { who: "开场 · 官网", title: "官网首页与功能", url: "../index.html", sec: 25 },
      { who: "登录", title: "员工登录与角色权限", url: "index.html", sec: 15 },
      { who: "客服专员", acct: "kf001", title: "登记预约", url: "booking.html?demo=1", sec: 30 },
      { who: "护工 · 李秀兰", acct: li, title: "护工查看并申请订单", url: "nurse.html#orders", sec: 20 },
      { who: "排班专员", acct: "pb001", title: "智能派单", url: "dispatch.html", sec: 30 },
      { who: "排班专员", acct: "pb001", title: "排班总览与临时换班", url: "schedule.html", sec: 15 },
      { who: "护工 · 李秀兰", acct: li, title: "护工确认接单", url: "nurse.html#orders", sec: 10 },
      { who: "护士站 · 骨科", acct: "hs03", title: "进科报备", url: "home.html#entry", sec: 15 },
      { who: "护工 · 李秀兰", acct: li, title: "扫码上岗、打卡、体征监测", url: "nurse.html#today", sec: 40 },
      { who: "护士站 · 骨科", acct: "hs03", title: "紧急预警处理", url: "home.html#alerts", sec: 20 },
      { who: "护工 · 李秀兰", acct: li, title: "提交护理日志", url: "nurse.html#today", sec: 20 },
      { who: "家属端", title: "家属端护理日报", url: function () { var o = db.orders.filter(function (x) { return x.patient.name === "张*明" && x.status === 1; })[0]; return o ? "family.html?order=" + o.id + "&demo=1" : "family.html?demo=1"; }, sec: 30 },
      { who: "客服专员", acct: "kf001", title: "订单查询与电子结算", url: "orders.html", sec: 20 },
      { who: "运营经理", acct: "yy001", title: "经营数据与运营统计", url: "home.html", sec: 25 },
      { who: "系统管理员", acct: "admin", title: "权限管理与收尾", url: "users.html", sec: 15 }
    ];
  }
  function initGuide() {
    var KEY2 = "kht-guide", st;
    try { st = JSON.parse(localStorage.getItem(KEY2) || "null"); } catch (e) {}
    st = st || { i: 0, open: false };
    var steps = guideSteps();
    // 手动点进下一步对应的页面时，自动把进度推进到下一步（例如在官网点“员工登录”后进入第 2 步）
    (function () {
      var nx = steps[st.i + 1]; if (!nx) return;
      var u = typeof nx.url === "function" ? nx.url() : nx.url, f1 = u.split(/[?#]/)[0].split("/").pop(), h1 = u.indexOf("#") >= 0 ? "#" + u.split("#")[1] : "";
      var f0 = location.pathname.split("/").pop() || "index.html";
      if (f0 === f1 && (!h1 || location.hash === h1)) { st.i++; try { localStorage.setItem("kht-guide", JSON.stringify(st)); } catch (e) {} }
    })();
    function put() { try { localStorage.setItem(KEY2, JSON.stringify(st)); } catch (e) {} }
    var root = document.createElement("aside"); root.className = "guide"; root.setAttribute("aria-label", "演示向导");
    document.body.appendChild(root);
    function urlOf(sp) { return typeof sp.url === "function" ? sp.url() : sp.url; }
    function go(i) {
      var sp = steps[i];
      if (sp.acct) { try { localStorage.setItem(SESSION, JSON.stringify({ account: sp.acct, at: now() })); } catch (e) {} }
      st.i = i; st.open = false; put(); location.href = urlOf(sp);  // 前往后收起面板，不遮挡页面
    }
    function render() {
      var sp = steps[st.i];
      root.innerHTML = '<button class="guide-toggle" type="button" aria-expanded="' + st.open + '">演示向导 <b>' + (st.i + 1) + " / " + steps.length + "</b>" + (st.open ? "" : '<span class="guide-cur">' + esc(sp.title) + "</span>") + "</button>" +
        (st.open ? '<div class="guide-panel"><header><b>演示向导</b><button type="button" data-g="close" aria-label="收起">×</button></header>' +
          '<div class="guide-now"><span class="guide-role">第 ' + (st.i + 1) + " 步 · " + esc(sp.who) + "</span><h3>" + esc(sp.title) + '</h3><p class="guide-time">建议用时 ' + sp.sec + ' 秒</p><div class="guide-actions"><button type="button" class="btn btn-sm" data-g="prev"' + (st.i ? "" : " disabled") + '>‹ 上一步</button><button type="button" class="btn btn-sm btn-primary" data-g="go">前往此步骤</button><button type="button" class="btn btn-sm" data-g="next"' + (st.i < steps.length - 1 ? "" : " disabled") + '>完成 ›</button></div></div>' +
          '<ol class="guide-list">' + steps.map(function (x, i) { return '<li class="' + (i < st.i ? "is-done" : i === st.i ? "is-now" : "") + '"><button type="button" data-g="jump" data-i="' + i + '"><i>' + (i < st.i ? "✓" : i + 1) + "</i>" + esc(x.title) + "<small>" + esc(x.who) + " · " + x.sec + "秒</small></button></li>"; }).join("") + "</ol>" +
          '<footer><span class="guide-total">全程约 ' + Math.floor(steps.reduce(function (a, x) { return a + x.sec; }, 0) / 60) + " 分 " + steps.reduce(function (a, x) { return a + x.sec; }, 0) % 60 + ' 秒</span><button type="button" class="link-btn" data-g="restart">从头开始</button><button type="button" class="link-btn" data-g="reset">重置演示数据</button></footer></div>' : "");
    }
    root.addEventListener("click", function (e) {
      var t = e.target.closest("button"); if (!t) return;
      if (t.classList.contains("guide-toggle")) { st.open = !st.open; put(); render(); return; }
      var g = t.getAttribute("data-g");
      if (g === "close") { st.open = false; put(); render(); }
      else if (g === "go") go(st.i);
      else if (g === "prev" && st.i > 0) { st.i--; put(); render(); }
      else if (g === "next" && st.i < steps.length - 1) { st.i++; put(); render(); }
      else if (g === "jump") { st.i = Number(t.getAttribute("data-i")); put(); render(); }
      else if (g === "restart") { st.i = 0; put(); render(); }
      else if (g === "reset") resetData();
    });
    render();
  }

  /* ---------- Boot ---------- */
  var page = document.body.getAttribute("data-page");
  var user = null;
  if (page !== "login" && page !== "nurse" && page !== "family") { user = shell(page); if (!user) return; }
  if (pages[page]) pages[page](user);
  initGuide();
  window.KHTAdmin = { db: function () { return db; }, validOrderId: validOrderId, checkDigit: checkDigit };
})();
