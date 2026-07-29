import { promises as fs } from "fs";
import path from "path";
import { route } from "./router";
import { runModel, type ChatMessage, type Keys } from "./providers";
import { BASELINE_MODEL_ID, estimateCost, type Provider } from "./models";
import { routeLocal, type RoutingRules } from "./local-router";
import { runLocal, buildPrompt, buildRoutingContext } from "./local-runner";
import { analyze, type Plan } from "./planner";
import { LOCAL_MODELS, normalizeEffort } from "./local-models";
import { appendRunEvent, beginRun, configureRun, finishRun, getRun } from "./run-registry";
import { contractContext, deriveDeliveryContract, specialistContractContext } from "./delivery-contract";
import { buildRepositoryIntelligence, repositoryContext, repositoryTaskContext } from "./repository-intelligence";
import { requestRequiresWorkspaceMutation, verifyWorkspace } from "./verifier";
import { checkpointDurableJob, finishDurableJob, getDurableJob } from "./durable-jobs";
import { commentOnGithubIssue, prepareGithubWorktree, publishGithubDelivery, publishGithubRegressionCheck, type GitHubDeliverySource } from "./github-app";
import { synchronizeLinearDelivery, type LinearDeliverySource } from "./linear-integration";
import { ExecutionBudget, executionLimits } from "./execution-budget";
import { STATE_DIRECTORY } from "./product-paths";
import { productEnv } from "./product";
import { hydratedRuntimeSkillContext, resolveRuntimeSkills } from "./skill-runtime";
import { buildWorkspaceHandoff, snapshotWorkspace } from "./workspace-handoff";
import { projectMemoryContext, readProjectMemory, updateProjectMemory } from "./project-memory";
import { readRoutingFeedbackSamples } from "./routing-feedback-store";
import { tryNativeExecution } from "./native-executor";

export interface ChatJobPayload {
  messages: ChatMessage[];
  keys: Keys;
  override?: string;
  mode?: "local" | "byok";
  plan?: boolean;
  images?: { name: string; dataUrl: string }[];
  enabledModelIds?: string[];
  sessionId?: string;
  runId?: string;
  routingPlan?: Plan;
  effort?: string;
  preferences?: { language?: string; autoReview?: boolean; adaptiveRouting?: boolean };
  routingRules?: RoutingRules;
  delivery?: { github?: GitHubDeliverySource; linear?: LinearDeliverySource };
  verificationOnly?: boolean;
}

function autoEffort(requested: string | undefined, tier: string) {
  const order = ["low", "medium", "high", "xhigh", "max", "ultra"];
  const cap = tier === "trivial" ? "low" : tier === "standard" ? "medium" : (requested || "high");
  return order[Math.min(Math.max(0, order.indexOf(requested || "high")), Math.max(0, order.indexOf(cap)))];
}

function localUsage(modelId: string, chunk: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheCreationTokens?: number }) {
  const inputTokens = chunk.inputTokens || 0;
  const outputTokens = chunk.outputTokens || 0;
  const cacheReadTokens = chunk.cacheReadTokens || 0;
  const cacheCreationTokens = chunk.cacheCreationTokens || 0;
  const model = LOCAL_MODELS[modelId];
  const totalTokens = inputTokens + outputTokens + (model?.engine === "claude" ? cacheReadTokens + cacheCreationTokens : 0);
  let prices: Record<string, { input: number; output: number }> = {};
  try { prices = JSON.parse(productEnv("HYZR_CHAT_MODEL_PRICING_JSON", "VMX_MODEL_PRICING_JSON") || "{}"); } catch {}
  const calculate = (id: string) => prices[id]
    ? inputTokens / 1_000_000 * prices[id].input + outputTokens / 1_000_000 * prices[id].output
    : undefined;
  const routedCost = calculate(modelId);
  const baselineCost = calculate(productEnv("HYZR_CHAT_BASELINE_MODEL_ID", "VMX_BASELINE_MODEL_ID") || "gpt-5.6-sol");
  return {
    type: "usage", inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, totalTokens,
    ...(routedCost !== undefined ? { routedCost } : {}),
    ...(baselineCost !== undefined ? { baselineCost, saved: Math.max(0, baselineCost - (routedCost || 0)) } : {}),
  };
}

