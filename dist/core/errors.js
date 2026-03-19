const EXIT_CODE_SUCCESS = 0;
const EXIT_CODE_BY_ERROR = {
    ERR_CLI_INVALID_ARGS: 2,
    ERR_CLI_UNKNOWN_COMMAND: 3,
    ERR_CLI_NOT_IMPLEMENTED: 4,
    ERR_RUNTIME_UNAVAILABLE: 5,
    ERR_EXECUTION_FAILED: 6
};
export class CliError extends Error {
    code;
    retryable;
    constructor(code, message, options) {
        super(message, options);
        this.name = "CliError";
        this.code = code;
        this.retryable = options?.retryable ?? false;
    }
}
export const successExitCode = () => EXIT_CODE_SUCCESS;
export const exitCodeForError = (code) => EXIT_CODE_BY_ERROR[code];
export const normalizeExecutionError = (error) => {
    if (error instanceof CliError) {
        return error;
    }
    return new CliError("ERR_EXECUTION_FAILED", "命令执行失败", {
        retryable: false,
        cause: error
    });
};
