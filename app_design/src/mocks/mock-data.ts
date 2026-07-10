// ─── Mock Data for Browser Dev Mode ───
// Mirrors the wenmei project file tree for fast UI iteration without Tauri.

import type {
  FileNode,
  Vault,
  Sandbox,
  AppPersistedState,
  SearchResult,
  AuthorizedSandbox,
  SandboxRegistry,
  JournalEvent,
  TerminalStarted,
  PiPanelStarted,
  PiMessage,
} from "@/lib/tauri-bridge";

export const MOCK_VAULT_PATH = "/Users/dev/wenmei";

export const mockVaults: Vault[] = [
  {
    id: "vault-mock-001",
    name: "wenmei",
    path: MOCK_VAULT_PATH,
    is_active: true,
  },
];

export const mockSandboxes: Sandbox[] = [
  {
    id: "default-root",
    name: "Root sandbox",
    vault_id: "vault-mock-001",
    root_path: "/",
    kind: "vault",
    is_active: true,
  },
];

export const mockAppState: AppPersistedState = {
  first_run_at: new Date().toISOString(),
  onboarding_completed: false,
  left_panel_open: true,
  right_panel_open: true,
  view_mode: "edit",
  theme: "system",
  last_active_file: "/README.md",
  left_panel_width: 280,
  right_panel_width: 360,
  split_ratio: 0.5,
  open_folders: ["/", "/src", "/src/components"],
  pinned_files: ["/README.md", "/src/App.tsx"],
  recent_files: ["/README.md", "/src/App.tsx", "/src/lib/tauri-bridge.ts"],
  vaults: mockVaults,
  active_vault_id: "vault-mock-001",
  sandboxes: mockSandboxes,
  active_sandbox_id: "default-root",
  action_log: ["[mock] initialized mock vault", "[mock] loaded file tree"],
  open_mode: "vault",
  metadata_mode: "local",
  sandbox_auth_status: "promoted",
};

