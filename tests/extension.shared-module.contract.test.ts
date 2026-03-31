import { describe, expect, it } from "vitest";

import {
  APPROVAL_CHECK_KEYS,
  EXECUTION_MODES,
  WRITE_INTERACTION_TIER
} from "../extension/shared/risk-state.js";
import {
  DEFAULT_MIME_TYPE_DESCRIPTORS,
  DEFAULT_PLUGIN_DESCRIPTORS,
  ensureFingerprintRuntimeContext
} from "../extension/shared/fingerprint-profile.js";

describe("extension shared module contract", () => {
  it("exports risk-state helpers from the extension root", () => {
    expect(APPROVAL_CHECK_KEYS).toContain("target_domain_confirmed");
    expect(EXECUTION_MODES).toContain("live_write");
    expect(WRITE_INTERACTION_TIER.tiers).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "reversible_interaction" })])
    );
  });

  it("exports fingerprint helpers from the extension root", () => {
    expect(DEFAULT_PLUGIN_DESCRIPTORS.length).toBeGreaterThan(0);
    expect(DEFAULT_MIME_TYPE_DESCRIPTORS.length).toBeGreaterThan(0);
    expect(typeof ensureFingerprintRuntimeContext).toBe("function");
  });
});
