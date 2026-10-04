const petContainer = document.getElementById('pet-container');
const petWrap = document.getElementById('pet-wrap');
const petImg = document.getElementById('pet-img');
const contextMenu = document.getElementById('context-menu');
const menuBtn = document.getElementById('menu-btn');
const bubble = document.getElementById('bubble');
const bubbleText = document.getElementById('bubble-text');
const bubbleClose = document.getElementById('bubble-close');
const emoBubble = document.getElementById('emo-bubble');
const emoBubbleText = document.getElementById('emo-bubble-text');
const statusPanel = document.getElementById('status-panel');
const satietyBar = document.getElementById('satiety-bar');
const moodBar = document.getElementById('mood-bar');
const feedBtn = document.getElementById('feed-btn');
const playBtn = document.getElementById('play-btn');
const statusClose = document.getElementById('status-close');
const todoPanel = document.getElementById('todo-panel');
const todoText = document.getElementById('todo-text');
const todoMinutes = document.getElementById('todo-minutes');
const todoOk = document.getElementById('todo-ok');
const todoCancel = document.getElementById('todo-cancel');

let currentPetPath = '';

// ---------- 帧动画轮播 ----------
let frameTimer = null;
let frameIndex = 0;
let frameDataUrls = [];

function stopFrameAnimation() {
  if (frameTimer) { clearInterval(frameTimer); frameTimer = null; }
  frameIndex = 0;
  frameDataUrls = [];
}

function startFrameAnimation(urls, delay) {
  stopFrameAnimation();
  frameDataUrls = urls.slice();
  frameIndex = 0;
  petImg.src = frameDataUrls[0];
  if (frameDataUrls.length > 1) {
    frameTimer = setInterval(() => {
      frameIndex = (frameIndex + 1) % frameDataUrls.length;
      petImg.src = frameDataUrls[frameIndex];
    }, delay);
  }
}

// ---------- 接收主进程发来的图片（单图 / GIF / 帧动画） ----------
window.petAPI.onPetImage(async (data) => {
  const { images = [], filePath = '', isGif = false, frameDelay = 180 } = data;
  currentPetPath = filePath;

  // GIF：原生动画，直接显示，不抠图、不轮播
  if (isGif) {
    stopFrameAnimation();
    petImg.src = images[0] || '';
    return;
  }

  // 逐帧抠白底（透明 PNG / 复杂背景原样保留），抠完再播帧动画
  const processed = await Promise.all(images.map((u) => autoRemoveBackground(u)));
  if (processed.length > 1) {
    startFrameAnimation(processed, frameDelay);
  } else {
    stopFrameAnimation();
    petImg.src = processed[0] || '';
  }
});

// ---------- 透明背景抠图（白底/浅色背景移除） ----------
// 用 Canvas 泛洪填充：从图像四条边上的白色像素开始 BFS 扩散，
// 把所有连通的「接近白色」背景区域标记为透明，边缘做一像素羽化。
// 无额外依赖，对白底动漫图效果良好；透明 PNG / 复杂背景则原样保留。
function removeWhiteBackground(sourceDataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      let imageData;
      try {
        imageData = ctx.getImageData(0, 0, w, h);
      } catch (e) {
        resolve(sourceDataUrl); // 读取失败，原样返回
        return;
      }
      const data = imageData.data;

      // 判定「接近白色」：R/G/B 均高于阈值
      const TH = 240;
      const isWhite = (i) => data[i] > TH && data[i + 1] > TH && data[i + 2] > TH;

      // 检测四条边白色像素占比，判断是否为白底图
      // （不用「四角全白」，因为角色内容可能延伸到某个角落，如 deepseek.jpg 右下角）
      let whiteCount = 0;
      let edgeTotal = 0;
      for (let x = 0; x < w; x++) { edgeTotal += 2; if (isWhite(x * 4)) whiteCount++; if (isWhite(((h - 1) * w + x) * 4)) whiteCount++; }
      for (let y = 0; y < h; y++) { edgeTotal += 2; if (isWhite(y * w * 4)) whiteCount++; if (isWhite((y * w + (w - 1)) * 4)) whiteCount++; }
      if (edgeTotal === 0 || whiteCount / edgeTotal < 0.6) {
        resolve(sourceDataUrl); // 边缘白色占比不足，判定非纯色白底图，跳过抠图
        return;
      }

      // 泛洪填充：从四条边收集白色种子，BFS 扩散
      const visited = new Uint8Array(w * h);
      const queue = [];
      const enqueue = (idx) => { if (!visited[idx] && isWhite(idx * 4)) { visited[idx] = 1; queue.push(idx); } };
      for (let x = 0; x < w; x++) { enqueue(x); enqueue((h - 1) * w + x); }
      for (let y = 0; y < h; y++) { enqueue(y * w); enqueue(y * w + (w - 1)); }

      let head = 0;
      while (head < queue.length) {
        const idx = queue[head++];
        const x = idx % w;
        if (x > 0) enqueue(idx - 1);
        if (x < w - 1) enqueue(idx + 1);
        if (idx >= w) enqueue(idx - w);
        if (idx < (h - 1) * w) enqueue(idx + w);
      }

      // 背景像素设为透明，边缘一像素羽化（背景像素若邻接非背景，半透明过渡）
      for (let i = 0; i < w * h; i++) {
        if (!visited[i]) continue;
        const x = i % w;
        const edge =
          (x > 0 && !visited[i - 1]) ||
          (x < w - 1 && !visited[i + 1]) ||
          (i >= w && !visited[i - w]) ||
          (i < (h - 1) * w && !visited[i + w]);
        data[i * 4 + 3] = edge ? 64 : 0;
      }

      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(sourceDataUrl);
    img.src = sourceDataUrl;
  });
}

