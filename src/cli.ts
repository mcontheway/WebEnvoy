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
import type { RuntimeContext } from "./core/types.js";
import { executeCommand } from "./core/router.js";
import type { DiagnosisInput } from "./runtime/diagnostics.js";
import type { ObservabilityInput } from "./runtime/observability.js";
import { diagnosisFromCliError } from "./runtime/cli-diagnosis.js";
import { createRuntimeStoreRecorder } from "./runtime/store/runtime-store-recorder.js";
import { RuntimeStoreError } from "./runtime/store/sqlite-runtime-store.js";

const DEFAULT_OBSERVABILITY: ObservabilityInput = {
  page_state: null,
  key_requests: null,
  failure_site: null
};

const isRuntimeStoreError = (error: unknown): error is RuntimeStoreError =>
  error instanceof RuntimeStoreError;

const toRuntimeStoreCliError = (error: RuntimeStoreError): CliError =>
  new CliError("ERR_RUNTIME_UNAVAILABLE", `运行记录存储失败: ${error.code}`, {
    retryable: error.code !== "ERR_RUNTIME_STORE_SCHEMA_MISMATCH",
    cause: error
  });

const normalizeCliError = (error: unknown): CliError => {
  if (error instanceof CliError) {
    return error;
  }
  if (isRuntimeStoreError(error)) {
    return toRuntimeStoreCliError(error);
  }
  return normalizeExecutionError(error);
};

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
  let recorder: ReturnType<typeof createRuntimeStoreRecorder> | null = null;

  try {
    const parsed = parseArgv(argv);
    const context = buildRuntimeContext(parsed, cwd);
    runtimeContext = context;
    recorder = createRuntimeStoreRecorder(cwd);
    await recorder.recordStart(context);
    const execution = await executeCommand(context, createCommandRegistry());
    await recorder.recordSuccess(context, execution.summary);

    writeJsonLine(
      stdout,
      buildSuccessResponse(context, execution.summary, {
        observability: execution.observability ?? DEFAULT_OBSERVABILITY
      })
    );
    if (context.command === "runtime.help") {
      stderr.write("Use --params to pass structured JSON object parameters.\n");
    }
    return successExitCode();
  } catch (error) {
    let finalError: unknown = error;
    if (runtimeContext && recorder && !isRuntimeStoreError(error)) {
      try {
        await recorder.recordFailure(runtimeContext, normalizeCliError(error));
      } catch (recordError) {
        finalError = recordError;
      }
    }
    const cliError = normalizeCliError(finalError);
    const runId =
      runtimeContext?.run_id ??
      (runIdHint && isValidRunId(runIdHint) ? runIdHint : generateRunId());
    const command = runtimeContext?.command ?? commandHint;
    writeJsonLine(
      stdout,
      buildErrorResponse(
        { runId, command },
        cliError,
        {
          observability: cliError.observability ?? DEFAULT_OBSERVABILITY,
          diagnosis: cliError.diagnosis ?? diagnosisFromCliError(cliError)
        }
      )
    );

    if (cliError.code === "ERR_CLI_INVALID_ARGS") {
      stderr.write(`${cliError.message}\n`);
    }
    return exitCodeForError(cliError.code);
  } finally {
    try {
      recorder?.close();
    } catch {
      // Close errors are non-blocking for CLI contract.
    }
  }
};

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
