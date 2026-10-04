const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  changePet: () => ipcRenderer.invoke('pet:change'),
  toggleAlwaysOnTop: (checked) => ipcRenderer.invoke('pet:toggle-always-on-top', checked),
  quit: () => ipcRenderer.invoke('pet:quit'),
  dragStart: () => ipcRenderer.send('pet:drag-start'),
  dragMove: (dx, dy) => ipcRenderer.send('pet:drag-move', { dx, dy }),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  // 拖入文件：拿到 File 对象对应的本地绝对路径（Electron 31 官方做法）
  getPathForFile: (file) => webUtils.getPathForFile(file),
  dropFile: (path) => ipcRenderer.send('pet:drop-file', path),
  onPetImage: (callback) => ipcRenderer.on('pet-image', (event, data) => callback(data)),
  // P2：气泡提醒（接收主进程推送的到期提醒）
  onBubble: (callback) => ipcRenderer.on('pet:bubble', (event, data) => callback(data)),
  // P2：待办
  todoList: () => ipcRenderer.invoke('todo:list'),
  todoAdd: (text, dueAt) => ipcRenderer.invoke('todo:add', { text, dueAt }),
  todoToggle: (id) => ipcRenderer.invoke('todo:toggle', id),
  todoRemove: (id) => ipcRenderer.invoke('todo:remove', id),
  // P2：宠物状态（喂食/心情养成）
  petStateGet: () => ipcRenderer.invoke('pet-state:get'),
  petStateUpdate: (s) => ipcRenderer.invoke('pet-state:update', s),
  petStateFeed: () => ipcRenderer.invoke('pet-state:feed'),
  petStatePlay: () => ipcRenderer.invoke('pet-state:play')
});
