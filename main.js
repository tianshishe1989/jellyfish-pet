const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { queryAI } = require('./ai');

let win = null;
let tray = null;
let server = null;
let settings = null;

// Edge state
let isHidden = false;
let lastScreenRect = null;
let edgeHideTimer = null;
let edgeAnimTimer = null;
let edgeWakeTimer = null;
let edgeWakeCheck = null;
let winW = 81, winH = 81; // Fixed window size, never query getSize()

// --- Settings ---
function loadSettings() {
  const defaults = {
    volume: 60, muted: false, size: 'medium',
    x: null, y: null, locked: false,
    autostart: false, skin: 'default-blue',
    edgeAutoHide: true, serverPort: 19527, language: 'zh', edgeColor: 'blue',
    aiBackend: 'claude-api', aiApiKey: '', aiModel: 'claude-sonnet-4-6',
    aiEndpoint: 'https://api.anthropic.com', aiSystemPrompt: '你是一个桌面助手，帮用户分析文件内容。回答简洁结构化，用中文回复。'
  };
  try {
    const p = path.join(app.getPath('userData'), 'settings.json');
    if (fs.existsSync(p)) {
      return { ...defaults, ...JSON.parse(fs.readFileSync(p, 'utf-8')) };
    }
  } catch (e) { /* ignore */ }
  return defaults;
}

function saveSettings() {
  const p = path.join(app.getPath('userData'), 'settings.json');
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(settings, null, 2));
}

function getWindowSize() {
  const sizes = { small: [48, 48], medium: [64, 64], large: [81, 81] };
  return sizes[settings.size] || sizes.medium;
}

// --- Window ---
function createWindow() {
  const [w, h] = getWindowSize();
  const display = screen.getPrimaryDisplay();
  const bounds = display.workArea;

  win = new BrowserWindow({
    width: w, height: h,
    x: settings.x ?? bounds.width - w - 60,
    y: settings.y ?? bounds.height - h - 120,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  winW = w; winH = h;
  win.setSize(w, h); // Force exact size despite DPI
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Position is saved on drag-end, not on every move

  // Block all file:// navigations
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file://')) {
      event.preventDefault();
      const filePath = decodeURIComponent(url.replace('file:///', '').replace('file://', ''));
      console.log('[jellyfish] File dropped:', filePath);
      const fileName = filePath.split('\\').pop().split('/').pop();
      win.webContents.send('file-drop', { path: filePath, name: fileName, message: `嚼嚼... ${fileName}`, triggerAI: true });
    }
  });
  win.webContents.on('will-redirect', (event, url) => {
    if (url.startsWith('file://')) event.preventDefault();
  });
}

// --- HTTP Server ---
function startServer() {
  const port = settings.serverPort;

  server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200); res.end(); return;
    }

    if (req.method === 'POST' && req.url === '/status') {
      let body = '';
      req.on('data', c => { body += c; if (body.length > 10000) req.destroy(); });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          console.log('[jellyfish] POST /status:', data.state);
          if (win && !win.isDestroyed()) win.webContents.send('state-change', data);
          // Auto-expand from edge for important states
          if (isHidden && (data.state === 'error' || data.state === 'done' || data.state === 'waiting_choice')) {
            showFromEdge();
          }
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, state: data.state }));
        } catch (e) {
          res.writeHead(400);
          res.end(JSON.stringify({ ok: false, error: 'invalid json' }));
        }
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/skin') {
      let body = '';
      req.on('data', c => { body += c; if (body.length > 5000) req.destroy(); });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.skin) {
            settings.skin = data.skin;
            saveSettings();
            if (win) win.webContents.send('skin-change', { skin: data.skin });
            updateTrayMenu();
          }
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, skin: data.skin }));
        } catch (e) {
          res.writeHead(400);
          res.end(JSON.stringify({ ok: false }));
        }
      });
      return;
    }

    if (req.method === 'GET' && req.url === '/ping') {
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`[jellyfish] HTTP server started on http://localhost:${port}`);
  });

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      server.close();
      console.log(`Port ${port} in use, trying ${port + 1}`);
      settings.serverPort = port + 1;
      saveSettings();
      startServer();
    }
  });
}

