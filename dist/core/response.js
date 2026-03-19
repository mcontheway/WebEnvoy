import { shapeErrorResponse, shapeSuccessResponse } from "../runtime/response-shaping.js";
const EMPTY_OBSERVABILITY = {
    page_state: null,
    key_requests: null,
    failure_site: null
};
const isoNow = () => new Date().toISOString();
export const buildSuccessResponse = (context, summary, options) => shapeSuccessResponse({
    run_id: context.run_id,
    command: context.command,
    status: "success",
    summary,
    timestamp: isoNow()
}, options?.observability ?? EMPTY_OBSERVABILITY);
export const buildErrorResponse = (input, error, options) => shapeErrorResponse({
    run_id: input.runId,
    command: input.command,
    status: "error",
    error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable
    },
    timestamp: isoNow()
}, options?.observability ?? EMPTY_OBSERVABILITY, options?.diagnosis ?? {});
export const writeJsonLine = (stream, payload) => {
    stream.write(`${JSON.stringify(payload)}\n`);
};
