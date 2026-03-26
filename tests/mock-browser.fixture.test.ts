import { spawnSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.join(import.meta.dirname, ".."));
const mockBrowserPath = path.join(repoRoot, "tests", "fixtures", "mock-browser.sh");

describe("mock browser fixture", () => {
  it("supports --version probe with stable output", () => {
    const result = spawnSync(mockBrowserPath, ["--version"], {
      encoding: "utf8",
      env: {
        ...process.env,
        WEBENVOY_BROWSER_MOCK_VERSION: "Chromium 146.0.0.0"
      }
    });

    expect(result.status).toBe(0);
    const output = result.stdout.trim();
    expect(output.length).toBeGreaterThan(0);
    expect(output).toMatch(/\d+\.\d+\.\d+\.\d+/);
  });
});
