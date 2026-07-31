const __hyzrRouting = (() => {
// Quality-first routing for the paired agent — a self-contained ESM port of the
// vmx-engine / chat-lib router so the ACTUAL Agent execution uses the same
// coherence-first decomposition and quality-first model selection that the plan
// card previews (not the old hardcoded over-splitting). Keep in sync with
// vmx-engine/src/local-router.ts + local-models.ts + decompose.ts.

// ── Model metadata (subset the agent can drive via the CLIs) ─────────────────
const MODELS = {
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

const PLAN_USAGE_WEIGHT = {
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

const CAPABILITY_LABELS = {
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
function classifyComplexity(prompt) {
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
function classifyQualityDemand(prompt) {
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
function detectSkills(prompt) {
  const t = prompt.toLowerCase();
  return SKILL_TESTS.filter(([, re]) => re.test(t)).map(([s]) => s).slice(0, 4);
}

function classifyCapability(prompt) {
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

function decompose(prompt) {
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

const ROUTER_MODEL = { codex: "gpt-5.4-mini", claude: "claude-haiku" };
function routerModelFor(tools) {
  if (tools?.codex) return { engine: "codex", model: ROUTER_MODEL.codex };
  if (tools?.claude) return { engine: "claude", model: ROUTER_MODEL.claude };
  return null;
}

// Models the plan may use: installed provider ∩ user's allowed pool.
function availableModelIds(job, tools) {
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
{"subtasks":[{"title":"<short imperative>","capability":"<one of: ${CAPS}>","model":"<exact id from AVAILABLE MODELS>","rationale":"<one sentence: why this model for this part>"}]}`;

function buildRouterPrompt(job, tools) {
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
function parseRouterPlan(answer, job, tools) {
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
  const final = [...build, ...media];
  return final.length ? final.slice(0, 4) : null;
}

// ── Public: build the agent's plan (coherence + quality-first routing) ───────
// tools: { claude: boolean, codex: boolean }. Returns [] when not a broad build
// (the caller then runs the request as a single default task), else an array of
// { label, engine, model, capability, tier, rationale, instruction }.
function planForAgent(job, tools) {
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

return { planForAgent, routerModelFor, buildRouterPrompt, parseRouterPlan, availableModelIds };
})();
import { execFile, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFile, mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { promisify } from "node:util";
const { planForAgent, routerModelFor, buildRouterPrompt, parseRouterPlan } = __hyzrRouting;

const execFileAsync = promisify(execFile);
const PROTOCOL = 3;
const VERSION = "1.2.3";
const IS_WIN = process.platform === "win32";
const DEFAULT_ROOT = path.join(os.homedir(), "Hyzr");
const STATE_ROOT = path.join(os.homedir(), ".hyzr", "agent");
const CONFIG_FILE = path.join(STATE_ROOT, "config.json");
const CONFIG_BACKUP_FILE = path.join(STATE_ROOT, "config.backup.json");
const LOCK_FILE = path.join(STATE_ROOT, "runtime.lock");
const SESSIONS_FILE = path.join(STATE_ROOT, "sessions.json");
const IGNORE = new Set(["node_modules", ".git", ".next", ".cache"]);
const previewServers = new Map();
const workspacePreferredPorts = new Map();
const PREVIEW_IDLE_MS = 30 * 60 * 1000;

const log = (...values) => console.log("[hyzr]", ...values);
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const cleanId = (value) => String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);

function previewListenerPidsFromNetstat(output, port) {
  const suffix = `:${Number(port)}`;
  return String(output || "").split(/\r?\n/).flatMap((line) => {
      const columns = line.trim().split(/\s+/);
      if (columns[0]?.toUpperCase() !== "TCP" || !columns[1]?.endsWith(suffix) || columns[3]?.toUpperCase() !== "LISTENING") return [];
      const pid = Number(columns[4]);
      return Number.isInteger(pid) && pid > 0 ? [pid] : [];
  });
}

function windowsPreviewListenerPids(port) {
  if (!IS_WIN || !Number.isInteger(Number(port))) return [];
  try {
    const result = spawnSync("netstat.exe", ["-ano", "-p", "tcp"], { windowsHide: true, encoding: "utf8" });
    return previewListenerPidsFromNetstat(result.stdout, port);
  } catch {
    return [];
  }
}

function stopPreviewRecord(id, record) {
  if (record?.server) {
    try { record.server.close(); } catch {}
  }
  const listenerPids = record?.child && !record.attached ? windowsPreviewListenerPids(record.port) : [];
  if (record?.child && !record.child.killed) {
    try {
      if (IS_WIN && record.child.pid) {
        spawnSync("taskkill.exe", ["/pid", String(record.child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
      } else if (record.child.pid) {
        process.kill(-record.child.pid, "SIGTERM");
      } else {
        record.child.kill();
      }
    } catch {
      try { record.child.kill(); } catch {}
    }
  }
  for (const pid of listenerPids) {
    if (pid === record?.child?.pid) continue;
    try { spawnSync("taskkill.exe", ["/pid", String(pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" }); } catch {}
  }
  previewServers.delete(id);
}

function sweepPreviewServers(force = false) {
  const cutoff = Date.now() - PREVIEW_IDLE_MS;
  for (const [id, record] of previewServers) {
    if (force || Number(record.lastUsed || record.startedAt || 0) < cutoff) stopPreviewRecord(id, record);
  }
}

const previewSweep = setInterval(() => sweepPreviewServers(false), 5 * 60 * 1000);
previewSweep.unref?.();
process.once("exit", () => sweepPreviewServers(true));

function cleanRelay(value) {
  const url = new URL(String(value || "https://chat.hyzr.ai"));
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error("Hyzr Agent requires HTTPS except for a localhost development server.");
  }
  return url.origin.replace(/\/$/, "");
}

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return fallback; }
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, file);
}

async function readAgentConfig() {
  const primary = await readJson(CONFIG_FILE, null);
  if (primary && typeof primary === "object") return primary;
  const backup = await readJson(CONFIG_BACKUP_FILE, null);
  if (backup && typeof backup === "object") {
    await writeJson(CONFIG_FILE, backup).catch(() => {});
    return backup;
  }
  return {};
}

async function writeAgentConfig(value) {
  const current = await readJson(CONFIG_FILE, null);
  if (current && typeof current === "object") {
    await copyFile(CONFIG_FILE, CONFIG_BACKUP_FILE).catch(() => {});
  }
  await writeJson(CONFIG_FILE, value);
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) {
    return error?.code === "EPERM";
  }
}

async function acquireRuntimeLock(lockFile = LOCK_FILE) {
  await mkdir(path.dirname(lockFile), { recursive: true });
  const nonce = randomBytes(12).toString("hex");
  const payload = { pid: process.pid, nonce, version: VERSION, startedAt: Date.now() };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(lockFile, "wx", 0o600);
      await handle.writeFile(JSON.stringify(payload));
      await handle.close();
      return async () => {
        const current = await readJson(lockFile, null);
        if (current?.nonce === nonce) await unlink(lockFile).catch(() => {});
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const existing = await readJson(lockFile, null);
      if (existing?.pid && processIsAlive(Number(existing.pid))) {
        throw Object.assign(new Error(`Hyzr is already running in process ${existing.pid}. Keep that terminal open.`), { code: "ALREADY_RUNNING" });
      }
      await unlink(lockFile).catch(() => {});
    }
  }
  throw new Error("Could not acquire the Hyzr runtime lock.");
}

async function ask(question, fallback = "") {
  if (!process.stdin.isTTY) return fallback;
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => terminal.question(question, (answer) => {
    terminal.close();
    resolve(answer.trim() || fallback);
  }));
}

function selectExecutable(candidates, windows = IS_WIN) {
  if (!windows) return candidates[0] || null;
  // npm's .cmd launcher is runnable by child_process. A later WindowsApps
  // .exe candidate may be an App Execution Alias that returns EPERM to a
  // background desktop process, so prefer the command shim when present.
  return candidates.find((item) => /\.(cmd|bat)$/i.test(item))
    || candidates.find((item) => /\.(exe|com)$/i.test(item))
    || candidates[0]
    || null;
}

async function locate(command) {
  try {
    const { stdout } = await execFileAsync(IS_WIN ? "where.exe" : "which", [command], { timeout: 4000, windowsHide: true });
    const candidates = stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    return selectExecutable(candidates);
  } catch {
    return null;
  }
}

async function commandVersion(commandPath) {
  if (!commandPath) return null;
  try {
    const launch = commandLaunch(commandPath, ["--version"]);
    const { stdout, stderr } = await execFileAsync(launch.command, launch.args, {
      timeout: 5000,
      windowsHide: true,
      windowsVerbatimArguments: launch.windowsVerbatimArguments,
    });
    return (stdout || stderr).trim().split(/\r?\n/)[0]?.slice(0, 100) || null;
  } catch {
    return null;
  }
}

function cmdQuote(value) {
  return `"${String(value).replace(/[\r\n]/g, " ").replace(/%/g, "%%").replace(/"/g, '""')}"`;
}

function commandLaunch(command, args) {
  if (!(IS_WIN && /\.(cmd|bat)$/i.test(command))) return { command, args, windowsVerbatimArguments: false };
  const shell = process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe";
  return {
    command: shell,
    args: ["/d", "/s", "/c", `call ${cmdQuote(command)} ${args.map(cmdQuote).join(" ")}`],
    windowsVerbatimArguments: true,
  };
}

function safeWorkspace(root, workspaceId) {
  const id = cleanId(workspaceId);
  if (!id) throw new Error("The job did not include a valid workspace ID.");
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, id);
  if (!target.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error("Invalid workspace path.");
  return target;
}

function safeRelative(root, relative) {
  const base = path.resolve(root);
  const target = path.resolve(base, String(relative || ""));
  if (target === base || target.startsWith(`${base}${path.sep}`)) return target;
  throw new Error("Invalid project path.");
}

function engineFor(job, tools) {
  const requested = String(job.model || "").toLowerCase();
  if (/(claude|fable|sonnet|opus|haiku)/.test(requested) && tools.claude) return "claude";
  if (/(gpt|codex|sol|terra|luna)/.test(requested) && tools.codex) return "codex";
  if (!tools.claude) return "codex";
  if (!tools.codex) return "claude";
  const prompt = String(job.prompt).toLowerCase();
  return /\b(debug|fix|refactor|implement|test|compile|lint|repository|repo|migration|run|terminal|command|math|formula)\b/.test(prompt)
    ? "codex"
    : "claude";
}

function providerModel(engine, requested) {
  const id = String(requested || "");
  if (engine === "claude") {
    if (/haiku/i.test(id)) return "haiku";
    if (/sonnet/i.test(id)) return "sonnet";
    if (/opus|fable/i.test(id)) return "opus";
    return "";
  }
  if (!id || /(claude|fable|sonnet|opus|haiku)/i.test(id)) return "";
  return id.match(/^gpt-[a-zA-Z0-9_.-]+$/)?.[0] || "";
}

function transcript(job) {
  const history = (Array.isArray(job.history) ? job.history.slice(-16) : []).filter((message) => {
    if (message?.role !== "assistant") return true;
    const content = String(message.content || "");
    return !/\bHyzr\b[\s\S]{0,100}\b(?:manages|owns)\b[\s\S]{0,80}\b(?:preview|server|process)\b|\bHyzr workspace\b[\s\S]{0,100}\bnot to start\b[\s\S]{0,80}\bserver/i.test(content);
  });
  if (!history.length) return String(job.prompt);
  return [
    ...history.map((message) => `${message.role === "assistant" ? "Assistant" : "User"}: ${String(message.content || "").slice(0, 8000)}`),
    `User: ${String(job.prompt)}`,
  ].join("\n\n");
}

async function post(relay, pathname, body, attempts = 4) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(`${relay}${pathname}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Relay returned ${response.status}.`);
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await sleep(400 * 2 ** attempt);
    }
  }
  throw lastError;
}

function openExternalUrl(url) {
  try {
    const child = IS_WIN
      ? spawn("rundll32.exe", ["url.dll,FileProtocolHandler", url], { detached: true, stdio: "ignore", windowsHide: true })
      : process.platform === "darwin"
        ? spawn("open", [url], { detached: true, stdio: "ignore" })
        : spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function setModernConsoleFont() {
  if (!IS_WIN) return false;
  const script = String.raw`
$definition = @'
using System;
using System.Runtime.InteropServices;

public static class HyzrConsole {
  [StructLayout(LayoutKind.Sequential)]
  public struct COORD {
    public short X;
    public short Y;
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CONSOLE_FONT_INFOEX {
    public uint cbSize;
    public uint nFont;
    public COORD dwFontSize;
    public int FontFamily;
    public int FontWeight;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
    public string FaceName;
  }

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern IntPtr GetStdHandle(int handle);

  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  private static extern bool SetCurrentConsoleFontEx(
    IntPtr output,
    bool maximumWindow,
    ref CONSOLE_FONT_INFOEX info
  );

  public static bool Apply(string face, short height) {
    var info = new CONSOLE_FONT_INFOEX();
    info.cbSize = (uint)Marshal.SizeOf(typeof(CONSOLE_FONT_INFOEX));
    info.dwFontSize = new COORD { X = 0, Y = height };
    info.FontFamily = 54;
    info.FontWeight = 400;
    info.FaceName = face;
    return SetCurrentConsoleFontEx(GetStdHandle(-11), false, ref info);
  }
}
'@

try {
  Add-Type -TypeDefinition $definition -ErrorAction Stop
  if (-not [HyzrConsole]::Apply('Cascadia Mono', 18)) {
    [void][HyzrConsole]::Apply('Consolas', 18)
  }
} catch {
  try { [void][HyzrConsole]::Apply('Consolas', 18) } catch {}
}
`;
  try {
    const result = spawnSync("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy", "Bypass",
      "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64"),
    ], { windowsHide: false, stdio: ["inherit", "inherit", "ignore"] });
    return result.status === 0;
  } catch {
    return false;
  }
}

async function deviceAuthorize(relay, capabilities, options = {}) {
  while (!options.signal?.aborted) {
    const flow = await post(relay, "/api/agent/device/start", { agent: capabilities });
    options.onCode?.(flow);
    if (options.openBrowser !== false) openExternalUrl(flow.verificationUriComplete);
    const deadline = Date.now() + Number(flow.expiresIn || 900) * 1000;
    const interval = Math.max(
      Number(options.minimumPollMs ?? 2_000),
      Math.max(0, Number(flow.interval || 3)) * 1000,
    );
    while (!options.signal?.aborted && Date.now() < deadline) {
      await sleep(interval);
      let response;
      try {
        response = await fetch(`${relay}/api/agent/device/token`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ deviceSecret: flow.deviceSecret }),
          signal: AbortSignal.timeout(12_000),
        });
      } catch (error) {
        options.onWait?.(error instanceof Error ? error.message : String(error));
        continue;
      }
      if (response.status === 202) continue;
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload.token) return payload.token;
      if (response.status === 404 || payload.error === "expired_token") break;
      if (response.status === 429) {
        await sleep(Math.max(3, Number(response.headers.get("retry-after") || 5)) * 1000);
        continue;
      }
      options.onWait?.(payload.error || `Pairing service returned ${response.status}.`);
    }
    if (!options.signal?.aborted) options.onExpired?.();
  }
  throw Object.assign(new Error("Pairing cancelled."), { code: "ABORTED" });
}

