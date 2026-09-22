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

  // Emir Code: Enterprise Workspace & Coding Agent Security Layer
  openWorkspaceDialog: () => Promise<{ success: boolean; rootPath?: string; folderName?: string; error?: string }>;
  setWorkspacePath: (targetPath: string) => Promise<{ success: boolean; rootPath?: string; folderName?: string; error?: string }>;
  getWorkspaceStatus: () => Promise<{ hasActiveWorkspace: boolean; rootPath?: string; folderName?: string }>;
  listWorkspaceFiles: (options?: { subPath?: string; maxDepth?: number }) => Promise<{ success: boolean; files?: WorkspaceFileInfo[]; error?: string }>;
  readWorkspaceFile: (relativePath: string) => Promise<{ success: boolean; content?: string; hash?: string; error?: string }>;
  searchWorkspaceCode: (query: string, options?: { isRegex?: boolean }) => Promise<{ success: boolean; matches?: { relativePath: string; lineNumber: number; lineContent: string }[]; error?: string }>;
  readGit: (action: 'status' | 'diff' | 'log') => Promise<{ success: boolean; output: string; error?: string }>;
  
  // Zero Direct Write: Request token & apply with Main Process validation
  requestMutationToken: (params: {
    relativePath: string;
    operation: 'create' | 'edit' | 'delete';
    expectedBaseHash: string;
    proposedContentHash: string;
  }) => Promise<{ success: boolean; token?: string; expiresAt?: number; baseHash?: string; conflict?: boolean; currentHash?: string; error?: string }>;

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
  }) => Promise<RunCommandResult>;

  // Transactional Hash-checked Rollback
  rollbackTransaction: (transactionId: string, force?: boolean) => Promise<{ success: boolean; conflict?: boolean; error?: string }>;
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

  // Emir Code Workspace Bridge
  openWorkspaceDialog: () => ipcRenderer.invoke('workspace:open'),
  setWorkspacePath: (targetPath) => ipcRenderer.invoke('workspace:setPath', targetPath),
  getWorkspaceStatus: () => ipcRenderer.invoke('workspace:status'),
  listWorkspaceFiles: (options) => ipcRenderer.invoke('workspace:listFiles', options),
  readWorkspaceFile: (relativePath) => ipcRenderer.invoke('workspace:readFile', relativePath),
  searchWorkspaceCode: (query, options) => ipcRenderer.invoke('workspace:search', { query, options }),
  readGit: (action) => ipcRenderer.invoke('workspace:readGit', { action }),
  requestMutationToken: (params) => ipcRenderer.invoke('workspace:requestMutationToken', params),
  applyApprovedMutation: (params) => ipcRenderer.invoke('workspace:applyApprovedMutation', params),
  runApprovedCommand: (params) => ipcRenderer.invoke('workspace:runApprovedCommand', params),
  rollbackTransaction: (transactionId, force) => ipcRenderer.invoke('workspace:rollbackTransaction', { transactionId, force }),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
