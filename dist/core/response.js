const isoNow = () => new Date().toISOString();
export const buildSuccessResponse = (context, summary) => ({
    run_id: context.run_id,
    command: context.command,
    status: "success",
    summary,
    timestamp: isoNow()
});
export const buildErrorResponse = (input, error) => ({
    run_id: input.runId,
    command: input.command,
    status: "error",
    error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable
    },
    timestamp: isoNow()
});
export const writeJsonLine = (stream, payload) => {
    stream.write(`${JSON.stringify(payload)}\n`);
};
