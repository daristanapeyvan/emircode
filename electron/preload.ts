import { contextBridge, ipcRenderer } from 'electron';

export interface WorkspaceFileInfo {
  name: string;
  path: string;
  relativePath: string;
  isDirectory: boolean;
  size?: number;
  extension?: string;
  children?: WorkspaceFileInfo[];
}

export interface RunCommandResult {
  success: boolean;
  exitCode: number | null;
  output: string;
  error?: string;
  /** Why it failed; the error text is in the interface language, so code must not match on it. */
  code?: 'policy' | 'no_package_json' | 'timeout' | 'spawn_failed' | 'exit' | 'sandbox';
  /** True when the program ran in the isolated environment. */
  sandboxed?: boolean;
}

export interface IsolationSettings {
  enabled: boolean;
  network: boolean;
}

export interface InterpreterIsolation {
  path?: string;
  isolated: boolean;
  reason?: string;
  reasonText?: string;
}

export interface SandboxStatus {
  /** Commands run isolated now (supported and turned on in the settings). */
  active: boolean;
  /** The system supports it. */
  supported: boolean;
  /** How: 'appcontainer' (Windows), 'bubblewrap' (Linux) or 'none'. */
  method: 'appcontainer' | 'bubblewrap' | 'none';
  /** Why it is not active, when it is not (a key and its text in the interface language). */
  reason?: string;
  reasonText?: string;
  /** Windows: whether Python and Node can run isolated on this computer. */
  python?: InterpreterIsolation;
  node?: InterpreterIsolation;
  /** Windows: the separate account that isolates every command (set up once by an administrator). */
  full?: { configured: boolean; working: boolean; network: 'blocked' | 'open' | 'unknown'; error?: string };
}

export interface CommandIsolationPlan {
  /** Fully isolated: the user's files and, unless allowed, the network are out of reach. */
  isolated: boolean;
  /** `write`: it only cannot change anything outside the project. */
  level?: 'full' | 'write' | 'none';
  /** Something the user should know although the command is isolated (interface language). */
  warningText?: string;
  reason?: string;
  reasonText?: string;
}

export interface PrerequisiteStatus {
  ollama: {
    installed: boolean;
    running: boolean;
    path?: string;
    version?: string;
  };
  node: {
    installed: boolean;
    version?: string;
    satisfiesVersion: boolean;
  };
  npm: {
    installed: boolean;
    version?: string;
  };
}

export interface ElectronAPI {
  // Window controls
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  isMaximized: () => Promise<boolean>;
  onMaximizeChange: (callback: (isMaximized: boolean) => void) => () => void;
  flashFrame: (flag?: boolean) => Promise<boolean>;
  notifyUser: (options: { title: string; body: string; flash?: boolean }) => Promise<boolean>;

  // System Prerequisites & Installer
  checkPrerequisites: () => Promise<PrerequisiteStatus>;
  startOllamaService: () => Promise<boolean>;
  installPrerequisite: (target: 'ollama' | 'node') => Promise<{ success: boolean; alreadyInstalled?: boolean; message?: string; error?: string }>;

