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

const executeBundledDryRunSearch = async (bundlePath: string) => {
  const bundleSource = fs.readFileSync(bundlePath, "utf8");
  const context: Record<string, unknown> = {};
  context.globalThis = context;
  runInNewContext(
    `${bundleSource}\n;globalThis.__bundle_test_exports = { __webenvoy_module_xhs_search };`,
    context,
    { filename: bundlePath }
  );
  const bundleExports = context.__bundle_test_exports as {
    __webenvoy_module_xhs_search?: {
      executeXhsSearch?: (input: Record<string, unknown>, env: Record<string, unknown>) => Promise<unknown>;
    };
  };
  const executeXhsSearch = bundleExports.__webenvoy_module_xhs_search?.executeXhsSearch;
  expect(executeXhsSearch).toEqual(expect.any(Function));

  return executeXhsSearch?.(
    {
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
    },
    {
      now: () => 1_710_000_000_000,
      randomId: () => "bundle-req-001",
      getLocationHref: () => "https://www.xiaohongshu.com/search_result?keyword=%E9%9C%B2%E8%90%A5",
      getDocumentTitle: () => "Search Result",
      getReadyState: () => "complete"
    }
  );
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
    expect(xhsEditorInputBuild).toContain("performEditorInputValidation");
    expect(xhsEditorInputBuild).toContain("新的创作");
    expect(xhsEditorInputBuild).toContain("enter_editable_mode");
    expect(contentScriptBuild).not.toMatch(/^\s*import\s+/m);
  });

  it("executes bundled xhs.search classic module without unresolved implementation references", async () => {
    await expect(executeBundledDryRunSearch(contentScriptBuildPath)).resolves.toMatchObject({
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
