import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildRuntimeBootstrapContextId } from "../src/runtime/runtime-bootstrap.js";
import { resolveRuntimeStorePath } from "../src/runtime/store/sqlite-runtime-store.js";

const repoRoot = path.resolve(path.join(import.meta.dirname, ".."));
const binPath = path.join(repoRoot, "bin", "webenvoy");
const mockBrowserPath = path.join(repoRoot, "tests", "fixtures", "mock-browser.sh");
const nativeHostMockPath = path.join(repoRoot, "tests", "fixtures", "native-host-mock.mjs");
const repoOwnedNativeHostEntryPath = path.join(
  repoRoot,
  "dist",
  "runtime",
  "native-messaging",
  "native-host-entry.js"
);
const browserStateFilename = "__webenvoy_browser_instance.json";

const tempDirs: string[] = [];
export type DatabaseSyncCtor = new (filePath: string) => {
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

const createNativeHostManifest = async (input: {
  nativeHostName?: string;
  allowedOrigins: string[];
}): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), "webenvoy-native-host-manifest-"));
  tempDirs.push(dir);
  const manifestPath = path.join(dir, `${input.nativeHostName ?? "com.webenvoy.host"}.json`);
  const launcherPath = path.join(dir, "mock-webenvoy-host");
  await writeFile(launcherPath, "#!/usr/bin/env bash\nexit 0\n", "utf8");
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        name: input.nativeHostName ?? "com.webenvoy.host",
        path: launcherPath,
        type: "stdio",
        allowed_origins: input.allowedOrigins
      },
      null,
      2
    )}\n`
  );
  return manifestPath;
};

const seedInstalledPersistentExtension = async (input: {
  cwd: string;
  profile: string;
  extensionId?: string;
  enabled?: boolean;
}): Promise<void> => {
  const extensionId = input.extensionId ?? "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const profileDir = path.join(input.cwd, ".webenvoy", "profiles", input.profile, "Default");
  const extensionDir = path.join(profileDir, "Extensions", extensionId, "1.0.0");
  await mkdir(extensionDir, { recursive: true });
  await writeFile(path.join(extensionDir, "manifest.json"), "{\n  \"manifest_version\": 3\n}\n");
  await writeFile(
    path.join(profileDir, "Preferences"),
    `${JSON.stringify(
      {
        extensions: {
          settings: {
            [extensionId]: {
              state: input.enabled === false ? 0 : 1
            }
          }
        }
      },
      null,
      2
    )}\n`
  );
};


const defaultRuntimeEnv = (cwd: string): Record<string, string> => ({
  NODE_ENV: "test",
  WEBENVOY_BROWSER_PATH: mockBrowserPath,
  WEBENVOY_BROWSER_MOCK_LOG: path.join(cwd, ".browser-launch.log"),
  WEBENVOY_BROWSER_MOCK_TTL: "2",
  WEBENVOY_NATIVE_HOST_MANIFEST_DIR: path.join(
    cwd,
    ".webenvoy",
    "native-host-install",
    "chrome",
    "manifests"
  )
});

let cliContractRuntimeBuilt = false;
const runtimeBuildRepoKey = createHash("sha1").update(repoRoot).digest("hex").slice(0, 12);
const runtimeBuildSession =
  process.env.WEBENVOY_CLI_CONTRACT_BUILD_SESSION ??
  `ppid-${String(process.ppid)}`;
const runtimeBuildLockRoot = path.join(
  tmpdir(),
  "webenvoy-cli-contract-runtime-build",
  runtimeBuildRepoKey,
  runtimeBuildSession
);
const runtimeBuildLockDir = path.join(runtimeBuildLockRoot, "lock");
const runtimeBuildSuccessMarker = path.join(runtimeBuildLockRoot, "success");
const runtimeBuildFailureMarker = path.join(runtimeBuildLockRoot, "failure");

const sleep = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

const waitForRuntimeBuildRelease = (): void => {
  const deadline = Date.now() + 60_000;
  while (existsSync(runtimeBuildLockDir)) {
    if (Date.now() >= deadline) {
      throw new Error("timed out waiting for CLI runtime build lock");
    }
    sleep(100);
  }

  if (existsSync(runtimeBuildSuccessMarker)) {
    cliContractRuntimeBuilt = true;
    return;
  }

  if (existsSync(runtimeBuildFailureMarker)) {
    const failureMessage = readFileSync(runtimeBuildFailureMarker, "utf8").trim();
    throw new Error(failureMessage || "CLI runtime build failed in another suite worker");
  }

  throw new Error("CLI runtime build lock released without success marker");
};

const ensureFreshCliContractRuntimeBuild = (): void => {
  if (process.env.WEBENVOY_CLI_CONTRACT_RUNTIME_PREBUILT === "1") {
    cliContractRuntimeBuilt = true;
  }

  if (cliContractRuntimeBuilt) {
    return;
  }

  mkdirSync(runtimeBuildLockRoot, { recursive: true });

  try {
    mkdirSync(runtimeBuildLockDir);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "EEXIST"
    ) {
      waitForRuntimeBuildRelease();
      return;
    }
    throw error;
  }

  try {
    if (!existsSync(runtimeBuildSuccessMarker)) {
      const buildResult = spawnSync("npm", ["run", "build:runtime"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env
        }
      });

      if (buildResult.status !== 0) {
        writeFileSync(
          runtimeBuildFailureMarker,
          [
            "failed to rebuild CLI runtime before contract suite",
            `status=${String(buildResult.status)}`,
            `error=${buildResult.error instanceof Error ? buildResult.error.message : ""}`,
            `stdout=${buildResult.stdout ?? ""}`,
            `stderr=${buildResult.stderr ?? ""}`
          ].join(": "),
          "utf8"
        );
        throw new Error(
          [
            "failed to rebuild CLI runtime before contract suite",
            `status=${String(buildResult.status)}`,
            `error=${buildResult.error instanceof Error ? buildResult.error.message : ""}`,
            `stdout=${buildResult.stdout ?? ""}`,
            `stderr=${buildResult.stderr ?? ""}`
          ].join(": ")
        );
      }

      writeFileSync(runtimeBuildSuccessMarker, `${Date.now()}\n`, "utf8");
    }

    cliContractRuntimeBuilt = true;
  } finally {
    rmSync(runtimeBuildLockDir, { recursive: true, force: true });
  }
}

const runCli = (
  args: string[],
  cwdOrEnv: string | Record<string, string> = repoRoot,
  env?: Record<string, string>
) => {
  ensureFreshCliContractRuntimeBuild();
  const cwd = typeof cwdOrEnv === "string" ? cwdOrEnv : repoRoot;
  const mergedEnv =
    typeof cwdOrEnv === "string"
      ? { ...process.env, ...defaultRuntimeEnv(cwd), ...env }
      : { ...process.env, ...defaultRuntimeEnv(cwd), ...cwdOrEnv, ...env };

  return spawnSync(process.execPath, [binPath, ...args], {
    cwd,
    encoding: "utf8",
    env: mergedEnv
  });
};

const expectBundledNativeHostStarts = async (
  entryPath: string,
  env?: Record<string, string>
): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [entryPath], {
      env: {
        ...process.env,
        ...env
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stderr = "";
    let settled = false;

    const settle = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(startedTimer);
      clearTimeout(forceKillTimer);
      callback();
    };

    const startedTimer = setTimeout(() => {
      child.kill("SIGTERM");
      settle(resolve);
    }, 250);
    startedTimer.unref?.();

    const forceKillTimer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 1000);
    forceKillTimer.unref?.();

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.once("error", (error) => {
      settle(() => reject(error));
    });

    child.once("exit", (code, signal) => {
      settle(() =>
        reject(
          new Error(
            `bundled native host exited before startup timeout (code=${String(code)}, signal=${String(signal)}): ${stderr.trim()}`
          )
        )
      );
    });
  });
};

const createNativeHostCommand = (scriptPath: string): string =>
  `"${process.execPath}" "${scriptPath}"`;

const createShellWrappedNativeHostCommand = (scriptPath: string): string =>
  `"/bin/bash" "${scriptPath}"`;

const PROFILE_MODE_ROOT_PREFERRED = "profile_root_preferred";

const quoteLauncherExportValue = (value: string): string => value.replace(/'/g, `'\"'\"'`);

