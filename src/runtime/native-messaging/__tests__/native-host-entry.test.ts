import { access, mkdtemp, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import net from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { resolveProfileScopedNativeBridgeSocketPath } from "../../../install/native-host.js";

type AnyRecord = Record<string, unknown>;

const nativeHostEntryPath = resolve(
  process.cwd(),
  "dist/runtime/native-messaging/native-host-entry.js"
);

const encodeFrame = (payload: AnyRecord): Buffer => {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
};

const decodeFrames = (
  buffer: Buffer
): {
  frames: AnyRecord[];
  rest: Buffer;
} => {
  let cursor = 0;
  const frames: AnyRecord[] = [];
  while (buffer.length - cursor >= 4) {
    const bodyLength = buffer.readUInt32LE(cursor);
    const frameEnd = cursor + 4 + bodyLength;
    if (buffer.length < frameEnd) {
      break;
    }
    const body = buffer.subarray(cursor + 4, frameEnd);
    frames.push(JSON.parse(body.toString("utf8")) as AnyRecord);
    cursor = frameEnd;
  }
  return {
    frames,
    rest: buffer.subarray(cursor)
  };
};

const waitForSocket = async (socketPath: string, timeoutMs = 3_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(socketPath);
      return;
    } catch {
      // Keep polling until the broker creates the socket path.
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("socket broker did not become ready in time");
};

const sendSocketRequest = async (socketPath: string, request: AnyRecord): Promise<AnyRecord> => {
  return await new Promise<AnyRecord>((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = Buffer.alloc(0);
    socket.once("connect", () => {
      socket.write(encodeFrame(request));
    });
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const decoded = decodeFrames(buffer);
      buffer = decoded.rest;
      if (decoded.frames.length === 0) {
        return;
      }
      resolve(decoded.frames[0] as AnyRecord);
      socket.destroy();
    });
    socket.once("error", (error) => {
      reject(error);
    });
    socket.once("close", () => {
      if (buffer.length === 0) {
        return;
      }
      const decoded = decodeFrames(buffer);
      if (decoded.frames.length > 0) {
        resolve(decoded.frames[0] as AnyRecord);
      }
    });
  });
};

const writeToExtensionStdin = (child: ChildProcessWithoutNullStreams, message: AnyRecord): void => {
  child.stdin.write(encodeFrame(message));
};

const waitForStdoutFrame = async (
  frames: AnyRecord[],
  predicate: (frame: AnyRecord) => boolean,
  timeoutMs = 3_000
): Promise<AnyRecord> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const matched = frames.find(predicate);
    if (matched) {
      return matched;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("stdout frame was not produced in time");
};

const spawnNativeHostEntry = async (): Promise<{
  child: ChildProcessWithoutNullStreams;
  profileDir: string;
  socketPath: string;
  stdoutFrames: AnyRecord[];
}> => {
  const profileDir = await mkdtemp("/tmp/wvnh-");
  const socketPath = resolveProfileScopedNativeBridgeSocketPath(profileDir);
  await mkdir(dirname(socketPath), { recursive: true });
  const child = spawn(process.execPath, [nativeHostEntryPath], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      WEBENVOY_NATIVE_BRIDGE_PROFILE_DIR: profileDir
    }
  });
  const stdoutFrames: AnyRecord[] = [];
  let stdoutBuffer = Buffer.alloc(0);
  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBuffer = Buffer.concat([stdoutBuffer, chunk]);
    const decoded = decodeFrames(stdoutBuffer);
    stdoutBuffer = decoded.rest;
    stdoutFrames.push(...decoded.frames);
  });
  await waitForSocket(socketPath);
  return {
    child,
    profileDir,
    socketPath,
    stdoutFrames
  };
};

const stopNativeHostEntry = async (
  child: ChildProcessWithoutNullStreams,
  profileDir: string
): Promise<void> => {
  if (!child.killed) {
    child.kill("SIGTERM");
  }
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    setTimeout(() => resolve(), 500);
  });
  await rm(profileDir, { recursive: true, force: true });
};

