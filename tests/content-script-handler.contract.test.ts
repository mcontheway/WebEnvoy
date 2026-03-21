import { describe, expect, it } from "vitest";

import { encodeMainWorldPayload } from "../extension/content-script-handler.js";

describe("content-script handler contract", () => {
  it("encodes payload for inline main-world script without exposing raw input", () => {
    const payload = {
      id: "req-001",
      type: "xhs-sign",
      payload: {
        uri: "/api/sns/web/v1/search/notes",
        body: {
          keyword: "</script><script>alert('x')</script>"
        }
      }
    };

    const encoded = encodeMainWorldPayload(payload);
    expect(encoded).not.toContain("</script>");
    expect(encoded).not.toContain("alert('x')");
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    expect(JSON.parse(decoded)).toEqual(payload);
  });
});
