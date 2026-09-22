export const DOCUMENT_APPEARANCES = Object.freeze(['auto', 'light', 'dark']);
export const normalizeDocumentAppearance = value => DOCUMENT_APPEARANCES.includes(value) ? value : 'auto';