  // Native Dialogs & Files
  saveFileDialog: (options: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[]; content: string }) => Promise<{ success: boolean; filePath?: string }>;
  openFileDialog: (options: { title?: string; filters?: { name: string; extensions: string[] }[]; multiSelections?: boolean }) => Promise<{ success: boolean; files?: { name: string; path: string; size: number; content: string }[] }>;

  // Hardware Awareness
  getHardwareInfo: () => Promise<{
    cpu: { model: string; cores: number; logicalProcessors: number };
    ram: { totalBytes: number; availableBytes: number; totalGb: number; availableGb: number };
    gpu?: { model: string; vramMb?: number };
  }>;

  // Persistent File Storage (Safe Desktop Persistence)
  loadStorage: () => Promise<string | null>;
  saveStorage: (dataJson: string) => Promise<boolean>;
  getSystemLocale?: () => Promise<string>;
  getPlatform: () => Promise<'win32' | 'linux' | 'darwin'>;
  isLinuxIntegrated?: () => Promise<boolean>;
  integrateLinuxDesktop?: () => Promise<{ success: boolean; message?: string; error?: string }>;


  // Emir Code: Enterprise Workspace & Coding Agent Security Layer
  openWorkspaceDialog: () => Promise<{ success: boolean; rootPath?: string; folderName?: string; error?: string }>;
  setWorkspacePath: (targetPath: string) => Promise<{ success: boolean; rootPath?: string; folderName?: string; error?: string }>;
  getWorkspaceStatus: () => Promise<{ hasActiveWorkspace: boolean; rootPath?: string; folderName?: string }>;
  listWorkspaceFiles: (options?: { subPath?: string; maxDepth?: number }) => Promise<{ success: boolean; files?: WorkspaceFileInfo[]; error?: string }>;
  readWorkspaceFile: (relativePath: string) => Promise<{ success: boolean; content?: string; hash?: string; error?: string }>;
  searchWorkspaceCode: (query: string, options?: { isRegex?: boolean }) => Promise<{ success: boolean; matches?: { relativePath: string; lineNumber: number; lineContent: string }[]; error?: string }>;
  readGit: (action: 'status' | 'diff' | 'log') => Promise<{ success: boolean; output: string; error?: string }>;
  createWorkspaceDirectory: (relativePath: string) => Promise<{ success: boolean; error?: string }>;
  deleteWorkspaceItem: (relativePath: string) => Promise<{ success: boolean; error?: string }>;
  /** Whether each absolute path is an existing folder. */
  pathsExist?: (paths: string[]) => Promise<boolean[]>;

  // New projects (a fresh folder that becomes the workspace)
  getDefaultProjectParent?: (folderName: string) => Promise<string>;
  chooseProjectParent?: (options: { title?: string; defaultPath?: string }) => Promise<{ success: boolean; path?: string }>;
  checkProjectTarget?: (parentDir: string, name: string) => Promise<ProjectTargetCheck>;
  createProject?: (parentDir: string, name: string) => Promise<{ success: boolean; rootPath?: string; folderName?: string; code?: ProjectErrorCode; error?: string }>;

  // Zero Direct Write: Request token & apply with Main Process validation
  requestMutationToken: (params: {
    relativePath: string;
    operation: 'create' | 'edit' | 'delete';
    expectedBaseHash: string;
    proposedContentHash: string;
    allowOverwrite?: boolean;
  }) => Promise<{ success: boolean; token?: string; expiresAt?: number; baseHash?: string; conflict?: boolean; currentHash?: string; overwritten?: boolean; error?: string }>;

  applyApprovedMutation: (params: {
    token: string;
    relativePath: string;
    operation: 'create' | 'edit' | 'delete';
    newContent?: string;
  }) => Promise<{ success: boolean; approvedHash?: string; transactionId?: string; conflict?: boolean; currentHash?: string; error?: string }>;

  // Process Isolation: Structured command execution with sanitization and tree-kill
  runApprovedCommand: (params: {
    binary: string;
    args: string[];
    timeoutMs?: number;
    /** The user's isolation settings. */
    isolation?: IsolationSettings;
  }) => Promise<RunCommandResult>;

  // Transactional Hash-checked Rollback
  rollbackTransaction: (transactionId: string, force?: boolean) => Promise<{ success: boolean; conflict?: boolean; error?: string }>;

  // Emir Code: Zero-Trust Web Access & Search Bridge
  webSearch: (query: string, options?: { limit?: number; timeoutMs?: number; requestId?: string }) => Promise<Array<{ id: string; title: string; url: string; snippet: string; source: string }>>;
  webFetch: (url: string, options?: { maxBytes?: number; timeoutMs?: number; requestId?: string }) => Promise<{ title: string; url: string; content: string; status: number; sizeBytes: number; truncated?: boolean }>;
  webAbortAll?: () => Promise<boolean>;
  webAbort?: (requestId: string) => Promise<boolean>;
  setUiLanguage?: (language: 'tr' | 'en') => void;
  /** Whether agent commands run in the isolated environment, and why not when they do not. */
  getSandboxStatus?: (options: IsolationSettings) => Promise<SandboxStatus>;
  /** Whether this command would run isolated (asked before the approval). */
  planCommand?: (binary: string, args: string[], options: IsolationSettings) => Promise<CommandIsolationPlan>;
  /** Windows: lets isolated programs read the Python folder (an administrator prompt). */
  allowPythonIsolation?: () => Promise<{ ok: boolean; error?: string }>;
  /** Windows: sets up or removes the separate account of full isolation (an administrator prompt). */
  setupFullIsolation?: () => Promise<{ ok: boolean; error?: string }>;
  removeFullIsolation?: () => Promise<{ ok: boolean; error?: string }>;

  // Model library (ollama.com list and tags, registry verification)
  modelLibrary?: () => Promise<string>;
  modelTags?: (name: string) => Promise<string>;
  modelManifest?: (name: string, tag: string) => Promise<ModelManifestResult>;
}

export type ProjectErrorCode = 'invalid-name' | 'invalid-location' | 'exists' | 'error';

export type ProjectTargetCheck = { ok: true; target: string } | { ok: false; code: ProjectErrorCode; error?: string };

export interface ModelManifestResult {
  status: 'found' | 'missing' | 'error';
  /** sha256 of the manifest: the digest `ollama list` shows for the downloaded model. */
  digest?: string;
  /** Exact download size in bytes. */
  bytes?: number;
  error?: string;
}

