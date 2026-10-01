import { app, BrowserWindow, ipcMain, dialog, Notification, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { exec, spawn } from 'child_process';
import { mt, setMainLanguage, initMainLanguage } from './i18n';
import { checkCommand, CREDENTIAL_OR_RUNNER_CONFIG } from './commandPolicy';
import { WebError, searchWeb, fetchPage } from './web';
import { readOnlyGit } from './git';
import { Sandbox, IsolationOptions, IsolationReason, isSandboxSetupFailure, commandEnvironment } from './sandbox';

let mainWindow: BrowserWindow | null = null;

app.setName('Emir Code');
if (process.platform === 'win32') {
  app.setAppUserModelId('com.emircode.desktop');
} else if (process.platform === 'linux') {
  (app as any).setDesktopFileName?.('emir-code.desktop');
}

// Determine storage path in AppData
const userDataPath = app.getPath('userData');
const storageFilePath = path.join(userDataPath, 'emir_code_data.json');
const legacyStorageFilePath = path.join(userDataPath, 'local_llm_data.json');

/** The theme saved in the settings, so the window opens in its colors (dark unless light was chosen). */
function savedTheme(): 'light' | 'dark' {
  try {
    const data = JSON.parse(fs.readFileSync(storageFilePath, 'utf-8'));
    return data?.settings?.theme === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function createWindow() {
  const iconPng = path.join(__dirname, '../dist/icon.png');
  const iconIco = path.join(__dirname, '../build/icon.ico');
  const appIcon = fs.existsSync(iconPng) ? iconPng : (fs.existsSync(iconIco) ? iconIco : undefined);

  mainWindow = new BrowserWindow({
    title: 'Emir Code',
    icon: appIcon,
    width: 1160,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: savedTheme() === 'light' ? '#eef0f2' : '#121316',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Links (a chat answer, a page the agent built) open in the system browser, never in an app
  // window: only the app's own page gets the preload bridge, and only http/https leave the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const own = process.env.VITE_DEV_SERVER_URL
      ? url.startsWith(process.env.VITE_DEV_SERVER_URL)
      : url.startsWith('file://');
    if (own) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
  });

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximizeChanged', true);
  });

  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximizeChanged', false);
  });

  mainWindow.on('focus', () => {
    mainWindow?.flashFrame(false);
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

// Window control handlers
ipcMain.on('window:minimize', () => {
  mainWindow?.minimize();
});

ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow?.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.on('window:close', () => {
  mainWindow?.close();
});

ipcMain.handle('window:isMaximized', () => {
  return mainWindow?.isMaximized() ?? false;
});

ipcMain.handle('app:getLocale', () => {
  return app.getLocale();
});

// The interface tells the main process its language, so errors from here are in the same language.
ipcMain.on('app:setLanguage', (_event, language: unknown) => {
  setMainLanguage(language);
});

// Flash Window Frame (Windows Taskbar Yellow Blinking)
ipcMain.handle('window:flashFrame', (_event, flag: boolean = true) => {
  if (mainWindow && !mainWindow.isFocused()) {
    mainWindow.flashFrame(flag);
    return true;
  }
  return false;
});

// User Attention Notification & Window Flash
ipcMain.handle('app:notify', (_event, options: { title: string; body: string; flash?: boolean }) => {
  const iconPng = path.join(__dirname, '../dist/icon.png');
  const iconIco = path.join(__dirname, '../build/icon.ico');
  const appIcon = fs.existsSync(iconPng) ? iconPng : (fs.existsSync(iconIco) ? iconIco : undefined);

  if (options.flash !== false && mainWindow && !mainWindow.isFocused()) {
    mainWindow.flashFrame(true);
  }

  if (Notification.isSupported()) {
    try {
      const notification = new Notification({
        title: options.title || 'Emir Code',
        body: options.body || '',
        icon: appIcon,
      });

      notification.on('click', () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
          mainWindow.flashFrame(false);
        }
      });

      notification.show();
    } catch {
      // Ignore notification failures on systems without toast support
    }
  }

  return true;
});

// ============================================
// SYSTEM PREREQUISITES (Ollama, Node.js, npm)
// ============================================

async function checkOllamaStatus(): Promise<{ installed: boolean; running: boolean; path?: string; version?: string }> {
  let running = false;
  let installed = false;
  let version: string | undefined;
  let resolvedPath: string | undefined;

  // 1. Check if server is running on http://127.0.0.1:11434
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1200);
    const res = await fetch('http://127.0.0.1:11434/api/tags', { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      running = true;
      installed = true;
    }
  } catch {
    running = false;
  }

  // 2. Check executable paths on Windows & Linux
  if (process.platform === 'win32') {
    const localAppOllama = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe');
    const progFilesOllama = path.join(process.env.ProgramFiles || '', 'Ollama', 'ollama.exe');

    if (fs.existsSync(localAppOllama)) {
      installed = true;
      resolvedPath = localAppOllama;
    } else if (fs.existsSync(progFilesOllama)) {
      installed = true;
      resolvedPath = progFilesOllama;
    }
  } else if (process.platform === 'linux') {
    const linuxCandidates = [
      '/usr/local/bin/ollama',
      '/usr/bin/ollama',
      path.join(os.homedir(), '.local', 'bin', 'ollama'),
    ];
    for (const cand of linuxCandidates) {
      if (fs.existsSync(cand)) {
        installed = true;
        resolvedPath = cand;
        break;
      }
    }
  }

  // 3. If not found in known paths, check CLI via where/which
  if (!resolvedPath) {
    try {
      const whichCmd = process.platform === 'win32' ? 'where ollama' : 'which ollama';
      const stdout = await new Promise<string>((resolve, reject) => {
        exec(whichCmd, (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout.trim());
        });
      });
      if (stdout) {
        installed = true;
        resolvedPath = stdout.split('\n')[0].trim();
      }
    } catch {
      // not in PATH
    }
  }

  // 4. Try getting version
  if (installed) {
    try {
      const vOut = await new Promise<string>((resolve) => {
        const cmd = resolvedPath ? `"${resolvedPath}" --version` : 'ollama --version';
        exec(cmd, { timeout: 2000 }, (err, stdout) => {
          resolve(err ? '' : stdout.trim());
        });
      });
      if (vOut) {
        version = vOut.replace(/ollama version is/i, '').replace(/ollama/i, '').trim();
      }
    } catch {
      // ignore
    }
  }

  return { installed, running, path: resolvedPath, version };
}

async function checkNodeStatus(): Promise<{ installed: boolean; version?: string; satisfiesVersion: boolean }> {
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      exec('node -v', { timeout: 2000 }, (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout.trim());
      });
    });
    const ver = stdout.replace(/^v/, '');
    const major = parseInt(ver.split('.')[0], 10);
    return {
      installed: true,
      version: stdout,
      satisfiesVersion: !isNaN(major) && major >= 18,
    };
  } catch {
    return { installed: false, satisfiesVersion: false };
  }
}

async function checkNpmStatus(): Promise<{ installed: boolean; version?: string }> {
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      exec('npm -v', { timeout: 2000 }, (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout.trim());
      });
    });
    return { installed: true, version: stdout };
  } catch {
    return { installed: false };
  }
}

