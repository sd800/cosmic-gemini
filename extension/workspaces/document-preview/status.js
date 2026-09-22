// Replacing a notice cancels its timer, so an older success message cannot
// later erase a loading, failure or expired-document state.
export function createDocumentStatus(element) {
  let timer;
  const clear = () => { clearTimeout(timer); timer = undefined; };
  return {
    show(message, temporary = false) {
      clear(); element.textContent = message;
      if (temporary && message) timer = setTimeout(() => {
        timer = undefined; element.textContent = '';
      }, 15000);
    },
    clear
  };
}
