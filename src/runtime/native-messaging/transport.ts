import type { BridgeRequestEnvelope, BridgeResponseEnvelope } from "./protocol.js";

export type NativeBridgeTransportSurface =
  | "profile_socket"
  | "root_socket"
  | "explicit_socket"
  | "spawned_host"
  | "in_memory_loopback"
  | "unknown";

export interface NativeBridgeTransportProof {
  surface: NativeBridgeTransportSurface;
  socket_path?: string | null;
  spawned_host_configured?: boolean;
}

export interface NativeBridgeTransport {
  open(request: BridgeRequestEnvelope): Promise<BridgeResponseEnvelope>;
  forward(request: BridgeRequestEnvelope): Promise<BridgeResponseEnvelope>;
  heartbeat(request: BridgeRequestEnvelope): Promise<BridgeResponseEnvelope>;
  currentTransportProof?(): NativeBridgeTransportProof;
  close?(): Promise<void> | void;
}
