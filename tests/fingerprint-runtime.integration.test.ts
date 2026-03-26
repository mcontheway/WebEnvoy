import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer as createNetServer, Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { startChromeBackgroundBridge } from "../extension/background.js";

const repoRoot = path.resolve(path.join(import.meta.dirname, ".."));
const binPath = path.join(repoRoot, "bin", "webenvoy");
const wrapperPath = path.join(repoRoot, "tests", "fixtures", "real-browser-wrapper.sh");

const realBrowserIntegrationEnabled = process.env.WEBENVOY_REAL_BROWSER_TEST === "1";
const itWithRealBrowser = realBrowserIntegrationEnabled ? it : it.skip;

const tempDirs: string[] = [];

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const runStage = async <T>(
  state: { current: string; history: string[] },
  stage: string,
  work: () => Promise<T>,
  timeoutMs: number = 25_000
): Promise<T> => {
  state.current = stage;
  state.history.push(stage);
  const startedAt = Date.now();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`stage timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([work(), timeout]);
  } catch (error) {
    throw new Error(
      `real-browser stage failed at "${stage}" after ${Date.now() - startedAt}ms ` +
        `(history=${state.history.join(" -> ")}): ${toErrorMessage(error)}`
    );
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const extractPingFingerprintRuntime = (
  pingBody: Record<string, unknown>
): {
  summary: Record<string, unknown> | null;
  payload: Record<string, unknown> | null;
  fingerprintRuntime: Record<string, unknown> | null;
  injection: Record<string, unknown> | null;
  diagnostics: Record<string, unknown>;
} => {
  const summary = asRecord(pingBody.summary);
  const payload = asRecord(summary?.payload);
  const summaryFingerprintRuntime = asRecord(summary?.fingerprint_runtime);
  const payloadFingerprintRuntime = asRecord(payload?.fingerprint_runtime);
  const fingerprintRuntime = summaryFingerprintRuntime ?? payloadFingerprintRuntime;
  const injection = asRecord(fingerprintRuntime?.injection);
  return {
    summary,
    payload,
    fingerprintRuntime,
    injection,
    diagnostics: {
      hasSummary: summary !== null,
      hasPayload: payload !== null,
      hasSummaryFingerprintRuntime: summaryFingerprintRuntime !== null,
      hasPayloadFingerprintRuntime: payloadFingerprintRuntime !== null,
      fingerprintRuntime,
      injection
    }
  };
};

const createMockPort = () => {
  const onMessageListeners: Array<(message: Record<string, unknown>) => void> = [];
  const onDisconnectListeners: Array<() => void> = [];
  const postMessage = vi.fn();

  return {
    postMessage,
    onMessageListeners,
    onDisconnectListeners,
    port: {
      postMessage,
      onMessage: {
        addListener: (listener: (message: Record<string, unknown>) => void) => {
          onMessageListeners.push(listener);
        }
      },
      onDisconnect: {
        addListener: (listener: () => void) => {
          onDisconnectListeners.push(listener);
        }
      },
      disconnect: vi.fn()
    }
  };
};

const createChromeApi = (ports: ReturnType<typeof createMockPort>[]) => {
  let connectIndex = 0;
  const runtimeMessageListeners: Array<
    (message: unknown, sender: { tab?: { id?: number } }) => void
  > = [];
  const chromeApi = {
    runtime: {
      connectNative: vi.fn(() => {
        const current = ports[Math.min(connectIndex, ports.length - 1)];
        connectIndex += 1;
        return current.port;
      }),
      onMessage: {
        addListener: (listener: (message: unknown, sender: { tab?: { id?: number } }) => void) => {
          runtimeMessageListeners.push(listener);
        }
      },
      onInstalled: {
        addListener: vi.fn()
      },
      onStartup: {
        addListener: vi.fn()
      }
    },
    tabs: {
      query: vi.fn(async () => [{ id: 11 }]),
      sendMessage: vi.fn(async () => {})
    }
  };

  return {
    chromeApi,
    runtimeMessageListeners
  };
};

const respondHandshake = (
  mockPort: ReturnType<typeof createMockPort>,
  options?: { protocol?: string; sessionId?: string }
) => {
  const protocol = options?.protocol ?? "webenvoy.native-bridge.v1";
  const sessionId = options?.sessionId ?? "nm-session-001";
  const handshakeCall = mockPort.postMessage.mock.calls.find(
    (call) => (call[0] as { method?: string }).method === "bridge.open"
  );
  expect(handshakeCall).toBeDefined();
  const handshakeId = String((handshakeCall?.[0] as { id: string }).id);
  mockPort.onMessageListeners[0]?.({
    id: handshakeId,
    status: "success",
    summary: {
      protocol,
      session_id: sessionId,
      state: "ready"
    },
    error: null
  });
};

const createRuntimeCwd = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), "webenvoy-real-browser-int-"));
  tempDirs.push(dir);
  return dir;
};

const parseSingleJsonLine = (stdout: string): Record<string, unknown> => {
  const lines = stdout
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0]) as Record<string, unknown>;
};

const readStagedBootstrapDiagnostics = async (
  profileDir: string,
  runId: string
): Promise<Record<string, unknown>> => {
  const stagedDir = path.join(profileDir, "__webenvoy_extension_staging", runId);
  const bootstrapJsonPath = path.join(stagedDir, "__webenvoy_fingerprint_bootstrap.json");
  const bootstrapScriptPath = path.join(stagedDir, "build", "__webenvoy_fingerprint_bootstrap.js");
  const manifestPath = path.join(stagedDir, "manifest.json");

  const diagnostics: Record<string, unknown> = {
    stagedDir,
    bootstrapJsonExists: false,
    bootstrapScriptExists: false,
    manifestExists: false,
    hasExtensionBootstrap: false,
    hasBootstrapFingerprintRuntime: false,
    manifestInjectsBootstrapScript: false,
    manifestInjectsMainWorldBridgeScript: false
  };

  try {
    const bootstrapJsonRaw = await readFile(bootstrapJsonPath, "utf8");
    diagnostics.bootstrapJsonExists = true;
    const bootstrapJson = JSON.parse(bootstrapJsonRaw) as Record<string, unknown>;
    const extensionBootstrap = asRecord(bootstrapJson.extension_bootstrap);
    diagnostics.hasExtensionBootstrap = extensionBootstrap !== null;
    diagnostics.hasBootstrapFingerprintRuntime =
      asRecord(extensionBootstrap?.fingerprint_runtime ?? null) !== null;
  } catch {
    // ignore read failures for diagnostics
  }

  try {
    const bootstrapScriptRaw = await readFile(bootstrapScriptPath, "utf8");
    diagnostics.bootstrapScriptExists = true;
    diagnostics.bootstrapScriptContainsPayloadKey =
      bootstrapScriptRaw.includes("__webenvoy_fingerprint_bootstrap_payload__");
    diagnostics.bootstrapScriptContainsFingerprintRuntime =
      bootstrapScriptRaw.includes("fingerprint_runtime");
  } catch {
    // ignore read failures for diagnostics
  }

  try {
    const manifestRaw = await readFile(manifestPath, "utf8");
    diagnostics.manifestExists = true;
    const manifest = JSON.parse(manifestRaw) as Record<string, unknown>;
    const contentScripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];
    diagnostics.manifestInjectsBootstrapScript = contentScripts.some((entry) => {
      const record = asRecord(entry);
      const js = Array.isArray(record?.js) ? record.js.filter((item): item is string => typeof item === "string") : [];
      const bootstrapIndex = js.indexOf("build/__webenvoy_fingerprint_bootstrap.js");
      const contentIndex = js.indexOf("build/content-script.js");
      return bootstrapIndex >= 0 && contentIndex >= 0 && bootstrapIndex < contentIndex;
    });
    diagnostics.manifestInjectsMainWorldBridgeScript = contentScripts.some((entry) => {
      const record = asRecord(entry);
      const js = Array.isArray(record?.js)
        ? record.js.filter((item): item is string => typeof item === "string")
        : [];
      return record?.world === "MAIN" && js.includes("build/main-world-bridge.js");
    });
  } catch {
    // ignore read failures for diagnostics
  }

  return diagnostics;
};

const runCli = (
  args: string[],
  cwd: string,
  env: Record<string, string>
): { status: number | null; stdout: string; stderr: string } =>
  spawnSync(process.execPath, [binPath, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 30_000
  });

const detectSystemChromePath = (): string | null => {
  const envPath = process.env.WEBENVOY_REAL_CHROME_BIN;
  if (typeof envPath === "string" && envPath.length > 0) {
    return envPath;
  }
  const candidates =
    process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : process.platform === "linux"
        ? ["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/bin/chromium"]
        : [
            "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
            "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
          ];
  for (const candidate of candidates) {
    const check = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (check.status === 0) {
      return candidate;
    }
  }
  return null;
};

const resolveCdpPort = async (): Promise<number> => {
  const raw = process.env.WEBENVOY_TEST_CDP_PORT;
  if (typeof raw === "string" && raw.length > 0) {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`invalid WEBENVOY_TEST_CDP_PORT: ${raw}`);
    }
    return parsed;
  }

  const server = createNetServer();
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("failed to allocate cdp port"));
        return;
      }
      resolve(address.port);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  return port;
};

const fetchWithTimeout = async (
  url: string,
  options?: RequestInit,
  timeoutMs: number = 2_000
): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const toText = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return Buffer.from(value).toString("utf8");
  }
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("utf8");
  }
  return String(value);
};

const safeJsonStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return JSON.stringify({
      stringifyError: toErrorMessage(error)
    });
  }
};

const waitForPageWebSocketUrl = async (
  cdpPort: number,
  startUrl: string,
  timeoutMs: number
): Promise<string> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetchWithTimeout(`http://127.0.0.1:${cdpPort}/json/list`);
      if (response.ok) {
        const payload = await response.json();
        if (Array.isArray(payload)) {
          const pageTargets = payload
            .map((item) => asRecord(item))
            .filter((item): item is Record<string, unknown> => item !== null)
            .filter(
              (target) =>
                target.type === "page" &&
                typeof target.webSocketDebuggerUrl === "string" &&
                typeof target.url === "string" &&
                !target.url.startsWith("chrome-extension://") &&
                !target.url.startsWith("devtools://")
            );
          const exactTarget = pageTargets.find((target) => String(target.url) === startUrl);
          if (exactTarget && typeof exactTarget.webSocketDebuggerUrl === "string") {
            return exactTarget.webSocketDebuggerUrl;
          }
          const prefixTarget = pageTargets.find((target) =>
            String(target.url).startsWith(startUrl)
          );
          if (prefixTarget && typeof prefixTarget.webSocketDebuggerUrl === "string") {
            return prefixTarget.webSocketDebuggerUrl;
          }
        }
      }
    } catch {
      // ignore CDP probing failure and retry
    }
    await wait(250);
  }
  throw new Error(`unable to resolve page websocket target for ${startUrl}`);
};