ipcMain.handle('system:checkPrerequisites', async () => {
  const [ollama, node, npm] = await Promise.all([
    checkOllamaStatus(),
    checkNodeStatus(),
    checkNpmStatus(),
  ]);
  return { ollama, node, npm };
});

ipcMain.handle('system:startOllama', async () => {
  const status = await checkOllamaStatus();
  if (status.running) return true;
  if (!status.installed) return false;

  // On Linux, try systemd service first if present
  if (process.platform === 'linux') {
    try {
      await new Promise<void>((resolve) => {
        exec('systemctl --user start ollama', { timeout: 2000 }, () => resolve());
      });
      const check = await checkOllamaStatus();
      if (check.running) return true;
    } catch {}
  }

  const ollamaCmd = status.path || 'ollama';
  try {
    const child = spawn(ollamaCmd, ['serve'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();

    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const s = await checkOllamaStatus();
      if (s.running) return true;
    }
    return false;
  } catch {
    return false;
  }
});

ipcMain.handle('system:installPrerequisite', async (_event, params: { target: 'ollama' | 'node' }) => {
  const { target } = params;

  // IMPORTANT: Idempotency check! Do NOT re-install if already installed!
  if (target === 'ollama') {
    const status = await checkOllamaStatus();
    if (status.installed) {
      if (!status.running) {
        // Try starting it if installed
        const startResult = await checkOllamaStatus();
        if (!startResult.running) {
          const ollamaCmd = status.path || 'ollama';
          try {
            const child = spawn(ollamaCmd, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true });
            child.unref();
          } catch {}
        }
      }
      return {
        success: true,
        alreadyInstalled: true,
        message: mt('ollamaAlreadyInstalled'),
      };
    }

    if (process.platform === 'linux') {
      try {
        const url = 'https://ollama.com/install.sh';
        const res = await fetch(url);
        if (!res.ok) throw new Error(mt('downloadFailedHttp', { status: res.status }));
        const script = await res.text();
        const installerPath = path.join(os.tmpdir(), 'ollama-install.sh');
        await fs.promises.writeFile(installerPath, script, { mode: 0o755 });

        // Launch installer script
        const child = spawn('sh', [installerPath], { detached: true, stdio: 'ignore' });
        child.unref();

        return {
          success: true,
          alreadyInstalled: false,
          message: mt('ollamaLinuxScriptStarted'),
        };
      } catch (err: any) {
        return {
          success: false,
          error: mt('ollamaDownloadFailedLinux', { error: err.message }),
        };
      }
    }

    // Windows Ollama installer
    try {
      const url = 'https://ollama.com/download/OllamaSetup.exe';
      const tempDir = os.tmpdir();
      const installerPath = path.join(tempDir, 'OllamaSetup.exe');

      const res = await fetch(url);
      if (!res.ok) throw new Error(mt('downloadFailedHttp', { status: res.status }));
      const arrayBuffer = await res.arrayBuffer();
      await fs.promises.writeFile(installerPath, Buffer.from(arrayBuffer));

      // Execute installer
      const child = spawn(installerPath, [], { detached: true, stdio: 'ignore' });
      child.unref();

      return {
        success: true,
        alreadyInstalled: false,
        message: mt('ollamaInstallerStarted'),
      };
    } catch (err: any) {
      return {
        success: false,
        error: mt('ollamaDownloadFailed', { error: err.message }),
      };
    }
  }

  if (target === 'node') {
    const nodeStatus = await checkNodeStatus();
    if (nodeStatus.installed && nodeStatus.satisfiesVersion) {
      return {
        success: true,
        alreadyInstalled: true,
        message: mt('nodeAlreadyInstalled', { version: nodeStatus.version || '' }),
      };
    }

    if (process.platform === 'linux') {
      return {
        success: true,
        alreadyInstalled: false,
        message: mt('nodeLinuxHint'),
      };
    }

    // Windows Node.js MSI installer
    try {
      const url = 'https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi';
      const tempDir = os.tmpdir();
      const installerPath = path.join(tempDir, 'node-v22-x64.msi');

      const res = await fetch(url);
      if (!res.ok) throw new Error(mt('downloadFailedHttp', { status: res.status }));
      const arrayBuffer = await res.arrayBuffer();
      await fs.promises.writeFile(installerPath, Buffer.from(arrayBuffer));

      // Execute MSI installer
      const child = spawn('msiexec', ['/i', installerPath], { detached: true, stdio: 'ignore' });
      child.unref();

      return {
        success: true,
        alreadyInstalled: false,
        message: mt('nodeInstallerStarted'),
      };
    } catch (err: any) {
      return {
        success: false,
        error: mt('nodeDownloadFailed', { error: err.message }),
      };
    }
  }

  return { success: false, error: mt('unknownInstallTarget') };
});

// Storage IPC
ipcMain.handle('storage:load', async () => {
  try {
    if (fs.existsSync(storageFilePath)) {
      return await fs.promises.readFile(storageFilePath, 'utf-8');
    } else if (fs.existsSync(legacyStorageFilePath)) {
      return await fs.promises.readFile(legacyStorageFilePath, 'utf-8');
    } else {
      const fallbackLegacy = process.platform === 'win32'
        ? path.join(process.env.APPDATA || '', 'local-llm-desktop', 'local_llm_data.json')
        : path.join(os.homedir(), '.config', 'local-llm-desktop', 'local_llm_data.json');
      if (fs.existsSync(fallbackLegacy)) {
        return await fs.promises.readFile(fallbackLegacy, 'utf-8');
      }
    }
  } catch (err) {
    console.error('Error reading storage file:', err);
  }
  return null;
});

ipcMain.handle('storage:save', async (_, dataJson: string) => {
  try {
    const tempPath = `${storageFilePath}.tmp`;
    await fs.promises.writeFile(tempPath, dataJson, 'utf-8');
    await fs.promises.rename(tempPath, storageFilePath);
    return true;
  } catch (err) {
    console.error('Error writing storage file:', err);
    return false;
  }
});

// File Dialog IPC
ipcMain.handle('dialog:saveFile', async (_, { title, defaultPath, filters, content }) => {
  if (!mainWindow) return { success: false };
  const res = await dialog.showSaveDialog(mainWindow, {
    title: title || 'Save File',
    defaultPath,
    filters,
  });

  if (!res.canceled && res.filePath) {
    try {
      await fs.promises.writeFile(res.filePath, content, 'utf-8');
      return { success: true, filePath: res.filePath };
    } catch (err) {
      console.error('Save file error:', err);
    }
  }
  return { success: false };
});

ipcMain.handle('dialog:openFile', async (_, { title, filters, multiSelections }) => {
  if (!mainWindow) return { success: false };
  const properties: ('openFile' | 'multiSelections')[] = ['openFile'];
  if (multiSelections) properties.push('multiSelections');

  const res = await dialog.showOpenDialog(mainWindow, {
    title: title || 'Open File',
    filters,
    properties,
  });

  if (!res.canceled && res.filePaths.length > 0) {
    try {
      const files = await Promise.all(
        res.filePaths.map(async (fp) => {
          const stats = await fs.promises.stat(fp);
          const isText = /\.(txt|md|json|csv|py|js|ts|tsx|jsx|html|css|yaml|yml|rs|go|c|cpp|h|java|sh|ps1)$/i.test(fp);
          let content = '';
          if (isText) {
            content = await fs.promises.readFile(fp, 'utf-8');
          } else {
            // Read as base64 for images
            const buffer = await fs.promises.readFile(fp);
            content = buffer.toString('base64');
          }
          return {
            name: path.basename(fp),
            path: fp,
            size: stats.size,
            content,
          };
        })
      );
      return { success: true, files };
    } catch (err) {
      console.error('Open file error:', err);
    }
  }
  return { success: false };
});

