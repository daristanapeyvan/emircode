import React, { useState } from 'react';
import { WorkspaceFileInfo } from '../../../electron/preload';
import { ChevronRight, ChevronDown, Trash2, FolderPlus, Folder, FolderOpen, File } from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';
import { getTranslations, Translations } from '@/lib/localization/i18n';
import { cn } from '@/lib/utils/cn';

interface FileTreeProps {
  files: WorkspaceFileInfo[];
  onSelectFile: (path: string) => void;
  selectedFilePath?: string;
  onDeleteFile?: (relativePath: string, isDirectory: boolean) => void;
  onCreateFolder?: (parentPath: string) => void;
}

interface TreeNodeProps {
  item: WorkspaceFileInfo;
  depth?: number;
  onSelectFile: (path: string) => void;
  selectedFilePath?: string;
  onDeleteFile?: (relativePath: string, isDirectory: boolean) => void;
  onCreateFolder?: (parentPath: string) => void;
  t: Translations['agent'];
}

const rowAction = 'p-0.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700/60 transition-colors cursor-pointer';

const TreeNode: React.FC<TreeNodeProps> = ({ item, depth = 0, onSelectFile, selectedFilePath, onDeleteFile, onCreateFolder, t }) => {
  const [isOpen, setIsOpen] = useState(depth === 0);

  if (item.isDirectory) {
    return (
      <div>
        <div
          onClick={() => setIsOpen(!isOpen)}
          className="group flex items-center gap-1 py-1 px-2 text-xs text-zinc-300 hover:bg-zinc-800/60 rounded cursor-pointer select-none transition-colors"
          style={{ paddingLeft: `${depth * 12 + 6}px` }}
        >
          {isOpen ? <ChevronDown size={12} className="text-zinc-500 shrink-0" /> : <ChevronRight size={12} className="text-zinc-500 shrink-0" />}
          {isOpen ? <FolderOpen size={13} strokeWidth={1.5} className="text-zinc-500 shrink-0" /> : <Folder size={13} strokeWidth={1.5} className="text-zinc-500 shrink-0" />}
          <span className="truncate flex-1">{item.name}</span>

          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            {onCreateFolder && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCreateFolder(item.relativePath);
                }}
                className={rowAction}
                title={t.newSubfolder}
                aria-label={t.newSubfolder}
              >
                <FolderPlus size={12} />
              </button>
            )}
            {onDeleteFile && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteFile(item.relativePath, true);
                }}
                className={cn(rowAction, 'hover:text-red-400')}
                title={t.deleteFolder}
                aria-label={t.deleteFolder}
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        </div>

        {isOpen && item.children && (
          <div>
            {item.children.map((child) => (
              <TreeNode
                key={child.relativePath}
                item={child}
                depth={depth + 1}
                onSelectFile={onSelectFile}
                selectedFilePath={selectedFilePath}
                onDeleteFile={onDeleteFile}
                onCreateFolder={onCreateFolder}
                t={t}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const isSelected = selectedFilePath === item.relativePath;

  return (
    <div
      onClick={() => onSelectFile(item.relativePath)}
      className={cn(
        'group flex items-center gap-1 py-1 px-2 text-xs rounded cursor-pointer select-none transition-colors',
        isSelected ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
      )}
      style={{ paddingLeft: `${depth * 12 + 22}px` }}
    >
      <File size={13} strokeWidth={1.5} className="text-zinc-500 shrink-0" />
      <span className="truncate flex-1">{item.name}</span>

      {onDeleteFile && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDeleteFile(item.relativePath, false);
          }}
          className={cn(rowAction, 'opacity-0 group-hover:opacity-100 hover:text-red-400 shrink-0')}
          title={t.deleteFile}
          aria-label={t.deleteFile}
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
};

export const FileTree: React.FC<FileTreeProps> = ({ files, onSelectFile, selectedFilePath, onDeleteFile, onCreateFolder }) => {
  const language = useSettingsStore((s) => s.settings.language);
  const t = getTranslations(language).agent;

  if (files.length === 0) {
    return <div className="p-4 text-center text-xs text-zinc-500">{t.emptyFolder}</div>;
  }

  return (
    <div className="py-1">
      {files.map((item) => (
        <TreeNode
          key={item.relativePath}
          item={item}
          onSelectFile={onSelectFile}
          selectedFilePath={selectedFilePath}
          onDeleteFile={onDeleteFile}
          onCreateFolder={onCreateFolder}
          t={t}
        />
      ))}
    </div>
  );
};
