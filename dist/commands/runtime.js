import { CliError } from "../core/errors.js";
const asBoolean = (value) => value === true;
const runtimePing = async (context) => {
    if (asBoolean(context.params.simulate_runtime_unavailable)) {
        throw new CliError("ERR_RUNTIME_UNAVAILABLE", "运行时不可用", { retryable: true });
    }
    if (asBoolean(context.params.force_fail)) {
        throw new Error("forced execution failure");
    }
    return {
        message: "ok"
    };
};
const runtimeHelp = async () => ({
    usage: "webenvoy <command> [--params '<json>'] [--profile <profile>] [--run-id <run_id>]",
    commands: ["runtime.help", "runtime.ping", "xhs.search"],
    notes: ["--params 必须是 JSON 对象字符串", "stdout 只输出单个 JSON 对象"]
});
export const runtimeCommands = () => [
    {
        name: "runtime.help",
        status: "implemented",
        handler: runtimeHelp
    },
    {
        name: "runtime.ping",
        status: "implemented",
        handler: runtimePing
    }
];
