// One immutable sampling choice per PDF reader; no live settings subscription.
export const PDF_SAMPLING_VALUES = Object.freeze([2, 4, 6]);
export const normalizePdfSampling = value => PDF_SAMPLING_VALUES.includes(value) ? value : 4;
