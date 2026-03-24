import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.join(import.meta.dirname, ".."));
const extensionRoot = path.join(repoRoot, "extension");
const manifestPath = path.join(extensionRoot, "manifest.json");
const backgroundBuildPath = path.join(extensionRoot, "build", "background.js");
const contentScriptBuildPath = path.join(extensionRoot, "build", "content-script.js");

describe("extension build contract", () => {
  it("generates chrome-loadable background/content-script artifacts referenced by manifest", () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      background: { service_worker: string };
      content_scripts: Array<{ js: string[] }>;
    };

    expect(manifest.background.service_worker).toBe("build/background.js");
    expect(manifest.content_scripts[0]?.js?.[0]).toBe("build/content-script.js");
    expect(fs.existsSync(backgroundBuildPath)).toBe(true);
    expect(fs.existsSync(contentScriptBuildPath)).toBe(true);
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
