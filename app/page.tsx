"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MODELS } from "@/lib/models";
import { CAPABILITY_LABELS, LOCAL_MODELS, LOCAL_TIER_DEFAULT, capabilityProfile, type TaskCapability } from "@/lib/local-models";
import Markdown from "./components/Markdown";
import WorkIntakePanel from "./components/WorkIntakePanel";
import ProofPanel from "./components/ProofPanel";
import {
  View,
  LibraryTabs,
  WorkflowsPanel,
  SkillsPanel,
  SpacesPanel,
  ArtifactsPanel,
  ConnectorsPanel,
  CustomizePanel,
  getActiveSpace,
  loadSpaces,
  syncSpacesFromServer,
} from "./components/Panels";
import { BrandMark, brandFor } from "./brand-icons";
import { HyzrMark } from "./hyzr-logo";
import { PRODUCT } from "@/lib/product";
import { storeGet, storeSet } from "@/lib/client-store";
import { DEFAULT_ROUTING_RULES, type RoutingRules } from "@/lib/local-router";
import {
  IconPlus,
  IconGithub,
  IconSliders,
  IconKey,
  IconArrowUp,
  IconChevron,
  IconSparkles,
  IconCpu,
  IconImage,
  IconCode,
  IconShield,
  IconGauge,
  IconRoute,
  IconTrash,
  IconClock,
  IconCheck,
  IconStop,
  IconCopy,
  IconRefresh,
  IconPanelLeft,
  IconSearch,
  IconAttach,
  IconMic,
  IconTerminal,
  IconPackage,
  IconEye,
  IconExternal,
  IconX,
  IconDots,
  IconFolder,
  IconFile,
  IconLayers,
  IconPuzzle,
  IconWorkflow,
  IconPlug,
  IconPalette,
  IconGlobe,
  IconBook,
  IconArrowRight,
  IconBolt,
} from "./icons";

type Role = "user" | "assistant";
type Mode = "local" | "byok";
type WorkMode = "chat" | "code";
type Effort = "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
type Theme = "dark" | "light" | "system";
interface ProductPrefs { autoPreview: boolean; autoReview: boolean; adaptiveRouting: boolean; voiceInput: boolean; language: string; reducedMotion: boolean; compactChat: boolean; showUsage: boolean; sendWithEnter: boolean; newChatKey: "k" | "n"; saveHistory: boolean; }
const DEFAULT_PRODUCT_PREFS: ProductPrefs = { autoPreview: true, autoReview: true, adaptiveRouting: true, voiceInput: true, language: "Auto detect", reducedMotion: false, compactChat: false, showUsage: true, sendWithEnter: true, newChatKey: "k", saveHistory: true };
const isMobileViewport = () => typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches;
const LIBRARY_VIEWS: View[] = ["connectors", "skills", "workflows"];
// Views reachable while in Chat mode. Everything else (tasks, proof, projects,
// work intake, library, artifacts) belongs to Code/Pair mode.
const CHAT_MODE_VIEWS = new Set<View>(["chat", "customize", "memory"]);
const URL_VIEWS = new Set<View>(["tasks", "proof", "spaces", "artifacts", "connectors", "skills", "workflows", "memory", "customize", "github"]);
const VIEW_TITLES: Record<View, string> = {
  chat: "New project",
  tasks: "Tasks",
  proof: "Proof",
  spaces: "Projects",
  artifacts: "Artifacts",
  connectors: "Library",
  skills: "Library",
  workflows: "Library",
  memory: "Memory",
  customize: "Customize",
  github: "Work intake",
};

function viewFromLocation(): View | null {
  if (typeof window === "undefined") return null;
  const requested = new URLSearchParams(window.location.search).get("view") as View | null;
  return requested && URL_VIEWS.has(requested) ? requested : null;
}

function isTransientFetchError(error: any) {
  return error?.name !== "AbortError" && /load failed|failed to fetch|network|connection/i.test(String(error?.message ?? error));
}

async function waitUntilForeground(signal: AbortSignal) {
  if (typeof document === "undefined" || (document.visibilityState === "visible" && navigator.onLine)) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => { document.removeEventListener("visibilitychange", check); window.removeEventListener("online", check); signal.removeEventListener("abort", check); };
    const check = () => {
      if (signal.aborted) { cleanup(); reject(new DOMException("Aborted", "AbortError")); }
      else if (document.visibilityState === "visible" && navigator.onLine) { cleanup(); resolve(); }
    };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("online", check);
    signal.addEventListener("abort", check);
  });
}

async function resilientFetch(input: RequestInfo | URL, init: RequestInit, signal: AbortSignal) {
  let lastError: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await fetch(input, { ...init, signal }); }
    catch (error: any) {
      if (!isTransientFetchError(error) || attempt === 2) throw error;
      lastError = error;
      await waitUntilForeground(signal);
      await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
    }
  }
  throw lastError;
}

function compactModelContext(messages: Msg[], maxMessages = 8, maxChars = 22000) {
  const chosen: Msg[] = [];
  let remaining = maxChars;
  for (let index = messages.length - 1; index >= 0 && chosen.length < maxMessages && remaining > 0; index--) {
    const message = messages[index];
    const perMessage = chosen.length === 0 ? 12000 : 3200;
    const content = message.content.slice(-Math.min(perMessage, remaining));
    chosen.unshift({ ...message, content });
    remaining -= content.length;
  }
  return chosen.map((message) => ({ role: message.role, content: message.content }));
}

interface PlanT {
  intent: string;
  complexity: string;
  strategy: string;
  executorModelId?: string;
  subtasks: { title: string; tier: string; capability?: keyof typeof CAPABILITY_LABELS; rationale?: string; modelId?: string; status?: "queued" | "active" | "done"; routingTrace?: RoutingTrace }[];
  preliminary?: boolean;
  estimate?: { minutes: number; computeUnits: number; models: number };
}
interface RoutingTrace {
  selectedModelId: string;
  defaultModelId: string;
  source: "default" | "adaptive" | "custom" | "provider" | "fallback";
  adapted: boolean;
  sampleCount: number;
  reason: string;
  candidates: Array<{ modelId: string; attempts: number; successRate: number | null; averageTokens: number | null; score: number | null }>;
}
interface RouteInfo {
  modelId: string;
  modelLabel: string;
  provider: string;
  tier: string;
  capability?: string;
  plan?: string;
  routingTrace?: RoutingTrace;
}
interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  totalTokens?: number;
  routedCost?: number;
  baselineCost?: number;
  saved?: number;
}
interface BudgetTelemetry {
  tokenBudget: number;
  usedTokens: number;
  remainingTokens: number;
  utilization: number;
  state: "healthy" | "warning" | "exhausted";
  reason?: string;
}
interface ContextOptimizationTelemetry {
  rawCharacters: number;
  sentCharacters: number;
  avoidedCharacters: number;
  reductionRate: number;
}
interface Step {
  label: string;
  kind: string;
}
interface Msg {
  role: Role;
  content: string;
  images?: { name: string; dataUrl: string }[]; // user-attached images
  imageB64?: string;
  route?: RouteInfo;
  usage?: Usage;
  budget?: BudgetTelemetry;
  contextOptimization?: ContextOptimizationTelemetry;
  providerCalls?: number;
  nativeExecution?: { kind?: string; evidence?: string[] };
  analysis?: PlanT;
  status?: string;
  steps?: Step[];
  followups?: string[];
  streaming?: boolean;
  startedAt?: number;
  completedAt?: number;
  lastEventSeq?: number;
  runId?: string;
  contract?: { id: string; objective: string; acceptanceCriteria: string[]; evidence: string[]; budget: { tokenBudget: number; maxAttempts: number; maxSpecialists: number } };
}
interface Keys {
  anthropic: string;
  openai: string;
  linear: string;
}
interface Attachment {
  name: string;
  kind: "text" | "image";
  content?: string; // text files
  dataUrl?: string; // images (base64)
}
interface Session {
  id: string;
  title: string;
  messages: Msg[];
  createdAt: number;
  updatedAt: number;
  project?: { name: string; repo?: string; instructions?: string };
}

interface SharedSessionsPayload {
  sessions: Session[];
  tombstones: Record<string, number>;
  revision?: number;
}

type TaskStatus = "running" | "completed" | "needs_attention" | "stopped";
interface TaskSummary {
  id: string;
  workspaceId: string;
  title: string;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  completedTasks: number;
  totalTasks: number;
  models: string[];
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  latestActivity: string;
  estimatedCost: number | null;
  baselineCost: number | null;
  tokenBudget: number | null;
  budgetRemaining: number | null;
  budgetUtilization: number | null;
  budgetState: "healthy" | "warning" | "exhausted" | null;
  computeUnits: number;
  providerCalls: number;
  nativeOperations: number;
  skillActivations: number;
  contextCharactersAvoided: number;
  contextReductionRate: number;
  outcome?: { verdict: "accepted" | "needs_work" | "regressed"; humanEdits?: number; note?: string; recordedAt: number };
  contract?: { id: string; objective: string; acceptanceCriteria: string[]; evidence: string[]; source: { kind: string; [key: string]: unknown }; budget: { tokenBudget: number; maxAttempts: number; maxSpecialists: number } };
}
interface TaskAnalytics {
  totalRuns: number;
  ratedRuns: number;
  acceptedRuns: number;
  successRate: number | null;
  tokensPerAcceptedTask: number | null;
  costPerAcceptedTask: number | null;
  baselineCostPerAcceptedTask: number | null;
  savingsRate: number | null;
  ratedModelDecisions: number;
  adaptiveRoutes: number;
  nativeOperations: number;
  avoidedProviderCalls: number;
}

function sessionTimestamp(session: Partial<Session>) {
  return Number(session.updatedAt) || Number(session.createdAt) || 0;
}

function sanitizeMessage(message: Msg): Msg {
  const uniqueSteps = message.steps ? Array.from(new Map(message.steps.map((step) => [step.label, step])).values()).slice(-24) : undefined;
  const filteredContent = (message.content ?? "")
    .split(/\r?\n/)
    .filter((line) => !/codex_core::shell_snapshot|shell snapshot not supported yet for powershell/i.test(line))
    .join("\n")
    .trim();
  const lines = filteredContent.split(/\r?\n/);
  const nonEmpty = lines.map((line) => line.trim()).filter(Boolean);
  const uniqueLines = Array.from(new Set(nonEmpty));
  const replayCorrupted = nonEmpty.length > 80 && uniqueLines.length * 3 < nonEmpty.length;
  return {
    ...message,
    content: replayCorrupted ? uniqueLines.join("\n\n") : filteredContent,
    steps: uniqueSteps,
    usage: replayCorrupted ? undefined : message.usage,
  };
}

function removeReplayedTurns(messages: Msg[]): Msg[] {
  const cleaned: Msg[] = [];
  for (const message of messages) {
    const current = sanitizeMessage(message);
    const previous = cleaned[cleaned.length - 1];
    // Old clients could reconnect to a completed run and append its final
    // answer again. Drop only exact, adjacent copies; intentional repeated
    // prompts remain intact when the assistant actually produces a new turn.
    if (
      previous &&
      previous.role === current.role &&
      previous.content.trim() === current.content.trim() &&
      current.content.trim()
    ) continue;
    if (
      current.role === "assistant" &&
      cleaned.length >= 3 &&
      cleaned[cleaned.length - 1]?.role === "user" &&
      cleaned[cleaned.length - 2]?.role === "assistant" &&
      cleaned[cleaned.length - 3]?.role === "user" &&
      cleaned[cleaned.length - 1].content.trim() === cleaned[cleaned.length - 3].content.trim() &&
      current.content.trim() === cleaned[cleaned.length - 2].content.trim()
    ) {
      cleaned.pop();
      continue;
    }
    cleaned.push(current);
  }
  return cleaned;
}

function normalizeSession(session: Session): Session {
  return { ...session, updatedAt: sessionTimestamp(session), messages: Array.isArray(session.messages) ? removeReplayedTurns(session.messages) : [] };
}

