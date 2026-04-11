import { describe, expect, it } from "vitest";
import {
  normalizeGateOptionsForContract,
  parseAbilityEnvelopeForContract,
  parseXhsCommandInputForContract,
  parseDetailInputForContract,
  parseSearchInputForContract,
  parseUserHomeInputForContract
} from "../xhs-input.js";

describe("xhs-input", () => {
  it("parses ability envelope and normalizes xhs.search input", () => {
    const envelope = parseAbilityEnvelopeForContract({
      ability: { id: "xhs.note.search.v1", layer: "L3", action: "read" },
      input: {
        query: "  露营  ",
        limit: 8,
        page: 2,
        search_id: "  search-1  ",
        sort: "  general  ",
        note_type: 3
      },
      options: {
        target_domain: "creator.xiaohongshu.com",
        target_tab_id: 7,
        target_page: "search_result",
        requested_execution_mode: "dry_run"
      }
    });

    expect(envelope.ability).toEqual({
      id: "xhs.note.search.v1",
      layer: "L3",
      action: "read"
    });
    expect(parseSearchInputForContract(envelope.input, envelope.ability.id, envelope.options, envelope.ability.action)).toEqual({
      query: "露营",
      limit: 8,
      page: 2,
      search_id: "search-1",
      sort: "general",
      note_type: 3
    });
    expect(normalizeGateOptionsForContract(envelope.options, envelope.ability.id)).toMatchObject({
      targetDomain: "creator.xiaohongshu.com",
      targetTabId: 7,
      targetPage: "search_result",
      requestedExecutionMode: "dry_run"
    });
  });

  it("permits issue_208 editor_input validation without query", () => {
    const envelope = parseAbilityEnvelopeForContract({
      ability: { id: "xhs.editor.input.v1", layer: "L3", action: "write" },
      input: {},
      options: {
        issue_scope: "issue_208",
        action_type: "write",
        requested_execution_mode: "live_write",
        validation_action: "editor_input",
        target_domain: "creator.xiaohongshu.com",
        target_tab_id: 11,
        target_page: "creator_publish_tab"
      }
    });

    expect(parseSearchInputForContract(envelope.input, envelope.ability.id, envelope.options, envelope.ability.action)).toEqual({});
  });

  it("parses xhs.detail input and trims note_id", () => {
    expect(
      parseDetailInputForContract(
        {
          note_id: "  note-001  "
        },
        "xhs.note.detail.v1"
      )
    ).toEqual({
      note_id: "note-001"
    });
  });

  it("parses xhs.user_home input and trims user_id", () => {
    expect(
      parseUserHomeInputForContract(
        {
          user_id: "  user-001  "
        },
        "xhs.user.home.v1"
      )
    ).toEqual({
      user_id: "user-001"
    });
  });

  it("dispatches xhs.detail command input through the shared contract parser", () => {
    expect(
      parseXhsCommandInputForContract({
        command: "xhs.detail",
        abilityId: "xhs.note.detail.v1",
        abilityAction: "read",
        payload: {
          note_id: "  note-001  "
        },
        options: {}
      })
    ).toEqual({
      note_id: "note-001"
    });
  });
});
