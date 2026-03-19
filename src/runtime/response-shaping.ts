import { type Diagnosis, type DiagnosisInput, buildDiagnosis } from "./diagnostics.js";
import {
  type ObservabilityInput,
  type ObservabilityPayload,
  buildObservabilityPayload
} from "./observability.js";

interface BaseErrorShape {
  code: string;
  message: string;
  retryable: boolean;
  [key: string]: unknown;
}

export interface BaseSuccessResponse {
  status: "success";
  [key: string]: unknown;
}

export interface BaseErrorResponse {
  status: "error";
  error: BaseErrorShape;
  [key: string]: unknown;
}

export type ShapedSuccessResponse<T extends BaseSuccessResponse> = T & {
  observability: ObservabilityPayload;
};

export type ShapedErrorResponse<T extends BaseErrorResponse> = Omit<T, "error"> & {
  error: T["error"] & {
    diagnosis: Diagnosis;
  };
  observability: ObservabilityPayload;
};

export const shapeSuccessResponse = <T extends BaseSuccessResponse>(
  base: T,
  observabilityInput: ObservabilityInput
): ShapedSuccessResponse<T> => {
  const observability = buildObservabilityPayload(observabilityInput);
  return {
    ...base,
    observability
  };
};

export const shapeErrorResponse = <T extends BaseErrorResponse>(
  base: T,
  observabilityInput: ObservabilityInput,
  diagnosisInput: DiagnosisInput
): ShapedErrorResponse<T> => {
  const observability = buildObservabilityPayload(observabilityInput);
  const diagnosis = buildDiagnosis({
    ...diagnosisInput,
    failure_site: diagnosisInput.failure_site ?? observability.failure_site
  });

  return {
    ...base,
    error: {
      ...base.error,
      diagnosis
    },
    observability
  };
};
