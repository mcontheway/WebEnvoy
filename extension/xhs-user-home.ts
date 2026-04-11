import { executeXhsUserHome as executeXhsUserHomeImpl } from "./xhs-read-execution.js";

export function executeXhsUserHome(...args: Parameters<typeof executeXhsUserHomeImpl>) {
  return executeXhsUserHomeImpl(...args);
}
