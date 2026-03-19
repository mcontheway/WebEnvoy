import { randomUUID } from "node:crypto";
export const generateRunId = () => {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
    const suffix = randomUUID().replace(/-/g, "").slice(0, 8);
    return `run-${stamp}-${suffix}`;
};
export const buildRuntimeContext = (parsed, cwd, runIdFactory = generateRunId) => ({
    run_id: parsed.runId ?? runIdFactory(),
    command: parsed.command,
    profile: parsed.profile,
    params: parsed.params,
    cwd
});
