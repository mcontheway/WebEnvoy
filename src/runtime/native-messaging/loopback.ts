import type { NativeBridgeTransport } from "./transport.js";
import { createInMemoryLoopbackTransport } from "./loopback-runtime.js";

const RELAY_PATH = "host>background>content-script>background>host";

export const createLoopbackNativeBridgeTransport = (): NativeBridgeTransport =>
  createInMemoryLoopbackTransport(RELAY_PATH);

export const loopbackRelayPath = (): string => RELAY_PATH;
