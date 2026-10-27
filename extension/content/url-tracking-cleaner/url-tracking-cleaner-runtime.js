(() => {
  const key=Symbol.for('cosmic-gemini.url-tracking-cleaner.runtime'),prefix='cosmic-gemini:url-tracking-cleaner:';
  if(globalThis[key]){globalThis[key].announce();return;}
  const helper=globalThis[Symbol.for('cosmic-gemini.url-tracking-cleaner.parameters')],token=crypto.randomUUID();
  let active=false,options={};
  const events=['pointerdown','click','auxclick','contextmenu'];
  const onLink=event=>{
    if(event.defaultPrevented||event.type==='pointerdown'&&event.isPrimary===false)return;
    const path=event.composedPath();
    const link=path.find(node=>node instanceof HTMLAnchorElement);
    if(!link||link.hasAttribute('download')||path.some(node=>node instanceof Element&&(node.isContentEditable||node.matches('input,textarea,select,[role="textbox"]'))))return;
    const cleaned=helper.clean(link.href,options);
    if(cleaned)link.setAttribute('href',cleaned);
  };
  const stop=()=>{active=false;for(const name of events)window.removeEventListener(name,onLink,true);};
  const announce=()=>window.dispatchEvent(new CustomEvent(prefix+'main-ready',{detail:token}));
  function configure(event){
    let message;try{message=JSON.parse(event.detail);}catch{return;}
    if(message?.token!==token)return;
    options={utmParameters:message.config?.utmParameters!==false,bilibiliParameters:message.config?.bilibiliParameters===true};
    const next=message.config?.active===true;
    if(next&&!active){active=true;for(const name of events)window.addEventListener(name,onLink,{capture:true,passive:true});}
    else if(!next&&active)stop();
  }
  function dispose(event){
    if(event.detail!==token)return;stop();
    window.removeEventListener(prefix+'configure',configure,true);window.removeEventListener(prefix+'dispose',dispose,true);window.removeEventListener(prefix+'bridge-ready',announce,true);
    delete globalThis[key];
  }
  window.addEventListener(prefix+'configure',configure,true);window.addEventListener(prefix+'dispose',dispose,true);window.addEventListener(prefix+'bridge-ready',announce,true);
  Object.defineProperty(globalThis,key,{value:{token,announce,get active(){return active}},configurable:true});announce();
})();
