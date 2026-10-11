// Offscreen processors accept work only from Central, never from a workspace
// or content script. Products must authorize requests before forwarding them.
export function isProcessorSender(sender, runtime) {
  return sender?.id === runtime.id && sender.url === runtime.getURL('background/central.js');
}
