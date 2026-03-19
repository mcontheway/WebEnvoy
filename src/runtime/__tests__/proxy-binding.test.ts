import { describe, expect, it } from "vitest";

import { resolveProxyBinding } from "../proxy-binding.js";

describe("proxy-binding", () => {
  it("binds proxy when profile has no prior binding", () => {
    const result = resolveProxyBinding({
      current: null,
      requested: "http://127.0.0.1:8080",
      nowIso: "2026-03-19T10:00:00.000Z",
      source: "runtime.start"
    });

    expect(result.conflict).toBe(false);
    expect(result.changed).toBe(true);
    expect(result.binding?.url).toBe("http://127.0.0.1:8080/");
  });

  it("reuses existing binding when caller does not request override", () => {
    const result = resolveProxyBinding({
      current: {
        url: "http://127.0.0.1:8080/",
        boundAt: "2026-03-19T10:00:00.000Z",
        source: "runtime.start"
      },
      requested: undefined,
      nowIso: "2026-03-19T10:01:00.000Z",
      source: "runtime.start"
    });

    expect(result.conflict).toBe(false);
    expect(result.changed).toBe(false);
    expect(result.binding?.url).toBe("http://127.0.0.1:8080/");
  });

  it("reports conflict for explicit proxy mismatch", () => {
    const result = resolveProxyBinding({
      current: {
        url: "http://127.0.0.1:8080/",
        boundAt: "2026-03-19T10:00:00.000Z",
        source: "runtime.start"
      },
      requested: "http://127.0.0.1:9090",
      nowIso: "2026-03-19T10:01:00.000Z",
      source: "runtime.start"
    });

    expect(result.conflict).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.binding?.url).toBe("http://127.0.0.1:8080/");
  });

  it("reports conflict for explicit null when profile is bound to a proxy", () => {
    const result = resolveProxyBinding({
      current: {
        url: "http://127.0.0.1:8080/",
        boundAt: "2026-03-19T10:00:00.000Z",
        source: "runtime.start"
      },
      requested: null,
      nowIso: "2026-03-19T10:01:00.000Z",
      source: "runtime.login"
    });

    expect(result.conflict).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.binding?.url).toBe("http://127.0.0.1:8080/");
  });

  it("accepts direct mode with null binding", () => {
    const result = resolveProxyBinding({
      current: null,
      requested: null,
      nowIso: "2026-03-19T10:00:00.000Z",
      source: "runtime.start"
    });

    expect(result.conflict).toBe(false);
    expect(result.binding?.url).toBeNull();
  });

  it("throws on unsupported proxy scheme", () => {
    expect(() =>
      resolveProxyBinding({
        current: null,
        requested: "ftp://127.0.0.1:8080",
        nowIso: "2026-03-19T10:00:00.000Z",
        source: "runtime.start"
      })
    ).toThrow(/unsupported proxy protocol/i);
  });
});
