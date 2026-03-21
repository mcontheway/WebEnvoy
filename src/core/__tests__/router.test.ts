import { describe, expect, it } from "vitest";

import { createCommandRegistry } from "../../commands/index.js";
import { executeCommand } from "../router.js";
import type { CommandExecutionResult, RuntimeContext } from "../types.js";

const baseContext: RuntimeContext = {
  run_id: "run-test-001",
  command: "runtime.ping",
  profile: null,
  params: {},
  cwd: "/tmp"
};

describe("executeCommand", () => {
  it("returns summary when command is implemented", async () => {
    const previousTransport = process.env.WEBENVOY_NATIVE_TRANSPORT;
    process.env.WEBENVOY_NATIVE_TRANSPORT = "loopback";
    let execution: CommandExecutionResult;
    try {
      execution = await executeCommand(baseContext, createCommandRegistry());
    } finally {
      process.env.WEBENVOY_NATIVE_TRANSPORT = previousTransport;
    }

    expect(execution.summary).toMatchObject({
      message: "pong",
      transport: {
        protocol: "webenvoy.native-bridge.v1",
        state: "ready"
      }
    });
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

  it("returns invalid args error when xhs.search lacks ability envelope", async () => {
    await expect(
      executeCommand(
        {
          ...baseContext,
          command: "xhs.search",
          profile: "xhs_account_001"
        },
        createCommandRegistry()
      )
    ).rejects.toMatchObject({
      code: "ERR_CLI_INVALID_ARGS",
      details: {
        ability_id: "unknown",
        stage: "input_validation",
        reason: "ABILITY_MISSING"
      }
    });
  });

  it("returns capability summary for xhs.search fixture success", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousFixtureFlag = process.env.WEBENVOY_ALLOW_FIXTURE_SUCCESS;
    process.env.NODE_ENV = "test";
    process.env.WEBENVOY_ALLOW_FIXTURE_SUCCESS = "1";
    try {
      const execution = await executeCommand(
        {
          ...baseContext,
          command: "xhs.search",
          profile: "xhs_account_001",
          params: {
            ability: {
              id: "xhs.note.search.v1",
              layer: "L3",
              action: "read"
            },
            input: {
              query: "露营装备"
            },
            options: {
              fixture_success: true
            }
          }
        },
        createCommandRegistry()
      );

      expect(execution.summary).toMatchObject({
        capability_result: {
          ability_id: "xhs.note.search.v1",
          layer: "L3",
          action: "read",
          outcome: "partial"
        }
      });
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      process.env.WEBENVOY_ALLOW_FIXTURE_SUCCESS = previousFixtureFlag;
    }
  });

  it("returns capability summary and observability for xhs.search runtime success", async () => {
    const previousTransport = process.env.WEBENVOY_NATIVE_TRANSPORT;
    process.env.WEBENVOY_NATIVE_TRANSPORT = "loopback";
    try {
      const execution = await executeCommand(
        {
          ...baseContext,
          command: "xhs.search",
          profile: "xhs_account_001",
          params: {
            ability: {
              id: "xhs.note.search.v1",
              layer: "L3",
              action: "read"
            },
            input: {
              query: "露营装备"
            },
            options: {
              simulate_result: "success"
            }
          }
        },
        createCommandRegistry()
      );

      expect(execution.summary).toMatchObject({
        capability_result: {
          ability_id: "xhs.note.search.v1",
          outcome: "success"
        }
      });
      expect(execution.observability).toMatchObject({
        page_state: {
          page_kind: "search"
        }
      });
    } finally {
      process.env.WEBENVOY_NATIVE_TRANSPORT = previousTransport;
    }
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
