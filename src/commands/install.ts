import { CliError } from "../core/errors.js";
import type { CommandDefinition, RuntimeContext } from "../core/types.js";
import {
  DEFAULT_BROWSER_CHANNEL,
  DEFAULT_NATIVE_HOST_NAME,
  isBrowserChannel,
  isValidExtensionId,
  isValidNativeHostName,
  installNativeHost,
  uninstallNativeHost
} from "../install/native-host.js";

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const invalidInstallInput = (command: "runtime.install" | "runtime.uninstall", reason: string): CliError =>
  new CliError("ERR_CLI_INVALID_ARGS", "安装命令参数不合法", {
    details: {
      ability_id: command,
      stage: "input_validation",
      reason
    }
  });

const resolveNativeHostName = (
  command: "runtime.install" | "runtime.uninstall",
  value: unknown
): string => {
  const nativeHostName = asString(value) ?? DEFAULT_NATIVE_HOST_NAME;
  if (!isValidNativeHostName(nativeHostName)) {
    throw invalidInstallInput(command, "NATIVE_HOST_NAME_INVALID");
  }
  return nativeHostName;
};

const resolveBrowserChannel = (
  command: "runtime.install" | "runtime.uninstall",
  value: unknown
) => {
  const browserChannel = asString(value) ?? DEFAULT_BROWSER_CHANNEL;
  if (!isBrowserChannel(browserChannel)) {
    throw invalidInstallInput(command, "BROWSER_CHANNEL_INVALID");
  }
  return browserChannel;
};

const runtimeInstall = async (context: RuntimeContext) => {
  const extensionId = asString(context.params.extension_id);
  if (!extensionId || !isValidExtensionId(extensionId)) {
    throw invalidInstallInput("runtime.install", "EXTENSION_ID_INVALID");
  }

  const nativeHostName = resolveNativeHostName("runtime.install", context.params.native_host_name);
  const browserChannel = resolveBrowserChannel("runtime.install", context.params.browser_channel);
  const manifestDir = asString(context.params.manifest_dir) ?? undefined;
  const launcherPath = asString(context.params.launcher_path) ?? undefined;
  const hostCommand = asString(context.params.host_command) ?? undefined;

  return installNativeHost({
    cwd: context.cwd,
    extensionId,
    nativeHostName,
    browserChannel,
    hostCommand,
    manifestDir,
    launcherPath
  });
};

const runtimeUninstall = async (context: RuntimeContext) => {
  const nativeHostName = resolveNativeHostName("runtime.uninstall", context.params.native_host_name);
  const browserChannel = resolveBrowserChannel("runtime.uninstall", context.params.browser_channel);
  const manifestDir = asString(context.params.manifest_dir) ?? undefined;
  const launcherPath = asString(context.params.launcher_path) ?? undefined;

  return uninstallNativeHost({
    cwd: context.cwd,
    nativeHostName,
    browserChannel,
    manifestDir,
    launcherPath
  });
};

export const installCommands = (): CommandDefinition[] => [
  {
    name: "runtime.install",
    status: "implemented",
    handler: runtimeInstall
  },
  {
    name: "runtime.uninstall",
    status: "implemented",
    handler: runtimeUninstall
  }
];