// In-memory mutable stores for write operations
export let mockFileTree: FileNode[] = buildMockTree();
export const mockFileContents = new Map<string, string>([
  [
    "/README.md",
    `# Wenmei — Agentic Thinking Environment for Local Folders

Wenmei is a desktop thinking environment built on **local markdown**, **sandboxed folders**, and **Pi**.

It is not an Obsidian clone and not a web-backed notes database. Markdown files and local folders are the source of truth.

## Architecture

- **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS
- **Desktop core:** Rust + Tauri v2
- **Communication:** Frontend calls Rust commands via \`invoke()\`
- **State:** Zustand for frontend state, Rust \`WenmeiState\` for persisted app/vault state
- **Files:** Plain markdown files on disk — no database, no proprietary format

## Local Setup

\`\`\`bash
npm install
npm run tauri dev
\`\`\`

Or run Vite separately:

\`\`\`bash
npm run dev
\`\`\`
`,
  ],
  [
    "/package.json",
    JSON.stringify(
      {
        name: "wenmei",
        private: true,
        version: "0.0.0",
        type: "module",
        scripts: {
          dev: "vite",
          build: "vite build",
          lint: "eslint .",
          preview: "vite preview",
          tauri: "tauri",
          "desktop:build": "tauri build",
          check: "tsc -b",
          format: "prettier --write .",
          test: "vitest run",
        },
        dependencies: {
          "@tauri-apps/api": "^2.10.1",
          "@tauri-apps/plugin-dialog": "^2.7.0",
          "@xterm/addon-fit": "^0.11.0",
          "@xterm/xterm": "^6.0.0",
          "lucide-react": "^0.562.0",
          react: "^19.2.0",
          "react-dom": "^19.2.0",
          zustand: "^5.0.12",
        },
        devDependencies: {
          "@eslint/js": "^9.39.1",
          "@tauri-apps/cli": "^2.10.1",
          "@types/node": "^24.10.1",
          "@types/react": "^19.2.5",
          "@types/react-dom": "^19.2.3",
          "@vitejs/plugin-react": "^5.1.1",
          autoprefixer: "^10.4.23",
          eslint: "^9.39.1",
          "eslint-plugin-react-hooks": "^7.0.1",
          "eslint-plugin-react-refresh": "^0.4.24",
          globals: "^16.5.0",
          postcss: "^8.5.6",
          prettier: "^3.7.4",
          tailwindcss: "^3.4.19",
          typescript: "~5.9.3",
          "typescript-eslint": "^8.46.4",
          vite: "^7.2.4",
          vitest: "^4.0.16",
        },
      },
      null,
      2
    ),
  ],
  [
    "/AGENTS.md",
    `# AGENTS.md — Wenmei

> This file is for AI coding agents. It describes the project structure, conventions, and workflows.

## Project Overview

**Wenmei** is a desktop "agentic thinking environment" for local markdown folders.

## Technology Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19 + TypeScript + Vite |
| **Styling** | Tailwind CSS v3 |
| **Desktop Shell** | Tauri v2 (Rust) |
| **State Management** | Zustand |
| **Terminal** | \`portable-pty\` (Rust) + \`xterm.js\` |
| **Icons** | Lucide React |

## Build Commands

\`\`\`bash
npm run dev         # Vite dev server
npm run tauri dev   # Tauri dev mode
npm run build       # Production build
\`\`\`
`,
  ],
  [
    "/vite.config.ts",
    `import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __dirname = import.meta.dirname;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
  },
});
`,
  ],
  [
    "/src/App.tsx",
    `import { useEffect } from "react";
import { useAppStore } from "@/store/appStore";
import Header from "./components/Header";
import FileTree from "./components/FileTree";
import CenterPanel from "./components/CenterPanel";
import PiPanel from "./components/PiPanel";

export default function App() {
  return <AppContent />;
}
`,
  ],
  [
    "/src/main.tsx",
    `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
`,
  ],
  [
    "/src/index.css",
    `@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --surface-0: #f8f9fa;
  --surface-1: #ffffff;
  --text-primary: #1a1d21;
  --accent-teal: #14b8a6;
}

.dark {
  --surface-0: #0a0d10;
  --surface-1: #111418;
  --text-primary: #d7dde5;
  --accent-teal: #5eead4;
}
`,
  ],
  [
    "/src/lib/tauri-bridge.ts",
    `// All Tauri invoke() wrappers + TS type mirrors
import { invoke } from "@tauri-apps/api/core";

export interface FileNode {
  id: string;
  name: string;
  path: string;
  node_type: "file" | "folder";
  children?: FileNode[];
  is_pinned: boolean;
  is_recent: boolean;
  modified_at?: string;
}

export async function listFiles(): Promise<FileNode[]> {
  return invoke("list_files");
}
`,
  ],
  [
    "/src/store/appStore.ts",
    `import { create } from "zustand";
import { persist } from "zustand/middleware";

export const useAppStore = create(...);
`,
  ],
  [
    "/src/components/FileTree.tsx",
    `import { useState } from "react";

export default function FileTree() {
  // File tree component
}
`,
  ],
  [
    "/src/components/CenterPanel.tsx",
    `import { useState } from "react";

export default function CenterPanel() {
  // Editor / preview component
}
`,
  ],
  [
    "/src/components/Header.tsx",
    `import { useState } from "react";

export default function Header() {
  // Header component
}
`,
  ],
  [
    "/src/components/PiPanel.tsx",
    `import { useState } from "react";

export default function PiPanel() {
  // Pi panel component
}
`,
  ],
  [
    "/src/components/TerminalPanel.tsx",
    `import { useState } from "react";

export default function TerminalPanel() {
  // Terminal component
}
`,
  ],
  [
    "/src/hooks/useKeyboardShortcuts.ts",
    `import { useEffect } from "react";

export function useKeyboardShortcuts() {
  // Keyboard shortcuts hook
}
`,
  ],
  [
    "/src/lib/markdown.ts",
    `// Custom markdown parser/renderer
export function renderMarkdown(source: string): string {
  return source;
}
`,
  ],
  [
    "/src-tauri/Cargo.toml",
    `[package]
name = "wenmei"
version = "0.1.0"
edition = "2021"

[dependencies]
tauri = { version = "2", features = [] }
serde = { version = "1", features = ["derive"] }
tokio = { version = "1", features = ["full"] }
`,
  ],
  [
    "/src-tauri/tauri.conf.json",
    `{
  "productName": "Wenmei",
  "version": "0.1.0",
  "identifier": "com.wenmei.desktop",
  "build": {
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist",
    "devUrl": "http://localhost:5173"
  }
}
`,
  ],
  [
    "/docs/SANDBOX_HARNESS.md",
    `# Sandbox Harness

Wenmei's core boundary model.

- **Vault**: a folder on disk. Multiple vaults can be "joined."
- **Sandbox**: a subfolder-scoped working context within a vault.
- **Cross-vault operations**: explicit user intent only.
`,
  ],
  [
    "/docs/PACKAGING.md",
    `# Packaging

Build and packaging notes for Wenmei.
`,
  ],
  [
    "/scripts/wenmei",
    `#!/usr/bin/env bash
# wenmei - open folders/files in Wenmei
set -euo pipefail

open -na "Wenmei" --args "$@"
`,
  ],
  ["/public/logo-icon.png", "[binary data: logo icon]"],
]);

