/**
 * Maestro — Electron main process.
 *
 * Owns the orchestrator (the "master" brain), bridges it to the UI over IPC,
 * and starts the local master API so external tools (Luna, scripts, MCP
 * clients) can drive the fleet too.
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let win = null;
let maestro = null;
let apiHandle = null;

async function bootOrchestrator() {
  const core = await import('@maestro/core');
  maestro = new core.Maestro(process.cwd());
  await maestro.refreshHealth();
  apiHandle = core.startMasterApi(maestro, 4317);

  maestro.onEvent((entry, mission) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('maestro:timeline', { missionId: mission.id, entry });
    }
  });
  console.log('[maestro] orchestrator ready');
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 900,
    minHeight: 620,
    title: 'Maestro',
    backgroundColor: '#0e1116',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.MAESTRO_DEV) {
    win.loadURL('http://127.0.0.1:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  win.on('closed', () => (win = null));
}

app.whenReady().then(async () => {
  await bootOrchestrator();

  ipcMain.handle('maestro:snapshot', () => maestro.snapshot());
  ipcMain.handle('maestro:submit', (_evt, opts) => maestro.submitMission(opts));
  ipcMain.handle('maestro:cancel', (_evt, id) => ({ cancelled: maestro.cancelMission(id) }));
  ipcMain.handle('maestro:recover', (_evt, id) => {
    maestro.recoverAgent(id);
    return { recovered: true };
  });
  ipcMain.handle('maestro:refresh-health', async () => {
    await maestro.refreshHealth();
    return maestro.snapshot().agents;
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  try {
    apiHandle && apiHandle.close();
  } catch {}
});
