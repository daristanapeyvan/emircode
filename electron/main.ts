import { app, BrowserWindow, ipcMain, dialog, Notification } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import dns from 'dns';
import { exec, spawn } from 'child_process';

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
    backgroundColor: '#121316',
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
        message: 'Ollama sisteminizde zaten kurulu olduğu için tekrar indirilmedi.',
      };
    }

    if (process.platform === 'linux') {
      try {
        const url = 'https://ollama.com/install.sh';
        const res = await fetch(url);
        if (!res.ok) throw new Error(`İndirme başarısız: HTTP ${res.status}`);
        const script = await res.text();
        const installerPath = path.join(os.tmpdir(), 'ollama-install.sh');
        await fs.promises.writeFile(installerPath, script, { mode: 0o755 });

        // Launch installer script
        const child = spawn('sh', [installerPath], { detached: true, stdio: 'ignore' });
        child.unref();

        return {
          success: true,
          alreadyInstalled: false,
          message: 'Ollama Linux kurulum betiği indirildi ve başlatıldı (alternatif: "curl -fsSL https://ollama.com/install.sh | sh").',
        };
      } catch (err: any) {
        return {
          success: false,
          error: `Ollama indirilemedi: ${err.message}. Lütfen terminalden "curl -fsSL https://ollama.com/install.sh | sh" komutunu çalıştırın.`,
        };
      }
    }

    // Windows Ollama installer
    try {
      const url = 'https://ollama.com/download/OllamaSetup.exe';
      const tempDir = os.tmpdir();
      const installerPath = path.join(tempDir, 'OllamaSetup.exe');

      const res = await fetch(url);
      if (!res.ok) throw new Error(`İndirme başarısız: HTTP ${res.status}`);
      const arrayBuffer = await res.arrayBuffer();
      await fs.promises.writeFile(installerPath, Buffer.from(arrayBuffer));

      // Execute installer
      const child = spawn(installerPath, [], { detached: true, stdio: 'ignore' });
      child.unref();

      return {
        success: true,
        alreadyInstalled: false,
        message: 'Ollama kurulum aracı resmi kaynaktan (ollama.com) indirildi ve başlatıldı.',
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Ollama indirilemedi: ${err.message}`,
      };
    }
  }

  if (target === 'node') {
    const nodeStatus = await checkNodeStatus();
    if (nodeStatus.installed && nodeStatus.satisfiesVersion) {
      return {
        success: true,
        alreadyInstalled: true,
        message: `Node.js (${nodeStatus.version}) sisteminizde zaten kurulu olduğu için tekrar indirilmedi.`,
      };
    }

    if (process.platform === 'linux') {
      return {
        success: true,
        alreadyInstalled: false,
        message: 'Linux sisteminizde Node.js kurmak için lütfen terminalden dağıtımınızın paket yöneticisini kullanın (ör: "sudo apt install -y nodejs npm" veya nvm).',
      };
    }

    // Windows Node.js MSI installer
    try {
      const url = 'https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi';
      const tempDir = os.tmpdir();
      const installerPath = path.join(tempDir, 'node-v22-x64.msi');

      const res = await fetch(url);
      if (!res.ok) throw new Error(`İndirme başarısız: HTTP ${res.status}`);
      const arrayBuffer = await res.arrayBuffer();
      await fs.promises.writeFile(installerPath, Buffer.from(arrayBuffer));

      // Execute MSI installer
      const child = spawn('msiexec', ['/i', installerPath], { detached: true, stdio: 'ignore' });
      child.unref();

      return {
        success: true,
        alreadyInstalled: false,
        message: 'Node.js resmi kaynaktan (nodejs.org) indirildi ve kurulum başlatıldı.',
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Node.js indirilemedi: ${err.message}`,
      };
    }
  }

  return { success: false, error: 'Bilinmeyen kurulum hedefi' };
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
    return { safe: false, fullPath: '', canonicalPath: '', relativePath: '', error: 'Aktif bir proje çalışma klasörü seçilmedi.' };
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
          error: 'Güvenlik İhlali: Hedef dizin bir Symlink veya Junction ile proje dışına yönlendirilmektedir.',
        };
      }
      canonicalTarget = resolvedTarget;
    }
  } catch (err: any) {
    return { safe: false, fullPath: resolvedTarget, canonicalPath: '', relativePath: '', error: `Yol doğrulama hatası: ${err.message}` };
  }

  const isInside = canonicalTarget === normalizedRoot || canonicalTarget.startsWith(normalizedRoot + path.sep);
  if (!isInside) {
    return {
      safe: false,
      fullPath: resolvedTarget,
      canonicalPath: canonicalTarget,
      relativePath: '',
      error: 'Güvenlik İhlali: Dosya veya symlink hedefi proje klasörü dışındadır (Symlink/Junction Kaçış Koruması).',
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
      reason: 'Güvenlik Politikası: Çevre değişkeni (.env) dosyalarına erişim güvenlik gerekçesiyle tamamen engellenmiştir.',
    };
  }

  // 2. .git directory
  if (normRel.split('/').includes('.git')) {
    return {
      allowed: false,
      reason: 'Güvenlik Politikası: .git dahili verilerine doğrudan dosya erişimi yasaktır. Lütfen readGitStatus veya readGitDiff kullanın.',
    };
  }

  // 3. node_modules, build & dist directories
  const blockedDirs = ['node_modules', 'dist', 'dist-electron', 'release', 'build', '.next', '.venv', '__pycache__'];
  if (normRel.split('/').some((part) => blockedDirs.includes(part))) {
    return {
      allowed: false,
      reason: 'Güvenlik Politikası: Bağımlılık ve derleme çıktı klasörlerine doğrudan erişim engellenmiştir.',
    };
  }

  // 4. Sensitive keys and certificates
  if (/\.(pem|key|id_rsa|pfx|pkcs12)$/i.test(baseName)) {
    return {
      allowed: false,
      reason: 'Güvenlik Politikası: Kriptografik anahtar ve sertifika dosyalarına erişim yasaktır.',
    };
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
  if (!mainWindow) return { success: false, error: 'Pencere hazır değil.' };
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Emir Code - Proje Klasörü Seçin',
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
    return { success: false, error: 'Geçersiz klasör yolu.' };
  }
  try {
    const resolved = path.resolve(targetPath);
    if (!fs.existsSync(resolved)) {
      return { success: false, error: 'Klasör bulunamadı.' };
    }
    const stat = await fs.promises.stat(resolved);
    if (!stat.isDirectory()) {
      return { success: false, error: 'Belirtilen yol bir klasör değil.' };
    }
    currentWorkspaceRoot = resolved;
    canonicalWorkspaceRoot = await fs.promises.realpath(resolved);
    return {
      success: true,
      rootPath: currentWorkspaceRoot,
      folderName: path.basename(currentWorkspaceRoot),
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Klasör açılamadı.' };
  }
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
    return { success: false, error: 'Henüz bir proje klasörü açılmadı.' };
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
      return { success: false, error: 'Dosya boyutu çok büyük (Maksimum 2MB okunabilir).' };
    }

    const content = await fs.promises.readFile(check.canonicalPath, 'utf-8');
    const hash = computeSha256(content);
    return { success: true, content, hash };
  } catch (err: any) {
    return { success: false, error: err.message };
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
            error:
              'Çakışma Tespiti: Dosya ajan tarafından okunduktan sonra dışarıdan değiştirilmiştir. Lütfen diffi güncel dosya ile yenileyin.',
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
            error: `Oluşturulmak istenen "${relativePath}" dosyası diskte zaten mevcut. Mevcut dosyayı değiştirmek için 'propose_edit' kullanın veya açıkça 'overwrite: true' belirtin.`,
          };
        }
      }
    } else if (operation === 'edit' || operation === 'delete') {
      return {
        success: false,
        error: `Hedef dosya (${relativePath}) diskte bulunamadı.`,
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
      return { success: false, error: 'Yetkilendirme Reddi: Geçersiz veya bulunamayan Transaction Token.' };
    }

    if (record.consumed) {
      return { success: false, error: 'Güvenlik İhlali: Bu işlem tokenı daha önce kullanılmıştır (Replay Saldırısı Engellendi).' };
    }

    if (Date.now() > record.expiresAt) {
      mutationTokens.delete(token);
      return { success: false, error: 'Zaman Aşımı: Transaction onay tokenının süresi dolmuştur (TTL: 5dk).' };
    }

    const check = await isCanonicalPathSafe(relativePath);
    if (!check.safe) return { success: false, error: check.error };

    const normRecordRel = record.relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
    const normCheckRel = check.relativePath.replace(/\\/g, '/').replace(/^\.\//, '');

    if (normRecordRel !== normCheckRel || record.operation !== operation) {
      return { success: false, error: 'Güvenlik İhlali: Token ile talep edilen dosya/eylem parametreleri eşleşmiyor.' };
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
            error: 'Çakışma Tespiti: Dosya onay anından hemen önce dışarıdan değiştirilmiştir. İşlem iptal edildi.',
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

// Read-Only Git Services (Rigid Args & Jail Directory)
ipcMain.handle('workspace:readGit', async (_, { action }: { action: 'status' | 'diff' | 'log' }) => {
  if (!canonicalWorkspaceRoot) {
    return { success: false, error: 'Aktif çalışma alanı yok.' };
  }

  let gitArgs: string[] = [];
  if (action === 'status') {
    gitArgs = ['status', '--porcelain=v1'];
  } else if (action === 'diff') {
    gitArgs = ['diff'];
  } else if (action === 'log') {
    gitArgs = ['log', '-n', '10', '--oneline'];
  } else {
    return { success: false, error: 'Geçersiz Git eylemi.' };
  }

  return new Promise((resolve) => {
    const child = spawn('git', gitArgs, {
      cwd: canonicalWorkspaceRoot!,
      windowsHide: true,
    });

    let output = '';
    let error = '';

    child.stdout.on('data', (d) => (output += d.toString()));
    child.stderr.on('data', (d) => (error += d.toString()));

    child.on('close', (code) => {
      resolve({
        success: code === 0,
        output: output.trim(),
        error: code !== 0 ? error.trim() : undefined,
      });
    });

    child.on('error', (err) => {
      resolve({ success: false, output: '', error: err.message });
    });
  });
});

// Safe Process Execution with Strict Environment Allowlist & Windows Tree Kill
ipcMain.handle(
  'workspace:runApprovedCommand',
  async (
    _,
    {
      binary,
      args,
      timeoutMs = 30000,
    }: {
      binary: string;
      args: string[];
      timeoutMs?: number;
    }
  ) => {
    if (!canonicalWorkspaceRoot) {
      return { success: false, exitCode: 1, output: '', error: 'Aktif proje klasörü yok.' };
    }

    const cleanBinary = binary.trim().toLowerCase();

    // 1. NPX IS STRICTLY FORBIDDEN
    if (cleanBinary === 'npx' || args.some((a) => a.toLowerCase().includes('npx'))) {
      return {
        success: false,
        exitCode: 1,
        output: '',
        error: 'Güvenlik Politikası: "npx" komutu paket indirme ve keyfi kod çalıştırma riski nedeniyle kesinlikle engellenmiştir.',
      };
    }

    // 2. Allowed Executable Whitelist
    const ALLOWED_BINARIES = new Set(['npm', 'cargo', 'pytest', 'python']);
    if (!ALLOWED_BINARIES.has(cleanBinary)) {
      return {
        success: false,
        exitCode: 1,
        output: '',
        error: `Güvenlik Politikası: "${cleanBinary}" yürütülebilir dosyasına izin verilmiyor.`,
      };
    }

    // 3. Strict Argument Validation (No Shell Injection characters)
    const dangerousPattern = /[;&|`$<>\r\n]/;
    for (const arg of args) {
      if (dangerousPattern.test(arg)) {
        return {
          success: false,
          exitCode: 1,
          output: '',
          error: `Güvenlik Koruması: Argümanda yasaklı yönlendirme/zincirleme karakterleri tespit edildi: "${arg}"`,
        };
      }
    }

    // 4. npm specific subcommand validation
    if (cleanBinary === 'npm') {
      const sub = (args[0] || '').toLowerCase();
      const validSubcommands = ['test', 'run'];
      if (!validSubcommands.includes(sub)) {
        return {
          success: false,
          exitCode: 1,
          output: '',
          error: `Güvenlik Politikası: npm altında sadece test ve tanımlı betikler çalıştırılabilir. Verilen: "${sub}"`,
        };
      }
      const pkgJsonPath = path.join(canonicalWorkspaceRoot, 'package.json');
      if (!fs.existsSync(pkgJsonPath)) {
        return {
          success: false,
          exitCode: 1,
          output: '',
          error: `Proje klasöründe "package.json" dosyası mevcut değil. npm komutları çalıştırılamaz.`,
        };
      }
      if (sub === 'run') {
        const scriptName = (args[1] || '').toLowerCase();
        const allowedScripts = ['test', 'build', 'lint', 'typecheck', 'check'];
        if (!allowedScripts.includes(scriptName)) {
          return {
            success: false,
            exitCode: 1,
            output: '',
            error: `Güvenlik Politikası: "npm run ${scriptName}" izin verilen betikler (test, build, lint, typecheck) arasında değil.`,
          };
        }
      }
    }

    // 5. Strict Environment ALLOWLIST (No host env leakage)
    const STRICT_ENV: NodeJS.ProcessEnv = {
      PATH: process.env.PATH || '',
      SystemRoot: process.env.SystemRoot || '',
      COMSPEC: process.env.COMSPEC || '',
      PATHEXT: process.env.PATHEXT || '',
      TEMP: process.env.TEMP || process.env.TMPDIR || '/tmp',
      TMP: process.env.TMP || process.env.TMPDIR || '/tmp',
      NODE_ENV: 'test',
      // POSIX / Linux essentials
      HOME: process.env.HOME || os.homedir() || '',
      USER: process.env.USER || '',
      SHELL: process.env.SHELL || '/bin/sh',
      LANG: process.env.LANG || 'C.UTF-8',
      LC_ALL: process.env.LC_ALL || '',
      XDG_DATA_HOME: process.env.XDG_DATA_HOME || '',
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME || '',
      XDG_CACHE_HOME: process.env.XDG_CACHE_HOME || '',
    };

    // 6. Spawn Process with Tree Kill & Timeout
    return new Promise((resolve) => {
      const child = spawn(cleanBinary, args, {
        cwd: canonicalWorkspaceRoot!,
        env: STRICT_ENV,
        windowsHide: true,
        shell: false,
      });

      let output = '';
      let isTimedOut = false;

      const timer = setTimeout(() => {
        isTimedOut = true;
        if (child.pid) {
          if (process.platform === 'win32') {
            exec(`taskkill /pid ${child.pid} /T /F`, () => {});
          } else {
            try {
              process.kill(-child.pid, 'SIGKILL');
            } catch {
              exec(`pkill -P ${child.pid} ; kill -9 ${child.pid}`, () => {});
            }
          }
        } else {
          child.kill();
        }
        resolve({
          success: false,
          exitCode: 124,
          output: output + '\n[ZAMAN AŞIMI]: Süreç belirlenen sınırı (30sn) aştığı için ağaç bazlı sonlandırıldı.',
          error: 'Zaman aşımı',
        });
      }, Math.min(timeoutMs, 60000));

      child.stdout.on('data', (d) => {
        if (output.length < 2 * 1024 * 1024) output += d.toString();
      });

      child.stderr.on('data', (d) => {
        if (output.length < 2 * 1024 * 1024) output += d.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (isTimedOut) return;
        resolve({
          success: code === 0,
          exitCode: code ?? 0,
          output: output.trim(),
          error: code !== 0 ? `İşlem hata kodu ${code} ile sonlandı.` : undefined,
        });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        if (isTimedOut) return;
        resolve({
          success: false,
          exitCode: 1,
          output: '',
          error: `Süreç başlatılamadı: ${err.message}`,
        });
      });
    });
  }
);

// Safe Transactional Rollback (Handles Create, Edit, and Delete with Hash Checks)
ipcMain.handle(
  'workspace:rollbackTransaction',
  async (_, { transactionId, force }: { transactionId: string; force?: boolean }) => {
    if (!canonicalWorkspaceRoot) return { success: false, error: 'Aktif çalışma alanı yok.' };

    const snapshot = fileSnapshots.get(transactionId);
    if (!snapshot) {
      return { success: false, error: `Belirtilen Transaction ID (${transactionId}) için snapshot bulunamadı.` };
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
              error: 'Çakışma: Ajan tarafından oluşturulan dosya kullanıcı tarafından düzenlenmiş. Veri kaybını önlemek için silinmedi.',
            };
          }
          await fs.promises.unlink(check.canonicalPath);
        }
      } else if (snapshot.operation === 'edit') {
        if (exists && !force && currentHash !== snapshot.approvedHash) {
          return {
            success: false,
            conflict: true,
            error: 'Çakışma: Ajanın değiştirdiği dosya sonradan tekrar değiştirilmiş. Kullanıcı kodunu korumak için geri alma durduruldu.',
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
    return { success: false, error: 'Bu işlem yalnızca Linux işletim sisteminde geçerlidir.' };
  }

  try {
    const execPath = process.execPath;
    const homeDir = os.homedir();
    const appDir = path.dirname(execPath);

    // Icon resolution
    let iconPath = path.join(appDir, 'icon.png');
    if (!fs.existsSync(iconPath)) {
      iconPath = path.join(appDir, 'resources', 'icon.png');
    }
    if (!fs.existsSync(iconPath)) {
      iconPath = 'emir-code';
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
StartupWMClass=emir-code
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
      message: 'Emir Code masaüstü kısayolu, uygulama menüsü ve terminal komutu (~/.local/bin/emir-code) başarıyla oluşturuldu!',
    };
  } catch (err: any) {
    return { success: false, error: `Masaüstü entegrasyonu başarısız: ${err.message}` };
  }
});

// ==========================================
// Emir Code: Zero-Trust Web Access & Search Bridge
// ==========================================
function isPrivateIpAddress(ip: string): boolean {
  if (!ip) return true;
  const clean = ip.trim().toLowerCase();
  if (clean === '::1' || clean === '::' || clean === '0:0:0:0:0:0:0:1') return true;
  if (clean.startsWith('::ffff:')) {
    return isPrivateIpAddress(clean.replace('::ffff:', ''));
  }
  if (clean.startsWith('fc') || clean.startsWith('fd') || clean.startsWith('fe80:')) return true;

  const parts = clean.split('.').map((p) => parseInt(p, 10));
  if (parts.length === 4 && parts.every((p) => !isNaN(p) && p >= 0 && p <= 255)) {
    const [a, b] = parts;
    if (a === 0 || a === 127 || a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  return false;
}

async function validateUrlForWebAccess(urlStr: string): Promise<{ valid: boolean; reason?: string; parsed?: URL; verifiedIps?: string[] }> {
  if (!urlStr || typeof urlStr !== 'string') {
    return { valid: false, reason: 'URL belirtilmedi.' };
  }
  let parsed: URL;
  try {
    parsed = new URL(urlStr.trim());
  } catch {
    return { valid: false, reason: 'Geçersiz URL formatı.' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, reason: `Yasaklı protokol: ${parsed.protocol}` };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '::1'
  ) {
    return { valid: false, reason: `SSRF Koruması: ${hostname} adresine erişim engellendi.` };
  }

  if (isPrivateIpAddress(hostname)) {
    return { valid: false, reason: `SSRF Koruması: Özel IP adresine erişim engellendi (${hostname}).` };
  }

  const verifiedIps: string[] = [];
  try {
    const lookups = await dns.promises.lookup(hostname, { all: true });
    if (!lookups || lookups.length === 0) {
      return { valid: false, reason: 'DNS çözümleme hatası: Kayıt bulunamadı.' };
    }
    for (const entry of lookups) {
      if (isPrivateIpAddress(entry.address)) {
        return { valid: false, reason: `SSRF Koruması: Alan adı özel IP'ye çözümlendi (${entry.address}).` };
      }
      verifiedIps.push(entry.address);
    }
  } catch (err: any) {
    return { valid: false, reason: `DNS çözümleme hatası: ${err.message}` };
  }

  return { valid: true, parsed, verifiedIps };
}

function cleanHtmlContent(html: string): { title: string; text: string } {
  let title = '';
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    title = titleMatch[1].replace(/<[^>]+>/g, '').trim();
  }

  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, ' ')
    .replace(/<h[1-2][^>]*>([\s\S]*?)<\/h[1-2]>/gi, '\n\n## $1\n\n')
    .replace(/<h[3-6][^>]*>([\s\S]*?)<\/h[3-6]>/gi, '\n\n### $1\n\n')
    .replace(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '\n```\n$1\n```\n')
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<p[^>]*>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n* ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();

  return { title: title || 'Belge', text };
}