async function materializeImages(runId: string, images?: { name: string; dataUrl: string }[]) {
  if (!images?.length) return [];
  const directory = path.join(STATE_DIRECTORY, "job-assets", runId.replace(/[^a-zA-Z0-9_-]/g, ""));
  await fs.mkdir(directory, { recursive: true });
  const output: string[] = [];
  for (let index = 0; index < images.length; index++) {
    const match = images[index].dataUrl.match(/^data:image\/(\w+);base64,(.+)$/s);
    if (!match) continue;
    const extension = match[1] === "jpeg" ? "jpg" : match[1];
    const file = path.join(directory, `${String(index).padStart(2, "0")}.${extension}`);
    await fs.writeFile(file, Buffer.from(match[2], "base64"));
    output.push(file);
  }
  return output;
}

export async function executeChatJob(runId: string, body: ChatJobPayload) {
  const workspaceId = body.sessionId || runId;
  const run = beginRun(runId, workspaceId);
  const send = (payload: Record<string, unknown>) => {
    const event = appendRunEvent(runId, payload);
    if (payload.type === "task_done") checkpointDurableJob(runId, Number(payload.index) || 0);
    return event;
  };
  const imagePaths = await materializeImages(runId, body.images);
  if (body.delivery?.github) {
    const prepared = await prepareGithubWorktree(body.delivery.github, workspaceId, runId);
    send({ type: "delivery_status", provider: "github", stage: "worktree_ready", branch: prepared.branch });
  }
  if (body.delivery?.linear) {
    await synchronizeLinearDelivery(body.delivery.linear, "started", `Durable Hyzr Chat run \`${runId}\` started. Progress survives browser disconnects and worker restarts.`);
    send({ type: "delivery_status", provider: "linear", stage: "started", issue: body.delivery.linear.issueIdentifier });
  }
  if (body.verificationOnly) {
    send({ type: "verification_start", text: "Running post-merge regression verification" });
    const verification = await verifyWorkspace(workspaceId);
    for (const check of verification.checks) send({ type: "verification_result", check });
    if (body.delivery?.github?.postMerge) {
      const summary = verification.checks.map((check) => `${check.status === "passed" ? "PASS" : check.status === "failed" ? "FAIL" : "SKIP"} — ${check.label}${check.output ? `\n${check.output.slice(0, 2000)}` : ""}`).join("\n\n");
      const check = await publishGithubRegressionCheck(body.delivery.github, verification.passed, summary);
      send({ type: "delivery_status", provider: "github", stage: "post_merge_check", url: check.html_url, verified: verification.passed });
    }
    send(verification.passed ? { type: "done" } : { type: "needs_attention", message: "Post-merge regression verification failed." });
    finishDurableJob(runId, verification.passed ? "completed" : "needs_attention", verification.passed ? undefined : "Post-merge regression verification failed.");
    finishRun(runId);
    return;
  }
  const { messages, keys, override, mode, plan } = body;
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  const prompt = lastUser?.content ?? "";
  const chatContext = buildRoutingContext(messages);
  const resumeAfter = getDurableJob(runId)?.checkpointTask ?? -1;
  let verificationBaseline: string | undefined;
  const requireWorkspaceMutation = requestRequiresWorkspaceMutation(prompt);

  const completeWithVerification = async () => {
    send({ type: "verification_start", text: "Running independent delivery checks" });
    const verification = await verifyWorkspace(workspaceId, { baselineFingerprint: verificationBaseline, requireMutation: requireWorkspaceMutation });
    for (const check of verification.checks) send({ type: "verification_result", check });
    if (!verification.passed) {
      if (body.delivery?.github) {
        const delivery = await publishGithubDelivery(body.delivery.github, workspaceId, runId, false);
        await commentOnGithubIssue(body.delivery.github, `Hyzr Chat opened ${delivery.pull.html_url}, but independent verification failed. Review the Check Run evidence before merging.`);
        send({ type: "delivery_status", provider: "github", stage: "pull_request", url: delivery.pull.html_url, verified: false });
      }
      if (body.delivery?.linear) await synchronizeLinearDelivery(body.delivery.linear, "failed", `Run \`${runId}\` completed implementation, but independent verification failed.`);
      send({ type: "needs_attention", message: "The implementation finished, but an independent verification check failed. Review the evidence before accepting this delivery." });
      finishDurableJob(runId, "needs_attention", "Independent verification failed.");
      finishRun(runId);
      return false;
    }
    send({ type: "verification_complete", passed: true, evidenceCount: verification.checks.length });
    if (body.delivery?.github) {
      const delivery = await publishGithubDelivery(body.delivery.github, workspaceId, runId, true);
      await commentOnGithubIssue(body.delivery.github, `Hyzr Chat completed this issue and opened ${delivery.pull.html_url}. Independent verification passed.`);
      send({ type: "delivery_status", provider: "github", stage: "pull_request", url: delivery.pull.html_url, verified: true });
    }
    if (body.delivery?.linear) {
      await synchronizeLinearDelivery(body.delivery.linear, "verified", `Run \`${runId}\` passed independent verification. Delivery evidence is available in Hyzr Chat.`);
      send({ type: "delivery_status", provider: "linear", stage: "verified", issue: body.delivery.linear.issueIdentifier });
    }
    return true;
  };

  if (mode === "local") {
    let plannedTier: string | undefined;
    let plannedModelId: string | undefined;
    let plannedSubtasks: Plan["subtasks"] | undefined;
    const persistedPlan = getRun(runId)?.events.find((event) => event.type === "plan")?.plan as Plan | undefined;
    let resolvedPlan: Plan | undefined = body.routingPlan || persistedPlan;
    const enabledIds = (body.enabledModelIds?.length ? body.enabledModelIds : Object.keys(LOCAL_MODELS)).filter((id) => LOCAL_MODELS[id]);
    const adaptiveSamples = body.preferences?.adaptiveRouting === false ? [] : readRoutingFeedbackSamples();
    if (resolvedPlan && (!override || override === "auto")) {
      plannedTier = resolvedPlan.complexity;
      plannedModelId = resolvedPlan.executorModelId;
      plannedSubtasks = resolvedPlan.subtasks;
    } else if (plan && (!override || override === "auto")) {
      send({ type: "planner_status", text: "Planner is analyzing your request" });
      const generated = await analyze(
        `Use only this current chat as context. Route the final user request in light of the project established earlier in this chat:\n\n${chatContext}`,
        enabledIds,
        run.abort.signal,
        body.routingRules,
        adaptiveSamples,
      );
      plannedTier = generated.complexity;
      plannedModelId = generated.executorModelId;
      plannedSubtasks = generated.subtasks;
      resolvedPlan = generated;
      send({ type: "plan", plan: generated });
    }

    const deliveryContract = getRun(runId)?.contract || deriveDeliveryContract(prompt, resolvedPlan);
    configureRun(runId, { contract: deliveryContract });
    send({ type: "contract", contract: deliveryContract });
    const repositoryMap = await buildRepositoryIntelligence(workspaceId);
    const persistedRepository = run.events.find((event) => event.type === "repository_map")?.repository as { fingerprint?: string } | undefined;
    verificationBaseline = persistedRepository?.fingerprint || repositoryMap.fingerprint;
    send({ type: "repository_map", repository: {
      files: repositoryMap.files,
      directories: repositoryMap.directories,
      languages: repositoryMap.languages,
      frameworks: repositoryMap.frameworks,
      validationCommands: repositoryMap.validationCommands,
      fingerprint: repositoryMap.fingerprint,
    } });
    const preferenceNotes = [
      body.preferences?.language && body.preferences.language !== "Auto detect" ? `Reply in ${body.preferences.language}.` : "",
      body.preferences?.autoReview ? "Before finishing, review your work for correctness, regressions, and incomplete requirements; fix issues you find." : "",
    ].filter(Boolean).join(" ");
    const existingProjectMemory = await readProjectMemory(workspaceId);
    const memoryContext = projectMemoryContext(existingProjectMemory);
    await updateProjectMemory(workspaceId, { prompt });
    const rawConversationCharacters = messages.reduce((total, message) => total + message.content.length, 0);
    const boundedConversation = buildPrompt(messages);
    const avoidedConversationCharacters = Math.max(0, rawConversationCharacters - boundedConversation.length);
    send({
      type: "context_optimization",
      rawCharacters: rawConversationCharacters,
      sentCharacters: boundedConversation.length,
      avoidedCharacters: avoidedConversationCharacters,
      reductionRate: rawConversationCharacters ? avoidedConversationCharacters / rawConversationCharacters : 0,
    });
    const fullPrompt = `${boundedConversation}\n\n${contractContext(deliveryContract)}\n\n${repositoryContext(repositoryMap)}${memoryContext ? `\n\n${memoryContext}` : ""}${preferenceNotes ? `\n\nUSER PREFERENCES:\n${preferenceNotes}` : ""}`;
    const specialistConversation = buildPrompt(lastUser ? [lastUser] : messages.slice(-1));
    const alreadyUsed = run.events
      .filter((event) => event.type === "usage")
      .reduce((total, event) => total + (Number(event.totalTokens) || Number(event.inputTokens) + Number(event.outputTokens) || 0), 0);
    const executionBudget = new ExecutionBudget(deliveryContract, alreadyUsed);
    const emitBudget = (reason = "Execution budget active") => send({ type: "budget_update", ...executionBudget.snapshot(), reason });
    emitBudget();

    const stopForBudget = (message: string) => {
      send({ type: "budget_exceeded", ...executionBudget.snapshot(), message });
      send({ type: "needs_attention", message: `${message}. Completed workspace changes were preserved; continue explicitly if another pass is worth the cost.` });
      finishDurableJob(runId, "needs_attention", message);
      finishRun(runId);
    };

    const native = await tryNativeExecution(prompt, workspaceId);
    if (native.handled) {
      send({
        type: "route",
        modelId: "hyzr-native",
        modelLabel: "Hyzr Chat Native",
        provider: "hyzr",
        tier: "trivial",
        capability: native.kind,
        reason: "Deterministic operation selected to avoid an unnecessary model call.",
        signals: ["zero-model fast path"],
      });
      send({ type: "task_start", index: 0, title: native.title, capability: native.kind, modelId: "hyzr-native", modelLabel: "Hyzr Chat Native", provider: "hyzr", tier: "trivial" });
      send({ type: "native_execution", kind: native.kind, tokenSavingsPolicy: "No provider call", evidence: native.evidence });
      send({ type: "text", text: native.summary || "Mechanical task completed without a model call.", modelId: "hyzr-native", modelLabel: "Hyzr Chat Native", tier: "trivial" });
      send({ type: "task_evidence", taskIndex: 0, mutationCount: native.changedFiles?.length || 0, created: native.changedFiles || [], changed: [], deleted: [] });
      send({ type: "task_done", index: 0, title: native.title });
      checkpointDurableJob(runId, 0);
      if (!native.success) {
        send({ type: "needs_attention", message: native.summary || "The deterministic readiness check could not complete." });
        finishDurableJob(runId, "needs_attention", native.summary || "Native operation needs attention.");
        finishRun(runId);
        return;
      }
      if (await completeWithVerification()) {
        send({ type: "done" });
        finishDurableJob(runId, "completed");
        finishRun(runId);
      }
      return;
    }

    const streamLocalTask = async (
      model: (typeof LOCAL_MODELS)[string],
      tier: string,
      taskPrompt: string,
      metadata: Record<string, unknown>,
    ) => {
      const limits = executionLimits(tier);
      let textBuffer = "";
      let lastStatus = "";
      const flushText = () => {
        if (!textBuffer) return;
        send({ type: "text", text: textBuffer, ...metadata, modelId: model.id, modelLabel: model.label, tier });
        textBuffer = "";
      };
      for await (const chunk of runLocal(model.engine, model.model, taskPrompt, {
        images: imagePaths,
        workspaceId,
        effort: normalizeEffort(model, autoEffort(body.effort, tier)),
        signal: run.abort.signal,
        maxDurationMs: limits.maxDurationMs,
        maxActivityEvents: limits.maxActivityEvents,
        maxAttempts: limits.maxProviderAttempts,
      })) {
        if (run.abort.signal.aborted) throw new DOMException("Run stopped", "AbortError");
        if (chunk.type === "text") {
          textBuffer += chunk.text || "";
          if (textBuffer.length >= 240) flushText();
          continue;
        }
        flushText();
        if (chunk.type === "error") {
          if (chunk.code === "execution_budget") return { completed: false, reason: chunk.message || "Execution ceiling reached" };
          throw new Error(chunk.message || "Model run failed.");
        }
        if (chunk.type === "usage") {
          const usage = localUsage(model.id, chunk);
          send({ ...usage, ...metadata, modelId: model.id, modelLabel: model.label, tier });
          executionBudget.recordTotal(usage.totalTokens);
          emitBudget(executionBudget.snapshot().state === "exhausted" ? "Token ceiling reached" : "Measured provider usage updated");
        } else if (chunk.type !== "status" || chunk.text !== lastStatus) {
          if (chunk.type === "status") lastStatus = chunk.text || "";
          send({ ...chunk, ...metadata, modelId: model.id, modelLabel: model.label, tier });
        }
      }
      flushText();
      return { completed: true, reason: "" };
    };

    if (plannedSubtasks?.length && (!override || override === "auto")) {
      let previousHandoff = "";
      for (let index = 0; index < plannedSubtasks.length; index++) {
        if (index <= resumeAfter) continue;
        if (run.abort.signal.aborted) throw new DOMException("Run stopped", "AbortError");
        if (!executionBudget.canStartAnotherTask()) {
          stopForBudget("The measured token ceiling was reached before the next specialist could start");
          return;
        }
        const task = plannedSubtasks[index];
        const model = LOCAL_MODELS[task.modelId] ?? LOCAL_MODELS[plannedModelId!];
        if (!model) continue;
        const skills = await resolveRuntimeSkills(`${prompt}\n${task.title}`, model.engine, workspaceId);
        const hydratedSkills = await hydratedRuntimeSkillContext(skills);
        if (skills.length) send({ type: "skill_activation", taskIndex: index, skills: skills.map((skill) => ({ name: skill.name, source: skill.source })), instructionCharacters: hydratedSkills.instructionCharacters, referencesLoaded: hydratedSkills.referencesLoaded });
        send({ type: "task_start", index, title: task.title, capability: task.capability, modelId: model.id, modelLabel: model.label, provider: model.engine, plan: model.plan, tier: task.tier, routingTrace: task.routingTrace });
        const before = await snapshotWorkspace(workspaceId);
        const focusedPrompt = `${specialistConversation}\n\n${specialistContractContext(deliveryContract, task.title)}\n\n${repositoryTaskContext(repositoryMap, task.title)}${memoryContext ? `\n\n${memoryContext}` : ""}${preferenceNotes ? `\n\nUSER PREFERENCES:\n${preferenceNotes}` : ""}${hydratedSkills.context ? `\n\n${hydratedSkills.context}` : ""}${previousHandoff ? `\n\n${previousHandoff}` : ""}\n\nYou are specialist ${index + 1} of ${plannedSubtasks.length}. Capability: ${task.capability ?? "general execution"}. Selection rationale: ${task.rationale ?? "workload fit"}. Change only what this subtask requires, do not repeat earlier specialists, and finish with concise evidence.`;
        const taskResult = await streamLocalTask(model, task.tier, focusedPrompt, { taskIndex: index });
        if (!taskResult.completed) {
          stopForBudget(taskResult.reason);
          return;
        }
        const handoff = buildWorkspaceHandoff(before, await snapshotWorkspace(workspaceId));
        previousHandoff = handoff.context;
        await updateProjectMemory(workspaceId, { artifacts: [...handoff.created, ...handoff.changed] });
        send({ type: "workspace_handoff", taskIndex: index, created: handoff.created.slice(0, 16), changed: handoff.changed.slice(0, 16), deleted: handoff.deleted.slice(0, 16) });
        send({ type: "task_evidence", taskIndex: index, mutationCount: handoff.created.length + handoff.changed.length + handoff.deleted.length, created: handoff.created.slice(0, 8), changed: handoff.changed.slice(0, 8), deleted: handoff.deleted.slice(0, 8) });
        send({ type: "task_done", index, title: task.title });
      }
      if (await completeWithVerification()) {
        send({ type: "done" });
        finishDurableJob(runId, "completed");
        finishRun(runId);
      }
      return;
    }

    if (resumeAfter >= 0) {
      if (await completeWithVerification()) {
        send({ type: "done" });
        finishDurableJob(runId, "completed");
        finishRun(runId);
      }
      return;
    }
    const decision = plannedModelId && LOCAL_MODELS[plannedModelId] && (!override || override === "auto")
      ? { model: LOCAL_MODELS[plannedModelId], tier: (plannedTier ?? LOCAL_MODELS[plannedModelId].tier) as "trivial" | "standard" | "hard", reason: "", signals: [] }
      : routeLocal(prompt, override, enabledIds, body.routingRules, adaptiveSamples);
    send({ type: "route", modelId: decision.model.id, modelLabel: decision.model.label, provider: decision.model.engine, plan: decision.model.plan, tier: decision.tier, capability: "capability" in decision ? decision.capability : undefined, reason: decision.reason, signals: decision.signals, routingTrace: "routingTrace" in decision ? decision.routingTrace : undefined });
    const skills = await resolveRuntimeSkills(prompt, decision.model.engine, workspaceId);
    const hydratedSkills = await hydratedRuntimeSkillContext(skills);
    if (skills.length) send({ type: "skill_activation", skills: skills.map((skill) => ({ name: skill.name, source: skill.source })), instructionCharacters: hydratedSkills.instructionCharacters, referencesLoaded: hydratedSkills.referencesLoaded });
    const routePrompt = `${fullPrompt}${hydratedSkills.context ? `\n\n${hydratedSkills.context}` : ""}`;
    const routeBefore = await snapshotWorkspace(workspaceId);
    const routeResult = await streamLocalTask(decision.model, decision.tier, routePrompt, {});
    if (!routeResult.completed) {
      stopForBudget(routeResult.reason);
      return;
    }
    const routeHandoff = buildWorkspaceHandoff(routeBefore, await snapshotWorkspace(workspaceId));
    await updateProjectMemory(workspaceId, { artifacts: [...routeHandoff.created, ...routeHandoff.changed] });
    send({ type: "task_evidence", taskIndex: 0, mutationCount: routeHandoff.created.length + routeHandoff.changed.length + routeHandoff.deleted.length, created: routeHandoff.created.slice(0, 8), changed: routeHandoff.changed.slice(0, 8), deleted: routeHandoff.deleted.slice(0, 8) });
    checkpointDurableJob(runId, 0);
    if (await completeWithVerification()) {
      send({ type: "done" });
      finishDurableJob(runId, "completed");
      finishRun(runId);
    }
    return;
  }

  const available: Provider[] = [];
  if (keys.anthropic) available.push("anthropic");
  if (keys.openai) available.push("openai");
  const decision = route(prompt, available, override);
  const deliveryContract = getRun(runId)?.contract || deriveDeliveryContract(prompt);
  configureRun(runId, { contract: deliveryContract });
  send({ type: "contract", contract: deliveryContract });
  send({ type: "route", modelId: decision.model.id, modelLabel: decision.model.label, provider: decision.model.provider, tier: decision.tier, reason: decision.reason, signals: decision.signals });
  for await (const chunk of runModel(decision.model.id, messages, keys)) {
    if (chunk.type === "error") throw new Error(chunk.message || "Model run failed.");
    if (chunk.type === "usage") {
      const inputTokens = chunk.inputTokens ?? 0;
      const outputTokens = chunk.outputTokens ?? 0;
      const routedCost = estimateCost(decision.model.id, inputTokens, outputTokens);
      const baselineCost = estimateCost(BASELINE_MODEL_ID, inputTokens, outputTokens);
      send({ type: "usage", inputTokens, outputTokens, routedCost, baselineCost, saved: Math.max(0, baselineCost - routedCost) });
    } else send({ ...chunk });
  }
  send({ type: "done" });
  checkpointDurableJob(runId, 0);
  finishDurableJob(runId, "completed");
  finishRun(runId);
}
