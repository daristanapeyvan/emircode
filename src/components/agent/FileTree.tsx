import React, { useState } from 'react';
import { WorkspaceFileInfo } from '../../../electron/preload';
import { ChevronRight, ChevronDown, FileCode, Folder, FolderOpen, FileText } from 'lucide-react';

interface FileTreeProps {
  files: WorkspaceFileInfo[];
  onSelectFile: (path: string) => void;
  selectedFilePath?: string;
}

interface TreeNodeProps {
  item: WorkspaceFileInfo;
  depth?: number;
  onSelectFile: (path: string) => void;
  selectedFilePath?: string;
}

const TreeNode: React.FC<TreeNodeProps> = ({ item, depth = 0, onSelectFile, selectedFilePath }) => {
  const [isOpen, setIsOpen] = useState(depth === 0);

  if (item.isDirectory) {
    return (
      <div>
        <div
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-1.5 py-1 px-2 text-xs text-zinc-300 hover:bg-zinc-800/60 hover:text-white rounded cursor-pointer select-none transition-colors"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {isOpen ? <ChevronDown size={12} className="text-zinc-500" /> : <ChevronRight size={12} className="text-zinc-500" />}
          {isOpen ? <FolderOpen size={14} className="text-amber-400/90" /> : <Folder size={14} className="text-amber-400/70" />}
          <span className="truncate font-mono">{item.name}</span>
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
      className={`flex items-center gap-1.5 py-1 px-2 text-xs rounded cursor-pointer select-none transition-colors ${
        isSelected
          ? 'bg-blue-600/20 text-blue-300 font-medium'
          : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
      }`}
      style={{ paddingLeft: `${depth * 12 + 20}px` }}
    >
      {item.name.endsWith('.ts') || item.name.endsWith('.tsx') || item.name.endsWith('.js') ? (
        <FileCode size={13} className="text-blue-400/80 shrink-0" />
      ) : (
        <FileText size={13} className="text-zinc-400 shrink-0" />
      )}
      <span className="truncate font-mono">{item.name}</span>
    </div>
  );
};

export const FileTree: React.FC<FileTreeProps> = ({ files, onSelectFile, selectedFilePath }) => {
  if (files.length === 0) {
    return (
      <div className="p-4 text-center text-xs text-zinc-500">
        Bu klasörde görüntülenebilecek dosya bulunamadı.
      </div>
    );
  }

  return (
    <div className="py-1 overflow-y-auto max-h-full scrollbar-thin">
      {files.map((item) => (
        <TreeNode
          key={item.relativePath}
          item={item}
          onSelectFile={onSelectFile}
          selectedFilePath={selectedFilePath}
        />
      ))}
    </div>
  );
};
