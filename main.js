const { app, BrowserWindow, Tray, Menu, dialog, ipcMain, nativeImage, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');

// 禁用 GPU 硬件加速（虚拟机/无 GPU 环境下避免 GPU 进程崩溃）
app.disableHardwareAcceleration();

let win = null;      // 宠物窗口
let tray = null;     // 系统托盘
let config = {};     // 本地配置
let configPath = ''; // 配置文件路径

// 默认宠物图片（放在 assets/ 目录）
const DEFAULT_PET = path.join(__dirname, 'assets', 'deepseek.jpg');

// 窗口尺寸策略（v1.4.3）：窗口高度**固定**，容纳「宠物(200) + 菜单(约130) + 间隙」的完整高度。
// 宠物用 position:fixed 钉在屏幕底部，窗口恒定不变 → 菜单展开/收起绝不引起重排闪烁。
// 菜单按钮的显隐由 CSS `#pet-wrap:hover` 控制（悬停宠物才显示、移出隐藏），窗口正常接收鼠标即可，无需穿透。
const WIN_W = 220;                              // 窗口宽度
const PET_SIZE = 200;                           // 宠物可视区域边长
const PAD_BOTTOM = 12;                          // 宠物下方留白
const MENU_RESERVE = 280;                       // 宠物上方为菜单预留的空间（7 项菜单约 248 + 间隙 + 顶部留白）
const WIN_H = PET_SIZE + PAD_BOTTOM + MENU_RESERVE; // 固定高度（≈492）

// ---------- 配置读写 ----------
function loadConfig() {
  configPath = path.join(app.getPath('userData'), 'pet-config.json');
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    config = {};
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  } catch (e) {
    console.error('保存配置失败:', e);
  }
}

// ---------- P2：待办数据（气泡提醒） ----------
// 待办存到独立文件 todos.json（用户数据目录），结构：[{id, text, dueAt(时间戳), done}]
let todosPath = '';
let todos = [];

function loadTodos() {
  todosPath = path.join(app.getPath('userData'), 'pet-todos.json');
  try {
    todos = JSON.parse(fs.readFileSync(todosPath, 'utf8'));
    if (!Array.isArray(todos)) todos = [];
  } catch (e) {
    todos = [];
  }
}

function saveTodos() {
  try {
    fs.writeFileSync(todosPath, JSON.stringify(todos, null, 2), 'utf8');
  } catch (e) {
    console.error('保存待办失败:', e);
  }
}

// ---------- P2：宠物状态（喂食/心情养成） ----------
// 状态存到独立文件 pet-state.json：{ satiety(饱食度 0-100), mood(心情 0-100), lastUpdate(时间戳) }
// 饱食度/心情随时间自然衰减，喂食提升；衰减在渲染层按 lastUpdate 计算并回写。
let statePath = '';
let petState = { satiety: 80, mood: 80, lastUpdate: Date.now() };

function loadPetState() {
  statePath = path.join(app.getPath('userData'), 'pet-state.json');
  try {
    const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    petState = Object.assign({ satiety: 80, mood: 80, lastUpdate: Date.now() }, s);
  } catch (e) {
    petState = { satiety: 80, mood: 80, lastUpdate: Date.now() };
  }
}

function savePetState() {
  try {
    fs.writeFileSync(statePath, JSON.stringify(petState, null, 2), 'utf8');
  } catch (e) {
    console.error('保存宠物状态失败:', e);
  }
}

// 待办到期检查定时器：每秒检查一次，到期未完成的待办触发气泡提醒
let todoTimer = null;

function startTodoTimer() {
  if (todoTimer) clearInterval(todoTimer);
  todoTimer = setInterval(() => {
    const now = Date.now();
    let fired = false;
    for (const t of todos) {
      // 到期且未完成、且未提醒过（reminded 标记）
      if (!t.done && t.dueAt && t.dueAt <= now && !t.reminded) {
        t.reminded = true;
        fired = true;
        if (win) win.webContents.send('pet:bubble', { text: t.text, type: 'todo' });
      }
    }
    if (fired) saveTodos();
  }, 1000);
}

