/*
 * 康护通 online booking receiver.
 *
 * Receives the website's booking, call-back and caregiver forms as JSON and posts each one to a
 * WeCom (企业微信) group robot, so the care team sees it within seconds.
 *
 * No dependencies. Runs as a Tencent Cloud SCF "Web 函数" (listens on port 9000), or anywhere with Node 16+.
 *
 * Environment variables:
 *   WECOM_WEBHOOK    required  the group robot's webhook URL (https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...)
 *   ALLOWED_ORIGINS  optional  comma-separated site origins allowed to submit, e.g. https://www.example.com
 *                              (leave empty to allow any origin while testing)
 *   PORT             optional  default 9000
 */
"use strict";

const http = require("http");
const https = require("https");

const PORT = Number(process.env.PORT) || 9000;
const WEBHOOK = process.env.WECOM_WEBHOOK || "";
const ORIGINS = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
const MAX_BODY = 10 * 1024;
const PHONE = /^1[3-9]\d{9}$/;

const REQUIRED = {
  booking: ["service", "patientName", "where", "startDate", "contactName", "phone", "consent"],
  callback: ["name", "phone"],
  careers: ["name", "phone", "consent"],
};

const TITLES = { booking: "新的照护预约", callback: "新的回电请求", careers: "新的护工报名" };
const SERVICE = { hospital: "医院陪护", rehab: "康复护理", home: "居家照护", health: "健康管理", unsure: "不确定，请推荐" };
const LEVEL = { "0": "完全失能", "1": "半失能", "2": "基本自理", unsure: "请帮忙评估" };
const NEEDS = { turning: "翻身拍背", tube: "鼻饲喂养", catheter: "导尿护理", night: "夜间陪护", rehab: "康复训练" };
const CERT = { yes: "有", no: "暂无" };

// Fields shown in the WeCom message, in order: [field, label, value map]
const FIELDS = {
  booking: [
    ["service", "服务类型", SERVICE], ["level", "护理等级", LEVEL], ["patientName", "患者姓名"], ["age", "年龄"],
    ["where", "所在位置"], ["startDate", "开始日期"], ["days", "预计天数"], ["needs", "特殊需求", NEEDS],
    ["contactName", "联系人"], ["phone", "手机"], ["notes", "补充说明"],
  ],
  callback: [["name", "称呼"], ["phone", "手机"]],
  careers: [["name", "姓名"], ["phone", "手机"], ["city", "意向城市"], ["years", "护理年限"], ["certified", "护理员证书", CERT]],
};

// Simple in-memory rate limit: 5 submissions per IP per 10 minutes (per warm instance).
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 5;
}

function cors(req, res) {
  const origin = req.headers.origin || "";
  const allowed = ORIGINS.length === 0 ? "*" : ORIGINS.includes(origin) ? origin : "";
  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", allowed);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "86400");
  }
  return Boolean(allowed);
}

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function clean(v) {
  return String(v == null ? "" : v).replace(/[\u0000-\u001f<>`*_[\]]/g, " ").trim().slice(0, 300);
}

function show(value, map) {
  const list = Array.isArray(value) ? value : value === undefined || value === "" ? [] : [value];
  return list.map((v) => (map && map[v]) || clean(v)).filter(Boolean).join("、");
}

function message(data) {
  const lines = [`## ${TITLES[data.form]}`];
  for (const [key, label, map] of FIELDS[data.form]) {
    const text = show(data[key], map);
    if (text) lines.push(`> ${label}：<font color="info">${text}</font>`);
  }
  lines.push(`> 提交时间：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}`);
  lines.push(`> 网站语言：${data.lang === "en" ? "英文" : "中文"}`);
  return lines.join("\n");
}

function validate(data) {
  if (!data || typeof data !== "object" || !REQUIRED[data.form]) return "unknown form";
  for (const key of REQUIRED[data.form]) {
    const v = data[key];
    if (v === undefined || v === null || String(v).trim() === "") return `missing ${key}`;
  }
  if (!PHONE.test(String(data.phone).trim())) return "invalid phone";
  return "";
}

function postToWeCom(text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ msgtype: "markdown", markdown: { content: text } });
    const url = new URL(WEBHOOK);
    const lib = url.protocol === "http:" ? http : https;   // http only for local testing
    const req = lib.request(url, { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }, timeout: 8000 }, (r) => {
      let out = "";
      r.on("data", (c) => (out += c));
      r.on("end", () => {
        try {
          const j = JSON.parse(out || "{}");
          if (r.statusCode === 200 && (j.errcode === 0 || j.errcode === undefined)) resolve();
          else reject(new Error(`WeCom ${r.statusCode} ${out}`));
        } catch (e) { reject(e); }
      });
    });
    req.on("timeout", () => req.destroy(new Error("WeCom timeout")));
    req.on("error", reject);
    req.end(body);
  });
}

const server = http.createServer((req, res) => {
  const originOk = cors(req, res);
  const path = (req.url || "/").split("?")[0];

  if (req.method === "GET" && path === "/health") return send(res, 200, { ok: true });
  if (req.method === "OPTIONS") { res.writeHead(originOk ? 204 : 403); return res.end(); }
  if (req.method !== "POST") return send(res, 405, { ok: false, error: "method not allowed" });
  if (!originOk) return send(res, 403, { ok: false, error: "origin not allowed" });

  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  let size = 0;
  const chunks = [];
  req.on("data", (c) => {
    size += c.length;
    if (size > MAX_BODY) { send(res, 413, { ok: false, error: "too large" }); req.destroy(); return; }
    chunks.push(c);
  });
  req.on("end", async () => {
    if (res.writableEnded) return;
    let data;
    try { data = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch (e) { return send(res, 400, { ok: false, error: "invalid json" }); }

    // Honeypot: real visitors never fill the hidden "website" field.
    if (data && data.website) return send(res, 200, { ok: true });
    const problem = validate(data);
    if (problem) return send(res, 400, { ok: false, error: problem });
    if (limited(ip)) return send(res, 429, { ok: false, error: "too many requests" });
    if (!WEBHOOK) { console.error("WECOM_WEBHOOK is not set"); return send(res, 500, { ok: false, error: "not configured" }); }

    try {
      await postToWeCom(message(data));
      send(res, 200, { ok: true });
    } catch (e) {
      console.error("forward failed:", e.message);
      send(res, 502, { ok: false, error: "forward failed" });
    }
  });
});

server.listen(PORT, () => console.log(`booking receiver listening on ${PORT}`));
