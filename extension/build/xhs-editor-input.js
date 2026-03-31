const TARGET_PAGE = "creator.xiaohongshu.com/publish";
const BASE_MINIMUM_REPLAY = ["focus_editor", "type_short_text", "blur_or_reobserve"];
const ARTICLE_EDIT_MODE_REPLAY_STEP = "enter_editable_mode";
const EDITOR_MODE_ENTRY_LABELS = ["新的创作"];
const EDITOR_MODE_ENTRY_WAIT_MS = 200;
const EDITOR_MODE_ENTRY_MAX_ATTEMPTS = 10;
const EDITOR_SELECTORS = [
    'div.tiptap.ProseMirror[contenteditable="true"]',
    '[contenteditable="true"].tiptap.ProseMirror',
    '[contenteditable="true"].ProseMirror',
    '[contenteditable="true"][data-lexical-editor="true"]'
];
const asHTMLElement = (value) => value instanceof HTMLElement ? value : null;
const isVisible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return (rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none");
};
const buildLocator = (element) => {
    if (element.id) {
        return `#${element.id}`;
    }
    const className = typeof element.className === "string"
        ? element.className
            .split(/\s+/)
            .map((token) => token.trim())
            .filter((token) => token.length > 0)
            .slice(0, 2)
            .join(".")
        : "";
    if (className) {
        return `${element.tagName.toLowerCase()}.${className}`;
    }
    return element.tagName.toLowerCase();
};
const buildTargetKey = (element) => {
    const segments = [];
    let current = element;
    while (current) {
        const parent = current.parentElement;
        const tagName = current.tagName.toLowerCase();
        if (!parent) {
            segments.unshift(current.id ? `${tagName}#${current.id}` : tagName);
            break;
        }
        const siblings = [...parent.children].filter((candidate) => candidate instanceof HTMLElement && candidate.tagName === current?.tagName);
        const position = siblings.indexOf(current) + 1;
        const idSegment = current.id ? `#${current.id}` : "";
        segments.unshift(`${tagName}${idSegment}:nth-of-type(${position})`);
        current = parent;
    }
    return segments.join(" > ");
};
const collectSearchRoots = (root) => {
    const roots = [root];
    const descendants = [...root.querySelectorAll("*")];
    for (const element of descendants) {
        if (element.shadowRoot) {
            roots.push(...collectSearchRoots(element.shadowRoot));
        }
    }
    const iframes = [...root.querySelectorAll("iframe")];
    for (const iframe of iframes) {
        try {
            const frameDocument = iframe.contentDocument;
            if (frameDocument) {
                roots.push(...collectSearchRoots(frameDocument));
            }
        }
        catch {
            continue;
        }
    }
    return roots;
};
const findEditorElements = () => {
    const seen = new Set();
    const results = [];
    const roots = collectSearchRoots(document);
    for (const selector of EDITOR_SELECTORS) {
        for (const searchRoot of roots) {
            const candidates = [...searchRoot.querySelectorAll(selector)]
                .map((entry) => asHTMLElement(entry))
                .filter((entry) => entry !== null && isVisible(entry));
            for (const candidate of candidates) {
                if (seen.has(candidate)) {
                    continue;
                }
                seen.add(candidate);
                results.push(candidate);
            }
        }
    }
    return results;
};
const readElementText = (element) => {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        return element.value;
    }
    return element.textContent?.trim() ?? "";
};
const createBubbledEvent = (type) => new Event(type, { bubbles: true });
const createBubbledInputEvent = (type, text) => {
    if (typeof InputEvent === "function") {
        try {
            return new InputEvent(type, { bubbles: true, data: text, inputType: "insertText" });
        }
        catch {
            // Fall back to a generic Event in test environments without a full InputEvent implementation.
        }
    }
    return createBubbledEvent(type);
};
const createBubbledCompositionEvent = (type, text) => {
    if (typeof CompositionEvent === "function") {
        try {
            return new CompositionEvent(type, { bubbles: true, data: text });
        }
        catch {
            // Fall back to a generic Event in test environments without a full CompositionEvent implementation.
        }
    }
    return createBubbledEvent(type);
};
const dispatchSyntheticTextInputSequence = (element, text) => {
    element.dispatchEvent(createBubbledCompositionEvent("compositionstart", text));
    element.dispatchEvent(createBubbledCompositionEvent("compositionupdate", text));
    element.dispatchEvent(createBubbledInputEvent("beforeinput", text));
    element.dispatchEvent(createBubbledCompositionEvent("compositionend", text));
    element.dispatchEvent(createBubbledInputEvent("input", text));
    element.dispatchEvent(createBubbledEvent("change"));
};
const appendTextToEditable = (element, text) => {
    const current = readElementText(element);
    const next = current.length > 0 ? `${current} ${text}` : text;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        dispatchSyntheticTextInputSequence(element, text);
        element.value = next;
        return readElementText(element).includes(text);
    }
    const selection = window.getSelection();
    if (selection) {
        const range = document.createRange();
        range.selectNodeContents(element);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
    }
    let inserted = false;
    if (typeof document.execCommand === "function") {
        try {
            inserted = document.execCommand("insertText", false, current.length > 0 ? ` ${text}` : text);
        }
        catch {
            inserted = false;
        }
    }
    dispatchSyntheticTextInputSequence(element, text);
    if (!inserted) {
        return false;
    }
    return readElementText(element).includes(text);
};
const findVisibleButtonByLabels = (scope, labels) => {
    const buttons = [...scope.querySelectorAll("button, [role='button']")]
        .map((entry) => asHTMLElement(entry))
        .filter((entry) => entry !== null && isVisible(entry));
    for (const button of buttons) {
        const text = button.innerText?.trim() ?? button.textContent?.trim() ?? "";
        if (labels.some((label) => text.includes(label))) {
            return button;
        }
    }
    return null;
};
const sleep = async (timeoutMs) => {
    await new Promise((resolve) => setTimeout(resolve, timeoutMs));
};
const buildMinimumReplay = (activation) => activation === "activated"
    ? [ARTICLE_EDIT_MODE_REPLAY_STEP, ...BASE_MINIMUM_REPLAY]
    : [...BASE_MINIMUM_REPLAY];