const waitForBrowserWebSocketUrl = async (cdpPort: number, timeoutMs: number): Promise<string> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetchWithTimeout(`http://127.0.0.1:${cdpPort}/json/version`);
      if (response.ok) {
        const payload = asRecord(await response.json());
        const wsUrl = payload?.webSocketDebuggerUrl;
        if (typeof wsUrl === "string" && wsUrl.length > 0) {
          return wsUrl;
        }
      }
    } catch {
      // ignore transient CDP probing failures
    }
    await wait(200);
  }
  throw new Error("unable to resolve browser-level CDP websocket url");
};

const ensurePageTargetWebSocketUrl = async (
  cdpPort: number,
  startUrl: string,
  timeoutMs: number
): Promise<string> => {
  const discoverOnlyWindowMs = Math.max(2_000, Math.min(8_000, Math.floor(timeoutMs / 2)));
  try {
    return await waitForPageWebSocketUrl(cdpPort, startUrl, discoverOnlyWindowMs);
  } catch {
    // fall through to browser-level diagnostics + creation path
  }

  let browserWsUrl: string | null = null;
  let browserLevelHealthy = false;
  try {
    browserWsUrl = await waitForBrowserWebSocketUrl(cdpPort, 5_000);
    browserLevelHealthy = true;
  } catch (error) {
    throw new Error(
      `unable to resolve page target and browser-level CDP is unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  const creationErrors: string[] = [];
  const jsonNewUrl = `http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(startUrl)}`;
  try {
    const response = await fetchWithTimeout(jsonNewUrl, { method: "PUT" }, 5_000);
    if (!response.ok) {
      throw new Error(`status=${response.status}`);
    }
  } catch (error) {
    creationErrors.push(
      `/json/new failed: ${error instanceof Error ? error.message : String(error)}`
    );
    if (browserWsUrl) {
      try {
        await withCdpSession(browserWsUrl, async (send) => {
          await send("Target.createTarget", { url: startUrl });
        });
      } catch (createError) {
        creationErrors.push(
          `Target.createTarget failed: ${
            createError instanceof Error ? createError.message : String(createError)
          }`
        );
      }
    }
  }

  try {
    return await waitForPageWebSocketUrl(cdpPort, startUrl, Math.max(2_000, timeoutMs - discoverOnlyWindowMs));
  } catch (error) {
    throw new Error(
      `page target still missing after explicit creation (browserLevelHealthy=${String(browserLevelHealthy)}; creationErrors=${creationErrors.join(
        " | "
      ) || "none"}): ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

const createPageTargetWebSocketUrl = async (
  cdpPort: number,
  targetUrl: string,
  timeoutMs: number
): Promise<string> => {
  const browserWsUrl = await waitForBrowserWebSocketUrl(cdpPort, timeoutMs);
  await withCdpSession(browserWsUrl, async (send) => {
    await send("Target.createTarget", { url: targetUrl });
  });
  return await waitForPageWebSocketUrl(cdpPort, targetUrl, timeoutMs);
};

const readBrowserTargetDiagnostics = async (
  browserWsUrl: string,
  options?: { probeUrl?: string }
): Promise<Record<string, unknown>> =>
  await withCdpSession(browserWsUrl, async (send) => {
    const result = await send("Target.getTargets");
    const targetInfos = Array.isArray(result.targetInfos) ? result.targetInfos : [];
    const targets = targetInfos
      .map((item) => asRecord(item))
      .filter((item): item is Record<string, unknown> => item !== null)
      .map((item) => ({
        targetId: typeof item.targetId === "string" ? item.targetId : null,
        type: typeof item.type === "string" ? item.type : null,
        title: typeof item.title === "string" ? item.title : null,
        url: typeof item.url === "string" ? item.url : null,
        attached: item.attached === true,
        subtype: typeof item.subtype === "string" ? item.subtype : null
      }));

    const byType: Record<string, number> = {};
    for (const target of targets) {
      const key = target.type ?? "unknown";
      byType[key] = (byType[key] ?? 0) + 1;
    }

    const probeUrl = options?.probeUrl;
    const nonProbeTargets =
      typeof probeUrl === "string" && probeUrl.length > 0
        ? targets.filter((target) => target.url !== probeUrl)
        : targets;
    const extensionServiceWorkerTargets = targets.filter(
      (target) =>
        target.type === "service_worker" &&
        typeof target.url === "string" &&
        target.url.startsWith("chrome-extension://")
    );

    return {
      targetCount: targets.length,
      byType,
      hasExtensionServiceWorker: extensionServiceWorkerTargets.length > 0,
      extensionServiceWorkerTargets: extensionServiceWorkerTargets.slice(0, 8),
      nonProbeTargets: nonProbeTargets.slice(0, 16),
      targets: targets.slice(0, 32)
    };
  });

const waitForBrowserTargetDiagnostics = async (
  browserWsUrl: string,
  timeoutMs: number,
  options?: { probeUrl?: string; requireExtensionServiceWorker?: boolean }
): Promise<Record<string, unknown>> => {
  const deadline = Date.now() + timeoutMs;
  let lastDiagnostics: Record<string, unknown> | null = null;
  while (Date.now() < deadline) {
    const diagnostics = await readBrowserTargetDiagnostics(browserWsUrl, options);
    lastDiagnostics = diagnostics;
    if (options?.requireExtensionServiceWorker !== true || diagnostics.hasExtensionServiceWorker === true) {
      return diagnostics;
    }
    await wait(250);
  }
  throw new Error(
    `browser target diagnostics did not satisfy requirements within timeout: ${safeJsonStringify(lastDiagnostics)}`
  );
};

const collectRealBrowserFailureDiagnostics = async (params: {
  cdpPort: number;
  probeUrl: string;
  browserWsUrl: string | null;
}): Promise<Record<string, unknown>> => {
  const diagnostics: Record<string, unknown> = {
    cdpPort: params.cdpPort,
    probeUrl: params.probeUrl,
    browserWebSocketUrl: params.browserWsUrl
  };

  let browserWsUrl = params.browserWsUrl;
  if (!browserWsUrl) {
    try {
      browserWsUrl = await waitForBrowserWebSocketUrl(params.cdpPort, 3_000);
      diagnostics.browserWebSocketUrl = browserWsUrl;
      diagnostics.browserWebSocketRecovered = true;
    } catch (error) {
      diagnostics.browserWebSocketRecoverError = toErrorMessage(error);
    }
  }

  if (browserWsUrl) {
    try {
      diagnostics.browserTargets = await readBrowserTargetDiagnostics(browserWsUrl, {
        probeUrl: params.probeUrl
      });
    } catch (error) {
      diagnostics.browserTargetSnapshotError = toErrorMessage(error);
    }
  }

  return diagnostics;
};

type PageTargetSnapshot = {
  id: string;
  url: string;
  title: string;
  webSocketDebuggerUrl: string;
};

const extractTargetIdFromWsUrl = (wsUrl: string): string => {
  const match = wsUrl.match(/\/devtools\/page\/([^/?#]+)/);
  if (!match || typeof match[1] !== "string" || match[1].length === 0) {
    throw new Error(`unable to parse target id from websocket url: ${wsUrl}`);
  }
  return match[1];
};

const waitForTargetSnapshotByWsUrl = async (
  cdpPort: number,
  wsUrl: string,
  timeoutMs: number
): Promise<PageTargetSnapshot> => {
  const targetId = extractTargetIdFromWsUrl(wsUrl);
  return await waitForTargetSnapshotById(cdpPort, targetId, timeoutMs);
};

const waitForTargetSnapshotById = async (
  cdpPort: number,
  targetId: string,
  timeoutMs: number
): Promise<PageTargetSnapshot> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetchWithTimeout(`http://127.0.0.1:${cdpPort}/json/list`);
      if (response.ok) {
        const payload = await response.json();
        if (Array.isArray(payload)) {
          const target = payload
            .map((item) => asRecord(item))
            .find((item) => item?.type === "page" && item.id === targetId);
          if (
            target &&
            typeof target.webSocketDebuggerUrl === "string" &&
            typeof target.url === "string"
          ) {
            return {
              id: String(target.id),
              url: target.url,
              title: typeof target.title === "string" ? target.title : "",
              webSocketDebuggerUrl: target.webSocketDebuggerUrl
            };
          }
        }
      }
    } catch {
      // ignore transient CDP probing failures
    }
    await wait(250);
  }
  throw new Error(`unable to resolve target snapshot for target id: ${targetId}`);
};

type CdpSend = (
  method: string,
  params?: Record<string, unknown>
) => Promise<Record<string, unknown>>;

type CdpEvent = {
  method: string;
  params?: Record<string, unknown>;
};

type CdpSessionOptions = {
  onEvent?: (event: CdpEvent) => void;
};

const withCdpSession = async <T>(
  wsUrl: string,
  run: (send: CdpSend) => Promise<T>,
  options?: CdpSessionOptions
): Promise<T> => {
  if (typeof WebSocket !== "function") {
    throw new Error("global WebSocket is unavailable; Node >= 22 is required");
  }
  const ws = new WebSocket(wsUrl);
  const pending = new Map<
    number,
    {
      resolve: (value: Record<string, unknown>) => void;
      reject: (error: Error) => void;
    }
  >();
  let nextId = 1;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("cdp websocket open timeout")), 10_000);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("cdp websocket open failed"));
    });
  });

  const handleIncomingText = (text: string): void => {
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return;
    }
    const eventMethod = parsed.method;
    if (typeof eventMethod === "string") {
      try {
        options?.onEvent?.({
          method: eventMethod,
          params: asRecord(parsed.params) ?? undefined
        });
      } catch {
        // swallow observer failures so CDP command flow is unaffected
      }
    }
    const id = parsed.id;
    if (typeof id !== "number") {
      return;
    }
    const request = pending.get(id);
    if (!request) {
      return;
    }
    pending.delete(id);
    const error = asRecord(parsed.error);
    if (error) {
      request.reject(new Error(JSON.stringify(error)));
      return;
    }
    request.resolve(asRecord(parsed.result) ?? {});
  };

  ws.addEventListener("message", (event) => {
    const data = event.data;
    if (typeof data === "string") {
      handleIncomingText(data);
      return;
    }
    if (typeof Blob !== "undefined" && data instanceof Blob) {
      void data
        .text()
        .then((text) => handleIncomingText(text))
        .catch(() => undefined);
      return;
    }
    handleIncomingText(toText(data));
  });

  const send: CdpSend = async (method, params = {}) => {
    const id = nextId;
    nextId += 1;
    const payload = JSON.stringify({ id, method, params });

    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`cdp command timeout: ${method}`));
      }, 10_000);
      const wrappedResolve = (value: Record<string, unknown>) => {
        clearTimeout(timer);
        resolve(value);
      };
      const wrappedReject = (error: Error) => {
        clearTimeout(timer);
        reject(error);
      };
      pending.set(id, { resolve: wrappedResolve, reject: wrappedReject });
      try {
        ws.send(payload);
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };

  try {
    return await run(send);
  } finally {
    try {
      ws.close();
    } catch {
      // ignore close failure
    }
  }
};