function buildMockTree(): FileNode[] {
  const now = new Date().toISOString();

  function f(
    name: string,
    path: string,
    type: "file" | "folder",
    children?: FileNode[]
  ): FileNode {
    return {
      id: path,
      name,
      path,
      node_type: type,
      children,
      is_pinned: mockAppState.pinned_files.includes(path),
      is_recent: mockAppState.recent_files.includes(path),
      modified_at: now,
    };
  }

  return [
    f("wenmei", "/", "folder", [
      f("AGENTS.md", "/AGENTS.md", "file"),
      f("README.md", "/README.md", "file"),
      f("package.json", "/package.json", "file"),
      f("vite.config.ts", "/vite.config.ts", "file"),
      f("tsconfig.json", "/tsconfig.json", "file"),
      f("tailwind.config.js", "/tailwind.config.js", "file"),
      f("postcss.config.js", "/postcss.config.js", "file"),
      f("eslint.config.js", "/eslint.config.js", "file"),
      f("vitest.config.ts", "/vitest.config.ts", "file"),
      f("index.html", "/index.html", "file"),
      f("docs", "/docs", "folder", [
        f("SANDBOX_HARNESS.md", "/docs/SANDBOX_HARNESS.md", "file"),
        f("PACKAGING.md", "/docs/PACKAGING.md", "file"),
      ]),
      f("scripts", "/scripts", "folder", [
        f("wenmei", "/scripts/wenmei", "file"),
        f("install-cli.sh", "/scripts/install-cli.sh", "file"),
      ]),
      f("public", "/public", "folder", [
        f("logo-icon.png", "/public/logo-icon.png", "file"),
      ]),
      f("src", "/src", "folder", [
        f("App.tsx", "/src/App.tsx", "file"),
        f("App.css", "/src/App.css", "file"),
        f("main.tsx", "/src/main.tsx", "file"),
        f("index.css", "/src/index.css", "file"),
        f("components", "/src/components", "folder", [
          f("CenterPanel.tsx", "/src/components/CenterPanel.tsx", "file"),
          f("FileTree.tsx", "/src/components/FileTree.tsx", "file"),
          f("Header.tsx", "/src/components/Header.tsx", "file"),
          f("MobileDrawers.tsx", "/src/components/MobileDrawers.tsx", "file"),
          f("PiPanel.tsx", "/src/components/PiPanel.tsx", "file"),
          f("TerminalPanel.tsx", "/src/components/TerminalPanel.tsx", "file"),
        ]),
        f("hooks", "/src/hooks", "folder", [
          f(
            "useKeyboardShortcuts.ts",
            "/src/hooks/useKeyboardShortcuts.ts",
            "file"
          ),
        ]),
        f("lib", "/src/lib", "folder", [
          f("markdown.ts", "/src/lib/markdown.ts", "file"),
          f("tauri-bridge.ts", "/src/lib/tauri-bridge.ts", "file"),
        ]),
        f("store", "/src/store", "folder", [
          f("appStore.ts", "/src/store/appStore.ts", "file"),
        ]),
      ]),
      f("src-tauri", "/src-tauri", "folder", [
        f("Cargo.toml", "/src-tauri/Cargo.toml", "file"),
        f("tauri.conf.json", "/src-tauri/tauri.conf.json", "file"),
        f("build.rs", "/src-tauri/build.rs", "file"),
        f("src", "/src-tauri/src", "folder", [
          f("main.rs", "/src-tauri/src/main.rs", "file"),
        ]),
      ]),
    ]),
  ];
}

