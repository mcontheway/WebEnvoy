import { afterEach, describe, expect, it, vi } from "vitest";

const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
const originalArchDescriptor = Object.getOwnPropertyDescriptor(process, "arch");

const setProcessPlatform = (platform: NodeJS.Platform): void => {
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: platform
  });
};

const setProcessArch = (arch: string): void => {
  Object.defineProperty(process, "arch", {
    configurable: true,
    value: arch
  });
};

const restoreProcessDescriptor = (
  key: "platform" | "arch",
  descriptor: PropertyDescriptor | undefined
): void => {
  if (descriptor) {
    Object.defineProperty(process, key, descriptor);
  }
};

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("node:fs");
  vi.doUnmock("node:os");
  restoreProcessDescriptor("platform", originalPlatformDescriptor);
  restoreProcessDescriptor("arch", originalArchDescriptor);
});

describe("fingerprint-runtime", () => {
  it("uses Linux distribution VERSION_ID instead of kernel release for actual environment", async () => {
    setProcessPlatform("linux");
    setProcessArch("x64");

    const readFileSync = vi.fn((path: string) => {
      if (path === "/etc/os-release") {
        return 'NAME="Ubuntu"\nVERSION_ID="24.04"\n';
      }
      throw new Error(`unexpected path: ${path}`);
    });

    vi.doMock("node:fs", () => ({
      readFileSync
    }));
    vi.doMock("node:os", () => ({
      release: () => "6.8.0-55-generic"
    }));

    const { resolveCurrentFingerprintEnvironment } = await import("../fingerprint-runtime.js");
    expect(resolveCurrentFingerprintEnvironment()).toEqual({
      os_family: "linux",
      os_version: "24.04",
      arch: "x64"
    });
    expect(readFileSync).toHaveBeenCalledWith("/etc/os-release", "utf8");
  });

  it("falls back to unknown when Linux distribution version cannot be read", async () => {
    setProcessPlatform("linux");
    setProcessArch("arm64");

    vi.doMock("node:fs", () => ({
      readFileSync: vi.fn(() => {
        throw new Error("missing os-release");
      })
    }));
    vi.doMock("node:os", () => ({
      release: () => "6.8.0-55-generic"
    }));

    const { resolveCurrentFingerprintEnvironment } = await import("../fingerprint-runtime.js");
    expect(resolveCurrentFingerprintEnvironment()).toEqual({
      os_family: "linux",
      os_version: "unknown",
      arch: "arm64"
    });
  });
});
