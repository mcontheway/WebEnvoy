import { describe, expect, it } from "vitest";
import { repoRoot, binPath, mockBrowserPath, nativeHostMockPath, repoOwnedNativeHostEntryPath, browserStateFilename, tempDirs, resolveDatabaseSync, DatabaseSync, itWithSqlite, createRuntimeCwd, createNativeHostManifest, seedInstalledPersistentExtension, defaultRuntimeEnv, runCli, expectBundledNativeHostStarts, createNativeHostCommand, createShellWrappedNativeHostCommand, PROFILE_MODE_ROOT_PREFERRED, quoteLauncherExportValue, resolveCanonicalExpectedProfileDir, expectProfileRootOnlyLauncherContract, expectDualEnvRootPreferredLauncherContract, runGit, createGitWorktreePair, runCliAsync, parseSingleJsonLine, encodeNativeBridgeEnvelope, readSingleNativeBridgeEnvelope, asRecord, resolveCliGateEnvelope, resolveWriteInteractionTier, scopedXhsGateOptions, assertLockMissing, detectSystemChromePath, wait, runHeadlessDomProbe, realBrowserContractsEnabled, BROWSER_STATE_FILENAME, BROWSER_CONTROL_FILENAME, isPidAlive, scopedReadGateOptions, path, readFile, writeFile, mkdir, mkdtemp, realpath, rm, stat, chmod, symlink, spawn, spawnSync, createServer, createRequire, tmpdir, type DatabaseSyncCtor } from "./cli.contract.shared.js";

