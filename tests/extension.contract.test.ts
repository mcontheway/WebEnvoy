import fs from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.join(import.meta.dirname, ".."));
const extensionRoot = path.join(repoRoot, "extension");
const manifestPath = path.join(extensionRoot, "manifest.json");
const backgroundBuildPath = path.join(extensionRoot, "build", "background.js");
const mainWorldBridgeBuildPath = path.join(extensionRoot, "build", "main-world-bridge.js");
const contentScriptBuildPath = path.join(extensionRoot, "build", "content-script.js");
const contentScriptHandlerBuildPath = path.join(extensionRoot, "build", "content-script-handler.js");
const xhsEditorInputBuildPath = path.join(extensionRoot, "build", "xhs-editor-input.js");
const fingerprintProfileSharedPath = path.join(extensionRoot, "shared", "fingerprint-profile.js");
const expectedMainWorldBridgeMatches = [
  "https://www.xiaohongshu.com/*",
  "https://creator.xiaohongshu.com/*",
  "http://127.0.0.1/*",
  "http://localhost/*"
];
const expectedContentScriptMatches = [
  "https://www.xiaohongshu.com/*",
  "https://creator.xiaohongshu.com/*",
  "http://127.0.0.1/*",
  "http://localhost/*"
];

type BundledXhsModuleVar =
  | "__webenvoy_module_xhs_search"
  | "__webenvoy_module_xhs_detail"
  | "__webenvoy_module_xhs_user_home";

type BundledXhsExportName =
  | "executeXhsSearch"
  | "executeXhsDetail"
  | "executeXhsUserHome";

const loadBundleExports = (bundlePath: string, moduleVar: BundledXhsModuleVar) => {
  const bundleSource = fs.readFileSync(bundlePath, "utf8");
  const context: Record<string, unknown> = {};
  context.globalThis = context;
  context.structuredClone = structuredClone;
  runInNewContext(
    `${bundleSource}\n;globalThis.__bundle_test_exports = { ${moduleVar}, __webenvoy_module_xhs_search_gate };`,
    context,
    { filename: bundlePath }
  );
  return context.__bundle_test_exports as {
    [key: string]: {
      [exportName: string]: (input: Record<string, unknown>, env: Record<string, unknown>) => Promise<unknown>;
    };
  };
};

const executeBundledXhsCommand = async (
  bundlePath: string,
  input: {
    moduleVar: BundledXhsModuleVar;
    exportName: BundledXhsExportName;
    commandInput: Record<string, unknown>;
    envOverrides?: Record<string, unknown>;
  }
) => {
  const bundleExports = loadBundleExports(bundlePath, input.moduleVar);
  const executeCommand = bundleExports[input.moduleVar]?.[input.exportName];
  expect(executeCommand).toEqual(expect.any(Function));

  return executeCommand?.(
    input.commandInput,
    {
      now: () => 1_710_000_000_000,
      randomId: () => "bundle-req-001",
      getLocationHref: () => "https://www.xiaohongshu.com/search_result?keyword=%E9%9C%B2%E8%90%A5",
      getDocumentTitle: () => "Search Result",
      getReadyState: () => "complete",
      ...input.envOverrides
    }
  );
};