const evaluateInPage = async (
  send: CdpSend,
  expression: string
): Promise<Record<string, unknown> | null> => {
  const response = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (response.exceptionDetails) {
    throw new Error(`cdp runtime evaluation failed: ${JSON.stringify(response.exceptionDetails)}`);
  }
  const result = asRecord(response.result);
  return asRecord(result?.value ?? null);
};

const waitForPageStability = async (
  wsUrl: string,
  expectedUrl: string,
  expectedTitle: string,
  timeoutMs: number
): Promise<Record<string, unknown>> =>
  await withCdpSession(wsUrl, async (send) => {
    await send("Runtime.enable");
    await send("Page.enable");

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const pageState = await evaluateInPage(
        send,
        `(() => ({
          href: location.href,
          title: document.title,
          readyState: document.readyState
        }))();`
      );
      if (
        pageState?.href === expectedUrl &&
        pageState?.title === expectedTitle &&
        pageState?.readyState === "complete"
      ) {
        return pageState;
      }
      await wait(250);
    }

    throw new Error(
      `page did not stabilize for ${expectedUrl} / ${expectedTitle} within timeout`
    );
  });

type FingerprintProbeCdpDiagnostics = {
  runtimeExceptionThrown: Array<Record<string, unknown>>;
  logEntryAdded: Array<Record<string, unknown>>;
  consoleApiCalled: Array<Record<string, unknown>>;
};