function runProcess(command, args, prompt, cwd, onLine) {
  return new Promise((resolve) => {
    const launch = commandLaunch(command, args);
    const child = spawn(launch.command, launch.args, {
      cwd,
      windowsHide: true,
      windowsVerbatimArguments: launch.windowsVerbatimArguments,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdoutBuffer = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) onLine(line);
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => resolve({ code: 1, stderr: error.message }));
    child.once("close", (code) => {
      if (stdoutBuffer.trim()) onLine(stdoutBuffer);
      resolve({ code: code ?? 1, stderr });
    });
    child.stdin.end(prompt);
  });
}

function claudeActivity(content) {
  const labels = {
    Read: "Reading project files",
    Write: "Writing project files",
    Edit: "Editing project files",
    Bash: "Running a command",
    PowerShell: "Running a command",
    Glob: "Finding project files",
    Grep: "Searching project files",
  };
  return labels[content?.name] || (content?.name ? `Using ${content.name}` : "");
}

async function runClaude({ command, job, cwd, priorSession, permissionMode, emit }) {
  const model = providerModel("claude", job.model);
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--include-partial-messages",
    "--verbose",
    ...(model ? ["--model", model] : []),
    ...(priorSession ? ["--resume", priorSession] : []),
    ...(permissionMode === "full-access"
      ? ["--dangerously-skip-permissions"]
      : ["--permission-mode", "acceptEdits"]),
  ];
  let sessionId = priorSession || "";
  let answer = "";
  let sawPartial = false;
  let separateNextTextBlock = false;
  let resultError = "";
  const processResult = await runProcess(command, args, priorSession ? String(job.prompt) : transcript(job), cwd, (line) => {
    let event;
    try { event = JSON.parse(line); } catch { return; }
    if (event.session_id) sessionId = event.session_id;
    if (event.type === "system" && event.subtype === "init" && event.session_id) sessionId = event.session_id;
    if (event.type === "stream_event" && event.event?.type === "content_block_start" && event.event.content_block?.type === "tool_use") {
      separateNextTextBlock = Boolean(answer);
    }
    if (event.type === "stream_event" && event.event?.type === "content_block_delta" && event.event.delta?.type === "text_delta") {
      sawPartial = true;
      const delta = event.event.delta.text || "";
      if (delta && separateNextTextBlock) {
        const separator = streamSeparator(answer);
        answer += separator;
        if (separator) emit("text", separator);
        separateNextTextBlock = false;
      }
      answer += delta;
      emit("text", delta);
    }
    if (event.type === "assistant" && Array.isArray(event.message?.content)) {
      for (const content of event.message.content) {
        if (content?.type === "tool_use") {
          separateNextTextBlock = Boolean(answer);
          const text = claudeActivity(content);
          if (text) emit("status", text, { tool: content.name });
        }
      }
    }
    if (event.type === "result") {
      if (!sawPartial && event.result) {
        answer = event.result;
        emit("text", event.result);
      }
      if (event.usage) emit("usage", "", event.usage);
      if (event.is_error) resultError = event.result || "Claude reported an error.";
    }
  });
  if (processResult.code !== 0 || resultError) throw new Error(resultError || processResult.stderr.trim() || `Claude exited with code ${processResult.code}.`);
  return { sessionId, answer };
}