const buildLiveReadAdmissionContext = (input: {
  runId: string;
  sessionId: string;
  gateInvocationId: string;
  targetTabId: number;
  targetPage: "explore_detail_tab" | "profile_tab";
}) => {
  const decisionId = `gate_decision_${input.gateInvocationId}`;
  const approvalId = `gate_appr_${decisionId}`;
  return {
    approval_admission_evidence: {
      approval_admission_ref: `approval_admission_${input.gateInvocationId}`,
      decision_id: decisionId,
      approval_id: approvalId,
      run_id: input.runId,
      session_id: input.sessionId,
      issue_scope: "issue_209",
      target_domain: "www.xiaohongshu.com",
      target_tab_id: input.targetTabId,
      target_page: input.targetPage,
      action_type: "read",
      requested_execution_mode: "live_read_high_risk",
      approved: true,
      approver: "qa-reviewer",
      approved_at: "2026-03-23T10:00:00.000Z",
      checks: {
        target_domain_confirmed: true,
        target_tab_confirmed: true,
        target_page_confirmed: true,
        risk_state_checked: true,
        action_type_confirmed: true
      },
      recorded_at: "2026-03-23T10:00:00.000Z"
    },
    audit_admission_evidence: {
      audit_admission_ref: `audit_admission_${input.gateInvocationId}`,
      decision_id: decisionId,
      approval_id: approvalId,
      run_id: input.runId,
      session_id: input.sessionId,
      issue_scope: "issue_209",
      target_domain: "www.xiaohongshu.com",
      target_tab_id: input.targetTabId,
      target_page: input.targetPage,
      action_type: "read",
      requested_execution_mode: "live_read_high_risk",
      risk_state: "allowed",
      audited_checks: {
        target_domain_confirmed: true,
        target_tab_confirmed: true,
        target_page_confirmed: true,
        risk_state_checked: true,
        action_type_confirmed: true
      },
      recorded_at: "2026-03-23T10:00:30.000Z"
    }
  };
};

