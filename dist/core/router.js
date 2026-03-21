import { CliError, normalizeExecutionError } from "./errors.js";
const isCommandExecutionResult = (value) => "summary" in value && typeof value.summary === "object" && value.summary !== null;
export const executeCommand = async (context, registry) => {
    const command = registry.get(context.command);
    if (!command) {
        throw new CliError("ERR_CLI_UNKNOWN_COMMAND", "未知命令");
    }
    if (command.requiresProfile && !context.profile) {
        throw new CliError("ERR_CLI_INVALID_ARGS", `命令 ${context.command} 需要 --profile`);
    }
    if (command.status === "not_implemented" || !command.handler) {
        throw new CliError("ERR_CLI_NOT_IMPLEMENTED", "命令已注册但当前版本尚未实现");
    }
    try {
        const result = await command.handler(context);
        if (isCommandExecutionResult(result)) {
            return result;
        }
        return {
            summary: result
        };
    }
    catch (error) {
        throw normalizeExecutionError(error);
    }
};
