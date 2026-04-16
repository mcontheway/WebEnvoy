import { describe, expect, it } from "vitest";
import { repoRoot, binPath, mockBrowserPath, nativeHostMockPath, repoOwnedNativeHostEntryPath, browserStateFilename, tempDirs, resolveDatabaseSync, DatabaseSync, itWithSqlite, createRuntimeCwd, createNativeHostManifest, seedInstalledPersistentExtension, defaultRuntimeEnv, runCli, expectBundledNativeHostStarts, createNativeHostCommand, createShellWrappedNativeHostCommand, PROFILE_MODE_ROOT_PREFERRED, quoteLauncherExportValue, resolveCanonicalExpectedProfileDir, expectProfileRootOnlyLauncherContract, expectDualEnvRootPreferredLauncherContract, runGit, createGitWorktreePair, runCliAsync, parseSingleJsonLine, encodeNativeBridgeEnvelope, readSingleNativeBridgeEnvelope, asRecord, resolveCliGateEnvelope, resolveWriteInteractionTier, scopedXhsGateOptions, assertLockMissing, detectSystemChromePath, wait, runHeadlessDomProbe, realBrowserContractsEnabled, BROWSER_STATE_FILENAME, BROWSER_CONTROL_FILENAME, isPidAlive, scopedReadGateOptions, path, readFile, writeFile, mkdir, realpath, rm, stat, chmod, symlink, spawn, spawnSync, createServer, createRequire, tmpdir, type DatabaseSyncCtor } from "./cli.contract.shared.js";

describe("webenvoy cli contract / runtime profile lifecycle and recovery", () => {
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

  it("allows runtime.stop when a stale controller pid has been reused by another process", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const start = runCli(
      ["runtime.start", "--profile", "recover_stop_stale_controller_profile", "--run-id", "run-contract-506b"],
      runtimeCwd
    );
    expect(start.status).toBe(0);
    const startBody = parseSingleJsonLine(start.stdout);
    const summary = startBody.summary as Record<string, unknown>;
    const profileDir = String(summary.profileDir);
    const lockPath = path.join(profileDir, "__webenvoy_lock.json");
    const browserStatePath = path.join(profileDir, BROWSER_STATE_FILENAME);
    const unrelatedController = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore"
    });

    try {
      const lockRaw = await readFile(lockPath, "utf8");
      const lock = JSON.parse(lockRaw) as Record<string, unknown>;
      lock.controllerPid = unrelatedController.pid;
      lock.controllerPidState = "stale";
      lock.lastHeartbeatAt = new Date().toISOString();
      await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");

      const browserStateRaw = await readFile(browserStatePath, "utf8");
      const browserState = JSON.parse(browserStateRaw) as Record<string, unknown>;
      browserState.controllerPid = unrelatedController.pid;
      await writeFile(browserStatePath, `${JSON.stringify(browserState, null, 2)}\n`, "utf8");

      const stop = runCli(
        [
          "runtime.stop",
          "--profile",
          "recover_stop_stale_controller_profile",
          "--run-id",
          "run-contract-506b"
        ],
        runtimeCwd
      );
      expect(stop.status).toBe(0);
      const stopBody = parseSingleJsonLine(stop.stdout);
      expect(stopBody).toMatchObject({
        command: "runtime.stop",
        status: "success",
        summary: {
          profile: "recover_stop_stale_controller_profile",
          profileState: "stopped",
          lockHeld: false,
          orphanRecovered: false
        }
      });

      expect(isPidAlive(unrelatedController.pid)).toBe(true);
      await assertLockMissing(profileDir);
      await expect(readFile(path.join(profileDir, BROWSER_STATE_FILENAME), "utf8")).rejects.toMatchObject({
        code: "ENOENT"
      });
      await expect(readFile(path.join(profileDir, BROWSER_CONTROL_FILENAME), "utf8")).rejects.toMatchObject({
        code: "ENOENT"
      });
    } finally {
      if (isPidAlive(unrelatedController.pid)) {
        unrelatedController.kill("SIGTERM");
      }
    }
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
