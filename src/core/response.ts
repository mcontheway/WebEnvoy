import type { Writable } from "node:stream";

import type { CliError } from "./errors.js";
import type {
  ErrorResponse,
  JsonObject,
  RuntimeContext,
  SuccessResponse
} from "./types.js";

const isoNow = (): string => new Date().toISOString();

export const buildSuccessResponse = (
  context: RuntimeContext,
  summary: JsonObject
): SuccessResponse => ({
  run_id: context.run_id,
  command: context.command,
  status: "success",
  summary,
  timestamp: isoNow()
});

export const buildErrorResponse = (
  input: { runId: string; command: string },
  error: CliError
): ErrorResponse => ({
  run_id: input.runId,
  command: input.command,
  status: "error",
  error: {
    code: error.code,
    message: error.message,
    retryable: error.retryable
  },
  timestamp: isoNow()
});

export const writeJsonLine = (stream: Writable, payload: unknown): void => {
  stream.write(`${JSON.stringify(payload)}\n`);
};
