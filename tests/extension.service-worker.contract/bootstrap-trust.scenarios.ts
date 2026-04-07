import "../extension.service-worker.contract.shared.js";

const ctx = (globalThis as { __webenvoyExtensionServiceWorkerContract: Record<string, any> }).__webenvoyExtensionServiceWorkerContract;
const {
  describe,
  expect,
  it,
  vi,
  startChromeBackgroundBridge,
  createMockPort,
  createChromeApi,
  respondHandshake,
  waitForBridgeTurn,
  waitForPostedMessage,
  primeTrustedFingerprintContext,
  promoteBootstrapReadinessThroughPing,
  createXhsCommandParams,
  createXhsEditorInputCommandParams,
  createFingerprintRuntimeContext,
  asRecord
} = ctx;

describe("extension service worker recovery contract / bootstrap and trust", () => {
  it("rejects mismatched protocol on bridge.open and does not enter ready", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);

    startChromeBackgroundBridge(chromeApi);

    respondHandshake(firstPort, {
      protocol: "webenvoy.native-bridge.v0"
    });
    await waitForBridgeTurn();
    await waitForBridgeTurn();

    firstPort.onMessageListeners[0]?.({
      id: "run-after-bad-open-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-after-bad-open-001",
        command: "runtime.ping",
        command_params: {},
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await waitForBridgeTurn();
    await waitForBridgeTurn();

    const retryHandshakeCall = firstPort.postMessage.mock.calls.findLast(
      (call) => (call[0] as { method?: string }).method === "bridge.open"
    );
    expect(retryHandshakeCall).toBeDefined();
    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it("forwards only after open handshake", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);

    startChromeBackgroundBridge(chromeApi);

    firstPort.onMessageListeners[0]?.({
      id: "run-before-open-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-before-open-001",
        command: "runtime.ping",
        command_params: {},
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await waitForBridgeTurn();
    await waitForBridgeTurn();

    expect(firstPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "run-before-open-001",
        status: "error",
        error: expect.objectContaining({
          code: "ERR_TRANSPORT_NOT_READY"
        })
      })
    );
    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();

    respondHandshake(firstPort);
    await waitForBridgeTurn();
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-after-open-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-after-open-001",
        command: "runtime.ping",
        command_params: {},
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(
      11,
      expect.objectContaining({
        id: "run-after-open-001"
      })
    );
  });

  it("injects the classic content-script bundle and retries when target tab has no receiver", async () => {
    const firstPort = createMockPort();
    const { chromeApi, executeScript } = createChromeApi([firstPort]);
    chromeApi.tabs.sendMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error("Could not establish connection. Receiving end does not exist."))
      .mockResolvedValueOnce(undefined);

    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-retry-inject-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-retry-inject-001",
        command: "runtime.ping",
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });

    await waitForBridgeTurn();

    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 11 },
      world: "ISOLATED",
      files: ["build/content-script.js"]
    });
    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledTimes(2);
    await waitForPostedMessage(firstPort.postMessage, {
      id: "run-retry-inject-001",
      status: "error",
      error: expect.objectContaining({
        code: "ERR_TRANSPORT_TIMEOUT"
      })
    });
  });

  it("keeps runtime.readiness pending until bootstrap receives execution-surface trust", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners, executeScript } = createChromeApi([firstPort]);
    const fingerprintContext = createFingerprintRuntimeContext();

    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-bootstrap-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-001",
        command: "runtime.bootstrap",
        command_params: {
          version: "v1",
          run_id: "run-bootstrap-001",
          runtime_context_id: "ctx-bootstrap-001",
          profile: "profile-a",
          fingerprint_runtime: fingerprintContext,
          fingerprint_patch_manifest: {
            required_patches: ["audio_context"]
          },
          main_world_secret: "secret-bootstrap-001"
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();

    await waitForPostedMessage(firstPort.postMessage, {
      id: "run-bootstrap-001",
      status: "error",
      error: expect.objectContaining({
        code: "ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED"
      })
    });

    firstPort.onMessageListeners[0]?.({
      id: "run-ping-promote-bootstrap-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-001",
        command: "runtime.ping",
        command_params: {
          fingerprint_context: fingerprintContext
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-readiness-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-001",
        command: "runtime.readiness",
        command_params: {
          runtime_context_id: "ctx-bootstrap-001"
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();

    expect(firstPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "run-readiness-001",
        status: "success",
        payload: expect.objectContaining({
          bootstrap_state: "pending",
          run_id: "run-bootstrap-001",
          runtime_context_id: "ctx-bootstrap-001",
          transport_state: "ready"
        })
      })
    );
    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(
      11,
      expect.objectContaining({
        id: "run-bootstrap-001",
        command: "runtime.bootstrap"
      })
    );
    expect(executeScript).not.toHaveBeenCalled();

    await promoteBootstrapReadinessThroughPing({
      runtimeMessageListeners,
      pingId: "run-ping-promote-bootstrap-001",
      fingerprintContext,
      tabId: 11,
      tabUrl: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article"
    });

    firstPort.onMessageListeners[0]?.({
      id: "run-readiness-002",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-001",
        command: "runtime.readiness",
        command_params: {
          runtime_context_id: "ctx-bootstrap-001"
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();

    expect(firstPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "run-readiness-002",
        status: "success",
        payload: expect.objectContaining({
          bootstrap_state: "ready",
          run_id: "run-bootstrap-001",
          runtime_context_id: "ctx-bootstrap-001",
          transport_state: "ready"
        })
      })
    );
  });

  it("pins runtime.bootstrap to creator publish tab instead of a generic active xhs tab", async () => {
    const firstPort = createMockPort();
    const { chromeApi, executeScript } = createChromeApi([firstPort]);
    chromeApi.tabs.query = vi.fn(async () => [
      { id: 31, active: true, url: "https://www.xiaohongshu.com/explore/abc" },
      { id: 52, active: false, url: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=image" }
    ]);
    const fingerprintContext = createFingerprintRuntimeContext();

    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-bootstrap-tab-pick-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-tab-pick-001",
        command: "runtime.bootstrap",
        command_params: {
          version: "v1",
          run_id: "run-bootstrap-tab-pick-001",
          runtime_context_id: "ctx-bootstrap-tab-pick-001",
          profile: "profile-a",
          fingerprint_runtime: fingerprintContext,
          fingerprint_patch_manifest: {
            required_patches: ["audio_context"]
          },
          main_world_secret: "secret-bootstrap-tab-pick-001"
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });

    await waitForBridgeTurn();

    expect(executeScript).not.toHaveBeenCalled();
    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(
      52,
      expect.objectContaining({
        id: "run-bootstrap-tab-pick-001",
        command: "runtime.bootstrap"
      })
    );
  });

  it("does not rely on a background main-world control channel before runtime.bootstrap forward", async () => {
    const firstPort = createMockPort();
    const { chromeApi, executeScript } = createChromeApi([firstPort]);
    const fingerprintContext = createFingerprintRuntimeContext();

    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-bootstrap-main-world-recover-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-main-world-recover-001",
        command: "runtime.bootstrap",
        command_params: {
          version: "v1",
          run_id: "run-bootstrap-main-world-recover-001",
          runtime_context_id: "ctx-bootstrap-main-world-recover-001",
          profile: "profile-a",
          fingerprint_runtime: fingerprintContext,
          fingerprint_patch_manifest: {
            required_patches: ["audio_context"]
          },
          main_world_secret: "secret-bootstrap-main-world-recover-001"
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });

    await waitForBridgeTurn();

    expect(executeScript).not.toHaveBeenCalled();
    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(
      11,
      expect.objectContaining({
        id: "run-bootstrap-main-world-recover-001",
        command: "runtime.bootstrap"
      })
    );
  });

  it("keeps runtime.bootstrap pending when startup trust lacks main-world attestation", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    const fingerprintContext = createFingerprintRuntimeContext();

    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-bootstrap-startup-trust-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-startup-trust-001",
        command: "runtime.bootstrap",
        command_params: {
          version: "v1",
          run_id: "run-bootstrap-startup-trust-001",
          runtime_context_id: "ctx-bootstrap-startup-trust-001",
          profile: "profile-a",
          fingerprint_runtime: fingerprintContext,
          fingerprint_patch_manifest: {
            required_patches: ["audio_context"]
          },
          main_world_secret: "secret-bootstrap-startup-trust-001"
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();

    await waitForPostedMessage(firstPort.postMessage, {
      id: "run-bootstrap-startup-trust-001",
      status: "error",
      error: expect.objectContaining({
        code: "ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED"
      })
    });

    runtimeMessageListeners[0]?.(
      {
        kind: "result",
        id: "startup-fingerprint-trust:run-bootstrap-startup-trust-001",
        ok: true,
        payload: {
          startup_fingerprint_trust: {
            run_id: "run-bootstrap-startup-trust-001",
            runtime_context_id: "ctx-bootstrap-startup-trust-001",
            profile: "profile-a",
            session_id: "nm-session-001",
            fingerprint_runtime: fingerprintContext,
            trust_source: "extension_bootstrap_context",
            bootstrap_attested: true,
            main_world_result_used_for_trust: false
          }
        }
      },
      {
        tab: {
          id: 11,
          url: "https://www.xiaohongshu.com/search_result?keyword=露营"
        }
      }
    );
    await Promise.resolve();
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-readiness-startup-trust-002",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-startup-trust-001",
        command: "runtime.readiness",
        command_params: {
          runtime_context_id: "ctx-bootstrap-startup-trust-001"
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();

    expect(firstPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "run-readiness-startup-trust-002",
        status: "success",
        payload: expect.objectContaining({
          bootstrap_state: "pending"
        })
      })
    );
  });

  it("converges runtime bootstrap state to ready after trusted bootstrap hit", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    const fingerprintContext = createFingerprintRuntimeContext();

    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-bootstrap-trusted-ready-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-trusted-ready-001",
        command: "runtime.bootstrap",
        command_params: {
          version: "v1",
          run_id: "run-bootstrap-trusted-ready-001",
          runtime_context_id: "ctx-bootstrap-trusted-ready-001",
          profile: "profile-a",
          fingerprint_runtime: fingerprintContext,
          fingerprint_patch_manifest: {
            required_patches: ["audio_context"]
          },
          main_world_secret: "secret-bootstrap-trusted-ready-001"
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();

    await waitForPostedMessage(firstPort.postMessage, {
      id: "run-bootstrap-trusted-ready-001",
      status: "error",
      error: expect.objectContaining({
        code: "ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED"
      })
    });

    await primeTrustedFingerprintContext({
      runtimeMessageListeners,
      runId: "run-bootstrap-trusted-ready-001",
      runtimeContextId: "ctx-bootstrap-trusted-ready-001",
      profile: "profile-a",
      sessionId: "nm-session-001",
      fingerprintContext,
      tabUrl: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article"
    });

    firstPort.onMessageListeners[0]?.({
      id: "run-bootstrap-trusted-ready-002",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-trusted-ready-001",
        command: "runtime.bootstrap",
        command_params: {
          version: "v1",
          run_id: "run-bootstrap-trusted-ready-001",
          runtime_context_id: "ctx-bootstrap-trusted-ready-001",
          profile: "profile-a",
          fingerprint_runtime: fingerprintContext,
          fingerprint_patch_manifest: {
            required_patches: ["audio_context"]
          },
          main_world_secret: "secret-bootstrap-trusted-ready-001"
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();

    await waitForPostedMessage(firstPort.postMessage, {
      id: "run-bootstrap-trusted-ready-002",
      status: "success",
      payload: expect.objectContaining({
        method: "runtime.bootstrap.ack",
        result: expect.objectContaining({
          status: "ready"
        })
      })
    });

    firstPort.onMessageListeners[0]?.({
      id: "run-trusted-probe-after-bootstrap-ready-003",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-trusted-ready-001",
        command: "runtime.trusted_fingerprint_probe",
        command_params: {},
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();

    await waitForPostedMessage(firstPort.postMessage, {
      id: "run-trusted-probe-after-bootstrap-ready-003",
      status: "success",
      payload: expect.objectContaining({
        trusted_context_present: true,
        trusted_context: expect.objectContaining({
          run_id: "run-bootstrap-trusted-ready-001",
          runtime_context_id: "ctx-bootstrap-trusted-ready-001",
          source_domain: "creator.xiaohongshu.com"
        })
      })
    });

    firstPort.onMessageListeners[0]?.({
      id: "run-readiness-trusted-ready-003",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-trusted-ready-001",
        command: "runtime.readiness",
        command_params: {
          runtime_context_id: "ctx-bootstrap-trusted-ready-001"
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();

    await waitForPostedMessage(firstPort.postMessage, {
      id: "run-readiness-trusted-ready-003",
      status: "success",
      payload: expect.objectContaining({
        bootstrap_state: "ready",
        run_id: "run-bootstrap-trusted-ready-001",
        runtime_context_id: "ctx-bootstrap-trusted-ready-001"
      })
    });
  });

  it("allows runtime.readiness promotion without xhs-specific target binding", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    const fingerprintContext = createFingerprintRuntimeContext();

    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-bootstrap-generic-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-generic-001",
        command: "runtime.bootstrap",
        command_params: {
          version: "v1",
          run_id: "run-bootstrap-generic-001",
          runtime_context_id: "ctx-bootstrap-generic-001",
          profile: "profile-a",
          fingerprint_runtime: fingerprintContext,
          fingerprint_patch_manifest: {
            required_patches: ["audio_context"]
          },
          main_world_secret: "secret-bootstrap-generic-001"
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();

    await waitForPostedMessage(firstPort.postMessage, {
      id: "run-bootstrap-generic-001",
      status: "error",
      error: expect.objectContaining({
        code: "ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED"
      })
    });

    firstPort.onMessageListeners[0]?.({
      id: "run-ping-generic-promote-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-generic-001",
        command: "runtime.ping",
        command_params: {
          fingerprint_context: fingerprintContext
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();
    await Promise.resolve();

    await promoteBootstrapReadinessThroughPing({
      runtimeMessageListeners,
      pingId: "run-ping-generic-promote-001",
      fingerprintContext,
      tabId: 77,
      tabUrl: "https://example.com/runtime-readiness"
    });

    firstPort.onMessageListeners[0]?.({
      id: "run-readiness-generic-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-generic-001",
        command: "runtime.readiness",
        command_params: {
          runtime_context_id: "ctx-bootstrap-generic-001"
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();

    expect(firstPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "run-readiness-generic-001",
        status: "success",
        payload: expect.objectContaining({
          bootstrap_state: "ready",
          run_id: "run-bootstrap-generic-001",
          runtime_context_id: "ctx-bootstrap-generic-001",
          transport_state: "ready"
        })
      })
    );

  });

  it("keeps issue_208 xhs.search blocked after bootstrap trust when editor attestation is still missing", async () => {
    const firstPort = createMockPort();
    const { chromeApi, executeScript, runtimeMessageListeners } = createChromeApi([firstPort]);
    const fingerprintContext = createFingerprintRuntimeContext({
      live_allowed: true,
      live_decision: "allowed",
      allowed_execution_modes: [
        "dry_run",
        "recon",
        "live_read_limited",
        "live_read_high_risk",
        "live_write"
      ]
    });
    chromeApi.tabs.query.mockImplementation(async () => [
      {
        id: 32,
        url: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article",
        active: true
      }
    ]);
    executeScript.mockImplementation(async (input: Record<string, unknown>) => {
      const args = Array.isArray(input.args) ? input.args : [];
      if (Array.isArray(args[0]) && Array.isArray(args[1])) {
        return [{ result: createEditorInputProbeResult() }];
      }
      return [{ result: undefined }];
    });

    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-bootstrap-direct-attest-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-direct-attest-001",
        command: "runtime.bootstrap",
        command_params: {
          version: "v1",
          run_id: "run-bootstrap-direct-attest-001",
          runtime_context_id: "ctx-bootstrap-direct-attest-001",
          profile: "profile-a",
          fingerprint_runtime: fingerprintContext,
          fingerprint_patch_manifest: {
            required_patches: [
              "audio_context",
              "battery",
              "navigator_plugins",
              "navigator_mime_types"
            ]
          },
          main_world_secret: "secret-bootstrap-direct-attest-001"
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });

    await waitForBridgeTurn();
    await primeTrustedFingerprintContext({
      runtimeMessageListeners,
      runId: "run-bootstrap-direct-attest-001",
      runtimeContextId: "ctx-bootstrap-direct-attest-001",
      profile: "profile-a",
      fingerprintContext,
      tabId: 32,
      tabUrl: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article"
    });

    if (firstPort.onMessageListeners.length === 0) {
      throw new Error("missing native onMessage listener");
    }

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-editor-after-bootstrap-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-direct-attest-001",
        command: "xhs.search",
        command_params: createXhsEditorInputCommandParams(),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    const forwardedCommands = chromeApi.tabs.sendMessage.mock.calls.map(
      (call) => (call[1] as { command?: string }).command
    );
    expect(forwardedCommands).toEqual(expect.arrayContaining(["runtime.bootstrap"]));
    expect(forwardedCommands).not.toEqual(expect.arrayContaining(["xhs.search"]));
  });

  it("promotes pending bootstrap to ready through runtime.ping then runtime.readiness", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    const fingerprintContext = createFingerprintRuntimeContext();

    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-bootstrap-ping-promote-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-ping-promote-001",
        command: "runtime.bootstrap",
        command_params: {
          version: "v1",
          run_id: "run-bootstrap-ping-promote-001",
          runtime_context_id: "ctx-bootstrap-ping-promote-001",
          profile: "profile-a",
          fingerprint_runtime: fingerprintContext,
          fingerprint_patch_manifest: {
            required_patches: ["audio_context"]
          },
          main_world_secret: "secret-bootstrap-ping-promote-001"
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();

    await waitForPostedMessage(firstPort.postMessage, {
      id: "run-bootstrap-ping-promote-001",
      status: "error",
      error: expect.objectContaining({
        code: "ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED"
      })
    });

    firstPort.onMessageListeners[0]?.({
      id: "run-ping-promote-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-ping-promote-001",
        command: "runtime.ping",
        command_params: {
          fingerprint_context: fingerprintContext
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();
    await Promise.resolve();

    runtimeMessageListeners[0]?.(
      {
        kind: "result",
        id: "run-ping-promote-001",
        ok: true,
        payload: {
          fingerprint_runtime: {
            ...fingerprintContext,
            injection: {
              installed: true,
              required_patches: ["audio_context"],
              missing_required_patches: []
            }
          },
          target_tab_id: 77,
          summary: {
            capability_result: {
              outcome: "success"
            }
          }
        }
      },
      {
        tab: {
          id: 77
        }
      }
    );
    await Promise.resolve();
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-readiness-ping-promote-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-ping-promote-001",
        command: "runtime.readiness",
        command_params: {
          runtime_context_id: "ctx-bootstrap-ping-promote-001"
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();

    expect(firstPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "run-readiness-ping-promote-001",
        status: "success",
        payload: expect.objectContaining({
          bootstrap_state: "ready",
          run_id: "run-bootstrap-ping-promote-001",
          runtime_context_id: "ctx-bootstrap-ping-promote-001",
          transport_state: "ready"
        })
      })
    );
  });

  it("keeps bootstrap pending when runtime.ping attestation reports main-world injection unavailable", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    const fingerprintContext = createFingerprintRuntimeContext();

    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-bootstrap-main-world-fail-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-main-world-fail-001",
        command: "runtime.bootstrap",
        command_params: {
          version: "v1",
          run_id: "run-bootstrap-main-world-fail-001",
          runtime_context_id: "ctx-bootstrap-main-world-fail-001",
          profile: "profile-a",
          fingerprint_runtime: fingerprintContext,
          fingerprint_patch_manifest: {
            required_patches: ["audio_context"]
          },
          main_world_secret: "secret-bootstrap-main-world-fail-001"
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();

    await waitForPostedMessage(firstPort.postMessage, {
      id: "run-bootstrap-main-world-fail-001",
      status: "error",
      error: expect.objectContaining({
        code: "ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED"
      })
    });

    firstPort.onMessageListeners[0]?.({
      id: "run-ping-main-world-fail-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-main-world-fail-001",
        command: "runtime.ping",
        command_params: {
          fingerprint_context: fingerprintContext
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();
    await Promise.resolve();

    runtimeMessageListeners[0]?.(
      {
        kind: "result",
        id: "run-ping-main-world-fail-001",
        ok: true,
        payload: {
          fingerprint_runtime: {
            ...fingerprintContext,
            injection: {
              installed: false,
              required_patches: ["audio_context"],
              missing_required_patches: ["audio_context"],
              error: "main world event channel unavailable"
            }
          }
        }
      },
      {
        tab: {
          id: 77
        }
      }
    );
    await Promise.resolve();
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-readiness-main-world-fail-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-main-world-fail-001",
        command: "runtime.readiness",
        command_params: {
          runtime_context_id: "ctx-bootstrap-main-world-fail-001"
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();

    expect(firstPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "run-readiness-main-world-fail-001",
        status: "success",
        payload: expect.objectContaining({
          bootstrap_state: "pending",
          run_id: "run-bootstrap-main-world-fail-001",
          runtime_context_id: "ctx-bootstrap-main-world-fail-001",
          transport_state: "ready"
        })
      })
    );
  });

  it("keeps bootstrap pending when runtime.ping attestation reports missing required patches", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    const fingerprintContext = createFingerprintRuntimeContext();

    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-bootstrap-missing-patch-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-missing-patch-001",
        command: "runtime.bootstrap",
        command_params: {
          version: "v1",
          run_id: "run-bootstrap-missing-patch-001",
          runtime_context_id: "ctx-bootstrap-missing-patch-001",
          profile: "profile-a",
          fingerprint_runtime: fingerprintContext,
          fingerprint_patch_manifest: {
            required_patches: ["audio_context"]
          },
          main_world_secret: "secret-bootstrap-missing-patch-001"
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();

    await waitForPostedMessage(firstPort.postMessage, {
      id: "run-bootstrap-missing-patch-001",
      status: "error",
      error: expect.objectContaining({
        code: "ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED"
      })
    });

    firstPort.onMessageListeners[0]?.({
      id: "run-ping-missing-patch-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-missing-patch-001",
        command: "runtime.ping",
        command_params: {
          fingerprint_context: fingerprintContext
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();
    await Promise.resolve();

    runtimeMessageListeners[0]?.(
      {
        kind: "result",
        id: "run-ping-missing-patch-001",
        ok: true,
        payload: {
          fingerprint_runtime: {
            ...fingerprintContext,
            injection: {
              installed: false,
              required_patches: ["audio_context", "battery"],
              missing_required_patches: ["battery"],
              error: "fingerprint required patches missing for live execution"
            }
          }
        }
      },
      {
        tab: {
          id: 77
        }
      }
    );
    await Promise.resolve();
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-readiness-missing-patch-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-missing-patch-001",
        command: "runtime.readiness",
        command_params: {
          runtime_context_id: "ctx-bootstrap-missing-patch-001"
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();

    expect(firstPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "run-readiness-missing-patch-001",
        status: "success",
        payload: expect.objectContaining({
          bootstrap_state: "pending",
          run_id: "run-bootstrap-missing-patch-001",
          runtime_context_id: "ctx-bootstrap-missing-patch-001",
          transport_state: "ready"
        })
      })
    );
  });

  it("does not reuse trusted fingerprint context from a previous run for new runtime.bootstrap context", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    const fingerprintContext = createFingerprintRuntimeContext();

    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-bootstrap-old-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-old-001",
        command: "runtime.bootstrap",
        command_params: {
          version: "v1",
          run_id: "run-bootstrap-old-001",
          runtime_context_id: "ctx-bootstrap-old-001",
          profile: "profile-a",
          fingerprint_runtime: fingerprintContext,
          fingerprint_patch_manifest: {
            required_patches: ["audio_context"]
          },
          main_world_secret: "secret-bootstrap-old-001"
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();

    await primeTrustedFingerprintContext({
      runtimeMessageListeners,
      runId: "run-bootstrap-old-001",
      profile: "profile-a",
      fingerprintContext,
      tabId: 77,
      tabUrl: "https://example.com/runtime-readiness"
    });
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-bootstrap-new-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-new-001",
        command: "runtime.bootstrap",
        command_params: {
          version: "v1",
          run_id: "run-bootstrap-new-001",
          runtime_context_id: "ctx-bootstrap-new-001",
          profile: "profile-a",
          fingerprint_runtime: fingerprintContext,
          fingerprint_patch_manifest: {
            required_patches: ["audio_context"]
          },
          main_world_secret: "secret-bootstrap-new-001"
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();

    await waitForPostedMessage(firstPort.postMessage, {
      id: "run-bootstrap-new-001",
      status: "error",
      error: expect.objectContaining({
        code: "ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED"
      })
    });
  });

  it("establishes trusted fingerprint context from runtime.ping after bootstrap is already ready", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    const fingerprintContext = createFingerprintRuntimeContext();

    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-bootstrap-ready-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-ready-001",
        command: "runtime.bootstrap",
        command_params: {
          version: "v1",
          run_id: "run-bootstrap-ready-001",
          runtime_context_id: "ctx-bootstrap-ready-001",
          profile: "profile-a",
          fingerprint_runtime: fingerprintContext,
          fingerprint_patch_manifest: {
            required_patches: ["audio_context"]
          },
          main_world_secret: "secret-bootstrap-ready-001"
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();

    await primeTrustedFingerprintContext({
      runtimeMessageListeners,
      runId: "run-bootstrap-ready-001",
      profile: "profile-a",
      fingerprintContext,
      tabId: 77,
      tabUrl: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article"
    });
    await Promise.resolve();

    firstPort.postMessage.mockClear();

    firstPort.onMessageListeners[0]?.({
      id: "run-ping-prime-after-ready-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-ready-001",
        command: "runtime.ping",
        command_params: {
          target_tab_id: 77,
          target_domain: "creator.xiaohongshu.com",
          fingerprint_context: fingerprintContext
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();
    await Promise.resolve();

    runtimeMessageListeners[0]?.(
      {
        kind: "result",
        id: "run-ping-prime-after-ready-001",
        ok: true,
        payload: {
          fingerprint_runtime: {
            ...fingerprintContext,
            injection: {
              installed: true,
              required_patches: ["audio_context"],
              missing_required_patches: []
            }
          },
          target_tab_id: 77,
          summary: {
            capability_result: {
              outcome: "success"
            }
          }
        }
      },
      {
        tab: {
          id: 77,
          url: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article"
        }
      }
    );
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-trusted-probe-after-ready-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-ready-001",
        command: "runtime.trusted_fingerprint_probe",
        command_params: {},
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();

    await waitForPostedMessage(firstPort.postMessage, {
      id: "run-trusted-probe-after-ready-001",
      status: "success",
      payload: expect.objectContaining({
        trusted_context_present: true,
        trusted_context: expect.objectContaining({
          source_tab_id: 77,
          source_domain: "creator.xiaohongshu.com",
          run_id: "run-bootstrap-ready-001",
          runtime_context_id: "ctx-bootstrap-ready-001"
        })
      })
    });
  });

  it("keeps new runtime.bootstrap pending when a stale trusted context arrives later", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    const fingerprintContext = createFingerprintRuntimeContext();

    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-bootstrap-new-late-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-new-late-001",
        command: "runtime.bootstrap",
        command_params: {
          version: "v1",
          run_id: "run-bootstrap-new-late-001",
          runtime_context_id: "ctx-bootstrap-new-late-001",
          profile: "profile-a",
          fingerprint_runtime: fingerprintContext,
          fingerprint_patch_manifest: {
            required_patches: ["audio_context"]
          },
          main_world_secret: "secret-bootstrap-new-late-001"
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();

    await primeTrustedFingerprintContext({
      runtimeMessageListeners,
      runId: "run-bootstrap-old-late-001",
      runtimeContextId: "ctx-bootstrap-old-late-001",
      profile: "profile-a",
      fingerprintContext,
      tabId: 77,
      tabUrl: "https://example.com/runtime-readiness"
    });
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-readiness-after-stale-trust-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-new-late-001",
        command: "runtime.readiness",
        command_params: {
          runtime_context_id: "ctx-bootstrap-new-late-001"
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();

    expect(firstPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "run-readiness-after-stale-trust-001",
        status: "success",
        payload: expect.objectContaining({
          bootstrap_state: "pending",
          run_id: "run-bootstrap-new-late-001",
          runtime_context_id: "ctx-bootstrap-new-late-001",
          transport_state: "ready"
        })
      })
    );
  });

  it("keeps bootstrap pending when late attestation has same run_id but stale or missing runtime_context_id", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    const fingerprintContext = createFingerprintRuntimeContext();

    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-bootstrap-same-run-old-ctx-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-same-run-old-ctx-001",
        command: "runtime.bootstrap",
        command_params: {
          version: "v1",
          run_id: "run-bootstrap-same-run-old-ctx-001",
          runtime_context_id: "ctx-bootstrap-new-001",
          profile: "profile-a",
          fingerprint_runtime: fingerprintContext,
          fingerprint_patch_manifest: {
            required_patches: ["audio_context"]
          },
          main_world_secret: "secret-bootstrap-new-001"
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();

    await primeTrustedFingerprintContext({
      runtimeMessageListeners,
      runId: "run-bootstrap-same-run-old-ctx-001",
      runtimeContextId: "ctx-bootstrap-old-001",
      profile: "profile-a",
      fingerprintContext
    });
    await Promise.resolve();

    await primeTrustedFingerprintContext({
      runtimeMessageListeners,
      runId: "run-bootstrap-same-run-old-ctx-001",
      profile: "profile-a",
      fingerprintContext
    });
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-readiness-same-run-old-ctx-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-same-run-old-ctx-001",
        command: "runtime.readiness",
        command_params: {
          runtime_context_id: "ctx-bootstrap-new-001"
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();

    expect(firstPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "run-readiness-same-run-old-ctx-001",
        status: "success",
        payload: expect.objectContaining({
          bootstrap_state: "pending",
          run_id: "run-bootstrap-same-run-old-ctx-001",
          runtime_context_id: "ctx-bootstrap-new-001",
          transport_state: "ready"
        })
      })
    );
  });

  it("marks runtime.readiness stale when run_id or runtime_context_id does not match current bootstrap", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    const fingerprintContext = createFingerprintRuntimeContext();

    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-bootstrap-owner-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-owner-001",
        command: "runtime.bootstrap",
        command_params: {
          version: "v1",
          run_id: "run-bootstrap-owner-001",
          runtime_context_id: "ctx-bootstrap-owner-001",
          profile: "profile-a",
          fingerprint_runtime: fingerprintContext,
          fingerprint_patch_manifest: {
            required_patches: ["audio_context"]
          },
          main_world_secret: "secret-bootstrap-owner-001"
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-ping-owner-promote-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-owner-001",
        command: "runtime.ping",
        command_params: {
          fingerprint_context: fingerprintContext
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();
    await Promise.resolve();

    await promoteBootstrapReadinessThroughPing({
      runtimeMessageListeners,
      pingId: "run-ping-owner-promote-001",
      fingerprintContext,
      tabId: 32,
      tabUrl: "https://www.xiaohongshu.com/search_result?keyword=露营"
    });

    firstPort.onMessageListeners[0]?.({
      id: "run-readiness-owner-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-owner-001",
        command: "runtime.readiness",
        command_params: {
          runtime_context_id: "ctx-bootstrap-owner-001"
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();

    expect(firstPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "run-readiness-owner-001",
        status: "success",
        payload: expect.objectContaining({
          bootstrap_state: "ready",
          run_id: "run-bootstrap-owner-001",
          runtime_context_id: "ctx-bootstrap-owner-001",
          transport_state: "ready"
        })
      })
    );

    firstPort.onMessageListeners[0]?.({
      id: "run-readiness-other-run-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-other-001",
        command: "runtime.readiness",
        command_params: {
          runtime_context_id: "ctx-bootstrap-owner-001"
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();

    expect(firstPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "run-readiness-other-run-001",
        status: "success",
        payload: expect.objectContaining({
          bootstrap_state: "stale",
          run_id: "run-bootstrap-owner-001",
          runtime_context_id: "ctx-bootstrap-owner-001",
          transport_state: "ready"
        })
      })
    );

    firstPort.onMessageListeners[0]?.({
      id: "run-readiness-other-context-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-owner-001",
        command: "runtime.readiness",
        command_params: {
          runtime_context_id: "ctx-bootstrap-other-001"
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();

    expect(firstPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "run-readiness-other-context-001",
        status: "success",
        payload: expect.objectContaining({
          bootstrap_state: "stale",
          run_id: "run-bootstrap-owner-001",
          runtime_context_id: "ctx-bootstrap-owner-001",
          transport_state: "ready"
        })
      })
    );
  });

  it("forwards fingerprint_context without dropping fields", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);

    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    const fingerprintContext = createFingerprintRuntimeContext({
      allowed_execution_modes: ["dry_run", "recon", "live_read_limited"]
    });

    firstPort.onMessageListeners[0]?.({
      id: "run-fingerprint-forward-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-fingerprint-forward-001",
        command: "runtime.ping",
        command_params: {
          fingerprint_context: fingerprintContext
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(
      11,
      expect.objectContaining({
        id: "run-fingerprint-forward-001",
        fingerprintContext: fingerprintContext
      })
    );
  });

  it("forwards content-script error payload through background bridge", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-error-payload-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-error-payload-001",
        command: "xhs.search",
        command_params: createXhsCommandParams(),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    runtimeMessageListeners[0]?.(
      {
        kind: "result",
        id: "run-xhs-error-payload-001",
        ok: false,
        error: {
          code: "ERR_EXECUTION_FAILED",
          message: "登录态缺失，无法执行 xhs.search"
        },
        payload: {
          details: {
            reason: "SESSION_EXPIRED"
          },
          diagnosis: {
            category: "request_failed"
          }
        }
      },
      {
        tab: {
          id: 11
        }
      }
    );
    await Promise.resolve();

    const forwardedError = firstPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: Record<string, unknown> })
      .find((message) => message.id === "run-xhs-error-payload-001");
    expect(forwardedError).toMatchObject({
      id: "run-xhs-error-payload-001",
      status: "error",
      payload: {
        consumer_gate_result: {
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
          requested_execution_mode: "dry_run",
          effective_execution_mode: "dry_run",
          issue_scope: "issue_209"
        },
        details: {
          reason: "SESSION_EXPIRED"
        },
        diagnosis: {
          category: "request_failed"
        }
      }
    });
  });

});
