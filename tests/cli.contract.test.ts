import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.join(import.meta.dirname, ".."));
const binPath = path.join(repoRoot, "bin", "webenvoy");
const mockBrowserPath = path.join(repoRoot, "tests", "fixtures", "mock-browser.sh");
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
    ).toEqual(expect.arrayContaining(["ACTION_TYPE_NOT_EXPLICIT", "ACTION_DOMAIN_MISMATCH"]));
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
        "EXECUTION_MODE_UNSUPPORTED_FOR_COMMAND",
        "ACTION_TYPE_UNSUPPORTED_FOR_COMMAND"
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
            risk_state: "allowed",
            gate_decision: "allowed",
            requested_execution_mode: "live_read_high_risk",
            effective_execution_mode: "live_read_high_risk",
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:00Z"
          }
        ],
        risk_state_output: {
          current_state: "allowed",
          issue_action_matrix: [
            {
              issue_scope: "issue_208",
              state: "allowed"
            },
            {
              issue_scope: "issue_209",
              state: "allowed"
            }
          ]
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
            risk_state: "allowed",
            gate_decision: "blocked",
            requested_execution_mode: "live_read_high_risk",
            effective_execution_mode: "dry_run",
            approver: null,
            approved_at: null
          }
        ],
        risk_state_output: {
          current_state: "allowed",
          issue_action_matrix: [
            {
              issue_scope: "issue_208",
              state: "allowed"
            },
            {
              issue_scope: "issue_209",
              state: "allowed"
            }
          ]
        }
      }
    });
    expect(
      ((((body.summary as Record<string, unknown>).audit_records as Record<string, unknown>[])[0]
        .gate_reasons as string[]) ?? [])
    ).toEqual(expect.arrayContaining(["MANUAL_CONFIRMATION_MISSING"]));
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
        profileState: "ready",
        browserState: "ready",
        proxyUrl: "http://127.0.0.1:8080/",
        lockHeld: true
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

    const statusBeforeConfirm = runCli(["runtime.status", "--profile", "login_profile"], runtimeCwd);
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

    const lockRaw = await readFile(lockPath, "utf8");
    const lock = JSON.parse(lockRaw) as Record<string, unknown>;
    lock.ownerPid = 999999;
    lock.lastHeartbeatAt = new Date().toISOString();
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");

    const status = runCli(["runtime.status", "--profile", "recover_stop_profile"], runtimeCwd);
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
        lockHeld: false
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

    const status = runCli(["runtime.status", "--profile", "same_run_retry_profile"], runtimeCwd);
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