type FingerprintProbeResult = Record<string, unknown> & {
  cdpRecent?: FingerprintProbeCdpDiagnostics;
};

const pushRecent = <T>(buffer: T[], value: T, limit: number = 12): void => {
  buffer.push(value);
  if (buffer.length > limit) {
    buffer.splice(0, buffer.length - limit);
  }
};

const asPrimitiveText = (value: unknown): string | null => {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
};

const summarizeConsoleArgs = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    const arg = asRecord(item);
    if (!arg) {
      return String(item);
    }
    const primitiveText = asPrimitiveText(arg.value);
    if (primitiveText !== null) {
      return primitiveText;
    }
    if (typeof arg.description === "string" && arg.description.length > 0) {
      return arg.description;
    }
    if (typeof arg.type === "string") {
      return `[${arg.type}]`;
    }
    return safeJsonStringify(arg);
  });
};

const createFingerprintProbeCdpDiagnostics = (): FingerprintProbeCdpDiagnostics => ({
  runtimeExceptionThrown: [],
  logEntryAdded: [],
  consoleApiCalled: []
});

const hasInlineScriptCspViolation = (diagnostics: FingerprintProbeCdpDiagnostics): boolean =>
  diagnostics.logEntryAdded.some((entry) => {
    const text = typeof entry.text === "string" ? entry.text : "";
    return text.includes("Executing inline script violates the following Content Security Policy directive");
  });

