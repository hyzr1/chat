export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureDurableWorker } = await import("./lib/durable-worker");
    const { ensureBenchmarkWorker } = await import("./lib/benchmark-engine");
    ensureDurableWorker();
    ensureBenchmarkWorker();
  }
}
