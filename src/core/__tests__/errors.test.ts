import { describe, expect, it } from "vitest";

import { CliError, exitCodeForError, normalizeExecutionError } from "../errors.js";

describe("errors", () => {
  it("maps frozen error codes to stable exit codes", () => {
    expect(exitCodeForError("ERR_CLI_INVALID_ARGS")).toBe(2);
    expect(exitCodeForError("ERR_CLI_UNKNOWN_COMMAND")).toBe(3);
    expect(exitCodeForError("ERR_CLI_NOT_IMPLEMENTED")).toBe(4);
    expect(exitCodeForError("ERR_RUNTIME_UNAVAILABLE")).toBe(5);
    expect(exitCodeForError("ERR_EXECUTION_FAILED")).toBe(6);
  });

  it("normalizes unknown exceptions to ERR_EXECUTION_FAILED", () => {
    const normalized = normalizeExecutionError(new Error("boom"));
    expect(normalized).toBeInstanceOf(CliError);
    expect(normalized.code).toBe("ERR_EXECUTION_FAILED");
    expect(normalized.retryable).toBe(false);
  });
});
