import fs from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";
import { executeXhsSearch } from "../extension/xhs-search.js";
import {
  SEARCH_ENDPOINT,
  createPageContextNamespace,
  createSearchRequestShape,
  createVisitedPageContextNamespace,
  resolveActiveVisitedPageContextNamespace,
  serializeSearchRequestShape
} from "../extension/xhs-search-types.js";

const repoRoot = path.resolve(path.join(import.meta.dirname, ".."));
const extensionRoot = path.join(repoRoot, "extension");
const manifestPath = path.join(extensionRoot, "manifest.json");
const backgroundBuildPath = path.join(extensionRoot, "build", "background.js");
const mainWorldBridgeBuildPath = path.join(extensionRoot, "build", "main-world-bridge.js");
const contentScriptBuildPath = path.join(extensionRoot, "build", "content-script.js");
const contentScriptHandlerBuildPath = path.join(extensionRoot, "build", "content-script-handler.js");
const xhsEditorInputBuildPath = path.join(extensionRoot, "build", "xhs-editor-input.js");
const fingerprintProfileSharedPath = path.join(extensionRoot, "shared", "fingerprint-profile.js");
const expectedMainWorldBridgeMatches = [
  "https://www.xiaohongshu.com/*",
  "https://creator.xiaohongshu.com/*",
  "http://127.0.0.1/*",
  "http://localhost/*"
];
const expectedContentScriptMatches = [
  "https://www.xiaohongshu.com/*",
  "https://creator.xiaohongshu.com/*",
  "http://127.0.0.1/*",
  "http://localhost/*"
];

type BundledXhsModuleVar =
  | "__webenvoy_module_xhs_search"
  | "__webenvoy_module_xhs_detail"
  | "__webenvoy_module_xhs_user_home";

type BundledXhsExportName =
  | "executeXhsSearch"
  | "executeXhsDetail"
  | "executeXhsUserHome";

type BundledContentScriptHandlerModule = {
  ContentScriptHandler: new (options?: { xhsEnv?: Record<string, unknown> }) => {
    onResult(listener: (message: unknown) => void): () => void;
    onBackgroundMessage(message: Record<string, unknown>): boolean;
  };
};

const loadBundleExports = (bundlePath: string, moduleVar: BundledXhsModuleVar) => {
  const bundleSource = fs.readFileSync(bundlePath, "utf8");
  const context: Record<string, unknown> = {};
  context.globalThis = context;
  context.structuredClone = structuredClone;
  context.performance = performance;
  context.URL = URL;
  runInNewContext(
    `${bundleSource}\n;globalThis.__bundle_test_exports = { ${moduleVar}, __webenvoy_module_xhs_search_gate };`,
    context,
    { filename: bundlePath }
  );
  return context.__bundle_test_exports as {
    [key: string]: {
      [exportName: string]: (input: Record<string, unknown>, env: Record<string, unknown>) => Promise<unknown>;
    };
  };
};

const loadBundledContentScriptHandlerModule = (
  bundlePath: string,
  contextOverrides: Record<string, unknown> = {}
): BundledContentScriptHandlerModule => {
  const bundleSource = fs.readFileSync(bundlePath, "utf8");
  const context: Record<string, unknown> = { ...contextOverrides };
  context.globalThis = context;
  context.structuredClone = structuredClone;
  if (!("performance" in context)) {
    context.performance = performance;
  }
  runInNewContext(
    `${bundleSource}\n;globalThis.__bundle_handler_exports = __webenvoy_module_content_script_handler;`,
    context,
    { filename: bundlePath }
  );
  return context.__bundle_handler_exports as BundledContentScriptHandlerModule;
};

const executeBundledXhsCommand = async (
  bundlePath: string,
  input: {
    moduleVar: BundledXhsModuleVar;
    exportName: BundledXhsExportName;
    commandInput: Record<string, unknown>;
    envOverrides?: Record<string, unknown>;
  }
) => {
  const bundleExports = loadBundleExports(bundlePath, input.moduleVar);
  const executeCommand = bundleExports[input.moduleVar]?.[input.exportName];
  expect(executeCommand).toEqual(expect.any(Function));

  return executeCommand?.(
    input.commandInput,
    {
      now: () => 1_710_000_000_000,
      randomId: () => "bundle-req-001",
      getLocationHref: () => "https://www.xiaohongshu.com/search_result?keyword=%E9%9C%B2%E8%90%A5",
      getDocumentTitle: () => "Search Result",
      getReadyState: () => "complete",
      ...input.envOverrides
    }
  );
};

const createCapturedSearchContextArtifact = (input: {
  href: string;
  keyword: string;
  page?: number;
  page_size?: number;
  sort?: string;
  note_type?: number;
  captured_at: number;
  source_kind?: "page_request" | "synthetic_request";
  template_ready?: boolean;
  rejection_reason?: "synthetic_request_rejected" | "failed_request_rejected";
  rejectedStatus?: number;
  responseBody?: Record<string, unknown>;
  templateUrl?: string;
}) => {
  const shape = createSearchRequestShape({
    keyword: input.keyword,
    page: input.page ?? 1,
    page_size: input.page_size ?? 20,
    sort: input.sort ?? "general",
    note_type: input.note_type ?? 0
  });
  if (!shape) {
    throw new Error("shape must be valid in test");
  }
  const shapeKey = serializeSearchRequestShape(shape);
  const namespace = createVisitedPageContextNamespace(input.href, 1);
  return {
    page_context_namespace: namespace,
    shape_key: shapeKey,
    admitted_template:
      input.template_ready === false || input.rejection_reason
        ? null
        : {
            source_kind: input.source_kind ?? "page_request",
            transport: "fetch",
            method: "POST",
            path: SEARCH_ENDPOINT,
            url: input.templateUrl ?? `https://edith.xiaohongshu.com${SEARCH_ENDPOINT}`,
            status: 200,
            captured_at: input.captured_at,
            observed_at: input.captured_at,
            page_context_namespace: namespace,
            shape_key: shapeKey,
            shape,
            referrer: input.href,
            template_ready: true,
            request_status: {
              completion: "completed",
              http_status: 200
            },
            request: {
              headers: {
                accept: "application/json, text/plain, */*",
                "content-type": "application/json;charset=utf-8",
                origin: "https://www.xiaohongshu.com",
                referer: input.href,
                "x-s": "signed-template",
                "x-t": "1700000000",
                "x-rap-param": "captured-gateway-param",
                "xsecappid": "xhs-pc-web"
              },
              body: {
                keyword: input.keyword,
                page: input.page ?? 1,
                page_size: input.page_size ?? 20,
                search_id: "captured-search-id",
                sort: input.sort ?? "general",
                note_type: input.note_type ?? 0
              }
            },
            response: {
              headers: {
                "content-type": "application/json"
              },
              body: input.responseBody ?? { code: 0, data: { items: [] } }
            }
          },
    rejected_observation:
      input.rejection_reason
        ? {
            source_kind: input.source_kind ?? "page_request",
            transport: "fetch",
            method: "POST",
            path: SEARCH_ENDPOINT,
            url: `https://www.xiaohongshu.com${SEARCH_ENDPOINT}`,
            status:
              input.rejectedStatus ??
              (input.rejection_reason === "failed_request_rejected" ? 500 : 200),
            captured_at: input.captured_at,
            observed_at: input.captured_at,
            page_context_namespace: namespace,
            shape_key: shapeKey,
            shape,
            referrer: input.href,
            template_ready: false,
            rejection_reason: input.rejection_reason,
            request_status: {
              completion: "failed",
              http_status:
                input.rejectedStatus ??
                (input.rejection_reason === "failed_request_rejected" ? 500 : null)
            },
            request: {
              headers: {
                "content-type": "application/json;charset=utf-8"
              },
              body: {
                keyword: input.keyword,
                page: input.page ?? 1,
                page_size: input.page_size ?? 20,
                sort: input.sort ?? "general",
                note_type: input.note_type ?? 0
              }
            },
            response: {
              headers: {
                "content-type": "application/json"
              },
              body:
                input.responseBody ??
                (input.rejection_reason === "failed_request_rejected"
                  ? { code: 500, msg: "failed" }
                  : { code: 0, data: { items: [] } })
            }
          }
        : null,
    incompatible_observation: null,
    available_shape_keys: [shapeKey]
  };
};