// 自动抠图：若检测到白底则抠图，否则原样返回
async function autoRemoveBackground(dataUrl) {
  return await removeWhiteBackground(dataUrl);
}


// 屏蔽浏览器/系统默认右键菜单（右键不再弹出功能菜单）
window.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- 右上角菜单按钮（替代原右键菜单） ----------
// 鼠标悬停宠物时按钮淡入；点击按钮展开/收起功能菜单。
menuBtn.addEventListener('click', (e) => {
  e.stopPropagation(); // 阻止冒泡到 window，避免刚展开就被"点击外部关闭"关掉
  toggleMenu();
});

function toggleMenu() {
  if (contextMenu.classList.contains('hidden')) {
    contextMenu.classList.remove('hidden');
    petWrap.classList.add('menu-open');
  } else {
    hideMenu();
  }
}

function hideMenu() {
  contextMenu.classList.add('hidden');
  petWrap.classList.remove('menu-open');
}

// 说明：菜单按钮的显隐完全由 CSS `#pet-wrap:hover .menu-btn` 控制（悬停宠物才显示、移出隐藏）。
// 这里不再需要鼠标穿透切换——窗口正常接收鼠标，:hover 稳定可靠。

// 点击菜单项
contextMenu.addEventListener('click', async (e) => {
  const item = e.target.closest('.menu-item');
  if (!item) return;
  e.stopPropagation(); // 阻止冒泡到 window，避免刚打开的面板被全局「点击外部关闭」立即关掉
  const action = item.dataset.action;
  hideMenu();

  if (action === 'change') {
    await window.petAPI.changePet();
  } else if (action === 'top') {
    const newState = !window._alwaysOnTop;
    window._alwaysOnTop = newState;
    await window.petAPI.toggleAlwaysOnTop(newState);
    item.textContent = newState ? '📌 取消置顶' : '📌 置顶';
  } else if (action === 'todo') {
    showTodoPrompt();
  } else if (action === 'status') {
    toggleStatusPanel();
  } else if (action === 'quit') {
    await window.petAPI.quit();
  }
});

// 点击其他区域关闭菜单
// 点击其他区域关闭菜单/状态面板/待办面板
window.addEventListener('click', (e) => {
  hideMenu();
  // 点击状态面板或待办面板外部时关闭（点在面板内部则不关）
  if (statusPanel && !statusPanel.classList.contains('hidden')
      && e.target && e.target.closest && !e.target.closest('#status-panel')) {
    hideStatusPanel();
  }
  if (todoPanel && !todoPanel.classList.contains('hidden')
      && e.target && e.target.closest && !e.target.closest('#todo-panel')) {
    hideTodoPanel();
  }
});
window.addEventListener('blur', () => hideMenu());

// ---------- 拖拽移动（左键拖动，JS 手动实现） ----------
// 拖拽开始时记录起点，之后每次 mousemove 用「屏幕坐标 - 起点」算总增量，
// 由主进程用 setBounds 锁定宽高移动，避免高 DPI 下窗口越拖越大。
let dragging = false;
let startScreenX = 0;
let startScreenY = 0;

