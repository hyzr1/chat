import { createHash } from "crypto";
import type { Plan } from "./planner";
import { classifyComplexity } from "./local-router";

export type DeliverySource =
  | { kind: "chat" }
  | { kind: "github"; repo: string; issueNumber: number; url?: string }
  | { kind: "linear"; issueId: string; identifier?: string; url?: string };

export interface DeliveryContract {
  id: string;
  objective: string;
  source: DeliverySource;
  requirements: string[];
  acceptanceCriteria: string[];
  evidence: string[];
  constraints: string[];
  budget: {
    tokenBudget: number;
    maxAttempts: number;
    maxSpecialists: number;
  };
  permissions: {
    workspaceWrite: boolean;
    commands: boolean;
    network: boolean;
    publish: boolean;
  };
  createdAt: number;
}

function sentences(value: string) {
  return value
    .replace(/^\[Space:[^\]]+\]\s*/i, "")
    .split(/(?:\r?\n|(?<=[.!?])\s+)/)
    .map((part) => part.replace(/^[-*]\s*/, "").trim())
    .filter((part) => part.length >= 4)
    .slice(0, 8);
}

function has(value: string, pattern: RegExp) {
  return pattern.test(value.toLowerCase());
}

export function deriveDeliveryContract(prompt: string, plan?: Plan, source: DeliverySource = { kind: "chat" }): DeliveryContract {
  if (source.kind === "chat") {
    const github = prompt.match(/(?:github issue\s+([\w.-]+\/[\w.-]+)#(\d+)|github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+))/i);
    const linear = prompt.match(/(?:linear issue\s+([A-Z][A-Z0-9]+-\d+)|linear\.app\/[^\s/]+\/issue\/([A-Z][A-Z0-9]+-\d+))/i);
    if (github) source = { kind: "github", repo: github[1] || github[3], issueNumber: Number(github[2] || github[4]), url: prompt.match(/https?:\/\/github\.com\/[^\s)]+/i)?.[0] };
    else if (linear) source = { kind: "linear", issueId: linear[1] || linear[2], identifier: linear[1] || linear[2], url: prompt.match(/https?:\/\/linear\.app\/[^\s)]+/i)?.[0] };
  }
  const objective = plan?.intent?.trim() || sentences(prompt)[0] || "Complete the requested engineering work";
  const complexity = plan?.complexity ?? classifyComplexity(prompt);
  const requirements = Array.from(new Set([
    ...sentences(prompt),
    ...(plan?.subtasks ?? []).map((task) => task.title),
  ])).slice(0, 12);
  const acceptanceCriteria = [
    "The requested behavior is implemented in the current project workspace.",
    "Existing project behavior outside the requested scope is preserved.",
    has(prompt, /(?:ui|website|web app|frontend|mobile|responsive|design)/) ? "The primary user flow is visually verified at desktop and mobile widths." : "The changed behavior is exercised with an appropriate verification command.",
    has(prompt, /(?:bug|fix|error|broken|regression)/) ? "The reported failure is reproduced before the change and no longer reproduces afterward." : "The project builds or its relevant validation command passes.",
    "Completion is supported by concise evidence rather than an unverified claim.",
  ];
  const evidence = [
    "Changed-file summary",
    "Validation command and result",
    ...(has(prompt, /(?:ui|website|web app|frontend|mobile|responsive|design)/) ? ["Responsive browser verification or screenshot"] : []),
    ...(has(prompt, /(?:api|security|authentication|database)/) ? ["Boundary and failure-path review"] : []),
  ];
  const tokenBudget = complexity === "hard" ? 120_000 : complexity === "trivial" ? 12_000 : 45_000;
  const hash = createHash("sha256").update(JSON.stringify({ objective, source, requirements })).digest("hex").slice(0, 16);
  return {
    id: `contract-${hash}`,
    objective,
    source,
    requirements,
    acceptanceCriteria,
    evidence,
    constraints: [
      "Use only the current chat and its isolated workspace as project context.",
      "Prefer the smallest sufficient context and the cheapest model likely to satisfy the contract.",
      "Do not publish, deploy, merge, or message external systems without explicit approval.",
    ],
    budget: {
      tokenBudget,
      maxAttempts: complexity === "hard" ? 3 : 2,
      maxSpecialists: Math.max(1, Math.min(plan?.subtasks?.length || 1, complexity === "hard" ? 4 : 2)),
    },
    permissions: { workspaceWrite: true, commands: true, network: true, publish: false },
    createdAt: Date.now(),
  };
}

export function contractContext(contract: DeliveryContract) {
  return [
    "DELIVERY CONTRACT",
    `Objective: ${contract.objective}`,
    `Acceptance: ${contract.acceptanceCriteria.join(" | ")}`,
    `Required evidence: ${contract.evidence.join(" | ")}`,
    `Budget: ${contract.budget.tokenBudget.toLocaleString()} tokens across at most ${contract.budget.maxSpecialists} specialist(s).`,
    "Treat this contract as the definition of done. Keep progress messages concise and spend context only on files relevant to the current subtask.",
  ].join("\n");
}

export function specialistContractContext(contract: DeliveryContract, assignment: string) {
  const relevant = contract.acceptanceCriteria.filter((criterion) => {
    if (/(?:ui|frontend|mobile|responsive|design|browser)/i.test(assignment)) return /(?:visual|desktop|mobile|requested behavior|evidence)/i.test(criterion);
    if (/(?:bug|debug|test|review|security)/i.test(assignment)) return /(?:failure|validation|build|evidence|requested behavior)/i.test(criterion);
    return /(?:requested behavior|build|validation|evidence)/i.test(criterion);
  }).slice(0, 3);
  return [
    "SPECIALIST DELIVERY SLICE",
    `Objective: ${contract.objective}`,
    `Assignment: ${assignment}`,
    `Done when: ${(relevant.length ? relevant : contract.acceptanceCriteria.slice(0, 2)).join(" | ")}`,
    "Leave final cross-project verification to Hyzr Chat; perform only the narrow check needed for this assignment.",
  ].join("\n");
}
