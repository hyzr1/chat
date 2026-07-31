// Quality-first routing for the paired agent — a self-contained ESM port of the
// vmx-engine / chat-lib router so the ACTUAL Agent execution uses the same
// coherence-first decomposition and quality-first model selection that the plan
// card previews (not the old hardcoded over-splitting). Keep in sync with
// vmx-engine/src/local-router.ts + local-models.ts + decompose.ts.

// ── Model metadata (subset the agent can drive via the CLIs) ─────────────────
export const MODELS = {
  "gpt-5.6-sol": { engine: "codex", label: "GPT-5.6 Sol", plan: "ChatGPT Pro" },
  "gpt-5.6-terra": { engine: "codex", label: "GPT-5.6 Terra", plan: "ChatGPT Pro" },
  "gpt-5.6-luna": { engine: "codex", label: "GPT-5.6 Luna", plan: "ChatGPT Pro" },
  "gpt-5.5": { engine: "codex", label: "GPT-5.5", plan: "ChatGPT Pro" },
  "gpt-5.4": { engine: "codex", label: "GPT-5.4", plan: "ChatGPT Pro" },
  "gpt-5.4-mini": { engine: "codex", label: "GPT-5.4 Mini", plan: "ChatGPT Pro" },
  "claude-opus": { engine: "claude", label: "Claude Opus 4.8", plan: "Claude Max" },
  "claude-fable": { engine: "claude", label: "Claude Fable 5", plan: "Claude Max" },
  "claude-sonnet": { engine: "claude", label: "Claude Sonnet 5", plan: "Claude Max" },
  "claude-haiku": { engine: "claude", label: "Claude Haiku 4.5", plan: "Claude Max" },
};
const CORE = Object.keys(MODELS);

export const PLAN_USAGE_WEIGHT = {
  "claude-haiku": 0.33, "claude-sonnet": 1.0, "claude-opus": 3.5, "claude-fable": 12.0,
  "gpt-5.4-mini": 0.4, "gpt-5.6-luna": 0.1, "gpt-5.4": 2.5, "gpt-5.6-terra": 1.0, "gpt-5.5": 7.0, "gpt-5.6-sol": 8.0,
};
const usageWeight = (id) => PLAN_USAGE_WEIGHT[id] ?? 1;

const BASE_QUALITY = {
  "claude-fable": 9.6, "claude-opus": 9.2, "claude-sonnet": 8.5, "claude-haiku": 7.0,
  "gpt-5.6-sol": 9.6, "gpt-5.5": 9.0, "gpt-5.6-terra": 8.6, "gpt-5.4": 8.0, "gpt-5.6-luna": 7.4, "gpt-5.4-mini": 6.6,
};

const CAP_ADJ = {
  frontend_design: { "claude-fable": 0.4, "claude-opus": 0.3, "claude-sonnet": 0.2, "gpt-5.6-sol": -0.2, "gpt-5.6-terra": -0.1, "gpt-5.6-luna": -0.5, "claude-haiku": -0.6, "gpt-5.4-mini": -1.8 },
  architecture: { "gpt-5.6-sol": 0.4, "claude-opus": 0.4, "claude-fable": 0.3, "gpt-5.5": 0.3, "claude-sonnet": -0.2, "gpt-5.6-luna": -0.8, "claude-haiku": -1.4, "gpt-5.4-mini": -1.8 },
  debugging: { "claude-fable": 0.4, "claude-sonnet": 0.3, "gpt-5.6-sol": 0.2, "gpt-5.4-mini": -1.2 },
  code_review: { "claude-fable": 0.4, "claude-opus": 0.3, "claude-sonnet": 0.2, "gpt-5.6-sol": 0.1, "gpt-5.4-mini": -1.0 },
  long_horizon: { "claude-fable": 0.4, "gpt-5.6-sol": 0.3, "claude-opus": 0.3, "claude-sonnet": 0.2, "gpt-5.6-luna": -0.5, "gpt-5.4-mini": -2.0 },
  science: { "gpt-5.6-sol": 0.5, "gpt-5.5": 0.4, "gpt-5.4": 0.2, "claude-fable": 0.2, "gpt-5.6-luna": -0.6, "gpt-5.4-mini": -1.5, "claude-haiku": -1.0 },
  data_analysis: { "gpt-5.6-sol": 0.4, "gpt-5.5": 0.4, "gpt-5.4": 0.3, "gpt-5.6-luna": 0.1, "claude-haiku": -0.8, "gpt-5.4-mini": -1.2 },
  cybersecurity: { "gpt-5.6-sol": 0.4, "gpt-5.6-terra": 0.3, "gpt-5.5": 0.3, "claude-fable": -0.3, "claude-opus": -0.3, "claude-sonnet": -0.3, "claude-haiku": -0.5 },
  vision: { "claude-fable": 0.3, "claude-opus": 0.3, "claude-sonnet": 0.2, "gpt-5.6-sol": 0.2, "gpt-5.4-mini": -1.0 },
  creative_ideation: { "claude-fable": 0.4, "claude-opus": 0.4, "claude-sonnet": 0.2, "claude-haiku": 0.1, "gpt-5.4-mini": -1.0 },
  conversation: { "claude-fable": 0.4, "claude-opus": 0.4, "claude-sonnet": 0.2, "claude-haiku": 0.2, "gpt-5.4-mini": -0.6 },
  new_code: { "gpt-5.6-terra": 0.6, "gpt-5.6-luna": 0.8, "claude-sonnet": 0.6, "gpt-5.4": 0.5, "gpt-5.6-sol": -0.2, "claude-fable": -0.3, "claude-opus": -0.2, "gpt-5.4-mini": -0.4 },
  fast_high_volume: { "gpt-5.6-luna": 1.0, "gpt-5.4-mini": 0.9, "claude-haiku": 0.9, "gpt-5.6-terra": 0.3, "gpt-5.6-sol": -0.6, "claude-fable": -0.8, "claude-opus": -0.7 },
  organization: { "gpt-5.4-mini": 0.6, "gpt-5.6-luna": 0.5, "gpt-5.6-terra": 0.4, "claude-haiku": 0.4, "gpt-5.6-sol": -0.4, "claude-fable": -0.4 },
  documents: { "gpt-5.6-terra": 0.3, "gpt-5.6-luna": 0.3, "gpt-5.6-sol": 0.2, "claude-fable": 0.2, "gpt-5.4-mini": -0.8 },
  research_search: { "gpt-5.6-sol": 0.3, "gpt-5.6-terra": 0.3, "gpt-5.6-luna": 0.3, "gpt-5.5": 0.2, "gpt-5.4-mini": -0.6 },
  computer_use: { "gpt-5.6-sol": 0.3, "claude-sonnet": 0.3, "gpt-5.6-terra": 0.2, "gpt-5.4-mini": 0.1, "claude-fable": -0.2 },
  media_generation: { "gpt-5.6-luna": 0.8, "gpt-5.6-terra": 0.8, "gpt-5.6-sol": 0.6, "gpt-5.5": 0.4, "gpt-5.4": 0.2, "gpt-5.4-mini": -1.5 },
};

