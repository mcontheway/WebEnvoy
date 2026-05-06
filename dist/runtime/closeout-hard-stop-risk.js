const REASON_DEFINITIONS = {
    ACCOUNT_ABNORMAL: {
        riskClass: "account_abnormal",
        recoveryAction: "hard_stop_and_restore_account_safety_clear_state",
        priority: 70
    },
    CAPTCHA_REQUIRED: {
        riskClass: "captcha_required",
        recoveryAction: "hard_stop_for_manual_captcha_or_security_review",
        priority: 60
    },
    BROWSER_ENV_ABNORMAL: {
        riskClass: "browser_environment_abnormal",
        recoveryAction: "hard_stop_and_rebuild_official_chrome_environment",
        priority: 65
    },
    SECURITY_REDIRECT: {
        riskClass: "login_security_page",
        recoveryAction: "hard_stop_for_security_redirect_review",
        priority: 40
    },
    XHS_ACCOUNT_RISK_PAGE: {
        riskClass: "login_security_page",
        recoveryAction: "hard_stop_for_security_page_review",
        priority: 30
    },
    SESSION_EXPIRED: {
        riskClass: "login_security_page",
        recoveryAction: "hard_stop_and_restore_login_session",
        priority: 20
    },
    XHS_LOGIN_REQUIRED: {
        riskClass: "login_security_page",
        recoveryAction: "hard_stop_and_restore_login_session",
        priority: 10
    }
};
const SOURCE_PRIORITY = {
    account_safety: 50,
    route_failure: 40,
    api_response: 30,
    page_surface: 30,
    observability: 10
};
const EXPLICIT_REASON_ALIASES = {
    ACCOUNT_ABNORMAL: "ACCOUNT_ABNORMAL",
    CAPTCHA_REQUIRED: "CAPTCHA_REQUIRED",
    LOGIN_REQUIRED: "XHS_LOGIN_REQUIRED",
    XHS_LOGIN_REQUIRED: "XHS_LOGIN_REQUIRED",
    SESSION_EXPIRED: "SESSION_EXPIRED",
    XHS_ACCOUNT_RISK_PAGE: "XHS_ACCOUNT_RISK_PAGE",
    SECURITY_REDIRECT: "SECURITY_REDIRECT",
    BROWSER_ENV_ABNORMAL: "BROWSER_ENV_ABNORMAL"
};
const asObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const asString = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const asInteger = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.trunc(value);
    }
    if (typeof value === "string" && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
    }
    return null;
};
const compact = (value) => (value ?? "").replace(/\s+/gu, "");
const lower = (value) => (value ?? "").toLowerCase();
const lowerCompact = (value) => compact(value).toLowerCase();
const hasAny = (value, patterns) => patterns.some((pattern) => value.includes(pattern));
const hasNarrativeMarker = (text) => {
    const normalizedCompact = text.toLowerCase().replace(/\s+/gu, "");
    return (hasAny(text, [
        "这些只是",
        "普通笔记正文",
        "这篇笔记",
        "这条笔记",
        "这篇文章",
        "评论里",
        "用户评论",
        "话题讨论",
        "经验分享",
        "教程",
        "案例分析"
    ]) ||
        hasAny(normalizedCompact, [
            "thispost",
            "thisnote",
            "thisarticle",
            "ordinarycontent",
            "ordinarybody",
            "troubleshooting",
            "tutorial",
            "caseanalysis",
            "casestudy",
            "uitext",
            "copyexample"
        ]));
};
const explicitReason = (value) => {
    const raw = asString(value);
    if (!raw) {
        return null;
    }
    return EXPLICIT_REASON_ALIASES[raw.toUpperCase()] ?? null;
};
const signal = (reason, source, message, evidence) => ({
    reason,
    source,
    message,
    sourcePriority: SOURCE_PRIORITY[source],
    statusCode: evidence?.statusCode,
    platformCode: evidence?.platformCode
});
const strongerSignal = (left, right) => {
    if (!left) {
        return right;
    }
    if (!right) {
        return left;
    }
    const leftPriority = REASON_DEFINITIONS[left.reason].priority;
    const rightPriority = REASON_DEFINITIONS[right.reason].priority;
    if (rightPriority !== leftPriority) {
        return rightPriority > leftPriority ? right : left;
    }
    if (right.sourcePriority !== left.sourcePriority) {
        return right.sourcePriority > left.sourcePriority ? right : left;
    }
    return left;
};
const strongestSignal = (signals) => signals.reduce((current, item) => strongerSignal(current, item), null);
const textSignals = (value, source, mode) => {
    const raw = asString(value);
    if (!raw) {
        return [];
    }
    const text = compact(raw);
    const normalized = lower(raw);
    const normalizedCompact = lowerCompact(raw);
    const narrativeBody = mode === "body" && hasNarrativeMarker(text);
    const signals = [];
    if (normalized.includes("account abnormal") ||
        normalizedCompact.includes("account_abnormal") ||
        (!narrativeBody &&
            (text === "账号异常" ||
                text.includes("账号存在异常") ||
                (text.includes("账号异常") &&
                    hasAny(text, [
                        "平台拒绝当前请求",
                        "异常操作",
                        "请完成验证",
                        "请稍后再试",
                        "联系客服",
                        "系统检测"
                    ])))) ||
        (mode === "prominent" && text.includes("账号异常"))) {
        signals.push(signal("ACCOUNT_ABNORMAL", source, raw));
    }
    if (!narrativeBody &&
        (normalized.includes("captcha") ||
            normalized.includes("slider verification") ||
            (mode === "prominent" && hasAny(text, ["验证码", "人机验证", "滑块"])) ||
            (mode === "body" && (text === "验证码" || text === "请完成验证")) ||
            text.includes("请完成安全验证") ||
            text.includes("请输入验证码") ||
            (text.includes("验证") && text.includes("拖动")))) {
        signals.push(signal("CAPTCHA_REQUIRED", source, raw));
    }
    if (normalized.includes("browser environment abnormal") ||
        normalizedCompact.includes("browserenvironmentabnormal") ||
        (!narrativeBody &&
            (text === "浏览器环境异常" ||
                (text.includes("浏览器环境异常") &&
                    hasAny(text, ["平台拒绝当前请求", "请更换浏览器", "请完成验证", "请完成安全验证"])))) ||
        (mode === "prominent" && text.includes("浏览器环境异常"))) {
        signals.push(signal("BROWSER_ENV_ABNORMAL", source, raw));
    }
    if (normalized.includes("security redirect") ||
        normalizedCompact.includes("security_redirect")) {
        signals.push(signal("SECURITY_REDIRECT", source, raw));
    }
    if (mode === "prominent" &&
        (hasAny(text, ["当前访问存在安全风险", "安全验证", "验证后继续访问"]) ||
            normalized.includes("security verification") ||
            normalizedCompact.includes("securityverification") ||
            normalized.includes("security risk") ||
            normalizedCompact.includes("securityrisk") ||
            normalized.includes("risk verification"))) {
        signals.push(signal("XHS_ACCOUNT_RISK_PAGE", source, raw));
    }
    if (mode === "body" &&
        !narrativeBody &&
        ((text.includes("当前访问存在安全风险") &&
            hasAny(text, ["验证后继续访问", "继续访问", "请完成验证"])) ||
            text === "安全验证" ||
            normalized.includes("security verification") ||
            normalizedCompact.includes("securityverification") ||
            normalized.includes("security risk") ||
            normalizedCompact.includes("securityrisk") ||
            normalized.includes("risk verification"))) {
        signals.push(signal("XHS_ACCOUNT_RISK_PAGE", source, raw));
    }
    if (normalized.includes("session expired") ||
        normalizedCompact.includes("session_expired") ||
        text.includes("登录失效")) {
        signals.push(signal("SESSION_EXPIRED", source, raw));
    }
    if (text === "登录" ||
        text === "小红书登录" ||
        text === "小红书-登录" ||
        text.includes("登录后查看完整内容") ||
        (mode === "body" &&
            (text === "请登录" ||
                text === "登录后查看" ||
                text === "登录后查看内容" ||
                (text.startsWith("登录后查看") && text.length <= 32))) ||
        (text.includes("登录后") && hasAny(text, ["查看", "继续"])) ||
        (mode === "prominent" &&
            (text.includes("登录页") ||
                text.includes("登录后推荐更懂你的笔记") ||
                (text.includes("登录") && hasAny(text, ["扫码", "输入手机号"])))) ||
        (mode === "body" &&
            text.includes("登录后推荐更懂你的笔记") &&
            hasAny(text, ["扫码", "输入手机号"])) ||
        normalized.includes("login required") ||
        normalizedCompact.includes("login_required") ||
        normalized.includes("log in to view") ||
        normalized.includes("login to view") ||
        normalizedCompact.includes("logintoview")) {
        signals.push(signal("XHS_LOGIN_REQUIRED", source, raw));
    }
    return signals;
};
const titleSurfaceSignals = (value, source) => {
    const raw = asString(value);
    if (!raw) {
        return [];
    }
    const text = compact(raw);
    const normalized = lower(raw);
    const normalizedCompact = lowerCompact(raw);
    if (hasNarrativeMarker(text)) {
        return [];
    }
    const isBlockingTitle = text === "登录" ||
        text === "小红书登录" ||
        text === "小红书-登录" ||
        text === "安全验证" ||
        text === "账号异常" ||
        text === "浏览器环境异常" ||
        text.includes("平台拒绝当前请求") ||
        text.includes("当前访问存在安全风险") ||
        text === "请完成安全验证" ||
        text.includes("登录后推荐更懂你的笔记") ||
        normalized === "captcha required" ||
        normalized === "security verification required" ||
        normalized === "browser environment abnormal" ||
        normalized === "login required" ||
        normalizedCompact === "login_required" ||
        normalizedCompact === "account_abnormal" ||
        normalizedCompact === "security_redirect";
    if (!isBlockingTitle) {
        return [];
    }
    return textSignals(raw, source, "prominent");
};
const bodySurfaceSignals = (value, source, allowByBlockingRoute) => {
    const raw = asString(value);
    if (!raw) {
        return [];
    }
    const text = compact(raw);
    const normalized = lower(raw);
    const normalizedCompact = lowerCompact(raw);
    if (hasNarrativeMarker(text)) {
        return [];
    }
    const hasBlockingAnchor = allowByBlockingRoute ||
        hasAny(text, [
            "平台拒绝当前请求",
            "当前访问存在安全风险",
            "验证后继续访问",
            "继续访问当前页面",
            "请更换浏览器",
            "登录后查看完整内容",
            "登录后推荐更懂你的笔记",
            "拖动滑块完成验证",
            "请输入验证码"
        ]) ||
        normalized.includes("login to view full content") ||
        normalized.includes("log in to view full content");
    const isShortBlockingPrompt = text.length <= 64 &&
        (hasAny(text, [
            "账号异常",
            "账号存在异常操作",
            "请完成验证",
            "请完成安全验证",
            "安全验证",
            "拖动滑块完成验证",
            "验证码",
            "请登录",
            "登录后查看",
            "登录后查看完整内容",
            "浏览器环境异常"
        ]) ||
            normalized === "captcha required" ||
            normalized === "security verification required" ||
            normalized === "browser environment abnormal" ||
            normalized === "login required" ||
            normalizedCompact.includes("login_required"));
    if (!hasBlockingAnchor && !isShortBlockingPrompt) {
        return [];
    }
    return textSignals(raw, source, "body");
};
const pagePathSignals = (pageUrl) => {
    if (!pageUrl) {
        return [];
    }
    const path = (() => {
        try {
            return new URL(pageUrl).pathname.toLowerCase();
        }
        catch {
            return pageUrl.split(/[?#]/u, 1)[0]?.toLowerCase() ?? "";
        }
    })();
    const segments = path.split("/").filter(Boolean);
    const first = segments[0] ?? "";
    const second = segments[1] ?? "";
    const signals = [];
    if (segments.some((segment) => segment === "captcha")) {
        signals.push(signal("CAPTCHA_REQUIRED", "page_surface", pageUrl));
    }
    if (segments.some((segment) => segment === "security-redirect" || segment === "security_redirect") ||
        (first === "redirect" && second === "security")) {
        signals.push(signal("SECURITY_REDIRECT", "page_surface", pageUrl));
    }
    if (first === "login") {
        signals.push(signal("XHS_LOGIN_REQUIRED", "page_surface", pageUrl));
    }
    if (first === "security" ||
        first === "risk" ||
        first === "verify" ||
        (first === "auth" && hasAny(second, ["security", "verify", "risk"]))) {
        signals.push(signal("XHS_ACCOUNT_RISK_PAGE", "page_surface", pageUrl));
    }
    return signals;
};
const buildClearClassification = () => ({
    state: "clear",
    hard_stop: false,
    risk_class: null,
    reason: null,
    source: "none",
    required_recovery_action: null,
    should_block_route_action: false,
    evidence: {
        status_code: null,
        platform_code: null,
        page_url: null,
        page_title: null,
        selector: null,
        message: null
    }
});
export const classifyCloseoutHardStopRisk = (input) => {
    const responseBody = asObject(input.responseBody);
    const accountSafety = asObject(input.accountSafety);
    const accountSafetyFresh = input.accountSafetyFresh === true;
    const pageSurface = input.pageSurface ?? null;
    const statusCode = asInteger(input.statusCode);
    const platformCode = asInteger(input.platformCode) ??
        asInteger(responseBody?.code) ??
        asInteger(accountSafety?.platform_code);
    const accountSafetySignals = [];
    const accountSafetyReason = explicitReason(accountSafety?.reason);
    if (accountSafetyReason) {
        accountSafetySignals.push(signal(accountSafetyReason, "account_safety", asString(accountSafety?.reason)));
    }
    else if (accountSafety?.state === "account_risk_blocked") {
        accountSafetySignals.push(signal("ACCOUNT_ABNORMAL", "account_safety", "account_risk_blocked"));
    }
    const explicitRouteReason = explicitReason(input.reason);
    const routeSignals = explicitRouteReason
        ? [signal(explicitRouteReason, "route_failure", asString(input.reason))]
        : [];
    const apiSurfaceSignals = (surface) => {
        const surfaceBody = asObject(surface.responseBody);
        const surfaceStatusCode = asInteger(surface.statusCode);
        const surfacePlatformCode = asInteger(surface.platformCode) ??
            asInteger(surfaceBody?.code);
        const responseMessage = asString(surfaceBody?.msg) ??
            asString(surfaceBody?.message) ??
            null;
        const fallbackMessage = responseMessage ?? asString(surface.fallbackMessage);
        const evidence = {
            statusCode: surfaceStatusCode,
            platformCode: surfacePlatformCode
        };
        return [
            ...(surfaceStatusCode === 461 || surfacePlatformCode === 461 || surfacePlatformCode === 300011
                ? [signal("ACCOUNT_ABNORMAL", "api_response", fallbackMessage, evidence)]
                : []),
            ...(surfaceStatusCode === 429 ? [signal("CAPTCHA_REQUIRED", "api_response", fallbackMessage, evidence)] : []),
            ...(surfacePlatformCode === 300015
                ? [signal("BROWSER_ENV_ABNORMAL", "api_response", fallbackMessage, evidence)]
                : []),
            ...(surfaceStatusCode === 401 ? [signal("SESSION_EXPIRED", "api_response", fallbackMessage, evidence)] : []),
            ...textSignals(responseMessage, "api_response", "prominent").map((item) => ({
                ...item,
                statusCode: surfaceStatusCode,
                platformCode: surfacePlatformCode
            }))
        ];
    };
    const apiSignals = [
        ...apiSurfaceSignals({
            statusCode: input.statusCode,
            platformCode: input.platformCode,
            responseBody: input.responseBody,
            fallbackMessage: asString(input.reason) ?? asString(accountSafety?.reason)
        }),
        ...(Array.isArray(input.apiResponses) ? input.apiResponses.flatMap(apiSurfaceSignals) : [])
    ];
    const pathSignals = pagePathSignals(asString(pageSurface?.url));
    const pageSignals = [
        ...titleSurfaceSignals(asString(pageSurface?.title), "page_surface"),
        ...textSignals(asString(pageSurface?.overlay?.text), "page_surface", "prominent"),
        ...bodySurfaceSignals(asString(pageSurface?.bodyText), "page_surface", pathSignals.length > 0),
        ...pathSignals
    ];
    const observabilitySignals = Array.isArray(input.observabilitySignals)
        ? input.observabilitySignals
            .map((item) => asString(item))
            .filter((item) => item !== null)
            .flatMap((item) => textSignals(item, "observability", "prominent"))
        : [];
    const selected = strongestSignal([
        ...routeSignals,
        ...apiSignals,
        ...pageSignals,
        ...observabilitySignals,
        ...(accountSafetyFresh ? accountSafetySignals : [])
    ]) ?? strongestSignal(accountSafetyFresh ? [] : accountSafetySignals);
    if (!selected) {
        return buildClearClassification();
    }
    const definition = REASON_DEFINITIONS[selected.reason];
    return {
        state: "hard_stop",
        hard_stop: true,
        risk_class: definition.riskClass,
        reason: selected.reason,
        source: selected.source,
        required_recovery_action: definition.recoveryAction,
        should_block_route_action: true,
        evidence: {
            status_code: selected.statusCode ?? statusCode,
            platform_code: selected.platformCode ?? platformCode,
            page_url: asString(pageSurface?.url),
            page_title: asString(pageSurface?.title),
            selector: asString(pageSurface?.overlay?.selector),
            message: selected.message ?? asString(input.reason) ?? asString(accountSafety?.reason)
        }
    };
};
