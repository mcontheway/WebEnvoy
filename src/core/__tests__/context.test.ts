import { describe, expect, it } from "vitest";

import { buildRuntimeContext } from "../context.js";

describe("buildRuntimeContext", () => {
  it("normalizes parsed input into runtime context", () => {
    const context = buildRuntimeContext(
      {
        command: "runtime.ping",
        params: { hello: "world" },
        profile: "default",
        runId: "run-20260319-0001"
      },
      "/tmp/workdir"
    );

    expect(context).toEqual({
      run_id: "run-20260319-0001",
      command: "runtime.ping",
      profile: "default",
      params: { hello: "world" },
      cwd: "/tmp/workdir"
    });
  });

  it("generates run id when caller does not pass one", () => {
    const context = buildRuntimeContext(
      {
        command: "runtime.help",
        params: {},
        profile: null,
        runId: null
      },
      "/tmp/workdir",
      () => "run-generated-001"
    );

    expect(context.run_id).toBe("run-generated-001");
  });
});
