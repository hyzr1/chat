"use client";

import { useEffect, useState } from "react";
import Markdown from "./Markdown";
import {
  IconGithub,
  IconFolder,
  IconFile,
  IconChevron,
  IconStar,
  IconSparkles,
  IconSearch,
  IconArrowRight,
} from "../icons";

interface Repo {
  nameWithOwner: string;
  description?: string;
  visibility?: string;
  primaryLanguage?: { name: string } | null;
  stargazerCount?: number;
  updatedAt?: string;
}
interface TreeItem {
  name: string;
  path: string;
  type: string;
  size: number;
}
interface Issue {
  number: number;
  title: string;
  body?: string;
  url: string;
  updatedAt?: string;
  labels?: { name: string; color?: string }[];
  assignees?: { login: string }[];
}

export default function GithubPanel({
  onUseFile,
  onUseIssue,
}: {
  onUseFile?: (path: string, content: string) => void;
  onUseIssue?: (issue: Issue, repo: string) => void;
}) {
  const [login, setLogin] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [repo, setRepo] = useState<string | null>(null);
  const [path, setPath] = useState("");
  const [tree, setTree] = useState<TreeItem[] | null>(null);
  const [file, setFile] = useState<{ path: string; content: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [repoTab, setRepoTab] = useState<"issues" | "files">("issues");
  const [issues, setIssues] = useState<Issue[] | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/github?action=status").then((r) => r.json());
        if (r.connected) setLogin(r.login);
        else setError(r.error || "Not connected");
        const rr = await fetch("/api/github?action=repos").then((r) => r.json());
        if (rr.repos) setRepos(rr.repos);
        else setError(rr.error || "Could not list repos");
      } catch (e: any) {
        setError(e?.message ?? "GitHub request failed");
      }
    })();
  }, []);

  async function openRepo(name: string) {
    setRepo(name);
    setFile(null);
    setQuery("");
    setRepoTab("issues");
    setLoading(true);
    try {
      const result = await fetch(`/api/github?action=issues&repo=${encodeURIComponent(name)}`).then((response) => response.json());
      setIssues(result.issues ?? []);
      if (result.error) setError(result.error);
    } finally { setLoading(false); }
  }
  async function loadTree(name: string, p: string) {
    setLoading(true);
    setTree(null);
    setFile(null);
    setPath(p);
    try {
      const r = await fetch(
        `/api/github?action=tree&repo=${encodeURIComponent(name)}&path=${encodeURIComponent(p)}`,
      ).then((r) => r.json());
      if (r.items) setTree(r.items);
      else setError(r.error);
    } finally {
      setLoading(false);
    }
  }
  async function openFile(name: string, p: string) {
    setLoading(true);
    try {
      const r = await fetch(
        `/api/github?action=file&repo=${encodeURIComponent(name)}&path=${encodeURIComponent(p)}`,
      ).then((r) => r.json());
      if (r.content !== undefined) setFile({ path: p, content: r.content });
      else setError(r.error);
    } finally {
      setLoading(false);
    }
  }

  const crumbParts = path ? path.split("/") : [];
  const visibleRepos = (repos ?? []).filter((item) => `${item.nameWithOwner} ${item.description ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  const visibleIssues = (issues ?? []).filter((issue) => `${issue.title} ${issue.body ?? ""} ${issue.number}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="panel-view">
      <div className="panel-inner">
        <div className="github-head">
          <div><h1 className="panel-title">GitHub</h1><p className="panel-sub">Browse source and add individual files to the current project context.</p></div>
          {login && <span className="github-account"><IconGithub size={14} /> {login}</span>}
        </div>

        {!repo && (
          <>
            {!repos && !error && (
              <div className="loading-line">
                <span className="spinner" /> Loading repositories…
              </div>
            )}
            {error && !repos && <div className="integration-empty"><span><IconGithub size={20} /></span><h2>Connect GitHub</h2><p>{error}. Install the Hyzr Chat GitHub App for repository-scoped issue intake, PR delivery, Checks, and post-merge regression tracking. The local <code>gh</code> fallback remains available.</p><a className="integration-connect" href="/api/integrations/github/install">Install GitHub App <IconArrowRight size={13} /></a></div>}
            {repos && <div className="github-toolbar"><div className="search-box"><IconSearch size={14} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a repository" /></div><span>{visibleRepos.length} repositories</span></div>}
            <div className="repo-grid">
            {visibleRepos.map((r) => (
              <button
                key={r.nameWithOwner}
                className="repo-card"
                onClick={() => openRepo(r.nameWithOwner)}
              >
                <div className="repo-card-head"><span className="repo-mark"><IconGithub size={16} /></span><strong>{r.nameWithOwner}</strong><IconArrowRight size={14} /></div>
                <p>{r.description || "No repository description"}</p>
                <div className="repo-card-meta">
                  {r.primaryLanguage?.name && <span><i />{r.primaryLanguage.name}</span>}
                  {typeof r.stargazerCount === "number" && (
                    <span>
                      <IconStar size={13} /> {r.stargazerCount}
                    </span>
                  )}
                  <span className="repo-visibility">{r.visibility?.toLowerCase()}</span>
                </div>
              </button>
            ))}
            </div>
          </>
        )}

        {repo && (
          <>
            <div className="crumbs">
              <button onClick={() => setRepo(null)}>Repositories</button>
              <span className="sep">/</span>
              <button onClick={() => loadTree(repo, "")}>{repo}</button>
              {crumbParts.map((part, i) => {
                const sub = crumbParts.slice(0, i + 1).join("/");
                return (
                  <span key={sub} style={{ display: "inline-flex", gap: 6 }}>
                    <span className="sep">/</span>
                    <button onClick={() => loadTree(repo, sub)}>{part}</button>
                  </span>
                );
              })}
            </div>

            <div className="github-repo-tools">
              <div className="github-repo-tabs">
                <button className={repoTab === "issues" ? "on" : ""} onClick={() => setRepoTab("issues")}>Issues <span>{issues?.length ?? 0}</span></button>
                <button className={repoTab === "files" ? "on" : ""} onClick={() => { setRepoTab("files"); if (!tree) loadTree(repo, ""); }}>Files</button>
              </div>
              <div className="search-box"><IconSearch size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={repoTab === "issues" ? "Filter issues" : "Filter files"} /></div>
            </div>

            {loading && (
              <div className="loading-line">
                <span className="spinner" /> Loading…
              </div>
            )}

            {repoTab === "issues" ? (
              !loading && <div className="github-issues">
                {visibleIssues.length === 0 ? <div className="empty-hint">No matching open issues.</div> : visibleIssues.map((issue) => <article className="github-issue" key={issue.number}>
                  <div className="github-issue-number">#{issue.number}</div>
                  <div className="github-issue-copy"><strong>{issue.title}</strong><p>{issue.body?.trim() || "No issue description"}</p><div>{issue.labels?.slice(0, 4).map((label) => <span key={label.name}>{label.name}</span>)}</div></div>
                  {onUseIssue && <button onClick={() => onUseIssue(issue, repo)}><IconSparkles size={13} /> Create delivery</button>}
                </article>)}
              </div>
            ) : file ? (
              <div className="file-content">
                <div className="code-head">
                  <span>{file.path}</span>
                  {onUseFile && (
                    <button
                      className="code-copy"
                      onClick={() => onUseFile(file.path, file.content)}
                    >
                      <IconSparkles size={13} /> Use in chat
                    </button>
                  )}
                </div>
                <Markdown content={"```\n" + file.content + "\n```"} />
              </div>
            ) : (
              !loading &&
              tree?.filter((item) => item.name.toLowerCase().includes(query.toLowerCase())).map((it) => (
                <button
                  key={it.path}
                  className="file-row"
                  onClick={() =>
                    it.type === "dir"
                      ? loadTree(repo, it.path)
                      : openFile(repo, it.path)
                  }
                >
                  {it.type === "dir" ? <IconFolder size={16} /> : <IconFile size={16} />}
                  <span style={{ flex: 1 }}>{it.name}</span>
                  {it.type === "dir" ? (
                    <IconChevron size={15} className="chev" />
                  ) : (
                    <span style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
                      {(it.size / 1024).toFixed(1)} KB
                    </span>
                  )}
                </button>
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}
