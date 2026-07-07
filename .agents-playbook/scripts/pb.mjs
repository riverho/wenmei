#!/usr/bin/env node
// ============================================================================
//  pb — the Agent-Playbook loop CLI
// ----------------------------------------------------------------------------
//  One command per loop step, so agents move without friction:
//    status | next | record | report | validate | anchor | checkpoint |
//    loop | learn | run | ps | stop | list | scaffold | init | bootstrap | help
//
//  The honest core: a task is "done" when its acceptance_checks — executable
//  shell commands on the task itself — pass. `pb record --status done` runs
//  them and refuses to record on failure. Process documents don't keep the
//  loop honest; exit codes do.
//
//  Master-driven: every path comes from the master (playbook.yaml or
//  playbook.json) under `index` / `paths`, with sensible fallbacks. Drop this
//  file onto an existing project (even one using .json indexes) and it works —
//  the master tells it where everything lives.
//
//  Format-tolerant: index/config files may be .yaml or .json (js-yaml parses
//  both). Everything resolves relative to the master's folder, so the whole
//  playbook is carry-on.
//
//  Only dependency: js-yaml.
// ============================================================================

import {
  readFileSync,
  writeFileSync,
  existsSync,
  appendFileSync,
  mkdirSync,
  copyFileSync,
  cpSync,
  openSync,
  closeSync,
  statSync,
  unlinkSync,
  rmSync,
  readdirSync,
  mkdtempSync,
} from "node:fs";
import { execSync, execFileSync, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve, dirname, join, isAbsolute, basename } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

// --- root + base helpers ---------------------------------------------------
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, ".."); // playbook root = parent of scripts/
const p = (...parts) => resolve(ROOT, ...parts);
const exists = rel => existsSync(p(rel));

function readText(rel) {
  return rel && existsSync(p(rel)) ? readFileSync(p(rel), "utf8") : "";
}
function readData(rel) {
  // js-yaml.load parses both YAML and JSON content.
  const text = readText(rel);
  return text ? yaml.load(text) : null;
}
function firstExisting(cands, fallback) {
  for (const c of cands) if (existsSync(p(c))) return c;
  return fallback;
}
const nowISO = () => new Date().toISOString();
const today = () => nowISO().slice(0, 10);

// --- resolve the master, then derive every path from it --------------------
const MASTER = firstExisting(
  ["playbook.yaml", "playbook.json"],
  "playbook.yaml"
);
// Guard the parse: a malformed master must never crash the CLI — anchor/checkpoint
// run inside runtime hooks on every turn, and a crash there would break the session.
let master = {};
let MASTER_ERR = null;
try {
  master = readData(MASTER) || {};
} catch (e) {
  MASTER_ERR = e.message;
}
const mIndex = master.index || {};
const mMem = mIndex.memory || {};
const mPaths = master.paths || {};

const PROCESS_INDEX =
  mIndex.processes_index ||
  firstExisting(
    ["processes/index.yaml", "processes/index.json"],
    "processes/index.yaml"
  );
const SKILL_INDEX =
  mIndex.skills_index ||
  firstExisting(
    ["skills/index.yaml", "skills/index.json"],
    "skills/index.yaml"
  );
const BACKLOG = mMem.backlog || "memory/backlog.yaml";
const JOURNAL = mMem.journal || "memory/journal.ndjson";
const PROJECT_MEMORY = mMem.project_memory || "memory/project-memory.md";
const REPORTS_DIR =
  mPaths.reports ||
  (mIndex.artifacts && mIndex.artifacts.reports) ||
  "artifacts/reports";
const MEMORY_DIR = dirname(BACKLOG) || "memory";
const ENTRY = master.entry || "SKILL.md";
const ALLOWED_STATUSES = (master.guardrails &&
  master.guardrails.allowed_statuses) || [
  "todo",
  "in_progress",
  "blocked",
  "done",
];
const NORTH_STAR =
  typeof master.north_star === "string" && master.north_star.trim()
    ? master.north_star.trim().replace(/\s+/g, " ")
    : null;
// modes — persona packs mounted on the floor. DEFAULT_MODE is the fallback in the
// resolution chain (task.mode ?? loop.mode ?? default_mode). MODES is the id->file registry.
const DEFAULT_MODE =
  typeof master.default_mode === "string" && master.default_mode.trim()
    ? master.default_mode.trim()
    : null;
const MODES =
  master.modes &&
  typeof master.modes === "object" &&
  !Array.isArray(master.modes)
    ? master.modes
    : {};
const CYCLE = mMem.cycle || "memory/cycle.md";
const LOOPS = mMem.loops || "memory/loops.yaml";
const LESSONS = mMem.lessons || "memory/lessons.ndjson";
const PROCESSES = mMem.processes || "memory/processes.ndjson";
const ARTIFACTS_DIR = mPaths.artifacts || "artifacts";
const LOOP_ARTIFACTS_DIR = join(ARTIFACTS_DIR, "loops");

// --- safe execution helpers ------------------------------------------------
function resolveExecutable(file) {
  if (!file) return file;
  if (existsSync(file) || isAbsolute(file)) return file;
  const pathSep = process.platform === "win32" ? ";" : ":";
  const pathExt =
    process.env.PATHEXT ||
    (process.platform === "win32" ? ".EXE;.CMD;.BAT;.COM" : "");
  const exts = pathExt
    .split(";")
    .map(e => e.toLowerCase())
    .filter(Boolean);
  for (const dir of (process.env.PATH || "").split(pathSep)) {
    for (const ext of exts) {
      const candidate = join(dir, file + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return file;
}

// On Windows, execFileSync/spawn with shell:false cannot launch .cmd/.bat shims
// (EINVAL — Node refuses to exec .bat/.cmd directly). The fix is to dispatch via
// `cmd.exe /d /c` so cmd.exe does PATHEXT lookup and runs npm.cmd / pnpm.cmd /
// yarn.cmd. Node's default Windows auto-quoting (when windowsVerbatimArguments
// is NOT set) joins argv elements with quoting for paths-with-spaces. Caveats:
// argv that contains cmd.exe-special chars (( ) < > & |) is passed verbatim —
// cmd.exe will interpret them. For those, callers should pre-shell-escape.
// Do NOT pass /s — /s + a quoted file path strips both quotes and breaks paths.
function runCommandSync(file, argv, opts = {}) {
  if (process.platform === "win32") {
    return execFileSync("cmd.exe", ["/d", "/c", file, ...argv], opts);
  }
  return execFileSync(resolveExecutable(file), argv, opts);
}
function spawnCommand(file, argv, opts = {}) {
  if (process.platform === "win32") {
    return spawn("cmd.exe", ["/d", "/c", file, ...argv], {
      ...opts,
      windowsHide: true,
    });
  }
  return spawn(resolveExecutable(file), argv, { ...opts, windowsHide: true });
}

function shellSplit(cmd) {
  const out = [];
  let cur = "";
  let quote = null;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (quote) {
      if (ch === "\\" && quote === '"') {
        const nxt = cmd[i + 1];
        if (nxt === '"' || nxt === "\\" || nxt === "$" || nxt === "`") {
          cur += nxt;
          i++;
        } else {
          cur += ch;
        }
      } else if (ch === quote) {
        quote = null;
      } else {
        cur += ch;
      }
    } else {
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
        if (cur.length) {
          out.push(cur);
          cur = "";
        }
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === "\\") {
        const nxt = cmd[i + 1];
        if (nxt === '"' || nxt === "'") {
          cur += nxt;
          i++;
        } else {
          cur += ch;
        }
      } else {
        cur += ch;
      }
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

function loopArtifactsRel(loopId, ...parts) {
  // Store relative artifact paths with forward slashes so the playbook stays
  // carry-on portable across Windows and POSIX.
  return join(LOOP_ARTIFACTS_DIR, loopId, ...parts).replace(/\\/g, "/");
}

// --- structured helpers ----------------------------------------------------
function readJournal() {
  return readText(JOURNAL)
    .split(/\r?\n/)
    .filter(l => l.trim().length > 0)
    .map((l, i) => {
      try {
        return JSON.parse(l);
      } catch {
        return { __malformed: true, __line: i + 1, raw: l };
      }
    });
}
function appendJournal(entry) {
  ensureDir(MEMORY_DIR);
  appendFileSync(p(JOURNAL), JSON.stringify(entry) + "\n", "utf8");
}
function recordAuto(loop, task, status, checksOutcome, notes) {
  const entry = {
    ts: nowISO(),
    loop_id: loop.id,
    task: task.id,
    agent: "auto",
    action: "auto-execute",
    status,
    checks: checksOutcome,
    result: null,
    files: [],
    notes,
  };
  appendJournal(entry);
  updateBacklogState(task.id, { status, updated_at: entry.ts });
  console.log(
    `Recorded [${task.id}] auto-execute → ${status}${checksOutcome !== "none" ? ` (checks: ${checksOutcome})` : ""}`
  );
}

const BACKLOG_STATE = join(dirname(BACKLOG), "backlog-state.json");

function readBacklogState() {
  try {
    const text = readText(BACKLOG_STATE);
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

function writeBacklogState(state) {
  ensureDir(dirname(BACKLOG_STATE));
  writeFileSync(
    p(BACKLOG_STATE),
    JSON.stringify(state, null, 2) + "\n",
    "utf8"
  );
}

function updateBacklogState(taskId, patch) {
  const state = readBacklogState();
  const existing = state[taskId] || {};
  state[taskId] = {
    ...existing,
    status: patch.status ?? existing.status,
    loop_id: patch.loop_id ?? existing.loop_id,
    claimed_at: patch.claimed_at ?? existing.claimed_at,
    // multi-agent: backlog-state.json is the single claim-ledger authority.
    // claimed_by = the agent holding the lease; agent_id = same at claim time;
    // mode = the persona pack the task is being worked under.
    claimed_by: patch.claimed_by ?? existing.claimed_by,
    agent_id: patch.agent_id ?? existing.agent_id,
    mode: patch.mode ?? existing.mode,
    updated_at: patch.updated_at ?? existing.updated_at,
  };
  writeBacklogState(state);
}

// agent identity — `--agent <id>` wins, then PB_AGENT_ID env, then default "agent".
// This is the field that lets N agents share one backlog (track B).
function resolveAgentId(args = {}) {
  if (args && typeof args.agent === "string" && args.agent.trim())
    return args.agent.trim();
  const env = process.env.PB_AGENT_ID;
  if (typeof env === "string" && env.trim()) return env.trim();
  return "agent";
}
// Which agent holds a task. Unstamped (legacy) tasks attribute to the default
// agent "agent" — consistent with resolveAgentId's fallback — so single-agent
// "one at a time" is preserved while named agents are not blocked by orphans.
function taskHolder(t) {
  return (t && (t.claimed_by || t.agent_id)) || "agent";
}

// --- claim lock (multi-agent) ----------------------------------------------
// Atomic claim primitive: an O_EXCL lockfile serializes the claim's
// read-verify-write so two agents can't grab the same task. Carry-on: just a
// file, no daemon/DB. `wx` = create-exclusive; EEXIST means another holder.
function busySleepMs(ms) {
  // synchronous sleep with no deps — block this thread briefly between retries.
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    /* SharedArrayBuffer unavailable: spin */ const end = Date.now() + ms;
    while (Date.now() < end) {}
  }
}
function acquireLock(lockPath, { timeoutMs = 5000, staleMs = 60000 } = {}) {
  const start = Date.now();
  for (;;) {
    try {
      const fd = openSync(lockPath, "wx");
      writeFileSync(fd, JSON.stringify({ pid: process.pid, ts: nowISO() }));
      closeSync(fd);
      return true;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      // break a stale lock left by a dead/abandoned process.
      try {
        const st = statSync(lockPath);
        if (Date.now() - st.mtimeMs > staleMs) {
          try {
            unlinkSync(lockPath);
            continue;
          } catch {
            /* raced */
          }
        }
      } catch {
        /* lock vanished — retry immediately */
      }
      if (Date.now() - start > timeoutMs) return false;
      busySleepMs(20);
    }
  }
}
function releaseLock(lockPath) {
  try {
    unlinkSync(lockPath);
  } catch {
    /* already gone */
  }
}

function backlogTasks() {
  const bl = readData(BACKLOG);
  const tasks = Array.isArray(bl?.tasks) ? bl.tasks : [];
  const state = readBacklogState();
  return tasks.map(t => {
    const s = state[t.id] || {};
    return {
      ...t,
      status: s.status ?? t.status,
      loop_id: s.loop_id ?? t.loop_id,
      claimed_at: s.claimed_at ?? t.claimed_at,
      claimed_by: s.claimed_by ?? t.claimed_by,
      agent_id: s.agent_id ?? t.agent_id,
      mode: s.mode ?? t.mode,
      updated_at: s.updated_at ?? t.updated_at,
    };
  });
}

function writeBacklog(obj) {
  if (BACKLOG.endsWith(".json")) {
    writeFileSync(p(BACKLOG), JSON.stringify(obj, null, 2) + "\n", "utf8");
    return;
  }
  const header =
    `# ${BACKLOG} — the task queue the loop pulls from.\n` +
    "# Managed by `pb` (next --claim / record). Edit by hand to add tasks.\n" +
    `# status: ${ALLOWED_STATUSES.join(" | ")}   priority: 1 = highest\n` +
    "# acceptance_checks: shell commands that must exit 0 before `record --status done` succeeds.\n";
  // If the backlog file does not exist yet, seed it wholesale (bootstrap/init).
  if (!existsSync(p(BACKLOG))) {
    writeFileSync(
      p(BACKLOG),
      header + yaml.dump(obj, { lineWidth: 100 }),
      "utf8"
    );
    return;
  }
  // If the task list is being explicitly reset to empty (e.g. loop new --fresh),
  // rewrite the file and clear the machine-managed sidecar.
  const emptying = Array.isArray(obj.tasks) && obj.tasks.length === 0;
  if (emptying) {
    writeFileSync(
      p(BACKLOG),
      header + yaml.dump(obj, { lineWidth: 100 }),
      "utf8"
    );
    writeBacklogState({});
    return;
  }
  // Normal status updates go to the sidecar so hand-edited formatting/comments
  // in backlog.yaml are preserved.
  const state = readBacklogState();
  for (const t of obj.tasks || []) {
    state[t.id] = {
      status: t.status,
      loop_id: t.loop_id || undefined,
      claimed_at: t.claimed_at || undefined,
      updated_at: t.updated_at || undefined,
    };
  }
  writeBacklogState(state);
}
function appendBacklogTask(task) {
  if (BACKLOG.endsWith(".json")) {
    const bl = readData(BACKLOG) || { tasks: [] };
    bl.tasks.push(task);
    writeFileSync(p(BACKLOG), JSON.stringify(bl, null, 2) + "\n", "utf8");
    return;
  }
  let text = readText(BACKLOG);
  // `loop new --fresh` resets YAML backlogs to `tasks: []`. Appending an
  // indented list item after that scalar inline list creates invalid YAML:
  // `tasks: []\n  - id: ...`. Normalize that empty-list form to a block list
  // header before appending so the first planned task becomes valid YAML.
  text = text.replace(/(^|\n)(\s*tasks:)\s*\[\]\s*(?=\n|$)/, "$1$2");
  const taskYaml = yaml.dump(task, { lineWidth: 100 }).trimEnd();
  const indented = taskYaml
    .split("\n")
    .map((line, i) => (i === 0 ? "  - " + line : "    " + line))
    .join("\n");
  const sep = text.endsWith("\n") ? "" : "\n";
  writeFileSync(p(BACKLOG), text + sep + indented + "\n", "utf8");
}
function ensureDir(rel) {
  const dir = p(rel);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}
function writeIfMissing(rel, text, created) {
  ensureDir(dirname(rel));
  if (!existsSync(p(rel))) {
    writeFileSync(p(rel), text, "utf8");
    created.push(rel);
  }
}
function readNdjson(rel) {
  return readText(rel)
    .split(/\r?\n/)
    .filter(l => l.trim().length > 0)
    .map((l, i) => {
      try {
        return JSON.parse(l);
      } catch {
        return { __malformed: true, __line: i + 1, raw: l };
      }
    });
}
function appendNdjson(rel, obj) {
  ensureDir(dirname(rel));
  appendFileSync(p(rel), JSON.stringify(obj) + "\n", "utf8");
}
function journalLineCount() {
  return readText(JOURNAL)
    .split(/\r?\n/)
    .filter(l => l.trim().length > 0).length;
}
function readLoops() {
  let data = null;
  try {
    data = readData(LOOPS);
  } catch {
    data = null;
  }
  return {
    active: typeof data?.active === "string" ? data.active : null,
    loops: Array.isArray(data?.loops) ? data.loops : [],
  };
}
function writeLoops(state) {
  ensureDir(dirname(LOOPS));
  writeFileSync(
    p(LOOPS),
    yaml.dump(
      {
        active: state.active || null,
        loops: Array.isArray(state.loops) ? state.loops : [],
      },
      { lineWidth: 100 }
    ),
    "utf8"
  );
}
function activeLoop() {
  const state = readLoops();
  const loop = state.active
    ? state.loops.find(l => l.id === state.active)
    : null;
  return loop && loop.status === "active" ? loop : null;
}
function latestLoop() {
  const loops = readLoops().loops;
  return loops.length ? loops[loops.length - 1] : null;
}
function loopById(id) {
  return readLoops().loops.find(l => l.id === id) || null;
}
function nextLoopId(state = readLoops()) {
  const prefix = `loop-${today().replace(/-/g, "")}`;
  const n =
    state.loops.filter(l => String(l.id || "").startsWith(prefix)).length + 1;
  return `${prefix}-${String(n).padStart(3, "0")}`;
}
function readLessons() {
  return readNdjson(LESSONS).filter(e => !e.__malformed);
}
function openLessons() {
  return readLessons().filter(
    l => l.status !== "promoted" && l.status !== "closed"
  );
}
function lessonsForLoop(loopId) {
  return readLessons().filter(l => l.loop_id === loopId);
}
function nextLessonId() {
  const prefix = `lesson-${today().replace(/-/g, "")}`;
  const n =
    readLessons().filter(l => String(l.id || "").startsWith(prefix)).length + 1;
  return `${prefix}-${String(n).padStart(3, "0")}`;
}
function readProcessEvents() {
  return readNdjson(PROCESSES).filter(e => !e.__malformed);
}
function latestProcessRecords(loopId = null) {
  const byPid = new Map();
  for (const e of readProcessEvents()) {
    if (loopId && e.loop_id !== loopId) continue;
    if (e.pid !== undefined) byPid.set(`${e.loop_id}:${e.pid}`, e);
  }
  return [...byPid.values()];
}
function pidAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}
function stopPid(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0 || n >= 2 ** 31) return false;
  try {
    if (process.platform === "win32")
      execFileSync("taskkill", ["/PID", String(n), "/T", "/F"], {
        stdio: "pipe",
      });
    else process.kill(-n, "SIGTERM");
    return true;
  } catch {
    try {
      process.kill(n, "SIGTERM");
      return true;
    } catch {
      return false;
    }
  }
}
function stopLoopProcesses(loopId) {
  const stopped = [];
  for (const proc of latestProcessRecords(loopId)) {
    const alive = proc.status !== "stopped" && pidAlive(proc.pid);
    if (!alive) continue;
    const ok = stopPid(proc.pid);
    const event = {
      ...proc,
      ts: nowISO(),
      status: ok ? "stopped" : "stop_failed",
      stopped_at: nowISO(),
    };
    appendNdjson(PROCESSES, event);
    stopped.push(event);
  }
  return stopped;
}

// minimal arg parser: positionals in `_`, --key value / --flag true / --key=value
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === "--") {
      out["--"] = argv.slice(i + 1);
      break;
    }
    if (tok.startsWith("--")) {
      let key, value;
      const eq = tok.indexOf("=");
      if (eq > 2) {
        key = tok.slice(2, eq);
        value = tok.slice(eq + 1);
      } else {
        key = tok.slice(2);
        const nxt = argv[i + 1];
        if (nxt === undefined || nxt.startsWith("--")) value = true;
        else {
          value = nxt;
          i++;
        }
      }
      if (out[key] === undefined) out[key] = value;
      else if (Array.isArray(out[key])) out[key].push(value);
      else out[key] = [out[key], value];
    } else {
      out._.push(tok);
    }
  }
  return out;
}