const hasMainWorldBridgeTimeout = (diagnostics: FingerprintProbeCdpDiagnostics): boolean =>
  diagnostics.runtimeExceptionThrown.some((entry) => {
    const description =
      typeof entry.exceptionDescription === "string" ? entry.exceptionDescription : "";
    const text = typeof entry.text === "string" ? entry.text : "";
    return (
      description.includes("main world bridge response timeout") ||
      text.includes("main world bridge response timeout")
    );
  });

const appendFingerprintProbeCdpEvent = (
  diagnostics: FingerprintProbeCdpDiagnostics,
  event: CdpEvent
): void => {
  if (event.method === "Runtime.exceptionThrown") {
    const exceptionParams = asRecord(event.params);
    const details = asRecord(exceptionParams?.exceptionDetails);
    const exception = asRecord(details?.exception);
    pushRecent(diagnostics.runtimeExceptionThrown, {
      text: details?.text ?? null,
      url: details?.url ?? null,
      lineNumber: details?.lineNumber ?? null,
      columnNumber: details?.columnNumber ?? null,
      exceptionDescription:
        typeof exception?.description === "string" ? exception.description : null,
      timestamp: exceptionParams?.timestamp ?? null
    });
    return;
  }

  if (event.method === "Log.entryAdded") {
    const logParams = asRecord(event.params);
    const entry = asRecord(logParams?.entry);
    pushRecent(diagnostics.logEntryAdded, {
      source: entry?.source ?? null,
      level: entry?.level ?? null,
      text: entry?.text ?? null,
      url: entry?.url ?? null,
      lineNumber: entry?.lineNumber ?? null,
      timestamp: entry?.timestamp ?? null
    });
    return;
  }

  if (event.method === "Runtime.consoleAPICalled") {
    const consoleParams = asRecord(event.params);
    const stackTrace = asRecord(consoleParams?.stackTrace);
    const callFrames = Array.isArray(stackTrace?.callFrames) ? stackTrace.callFrames : [];
    const firstFrame = asRecord(callFrames[0]);
    pushRecent(diagnostics.consoleApiCalled, {
      type: consoleParams?.type ?? null,
      args: summarizeConsoleArgs(consoleParams?.args),
      url: firstFrame?.url ?? null,
      lineNumber: firstFrame?.lineNumber ?? null,
      columnNumber: firstFrame?.columnNumber ?? null,
      timestamp: consoleParams?.timestamp ?? null
    });
  }
};