const resolveCanonicalExpectedProfileDir = async (runtimeCwd: string, profileDir: string): Promise<string> => {
  const expectedProfileRoot = path.join(await realpath(runtimeCwd), ".webenvoy", "profiles");
  const requestedProfileRoot = path.join(runtimeCwd, ".webenvoy", "profiles");
  return path.join(expectedProfileRoot, path.relative(requestedProfileRoot, path.resolve(profileDir)));
};

const expectProfileRootOnlyLauncherContract = async (input: {
  launcherPath: string;
  runtimeCwd: string;
}): Promise<string> => {
  const launcherRaw = await readFile(input.launcherPath, "utf8");
  const expectedProfileRoot = path.join(await realpath(input.runtimeCwd), ".webenvoy", "profiles");
  expect(launcherRaw).toContain(
    `export WEBENVOY_NATIVE_BRIDGE_PROFILE_ROOT='${quoteLauncherExportValue(expectedProfileRoot)}'`
  );
  expect(launcherRaw).not.toContain("WEBENVOY_NATIVE_BRIDGE_PROFILE_DIR");
  expect(launcherRaw).not.toContain("WEBENVOY_NATIVE_BRIDGE_PROFILE_MODE");
  return launcherRaw;
};

const expectDualEnvRootPreferredLauncherContract = async (input: {
  launcherPath: string;
  runtimeCwd: string;
  profileDir: string;
}): Promise<string> => {
  const launcherRaw = await readFile(input.launcherPath, "utf8");
  const expectedProfileRoot = path.join(await realpath(input.runtimeCwd), ".webenvoy", "profiles");
  const expectedProfileDir = await resolveCanonicalExpectedProfileDir(input.runtimeCwd, input.profileDir);
  expect(launcherRaw).toContain(
    `export WEBENVOY_NATIVE_BRIDGE_PROFILE_ROOT='${quoteLauncherExportValue(expectedProfileRoot)}'`
  );
  expect(launcherRaw).toContain(
    `export WEBENVOY_NATIVE_BRIDGE_PROFILE_DIR='${quoteLauncherExportValue(expectedProfileDir)}'`
  );
  expect(launcherRaw).toContain(
    `export WEBENVOY_NATIVE_BRIDGE_PROFILE_MODE='${PROFILE_MODE_ROOT_PREFERRED}'`
  );
  return launcherRaw;
};

