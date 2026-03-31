import { afterEach, describe, expect, it } from "vitest";

import { performEditorInputValidation } from "../extension/xhs-editor-input.js";

class MockHTMLElement {
  id = "";
  className = "";
  tagName: string;
  textContent = "";
  innerText = "";
  ownerDocument: MockDocument;
  visible = true;
  clickCount = 0;

  constructor(ownerDocument: MockDocument, tagName: string) {
    this.ownerDocument = ownerDocument;
    this.tagName = tagName.toUpperCase();
  }

  getBoundingClientRect() {
    return this.visible
      ? { width: 160, height: 40 }
      : { width: 0, height: 0 };
  }

  querySelectorAll(_selector: string): MockHTMLElement[] {
    return [];
  }

  click() {
    this.clickCount += 1;
  }

  focus() {
    this.ownerDocument.activeElement = this as unknown as Element;
  }

  blur() {
    if (this.ownerDocument.activeElement === (this as unknown as Element)) {
      this.ownerDocument.activeElement = null;
    }
  }

  contains(node: Element | null) {
    return node === (this as unknown as Element);
  }

  dispatchEvent(_event: Event) {
    return true;
  }
}

class MockHTMLInputElement extends MockHTMLElement {
  value = "";

  constructor(ownerDocument: MockDocument) {
    super(ownerDocument, "input");
  }
}

class MockHTMLTextAreaElement extends MockHTMLElement {
  value = "";

  constructor(ownerDocument: MockDocument) {
    super(ownerDocument, "textarea");
  }
}

class MockContentEditableElement extends MockHTMLElement {
  constructor(ownerDocument: MockDocument) {
    super(ownerDocument, "div");
  }
}

class MockButtonElement extends MockHTMLElement {
  onClick?: () => void;

  constructor(ownerDocument: MockDocument, label: string) {
    super(ownerDocument, "button");
    this.textContent = label;
    this.innerText = label;
  }

  override click() {
    super.click();
    this.onClick?.();
  }
}

class MockBody extends MockHTMLElement {
  override innerText: string;

  constructor(ownerDocument: MockDocument, text: string) {
    super(ownerDocument, "body");
    this.innerText = text;
    this.textContent = text;
  }
}

class MockDocument {
  activeElement: Element | null = null;
  body: MockBody;
  landingButtons: MockButtonElement[] = [];
  editors: MockHTMLElement[] = [];

  constructor(bodyText = "创作者平台") {
    this.body = new MockBody(this, bodyText);
  }

  querySelectorAll(selector: string): Element[] {
    if (selector === "*") {
      return [...this.landingButtons, ...this.editors] as unknown as Element[];
    }
    if (selector === "iframe") {
      return [];
    }
    if (selector === "button, [role='button']") {
      return this.landingButtons as unknown as Element[];
    }
    if (
      selector === '[contenteditable="true"][role="textbox"]' ||
      selector === '[contenteditable="true"][data-lexical-editor="true"]' ||
      selector === '[contenteditable="true"]'
    ) {
      return this.editors.filter(
        (entry) =>
          !(entry instanceof MockHTMLTextAreaElement) && !(entry instanceof MockHTMLInputElement)
      ) as unknown as Element[];
    }
    if (selector === "textarea") {
      return this.editors.filter((entry) => entry instanceof MockHTMLTextAreaElement) as unknown as Element[];
    }
    if (selector === 'input[type="text"]') {
      return this.editors.filter((entry) => entry instanceof MockHTMLInputElement) as unknown as Element[];
    }
    return [];
  }

  createRange() {
    return {
      selectNodeContents: (_node: unknown) => {},
      collapse: (_toStart: boolean) => {}
    };
  }
}

