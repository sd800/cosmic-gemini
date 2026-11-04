(() => {
  function randomToken() {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(18));
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }
  const key=Symbol.for('cosmic-gemini.url-tracking-cleaner.runtime'),prefix='cosmic-gemini:url-tracking-cleaner:';
  if(globalThis[key]){globalThis[key].announce();return;}
  const helper=globalThis[Symbol.for('cosmic-gemini.url-tracking-cleaner.parameters')],token=randomToken();
  let active=false,disposed=false,options={},openPatch=null;
  const events=['pointerdown','click','auxclick','contextmenu'],completionEvents=['click','auxclick'];
  const onLink=event=>{
    if(!active)return;
    if(event.defaultPrevented||event.type==='pointerdown'&&event.isPrimary===false)return;
    const path=event.composedPath();
    const link=path.find(node=>node instanceof HTMLAnchorElement);
    if(!link||link.hasAttribute('download')||path.some(node=>node instanceof Element&&(node.isContentEditable||node.matches('input,textarea,select,[role="textbox"]'))))return;
    const cleaned=helper.clean(link.href,options);
    if(cleaned)link.setAttribute('href',cleaned);
  };
  function installOpen(){
    const descriptor=Object.getOwnPropertyDescriptor(window,'open');
    if(!descriptor?.writable||typeof descriptor.value!=='function')return;
    const original=descriptor.value;
    const wrapper=function open(...args){
      // A click handler can retain a destination independently of the anchor's href.
      if(active&&openPatch?.wrapper===wrapper&&typeof args[0]==='string'&&args[0].length<=65536&&args[0].includes('?')){
        try{
          const cleaned=helper.clean(new URL(args[0],document.baseURI).href,options);
          if(cleaned)args[0]=cleaned;
        }catch{}
      }
      return Reflect.apply(original,this,args);
    };
    try{Object.defineProperty(window,'open',{...descriptor,value:wrapper});openPatch={descriptor,wrapper};}catch{}
  }
  function restoreOpen(){
    const patch=openPatch;openPatch=null;
    if(patch&&Object.getOwnPropertyDescriptor(window,'open')?.value===patch.wrapper){
      try{Object.defineProperty(window,'open',patch.descriptor);}catch{}
    }
  }
  const stop=()=>{
    active=false;
    for(const name of events)window.removeEventListener(name,onLink,true);
    for(const name of completionEvents)window.removeEventListener(name,onLink,false);
    restoreOpen();
  };
  const announce=()=>{
    if(disposed)return;
    window.addEventListener(prefix+'configure',configure,true);window.addEventListener(prefix+'dispose',dispose,true);window.addEventListener(prefix+'bridge-ready',announce,true);
    if(active){
      for(const name of events)window.addEventListener(name,onLink,{capture:true,passive:true});
      for(const name of completionEvents)window.addEventListener(name,onLink,{passive:true});
    }
    window.dispatchEvent(new CustomEvent(prefix+'main-ready',{detail:token}));
  };
  function configure(event){
    let message;try{message=JSON.parse(event.detail);}catch{return;}
    if(message?.token!==token||disposed)return;
    options={utmParameters:message.config?.utmParameters!==false,bilibiliParameters:message.config?.bilibiliParameters===true};
    const next=message.config?.active===true;
    if(next&&!active){
      active=true;installOpen();
      for(const name of events)window.addEventListener(name,onLink,{capture:true,passive:true});
      // Recheck after page handlers that replace the href during activation.
      for(const name of completionEvents)window.addEventListener(name,onLink,{passive:true});
    }
    else if(!next&&active)stop();
  }
  function dispose(event){
    if(event.detail!==token||disposed)return;disposed=true;stop();
    window.removeEventListener(prefix+'configure',configure,true);window.removeEventListener(prefix+'dispose',dispose,true);window.removeEventListener(prefix+'bridge-ready',announce,true);
    delete globalThis[key];
  }
  window.addEventListener(prefix+'configure',configure,true);window.addEventListener(prefix+'dispose',dispose,true);window.addEventListener(prefix+'bridge-ready',announce,true);
  Object.defineProperty(globalThis,key,{value:{token,announce,onDispose:dispose,get active(){return active}},configurable:true});announce();
})();
