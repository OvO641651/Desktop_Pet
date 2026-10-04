# 桌面宠物项目 - 长期约定与关键知识

## 用户约定（必须遵守）
- **每轮代码修改后，必须同步更新三份文档**（均位于 `E:\Desktop_Pet\docs\`）：
  1. `docs/桌面宠物系统技术方案.md` —— 更新功能设计、验收标准、版本记录
  2. `docs/桌面宠物修改文档.md` —— 按日期追加修改记录（格式参考用户桌面 pyside6.txt：时间 + 问题/任务 + 根因 + 解决方案 + 代码片段）
  3. `docs/桌面宠物功能说明.md` —— 面向用户的功能说明，**每新增一个功能都要更新**（记录各功能如何操作）

## 目录结构约定
- `docs/`：三份文档（技术方案、修改文档、功能说明）
- `assets/`：图片资源（默认宠物 deepseek.jpg + 预览截图）；main.js 的 DEFAULT_PET 指向 `assets/deepseek.jpg`
- 代码文件（main.js / preload.js / renderer/）在项目根目录

## 项目关键知识（跨会话必读）
- 启动需清空 `ELECTRON_RUN_AS_NODE`（WorkBuddy 环境全局设置为 1，否则 electron 被当纯 Node 跑）；本机需 `--disable-gpu` 启动参数（启动宠物.bat 已内置）。
- 拖拽用 JS 手动实现 + setBounds 锁尺寸；不用 -webkit-app-region。
- 抠图：渲染进程 Canvas 泛洪填充（白底判定用边缘占比 >=60%，不用四角采样）。只去白底，不识别主体。
- 验证 GUI：临时脚本 + webContents.capturePage() 截图；动画验证用 executeJavaScript 采样属性变化。CSS :hover 可用 `webContents.sendInputEvent({type:'mouseMove',x,y})` 验证。
- npm 装 electron 用镜像 ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
- 交互约定（v1.3/v1.4）：宠物下方无提示文字；右键不弹菜单；功能入口统一在「宠物右上角悬停出现的 ☰ 菜单按钮」。按钮/菜单相对 `#pet-wrap`（=宠物可视区 200×200）定位——**只有相对宠物本体定位，鼠标移向按钮时才不会脱离悬停区导致按钮消失**。
- 窗口尺寸策略（v1.4.3）：**窗口高度固定**（≈362 = 宠物200 + 下留白12 + 菜单预留150），宠物 `#pet-wrap` 用 `position:fixed`（left:50%+translateX(-50%)、bottom:12px）钉底；菜单用 absolute `bottom:calc(100%+6px)` 从宠物上方弹出。**不要用「动态改窗口高度」腾菜单空间**——setBounds 改高会让窗口内 flex 内容瞬时重排、宠物跟着闪（v1.4.2 之前踩的坑）。**窗口正常接收鼠标、不做 setIgnoreMouseEvents 穿透**——穿透会让 :hover 失效，破坏「悬停显示按钮」；「悬停显隐」与「鼠标穿透」在 Windows 上二选一，本项目选前者（按钮显隐由 CSS `#pet-wrap:hover .menu-btn` 控制）。

## 功能路线图（2026-10-03 与用户确认）
- P0 已完成：拖入图片即换、白底自动抠图（v1.1）
- P1 已完成：帧动画（命名 `前缀_序号` 序列轮播，GIF 原生）、交互反馈（点击弹跳 + 悬停反应，需区分单击/拖拽用位移阈值 6px）（v1.2）
- P2 已完成（v2.0）：气泡提醒（待办/消息，pet-todos.json + startTodoTimer 轮询 + pet:bubble 推送）、喂食心情养成（pet-state.json + 每分钟衰减 + feed/play）、打包 exe（electron-builder NSIS + portable）。**用户明确不需要开机自启**。
- P3 待做：AI 抠图增强（@imgly/background-removal）、心情等级/多表情/成就等养成深化

## 打包知识（v2.0）
- electron-builder 打包 Windows：`build` 字段配 `win.target = [nsis, portable]`，`npm run dist`。
- **必须配 `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`** 加速 NSIS/winCodeSign 下载，否则很慢/失败。
- 产物在 `dist/`：`桌面宠物 Setup x.x.x.exe`（安装包）+ `桌面宠物 x.x.x.exe`（portable 绿色版）。
- 图标 `build/icon.png`（256×256）；一键打包脚本 `打包.bat`。

## 关键坑（跨会话必读）
- **Electron 渲染进程禁用 `window.prompt()`/`alert()`/`confirm()`**（静默返回 null、不做任何事）。需要输入框/弹窗时必须自建 UI，或走主进程 `dialog`。本项目「添加待办」因此从 prompt 改为自建输入弹层（v2.0.1）。
- **菜单从窗口边缘弹出时会被顶边裁切**：菜单项增多（如 3→7 项）导致高度超过窗口预留空间（`MENU_RESERVE`），顶部项会跑出窗口。需同步加大预留高度，并给弹出菜单加 `max-height` + `overflow-y:auto` 兜底（v2.0.2）。