const runGit = (cwd: string, args: string[]) => {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8"
  });
  expect(result.status).toBe(0);
  return result.stdout.trim();
};

const createGitWorktreePair = async (): Promise<{
  repositoryCwd: string;
  linkedWorktreeCwd: string;
  sharedManifestRoot: string;
}> => {
  const baseDir = await mkdtemp(path.join(tmpdir(), "webenvoy-cli-worktree-"));
  tempDirs.push(baseDir);
  const repositoryCwd = path.join(baseDir, "repo");
  const linkedWorktreeCwd = path.join(baseDir, "repo-feature");
  const sharedManifestRoot = path.join(baseDir, "shared-manifests");
  await mkdir(repositoryCwd, { recursive: true });
  await mkdir(sharedManifestRoot, { recursive: true });
  runGit(repositoryCwd, ["init"]);
  await writeFile(path.join(repositoryCwd, "README.md"), "# temp repo\n", "utf8");
  runGit(repositoryCwd, ["add", "README.md"]);
  runGit(repositoryCwd, [
    "-c",
    "user.name=WebEnvoy Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-m",
    "init"
  ]);
  runGit(repositoryCwd, ["worktree", "add", "-b", "feat/test-cli-worktree", linkedWorktreeCwd]);
  return {
    repositoryCwd,
    linkedWorktreeCwd,
    sharedManifestRoot
  };
};