function streamSeparator(previous) {
  if (!previous || /\n\s*\n$/.test(previous)) return "";
  return "\n\n";
}

async function runCodex({ command, job, cwd, priorSession, permissionMode, emit }) {
  const model = providerModel("codex", job.model);
  const requestedEffort = String(job.effort || "").toLowerCase();
  const effort = requestedEffort === "ultra"
    ? "xhigh"
    : ["low", "medium", "high", "xhigh"].includes(requestedEffort)
      ? requestedEffort
      : "";
  const common = [
    ...(model ? ["--model", model] : []),
    ...(effort ? ["-c", `model_reasoning_effort="${effort}"`] : []),
    "--json",
    "--skip-git-repo-check",
    ...(permissionMode === "full-access"
      ? ["--dangerously-bypass-approvals-and-sandbox"]
      : ["-c", 'sandbox_mode="workspace-write"', "-c", 'approval_policy="never"']),
  ];
  const args = priorSession ? ["exec", "resume", priorSession, ...common, "-"] : ["exec", ...common, "-"];
  let sessionId = priorSession || "";
  let answer = "";
  let failure = "";
  const processResult = await runProcess(command, args, priorSession ? String(job.prompt) : transcript(job), cwd, (line) => {
    let event;
    try { event = JSON.parse(line); } catch { return; }
    if (event.type === "thread.started" && event.thread_id) sessionId = event.thread_id;
    if ((event.type === "item.started" || event.type === "item.completed") && event.item?.type && event.item.type !== "agent_message") {
      const names = {
        command_execution: "Running a command",
        file_change: "Editing project files",
        mcp_tool_call: "Using a connected tool",
        web_search: "Searching the web",
        plan: "Updating the plan",
        reasoning: "Reasoning",
      };
      emit("status", names[event.item.type] || `Using ${event.item.type}`, { tool: event.item.type });
    }
    if (event.type === "item.completed" && event.item?.type === "agent_message" && event.item.text) answer = event.item.text;
    if (event.type === "turn.completed" && event.usage) emit("usage", "", event.usage);
    if (event.type === "turn.failed" || event.type === "error") failure = event.error?.message || event.message || "Codex reported an error.";
  });
  if (answer) emit("text", answer);
  if (processResult.code !== 0 || failure) throw new Error(failure || processResult.stderr.trim() || `Codex exited with code ${processResult.code}.`);
  return { sessionId, answer };
}

