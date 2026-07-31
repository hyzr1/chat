// Deterministic task decomposition.
//
// Splits a request into specialist subtasks WITHOUT spending planner-model
// tokens — which both serves the engine's core goal (reduce token usage) and
// makes the whole plan deterministic and unit-testable offline. The LLM planner
// (`planner.analyze`) remains an optional enhancement layer; this is the
// reliable core and fallback.
//
// The split axes are the ones that genuinely warrant a DIFFERENT model:
//   • media generation  — a different modality Claude cannot do (hard provider split)
//   • frontend/design vs backend/implementation — different model strengths
//   • math / data / science — a distinct analytical strength
//   • research / web search — a distinct capability
//   • security / review — a distinct, careful-review strength
// Plus any explicit list/numbered structure the user wrote.

import { classifyCapability, classifyComplexity } from "./local-router";
import type { TaskCapability, Tier } from "./local-models";

export interface RawSubtask {
  title: string;
  capability: TaskCapability;
  tier: Tier;
}

// Execution-order weight (lower runs first): plan/research → analysis → backend
// → frontend → media → review/security → tests/misc.
const CAPABILITY_ORDER: Record<TaskCapability, number> = {
  architecture: 10,
  organization: 12,
  research_search: 20,
  science: 25,
  data_analysis: 26,
  new_code: 40,
  documents: 45,
  frontend_design: 50,
  vision: 55,
  media_generation: 60,
  computer_use: 65,
  code_review: 70,
  cybersecurity: 72,
  debugging: 74,
  long_horizon: 80,
  creative_ideation: 85,
  conversation: 88,
  fast_high_volume: 90,
};

const strip = (prompt: string) => prompt.replace(/^\s*\[Space:[^\]]*\]\s*/i, "").trim();

// Structural segmentation: explicit lines / numbered / bulleted items first,
// then strong clause connectors when a single line still bundles clauses.
function structuralSegments(text: string): string[] {
  const byLine = text
    .split(/\r?\n+/)
    .map((line) => line.replace(/^\s*(?:\d+[.)]|[-*•])\s+/, "").trim())
    .filter(Boolean);
  const lines = byLine.length ? byLine : [text];
  const out: string[] = [];
  for (const line of lines) {
    // Only connector-split a line that is long enough to plausibly bundle work.
    if (line.split(/\s+/).length >= 6) {
      const parts = line
        .split(/\s*(?:,|;|\.|\band\b|\bthen\b|\bplus\b|\balso\b|\bas well as\b|\balong with\b)\s*/i)
        .map((p) => p.trim())
        .filter((p) => p.split(/\s+/).length >= 2);
      if (parts.length >= 2) {
        out.push(...parts);
        continue;
      }
    }
    out.push(line);
  }
  return out;
}

// Specialist detectors: scan the WHOLE prompt for distinct deliverables that a
// different model should own. Each returns a short title when its signal fires.
const SPECIALISTS: Array<{ capability: TaskCapability; test: RegExp; title: string }> = [
  { capability: "media_generation", test: /\b(generate|create|make|design|render|produce)\b[^.]{0,40}\b(image|images|photo|illustration|logo|icon set|artwork|banner|hero image|background image|graphic|video|animation clip)\b|\b(background|hero|cover|splash)\s+(?:image|graphic|art)\b|\b(image|video)\s*(?:generation|gen)\b/i, title: "Generate the image/media assets" },
  { capability: "data_analysis", test: /\b(math|maths|formula|equation|algorithm|prediction|forecast|regression|statistical|statistics|probability|numerical|calculus|optimization problem|data pipeline|analyze the data|dataset)\b/i, title: "Design the analytical/math logic" },
  { capability: "cybersecurity", test: /\b(security audit|pen ?test|penetration test|threat model|vulnerabilit|harden|owasp|auth(?:entication|orization)? flow|secure the)\b/i, title: "Security review / hardening" },
  { capability: "research_search", test: /\b(research|compare (?:products|options|libraries|frameworks)|find sources|cite|latest (?:docs|version|api)|look up|survey the)\b/i, title: "Research and gather sources" },
  { capability: "frontend_design", test: /\b(ui|ux|frontend|front-end|design system|landing page|responsive design|styling|css|tailwind|nice design|polished (?:ui|interface|design)|visual design|dashboard design)\b/i, title: "Build the UI / visual design" },
  { capability: "new_code", test: /\b(api|backend|back-end|endpoint|database|schema|server route|rest|graphql|integration|business logic|data layer)\b/i, title: "Implement the backend/API" },
  { capability: "documents", test: /\b(slide deck|presentation|pitch deck|write the docs|documentation|readme|report|whitepaper|proposal)\b/i, title: "Write the documents/docs" },
];

function detectSpecialists(text: string): RawSubtask[] {
  const out: RawSubtask[] = [];
  for (const spec of SPECIALISTS) {
    if (spec.test.test(text)) {
      out.push({ title: spec.title, capability: spec.capability, tier: classifyComplexity(text) });
    }
  }
  return out;
}

function titleFor(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 80 ? `${t.slice(0, 77)}…` : t || "Complete the request";
}

/**
 * Decompose a prompt into an ordered list of specialist subtasks. Returns a
 * single subtask for simple/atomic requests. Pure and deterministic.
 */
