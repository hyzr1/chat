"use client";

import { useEffect, useRef, useState } from "react";
import {
  IconSearch,
  IconGithub,
  IconEye,
  IconPuzzle,
  IconWorkflow,
  IconBrain,
  IconPlug,
  IconPalette,
  IconImage,
  IconCode,
  IconSparkles,
  IconRoute,
  IconGauge,
  IconBook,
  IconPackage,
  IconPlus,
  IconTrash,
  IconCheck,
  IconArrowRight,
  IconFile,
  IconLayers,
  IconBolt,
  IconStar,
} from "../icons";
import { HyzrChatLogo } from "../hyzr-logo";

export type View =
  | "chat"
  | "spaces"
  | "artifacts"
  | "connectors"
  | "skills"
  | "workflows"
  | "memory"
  | "customize"
  | "tasks"
  | "proof"
  | "github";

export function PageHead({
  title,
  sub,
  right,
}: {
  title: string;
  sub: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <h1 className="page-title">{title}</h1>
        <p className="page-sub">{sub}</p>
      </div>
      {right}
    </div>
  );
}

function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="search-box">
      <IconSearch size={15} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function PanelSelect({ value, options, onChange }: { value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const selected = options.find((option) => option.value === value);
  return <div className="panel-select" ref={root}><button onClick={() => setOpen((current) => !current)}><span>{selected?.label ?? "Select"}</span><IconArrowRight size={12} /></button>{open && <div>{options.map((option) => <button key={option.value} className={option.value === value ? "on" : ""} onClick={() => { onChange(option.value); setOpen(false); }}>{option.label}{option.value === value && <IconCheck size={12} />}</button>)}</div>}</div>;
}

/* ---------------- Library tab bar (Connectors / Skills / Workflows / Memory) ---------------- */
const LIB: { id: View; label: string; icon: React.ReactNode }[] = [
  { id: "connectors", label: "Connectors", icon: <IconPlug size={15} /> },
  { id: "skills", label: "Skills", icon: <IconPuzzle size={15} /> },
  { id: "workflows", label: "Workflows", icon: <IconWorkflow size={15} /> },
];
export function LibraryTabs({ view, setView }: { view: View; setView: (v: View) => void }) {
  return (
    <div className="lib-tabs">
      {LIB.map((t) => (
        <button
          key={t.id}
          className={`lib-tab ${view === t.id ? "on" : ""}`}
          onClick={() => setView(t.id)}
        >
          {t.icon} {t.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Workflows ---------------- */
interface WF {
  title: string;
  desc: string;
  cat: string;
  icon: React.ReactNode;
  prompt: string;
}
const WORKFLOWS: WF[] = [
  {
    title: "Build a web app",
    desc: "Scaffold and build a working web app in your workspace, live-previewed.",
    cat: "Coding",
    icon: <IconCode size={18} />,
    prompt:
      "Build a complete, single-file index.html web app for the following idea. Make it polished and responsive, save it to index.html, and confirm when done:\n\n",
  },
  {
    title: "Landing page",
    desc: "Design a modern marketing landing page with hero, features, and CTA.",
    cat: "Coding",
    icon: <IconLayers size={18} />,
    prompt:
      "Build a sleek, modern landing page as a single index.html (inline CSS) for this product. Include a hero, 3 feature cards, and a call-to-action. Save it and preview:\n\n",
  },
  {
    title: "Debug my code",
    desc: "Paste code and an error; get a root-cause fix with an explanation.",
    cat: "Coding",
    icon: <IconBolt size={18} />,
    prompt: "Find and fix the bug in this code. Explain the root cause, then give the corrected code:\n\n",
  },
  {
    title: "Code review",
    desc: "Get a thorough review for correctness, security, and simplification.",
    cat: "Coding",
    icon: <IconCheck size={18} />,
    prompt:
      "Review this code for correctness bugs, security issues, and simplifications. List findings by severity, then show the fixed version:\n\n",
  },
  {
    title: "Refactor",
    desc: "Restructure code for readability and maintainability without changing behavior.",
    cat: "Coding",
    icon: <IconRoute size={18} />,
    prompt: "Refactor this code for readability and maintainability without changing behavior. Explain each change:\n\n",
  },
  {
    title: "Generate an image",
    desc: "Create an image with the imagegen skill (GPT Image).",
    cat: "Media",
    icon: <IconImage size={18} />,
    prompt: "Use the imagegen skill to generate an image: ",
  },
  {
    title: "Research a topic",
    desc: "A deep, structured research brief with sources and takeaways.",
    cat: "Research",
    icon: <IconBook size={18} />,
    prompt:
      "Research the following topic thoroughly. Give a structured brief: overview, key points, trade-offs, and takeaways:\n\n",
  },
  {
    title: "Explain a codebase file",
    desc: "Attach a file from GitHub and get a clear walkthrough.",
    cat: "Research",
    icon: <IconFile size={18} />,
    prompt: "Explain what this file does, section by section, and how it fits into a larger app:\n\n",
  },
  {
    title: "Write an API endpoint",
    desc: "Generate a production-ready endpoint with validation and errors.",
    cat: "Coding",
    icon: <IconPackage size={18} />,
    prompt:
      "Write a production-ready REST endpoint for this requirement, with input validation, error handling, and types:\n\n",
  },
  {
    title: "Data analysis",
    desc: "Paste data or a question; get analysis and a chart plan.",
    cat: "Business",
    icon: <IconGauge size={18} />,
    prompt: "Analyze this data and summarize the key insights, with a suggested chart for each:\n\n",
  },
  {
    title: "Write documentation",
    desc: "Turn code or notes into clear, well-structured docs.",
    cat: "Business",
    icon: <IconBook size={18} />,
    prompt: "Write clear Markdown documentation for the following. Include usage examples:\n\n",
  },
  {
    title: "SQL query",
    desc: "Describe what you need; get a correct, explained query.",
    cat: "Coding",
    icon: <IconCode size={18} />,
    prompt: "Write a SQL query for this request and explain how it works:\n\n",
  },
];

export function WorkflowsPanel({ onRun }: { onRun: (p: string) => void }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const cats = ["All", ...Array.from(new Set(WORKFLOWS.map((w) => w.cat)))];
  const list = WORKFLOWS.filter(
    (w) =>
      (cat === "All" || w.cat === cat) &&
      (w.title + w.desc).toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <div className="panel-view">
      <div className="panel-inner wide">
        <PageHead
          title="Workflows"
          sub="Guided flows that turn complex tasks into simple steps."
          right={<SearchBox value={q} onChange={setQ} placeholder="Search workflows" />}
        />
        <div className="chip-row">
          {cats.map((c) => (
            <button key={c} className={`filter-chip ${cat === c ? "on" : ""}`} onClick={() => setCat(c)}>
              {c}
            </button>
          ))}
        </div>
        <div className="card-grid">
          {list.map((w) => (
            <button key={w.title} className="feat-card workflow-card" data-category={w.cat.toLowerCase()} onClick={() => onRun(w.prompt)}>
              <div className="workflow-card-top"><div className="fc-icon">{w.icon}</div><span>{w.cat}</span></div>
              <div className="fc-title">{w.title}</div>
              <div className="fc-desc">{w.desc}</div>
              <div className="fc-run">
                Use workflow <IconArrowRight size={13} />
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Skills (progressively loaded Codex + Claude skills) ---------------- */
interface Skill {
  name: string;
  description: string;
  system: boolean;
  source: "codex" | "claude";
}
export function SkillsPanel({ onUse }: { onUse: (p: string) => void }) {
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "mine" | "system">("all");
  useEffect(() => {
    fetch("/api/skills")
      .then((r) => r.json())
      .then((d) => setSkills(d.skills || []))
      .catch(() => setSkills([]));
  }, []);
  const list = (skills || []).filter(
    (s) =>
      (filter === "all" || (filter === "system" ? s.system : !s.system)) &&
      (s.name + s.description).toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <div className="panel-view">
      <div className="panel-inner wide">
        <PageHead
          title="Skills"
          sub="Installed Codex and Claude procedures. Hyzr Chat loads only matching instructions, keeping unrelated skill text out of model context."
          right={<SearchBox value={q} onChange={setQ} placeholder="Search skills" />}
        />
        <div className="chip-row">
          {(["all", "mine", "system"] as const).map((f) => (
            <button key={f} className={`filter-chip ${filter === f ? "on" : ""}`} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f === "mine" ? "My skills" : "System"}
            </button>
          ))}
        </div>
        {skills === null ? (
          <div className="loading-line">
            <span className="spinner" /> Loading skills…
          </div>
        ) : list.length === 0 ? (
          <div className="empty-hint">No skills found. Add skills under ~/.codex/skills or ~/.claude/skills.</div>
        ) : (
          <div className="card-grid two">
            {list.map((s) => (
              <div key={s.name} className="feat-card wide-card">
                <div className="fc-row">
                  <div className="fc-icon sm">
                    <IconPuzzle size={16} />
                  </div>
                  <div className="fc-title">{s.name}</div>
                  <span className="tag">{s.source}</span>
                  {s.system && <span className="tag">system</span>}
                </div>
                <div className="fc-desc clamp">{s.description || "No description."}</div>
                <button className="fc-run btn-link" onClick={() => onUse(`Use the ${s.name} skill to `)}>
                  Use in chat <IconArrowRight size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Spaces (= GitHub repo + instructions) ---------------- */
export interface Space {
  id: string;
  name: string;
  repo?: string;
  instructions: string;
  createdAt?: number;
  updatedAt?: number;
}
const SPACES_KEY = "hyzr.chat.spaces";
const ACTIVE_SPACE_KEY = "hyzr.chat.activeSpace";
const LEGACY_SPACES_KEY = "vmx.spaces";
const LEGACY_ACTIVE_SPACE_KEY = "vmx.activeSpace";

export function loadSpaces(): Space[] {
  try {
    return JSON.parse(localStorage.getItem(SPACES_KEY) || localStorage.getItem(LEGACY_SPACES_KEY) || "[]");
  } catch {
    return [];
  }
}
export function getActiveSpace(): Space | null {
  try {
    const id = localStorage.getItem(ACTIVE_SPACE_KEY) || localStorage.getItem(LEGACY_ACTIVE_SPACE_KEY);
    return loadSpaces().find((s) => s.id === id) || null;
  } catch {
    return null;
  }
}

function mirrorProjectState(projects: Space[], activeProjectId: string | null) {
  localStorage.setItem(SPACES_KEY, JSON.stringify(projects));
  if (activeProjectId) localStorage.setItem(ACTIVE_SPACE_KEY, activeProjectId);
  else localStorage.removeItem(ACTIVE_SPACE_KEY);
}

export async function syncSpacesFromServer(): Promise<Space[]> {
  let response = await fetch("/api/projects", { cache: "no-store" });
  if (!response.ok) throw new Error("Could not synchronize projects");
  let payload = await response.json();
  const legacy = loadSpaces();
  if (!payload.projects?.length && legacy.length) {
    for (const project of legacy) await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(project) });
    const active = localStorage.getItem(ACTIVE_SPACE_KEY) || localStorage.getItem(LEGACY_ACTIVE_SPACE_KEY);
    if (active) await fetch("/api/projects", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activeProjectId: active }) });
    response = await fetch("/api/projects", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not migrate projects");
    payload = await response.json();
  }
  const projects = Array.isArray(payload.projects) ? payload.projects : [];
  mirrorProjectState(projects, payload.activeProjectId || null);
  return projects;
}

export function SpacesPanel({ onChanged }: { onChanged?: () => void }) {
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [repos, setRepos] = useState<{ nameWithOwner: string }[]>([]);
  const [form, setForm] = useState({ name: "", repo: "", instructions: "" });

  useEffect(() => {
    const local = loadSpaces();
    setSpaces(local);
    setActiveId(localStorage.getItem(ACTIVE_SPACE_KEY) || localStorage.getItem(LEGACY_ACTIVE_SPACE_KEY));
    void syncSpacesFromServer().then((next) => { setSpaces(next); setActiveId(localStorage.getItem(ACTIVE_SPACE_KEY) || localStorage.getItem(LEGACY_ACTIVE_SPACE_KEY)); }).catch(() => undefined);
    fetch("/api/github?action=repos")
      .then((r) => r.json())
      .then((d) => setRepos(d.repos || []))
      .catch(() => {});
  }, []);

  function persist(next: Space[], active = activeId) {
    setSpaces(next);
    mirrorProjectState(next, active);
    onChanged?.();
  }
  async function activate(id: string) {
    const nid = activeId === id ? null : id;
    setActiveId(nid);
    mirrorProjectState(spaces, nid);
    await fetch("/api/projects", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activeProjectId: nid }) }).catch(() => undefined);
    onChanged?.();
  }
  async function create() {
    if (!form.name.trim()) return;
    const now = Date.now();
    const s: Space = {
      id: Math.random().toString(36).slice(2),
      name: form.name.trim(),
      repo: form.repo || undefined,
      instructions: form.instructions.trim(),
      createdAt: now,
      updatedAt: now,
    };
    persist([s, ...spaces]);
    await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) }).catch(() => undefined);
    setForm({ name: "", repo: "", instructions: "" });
    setCreating(false);
  }

  return (
    <div className="panel-view">
      <div className="panel-inner wide">
        <PageHead
          title="Projects"
          sub="Persistent workspaces that group related chats, repositories, and project instructions."
          right={
            <button className="btn primary" onClick={() => setCreating((c) => !c)}>
              <IconPlus size={15} /> New project
            </button>
          }
        />

        {creating && (
          <div className="create-card">
            <div className="field">
              <label>Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Marketing site"
              />
            </div>
            <div className="field">
              <label>GitHub repo (optional)</label>
              <PanelSelect value={form.repo} onChange={(repo) => setForm({ ...form, repo })} options={[{ value: "", label: "None" }, ...repos.map((repo) => ({ value: repo.nameWithOwner, label: repo.nameWithOwner }))]} />
            </div>
            <div className="field">
              <label>Custom instructions</label>
              <textarea
                value={form.instructions}
                onChange={(e) => setForm({ ...form, instructions: e.target.value })}
                placeholder="Applied to every chat in this project — stack, conventions, goals…"
                rows={3}
              />
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setCreating(false)}>
                Cancel
              </button>
              <button className="btn primary" onClick={create}>
                Create project
              </button>
            </div>
          </div>
        )}

        {spaces.length === 0 && !creating ? (
          <div className="empty-hint">No projects yet. Create one to group chats, repository context, and instructions.</div>
        ) : (
          <div className="card-grid two">
            {spaces.map((s) => (
              <div key={s.id} className={`feat-card wide-card ${s.id === activeId ? "sel" : ""}`}>
                <div className="fc-row">
                  <div className="fc-icon sm">
                    <IconLayers size={16} />
                  </div>
                  <div className="fc-title">{s.name}</div>
                  {s.id === activeId && <span className="tag on">active</span>}
                  <button
                    className="icon-x"
                    onClick={() => { const next = spaces.filter((x) => x.id !== s.id); persist(next, activeId === s.id ? null : activeId); void fetch(`/api/projects?id=${encodeURIComponent(s.id)}`, { method: "DELETE" }); }}
                    title="Delete"
                  >
                    <IconTrash size={14} />
                  </button>
                </div>
                {s.repo && (
                  <div className="fc-meta">
                    <IconGithub size={13} /> {s.repo}
                  </div>
                )}
                {s.instructions && <div className="fc-desc clamp">{s.instructions}</div>}
                <button className="fc-run btn-link" onClick={() => activate(s.id)}>
                  {s.id === activeId ? "Deactivate" : "Set active"} <IconArrowRight size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Artifacts (workspace gallery) ---------------- */
interface WFile {
  name: string;
  path: string;
  type: string;
  size: number;
}
export function ArtifactsPanel({ onOpen, sessionId }: { onOpen: (entry: string) => void; sessionId: string | null }) {
  const [files, setFiles] = useState<WFile[] | null>(null);
  const [entry, setEntry] = useState<string | null>(null);
  useEffect(() => {
    if (!sessionId) { setFiles([]); setEntry(null); return; }
    fetch(`/api/workspace?session=${encodeURIComponent(sessionId)}`)
      .then((r) => r.json())
      .then((d) => {
        setFiles(d.files || []);
        setEntry(d.entry || null);
      })
      .catch(() => setFiles([]));
  }, [sessionId]);
  const apps = entry ? (files || []).filter((f) => f.path === entry) : [];
  const others = (files || []).filter((f) => f.type === "file" && !/\.html?$/i.test(f.name));
  return (
    <div className="panel-view">
      <div className="panel-inner wide">
        <PageHead
          title="Artifacts"
          sub="Everything Hyzr Chat has built in your workspace — open any app in the live preview."
        />
        {files === null ? (
          <div className="loading-line">
            <span className="spinner" /> Loading workspace…
          </div>
        ) : (files.length === 0 ? (
          <div className="empty-hint">{sessionId ? "No artifacts yet. Ask Hyzr Chat to build something." : "Open a chat to see that project’s artifacts."}</div>
        ) : (
          <>
            {apps.length > 0 && (
              <>
                <div className="section-label">Apps</div>
                <div className="card-grid">
                  {apps.map((f) => (
                    <button key={f.path} className="feat-card artifact" onClick={() => onOpen(f.path)}>
                      <div className="artifact-thumb">
                        <iframe src={`/preview/_s/${encodeURIComponent(sessionId ?? "")}/${f.path}`} title={`${f.name} preview`} tabIndex={-1} />
                        <span><IconEye size={14} /> Live preview</span>
                      </div>
                      <div className="fc-title">{f.name}</div>
                      <div className="fc-meta">{f.path}</div>
                    </button>
                  ))}
                </div>
              </>
            )}
            {others.length > 0 && (
              <>
                <div className="section-label">Files</div>
                <div className="card-grid two">
                  {others.map((f) => (
                    <div key={f.path} className="feat-card wide-card">
                      <div className="fc-row">
                        <div className="fc-icon sm">
                          <IconFile size={16} />
                        </div>
                        <div className="fc-title">{f.name}</div>
                        <span className="fc-meta">{(f.size / 1024).toFixed(1)} KB</span>
                      </div>
                      <div className="fc-meta">{f.path}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Connectors ---------------- */
interface ConnectorDef { name: string; logo?: string; darkLogo?: boolean; builtinIcon?: "workspace" | "server"; desc: string; status: "available" | "built-in" | "planned"; }
const CONNECTORS: ConnectorDef[] = [
  { name: "GitHub", logo: "https://cdn.simpleicons.org/github/ffffff", darkLogo: true, desc: "Browse repositories and bring source into a project.", status: "available" },
  { name: "Local workspace", builtinIcon: "workspace", desc: "Persistent, isolated files scoped to every chat.", status: "built-in" },
  { name: "Project server", builtinIcon: "server", desc: "A dedicated localhost server for every built project.", status: "built-in" },
  { name: "Gmail + Calendar", logo: "https://cdn.simpleicons.org/gmail/EA4335", desc: "Email and calendar tools are on the integration roadmap.", status: "planned" },
  { name: "Slack", logo: "https://a.slack-edge.com/80588/marketing/img/meta/slack_hash_256.png", desc: "Workspace messaging is on the integration roadmap.", status: "planned" },
  { name: "Vercel", logo: "https://cdn.simpleicons.org/vercel/ffffff", darkLogo: true, desc: "Deployment management is on the integration roadmap.", status: "planned" },
  { name: "Supabase", logo: "https://cdn.simpleicons.org/supabase/3FCF8E", desc: "Database actions are on the integration roadmap.", status: "planned" },
  { name: "Notion", logo: "https://cdn.simpleicons.org/notion/ffffff", darkLogo: true, desc: "Page and database tools are on the integration roadmap.", status: "planned" },
  { name: "Linear", logo: "https://cdn.simpleicons.org/linear/5E6AD2", desc: "Issue tracking is on the integration roadmap.", status: "planned" },
];
export function ConnectorsPanel({ onToast }: { onToast: (m: string) => void }) {
  const [q, setQ] = useState("");
  const [ghUser, setGhUser] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/github?action=status")
      .then((r) => r.json())
      .then((d) => d.connected && setGhUser(d.login))
      .catch(() => {});
  }, []);
  const list = CONNECTORS.filter((c) => (c.name + c.desc).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="panel-view">
      <div className="panel-inner wide">
        <PageHead
          title="Connectors"
          sub="Connect services so Hyzr Chat can read and act on your data."
          right={<SearchBox value={q} onChange={setQ} placeholder="Search connectors" />}
        />
        <div className="connector-grid">
          {list.map((c) => {
            const connected = c.name === "GitHub" && Boolean(ghUser);
            const builtIn = c.status === "built-in";
            const planned = c.status === "planned";
            return (
              <div key={c.name} className={`connector-card ${planned ? "planned" : "ready"}`}>
                <div className="connector-head">
                  <div className={`connector-logo ${c.darkLogo ? "dark-logo" : ""}`}>
                    {c.logo ? <img src={c.logo} alt="" /> : c.builtinIcon === "workspace" ? <IconCode size={19} /> : <IconBolt size={19} />}
                  </div>
                  <div className="fc-title">{c.name}</div>
                  {(connected || builtIn || planned) && (
                    <span className="tag on">
                      {(connected || builtIn) && <IconCheck size={11} />} {connected ? ghUser : builtIn ? "Built in" : "Planned"}
                    </span>
                  )}
                </div>
                <div className="fc-desc clamp">{c.desc}</div>
                <button className="connector-action"
                  disabled={planned || builtIn}
                  onClick={() => connected ? onToast("GitHub already connected") : onToast("Open GitHub to finish connecting your account")}
                >
                  {connected ? "Connected" : builtIn ? "Available" : planned ? "Planned" : "Connect"} {!planned && !builtIn && <IconArrowRight size={13} />}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Memory ---------------- */
interface Mem {
  id: string;
  cat: string;
  text: string;
}
const MEM_KEY = "hyzr.chat.memory";
const LEGACY_MEM_KEY = "vmx.memory";
const MEM_CATS = ["Concepts", "Entities", "Workstreams", "Notes"];
export function MemoryPanel() {
  const [mems, setMems] = useState<Mem[]>([]);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [text, setText] = useState("");
  const [addCat, setAddCat] = useState("Notes");
  useEffect(() => {
    try {
      setMems(JSON.parse(localStorage.getItem(MEM_KEY) || localStorage.getItem(LEGACY_MEM_KEY) || "[]"));
    } catch {}
  }, []);
  function persist(next: Mem[]) {
    setMems(next);
    localStorage.setItem(MEM_KEY, JSON.stringify(next));
  }
  function add() {
    if (!text.trim()) return;
    persist([{ id: Math.random().toString(36).slice(2), cat: addCat, text: text.trim() }, ...mems]);
    setText("");
  }
  const list = mems.filter(
    (m) => (cat === "All" || m.cat === cat) && m.text.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <div className="panel-view">
      <div className="panel-inner wide">
        <PageHead
          title="Memory"
          sub="What Hyzr Chat remembers about you and your work — used to personalize every task."
          right={<SearchBox value={q} onChange={setQ} placeholder="Search memory" />}
        />
        <div className="add-mem">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add something Hyzr Chat should remember…" onKeyDown={(e)=>{if(e.key==='Enter')add();}} />
          <PanelSelect value={addCat} onChange={setAddCat} options={MEM_CATS.map((category) => ({ value: category, label: category }))} />
          <button className="btn primary" onClick={add}>
            <IconPlus size={15} /> Add
          </button>
        </div>
        <div className="chip-row">
          {["All", ...MEM_CATS].map((c) => (
            <button key={c} className={`filter-chip ${cat === c ? "on" : ""}`} onClick={() => setCat(c)}>
              {c}
            </button>
          ))}
        </div>
        {list.length === 0 ? (
          <div className="empty-hint">No memories yet.</div>
        ) : (
          <div className="mem-list">
            {list.map((m) => (
              <div key={m.id} className="mem-item">
                <span className="mem-cat">{m.cat}</span>
                <span className="mem-text">{m.text}</span>
                <button className="icon-x" onClick={() => persist(mems.filter((x) => x.id !== m.id))}>
                  <IconTrash size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Customize ---------------- */
export function CustomizePanel() {
  return (
    <div className="panel-view">
      <div className="panel-inner wide">
        <PageHead title="Customize" sub="Tune Hyzr Chat for the way you work." />
        <div className="card-grid two">
          <div className="feat-card wide-card">
            <div className="fc-row">
              <div className="fc-icon sm">
                <IconPalette size={16} />
              </div>
              <div className="fc-title">Appearance</div>
            </div>
            <div className="fc-desc">Choose your theme and conversation density in Settings → Appearance.</div>
          </div>
          <div className="feat-card wide-card">
            <div className="fc-row">
              <div className="fc-icon sm">
                <IconRoute size={16} />
              </div>
              <div className="fc-title">Routing</div>
            </div>
            <div className="fc-desc">Review capability-based model selection in Settings → Routing.</div>
          </div>
        </div>
        <section className="logo-lab brand-system-card">
          <div className="logo-lab-head">
            <div>
              <h2>Part of the Hyzr family</h2>
              <p>Every Hyzr product shares one clear identity. The product name changes; the family mark stays familiar.</p>
            </div>
            <HyzrChatLogo size={38} />
          </div>
          <div className="brand-principles">
            <span>Hyzr</span>
            <span>Chat</span>
            <span>Local-first</span>
            <span>Multi-model</span>
          </div>
        </section>
      </div>
    </div>
  );
}
