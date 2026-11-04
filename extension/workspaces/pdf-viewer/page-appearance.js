// Per-page choices are RAM-only and belong to this open document.
export function createPageAppearance({pages,thumbnails,getDark}) {
  const overrides=new Map();
  const dark=page=>overrides.has(page)?overrides.get(page)==='dark':getDark();
  const paint=(node,page)=>{const value=String(dark(page));if(node.dataset.paperDark!==value)node.dataset.paperDark=value;};
  function apply(){
    for(const node of pages.children)if(node.classList.contains('page'))paint(node,Number(node.dataset.pageNumber));
    for(const node of thumbnails.children)paint(node,Number(node.dataset.page));
  }
  return {dark,apply,get:page=>overrides.get(page)||'auto',set(page,mode){if(!Number.isSafeInteger(page)||page<1||!['auto','light','dark'].includes(mode))return;if(mode==='auto')overrides.delete(page);else overrides.set(page,mode);apply();}};
}
