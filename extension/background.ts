type BridgeRequest = {
  id: string;
  method: "bridge.open" | "bridge.forward" | "__ping__";
  params: Record<string, unknown>;
};

let nativePort: chrome.runtime.Port | null = null;

export const ensureNativeConnection = (): chrome.runtime.Port => {
  if (!nativePort) {
    nativePort = chrome.runtime.connectNative("com.webenvoy.host");
  }

  return nativePort;
};

export const relayToNativeHost = (request: BridgeRequest): void => {
  const port = ensureNativeConnection();
  port.postMessage(request);
};