function safeRepo(value) {
  const repo = String(value || "");
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo)) throw new Error("Invalid repository name.");
  return repo;
}

function safeGitHubPath(value) {
  const item = String(value || "").replace(/^\/+/, "");
  if (item.split("/").includes("..")) throw new Error("Invalid repository path.");
  return item;
}

async function ghJson(command, args) {
  if (!command) throw new Error("GitHub CLI is not installed on the paired computer.");
  const { stdout, stderr } = await execFileAsync(command, args, { timeout: 30_000, windowsHide: true, maxBuffer: 12 * 1024 * 1024 });
  if (stderr && !stdout) throw new Error(stderr.trim());
  return JSON.parse(stdout);
}

async function walkWorkspace(directory, relative = "", depth = 0, output = []) {
  if (depth > 16 || output.length >= 3000) return output;
  let entries = [];
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return output; }
  for (const entry of entries) {
    if (IGNORE.has(entry.name) || entry.name.startsWith(".")) continue;
    const itemPath = relative ? `${relative}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      output.push({ name: entry.name, path: itemPath, type: "dir" });
      await walkWorkspace(absolute, itemPath, depth + 1, output);
    } else {
      let size = 0;
      try { size = (await stat(absolute)).size; } catch {}
      output.push({ name: entry.name, path: itemPath, type: "file", size });
    }
  }
  return output;
}

function privateLanAddress(interfaces = os.networkInterfaces()) {
  const candidates = Object.entries(interfaces || {}).flatMap(([adapter, addresses]) =>
    (addresses || []).filter((item) =>
      item && !item.internal && (item.family === "IPv4" || item.family === 4),
    ).map((item) => ({ adapter, address: item.address })),
  ).filter(({ address }) =>
    /^10\./.test(address)
    || /^192\.168\./.test(address)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(address),
  );
  const physical = candidates.filter(({ adapter }) => !/\b(vethernet|virtual|wsl|docker|vmware|virtualbox|tailscale)\b/i.test(adapter));
  return (physical.length ? physical : candidates).sort((a, b) => {
    const score = ({ adapter, address }) =>
      (/wi-?fi|wireless/i.test(adapter) ? 0 : /ethernet/i.test(adapter) ? 10 : 20)
      + (/^192\.168\./.test(address) ? 0 : /^10\./.test(address) ? 1 : 2);
    return score(a) - score(b);
  })[0]?.address || null;
}

function previewDetails(port, extra = {}, lanAvailable = true) {
  const networkHost = privateLanAddress();
  return {
    port,
    localUrl: `http://localhost:${port}`,
    lanUrl: lanAvailable && networkHost ? `http://${networkHost}:${port}` : null,
    networkHost: lanAvailable ? networkHost : null,
    ...extra,
  };
}

function previewHostArgs(scriptCommand) {
  if (/\bnext(?:\.js)?\b/i.test(scriptCommand)) return ["--hostname", "0.0.0.0"];
  if (/\b(vite|astro|ng\s+serve|vue-cli-service\s+serve)\b/i.test(scriptCommand)) return ["--host", "0.0.0.0"];
  return [];
}

function previewPortFromPrompt(prompt) {
  const text = String(prompt || "");
  const matches = [
    ...text.matchAll(/\b(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[?::1\]?):(\d{2,5})\b/gi),
    ...text.matchAll(/(?:--port(?:=|\s+)|(?:^|\s)-p(?:=|\s+)|\bport\s*(?:=|:)?\s*)(\d{2,5})\b/gi),
  ];
  const shortReplyPorts = text.length <= 80 ? [...text.matchAll(/\b(\d{4,5})\b/g)] : [];
  const port = Number(matches.at(-1)?.[1] || (shortReplyPorts.length === 1 ? shortReplyPorts[0][1] : ""));
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : null;
}

async function probePreviewPort(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) });
    return response.status < 500;
  } catch {
    return false;
  }
}

async function startPreviewServer(context, workspaceId) {
  const workspace = safeWorkspace(context.workspaceRoot, workspaceId);
  const id = cleanId(workspaceId);
  const existing = previewServers.get(id);
  if (existing) {
    if (await probePreviewPort(existing.port)) {
      existing.lastUsed = Date.now();
      return previewDetails(existing.port, { reused: true, attached: true, static: false }, existing.lanAvailable !== false);
    }
    stopPreviewRecord(id, existing);
  }
  const packageFile = safeRelative(workspace, "package.json");
  let manifest = null;
  try { manifest = JSON.parse(await readFile(packageFile, "utf8")); } catch {}
  const script = manifest?.scripts?.dev ? "dev" : manifest?.scripts?.start ? "start" : "";
  const scriptCommand = String(manifest?.scripts?.[script] || "");
  const declaredPort = workspacePreferredPorts.get(id) || previewPortFor(manifest, scriptCommand);
  if (declaredPort) {
    if (await probePreviewPort(declaredPort)) {
      const networkHost = privateLanAddress();
      let lanAvailable = false;
      if (networkHost) {
        try {
          const lanResponse = await fetch(`http://${networkHost}:${declaredPort}/`, { signal: AbortSignal.timeout(1500) });
          lanAvailable = lanResponse.status < 500;
        } catch {}
      }
      previewServers.set(id, { child: null, server: null, port: declaredPort, workspace, startedAt: Date.now(), lastUsed: Date.now(), attached: true, lanAvailable });
      return previewDetails(declaredPort, { reused: true, attached: true, static: false }, lanAvailable);
    }
  }
  if (!declaredPort) {
    throw new Error("No running project server was detected. Start one with Claude or Codex on a specific port, then open Preview.");
  }
  throw new Error(`No server is listening on the requested port ${declaredPort}. Preview never starts a server or substitutes a different port.`);
}

