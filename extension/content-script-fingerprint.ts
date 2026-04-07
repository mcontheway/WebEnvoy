import {
  ensureFingerprintRuntimeContext,
  type FingerprintRuntimeContext
} from "../shared/fingerprint-profile.js";
import {
  installFingerprintRuntimeViaMainWorld,
  verifyFingerprintRuntimeViaMainWorld
} from "./content-script-main-world.js";

export interface FingerprintCarrierMessage {
  fingerprintContext?: unknown;
  commandParams: Record<string, unknown>;
}

const AUDIO_PATCH_EPSILON = 1e-12;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const cloneFingerprintRuntimeContextWithInjection = (
  runtime: FingerprintRuntimeContext,
  injection: Record<string, unknown> | null
): FingerprintRuntimeContext =>
  injection
    ? ({
        ...runtime,
        injection: JSON.parse(JSON.stringify(injection))
      } as FingerprintRuntimeContext)
    : { ...runtime };

const resolveAttestedFingerprintRuntimeContext = (
  value: unknown
): FingerprintRuntimeContext | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const injection = asRecord(record.injection);
  const direct = ensureFingerprintRuntimeContext(record);
  if (direct) {
    return cloneFingerprintRuntimeContextWithInjection(direct, injection);
  }

  const sanitized = { ...record };
  delete sanitized.injection;
  const normalized = ensureFingerprintRuntimeContext(sanitized);
  return normalized ? cloneFingerprintRuntimeContextWithInjection(normalized, injection) : null;
};

const resolveFingerprintContextFromCommandParams = (
  commandParams: Record<string, unknown>
): unknown =>
  asRecord(commandParams.fingerprint_context) ?? asRecord(commandParams.fingerprint_runtime) ?? null;

export const resolveFingerprintContextFromMessage = (
  message: FingerprintCarrierMessage
): FingerprintRuntimeContext | null => {
  const direct = resolveAttestedFingerprintRuntimeContext(message.fingerprintContext ?? null);
  if (direct) {
    return direct;
  }

  const fallback = resolveAttestedFingerprintRuntimeContext(
    resolveFingerprintContextFromCommandParams(message.commandParams)
  );
  return fallback ?? null;
};

const resolveRequiredFingerprintPatches = (
  fingerprintRuntime: Record<string, unknown> | FingerprintRuntimeContext
): string[] =>
  asStringArray(asRecord(fingerprintRuntime.fingerprint_patch_manifest)?.required_patches);

export const buildFailedFingerprintInjectionContext = (
  fingerprintRuntime: FingerprintRuntimeContext,
  errorMessage: string
): Record<string, unknown> => {
  const requiredPatches = resolveRequiredFingerprintPatches(fingerprintRuntime);
  return {
    ...fingerprintRuntime,
    injection: {
      installed: false,
      required_patches: requiredPatches,
      missing_required_patches: requiredPatches,
      error: errorMessage
    }
  };
};

export const hasInstalledFingerprintInjection = (
  fingerprintRuntime: FingerprintRuntimeContext
): boolean => {
  const existingInjection = asRecord(
    (fingerprintRuntime as unknown as Record<string, unknown>).injection
  );
  return (
    existingInjection?.installed === true &&
    asStringArray(existingInjection.missing_required_patches).length === 0
  );
};

export const resolveMissingRequiredFingerprintPatches = (
  fingerprintRuntime: Record<string, unknown>
): string[] => {
  const injection = asRecord(fingerprintRuntime.injection);
  const requiredPatches = asStringArray(injection?.required_patches);
  const missingRequiredPatches = asStringArray(injection?.missing_required_patches);
  if (missingRequiredPatches.length > 0) {
    return missingRequiredPatches;
  }
  if (injection?.installed === true) {
    return [];
  }
  return requiredPatches;
};

export const summarizeFingerprintRuntimeContext = (
  fingerprintRuntime: Record<string, unknown> | FingerprintRuntimeContext | null
): Record<string, unknown> | null => {
  if (!fingerprintRuntime) {
    return null;
  }
  const record = fingerprintRuntime as Record<string, unknown>;
  const execution = asRecord(record.execution);
  const injection = asRecord(record.injection);
  return {
    profile: asString(record.profile),
    source: asString(record.source),
    execution: execution
      ? {
          live_allowed: execution.live_allowed === true,
          live_decision: asString(execution.live_decision),
          allowed_execution_modes: asStringArray(execution.allowed_execution_modes),
          reason_codes: asStringArray(execution.reason_codes)
        }
      : null,
    injection: injection
      ? {
          installed: injection.installed === true,
          source: asString(injection.source),
          required_patches: asStringArray(injection.required_patches),
          missing_required_patches: asStringArray(injection.missing_required_patches),
          error: asString(injection.error)
        }
      : null
  };
};

export const resolveFingerprintContextForContract = (
  message: Pick<FingerprintCarrierMessage, "fingerprintContext" | "commandParams">
): FingerprintRuntimeContext | null =>
  resolveFingerprintContextFromMessage({
    commandParams: message.commandParams,
    fingerprintContext: message.fingerprintContext
  });

const probeAudioFirstSample = async (): Promise<number | null> => {
  const offlineAudioCtor =
    typeof window.OfflineAudioContext === "function"
      ? window.OfflineAudioContext
      : typeof (window as Window & { webkitOfflineAudioContext?: typeof OfflineAudioContext })
            .webkitOfflineAudioContext === "function"
        ? (window as Window & { webkitOfflineAudioContext?: typeof OfflineAudioContext })
            .webkitOfflineAudioContext ?? null
        : null;
  if (!offlineAudioCtor) {
    return null;
  }

  try {
    const offlineAudioContext = new offlineAudioCtor(1, 256, 44_100);
    const renderedBuffer = await offlineAudioContext.startRendering();
    if (!renderedBuffer || typeof renderedBuffer.getChannelData !== "function") {
      return null;
    }
    const channelData = renderedBuffer.getChannelData(0);
    if (!channelData || typeof channelData.length !== "number" || channelData.length < 1) {
      return null;
    }
    const firstSample = Number(channelData[0]);
    return Number.isFinite(firstSample) ? firstSample : null;
  } catch {
    return null;
  }
};

