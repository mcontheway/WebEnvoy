import type { ErrorCode } from "./errors.js";

export type JsonObject = Record<string, unknown>;

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

export interface SuccessResponse {
  run_id: string;
  command: string;
  status: "success";
  summary: JsonObject;
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
  };
  timestamp: string;
}

export interface CommandDefinition {
  name: string;
  status: "implemented" | "not_implemented";
  requiresProfile?: boolean;
  handler?: (context: RuntimeContext) => Promise<JsonObject>;
}
