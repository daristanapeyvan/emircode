import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { exec, spawn } from 'child_process';

let mainWindow: BrowserWindow | null = null;

app.setName('Emir Code');
if (process.platform === 'win32') {
  app.setAppUserModelId('com.emircode.desktop');
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

// Storage IPC
ipcMain.handle('storage:load', async () => {
  try {
    if (fs.existsSync(storageFilePath)) {
      return await fs.promises.readFile(storageFilePath, 'utf-8');
    } else if (fs.existsSync(legacyStorageFilePath)) {
      return await fs.promises.readFile(legacyStorageFilePath, 'utf-8');
    } else {
      const fallbackLegacy = path.join(process.env.APPDATA || '', 'local-llm-desktop', 'local_llm_data.json');
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

  const relative = path.relative(normalizedRoot, resolvedTarget);
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
    }: {
      relativePath: string;
      operation: 'create' | 'edit' | 'delete';
      expectedBaseHash: string;
      proposedContentHash: string;
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
        return {
          success: false,
          conflict: true,
          error: `Oluşturulmak istenen "${relativePath}" dosyası diskte zaten mevcut.`,
        };
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
      expectedBaseHash: diskHash,
      proposedContentHash,
      createdAt: Date.now(),
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 minute TTL
      consumed: false,
    };

    mutationTokens.set(token, record);
    return { success: true, token, expiresAt: record.expiresAt, baseHash: diskHash };
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

    if (record.relativePath !== relativePath || record.operation !== operation) {
      return { success: false, error: 'Güvenlik İhlali: Token ile talep edilen dosya/eylem parametreleri eşleşmiyor.' };
    }

    const check = await isCanonicalPathSafe(relativePath);
    if (!check.safe) return { success: false, error: check.error };

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
      TEMP: process.env.TEMP || '',
      TMP: process.env.TMP || '',
      NODE_ENV: 'test',
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
          exec(`taskkill /pid ${child.pid} /T /F`, () => {});
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

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
