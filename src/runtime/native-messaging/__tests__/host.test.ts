import path from "node:path";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createServer } from "node:net";

import { describe, expect, it } from "vitest";

import {
  createBridgeForwardRequest,
  createBridgeOpenRequest
} from "../protocol.js";
import {
  NativeHostBridgeTransport,
  PROFILE_NATIVE_BRIDGE_SOCKET_FILENAME,
  parseNativeHostCommand
} from "../host.js";

describe("native host bridge transport classification", () => {
  it("parses quoted native host command with spaces", () => {
    const parsed = parseNativeHostCommand(
      `"${process.execPath}" "/tmp/mock folder/native-host.mjs" --mode smoke`
    );
    expect(parsed).toEqual({
      file: process.execPath,
      args: ["/tmp/mock folder/native-host.mjs", "--mode", "smoke"]
    });
  });

  it("rejects empty native host command", () => {
    expect(parseNativeHostCommand("   ")).toBeNull();
  });

  it("classifies open without configured native host command as handshake failed", async () => {
    const transport = new NativeHostBridgeTransport(null);
    await expect(
      transport.open(
        createBridgeOpenRequest({
          id: "open-invalid-001",
          profile: "profile-a",
          timeoutMs: 100
        })
      )
    ).rejects.toMatchObject({
      transportCode: "ERR_TRANSPORT_HANDSHAKE_FAILED"
    });
  });

  it("classifies forward without configured native host command as disconnected", async () => {
    const transport = new NativeHostBridgeTransport(null);

    await expect(
      transport.forward(
        createBridgeForwardRequest({
          id: "forward-invalid-001",
          profile: "profile-a",
          sessionId: "nm-session-001",
          runId: "run-forward-invalid-001",
          command: "runtime.ping",
          commandParams: {},
          cwd: "/tmp",
          timeoutMs: 100
        })
      )
    ).rejects.toMatchObject({
      transportCode: "ERR_TRANSPORT_DISCONNECTED"
    });
  });

  it("classifies open response timeout as timeout error", async () => {
    const mockNativeHostPath = path.resolve(
      path.join(import.meta.dirname, "../../../../tests/fixtures/native-host-mock.mjs")
    );
    const hostCommand = `"${process.execPath}" "${mockNativeHostPath}"`;
    const previousMode = process.env.WEBENVOY_NATIVE_HOST_MODE;
    process.env.WEBENVOY_NATIVE_HOST_MODE = "drop-open";

    try {
      const transport = new NativeHostBridgeTransport(hostCommand);
      await expect(
        transport.open(
          createBridgeOpenRequest({
            id: "open-timeout-001",
            profile: "profile-a",
            timeoutMs: 50
          })
        )
      ).rejects.toMatchObject({
        transportCode: "ERR_TRANSPORT_TIMEOUT"
      });
    } finally {
      if (previousMode === undefined) {
        delete process.env.WEBENVOY_NATIVE_HOST_MODE;
      } else {
        process.env.WEBENVOY_NATIVE_HOST_MODE = previousMode;
      }
    }
  });

  it("does not fall back to spawned host when profile socket is unavailable", async () => {
    const mockNativeHostPath = path.resolve(
      path.join(import.meta.dirname, "../../../../tests/fixtures/native-host-mock.mjs")
    );
    const hostCommand = `"${process.execPath}" "${mockNativeHostPath}"`;
    const transport = new NativeHostBridgeTransport(hostCommand, {
      socketPath: `/tmp/webenvoy-missing-socket-${Date.now()}.sock`
    });

    await expect(
      transport.open(
        createBridgeOpenRequest({
          id: "open-socket-required-001",
          profile: "xhs_208_probe",
          timeoutMs: 80
        })
      )
    ).rejects.toMatchObject({
      transportCode: "ERR_TRANSPORT_HANDSHAKE_FAILED"
    });
  });

  it("prefers profile socket over spawned host when official socket bridge is available", async () => {
    const baseDir = await mkdtemp("/tmp/webenvoy-host-socket-");
    const profile = "xhs_208_probe";
    const profileDir = path.join(baseDir, ".webenvoy", "profiles", profile);
    const socketPath = path.join(profileDir, PROFILE_NATIVE_BRIDGE_SOCKET_FILENAME);
    const previousCwd = process.cwd();
    const requests: Array<{ method: string; command?: string }> = [];
    await mkdir(profileDir, { recursive: true });

    const server = createServer((socket) => {
      let buffer = Buffer.alloc(0);
      socket.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length < 4) {
          return;
        }
        const frameLength = buffer.readUInt32LE(0);
        const frameEnd = 4 + frameLength;
        if (buffer.length < frameEnd) {
          return;
        }
        const frame = buffer.subarray(4, frameEnd);
        const request = JSON.parse(frame.toString("utf8")) as {
          id: string;
          method: string;
          params: { command?: string; session_id?: string };
        };
        requests.push({
          method: request.method,
          command: request.params.command
        });
        const payload =
          request.method === "bridge.open"
            ? {
                id: request.id,
                status: "success",
                summary: {
                  protocol: "webenvoy.native-bridge.v1",
                  session_id: "nm-session-socket",
                  state: "ready"
                },
                error: null
              }
            : request.method === "__ping__"
              ? {
                  id: request.id,
                  status: "success",
                  summary: {
                    session_id: request.params.session_id ?? "nm-session-socket"
                  },
                  error: null
                }
              : {
                  id: request.id,
                  status: "success",
                  summary: {
                    session_id: request.params.session_id ?? "nm-session-socket",
                    run_id: "run-socket-001",
                    command: request.params.command ?? "runtime.ping",
                    relay_path: "host>background>content-script>background>host"
                  },
                  payload: {
                    message: "pong"
                  },
                  error: null
                };
        const body = Buffer.from(JSON.stringify(payload), "utf8");
        const header = Buffer.alloc(4);
        header.writeUInt32LE(body.length, 0);
        socket.end(Buffer.concat([header, body]));
      });
    });

    try {
      await new Promise<void>((resolve) => server.listen(socketPath, resolve));
      process.chdir(baseDir);
      const transport = new NativeHostBridgeTransport(`"${process.execPath}" "/tmp/does-not-exist.mjs"`);

      await expect(
        transport.open(
          createBridgeOpenRequest({
            id: "open-socket-auto-001",
            profile,
            timeoutMs: 100
          })
        )
      ).resolves.toMatchObject({
        status: "success",
        summary: {
          session_id: "nm-session-socket"
        }
      });

      await expect(
        transport.heartbeat({
          id: "hb-socket-auto-001",
          method: "__ping__",
          profile: null,
          params: {
            session_id: "nm-session-socket"
          },
          timeout_ms: 100
        })
      ).resolves.toMatchObject({
        status: "success"
      });

      await expect(
        transport.forward(
          createBridgeForwardRequest({
            id: "forward-socket-auto-001",
            profile,
            sessionId: "nm-session-socket",
            runId: "run-socket-001",
            command: "runtime.ping",
            commandParams: {},
            cwd: baseDir,
            timeoutMs: 100
          })
        )
      ).resolves.toMatchObject({
        status: "success",
        payload: {
          message: "pong"
        }
      });

      expect(requests).toEqual([
        { method: "bridge.open", command: undefined },
        { method: "__ping__", command: undefined },
        { method: "bridge.forward", command: "runtime.ping" }
      ]);
    } finally {
      process.chdir(previousCwd);
      server.close();
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});