window.addEventListener('mousedown', (e) => {
  // 只响应左键（右键不再承载菜单）
  if (e.button !== 0) return;
  // 点在菜单按钮或功能菜单上时不触发拖拽
  if (e.target && e.target.closest && (e.target.closest('#context-menu') || e.target.closest('#menu-btn'))) return;
  // 仅在宠物区域内才可拖动（窗口上方为菜单预留的空白区不响应）
  const r = petWrap.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
  dragging = true;
  startScreenX = e.screenX;
  startScreenY = e.screenY;
  window.petAPI.dragStart();
});

window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const dx = e.screenX - startScreenX;
  const dy = e.screenY - startScreenY;
  window.petAPI.dragMove(dx, dy);
});

window.addEventListener('mouseup', (e) => {
  if (!dragging) return;
  const dx = e.screenX - startScreenX;
  const dy = e.screenY - startScreenY;
  const moved = Math.hypot(dx, dy);
  dragging = false;
  window.petAPI.dragEnd();
  // 位移小于阈值视为「点击」，触发弹跳互动（与拖拽区分开）
  if (moved < 6) {
    triggerBounce();
  }
});

// ---------- 交互反馈：点击弹跳 ----------
function triggerBounce() {
  petImg.classList.remove('bounce');
  void petImg.offsetWidth; // 强制重排，重新触发动画
  petImg.classList.add('bounce');
  petImg.addEventListener('animationend', function onEnd(e) {
    if (e.animationName === 'bounce') {
      petImg.classList.remove('bounce');
      petImg.removeEventListener('animationend', onEnd);
    }
  });
}

// ---------- 拖入图片即换 ----------
// 把本地图片文件直接拖到宠物身上即可更换宠物
let dragDepth = 0;
window.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  petImg.classList.add('drop-hover');
});
window.addEventListener('dragleave', (e) => {
  e.preventDefault();
  if (--dragDepth <= 0) {
    dragDepth = 0;
    petImg.classList.remove('drop-hover');
  }
});
window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragDepth++;
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  petImg.classList.remove('drop-hover');
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file) return;
  // 只处理图片文件
  if (!file.type.startsWith('image/')) {
    flashReject();
    return;
  }
  const path = window.petAPI.getPathForFile(file);
  if (path) {
    window.petAPI.dropFile(path);
  }
});

// 拖入非图片文件时的红色闪烁提示
function flashReject() {
  petImg.classList.add('drop-reject');
  setTimeout(() => petImg.classList.remove('drop-reject'), 600);
}

// ==================== P2：气泡提醒 ====================
let bubbleTimer = null;

// 显示气泡；duration 毫秒后自动隐藏（0 表示常驻，需手动关闭）
function showBubble(text, duration = 5000) {
  bubbleText.textContent = text;
  bubble.classList.remove('hidden');
  if (bubbleTimer) clearTimeout(bubbleTimer);
  if (duration > 0) {
    bubbleTimer = setTimeout(() => hideBubble(), duration);
  }
}

function hideBubble() {
  bubble.classList.add('hidden');
  if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = null; }
}

bubbleClose.addEventListener('click', (e) => {
  e.stopPropagation();
  hideBubble();
});

// ==================== 趣味气泡（喂食/玩耍反馈） ====================
// 两个小泡泡从宠物头顶冒出 → 一个大泡泡从宠物左侧延伸到头上方显示文字
let emoBubbleTimer = null;

function showEmoBubble(text, duration = 3200) {
  emoBubbleText.textContent = text;
  emoBubble.classList.remove('hidden');
  // 移除并重加 playing 类，强制重触发动画（先 remove + 强制重排）
  emoBubble.classList.remove('playing');
  void emoBubble.offsetWidth;
  emoBubble.classList.add('playing');
  if (emoBubbleTimer) clearTimeout(emoBubbleTimer);
  emoBubbleTimer = setTimeout(() => hideEmoBubble(), duration);
}

function hideEmoBubble() {
  emoBubble.classList.add('hidden');
  emoBubble.classList.remove('playing');
  if (emoBubbleTimer) { clearTimeout(emoBubbleTimer); emoBubbleTimer = null; }
}

// 接收主进程推送的到期待办提醒
window.petAPI.onBubble((data) => {
  showBubble(`⏰ 待办提醒：${data.text}`, 8000);
});

// ==================== P2：添加待办 ====================
// 说明：Electron 渲染进程里 window.prompt() 被禁用（会静默返回 null），
// 所以用自建的待办输入弹层替代原生 prompt。
function showTodoPrompt() {
  todoText.value = '';
  todoMinutes.value = '';
  todoPanel.classList.remove('hidden');
  todoText.focus();
}