function previewPortFor(manifest, script = "") {
  const configured = Number(manifest?.hyzr?.previewPort);
  if (Number.isInteger(configured) && configured >= 1024 && configured <= 65535) return configured;
  const explicit = String(script).match(/(?:--port(?:=|\s+)|(?:^|\s)-p(?:=|\s+)|\bPORT=)(\d{4,5})\b/i);
  if (explicit) return Number(explicit[1]);
  if (/\bvite\b/i.test(script)) return 5173;
  if (/\bastro\b/i.test(script)) return 4321;
  if (/\bng\s+serve\b|\bng\b.*\bserve\b/i.test(script)) return 4200;
  if (/\bvue-cli-service\s+serve\b/i.test(script)) return 8080;
  if (/\b(next|react-scripts|remix)\b/i.test(script)) return 3000;
  return null;
}

function previewEntry(files) {
  const html = files.filter((item) => item.type === "file" && /\.html?$/i.test(item.name));
  const index = html.find((item) => /^(dist|build|out)\/index\.html?$/i.test(item.path))
    || html.filter((item) => /^index\.html?$/i.test(item.name)).sort((a, b) => a.path.split("/").length - b.path.split("/").length)[0]
    || html[0];
  return index?.path || null;
}

// Quality-first, coherence-first plan (ported engine in routing.mjs). A coupled
// app is ONE build on the model best-suited to it at the lowest subscription
// usage; only genuinely independent deliverables (image/video generation) split
// off. Replaces the old hardcoded over-splitting, which the judged A/B proved
// broke integration and wasted the frontier on commodity parts.
function specialistPlan(job, tools) {
  return planForAgent(job, tools).slice(0, 4);
}

// PRIMARY planner: a cheap model reads the request (difficulty, emphasis,
// frustration, explicit cues) and picks the best model per part. Silent, low
// effort. Returns validated agent tasks, or null ⇒ deterministic specialistPlan
// fallback. Never blocks execution: any failure just falls back.
async function planWithRouter(job, context) {
  if (!job.plan) return null;
  const router = routerModelFor(context.tools);
  if (!router) return null;
  const prompt = buildRouterPrompt(job, context.tools);
  if (!prompt) return null;
  const runner = router.engine === "codex" ? runCodex : runClaude;
  const cwd = safeWorkspace(context.workspaceRoot, job.workspaceId);
  try {
    await mkdir(cwd, { recursive: true });
    const res = await runner({
      command: context.tools[router.engine],
      job: { prompt, model: router.model, effort: "low", history: [] },
      cwd, priorSession: "", permissionMode: context.permissionMode, emit: () => {},
    });
    return parseRouterPlan(res.answer, job, context.tools);
  } catch {
    return null;
  }
}

async function handleRpc(job, context) {
  const params = job.params || {};
  switch (job.method) {
    case "system.status":
      return context.capabilities;
    case "github.status": {
      const user = await ghJson(context.tools.gh, ["api", "user"]);
      return { connected: true, login: user.login };
    }
    case "github.repos":
      return { repos: await ghJson(context.tools.gh, ["repo", "list", "--json", "nameWithOwner,description,updatedAt,visibility,primaryLanguage,stargazerCount", "--limit", "60"]) };
    case "github.tree": {
      const repo = safeRepo(params.repo);
      const repoPath = safeGitHubPath(params.path);
      const raw = await ghJson(context.tools.gh, ["api", `repos/${repo}/contents/${repoPath}`]);
      const items = (Array.isArray(raw) ? raw : [raw]).map((item) => ({ name: item.name, path: item.path, type: item.type, size: item.size }));
      items.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1);
      return { items };
    }
    case "github.file": {
      const repo = safeRepo(params.repo);
      const repoPath = safeGitHubPath(params.path);
      const data = await ghJson(context.tools.gh, ["api", `repos/${repo}/contents/${repoPath}`]);
      return { content: Buffer.from(data.content || "", "base64").toString("utf8"), path: repoPath };
    }
    case "github.issues": {
      const repo = safeRepo(params.repo);
      const state = params.state === "closed" ? "closed" : "open";
      return { issues: await ghJson(context.tools.gh, ["issue", "list", "--repo", repo, "--state", state, "--limit", "50", "--json", "number,title,body,url,labels,assignees,updatedAt"]) };
    }
    case "github.issue": {
      const repo = safeRepo(params.repo);
      const number = Number(params.number);
      if (!Number.isInteger(number) || number < 1) throw new Error("Invalid issue number.");
      return { issue: await ghJson(context.tools.gh, ["issue", "view", String(number), "--repo", repo, "--json", "number,title,body,url,labels,assignees,state,comments"]) };
    }
    case "workspace.list": {
      const workspace = safeWorkspace(context.workspaceRoot, params.workspaceId);
      await mkdir(workspace, { recursive: true });
      const files = await walkWorkspace(workspace);
      return { files, entry: previewEntry(files), count: files.length, workspace };
    }
    case "workspace.read": {
      const workspace = safeWorkspace(context.workspaceRoot, params.workspaceId);
      const file = safeRelative(workspace, params.path);
      const metadata = await stat(file);
      if (!metadata.isFile()) throw new Error("Not a file.");
      if (metadata.size > 512 * 1024) throw new Error("File exceeds the 512 KB viewer limit.");
      const content = await readFile(file, "utf8");
      if (content.includes("\0")) throw new Error("Binary files cannot be displayed.");
      return { path: String(params.path), content, size: metadata.size };
    }
    case "workspace.asset": {
      const workspace = safeWorkspace(context.workspaceRoot, params.workspaceId);
      const file = safeRelative(workspace, params.path);
      const metadata = await stat(file);
      if (!metadata.isFile()) throw new Error("Not a file.");
      if (metadata.size > 3 * 1024 * 1024) throw new Error("Preview asset exceeds the 3 MB relay limit.");
      const content = await readFile(file);
      return { path: String(params.path), body: content.toString("base64"), size: metadata.size };
    }
    case "preview.start":
      return startPreviewServer(context, params.workspaceId);
    case "preview.http": {
      const id = cleanId(params.workspaceId);
      const record = previewServers.get(id);
      if (!record || (record.child && record.child.killed)) await startPreviewServer(context, id);
      const active = previewServers.get(id);
      active.lastUsed = Date.now();
      const requested = String(params.path || "/");
      if (!requested.startsWith("/") || requested.startsWith("//")) throw new Error("Invalid preview URL.");
      const response = await fetch(`http://127.0.0.1:${active.port}${requested}`, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(20_000),
      });
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length > 3 * 1024 * 1024) throw new Error("Preview response exceeds the 3 MB relay limit.");
      return {
        status: response.status,
        contentType: response.headers.get("content-type") || "application/octet-stream",
        location: response.headers.get("location"),
        body: body.toString("base64"),
      };
    }
    default:
      throw new Error(`Unsupported local operation: ${job.method}`);
  }
}

