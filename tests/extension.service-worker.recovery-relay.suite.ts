import { describe, expect, it, vi } from "vitest";
import { createMockPort, createEditorInputProbeResult, createChromeApi, respondHandshake, waitForBridgeTurn, waitForPostedMessage, primeTrustedFingerprintContext, promoteBootstrapReadinessThroughPing, createXhsCommandParams, createRequestBoundXhsCommandParams, createXhsEditorInputCommandParams, createApprovedReadApprovalRecord, createApprovedReadAuditRecordForRequest, createFingerprintRuntimeContext, asRecord, resolveWriteInteractionTier, startChromeBackgroundBridge } from "./extension.service-worker.shared.js";

describe("extension service worker / recovery and relay prerequisites", () => {
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
    await Promise.resolve();
    await Promise.resolve();

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
        "EDITOR_INPUT_VALIDATION_REQUIRED",
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
    await Promise.resolve();
    await Promise.resolve();

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
    await Promise.resolve();
    await Promise.resolve();

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
    await Promise.resolve();
    await Promise.resolve();

    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(
      32,
      expect.objectContaining({
        id: "run-xhs-explicit-target-allow-001",
        command: "xhs.search"
      })
    );
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

  it("rebinds queued issue_209 admission context to the active session after recovery", async () => {
    vi.useFakeTimers();
    try {
      const ports = [createMockPort(), createMockPort()];
      const { chromeApi } = createChromeApi(ports);
      chromeApi.tabs.query.mockImplementation(async () => [
        { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
      ]);

      startChromeBackgroundBridge(chromeApi, {
        heartbeatIntervalMs: 10_000,
        recoveryRetryIntervalMs: 5,
        recoveryWindowMs: 100
      });

      respondHandshake(ports[0], {
        sessionId: "nm-session-001"
      });
      ports[0].onDisconnectListeners[0]?.();
      await Promise.resolve();
      vi.advanceTimersByTime(5);
      expect(chromeApi.runtime.connectNative).toHaveBeenCalledTimes(2);

      const runId = "queued-issue209-rebind-001";
      ports[1].onMessageListeners[0]?.({
        id: runId,
        method: "bridge.forward",
        profile: "profile-a",
        params: {
          session_id: "nm-session-001",
          run_id: runId,
          command: "xhs.search",
          command_params: createRequestBoundXhsCommandParams({
            runId,
            sessionId: "nm-session-001",
            requestId: "queued-issue209-request-001",
            requested_execution_mode: "live_read_limited",
            risk_state: "limited",
            approval_record: createApprovedReadApprovalRecord(),
            audit_record: createApprovedReadAuditRecordForRequest({
              runId,
              requestId: "queued-issue209-request-001"
            })
          }),
          cwd: "/workspace/WebEnvoy"
        },
        timeout_ms: 50
      });
      await Promise.resolve();

      expect(
        ports[1].postMessage.mock.calls.find(
          (call) => (call[0] as { id?: string }).id === runId
        )
      ).toBeUndefined();

      respondHandshake(ports[1], {
        sessionId: "nm-session-002"
      });
      await Promise.resolve();
      await Promise.resolve();

      const replayed = ports[1].postMessage.mock.calls
        .map((call) => call[0] as { id?: string; status?: string; payload?: Record<string, unknown> })
        .find((message) => message.id === runId);
      expect(replayed?.status).toBe("error");
      const payload = asRecord(replayed?.payload) ?? {};
      const gateInput = asRecord(payload.gate_input) ?? {};
      const admissionContext = asRecord(gateInput.admission_context) ?? {};
      const approvalEvidence = asRecord(admissionContext.approval_admission_evidence);
      const auditEvidence = asRecord(admissionContext.audit_admission_evidence);
      expect(approvalEvidence?.session_id).toBe("nm-session-002");
      expect(auditEvidence?.session_id).toBe("nm-session-002");
    } finally {
      vi.useRealTimers();
    }
  });
});
