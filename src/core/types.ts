import type { ErrorCode } from "./errors.js";
import type { Diagnosis } from "../runtime/diagnostics.js";
import type { DiagnosisInput } from "../runtime/diagnostics.js";
import type { ObservabilityInput } from "../runtime/observability.js";
import type { ObservabilityPayload } from "../runtime/observability.js";

export type JsonObject = Record<string, unknown>;

export interface CapabilityErrorDetails extends JsonObject {
  ability_id: string;
  stage: "input_validation" | "execution" | "output_mapping";
  reason: string;
}

export interface ParsedCliInput {
  command: string;
  params: JsonObject;
  profile: string | null;
  runId: string | null;
}

export interface RuntimeContext {
  run_id: string;
  command: string;
  profile: string | null;
  params: JsonObject;
  cwd: string;
}

export interface CommandExecutionResult {
  summary: JsonObject;
  observability?: ObservabilityInput;
}

export interface CommandExecutionFailure {
  diagnosis?: DiagnosisInput;
  observability?: ObservabilityInput;
}

export interface SuccessResponse {
  run_id: string;
  command: string;
  status: "success";
  summary: JsonObject;
  observability: ObservabilityPayload;
  timestamp: string;
}

export interface ErrorResponse {
  run_id: string;
  command: string;
  status: "error";
  error: {
    code: ErrorCode;
    message: string;
    retryable: boolean;
    diagnosis: Diagnosis;
    details?: CapabilityErrorDetails;
  };
  observability: ObservabilityPayload;
  timestamp: string;
}

export interface CommandDefinition {
  name: string;
  status: "implemented" | "not_implemented";
  requiresProfile?: boolean;
  handler?: (context: RuntimeContext) => Promise<JsonObject | CommandExecutionResult>;
}
