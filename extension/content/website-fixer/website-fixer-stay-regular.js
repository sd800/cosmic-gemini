// Only this registration's browser context may activate the shared implementation.
if (chrome.extension.inIncognitoContext === false) globalThis[Symbol.for('cosmic-gemini.website-fixer.stay-activate')]?.();
