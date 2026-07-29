import type { DeliveryContract } from "./delivery-contract";
import type { LocalModel, Tier } from "./local-models";

export type BudgetState = "healthy" | "warning" | "exhausted";

export interface ExecutionLimits {
  maxDurationMs: number;
  maxActivityEvents: number;
  maxProviderAttempts: number;
}

export interface BudgetSnapshot {
  tokenBudget: number;
  usedTokens: number;
  remainingTokens: number;
  utilization: number;
  state: BudgetState;
  source: "measured";
}

const LIMITS: Record<Tier, ExecutionLimits> = {
  trivial: { maxDurationMs: 60_000, maxActivityEvents: 14, maxProviderAttempts: 1 },
  standard: { maxDurationMs: 240_000, maxActivityEvents: 56, maxProviderAttempts: 2 },
  hard: { maxDurationMs: 480_000, maxActivityEvents: 110, maxProviderAttempts: 2 },
};

export function executionLimits(tier: string): ExecutionLimits {
  return LIMITS[tier === "trivial" || tier === "hard" ? tier : "standard"];
}

export function isPremiumModel(model: LocalModel | undefined) {
  return model?.tier === "hard";
}

export class ExecutionBudget {
  private used = 0;

  constructor(private readonly contract: DeliveryContract, alreadyUsed = 0) {
    this.used = Math.max(0, alreadyUsed);
  }

  record(inputTokens = 0, outputTokens = 0) {
    this.used += Math.max(0, inputTokens) + Math.max(0, outputTokens);
    return this.snapshot();
  }

  recordTotal(tokens = 0) {
    this.used += Math.max(0, tokens);
    return this.snapshot();
  }

  canStartAnotherTask() {
    return this.used < this.contract.budget.tokenBudget;
  }

  snapshot(): BudgetSnapshot {
    const tokenBudget = Math.max(1, this.contract.budget.tokenBudget);
    const utilization = this.used / tokenBudget;
    return {
      tokenBudget,
      usedTokens: this.used,
      remainingTokens: Math.max(0, tokenBudget - this.used),
      utilization,
      state: utilization >= 1 ? "exhausted" : utilization >= 0.8 ? "warning" : "healthy",
      source: "measured",
    };
  }
}