const waitForFingerprintProbe = async (
  wsUrl: string,
  timeoutMs: number,
  context?: Record<string, unknown>,
  options?: { requireInstalled?: boolean }
): Promise<FingerprintProbeResult> => {
  const cdpRecent = createFingerprintProbeCdpDiagnostics();
  const requireInstalled = options?.requireInstalled === true;
  const contextWithDiagnostics = (): Record<string, unknown> => ({
    ...(context ?? {}),
    requireInstalled,
    cdpRecent
  });

  try {
    return await withCdpSession(
      wsUrl,
      async (send) => {
        await send("Runtime.enable");
        await send("Page.enable");
        await send("Log.enable");

        const deadline = Date.now() + timeoutMs;
        let lastProbe: Record<string, unknown> | null = null;
        while (Date.now() < deadline) {
          const readyStateProbe = await send("Runtime.evaluate", {
            expression: "document.readyState",
            returnByValue: true
          });
          const readyStateResult = asRecord(readyStateProbe.result);
          if (readyStateResult?.value === "loading") {
            await wait(250);
            continue;
          }
          const probe = await evaluateInPage(
            send,
            `(async () => {
              const pluginsLength = typeof navigator.plugins?.length === "number" ? navigator.plugins.length : -1;
              const mimeTypesLength = typeof navigator.mimeTypes?.length === "number" ? navigator.mimeTypes.length : -1;
              const hasGetBattery = typeof navigator.getBattery === "function";
              const OfflineCtor =
                typeof window.OfflineAudioContext === "function"
                  ? window.OfflineAudioContext
                  : typeof window.webkitOfflineAudioContext === "function"
                    ? window.webkitOfflineAudioContext
                    : null;
              const hasOfflineAudioContext = typeof OfflineCtor === "function";
              let audioProbeSucceeded = false;
              let audioFirstSample = null;
              let audioPatchedByNoise = false;
              let audioProbeError = null;
              if (hasOfflineAudioContext && OfflineCtor) {
                try {
                  const offline = new OfflineCtor(1, 256, 44_100);
                  const rendered = await offline.startRendering();
                  const channelData = rendered?.getChannelData?.(0);
                  if (channelData && typeof channelData.length === "number" && channelData.length > 0) {
                    audioProbeSucceeded = true;
                    const firstSample = Number(channelData[0]);
                    audioFirstSample = Number.isFinite(firstSample) ? firstSample : null;
                    audioPatchedByNoise =
                      Number.isFinite(firstSample) && Math.abs(firstSample) > 1e-12;
                  }
                } catch (error) {
                  audioProbeError = error instanceof Error ? error.message : String(error);
                }
              }
              let batteryProbeSucceeded = false;
              let batteryHasExpectedShape = false;
              let batteryProbeError = null;
              if (hasGetBattery) {
                try {
                  const battery = await navigator.getBattery();
                  batteryProbeSucceeded = true;
                  batteryHasExpectedShape =
                    typeof battery === "object" &&
                    battery !== null &&
                    typeof battery.charging === "boolean" &&
                    typeof battery.level === "number";
                } catch (error) {
                  batteryProbeError = error instanceof Error ? error.message : String(error);
                }
              }
              const requiredPatches = [
                "audio_context.firstSampleNoised",
                "navigator.plugins.length>0",
                "navigator.mimeTypes.length>0",
                "navigator.getBattery()",
                "battery shape"
              ];
              const missingRequiredPatches = [
                ...(audioProbeSucceeded && audioPatchedByNoise ? [] : ["audio_context.firstSampleNoised"]),
                ...(pluginsLength > 0 ? [] : ["navigator.plugins.length>0"]),
                ...(mimeTypesLength > 0 ? [] : ["navigator.mimeTypes.length>0"]),
                ...(hasGetBattery ? [] : ["navigator.getBattery()"]),
                ...(batteryProbeSucceeded && batteryHasExpectedShape ? [] : ["battery shape"])
              ];
              const hasPatchSignals =
                audioProbeSucceeded &&
                audioPatchedByNoise &&
                pluginsLength > 0 &&
                mimeTypesLength > 0 &&
                hasGetBattery &&
                batteryProbeSucceeded &&
                batteryHasExpectedShape;
              return {
                hasPatchSignals,
                installed: missingRequiredPatches.length === 0,
                requiredPatches,
                missingRequiredPatches,
                pluginsLength,
                mimeTypesLength,
                hasOfflineAudioContext,
                audioProbeSucceeded,
                audioFirstSample,
                audioPatchedByNoise,
                audioProbeError,
                hasGetBattery,
                batteryProbeSucceeded,
                batteryHasExpectedShape,
                batteryProbeError
              };
            })();`
          );
          lastProbe = probe;
          if (probe && (!requireInstalled || probe.installed === true)) {
            return {
              ...(probe ?? {}),
              cdpRecent
            };
          }
          await wait(250);
        }
        throw new Error(
          `fingerprint runtime did not appear in main world within timeout (page target exists; lastProbe=${safeJsonStringify(lastProbe)}; context=${safeJsonStringify(
            contextWithDiagnostics()
          )})`
        );
      },
      {
        onEvent: (event) => {
          appendFingerprintProbeCdpEvent(cdpRecent, event);
        }
      }
    );
  } catch (error) {
    const message = toErrorMessage(error);
    if (message.includes("context=")) {
      throw error instanceof Error ? error : new Error(message);
    }
    throw new Error(
      `fingerprint probe failed before runtime became visible (context=${safeJsonStringify(
        contextWithDiagnostics()
      )}): ${message}`
    );
  }
};

