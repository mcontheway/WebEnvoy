const TARGET_PAGE = "creator.xiaohongshu.com/publish";
const MINIMUM_REPLAY = ["focus_editor", "type_short_text", "blur_or_reobserve"];
const EDITOR_SELECTORS = [
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"][data-lexical-editor="true"]',
    '[contenteditable="true"]',
    "textarea",
    'input[type="text"]'
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
const findEditorElement = () => {
    for (const selector of EDITOR_SELECTORS) {
        const candidates = [...document.querySelectorAll(selector)]
            .map((entry) => asHTMLElement(entry))
            .filter((entry) => entry !== null && isVisible(entry));
        if (candidates.length > 0) {
            return candidates[0];
        }
    }
    return null;
};
const readElementText = (element) => {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        return element.value;
    }
    return element.textContent?.trim() ?? "";
};
const focusElement = (element) => {
    if (typeof element.click === "function") {
        element.click();
    }
    if (typeof element.focus === "function") {
        element.focus();
    }
    return document.activeElement === element || element.contains(document.activeElement);
};
const appendTextToEditable = (element, text) => {
    const current = readElementText(element);
    const next = current.length > 0 ? `${current} ${text}` : text;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        element.value = next;
        element.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return;
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
    if (!inserted) {
        element.textContent = next;
    }
    element.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
};
export const performEditorInputValidation = async (input) => {
    const editor = findEditorElement();
    if (!editor) {
        return {
            ok: false,
            mode: "dom_editor_input_validation",
            editor_locator: null,
            input_text: input.text,
            before_text: "",
            visible_text: "",
            post_blur_text: "",
            focus_confirmed: false,
            preserved_after_blur: false,
            success_signals: [],
            failure_signals: ["dom_variant"],
            minimum_replay: MINIMUM_REPLAY
        };
    }
    const beforeText = readElementText(editor);
    const focusConfirmed = focusElement(editor);
    appendTextToEditable(editor, input.text);
    await Promise.resolve();
    const visibleText = readElementText(editor);
    if (typeof editor.blur === "function") {
        editor.blur();
    }
    await Promise.resolve();
    const postBlurText = readElementText(editor);
    const preservedAfterBlur = postBlurText.includes(input.text);
    const successSignals = [];
    const failureSignals = [];
    const normalizedPageText = document.body?.innerText ?? "";
    if (focusConfirmed) {
        successSignals.push("editor_focused");
    }
    else {
        failureSignals.push("focus_lost");
    }
    if (visibleText.includes(input.text)) {
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
    return {
        ok: focusConfirmed && visibleText.includes(input.text) && preservedAfterBlur,
        mode: "dom_editor_input_validation",
        editor_locator: buildLocator(editor),
        input_text: input.text,
        before_text: beforeText,
        visible_text: visibleText,
        post_blur_text: postBlurText,
        focus_confirmed: focusConfirmed,
        preserved_after_blur: preservedAfterBlur,
        success_signals: successSignals,
        failure_signals: failureSignals,
        minimum_replay: MINIMUM_REPLAY
    };
};
