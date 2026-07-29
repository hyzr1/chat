import { deriveDeliveryContract, specialistContractContext } from "../lib/delivery-contract";
import { ExecutionBudget, executionLimits } from "../lib/execution-budget";
import { buildPrompt, buildRoutingContext } from "../lib/local-runner";
import { hydratedRuntimeSkillContext, resolveRuntimeSkills, runtimeSkillContext } from "../lib/skill-runtime";
import { buildWorkspaceHandoff } from "../lib/workspace-handoff";
import { repositoryTaskContext, type RepositoryIntelligence } from "../lib/repository-intelligence";
import { requestRequiresWorkspaceMutation } from "../lib/verifier";
import { projectMemoryContext } from "../lib/project-memory";
import { tryNativeExecution } from "../lib/native-executor";
import { promises as fs } from "fs";
import { workspaceFor } from "../lib/workspace";
import { benchmarkTokenCeiling, DEFAULT_BENCHMARK_TOKEN_CEILING } from "../lib/benchmark-engine";
import { analyze } from "../lib/planner";

async function main() {
let failures = 0;
function check(condition: unknown, label: string) {
  console.log(`${condition ? "PASS" : "FAIL"} | ${label}`);
  if (!condition) failures++;
}

const hugeHistory = Array.from({ length: 80 }, (_, index) => ({
  role: index % 2 ? "assistant" as const : "user" as const,
  content: `${index}:`.padEnd(8_000, "x"),
}));
check(buildPrompt(hugeHistory).length < 14_000, "executor context is bounded");
check(buildRoutingContext(hugeHistory).length < 9_000, "planner context is independently bounded");

const contract = deriveDeliveryContract("Build a normal weather app");
const budget = new ExecutionBudget(contract);
check(budget.snapshot().state === "healthy", "new execution starts with a healthy measured budget");
budget.recordTotal(contract.budget.tokenBudget * .85);
check(budget.snapshot().state === "warning", "80 percent utilization raises a budget warning");
budget.recordTotal(contract.budget.tokenBudget * .15);
check(!budget.canStartAnotherTask() && budget.snapshot().state === "exhausted", "token ceiling blocks another specialist");

check(executionLimits("trivial").maxProviderAttempts === 1, "trivial work never retries an expensive provider call");
check(executionLimits("standard").maxDurationMs < executionLimits("hard").maxDurationMs, "runtime ceilings scale with justified complexity");
check(benchmarkTokenCeiling() === DEFAULT_BENCHMARK_TOKEN_CEILING, "paid evaluations have a conservative default global token ceiling");
process.env.HYZR_CHAT_BENCHMARK_TOKEN_CEILING = "64000";
check(benchmarkTokenCeiling() === 64_000, "operators can lower the paid evaluation token ceiling");
delete process.env.HYZR_CHAT_BENCHMARK_TOKEN_CEILING;

const plannerController = new AbortController();
plannerController.abort(new Error("test cancellation"));
let plannerCancellationPropagated = false;
try { await analyze("Design a complex architecture and research its security model", undefined, plannerController.signal); }
catch { plannerCancellationPropagated = true; }
check(plannerCancellationPropagated, "planner cancellation propagates instead of silently starting execution");

const serverSkills = await resolveRuntimeSkills("Restart the existing dev server and verify the port", "codex");
check(serverSkills[0]?.name === "server-operation", "small server operations activate the bounded micro-skill");
check(serverSkills.length <= 2, "progressive disclosure activates at most two relevant skills");
check(runtimeSkillContext(serverSkills).length < 2_000, "activated skill context stays compact");
const hydratedSkills = await hydratedRuntimeSkillContext(serverSkills);
check(hydratedSkills.instructionCharacters < 5_000 && hydratedSkills.referencesLoaded === 0, "activated skill bodies are capped and never preload references");

const handoff = buildWorkspaceHandoff(
  new Map([["index.html", { size: 100, modified: 1 }], ["old.css", { size: 10, modified: 1 }]]),
  new Map([["index.html", { size: 140, modified: 2 }], ["app.js", { size: 30, modified: 1 }]]),
);
check(handoff.changed.includes("index.html") && handoff.created.includes("app.js") && handoff.deleted.includes("old.css"), "specialists receive a deterministic artifact diff instead of repeated transcript summaries");
check(handoff.context.length < 1_000, "specialist handoff is bounded");

const repository: RepositoryIntelligence = {
  workspaceId: "test", generatedAt: 0, root: "", files: 5, directories: 2,
  languages: { TypeScript: 2, CSS: 1 }, frameworks: ["React"],
  entrypoints: ["src/App.tsx"], manifests: ["package.json"], validationCommands: ["npm run test"],
  importantDocs: ["README.md"], structure: ["src/", "src/App.tsx", "src/calendar.css", "src/api.ts", "package.json", "README.md"], fingerprint: "test",
};
const navigation = repositoryTaskContext(repository, "Fix the calendar mobile styling");
check(navigation.includes("src/calendar.css"), "task-aware repository packets prioritize likely files");
check(navigation.length < 1_500, "task-aware repository packets stay bounded");
check(specialistContractContext(contract, "Implement the weather API").length < 1_500, "specialists receive a compact delivery slice instead of the full contract");
check(requestRequiresWorkspaceMutation("Build a weather app"), "implementation requests require repository-delta evidence");
check(!requestRequiresWorkspaceMutation("Explain how this repository works"), "read-only requests do not require a fake file mutation");
check(!requestRequiresWorkspaceMutation("Restart the dev server and make sure the port works"), "server operations do not require an unrelated file mutation");
const memoryContext = projectMemoryContext({ workspaceId: "test", updatedAt: 0, constraints: ["Always use the light theme on mobile."], recentRequests: ["Improve the settings page"], artifacts: ["app/page.tsx"] });
check(memoryContext.includes("Always use the light theme") && memoryContext.length < 3_100, "workspace-scoped project memory preserves constraints inside a hard context bound");

const nativeWorkspace = `native-test-${Date.now()}`;
const nativeHello = await tryNativeExecution("Create a bare hello world index.html with no styling and no JavaScript.", nativeWorkspace);
check(nativeHello.handled && nativeHello.success, "deterministic Hello World path avoids a provider call");
check((await fs.readFile(`${workspaceFor(nativeWorkspace)}/index.html`, "utf8")).includes("Hello world"), "native path produces a complete inspectable artifact");
const nativeServer = await tryNativeExecution("Restart the existing dev server and verify that its port responds.", nativeWorkspace);
check(nativeServer.handled && nativeServer.success, "static preview readiness is verified without an agent loop");
await fs.rm(workspaceFor(nativeWorkspace), { recursive: true, force: true });

if (failures) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
