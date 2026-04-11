import { executeXhsDetail as executeXhsDetailImpl } from "./xhs-read-execution.js";

export function executeXhsDetail(...args: Parameters<typeof executeXhsDetailImpl>) {
  return executeXhsDetailImpl(...args);
}