async function handleRun(job, context) {
  const workspace = safeWorkspace(context.workspaceRoot, job.workspaceId);
  await mkdir(workspace, { recursive: true });
  const requestedPort = previewPortFromPrompt(job.prompt);
  if (requestedPort) {
    const id = cleanId(job.workspaceId);
    const previous = previewServers.get(id);
    if (previous && previous.port !== requestedPort) stopPreviewRecord(id, previous);
    workspacePreferredPorts.set(id, requestedPort);
  }
  const sessions = await readJson(context.sessionsFile, {});
  // LLM router first (reads intent/emphasis/frustration); deterministic fallback.
  const planned = (await planWithRouter(job, context)) || specialistPlan(job, context.tools);
  const tasks = planned.length ? planned : [{
    label: "Agent",
    engine: engineFor(job, context.tools),
    model: job.model,
    instruction: "",
  }];
  const handoffs = [];

  // Surface the routed plan so the web renders the Deep plan tree (which model
  // each part goes to and why). Only when the planner actually produced a route.
  if (job.plan && planned.length) {
    const maxTier = planned.reduce((mx, t) => ({ hard: 3, standard: 2, trivial: 1 }[t.tier] > { hard: 3, standard: 2, trivial: 1 }[mx] ? t.tier : mx), "trivial");
    await context.emit(job.id, "plan", "", {
      plan: {
        intent: String(job.prompt || "").replace(/\s+/g, " ").trim().slice(0, 200),
        complexity: maxTier,
        strategy: planned.length > 1
          ? `${planned.length} parts, each on its strong-suit model; coupled work stays coherent, independent assets split off.`
          : `A single coherent build on ${planned[0].modelLabel}, routed by capability at the lowest subscription usage.`,
        executorModelId: planned[0].model,
        subtasks: planned.map((t) => ({ title: t.label, tier: t.tier, capability: t.capability, modelId: t.model, modelLabel: t.modelLabel, rationale: t.rationale })),
      },
    });
  }

  for (let index = 0; index < tasks.length; index++) {
    const task = tasks[index];
    // Version the provider session key so an agent upgrade cannot resume a
    // thread containing obsolete bridge instructions.
    const sessionKey = `${VERSION}:${cleanId(job.conversationId)}:${task.engine}`;
    const priorSession = sessions[sessionKey]?.sessionId || "";
    const finalTask = index === tasks.length - 1;
    await context.emit(
      job.id,
      "status",
      `${task.label} → ${task.engine === "codex" ? task.model || "Codex" : task.model || "Claude"}`,
      { task: index + 1, totalTasks: tasks.length, engine: task.engine, model: task.model },
    );
    // Rich task_start so the web tree marks this node active with its model.
    if (job.plan && planned.length) {
      await context.emit(job.id, "task_start", "", {
        index, total: tasks.length, title: task.label, modelId: task.model,
        modelLabel: task.modelLabel, provider: task.engine, capability: task.capability, tier: task.tier, plan: task.plan,
      });
    }
    const handoff = handoffs.length
      ? `\n\nSPECIALIST HANDOFFS\n${handoffs.map((item) => `--- ${item.label} ---\n${item.answer}`).join("\n\n")}`
      : "";
    const taskJob = {
      ...job,
      model: task.model || job.model,
      prompt: task.instruction
        ? `${task.instruction}\n\nORIGINAL USER REQUEST\n${job.prompt}${handoff}`
        : job.prompt,
      history: priorSession ? [] : job.history,
    };
    const emit = (type, text, data) => {
      if (type !== "text" || finalTask) return context.emit(job.id, type, text, data);
      return Promise.resolve();
    };
    const runner = task.engine === "codex" ? runCodex : runClaude;
    let result;
    try {
      result = await runner({
        command: context.tools[task.engine],
        job: taskJob,
        cwd: workspace,
        priorSession,
        permissionMode: context.permissionMode,
        emit,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!taskJob.model || !/\b(model|slug)\b[\s\S]{0,100}\b(unknown|invalid|not found|unsupported|unavailable|access)\b/i.test(message)) throw error;
      await context.emit(job.id, "status", `${task.model} is unavailable on this account; using the provider default.`);
      result = await runner({
        command: context.tools[task.engine],
        job: { ...taskJob, model: null },
        cwd: workspace,
        priorSession,
        permissionMode: context.permissionMode,
        emit,
      });
    }
    handoffs.push({ label: task.label, answer: String(result.answer || "").slice(0, 12_000) });
    if (job.plan && planned.length) {
      await context.emit(job.id, "task_done", "", { index, outcome: "completed", modelId: task.model, title: task.label });
    }
    if (result.sessionId) {
      sessions[sessionKey] = {
        sessionId: result.sessionId,
        engine: task.engine,
        workspaceId: cleanId(job.workspaceId),
        conversationId: cleanId(job.conversationId),
        updatedAt: Date.now(),
      };
      await writeJson(context.sessionsFile, sessions);
    }
  }
}

export async function detectAgentEnvironment(options = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot || DEFAULT_ROOT);
  await mkdir(workspaceRoot, { recursive: true });
  const tools = {
    claude: await locate("claude"),
    codex: await locate("codex"),
    git: await locate("git"),
    gh: await locate("gh"),
    npm: await locate("npm"),
  };
  if (!tools.claude && !tools.codex) throw new Error("Install and sign in to Claude Code or Codex before pairing Hyzr.");
  const permissionMode = options.permissionMode || "full-access";
  return {
    tools,
    capabilities: {
      protocol: PROTOCOL,
      version: VERSION,
      host: os.hostname(),
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      claude: Boolean(tools.claude),
      codex: Boolean(tools.codex),
      git: Boolean(tools.git),
      gh: Boolean(tools.gh),
      engine: tools.claude && tools.codex ? "claude+codex" : tools.claude ? "claude" : "codex",
      workspaceRoot,
      permissionMode,
      versions: {
        claude: await commandVersion(tools.claude),
        codex: await commandVersion(tools.codex),
        git: await commandVersion(tools.git),
        gh: await commandVersion(tools.gh),
      },
    },
  };
}

