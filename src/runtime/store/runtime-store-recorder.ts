import type { CliError } from "../../core/errors.js";
import type { JsonObject, RuntimeContext } from "../../core/types.js";
import {
  RuntimeStoreError,
  SQLiteRuntimeStore,
  type AppendRunEventInput,
  type UpsertRunInput,
  resolveRuntimeStorePath
} from "./sqlite-runtime-store.js";

const resolveSessionId = (summary: JsonObject): string | null => {
  const directSession = summary.sessionId;
  if (typeof directSession === "string" && directSession.length > 0) {
    return directSession;
  }

  const directSnake = summary.session_id;
  if (typeof directSnake === "string" && directSnake.length > 0) {
    return directSnake;
  }

  const transport = summary.transport;
  if (transport && typeof transport === "object" && !Array.isArray(transport)) {
    const nested = (transport as Record<string, unknown>).session_id;
    if (typeof nested === "string" && nested.length > 0) {
      return nested;
    }
  }

  return null;
};

const toSummaryText = (summary: JsonObject): string => JSON.stringify(summary);

const buildEvent = (
  context: RuntimeContext,
  input: Omit<AppendRunEventInput, "runId" | "eventTime">
): AppendRunEventInput => ({
  runId: context.run_id,
  eventTime: new Date().toISOString(),
  ...input
});

interface RuntimeStoreWriter {
  upsertRun(input: UpsertRunInput): Promise<unknown>;
  appendRunEvent(input: AppendRunEventInput): Promise<unknown>;
  close(): void;
}

export class RuntimeStoreRecorder {
  #store: RuntimeStoreWriter;
  #startedAtByRunId = new Map<string, string>();

  constructor(cwd: string, store?: RuntimeStoreWriter) {
    this.#store = store ?? new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));
  }

  close(): void {
    this.#store.close();
  }

  #ensureStartedAt(runId: string): string {
    const existing = this.#startedAtByRunId.get(runId);
    if (existing) {
      return existing;
    }
    const startedAt = new Date().toISOString();
    this.#startedAtByRunId.set(runId, startedAt);
    return startedAt;
  }

  async recordStart(context: RuntimeContext): Promise<void> {
    await this.#store.upsertRun({
      runId: context.run_id,
      sessionId: null,
      profileName: context.profile ?? "anonymous",
      command: context.command,
      status: "running",
      startedAt: this.#ensureStartedAt(context.run_id),
      endedAt: null,
      errorCode: null
    });
    await this.#store.appendRunEvent(
      buildEvent(context, {
        stage: "boot",
        component: "cli",
        eventType: "started",
        diagnosisCategory: null,
        failurePoint: null,
        summary: "command started"
      })
    );
  }

  async recordSuccess(context: RuntimeContext, summary: JsonObject): Promise<void> {
    try {
      await this.#store.upsertRun({
        runId: context.run_id,
        sessionId: resolveSessionId(summary),
        profileName: context.profile ?? "anonymous",
        command: context.command,
        status: "succeeded",
        startedAt: this.#ensureStartedAt(context.run_id),
        endedAt: new Date().toISOString(),
        errorCode: null
      });
      await this.#store.appendRunEvent(
        buildEvent(context, {
          stage: "command",
          component: "runtime",
          eventType: "succeeded",
          diagnosisCategory: null,
          failurePoint: null,
          summary: toSummaryText(summary)
        })
      );
    } finally {
      this.#startedAtByRunId.delete(context.run_id);
    }
  }

  async recordFailure(context: RuntimeContext, error: CliError): Promise<void> {
    try {
      await this.#store.upsertRun({
        runId: context.run_id,
        sessionId: null,
        profileName: context.profile ?? "anonymous",
        command: context.command,
        status: "failed",
        startedAt: this.#ensureStartedAt(context.run_id),
        endedAt: new Date().toISOString(),
        errorCode: error.code
      });
      await this.#store.appendRunEvent(
        buildEvent(context, {
          stage: "command",
          component: "runtime",
          eventType: "failed",
          diagnosisCategory: "execution_error",
          failurePoint: context.command,
          summary: `${error.code}: ${error.message}`
        })
      );
    } finally {
      this.#startedAtByRunId.delete(context.run_id);
    }
  }
}

export const createRuntimeStoreRecorder = (cwd: string): RuntimeStoreRecorder =>
  process.env.WEBENVOY_RUNTIME_STORE_FORCE_UNAVAILABLE === "1"
    ? (() => {
        throw new RuntimeStoreError(
          "ERR_RUNTIME_STORE_UNAVAILABLE",
          "runtime store unavailable (forced)"
        );
      })()
    : new RuntimeStoreRecorder(cwd);