// --- Tray ---
function makeTrayIcon(color) {
  const hex = (color || '#e8784b').replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const lt = (c) => Math.min(255, c + 60);

  const pixels = [];
  for (let y = 0; y < 16; y++) {
    pixels.push(0);
    for (let x = 0; x < 16; x++) {
      const headLeft = 3, headRight = 12, headTop = 1, headBottom = 7;
      const inHead = y >= headTop && y <= headBottom && x >= headLeft && x <= headRight &&
        !(y === headTop && (x <= headLeft + 1 || x >= headRight - 1)) &&
        !(y === headTop + 1 && (x === headLeft || x === headRight));
      const inEye = ((y >= 3 && y <= 4) && ((x >= 5 && x <= 6) || (x >= 9 && x <= 10)));
      const inLeftArm = y >= 3 && y <= 6 && x >= 1 && x <= 2;
      const inRightArm = y >= 3 && y <= 6 && x >= 13 && x <= 14;
      const inLegs = y >= 8 && y <= 10 &&
        ((x >= 4 && x <= 5) || (x >= 6 && x <= 7) || (x >= 8 && x <= 9) || (x >= 10 && x <= 11));
      const inHighlight = y === 2 && x >= 6 && x <= 9;

      if (inEye) { pixels.push(0x1a, 0x1a, 0x1a, 255); }
      else if (inHighlight) { pixels.push(lt(r), lt(g), lt(b), 200); }
      else if (inHead || inLeftArm || inRightArm || inLegs) { pixels.push(r, g, b, 255); }
      else { pixels.push(0, 0, 0, 0); }
    }
  }

  const zlib = require('zlib');
  const raw = Buffer.from(pixels);
  const compressed = zlib.deflateSync(raw);

  function crc32(buf) {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c;
    }
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  }
  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeB = Buffer.from(type, 'ascii');
    const crcIn = Buffer.concat([typeB, data]);
    const crcB = Buffer.alloc(4);
    crcB.writeUInt32BE(crc32(crcIn), 0);
    return Buffer.concat([len, typeB, data, crcB]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(16, 0); ihdr.writeUInt32BE(16, 4);
  ihdr.writeUInt8(8, 8); ihdr.writeUInt8(6, 9);
  ihdr.writeUInt8(0, 10); ihdr.writeUInt8(0, 11); ihdr.writeUInt8(0, 12);

  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0))
  ]);
  return nativeImage.createFromBuffer(png);
}

function getSkinColor(skinId) {
  try {
    const p = path.join(__dirname, 'renderer', 'skins', `${skinId}.json`);
    if (fs.existsSync(p)) {
      const skin = JSON.parse(fs.readFileSync(p, 'utf-8'));
      return skin.colors.dome || '#e8784b';
    }
  } catch (e) { /* */ }
  return '#e8784b';
}

function refreshTrayIcon() {
  if (!tray) return;
  const iconSize = process.platform === 'darwin' ? 22 : 16;
  const color = getSkinColor(settings.skin);
  tray.setImage(makeTrayIcon(color).resize({ width: iconSize, height: iconSize }));
}

function createTray() {
  try {
    const color = getSkinColor(settings.skin);
    const iconSize = process.platform === 'darwin' ? 22 : 16;
    const icon = makeTrayIcon(color);
    tray = new Tray(icon.resize({ width: iconSize, height: iconSize }));
    tray.setToolTip('Jellyfish Desktop Pet');

    tray.on('click', () => {
      if (win) { win.isVisible() ? win.hide() : win.show(); }
    });

    updateTrayMenu();
  } catch (e) {
    console.error('[jellyfish] Failed to create tray:', e.message);
  }
}

