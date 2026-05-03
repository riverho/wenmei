import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { listen, type UnlistenFn } from "@/lib/tauri-events";
import { useAppStore } from "@/store/appStore";
import {
  createFile,
  createSandbox,
  deleteFile,
  getActionLog,
  appendJournal,
  listFiles,
  listJournalEvents,
  listSandboxes,
  listVaults,
  piPanelPrompt,
  piPanelRestart,
  piPanelStart,
  readFile,
  searchAllVaults,
  searchWorkspace,
  writeFile,
} from "@/lib/tauri-bridge";
import type { FileNode, PiMessage, SearchResult } from "@/lib/tauri-bridge";
import {
  Send,
  Clock,
  Terminal,
  Check,
  X,
  Loader2,
  Zap,
  List,
  Search,
  Sparkles,
  FileText,
  Trash2,
} from "lucide-react";

const SLASH_COMMANDS = [
  { cmd: "/format", desc: "Format document", icon: Zap },
  { cmd: "/summarize", desc: "One-sentence summary", icon: FileText },
  { cmd: "/rewrite", desc: "Rewrite for clarity", icon: Sparkles },
  { cmd: "/outline", desc: "Extract heading structure", icon: List },
  { cmd: "/actions", desc: "Extract todo items", icon: Check },
  { cmd: "/find", desc: "Search workspace", icon: Search },
  { cmd: "/write", desc: "Write new file from prompt", icon: Sparkles },
  { cmd: "/generate", desc: "Create from prompt", icon: Sparkles },
  { cmd: "/explain", desc: "Describe structure", icon: FileText },
  { cmd: "/delete", desc: "Move current file to vault trash", icon: Trash2 },
  { cmd: "/vaults", desc: "List joined vaults", icon: FileText },
  { cmd: "/sandboxes", desc: "List folder sandboxes", icon: FileText },
  {
    cmd: "/sandbox",
    desc: "Create sandbox from active folder",
    icon: Sparkles,
  },
  { cmd: "/log", desc: "Show recent file actions", icon: Clock },
  { cmd: "/journal", desc: "Show sandbox journal", icon: Clock },
  { cmd: "/thinking", desc: "Set thinking level", icon: Sparkles },
];

const CONTEXT_RESET_ERROR = "[ERR_CONTEXT_SWITCH_REQUIRES_RESET]";

function resetMessage(error: unknown) {
  return String(error).replace(CONTEXT_RESET_ERROR, "").trim();
}

