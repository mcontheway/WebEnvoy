import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import {
  inspectManagedNativeHostInstall,
  resolveNativeHostInstallRoots
} from "../native-host-install-root.js";

const tempDirs: string[] = [];

const runGit = (cwd: string, args: string[]) => {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8"
  });
  expect(result.status).toBe(0);
  return result.stdout.trim();
};

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("native-host-install-root", () => {
  it("falls back to cwd when git metadata is unavailable", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "webenvoy-native-host-install-root-"));
    tempDirs.push(cwd);
    const expectedCwd = await realpath(cwd);

    const roots = resolveNativeHostInstallRoots(cwd, "chrome");
    expect(roots.installScope).toBe("worktree_scoped_bundle");
    expect(roots.installKey).toBeNull();
    expect(roots.repositoryRoot).toBe(expectedCwd);
    expect(roots.worktreePath).toBe(expectedCwd);
    expect(roots.channelRoot).toBe(join(expectedCwd, ".webenvoy", "native-host-install", "chrome"));
  });

  it("keeps linked worktree install bundles isolated under the shared repository root", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-native-host-install-worktrees-"));
    tempDirs.push(baseDir);
    const repoDir = join(baseDir, "repo");
    const linkedWorktreeDir = join(baseDir, "repo-feature");
    const linkedNestedDir = join(linkedWorktreeDir, "src", "install");
    await mkdir(repoDir, { recursive: true });

    runGit(repoDir, ["init"]);
    await writeFile(join(repoDir, "README.md"), "# temp repo\n", "utf8");
    runGit(repoDir, ["add", "README.md"]);
    runGit(repoDir, ["-c", "user.name=WebEnvoy Test", "-c", "user.email=test@example.com", "commit", "-m", "init"]);
    runGit(repoDir, ["worktree", "add", "-b", "feat/test-install-root", linkedWorktreeDir]);
    await mkdir(linkedNestedDir, { recursive: true });
    const expectedRepoDir = await realpath(repoDir);
    const expectedLinkedWorktreeDir = await realpath(linkedWorktreeDir);

    const mainRoots = resolveNativeHostInstallRoots(repoDir, "chrome");
    const linkedRoots = resolveNativeHostInstallRoots(linkedWorktreeDir, "chrome");
    const linkedNestedRoots = resolveNativeHostInstallRoots(linkedNestedDir, "chrome");

    expect(mainRoots.repositoryRoot).toBe(expectedRepoDir);
    expect(linkedRoots.repositoryRoot).toBe(expectedRepoDir);
    expect(linkedNestedRoots.repositoryRoot).toBe(expectedRepoDir);
    expect(mainRoots.installKey).not.toBeNull();
    expect(linkedRoots.installKey).not.toBeNull();
    expect(mainRoots.installKey).not.toBe(linkedRoots.installKey);
    expect(mainRoots.channelRoot).not.toBe(linkedRoots.channelRoot);
    expect(mainRoots.channelRoot).toContain(join(".webenvoy", "native-host-install", "worktrees"));
    expect(linkedRoots.channelRoot).toContain(join(".webenvoy", "native-host-install", "worktrees"));
    expect(linkedNestedRoots.worktreePath).toBe(expectedLinkedWorktreeDir);
    expect(linkedNestedRoots.installKey).toBe(linkedRoots.installKey);
    expect(linkedNestedRoots.channelRoot).toBe(linkedRoots.channelRoot);

    const linkedInstall = inspectManagedNativeHostInstall(
      join(linkedRoots.launcherRoot, "com.webenvoy.host-launcher")
    );
    expect(linkedInstall).toMatchObject({
      installScope: "worktree_scoped_bundle",
      installKey: linkedRoots.installKey,
      channelRoot: linkedRoots.channelRoot,
      launcherRoot: linkedRoots.launcherRoot,
      runtimeRoot: linkedRoots.runtimeRoot
    });
  });

  it("treats the non-git fallback layout as a managed install", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "webenvoy-native-host-install-fallback-"));
    tempDirs.push(cwd);
    const fallbackLauncherPath = join(
      cwd,
      ".webenvoy",
      "native-host-install",
      "chrome",
      "bin",
      "com.webenvoy.host-launcher"
    );

    expect(inspectManagedNativeHostInstall(fallbackLauncherPath)).toMatchObject({
      installScope: "worktree_scoped_bundle",
      installKey: null,
      channelRoot: join(cwd, ".webenvoy", "native-host-install", "chrome"),
      launcherRoot: join(cwd, ".webenvoy", "native-host-install", "chrome", "bin"),
      runtimeRoot: join(cwd, ".webenvoy", "native-host-install", "chrome", "runtime")
    });
  });
});
