import type { Writable } from "node:stream";

import { createCommandRegistry } from "./commands/index.js";
import { getCommandHint, getRunIdHint, isValidRunId, parseArgv } from "./core/argv.js";
import { buildRuntimeContext, generateRunId } from "./core/context.js";
import {
  CliError,
  exitCodeForError,
  normalizeExecutionError,
  successExitCode
} from "./core/errors.js";
import { buildErrorResponse, buildSuccessResponse, writeJsonLine } from "./core/response.js";
import { executeCommand } from "./core/router.js";
import type { RuntimeContext } from "./core/types.js";
import { createRuntimeStoreRecorder } from "./runtime/store/runtime-store-recorder.js";

const normalizeCliError = (error: unknown): CliError =>
  error instanceof CliError ? error : normalizeExecutionError(error);

export const runCli = async (
  argv: string[],
  options?: {
    cwd?: string;
    stdout?: Writable;
    stderr?: Writable;
  }
): Promise<number> => {
  const cwd = options?.cwd ?? process.cwd();
  const stdout = options?.stdout ?? process.stdout;
  const stderr = options?.stderr ?? process.stderr;
  const commandHint = getCommandHint(argv);
  const runIdHint = getRunIdHint(argv);
  let runtimeContext: RuntimeContext | null = null;
  let recorder = createRuntimeStoreRecorder(cwd);

  try {
    const parsed = parseArgv(argv);
    const context = buildRuntimeContext(parsed, cwd);
    runtimeContext = context;
    await recorder?.recordStart(context);
    const summary = await executeCommand(context, createCommandRegistry());
    await recorder?.recordSuccess(context, summary);

    writeJsonLine(stdout, buildSuccessResponse(context, summary));
    if (context.command === "runtime.help") {
      stderr.write("Use --params to pass structured JSON object parameters.\n");
    }
    recorder?.close();
    return successExitCode();
  } catch (error) {
    const cliError = normalizeCliError(error);
    if (runtimeContext) {
      await recorder?.recordFailure(runtimeContext, cliError);
    }
    const runId =
      runtimeContext?.run_id ??
      (runIdHint && isValidRunId(runIdHint) ? runIdHint : generateRunId());
    const command = runtimeContext?.command ?? commandHint;
    writeJsonLine(stdout, buildErrorResponse({ runId, command }, cliError));

    if (cliError.code === "ERR_CLI_INVALID_ARGS") {
      stderr.write(`${cliError.message}\n`);
    }
    recorder?.close();
    return exitCodeForError(cliError.code);
  }
};

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
