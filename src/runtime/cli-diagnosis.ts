import { CliError } from "../core/errors.js";
import type { DiagnosisInput } from "./diagnostics.js";

const EXECUTION_INTERRUPTED_HINT =
  /(interrupt(?:ed|ion)?|abort(?:ed)?|disconnect(?:ed)?|closed?|terminate(?:d)?|timeout|timed out|cancel(?:ed|led)?|econnreset|eof|broken pipe|中断|断开|超时)/iu;

const collectErrorEvidence = (error: CliError): string[] => {
  const evidence = [error.message.trim()];
  const cause = error.cause;
  if (cause instanceof Error) {
    if (cause.message.trim().length > 0) {
      evidence.push(cause.message.trim());
    }
  } else if (typeof cause === "string" && cause.trim().length > 0) {
    evidence.push(cause.trim());
  }

  return evidence.filter((item, index, list) => item.length > 0 && list.indexOf(item) === index);
};

const looksExecutionInterrupted = (error: CliError): boolean => {
  if (error.code !== "ERR_EXECUTION_FAILED") {
    return false;
  }

  const candidates: string[] = [error.message];
  const cause = error.cause;
  if (cause instanceof Error) {
    candidates.push(cause.name, cause.message);
  } else if (typeof cause === "string") {
    candidates.push(cause);
  }

  return candidates.some((item) => EXECUTION_INTERRUPTED_HINT.test(item));
};

export const diagnosisFromCliError = (error: CliError): DiagnosisInput => {
  const evidence = collectErrorEvidence(error);
  if (error.code === "ERR_RUNTIME_UNAVAILABLE") {
    return {
      category: "runtime_unavailable",
      stage: "runtime",
      component: "cli",
      signals: {
        runtime_unavailable: true
      },
      failure_site: {
        stage: "runtime",
        component: "cli",
        target: "native-messaging",
        summary: error.message
      },
      evidence
    };
  }

  if (looksExecutionInterrupted(error)) {
    return {
      category: "execution_interrupted",
      stage: "transport",
      component: "bridge",
      signals: {
        execution_interrupted: true
      },
      failure_site: {
        stage: "transport",
        component: "bridge",
        target: "runtime-channel",
        summary: error.message
      },
      evidence
    };
  }

  if (error.code === "ERR_EXECUTION_FAILED") {
    return {
      category: "unknown",
      stage: "execution",
      component: "runtime",
      evidence
    };
  }

  return {
    category: "unknown",
    stage: "cli",
    component: "cli",
    evidence
  };
};