export function resetMockData(): void {
  mockFileTree = buildMockTree();
  mockFileContents.clear();
  // Re-populate defaults
  const defaults = [
    ["/README.md", mockFileContents.get("/README.md") ?? ""],
    ["/package.json", mockFileContents.get("/package.json") ?? ""],
    ["/AGENTS.md", mockFileContents.get("/AGENTS.md") ?? ""],
  ];
  for (const [path, content] of defaults) {
    mockFileContents.set(path, content);
  }
}

export const mockSandboxRegistry: SandboxRegistry = {
  version: 1,
  sandboxes: [
    {
      id: "reg-default-root",
      display_name: "wenmei",
      kind: "vault",
      roots: [MOCK_VAULT_PATH],
      primary_root: MOCK_VAULT_PATH,
      metadata_mode: "local",
      local_meta_path: `${MOCK_VAULT_PATH}/.wenmei`,
      trust_mode: "promoted",
      allow_pi: true,
      allow_terminal: true,
      allow_cross_folder: false,
      authorized_at: new Date().toISOString(),
      auth_source: "mock",
    } as AuthorizedSandbox,
  ],
  recent_documents: [],
};

export const mockJournalEvents: JournalEvent[] = [
  {
    ts: new Date().toISOString(),
    vault_id: "vault-mock-001",
    sandbox_id: "default-root",
    kind: "file.created",
    source: "file-panel",
    path: "/README.md",
    summary: "Created README.md",
    metadata: {},
  },
];

export function mockSearchResults(query: string): SearchResult[] {
  const q = query.toLowerCase();
  const results: SearchResult[] = [];

  function walk(nodes: FileNode[]) {
    for (const node of nodes) {
      if (node.node_type === "file") {
        const content = mockFileContents.get(node.path) ?? "";
        if (node.name.toLowerCase().includes(q)) {
          results.push({
            vault_id: "vault-mock-001",
            vault_name: "wenmei",
            path: node.path,
            name: node.name,
            line_number: 1,
            snippet: content.split("\n")[0]?.slice(0, 120) ?? "",
          });
        } else if (content.toLowerCase().includes(q)) {
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(q)) {
              results.push({
                vault_id: "vault-mock-001",
                vault_name: "wenmei",
                path: node.path,
                name: node.name,
                line_number: i + 1,
                snippet: lines[i].slice(0, 120),
              });
              break;
            }
          }
        }
      }
      if (node.children) walk(node.children);
    }
  }

  walk(mockFileTree);
  return results;
}

export function mockTerminalStart(): TerminalStarted {
  return {
    cwd: MOCK_VAULT_PATH,
    log_file: `${MOCK_VAULT_PATH}/.wenmei/terminal/logs/mock.log`,
    reused: false,
    snapshot: [],
  };
}

export function mockPiPanelStart(): PiPanelStarted {
  return {
    cwd: MOCK_VAULT_PATH,
    session_dir: `${MOCK_VAULT_PATH}/.wenmei/pi-sessions/default-root/panel`,
    reused: false,
    thinking: null,
  };
}

export const mockPiMessages: PiMessage[] = [
  {
    id: "mock-welcome",
    role: "system",
    type: "chat",
    text: "Welcome to Pi! This is mock mode — no real AI backend is connected.",
  },
];

// Helpers for tree mutation
export function findNode(
  nodes: FileNode[],
  path: string
): FileNode | undefined {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.children) {
      const found = findNode(node.children, path);
      if (found) return found;
    }
  }
  return undefined;
}

export function findParentPath(path: string): string {
  const idx = path.lastIndexOf("/");
  if (idx <= 0) return "/";
  return path.slice(0, idx);
}

export function removeNode(nodes: FileNode[], path: string): boolean {
  const idx = nodes.findIndex(n => n.path === path);
  if (idx >= 0) {
    nodes.splice(idx, 1);
    return true;
  }
  for (const node of nodes) {
    if (node.children && removeNode(node.children, path)) return true;
  }
  return false;
}

export function addChild(
  nodes: FileNode[],
  parentPath: string,
  child: FileNode
): boolean {
  for (const node of nodes) {
    if (node.path === parentPath && node.node_type === "folder") {
      node.children = node.children ?? [];
      node.children.push(child);
      return true;
    }
    if (node.children && addChild(node.children, parentPath, child))
      return true;
  }
  return false;
}
