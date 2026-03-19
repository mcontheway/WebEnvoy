export type ProxyBindingSource = "runtime.start" | "runtime.login";

export interface ProxyBinding {
  url: string | null;
  boundAt: string;
  source: ProxyBindingSource;
}

export interface ResolveProxyBindingInput {
  current: ProxyBinding | null;
  requested: string | null | undefined;
  nowIso: string;
  source: ProxyBindingSource;
}

export interface ResolveProxyBindingResult {
  binding: ProxyBinding | null;
  changed: boolean;
  conflict: boolean;
}

const normalizeRequestedProxy = (requested: string | null | undefined): string | null | undefined => {
  if (requested === undefined) {
    return undefined;
  }

  if (requested === null) {
    return null;
  }

  const trimmed = requested.trim();
  if (trimmed.length === 0) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid proxy URL: ${requested}`);
  }

  if (!["http:", "https:", "socks5:"].includes(parsed.protocol)) {
    throw new Error(`Unsupported proxy protocol: ${parsed.protocol}`);
  }

  return parsed.toString();
};

export const resolveProxyBinding = (
  input: ResolveProxyBindingInput
): ResolveProxyBindingResult => {
  const normalized = normalizeRequestedProxy(input.requested);

  if (input.current === null) {
    if (normalized === undefined) {
      return {
        binding: null,
        changed: false,
        conflict: false
      };
    }

    return {
      binding: {
        url: normalized,
        boundAt: input.nowIso,
        source: input.source
      },
      changed: true,
      conflict: false
    };
  }

  if (normalized === undefined) {
    return {
      binding: input.current,
      changed: false,
      conflict: false
    };
  }

  if (normalized === null && input.current.url !== null) {
    return {
      binding: input.current,
      changed: false,
      conflict: true
    };
  }

  if (input.current.url === normalized) {
    return {
      binding: input.current,
      changed: false,
      conflict: false
    };
  }

  return {
    binding: input.current,
    changed: false,
    conflict: true
  };
};
