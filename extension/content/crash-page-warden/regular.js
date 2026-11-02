if (chrome.extension.inIncognitoContext === false) {
  void globalThis[Symbol.for('cosmic-gemini.crash-page-warden.bridge')]?.activate();
}
