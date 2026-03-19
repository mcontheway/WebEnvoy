import { spawnSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.join(import.meta.dirname, ".."));
const binPath = path.join(repoRoot, "bin", "webenvoy");
const mockNativeHostPath = path.join(repoRoot, "tests", "fixtures", "native-host-mock.mjs");

const runCli = (args: string[], env?: Record<string, string>) =>
  spawnSync(process.execPath, [binPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env
    }
  });

const parseJson = (stdout: string) => JSON.parse(stdout.trim()) as Record<string, unknown>;
const withNativeHost = (mode: string): Record<string, string> => ({
  WEBENVOY_NATIVE_HOST_CMD: `"${process.execPath}" "${mockNativeHostPath}"`,
  WEBENVOY_NATIVE_HOST_MODE: mode
});

describe("native messaging contract", () => {
  it("returns handshake failure on default transport when bridge is not connected", () => {
    const result = runCli(["runtime.ping", "--run-id", "run-nm-default-001"]);
    expect(result.status).toBe(5);

    const body = parseJson(result.stdout);
    expect(body).toMatchObject({
      status: "error",
      error: {
        code: "ERR_RUNTIME_UNAVAILABLE"
      }
    });
    expect(String((body.error as Record<string, unknown>).message)).toContain(
      "ERR_TRANSPORT_HANDSHAKE_FAILED"
    );
  });

  it("returns transport metadata on runtime.ping success via native host stdio bridge", () => {
    const result = runCli(["runtime.ping", "--run-id", "run-nm-001"], withNativeHost("success"));
    expect(result.status).toBe(0);

    const body = parseJson(result.stdout);
    expect(body).toMatchObject({
      command: "runtime.ping",
      status: "success"
    });
    expect(body.summary).toMatchObject({
      message: "pong",
      transport: {
        protocol: "webenvoy.native-bridge.v1",
        relay_path: "host>background>content-script>background>host"
      }
    });
  });

  it("maps transport timeout to runtime unavailable exit code without loopback", () => {
    const result = runCli([
      "runtime.ping",
      "--run-id",
      "run-nm-002",
      "--params",
      '{"timeout_ms":100}'
    ], withNativeHost("drop-forward"));
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

  it("returns runtime store error when persistence is unavailable during native messaging failure", () => {
    const result = runCli(
      [
        "runtime.ping",
        "--run-id",
        "run-nm-store-warning-001",
        "--params",
        '{"timeout_ms":100}'
      ],
      {
        ...withNativeHost("drop-forward"),
        WEBENVOY_RUNTIME_STORE_FORCE_UNAVAILABLE: "1"
      }
    );
    expect(result.status).toBe(5);

    const body = parseJson(result.stdout);
    expect(body).toMatchObject({
      status: "error",
      error: {
        code: "ERR_RUNTIME_UNAVAILABLE"
      }
    });
    expect(String((body.error as Record<string, unknown>).message)).toContain(
      "ERR_RUNTIME_STORE_UNAVAILABLE"
    );
    expect(String((body.error as Record<string, unknown>).message)).not.toContain(
      "ERR_TRANSPORT_TIMEOUT"
    );
    expect(result.stderr).toBe("");
  });

  it("maps transport disconnect to runtime unavailable exit code without loopback", () => {
    const result = runCli(["runtime.ping", "--run-id", "run-nm-003"], withNativeHost("disconnect-on-forward"));
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
