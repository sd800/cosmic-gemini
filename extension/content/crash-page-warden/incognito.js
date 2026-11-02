if (chrome.extension.inIncognitoContext === true) {
  void globalThis[Symbol.for('cosmic-gemini.crash-page-warden.bridge')]?.activate();
}