describe("native-host-entry profile socket broker", () => {
  const running: Array<{ child: ChildProcessWithoutNullStreams; profileDir: string }> = [];

  afterEach(async () => {
    for (const item of running.splice(0)) {
      await stopNativeHostEntry(item.child, item.profileDir);
    }
  });

  it("falls back to a short tmp socket path when the profile path is too long", () => {
    const longProfileDir = `/tmp/${"very-long-profile-segment-".repeat(8)}profile-a`;
    const socketPath = resolveProfileScopedNativeBridgeSocketPath(longProfileDir);

    expect(socketPath.length).toBeLessThanOrEqual(96);
    expect(socketPath.endsWith(".sock")).toBe(true);
    expect(socketPath).not.toContain(longProfileDir);
  });

  it("stops advertising ready after extension stdin disconnects", async () => {
    const runtime = await spawnNativeHostEntry();
    running.push({ child: runtime.child, profileDir: runtime.profileDir });

    const beforeOpen = await sendSocketRequest(runtime.socketPath, {
      id: "cli-open-before",
      method: "bridge.open",
      profile: "profile-a",
      params: {}
    });
    expect(beforeOpen).toMatchObject({
      id: "cli-open-before",
      status: "error",
      error: { code: "ERR_TRANSPORT_HANDSHAKE_FAILED" }
    });

    writeToExtensionStdin(runtime.child, {
      id: "ext-open-001",
      method: "bridge.open",
      profile: null,
      params: {}
    });
    await waitForStdoutFrame(runtime.stdoutFrames, (frame) => frame.id === "ext-open-001");

    const afterOpen = await sendSocketRequest(runtime.socketPath, {
      id: "cli-open-after",
      method: "bridge.open",
      profile: "profile-a",
      params: {}
    });
    expect(afterOpen).toMatchObject({
      id: "cli-open-after",
      status: "success"
    });

    runtime.child.stdin.end();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const afterDisconnect = await sendSocketRequest(runtime.socketPath, {
      id: "cli-open-disconnected",
      method: "bridge.open",
      profile: "profile-a",
      params: {}
    });
    expect(afterDisconnect).toMatchObject({
      id: "cli-open-disconnected",
      status: "error",
      error: { code: "ERR_TRANSPORT_HANDSHAKE_FAILED" }
    });
  });

  it("routes concurrent same-request-id responses back to the correct cli sockets", async () => {
    const runtime = await spawnNativeHostEntry();
    running.push({ child: runtime.child, profileDir: runtime.profileDir });

    writeToExtensionStdin(runtime.child, {
      id: "ext-open-002",
      method: "bridge.open",
      profile: null,
      params: {}
    });
    await waitForStdoutFrame(runtime.stdoutFrames, (frame) => frame.id === "ext-open-002");

    const requestId = "forward-dup-001";
    const firstPromise = sendSocketRequest(runtime.socketPath, {
      id: requestId,
      method: "bridge.forward",
      profile: "profile-a",
      timeout_ms: 500,
      params: {
        session_id: "nm-session-001",
        run_id: "run-forward-first",
        command: "runtime.ping",
        command_params: {},
        cwd: "/tmp"
      }
    });
    const secondPromise = sendSocketRequest(runtime.socketPath, {
      id: requestId,
      method: "bridge.forward",
      profile: "profile-a",
      timeout_ms: 500,
      params: {
        session_id: "nm-session-001",
        run_id: "run-forward-second",
        command: "runtime.ping",
        command_params: {},
        cwd: "/tmp"
      }
    });

    await waitForStdoutFrame(
      runtime.stdoutFrames,
      (frame) =>
        frame.method === "bridge.forward" &&
        typeof frame.id === "string" &&
        String(frame.id).startsWith("cli-")
    );
    await new Promise((resolve) => setTimeout(resolve, 30));

    const forwarded = runtime.stdoutFrames.filter((frame) => frame.method === "bridge.forward");
    expect(forwarded.length).toBeGreaterThanOrEqual(2);
    const firstForward = forwarded[0] as AnyRecord;
    const secondForward = forwarded[1] as AnyRecord;
    expect(firstForward.id).not.toBe(secondForward.id);
    expect(firstForward.id).not.toBe(requestId);
    expect(secondForward.id).not.toBe(requestId);

    writeToExtensionStdin(runtime.child, {
      id: secondForward.id,
      status: "success",
      summary: { transport: "second" },
      payload: { token: "second" },
      error: null
    });
    writeToExtensionStdin(runtime.child, {
      id: firstForward.id,
      status: "success",
      summary: { transport: "first" },
      payload: { token: "first" },
      error: null
    });

    const [firstResponse, secondResponse] = await Promise.all([firstPromise, secondPromise]);
    expect(firstResponse).toMatchObject({
      id: requestId,
      status: "success"
    });
    expect(secondResponse).toMatchObject({
      id: requestId,
      status: "success"
    });
  });
});