// Hardware Awareness IPC
ipcMain.handle('system:getHardware', async () => {
  const cpus = os.cpus();
  const totalBytes = os.totalmem();
  const availableBytes = os.freemem();

  let gpuModel = '';
  try {
    if (process.platform === 'win32') {
      gpuModel = await new Promise<string>((resolve) => {
        exec(
          'powershell -NoProfile -Command "(Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name)[0]"',
          { timeout: 3000 },
          (error, stdout) => {
            if (!error && stdout) {
              resolve(stdout.trim());
            } else {
              resolve('');
            }
          }
        );
      });
    } else if (process.platform === 'linux') {
      gpuModel = await new Promise<string>((resolve) => {
        exec("lspci | grep -iE 'vga|3d|display' | head -n 1 | sed 's/.*: //'", { timeout: 3000 }, (err, stdout) => {
          if (!err && stdout && stdout.trim()) {
            resolve(stdout.trim());
          } else {
            exec("nvidia-smi --query-gpu=gpu_name --format=csv,noheader | head -n 1", { timeout: 2000 }, (err2, stdout2) => {
              if (!err2 && stdout2 && stdout2.trim()) {
                resolve(stdout2.trim());
              } else {
                resolve('');
              }
            });
          }
        });
      });
    }
  } catch {
    gpuModel = '';
  }

  return {
    cpu: {
      model: cpus.length > 0 ? cpus[0].model.trim() : 'Unknown CPU',
      cores: cpus.length > 0 ? Math.floor(cpus.length / 2) || cpus.length : 1,
      logicalProcessors: cpus.length,
    },
    ram: {
      totalBytes,
      availableBytes,
      totalGb: Math.round((totalBytes / (1024 * 1024 * 1024)) * 10) / 10,
      availableGb: Math.round((availableBytes / (1024 * 1024 * 1024)) * 10) / 10,
    },
    gpu: gpuModel ? { model: gpuModel } : undefined,
  };
});

// ==========================================
// Emir Code: Enterprise Security & Workspace Jail
// ==========================================
let currentWorkspaceRoot: string | null = null;
let canonicalWorkspaceRoot: string | null = null;

// Cryptographic Token Registry
interface MutationTokenRecord {
  token: string;
  relativePath: string;
  operation: 'create' | 'edit' | 'delete';
  expectedBaseHash: string;
  proposedContentHash: string;
  createdAt: number;
  expiresAt: number; // 5 min TTL
  consumed: boolean;
}
const mutationTokens = new Map<string, MutationTokenRecord>();

// Transaction and Rollback Snapshots
interface FileSnapshot {
  transactionId: string;
  timestamp: number;
  relativePath: string;
  operation: 'create' | 'edit' | 'delete';
  baseHash: string;
  approvedHash: string;
  originalContent: string;
}
const fileSnapshots = new Map<string, FileSnapshot>();

function computeSha256(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf-8').digest('hex');
}

// Canonical Realpath & Symlink/Junction Escape Defense
async function isCanonicalPathSafe(relativePathOrAbsolute: string): Promise<{
  safe: boolean;
  fullPath: string;
  canonicalPath: string;
  relativePath: string;
  error?: string;
}> {
  if (!currentWorkspaceRoot || !canonicalWorkspaceRoot) {
    return { safe: false, fullPath: '', canonicalPath: '', relativePath: '', error: mt('noProjectOpen') };
  }

  const normalizedRoot = canonicalWorkspaceRoot;
  const resolvedTarget = path.isAbsolute(relativePathOrAbsolute)
    ? path.resolve(relativePathOrAbsolute)
    : path.resolve(normalizedRoot, relativePathOrAbsolute);

  let canonicalTarget = '';
  try {
    if (fs.existsSync(resolvedTarget)) {
      canonicalTarget = await fs.promises.realpath(resolvedTarget);
    } else {
      let parent = path.dirname(resolvedTarget);
      while (!fs.existsSync(parent) && parent !== path.dirname(parent)) {
        parent = path.dirname(parent);
      }
      const canonicalParent = await fs.promises.realpath(parent);
      if (canonicalParent !== normalizedRoot && !canonicalParent.startsWith(normalizedRoot + path.sep)) {
        return {
          safe: false,
          fullPath: resolvedTarget,
          canonicalPath: '',
          relativePath: '',
          error: mt('linkOutsideProject'),
        };
      }
      canonicalTarget = resolvedTarget;
    }
  } catch (err: any) {
    return { safe: false, fullPath: resolvedTarget, canonicalPath: '', relativePath: '', error: mt('pathCheckFailed', { error: err.message }) };
  }

  const isInside = canonicalTarget === normalizedRoot || canonicalTarget.startsWith(normalizedRoot + path.sep);
  if (!isInside) {
    return {
      safe: false,
      fullPath: resolvedTarget,
      canonicalPath: canonicalTarget,
      relativePath: '',
      error: mt('pathOutsideProject'),
    };
  }

  const relative = path.relative(normalizedRoot, resolvedTarget).replace(/\\/g, '/');
  return { safe: true, fullPath: resolvedTarget, canonicalPath: canonicalTarget, relativePath: relative };
}

// Granular Access Control List (ACL)
function evaluateAccessPolicy(relativePath: string, mode: 'read' | 'patch'): { allowed: boolean; reason?: string } {
  const normRel = relativePath.replace(/\\/g, '/').toLowerCase();
  const baseName = path.basename(normRel);

  // 1. .env files
  if (baseName.startsWith('.env')) {
    if (baseName === '.env.example' && mode === 'read') {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: mt('envBlocked'),
    };
  }

  // 2. .git directory
  if (normRel.split('/').includes('.git')) {
    return {
      allowed: false,
      reason: mt('gitDirBlocked'),
    };
  }

  // 3. node_modules, build & dist directories
  const blockedDirs = ['node_modules', 'dist', 'dist-electron', 'release', 'build', '.next', '.venv', '__pycache__'];
  if (normRel.split('/').some((part) => blockedDirs.includes(part))) {
    return {
      allowed: false,
      reason: mt('buildDirBlocked'),
    };
  }

  // 4. Sensitive keys and certificates
  if (/\.(pem|key|id_rsa|pfx|pkcs12)$/i.test(baseName)) {
    return {
      allowed: false,
      reason: mt('keyFileBlocked'),
    };
  }

  // 5. Package-manager and credential settings: they hold access tokens and can change what a
  // later command runs (an .npmrc "script-shell" turns "npm test" into any program).
  if (CREDENTIAL_OR_RUNNER_CONFIG.test(normRel)) {
    return { allowed: false, reason: mt('runnerConfigBlocked') };
  }

  return { allowed: true };
}

