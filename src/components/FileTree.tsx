import { useState, useCallback, useMemo, useEffect } from "react";
import { useAppStore } from "@/store/appStore";
import {
  listFiles,
  readFile,
  createFile,
  createFolder,
  renameFile,
  deleteFile,
  togglePin,
  copyFilePath,
  revealInFolder,
  searchWorkspace,
  moveFile,
} from "@/lib/tauri-bridge";
import type { FileNode } from "@/lib/tauri-bridge";
import {
  ChevronRight,
  ChevronDown,
  FileText,
  Folder,
  FolderOpen,
  Pin,
  Search,
  Plus,
  Pencil,
  Trash2,
  Copy,
  ExternalLink,
  ArrowRight,
  X,
} from "lucide-react";

interface SearchSets {
  visible: Set<string>;
  expanded: Set<string>;
}

interface FileTreeItemProps {
  node: FileNode;
  depth: number;
  activeFilePath: string | null;
  selectedPath: string | null;
  openFolders: string[];
  isRenaming: string | null;
  renameValue: string;
  contextMenuPath: string | null;
  contextMenuPos: { left: number; top: number } | null;
  onToggleFolder: (path: string) => void;
  onSelectFile: (path: string, name: string) => void;
  onSelect: (path: string) => void;
  onPin: (path: string) => void;
  onRename: (path: string, newName: string) => void;
  onDelete: (path: string, isFolder: boolean) => void;
  onStartRename: (path: string, name: string) => void;
  onCancelRename: () => void;
  onSetRenameValue: (val: string) => void;
  onContextMenu: (node: FileNode, rect: DOMRect) => void;
  onMoveClick: (node: FileNode) => void;
  searchSets: SearchSets | null;
}

