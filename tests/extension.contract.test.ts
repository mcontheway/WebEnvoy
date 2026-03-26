import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.join(import.meta.dirname, ".."));
const extensionRoot = path.join(repoRoot, "extension");
const manifestPath = path.join(extensionRoot, "manifest.json");
const backgroundBuildPath = path.join(extensionRoot, "build", "background.js");
const mainWorldBridgeBuildPath = path.join(extensionRoot, "build", "main-world-bridge.js");
const contentScriptBuildPath = path.join(extensionRoot, "build", "content-script.js");
const contentScriptHandlerBuildPath = path.join(extensionRoot, "build", "content-script-handler.js");
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

describe("extension build contract", () => {
  it("generates chrome-loadable background/content-script artifacts referenced by manifest", () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      background: { service_worker: string };
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
    expect(fs.existsSync(backgroundBuildPath)).toBe(true);
    expect(fs.existsSync(mainWorldBridgeBuildPath)).toBe(true);
    expect(fs.existsSync(contentScriptBuildPath)).toBe(true);
    expect(fs.existsSync(contentScriptHandlerBuildPath)).toBe(true);
    expect(fs.existsSync(fingerprintProfileSharedPath)).toBe(true);
  });

  it("keeps extension build entry imports resolvable in node module loading", async () => {
    await expect(import(backgroundBuildPath)).resolves.toBeDefined();
    await expect(import(contentScriptBuildPath)).resolves.toBeDefined();
    await expect(import(contentScriptHandlerBuildPath)).resolves.toBeDefined();
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