function updateTrayMenu() {
  if (!tray) return;
  const lang = settings.language || 'zh';
  const t = {
    settings: lang === 'zh' ? '设置' : 'Settings',
    sound: lang === 'zh' ? '音效' : 'Sound',
    mute: lang === 'zh' ? '静音' : 'Mute',
    testSound: lang === 'zh' ? '测试音效' : 'Test Sound',
    skin: lang === 'zh' ? '切换皮肤' : 'Skin',
    skinNames: lang === 'zh'
      ? ['珊瑚橙', '粉珍珠', '霓虹紫', '日光金', '幽灵白']
      : ['Coral', 'Pink Pearl', 'Neon Purple', 'Golden Sun', 'Ghost White'],
    language: lang === 'zh' ? '语言' : 'Language',
    chinese: lang === 'zh' ? '中文' : 'Chinese',
    english: lang === 'zh' ? '英文' : 'English',
    lock: lang === 'zh' ? '锁定位置' : 'Lock Position',
    aiSettings: lang === 'zh' ? 'AI 设置' : 'AI Settings',
    aiBackend: lang === 'zh' ? 'AI 后端' : 'AI Backend',
    aiKey: lang === 'zh' ? 'API 密钥' : 'API Key',
    aiModel: lang === 'zh' ? '模型' : 'Model',
    aiEndpointLabel: lang === 'zh' ? '端点' : 'Endpoint',
    edgeColor: lang === 'zh' ? '光条颜色' : 'Strip Color',
    blue: lang === 'zh' ? '蓝色' : 'Blue',
    red: lang === 'zh' ? '红色' : 'Red',
    black: lang === 'zh' ? '黑色' : 'Black',
    green: lang === 'zh' ? '绿色' : 'Green',
    edgeHide: lang === 'zh' ? '边缘自动隐藏' : 'Auto-hide to Edge',
    autostart: lang === 'zh' ? '开机自启' : 'Auto-start',
    quit: lang === 'zh' ? '退出小水母' : 'Quit Jellyfish'
  };

  const skinIds = ['default-blue', 'pink-pearl', 'neon-purple', 'golden-sun', 'ghost-white'];

  const contextMenu = Menu.buildFromTemplate([
    {
      label: t.settings,
      submenu: [
        {
          label: t.sound,
          submenu: [
            { label: t.mute, type: 'checkbox', checked: settings.muted, click: (mi) => {
              settings.muted = mi.checked; saveSettings();
              if (win) win.webContents.send('settings-changed', { muted: mi.checked });
            }},
            { type: 'separator' },
            { label: t.testSound, click: () => { if (win) win.webContents.send('state-change', { state: 'done' }); } }
          ]
        },
        {
          label: t.skin,
          submenu: [
            ...skinIds.map((id, i) => ({
              label: t.skinNames[i], type: 'radio', checked: settings.skin === id, click: () => changeSkin(id)
            })),
            { type: 'separator' },
            { label: lang === 'zh' ? '打开自定义皮肤目录...' : 'Open Custom Skins Folder...', click: () => {
              const { shell } = require('electron');
              const dir = path.join(app.getPath('userData'), 'skins');
              if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
              shell.openPath(dir);
            }}
          ]
        },
        {
          label: t.aiSettings,
          submenu: [
            { label: t.aiBackend,
              submenu: [
                { label: 'Claude API', type: 'radio', checked: !settings.aiBackend || settings.aiBackend === 'claude-api', click: () => {
                  settings.aiBackend = 'claude-api'; saveSettings(); updateTrayMenu();
                }},
                { label: 'Claude Code CLI', type: 'radio', checked: settings.aiBackend === 'claude-code', click: () => {
                  settings.aiBackend = 'claude-code'; saveSettings(); updateTrayMenu();
                }},
                { label: 'OpenAI / 兼容', type: 'radio', checked: settings.aiBackend === 'openai', click: () => {
                  settings.aiBackend = 'openai'; saveSettings(); updateTrayMenu();
                }}
              ]
            },
            { label: t.aiModel, submenu: [
              { label: 'Claude Opus 4.7', type: 'radio', checked: settings.aiModel === 'claude-opus-4-7', click: () => { settings.aiModel = 'claude-opus-4-7'; saveSettings(); updateTrayMenu(); } },
              { label: 'Claude Sonnet 4.6', type: 'radio', checked: !settings.aiModel || settings.aiModel === 'claude-sonnet-4-6', click: () => { settings.aiModel = 'claude-sonnet-4-6'; saveSettings(); updateTrayMenu(); } },
              { label: 'Claude Haiku 4.5', type: 'radio', checked: settings.aiModel === 'claude-haiku-4-5', click: () => { settings.aiModel = 'claude-haiku-4-5'; saveSettings(); updateTrayMenu(); } }
            ]},
            { type: 'separator' },
            { label: lang === 'zh' ? '打开 AI 配置文件...' : 'Open AI Config...', click: () => {
              const { shell } = require('electron');
              const dir = app.getPath('userData');
              if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
              const configPath = path.join(dir, 'ai-config.json');
              if (!fs.existsSync(configPath)) {
                fs.writeFileSync(configPath, JSON.stringify({
                  backend: settings.aiBackend || 'claude-api',
                  apiKey: settings.aiApiKey || '',
                  model: settings.aiModel || 'claude-sonnet-4-6',
                  endpoint: settings.aiEndpoint || 'https://api.anthropic.com',
                  systemPrompt: settings.aiSystemPrompt || '你是一个桌面助手，帮用户分析文件内容。回答简洁结构化，用中文回复。'
                }, null, 2));
              }
              shell.openPath(configPath);
            }},
            { label: lang === 'zh' ? '重新加载 AI 配置' : 'Reload AI Config', click: () => {
              const configPath = path.join(app.getPath('userData'), 'ai-config.json');
              if (fs.existsSync(configPath)) {
                try {
                  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
                  if (cfg.backend) settings.aiBackend = cfg.backend;
                  if (cfg.apiKey !== undefined) settings.aiApiKey = cfg.apiKey;
                  if (cfg.model) settings.aiModel = cfg.model;
                  if (cfg.endpoint) settings.aiEndpoint = cfg.endpoint;
                  if (cfg.systemPrompt) settings.aiSystemPrompt = cfg.systemPrompt;
                  saveSettings();
                  updateTrayMenu();
                } catch (e) { console.error('[jellyfish] Failed to load AI config:', e.message); }
              }
            }}
          ]
        },
        {
          label: t.language,
          submenu: [
            { label: t.chinese, type: 'radio', checked: !settings.language || settings.language === 'zh', click: () => setLanguage('zh') },
            { label: t.english, type: 'radio', checked: settings.language === 'en', click: () => setLanguage('en') }
          ]
        },
        { type: 'separator' },
        { label: t.lock, type: 'checkbox', checked: settings.locked, click: (mi) => {
          settings.locked = mi.checked; saveSettings();
          if (win) win.webContents.send('settings-changed', { locked: mi.checked });
        }},
        {
          label: t.edgeColor,
          submenu: [
            { label: t.blue, type: 'radio', checked: !settings.edgeColor || settings.edgeColor === 'blue', click: () => changeEdgeColor('blue') },
            { label: t.red, type: 'radio', checked: settings.edgeColor === 'red', click: () => changeEdgeColor('red') },
            { label: t.black, type: 'radio', checked: settings.edgeColor === 'black', click: () => changeEdgeColor('black') },
            { label: t.green, type: 'radio', checked: settings.edgeColor === 'green', click: () => changeEdgeColor('green') }
          ]
        },
        { label: t.edgeHide, type: 'checkbox', checked: settings.edgeAutoHide, click: (mi) => {
          settings.edgeAutoHide = mi.checked; saveSettings();
          if (!mi.checked && isHidden) showFromEdge();
        }},
        { label: t.autostart, type: 'checkbox', checked: settings.autostart, click: (mi) => {
          settings.autostart = mi.checked; saveSettings();
          app.setLoginItemSettings({ openAtLogin: mi.checked });
        }}
      ]
    },
    { type: 'separator' },
    { label: t.quit, click: () => { app.quit(); } }
  ]);
  tray.setContextMenu(contextMenu);
}

