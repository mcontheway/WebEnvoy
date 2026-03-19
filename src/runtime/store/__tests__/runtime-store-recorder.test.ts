import { describe, expect, it, vi } from "vitest";

import { CliError } from "../../../core/errors.js";
import type { RuntimeContext } from "../../../core/types.js";
import { RuntimeStoreRecorder } from "../runtime-store-recorder.js";
import { RuntimeStoreError } from "../sqlite-runtime-store.js";

const baseContext: RuntimeContext = {
  run_id: "run-recorder-001",
  command: "runtime.ping",
  profile: "default",
  params: {},
  cwd: "/tmp"
};

describe("runtime-store-recorder", () => {
  it("keeps startedAt stable from start to success", async () => {
    const upsertRun = vi.fn().mockResolvedValue(undefined);
    const appendRunEvent = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn();
    const recorder = new RuntimeStoreRecorder(baseContext.cwd, { upsertRun, appendRunEvent, close });

    await recorder.recordStart(baseContext);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await recorder.recordSuccess(baseContext, {});

    expect(upsertRun).toHaveBeenCalledTimes(2);
    const startInput = upsertRun.mock.calls[0][0] as { startedAt: string };
    const successInput = upsertRun.mock.calls[1][0] as { startedAt: string };
    expect(successInput.startedAt).toBe(startInput.startedAt);
  });

  it("keeps startedAt stable from start to failure", async () => {
    const upsertRun = vi.fn().mockResolvedValue(undefined);
    const appendRunEvent = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn();
    const recorder = new RuntimeStoreRecorder(baseContext.cwd, { upsertRun, appendRunEvent, close });

    await recorder.recordStart(baseContext);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await recorder.recordFailure(baseContext, new CliError("ERR_EXECUTION_FAILED", "boom"));

    expect(upsertRun).toHaveBeenCalledTimes(2);
    const startInput = upsertRun.mock.calls[0][0] as { startedAt: string };
    const failureInput = upsertRun.mock.calls[1][0] as { startedAt: string };
    expect(failureInput.startedAt).toBe(startInput.startedAt);
  });

  it("does not swallow runtime store write errors", async () => {
    const writeError = new RuntimeStoreError("ERR_RUNTIME_STORE_UNAVAILABLE", "db write failed");
    const upsertRun = vi.fn().mockResolvedValue(undefined);
    const appendRunEvent = vi.fn().mockRejectedValue(writeError);
    const close = vi.fn();
    const recorder = new RuntimeStoreRecorder(baseContext.cwd, { upsertRun, appendRunEvent, close });

    await expect(recorder.recordSuccess(baseContext, {})).rejects.toBe(writeError);
  });
});