function mergeSessions(local: Session[], remote: Session[], tombstones: Record<string, number>) {
  const merged = new Map<string, Session>();
  for (const candidate of [...local, ...remote]) {
    const session = normalizeSession(candidate);
    if ((tombstones[session.id] || 0) >= session.updatedAt) continue;
    const existing = merged.get(session.id);
    if (!existing || session.updatedAt >= existing.updatedAt) merged.set(session.id, session);
  }
  return [...merged.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

function sameSessionVersions(left: Session[], right: Session[]) {
  if (left.length !== right.length) return false;
  return left.every((session, index) => session.id === right[index]?.id && session.updatedAt === right[index]?.updatedAt);
}

const KEYS_STORAGE = "hyzr.chat.keys";
const SESSIONS_KEY = "hyzr.chat.sessions";
const PREFS_KEY = "hyzr.chat.prefs";
const LEGACY_KEYS_STORAGE = "vmx.keys";
const LEGACY_SESSIONS_KEY = "vmx.sessions";
const LEGACY_PREFS_KEY = "vmx.prefs";

interface MenuModel {
  id: string;
  label: string;
  blurb: string;
  tier: string;
  plan?: string;
  engine: string;
}
function shortModelLabel(label: string) {
  return label.replace(/^GPT-[\d.]+\s+/i, "").replace(/^Claude\s+/i, "");
}
function menuModels(mode: Mode): MenuModel[] {
  return mode === "local"
    ? Object.values(LOCAL_MODELS).map((m) => ({
        id: m.id,
        label: m.label,
        blurb: m.blurb,
        tier: m.tier,
        plan: m.plan,
        engine: m.engine,
      }))
    : Object.values(MODELS).map((m) => ({
        id: m.id,
        label: m.label,
        blurb: m.blurb,
        tier: m.tier,
        engine: m.provider,
      }));
}
function findModel(mode: Mode, id: string) {
  return menuModels(mode).find((m) => m.id === id);
}
// The subscription model that a given tier routes to (for the routing tree).
function tierModel(tier: string) {
  const id = LOCAL_TIER_DEFAULT[(tier as "trivial" | "standard" | "hard")] ?? LOCAL_TIER_DEFAULT.standard;
  return LOCAL_MODELS[id];
}

const SUGGESTIONS = [
  {
    label: "Build an interface",
    prompt: "Build a polished, responsive project dashboard with a strong visual system and realistic content.",
    icon: <IconLayers size={15} />,
  },
  {
    label: "Debug a project",
    prompt: "Inspect this project, identify the most important reliability and quality issues, then fix and verify them.",
    icon: <IconTerminal size={15} />,
  },
  {
    label: "Plan an architecture",
    prompt:
      "Design the architecture for a scalable multi-tenant realtime chat backend. Cover the data model, message fan-out, and how to avoid race conditions.",
    icon: <IconSparkles size={15} />,
  },
];

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Classify an activity label into a step kind (for the icon).
function stepKind(label: string): string {
  const l = label.toLowerCase();
  if (l.startsWith("running")) return "run";
  if (l.startsWith("editing") || l.startsWith("writing")) return "edit";
  if (l.startsWith("reading")) return "read";
  if (l.includes("build") || l.includes("deploy")) return "build";
  if (l.includes("think") || l.includes("reason")) return "think";
  if (l.includes("search")) return "search";
  if (l.includes("analy")) return "analyze";
  if (l.includes("working") || l.includes("routed")) return "route";
  return "step";
}
function stepIcon(kind: string, size = 13) {
  switch (kind) {
    case "run":
      return <IconTerminal size={size} />;
    case "edit":
      return <IconCode size={size} />;
    case "read":
      return <IconFile size={size} />;
    case "build":
      return <IconPackage size={size} />;
    case "think":
      return <IconDots size={size} />;
    case "search":
      return <IconSearch size={size} />;
    case "analyze":
      return <IconSparkles size={size} />;
    case "route":
      return <IconRoute size={size} />;
    default:
      return <IconChevron size={size} />;
  }
}

function taskAge(timestamp: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function taskDuration(run: TaskSummary) {
  const seconds = Math.max(1, Math.floor(((run.status === "running" ? Date.now() : run.updatedAt) - run.createdAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function TasksPanel({ runs, analytics, loading, onRefresh, onOpen, onStop, onOutcome }: {
  runs: TaskSummary[];
  analytics: TaskAnalytics;
  loading: boolean;
  onRefresh: () => void;
  onOpen: (workspaceId: string) => void;
  onStop: (runId: string) => void;
  onOutcome: (runId: string, verdict: "accepted" | "needs_work") => void;
}) {
  const [filter, setFilter] = useState<"all" | TaskStatus>("all");
  const filtered = filter === "all" ? runs : runs.filter((run) => run.status === filter);
  const counts = {
    running: runs.filter((run) => run.status === "running").length,
    attention: runs.filter((run) => run.status === "needs_attention").length,
    complete: runs.filter((run) => run.status === "completed" && Date.now() - run.updatedAt < 86_400_000).length,
  };
  const statusLabel: Record<TaskStatus, string> = { running: "Running", completed: "Completed", needs_attention: "Needs attention", stopped: "Stopped" };

  return <div className="tasks-view">
    <div className="tasks-inner">
      <div className="tasks-head">
        <div><span className="tasks-eyebrow">Operations</span><h1>Tasks</h1><p>Work continues on the Hyzr Chat server when you close the tab, switch devices, or move elsewhere in the app.</p></div>
        <button className="tasks-refresh" onClick={onRefresh} disabled={loading}><IconRefresh size={14} className={loading ? "rotating" : ""} /> Refresh</button>
      </div>
      <div className="task-metrics">
        <button onClick={() => setFilter("running")} className={filter === "running" ? "on" : ""}><i className="running" /><span><strong>{counts.running}</strong>Running now</span></button>
        <button onClick={() => setFilter("needs_attention")} className={filter === "needs_attention" ? "on" : ""}><i className="attention" /><span><strong>{counts.attention}</strong>Needs attention</span></button>
        <button onClick={() => setFilter("completed")} className={filter === "completed" ? "on" : ""}><i className="complete" /><span><strong>{analytics.successRate == null ? "—" : `${Math.round(analytics.successRate * 100)}%`}</strong>Accepted outcomes</span></button>
        <button className="efficiency"><i /><span><strong>{analytics.tokensPerAcceptedTask == null ? "—" : Math.round(analytics.tokensPerAcceptedTask).toLocaleString()}</strong>Tokens / accepted task</span></button>
        <button className="efficiency"><i /><span><strong>{analytics.adaptiveRoutes || "—"}</strong>Evidence-backed routes</span></button>
      </div>
      <div className="task-toolbar">
        <div className="task-filters">
          {(["all", "running", "needs_attention", "completed"] as const).map((value) => <button key={value} onClick={() => setFilter(value)} className={filter === value ? "on" : ""}>{value === "all" ? "All" : statusLabel[value]}</button>)}
        </div>
        <span>{filtered.length} {filtered.length === 1 ? "task" : "tasks"}</span>
      </div>
      <div className="task-list">
        {!filtered.length ? <div className="task-empty"><span><IconGauge size={20} /></span><h2>{filter === "all" ? "No tasks yet" : `No ${filter.replace("_", " ")} tasks`}</h2><p>Start work from Chat and it will appear here with live progress.</p></div> : filtered.map((run) => {
          const denominator = Math.max(run.totalTasks, 1);
          const progress = run.status === "completed" ? 100 : Math.min(94, Math.round(run.completedTasks / denominator * 100));
          return <article className={`task-card ${run.status}`} key={run.id}>
            <div className="task-state-rail"><span /><i /></div>
            <div className="task-card-body">
              <div className="task-card-top">
                <div className="task-title-wrap"><span className="task-status-icon">{run.status === "completed" ? <IconCheck size={14} /> : run.status === "needs_attention" ? <IconShield size={14} /> : run.status === "stopped" ? <IconStop size={12} /> : <span className="spinner" />}</span><div><h2>{run.title}</h2><p>{run.latestActivity}</p></div></div>
                <span className={`task-status ${run.status}`}>{statusLabel[run.status]}</span>
              </div>
              <div className="task-progress"><span style={{ width: `${progress}%` }} /></div>
              <div className="task-meta">
                <span><IconClock size={13} /> {taskDuration(run)}</span>
                <span><IconLayers size={13} /> {run.completedTasks}/{run.totalTasks || 1} steps</span>
                {run.totalTokens > 0 && <span><IconCpu size={13} /> {run.totalTokens.toLocaleString()} tok</span>}
                {run.providerCalls > 0 && <span><IconRoute size={13} /> {run.providerCalls} model {run.providerCalls === 1 ? "call" : "calls"}</span>}
                {run.nativeOperations > 0 && <span className="native-saving"><IconBolt size={13} /> {run.nativeOperations} zero-model {run.nativeOperations === 1 ? "operation" : "operations"}</span>}
                {run.contextCharactersAvoided > 0 && <span title={`${run.contextCharactersAvoided.toLocaleString()} old conversation characters excluded`}><IconLayers size={13} /> {Math.round(run.contextReductionRate * 100)}% context trimmed</span>}
                {run.tokenBudget && run.budgetUtilization != null && <span className={`task-budget ${run.budgetState ?? "healthy"}`}><IconGauge size={13} /> {Math.round(run.budgetUtilization * 100)}% budget</span>}
                <span title={new Date(run.updatedAt).toLocaleString()}><IconRefresh size={13} /> {taskAge(run.updatedAt)}</span>
              </div>
              {run.models.length > 0 && <div className="task-models">{run.models.slice(0, 3).map((model) => <span key={model}>{model}</span>)}</div>}
              {run.contract && <details className="task-contract"><summary>Delivery contract <span>{run.contract.acceptanceCriteria.length} acceptance checks</span></summary><div><strong>{run.contract.objective}</strong><ul>{run.contract.acceptanceCriteria.map((criterion) => <li key={criterion}>{criterion}</li>)}</ul><small>Budget {run.contract.budget.tokenBudget.toLocaleString()} tokens · {run.contract.budget.maxSpecialists} specialist maximum</small></div></details>}
              <div className="task-actions">
                <button className="task-open" onClick={() => onOpen(run.workspaceId)}>Open task <IconArrowRight size={13} /></button>
                {run.status === "running" && <button className="task-stop" onClick={() => onStop(run.id)}><IconStop size={11} /> Stop</button>}
                {run.status === "needs_attention" && <span>Open the task to review and retry.</span>}
                {run.status === "completed" && !run.outcome && <div className="task-outcome"><span>Was this delivery usable?</span><button onClick={() => onOutcome(run.id, "accepted")}><IconCheck size={12} /> Accept</button><button onClick={() => onOutcome(run.id, "needs_work")}>Needs work</button></div>}
                {run.outcome && <span className={`outcome-badge ${run.outcome.verdict}`}>{run.outcome.verdict === "accepted" ? "Accepted delivery" : "Marked for improvement"}</span>}
              </div>
            </div>
          </article>;
        })}
      </div>
    </div>
  </div>;
}

export default function Home() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [keys, setKeys] = useState<Keys>({ anthropic: "", openai: "", linear: "" });
  const [showSettings, setShowSettings] = useState(false);
  const [showModels, setShowModels] = useState(false);
  const [override, setOverride] = useState("auto");
  const [mode, setMode] = useState<Mode>("local");
  const [planOn, setPlanOn] = useState(true);
  const [effort, setEffort] = useState<Effort>("high");
  const [theme, setTheme] = useState<Theme>("light");
  const [productPrefs, setProductPrefs] = useState<ProductPrefs>(DEFAULT_PRODUCT_PREFS);
  const [view, setView] = useState<View>("chat");
  const [workMode, setWorkMode] = useState<WorkMode>("chat");
  const [toast, setToast] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [histQuery, setHistQuery] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showPlus, setShowPlus] = useState(false);
  const [listening, setListening] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [queuedInstructions, setQueuedInstructions] = useState<string[]>([]);
  const [visibleMessageCount, setVisibleMessageCount] = useState(36);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
  const [spaceRevision, setSpaceRevision] = useState(0);
  const [sidebarSpaces, setSidebarSpaces] = useState<ReturnType<typeof loadSpaces>>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewEntry, setPreviewEntry] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewNonce, setPreviewNonce] = useState(0);
  const [previewWidth, setPreviewWidth] = useState(560);
  const [modelPool, setModelPool] = useState<Record<Mode, string[]>>({
    local: Object.keys(LOCAL_MODELS),
    byok: Object.keys(MODELS),
  });
  const [routingRules, setRoutingRules] = useState<RoutingRules>(DEFAULT_ROUTING_RULES);
  const [taskRuns, setTaskRuns] = useState<TaskSummary[]>([]);
  const [taskAnalytics, setTaskAnalytics] = useState<TaskAnalytics>({ totalRuns: 0, ratedRuns: 0, acceptedRuns: 0, successRate: null, tokensPerAcceptedTask: null, costPerAcceptedTask: null, baselineCostPerAcceptedTask: null, savingsRate: null, ratedModelDecisions: 0, adaptiveRoutes: 0, nativeOperations: 0, avoidedProviderCalls: 0 });
  const [tasksLoading, setTasksLoading] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const sessionsLoadedRef = useRef(false);
  const prefsLoadedRef = useRef(false);
  const queueDispatchRef = useRef(false);
  const previewDismissedRef = useRef<Set<string>>(new Set());

  useLayoutEffect(() => {
    const root = document.documentElement;
    const mobile = isMobileViewport();

    // Mobile CSS keeps the server-rendered drawer out of the hit-testing tree.
    // Complete that handshake before the first painted frame so React and CSS
    // agree that the drawer is closed and the menu trigger is available.
    if (mobile) setCollapsed(true);
    root.dataset.hydrated = "true";

    return () => {
      delete root.dataset.hydrated;
    };
  }, []);

  useEffect(() => {
    const requestedView = viewFromLocation();
    if (requestedView) setView(requestedView);
  }, []);
  const autoPreviewRunRef = useRef(false);
  const sessionsRef = useRef<Session[]>([]);
  const currentIdRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const tombstonesRef = useRef<Record<string, number>>({});
  const applyingRemoteMessagesRef = useRef(false);
  const sharedRevisionRef = useRef(0);
  const pushedVersionsRef = useRef<Record<string, number>>({});
  const pushedTombstonesRef = useRef("");
  const runSeqRef = useRef<Record<string, number>>({});
  const pendingRunEventsRef = useRef<Record<string, Map<number, any>>>({});
  const missingRunPollsRef = useRef<Record<string, number>>({});
  const taskStatusRef = useRef<Record<string, TaskStatus>>({});

  async function refreshTasks(announce = false) {
    setTasksLoading(true);
    try {
      const response = await fetch("/api/runs?list=1", { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json() as { runs?: TaskSummary[]; analytics?: TaskAnalytics };
      const next = Array.isArray(payload.runs) ? payload.runs : [];
      if (payload.analytics) setTaskAnalytics(payload.analytics);
      if (announce && Object.keys(taskStatusRef.current).length) {
        for (const run of next) {
          const previous = taskStatusRef.current[run.id];
          if (previous === "running" && run.status !== "running") {
            const label = run.status === "completed" ? "Task completed" : run.status === "needs_attention" ? "Task needs attention" : "Task stopped";
            setToast(`${label}: ${run.title}`);
            if (document.visibilityState === "hidden" && "Notification" in window && Notification.permission === "granted") {
              new Notification(label, { body: run.title, tag: `hyzr-chat-${run.id}` });
            }
          }
        }
      }
      taskStatusRef.current = Object.fromEntries(next.map((run) => [run.id, run.status]));
      setTaskRuns(next);
    } catch {} finally {
      setTasksLoading(false);
    }
  }

  useEffect(() => {
    refreshTasks(false);
    const timer = window.setInterval(() => refreshTasks(true), 3500);
    const onVisible = () => { if (document.visibilityState === "visible") refreshTasks(true); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    const syncViewport = () => {
      const height = viewport?.height ?? window.innerHeight;
      root.style.setProperty("--app-height", `${Math.round(height)}px`);
    };
    const timers = new Set<number>();
    const settleViewport = () => {
      window.scrollTo(0, 0);
      syncViewport();
      for (const delay of [40, 180, 420]) {
        const timer = window.setTimeout(() => {
          timers.delete(timer);
          window.scrollTo(0, 0);
          syncViewport();
        }, delay);
        timers.add(timer);
      }
    };
    syncViewport();
    viewport?.addEventListener("resize", syncViewport);
    viewport?.addEventListener("scroll", syncViewport);
    window.addEventListener("resize", syncViewport);
    window.addEventListener("orientationchange", syncViewport);
    document.addEventListener("focusin", settleViewport);
    document.addEventListener("focusout", settleViewport);
    const onVisibility = () => {
      if (document.visibilityState === "visible") requestAnimationFrame(syncViewport);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      viewport?.removeEventListener("resize", syncViewport);
      viewport?.removeEventListener("scroll", syncViewport);
      window.removeEventListener("resize", syncViewport);
      window.removeEventListener("orientationchange", syncViewport);
      document.removeEventListener("focusin", settleViewport);
      document.removeEventListener("focusout", settleViewport);
      document.removeEventListener("visibilitychange", onVisibility);
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, []);
  const runPollInFlightRef = useRef(false);

  useEffect(() => { setVisibleMessageCount(36); }, [currentId]);

  useEffect(() => {
    let live = true;
    async function load() {
      try {
        const k = localStorage.getItem(KEYS_STORAGE) || localStorage.getItem(LEGACY_KEYS_STORAGE);
        if (k) setKeys({ anthropic: "", openai: "", linear: "", ...JSON.parse(k) });
        const legacyRaw = localStorage.getItem(SESSIONS_KEY) || localStorage.getItem(LEGACY_SESSIONS_KEY);
        const legacy: Session[] = legacyRaw ? JSON.parse(legacyRaw) : [];
        const stored = await storeGet<Session[]>(SESSIONS_KEY).catch(() => null)
          || await storeGet<Session[]>(LEGACY_SESSIONS_KEY).catch(() => null);
        if (!live) return;
        const localSessions = (stored ?? legacy).map(normalizeSession);
        let shared: SharedSessionsPayload = { sessions: [], tombstones: {} };
        try {
          const response = await fetch("/api/sessions", { cache: "no-store" });
          if (response.ok) shared = await response.json();
        } catch {}
        if (!live) return;
        tombstonesRef.current = shared.tombstones ?? {};
        pushedTombstonesRef.current = JSON.stringify(tombstonesRef.current);
        sharedRevisionRef.current = Number(shared.revision) || 0;
        pushedVersionsRef.current = Object.fromEntries((shared.sessions ?? []).map((session) => [session.id, sessionTimestamp(session)]));
        const loaded = mergeSessions(localSessions, shared.sessions ?? [], tombstonesRef.current);
        sessionsRef.current = loaded;
        setSessions(loaded);
        if (!stored && legacy.length) storeSet(SESSIONS_KEY, legacy).catch(() => {});
        sessionsLoadedRef.current = true;
        const urlId = window.location.pathname.match(/^\/chat\/([^/]+)$/)?.[1];
        const active = urlId ? loaded.find((session) => session.id === urlId) : undefined;
        if (active) {
          setCurrentId(active.id);
          applyingRemoteMessagesRef.current = true;
          setMessages(active.messages);
        } else if (urlId) {
          window.history.replaceState({}, "", "/");
        }
        const p = localStorage.getItem(PREFS_KEY) || localStorage.getItem(LEGACY_PREFS_KEY);
        if (p) {
          const prefs = JSON.parse(p);
          if (prefs.mode) setMode(prefs.mode);
          if (prefs.workMode === "chat" || prefs.workMode === "code") setWorkMode(prefs.workMode);
          if (["dark", "light", "system"].includes(prefs.theme)) setTheme(prefs.theme);
          if (prefs.productPrefs) setProductPrefs({ ...DEFAULT_PRODUCT_PREFS, ...prefs.productPrefs });
          if (prefs.routingRules && prefs.routingPolicyVersion === 3) setRoutingRules({ ...DEFAULT_ROUTING_RULES, ...prefs.routingRules });
          else setRoutingRules(DEFAULT_ROUTING_RULES);
          if (typeof prefs.planOn === "boolean") setPlanOn(prefs.planOn);
          if (["low", "medium", "high", "xhigh", "max", "ultra"].includes(prefs.effort)) setEffort(prefs.effort);
          // Desktop remembers its compact sidebar. Mobile starts closed in the
          // layout handshake and must not have a late preference read override
          // a tap that already opened the drawer after navigation/reload.
          if (typeof prefs.collapsed === "boolean" && !isMobileViewport()) setCollapsed(prefs.collapsed);
          if (prefs.modelPool) {
            const newlyAdded = prefs.modelCatalogVersion === 2 ? [] : ["claude-opus-4-7", "claude-opus-4-6", "claude-opus-3", "claude-sonnet-4-6"];
            setModelPool((prev) => ({ ...prev, ...prefs.modelPool, local: Array.from(new Set([...(prefs.modelPool.local ?? []), ...newlyAdded])) }));
          }
        }
        prefsLoadedRef.current = true;
      } catch {}
    }
    load();
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (applyingRemoteMessagesRef.current) {
      applyingRemoteMessagesRef.current = false;
      return;
    }
    if (!currentId) return;
    const updatedAt = Date.now();
    setSessions((prev) => {
      if (!prev.some((s) => s.id === currentId)) return prev;
      return prev.map((s) => (s.id === currentId ? { ...s, messages, updatedAt } : s));
    });
  }, [messages, currentId]);

  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  useEffect(() => { currentIdRef.current = currentId; }, [currentId]);
  useEffect(() => { busyRef.current = busy; }, [busy]);

  useEffect(() => {
    if (!sessionsLoadedRef.current) return;
    const timer = window.setTimeout(() => {
      storeSet(SESSIONS_KEY, productPrefs.saveHistory ? sessions : []).catch(() => {});
      if (productPrefs.saveHistory) {
        const changedSessions = sessions.filter((session) => session.updatedAt > (pushedVersionsRef.current[session.id] ?? 0));
        const tombstoneVersion = JSON.stringify(tombstonesRef.current);
        if (changedSessions.length || tombstoneVersion !== pushedTombstonesRef.current) fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessions: changedSessions, tombstones: tombstonesRef.current }),
        }).then((response) => response.ok ? response.json() : null).then((shared) => {
          if (shared?.tombstones) tombstonesRef.current = shared.tombstones;
          if (shared?.revision) sharedRevisionRef.current = Number(shared.revision);
          for (const session of changedSessions) pushedVersionsRef.current[session.id] = session.updatedAt;
          pushedTombstonesRef.current = JSON.stringify(tombstonesRef.current);
        }).catch(() => {});
      }
      try {
        if (productPrefs.saveHistory) localStorage.setItem("hyzr.chat.sessionIndex", JSON.stringify(sessions.map(({ id, title, createdAt }) => ({ id, title, createdAt }))));
        else localStorage.removeItem("hyzr.chat.sessionIndex");
        localStorage.removeItem(SESSIONS_KEY);
      } catch {}
    }, busy ? 500 : 120);
    return () => window.clearTimeout(timer);
  }, [sessions, busy, productPrefs.saveHistory]);

  useEffect(() => {
    let live = true;
    let pulling = false;
    const pull = async () => {
      if (!sessionsLoadedRef.current || !productPrefs.saveHistory || pulling) return;
      pulling = true;
      try {
        const response = await fetch(`/api/sessions?since=${sharedRevisionRef.current}`, { cache: "no-store" });
        if (response.status === 204) return;
        if (!response.ok) return;
        const shared = await response.json() as SharedSessionsPayload;
        sharedRevisionRef.current = Number(shared.revision) || sharedRevisionRef.current;
        for (const session of shared.sessions ?? []) pushedVersionsRef.current[session.id] = Math.max(pushedVersionsRef.current[session.id] ?? 0, sessionTimestamp(session));
        if (!live) return;
        const tombstones = { ...tombstonesRef.current };
        for (const [id, deletedAt] of Object.entries(shared.tombstones ?? {})) tombstones[id] = Math.max(tombstones[id] || 0, Number(deletedAt) || 0);
        tombstonesRef.current = tombstones;
        const local = sessionsRef.current;
        const merged = mergeSessions(local, shared.sessions ?? [], tombstones);
        if (!sameSessionVersions(local, merged)) setSessions(merged);

        const activeId = currentIdRef.current;
        if (activeId && !busyRef.current) {
          const localActive = local.find((session) => session.id === activeId);
          const mergedActive = merged.find((session) => session.id === activeId);
          if (!mergedActive && (localActive || tombstones[activeId])) {
            setCurrentId(null);
            applyingRemoteMessagesRef.current = true;
            setMessages([]);
            window.history.replaceState({}, "", "/");
          } else if (mergedActive && (!localActive || mergedActive.updatedAt > localActive.updatedAt)) {
            applyingRemoteMessagesRef.current = true;
            setMessages(mergedActive.messages);
          }
        }
      } catch {} finally {
        pulling = false;
      }
    };
    const timer = window.setInterval(pull, 1200);
    pull();
    return () => { live = false; window.clearInterval(timer); };
  }, [productPrefs.saveHistory]);

  useEffect(() => {
    if (!prefsLoadedRef.current) return;
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ mode, workMode, planOn, effort, theme, productPrefs, routingRules, collapsed, modelPool, modelCatalogVersion: 2, routingPolicyVersion: 3 }));
    } catch {}
  }, [mode, workMode, planOn, effort, theme, productPrefs, routingRules, collapsed, modelPool]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      document.documentElement.dataset.theme = theme === "system" ? (media.matches ? "light" : "dark") : theme;
      document.documentElement.style.colorScheme = theme === "system" ? (media.matches ? "light" : "dark") : theme;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.workmode = workMode;
  }, [workMode]);

  useEffect(() => {
    document.documentElement.dataset.motion = productPrefs.reducedMotion ? "reduced" : "full";
    document.documentElement.dataset.density = productPrefs.compactChat ? "compact" : "comfortable";
    document.documentElement.dataset.usage = productPrefs.showUsage ? "visible" : "hidden";
  }, [productPrefs]);

  useEffect(() => {
    setSidebarSpaces(loadSpaces());
    let cancelled = false;
    const pull = () => void syncSpacesFromServer().then((projects) => { if (!cancelled) setSidebarSpaces(projects); }).catch(() => undefined);
    pull();
    const timer = window.setInterval(pull, 5_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [spaceRevision]);

  useEffect(() => {
    const onPop = () => {
      const requestedView = viewFromLocation();
      if (requestedView) {
        setView(requestedView);
        return;
      }
      const id = window.location.pathname.match(/^\/chat\/([^/]+)$/)?.[1];
      const session = id ? sessions.find((s) => s.id === id) : undefined;
      setCurrentId(session?.id ?? null);
      applyingRemoteMessagesRef.current = true;
      setMessages(session?.messages ?? []);
      setView("chat");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [sessions]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages]);

  // As soon as the first HTML entry exists, open the browser while the agents
  // are still working. The file tree inside it keeps polling for later edits.
  useEffect(() => {
    if (!busy || !currentId || !productPrefs.autoPreview || !autoPreviewRunRef.current || previewDismissedRef.current.has(currentId)) return;
    let found = false;
    const poll = async () => {
      if (found) return;
      found = await checkPreview(currentId, 0);
    };
    poll();
    const timer = window.setInterval(poll, 1200);
    return () => window.clearInterval(timer);
  }, [busy, currentId, productPrefs.autoPreview]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (busy || !queuedInstructions.length || queueDispatchRef.current) return;
    queueDispatchRef.current = true;
    const next = queuedInstructions[0];
    requestAnimationFrame(() => {
      setQueuedInstructions((current) => current.slice(1));
      queueDispatchRef.current = false;
      send(next);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, queuedInstructions]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === productPrefs.newChatKey) {
        e.preventDefault();
        newChat();
      } else if (e.key === "Escape") {
        setShowModels(false);
        setShowSettings(false);
        setShowPlus(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productPrefs.newChatKey]);

  const hasKeys = keys.anthropic || keys.openai;
  const projectNames = Array.from(new Set([
    ...sidebarSpaces.map((space) => space.name),
    ...sessions.flatMap((session) => session.project?.name ? [session.project.name] : []),
  ]));
  const sidebarProjects = projectNames.map((name) => ({
    name,
    sessions: sessions.filter((session) => session.project?.name === name),
  }));
  const looseSessions = sessions.filter((session) => !session.project?.name);

  function saveKeys(k: Keys) {
    setKeys(k);
    localStorage.setItem(KEYS_STORAGE, JSON.stringify(k));
  }
  function autosize() {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    const height = Math.min(el.scrollHeight, 260);
    el.style.height = height + "px";
    el.style.overflowY = el.scrollHeight > 260 ? "auto" : "hidden";
  }
  useEffect(() => {
    const frame = window.requestAnimationFrame(autosize);
    return () => window.cancelAnimationFrame(frame);
  }, [input]);
  function switchMode(m: Mode) {
    setMode(m);
    setOverride("auto");
    setShowModels(false);
  }
  // Chat = fast conversation/search (routing only, no workspace). Code = the
  // full building surface: projects, tasks, proof, work intake, the pairer.
  function switchWorkMode(next: WorkMode) {
    setWorkMode(next);
    if (next === "chat") {
      // Chat mode has no workspace views; always land on the conversation.
      if (!CHAT_MODE_VIEWS.has(view)) openView("chat");
      setPlanOn(false);
    } else {
      setPlanOn(true);
    }
    if (isMobileViewport()) setCollapsed(true);
  }
  function newChat() {
    const mobile = isMobileViewport();
    setMessages([]);
    setInput("");
    setCurrentId(null);
    setView("chat");
    setPreviewOpen(false);
    setPreviewEntry(null);
    setPreviewUrl(null);
    window.history.pushState({}, "", "/");
    if (mobile) {
      setCollapsed(true);
      (document.activeElement as HTMLElement | null)?.blur();
    } else {
      requestAnimationFrame(() => taRef.current?.focus());
    }
  }
  function openView(next: View) {
    setView(next);
    const currentView = viewFromLocation();
    if (URL_VIEWS.has(next) && currentView !== next) window.history.pushState({}, "", `/?view=${next}`);
    else if (next === "chat" && currentView) window.history.pushState({}, "", currentId ? `/chat/${currentId}` : "/");
    if (isMobileViewport()) setCollapsed(true);
  }
  function openSession(s: Session) {
    setCurrentId(s.id);
    applyingRemoteMessagesRef.current = true;
    setMessages(s.messages);
    setView("chat");
    setPreviewOpen(false);
    setPreviewEntry(null);
    setPreviewUrl(null);
    window.history.pushState({}, "", `/chat/${s.id}`);
    if (isMobileViewport()) setCollapsed(true);
  }
  function openTaskWorkspace(workspaceId: string) {
    const session = sessionsRef.current.find((candidate) => candidate.id === workspaceId);
    if (!session) {
      setToast("This task's conversation is no longer in history");
      return;
    }
    openSession(session);
  }
  async function stopTask(runId: string) {
    try {
      await fetch(`/api/runs?run=${encodeURIComponent(runId)}&intent=user`, { method: "DELETE" });
      await refreshTasks(false);
      setToast("Task stopped; completed workspace changes were kept");
    } catch {
      setToast("Could not stop the task");
    }
  }
  async function recordTaskOutcome(runId: string, verdict: "accepted" | "needs_work") {
    try {
      const response = await fetch("/api/runs", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId, verdict }) });
      if (!response.ok) throw new Error("Could not record outcome");
      const payload = await response.json();
      if (payload.analytics) setTaskAnalytics(payload.analytics);
      await refreshTasks(false);
      setToast(verdict === "accepted" ? "Delivery accepted; routing telemetry updated" : "Feedback recorded for routing optimization");
    } catch { setToast("Could not record delivery outcome"); }
  }
  function deleteSession(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    tombstonesRef.current = { ...tombstonesRef.current, [id]: Date.now() };
    setSessions((prev) => {
      return prev.filter((s) => s.id !== id);
    });
    if (id === currentId) newChat();
  }

  function updateLast(fn: (m: Msg) => Msg) {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (!last || last.role !== "assistant") return prev;
      return [...prev.slice(0, -1), fn(last)];
    });
  }

  // Resume buffered model events after mobile Safari suspends this page.
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!currentId || last?.role !== "assistant" || !last.streaming || !last.runId) return;
    const activeRunId = last.runId;
    runSeqRef.current[activeRunId] = Math.max(runSeqRef.current[activeRunId] ?? 0, last.lastEventSeq ?? 0);
    pendingRunEventsRef.current[activeRunId] ??= new Map();
    let cancelled = false;
    const sync = async () => {
      if (runPollInFlightRef.current) return;
      runPollInFlightRef.current = true;
      try {
        const after = Math.max(Number(last.lastEventSeq ?? 0), runSeqRef.current[activeRunId] ?? 0);
        const response = await fetch(`/api/runs?run=${encodeURIComponent(activeRunId)}&after=${after}`, { cache: "no-store" });
        if (!response.ok || cancelled) return;
        const data = await response.json();
        if (!data.found) {
          const misses = (missingRunPollsRef.current[activeRunId] ?? 0) + 1;
          missingRunPollsRef.current[activeRunId] = misses;
          const age = Date.now() - Number(last.startedAt ?? Date.now());
          if (misses >= 3 && age >= 15_000) {
            updateLast((message) => ({
              ...message,
              content: message.content || "This run was interrupted during refresh. Your prompt and workspace were preserved; regenerate to retry.",
              streaming: false,
              status: undefined,
              completedAt: Date.now(),
            }));
          }
          return;
        }
        missingRunPollsRef.current[activeRunId] = 0;
        if (Number(data.resetAfter) > (runSeqRef.current[activeRunId] ?? 0)) {
          runSeqRef.current[activeRunId] = Number(data.resetAfter);
          pendingRunEventsRef.current[activeRunId]?.clear();
        }
        for (const event of data.events ?? []) applyEvent(event);
        if (data.done && !(data.events ?? []).some((event: any) => event.type === "done"))
          updateLast((message) => ({ ...message, streaming: false, status: undefined, completedAt: message.completedAt ?? Date.now() }));
      } catch {} finally { runPollInFlightRef.current = false; }
    };
    sync();
    const timer = window.setInterval(sync, 900);
    const foreground = () => { if (document.visibilityState === "visible") sync(); };
    document.addEventListener("visibilitychange", foreground);
    window.addEventListener("online", sync);
    return () => { cancelled = true; clearInterval(timer); document.removeEventListener("visibilitychange", foreground); window.removeEventListener("online", sync); };
  }, [currentId, messages.length, messages[messages.length - 1]?.streaming, messages[messages.length - 1]?.lastEventSeq, messages[messages.length - 1]?.runId]);

  async function send(preset?: string, baseMessages?: Msg[]) {
    let text = (preset ?? input).trim();
    if (!text || busyRef.current) return;
    if (mode === "byok" && !hasKeys) {
      setShowSettings(true);
      return;
    }
    busyRef.current = true;
    setView("chat");
    const base = baseMessages ?? messages;
    // Automatically reveal a project only for its initial build. Follow-up
    // prompts refresh an already-open preview but never reopen a closed one.
    autoPreviewRunRef.current = base.length === 0;

    // Fold text attachments into the prompt; images go in the request body.
    const textFiles = attachments.filter((a) => a.kind === "text");
    const imageFiles = attachments.filter((a) => a.kind === "image");
    for (const a of textFiles) {
      const ext = a.name.split(".").pop() ?? "";
      text = `Here is \`${a.name}\` for context:\n\n\`\`\`${ext}\n${a.content}\n\`\`\`\n\n${text}`;
    }
    const images = imageFiles.map((a) => ({ name: a.name, dataUrl: a.dataUrl! }));
    setAttachments([]);

    // Apply the active Space's custom instructions + repo context.
    // A project's instructions are captured when the chat starts. Switching a
    // global Space elsewhere can never silently change an existing chat.
    const space = currentId
      ? sessions.find((session) => session.id === currentId)?.project
      : getActiveSpace();
    if (space && (space.instructions || space.repo)) {
      const bits: string[] = [];
      if (space.repo) bits.push(`Project repo: ${space.repo}.`);
      if (space.instructions) bits.push(space.instructions);
      text = `[Space: ${space.name}] ${bits.join(" ")}\n\n${text}`;
    }

    let sid = currentId;
    if (!sid) {
      sid = uid();
      const raw = preset ?? input;
      const title = raw.length > 46 ? raw.slice(0, 46) + "…" : raw;
      const session: Session = {
        id: sid,
        title,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        project: space ? { name: space.name, repo: space.repo, instructions: space.instructions } : undefined,
      };
      setSessions((prev) => {
        return [session, ...prev];
      });
      setCurrentId(sid);
      window.history.pushState({}, "", `/chat/${sid}`);
    }

    const activeRunId = uid();
    const history: Msg[] = [
      ...base,
      { role: "user", content: text, images: images.length ? images : undefined },
    ];
    runSeqRef.current[activeRunId] = 0;
    pendingRunEventsRef.current[activeRunId] = new Map();
    const requestHistory = compactModelContext(history);
    setMessages([
      ...history,
      {
        role: "assistant",
        content: "",
        streaming: true,
        status: "Analyzing your request",
        startedAt: Date.now(),
        runId: activeRunId,
      },
    ]);
    setInput("");
    if (taRef.current) taRef.current.style.height = "auto";
    setBusy(true);

    const ac = new AbortController();
    abortRef.current = ac;
    let answer = "";
    let detached = false;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: ac.signal,
        body: JSON.stringify({
          messages: requestHistory,
          keys,
          override,
          mode,
          plan: mode === "local" && planOn,
          images,
          enabledModelIds: modelPool[mode],
          sessionId: sid,
          runId: activeRunId,
          effort,
          preferences: { language: productPrefs.language, autoReview: productPrefs.autoReview, adaptiveRouting: productPrefs.adaptiveRouting },
          routingRules,
        }),
      });
      if (!res.body) throw new Error("No response stream.");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          const evt = JSON.parse(line.slice(5).trim());
          if (evt.type === "text") answer += evt.text;
          applyEvent(evt);
        }
      }
      // If the agent built something previewable, open the split-screen preview.
      if (previewOpen || autoPreviewRunRef.current) checkPreview(sid, 600, previewOpen);
      // Follow-up suggestions (best-effort, after the answer is shown).
      if (answer.trim()) {
        fetch("/api/followups", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userPrompt: text, answer }),
        })
          .then((r) => r.json())
          .then((d) => {
            if (d.followups?.length) updateLast((m) => ({ ...m, followups: d.followups }));
          })
          .catch(() => {});
      }
    } catch (e: any) {
      if (e?.name === "AbortError") {
        // stop() updates this device immediately; the registered cancellation
        // event updates every other device through the run ledger.
      }
      else if (isTransientFetchError(e)) {
        detached = true;
        updateLast((m) => ({ ...m, streaming: true, status: "Reconnecting to the active run" }));
      } else
        applyEvent({ type: "error", message: e?.message ?? "Request failed." });
    } finally {
      abortRef.current = null;
      busyRef.current = false;
      setBusy(false);
      if (!detached) updateLast((m) => ({ ...m, streaming: false, status: undefined, completedAt: Date.now() }));
    }
  }

  function applyEvent(evt: any) {
    const runId = String(evt.runId || "");
    const seq = Number(evt.seq) || 0;
    if (!runId || !seq) {
      applyOrderedEvent(evt);
      return;
    }
    const applied = runSeqRef.current[runId] ?? 0;
    if (seq <= applied) return;
    const pending = pendingRunEventsRef.current[runId] ?? (pendingRunEventsRef.current[runId] = new Map());
    if (pending.has(seq)) return;
    pending.set(seq, evt);
    let next = applied + 1;
    while (pending.has(next)) {
      const ordered = pending.get(next);
      pending.delete(next);
      runSeqRef.current[runId] = next;
      applyOrderedEvent(ordered);
      next += 1;
    }
  }

  function applyOrderedEvent(evt: any) {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (!last || last.role !== "assistant") return prev;
      if (evt.runId && last.runId && evt.runId !== last.runId) return prev;
      const u: Msg = { ...last };
      if (evt.seq) u.lastEventSeq = evt.seq;
      const pushStep = (label: string) => {
        const steps = last.steps ?? [];
        if (steps.some((step) => step.label === label)) return steps;
        return [...steps, { label, kind: stepKind(label) }].slice(-24);
      };
      if (evt.type === "plan") {
        if (evt.plan?.preliminary) {
          u.status = "Planner is analyzing your request";
          return [...prev.slice(0, -1), u];
        }
        u.analysis = {
          ...evt.plan,
          subtasks: evt.plan.subtasks.map((task: any) => ({ ...task, status: "queued" })),
        };
        u.status = "Routing plan ready";
        u.steps = pushStep("Analyzed the request");
      } else if (evt.type === "planner_status") {
        u.status = evt.text;
      } else if (evt.type === "contract") {
        u.contract = evt.contract;
        u.steps = pushStep("Created the delivery contract");
      } else if (evt.type === "skill_activation") {
        const names = Array.isArray(evt.skills) ? evt.skills.map((skill: any) => skill.name).filter(Boolean).join(", ") : "task skill";
        const size = Number(evt.instructionCharacters) || 0;
        u.steps = pushStep(`Activated ${names}${size ? ` (${size.toLocaleString()} bounded chars)` : ""}`);
      } else if (evt.type === "workspace_handoff") {
        const touched = [...(evt.created || []), ...(evt.changed || [])].slice(0, 4).join(", ");
        u.steps = pushStep(touched ? `Prepared compact handoff: ${touched}` : "Prepared compact specialist handoff");
      } else if (evt.type === "task_evidence") {
        const count = Number(evt.mutationCount) || 0;
        u.steps = pushStep(count ? `Captured ${count} workspace ${count === 1 ? "change" : "changes"}` : "No workspace changes detected for this task");
      } else if (evt.type === "context_optimization") {
        u.contextOptimization = {
          rawCharacters: Number(evt.rawCharacters) || 0,
          sentCharacters: Number(evt.sentCharacters) || 0,
          avoidedCharacters: Number(evt.avoidedCharacters) || 0,
          reductionRate: Number(evt.reductionRate) || 0,
        };
      } else if (evt.type === "native_execution") {
        u.nativeExecution = { kind: evt.kind, evidence: Array.isArray(evt.evidence) ? evt.evidence : [] };
        u.steps = pushStep("Used deterministic zero-model fast path");
      } else if (evt.type === "task_start") {
        if (u.analysis) {
          u.analysis = {
            ...u.analysis,
            subtasks: u.analysis.subtasks.map((task, i) =>
              i === evt.index ? { ...task, status: "active" } : task,
            ),
          };
        }
        u.route = {
          modelId: evt.modelId,
          modelLabel: evt.modelLabel,
          provider: evt.provider,
          tier: evt.tier,
          capability: evt.capability,
          plan: evt.plan,
          routingTrace: evt.routingTrace,
        };
        u.status = `${evt.modelLabel} is building · ${evt.title}`;
        u.steps = pushStep(evt.title);
      } else if (evt.type === "task_done") {
        if (u.analysis) {
          u.analysis = {
            ...u.analysis,
            subtasks: u.analysis.subtasks.map((task, i) =>
              i === evt.index ? { ...task, status: "done" } : task,
            ),
          };
        }
        u.status = "Starting the next routed task";
      } else if (evt.type === "route") {
        u.route = {
          modelId: evt.modelId,
          modelLabel: evt.modelLabel,
          provider: evt.provider,
          tier: evt.tier,
          capability: evt.capability,
          plan: evt.plan,
          routingTrace: evt.routingTrace,
        };
        u.status = `${evt.modelLabel} is working`;
        u.steps = pushStep(`Routed to ${evt.modelLabel}`);
      } else if (evt.type === "status") {
        u.status = evt.text;
        u.steps = pushStep(evt.text);
      } else if (evt.type === "verification_start") {
        u.status = evt.text || "Running independent delivery checks";
        u.steps = pushStep("Started independent verification");
      } else if (evt.type === "verification_result") {
        const label = `${evt.check?.status === "passed" ? "Verified" : "Check failed"}: ${evt.check?.label || "delivery check"}`;
        u.status = label;
        u.steps = pushStep(label);
      } else if (evt.type === "verification_complete") {
        u.status = "Delivery checks passed";
        u.steps = pushStep("Delivery contract verified");
      } else if (evt.type === "text") {
        u.content = last.content + evt.text;
        u.status = undefined;
      } else if (evt.type === "image") {
        u.imageB64 = evt.imageB64;
      } else if (evt.type === "usage") {
        const eventTotal = evt.totalTokens ?? (evt.inputTokens ?? 0) + (evt.outputTokens ?? 0);
        u.usage = {
          ...evt,
          inputTokens: (last.usage?.inputTokens ?? 0) + (evt.inputTokens ?? 0),
          outputTokens: (last.usage?.outputTokens ?? 0) + (evt.outputTokens ?? 0),
          cacheReadTokens: (last.usage?.cacheReadTokens ?? 0) + (evt.cacheReadTokens ?? 0),
          cacheCreationTokens: (last.usage?.cacheCreationTokens ?? 0) + (evt.cacheCreationTokens ?? 0),
          totalTokens: (last.usage?.totalTokens ?? 0) + eventTotal,
          routedCost: evt.routedCost == null && last.usage?.routedCost == null ? undefined : (last.usage?.routedCost ?? 0) + (evt.routedCost ?? 0),
          baselineCost: evt.baselineCost == null && last.usage?.baselineCost == null ? undefined : (last.usage?.baselineCost ?? 0) + (evt.baselineCost ?? 0),
          saved: evt.saved == null && last.usage?.saved == null ? undefined : (last.usage?.saved ?? 0) + (evt.saved ?? 0),
        };
        u.providerCalls = (last.providerCalls ?? 0) + 1;
      } else if (evt.type === "budget_update" || evt.type === "budget_exceeded") {
        u.budget = {
          tokenBudget: Number(evt.tokenBudget) || u.contract?.budget.tokenBudget || 0,
          usedTokens: Number(evt.usedTokens) || 0,
          remainingTokens: Number(evt.remainingTokens) || 0,
          utilization: Number(evt.utilization) || 0,
          state: evt.state === "exhausted" || evt.state === "warning" ? evt.state : "healthy",
          reason: evt.reason || evt.message,
        };
        if (evt.type === "budget_exceeded") u.status = "Execution ceiling reached";
      } else if (evt.type === "error") {
        u.content = `${last.content}${last.content ? "\n\n" : ""}> ⚠ ${evt.message}`;
        u.status = undefined;
      }
      if (evt.type === "needs_attention") {
        u.content = `${last.content}${last.content ? "\n\n" : ""}> Verification needs attention: ${evt.message}`;
        u.status = undefined;
      }
      if (evt.type === "error" || evt.type === "done" || evt.type === "needs_attention") {
        u.streaming = false;
        u.status = undefined;
        u.completedAt = Date.now();
      }
      return [...prev.slice(0, -1), u];
    });
  }

  function stop() {
    abortRef.current?.abort();
    const runId = messages[messages.length - 1]?.runId;
    if (runId) fetch(`/api/runs?run=${encodeURIComponent(runId)}&intent=user`, { method: "DELETE" }).catch(() => {});
    updateLast((message) => ({
      ...message,
      content: message.content || "Run stopped. Your prompt and completed workspace changes were preserved.",
      streaming: false,
      status: undefined,
      completedAt: Date.now(),
    }));
    busyRef.current = false;
    setBusy(false);
  }

  // Downscale an image to <=1568px and re-encode as JPEG so a 12MB phone photo
  // becomes a few hundred KB — fast to upload and all the models need.
  function downscaleImage(f: File): Promise<Attachment> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(f);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const MAX = 1568;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          const s = MAX / Math.max(width, height);
          width = Math.round(width * s);
          height = Math.round(height * s);
        }
        const c = document.createElement("canvas");
        c.width = width;
        c.height = height;
        c.getContext("2d")?.drawImage(img, 0, 0, width, height);
        resolve({ name: f.name || "image", kind: "image", dataUrl: c.toDataURL("image/jpeg", 0.85) });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({ name: f.name || "image", kind: "image", dataUrl: "" });
      };
      img.src = url;
    });
  }

  // Attach dropped/picked/pasted files — images (downscaled, sent to the models)
  // and text files (folded in as context). Multiple at once.
  async function handleFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    if (!arr.length) return;
    for (const f of arr) {
      const isImage = f.type.startsWith("image/");
      if (isImage) {
        const att = await downscaleImage(f);
        if (att.dataUrl) setAttachments((prev) => [...prev, att]);
      } else {
        if (f.size > 2_000_000) {
          setToast(`${f.name} is too large (max 2 MB for text)`);
          continue;
        }
        const text = await f.text();
        setAttachments((prev) => [...prev, { name: f.name, kind: "text", content: text }]);
      }
    }
    setToast(arr.length > 1 ? `Attached ${arr.length} files` : `Attached ${arr[0].name}`);
    taRef.current?.focus();
  }

  function toggleVoice() {
    const SR =
      (typeof window !== "undefined" &&
        ((window as any).SpeechRecognition ||
          (window as any).webkitSpeechRecognition)) ||
      null;
    if (!SR) {
      setToast("Voice input isn't supported in this browser");
      return;
    }
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    let base = input;
    rec.onresult = (e: any) => {
      let txt = "";
      for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
      setInput((base ? base + " " : "") + txt);
      requestAnimationFrame(autosize);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  }
  function copyMessage(text: string) {
    navigator.clipboard.writeText(text);
    setToast("Copied to clipboard");
  }

  // Prefill the composer from a workflow/skill and jump to chat.
  function compose(prompt: string) {
    setView("chat");
    setInput(prompt);
    requestAnimationFrame(() => {
      taRef.current?.focus();
      autosize();
    });
  }
  function openArtifact(entry: string) {
    if (currentId) previewDismissedRef.current.delete(currentId);
    setPreviewEntry(entry);
    setPreviewNonce((n) => n + 1);
    setPreviewOpen(true);
    setView("chat");
  }

  // If the agent built a previewable app in the workspace, open it split-screen.
  async function checkPreview(sessionId = currentId, delay = 600, forceReload = false): Promise<boolean> {
    try {
      if (sessionId && previewDismissedRef.current.has(sessionId)) return false;
      if (delay) await new Promise((r) => setTimeout(r, delay));
      if (sessionId && previewDismissedRef.current.has(sessionId)) return false;
      const w = await fetch(`/api/workspace?session=${encodeURIComponent(sessionId ?? "")}`).then((r) => r.json());
      if (w.entry) {
        try {
          const serverResponse = await fetch("/api/preview-server", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId }),
          });
          const server = await serverResponse.json();
          if (serverResponse.ok && server.url) setPreviewUrl(server.url);
        } catch {}
        if (sessionId && previewDismissedRef.current.has(sessionId)) return false;
        setPreviewEntry((previous) => {
          if (forceReload || previous !== w.entry) setPreviewNonce((n) => n + 1);
          return w.entry;
        });
        setPreviewOpen(true);
        return true;
      }
    } catch {}
    return false;
  }
  async function showPreview() {
    if (!currentId) {
      setToast("Start a chat before opening a preview");
      return;
    }
    previewDismissedRef.current.delete(currentId);
    const found = await checkPreview(currentId, 0, false);
    if (!found) setToast("No previewable HTML has been created in this chat yet");
  }
  function regenerate() {
    if (busy) return;
    const idx = messages.map((m) => m.role).lastIndexOf("user");
    if (idx === -1) return;
    send(messages[idx].content, messages.slice(0, idx));
  }

  const remoteRunActive = !busy && !!messages[messages.length - 1]?.streaming;
  const composer = (
    <div
      className={`composer ${dragOver ? "drag" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
      }}
      onPaste={(e) => {
        if (e.clipboardData.files?.length) handleFiles(e.clipboardData.files);
      }}
    >
      {queuedInstructions.length > 0 && (
        <div className="queued-guidance">
          <IconClock size={12} /> {queuedInstructions.length} instruction{queuedInstructions.length === 1 ? "" : "s"} queued for this project
        </div>
      )}
      {attachments.length > 0 && (
        <div className="attach-row">
          {attachments.map((a, i) => (
            <div key={i} className={`attach-chip ${a.kind}`}>
              {a.kind === "image" ? (
                <img src={a.dataUrl} alt={a.name} />
              ) : (
                <IconAttach size={13} />
              )}
              <span className="ac-path">{a.name}</span>
              <button
                onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                aria-label="Remove"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <textarea
        ref={taRef}
        value={input}
        readOnly={remoteRunActive}
        onChange={(e) => {
          setInput(e.target.value);
          autosize();
        }}
        onKeyDown={(e) => {
          const shouldSend = productPrefs.sendWithEnter ? (e.key === "Enter" && !e.shiftKey) : (e.key === "Enter" && (e.metaKey || e.ctrlKey));
          if (shouldSend) {
            e.preventDefault();
            if (remoteRunActive) return;
            if (busy) {
              const guidance = input.trim();
              if (guidance) {
                setQueuedInstructions((current) => [...current, guidance]);
                setInput("");
                setToast("Guidance queued for the next checkpoint");
              }
            } else {
              send();
            }
          }
        }}
        placeholder={remoteRunActive ? "Running on another device — updates appear here live" : busy ? "Add guidance while agents work — Enter queues it" : "Ask anything — Hyzr Chat routes it to the right model"}
        rows={1}
      />
      <input
        ref={fileRef}
        type="file"
        hidden
        multiple
        accept="image/*,.txt,.md,.json,.js,.jsx,.ts,.tsx,.py,.css,.html,.csv,.yml,.yaml,.sh,.go,.rs,.java,.rb,.php,.sql"
        onChange={(e) => {
          if (e.target.files?.length) handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <div className="composer-row">
        <div className="attach-picker" style={{ position: "relative" }}>
          <button
            className="round-btn"
            onClick={() => setShowPlus((s) => !s)}
            title="Attach"
          >
            <IconPlus size={17} />
          </button>
          {showPlus && (
            <div className="plus-menu">
              <button
                onClick={() => {
                  setShowPlus(false);
                  fileRef.current?.click();
                }}
              >
                <IconAttach size={15} /> Upload files or images
              </button>
              <button
                onClick={() => {
                  setShowPlus(false);
                  openView("connectors");
                }}
              >
                <IconPlug size={15} /> Connectors
              </button>
              <button
                onClick={() => {
                  setShowPlus(false);
                  setView("spaces");
                }}
              >
                <IconLayers size={15} /> Spaces
              </button>
            </div>
          )}
        </div>
        {workMode === "code" && mode === "local" && (
          <button
            className={`tool-btn ${planOn ? "active" : ""}`}
            onClick={() => setPlanOn((p) => !p)}
            title="Analyze the workload and assign the best specialist models"
          >
            <IconRoute size={15} /> Plan
          </button>
        )}
        <div className="spacer" />
        <div className="model-picker" style={{ position: "relative" }}>
          <button
            className={`tool-btn ${override !== "auto" ? "active" : ""}`}
            onClick={() => setShowModels((s) => !s)}
          >
            {override === "auto" ? (
              <IconSparkles size={15} />
            ) : (
              <BrandMark brand={brandFor(findModel(mode, override)?.engine ?? override)} size={15} />
            )}
            <span className="picker-label">
              <span className="picker-name-full">{override === "auto" ? "Auto" : findModel(mode, override)?.label ?? "Model"}</span>
              <span className="picker-name-short">{override === "auto" ? "Auto" : shortModelLabel(findModel(mode, override)?.label ?? "Model")}</span>
              <span> · {effort === "xhigh" ? "Extra" : effort[0].toUpperCase() + effort.slice(1)}</span>
            </span>
            <IconChevron size={14} className="chev" />
          </button>
          {showModels && (
            <>
              <button className="model-menu-backdrop" aria-label="Close model menu" onClick={() => setShowModels(false)} />
              <ModelMenu
                models={menuModels(mode)}
                value={override}
                enabled={modelPool[mode]}
                effort={effort}
                onClose={() => setShowModels(false)}
                onPick={(id) => {
                  setOverride(id);
                  setShowModels(false);
                }}
                onToggle={(id) => {
                  setModelPool((prev) => {
                    const pool = prev[mode];
                    const next = pool.includes(id) ? pool.filter((x) => x !== id) : [...pool, id];
                    if (!next.length) {
                      setToast("Keep at least one model in the pool");
                      return prev;
                    }
                    if (override === id && !next.includes(id)) setOverride("auto");
                    return { ...prev, [mode]: next };
                  });
                }}
                onEffort={setEffort}
              />
            </>
          )}
        </div>
        {productPrefs.voiceInput && <button
          className={`round-btn ${listening ? "rec" : ""}`}
          onClick={toggleVoice}
          title="Voice input"
        >
          <IconMic size={16} />
        </button>}
        {busy ? (
          <button className="send stop" onClick={stop} aria-label="Stop">
            <IconStop size={15} />
          </button>
        ) : remoteRunActive ? (
          <button className="send stop" onClick={stop} aria-label="Stop remote run" title="Stop run">
            <IconStop size={15} />
          </button>
        ) : (
          <button
            className="send"
            disabled={!input.trim()}
            onClick={() => send()}
            aria-label="Send"
          >
            <IconArrowUp size={17} />
          </button>
        )}
      </div>
    </div>
  );

  const hiddenMessageCount = Math.max(0, messages.length - visibleMessageCount);
  const visibleMessages = hiddenMessageCount ? messages.slice(hiddenMessageCount) : messages;
  const activeTaskRuns = taskRuns.filter((run) => run.status === "running");
  const attentionTaskRuns = taskRuns.filter((run) => run.status === "needs_attention");
  const showBackgroundRun = activeTaskRuns.length > 0 && view !== "tasks";

  return (
    <div className="app">
      <aside className={`sidebar ${collapsed ? "collapsed" : ""}`} aria-hidden={collapsed && isMobileViewport()}>
        <div className="side-top">
          <div className="brand">
            <div className="logo"><HyzrMark size={22} /></div>
            <span className="word"><b>Hyzr</b></span>
          </div>
          <button className="side-icon" onClick={() => setCollapsed(true)} title="Collapse">
            <IconPanelLeft size={17} />
          </button>
        </div>
        <div className="workmode-toggle" role="tablist" aria-label="Mode">
          <button role="tab" aria-selected={workMode === "chat"} className={workMode === "chat" ? "on" : ""} onClick={() => switchWorkMode("chat")}>
            <IconSearch size={15} /> Chat
          </button>
          <button role="tab" aria-selected={workMode === "code"} className={workMode === "code" ? "on" : ""} onClick={() => switchWorkMode("code")}>
            <IconTerminal size={15} /> Agent
          </button>
        </div>
        <button className="new-btn" onClick={newChat}>
          <span className="new-plus"><IconPlus size={16} /></span><span>{workMode === "chat" ? "New chat" : "New"}</span>
        </button>
        {workMode === "code" && <div className="nav primary-nav">
          <button
            className={`nav-btn ${view === "chat" ? "active" : ""}`}
            onClick={() => openView("chat")}
          >
            <IconSparkles size={16} /> Chat
          </button>
          <button
            className={`nav-btn ${view === "tasks" ? "active" : ""}`}
            onClick={() => openView("tasks")}
          >
            <IconGauge size={16} /> Tasks
            {(activeTaskRuns.length > 0 || attentionTaskRuns.length > 0) && <span className={`nav-count ${attentionTaskRuns.length ? "attention" : ""}`}>{activeTaskRuns.length || attentionTaskRuns.length}</span>}
          </button>
          <button
            className={`nav-btn ${view === "proof" ? "active" : ""}`}
            onClick={() => openView("proof")}
          >
            <IconShield size={16} /> Proof
          </button>
          <button
            className={`nav-btn ${view === "spaces" ? "active" : ""}`}
            onClick={() => openView("spaces")}
          >
            <IconLayers size={16} /> Projects
          </button>
          <button
            className={`nav-btn ${view === "github" ? "active" : ""}`}
            onClick={() => openView("github")}
          >
            <IconGithub size={16} /> Work intake
          </button>
          <button
            className={`nav-btn ${LIBRARY_VIEWS.includes(view) ? "active" : ""}`}
            onClick={() => openView("workflows")}
          >
            <IconPuzzle size={16} /> Library
          </button>
        </div>}

        {workMode === "code" && <div className="sidebar-projects">
          <div className="side-section project-section-head">
            <span>Projects</span>
            <button onClick={() => openView("spaces")} title="Manage projects"><IconPlus size={13} /></button>
          </div>
          {sidebarProjects.length === 0 ? (
            <button className="project-empty" onClick={() => openView("spaces")}><IconFolder size={14} /> Create a project</button>
          ) : sidebarProjects.map((project) => {
            const folded = collapsedProjects.has(project.name);
            return <div className="side-project" key={project.name}>
              <button className="project-folder" onClick={() => setCollapsedProjects((current) => { const next = new Set(current); next.has(project.name) ? next.delete(project.name) : next.add(project.name); return next; })}>
                <IconFolder size={15} /><span>{project.name}</span><IconChevron size={11} className={folded ? "folded" : ""} />
              </button>
              {!folded && <div className="project-chats">
                {project.sessions.length === 0 ? <span className="project-no-chats">No chats yet</span> : project.sessions.map((session) => <button key={session.id} className={`project-chat ${session.id === currentId ? "active" : ""}`} onClick={() => openSession(session)}>
                  <span>{session.title}</span>{session.id === currentId && <i />}
                </button>)}
              </div>}
            </div>;
          })}
        </div>}

        <div className="side-section">
          <span>History</span>
          {looseSessions.length > 0 && <span>{looseSessions.length}</span>}
        </div>
        {looseSessions.length > 4 && (
          <div className="hist-search">
            <IconSearch size={13} />
            <input
              value={histQuery}
              onChange={(e) => setHistQuery(e.target.value)}
              placeholder="Search conversations"
            />
          </div>
        )}
        <div className="history">
          {looseSessions.length === 0 ? (
            <div className="hist-empty">No conversations yet</div>
          ) : (
            looseSessions
              .filter((s) => s.title.toLowerCase().includes(histQuery.toLowerCase()))
              .map((s) => (
                <button
                  key={s.id}
                  className={`hist-item ${s.id === currentId ? "active" : ""}`}
                  onClick={() => openSession(s)}
                >
                  <IconClock size={14} />
                  <span className="h-title">{s.title}</span>
                  <span className="h-del" onClick={(e) => deleteSession(s.id, e)}>
                    <IconTrash size={14} />
                  </span>
                </button>
              ))
          )}
        </div>

        <div className="side-bottom">
          <button className="side-utility" onClick={() => { setCollapsed(true); setShowSettings(true); }}>
            <IconSliders size={15} /><span>Settings</span>
          </button>
        </div>
      </aside>
      {!collapsed && (
        <button
          className="sidebar-backdrop"
          type="button"
          aria-label="Close navigation"
          onClick={() => setCollapsed(true)}
        />
      )}

      <main className="main">
        <div className="topbar">
          {collapsed && (
            <button
              className="side-icon"
              onClick={() => setCollapsed(false)}
              title="Show sidebar"
              aria-label="Open navigation"
              style={{ marginRight: 2 }}
            >
              <IconPanelLeft size={17} />
            </button>
          )}
          {LIBRARY_VIEWS.includes(view) ? <LibraryTabs view={view} setView={openView} /> : <div className="top-context">
            <strong>{view === "chat" ? (sessions.find((session) => session.id === currentId)?.title ?? (workMode === "chat" ? "Chat" : VIEW_TITLES.chat)) : VIEW_TITLES[view]}</strong>
            {view === "chat" && currentId && workMode === "code" && <span>Project workspace</span>}
            {workMode === "chat" && <span>Free model · search</span>}
          </div>}
          <div className="spacer" />
          {workMode === "code" && showBackgroundRun && (
            <button className="background-run" onClick={() => openView("tasks")} title="View background tasks">
              <span className="spinner" />
              <span>{activeTaskRuns.length > 1 ? `${activeTaskRuns.length} running` : "Working"}</span>
            </button>
          )}
          {workMode === "code" && currentId && !previewOpen && (
            <button className="icon-btn" onClick={showPreview}>
              <IconEye size={15} /> Preview
            </button>
          )}
          {workMode === "code" && <div className="mode-toggle compact" aria-label="Execution source">
            <button className={mode === "local" ? "on" : ""} onClick={() => switchMode("local")} title="Use local subscriptions">Local</button>
            <button className={mode === "byok" ? "on" : ""} onClick={() => switchMode("byok")} title="Use API keys">API</button>
          </div>}
          <button className="top-icon" onClick={() => setShowSettings(true)} title="Settings"><IconSliders size={15} /></button>
        </div>

        {view === "tasks" ? (
          <TasksPanel runs={taskRuns} analytics={taskAnalytics} loading={tasksLoading} onRefresh={() => refreshTasks(false)} onOpen={openTaskWorkspace} onStop={stopTask} onOutcome={recordTaskOutcome} />
        ) : view === "proof" ? (
          <ProofPanel />
        ) : view === "github" ? (
          <WorkIntakePanel
            linearKey={keys.linear}
            onUseGithubIssue={(issue, repo) => {
              compose(`Complete GitHub issue ${repo}#${issue.number}: ${issue.title}\n\n${issue.body || "No additional description was provided."}\n\nSource: ${issue.url}\n\nCreate a delivery contract from the issue, implement it in this project, verify every acceptance criterion, and prepare a pull-request-ready result. Do not merge or publish without approval.`);
              setToast(`Linked GitHub issue #${issue.number}`);
            }}
            onUseLinearIssue={(issue) => {
              compose(`Complete Linear issue ${issue.identifier}: ${issue.title}\n\n${issue.description || "No additional description was provided."}\n\nSource: ${issue.url}\n\nCreate a delivery contract from the issue, implement it in this project, verify every acceptance criterion, and prepare a review-ready result. Do not publish or change the issue without approval.`);
              setToast(`Linked Linear issue ${issue.identifier}`);
            }}
            onUseFile={(path, content) => {
              setAttachments((prev) => [...prev, { name: path, kind: "text", content }]);
              setView("chat");
              setToast(`Attached ${path.split("/").pop()}`);
              requestAnimationFrame(() => taRef.current?.focus());
            }}
          />
        ) : view === "workflows" ? (
          <WorkflowsPanel onRun={compose} />
        ) : view === "skills" ? (
          <SkillsPanel onUse={compose} />
        ) : view === "spaces" ? (
          <SpacesPanel onChanged={() => { setSpaceRevision((revision) => revision + 1); setToast("Project updated"); }} />
        ) : view === "artifacts" ? (
          <ArtifactsPanel onOpen={openArtifact} sessionId={currentId} />
        ) : view === "connectors" ? (
          <ConnectorsPanel onToast={setToast} />
        ) : view === "customize" ? (
          <CustomizePanel />
        ) : messages.length === 0 ? (
          <div className="center">
            <div className="home-intro">
              <span className="home-mark"><HyzrMark size={22} /></span>
              <span className="home-kicker">{workMode === "chat" ? "Chat" : "Agent"}</span>
              <h1>{workMode === "chat" ? "What do you want to know?" : "What should we build?"}</h1>
              <p>{workMode === "chat"
                ? "A fast answer engine. Ask anything and Hyzr routes it to the right model. Switch to Agent to build in a paired workspace."
                : "Describe the outcome. Hyzr plans the work, routes each task to the right model, and builds it in an isolated, verified workspace."}</p>
            </div>
            {composer}
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.label}
                  className="suggestion"
                  onClick={() => {
                    setInput(s.prompt);
                    requestAnimationFrame(() => {
                      taRef.current?.focus();
                      autosize();
                    });
                  }}
                >
                  {s.icon}
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="thread-shell">
              <ThreadMinimap messages={visibleMessages} containerRef={threadRef} />
              <div className="thread" ref={threadRef}>
                <div className="thread-inner">
                  {hiddenMessageCount > 0 && <button className="load-earlier" onClick={() => setVisibleMessageCount((count) => count + 36)}>Load {Math.min(36, hiddenMessageCount)} earlier messages</button>}
                  {visibleMessages.map((m, visibleIndex) => {
                    const i = hiddenMessageCount + visibleIndex;
                    return (
                    <MessageView
                      key={i}
                      msg={m}
                      onCopy={() => copyMessage(m.content)}
                      onRegen={
                        i === messages.length - 1 && m.role === "assistant" && !busy
                          ? regenerate
                          : undefined
                      }
                      onFollowup={(q) => send(q)}
                    />
                  )})}
                </div>
              </div>
            </div>
            <div className="composer-docked">{composer}</div>
          </>
        )}
      </main>

      {previewOpen && previewEntry && (
        <PreviewPane
          entry={previewEntry}
          sessionId={currentId ?? ""}
          serverUrl={previewUrl}
          nonce={previewNonce}
          width={previewWidth}
          onWidth={setPreviewWidth}
          onRefresh={() => setPreviewNonce((n) => n + 1)}
          onClose={() => {
            if (currentId) previewDismissedRef.current.add(currentId);
            setPreviewOpen(false);
          }}
        />
      )}

      {showSettings && (
        <SettingsModal
          keys={keys}
          mode={mode}
          planOn={planOn}
          theme={theme}
          onTheme={setTheme}
          productPrefs={productPrefs}
          onProductPrefs={setProductPrefs}
          modelPool={modelPool.local}
          onModelPool={(pool) => setModelPool((current) => ({ ...current, local: pool }))}
          routingRules={routingRules}
          onRoutingRules={setRoutingRules}
          usage={{
            chats: sessions.length,
            runs: sessions.reduce((n, s) => n + s.messages.filter((m) => m.role === "assistant" && !m.streaming).length, 0),
            tokens: sessions.reduce((n, s) => n + s.messages.reduce((sum, m) => sum + (m.usage?.totalTokens ?? (m.usage?.inputTokens ?? 0) + (m.usage?.outputTokens ?? 0)), 0), 0),
            modelCalls: taskRuns.reduce((total, run) => total + (run.providerCalls || 0), 0),
            contextAvoided: taskRuns.reduce((total, run) => total + (run.contextCharactersAvoided || 0), 0),
            budgetedRuns: taskRuns.filter((run) => run.tokenBudget != null && run.totalTokens > 0).length,
            withinBudget: taskRuns.filter((run) => run.tokenBudget != null && run.totalTokens > 0 && (run.budgetUtilization ?? Infinity) <= 1).length,
            saved: taskRuns.some((run) => run.estimatedCost != null && run.baselineCost != null)
              ? taskRuns.reduce((total, run) => total + Math.max(0, (run.baselineCost ?? 0) - (run.estimatedCost ?? 0)), 0)
              : null,
          }}
          onClearHistory={() => { if (window.confirm("Delete shared chat history on every connected device? Project files are not deleted.")) { const deletedAt = Date.now(); tombstonesRef.current = { ...tombstonesRef.current, ...Object.fromEntries(sessionsRef.current.map((session) => [session.id, deletedAt])) }; setSessions([]); newChat(); setToast("Shared chat history cleared"); } }}
          onTogglePlan={() => setPlanOn((p) => !p)}
          onSave={(k) => {
            saveKeys(k);
            setToast("Settings saved");
            setShowSettings(false);
          }}
          onClose={() => setShowSettings(false)}
          onOpenSymbols={() => { setShowSettings(false); setView("customize"); }}
        />
      )}

      {toast && (
        <div className="toast">
          <IconCheck size={15} /> {toast}
        </div>
      )}
    </div>
  );
}