function changeEdgeColor(color) {
  settings.edgeColor = color;
  saveSettings();
  if (win) win.webContents.send('settings-changed', { edgeColor: color });
  updateTrayMenu();
}

function setLanguage(lang) {
  settings.language = lang;
  saveSettings();
  if (win) win.webContents.send('settings-changed', { language: lang });
  updateTrayMenu();
}

function changeSkin(skin) {
  settings.skin = skin; saveSettings();
  if (win) win.webContents.send('skin-change', { skin });
  refreshTrayIcon();
  updateTrayMenu();
}

// ======================
// EDGE AUTO-HIDE SYSTEM
// ======================
const EDGE_SNAP = 5;
const EDGE_PEEK = 3;
const EDGE_HIDE_DELAY = 300;
const EDGE_WAKE = 10;
const EDGE_WAKE_DELAY = 150;
const EDGE_ANIM_MS = 200;

function getEdgeInfo() {
  if (!win || win.isDestroyed()) return null;
  const bounds = win.getBounds();
  const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
  const wa = display.workArea;

  const dl = bounds.x - wa.x;
  const dr = wa.x + wa.width - (bounds.x + winW);
  const dt = bounds.y - wa.y;

  let edge = null;
  // Priority: left/right first, then top
  if (dl <= EDGE_SNAP) edge = 'left';
  else if (dr <= EDGE_SNAP) edge = 'right';
  else if (dt <= EDGE_SNAP) edge = 'top';
  // bottom excluded

  if (!edge) return null;

  let snapX = bounds.x, snapY = bounds.y;
  let hideX = bounds.x, hideY = bounds.y;
  if (edge === 'left') { snapX = wa.x; hideX = wa.x - winW + EDGE_PEEK; }
  else if (edge === 'right') { snapX = wa.x + wa.width - winW; hideX = wa.x + wa.width - EDGE_PEEK; }
  else if (edge === 'top') { snapY = wa.y; hideY = wa.y - winH + EDGE_PEEK; }

  return { edge, wa, snapX, snapY, hideX, hideY, bounds };
}