describe("xhs editor input contract", () => {
  afterEach(() => {
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { HTMLElement?: unknown }).HTMLElement;
    delete (globalThis as { HTMLInputElement?: unknown }).HTMLInputElement;
    delete (globalThis as { HTMLTextAreaElement?: unknown }).HTMLTextAreaElement;
    delete (globalThis as { InputEvent?: unknown }).InputEvent;
    delete (globalThis as { CompositionEvent?: unknown }).CompositionEvent;
  });

  it("uses background attestation to validate editor input after entering editable state", async () => {
    const document = new MockDocument("长文落地页");
    const createButton = new MockButtonElement(document, "新的创作");
    const editor = new MockHTMLTextAreaElement(document);
    document.editors = [editor];
    document.landingButtons = [createButton];
    document.editors = [editor];

    (globalThis as { document?: unknown }).document = document;
    (globalThis as { window?: unknown }).window = {
      location: {
        href: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article"
      },
      getComputedStyle: () => ({ visibility: "visible", display: "block" }),
      getSelection: () => null
    };
    (globalThis as { HTMLElement?: unknown }).HTMLElement = MockHTMLElement;
    (globalThis as { HTMLInputElement?: unknown }).HTMLInputElement = MockHTMLInputElement;
    (globalThis as { HTMLTextAreaElement?: unknown }).HTMLTextAreaElement = MockHTMLTextAreaElement;
    (globalThis as { InputEvent?: unknown }).InputEvent = Event;
    (globalThis as { CompositionEvent?: unknown }).CompositionEvent = Event;

    const result = await performEditorInputValidation({
      text: "测试发布文案",
      focusAttestation: {
        source: "chrome_debugger",
        target_tab_id: 32,
        editable_state: "entered",
        focus_confirmed: true,
        entry_button_locator: "button",
        editor_locator: "textarea",
        failure_reason: null
      }
    });

    expect(createButton.clickCount).toBe(0);
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("controlled_editor_input_validation");
    expect(result.attestation).toBe("controlled_real_interaction");
    expect(result.editor_locator).toBe("textarea");
    expect(result.focus_attestation_source).toBe("chrome_debugger");
    expect(result.focus_attestation_reason).toBeNull();
    expect(result.visible_text).toContain("测试发布文案");
    expect(result.success_signals).toEqual([
      "editable_state_entered",
      "editor_focus_attested",
      "text_visible",
      "text_persisted_after_blur"
    ]);
    expect(result.minimum_replay).toEqual([
      "enter_editable_mode",
      "focus_editor",
      "type_short_text",
      "blur_or_reobserve"
    ]);
  });

  it("does not treat 新建长文合集 as editor entry", async () => {
    const document = new MockDocument("长文落地页");
    const collectionButton = new MockButtonElement(document, "新建长文合集");
    document.landingButtons = [collectionButton];

    (globalThis as { document?: unknown }).document = document;
    (globalThis as { window?: unknown }).window = {
      location: {
        href: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article"
      },
      getComputedStyle: () => ({ visibility: "visible", display: "block" }),
      getSelection: () => null
    };
    (globalThis as { HTMLElement?: unknown }).HTMLElement = MockHTMLElement;
    (globalThis as { HTMLInputElement?: unknown }).HTMLInputElement = MockHTMLInputElement;
    (globalThis as { HTMLTextAreaElement?: unknown }).HTMLTextAreaElement = MockHTMLTextAreaElement;
    (globalThis as { InputEvent?: unknown }).InputEvent = Event;
    (globalThis as { CompositionEvent?: unknown }).CompositionEvent = Event;

    const result = await performEditorInputValidation({ text: "测试发布文案" });

    expect(collectionButton.clickCount).toBe(0);
    expect(result.ok).toBe(false);
    expect(result.attestation).toBe("dom_self_certified");
    expect(result.editor_locator).toBeNull();
    expect(result.failure_signals).toEqual(["editable_state_entry_missing", "dom_variant"]);
  });

  it("does not treat contenteditable DOM mutation fallback as a successful live input", async () => {
    const document = new MockDocument("创作者平台");
    const editor = new MockContentEditableElement(document);
    document.editors = [editor];

    (globalThis as { document?: unknown }).document = document;
    (globalThis as { window?: unknown }).window = {
      location: {
        href: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article"
      },
      getComputedStyle: () => ({ visibility: "visible", display: "block" }),
      getSelection: () => ({
        removeAllRanges: () => {},
        addRange: () => {}
      })
    };
    (globalThis as { HTMLElement?: unknown }).HTMLElement = MockHTMLElement;
    (globalThis as { HTMLInputElement?: unknown }).HTMLInputElement = MockHTMLInputElement;
    (globalThis as { HTMLTextAreaElement?: unknown }).HTMLTextAreaElement = MockHTMLTextAreaElement;
    (globalThis as { InputEvent?: unknown }).InputEvent = Event;
    (globalThis as { CompositionEvent?: unknown }).CompositionEvent = Event;

    const result = await performEditorInputValidation({ text: "测试发布文案" });

    expect(result.ok).toBe(false);
    expect(result.attestation).toBe("dom_self_certified");
    expect(result.editor_locator).toBe("div");
    expect(result.focus_attestation_source).toBeNull();
    expect(result.failure_signals).toContain("dom_variant");
    expect(result.failure_signals).toContain("missing_focus_attestation");
    expect(result.success_signals).not.toContain("text_visible");
  });

  it("fails when background debugger attestation cannot attach", async () => {
    const document = new MockDocument("创作者平台");
    const editor = new MockHTMLTextAreaElement(document);
    document.editors = [editor];

    (globalThis as { document?: unknown }).document = document;
    (globalThis as { window?: unknown }).window = {
      location: {
        href: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article"
      },
      getComputedStyle: () => ({ visibility: "visible", display: "block" }),
      getSelection: () => null
    };
    (globalThis as { HTMLElement?: unknown }).HTMLElement = MockHTMLElement;
    (globalThis as { HTMLInputElement?: unknown }).HTMLInputElement = MockHTMLInputElement;
    (globalThis as { HTMLTextAreaElement?: unknown }).HTMLTextAreaElement = MockHTMLTextAreaElement;
    (globalThis as { InputEvent?: unknown }).InputEvent = Event;
    (globalThis as { CompositionEvent?: unknown }).CompositionEvent = Event;

    const result = await performEditorInputValidation({
      text: "测试发布文案",
      focusAttestation: {
        source: "chrome_debugger",
        target_tab_id: 32,
        editable_state: "already_ready",
        focus_confirmed: false,
        entry_button_locator: null,
        editor_locator: "textarea",
        failure_reason: "DEBUGGER_ATTACH_FAILED"
      }
    });

    expect(result.ok).toBe(false);
    expect(result.attestation).toBe("dom_self_certified");
    expect(result.focus_attestation_source).toBe("chrome_debugger");
    expect(result.focus_attestation_reason).toBe("DEBUGGER_ATTACH_FAILED");
    expect(result.failure_signals).toEqual(
      expect.arrayContaining(["debugger_attach_failed", "editor_focus_not_attested", "dom_variant"])
    );
  });
});