// In-flight request tracking for instant cancellation from UI or settings
const activeWebControllers = new Set<AbortController>();

ipcMain.handle('web:abortAll', async () => {
  for (const c of activeWebControllers) {
    try {
      c.abort('Kullanıcı web erişimini durdurdu');
    } catch {}
  }
  activeWebControllers.clear();
  return true;
});

ipcMain.handle('web:search', async (_event, { query, options }: { query: string; options?: { limit?: number; timeoutMs?: number } }) => {
  const trimmed = (query || '').trim();
  if (!trimmed) {
    throw new Error('Arama sorgusu boş olamaz.');
  }

  const limit = Math.min(Math.max(options?.limit || 5, 1), 10);
  const timeoutMs = options?.timeoutMs || 10000;

  const controller = new AbortController();
  activeWebControllers.add(controller);
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch('https://lite.duckduckgo.com/lite/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      body: `q=${encodeURIComponent(trimmed)}`,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Arama servisi hatası: HTTP ${response.status}`);
    }

    const html = await response.text();

    const results: Array<{ id: string; title: string; url: string; snippet: string; source: string }> = [];
    const blockRegex =
      /<a[^>]+href=["']([^"']+)["'][^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>[\s\S]*?<td[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi;
    let match: RegExpExecArray | null;
    let counter = 1;

    while ((match = blockRegex.exec(html)) !== null && results.length < limit) {
      let rawUrl = match[1];
      if (rawUrl.includes('uddg=')) {
        try {
          const u = new URL(rawUrl, 'https://lite.duckduckgo.com');
          const uddg = u.searchParams.get('uddg');
          if (uddg) rawUrl = decodeURIComponent(uddg);
        } catch {}
      }

      const title = match[2].replace(/<[^>]+>/g, '').trim();
      const snippet = match[3].replace(/<[^>]+>/g, '').trim();

      const check = await validateUrlForWebAccess(rawUrl);
      if (!check.valid) continue;

      let source = '';
      try {
        source = new URL(rawUrl).hostname;
      } catch {}

      const sourceId = `web-${String(counter).padStart(3, '0')}`;
      counter++;

      results.push({
        id: sourceId,
        title: title || 'Arama Sonucu',
        url: rawUrl,
        snippet: snippet || '',
        source: source || 'web',
      });
    }

    return results;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error(`Web arama zaman aşımına uğradı veya kullanıcı tarafından durduruldu (${timeoutMs}ms).`);
    }
    throw new Error(`Arama başarısız: ${err.message}`);
  } finally {
    activeWebControllers.delete(controller);
  }
});