export function decompose(prompt: string): RawSubtask[] {
  const text = strip(prompt);
  if (!text) return [{ title: "Complete the request", capability: "new_code", tier: "standard" }];

  const overallTier = classifyComplexity(text);

  // Trivial requests are, by definition, one small task — never fragment them.
  if (overallTier === "trivial") {
    return [{ title: titleFor(text), capability: classifyCapability(text).capability, tier: "trivial" }];
  }

  const segTasks: RawSubtask[] = structuralSegments(text).map((seg) => ({
    title: titleFor(seg),
    capability: classifyCapability(seg).capability,
    // A segment is never harder than the whole request; keep media/trivial local.
    tier: classifyComplexity(seg) === "trivial" ? "trivial" : overallTier,
  }));

  const specialists = detectSpecialists(text);

  // Merge segments + specialists, deduping by capability. First occurrence keeps
  // its title; a specialist title is preferred when it is more specific.
  const byCapability = new Map<TaskCapability, RawSubtask>();
  const consider = (task: RawSubtask, fromSpecialist: boolean) => {
    const existing = byCapability.get(task.capability);
    if (!existing) {
      byCapability.set(task.capability, task);
      return;
    }
    // Keep the harder tier; prefer a specialist's concise title.
    const tier: Tier = tierRank(task.tier) > tierRank(existing.tier) ? task.tier : existing.tier;
    const title = fromSpecialist && existing.title.length > task.title.length ? task.title : existing.title;
    byCapability.set(task.capability, { ...existing, tier, title });
  };
  segTasks.forEach((t) => consider(t, false));
  specialists.forEach((t) => consider(t, true));

  let tasks = [...byCapability.values()].sort(
    (a, b) => (CAPABILITY_ORDER[a.capability] ?? 50) - (CAPABILITY_ORDER[b.capability] ?? 50),
  );

  // Collapse to a single task when the request is truly atomic.
  if (tasks.length <= 1) {
    return [{ title: titleFor(text), capability: tasks[0]?.capability ?? classifyCapability(text).capability, tier: overallTier }];
  }

  // COHERENCE FIRST. A judged live A/B proved that splitting a tightly-coupled
  // app across models BREAKS it: given "server + polished UI + a formula", one
  // model built the server, another the UI, and they didn't wire together (the
  // server never served the page) — quality 5/10 vs 8/10 for one model doing it
  // all, AND it cost more (3 CLI runs + escalation). So the core app-building
  // capabilities (backend, frontend, logic, debugging, architecture, data) are
  // COUPLED and must run on ONE model as a single cohesive build. We only split
  // off GENUINELY INDEPENDENT deliverables that don't have to integrate line-by-
  // line with the code — today that is media generation (a separate asset file,
  // and a hard provider boundary: Claude cannot generate images/video).
  const INDEPENDENT: ReadonlySet<TaskCapability> = new Set<TaskCapability>(["media_generation"]);
  const independent = tasks.filter((t) => INDEPENDENT.has(t.capability));
  const coupled = tasks.filter((t) => !INDEPENDENT.has(t.capability));

  // Merge every coupled capability into ONE build subtask, led by the most
  // quality-critical aspect (that lead decides which single model builds the
  // whole app), at the hardest tier any part needs.
  const merged: RawSubtask[] = [];
  if (coupled.length) {
    const lead = [...coupled].sort(
      (a, b) => tierRank(b.tier) - tierRank(a.tier) || LEAD_PRIORITY.indexOf(a.capability) - LEAD_PRIORITY.indexOf(b.capability),
    )[0];
    const maxTier = coupled.reduce<Tier>((mx, t) => (tierRank(t.tier) > tierRank(mx) ? t.tier : mx), "trivial");
    // Integrating 3+ distinct substantial concerns into ONE coherent app is
    // genuinely harder than any single concern — a judged run showed a mid model
    // (Opus) taking a multi-concern build then failing verification and escalating
    // to Fable, wasting a whole attempt. Route such builds to the reliable top
    // model up front. (Quality first: the added coherence is worth it.)
    const substantialCoupled = coupled.filter((t) => t.tier !== "trivial");
    const tier: Tier = substantialCoupled.length >= 3 ? "hard" : maxTier;
    merged.push({ title: titleFor(text), capability: lead.capability, tier });
  }

  // Build first, then independent assets (image/media) after it exists.
  const result = [...merged, ...independent].sort(
    (a, b) => (CAPABILITY_ORDER[a.capability] ?? 50) - (CAPABILITY_ORDER[b.capability] ?? 50),
  );
  return result.length ? result : tasks;
}

// Which coupled capability leads a merged build — i.e. picks the single model
// that builds the whole app. Quality-critical, craft-heavy aspects lead so the
// app is built by a model strong at the part that matters most.
const LEAD_PRIORITY: TaskCapability[] = [
  "architecture", "frontend_design", "cybersecurity", "debugging", "science", "data_analysis",
  "long_horizon", "new_code", "computer_use", "code_review", "vision", "research_search",
  "documents", "organization", "creative_ideation", "conversation", "fast_high_volume", "media_generation",
];

function tierRank(tier: Tier): number {
  return tier === "hard" ? 2 : tier === "standard" ? 1 : 0;
}
