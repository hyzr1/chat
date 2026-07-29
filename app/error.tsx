"use client";

import { useEffect } from "react";
import { HyzrMark } from "./hyzr-logo";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("Hyzr Chat route error", error); }, [error]);
  return (
    <main className="fatal-state">
      <span><HyzrMark size={34} /></span>
      <h1>Hyzr Chat hit a recoverable error</h1>
      <p>Your chat and project workspace are preserved. Retry the interface or return home.</p>
      <div><button className="btn primary" onClick={reset}>Try again</button><a className="btn" href="/">Return home</a></div>
      {error.digest && <code>Reference {error.digest}</code>}
    </main>
  );
}
