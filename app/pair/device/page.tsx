"use client";

import { FormEvent, useEffect, useState } from "react";

type DeviceInfo = {
  code: string;
  status: "pending" | "approved";
  account: { email: string };
  agent: {
    host: string;
    platform: string;
    version?: string;
    workspaceRoot?: string;
    claude: boolean;
    codex: boolean;
    git: boolean;
    gh: boolean;
  };
};

const cleanCode = (value: string) => {
  const raw = value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 8);
  return raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
};

export default function DevicePairPage() {
  const [code, setCode] = useState("");
  const [info, setInfo] = useState<DeviceInfo | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function inspect(nextCode = code) {
    const normalized = cleanCode(nextCode);
    if (normalized.length !== 9) {
      setInfo(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const response = await fetch(`/api/agent/device/approve?code=${encodeURIComponent(normalized)}`, { cache: "no-store" });
    const json = await response.json().catch(() => ({}));
    if (response.status === 401) {
      setSignedIn(false);
      setInfo(null);
    } else if (!response.ok) {
      setSignedIn(true);
      setInfo(null);
      setError(json.error || "This pairing code is not available.");
    } else {
      setSignedIn(true);
      setInfo(json);
      setApproved(json.status === "approved");
    }
    setLoading(false);
  }

  useEffect(() => {
    const initial = cleanCode(new URLSearchParams(window.location.search).get("code") || "");
    setCode(initial);
    void inspect(initial);
    // The initial query string is intentionally read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function authenticate(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const response = await fetch(`/api/auth/${authMode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(json.error || "Could not continue.");
      setLoading(false);
      return;
    }
    setSignedIn(true);
    await inspect();
  }

  async function approve() {
    setApproving(true);
    setError("");
    const response = await fetch("/api/agent/device/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) setError(json.error || "Could not approve this computer.");
    else {
      setApproved(true);
      setInfo((current) => current ? { ...current, status: "approved" } : current);
    }
    setApproving(false);
  }

  return (
    <main className="device-pair-page">
      <section className="device-pair-card" aria-live="polite">
        <header className="device-pair-brand">
          <img src="/hyzr-chat-mark.svg?v=2" alt="" />
          <span>Hyzr</span>
        </header>

        {approved ? (
          <div className="device-pair-success">
            <span aria-hidden="true">✓</span>
            <p className="device-pair-kicker">Computer connected</p>
            <h1>You’re ready to build.</h1>
            <p>The terminal will finish automatically. You can close this page and use Hyzr from any signed-in device.</p>
            {info && <div className="device-pair-machine"><b>{info.agent.host}</b><small>{info.agent.workspaceRoot || info.agent.platform}</small></div>}
            <a className="device-pair-primary" href="/">Open Hyzr</a>
          </div>
        ) : (
          <>
            <div className="device-pair-heading">
              <p className="device-pair-kicker">Secure device pairing</p>
              <h1>Connect this computer</h1>
              <p>Confirm the code shown in the Hyzr terminal. Your Claude, Codex, Git, and project credentials stay on your computer.</p>
            </div>

            <label className="device-pair-code">
              <span>Pairing code</span>
              <input
                value={code}
                onChange={(event) => {
                  const next = cleanCode(event.target.value);
                  setCode(next);
                  setInfo(null);
                  setError("");
                }}
                onBlur={() => void inspect()}
                placeholder="ABCD-EFGH"
                inputMode="text"
                autoComplete="one-time-code"
                spellCheck={false}
                maxLength={9}
                autoFocus
              />
            </label>

            {signedIn === false ? (
              <form className="device-pair-auth" onSubmit={authenticate}>
                <div className="device-pair-auth-copy">
                  <b>{authMode === "login" ? "Sign in to approve" : "Create your Hyzr account"}</b>
                  <button type="button" onClick={() => setAuthMode(authMode === "login" ? "signup" : "login")}>
                    {authMode === "login" ? "Create account" : "Use existing account"}
                  </button>
                </div>
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" required />
                <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" minLength={10} required />
                <button className="device-pair-primary" disabled={loading || code.length !== 9}>
                  {loading ? "Checking…" : authMode === "login" ? "Sign in and continue" : "Create account and continue"}
                </button>
              </form>
            ) : info ? (
              <>
                <div className="device-pair-machine">
                  <div><b>{info.agent.host}</b><small>{info.agent.platform}{info.agent.version ? ` · Hyzr ${info.agent.version}` : ""}</small></div>
                  <span className="device-pair-safe">Code matches</span>
                </div>
                <div className="device-pair-tools">
                  {(["claude", "codex", "git", "gh"] as const).map((tool) => (
                    <span key={tool} className={info.agent[tool] ? "available" : ""}>
                      <i />{tool === "gh" ? "GitHub" : tool[0].toUpperCase() + tool.slice(1)}
                    </span>
                  ))}
                </div>
                {info.agent.workspaceRoot && <p className="device-pair-path">Projects: <code>{info.agent.workspaceRoot}</code></p>}
                <button className="device-pair-primary" onClick={approve} disabled={approving}>
                  {approving ? "Connecting…" : `Connect ${info.agent.host}`}
                </button>
                <p className="device-pair-account">Approving for {info.account.email}</p>
              </>
            ) : (
              <button className="device-pair-primary" onClick={() => void inspect()} disabled={loading || code.length !== 9}>
                {loading ? "Checking code…" : "Continue"}
              </button>
            )}

            {error && <p className="device-pair-error">{error}</p>}
          </>
        )}
      </section>
      <p className="device-pair-foot">The launcher makes encrypted outbound connections only. Approval codes expire after 15 minutes.</p>
    </main>
  );
}