const electronAPI: ElectronAPI = {
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onMaximizeChange: (callback) => {
    const handler = (_: any, isMax: boolean) => callback(isMax);
    ipcRenderer.on('window:maximizeChanged', handler);
    return () => ipcRenderer.removeListener('window:maximizeChanged', handler);
  },
  flashFrame: (flag = true) => ipcRenderer.invoke('window:flashFrame', flag),
  notifyUser: (options) => ipcRenderer.invoke('app:notify', options),

  // System Prerequisites & Installer
  checkPrerequisites: () => ipcRenderer.invoke('system:checkPrerequisites'),
  startOllamaService: () => ipcRenderer.invoke('system:startOllama'),
  installPrerequisite: (target: 'ollama' | 'node') => ipcRenderer.invoke('system:installPrerequisite', { target }),

  saveFileDialog: (options) => ipcRenderer.invoke('dialog:saveFile', options),
  openFileDialog: (options) => ipcRenderer.invoke('dialog:openFile', options),

  getHardwareInfo: () => ipcRenderer.invoke('system:getHardware'),

  loadStorage: () => ipcRenderer.invoke('storage:load'),
  saveStorage: (dataJson) => ipcRenderer.invoke('storage:save', dataJson),
  getSystemLocale: () => ipcRenderer.invoke('app:getLocale'),
  getPlatform: () => ipcRenderer.invoke('system:getPlatform'),
  isLinuxIntegrated: () => ipcRenderer.invoke('system:isLinuxIntegrated'),
  integrateLinuxDesktop: () => ipcRenderer.invoke('system:integrateLinuxDesktop'),


  // Emir Code Workspace Bridge
  openWorkspaceDialog: () => ipcRenderer.invoke('workspace:open'),
  setWorkspacePath: (targetPath) => ipcRenderer.invoke('workspace:setPath', targetPath),
  getWorkspaceStatus: () => ipcRenderer.invoke('workspace:status'),
  listWorkspaceFiles: (options) => ipcRenderer.invoke('workspace:listFiles', options),
  readWorkspaceFile: (relativePath) => ipcRenderer.invoke('workspace:readFile', relativePath),
  searchWorkspaceCode: (query, options) => ipcRenderer.invoke('workspace:search', { query, options }),
  readGit: (action) => ipcRenderer.invoke('workspace:readGit', { action }),
  createWorkspaceDirectory: (relativePath) => ipcRenderer.invoke('workspace:createDirectory', relativePath),
  deleteWorkspaceItem: (relativePath) => ipcRenderer.invoke('workspace:deleteItem', relativePath),
  pathsExist: (paths) => ipcRenderer.invoke('workspace:pathsExist', paths),
  getDefaultProjectParent: (folderName) => ipcRenderer.invoke('project:defaultParent', folderName),
  chooseProjectParent: (options) => ipcRenderer.invoke('project:chooseParent', options),
  checkProjectTarget: (parentDir, name) => ipcRenderer.invoke('project:check', { parentDir, name }),
  createProject: (parentDir, name) => ipcRenderer.invoke('project:create', { parentDir, name }),
  requestMutationToken: (params) => ipcRenderer.invoke('workspace:requestMutationToken', params),
  applyApprovedMutation: (params) => ipcRenderer.invoke('workspace:applyApprovedMutation', params),
  runApprovedCommand: (params) => ipcRenderer.invoke('workspace:runApprovedCommand', params),
  rollbackTransaction: (transactionId, force) => ipcRenderer.invoke('workspace:rollbackTransaction', { transactionId, force }),

  // Web Access Bridge
  webSearch: (query, options) => ipcRenderer.invoke('web:search', { query, options }),
  webFetch: (url, options) => ipcRenderer.invoke('web:fetchUrl', { url, options }),
  webAbortAll: () => ipcRenderer.invoke('web:abortAll'),
  webAbort: (requestId) => ipcRenderer.invoke('web:abort', requestId),
  setUiLanguage: (language) => ipcRenderer.send('app:setLanguage', language),
  getSandboxStatus: (options) => ipcRenderer.invoke('sandbox:status', options),
  planCommand: (binary, args, options) => ipcRenderer.invoke('sandbox:plan', { binary, args, options }),
  allowPythonIsolation: () => ipcRenderer.invoke('sandbox:allowPython'),
  setupFullIsolation: () => ipcRenderer.invoke('sandbox:setupFull'),
  removeFullIsolation: () => ipcRenderer.invoke('sandbox:removeFull'),

  // Model Library Bridge
  modelLibrary: () => ipcRenderer.invoke('models:library'),
  modelTags: (name) => ipcRenderer.invoke('models:tags', name),
  modelManifest: (name, tag) => ipcRenderer.invoke('models:manifest', { name, tag }),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
