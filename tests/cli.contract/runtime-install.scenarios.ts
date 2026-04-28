import "../cli.contract.shared.js";

const ctx = (globalThis as { __webenvoyCliContract: Record<string, any> }).__webenvoyCliContract;
const {
  describe,
  expect,
  it,
  itWithSqlite,
  runCli,
  createRuntimeCwd,
  createNativeHostManifest,
  seedInstalledPersistentExtension,
  createNativeHostCommand,
  createShellWrappedNativeHostCommand,
  expectBundledNativeHostStarts,
  expectProfileRootOnlyLauncherContract,
  expectDualEnvRootPreferredLauncherContract,
  createGitWorktreePair,
  defaultRuntimeEnv,
  repoOwnedNativeHostEntryPath,
  PROFILE_MODE_ROOT_PREFERRED,
  quoteLauncherExportValue,
  resolveCanonicalExpectedProfileDir,
  scopedXhsGateOptions,
  assertLockMissing,
  DatabaseSync,
  asRecord,
  encodeNativeBridgeEnvelope,
  readSingleNativeBridgeEnvelope,
  mockBrowserPath,
  nativeHostMockPath,
  parseSingleJsonLine,
  runGit,
  repoRoot,
  path,
  tmpdir,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  stat,
  writeFile,
  rm,
  chmod,
  symlink,
  spawn,
  spawnSync,
  tempDirs,
  resolveRuntimeStorePath
} = ctx;

