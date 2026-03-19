export type ErrorCode =
  | "ERR_CLI_INVALID_ARGS"
  | "ERR_CLI_UNKNOWN_COMMAND"
  | "ERR_CLI_NOT_IMPLEMENTED"
  | "ERR_RUNTIME_UNAVAILABLE"
  | "ERR_EXECUTION_FAILED"
  | "ERR_PROFILE_INVALID"
  | "ERR_PROFILE_LOCKED"
  | "ERR_PROFILE_OWNER_CONFLICT"
  | "ERR_PROFILE_META_CORRUPT"
  | "ERR_PROFILE_PROXY_CONFLICT"
  | "ERR_PROFILE_STATE_CONFLICT";

const EXIT_CODE_SUCCESS = 0;

const EXIT_CODE_BY_ERROR: Record<ErrorCode, number> = {
  ERR_CLI_INVALID_ARGS: 2,
  ERR_CLI_UNKNOWN_COMMAND: 3,
  ERR_CLI_NOT_IMPLEMENTED: 4,
  ERR_RUNTIME_UNAVAILABLE: 5,
  ERR_EXECUTION_FAILED: 6,
  ERR_PROFILE_INVALID: 5,
  ERR_PROFILE_LOCKED: 5,
  ERR_PROFILE_OWNER_CONFLICT: 5,
  ERR_PROFILE_META_CORRUPT: 5,
  ERR_PROFILE_PROXY_CONFLICT: 5,
  ERR_PROFILE_STATE_CONFLICT: 5
};

export class CliError extends Error {
  code: ErrorCode;
  retryable: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    options?: { retryable?: boolean; cause?: unknown }
  ) {
    super(message, options);
    this.name = "CliError";
    this.code = code;
    this.retryable = options?.retryable ?? false;
  }
}

export const successExitCode = (): number => EXIT_CODE_SUCCESS;

export const exitCodeForError = (code: ErrorCode): number => EXIT_CODE_BY_ERROR[code];

export const normalizeExecutionError = (error: unknown): CliError => {
  if (error instanceof CliError) {
    return error;
  }

  return new CliError("ERR_EXECUTION_FAILED", "命令执行失败", {
    retryable: false,
    cause: error
  });
};
