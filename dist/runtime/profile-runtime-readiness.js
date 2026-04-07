export const browserStateFromProfileState = (profileState, lockHeld) => {
    if (!lockHeld) {
        if (profileState === "disconnected") {
            return "disconnected";
        }
        return "absent";
    }
    if (profileState === "starting") {
        return "starting";
    }
    if (profileState === "logging_in") {
        return "logging_in";
    }
    if (profileState === "stopping") {
        return "stopping";
    }
    if (profileState === "disconnected") {
        return "disconnected";
    }
    return "ready";
};
export const buildRuntimeReadiness = (input) => {
    if (input.identityBindingState === "mismatch" || input.identityBindingState === "missing") {
        return "blocked";
    }
    if (!input.lockHeld) {
        return input.transportState === "disconnected" ? "recoverable" : "blocked";
    }
    if (input.identityBindingState === "bound" &&
        input.transportState === "ready" &&
        input.bootstrapState === "ready") {
        return "ready";
    }
    if (input.transportState === "disconnected") {
        return "recoverable";
    }
    if (input.identityBindingState === "bound" &&
        (input.bootstrapState === "pending" || input.bootstrapState === "not_started")) {
        return "pending";
    }
    if (input.bootstrapState === "failed") {
        return "recoverable";
    }
    if (input.bootstrapState === "stale") {
        return "blocked";
    }
    return "unknown";
};
export const mapTransportErrorToReadiness = (error) => {
    const details = {
        code: error.code,
        message: error.message
    };
    if (error.code === "ERR_TRANSPORT_HANDSHAKE_FAILED") {
        return {
            transportState: "not_connected",
            bootstrapState: "not_started",
            runtimeReadiness: "recoverable",
            details
        };
    }
    return {
        transportState: "disconnected",
        bootstrapState: "not_started",
        runtimeReadiness: "recoverable",
        details
    };
};
export const mapBootstrapCliErrorToReadiness = (error, identityBindingState = "bound") => {
    const details = {
        code: error.code,
        message: error.message
    };
    switch (error.code) {
        case "ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED":
            return {
                identityBindingState,
                transportState: "ready",
                bootstrapState: "pending",
                runtimeReadiness: "pending",
                details
            };
        case "ERR_RUNTIME_BOOTSTRAP_ACK_TIMEOUT":
            return {
                identityBindingState,
                transportState: "ready",
                bootstrapState: "pending",
                runtimeReadiness: "recoverable",
                details
            };
        case "ERR_RUNTIME_BOOTSTRAP_ACK_STALE":
            return {
                identityBindingState,
                transportState: "ready",
                bootstrapState: "stale",
                runtimeReadiness: "blocked",
                details
            };
        case "ERR_RUNTIME_BOOTSTRAP_IDENTITY_MISMATCH":
            return {
                identityBindingState: "mismatch",
                transportState: "ready",
                bootstrapState: "failed",
                runtimeReadiness: "blocked",
                details
            };
        case "ERR_RUNTIME_READY_SIGNAL_CONFLICT":
            return {
                identityBindingState,
                transportState: "ready",
                bootstrapState: "failed",
                runtimeReadiness: "unknown",
                details
            };
        default:
            return {
                identityBindingState,
                transportState: "ready",
                bootstrapState: "failed",
                runtimeReadiness: "recoverable",
                details
            };
    }
};
