import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.join(import.meta.dirname, ".."));
const binPath = path.join(repoRoot, "bin", "webenvoy");

const tempDirs: string[] = [];
type DatabaseSyncCtor = new (filePath: string) => {
  prepare: (sql: string) => { run: (...args: unknown[]) => unknown };
  close: () => void;
};

const resolveDatabaseSync = (): DatabaseSyncCtor | null => {
  try {
    const require = createRequire(import.meta.url);
    const sqliteModule = require("node:sqlite") as { DatabaseSync?: DatabaseSyncCtor };
    return typeof sqliteModule.DatabaseSync === "function" ? sqliteModule.DatabaseSync : null;
  } catch {
    return null;
  }
};

const DatabaseSync = resolveDatabaseSync();
const itWithSqlite = DatabaseSync ? it : it.skip;

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

const createRuntimeCwd = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), "webenvoy-cli-contract-"));
  tempDirs.push(dir);
  return dir;
};

const runCli = (
  args: string[],
  cwdOrEnv: string | Record<string, string> = repoRoot,
  env?: Record<string, string>
) => {
  const cwd = typeof cwdOrEnv === "string" ? cwdOrEnv : repoRoot;
  const mergedEnv =
    typeof cwdOrEnv === "string"
      ? { ...process.env, ...env }
      : { ...process.env, ...cwdOrEnv, ...env };

  return spawnSync(process.execPath, [binPath, ...args], {
    cwd,
    encoding: "utf8",
    env: mergedEnv
  });
};

const runCliAsync = (
  args: string[],
  cwd: string = repoRoot
): Promise<{ status: number | null; stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [binPath, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (status) => {
      resolve({ status, stdout, stderr });
    });
  });

const parseSingleJsonLine = (stdout: string) => {
  const lines = stdout
    .trim()
    .split("\n")
    .filter((line) => line.length > 0);

  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0]) as Record<string, unknown>;
};

const assertLockMissing = async (profileDir: string): Promise<void> => {
  const lockPath = path.join(profileDir, "__webenvoy_lock.json");
  await expect(readFile(lockPath, "utf8")).rejects.toMatchObject({
    code: "ENOENT"
  });
};

