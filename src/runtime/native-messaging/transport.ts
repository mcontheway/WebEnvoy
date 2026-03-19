import type { BridgeRequestEnvelope, BridgeResponseEnvelope } from "./protocol.js";

export interface NativeBridgeTransport {
  open(request: BridgeRequestEnvelope): Promise<BridgeResponseEnvelope>;
  forward(request: BridgeRequestEnvelope): Promise<BridgeResponseEnvelope>;
  heartbeat(request: BridgeRequestEnvelope): Promise<BridgeResponseEnvelope>;
}
