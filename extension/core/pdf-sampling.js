// One immutable sampling choice per PDF reader; no live settings subscription.
export const PDF_SAMPLING_VALUES = Object.freeze([1, 2, 3, 4, 5, 6]);
export const normalizePdfSampling = value => PDF_SAMPLING_VALUES.includes(value) ? value : 4;