const probeBatteryApi = async (): Promise<boolean> => {
  const getBattery = (window.navigator as Navigator & { getBattery?: () => Promise<unknown> })
    .getBattery;
  if (typeof getBattery !== "function") {
    return false;
  }
  try {
    const battery = asRecord(await getBattery());
    return typeof battery?.level === "number" && typeof battery?.charging === "boolean";
  } catch {
    return false;
  }
};

const probeNavigatorPlugins = (): boolean => {
  const plugins = (window.navigator as Navigator & { plugins?: unknown }).plugins;
  return (
    typeof plugins === "object" &&
    plugins !== null &&
    typeof (plugins as { length?: unknown }).length === "number" &&
    Number((plugins as { length?: unknown }).length) > 0
  );
};

const probeNavigatorMimeTypes = (): boolean => {
  const mimeTypes = (window.navigator as Navigator & { mimeTypes?: unknown }).mimeTypes;
  return (
    typeof mimeTypes === "object" &&
    mimeTypes !== null &&
    typeof (mimeTypes as { length?: unknown }).length === "number" &&
    Number((mimeTypes as { length?: unknown }).length) > 0
  );
};

const verifyFingerprintInstallResult = async (input: {
  fingerprintRuntime: FingerprintRuntimeContext;
  installResult: Record<string, unknown> | null;
  preInstallAudioSample: number | null;
}): Promise<Record<string, unknown>> => {
  const requiredPatches = resolveRequiredFingerprintPatches(input.fingerprintRuntime);
  const reportedAppliedPatches = asStringArray(input.installResult?.applied_patches);
  const mainWorldVerification =
    requiredPatches.includes("battery")
      ? asRecord(await verifyFingerprintRuntimeViaMainWorld().catch(() => null))
      : null;
  const appliedPatches: string[] = [];
  const missingRequiredPatches: string[] = [];
  const probeDetails: Record<string, unknown> = {};

  if (requiredPatches.includes("audio_context")) {
    const postInstallAudioSample = await probeAudioFirstSample();
    const audioPatched =
      postInstallAudioSample !== null &&
      (input.preInstallAudioSample === null ||
        Math.abs(postInstallAudioSample - input.preInstallAudioSample) > AUDIO_PATCH_EPSILON ||
        reportedAppliedPatches.includes("audio_context"));
    probeDetails.audio_context = {
      pre_install_first_sample: input.preInstallAudioSample,
      post_install_first_sample: postInstallAudioSample,
      verified: audioPatched
    };
    if (audioPatched) {
      appliedPatches.push("audio_context");
    } else {
      missingRequiredPatches.push("audio_context");
    }
  }

  if (requiredPatches.includes("battery")) {
    const isolatedWorldBatteryPatched = await probeBatteryApi();
    const mainWorldBatteryPatched = mainWorldVerification?.has_get_battery === true;
    const batteryPatched = isolatedWorldBatteryPatched || mainWorldBatteryPatched;
    probeDetails.battery = {
      verified: batteryPatched,
      isolated_world_verified: isolatedWorldBatteryPatched,
      main_world_verified: mainWorldBatteryPatched,
      reported_applied: reportedAppliedPatches.includes("battery")
    };
    if (batteryPatched) {
      appliedPatches.push("battery");
    } else {
      missingRequiredPatches.push("battery");
    }
  }

  if (requiredPatches.includes("navigator_plugins")) {
    const pluginsPatched = probeNavigatorPlugins();
    probeDetails.navigator_plugins = { verified: pluginsPatched };
    if (pluginsPatched) {
      appliedPatches.push("navigator_plugins");
    } else {
      missingRequiredPatches.push("navigator_plugins");
    }
  }

  if (requiredPatches.includes("navigator_mime_types")) {
    const mimeTypesPatched = probeNavigatorMimeTypes();
    probeDetails.navigator_mime_types = { verified: mimeTypesPatched };
    if (mimeTypesPatched) {
      appliedPatches.push("navigator_mime_types");
    } else {
      missingRequiredPatches.push("navigator_mime_types");
    }
  }

  for (const patchName of requiredPatches) {
    if (!appliedPatches.includes(patchName) && !missingRequiredPatches.includes(patchName)) {
      missingRequiredPatches.push(patchName);
    }
  }

  return {
    ...(input.installResult ?? {}),
    installed: missingRequiredPatches.length === 0,
    required_patches: requiredPatches,
    applied_patches: appliedPatches,
    missing_required_patches: missingRequiredPatches,
    verification: {
      channel: "isolated_world_probes",
      probes: probeDetails
    }
  };
};

export const installFingerprintRuntimeWithVerification = async (
  fingerprintRuntime: FingerprintRuntimeContext
): Promise<Record<string, unknown>> => {
  const requiredPatches = resolveRequiredFingerprintPatches(fingerprintRuntime);
  const preInstallAudioSample = requiredPatches.includes("audio_context")
    ? await probeAudioFirstSample()
    : null;
  const installResult = await installFingerprintRuntimeViaMainWorld(
    fingerprintRuntime as unknown as Record<string, unknown>
  );
  return await verifyFingerprintInstallResult({
    fingerprintRuntime,
    installResult: asRecord(installResult),
    preInstallAudioSample
  });
};
