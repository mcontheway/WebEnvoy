import { createInMemoryLoopbackTransport } from "./loopback-runtime.js";
const RELAY_PATH = "host>background>content-script>background>host";
export const createLoopbackNativeBridgeTransport = () => createInMemoryLoopbackTransport(RELAY_PATH);
export const loopbackRelayPath = () => RELAY_PATH;