const SKILL_AFFINITY = {
  cpp: { "gpt-5.6-sol": 0.7, "gpt-5.5": 0.6, "gpt-5.6-terra": 0.3, "claude-fable": 0.2, "claude-sonnet": -0.2, "claude-haiku": -0.6, "gpt-5.4-mini": -0.8 },
  rust: { "gpt-5.6-sol": 0.6, "gpt-5.5": 0.5, "claude-fable": 0.3, "gpt-5.6-terra": 0.2, "claude-haiku": -0.5 },
  go: { "gpt-5.6-sol": 0.4, "gpt-5.6-terra": 0.3, "claude-sonnet": 0.2, "claude-fable": 0.2 },
  python: { "gpt-5.6-sol": 0.4, "claude-fable": 0.3, "gpt-5.5": 0.3, "claude-sonnet": 0.2, "gpt-5.6-terra": 0.2 },
  typescript: { "claude-fable": 0.4, "claude-sonnet": 0.4, "gpt-5.6-sol": 0.2, "gpt-5.6-terra": 0.2, "claude-opus": 0.2 },
  csharp: { "gpt-5.6-sol": 0.4, "gpt-5.5": 0.3, "gpt-5.6-terra": 0.2, "claude-fable": 0.1 },
  java: { "gpt-5.6-sol": 0.4, "gpt-5.5": 0.3, "claude-fable": 0.2, "gpt-5.6-terra": 0.2 },
  sql: { "gpt-5.6-sol": 0.3, "gpt-5.6-terra": 0.2, "gpt-5.4": 0.2, "claude-sonnet": 0.1 },
  css: { "claude-fable": 0.5, "claude-opus": 0.4, "claude-sonnet": 0.3, "gpt-5.6-sol": 0.2, "gpt-5.6-terra": 0.1, "gpt-5.6-luna": -0.2, "gpt-5.4-mini": -0.6 },
  animation: { "claude-fable": 0.4, "gpt-5.6-sol": 0.3, "claude-opus": 0.3, "gpt-5.6-terra": 0.2, "claude-sonnet": 0.2, "gpt-5.4-mini": -0.5 },
  graphics: { "gpt-5.6-sol": 0.5, "gpt-5.5": 0.4, "claude-fable": 0.3, "gpt-5.6-terra": 0.2, "claude-haiku": -0.6 },
  api_backend: { "gpt-5.6-sol": 0.3, "gpt-5.6-terra": 0.3, "gpt-5.6-luna": 0.3, "claude-sonnet": 0.2, "gpt-5.4": 0.2 },
  cli: { "gpt-5.6-luna": 0.5, "gpt-5.4-mini": 0.5, "claude-haiku": 0.4, "gpt-5.6-terra": 0.3, "gpt-5.6-sol": -0.2, "claude-fable": -0.4 },
  image_gen: { "gpt-5.6-luna": 0.7, "gpt-5.6-terra": 0.6, "gpt-5.6-sol": 0.5, "gpt-5.5": 0.4, "gpt-5.4": 0.2 },
  video_gen: { "gpt-5.6-sol": 0.5, "gpt-5.6-terra": 0.5, "gpt-5.6-luna": 0.4, "gpt-5.5": 0.3 },
  regex: { "gpt-5.6-sol": 0.3, "claude-sonnet": 0.3, "gpt-5.6-terra": 0.2, "claude-fable": 0.2 },
  testing_debug: { "claude-fable": 0.5, "claude-sonnet": 0.4, "gpt-5.6-sol": 0.2, "claude-haiku": 0.1, "gpt-5.4-mini": -0.8 },
  data_ml: { "gpt-5.6-sol": 0.5, "gpt-5.5": 0.4, "gpt-5.4": 0.3, "gpt-5.6-luna": 0.1, "gpt-5.4-mini": -0.6 },
  systems_perf: { "gpt-5.6-sol": 0.5, "gpt-5.5": 0.4, "claude-fable": 0.3, "gpt-5.6-terra": 0.2, "gpt-5.4-mini": -1.0 },
};