function snapAndHide() {
  if (!settings.edgeAutoHide || !win || win.isDestroyed() || isHidden) return;
  if (edgeHideTimer) clearTimeout(edgeHideTimer);
  edgeHideTimer = setTimeout(() => {
    if (!win || win.isDestroyed() || isHidden) return;
    const info = getEdgeInfo();
    if (!info) return;

    const [wx, wy] = win.getPosition();
    isHidden = true;
    edgeHideTimer = null;
    const snapX = info.snapX, snapY = info.snapY;
    const endX = info.hideX, endY = info.hideY;
    lastScreenRect = { x: info.snapX, y: info.snapY, width: winW, height: winH, edge: info.edge, wa: info.wa };
    if (win) win.webContents.send('edge-state', { hidden: true, edge: info.edge, color: settings.edgeColor || 'blue' });

    const sx = Math.round(wx), sy = Math.round(wy);
    const t0 = Date.now();
    clearInterval(edgeAnimTimer);
    edgeAnimTimer = setInterval(() => {
      const t = Math.min(1, (Date.now() - t0) / EDGE_ANIM_MS);
      const e = 1 - (1 - t) * (1 - t);
      let cx, cy;
      if (t < 0.3) {
        const t2 = t / 0.3;
        cx = Math.round(sx + (snapX - sx) * t2);
        cy = Math.round(sy + (snapY - sy) * t2);
      } else {
        const t2 = (t - 0.3) / 0.7;
        cx = Math.round(snapX + (endX - snapX) * t2);
        cy = Math.round(snapY + (endY - snapY) * t2);
      }
      if (win && !win.isDestroyed()) {
        win.setBounds({ x: cx, y: cy, width: winW, height: winH });
      }
      if (t >= 1) {
        clearInterval(edgeAnimTimer);
        edgeAnimTimer = null;
        startWakeWatch();
      }
    }, 16);
  }, EDGE_HIDE_DELAY);
}

