import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
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

const createNativeHostManifest = async (input: {
  nativeHostName?: string;
  allowedOrigins: string[];
}): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), "webenvoy-native-host-manifest-"));
  tempDirs.push(dir);
  const manifestPath = path.join(dir, `${input.nativeHostName ?? "com.webenvoy.host"}.json`);
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        name: input.nativeHostName ?? "com.webenvoy.host",
        path: "/mock/webenvoy-host",
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
  WEBENVOY_BROWSER_MOCK_TTL: "2"
});

const runCli = (
  args: string[],
  cwdOrEnv: string | Record<string, string> = repoRoot,
  env?: Record<string, string>
) => {
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

const createNativeHostCommand = (scriptPath: string): string =>
  `"${process.execPath}" "${scriptPath}"`;

const runCliAsync = (
  args: string[],
  cwd: string = repoRoot,
  env?: Record<string, string>
): Promise<{ status: number | null; stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
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
      status: "success",
      observability: {
        coverage: "unavailable",
        request_evidence: "none",
        page_state: null,
        key_requests: [],
        failure_site: null
      }
    });
    expect(typeof body.timestamp).toBe("string");
  });

  it("returns structured runtime unavailable when runtime store is unavailable", () => {
    const result = runCli(["runtime.ping", "--run-id", "run-contract-store-warning-001"], {
      WEBENVOY_NATIVE_TRANSPORT: "loopback",
      WEBENVOY_RUNTIME_STORE_FORCE_UNAVAILABLE: "1"
    });

    expect(result.status).toBe(5);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      run_id: "run-contract-store-warning-001",
      command: "runtime.ping",
      status: "error",
      error: {
        code: "ERR_RUNTIME_UNAVAILABLE",
        retryable: true
      }
    });
    expect(String((body.error as Record<string, unknown>).message)).toContain(
      "ERR_RUNTIME_STORE_UNAVAILABLE"
    );
    expect(result.stderr).toBe("");
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

  it("returns structured input validation error for xhs.search without ability envelope", () => {
    const result = runCli(["xhs.search", "--profile", "xhs_account_001"]);
    expect(result.status).toBe(2);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      status: "error",
      error: {
        code: "ERR_CLI_INVALID_ARGS",
        details: {
          ability_id: "unknown",
          stage: "input_validation",
          reason: "ABILITY_MISSING"
        }
      }
    });
  });

  it("returns capability_result for xhs.search fixture success path", () => {
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          ...scopedXhsGateOptions,
          fixture_success: true
        }
      })
    ], repoRoot, {
      WEBENVOY_ALLOW_FIXTURE_SUCCESS: "1"
    });
    expect(result.status).toBe(0);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      command: "xhs.search",
      status: "success",
      summary: {
        capability_result: {
          ability_id: "xhs.note.search.v1",
          layer: "L3",
          action: "read",
          outcome: "partial"
        }
      }
    });
  });

  it("returns invalid args when xhs.search gate options are missing", () => {
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          requested_execution_mode: "dry_run"
        }
      })
    ]);
    expect(result.status).toBe(2);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      command: "xhs.search",
      status: "error",
      error: {
        code: "ERR_CLI_INVALID_ARGS",
        details: {
          reason: "TARGET_DOMAIN_INVALID"
        }
      }
    });
  });

  it("returns dry_run summary by default for xhs.search runtime path", () => {
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          ...scopedXhsGateOptions,
          action_type: "read",
          simulate_result: "success"
        }
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });

    expect(result.status).toBe(0);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      command: "xhs.search",
      status: "success",
      summary: {
        capability_result: {
          ability_id: "xhs.note.search.v1",
          layer: "L3",
          action: "read",
          outcome: "partial"
        },
        consumer_gate_result: {
          requested_execution_mode: "dry_run",
          effective_execution_mode: "dry_run",
          gate_decision: "allowed"
        }
      }
    });
    expect(
      (
        ((body.summary as Record<string, unknown>).consumer_gate_result as Record<string, unknown>)
          .gate_reasons as string[]
      )
    ).toEqual(["DEFAULT_MODE_DRY_RUN"]);
  });

  it("blocks xhs.search before execution when official Chrome runtime readiness is not ready", () => {
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_official_not_ready_profile",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          ...scopedXhsGateOptions,
          action_type: "read",
          simulate_result: "success"
        }
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback",
      WEBENVOY_BROWSER_MOCK_VERSION: "Google Chrome 146.0.7680.154"
    });

    expect(result.status).toBe(5);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      command: "xhs.search",
      status: "error",
      error: {
        code: "ERR_RUNTIME_IDENTITY_NOT_BOUND",
        details: {
          ability_id: "xhs.note.search.v1",
          runtime_readiness: "blocked",
          identity_binding_state: "missing"
        }
      }
    });
  });

  it("blocks live_read_high_risk when approval is missing", () => {
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          ...scopedReadGateOptions,
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed"
        }
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });

    expect(result.status).toBe(6);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      command: "xhs.search",
      status: "error",
      error: {
        code: "ERR_EXECUTION_FAILED",
        details: {
          reason: "EXECUTION_MODE_GATE_BLOCKED",
          requested_execution_mode: "live_read_high_risk",
          effective_execution_mode: "dry_run",
          gate_decision: "blocked",
          scope_context: {
            platform: "xhs",
            read_domain: "www.xiaohongshu.com",
            write_domain: "creator.xiaohongshu.com",
            domain_mixing_forbidden: true
          },
          gate_input: {
            run_id: expect.any(String),
            session_id: expect.any(String),
            profile: "loopback_profile",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_high_risk",
            risk_state: "allowed"
          },
          gate_outcome: {
            effective_execution_mode: "dry_run",
            gate_decision: "blocked",
            requires_manual_confirmation: true
          },
          consumer_gate_result: {
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_high_risk",
            effective_execution_mode: "dry_run",
            gate_decision: "blocked"
          },
          approval_record: {
            approved: false,
            approver: null,
            approved_at: null,
            checks: {
              target_domain_confirmed: false,
              target_tab_confirmed: false,
              target_page_confirmed: false,
              risk_state_checked: false,
              action_type_confirmed: false
            }
          },
          audit_record: {
            run_id: expect.any(String),
            session_id: expect.any(String),
            profile: "loopback_profile",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_high_risk",
            effective_execution_mode: "dry_run",
            gate_decision: "blocked",
            approver: null,
            approved_at: null,
            recorded_at: expect.any(String)
          }
        }
      }
    });
    expect(
      (((body.error as Record<string, unknown>).details as Record<string, unknown>).gate_reasons as string[])
    ).toEqual(expect.arrayContaining(["MANUAL_CONFIRMATION_MISSING"]));
  });

  it("returns invalid args when dry_run target scope is missing", () => {
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
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
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });

    expect(result.status).toBe(2);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      command: "xhs.search",
      status: "error",
      error: {
        code: "ERR_CLI_INVALID_ARGS",
        details: {
          reason: "TARGET_DOMAIN_INVALID"
        }
      }
    });
  });

  it("blocks live_write when risk state is paused", () => {
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          target_domain: "creator.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "creator_publish_tab",
          action_type: "write",
          requested_execution_mode: "live_write",
          risk_state: "paused",
          approval_record: {
            approved: true,
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:00Z",
            checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            }
          }
        }
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });

    expect(result.status).toBe(6);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      command: "xhs.search",
      status: "error",
      error: {
        code: "ERR_EXECUTION_FAILED",
        details: {
          reason: "EXECUTION_MODE_GATE_BLOCKED",
          requested_execution_mode: "live_write",
          effective_execution_mode: "dry_run",
          gate_decision: "blocked"
        }
      }
    });
    expect(
      (((body.error as Record<string, unknown>).details as Record<string, unknown>).gate_reasons as string[])
    ).toEqual(
      expect.arrayContaining([
        "ABILITY_ACTION_CONTEXT_MISMATCH",
        "EXECUTION_MODE_UNSUPPORTED_FOR_COMMAND",
      ])
    );
  });

  it("blocks live_write when action_type is omitted even if ability.action is write", () => {
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "write"
        },
        input: {
          query: "露营装备"
        },
        options: {
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
          requested_execution_mode: "live_write",
          risk_state: "allowed",
          approval_record: {
            approved: true,
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:00Z",
            checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            }
          }
        }
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });

    expect(result.status).toBe(6);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      command: "xhs.search",
      status: "error",
      error: {
        code: "ERR_EXECUTION_FAILED",
        details: {
          reason: "EXECUTION_MODE_GATE_BLOCKED",
          requested_execution_mode: "live_write",
          effective_execution_mode: "dry_run",
          gate_decision: "blocked"
        }
      }
    });
    expect(
      (((body.error as Record<string, unknown>).details as Record<string, unknown>).gate_reasons as string[])
    ).toEqual(
      expect.arrayContaining(["ACTION_TYPE_NOT_EXPLICIT", "EXECUTION_MODE_UNSUPPORTED_FOR_COMMAND"])
    );
  });

  it("blocks live_write because xhs.search is a read-only command", () => {
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "write"
        },
        input: {
          query: "露营装备"
        },
        options: {
          target_domain: "creator.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "creator_publish_tab",
          action_type: "write",
          requested_execution_mode: "live_write",
          risk_state: "allowed",
          approval_record: {
            approved: true,
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:00Z",
            checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            }
          }
        }
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });

    expect(result.status).toBe(6);
    const body = parseSingleJsonLine(result.stdout);
    expect(
      (((body.error as Record<string, unknown>).details as Record<string, unknown>).gate_reasons as string[])
    ).toEqual(
      expect.arrayContaining([
        "EXECUTION_MODE_UNSUPPORTED_FOR_COMMAND"
      ])
    );
  });

  it("blocks when ability.action diverges from the approved gate action", () => {
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "write"
        },
        input: {
          query: "露营装备"
        },
        options: {
          ...scopedReadGateOptions,
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          approval_record: {
            approved: true,
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:00Z",
            checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            }
          }
        }
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });

    expect(result.status).toBe(6);
    const body = parseSingleJsonLine(result.stdout);
    expect(
      (((body.error as Record<string, unknown>).details as Record<string, unknown>).gate_reasons as string[])
    ).toEqual(expect.arrayContaining(["ABILITY_ACTION_CONTEXT_MISMATCH"]));
  });

  it("blocks live_write when action_type is irreversible_write even with approval", () => {
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "write"
        },
        input: {
          query: "露营装备"
        },
        options: {
          target_domain: "creator.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "creator_publish_tab",
          action_type: "irreversible_write",
          requested_execution_mode: "live_write",
          risk_state: "allowed",
          approval_record: {
            approved: true,
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:00Z",
            checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            }
          }
        }
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });

    expect(result.status).toBe(6);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      command: "xhs.search",
      status: "error",
      error: {
        code: "ERR_EXECUTION_FAILED",
        details: {
          reason: "EXECUTION_MODE_GATE_BLOCKED",
          requested_execution_mode: "live_write",
          effective_execution_mode: "dry_run",
          gate_decision: "blocked"
        }
      }
    });
    expect(
      (((body.error as Record<string, unknown>).details as Record<string, unknown>).gate_reasons as string[])
    ).toEqual(
      expect.arrayContaining([
        "ABILITY_ACTION_CONTEXT_MISMATCH",
        "IRREVERSIBLE_WRITE_NOT_ALLOWED",
        "EXECUTION_MODE_UNSUPPORTED_FOR_COMMAND"
      ])
    );
  });

  it("blocks issue_208 write paths in paused state and exposes write interaction tier", () => {
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "write"
        },
        input: {
          query: "露营装备"
        },
        options: {
          target_domain: "creator.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "creator_publish_tab",
          issue_scope: "issue_208",
          action_type: "write",
          requested_execution_mode: "dry_run",
          risk_state: "paused",
          approval_record: {
            approved: true,
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:00Z",
            checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            }
          }
        }
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });

    expect(result.status).toBe(6);
    const body = parseSingleJsonLine(result.stdout);
    const gateEnvelope = resolveCliGateEnvelope(body);
    const consumerGateResult = asRecord(gateEnvelope.consumer_gate_result);
    expect(consumerGateResult?.gate_decision).toBe("blocked");
    expect(resolveWriteInteractionTier(gateEnvelope)).toBe("reversible_interaction");
  });

  it("keeps issue_208 dry_run write requests blocked regardless of approval completeness", () => {
    const states: Array<"limited" | "allowed"> = ["limited", "allowed"];
    for (const state of states) {
      const blocked = runCli([
        "xhs.search",
        "--profile",
        "xhs_account_001",
        "--params",
        JSON.stringify({
          ability: {
            id: "xhs.note.search.v1",
            layer: "L3",
            action: "write"
          },
          input: {
            query: "露营装备"
          },
          options: {
            target_domain: "creator.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "creator_publish_tab",
            issue_scope: "issue_208",
            action_type: "write",
            requested_execution_mode: "dry_run",
            risk_state: state,
            approval_record: {
              approved: false,
              approver: null,
              approved_at: null,
              checks: {
                target_domain_confirmed: false,
                target_tab_confirmed: false,
                target_page_confirmed: false,
                risk_state_checked: false,
                action_type_confirmed: false
              }
            }
          }
        })
      ], repoRoot, {
        WEBENVOY_NATIVE_TRANSPORT: "loopback"
      });
      expect(blocked.status).toBe(6);
      const blockedBody = parseSingleJsonLine(blocked.stdout);
      const blockedEnvelope = resolveCliGateEnvelope(blockedBody);
      const blockedConsumerGateResult = asRecord(blockedEnvelope.consumer_gate_result);
      expect(blockedConsumerGateResult?.gate_decision).toBe("blocked");
      expect(resolveWriteInteractionTier(blockedEnvelope)).toBe("reversible_interaction");

      expect(
        ((blockedConsumerGateResult?.gate_reasons as string[] | undefined) ?? []).includes(
          "EDITOR_INPUT_VALIDATION_REQUIRED"
        )
      ).toBe(true);
    }
  });

  it("keeps issue_208 irreversible_write blocked and exposes irreversible write tier", () => {
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "write"
        },
        input: {
          query: "露营装备"
        },
        options: {
          target_domain: "creator.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "creator_publish_tab",
          issue_scope: "issue_208",
          action_type: "irreversible_write",
          requested_execution_mode: "dry_run",
          risk_state: "allowed",
          approval_record: {
            approved: true,
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:00Z",
            checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            }
          }
        }
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });

    expect(result.status).toBe(6);
    const body = parseSingleJsonLine(result.stdout);
    const gateEnvelope = resolveCliGateEnvelope(body);
    const consumerGateResult = asRecord(gateEnvelope.consumer_gate_result);
    expect(consumerGateResult?.gate_decision).toBe("blocked");
    expect(resolveWriteInteractionTier(gateEnvelope)).toBe("irreversible_write");
  });

  it("keeps issue_208 live_write as gate-only in loopback while exposing non-live effective mode", () => {
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "write"
        },
        input: {
          query: "露营装备"
        },
        options: {
          target_domain: "creator.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "creator_publish_tab",
          issue_scope: "issue_208",
          action_type: "write",
          requested_execution_mode: "live_write",
          risk_state: "allowed",
          validation_action: "editor_input",
          validation_text: "最小正式验证",
          approval_record: {
            approved: true,
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:00Z",
            checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            }
          }
        }
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });

    expect(result.status).toBe(6);
    const body = parseSingleJsonLine(result.stdout);
    const gateEnvelope = resolveCliGateEnvelope(body);
    const consumerGateResult = asRecord(gateEnvelope.consumer_gate_result);
    const gateInput = asRecord(gateEnvelope.gate_input);
    const gateOutcome = asRecord(gateEnvelope.gate_outcome);
    const auditRecord = asRecord(gateEnvelope.audit_record);
    expect(gateInput?.requested_execution_mode).toBe("live_write");
    expect(gateOutcome?.effective_execution_mode).toBe("dry_run");
    expect(consumerGateResult?.requested_execution_mode).toBe("live_write");
    expect(consumerGateResult?.effective_execution_mode).toBe("dry_run");
    expect(consumerGateResult?.gate_decision).toBe("blocked");
    expect(consumerGateResult?.gate_reasons).toEqual(
      expect.arrayContaining(["EXECUTION_MODE_UNSUPPORTED_FOR_COMMAND"])
    );
    expect(auditRecord?.requested_execution_mode).toBe("live_write");
    expect(auditRecord?.effective_execution_mode).toBe("dry_run");
    expect(resolveWriteInteractionTier(gateEnvelope)).toBe("reversible_interaction");
  });

  it("keeps issue_208 editor_input blocked on loopback because it lacks controlled execution attestation", () => {
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "write"
        },
        input: {
          query: "露营装备"
        },
        options: {
          target_domain: "creator.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "creator_publish_tab",
          issue_scope: "issue_208",
          action_type: "write",
          validation_action: "editor_input",
          requested_execution_mode: "live_write",
          risk_state: "allowed",
          approval_record: {
            approved: true,
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:00Z",
            checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            }
          }
        }
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });

    expect(result.status).toBe(6);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      status: "error",
      error: {
        code: "ERR_EXECUTION_FAILED"
      }
    });
    const payload = asRecord(body.payload) ?? {};
    const observability = asRecord(payload.observability) ?? {};
    const failureSite = asRecord(observability.failure_site) ?? {};
    expect(typeof failureSite).toBe("object");
    expect(String(body.error?.message ?? "")).toContain("执行模式门禁阻断");
  });

  it("blocks issue_209 write dry_run even with complete approval to keep gate-only scoped to issue_208", () => {
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "write"
        },
        input: {
          query: "露营装备"
        },
        options: {
          target_domain: "creator.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "creator_publish_tab",
          issue_scope: "issue_209",
          action_type: "write",
          requested_execution_mode: "dry_run",
          risk_state: "allowed",
          approval_record: {
            approved: true,
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:00Z",
            checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            }
          }
        }
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });

    expect(result.status).toBe(6);
    const body = parseSingleJsonLine(result.stdout);
    const gateEnvelope = resolveCliGateEnvelope(body);
    const consumerGateResult = asRecord(gateEnvelope.consumer_gate_result);
    expect(consumerGateResult?.gate_decision).toBe("blocked");
    expect(consumerGateResult?.gate_reasons).toEqual(
      expect.arrayContaining(["RISK_STATE_ALLOWED", "ISSUE_ACTION_MATRIX_BLOCKED"])
    );
  });

  it("blocks issue_209 write live_read_limited with fallback mode instead of exposing live execution", () => {
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "write"
        },
        input: {
          query: "露营装备"
        },
        options: {
          target_domain: "creator.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "creator_publish_tab",
          issue_scope: "issue_209",
          action_type: "write",
          requested_execution_mode: "live_read_limited",
          risk_state: "limited",
          approval_record: {
            approved: true,
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:00Z",
            checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            }
          }
        }
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });

    expect(result.status).toBe(6);
    const body = parseSingleJsonLine(result.stdout);
    const gateEnvelope = resolveCliGateEnvelope(body);
    const consumerGateResult = asRecord(gateEnvelope.consumer_gate_result);
    const gateOutcome = asRecord(gateEnvelope.gate_outcome);
    const auditRecord = asRecord(gateEnvelope.audit_record);
    expect(gateOutcome?.effective_execution_mode).toBe("recon");
    expect(consumerGateResult?.requested_execution_mode).toBe("live_read_limited");
    expect(consumerGateResult?.effective_execution_mode).toBe("recon");
    expect(consumerGateResult?.gate_decision).toBe("blocked");
    expect(consumerGateResult?.gate_reasons).toEqual(
      expect.arrayContaining([
        "ACTION_TYPE_MODE_MISMATCH",
        "RISK_STATE_LIMITED",
        "ISSUE_ACTION_MATRIX_BLOCKED"
      ])
    );
    expect(auditRecord?.requested_execution_mode).toBe("live_read_limited");
    expect(auditRecord?.effective_execution_mode).toBe("recon");
  });

  it("blocks issue_209 write live_read_high_risk with fallback mode instead of exposing live execution", () => {
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "write"
        },
        input: {
          query: "露营装备"
        },
        options: {
          target_domain: "creator.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "creator_publish_tab",
          issue_scope: "issue_209",
          action_type: "write",
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          approval_record: {
            approved: true,
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:00Z",
            checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            }
          }
        }
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });

    expect(result.status).toBe(6);
    const body = parseSingleJsonLine(result.stdout);
    const gateEnvelope = resolveCliGateEnvelope(body);
    const consumerGateResult = asRecord(gateEnvelope.consumer_gate_result);
    const gateOutcome = asRecord(gateEnvelope.gate_outcome);
    const auditRecord = asRecord(gateEnvelope.audit_record);
    expect(gateOutcome?.effective_execution_mode).toBe("dry_run");
    expect(consumerGateResult?.requested_execution_mode).toBe("live_read_high_risk");
    expect(consumerGateResult?.effective_execution_mode).toBe("dry_run");
    expect(consumerGateResult?.gate_decision).toBe("blocked");
    expect(consumerGateResult?.gate_reasons).toEqual(
      expect.arrayContaining([
        "ACTION_TYPE_MODE_MISMATCH",
        "RISK_STATE_ALLOWED",
        "ISSUE_ACTION_MATRIX_BLOCKED"
      ])
    );
    expect(auditRecord?.requested_execution_mode).toBe("live_read_high_risk");
    expect(auditRecord?.effective_execution_mode).toBe("dry_run");
  });

  it("allows live_read_high_risk with explicit approval and emits consumer_gate_result", () => {
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          ...scopedReadGateOptions,
          simulate_result: "success",
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          approval_record: {
            approved: true,
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:00Z",
            checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            }
          }
        }
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });

    expect(result.status).toBe(0);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      command: "xhs.search",
      status: "success",
      summary: {
        scope_context: {
          platform: "xhs",
          read_domain: "www.xiaohongshu.com",
          write_domain: "creator.xiaohongshu.com",
          domain_mixing_forbidden: true
        },
        gate_input: {
          run_id: expect.any(String),
          session_id: expect.any(String),
          profile: "loopback_profile",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
          action_type: "read",
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed"
        },
        gate_outcome: {
          effective_execution_mode: "live_read_high_risk",
          gate_decision: "allowed",
          gate_reasons: ["LIVE_MODE_APPROVED"],
          requires_manual_confirmation: true
        },
        consumer_gate_result: {
          requested_execution_mode: "live_read_high_risk",
          effective_execution_mode: "live_read_high_risk",
          gate_decision: "allowed",
          gate_reasons: ["LIVE_MODE_APPROVED"]
        },
        approval_record: {
          approved: true,
          approver: "qa-reviewer",
          approved_at: "2026-03-23T10:00:00Z"
        },
        audit_record: {
          run_id: expect.any(String),
          session_id: expect.any(String),
          profile: "loopback_profile",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
          action_type: "read",
          requested_execution_mode: "live_read_high_risk",
          effective_execution_mode: "live_read_high_risk",
          gate_decision: "allowed",
          gate_reasons: ["LIVE_MODE_APPROVED"],
          approver: "qa-reviewer",
          approved_at: "2026-03-23T10:00:00Z",
          recorded_at: expect.any(String)
        }
      }
    });
  });

  it("recovers official Chrome xhs.search with hidden runtime.bootstrap after runtime.start leaves bootstrap pending", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const manifestPath = await createNativeHostManifest({
      allowedOrigins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]
    });
    const profile = "xhs_official_bootstrap_recovery_profile";
    const runId = "run-contract-xhs-bootstrap-recovery-001";
    await seedInstalledPersistentExtension({
      cwd: runtimeCwd,
      profile
    });

    const start = runCli(
      [
        "runtime.start",
        "--profile",
        profile,
        "--run-id",
        runId,
        "--params",
        JSON.stringify({
          persistent_extension_identity: {
            extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            manifest_path: manifestPath
          }
        })
      ],
      runtimeCwd,
      {
        WEBENVOY_BROWSER_MOCK_VERSION: "Google Chrome 146.0.7680.154",
        WEBENVOY_NATIVE_HOST_CMD: createNativeHostCommand(nativeHostMockPath),
        WEBENVOY_NATIVE_HOST_MODE: "bootstrap-ack-timeout-error"
      }
    );
    expect(start.status).toBe(0);
    const startBody = parseSingleJsonLine(start.stdout);
    expect(startBody).toMatchObject({
      command: "runtime.start",
      status: "success",
      summary: {
        profile,
        identityBindingState: "bound",
        transportState: "ready",
        bootstrapState: "pending",
        runtimeReadiness: "recoverable"
      }
    });
    await seedInstalledPersistentExtension({
      cwd: runtimeCwd,
      profile
    });

    const nativeHostPath = path.join(runtimeCwd, "native-host-live-prewarm.cjs");
    const tracePath = path.join(runtimeCwd, "native-host-live-prewarm-trace.json");
    await writeFile(
      nativeHostPath,
      `#!/usr/bin/env node
const { existsSync, readFileSync, writeFileSync } = require("node:fs");
let buffer = Buffer.alloc(0);
let opened = false;
let bootstrapPending = false;
let bootstrapAttested = false;
let attestationTimer = null;
const forwards = [];
const attestationEvents = [];
const tracePath = process.env.WEBENVOY_TEST_TRACE_PATH || "";
let idleTimer = null;

const emit = (message) => {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  process.stdout.write(Buffer.concat([header, payload]));
};

const writeTrace = () => {
  if (!tracePath) {
    return;
  }
  const existing = existsSync(tracePath)
    ? JSON.parse(readFileSync(tracePath, "utf8"))
    : { forwards: [], attestationEvents: [] };
  const mergedForwards = Array.isArray(existing.forwards)
    ? [...existing.forwards, ...forwards]
    : [...forwards];
  const mergedAttestations = Array.isArray(existing.attestationEvents)
    ? [...existing.attestationEvents, ...attestationEvents]
    : [...attestationEvents];
  writeFileSync(
    tracePath,
    JSON.stringify({ forwards: mergedForwards, attestationEvents: mergedAttestations }),
    "utf8"
  );
};

const scheduleIdleExit = () => {
  if (idleTimer) {
    clearTimeout(idleTimer);
  }
  idleTimer = setTimeout(() => {
    writeTrace();
    process.exit(0);
  }, 1000);
};

const success = (request, payload = { message: "pong" }) => ({
  id: request.id,
  status: "success",
  summary: {
    session_id: String(request.params?.session_id ?? "nm-session-001"),
    run_id: String(request.params?.run_id ?? request.id),
    command: String(request.params?.command ?? "runtime.ping"),
    relay_path: "host>background>content-script>background>host"
  },
  payload,
  error: null
});

const onRequest = (request) => {
  if (request.method === "bridge.open") {
    opened = true;
    emit({
      id: request.id,
      status: "success",
      summary: {
        protocol: "webenvoy.native-bridge.v1",
        state: "ready",
        session_id: "nm-session-001"
      },
      error: null
    });
    scheduleIdleExit();
    return;
  }

  if (request.method === "__ping__") {
    emit({
      id: request.id,
      status: "success",
      summary: { session_id: "nm-session-001" },
      error: null
    });
    scheduleIdleExit();
    return;
  }

  if (request.method !== "bridge.forward" || !opened) {
    emit({
      id: request.id,
      status: "error",
      summary: {},
      error: { code: "ERR_TRANSPORT_FORWARD_FAILED", message: "unexpected request" }
    });
    writeTrace();
    process.exit(0);
    return;
  }

  const command = String(request.params?.command ?? "");
  const runId = String(request.params?.run_id ?? request.id);
  const profile = String(request.profile ?? "");
  forwards.push({
    command,
    run_id: runId,
    profile
  });

  if (command === "runtime.bootstrap") {
    const runtimeContextId = String(request.params?.command_params?.runtime_context_id ?? "");
    bootstrapPending = true;
    bootstrapAttested = false;
    if (attestationTimer) {
      clearTimeout(attestationTimer);
    }
    attestationTimer = setTimeout(() => {
      bootstrapPending = false;
      bootstrapAttested = true;
      attestationEvents.push({
        source: "native-host-async-attestation",
        run_id: runId,
        profile,
        runtime_context_id: runtimeContextId
      });
    }, 50);
    emit({
      id: request.id,
      status: "error",
      summary: {
        session_id: String(request.params?.session_id ?? "nm-session-001"),
        run_id: runId,
        command,
        relay_path: "host>background>content-script>background>host"
      },
      payload: {},
      error: {
        code: "ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED",
        message: "runtime bootstrap 尚未获得执行面确认"
      }
    });
    scheduleIdleExit();
    return;
  }

  if (command === "runtime.readiness") {
    emit(
      success(request, {
        transport_state: "ready",
        bootstrap_state: bootstrapAttested ? "ready" : bootstrapPending ? "pending" : "not_started"
      })
    );
    scheduleIdleExit();
    return;
  }

  if (command === "xhs.search") {
    const fingerprintContext = request.params?.command_params?.fingerprint_context ?? null;
    if (!fingerprintContext) {
      emit({
        id: request.id,
        status: "error",
        summary: {},
        error: {
          code: "ERR_EXECUTION_FAILED",
          message: "fingerprint_context missing on xhs.search"
        },
        payload: {
          details: {
            stage: "execution",
            reason: "FINGERPRINT_CONTEXT_MISSING"
          }
        }
      });
      writeTrace();
      process.exit(0);
      return;
    }
    emit(
      success(request, {
        summary: {
          capability_result: {
            ability_id: "xhs.note.search.v1",
            layer: "L3",
            action: "read",
            outcome: "success"
          }
        }
      })
    );
    writeTrace();
    process.exit(0);
    return;
  }

  emit({
    id: request.id,
    status: "error",
    summary: {},
    error: { code: "ERR_TRANSPORT_FORWARD_FAILED", message: "unsupported command" }
  });
  writeTrace();
  process.exit(0);
};

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const frameLength = buffer.readUInt32LE(0);
    const frameEnd = 4 + frameLength;
    if (buffer.length < frameEnd) {
      return;
    }
    const frame = buffer.subarray(4, frameEnd);
    buffer = buffer.subarray(frameEnd);
    const request = JSON.parse(frame.toString("utf8"));
    onRequest(request);
  }
});
`,
      "utf8"
    );

    const result = runCli([
      "xhs.search",
      "--profile",
      profile,
      "--run-id",
      runId,
      "--params",
      JSON.stringify({
        persistent_extension_identity: {
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          manifest_path: manifestPath
        },
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          ...scopedReadGateOptions,
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          approval_record: {
            approved: true,
            approver: "qa-reviewer",
            approved_at: "2026-03-25T12:00:00Z",
            checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            }
          }
        }
      })
    ], runtimeCwd, {
      WEBENVOY_NATIVE_TRANSPORT: "native",
      WEBENVOY_NATIVE_HOST_CMD: createNativeHostCommand(nativeHostPath),
      WEBENVOY_TEST_TRACE_PATH: tracePath,
      WEBENVOY_BROWSER_MOCK_VERSION: "Google Chrome 146.0.7680.154"
    });

    expect(result.status).toBe(0);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      command: "xhs.search",
      status: "success"
    });
  });

  it("accepts live_read_limited as approved live mode in limited risk state", () => {
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          ...scopedReadGateOptions,
          simulate_result: "success",
          requested_execution_mode: "live_read_limited",
          risk_state: "limited",
          approval_record: {
            approved: true,
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:00Z",
            checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            }
          }
        }
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });

    expect(result.status).toBe(0);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      command: "xhs.search",
      status: "success",
      summary: {
        gate_input: {
          requested_execution_mode: "live_read_limited",
          risk_state: "limited"
        },
        gate_outcome: {
          effective_execution_mode: "live_read_limited",
          gate_decision: "allowed",
          gate_reasons: ["LIVE_MODE_APPROVED"],
          requires_manual_confirmation: true
        },
        consumer_gate_result: {
          requested_execution_mode: "live_read_limited",
          effective_execution_mode: "live_read_limited",
          gate_decision: "allowed",
          gate_reasons: ["LIVE_MODE_APPROVED"]
        },
        issue_action_matrix: {
          issue_scope: "issue_209",
          state: "limited",
          allowed_actions: ["dry_run", "recon"],
          conditional_actions: [
            {
              action: "live_read_limited",
              requires: [
                "approval_record_approved_true",
                "approval_record_approver_present",
                "approval_record_approved_at_present",
                "approval_record_checks_all_true"
              ]
            }
          ]
        },
        risk_state_output: {
          current_state: "limited",
          session_rhythm_policy: {
            min_action_interval_ms: 3000,
            min_experiment_interval_ms: 30000,
            cooldown_strategy: "exponential_backoff",
            cooldown_base_minutes: 30,
            cooldown_cap_minutes: 720,
            resume_probe_mode: "recon_only"
          },
          session_rhythm: {
            state: "recovery",
            triggered_by: "LIVE_MODE_APPROVED",
            cooldown_until: null,
            recovery_started_at: expect.any(String),
            last_event_at: expect.any(String),
            source_event_id: expect.any(String)
          },
          recovery_requirements: [
            "stability_window_passed_and_manual_approve",
            "risk_state_checked",
            "audit_record_present"
          ]
        }
      }
    });
  });

  itWithSqlite("queries persisted gate audit trail by run_id after live approval", async () => {
    const cwd = await createRuntimeCwd();
    const runId = "run-audit-query-allowed-001";

    const executeResult = runCli([
      "xhs.search",
      "--run-id",
      runId,
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          ...scopedReadGateOptions,
          simulate_result: "success",
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          approval_record: {
            approved: true,
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:00Z",
            checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            }
          }
        }
      })
    ], cwd, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });
    expect(executeResult.status).toBe(0);

    const queryResult = runCli([
      "runtime.audit",
      "--run-id",
      "run-audit-query-read-001",
      "--params",
      JSON.stringify({
        run_id: runId
      })
    ], cwd);
    expect(queryResult.status).toBe(0);
    const body = parseSingleJsonLine(queryResult.stdout);
    expect(body).toMatchObject({
      command: "runtime.audit",
      status: "success",
      summary: {
        query: {
          run_id: runId
        },
        approval_record: {
          run_id: runId,
          approved: true,
          approver: "qa-reviewer",
          approved_at: "2026-03-23T10:00:00Z"
        },
        audit_records: [
          {
            run_id: runId,
            issue_scope: "issue_209",
            risk_state: "allowed",
            gate_decision: "allowed",
            requested_execution_mode: "live_read_high_risk",
            effective_execution_mode: "live_read_high_risk",
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:00Z"
          }
        ],
        write_action_matrix_decisions: {
          issue_scope: "issue_209"
        },
        risk_state_output: {
          current_state: "allowed",
          session_rhythm_policy: {
            min_action_interval_ms: 3000,
            min_experiment_interval_ms: 30000,
            cooldown_strategy: "exponential_backoff",
            cooldown_base_minutes: 30,
            cooldown_cap_minutes: 720,
            resume_probe_mode: "recon_only"
          },
          session_rhythm: {
            state: "normal",
            triggered_by: "LIVE_MODE_APPROVED",
            cooldown_until: null,
            recovery_started_at: null,
            last_event_at: expect.any(String),
            source_event_id: expect.any(String)
          }
        }
      }
    });
    expect(
      ((((body.summary as Record<string, unknown>).audit_records as Record<string, unknown>[])[0]
        .gate_reasons as string[]) ?? [])
    ).toEqual(["LIVE_MODE_APPROVED"]);
  });

  itWithSqlite("queries persisted blocked gate audit records by session_id filter", async () => {
    const cwd = await createRuntimeCwd();
    const runId = "run-audit-query-blocked-001";

    const executeResult = runCli([
      "xhs.search",
      "--run-id",
      runId,
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          ...scopedReadGateOptions,
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed"
        }
      })
    ], cwd, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });
    expect(executeResult.status).toBe(6);
    const executeBody = parseSingleJsonLine(executeResult.stdout);
    const sessionId = String(
      (((executeBody.error as Record<string, unknown>).details as Record<string, unknown>)
        .audit_record as Record<string, unknown>).session_id
    );

    const queryResult = runCli([
      "runtime.audit",
      "--run-id",
      "run-audit-query-read-002",
      "--params",
      JSON.stringify({
        session_id: sessionId
      })
    ], cwd);
    expect(queryResult.status).toBe(0);
    const body = parseSingleJsonLine(queryResult.stdout);
    expect(body).toMatchObject({
      command: "runtime.audit",
      status: "success",
      summary: {
        query: {
          session_id: sessionId
        },
        audit_records: [
          {
            run_id: runId,
            session_id: sessionId,
            issue_scope: "issue_209",
            risk_state: "allowed",
            gate_decision: "blocked",
            requested_execution_mode: "live_read_high_risk",
            effective_execution_mode: "dry_run",
            approver: null,
            approved_at: null
          }
        ],
        write_action_matrix_decisions: null,
        risk_state_output: {
          current_state: "limited",
          session_rhythm_policy: {
            min_action_interval_ms: 3000,
            min_experiment_interval_ms: 30000,
            cooldown_strategy: "exponential_backoff",
            cooldown_base_minutes: 30,
            cooldown_cap_minutes: 720,
            resume_probe_mode: "recon_only"
          },
          session_rhythm: {
            state: "recovery",
            triggered_by: "MANUAL_CONFIRMATION_MISSING",
            cooldown_until: expect.any(String),
            recovery_started_at: expect.any(String),
            last_event_at: expect.any(String),
            source_event_id: expect.any(String)
          }
        }
      }
    });
    expect(
      ((((body.summary as Record<string, unknown>).audit_records as Record<string, unknown>[])[0]
        .gate_reasons as string[]) ?? [])
    ).toEqual(expect.arrayContaining(["MANUAL_CONFIRMATION_MISSING"]));
  });

  itWithSqlite("persists issue_scope for issue_208 audit records and returns matching write matrix query", async () => {
    const cwd = await createRuntimeCwd();
    const runId = "run-audit-query-issue-scope-208-001";

    const executeResult = runCli([
      "xhs.search",
      "--run-id",
      runId,
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "write"
        },
        input: {
          query: "露营装备"
        },
        options: {
          target_domain: "creator.xiaohongshu.com",
          target_tab_id: 91,
          target_page: "publish_page",
          issue_scope: "issue_208",
          action_type: "write",
          requested_execution_mode: "dry_run",
          risk_state: "paused"
        }
      })
    ], cwd, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });
    expect(executeResult.status).toBe(6);

    const queryResult = runCli([
      "runtime.audit",
      "--run-id",
      "run-audit-query-issue-scope-208-002",
      "--params",
      JSON.stringify({
        run_id: runId
      })
    ], cwd);
    expect(queryResult.status).toBe(0);
    const body = parseSingleJsonLine(queryResult.stdout);
    expect(body).toMatchObject({
      command: "runtime.audit",
      status: "success",
      summary: {
        query: {
          run_id: runId
        },
        audit_records: [
          {
            run_id: runId,
            issue_scope: "issue_208"
          }
        ],
        write_action_matrix_decisions: {
          issue_scope: "issue_208"
        }
      }
    });
  });

  itWithSqlite("keeps unresolved issue_scope rows visible in runtime.audit query results", async () => {
    const cwd = await createRuntimeCwd();
    const dbPath = resolveRuntimeStorePath(cwd);
    const DatabaseSyncCtor = DatabaseSync as DatabaseSyncCtor;
    await mkdir(path.dirname(dbPath), { recursive: true });
    const db = new DatabaseSyncCtor(dbPath);

    db.prepare("PRAGMA journal_mode=WAL").run();
    db.exec(`
      CREATE TABLE runtime_store_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT INTO runtime_store_meta(key, value) VALUES('schema_version', '5');
      CREATE TABLE runtime_runs (
        run_id TEXT PRIMARY KEY,
        session_id TEXT,
        profile_name TEXT NOT NULL,
        command TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        error_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE runtime_gate_approvals (
        approval_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL UNIQUE,
        approved INTEGER NOT NULL,
        approver TEXT,
        approved_at TEXT,
        checks_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE runtime_gate_audit_records (
        event_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        profile TEXT NOT NULL,
        issue_scope TEXT,
        risk_state TEXT NOT NULL,
        next_state TEXT NOT NULL DEFAULT 'paused',
        transition_trigger TEXT NOT NULL DEFAULT 'gate_evaluation',
        target_domain TEXT NOT NULL,
        target_tab_id INTEGER NOT NULL,
        target_page TEXT NOT NULL,
        action_type TEXT NOT NULL,
        requested_execution_mode TEXT NOT NULL,
        effective_execution_mode TEXT NOT NULL,
        gate_decision TEXT NOT NULL,
        gate_reasons_json TEXT NOT NULL,
        approver TEXT,
        approved_at TEXT,
        recorded_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    db.prepare(
      `INSERT INTO runtime_runs(
        run_id, session_id, profile_name, command, status, started_at, ended_at, error_code, created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "run-audit-missing-issue-scope-001",
      "session-audit-missing-issue-scope-001",
      "xhs_account_001",
      "xhs.search",
      "failed",
      "2026-03-23T10:20:00.000Z",
      "2026-03-23T10:20:01.000Z",
      "ERR_CLI_INVALID_ARGS",
      "2026-03-23T10:20:00.000Z",
      "2026-03-23T10:20:01.000Z"
    );
    db.prepare(
      `INSERT INTO runtime_gate_audit_records(
        event_id, run_id, session_id, profile, issue_scope, risk_state, next_state, transition_trigger, target_domain, target_tab_id,
        target_page, action_type, requested_execution_mode, effective_execution_mode, gate_decision, gate_reasons_json, approver,
        approved_at, recorded_at, created_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "evt-audit-missing-issue-scope-001",
      "run-audit-missing-issue-scope-001",
      "session-audit-missing-issue-scope-001",
      "xhs_account_001",
      null,
      "allowed",
      "allowed",
      "gate_evaluation",
      "creator.xiaohongshu.com",
      52,
      "creator_publish_tab",
      "write",
      "dry_run",
      "dry_run",
      "blocked",
      JSON.stringify(["ISSUE_ACTION_MATRIX_BLOCKED"]),
      null,
      null,
      "2026-03-23T10:20:11.000Z",
      "2026-03-23T10:20:11.000Z"
    );
    db.close();

    const queryResult = runCli([
      "runtime.audit",
      "--run-id",
      "run-audit-missing-issue-scope-query-001",
      "--params",
      JSON.stringify({
        run_id: "run-audit-missing-issue-scope-001"
      })
    ], cwd);
    expect(queryResult.status).toBe(0);
    const body = parseSingleJsonLine(queryResult.stdout);
    expect(body).toMatchObject({
      command: "runtime.audit",
      status: "success",
      summary: {
        query: {
          run_id: "run-audit-missing-issue-scope-001"
        },
        audit_records: [
          {
            run_id: "run-audit-missing-issue-scope-001",
            issue_scope: null,
            write_action_matrix_decisions: null
          }
        ],
        write_action_matrix_decisions: null
      }
    });
  });

  itWithSqlite("keeps resolved audit records queryable when session window also contains unresolved legacy rows", async () => {
    const cwd = await createRuntimeCwd();
    const runId = "run-audit-query-session-mixed-001";

    const executeResult = runCli([
      "xhs.search",
      "--run-id",
      runId,
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 91,
          target_page: "search_result_tab",
          issue_scope: "issue_209",
          action_type: "read",
          requested_execution_mode: "dry_run",
          risk_state: "paused"
        }
      })
    ], cwd, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });
    expect(executeResult.status).toBe(0);
    const executeBody = parseSingleJsonLine(executeResult.stdout);
    const sessionId = String(
      (((executeBody.summary as Record<string, unknown>).audit_record as Record<string, unknown>)
        .session_id)
    );

    const dbPath = resolveRuntimeStorePath(cwd);
    const DatabaseSyncCtor = DatabaseSync as DatabaseSyncCtor;
    const db = new DatabaseSyncCtor(dbPath);
    db.prepare(
      `INSERT INTO runtime_runs(
        run_id, session_id, profile_name, command, status, started_at, ended_at, error_code, created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "run-audit-missing-issue-scope-002",
      sessionId,
      "xhs_account_001",
      "xhs.search",
      "failed",
      "2026-03-23T10:20:00.000Z",
      "2026-03-23T10:20:01.000Z",
      "ERR_CLI_INVALID_ARGS",
      "2026-03-23T10:20:00.000Z",
      "2026-03-23T10:20:01.000Z"
    );
    db.prepare(
      `INSERT INTO runtime_gate_audit_records(
        event_id, run_id, session_id, profile, issue_scope, risk_state, next_state, transition_trigger, target_domain, target_tab_id,
        target_page, action_type, requested_execution_mode, effective_execution_mode, gate_decision, gate_reasons_json, approver,
        approved_at, recorded_at, created_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "evt-audit-missing-issue-scope-002",
      "run-audit-missing-issue-scope-002",
      sessionId,
      "xhs_account_001",
      null,
      "paused",
      "paused",
      "gate_evaluation",
      "creator.xiaohongshu.com",
      52,
      "creator_publish_tab",
      "write",
      "dry_run",
      "dry_run",
      "blocked",
      JSON.stringify(["ISSUE_ACTION_MATRIX_BLOCKED"]),
      null,
      null,
      "2026-03-23T10:20:11.000Z",
      "2026-03-23T10:20:11.000Z"
    );
    db.close();

    const queryResult = runCli([
      "runtime.audit",
      "--run-id",
      "run-audit-mixed-session-query-001",
      "--params",
      JSON.stringify({
        session_id: sessionId,
        limit: 10
      })
    ], cwd);
    expect(queryResult.status).toBe(0);
    const body = parseSingleJsonLine(queryResult.stdout);
    expect(body.summary).toMatchObject({
      audit_records: expect.arrayContaining([
        expect.objectContaining({
          run_id: runId,
          issue_scope: "issue_209"
        }),
        expect.objectContaining({
          run_id: "run-audit-missing-issue-scope-002",
          issue_scope: null,
          write_action_matrix_decisions: null
        })
      ])
    });
    expect((body.summary.audit_records as Record<string, unknown>[])).toHaveLength(2);
  });

  it("returns invalid args when xhs.search requested_execution_mode is missing", () => {
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab"
        }
      })
    ]);
    expect(result.status).toBe(2);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      command: "xhs.search",
      status: "error",
      error: {
        code: "ERR_CLI_INVALID_ARGS",
        details: {
          ability_id: "xhs.note.search.v1",
          stage: "input_validation",
          reason: "REQUESTED_EXECUTION_MODE_INVALID"
        }
      }
    });
  });

  it("returns structured execution details for xhs.search login-required path", () => {
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          ...scopedReadGateOptions,
          simulate_result: "login_required",
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          approval_record: {
            approved: true,
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:00Z",
            checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            }
          }
        }
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });
    expect(result.status).toBe(6);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      command: "xhs.search",
      status: "error",
      error: {
        code: "ERR_EXECUTION_FAILED",
        details: {
          ability_id: "xhs.note.search.v1",
          stage: "execution",
          reason: "SESSION_EXPIRED"
        },
        diagnosis: {
          category: "request_failed"
        }
      },
      observability: {
        page_state: {
          page_kind: "login"
        },
        failure_site: {
          target: "/api/sns/web/v1/search/notes"
        }
      }
    });
  });

  it("returns structured output mapping details for xhs.search bad output path", () => {
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备",
          force_bad_output: true
        },
        options: {
          ...scopedReadGateOptions,
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          approval_record: {
            approved: true,
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:00Z",
            checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            }
          }
        }
      })
    ]);
    expect(result.status).toBe(6);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      command: "xhs.search",
      status: "error",
      error: {
        code: "ERR_EXECUTION_FAILED",
        details: {
          ability_id: "xhs.note.search.v1",
          stage: "output_mapping",
          reason: "CAPABILITY_RESULT_MISSING"
        }
      }
    });
  });

  it("requires profile for xhs.search", () => {
    const result = runCli([
      "xhs.search",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        }
      })
    ]);
    expect(result.status).toBe(2);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      command: "xhs.search",
      status: "error",
      error: {
        code: "ERR_CLI_INVALID_ARGS"
      }
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
      error: {
        code: "ERR_RUNTIME_UNAVAILABLE",
        retryable: true,
        diagnosis: {
          category: "runtime_unavailable",
          stage: "runtime",
          component: "cli"
        }
      },
      observability: {
        coverage: "unavailable",
        request_evidence: "none",
        page_state: null,
        key_requests: [],
        failure_site: null
      }
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

  itWithSqlite("returns structured runtime unavailable when runtime store write conflicts", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const bootstrap = runCli(
      ["runtime.ping", "--run-id", "run-contract-005c-bootstrap"],
      runtimeCwd,
      {
        WEBENVOY_NATIVE_TRANSPORT: "loopback"
      }
    );
    expect(bootstrap.status).toBe(0);

    const dbPath = path.join(runtimeCwd, ".webenvoy", "runtime", "store.sqlite");
    const DatabaseSyncCtor = DatabaseSync as DatabaseSyncCtor;
    const db = new DatabaseSyncCtor(dbPath);
    db.prepare("BEGIN IMMEDIATE").run();

    try {
      const result = runCli(
        ["runtime.ping", "--run-id", "run-contract-005c"],
        runtimeCwd,
        {
          WEBENVOY_NATIVE_TRANSPORT: "loopback"
        }
      );
      expect(result.status).toBe(5);
      const body = parseSingleJsonLine(result.stdout);
      expect(body).toMatchObject({
        run_id: "run-contract-005c",
        command: "runtime.ping",
        status: "error",
        error: { code: "ERR_RUNTIME_UNAVAILABLE", retryable: true }
      });
      expect(String((body.error as Record<string, unknown>).message)).toContain(
        "ERR_RUNTIME_STORE_CONFLICT"
      );
      expect(result.stderr).not.toContain("\"type\":\"runtime_store_warning\"");
    } finally {
      db.prepare("ROLLBACK").run();
      db.close();
    }
  });

  it("keeps runtime.ping on stdio fallback for profile when official socket mode is not required", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const result = runCli(
      [
        "runtime.ping",
        "--profile",
        "profile_stdio_fallback",
        "--run-id",
        "run-contract-profile-stdio-001"
      ],
      runtimeCwd,
      {
        WEBENVOY_NATIVE_TRANSPORT: "native",
        WEBENVOY_NATIVE_HOST_CMD: createNativeHostCommand(nativeHostMockPath),
        WEBENVOY_NATIVE_HOST_MODE: "success"
      }
    );
    expect(result.status).toBe(0);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      run_id: "run-contract-profile-stdio-001",
      command: "runtime.ping",
      status: "success"
    });
  });

  it("keeps dry_run xhs.search on stdio fallback before official socket mode is confirmed", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const result = runCli(
      [
        "xhs.search",
        "--profile",
        "profile_stdio_fallback",
        "--run-id",
        "run-contract-xhs-stdio-001",
        "--params",
        JSON.stringify({
          ability: {
            id: "xhs.note.search.v1",
            layer: "L3",
            action: "read"
          },
          input: {
            query: "露营装备"
          },
          options: {
            ...scopedXhsGateOptions
          }
        })
      ],
      runtimeCwd,
      {
        WEBENVOY_NATIVE_TRANSPORT: "native",
        WEBENVOY_NATIVE_HOST_CMD: createNativeHostCommand(nativeHostMockPath),
        WEBENVOY_NATIVE_HOST_MODE: "success"
      }
    );
    expect(result.status).toBe(6);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      run_id: "run-contract-xhs-stdio-001",
      command: "xhs.search",
      status: "error",
      error: {
        code: "ERR_EXECUTION_FAILED",
        details: {
          reason: "CAPABILITY_RESULT_MISSING"
        }
      }
    });
  });

  it("returns execution failed error with code 6", () => {
    const result = runCli(["runtime.ping", "--params", '{"force_fail":true}']);
    expect(result.status).toBe(6);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      status: "error",
      error: {
        code: "ERR_EXECUTION_FAILED",
        diagnosis: {
          category: "unknown",
          stage: "execution",
          component: "runtime"
        }
      },
      observability: {
        coverage: "unavailable",
        page_state: null,
        key_requests: [],
        failure_site: null
      }
    });
  });

  it("keeps stdout as single JSON object for runtime.help", () => {
    const result = runCli(["runtime.help"]);
    expect(result.status).toBe(0);
    parseSingleJsonLine(result.stdout);
  });

  it("creates native host manifest and posix launcher through runtime.install", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const manifestDir = path.join(runtimeCwd, ".webenvoy", "native-host-install", "chrome", "manifests");
    const launcherPath = path.join(runtimeCwd, ".webenvoy", "native-host-install", "chrome", "bin", "webenvoy-native-host");
    const nativeHostEntryPath = path.join(runtimeCwd, "native-host-entry.mjs");
    await writeFile(nativeHostEntryPath, "process.stdin.resume();\n", "utf8");
    const hostCommand = createNativeHostCommand(nativeHostEntryPath);

    const result = runCli(
      [
        "runtime.install",
        "--run-id",
        "run-contract-install-001",
        "--params",
        JSON.stringify({
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          browser_channel: "chrome",
          native_host_name: "com.webenvoy.host",
          manifest_dir: manifestDir,
          launcher_path: launcherPath,
          host_command: hostCommand
        })
      ],
      runtimeCwd
    );
    expect(result.status).toBe(0);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      run_id: "run-contract-install-001",
      command: "runtime.install",
      status: "success",
      summary: {
        operation: "install",
        native_host_name: "com.webenvoy.host",
        browser_channel: "chrome",
        extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        manifest_path: path.join(manifestDir, "com.webenvoy.host.json"),
        launcher_path: launcherPath,
        host_command: hostCommand,
        allowed_origins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"],
        created: {
          manifest: true,
          launcher: true
        }
      }
    });

    const manifestRaw = await readFile(path.join(manifestDir, "com.webenvoy.host.json"), "utf8");
    const manifest = JSON.parse(manifestRaw) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      name: "com.webenvoy.host",
      description: "WebEnvoy CLI ↔ Extension bridge",
      path: launcherPath,
      type: "stdio",
      allowed_origins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]
    });

    const launcherRaw = await readFile(launcherPath, "utf8");
    expect(launcherRaw).toContain("#!/usr/bin/env bash");
    expect(launcherRaw).toContain("set -euo pipefail");
    expect(launcherRaw).toContain('exec ');
    expect(launcherRaw).toContain(' "$@"');
    const launcherMode = (await stat(launcherPath)).mode & 0o777;
    expect(launcherMode).toBe(0o755);
  });

  it("uses repo-owned native host entry as default runtime.install host_command", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const manifestDir = path.join(runtimeCwd, ".webenvoy", "native-host-install", "chrome", "manifests");
    const launcherPath = path.join(
      runtimeCwd,
      ".webenvoy",
      "native-host-install",
      "chrome",
      "bin",
      "webenvoy-native-host-default"
    );
    const defaultHostCommand = createNativeHostCommand(repoOwnedNativeHostEntryPath);

    const result = runCli(
      [
        "runtime.install",
        "--run-id",
        "run-contract-install-default-001",
        "--params",
        JSON.stringify({
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          browser_channel: "chrome",
          native_host_name: "com.webenvoy.host",
          manifest_dir: manifestDir,
          launcher_path: launcherPath
        })
      ],
      runtimeCwd
    );
    expect(result.status).toBe(0);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      run_id: "run-contract-install-default-001",
      command: "runtime.install",
      status: "success",
      summary: {
        operation: "install",
        native_host_name: "com.webenvoy.host",
        browser_channel: "chrome",
        extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        manifest_path: path.join(manifestDir, "com.webenvoy.host.json"),
        launcher_path: launcherPath,
        host_command: defaultHostCommand,
        allowed_origins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"],
        created: {
          manifest: true,
          launcher: true
        }
      }
    });

    const launcherRaw = await readFile(launcherPath, "utf8");
    expect(launcherRaw).toContain('exec ');
    expect(launcherRaw).toContain(' "$@"');
  });

  it("exports profile-scoped native bridge directory through runtime.install launcher", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const manifestDir = path.join(runtimeCwd, ".webenvoy", "native-host-install", "chrome", "manifests");
    const launcherPath = path.join(
      runtimeCwd,
      ".webenvoy",
      "native-host-install",
      "chrome",
      "bin",
      "webenvoy-native-host-profile-scoped"
    );
    const profileDir = path.join(runtimeCwd, ".webenvoy", "profiles", "xhs_208_probe");

    const result = runCli(
      [
        "runtime.install",
        "--run-id",
        "run-contract-install-profile-dir-001",
        "--params",
        JSON.stringify({
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          browser_channel: "chrome",
          native_host_name: "com.webenvoy.host",
          manifest_dir: manifestDir,
          launcher_path: launcherPath,
          profile_dir: profileDir
        })
      ],
      runtimeCwd
    );

    expect(result.status).toBe(0);
    const launcherRaw = await readFile(launcherPath, "utf8");
    expect(launcherRaw).toContain(
      `export WEBENVOY_NATIVE_BRIDGE_PROFILE_DIR='${profileDir.replace(/'/g, `'\"'\"'`)}'`
    );
    expect(launcherRaw).toContain('exec ');
    expect(launcherRaw).toContain(' "$@"');
  });

  it("keeps launcher execution shell-safe when host_command contains dollar-like characters", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const manifestDir = path.join(runtimeCwd, ".webenvoy", "native-host-install", "chrome", "manifests");
    const launcherPath = path.join(
      runtimeCwd,
      ".webenvoy",
      "native-host-install",
      "chrome",
      "bin",
      "webenvoy-native-host-shell-safe"
    );
    const markerPath = path.join(runtimeCwd, "marker-created-by-shell");
    const argvCapturePath = path.join(runtimeCwd, "launcher-argv.json");
    const hostileEntryPath = path.join(
      runtimeCwd,
      "native host $(touch marker-created-by-shell) $HOME.mjs"
    );
    await writeFile(
      hostileEntryPath,
      `import { writeFileSync } from "node:fs";\nwriteFileSync(process.env.WEBENVOY_ARGV_CAPTURE_PATH, JSON.stringify(process.argv.slice(2)) + "\\n", "utf8");\n`,
      "utf8"
    );
    const hostCommand = createNativeHostCommand(hostileEntryPath);

    const install = runCli(
      [
        "runtime.install",
        "--run-id",
        "run-contract-install-shell-safe-001",
        "--params",
        JSON.stringify({
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          browser_channel: "chrome",
          native_host_name: "com.webenvoy.host",
          manifest_dir: manifestDir,
          launcher_path: launcherPath,
          host_command: hostCommand
        })
      ],
      runtimeCwd
    );
    expect(install.status).toBe(0);

    const launch = spawnSync(launcherPath, ["--ping"], {
      cwd: runtimeCwd,
      encoding: "utf8",
      env: {
        ...process.env,
        WEBENVOY_ARGV_CAPTURE_PATH: argvCapturePath
      }
    });
    expect(launch.status).toBe(0);
    await expect(readFile(markerPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    expect(JSON.parse(await readFile(argvCapturePath, "utf8"))).toEqual(["--ping"]);
  });

  it("removes native host manifest and launcher through runtime.uninstall and keeps idempotency", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const manifestDir = path.join(runtimeCwd, ".webenvoy", "native-host-install", "chrome", "manifests");
    const launcherPath = path.join(runtimeCwd, ".webenvoy", "native-host-install", "chrome", "bin", "webenvoy-native-host");
    const nativeHostEntryPath = path.join(runtimeCwd, "native-host-entry.mjs");
    await writeFile(nativeHostEntryPath, "process.stdin.resume();\n", "utf8");

    const install = runCli(
      [
        "runtime.install",
        "--run-id",
        "run-contract-install-002",
        "--params",
        JSON.stringify({
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          browser_channel: "chrome",
          native_host_name: "com.webenvoy.host",
          manifest_dir: manifestDir,
          launcher_path: launcherPath,
          host_command: createNativeHostCommand(nativeHostEntryPath)
        })
      ],
      runtimeCwd
    );
    expect(install.status).toBe(0);

    const uninstall = runCli(
      [
        "runtime.uninstall",
        "--run-id",
        "run-contract-uninstall-001",
        "--params",
        JSON.stringify({
          browser_channel: "chrome",
          native_host_name: "com.webenvoy.host",
          manifest_dir: manifestDir,
          launcher_path: launcherPath
        })
      ],
      runtimeCwd
    );
    expect(uninstall.status).toBe(0);
    const uninstallBody = parseSingleJsonLine(uninstall.stdout);
    expect(uninstallBody).toMatchObject({
      run_id: "run-contract-uninstall-001",
      command: "runtime.uninstall",
      status: "success",
      summary: {
        operation: "uninstall",
        native_host_name: "com.webenvoy.host",
        browser_channel: "chrome",
        manifest_path: path.join(manifestDir, "com.webenvoy.host.json"),
        launcher_path: launcherPath,
        removed: {
          manifest: true,
          launcher: true
        }
      }
    });
    await expect(readFile(path.join(manifestDir, "com.webenvoy.host.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(readFile(launcherPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });

    const uninstallAgain = runCli(
      [
        "runtime.uninstall",
        "--run-id",
        "run-contract-uninstall-002",
        "--params",
        JSON.stringify({
          browser_channel: "chrome",
          native_host_name: "com.webenvoy.host",
          manifest_dir: manifestDir,
          launcher_path: launcherPath
        })
      ],
      runtimeCwd
    );
    expect(uninstallAgain.status).toBe(0);
    const uninstallAgainBody = parseSingleJsonLine(uninstallAgain.stdout);
    expect(uninstallAgainBody).toMatchObject({
      run_id: "run-contract-uninstall-002",
      command: "runtime.uninstall",
      status: "success",
      summary: {
        operation: "uninstall",
        removed: {
          manifest: false,
          launcher: false
        }
      }
    });
  });

  it("rejects runtime.install when manifest_dir or launcher_path escapes controlled roots", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const installByManifestDir = runCli(
      [
        "runtime.install",
        "--run-id",
        "run-contract-install-boundary-001",
        "--params",
        JSON.stringify({
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          browser_channel: "chrome",
          manifest_dir: "/tmp",
          launcher_path: path.join(runtimeCwd, ".webenvoy", "native-host-install", "chrome", "bin", "ok")
        })
      ],
      runtimeCwd
    );
    expect(installByManifestDir.status).toBe(2);
    expect(parseSingleJsonLine(installByManifestDir.stdout)).toMatchObject({
      command: "runtime.install",
      status: "error",
      error: {
        code: "ERR_CLI_INVALID_ARGS",
        details: {
          reason: "INSTALL_PATH_OUTSIDE_ALLOWED_ROOT",
          field: "manifest_dir"
        }
      }
    });

    const installByLauncherPath = runCli(
      [
        "runtime.install",
        "--run-id",
        "run-contract-install-boundary-002",
        "--params",
        JSON.stringify({
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          browser_channel: "chrome",
          manifest_dir: path.join(runtimeCwd, ".webenvoy", "native-host-install", "chrome", "manifests"),
          launcher_path: "/tmp/webenvoy-escape.sh"
        })
      ],
      runtimeCwd
    );
    expect(installByLauncherPath.status).toBe(2);
    expect(parseSingleJsonLine(installByLauncherPath.stdout)).toMatchObject({
      command: "runtime.install",
      status: "error",
      error: {
        code: "ERR_CLI_INVALID_ARGS",
        details: {
          reason: "INSTALL_PATH_OUTSIDE_ALLOWED_ROOT",
          field: "launcher_path"
        }
      }
    });
  });

  it("rejects runtime.uninstall when manifest_dir or launcher_path escapes controlled roots", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const uninstallByManifestDir = runCli(
      [
        "runtime.uninstall",
        "--run-id",
        "run-contract-uninstall-boundary-001",
        "--params",
        JSON.stringify({
          browser_channel: "chrome",
          native_host_name: "com.webenvoy.host",
          manifest_dir: "/tmp",
          launcher_path: path.join(runtimeCwd, ".webenvoy", "native-host-install", "chrome", "bin", "ok")
        })
      ],
      runtimeCwd
    );
    expect(uninstallByManifestDir.status).toBe(2);
    expect(parseSingleJsonLine(uninstallByManifestDir.stdout)).toMatchObject({
      command: "runtime.uninstall",
      status: "error",
      error: {
        code: "ERR_CLI_INVALID_ARGS",
        details: {
          reason: "INSTALL_PATH_OUTSIDE_ALLOWED_ROOT",
          field: "manifest_dir"
        }
      }
    });

    const uninstallByLauncherPath = runCli(
      [
        "runtime.uninstall",
        "--run-id",
        "run-contract-uninstall-boundary-002",
        "--params",
        JSON.stringify({
          browser_channel: "chrome",
          native_host_name: "com.webenvoy.host",
          manifest_dir: path.join(runtimeCwd, ".webenvoy", "native-host-install", "chrome", "manifests"),
          launcher_path: "/tmp/webenvoy-escape.sh"
        })
      ],
      runtimeCwd
    );
    expect(uninstallByLauncherPath.status).toBe(2);
    expect(parseSingleJsonLine(uninstallByLauncherPath.stdout)).toMatchObject({
      command: "runtime.uninstall",
      status: "error",
      error: {
        code: "ERR_CLI_INVALID_ARGS",
        details: {
          reason: "INSTALL_PATH_OUTSIDE_ALLOWED_ROOT",
          field: "launcher_path"
        }
      }
    });
  });

  it("rejects runtime.install when parent chain under controlled root contains symlink", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const channelRoot = path.join(runtimeCwd, ".webenvoy", "native-host-install", "chrome");
    const safeLauncherRoot = path.join(channelRoot, "bin");
    const symlinkedManifestRoot = path.join(channelRoot, "manifests");
    const externalManifestDir = await mkdtemp(path.join(tmpdir(), "webenvoy-install-symlink-"));
    tempDirs.push(externalManifestDir);
    await mkdir(channelRoot, { recursive: true });
    await mkdir(safeLauncherRoot, { recursive: true });
    await symlink(externalManifestDir, symlinkedManifestRoot);

    const install = runCli(
      [
        "runtime.install",
        "--run-id",
        "run-contract-install-symlink-001",
        "--params",
        JSON.stringify({
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          browser_channel: "chrome",
          native_host_name: "com.webenvoy.host",
          manifest_dir: path.join(symlinkedManifestRoot, "nested"),
          launcher_path: path.join(safeLauncherRoot, "webenvoy-native-host")
        })
      ],
      runtimeCwd
    );
    expect(install.status).toBe(2);
    expect(parseSingleJsonLine(install.stdout)).toMatchObject({
      command: "runtime.install",
      status: "error",
      error: {
        code: "ERR_CLI_INVALID_ARGS",
        details: {
          reason: "INSTALL_PATH_PARENT_SYMBOLIC_LINK",
          field: "manifest_dir"
        }
      }
    });
  });

  it("rejects runtime.uninstall when parent chain under controlled root contains symlink", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const channelRoot = path.join(runtimeCwd, ".webenvoy", "native-host-install", "chrome");
    const safeManifestRoot = path.join(channelRoot, "manifests");
    const symlinkedLauncherRoot = path.join(channelRoot, "bin");
    const externalLauncherDir = await mkdtemp(path.join(tmpdir(), "webenvoy-uninstall-symlink-"));
    tempDirs.push(externalLauncherDir);
    await mkdir(channelRoot, { recursive: true });
    await mkdir(safeManifestRoot, { recursive: true });
    await symlink(externalLauncherDir, symlinkedLauncherRoot);

    const uninstall = runCli(
      [
        "runtime.uninstall",
        "--run-id",
        "run-contract-uninstall-symlink-001",
        "--params",
        JSON.stringify({
          browser_channel: "chrome",
          native_host_name: "com.webenvoy.host",
          manifest_dir: safeManifestRoot,
          launcher_path: path.join(symlinkedLauncherRoot, "webenvoy-native-host")
        })
      ],
      runtimeCwd
    );
    expect(uninstall.status).toBe(2);
    expect(parseSingleJsonLine(uninstall.stdout)).toMatchObject({
      command: "runtime.uninstall",
      status: "error",
      error: {
        code: "ERR_CLI_INVALID_ARGS",
        details: {
          reason: "INSTALL_PATH_PARENT_SYMBOLIC_LINK",
          field: "launcher_path"
        }
      }
    });
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

    const status = runCli(["runtime.status", "--profile", "default", "--run-id", "run-contract-100"], runtimeCwd);
    expect(status.status).toBe(0);
    const statusBody = parseSingleJsonLine(status.stdout);
    expect(statusBody).toMatchObject({
      command: "runtime.status",
      status: "success",
      summary: {
        profile: "default",
        profileState: "ready",
        browserState: "ready",
        proxyUrl: "http://127.0.0.1:8080/",
        lockHeld: true
      }
    });
  });

  it("returns machine-readable identity mismatch for official Chrome persistent extension preflight", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const manifestPath = await createNativeHostManifest({
      allowedOrigins: ["chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/"]
    });

    const result = runCli(
      [
        "runtime.start",
        "--profile",
        "identity_mismatch_profile",
        "--run-id",
        "run-contract-identity-001",
        "--params",
        JSON.stringify({
          persistent_extension_identity: {
            extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            manifest_path: manifestPath
          }
        })
      ],
      runtimeCwd,
      {
        WEBENVOY_BROWSER_MOCK_VERSION: "Google Chrome 146.0.7680.154"
      }
    );

    expect(result.status).toBe(5);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      run_id: "run-contract-identity-001",
      command: "runtime.start",
      status: "error",
      error: {
        code: "ERR_RUNTIME_IDENTITY_MISMATCH",
        details: {
          ability_id: "runtime.identity_preflight",
          identity_binding_state: "mismatch",
          expected_origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/",
          manifest_path: manifestPath
        }
      }
    });
  });

  it("does not surface identity-not-bound before official Chrome first start/login", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const runtimeEnv = {
      WEBENVOY_BROWSER_MOCK_VERSION: "Google Chrome 146.0.7680.154"
    };

    const start = runCli(
      ["runtime.start", "--profile", "identity_not_bound_start_profile", "--run-id", "run-contract-identity-001a"],
      runtimeCwd,
      runtimeEnv
    );
    expect(start.status).toBe(0);
    const startBody = parseSingleJsonLine(start.stdout);
    expect(startBody).toMatchObject({
      run_id: "run-contract-identity-001a",
      command: "runtime.start",
      status: "success",
      summary: {
        profile: "identity_not_bound_start_profile",
        browserState: "ready",
        identityBindingState: "missing",
        bootstrapState: "not_started",
        runtimeReadiness: "blocked"
      }
    });

    const login = runCli(
      ["runtime.login", "--profile", "identity_not_bound_login_profile", "--run-id", "run-contract-identity-001b"],
      runtimeCwd,
      runtimeEnv
    );
    expect(login.status).toBe(0);
    const loginBody = parseSingleJsonLine(login.stdout);
    expect(loginBody).toMatchObject({
      run_id: "run-contract-identity-001b",
      command: "runtime.login",
      status: "success",
      summary: {
        profile: "identity_not_bound_login_profile",
        browserState: "logging_in",
        identityBindingState: "missing",
        bootstrapState: "not_started",
        runtimeReadiness: "blocked"
      }
    });
  });

  it("surfaces bound identity preflight via runtime.status after recoverable transport failure during runtime.start", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const manifestPath = await createNativeHostManifest({
      allowedOrigins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]
    });
    await seedInstalledPersistentExtension({
      cwd: runtimeCwd,
      profile: "identity_bound_profile"
    });

    const start = runCli(
      [
        "runtime.start",
        "--profile",
        "identity_bound_profile",
        "--run-id",
        "run-contract-identity-002",
        "--params",
        JSON.stringify({
          persistent_extension_identity: {
            extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            manifest_path: manifestPath
          }
        })
      ],
      runtimeCwd,
      {
        WEBENVOY_BROWSER_MOCK_VERSION: "Google Chrome 146.0.7680.154"
      }
    );

    expect(start.status).toBe(0);
    const startBody = parseSingleJsonLine(start.stdout);
    expect(startBody).toMatchObject({
      command: "runtime.start",
      status: "success",
      summary: {
        identityBindingState: "bound",
        transportState: "not_connected",
        bootstrapState: "not_started",
        runtimeReadiness: "recoverable"
      }
    });
    await seedInstalledPersistentExtension({
      cwd: runtimeCwd,
      profile: "identity_bound_profile"
    });

    const status = runCli(
      [
        "runtime.status",
        "--profile",
        "identity_bound_profile",
        "--run-id",
        "run-contract-identity-002",
        "--params",
        JSON.stringify({
          persistent_extension_identity: {
            extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            manifest_path: manifestPath
          }
        })
      ],
      runtimeCwd,
      {
        WEBENVOY_BROWSER_MOCK_VERSION: "Google Chrome 146.0.7680.154"
      }
    );
    expect(status.status).toBe(0);
    const statusBody = parseSingleJsonLine(status.stdout);
    expect(statusBody).toMatchObject({
      command: "runtime.status",
      status: "success",
      summary: {
        identityBindingState: "bound",
        transportState: "not_connected",
        bootstrapState: "not_started",
        runtimeReadiness: "recoverable",
        identityPreflight: {
          mode: "official_chrome_persistent_extension",
          manifestPath,
          expectedOrigin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"
        }
      }
    });
  });

  it("surfaces bootstrap ack timeout as recoverable readiness during official Chrome runtime.start", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const manifestPath = await createNativeHostManifest({
      allowedOrigins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]
    });
    await seedInstalledPersistentExtension({
      cwd: runtimeCwd,
      profile: "identity_bootstrap_timeout_profile"
    });

    const start = runCli(
      [
        "runtime.start",
        "--profile",
        "identity_bootstrap_timeout_profile",
        "--run-id",
        "run-contract-bootstrap-timeout-001",
        "--params",
        JSON.stringify({
          persistent_extension_identity: {
            extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            manifest_path: manifestPath
          }
        })
      ],
      runtimeCwd,
      {
        WEBENVOY_BROWSER_MOCK_VERSION: "Google Chrome 146.0.7680.154",
        WEBENVOY_NATIVE_HOST_CMD: createNativeHostCommand(nativeHostMockPath),
        WEBENVOY_NATIVE_HOST_MODE: "bootstrap-ack-timeout-error"
      }
    );

    expect(start.status).toBe(0);
    const startBody = parseSingleJsonLine(start.stdout);
    expect(startBody).toMatchObject({
      command: "runtime.start",
      status: "success",
      summary: {
        identityBindingState: "bound",
        transportState: "ready",
        bootstrapState: "pending",
        runtimeReadiness: "recoverable"
      }
    });
  });

  it("surfaces stale bootstrap ack during official Chrome runtime.start", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const manifestPath = await createNativeHostManifest({
      allowedOrigins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]
    });
    await seedInstalledPersistentExtension({
      cwd: runtimeCwd,
      profile: "identity_bootstrap_stale_profile"
    });

    const start = runCli(
      [
        "runtime.start",
        "--profile",
        "identity_bootstrap_stale_profile",
        "--run-id",
        "run-contract-bootstrap-stale-001",
        "--params",
        JSON.stringify({
          persistent_extension_identity: {
            extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            manifest_path: manifestPath
          }
        })
      ],
      runtimeCwd,
      {
        WEBENVOY_BROWSER_MOCK_VERSION: "Google Chrome 146.0.7680.154",
        WEBENVOY_NATIVE_HOST_CMD: createNativeHostCommand(nativeHostMockPath),
        WEBENVOY_NATIVE_HOST_MODE: "bootstrap-stale"
      }
    );

    expect(start.status).toBe(0);
    const startBody = parseSingleJsonLine(start.stdout);
    expect(startBody).toMatchObject({
      command: "runtime.start",
      status: "success",
      summary: {
        identityBindingState: "bound",
        transportState: "ready",
        bootstrapState: "stale",
        runtimeReadiness: "blocked"
      }
    });
  });

  it("surfaces bootstrap ready-signal conflict during official Chrome runtime.start", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const manifestPath = await createNativeHostManifest({
      allowedOrigins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]
    });
    await seedInstalledPersistentExtension({
      cwd: runtimeCwd,
      profile: "identity_bootstrap_conflict_profile"
    });

    const start = runCli(
      [
        "runtime.start",
        "--profile",
        "identity_bootstrap_conflict_profile",
        "--run-id",
        "run-contract-bootstrap-conflict-001",
        "--params",
        JSON.stringify({
          persistent_extension_identity: {
            extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            manifest_path: manifestPath
          }
        })
      ],
      runtimeCwd,
      {
        WEBENVOY_BROWSER_MOCK_VERSION: "Google Chrome 146.0.7680.154",
        WEBENVOY_NATIVE_HOST_CMD: createNativeHostCommand(nativeHostMockPath),
        WEBENVOY_NATIVE_HOST_MODE: "bootstrap-ready-signal-conflict"
      }
    );

    expect(start.status).toBe(0);
    const startBody = parseSingleJsonLine(start.stdout);
    expect(startBody).toMatchObject({
      command: "runtime.start",
      status: "success",
      summary: {
        identityBindingState: "bound",
        transportState: "ready",
        bootstrapState: "failed",
        runtimeReadiness: "unknown"
      }
    });
  });

  it("reports bound identity preflight from persisted binding when runtime.status omits identity input", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const manifestPath = await createNativeHostManifest({
      allowedOrigins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]
    });
    await seedInstalledPersistentExtension({
      cwd: runtimeCwd,
      profile: "identity_manifest_reuse_profile"
    });

    const start = runCli(
      [
        "runtime.start",
        "--profile",
        "identity_manifest_reuse_profile",
        "--run-id",
        "run-contract-identity-003",
        "--params",
        JSON.stringify({
          persistent_extension_identity: {
            extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            manifest_path: manifestPath
          }
        })
      ],
      runtimeCwd,
      {
        WEBENVOY_BROWSER_MOCK_VERSION: "Google Chrome 146.0.7680.154"
      }
    );
    expect(start.status).toBe(0);
    const startBody = parseSingleJsonLine(start.stdout);
    expect(startBody).toMatchObject({
      command: "runtime.start",
      status: "success",
      summary: {
        identityBindingState: "bound",
        transportState: "not_connected",
        bootstrapState: "not_started",
        runtimeReadiness: "recoverable"
      }
    });
    await seedInstalledPersistentExtension({
      cwd: runtimeCwd,
      profile: "identity_manifest_reuse_profile"
    });

    const status = runCli(
      [
        "runtime.status",
        "--profile",
        "identity_manifest_reuse_profile",
        "--run-id",
        "run-contract-identity-003"
      ],
      runtimeCwd,
      {
        WEBENVOY_BROWSER_MOCK_VERSION: "Google Chrome 146.0.7680.154"
      }
    );
    expect(status.status).toBe(0);
    const statusBody = parseSingleJsonLine(status.stdout);
    expect(statusBody).toMatchObject({
      command: "runtime.status",
      status: "success",
      summary: {
        identityBindingState: "bound",
        transportState: "not_connected",
        bootstrapState: "not_started",
        runtimeReadiness: "recoverable",
        identityPreflight: {
          mode: "official_chrome_persistent_extension",
          manifestPath,
          expectedOrigin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"
        }
      }
    });
  });

  it("rejects invalid persisted nativeHostName on runtime.status/runtime.start/runtime.login default paths", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const start = runCli(
      [
        "runtime.start",
        "--profile",
        "invalid_identity_binding_profile",
        "--run-id",
        "run-contract-invalid-binding-001"
      ],
      runtimeCwd
    );
    expect(start.status).toBe(0);
    const startBody = parseSingleJsonLine(start.stdout);
    const startSummary = startBody.summary as Record<string, unknown>;
    const profileDir = String(startSummary.profileDir);

    const stop = runCli(
      [
        "runtime.stop",
        "--profile",
        "invalid_identity_binding_profile",
        "--run-id",
        "run-contract-invalid-binding-001"
      ],
      runtimeCwd
    );
    expect(stop.status).toBe(0);

    const metaPath = path.join(profileDir, "__webenvoy_meta.json");
    const metaRaw = await readFile(metaPath, "utf8");
    const meta = JSON.parse(metaRaw) as Record<string, unknown>;
    meta.persistentExtensionBinding = {
      extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      nativeHostName: "com..invalid",
      browserChannel: "chrome",
      manifestPath: "/tmp/native-host.json"
    };
    await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");

    const status = runCli(
      ["runtime.status", "--profile", "invalid_identity_binding_profile"],
      runtimeCwd
    );
    expect(status.status).toBe(5);
    expect(parseSingleJsonLine(status.stdout)).toMatchObject({
      command: "runtime.status",
      status: "error",
      error: { code: "ERR_PROFILE_META_CORRUPT" }
    });

    const restart = runCli(
      [
        "runtime.start",
        "--profile",
        "invalid_identity_binding_profile",
        "--run-id",
        "run-contract-invalid-binding-002"
      ],
      runtimeCwd
    );
    expect(restart.status).toBe(5);
    expect(parseSingleJsonLine(restart.stdout)).toMatchObject({
      command: "runtime.start",
      status: "error",
      error: { code: "ERR_PROFILE_META_CORRUPT" }
    });

    const login = runCli(
      [
        "runtime.login",
        "--profile",
        "invalid_identity_binding_profile",
        "--run-id",
        "run-contract-invalid-binding-003"
      ],
      runtimeCwd
    );
    expect(login.status).toBe(5);
    expect(parseSingleJsonLine(login.stdout)).toMatchObject({
      command: "runtime.login",
      status: "error",
      error: { code: "ERR_PROFILE_META_CORRUPT" }
    });
  });

  it("keeps runtime.start/status/stop available when using shell mock browser fixture path", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const runtimeEnv = {
      WEBENVOY_BROWSER_PATH: mockBrowserPath
    };

    const start = runCli(
      ["runtime.start", "--profile", "fixture_version_profile", "--run-id", "run-contract-fixture-001"],
      runtimeCwd,
      runtimeEnv
    );
    expect(start.status).toBe(0);
    const startBody = parseSingleJsonLine(start.stdout);
    expect(startBody).toMatchObject({
      command: "runtime.start",
      status: "success",
      summary: {
        profile: "fixture_version_profile",
        browserState: "ready",
        lockHeld: true
      }
    });

    const status = runCli(
      ["runtime.status", "--profile", "fixture_version_profile", "--run-id", "run-contract-fixture-001"],
      runtimeCwd,
      runtimeEnv
    );
    expect(status.status).toBe(0);
    const statusBody = parseSingleJsonLine(status.stdout);
    expect(statusBody).toMatchObject({
      command: "runtime.status",
      status: "success",
      summary: {
        profile: "fixture_version_profile",
        browserState: "ready",
        lockHeld: true
      }
    });

    const stop = runCli(
      ["runtime.stop", "--profile", "fixture_version_profile", "--run-id", "run-contract-fixture-001"],
      runtimeCwd,
      runtimeEnv
    );
    expect(stop.status).toBe(0);
    const stopBody = parseSingleJsonLine(stop.stdout);
    expect(stopBody).toMatchObject({
      command: "runtime.stop",
      status: "success",
      summary: {
        profile: "fixture_version_profile",
        browserState: "absent",
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
    const launchLogRaw = await readFile(path.join(runtimeCwd, ".browser-launch.log"), "utf8");
    const launchLogLines = launchLogRaw
      .trim()
      .split("\n")
      .filter((line) => line.length > 0);
    expect(launchLogLines.length).toBeGreaterThan(0);
    const lastLaunch = JSON.parse(launchLogLines[launchLogLines.length - 1]) as { args: string };
    expect(lastLaunch.args).not.toContain("--headless=new");

    const statusBeforeConfirm = runCli(
      ["runtime.status", "--profile", "login_profile", "--run-id", "run-contract-151"],
      runtimeCwd
    );
    expect(statusBeforeConfirm.status).toBe(0);
    const statusBeforeConfirmBody = parseSingleJsonLine(statusBeforeConfirm.stdout);
    expect(statusBeforeConfirmBody).toMatchObject({
      command: "runtime.status",
      status: "success",
      summary: {
        profile: "login_profile",
        profileState: "logging_in",
        browserState: "logging_in",
        lockHeld: true
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

  it("rejects runtime.login --confirm when login browser is disconnected and converges to disconnected", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const login = runCli(
      ["runtime.login", "--profile", "login_disconnect_profile", "--run-id", "run-contract-156"],
      runtimeCwd
    );
    expect(login.status).toBe(0);
    const loginBody = parseSingleJsonLine(login.stdout);
    const loginSummary = loginBody.summary as Record<string, unknown>;
    const profileDir = String(loginSummary.profileDir);

    const lockPath = path.join(profileDir, "__webenvoy_lock.json");
    const browserStatePath = path.join(profileDir, browserStateFilename);
    const lockRaw = await readFile(lockPath, "utf8");
    const lock = JSON.parse(lockRaw) as Record<string, unknown>;
    lock.ownerPid = 999999;
    lock.lastHeartbeatAt = new Date().toISOString();
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
    await rm(browserStatePath, { force: true });

    const confirm = runCli(
      [
        "runtime.login",
        "--profile",
        "login_disconnect_profile",
        "--run-id",
        "run-contract-156",
        "--params",
        "{\"confirm\":true}"
      ],
      runtimeCwd
    );
    expect(confirm.status).toBe(5);
    const confirmBody = parseSingleJsonLine(confirm.stdout);
    expect(confirmBody).toMatchObject({
      command: "runtime.login",
      status: "error",
      error: { code: "ERR_PROFILE_STATE_CONFLICT", retryable: true }
    });

    const status = runCli(["runtime.status", "--profile", "login_disconnect_profile"], runtimeCwd);
    expect(status.status).toBe(0);
    const statusBody = parseSingleJsonLine(status.stdout);
    expect(statusBody).toMatchObject({
      command: "runtime.status",
      status: "success",
      summary: {
        profile: "login_disconnect_profile",
        profileState: "disconnected",
        browserState: "disconnected",
        lockHeld: false
      }
    });

    const metaPath = path.join(profileDir, "__webenvoy_meta.json");
    const rawMeta = await readFile(metaPath, "utf8");
    const meta = JSON.parse(rawMeta) as Record<string, unknown>;
    expect(meta.profileState).toBe("disconnected");
    expect(typeof meta.lastDisconnectedAt).toBe("string");
    await expect(readFile(lockPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
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
    expect(successCount).toBe(1);
    expect(failureCount).toBe(1);

    const failed = [first, second].find((result) => result.status === 5);
    expect(failed).toBeDefined();
    const failedBody = parseSingleJsonLine(failed!.stdout);
    expect(failedBody).toMatchObject({
      command: "runtime.start",
      status: "error",
      error: {
        code: "ERR_PROFILE_LOCKED"
      }
    });
  });

  it("supports runtime.stop and reflects stopped state via runtime.status", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const start = runCli(
      ["runtime.start", "--profile", "stop_profile", "--run-id", "run-contract-301"],
      runtimeCwd
    );
    expect(start.status).toBe(0);
    const startBody = parseSingleJsonLine(start.stdout);
    const startSummary = startBody.summary as Record<string, unknown>;
    const profileDir = String(startSummary.profileDir);
    const browserPid = Number(startSummary.browserPid);
    const controllerPid = Number(startSummary.controllerPid);
    expect(browserPid).toBeGreaterThan(0);
    expect(controllerPid).toBeGreaterThan(0);

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
    expect(isPidAlive(browserPid)).toBe(false);
    expect(isPidAlive(controllerPid)).toBe(false);
    await expect(readFile(path.join(profileDir, BROWSER_STATE_FILENAME), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(readFile(path.join(profileDir, BROWSER_CONTROL_FILENAME), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
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
    const browserStatePath = path.join(profileDir, browserStateFilename);

    const lockRaw = await readFile(lockPath, "utf8");
    const lock = JSON.parse(lockRaw) as Record<string, unknown>;
    lock.ownerPid = 999999;
    lock.lastHeartbeatAt = new Date().toISOString();
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
    await rm(browserStatePath, { force: true });
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

  it("allows runtime.stop recovery when controller pid is dead but browser pid is still alive", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const start = runCli(
      ["runtime.start", "--profile", "recover_stop_profile", "--run-id", "run-contract-506"],
      runtimeCwd
    );
    expect(start.status).toBe(0);
    const startBody = parseSingleJsonLine(start.stdout);
    const summary = startBody.summary as Record<string, unknown>;
    const profileDir = String(summary.profileDir);
    const lockPath = path.join(profileDir, "__webenvoy_lock.json");
    const browserStatePath = path.join(profileDir, BROWSER_STATE_FILENAME);

    const lockRaw = await readFile(lockPath, "utf8");
    const lock = JSON.parse(lockRaw) as Record<string, unknown>;
    lock.ownerPid = 999999;
    lock.lastHeartbeatAt = new Date().toISOString();
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
    const browserStateRaw = await readFile(browserStatePath, "utf8");
    const browserState = JSON.parse(browserStateRaw) as Record<string, unknown>;
    browserState.controllerPid = 999999;
    await writeFile(browserStatePath, `${JSON.stringify(browserState, null, 2)}\n`, "utf8");

    const status = runCli(
      ["runtime.status", "--profile", "recover_stop_profile", "--run-id", "run-contract-506"],
      runtimeCwd
    );
    expect(status.status).toBe(0);
    const statusBody = parseSingleJsonLine(status.stdout);
    expect(statusBody).toMatchObject({
      command: "runtime.status",
      status: "success",
      summary: {
        profile: "recover_stop_profile",
        profileState: "disconnected",
        browserState: "disconnected",
        lockHeld: true
      }
    });

    const stop = runCli(
      ["runtime.stop", "--profile", "recover_stop_profile", "--run-id", "run-contract-506"],
      runtimeCwd
    );
    expect(stop.status).toBe(0);
    const stopBody = parseSingleJsonLine(stop.stdout);
    expect(stopBody).toMatchObject({
      command: "runtime.stop",
      status: "success",
      summary: {
        profile: "recover_stop_profile",
        profileState: "stopped",
        lockHeld: false,
        orphanRecovered: false
      }
    });

    await assertLockMissing(profileDir);
    await expect(readFile(path.join(profileDir, BROWSER_STATE_FILENAME), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(readFile(path.join(profileDir, BROWSER_CONTROL_FILENAME), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("allows explicit runtime.stop orphan recovery from a new run_id after controller ownership is lost", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const start = runCli(
      ["runtime.start", "--profile", "orphan_recover_profile", "--run-id", "run-contract-507"],
      runtimeCwd
    );
    expect(start.status).toBe(0);
    const startBody = parseSingleJsonLine(start.stdout);
    const summary = startBody.summary as Record<string, unknown>;
    const profileDir = String(summary.profileDir);
    const lockPath = path.join(profileDir, "__webenvoy_lock.json");
    const browserStatePath = path.join(profileDir, BROWSER_STATE_FILENAME);

    const lockRaw = await readFile(lockPath, "utf8");
    const lock = JSON.parse(lockRaw) as Record<string, unknown>;
    lock.ownerPid = 999999;
    lock.lastHeartbeatAt = new Date().toISOString();
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
    const browserStateRaw = await readFile(browserStatePath, "utf8");
    const browserState = JSON.parse(browserStateRaw) as Record<string, unknown>;
    browserState.controllerPid = 999999;
    await writeFile(browserStatePath, `${JSON.stringify(browserState, null, 2)}\n`, "utf8");

    const blockedStart = runCli(
      ["runtime.start", "--profile", "orphan_recover_profile", "--run-id", "run-contract-508"],
      runtimeCwd
    );
    expect(blockedStart.status).toBe(5);
    const blockedStartBody = parseSingleJsonLine(blockedStart.stdout);
    expect(blockedStartBody).toMatchObject({
      command: "runtime.start",
      status: "error",
      error: { code: "ERR_PROFILE_LOCKED" }
    });

    const stop = runCli(
      ["runtime.stop", "--profile", "orphan_recover_profile", "--run-id", "run-contract-509"],
      runtimeCwd
    );
    expect(stop.status).toBe(0);
    const stopBody = parseSingleJsonLine(stop.stdout);
    expect(stopBody).toMatchObject({
      command: "runtime.stop",
      status: "success",
      summary: {
        profile: "orphan_recover_profile",
        profileState: "stopped",
        lockHeld: false,
        orphanRecovered: true
      }
    });

    await assertLockMissing(profileDir);
    await expect(readFile(path.join(profileDir, BROWSER_STATE_FILENAME), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(readFile(path.join(profileDir, BROWSER_CONTROL_FILENAME), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });

    const restarted = runCli(
      ["runtime.start", "--profile", "orphan_recover_profile", "--run-id", "run-contract-510"],
      runtimeCwd
    );
    expect(restarted.status).toBe(0);
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

    const status = runCli(
      ["runtime.status", "--profile", "live_owner_profile", "--run-id", "run-contract-511"],
      runtimeCwd
    );
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

  it("keeps lock when same run_id retries runtime.start and hits state conflict", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const first = runCli(
      ["runtime.start", "--profile", "same_run_retry_profile", "--run-id", "run-contract-521"],
      runtimeCwd
    );
    expect(first.status).toBe(0);
    const firstBody = parseSingleJsonLine(first.stdout);
    const firstSummary = firstBody.summary as Record<string, unknown>;
    const profileDir = String(firstSummary.profileDir);
    const lockPath = path.join(profileDir, "__webenvoy_lock.json");

    const second = runCli(
      ["runtime.start", "--profile", "same_run_retry_profile", "--run-id", "run-contract-521"],
      runtimeCwd
    );
    expect(second.status).toBe(5);
    const secondBody = parseSingleJsonLine(second.stdout);
    expect(secondBody).toMatchObject({
      command: "runtime.start",
      status: "error",
      error: { code: "ERR_PROFILE_STATE_CONFLICT" }
    });

    const lockRaw = await readFile(lockPath, "utf8");
    const lock = JSON.parse(lockRaw) as Record<string, unknown>;
    expect(lock.ownerRunId).toBe("run-contract-521");

    const status = runCli(
      ["runtime.status", "--profile", "same_run_retry_profile", "--run-id", "run-contract-521"],
      runtimeCwd
    );
    expect(status.status).toBe(0);
    const statusBody = parseSingleJsonLine(status.stdout);
    expect(statusBody).toMatchObject({
      command: "runtime.status",
      status: "success",
      summary: {
        profile: "same_run_retry_profile",
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
    const browserStatePath = path.join(profileDir, browserStateFilename);

    const lockRaw = await readFile(lockPath, "utf8");
    const lock = JSON.parse(lockRaw) as Record<string, unknown>;
    lock.ownerPid = 999999;
    lock.lastHeartbeatAt = new Date().toISOString();
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
    await rm(browserStatePath, { force: true });

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
    const browserStatePath = path.join(profileDir, browserStateFilename);
    const lockRaw = await readFile(lockPath, "utf8");
    const lock = JSON.parse(lockRaw) as Record<string, unknown>;
    lock.ownerPid = 999999;
    lock.lastHeartbeatAt = new Date().toISOString();
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
    await rm(browserStatePath, { force: true });

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

  const realBrowserContract = realBrowserContractsEnabled ? it : it.skip;

  realBrowserContract("persists cookie/localStorage across second start on same profile via local fixture page", async () => {
    const realBrowserPath = detectSystemChromePath();
    expect(realBrowserPath).not.toBeNull();

    const runtimeCwd = await createRuntimeCwd();
    const probeSupportCheck = runHeadlessDomProbe(String(realBrowserPath), runtimeCwd, "about:blank");
    expect(probeSupportCheck.status).toBe(0);

    const token = "persist_token_v1";
    const server = createServer((req, res) => {
      if (!req.url) {
        res.statusCode = 404;
        res.end("missing url");
        return;
      }
      if (req.url.startsWith("/seed")) {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(`<!doctype html>
<html><body>
<script>
document.cookie = "fixture_cookie=${token}; path=/; SameSite=Lax";
localStorage.setItem("fixture_local", "${token}");
document.body.textContent = "seeded";
</script>
</body></html>`);
        return;
      }
      if (req.url.startsWith("/read")) {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(`<!doctype html>
<html><body>
<script>
const state = {
  cookie: document.cookie,
  local: localStorage.getItem("fixture_local") || ""
};
document.body.textContent = JSON.stringify(state);
</script>
</body></html>`);
        return;
      }
      res.statusCode = 404;
      res.end("not found");
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("failed to resolve fixture server address");
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const env = { WEBENVOY_BROWSER_PATH: String(realBrowserPath) };

    try {
      const firstStart = runCli(
        [
          "runtime.start",
          "--profile",
          "fixture_persist_profile",
          "--run-id",
          "run-contract-971",
          "--params",
          JSON.stringify({
            startUrl: `${baseUrl}/seed`,
            headless: true
          })
        ],
        runtimeCwd,
        env
      );
      expect(firstStart.status).toBe(0);
      const firstStartBody = parseSingleJsonLine(firstStart.stdout);
      const firstSummary = firstStartBody.summary as Record<string, unknown>;
      const profileDir = String(firstSummary.profileDir);

      await wait(900);

      const firstStop = runCli(
        ["runtime.stop", "--profile", "fixture_persist_profile", "--run-id", "run-contract-971"],
        runtimeCwd,
        env
      );
      expect(firstStop.status).toBe(0);

      const secondStart = runCli(
        [
          "runtime.start",
          "--profile",
          "fixture_persist_profile",
          "--run-id",
          "run-contract-972",
          "--params",
          JSON.stringify({
            headless: true
          })
        ],
        runtimeCwd,
        env
      );
      expect(secondStart.status).toBe(0);

      const secondStop = runCli(
        ["runtime.stop", "--profile", "fixture_persist_profile", "--run-id", "run-contract-972"],
        runtimeCwd,
        env
      );
      expect(secondStop.status).toBe(0);

      const probe = runHeadlessDomProbe(realBrowserPath, profileDir, `${baseUrl}/read`);
      expect(probe.status).toBe(0);
      expect(probe.stdout).toContain(`"local":"${token}"`);
      expect(probe.stdout).toContain(`fixture_cookie=${token}`);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
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