export const CAPABILITY_LABELS = {
  frontend_design: "Frontend & visual design", new_code: "Implementation", debugging: "Debugging",
  code_review: "Code review", architecture: "Architecture", long_horizon: "Long-running work",
  research_search: "Research & web search", computer_use: "Computer use", vision: "Image understanding",
  media_generation: "Image & video generation", data_analysis: "Data analysis", documents: "Documents & presentations",
  organization: "Planning & organization", conversation: "Conversation & tone", creative_ideation: "Ideas & creative writing",
  cybersecurity: "Cybersecurity", science: "Science & health", fast_high_volume: "Fast, high-volume work",
};

const clamp = (n) => Math.max(0, Math.min(10, n));
function capabilityQuality(id, cap) {
  if (!MODELS[id]) return 0;
  if (cap === "media_generation" && MODELS[id].engine === "claude") return 0;
  return clamp((BASE_QUALITY[id] ?? 6) + ((CAP_ADJ[cap] && CAP_ADJ[cap][id]) ?? 0));
}
function skillQuality(id, cap, skills) {
  if (!MODELS[id]) return 0;
  if (skills?.some((s) => s === "image_gen" || s === "video_gen") && MODELS[id].engine === "claude") return 0;
  const base = capabilityQuality(id, cap);
  if (!skills?.length) return base;
  const deltas = skills.map((s) => (SKILL_AFFINITY[s] && SKILL_AFFINITY[s][id]) ?? 0);
  return clamp(base + deltas.reduce((a, b) => a + b, 0) / deltas.length);
}

// ── Classifiers (mirror local-router.ts) ─────────────────────────────────────
export function classifyComplexity(prompt) {
  const t = prompt.toLowerCase();
  // Operational / DevOps tasks — mechanical, the cheapest model does them; always trivial.
  if (/\b(restart|start|stop|reopen|host|serve|serving|launch|boot|run|running|preview|open|deploy|kill|expose|spin ?up|bring up|fire up)\b.{0,44}\b(server|dev server|process|port|localhost|preview|site|app|page|it|this|the (?:server|site|app|page))\b/.test(t)) return "trivial";
  if (/\b(install|reinstall|add|update|upgrade|bump)\b.{0,28}\b(dependenc(?:y|ies)|deps|packages?|node_modules|npm|yarn|pnpm|requirements)\b|\b(run|execute)\b.{0,24}\b(command|script|it|this|npm|yarn|pnpm|build|tests?|lint|migration|the build)\b/.test(t)) return "trivial";
  if (/\b(restart|start|stop|reopen)\b.{0,40}\b(server|dev server|process)\b|\b(check|verify)\b.{0,45}\b(running|server|port|status)\b|\b(rename|typo|format|quick fact|one[- ]line|single command|hello[ ,_-]*world|basic boilerplate|bare html|no styling)\b|\b(adjust|change|fix|tweak|update|set|increase|decrease|bump)\b.{0,30}\b(padding|margin|color|colour|font[- ]?size|spacing|width|height|border|border[- ]?radius|background|opacity|z[- ]?index|animation timing|duration|delay|easing)\b|\b(run|execute)\b.{0,24}\b(command|script|it|this|npm|build|test)\b|\b(add|insert|remove)\b.{0,20}\b(console\.log|comment|import|log statement)\b|\b(move|rename|delete|copy)\b.{0,20}\b(the |a |this )?(file|folder|function|variable)\b/.test(t)) return "trivial";
  if (/\b(architecture|large codebase|entire project|end[- ]to[- ]end|complex migration|security audit|race condition|distributed|production[- ]grade|autonomous|multi[- ]step)\b/.test(t)) return "hard";
  return "standard";
}