const bringPageToFront = async (wsUrl: string): Promise<void> => {
  await withCdpSession(wsUrl, async (send) => {
    await send("Page.enable");
    await send("Page.bringToFront");
  });
};

const navigatePage = async (wsUrl: string, url: string): Promise<void> => {
  await withCdpSession(wsUrl, async (send) => {
    await send("Page.enable");
    await send("Page.navigate", { url });
  });
};

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("fingerprint runtime real browser integration", () => {
  itWithRealBrowser(
    "installs required fingerprint patches in main world via runtime.start + extension bootstrap",
    async () => {
    const stageState = {
      current: "bootstrap",
      history: [] as string[]
    };
    const chromePath = detectSystemChromePath();
    expect(chromePath).not.toBeNull();

    const cdpPort = await runStage(stageState, "resolve-cdp-port", async () => await resolveCdpPort());
    const runtimeCwd = await runStage(stageState, "create-runtime-cwd", async () => await createRuntimeCwd());
    const env = {
      WEBENVOY_BROWSER_PATH: wrapperPath,
      WEBENVOY_REAL_CHROME_BIN: String(chromePath),
      WEBENVOY_TEST_CDP_PORT: String(cdpPort),
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    };

    const server = createServer((req, res) => {
      if (!req.url || req.url !== "/probe") {
        res.statusCode = 404;
        res.end("not found");
        return;
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end("<!doctype html><html><head><title>probe</title></head><body>ok</body></html>");
    });
    const fixtureSockets = new Set<Socket>();
    server.on("connection", (socket) => {
      fixtureSockets.add(socket);
      socket.on("close", () => {
        fixtureSockets.delete(socket);
      });
    });
    await runStage(stageState, "start-fixture-server", async () => {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      await runStage(stageState, "close-fixture-server-on-address-failure", async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      });
      throw new Error("fixture server address unavailable");
    }
    const probeUrl = `http://127.0.0.1:${address.port}/probe`;

    const profile = "fr0012_real_browser_profile";
    const runId = "run-real-browser-001";
    let started = false;
    let browserWsUrlForFailureContext: string | null = null;
    try {
      const start = await runStage(stageState, "runtime.start", async () =>
        runCli(
          [
            "runtime.start",
            "--profile",
            profile,
            "--run-id",
            runId,
            "--params",
            JSON.stringify({
              startUrl: probeUrl,
              headless: false
            })
          ],
          runtimeCwd,
          env
        )
      );
      expect(start.status).toBe(0);
      const startBody = parseSingleJsonLine(start.stdout);
      expect(startBody.status).toBe("success");
      started = true;
      const startSummary = asRecord(startBody.summary);
      const profileDir = typeof startSummary?.profileDir === "string" ? startSummary.profileDir : null;
      const stagedBootstrapDiagnostics =
        profileDir !== null
          ? await runStage(stageState, "read-staged-bootstrap-diagnostics", async () =>
              readStagedBootstrapDiagnostics(profileDir, runId)
            )
          : {
              error: "profileDir missing from runtime.start summary"
            };
      expect(stagedBootstrapDiagnostics.manifestInjectsMainWorldBridgeScript).toBe(true);
      expect(stagedBootstrapDiagnostics.bootstrapScriptContainsPayloadKey).toBe(false);

      const browserWsUrl = await runStage(stageState, "resolve-browser-target-ws-url", async () =>
        waitForBrowserWebSocketUrl(cdpPort, 20_000)
      );
      browserWsUrlForFailureContext = browserWsUrl;
      const browserTargetDiagnostics = await runStage(
        stageState,
        "read-browser-target-diagnostics",
        async () =>
          waitForBrowserTargetDiagnostics(browserWsUrl, 20_000, {
            probeUrl,
            requireExtensionServiceWorker: true
          })
      );
      expect(browserTargetDiagnostics.hasExtensionServiceWorker).toBe(true);
      const wsUrl = await runStage(
        stageState,
        "resolve-probe-page-target-ws-url",
        async () => ensurePageTargetWebSocketUrl(cdpPort, probeUrl, 20_000)
      );
      await runStage(stageState, "bring-probe-page-to-front", async () =>
        bringPageToFront(wsUrl)
      );
      const probeTarget = await runStage(stageState, "snapshot-probe-target", async () =>
        waitForTargetSnapshotByWsUrl(cdpPort, wsUrl, 20_000)
      );
      const targetBeforeNavigation = await runStage(
        stageState,
        "snapshot-probe-target-before-navigation",
        async () => waitForTargetSnapshotByWsUrl(cdpPort, wsUrl, 20_000)
      );
      if (targetBeforeNavigation.url !== probeUrl) {
        await runStage(stageState, "navigate-to-probe-url-if-needed", async () =>
          navigatePage(wsUrl, probeUrl)
        );
      }
      const pageBeforePing = await runStage(stageState, "wait-page-stability-before-ping", async () =>
        waitForPageStability(wsUrl, probeUrl, "probe", 20_000)
      );
      expect(pageBeforePing).toMatchObject({
        href: probeUrl,
        title: "probe",
        readyState: "complete"
      });
      const targetBeforePing = await runStage(stageState, "snapshot-target-before-ping", async () =>
        waitForTargetSnapshotByWsUrl(cdpPort, wsUrl, 20_000)
      );
      expect(targetBeforePing.id).toBe(probeTarget.id);
      expect(targetBeforePing.id.length).toBeGreaterThan(0);
      expect(targetBeforePing.url).toBe(probeUrl);
      expect(typeof targetBeforePing.title).toBe("string");

      const startupProbe = await runStage(
        stageState,
        "wait-fingerprint-probe-before-runtime-ping",
        async () =>
          waitForFingerprintProbe(
            wsUrl,
            20_000,
            {
              phase: "before_runtime_ping",
              pageBeforePing,
              stagedBootstrapDiagnostics,
              browserTargetDiagnostics
            },
            {
              requireInstalled: true
            }
          )
      );
      expect(startupProbe.installed).toBe(true);
      expect(startupProbe.hasPatchSignals).toBe(true);
      expect(startupProbe.hasOfflineAudioContext).toBe(true);
      expect(startupProbe.audioProbeSucceeded).toBe(true);
      expect(startupProbe.audioPatchedByNoise).toBe(true);
      expect(startupProbe.pluginsLength).toBeGreaterThan(0);
      expect(startupProbe.mimeTypesLength).toBeGreaterThan(0);
      expect(startupProbe.hasGetBattery).toBe(true);
      expect(startupProbe.batteryProbeSucceeded).toBe(true);
      expect(startupProbe.batteryHasExpectedShape).toBe(true);
      expect(startupProbe.missingRequiredPatches).toEqual([]);
      if (startupProbe.cdpRecent) {
        expect(hasInlineScriptCspViolation(startupProbe.cdpRecent)).toBe(false);
        expect(hasMainWorldBridgeTimeout(startupProbe.cdpRecent)).toBe(false);
      }

      const ping = await runStage(stageState, "runtime.ping", async () =>
        runCli(
          [
            "runtime.ping",
            "--profile",
            profile,
            "--run-id",
            runId,
            "--params",
            JSON.stringify({
              requested_execution_mode: "live_read_limited"
            })
          ],
          runtimeCwd,
          env
        )
      );
      expect(ping.status).toBe(0);
      const pingBody = parseSingleJsonLine(ping.stdout);
      expect(pingBody.status).toBe("success");
      const pingRuntime = extractPingFingerprintRuntime(pingBody);
      if (pingRuntime.injection !== null) {
        expect(pingRuntime.injection?.installed).toBe(true);
      }
      const targetAfterPing = await runStage(stageState, "snapshot-target-after-ping", async () =>
        waitForTargetSnapshotByWsUrl(cdpPort, wsUrl, 20_000)
      );
      expect(targetAfterPing.id).toBe(targetBeforePing.id);
      expect(targetAfterPing.url).toBe(probeUrl);
      expect(typeof targetAfterPing.title).toBe("string");
      expect(targetAfterPing.webSocketDebuggerUrl).toBe(wsUrl);
      const pageAfterPing = await runStage(stageState, "wait-page-stability-after-ping", async () =>
        waitForPageStability(wsUrl, probeUrl, "probe", 20_000)
      );
      expect(pageAfterPing).toMatchObject({
        href: probeUrl,
        title: "probe",
        readyState: "complete"
      });
    } catch (error) {
      const failureDiagnostics = await collectRealBrowserFailureDiagnostics({
        cdpPort,
        probeUrl,
        browserWsUrl: browserWsUrlForFailureContext
      });
      throw new Error(
        `real-browser positive flow failed: ${toErrorMessage(
          error
        )}; browserFailureContext=${safeJsonStringify(failureDiagnostics)}`
      );
    } finally {
      if (started) {
        const stop = await runStage(stageState, "runtime.stop", async () =>
          runCli(["runtime.stop", "--profile", profile, "--run-id", runId], runtimeCwd, env)
        );
        expect(stop.status).toBe(0);
      }
      await runStage(stageState, "close-fixture-server", async () => {
        const closableServer = server as typeof server & {
          closeAllConnections?: () => void;
          closeIdleConnections?: () => void;
        };
        closableServer.closeIdleConnections?.();
        closableServer.closeAllConnections?.();
        for (const socket of fixtureSockets) {
          socket.destroy();
        }
        await new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      });
    }
    },
    90_000
  );

  itWithRealBrowser(
    "blocks live mode in bridge.forward when trusted fingerprint context is missing",
    async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-fingerprint-live-block-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-fingerprint-live-block-001",
        command: "xhs.search",
        command_params: {
          issue_scope: "issue_209",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
          action_type: "read",
          risk_state: "allowed",
          requested_execution_mode: "live_read_high_risk",
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
      .find((message) => message.id === "run-fingerprint-live-block-001");
    expect(blocked?.status).toBe("error");

    const payload = asRecord(blocked?.payload) ?? {};
    const gateOutcome = asRecord(payload.gate_outcome);
    const consumerGateResult = asRecord(payload.consumer_gate_result);
    expect(gateOutcome?.effective_execution_mode).toBe("dry_run");
    expect(consumerGateResult?.gate_decision).toBe("blocked");
    expect(consumerGateResult?.fingerprint_gate_decision).toBe("blocked");
    expect(consumerGateResult?.fingerprint_reason_codes).toEqual(["FINGERPRINT_CONTEXT_MISSING"]);
    expect(consumerGateResult?.gate_reasons).toEqual(
      expect.arrayContaining(["FINGERPRINT_CONTEXT_MISSING", "FINGERPRINT_EXECUTION_BLOCKED"])
    );
    },
    30_000
  );
});
