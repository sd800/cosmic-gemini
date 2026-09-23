export const DOCUMENT_APPEARANCES = Object.freeze(['auto', 'light', 'dark']);
export const normalizeDocumentAppearance = value => DOCUMENT_APPEARANCES.includes(value) ? value : 'auto';

// A single PDF control switches to the opposite appearance, then restores the
// configured default (including Auto) without changing the shared site schema.
export function toggleDocumentAppearance(defaultTheme, siteTheme, systemDark) {
  const isDark = value => value === 'dark' || (value === 'auto' && systemDark);
  const base = normalizeDocumentAppearance(defaultTheme);
  const dark = isDark(siteTheme || base);
  return dark !== isDark(base) ? null : dark ? 'light' : 'dark';
}
