export type ExtensionAbilityAction = "read" | "write" | "download";

type JsonRecord = Record<string, unknown>;

export class ExtensionContractError extends Error {
  code: string;
  details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ExtensionContractError";
    this.code = code;
    this.details = details;
  }
}

export type ExtensionXhsCommandInput =
  | {
      query: string;
      limit?: number;
      page?: number;
      search_id?: string;
      sort?: string;
      note_type?: string | number;
    }
  | {
      note_id: string;
    }
  | {
      user_id: string;
    }
  | JsonRecord;

const invalidAbilityInput = (
  reason: string,
  abilityId = "unknown"
): ExtensionContractError =>
  new ExtensionContractError("ERR_CLI_INVALID_ARGS", "能力输入不合法", {
    ability_id: abilityId,
    stage: "input_validation",
    reason
  });

const asNonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const parseSearchInput = (
  payload: JsonRecord,
  abilityId: string,
  options: JsonRecord,
  abilityAction: ExtensionAbilityAction
): ExtensionXhsCommandInput => {
  const issue208EditorInputValidation =
    abilityAction === "write" &&
    options.issue_scope === "issue_208" &&
    options.action_type === "write" &&
    options.requested_execution_mode === "live_write" &&
    options.validation_action === "editor_input";
  if (issue208EditorInputValidation) {
    return {};
  }

  const query = asNonEmptyString(payload.query);
  if (!query) {
    throw invalidAbilityInput("QUERY_MISSING", abilityId);
  }

  const normalized: JsonRecord = {
    query
  };
  if (typeof payload.limit === "number" && Number.isFinite(payload.limit)) {
    normalized.limit = Math.max(1, Math.floor(payload.limit));
  }
  if (typeof payload.page === "number" && Number.isFinite(payload.page)) {
    normalized.page = Math.max(1, Math.floor(payload.page));
  }
  if (asNonEmptyString(payload.search_id)) {
    normalized.search_id = asNonEmptyString(payload.search_id);
  }
  if (asNonEmptyString(payload.sort)) {
    normalized.sort = asNonEmptyString(payload.sort);
  }
  if (
    (typeof payload.note_type === "string" && payload.note_type.trim().length > 0) ||
    typeof payload.note_type === "number"
  ) {
    normalized.note_type = payload.note_type;
  }
  return normalized;
};

export const validateXhsCommandInputForExtension = (input: {
  command: string;
  abilityId: string;
  abilityAction: ExtensionAbilityAction;
  payload: JsonRecord;
  options: JsonRecord;
}): ExtensionXhsCommandInput => {
  if (input.command === "xhs.search") {
    return parseSearchInput(input.payload, input.abilityId, input.options, input.abilityAction);
  }
  if (input.command === "xhs.detail") {
    const noteId = asNonEmptyString(input.payload.note_id);
    if (!noteId) {
      throw invalidAbilityInput("NOTE_ID_MISSING", input.abilityId);
    }
    return { note_id: noteId };
  }
  if (input.command === "xhs.user_home") {
    const userId = asNonEmptyString(input.payload.user_id);
    if (!userId) {
      throw invalidAbilityInput("USER_ID_MISSING", input.abilityId);
    }
    return { user_id: userId };
  }
  throw invalidAbilityInput("ABILITY_COMMAND_UNSUPPORTED", input.abilityId);
};