const prio = t => (typeof t.priority === "number" ? t.priority : 100);
// --- pack-composable index resolution (Stage 2) ----------------------------
// Skills/processes resolve from the ENGINE globals UNION the ACTIVE MODE's
// pack-local indices. Engine ids win on collision (packs are additive, never
// override). coding's pointers equal the global files, so its union == globals
// == no change. A pack that points its skills_index/processes_index at its own
// files (under modes/<id>/) contributes those entries only while it is active.
function modeIndexPath(doc, key) {
  return doc && typeof doc[key] === "string" && doc[key].trim()
    ? doc[key].trim()
    : null;
}
function mergeIndexEntries(globalPath, modePath, listKey) {
  const entries = [];
  const seen = new Set();
  const push = list => {
    for (const e of list || []) {
      if (!e || !e.id || seen.has(e.id)) continue; // engine/first wins; additive for new ids
      seen.add(e.id);
      entries.push(e);
    }
  };
  push(readData(globalPath)?.[listKey]); // engine globals first
  if (modePath && modePath !== globalPath) push(readData(modePath)?.[listKey]); // then pack-local
  return entries;
}
// A specific mode's resolved menu (engine globals ∪ that mode's pack-local index).
// `pb mode show <id>` lists ANY mode's menu, not only the active one.
function modeSkillEntries(doc) {
  return mergeIndexEntries(
    SKILL_INDEX,
    modeIndexPath(doc, "skills_index"),
    "skills"
  );
}
function modeProcessEntries(doc) {
  return mergeIndexEntries(
    PROCESS_INDEX,
    modeIndexPath(doc, "processes_index"),
    "processes"
  );
}
function resolvedSkillEntries() {
  return modeSkillEntries(loadMode(resolveModeId()));
}
function resolvedProcessEntries() {
  return modeProcessEntries(loadMode(resolveModeId()));
}
function skillFor(skillId) {
  return resolvedSkillEntries().find(s => s.id === skillId) || null;
}
function skillForMode(skillId, modeId) {
  const doc = loadMode(modeId || resolveModeId());
  return modeSkillEntries(doc).find(s => s.id === skillId) || null;
}
function unmetDeps(task, tasks) {
  const deps = Array.isArray(task.dependencies) ? task.dependencies : [];
  return deps.filter(
    dep => !tasks.some(t => t.id === dep && t.status === "done")
  );
}

// ============================================================================
//  acceptance checks — the enforcement layer. Checks are shell commands on the
//  task; they run with cwd = playbook root. Exit 0 = pass. This is what makes
//  "done" mean something: `record --status done` refuses if any check fails.
// ============================================================================
function taskChecks(task) {
  return (
    Array.isArray(task?.acceptance_checks) ? task.acceptance_checks : []
  ).filter(c => typeof c === "string" && c.trim());
}
function taskCommands(task) {
  return (Array.isArray(task?.commands) ? task.commands : []).filter(
    c => typeof c === "string" && c.trim()
  );
}

function gateQuality(task) {
  const checks = taskChecks(task);
  if (!checks.length) return "·honor";
  const structuralOnly = c =>
    /(^|\s)(node\s+scripts\/pb\.mjs|pb(\.mjs)?|npm\s+run)\s+validate\b/.test(
      c.trim()
    ) && !/--task/.test(c);
  return checks.every(structuralOnly) ? "⚠hollow" : "✓verified";
}
function reportCheckMarker(entry, task) {
  if (entry.checks === "skipped") return " ⚠checks-skipped";
  if (entry.checks !== "passed") return "";
  const quality = task ? gateQuality(task) : "✓verified";
  return quality === "⚠hollow" ? " ⚠hollow-checks" : " ✓verified";
}
// Checks run with cwd = playbook root, so a check that names the playbook
// folder itself (e.g. ".agents-playbook/artifacts/...") is almost certainly a
// workspace-relative path written by an operator who expected cwd = workspace
// root. The runner would look for ".agents-playbook/.agents-playbook/..." and
// fail on a file that exists. Surface that before the confusing failure.
const PLAYBOOK_DIR = ROOT.split(/[\\/]/).filter(Boolean).pop() || "";
function checkPathWarnings(checks) {
  if (!PLAYBOOK_DIR || !PLAYBOOK_DIR.startsWith(".")) return [];
  // Only warn for a dot-prefixed nested install (".agents-playbook"); a bare
  // top-level folder name like "scripts" would false-positive on real paths.
  const needle = new RegExp(
    `(^|[\\s'"\`(])${PLAYBOOK_DIR.replace(/[.]/g, "\\.")}[\\\\/]`
  );
  return checks.filter(c => needle.test(c));
}
function runChecks(task) {
  const checks = taskChecks(task);
  const results = [];
  for (const cmd of checks) {
    const parts = shellSplit(cmd);
    if (!parts.length) continue;
    const [file, ...argv] = parts;
    try {
      runCommandSync(file, argv, { cwd: ROOT, stdio: "pipe", timeout: 120000 });
      results.push({ cmd, ok: true });
    } catch (e) {
      const out = [e.stdout, e.stderr]
        .filter(Boolean)
        .map(String)
        .join("\n")
        .trim();
      results.push({
        cmd,
        ok: false,
        output: out.split(/\r?\n/).slice(-8).join("\n"),
      });
    }
  }
  return results;
}
function printCheckResults(results) {
  for (const r of results) {
    console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.cmd}`);
    if (!r.ok && r.output)
      console.log(
        r.output
          .split(/\r?\n/)
          .map(l => `        ${l}`)
          .join("\n")
      );
  }
}
function runCommands(task) {
  const cmds = taskCommands(task);
  const results = [];
  for (const cmd of cmds) {
    const parts = shellSplit(cmd);
    if (!parts.length) continue;
    const [file, ...argv] = parts;
    try {
      runCommandSync(file, argv, { cwd: ROOT, stdio: "pipe", timeout: 120000 });
      results.push({ cmd, ok: true });
    } catch (e) {
      const out = [e.stdout, e.stderr]
        .filter(Boolean)
        .map(String)
        .join("\n")
        .trim();
      results.push({
        cmd,
        ok: false,
        output: out.split(/\r?\n/).slice(-8).join("\n"),
      });
    }
  }
  return results;
}
function printCommandResults(results) {
  for (const r of results) {
    console.log(`  ${r.ok ? "OK" : "FAIL"}  ${r.cmd}`);
    if (!r.ok && r.output)
      console.log(
        r.output
          .split(/\r?\n/)
          .map(l => `        ${l}`)
          .join("\n")
      );
  }
}

// --- mode principle checks -------------------------------------------------
// kind:check principles declare an executable `check:` command; kind:advice are
// anchor nudges only and NEVER run/gate. This is what keeps modes from going
// faith-based. Commands dispatch through the Windows-safe runner (runCommandSync)
// so `.cmd`/`.bat` shims like `npm` work (project-memory #7).
function modeCheckPrinciples(doc) {
  return (Array.isArray(doc?.principles) ? doc.principles : []).filter(
    pr =>
      pr &&
      pr.kind === "check" &&
      typeof pr.check === "string" &&
      pr.check.trim()
  );
}
function runModeChecks(doc) {
  const results = [];
  for (const pr of modeCheckPrinciples(doc)) {
    const parts = shellSplit(pr.check);
    if (!parts.length) continue;
    const [file, ...argv] = parts;
    try {
      runCommandSync(file, argv, { cwd: ROOT, stdio: "pipe", timeout: 120000 });
      results.push({ id: pr.id, cmd: pr.check, ok: true });
    } catch (e) {
      const out = [e.stdout, e.stderr]
        .filter(Boolean)
        .map(String)
        .join("\n")
        .trim();
      results.push({
        id: pr.id,
        cmd: pr.check,
        ok: false,
        output: out.split(/\r?\n/).slice(-8).join("\n"),
      });
    }
  }
  return results;
}
function printModeCheckResults(results) {
  for (const r of results) {
    console.log(`  ${r.ok ? "PASS" : "FAIL"}  [${r.id}] ${r.cmd}`);
    if (!r.ok && r.output)
      console.log(
        r.output
          .split(/\r?\n/)
          .map(l => `        ${l}`)
          .join("\n")
      );
  }
}

// ============================================================================
//  validate — guardrails. No args: structural (master, indices, files, backlog,
//  journal). --task <id>: run that task's executable acceptance_checks.
//  --mode: also run the active mode's kind:check principles.
//  Exit 1 on any failure.
// ============================================================================
function runValidate() {
  const failures = [];
  const ok = (cond, msg) => {
    if (!cond) failures.push(msg);
  };

  // 1. master
  if (MASTER_ERR)
    failures.push(`Master parse error in ${MASTER}: ${MASTER_ERR}`);
  ok(
    master && Object.keys(master).length,
    `Missing or unparseable master: ${MASTER}`
  );
  for (const key of [
    "name",
    "version",
    "entry",
    "paths",
    "index",
    "loop",
    "guardrails",
  ]) {
    ok(master[key] !== undefined, `${MASTER} is missing required key: ${key}`);
  }
  ok(exists(ENTRY), `entry file does not exist: ${ENTRY}`);

  // 2. processes index (global must parse) + each referenced process file in the
  //    resolved union (engine globals ∪ active-mode pack-local).
  const pidx = readData(PROCESS_INDEX);
  ok(pidx, `Missing or unparseable process index: ${PROCESS_INDEX}`);
  const processIds = new Set();
  for (const proc of resolvedProcessEntries()) {
    ok(proc.id, `A process entry in ${PROCESS_INDEX} is missing an id`);
    if (proc.id) processIds.add(proc.id);
    ok(
      proc.file && exists(proc.file),
      `Process file missing: ${proc.file} (id: ${proc.id})`
    );
  }

  // 3. skills index (global must parse) + each skill file + each process ref
  //    resolves (by id or path), over the resolved union.
  const sidx = readData(SKILL_INDEX);
  ok(sidx, `Missing or unparseable skill index: ${SKILL_INDEX}`);
  for (const sk of resolvedSkillEntries()) {
    ok(sk.id, `A skill entry in ${SKILL_INDEX} is missing an id`);
    ok(
      sk.file && exists(sk.file),
      `Skill file missing: ${sk.file} (id: ${sk.id})`
    );
    if (sk.process) {
      const resolves = processIds.has(sk.process) || exists(sk.process);
      ok(
        resolves,
        `Skill "${sk.id}" points to a process that does not resolve: ${sk.process}`
      );
    }
  }

  // 4. memory files
  ok(exists(PROJECT_MEMORY), `Missing project memory: ${PROJECT_MEMORY}`);
  ok(exists(BACKLOG), `Missing backlog: ${BACKLOG}`);
  ok(
    existsSync(p(JOURNAL)),
    `Missing journal: ${JOURNAL} (run \`pb init\` to create it)`
  );

  // 5. backlog well-formed (use merged tasks so sidecar state is validated too)
  let tasks = [];
  try {
    tasks = backlogTasks();
  } catch (e) {
    failures.push(`${BACKLOG} parse error: ${e.message}`);
  }
  const ids = new Set(tasks.map(t => t.id).filter(Boolean));
  for (const t of tasks) {
    ok(t.id, "A backlog task is missing an id");
    ok(
      ALLOWED_STATUSES.includes(t.status),
      `Task ${t.id} has invalid status: ${t.status}`
    );
    if (t.skill)
      ok(
        skillForMode(t.skill, t.mode),
        `Task ${t.id} references unknown skill: ${t.skill}${t.mode ? ` (mode: ${t.mode})` : ""}`
      );
    for (const dep of t.dependencies || []) {
      ok(ids.has(dep), `Task ${t.id} references unknown dependency: ${dep}`);
    }
    if (t.acceptance_checks !== undefined) {
      ok(
        Array.isArray(t.acceptance_checks) &&
          t.acceptance_checks.every(c => typeof c === "string"),
        `Task ${t.id} acceptance_checks must be a list of shell command strings`
      );
    }
    if (t.commands !== undefined) {
      ok(
        Array.isArray(t.commands) &&
          t.commands.every(c => typeof c === "string"),
        `Task ${t.id} commands must be a list of shell command strings`
      );
    }
    if (t.manual !== undefined) {
      ok(
        typeof t.manual === "boolean",
        `Task ${t.id} manual must be a boolean`
      );
    }
  }

  // 6. journal lines all valid JSON
  readJournal().forEach(e => {
    if (e.__malformed)
      failures.push(`Malformed JSON in ${JOURNAL} line ${e.__line}`);
  });
  if (existsSync(p(LOOPS))) {
    try {
      yaml.load(readText(LOOPS));
    } catch (e) {
      failures.push(`Malformed YAML in ${LOOPS}: ${e.message}`);
    }
    const loops = readLoops();
    ok(Array.isArray(loops.loops), `${LOOPS} must contain a "loops" list`);
    const ids = new Set();
    for (const l of loops.loops) {
      ok(l.id, `A loop entry in ${LOOPS} is missing an id`);
      if (l.id) ids.add(l.id);
      ok(
        ["active", "done", "failed", "quarantined", "abandoned"].includes(
          l.status
        ),
        `Loop ${l.id || "?"} has invalid status: ${l.status}`
      );
    }
    if (loops.active)
      ok(
        ids.has(loops.active),
        `${LOOPS} active loop does not exist: ${loops.active}`
      );
  }
  if (existsSync(p(LESSONS))) {
    readNdjson(LESSONS).forEach(e => {
      if (e.__malformed)
        failures.push(`Malformed JSON in ${LESSONS} line ${e.__line}`);
    });
  }
  if (existsSync(p(PROCESSES))) {
    readNdjson(PROCESSES).forEach(e => {
      if (e.__malformed)
        failures.push(`Malformed JSON in ${PROCESSES} line ${e.__line}`);
    });
  }

  // 7. declared paths targets exist
  for (const [k, v] of Object.entries(mPaths)) {
    ok(exists(v), `paths.${k} target does not exist: ${v}`);
  }

  // 8. mode catalog (modes/index.yaml) agrees with the master's `modes:` registry.
  //    The menu must never silently DISAGREE with the master — a lying menu is
  //    worse than no menu. Enforced only when the catalog exists (an absent menu
  //    is a different concern; minimal/bootstrap playbooks may carry no catalog).
  if (Object.keys(MODES).length && exists("modes/index.yaml")) {
    const CATALOG = "modes/index.yaml";
    const cat = readData(CATALOG);
    ok(
      cat && Array.isArray(cat.modes),
      `Mode catalog ${CATALOG} must contain a "modes" list`
    );
    const catIds = new Set(
      (cat?.modes || []).map(m => m && m.id).filter(Boolean)
    );
    for (const id of Object.keys(MODES))
      ok(
        catIds.has(id),
        `Mode "${id}" is in playbook.yaml modes: but missing from ${CATALOG}`
      );
    for (const id of catIds)
      ok(
        MODES[id] !== undefined,
        `Mode "${id}" is in ${CATALOG} but not in playbook.yaml modes:`
      );
    for (const m of cat?.modes || []) {
      ok(m && m.id, `A mode entry in ${CATALOG} is missing an id`);
      ok(
        m && typeof m.abstract === "string" && m.abstract.trim(),
        `Mode "${m?.id}" in ${CATALOG} needs a non-empty abstract`
      );
    }
  }

  return failures;
}