const runCliAsync = (
  args: string[],
  cwd: string = repoRoot,
  env?: Record<string, string>
): Promise<{ status: number | null; stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    ensureFreshCliContractRuntimeBuild();
    const child = spawn(process.execPath, [binPath, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...defaultRuntimeEnv(cwd), ...env }
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

const encodeNativeBridgeEnvelope = (envelope: Record<string, unknown>): Buffer => {
  const body = Buffer.from(JSON.stringify(envelope), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
};

const readSingleNativeBridgeEnvelope = async (
  stream: NodeJS.ReadableStream
): Promise<Record<string, unknown>> =>
  new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);

    const cleanup = () => {
      stream.off("data", onData);
      stream.off("error", onError);
      stream.off("end", onEnd);
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const onEnd = () => {
      cleanup();
      reject(new Error("native bridge stdout ended before a framed response"));
    };

    const onData = (chunk: Buffer | string) => {
      buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
      if (buffer.length < 4) {
        return;
      }
      const frameLength = buffer.readUInt32LE(0);
      const frameEnd = 4 + frameLength;
      if (buffer.length < frameEnd) {
        return;
      }
      cleanup();
      resolve(JSON.parse(buffer.subarray(4, frameEnd).toString("utf8")) as Record<string, unknown>);
    };

    stream.on("data", onData);
    stream.on("error", onError);
    stream.on("end", onEnd);
  });

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const resolveCliGateEnvelope = (body: Record<string, unknown>): Record<string, unknown> => {
  const summary = asRecord(body.summary);
  if (summary) {
    return summary;
  }
  const error = asRecord(body.error);
  const details = asRecord(error?.details);
  return details ?? {};
};

const resolveWriteInteractionTier = (envelope: Record<string, unknown>): string | null => {
  const direct = envelope.write_interaction_tier;
  if (typeof direct === "string") {
    return direct;
  }
  const consumerGateResult = asRecord(envelope.consumer_gate_result);
  if (typeof consumerGateResult?.write_interaction_tier === "string") {
    return consumerGateResult.write_interaction_tier;
  }
  const writeActionMatrix = asRecord(envelope.write_action_matrix);
  if (typeof writeActionMatrix?.write_interaction_tier === "string") {
    return writeActionMatrix.write_interaction_tier;
  }
  const writeActionMatrixDecisions = asRecord(envelope.write_action_matrix_decisions);
  if (typeof writeActionMatrixDecisions?.write_interaction_tier === "string") {
    return writeActionMatrixDecisions.write_interaction_tier;
  }
  return null;
};

const scopedXhsGateOptions = {
  target_domain: "www.xiaohongshu.com",
  target_tab_id: 32,
  target_page: "search_result_tab",
  requested_execution_mode: "dry_run"
};

const assertLockMissing = async (profileDir: string): Promise<void> => {
  const lockPath = path.join(profileDir, "__webenvoy_lock.json");
  await expect(readFile(lockPath, "utf8")).rejects.toMatchObject({
    code: "ENOENT"
  });
};

const detectSystemChromePath = (): string | null => {
  const envPath = process.env.WEBENVOY_REAL_BROWSER_PATH;
  if (typeof envPath === "string" && envPath.length > 0) {
    return envPath;
  }
  const candidates =
    process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : process.platform === "linux"
        ? ["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/bin/chromium"]
        : [
            "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
            "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
          ];
  for (const candidate of candidates) {
    const check = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (check.status === 0) {
      return candidate;
    }
  }
  return null;
};

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const runHeadlessDomProbe = (
  browserPath: string,
  profileDir: string,
  url: string
): { status: number | null; stdout: string; stderr: string } =>
  spawnSync(
    browserPath,
    [
      `--user-data-dir=${profileDir}`,
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--virtual-time-budget=1500",
      "--dump-dom",
      url
    ],
    {
      encoding: "utf8"
    }
  );

const realBrowserContractsEnabled = process.env.WEBENVOY_RUN_REAL_BROWSER === "1";
const BROWSER_STATE_FILENAME = "__webenvoy_browser_instance.json";
const BROWSER_CONTROL_FILENAME = "__webenvoy_browser_control.json";

const isPidAlive = (pid: number): boolean => {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    return nodeError.code === "EPERM";
  }
};