function showFromEdge() {
  if (!win || win.isDestroyed() || !isHidden || !lastScreenRect) return;
  if (edgeWakeTimer) { clearTimeout(edgeWakeTimer); edgeWakeTimer = null; }
  if (edgeWakeCheck) { clearTimeout(edgeWakeCheck); edgeWakeCheck = null; }
  if (edgeAnimTimer) { clearInterval(edgeAnimTimer); edgeAnimTimer = null; }

  const [sx, sy] = win.getPosition();
  const tg = lastScreenRect;
  const t0 = Date.now();
  if (win) win.webContents.send('edge-state', { hidden: false });

  edgeAnimTimer = setInterval(() => {
    const t = Math.min(1, (Date.now() - t0) / EDGE_ANIM_MS);
    const e = 1 - (1 - t) * (1 - t);
    const cx = Math.round(sx + (tg.x - sx) * e);
    const cy = Math.round(sy + (tg.y - sy) * e);
    if (win && !win.isDestroyed()) {
      win.setBounds({ x: cx, y: cy, width: winW, height: winH });
    }
    if (t >= 1) {
      clearInterval(edgeAnimTimer);
      edgeAnimTimer = null;
      isHidden = false;
      lastScreenRect = null;
      // Wait 3s before monitoring for re-hide (so user can see the notification)
      setTimeout(() => startRehideCheck(), 3000);
    }
  }, 16);
}

let rehideInterval = null;
function startRehideCheck() {
  if (rehideInterval) clearInterval(rehideInterval);
  rehideInterval = setInterval(() => {
    if (!settings.edgeAutoHide || isHidden || !win || win.isDestroyed()) {
      clearInterval(rehideInterval); rehideInterval = null; return;
    }
    const info = getEdgeInfo();
    if (!info) { clearInterval(rehideInterval); rehideInterval = null; return; }
    const pos = screen.getCursorScreenPoint();
    const b = win.getBounds();
    const overWin = pos.x >= b.x && pos.x <= b.x + b.width &&
                    pos.y >= b.y && pos.y <= b.y + b.height;
    if (!overWin) {
      clearInterval(rehideInterval); rehideInterval = null;
      snapAndHide();
    }
  }, 500);
}

function startWakeWatch() {
  if (!isHidden || !lastScreenRect) return;

  const check = () => {
    edgeWakeCheck = null;
    if (!isHidden || !win || win.isDestroyed() || !lastScreenRect || !settings.edgeAutoHide) return;

    const pos = screen.getCursorScreenPoint();
    const { edge, wa } = lastScreenRect;
    let near = false;
    if (edge === 'left') near = pos.x - wa.x <= EDGE_WAKE;
    else if (edge === 'right') near = wa.x + wa.width - pos.x <= EDGE_WAKE;
    else if (edge === 'top') near = pos.y - wa.y <= EDGE_WAKE;

    if (near) {
      if (!edgeWakeTimer) {
        if (win) win.webContents.send('edge-state', { hidden: true, edge, hover: true, color: settings.edgeColor || 'blue' });
        edgeWakeTimer = setTimeout(() => showFromEdge(), EDGE_WAKE_DELAY);
      }
    } else {
      if (edgeWakeTimer) {
        clearTimeout(edgeWakeTimer); edgeWakeTimer = null;
        if (win) win.webContents.send('edge-state', { hidden: true, edge, hover: false, color: settings.edgeColor || 'blue' });
      }
    }
    if (isHidden) edgeWakeCheck = setTimeout(check, 100);
  };
  edgeWakeCheck = setTimeout(check, 100);
}

// --- IPC ---
let dragging = false;
let dragStartMouse = null;
let dragStartWin = null;

