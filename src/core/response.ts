import type { Writable } from "node:stream";

import type { CliError } from "./errors.js";
import type {
  ErrorResponse,
  JsonObject,
  RuntimeContext,
  SuccessResponse
} from "./types.js";
import type { DiagnosisInput } from "../runtime/diagnostics.js";
import type { ObservabilityInput } from "../runtime/observability.js";
import { shapeErrorResponse, shapeSuccessResponse } from "../runtime/response-shaping.js";

const EMPTY_OBSERVABILITY: ObservabilityInput = {
  page_state: null,
  key_requests: null,
  failure_site: null
};

const isoNow = (): string => new Date().toISOString();

export const buildSuccessResponse = (
  context: RuntimeContext,
  summary: JsonObject,
  options?: {
    observability?: ObservabilityInput;
  }
): SuccessResponse =>
  shapeSuccessResponse(
    {
      run_id: context.run_id,
      command: context.command,
      status: "success",
      summary,
      timestamp: isoNow()
    },
    options?.observability ?? EMPTY_OBSERVABILITY
  );

export const buildErrorResponse = (
  input: { runId: string; command: string },
  error: CliError,
  options?: {
    observability?: ObservabilityInput;
    diagnosis?: DiagnosisInput;
  }
): ErrorResponse =>
  shapeErrorResponse(
    {
      run_id: input.runId,
      command: input.command,
      status: "error",
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable
      },
      timestamp: isoNow()
    },
    options?.observability ?? EMPTY_OBSERVABILITY,
    options?.diagnosis ?? {}
  );

export const writeJsonLine = (stream: Writable, payload: unknown): void => {
  stream.write(`${JSON.stringify(payload)}\n`);
};