// Atomic File Mutator: Crash-Safe via Temporary File & Atomic Rename
async function atomicWriteFile(targetPath: string, content: string): Promise<void> {
  const dir = path.dirname(targetPath);
  await fs.promises.mkdir(dir, { recursive: true });
  const tempPath = path.join(dir, `.${path.basename(targetPath)}.tmp.${crypto.randomUUID()}`);
  await fs.promises.writeFile(tempPath, content, 'utf-8');
  await fs.promises.rename(tempPath, targetPath);
}

// Workspace Dialog & Status
ipcMain.handle('workspace:open', async () => {
  if (!mainWindow) return { success: false, error: mt('windowNotReady') };
  const res = await dialog.showOpenDialog(mainWindow, {
    title: mt('chooseFolderTitle'),
    properties: ['openDirectory'],
  });

  if (!res.canceled && res.filePaths.length > 0) {
    currentWorkspaceRoot = path.resolve(res.filePaths[0]);
    canonicalWorkspaceRoot = await fs.promises.realpath(currentWorkspaceRoot);
    return {
      success: true,
      rootPath: currentWorkspaceRoot,
      folderName: path.basename(currentWorkspaceRoot),
    };
  }
  return { success: false };
});

ipcMain.handle('workspace:status', async () => {
  return {
    hasActiveWorkspace: !!canonicalWorkspaceRoot,
    rootPath: canonicalWorkspaceRoot || undefined,
    folderName: canonicalWorkspaceRoot ? path.basename(canonicalWorkspaceRoot) : undefined,
  };
});

ipcMain.handle('workspace:setPath', async (_, targetPath: string) => {
  if (!targetPath || typeof targetPath !== 'string') {
    return { success: false, error: mt('invalidFolderPath') };
  }
  try {
    const resolved = path.resolve(targetPath);
    if (!fs.existsSync(resolved)) {
      return { success: false, error: mt('folderNotFound') };
    }
    const stat = await fs.promises.stat(resolved);
    if (!stat.isDirectory()) {
      return { success: false, error: mt('notAFolder') };
    }
    currentWorkspaceRoot = resolved;
    canonicalWorkspaceRoot = await fs.promises.realpath(resolved);
    return {
      success: true,
      rootPath: currentWorkspaceRoot,
      folderName: path.basename(currentWorkspaceRoot),
    };
  } catch (err: any) {
    return { success: false, error: err?.message || mt('folderOpenFailed') };
  }
});

// New projects: a fresh folder under a chosen location (Documents by default). The same name
// rules as src/lib/utils/projects.ts, checked again here because this side touches the disk.
const INVALID_PROJECT_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/;
const RESERVED_WINDOWS_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

function isUsableFolderName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 80 &&
    !INVALID_PROJECT_NAME_CHARS.test(name) &&
    name !== '.' &&
    name !== '..' &&
    !/[. ]$/.test(name) &&
    !RESERVED_WINDOWS_NAME.test(name)
  );
}

type ProjectTargetCheck =
  | { ok: true; target: string }
  | { ok: false; code: 'invalid-name' | 'invalid-location' | 'exists' | 'error'; error?: string };

/** Where the project folder would go; an existing folder is only reused when it is empty. */
async function inspectProjectTarget(parentDir: unknown, name: unknown): Promise<ProjectTargetCheck> {
  if (typeof parentDir !== 'string' || !parentDir.trim() || !path.isAbsolute(parentDir)) {
    return { ok: false, code: 'invalid-location' };
  }
  const cleanName = typeof name === 'string' ? name.trim() : '';
  if (!isUsableFolderName(cleanName)) return { ok: false, code: 'invalid-name' };

  const parent = path.resolve(parentDir);
  const target = path.join(parent, cleanName);
  if (path.dirname(target) !== parent) return { ok: false, code: 'invalid-name' };

  try {
    const parentStat = await fs.promises.stat(parent).catch(() => null);
    if (parentStat && !parentStat.isDirectory()) return { ok: false, code: 'invalid-location' };
    const existing = await fs.promises.stat(target).catch(() => null);
    if (!existing) return { ok: true, target };
    if (!existing.isDirectory()) return { ok: false, code: 'exists' };
    const entries = await fs.promises.readdir(target);
    return entries.length === 0 ? { ok: true, target } : { ok: false, code: 'exists' };
  } catch (err: any) {
    return { ok: false, code: 'error', error: err?.message };
  }
}

ipcMain.handle('project:defaultParent', (_, folderName: unknown) => {
  const name = typeof folderName === 'string' && isUsableFolderName(folderName.trim()) ? folderName.trim() : 'Emir Code Projects';
  return path.join(app.getPath('documents'), name);
});

ipcMain.handle('project:chooseParent', async (_, options?: { title?: string; defaultPath?: string }) => {
  if (!mainWindow) return { success: false };
  const wanted = typeof options?.defaultPath === 'string' ? options.defaultPath : '';
  const res = await dialog.showOpenDialog(mainWindow, {
    title: typeof options?.title === 'string' ? options.title : undefined,
    defaultPath: wanted && fs.existsSync(wanted) ? wanted : app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (res.canceled || res.filePaths.length === 0) return { success: false };
  return { success: true, path: path.resolve(res.filePaths[0]) };
});

ipcMain.handle('project:check', async (_, params?: { parentDir?: unknown; name?: unknown }) => {
  return inspectProjectTarget(params?.parentDir, params?.name);
});

ipcMain.handle('project:create', async (_, params?: { parentDir?: unknown; name?: unknown }) => {
  const check = await inspectProjectTarget(params?.parentDir, params?.name);
  if (!check.ok) return { success: false, code: check.code, error: check.error };
  try {
    await fs.promises.mkdir(check.target, { recursive: true });
    currentWorkspaceRoot = check.target;
    canonicalWorkspaceRoot = await fs.promises.realpath(check.target);
    return { success: true, rootPath: currentWorkspaceRoot, folderName: path.basename(currentWorkspaceRoot) };
  } catch (err: any) {
    return { success: false, code: 'error', error: err?.message || String(err) };
  }
});

// Which project folders of the sidebar still exist (moved or deleted ones are shown dimmed).
ipcMain.handle('workspace:pathsExist', async (_, paths: unknown) => {
  if (!Array.isArray(paths)) return [];
  return Promise.all(
    paths.slice(0, 500).map(async (p) => {
      if (typeof p !== 'string' || !path.isAbsolute(p)) return false;
      try {
        return (await fs.promises.stat(p)).isDirectory();
      } catch {
        return false;
      }
    })
  );
});

// Recursive safe file tree reader
async function scanDirectoryTree(dirPath: string, currentDepth: number, maxDepth: number): Promise<any[]> {
  if (currentDepth > maxDepth || !canonicalWorkspaceRoot) return [];

  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  const results: any[] = [];

  const ignoredNames = new Set([
    'node_modules',
    '.git',
    'dist',
    'dist-electron',
    'release',
    'build',
    '.next',
    '.venv',
    '__pycache__',
    '.turbo',
  ]);

  for (const entry of entries) {
    if (ignoredNames.has(entry.name)) continue;

    const fullEntryPath = path.join(dirPath, entry.name);
    const relPath = path.relative(canonicalWorkspaceRoot, fullEntryPath);
    const isDir = entry.isDirectory();

    if (isDir) {
      const children = await scanDirectoryTree(fullEntryPath, currentDepth + 1, maxDepth);
      results.push({
        name: entry.name,
        path: fullEntryPath,
        relativePath: relPath.replace(/\\/g, '/'),
        isDirectory: true,
        children,
      });
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      let size = 0;
      try {
        const s = await fs.promises.stat(fullEntryPath);
        size = s.size;
      } catch {}

      results.push({
        name: entry.name,
        path: fullEntryPath,
        relativePath: relPath.replace(/\\/g, '/'),
        isDirectory: false,
        size,
        extension: ext,
      });
    }
  }

  results.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });

  return results;
}

