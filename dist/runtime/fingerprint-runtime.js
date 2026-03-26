import { readFileSync } from "node:fs";
import { release } from "node:os";
import { buildFingerprintRuntimeContext, normalizeArch, normalizePlatform } from "../../shared/fingerprint-profile.js";
const LINUX_OS_RELEASE_PATHS = ["/etc/os-release", "/usr/lib/os-release"];
let cachedLinuxDistributionVersion;
const parseOsReleaseValue = (value) => {
    const trimmed = value.trim();
    if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.slice(1, -1).trim();
    }
    return trimmed;
};
const resolveLinuxDistributionVersion = () => {
    if (cachedLinuxDistributionVersion !== undefined) {
        return cachedLinuxDistributionVersion;
    }
    for (const filePath of LINUX_OS_RELEASE_PATHS) {
        try {
            const raw = readFileSync(filePath, "utf8");
            for (const line of raw.split(/\r?\n/u)) {
                const normalized = line.trim();
                if (normalized.length === 0 || normalized.startsWith("#")) {
                    continue;
                }
                const delimiterIndex = normalized.indexOf("=");
                if (delimiterIndex <= 0) {
                    continue;
                }
                const key = normalized.slice(0, delimiterIndex).trim();
                if (key !== "VERSION_ID") {
                    continue;
                }
                const value = parseOsReleaseValue(normalized.slice(delimiterIndex + 1));
                if (value.length > 0) {
                    cachedLinuxDistributionVersion = value;
                    return cachedLinuxDistributionVersion;
                }
            }
        }
        catch {
            continue;
        }
    }
    cachedLinuxDistributionVersion = null;
    return cachedLinuxDistributionVersion;
};
const resolveCurrentOsVersion = (osFamily) => {
    if (osFamily === "linux") {
        return resolveLinuxDistributionVersion() ?? "unknown";
    }
    return release();
};
const resolveTimezone = () => {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    }
    catch {
        return "UTC";
    }
};
export const resolveCurrentFingerprintEnvironment = () => {
    const osFamily = normalizePlatform(process.platform);
    return {
        os_family: osFamily,
        os_version: resolveCurrentOsVersion(osFamily),
        arch: normalizeArch(process.arch)
    };
};
export const buildFingerprintContextForMeta = (profile, meta, options) => buildFingerprintRuntimeContext({
    profile,
    metaPresent: meta !== null,
    fingerprintSeeds: meta?.fingerprintSeeds ?? null,
    existingBundle: meta?.fingerprintProfileBundle ?? null,
    actualEnvironment: resolveCurrentFingerprintEnvironment(),
    requestedExecutionMode: options?.requestedExecutionMode ?? null,
    timezone: resolveTimezone()
});
export const appendFingerprintContext = (params, fingerprintContext) => ({
    ...params,
    fingerprint_context: fingerprintContext
});