describe("webenvoy cli contract / install and identity", () => {
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
        install_scope: "worktree_scoped_bundle",
        install_key: null,
        install_root: path.join(runtimeCwd, ".webenvoy", "native-host-install", "chrome"),
        manifest_dir: manifestDir,
        manifest_path: path.join(manifestDir, "com.webenvoy.host.json"),
        manifest_path_source: "custom",
        launcher_dir: path.join(runtimeCwd, ".webenvoy", "native-host-install", "chrome", "bin"),
        launcher_path: launcherPath,
        launcher_path_source: "custom",
        host_command: hostCommand,
        host_command_source: "explicit",
        native_bridge_launcher_contract: "profile_root_only",
        profile_root: path.join(runtimeCwd, ".webenvoy", "profiles"),
        profile_root_bridge_socket_path: path.join(runtimeCwd, ".webenvoy", "profiles", "nm.sock"),
        profile_dir: null,
        profile_scoped_bridge_socket_path: null,
        allowed_origins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"],
        persistent_extension_identity: {
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          native_host_name: "com.webenvoy.host",
          browser_channel: "chrome",
          manifest_path: path.join(manifestDir, "com.webenvoy.host.json")
        },
        existed_before: {
          manifest: false,
          launcher: false,
          bundle_runtime: false
        },
        write_result: {
          manifest: "created",
          launcher: "created",
          bundle_runtime: "unchanged"
        },
        created: {
          manifest: true,
          launcher: true,
          bundle_runtime: false
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
    await expect(
      readFile(
        path.join(runtimeCwd, ".webenvoy", "native-host-install", "chrome", "runtime", "native-messaging", "native-host-entry.js"),
        "utf8"
      )
    ).rejects.toMatchObject({
      code: "ENOENT"
    });
    const launcherMode = (await stat(launcherPath)).mode & 0o777;
    expect(launcherMode).toBe(0o755);
  });

  it("uses repo-owned controlled roots by default when runtime.install omits manifest_dir and launcher_path", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const defaultBundledEntryPath = path.join(
      runtimeCwd,
      ".webenvoy",
      "native-host-install",
      "chrome",
      "runtime",
      "native-messaging",
      "native-host-entry.js"
    );
    const defaultManifestPath = path.join(
      runtimeCwd,
      ".webenvoy",
      "native-host-install",
      "chrome",
      "manifests",
      "com.webenvoy.host.json"
    );
    const defaultLauncherPath = path.join(
      runtimeCwd,
      ".webenvoy",
      "native-host-install",
      "chrome",
      "bin",
      "com.webenvoy.host-launcher"
    );

    const install = runCli(
      [
        "runtime.install",
        "--run-id",
        "run-contract-install-default-paths-001",
        "--params",
        JSON.stringify({
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          browser_channel: "chrome"
        })
      ],
      runtimeCwd
    );

    expect(install.status).toBe(0);
    expect(parseSingleJsonLine(install.stdout)).toMatchObject({
      command: "runtime.install",
      status: "success",
      summary: {
        install_scope: "worktree_scoped_bundle",
        install_key: null,
        install_root: path.join(runtimeCwd, ".webenvoy", "native-host-install", "chrome"),
        manifest_dir: path.dirname(defaultManifestPath),
        manifest_path: defaultManifestPath,
        manifest_path_source: "browser_default",
        launcher_dir: path.dirname(defaultLauncherPath),
        launcher_path: defaultLauncherPath,
        launcher_path_source: "repo_owned_default",
        host_command_source: "repo_owned_default",
        native_bridge_launcher_contract: "profile_root_only",
        profile_root: path.join(runtimeCwd, ".webenvoy", "profiles"),
        profile_root_bridge_socket_path: path.join(runtimeCwd, ".webenvoy", "profiles", "nm.sock"),
        write_result: {
          manifest: "created",
          launcher: "created",
          bundle_runtime: "created"
        }
      }
    });

    const parsedDefaultManifest = JSON.parse(
      await readFile(defaultManifestPath, "utf8")
    ) as Record<string, unknown>;
    const resolvedBundledEntryPath = await realpath(defaultBundledEntryPath);
    expect(parsedDefaultManifest).toMatchObject({
      path: await realpath(defaultLauncherPath)
    });
    await expect(readFile(defaultLauncherPath, "utf8")).resolves.toContain(
      resolvedBundledEntryPath
    );
    await expect(readFile(defaultLauncherPath, "utf8")).resolves.toContain(
      `export WEBENVOY_NATIVE_BRIDGE_PROFILE_ROOT='${path
        .join(await realpath(runtimeCwd), ".webenvoy", "profiles")
        .replace(/'/g, `'\"'\"'`)}'`
    );
    await expect(readFile(defaultBundledEntryPath, "utf8")).resolves.toContain(
      "process.stdin.resume()"
    );
    await expect(
      readFile(path.join(runtimeCwd, ".webenvoy", "native-host-install", "chrome", "runtime", "worktree-root.js"), "utf8")
    ).resolves.toContain("resolveRuntimeProfileRoot");
    await expect(
      readFile(path.join(runtimeCwd, ".webenvoy", "native-host-install", "chrome", "runtime", "package.json"), "utf8")
    ).resolves.toBe('{\n  "type": "module"\n}\n');
    await expectBundledNativeHostStarts(defaultBundledEntryPath, {
      WEBENVOY_NATIVE_BRIDGE_PROFILE_ROOT: path.join(await realpath(runtimeCwd), ".webenvoy", "profiles")
    });
  });

  it("removes bundled runtime when runtime.uninstall uses default non-git fallback paths", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const installRoot = path.join(runtimeCwd, ".webenvoy", "native-host-install", "chrome");
    const bundledEntryPath = path.join(
      installRoot,
      "runtime",
      "native-messaging",
      "native-host-entry.js"
    );

    const install = runCli(
      [
        "runtime.install",
        "--run-id",
        "run-contract-install-default-uninstall-001",
        "--params",
        JSON.stringify({
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          browser_channel: "chrome"
        })
      ],
      runtimeCwd
    );
    expect(install.status).toBe(0);
    await expect(readFile(bundledEntryPath, "utf8")).resolves.toContain("process.stdin.resume()");

    const uninstall = runCli(
      [
        "runtime.uninstall",
        "--run-id",
        "run-contract-uninstall-default-fallback-001",
        "--params",
        JSON.stringify({
          browser_channel: "chrome",
          native_host_name: "com.webenvoy.host"
        })
      ],
      runtimeCwd
    );
    expect(uninstall.status).toBe(0);
    expect(parseSingleJsonLine(uninstall.stdout)).toMatchObject({
      command: "runtime.uninstall",
      status: "success",
      summary: {
        install_scope: "worktree_scoped_bundle",
        install_key: null,
        install_root: installRoot,
        launcher_path_source: "repo_owned_default",
        removed: {
          manifest: true,
          launcher: true,
          bundle_runtime: true
        },
        remove_result: {
          manifest: "removed",
          launcher: "removed",
          bundle_runtime: "removed"
        }
      }
    });
    await expect(readFile(bundledEntryPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
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
    const defaultBundledEntryPath = path.join(
      runtimeCwd,
      ".webenvoy",
      "native-host-install",
      "chrome",
      "runtime",
      "native-messaging",
      "native-host-entry.js"
    );
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
    const resolvedBundledEntryPath = await realpath(defaultBundledEntryPath);
    const defaultHostCommand = createNativeHostCommand(resolvedBundledEntryPath);
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
        host_command_source: "repo_owned_default",
        native_bridge_launcher_contract: "profile_root_only",
        profile_root_bridge_socket_path: path.join(runtimeCwd, ".webenvoy", "profiles", "nm.sock"),
        allowed_origins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"],
        created: {
          manifest: true,
          launcher: true
        }
      }
    });

    const launcherRaw = await readFile(launcherPath, "utf8");
    expect(launcherRaw).toContain(resolvedBundledEntryPath);
    expect(launcherRaw).toContain('exec ');
    expect(launcherRaw).toContain(' "$@"');
  });

  it("keeps official Chrome identity preflight usable for managed installs with explicit host_command", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const manifestDir = path.join(runtimeCwd, ".webenvoy", "native-host-install", "chrome", "manifests");
    const explicitHostEntryPath = path.join(runtimeCwd, "custom-native-host-entry.mjs");
    await writeFile(explicitHostEntryPath, "process.stdin.resume();\n", "utf8");

    const install = runCli(
      [
        "runtime.install",
        "--run-id",
        "run-contract-install-explicit-host-001",
        "--params",
        JSON.stringify({
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          browser_channel: "chrome",
          host_command: createNativeHostCommand(explicitHostEntryPath)
        })
      ],
      runtimeCwd,
      {
        WEBENVOY_NATIVE_HOST_MANIFEST_DIR: manifestDir
      }
    );
    expect(install.status).toBe(0);
    const installSummary = parseSingleJsonLine(install.stdout).summary as Record<string, unknown>;
    expect(installSummary).toMatchObject({
      host_command_source: "explicit",
      write_result: {
        bundle_runtime: "unchanged"
      }
    });

    await seedInstalledPersistentExtension({
      cwd: runtimeCwd,
      profile: "explicit_host_command_profile"
    });

    const status = runCli(
      [
        "runtime.status",
        "--profile",
        "explicit_host_command_profile",
        "--run-id",
        "run-contract-install-explicit-host-002",
        "--params",
        JSON.stringify({
          persistent_extension_identity: {
            extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            manifest_path: installSummary.manifest_path
          }
        })
      ],
      runtimeCwd,
      {
        WEBENVOY_BROWSER_MOCK_VERSION: "Google Chrome 146.0.7680.154",
        WEBENVOY_NATIVE_HOST_MANIFEST_DIR: manifestDir
      }
    );
    expect(status.status).toBe(0);
    expect(parseSingleJsonLine(status.stdout)).toMatchObject({
      command: "runtime.status",
      status: "success",
      summary: {
        identityBindingState: "bound",
        identityPreflight: {
          failureReason: "IDENTITY_PREFLIGHT_PASSED",
          installDiagnostics: {
            launcherExists: true,
            launcherExecutable: true,
            bundleRuntimeExists: null
          }
        }
      }
    });
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
    expect(parseSingleJsonLine(result.stdout)).toMatchObject({
      command: "runtime.install",
      status: "success",
      summary: {
        native_bridge_launcher_contract: "profile_root_only",
        profile_root_bridge_socket_path: path.join(runtimeCwd, ".webenvoy", "profiles", "nm.sock"),
        profile_dir: profileDir,
        profile_scoped_bridge_socket_path: path.join(profileDir, "nm.sock")
      }
    });
    const launcherRaw = await expectProfileRootOnlyLauncherContract({
      launcherPath,
      runtimeCwd
    });
    expect(launcherRaw).toContain('exec ');
    expect(launcherRaw).toContain(' "$@"');
  });

  it("exports both profile-root and legacy profile-dir envs for fresh explicit host launchers", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const manifestDir = path.join(runtimeCwd, ".webenvoy", "native-host-install", "chrome", "manifests");
    const launcherPath = path.join(
      runtimeCwd,
      ".webenvoy",
      "native-host-install",
      "chrome",
      "bin",
      "webenvoy-native-host-explicit-profile-dir"
    );
    const profileDir = path.join(runtimeCwd, ".webenvoy", "profiles", "xhs_explicit_legacy_probe");
    const envCapturePath = path.join(runtimeCwd, "explicit-host-env.json");
    const explicitHostEntryPath = path.join(runtimeCwd, "explicit-host-env-capture.mjs");
    await writeFile(
      explicitHostEntryPath,
      [
        'import { writeFileSync } from "node:fs";',
        "",
        `writeFileSync(${JSON.stringify(envCapturePath)}, JSON.stringify({`,
        '  profileRoot: process.env.WEBENVOY_NATIVE_BRIDGE_PROFILE_ROOT ?? null,',
        '  legacyProfileDir: process.env.WEBENVOY_NATIVE_BRIDGE_PROFILE_DIR ?? null,',
        '  profileMode: process.env.WEBENVOY_NATIVE_BRIDGE_PROFILE_MODE ?? null',
        "}) + \"\\n\", \"utf8\");"
      ].join("\n"),
      "utf8"
    );

    const result = runCli(
      [
        "runtime.install",
        "--run-id",
        "run-contract-install-explicit-host-profile-dir-001",
        "--params",
        JSON.stringify({
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          browser_channel: "chrome",
          native_host_name: "com.webenvoy.host",
          manifest_dir: manifestDir,
          launcher_path: launcherPath,
          host_command: createNativeHostCommand(explicitHostEntryPath),
          profile_dir: profileDir
        })
      ],
      runtimeCwd
    );

    expect(result.status).toBe(0);
    expect(parseSingleJsonLine(result.stdout)).toMatchObject({
      command: "runtime.install",
      status: "success",
      summary: {
        host_command_source: "explicit",
        native_bridge_launcher_contract: "dual_env_launcher_only",
        profile_root: path.join(runtimeCwd, ".webenvoy", "profiles"),
        profile_dir: profileDir,
        profile_root_bridge_socket_path: path.join(runtimeCwd, ".webenvoy", "profiles", "nm.sock"),
        profile_scoped_bridge_socket_path: path.join(profileDir, "nm.sock")
      }
    });
    const launcherRaw = await expectDualEnvRootPreferredLauncherContract({
      launcherPath,
      runtimeCwd,
      profileDir
    });

    const launch = spawnSync(launcherPath, [], {
      cwd: runtimeCwd,
      encoding: "utf8"
    });
    expect(launch.status).toBe(0);
    expect(launch.stderr).toBe("");
    expect(JSON.parse(await readFile(envCapturePath, "utf8"))).toEqual({
      profileRoot: path.join(await realpath(runtimeCwd), ".webenvoy", "profiles"),
      legacyProfileDir: path.join(
        await realpath(runtimeCwd),
        ".webenvoy",
        "profiles",
        "xhs_explicit_legacy_probe"
      ),
      profileMode: PROFILE_MODE_ROOT_PREFERRED
    });
  });

  it("preserves legacy profile-dir env when replacing a legacy explicit launcher", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const manifestDir = path.join(runtimeCwd, ".webenvoy", "native-host-install", "chrome", "manifests");
    const legacyLauncherPath = path.join(manifestDir, "com.webenvoy.host-launcher");
    const managedLauncherPath = path.join(
      runtimeCwd,
      ".webenvoy",
      "native-host-install",
      "chrome",
      "bin",
      "com.webenvoy.host-launcher"
    );
    const profileDir = path.join(runtimeCwd, ".webenvoy", "profiles", "xhs_explicit_legacy_probe");
    const envCapturePath = path.join(runtimeCwd, "explicit-host-env-upgrade.json");
    const explicitHostEntryPath = path.join(runtimeCwd, "explicit-host-env-upgrade-capture.mjs");
    await writeFile(
      explicitHostEntryPath,
      [
        'import { writeFileSync } from "node:fs";',
        "",
        `writeFileSync(${JSON.stringify(envCapturePath)}, JSON.stringify({`,
        '  profileRoot: process.env.WEBENVOY_NATIVE_BRIDGE_PROFILE_ROOT ?? null,',
        '  legacyProfileDir: process.env.WEBENVOY_NATIVE_BRIDGE_PROFILE_DIR ?? null,',
        '  profileMode: process.env.WEBENVOY_NATIVE_BRIDGE_PROFILE_MODE ?? null',
        "}) + \"\\n\", \"utf8\");"
      ].join("\n"),
      "utf8"
    );
    await mkdir(manifestDir, { recursive: true });
    await writeFile(
      legacyLauncherPath,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        `export WEBENVOY_NATIVE_BRIDGE_PROFILE_DIR='${profileDir.replace(/'/g, `'\"'\"'`)}'`,
        'exec "$@"'
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      path.join(manifestDir, "com.webenvoy.host.json"),
      `${JSON.stringify(
        {
          name: "com.webenvoy.host",
          path: legacyLauncherPath,
          type: "stdio",
          allowed_origins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const result = runCli(
      [
        "runtime.install",
        "--run-id",
        "run-contract-install-explicit-host-profile-dir-upgrade-001",
        "--params",
        JSON.stringify({
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          browser_channel: "chrome",
          native_host_name: "com.webenvoy.host",
          manifest_dir: manifestDir,
          host_command: createNativeHostCommand(explicitHostEntryPath),
          profile_dir: profileDir
        })
      ],
      runtimeCwd
    );

    expect(result.status).toBe(0);
    expect(parseSingleJsonLine(result.stdout)).toMatchObject({
      command: "runtime.install",
      status: "success",
      summary: {
        host_command_source: "explicit",
        native_bridge_launcher_contract: "dual_env_launcher_only",
        profile_root: path.join(runtimeCwd, ".webenvoy", "profiles"),
        profile_dir: profileDir,
        profile_root_bridge_socket_path: path.join(runtimeCwd, ".webenvoy", "profiles", "nm.sock"),
        profile_scoped_bridge_socket_path: path.join(profileDir, "nm.sock")
      }
    });
    await expectDualEnvRootPreferredLauncherContract({
      launcherPath: managedLauncherPath,
      runtimeCwd,
      profileDir
    });

    const launch = spawnSync(managedLauncherPath, [], {
      cwd: runtimeCwd,
      encoding: "utf8"
    });
    expect(launch.status).toBe(0);
    expect(launch.stderr).toBe("");
    expect(JSON.parse(await readFile(envCapturePath, "utf8"))).toEqual({
      profileRoot: path.join(await realpath(runtimeCwd), ".webenvoy", "profiles"),
      legacyProfileDir: path.join(
        await realpath(runtimeCwd),
        ".webenvoy",
        "profiles",
        "xhs_explicit_legacy_probe"
      ),
      profileMode: PROFILE_MODE_ROOT_PREFERRED
    });
  });

  it("keeps repo-owned explicit launchers on a conservative dual-env launcher-only summary contract", async () => {
    const runtimeCwd = await mkdtemp(path.join(tmpdir(), "wv-explicit-live-"));
    tempDirs.push(runtimeCwd);
    const manifestDir = path.join(runtimeCwd, ".webenvoy", "native-host-install", "chrome", "manifests");
    const launcherPath = path.join(
      runtimeCwd,
      ".webenvoy",
      "native-host-install",
      "chrome",
      "bin",
      "webenvoy-native-host-explicit-profile-dir-live"
    );
    const profileDir = path.join(runtimeCwd, ".webenvoy", "profiles", "p");

    const install = runCli(
      [
        "runtime.install",
        "--run-id",
        "run-contract-install-explicit-host-profile-dir-live-001",
        "--params",
        JSON.stringify({
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          browser_channel: "chrome",
          native_host_name: "com.webenvoy.host",
          manifest_dir: manifestDir,
          launcher_path: launcherPath,
          host_command: createNativeHostCommand(repoOwnedNativeHostEntryPath),
          profile_dir: profileDir
        })
      ],
      runtimeCwd
    );

    expect(install.status).toBe(0);
    await expectDualEnvRootPreferredLauncherContract({
      launcherPath,
      runtimeCwd,
      profileDir
    });
    const expectedProfileRootSummary = path.join(runtimeCwd, ".webenvoy", "profiles");
    const installBody = parseSingleJsonLine(install.stdout);
    const installSummary = asRecord(installBody.summary);
    expect(installSummary).not.toBeNull();

    expect(installBody).toMatchObject({
      command: "runtime.install",
      status: "success",
      summary: {
        host_command_source: "explicit",
        native_bridge_launcher_contract: "dual_env_launcher_only",
        profile_root: expectedProfileRootSummary,
        profile_root_bridge_socket_path: path.join(expectedProfileRootSummary, "nm.sock"),
        profile_dir: profileDir,
        profile_scoped_bridge_socket_path: path.join(profileDir, "nm.sock")
      }
    });

    const profileRootBridgeSocketPath = String(
      installSummary?.profile_root_bridge_socket_path ?? ""
    );
    expect(profileRootBridgeSocketPath).toBe(path.join(expectedProfileRootSummary, "nm.sock"));

    const child = spawn(launcherPath, [], {
      cwd: runtimeCwd,
      stdio: ["pipe", "pipe", "pipe"]
    });
    try {
      const responsePromise = readSingleNativeBridgeEnvelope(child.stdout);
      child.stdin.write(
        encodeNativeBridgeEnvelope({
          id: "open-install-summary-root-socket-001",
          method: "bridge.open",
          profile: null,
          params: {},
          timeout_ms: 100
        })
      );
      await expect(responsePromise).resolves.toMatchObject({
        status: "success",
        summary: {
          protocol: "webenvoy.native-bridge.v1",
          state: "ready"
        }
      });
      await expect(stat(profileRootBridgeSocketPath)).resolves.toMatchObject({
        size: expect.any(Number)
      });
    } finally {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        child.once("close", () => resolve());
      });
    }
  });

  it("keeps explicit shell wrappers on the dual-env root-preferred launcher contract", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const manifestDir = path.join(runtimeCwd, ".webenvoy", "native-host-install", "chrome", "manifests");
    const launcherPath = path.join(
      runtimeCwd,
      ".webenvoy",
      "native-host-install",
      "chrome",
      "bin",
      "webenvoy-native-host-explicit-shell-wrapper"
    );
    const profileDir = path.join(runtimeCwd, ".webenvoy", "profiles", "xhs_shell_wrapper_probe");
    const envCapturePath = path.join(runtimeCwd, "explicit-host-shell-wrapper-env.json");
    const explicitHostEntryPath = path.join(runtimeCwd, "explicit-host-shell-wrapper-capture.mjs");
    await writeFile(
      explicitHostEntryPath,
      [
        'import { writeFileSync } from "node:fs";',
        "",
        `writeFileSync(${JSON.stringify(envCapturePath)}, JSON.stringify({`,
        '  profileRoot: process.env.WEBENVOY_NATIVE_BRIDGE_PROFILE_ROOT ?? null,',
        '  legacyProfileDir: process.env.WEBENVOY_NATIVE_BRIDGE_PROFILE_DIR ?? null,',
        '  profileMode: process.env.WEBENVOY_NATIVE_BRIDGE_PROFILE_MODE ?? null',
        "}) + \"\\n\", \"utf8\");"
      ].join("\n"),
      "utf8"
    );

    const wrapperPath = path.join(runtimeCwd, "explicit-host-wrapper.sh");
    await writeFile(
      wrapperPath,
      [
        "#!/usr/bin/env bash",
        `# repo-owned-reference: ${repoOwnedNativeHostEntryPath}`,
        "set -euo pipefail",
        `exec "${process.execPath}" "${explicitHostEntryPath}" "$@"`
      ].join("\n"),
      "utf8"
    );
    await chmod(wrapperPath, 0o755);

    const result = runCli(
      [
        "runtime.install",
        "--run-id",
        "run-contract-install-shell-wrapper-root-preferred-001",
        "--params",
        JSON.stringify({
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          browser_channel: "chrome",
          native_host_name: "com.webenvoy.host",
          manifest_dir: manifestDir,
          launcher_path: launcherPath,
          host_command: createShellWrappedNativeHostCommand(wrapperPath),
          profile_dir: profileDir
        })
      ],
      runtimeCwd
    );

    expect(result.status).toBe(0);
    expect(parseSingleJsonLine(result.stdout)).toMatchObject({
      command: "runtime.install",
      status: "success",
      summary: {
        host_command_source: "explicit",
        native_bridge_launcher_contract: "dual_env_launcher_only",
        profile_root: path.join(runtimeCwd, ".webenvoy", "profiles"),
        profile_root_bridge_socket_path: path.join(runtimeCwd, ".webenvoy", "profiles", "nm.sock"),
        profile_dir: profileDir,
        profile_scoped_bridge_socket_path: path.join(profileDir, "nm.sock")
      }
    });
    await expectDualEnvRootPreferredLauncherContract({
      launcherPath,
      runtimeCwd,
      profileDir
    });

    const launch = spawnSync(launcherPath, [], {
      cwd: runtimeCwd,
      encoding: "utf8"
    });
    expect(launch.status).toBe(0);
    expect(launch.stderr).toBe("");
    expect(JSON.parse(await readFile(envCapturePath, "utf8"))).toEqual({
      profileRoot: path.join(await realpath(runtimeCwd), ".webenvoy", "profiles"),
      legacyProfileDir: await resolveCanonicalExpectedProfileDir(runtimeCwd, profileDir),
      profileMode: PROFILE_MODE_ROOT_PREFERRED
    });
  });

  it("keeps explicit node wrappers on the dual-env root-preferred launcher contract", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const manifestDir = path.join(runtimeCwd, ".webenvoy", "native-host-install", "chrome", "manifests");
    const launcherPath = path.join(
      runtimeCwd,
      ".webenvoy",
      "native-host-install",
      "chrome",
      "bin",
      "webenvoy-native-host-explicit-node-wrapper"
    );
    const profileDir = path.join(runtimeCwd, ".webenvoy", "profiles", "xhs_node_wrapper_probe");
    const envCapturePath = path.join(runtimeCwd, "explicit-host-node-wrapper-env.json");
    const explicitHostEntryPath = path.join(runtimeCwd, "explicit-host-node-wrapper-capture.mjs");
    await writeFile(
      explicitHostEntryPath,
      [
        'import { writeFileSync } from "node:fs";',
        "",
        `writeFileSync(${JSON.stringify(envCapturePath)}, JSON.stringify({`,
        '  profileRoot: process.env.WEBENVOY_NATIVE_BRIDGE_PROFILE_ROOT ?? null,',
        '  legacyProfileDir: process.env.WEBENVOY_NATIVE_BRIDGE_PROFILE_DIR ?? null,',
        '  profileMode: process.env.WEBENVOY_NATIVE_BRIDGE_PROFILE_MODE ?? null',
        "}) + \"\\n\", \"utf8\");"
      ].join("\n"),
      "utf8"
    );

    const wrapperPath = path.join(runtimeCwd, "explicit-host-wrapper.mjs");
    await writeFile(
      wrapperPath,
      [
        `const unusedRepoOwnedEntry = ${JSON.stringify(repoOwnedNativeHostEntryPath)};`,
        `const explicitHostEntry = ${JSON.stringify(explicitHostEntryPath)};`,
        "if (process.argv.includes('--unused')) {",
        "  console.log(unusedRepoOwnedEntry);",
        "}",
        "await import(explicitHostEntry);"
      ].join("\n"),
      "utf8"
    );

    const result = runCli(
      [
        "runtime.install",
        "--run-id",
        "run-contract-install-node-wrapper-root-preferred-001",
        "--params",
        JSON.stringify({
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          browser_channel: "chrome",
          native_host_name: "com.webenvoy.host",
          manifest_dir: manifestDir,
          launcher_path: launcherPath,
          host_command: createNativeHostCommand(wrapperPath),
          profile_dir: profileDir
        })
      ],
      runtimeCwd
    );

    expect(result.status).toBe(0);
    expect(parseSingleJsonLine(result.stdout)).toMatchObject({
      command: "runtime.install",
      status: "success",
      summary: {
        host_command_source: "explicit",
        native_bridge_launcher_contract: "dual_env_launcher_only",
        profile_root: path.join(runtimeCwd, ".webenvoy", "profiles"),
        profile_root_bridge_socket_path: path.join(runtimeCwd, ".webenvoy", "profiles", "nm.sock"),
        profile_dir: profileDir,
        profile_scoped_bridge_socket_path: path.join(profileDir, "nm.sock")
      }
    });
    await expectDualEnvRootPreferredLauncherContract({
      launcherPath,
      runtimeCwd,
      profileDir
    });

    const launch = spawnSync(launcherPath, [], {
      cwd: runtimeCwd,
      encoding: "utf8"
    });
    expect(launch.status).toBe(0);
    expect(launch.stderr).toBe("");
    expect(JSON.parse(await readFile(envCapturePath, "utf8"))).toEqual({
      profileRoot: path.join(await realpath(runtimeCwd), ".webenvoy", "profiles"),
      legacyProfileDir: await resolveCanonicalExpectedProfileDir(runtimeCwd, profileDir),
      profileMode: PROFILE_MODE_ROOT_PREFERRED
    });
  });

  it("resolves relative profile_dir against the current worktree", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const relativeProfileDir = path.join(".webenvoy", "profiles", "xhs_relative_probe");

    const result = runCli(
      [
        "runtime.install",
        "--run-id",
        "run-contract-install-profile-dir-relative-001",
        "--params",
        JSON.stringify({
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          browser_channel: "chrome",
          profile_dir: relativeProfileDir
        })
      ],
      runtimeCwd
    );

    expect(result.status).toBe(0);
    expect(parseSingleJsonLine(result.stdout)).toMatchObject({
      command: "runtime.install",
      status: "success",
      summary: {
        profile_root: path.join(runtimeCwd, ".webenvoy", "profiles"),
        profile_dir: path.join(runtimeCwd, relativeProfileDir),
        profile_scoped_bridge_socket_path: path.join(runtimeCwd, relativeProfileDir, "nm.sock")
      }
    });
  });

  it("resolves relative profile_dir against the detected worktree root from a nested cwd", async () => {
    const { repositoryCwd, sharedManifestRoot } = await createGitWorktreePair();
    const nestedCwd = path.join(repositoryCwd, "nested", "child");
    const relativeProfileDir = path.join(".webenvoy", "profiles", "xhs_nested_relative_probe");
    await mkdir(nestedCwd, { recursive: true });

    const result = runCli(
      [
        "runtime.install",
        "--run-id",
        "run-contract-install-profile-dir-relative-nested-001",
        "--params",
        JSON.stringify({
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          browser_channel: "chrome",
          profile_dir: relativeProfileDir
        })
      ],
      nestedCwd,
      {
        WEBENVOY_NATIVE_HOST_MANIFEST_DIR: sharedManifestRoot
      }
    );

    expect(result.status).toBe(0);
    expect(parseSingleJsonLine(result.stdout)).toMatchObject({
      command: "runtime.install",
      status: "success",
      summary: {
        profile_root: path.join(repositoryCwd, ".webenvoy", "profiles"),
        profile_dir: path.join(repositoryCwd, relativeProfileDir),
        profile_scoped_bridge_socket_path: path.join(repositoryCwd, relativeProfileDir, "nm.sock")
      }
    });
  });

  it("rejects runtime.install when profile_dir escapes controlled profile root", async () => {
    const runtimeCwd = await createRuntimeCwd();

    const install = runCli(
      [
        "runtime.install",
        "--run-id",
        "run-contract-install-profile-dir-boundary-001",
        "--params",
        JSON.stringify({
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          browser_channel: "chrome",
          profile_dir: "/tmp/webenvoy-profile-outside"
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
          reason: "INSTALL_PATH_OUTSIDE_ALLOWED_ROOT",
          field: "profile_dir"
        }
      }
    });
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
        install_scope: "worktree_scoped_bundle",
        install_key: null,
        install_root: path.join(runtimeCwd, ".webenvoy", "native-host-install", "chrome"),
        manifest_dir: manifestDir,
        manifest_path: path.join(manifestDir, "com.webenvoy.host.json"),
        manifest_path_source: "custom",
        launcher_dir: path.join(runtimeCwd, ".webenvoy", "native-host-install", "chrome", "bin"),
        launcher_path: launcherPath,
        launcher_path_source: "custom",
        removed: {
          manifest: true,
          launcher: true,
          bundle_runtime: false
        },
        remove_result: {
          manifest: "removed",
          launcher: "removed",
          bundle_runtime: "already_absent"
        },
        idempotent: false
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
        remove_result: {
          manifest: "already_absent",
          launcher: "already_absent"
        },
        idempotent: true,
        removed: {
          manifest: false,
          launcher: false
        }
      }
    });
  });

  it("removes legacy browser-adjacent launcher when runtime.uninstall uses default install paths", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const manifestDir = path.join(runtimeCwd, ".webenvoy", "native-host-install", "chrome", "manifests");
    const manifestPath = path.join(manifestDir, "com.webenvoy.host.json");
    const legacyLauncherPath = path.join(manifestDir, "com.webenvoy.host-launcher");
    const repoOwnedLauncherPath = path.join(
      runtimeCwd,
      ".webenvoy",
      "native-host-install",
      "chrome",
      "bin",
      "com.webenvoy.host-launcher"
    );
    await mkdir(manifestDir, { recursive: true });
    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          name: "com.webenvoy.host",
          path: legacyLauncherPath,
          type: "stdio",
          allowed_origins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    await writeFile(legacyLauncherPath, "#!/usr/bin/env bash\nexit 0\n", "utf8");

    const uninstall = runCli(
      [
        "runtime.uninstall",
        "--run-id",
        "run-contract-uninstall-legacy-001",
        "--params",
        JSON.stringify({
          browser_channel: "chrome",
          native_host_name: "com.webenvoy.host"
        })
      ],
      runtimeCwd
    );
    expect(uninstall.status).toBe(0);
    const uninstallBody = parseSingleJsonLine(uninstall.stdout);
    expect(uninstallBody).toMatchObject({
      run_id: "run-contract-uninstall-legacy-001",
      command: "runtime.uninstall",
      status: "success",
      summary: {
        operation: "uninstall",
        native_host_name: "com.webenvoy.host",
        browser_channel: "chrome",
        manifest_dir: manifestDir,
        manifest_path: manifestPath,
        manifest_path_source: "browser_default",
        launcher_path: legacyLauncherPath,
        launcher_path_source: "browser_default",
        legacy_launcher_path: null,
        removed: {
          manifest: true,
          launcher: true,
          legacy_launcher: false
        },
        remove_result: {
          manifest: "removed",
          launcher: "removed",
          legacy_launcher: "already_absent"
        },
        idempotent: false
      }
    });
    await expect(readFile(manifestPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(readFile(legacyLauncherPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(readFile(repoOwnedLauncherPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("reports overwrite diagnostics when runtime.install rewrites an existing install scene", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const manifestDir = path.join(runtimeCwd, ".webenvoy", "native-host-install", "chrome", "manifests");
    const launcherPath = path.join(runtimeCwd, ".webenvoy", "native-host-install", "chrome", "bin", "webenvoy-native-host");

    const firstInstall = runCli(
      [
        "runtime.install",
        "--run-id",
        "run-contract-install-overwrite-001",
        "--params",
        JSON.stringify({
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          browser_channel: "chrome",
          manifest_dir: manifestDir,
          launcher_path: launcherPath
        })
      ],
      runtimeCwd
    );
    expect(firstInstall.status).toBe(0);

    const secondInstall = runCli(
      [
        "runtime.install",
        "--run-id",
        "run-contract-install-overwrite-002",
        "--params",
        JSON.stringify({
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          browser_channel: "chrome",
          manifest_dir: manifestDir,
          launcher_path: launcherPath
        })
      ],
      runtimeCwd
    );
    expect(secondInstall.status).toBe(0);
    expect(parseSingleJsonLine(secondInstall.stdout)).toMatchObject({
      command: "runtime.install",
      status: "success",
      summary: {
        existed_before: {
          manifest: true,
          launcher: true
        },
        write_result: {
          manifest: "overwritten",
          launcher: "overwritten"
        }
      }
    });
  });

  it("cleans up a legacy browser-adjacent launcher when runtime.install rewrites the registration", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const manifestDir = path.join(runtimeCwd, ".webenvoy", "native-host-install", "chrome", "manifests");
    const manifestPath = path.join(manifestDir, "com.webenvoy.host.json");
    const legacyLauncherPath = path.join(manifestDir, "com.webenvoy.host-launcher");
    await mkdir(manifestDir, { recursive: true });
    await writeFile(legacyLauncherPath, "#!/usr/bin/env bash\nexit 0\n", "utf8");
    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          name: "com.webenvoy.host",
          path: legacyLauncherPath,
          type: "stdio",
          allowed_origins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const install = runCli(
      [
        "runtime.install",
        "--run-id",
        "run-contract-install-legacy-upgrade-001",
        "--params",
        JSON.stringify({
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          browser_channel: "chrome"
        })
      ],
      runtimeCwd
    );
    expect(install.status).toBe(0);
    const installSummary = parseSingleJsonLine(install.stdout).summary as Record<string, unknown>;
    expect(installSummary.launcher_path).not.toBe(legacyLauncherPath);
    await expect(readFile(legacyLauncherPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    const rewrittenManifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    expect(rewrittenManifest.path).toBe(await realpath(String(installSummary.launcher_path)));
  });

  it("keeps default native-host bundles isolated per worktree while replacing the shared registration", async () => {
    const { repositoryCwd, linkedWorktreeCwd, sharedManifestRoot } = await createGitWorktreePair();
    const installArgs = [
      "runtime.install",
      "--run-id",
      "run-contract-install-worktree-shared-001",
      "--params",
      JSON.stringify({
        extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        browser_channel: "chrome"
      })
    ];

    const firstInstall = runCli(installArgs, repositoryCwd, {
      WEBENVOY_NATIVE_HOST_MANIFEST_DIR: sharedManifestRoot
    });
    expect(firstInstall.status).toBe(0);
    const firstSummary = parseSingleJsonLine(firstInstall.stdout).summary as Record<string, unknown>;
    const firstInstallKey = String(firstSummary.install_key);
    const firstInstallRoot = String(firstSummary.install_root);
    const firstLauncherPath = String(firstSummary.launcher_path);

    const secondInstall = runCli(
      [
        "runtime.install",
        "--run-id",
        "run-contract-install-worktree-shared-002",
        "--params",
        JSON.stringify({
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          browser_channel: "chrome"
        })
      ],
      linkedWorktreeCwd,
      {
        WEBENVOY_NATIVE_HOST_MANIFEST_DIR: sharedManifestRoot
      }
    );
    expect(secondInstall.status).toBe(0);
    const secondSummary = parseSingleJsonLine(secondInstall.stdout).summary as Record<string, unknown>;
    const secondInstallKey = String(secondSummary.install_key);
    const secondLauncherPath = String(secondSummary.launcher_path);

    expect(firstSummary.install_scope).toBe("worktree_scoped_bundle");
    expect(secondSummary.install_scope).toBe("worktree_scoped_bundle");
    expect(firstInstallKey).not.toBe("null");
    expect(secondInstallKey).not.toBe("null");
    expect(secondInstallKey).not.toBe(firstInstallKey);
    expect(secondLauncherPath).not.toBe(firstLauncherPath);
    expect(firstInstallRoot).toContain(path.join(".webenvoy", "native-host-install", "worktrees", firstInstallKey));
    expect(String(secondSummary.install_root)).toContain(
      path.join(".webenvoy", "native-host-install", "worktrees", secondInstallKey)
    );

    const manifest = JSON.parse(
      await readFile(path.join(sharedManifestRoot, "com.webenvoy.host.json"), "utf8")
    ) as Record<string, unknown>;
    expect(manifest.path).toBe(await realpath(secondLauncherPath));
    await expect(
      readFile(path.join(String(secondSummary.install_root), "runtime", "worktree-root.js"), "utf8")
    ).resolves.toContain("resolveRuntimeProfileRoot");
    await expect(
      readFile(path.join(String(secondSummary.install_root), "runtime", "package.json"), "utf8")
    ).resolves.toBe('{\n  "type": "module"\n}\n');
    await expect(readFile(firstLauncherPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(
      readFile(path.join(firstInstallRoot, "runtime", "native-messaging", "native-host-entry.js"), "utf8")
    ).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("keeps default native-host bundle paths stable when runtime.install runs from a nested cwd", async () => {
    const { repositoryCwd, sharedManifestRoot } = await createGitWorktreePair();
    const nestedCwd = path.join(repositoryCwd, "nested", "child");
    await mkdir(nestedCwd, { recursive: true });
    const installArgs = [
      "runtime.install",
      "--run-id",
      "run-contract-install-nested-cwd-001",
      "--params",
      JSON.stringify({
        extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        browser_channel: "chrome"
      })
    ];

    const firstInstall = runCli(installArgs, repositoryCwd, {
      WEBENVOY_NATIVE_HOST_MANIFEST_DIR: sharedManifestRoot
    });
    expect(firstInstall.status).toBe(0);
    const firstSummary = parseSingleJsonLine(firstInstall.stdout).summary as Record<string, unknown>;

    const secondInstall = runCli(
      [
        "runtime.install",
        "--run-id",
        "run-contract-install-nested-cwd-002",
        "--params",
        JSON.stringify({
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          browser_channel: "chrome"
        })
      ],
      nestedCwd,
      {
        WEBENVOY_NATIVE_HOST_MANIFEST_DIR: sharedManifestRoot
      }
    );
    expect(secondInstall.status).toBe(0);
    expect(parseSingleJsonLine(secondInstall.stdout)).toMatchObject({
      command: "runtime.install",
      status: "success",
      summary: {
        install_scope: "worktree_scoped_bundle",
        install_key: firstSummary.install_key,
        install_root: firstSummary.install_root,
        launcher_path: firstSummary.launcher_path,
        profile_root: path.join(repositoryCwd, ".webenvoy", "profiles"),
        existed_before: {
          manifest: true,
          launcher: true,
          bundle_runtime: true
        },
        write_result: {
          manifest: "overwritten",
          launcher: "overwritten",
          bundle_runtime: "overwritten"
        }
      }
    });
  });

  it("keeps official Chrome runtime.start/status aligned after nested-cwd install", async () => {
    const { repositoryCwd, sharedManifestRoot } = await createGitWorktreePair();
    const nestedCwd = path.join(repositoryCwd, "nested", "child");
    const profile = "nested_runtime_profile";
    await mkdir(nestedCwd, { recursive: true });
    const env = {
      ...defaultRuntimeEnv(repositoryCwd),
      WEBENVOY_NATIVE_HOST_MANIFEST_DIR: sharedManifestRoot,
      WEBENVOY_BROWSER_MOCK_VERSION: "Google Chrome 146.0.7680.154"
    };

    const install = runCli(
      [
        "runtime.install",
        "--run-id",
        "run-contract-install-nested-runtime-001",
        "--params",
        JSON.stringify({
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          browser_channel: "chrome"
        })
      ],
      nestedCwd,
      env
    );
    expect(install.status).toBe(0);
    const installSummary = parseSingleJsonLine(install.stdout).summary as Record<string, unknown>;

    await seedInstalledPersistentExtension({
      cwd: repositoryCwd,
      profile
    });

    const start = runCli(
      [
        "runtime.start",
        "--profile",
        profile,
        "--run-id",
        "run-contract-install-nested-runtime-002",
        "--params",
        JSON.stringify({
          persistent_extension_identity: {
            extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            manifest_path: installSummary.manifest_path
          }
        })
      ],
      nestedCwd,
      env
    );
    expect(start.status).toBe(0);
    expect(parseSingleJsonLine(start.stdout)).toMatchObject({
      command: "runtime.start",
      status: "success",
      summary: {
        identityBindingState: "bound"
      }
    });

    await seedInstalledPersistentExtension({
      cwd: repositoryCwd,
      profile
    });
    const status = runCli(
      [
        "runtime.status",
        "--profile",
        profile,
        "--run-id",
        "run-contract-install-nested-runtime-002"
      ],
      nestedCwd,
      env
    );
    expect(status.status).toBe(0);
    expect(parseSingleJsonLine(status.stdout)).toMatchObject({
      command: "runtime.status",
      status: "success",
      summary: {
        identityBindingState: "bound",
        identityPreflight: {
          manifestPath: installSummary.manifest_path,
          manifestSource: "binding"
        }
      }
    });
  });

  it("blocks a previously bound worktree after another worktree replaces the shared native-host registration", async () => {
    const { repositoryCwd, linkedWorktreeCwd, sharedManifestRoot } = await createGitWorktreePair();
    const profile = "shared_registration_profile";
    const env = {
      ...defaultRuntimeEnv(repositoryCwd),
      WEBENVOY_NATIVE_HOST_MANIFEST_DIR: sharedManifestRoot,
      WEBENVOY_BROWSER_MOCK_VERSION: "Google Chrome 146.0.7680.154"
    };

    const firstInstall = runCli(
      [
        "runtime.install",
        "--run-id",
        "run-contract-install-shared-registration-001",
        "--params",
        JSON.stringify({
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          browser_channel: "chrome"
        })
      ],
      repositoryCwd,
      env
    );
    expect(firstInstall.status).toBe(0);
    const firstSummary = parseSingleJsonLine(firstInstall.stdout).summary as Record<string, unknown>;

    await seedInstalledPersistentExtension({
      cwd: repositoryCwd,
      profile
    });
    const firstStart = runCli(
      [
        "runtime.start",
        "--profile",
        profile,
        "--run-id",
        "run-contract-install-shared-registration-002",
        "--params",
        JSON.stringify({
          persistent_extension_identity: {
            extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            manifest_path: firstSummary.manifest_path
          }
        })
      ],
      repositoryCwd,
      env
    );
    expect(firstStart.status).toBe(0);

    const secondInstall = runCli(
      [
        "runtime.install",
        "--run-id",
        "run-contract-install-shared-registration-003",
        "--params",
        JSON.stringify({
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          browser_channel: "chrome"
        })
      ],
      linkedWorktreeCwd,
      {
        ...env,
        WEBENVOY_BROWSER_MOCK_LOG: path.join(linkedWorktreeCwd, ".browser-launch.log")
      }
    );
    expect(secondInstall.status).toBe(0);
    const secondSummary = parseSingleJsonLine(secondInstall.stdout).summary as Record<string, unknown>;

    await seedInstalledPersistentExtension({
      cwd: repositoryCwd,
      profile
    });
    const status = runCli(
      [
        "runtime.status",
        "--profile",
        profile,
        "--run-id",
        "run-contract-install-shared-registration-002"
      ],
      repositoryCwd,
      env
    );
    expect(status.status).toBe(0);
    expect(parseSingleJsonLine(status.stdout)).toMatchObject({
      command: "runtime.status",
      status: "success",
      summary: {
        identityBindingState: "mismatch",
        runtimeReadiness: "blocked",
        identityPreflight: {
          manifestPath: firstSummary.manifest_path,
          manifestSource: "binding",
          failureReason: "IDENTITY_MANIFEST_MISSING",
          installDiagnostics: {
            launcherProfileRoot: path.join(linkedWorktreeCwd, ".webenvoy", "profiles"),
            expectedProfileRoot: path.join(repositoryCwd, ".webenvoy", "profiles"),
            profileRootMatches: false
          }
        }
      }
    });
  });

  it("removes the currently registered managed launcher from another cwd when runtime.uninstall omits launcher_path", async () => {
    const { repositoryCwd, linkedWorktreeCwd, sharedManifestRoot } = await createGitWorktreePair();
    const install = runCli(
      [
        "runtime.install",
        "--run-id",
        "run-contract-install-cross-cwd-001",
        "--params",
        JSON.stringify({
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          browser_channel: "chrome"
        })
      ],
      linkedWorktreeCwd,
      {
        WEBENVOY_NATIVE_HOST_MANIFEST_DIR: sharedManifestRoot
      }
    );
    expect(install.status).toBe(0);
    const installSummary = parseSingleJsonLine(install.stdout).summary as Record<string, unknown>;
    const linkedLauncherPath = String(installSummary.launcher_path);
    const linkedInstallRoot = String(installSummary.install_root);
    const linkedInstallKey = String(installSummary.install_key);

    const uninstall = runCli(
      [
        "runtime.uninstall",
        "--run-id",
        "run-contract-uninstall-cross-cwd-001",
        "--params",
        JSON.stringify({
          browser_channel: "chrome",
          native_host_name: "com.webenvoy.host"
        })
      ],
      repositoryCwd,
      {
        WEBENVOY_NATIVE_HOST_MANIFEST_DIR: sharedManifestRoot
      }
    );
    expect(uninstall.status).toBe(0);
    expect(parseSingleJsonLine(uninstall.stdout)).toMatchObject({
      command: "runtime.uninstall",
      status: "success",
      summary: {
        install_scope: "worktree_scoped_bundle",
        install_key: linkedInstallKey,
        install_root: linkedInstallRoot,
        manifest_dir: sharedManifestRoot,
        launcher_path: linkedLauncherPath,
        launcher_path_source: "repo_owned_default",
        removed: {
          manifest: true,
          launcher: true,
          bundle_runtime: true
        },
        remove_result: {
          manifest: "removed",
          launcher: "removed",
          bundle_runtime: "removed"
        }
      }
    });
    await expect(readFile(path.join(sharedManifestRoot, "com.webenvoy.host.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(readFile(linkedLauncherPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(
      readFile(path.join(linkedInstallRoot, "runtime", "native-messaging", "native-host-entry.js"), "utf8")
    ).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("keeps a non-managed live launcher on disk when runtime.uninstall omits launcher_path", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const manifestDir = path.join(runtimeCwd, ".webenvoy", "native-host-install", "chrome", "manifests");
    const manifestPath = path.join(manifestDir, "com.webenvoy.host.json");
    const externalLauncherPath = path.join(runtimeCwd, "external-launcher.sh");
    await mkdir(manifestDir, { recursive: true });
    await writeFile(externalLauncherPath, "#!/usr/bin/env bash\nexit 0\n", "utf8");
    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          name: "com.webenvoy.host",
          description: "WebEnvoy CLI ↔ Extension bridge",
          path: externalLauncherPath,
          type: "stdio",
          allowed_origins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const uninstall = runCli(
      [
        "runtime.uninstall",
        "--run-id",
        "run-contract-uninstall-non-managed-001",
        "--params",
        JSON.stringify({
          browser_channel: "chrome",
          native_host_name: "com.webenvoy.host"
        })
      ],
      runtimeCwd
    );
    expect(uninstall.status).toBe(0);
    expect(parseSingleJsonLine(uninstall.stdout)).toMatchObject({
      command: "runtime.uninstall",
      status: "success",
      summary: {
        launcher_path: externalLauncherPath,
        launcher_path_source: "browser_default",
        removed: {
          manifest: true,
          launcher: false
        },
        remove_result: {
          manifest: "removed",
          launcher: "preserved_non_managed"
        }
      }
    });
    await expect(readFile(manifestPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(readFile(externalLauncherPath, "utf8")).resolves.toContain("exit 0");
  });

  it("keeps the previous managed bundle when a cross-worktree reinstall fails late", async () => {
    const { repositoryCwd, linkedWorktreeCwd, sharedManifestRoot } = await createGitWorktreePair();
    const firstInstall = runCli(
      [
        "runtime.install",
        "--run-id",
        "run-contract-install-failed-reinstall-001",
        "--params",
        JSON.stringify({
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          browser_channel: "chrome"
        })
      ],
      linkedWorktreeCwd,
      {
        WEBENVOY_NATIVE_HOST_MANIFEST_DIR: sharedManifestRoot
      }
    );
    expect(firstInstall.status).toBe(0);
    const firstSummary = parseSingleJsonLine(firstInstall.stdout).summary as Record<string, unknown>;
    const firstLauncherPath = String(firstSummary.launcher_path);
    const firstInstallRoot = String(firstSummary.install_root);
    const manifestPath = path.join(sharedManifestRoot, "com.webenvoy.host.json");
    await chmod(manifestPath, 0o444);

    const secondInstall = runCli(
      [
        "runtime.install",
        "--run-id",
        "run-contract-install-failed-reinstall-002",
        "--params",
        JSON.stringify({
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          browser_channel: "chrome"
        })
      ],
      repositoryCwd,
      {
        WEBENVOY_NATIVE_HOST_MANIFEST_DIR: sharedManifestRoot
      }
    );
    expect(secondInstall.status).not.toBe(0);
    await expect(readFile(firstLauncherPath, "utf8")).resolves.toContain("exec ");
    await expect(
      readFile(path.join(firstInstallRoot, "runtime", "native-messaging", "native-host-entry.js"), "utf8")
    ).resolves.toContain("process.stdin.resume()");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    expect(manifest.path).toBe(await realpath(firstLauncherPath));
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
    const safeLauncherRoot = path.join(runtimeCwd, ".webenvoy", "native-host-install", "chrome", "bin");
    const manifestRoot = await mkdtemp(path.join(tmpdir(), "webenvoy-install-manifest-root-"));
    const externalManifestDir = await mkdtemp(path.join(tmpdir(), "webenvoy-install-symlink-"));
    tempDirs.push(externalManifestDir);
    tempDirs.push(manifestRoot);
    const symlinkedManifestRoot = path.join(manifestRoot, "symlinked");
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
      runtimeCwd,
      {
        WEBENVOY_NATIVE_HOST_MANIFEST_DIR: manifestRoot
      }
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
    const manifestRoot = await mkdtemp(path.join(tmpdir(), "webenvoy-uninstall-manifest-root-"));
    const externalManifestDir = await mkdtemp(path.join(tmpdir(), "webenvoy-uninstall-symlink-"));
    const launcherRoot = path.join(runtimeCwd, ".webenvoy", "native-host-install", "chrome", "bin");
    tempDirs.push(manifestRoot, externalManifestDir);
    const symlinkedManifestRoot = path.join(manifestRoot, "symlinked");
    await mkdir(launcherRoot, { recursive: true });
    await symlink(externalManifestDir, symlinkedManifestRoot);

    const uninstall = runCli(
      [
        "runtime.uninstall",
        "--run-id",
        "run-contract-uninstall-symlink-001",
        "--params",
        JSON.stringify({
          browser_channel: "chrome",
          native_host_name: "com.webenvoy.host",
          manifest_dir: path.join(symlinkedManifestRoot, "nested"),
          launcher_path: path.join(launcherRoot, "webenvoy-native-host")
        })
      ],
      runtimeCwd,
      {
        WEBENVOY_NATIVE_HOST_MANIFEST_DIR: manifestRoot
      }
    );
    expect(uninstall.status).toBe(2);
    expect(parseSingleJsonLine(uninstall.stdout)).toMatchObject({
      command: "runtime.uninstall",
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

  it("keeps install -> start/status -> uninstall recovery machine-readable for official Chrome persistent runtime", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const profileName = "install_recovery_profile";
    const install = runCli(
      [
        "runtime.install",
        "--run-id",
        "run-contract-install-recovery-install-001",
        "--params",
        JSON.stringify({
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          browser_channel: "chrome"
        })
      ],
      runtimeCwd
    );
    expect(install.status).toBe(0);
    const installBody = parseSingleJsonLine(install.stdout);
    const installSummary = installBody.summary as {
      manifest_path: string;
    };
    await seedInstalledPersistentExtension({
      cwd: runtimeCwd,
      profile: profileName
    });

    const start = runCli(
      [
        "runtime.start",
        "--profile",
        profileName,
        "--run-id",
        "run-contract-install-recovery-start-001",
        "--params",
        JSON.stringify({
          persistent_extension_identity: {
            extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            manifest_path: installSummary.manifest_path
          }
        })
      ],
      runtimeCwd,
      {
        WEBENVOY_BROWSER_MOCK_VERSION: "Google Chrome 146.0.7680.154"
      }
    );
    expect(start.status).toBe(0);
    expect(parseSingleJsonLine(start.stdout)).toMatchObject({
      command: "runtime.start",
      status: "success",
      summary: {
        identityBindingState: "bound",
        bootstrapState: "not_started",
        runtimeReadiness: "recoverable",
        identityPreflight: {
          installDiagnostics: {
            launcherExists: true
          }
        }
      }
    });
    await seedInstalledPersistentExtension({
      cwd: runtimeCwd,
      profile: profileName
    });

    const statusBeforeUninstall = runCli(
      [
        "runtime.status",
        "--profile",
        profileName,
        "--run-id",
        "run-contract-install-recovery-start-001"
      ],
      runtimeCwd,
      {
        WEBENVOY_BROWSER_MOCK_VERSION: "Google Chrome 146.0.7680.154"
      }
    );
    expect(statusBeforeUninstall.status).toBe(0);
    expect(parseSingleJsonLine(statusBeforeUninstall.stdout)).toMatchObject({
      command: "runtime.status",
      status: "success",
      summary: {
        identityBindingState: "bound",
        identityPreflight: {
          manifestPath: installSummary.manifest_path,
          manifestSource: "binding"
        }
      }
    });

    const uninstall = runCli(
      [
        "runtime.uninstall",
        "--run-id",
        "run-contract-install-recovery-uninstall-001",
        "--params",
        JSON.stringify({
          browser_channel: "chrome"
        })
      ],
      runtimeCwd
    );
    expect(uninstall.status).toBe(0);
    await seedInstalledPersistentExtension({
      cwd: runtimeCwd,
      profile: profileName
    });

    const statusAfterUninstall = runCli(
      [
        "runtime.status",
        "--profile",
        profileName,
        "--run-id",
        "run-contract-install-recovery-start-001"
      ],
      runtimeCwd,
      {
        WEBENVOY_BROWSER_MOCK_VERSION: "Google Chrome 146.0.7680.154"
      }
    );
    expect(statusAfterUninstall.status).toBe(0);
    expect(parseSingleJsonLine(statusAfterUninstall.stdout)).toMatchObject({
      command: "runtime.status",
      status: "success",
      summary: {
        identityBindingState: "mismatch",
        runtimeReadiness: "blocked",
        identityPreflight: {
          manifestPath: installSummary.manifest_path,
          manifestSource: "binding",
          failureReason: "IDENTITY_MANIFEST_MISSING"
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

  it("blocks legacy browser-adjacent launchers during official Chrome identity preflight", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const manifestDir = await createRuntimeCwd();
    const manifestPath = path.join(manifestDir, "com.webenvoy.host.json");
    const launcherPath = path.join(manifestDir, "com.webenvoy.host-launcher");
    await writeFile(launcherPath, "#!/usr/bin/env bash\nexit 0\n", "utf8");
    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          name: "com.webenvoy.host",
          path: launcherPath,
          type: "stdio",
          allowed_origins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    await seedInstalledPersistentExtension({
      cwd: runtimeCwd,
      profile: "legacy_launcher_profile"
    });

    const result = runCli(
      [
        "runtime.start",
        "--profile",
        "legacy_launcher_profile",
        "--run-id",
        "run-contract-legacy-launcher-001",
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
    expect(parseSingleJsonLine(result.stdout)).toMatchObject({
      run_id: "run-contract-legacy-launcher-001",
      command: "runtime.start",
      status: "error",
      error: {
        code: "ERR_RUNTIME_IDENTITY_MISMATCH",
        details: {
          reason: "IDENTITY_MANIFEST_MISSING",
          legacy_launcher_detected: true,
          launcher_path: launcherPath
        }
      }
    });
  });

  it("blocks official Chrome runtime.start when managed install metadata is missing", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const installRoot = path.join(runtimeCwd, ".webenvoy", "native-host-install", "chrome");
    const manifestPath = path.join(installRoot, "manifests", "com.webenvoy.host.json");
    const launcherPath = path.join(installRoot, "bin", "com.webenvoy.host-launcher");
    const runtimeRoot = path.join(installRoot, "runtime");
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await mkdir(path.dirname(launcherPath), { recursive: true });
    await mkdir(path.join(runtimeRoot, "native-messaging"), { recursive: true });
    await writeFile(launcherPath, "#!/usr/bin/env bash\nexit 0\n", "utf8");
    await chmod(launcherPath, 0o755);
    await writeFile(path.join(runtimeRoot, "native-messaging", "native-host-entry.js"), "process.stdin.resume();\n", "utf8");
    await writeFile(path.join(runtimeRoot, "native-messaging", "host.js"), "export {};\n", "utf8");
    await writeFile(path.join(runtimeRoot, "native-messaging", "protocol.js"), "export {};\n", "utf8");
    await writeFile(path.join(runtimeRoot, "worktree-root.js"), "export {};\n", "utf8");
    await writeFile(path.join(runtimeRoot, "package.json"), '{\n  "type": "module"\n}\n', "utf8");
    await writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          name: "com.webenvoy.host",
          path: launcherPath,
          type: "stdio",
          allowed_origins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    await seedInstalledPersistentExtension({
      cwd: runtimeCwd,
      profile: "missing_install_metadata_profile"
    });

    const result = runCli(
      [
        "runtime.start",
        "--profile",
        "missing_install_metadata_profile",
        "--run-id",
        "run-contract-missing-install-metadata-001",
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
    expect(parseSingleJsonLine(result.stdout)).toMatchObject({
      run_id: "run-contract-missing-install-metadata-001",
      command: "runtime.start",
      status: "error",
      error: {
        code: "ERR_RUNTIME_IDENTITY_MISMATCH",
        details: {
          reason: "IDENTITY_MANIFEST_MISSING",
          launcher_path: launcherPath,
          launcher_profile_root: null,
          expected_profile_root: path.join(runtimeCwd, ".webenvoy", "profiles"),
          profile_root_matches: false
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
        runtimeReadiness: "blocked",
        identityPreflight: {
          installDiagnostics: {
            launcherExists: null
          }
        }
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
        runtimeReadiness: "blocked",
        identityPreflight: {
          installDiagnostics: {
            launcherExists: null
          }
        }
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

  it("blocks bare XHS managed profile runtime.start before launching a headless browser", async () => {
    const runtimeCwd = await createRuntimeCwd();

    const start = runCli(
      ["runtime.start", "--profile", "xhs_001", "--run-id", "run-contract-xhs-headless-guard-001"],
      runtimeCwd,
      {
        WEBENVOY_BROWSER_PATH: mockBrowserPath
      }
    );
    expect(start.status).toBe(5);
    expect(parseSingleJsonLine(start.stdout)).toMatchObject({
      command: "runtime.start",
      status: "error",
      error: {
        code: "ERR_PROFILE_INVALID",
        details: {
          reason: "XHS_HEADLESS_RUNTIME_BLOCKED",
          required_param: "params.headless=false"
        }
      }
    });
    await assertLockMissing(path.join(runtimeCwd, ".webenvoy", "profiles", "xhs_001"));
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
    lock.controllerPid = 999999;
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
    lock.controllerPid = 999999;
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
    lock.controllerPid = 999999;
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
    const runtimeEnv = { WEBENVOY_BROWSER_MOCK_TTL: "10" };
    const start = runCli(
      ["runtime.start", "--profile", "orphan_recover_profile", "--run-id", "run-contract-507"],
      runtimeCwd,
      runtimeEnv
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
    lock.controllerPid = 999999;
    lock.lastHeartbeatAt = new Date().toISOString();
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
    const browserStateRaw = await readFile(browserStatePath, "utf8");
    const browserState = JSON.parse(browserStateRaw) as Record<string, unknown>;
    browserState.controllerPid = 999999;
    await writeFile(browserStatePath, `${JSON.stringify(browserState, null, 2)}\n`, "utf8");

    const blockedStart = runCli(
      ["runtime.start", "--profile", "orphan_recover_profile", "--run-id", "run-contract-508"],
      runtimeCwd,
      runtimeEnv
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
      runtimeCwd,
      runtimeEnv
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
      runtimeCwd,
      runtimeEnv
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

  realBrowserContract(
    "keeps install -> start/status -> stop -> uninstall recovery machine-readable for official Chrome persistent runtime via real Chrome",
    async () => {
      const realBrowserPath = detectSystemChromePath();
      expect(realBrowserPath).not.toBeNull();

      const runtimeCwd = await createRuntimeCwd();
      const runtimeHome = await createRuntimeCwd();
      const profileName = "install_recovery_live_profile";
      const env = {
        WEBENVOY_BROWSER_PATH: String(realBrowserPath),
        WEBENVOY_NATIVE_HOST_MANIFEST_DIR: "",
        HOME: runtimeHome
      };
      const expectedManifestPath = path.join(
        runtimeHome,
        "Library",
        "Application Support",
        "Google",
        "Chrome",
        "NativeMessagingHosts",
        "com.webenvoy.host.json"
      );

      const install = runCli(
        [
          "runtime.install",
          "--run-id",
          "run-contract-install-live-install-001",
          "--params",
          JSON.stringify({
            extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            browser_channel: "chrome"
          })
        ],
        runtimeCwd,
        env
      );
      expect(install.status).toBe(0);
      const installBody = parseSingleJsonLine(install.stdout);
      const installSummary = installBody.summary as {
        manifest_path: string;
      };
      expect(installSummary.manifest_path).toBe(expectedManifestPath);

      await seedInstalledPersistentExtension({
        cwd: runtimeCwd,
        profile: profileName
      });

      const start = runCli(
        [
          "runtime.start",
          "--profile",
          profileName,
          "--run-id",
          "run-contract-install-live-start-001",
          "--params",
          JSON.stringify({
            headless: true,
            persistent_extension_identity: {
              extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              manifest_path: installSummary.manifest_path
            }
          })
        ],
        runtimeCwd,
        env
      );
      expect(start.status).toBe(0);
      expect(parseSingleJsonLine(start.stdout)).toMatchObject({
        command: "runtime.start",
        status: "success",
        summary: {
          identityBindingState: "bound"
        }
      });

      await seedInstalledPersistentExtension({
        cwd: runtimeCwd,
        profile: profileName
      });

      const statusBeforeStop = runCli(
        [
          "runtime.status",
          "--profile",
          profileName,
          "--run-id",
          "run-contract-install-live-start-001"
        ],
        runtimeCwd,
        env
      );
      expect(statusBeforeStop.status).toBe(0);
      expect(parseSingleJsonLine(statusBeforeStop.stdout)).toMatchObject({
        command: "runtime.status",
        status: "success",
        summary: {
          identityBindingState: "bound",
          identityPreflight: {
            manifestPath: installSummary.manifest_path,
            manifestSource: "binding"
          }
        }
      });

      const stop = runCli(
        [
          "runtime.stop",
          "--profile",
          profileName,
          "--run-id",
          "run-contract-install-live-start-001"
        ],
        runtimeCwd,
        env
      );
      expect(stop.status).toBe(0);

      const uninstall = runCli(
        [
          "runtime.uninstall",
          "--run-id",
          "run-contract-install-live-uninstall-001",
          "--params",
          JSON.stringify({
            browser_channel: "chrome"
          })
        ],
        runtimeCwd,
        env
      );
      expect(uninstall.status).toBe(0);

      await seedInstalledPersistentExtension({
        cwd: runtimeCwd,
        profile: profileName
      });

      const statusAfterUninstall = runCli(
        [
          "runtime.status",
          "--profile",
          profileName,
          "--run-id",
          "run-contract-install-live-start-001"
        ],
        runtimeCwd,
        env
      );
      expect(statusAfterUninstall.status).toBe(0);
      expect(parseSingleJsonLine(statusAfterUninstall.stdout)).toMatchObject({
        command: "runtime.status",
        status: "success",
        summary: {
          identityBindingState: "mismatch",
          runtimeReadiness: "blocked",
          identityPreflight: {
            manifestPath: installSummary.manifest_path,
            manifestSource: "binding",
            failureReason: "IDENTITY_MANIFEST_MISSING"
          }
        }
      });
    },
    15_000
  );

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
