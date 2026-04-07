import { describe, expect, it } from "vitest";

import { NativeMessagingBridge } from "../bridge.js";
import type { HostMessage } from "../loopback-messages.js";
import { createPortPair } from "../loopback-port.js";
import { createLoopbackNativeBridgeTransport } from "../loopback.js";
import { InMemoryHostTransport } from "../loopback-host-transport.js";

describe("native messaging default loopback chain", () => {
  it("uses host -> background -> content-script -> background -> host path by default", async () => {
    const bridge = new NativeMessagingBridge({
      transport: createLoopbackNativeBridgeTransport()
    });
    const result = await bridge.runtimePing({
      runId: "run-loopback-001",
      profile: "profile-a",
      cwd: "/tmp",
      params: {}
    });

    expect(result.transport).toMatchObject({
      relay_path: "host>background>content-script>background>host",
      state: "ready",
      protocol: "webenvoy.native-bridge.v1"
    });
    expect(result.message).toBe("pong");
  });

  it("fails malformed loopback requests before they reach the relay", async () => {
    const [hostPort] = createPortPair<HostMessage>();
    const transport = new InMemoryHostTransport(hostPort);
    let relayed = false;

    hostPort.onMessage(() => {
      relayed = true;
    });

    expect(() =>
      transport.forward({
        id: "bad-forward-001",
        method: "bridge.forward",
        profile: "profile-a",
        params: null
      } as never)
    ).toThrow("invalid request envelope");

    await Promise.resolve();

    expect(relayed).toBe(false);
  });

  it("converges pending bootstrap to ready without requiring runtime.ping", async () => {
    const bridge = new NativeMessagingBridge({
      transport: createLoopbackNativeBridgeTransport()
    });

    const bootstrap = await bridge.runCommand({
      runId: "run-loopback-bootstrap-001",
      profile: "profile-a",
      cwd: "/tmp",
      command: "runtime.bootstrap",
      params: {
        version: "v1",
        run_id: "run-loopback-bootstrap-001",
        runtime_context_id: "runtime-context-001",
        profile: "profile-a",
        fingerprint_runtime: {},
        fingerprint_patch_manifest: {},
        main_world_secret: "loopback-secret-001"
      }
    });

    expect(bootstrap).toMatchObject({
      ok: false,
      error: {
        code: "ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED",
        message: "runtime bootstrap 尚未获得执行面确认"
      }
    });

    const readiness = await bridge.runCommand({
      runId: "run-loopback-bootstrap-001",
      profile: "profile-a",
      cwd: "/tmp",
      command: "runtime.readiness",
      params: {
        run_id: "run-loopback-bootstrap-001",
        runtime_context_id: "runtime-context-001"
      }
    });

    expect(readiness).toMatchObject({
      ok: true,
      payload: {
        transport_state: "ready",
        bootstrap_state: "pending"
      }
    });

    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });

    const attestedBootstrap = await bridge.runCommand({
      runId: "run-loopback-bootstrap-001",
      profile: "profile-a",
      cwd: "/tmp",
      command: "runtime.bootstrap",
      params: {
        version: "v1",
        run_id: "run-loopback-bootstrap-001",
        runtime_context_id: "runtime-context-001",
        profile: "profile-a",
        fingerprint_runtime: {},
        fingerprint_patch_manifest: {},
        main_world_secret: "loopback-secret-001"
      }
    });

    expect(attestedBootstrap).toMatchObject({
      ok: true,
      payload: {
        method: "runtime.bootstrap.ack",
        result: {
          version: "v1",
          run_id: "run-loopback-bootstrap-001",
          runtime_context_id: "runtime-context-001",
          profile: "profile-a",
          status: "ready"
        }
      }
    });

    const attestedReadiness = await bridge.runCommand({
      runId: "run-loopback-bootstrap-001",
      profile: "profile-a",
      cwd: "/tmp",
      command: "runtime.readiness",
      params: {
        run_id: "run-loopback-bootstrap-001",
        runtime_context_id: "runtime-context-001"
      }
    });

    expect(attestedReadiness).toMatchObject({
      ok: true,
      payload: {
        transport_state: "ready",
        bootstrap_state: "ready"
      }
    });
  });

  it("marks runtime.readiness stale when the loopback query uses an old run context", async () => {
    const bridge = new NativeMessagingBridge({
      transport: createLoopbackNativeBridgeTransport()
    });

    await bridge.runCommand({
      runId: "run-loopback-bootstrap-002",
      profile: "profile-a",
      cwd: "/tmp",
      command: "runtime.bootstrap",
      params: {
        version: "v1",
        run_id: "run-loopback-bootstrap-002",
        runtime_context_id: "runtime-context-002",
        profile: "profile-a",
        fingerprint_runtime: {},
        fingerprint_patch_manifest: {},
        main_world_secret: "loopback-secret-002"
      }
    });

    await bridge.runtimePing({
      runId: "run-loopback-bootstrap-002",
      profile: "profile-a",
      cwd: "/tmp",
      params: {
        runtime_context_id: "runtime-context-002",
        profile: "profile-a"
      }
    });

    const readiness = await bridge.runCommand({
      runId: "run-loopback-bootstrap-003",
      profile: "profile-a",
      cwd: "/tmp",
      command: "runtime.readiness",
      params: {
        run_id: "run-loopback-bootstrap-003",
        runtime_context_id: "runtime-context-003"
      }
    });

    expect(readiness).toMatchObject({
      ok: true,
      payload: {
        transport_state: "ready",
        bootstrap_state: "stale"
      }
    });
  });

  it("keeps bootstrap pending when runtime.ping omits the current bootstrap context", async () => {
    const bridge = new NativeMessagingBridge({
      transport: createLoopbackNativeBridgeTransport()
    });

    await bridge.runCommand({
      runId: "run-loopback-bootstrap-004",
      profile: "profile-a",
      cwd: "/tmp",
      command: "runtime.bootstrap",
      params: {
        version: "v1",
        run_id: "run-loopback-bootstrap-004",
        runtime_context_id: "runtime-context-004",
        profile: "profile-a",
        fingerprint_runtime: {},
        fingerprint_patch_manifest: {},
        main_world_secret: "loopback-secret-004"
      }
    });

    await bridge.runtimePing({
      runId: "run-loopback-bootstrap-004",
      profile: "profile-a",
      cwd: "/tmp",
      params: {}
    });

    const readiness = await bridge.runCommand({
      runId: "run-loopback-bootstrap-004",
      profile: "profile-a",
      cwd: "/tmp",
      command: "runtime.readiness",
      params: {
        run_id: "run-loopback-bootstrap-004",
        runtime_context_id: "runtime-context-004"
      }
    });

    expect(readiness).toMatchObject({
      ok: true,
      payload: {
        transport_state: "ready",
        bootstrap_state: "pending"
      }
    });
  });

  it("does not let runtime.ping advance pending bootstrap to ready", async () => {
    const bridge = new NativeMessagingBridge({
      transport: createLoopbackNativeBridgeTransport()
    });

    await bridge.runCommand({
      runId: "run-loopback-bootstrap-001a",
      profile: "profile-a",
      cwd: "/tmp",
      command: "runtime.bootstrap",
      params: {
        version: "v1",
        run_id: "run-loopback-bootstrap-001a",
        runtime_context_id: "runtime-context-001a",
        profile: "profile-a",
        fingerprint_runtime: {},
        fingerprint_patch_manifest: {},
        main_world_secret: "loopback-secret-001a"
      }
    });

    const ping = await bridge.runtimePing({
      runId: "run-loopback-bootstrap-001a",
      profile: "profile-a",
      cwd: "/tmp",
      params: {
        runtime_context_id: "runtime-context-001a",
        profile: "profile-a"
      }
    });

    expect(ping).toMatchObject({
      message: "pong"
    });

    const readiness = await bridge.runCommand({
      runId: "run-loopback-bootstrap-001a",
      profile: "profile-a",
      cwd: "/tmp",
      command: "runtime.readiness",
      params: {
        run_id: "run-loopback-bootstrap-001a",
        runtime_context_id: "runtime-context-001a"
      }
    });

    expect(readiness).toMatchObject({
      ok: true,
      payload: {
        transport_state: "ready",
        bootstrap_state: "pending"
      }
    });
  });

  it("rejects malformed runtime.bootstrap envelopes that omit required trust fields", async () => {
    const bridge = new NativeMessagingBridge({
      transport: createLoopbackNativeBridgeTransport()
    });

    const bootstrap = await bridge.runCommand({
      runId: "run-loopback-bootstrap-invalid-001",
      profile: "profile-a",
      cwd: "/tmp",
      command: "runtime.bootstrap",
      params: {
        version: "v1",
        run_id: "run-loopback-bootstrap-invalid-001",
        runtime_context_id: "runtime-context-invalid-001",
        profile: "profile-a"
      }
    });

    expect(bootstrap).toMatchObject({
      ok: false,
      error: {
        code: "ERR_RUNTIME_READY_SIGNAL_CONFLICT",
        message: "invalid runtime bootstrap envelope"
      }
    });
  });
});