function ModelMenu({
  models,
  value,
  enabled,
  effort,
  onPick,
  onToggle,
  onEffort,
  onClose,
}: {
  models: MenuModel[];
  value: string;
  enabled: string[];
  effort: Effort;
  onPick: (id: string) => void;
  onToggle: (id: string) => void;
  onEffort: (effort: Effort) => void;
  onClose: () => void;
}) {
  const [panel, setPanel] = useState<"effort" | "models" | null>(null);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (panel) setPanel(null);
      else onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [panel, onClose]);
  const preferredIds = ["gpt-5.6-sol", "claude-opus", "gpt-5.6-terra", "claude-sonnet"];
  let featured = preferredIds.map((id) => models.find((model) => model.id === id)).filter((model): model is MenuModel => !!model);
  if (!featured.length) featured = models.slice(0, 4);
  const forced = value !== "auto" ? models.find((model) => model.id === value) : undefined;
  if (forced && !featured.some((model) => model.id === forced.id)) featured = [forced, ...featured.slice(0, 3)];
  const effortLabel = (level: Effort) => level === "xhigh" ? "Extra" : level[0].toUpperCase() + level.slice(1);
  const effortDescriptions: Record<Effort, string> = {
    low: "Fast responses with lighter reasoning",
    medium: "Balanced speed and reasoning depth",
    high: "Thorough reasoning for complex work",
    xhigh: "Extra depth for difficult problems",
    max: "Maximum reasoning depth",
    ultra: "Maximum depth with task delegation",
  };
  return (
    <div className="menu">
      <div className="menu-mobile-head"><span /><strong>Model &amp; effort</strong><button onClick={onClose} aria-label="Close"><IconX size={18} /></button></div>
      <div className="menu-head">
        <IconRoute size={14} /> Choose a model
      </div>
      <div className={`menu-item ${value === "auto" ? "sel" : ""}`} onClick={() => onPick("auto")}>
        <div className="menu-ic">
          <IconSparkles size={15} />
        </div>
        <div style={{ flex: 1 }}>
          <div className="m-label">Auto · cost-aware routing</div>
          <div className="m-blurb">
            Uses lightweight models for trivial work, balanced models for everyday builds, and frontier models only for hard tasks.
          </div>
        </div>
        <span className="menu-check">
          <IconCheck size={15} />
        </span>
      </div>
      <div className="menu-section-label">Suggested</div>
      {featured.map((m) => (
        <button key={m.id} className={`primary-model-row ${value === m.id ? "selected" : ""}`} onClick={() => onPick(m.id)}>
          <div className="menu-ic">
            <BrandMark brand={brandFor(m.engine)} size={16} />
          </div>
          <div className="primary-model-copy">
            <strong>{m.label}</strong>
            <span>{m.blurb}</span>
          </div>
          {value === m.id && <IconCheck size={16} className="primary-check" />}
        </button>
      ))}
      <div className="menu-divider" />
      <button className={`menu-drill ${panel === "effort" ? "active" : ""}`} onClick={() => setPanel(panel === "effort" ? null : "effort")}>
        <span>Effort</span><strong>{effortLabel(effort)}</strong><IconChevron size={14} />
      </button>
      <button className={`menu-drill ${panel === "models" ? "active" : ""}`} onClick={() => setPanel(panel === "models" ? null : "models")}>
        <span>More models</span><strong>{models.length}</strong><IconChevron size={14} />
      </button>
      {panel === "effort" && (
        <div className="menu-subpanel effort-subpanel">
          <div className="subpanel-mobile-head"><button onClick={() => setPanel(null)} aria-label="Back"><IconChevron size={16} /></button><strong>Reasoning effort</strong><button onClick={onClose} aria-label="Close"><IconX size={18} /></button></div>
          <div className="subpanel-intro">Higher effort means more thorough responses, but takes longer and uses your limits faster.</div>
          {(["low", "medium", "high", "xhigh", "max", "ultra"] as Effort[]).map((level) => (
            <button key={level} className={`effort-row ${effort === level ? "selected" : ""}`} onClick={() => { onEffort(level); setPanel(null); }}>
              <span><strong>{effortLabel(level)}</strong><small>{effortDescriptions[level]}</small></span>
              {level === "high" && <em>Default</em>}
              {effort === level && <IconCheck size={16} />}
            </button>
          ))}
        </div>
      )}
      {panel === "models" && (
        <div className="menu-subpanel models-subpanel">
          <div className="subpanel-mobile-head"><button onClick={() => setPanel(null)} aria-label="Back"><IconChevron size={16} /></button><strong>Available models</strong><button onClick={onClose} aria-label="Close"><IconX size={18} /></button></div>
          <div className="subpanel-title"><span>All available models</span><small>{enabled.length} in Auto pool</small></div>
          <div className="catalog-list">
            {models.map((m) => (
              <div key={m.id} className={`catalog-row ${value === m.id ? "selected" : ""} ${enabled.includes(m.id) ? "" : "excluded"}`}>
                <button className="catalog-pick" onClick={() => onPick(m.id)}>
                  <span className="catalog-mark"><BrandMark brand={brandFor(m.engine)} size={17} /></span>
                  <span className="catalog-copy"><strong>{m.label}</strong><small>{CAPABILITY_LABELS[capabilityProfile(m.id).strengths[0]]} · {m.blurb}</small></span>
                  <em>{m.plan}</em>
                </button>
                <button className={`pool-check ${enabled.includes(m.id) ? "on" : ""}`} onClick={() => onToggle(m.id)} title={enabled.includes(m.id) ? "Remove from Auto pool" : "Add to Auto pool"}>
                  {enabled.includes(m.id) && <IconCheck size={12} />}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PreviewPane({
  entry,
  sessionId,
  serverUrl,
  nonce,
  width,
  onWidth,
  onRefresh,
  onClose,
}: {
  entry: string;
  sessionId: string;
  serverUrl: string | null;
  nonce: number;
  width: number;
  onWidth: (w: number) => void;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [files, setFiles] = useState<{ name: string; path: string; type: "file" | "dir"; size?: number }[]>([]);
  const [showFiles, setShowFiles] = useState(false);
  const [filesMinimized, setFilesMinimized] = useState(false);
  const [filesMaximized, setFilesMaximized] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set());
  const [openFile, setOpenFile] = useState<{ path: string; content?: string; error?: string } | null>(null);

  useEffect(() => {
    let live = true;
    const load = () =>
      fetch(`/api/workspace?session=${encodeURIComponent(sessionId)}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((data) => { if (live) setFiles(data.files ?? []); })
        .catch(() => {});
    load();
    const timer = window.setInterval(load, 1200);
    return () => { live = false; window.clearInterval(timer); };
  }, [sessionId, nonce]);
  function toggleFolder(path: string) {
    setCollapsedFolders((current) => {
      const next = new Set(current);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }
  async function inspectFile(filePath: string) {
    setOpenFile({ path: filePath });
    try {
      const response = await fetch(`/api/workspace?session=${encodeURIComponent(sessionId)}&file=${encodeURIComponent(filePath)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not open file");
      setOpenFile({ path: filePath, content: data.content ?? "" });
    } catch (error: any) {
      setOpenFile({ path: filePath, error: error?.message ?? "Could not open file" });
    }
  }
  function isVisible(path: string) {
    const bits = path.split("/");
    for (let i = 1; i < bits.length; i++) {
      if (collapsedFolders.has(bits.slice(0, i).join("/"))) return false;
    }
    return true;
  }
  function startResize(e: React.PointerEvent) {
    e.preventDefault();
    setDragging(true);
    const onMove = (ev: PointerEvent) => {
      const min = Math.min(260, window.innerWidth * 0.45);
      const max = Math.max(min, window.innerWidth - Math.min(320, window.innerWidth * 0.42));
      const w = Math.min(Math.max(window.innerWidth - ev.clientX, min), max);
      onWidth(w);
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }
  return (
    <div className="preview-pane" style={{ width }}>
      <div
        className={`preview-resize ${dragging ? "on" : ""}`}
        onPointerDown={startResize}
        title="Drag to resize"
      />
      <div className="preview-head">
        <div className="preview-title">
          <IconEye size={15} />
          <span>Preview</span>
          <span className="preview-path">{serverUrl ?? entry}</span>
        </div>
        <div className="preview-actions">
          <button className={showFiles ? "on" : ""} onClick={() => setShowFiles((v) => !v)} title="Toggle project files">
            <IconFolder size={15} />
          </button>
          <button onClick={onRefresh} title="Reload">
            <IconRefresh size={15} />
          </button>
          <a href={serverUrl ?? `/preview/_s/${encodeURIComponent(sessionId)}/${entry}`} target="_blank" rel="noreferrer" title="Open project server in new tab">
            <IconExternal size={15} />
          </a>
          <button onClick={onClose} title="Close">
            <IconX size={15} />
          </button>
        </div>
      </div>
      <div className="preview-body">
        {showFiles && (
          <aside className={`file-browser floating ${filesMinimized ? "minimized" : ""} ${filesMaximized ? "maximized" : ""}`}>
            <div className="file-browser-head">
              <div className="file-browser-title">
                <span className="file-browser-icon"><IconFolder size={14} /></span>
                <span><strong>Project files</strong><small>{files.filter((file) => file.type === "file").length} files</small></span>
              </div>
              <div className="file-window-actions">
                <button onClick={() => setFilesMinimized((v) => !v)} title={filesMinimized ? "Restore" : "Minimize"}>−</button>
                <button onClick={() => { setFilesMaximized((v) => !v); setFilesMinimized(false); }} title={filesMaximized ? "Restore size" : "Maximize"}>□</button>
                <button onClick={() => setShowFiles(false)} title="Close"><IconX size={13} /></button>
              </div>
            </div>
            {!filesMinimized && <>
              <div className="file-browser-tools">
                {openFile ? <button onClick={() => setOpenFile(null)}><IconChevron size={11} /> Back to files</button> : <>
                  <button onClick={() => setCollapsedFolders(new Set())}>Expand all</button>
                  <button onClick={() => setCollapsedFolders(new Set(files.filter((file) => file.type === "dir").map((file) => file.path)))}>Collapse all</button>
                </>}
              </div>
              {openFile ? <div className="file-inspector">
                <div className="file-inspector-path"><IconFile size={13} /><span>{openFile.path}</span></div>
                {openFile.error ? <div className="file-empty">{openFile.error}</div> : openFile.content === undefined ? <div className="file-empty"><span className="spinner" /> Opening file…</div> : <pre>{openFile.content}</pre>}
              </div> : <div className="file-tree">
                {files.length ? files.filter((file) => isVisible(file.path)).map((file) => {
                  const depth = Math.max(0, file.path.split("/").length - 1);
                  return (
                    <button className={`file-row ${file.type}`} key={file.path} style={{ paddingLeft: 10 + depth * 16 }} title={file.path} onClick={() => file.type === "dir" ? toggleFolder(file.path) : inspectFile(file.path)}>
                      {file.type === "dir" && <IconChevron size={11} className={collapsedFolders.has(file.path) ? "folder-chevron collapsed" : "folder-chevron"} />}
                      {file.type === "dir" ? <IconFolder size={14} /> : <IconFile size={14} />}
                      <span>{file.name}</span>
                      {file.type === "file" && file.size != null && <small>{file.size < 1024 ? `${file.size} B` : `${Math.round(file.size / 1024)} KB`}</small>}
                    </button>
                  );
                }) : <div className="file-empty">Files will appear as models build…</div>}
              </div>}
            </>}
          </aside>
        )}
        <iframe
          key={nonce}
          src={serverUrl ? `${serverUrl}/?n=${nonce}` : `/preview/_s/${encodeURIComponent(sessionId)}/${entry}?n=${nonce}`}
          className="preview-frame"
          title="preview"
          style={{ pointerEvents: dragging ? "none" : "auto" }}
          sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"
        />
      </div>
    </div>
  );
}

function ThreadMinimap({ messages, containerRef }: { messages: Msg[]; containerRef: React.RefObject<HTMLDivElement | null> }) {
  const turns = messages.map((message, messageIndex) => ({ message, messageIndex })).filter(({ message }) => message.role === "user");
  const [activeTurn, setActiveTurn] = useState(0);
  const [hoveredTurn, setHoveredTurn] = useState<number | null>(null);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const sync = () => {
      const nodes = container.querySelectorAll<HTMLElement>(".thread-inner > .msg");
      const target = container.getBoundingClientRect().top + container.clientHeight * .4;
      let nearest = 0;
      let nearestDistance = Infinity;
      turns.forEach((turn, index) => {
        const node = nodes[turn.messageIndex];
        if (!node) return;
        const distance = Math.abs(node.getBoundingClientRect().top - target);
        if (distance < nearestDistance) { nearestDistance = distance; nearest = index; }
      });
      setActiveTurn(nearest);
    };
    sync();
    container.addEventListener("scroll", sync, { passive: true });
    return () => container.removeEventListener("scroll", sync);
  }, [containerRef, messages.length]);
  if (!turns.length) return null;
  const jump = (turnIndex: number) => {
    const container = containerRef.current;
    const nodes = container?.querySelectorAll<HTMLElement>(".thread-inner > .msg");
    nodes?.[turns[turnIndex].messageIndex]?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const hoveredMessage = hoveredTurn === null ? null : turns[hoveredTurn].message;
  const previewText = hoveredMessage ? (hoveredMessage.content || hoveredMessage.analysis?.intent || hoveredMessage.status || "Model activity").replace(/[`#>*_\[\]]/g, "").replace(/\s+/g, " ").trim() : "";
  return <nav className="thread-minimap" aria-label="Conversation turns" style={{ height: `${Math.min(190, Math.max(22, turns.length * 15))}px` }} onMouseLeave={() => setHoveredTurn(null)}>
    <div className="minimap-rail">
      {turns.map((_, index) => <button key={index} className={index === activeTurn ? "active" : ""} onMouseEnter={() => setHoveredTurn(index)} onFocus={() => setHoveredTurn(index)} onBlur={() => setHoveredTurn(null)} onClick={() => jump(index)} aria-label={`Jump to user turn ${index + 1}`} />)}
    </div>
    {hoveredMessage && hoveredTurn !== null && <div className="minimap-popover" style={{ top: `${turns.length === 1 ? 50 : Math.max(7, Math.min(93, hoveredTurn / (turns.length - 1) * 100))}%` }}>
      <strong>{previewText}</strong>
      <p>User prompt</p>
      <div><span><IconGlobe size={13} /> Turn {hoveredTurn + 1}</span></div>
    </div>}
  </nav>;
}

function StepLog({ msg }: { msg: Msg }) {
  const [manualOpen, setManualOpen] = useState(false);
  // Execution activity only — routing/analysis is shown in the tree.
  const steps = (msg.steps ?? []).filter(
    (s) => !["analyze", "route"].includes(s.kind),
  );
  if (steps.length === 0) return null;
  const show = msg.streaming || manualOpen;
  return (
    <div className="steplog">
      <button className="steplog-head" onClick={() => setManualOpen((o) => !o)}>
        {msg.streaming ? (
          <span className="spinner" style={{ width: 13, height: 13 }} />
        ) : (
          <IconCheck size={14} />
        )}
        <span>
          {msg.streaming ? "Working" : "Completed"} · {steps.length} step
          {steps.length !== 1 ? "s" : ""}
        </span>
        <IconChevron
          size={14}
          className="chev"
          strokeWidth={2}
        />
      </button>
      {show && (
        <div className="steplog-body">
          {steps.map((s, i) => (
            <div className="steplog-item" key={i}>
              <span className="sl-ic">{stepIcon(s.kind)}</span>
              <span className="sl-label">{s.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RunTelemetry({ msg }: { msg: Msg }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!msg.streaming) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [msg.streaming]);
  const tasks = msg.analysis?.subtasks ?? [];
  const completed = tasks.filter((task) => task.status === "done").length;
  const progress = tasks.length ? Math.round(completed / tasks.length * 100) : 0;
  const elapsed = Math.max(0, Math.round(((msg.completedAt ?? now) - (msg.startedAt ?? now)) / 1000));
  const estimate = msg.analysis?.estimate;
  const measuredTokens = msg.usage?.totalTokens ?? ((msg.usage?.inputTokens ?? 0) + (msg.usage?.outputTokens ?? 0));
  const budget = msg.budget;
  return (
    <div className="run-telemetry">
      <div className="run-progress"><i style={{ width: `${progress}%` }} /></div>
      <div className="run-stats">
        <span><IconClock size={12} /> {elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`}</span>
        <span><IconLayers size={12} /> {completed}/{tasks.length} tasks</span>
        {estimate && <span><IconGauge size={12} /> ~{estimate.minutes} min · {estimate.computeUnits} compute</span>}
        {msg.nativeExecution && <span className="native-saving"><IconBolt size={12} /> 0 model tokens</span>}
        {!!msg.usage && <span><IconCpu size={12} /> {measuredTokens.toLocaleString()} tokens</span>}
        {!!msg.providerCalls && <span><IconRoute size={12} /> {msg.providerCalls} model {msg.providerCalls === 1 ? "call" : "calls"}</span>}
        {!!msg.usage?.cacheReadTokens && <span title="Provider-reported prompt cache reads"><IconCpu size={12} /> {msg.usage.cacheReadTokens.toLocaleString()} cached input</span>}
        {budget && <span className={`budget-stat ${budget.state}`} title={budget.reason}><IconGauge size={12} /> {Math.round(budget.utilization * 100)}% of budget</span>}
        {!!msg.contextOptimization?.avoidedCharacters && <span title={`${msg.contextOptimization.avoidedCharacters.toLocaleString()} conversation characters excluded before provider execution`}><IconLayers size={12} /> {Math.round(msg.contextOptimization.reductionRate * 100)}% old context trimmed</span>}
        {!!msg.usage?.saved && msg.usage.saved > 0 && <span className="savings-stat">${msg.usage.saved.toFixed(2)} estimated savings</span>}
      </div>
      {budget && <div className={`token-budget ${budget.state}`}><i style={{ width: `${Math.min(100, budget.utilization * 100)}%` }} /><span>{budget.usedTokens.toLocaleString()} / {budget.tokenBudget.toLocaleString()} measured tokens</span></div>}
    </div>
  );
}

function RoutingTree({ msg }: { msg: Msg }) {
  const a = msg.analysis!;
  const streaming = msg.streaming;
  return (
    <div className="plan-card">
      <div className="plan-h">
        <IconRoute size={14} /> Routing plan
        {streaming && (
          <span className="plan-live">
            <span className="spinner" style={{ width: 12, height: 12 }} />
            {msg.status ?? "Working"}
          </span>
        )}
      </div>
      <RunTelemetry msg={msg} />
      {msg.contract && <details className="run-contract"><summary><span><IconShield size={13} /> Delivery contract</span><em>{msg.contract.acceptanceCriteria.length} checks · {msg.contract.budget.tokenBudget.toLocaleString()} token ceiling</em><IconChevron size={12} /></summary><div><strong>{msg.contract.objective}</strong><ul>{msg.contract.acceptanceCriteria.map((criterion) => <li key={criterion}>{criterion}</li>)}</ul><small>Evidence: {msg.contract.evidence.join(" · ")}</small></div></details>}
      <div className="tree">
        <div className="tree-root">
          <span className="node-ic">
            <HyzrMark size={15} />
          </span>
          {a.intent}
        </div>
        <div className="tree-branches">
          <div className="tree-node done">
            <span className="node-ic">
              <BrandMark brand="openai" size={15} />
            </span>
            <div className="node-body">
              <div className="node-title">Planner · GPT-5.4 Mini</div>
              <div className="node-sub">Classifies workload, tools, modality, and priorities</div>
            </div>
            <span className="node-state">
              {a.preliminary ? (
                <>
                  <span className="spinner" style={{ width: 11, height: 11 }} /> analyzing
                </>
              ) : (
                <>
                  <IconCheck size={12} /> analyzed
                </>
              )}
            </span>
          </div>
          {a.subtasks.map((st, i) => {
            const tm = st.modelId ? LOCAL_MODELS[st.modelId] : tierModel(st.tier);
            const state = st.status ?? (!streaming ? "done" : "queued");
            return (
              <div className={`tree-node ${state}`} key={i}>
                <span className="node-ic">
                  <BrandMark brand={brandFor(tm?.engine ?? "")} size={15} />
                </span>
                <div className="node-body">
                  <div className="node-title">
                    {st.title}
                  </div>
                  <div className="node-sub">
                    <span className="capability-chip">{st.capability ? CAPABILITY_LABELS[st.capability] : "General execution"}</span>
                    {st.routingTrace && <span className={`route-source ${st.routingTrace.source}`}>{st.routingTrace.source === "adaptive" ? "Evidence-backed" : st.routingTrace.source === "custom" ? "Your priority" : st.routingTrace.source === "provider" ? "Provider constraint" : "Cost default"}</span>}
                    <span className="node-model">{tm?.label} · {tm?.plan}</span>
                  </div>
                  {st.rationale && <div className="node-why">{st.rationale}</div>}
                  {st.routingTrace && st.routingTrace.candidates.some((candidate) => candidate.attempts > 0) && <details className="route-evidence"><summary>Decision evidence · {st.routingTrace.sampleCount} comparable outcomes <IconChevron size={10} /></summary><div>{st.routingTrace.candidates.filter((candidate) => candidate.attempts > 0).slice(0, 4).map((candidate) => <span key={candidate.modelId}><b>{LOCAL_MODELS[candidate.modelId]?.label ?? candidate.modelId}</b><em>{candidate.attempts} runs · {candidate.successRate == null ? "—" : `${Math.round(candidate.successRate * 100)}%`} accepted · {candidate.averageTokens == null ? "—" : `${Math.round(candidate.averageTokens).toLocaleString()} tok`}</em></span>)}</div></details>}
                </div>
                <span className="node-state">
                  {state === "done" ? (
                    <>
                      <IconCheck size={12} /> done
                    </>
                  ) : state === "active" ? (
                    <>
                      <span className="spinner" style={{ width: 11, height: 11 }} /> running
                    </>
                  ) : (
                    "queued"
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MessageView({
  msg,
  onCopy,
  onRegen,
  onFollowup,
}: {
  msg: Msg;
  onCopy: () => void;
  onRegen?: () => void;
  onFollowup: (q: string) => void;
}) {
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  if (msg.role === "user") {
    return (
      <div className="msg user">
        <div className="who">You</div>
        {msg.images && msg.images.length > 0 && (
          <div className="msg-images">
            {msg.images.map((im, i) => (
              <button key={i} className="msg-image-thumb" onClick={() => setExpandedImage(im.dataUrl)} title={`Open ${im.name}`}>
                <img src={im.dataUrl} alt={im.name} />
              </button>
            ))}
          </div>
        )}
        <div className="bubble">{msg.content}</div>
        {expandedImage && (
          <div className="image-lightbox" role="dialog" aria-modal="true" onClick={() => setExpandedImage(null)}>
            <button onClick={() => setExpandedImage(null)} aria-label="Close image"><IconX size={18} /></button>
            <img src={expandedImage} alt="Attachment preview" onClick={(e) => e.stopPropagation()} />
          </div>
        )}
      </div>
    );
  }

  const showStatusOnly = msg.streaming && !msg.content && !msg.analysis;

  return (
    <div className="msg assistant">
      <div className="who">
        <span className="who-ic">
          <HyzrMark size={14} />
        </span>
        Hyzr Chat
      </div>

      {msg.analysis && <RoutingTree msg={msg} />}

      {!msg.analysis && msg.contract && <details className="run-contract standalone"><summary><span><IconShield size={13} /> Delivery contract</span><em>{msg.contract.acceptanceCriteria.length} checks</em><IconChevron size={12} /></summary><div><strong>{msg.contract.objective}</strong><ul>{msg.contract.acceptanceCriteria.map((criterion) => <li key={criterion}>{criterion}</li>)}</ul></div></details>}

      <StepLog msg={msg} />

      {showStatusOnly && (
        <div className="status-line">
          <span className="pulse" />
          {msg.status ?? "Working"}…
        </div>
      )}

      {msg.route && !msg.analysis && (
        <div className="route-badge">
          <BrandMark brand={brandFor(msg.route.provider)} size={14} />
          <strong>{msg.route.modelLabel}</strong>
          <span className="rb-tier">{msg.route.capability && msg.route.capability in CAPABILITY_LABELS ? CAPABILITY_LABELS[msg.route.capability as keyof typeof CAPABILITY_LABELS] : "General"}</span>
          {msg.route.plan && (
            <span className="rb-meta">
              <IconShield size={12} /> {msg.route.plan}
              {msg.usage ? ` · ${msg.usage.outputTokens} tok` : ""}
            </span>
          )}
          {msg.route.routingTrace && <details className="route-decision"><summary>{msg.route.routingTrace.source === "adaptive" ? "Evidence-backed route" : "Why this model"}<IconChevron size={10} /></summary><div><p>{msg.route.routingTrace.reason}</p>{msg.route.routingTrace.candidates.some((candidate) => candidate.attempts > 0) && <small>{msg.route.routingTrace.sampleCount} comparable rated outcomes were evaluated.</small>}</div></details>}
        </div>
      )}

      {msg.nativeExecution && <div className="native-evidence"><IconBolt size={14} /><div><strong>Completed without a model call</strong><span>{msg.nativeExecution.evidence?.join(" · ") || "Deterministic Hyzr Chat operation"}</span></div></div>}

      {(msg.content || msg.imageB64) && (
        <div className="bubble">
          {msg.content && <Markdown content={msg.content} />}
          {msg.streaming && msg.content && <span className="cursor" />}
          {msg.imageB64 && (
            <img
              className="gen-image"
              src={`data:image/png;base64,${msg.imageB64}`}
              alt="generated"
            />
          )}
        </div>
      )}

      {!msg.streaming && msg.content && (
        <div className="msg-actions">
          <button className="msg-act" onClick={onCopy} title="Copy">
            <IconCopy size={14} /> Copy
          </button>
          {onRegen && (
            <button className="msg-act" onClick={onRegen} title="Regenerate">
              <IconRefresh size={14} /> Regenerate
            </button>
          )}
        </div>
      )}

      {!msg.streaming && msg.followups && msg.followups.length > 0 && (
        <div className="followups">
          <div className="fu-head">Related</div>
          {msg.followups.map((q, i) => (
            <button key={i} className="followup" onClick={() => onFollowup(q)}>
              <IconPlus size={14} /> {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type SettingsPage = "general" | "profile" | "appearance" | "language" | "voice" | "privacy" | "routing" | "models" | "connections" | "capabilities" | "usage" | "billing" | "shortcuts" | "help" | "about";
const SETTINGS_NAV: { group: string; items: { id: SettingsPage; label: string; icon: React.ReactNode }[] }[] = [
  { group: "Personal", items: [
    { id: "general", label: "General", icon: <IconSliders size={15} /> }, { id: "profile", label: "Profile", icon: <IconSparkles size={15} /> },
    { id: "appearance", label: "Appearance", icon: <IconPalette size={15} /> }, { id: "language", label: "Language", icon: <IconGlobe size={15} /> },
    { id: "voice", label: "Voice", icon: <IconMic size={15} /> }, { id: "privacy", label: "Privacy & data", icon: <IconShield size={15} /> },
  ]},
  { group: "Intelligence", items: [
    { id: "routing", label: "Routing", icon: <IconRoute size={15} /> }, { id: "models", label: "Models", icon: <IconCpu size={15} /> },
    { id: "capabilities", label: "Capabilities", icon: <IconPuzzle size={15} /> }, { id: "connections", label: "Connections", icon: <IconPlug size={15} /> },
  ]},
  { group: "Plan", items: [
    { id: "usage", label: "Usage & limits", icon: <IconGauge size={15} /> }, { id: "billing", label: "Plans & billing", icon: <IconKey size={15} /> },
  ]},
  { group: "Support", items: [
    { id: "shortcuts", label: "Keyboard shortcuts", icon: <IconTerminal size={15} /> }, { id: "help", label: "Help & learn", icon: <IconBook size={15} /> },
    { id: "about", label: "About Hyzr Chat", icon: <HyzrMark size={14} /> },
  ]},
];

function StyledSelect({ value, options, onChange, placeholder = "Select" }: { value: string; options: { value: string; label: string; detail?: string }[]; onChange: (value: string) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 220 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);
  function toggle() {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const width = Math.max(220, rect.width);
      setPosition({ top: rect.bottom + 6, left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)), width });
    }
    setOpen((current) => !current);
  }
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { const target = event.target as Node; if (!buttonRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false); };
    const closeOnScroll = () => setOpen(false);
    document.addEventListener("pointerdown", close);
    window.addEventListener("resize", closeOnScroll);
    document.querySelector(".settings-scroll")?.addEventListener("scroll", closeOnScroll);
    return () => { document.removeEventListener("pointerdown", close); window.removeEventListener("resize", closeOnScroll); document.querySelector(".settings-scroll")?.removeEventListener("scroll", closeOnScroll); };
  }, [open]);
  return <div className="styled-select"><button ref={buttonRef} className={open ? "open" : ""} onClick={toggle}><span><strong>{selected?.label ?? placeholder}</strong>{selected?.detail && <small>{selected.detail}</small>}</span><IconChevron size={13} /></button>{open && <div ref={menuRef} className="styled-select-menu" style={{ top: position.top, left: position.left, width: position.width }}>{options.map((option) => <button key={option.value} className={option.value === value ? "on" : ""} onClick={() => { onChange(option.value); setOpen(false); }}><span><strong>{option.label}</strong>{option.detail && <small>{option.detail}</small>}</span>{option.value === value && <IconCheck size={13} />}</button>)}</div>}</div>;
}

function ModelPrioritySelect({ value, models, onChange, label }: { value?: string; models: string[]; onChange: (value: string) => void; label: string }) {
  const options = [{ value: "", label: "Unassigned", detail: label }, ...models.map((id) => ({ value: id, label: LOCAL_MODELS[id]?.label ?? id, detail: LOCAL_MODELS[id]?.plan ?? "" }))];
  return <StyledSelect value={value ?? ""} options={options} onChange={onChange} placeholder={label} />;
}

function Toggle({ value, onChange, disabled = false }: { value: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <button className={`setting-toggle ${value ? "on" : ""}`} onClick={() => !disabled && onChange(!value)} disabled={disabled} aria-pressed={value}><i /></button>;
}
function SettingRow({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return <div className="setting-row"><div><strong>{title}</strong>{description && <span>{description}</span>}</div><aside>{children}</aside></div>;
}
function SettingSection({ title, description, children }: { title?: string; description?: string; children: React.ReactNode }) {
  return <section className="setting-section">{title && <div className="setting-section-title"><h3>{title}</h3>{description && <p>{description}</p>}</div>}<div className="setting-group">{children}</div></section>;
}

interface RoutingLearningSummary {
  ratedDecisions: number;
  adaptiveRoutes: number;
  capabilities: Array<{ capability: TaskCapability; tier: string; samples: number; winner: string; adapted: boolean }>;
}

function RoutingLearningPanel() {
  const [summary, setSummary] = useState<RoutingLearningSummary | null>(null);
  const [resetting, setResetting] = useState(false);
  const load = async () => {
    try {
      const response = await fetch("/api/telemetry", { cache: "no-store" });
      const payload = await response.json();
      setSummary(payload.routingLearning ?? null);
    } catch { setSummary(null); }
  };
  useEffect(() => { void load(); }, []);
  const reset = async () => {
    setResetting(true);
    try {
      const response = await fetch("/api/telemetry", { method: "DELETE" });
      const payload = await response.json();
      setSummary(payload.routingLearning ?? null);
    } finally { setResetting(false); }
  };
  const capabilities = summary?.capabilities.slice(0, 6) ?? [];
  return <section className="routing-learning-panel">
    <div className="routing-learning-head"><div><span>Routing evidence</span><h3>Learn from accepted deliveries</h3><p>Hyzr Chat changes a default only after enough comparable results show a meaningful quality or token-efficiency gain. Your explicit model priorities always win.</p></div><button onClick={reset} disabled={resetting || !summary?.ratedDecisions}>{resetting ? "Resetting…" : "Reset evidence"}</button></div>
    <div className="routing-learning-stats"><div><strong>{summary?.ratedDecisions ?? 0}</strong><span>rated model decisions</span></div><div><strong>{summary?.adaptiveRoutes ?? 0}</strong><span>evidence-backed routes</span></div><div><strong>6+</strong><span>minimum comparable samples</span></div></div>
    {capabilities.length ? <div className="routing-learning-list">{capabilities.map((item) => <div key={`${item.capability}-${item.tier}`}><span><strong>{CAPABILITY_LABELS[item.capability]}</strong><small>{item.tier} · {item.samples} samples</small></span><em>{LOCAL_MODELS[item.winner]?.label ?? item.winner}</em><b className={item.adapted ? "adapted" : "baseline"}>{item.adapted ? "Adapted" : "Baseline"}</b></div>)}</div> : <div className="routing-learning-empty"><IconGauge size={17} /><span>Rate completed deliveries to build local evidence. Learning remains off until the sample threshold is met.</span></div>}
  </section>;
}

function SettingsModal({
  keys, mode, planOn, theme, onTheme, productPrefs, onProductPrefs, modelPool, onModelPool, routingRules, onRoutingRules, usage, onClearHistory,
  onTogglePlan, onSave, onClose, onOpenSymbols,
}: {
  keys: Keys; mode: Mode; planOn: boolean; theme: Theme; onTheme: (theme: Theme) => void;
  productPrefs: ProductPrefs; onProductPrefs: (prefs: ProductPrefs) => void;
  modelPool: string[]; onModelPool: (pool: string[]) => void; routingRules: RoutingRules; onRoutingRules: (rules: RoutingRules) => void;
  usage: { chats: number; runs: number; tokens: number; modelCalls: number; contextAvoided: number; budgetedRuns: number; withinBudget: number; saved: number | null }; onClearHistory: () => void;
  onTogglePlan: () => void; onSave: (keys: Keys) => void; onClose: () => void; onOpenSymbols: () => void;
}) {
  const [page, setPage] = useState<SettingsPage>("general");
  const [query, setQuery] = useState("");
  const [mobileDetail, setMobileDetail] = useState(false);
  const [anthropic, setAnthropic] = useState(keys.anthropic);
  const [openai, setOpenai] = useState(keys.openai);
  const [linear, setLinear] = useState(keys.linear);
  const [editingCapability, setEditingCapability] = useState<TaskCapability | null>(null);
  const updatePref = <K extends keyof ProductPrefs>(key: K, value: ProductPrefs[K]) => onProductPrefs({ ...productPrefs, [key]: value });
  const selectPage = (id: SettingsPage) => { setPage(id); setMobileDetail(true); };
  const filteredNav = SETTINGS_NAV.map((section) => ({ ...section, items: section.items.filter((item) => item.label.toLowerCase().includes(query.toLowerCase())) })).filter((section) => section.items.length);
  const title = SETTINGS_NAV.flatMap((section) => section.items).find((item) => item.id === page)?.label ?? "Settings";
  const availableModels = Object.keys(LOCAL_MODELS).filter((id) => modelPool.includes(id));
  function updateRoutingSlot(capability: TaskCapability, group: "primary" | "fallbacks", index: number, modelId: string) {
    const current = routingRules[capability] ?? DEFAULT_ROUTING_RULES[capability];
    const without = { primary: current.primary.filter((id) => id !== modelId), fallbacks: current.fallbacks.filter((id) => id !== modelId) };
    const next = [...without[group]];
    if (modelId) next[index] = modelId; else next.splice(index, 1);
    onRoutingRules({ ...routingRules, [capability]: { ...without, [group]: next.filter(Boolean).slice(0, group === "primary" ? 3 : 4) } });
  }
  function toggleAvailableModel(id: string) {
    if (modelPool.includes(id) && modelPool.length === 1) return;
    const nextPool = modelPool.includes(id) ? modelPool.filter((modelId) => modelId !== id) : [...modelPool, id];
    onModelPool(nextPool);
    if (!nextPool.includes(id)) {
      const cleaned = Object.fromEntries(Object.entries(routingRules).map(([capability, rule]) => [capability, { primary: (rule?.primary ?? []).filter((modelId) => modelId !== id), fallbacks: (rule?.fallbacks ?? []).filter((modelId) => modelId !== id) }]));
      onRoutingRules(cleaned as RoutingRules);
    }
  }

  const appearance = <>
    <SettingSection title="Theme" description="Choose a theme or follow your operating system."><div className="theme-options settings-theme-options">{(["light", "dark", "system"] as Theme[]).map((choice) => <button key={choice} className={theme === choice ? "on" : ""} onClick={() => onTheme(choice)}><span className={`theme-preview ${choice}`}><i /><i /><i /></span><strong>{choice[0].toUpperCase() + choice.slice(1)}</strong>{theme === choice && <IconCheck size={14} />}</button>)}</div></SettingSection>
    <SettingSection title="Interface"><SettingRow title="Compact conversations" description="Reduce spacing between messages and routing details."><Toggle value={productPrefs.compactChat} onChange={(value) => updatePref("compactChat", value)} /></SettingRow><SettingRow title="Show live usage" description="Display elapsed time, tasks, compute, and token telemetry during runs."><Toggle value={productPrefs.showUsage} onChange={(value) => updatePref("showUsage", value)} /></SettingRow><SettingRow title="Reduce motion" description="Minimize transitions and animated status effects."><Toggle value={productPrefs.reducedMotion} onChange={(value) => updatePref("reducedMotion", value)} /></SettingRow><SettingRow title="Product identity" description="See the shared identity used across the Hyzr product family."><button className="setting-button" onClick={onOpenSymbols}>View identity <IconArrowRight size={13} /></button></SettingRow></SettingSection>
  </>;

  const routingLearning = page === "routing" ? <><SettingSection title="Adaptive intelligence" description="Tune the defaults with your own measured outcomes without taking control away from you."><SettingRow title="Adaptive routing" description="Improve default routes only after conservative evidence thresholds. Explicit provider requests and custom priority lists are never overridden."><Toggle value={productPrefs.adaptiveRouting} onChange={(value) => updatePref("adaptiveRouting", value)} /></SettingRow></SettingSection><RoutingLearningPanel /></> : null;

  const renderPage = () => {
    switch (page) {
      case "general": return <><SettingSection title="Workspace permissions"><SettingRow title="Local full access" description="This local developer installation can edit isolated project files, run commands, and start preview servers."><span className="access-badge"><IconCheck size={12} /> Full access</span></SettingRow><SettingRow title="Remote device protection" description="Set Hyzr Chat_ACCESS_TOKEN before a pilot. LAN devices are redirected to a pairing screen and receive an HttpOnly 30-day access cookie."><span className="setting-value">Pairing supported</span></SettingRow><SettingRow title="Auto-review" description="Ask the finishing model to check correctness, regressions, and incomplete requirements."><Toggle value={productPrefs.autoReview} onChange={(value) => updatePref("autoReview", value)} /></SettingRow></SettingSection><SettingSection title="Projects"><SettingRow title="Open previews automatically" description="Show the project as soon as a previewable entry file exists."><Toggle value={productPrefs.autoPreview} onChange={(value) => updatePref("autoPreview", value)} /></SettingRow><SettingRow title="Project storage" description="Each chat uses a persistent isolated workspace."><code>~/hyzr-chat-workspaces/&lt;chat&gt;</code></SettingRow><SettingRow title="Execution source"><span className="setting-value">{mode === "local" ? "Local subscriptions" : "API keys"}</span></SettingRow></SettingSection></>;
      case "profile": return <><div className="profile-hero"><span>M</span><div><h3>Local developer</h3><p>Full-access owner workspace</p></div><em>Local</em></div><SettingSection title="Account"><SettingRow title="Access level" description="No Hyzr Chat subscription restrictions apply to this installation."><span className="access-badge"><IconCheck size={12} /> Full access</span></SettingRow><SettingRow title="Projects"><span className="setting-value">{usage.chats} chats</span></SettingRow><SettingRow title="Authentication" description="Claude Max and ChatGPT Pro use their authenticated local CLIs."><span className="setting-value">Device local</span></SettingRow></SettingSection></>;
      case "appearance": return appearance;
      case "language": return <><SettingSection title="Language"><SettingRow title="Response language" description="Models will use this language unless your prompt requests another one."><StyledSelect value={productPrefs.language} onChange={(value) => updatePref("language", value)} options={["Auto detect", "English", "Spanish", "French", "German", "Portuguese", "Japanese", "Korean", "Chinese"].map((language) => ({ value: language, label: language }))} /></SettingRow><SettingRow title="Interface language" description="Additional translated interfaces will arrive with hosted accounts."><StyledSelect value="English" onChange={() => {}} options={[{ value: "English", label: "English", detail: "Current interface" }]} /></SettingRow></SettingSection><div className="settings-callout"><IconGlobe size={16} /><div><strong>Automatic multilingual routing</strong><span>All current GPT‑5.6 and Claude models can understand multilingual prompts. The planner keeps the project’s existing language conventions.</span></div></div></>;
      case "voice": return <><SettingSection title="Voice input"><SettingRow title="Enable microphone" description="Show the microphone control in the composer when supported by your browser."><Toggle value={productPrefs.voiceInput} onChange={(value) => updatePref("voiceInput", value)} /></SettingRow><SettingRow title="Input provider"><span className="setting-value">Browser speech recognition</span></SettingRow><SettingRow title="Voice responses" description="Realtime spoken responses are planned for hosted plans."><span className="future-badge">Coming later</span></SettingRow></SettingSection></>;
      case "privacy": return <><SettingSection title="Local data"><SettingRow title="Save chat history" description="Persist conversations in IndexedDB on this device. Turning this off clears saved history after the setting is applied."><Toggle value={productPrefs.saveHistory} onChange={(value) => updatePref("saveHistory", value)} /></SettingRow><SettingRow title="Project files" description="Project workspaces remain outside the Hyzr Chat source directory and are never mixed between chats."><span className="setting-value">Isolated</span></SettingRow><SettingRow title="Clear chat history" description="Removes local conversation history. Project workspace files remain on disk."><button className="setting-button danger" onClick={onClearHistory}>Clear history</button></SettingRow></SettingSection><div className="settings-callout"><IconShield size={16} /><div><strong>No hosted Hyzr Chat account</strong><span>This local installation does not upload chat history to a Hyzr service. Model providers receive prompts through their authenticated CLI or API.</span></div></div></>;
      case "routing": return <><SettingSection title="Capability routing" description="Every category has three primary choices followed by fallbacks. Auto matches the task’s cost tier first, then respects left-to-right order within that tier."><SettingRow title="Automatic routing" description="Use lightweight models for trivial operations, balanced models for everyday work, and frontier models only when complexity justifies them."><Toggle value={planOn} onChange={onTogglePlan} /></SettingRow></SettingSection><div className="routing-rule-list">{(Object.entries(CAPABILITY_LABELS) as [TaskCapability,string][]).map(([capability, label]) => { const rule = routingRules[capability] ?? DEFAULT_ROUTING_RULES[capability]; const active = editingCapability === capability; const visiblePrimary = rule.primary.filter((id) => modelPool.includes(id)); const visibleFallbacks = rule.fallbacks.filter((id) => modelPool.includes(id)); return <div className={`routing-rule ${active ? "editing" : ""}`} key={capability}><button className="routing-rule-summary" onClick={() => setEditingCapability(active ? null : capability)}><div><strong>{label}</strong><span>{visiblePrimary.length ? visiblePrimary.map((id) => LOCAL_MODELS[id]?.label).join(" → ") : "No primary models assigned"}</span></div><em>{visibleFallbacks.length ? `Fallback: ${visibleFallbacks.map((id) => LOCAL_MODELS[id]?.label).join(" → ")}` : "No fallback"}</em><IconChevron size={13} /></button>{active && <div className="routing-rule-editor"><div className="routing-editor-label"><strong>Primary model pool</strong><span>Cost tier first · priority within tier</span></div><div className="routing-select-grid">{[0,1,2].map((index) => <ModelPrioritySelect key={index} label={`Priority ${index + 1}`} value={visiblePrimary[index]} models={availableModels} onChange={(id) => updateRoutingSlot(capability,"primary",index,id)} />)}</div><div className="routing-editor-label"><strong>Fallback order</strong><span>Used when matching primary models are unavailable</span></div><div className="routing-select-grid fallbacks">{[0,1,2,3].map((index) => <ModelPrioritySelect key={index} label={`Fallback ${index + 1}`} value={visibleFallbacks[index]} models={availableModels} onChange={(id) => updateRoutingSlot(capability,"fallbacks",index,id)} />)}</div></div>}</div>; })}</div></>;
      case "models": return <><div className="models-settings-head"><div><strong>Available model pool</strong><span>{modelPool.length} of {Object.keys(LOCAL_MODELS).length} models available to Auto routing</span></div><button onClick={() => onModelPool(Object.keys(LOCAL_MODELS))}>Enable all</button></div><div className="model-settings-list">{Object.values(LOCAL_MODELS).map((model) => { const enabled = modelPool.includes(model.id); const profile = capabilityProfile(model.id); return <div className={`model-setting-row ${enabled ? "enabled" : ""}`} key={model.id}><span className="model-setting-mark"><BrandMark brand={brandFor(model.engine)} size={17} /></span><div><strong>{model.label}</strong><span>{profile.bestFor}</span></div><em>{model.plan}</em><Toggle value={enabled} onChange={() => toggleAvailableModel(model.id)} disabled={enabled && modelPool.length === 1} /></div>; })}</div></>;
      case "connections": return <><SettingSection title="Subscription CLIs"><SettingRow title="Claude Max" description="Uses the logged-in Claude CLI without an API key."><span className="access-badge"><IconCheck size={12} /> Connected</span></SettingRow><SettingRow title="ChatGPT Pro" description="Uses the logged-in Codex CLI without an API key."><span className="access-badge"><IconCheck size={12} /> Connected</span></SettingRow></SettingSection><SettingSection title="Engineering integrations" description="Credentials stay in this browser. Hosted team installations should use OAuth."><div className="settings-key-field"><label>Linear personal API key</label><input type="password" value={linear} onChange={(event) => setLinear(event.target.value)} placeholder="lin_api_…" /></div></SettingSection><SettingSection title="Model API keys" description="Optional pay-per-token mode. Keys stay in this browser’s local storage."><div className="settings-key-field"><label>Anthropic</label><input type="password" value={anthropic} onChange={(event) => setAnthropic(event.target.value)} placeholder="sk-ant-…" /></div><div className="settings-key-field"><label>OpenAI</label><input type="password" value={openai} onChange={(event) => setOpenai(event.target.value)} placeholder="sk-…" /></div><div className="settings-save-row"><button className="btn primary" onClick={() => onSave({ anthropic, openai, linear })}>Save connections</button></div></SettingSection></>;
      case "capabilities": return <><div className="capability-settings-grid">{[["Project workspaces","Persistent files isolated per chat",IconFolder],["Live previews","Dedicated localhost server with file inspection",IconEye],["Multi-model plans","Capability-specific Claude and ChatGPT specialists",IconRoute],["Vision","Screenshot and image understanding",IconImage],["Web research","Agentic search with source synthesis",IconGlobe],["Image generation","GPT Image workflows through supported tools",IconSparkles],["GitHub","Repository and file context through GitHub CLI",IconGithub],["Voice input","Browser speech recognition",IconMic]].map(([name, desc, Icon]: any) => <div key={name}><span><Icon size={16} /></span><strong>{name}</strong><p>{desc}</p><em>Available</em></div>)}</div></>;
      case "usage": return <><div className="usage-hero"><div><span>Measured execution efficiency</span><strong>{usage.saved == null ? "Savings awaiting calibration" : `$${usage.saved.toFixed(2)} estimated saved`}</strong><p>Hyzr Chat shows measured tokens, provider calls, excluded conversation context, and enforced budgets. Monetary savings appear only when pricing and a comparable baseline are configured.</p></div><IconGauge size={28} /></div><div className="usage-stats"><div><span>Tracked tokens</span><strong>{usage.tokens.toLocaleString()}</strong></div><div><span>Model calls</span><strong>{usage.modelCalls.toLocaleString()}</strong></div><div><span>Old context excluded</span><strong>{usage.contextAvoided.toLocaleString()} chars</strong></div><div><span>Within budget</span><strong>{usage.budgetedRuns ? `${usage.withinBudget}/${usage.budgetedRuns}` : "—"}</strong></div><div><span>Verified savings</span><strong>{usage.saved == null ? "Not calibrated" : `$${usage.saved.toFixed(2)}`}</strong></div></div><div className="settings-callout"><IconShield size={16} /><div><strong>No invented savings</strong><span>Follow-up chips now use zero model calls. Token ceilings and provider usage are measured directly; monetary savings remain hidden until Hyzr Chat has comparable pricing or benchmark evidence.</span></div></div><SettingSection title="Provider limits"><SettingRow title="ChatGPT Pro" description="Managed by your ChatGPT subscription and Codex usage window."><a href="https://help.openai.com" target="_blank" rel="noreferrer">View provider help <IconExternal size={12} /></a></SettingRow><SettingRow title="Claude Max" description="Managed by your Claude plan and session limits."><a href="https://support.anthropic.com" target="_blank" rel="noreferrer">View provider help <IconExternal size={12} /></a></SettingRow></SettingSection></>;
      case "billing": return <><div className="current-plan"><span>Current plan</span><div><h3>Local Developer</h3><strong>$0</strong></div><p>Owner access to every local Hyzr Chat feature. Your Claude and ChatGPT subscriptions are billed separately by their providers.</p><em><IconCheck size={12} /> Full access</em></div><div className="plan-grid"><div><span>Future</span><h3>Pro</h3><p>Hosted projects, synced history, managed models, and expanded generation.</p><button disabled>Not yet available</button></div><div><span>Future</span><h3>Team</h3><p>Shared workspaces, organization controls, audit logs, and centralized billing.</p><button disabled>Not yet available</button></div></div><div className="settings-callout"><IconKey size={16} /><div><strong>No Hyzr Chat charges</strong><span>This installation has no subscription or payment method. Hosted plans will be opt-in when introduced.</span></div></div></>;
      case "shortcuts": return <SettingSection title="Keyboard shortcuts"><SettingRow title="New chat" description="Choose the global shortcut used to start a fresh project."><StyledSelect value={productPrefs.newChatKey} onChange={(value) => updatePref("newChatKey", value as "k" | "n")} options={[{value:"k",label:"Ctrl / ⌘  K"},{value:"n",label:"Ctrl / ⌘  N"}]} /></SettingRow><SettingRow title="Send message" description="When disabled, Ctrl / ⌘ + Enter sends and Enter creates a new line."><div className="shortcut-toggle"><span>{productPrefs.sendWithEnter ? "Enter" : "Ctrl / ⌘  Enter"}</span><Toggle value={productPrefs.sendWithEnter} onChange={(value) => updatePref("sendWithEnter", value)} /></div></SettingRow><SettingRow title="New line"><kbd>{productPrefs.sendWithEnter ? "Shift  Enter" : "Enter"}</kbd></SettingRow><SettingRow title="Close menu or settings"><kbd>Escape</kbd></SettingRow></SettingSection>;
      case "help": return <><div className="help-grid"><a href="https://developers.openai.com/codex" target="_blank" rel="noreferrer"><IconBook size={18} /><strong>Codex documentation</strong><span>Learn about local coding agents and configuration.</span></a><a href="https://docs.anthropic.com/en/docs/claude-code" target="_blank" rel="noreferrer"><IconCode size={18} /><strong>Claude Code documentation</strong><span>Learn about Claude’s local development workflow.</span></a><a href="https://help.openai.com" target="_blank" rel="noreferrer"><IconExternal size={18} /><strong>Get provider help</strong><span>Account, subscription, and usage support.</span></a><button onClick={() => window.location.reload()}><IconRefresh size={18} /><strong>Reload Hyzr Chat</strong><span>Refresh the interface without deleting projects.</span></button></div><SettingSection title="Learn more"><SettingRow title="How routing works" description="A fast planner classifies each subtask and selects from your enabled model pool."><button className="setting-button" onClick={() => selectPage("routing")}>Open routing</button></SettingRow><SettingRow title="Usage and limits"><button className="setting-button" onClick={() => selectPage("usage")}>View usage</button></SettingRow></SettingSection></>;
      case "about": return <><div className="about-mark"><HyzrMark size={36} /><h2>Hyzr Chat</h2><p>One project workspace. The right model for every task.</p><span>Version {PRODUCT.version} · Local pilot build</span></div><SettingSection title="Runtime"><SettingRow title="Data architecture"><span className="setting-value">Local-first</span></SettingRow><SettingRow title="Workspace isolation"><span className="setting-value">Per chat</span></SettingRow><SettingRow title="Preview ports"><span className="setting-value">3001–3099</span></SettingRow></SettingSection></>;
    }
  };

  return <div className="overlay settings-overlay" onClick={onClose}><div className={`settings-modal ${mobileDetail ? "mobile-detail" : ""}`} onClick={(event) => event.stopPropagation()}>
    <aside className="settings-nav"><div className="settings-nav-head"><button onClick={onClose}><IconChevron size={14} /> Back to Hyzr Chat</button><div><IconSearch size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search settings" /></div></div><nav>{filteredNav.map((section) => <section key={section.group}><h4>{section.group}</h4>{section.items.map((item) => <button key={item.id} className={page === item.id ? "on" : ""} onClick={() => selectPage(item.id)}>{item.icon}<span>{item.label}</span><IconChevron size={12} /></button>)}</section>)}</nav><div className="settings-local-plan"><span>L</span><div><strong>Local Developer</strong><small>Full access</small></div><IconCheck size={13} /></div></aside>
    <main className="settings-content"><header><button className="settings-mobile-back" onClick={() => setMobileDetail(false)}><IconChevron size={14} /></button><div><span>Settings</span><h2>{title}</h2></div><button onClick={onClose} aria-label="Close settings"><IconX size={17} /></button></header><div className="settings-scroll">{routingLearning}{renderPage()}</div></main>
  </div></div>;
}

function LegacySettingsModal({
  keys,
  mode,
  planOn,
  theme,
  onTheme,
  onTogglePlan,
  onSave,
  onClose,
  onOpenSymbols,
}: {
  keys: Keys;
  mode: Mode;
  planOn: boolean;
  theme: Theme;
  onTheme: (theme: Theme) => void;
  onTogglePlan: () => void;
  onSave: (k: Keys) => void;
  onClose: () => void;
  onOpenSymbols: () => void;
}) {
  const [tab, setTab] = useState<"appearance" | "keys" | "routing" | "about">("appearance");
  const [anthropic, setAnthropic] = useState(keys.anthropic);
  const [openai, setOpenai] = useState(keys.openai);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">
          <div className="m-ic">
            <IconSliders size={16} />
          </div>
          <h2>Settings</h2>
        </div>

        <div className="settings-tabs">
          <button className={tab === "appearance" ? "on" : ""} onClick={() => setTab("appearance")}>Appearance</button>
          <button className={tab === "keys" ? "on" : ""} onClick={() => setTab("keys")}>
            Connections
          </button>
          <button className={tab === "routing" ? "on" : ""} onClick={() => setTab("routing")}>
            Routing
          </button>
          <button className={tab === "about" ? "on" : ""} onClick={() => setTab("about")}>
            About
          </button>
        </div>

        {tab === "appearance" && <>
          <div className="settings-section-head"><strong>Theme</strong><span>Choose how Hyzr Chat looks on this device.</span></div>
          <div className="theme-options">
            {(["light", "dark", "system"] as Theme[]).map((choice) => <button key={choice} className={theme === choice ? "on" : ""} onClick={() => onTheme(choice)}>
              <span className={`theme-preview ${choice}`}><i /><i /><i /></span>
              <strong>{choice[0].toUpperCase() + choice.slice(1)}</strong>
              {theme === choice && <IconCheck size={14} />}
            </button>)}
          </div>
          <div className="row-between">
            <div><div className="rb-label">Product identity</div><div className="rb-desc">Choose from the shared Hyzr product identity.</div></div>
            <button className="btn" onClick={onOpenSymbols}>View identity</button>
          </div>
          <div className="modal-actions"><button className="btn primary" onClick={onClose}>Done</button></div>
        </>}

        {tab === "keys" && (
          <>
            <div className="row-between">
              <div>
                <div className="rb-label">Claude Max (local CLI)</div>
                <div className="rb-desc">Uses the logged-in claude CLI — no key needed.</div>
              </div>
              <span className="pill-status">
                <span className="dot" /> Connected
              </span>
            </div>
            <div className="row-between">
              <div>
                <div className="rb-label">ChatGPT Pro (local CLI)</div>
                <div className="rb-desc">Uses the logged-in codex CLI — no key needed.</div>
              </div>
              <span className="pill-status">
                <span className="dot" /> Connected
              </span>
            </div>
            <p className="hint" style={{ margin: "18px 0 12px" }}>
              API keys are only for <strong>API-keys mode</strong> (pay-per-token). Local mode runs
              off your subscriptions.
            </p>
            <div className="field">
              <label>
                <span className="mono" style={{ background: "#d97757", color: "#1a0d08" }}>
                  A
                </span>
                Anthropic API key
              </label>
              <input
                type="password"
                value={anthropic}
                onChange={(e) => setAnthropic(e.target.value)}
                placeholder="sk-ant-..."
              />
            </div>
            <div className="field">
              <label>
                <span className="mono" style={{ background: "#10a37f", color: "#04140f" }}>
                  O
                </span>
                OpenAI API key
              </label>
              <input
                type="password"
                value={openai}
                onChange={(e) => setOpenai(e.target.value)}
                placeholder="sk-..."
              />
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
              <button className="btn primary" onClick={() => onSave({ anthropic, openai, linear: keys.linear })}>
                Save
              </button>
            </div>
          </>
        )}

        {tab === "routing" && (
          <>
            <div className="row-between">
              <div>
                <div className="rb-label">Plan &amp; split</div>
                <div className="rb-desc">
                  GPT-5.4 Mini identifies the workload, tools, modality, and priorities before choosing specialists.
                </div>
              </div>
              <button className="btn" onClick={onTogglePlan}>
                {planOn ? "On" : "Off"}
              </button>
            </div>
            <div className="routing-matrix">
              {[
                ["Frontend & new builds", "Design judgment, implementation, terminal workflows", "GPT-5.6 Sol"],
                ["Bugs & code review", "Brownfield investigation, root cause, hidden failures", "Fable 5 · Sonnet 5"],
                ["Long or ambiguous work", "Large context, autonomy, delegation, nuanced decisions", "Fable 5"],
                ["Research & computer use", "Deep browsing, tools, screenshots, application control", "GPT-5.6 Sol · Sonnet 5"],
                ["Ideas & conversation", "Natural tone, alternatives, creative exploration", "Fable 5 · Opus 4.8"],
                ["Image & video output", "Specialized generation rather than a text-only model", "GPT Image 2 · Sora 2"],
                ["Fast repetitive work", "Classification, transforms, mechanical edits", "Luna · Haiku · Mini"],
              ].map(([label, desc, models]) => <div className="routing-cap" key={label}>
                <div><strong>{label}</strong><span>{desc}</span></div><em>{models}</em>
              </div>)}
            </div>
            <div className="note">
              <IconShield size={15} />
              <span>
                Difficulty now controls effort only. Model selection is based on measured workload fit, available tools, and the models enabled in your pool.
              </span>
            </div>
          </>
        )}

        {tab === "about" && (
          <>
            <p className="hint">
              <strong>Hyzr Chat</strong> routes each task to the model that does it best and cheapest,
              across your Claude Max and ChatGPT Pro subscriptions. A fast planner classifies the actual workload before choosing a specialist.
            </p>
            <div className="row-between">
              <div className="rb-label">Agent workspace</div>
              <span className="pill-status">~/hyzr-chat-workspaces/&lt;chat&gt;</span>
            </div>
            <div className="row-between">
              <div className="rb-label">Mode</div>
              <span className="pill-status">
                {mode === "local" ? "Local · subscriptions" : "API keys"}
              </span>
            </div>
            <div className="row-between">
              <div className="rb-label">Version</div>
              <span className="pill-status">0.4.0</span>
            </div>
            <div className="modal-actions">
              <button className="btn primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