function FileTreeItem({
  node,
  depth,
  activeFilePath,
  selectedPath,
  openFolders,
  isRenaming,
  renameValue,
  contextMenuPath,
  contextMenuPos,
  onToggleFolder,
  onSelectFile,
  onSelect,
  onPin,
  onRename,
  onDelete,
  onStartRename,
  onCancelRename,
  onSetRenameValue,
  onContextMenu,
  onMoveClick,
  searchSets,
}: FileTreeItemProps) {
  const isActive = node.node_type === "file" && node.path === activeFilePath;
  const isSelected = node.path === selectedPath;
  const isOpen =
    node.node_type === "folder" &&
    (openFolders.includes(node.path) || (searchSets?.expanded.has(node.path) ?? false));
  const isEditing = isRenaming === node.path;
  const menuOpen = contextMenuPath === node.path;

  if (searchSets && !searchSets.visible.has(node.path)) return null;

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isSelected) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    onContextMenu(node, rect);
  };

  return (
    <div>
      <div
        className="flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition-colors duration-150 relative group"
        style={{
          paddingLeft: `${12 + depth * 14}px`,
          background: isActive
            ? "rgba(0, 134, 115, 0.08)"
            : isSelected
            ? "var(--surface-2)"
            : "transparent",
          borderLeft: isActive
            ? "2px solid var(--accent-teal)"
            : isSelected
            ? "2px solid var(--text-tertiary)"
            : "2px solid transparent",
        }}
        onClick={() => {
          onSelect(node.path);
          if (node.node_type === "folder") {
            onToggleFolder(node.path);
          } else {
            onSelectFile(node.path, node.name);
          }
        }}
        onContextMenu={handleContextMenu}
      >
        {node.node_type === "folder" && (
          <span style={{ color: "var(--text-tertiary)" }}>
            {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
        )}

        {node.node_type === "folder" ? (
          isOpen ? (
            <FolderOpen size={14} style={{ color: "var(--text-secondary)" }} />
          ) : (
            <Folder size={14} style={{ color: "var(--text-tertiary)" }} />
          )
        ) : (
          <FileText size={13} style={{ color: "var(--text-tertiary)" }} />
        )}

        {isEditing ? (
          <input
            autoFocus
            className="flex-1 text-sm bg-transparent outline-none border rounded px-1"
            style={{
              color: "var(--text-primary)",
              borderColor: "var(--accent-teal)",
            }}
            value={renameValue}
            onChange={(e) => onSetRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onRename(node.path, renameValue);
              } else if (e.key === "Escape") {
                onCancelRename();
              }
            }}
            onBlur={() => onCancelRename()}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="text-sm truncate flex-1"
            style={{
              color: isActive ? "var(--accent-teal)" : "var(--text-secondary)",
              fontWeight: isActive ? 500 : 400,
            }}
          >
            {node.name}
          </span>
        )}

        {node.is_pinned && !isEditing && (
          <Pin size={11} style={{ color: "var(--accent-teal)" }} />
        )}

        {node.modified_at && !isEditing && (
          <span
            className="text-[10px] shrink-0 opacity-0 group-hover:opacity-60 transition-opacity"
            style={{ color: "var(--text-tertiary)" }}
          >
            {node.modified_at}
          </span>
        )}
      </div>

      {/* Context Menu — singleton, only renders when this node is active */}
      {menuOpen && contextMenuPos && (
        <div
          className="fixed z-[100] rounded-lg py-1 min-w-[180px] shadow-lg"
          style={{
            left: contextMenuPos.left,
            top: contextMenuPos.top,
            background: "var(--surface-1)",
            border: "1px solid var(--surface-3)",
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {node.node_type === "file" && (
            <button
              onClick={() => {
                onPin(node.path);
                onContextMenu(node, new DOMRect());
              }}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:opacity-80 transition-opacity"
              style={{ color: "var(--text-secondary)" }}
            >
              <Pin size={12} />
              {node.is_pinned ? "Unpin" : "Pin"}
            </button>
          )}
          <button
            onClick={() => {
              onMoveClick(node);
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:opacity-80 transition-opacity"
            style={{ color: "var(--text-secondary)" }}
          >
            <ArrowRight size={12} />
            Move to folder
          </button>
          <button
            onClick={() => {
              onStartRename(node.path, node.name);
              onContextMenu(node, new DOMRect());
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:opacity-80 transition-opacity"
            style={{ color: "var(--text-secondary)" }}
          >
            <Pencil size={12} />
            Rename
          </button>
          <button
            onClick={async () => {
              const fullPath = await copyFilePath(node.path);
              await navigator.clipboard.writeText(fullPath);
              onContextMenu(node, new DOMRect());
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:opacity-80 transition-opacity"
            style={{ color: "var(--text-secondary)" }}
          >
            <Copy size={12} />
            Copy path
          </button>
          <button
            onClick={() => {
              revealInFolder(node.path);
              onContextMenu(node, new DOMRect());
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:opacity-80 transition-opacity"
            style={{ color: "var(--text-secondary)" }}
          >
            <ExternalLink size={12} />
            Reveal in folder
          </button>
          <div
            className="h-px mx-2 my-1"
            style={{ background: "var(--surface-3)" }}
          />
          <button
            onClick={() => {
              onDelete(node.path, node.node_type === "folder");
              onContextMenu(node, new DOMRect());
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:opacity-80 transition-opacity"
            style={{ color: "var(--accent-rose)" }}
          >
            <Trash2 size={12} />
            Delete
          </button>
        </div>
      )}

      {/* Children */}
      {node.node_type === "folder" &&
        isOpen &&
        node.children &&
        node.children.length > 0 && (
          <div>
            {node.children.map((child) => (
              <FileTreeItem
                key={child.id}
                node={child}
                depth={depth + 1}
                activeFilePath={activeFilePath}
                selectedPath={selectedPath}
                openFolders={openFolders}
                isRenaming={isRenaming}
                renameValue={renameValue}
                contextMenuPath={contextMenuPath}
                contextMenuPos={contextMenuPos}
                onToggleFolder={onToggleFolder}
                onSelectFile={onSelectFile}
                onSelect={onSelect}
                onPin={onPin}
                onRename={onRename}
                onDelete={onDelete}
                onStartRename={onStartRename}
                onCancelRename={onCancelRename}
                onSetRenameValue={onSetRenameValue}
                onContextMenu={onContextMenu}
                onMoveClick={onMoveClick}
                searchSets={searchSets}
              />
            ))}
          </div>
        )}
    </div>
  );
}

export default function FileTree() {
  const {
    activeFilePath,
    openFolders,
    fileTree,
    searchQuery,
    setSearchQuery,
    setActiveFile,
    setFileTree,
    toggleFolder,
    setPinnedFiles,
    isRenaming,
    renameValue,
    startRename,
    setRenameValue,
    cancelRename,
  } = useAppStore();

  const [newFileParent, setNewFileParent] = useState<string | null>(null);
  const [newFileName, setNewFileName] = useState("");
  const [newFolderParent, setNewFolderParent] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");

  const [contextMenuPath, setContextMenuPath] = useState<string | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState<{ left: number; top: number } | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(activeFilePath);

  // Hydration sync: when activeFilePath arrives async (store restore), adopt it as the initial selection
  useEffect(() => {
    if (activeFilePath && selectedPath === null) {
      setSelectedPath(activeFilePath);
    }
  }, [activeFilePath, selectedPath]);

  const [moveModalNode, setMoveModalNode] = useState<FileNode | null>(null);

  const refreshTree = useCallback(async () => {
    const tree = await listFiles();
    setFileTree(tree);
  }, [setFileTree]);

  const handleSelectFile = useCallback(
    async (path: string) => {
      try {
        const file = await readFile(path);
        setActiveFile(file.path, file.content, file.name);
      } catch {
        // File may not exist
      }
    },
    [setActiveFile]
  );

  const handlePin = useCallback(
    async (path: string) => {
      await togglePin(path);
      const tree = await listFiles();
      setFileTree(tree);
      const pinned = tree
        .flatMap((n) => [n, ...(n.children || [])])
        .filter((n) => n.is_pinned)
        .map((n) => n.path);
      setPinnedFiles(pinned);
    },
    [setFileTree, setPinnedFiles]
  );

  const handleRename = useCallback(
    async (path: string, newName: string) => {
      if (!newName || newName === path.split("/").pop()) {
        cancelRename();
        return;
      }
      try {
        await renameFile(path, newName);
        await refreshTree();
        const slash = path.lastIndexOf("/");
        const newPath = slash >= 0 ? path.slice(0, slash + 1) + newName : newName;
        setSelectedPath((prev) => {
          if (prev === path) return newPath;
          if (prev?.startsWith(path + "/")) return newPath + prev.slice(path.length);
          return prev;
        });
        cancelRename();
      } catch (err) {
        console.error("Rename failed:", err);
      }
    },
    [cancelRename, refreshTree]
  );

  const handleDelete = useCallback(
    async (path: string, isFolder: boolean) => {
      if (
        !confirm(
          `Delete ${isFolder ? "folder" : "file"}? This cannot be undone.`
        )
      ) {
        return;
      }
      try {
        await deleteFile(path);
        await refreshTree();
        if (activeFilePath === path) {
          setActiveFile(null, "", "");
        }
        setSelectedPath((prev) =>
          prev === path || prev?.startsWith(path + "/") ? null : prev
        );
      } catch (err) {
        console.error("Delete failed:", err);
      }
    },
    [activeFilePath, setActiveFile, refreshTree]
  );

  const handleCreateFile = useCallback(async (parent: string) => {
    setNewFileParent(parent);
    setNewFileName("");
  }, []);

  const submitNewFile = useCallback(async () => {
    if (!newFileName || !newFileParent) return;
    const name = newFileName.endsWith(".md")
      ? newFileName
      : `${newFileName}.md`;
    try {
      const newPath = await createFile(newFileParent, name);
      await refreshTree();
      const file = await readFile(newPath);
      setActiveFile(file.path, file.content, file.name);
    } catch (err) {
      console.error("Create file failed:", err);
    }
    setNewFileParent(null);
    setNewFileName("");
  }, [newFileName, newFileParent, refreshTree, setActiveFile]);

  const handleCreateFolder = useCallback(async (parent: string) => {
    setNewFolderParent(parent);
    setNewFolderName("");
  }, []);

  const submitNewFolder = useCallback(async () => {
    if (!newFolderName || !newFolderParent) return;
    try {
      await createFolder(newFolderParent, newFolderName);
      await refreshTree();
    } catch (err) {
      console.error("Create folder failed:", err);
    }
    setNewFolderParent(null);
    setNewFolderName("");
  }, [newFolderName, newFolderParent, refreshTree]);

  const parentDir = useCallback((path: string) => {
    const i = path.lastIndexOf("/");
    return i > 0 ? path.slice(0, i) : "/";
  }, []);

  const isValidDropTarget = useCallback(
    (
      source: { path: string; isFolder: boolean } | null,
      target: string
    ): boolean => {
      if (!source) return false;
      if (source.path === target) return false;
      if (parentDir(source.path) === target) return false;
      if (source.isFolder && target.startsWith(source.path + "/")) return false;
      return true;
    },
    [parentDir]
  );

  const handleMove = useCallback(
    async (source: string, targetFolder: string) => {
      try {
        const newPath = await moveFile(source, targetFolder);
        await refreshTree();
        if (activeFilePath === source) {
          try {
            const file = await readFile(newPath);
            setActiveFile(file.path, file.content, file.name);
          } catch {
            setActiveFile(null, "", "");
          }
        }
        setSelectedPath((prev) => {
          if (prev === source) return newPath;
          if (prev?.startsWith(source + "/")) return newPath + prev.slice(source.length);
          return prev;
        });
      } catch (err) {
        if (err !== "noop") console.error("Move failed:", err);
      }
    },
    [activeFilePath, refreshTree, setActiveFile]
  );

  // Global context menu handlers
  const handleContextMenu = useCallback(
    (node: FileNode, rect: DOMRect) => {
      if (rect.width === 0 && rect.height === 0) {
        // sentinel: close menu
        setContextMenuPath(null);
        setContextMenuPos(null);
        return;
      }
      const menuWidth = 180;
      const menuHeight = 220;
      let left = rect.left;
      let top = rect.bottom + 4;
      if (left + menuWidth > window.innerWidth) {
        left = window.innerWidth - menuWidth - 8;
      }
      if (top + menuHeight > window.innerHeight) {
        top = rect.top - menuHeight - 4;
      }
      setContextMenuPath(node.path);
      setContextMenuPos({ left, top });
    },
    []
  );

  const handleMoveClick = useCallback((node: FileNode) => {
    setMoveModalNode(node);
    setContextMenuPath(null);
    setContextMenuPos(null);
  }, []);

  // Close context menu on click outside or Escape
  useEffect(() => {
    if (!contextMenuPath) return;
    const handleClick = () => {
      setContextMenuPath(null);
      setContextMenuPos(null);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setContextMenuPath(null);
        setContextMenuPos(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [contextMenuPath]);

  // Compute visible + auto-expanded paths for search filter (recursive, single walk)
  const searchSets = useMemo<SearchSets | null>(() => {
    if (!searchQuery) return null;
    const q = searchQuery.toLowerCase();
    const visible = new Set<string>();
    const expanded = new Set<string>();
    const walk = (n: FileNode): boolean => {
      const selfHit = n.name.toLowerCase().includes(q);
      let childHit = false;
      for (const c of n.children ?? []) {
        if (walk(c)) childHit = true;
      }
      if (selfHit || childHit) {
        visible.add(n.path);
        if (childHit && n.node_type === "folder") expanded.add(n.path);
        return true;
      }
      return false;
    };
    for (const r of fileTree) walk(r);
    return { visible, expanded };
  }, [fileTree, searchQuery]);

  // Collect all folders for move modal
  const allFolders = useMemo(() => {
    const folders: { path: string; name: string; depth: number }[] = [];
    function walk(nodes: FileNode[], depth: number) {
      for (const n of nodes) {
        if (n.node_type === "folder") {
          folders.push({ path: n.path, name: n.name, depth });
          if (n.children) walk(n.children, depth + 1);
        }
      }
    }
    walk(fileTree, 0);
    return folders;
  }, [fileTree]);

  // Flatten for pinned/recent display
  const allNodes = useMemo(() => {
    const flat: FileNode[] = [];
    function walk(nodes: FileNode[]) {
      for (const n of nodes) {
        if (n.node_type === "file") flat.push(n);
        if (n.children) walk(n.children);
      }
    }
    walk(fileTree);
    return flat;
  }, [fileTree]);

  const pinnedItems = useMemo(
    () => allNodes.filter((n) => n.is_pinned),
    [allNodes]
  );
  const recentItems = useMemo(
    () => allNodes.filter((n) => n.is_recent),
    [allNodes]
  );

  return (
    <div
      className="animate-left-panel flex flex-col h-full overflow-hidden"
      style={{
        background: "var(--surface-2)",
        borderRight: "1px solid var(--surface-3)",
      }}
    >
      {/* Search */}
      <div className="px-3 py-2">
        <div
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-md"
          style={{
            background: "var(--surface-1)",
            border: "1px solid var(--surface-3)",
          }}
        >
          <Search size={13} style={{ color: "var(--text-tertiary)" }} />
          <input
            type="text"
            placeholder="Search files... (Ctrl+B)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="file-search-input bg-transparent text-sm w-full outline-none"
            style={{ color: "var(--text-primary)" }}
          />
          {searchQuery && (
            <button
              onClick={async () => {
                if (searchQuery.length > 1) {
                  const results = await searchWorkspace(searchQuery);
                  console.log("Search results:", results);
                }
              }}
              className="text-xs px-1.5 py-0.5 rounded"
              style={{
                background: "var(--accent-teal)",
                color: "#fff",
              }}
            >
              Find
            </button>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="px-3 pb-2 flex items-center gap-1">
        <button
          onClick={() => handleCreateFile("/")}
          className="new-file-btn flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all duration-200 hover:opacity-80"
          style={{
            background: "var(--surface-1)",
            color: "var(--text-secondary)",
            border: "1px solid var(--surface-3)",
          }}
        >
          <Plus size={12} />
          New file
        </button>
        <button
          onClick={() => handleCreateFolder("/")}
          className="new-folder-btn flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all duration-200 hover:opacity-80"
          style={{
            background: "var(--surface-1)",
            color: "var(--text-secondary)",
            border: "1px solid var(--surface-3)",
          }}
        >
          <Folder size={12} />
          Folder
        </button>
      </div>

      {/* New file input */}
      {newFileParent !== null && (
        <div className="px-3 pb-2">
          <input
            autoFocus
            placeholder="filename.md"
            className="w-full text-sm px-2 py-1 rounded outline-none"
            style={{
              background: "var(--surface-1)",
              color: "var(--text-primary)",
              border: "1px solid var(--accent-teal)",
            }}
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitNewFile();
              else if (e.key === "Escape") {
                setNewFileParent(null);
              }
            }}
            onBlur={() => {
              if (newFileName) submitNewFile();
              else setNewFileParent(null);
            }}
          />
        </div>
      )}

      {/* New folder input */}
      {newFolderParent !== null && (
        <div className="px-3 pb-2">
          <input
            autoFocus
            placeholder="folder name"
            className="w-full text-sm px-2 py-1 rounded outline-none"
            style={{
              background: "var(--surface-1)",
              color: "var(--text-primary)",
              border: "1px solid var(--accent-teal)",
            }}
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitNewFolder();
              else if (e.key === "Escape") {
                setNewFolderParent(null);
              }
            }}
            onBlur={() => {
              if (newFolderName) submitNewFolder();
              else setNewFolderParent(null);
            }}
          />
        </div>
      )}

      {/* Pinned section */}
      {pinnedItems.length > 0 && (
        <div className="px-3 pb-1">
          <div
            className="text-[10px] uppercase tracking-wider font-semibold mb-1 flex items-center gap-1"
            style={{ color: "var(--text-tertiary)" }}
          >
            <Pin size={10} />
            Pinned
          </div>
          {pinnedItems.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition-colors"
              style={{
                background:
                  item.path === activeFilePath
                    ? "rgba(0, 134, 115, 0.08)"
                    : "transparent",
                borderLeft:
                  item.path === activeFilePath
                    ? "2px solid var(--accent-teal)"
                    : "2px solid transparent",
              }}
              onClick={() => handleSelectFile(item.path)}
            >
              <Pin
                size={10}
                style={{ color: "var(--accent-teal)", opacity: 0.7 }}
              />
              <span
                className="text-sm truncate"
                style={{
                  color:
                    item.path === activeFilePath
                      ? "var(--accent-teal)"
                      : "var(--text-secondary)",
                }}
              >
                {item.name}
              </span>
            </div>
          ))}
          <div
            className="h-px my-2 mx-1"
            style={{ background: "var(--surface-3)" }}
          />
        </div>
      )}

      {/* Recent section */}
      {recentItems.length > 0 && !searchQuery && (
        <div className="px-3 pb-1">
          <div
            className="text-[10px] uppercase tracking-wider font-semibold mb-1"
            style={{ color: "var(--text-tertiary)" }}
          >
            Recent
          </div>
          {recentItems.slice(0, 5).map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition-colors"
              style={{
                background:
                  item.path === activeFilePath
                    ? "rgba(0, 134, 115, 0.08)"
                    : "transparent",
                borderLeft:
                  item.path === activeFilePath
                    ? "2px solid var(--accent-teal)"
                    : "2px solid transparent",
              }}
              onClick={() => handleSelectFile(item.path)}
            >
              <FileText
                size={11}
                style={{ color: "var(--text-tertiary)" }}
              />
              <span
                className="text-sm truncate"
                style={{
                  color:
                    item.path === activeFilePath
                      ? "var(--accent-teal)"
                      : "var(--text-secondary)",
                }}
              >
                {item.name}
              </span>
            </div>
          ))}
          <div
            className="h-px my-2 mx-1"
            style={{ background: "var(--surface-3)" }}
          />
        </div>
      )}

      {/* Tree */}
      <div className="flex-1 overflow-y-auto wenmei-scroll px-1 pb-4">
        <div
          className="text-[10px] uppercase tracking-wider font-semibold px-2 mb-1"
          style={{ color: "var(--text-tertiary)" }}
        >
          Files
        </div>
        {fileTree.map((node) => (
          <FileTreeItem
            key={node.id}
            node={node}
            depth={0}
            activeFilePath={activeFilePath}
            selectedPath={selectedPath}
            openFolders={openFolders}
            isRenaming={isRenaming}
            renameValue={renameValue}
            contextMenuPath={contextMenuPath}
            contextMenuPos={contextMenuPos}
            onToggleFolder={toggleFolder}
            onSelectFile={handleSelectFile}
            onSelect={setSelectedPath}
            onPin={handlePin}
            onRename={handleRename}
            onDelete={handleDelete}
            onStartRename={startRename}
            onCancelRename={cancelRename}
            onSetRenameValue={setRenameValue}
            onContextMenu={handleContextMenu}
            onMoveClick={handleMoveClick}
            searchSets={searchSets}
          />
        ))}
      </div>

      {/* Move to folder modal */}
      {moveModalNode && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setMoveModalNode(null);
          }}
        >
          <div
            className="rounded-xl shadow-xl w-[320px] max-w-[90vw] flex flex-col"
            style={{
              background: "var(--surface-1)",
              border: "1px solid var(--surface-3)",
            }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--surface-3)" }}>
              <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Move "{moveModalNode.name}" to...
              </h3>
              <button
                onClick={() => setMoveModalNode(null)}
                className="p-1 rounded hover:opacity-80"
              >
                <X size={14} style={{ color: "var(--text-tertiary)" }} />
              </button>
            </div>
            <div className="max-h-[300px] overflow-y-auto py-1">
              {/* Root */}
              <button
                onClick={() => {
                  if (
                    isValidDropTarget(
                      { path: moveModalNode.path, isFolder: moveModalNode.node_type === "folder" },
                      "/"
                    )
                  ) {
                    handleMove(moveModalNode.path, "/");
                    setMoveModalNode(null);
                  }
                }}
                disabled={
                  !isValidDropTarget(
                    { path: moveModalNode.path, isFolder: moveModalNode.node_type === "folder" },
                    "/"
                  )
                }
                className="flex items-center gap-2 w-full px-4 py-2 text-sm text-left transition-colors hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed"
                style={{ color: "var(--text-secondary)" }}
              >
                <Folder size={13} style={{ color: "var(--text-tertiary)" }} />
                <span className="truncate">Root</span>
              </button>
              {allFolders.map((folder) => {
                const valid = isValidDropTarget(
                  { path: moveModalNode.path, isFolder: moveModalNode.node_type === "folder" },
                  folder.path
                );
                return (
                  <button
                    key={folder.path}
                    onClick={() => {
                      if (valid) {
                        handleMove(moveModalNode.path, folder.path);
                        setMoveModalNode(null);
                      }
                    }}
                    disabled={!valid}
                    className="flex items-center gap-2 w-full px-4 py-2 text-sm text-left transition-colors hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed"
                    style={{
                      color: "var(--text-secondary)",
                      paddingLeft: `${16 + folder.depth * 14}px`,
                    }}
                  >
                    <Folder size={13} style={{ color: "var(--text-tertiary)" }} />
                    <span className="truncate">{folder.name}</span>
                  </button>
                );
              })}
            </div>
            <div className="px-4 py-3 border-t flex justify-end" style={{ borderColor: "var(--surface-3)" }}>
              <button
                onClick={() => setMoveModalNode(null)}
                className="px-3 py-1.5 rounded text-xs font-medium"
                style={{
                  background: "var(--surface-2)",
                  color: "var(--text-secondary)",
                  border: "1px solid var(--surface-3)",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
