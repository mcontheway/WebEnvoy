type RuntimePingRequest = {
  command: "runtime.ping";
  command_params?: Record<string, unknown>;
};

export const handleRuntimePing = (_request: RuntimePingRequest) => ({
  message: "pong"
});
