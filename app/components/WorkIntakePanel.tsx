"use client";

import { useEffect, useMemo, useState } from "react";
import GithubPanel from "./GithubPanel";
import { IconArrowRight, IconGithub, IconLayers, IconSearch, IconSparkles } from "../icons";

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  url: string;
  priority?: number;
  state?: { name: string; type: string; color?: string };
  team?: { name: string; key: string };
  labels?: { nodes: { id: string; name: string; color?: string }[] };
}

export default function WorkIntakePanel({
  linearKey,
  onUseFile,
  onUseGithubIssue,
  onUseLinearIssue,
}: {
  linearKey?: string;
  onUseFile: (path: string, content: string) => void;
  onUseGithubIssue: (issue: { number: number; title: string; body?: string; url: string }, repo: string) => void;
  onUseLinearIssue: (issue: LinearIssue) => void;
}) {
  const [source, setSource] = useState<"github" | "linear">("github");
  const [issues, setIssues] = useState<LinearIssue[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (source !== "linear" || !linearKey || issues) return;
    setError("");
    fetch("/api/linear?action=issues", { headers: { "x-linear-key": linearKey }, cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Could not load Linear issues");
        setIssues(payload.issues || []);
      })
      .catch((reason) => setError(reason?.message || "Could not load Linear issues"));
  }, [source, linearKey, issues]);

  const visible = useMemo(() => (issues || []).filter((issue) => `${issue.identifier} ${issue.title} ${issue.description || ""}`.toLowerCase().includes(query.toLowerCase())), [issues, query]);

  return <div className="intake-shell">
    <div className="intake-source-tabs">
      <button className={source === "github" ? "on" : ""} onClick={() => setSource("github")}><IconGithub size={15} /> GitHub</button>
      <button className={source === "linear" ? "on" : ""} onClick={() => setSource("linear")}><span className="linear-source-mark"><IconLayers size={13} /></span> Linear</button>
    </div>
    {source === "github" ? <GithubPanel onUseFile={onUseFile} onUseIssue={onUseGithubIssue} /> : <div className="panel-view"><div className="panel-inner">
      <div className="github-head"><div><h1 className="panel-title">Linear intake</h1><p className="panel-sub">Turn an issue into a budgeted delivery contract and verified engineering task.</p></div></div>
      {!linearKey ? <div className="integration-empty"><span><IconLayers size={20} /></span><h2>Connect Linear</h2><p>Use OAuth for a team installation, signed webhooks, comments, and delivery status sync. A personal API key remains available for local browsing.</p><a className="integration-connect" href="/api/integrations/linear/oauth/start">Connect Linear with OAuth <IconArrowRight size={13} /></a></div> : error ? <div className="empty-hint">{error}</div> : !issues ? <div className="loading-line"><span className="spinner" /> Loading Linear issues…</div> : <>
        <div className="github-toolbar"><div className="search-box"><IconSearch size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter active issues" /></div><span>{visible.length} active issues</span></div>
        <div className="linear-issue-list">{visible.map((issue) => <article className="linear-issue" key={issue.id}>
          <div className="linear-issue-id">{issue.identifier}</div>
          <div><strong>{issue.title}</strong><p>{issue.description?.trim() || "No issue description"}</p><span>{issue.state?.name || "Open"}{issue.team?.name ? ` · ${issue.team.name}` : ""}</span></div>
          <button onClick={() => onUseLinearIssue(issue)}><IconSparkles size={13} /> Create delivery <IconArrowRight size={12} /></button>
        </article>)}</div>
      </>}
    </div></div>}
  </div>;
}