function message(
  type: PiMessage["type"],
  text: string,
  actions?: PiMessage["actions"]
): PiMessage {
  return {
    id: `ai-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role: "system",
    type,
    text,
    actions,
  };
}

function summarize(content: string) {
  const sentence = content
    .split(/[.!?]+/)
    .map(s => s.trim())
    .find(s => s.length > 20);
  return sentence ? `${sentence}.` : "Document is empty.";
}

function outline(content: string) {
  const headings = content
    .split("\n")
    .filter(line => /^#{1,6}\s+/.test(line))
    .map(line =>
      line.replace(
        /^(#{1,6})\s+/,
        (_, hashes: string) => `${"  ".repeat(hashes.length - 1)}- `
      )
    );
  return headings.length ? headings.join("\n") : "No headings found.";
}

function formatMarkdown(content: string) {
  return (
    content
      .replace(/[ \t]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^(#{1,6})([^#\s])/gm, "$1 $2")
      .trimEnd() + "\n"
  );
}

function flattenFiles(nodes: FileNode[]): FileNode[] {
  const out: FileNode[] = [];
  for (const node of nodes) {
    if (node.node_type === "file") out.push(node);
    if (node.children) out.push(...flattenFiles(node.children));
  }
  return out;
}

function renderResults(results: SearchResult[]) {
  if (results.length === 0) return "No matches.";
  return results
    .slice(0, 20)
    .map(r => `[${r.vault_name}] @${r.path}:${r.line_number} — ${r.snippet}`)
    .join("\n");
}

function isPiSlashCommand(input: string) {
  return /^\/(summarize|rewrite|outline|actions|explain)\b/i.test(input.trim());
}

function extractMentionTokens(input: string) {
  return Array.from(input.matchAll(/@(?:\{([^}]+)\}|([^\s@]+))/g))
    .map(match => match[1] ?? match[2])
    .filter(Boolean);
}

function expandPiSlashCommand(
  input: string,
  activeFilePath: string | null,
  activeFileContent: string
) {
  const trimmed = input.trim();
  const fileContext = activeFilePath
    ? `\n\nActive file: ${activeFilePath}\n\n\`\`\`markdown\n${activeFileContent.slice(0, 20000)}\n\`\`\``
    : "\n\nNo active file is selected.";

  if (/^\/summarize\b/i.test(trimmed))
    return `${trimmed}\n\nSummarize the active document clearly and concisely.${fileContext}`;
  if (/^\/rewrite\b/i.test(trimmed))
    return `${trimmed}\n\nRewrite the active document following the request above. You can read and write files as needed.${fileContext}`;
  if (/^\/outline\b/i.test(trimmed))
    return `${trimmed}\n\nExtract and improve the outline of the active document.${fileContext}`;
  if (/^\/actions\b/i.test(trimmed))
    return `${trimmed}\n\nExtract concrete action items from the active document.${fileContext}`;
  if (/^\/explain\b/i.test(trimmed))
    return `${trimmed}\n\nExplain the active document and its role in this vault.${fileContext}`;
  return trimmed;
}

export default function PiPanel() {
  const {
    piMessages,
    piInput,
    isProcessing,
    activeFileContent,
    activeFilePath,
    fileTree,
    activeVaultId,
    activeSandboxId,
    setActiveFile,
    setActiveFileContent,
    setFileTree,
    setVaults,
    setSandboxes,
    setActionLog,
    addPiMessage,
    appendPiMessageText,
    clearPiMessages,
    setPiInput,
    setIsProcessing,
  } = useAppStore();

  const [showHistory, setShowHistory] = useState(false);
  const [showCommands, setShowCommands] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [typedResponses, setTypedResponses] = useState<Record<string, string>>(
    {}
  );
  const [commandIndex, setCommandIndex] = useState(-1);
  const [piStatus, setPiStatus] = useState("starting");
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [thinkingLevel, setThinkingLevel] = useState<string | null>(() =>
    localStorage.getItem("wenmei-thinking-level")
  );
  const [runDetailsOpen, setRunDetailsOpen] = useState(false);
  const [runDetails, setRunDetails] = useState<string[]>([]);
  const [activeStreamText, setActiveStreamText] = useState("");
  const activeAssistantIdRef = useRef<string | null>(null);

  const startPiForFocusedSandbox = useCallback(
    async (forceRestart = false) => {
      try {
        return await piPanelStart(thinkingLevel, forceRestart);
      } catch (err) {
        if (!forceRestart && String(err).includes(CONTEXT_RESET_ERROR)) {
          const confirmed = window.confirm(
            `${resetMessage(err)}\n\nReset the running Pi Panel session and start it in the focused sandbox?`
          );
          if (confirmed) return piPanelStart(thinkingLevel, true);
        }
        throw err;
      }
    },
    [thinkingLevel]
  );

  const files = useMemo(() => flattenFiles(fileTree), [fileTree]);
  const mentionMatches = useMemo(
    () =>
      mentionOpen
        ? files
            .filter(
              file =>
                file.path.toLowerCase().includes(mentionQuery.toLowerCase()) ||
                file.name.toLowerCase().includes(mentionQuery.toLowerCase())
            )
            .slice(0, 8)
        : [],
    [mentionOpen, files, mentionQuery]
  );

  const addRunDetail = useCallback((text: string) => {
    setRunDetails(prev => [
      ...prev.slice(-80),
      `${new Date().toLocaleTimeString()} ${text}`,
    ]);
  }, []);

  const typeResponse = useCallback(
    (aiResponse: PiMessage) => {
      addPiMessage(aiResponse);
      let index = 0;
      const fullText = aiResponse.text;
      const interval = setInterval(() => {
        index++;
        setTypedResponses(prev => ({
          ...prev,
          [aiResponse.id]: fullText.slice(0, index),
        }));
        if (index >= fullText.length) clearInterval(interval);
      }, 8);
    },
    [addPiMessage]
  );

  const runCommand = useCallback(
    async (input: string): Promise<PiMessage> => {
      const trimmed = input.trim();
      const lower = trimmed.toLowerCase();

      if (lower.startsWith("/summarize")) {
        return message("action", `Summary: ${summarize(activeFileContent)}`);
      }
      if (lower.startsWith("/outline")) {
        return message(
          "action",
          `Document outline:\n${outline(activeFileContent)}`
        );
      }
      if (lower.startsWith("/explain")) {
        return message(
          "chat",
          "This is a local markdown file in the active vault. The center pane owns document edits; Pi can inspect, search, create files, and request confirmed mutations through the desktop harness."
        );
      }
      if (lower.startsWith("/format")) {
        if (!activeFilePath) return message("log", "No active file to format.");
        const formatted = formatMarkdown(activeFileContent);
        if (formatted === activeFileContent)
          return message("log", "Document is already clean.");
        await writeFile(activeFilePath, formatted);
        setActiveFileContent(formatted);
        return message(
          "diff",
          "Formatted active document:\n+ normalized heading spaces\n+ trimmed trailing whitespace\n+ collapsed excessive blank lines"
        );
      }
      if (lower.startsWith("/find")) {
        const all = lower.includes("--all");
        const term = trimmed
          .replace(/^\/find/i, "")
          .replace("--all", "")
          .trim();
        if (!term)
          return message("log", "Usage: /find query or /find query --all");
        const results = all
          ? await searchAllVaults(term)
          : await searchWorkspace(term);
        return message(
          "log",
          `${all ? "Cross-vault" : "Active-vault"} search for "${term}":\n${renderResults(results)}`
        );
      }
      if (lower.startsWith("/write") || lower.startsWith("/generate")) {
        const prompt =
          trimmed.replace(/^\/(write|generate)/i, "").trim() || "Untitled note";
        const slug =
          prompt
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 48) || "generated-note";
        const path = await createFile("/", `${slug}.md`);
        const content = `# ${prompt}\n\nCreated from Pi.\n\n## Notes\n\n`;
        await writeFile(path, content);
        const file = await readFile(path);
        setActiveFile(file.path, file.content, file.name);
        setFileTree(await listFiles());
        return message("action", `Created ${path} from prompt: "${prompt}"`);
      }
      if (lower.startsWith("/rewrite")) {
        return message(
          "diff",
          "Rewrite is staged, not auto-applied. Real model integration should return a patch here; the desktop harness will require confirmation before mutation."
        );
      }
      if (lower.startsWith("/actions")) {
        const todos = activeFileContent
          .split("\n")
          .filter(line => /TODO|\[ \]|- \[ \]/i.test(line))
          .slice(0, 20);
        return message(
          "action",
          todos.length
            ? `Action items:\n${todos.join("\n")}`
            : "No explicit action items found."
        );
      }
      if (lower.startsWith("/delete")) {
        if (!activeFilePath) return message("log", "No active file to delete.");
        return message("confirm", `Move ${activeFilePath} to vault trash?`, [
          { label: "Move to trash", action: "confirm_delete" },
          { label: "Cancel", action: "cancel" },
        ]);
      }
      if (lower.startsWith("/vaults")) {
        const vaults = await listVaults();
        setVaults(vaults);
        return message(
          "log",
          `Vaults:\n${vaults.map(v => `${v.is_active ? "*" : " "} ${v.name} — ${v.path}`).join("\n")}`
        );
      }
      if (lower.startsWith("/sandboxes")) {
        const sandboxes = await listSandboxes();
        setSandboxes(sandboxes);
        return message(
          "log",
          `Sandboxes:\n${sandboxes.map(s => `${s.is_active ? "*" : " "} ${s.name} [${s.kind}] — ${s.root_path}`).join("\n") || "No sandboxes yet."}`
        );
      }
      if (lower.startsWith("/sandbox")) {
        const name =
          trimmed.replace(/^\/sandbox/i, "").trim() || "Folder sandbox";
        const sandbox = await createSandbox(name, "/", "folder");
        setSandboxes(await listSandboxes());
        return message(
          "action",
          `Created and focused sandbox ${sandbox.name} at ${sandbox.root_path}. Terminal and Pi Panel will use this focused sandbox boundary.`
        );
      }
      if (lower.startsWith("/log")) {
        const log = await getActionLog();
        setActionLog(log);
        return message(
          "log",
          `Recent actions:\n${log.slice(0, 20).join("\n") || "No actions yet."}`
        );
      }
      if (lower.startsWith("/journal")) {
        const events = await listJournalEvents(40);
        return message(
          "log",
          `Sandbox journal:\n${events.map(e => `${e.ts} ${e.kind} [${e.source}] ${e.path ?? ""} — ${e.summary}`).join("\n") || "No journal events yet."}`
        );
      }
      if (lower.startsWith("/thinking")) {
        const level = trimmed.replace(/^\/thinking/i, "").trim();
        const allowed = [
          "global",
          "off",
          "minimal",
          "low",
          "medium",
          "high",
          "xhigh",
        ];
        if (!level)
          return message(
            "log",
            `Thinking level: ${thinkingLevel ?? "global"}. Usage: /thinking global|off|minimal|low|medium|high|xhigh`
          );
        if (!allowed.includes(level))
          return message(
            "log",
            `Unknown thinking level. Use: ${allowed.join(", ")}`
          );
        const next = level === "global" ? null : level;
        setThinkingLevel(next);
        if (next) localStorage.setItem("wenmei-thinking-level", next);
        else localStorage.removeItem("wenmei-thinking-level");
        const started = await piPanelRestart(next);
        setPiStatus(`connected · thinking ${started.thinking ?? "global"}`);
        return message(
          "log",
          `Thinking level set to ${next ?? "global"}. Pi Panel RPC restarted.`
        );
      }

      return message(
        "chat",
        `Available desktop commands:\n/format\n/summarize\n/rewrite\n/outline\n/actions\n/find <term> [--all]\n/write <prompt>\n/generate <prompt>\n/explain\n/delete\n/vaults\n/sandboxes\n/sandbox <name>\n/log\n/journal\n/thinking <level>`
      );
    },
    [
      activeFileContent,
      activeFilePath,
      setActiveFile,
      setActiveFileContent,
      setActionLog,
      setFileTree,
      setSandboxes,
      setVaults,
      thinkingLevel,
    ]
  );

  const expandFileMentionsForPrompt = useCallback(
    async (input: string) => {
      const mentionTokens = extractMentionTokens(input);
      if (mentionTokens.length === 0) return input;
      const attached: string[] = [];
      for (const mentionToken of mentionTokens.slice(0, 8)) {
        const token = mentionToken.replace(/^\//, "");
        const file = files.find(f => {
          const pathWithoutSlash = f.path.replace(/^\//, "");
          return (
            f.path === token ||
            f.path === `/${token}` ||
            pathWithoutSlash === token ||
            f.name === token ||
            f.path.endsWith(token)
          );
        });
        if (!file) continue;
        try {
          const content = await readFile(file.path);
          attached.push(
            `--- ${content.path} ---\n${content.content.slice(0, 20000)}`
          );
        } catch {
          // Ignore unreadable/binary mentions for now.
        }
      }
      if (attached.length === 0) return input;
      return `${input}\n\nAttached file context:\n\n${attached.join("\n\n")}`;
    },
    [files]
  );

  const insertMention = useCallback(
    (file: FileNode) => {
      const before = piInput.slice(0, piInput.lastIndexOf("@"));
      const next = `${before}@${file.path} `;
      setPiInput(next);
      setMentionOpen(false);
      setMentionQuery("");
      setMentionIndex(0);
      inputRef.current?.focus();
    },
    [piInput, setPiInput]
  );

  const handleSend = useCallback(async () => {
    if (!piInput.trim() || isProcessing) return;
    const currentInput = piInput;
    const userMsg: PiMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      text: currentInput,
      type: "chat",
    };
    addPiMessage(userMsg);
    setIsProcessing(true);
    setPiInput("");
    setShowCommands(false);

    const mentionExpanded = await expandFileMentionsForPrompt(currentInput);
    const isSlash = currentInput.trim().startsWith("/");
    const goesToPi = !isSlash || isPiSlashCommand(currentInput);

    if (!goesToPi) {
      try {
        typeResponse(await runCommand(currentInput));
      } catch (err) {
        typeResponse(
          message(
            "log",
            `Command failed: ${err instanceof Error ? err.message : String(err)}`
          )
        );
      } finally {
        setIsProcessing(false);
      }
      return;
    }

    const assistantId = `pi-${Date.now()}`;
    activeAssistantIdRef.current = assistantId;
    addPiMessage({ id: assistantId, role: "system", text: "", type: "chat" });
    setActiveStreamText("");
    setTypedResponses(prev => ({ ...prev, [assistantId]: "" }));

    try {
      await startPiForFocusedSandbox();
      const expanded = isPiSlashCommand(currentInput)
        ? expandPiSlashCommand(
            mentionExpanded,
            activeFilePath,
            activeFileContent
          )
        : mentionExpanded;
      await appendJournal(
        "pi.prompt",
        "pi-panel",
        null,
        currentInput.slice(0, 120),
        { mentions: extractMentionTokens(currentInput) }
      );
      await piPanelPrompt(`prompt-${Date.now()}`, expanded);
    } catch (err) {
      setIsProcessing(false);
      activeAssistantIdRef.current = null;
      typeResponse(
        message(
          "log",
          `Pi failed: ${err instanceof Error ? err.message : String(err)}`
        )
      );
    }
  }, [
    piInput,
    isProcessing,
    addPiMessage,
    setIsProcessing,
    setPiInput,
    runCommand,
    typeResponse,
    activeFilePath,
    activeFileContent,
    expandFileMentionsForPrompt,
    startPiForFocusedSandbox,
  ]);

  const openLinkedFile = useCallback(
    async (path: string) => {
      try {
        const cleanPath = path.replace(/^@/, "").replace(/^\//, "");
        const file = await readFile(cleanPath);
        setActiveFile(file.path, file.content, file.name);
      } catch (err) {
        typeResponse(
          message(
            "log",
            `Open file failed: ${err instanceof Error ? err.message : String(err)}`
          )
        );
      }
    },
    [setActiveFile, typeResponse]
  );

  const renderMessageText = useCallback(
    (text: string) => {
      const parts: ReactNode[] = [];
      const regex = /@([^\s:]+(?:\/[^\s:]+)*):(\d+)/g;
      let last = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        if (match.index > last) parts.push(text.slice(last, match.index));
        const path = match[1];
        const line = match[2];
        parts.push(
          <button
            key={`${path}-${line}-${match.index}`}
            onClick={() => openLinkedFile(path)}
            className="underline decoration-dotted underline-offset-2 hover:opacity-80"
            style={{ color: "var(--accent-teal)" }}
            title={`Open ${path}`}
          >
            @{path}:{line}
          </button>
        );
        last = regex.lastIndex;
      }
      if (last < text.length) parts.push(text.slice(last));
      return parts;
    },
    [openLinkedFile]
  );

  const handleAction = useCallback(
    async (action: string) => {
      if (action === "cancel") {
        typeResponse(message("log", "Cancelled."));
        return;
      }
      if (action === "confirm_delete") {
        if (!activeFilePath) {
          typeResponse(message("log", "No active file to delete."));
          return;
        }
        try {
          await deleteFile(activeFilePath);
          setActiveFile(null, "", "");
          setFileTree(await listFiles());
          typeResponse(
            message("log", `Moved ${activeFilePath} to vault trash.`)
          );
        } catch (err) {
          typeResponse(
            message(
              "log",
              `Delete failed: ${err instanceof Error ? err.message : String(err)}`
            )
          );
        }
      }
    },
    [activeFilePath, setActiveFile, setFileTree, typeResponse]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Mention palette — intercept Enter/Tab before submit
      if (mentionOpen) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setMentionIndex(i => Math.min(i + 1, mentionMatches.length - 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setMentionIndex(i => Math.max(i - 1, 0));
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          if (mentionMatches[mentionIndex]) {
            insertMention(mentionMatches[mentionIndex]);
          } else {
            setMentionOpen(false);
          }
          return;
        }
        if (e.key === "Escape") {
          setMentionOpen(false);
          return;
        }
      }

      // Slash command palette — intercept Enter before submit
      if (showCommands) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setCommandIndex(i => Math.min(i + 1, SLASH_COMMANDS.length - 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setCommandIndex(i => Math.max(i - 1, -1));
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          if (commandIndex >= 0) {
            const query = piInput.slice(1).toLowerCase();
            const filtered = SLASH_COMMANDS.filter(
              c => c.cmd.includes(query) || c.desc.toLowerCase().includes(query)
            );
            const cmd = filtered[commandIndex];
            if (cmd) {
              setPiInput(cmd.cmd + " ");
              setShowCommands(false);
              setCommandIndex(-1);
            }
          }
          return;
        }
        if (e.key === "Escape") {
          setShowCommands(false);
          setCommandIndex(-1);
          return;
        }
      }

      // Main Enter — submit
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
        return;
      }

      // Show command palette on /
      if (e.key === "/" && piInput === "" && !showCommands) {
        setShowCommands(true);
        setCommandIndex(0);
      }

      if (e.key === "@") {
        setMentionOpen(true);
        setMentionQuery("");
        setMentionIndex(0);
      }
    },
    [
      mentionOpen,
      mentionMatches,
      mentionIndex,
      insertMention,
      showCommands,
      commandIndex,
      piInput,
      handleSend,
      setPiInput,
    ]
  );

  // Update command palette / mention visibility based on input
  useEffect(() => {
    if (!piInput.startsWith("/")) {
      setShowCommands(false);
      setCommandIndex(-1);
    }
    const at = piInput.lastIndexOf("@");
    if (at >= 0) {
      const after = piInput.slice(at + 1);
      if (!/\s/.test(after)) {
        setMentionOpen(true);
        setMentionQuery(after);
        setMentionIndex(0);
        return;
      }
    }
    setMentionOpen(false);
  }, [piInput]);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let mounted = true;

    async function startPi() {
      try {
        const started = await startPiForFocusedSandbox();
        if (mounted)
          setPiStatus(
            `${started.reused ? "connected" : "started"} · thinking ${started.thinking ?? "global"}`
          );
      } catch (err) {
        if (mounted)
          setPiStatus(
            `offline: ${err instanceof Error ? err.message : String(err)}`
          );
      }
    }

    listen<{ event: Record<string, unknown> }>("pi-rpc-event", evt => {
      const event = evt.payload.event;
      const type = event?.type;

      if (type === "agent_start") {
        setIsProcessing(true);
        setPiStatus(`thinking · ${thinkingLevel ?? "global"}`);
        setRunDetails([]);
        setRunDetailsOpen(false);
        return;
      }

      if (type === "agent_end") {
        setIsProcessing(false);
        setPiStatus(`connected · thinking ${thinkingLevel ?? "global"}`);
        setRunDetailsOpen(false);
        activeAssistantIdRef.current = null;
        listFiles()
          .then(setFileTree)
          .catch(() => {});
        return;
      }

      if (type === "message_update") {
        const delta = event.assistantMessageEvent;
        if (
          typeof delta === "object" &&
          delta &&
          "type" in delta &&
          delta.type === "text_delta" &&
          "delta" in delta &&
          typeof delta.delta === "string"
        ) {
          const id = activeAssistantIdRef.current;
          if (!id) return;
          appendPiMessageText(id, delta.delta);
          setActiveStreamText(prev => `${prev}${delta.delta}`);
          setTypedResponses(prev => ({
            ...prev,
            [id]: `${prev[id] ?? ""}${delta.delta}`,
          }));
        }
        if (
          typeof delta === "object" &&
          delta &&
          "type" in delta &&
          delta.type === "thinking_delta" &&
          "delta" in delta
        ) {
          addRunDetail(`thinking: ${String(delta.delta).slice(0, 500)}`);
        }
        if (
          typeof delta === "object" &&
          delta &&
          "type" in delta &&
          delta.type === "toolcall_start"
        ) {
          addRunDetail("tool call started");
        }
        if (
          typeof delta === "object" &&
          delta &&
          "type" in delta &&
          delta.type === "error"
        ) {
          setIsProcessing(false);
          const reason = "reason" in delta ? String(delta.reason) : "unknown";
          addRunDetail(`error: ${reason}`);
          typeResponse(message("log", `Pi error: ${reason}`));
        }
        return;
      }

      if (type === "tool_execution_start") {
        addRunDetail(`tool: ${String(event.toolName ?? "unknown")} started`);
        return;
      }

      if (type === "tool_execution_end") {
        addRunDetail(
          `tool: ${String(event.toolName ?? "unknown")} ${event.isError ? "failed" : "done"}`
        );
        return;
      }

      if (type === "response" && event.success === false) {
        setIsProcessing(false);
        typeResponse(
          message(
            "log",
            `Pi rejected command: ${String(event.error ?? "unknown error")}`
          )
        );
        return;
      }

      if (type === "extension_ui_request") {
        const method = String(event.method ?? "");
        if (method === "notify") {
          addRunDetail(String(event.message ?? "Pi notification"));
        }
        return;
      }

      if (
        type === "stderr" ||
        type === "client_error" ||
        type === "extension_error"
      ) {
        addRunDetail(String(event.message ?? JSON.stringify(event)));
      }
    }).then(fn => {
      unlisten = fn;
    });

    startPi();

    const handleWorkspaceAuthorized = () => {
      startPiForFocusedSandbox()
        .then(started => {
          if (!mounted) return;
          setPiStatus(
            `${started.reused ? "connected" : "started"} · thinking ${started.thinking ?? "global"}`
          );
          listFiles()
            .then(setFileTree)
            .catch(() => {});
        })
        .catch(err => {
          if (mounted)
            setPiStatus(
              `offline: ${err instanceof Error ? err.message : String(err)}`
            );
        });
    };
    window.addEventListener(
      "wenmei-workspace-authorized",
      handleWorkspaceAuthorized
    );

    return () => {
      mounted = false;
      window.removeEventListener(
        "wenmei-workspace-authorized",
        handleWorkspaceAuthorized
      );
      unlisten?.();
    };
  }, [
    appendPiMessageText,
    setFileTree,
    setIsProcessing,
    typeResponse,
    activeVaultId,
    activeSandboxId,
    thinkingLevel,
    addRunDetail,
    startPiForFocusedSandbox,
  ]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [piMessages, typedResponses]);

  // Filter commands based on partial input
  const filteredCommands = useCallback(() => {
    if (!piInput.startsWith("/")) return [];
    const query = piInput.slice(1).toLowerCase();
    return SLASH_COMMANDS.filter(
      c => c.cmd.includes(query) || c.desc.toLowerCase().includes(query)
    );
  }, [piInput]);

  const visibleCommands = piInput.startsWith("/") ? filteredCommands() : [];

  return (
    <div
      className="animate-right-panel flex flex-col h-full overflow-hidden select-text"
      style={{
        background: "var(--surface-glass)",
        backdropFilter: "blur(16px) saturate(140%)",
        borderLeft: "1px solid var(--surface-3)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 shrink-0"
        style={{ borderBottom: "1px solid var(--surface-3)" }}
      >
        <div className="flex items-center gap-1.5">
          <Terminal size={13} style={{ color: "var(--accent-teal)" }} />
          <span
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--text-secondary)" }}
          >
            Pi
          </span>
          <span
            className="max-w-[120px] truncate text-[10px]"
            style={{
              color: piStatus.startsWith("offline")
                ? "var(--accent-rose)"
                : "var(--text-tertiary)",
            }}
            title={piStatus}
          >
            {piStatus}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors"
            style={{
              color: showHistory
                ? "var(--accent-teal)"
                : "var(--text-tertiary)",
            }}
            title="Show Pi Panel history status"
          >
            <Clock size={12} />
            History
          </button>
          {piMessages.length > 0 && (
            <button
              onClick={clearPiMessages}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors"
              style={{ color: "var(--text-tertiary)" }}
              title="Clear visible chat history"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {showHistory && (
        <div
          className="px-3 py-2 text-[10px] space-y-1"
          style={{
            background: "var(--surface-0)",
            borderBottom: "1px solid var(--surface-3)",
            color: "var(--text-tertiary)",
          }}
        >
          <div>Visible messages: {piMessages.length}</div>
          <div>
            Panel Pi session: vault .wenmei/pi-sessions/&lt;sandbox-id&gt;/panel
          </div>
          <div>
            Terminal Pi session: vault
            .wenmei/pi-sessions/&lt;sandbox-id&gt;/terminal
          </div>
        </div>
      )}

      {runDetails.length > 0 && (
        <div
          className="px-3 py-2 text-[10px]"
          style={{
            borderBottom: "1px solid var(--surface-3)",
            background: "var(--surface-0)",
          }}
        >
          <button
            onClick={() => setRunDetailsOpen(!runDetailsOpen)}
            className="flex items-center justify-between w-full text-left"
            style={{ color: "var(--text-tertiary)" }}
          >
            <span>
              Run details · {runDetails.length} events{" "}
              {isProcessing ? "· active" : "· complete"}
            </span>
            <span>{runDetailsOpen ? "hide" : "show"}</span>
          </button>
          {runDetailsOpen && (
            <div
              className="mt-2 max-h-40 overflow-y-auto wenmei-scroll terminal-font whitespace-pre-wrap"
              style={{ color: "var(--text-tertiary)" }}
            >
              {runDetails.join("\n")}
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto wenmei-scroll px-3 py-2">
        {piMessages.length === 0 && (
          <div
            className="flex flex-col items-center justify-center h-full gap-3"
            style={{ color: "var(--text-tertiary)" }}
          >
            <Terminal size={28} className="opacity-30" />
            <div className="text-center space-y-1">
              <p className="text-xs">Type a command or question.</p>
              <p className="text-[10px] opacity-60">
                Press / for command palette
              </p>
            </div>
            <div className="grid grid-cols-2 gap-1 mt-2">
              {SLASH_COMMANDS.slice(0, 4).map(c => (
                <button
                  key={c.cmd}
                  onClick={() => {
                    setPiInput(c.cmd + " ");
                    inputRef.current?.focus();
                  }}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-colors hover:opacity-80"
                  style={{
                    background: "var(--surface-1)",
                    color: "var(--text-secondary)",
                  }}
                >
                  <c.icon size={10} />
                  {c.cmd}
                </button>
              ))}
            </div>
          </div>
        )}

        {piMessages.map(msg => {
          const displayText = msg.text;

          return (
            <div
              key={msg.id}
              className={`mb-3 ${
                msg.role === "user" ? "flex justify-end" : "flex justify-start"
              }`}
            >
              <div
                className="max-w-[92%] min-w-0"
                style={{
                  background:
                    msg.role === "user" ? "var(--surface-2)" : "transparent",
                  padding: msg.role === "user" ? "6px 10px" : "4px 0",
                  borderRadius: msg.role === "user" ? "8px" : "0",
                }}
              >
                {msg.role === "system" && (
                  <div className="flex items-center gap-1 mb-0.5">
                    <span
                      className="text-[10px] font-semibold uppercase tracking-wider"
                      style={{ color: "var(--accent-teal)" }}
                    >
                      {msg.type === "diff" && "Diff"}
                      {msg.type === "log" && "Log"}
                      {msg.type === "confirm" && "Confirm"}
                      {msg.type === "action" && "Action"}
                      {msg.type === "chat" && "Pi"}
                    </span>
                  </div>
                )}

                <div
                  className="terminal-font text-xs leading-relaxed whitespace-pre-wrap break-words overflow-visible"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {msg.type === "diff" ? (
                    <div
                      className="rounded overflow-hidden"
                      style={{ background: "var(--surface-0)" }}
                    >
                      {msg.text.split("\n").map((line, i) => (
                        <div
                          key={i}
                          className="px-2 py-0.5"
                          style={{
                            background: line.startsWith("-")
                              ? "rgba(194, 74, 74, 0.12)"
                              : line.startsWith("+")
                                ? "rgba(0, 134, 115, 0.12)"
                                : "transparent",
                            color: line.startsWith("-")
                              ? "var(--accent-rose)"
                              : line.startsWith("+")
                                ? "var(--accent-teal)"
                                : "var(--text-secondary)",
                          }}
                        >
                          {line}
                        </div>
                      ))}
                    </div>
                  ) : msg.type === "confirm" ? (
                    <div>
                      <p className="mb-2">{msg.text}</p>
                      <div className="flex gap-2">
                        {msg.actions?.map(action => (
                          <button
                            key={action.action}
                            onClick={() => handleAction(action.action)}
                            className="px-3 py-1 rounded text-xs font-medium"
                            style={{
                              background:
                                action.action.includes("confirm") ||
                                action.action.includes("delete")
                                  ? "var(--accent-rose)"
                                  : "var(--surface-2)",
                              color:
                                action.action.includes("confirm") ||
                                action.action.includes("delete")
                                  ? "#fff"
                                  : "var(--text-secondary)",
                            }}
                          >
                            {action.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : msg.type === "action" && msg.actions ? (
                    <div>
                      <p className="mb-2">{msg.text}</p>
                      <div className="flex gap-2 flex-wrap">
                        {msg.actions.map(action => (
                          <button
                            key={action.action}
                            onClick={() => handleAction(action.action)}
                            className="px-3 py-1 rounded text-xs font-medium"
                            style={{
                              background: "var(--surface-1)",
                              color: "var(--accent-teal)",
                              border: "1px solid var(--accent-teal)",
                            }}
                          >
                            {action.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="whitespace-pre-wrap break-words max-w-full overflow-visible">
                      {renderMessageText(
                        displayText ||
                          (msg.id === activeAssistantIdRef.current
                            ? activeStreamText
                            : "")
                      )}
                      {msg.role === "system" &&
                        isProcessing &&
                        msg.id === activeAssistantIdRef.current && (
                          <span
                            className="cursor-blink inline-block w-0.5 h-3 ml-0.5 align-middle"
                            style={{ background: "var(--accent-teal)" }}
                          />
                        )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {isProcessing && (
          <div className="flex justify-start mb-3">
            <div className="flex items-center gap-1.5 px-2 py-1">
              <Loader2
                size={12}
                className="animate-spin"
                style={{ color: "var(--accent-teal)" }}
              />
              <span
                className="text-xs terminal-font"
                style={{ color: "var(--text-tertiary)" }}
              >
                Processing...
              </span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* File mention palette */}
      {mentionOpen && mentionMatches.length > 0 && (
        <div
          className="shrink-0 px-3 pb-1"
          style={{
            borderTop: "1px solid var(--surface-3)",
            background: "var(--surface-0)",
          }}
        >
          <div className="py-1 space-y-0.5">
            {mentionMatches.map((file, i) => (
              <button
                key={file.path}
                onClick={() => insertMention(file)}
                className="flex items-center gap-2 w-full px-2 py-1 rounded text-xs transition-colors text-left"
                style={{
                  background:
                    i === mentionIndex
                      ? "rgba(0, 134, 115, 0.1)"
                      : "transparent",
                  color:
                    i === mentionIndex
                      ? "var(--accent-teal)"
                      : "var(--text-secondary)",
                }}
              >
                <FileText size={12} />
                <span className="font-mono truncate">{file.path}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Slash command palette */}
      {showCommands && visibleCommands.length > 0 && (
        <div
          className="shrink-0 px-3 pb-1"
          style={{
            borderTop: "1px solid var(--surface-3)",
            background: "var(--surface-0)",
          }}
        >
          <div className="py-1 space-y-0.5">
            {visibleCommands.map((cmd, i) => (
              <button
                key={cmd.cmd}
                onClick={() => {
                  setPiInput(cmd.cmd + " ");
                  setShowCommands(false);
                  inputRef.current?.focus();
                }}
                className="flex items-center gap-2 w-full px-2 py-1 rounded text-xs transition-colors"
                style={{
                  background:
                    i === commandIndex
                      ? "rgba(0, 134, 115, 0.1)"
                      : "transparent",
                  color:
                    i === commandIndex
                      ? "var(--accent-teal)"
                      : "var(--text-secondary)",
                }}
              >
                <cmd.icon size={12} />
                <span className="font-mono">{cmd.cmd}</span>
                <span
                  className="text-[10px]"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  {cmd.desc}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div
        className="shrink-0 px-3 py-2"
        style={{ borderTop: "1px solid var(--surface-3)" }}
      >
        <div
          className="flex items-end gap-2 rounded-lg p-2"
          style={{
            background: "var(--surface-1)",
            border: "1px solid var(--surface-3)",
          }}
        >
          <textarea
            ref={inputRef}
            value={piInput}
            onChange={e => setPiInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Pi, type / for commands, @ to attach files..."
            className="pi-input flex-1 bg-transparent outline-none resize-none terminal-font text-xs"
            style={{
              color: "var(--text-primary)",
              minHeight: "72px",
              maxHeight: "160px",
              overflowY: "auto",
            }}
            rows={3}
          />
          <button
            onClick={handleSend}
            disabled={!piInput.trim() || isProcessing}
            className="flex items-center justify-center w-7 h-7 rounded-md transition-all duration-200 shrink-0"
            style={{
              background:
                piInput.trim() && !isProcessing
                  ? "var(--accent-teal)"
                  : "var(--surface-2)",
              color:
                piInput.trim() && !isProcessing
                  ? "#fff"
                  : "var(--text-tertiary)",
            }}
          >
            <Send size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