ipcMain.on('drag-start', () => {
  if (settings.locked || !win || win.isDestroyed()) return;
  if (isHidden) return;
  dragging = true;
  dragStartMouse = screen.getCursorScreenPoint();
  dragStartWin = win.getPosition();
  if (edgeHideTimer) { clearTimeout(edgeHideTimer); edgeHideTimer = null; }
});

ipcMain.on('drag-move', () => {
  if (!dragging || !dragStartMouse || !dragStartWin || !win || win.isDestroyed()) return;
  const mouse = screen.getCursorScreenPoint();
  let newX = Math.round(dragStartWin[0] + (mouse.x - dragStartMouse.x));
  let newY = Math.round(dragStartWin[1] + (mouse.y - dragStartMouse.y));

  // Magnetic snap during drag
  if (settings.edgeAutoHide) {
    const display = screen.getDisplayNearestPoint({ x: newX, y: newY });
    const wa = display.workArea;
    const MARGIN = 8; // slightly wider snap during drag
    if (newX - wa.x <= MARGIN && newX - wa.x > -MARGIN * 2) newX = wa.x;
    else if (wa.x + wa.width - (newX + winW) <= MARGIN && wa.x + wa.width - (newX + winW) > -MARGIN * 2) newX = wa.x + wa.width - winW;
    if (newY - wa.y <= MARGIN && newY - wa.y > -MARGIN * 2) newY = wa.y;
  }

  win.setBounds({ x: newX, y: newY, width: winW, height: winH });
});

ipcMain.on('drag-end', () => {
  dragging = false;
  dragStartMouse = null;
  dragStartWin = null;
  if (win && !win.isDestroyed()) {
    const [x, y] = win.getPosition();
    settings.x = x;
    settings.y = y;
    saveSettings();
    snapAndHide();
  }
});

ipcMain.handle('ai-query', async (_, { prompt, content, filePath }) => {
  try {
    let fileContent = content || null;
    if (!fileContent && filePath && fs.existsSync(filePath)) {
      fileContent = fs.readFileSync(filePath, 'utf-8');
    }
    console.log('[jellyfish] AI query:', prompt, 'content size=', fileContent ? fileContent.length : 0);
    const result = await queryAI(settings, prompt, fileContent);
    console.log('[jellyfish] AI response:', result.slice(0, 100));
    return { ok: true, text: result };
  } catch (e) {
    console.error('[jellyfish] AI error:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('get-settings', () => settings);

ipcMain.on('set-settings', (_, key, value) => {
  settings[key] = value;
  saveSettings();
  if (win) win.webContents.send('settings-changed', { [key]: value });
});

// --- macOS specific ---
if (process.platform === 'darwin') {
  app.dock && app.dock.hide(); // Hide dock icon — menu bar app style
}

// macOS file drop via open-file event
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (win && !win.isDestroyed()) {
    const fileName = filePath.split('/').pop();
    win.webContents.send('file-drop', { path: filePath, name: fileName, message: `Nom nom... ${fileName}` });
  }
});

// --- App Lifecycle ---
app.whenReady().then(() => {
  settings = loadSettings();
  // Sync AI config from file
  try {
    const cfgPath = path.join(app.getPath('userData'), 'ai-config.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      if (cfg.apiKey !== undefined) settings.aiApiKey = cfg.apiKey;
      if (cfg.backend) settings.aiBackend = cfg.backend;
      if (cfg.model) settings.aiModel = cfg.model;
      if (cfg.endpoint) settings.aiEndpoint = cfg.endpoint;
      if (cfg.systemPrompt) settings.aiSystemPrompt = cfg.systemPrompt;
      saveSettings();
    }
  } catch (e) { /* ignore */ }
  createWindow();
  createTray();
  startServer();
  setTimeout(() => {
    if (win) win.webContents.send('state-change', { state: 'idle' });
  }, 500);
});

app.on('window-all-closed', () => {
  if (server) server.close();
  app.quit();
});

app.on('before-quit', () => {
  if (server) server.close();
});
