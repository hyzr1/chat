"use client";

import { FormEvent, useState } from "react";
import { HyzrMark } from "../hyzr-logo";

export default function PairPage() {
  const [accessToken, setAccessToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    const response = await fetch("/api/access/pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { setError(payload.error || "Could not pair this device."); setBusy(false); return; }
    window.location.replace("/");
  }
  return <main className="pair-page"><form onSubmit={submit}><span className="pair-mark"><HyzrMark size={24} /></span><div><span>Secure local access</span><h1>Pair this device</h1><p>Enter the access key configured on the computer running Hyzr Chat. This browser will stay paired for 30 days.</p></div><label>Access key<input autoFocus type="password" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} autoComplete="current-password" /></label>{error && <p className="pair-error">{error}</p>}<button disabled={busy || !accessToken}>{busy ? "Pairing…" : "Continue to Hyzr Chat"}</button><small>Localhost remains available directly on the host computer.</small></form></main>;
}