const createBundledMainWorldWindow = (input: {
  href: string;
  resolveLookup: (payload: Record<string, unknown>, activeNamespace: string) => Record<string, unknown>;
  mainWorldRequests?: Array<Record<string, unknown>>;
}) => {
  const listeners = new Map<string, Set<(event: { type: string; detail?: unknown }) => void>>();
  let resultEventName: string | null = null;
  let namespaceEventName: string | null = null;
  const activeNamespace = createVisitedPageContextNamespace(input.href, 1);

  const emit = (type: string, detail: unknown): void => {
    listeners.get(type)?.forEach((listener) => {
      listener({
        type,
        detail
      });
    });
  };

  return {
    location: {
      href: input.href
    },
    addEventListener: (type: string, listener: (event: { type: string; detail?: unknown }) => void) => {
      const bucket = listeners.get(type) ?? new Set();
      bucket.add(listener);
      listeners.set(type, bucket);
    },
    removeEventListener: (
      type: string,
      listener: (event: { type: string; detail?: unknown }) => void
    ) => {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent: (event: { type: string; detail?: unknown }) => {
      const detail =
        typeof event.detail === "object" && event.detail !== null
          ? (event.detail as Record<string, unknown>)
          : null;
      if (event.type === "__mw_bootstrap__") {
        resultEventName =
          detail && typeof detail.result_event === "string" ? detail.result_event : null;
        namespaceEventName =
          detail && typeof detail.namespace_event === "string" ? detail.namespace_event : null;
        if (namespaceEventName) {
          emit(namespaceEventName, {
            page_context_namespace: activeNamespace,
            href: input.href,
            visit_sequence: 1
          });
        }
        return true;
      }
      if (!resultEventName || !detail || typeof detail.id !== "string" || typeof detail.type !== "string") {
        return true;
      }
      input.mainWorldRequests?.push({
        type: detail.type,
        payload:
          typeof detail.payload === "object" && detail.payload !== null
            ? { ...(detail.payload as Record<string, unknown>) }
            : detail.payload
      });

      let result: unknown = null;
      if (detail.type === "captured-request-context-read") {
        const payload =
          typeof detail.payload === "object" && detail.payload !== null
            ? (detail.payload as Record<string, unknown>)
            : {};
        result = input.resolveLookup(payload, activeNamespace);
      } else if (detail.type === "captured-request-context-provenance-set") {
        const payload =
          typeof detail.payload === "object" && detail.payload !== null
            ? (detail.payload as Record<string, unknown>)
            : {};
        result = {
          configured: true,
          page_context_namespace: payload.page_context_namespace,
          profile_ref: payload.profile_ref,
          session_id: payload.session_id,
          target_tab_id: payload.target_tab_id,
          run_id: payload.run_id,
          action_ref: payload.action_ref,
          page_url: payload.page_url
        };
      } else if (detail.type === "fingerprint-install") {
        result = {
          installed: true,
          required_patches: [],
          applied_patches: [],
          missing_required_patches: []
        };
      }

      emit(resultEventName, {
        id: detail.id,
        ok: true,
        result
      });
      return true;
    }
  };
};

const createBundledSearchSignatureResponse = (): Record<string, unknown> => ({
  ok: true,
  result: {
    "X-s": "fresh-signature",
    "X-t": "1710000000"
  }
});

const buildLiveReadAdmissionContext = (input: {
  runId: string;
  sessionId: string;
  gateInvocationId: string;
  targetTabId: number;
  targetPage: "explore_detail_tab" | "profile_tab" | "search_result_tab";
}) => {
  const decisionId = `gate_decision_${input.gateInvocationId}`;
  const approvalId = `gate_appr_${decisionId}`;
  return {
    approval_admission_evidence: {
      approval_admission_ref: `approval_admission_${input.gateInvocationId}`,
      decision_id: decisionId,
      approval_id: approvalId,
      run_id: input.runId,
      session_id: input.sessionId,
      issue_scope: "issue_209",
      target_domain: "www.xiaohongshu.com",
      target_tab_id: input.targetTabId,
      target_page: input.targetPage,
      action_type: "read",
      requested_execution_mode: "live_read_high_risk",
      approved: true,
      approver: "qa-reviewer",
      approved_at: "2026-03-23T10:00:00.000Z",
      checks: {
        target_domain_confirmed: true,
        target_tab_confirmed: true,
        target_page_confirmed: true,
        risk_state_checked: true,
        action_type_confirmed: true
      },
      recorded_at: "2026-03-23T10:00:00.000Z"
    },
    audit_admission_evidence: {
      audit_admission_ref: `audit_admission_${input.gateInvocationId}`,
      decision_id: decisionId,
      approval_id: approvalId,
      run_id: input.runId,
      session_id: input.sessionId,
      issue_scope: "issue_209",
      target_domain: "www.xiaohongshu.com",
      target_tab_id: input.targetTabId,
      target_page: input.targetPage,
      action_type: "read",
      requested_execution_mode: "live_read_high_risk",
      risk_state: "allowed",
      audited_checks: {
        target_domain_confirmed: true,
        target_tab_confirmed: true,
        target_page_confirmed: true,
        risk_state_checked: true,
        action_type_confirmed: true
      },
      recorded_at: "2026-03-23T10:00:30.000Z"
    }
  };
};

const buildCanonicalReadAuthorizationRequest = (input: {
  requestRef: string;
  actionName: "xhs.read_search_results" | "xhs.read_note_detail" | "xhs.read_user_home";
  targetPage: "explore_detail_tab" | "profile_tab" | "search_result_tab";
  targetTabId: number;
  profileRef: string;
  approvalRefs?: string[];
  auditRefs?: string[];
  resourceStateSnapshot?: "active" | "cool_down" | "paused";
  grantedAt?: string;
  targetUrl?: string;
}) => ({
  action_request: {
    request_ref: input.requestRef,
    action_name: input.actionName,
    action_category: "read",
    requested_at: "2026-04-15T09:00:00.000Z"
  },
  resource_binding: {
    binding_ref: `binding_${input.requestRef}`,
    resource_kind: "profile_session",
    profile_ref: input.profileRef
  },
  authorization_grant: {
    grant_ref: `grant_${input.requestRef}`,
    allowed_actions: [input.actionName],
    binding_scope: {
      allowed_resource_kinds: ["profile_session"],
      allowed_profile_refs: [input.profileRef]
    },
    target_scope: {
      allowed_domains: ["www.xiaohongshu.com"],
      allowed_pages: [input.targetPage]
    },
    approval_refs: input.approvalRefs ?? [],
    audit_refs: input.auditRefs ?? [],
    resource_state_snapshot: input.resourceStateSnapshot ?? "active",
    ...(input.grantedAt ? { granted_at: input.grantedAt } : {})
  },
  runtime_target: {
    target_ref: `target_${input.requestRef}`,
    domain: "www.xiaohongshu.com",
    page: input.targetPage,
    tab_id: input.targetTabId,
    ...(input.targetUrl ? { url: input.targetUrl } : {})
  }
});

describe("extension build contract", () => {
  it("generates chrome-loadable background/content-script artifacts referenced by manifest", () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      background: { service_worker: string };
      permissions?: string[];
      content_scripts: Array<{
        matches?: string[];
        js: string[];
        run_at?: string;
        world?: string;
      }>;
    };
    const bridgeEntry = manifest.content_scripts.find((entry) =>
      entry.js.includes("build/main-world-bridge.js"),
    );
    const contentScriptEntry = manifest.content_scripts.find((entry) =>
      entry.js.includes("build/content-script.js"),
    );

    expect(manifest.background.service_worker).toBe("build/background.js");
    expect(bridgeEntry).toBeDefined();
    expect(bridgeEntry?.matches).toEqual(expectedMainWorldBridgeMatches);
    expect(bridgeEntry?.run_at).toBe("document_start");
    expect(bridgeEntry?.world).toBe("MAIN");
    expect(contentScriptEntry).toBeDefined();
    expect(contentScriptEntry?.matches).toEqual(expectedContentScriptMatches);
    expect(contentScriptEntry?.run_at).toBe("document_start");
    expect(manifest.permissions).toEqual(expect.arrayContaining(["debugger"]));
    expect(fs.existsSync(backgroundBuildPath)).toBe(true);
    expect(fs.existsSync(mainWorldBridgeBuildPath)).toBe(true);
    expect(fs.existsSync(contentScriptBuildPath)).toBe(true);
    expect(fs.existsSync(contentScriptHandlerBuildPath)).toBe(true);
    expect(fs.existsSync(xhsEditorInputBuildPath)).toBe(true);
    expect(fs.existsSync(fingerprintProfileSharedPath)).toBe(true);

    const mainWorldBridgeSource = fs.readFileSync(mainWorldBridgeBuildPath, "utf8");
    expect(mainWorldBridgeSource).not.toMatch(/^\s*import\s/m);
    expect(mainWorldBridgeSource).not.toMatch(/^\s*export\s/m);
  });

  it("keeps the built main-world bridge bundle safe to reinject into the same page context", () => {
    const mainWorldBridgeSource = fs.readFileSync(mainWorldBridgeBuildPath, "utf8");
    const addedEventTypes: string[] = [];
    const context: Record<string, unknown> = {};

    context.globalThis = context;
    context.Symbol = Symbol;
    context.URL = URL;
    context.performance = performance;
    context.setTimeout = setTimeout;
    context.clearTimeout = clearTimeout;
    context.window = {
      addEventListener: (type: string) => {
        addedEventTypes.push(type);
      },
      removeEventListener: () => {},
      dispatchEvent: () => true,
      fetch: async () => new Response("{}"),
      location: {
        href: "https://www.xiaohongshu.com/search_result?keyword=reinject"
      },
      history: {
        pushState: () => {},
        replaceState: () => {}
      },
      navigator: {}
    };
    context.document = {
      createElement: () => ({ textContent: "", remove: () => {} }),
      documentElement: {
        appendChild: (node: unknown) => node
      }
    };
    context.CustomEvent = class {
      type: string;
      detail: unknown;

      constructor(type: string, init: { detail: unknown }) {
        this.type = type;
        this.detail = init.detail;
      }
    };

    runInNewContext(mainWorldBridgeSource, context, {
      filename: mainWorldBridgeBuildPath
    });
    expect(() =>
      runInNewContext(mainWorldBridgeSource, context, {
        filename: mainWorldBridgeBuildPath
      })
    ).not.toThrow();
    expect(addedEventTypes.filter((type) => type === "__mw_bootstrap__")).toHaveLength(1);
  });

  it("rebinds the staged main-world bridge to the latest secret without accumulating listeners", () => {
    const baseMainWorldBridgeSource = fs.readFileSync(mainWorldBridgeBuildPath, "utf8");
    const listenerMap = new Map<string, Set<(...args: unknown[]) => unknown>>();
    const createStagedMainWorldBridgeSource = (requestEvent: string, resultEvent: string, namespaceEvent: string) =>
      baseMainWorldBridgeSource
        .replace(
          'const MAIN_WORLD_EVENT_RESULT_PREFIX = "__mw_res__";',
          [
            'const MAIN_WORLD_EVENT_RESULT_PREFIX = "__mw_res__";',
            `const EXPECTED_MAIN_WORLD_REQUEST_EVENT = ${JSON.stringify(requestEvent)};`,
            `const EXPECTED_MAIN_WORLD_RESULT_EVENT = ${JSON.stringify(resultEvent)};`,
            `const EXPECTED_MAIN_WORLD_NAMESPACE_EVENT = ${JSON.stringify(namespaceEvent)};`
          ].join("\n")
        )
        .replace(
          'const __webenvoy_install_key = Symbol.for("webenvoy.main_world.bridge.bundle.v1");',
          `const __webenvoy_install_key = Symbol.for(${JSON.stringify(
            `webenvoy.main_world.bridge.bundle.v1:${requestEvent}`
          )});`
        );
    const context: Record<string, unknown> = {};

    context.globalThis = context;
    context.Symbol = Symbol;
    context.URL = URL;
    context.performance = performance;
    context.setTimeout = setTimeout;
    context.clearTimeout = clearTimeout;
    context.window = {
      addEventListener: (type: string, listener: (...args: unknown[]) => unknown) => {
        const listeners = listenerMap.get(type) ?? new Set();
        listeners.add(listener);
        listenerMap.set(type, listeners);
      },
      removeEventListener: (type: string, listener: (...args: unknown[]) => unknown) => {
        listenerMap.get(type)?.delete(listener);
      },
      dispatchEvent: () => true,
      fetch: async () => new Response("{}"),
      location: {
        href: "https://www.xiaohongshu.com/search_result?keyword=staged-rerun"
      },
      history: {
        pushState: () => {},
        replaceState: () => {}
      },
      navigator: {}
    };
    context.document = {
      createElement: () => ({ textContent: "", remove: () => {} }),
      documentElement: {
        appendChild: (node: unknown) => node
      }
    };
    context.CustomEvent = class {
      type: string;
      detail: unknown;

      constructor(type: string, init: { detail: unknown }) {
        this.type = type;
        this.detail = init.detail;
      }
    };

    runInNewContext(
      createStagedMainWorldBridgeSource("__mw_req__a", "__mw_res__a", "__mw_ns__a"),
      context,
      { filename: `${mainWorldBridgeBuildPath}#stage-a` }
    );
    expect(listenerMap.get("__mw_req__a")?.size ?? 0).toBe(1);

    runInNewContext(
      createStagedMainWorldBridgeSource("__mw_req__b", "__mw_res__b", "__mw_ns__b"),
      context,
      { filename: `${mainWorldBridgeBuildPath}#stage-b` }
    );

    expect(listenerMap.get("__mw_req__a")?.size ?? 0).toBe(0);
    expect(listenerMap.get("__mw_req__b")?.size ?? 0).toBe(1);
  });

  it("keeps extension build entry imports resolvable in node module loading", async () => {
    await expect(import(backgroundBuildPath)).resolves.toBeDefined();
    await expect(import(contentScriptHandlerBuildPath)).resolves.toBeDefined();
  });

  it("emits chrome-loadable classic content-script bundle without top-level esm imports", () => {
    const contentScriptBuild = fs.readFileSync(contentScriptBuildPath, "utf8");
    const xhsEditorInputBuild = fs.readFileSync(xhsEditorInputBuildPath, "utf8");
    expect(contentScriptBuild).toContain("bootstrapContentScript");
    expect(contentScriptBuild).toContain("installMainWorldEventChannelSecret");
    expect(contentScriptBuild).toContain("installFingerprintRuntimeViaMainWorld");
    expect(contentScriptBuild).toContain("readPageStateViaMainWorld");
    expect(contentScriptBuild).toContain("requestXhsSearchJsonViaMainWorld");
    expect(xhsEditorInputBuild).toContain("performEditorInputValidation");
    expect(xhsEditorInputBuild).toContain("新的创作");
    expect(xhsEditorInputBuild).toContain("enter_editable_mode");
    expect(contentScriptBuild).not.toMatch(/^\s*import\s+/m);
    expect(contentScriptBuild).toMatch(
      /const \{\s*evaluateXhsGate,\s*resolveXhsGateDecisionId,\s*XHS_READ_DOMAIN,\s*XHS_WRITE_DOMAIN,\s*buildIssue209PostGateArtifacts\s*\} = __webenvoy_module_shared_xhs_gate;/s
    );
  });

  it("executes bundled xhs.search classic module without unresolved implementation references", async () => {
    await expect(
      executeBundledXhsCommand(contentScriptBuildPath, {
        moduleVar: "__webenvoy_module_xhs_search",
        exportName: "executeXhsSearch",
        commandInput: {
          abilityId: "xhs.note.search.v1",
          abilityLayer: "L3",
          abilityAction: "read",
          params: {
            query: "露营装备"
          },
          options: {
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 8,
            target_page: "search_result_tab",
            actual_target_domain: "www.xiaohongshu.com",
            actual_target_tab_id: 8,
            actual_target_page: "search_result_tab",
            action_type: "read",
            risk_state: "limited",
            requested_execution_mode: "dry_run"
          },
          executionContext: {
            runId: "run-bundled-search-001",
            sessionId: "nm-session-bundled-search-001",
            profile: "profile-a"
          }
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      payload: {
        summary: {
          capability_result: {
            ability_id: "xhs.note.search.v1",
            outcome: "partial"
          }
        }
      }
    });
  });

  it("executes bundled content-script handler xhs.search dry_run without unresolved telemetry helpers", async () => {
    const { ContentScriptHandler } = loadBundledContentScriptHandlerModule(contentScriptBuildPath);
    const handler = new ContentScriptHandler({
      xhsEnv: {
        now: () => 1_710_000_000_000,
        randomId: () => "bundle-handler-req-001",
        getLocationHref: () =>
          "https://www.xiaohongshu.com/search_result/?keyword=%E9%9C%B2%E8%90%A5",
        getDocumentTitle: () => "Search Result",
        getReadyState: () => "complete",
        getCookie: () => "a1=session-cookie",
        callSignature: async () => ({
          "X-s": "signature",
          "X-t": "timestamp"
        }),
        fetchJson: async () => ({
          status: 200,
          body: {
            code: 0,
            data: {
              items: []
            }
          }
        })
      }
    });

    const resultPromise = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        off();
        reject(new Error("did not receive bundled content-script handler result"));
      }, 500);
      const off = handler.onResult((message) => {
        clearTimeout(timeout);
        off();
        resolve(message as Record<string, unknown>);
      });
    });

    expect(
      handler.onBackgroundMessage({
        kind: "forward",
        id: "msg-bundled-handler-search-001",
        runId: "run-bundled-handler-search-001",
        tabId: 8,
        profile: "profile-a",
        cwd: "/tmp/webenvoy",
        timeoutMs: 3_000,
        command: "xhs.search",
        params: {
          session_id: "nm-session-bundled-handler-search-001"
        },
        commandParams: {
          request_id: "req-bundled-handler-search-001",
          ability: {
            id: "xhs.note.search.v1",
            layer: "L3",
            action: "read"
          },
          input: {
            query: "露营装备"
          },
          options: {
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 8,
            target_page: "search_result_tab",
            actual_target_domain: "www.xiaohongshu.com",
            actual_target_tab_id: 8,
            actual_target_page: "search_result_tab",
            action_type: "read",
            risk_state: "limited",
            requested_execution_mode: "dry_run"
          }
        }
      })
    ).toBe(true);

    const result = await resultPromise;
    expect(result).toMatchObject({
      kind: "result"
    });
    expect((result.error as { message?: string } | undefined)?.message).not.toBe(
      "containsCookie is not defined"
    );
    expect((result.error as { message?: string } | undefined)?.message).not.toBe(
      "hasXhsAccountSafetyOverlaySignal is not defined"
    );
  });

  it("forwards xhs recovery probe marker through bundled content-script handler", async () => {
    const { ContentScriptHandler } = loadBundledContentScriptHandlerModule(contentScriptBuildPath);
    const handler = new ContentScriptHandler({
      xhsEnv: {
        now: () => 1_710_000_000_000,
        randomId: () => "bundle-handler-recovery-req-001",
        getLocationHref: () => "https://www.xiaohongshu.com/search_result",
        getDocumentTitle: () => "Search Result",
        getReadyState: () => "complete",
        getCookie: () => "a1=session-cookie"
      }
    });

    const resultPromise = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        off();
        reject(new Error("did not receive bundled recovery content-script handler result"));
      }, 500);
      const off = handler.onResult((message) => {
        clearTimeout(timeout);
        off();
        resolve(message as Record<string, unknown>);
      });
    });

    expect(
      handler.onBackgroundMessage({
        kind: "forward",
        id: "msg-bundled-handler-recovery-001",
        runId: "run-bundled-handler-recovery-001",
        tabId: 8,
        profile: "profile-a",
        cwd: "/tmp/webenvoy",
        timeoutMs: 3_000,
        command: "xhs.search",
        params: {
          session_id: "nm-session-bundled-handler-recovery-001"
        },
        commandParams: {
          request_id: "req-bundled-handler-recovery-001",
          ability: {
            id: "xhs.note.search.v1",
            layer: "L3",
            action: "read"
          },
          input: {
            query: "露营装备"
          },
          options: {
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 8,
            target_page: "search_result_tab",
            actual_target_domain: "www.xiaohongshu.com",
            actual_target_tab_id: 8,
            actual_target_page: "search_result_tab",
            action_type: "read",
            risk_state: "limited",
            requested_execution_mode: "recon",
            xhs_recovery_probe: true
          }
        }
      })
    ).toBe(true);

    const result = await resultPromise;
    expect(result).toMatchObject({
      kind: "result",
      ok: false,
      payload: {
        layer2_interaction: {
          strategy_selection: {
            selected_path: "blocked",
            blocked_by: "FR-0013.gate_only_probe_no_event_chain"
          },
          execution_trace: {
            settled_wait_applied: false,
            settled_wait_result: "skipped"
          }
        }
      }
    });
  });

  it("executes bundled content-script handler xhs.search live-read via main-world request bridge", async () => {
    const admissionContext = buildLiveReadAdmissionContext({
      runId: "run-bundled-handler-search-live-001",
      sessionId: "nm-session-bundled-handler-search-live-001",
      gateInvocationId: "issue209-gate-run-bundled-handler-search-live-001",
      targetTabId: 21,
      targetPage: "search_result_tab"
    });
    const searchHref = "https://www.xiaohongshu.com/search_result/?keyword=%E9%9C%B2%E8%90%A5";
    const bridgeRequests: Array<Record<string, unknown>> = [];
    const runtimeMessages: Array<Record<string, unknown>> = [];
    const bundledWindow = createBundledMainWorldWindow({
      href: searchHref,
      mainWorldRequests: bridgeRequests,
      resolveLookup: (payload, activeNamespace) => {
        const requestedNamespace =
          typeof payload.page_context_namespace === "string"
            ? payload.page_context_namespace
            : null;
        const lookup = createCapturedSearchContextArtifact({
          href: searchHref,
          keyword: "露营装备",
          captured_at: Date.now()
        });
        return {
          ...lookup,
          page_context_namespace:
            resolveActiveVisitedPageContextNamespace(requestedNamespace, activeNamespace) ??
            activeNamespace
        };
      }
    });
    const { ContentScriptHandler } = loadBundledContentScriptHandlerModule(contentScriptBuildPath, {
      chrome: {
        runtime: {
          sendMessage: (
            message: Record<string, unknown>,
            callback?: (response?: Record<string, unknown>) => void
          ) => {
            runtimeMessages.push(message);
            let response: Record<string, unknown>;
            if (message.kind === "xhs-main-world-request") {
              response = {
                ok: true,
                result: {
                  status: 200,
                  body: {
                    code: 0,
                    data: {
                      items: []
                    }
                  }
                }
              };
            } else if (message.kind === "xhs-sign-request") {
              response = createBundledSearchSignatureResponse();
            } else {
              response = {
                ok: false,
                error: {
                  message: `unexpected message kind: ${String(message.kind)}`
                }
              };
            }

            callback?.(response);
            return Promise.resolve(response);
          }
        }
      },
      crypto: {
        randomUUID: () => "bundle-live-uuid-001"
      },
      URL,
      location: {
        href: searchHref
      },
      window: bundledWindow,
      document: {
        title: "Search Result",
        readyState: "complete",
        cookie: "a1=session-cookie"
      },
      setTimeout,
      clearTimeout,
      CustomEvent: class CustomEventShim {
        type: string;
        detail: unknown;

        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      }
    });
    const handler = new ContentScriptHandler();

    const resultPromise = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        off();
        reject(new Error("did not receive bundled live content-script handler result"));
      }, 1_000);
      const off = handler.onResult((message) => {
        clearTimeout(timeout);
        off();
        resolve(message as Record<string, unknown>);
      });
    });

    expect(
      handler.onBackgroundMessage({
        kind: "forward",
        id: "msg-bundled-handler-search-live-001",
        runId: "run-bundled-handler-search-live-001",
        tabId: 21,
        profile: "profile-a",
        cwd: "/tmp/webenvoy",
        timeoutMs: 3_000,
        command: "xhs.search",
        params: {
          session_id: "nm-session-bundled-handler-search-live-001"
        },
        commandParams: {
          request_id: "req-bundled-handler-search-live-001",
          gate_invocation_id: "issue209-gate-run-bundled-handler-search-live-001",
          main_world_secret: "bundled-main-world-secret-001",
          ability: {
            id: "xhs.note.search.v1",
            layer: "L3",
            action: "read"
          },
          input: {
            query: "露营装备"
          },
          options: {
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 21,
            target_page: "search_result_tab",
            actual_target_domain: "www.xiaohongshu.com",
            actual_target_tab_id: 21,
            actual_target_page: "search_result_tab",
            action_type: "read",
            risk_state: "allowed",
            requested_execution_mode: "live_read_high_risk",
            upstream_authorization_request: buildCanonicalReadAuthorizationRequest({
              requestRef: "upstream_bundled_handler_search_live_001",
              actionName: "xhs.read_search_results",
              targetPage: "search_result_tab",
              targetTabId: 21,
              profileRef: "profile-a",
              approvalRefs: [
                String(admissionContext.approval_admission_evidence.approval_admission_ref)
              ],
              auditRefs: [String(admissionContext.audit_admission_evidence.audit_admission_ref)]
            }),
            admission_context: admissionContext
          }
        }
      })
    ).toBe(true);

    const searchResult = await resultPromise;
    expect(searchResult).toMatchObject({
      kind: "result",
      ok: true,
      payload: {
        summary: {
          capability_result: {
            ability_id: "xhs.note.search.v1",
            outcome: "success"
          },
          consumer_gate_result: {
            requested_execution_mode: "live_read_high_risk",
            gate_decision: "allowed"
          },
          request_context: {
            status: "exact_hit"
          },
          route_evidence: {
            evidence_class: "passive_api_capture"
          },
          execution_audit: {
            request_admission_decision: "allowed"
          }
        }
      }
    });
    expect(searchResult.payload.summary).not.toHaveProperty("layer2_interaction");
    expect(bridgeRequests).toHaveLength(3);
    expect(bridgeRequests[0]).toMatchObject({
      type: "captured-request-context-provenance-set",
      payload: {
        profile_ref: "profile-a",
        session_id: "nm-session-bundled-handler-search-live-001",
        target_tab_id: 21,
        run_id: "run-bundled-handler-search-live-001",
        action_ref: "read",
        page_url: searchHref
      }
    });
    expect(bridgeRequests[1]).toMatchObject({
      type: "captured-request-context-provenance-set",
      payload: {
        profile_ref: "profile-a",
        session_id: "nm-session-bundled-handler-search-live-001",
        target_tab_id: 21,
        run_id: "run-bundled-handler-search-live-001",
        action_ref: "read",
        page_url: searchHref
      }
    });
    expect(bridgeRequests[2]).toMatchObject({
      type: "captured-request-context-read",
      payload: {
        shape_key: serializeSearchRequestShape(
          createSearchRequestShape({ keyword: "露营装备" })!
        )
      }
    });
    expect(runtimeMessages).toEqual([]);
  });

  it("executes bundled content-script handler xhs.search live-read with default browser env", async () => {
    const searchHref = "https://www.xiaohongshu.com/search_result/?keyword=camp";
    const admissionContext = buildLiveReadAdmissionContext({
      runId: "run-bundled-handler-search-live-default",
      sessionId: "nm-session-bundled-handler-search-live-default",
      gateInvocationId: "issue209-gate-run-bundled-handler-search-live-default",
      targetTabId: 22,
      targetPage: "search_result_tab"
    });
    const runtimeMessages: Array<Record<string, unknown>> = [];
    const bundledWindow = createBundledMainWorldWindow({
      href: searchHref,
      resolveLookup: (payload, activeNamespace) => {
        const requestedNamespace =
          typeof payload.page_context_namespace === "string"
            ? payload.page_context_namespace
            : null;
        const lookup = createCapturedSearchContextArtifact({
          href: searchHref,
          keyword: "camp",
          captured_at: Date.now()
        });
        return {
          ...lookup,
          page_context_namespace:
            resolveActiveVisitedPageContextNamespace(requestedNamespace, activeNamespace) ??
            activeNamespace
        };
      }
    });

    const { ContentScriptHandler } = loadBundledContentScriptHandlerModule(contentScriptBuildPath, {
      chrome: {
        runtime: {
          sendMessage: (
            message: Record<string, unknown>,
            callback?: (response?: Record<string, unknown>) => void
          ) => {
            runtimeMessages.push(message);
            const response =
              message.kind === "xhs-main-world-request"
                ? {
                    ok: true,
                    result: {
                      status: 200,
                      body: {
                        code: 0,
                        data: {
                          items: []
                        }
                      }
                    }
                  }
                : message.kind === "xhs-sign-request"
                  ? createBundledSearchSignatureResponse()
                : {
                    ok: false,
                    error: {
                      message: `unexpected message kind: ${String(message.kind)}`
                    }
                  };
            callback?.(response);
            return Promise.resolve(response);
          }
        }
      },
      crypto: {
        randomUUID: () => "bundle-live-uuid-default"
      },
      URL,
      location: {
        href: searchHref
      },
      window: bundledWindow,
      document: {
        title: "Search Result",
        readyState: "complete",
        cookie: "a1=session-cookie"
      },
      setTimeout,
      clearTimeout,
      CustomEvent: class CustomEventShim {
        type: string;
        detail: unknown;

        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      }
    });
    const handler = new ContentScriptHandler();
    const resultPromise = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("did not receive bundled default-env result")), 1_000);
      const off = handler.onResult((message) => {
        clearTimeout(timeout);
        off();
        resolve(message as Record<string, unknown>);
      });
    });

    expect(
      handler.onBackgroundMessage({
        kind: "forward",
        id: "msg-bundled-handler-search-live-default",
        runId: "run-bundled-handler-search-live-default",
        tabId: 22,
        profile: "profile-a",
        cwd: "/tmp/webenvoy",
        timeoutMs: 3_000,
        command: "xhs.search",
        params: {
          session_id: "nm-session-bundled-handler-search-live-default"
        },
        commandParams: {
          request_id: "req-bundled-handler-search-live-default",
          gate_invocation_id: "issue209-gate-run-bundled-handler-search-live-default",
          main_world_secret: "bundled-main-world-secret-default",
          ability: {
            id: "xhs.note.search.v1",
            layer: "L3",
            action: "read"
          },
          input: {
            query: "camp"
          },
          options: {
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 22,
            target_page: "search_result_tab",
            actual_target_domain: "www.xiaohongshu.com",
            actual_target_tab_id: 22,
            actual_target_page: "search_result_tab",
            action_type: "read",
            risk_state: "allowed",
            requested_execution_mode: "live_read_high_risk",
            upstream_authorization_request: buildCanonicalReadAuthorizationRequest({
              requestRef: "upstream_bundled_handler_search_live_default",
              actionName: "xhs.read_search_results",
              targetPage: "search_result_tab",
              targetTabId: 22,
              profileRef: "profile-a",
              approvalRefs: [
                String(admissionContext.approval_admission_evidence.approval_admission_ref)
              ],
              auditRefs: [String(admissionContext.audit_admission_evidence.audit_admission_ref)]
            }),
            admission_context: admissionContext
          }
        }
      })
    ).toBe(true);

    await expect(resultPromise).resolves.toMatchObject({
      ok: true,
      payload: {
        summary: {
          request_context: {
            status: "exact_hit"
          },
          route_evidence: {
            evidence_class: "passive_api_capture"
          }
        }
      }
    });
    expect(runtimeMessages).toEqual([]);
  });

  it("executes bundled content-script handler xhs.search live-read with canonical grant only", async () => {
    const runtimeMessages: Array<Record<string, unknown>> = [];
    const searchHref = "https://www.xiaohongshu.com/search_result/?keyword=AI&type=51";
    const bridgeRequests: Array<Record<string, unknown>> = [];
    const bundledWindow = createBundledMainWorldWindow({
      href: searchHref,
      mainWorldRequests: bridgeRequests,
      resolveLookup: (payload, activeNamespace) => {
        const requestedNamespace =
          typeof payload.page_context_namespace === "string"
            ? payload.page_context_namespace
            : null;
        const lookup = createCapturedSearchContextArtifact({
          href: searchHref,
          keyword: "AI",
          captured_at: Date.now()
        });
        return {
          ...lookup,
          page_context_namespace:
            resolveActiveVisitedPageContextNamespace(requestedNamespace, activeNamespace) ??
            activeNamespace
        };
      }
    });
    const { ContentScriptHandler } = loadBundledContentScriptHandlerModule(contentScriptBuildPath, {
      chrome: {
        runtime: {
          sendMessage: (
            message: Record<string, unknown>,
            callback?: (response?: Record<string, unknown>) => void
          ) => {
            runtimeMessages.push(message);
            const response =
              message.kind === "xhs-main-world-request"
                  ? {
                      ok: true,
                      result: {
                        status: 200,
                        body: {
                          code: 0,
                          data: {
                            items: []
                          }
                        }
                      }
                    }
                  : message.kind === "xhs-sign-request"
                    ? createBundledSearchSignatureResponse()
                  : {
                      ok: false,
                      error: {
                        message: `unexpected message kind: ${String(message.kind)}`
                      }
                    };

            callback?.(response);
            return Promise.resolve(response);
          }
        }
      },
      crypto: {
        randomUUID: () => "bundle-live-uuid-002"
      },
      URL,
      location: {
        href: searchHref
      },
      window: bundledWindow,
      document: {
        title: "Search Result",
        readyState: "complete",
        cookie: "a1=session-cookie"
      },
      setTimeout,
      clearTimeout,
      CustomEvent: class CustomEventShim {
        type: string;
        detail: unknown;

        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      }
    });
    const handler = new ContentScriptHandler();

    const resultPromise = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        off();
        reject(new Error("did not receive bundled canonical-grant-only handler result"));
      }, 1_000);
      const off = handler.onResult((message) => {
        clearTimeout(timeout);
        off();
        resolve(message as Record<string, unknown>);
      });
    });

    expect(
      handler.onBackgroundMessage({
        kind: "forward",
        id: "msg-bundled-handler-search-live-002",
        runId: "run-bundled-handler-search-live-002",
        tabId: 21,
        profile: "profile-a",
        cwd: "/tmp/webenvoy",
        timeoutMs: 3_000,
        command: "xhs.search",
        params: {
          session_id: "nm-session-bundled-handler-search-live-002"
        },
        commandParams: {
          request_id: "req-bundled-handler-search-live-002",
          gate_invocation_id: "issue209-gate-run-bundled-handler-search-live-002",
          main_world_secret: "bundled-main-world-secret-002",
          ability: {
            id: "xhs.note.search.v1",
            layer: "L3",
            action: "read"
          },
          input: {
            query: "AI"
          },
          options: {
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 21,
            target_page: "search_result_tab",
            actual_target_domain: "www.xiaohongshu.com",
            actual_target_tab_id: 21,
            actual_target_page: "search_result_tab",
            action_type: "read",
            risk_state: "allowed",
            requested_execution_mode: "live_read_high_risk",
            upstream_authorization_request: buildCanonicalReadAuthorizationRequest({
              requestRef: "upstream_bundled_handler_search_live_002",
              actionName: "xhs.read_search_results",
              targetPage: "search_result_tab",
              targetTabId: 21,
              profileRef: "profile-a",
              approvalRefs: ["approval_admission_issue493_search_live_001"],
              auditRefs: ["audit_admission_issue493_search_live_001"],
              grantedAt: "2026-04-17T08:06:31.000Z",
              targetUrl: searchHref
            })
          }
        }
      })
    ).toBe(true);

    await expect(resultPromise).resolves.toMatchObject({
      kind: "result",
      ok: true,
      payload: {
        summary: {
          capability_result: {
            ability_id: "xhs.note.search.v1",
            outcome: "success"
          },
          consumer_gate_result: {
            requested_execution_mode: "live_read_high_risk",
            effective_execution_mode: "live_read_high_risk",
            gate_decision: "allowed",
            gate_reasons: ["LIVE_MODE_APPROVED"]
          },
          request_admission_result: {
            admission_decision: "allowed",
            derived_from: {
              approval_admission_ref: "approval_admission_issue493_search_live_001",
              audit_admission_ref: "audit_admission_issue493_search_live_001"
            }
          },
          execution_audit: {
            request_admission_decision: "allowed",
            compatibility_refs: {
              approval_admission_ref: "approval_admission_issue493_search_live_001",
              audit_admission_ref: "audit_admission_issue493_search_live_001"
            }
          },
          request_context: {
            status: "exact_hit"
          },
          route_evidence: {
            evidence_class: "passive_api_capture"
          }
        }
      }
    });
    expect(bridgeRequests).toHaveLength(3);
    expect(bridgeRequests[0]).toMatchObject({
      type: "captured-request-context-provenance-set",
      payload: {
        profile_ref: "profile-a",
        session_id: "nm-session-bundled-handler-search-live-002",
        target_tab_id: 21,
        run_id: "run-bundled-handler-search-live-002",
        action_ref: "read",
        page_url: searchHref
      }
    });
    expect(bridgeRequests[1]).toMatchObject({
      type: "captured-request-context-provenance-set",
      payload: {
        profile_ref: "profile-a",
        session_id: "nm-session-bundled-handler-search-live-002",
        target_tab_id: 21,
        run_id: "run-bundled-handler-search-live-002",
        action_ref: "read",
        page_url: searchHref
      }
    });
    expect(bridgeRequests[2]).toMatchObject({
      type: "captured-request-context-read"
    });
    expect(runtimeMessages).toEqual([]);
  });

  it("executes bundled xhs.detail classic module without unresolved implementation references", async () => {
    await expect(
      executeBundledXhsCommand(contentScriptBuildPath, {
        moduleVar: "__webenvoy_module_xhs_detail",
        exportName: "executeXhsDetail",
        commandInput: {
          abilityId: "xhs.note.detail.v1",
          abilityLayer: "L3",
          abilityAction: "read",
          params: {
            note_id: "note-bundled-001"
          },
          options: {
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 8,
            target_page: "explore_detail_tab",
            actual_target_domain: "www.xiaohongshu.com",
            actual_target_tab_id: 8,
            actual_target_page: "explore_detail_tab",
            action_type: "read",
            risk_state: "limited",
            requested_execution_mode: "dry_run"
          },
          executionContext: {
            runId: "run-bundled-detail-001",
            sessionId: "nm-session-bundled-detail-001",
            profile: "profile-a"
          }
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      payload: {
        summary: {
          capability_result: {
            ability_id: "xhs.note.detail.v1",
            outcome: "partial"
          }
        }
      }
    });
  });

  it("executes bundled xhs.user_home classic module without unresolved implementation references", async () => {
    await expect(
      executeBundledXhsCommand(contentScriptBuildPath, {
        moduleVar: "__webenvoy_module_xhs_user_home",
        exportName: "executeXhsUserHome",
        commandInput: {
          abilityId: "xhs.user.home.v1",
          abilityLayer: "L3",
          abilityAction: "read",
          params: {
            user_id: "user-bundled-001"
          },
          options: {
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 8,
            target_page: "profile_tab",
            actual_target_domain: "www.xiaohongshu.com",
            actual_target_tab_id: 8,
            actual_target_page: "profile_tab",
            action_type: "read",
            risk_state: "limited",
            requested_execution_mode: "dry_run"
          },
          executionContext: {
            runId: "run-bundled-user-home-001",
            sessionId: "nm-session-bundled-user-home-001",
            profile: "profile-a"
          }
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      payload: {
        summary: {
          capability_result: {
            ability_id: "xhs.user.home.v1",
            outcome: "partial"
          }
        }
      }
    });
  });

  it("executes source xhs.search live-read path with canonical execution_audit in summary", async () => {
    const admissionContext = buildLiveReadAdmissionContext({
      runId: "run-source-search-live-001",
      sessionId: "nm-session-source-search-live-001",
      gateInvocationId: "issue209-gate-run-source-search-live-001",
      targetTabId: 11,
      targetPage: "search_result_tab"
    });
    const callSignature = vi.fn(async () => ({
      "X-s": "fresh-signature",
      "X-t": "1710000000"
    }));
    const fetchJson = vi.fn(async (request: {
      url: string;
      body?: string;
      headers: Record<string, string>;
      referrer?: string;
    }) => {
      expect(request.url).toBe(`https://edith.xiaohongshu.com${SEARCH_ENDPOINT}`);
      expect(request.headers).toMatchObject({
        "X-s": "fresh-signature",
        "X-t": "1710000000",
        "X-S-Common": expect.any(String),
        "x-b3-traceid": "sourcereq001",
        "x-rap-param": "captured-gateway-param",
        "x-xray-traceid": "sourcereq001",
        "xsecappid": "xhs-pc-web"
      });
      expect(request.headers).not.toMatchObject({
        origin: "https://www.xiaohongshu.com",
        referer: "https://www.xiaohongshu.com/search_result?keyword=%E9%9C%B2%E8%90%A5",
        "x-s": "signed-template",
        "x-t": "1700000000"
      });
      expect(request.body).toBe(
        JSON.stringify({
          keyword: "露营装备",
          page: 1,
          page_size: 20,
          search_id: "source-req-001",
          sort: "general",
          note_type: 0
        })
      );
      expect(request.referrer).toBe(
        "https://www.xiaohongshu.com/search_result?keyword=%E9%9C%B2%E8%90%A5"
      );
      return {
        status: 200,
        body: {
          code: 0,
          data: {
            items: []
          }
        }
      };
    });

    const result = await executeXhsSearch(
        {
          abilityId: "xhs.note.search.v1",
          abilityLayer: "L3",
          abilityAction: "read",
          params: {
            query: "露营装备"
          },
          options: {
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 11,
            target_page: "search_result_tab",
            actual_target_domain: "www.xiaohongshu.com",
            actual_target_tab_id: 11,
            actual_target_page: "search_result_tab",
            action_type: "read",
            risk_state: "allowed",
            requested_execution_mode: "live_read_high_risk",
            upstream_authorization_request: buildCanonicalReadAuthorizationRequest({
              requestRef: "upstream_source_search_live_001",
              actionName: "xhs.read_search_results",
              targetPage: "search_result_tab",
              targetTabId: 11,
              profileRef: "profile-a",
              approvalRefs: [
                String(admissionContext.approval_admission_evidence.approval_admission_ref)
              ],
              auditRefs: [String(admissionContext.audit_admission_evidence.audit_admission_ref)]
            }),
            admission_context: admissionContext
          },
          executionContext: {
            runId: "run-source-search-live-001",
            sessionId: "nm-session-source-search-live-001",
            profile: "profile-a",
            gateInvocationId: "issue209-gate-run-source-search-live-001"
          }
        },
        {
          now: () => 1_710_000_000_000,
          randomId: () => "source-req-001",
          getLocationHref: () => "https://www.xiaohongshu.com/search_result?keyword=%E9%9C%B2%E8%90%A5",
          getDocumentTitle: () => "Search Result",
          getReadyState: () => "complete",
          getCookie: () => "a1=session-cookie",
          readCapturedRequestContext: async () =>
            createCapturedSearchContextArtifact({
              href: "https://www.xiaohongshu.com/search_result?keyword=%E9%9C%B2%E8%90%A5",
              keyword: "露营装备",
              captured_at: 1_710_000_000_000,
              responseBody: {
                code: 0,
                data: {
                  items: [
                    {
                      id: "note-passive-001",
                      title: "露营装备清单",
                      xsec_token: "token-passive-001",
                      xsec_source: "pc_search",
                      note_card: {
                        user: {
                          user_id: "user-passive-001"
                        }
                      }
                    }
                  ]
                }
              }
            }),
          callSignature,
          fetchJson
        }
      );

    expect(result).toMatchObject({
      ok: true,
      payload: {
        summary: {
          capability_result: {
            ability_id: "xhs.note.search.v1",
            outcome: "success"
          },
          request_admission_result: {
            admission_decision: "allowed"
          },
          route_evidence: {
            evidence_class: "passive_api_capture",
            item_kind: "search_card",
            cards: [
              {
                title: "露营装备清单",
                detail_url:
                  "https://www.xiaohongshu.com/explore/note-passive-001?xsec_token=token-passive-001&xsec_source=pc_search",
                user_home_url:
                  "https://www.xiaohongshu.com/user/profile/user-passive-001?xsec_token=token-passive-001&xsec_source=pc_search",
                note_id: "note-passive-001",
                user_id: "user-passive-001",
                xsec_token: "token-passive-001",
                xsec_source: "pc_search"
              }
            ],
            target_continuity: [
              {
                note_id: "note-passive-001",
                user_id: "user-passive-001",
                token_presence: "present",
                source_route: "xhs.search"
              }
            ]
          },
          request_context: {
            status: "exact_hit"
          },
          execution_audit: {
            request_admission_decision: "allowed"
          }
        }
      }
    });
    expect(callSignature).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("accepts trusted captured search URLs as passive evidence without active fetch", async () => {
    const admissionContext = buildLiveReadAdmissionContext({
      runId: "run-source-search-live-url-normalize-001",
      sessionId: "nm-session-source-search-live-url-normalize-001",
      gateInvocationId: "issue209-gate-run-source-search-live-url-normalize-001",
      targetTabId: 11,
      targetPage: "search_result_tab"
    });
    const fetchJson = vi.fn(async () => ({
      status: 200,
      body: {
        code: 0,
        data: {
          items: []
        }
      }
    }));

    await executeXhsSearch(
      {
        abilityId: "xhs.note.search.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          query: "露营装备"
        },
        options: {
          issue_scope: "issue_209",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 11,
          target_page: "search_result_tab",
          actual_target_domain: "www.xiaohongshu.com",
          actual_target_tab_id: 11,
          actual_target_page: "search_result_tab",
          action_type: "read",
          risk_state: "allowed",
          requested_execution_mode: "live_read_high_risk",
          upstream_authorization_request: buildCanonicalReadAuthorizationRequest({
            requestRef: "upstream_source_search_live_url_normalize_001",
            actionName: "xhs.read_search_results",
            targetPage: "search_result_tab",
            targetTabId: 11,
            profileRef: "profile-a",
            approvalRefs: [
              String(admissionContext.approval_admission_evidence.approval_admission_ref)
            ],
            auditRefs: [String(admissionContext.audit_admission_evidence.audit_admission_ref)]
          }),
          admission_context: admissionContext
        },
        executionContext: {
          runId: "run-source-search-live-url-normalize-001",
          sessionId: "nm-session-source-search-live-url-normalize-001",
          profile: "profile-a",
          gateInvocationId: "issue209-gate-run-source-search-live-url-normalize-001"
        }
      },
      {
        now: () => 1_710_000_000_000,
        randomId: () => "source-req-url-normalize-001",
        getLocationHref: () => "https://www.xiaohongshu.com/search_result?keyword=%E9%9C%B2%E8%90%A5",
        getDocumentTitle: () => "Search Result",
        getReadyState: () => "complete",
        getCookie: () => "a1=session-cookie",
        readCapturedRequestContext: async () =>
          createCapturedSearchContextArtifact({
            href: "https://www.xiaohongshu.com/search_result?keyword=%E9%9C%B2%E8%90%A5",
            keyword: "露营装备",
            captured_at: 1_710_000_000_000,
            templateUrl: `https://edith.xiaohongshu.com${SEARCH_ENDPOINT}?trace=ignored#fragment`
          }),
        callSignature: async () => ({ "X-s": "fresh-signature", "X-t": "1710000000" }),
        fetchJson
      }
    );

    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("normalizes string platform risk codes before accepting xhs.search responses", async () => {
    const admissionContext = buildLiveReadAdmissionContext({
      runId: "run-source-search-string-code-001",
      sessionId: "nm-session-source-search-string-code-001",
      gateInvocationId: "issue209-gate-run-source-search-string-code-001",
      targetTabId: 11,
      targetPage: "search_result_tab"
    });
    const callSignature = vi.fn(async () => ({ "X-s": "fresh-signature", "X-t": "1710000000" }));
    const fetchJson = vi.fn(async () => ({ status: 200, body: { code: 0 } }));

    const result = await executeXhsSearch(
      {
        abilityId: "xhs.note.search.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          query: "露营装备"
        },
        options: {
          issue_scope: "issue_209",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 11,
          target_page: "search_result_tab",
          actual_target_domain: "www.xiaohongshu.com",
          actual_target_tab_id: 11,
          actual_target_page: "search_result_tab",
          action_type: "read",
          risk_state: "allowed",
          requested_execution_mode: "live_read_high_risk",
          upstream_authorization_request: buildCanonicalReadAuthorizationRequest({
            requestRef: "upstream_source_search_string_code_001",
            actionName: "xhs.read_search_results",
            targetPage: "search_result_tab",
            targetTabId: 11,
            profileRef: "profile-a",
            approvalRefs: [
              String(admissionContext.approval_admission_evidence.approval_admission_ref)
            ],
            auditRefs: [String(admissionContext.audit_admission_evidence.audit_admission_ref)]
          }),
          admission_context: admissionContext
        },
        executionContext: {
          runId: "run-source-search-string-code-001",
          sessionId: "nm-session-source-search-string-code-001",
          profile: "profile-a",
          gateInvocationId: "issue209-gate-run-source-search-string-code-001"
        }
      },
      {
        now: () => 1_710_000_000_000,
        randomId: () => "source-req-string-code-001",
        getLocationHref: () => "https://www.xiaohongshu.com/search_result?keyword=%E9%9C%B2%E8%90%A5",
        getDocumentTitle: () => "Search Result",
        getReadyState: () => "complete",
        getCookie: () => "a1=session-cookie",
        readCapturedRequestContext: async () =>
          createCapturedSearchContextArtifact({
            href: "https://www.xiaohongshu.com/search_result?keyword=%E9%9C%B2%E8%90%A5",
            keyword: "露营装备",
            captured_at: 1_710_000_000_000,
            responseBody: {
              code: "300011",
              msg: "account abnormal"
            }
          }),
        readPageStateRoot: async () => ({
          feed: {
            items: [
              {
                title: "不应覆盖账号异常",
                detail_url:
                  "https://www.xiaohongshu.com/explore/rejected-source-001?xsec_token=token-rejected-001&xsec_source=pc_search"
              }
            ]
          }
        }),
        callSignature,
        fetchJson
      }
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected string platform code failure");
    }
    expect(result.error).toMatchObject({
      code: "ERR_EXECUTION_FAILED",
      message: "账号异常，平台拒绝当前请求"
    });
    expect(result.payload.details).toMatchObject({
      reason: "ACCOUNT_ABNORMAL",
      status_code: 200,
      platform_code: 300011
    });
    expect(callSignature).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("accepts captured exact-hit template without page signer or active fetch", async () => {
    const admissionContext = buildLiveReadAdmissionContext({
      runId: "run-source-search-live-captured-signature-001",
      sessionId: "nm-session-source-search-live-captured-signature-001",
      gateInvocationId: "issue209-gate-run-source-search-live-captured-signature-001",
      targetTabId: 11,
      targetPage: "search_result_tab"
    });
    const fetchJson = vi.fn(async () => ({
      status: 200,
      body: {
        code: 0,
        data: {
          items: []
        }
      }
    }));

    const result = await executeXhsSearch(
        {
          abilityId: "xhs.note.search.v1",
          abilityLayer: "L3",
          abilityAction: "read",
          params: {
            query: "露营装备"
          },
          options: {
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 11,
            target_page: "search_result_tab",
            actual_target_domain: "www.xiaohongshu.com",
            actual_target_tab_id: 11,
            actual_target_page: "search_result_tab",
            action_type: "read",
            risk_state: "allowed",
            requested_execution_mode: "live_read_high_risk",
            upstream_authorization_request: buildCanonicalReadAuthorizationRequest({
              requestRef: "upstream_source_search_live_captured_signature_001",
              actionName: "xhs.read_search_results",
              targetPage: "search_result_tab",
              targetTabId: 11,
              profileRef: "profile-a",
              approvalRefs: [
                String(admissionContext.approval_admission_evidence.approval_admission_ref)
              ],
              auditRefs: [String(admissionContext.audit_admission_evidence.audit_admission_ref)]
            }),
            admission_context: admissionContext
          },
          executionContext: {
            runId: "run-source-search-live-captured-signature-001",
            sessionId: "nm-session-source-search-live-captured-signature-001",
            profile: "profile-a",
            gateInvocationId: "issue209-gate-run-source-search-live-captured-signature-001"
          }
        },
        {
          now: () => 1_710_000_000_000,
          randomId: () => "source-req-captured-signature-001",
          getLocationHref: () => "https://www.xiaohongshu.com/search_result?keyword=%E9%9C%B2%E8%90%A5",
          getDocumentTitle: () => "Search Result",
          getReadyState: () => "complete",
          getCookie: () => "a1=session-cookie",
          readCapturedRequestContext: async () =>
            createCapturedSearchContextArtifact({
              href: "https://www.xiaohongshu.com/search_result?keyword=%E9%9C%B2%E8%90%A5",
              keyword: "露营装备",
              captured_at: 1_710_000_000_000
            }),
          callSignature: async () => {
            throw new Error("window._webmsxyw is not available");
          },
          fetchJson
        }
      );

    expect(result).toMatchObject({
      ok: true,
      payload: {
        summary: {
          request_context: {
            status: "exact_hit"
          }
        }
      }
    });
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("waits for a fresh captured xhs.search template before failing closed", async () => {
    const admissionContext = buildLiveReadAdmissionContext({
      runId: "run-source-search-live-context-wait-001",
      sessionId: "nm-session-source-search-live-context-wait-001",
      gateInvocationId: "issue209-gate-run-source-search-live-context-wait-001",
      targetTabId: 11,
      targetPage: "search_result_tab"
    });
    const href = "https://www.xiaohongshu.com/search_result?keyword=%E9%9C%B2%E8%90%A5";
    let lookupCount = 0;
    const actionOrder: string[] = [];
    const sleep = vi.fn(async () => {});
    const fetchJson = vi.fn(async () => ({
      status: 200,
      body: {
        code: 0,
        data: {
          items: []
        }
      }
    }));

    const result = await executeXhsSearch(
        {
          abilityId: "xhs.note.search.v1",
          abilityLayer: "L3",
          abilityAction: "read",
          params: {
            query: "露营装备"
          },
          options: {
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 11,
            target_page: "search_result_tab",
            actual_target_domain: "www.xiaohongshu.com",
            actual_target_tab_id: 11,
            actual_target_page: "search_result_tab",
            action_type: "read",
            risk_state: "allowed",
            requested_execution_mode: "live_read_high_risk",
            upstream_authorization_request: buildCanonicalReadAuthorizationRequest({
              requestRef: "upstream_source_search_live_context_wait_001",
              actionName: "xhs.read_search_results",
              targetPage: "search_result_tab",
              targetTabId: 11,
              profileRef: "profile-a",
              approvalRefs: [
                String(admissionContext.approval_admission_evidence.approval_admission_ref)
              ],
              auditRefs: [String(admissionContext.audit_admission_evidence.audit_admission_ref)]
            }),
            admission_context: admissionContext
          },
          executionContext: {
            runId: "run-source-search-live-context-wait-001",
            sessionId: "nm-session-source-search-live-context-wait-001",
            profile: "profile-a",
            gateInvocationId: "issue209-gate-run-source-search-live-context-wait-001"
          }
        },
        {
          now: () => 1_710_000_000_000,
          randomId: () => "source-req-context-wait-001",
          getLocationHref: () => href,
          getDocumentTitle: () => "Search Result",
          getReadyState: () => "complete",
          getCookie: () => "a1=session-cookie",
          sleep,
          performSearchPassiveAction: async () => {
            actionOrder.push("humanized_action");
            return {
              evidence_class: "humanized_action",
              action_kind: "scroll"
            };
          },
          readCapturedRequestContext: async (lookup) => {
            expect(lookup.min_observed_at).toBe(1_710_000_000_000);
            actionOrder.push("capture_poll");
            lookupCount += 1;
            return lookupCount < 12
              ? null
              : createCapturedSearchContextArtifact({
                  href,
                  keyword: "露营装备",
                  captured_at: 1_710_000_000_000
                });
          },
          callSignature: async () => ({ "X-s": "fresh-signature", "X-t": "1710000000" }),
          fetchJson
        }
      );

    expect(result).toMatchObject({
      ok: true,
      payload: {
        summary: {
          request_context: {
            status: "exact_hit"
          }
        }
      }
    });

    expect(actionOrder.slice(0, 2)).toEqual(["humanized_action", "capture_poll"]);
    expect(sleep).toHaveBeenCalledTimes(11);
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("keeps waiting when a sibling search shape appears before the exact template", async () => {
    const admissionContext = buildLiveReadAdmissionContext({
      runId: "run-source-search-live-context-shape-wait-001",
      sessionId: "nm-session-source-search-live-context-shape-wait-001",
      gateInvocationId: "issue209-gate-run-source-search-live-context-shape-wait-001",
      targetTabId: 11,
      targetPage: "search_result_tab"
    });
    const href = "https://www.xiaohongshu.com/search_result?keyword=%E9%9C%B2%E8%90%A5";
    let lookupCount = 0;
    const sleep = vi.fn(async () => {});
    const fetchJson = vi.fn(async () => ({
      status: 200,
      body: {
        code: 0,
        data: {
          items: []
        }
      }
    }));

    const result = await executeXhsSearch(
        {
          abilityId: "xhs.note.search.v1",
          abilityLayer: "L3",
          abilityAction: "read",
          params: {
            query: "露营装备"
          },
          options: {
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 11,
            target_page: "search_result_tab",
            actual_target_domain: "www.xiaohongshu.com",
            actual_target_tab_id: 11,
            actual_target_page: "search_result_tab",
            action_type: "read",
            risk_state: "allowed",
            requested_execution_mode: "live_read_high_risk",
            upstream_authorization_request: buildCanonicalReadAuthorizationRequest({
              requestRef: "upstream_source_search_live_context_shape_wait_001",
              actionName: "xhs.read_search_results",
              targetPage: "search_result_tab",
              targetTabId: 11,
              profileRef: "profile-a",
              approvalRefs: [
                String(admissionContext.approval_admission_evidence.approval_admission_ref)
              ],
              auditRefs: [String(admissionContext.audit_admission_evidence.audit_admission_ref)]
            }),
            admission_context: admissionContext
          },
          executionContext: {
            runId: "run-source-search-live-context-shape-wait-001",
            sessionId: "nm-session-source-search-live-context-shape-wait-001",
            profile: "profile-a",
            gateInvocationId: "issue209-gate-run-source-search-live-context-shape-wait-001"
          }
        },
        {
          now: () => 1_710_000_000_000,
          randomId: () => "source-req-context-shape-wait-001",
          getLocationHref: () => href,
          getDocumentTitle: () => "Search Result",
          getReadyState: () => "complete",
          getCookie: () => "a1=session-cookie",
          sleep,
          readCapturedRequestContext: async () => {
            lookupCount += 1;
            return lookupCount === 1
              ? {
                  ...createCapturedSearchContextArtifact({
                    href,
                    keyword: "露营",
                    captured_at: 1_710_000_000_000
                  }),
                  admitted_template: null,
                  available_shape_keys: [
                    serializeSearchRequestShape(
                      createSearchRequestShape({ keyword: "露营" })!
                    )
                  ],
                  incompatible_observation: {
                    ...(createCapturedSearchContextArtifact({
                      href,
                      keyword: "露营",
                      captured_at: 1_710_000_000_000
                    }).admitted_template as Record<string, unknown>),
                    incompatibility_reason: "shape_mismatch"
                  }
                }
              : createCapturedSearchContextArtifact({
                  href,
                  keyword: "露营装备",
                  captured_at: 1_710_000_000_000
                });
          },
          callSignature: async () => ({ "X-s": "fresh-signature", "X-t": "1710000000" }),
          fetchJson
        }
      );

    expect(result).toMatchObject({
      ok: true,
      payload: {
        summary: {
          request_context: {
            status: "exact_hit"
          }
        }
      }
    });

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("keeps waiting when an aborted same-shape XHR appears before the exact template", async () => {
    const admissionContext = buildLiveReadAdmissionContext({
      runId: "run-source-search-live-context-abort-wait-001",
      sessionId: "nm-session-source-search-live-context-abort-wait-001",
      gateInvocationId: "issue209-gate-run-source-search-live-context-abort-wait-001",
      targetTabId: 11,
      targetPage: "search_result_tab"
    });
    const href = "https://www.xiaohongshu.com/search_result?keyword=%E9%9C%B2%E8%90%A5";
    let lookupCount = 0;
    const sleep = vi.fn(async () => {});
    const fetchJson = vi.fn(async () => ({
      status: 200,
      body: {
        code: 0,
        data: {
          items: []
        }
      }
    }));

    const result = await executeXhsSearch(
        {
          abilityId: "xhs.note.search.v1",
          abilityLayer: "L3",
          abilityAction: "read",
          params: {
            query: "露营装备"
          },
          options: {
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 11,
            target_page: "search_result_tab",
            actual_target_domain: "www.xiaohongshu.com",
            actual_target_tab_id: 11,
            actual_target_page: "search_result_tab",
            action_type: "read",
            risk_state: "allowed",
            requested_execution_mode: "live_read_high_risk",
            upstream_authorization_request: buildCanonicalReadAuthorizationRequest({
              requestRef: "upstream_source_search_live_context_abort_wait_001",
              actionName: "xhs.read_search_results",
              targetPage: "search_result_tab",
              targetTabId: 11,
              profileRef: "profile-a",
              approvalRefs: [
                String(admissionContext.approval_admission_evidence.approval_admission_ref)
              ],
              auditRefs: [String(admissionContext.audit_admission_evidence.audit_admission_ref)]
            }),
            admission_context: admissionContext
          },
          executionContext: {
            runId: "run-source-search-live-context-abort-wait-001",
            sessionId: "nm-session-source-search-live-context-abort-wait-001",
            profile: "profile-a",
            gateInvocationId: "issue209-gate-run-source-search-live-context-abort-wait-001"
          }
        },
        {
          now: () => 1_710_000_000_000,
          randomId: () => "source-req-context-abort-wait-001",
          getLocationHref: () => href,
          getDocumentTitle: () => "Search Result",
          getReadyState: () => "complete",
          getCookie: () => "a1=session-cookie",
          sleep,
          readCapturedRequestContext: async () => {
            lookupCount += 1;
            if (lookupCount === 1) {
              const abortedLookup = createCapturedSearchContextArtifact({
                href,
                keyword: "露营装备",
                captured_at: 1_710_000_000_000,
                rejection_reason: "failed_request_rejected"
              }) as Record<string, unknown>;
              const rejectedObservation = abortedLookup.rejected_observation as Record<
                string,
                unknown
              >;
              rejectedObservation.status = 0;
              rejectedObservation.transport = "xhr";
              rejectedObservation.request_status = {
                completion: "failed",
                http_status: null
              };
              return abortedLookup;
            }
            return createCapturedSearchContextArtifact({
              href,
              keyword: "露营装备",
              captured_at: 1_710_000_000_000
            });
          },
          callSignature: async () => ({ "X-s": "fresh-signature", "X-t": "1710000000" }),
          fetchJson
        }
      );

    expect(result).toMatchObject({
      ok: true,
      payload: {
        summary: {
          request_context: {
            status: "exact_hit"
          }
        }
      }
    });

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("keeps xhs.search fail-closed when no captured template appears after waiting", async () => {
    const admissionContext = buildLiveReadAdmissionContext({
      runId: "run-source-search-live-context-missing-001",
      sessionId: "nm-session-source-search-live-context-missing-001",
      gateInvocationId: "issue209-gate-run-source-search-live-context-missing-001",
      targetTabId: 11,
      targetPage: "search_result_tab"
    });
    const sleep = vi.fn(async () => {});
    const fetchJson = vi.fn(async () => ({
      status: 200,
      body: {
        code: 0,
        data: {
          items: []
        }
      }
    }));
    const callSignature = vi.fn(async () => ({ "X-s": "sig", "X-t": "1710000000" }));

    const result = await executeXhsSearch(
        {
          abilityId: "xhs.note.search.v1",
          abilityLayer: "L3",
          abilityAction: "read",
          params: {
            query: "露营装备"
          },
          options: {
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 11,
            target_page: "search_result_tab",
            actual_target_domain: "www.xiaohongshu.com",
            actual_target_tab_id: 11,
            actual_target_page: "search_result_tab",
            action_type: "read",
            risk_state: "allowed",
            requested_execution_mode: "live_read_high_risk",
            upstream_authorization_request: buildCanonicalReadAuthorizationRequest({
              requestRef: "upstream_source_search_live_context_missing_001",
              actionName: "xhs.read_search_results",
              targetPage: "search_result_tab",
              targetTabId: 11,
              profileRef: "profile-a",
              approvalRefs: [
                String(admissionContext.approval_admission_evidence.approval_admission_ref)
              ],
              auditRefs: [String(admissionContext.audit_admission_evidence.audit_admission_ref)]
            }),
            admission_context: admissionContext
          },
          executionContext: {
            runId: "run-source-search-live-context-missing-001",
            sessionId: "nm-session-source-search-live-context-missing-001",
            profile: "profile-a",
            gateInvocationId: "issue209-gate-run-source-search-live-context-missing-001"
          }
        },
        {
          now: () => 1_710_000_000_000,
          randomId: () => "source-req-context-missing-001",
          getLocationHref: () => "https://www.xiaohongshu.com/search_result?keyword=%E9%9C%B2%E8%90%A5",
          getDocumentTitle: () => "Search Result",
          getReadyState: () => "complete",
          getCookie: () => "a1=session-cookie",
          sleep,
          readCapturedRequestContext: async () => null,
          readPageStateRoot: async () => ({
            feed: {
              items: [
                {
                  title: "旧搜索词页面卡片",
                  detail_url:
                    "https://www.xiaohongshu.com/explore/stale-query-001?xsec_token=token-stale-001&xsec_source=pc_search"
                }
              ]
            }
          }),
          callSignature,
          fetchJson
        }
      );

    expect(result).toMatchObject({
      ok: false,
      payload: {
        details: {
          reason: "REQUEST_CONTEXT_MISSING",
          request_context_reason: "template_missing"
        }
      }
    });

    expect(sleep).toHaveBeenCalledTimes(60);
    expect(callSignature).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("returns DOM/state search-card evidence when no passive template appears", async () => {
    const admissionContext = buildLiveReadAdmissionContext({
      runId: "run-source-search-live-dom-state-001",
      sessionId: "nm-session-source-search-live-dom-state-001",
      gateInvocationId: "issue580-gate-run-source-search-live-dom-state-001",
      targetTabId: 11,
      targetPage: "search_result_tab"
    });
    const sleep = vi.fn(async () => {});
    const fetchJson = vi.fn(async () => ({
      status: 200,
      body: {
        code: 0,
        data: {
          items: []
        }
      }
    }));
    const callSignature = vi.fn(async () => ({ "X-s": "sig", "X-t": "1710000000" }));

    const result = await executeXhsSearch(
        {
          abilityId: "xhs.note.search.v1",
          abilityLayer: "L3",
          abilityAction: "read",
          params: {
            query: "露营装备"
          },
          options: {
            issue_scope: "issue_580",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 11,
            target_page: "search_result_tab",
            actual_target_domain: "www.xiaohongshu.com",
            actual_target_tab_id: 11,
            actual_target_page: "search_result_tab",
            action_type: "read",
            risk_state: "allowed",
            requested_execution_mode: "live_read_high_risk",
            upstream_authorization_request: buildCanonicalReadAuthorizationRequest({
              requestRef: "upstream_source_search_live_dom_state_001",
              actionName: "xhs.read_search_results",
              targetPage: "search_result_tab",
              targetTabId: 11,
              profileRef: "profile-a",
              approvalRefs: [
                String(admissionContext.approval_admission_evidence.approval_admission_ref)
              ],
              auditRefs: [String(admissionContext.audit_admission_evidence.audit_admission_ref)]
            }),
            admission_context: admissionContext
          },
          executionContext: {
            runId: "run-source-search-live-dom-state-001",
            sessionId: "nm-session-source-search-live-dom-state-001",
            profile: "profile-a",
            gateInvocationId: "issue580-gate-run-source-search-live-dom-state-001"
          }
        },
        {
          now: () => 1_710_000_000_000,
          randomId: () => "source-req-dom-state-001",
          getLocationHref: () =>
            "https://www.xiaohongshu.com/search_result?keyword=%E9%9C%B2%E8%90%A5%E8%A3%85%E5%A4%87",
          getDocumentTitle: () => "Search Result",
          getReadyState: () => "complete",
          getCookie: () => "a1=session-cookie",
          sleep,
          readCapturedRequestContext: async () => null,
          readPageStateRoot: async () => ({
            feed: {
              items: [
                {
                  title: "露营装备清单",
                  detail_url:
                    "https://www.xiaohongshu.com/explore/note-001?xsec_token=token-001&xsec_source=pc_search",
                  user_home_url:
                    "https://www.xiaohongshu.com/user/profile/user-001?xsec_token=token-user-001&xsec_source=pc_search"
                }
              ]
            }
          }),
          callSignature,
          fetchJson
        }
      );

    expect(result).toMatchObject({
      ok: true,
      payload: {
        summary: {
          capability_result: {
            outcome: "success",
            metrics: {
              count: 1
            }
          },
          route_evidence: {
            evidence_class: "dom_state_extraction",
            extraction_layer: "hydration_state",
            extraction_locator: "window.__INITIAL_STATE__",
            item_kind: "search_card",
            cards: [
              {
                title: "露营装备清单",
                detail_url:
                  "https://www.xiaohongshu.com/explore/note-001?xsec_token=token-001&xsec_source=pc_search",
                user_home_url:
                  "https://www.xiaohongshu.com/user/profile/user-001?xsec_token=token-user-001&xsec_source=pc_search",
                xsec_token: "token-001",
                xsec_source: "pc_search"
              }
            ],
            target_continuity: [
              {
                token_presence: "present",
                source_route: "xhs.search"
              }
            ]
          },
          request_context: {
            status: "missing"
          }
        }
      }
    });
    expect((result.payload.observability as Record<string, unknown>).key_requests).toEqual([]);

    expect(sleep).toHaveBeenCalledTimes(60);
    expect(callSignature).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("keeps request-context waiting inside the command timeout budget", async () => {
    const admissionContext = buildLiveReadAdmissionContext({
      runId: "run-source-search-live-context-timeout-budget-001",
      sessionId: "nm-session-source-search-live-context-timeout-budget-001",
      gateInvocationId: "issue209-gate-run-source-search-live-context-timeout-budget-001",
      targetTabId: 11,
      targetPage: "search_result_tab"
    });
    const sleep = vi.fn(async () => {});
    const fetchJson = vi.fn(async () => ({
      status: 200,
      body: {
        code: 0,
        data: {
          items: []
        }
      }
    }));

    await expect(
      executeXhsSearch(
        {
          abilityId: "xhs.note.search.v1",
          abilityLayer: "L3",
          abilityAction: "read",
          params: {
            query: "露营装备"
          },
          options: {
            timeout_ms: 1_000,
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 11,
            target_page: "search_result_tab",
            actual_target_domain: "www.xiaohongshu.com",
            actual_target_tab_id: 11,
            actual_target_page: "search_result_tab",
            action_type: "read",
            risk_state: "allowed",
            requested_execution_mode: "live_read_high_risk",
            upstream_authorization_request: buildCanonicalReadAuthorizationRequest({
              requestRef: "upstream_source_search_live_context_timeout_budget_001",
              actionName: "xhs.read_search_results",
              targetPage: "search_result_tab",
              targetTabId: 11,
              profileRef: "profile-a",
              approvalRefs: [
                String(admissionContext.approval_admission_evidence.approval_admission_ref)
              ],
              auditRefs: [String(admissionContext.audit_admission_evidence.audit_admission_ref)]
            }),
            admission_context: admissionContext
          },
          executionContext: {
            runId: "run-source-search-live-context-timeout-budget-001",
            sessionId: "nm-session-source-search-live-context-timeout-budget-001",
            profile: "profile-a",
            gateInvocationId: "issue209-gate-run-source-search-live-context-timeout-budget-001"
          }
        },
        {
          now: () => 1_710_000_000_000,
          randomId: () => "source-req-context-timeout-budget-001",
          getLocationHref: () =>
            "https://www.xiaohongshu.com/search_result?keyword=%E9%9C%B2%E8%90%A5%E8%A3%85%E5%A4%87",
          getDocumentTitle: () => "Search Result",
          getReadyState: () => "complete",
          getCookie: () => "a1=session-cookie",
          sleep,
          readCapturedRequestContext: async () => null,
          callSignature: async () => {
            throw new Error("signature should not be used when request context is missing");
          },
          fetchJson
        }
      )
    ).resolves.toMatchObject({
      ok: false,
      payload: {
        details: {
          reason: "REQUEST_CONTEXT_MISSING",
          request_context_reason: "template_missing"
        }
      }
    });

    expect(sleep).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("subtracts elapsed passive action time from the request-context wait budget", async () => {
    const admissionContext = buildLiveReadAdmissionContext({
      runId: "run-source-search-live-context-elapsed-budget-001",
      sessionId: "nm-session-source-search-live-context-elapsed-budget-001",
      gateInvocationId: "issue619-gate-run-source-search-live-context-elapsed-budget-001",
      targetTabId: 11,
      targetPage: "search_result_tab"
    });
    let nowMs = 1_710_000_000_000;
    let lookupCount = 0;
    const sleep = vi.fn(async () => {});
    const fetchJson = vi.fn(async () => ({
      status: 200,
      body: {
        code: 0,
        data: {
          items: []
        }
      }
    }));

    await expect(
      executeXhsSearch(
        {
          abilityId: "xhs.note.search.v1",
          abilityLayer: "L3",
          abilityAction: "read",
          params: {
            query: "露营装备"
          },
          options: {
            timeout_ms: 1_600,
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 11,
            target_page: "search_result_tab",
            actual_target_domain: "www.xiaohongshu.com",
            actual_target_tab_id: 11,
            actual_target_page: "search_result_tab",
            action_type: "read",
            risk_state: "allowed",
            requested_execution_mode: "live_read_high_risk",
            upstream_authorization_request: buildCanonicalReadAuthorizationRequest({
              requestRef: "upstream_source_search_live_context_elapsed_budget_001",
              actionName: "xhs.read_search_results",
              targetPage: "search_result_tab",
              targetTabId: 11,
              profileRef: "profile-a",
              approvalRefs: [
                String(admissionContext.approval_admission_evidence.approval_admission_ref)
              ],
              auditRefs: [String(admissionContext.audit_admission_evidence.audit_admission_ref)]
            }),
            admission_context: admissionContext
          },
          executionContext: {
            runId: "run-source-search-live-context-elapsed-budget-001",
            sessionId: "nm-session-source-search-live-context-elapsed-budget-001",
            profile: "profile-a",
            gateInvocationId: "issue619-gate-run-source-search-live-context-elapsed-budget-001"
          }
        },
        {
          now: () => nowMs,
          randomId: () => "source-req-context-elapsed-budget-001",
          getLocationHref: () =>
            "https://www.xiaohongshu.com/search_result?keyword=%E9%9C%B2%E8%90%A5%E8%A3%85%E5%A4%87",
          getDocumentTitle: () => "Search Result",
          getReadyState: () => "complete",
          getCookie: () => "a1=session-cookie",
          sleep,
          performSearchPassiveAction: async () => {
            nowMs += 600;
            return {
              evidence_class: "humanized_action",
              action_kind: "scroll"
            };
          },
          readCapturedRequestContext: async () => {
            lookupCount += 1;
            return null;
          },
          callSignature: async () => {
            throw new Error("signature should not be used when request context is missing");
          },
          fetchJson
        }
      )
    ).resolves.toMatchObject({
      ok: false,
      payload: {
        details: {
          reason: "REQUEST_CONTEXT_MISSING",
          request_context_reason: "template_missing"
        }
      }
    });

    expect(lookupCount).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("keeps DOM/state fallback fail-closed when state has token but no card link", async () => {
    const admissionContext = buildLiveReadAdmissionContext({
      runId: "run-source-search-live-dom-token-only-001",
      sessionId: "nm-session-source-search-live-dom-token-only-001",
      gateInvocationId: "issue580-gate-run-source-search-live-dom-token-only-001",
      targetTabId: 11,
      targetPage: "search_result_tab"
    });
    const sleep = vi.fn(async () => {});
    const callSignature = vi.fn(async () => ({ "X-s": "sig", "X-t": "1710000000" }));
    const fetchJson = vi.fn(async () => ({ status: 200, body: { code: 0 } }));

    await expect(
      executeXhsSearch(
        {
          abilityId: "xhs.note.search.v1",
          abilityLayer: "L3",
          abilityAction: "read",
          params: {
            query: "露营装备"
          },
          options: {
            issue_scope: "issue_580",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 11,
            target_page: "search_result_tab",
            actual_target_domain: "www.xiaohongshu.com",
            actual_target_tab_id: 11,
            actual_target_page: "search_result_tab",
            action_type: "read",
            risk_state: "allowed",
            requested_execution_mode: "live_read_high_risk",
            upstream_authorization_request: buildCanonicalReadAuthorizationRequest({
              requestRef: "upstream_source_search_live_dom_token_only_001",
              actionName: "xhs.read_search_results",
              targetPage: "search_result_tab",
              targetTabId: 11,
              profileRef: "profile-a",
              approvalRefs: [
                String(admissionContext.approval_admission_evidence.approval_admission_ref)
              ],
              auditRefs: [String(admissionContext.audit_admission_evidence.audit_admission_ref)]
            }),
            admission_context: admissionContext
          },
          executionContext: {
            runId: "run-source-search-live-dom-token-only-001",
            sessionId: "nm-session-source-search-live-dom-token-only-001",
            profile: "profile-a",
            gateInvocationId: "issue580-gate-run-source-search-live-dom-token-only-001"
          }
        },
        {
          now: () => 1_710_000_000_000,
          randomId: () => "source-req-dom-token-only-001",
          getLocationHref: () =>
            "https://www.xiaohongshu.com/search_result?keyword=%E9%9C%B2%E8%90%A5%E8%A3%85%E5%A4%87",
          getDocumentTitle: () => "Search Result",
          getReadyState: () => "complete",
          getCookie: () => "a1=session-cookie",
          sleep,
          readCapturedRequestContext: async () => null,
          readPageStateRoot: async () => ({
            feed: {
              items: [
                {
                  id: "metadata-only-001",
                  title: "只有 token 没有真实卡片链接",
                  detail_url:
                    "https://example.com/explore/not-xhs-001?xsec_token=token-only-001&xsec_source=pc_search",
                  xsec_token: "token-only-001",
                  xsec_source: "pc_search"
                }
              ]
            }
          }),
          callSignature,
          fetchJson
        }
      )
    ).resolves.toMatchObject({
      ok: false,
      payload: {
        details: {
          reason: "REQUEST_CONTEXT_MISSING",
          request_context_reason: "template_missing"
        }
      }
    });

    expect(sleep).toHaveBeenCalledTimes(60);
    expect(callSignature).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("accepts an exact-hit template when the captured request body used the limit alias", async () => {
    const admissionContext = buildLiveReadAdmissionContext({
      runId: "run-source-search-live-limit-alias-001",
      sessionId: "nm-session-source-search-live-limit-alias-001",
      gateInvocationId: "issue209-gate-run-source-search-live-limit-alias-001",
      targetTabId: 11,
      targetPage: "search_result_tab"
    });

    await expect(
      executeXhsSearch(
        {
          abilityId: "xhs.note.search.v1",
          abilityLayer: "L3",
          abilityAction: "read",
          params: {
            query: "露营装备",
            limit: 10
          },
          options: {
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 11,
            target_page: "search_result_tab",
            actual_target_domain: "www.xiaohongshu.com",
            actual_target_tab_id: 11,
            actual_target_page: "search_result_tab",
            action_type: "read",
            risk_state: "allowed",
            requested_execution_mode: "live_read_high_risk",
            upstream_authorization_request: buildCanonicalReadAuthorizationRequest({
              requestRef: "upstream_source_search_live_limit_alias_001",
              actionName: "xhs.read_search_results",
              targetPage: "search_result_tab",
              targetTabId: 11,
              profileRef: "profile-a",
              approvalRefs: [
                String(admissionContext.approval_admission_evidence.approval_admission_ref)
              ],
              auditRefs: [String(admissionContext.audit_admission_evidence.audit_admission_ref)]
            }),
            admission_context: admissionContext
          },
          executionContext: {
            runId: "run-source-search-live-limit-alias-001",
            sessionId: "nm-session-source-search-live-limit-alias-001",
            profile: "profile-a",
            gateInvocationId: "issue209-gate-run-source-search-live-limit-alias-001"
          }
        },
        {
          now: () => 1_710_000_000_000,
          randomId: () => "source-req-limit-alias-001",
          getLocationHref: () => "https://www.xiaohongshu.com/search_result?keyword=%E9%9C%B2%E8%90%A5",
          getDocumentTitle: () => "Search Result",
          getReadyState: () => "complete",
          getCookie: () => "a1=session-cookie",
          sleep: async () => {},
          readCapturedRequestContext: async () => {
            const lookup = createCapturedSearchContextArtifact({
              href: "https://www.xiaohongshu.com/search_result?keyword=%E9%9C%B2%E8%90%A5",
              keyword: "露营装备",
              page_size: 10,
              captured_at: 1_710_000_000_000
            });
            return {
              ...lookup,
              admitted_template: lookup.admitted_template
                ? {
                    ...lookup.admitted_template,
                    request: {
                      ...lookup.admitted_template.request,
                      body: {
                        keyword: "露营装备",
                        page: 1,
                        limit: 10,
                        sort: "general",
                        note_type: 0
                      }
                    }
                  }
                : null
            };
          },
          callSignature: async () => ({ "X-s": "fresh-signature", "X-t": "1710000000" }),
          fetchJson: async () => ({
            status: 200,
            body: {
              code: 0,
              data: {
                items: []
              }
            }
          })
        }
      )
    ).resolves.toMatchObject({
      ok: true,
      payload: {
        summary: {
          request_context: {
            status: "exact_hit"
          }
        }
      }
    });
  });

  it("fails closed when the request-context exact-hit payload is not self-consistent", async () => {
    const fetchJson = vi.fn(async () => ({
      status: 200,
      body: {
        code: 0,
        data: {
          items: []
        }
      }
    }));
    const admissionContext = buildLiveReadAdmissionContext({
      runId: "run-source-search-live-forged-001",
      sessionId: "nm-session-source-search-live-forged-001",
      gateInvocationId: "issue209-gate-run-source-search-live-forged-001",
      targetTabId: 11,
      targetPage: "search_result_tab"
    });

    await expect(
      executeXhsSearch(
        {
          abilityId: "xhs.note.search.v1",
          abilityLayer: "L3",
          abilityAction: "read",
          params: {
            query: "露营装备"
          },
          options: {
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 11,
            target_page: "search_result_tab",
            actual_target_domain: "www.xiaohongshu.com",
            actual_target_tab_id: 11,
            actual_target_page: "search_result_tab",
            action_type: "read",
            risk_state: "allowed",
            requested_execution_mode: "live_read_high_risk",
            upstream_authorization_request: buildCanonicalReadAuthorizationRequest({
              requestRef: "upstream_source_search_live_forged_001",
              actionName: "xhs.read_search_results",
              targetPage: "search_result_tab",
              targetTabId: 11,
              profileRef: "profile-a",
              approvalRefs: [
                String(admissionContext.approval_admission_evidence.approval_admission_ref)
              ],
              auditRefs: [String(admissionContext.audit_admission_evidence.audit_admission_ref)]
            }),
            admission_context: admissionContext
          },
          executionContext: {
            runId: "run-source-search-live-forged-001",
            sessionId: "nm-session-source-search-live-forged-001",
            profile: "profile-a",
            gateInvocationId: "issue209-gate-run-source-search-live-forged-001"
          }
        },
        {
          now: () => 1_710_000_000_000,
          randomId: () => "source-req-forged-001",
          getLocationHref: () => "https://www.xiaohongshu.com/search_result?keyword=%E9%9C%B2%E8%90%A5",
          getDocumentTitle: () => "Search Result",
          getReadyState: () => "complete",
          getCookie: () => "a1=session-cookie",
          sleep: async () => {},
          readCapturedRequestContext: async () => {
            const lookup = createCapturedSearchContextArtifact({
              href: "https://www.xiaohongshu.com/search_result?keyword=%E9%9C%B2%E8%90%A5",
              keyword: "露营装备",
              captured_at: 1_710_000_000_000
            });
            return {
              ...lookup,
              admitted_template: lookup.admitted_template
                ? {
                    ...lookup.admitted_template,
                    request: {
                      ...lookup.admitted_template.request,
                      body: {
                        ...lookup.admitted_template.request.body,
                        keyword: "伪造上下文"
                      }
                    }
                  }
                : null
            };
          },
          callSignature: async () => {
            throw new Error("signature should not be used on untrusted exact hit");
          },
          fetchJson
        }
      )
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "ERR_EXECUTION_FAILED"
      },
      payload: {
        details: {
          reason: "REQUEST_CONTEXT_MISSING",
          request_context_reason: "template_missing"
        },
        observability: {
          failure_site: {
            target: "captured_request_context"
          }
        }
      }
    });

    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("fails closed when the request-context exact-hit URL uses a non-canonical template port", async () => {
    const fetchJson = vi.fn(async () => ({
      status: 200,
      body: {
        code: 0,
        data: {
          items: []
        }
      }
    }));
    const admissionContext = buildLiveReadAdmissionContext({
      runId: "run-source-search-live-untrusted-url-001",
      sessionId: "nm-session-source-search-live-untrusted-url-001",
      gateInvocationId: "issue209-gate-run-source-search-live-untrusted-url-001",
      targetTabId: 11,
      targetPage: "search_result_tab"
    });

    await expect(
      executeXhsSearch(
        {
          abilityId: "xhs.note.search.v1",
          abilityLayer: "L3",
          abilityAction: "read",
          params: {
            query: "露营装备"
          },
          options: {
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 11,
            target_page: "search_result_tab",
            actual_target_domain: "www.xiaohongshu.com",
            actual_target_tab_id: 11,
            actual_target_page: "search_result_tab",
            action_type: "read",
            risk_state: "allowed",
            requested_execution_mode: "live_read_high_risk",
            upstream_authorization_request: buildCanonicalReadAuthorizationRequest({
              requestRef: "upstream_source_search_live_untrusted_url_001",
              actionName: "xhs.read_search_results",
              targetPage: "search_result_tab",
              targetTabId: 11,
              profileRef: "profile-a",
              approvalRefs: [
                String(admissionContext.approval_admission_evidence.approval_admission_ref)
              ],
              auditRefs: [String(admissionContext.audit_admission_evidence.audit_admission_ref)]
            }),
            admission_context: admissionContext
          },
          executionContext: {
            runId: "run-source-search-live-untrusted-url-001",
            sessionId: "nm-session-source-search-live-untrusted-url-001",
            profile: "profile-a",
            gateInvocationId: "issue209-gate-run-source-search-live-untrusted-url-001"
          }
        },
        {
          now: () => 1_710_000_000_000,
          randomId: () => "source-req-untrusted-url-001",
          getLocationHref: () => "https://www.xiaohongshu.com/search_result?keyword=%E9%9C%B2%E8%90%A5",
          getDocumentTitle: () => "Search Result",
          getReadyState: () => "complete",
          getCookie: () => "a1=session-cookie",
          sleep: async () => {},
          readCapturedRequestContext: async () =>
            createCapturedSearchContextArtifact({
              href: "https://www.xiaohongshu.com/search_result?keyword=%E9%9C%B2%E8%90%A5",
              keyword: "露营装备",
              captured_at: 1_710_000_000_000,
              templateUrl: "https://edith.xiaohongshu.com:8443/api/sns/web/v1/search/notes"
            }),
          callSignature: async () => {
            throw new Error("signature should not be used on untrusted exact-hit URL");
          },
          fetchJson
        }
      )
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "ERR_EXECUTION_FAILED"
      },
      payload: {
        details: {
          reason: "REQUEST_CONTEXT_MISSING",
          request_context_reason: "template_missing"
        }
      }
    });

    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("fails closed when request-context lookup raises instead of downgrading to a generic execution error", async () => {
    const fetchJson = vi.fn(async () => ({
      status: 200,
      body: {
        code: 0,
        data: {
          items: []
        }
      }
    }));
    const admissionContext = buildLiveReadAdmissionContext({
      runId: "run-source-search-live-lookup-error-001",
      sessionId: "nm-session-source-search-live-lookup-error-001",
      gateInvocationId: "issue209-gate-run-source-search-live-lookup-error-001",
      targetTabId: 11,
      targetPage: "search_result_tab"
    });

    await expect(
      executeXhsSearch(
        {
          abilityId: "xhs.note.search.v1",
          abilityLayer: "L3",
          abilityAction: "read",
          params: {
            query: "露营装备"
          },
          options: {
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 11,
            target_page: "search_result_tab",
            actual_target_domain: "www.xiaohongshu.com",
            actual_target_tab_id: 11,
            actual_target_page: "search_result_tab",
            action_type: "read",
            risk_state: "allowed",
            requested_execution_mode: "live_read_high_risk",
            upstream_authorization_request: buildCanonicalReadAuthorizationRequest({
              requestRef: "upstream_source_search_live_lookup_error_001",
              actionName: "xhs.read_search_results",
              targetPage: "search_result_tab",
              targetTabId: 11,
              profileRef: "profile-a",
              approvalRefs: [
                String(admissionContext.approval_admission_evidence.approval_admission_ref)
              ],
              auditRefs: [String(admissionContext.audit_admission_evidence.audit_admission_ref)]
            }),
            admission_context: admissionContext
          },
          executionContext: {
            runId: "run-source-search-live-lookup-error-001",
            sessionId: "nm-session-source-search-live-lookup-error-001",
            profile: "profile-a",
            gateInvocationId: "issue209-gate-run-source-search-live-lookup-error-001"
          }
        },
        {
          now: () => 1_710_000_000_000,
          randomId: () => "source-req-lookup-error-001",
          getLocationHref: () => "https://www.xiaohongshu.com/search_result?keyword=%E9%9C%B2%E8%90%A5",
          getDocumentTitle: () => "Search Result",
          getReadyState: () => "complete",
          getCookie: () => "a1=session-cookie",
          sleep: async () => {},
          readCapturedRequestContext: async () => {
            throw new Error("main-world lookup transport failed");
          },
          callSignature: async () => {
            throw new Error("signature should not be used on request-context read failure");
          },
          fetchJson
        }
      )
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "ERR_EXECUTION_FAILED"
      },
      payload: {
        details: {
          reason: "REQUEST_CONTEXT_MISSING",
          request_context_reason: "template_missing"
        },
        observability: {
          failure_site: {
            target: "captured_request_context"
          }
        }
      }
    });

    expect(fetchJson).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "template_missing",
      lookup: async () => ({
        page_context_namespace: createPageContextNamespace(
          "https://www.xiaohongshu.com/search_result?keyword=missing"
        ),
        shape_key: serializeSearchRequestShape(createSearchRequestShape({ keyword: "missing" })!),
        admitted_template: null,
        rejected_observation: null,
        incompatible_observation: null,
        available_shape_keys: []
      }),
      reason: "REQUEST_CONTEXT_MISSING",
      requestContextReason: "template_missing"
    },
    {
      label: "shape_mismatch",
      lookup: async () => ({
        ...createCapturedSearchContextArtifact({
          href: "https://www.xiaohongshu.com/search_result?keyword=camping",
          keyword: "camping",
          captured_at: 1_710_000_000_000
        }),
        admitted_template: null,
        available_shape_keys: [
          serializeSearchRequestShape(createSearchRequestShape({ keyword: "camping" })!)
        ],
        incompatible_observation: {
          ...(createCapturedSearchContextArtifact({
            href: "https://www.xiaohongshu.com/search_result?keyword=camping",
            keyword: "camping",
            captured_at: 1_710_000_000_000
          }).admitted_template as Record<string, unknown>),
          incompatibility_reason: "shape_mismatch"
        }
      }),
      reason: "REQUEST_CONTEXT_INCOMPATIBLE",
      requestContextReason: "shape_mismatch"
    },
    {
      label: "rejected_source",
      lookup: async () =>
        createCapturedSearchContextArtifact({
          href: "https://www.xiaohongshu.com/search_result?keyword=rejected",
          keyword: "rejected",
          captured_at: 1_710_000_000_000,
          template_ready: false,
          rejection_reason: "failed_request_rejected"
        }),
      reason: "GATEWAY_INVOKER_FAILED",
      requestContextReason: "rejected_source",
      rejectedSourceReason: "GATEWAY_INVOKER_FAILED"
    },
    {
      label: "rejected_source_account_abnormal",
      lookup: async () =>
        createCapturedSearchContextArtifact({
          href: "https://www.xiaohongshu.com/search_result?keyword=account-risk",
          keyword: "account-risk",
          captured_at: 1_710_000_000_000,
          template_ready: false,
          rejection_reason: "failed_request_rejected",
          rejectedStatus: 461,
          responseBody: {
            code: 300011,
            msg: "账号异常"
          }
        }),
      reason: "ACCOUNT_ABNORMAL",
      requestContextReason: "rejected_source",
      rejectedSourceReason: "ACCOUNT_ABNORMAL",
      statusCode: 461,
      platformCode: 300011
    },
    {
      label: "template_stale",
      lookup: async () =>
        createCapturedSearchContextArtifact({
          href: "https://www.xiaohongshu.com/search_result?keyword=stale",
          keyword: "stale",
          captured_at: 1_710_000_000_000 - 10 * 60 * 1000
        }),
      reason: "REQUEST_CONTEXT_MISSING",
      requestContextReason: "template_stale"
    }
  ])("keeps bundled xhs.search fail-closed diagnostics for $label", async (testCase) => {
    const runId = `run-bundled-${testCase.label}`;
    const admissionContext = buildLiveReadAdmissionContext({
      runId,
      sessionId: `nm-session-bundled-${testCase.label}`,
      gateInvocationId: `issue209-gate-${testCase.label}`,
      targetTabId: 21,
      targetPage: "search_result_tab"
    });
    await expect(
      executeBundledXhsCommand(contentScriptBuildPath, {
        moduleVar: "__webenvoy_module_xhs_search",
        exportName: "executeXhsSearch",
        commandInput: {
          abilityId: "xhs.note.search.v1",
          abilityLayer: "L3",
          abilityAction: "read",
          params: {
            query:
              testCase.label === "template_missing"
                ? "missing"
                : testCase.label === "shape_mismatch"
                  ? "mismatch"
                  : testCase.label === "rejected_source"
                    ? "rejected"
                    : testCase.label === "rejected_source_account_abnormal"
                      ? "account-risk"
                    : "stale"
          },
          options: {
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 21,
            target_page: "search_result_tab",
            actual_target_domain: "www.xiaohongshu.com",
            actual_target_tab_id: 21,
            actual_target_page: "search_result_tab",
            action_type: "read",
            risk_state: "allowed",
            requested_execution_mode: "live_read_high_risk",
            upstream_authorization_request: buildCanonicalReadAuthorizationRequest({
              requestRef: `upstream_${testCase.label}`,
              actionName: "xhs.read_search_results",
              targetPage: "search_result_tab",
              targetTabId: 21,
              profileRef: "profile-a",
              approvalRefs: [
                String(admissionContext.approval_admission_evidence.approval_admission_ref)
              ],
              auditRefs: [String(admissionContext.audit_admission_evidence.audit_admission_ref)]
            }),
            admission_context: admissionContext
          },
          executionContext: {
            runId,
            sessionId: `nm-session-bundled-${testCase.label}`,
            profile: "profile-a",
            gateInvocationId: `issue209-gate-${testCase.label}`
          }
        },
        envOverrides: {
          getCookie: () => "a1=session-cookie",
          sleep: async () => {},
          readCapturedRequestContext: testCase.lookup,
          callSignature: async () => {
            throw new Error("signature should not be used on fail-closed path");
          },
          fetchJson: async () => {
            throw new Error("network request should not be used on fail-closed path");
          }
        }
      })
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "ERR_EXECUTION_FAILED"
      },
      payload: {
        details: {
          reason: testCase.reason,
          request_context_reason: testCase.requestContextReason,
          ...(testCase.rejectedSourceReason
            ? { rejected_source_reason: testCase.rejectedSourceReason }
            : {}),
          ...(testCase.statusCode ? { status_code: testCase.statusCode } : {}),
          ...(testCase.platformCode ? { platform_code: testCase.platformCode } : {})
        }
      }
    });
  });

  it("executes bundled xhs.detail live-read path without missing issue209 post-gate artifacts helper", async () => {
    const admissionContext = buildLiveReadAdmissionContext({
      runId: "run-bundled-detail-live-001",
      sessionId: "nm-session-bundled-detail-live-001",
      gateInvocationId: "issue209-gate-run-bundled-detail-live-001",
      targetTabId: 18,
      targetPage: "explore_detail_tab"
    });

    await expect(
      executeBundledXhsCommand(contentScriptBuildPath, {
        moduleVar: "__webenvoy_module_xhs_detail",
        exportName: "executeXhsDetail",
        commandInput: {
          abilityId: "xhs.note.detail.v1",
          abilityLayer: "L3",
          abilityAction: "read",
          params: {
            note_id: "note-live-bundled-001"
          },
          options: {
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 18,
            target_page: "explore_detail_tab",
            actual_target_domain: "www.xiaohongshu.com",
            actual_target_tab_id: 18,
            actual_target_page: "explore_detail_tab",
            action_type: "read",
            risk_state: "allowed",
            requested_execution_mode: "live_read_high_risk",
            upstream_authorization_request: buildCanonicalReadAuthorizationRequest({
              requestRef: "upstream_bundled_detail_live_001",
              actionName: "xhs.read_note_detail",
              targetPage: "explore_detail_tab",
              targetTabId: 18,
              profileRef: "profile-a",
              approvalRefs: [
                String(admissionContext.approval_admission_evidence.approval_admission_ref)
              ],
              auditRefs: [String(admissionContext.audit_admission_evidence.audit_admission_ref)]
            }),
            admission_context: admissionContext,
            simulate_result: "success"
          },
          executionContext: {
            runId: "run-bundled-detail-live-001",
            sessionId: "nm-session-bundled-detail-live-001",
            profile: "profile-a",
            gateInvocationId: "issue209-gate-run-bundled-detail-live-001"
          }
        },
        envOverrides: {
          getLocationHref: () => "https://www.xiaohongshu.com/explore/note-live-bundled-001",
          getDocumentTitle: () => "Detail Page"
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      payload: {
        summary: {
          capability_result: {
            ability_id: "xhs.note.detail.v1",
            outcome: "success"
          },
          consumer_gate_result: {
            requested_execution_mode: "live_read_high_risk",
            gate_decision: "allowed"
          },
          execution_audit: {
            request_admission_decision: "allowed"
          },
          audit_record: {
            requested_execution_mode: "live_read_high_risk",
            gate_decision: "allowed"
          }
        }
      }
    });
  });

  it("executes bundled xhs.user_home live-read path without missing issue209 post-gate artifacts helper", async () => {
    const admissionContext = buildLiveReadAdmissionContext({
      runId: "run-bundled-user-home-live-001",
      sessionId: "nm-session-bundled-user-home-live-001",
      gateInvocationId: "issue209-gate-run-bundled-user-home-live-001",
      targetTabId: 19,
      targetPage: "profile_tab"
    });

    await expect(
      executeBundledXhsCommand(contentScriptBuildPath, {
        moduleVar: "__webenvoy_module_xhs_user_home",
        exportName: "executeXhsUserHome",
        commandInput: {
          abilityId: "xhs.user.home.v1",
          abilityLayer: "L3",
          abilityAction: "read",
          params: {
            user_id: "user-live-bundled-001"
          },
          options: {
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 19,
            target_page: "profile_tab",
            actual_target_domain: "www.xiaohongshu.com",
            actual_target_tab_id: 19,
            actual_target_page: "profile_tab",
            action_type: "read",
            risk_state: "allowed",
            requested_execution_mode: "live_read_high_risk",
            upstream_authorization_request: buildCanonicalReadAuthorizationRequest({
              requestRef: "upstream_bundled_user_home_live_001",
              actionName: "xhs.read_user_home",
              targetPage: "profile_tab",
              targetTabId: 19,
              profileRef: "profile-a",
              approvalRefs: [
                String(admissionContext.approval_admission_evidence.approval_admission_ref)
              ],
              auditRefs: [String(admissionContext.audit_admission_evidence.audit_admission_ref)]
            }),
            admission_context: admissionContext,
            simulate_result: "success"
          },
          executionContext: {
            runId: "run-bundled-user-home-live-001",
            sessionId: "nm-session-bundled-user-home-live-001",
            profile: "profile-a",
            gateInvocationId: "issue209-gate-run-bundled-user-home-live-001"
          }
        },
        envOverrides: {
          getLocationHref: () => "https://www.xiaohongshu.com/user/profile/user-live-bundled-001",
          getDocumentTitle: () => "User Home"
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      payload: {
        summary: {
          capability_result: {
            ability_id: "xhs.user.home.v1",
            outcome: "success"
          },
          consumer_gate_result: {
            requested_execution_mode: "live_read_high_risk",
            gate_decision: "allowed"
          },
          execution_audit: {
            request_admission_decision: "allowed"
          },
          audit_record: {
            requested_execution_mode: "live_read_high_risk",
            gate_decision: "allowed"
          }
        }
      }
    });
  });

  it("keeps background build artifact aligned with xhs gate contract markers", () => {
    const backgroundBuild = fs.readFileSync(backgroundBuildPath, "utf8");
    expect(backgroundBuild).toContain("live_read_limited");
    expect(backgroundBuild).toContain("plugin_gate_ownership");
    expect(backgroundBuild).toContain("read_execution_policy");
    expect(backgroundBuild).toContain("risk_state_output");
    expect(backgroundBuild).toContain("conditional_actions");
    expect(backgroundBuild).toContain("risk_transition_audit");
    expect(backgroundBuild).toContain("recovery_requirements");
  });
});
