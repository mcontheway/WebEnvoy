import { CliError } from "../core/errors.js";
import { NativeMessagingBridge, NativeMessagingTransportError } from "../runtime/native-messaging/bridge.js";
const asBoolean = (value) => value === true;
const bridge = new NativeMessagingBridge();
const runtimePing = async (context) => {
    if (asBoolean(context.params.simulate_runtime_unavailable)) {
        throw new CliError("ERR_RUNTIME_UNAVAILABLE", "运行时不可用", { retryable: true });
    }
    if (asBoolean(context.params.force_fail)) {
        throw new Error("forced execution failure");
    }
    try {
        return await bridge.runtimePing({
            runId: context.run_id,
            profile: context.profile,
            cwd: context.cwd,
            params: context.params
        });
    }
    catch (error) {
        if (error instanceof NativeMessagingTransportError) {
            throw new CliError("ERR_RUNTIME_UNAVAILABLE", `通信链路不可用: ${error.code}`, {
                retryable: error.retryable,
                cause: error
            });
        }
        throw error;
    }
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
