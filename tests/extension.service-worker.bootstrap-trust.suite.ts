import { describe, expect, it, vi } from "vitest";
import { createMockPort, createEditorInputProbeResult, createChromeApi, respondHandshake, waitForBridgeTurn, waitForPostedMessage, primeTrustedFingerprintContext, promoteBootstrapReadinessThroughPing, createXhsCommandParams, createRequestBoundXhsCommandParams, createXhsEditorInputCommandParams, createApprovedReadApprovalRecord, createApprovedReadAuditRecordForRequest, createFingerprintRuntimeContext, asRecord, resolveWriteInteractionTier, startChromeBackgroundBridge } from "./extension.service-worker.shared.js";

describe("extension service worker / bootstrap and trust", () => {
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
    expect(executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 11 },
        world: "MAIN",
        files: ["build/main-world-bridge.js"]
      })
    );

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

    expect(executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 52 },
        world: "MAIN",
        files: ["build/main-world-bridge.js"]
      })
    );
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

    expect(executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 11 },
        world: "MAIN",
        files: ["build/main-world-bridge.js"]
      })
    );
    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(
      11,
      expect.objectContaining({
        id: "run-bootstrap-main-world-recover-001",
        command: "runtime.bootstrap"
      })
    );
  });

  it("forces staged main-world bridge reinjection even when a probe says the tab is already ready", async () => {
    const firstPort = createMockPort();
    const { chromeApi, executeScript } = createChromeApi([firstPort]);
    const fingerprintContext = createFingerprintRuntimeContext();
    chromeApi.runtime.getManifest = vi.fn(() => ({
      content_scripts: [
        { js: ["build/main-world-bridge.js"] },
        { js: ["build/content-script.js", "build/__webenvoy_fingerprint_bootstrap.js"] }
      ]
    }));
    executeScript.mockImplementation(
      async (
        input:
          | { world?: "MAIN" | "ISOLATED"; files?: string[] }
          | { world?: "MAIN" | "ISOLATED"; func?: (...args: unknown[]) => unknown; args?: unknown[] }
      ) => {
        if ("func" in input && typeof input.func === "function") {
          return [{ result: true }];
        }
        return [{ result: { "X-s": "signed", "X-t": "1700000000" } }];
      }
    );

    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-bootstrap-staged-reinject-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-staged-reinject-001",
        command: "runtime.bootstrap",
        command_params: {
          version: "v1",
          run_id: "run-bootstrap-staged-reinject-001",
          runtime_context_id: "ctx-bootstrap-staged-reinject-001",
          profile: "profile-a",
          fingerprint_runtime: fingerprintContext,
          fingerprint_patch_manifest: {
            required_patches: ["audio_context"]
          },
          main_world_secret: "secret-bootstrap-staged-reinject-001"
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });

    await waitForBridgeTurn();

    expect(executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 11 },
        world: "MAIN",
        files: ["build/main-world-bridge.js"]
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
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
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
      tabId: 32,
      tabUrl: "https://www.xiaohongshu.com/search_result?keyword=露营"
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
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
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
          source_domain: "www.xiaohongshu.com"
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

  it("keeps target-bound readiness compatible with legacy ready bootstrap state missing sourcePage", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    const fingerprintContext = createFingerprintRuntimeContext();

    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-bootstrap-legacy-page-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-legacy-page-001",
        command: "runtime.bootstrap",
        command_params: {
          version: "v1",
          run_id: "run-bootstrap-legacy-page-001",
          runtime_context_id: "ctx-bootstrap-legacy-page-001",
          profile: "profile-a",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          fingerprint_runtime: fingerprintContext,
          fingerprint_patch_manifest: {
            required_patches: ["audio_context"]
          },
          main_world_secret: "secret-bootstrap-legacy-page-001"
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();

    await waitForPostedMessage(firstPort.postMessage, {
      id: "run-bootstrap-legacy-page-001",
      status: "error",
      error: expect.objectContaining({
        code: "ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED"
      })
    });

    await primeTrustedFingerprintContext({
      runtimeMessageListeners,
      runId: "run-bootstrap-legacy-page-001",
      runtimeContextId: "ctx-bootstrap-legacy-page-001",
      profile: "profile-a",
      fingerprintContext,
      tabId: 32,
      tabUrl: ""
    });

    firstPort.onMessageListeners[0]?.({
      id: "run-readiness-legacy-page-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-legacy-page-001",
        command: "runtime.readiness",
        command_params: {
          runtime_context_id: "ctx-bootstrap-legacy-page-001",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab"
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();

    await waitForPostedMessage(firstPort.postMessage, {
      id: "run-readiness-legacy-page-001",
      status: "success",
      payload: expect.objectContaining({
        bootstrap_state: "ready",
        managed_target_tab_id: 32,
        managed_target_domain: "www.xiaohongshu.com",
        managed_target_page: "search_result_tab",
        target_tab_continuity: "runtime_trust_state"
      })
    });
  });

  it("accepts legacy trusted bootstrap records missing sourcePage on the next target-bound bootstrap", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    const fingerprintContext = createFingerprintRuntimeContext();

    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-bootstrap-legacy-trusted-page-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-legacy-trusted-page-001",
        command: "runtime.bootstrap",
        command_params: {
          version: "v1",
          run_id: "run-bootstrap-legacy-trusted-page-001",
          runtime_context_id: "ctx-bootstrap-legacy-trusted-page-001",
          profile: "profile-a",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          fingerprint_runtime: fingerprintContext,
          fingerprint_patch_manifest: {
            required_patches: ["audio_context"]
          },
          main_world_secret: "secret-bootstrap-legacy-trusted-page-001"
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();

    await waitForPostedMessage(firstPort.postMessage, {
      id: "run-bootstrap-legacy-trusted-page-001",
      status: "error",
      error: expect.objectContaining({
        code: "ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED"
      })
    });

    firstPort.onMessageListeners[0]?.({
      id: "run-ping-legacy-trusted-page-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-legacy-trusted-page-001",
        command: "runtime.ping",
        command_params: {
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          fingerprint_context: fingerprintContext
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await waitForBridgeTurn();

    runtimeMessageListeners[0]?.(
      {
        kind: "result",
        id: "run-ping-legacy-trusted-page-001",
        ok: true,
        payload: {
          fingerprint_runtime: {
            ...fingerprintContext,
            injection: {
              installed: true,
              required_patches: ["audio_context"],
              missing_required_patches: [],
              source: "main_world"
            }
          },
          target_tab_id: 32,
          summary: {
            capability_result: {
              outcome: "success"
            }
          }
        }
      },
      {
        tab: {
          id: 32
        }
      }
    );
    await waitForPostedMessage(firstPort.postMessage, {
      id: "run-ping-legacy-trusted-page-001",
      status: "success"
    });

    firstPort.postMessage.mockClear();
    chromeApi.tabs.sendMessage.mockClear();

    firstPort.onMessageListeners[0]?.({
      id: "run-bootstrap-legacy-trusted-page-002",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-legacy-trusted-page-001",
        command: "runtime.bootstrap",
        command_params: {
          version: "v1",
          run_id: "run-bootstrap-legacy-trusted-page-001",
          runtime_context_id: "ctx-bootstrap-legacy-trusted-page-001",
          profile: "profile-a",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
          fingerprint_runtime: fingerprintContext,
          fingerprint_patch_manifest: {
            required_patches: ["audio_context"]
          },
          main_world_secret: "secret-bootstrap-legacy-trusted-page-001"
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();

    await waitForPostedMessage(firstPort.postMessage, {
      id: "run-bootstrap-legacy-trusted-page-002",
      status: "success",
      payload: expect.objectContaining({
        runtime_bootstrap_attested: true,
        result: expect.objectContaining({
          status: "ready"
        })
      })
    });
    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it("fails runtime.bootstrap ready ack when the sender page no longer matches target_page", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    const fingerprintContext = createFingerprintRuntimeContext();
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);

    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-bootstrap-page-conflict-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-page-conflict-001",
        command: "runtime.bootstrap",
        command_params: {
          version: "v1",
          run_id: "run-bootstrap-page-conflict-001",
          runtime_context_id: "ctx-bootstrap-page-conflict-001",
          profile: "profile-a",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
          fingerprint_runtime: fingerprintContext,
          fingerprint_patch_manifest: {
            required_patches: ["audio_context"]
          },
          main_world_secret: "secret-bootstrap-page-conflict-001"
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await waitForBridgeTurn();

    runtimeMessageListeners[0]?.(
      {
        kind: "result",
        id: "run-bootstrap-page-conflict-001",
        ok: true,
        payload: {
          method: "runtime.bootstrap.ack",
          result: {
            version: "v1",
            run_id: "run-bootstrap-page-conflict-001",
            runtime_context_id: "ctx-bootstrap-page-conflict-001",
            profile: "profile-a",
            status: "ready"
          },
          fingerprint_runtime: {
            ...fingerprintContext,
            injection: {
              installed: true,
              required_patches: ["audio_context"],
              missing_required_patches: [],
              source: "main_world"
            }
          }
        }
      },
      {
        tab: {
          id: 32,
          url: "https://www.xiaohongshu.com/explore/abc123"
        }
      }
    );
    await Promise.resolve();

    await waitForPostedMessage(firstPort.postMessage, {
      id: "run-bootstrap-page-conflict-001",
      status: "error",
      error: expect.objectContaining({
        code: "ERR_RUNTIME_READY_SIGNAL_CONFLICT"
      })
    });

    firstPort.onMessageListeners[0]?.({
      id: "run-readiness-page-conflict-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-page-conflict-001",
        command: "runtime.readiness",
        command_params: {
          runtime_context_id: "ctx-bootstrap-page-conflict-001",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab"
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();

    await waitForPostedMessage(firstPort.postMessage, {
      id: "run-readiness-page-conflict-001",
      status: "success",
      payload: expect.objectContaining({
        bootstrap_state: "failed"
      })
    });
  });

  it("fails stale runtime.bootstrap ack when the sender page no longer matches target_page", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    const fingerprintContext = createFingerprintRuntimeContext();
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);

    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-bootstrap-stale-page-conflict-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-stale-page-conflict-001",
        command: "runtime.bootstrap",
        command_params: {
          version: "v1",
          run_id: "run-bootstrap-stale-page-conflict-001",
          runtime_context_id: "ctx-bootstrap-stale-page-conflict-001",
          profile: "profile-a",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
          fingerprint_runtime: fingerprintContext,
          fingerprint_patch_manifest: {
            required_patches: ["audio_context"]
          },
          main_world_secret: "secret-bootstrap-stale-page-conflict-001"
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await waitForBridgeTurn();

    runtimeMessageListeners[0]?.(
      {
        kind: "result",
        id: "run-bootstrap-stale-page-conflict-001",
        ok: true,
        payload: {
          method: "runtime.bootstrap.ack",
          result: {
            version: "v1",
            run_id: "run-bootstrap-stale-page-conflict-001",
            runtime_context_id: "ctx-bootstrap-stale-page-conflict-001",
            profile: "profile-a",
            status: "stale"
          },
          fingerprint_runtime: {
            ...fingerprintContext,
            injection: {
              installed: true,
              required_patches: ["audio_context"],
              missing_required_patches: [],
              source: "main_world"
            }
          }
        }
      },
      {
        tab: {
          id: 32,
          url: "https://www.xiaohongshu.com/explore/abc123"
        }
      }
    );
    await Promise.resolve();

    await waitForPostedMessage(firstPort.postMessage, {
      id: "run-bootstrap-stale-page-conflict-001",
      status: "error",
      error: expect.objectContaining({
        code: "ERR_RUNTIME_READY_SIGNAL_CONFLICT"
      })
    });
  });

  it("fails stale runtime.bootstrap ack without execution-surface attestation", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    const fingerprintContext = createFingerprintRuntimeContext();
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);

    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-bootstrap-stale-no-attestation-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-bootstrap-stale-no-attestation-001",
        command: "runtime.bootstrap",
        command_params: {
          version: "v1",
          run_id: "run-bootstrap-stale-no-attestation-001",
          runtime_context_id: "ctx-bootstrap-stale-no-attestation-001",
          profile: "profile-a",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
          fingerprint_runtime: fingerprintContext,
          fingerprint_patch_manifest: {
            required_patches: ["audio_context"]
          },
          main_world_secret: "secret-bootstrap-stale-no-attestation-001"
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await waitForBridgeTurn();

    runtimeMessageListeners[0]?.(
      {
        kind: "result",
        id: "run-bootstrap-stale-no-attestation-001",
        ok: true,
        payload: {
          method: "runtime.bootstrap.ack",
          result: {
            version: "v1",
            run_id: "run-bootstrap-stale-no-attestation-001",
            runtime_context_id: "ctx-bootstrap-stale-no-attestation-001",
            profile: "profile-a",
            status: "stale"
          }
        }
      },
      {
        tab: {
          id: 32,
          url: "https://www.xiaohongshu.com/search_result?keyword=露营"
        }
      }
    );
    await Promise.resolve();

    await waitForPostedMessage(firstPort.postMessage, {
      id: "run-bootstrap-stale-no-attestation-001",
      status: "error",
      error: expect.objectContaining({
        code: "ERR_RUNTIME_READY_SIGNAL_CONFLICT"
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
    await vi.waitFor(() => {
      expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(
        32,
        expect.objectContaining({
          id: "run-xhs-error-payload-001",
          command: "xhs.search"
        })
      );
    });

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
          id: 32,
          url: "https://www.xiaohongshu.com/search_result?keyword=露营"
        }
      }
    );
    await waitForPostedMessage(firstPort.postMessage, {
      id: "run-xhs-error-payload-001",
      status: "error",
      payload: expect.objectContaining({
        consumer_gate_result: expect.objectContaining({
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
          requested_execution_mode: "dry_run",
          effective_execution_mode: "dry_run",
          issue_scope: "issue_209"
        }),
        details: expect.objectContaining({
          reason: "SESSION_EXPIRED"
        }),
        diagnosis: expect.objectContaining({
          category: "request_failed"
        })
      })
    });
  });

  it("pins xhs.search to xiaohongshu tab instead of generic active tab", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async (filter: { active?: boolean; url?: string | string[] }) => {
      if (filter.url) {
        return [
          { id: 44, url: "https://www.xiaohongshu.com/home", active: true },
          { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: false },
          { id: 52, url: "https://www.xiaohongshu.com/explore/abc", active: false }
        ];
      }
      return [{ id: 11 }];
    });

    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-tab-pin-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-tab-pin-001",
        command: "xhs.search",
        command_params: createXhsCommandParams(),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(
      32,
      expect.objectContaining({
        id: "run-xhs-tab-pin-001",
        command: "xhs.search"
      })
    );

    runtimeMessageListeners[0]?.(
      {
        kind: "result",
        id: "run-xhs-tab-pin-001",
        ok: true,
        payload: {
          summary: {
            capability_result: {
              outcome: "success"
            }
          }
        }
      },
      {
        tab: {
          id: 32,
          url: "https://www.xiaohongshu.com/search_result?keyword=露营"
        }
      }
    );
    await Promise.resolve();

    const forwarded = firstPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: { summary?: Record<string, unknown> } })
      .find((message) => message.id === "run-xhs-tab-pin-001");
    expect(forwarded).toMatchObject({
      id: "run-xhs-tab-pin-001",
      status: "success",
      payload: {
        summary: {
          consumer_gate_result: {
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "search_result_tab",
            requested_execution_mode: "dry_run",
            effective_execution_mode: "dry_run",
            gate_decision: "allowed",
            issue_scope: "issue_209"
          }
        }
      }
    });
  });

  it("accepts real xhs.search payload shape and reads target gate fields from options", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async (filter: { url?: string | string[] }) => {
      if (filter.url) {
        return [
          { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: false },
          { id: 44, url: "https://www.xiaohongshu.com/home", active: true }
        ];
      }
      return [{ id: 11 }];
    });

    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-options-shape-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-options-shape-001",
        command: "xhs.search",
        command_params: {
          ability: { id: "xhs.search.notes.v1", layer: "L3", action: "read" },
          input: { query: "露营" },
          options: {
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "dry_run"
          }
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(
      32,
      expect.objectContaining({
        id: "run-xhs-options-shape-001",
        command: "xhs.search"
      })
    );
  });

  it("allows explicit target tab in another window", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(
      async (filter: { currentWindow?: boolean; url?: string | string[] }) => {
        if (filter.url) {
          expect(filter.url).toBe("*://www.xiaohongshu.com/*");
          expect(filter.currentWindow).toBeUndefined();
          return [
            {
              id: 77,
              url: "https://www.xiaohongshu.com/search_result?keyword=跨窗口",
              active: false
            }
          ];
        }
        return [{ id: 11 }];
      }
    );

    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-cross-window-tab-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-cross-window-tab-001",
        command: "xhs.search",
        command_params: createXhsCommandParams({
          target_tab_id: 77
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(
      77,
      expect.objectContaining({
        id: "run-xhs-cross-window-tab-001",
        command: "xhs.search"
      })
    );
  });

  it("returns target-tab-unavailable when no xhs candidate tab exists", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async (filter: { url?: string | string[] }) => {
      if (filter.url) {
        return [];
      }
      return [{ id: 11 }];
    });

    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-no-tab-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-no-tab-001",
        command: "xhs.search",
        command_params: createXhsCommandParams(),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const forwardResult = firstPort.postMessage.mock.calls
      .map(
        (call) =>
          call[0] as {
            id?: string;
            status?: string;
            payload?: Record<string, unknown>;
            error?: { code?: string; message?: string };
          }
      )
      .find((message) => message.id === "run-xhs-no-tab-001");
    expect(forwardResult).toMatchObject({
      id: "run-xhs-no-tab-001",
      status: "error",
      payload: {
        details: {
          stage: "execution",
          reason: "TARGET_TAB_NOT_FOUND",
          forward_failure_stage: "gate_target_resolve",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab"
        }
      },
      error: {
        code: "ERR_TRANSPORT_FORWARD_FAILED",
        message: "target tab is unavailable"
      }
    });
  });

  it("blocks xhs.search when target_page is missing", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-missing-page-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-missing-page-001",
        command: "xhs.search",
        command_params: createXhsCommandParams({
          target_page: undefined
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const blocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as {
        id?: string;
        status?: string;
        payload?: {
          consumer_gate_result?: {
            target_domain?: string | null;
            target_tab_id?: number | null;
            target_page?: string | null;
            action_type?: string;
            requested_execution_mode?: string;
            effective_execution_mode?: string;
            gate_reasons?: string[];
          };
        };
      })
      .find((message) => message.id === "run-xhs-missing-page-001");
    expect(blocked).toMatchObject({
      id: "run-xhs-missing-page-001",
      status: "error",
      payload: {
        consumer_gate_result: {
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: null,
          action_type: "read",
          requested_execution_mode: "dry_run",
          effective_execution_mode: "dry_run",
          gate_reasons: ["TARGET_PAGE_NOT_EXPLICIT"]
        }
      }
    });
    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it("keeps target_tab_id explicit for issue_208 editor_input forward", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners, executeScript } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 18, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true },
      { id: 32, url: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article", active: false }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();
    await primeTrustedFingerprintContext({
      runtimeMessageListeners,
      runId: "run-xhs-issue-208-editor-input-autotab-001",
      profile: "profile-a",
      fingerprintContext: createFingerprintRuntimeContext({
        live_allowed: true,
        live_decision: "allowed",
        allowed_execution_modes: [
          "dry_run",
          "recon",
          "live_read_limited",
          "live_read_high_risk",
          "live_write"
        ]
      }),
      tabId: 32,
      tabUrl: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article"
    });

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-issue-208-editor-input-autotab-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-issue-208-editor-input-autotab-001",
        command: "xhs.search",
        command_params: createXhsEditorInputCommandParams({
          target_tab_id: undefined
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const proactiveContentScriptInject = executeScript.mock.calls.find(
      (call) =>
        (call[0] as { world?: string; files?: string[] }).world === "ISOLATED" &&
        ((call[0] as { files?: string[] }).files ?? []).includes("build/content-script.js")
    );
    expect(proactiveContentScriptInject).toBeUndefined();

    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalledWith(
      32,
      expect.objectContaining({
        id: "run-xhs-issue-208-editor-input-autotab-001",
        command: "xhs.search"
      })
    );

    const blocked = firstPort.postMessage.mock.calls
      .map(
        (call) =>
          call[0] as {
            id?: string;
            status?: string;
            payload?: {
              consumer_gate_result?: {
                target_tab_id?: number | null;
                gate_decision?: string;
                gate_reasons?: string[];
              };
            };
          }
      )
      .find((message) => message.id === "run-xhs-issue-208-editor-input-autotab-001");
    expect(blocked).toMatchObject({
      id: "run-xhs-issue-208-editor-input-autotab-001",
      status: "error",
      payload: {
        consumer_gate_result: {
          target_tab_id: null,
          gate_decision: "blocked",
          gate_reasons: expect.arrayContaining(["TARGET_TAB_NOT_EXPLICIT"])
        }
      }
    });
  });

  it("falls back to global xhs tab resolution when currentWindow query is empty", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async (filter: { currentWindow?: boolean; url?: string | string[] }) => {
      if (filter.currentWindow) {
        return [];
      }
      if (filter.url) {
        return [{ id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }];
      }
      return [];
    });
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-issue-208-editor-input-globaltab-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-issue-208-editor-input-globaltab-001",
        command: "xhs.search",
        command_params: createXhsCommandParams({
          target_tab_id: undefined
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(
      32,
      expect.objectContaining({
        id: "run-xhs-issue-208-editor-input-globaltab-001",
        command: "xhs.search"
      })
    );
  });

  it("blocks xhs.search when requested_execution_mode is missing", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-missing-requested-mode-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-missing-requested-mode-001",
        command: "xhs.search",
        command_params: createXhsCommandParams({
          requested_execution_mode: undefined
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();

    const blocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as {
        id?: string;
        status?: string;
        payload?: {
          consumer_gate_result?: {
            requested_execution_mode?: string | null;
            effective_execution_mode?: string;
            gate_decision?: string;
            gate_reasons?: string[];
          };
        };
      })
      .find((message) => message.id === "run-xhs-missing-requested-mode-001");
    expect(blocked).toMatchObject({
      id: "run-xhs-missing-requested-mode-001",
      status: "error",
      payload: {
        consumer_gate_result: {
          requested_execution_mode: null,
          effective_execution_mode: "dry_run",
          gate_decision: "blocked",
          gate_reasons: ["REQUESTED_EXECUTION_MODE_NOT_EXPLICIT"]
        }
      }
    });
    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it("blocks live_read_high_risk in background gate when admission evidence is missing", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-live-mode-blocked-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-live-mode-blocked-001",
        command: "xhs.search",
        command_params: createXhsCommandParams({
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          fingerprint_context: createFingerprintRuntimeContext(),
          admission_context: null
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();

    const blocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as {
        id?: string;
        status?: string;
        payload?: {
          details?: {
            reason?: string;
          };
          consumer_gate_result?: {
            issue_scope?: string;
            target_domain?: string | null;
            target_tab_id?: number | null;
            target_page?: string | null;
            action_type?: string;
            requested_execution_mode?: string | null;
            effective_execution_mode?: string;
            gate_decision?: string;
            gate_reasons?: string[];
          };
        };
      })
      .find((message) => message.id === "run-xhs-live-mode-blocked-001");
    expect(blocked).toMatchObject({
      id: "run-xhs-live-mode-blocked-001",
      status: "error",
      payload: {
        plugin_gate_ownership: {
          background_gate: [
            "target_domain_check",
            "target_tab_check",
            "mode_gate",
            "risk_state_gate"
          ],
          content_script_gate: ["page_context_check", "action_tier_check"],
          main_world_gate: ["signed_call_scope_check"],
          cli_role: "request_and_result_shell_only"
        },
        risk_transition_audit: {
          issue_scope: "issue_209",
          prev_state: "allowed",
          next_state: "limited",
          trigger: "risk_signal_detected",
          decision: "blocked"
        },
        consumer_gate_result: {
          issue_scope: "issue_209",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
          action_type: "read",
          requested_execution_mode: "live_read_high_risk",
          effective_execution_mode: "dry_run",
          gate_decision: "blocked",
          gate_reasons: expect.arrayContaining([
            "MANUAL_CONFIRMATION_MISSING",
            "APPROVAL_CHECKS_INCOMPLETE",
            "AUDIT_RECORD_MISSING"
          ])
        },
        read_execution_policy: {
          default_mode: "dry_run",
          allowed_modes: ["dry_run", "recon", "live_read_limited", "live_read_high_risk"],
          blocked_actions: ["expand_new_live_surface_without_gate"]
        },
        issue_action_matrix: {
          issue_scope: "issue_209",
          state: "limited",
          allowed_actions: ["dry_run", "recon"],
          conditional_actions: [
            {
              action: "live_read_limited",
              requires: expect.arrayContaining([
                "audit_admission_evidence_present",
                "audit_admission_checks_all_true",
                "limited_read_rollout_ready_true",
                "approval_admission_evidence_approved_true",
                "approval_admission_evidence_approver_present",
                "approval_admission_evidence_approved_at_present",
                "approval_admission_evidence_checks_all_true"
              ])
            }
          ]
        },
        risk_state_output: {
          current_state: "limited",
          session_rhythm_policy: {
            min_action_interval_ms: 3000,
            min_experiment_interval_ms: 30000,
            cooldown_strategy: "exponential_backoff",
            cooldown_base_minutes: 30,
            cooldown_cap_minutes: 720,
            resume_probe_mode: "recon_only"
          },
          session_rhythm: {
            state: "cooldown",
            triggered_by: "MANUAL_CONFIRMATION_MISSING",
            cooldown_until: expect.any(String),
            recovery_started_at: null,
            last_event_at: expect.any(String),
            source_event_id: expect.any(String)
          },
          recovery_requirements: [
            "stability_window_passed_and_manual_approve",
            "risk_state_checked",
            "audit_record_present"
          ]
        }
      }
    });
  });

  it("blocks live_read_limited in background gate when admission evidence is missing", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-live-limited-blocked-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-live-limited-blocked-001",
        command: "xhs.search",
        command_params: createXhsCommandParams({
          requested_execution_mode: "live_read_limited",
          risk_state: "limited",
          fingerprint_context: createFingerprintRuntimeContext(),
          admission_context: null
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();

    const blocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as {
        id?: string;
        status?: string;
        payload?: {
          gate_outcome?: {
            effective_execution_mode?: string;
            requires_manual_confirmation?: boolean;
          };
          consumer_gate_result?: {
            requested_execution_mode?: string | null;
            effective_execution_mode?: string;
            gate_decision?: string;
            gate_reasons?: string[];
          };
        };
      })
      .find((message) => message.id === "run-xhs-live-limited-blocked-001");
    expect(blocked).toMatchObject({
      id: "run-xhs-live-limited-blocked-001",
      status: "error",
      payload: {
        gate_outcome: {
          effective_execution_mode: "recon",
          requires_manual_confirmation: true
        },
        consumer_gate_result: {
          requested_execution_mode: "live_read_limited",
          effective_execution_mode: "recon",
          gate_decision: "blocked",
          gate_reasons: expect.arrayContaining([
            "MANUAL_CONFIRMATION_MISSING",
            "APPROVAL_CHECKS_INCOMPLETE"
          ])
        }
      }
    });
  });

  it("blocks issue_209 write live_read_limited in background before relay even with approval", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      {
        id: 32,
        url: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article",
        active: true
      }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-issue209-write-limited-bg-blocked-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-issue209-write-limited-bg-blocked-001",
        command: "xhs.search",
        command_params: createXhsCommandParams({
          issue_scope: "issue_209",
          target_domain: "creator.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "creator_publish_tab",
          action_type: "write",
          requested_execution_mode: "live_read_limited",
          risk_state: "limited",
          approval_record: {
            approved: true,
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:00Z",
            checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            }
          }
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();

    const blocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as {
        id?: string;
        status?: string;
        payload?: {
          consumer_gate_result?: {
            issue_scope?: string;
            action_type?: string;
            requested_execution_mode?: string | null;
            effective_execution_mode?: string;
            gate_decision?: string;
            gate_reasons?: string[];
          };
        };
      })
      .find((message) => message.id === "run-xhs-issue209-write-limited-bg-blocked-001");
    expect(blocked).toMatchObject({
      id: "run-xhs-issue209-write-limited-bg-blocked-001",
      status: "error",
      payload: {
        consumer_gate_result: {
          issue_scope: "issue_209",
          action_type: "write",
          requested_execution_mode: "live_read_limited",
          effective_execution_mode: "recon",
          gate_decision: "blocked",
          gate_reasons: expect.arrayContaining([
            "ACTION_TYPE_MODE_MISMATCH",
            "RISK_STATE_LIMITED",
            "ISSUE_ACTION_MATRIX_BLOCKED"
          ])
        }
      }
    });
  });

  it("blocks live_read_high_risk in paused state even with approval", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-live-mode-paused-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-live-mode-paused-001",
        command: "xhs.search",
        command_params: createXhsCommandParams({
          requested_execution_mode: "live_read_high_risk",
          risk_state: "paused",
          fingerprint_context: createFingerprintRuntimeContext(),
          approval_record: {
            approved: true,
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:00Z",
            checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            }
          }
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
    const blocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as {
        id?: string;
        status?: string;
        payload?: {
          consumer_gate_result?: {
            gate_reasons?: string[];
          };
        };
      })
      .find((message) => message.id === "run-xhs-live-mode-paused-001");
    expect(blocked).toMatchObject({
      id: "run-xhs-live-mode-paused-001",
      status: "error",
      payload: {
        consumer_gate_result: {
          gate_reasons: ["RISK_STATE_PAUSED", "ISSUE_ACTION_MATRIX_BLOCKED"]
        }
      }
    });
  });

  it("blocks issue_208 write action in paused state and exposes reversible write tier", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      {
        id: 32,
        url: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article",
        active: true
      }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-issue-208-paused-write-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-issue-208-paused-write-001",
        command: "xhs.search",
        command_params: createXhsCommandParams({
          issue_scope: "issue_208",
          target_domain: "creator.xiaohongshu.com",
          target_page: "creator_publish_tab",
          action_type: "write",
          requested_execution_mode: "dry_run",
          risk_state: "paused",
          approval_record: {
            approved: true,
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:00Z",
            checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            }
          }
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();

    const blocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: Record<string, unknown> })
      .find((message) => message.id === "run-xhs-issue-208-paused-write-001");
    expect(blocked?.status).toBe("error");
    const payload = asRecord(blocked?.payload) ?? {};
    const consumerGateResult = asRecord(payload.consumer_gate_result);
    expect(consumerGateResult?.gate_decision).toBe("blocked");
    expect(resolveWriteInteractionTier(payload)).toBe("reversible_interaction");
  });

  it("blocks background gate when action_type is omitted even if ability context is write", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=%E9%9C%B2%E8%90%A5", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-missing-action-type-bg-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-missing-action-type-bg-001",
        command: "xhs.search",
        command_params: {
          ability: {
            id: "xhs.note.search.v1",
            layer: "L3",
            action: "write"
          },
          input: {
            query: "露营装备"
          },
          options: {
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "search_result_tab",
            requested_execution_mode: "live_write",
            risk_state: "allowed"
          }
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
    const blocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: Record<string, unknown> })
      .find((message) => message.id === "run-xhs-missing-action-type-bg-001");
    expect(blocked?.status).toBe("error");
    const payload = asRecord(blocked?.payload) ?? {};
    const consumerGateResult = asRecord(payload.consumer_gate_result);
    expect(consumerGateResult?.action_type).toBeNull();
    expect(consumerGateResult?.gate_decision).toBe("blocked");
    expect(consumerGateResult?.write_interaction_tier).toBeNull();
    expect(payload.write_action_matrix_decisions).toBeNull();
    expect(consumerGateResult?.gate_reasons).toEqual(
      expect.arrayContaining(["ACTION_TYPE_NOT_EXPLICIT", "EXECUTION_MODE_UNSUPPORTED_FOR_COMMAND"])
    );
  });

  it("blocks ability.action mismatch in background with the same gate reason as relay", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
        id: "run-xhs-ability-action-mismatch-bg-001",
        method: "bridge.forward",
        profile: "profile-a",
        params: {
          session_id: "nm-session-001",
          run_id: "run-xhs-ability-action-mismatch-bg-001",
          command: "xhs.search",
          command_params: {
            ability: {
              id: "xhs.note.search.v1",
              layer: "L3",
            action: "write"
          },
          input: {
            query: "露营装备"
          },
          options: {
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "dry_run",
            risk_state: "paused"
          }
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();

    const blocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; error?: { code?: string }; payload?: Record<string, unknown> })
      .find((message) => message.id === "run-xhs-ability-action-mismatch-bg-001");
    expect(blocked?.status).toBe("error");
    expect(blocked?.error?.code).toBe("ERR_TRANSPORT_FORWARD_FAILED");
    const payload = asRecord(blocked?.payload) ?? {};
    const consumerGateResult = asRecord(payload.consumer_gate_result);
    expect(consumerGateResult?.gate_decision).toBe("blocked");
    expect(consumerGateResult?.action_type).toBe("read");
    expect(consumerGateResult?.gate_reasons).toEqual(
      expect.arrayContaining(["ABILITY_ACTION_CONTEXT_MISMATCH"])
    );
  });

  it("keeps issue_208 dry_run write blocked in limited/allowed even with complete approval", async () => {
    const states: Array<"limited" | "allowed"> = ["limited", "allowed"];

    for (const state of states) {
      const blockedPort = createMockPort();
      const { chromeApi: blockedChromeApi } = createChromeApi([blockedPort]);
      blockedChromeApi.tabs.query.mockImplementation(async () => [
        { id: 32, url: "https://creator.xiaohongshu.com/publish/publish", active: true }
      ]);
      startChromeBackgroundBridge(blockedChromeApi);
      respondHandshake(blockedPort);
      await Promise.resolve();

      blockedPort.onMessageListeners[0]?.({
        id: `run-xhs-issue-208-${state}-missing-approval-001`,
        method: "bridge.forward",
        profile: "profile-a",
        params: {
          session_id: "nm-session-001",
          run_id: `run-xhs-issue-208-${state}-missing-approval-001`,
          command: "xhs.search",
          command_params: createXhsCommandParams({
            issue_scope: "issue_208",
            target_domain: "creator.xiaohongshu.com",
            target_page: "creator_publish_tab",
            action_type: "write",
            requested_execution_mode: "dry_run",
            risk_state: state,
            approval_record: {
              approved: false,
              approver: null,
              approved_at: null,
              checks: {
                target_domain_confirmed: false,
                target_tab_confirmed: false,
                target_page_confirmed: false,
                risk_state_checked: false,
                action_type_confirmed: false
              }
            }
          }),
          cwd: "/workspace/WebEnvoy"
        },
        timeout_ms: 100
      });
      await Promise.resolve();
      await Promise.resolve();

      expect(blockedChromeApi.tabs.sendMessage).not.toHaveBeenCalled();
      const blocked = blockedPort.postMessage.mock.calls
        .map((call) => call[0] as { id?: string; status?: string; payload?: Record<string, unknown> })
        .find((message) => message.id === `run-xhs-issue-208-${state}-missing-approval-001`);
      expect(blocked?.status).toBe("error");
      const blockedPayload = asRecord(blocked?.payload) ?? {};
      const blockedConsumerGateResult = asRecord(blockedPayload.consumer_gate_result);
      expect(blockedConsumerGateResult?.gate_decision).toBe("blocked");
      expect(blockedPayload.write_action_matrix).toBeUndefined();

      const approvedPort = createMockPort();
      const { chromeApi: approvedChromeApi, runtimeMessageListeners } = createChromeApi([approvedPort]);
      approvedChromeApi.tabs.query.mockImplementation(async () => [
        { id: 32, url: "https://creator.xiaohongshu.com/publish/publish", active: true }
      ]);
      startChromeBackgroundBridge(approvedChromeApi);
      respondHandshake(approvedPort);
      await Promise.resolve();

      approvedPort.onMessageListeners[0]?.({
        id: `run-xhs-issue-208-${state}-approved-001`,
        method: "bridge.forward",
        profile: "profile-a",
        params: {
          session_id: "nm-session-001",
          run_id: `run-xhs-issue-208-${state}-approved-001`,
          command: "xhs.search",
          command_params: createXhsCommandParams({
            issue_scope: "issue_208",
            target_domain: "creator.xiaohongshu.com",
            target_page: "creator_publish_tab",
            action_type: "write",
            requested_execution_mode: "dry_run",
            risk_state: state,
            approval_record: {
              approved: true,
              approver: "qa-reviewer",
              approved_at: "2026-03-23T10:00:00Z",
              checks: {
                target_domain_confirmed: true,
                target_tab_confirmed: true,
                target_page_confirmed: true,
                risk_state_checked: true,
                action_type_confirmed: true
              }
            }
          }),
          cwd: "/workspace/WebEnvoy"
        },
        timeout_ms: 100
      });
      await Promise.resolve();
      await Promise.resolve();

      expect(approvedChromeApi.tabs.sendMessage).not.toHaveBeenCalled();
      expect(runtimeMessageListeners).toHaveLength(1);

      const approved = approvedPort.postMessage.mock.calls
        .map((call) => call[0] as { id?: string; status?: string; payload?: { summary?: Record<string, unknown> } })
        .find((message) => message.id === `run-xhs-issue-208-${state}-approved-001`);
      expect(approved?.status).toBe("error");
      const payload = asRecord(approved?.payload) ?? {};
      const approvedConsumerGateResult = asRecord(payload.consumer_gate_result);
      const writeGateOnlyDecision = asRecord(payload.write_gate_only_decision);
      expect(approvedConsumerGateResult?.gate_decision).toBe("blocked");
      expect(payload.write_action_matrix).toBeUndefined();
      expect(writeGateOnlyDecision?.execution_enabled).toBe(false);
    }
  });

  it("blocks live mode when fingerprint_context.execution.live_allowed=false", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();
    const fingerprintContext = createFingerprintRuntimeContext({
      live_allowed: false,
      live_decision: "dry_run_only",
      allowed_execution_modes: ["dry_run", "recon"],
      reason_codes: ["PROFILE_FIELD_MISSING"]
    });
    await primeTrustedFingerprintContext({
      runtimeMessageListeners,
      runId: "run-xhs-live-blocked-by-fingerprint-001",
      profile: "profile-a",
      fingerprintContext
    });
    chromeApi.tabs.sendMessage.mockClear();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-live-blocked-by-fingerprint-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-live-blocked-by-fingerprint-001",
        command: "xhs.search",
        command_params: createRequestBoundXhsCommandParams({
          runId: "run-xhs-live-blocked-by-fingerprint-001",
          requestId: "run-xhs-live-blocked-by-fingerprint-001",
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          approval_record: createApprovedReadApprovalRecord(),
          fingerprint_context: fingerprintContext
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
    const blocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: Record<string, unknown> })
      .find((message) => message.id === "run-xhs-live-blocked-by-fingerprint-001");
    expect(blocked?.status).toBe("error");
    const payload = asRecord(blocked?.payload) ?? {};
    const gateOutcome = asRecord(payload.gate_outcome);
    const consumerGateResult = asRecord(payload.consumer_gate_result);
    expect(gateOutcome?.effective_execution_mode).toBe("dry_run");
    expect(consumerGateResult?.gate_decision).toBe("blocked");
    expect(consumerGateResult?.fingerprint_gate_decision).toBe("blocked");
    expect(consumerGateResult?.fingerprint_reason_codes).toEqual(["PROFILE_FIELD_MISSING"]);
    expect(consumerGateResult?.gate_reasons).toEqual(
      expect.arrayContaining(["FINGERPRINT_EXECUTION_BLOCKED"])
    );
  });

  it("blocks live mode when fingerprint_context.execution.live_decision=dry_run_only", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();
    const fingerprintContext = createFingerprintRuntimeContext({
      live_allowed: true,
      live_decision: "dry_run_only",
      allowed_execution_modes: ["dry_run", "recon"],
      reason_codes: ["OS_FAMILY_MISMATCH"]
    });
    await primeTrustedFingerprintContext({
      runtimeMessageListeners,
      runId: "run-xhs-live-blocked-by-fingerprint-002",
      profile: "profile-a",
      fingerprintContext
    });
    chromeApi.tabs.sendMessage.mockClear();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-live-blocked-by-fingerprint-002",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-live-blocked-by-fingerprint-002",
        command: "xhs.search",
        command_params: createRequestBoundXhsCommandParams({
          runId: "run-xhs-live-blocked-by-fingerprint-002",
          requestId: "run-xhs-live-blocked-by-fingerprint-002",
          requested_execution_mode: "live_read_limited",
          risk_state: "limited",
          approval_record: createApprovedReadApprovalRecord(),
          audit_record: createApprovedReadAuditRecordForRequest({
            runId: "run-xhs-live-blocked-by-fingerprint-002",
            requestId: "run-xhs-live-blocked-by-fingerprint-002"
          }),
          fingerprint_context: fingerprintContext
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
    const blocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: Record<string, unknown> })
      .find((message) => message.id === "run-xhs-live-blocked-by-fingerprint-002");
    expect(blocked?.status).toBe("error");
    const payload = asRecord(blocked?.payload) ?? {};
    const gateOutcome = asRecord(payload.gate_outcome);
    const consumerGateResult = asRecord(payload.consumer_gate_result);
    expect(gateOutcome?.effective_execution_mode).toBe("recon");
    expect(consumerGateResult?.gate_decision).toBe("blocked");
    expect(consumerGateResult?.fingerprint_gate_decision).toBe("blocked");
    expect(consumerGateResult?.fingerprint_reason_codes).toEqual(["OS_FAMILY_MISMATCH"]);
    expect(consumerGateResult?.gate_reasons).toEqual(
      expect.arrayContaining(["FINGERPRINT_EXECUTION_BLOCKED"])
    );
  });

  it("blocks live mode when fingerprint_context is missing", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-live-blocked-by-fingerprint-003",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-live-blocked-by-fingerprint-003",
        command: "xhs.search",
        command_params: createRequestBoundXhsCommandParams({
          runId: "run-xhs-live-blocked-by-fingerprint-003",
          requestId: "run-xhs-live-blocked-by-fingerprint-003",
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          approval_record: createApprovedReadApprovalRecord()
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
    const blocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: Record<string, unknown> })
      .find((message) => message.id === "run-xhs-live-blocked-by-fingerprint-003");
    expect(blocked?.status).toBe("error");
    const payload = asRecord(blocked?.payload) ?? {};
    const gateOutcome = asRecord(payload.gate_outcome);
    const consumerGateResult = asRecord(payload.consumer_gate_result);
    expect(gateOutcome?.effective_execution_mode).toBe("dry_run");
    expect(payload.fingerprint_execution).toBeNull();
    expect(consumerGateResult?.gate_decision).toBe("blocked");
    expect(consumerGateResult?.fingerprint_gate_decision).toBe("blocked");
    expect(consumerGateResult?.fingerprint_reason_codes).toEqual(["FINGERPRINT_CONTEXT_MISSING"]);
    expect(consumerGateResult?.gate_reasons).toEqual(
      expect.arrayContaining(["FINGERPRINT_CONTEXT_MISSING", "FINGERPRINT_EXECUTION_BLOCKED"])
    );
  });

  it("blocks live mode when fingerprint_context exists but is not trusted for run/profile", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-live-blocked-by-fingerprint-untrusted-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-live-blocked-by-fingerprint-untrusted-001",
        command: "xhs.search",
        command_params: createRequestBoundXhsCommandParams({
          runId: "run-xhs-live-blocked-by-fingerprint-untrusted-001",
          requestId: "run-xhs-live-blocked-by-fingerprint-untrusted-001",
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          approval_record: createApprovedReadApprovalRecord(),
          fingerprint_context: createFingerprintRuntimeContext()
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
    const blocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: Record<string, unknown> })
      .find((message) => message.id === "run-xhs-live-blocked-by-fingerprint-untrusted-001");
    expect(blocked?.status).toBe("error");
    const payload = asRecord(blocked?.payload) ?? {};
    const consumerGateResult = asRecord(payload.consumer_gate_result);
    expect(payload.fingerprint_execution).toBeNull();
    expect(consumerGateResult?.fingerprint_gate_decision).toBe("blocked");
    expect(consumerGateResult?.fingerprint_reason_codes).toEqual(["FINGERPRINT_CONTEXT_UNTRUSTED"]);
    expect(consumerGateResult?.gate_reasons).toEqual(
      expect.arrayContaining(["FINGERPRINT_CONTEXT_UNTRUSTED", "FINGERPRINT_EXECUTION_BLOCKED"])
    );
  });

  it("rejects startup trust primed by non-allowlist sender tab", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    const fingerprintContext = createFingerprintRuntimeContext();
    await primeTrustedFingerprintContext({
      runtimeMessageListeners,
      runId: "run-xhs-live-untrusted-startup-tab-001",
      profile: "profile-a",
      fingerprintContext,
      tabId: 9,
      tabUrl: "https://example.com/"
    });
    chromeApi.tabs.sendMessage.mockClear();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-live-untrusted-startup-tab-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-live-untrusted-startup-tab-001",
        command: "xhs.search",
        command_params: createRequestBoundXhsCommandParams({
          runId: "run-xhs-live-untrusted-startup-tab-001",
          requestId: "run-xhs-live-untrusted-startup-tab-001",
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          approval_record: createApprovedReadApprovalRecord(),
          fingerprint_context: fingerprintContext
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
    const blocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: Record<string, unknown> })
      .find((message) => message.id === "run-xhs-live-untrusted-startup-tab-001");
    expect(blocked?.status).toBe("error");
    const payload = asRecord(blocked?.payload) ?? {};
    const consumerGateResult = asRecord(payload.consumer_gate_result);
    expect(consumerGateResult?.fingerprint_gate_decision).toBe("blocked");
    expect(consumerGateResult?.fingerprint_reason_codes).toEqual(["FINGERPRINT_CONTEXT_UNTRUSTED"]);
    expect(consumerGateResult?.gate_reasons).toEqual(
      expect.arrayContaining(["FINGERPRINT_CONTEXT_UNTRUSTED", "FINGERPRINT_EXECUTION_BLOCKED"])
    );
  });

  it("allows startup trust reuse across different run_id within the same session when trust remains bound", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    const startupRunId = "run-xhs-live-trusted-by-runtime-start-001";
    const liveRunId = "run-xhs-live-consume-startup-trust-002";
    const profile = "profile-a";
    const fingerprintContext = createFingerprintRuntimeContext({
      live_allowed: true,
      live_decision: "allowed",
      allowed_execution_modes: ["dry_run", "recon", "live_read_limited", "live_read_high_risk"],
      reason_codes: []
    });

    runtimeMessageListeners[0]?.(
      {
        kind: "result",
        id: `startup-fingerprint-trust:${startupRunId}`,
        ok: true,
        payload: {
          startup_fingerprint_trust: {
            run_id: startupRunId,
            profile,
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
          id: 32
        }
      }
    );
    await Promise.resolve();
    chromeApi.tabs.sendMessage.mockClear();

    const liveRequestId = `${liveRunId}-live`;
    firstPort.onMessageListeners[0]?.({
      id: liveRequestId,
      method: "bridge.forward",
      profile,
      params: {
        session_id: "nm-session-001",
        run_id: liveRunId,
        command: "xhs.search",
        command_params: createRequestBoundXhsCommandParams({
          runId: liveRunId,
          requestId: liveRequestId,
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          approval_record: createApprovedReadApprovalRecord(),
          fingerprint_context: fingerprintContext
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await waitForBridgeTurn();

    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(
      32,
      expect.objectContaining({
        id: liveRequestId,
        command: "xhs.search"
      })
    );
  });

  it("allows live xhs.search to reuse trusted fingerprint context when command fingerprint_context is omitted", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    const startupRunId = "run-xhs-live-trusted-omit-fingerprint-startup-001";
    const liveRunId = "run-xhs-live-trusted-omit-fingerprint-live-002";
    const profile = "profile-a";
    const fingerprintContext = createFingerprintRuntimeContext({
      live_allowed: true,
      live_decision: "allowed",
      allowed_execution_modes: ["dry_run", "recon", "live_read_limited", "live_read_high_risk"],
      reason_codes: []
    });

    runtimeMessageListeners[0]?.(
      {
        kind: "result",
        id: `startup-fingerprint-trust:${startupRunId}`,
        ok: true,
        payload: {
          startup_fingerprint_trust: {
            run_id: startupRunId,
            profile,
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
          id: 32
        }
      }
    );
    await Promise.resolve();
    chromeApi.tabs.sendMessage.mockClear();

    const liveRequestId = `${liveRunId}-live`;
    firstPort.onMessageListeners[0]?.({
      id: liveRequestId,
      method: "bridge.forward",
      profile,
      params: {
        session_id: "nm-session-001",
        run_id: liveRunId,
        command: "xhs.search",
        command_params: createRequestBoundXhsCommandParams({
          runId: liveRunId,
          requestId: liveRequestId,
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          approval_record: createApprovedReadApprovalRecord()
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await waitForBridgeTurn();

    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(
      32,
      expect.objectContaining({
        id: liveRequestId,
        command: "xhs.search"
      })
    );
  });

  it("upgrades dry_run xhs.search to the trusted injected fingerprint context", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    const startupRunId = "run-xhs-dry-trusted-upgrade-startup-001";
    const dryRunId = "run-xhs-dry-trusted-upgrade-dry-002";
    const profile = "profile-a";
    const fingerprintContext = createFingerprintRuntimeContext({
      live_allowed: true,
      live_decision: "allowed",
      allowed_execution_modes: ["dry_run", "recon", "live_read_limited", "live_read_high_risk"],
      reason_codes: []
    });

    await primeTrustedFingerprintContext({
      runtimeMessageListeners,
      runId: startupRunId,
      profile,
      fingerprintContext
    });
    chromeApi.tabs.sendMessage.mockClear();

    const dryRequestId = `${dryRunId}-request`;
    firstPort.onMessageListeners[0]?.({
      id: dryRequestId,
      method: "bridge.forward",
      profile,
      params: {
        session_id: "nm-session-001",
        run_id: dryRunId,
        command: "xhs.search",
        command_params: createRequestBoundXhsCommandParams({
          runId: dryRunId,
          requestId: dryRequestId,
          requested_execution_mode: "dry_run",
          risk_state: "paused",
          fingerprint_context: fingerprintContext
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await vi.waitFor(() => {
      expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(
        32,
        expect.objectContaining({
          id: dryRequestId,
          command: "xhs.search",
          fingerprintContext: expect.objectContaining({
            injection: expect.objectContaining({
              installed: true,
              missing_required_patches: []
            })
          })
        })
      );
    });
  });

  it("keeps target_tab_id existence as a hard gate even when trusted fingerprint context is bound", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => []);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    const startupRunId = "run-xhs-live-trusted-missing-tab-startup-001";
    const liveRunId = "run-xhs-live-trusted-missing-tab-live-002";
    const profile = "profile-a";
    const fingerprintContext = createFingerprintRuntimeContext({
      live_allowed: true,
      live_decision: "allowed",
      allowed_execution_modes: ["dry_run", "recon", "live_read_limited", "live_read_high_risk"],
      reason_codes: []
    });

    runtimeMessageListeners[0]?.(
      {
        kind: "result",
        id: `startup-fingerprint-trust:${startupRunId}`,
        ok: true,
        payload: {
          startup_fingerprint_trust: {
            run_id: startupRunId,
            profile,
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
          id: 32
        }
      }
    );
    await Promise.resolve();
    chromeApi.tabs.sendMessage.mockClear();

    const liveRequestId = `${liveRunId}-live`;
    firstPort.onMessageListeners[0]?.({
      id: liveRequestId,
      method: "bridge.forward",
      profile,
      params: {
        session_id: "nm-session-001",
        run_id: liveRunId,
        command: "xhs.search",
        command_params: createRequestBoundXhsCommandParams({
          runId: liveRunId,
          requestId: liveRunId,
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          approval_record: createApprovedReadApprovalRecord()
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
    const blocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: Record<string, unknown> })
      .find((message) => message.id === liveRequestId);
    expect(blocked?.status).toBe("error");
    const payload = asRecord(blocked?.payload) ?? {};
    const consumerGateResult = asRecord(payload.consumer_gate_result);
    expect(consumerGateResult?.gate_decision).toBe("blocked");
    expect(consumerGateResult?.gate_reasons).toEqual(
      expect.arrayContaining(["TARGET_TAB_NOT_FOUND"])
    );
  });

  it("does not establish trusted fingerprint context from runtime.ping", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    const profile = "profile-a";
    const pingRunId = "run-ping-no-trust-001";
    const liveRunId = "run-ping-no-trust-live-002";
    const fingerprintContext = createFingerprintRuntimeContext({
      live_allowed: true,
      live_decision: "allowed",
      allowed_execution_modes: ["dry_run", "recon", "live_read_limited", "live_read_high_risk"],
      reason_codes: []
    });

    firstPort.onMessageListeners[0]?.({
      id: pingRunId,
      method: "bridge.forward",
      profile,
      params: {
        session_id: "nm-session-001",
        run_id: pingRunId,
        command: "runtime.ping",
        command_params: {
          fingerprint_context: fingerprintContext
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    runtimeMessageListeners[0]?.(
      {
        kind: "result",
        id: pingRunId,
        ok: true,
        payload: {
          fingerprint_runtime: fingerprintContext,
          summary: {
            capability_result: {
              outcome: "success"
            }
          }
        }
      },
      {
        tab: {
          id: 32
        }
      }
    );
    await Promise.resolve();
    chromeApi.tabs.sendMessage.mockClear();

    firstPort.onMessageListeners[0]?.({
      id: liveRunId,
      method: "bridge.forward",
      profile,
      params: {
        session_id: "nm-session-001",
        run_id: liveRunId,
        command: "xhs.search",
        command_params: createRequestBoundXhsCommandParams({
          runId: liveRunId,
          requestId: liveRunId,
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          approval_record: createApprovedReadApprovalRecord(),
          fingerprint_context: fingerprintContext
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await waitForBridgeTurn();

    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
    const blocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: Record<string, unknown> })
      .find((message) => message.id === liveRunId);
    expect(blocked?.status).toBe("error");
    const payload = asRecord(blocked?.payload) ?? {};
    const consumerGateResult = asRecord(payload.consumer_gate_result);
    expect(consumerGateResult?.fingerprint_gate_decision).toBe("blocked");
    expect(consumerGateResult?.fingerprint_reason_codes).toEqual(["FINGERPRINT_CONTEXT_UNTRUSTED"]);
    expect(consumerGateResult?.gate_reasons).toEqual(
      expect.arrayContaining(["FINGERPRINT_CONTEXT_UNTRUSTED", "FINGERPRINT_EXECUTION_BLOCKED"])
    );
  });

  it("invalidates trusted fingerprint context after disconnect/recovery with new session", async () => {
    const firstPort = createMockPort();
    const secondPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort, secondPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);

    startChromeBackgroundBridge(chromeApi, {
      heartbeatIntervalMs: 10_000,
      recoveryRetryIntervalMs: 5,
      recoveryWindowMs: 100
    });
    respondHandshake(firstPort, {
      sessionId: "nm-session-001"
    });
    await Promise.resolve();

    const fingerprintContext = createFingerprintRuntimeContext();
    await primeTrustedFingerprintContext({
      runtimeMessageListeners,
      runId: "run-xhs-live-recovery-untrusted-001",
      profile: "profile-a",
      fingerprintContext
    });
    chromeApi.tabs.sendMessage.mockClear();

    firstPort.onDisconnectListeners[0]?.();
    await Promise.resolve();
    await Promise.resolve();

    respondHandshake(secondPort, {
      sessionId: "nm-session-002"
    });
    await Promise.resolve();

    await primeTrustedFingerprintContext({
      runtimeMessageListeners,
      runId: "run-xhs-live-recovery-untrusted-001",
      profile: "profile-a",
      fingerprintContext,
      sessionId: "nm-session-001"
    });

    secondPort.onMessageListeners[0]?.({
      id: "run-xhs-live-recovery-untrusted-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-002",
        run_id: "run-xhs-live-recovery-untrusted-001",
        command: "xhs.search",
        command_params: createRequestBoundXhsCommandParams({
          runId: "run-xhs-live-recovery-untrusted-001",
          sessionId: "nm-session-002",
          requestId: "run-xhs-live-recovery-untrusted-001",
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          approval_record: createApprovedReadApprovalRecord(),
          fingerprint_context: fingerprintContext
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
    const blocked = secondPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: Record<string, unknown> })
      .find((message) => message.id === "run-xhs-live-recovery-untrusted-001");
    expect(blocked?.status).toBe("error");
    const payload = asRecord(blocked?.payload) ?? {};
    const consumerGateResult = asRecord(payload.consumer_gate_result);
    expect(consumerGateResult?.fingerprint_gate_decision).toBe("blocked");
    expect(consumerGateResult?.fingerprint_reason_codes).toEqual(["FINGERPRINT_CONTEXT_UNTRUSTED"]);
    expect(consumerGateResult?.gate_reasons).toEqual(
      expect.arrayContaining(["FINGERPRINT_CONTEXT_UNTRUSTED", "FINGERPRINT_EXECUTION_BLOCKED"])
    );
  });

  it("requires re-attestation after disconnect/recovery even in the same session", async () => {
    const firstPort = createMockPort();
    const secondPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort, secondPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);

    startChromeBackgroundBridge(chromeApi, {
      heartbeatIntervalMs: 10_000,
      recoveryRetryIntervalMs: 5,
      recoveryWindowMs: 100
    });
    respondHandshake(firstPort, {
      sessionId: "nm-session-001"
    });
    await Promise.resolve();

    const profile = "profile-a";
    const startupRunId = "run-xhs-live-recovery-keep-trust-startup-001";
    const liveRunId = "run-xhs-live-recovery-keep-trust-live-002";
    const fingerprintContext = createFingerprintRuntimeContext();
    await primeTrustedFingerprintContext({
      runtimeMessageListeners,
      runId: startupRunId,
      profile,
      fingerprintContext,
      sessionId: "nm-session-001"
    });
    chromeApi.tabs.sendMessage.mockClear();

    firstPort.onDisconnectListeners[0]?.();
    await Promise.resolve();
    await Promise.resolve();

    respondHandshake(secondPort, {
      sessionId: "nm-session-001"
    });
    await Promise.resolve();

    const firstAttemptId = `${liveRunId}-blocked-before-reprime`;
    secondPort.onMessageListeners[0]?.({
      id: firstAttemptId,
      method: "bridge.forward",
      profile,
      params: {
        session_id: "nm-session-001",
        run_id: liveRunId,
        command: "xhs.search",
        command_params: createRequestBoundXhsCommandParams({
          runId: liveRunId,
          requestId: firstAttemptId,
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          approval_record: createApprovedReadApprovalRecord(),
          fingerprint_context: fingerprintContext
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    const blockedDispatch = chromeApi.tabs.sendMessage.mock.calls.find(
      (call) => (call[1] as { id?: string } | undefined)?.id === firstAttemptId
    );
    expect(blockedDispatch).toBeUndefined();

    const blocked = secondPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: Record<string, unknown> })
      .find((message) => message.id === firstAttemptId);
    expect(blocked?.status).toBe("error");
    const blockedPayload = asRecord(blocked?.payload) ?? {};
    const blockedConsumerGateResult = asRecord(blockedPayload.consumer_gate_result);
    expect(blockedConsumerGateResult?.fingerprint_gate_decision).toBe("blocked");
    expect(blockedConsumerGateResult?.fingerprint_reason_codes).toEqual([
      "FINGERPRINT_CONTEXT_UNTRUSTED"
    ]);

    await primeTrustedFingerprintContext({
      runtimeMessageListeners,
      runId: `${startupRunId}-reprime`,
      profile,
      fingerprintContext,
      sessionId: "nm-session-001"
    });
    chromeApi.tabs.sendMessage.mockClear();

    secondPort.onMessageListeners[0]?.({
      id: liveRunId,
      method: "bridge.forward",
      profile,
      params: {
        session_id: "nm-session-001",
        run_id: liveRunId,
        command: "xhs.search",
        command_params: createRequestBoundXhsCommandParams({
          runId: liveRunId,
          requestId: liveRunId,
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          approval_record: createApprovedReadApprovalRecord(),
          fingerprint_context: fingerprintContext
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await waitForBridgeTurn();

    const liveDispatch = chromeApi.tabs.sendMessage.mock.calls.find(
      (call) => (call[1] as { id?: string } | undefined)?.id === liveRunId
    );
    expect(liveDispatch).toBeDefined();

    runtimeMessageListeners[0]?.(
      {
        kind: "result",
        id: liveRunId,
        ok: true,
        payload: {
          summary: {
            capability_result: {
              outcome: "success"
            }
          }
        }
      },
      {
        tab: {
          id: 32
        }
      }
    );
    await Promise.resolve();

    const allowed = secondPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string })
      .find((message) => message.id === liveRunId);
    expect(allowed?.status).toBe("success");
  });

  it("does not reuse startup trust across new run_id in the same session for live xhs.search", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort, {
      sessionId: "nm-session-001"
    });
    await Promise.resolve();

    const startupRunId = "run-startup-trust-001";
    const liveRunId = "run-live-followup-002";
    const profile = "profile-a";
    const fingerprintContext = createFingerprintRuntimeContext();
    await primeTrustedFingerprintContext({
      runtimeMessageListeners,
      runId: startupRunId,
      profile,
      fingerprintContext,
      tabId: 32,
      tabUrl: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article"
    });
    chromeApi.tabs.sendMessage.mockClear();

    firstPort.onMessageListeners[0]?.({
      id: liveRunId,
      method: "bridge.forward",
      profile,
      params: {
        session_id: "nm-session-001",
        run_id: liveRunId,
        command: "xhs.search",
        command_params: createRequestBoundXhsCommandParams({
          runId: liveRunId,
          requestId: liveRunId,
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          approval_record: createApprovedReadApprovalRecord(),
          fingerprint_context: fingerprintContext
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    const liveDispatch = chromeApi.tabs.sendMessage.mock.calls.find(
      (call) => (call[1] as { id?: string } | undefined)?.id === liveRunId
    );
    expect(liveDispatch).toBeUndefined();

    const blocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: Record<string, unknown> })
      .find((message) => message.id === liveRunId);
    expect(blocked?.status).toBe("error");
    const payload = asRecord(blocked?.payload) ?? {};
    const consumerGateResult = asRecord(payload.consumer_gate_result);
    expect(consumerGateResult?.fingerprint_gate_decision).toBe("blocked");
    expect(consumerGateResult?.fingerprint_reason_codes).toEqual(["FINGERPRINT_CONTEXT_UNTRUSTED"]);
  });

  it("invalidates trusted fingerprint context after runtime.stop for same profile::session", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    const runId = "run-xhs-live-stop-untrusted-001";
    const profile = "profile-a";
    const fingerprintContext = createFingerprintRuntimeContext();
    await primeTrustedFingerprintContext({
      runtimeMessageListeners,
      runId,
      profile,
      fingerprintContext
    });
    chromeApi.tabs.sendMessage.mockClear();

    const stopRequestId = `${runId}-stop`;
    firstPort.onMessageListeners[0]?.({
      id: stopRequestId,
      method: "bridge.forward",
      profile,
      params: {
        session_id: "nm-session-001",
        run_id: runId,
        command: "runtime.stop",
        command_params: {},
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    runtimeMessageListeners[0]?.(
      {
        kind: "result",
        id: stopRequestId,
        ok: true,
        payload: {
          message: "stopped",
          run_id: runId,
          profile
        }
      },
      {
        tab: {
          id: 32
        }
      }
    );
    await Promise.resolve();

    const stopDispatch = chromeApi.tabs.sendMessage.mock.calls.find(
      (call) => (call[1] as { id?: string } | undefined)?.id === stopRequestId
    );
    expect(stopDispatch).toBeDefined();

    const liveRunId = `${runId}-after-stop`;
    const liveRequestId = `${liveRunId}-live-after-stop`;
    firstPort.onMessageListeners[0]?.({
      id: liveRequestId,
      method: "bridge.forward",
      profile,
      params: {
        session_id: "nm-session-001",
        run_id: liveRunId,
        command: "xhs.search",
        command_params: createRequestBoundXhsCommandParams({
          runId: liveRunId,
          requestId: liveRequestId,
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          approval_record: createApprovedReadApprovalRecord(),
          fingerprint_context: fingerprintContext
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    const liveDispatch = chromeApi.tabs.sendMessage.mock.calls.find(
      (call) => (call[1] as { id?: string } | undefined)?.id === liveRequestId
    );
    expect(liveDispatch).toBeUndefined();

    const blocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: Record<string, unknown> })
      .find((message) => message.id === liveRequestId);
    expect(blocked?.status).toBe("error");
    const payload = asRecord(blocked?.payload) ?? {};
    const consumerGateResult = asRecord(payload.consumer_gate_result);
    expect(consumerGateResult?.fingerprint_gate_decision).toBe("blocked");
    expect(consumerGateResult?.fingerprint_reason_codes).toEqual(["FINGERPRINT_CONTEXT_UNTRUSTED"]);
    expect(consumerGateResult?.gate_reasons).toEqual(
      expect.arrayContaining(["FINGERPRINT_CONTEXT_UNTRUSTED", "FINGERPRINT_EXECUTION_BLOCKED"])
    );
  });

  it("rotates trusted fingerprint context when startup trust overwrites same profile::session", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    const runId = "run-xhs-live-trust-rotate-001";
    const profile = "profile-a";
    const trustedAllowed = createFingerprintRuntimeContext({
      live_allowed: true,
      live_decision: "allowed",
      allowed_execution_modes: ["dry_run", "recon", "live_read_limited", "live_read_high_risk"],
      reason_codes: []
    });
    const trustedBlocked = createFingerprintRuntimeContext({
      live_allowed: false,
      live_decision: "dry_run_only",
      allowed_execution_modes: ["dry_run", "recon"],
      reason_codes: ["PROFILE_FIELD_MISSING"]
    });

    await primeTrustedFingerprintContext({
      runtimeMessageListeners,
      runId,
      profile,
      fingerprintContext: trustedAllowed
    });
    await primeTrustedFingerprintContext({
      runtimeMessageListeners,
      runId,
      profile,
      fingerprintContext: trustedBlocked
    });
    chromeApi.tabs.sendMessage.mockClear();

    firstPort.onMessageListeners[0]?.({
      id: runId,
      method: "bridge.forward",
      profile,
      params: {
        session_id: "nm-session-001",
        run_id: runId,
        command: "xhs.search",
        command_params: createRequestBoundXhsCommandParams({
          runId: runId,
          requestId: runId,
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          approval_record: createApprovedReadApprovalRecord(),
          fingerprint_context: trustedBlocked
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
    const blocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: Record<string, unknown> })
      .find((message) => message.id === runId);
    expect(blocked?.status).toBe("error");
    const payload = asRecord(blocked?.payload) ?? {};
    const consumerGateResult = asRecord(payload.consumer_gate_result);
    expect(consumerGateResult?.fingerprint_gate_decision).toBe("blocked");
    expect(consumerGateResult?.fingerprint_reason_codes).toEqual(["PROFILE_FIELD_MISSING"]);
    expect(consumerGateResult?.gate_reasons).toEqual(
      expect.arrayContaining(["FINGERPRINT_EXECUTION_BLOCKED"])
    );
  });

  it("invalidates trust when live request fingerprint_context changes without re-prime", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    const runId = "run-xhs-live-context-drift-001";
    const profile = "profile-a";
    const trustedContext = createFingerprintRuntimeContext();
    const driftedContext = createFingerprintRuntimeContext({
      live_allowed: false,
      live_decision: "dry_run_only",
      allowed_execution_modes: ["dry_run", "recon"],
      reason_codes: ["OS_FAMILY_MISMATCH"]
    });

    await primeTrustedFingerprintContext({
      runtimeMessageListeners,
      runId,
      profile,
      fingerprintContext: trustedContext
    });
    chromeApi.tabs.sendMessage.mockClear();

    firstPort.onMessageListeners[0]?.({
      id: `${runId}-drifted`,
      method: "bridge.forward",
      profile,
      params: {
        session_id: "nm-session-001",
        run_id: runId,
        command: "xhs.search",
        command_params: createRequestBoundXhsCommandParams({
          runId: runId,
          requestId: `${runId}-drifted`,
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          approval_record: createApprovedReadApprovalRecord(),
          fingerprint_context: driftedContext
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
    const firstBlocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: Record<string, unknown> })
      .find((message) => message.id === `${runId}-drifted`);
    const firstPayload = asRecord(firstBlocked?.payload) ?? {};
    const firstConsumerGateResult = asRecord(firstPayload.consumer_gate_result);
    expect(firstConsumerGateResult?.fingerprint_reason_codes).toEqual(["FINGERPRINT_CONTEXT_UNTRUSTED"]);

    firstPort.onMessageListeners[0]?.({
      id: `${runId}-after-invalidation`,
      method: "bridge.forward",
      profile,
      params: {
        session_id: "nm-session-001",
        run_id: runId,
        command: "xhs.search",
        command_params: createRequestBoundXhsCommandParams({
          runId: runId,
          requestId: `${runId}-after-invalidation`,
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          approval_record: createApprovedReadApprovalRecord(),
          fingerprint_context: trustedContext
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    const secondBlocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: Record<string, unknown> })
      .find((message) => message.id === `${runId}-after-invalidation`);
    expect(secondBlocked?.status).toBe("error");
    const secondPayload = asRecord(secondBlocked?.payload) ?? {};
    const secondConsumerGateResult = asRecord(secondPayload.consumer_gate_result);
    expect(secondConsumerGateResult?.fingerprint_reason_codes).toEqual(["FINGERPRINT_CONTEXT_UNTRUSTED"]);
    expect(secondConsumerGateResult?.gate_reasons).toEqual(
      expect.arrayContaining(["FINGERPRINT_CONTEXT_UNTRUSTED", "FINGERPRINT_EXECUTION_BLOCKED"])
    );
  });

  it("forwards top-level requested_execution_mode live path and relays required-patch missing block", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    const fingerprintContext = createFingerprintRuntimeContext();
    fingerprintContext.fingerprint_patch_manifest.required_patches.push("unknown_required_patch");
    await primeTrustedFingerprintContext({
      runtimeMessageListeners,
      runId: "run-xhs-live-top-level-patch-missing-001",
      profile: "profile-a",
      fingerprintContext
    });

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-live-top-level-patch-missing-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-live-top-level-patch-missing-001",
        command: "xhs.search",
        command_params: createRequestBoundXhsCommandParams({
          runId: "run-xhs-live-top-level-patch-missing-001",
          requestId: "run-xhs-live-top-level-patch-missing-001",
          requested_execution_mode: "live_read_limited",
          risk_state: "limited",
          approval_record: createApprovedReadApprovalRecord(),
          audit_record: createApprovedReadAuditRecordForRequest({
            runId: "run-xhs-live-top-level-patch-missing-001",
            requestId: "run-xhs-live-top-level-patch-missing-001"
          }),
          fingerprint_context: fingerprintContext
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await waitForBridgeTurn();

    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(
      32,
      expect.objectContaining({
        id: "run-xhs-live-top-level-patch-missing-001",
        command: "xhs.search",
        commandParams: expect.objectContaining({
          requested_execution_mode: "live_read_limited"
        })
      })
    );

    runtimeMessageListeners[0]?.(
      {
        kind: "result",
        id: "run-xhs-live-top-level-patch-missing-001",
        ok: false,
        error: {
          code: "ERR_EXECUTION_FAILED",
          message: "fingerprint required patches missing for live execution"
        },
        payload: {
          details: {
            stage: "execution",
            reason: "FINGERPRINT_REQUIRED_PATCH_MISSING",
            requested_execution_mode: "live_read_limited",
            missing_required_patches: ["unknown_required_patch"]
          },
          gate_outcome: {
            gate_decision: "allowed",
            gate_reasons: ["LIVE_MODE_APPROVED"],
            fingerprint_gate_decision: "allowed"
          },
          consumer_gate_result: {
            gate_decision: "allowed",
            gate_reasons: ["LIVE_MODE_APPROVED"],
            fingerprint_gate_decision: "allowed",
            fingerprint_reason_codes: []
          },
          fingerprint_execution: {
            live_allowed: true,
            live_decision: "allowed",
            allowed_execution_modes: ["live_read_limited"],
            reason_codes: []
          },
          audit_record: {
            gate_decision: "allowed",
            gate_reasons: ["LIVE_MODE_APPROVED"]
          },
          fingerprint_runtime: {
            ...fingerprintContext,
            injection: {
              installed: false,
              required_patches: fingerprintContext.fingerprint_patch_manifest.required_patches,
              missing_required_patches: ["unknown_required_patch"]
            }
          }
        }
      },
      {
        tab: {
          id: 32
        }
      }
    );
    await Promise.resolve();

    const blocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: Record<string, unknown> })
      .find((message) => message.id === "run-xhs-live-top-level-patch-missing-001");
    expect(blocked).toMatchObject({
      id: "run-xhs-live-top-level-patch-missing-001",
      status: "error",
      payload: {
        details: {
          stage: "execution",
          reason: "FINGERPRINT_REQUIRED_PATCH_MISSING",
          requested_execution_mode: "live_read_limited"
        },
        fingerprint_runtime: {
          injection: {
            installed: false,
            missing_required_patches: ["unknown_required_patch"]
          }
        }
      }
    });
    const blockedPayload = asRecord(blocked?.payload) ?? {};
    const gateOutcome = asRecord(blockedPayload.gate_outcome);
    const consumerGateResult = asRecord(blockedPayload.consumer_gate_result);
    const fingerprintExecution = asRecord(blockedPayload.fingerprint_execution);
    const auditRecord = asRecord(blockedPayload.audit_record);
    const gateOutcomeExecutionFailure = asRecord(gateOutcome?.execution_failure);
    const consumerGateExecutionFailure = asRecord(consumerGateResult?.execution_failure);
    const fingerprintExecutionFailure = asRecord(fingerprintExecution?.execution_failure);
    const auditExecutionFailure = asRecord(auditRecord?.execution_failure);
    expect(gateOutcome?.gate_decision).toBe("blocked");
    expect(gateOutcome?.fingerprint_gate_decision).toBe("blocked");
    expect(gateOutcome?.gate_reasons).toEqual(
      expect.arrayContaining(["FINGERPRINT_REQUIRED_PATCH_MISSING"])
    );
    expect(gateOutcomeExecutionFailure).toMatchObject({
      stage: "execution",
      reason: "FINGERPRINT_REQUIRED_PATCH_MISSING",
      requested_execution_mode: "live_read_limited",
      missing_required_patches: ["unknown_required_patch"]
    });
    expect(consumerGateResult?.gate_decision).toBe("blocked");
    expect(consumerGateResult?.fingerprint_gate_decision).toBe("blocked");
    expect(consumerGateResult?.fingerprint_reason_codes).toEqual(
      expect.arrayContaining(["FINGERPRINT_REQUIRED_PATCH_MISSING"])
    );
    expect(consumerGateExecutionFailure).toMatchObject({
      stage: "execution",
      reason: "FINGERPRINT_REQUIRED_PATCH_MISSING",
      requested_execution_mode: "live_read_limited",
      missing_required_patches: ["unknown_required_patch"]
    });
    expect(fingerprintExecution?.live_allowed).toBe(false);
    expect(fingerprintExecution?.live_decision).toBe("dry_run_only");
    expect(fingerprintExecution?.allowed_execution_modes).toEqual(
      expect.arrayContaining(["dry_run", "recon"])
    );
    expect(fingerprintExecution?.reason_codes).toEqual(
      expect.arrayContaining(["FINGERPRINT_REQUIRED_PATCH_MISSING"])
    );
    expect(fingerprintExecution?.missing_required_patches).toEqual(["unknown_required_patch"]);
    expect(fingerprintExecutionFailure).toMatchObject({
      stage: "execution",
      reason: "FINGERPRINT_REQUIRED_PATCH_MISSING",
      requested_execution_mode: "live_read_limited",
      missing_required_patches: ["unknown_required_patch"]
    });
    expect(auditRecord?.gate_decision).toBe("blocked");
    expect(auditRecord?.gate_reasons).toEqual(
      expect.arrayContaining(["FINGERPRINT_REQUIRED_PATCH_MISSING"])
    );
    expect(auditExecutionFailure).toMatchObject({
      stage: "execution",
      reason: "FINGERPRINT_REQUIRED_PATCH_MISSING",
      requested_execution_mode: "live_read_limited",
      missing_required_patches: ["unknown_required_patch"]
    });
  });

  it("blocks issue_208 live_write on non-live fallback even when approval is complete", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://creator.xiaohongshu.com/publish/publish", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-issue-208-live-write-gate-only-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-issue-208-live-write-gate-only-001",
        command: "xhs.search",
        command_params: createXhsCommandParams({
          issue_scope: "issue_208",
          target_domain: "creator.xiaohongshu.com",
          target_page: "creator_publish_tab",
          action_type: "write",
          requested_execution_mode: "live_write",
          risk_state: "allowed",
          approval_record: {
            approved: true,
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:00Z",
            checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            }
          }
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
    const approved = firstPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: { summary?: Record<string, unknown> } })
      .find((message) => message.id === "run-xhs-issue-208-live-write-gate-only-001");
    expect(approved?.status).toBe("error");
    const payload = asRecord(approved?.payload) ?? {};
    const gateInput = asRecord(payload.gate_input);
    const gateOutcome = asRecord(payload.gate_outcome);
    const consumerGateResult = asRecord(payload.consumer_gate_result);
    const auditRecord = asRecord(payload.audit_record);
    expect(gateInput?.requested_execution_mode).toBe("live_write");
    expect(gateOutcome?.effective_execution_mode).toBe("dry_run");
    expect(consumerGateResult?.requested_execution_mode).toBe("live_write");
    expect(consumerGateResult?.effective_execution_mode).toBe("dry_run");
    expect(consumerGateResult?.gate_reasons).toEqual(
      expect.arrayContaining([
        "EXECUTION_MODE_UNSUPPORTED_FOR_COMMAND",
        "WRITE_INTERACTION_TIER_REVERSIBLE_INTERACTION"
      ])
    );
    expect(auditRecord?.requested_execution_mode).toBe("live_write");
    expect(auditRecord?.effective_execution_mode).toBe("dry_run");
    expect(payload.write_interaction_tier).toMatchObject({
      tiers: [
        { name: "observe_only", live_allowed: false },
        { name: "reversible_interaction", live_allowed: "limited" },
        { name: "irreversible_write", live_allowed: false }
      ],
      synthetic_event_default: "blocked",
      upload_injection_default: "blocked"
    });
  });

  it("forwards issue_208 live_write with editor_input validation through the real background bridge", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners, executeScript } = createChromeApi([firstPort]);
    let probeCall = 0;
    executeScript.mockImplementation(
      async (
        input:
          | { world?: "MAIN" | "ISOLATED"; files?: string[] }
          | { world?: "MAIN" | "ISOLATED"; func?: (...args: unknown[]) => unknown }
      ) => {
        if (input.world === "ISOLATED" && "func" in input) {
          probeCall += 1;
          return [
            {
              result: {
                entryButton: {
                  locator: "button.新的创作",
                  targetKey: "body > button:nth-of-type(1)",
                  centerX: 100,
                  centerY: 100
                },
                editor: {
                  locator: "div.tiptap.ProseMirror",
                  targetKey: "body > div:nth-of-type(1)",
                  centerX: 200,
                  centerY: 220
                },
                editorFocused: probeCall >= 2
              }
            }
          ];
        }
        return [{ result: { "X-s": "signed", "X-t": "1700000000" } }];
      }
    );
    chromeApi.tabs.query.mockImplementation(async () => [
      {
        id: 32,
        url: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article",
        active: true
      }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();
    await primeTrustedFingerprintContext({
      runtimeMessageListeners,
      runId: "run-xhs-issue-208-editor-input-allowed-001",
      profile: "profile-a",
      fingerprintContext: createFingerprintRuntimeContext({
        live_allowed: true,
        live_decision: "allowed",
        allowed_execution_modes: [
          "dry_run",
          "recon",
          "live_read_limited",
          "live_read_high_risk",
          "live_write"
        ]
      }),
      tabId: 32,
      tabUrl: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article"
    });

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-issue-208-editor-input-allowed-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-issue-208-editor-input-allowed-001",
        command: "xhs.search",
        command_params: createXhsEditorInputCommandParams(),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await waitForBridgeTurn();
    await vi.waitFor(() => {
      expect(chromeApi.tabs.sendMessage).toHaveBeenCalled();
    });

    const proactiveContentScriptInject = executeScript.mock.calls.find(
      (call) =>
        (call[0] as { world?: string; files?: string[] }).world === "ISOLATED" &&
        ((call[0] as { files?: string[] }).files ?? []).includes("build/content-script.js")
    );
    expect(proactiveContentScriptInject).toBeUndefined();
    await vi.waitFor(() => {
      expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(
        32,
        expect.objectContaining({
          command: "xhs.search",
          commandParams: expect.objectContaining({
            options: expect.objectContaining({
              editor_focus_attestation: expect.objectContaining({
                source: "chrome_debugger",
                target_tab_id: 32,
                focus_confirmed: true,
                editor_locator: "div.tiptap.ProseMirror",
                editor_target_key: "body > div:nth-of-type(1)"
              })
            })
          })
        })
      );
    });

    runtimeMessageListeners[0]?.(
      {
        kind: "result",
        id: "run-xhs-issue-208-editor-input-allowed-001",
        ok: true,
        payload: {
          summary: {
            capability_result: {
              outcome: "success",
              action: "write"
            },
            gate_outcome: {
              gate_decision: "allowed",
              effective_execution_mode: "live_write"
            },
            consumer_gate_result: {
              requested_execution_mode: "live_write",
              effective_execution_mode: "live_write",
              gate_decision: "allowed",
              gate_reasons: [
                "WRITE_INTERACTION_APPROVED",
                "ISSUE_208_EDITOR_INPUT_VALIDATION_APPROVED"
              ]
            },
            interaction_result: {
              validation_action: "editor_input",
              target_page: "creator.xiaohongshu.com/publish",
              validation_attestation: "controlled_real_interaction",
              success_signals: [
                "editable_state_entered",
                "editor_focus_attested",
                "text_visible",
                "text_persisted_after_blur"
              ],
              failure_signals: [],
              minimum_replay: [
                "enter_editable_mode",
                "focus_editor",
                "type_short_text",
                "blur_or_reobserve"
              ],
              out_of_scope_actions: ["image_upload", "submit", "publish_confirm"]
            }
          }
        }
      },
      {
        tab: {
          id: 32,
          url: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article"
        }
      }
    );
    await Promise.resolve();

    const approved = firstPort.postMessage.mock.calls
      .map(
        (call) =>
          call[0] as {
            id?: string;
            status?: string;
            error?: { code?: string; message?: string };
          }
      )
      .find((message) => message.id === "run-xhs-issue-208-editor-input-allowed-001");
    expect(approved?.status).toBe("success");
    expect(approved).toMatchObject({
      id: "run-xhs-issue-208-editor-input-allowed-001",
      payload: {
        summary: {
          capability_result: {
            outcome: "success",
            action: "write"
          },
          gate_outcome: {
            gate_decision: "allowed",
            effective_execution_mode: "live_write"
          },
          consumer_gate_result: {
            requested_execution_mode: "live_write",
            effective_execution_mode: "live_write",
            gate_decision: "allowed"
          },
          interaction_result: {
            validation_attestation: "controlled_real_interaction",
            success_signals: expect.arrayContaining(["editor_focus_attested"])
          }
        }
      }
    });
  });

  it("attests the active editor target when multiple editor candidates match", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners, executeScript } = createChromeApi([firstPort]);
    let probeCall = 0;
    executeScript.mockImplementation(
      async (
        input:
          | { world?: "MAIN" | "ISOLATED"; files?: string[] }
          | { world?: "MAIN" | "ISOLATED"; func?: (...args: unknown[]) => unknown; args?: unknown[] }
      ) => {
        if (input.world === "ISOLATED" && "func" in input && typeof input.func === "function") {
          probeCall += 1;
          return [
            {
              result: {
                entryButton: {
                  locator: "button.新的创作",
                  targetKey: "body > button:nth-of-type(1)",
                  centerX: 100,
                  centerY: 100
                },
                editor: {
                  locator: "div.tiptap.ProseMirror",
                  targetKey: "body > div:nth-of-type(2)",
                  centerX: 360,
                  centerY: 220
                },
                editorFocused: probeCall >= 2
              }
            }
          ];
        }
        return [{ result: { "X-s": "signed", "X-t": "1700000000" } }];
      }
    );
    chromeApi.tabs.query.mockImplementation(async () => [
      {
        id: 32,
        url: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article",
        active: true
      }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();
    await primeTrustedFingerprintContext({
      runtimeMessageListeners,
      runId: "run-xhs-issue-208-editor-input-multi-editor-001",
      profile: "profile-a",
      fingerprintContext: createFingerprintRuntimeContext({
        live_allowed: true,
        live_decision: "allowed",
        allowed_execution_modes: [
          "dry_run",
          "recon",
          "live_read_limited",
          "live_read_high_risk",
          "live_write"
        ]
      }),
      tabId: 32,
      tabUrl: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article"
    });

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-issue-208-editor-input-multi-editor-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-issue-208-editor-input-multi-editor-001",
        command: "xhs.search",
        command_params: createXhsEditorInputCommandParams(),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await waitForBridgeTurn();

    await vi.waitFor(() => {
      expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(
        32,
        expect.objectContaining({
          commandParams: expect.objectContaining({
            options: expect.objectContaining({
              editor_focus_attestation: expect.objectContaining({
                source: "chrome_debugger",
                editor_locator: "div.tiptap.ProseMirror",
                editor_target_key: "body > div:nth-of-type(2)",
                focus_confirmed: true
              })
            })
          })
        })
      );
    });
  });

  it("annotates editor_input forward with debugger attach failure attestation", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners, debuggerAttach } = createChromeApi([firstPort]);
    debuggerAttach.mockRejectedValueOnce(new Error("debugger attach denied"));
    chromeApi.tabs.query.mockImplementation(async () => [
      {
        id: 32,
        url: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article",
        active: true
      }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();
    await primeTrustedFingerprintContext({
      runtimeMessageListeners,
      runId: "run-xhs-issue-208-editor-input-debugger-attach-failed-001",
      profile: "profile-a",
      fingerprintContext: createFingerprintRuntimeContext({
        live_allowed: true,
        live_decision: "allowed",
        allowed_execution_modes: [
          "dry_run",
          "recon",
          "live_read_limited",
          "live_read_high_risk",
          "live_write"
        ]
      }),
      tabId: 32,
      tabUrl: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article"
    });

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-issue-208-editor-input-debugger-attach-failed-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-issue-208-editor-input-debugger-attach-failed-001",
        command: "xhs.search",
        command_params: createXhsEditorInputCommandParams(),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await waitForBridgeTurn();

    const forwardCall = chromeApi.tabs.sendMessage.mock.calls.find(
      (call) =>
        (call[1] as { id?: string }).id ===
        "run-xhs-issue-208-editor-input-debugger-attach-failed-001"
    );
    expect(forwardCall).toBeDefined();
    const forwarded = (forwardCall?.[1] as { commandParams?: { options?: Record<string, unknown> } })
      .commandParams?.options;
    const attestation = asRecord(forwarded?.editor_focus_attestation);
    expect(attestation).toMatchObject({
      source: "chrome_debugger",
      target_tab_id: 32,
      focus_confirmed: false,
      editor_locator: "div.tiptap.ProseMirror",
      editor_target_key: "body > div:nth-of-type(1)",
      failure_reason: "DEBUGGER_ATTACH_FAILED"
    });
  });

  it("blocks issue_208 editor_input when explicit target_tab_id points at non-article publish page", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      {
        id: 32,
        url: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=image",
        active: true
      }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();
    await primeTrustedFingerprintContext({
      runtimeMessageListeners,
      runId: "run-xhs-issue-208-editor-input-non-article-001",
      profile: "profile-a",
      fingerprintContext: createFingerprintRuntimeContext({
        live_allowed: true,
        live_decision: "allowed",
        allowed_execution_modes: [
          "dry_run",
          "recon",
          "live_read_limited",
          "live_read_high_risk",
          "live_write"
        ]
      }),
      tabId: 32,
      tabUrl: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=image"
    });

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-issue-208-editor-input-non-article-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-issue-208-editor-input-non-article-001",
        command: "xhs.search",
        command_params: createXhsEditorInputCommandParams(),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await waitForBridgeTurn();

    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
    const blocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: { summary?: Record<string, unknown> } })
      .find((message) => message.id === "run-xhs-issue-208-editor-input-non-article-001");
    expect(blocked?.status).toBe("error");
    const payload = asRecord(blocked?.payload) ?? {};
    const consumerGateResult = asRecord(payload.consumer_gate_result);
    expect(consumerGateResult?.gate_decision).toBe("blocked");
    expect(consumerGateResult?.gate_reasons).toEqual(
      expect.arrayContaining([
        "TARGET_PAGE_ARTICLE_REQUIRED",
        "WRITE_INTERACTION_TIER_REVERSIBLE_INTERACTION"
      ])
    );
  });

  it("keeps issue_208 irreversible_write blocked and exposes irreversible write tier", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://creator.xiaohongshu.com/publish/publish", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-issue-208-irreversible-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-issue-208-irreversible-001",
        command: "xhs.search",
        command_params: createXhsCommandParams({
          issue_scope: "issue_208",
          target_domain: "creator.xiaohongshu.com",
          target_page: "creator_publish_tab",
          action_type: "irreversible_write",
          requested_execution_mode: "dry_run",
          risk_state: "allowed",
          approval_record: {
            approved: true,
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:00Z",
            checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            }
          }
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
    const blocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: Record<string, unknown> })
      .find((message) => message.id === "run-xhs-issue-208-irreversible-001");
    expect(blocked?.status).toBe("error");
    const payload = asRecord(blocked?.payload) ?? {};
    const consumerGateResult = asRecord(payload.consumer_gate_result);
    expect(consumerGateResult?.gate_decision).toBe("blocked");
    expect(resolveWriteInteractionTier(payload)).toBe("irreversible_write");
  });

  it("forwards approved live_read_limited through the real background bridge", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();
    await primeTrustedFingerprintContext({
      runtimeMessageListeners,
      runId: "run-xhs-live-limited-approved-001",
      profile: "profile-a",
      fingerprintContext: createFingerprintRuntimeContext()
    });

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-live-limited-approved-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-live-limited-approved-001",
        command: "xhs.search",
        command_params: createRequestBoundXhsCommandParams({
          runId: "run-xhs-live-limited-approved-001",
          requestId: "run-xhs-live-limited-approved-001",
          requested_execution_mode: "live_read_limited",
          risk_state: "limited",
          fingerprint_context: createFingerprintRuntimeContext(),
          approval_record: {
            approved: true,
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:00Z",
            checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            }
          },
          audit_record: createApprovedReadAuditRecordForRequest({
            runId: "run-xhs-live-limited-approved-001",
            requestId: "run-xhs-live-limited-approved-001"
          })
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await waitForBridgeTurn();

    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(
      32,
      expect.objectContaining({
        id: "run-xhs-live-limited-approved-001",
        command: "xhs.search"
      })
    );

    runtimeMessageListeners[0]?.(
      {
        kind: "result",
        id: "run-xhs-live-limited-approved-001",
        ok: true,
        payload: {
          summary: {
            capability_result: {
              outcome: "success",
              action: "read"
            },
            consumer_gate_result: {
              target_domain: "www.xiaohongshu.com",
              target_tab_id: 32,
              target_page: "search_result_tab",
              action_type: "read",
              requested_execution_mode: "live_read_limited",
              effective_execution_mode: "live_read_limited",
              gate_decision: "allowed",
              gate_reasons: ["LIVE_MODE_APPROVED"]
            }
          }
        }
      },
      {
        tab: {
          id: 32
        }
      }
    );
    await Promise.resolve();

    const approved = firstPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: { summary?: Record<string, unknown> } })
      .find((message) => message.id === "run-xhs-live-limited-approved-001");
    expect(approved).toMatchObject({
      id: "run-xhs-live-limited-approved-001",
      status: "success",
      payload: {
        summary: {
          capability_result: {
            outcome: "success",
            action: "read"
          },
          consumer_gate_result: {
            requested_execution_mode: "live_read_limited",
            effective_execution_mode: "live_read_limited",
            gate_decision: "allowed",
            gate_reasons: ["LIVE_MODE_APPROVED"]
          }
        }
      }
    });
  });

  it("forwards approved live_read_high_risk through the real background bridge", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();
    await primeTrustedFingerprintContext({
      runtimeMessageListeners,
      runId: "run-xhs-live-mode-approved-001",
      profile: "profile-a",
      fingerprintContext: createFingerprintRuntimeContext()
    });

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-live-mode-approved-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-live-mode-approved-001",
        command: "xhs.search",
        command_params: createRequestBoundXhsCommandParams({
          runId: "run-xhs-live-mode-approved-001",
          requestId: "run-xhs-live-mode-approved-001",
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          fingerprint_context: createFingerprintRuntimeContext(),
          approval_record: {
            approved: true,
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:00Z",
            checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            }
          }
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await waitForBridgeTurn();

    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(
      32,
      expect.objectContaining({
        id: "run-xhs-live-mode-approved-001",
        command: "xhs.search"
      })
    );

    runtimeMessageListeners[0]?.(
      {
        kind: "result",
        id: "run-xhs-live-mode-approved-001",
        ok: true,
        payload: {
          summary: {
            capability_result: {
              outcome: "success",
              action: "read"
            },
            consumer_gate_result: {
              target_domain: "www.xiaohongshu.com",
              target_tab_id: 32,
              target_page: "search_result_tab",
              action_type: "read",
              requested_execution_mode: "live_read_high_risk",
              effective_execution_mode: "live_read_high_risk",
              gate_decision: "allowed",
              gate_reasons: ["LIVE_MODE_APPROVED"]
            }
          }
        }
      },
      {
        tab: {
          id: 32
        }
      }
    );
    await Promise.resolve();

    const approved = firstPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: { summary?: Record<string, unknown> } })
      .find((message) => message.id === "run-xhs-live-mode-approved-001");
    expect(approved).toMatchObject({
      id: "run-xhs-live-mode-approved-001",
      status: "success",
      payload: {
        summary: {
          capability_result: {
            outcome: "success",
            action: "read"
          },
          consumer_gate_result: {
            requested_execution_mode: "live_read_high_risk",
            effective_execution_mode: "live_read_high_risk",
            gate_decision: "allowed",
            gate_reasons: ["LIVE_MODE_APPROVED"]
          }
        }
      }
    });
  });

  it("blocks xhs.search when target_domain is outside xhs read/write scope", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-invalid-domain-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-invalid-domain-001",
        command: "xhs.search",
        command_params: createXhsCommandParams({
          target_domain: "www.douyin.com"
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();

    const blocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: { consumer_gate_result?: { gate_reasons?: string[] } } })
      .find((message) => message.id === "run-xhs-invalid-domain-001");
    expect(blocked).toMatchObject({
      id: "run-xhs-invalid-domain-001",
      status: "error",
      payload: {
        consumer_gate_result: {
          gate_reasons: ["TARGET_DOMAIN_OUT_OF_SCOPE"]
        }
      }
    });
    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it("blocks xhs.search when read action targets write domain", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true },
      { id: 45, url: "https://creator.xiaohongshu.com/publish/publish", active: false }
    ]);

    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-read-write-domain-mismatch-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-read-write-domain-mismatch-001",
        command: "xhs.search",
        command_params: createXhsCommandParams({
          target_domain: "creator.xiaohongshu.com",
          target_tab_id: 45,
          target_page: "creator_publish_tab"
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();

    const blocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: { consumer_gate_result?: { gate_reasons?: string[] } } })
      .find((message) => message.id === "run-xhs-read-write-domain-mismatch-001");
    expect(blocked).toMatchObject({
      id: "run-xhs-read-write-domain-mismatch-001",
      status: "error",
      payload: {
        consumer_gate_result: {
          gate_reasons: ["ACTION_DOMAIN_MISMATCH"]
        }
      }
    });
    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it("forwards xhs.search only when explicit target tab/page/domain match", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: false },
      { id: 44, url: "https://www.xiaohongshu.com/home", active: true }
    ]);

    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-explicit-target-allow-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-explicit-target-allow-001",
        command: "xhs.search",
        command_params: createXhsCommandParams(),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await vi.waitFor(() => {
      expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(
        32,
        expect.objectContaining({
          id: "run-xhs-explicit-target-allow-001",
          command: "xhs.search"
        })
      );
    });
  });

  it("returns current runtime tabs through the native bridge diagnostics path", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async (query: { currentWindow?: boolean; url?: string | string[] }) => {
      expect(query).toEqual({
        currentWindow: true,
        url: ["https://creator.xiaohongshu.com/*"]
      });
      return [
        {
          id: 44,
          active: true,
          url: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article"
        }
      ];
    });

    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-runtime-tabs-001",
      method: "bridge.forward",
      profile: "xhs_208_probe",
      params: {
        session_id: "nm-session-001",
        run_id: "run-runtime-tabs-001",
        command: "runtime.tabs",
        command_params: {
          current_window_only: true,
          url_patterns: ["https://creator.xiaohongshu.com/*"]
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();

    expect(firstPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "run-runtime-tabs-001",
        status: "success",
        summary: expect.objectContaining({
          command: "runtime.tabs",
          relay_path: "host>background"
        }),
        payload: {
          tabs: [
            {
              tab_id: 44,
              active: true,
              url: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article"
            }
          ]
        },
        error: null
      })
    );
  });

  it("queues forwards during recovering and replays after reopen", async () => {
    vi.useFakeTimers();
    try {
      const ports = [createMockPort(), createMockPort()];
      const { chromeApi } = createChromeApi(ports);

      startChromeBackgroundBridge(chromeApi, {
        heartbeatIntervalMs: 10_000,
        recoveryRetryIntervalMs: 5,
        recoveryWindowMs: 100
      });

      respondHandshake(ports[0]);
      ports[0].onDisconnectListeners[0]?.();
      await Promise.resolve();
      vi.advanceTimersByTime(5);
      expect(chromeApi.runtime.connectNative).toHaveBeenCalledTimes(2);

      ports[1].onMessageListeners[0]?.({
        id: "queued-forward-001",
        method: "bridge.forward",
        profile: "profile-a",
        params: {
          session_id: "nm-session-001",
          run_id: "queued-forward-001",
          command: "runtime.ping",
          command_params: {},
          cwd: "/workspace/WebEnvoy"
        },
        timeout_ms: 50
      });
      await Promise.resolve();

      const queuedError = ports[1].postMessage.mock.calls.find(
        (call) => (call[0] as { id?: string }).id === "queued-forward-001"
      );
      expect(queuedError).toBeUndefined();
      expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();

      respondHandshake(ports[1]);

      await Promise.resolve();
      await Promise.resolve();
      expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(
        11,
        expect.objectContaining({
          id: "queued-forward-001"
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops heartbeat on disconnect and restarts it after recovery handshake", async () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    try {
      const ports = [createMockPort(), createMockPort()];
      const { chromeApi } = createChromeApi(ports);

      startChromeBackgroundBridge(chromeApi, {
        heartbeatIntervalMs: 10_000,
        recoveryRetryIntervalMs: 5,
        recoveryWindowMs: 100
      });

      respondHandshake(ports[0]);
      await Promise.resolve();

      expect(
        setIntervalSpy.mock.calls.filter(([, intervalMs]) => intervalMs === 10_000)
      ).toHaveLength(1);
      expect(
        setIntervalSpy.mock.calls.filter(([, intervalMs]) => intervalMs === 5)
      ).toHaveLength(0);

      ports[0].onDisconnectListeners[0]?.();
      await Promise.resolve();

      expect(clearIntervalSpy.mock.calls).toHaveLength(1);
      expect(
        setIntervalSpy.mock.calls.filter(([, intervalMs]) => intervalMs === 5)
      ).toHaveLength(1);

      vi.advanceTimersByTime(5);
      await Promise.resolve();
      await Promise.resolve();

      respondHandshake(ports[1]);
      await Promise.resolve();

      expect(
        setIntervalSpy.mock.calls.filter(([, intervalMs]) => intervalMs === 10_000)
      ).toHaveLength(2);
      expect(clearIntervalSpy.mock.calls).toHaveLength(2);
    } finally {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("fails only when recovery queue exceeds limit", async () => {
    const ports = [createMockPort(), createMockPort()];
    const { chromeApi } = createChromeApi(ports);

    startChromeBackgroundBridge(chromeApi, {
      heartbeatIntervalMs: 10_000,
      recoveryRetryIntervalMs: 5,
      recoveryWindowMs: 500
    });

    respondHandshake(ports[0]);
    ports[0].onDisconnectListeners[0]?.();
    await Promise.resolve();

    for (let i = 1; i <= 6; i += 1) {
      ports[1].onMessageListeners[0]?.({
        id: `queued-overflow-${i}`,
        method: "bridge.forward",
        profile: "profile-a",
        params: {
          session_id: "nm-session-001",
          run_id: `queued-overflow-${i}`,
          command: "runtime.ping",
          command_params: {},
          cwd: "/workspace/WebEnvoy"
        },
        timeout_ms: 50
      });
    }

    await Promise.resolve();
    const overflowError = ports[1].postMessage.mock.calls.find(
      (call) => (call[0] as { id?: string }).id === "queued-overflow-6"
    );
    expect(overflowError).toBeDefined();
    expect((overflowError?.[0] as { error?: { code?: string } }).error?.code).toBe(
      "ERR_TRANSPORT_DISCONNECTED"
    );

    for (let i = 1; i <= 5; i += 1) {
      const queuedFailure = ports[1].postMessage.mock.calls.find(
        (call) => (call[0] as { id?: string }).id === `queued-overflow-${i}`
      );
      expect(queuedFailure).toBeUndefined();
    }
  });

  it("fails queued forwards when recovery window exhausts", async () => {
    vi.useFakeTimers();
    try {
      const ports = [createMockPort(), createMockPort()];
      const { chromeApi } = createChromeApi(ports);

      startChromeBackgroundBridge(chromeApi, {
        heartbeatIntervalMs: 10_000,
        recoveryRetryIntervalMs: 10,
        recoveryWindowMs: 30
      });

      respondHandshake(ports[0]);
      ports[0].onDisconnectListeners[0]?.();

      ports[1].onMessageListeners[0]?.({
        id: "queued-expire-001",
        method: "bridge.forward",
        profile: "profile-a",
        params: {
          session_id: "nm-session-001",
          run_id: "queued-expire-001",
          command: "runtime.ping",
          command_params: {},
          cwd: "/workspace/WebEnvoy"
        },
        timeout_ms: 50
      });

      vi.advanceTimersByTime(40);
      await Promise.resolve();
      await Promise.resolve();

      expect(ports[1].postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "queued-expire-001",
          status: "error",
          error: expect.objectContaining({
            code: "ERR_TRANSPORT_DISCONNECTED"
          })
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("expires short-timeout queued forward before recovery window ends", async () => {
    vi.useFakeTimers();
    try {
      const ports = [createMockPort(), createMockPort()];
      const { chromeApi } = createChromeApi(ports);

      startChromeBackgroundBridge(chromeApi, {
        heartbeatIntervalMs: 10_000,
        recoveryRetryIntervalMs: 5,
        recoveryWindowMs: 200
      });

      respondHandshake(ports[0]);
      ports[0].onDisconnectListeners[0]?.();

      ports[1].onMessageListeners[0]?.({
        id: "queued-short-timeout-001",
        method: "bridge.forward",
        profile: "profile-a",
        params: {
          session_id: "nm-session-001",
          run_id: "queued-short-timeout-001",
          command: "runtime.ping",
          command_params: {},
          cwd: "/workspace/WebEnvoy"
        },
        timeout_ms: 20
      });

      vi.advanceTimersByTime(30);
      await Promise.resolve();

      expect(ports[1].postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "queued-short-timeout-001",
          status: "error",
          error: expect.objectContaining({
            code: "ERR_TRANSPORT_TIMEOUT"
          })
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("executes xhs-sign in MAIN world through extension-private rpc", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners, executeScript } = createChromeApi([firstPort]);

    startChromeBackgroundBridge(chromeApi);

    let response: unknown;
    runtimeMessageListeners[0]?.(
      {
        kind: "xhs-sign-request",
        uri: "/api/sns/web/v1/search/notes",
        body: { keyword: "露营" }
      },
      {
        tab: {
          id: 32,
          url: "https://www.xiaohongshu.com/search_result?keyword=露营"
        }
      },
      (message) => {
        response = message;
      }
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 32 },
        world: "MAIN",
        args: ["/api/sns/web/v1/search/notes", { keyword: "露营" }]
      })
    );
    expect(response).toEqual({
      ok: true,
      result: {
        "X-s": "signed",
        "X-t": "1700000000"
      }
    });
  });

  it("rejects xhs-sign requests from non-allowlisted sender tabs", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners, executeScript } = createChromeApi([firstPort]);

    startChromeBackgroundBridge(chromeApi);

    let response: unknown;
    runtimeMessageListeners[0]?.(
      {
        kind: "xhs-sign-request",
        uri: "/api/sns/web/v1/search/notes",
        body: { keyword: "露营" }
      },
      {
        tab: {
          id: 44,
          url: "https://example.com/"
        }
      },
      (message) => {
        response = message;
      }
    );

    await Promise.resolve();

    expect(executeScript).not.toHaveBeenCalled();
    expect(response).toEqual({
      ok: false,
      error: {
        code: "ERR_XHS_SIGN_FORBIDDEN",
        message: "xhs-sign request is out of allowlist scope"
      }
    });
  });

  it("returns xhs-sign failure when MAIN world executeScript fails", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners, executeScript } = createChromeApi([firstPort]);
    executeScript.mockRejectedValueOnce(new Error("window._webmsxyw is not available"));

    startChromeBackgroundBridge(chromeApi);

    let response: unknown;
    runtimeMessageListeners[0]?.(
      {
        kind: "xhs-sign-request",
        uri: "/api/sns/web/v1/search/notes",
        body: { keyword: "露营" }
      },
      {
        tab: {
          id: 32,
          url: "https://www.xiaohongshu.com/search_result?keyword=露营"
        }
      },
      (message) => {
        response = message;
      }
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(executeScript).toHaveBeenCalledTimes(1);
    expect(response).toEqual({
      ok: false,
      error: {
        code: "ERR_XHS_SIGN_FAILED",
        message: "window._webmsxyw is not available"
      }
    });
  });
});