describe("extension build contract", () => {
  it("generates chrome-loadable background/content-script artifacts referenced by manifest", () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      background: { service_worker: string };
      permissions?: string[];
      content_scripts: Array<{
        matches?: string[];
        js: string[];
        run_at?: string;
        world?: string;
      }>;
    };
    const bridgeEntry = manifest.content_scripts.find((entry) =>
      entry.js.includes("build/main-world-bridge.js"),
    );
    const contentScriptEntry = manifest.content_scripts.find((entry) =>
      entry.js.includes("build/content-script.js"),
    );

    expect(manifest.background.service_worker).toBe("build/background.js");
    expect(bridgeEntry).toBeDefined();
    expect(bridgeEntry?.matches).toEqual(expectedMainWorldBridgeMatches);
    expect(bridgeEntry?.run_at).toBe("document_start");
    expect(bridgeEntry?.world).toBe("MAIN");
    expect(contentScriptEntry).toBeDefined();
    expect(contentScriptEntry?.matches).toEqual(expectedContentScriptMatches);
    expect(contentScriptEntry?.run_at).toBe("document_start");
    expect(manifest.permissions).toEqual(expect.arrayContaining(["debugger"]));
    expect(fs.existsSync(backgroundBuildPath)).toBe(true);
    expect(fs.existsSync(mainWorldBridgeBuildPath)).toBe(true);
    expect(fs.existsSync(contentScriptBuildPath)).toBe(true);
    expect(fs.existsSync(contentScriptHandlerBuildPath)).toBe(true);
    expect(fs.existsSync(xhsEditorInputBuildPath)).toBe(true);
    expect(fs.existsSync(fingerprintProfileSharedPath)).toBe(true);
  });

  it("keeps extension build entry imports resolvable in node module loading", async () => {
    await expect(import(backgroundBuildPath)).resolves.toBeDefined();
    await expect(import(contentScriptHandlerBuildPath)).resolves.toBeDefined();
  });

  it("emits chrome-loadable classic content-script bundle without top-level esm imports", () => {
    const contentScriptBuild = fs.readFileSync(contentScriptBuildPath, "utf8");
    const xhsEditorInputBuild = fs.readFileSync(xhsEditorInputBuildPath, "utf8");
    expect(contentScriptBuild).toContain("bootstrapContentScript");
    expect(contentScriptBuild).toContain("installMainWorldEventChannelSecret");
    expect(contentScriptBuild).toContain("installFingerprintRuntimeViaMainWorld");
    expect(contentScriptBuild).toContain("readPageStateViaMainWorld");
    expect(xhsEditorInputBuild).toContain("performEditorInputValidation");
    expect(xhsEditorInputBuild).toContain("新的创作");
    expect(xhsEditorInputBuild).toContain("enter_editable_mode");
    expect(contentScriptBuild).not.toMatch(/^\s*import\s+/m);
    expect(contentScriptBuild).toMatch(
      /const \{\s*evaluateXhsGate,\s*resolveXhsGateDecisionId,\s*XHS_READ_DOMAIN,\s*XHS_WRITE_DOMAIN,\s*buildIssue209PostGateArtifacts\s*\} = __webenvoy_module_shared_xhs_gate;/s
    );
  });

  it("executes bundled xhs.search classic module without unresolved implementation references", async () => {
    await expect(
      executeBundledXhsCommand(contentScriptBuildPath, {
        moduleVar: "__webenvoy_module_xhs_search",
        exportName: "executeXhsSearch",
        commandInput: {
          abilityId: "xhs.note.search.v1",
          abilityLayer: "L3",
          abilityAction: "read",
          params: {
            query: "露营装备"
          },
          options: {
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 8,
            target_page: "search_result_tab",
            actual_target_domain: "www.xiaohongshu.com",
            actual_target_tab_id: 8,
            actual_target_page: "search_result_tab",
            action_type: "read",
            risk_state: "limited",
            requested_execution_mode: "dry_run"
          },
          executionContext: {
            runId: "run-bundled-search-001",
            sessionId: "nm-session-bundled-search-001",
            profile: "profile-a"
          }
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      payload: {
        summary: {
          capability_result: {
            ability_id: "xhs.note.search.v1",
            outcome: "partial"
          }
        }
      }
    });
  });

  it("executes bundled xhs.detail classic module without unresolved implementation references", async () => {
    await expect(
      executeBundledXhsCommand(contentScriptBuildPath, {
        moduleVar: "__webenvoy_module_xhs_detail",
        exportName: "executeXhsDetail",
        commandInput: {
          abilityId: "xhs.note.detail.v1",
          abilityLayer: "L3",
          abilityAction: "read",
          params: {
            note_id: "note-bundled-001"
          },
          options: {
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 8,
            target_page: "explore_detail_tab",
            actual_target_domain: "www.xiaohongshu.com",
            actual_target_tab_id: 8,
            actual_target_page: "explore_detail_tab",
            action_type: "read",
            risk_state: "limited",
            requested_execution_mode: "dry_run"
          },
          executionContext: {
            runId: "run-bundled-detail-001",
            sessionId: "nm-session-bundled-detail-001",
            profile: "profile-a"
          }
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      payload: {
        summary: {
          capability_result: {
            ability_id: "xhs.note.detail.v1",
            outcome: "partial"
          }
        }
      }
    });
  });

  it("executes bundled xhs.user_home classic module without unresolved implementation references", async () => {
    await expect(
      executeBundledXhsCommand(contentScriptBuildPath, {
        moduleVar: "__webenvoy_module_xhs_user_home",
        exportName: "executeXhsUserHome",
        commandInput: {
          abilityId: "xhs.user.home.v1",
          abilityLayer: "L3",
          abilityAction: "read",
          params: {
            user_id: "user-bundled-001"
          },
          options: {
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 8,
            target_page: "profile_tab",
            actual_target_domain: "www.xiaohongshu.com",
            actual_target_tab_id: 8,
            actual_target_page: "profile_tab",
            action_type: "read",
            risk_state: "limited",
            requested_execution_mode: "dry_run"
          },
          executionContext: {
            runId: "run-bundled-user-home-001",
            sessionId: "nm-session-bundled-user-home-001",
            profile: "profile-a"
          }
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      payload: {
        summary: {
          capability_result: {
            ability_id: "xhs.user.home.v1",
            outcome: "partial"
          }
        }
      }
    });
  });

  it("executes bundled xhs.detail live-read path without missing issue209 post-gate artifacts helper", async () => {
    await expect(
      executeBundledXhsCommand(contentScriptBuildPath, {
        moduleVar: "__webenvoy_module_xhs_detail",
        exportName: "executeXhsDetail",
        commandInput: {
          abilityId: "xhs.note.detail.v1",
          abilityLayer: "L3",
          abilityAction: "read",
          params: {
            note_id: "note-live-bundled-001"
          },
          options: {
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 18,
            target_page: "explore_detail_tab",
            actual_target_domain: "www.xiaohongshu.com",
            actual_target_tab_id: 18,
            actual_target_page: "explore_detail_tab",
            action_type: "read",
            risk_state: "allowed",
            requested_execution_mode: "live_read_high_risk",
            admission_context: buildLiveReadAdmissionContext({
              runId: "run-bundled-detail-live-001",
              sessionId: "nm-session-bundled-detail-live-001",
              gateInvocationId: "issue209-gate-run-bundled-detail-live-001",
              targetTabId: 18,
              targetPage: "explore_detail_tab"
            }),
            simulate_result: "success"
          },
          executionContext: {
            runId: "run-bundled-detail-live-001",
            sessionId: "nm-session-bundled-detail-live-001",
            profile: "profile-a",
            gateInvocationId: "issue209-gate-run-bundled-detail-live-001"
          }
        },
        envOverrides: {
          getLocationHref: () => "https://www.xiaohongshu.com/explore/note-live-bundled-001",
          getDocumentTitle: () => "Detail Page"
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      payload: {
        summary: {
          capability_result: {
            ability_id: "xhs.note.detail.v1",
            outcome: "success"
          },
          consumer_gate_result: {
            requested_execution_mode: "live_read_high_risk",
            gate_decision: "allowed"
          },
          audit_record: {
            requested_execution_mode: "live_read_high_risk",
            gate_decision: "allowed"
          }
        }
      }
    });
  });

  it("executes bundled xhs.user_home live-read path without missing issue209 post-gate artifacts helper", async () => {
    await expect(
      executeBundledXhsCommand(contentScriptBuildPath, {
        moduleVar: "__webenvoy_module_xhs_user_home",
        exportName: "executeXhsUserHome",
        commandInput: {
          abilityId: "xhs.user.home.v1",
          abilityLayer: "L3",
          abilityAction: "read",
          params: {
            user_id: "user-live-bundled-001"
          },
          options: {
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 19,
            target_page: "profile_tab",
            actual_target_domain: "www.xiaohongshu.com",
            actual_target_tab_id: 19,
            actual_target_page: "profile_tab",
            action_type: "read",
            risk_state: "allowed",
            requested_execution_mode: "live_read_high_risk",
            admission_context: buildLiveReadAdmissionContext({
              runId: "run-bundled-user-home-live-001",
              sessionId: "nm-session-bundled-user-home-live-001",
              gateInvocationId: "issue209-gate-run-bundled-user-home-live-001",
              targetTabId: 19,
              targetPage: "profile_tab"
            }),
            simulate_result: "success"
          },
          executionContext: {
            runId: "run-bundled-user-home-live-001",
            sessionId: "nm-session-bundled-user-home-live-001",
            profile: "profile-a",
            gateInvocationId: "issue209-gate-run-bundled-user-home-live-001"
          }
        },
        envOverrides: {
          getLocationHref: () => "https://www.xiaohongshu.com/user/profile/user-live-bundled-001",
          getDocumentTitle: () => "User Home"
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      payload: {
        summary: {
          capability_result: {
            ability_id: "xhs.user.home.v1",
            outcome: "success"
          },
          consumer_gate_result: {
            requested_execution_mode: "live_read_high_risk",
            gate_decision: "allowed"
          },
          audit_record: {
            requested_execution_mode: "live_read_high_risk",
            gate_decision: "allowed"
          }
        }
      }
    });
  });

  it("keeps background build artifact aligned with xhs gate contract markers", () => {
    const backgroundBuild = fs.readFileSync(backgroundBuildPath, "utf8");
    expect(backgroundBuild).toContain("live_read_limited");
    expect(backgroundBuild).toContain("plugin_gate_ownership");
    expect(backgroundBuild).toContain("read_execution_policy");
    expect(backgroundBuild).toContain("risk_state_output");
    expect(backgroundBuild).toContain("conditional_actions");
    expect(backgroundBuild).toContain("risk_transition_audit");
    expect(backgroundBuild).toContain("recovery_requirements");
  });
});
