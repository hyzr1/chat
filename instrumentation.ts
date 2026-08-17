export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { isHostedRuntime } = await import("./lib/agent-protocol");

    // Do NOT start the durable/benchmark workers eagerly when hosted. Both run
    // a permanent loop that claims work every ~1s with a SQLite write
    // transaction, and hosted STATE_DATABASE is ":memory:" — the durable store
    // has no role in hosted execution, which runs on paired machines. Every
    // warm instance was therefore doing two pointless write transactions per
    // second forever, burning CPU with no users and no requests. That is a
    // near-perfect match for this project's usage: active CPU far over the
    // limit while invocations stayed well under it.
    //
    // Nothing is lost by skipping it. Every path that enqueues work already
    // calls wakeDurableWorker()/wakeBenchmarkWorker()/ensureDurableWorker(),
    // which starts the loop on demand; the loops then wind themselves down
    // once the queue goes quiet.
    if (!isHostedRuntime()) {
      const { ensureDurableWorker } = await import("./lib/durable-worker");
      const { ensureBenchmarkWorker } = await import("./lib/benchmark-engine");
      ensureDurableWorker();
      ensureBenchmarkWorker();
    }
    // If this locally-run app was told to connect to a hosted site, bridge it.
    if (process.env.HYZR_RELAY_URL && process.env.HYZR_CODE) {
      const { startRelayWorker } = await import("./lib/relay-worker");
      void startRelayWorker();
    }
  }
}