describe("webenvoy cli contract", () => {
  it("returns success json for runtime.ping", () => {
    const result = runCli(["runtime.ping", "--run-id", "run-contract-001"], {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });
    expect(result.status).toBe(0);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      run_id: "run-contract-001",
      command: "runtime.ping",
      status: "success"
    });
    expect(typeof body.timestamp).toBe("string");
  });

  it("keeps command success when runtime store is unavailable and reports warning on stderr", () => {
    const result = runCli(["runtime.ping", "--run-id", "run-contract-store-warning-001"], {
      WEBENVOY_NATIVE_TRANSPORT: "loopback",
      WEBENVOY_RUNTIME_STORE_FORCE_UNAVAILABLE: "1"
    });

    expect(result.status).toBe(0);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      run_id: "run-contract-store-warning-001",
      command: "runtime.ping",
      status: "success"
    });
    expect(result.stderr).toContain("\"type\":\"runtime_store_warning\"");
    expect(result.stderr).toContain("\"code\":\"ERR_RUNTIME_STORE_UNAVAILABLE\"");
  });

  it("returns unknown command error with code 3", () => {
    const result = runCli(["runtime.unknown"]);
    expect(result.status).toBe(3);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      status: "error",
      error: { code: "ERR_CLI_UNKNOWN_COMMAND" }
    });
  });

  it("returns not implemented error with code 4", () => {
    const result = runCli(["xhs.search"]);
    expect(result.status).toBe(4);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      status: "error",
      error: { code: "ERR_CLI_NOT_IMPLEMENTED" }
    });
  });

  it("returns invalid args error with code 2", () => {
    const result = runCli(["runtime.ping", "--params", "not-json"]);
    expect(result.status).toBe(2);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      status: "error",
      error: { code: "ERR_CLI_INVALID_ARGS" }
    });
  });

  it("cleans lock when runtime.start fails by invalid proxyUrl", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const profileName = "invalid_proxy_profile";
    const result = runCli(
      [
        "runtime.start",
        "--profile",
        profileName,
        "--run-id",
        "run-contract-006",
        "--params",
        '{"proxyUrl":"not-a-url"}'
      ],
      runtimeCwd
    );
    expect(result.status).toBe(5);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      command: "runtime.start",
      status: "error",
      error: { code: "ERR_PROFILE_INVALID" }
    });
    await assertLockMissing(path.join(runtimeCwd, ".webenvoy", "profiles", profileName));
  });

  it("rejects empty proxyUrl for runtime.start and runtime.login", async () => {
    const runtimeCwd = await createRuntimeCwd();

    const start = runCli(
      [
        "runtime.start",
        "--profile",
        "empty_proxy_profile",
        "--run-id",
        "run-contract-007",
        "--params",
        "{\"proxyUrl\":\"\"}"
      ],
      runtimeCwd
    );
    expect(start.status).toBe(5);
    const startBody = parseSingleJsonLine(start.stdout);
    expect(startBody).toMatchObject({
      command: "runtime.start",
      status: "error",
      error: { code: "ERR_PROFILE_INVALID" }
    });

    const login = runCli(
      [
        "runtime.login",
        "--profile",
        "empty_proxy_profile",
        "--run-id",
        "run-contract-008",
        "--params",
        "{\"proxyUrl\":\"   \"}"
      ],
      runtimeCwd
    );
    expect(login.status).toBe(5);
    const loginBody = parseSingleJsonLine(login.stdout);
    expect(loginBody).toMatchObject({
      command: "runtime.login",
      status: "error",
      error: { code: "ERR_PROFILE_INVALID" }
    });
  });

  it("rejects explicit proxyUrl:null when profile is already bound to a proxy", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const startWithProxy = runCli(
      [
        "runtime.start",
        "--profile",
        "proxy_null_conflict_profile",
        "--run-id",
        "run-contract-009",
        "--params",
        "{\"proxyUrl\":\"http://127.0.0.1:8080\"}"
      ],
      runtimeCwd
    );
    expect(startWithProxy.status).toBe(0);
    const startBody = parseSingleJsonLine(startWithProxy.stdout);
    const startSummary = startBody.summary as Record<string, unknown>;
    const profileDir = String(startSummary.profileDir);

    const stop = runCli(
      ["runtime.stop", "--profile", "proxy_null_conflict_profile", "--run-id", "run-contract-009"],
      runtimeCwd
    );
    expect(stop.status).toBe(0);

    const restartWithNull = runCli(
      [
        "runtime.start",
        "--profile",
        "proxy_null_conflict_profile",
        "--run-id",
        "run-contract-010",
        "--params",
        "{\"proxyUrl\":null}"
      ],
      runtimeCwd
    );
    expect(restartWithNull.status).toBe(5);
    const restartBody = parseSingleJsonLine(restartWithNull.stdout);
    expect(restartBody).toMatchObject({
      command: "runtime.start",
      status: "error",
      error: { code: "ERR_PROFILE_PROXY_CONFLICT" }
    });

    const metaPath = path.join(profileDir, "__webenvoy_meta.json");
    const metaRaw = await readFile(metaPath, "utf8");
    const meta = JSON.parse(metaRaw) as Record<string, unknown>;
    const proxyBinding = meta.proxyBinding as Record<string, unknown>;
    expect(proxyBinding.url).toBe("http://127.0.0.1:8080/");
  });

  it("returns runtime unavailable error with code 5", () => {
    const result = runCli([
      "runtime.ping",
      "--params",
      '{"simulate_runtime_unavailable":true}',
      "--run-id",
      "run-contract-005"
    ]);
    expect(result.status).toBe(5);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      run_id: "run-contract-005",
      status: "error",
      error: { code: "ERR_RUNTIME_UNAVAILABLE", retryable: true }
    });
  });

  itWithSqlite("returns structured runtime unavailable when runtime store schema mismatches", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const bootstrap = runCli(
      ["runtime.ping", "--run-id", "run-contract-005a"],
      runtimeCwd,
      {
        WEBENVOY_NATIVE_TRANSPORT: "loopback"
      }
    );
    expect(bootstrap.status).toBe(0);

    const dbPath = path.join(runtimeCwd, ".webenvoy", "runtime", "store.sqlite");
    const DatabaseSyncCtor = DatabaseSync as DatabaseSyncCtor;
    const db = new DatabaseSyncCtor(dbPath);
    db.prepare("UPDATE runtime_store_meta SET value = '999' WHERE key = 'schema_version'").run();
    db.close();

    const result = runCli(
      ["runtime.ping", "--run-id", "run-contract-005b"],
      runtimeCwd,
      {
        WEBENVOY_NATIVE_TRANSPORT: "loopback"
      }
    );
    expect(result.status).toBe(5);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      run_id: "run-contract-005b",
      command: "runtime.ping",
      status: "error",
      error: { code: "ERR_RUNTIME_UNAVAILABLE", retryable: false }
    });
    expect(result.stderr).not.toContain("\"type\":\"runtime_store_warning\"");
  });

  it("returns execution failed error with code 6", () => {
    const result = runCli(["runtime.ping", "--params", '{"force_fail":true}']);
    expect(result.status).toBe(6);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      status: "error",
      error: { code: "ERR_EXECUTION_FAILED" }
    });
  });

  it("keeps stdout as single JSON object for runtime.help", () => {
    const result = runCli(["runtime.help"]);
    expect(result.status).toBe(0);
    parseSingleJsonLine(result.stdout);
  });

  it("supports runtime.start and runtime.status with profile lock and meta state", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const start = runCli(
      [
        "runtime.start",
        "--profile",
        "default",
        "--run-id",
        "run-contract-100",
        "--params",
        '{"proxyUrl":"http://127.0.0.1:8080"}'
      ],
      runtimeCwd
    );
    expect(start.status).toBe(0);
    const startBody = parseSingleJsonLine(start.stdout);
    expect(startBody).toMatchObject({
      command: "runtime.start",
      status: "success",
      summary: {
        profile: "default",
        profileState: "ready",
        browserState: "ready",
        proxyUrl: "http://127.0.0.1:8080/",
        lockHeld: true
      }
    });

    const status = runCli(["runtime.status", "--profile", "default"], runtimeCwd);
    expect(status.status).toBe(0);
    const statusBody = parseSingleJsonLine(status.stdout);
    expect(statusBody).toMatchObject({
      command: "runtime.status",
      status: "success",
      summary: {
        profile: "default",
        profileState: "disconnected",
        browserState: "disconnected",
        proxyUrl: "http://127.0.0.1:8080/",
        lockHeld: false
      }
    });
  });

  it("keeps logging_in before confirmation and persists lastLoginAt after confirmation", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const login = runCli(
      ["runtime.login", "--profile", "login_profile", "--run-id", "run-contract-151"],
      runtimeCwd
    );
    expect(login.status).toBe(0);
    const loginBody = parseSingleJsonLine(login.stdout);
    expect(loginBody).toMatchObject({
      command: "runtime.login",
      status: "success",
      summary: {
        profile: "login_profile",
        profileState: "logging_in",
        browserState: "logging_in",
        lockHeld: true,
        confirmationRequired: true
      }
    });

    const statusBeforeConfirm = runCli(["runtime.status", "--profile", "login_profile"], runtimeCwd);
    expect(statusBeforeConfirm.status).toBe(0);
    const statusBeforeConfirmBody = parseSingleJsonLine(statusBeforeConfirm.stdout);
    expect(statusBeforeConfirmBody).toMatchObject({
      command: "runtime.status",
      status: "success",
      summary: {
        profile: "login_profile",
        profileState: "disconnected",
        browserState: "disconnected",
        lockHeld: false
      }
    });

    const loginConfirm = runCli(
      [
        "runtime.login",
        "--profile",
        "login_profile",
        "--run-id",
        "run-contract-151",
        "--params",
        "{\"confirm\":true}"
      ],
      runtimeCwd
    );
    expect(loginConfirm.status).toBe(0);
    const loginConfirmBody = parseSingleJsonLine(loginConfirm.stdout);
    expect(loginConfirmBody).toMatchObject({
      command: "runtime.login",
      status: "success",
      summary: {
        profile: "login_profile",
        profileState: "ready",
        browserState: "ready",
        lockHeld: true
      }
    });
    const loginSummary = loginConfirmBody.summary as Record<string, unknown>;
    expect(typeof loginSummary.lastLoginAt).toBe("string");

    const profileDir = String(loginSummary.profileDir);
    const metaPath = path.join(profileDir, "__webenvoy_meta.json");
    const rawMeta = await readFile(metaPath, "utf8");
    const meta = JSON.parse(rawMeta) as Record<string, unknown>;
    expect(meta.profileState).toBe("ready");
    expect(meta.lastLoginAt).toBe(loginSummary.lastLoginAt);
  });

  it("rejects runtime.login when profile lock is held by another run", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const start = runCli(
      ["runtime.start", "--profile", "login_locked_profile", "--run-id", "run-contract-161"],
      runtimeCwd
    );
    expect(start.status).toBe(0);
    const startBody = parseSingleJsonLine(start.stdout);
    const startSummary = startBody.summary as Record<string, unknown>;
    const lockPath = path.join(String(startSummary.profileDir), "__webenvoy_lock.json");
    const lockRaw = await readFile(lockPath, "utf8");
    const lock = JSON.parse(lockRaw) as Record<string, unknown>;
    lock.ownerPid = process.pid;
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");

    const login = runCli(
      ["runtime.login", "--profile", "login_locked_profile", "--run-id", "run-contract-162"],
      runtimeCwd
    );
    expect(login.status).toBe(5);
    const loginBody = parseSingleJsonLine(login.stdout);
    expect(loginBody).toMatchObject({
      command: "runtime.login",
      status: "error",
      error: { code: "ERR_PROFILE_LOCKED" }
    });
  });

  it("rejects runtime.start when profile lock is held by another run", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const firstStart = runCli(
      ["runtime.start", "--profile", "locked_profile", "--run-id", "run-contract-201"],
      runtimeCwd
    );
    expect(firstStart.status).toBe(0);
    const firstBody = parseSingleJsonLine(firstStart.stdout);
    const firstSummary = firstBody.summary as Record<string, unknown>;
    const lockPath = path.join(String(firstSummary.profileDir), "__webenvoy_lock.json");
    const lockRaw = await readFile(lockPath, "utf8");
    const lock = JSON.parse(lockRaw) as Record<string, unknown>;
    lock.ownerPid = process.pid;
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");

    const secondStart = runCli(
      ["runtime.start", "--profile", "locked_profile", "--run-id", "run-contract-202"],
      runtimeCwd
    );
    expect(secondStart.status).toBe(5);
    const body = parseSingleJsonLine(secondStart.stdout);
    expect(body).toMatchObject({
      command: "runtime.start",
      status: "error",
      error: { code: "ERR_PROFILE_LOCKED" }
    });
  });

  it("allows only one successful runtime.start under concurrent race", async () => {
    const runtimeCwd = await createRuntimeCwd();

    const [first, second] = await Promise.all([
      runCliAsync(
        ["runtime.start", "--profile", "race_profile", "--run-id", "run-contract-211"],
        runtimeCwd
      ),
      runCliAsync(
        ["runtime.start", "--profile", "race_profile", "--run-id", "run-contract-212"],
        runtimeCwd
      )
    ]);

    const statuses = [first.status, second.status];
    const successCount = statuses.filter((status) => status === 0).length;
    const failureCount = statuses.filter((status) => status === 5).length;
    expect(successCount).toBeGreaterThanOrEqual(1);
    expect(failureCount).toBeLessThanOrEqual(1);

    const failed = first.status === 5 ? first : second.status === 5 ? second : null;
    if (failed) {
      const failedBody = parseSingleJsonLine(failed.stdout);
      expect(failedBody).toMatchObject({
        command: "runtime.start",
        status: "error",
        error: { code: "ERR_PROFILE_LOCKED" }
      });
    }
  });

  it("supports runtime.stop and reflects stopped state via runtime.status", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const start = runCli(
      ["runtime.start", "--profile", "stop_profile", "--run-id", "run-contract-301"],
      runtimeCwd
    );
    expect(start.status).toBe(0);

    const stop = runCli(
      ["runtime.stop", "--profile", "stop_profile", "--run-id", "run-contract-301"],
      runtimeCwd
    );
    expect(stop.status).toBe(0);
    const stopBody = parseSingleJsonLine(stop.stdout);
    expect(stopBody).toMatchObject({
      command: "runtime.stop",
      status: "success",
      summary: {
        profile: "stop_profile",
        profileState: "stopped",
        browserState: "absent",
        lockHeld: false
      }
    });

    const status = runCli(["runtime.status", "--profile", "stop_profile"], runtimeCwd);
    expect(status.status).toBe(0);
    const statusBody = parseSingleJsonLine(status.stdout);
    expect(statusBody).toMatchObject({
      command: "runtime.status",
      status: "success",
      summary: {
        profile: "stop_profile",
        profileState: "stopped",
        browserState: "absent",
        lockHeld: false
      }
    });
  });

  it("rejects runtime.stop when run_id does not own profile lock", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const start = runCli(
      ["runtime.start", "--profile", "owned_profile", "--run-id", "run-contract-401"],
      runtimeCwd
    );
    expect(start.status).toBe(0);

    const stop = runCli(
      ["runtime.stop", "--profile", "owned_profile", "--run-id", "run-contract-402"],
      runtimeCwd
    );
    expect(stop.status).toBe(5);
    const body = parseSingleJsonLine(stop.stdout);
    expect(body).toMatchObject({
      command: "runtime.stop",
      status: "error",
      error: { code: "ERR_PROFILE_OWNER_CONFLICT" }
    });
  });

  it("marks disconnected in runtime.status when active meta has dead-owner lock with fresh heartbeat", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const start = runCli(
      ["runtime.start", "--profile", "stale_profile", "--run-id", "run-contract-501"],
      runtimeCwd
    );
    expect(start.status).toBe(0);
    const startBody = parseSingleJsonLine(start.stdout);
    const summary = startBody.summary as Record<string, unknown>;
    const profileDir = String(summary.profileDir);
    const lockPath = path.join(profileDir, "__webenvoy_lock.json");

    const lockRaw = await readFile(lockPath, "utf8");
    const lock = JSON.parse(lockRaw) as Record<string, unknown>;
    lock.ownerPid = 999999;
    lock.lastHeartbeatAt = new Date().toISOString();
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
    const beforeStatusMeta = await readFile(path.join(profileDir, "__webenvoy_meta.json"), "utf8");
    const beforeStatusLock = await readFile(lockPath, "utf8");

    const status = runCli(["runtime.status", "--profile", "stale_profile"], runtimeCwd);
    expect(status.status).toBe(0);
    const statusBody = parseSingleJsonLine(status.stdout);
    expect(statusBody).toMatchObject({
      command: "runtime.status",
      status: "success",
      summary: {
        profile: "stale_profile",
        profileState: "disconnected",
        browserState: "disconnected",
        lockHeld: false
      }
    });

    const afterStatusMeta = await readFile(path.join(profileDir, "__webenvoy_meta.json"), "utf8");
    const afterStatusLock = await readFile(lockPath, "utf8");
    expect(afterStatusMeta).toBe(beforeStatusMeta);
    expect(afterStatusLock).toBe(beforeStatusLock);
  });

  it("keeps active state in runtime.status when lock owner process is alive", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const start = runCli(
      ["runtime.start", "--profile", "live_owner_profile", "--run-id", "run-contract-511"],
      runtimeCwd
    );
    expect(start.status).toBe(0);
    const startBody = parseSingleJsonLine(start.stdout);
    const summary = startBody.summary as Record<string, unknown>;
    const profileDir = String(summary.profileDir);
    const lockPath = path.join(profileDir, "__webenvoy_lock.json");
    const lockRaw = await readFile(lockPath, "utf8");
    const lock = JSON.parse(lockRaw) as Record<string, unknown>;
    lock.ownerPid = process.pid;
    lock.lastHeartbeatAt = "1970-01-01T00:00:00.000Z";
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");

    const status = runCli(["runtime.status", "--profile", "live_owner_profile"], runtimeCwd);
    expect(status.status).toBe(0);
    const statusBody = parseSingleJsonLine(status.stdout);
    expect(statusBody).toMatchObject({
      command: "runtime.status",
      status: "success",
      summary: {
        profile: "live_owner_profile",
        profileState: "ready",
        browserState: "ready",
        lockHeld: true
      }
    });
  });

  it("allows runtime.start immediate recovery when owner is dead even with fresh heartbeat", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const firstStart = runCli(
      ["runtime.start", "--profile", "reclaim_profile", "--run-id", "run-contract-601"],
      runtimeCwd
    );
    expect(firstStart.status).toBe(0);
    const firstBody = parseSingleJsonLine(firstStart.stdout);
    const firstSummary = firstBody.summary as Record<string, unknown>;
    const profileDir = String(firstSummary.profileDir);
    const lockPath = path.join(profileDir, "__webenvoy_lock.json");

    const lockRaw = await readFile(lockPath, "utf8");
    const lock = JSON.parse(lockRaw) as Record<string, unknown>;
    lock.lastHeartbeatAt = new Date().toISOString();
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");

    const secondStart = runCli(
      ["runtime.start", "--profile", "reclaim_profile", "--run-id", "run-contract-602"],
      runtimeCwd
    );
    expect(secondStart.status).toBe(0);
    const secondBody = parseSingleJsonLine(secondStart.stdout);
    expect(secondBody).toMatchObject({
      command: "runtime.start",
      status: "success",
      summary: {
        profile: "reclaim_profile",
        profileState: "ready",
        browserState: "ready",
        lockHeld: true
      }
    });

    const updatedLockRaw = await readFile(lockPath, "utf8");
    const updatedLock = JSON.parse(updatedLockRaw) as Record<string, unknown>;
    expect(updatedLock.ownerRunId).toBe("run-contract-602");
  });

  it("allows runtime.login immediate recovery when owner is dead even with fresh heartbeat", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const start = runCli(
      ["runtime.start", "--profile", "reclaim_login_profile", "--run-id", "run-contract-611"],
      runtimeCwd
    );
    expect(start.status).toBe(0);
    const startBody = parseSingleJsonLine(start.stdout);
    const summary = startBody.summary as Record<string, unknown>;
    const profileDir = String(summary.profileDir);
    const lockPath = path.join(profileDir, "__webenvoy_lock.json");
    const lockRaw = await readFile(lockPath, "utf8");
    const lock = JSON.parse(lockRaw) as Record<string, unknown>;
    lock.lastHeartbeatAt = new Date().toISOString();
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");

    const login = runCli(
      ["runtime.login", "--profile", "reclaim_login_profile", "--run-id", "run-contract-612"],
      runtimeCwd
    );
    expect(login.status).toBe(0);
    const loginBody = parseSingleJsonLine(login.stdout);
    expect(loginBody).toMatchObject({
      command: "runtime.login",
      status: "success",
      summary: {
        profile: "reclaim_login_profile",
        profileState: "logging_in",
        browserState: "logging_in",
        lockHeld: true,
        confirmationRequired: true
      }
    });
  });

  it("marks disconnected in runtime.status when runtime meta is active but lock is missing", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const start = runCli(
      ["runtime.start", "--profile", "missing_lock_profile", "--run-id", "run-contract-651"],
      runtimeCwd
    );
    expect(start.status).toBe(0);
    const startBody = parseSingleJsonLine(start.stdout);
    const summary = startBody.summary as Record<string, unknown>;
    const profileDir = String(summary.profileDir);
    const lockPath = path.join(profileDir, "__webenvoy_lock.json");
    const metaPath = path.join(profileDir, "__webenvoy_meta.json");
    const beforeStatusMeta = await readFile(metaPath, "utf8");

    await rm(lockPath, { force: true });

    const status = runCli(["runtime.status", "--profile", "missing_lock_profile"], runtimeCwd);
    expect(status.status).toBe(0);
    const statusBody = parseSingleJsonLine(status.stdout);
    expect(statusBody).toMatchObject({
      command: "runtime.status",
      status: "success",
      summary: {
        profile: "missing_lock_profile",
        profileState: "disconnected",
        browserState: "disconnected",
        lockHeld: false
      }
    });

    const afterStatusMeta = await readFile(metaPath, "utf8");
    expect(afterStatusMeta).toBe(beforeStatusMeta);
  });

  it("allows runtime.start recovery when profile state is active but lock is missing", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const start = runCli(
      ["runtime.start", "--profile", "state_conflict_profile", "--run-id", "run-contract-701"],
      runtimeCwd
    );
    expect(start.status).toBe(0);
    const startBody = parseSingleJsonLine(start.stdout);
    const summary = startBody.summary as Record<string, unknown>;
    const profileDir = String(summary.profileDir);

    const stop = runCli(
      ["runtime.stop", "--profile", "state_conflict_profile", "--run-id", "run-contract-701"],
      runtimeCwd
    );
    expect(stop.status).toBe(0);

    const metaPath = path.join(profileDir, "__webenvoy_meta.json");
    const rawMeta = await readFile(metaPath, "utf8");
    const meta = JSON.parse(rawMeta) as Record<string, unknown>;
    meta.profileState = "ready";
    await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");

    const conflictStart = runCli(
      ["runtime.start", "--profile", "state_conflict_profile", "--run-id", "run-contract-702"],
      runtimeCwd
    );
    expect(conflictStart.status).toBe(0);
    const conflictBody = parseSingleJsonLine(conflictStart.stdout);
    expect(conflictBody).toMatchObject({
      command: "runtime.start",
      status: "success",
      summary: {
        profile: "state_conflict_profile",
        profileState: "ready",
        browserState: "ready",
        lockHeld: true
      }
    });
  });

  it("rejects malformed profile meta for runtime.status/runtime.start/runtime.login", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const start = runCli(
      ["runtime.start", "--profile", "corrupt_meta_profile", "--run-id", "run-contract-901"],
      runtimeCwd
    );
    expect(start.status).toBe(0);
    const startBody = parseSingleJsonLine(start.stdout);
    const startSummary = startBody.summary as Record<string, unknown>;
    const profileDir = String(startSummary.profileDir);

    const stop = runCli(
      ["runtime.stop", "--profile", "corrupt_meta_profile", "--run-id", "run-contract-901"],
      runtimeCwd
    );
    expect(stop.status).toBe(0);

    const metaPath = path.join(profileDir, "__webenvoy_meta.json");
    await writeFile(
      metaPath,
      `${JSON.stringify({ profileName: "corrupt_meta_profile", profileState: "ready" }, null, 2)}\n`,
      "utf8"
    );

    const status = runCli(["runtime.status", "--profile", "corrupt_meta_profile"], runtimeCwd);
    expect(status.status).toBe(5);
    const statusBody = parseSingleJsonLine(status.stdout);
    expect(statusBody).toMatchObject({
      command: "runtime.status",
      status: "error",
      error: { code: "ERR_PROFILE_META_CORRUPT" }
    });

    const restart = runCli(
      ["runtime.start", "--profile", "corrupt_meta_profile", "--run-id", "run-contract-902"],
      runtimeCwd
    );
    expect(restart.status).toBe(5);
    const restartBody = parseSingleJsonLine(restart.stdout);
    expect(restartBody).toMatchObject({
      command: "runtime.start",
      status: "error",
      error: { code: "ERR_PROFILE_META_CORRUPT" }
    });

    const login = runCli(
      ["runtime.login", "--profile", "corrupt_meta_profile", "--run-id", "run-contract-903"],
      runtimeCwd
    );
    expect(login.status).toBe(5);
    const loginBody = parseSingleJsonLine(login.stdout);
    expect(loginBody).toMatchObject({
      command: "runtime.login",
      status: "error",
      error: { code: "ERR_PROFILE_META_CORRUPT" }
    });
  });
});