export async function startAgent(options = {}) {
  const saved = options.savedConfig || await readAgentConfig();
  const relay = cleanRelay(options.relay || saved.relay || "https://chat.hyzr.ai");
  const workspaceRoot = path.resolve(options.workspaceRoot || saved.workspaceRoot || DEFAULT_ROOT);
  const permissionMode = options.permissionMode || saved.permissionMode || "workspace";
  await mkdir(workspaceRoot, { recursive: true });

  const environment = options.environment || await detectAgentEnvironment({ workspaceRoot, permissionMode });
  const { tools, capabilities } = environment;

  const code = String(options.code || saved.pendingCode || "").toUpperCase();
  let token = options.token || saved.token || "";
  if (code) {
    const paired = await post(relay, "/api/agent/pair", { code, agent: capabilities });
    token = paired.token;
  }
  if (!token) throw new Error("A pairing code is required.");
  const persisted = { relay, token, workspaceRoot, permissionMode, pairedAt: Date.now() };
  if (options.persistConfig) await options.persistConfig(persisted);
  else await writeAgentConfig(persisted);
  options.onToken?.(token);

  // Polling pauses while Claude/Codex is working. Presence must not: otherwise
  // the website incorrectly declares the machine offline in the middle of a
  // healthy long-running task.
  let heartbeatBusy = false;
  const heartbeat = async () => {
    if (heartbeatBusy || options.signal?.aborted) return;
    heartbeatBusy = true;
    try {
      await fetch(`${relay}/api/agent/heartbeat`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8_000),
      });
    } catch {}
    finally { heartbeatBusy = false; }
  };
  await heartbeat();
  const heartbeatTimer = setInterval(heartbeat, 2_000);
  heartbeatTimer.unref?.();

  let writeChain = Promise.resolve();
  const emit = (jobId, type, text = "", data) => {
    writeChain = writeChain
      .then(() => post(relay, "/api/agent/result", { token, jobId, type, text, data }))
      .catch((error) => log("could not deliver an event:", error.message));
    return writeChain;
  };
  const context = {
    relay,
    token,
    tools,
    capabilities,
    workspaceRoot,
    permissionMode,
    sessionsFile: options.sessionsFile || SESSIONS_FILE,
    emit,
  };
  options.onStatus?.({ connected: true, capabilities });

  let failures = 0;
  let runChain = Promise.resolve();
  const inFlight = new Set();
  const dispatch = (job) => {
    const execute = async () => {
      try {
        if (job.kind === "rpc") {
          const data = await handleRpc(job, context);
          await emit(job.id, "result", "", data);
        } else {
          await handleRun({ ...job, kind: "run" }, context);
          await emit(job.id, "done");
        }
      } catch (error) {
        await emit(job.id, "error", error instanceof Error ? error.message : String(error));
      }
    };
    const task = job.kind === "rpc" ? execute() : runChain.then(execute);
    if (job.kind !== "rpc") runChain = task.catch(() => {});
    inFlight.add(task);
    void task.finally(() => inFlight.delete(task));
  };
  try {
    while (!options.signal?.aborted) {
      try {
      const response = await fetch(`${relay}/api/agent/poll`, {
        cache: "no-store",
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status === 401) {
        throw Object.assign(new Error("The saved pairing was rejected."), { code: "PAIRING_EXPIRED" });
      }
      if (!response.ok) throw new Error(`Relay returned ${response.status}.`);
      const { job } = await response.json();
      failures = 0;
      if (!job) continue;
      dispatch(job);
      } catch (error) {
        if (error?.code === "PAIRING_EXPIRED") throw error;
        failures += 1;
        options.onStatus?.({ connected: false, error: error instanceof Error ? error.message : String(error) });
        await sleep(Math.min(30_000, 1000 * 2 ** Math.min(failures, 5)) + Math.floor(Math.random() * 300));
      }
    }
  } finally {
    clearInterval(heartbeatTimer);
  }
}

function argumentsMap() {
  return Object.fromEntries(process.argv.slice(2).map((item) => {
    const [key, ...rest] = item.replace(/^--/, "").split("=");
    return [key, rest.join("=")];
  }));
}

async function runAgentCliLegacy() {
  const args = argumentsMap();
  const saved = await readJson(CONFIG_FILE, {});
  const relay = args.url || process.env.HYZR_URL || saved.relay || "https://chat.hyzr.ai";
  const code = String(
    args.code
    || process.env.HYZR_CODE
    || (saved.token ? "" : await ask("Enter the code from Hyzr: ")),
  ).replace(/\s/g, "").toUpperCase();
  const workspaceRoot = path.resolve(args.workspace || saved.workspaceRoot || DEFAULT_ROOT);
  const permissionMode = args.restricted === "true" ? "workspace" : (saved.permissionMode || "full-access");
  await mkdir(workspaceRoot, { recursive: true });

  console.log("");
  console.log("  HYZR");
  console.log(`  Projects: ${workspaceRoot}`);
  console.log("  Keep this window open while you work from the web.");
  console.log("");

  let announced = false;
  let activeToken = "";
  let stopping = false;
  const controller = new AbortController();
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    controller.abort();
    sweepPreviewServers(true);
    if (activeToken) {
      try {
        await fetch(`${cleanRelay(relay)}/api/agent/disconnect`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: activeToken }),
          signal: AbortSignal.timeout(1500),
        });
      } catch {}
    }
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.once("SIGHUP", stop);
  try {
    await startAgent({
      relay,
      code,
      workspaceRoot,
      permissionMode,
      signal: controller.signal,
      onToken(token) { activeToken = token; },
      onStatus(status) {
        if (status.connected && !announced) {
          announced = true;
          const available = [
            status.capabilities.claude && "Claude",
            status.capabilities.codex && "Codex",
            status.capabilities.git && "Git",
            status.capabilities.gh && "GitHub",
          ].filter(Boolean).join(" · ");
          console.log(`  Connected${available ? ` — ${available}` : ""}`);
          console.log("");
        } else if (!status.connected && status.error) {
          console.log(`  Reconnecting — ${status.error}`);
        }
      },
    });
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGHUP", stop);
  }
}