const QUALITY_CUES = /\b(high[- ]?(?:end|quality|fidelity|res(?:olution)?)|hi[- ]?fi|premium|polished|beautiful|stunning|gorgeous|world[- ]?class|production[- ]?grade|professional(?:[- ]?grade)?|pixel[- ]?perfect|top[- ]?(?:tier|quality|notch)|triple[- ]?a|aaa|first[- ]?rate|best (?:possible|in class)|exactly (?:like|the same)|impress|portfolio|award|really (?:important|matters)|mission[- ]?critical|critical|complex|complicated|tricky|intricate|subtle|hard(?:est)? (?:bug|problem)|can'?t (?:figure|solve|crack)|stuck on|thorough(?:ly)?|robust|enterprise|sophisticated|elegant|meticulous)\b/i;
const SIMPLE_CUES = /\b(basic|simple|quick|minimal|rough|prototype|proto|mvp|throwaway|placeholder|draft|boilerplate|scaffold|bare[- ]?bones|barebones|just a|nothing fancy|dead simple|trivial|small tweak|one[- ]?liner|light[- ]?weight|cheap(?:est)?|low[- ]?cost|budget|efficient|save (?:usage|tokens|money|credits|cost)|don'?t (?:waste|burn)|(?:light|small|cheap|fast|efficient|tiny) model)\b/i;
export function classifyQualityDemand(prompt) {
  const t = prompt.toLowerCase();
  let d = 1;
  const q = (t.match(new RegExp(QUALITY_CUES, "gi")) ?? []).length;
  const s = (t.match(new RegExp(SIMPLE_CUES, "gi")) ?? []).length;
  if (q) d *= q >= 2 ? 0.5 : 0.65;
  if (s) d *= s >= 2 ? 1.7 : 1.45;
  return Math.max(0.45, Math.min(1.9, d));
}

const SKILL_TESTS = [
  ["cpp", /\bc\+\+|\bcpp\b|std::|cmake|\bg\+\+\b/i], ["rust", /\brust\b|\bcargo\b|tokio|\bwasm\b/i],
  ["go", /\bgo(?:lang)?\b|goroutine/i], ["csharp", /\bc#|\.net\b|asp\.net|\bunity\b/i],
  ["java", /\bjava\b|spring boot|\bjvm\b|\bkotlin\b/i], ["python", /\bpython\b|django|flask|fastapi|numpy|pandas|pytorch|\.py\b/i],
  ["typescript", /\btypescript\b|\bjavascript\b|\bjs\b|\bts\b|\.[jt]sx?\b|\breact\b|\bvue\b|\bnext\.?js\b|\bnode\b/i],
  ["sql", /\bsql\b|postgres|mysql|sqlite|\bquery\b|\borm\b|prisma/i], ["graphics", /\bwebgl\b|three\.js|\bcanvas\b|\bshader\b|opengl|\b3d\b|game engine/i],
  ["animation", /\banimat|\btransition\b|keyframe|\bgsap\b|framer[- ]?motion|\bparallax\b/i],
  ["css", /\bcss\b|tailwind|flexbox|\bgrid\b|styling|\bpadding\b|\bmargin\b|responsive|\blayout\b/i],
  ["api_backend", /\bapi\b|\brest\b|graphql|\bendpoint\b|\bbackend\b|microservice|\bwebhook\b/i],
  ["cli", /command[- ]?line|\bcli\b|\bterminal\b|powershell|\bbash\b|\bshell\b|run (?:a |the )?(?:command|script)|\bmakefile\b/i],
  ["video_gen", /\bvideo\b.{0,20}\b(gen|generat|create|make)|animation clip/i],
  ["image_gen", /\b(image|logo|icon|illustration|artwork|picture|photo|banner|sprite)s?\b.{0,24}\b(gen|generat|create|make|design|produce)|\b(generate|create|make|produce)\b.{0,24}\b(image|logo|icon|illustration|artwork)/i],
  ["regex", /\bregex|regular expression/i], ["data_ml", /machine learning|\bml model|neural|training data|regression|classifier|\bembedding|\bllm\b/i],
  ["systems_perf", /\bperformance\b|optimize|\blatency\b|\bmemory\b|concurrency|threading|low[- ]level|\bthroughput\b/i],
  ["testing_debug", /unit test|integration test|test suite|\bdebug|fix (?:the |a )?bug|failing test|edge case|\bstack trace\b/i],
];
export function detectSkills(prompt) {
  const t = prompt.toLowerCase();
  return SKILL_TESTS.filter(([, re]) => re.test(t)).map(([s]) => s).slice(0, 4);
}

export function classifyCapability(prompt) {
  const t = prompt.toLowerCase();
  const tests = [
    ["media_generation", /\b(generate|create|make|produce|edit|render|design|draw|animate)\b.{0,72}\b(images?|photos?|illustrations?|videos?|animations?|logos?|icons?|artworks?|graphics?|banners?|sprites?|avatars?|backgrounds?|wallpapers?)\b|\b(images?|videos?|logos?|icons?)\s*(?:generation|gen)\b|\b(icon set|hero image|cover art)\b/],
    ["architecture", /\b(architecture|system design|data model|scalab|distributed|microservice|technical design)\b/],
    ["debugging", /\b(debug|bug|broken|crash|root cause|race condition|doesn['’]?t work|fix this)\b/],
    ["code_review", /\b(code review|review this|security audit|find issues|check for bugs)\b/],
    ["frontend_design", /\b(frontend|web ?site|web ?app|ui|ux|css|responsive|landing page|settings page|interface|design system|animation|webgl|gsap|game|gameplay|arcade|clone of|exactly like)\b/],
    ["cybersecurity", /\b(cyber|vulnerability|exploit|penetration|threat model|malware|security)\b/],
    ["science", /\b(science|biology|chemistry|medical|health|genomic|physics|research paper)\b/],
    ["research_search", /\b(research|search the web|browse|sources|citations|latest|compare products)\b/],
    ["computer_use", /\b(browser automation|computer use|playwright|desktop|spreadsheet app|terminal|powershell|shell command|dev server|restart server|port check)\b/],
    ["vision", /\b(screenshot|analyze this image|read this image|visual inspection|diagram)\b/],
    ["data_analysis", /\b(data analysis|statistical analysis|statistics|regression|forecast|predictive model|financial model|analyze the data)\b/],
    ["documents", /\b(presentation|slide deck|document|report|pdf|proposal|memo)\b/],
    ["creative_ideation", /\b(brainstorm|ideas|creative|story|naming|concepts|copywriting)\b/],
    ["organization", /\b(organize|plan|schedule|roadmap|prioritize|to-?do|workflow)\b/],
    ["long_horizon", /\b(large codebase|entire project|end[- ]to[- ]end|keep going|autonomous|multi[- ]step)\b/],
    ["conversation", /\b(chat|conversation|friendly|empathetic|tone|rewrite|explain)\b/],
    ["fast_high_volume", /\b(rename|typo|format|classify|extract|many files|bulk|quick)\b/],
  ];
  for (const [cap, re] of tests) if (re.test(t)) return cap;
  return "new_code";
}

const LEGACY = new Set(); // agent pool has no legacy ids
function qualityTolerance(tier, bias) {
  const byTier = { hard: 0.25, standard: 0.7, trivial: 3.5 };
  const byBias = { quality: 0.75, balanced: 1.0, cheap: 1.4 };
  return byTier[tier] * byBias[bias];
}
function qualityAwareSelect(pool, cap, tier, { skills, demand = 1, bias = "quality", planLoad } = {}) {
  if (!pool.length) return null;
  const scored = pool.map((id) => ({ id, q: skillQuality(id, cap, skills), w: usageWeight(id) }));
  const qmax = Math.max(...scored.map((s) => s.q));
  const tol = qualityTolerance(tier, bias) * demand;
  const eligible = scored.filter((s) => s.q >= qmax - tol);
  const loadOf = (id) => (planLoad ? (planLoad[MODELS[id].engine] ?? 0) : 0);
  eligible.sort((a, b) => a.w - b.w || (Math.abs(a.q - b.q) > 0.15 ? b.q - a.q : 0) || loadOf(a.id) - loadOf(b.id));
  return eligible[0]?.id ?? pool[0];
}

// ── Coherence-first decomposition (mirror decompose.ts) ──────────────────────
const CAPABILITY_ORDER = { architecture: 10, organization: 12, research_search: 20, science: 25, data_analysis: 26, new_code: 40, documents: 45, frontend_design: 50, vision: 55, media_generation: 60, computer_use: 65, code_review: 70, cybersecurity: 72, debugging: 74, long_horizon: 80, creative_ideation: 85, conversation: 88, fast_high_volume: 90 };
const LEAD_PRIORITY = ["architecture", "frontend_design", "cybersecurity", "debugging", "science", "data_analysis", "long_horizon", "new_code", "computer_use", "code_review", "vision", "research_search", "documents", "organization", "creative_ideation", "conversation", "fast_high_volume", "media_generation"];
const tierRank = (t) => (t === "hard" ? 2 : t === "standard" ? 1 : 0);

export function decompose(prompt) {
  const text = String(prompt || "").replace(/^\s*\[Space:[^\]]*\]\s*/i, "").trim();
  if (!text) return [{ capability: "new_code", tier: "standard" }];
  const overall = classifyComplexity(text);
  if (overall === "trivial") return [{ capability: classifyCapability(text), tier: "trivial" }];

  // Split into clause segments, classify each, dedupe by capability.
  const segments = text.split(/\r?\n+/).flatMap((line) => {
    if (line.split(/\s+/).length >= 6) {
      const parts = line.split(/\s*(?:,|;|\.|\band\b|\bthen\b|\bplus\b|\balso\b|\bas well as\b|\balong with\b)\s*/i).map((p) => p.trim()).filter((p) => p.split(/\s+/).length >= 2);
      if (parts.length >= 2) return parts;
    }
    return [line];
  });
  const byCap = new Map();
  for (const seg of segments) {
    const cap = classifyCapability(seg);
    const tier = classifyComplexity(seg) === "trivial" ? "trivial" : overall;
    const ex = byCap.get(cap);
    byCap.set(cap, ex ? { capability: cap, tier: tierRank(tier) > tierRank(ex.tier) ? tier : ex.tier } : { capability: cap, tier });
  }
  // A media specialist can be implied by the whole prompt even without a clause.
  if (!byCap.has("media_generation") && classifyCapability(text) === "media_generation") byCap.set("media_generation", { capability: "media_generation", tier: overall });

  let tasks = [...byCap.values()];
  if (tasks.length <= 1) return [{ capability: tasks[0]?.capability ?? classifyCapability(text), tier: overall }];

  // COHERENCE: coupled app-building capabilities become ONE build on one model;
  // only genuinely independent deliverables (media) split off.
  const independent = tasks.filter((t) => t.capability === "media_generation");
  const coupled = tasks.filter((t) => t.capability !== "media_generation");
  const merged = [];
  if (coupled.length) {
    const lead = [...coupled].sort((a, b) => tierRank(b.tier) - tierRank(a.tier) || LEAD_PRIORITY.indexOf(a.capability) - LEAD_PRIORITY.indexOf(b.capability))[0];
    const maxTier = coupled.reduce((mx, t) => (tierRank(t.tier) > tierRank(mx) ? t.tier : mx), "trivial");
    const substantial = coupled.filter((t) => t.tier !== "trivial");
    merged.push({ capability: lead.capability, tier: substantial.length >= 3 ? "hard" : maxTier });
  }
  const result = [...merged, ...independent].sort((a, b) => (CAPABILITY_ORDER[a.capability] ?? 50) - (CAPABILITY_ORDER[b.capability] ?? 50));
  return result.length ? result : tasks;
}

// ── LLM ROUTER (primary planner) ─────────────────────────────────────────────
// A cheap model READS the request — its true difficulty, the user's emphasis and
// frustration, explicit cost/quality/provider cues — and picks the best model
// per part. Far more accurate than regex classification. The deterministic
// planForAgent below is the validated fallback when the router is unavailable or
// returns something unusable. QUALITY FIRST: savings are only ever a consequence
// of not over-paying, never a reason to accept a worse result.

const MODEL_BLURB = {
  "gpt-5.6-sol": "ChatGPT frontier — hardest algorithms, systems/C++, architecture, graphics, security, deep search.",
  "gpt-5.6-terra": "Balanced ChatGPT — strong everyday implementation, APIs/backends, good speed and cost.",
  "gpt-5.6-luna": "Cheapest ChatGPT — fast scaffolding, command-line, running/hosting, high-volume, trivial edits.",
  "gpt-5.5": "Complex ChatGPT coding and analytical work.",
  "gpt-5.4": "General ChatGPT coding, tools and documents.",
  "gpt-5.4-mini": "Fastest/cheapest — classification and tiny mechanical tasks.",
  "claude-fable": "Claude frontier — highest-craft UI/visual design, hard brownfield debugging, nuanced long work.",
  "claude-opus": "High-craft Claude — polished design, architecture, careful review, at a fraction of Fable's cost.",
  "claude-sonnet": "Efficient Claude — everyday coding, debugging, TypeScript/JS, automation.",
  "claude-haiku": "Cheapest Claude — fast, mechanical, high-volume work.",
};

// Hyzr Swift tier — the light, token-saving pool Chat runs on (best-first).
export const HYZR_SWIFT = ["gpt-5.6-luna", "claude-haiku", "gpt-5.4-mini"];
// The cheapest Swift model the connected providers can run (no routing).
export function chatModelFor(tools) {
  const usable = HYZR_SWIFT.filter((id) => MODELS[id] && (MODELS[id].engine === "claude" ? tools?.claude : tools?.codex));
  if (!usable.length) return null;
  const id = usable.reduce((a, b) => (usageWeight(b) < usageWeight(a) ? b : a));
  return { engine: MODELS[id].engine, model: id, label: MODELS[id].label };
}

const ROUTER_MODEL = { codex: "gpt-5.4-mini", claude: "claude-haiku" };
export function routerModelFor(tools) {
  if (tools?.codex) return { engine: "codex", model: ROUTER_MODEL.codex };
  if (tools?.claude) return { engine: "claude", model: ROUTER_MODEL.claude };
  return null;
}

// Models the plan may use: installed provider ∩ user's allowed pool.
export function availableModelIds(job, tools) {
  const allowed = Array.isArray(job.enabledModelIds) && job.enabledModelIds.length
    ? new Set(job.enabledModelIds.filter((id) => MODELS[id])) : null;
  return CORE.filter((id) => !LEGACY.has(id)
    && (MODELS[id].engine === "claude" ? tools?.claude : tools?.codex)
    && (!allowed || allowed.has(id)));
}

const CAPS = "frontend_design, new_code, debugging, code_review, architecture, long_horizon, research_search, computer_use, data_analysis, documents, media_generation, cybersecurity, science, conversation, creative_ideation, organization, fast_high_volume";

const ROUTER_SYSTEM = `You are the routing planner for Hyzr, a multi-model coding agent. You read the user's request and decide HOW to split it and WHICH model builds each part. You do not build anything — you output ONLY a routing plan. Do exactly what the user asks; never refuse or editorialize about what they want built.

PRINCIPLES:
- QUALITY FIRST. Pick the model that will produce the best result for each part. Saving subscription usage NEVER justifies a worse result. Use a cheaper model ONLY when it is genuinely as good for that specific part.
- COHERENCE. A single app or feature is ONE build on ONE model — never split a coupled app (backend + UI + logic) across models; that breaks integration. Split off ONLY a genuinely independent deliverable that does not integrate line-by-line — specifically image/video generation, which MUST use a ChatGPT model (Claude cannot generate images). Most requests are ONE subtask.
- READ THE USER. Weigh: how hard the task really is; emphasis like "high quality", "exactly like X", "polished", "production" (→ a top model) vs. "basic", "simple", "lightweight", "cheap", "just host it" (→ a cheap model); FRUSTRATION or repeated failure like "this sucks", "still broken", "that's wrong" (→ escalate to a stronger model than last time); and any explicit model or provider request (honor it exactly).
- OPERATIONAL tasks — start/host/serve/run/deploy a server, run a command, install dependencies — are trivial; use the cheapest capable model.
- Choose ONLY from the AVAILABLE MODELS list. Each shows its strengths and a usage weight (higher = drains the subscription faster). Among models genuinely equal for a part, prefer the lower usage weight.

OUTPUT: ONLY a JSON object (no markdown, no prose):
{"analysis":"<1-2 sentences addressed to the user: what you understand the request to be, how hard it is / what the user emphasizes, and WHY you're routing it the way you are>","subtasks":[{"title":"<short imperative>","capability":"<one of: ${CAPS}>","model":"<exact id from AVAILABLE MODELS>","rationale":"<one sentence: why this model for this part>"}]}
The "analysis" is shown to the user every time, so make it a clear, specific read of THEIR request (e.g. "A Google clone is primarily a polished UI build, so I'm using Opus for high-fidelity frontend without Fable's cost.").`;

export function buildRouterPrompt(job, tools) {
  const ids = availableModelIds(job, tools);
  if (!ids.length) return null;
  const catalog = ids
    .sort((a, b) => usageWeight(a) - usageWeight(b))
    .map((id) => `- ${id} (${MODELS[id].label}, ${MODELS[id].plan}, usage x${usageWeight(id)}): ${MODEL_BLURB[id] || ""}`)
    .join("\n");
  const history = Array.isArray(job.history) ? job.history.slice(-4) : [];
  const context = history.length
    ? history.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${String(m.content || "").slice(0, 400)}`).join("\n")
    : "(none)";
  return `${ROUTER_SYSTEM}\n\nAVAILABLE MODELS:\n${catalog}\n\nRECENT CONVERSATION (for emphasis/frustration/follow-up):\n${context}\n\nUSER REQUEST:\n${String(job.prompt || "")}\n\nReturn ONLY the JSON plan.`;
}

// Parse + HARD guardrails. Returns agent tasks[] or null (⇒ deterministic fallback).
export function parseRouterPlan(answer, job, tools) {
  let obj;
  try {
    const raw = String(answer || "");
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const body = fenced ? fenced[1] : raw;
    const s = body.indexOf("{"), e = body.lastIndexOf("}");
    if (s === -1 || e === -1) return null;
    obj = JSON.parse(body.slice(s, e + 1));
  } catch { return null; }
  if (!obj || !Array.isArray(obj.subtasks) || !obj.subtasks.length) return null;
  const analysis = obj.analysis ? String(obj.analysis).slice(0, 400) : "";

  const ids = new Set(availableModelIds(job, tools));
  const codexIds = [...ids].filter((id) => MODELS[id].engine === "codex");
  const demand = classifyQualityDemand(String(job.prompt || ""));
  const bias = demand <= 0.6 ? "quality" : demand >= 1.6 ? "cheap" : "balanced";

  const tasks = [];
  for (const st of obj.subtasks.slice(0, 4)) {
    const capability = Object.prototype.hasOwnProperty.call(CAPABILITY_LABELS, String(st.capability)) ? String(st.capability) : "new_code";
    let modelId = String(st.model || "");
    // Guardrails: model must be available; image/video MUST be a ChatGPT model;
    // if the router picked something invalid, fall back to the deterministic pick.
    if (capability === "media_generation") {
      if (!ids.has(modelId) || MODELS[modelId]?.engine !== "codex") {
        modelId = codexIds.length ? qualityAwareSelect(codexIds, "media_generation", "standard", { skills: ["image_gen"], demand, bias }) : "";
      }
    } else if (!ids.has(modelId)) {
      modelId = qualityAwareSelect([...ids].filter((id) => MODELS[id].engine !== "codex" || true), capability, "standard", { demand, bias });
    }
    if (!modelId || !MODELS[modelId]) continue;
    const m = MODELS[modelId];
    const isMedia = capability === "media_generation";
    tasks.push({
      label: st.title ? String(st.title).slice(0, 80) : (CAPABILITY_LABELS[capability] || "Implementation"),
      engine: m.engine, model: modelId, modelLabel: m.label, plan: m.plan,
      capability, tier: "standard",
      rationale: st.rationale ? String(st.rationale).slice(0, 200) : `${CAPABILITY_LABELS[capability]} → ${m.label}.`,
      instruction: isMedia
        ? "Generate the requested image/visual asset using an installed image-generation capability, save it in the project, and report its path. Do not substitute a text description."
        : "Implement the complete request in the current workspace. Inspect existing files first, make real file changes, handle edge cases, wire everything together so it runs, and run the narrowest relevant validation. Do not merely describe code.",
    });
  }
  // Coherence guardrail: never let the router fragment coupled code across models.
  // Keep at most ONE non-media build (the first) plus any media task.
  const media = tasks.filter((t) => t.capability === "media_generation");
  const build = tasks.filter((t) => t.capability !== "media_generation").slice(0, 1);
  const final = [...build, ...media].slice(0, 4);
  return final.length ? { tasks: final, analysis } : null;
}

// ── Public: build the agent's plan (coherence + quality-first routing) ───────
// tools: { claude: boolean, codex: boolean }. Returns [] when not a broad build
// (the caller then runs the request as a single default task), else an array of
// { label, engine, model, capability, tier, rationale, instruction }.
export function planForAgent(job, tools) {
  const prompt = String(job.prompt || "");
  if (!job.plan) return [];
  const claude = !!tools?.claude, codex = !!tools?.codex;
  if (!claude && !codex) return [];

  if (!prompt.trim()) return [];
  const demand = classifyQualityDemand(prompt);
  const raw = decompose(prompt);

  // ALWAYS return the routed plan — even a single trivial task runs on the
  // quality-routed model (e.g. a padding tweak → Luna, not a default), and the
  // user always sees which model will handle their request and why. A single
  // node is still a plan; it just isn't multi-model orchestration.

  // The user's allowed-model pool (e.g. Sol/Fable disabled to save usage, or
  // Claude-only). Routing picks the best model WITHIN this set. Empty/absent ⇒
  // all core models.
  const allowed = Array.isArray(job.enabledModelIds) && job.enabledModelIds.length
    ? new Set(job.enabledModelIds.filter((id) => MODELS[id]))
    : null;
  const available = (id) => (MODELS[id].engine === "claude" ? claude : codex) && (!allowed || allowed.has(id));
  const providerPool = (cap) => {
    let pool = CORE.filter((id) => !LEGACY.has(id) && available(id));
    if (cap === "media_generation") pool = pool.filter((id) => MODELS[id].engine === "codex");
    else if (claude && !codex) pool = pool.filter((id) => MODELS[id].engine === "claude");
    else if (codex && !claude) pool = pool.filter((id) => MODELS[id].engine === "codex");
    return pool;
  };

  const bias = demand <= 0.6 ? "quality" : demand >= 1.6 ? "cheap" : "balanced";
  const allSkills = detectSkills(prompt);
  const tasks = raw.map((part) => {
    const pool = providerPool(part.capability);
    if (!pool.length) return null;
    // Media-generation skills belong ONLY to the media subtask — they must not
    // zero out Claude for the coupled build (which isn't image work).
    const skills = part.capability === "media_generation" ? allSkills : allSkills.filter((s) => s !== "image_gen" && s !== "video_gen");
    const modelId = qualityAwareSelect(pool, part.capability, part.tier, { skills, demand, bias, planLoad: job.planLoad });
    const model = MODELS[modelId];
    const isMedia = part.capability === "media_generation";
    return {
      label: CAPABILITY_LABELS[part.capability] || "Implementation",
      engine: model.engine,
      model: modelId,
      modelLabel: model.label,
      plan: model.plan,
      capability: part.capability,
      tier: part.tier,
      rationale: `${CAPABILITY_LABELS[part.capability]} · ${part.tier} → ${model.label} (best quality at lowest subscription usage).`,
      instruction: isMedia
        ? "Generate the requested image/visual asset using an installed image-generation capability, save it in the project, and report its path. Do not substitute a text description."
        : "Implement the complete request in the current workspace. Inspect existing files first, make real file changes, handle edge cases, wire everything together so it runs, and run the narrowest relevant validation. Do not merely describe code.",
    };
  }).filter(Boolean);

  // A single coherent build is still worth showing as a 1-node plan when the
  // request is substantial (so the user sees the routed model + rationale).
  return tasks.length ? tasks : [];
}