const resolveActivationFromAttestation = (attestation) => {
    if (!attestation) {
        return "already_ready";
    }
    return attestation.editable_state === "entered" ? "activated" : "already_ready";
};
const normalizeFocusAttestationFailure = (attestation) => {
    if (!attestation) {
        return ["missing_focus_attestation"];
    }
    if (attestation.failure_reason === "EDITOR_ENTRY_NOT_VISIBLE") {
        return ["editable_state_entry_missing"];
    }
    if (attestation.failure_reason === "EDITOR_FOCUS_NOT_ATTESTED") {
        return ["editor_focus_not_attested"];
    }
    if (attestation.failure_reason === "DEBUGGER_ATTACH_FAILED") {
        return ["debugger_attach_failed", "editor_focus_not_attested"];
    }
    if (attestation.failure_reason === "DEBUGGER_INTERACTION_FAILED") {
        return ["debugger_interaction_failed", "editor_focus_not_attested"];
    }
    return ["editor_focus_not_attested"];
};
const resolveAttestedTargetBinding = (attestation, targetKey) => {
    if (!attestation || attestation.focus_confirmed !== true) {
        return { focusConfirmed: false, bindingFailureSignal: null };
    }
    if (typeof attestation.editor_target_key !== "string" || attestation.editor_target_key.length === 0) {
        return { focusConfirmed: false, bindingFailureSignal: "ambiguous_editor_target" };
    }
    return {
        focusConfirmed: attestation.editor_target_key === targetKey,
        bindingFailureSignal: attestation.editor_target_key === targetKey ? null : "ambiguous_editor_target"
    };
};
const isTargetPage = () => window.location.href.includes(TARGET_PAGE);
const isArticleTargetPage = () => {
    if (!isTargetPage()) {
        return false;
    }
    try {
        const url = new URL(window.location.href);
        return url.searchParams.get("target") === "article";
    }
    catch {
        return false;
    }
};
const enterEditableStateIfNeeded = async () => {
    if (!isArticleTargetPage()) {
        return "already_ready";
    }
    if (findEditorElements().length > 0) {
        return "already_ready";
    }
    const createButton = findVisibleButtonByLabels(document, EDITOR_MODE_ENTRY_LABELS);
    if (!createButton) {
        return "entry_missing";
    }
    createButton.click();
    for (let attempt = 0; attempt < EDITOR_MODE_ENTRY_MAX_ATTEMPTS; attempt += 1) {
        await Promise.resolve();
        await sleep(EDITOR_MODE_ENTRY_WAIT_MS);
        await Promise.resolve();
        if (findEditorElements().length > 0) {
            return "activated";
        }
    }
    return "activation_failed";
};
export const performEditorInputValidation = async (input) => {
    const focusAttestation = input.focusAttestation ?? null;
    const activation = focusAttestation
        ? resolveActivationFromAttestation(focusAttestation)
        : await enterEditableStateIfNeeded();
    const editors = findEditorElements();
    const minimumReplay = buildMinimumReplay(activation);
    if (isTargetPage() && !isArticleTargetPage()) {
        return {
            ok: false,
            mode: "dom_editor_input_validation",
            attestation: "dom_self_certified",
            editor_locator: null,
            input_text: input.text,
            before_text: "",
            visible_text: "",
            post_blur_text: "",
            focus_confirmed: false,
            focus_attestation_source: focusAttestation?.source ?? null,
            focus_attestation_reason: focusAttestation?.failure_reason ?? null,
            preserved_after_blur: false,
            success_signals: [],
            failure_signals: ["target_page_article_required", "dom_variant"],
            minimum_replay: minimumReplay
        };
    }
    if (editors.length === 0) {
        const failureSignals = activation === "entry_missing"
            ? ["editable_state_entry_missing", "dom_variant"]
            : activation === "activation_failed"
                ? ["editable_state_not_entered", "dom_variant"]
                : [...normalizeFocusAttestationFailure(focusAttestation), "dom_variant"];
        return {
            ok: false,
            mode: "dom_editor_input_validation",
            attestation: "dom_self_certified",
            editor_locator: null,
            input_text: input.text,
            before_text: "",
            visible_text: "",
            post_blur_text: "",
            focus_confirmed: false,
            focus_attestation_source: focusAttestation?.source ?? null,
            focus_attestation_reason: focusAttestation?.failure_reason ?? null,
            preserved_after_blur: false,
            success_signals: [],
            failure_signals: failureSignals,
            minimum_replay: minimumReplay
        };
    }
    const normalizedPageText = document.body?.innerText ?? "";
    let bestAttempt = null;
    for (const editor of editors) {
        const beforeText = readElementText(editor);
        const locator = buildLocator(editor);
        const targetKey = buildTargetKey(editor);
        const { focusConfirmed, bindingFailureSignal } = resolveAttestedTargetBinding(focusAttestation, targetKey);
        const textInserted = focusConfirmed ? appendTextToEditable(editor, input.text) : false;
        await Promise.resolve();
        const visibleText = readElementText(editor);
        if (typeof editor.blur === "function") {
            editor.blur();
        }
        await Promise.resolve();
        const postBlurText = readElementText(editor);
        const preservedAfterBlur = postBlurText.includes(input.text);
        const successSignals = activation === "activated" ? ["editable_state_entered"] : [];
        const failureSignals = [];
        if (focusConfirmed) {
            successSignals.push("editor_focus_attested");
        }
        else {
            failureSignals.push(...normalizeFocusAttestationFailure(focusAttestation));
            if (bindingFailureSignal) {
                failureSignals.push(bindingFailureSignal);
            }
        }
        if (textInserted && visibleText.includes(input.text)) {
            successSignals.push("text_visible");
        }
        else {
            failureSignals.push("dom_variant");
        }
        if (preservedAfterBlur) {
            successSignals.push("text_persisted_after_blur");
        }
        else {
            failureSignals.push("text_reverted");
        }
        if (/风险|risk|提示|异常/u.test(normalizedPageText)) {
            failureSignals.push("risk_prompt");
        }
        const hasBlockingFailure = failureSignals.includes("text_reverted") ||
            failureSignals.includes("risk_prompt") ||
            failureSignals.includes("dom_variant");
        const controlledSuccess = focusAttestation?.source === "chrome_debugger" &&
            focusConfirmed &&
            textInserted &&
            visibleText.includes(input.text) &&
            preservedAfterBlur &&
            !hasBlockingFailure;
        const attempt = {
            ok: controlledSuccess,
            mode: controlledSuccess
                ? "controlled_editor_input_validation"
                : "dom_editor_input_validation",
            attestation: controlledSuccess ? "controlled_real_interaction" : "dom_self_certified",
            editor_locator: locator,
            input_text: input.text,
            before_text: beforeText,
            visible_text: visibleText,
            post_blur_text: postBlurText,
            focus_confirmed: focusConfirmed,
            focus_attestation_source: focusAttestation?.source ?? null,
            focus_attestation_reason: focusAttestation?.failure_reason ?? null,
            preserved_after_blur: preservedAfterBlur,
            success_signals: successSignals,
            failure_signals: failureSignals,
            minimum_replay: minimumReplay
        };
        if (attempt.ok) {
            return attempt;
        }
        if (!bestAttempt || attempt.success_signals.length > bestAttempt.success_signals.length) {
            bestAttempt = attempt;
        }
    }
    return (bestAttempt ?? {
        ok: false,
        mode: "dom_editor_input_validation",
        attestation: "dom_self_certified",
        editor_locator: null,
        input_text: input.text,
        before_text: "",
        visible_text: "",
        post_blur_text: "",
        focus_confirmed: false,
        focus_attestation_source: focusAttestation?.source ?? null,
        focus_attestation_reason: focusAttestation?.failure_reason ?? null,
        preserved_after_blur: false,
        success_signals: [],
        failure_signals: [...normalizeFocusAttestationFailure(focusAttestation), "dom_variant"],
        minimum_replay: minimumReplay
    });
};