export async function runAgentCli() {
  const args = argumentsMap();
  if ("version" in args) {
    console.log(`Hyzr Agent ${VERSION} (protocol ${PROTOCOL})`);
    return;
  }

  let releaseLock;
  try {
    releaseLock = await acquireRuntimeLock();
  } catch (error) {
    if (error?.code === "ALREADY_RUNNING") {
      console.log(`\n  ${error.message}\n`);
      return;
    }
    throw error;
  }

  setModernConsoleFont();
  const saved = await readAgentConfig();
  const relay = args.url || process.env.HYZR_URL || saved.relay || "https://chat.hyzr.ai";
  let legacyCode = String(args.code || process.env.HYZR_CODE || "").replace(/\s/g, "").toUpperCase();
  const workspaceRoot = path.resolve(args.workspace || saved.workspaceRoot || DEFAULT_ROOT);
  const permissionMode = args.restricted === "true" ? "workspace" : (saved.permissionMode || "full-access");
  await mkdir(workspaceRoot, { recursive: true });

  const colors = process.stdout.isTTY && !process.env.NO_COLOR;
  const paint = (code, value) => colors ? `\x1b[${code}m${value}\x1b[0m` : value;
  const muted = (value) => paint("90", value);
  const green = (value) => paint("32", value);
  const cyan = (value) => paint("36", value);
  const yellow = (value) => paint("33", value);
  const environment = await detectAgentEnvironment({ workspaceRoot, permissionMode });
  const toolNames = [
    environment.capabilities.claude && "Claude",
    environment.capabilities.codex && "Codex",
    environment.capabilities.git && "Git",
    environment.capabilities.gh && "GitHub",
  ].filter(Boolean);

  console.log("");
  console.log(`  ${paint("1", "HYZR AGENT")} ${muted(`v${VERSION}`)}`);
  console.log(`  ${muted("────────────────────────────────────────")}`);
  console.log(`  ${muted("Computer")}   ${environment.capabilities.host}`);
  console.log(`  ${muted("Projects")}   ${workspaceRoot}`);
  console.log(`  ${muted("Tools")}      ${toolNames.join(" · ") || "No coding provider found"}`);
  console.log(`  ${muted("Access")}     ${permissionMode === "full-access" ? "Full local access" : "Project workspace only"}`);
  console.log("");

  if ("doctor" in args) {
    console.log(`  ${green("●")} Runtime is healthy`);
    console.log(`  ${muted("Relay")}      ${cleanRelay(relay)}`);
    console.log(`  ${muted("Config")}     ${CONFIG_FILE}`);
    console.log("");
    await releaseLock();
    return;
  }

  // A pairing token authorizes exactly one launcher session. Revoke any saved
  // session before starting so every launch generates a new code and opens the
  // browser approval page. Workspace and provider state remain untouched.
  if (saved.token) {
    try {
      await post(cleanRelay(relay), "/api/agent/disconnect", { token: saved.token }, 1);
    } catch {}
    await writeAgentConfig({ relay: cleanRelay(relay), workspaceRoot, permissionMode });
  }

  let connectionState = "";
  let activeToken = "";
  let stopping = false;
  const controller = new AbortController();
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    controller.abort();
    sweepPreviewServers(true);
    if (activeToken) {
      try {
        await fetch(`${cleanRelay(relay)}/api/agent/disconnect`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: activeToken }),
          signal: AbortSignal.timeout(1500),
        });
      } catch {}
    }
    await releaseLock?.();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.once("SIGHUP", stop);
  try {
    if (args.reset === "true") {
      await writeAgentConfig({ relay: cleanRelay(relay), workspaceRoot, permissionMode });
    }
    while (!controller.signal.aborted) {
      const current = await readAgentConfig();
      let token = current.token || "";
      try {
        if (!token && !legacyCode) {
          token = await deviceAuthorize(cleanRelay(relay), environment.capabilities, {
            signal: controller.signal,
            openBrowser: args.browser !== "false",
            onCode(flow) {
              connectionState = "pairing";
              console.log(`  ${yellow("●")} Pair this computer`);
              console.log(`  ${muted("Code")}       ${paint("1;36", flow.userCode)}`);
              console.log(`  ${muted("Browser")}    ${cyan(flow.verificationUriComplete)}`);
              console.log(`  ${muted("Waiting for approval… A new code appears automatically if this one expires.")}`);
              console.log("");
            },
            onExpired() {
              console.log(`  ${yellow("↻")} Code expired — generating a fresh one…`);
            },
            onWait(message) {
              if (connectionState !== "pair-wait") {
                connectionState = "pair-wait";
                console.log(`  ${yellow("↻")} Pairing service unavailable (${message}). Retrying…`);
              }
            },
          });
          activeToken = token;
          await writeAgentConfig({ relay: cleanRelay(relay), token, workspaceRoot, permissionMode, pairedAt: Date.now() });
          console.log(`  ${green("✓")} Approved securely`);
        }

        await startAgent({
          relay,
          code: legacyCode,
          token,
          savedConfig: current,
          environment,
          workspaceRoot,
          permissionMode,
          signal: controller.signal,
          persistConfig: writeAgentConfig,
          onToken(nextToken) {
            activeToken = nextToken;
            legacyCode = "";
          },
          onStatus(status) {
            if (status.connected && connectionState !== "connected") {
              connectionState = "connected";
              console.log(`  ${green("●")} Connected — build from the web or your phone`);
              console.log(`  ${muted("The launcher reconnects automatically. Press Ctrl+C to stop.")}`);
              console.log("");
            } else if (!status.connected && connectionState !== "reconnecting") {
              connectionState = "reconnecting";
              console.log(`  ${yellow("↻")} Connection interrupted — retrying automatically`);
            }
          },
        });
        break;
      } catch (error) {
        if (controller.signal.aborted || error?.code === "ABORTED") break;
        if (error?.code === "PAIRING_EXPIRED") {
          activeToken = "";
          connectionState = "reauthorizing";
          await writeAgentConfig({ relay: cleanRelay(relay), workspaceRoot, permissionMode });
          console.log(`  ${yellow("↻")} Pairing needs approval again — creating a fresh code…`);
          continue;
        }
        connectionState = "startup-retry";
        console.log(`  ${yellow("↻")} ${error instanceof Error ? error.message : String(error)}`);
        console.log(`  ${muted("Retrying in 5 seconds…")}`);
        await sleep(5_000);
      }
    }
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGHUP", stop);
    await releaseLock?.();
  }
}

export async function loadAgentConfig() {
  return readAgentConfig();
}

export const __test = { cleanId, cleanRelay, safeWorkspace, safeRelative, selectExecutable, cmdQuote, engineFor, providerModel, transcript, previewEntry, previewPortFor, previewPortFromPrompt, previewHostArgs, previewListenerPidsFromNetstat, privateLanAddress, startPreviewServer, sweepPreviewServers, streamSeparator, specialistPlan, processIsAlive, acquireRuntimeLock, deviceAuthorize, setModernConsoleFont };

runAgentCli().catch((error) => {
  console.error("\n  Hyzr stopped —", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
