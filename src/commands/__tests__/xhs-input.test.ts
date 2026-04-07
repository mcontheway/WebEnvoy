import { describe, expect, it } from "vitest";

import {
  normalizeGateOptions,
  parseAbilityEnvelope,
  parseSearchInput
} from "../xhs-input.js";

describe("xhs input module boundaries", () => {
  it("parses ability envelope without depending on command execution state", () => {
    expect(
      parseAbilityEnvelope({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          target_domain: "www.xiaohongshu.com"
        }
      })
    ).toEqual({
      ability: {
        id: "xhs.note.search.v1",
        layer: "L3",
        action: "read"
      },
      input: {
        query: "露营装备"
      },
      options: {
        target_domain: "www.xiaohongshu.com"
      }
    });
  });

  it("keeps issue_208 editor_input validation out of search payload shaping", () => {
    expect(
      parseSearchInput(
        {
          query: "should-not-be-required"
        },
        "xhs.issue208.editor_input",
        {
          issue_scope: "issue_208",
          action_type: "write",
          requested_execution_mode: "live_write",
          validation_action: "editor_input"
        },
        "write"
      )
    ).toEqual({});
  });

  it("normalizes explicit gate coordinates without changing gate semantics", () => {
    expect(
      normalizeGateOptions(
        {
          target_domain: " www.xiaohongshu.com ",
          target_tab_id: 32,
          target_page: " search_result_tab ",
          requested_execution_mode: "live_read_high_risk"
        },
        "xhs.note.search.v1"
      )
    ).toEqual({
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 32,
      targetPage: "search_result_tab",
      requestedExecutionMode: "live_read_high_risk",
      options: {
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 32,
        target_page: "search_result_tab",
        requested_execution_mode: "live_read_high_risk"
      }
    });
  });
});
