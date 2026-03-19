import { normalizeFailureSite } from "./observability.js";
const DEFAULT_MAX_EVIDENCE_ITEMS = 4;
const DEFAULT_MAX_EVIDENCE_LENGTH = 160;
const REDACTED = "[REDACTED]";
const EXECUTION_INTERRUPTED_HINT = /(interrupt(?:ed|ion)?|abort(?:ed)?|disconnect(?:ed)?|closed?|terminate(?:d)?|timeout|timed out|cancel(?:ed|led)?|econnreset|eof|broken pipe|中断|断开|超时)/iu;
const nonEmpty = (value, fallback) => {
    const normalized = typeof value === "string" ? value.trim() : "";
    return normalized.length > 0 ? normalized : fallback;
};
const truncate = (value, maxLength) => {
    if (maxLength <= 0) {
        return "";
    }
    if (value.length <= maxLength) {
        return value;
    }
    return value.slice(0, maxLength);
};
const sanitizeEvidence = (value) => value
    .replace(/\bauthorization\s*:\s*[^\n\r]+/gi, `authorization: ${REDACTED}`)
    .replace(/\bcookie\s*:\s*[^\n\r]+/gi, `cookie: ${REDACTED}`)
    .replace(/([?&])(token|access_token|id_token|refresh_token|signature|sig|auth|code)=([^&#\s]+)/gi, (_match, prefix, key) => `${prefix}${key}=${REDACTED}`)
    .replace(/\b(token|access_token|id_token|refresh_token|signature|sig|auth|code)\s*=\s*([^&\s,;]+)/gi, (_match, key) => `${key}=${REDACTED}`)
    .replace(/\b(token|access_token|id_token|refresh_token|signature|sig|auth|code)\s*:\s*([^\s,;]+)/gi, (_match, key) => `${key}: ${REDACTED}`);
const inferCategoryFromFailureSite = (failureSite, stage, component) => {
    const normalizedStage = stage.toLowerCase();
    const normalizedComponent = component.toLowerCase();
    const summary = failureSite?.summary.toLowerCase() ?? "";
    const target = failureSite?.target.toLowerCase() ?? "";
    if (normalizedStage === "request" ||
        normalizedComponent === "network" ||
        normalizedComponent === "request") {
        return "request_failed";
    }
    if (normalizedComponent === "page" ||
        normalizedComponent === "dom" ||
        normalizedStage === "page" ||
        normalizedStage === "action") {
        return "page_changed";
    }
    if (normalizedStage === "transport" ||
        normalizedComponent === "bridge" ||
        EXECUTION_INTERRUPTED_HINT.test(summary) ||
        EXECUTION_INTERRUPTED_HINT.test(target)) {
        return "execution_interrupted";
    }
    if (normalizedStage === "runtime" ||
        normalizedComponent === "runtime" ||
        normalizedComponent === "cli") {
        return "runtime_unavailable";
    }
    return failureSite === null ? null : "unknown";
};
const inferCategory = (signals, failureSite, stage, component) => {
    const fromFailureSite = inferCategoryFromFailureSite(failureSite, stage, component);
    if (fromFailureSite !== null && fromFailureSite !== "unknown") {
        return fromFailureSite;
    }
    if (signals?.execution_interrupted) {
        return "execution_interrupted";
    }
    if (signals?.runtime_unavailable) {
        return "runtime_unavailable";
    }
    if (signals?.request_failed) {
        return "request_failed";
    }
    if (signals?.page_changed) {
        return "page_changed";
    }
    return "unknown";
};
const normalizeEvidence = (evidence, options) => {
    const maxItems = options?.maxEvidenceItems ?? DEFAULT_MAX_EVIDENCE_ITEMS;
    const maxLength = options?.maxEvidenceLength ?? DEFAULT_MAX_EVIDENCE_LENGTH;
    const items = Array.isArray(evidence) ? evidence : [];
    return items
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => item.length > 0)
        .slice(0, Math.max(0, maxItems))
        .map((item) => truncate(sanitizeEvidence(item), maxLength));
};
const fallbackFailureSite = (stage, component, candidate) => {
    if (candidate !== null) {
        return candidate;
    }
    return {
        stage,
        component,
        target: "unknown",
        summary: "diagnosis unavailable"
    };
};
export const buildDiagnosis = (input, options) => {
    const failureSite = normalizeFailureSite(input.failure_site);
    const stage = nonEmpty(input.stage, failureSite?.stage ?? "unknown");
    const component = nonEmpty(input.component, failureSite?.component ?? "unknown");
    const category = input.category ?? inferCategory(input.signals, failureSite, stage, component);
    const evidence = normalizeEvidence(input.evidence, options);
    return {
        category,
        stage,
        component,
        failure_site: fallbackFailureSite(stage, component, failureSite),
        evidence
    };
};
export const createMinimalDiagnosis = () => buildDiagnosis({
    category: "unknown",
    stage: "unknown",
    component: "unknown",
    failure_site: {
        stage: "unknown",
        component: "unknown",
        target: "unknown",
        summary: "diagnosis unavailable"
    },
    evidence: []
});
