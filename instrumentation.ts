export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureDurableWorker } = await import("./lib/durable-worker");
    const { ensureBenchmarkWorker } = await import("./lib/benchmark-engine");
    ensureDurableWorker();
    ensureBenchmarkWorker();
    // If this locally-run app was told to connect to a hosted site, bridge it.
    if (process.env.HYZR_RELAY_URL && process.env.HYZR_CODE) {
      const { startRelayWorker } = await import("./lib/relay-worker");
      void startRelayWorker();
    }
  }
}
