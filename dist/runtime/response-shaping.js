import { buildDiagnosis } from "./diagnostics.js";
import { buildObservabilityPayload } from "./observability.js";
export const shapeSuccessResponse = (base, observabilityInput) => {
    const observability = buildObservabilityPayload(observabilityInput);
    return {
        ...base,
        observability
    };
};
export const shapeErrorResponse = (base, observabilityInput, diagnosisInput) => {
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
