"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { IconCheck, IconClock, IconGauge, IconRefresh, IconRoute, IconShield, IconSparkles, IconStop } from "../icons";

interface Analytics {
  totalRuns: number;
  ratedRuns: number;
  acceptedRuns: number;
  successRate: number | null;
  tokensPerAcceptedTask: number | null;
  costPerAcceptedTask: number | null;
  ratedModelDecisions: number;
  adaptiveRoutes: number;
  nativeOperations: number;
  avoidedProviderCalls: number;
}

interface BenchmarkArm {
  runs: number;
  accepted: number;
  successRate: number | null;
  tokensPerAcceptedTask: number | null;
  costPerAcceptedTask?: number | null;
  medianLatencyMs: number | null;
  successRateInterval?: { low: number; high: number } | null;
}

interface BenchmarkSummary {
  hyzr?: BenchmarkArm;
  /** Former benchmark reports used the internal VMX arm key. */
  vmx?: BenchmarkArm;
  premium?: BenchmarkArm;
  note?: string;
  routingAccuracy?: number;
}

interface Benchmark {
  id: string;
  mode: "live" | "dry";
  dataset: string;
  createdAt: number;
  summary: BenchmarkSummary;
}

interface EvaluationJob {
  id: string;
  mode: "dry" | "live";
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  dataset: string;
  premiumModelId: string;
  completedRuns: number;
  totalRuns: number;
  result?: { summary?: BenchmarkSummary; results?: unknown[]; trials?: number };
  error?: string;
  createdAt: number;
  updatedAt: number;
}

interface ProofData {
  runs: Analytics;
  routingLearning: { ratedDecisions: number; adaptiveRoutes: number; capabilities: unknown[] };
  jobs: Array<{ status: string; count: number }>;
  delivery: { deliveries: number; human_edits: number; verified: number };
  latestBenchmarks: Benchmark[];
}

interface EvaluationData { dataset: string; cases: number; tokenCeiling: number; jobs: EvaluationJob[] }
interface HealthData {
  status: "ready" | "attention" | "unavailable";
  score: number;
  checkedAt: number;
  server: { version: string; node: string; uptimeSeconds: number; platform: string };
  storage: { databaseBytes: number; journalMode: string };
  checks: Array<{ id: string; category: "core" | "providers" | "integrations" | "evidence"; label: string; detail: string; state: "ready" | "attention" | "unavailable"; blocking: boolean }>;
}

const percent = (value: number | null | undefined) => value == null ? "—" : `${Math.round(value * 100)}%`;
const integer = (value: number | null | undefined) => value == null ? "—" : Math.round(value).toLocaleString();
const money = (value: number | null | undefined) => value == null ? "Not calibrated" : `$${value.toFixed(2)}`;
const terminalStatuses = new Set(["completed", "failed", "cancelled"]);

