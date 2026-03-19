import { describe, expect, it } from "vitest";

import { parseArgv } from "../argv.js";
import { CliError } from "../errors.js";

describe("parseArgv", () => {
  it("parses command and options using the frozen syntax", () => {
    const parsed = parseArgv([
      "runtime.ping",
      "--params",
      '{"hello":"world"}',
      "--profile",
      "default",
      "--run-id",
      "run-20260319-0001"
    ]);

    expect(parsed).toEqual({
      command: "runtime.ping",
      params: { hello: "world" },
      profile: "default",
      runId: "run-20260319-0001"
    });
  });

  it("defaults params to empty object and optional fields to null", () => {
    const parsed = parseArgv(["runtime.help"]);

    expect(parsed).toEqual({
      command: "runtime.help",
      params: {},
      profile: null,
      runId: null
    });
  });

  it("rejects malformed params json", () => {
    expect(() => parseArgv(["runtime.ping", "--params", "not-json"])).toThrowError(
      CliError
    );

    try {
      parseArgv(["runtime.ping", "--params", "not-json"]);
    } catch (error) {
      expect(error).toMatchObject({ code: "ERR_CLI_INVALID_ARGS" });
    }
  });

  it("rejects non-object params", () => {
    expect(() => parseArgv(["runtime.ping", "--params", "[]"])).toThrowError(CliError);
  });

  it("rejects duplicated --params", () => {
    expect(() =>
      parseArgv(["runtime.ping", "--params", "{}", "--params", "{}"])
    ).toThrowError(CliError);
  });

  it("rejects missing command", () => {
    expect(() => parseArgv([])).toThrowError(CliError);
  });

  it("rejects invalid run id format", () => {
    expect(() =>
      parseArgv(["runtime.ping", "--run-id", "bad run id with spaces"])
    ).toThrowError(CliError);
  });
});
