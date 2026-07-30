#!/usr/bin/env node
import { runAgentCli } from "./src/core.mjs";

runAgentCli().catch((error) => {
  console.error("[hyzr] fatal:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
