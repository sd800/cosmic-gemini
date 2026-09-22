// Replacing a notice cancels its timer, so an older success message cannot
// later erase a loading, failure or expired-document state.
export function createDocumentStatus(element, progress) {
  let timer;
  const clear = () => { clearTimeout(timer); timer = undefined; };
  const show = (message, temporary = false, busy = false) => {
    clear(); element.textContent = message;
    if (progress) progress.hidden = !busy;
    if (temporary && message) timer = setTimeout(() => {
      timer = undefined; element.textContent = '';
    }, 15000);
  };
  return {
    show,
    loading: message => show(message, false, true),
    clear
  };
}
