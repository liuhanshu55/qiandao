/* 弈剑阁 · 每日签到服务器（零依赖，Node.js 内置模块实现） */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'data.json');
const PORT = parseInt(process.env.PORT || process.argv[2] || '3000', 10);

const DEFAULT_DATA = {
  members: ['李亭', '张伟', '王芳', '刘洋', '陈静', '杨帆', '赵磊'],
  records: {},          // { 'YYYY-MM-DD': { 姓名: 'HH:MM:SS' } }
  specialPeriods: [],   // { id, start, end, requireSignin, note }
  password: 'yijiange'
};

/* ================= 数据持久化 ================= */
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      return Object.assign({}, JSON.parse(JSON.stringify(DEFAULT_DATA)), parsed);
    }
  } catch (e) {
    console.error('[警告] 读取 data.json 失败，使用默认数据：', e.message);
  }
  return JSON.parse(JSON.stringify(DEFAULT_DATA));
}

let data = loadData();

function saveData() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

/* ================= 日期工具 ================= */
function dateStr(d) {
  const y = d.getFullYear();
  const m = ('0' + (d.getMonth() + 1)).slice(-2);
  const day = ('0' + d.getDate()).slice(-2);
  return y + '-' + m + '-' + day;
}
function todayStr() { return dateStr(new Date()); }

function isSigninRequired(ds) {
  for (let i = data.specialPeriods.length - 1; i >= 0; i--) {
    const p = data.specialPeriods[i];
    if (p.start <= ds && ds <= p.end) return p.requireSignin;
  }
  return true;
}

/* ================= 网络地址 ================= */
function getLanIPv4() {
  const ips = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    }
  }
  return ips;
}

/* ================= HTTP 辅助 ================= */
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function checkAdmin(pwd) {
  return typeof pwd === 'string' && pwd === data.password;
}

/* ================= API 处理 ================= */
function apiState(res) {
  const ips = getLanIPv4();
  const primary = ips[0] || '127.0.0.1';
  json(res, 200, {
    ok: true,
    members: data.members,
    records: data.records,
    specialPeriods: data.specialPeriods,
    todayRequired: isSigninRequired(todayStr()),
    serverUrl: 'http://' + primary + ':' + PORT,
    serverIps: ips,
    port: PORT
  });
}

async function apiCheckin(req, res) {
  const body = await readBody(req);
  const name = String(body.name || '').trim();
  if (!name) return json(res, 400, { ok: false, error: '缺少姓名' });
  if (data.members.indexOf(name) === -1) {
    return json(res, 400, { ok: false, error: '该姓名不在成员名单中' });
  }
  const ds = todayStr();
  if (!isSigninRequired(ds)) {
    return json(res, 200, { ok: false, error: '今日为免签到时段，无需签到' });
  }
  if (!data.records[ds]) data.records[ds] = {};
  if (data.records[ds][name]) {
    return json(res, 200, { ok: true, already: true, name, time: data.records[ds][name] });
  }
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  data.records[ds][name] = time;
  saveData();
  json(res, 200, { ok: true, already: false, name, time });
}

async function apiLogin(req, res) {
  const body = await readBody(req);
  const ok = checkAdmin(body.password);
  json(res, 200, { ok });
}

async function apiMember(req, res) {
  const body = await readBody(req);
  if (!checkAdmin(body.password)) return json(res, 403, { ok: false, error: '密码错误' });
  const action = body.action;
  const name = String(body.name || '').trim();
  if (action === 'add') {
    if (!name) return json(res, 400, { ok: false, error: '缺少姓名' });
    if (data.members.indexOf(name) >= 0) return json(res, 400, { ok: false, error: '该成员已存在' });
    data.members.push(name);
    saveData();
    return json(res, 200, { ok: true });
  }
  if (action === 'remove') {
    const idx = data.members.indexOf(name);
    if (idx === -1) return json(res, 400, { ok: false, error: '该成员不存在' });
    data.members.splice(idx, 1);
    saveData();
    return json(res, 200, { ok: true });
  }
  json(res, 400, { ok: false, error: '未知操作' });
}

async function apiPeriod(req, res) {
  const body = await readBody(req);
  if (!checkAdmin(body.password)) return json(res, 403, { ok: false, error: '密码错误' });
  const action = body.action;
  if (action === 'add') {
    const start = String(body.start || '');
    const end = String(body.end || '');
    const requireSignin = body.requireSignin !== false;
    const note = String(body.note || '').trim();
    if (!start || !end) return json(res, 400, { ok: false, error: '缺少日期' });
    if (start > end) return json(res, 400, { ok: false, error: '开始日期不能晚于结束日期' });
    data.specialPeriods.push({ id: Date.now(), start, end, requireSignin, note });
    saveData();
    return json(res, 200, { ok: true });
  }
  if (action === 'remove') {
    const id = Number(body.id);
    data.specialPeriods = data.specialPeriods.filter((p) => p.id !== id);
    saveData();
    return json(res, 200, { ok: true });
  }
  json(res, 400, { ok: false, error: '未知操作' });
}

async function apiPassword(req, res) {
  const body = await readBody(req);
  if (!checkAdmin(body.password)) return json(res, 403, { ok: false, error: '密码错误' });
  const np = String(body.newPassword || '').trim();
  if (!np) return json(res, 400, { ok: false, error: '新密码不能为空' });
  data.password = np;
  saveData();
  json(res, 200, { ok: true });
}

async function apiReset(req, res) {
  const body = await readBody(req);
  if (!checkAdmin(body.password)) return json(res, 403, { ok: false, error: '密码错误' });
  data.records = {};
  saveData();
  json(res, 200, { ok: true });
}

/* ================= 静态文件 ================= */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function serveStatic(res, pathname) {
  let filePath = pathname === '/' ? 'index.html' : pathname.slice(1);
  filePath = decodeURIComponent(filePath);
  const full = path.normalize(path.join(ROOT, filePath));
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('403 Forbidden');
  }
  fs.readFile(full, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }
    const ext = path.extname(full).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600' });
    res.end(buf);
  });
}

/* ================= 路由 ================= */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  if (pathname === '/api/state' && req.method === 'GET') return apiState(res);
  if (pathname === '/api/checkin' && req.method === 'POST') return apiCheckin(req, res);
  if (pathname === '/api/login' && req.method === 'POST') return apiLogin(req, res);
  if (pathname === '/api/member' && req.method === 'POST') return apiMember(req, res);
  if (pathname === '/api/period' && req.method === 'POST') return apiPeriod(req, res);
  if (pathname === '/api/password' && req.method === 'POST') return apiPassword(req, res);
  if (pathname === '/api/reset' && req.method === 'POST') return apiReset(req, res);

  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(res, pathname);

  json(res, 404, { ok: false, error: 'Not Found' });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('端口 ' + PORT + ' 已被占用，请改用其它端口，例如：node server.js 8080');
  } else {
    console.error('服务器启动失败：', err.message);
  }
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = getLanIPv4();
  console.log('');
  console.log('==============================================');
  console.log('  弈剑阁 · 每日签到服务器已启动');
  console.log('==============================================');
  console.log('  本机访问：  http://localhost:' + PORT);
  ips.forEach((ip) => console.log('  局域网访问： http://' + ip + ':' + PORT));
  console.log('----------------------------------------------');
  console.log('  请让同学们用手机连接同一 WiFi，访问上面的');
  console.log('  局域网地址即可签到，数据多人实时共享。');
  console.log('  默认管理密码： yijiange（登录「管理」后修改）');
  console.log('  按 Ctrl + C 停止服务器。');
  console.log('==============================================');
  console.log('');
});
