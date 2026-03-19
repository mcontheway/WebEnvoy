import { CliError } from "./errors.js";
const COMMAND_PATTERN = /^[a-z][a-z0-9_-]*\.[a-z][a-z0-9_-]*$/;
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const parseParams = (raw) => {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        throw new CliError("ERR_CLI_INVALID_ARGS", "--params 必须是 JSON 对象字符串");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new CliError("ERR_CLI_INVALID_ARGS", "--params 必须是 JSON 对象字符串");
    }
    return parsed;
};
const requireOptionValue = (argv, index, optionName) => {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
        throw new CliError("ERR_CLI_INVALID_ARGS", `${optionName} 缺少参数值`);
    }
    return value;
};
const assertCommand = (command) => {
    if (!COMMAND_PATTERN.test(command)) {
        throw new CliError("ERR_CLI_INVALID_ARGS", "命令格式非法，必须是 runtime.<verb> 或 <platform>.<verb>");
    }
};
export const isValidRunId = (runId) => RUN_ID_PATTERN.test(runId);
export const getCommandHint = (argv) => argv[0] && !argv[0].startsWith("--") ? argv[0] : "runtime.invalid";
export const getRunIdHint = (argv) => {
    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i] === "--run-id") {
            return argv[i + 1] ?? null;
        }
    }
    return null;
};
export const parseArgv = (argv) => {
    if (argv.length === 0) {
        throw new CliError("ERR_CLI_INVALID_ARGS", "<command> 是必填位置参数");
    }
    const command = argv[0];
    if (command.startsWith("--")) {
        throw new CliError("ERR_CLI_INVALID_ARGS", "<command> 必须是第一个位置参数");
    }
    assertCommand(command);
    let params = {};
    let profile = null;
    let runId = null;
    let paramsSeen = false;
    for (let i = 1; i < argv.length; i += 1) {
        const token = argv[i];
        if (!token.startsWith("--")) {
            throw new CliError("ERR_CLI_INVALID_ARGS", `无法识别的位置参数: ${token}`);
        }
        if (token === "--params") {
            if (paramsSeen) {
                throw new CliError("ERR_CLI_INVALID_ARGS", "--params 不允许重复");
            }
            const value = requireOptionValue(argv, i, "--params");
            params = parseParams(value);
            paramsSeen = true;
            i += 1;
            continue;
        }
        if (token === "--profile") {
            if (profile !== null) {
                throw new CliError("ERR_CLI_INVALID_ARGS", "--profile 不允许重复");
            }
            profile = requireOptionValue(argv, i, "--profile");
            i += 1;
            continue;
        }
        if (token === "--run-id") {
            if (runId !== null) {
                throw new CliError("ERR_CLI_INVALID_ARGS", "--run-id 不允许重复");
            }
            const value = requireOptionValue(argv, i, "--run-id");
            if (!isValidRunId(value)) {
                throw new CliError("ERR_CLI_INVALID_ARGS", "--run-id 格式非法");
            }
            runId = value;
            i += 1;
            continue;
        }
        throw new CliError("ERR_CLI_INVALID_ARGS", `未知参数: ${token}`);
    }
    return {
        command,
        params,
        profile,
        runId
    };
};