describe("webenvoy cli contract / runtime install and identity", () => {
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

  it("keeps runtime.ping on stdio fallback for profile when official socket mode is not required", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const result = runCli(
      [
        "runtime.ping",
        "--profile",
        "profile_stdio_fallback",
        "--run-id",
        "run-contract-profile-stdio-001"
      ],
      runtimeCwd,
      {
        WEBENVOY_NATIVE_TRANSPORT: "native",
        WEBENVOY_NATIVE_HOST_CMD: createNativeHostCommand(nativeHostMockPath),
        WEBENVOY_NATIVE_HOST_MODE: "success"
      }
    );
    expect(result.status).toBe(0);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      run_id: "run-contract-profile-stdio-001",
      command: "runtime.ping",
      status: "success"
    });
  });

  it("keeps dry_run xhs.search on stdio fallback before official socket mode is confirmed", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const result = runCli(
      [
        "xhs.search",
        "--profile",
        "profile_stdio_fallback",
        "--run-id",
        "run-contract-xhs-stdio-001",
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
            ...scopedXhsGateOptions
          }
        })
      ],
      runtimeCwd,
      {
        WEBENVOY_NATIVE_TRANSPORT: "native",
        WEBENVOY_NATIVE_HOST_CMD: createNativeHostCommand(nativeHostMockPath),
        WEBENVOY_NATIVE_HOST_MODE: "success"
      }
    );
    expect(result.status).toBe(6);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      run_id: "run-contract-xhs-stdio-001",
      command: "xhs.search",
      status: "error",
      error: {
        code: "ERR_EXECUTION_FAILED",
        details: {
          reason: "CAPABILITY_RESULT_MISSING"
        }
      }
    });
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
        profile_scoped_manifest_path: path.join(
          profileDir,
          "NativeMessagingHosts",
          "com.webenvoy.host.json"
        ),
        profile_scoped_bridge_socket_path: path.join(profileDir, "nm.sock")
      }
    });
    const profileManifestRaw = await readFile(
      path.join(profileDir, "NativeMessagingHosts", "com.webenvoy.host.json"),
      "utf8"
    );
    expect(JSON.parse(profileManifestRaw)).toMatchObject({
      name: "com.webenvoy.host",
      path: launcherPath,
      allowed_origins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]
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

  it("rejects runtime.uninstall when profile_dir escapes controlled profile root with uninstall ability context", async () => {
    const runtimeCwd = await createRuntimeCwd();

    const uninstall = runCli(
      [
        "runtime.uninstall",
        "--run-id",
        "run-contract-uninstall-profile-dir-boundary-001",
        "--params",
        JSON.stringify({
          browser_channel: "chrome",
          native_host_name: "com.webenvoy.host",
          profile_dir: "/tmp/webenvoy-profile-outside"
        })
      ],
      runtimeCwd
    );

    expect(uninstall.status).toBe(2);
    expect(parseSingleJsonLine(uninstall.stdout)).toMatchObject({
      command: "runtime.uninstall",
      status: "error",
      error: {
        code: "ERR_CLI_INVALID_ARGS",
        details: {
          ability_id: "runtime.uninstall",
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

  it("removes profile-scoped native host manifest through runtime.uninstall profile_dir", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const profileDir = path.join(runtimeCwd, ".webenvoy", "profiles", "install-uninstall-profile");
    const install = runCli(
      [
        "runtime.install",
        "--run-id",
        "run-contract-install-profile-scoped-manifest-remove-001",
        "--params",
        JSON.stringify({
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          browser_channel: "chrome",
          native_host_name: "com.webenvoy.host",
          profile_dir: profileDir
        })
      ],
      runtimeCwd
    );
    expect(install.status).toBe(0);

    const profileManifestPath = path.join(
      profileDir,
      "NativeMessagingHosts",
      "com.webenvoy.host.json"
    );
    await expect(readFile(profileManifestPath, "utf8")).resolves.toContain(
      "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"
    );

    const uninstall = runCli(
      [
        "runtime.uninstall",
        "--run-id",
        "run-contract-uninstall-profile-scoped-manifest-remove-001",
        "--params",
        JSON.stringify({
          browser_channel: "chrome",
          native_host_name: "com.webenvoy.host",
          profile_dir: profileDir
        })
      ],
      runtimeCwd
    );
    expect(uninstall.status).toBe(0);
    expect(parseSingleJsonLine(uninstall.stdout)).toMatchObject({
      command: "runtime.uninstall",
      status: "success",
      summary: {
        profile_dir: profileDir,
        profile_scoped_manifest_path: profileManifestPath,
        removed: {
          profile_scoped_manifest: true
        },
        remove_result: {
          profile_scoped_manifest: "removed"
        },
        idempotent: false
      }
    });
    await expect(readFile(profileManifestPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });

    const uninstallAgain = runCli(
      [
        "runtime.uninstall",
        "--run-id",
        "run-contract-uninstall-profile-scoped-manifest-remove-002",
        "--params",
        JSON.stringify({
          browser_channel: "chrome",
          native_host_name: "com.webenvoy.host",
          profile_dir: profileDir
        })
      ],
      runtimeCwd
    );
    expect(uninstallAgain.status).toBe(0);
    expect(parseSingleJsonLine(uninstallAgain.stdout)).toMatchObject({
      command: "runtime.uninstall",
      status: "success",
      summary: {
        removed: {
          profile_scoped_manifest: false
        },
        remove_result: {
          profile_scoped_manifest: "already_absent"
        },
        idempotent: true
      }
    });
  });

  it("rejects runtime.install when profile scoped NativeMessagingHosts parent is a symlink", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const profileDir = path.join(runtimeCwd, ".webenvoy", "profiles", "install-profile-symlink");
    const outsideDir = path.join(runtimeCwd, ".webenvoy", "outside-native-hosts");
    await mkdir(profileDir, { recursive: true });
    await mkdir(outsideDir, { recursive: true });
    await symlink(outsideDir, path.join(profileDir, "NativeMessagingHosts"));

    const result = runCli(
      [
        "runtime.install",
        "--run-id",
        "run-contract-install-profile-scoped-manifest-symlink-001",
        "--params",
        JSON.stringify({
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          browser_channel: "chrome",
          native_host_name: "com.webenvoy.host",
          profile_dir: profileDir
        })
      ],
      runtimeCwd
    );

    expect(result.status).toBe(2);
    expect(parseSingleJsonLine(result.stdout)).toMatchObject({
      command: "runtime.install",
      status: "error",
      error: {
        code: "ERR_CLI_INVALID_ARGS",
        details: {
          reason: "INSTALL_PATH_PARENT_SYMBOLIC_LINK",
          field: "profile_dir",
          received_path: path.join(profileDir, "NativeMessagingHosts")
        }
      }
    });
  });

  it("rejects runtime.uninstall when profile scoped NativeMessagingHosts parent is a symlink", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const profileDir = path.join(runtimeCwd, ".webenvoy", "profiles", "uninstall-profile-symlink");
    const outsideDir = path.join(runtimeCwd, ".webenvoy", "outside-native-hosts-uninstall");
    await mkdir(profileDir, { recursive: true });
    await mkdir(outsideDir, { recursive: true });
    await symlink(outsideDir, path.join(profileDir, "NativeMessagingHosts"));

    const result = runCli(
      [
        "runtime.uninstall",
        "--run-id",
        "run-contract-uninstall-profile-scoped-manifest-symlink-001",
        "--params",
        JSON.stringify({
          browser_channel: "chrome",
          native_host_name: "com.webenvoy.host",
          profile_dir: profileDir
        })
      ],
      runtimeCwd
    );

    expect(result.status).toBe(2);
    expect(parseSingleJsonLine(result.stdout)).toMatchObject({
      command: "runtime.uninstall",
      status: "error",
      error: {
        code: "ERR_CLI_INVALID_ARGS",
        details: {
          reason: "INSTALL_PATH_PARENT_SYMBOLIC_LINK",
          field: "profile_dir",
          received_path: path.join(profileDir, "NativeMessagingHosts")
        }
      }
    });
  });

  it("removes auto-provisioned profile-scoped manifests when runtime.uninstall omits profile_dir", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const install = runCli(
      [
        "runtime.install",
        "--run-id",
        "run-contract-install-all-profile-scoped-manifests-001",
        "--params",
        JSON.stringify({
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          browser_channel: "chrome",
          native_host_name: "com.webenvoy.host"
        })
      ],
      runtimeCwd
    );
    expect(install.status).toBe(0);
    const launcherPath = String(
      (parseSingleJsonLine(install.stdout).summary as Record<string, unknown>).launcher_path
    );
    const profileRoot = path.join(runtimeCwd, ".webenvoy", "profiles");
    const profileOneManifest = path.join(
      profileRoot,
      "profile-one",
      "NativeMessagingHosts",
      "com.webenvoy.host.json"
    );
    const profileTwoManifest = path.join(
      profileRoot,
      "profile-two",
      "NativeMessagingHosts",
      "com.webenvoy.host.json"
    );
    for (const manifestPath of [profileOneManifest, profileTwoManifest]) {
      await mkdir(path.dirname(manifestPath), { recursive: true });
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
    }

    const result = runCli(
      [
        "runtime.uninstall",
        "--run-id",
        "run-contract-uninstall-all-profile-scoped-manifests-001",
        "--params",
        JSON.stringify({
          browser_channel: "chrome",
          native_host_name: "com.webenvoy.host"
        })
      ],
      runtimeCwd
    );

    expect(result.status).toBe(0);
    expect(parseSingleJsonLine(result.stdout)).toMatchObject({
      command: "runtime.uninstall",
      status: "success",
      summary: {
        removed: {
          profile_scoped_manifest: true,
          profile_scoped_manifest_count: 2
        },
        remove_result: {
          profile_scoped_manifest: "removed"
        },
        idempotent: false
      }
    });
    await expect(readFile(profileOneManifest, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(profileTwoManifest, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
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
    const linkedProfileManifestPath = path.join(
      linkedWorktreeCwd,
      ".webenvoy",
      "profiles",
      "cross-cwd-profile",
      "NativeMessagingHosts",
      "com.webenvoy.host.json"
    );
    await mkdir(path.dirname(linkedProfileManifestPath), { recursive: true });
    await writeFile(
      linkedProfileManifestPath,
      `${JSON.stringify(
        {
          name: "com.webenvoy.host",
          path: linkedLauncherPath,
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
          profile_scoped_manifest: true,
          profile_scoped_manifest_count: 1,
          launcher: true,
          bundle_runtime: true
        },
        remove_result: {
          manifest: "removed",
          profile_scoped_manifest: "removed",
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
    await expect(readFile(linkedProfileManifestPath, "utf8")).rejects.toMatchObject({
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

});