ipcMain.handle('web:fetchUrl', async (_event, { url, options }: { url: string; options?: { maxBytes?: number; timeoutMs?: number } }) => {
  const validation = await validateUrlForWebAccess(url);
  if (!validation.valid || !validation.parsed) {
    throw new Error(validation.reason || 'Geçersiz veya yasaklı URL.');
  }

  const maxBytes = options?.maxBytes || 512 * 1024;
  const timeoutMs = options?.timeoutMs || 10000;
  const MAX_REDIRECTS = 3;

  let currentUrl = validation.parsed.href;
  let redirectCount = 0;

  while (redirectCount <= MAX_REDIRECTS) {
    const controller = new AbortController();
    activeWebControllers.add(controller);
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(currentUrl, {
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 EmirCode/1.4',
          Accept: 'text/html,text/plain,application/xhtml+xml;q=0.9,*/*;q=0.8',
        },
        redirect: 'manual',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        redirectCount++;
        if (redirectCount > MAX_REDIRECTS) {
          throw new Error('Yönlendirme sınırı aşıldı.');
        }

        const location = response.headers.get('location');
        if (!location) throw new Error('Yönlendirme başlığı (Location) bulunamadı.');

        const nextUrl = new URL(location, currentUrl).href;
        const redirectCheck = await validateUrlForWebAccess(nextUrl);
        if (!redirectCheck.valid) {
          throw new Error(`Yönlendirme engellendi: ${redirectCheck.reason}`);
        }

        currentUrl = nextUrl;
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const buffer = await response.arrayBuffer();
      const bytes = Math.min(buffer.byteLength, maxBytes);
      const textDecoder = new TextDecoder('utf-8', { fatal: false });
      let rawText = textDecoder.decode(buffer.slice(0, bytes));
      if (buffer.byteLength > maxBytes) {
        rawText += '\n\n[İçerik boyutu sınırına ulaşıldığı için kalan kısım kırpıldı]';
      }

      const { title, text } = cleanHtmlContent(rawText);

      return {
        title,
        url: currentUrl,
        content: text,
        status: response.status,
        sizeBytes: buffer.byteLength,
      };
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw new Error(`Web isteği zaman aşımına uğradı veya kullanıcı tarafından durduruldu (${timeoutMs}ms).`);
      }
      throw err;
    } finally {
      activeWebControllers.delete(controller);
    }
  }

  throw new Error('Maksimum yönlendirme sınırına ulaşıldı.');
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