ipcMain.handle('workspace:listFiles', async (_, options?: { subPath?: string; maxDepth?: number }) => {
  if (!canonicalWorkspaceRoot) {
    return { success: false, error: mt('noProjectOpen') };
  }

  try {
    const targetDir = options?.subPath
      ? path.resolve(canonicalWorkspaceRoot, options.subPath)
      : canonicalWorkspaceRoot;

    const check = await isCanonicalPathSafe(targetDir);
    if (!check.safe) return { success: false, error: check.error };

    const files = await scanDirectoryTree(check.canonicalPath, 1, options?.maxDepth || 5);
    return { success: true, files };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// Safe Read File (With Hash & Symlink Realpath Check)
ipcMain.handle('workspace:readFile', async (_, relativePath: string) => {
  const check = await isCanonicalPathSafe(relativePath);
  if (!check.safe) return { success: false, error: check.error };

  const acl = evaluateAccessPolicy(check.relativePath, 'read');
  if (!acl.allowed) return { success: false, error: acl.reason };

  try {
    const stats = await fs.promises.stat(check.canonicalPath);
    if (stats.size > 2 * 1024 * 1024) {
      return { success: false, error: mt('fileTooLarge') };
    }

    const content = await fs.promises.readFile(check.canonicalPath, 'utf-8');
    const hash = computeSha256(content);
    return { success: true, content, hash };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// Code search for the agent's search_code tool (preload: searchWorkspaceCode). Case-insensitive text
// (or regex) search in the project's text files: skips the ignored folders, symbolic links, files the
// access policy hides, binaries and files over 1 MB; at most 200 matches.
const SEARCH_IGNORED = new Set(['node_modules', '.git', 'dist', 'dist-electron', 'release', 'build', '.next', '.venv', '__pycache__', '.turbo']);
ipcMain.handle('workspace:search', async (_, params: { query: string; options?: { isRegex?: boolean } }) => {
  const root = canonicalWorkspaceRoot;
  if (!root) return { success: false, error: mt('noProjectOpen') };
  const query = String(params?.query ?? '').trim();
  if (!query) return { success: false, error: mt('searchTextEmpty') };
  let matches: (line: string) => boolean;
  if (params?.options?.isRegex) {
    try {
      const re = new RegExp(query, 'i');
      matches = (line) => re.test(line);
    } catch (err: any) {
      return { success: false, error: mt('invalidRegex', { error: err.message }) };
    }
  } else {
    const needle = query.toLowerCase();
    matches = (line) => line.toLowerCase().includes(needle);
  }
  const MAX_MATCHES = 200;
  const MAX_FILES = 5000;
  const found: Array<{ relativePath: string; lineNumber: number; lineContent: string }> = [];
  let scanned = 0;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 8 || found.length >= MAX_MATCHES || scanned >= MAX_FILES) return;
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (found.length >= MAX_MATCHES || scanned >= MAX_FILES) return;
      if (SEARCH_IGNORED.has(entry.name) || entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = path.relative(root, full).replace(/\\/g, '/');
      if (!evaluateAccessPolicy(rel, 'read').allowed) continue;
      const stats = await fs.promises.stat(full);
      if (stats.size > 1024 * 1024) continue;
      scanned++;
      const buffer = await fs.promises.readFile(full);
      if (buffer.includes(0)) continue; // binary
      const lines = buffer.toString('utf8').split(/\r?\n/);
      for (let i = 0; i < lines.length && found.length < MAX_MATCHES; i++) {
        if (matches(lines[i])) found.push({ relativePath: rel, lineNumber: i + 1, lineContent: lines[i].slice(0, 400) });
      }
    }
  };
  try {
    await walk(root, 0);
    return { success: true, matches: found };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// User-Initiated Safe Directory Creator
ipcMain.handle('workspace:createDirectory', async (_, relativePath: string) => {
  if (!canonicalWorkspaceRoot) {
    return { success: false, error: mt('noProjectOpen') };
  }
  const check = await isCanonicalPathSafe(relativePath);
  if (!check.safe) return { success: false, error: check.error };

  const acl = evaluateAccessPolicy(check.relativePath, 'patch');
  if (!acl.allowed) return { success: false, error: acl.reason };

  try {
    await fs.promises.mkdir(check.fullPath, { recursive: true });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || mt('folderCreateFailed') };
  }
});

// User-Initiated Safe File / Directory Deletion
ipcMain.handle('workspace:deleteItem', async (_, relativePath: string) => {
  if (!canonicalWorkspaceRoot) {
    return { success: false, error: mt('noProjectOpen') };
  }
  const check = await isCanonicalPathSafe(relativePath);
  if (!check.safe) return { success: false, error: check.error };

  const acl = evaluateAccessPolicy(check.relativePath, 'patch');
  if (!acl.allowed) return { success: false, error: acl.reason };

  if (check.canonicalPath === canonicalWorkspaceRoot) {
    return { success: false, error: mt('rootCannotBeDeleted') };
  }

  try {
    const stats = await fs.promises.stat(check.canonicalPath);
    if (stats.isDirectory()) {
      await fs.promises.rm(check.canonicalPath, { recursive: true, force: true });
    } else {
      await fs.promises.unlink(check.canonicalPath);
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || mt('deleteFailed') };
  }
});

// Main Process Token Issuer: 256-Bit Cryptographic Single-Use Authorization Token
ipcMain.handle(
  'workspace:requestMutationToken',
  async (
    _,
    {
      relativePath,
      operation,
      expectedBaseHash,
      proposedContentHash,
      allowOverwrite,
    }: {
      relativePath: string;
      operation: 'create' | 'edit' | 'delete';
      expectedBaseHash: string;
      proposedContentHash: string;
      allowOverwrite?: boolean;
    }
  ) => {
    const check = await isCanonicalPathSafe(relativePath);
    if (!check.safe) return { success: false, error: check.error };

    const acl = evaluateAccessPolicy(check.relativePath, 'patch');
    if (!acl.allowed) return { success: false, error: acl.reason };

    // Validate current disk hash if file exists
    let diskHash = '';
    if (fs.existsSync(check.canonicalPath)) {
      const content = await fs.promises.readFile(check.canonicalPath, 'utf-8');
      diskHash = computeSha256(content);

      if (operation === 'edit' || operation === 'delete') {
        if (expectedBaseHash && diskHash !== expectedBaseHash) {
          return {
            success: false,
            conflict: true,
            currentHash: diskHash,
            expectedBaseHash,
            error: mt('changedSinceRead'),
          };
        }
      } else if (operation === 'create') {
        if (allowOverwrite) {
          // Explicit overwrite allowed by user or engine directive
          expectedBaseHash = diskHash;
        } else {
          return {
            success: false,
            conflict: true,
            error: mt('fileAlreadyExists', { path: relativePath }),
          };
        }
      }
    } else if (operation === 'edit' || operation === 'delete') {
      return {
        success: false,
        error: mt('targetMissing', { path: relativePath }),
      };
    }

    // Generate 256-bit cryptographically secure token
    const token = crypto.randomBytes(32).toString('hex');
    const record: MutationTokenRecord = {
      token,
      relativePath: check.relativePath,
      operation,
      expectedBaseHash: operation === 'create' && allowOverwrite && diskHash ? diskHash : (operation === 'create' ? '' : diskHash),
      proposedContentHash,
      createdAt: Date.now(),
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 minute TTL
      consumed: false,
    };

    mutationTokens.set(token, record);
    return {
      success: true,
      token,
      expiresAt: record.expiresAt,
      baseHash: diskHash,
      overwritten: operation === 'create' && Boolean(diskHash),
    };
  }
);

// Zero Direct Write: Apply Mutation with Main-Process Enforced Token & Atomic Rename
ipcMain.handle(
  'workspace:applyApprovedMutation',
  async (
    _,
    {
      token,
      relativePath,
      operation,
      newContent,
    }: {
      token: string;
      relativePath: string;
      operation: 'create' | 'edit' | 'delete';
      newContent?: string;
    }
  ) => {
    const record = mutationTokens.get(token);
    if (!record) {
      return { success: false, error: mt('tokenInvalid') };
    }

    if (record.consumed) {
      return { success: false, error: mt('tokenUsed') };
    }

    if (Date.now() > record.expiresAt) {
      mutationTokens.delete(token);
      return { success: false, error: mt('tokenExpired') };
    }

    const check = await isCanonicalPathSafe(relativePath);
    if (!check.safe) return { success: false, error: check.error };

    const normRecordRel = record.relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
    const normCheckRel = check.relativePath.replace(/\\/g, '/').replace(/^\.\//, '');

    if (normRecordRel !== normCheckRel || record.operation !== operation) {
      return { success: false, error: mt('tokenMismatch') };
    }

    try {
      let originalContent = '';
      let diskHash = '';

      if (fs.existsSync(check.canonicalPath)) {
        originalContent = await fs.promises.readFile(check.canonicalPath, 'utf-8');
        diskHash = computeSha256(originalContent);

        if (record.expectedBaseHash && diskHash !== record.expectedBaseHash) {
          return {
            success: false,
            conflict: true,
            currentHash: diskHash,
            expectedBaseHash: record.expectedBaseHash,
            error: mt('changedBeforeWrite'),
          };
        }
      }

      // Execute Operation Atomically
      let approvedHash = '';
      if (operation === 'create' || operation === 'edit') {
        const contentToWrite = newContent || '';
        approvedHash = computeSha256(contentToWrite);
        await atomicWriteFile(check.canonicalPath, contentToWrite);

        fileSnapshots.set(token, {
          transactionId: token,
          timestamp: Date.now(),
          relativePath: check.relativePath,
          operation,
          baseHash: diskHash,
          approvedHash,
          originalContent,
        });
      } else if (operation === 'delete') {
        fileSnapshots.set(token, {
          transactionId: token,
          timestamp: Date.now(),
          relativePath: check.relativePath,
          operation: 'delete',
          baseHash: diskHash,
          approvedHash: '',
          originalContent,
        });

        await fs.promises.unlink(check.canonicalPath);
      }

      // Mark token consumed immediately
      record.consumed = true;
      return { success: true, approvedHash, transactionId: token };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
);

// Programs the agent runs (run_command). commandPolicy.ts decides what may start; the program runs
// in the project folder with a reduced environment and a time limit, inside the isolated
// environment of sandbox.ts when the run asks for it and the system supports it.
type CommandResultCode = 'policy' | 'no_package_json' | 'timeout' | 'spawn_failed' | 'exit' | 'sandbox';
interface CommandResult {
  success: boolean;
  exitCode: number | null;
  output: string;
  error?: string;
  /** Why it failed, for the agent (the texts are translated, so it must not match on them). */
  code?: CommandResultCode;
  /** It ran in the isolated environment. */
  sandboxed?: boolean;
}

const MAX_COMMAND_OUTPUT = 2 * 1024 * 1024;

/** Stops a program and every program it started. */
function killProcessTree(child: ReturnType<typeof spawn>): void {
  if (!child.pid) {
    child.kill();
    return;
  }
  if (process.platform === 'win32') {
    exec(`taskkill /pid ${child.pid} /T /F`, () => {});
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // already gone
    }
  }
}

function runProcess(command: string, args: string[], options: { cwd: string; shell: boolean; timeoutMs: number; env: NodeJS.ProcessEnv }): Promise<CommandResult> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        windowsHide: true,
        shell: options.shell,
        // Its own process group on POSIX, so a timeout stops the programs it started too.
        detached: process.platform !== 'win32',
      });
    } catch (err: any) {
      resolve({ success: false, exitCode: null, output: '', error: mt('spawnFailed', { error: err?.message || String(err) }), code: 'spawn_failed' });
      return;
    }

    let output = '';
    let settled = false;
    const settle = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      killProcessTree(child);
      settle({
        success: false,
        exitCode: 124,
        output: `${output}\n${mt('commandTimedOut', { seconds: Math.round(options.timeoutMs / 1000) })}`.trim(),
        error: mt('timedOut'),
        code: 'timeout',
      });
    }, options.timeoutMs);

    const collect = (d: Buffer) => {
      if (output.length < MAX_COMMAND_OUTPUT) output += d.toString();
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    child.on('close', (code) => {
      settle({
        success: code === 0,
        exitCode: code ?? 0,
        output: output.trim(),
        error: code !== 0 ? mt('exitCode', { code: String(code) }) : undefined,
        code: code !== 0 ? 'exit' : undefined,
      });
    });
    child.on('error', (err) => {
      settle({ success: false, exitCode: null, output: '', error: mt('spawnFailed', { error: err.message }), code: 'spawn_failed' });
    });
  });
}

ipcMain.handle(
  'workspace:runApprovedCommand',
  async (
    _,
    { binary, args, timeoutMs = 60000, isolation }: { binary: string; args: string[]; timeoutMs?: number; isolation?: IsolationOptions }
  ): Promise<CommandResult> => {
    const root = canonicalWorkspaceRoot;
    if (!root) return { success: false, exitCode: 1, output: '', error: mt('noProjectOpen'), code: 'policy' };

    const cleanArgs = Array.isArray(args) ? args.map((a) => String(a)) : [];
    const check = checkCommand(String(binary || ''), cleanArgs, {
      hasPackageJson: fs.existsSync(path.join(root, 'package.json')),
      platform: process.platform,
    });
    if (!check.ok) {
      return {
        success: false,
        exitCode: 1,
        output: '',
        error: mt(check.key, check.params),
        code: check.code === 'no_package_json' ? 'no_package_json' : 'policy',
      };
    }

    const cleanBinary = String(binary).trim().toLowerCase();
    const limitMs = Math.min(Math.max(Number(timeoutMs) || 60000, 1000), 60000);
    // The isolated environment where it is available (sandbox.ts). npm on Windows runs through
    // cmd.exe as one command string (Node refuses to spawn .cmd files without a shell,
    // CVE-2024-27980); the policy has rejected every cmd metacharacter in its arguments.
    const plan = await sandbox.plan(cleanBinary, cleanArgs, root, isolationOptions(isolation));
    const result = await runProcess(plan.command, plan.args, {
      cwd: root,
      shell: plan.shell,
      timeoutMs: limitMs,
      env: { ...commandEnvironment(), ...(plan.env || {}) },
    });
    result.sandboxed = plan.isolated;
    if (plan.isolated && isSandboxSetupFailure(result.exitCode, result.output)) {
      const reason = result.output.split(/\r?\n/).find((l) => l.includes('emir-sandbox:'))?.replace(/^.*emir-sandbox:\s*/, '') || '';
      return { ...result, success: false, error: mt('sandboxUnavailable', { error: reason }), code: 'sandbox' };
    }
    return result;
  }
);

// ---------------------------------------------------------------------------
// Isolated environment of agent commands (sandbox.ts)
// ---------------------------------------------------------------------------
const sandbox = new Sandbox(app.isPackaged ? path.join(process.resourcesPath, 'sandbox') : path.join(app.getAppPath(), 'native', 'windows', 'bin'));

function isolationOptions(value: unknown): IsolationOptions {
  const v = (value || {}) as Partial<IsolationOptions>;
  return { enabled: v.enabled !== false, network: v.network === true };
}

const reasonText = (reason?: IsolationReason) => (reason ? mt(reason) : undefined);

ipcMain.handle('sandbox:status', async (_event, options: unknown) => {
  const status = await sandbox.status(isolationOptions(options));
  return {
    ...status,
    reasonText: reasonText(status.reason),
    python: status.python && { ...status.python, reasonText: reasonText(status.python.reason) },
    node: status.node && { ...status.node, reasonText: reasonText(status.node.reason) },
  };
});

ipcMain.handle('sandbox:plan', async (_event, { binary, args, options }: { binary: string; args: string[]; options?: unknown }) => {
  const root = canonicalWorkspaceRoot;
  if (!root) return { isolated: false, reasonText: mt('noProjectOpen') };
  const plan = await sandbox.plan(String(binary || '').trim().toLowerCase(), Array.isArray(args) ? args.map(String) : [], root, isolationOptions(options));
  return { isolated: plan.isolated, reason: plan.reason, reasonText: reasonText(plan.reason) };
});

ipcMain.handle('sandbox:allowPython', async () => {
  const res = await sandbox.allowPython();
  sandbox.reset();
  return res;
});

// Read-only git for the agent (git_status / git_diff); see git.ts for the settings it switches off.
ipcMain.handle('workspace:readGit', async (_, { action }: { action: 'status' | 'diff' | 'log' }) => {
  const root = canonicalWorkspaceRoot;
  if (!root) return { success: false, error: mt('noProjectOpen') };
  if (action !== 'status' && action !== 'diff' && action !== 'log') return { success: false, error: mt('invalidGitAction') };
  return readOnlyGit(action, root);
});

// Safe Transactional Rollback (Handles Create, Edit, and Delete with Hash Checks)
ipcMain.handle(
  'workspace:rollbackTransaction',
  async (_, { transactionId, force }: { transactionId: string; force?: boolean }) => {
    if (!canonicalWorkspaceRoot) return { success: false, error: mt('noProjectOpen') };

    const snapshot = fileSnapshots.get(transactionId);
    if (!snapshot) {
      return { success: false, error: mt('snapshotMissing') };
    }

    const check = await isCanonicalPathSafe(snapshot.relativePath);
    if (!check.safe) return { success: false, error: check.error };

    try {
      const exists = fs.existsSync(check.canonicalPath);
      let currentHash = '';
      if (exists) {
        const diskContent = await fs.promises.readFile(check.canonicalPath, 'utf-8');
        currentHash = computeSha256(diskContent);
      }

      if (snapshot.operation === 'create') {
        // Only delete newly created file if unmodified by user
        if (exists) {
          if (!force && currentHash !== snapshot.approvedHash) {
            return {
              success: false,
              conflict: true,
              error: mt('rollbackCreatedEdited'),
            };
          }
          await fs.promises.unlink(check.canonicalPath);
        }
      } else if (snapshot.operation === 'edit') {
        if (exists && !force && currentHash !== snapshot.approvedHash) {
          return {
            success: false,
            conflict: true,
            error: mt('rollbackChangedAgain'),
          };
        }
        await atomicWriteFile(check.canonicalPath, snapshot.originalContent);
      } else if (snapshot.operation === 'delete') {
        await atomicWriteFile(check.canonicalPath, snapshot.originalContent);
      }

      fileSnapshots.delete(transactionId);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
);

// ============================================
// Linux Desktop Integration & Platform IPC
// ============================================
ipcMain.handle('system:getPlatform', () => {
  return process.platform;
});

ipcMain.handle('system:isLinuxIntegrated', async () => {
  if (process.platform !== 'linux') return false;
  const menuDesktop = path.join(os.homedir(), '.local', 'share', 'applications', 'emir-code.desktop');
  return fs.existsSync(menuDesktop);
});

ipcMain.handle('system:integrateLinuxDesktop', async () => {
  if (process.platform !== 'linux') {
    return { success: false, error: mt('linuxOnly') };
  }

  try {
    const homeDir = os.homedir();
    const binaryPath = process.execPath;
    const appDir = path.dirname(binaryPath);
    // Start through the AppImage file itself (its /tmp/.mount_* folder disappears on exit) or
    // through the launcher script next to the binary (scripts/afterPack.js), which adds
    // --no-sandbox on systems where Chromium's sandbox cannot start.
    const launcher = binaryPath.endsWith('-bin') ? binaryPath.slice(0, -'-bin'.length) : binaryPath;
    const execPath = process.env.APPIMAGE || (fs.existsSync(launcher) ? launcher : binaryPath);

    // Icon: a file next to the binary, else the one bundled with the UI. Icons inside app.asar
    // or a temporary AppImage mount are copied out, since desktop files must point at a real file.
    const iconCandidates = [
      path.join(appDir, 'icon.png'),
      path.join(appDir, 'resources', 'icon.png'),
      path.join(__dirname, '../dist/icon.png'),
    ];
    let iconPath = iconCandidates.find((p) => fs.existsSync(p)) || 'emir-code';
    if (iconPath !== 'emir-code' && (process.env.APPIMAGE || iconPath.includes('.asar'))) {
      const iconDir = path.join(homeDir, '.local', 'share', 'icons');
      await fs.promises.mkdir(iconDir, { recursive: true });
      const persistentIcon = path.join(iconDir, 'emir-code.png');
      await fs.promises.writeFile(persistentIcon, await fs.promises.readFile(iconPath));
      iconPath = persistentIcon;
    }

    const desktopContent = `[Desktop Entry]
Name=Emir Code
GenericName=AI Native Coding Agent
Comment=AI Native Coding Agent Desktop Client
Exec="${execPath}" %U
Icon=${iconPath}
Terminal=false
Type=Application
Categories=Development;IDE;TextEditor;
StartupWMClass=Emir Code
MimeType=x-scheme-handler/emir-code;
Keywords=AI;Agent;Code;Ollama;Editor;IDE;
`;

    // 1. Menu entry
    const applicationsDir = path.join(homeDir, '.local', 'share', 'applications');
    await fs.promises.mkdir(applicationsDir, { recursive: true });
    const targetMenuFile = path.join(applicationsDir, 'emir-code.desktop');
    await fs.promises.writeFile(targetMenuFile, desktopContent, { mode: 0o755 });

    // 2. Desktop shortcut
    const desktopDirs = [path.join(homeDir, 'Desktop'), path.join(homeDir, 'Masaüstü')];
    for (const d of desktopDirs) {
      if (fs.existsSync(d)) {
        const desktopShortcut = path.join(d, 'Emir Code.desktop');
        await fs.promises.writeFile(desktopShortcut, desktopContent, { mode: 0o755 });
        exec(`gio set "${desktopShortcut}" "metadata::trusted" yes`, () => {});
      }
    }

    // 3. Command line symlink
    const localBinDir = path.join(homeDir, '.local', 'bin');
    await fs.promises.mkdir(localBinDir, { recursive: true });
    const symlinkTarget = path.join(localBinDir, 'emir-code');
    try {
      if (fs.existsSync(symlinkTarget)) {
        await fs.promises.unlink(symlinkTarget);
      }
      await fs.promises.symlink(execPath, symlinkTarget);
    } catch {}

    // 4. Update desktop database
    exec('update-desktop-database ~/.local/share/applications', () => {});

    return {
      success: true,
      message: mt('desktopIntegrationDone'),
    };
  } catch (err: any) {
    return { success: false, error: mt('desktopIntegrationFailed', { error: err.message }) };
  }
});

// ==========================================
// Web search and page reading (electron/web.ts)
// ==========================================
// Every request has an id: a run stops its own requests when it is stopped, and turning web access
// off stops all of them.
const activeWebRequests = new Map<string, AbortController>();

function webErrorText(err: unknown): string {
  if (err instanceof WebError) {
    const params = err.inner ? { ...err.params, reason: webErrorText(err.inner) } : err.params;
    return mt(err.key as Parameters<typeof mt>[0], params);
  }
  return String((err as any)?.message || err);
}

function trackWebRequest(requestId: unknown) {
  const id = typeof requestId === 'string' && requestId ? requestId : crypto.randomUUID();
  const controller = new AbortController();
  activeWebRequests.set(id, controller);
  return { signal: controller.signal, done: () => activeWebRequests.delete(id) };
}

ipcMain.handle('web:abort', async (_event, requestId: unknown) => {
  if (typeof requestId !== 'string') return false;
  activeWebRequests.get(requestId)?.abort();
  activeWebRequests.delete(requestId);
  return true;
});

ipcMain.handle('web:abortAll', async () => {
  for (const controller of activeWebRequests.values()) controller.abort();
  activeWebRequests.clear();
  return true;
});

ipcMain.handle(
  'web:search',
  async (_event, { query, options }: { query: string; options?: { limit?: number; timeoutMs?: number; requestId?: string } }) => {
    const request = trackWebRequest(options?.requestId);
    try {
      return await searchWeb(query, {
        limit: options?.limit,
        timeoutMs: options?.timeoutMs,
        signal: request.signal,
        untitled: mt('untitledResult'),
      });
    } catch (err) {
      throw new Error(webErrorText(err));
    } finally {
      request.done();
    }
  }
);

ipcMain.handle(
  'web:fetchUrl',
  async (_event, { url, options }: { url: string; options?: { maxBytes?: number; timeoutMs?: number; requestId?: string } }) => {
    const request = trackWebRequest(options?.requestId);
    try {
      return await fetchPage(url, {
        maxBytes: Math.min(Math.max(Number(options?.maxBytes) || 512 * 1024, 1024), 2 * 1024 * 1024),
        timeoutMs: options?.timeoutMs,
        signal: request.signal,
        untitled: mt('untitledPage'),
        truncatedNote: mt('contentTruncated'),
      });
    } catch (err) {
      throw new Error(webErrorText(err));
    } finally {
      request.done();
    }
  }
);

// ---------------------------------------------------------------------------
// Model library bridge: the Models window lists models from ollama.com and verifies a tag against
// the Ollama registry (the source `ollama pull` uses). Only these two hosts, fixed paths and
// validated names are reachable here; no user data is sent.
// ---------------------------------------------------------------------------
const LIBRARY_HOSTS = new Set(['ollama.com', 'registry.ollama.ai']);
const LIBRARY_MODEL_RE = /^[a-z0-9][a-z0-9._-]{0,79}(?:\/[a-z0-9][a-z0-9._-]{0,79})?$/;
const LIBRARY_TAG_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

async function fetchLibrarySource(url: string, accept: string, maxBytes: number): Promise<{ status: number; body: Buffer }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': `EmirCode/${app.getVersion()} (+https://github.com/daristanapeyvan/emircode)`, Accept: accept },
      redirect: 'follow',
      signal: controller.signal,
    });
    const host = new URL(res.url || url).hostname;
    if (!LIBRARY_HOSTS.has(host)) throw new Error(mt('unexpectedRedirect', { host }));
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length > maxBytes) throw new Error(mt('libraryTooLarge'));
    return { status: res.status, body };
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new Error(mt('libraryTimedOut'));
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