export default function ProofPanel() {
  const [data, setData] = useState<ProofData | null>(null);
  const [evaluations, setEvaluations] = useState<EvaluationData | null>(null);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState<"dry" | "live" | null>(null);
  const [confirmLive, setConfirmLive] = useState(false);
  const [liveTrials, setLiveTrials] = useState<1 | 3 | 5>(1);
  const [error, setError] = useState("");

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [telemetryResponse, evaluationResponse, healthResponse] = await Promise.all([
        fetch("/api/telemetry", { cache: "no-store" }),
        fetch("/api/benchmarks", { cache: "no-store" }),
        fetch("/api/health", { cache: "no-store" }),
      ]);
      if (!telemetryResponse.ok || !evaluationResponse.ok || (!healthResponse.ok && healthResponse.status !== 503)) throw new Error("Proof telemetry is unavailable.");
      setData(await telemetryResponse.json());
      setEvaluations(await evaluationResponse.json());
      setHealth(await healthResponse.json());
      setError("");
    } catch (loadError: any) {
      setError(String(loadError?.message || loadError));
    } finally { if (!quiet) setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const hasActiveEvaluation = evaluations?.jobs.some((job) => !terminalStatuses.has(job.status)) ?? false;
  useEffect(() => {
    if (!hasActiveEvaluation) return;
    const timer = window.setInterval(() => void load(true), 1600);
    return () => window.clearInterval(timer);
  }, [hasActiveEvaluation, load]);

  const startEvaluation = async (mode: "dry" | "live") => {
    setStarting(mode);
    setError("");
    try {
      const response = await fetch("/api/benchmarks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, confirmPaidRuns: mode === "live", trials: mode === "live" ? liveTrials : 1 }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not start evaluation.");
      setConfirmLive(false);
      await load(true);
    } catch (runError: any) { setError(String(runError?.message || runError)); }
    finally { setStarting(null); }
  };

  const stopEvaluation = async (id: string) => {
    await fetch(`/api/benchmarks/${encodeURIComponent(id)}`, { method: "DELETE" });
    await load(true);
  };

  const analytics = data?.runs;
  const live = data?.latestBenchmarks.find((benchmark) => benchmark.mode === "live" && (benchmark.summary.hyzr || benchmark.summary.vmx) && benchmark.summary.premium);
  const latest = live ?? data?.latestBenchmarks[0];
  const routed = live?.summary.hyzr || live?.summary.vmx;
  const premium = live?.summary.premium;
  const pairedReady = Boolean(routed && premium);
  const jobCount = data?.jobs.reduce((total, row) => total + Number(row.count || 0), 0) ?? 0;
  const acceptedLift = pairedReady && premium!.successRate != null && routed!.successRate != null ? routed!.successRate - premium!.successRate : null;
  const tokenReduction = pairedReady && premium!.tokensPerAcceptedTask && routed!.tokensPerAcceptedTask
    ? 1 - routed!.tokensPerAcceptedTask / premium!.tokensPerAcceptedTask : null;
  const readiness = [
    { label: "Durable execution evidence", detail: `${jobCount} persisted jobs`, ready: jobCount > 0 },
    { label: "Zero-model task automation", detail: `${analytics?.nativeOperations ?? 0} deterministic operations`, ready: (analytics?.nativeOperations ?? 0) > 0 },
    { label: "Rated customer outcomes", detail: `${analytics?.ratedRuns ?? 0} rated deliveries`, ready: (analytics?.ratedRuns ?? 0) >= 20 },
    { label: "Independent verification", detail: `${Number(data?.delivery?.verified ?? 0)} verified deliveries`, ready: Number(data?.delivery?.verified ?? 0) > 0 },
    { label: "Matched premium baseline", detail: pairedReady ? `${routed!.runs + premium!.runs} paired executions` : "Live comparison required", ready: pairedReady },
    { label: "Adaptive routing signal", detail: `${analytics?.adaptiveRoutes ?? 0} evidence-backed routes`, ready: (analytics?.adaptiveRoutes ?? 0) > 0 },
  ];
  const readinessScore = readiness.filter((item) => item.ready).length;
  const recentEvaluations = useMemo(() => evaluations?.jobs.slice(0, 6) ?? [], [evaluations]);

  const exportEvidence = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), product: "Hyzr Chat", evidence: data, evaluations, operationalHealth: health }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `hyzr-chat-diligence-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return <div className="proof-view"><div className="proof-inner">
    <header className="proof-head"><div><span>Measured advantage</span><h1>Proof, not promises.</h1><p>Hyzr Chat is building an evidence trail for accepted engineering outcomes per dollar, with every claim tied to observed runs.</p></div><div className="proof-head-actions"><button onClick={() => load()} disabled={loading}><IconRefresh size={14} className={loading ? "rotating" : ""} /> Refresh</button><button className="primary" onClick={exportEvidence} disabled={!data}><IconShield size={14} /> Export diligence packet</button></div></header>

    {error && <div className="proof-error">{error}</div>}

    <section className="proof-thesis"><div><span className="proof-kicker">Investment thesis</span><h2>Route each unit of work to the cheapest model that can pass its delivery contract.</h2><p>Hyzr Chat combines durable execution, capability routing, repository intelligence, verification, and mobile supervision. The moat is the closed loop between task outcomes and model selection.</p></div><aside><span>Diligence readiness</span><strong>{readinessScore}<small>/ {readiness.length}</small></strong><p>{readinessScore === readiness.length ? "Core evidence package is ready." : `${readiness.length - readinessScore} evidence gates remain.`}</p></aside></section>

    <section className="proof-metrics">
      <div><span>Accepted outcome rate</span><strong>{percent(analytics?.successRate)}</strong><small>{analytics?.ratedRuns ?? 0} rated deliveries</small></div>
      <div><span>Tokens / accepted task</span><strong>{integer(analytics?.tokensPerAcceptedTask)}</strong><small>Measured provider usage</small></div>
      <div><span>Cost / accepted task</span><strong className={analytics?.costPerAcceptedTask == null ? "pending" : ""}>{money(analytics?.costPerAcceptedTask)}</strong><small>Hidden until pricing is configured</small></div>
      <div><span>Learned routes</span><strong>{analytics?.adaptiveRoutes ?? 0}</strong><small>{analytics?.ratedModelDecisions ?? 0} rated model decisions</small></div>
    </section>

    <section className="proof-health">
      <div className="proof-section-head"><div><span>Operational readiness</span><h2>Can Hyzr Chat support a real pilot today?</h2></div><div className={`health-score ${health?.status ?? "attention"}`}><i /><strong>{health?.score ?? 0}%</strong><small>{health?.status === "ready" ? "Core ready" : health?.status === "unavailable" ? "Blocked" : "Setup remains"}</small></div></div>
      <div className="health-check-grid">{health?.checks.map((check) => <article key={check.id}><i className={check.state}>{check.state === "ready" ? <IconCheck size={11} /> : check.state === "unavailable" ? <IconStop size={10} /> : <IconClock size={11} />}</i><div><span>{check.category}</span><strong>{check.label}</strong><p>{check.detail}</p></div></article>) ?? <div className="health-loading">Checking runtime readiness…</div>}</div>
      {health && <div className="health-runtime"><span>Hyzr Chat {health.server.version}</span><span>{health.server.node}</span><span>{health.storage.journalMode} persistence</span><span>{Math.round(health.server.uptimeSeconds / 60)}m server uptime</span><span>{Math.max(1, Math.round(health.storage.databaseBytes / 1024)).toLocaleString()} KB durable state</span></div>}
    </section>

    <section className="proof-lab">
      <div className="proof-section-head proof-lab-head"><div><span>Evaluation lab</span><h2>Continuous routing evidence</h2></div><div><button onClick={() => startEvaluation("dry")} disabled={Boolean(starting)}><IconGauge size={13} /> {starting === "dry" ? "Starting…" : "Run free audit"}</button><button className="primary" onClick={() => setConfirmLive(true)} disabled={Boolean(starting)}><IconSparkles size={13} /> Run live comparison</button></div></div>
      <div className="proof-lab-intro"><p>Each evaluation is checkpointed after every arm. Dry audits validate classification and routing without calling a model. Paid comparisons never resume automatically after a process restart and stop at the configured token ceiling.</p><span>{evaluations?.cases ?? 8} cases · {integer(evaluations?.tokenCeiling)} token ceiling</span></div>
      {confirmLive && <div className="proof-live-confirm"><IconShield size={18} /><div><strong>Confirm paid paired evaluation</strong><p>This can launch up to {(evaluations?.cases ?? 8) * 2 * liveTrials} real model executions, but Hyzr Chat stops after {integer(evaluations?.tokenCeiling)} measured tokens. Partial evidence is saved. A single provider call may report usage only after it finishes.</p><div className="trial-picker" aria-label="Trials per task">{([1, 3, 5] as const).map((count) => <button key={count} className={liveTrials === count ? "on" : ""} onClick={() => setLiveTrials(count)}>{count}× {count === 1 ? "quick" : count === 3 ? "recommended" : "stronger"}</button>)}</div></div><button className="confirm-cancel" onClick={() => setConfirmLive(false)}>Cancel</button><button className="primary confirm-run" onClick={() => startEvaluation("live")} disabled={starting === "live"}>{starting === "live" ? "Starting…" : "Confirm and run"}</button></div>}
      <div className="proof-evaluation-list">
        {recentEvaluations.length ? recentEvaluations.map((job) => {
          const progress = job.totalRuns ? Math.min(1, job.completedRuns / job.totalRuns) : 0;
          const summary = job.result?.summary;
          return <article key={job.id}>
            <i className={`evaluation-status ${job.status}`}>{job.status === "completed" ? <IconCheck size={12} /> : job.status === "running" || job.status === "queued" ? <IconRefresh size={12} className={job.status === "running" ? "rotating" : ""} /> : <IconStop size={11} />}</i>
            <div className="evaluation-main"><div><strong>{job.mode === "live" ? "Live paired benchmark" : "Routing audit"}</strong><em>{job.status.replace("_", " ")}</em></div><small>{job.dataset} · {job.result?.trials ?? 1} trial{(job.result?.trials ?? 1) === 1 ? "" : "s"} · {new Date(job.createdAt).toLocaleString()}</small><div className="evaluation-progress"><span style={{ width: `${progress * 100}%` }} /></div>{job.error && <p>{job.error}</p>}</div>
            <div className="evaluation-result"><strong>{job.completedRuns}/{job.totalRuns}</strong><small>{summary?.routingAccuracy != null ? `${percent(summary.routingAccuracy)} routing accuracy` : job.mode === "live" && (summary?.hyzr || summary?.vmx) ? `${percent((summary.hyzr || summary.vmx)!.successRate)} accepted` : "runs saved"}</small></div>
            {!terminalStatuses.has(job.status) && <button className="evaluation-stop" onClick={() => stopEvaluation(job.id)} aria-label="Stop evaluation"><IconStop size={11} /></button>}
          </article>;
        }) : <div className="proof-lab-empty"><IconGauge size={18} /><span><strong>No evaluations yet</strong><small>Run a free routing audit to create the first reproducible evidence record.</small></span></div>}
      </div>
    </section>

    <section className="proof-comparison">
      <div className="proof-section-head"><div><span>Matched benchmark</span><h2>Hyzr Chat routing vs premium-only</h2></div>{latest && <em>{latest.dataset} · {new Date(latest.createdAt).toLocaleDateString()}</em>}</div>
      {pairedReady ? <>
        <div className="proof-arms"><article className="hyzr"><span>Hyzr Chat routing</span><strong>{percent(routed!.successRate)}</strong><p>success rate {routed!.successRateInterval && <em>95% CI {percent(routed!.successRateInterval.low)}–{percent(routed!.successRateInterval.high)}</em>}</p><div><b>{integer(routed!.tokensPerAcceptedTask)}</b> tokens / accepted task</div><div><b>{money(routed!.costPerAcceptedTask)}</b> cost / accepted task</div><small>{routed!.accepted}/{routed!.runs} accepted · {integer(routed!.medianLatencyMs)} ms median</small></article><article><span>Premium model only</span><strong>{percent(premium!.successRate)}</strong><p>success rate {premium!.successRateInterval && <em>95% CI {percent(premium!.successRateInterval.low)}–{percent(premium!.successRateInterval.high)}</em>}</p><div><b>{integer(premium!.tokensPerAcceptedTask)}</b> tokens / accepted task</div><div><b>{money(premium!.costPerAcceptedTask)}</b> cost / accepted task</div><small>{premium!.accepted}/{premium!.runs} accepted · {integer(premium!.medianLatencyMs)} ms median</small></article></div>
        <div className="proof-delta"><span><IconRoute size={15} /> Acceptance lift <strong>{acceptedLift == null ? "—" : `${acceptedLift >= 0 ? "+" : ""}${Math.round(acceptedLift * 100)} pts`}</strong></span><span><IconGauge size={15} /> Token reduction <strong>{percent(tokenReduction)}</strong></span></div>
      </> : <div className="proof-calibration"><span><IconGauge size={21} /></span><div><h3>Live paired benchmark required</h3><p>{latest?.summary.note ?? "Hyzr Chat will not make success-rate or savings claims until both arms execute the same dataset."}</p><small>Use the Evaluation Lab above when you are ready to spend provider quota.</small></div></div>}
    </section>

    <div className="proof-bottom-grid"><section className="proof-readiness"><div className="proof-section-head"><div><span>Diligence gates</span><h2>What an investor can verify</h2></div></div>{readiness.map((item) => <div key={item.label}><i className={item.ready ? "ready" : ""}>{item.ready ? <IconCheck size={12} /> : <IconClock size={12} />}</i><span><strong>{item.label}</strong><small>{item.detail}</small></span><em>{item.ready ? "Ready" : "Collecting"}</em></div>)}</section>
    <section className="proof-method"><div className="proof-section-head"><div><span>Method</span><h2>Claim discipline</h2></div></div><div><b>01</b><span><strong>Same task set</strong><small>Hyzr Chat and the premium baseline execute identical prompts.</small></span></div><div><b>02</b><span><strong>Acceptance first</strong><small>Failed tasks never make cheap token usage look efficient.</small></span></div><div><b>03</b><span><strong>Evidence attached</strong><small>Tests, workspace mutations, latency, and provider usage stay auditable.</small></span></div><div><b>04</b><span><strong>No synthetic ROI</strong><small>Dollar savings remain hidden until pricing and paired outcomes exist.</small></span></div></section></div>
  </div></div>;
}
