import { describe, expect, it } from "vitest";

import { createCommandRegistry } from "../../commands/index.js";
import { executeCommand } from "../router.js";
import type { RuntimeContext } from "../types.js";

const baseContext: RuntimeContext = {
  run_id: "run-test-001",
  command: "runtime.ping",
  profile: null,
  params: {},
  cwd: "/tmp"
};

describe("executeCommand", () => {
  it("returns summary when command is implemented", async () => {
    const summary = await executeCommand(baseContext, createCommandRegistry());

    expect(summary).toMatchObject({ message: "ok" });
  });

  it("returns unknown command error for unregistered command", async () => {
    await expect(
      executeCommand(
        {
          ...baseContext,
          command: "unknown.test"
        },
        createCommandRegistry()
      )
    ).rejects.toMatchObject({ code: "ERR_CLI_UNKNOWN_COMMAND" });
  });

  it("returns not implemented error for registered placeholder command", async () => {
    await expect(
      executeCommand(
        {
          ...baseContext,
          command: "xhs.search"
        },
        createCommandRegistry()
      )
    ).rejects.toMatchObject({ code: "ERR_CLI_NOT_IMPLEMENTED" });
  });

  it("returns runtime unavailable error without collapsing into execution failed", async () => {
    await expect(
      executeCommand(
        {
          ...baseContext,
          params: { simulate_runtime_unavailable: true }
        },
        createCommandRegistry()
      )
    ).rejects.toMatchObject({ code: "ERR_RUNTIME_UNAVAILABLE", retryable: true });
  });

  it("maps command handler exceptions to ERR_EXECUTION_FAILED", async () => {
    await expect(
      executeCommand(
        {
          ...baseContext,
          params: { force_fail: true }
        },
        createCommandRegistry()
      )
    ).rejects.toMatchObject({ code: "ERR_EXECUTION_FAILED" });
  });
});
