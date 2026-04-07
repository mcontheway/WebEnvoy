import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveControlledInstallRoots, resolveInstallPaths } from "../native-host-paths.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

const createTempCwd = async (): Promise<string> => {
  const cwd = await mkdtemp(join(tmpdir(), "webenvoy-native-host-paths-"));
  tempDirs.push(cwd);
  return cwd;
};

describe("native-host-paths", () => {
  it("keeps explicit manifest_dir on win32 without touching browser-default discovery", async () => {
    const cwd = await createTempCwd();
    const manifestDir = join(cwd, "custom-manifests");
    const resolved = resolveInstallPaths({
      command: "runtime.install",
      cwd,
      nativeHostName: "com.webenvoy.host",
      browserChannel: "chrome",
      manifestDir,
      platform: "win32"
    });

    expect(resolved.manifestDir).toBe(manifestDir);
    expect(resolved.manifestPath).toBe(join(manifestDir, "com.webenvoy.host.json"));
    expect(resolved.manifestPathSource).toBe("custom");
  });

  it("falls back to the controlled manifest root on win32 when manifest_dir is omitted", async () => {
    const cwd = await createTempCwd();
    const roots = resolveControlledInstallRoots(cwd, "chrome");

    const installResolved = resolveInstallPaths({
      command: "runtime.install",
      cwd,
      nativeHostName: "com.webenvoy.host",
      browserChannel: "chrome",
      platform: "win32"
    });
    const uninstallResolved = resolveInstallPaths({
      command: "runtime.uninstall",
      cwd,
      nativeHostName: "com.webenvoy.host",
      browserChannel: "chrome",
      platform: "win32"
    });

    expect(installResolved.manifestRoot).toBe(roots.manifestRoot);
    expect(installResolved.manifestDir).toBe(roots.manifestRoot);
    expect(installResolved.manifestPathSource).toBe("repo_owned_default");
    expect(uninstallResolved.manifestRoot).toBe(roots.manifestRoot);
    expect(uninstallResolved.manifestDir).toBe(roots.manifestRoot);
    expect(uninstallResolved.manifestPathSource).toBe("repo_owned_default");
  });
});
