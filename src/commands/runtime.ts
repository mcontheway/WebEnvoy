import { CliError } from "../core/errors.js";
import type { CommandDefinition, RuntimeContext } from "../core/types.js";
import { ProfileRuntimeService } from "../runtime/profile-runtime.js";

const asBoolean = (value: unknown): boolean => value === true;
const profileRuntime = new ProfileRuntimeService();

const runtimePing = async (context: RuntimeContext) => {
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

const runtimeStart = async (context: RuntimeContext) =>
  profileRuntime.start({
    cwd: context.cwd,
    profile: context.profile ?? "",
    runId: context.run_id,
    params: context.params
  });

const runtimeLogin = async (context: RuntimeContext) =>
  profileRuntime.login({
    cwd: context.cwd,
    profile: context.profile ?? "",
    runId: context.run_id,
    params: context.params
  });

const runtimeStatus = async (context: RuntimeContext) =>
  profileRuntime.status({
    cwd: context.cwd,
    profile: context.profile ?? "",
    runId: context.run_id,
    params: context.params
  });

const runtimeStop = async (context: RuntimeContext) =>
  profileRuntime.stop({
    cwd: context.cwd,
    profile: context.profile ?? "",
    runId: context.run_id,
    params: context.params
  });

const runtimeHelp = async () => ({
  usage: "webenvoy <command> [--params '<json>'] [--profile <profile>] [--run-id <run_id>]",
  commands: [
    "runtime.help",
    "runtime.ping",
    "runtime.start",
    "runtime.login",
    "runtime.status",
    "runtime.stop",
    "xhs.search"
  ],
  notes: ["--params 必须是 JSON 对象字符串", "stdout 只输出单个 JSON 对象"]
});

export const runtimeCommands = (): CommandDefinition[] => [
  {
    name: "runtime.help",
    status: "implemented",
    handler: runtimeHelp
  },
  {
    name: "runtime.ping",
    status: "implemented",
    handler: runtimePing
  },
  {
    name: "runtime.start",
    status: "implemented",
    requiresProfile: true,
    handler: runtimeStart
  },
  {
    name: "runtime.login",
    status: "implemented",
    requiresProfile: true,
    handler: runtimeLogin
  },
  {
    name: "runtime.status",
    status: "implemented",
    requiresProfile: true,
    handler: runtimeStatus
  },
  {
    name: "runtime.stop",
    status: "implemented",
    requiresProfile: true,
    handler: runtimeStop
  }
];
