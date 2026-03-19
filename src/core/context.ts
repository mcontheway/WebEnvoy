import { randomUUID } from "node:crypto";

import type { ParsedCliInput, RuntimeContext } from "./types.js";

export const generateRunId = (): string => {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
  const suffix = randomUUID().replace(/-/g, "").slice(0, 8);
  return `run-${stamp}-${suffix}`;
};

export const buildRuntimeContext = (
  parsed: ParsedCliInput,
  cwd: string,
  runIdFactory: () => string = generateRunId
): RuntimeContext => ({
  run_id: parsed.runId ?? runIdFactory(),
  command: parsed.command,
  profile: parsed.profile,
  params: parsed.params,
  cwd
});