ipcMain.handle('models:library', async () => {
  const { status, body } = await fetchLibrarySource('https://ollama.com/library?sort=popular', 'text/html', 6 * 1024 * 1024);
  if (status !== 200) throw new Error(`ollama.com: HTTP ${status}`);
  return body.toString('utf8');
});

ipcMain.handle('models:tags', async (_event, name: string) => {
  if (typeof name !== 'string' || !LIBRARY_MODEL_RE.test(name) || name.includes('/')) throw new Error(mt('invalidModelName'));
  const { status, body } = await fetchLibrarySource(`https://ollama.com/library/${name}/tags`, 'text/html', 6 * 1024 * 1024);
  if (status === 404) return '';
  if (status !== 200) throw new Error(`ollama.com: HTTP ${status}`);
  return body.toString('utf8');
});

/** Whether a tag exists, its exact download size and its digest (sha256 of the manifest, as `ollama list` shows it). */
ipcMain.handle('models:manifest', async (_event, { name, tag }: { name: string; tag: string }) => {
  if (typeof name !== 'string' || typeof tag !== 'string' || !LIBRARY_MODEL_RE.test(name) || !LIBRARY_TAG_RE.test(tag)) {
    return { status: 'error', error: mt('invalidModelTag') };
  }
  try {
    const repo = name.includes('/') ? name : `library/${name}`;
    const { status, body } = await fetchLibrarySource(
      `https://registry.ollama.ai/v2/${repo}/manifests/${tag}`,
      'application/vnd.docker.distribution.manifest.v2+json',
      1024 * 1024
    );
    if (status === 404) return { status: 'missing' };
    if (status !== 200) return { status: 'error', error: `HTTP ${status}` };
    const manifest = JSON.parse(body.toString('utf8'));
    const bytes = (manifest.config?.size || 0) + (manifest.layers || []).reduce((sum: number, l: any) => sum + (Number(l.size) || 0), 0);
    return { status: 'found', digest: crypto.createHash('sha256').update(body).digest('hex'), bytes };
  } catch (err: any) {
    return { status: 'error', error: err?.message || String(err) };
  }
});

app.whenReady().then(() => {
  initMainLanguage(app.getLocale());
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