// ---------- 创建窗口 ----------
function createWindow() {
  const { x, y } = (config.position && config.position.x != null)
    ? config.position
    : { x: undefined, y: undefined };

  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x: x,
    y: y,
    transparent: true,      // 透明背景
    frame: false,           // 无边框
    resizable: false,
    alwaysOnTop: config.alwaysOnTop !== false,
    skipTaskbar: true,      // 不占任务栏
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 记住窗口位置
  win.on('moved', () => {
    if (win) {
      const [wx, wy] = win.getPosition();
      config.position = { x: wx, y: wy };
      saveConfig();
    }
  });

  win.on('close', (e) => {
    // 关闭时隐藏到托盘而非退出
    if (!app.isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

// ---------- 图片 MIME 映射 ----------
const MIME_MAP = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
};

function fileToDataUrl(f) {
  const data = fs.readFileSync(f);
  const ext = path.extname(f).toLowerCase();
  const mime = MIME_MAP[ext] || 'image/png';
  return `data:${mime};base64,${data.toString('base64')}`;
}

// ---------- 帧动画序列检测 ----------
// 约定命名：宠物名_序号.扩展名，如 cat_0.png、cat_1.png、cat_2.png…
// 选择/拖入其中任意一张时，自动识别同目录下的同前缀连续帧组成动画。
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function detectFrameSeries(filePath) {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  const m = base.match(/^(.*?)_(\d+)$/);
  if (!m) return null; // 文件名不含「_数字」后缀，视为单图
  const prefix = m[1];
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch (e) {
    return null;
  }
  const re = new RegExp('^' + escapeRegExp(prefix) + '_(\\d+)' + escapeRegExp(ext) + '$', 'i');
  const frames = files
    .filter((f) => re.test(f))
    .map((f) => ({ idx: parseInt(f.match(re)[1], 10), p: path.join(dir, f) }))
    .sort((a, b) => a.idx - b.idx)
    .map((o) => o.p);
  return frames.length >= 2 ? frames : null; // 至少 2 帧才算动画
}

// ---------- 发送图片到渲染进程 ----------
function sendPetImage(filePath) {
  if (!win) return;
  try {
    const ext = path.extname(filePath).toLowerCase();
    const isGif = ext === '.gif';
    // GIF 走原生动画，其余检测帧序列；无序列则单帧
    const frames = isGif ? [filePath] : (detectFrameSeries(filePath) || [filePath]);
    const images = frames.map(fileToDataUrl);
    win.webContents.send('pet-image', {
      images,            // 帧数组（单图则长度为 1）
      filePath,          // 主路径
      isGif,             // 是否 GIF
      frameDelay: 180    // 帧间隔（毫秒）
    });
    config.petImage = filePath;
    saveConfig();
  } catch (e) {
    console.error('读取图片失败:', e);
    dialog.showErrorBox('错误', '图片读取失败');
  }
}

// ---------- 更换宠物（文件选择器） ----------
async function changePet() {
  const result = await dialog.showOpenDialog(win, {
    title: '选择宠物图片',
    properties: ['openFile'],
    filters: [
      { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }
    ]
  });
  if (!result.canceled && result.filePaths.length > 0) {
    sendPetImage(result.filePaths[0]);
  }
}

// 拖入文件换宠（renderer 拿到本地绝对路径后回传）
ipcMain.on('pet:drop-file', (e, filePath) => {
  if (!filePath) return;
  sendPetImage(filePath);
});

// ---------- 托盘 ----------
function createTray() {
  // 用一个小托盘图标
  let icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('桌面宠物');

  const menu = Menu.buildFromTemplate([
    { label: '呼出宠物 (Alt+P)', click: () => bringToFront() },
    { label: '显示/隐藏宠物', click: () => togglePet() },
    { label: '更换宠物', click: () => changePet() },
    { type: 'separator' },
    { label: '置顶', type: 'checkbox', checked: config.alwaysOnTop !== false, click: (mi) => { config.alwaysOnTop = mi.checked; saveConfig(); if (win) win.setAlwaysOnTop(mi.checked); } },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu);
  // 点击托盘图标 = 呼出宠物到最前（比隐藏更常用，避免找不到宠物）
  tray.on('click', () => bringToFront());
}

function togglePet() {
  if (!win) return;
  if (win.isVisible()) {
    win.hide();
  } else {
    win.show();
    win.moveTop();
  }
}

// ---------- IPC ----------
ipcMain.handle('pet:change', async () => {
  await changePet();
});

ipcMain.handle('pet:toggle-always-on-top', (e, checked) => {
  config.alwaysOnTop = checked;
  saveConfig();
  if (win) win.setAlwaysOnTop(checked);
  return config.alwaysOnTop;
});

ipcMain.handle('pet:quit', () => {
  app.isQuitting = true;
  app.quit();
});

// 拖拽移动窗口：
// 修复 Windows 高 DPI 下 setPosition 累积舍入误差导致窗口越拖越大的问题。
// 拖拽开始时记录一次窗口位置和尺寸，拖动中用「起始位置 + 增量」计算绝对目标，
// 并通过 setBounds 显式锁定宽高，杜绝尺寸漂移。
let dragState = null;

ipcMain.on('pet:drag-start', () => {
  if (!win) return;
  const b = win.getBounds();
  dragState = { startX: b.x, startY: b.y, width: b.width, height: b.height };
});

ipcMain.on('pet:drag-move', (e, { dx, dy }) => {
  if (!win || !dragState) return;
  win.setBounds({
    x: Math.round(dragState.startX + dx),
    y: Math.round(dragState.startY + dy),
    width: dragState.width,   // 显式锁定尺寸，防止拖动时被改大
    height: dragState.height
  });
});

ipcMain.on('pet:drag-end', () => {
  dragState = null;
  // 拖拽结束，保存位置
  if (win) {
    const [wx, wy] = win.getPosition();
    config.position = { x: wx, y: wy };
    saveConfig();
  }
});

// 呼出宠物到最前（取消置顶后被遮挡时用）
function bringToFront() {
  if (!win) return;
  if (!win.isVisible()) win.show();
  win.moveTop();   // 临时提到最前，不改变 alwaysOnTop 设置
  win.focus();
}

// ---------- P2 IPC：待办（气泡提醒） ----------
ipcMain.handle('todo:list', () => todos.slice());

ipcMain.handle('todo:add', (e, { text, dueAt }) => {
  const todo = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    text: String(text || '').trim(),
    dueAt: dueAt || null,   // 到期时间戳（毫秒），null 表示不设提醒
    done: false,
    reminded: false,
    createdAt: Date.now()
  };
  if (!todo.text) return { ok: false, error: '内容不能为空' };
  todos.push(todo);
  saveTodos();
  return { ok: true, todo };
});

ipcMain.handle('todo:toggle', (e, id) => {
  const t = todos.find((x) => x.id === id);
  if (t) { t.done = !t.done; if (t.done) t.reminded = true; saveTodos(); }
  return todos.slice();
});

ipcMain.handle('todo:remove', (e, id) => {
  todos = todos.filter((x) => x.id !== id);
  saveTodos();
  return todos.slice();
});

// ---------- P2 IPC：宠物状态（喂食/心情养成） ----------
ipcMain.handle('pet-state:get', () => petState);

ipcMain.handle('pet-state:update', (e, s) => {
  // 渲染层回写最新的饱食度/心情（已含随时间衰减的结果）
  if (s && typeof s.satiety === 'number') petState.satiety = Math.max(0, Math.min(100, s.satiety));
  if (s && typeof s.mood === 'number') petState.mood = Math.max(0, Math.min(100, s.mood));
  if (s && typeof s.lastUpdate === 'number') petState.lastUpdate = s.lastUpdate;
  savePetState();
  return petState;
});

ipcMain.handle('pet-state:feed', () => {
  // 喂食：饱食度+30、心情+15，上限 100
  petState.satiety = Math.min(100, petState.satiety + 30);
  petState.mood = Math.min(100, petState.mood + 15);
  petState.lastUpdate = Date.now();
  savePetState();
  return petState;
});

ipcMain.handle('pet-state:play', () => {
  // 玩耍：心情+20、饱食度-5
  petState.mood = Math.min(100, petState.mood + 20);
  petState.satiety = Math.max(0, petState.satiety - 5);
  petState.lastUpdate = Date.now();
  savePetState();
  return petState;
});

// ---------- 应用生命周期 ----------
app.whenReady().then(() => {
  loadConfig();
  loadTodos();
  loadPetState();
  createWindow();
  createTray();
  startTodoTimer();

  // 全局快捷键：Alt+P 随时呼出宠物到最前（即使取消置顶被遮挡也能找回）
  globalShortcut.register('Alt+P', () => bringToFront());

  // 启动时发送当前宠物（优先 config 记录，否则默认图）
  const pet = config.petImage && fs.existsSync(config.petImage)
    ? config.petImage
    : DEFAULT_PET;
  win.webContents.once('did-finish-load', () => {
    sendPetImage(pet);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // 不退出，常驻托盘
  if (process.platform !== 'darwin') {
    // 保持运行
  }
});

app.on('before-quit', () => {
  globalShortcut.unregisterAll();
  if (todoTimer) clearInterval(todoTimer);
  app.isQuitting = true;
});