const scopedReadGateOptions = {
  target_domain: "www.xiaohongshu.com",
  target_tab_id: 32,
  target_page: "search_result_tab",
  action_type: "read"
} as const;


Object.assign(globalThis as Record<string, unknown>, {
  __webenvoyCliContract: {
    spawn,
    spawnSync,
    createServer,
    chmod,
    mkdir,
    mkdtemp,
    readFile,
    realpath,
    rm,
    stat,
    symlink,
    writeFile,
    createRequire,
    tmpdir,
    path,
    afterEach,
    describe,
    expect,
    it,
    buildRuntimeBootstrapContextId,
    resolveRuntimeStorePath,
    repoRoot,
    binPath,
    mockBrowserPath,
    nativeHostMockPath,
    repoOwnedNativeHostEntryPath,
    browserStateFilename,
    tempDirs,
    DatabaseSync,
    itWithSqlite,
    createRuntimeCwd,
    createNativeHostManifest,
    seedInstalledPersistentExtension,
    defaultRuntimeEnv,
    runCli,
    expectBundledNativeHostStarts,
    createNativeHostCommand,
    createShellWrappedNativeHostCommand,
    PROFILE_MODE_ROOT_PREFERRED,
    quoteLauncherExportValue,
    resolveCanonicalExpectedProfileDir,
    expectProfileRootOnlyLauncherContract,
    expectDualEnvRootPreferredLauncherContract,
    runGit,
    createGitWorktreePair,
    runCliAsync,
    parseSingleJsonLine,
    encodeNativeBridgeEnvelope,
    readSingleNativeBridgeEnvelope,
    asRecord,
    resolveCliGateEnvelope,
    resolveWriteInteractionTier,
    scopedXhsGateOptions,
    assertLockMissing,
    detectSystemChromePath,
    wait,
    runHeadlessDomProbe,
    realBrowserContractsEnabled,
    BROWSER_STATE_FILENAME,
    BROWSER_CONTROL_FILENAME,
    isPidAlive,
    scopedReadGateOptions
  }
});

export {
  spawn,
  spawnSync,
  createServer,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
  createRequire,
  tmpdir,
  path,
  afterEach,
  describe,
  expect,
  it,
  buildRuntimeBootstrapContextId,
  resolveRuntimeStorePath,
  repoRoot,
  binPath,
  mockBrowserPath,
  nativeHostMockPath,
  repoOwnedNativeHostEntryPath,
  browserStateFilename,
  tempDirs,
  DatabaseSync,
  itWithSqlite,
  resolveDatabaseSync,
  createRuntimeCwd,
  createNativeHostManifest,
  seedInstalledPersistentExtension,
  defaultRuntimeEnv,
  runCli,
  expectBundledNativeHostStarts,
  createNativeHostCommand,
  createShellWrappedNativeHostCommand,
  PROFILE_MODE_ROOT_PREFERRED,
  quoteLauncherExportValue,
  resolveCanonicalExpectedProfileDir,
  expectProfileRootOnlyLauncherContract,
  expectDualEnvRootPreferredLauncherContract,
  runGit,
  createGitWorktreePair,
  runCliAsync,
  parseSingleJsonLine,
  encodeNativeBridgeEnvelope,
  readSingleNativeBridgeEnvelope,
  asRecord,
  resolveCliGateEnvelope,
  resolveWriteInteractionTier,
  scopedXhsGateOptions,
  assertLockMissing,
  detectSystemChromePath,
  wait,
  runHeadlessDomProbe,
  realBrowserContractsEnabled,
  BROWSER_STATE_FILENAME,
  BROWSER_CONTROL_FILENAME,
  isPidAlive,
  scopedReadGateOptions
};

export {};