function hideTodoPanel() {
  todoPanel.classList.add('hidden');
}

todoOk.addEventListener('click', async () => {
  const text = todoText.value.trim();
  if (!text) {
    showBubble('⚠️ 待办内容不能为空', 2000);
    return;
  }
  const minVal = todoMinutes.value.trim();
  let dueAt = null;
  let tip;
  if (minVal && !isNaN(Number(minVal)) && Number(minVal) >= 0) {
    const minutes = Number(minVal);
    dueAt = Date.now() + minutes * 60 * 1000;
    tip = minutes > 0 ? `${minutes} 分钟后提醒你～` : '马上提醒你～';
  } else {
    dueAt = Date.now(); // 留空/非法视为立即提醒
    tip = '马上提醒你～';
  }
  const res = await window.petAPI.todoAdd(text, dueAt);
  hideTodoPanel();
  if (res && res.ok) {
    showBubble(`📝 已添加待办，${tip}`, 3000);
  }
});

todoCancel.addEventListener('click', () => hideTodoPanel());

// 点「确定」按钮时阻止冒泡到 window（否则会触发全局 click 关闭菜单，但也无妨，这里已单独处理）
todoOk.addEventListener('click', (e) => e.stopPropagation());
todoCancel.addEventListener('click', (e) => e.stopPropagation());

// ==================== P2：喂食/心情养成 ====================
// 饱食度/心情随时间自然衰减：每分钟饱食度 -0.5、心情 -0.3（粗略模拟）。
// 衰减逻辑在渲染层按 lastUpdate 计算，定期回写主进程持久化。
const DECAY_INTERVAL_MS = 60 * 1000; // 每分钟衰减一次
const SATIETY_DECAY = 0.5;
const MOOD_DECAY = 0.3;

let cachedState = { satiety: 80, mood: 80, lastUpdate: Date.now() };

function refreshStatus(s) {
  if (s) cachedState = s;
  satietyBar.style.width = cachedState.satiety + '%';
  moodBar.style.width = cachedState.mood + '%';
}

function toggleStatusPanel() {
  if (statusPanel.classList.contains('hidden')) {
    refreshStatus(cachedState);
    statusPanel.classList.remove('hidden');
  } else {
    statusPanel.classList.add('hidden');
  }
}

function hideStatusPanel() {
  statusPanel.classList.add('hidden');
}

// 关闭按钮：点击隐藏状态面板
statusClose.addEventListener('click', (e) => {
  e.stopPropagation();
  hideStatusPanel();
});

function applyDecay() {
  const now = Date.now();
  const elapsedMin = (now - cachedState.lastUpdate) / DECAY_INTERVAL_MS;
  if (elapsedMin >= 1) {
    cachedState.satiety = Math.max(0, cachedState.satiety - SATIETY_DECAY * elapsedMin);
    cachedState.mood = Math.max(0, cachedState.mood - MOOD_DECAY * elapsedMin);
    cachedState.lastUpdate = now;
    refreshStatus(cachedState);
    // 回写主进程持久化
    window.petAPI.petStateUpdate(cachedState);
    // 心情过低时气泡提醒
    if (cachedState.satiety < 20 && !window._hungryWarned) {
      window._hungryWarned = true;
      showBubble('😿 好饿呀，给我喂点吃的吧～', 5000);
    }
    if (cachedState.mood < 20 && !window._sadWarned) {
      window._sadWarned = true;
      showBubble('😔 好无聊，陪我玩一会儿吧～', 5000);
    }
  }
}

// 状态面板里的喂食/玩耍按钮
feedBtn.addEventListener('click', async (e) => {
  e.stopPropagation();
  const s = await window.petAPI.petStateFeed();
  window._hungryWarned = false;
  refreshStatus(s);
  showEmoBubble('🍖 吃饱啦！');
});

playBtn.addEventListener('click', async (e) => {
  e.stopPropagation();
  const s = await window.petAPI.petStatePlay();
  window._sadWarned = false;
  triggerBounce();
  refreshStatus(s);
  showEmoBubble('🎾 好开心！');
});

// 初始化：拉取持久化的宠物状态，并启动衰减定时器
async function initPetState() {
  try {
    cachedState = await window.petAPI.petStateGet();
    refreshStatus(cachedState);
  } catch (e) {
    refreshStatus(cachedState);
  }
  setInterval(applyDecay, DECAY_INTERVAL_MS);
}

initPetState();
