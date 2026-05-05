import { executeXhsSearch } from "./xhs-search.js";
import { executeXhsDetail } from "./xhs-detail.js";
import { executeXhsUserHome } from "./xhs-user-home.js";
import { performEditorInputValidation } from "./xhs-editor-input.js";
import { ensureFingerprintRuntimeContext } from "../shared/fingerprint-profile.js";
import { buildFailedFingerprintInjectionContext, hasInstalledFingerprintInjection, installFingerprintRuntimeWithVerification, resolveFingerprintContextForContract, resolveFingerprintContextFromMessage, resolveMissingRequiredFingerprintPatches, summarizeFingerprintRuntimeContext } from "./content-script-fingerprint.js";
import { encodeMainWorldPayload, configureCapturedRequestContextProvenanceViaMainWorld, installMainWorldEventChannelSecret, installFingerprintRuntimeViaMainWorld, MAIN_WORLD_EVENT_BOOTSTRAP, readCapturedRequestContextViaMainWorld, readPageStateViaMainWorld, requestXhsSearchJsonViaMainWorld, resetMainWorldEventChannelForContract, resolveMainWorldEventNamesForSecret } from "./content-script-main-world.js";
import { ExtensionContractError, validateXhsCommandInputForExtension } from "./xhs-command-contract.js";
import { containsCookie, hasXhsAccountSafetyOverlaySignal } from "./xhs-search-telemetry.js";
export { encodeMainWorldPayload, configureCapturedRequestContextProvenanceViaMainWorld, installFingerprintRuntimeViaMainWorld, installMainWorldEventChannelSecret, MAIN_WORLD_EVENT_BOOTSTRAP, readCapturedRequestContextViaMainWorld, readPageStateViaMainWorld, requestXhsSearchJsonViaMainWorld, resetMainWorldEventChannelForContract, resolveMainWorldEventNamesForSecret };
export { resolveFingerprintContextForContract };
const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const LIVE_EXECUTION_MODES = new Set(["live_read_limited", "live_read_high_risk", "live_write"]);
const XHS_READ_COMMANDS = new Set(["xhs.search", "xhs.detail", "xhs.user_home"]);
const XHS_READ_DOMAIN = "www.xiaohongshu.com";
const createCurrentPageContextNamespace = (href) => {
    const normalized = href.trim();
    if (normalized.length === 0) {
        return "about:blank";
    }
    try {
        const parsed = new URL(normalized, "https://www.xiaohongshu.com/");
        const pathname = parsed.pathname.length > 0 ? parsed.pathname : "/";
        const queryIdentity = parsed.search.length > 0 ? `${pathname}${parsed.search}` : pathname;
        const documentTimeOrigin = typeof globalThis.performance?.timeOrigin === "number" &&
            Number.isFinite(globalThis.performance.timeOrigin)
            ? Math.trunc(globalThis.performance.timeOrigin)
            : null;
        return documentTimeOrigin === null
            ? `${parsed.origin}${queryIdentity}`
            : `${parsed.origin}${queryIdentity}#doc=${documentTimeOrigin}`;
    }
    catch {
        return normalized;
    }
};
const asString = (value) => typeof value === "string" && value.length > 0 ? value : null;
const asStringArray = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
const hasReadyFingerprintRuntime = (fingerprintRuntime) => {
    const injection = asRecord(fingerprintRuntime?.injection);
    const execution = asRecord(fingerprintRuntime?.execution);
    return (injection?.installed === true &&
        asStringArray(injection.missing_required_patches).length === 0 &&
        execution?.live_allowed === true &&
        execution.live_decision === "allowed");
};
const capturedRequestContextProvenanceConfirmed = (value, expected) => {
    const record = asRecord(value);
    return (record?.configured === true &&
        record.profile_ref === expected.profile_ref &&
        record.session_id === expected.session_id &&
        (expected.target_tab_id === null || record.target_tab_id === expected.target_tab_id) &&
        record.run_id === expected.run_id &&
        record.action_ref === expected.action_ref &&
        record.page_url === expected.page_url);
};
const resolveTrustedActiveFallbackRuntimeAttestation = (input) => {
    const attestation = asRecord(input.raw.runtime_attestation);
    if (!attestation) {
        return null;
    }
    if (attestation.source !== "official_chrome_runtime_readiness" ||
        attestation.runtime_readiness !== "ready" ||
        attestation.profile_ref !== input.profile ||
        attestation.run_id !== input.runId ||
        attestation.session_id !== input.sessionId) {
        return null;
    }
    return attestation;
};
const resolveActiveApiFetchFallbackGateOptions = (input) => {
    const raw = asRecord(input.rawOptions.active_api_fetch_fallback);
    if (!raw) {
        return null;
    }
    const { fingerprint_validation_state: _fingerprintValidationState, execution_surface: _executionSurface, headless: _headless, runtime_attestation: _runtimeAttestation, fingerprint_attestation: _fingerprintAttestation, ...callerGate } = raw;
    const runtimeAttestation = resolveTrustedActiveFallbackRuntimeAttestation({
        raw,
        profile: input.profile,
        runId: input.runId,
        sessionId: input.sessionId
    });
    const fingerprintReady = hasReadyFingerprintRuntime(input.fingerprintRuntime);
    const missingRequiredPatches = asStringArray(asRecord(input.fingerprintRuntime?.injection)?.missing_required_patches);
    return {
        ...callerGate,
        ...(fingerprintReady ? { fingerprint_validation_state: "ready" } : {}),
        ...(runtimeAttestation
            ? {
                execution_surface: asString(runtimeAttestation.execution_surface) ?? "unknown",
                ...(typeof runtimeAttestation.headless === "boolean"
                    ? { headless: runtimeAttestation.headless }
                    : {}),
                runtime_attestation: runtimeAttestation
            }
            : {}),
        fingerprint_attestation: {
            source: "content_script_fingerprint_runtime",
            validation_state: fingerprintReady ? "ready" : "not_ready",
            profile_ref: asString(input.fingerprintRuntime?.profile),
            missing_required_patches: missingRequiredPatches
        }
    };
};
const toCliInvalidArgsResult = (input) => ({
    kind: "result",
    id: input.id,
    ok: false,
    error: {
        code: input.error.code,
        message: input.error.message
    },
    payload: {
        ...(input.error.details ? { details: input.error.details } : {}),
        ...(input.fingerprintRuntime ? { fingerprint_runtime: input.fingerprintRuntime } : {})
    }
});
const resolveRequestedExecutionMode = (message) => {
    const topLevelMode = asString(asRecord(message.commandParams)?.requested_execution_mode);
    if (topLevelMode) {
        return topLevelMode;
    }
    const options = asRecord(message.commandParams.options);
    return asString(options?.requested_execution_mode);
};
const extractFetchBody = async (response) => {
    const text = await response.text();
    if (text.length === 0) {
        return null;
    }
    try {
        return JSON.parse(text);
    }
    catch {
        return {
            message: text
        };
    }
};
const requestXhsSignatureViaExtension = async (uri, body) => {
    const runtime = globalThis.chrome?.runtime;
    const sendMessage = runtime?.sendMessage;
    if (!sendMessage) {
        throw new Error("extension runtime.sendMessage is unavailable");
    }
    const request = {
        kind: "xhs-sign-request",
        uri,
        body
    };
    const response = await new Promise((resolve, reject) => {
        try {
            const maybePromise = sendMessage(request, (message) => {
                resolve(message ?? { ok: false, error: { message: "xhs-sign response missing" } });
            });
            if (maybePromise && typeof maybePromise.then === "function") {
                void maybePromise
                    .then((message) => {
                    if (message) {
                        resolve(message);
                    }
                })
                    .catch((error) => {
                    reject(error);
                });
            }
        }
        catch (error) {
            reject(error);
        }
    });
    if (!response.ok || !response.result) {
        throw new Error(typeof response.error?.message === "string" ? response.error.message : "xhs-sign failed");
    }
    return response.result;
};
const buildRuntimeBootstrapAckPayload = (input) => ({
    method: "runtime.bootstrap.ack",
    result: {
        version: input.version,
        run_id: input.runId,
        runtime_context_id: input.runtimeContextId,
        profile: input.profile,
        status: input.attested ? "ready" : "pending"
    },
    runtime_bootstrap_attested: input.attested,
    ...(input.runtimeWithInjection ? { fingerprint_runtime: input.runtimeWithInjection } : {})
});
const ACCOUNT_SAFETY_OVERLAY_SELECTORS = [
    ".login-modal",
    ".login-container",
    ".login-wrapper",
    ".reds-login-container",
    ".captcha-container",
    ".verify-container",
    ".security-verify",
    ".risk-page",
    ".risk-modal",
    '[class*="login"]',
    '[class*="captcha"]',
    '[class*="verify"]',
    '[class*="security"]',
    '[class*="risk"]',
    '[id*="login"]',
    '[id*="captcha"]',
    '[id*="verify"]',
    '[id*="security"]',
    '[id*="risk"]',
    '[role="dialog"]',
    '[aria-modal="true"]'
];
const GENERIC_OVERLAY_SELECTORS = new Set(['[role="dialog"]', '[aria-modal="true"]']);
const isVisibleElement = (element) => {
    const candidate = element;
    if (typeof candidate.getBoundingClientRect !== "function") {
        return false;
    }
    if (typeof window.getComputedStyle !== "function") {
        return false;
    }
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
        return false;
    }
    const rect = candidate.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
};
const readAccountSafetyOverlay = () => {
    if (typeof document.querySelectorAll !== "function") {
        return null;
    }
    for (const element of Array.from(document.querySelectorAll(ACCOUNT_SAFETY_OVERLAY_SELECTORS.join(",")))) {
        if (!isVisibleElement(element)) {
            continue;
        }
        const text = (element.innerText || element.textContent || "").trim();
        if (!text || !hasXhsAccountSafetyOverlaySignal(text)) {
            continue;
        }
        const selector = ACCOUNT_SAFETY_OVERLAY_SELECTORS.find((candidate) => element.matches(candidate)) ?? null;
        if (!selector || GENERIC_OVERLAY_SELECTORS.has(selector)) {
            continue;
        }
        return {
            source: "dom_overlay",
            selector,
            text: text.slice(0, 2000)
        };
    }
    return null;
};
const toAbsoluteXhsHref = (href) => {
    if (!href || href.trim().length === 0) {
        return null;
    }
    try {
        return new URL(href, window.location.origin).toString();
    }
    catch {
        return href;
    }
};
const hasSearchCardLikeJson = (value, seen = new Set()) => {
    const record = asRecord(value);
    if (record) {
        if (seen.has(record)) {
            return false;
        }
        seen.add(record);
        const href = asString(record.detail_url) ??
            asString(record.detailUrl) ??
            asString(record.note_url) ??
            asString(record.noteUrl) ??
            asString(record.href) ??
            asString(record.url) ??
            asString(record.link);
        if (href) {
            const absoluteHref = toAbsoluteXhsHref(href);
            try {
                const url = absoluteHref ? new URL(absoluteHref) : null;
                if (url?.hostname === XHS_READ_DOMAIN &&
                    (url.pathname.startsWith("/explore/") || url.pathname.startsWith("/discovery/item/"))) {
                    return true;
                }
            }
            catch {
                // continue recursive scan
            }
        }
        if (asRecord(record.note_card) &&
            (asString(record.xsec_token) || asString(asRecord(record.note_card)?.xsec_token))) {
            return true;
        }
        return Object.values(record).some((entry) => hasSearchCardLikeJson(entry, seen));
    }
    return Array.isArray(value) ? value.some((entry) => hasSearchCardLikeJson(entry, seen)) : false;
};
const readJsonScriptSearchState = () => {
    if (typeof document.querySelectorAll !== "function") {
        return null;
    }
    const selectors = ['script[type="application/json"]', "script#__NEXT_DATA__", "script:not([src])"];
    for (const selector of selectors) {
        for (const element of Array.from(document.querySelectorAll(selector))) {
            const text = (element.textContent ?? "").trim();
            if (!text || (!text.includes("xsec") && !text.includes("/explore/"))) {
                continue;
            }
            try {
                const parsed = JSON.parse(text);
                if (!hasSearchCardLikeJson(parsed)) {
                    continue;
                }
                return {
                    extraction_layer: "script_json",
                    extraction_locator: selector,
                    cards: parsed
                };
            }
            catch {
                continue;
            }
        }
    }
    return null;
};
const readSearchDomCards = () => {
    if (typeof document.querySelectorAll !== "function") {
        return [];
    }
    const anchors = Array.from(document.querySelectorAll('a[href*="/explore/"], a[href*="/discovery/item/"]'));
    return anchors
        .map((anchor) => {
        const root = anchor.closest('[class*="note"], [class*="card"], article, section, li') ??
            anchor.parentElement ??
            anchor;
        const userAnchor = root.querySelector('a[href*="/user/profile/"]');
        const titleElement = root.querySelector('[class*="title"], [class*="desc"]') ?? anchor.querySelector("[title]");
        const title = titleElement?.innerText?.trim() ||
            (titleElement?.textContent ?? "").trim() ||
            (anchor.getAttribute("title") ?? "").trim() ||
            (anchor.textContent ?? "").trim() ||
            null;
        return {
            title,
            detail_url: toAbsoluteXhsHref(anchor.getAttribute("href")),
            user_home_url: toAbsoluteXhsHref(userAnchor?.getAttribute("href") ?? null)
        };
    })
        .filter((card) => typeof card.detail_url === "string" && card.detail_url.length > 0)
        .slice(0, 30);
};
const readXhsSearchDomState = () => {
    const scriptState = readJsonScriptSearchState();
    if (scriptState) {
        return scriptState;
    }
    const cards = readSearchDomCards();
    return cards.length > 0
        ? {
            extraction_layer: "dom_selector",
            extraction_locator: 'a[href*="/explore/"], a[href*="/discovery/item/"]',
            cards
        }
        : null;
};
const normalizeSearchQueryText = (value) => {
    if (typeof value !== "string") {
        return null;
    }
    const normalized = value.normalize("NFKC").trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
};
const isCurrentSearchPageForQuery = (href, query) => {
    const expectedQuery = normalizeSearchQueryText(query);
    if (!expectedQuery) {
        return false;
    }
    try {
        const url = new URL(href);
        return (url.hostname === XHS_READ_DOMAIN &&
            url.pathname.includes("/search_result") &&
            normalizeSearchQueryText(url.searchParams.get("keyword")) === expectedQuery);
    }
    catch {
        return false;
    }
};
const createSameQuerySearchPerturbation = (query, currentValue) => {
    const candidates = [`${query} `, query.slice(0, Math.max(0, query.length - 1)), `${query}x`];
    return candidates.find((candidate) => candidate !== currentValue && candidate !== query) ?? `${query}x`;
};
const performXhsSearchPassiveAction = async (input) => {
    const queryMatched = isCurrentSearchPageForQuery(window.location.href, input.query);
    const searchInput = document.querySelector('input[type="search"], input[class*="search"], input[placeholder*="搜索"], input[placeholder*="search" i]');
    if (searchInput) {
        const searchForm = searchInput.closest("form");
        const searchButton = (searchForm?.querySelector('button[type="submit"], button[class*="search"], [role="button"][class*="search"]') ?? document.querySelector('button[type="submit"], button[class*="search"], [role="button"][class*="search"]'));
        const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        const setSearchInputValue = (value) => {
            if (valueSetter) {
                valueSetter.call(searchInput, value);
            }
            else {
                searchInput.value = value;
            }
        };
        const dispatchTextChange = (value) => {
            searchInput.dispatchEvent(new InputEvent("input", { bubbles: true, data: value }));
            searchInput.dispatchEvent(new Event("change", { bubbles: true }));
        };
        const currentInputValue = searchInput.value;
        const sameQueryInputMatched = queryMatched &&
            normalizeSearchQueryText(currentInputValue) === normalizeSearchQueryText(input.query);
        let sameQueryPerturbed = false;
        let preSubmitValueChanged = false;
        searchInput.focus();
        if (sameQueryInputMatched) {
            const perturbedValue = createSameQuerySearchPerturbation(input.query, currentInputValue);
            setSearchInputValue(perturbedValue);
            dispatchTextChange(perturbedValue);
            sameQueryPerturbed = true;
            preSubmitValueChanged = searchInput.value !== currentInputValue;
        }
        setSearchInputValue(input.query);
        dispatchTextChange(input.query);
        searchInput.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter", code: "Enter" }));
        searchInput.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, cancelable: true, key: "Enter", code: "Enter" }));
        if (searchForm && typeof searchForm.requestSubmit === "function") {
            searchForm.requestSubmit();
        }
        else if (searchButton && typeof searchButton.click === "function") {
            searchButton.click();
        }
        else if (searchForm) {
            searchForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        }
        return {
            evidence_class: "humanized_action",
            action_kind: "keyboard_input",
            action_ref: input.actionRef,
            run_id: input.runId,
            page_url: input.pageUrl,
            query: input.query,
            query_matched: queryMatched,
            search_input_found: true,
            same_query_input_matched: sameQueryInputMatched,
            same_query_perturbed: sameQueryPerturbed,
            pre_submit_value_changed: preSubmitValueChanged,
            search_form_found: Boolean(searchForm),
            search_button_found: Boolean(searchButton),
            submit_triggered: searchForm && typeof searchForm.requestSubmit === "function"
                ? "form_request_submit"
                : searchButton
                    ? "button_click"
                    : searchForm
                        ? "submit_event"
                        : "enter_key",
            trigger_surface: "xhs.search_result"
        };
    }
    if (queryMatched) {
        const target = document.scrollingElement ?? document.documentElement;
        const beforeScrollY = window.scrollY;
        const deltaY = 240;
        target.dispatchEvent(new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            deltaY
        }));
        window.scrollBy({
            top: deltaY,
            left: 0,
            behavior: "auto"
        });
        target.dispatchEvent(new Event("scroll", { bubbles: true }));
        return {
            evidence_class: "humanized_action",
            action_kind: "scroll",
            action_ref: input.actionRef,
            run_id: input.runId,
            page_url: input.pageUrl,
            query: input.query,
            query_matched: true,
            before_scroll_y: beforeScrollY,
            after_scroll_y: window.scrollY,
            trigger_surface: "xhs.search_result"
        };
    }
    return {
        evidence_class: "humanized_action",
        action_kind: "keyboard_input",
        action_ref: input.actionRef,
        run_id: input.runId,
        page_url: input.pageUrl,
        query: input.query,
        query_matched: false,
        search_input_found: false,
        skipped_reason: "search_input_missing"
    };
};
const createBrowserEnvironment = () => ({
    now: () => Date.now(),
    randomId: () => typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `id-${Date.now()}`,
    getLocationHref: () => window.location.href,
    getDocumentTitle: () => document.title,
    getReadyState: () => document.readyState,
    getCookie: () => document.cookie,
    getBodyText: () => (document.body?.innerText ?? "").slice(0, 5000),
    getAccountSafetyOverlay: () => readAccountSafetyOverlay(),
    getPageStateRoot: () => window.__INITIAL_STATE__,
    readPageStateRoot: async () => await readPageStateViaMainWorld(),
    readSearchDomState: async () => readXhsSearchDomState(),
    performSearchPassiveAction: async (input) => await performXhsSearchPassiveAction(input),
    readCapturedRequestContext: async (input) => await readCapturedRequestContextViaMainWorld(input),
    configureCapturedRequestContextProvenance: async (input) => await configureCapturedRequestContextProvenanceViaMainWorld(input),
    sleep: async (ms) => {
        await new Promise((resolve) => {
            setTimeout(resolve, ms);
        });
    },
    callSignature: async (uri, payload) => await requestXhsSignatureViaExtension(uri, payload),
    fetchJson: async (input) => {
        if (input.pageContextRequest === true) {
            return await requestXhsSearchJsonViaMainWorld({
                url: input.url,
                method: input.method,
                headers: input.headers,
                ...(typeof input.body === "string" ? { body: input.body } : {}),
                timeoutMs: input.timeoutMs,
                ...(typeof input.referrer === "string" ? { referrer: input.referrer } : {}),
                ...(typeof input.referrerPolicy === "string"
                    ? { referrerPolicy: input.referrerPolicy }
                    : {})
            });
        }
        const controller = new AbortController();
        const timer = setTimeout(() => {
            controller.abort();
        }, input.timeoutMs);
        try {
            const response = await fetch(input.url, {
                method: input.method,
                headers: input.headers,
                body: input.body,
                credentials: "include",
                ...(typeof input.referrer === "string" ? { referrer: input.referrer } : {}),
                ...(typeof input.referrerPolicy === "string"
                    ? { referrerPolicy: input.referrerPolicy }
                    : {}),
                signal: controller.signal
            });
            return {
                status: response.status,
                body: await extractFetchBody(response)
            };
        }
        finally {
            clearTimeout(timer);
        }
    },
    performEditorInputValidation: async (input) => await performEditorInputValidation(input)
});
const resolveTargetDomainFromHref = (href) => {
    try {
        return new URL(href).hostname || null;
    }
    catch {
        return null;
    }
};
const resolveTargetPageFromHref = (href, command) => {
    try {
        const url = new URL(href);
        if (url.hostname === "www.xiaohongshu.com" && url.pathname.startsWith("/search_result")) {
            return "search_result_tab";
        }
        if (command === "xhs.detail" && url.hostname === "www.xiaohongshu.com" && url.pathname.startsWith("/explore/")) {
            return "explore_detail_tab";
        }
        if (command === "xhs.user_home" &&
            url.hostname === "www.xiaohongshu.com" &&
            url.pathname.startsWith("/user/profile/")) {
            return "profile_tab";
        }
        if (url.hostname === "creator.xiaohongshu.com" && url.pathname.startsWith("/publish")) {
            return "creator_publish_tab";
        }
        return null;
    }
    catch {
        return null;
    }
};
export class ContentScriptHandler {
    #listeners = new Set();
    #reachable = true;
    #xhsEnv;
    constructor(options) {
        this.#xhsEnv = options?.xhsEnv ?? createBrowserEnvironment();
    }
    onResult(listener) {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }
    setReachable(reachable) {
        this.#reachable = reachable;
    }
    onBackgroundMessage(message) {
        if (!this.#reachable) {
            return false;
        }
        if (message.commandParams.simulate_no_response === true) {
            return true;
        }
        if (message.command === "runtime.ping") {
            void this.#handleRuntimePing(message);
            return true;
        }
        if (message.command === "runtime.bootstrap") {
            void this.#handleRuntimeBootstrap(message);
            return true;
        }
        if (XHS_READ_COMMANDS.has(message.command)) {
            void this.#handleXhsReadCommand(message).catch((error) => {
                this.#emitUnexpectedXhsReadFailure(message, error);
            });
            return true;
        }
        const result = this.#handleForward(message);
        for (const listener of this.#listeners) {
            listener(result);
        }
        return true;
    }
    #emitUnexpectedXhsReadFailure(message, error) {
        const fingerprintRuntime = resolveFingerprintContextFromMessage(message);
        if (error instanceof ExtensionContractError && error.code === "ERR_CLI_INVALID_ARGS") {
            this.#emit(toCliInvalidArgsResult({
                id: message.id,
                error,
                fingerprintRuntime: fingerprintRuntime
            }));
            return;
        }
        this.#emit({
            kind: "result",
            id: message.id,
            ok: false,
            error: {
                code: "ERR_EXECUTION_FAILED",
                message: error instanceof Error ? error.message : String(error)
            },
            payload: fingerprintRuntime
                ? {
                    fingerprint_runtime: fingerprintRuntime
                }
                : {}
        });
    }
    async #installFingerprintIfPresent(message) {
        const fingerprintRuntime = resolveFingerprintContextFromMessage(message);
        if (!fingerprintRuntime) {
            return null;
        }
        if (hasInstalledFingerprintInjection(fingerprintRuntime)) {
            return fingerprintRuntime;
        }
        try {
            const verifiedInjection = await installFingerprintRuntimeWithVerification(fingerprintRuntime);
            return {
                ...fingerprintRuntime,
                injection: verifiedInjection
            };
        }
        catch (error) {
            const requiredPatches = asStringArray(asRecord(fingerprintRuntime.fingerprint_patch_manifest)?.required_patches);
            return {
                ...fingerprintRuntime,
                injection: {
                    installed: false,
                    required_patches: requiredPatches,
                    missing_required_patches: requiredPatches,
                    error: error instanceof Error ? error.message : String(error)
                }
            };
        }
    }
    async #handleRuntimePing(message) {
        const fingerprintRuntime = await this.#installFingerprintIfPresent(message);
        this.#emit({
            kind: "result",
            id: message.id,
            ok: true,
            payload: {
                message: "pong",
                run_id: message.runId,
                profile: message.profile,
                cwd: message.cwd,
                ...(fingerprintRuntime ? { fingerprint_runtime: fingerprintRuntime } : {})
            }
        });
    }
    async #handleRuntimeBootstrap(message) {
        const commandParams = asRecord(message.commandParams) ?? {};
        const version = asString(commandParams.version);
        const runId = asString(commandParams.run_id);
        const runtimeContextId = asString(commandParams.runtime_context_id);
        const profile = asString(commandParams.profile);
        const mainWorldSecret = asString(commandParams.main_world_secret);
        const fingerprintRuntime = resolveFingerprintContextFromMessage(message);
        if (version !== "v1" ||
            !runId ||
            !runtimeContextId ||
            !profile ||
            !mainWorldSecret ||
            !fingerprintRuntime) {
            this.#emit({
                kind: "result",
                id: message.id,
                ok: false,
                error: {
                    code: "ERR_RUNTIME_READY_SIGNAL_CONFLICT",
                    message: "invalid runtime bootstrap envelope"
                }
            });
            return;
        }
        if (fingerprintRuntime.profile !== profile) {
            this.#emit({
                kind: "result",
                id: message.id,
                ok: false,
                error: {
                    code: "ERR_RUNTIME_BOOTSTRAP_IDENTITY_MISMATCH",
                    message: "runtime bootstrap profile 与 fingerprint runtime 不一致"
                }
            });
            return;
        }
        const channelInstalled = installMainWorldEventChannelSecret(mainWorldSecret);
        const runtimeWithInjection = channelInstalled
            ? await this.#installFingerprintIfPresent({
                ...message,
                fingerprintContext: fingerprintRuntime
            })
            : buildFailedFingerprintInjectionContext(fingerprintRuntime, "main world event channel unavailable");
        const injection = asRecord(runtimeWithInjection?.injection);
        const attested = injection?.installed === true;
        const ackPayload = buildRuntimeBootstrapAckPayload({
            version,
            runId,
            runtimeContextId,
            profile,
            attested,
            runtimeWithInjection
        });
        if (!attested) {
            this.#emit({
                kind: "result",
                id: message.id,
                ok: false,
                error: {
                    code: "ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED",
                    message: typeof injection?.error === "string"
                        ? injection.error
                        : "runtime bootstrap 尚未获得执行面确认"
                },
                payload: ackPayload
            });
            return;
        }
        this.#emit({
            kind: "result",
            id: message.id,
            ok: true,
            payload: ackPayload
        });
    }
    #handleForward(message) {
        if (message.command !== "runtime.ping") {
            return {
                kind: "result",
                id: message.id,
                ok: false,
                error: {
                    code: "ERR_TRANSPORT_FORWARD_FAILED",
                    message: `unsupported command: ${message.command}`
                }
            };
        }
        return {
            kind: "result",
            id: message.id,
            ok: true,
            payload: {
                message: "pong",
                run_id: message.runId,
                profile: message.profile,
                cwd: message.cwd
            }
        };
    }
    #safeXhsEnvValue(resolver, fallback) {
        try {
            return resolver();
        }
        catch {
            return fallback;
        }
    }
    async #handleXhsReadCommand(message) {
        const commandParams = asRecord(message.commandParams) ?? {};
        const mainWorldSecret = asString(commandParams.main_world_secret);
        if (mainWorldSecret) {
            installMainWorldEventChannelSecret(mainWorldSecret);
        }
        const messageFingerprintContext = resolveFingerprintContextFromMessage(message);
        const fingerprintRuntime = await this.#installFingerprintIfPresent(message);
        const requestedExecutionMode = resolveRequestedExecutionMode(message);
        const missingRequiredPatches = fingerprintRuntime !== null ? resolveMissingRequiredFingerprintPatches(fingerprintRuntime) : [];
        if (requestedExecutionMode !== null &&
            LIVE_EXECUTION_MODES.has(requestedExecutionMode) &&
            missingRequiredPatches.length > 0) {
            this.#emit({
                kind: "result",
                id: message.id,
                ok: false,
                error: {
                    code: "ERR_EXECUTION_FAILED",
                    message: "fingerprint required patches missing for live execution"
                },
                payload: {
                    details: {
                        stage: "execution",
                        reason: "FINGERPRINT_REQUIRED_PATCH_MISSING",
                        requested_execution_mode: requestedExecutionMode,
                        missing_required_patches: missingRequiredPatches
                    },
                    ...(fingerprintRuntime ? { fingerprint_runtime: fingerprintRuntime } : {}),
                    fingerprint_forward_diagnostics: {
                        direct_message_context: summarizeFingerprintRuntimeContext(ensureFingerprintRuntimeContext(message.fingerprintContext ?? null)),
                        resolved_message_context: summarizeFingerprintRuntimeContext(messageFingerprintContext),
                        installed_runtime_context: summarizeFingerprintRuntimeContext(fingerprintRuntime)
                    }
                }
            });
            return;
        }
        const ability = asRecord(commandParams.ability);
        const input = asRecord(commandParams.input);
        const options = asRecord(commandParams.options) ?? {};
        const locationHref = this.#xhsEnv.getLocationHref();
        const actualTargetDomain = resolveTargetDomainFromHref(locationHref);
        const actualTargetPage = resolveTargetPageFromHref(locationHref, message.command) ??
            (actualTargetDomain === XHS_READ_DOMAIN &&
                message.command === "xhs.search" &&
                locationHref.includes("/search_result")
                ? "search_result_tab"
                : null);
        const observedTargetSiteLoggedIn = actualTargetDomain === XHS_READ_DOMAIN && containsCookie(this.#xhsEnv.getCookie(), "a1");
        const observedAnonymousIsolationVerified = actualTargetDomain === XHS_READ_DOMAIN && observedTargetSiteLoggedIn === false;
        const sessionId = String(message.params.session_id ?? "nm-session-001");
        const activeApiFetchFallback = resolveActiveApiFetchFallbackGateOptions({
            rawOptions: options,
            fingerprintRuntime,
            profile: message.profile,
            runId: message.runId,
            sessionId
        });
        if (!ability || !input) {
            this.#emit({
                kind: "result",
                id: message.id,
                ok: false,
                error: {
                    code: "ERR_EXECUTION_FAILED",
                    message: `${message.command} payload missing ability or input`
                },
                payload: {
                    details: {
                        stage: "execution",
                        reason: "ABILITY_PAYLOAD_MISSING"
                    },
                    ...(fingerprintRuntime ? { fingerprint_runtime: fingerprintRuntime } : {})
                }
            });
            return;
        }
        try {
            const normalizedInput = validateXhsCommandInputForExtension({
                command: message.command,
                abilityId: String(ability.id ?? "unknown"),
                abilityAction: typeof ability.action === "string" ? ability.action : "read",
                payload: input,
                options
            });
            const commonInput = {
                abilityId: String(ability.id ?? "unknown"),
                abilityLayer: String(ability.layer ?? "L3"),
                abilityAction: String(ability.action ?? "read"),
                options: {
                    ...(typeof options.timeout_ms === "number"
                        ? { timeout_ms: options.timeout_ms }
                        : { timeout_ms: message.timeoutMs }),
                    ...(typeof options.simulate_result === "string"
                        ? { simulate_result: options.simulate_result }
                        : {}),
                    ...(typeof options.x_s_common === "string" ? { x_s_common: options.x_s_common } : {}),
                    ...(typeof options.target_domain === "string"
                        ? { target_domain: options.target_domain }
                        : {}),
                    ...(typeof options.target_tab_id === "number"
                        ? { target_tab_id: options.target_tab_id }
                        : {}),
                    ...(typeof options.target_page === "string"
                        ? { target_page: options.target_page }
                        : {}),
                    ...(typeof message.tabId === "number" ? { actual_target_tab_id: message.tabId } : {}),
                    ...(actualTargetDomain ? { actual_target_domain: actualTargetDomain } : {}),
                    ...(actualTargetPage ? { actual_target_page: actualTargetPage } : {}),
                    ...(typeof ability.action === "string" ? { ability_action: ability.action } : {}),
                    ...(typeof options.action_type === "string"
                        ? { action_type: options.action_type }
                        : {}),
                    ...(typeof options.issue_scope === "string"
                        ? { issue_scope: options.issue_scope }
                        : {}),
                    ...(requestedExecutionMode !== null
                        ? { requested_execution_mode: requestedExecutionMode }
                        : {}),
                    ...(typeof options.risk_state === "string" ? { risk_state: options.risk_state } : {}),
                    ...(asRecord(options.upstream_authorization_request)
                        ? {
                            upstream_authorization_request: asRecord(options.upstream_authorization_request) ?? {}
                        }
                        : {}),
                    ...(typeof options.__legacy_requested_execution_mode === "string"
                        ? { __legacy_requested_execution_mode: options.__legacy_requested_execution_mode }
                        : {}),
                    ...(options.limited_read_rollout_ready_true === true
                        ? { limited_read_rollout_ready_true: true }
                        : {}),
                    ...(options.xhs_recovery_probe === true ? { xhs_recovery_probe: true } : {}),
                    ...(typeof options.validation_action === "string"
                        ? { validation_action: options.validation_action }
                        : {}),
                    ...(typeof options.validation_text === "string"
                        ? { validation_text: options.validation_text }
                        : {}),
                    ...(activeApiFetchFallback
                        ? { active_api_fetch_fallback: activeApiFetchFallback }
                        : {}),
                    ...(asRecord(options.editor_focus_attestation)
                        ? {
                            editor_focus_attestation: asRecord(options.editor_focus_attestation) ?? {}
                        }
                        : {}),
                    ...(asRecord(options.approval_record)
                        ? { approval_record: asRecord(options.approval_record) ?? {} }
                        : {}),
                    ...(asRecord(options.audit_record)
                        ? { audit_record: asRecord(options.audit_record) ?? {} }
                        : {}),
                    ...(asRecord(options.admission_context)
                        ? { admission_context: asRecord(options.admission_context) ?? {} }
                        : {}),
                    ...(asRecord(options.approval) ? { approval: asRecord(options.approval) ?? {} } : {}),
                    ...(actualTargetDomain === XHS_READ_DOMAIN
                        ? {
                            target_site_logged_in: observedTargetSiteLoggedIn,
                            __anonymous_isolation_verified: observedAnonymousIsolationVerified
                        }
                        : {})
                },
                executionContext: {
                    runId: message.runId,
                    sessionId,
                    profile: message.profile ?? "unknown",
                    requestId: message.id,
                    commandRequestId: asString(commandParams.request_id) ?? undefined,
                    gateInvocationId: asString(commandParams.gate_invocation_id) ?? undefined
                }
            };
            let result;
            const configureReadRequestContextProvenance = async () => {
                if (typeof this.#xhsEnv.configureCapturedRequestContextProvenance !== "function") {
                    return true;
                }
                const expected = {
                    page_context_namespace: createCurrentPageContextNamespace(locationHref),
                    profile_ref: commonInput.executionContext.profile,
                    session_id: commonInput.executionContext.sessionId,
                    target_tab_id: typeof message.tabId === "number" ? message.tabId : null,
                    run_id: commonInput.executionContext.runId,
                    action_ref: commonInput.abilityAction,
                    page_url: locationHref
                };
                const result = await this.#xhsEnv.configureCapturedRequestContextProvenance(expected).catch(() => null);
                return capturedRequestContextProvenanceConfirmed(result, expected);
            };
            if (message.command === "xhs.search") {
                const requestContextProvenanceConfirmed = await configureReadRequestContextProvenance();
                const searchInput = normalizedInput;
                result = await executeXhsSearch({
                    ...commonInput,
                    params: {
                        query: searchInput.query,
                        ...(typeof searchInput.limit === "number" ? { limit: searchInput.limit } : {}),
                        ...(typeof searchInput.page === "number" ? { page: searchInput.page } : {}),
                        ...(typeof searchInput.search_id === "string"
                            ? { search_id: searchInput.search_id }
                            : {}),
                        ...(typeof searchInput.sort === "string" ? { sort: searchInput.sort } : {}),
                        ...(typeof searchInput.note_type === "string" ||
                            typeof searchInput.note_type === "number"
                            ? { note_type: searchInput.note_type }
                            : {})
                    },
                    options: {
                        ...commonInput.options,
                        __request_context_provenance_confirmed: requestContextProvenanceConfirmed
                    }
                }, this.#xhsEnv);
            }
            else if (message.command === "xhs.detail") {
                void (await configureReadRequestContextProvenance());
                result = await executeXhsDetail({
                    ...commonInput,
                    params: {
                        note_id: normalizedInput.note_id
                    }
                }, this.#xhsEnv);
            }
            else {
                void (await configureReadRequestContextProvenance());
                result = await executeXhsUserHome({
                    ...commonInput,
                    params: {
                        user_id: normalizedInput.user_id
                    }
                }, this.#xhsEnv);
            }
            this.#emit(this.#toContentMessage(message.id, result, fingerprintRuntime));
        }
        catch (error) {
            if (error instanceof ExtensionContractError && error.code === "ERR_CLI_INVALID_ARGS") {
                this.#emit(toCliInvalidArgsResult({
                    id: message.id,
                    error,
                    fingerprintRuntime
                }));
                return;
            }
            this.#emit({
                kind: "result",
                id: message.id,
                ok: false,
                error: {
                    code: "ERR_EXECUTION_FAILED",
                    message: error instanceof Error ? error.message : String(error)
                },
                payload: fingerprintRuntime ? { fingerprint_runtime: fingerprintRuntime } : {}
            });
        }
    }
    #toContentMessage(id, result, fingerprintRuntime) {
        if (!result.ok) {
            return {
                kind: "result",
                id,
                ok: false,
                error: result.error,
                payload: {
                    ...(result.payload ?? {}),
                    ...(fingerprintRuntime ? { fingerprint_runtime: fingerprintRuntime } : {})
                }
            };
        }
        return {
            kind: "result",
            id,
            ok: true,
            payload: {
                ...(result.payload ?? {}),
                ...(fingerprintRuntime ? { fingerprint_runtime: fingerprintRuntime } : {})
            }
        };
    }
    #emit(message) {
        for (const listener of this.#listeners) {
            listener(message);
        }
    }
}
