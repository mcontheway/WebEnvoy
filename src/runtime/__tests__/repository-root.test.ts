import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import { resolveRepositoryProfileRoot, resolveRepositoryRoot } from "../repository-root.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("repository-root", () => {
  it("falls back to cwd when git metadata is unavailable", async () => {
    const dir = await mkdtemp(`${tmpdir()}/webenvoy-repo-root-`);
    tempDirs.push(dir);

    expect(resolveRepositoryRoot(dir)).toBe(dir);
    expect(resolveRepositoryProfileRoot(dir)).toBe(`${dir}/.webenvoy/profiles`);
  });

  it("anchors linked worktree paths to the git common-dir repository root", () => {
    const cwd = process.cwd();
    const result = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd,
      encoding: "utf8"
    });
    expect(result.status).toBe(0);
    const gitCommonDir = result.stdout.trim();
    expect(gitCommonDir.length).toBeGreaterThan(0);

    expect(resolveRepositoryRoot(cwd)).toBe(dirname(gitCommonDir));
    expect(resolveRepositoryProfileRoot(cwd)).toBe(`${dirname(gitCommonDir)}/.webenvoy/profiles`);
  });
});
