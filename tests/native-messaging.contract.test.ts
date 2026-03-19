import { spawnSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.join(import.meta.dirname, ".."));
const binPath = path.join(repoRoot, "bin", "webenvoy");

const runCli = (args: string[]) =>
  spawnSync(process.execPath, [binPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8"
  });

const parseJson = (stdout: string) => JSON.parse(stdout.trim()) as Record<string, unknown>;

describe("native messaging contract", () => {
  it("returns transport metadata on runtime.ping success", () => {
    const result = runCli(["runtime.ping", "--run-id", "run-nm-001"]);
    expect(result.status).toBe(0);

    const body = parseJson(result.stdout);
    expect(body).toMatchObject({
      command: "runtime.ping",
      status: "success"
    });
    expect(body.summary).toMatchObject({
      message: "pong",
      transport: {
        protocol: "webenvoy.native-bridge.v1"
      }
    });
  });

  it("maps transport timeout to runtime unavailable exit code", () => {
    const result = runCli([
      "runtime.ping",
      "--run-id",
      "run-nm-002",
      "--params",
      '{"simulate_transport_timeout":true}'
    ]);
    expect(result.status).toBe(5);

    const body = parseJson(result.stdout);
    expect(body).toMatchObject({
      status: "error",
      error: {
        code: "ERR_RUNTIME_UNAVAILABLE"
      }
    });
    expect(String((body.error as Record<string, unknown>).message)).toContain(
      "ERR_TRANSPORT_TIMEOUT"
    );
  });

  it("maps transport disconnect to runtime unavailable exit code", () => {
    const result = runCli([
      "runtime.ping",
      "--run-id",
      "run-nm-003",
      "--params",
      '{"simulate_transport_disconnect":true}'
    ]);
    expect(result.status).toBe(5);

    const body = parseJson(result.stdout);
    expect(body).toMatchObject({
      status: "error",
      error: {
        code: "ERR_RUNTIME_UNAVAILABLE",
        retryable: true
      }
    });
    expect(String((body.error as Record<string, unknown>).message)).toContain(
      "ERR_TRANSPORT_DISCONNECTED"
    );
  });
});