function cmdValidate(args) {
  if (typeof args.task === "string") {
    // Per-task checks are not a substitute for structural guardrails.
    const failures = runValidate();
    if (failures.length) {
      console.error("Playbook validation FAILED:\n");
      for (const f of failures) console.error(`  - ${f}`);
      process.exit(1);
    }
    const task = backlogTasks().find(t => t.id === args.task);
    if (!task) {
      console.error(`Task not found in ${BACKLOG}: ${args.task}`);
      process.exit(1);
    }
    const checks = taskChecks(task);
    if (!checks.length) {
      console.log(
        `[${task.id}] has no acceptance_checks — verification is manual. Add executable checks to make "done" enforceable.`
      );
      return;
    }
    const suspect = checkPathWarnings(checks);
    if (suspect.length) {
      console.log(
        `\n⚠ Path warning: checks run with cwd = playbook root (this folder, "${PLAYBOOK_DIR}/").`
      );
      console.log(
        `  These check(s) reference "${PLAYBOOK_DIR}/" — likely a workspace-relative path. Drop that prefix:`
      );
      for (const c of suspect) console.log(`    ⚠  ${c}`);
      console.log("");
    }
    console.log(
      `Running ${checks.length} acceptance check(s) for [${task.id}] (cwd: playbook root):`
    );
    const results = runChecks(task);
    printCheckResults(results);
    if (results.some(r => !r.ok)) process.exit(1);
    console.log(`All checks passed for [${task.id}].`);
    return;
  }

  const failures = runValidate();
  if (failures.length) {
    console.error("Playbook validation FAILED:\n");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("Playbook validation passed.");

  // Hollow-check pass: warn (or fail with --strict) when actionable tasks rely only on
  // structural checks. The structural gate (pb validate) proves the playbook is well-formed,
  // not that the task's work was done — making "done" a false green.
  const allTasks = backlogTasks();
  const hollowActionable = allTasks.filter(
    t =>
      ["todo", "in_progress"].includes(t.status) && gateQuality(t) === "⚠hollow"
  );
  if (hollowActionable.length) {
    console.log(
      `\n⚠ Hollow gate warning: ${hollowActionable.length} actionable task(s) use only structural checks (pb validate):`
    );
    for (const t of hollowActionable)
      console.log(`  ⚠hollow  [${t.id}] ${t.title || ""}`);
    console.log(
      "Add task-specific acceptance_checks that test the work itself. Run \`node scripts/check-hollow.mjs .\` for details."
    );
    if (args.strict) {
      console.error("\nFailing (--strict): hollow gates on actionable tasks.");
      process.exit(1);
    }
  }

  // --mode: also run the active mode's kind:check principles. Opt-in so plain
  // `pb validate` stays structural-only (and non-recursive: a check principle may
  // itself invoke `pb validate`, but never `pb validate --mode`).
  if (args.mode) {
    const id = resolveModeId();
    const doc = loadMode(id);
    const checks = doc ? modeCheckPrinciples(doc) : [];
    if (checks.length) {
      console.log(
        `\nRunning ${checks.length} kind:check principle(s) for mode "${id}":`
      );
      const results = runModeChecks(doc);
      printModeCheckResults(results);
      if (results.some(r => !r.ok)) {
        console.error(`\nMode "${id}" check FAILED.`);
        process.exit(1);
      }
    }
  }
}

// ============================================================================
//  status — the "where am I" orient snapshot
// ============================================================================
function cmdStatus() {
  const tasks = backlogTasks();
  const journal = readJournal();

  console.log(
    `\n  ${master?.name || "playbook"} v${master?.version || "?"} — ${(master?.description || "").trim().split("\n")[0]}`
  );
  console.log("  " + "-".repeat(68));

  const counts = Object.fromEntries(ALLOWED_STATUSES.map(s => [s, 0]));
  for (const t of tasks) if (counts[t.status] !== undefined) counts[t.status]++;
  console.log(
    "  Backlog: " + ALLOWED_STATUSES.map(s => `${counts[s]} ${s}`).join("  •  ")
  );
  const loop = activeLoop();
  const highLessons = openLessons().filter(l => l.severity === "high").length;
  console.log(
    `  Loop:    ${loop ? `${loop.id} active` : "(none active)"}  •  ${highLessons} high-severity lesson(s) open`
  );

  const next = tasks
    .filter(t => t.status === "todo")
    .sort((a, b) => prio(a) - prio(b))[0];
  if (next)
    console.log(
      `  Next up: [${next.id}] ${next.title}  → skill: ${next.skill || "(none)"}`
    );
  const wip = tasks.filter(t => t.status === "in_progress");
  if (wip.length)
    console.log(
      `  In progress: ${wip.map(t => `[${t.id}] ${t.title}`).join("; ")}`
    );

  const tail = journal.slice(-5);
  console.log("  " + "-".repeat(68));
  if (tail.length) {
    console.log("  Recent journal:");
    for (const e of tail) {
      console.log(
        `    ${e.ts?.slice(0, 19) || "?"}  [${e.task || "-"}] ${e.action || "?"} → ${e.status || "?"}`
      );
    }
  } else {
    console.log("  Journal is empty — nothing recorded yet.");
  }

  const failures = runValidate();
  console.log("  " + "-".repeat(68));
  console.log(
    failures.length
      ? `  Guardrails: FAIL (${failures.length}) — run \`pb validate\``
      : "  Guardrails: green"
  );
  console.log("");
}

// ============================================================================
//  next — select the next task (and optionally claim it)
// ============================================================================
function cmdNext(args) {
  const tasks = backlogTasks();
  // mode routing: an agent of mode M claims only tasks tagged mode M, plus
  // UNTAGGED tasks (claimable by any mode, so the common case is never starved).
  // The claiming mode is `--mode <id>` if given (lets pooled agents self-specify),
  // else the resolved mode (loop.mode ?? default_mode).
  const agentMode =
    typeof args.mode === "string" && args.mode.trim()
      ? args.mode.trim()
      : resolveModeId();
  const matchesMode = t => {
    const tm = (t.mode && String(t.mode).trim()) || null;
    return !tm || !agentMode || tm === agentMode;
  };
  const todo = tasks.filter(t => t.status === "todo");
  const claimable = todo.filter(
    t => matchesMode(t) && unmetDeps(t, tasks).length === 0
  );
  const candidate = claimable.sort((a, b) => prio(a) - prio(b))[0];

  if (!candidate) {
    if (!todo.length) {
      console.log(
        `No actionable tasks (nothing in "todo"). Add one to ${BACKLOG}.`
      );
      return;
    }
    // distinguish "nothing for my mode" from "blocked by deps".
    const todoForMode = todo.filter(matchesMode);
    if (!todoForMode.length) {
      console.log(
        `No todo tasks match mode "${agentMode || "(none)"}". ${todo.length} task(s) are tagged for other modes.`
      );
      for (const t of todo)
        console.log(
          `  [${t.id}] mode: ${(t.mode && String(t.mode).trim()) || "(untagged)"}`
        );
      return;
    }
    console.log("No claimable todo tasks. Blockers:");
    for (const t of todoForMode) {
      const deps = unmetDeps(t, tasks);
      if (deps.length)
        console.log(`  [${t.id}] waiting on: ${deps.join(", ")}`);
    }
    return;
  }

  const sk = candidate.skill ? skillFor(candidate.skill) : null;
  console.log(`\n  Next task: [${candidate.id}] ${candidate.title}`);
  console.log(`  Priority:  ${prio(candidate)}`);
  if (candidate.notes) console.log(`  Notes:     ${candidate.notes}`);
  console.log(
    `  Skill:     ${candidate.skill || "(none — improvise, then write one)"}`
  );
  if (sk) {
    console.log(`    → open:    ${sk.file}`);
    if (sk.process) console.log(`    → process: ${sk.process}`);
  }
  const checks = taskChecks(candidate);
  if (checks.length) {
    console.log(`  Done means (these must exit 0):`);
    for (const c of checks) console.log(`    $ ${c}`);
  } else {
    console.log(
      `  Checks:    none — "done" is on your honor. Add acceptance_checks if possible.`
    );
  }

  if (args.claim) {
    const loop = activeLoop();
    const journal = readJournal().filter(e => !e.__malformed);
    const blockers = [];
    if (!loop)
      blockers.push("No active loop — run `pb loop new` before claiming work.");
    // one-in-progress is PER AGENT, not global: N agents share one backlog, so a
    // task held by ANOTHER agent must not block this agent. Attribution falls back
    // to the default agent id, so legacy/unstamped in_progress still blocks `agent`.
    const agent = resolveAgentId(args);
    const myWip = tasks.find(
      t => t.status === "in_progress" && taskHolder(t) === agent
    );
    if (myWip)
      blockers.push(
        `You (agent ${agent}) already hold [${myWip.id}] in_progress. Finish or release it before claiming another.`
      );
    // (The cycle-brief / phase blockers below stay SHARED on purpose — all agents
    // work one phase; they are set per-phase and don't serialize concurrent agents.)
    blockers.push(...cycleBlockers(journal));
    if (blockers.length && !args.force) {
      console.log(
        `\n  Refusing to claim [${candidate.id}] — phase-loop guardrail gap:`
      );
      for (const b of blockers) console.log(`    ! ${b}`);
      console.log(
        "  Fix these, then re-run `pb next --claim` (or override with --force, not recommended)."
      );
      console.log("");
      process.exit(1);
    }
    // resolve the mode for THIS candidate (it isn't in_progress yet, so resolve directly):
    // task.mode ?? loop.mode ?? default_mode.
    const claimMode =
      (candidate.mode && String(candidate.mode).trim()) ||
      (loop && loop.mode) ||
      DEFAULT_MODE ||
      undefined;
    // ATOMIC claim: serialize read-verify-write under an O_EXCL lock so two agents
    // racing for the same task resolve to exactly one winner. The candidate was
    // chosen BEFORE the lock; re-verify it is still todo inside the critical section.
    const lockPath = p(BACKLOG_STATE) + ".lock";
    if (!acquireLock(lockPath)) {
      console.error(
        `\n  Could not acquire the claim lock (another agent is claiming). Re-run \`pb next --claim\`.`
      );
      process.exit(1);
    }
    let claimed = false;
    try {
      const fresh = backlogTasks().find(t => t.id === candidate.id);
      if (fresh && fresh.status === "todo") {
        updateBacklogState(candidate.id, {
          status: "in_progress",
          claimed_at: nowISO(),
          loop_id: loop ? loop.id : undefined,
          claimed_by: agent,
          agent_id: agent,
          mode: claimMode,
        });
        claimed = true;
      }
    } finally {
      releaseLock(lockPath);
    }
    if (!claimed) {
      console.error(
        `\n  [${candidate.id}] was claimed by another agent while you were selecting. Re-run \`pb next --claim\` for the next task.`
      );
      process.exit(1);
    }
    console.log(
      `\n  Claimed [${candidate.id}] → in_progress  (agent: ${agent}, mode: ${claimMode || "none"}).`
    );
    if (loop) console.log(`  Loop: ${loop.id}`);
    if (blockers.length)
      console.log(
        `  WARNING: claimed with --force despite ${blockers.length} guardrail gap(s).`
      );
    console.log(
      `  Next: do the work via the skill, then \`pb record --task ${candidate.id} ...\`.`
    );
  } else {
    console.log(`\n  Run with --claim to mark it in_progress.`);
  }
  console.log("");
}

function nextPlanId() {
  const prefix = `plan-${today().replace(/-/g, "")}`;
  const tasks = backlogTasks();
  const n = tasks.filter(t => String(t.id || "").startsWith(prefix)).length + 1;
  return `${prefix}-${String(n).padStart(3, "0")}`;
}

// ============================================================================
//  plan — generate a backlog task from a goal. The agent (or human) refines the
//  acceptance_checks; the command only formalizes the goal into the backlog.
// ============================================================================
function cmdPlan(args) {
  if (!args.goal) {
    console.error(
      'Usage: pb plan --goal "..." [--skill <id>] [--priority <n>] [--check <cmd>] [--manual]'
    );
    console.error(
      "Pass --check multiple times to add multiple acceptance checks."
    );
    process.exit(1);
  }
  const loop = activeLoop();
  if (!loop) {
    console.error(
      "No active loop. Start one with `pb loop new` before planning."
    );
    process.exit(1);
  }
  const journal = readJournal().filter(e => !e.__malformed);
  const blockers = cycleBlockers(journal);
  if (blockers.length) {
    console.error("Refusing to plan — phase-loop guardrail gap:");
    for (const b of blockers) console.error(`  ! ${b}`);
    process.exit(1);
  }
  const skill = args.skill || "run-task";
  const mode = resolveModeId();
  if (skill && !skillForMode(skill, mode)) {
    console.error(`Unknown skill: ${skill}`);
    process.exit(1);
  }
  const priority = Number(args.priority) || 1;
  const checksRaw = args.check || [];
  const checks = (
    Array.isArray(checksRaw) ? checksRaw : checksRaw === true ? [] : [checksRaw]
  )
    .map(s => String(s).trim())
    .filter(Boolean);
  const task = {
    id: nextPlanId(),
    title: String(args.goal).trim(),
    status: "todo",
    skill,
    mode,
    priority,
    acceptance_checks: checks,
  };
  if (args.manual) task.manual = true;
  appendBacklogTask(task);
  console.log(`Planned [${task.id}] ${task.title}`);
  console.log(`  skill: ${skill}`);
  console.log(`  priority: ${priority}`);
  if (checks.length) {
    console.log("  acceptance_checks:");
    for (const c of checks) console.log(`    $ ${c}`);
  } else {
    console.log(
      "  acceptance_checks: none — add executable checks before auto-executing."
    );
  }
}

// ============================================================================
//  record — append a structured journal entry (the agent-first record).
//  Recording done RUNS the task's acceptance_checks first and refuses on
//  failure. --skip-checks is the escape hatch, and it is stamped on the entry.
// ============================================================================
function cmdRecord(args) {
  if (!args.task || !args.action || !args.status) {
    console.error(
      'Usage: pb record --task <id> --action <action> --status <status> [--result <r>] [--files a,b] [--notes "..."] [--agent <name>] [--loop <id>] [--skip-checks] [--require-loop]'
    );
    console.error(`status must be one of: ${ALLOWED_STATUSES.join(", ")}`);
    process.exit(1);
  }
  if (!ALLOWED_STATUSES.includes(args.status)) {
    console.error(
      `Invalid status "${args.status}". Allowed: ${ALLOWED_STATUSES.join(", ")}`
    );
    process.exit(1);
  }

  const task = backlogTasks().find(t => t.id === args.task);
  if (["done", "blocked"].includes(args.status) && !task) {
    console.error(
      `Task not found in backlog: ${args.task}. Cannot record ${args.status} for an unknown task.`
    );
    process.exit(1);
  }
  const loop = args.loop ? loopById(args.loop) : activeLoop();
  if (args["require-loop"] && !loop) {
    console.error(
      "No active loop. Start one with `pb loop new`, or pass --loop <id>."
    );
    process.exit(1);
  }
  const loopId = loop?.id || args.loop || "legacy";
  if (!loop && !args.loop)
    console.log("WARNING: no active loop; recording with loop_id=legacy.");
  let checksOutcome = "none";
  if (args.status === "done" && task) {
    const checks = taskChecks(task);
    if (checks.length && args["skip-checks"]) {
      checksOutcome = "skipped";
      console.log(
        `WARNING: recording done with ${checks.length} acceptance check(s) SKIPPED. The journal will say so.`
      );
    } else if (checks.length) {
      console.log(
        `Running ${checks.length} acceptance check(s) for [${task.id}] before recording done:`
      );
      const results = runChecks(task);
      printCheckResults(results);
      if (results.some(r => !r.ok)) {
        console.error(
          `\nRefusing to record [${task.id}] as done — acceptance checks failed.`
        );
        console.error(
          "Fix the work, or record --status blocked with notes. (--skip-checks overrides, and is stamped on the entry.)"
        );
        process.exit(1);
      }
      checksOutcome = "passed";
    }
  }

  const agentId = resolveAgentId(args);
  const claimRecord = readBacklogState()[args.task] || {};
  const entry = {
    ts: nowISO(),
    loop_id: loopId,
    task: args.task,
    agent: agentId,
    // multi-agent + modes provenance on every journal row:
    agent_id: agentId,
    claimed_by: claimRecord.claimed_by || agentId,
    mode: claimRecord.mode || resolveModeId() || undefined,
    action: args.action,
    status: args.status,
    checks: checksOutcome,
    result: args.result || null,
    files: args.files
      ? String(args.files)
          .split(",")
          .map(s => s.trim())
          .filter(Boolean)
      : [],
    notes: args.notes || null,
  };
  appendJournal(entry);
  console.log(
    `Recorded [${entry.task}] ${entry.action} → ${entry.status}${checksOutcome !== "none" ? ` (checks: ${checksOutcome})` : ""}`
  );

  // keep backlog coherent: sync the task's status when the iteration ends it
  if (task && ["done", "blocked"].includes(args.status)) {
    const existing = readBacklogState()[task.id] || {};
    updateBacklogState(task.id, {
      status: args.status,
      updated_at: entry.ts,
      loop_id: existing.loop_id || (loop ? loop.id : undefined),
    });
    console.log(`Backlog [${task.id}] → ${args.status}.`);
  }
}

// ============================================================================
//  loop — durable loop epochs. A failed loop can be closed/quarantined without
//  erasing its journal rows; the next loop gets a clean active loop_id.
// ============================================================================
function claimedTasksForLoop(loopId) {
  return backlogTasks().filter(t => t.loop_id === loopId);
}
function terminalJournalForTask(loopId, taskId) {
  return readJournal()
    .filter(e => !e.__malformed)
    .some(
      e =>
        e.loop_id === loopId &&
        e.task === taskId &&
        ["done", "blocked"].includes(e.status)
    );
}
function closeGateErrors(loop, args = {}) {
  const errors = [];
  const failures = runValidate();
  if (failures.length)
    errors.push(`Guardrails fail (${failures.length}); run \`pb validate\`.`);

  const wip = backlogTasks().filter(t => t.status === "in_progress");
  if (wip.length)
    errors.push(
      `${wip.length} task(s) still in_progress: ${wip.map(t => t.id).join(", ")}`
    );

  for (const t of claimedTasksForLoop(loop.id)) {
    if (!terminalJournalForTask(loop.id, t.id))
      errors.push(
        `[${t.id}] was claimed in this loop but has no terminal loop-scoped journal record.`
      );
  }

  const live = latestProcessRecords(loop.id).filter(
    proc => proc.status !== "stopped" && pidAlive(proc.pid)
  );
  if (live.length)
    errors.push(
      `${live.length} tracked process(es) still alive: ${live.map(p => p.pid).join(", ")}`
    );

  const journal = readJournal().filter(e => !e.__malformed);
  const reflectTs = lastReflectTs(journal, loop.id);
  if (
    !args["allow-unreflected"] &&
    (!reflectTs || (loop.started_at && reflectTs < loop.started_at))
  ) {
    errors.push(
      'No reflection recorded for this loop; run `pb reflect --notes "..."` or close with --allow-unreflected.'
    );
  }

  const cyc = readCycle();
  if (!cyc.exists || !cyc.stop)
    errors.push(`No cycle stop condition found in ${CYCLE}.`);
  return errors;
}
function writeLoopReport(loop, status, notes = "") {
  const rel = loopArtifactsRel(loop.id, "reports", "close.md");
  const entries = readJournal().filter(
    e => !e.__malformed && e.loop_id === loop.id
  );
  const lines = [
    `# Loop Close — ${loop.id}`,
    "",
    `- status: ${status}`,
    `- started_at: ${loop.started_at || ""}`,
    `- closed_at: ${loop.closed_at || ""}`,
    `- journal lines: ${loop.journal?.first_line ?? "?"}-${loop.journal?.last_line ?? "?"}`,
    notes ? `- notes: ${notes}` : null,
    "",
    "## Journal",
    "",
  ].filter(Boolean);
  if (!entries.length) lines.push("_No loop-scoped journal entries._");
  for (const e of entries)
    lines.push(
      `- ${e.ts?.slice(0, 19) || "?"} [${e.task || "-"}] ${e.action || "?"} -> ${e.status || "?"}`
    );
  ensureDir(dirname(rel));
  writeFileSync(p(rel), lines.join("\n") + "\n", "utf8");
  return rel;
}
function writeQuarantine(loop, reason, stopped) {
  const rel = loopArtifactsRel(loop.id, "quarantine.md");
  const lines = [
    `# Loop Quarantine — ${loop.id}`,
    "",
    `- reason: ${reason}`,
    `- started_at: ${loop.started_at || ""}`,
    `- closed_at: ${loop.closed_at || ""}`,
    `- journal lines: ${loop.journal?.first_line ?? "?"}-${loop.journal?.last_line ?? "?"}`,
    "",
    "## Processes",
    "",
  ];
  if (!stopped.length) lines.push("_No live tracked processes stopped._");
  for (const proc of stopped)
    lines.push(
      `- pid ${proc.pid}: ${proc.status} (${proc.cmd || proc.command || ""})`
    );
  lines.push(
    "",
    "## Next",
    "",
    "Run `pb learn --loop " +
      loop.id +
      ' --source user --notes "..."` before starting the next loop.'
  );
  ensureDir(dirname(rel));
  writeFileSync(p(rel), lines.join("\n") + "\n", "utf8");
  return rel;
}
function failedLoopNeedsLearning(state) {
  return (
    [...state.loops]
      .reverse()
      .find(
        l =>
          l.status === "failed" &&
          !l.learning_skipped &&
          lessonsForLoop(l.id).length === 0
      ) || null
  );
}
function seedCycleFromLoop(loop, args) {
  const cur = readCycle();
  const phase = (Number.isInteger(cur.phase) ? cur.phase : 0) + 1;
  const high = openLessons().filter(l => l.severity === "high");
  const prior = high.length
    ? high
        .map(
          l =>
            `- [${l.id}] ${l.problem || l.notes || l.raw_notes || "(no problem)"}`
        )
        .join("\n")
    : "No open high-severity lessons.";
  const challenges =
    args["from-lessons"] && high.length
      ? high
          .map(
            l =>
              `- Avoid repeating ${l.loop_id || "prior loop"}: ${l.problem || l.notes || l.raw_notes || "(no problem)"}`
          )
          .join("\n")
      : null;
  const conflicts =
    args["from-lessons"] && high.length
      ? "Review open high-severity lessons before following host memory or old assumptions."
      : null;
  ensureDir(dirname(CYCLE));
  writeFileSync(
    p(CYCLE),
    cycleTemplate({
      phase,
      goal: args.goal || loop.goal,
      stop: args.stop || loop.stop,
      challenges,
      priorChallenges: prior,
      conflicts,
    }),
    "utf8"
  );
}
function cmdLoopRunAuto(args) {
  const loop = activeLoop();
  if (!loop) {
    console.error(
      "No active loop. Start one with `pb loop new` before running auto."
    );
    process.exit(1);
  }
  const journal = readJournal().filter(e => !e.__malformed);
  const blockers = cycleBlockers(journal);
  if (blockers.length) {
    console.error("Refusing auto run — phase-loop guardrail gap:");
    for (const b of blockers) console.error(`  ! ${b}`);
    process.exit(1);
  }
  const maxTasks = Number(args["max-tasks"]) || Infinity;
  const retry = Number(args.retry) || 3;
  const dryRun = args["dry-run"];
  // --defer-blocked: keep going past a faulted task instead of stopping the whole
  // run. A blocked task drops out of the `todo` filter, so the run naturally ends
  // when nothing claimable remains. If anything was deferred, the terminal status
  // is `stalled` (not `done`) — done is still earned only by passing checks.
  const defer = !!args["defer-blocked"];
  let tasksCompleted = 0;
  let deferred = 0;
  let finalStatus = "done";
  console.log(
    `\nStarting autonomous run for [${loop.id}] (max-tasks=${maxTasks === Infinity ? "unlimited" : maxTasks}, retry=${retry}${defer ? ", defer-blocked" : ""})${dryRun ? " [DRY RUN]" : ""}\n`
  );
  while (tasksCompleted < maxTasks) {
    const tasks = backlogTasks();
    const todo = tasks.filter(t => t.status === "todo");
    const claimable = todo
      .filter(t => unmetDeps(t, tasks).length === 0)
      .sort((a, b) => prio(a) - prio(b));
    const candidate = claimable[0];
    if (!candidate) {
      console.log("No actionable tasks. Autonomous run complete.");
      break;
    }
    if (candidate.manual) {
      if (defer) {
        recordAuto(
          loop,
          candidate,
          "blocked",
          "none",
          "Deferred: marked manual, requires human approval."
        );
        console.log(`[${candidate.id}] → blocked (manual, deferred)`);
        deferred++;
        continue;
      }
      console.log(
        `Stopping auto run: [${candidate.id}] is marked manual and requires human approval.`
      );
      finalStatus = "blocked";
      break;
    }
    const cmds = taskCommands(candidate);
    const checks = taskChecks(candidate);
    if (!cmds.length && !checks.length) {
      if (defer) {
        recordAuto(
          loop,
          candidate,
          "blocked",
          "none",
          "Deferred: no executable commands or checks (honor-only)."
        );
        console.log(`[${candidate.id}] → blocked (honor-only, deferred)`);
        deferred++;
        continue;
      }
      console.log(
        `Stopping auto run: [${candidate.id}] has no executable commands or checks (honor-only).`
      );
      finalStatus = "blocked";
      break;
    }
    if (dryRun) {
      console.log(`[DRY RUN] would claim [${candidate.id}] ${candidate.title}`);
      console.log(
        `[DRY RUN] would run ${cmds.length} command(s) and ${checks.length} check(s).`
      );
      break;
    }
    updateBacklogState(candidate.id, {
      status: "in_progress",
      claimed_at: nowISO(),
      loop_id: loop.id,
    });
    console.log(`Claimed [${candidate.id}] ${candidate.title}`);
    let cmdResults = [];
    if (cmds.length) {
      console.log(`Running ${cmds.length} command(s):`);
      cmdResults = runCommands(candidate);
      printCommandResults(cmdResults);
    }
    if (cmdResults.some(r => !r.ok)) {
      const failed = cmdResults.find(r => !r.ok);
      recordAuto(
        loop,
        candidate,
        "blocked",
        "none",
        `Auto-run command failed: ${failed.cmd}`
      );
      console.error(`[${candidate.id}] → blocked (command failed)`);
      if (defer) {
        deferred++;
        continue;
      }
      finalStatus = "blocked";
      break;
    }
    let passed = false;
    let checkResults = [];
    for (let attempt = 0; attempt <= retry; attempt++) {
      if (attempt > 0) console.log(`  Retry ${attempt}/${retry}...`);
      checkResults = runChecks(candidate);
      if (!checkResults.some(r => !r.ok)) {
        passed = true;
        break;
      }
      printCheckResults(checkResults);
    }
    if (passed) {
      recordAuto(
        loop,
        candidate,
        "done",
        checks.length ? "passed" : "none",
        "Auto-executed and verified."
      );
      console.log(`[${candidate.id}] → done`);
      tasksCompleted++;
    } else {
      recordAuto(
        loop,
        candidate,
        "blocked",
        "failed",
        `Auto-run acceptance checks failed after ${retry} retries.`
      );
      console.error(`[${candidate.id}] → blocked (checks failed)`);
      if (defer) {
        deferred++;
        continue;
      }
      finalStatus = "blocked";
      break;
    }
  }
  // In defer mode the run never breaks on a fault, so finalStatus is still 'done'
  // here. If anything was deferred, the backlog did not fully drain — say so.
  if (defer && deferred > 0 && finalStatus === "done") finalStatus = "stalled";
  console.log(
    `\nAutonomous run finished. ${tasksCompleted} task(s) completed${deferred ? `, ${deferred} deferred (blocked)` : ""}. Status: ${finalStatus}.`
  );
  if (tasksCompleted > 0 || finalStatus === "blocked" || deferred > 0) {
    try {
      cmdReport(args);
    } catch {
      /* report is best-effort */
    }
  }
}

function cmdLoop(args) {
  const sub = args._[0] || "status";
  if (sub === "new") {
    const state = readLoops();
    const active = state.active
      ? state.loops.find(l => l.id === state.active)
      : null;
    if (active && active.status === "active") {
      console.error(
        `Refusing: loop already active: ${active.id}. Close it first with \`pb loop close\`.`
      );
      process.exit(1);
    }
    const failed = failedLoopNeedsLearning(state);
    if (failed) {
      if (!args["skip-learning"]) {
        console.error(
          `Refusing: failed loop ${failed.id} has no learning reflection.`
        );
        console.error(
          `Run \`pb learn --loop ${failed.id} --source user --notes "..."\`, or use --skip-learning "reason".`
        );
        process.exit(1);
      }
      failed.learning_skipped = {
        ts: nowISO(),
        reason:
          args["skip-learning"] === true
            ? "no reason supplied"
            : String(args["skip-learning"]),
      };
    }
    const id = nextLoopId(state);
    const loop = {
      id,
      status: "active",
      started_at: nowISO(),
      closed_at: null,
      goal: args.goal || "",
      stop: args.stop || "",
      journal: { first_line: journalLineCount() + 1, last_line: null },
      artifacts: loopArtifactsRel(id),
      reason: null,
    };
    state.active = id;
    state.loops.push(loop);
    for (const d of ["logs", "reports", "snapshots"])
      ensureDir(loopArtifactsRel(id, d));

    // --fresh: this loop starts from the current repo state, not the existing task
    // model. Archive the backlog as-is (nothing is lost) and reset it to empty, so a
    // stale backlog (tasks whose "done" artifacts no longer exist on disk, or whose
    // remaining tasks assume them) can't be silently inherited and claimed.
    let resetNote = null;
    if (args.fresh) {
      const tasks = backlogTasks();
      if (tasks.length) {
        const snapshotRel = loopArtifactsRel(
          id,
          "backlog-snapshot-pre-fresh.yaml"
        );
        ensureDir(dirname(snapshotRel));
        writeFileSync(
          p(snapshotRel),
          yaml.dump({ tasks }, { lineWidth: 100 }),
          "utf8"
        );
        writeBacklog({ tasks: [] });
        loop.reset_backlog = {
          archived_to: snapshotRel,
          count: tasks.length,
          ts: nowISO(),
        };
        resetNote = `Backlog reset for a ground-up loop — ${tasks.length} prior task(s) archived to ${snapshotRel}.`;
      } else {
        resetNote =
          "Backlog reset requested, but it was already empty — nothing archived.";
      }
    }

    writeLoops(state);
    if (args.goal || args.stop || args["from-lessons"])
      seedCycleFromLoop(loop, args);
    console.log(`Opened loop: ${id}`);
    console.log(`Artifacts: ${loop.artifacts}`);
    if (resetNote) console.log(resetNote);
    console.log(
      args.fresh
        ? "Next: add backlog tasks that reflect the current repo state, then `pb status`."
        : "Next: `pb status`, then claim work or record progress."
    );
    return;
  }

  if (sub === "status") {
    const state = readLoops();
    const loop = activeLoop();
    console.log("\nLoop state:");
    console.log(`  active: ${loop ? loop.id : "(none)"}`);
    console.log(`  total:  ${state.loops.length}`);
    if (loop) {
      const entries = readJournal().filter(
        e => !e.__malformed && e.loop_id === loop.id
      );
      const live = latestProcessRecords(loop.id).filter(
        p => p.status !== "stopped" && pidAlive(p.pid)
      );
      const errors = closeGateErrors(loop, { "allow-unreflected": true });
      console.log(`  started: ${String(loop.started_at).slice(0, 19)}`);
      console.log(`  journal entries: ${entries.length}`);
      console.log(`  live tracked processes: ${live.length}`);
      console.log(
        errors.length
          ? `  close gate: blocked (${errors.length})`
          : "  close gate: clear (reflection may still be required)"
      );
    }
    const failed = failedLoopNeedsLearning(state);
    if (failed) console.log(`  learning needed: ${failed.id}`);
    console.log("");
    return;
  }

  if (sub === "close") {
    const status = args.status || "done";
    if (!["done", "failed", "abandoned"].includes(status)) {
      console.error(
        'Usage: pb loop close --status <done|failed|abandoned> [--reason "..."] [--allow-unreflected]'
      );
      process.exit(1);
    }
    const state = readLoops();
    const loop = activeLoop();
    if (!loop) {
      console.error("No active loop to close.");
      process.exit(1);
    }
    if (status === "done") {
      const errors = closeGateErrors(loop, args);
      if (errors.length) {
        console.error(`Refusing to close ${loop.id} as done:`);
        for (const e of errors) console.error(`  - ${e}`);
        process.exit(1);
      }
    }
    const stored = state.loops.find(l => l.id === loop.id);
    stored.status = status;
    stored.closed_at = nowISO();
    stored.reason = args.reason || null;
    stored.journal = {
      ...(stored.journal || {}),
      last_line: journalLineCount(),
    };
    if (args["allow-unreflected"])
      stored.allow_unreflected = {
        ts: nowISO(),
        reason:
          args["allow-unreflected"] === true
            ? "operator override"
            : String(args["allow-unreflected"]),
      };
    let artifact = null;
    if (status === "failed" || status === "abandoned") {
      const stopped = stopLoopProcesses(loop.id);
      artifact = writeQuarantine(stored, args.reason || status, stopped);
    } else {
      artifact = writeLoopReport(stored, status, args.reason || "");
    }
    state.active = null;
    writeLoops(state);
    console.log(`Closed loop ${loop.id} -> ${status}.`);
    if (artifact) console.log(`Artifact: ${artifact}`);
    if (status === "failed")
      console.log(
        `Next: \`pb learn --loop ${loop.id} --source user --notes "..."\`.`
      );
    return;
  }

  if (sub === "quarantine") {
    const id = args._[1] || args.loop;
    if (!id) {
      console.error("Usage: pb loop quarantine <loop_id>");
      process.exit(1);
    }
    const state = readLoops();
    const loop = state.loops.find(l => l.id === id);
    if (!loop) {
      console.error(`Loop not found: ${id}`);
      process.exit(1);
    }
    loop.status = "quarantined";
    loop.quarantined_at = nowISO();
    writeLoops(state);
    console.log(`Loop ${id} -> quarantined.`);
    return;
  }

  if (sub === "run") {
    if (args.auto) {
      cmdLoopRunAuto(args);
      return;
    }
    console.error(
      "Usage: pb loop run --auto [--max-tasks N] [--retry N] [--dry-run]"
    );
    process.exit(1);
  }

  console.error(`Unknown loop command: ${sub}`);
  process.exit(1);
}

// ============================================================================
//  learn — structured user/agent reflection. Raw lessons stay in lessons.ndjson;
//  durable rules, repair tasks, and skills are explicit promotions.
// ============================================================================
function cmdLearn(args) {
  if (args._[0] === "status") {
    const lessons = readLessons();
    const open = lessons.filter(
      l => l.status !== "promoted" && l.status !== "closed"
    );
    console.log("\nLessons:");
    console.log(`  total: ${lessons.length}`);
    console.log(`  open:  ${open.length}`);
    for (const l of open) {
      console.log(
        `  [${l.id}] ${l.severity || "medium"} ${l.loop_id || "legacy"} -> ${l.promotion || "journal"}: ${l.problem || l.notes || l.raw_notes || ""}`
      );
    }
    console.log("");
    return;
  }

  const loop = args.loop || activeLoop()?.id || latestLoop()?.id || "legacy";
  const notes = args.notes || args.problem || args._.join(" ");
  if (!notes) {
    console.error(
      'Usage: pb learn --loop <id> --source user --notes "what went wrong" [--severity high] [--promotion memory|backlog|skill|journal] [--target <file-or-task>]'
    );
    process.exit(1);
  }
  const promotion = args.promotion || "journal";
  if (!["journal", "memory", "backlog", "skill"].includes(promotion)) {
    console.error("promotion must be one of: journal, memory, backlog, skill");
    process.exit(1);
  }
  const entry = {
    id: nextLessonId(),
    loop_id: loop,
    source: args.source || "agent",
    severity: args.severity || "medium",
    problem: args.problem || notes,
    root_cause: args["root-cause"] || args.root_cause || null,
    promotion,
    promotion_target: args.target || null,
    status: args.status || "open",
    applies_to: args.applies_to
      ? String(args.applies_to)
          .split(",")
          .map(s => s.trim())
          .filter(Boolean)
      : [],
    raw_notes: notes,
    created_at: nowISO(),
  };
  appendNdjson(LESSONS, entry);
  console.log(`Recorded lesson ${entry.id} for ${loop} -> ${promotion}.`);
  if (promotion !== "journal" && !entry.promotion_target) {
    console.log(
      "Promotion target is not set yet; add a backlog task or update the relevant memory/skill file before closing the lesson."
    );
  }
}

// ============================================================================
//  run / ps / stop — lightweight loop-scoped process tracking.
// ============================================================================
function cmdRun(args) {
  const loop = activeLoop();
  if (!loop) {
    console.error(
      "No active loop. Start one with `pb loop new` before `pb run`."
    );
    process.exit(1);
  }
  const parts = args["--"] || args._;
  if (!parts?.length) {
    console.error("Usage: pb run -- <command>");
    process.exit(1);
  }
  const cmd = parts.join(" ");
  const file = parts[0];
  const argv = parts.slice(1);
  const stamp = nowISO().replace(/[:.]/g, "-");
  const safe = String(file).replace(/[^a-zA-Z0-9._-]/g, "_") || "command";
  const outRel = loopArtifactsRel(loop.id, "logs", `${stamp}-${safe}.out.log`);
  const errRel = loopArtifactsRel(loop.id, "logs", `${stamp}-${safe}.err.log`);
  ensureDir(dirname(outRel));
  const child = spawnCommand(file, argv, {
    cwd: ROOT,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", openSync(p(outRel), "a"), openSync(p(errRel), "a")],
  });
  child.unref();
  appendNdjson(PROCESSES, {
    ts: nowISO(),
    loop_id: loop.id,
    pid: child.pid,
    cmd,
    cwd: ".",
    status: "running",
    logs: { stdout: outRel, stderr: errRel },
  });
  console.log(`Started [${loop.id}] pid ${child.pid}: ${cmd}`);
  console.log(`Logs: ${outRel} / ${errRel}`);
}

function cmdPs(args) {
  const loopId = args.loop || activeLoop()?.id;
  const rows = latestProcessRecords(loopId || null);
  console.log("\nTracked processes:");
  if (!rows.length) console.log("  (none)");
  for (const proc of rows) {
    const alive = proc.status !== "stopped" && pidAlive(proc.pid);
    console.log(
      `  ${proc.loop_id || "legacy"} pid ${proc.pid} ${alive ? "alive" : "not-alive"} ${proc.status || ""} ${proc.cmd || ""}`
    );
  }
  console.log("");
}

function cmdStop(args) {
  const loopId = args.loop || activeLoop()?.id;
  if (!loopId) {
    console.error("Usage: pb stop --loop <loop_id>");
    process.exit(1);
  }
  const stopped = stopLoopProcesses(loopId);
  console.log(`Stopped ${stopped.length} tracked process(es) for ${loopId}.`);
}

// ============================================================================
//  report — roll the agent-first journal up into a human artifact
// ============================================================================
function cmdReport(args) {
  const journal = readJournal().filter(e => !e.__malformed);
  const filtered = args.since
    ? journal.filter(e => (e.ts || "") >= args.since)
    : journal;
  const tasks = backlogTasks();

  const counts = Object.fromEntries(ALLOWED_STATUSES.map(s => [s, 0]));
  for (const t of tasks) if (counts[t.status] !== undefined) counts[t.status]++;

  const byTask = new Map();
  for (const e of filtered) {
    if (!byTask.has(e.task)) byTask.set(e.task, []);
    byTask.get(e.task).push(e);
  }
  const titleOf = id => tasks.find(t => t.id === id)?.title || "";
  const taskById = new Map(tasks.map(t => [t.id, t]));

  const lines = [];
  lines.push(`# ${master?.name || "Playbook"} Report — ${today()}`);
  lines.push("");
  lines.push(
    `_Generated ${nowISO()} from \`${JOURNAL}\`${args.since ? ` (since ${args.since})` : ""}._`
  );
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Status | Count |");
  lines.push("| --- | --- |");
  for (const s of ALLOWED_STATUSES) lines.push(`| ${s} | ${counts[s]} |`);
  lines.push(`| journal entries | ${filtered.length} |`);
  lines.push(`| loops | ${readLoops().loops.length} |`);
  lines.push(`| open lessons | ${openLessons().length} |`);
  lines.push("");

  lines.push("## Activity by task");
  lines.push("");
  if (byTask.size === 0) {
    lines.push("_No journal activity in range._");
  } else {
    for (const [taskId, entries] of byTask) {
      lines.push(`### [${taskId}] ${titleOf(taskId)}`.trimEnd());
      lines.push("");
      for (const e of entries) {
        const files = e.files?.length
          ? ` _(files: ${e.files.join(", ")})_`
          : "";
        const notes = e.notes ? ` — ${e.notes}` : "";
        const checks = reportCheckMarker(e, taskById.get(e.task));
        const loop = e.loop_id ? ` _(${e.loop_id})_` : "";
        lines.push(
          `- \`${e.ts?.slice(0, 19)}\`${loop} **${e.action}** → ${e.status}${checks}${notes}${files}`
        );
      }
      lines.push("");
    }
  }

  lines.push("## Open backlog");
  lines.push("");
  const open = tasks
    .filter(t => t.status !== "done")
    .sort((a, b) => prio(a) - prio(b));
  if (open.length === 0) {
    lines.push("_Backlog clear._");
  } else {
    lines.push("| Priority | ID | Status | Task | Skill | Gate |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const t of open)
      lines.push(
        `| ${prio(t)} | ${t.id} | ${t.status} | ${t.title} | ${t.skill || "-"} | ${gateQuality(t)} |`
      );
  }
  lines.push("");

  ensureDir(REPORTS_DIR);
  const outRel = join(REPORTS_DIR, `report-${today()}.md`);
  writeFileSync(p(outRel), lines.join("\n"), "utf8");
  console.log(`Report written: ${outRel}`);
}

// ============================================================================
//  list — print the indices
// ============================================================================
function listModes() {
  const cat = readData("modes/index.yaml");
  const entries = Array.isArray(cat?.modes) ? cat.modes : [];
  console.log(`\nModes (default: ${DEFAULT_MODE || "none"} · * = default):`);
  if (!entries.length) {
    console.log("  (no mode catalog — create modes/index.yaml)");
  } else {
    for (const m of entries) {
      const mark = m.id === DEFAULT_MODE ? "*" : " ";
      const abstract = String(m.abstract || m.description || "")
        .replace(/\s+/g, " ")
        .trim();
      console.log(`  ${mark} ${String(m.id).padEnd(12)} ${abstract}`);
    }
  }
  console.log("\nInside a mode: `pb mode show <id>`.\n");
}

function cmdList(args) {
  const which = args._[0];
  if (which === "modes") {
    listModes();
    return;
  }
  const mode = resolveModeId();
  if (!which || which === "processes") {
    console.log(`\nProcesses (mode: ${mode || "none"}):`);
    for (const x of resolvedProcessEntries())
      console.log(
        `  ${String(x.id).padEnd(18)} ${x.file}${x.owner ? `  (${x.owner})` : ""}`
      );
  }
  if (!which || which === "skills") {
    console.log(`\nSkills (mode: ${mode || "none"}):`);
    for (const x of resolvedSkillEntries())
      console.log(
        `  ${String(x.id).padEnd(18)} ${x.file}${x.process ? `  → ${x.process}` : ""}`
      );
  }
  console.log("");
}

// ============================================================================
//  init — ensure the runtime layout exists (safe: never overwrites content)
// ============================================================================
function cmdInit() {
  for (const dir of [MEMORY_DIR, REPORTS_DIR]) ensureDir(dir);
  const created = [];
  if (!existsSync(p(JOURNAL))) {
    writeFileSync(p(JOURNAL), "", "utf8");
    created.push(JOURNAL);
  }
  const gitkeep = join(REPORTS_DIR, ".gitkeep");
  if (!existsSync(p(gitkeep))) {
    writeFileSync(p(gitkeep), "", "utf8");
    created.push(gitkeep);
  }
  if (!existsSync(p(BACKLOG))) {
    writeBacklog({
      tasks: [
        {
          id: "T1",
          title: "First task",
          status: "todo",
          skill: "run-task",
          priority: 1,
          acceptance_checks: ["node scripts/pb.mjs validate"],
          notes: "Replace me.",
          created: today(),
        },
      ],
    });
    created.push(BACKLOG);
  }
  console.log(
    created.length
      ? `Initialized: ${created.join(", ")}`
      : "Already initialized — runtime files present."
  );
  console.log(
    "Note: init only creates missing runtime files; it never overwrites your content."
  );
  console.log(
    "If this is an empty playbook with no processes/skills yet, run `node scripts/pb.mjs bootstrap`."
  );
}

// ============================================================================
//  bootstrap — seed the minimal operating playbook (safe: never overwrites)
// ----------------------------------------------------------------------------
//  `init` hydrates runtime state. `bootstrap` covers the earlier lifecycle stage:
//  an empty playbook folder that has structure but no runnable process/skill.
// ============================================================================
function cmdBootstrap() {
  const created = [];

  writeIfMissing(
    "playbook.yaml",
    `name: agent-playbook
version: 0.3.5
description: Repo-local agent playbook.
entry: SKILL.md

north_star: >-
  (one invariant sentence — what this project drives toward; fill this before claiming work)

paths:
  root: .
  scripts: scripts
  processes: processes
  skills: skills
  memory: memory
  artifacts: artifacts
  reports: artifacts/reports

index:
  cli: scripts/pb.mjs
  processes_index: processes/index.yaml
  skills_index: skills/index.yaml
  memory:
    project_memory: memory/project-memory.md
    backlog: memory/backlog.yaml
    journal: memory/journal.ndjson
    cycle: memory/cycle.md
    loops: memory/loops.yaml
    lessons: memory/lessons.ndjson
    processes: memory/processes.ndjson
  artifacts:
    reports: artifacts/reports

loop:
  description: Orient -> Select -> Act -> Verify -> Record -> Report -> repeat.

fixation:
  - Re-anchor to playbook.yaml at the start of every loop iteration. The master wins.
  - Act only inside this folder. The playbook is self-contained (carry-on).
  - Skills-first. Find the matching skill before improvising. If none fits, write one.
  - Done means the task's acceptance_checks (shell commands) exit 0. Record only on pass.
  - Record every iteration to memory/journal.ndjson via pb record. No silent work.
  - A task's acceptance_checks must test the task's own artifacts — pb validate alone is not a task check.
  - Memory precedence: folder (north_star + memory/) outranks agent/host memory on project matters.

guardrails:
  validate_command: node scripts/pb.mjs validate
  allowed_statuses: [todo, in_progress, blocked, done]

hardening:
  principle: Externalize state to disk + re-anchor cheaply + auto-re-inject the anchor.
  commands:
    anchor: node scripts/pb.mjs anchor
    checkpoint: node scripts/pb.mjs checkpoint
  re_anchor: Call anchor at the start of every iteration and after every few actions.
`,
    created
  );

  writeIfMissing(
    "SKILL.md",
    `# Playbook Skill

## Startup (every session)
1. Read \`playbook.yaml\` — the master (north_star, fixation, loop contract).
2. Read \`memory/project-memory.md\` — durable operating rules.
3. Run \`node scripts/pb.mjs status\` — orient on backlog + journal + guardrails.

## The loop
orient → select → act → verify → record → report

- Select: \`node scripts/pb.mjs next --claim\` — prints the task and its acceptance_checks.
  Claiming is refused if there's no active loop or the cycle brief is missing/stale/has an
  unanswered Q5 (see Phase loop below); fix the precondition or override with \`--force\`
  (not recommended).
- "Done" is enforced: \`pb record --status done\` runs the task's acceptance_checks (shell commands)
  and refuses if they fail. Exit codes, not prose.
- Roll up: \`node scripts/pb.mjs report\`.

## Phase loop (open each phase, close it)
- Open: \`node scripts/pb.mjs cycle --new\` — confirm the cycle brief (goal / challenges / stop).
- Close: \`node scripts/pb.mjs reflect\` — compare done tasks to the north_star; record notes.
- \`pb checkpoint\` warns on drift (missing/stale brief, done tasks awaiting reflection); \`pb next
  --claim\` enforces the missing/stale-brief part instead of just warning.

## Loop epochs and learning
- Open scoped work with \`node scripts/pb.mjs loop new --goal "..." --stop "..."\`.
- Default continues from the existing backlog. If it's stale relative to disk (assumes earlier
  "done" artifacts/paths that no longer exist), use \`loop new --fresh\` instead — it archives the
  current backlog (nothing lost) and resets it to empty for a ground-up loop.
- Close clean work with \`pb loop close --status done\`.
- Close contaminated work with \`pb loop close --status failed --reason "..."\`, then record
  reflection with \`pb learn --loop <id> --source user --notes "..."\` before the next loop.

## Memory precedence
Your host memory is the PAST; this folder is the project PRESENT/FUTURE. On any project conflict,
the folder wins — surface the conflict, do not silently follow host memory.
`,
    created
  );

  writeIfMissing(
    PROJECT_MEMORY,
    `# Project Memory

Durable repo-local facts for agents.

## Operating rules

1. Re-anchor to playbook.yaml at the start of every loop.
2. Keep work inside this playbook folder unless the task explicitly targets the parent repo.
3. Give every task executable acceptance_checks where possible — exit codes, not prose.
4. Record every completed or blocked iteration with pb record.
`,
    created
  );

  writeIfMissing(
    PROCESS_INDEX,
    `name: canonical-processes
version: 1.0.0
processes:
  - id: run-task
    file: processes/run-task.yaml
    owner: core
    summary: Generic task execution from claim to record/report.
`,
    created
  );

  writeIfMissing(
    SKILL_INDEX,
    `name: repo-skills
version: 1.0.0
skills:
  - id: run-task
    file: skills/run-task/SKILL.md
    process: run-task
    summary: Generic task execution.
`,
    created
  );

  writeIfMissing(
    "processes/run-task.yaml",
    `name: run-task
version: 1.0.0
purpose: Take one backlog task from claim to verified, recorded outcome.
canonical_steps:
  - step: 1
    name: Orient
    requirements:
      - Read playbook.yaml and SKILL.md.
      - Run node scripts/pb.mjs status.
  - step: 2
    name: Act
    requirements:
      - Make the smallest change that satisfies the task.
      - Stay inside the intended repo/playbook scope.
  - step: 3
    name: Verify
    requirements:
      - Run node scripts/pb.mjs validate (structure) and node scripts/pb.mjs validate --task <id> (the task's checks).
  - step: 4
    name: Record and report
    requirements:
      - Run node scripts/pb.mjs record (recording done re-runs the checks and refuses on failure).
      - Run node scripts/pb.mjs report when useful for human handoff.
`,
    created
  );

  writeIfMissing(
    "skills/run-task/SKILL.md",
    `# Run Task

Use this skill for any backlog item that does not have a more specific skill.

Canonical process: \`processes/run-task.yaml\`.

Steps:
1. Read the task from \`node scripts/pb.mjs next --claim\` — it prints the task's acceptance_checks.
2. Do the smallest safe change that satisfies them.
3. Verify: \`node scripts/pb.mjs validate\` and \`node scripts/pb.mjs validate --task <id>\`.
4. Record: \`node scripts/pb.mjs record --task <id> --action execute --status done --notes "..."\`.
   Recording done re-runs the checks; it refuses if they fail.
5. Run \`node scripts/pb.mjs report\` when a human-facing rollup is useful.
`,
    created
  );

  cmdInit();
  console.log(
    created.length
      ? `Bootstrapped: ${created.join(", ")}`
      : "Already bootstrapped — minimal process/skill files present."
  );
  console.log(
    "Note: bootstrap creates missing minimal files only; it never overwrites your content."
  );
}

// ============================================================================
//  anchor — the tiny constitution, cheap to re-inject so the playbook never
//  decays out of attention. `--brief` is a few lines safe to inject every turn.
//  Designed to be called from runtime hooks; never throws.
// ============================================================================
// ============================================================================
//  modes — resolve the active persona pack and render its anchor slice. A mode
//  NEVER weakens the floor; it only adds a `directive` (persona) + principles.
//  Resolution: task.mode (the in_progress task) ?? loop.mode (active loop) ??
//  master.default_mode. An empty directive is intentional and NON-BLOCKING:
//  it means "inherit the host agent's system prompt".
// ============================================================================
function loadMode(id) {
  if (!id || !(id in MODES)) return null;
  try {
    const doc = readData(MODES[id]);
    return doc && typeof doc === "object" ? doc : null;
  } catch {
    return null;
  }
}
function resolveModeId() {
  const wip = backlogTasks().find(t => t.status === "in_progress");
  if (wip && typeof wip.mode === "string" && wip.mode.trim())
    return wip.mode.trim();
  const loop = activeLoop();
  if (loop && typeof loop.mode === "string" && loop.mode.trim())
    return loop.mode.trim();
  return DEFAULT_MODE;
}
function modeHasDirective(doc) {
  return !!(doc && typeof doc.directive === "string" && doc.directive.trim());
}
// One tiny additive line for the anchor (brief + full both start with this).
function modeAnchorLine(id, doc) {
  if (!id)
    return "Mode: (none — set `default_mode` in the master or run `pb mode set <id>`)";
  if (!doc) return `Mode: ${id} (UNREGISTERED — not in the modes registry)`;
  const names = Array.isArray(doc.principles)
    ? doc.principles.map(pr => pr.id).filter(Boolean)
    : [];
  const tail = names.length ? ` · principles: ${names.join(", ")}` : "";
  const persona = modeHasDirective(doc)
    ? ""
    : " · directive: inherits host prompt";
  return `Mode: ${id}${tail}${persona}`;
}

function cmdMode(args) {
  const sub = args._[0] || "show";
  if (sub === "show") {
    // `pb mode show` -> the active mode; `pb mode show <id>` -> that named mode's menu.
    const explicit = args._[1] ? String(args._[1]).trim() : null;
    const id = explicit || resolveModeId();
    const doc = loadMode(id);
    console.log(`\n${explicit ? "Mode" : "Active mode"}: ${id || "(none)"}`);
    if (!id) {
      console.log(
        "No `default_mode` in the master and no loop/task override. Set one with `pb mode set <id>`.\n"
      );
      return;
    }
    if (!doc) {
      console.log(
        `(UNREGISTERED — "${id}" is not in the modes registry: ${Object.keys(MODES).join(", ") || "none"})\n`
      );
      return;
    }
    if (doc.description)
      console.log(
        `Description: ${String(doc.description).replace(/\s+/g, " ").trim()}`
      );
    if (modeHasDirective(doc)) {
      console.log("Directive:");
      console.log(
        doc.directive
          .trim()
          .split("\n")
          .map(l => `  ${l}`)
          .join("\n")
      );
    } else {
      // Empty directive is intended and non-blocking — report, never gate.
      console.log(
        "Directive: (empty by intent — inherits the host agent's system prompt)"
      );
    }
    const prs = Array.isArray(doc.principles) ? doc.principles : [];
    if (prs.length) {
      console.log("Principles:");
      for (const pr of prs) {
        const c = pr.kind === "check" ? ` (check: ${pr.check})` : "";
        console.log(`  - [${pr.kind}] ${pr.id}${c} — ${pr.text || ""}`);
      }
    }
    // The "what's inside" view — this mode's resolved menu (engine globals ∪ pack-local).
    const sks = modeSkillEntries(doc);
    const procs = modeProcessEntries(doc);
    console.log(`Skills (${sks.length}):`);
    for (const s of sks)
      console.log(
        `  ${String(s.id).padEnd(20)}${s.process ? ` → ${s.process}` : ""}`
      );
    console.log(`Processes (${procs.length}):`);
    for (const pr of procs)
      console.log(
        `  ${String(pr.id).padEnd(20)}${pr.owner ? ` (${pr.owner})` : ""}`
      );
    console.log(
      `Resolved via: task.mode ?? loop.mode ?? default_mode (${DEFAULT_MODE || "unset"})\n`
    );
    return;
  }
  if (sub === "skills" || sub === "processes") {
    // Machine-readable menu: bare ids (one per line) for the named/active mode.
    // Used by the orchestrator to detect a scaffold capability gap.
    const explicit = args._[1] ? String(args._[1]).trim() : null;
    const id = explicit || resolveModeId();
    const doc = loadMode(id);
    if (!doc) {
      console.error(`Unknown or unregistered mode: ${id || "none"}`);
      process.exit(1);
    }
    const entries =
      sub === "skills" ? modeSkillEntries(doc) : modeProcessEntries(doc);
    for (const e of entries) console.log(e.id);
    return;
  }
  if (sub === "check") {
    const id = resolveModeId();
    const doc = loadMode(id);
    if (!doc) {
      console.error(`No registered mode to check (resolved: ${id || "none"}).`);
      process.exit(1);
    }
    const checks = modeCheckPrinciples(doc);
    if (!checks.length) {
      console.log(
        `Mode "${id}": no kind:check principles (advice-only) — nothing to gate. OK.`
      );
      return;
    }
    console.log(
      `Running ${checks.length} kind:check principle(s) for mode "${id}":`
    );
    const results = runModeChecks(doc);
    printModeCheckResults(results);
    if (results.some(r => !r.ok)) {
      console.error(`\nMode "${id}" check FAILED.`);
      process.exit(1);
    }
    console.log(`Mode "${id}" checks passed.`);
    return;
  }
  if (sub === "set") {
    const id = args._[1] || (typeof args.mode === "string" ? args.mode : null);
    if (!id) {
      console.error("Usage: pb mode set <id>");
      process.exit(1);
    }
    if (!(id in MODES)) {
      console.error(
        `Unknown mode "${id}". Registered: ${Object.keys(MODES).join(", ") || "none"}`
      );
      process.exit(1);
    }
    const state = readLoops();
    const loop = state.active
      ? state.loops.find(l => l.id === state.active && l.status === "active")
      : null;
    if (!loop) {
      console.error(
        "No active loop to scope the mode to. Open one with `pb loop new`, or rely on `default_mode`."
      );
      process.exit(1);
    }
    loop.mode = id;
    writeLoops(state);
    console.log(`Mode set: ${id} (scoped to loop ${loop.id}).`);
    return;
  }
  console.error(
    "Usage: pb mode <show [<id>] | set <id> | check | skills [<id>] | processes [<id>]>"
  );
  process.exit(1);
}

function cmdAnchor(args) {
  const name = master.name || "playbook";
  const loopDesc =
    master.loop?.description ||
    "orient → select → act → verify → record → report";
  const cur = readCycle();
  const purpose = NORTH_STAR
    ? `North Star (invariant): ${NORTH_STAR}`
    : "North Star: (unset — add `north_star:` to the master)";
  const cycleLine = cur.exists
    ? `This cycle (phase ${cur.phase ?? "?"}): ${cur.goal || "(goal unset)"}  ·  Stop: ${cur.stop || "(unset)"}`
    : "This cycle: (no brief — run `pb cycle --new`)";
  const loop = activeLoop();
  const loopLine = loop
    ? `Loop: ${loop.id} active · artifacts: ${loop.artifacts || loopArtifactsRel(loop.id)}`
    : "Loop: (none active — run `pb loop new` for scoped work)";
  const highLessons = openLessons().filter(l => l.severity === "high").length;
  const lessonLine = `Lessons: ${highLessons} open high-severity · run \`pb learn status\``;
  const memRule =
    "Memory precedence: your own/host memory is the PAST; this folder is the project PRESENT/FUTURE. On any project conflict the folder wins — surface it, do not silently follow host memory.";
  // Mode slice — ONE additive line (never gates; empty directive = inherit host prompt).
  const _modeId = resolveModeId();
  const _modeDoc = loadMode(_modeId);
  const _modeLine = modeAnchorLine(_modeId, _modeDoc);

  if (args.brief) {
    console.log(`[${name} anchor] master=${MASTER} · loop: ${loopDesc}`);
    console.log(purpose);
    console.log(cycleLine);
    console.log(loopLine);
    console.log(lessonLine);
    console.log(_modeLine);
    console.log(
      `Re-anchor to ${MASTER} each iteration. State is on disk (${BACKLOG}, ${JOURNAL}) — rehydrate with \`node scripts/pb.mjs status\`. ${memRule}`
    );
    return;
  }
  console.log(`\n=== PLAYBOOK ANCHOR — ${name} ===`);
  console.log(`Master (the fixation): ${MASTER}   |   Entry: ${ENTRY}`);
  console.log(purpose);
  console.log(cycleLine);
  console.log(loopLine);
  console.log(lessonLine);
  console.log(`Loop: ${loopDesc}`);
  console.log(_modeLine);
  if (_modeDoc) {
    if (modeHasDirective(_modeDoc)) {
      console.log("  directive:");
      for (const l of _modeDoc.directive.trim().split("\n"))
        console.log(`    ${l}`);
    } else {
      console.log(
        "  directive: (empty by intent — inherits the host agent's system prompt)"
      );
    }
    const _prs = Array.isArray(_modeDoc.principles) ? _modeDoc.principles : [];
    for (const pr of _prs)
      console.log(`  - [${pr.kind}] ${pr.id} — ${pr.text || ""}`);
  }
  const fix = master.fixation || [];
  if (fix.length) {
    console.log("Invariants (never violate):");
    for (const r of fix) console.log(`  - ${r}`);
  }
  console.log(memRule);
  const _wip = backlogTasks().find(t => t.status === "in_progress");
  if (_wip) {
    console.log(`Claimed task: [${_wip.id}] ${_wip.title || ""}`);
    const _ch = taskChecks(_wip);
    if (_ch.length) {
      console.log("  done means (its acceptance_checks):");
      for (const c of _ch) console.log(`    $ ${c}`);
    }
  }
  console.log(
    `State lives on disk, not in context. Rehydrate anytime: \`node scripts/pb.mjs status\`.`
  );
  console.log(
    `  backlog: ${BACKLOG}   journal: ${JOURNAL}   reports: ${REPORTS_DIR}   cycle: ${CYCLE}`
  );
  console.log(
    `If you feel lost or just resumed: \`node scripts/pb.mjs checkpoint\`.`
  );
  console.log(`=== END ANCHOR ===\n`);
}

// ============================================================================
//  checkpoint — the hardening heartbeat: re-anchor + detect drift from disk.
//  Call it on resume, after compaction, or whenever unsure. `--snapshot`
//  writes memory/RESUME.md as a single "where you are" breadcrumb.
// ============================================================================
function cmdCheckpoint(args) {
  cmdAnchor({ brief: true });

  const tasks = backlogTasks();
  const journal = readJournal().filter(e => !e.__malformed);
  const lastTs = journal.length ? journal[journal.length - 1].ts : null;
  const wip = tasks.filter(t => t.status === "in_progress");
  const nextTodo = tasks
    .filter(t => t.status === "todo")
    .sort((a, b) => prio(a) - prio(b))[0];
  const loopState = readLoops();
  const loop = activeLoop();
  const openHighLessons = openLessons().filter(l => l.severity === "high");

  const warnings = [];
  const failures = runValidate();
  if (failures.length)
    warnings.push(
      `Guardrails FAIL (${failures.length}) — run \`pb validate\`.`
    );
  if (!loop && (wip.length > 0 || nextTodo))
    warnings.push(
      "No active loop — run `pb loop new` before claiming or recording scoped work."
    );
  if (loopState.active && !loop)
    warnings.push(
      `Loop registry has non-active loop set as active: ${loopState.active}.`
    );
  const failed = failedLoopNeedsLearning(loopState);
  if (failed)
    warnings.push(
      `Failed loop ${failed.id} has no learning reflection — run \`pb learn --loop ${failed.id} --source user --notes "..."\`.`
    );
  const firstLoopStarted =
    loopState.loops
      .map(l => l.started_at)
      .filter(Boolean)
      .sort()[0] || null;
  const unscoped = journal.filter(
    e => !e.loop_id && (!firstLoopStarted || (e.ts || "") >= firstLoopStarted)
  ).length;
  if (unscoped)
    warnings.push(
      `${unscoped} post-loop journal entr${unscoped === 1 ? "y has" : "ies have"} no loop_id.`
    );
  const nonActiveLive = latestProcessRecords().filter(
    proc =>
      proc.loop_id !== loop?.id &&
      proc.status !== "stopped" &&
      pidAlive(proc.pid)
  );
  if (nonActiveLive.length)
    warnings.push(
      `${nonActiveLive.length} live tracked process(es) belong to a non-active loop.`
    );
  // multi-agent: "one at a time" is per agent. Warn only when a SINGLE agent holds
  // more than one in_progress task; multiple agents each holding one is expected.
  const wipByAgent = new Map();
  for (const t of wip)
    wipByAgent.set(taskHolder(t), (wipByAgent.get(taskHolder(t)) || 0) + 1);
  for (const [ag, n] of wipByAgent) {
    if (n > 1)
      warnings.push(
        `agent ${ag} holds ${n} tasks in_progress — keep ONE per agent; finish or release the rest.`
      );
  }
  for (const t of wip) {
    const recorded = journal.some(
      e => e.task === t.id && (!t.claimed_at || (e.ts || "") >= t.claimed_at)
    );
    if (!recorded)
      warnings.push(
        `[${t.id}] claimed but no progress recorded — \`pb record --task ${t.id} ...\` or release it.`
      );
  }
  // phase-loop drift: forward brief (cycle) + backward reflect
  const reflectTs = lastReflectTs(journal);
  const hasClaimableWork = wip.length > 0 || Boolean(nextTodo);
  if (hasClaimableWork) warnings.push(...cycleBlockers(journal));
  const doneSinceReflect = journal.filter(
    e =>
      e.status === "done" &&
      e.action !== "reflect" &&
      (!reflectTs || (e.ts || "") > reflectTs)
  ).length;
  if (doneSinceReflect > 0)
    warnings.push(
      `${doneSinceReflect} task(s) recorded done since the last reflect — run \`pb reflect\`.`
    );
  if (openHighLessons.length) {
    const cycleText = readText(CYCLE);
    const missing = openHighLessons.filter(l => !cycleText.includes(l.id));
    if (missing.length)
      warnings.push(
        `${missing.length} open high-severity lesson(s) are not referenced by the active cycle brief.`
      );
  }

  console.log(
    `State: ${tasks.filter(t => t.status === "todo").length} todo · ${wip.length} in_progress · ${tasks.filter(t => t.status === "done").length} done · loop: ${loop ? loop.id : "none"} · lessons: ${openHighLessons.length} high · last journal: ${lastTs ? lastTs.slice(0, 19) : "none"}`
  );
  if (warnings.length) {
    console.log("DRIFT detected:");
    for (const w of warnings) console.log(`  ! ${w}`);
  } else {
    console.log("On-loop: no drift detected.");
  }
  if (wip[0])
    console.log(
      `Next: finish [${wip[0].id}] "${wip[0].title}", then record. (skill: ${wip[0].skill || "-"})`
    );
  else if (nextTodo)
    console.log(
      `Next: \`pb next --claim\` → [${nextTodo.id}] (skill: ${nextTodo.skill || "-"}).`
    );
  else console.log("Next: backlog clear.");

  if (args.snapshot) {
    const resume = [
      "# RESUME — auto-snapshot",
      "",
      "If your context was compacted or you just resumed, start here, then delete stale notes.",
      "",
      `- Re-anchor: read \`${MASTER}\` + \`${ENTRY}\`. Rehydrate: \`node scripts/pb.mjs status\`.`,
      `- In progress: ${wip.length ? wip.map(t => `[${t.id}] ${t.title}`).join("; ") : "none"}`,
      `- Active loop: ${loop ? loop.id : "none"}`,
      `- Open high-severity lessons: ${openHighLessons.length}`,
      `- Last journal entry: ${lastTs ? lastTs.slice(0, 19) : "none"}`,
      wip[0]
        ? `- Next: finish [${wip[0].id}], then \`pb record --task ${wip[0].id} ...\`.`
        : nextTodo
          ? `- Next: \`pb next --claim\` → [${nextTodo.id}].`
          : "- Next: backlog clear.",
      "",
    ];
    ensureDir(MEMORY_DIR);
    writeFileSync(p(join(MEMORY_DIR, "RESUME.md")), resume.join("\n"), "utf8");
    console.log(`Snapshot written: ${join(MEMORY_DIR, "RESUME.md")}`);
  }
}

// ============================================================================
//  cycle — the FORWARD half of the phase loop. A "cycle brief" is the four
//  questions confirmed at the start of each phase. The North Star is invariant;
//  the cycle goal changes per phase. Brief opens the phase; `reflect` closes it.
// ============================================================================
function readCycle() {
  const text = readText(CYCLE);
  if (!text) return { exists: false };
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  let meta = {};
  if (m) {
    try {
      meta = yaml.load(m[1]) || {};
    } catch {
      meta = {};
    }
  }
  if (meta && meta.started instanceof Date)
    meta.started = meta.started.toISOString();
  return { exists: true, ...meta };
}
// Blockers shared by `checkpoint` (warns) and `next --claim` (enforces): missing cycle
// brief, a brief left stale by a later `pb reflect`, or an unanswered Q5 memory-conflict check.
function cycleBlockers(journal) {
  const cyc = readCycle();
  const reflectTs = lastReflectTs(journal);
  const blockers = [];
  if (cyc.exists && readText(CYCLE).includes("(Your host memory is the PAST")) {
    blockers.push(
      "Cycle brief Q5 (memory-conflict check) is unanswered — fill it before claiming work."
    );
  }
  if (!cyc.exists) {
    blockers.push(
      "No cycle brief — open the phase with `pb cycle --new` before claiming work."
    );
  } else if (reflectTs && cyc.started && reflectTs > cyc.started) {
    blockers.push(
      "Cycle brief is stale — the last `pb reflect` closed this phase; open a new one with `pb cycle --new --force`."
    );
  }
  return blockers;
}
function cycleTemplate({
  phase,
  goal,
  stop,
  challenges,
  priorChallenges,
  conflicts,
}) {
  return `---
phase: ${phase}
started: "${nowISO()}"
goal: ${goal ? JSON.stringify(goal) : '""'}
stop: ${stop ? JSON.stringify(stop) : '""'}
---
# Cycle Brief — phase ${phase}

> Confirm this at the START of each phase, before claiming work. The North Star does
> not change; this cycle's goal does. Fill all five, then \`node scripts/pb.mjs status\`.

## 1. What is this cycle's goal?
${goal || "(one sentence — the phase goal, distinct from the North Star)"}

## 2. What challenges do I foresee?
${challenges || "(pre-mortem: what is most likely to go wrong this phase)"}

## 3. What were the previous challenges?
${priorChallenges || "(carry-over — seed from the last `pb reflect`)"}

## 4. Where do I stop / hand back?
${stop || '(the explicit stop condition — what "this phase is done" means, and the hand-back point)'}

## 5. Conflicts with my own (agent) memory?
${
  conflicts ||
  `(Your host memory is the PAST; this folder is the project's PRESENT/FUTURE. If anything you
"remember" about this project contradicts the North Star or this goal, NAME it here and treat
the folder as truth — do not silently follow memory.)`
}
`;
}
function cmdCycle(args) {
  const cur = readCycle();
  if (args.new) {
    if (cur.exists && !args.force) {
      console.log(
        `A cycle brief already exists (phase ${cur.phase ?? "?"}, started ${String(cur.started).slice(0, 19)}).`
      );
      console.log(
        'Open the next phase with `pb cycle --new --force` (optionally --goal "..." --stop "...").'
      );
      return;
    }
    const phase = (Number.isInteger(cur.phase) ? cur.phase : 0) + 1;
    ensureDir(dirname(CYCLE));
    writeFileSync(
      p(CYCLE),
      cycleTemplate({ phase, goal: args.goal, stop: args.stop }),
      "utf8"
    );
    console.log(
      `Opened cycle brief: ${CYCLE} (phase ${phase}). Fill the five questions, then \`pb status\`.`
    );
    return;
  }
  if (!cur.exists) {
    console.log(
      "No cycle brief yet. Open one with `pb cycle --new` (the forward half of the phase loop)."
    );
    return;
  }
  console.log(
    `\n  Cycle brief — phase ${cur.phase ?? "?"}  (started ${String(cur.started).slice(0, 19)})`
  );
  if (NORTH_STAR) console.log(`  North Star: ${NORTH_STAR}`);
  console.log(`  Goal: ${cur.goal || "(unset)"}`);
  console.log(`  Stop: ${cur.stop || "(unset)"}`);
  console.log(`  Full brief: ${CYCLE}\n`);
}

function lastReflectTs(journal, loopId = null) {
  const r = journal.filter(
    e => e.action === "reflect" && (!loopId || e.loop_id === loopId)
  );
  return r.length ? r[r.length - 1].ts : null;
}
function cmdReflect(args) {
  const journal = readJournal().filter(e => !e.__malformed);
  const since = lastReflectTs(journal);
  const doneSince = journal.filter(
    e =>
      e.status === "done" &&
      e.action !== "reflect" &&
      (!since || (e.ts || "") > since)
  );
  const cur = readCycle();

  console.log("\n=== REFLECT ===");
  if (NORTH_STAR) console.log(`North Star: ${NORTH_STAR}`);
  if (cur.exists)
    console.log(
      `This cycle (phase ${cur.phase ?? "?"}): ${cur.goal || "(unset)"}`
    );
  console.log(
    since ? `Done since last reflect (${since.slice(0, 19)}):` : "Done so far:"
  );
  if (doneSince.length) {
    for (const e of doneSince)
      console.log(`  - [${e.task || "-"}] ${e.notes || e.action}`);
  } else {
    console.log("  (nothing)");
  }
  console.log(
    "\nAsk: did these advance the North Star + cycle goal? What changes? What carries into the next phase?"
  );

  if (args.notes) {
    const loop = args.loop ? loopById(args.loop) : activeLoop();
    const entry = {
      ts: nowISO(),
      loop_id: loop?.id || args.loop || "legacy",
      task: "reflect",
      agent: args.agent || "agent",
      action: "reflect",
      status: "done",
      checks: "none",
      result: null,
      files: [],
      notes: args.notes,
    };
    ensureDir(MEMORY_DIR);
    appendFileSync(p(JOURNAL), JSON.stringify(entry) + "\n", "utf8");
    console.log(
      `\nRecorded reflection. If it changes direction, update north_star in ${MASTER} and open a new brief: \`pb cycle --new --force\`.`
    );
  } else {
    console.log(
      '\nRecord it with: pb reflect --notes "what you learned / what changes / what carries forward".'
    );
  }
  console.log("=== END REFLECT ===\n");
}

// ============================================================================
//  scaffold — copy this engine into a target repo (copy-don't-clobber)
// ----------------------------------------------------------------------------
//  The mechanical backbone of `install`. Run the SOURCE playbook's pb.mjs and
//  point --target at the repo to set up. Existing files are never overwritten
//  (except scripts/pb.mjs, which is the engine and should refresh). Whatever it
//  skips is reported so the caller knows what to bridge by hand/agent.
// ============================================================================
function cmdScaffold(args) {
  const target = args.target || args._[0] || ".";
  const targetAbs = resolve(process.cwd(), target);
  if (targetAbs === ROOT) {
    console.error(
      "Refusing to scaffold onto the source playbook itself. Pass --target <dir>."
    );
    process.exit(1);
  }
  const tp = (...parts) => resolve(targetAbs, ...parts);
  const tHas = rel => existsSync(tp(rel));
  const ensureT = rel => {
    if (!existsSync(tp(rel))) mkdirSync(tp(rel), { recursive: true });
  };
  const created = [],
    skipped = [];

  ["scripts", "memory", "artifacts/reports"].forEach(ensureT);

  // engine CLI — always refresh (it IS the engine)
  copyFileSync(p("scripts/pb.mjs"), tp("scripts/pb.mjs"));
  created.push("scripts/pb.mjs");

  // single-file templates — only if absent in the target
  for (const f of [
    "playbook.yaml",
    "SKILL.md",
    "AGENTS.md",
    "README.md",
    "INSTALL.md",
    "memory/project-memory.md",
  ]) {
    if (!existsSync(p(f))) continue;
    if (tHas(f)) {
      skipped.push(f);
      continue;
    }
    ensureT(dirname(f));
    copyFileSync(p(f), tp(f));
    created.push(f);
  }

  // processes / skills — copy the whole tree only when the target has no index
  // (greenfield). If an index already exists, leave it and flag it for bridging.
  for (const area of ["processes", "skills"]) {
    const hasIndex = tHas(`${area}/index.yaml`) || tHas(`${area}/index.json`);
    if (!hasIndex && existsSync(p(area))) {
      cpSync(p(area), tp(area), { recursive: true });
      created.push(`${area}/`);
    } else if (hasIndex)
      skipped.push(`${area}/ (index present — bridge, don't replace)`);
  }

  // modes/ — the template playbook.yaml ships `default_mode` + a `modes:` registry
  // pointing at modes/*.yaml; a scaffold without them resolves to a missing mode.
  // Copy the whole tree on greenfield; leave any existing modes/ alone.
  if (existsSync(p("modes"))) {
    if (!tHas("modes")) {
      cpSync(p("modes"), tp("modes"), { recursive: true });
      created.push("modes/");
    } else skipped.push("modes/ (present — bridge, don't replace)");
  }

  // package.json — the scaffolded pb needs js-yaml. Write a minimal manifest with
  // the dep + namespaced pb scripts so `npm install` makes the target self-running.
  // Never clobber an existing manifest (bridge into it by hand — flagged below).
  if (!tHas("package.json")) {
    const name =
      basename(targetAbs)
        .replace(/[^a-z0-9-]/gi, "-")
        .toLowerCase() || "agent-playbook";
    const pkg = {
      name,
      private: true,
      type: "module",
      description: "Agent-Playbook working instance (scaffolded engine).",
      scripts: {
        status: "node scripts/pb.mjs status",
        next: "node scripts/pb.mjs next",
        validate: "node scripts/pb.mjs validate",
        report: "node scripts/pb.mjs report",
        list: "node scripts/pb.mjs list",
      },
      dependencies: { "js-yaml": "^4.1.0" },
      engines: { node: ">=18" },
    };
    writeFileSync(
      tp("package.json"),
      JSON.stringify(pkg, null, 2) + "\n",
      "utf8"
    );
    created.push("package.json");
  } else {
    skipped.push("package.json (present — add js-yaml + pb scripts by hand)");
  }

  // runtime files
  if (!tHas("memory/journal.ndjson")) {
    writeFileSync(tp("memory/journal.ndjson"), "", "utf8");
    created.push("memory/journal.ndjson");
  }
  if (existsSync(p("memory/backlog.yaml")) && !tHas("memory/backlog.yaml")) {
    copyFileSync(p("memory/backlog.yaml"), tp("memory/backlog.yaml"));
    created.push("memory/backlog.yaml");
  }
  if (!tHas("artifacts/reports/.gitkeep")) {
    writeFileSync(tp("artifacts/reports/.gitkeep"), "", "utf8");
    created.push("artifacts/reports/.gitkeep");
  }

  console.log(`\nScaffolded Agent-Playbook into: ${targetAbs}`);
  if (created.length) console.log("  created:  " + created.join(", "));
  if (skipped.length) console.log("  skipped:  " + skipped.join(", "));
  console.log("\nNext (the judgment steps — see the install skill):");
  console.log(
    "  1. If processes/skills/memory already existed, bridge them: edit the target"
  );
  console.log(
    "     playbook.yaml `index`/`paths` to point at the existing files (don't use the templates)."
  );
  console.log(
    `  2. cd "${target}" && npm install   # pulls js-yaml (skip if nested in a repo that already has it)`
  );
  console.log(
    "  3. node scripts/pb.mjs init && node scripts/pb.mjs validate\n"
  );
}

// ============================================================================
//  update — one-command self-update ("agent-playbook --update"). Pulls the
//  latest engine from GitHub (or a local --source) and OVERLAYS engine files,
//  preserving user state. Carry-on: Node 18 fetch + GitHub tree/raw API (no tar,
//  no new deps). Engine = scripts/ processes/ skills/ modes/ + docs + package.json.
//  NEVER touches memory/ or artifacts/. The master version line is bumped in place.
// ============================================================================
const UPDATE_REPO =
  (master.update && master.update.repo) || "riverho/agent-playbook";
const ENGINE_DIRS = ["scripts", "processes", "skills", "modes"];
const ENGINE_FILES = [
  "SKILL.md",
  "AGENTS.md",
  "README.md",
  "INSTALL.md",
  "package.json",
];

function parseSemver(v) {
  const m = String(v || "")
    .trim()
    .replace(/^v/, "")
    .match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}
function semverCmp(a, b) {
  const x = parseSemver(a),
    y = parseSemver(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}
function isEnginePath(rel) {
  const r = rel.replace(/\\/g, "/");
  if (ENGINE_FILES.includes(r) || r === "playbook.yaml") return true;
  return ENGINE_DIRS.some(d => r === d || r.startsWith(`${d}/`));
}
// Overlay engine files from srcRoot onto dstRoot: additive-overwrite (refresh/add,
// never delete user files); only descends ENGINE_DIRS, so memory/ + artifacts/ are
// never touched. Returns the number of files written.
function overlayEngine(srcRoot, dstRoot, { includeMaster }) {
  let count = 0;
  const copyTree = relDir => {
    const absSrc = join(srcRoot, relDir);
    if (!existsSync(absSrc)) return;
    for (const ent of readdirSync(absSrc, { withFileTypes: true })) {
      const rel = relDir ? `${relDir}/${ent.name}` : ent.name;
      if (ent.isDirectory()) copyTree(rel);
      else {
        mkdirSync(dirname(join(dstRoot, rel)), { recursive: true });
        copyFileSync(join(srcRoot, rel), join(dstRoot, rel));
        count++;
      }
    }
  };
  for (const d of ENGINE_DIRS) copyTree(d);
  for (const f of ENGINE_FILES) {
    if (existsSync(join(srcRoot, f))) {
      copyFileSync(join(srcRoot, f), join(dstRoot, f));
      count++;
    }
  }
  if (includeMaster && existsSync(join(srcRoot, "playbook.yaml"))) {
    copyFileSync(
      join(srcRoot, "playbook.yaml"),
      join(dstRoot, "playbook.yaml")
    );
    count++;
  }
  return count;
}
// Surgically bump only the `version:` line of the master — preserves comments,
// north_star, and any user customization (unlike a full master overwrite).
function bumpMasterVersion(version) {
  const path = p(MASTER);
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  const next = text.replace(/^version:.*$/m, `version: ${version}`);
  if (next !== text) writeFileSync(path, next, "utf8");
}
async function ghJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "agent-playbook-update",
      Accept: "application/vnd.github+json",
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${url}`);
  return res.json();
}
// Download just the engine files at a ref into destRoot via the tree + raw APIs.
async function downloadEngineFromGithub(repo, ref, destRoot) {
  const tree = await ghJson(
    `https://api.github.com/repos/${repo}/git/trees/${ref}?recursive=1`
  );
  const blobs = (tree.tree || []).filter(
    n => n.type === "blob" && isEnginePath(n.path)
  );
  if (!blobs.length) throw new Error(`no engine files found in ${repo}@${ref}`);
  for (const n of blobs) {
    const res = await fetch(
      `https://raw.githubusercontent.com/${repo}/${ref}/${n.path}`,
      { headers: { "User-Agent": "agent-playbook-update" } }
    );
    if (!res.ok) throw new Error(`raw fetch ${res.status} for ${n.path}`);
    const out = join(destRoot, n.path);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  }
  return destRoot;
}

async function cmdUpdate(args) {
  const current = master.version || "0.0.0";
  const sourceArg = typeof args.source === "string" ? args.source : null;
  const localSource =
    sourceArg && existsSync(resolve(process.cwd(), sourceArg))
      ? resolve(process.cwd(), sourceArg)
      : null;
  let tmp = null;
  try {
    let srcRoot = localSource,
      latest,
      origin,
      ref = null,
      repo = null;
    if (localSource) {
      origin = `local source ${localSource}`;
      let sm = {};
      try {
        sm =
          yaml.load(readFileSync(join(localSource, "playbook.yaml"), "utf8")) ||
          {};
      } catch {
        /* version stays 0 */
      }
      latest = sm.version || "0.0.0";
    } else {
      repo = sourceArg || UPDATE_REPO;
      origin = `github:${repo}`;
      const rel = await ghJson(
        `https://api.github.com/repos/${repo}/releases/latest`
      );
      ref = rel.tag_name;
      latest = String(ref || "").replace(/^v/, "") || "0.0.0";
    }

    const cmp = semverCmp(current, latest);
    console.log(
      `\n  pb update — current v${current} · latest v${latest}  (${origin})`
    );
    if (args.check) {
      console.log(
        cmp < 0
          ? "  Update available. Run `pb update` to apply.\n"
          : "  Already up to date.\n"
      );
      return;
    }
    if (cmp >= 0 && !args.force) {
      console.log("  Already up to date.\n");
      return;
    }

    if (!srcRoot) {
      // GitHub path: fetch engine files into a temp dir, then overlay
      tmp = mkdtempSync(join(tmpdir(), "pb-update-"));
      console.log("  Downloading engine files…");
      await downloadEngineFromGithub(repo, ref, tmp);
      srcRoot = tmp;
    }

    const n = overlayEngine(srcRoot, ROOT, {
      includeMaster: !!args["include-master"],
    });
    if (!args["include-master"]) bumpMasterVersion(latest);
    console.log(
      `  Updated v${current} → v${latest} — ${n} engine file(s) refreshed.`
    );
    console.log("  User state (memory/, artifacts/) untouched.");
    console.log(
      "  Next: `npm install` (if deps changed), then `node scripts/pb.mjs validate`.\n"
    );
  } catch (e) {
    console.error(`\n  Update failed: ${e.message}\n`);
    process.exitCode = 1;
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
}

// ============================================================================
//  help + dispatch
// ============================================================================
function cmdHelp() {
  console.log(`
  pb — Agent-Playbook loop CLI   (master: ${MASTER})

  Loop:   orient → select → act → verify → record → report → repeat

  Commands:
    status                 Orient: master summary, backlog, recent journal, guardrail state
    next [--claim] [--force]
                           Select the next task; --claim marks it in_progress. Claiming is
                           refused if there's no active loop or the cycle brief is missing/stale
                           (--force overrides, not recommended)
    record --task <id> --action <a> --status <s> [--result <r>] [--files a,b] [--notes "..."] [--agent <n>] [--skip-checks]
                           Append a journal entry. Recording done RUNS the task's
                           acceptance_checks and refuses if they fail.
    report [--since DATE]  Roll the journal up into ${REPORTS_DIR}/report-<date>.md
    plan --goal ".." [--skill <id>] [--priority <n>] [--check <cmd>] [--manual]
                          Convert a goal into a backlog task with acceptance_checks.
                          Pass --check multiple times. Set --manual to require human approval.
    loop new [--goal ".."] [--stop ".."] [--from-lessons] [--fresh]  Open a durable loop epoch.
                          Default continues from the existing backlog. --fresh archives the
                          current backlog (nothing lost) and resets it to empty for a ground-up
                          loop, so stale tasks can't be silently inherited and claimed.
    loop status           Show active loop, close gate, and learning blockers
    loop run --auto [--max-tasks N] [--retry N] [--dry-run]
                          Autonomous loop execution: claim, execute commands, run checks,
                          record done/blocked, and retry failed checks up to N times.
                          Stops on blockers, manual tasks, honor-only tasks, or empty backlog.
    loop close --status <done|failed|abandoned> [--reason ".."] [--allow-unreflected]
                          Close the active loop; failed loops require a learning reflection
                          before the next loop unless --skip-learning is stamped on loop new
    loop quarantine <id>  Mark a failed/closed loop as quarantined
    learn [--loop <id>] --source user --notes ".." [--severity high] [--promotion memory|backlog|skill|journal] [--target <file-or-task>]
                          Record a structured lesson for a smarter next loop
    learn status          Show open lessons
    run -- <command>      Start a long-running command under the active loop and log it
    ps [--loop <id>]      List tracked processes
    stop [--loop <id>]    Stop tracked processes for a loop
    cycle [--new [--force] --goal ".." --stop ".."]  Forward half of the phase loop: the cycle brief (4+1 Qs). No args prints it.
    reflect [--notes ".."] Backward half: review done-since-last-reflect vs North Star; --notes records it
    validate               Structural guardrails (exit 1 on failure)
    validate --task <id>   Run that task's executable acceptance_checks
    anchor [--brief]       Print the constitution to re-inject (keeps the playbook salient)
    checkpoint [--snapshot]  Heartbeat: re-anchor + detect drift; --snapshot writes memory/RESUME.md
    list [processes|skills|modes]  Print the indices ("list modes" prints the mode catalog)
    update [--check] [--force] [--source <dir>] [--include-master]
                           Self-update: pull the latest engine from GitHub (update.repo) and
                           overlay engine files; preserves memory/ + artifacts/. --check dry-runs.
    scaffold --target <dir>  Copy this engine into another repo (copy-don't-clobber)
    init                   Create any missing runtime files (safe; never overwrites)
    bootstrap              Seed missing minimal process/skill files, then init (safe; never overwrites)
    help                   This text

  Statuses: ${ALLOWED_STATUSES.join(", ")}
  acceptance_checks are SHELL COMMANDS on the task (cwd: playbook root). Exit 0 = pass.
  Read ${MASTER} and ${ENTRY} first — they are the source of truth.
`);
}

const [, , cmd, ...rest] = process.argv;
const args = parseArgs(rest);
switch (cmd) {
  case "status":
    cmdStatus();
    break;
  case "next":
    cmdNext(args);
    break;
  case "record":
    cmdRecord(args);
    break;
  case "report":
    cmdReport(args);
    break;
  case "plan":
    cmdPlan(args);
    break;
  case "loop":
    cmdLoop(args);
    break;
  case "learn":
    cmdLearn(args);
    break;
  case "run":
    cmdRun(args);
    break;
  case "ps":
    cmdPs(args);
    break;
  case "stop":
    cmdStop(args);
    break;
  case "validate":
    cmdValidate(args);
    break;
  case "mode":
    cmdMode(args);
    break;
  case "anchor":
    cmdAnchor(args);
    break;
  case "checkpoint":
    cmdCheckpoint(args);
    break;
  case "cycle":
    cmdCycle(args);
    break;
  case "reflect":
    cmdReflect(args);
    break;
  case "list":
    cmdList(args);
    break;
  case "update":
    cmdUpdate(args);
    break;
  case "scaffold":
    cmdScaffold(args);
    break;
  case "init":
    cmdInit();
    break;
  case "bootstrap":
    cmdBootstrap();
    break;
  case "help":
  case undefined:
    cmdHelp();
    break;
  default:
    console.error(`Unknown command: ${cmd}\n`);
    cmdHelp();
    process.exit(1);
}
