(() => {
  const NAME = 'zhihu-image-adjustment', KEY = Symbol.for(`cosmic-gemini.${NAME}.runtime`);
  const EVENT = suffix => `cosmic-gemini:${NAME}:${suffix}`;
  if (globalThis[KEY]) { globalThis[KEY].announce(); return; }
  const classifier = globalThis[Symbol.for('cosmic-gemini.image-reading-surface')];
  const token = crypto.randomUUID();
  const BODY = '.RichText.ztext, .RichContent-inner, .Post-RichTextContainer';
  const IMAGE = 'figure img, img.zh-lightbox-thumb';
  const IGNORE = '.LinkCard, .VideoCard, .Avatar, .CommentItem, .ztext-math, [data-tex], .RichText-video';
  const TEXT = {
    'en-US': {auto:'Auto',dark:'Dark',light:'Light',original:'Original',hide:'Hide',restore:'Restore image',
      toLight:'Show light image',toDark:'Show dark image',menu:'Image display · Right-click for options'},
    'zh-CN': {auto:'自动',dark:'深色',light:'浅色',original:'原图',hide:'隐藏',restore:'恢复图片',
      toLight:'切换为浅色图片',toDark:'切换为深色图片',menu:'图片显示 · 右键打开菜单'}
  };
  const ICONS = {
    light:'<circle cx="12" cy="12" r="3.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6 19 19M5 19l1.4-1.4M17.6 6.4 19 5"/>',
    dark:'<path d="M20.2 15.4A8.5 8.5 0 0 1 8.6 3.8 8.5 8.5 0 1 0 20.2 15.4Z"/>',
    off:'<rect x="3" y="7" width="18" height="10" rx="5"/><circle cx="8" cy="12" r="2.5" fill="currentColor" stroke="none"/>'
  };
  const controls = new WeakMap();
  const records = new Map(), results = new Map(), choices = new Map(), pending = new Map(), loads = new Set();
  let config = {}, enabled = false, dark = false, revision = 0, raf = 0, busy = 0, disposed = false;
  let observer, themeObserver, intersection, menuRecord = null, clicked = null, dismissClick = null;
  const owned = (element, name, value = '') => { if (element.getAttribute(name) !== value) element.setAttribute(name, value); };
  const limit = map => { while (map.size > 160) map.delete(map.keys().next().value); };
  const supported = () => location.hostname === 'zhihu.com' || location.hostname.endsWith('.zhihu.com');
  function imageKey(image) {
    const source = image.getAttribute('data-original') || image.currentSrc || image.src || '';
    try { const url = new URL(source, location.href); return url.pathname.match(/v2-[a-f0-9]+/i)?.[0] || url.href; } catch { return ''; }
  }
  const sourceOf = image => [image.getAttribute('src'), image.getAttribute('srcset'), image.currentSrc].join('\n');
  function actualDark() {
    const root = document.documentElement, drScheme = root.getAttribute('data-darkreader-scheme');
    if (drScheme === 'dark') return true;
    if (drScheme === 'light') return false;
    for (const surface of [document.body, root]) {
      if (!surface) continue;
      const color = getComputedStyle(surface).backgroundColor.match(/[\d.]+/g)?.map(Number);
      if (color?.length >= 3 && (color[3] ?? 1) > .8)
        return .2126 * color[0] + .7152 * color[1] + .0722 * color[2] < 100;
    }
    const theme = root.getAttribute('data-theme') || root.getAttribute('theme') || '';
    if (/dark/i.test(theme) || root.classList.contains('dark')) return true;
    if (/light/i.test(theme)) return false;
    return !!document.querySelector('meta[name="darkreader"], style.darkreader--dynamic:not([disabled])');
  }
  const processingDark = () => config.darkImages && (config.matchPageTheme === false || dark);
  function bodyOf(image) { return image.closest(BODY); }
  function isContentImage(image) {
    return image instanceof HTMLImageElement && !!bodyOf(image) && !!image.closest('figure, .zh-lightbox-thumb')
      && !image.closest(IGNORE) && !image.matches('.ee_img, .ztext-math, [data-tex]');
  }
  function expanded(image) {
    return !image.closest('.RichContent.is-collapsed, .RichContent--collapsed, [aria-expanded="false"], [data-collapsed="true"]');
  }
  function protectedImage(image) {
    // Preserve the site's own confirmation/blur; never read its alternate original URL.
    const filter = getComputedStyle(image).filter;
    if (/blur\(/i.test(filter) || /blur\(/i.test(image.style.filter)) return true;
    const portal = image.closest('.RichText-ConditionalImagePortal');
    if (!portal) return false;
    return [...portal.querySelectorAll('button,[role="button"],[class*="Mask"],[class*="mask"]')].some(node => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(node).display !== 'none';
    });
  }
  function inView(image) {
    const rect = image.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > -250 && rect.top < innerHeight + 500;
  }
  function addRecord(image, viewer = false) {
    const key = imageKey(image), source = sourceOf(image);
    let record = records.get(image);
    if (record && (record.source !== source || record.key !== key)) { removeRecord(record); record = null; }
    if (record) {
      const figure = viewer ? null : image.closest('figure');
      if (record.viewer !== viewer || record.figure !== figure) {
        removeControl(record); record.figure?.removeAttribute('data-cg-zhihu-figure');
        record.figure = figure; record.viewer = viewer;
      }
      if (figure) owned(figure, 'data-cg-zhihu-figure');
      image.toggleAttribute('data-cg-zhihu-viewer', viewer);
      return record;
    }
    if (!key || records.size >= 600) return null;
    record = { image, key, source, viewer, result: results.get(key) || results.get(source), host: null,
      figure: viewer ? null : image.closest('figure'), guarded: false };
    records.set(image, record);
    owned(image, 'data-cg-zhihu-image');
    if (viewer) owned(image, 'data-cg-zhihu-viewer');
    if (record.figure) owned(record.figure, 'data-cg-zhihu-figure');
    record.load = () => {
      if (!enabled || !image.isConnected) return;
      const current = addRecord(image, record.viewer);
      if (current) { paint(current); enqueue(current); }
      schedule();
    }; image.addEventListener('load', record.load);
    intersection.observe(image);
    return record;
  }
  function discover() {
    for (const body of document.querySelectorAll(BODY)) for (const img of body.querySelectorAll(IMAGE)) {
      if (isContentImage(img)) addRecord(img);
    }
    // Current Zhihu uses a body-level animated image instead of a named dialog.
    // Admit it only when it matches a body image the user explicitly opened.
    if (clicked && performance.now() - clicked.time < 15000) for (const img of document.querySelectorAll('body > img, .ImageView img, .ImageViewer img, .Lightbox img')) {
      if (imageKey(img) !== clicked.key || isContentImage(img)) continue;
      const record = addRecord(img, true);
      const previous = img.previousElementSibling;
      if (record && previous?.tagName === 'DIV' && !previous.children.length && getComputedStyle(previous).position === 'fixed') {
        record.backdrop = previous;
      }
    }
  }
  function effect(record) {
    const choice = choices.get(record.key) || 'auto';
    if (choice === 'hide') return processingDark() ? 'hide-dark' : 'hide-light';
    if (choice === 'original' || choice === 'light') return 'original';
    if (!config.darkImages) return '';
    if (choice === 'dark') return record.result?.kind === 'gray-theme' ? 'gray' : 'invert';
    if (!processingDark()) return '';
    return record.result?.kind === 'gray-theme' ? 'gray' : record.result?.kind === 'light-theme' ? 'invert' : '';
  }
  function paint(record) {
    const image = record.image;
    // Recheck protection on every site-driven update, before applying choices.
    const guarded = protectedImage(image);
    record.guarded = guarded;
    if (guarded) { releaseHold(record); image.removeAttribute('data-cg-zhihu-effect'); removeControl(record); return; }
    if (record.result || !processingDark() || choices.has(record.key)) releaseHold(record);
    else if (!record.holdDone && image.complete && image.naturalWidth && !document.hidden && inView(image)) {
      record.holdDone = true;
      owned(image, 'data-cg-zhihu-pending');
      record.holdTimer = setTimeout(() => releaseHold(record), 900);
    }
    const value = effect(record);
    if (value) {
      owned(image, 'data-cg-zhihu-effect', value);
      if (!record.ignore) { record.ignore = [image.getAttribute('data-darkreader-ignore')]; owned(image, 'data-darkreader-ignore'); }
    } else {
      image.removeAttribute('data-cg-zhihu-effect'); restoreIgnore(record);
    }
    if (record.backdrop) {
      if (processingDark()) owned(record.backdrop, 'data-cg-zhihu-backdrop');
      else record.backdrop.removeAttribute('data-cg-zhihu-backdrop');
    }
    if (record.viewer || expanded(image)) control(record); else removeControl(record);
    if (record.host) {
      const choice = choices.get(record.key) || 'auto', text = TEXT[config.locale] || TEXT['en-US'];
      const off = choice === 'hide' || choice === 'original';
      const icon = off || !config.darkImages ? 'off' : ['invert','gray'].includes(value) ? 'light' : 'dark';
      if (record.icon !== icon) { record.icon = icon; record.button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[icon]}</svg>`; }
      const title = (off ? text.restore : !config.darkImages ? text.hide : icon === 'light' ? text.toLight : text.toDark) + ' · ' + text.menu;
      owned(record.button, 'title', title); owned(record.button, 'aria-label', title);
    }
  }
  function setChoice(record, choice) {
    if (!enabled || record.guarded || records.get(record.image) !== record || !record.image.isConnected) return;
    choices.delete(record.key); choices.set(record.key, choice); limit(choices);
    closeMenu(); for (const other of records.values()) if (other.key === record.key) paint(other);
  }
  function control(record) {
    if (record.host || !record.viewer && !record.figure) return;
    const host = document.createElement('cg-zhihu-image-control');
    host.setAttribute('data-cg-zhihu-control', '');
    host.setAttribute('translate', 'no'); host.setAttribute('data-darkreader-ignore', '');
    const shadow = host.attachShadow({mode:'closed'});
    const style = document.createElement('style');
    style.textContent = `:host{all:initial;position:absolute;right:8px;top:8px;z-index:4;color-scheme:light dark;font:14px/1.4 system-ui;pointer-events:auto;--surface:#fafafa;--text:#27292d;--border:#c4c7cc}:host([data-dark]){--surface:#25272b;--text:#e8e6e3;--border:#55585e}:host([data-viewer]){position:fixed;right:18px;top:18px;z-index:2147483646}button{font:inherit;color:var(--text);cursor:pointer}button.toggle{position:relative;width:29px;height:29px;display:grid;place-items:center;padding:5px;border:1px solid var(--border);border-radius:50%;background:var(--surface);opacity:.5}button.toggle:hover,button.toggle:focus-visible{opacity:1}button.toggle:before{content:'';position:absolute;inset:-8px}svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.menu{position:absolute;top:36px;right:0;min-width:120px;padding:5px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:10px;box-shadow:0 6px 22px #0004}.menu[hidden]{display:none}.menu button{display:block;width:100%;border:0;background:none;padding:7px 12px;text-align:left;border-radius:6px;white-space:nowrap}.menu button:hover,.menu button:focus-visible{background:#8882}.menu button[aria-checked=true]{font-weight:600}`;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'toggle';
    button.setAttribute('aria-haspopup','menu'); button.setAttribute('aria-expanded','false');
    const menu = document.createElement('div'); menu.className = 'menu'; menu.setAttribute('role','menu'); menu.hidden = true;
    shadow.append(style, button, menu);
    for (const type of ['pointerdown','pointerup','mousedown','mouseup','dblclick']) host.addEventListener(type,e=>e.stopPropagation());
    button.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      if (e.button > 0 || e.ctrlKey) return;
      const choice = choices.get(record.key);
      setChoice(record, choice === 'hide' || choice === 'original' ? 'auto' : !config.darkImages ? 'hide' : ['invert','gray'].includes(effect(record)) ? 'light' : 'dark');
    });
    button.addEventListener('keydown',e=>{if(e.key==='ArrowDown'){e.preventDefault();e.stopPropagation();openMenu(record);record.menu.firstElementChild?.focus();}});
    host.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); openMenu(record); });
    menu.addEventListener('click',e=>e.stopPropagation());
    Object.assign(record,{host,button,menu}); controls.set(host,record);
    (record.viewer ? document.body : record.figure).append(host);
    host.toggleAttribute('data-viewer',record.viewer);
    host.toggleAttribute('data-dark',dark);
  }
  function openMenu(record) {
    if (!enabled || record.guarded || !record.host?.isConnected || records.get(record.image) !== record) return;
    closeMenu(); const text = TEXT[config.locale] || TEXT['en-US'];
    const modes = config.darkImages ? ['hide','auto','dark','light','original'] : ['hide','auto','original'];
    record.menu.replaceChildren();
    for (const mode of modes) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = text[mode];
      button.setAttribute('role','menuitemradio'); button.setAttribute('aria-checked',String((choices.get(record.key)||'auto') === mode));
      button.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();setChoice(record,mode);record.button?.focus({preventScroll:true});});
      record.menu.append(button);
    }
    menuRecord = record; record.menu.hidden = false; record.button.setAttribute('aria-expanded','true');
    // No automatic focused/selected first row; native context menus must not leak through.
  }
  function closeMenu() {
    if (!menuRecord) return;
    menuRecord.menu.hidden = true; menuRecord.button.setAttribute('aria-expanded','false'); menuRecord = null;
  }
  function removeControl(record) {
    if (menuRecord === record) closeMenu();
    if(record.host)controls.delete(record.host);
    record.host?.remove(); record.host = record.button = record.menu = null; record.icon = null;
  }
  function restoreIgnore(record) {
    if (!record.ignore) return;
    if (record.image.getAttribute('data-darkreader-ignore') === '') {
      if (record.ignore[0] === null) record.image.removeAttribute('data-darkreader-ignore');
      else record.image.setAttribute('data-darkreader-ignore', record.ignore[0]);
    }
    record.ignore = null;
  }
  function releaseHold(record) {
    clearTimeout(record.holdTimer); record.holdTimer = 0;
    record.image.removeAttribute('data-cg-zhihu-pending');
  }
  function removeRecord(record) {
    releaseHold(record);
    pending.delete(record.image); intersection?.unobserve(record.image);
    record.image.removeEventListener('load',record.load);
    for (const attr of ['data-cg-zhihu-image','data-cg-zhihu-effect','data-cg-zhihu-viewer']) record.image.removeAttribute(attr);
    record.figure?.removeAttribute('data-cg-zhihu-figure'); record.backdrop?.removeAttribute('data-cg-zhihu-backdrop');
    restoreIgnore(record); removeControl(record); records.delete(record.image);
  }
  function readSample(image) {
    const ratio = Math.min(1,Math.sqrt(1024/(image.naturalWidth*image.naturalHeight)));
    const width = Math.min(1024,Math.max(1,Math.floor(image.naturalWidth*ratio))), height = Math.min(Math.floor(1024/width),Math.max(1,Math.floor(image.naturalHeight*ratio)));
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    try {
      const context = canvas.getContext('2d',{willReadFrequently:true}); context.drawImage(image,0,0,width,height);
      return classifier.classify(context.getImageData(0,0,width,height).data,width,height);
    } catch { return null; } finally { canvas.width = canvas.height = 0; }
  }
  function corsCopy(image) {
    // Retry only the already displayed resource on Zhihu's image CDN, never data-original.
    let url; try { url = new URL(image.currentSrc || image.src); } catch { return Promise.resolve(null); }
    if (!['https:','http:'].includes(url.protocol) || !(url.hostname === 'zhimg.com' || url.hostname.endsWith('.zhimg.com'))) return Promise.resolve(null);
    return new Promise(resolve => {
      const copy = new Image(); let done = false;
      const finish = value => { if(done)return;done=true;clearTimeout(timer);copy.onload=copy.onerror=null;loads.delete(cancel);resolve(value); };
      const cancel = () => {finish(null);copy.removeAttribute('src');};
      const timer = setTimeout(cancel,4000); loads.add(cancel);
      copy.crossOrigin='anonymous';copy.referrerPolicy=image.referrerPolicy||'strict-origin-when-cross-origin';
      copy.onload=()=>finish(copy.naturalWidth?copy:null);copy.onerror=()=>finish(null);copy.src=url.href;
    });
  }
  function enqueue(record) {
    if (!processingDark() || record.analyzing || record.result || record.guarded || !record.image.complete || !record.image.naturalWidth || !inView(record.image)) return;
    pending.set(record.image,record); pump();
  }
  function pump() {
    if (!enabled || document.hidden || busy >= 2 || !pending.size) return;
    const [image,record] = pending.entries().next().value; pending.delete(image);
    if (!image.isConnected || records.get(image)!==record || record.guarded) { pump(); return; }
    const ticket = revision; busy++; record.analyzing = true;
    (async()=>{
      let result=readSample(image);
      if(!result){const copy=await corsCopy(image);if(copy)result=readSample(copy);}
      if(!enabled||ticket!==revision||records.get(image)!==record||record.source!==sourceOf(image)||protectedImage(image))return;
      record.result=result||{kind:'photo'};
      const cacheKey=record.result.kind==='photo'?record.source:record.key;
      results.set(cacheKey,record.result);limit(results);
      paint(record);
      // A verified result may be reused by another representation of this same image.
      if(record.result.kind!=='photo')for(const other of records.values())if(other.key===record.key){other.result=record.result;paint(other);}
    })().finally(()=>{busy--;record.analyzing=false;pump();if(enabled&&ticket!==revision)schedule();});
  }
  function refresh() {
    raf=0;if(!enabled)return;
    dark=actualDark();document.documentElement.toggleAttribute('data-cg-zhihu-small',!!config.smallImages);
    discover();
    for(const record of records.values()) {
      if(!record.image.isConnected||!record.viewer&&!isContentImage(record.image)||record.source!==sourceOf(record.image)) {removeRecord(record);continue;}
      paint(record);record.host?.toggleAttribute('data-dark',dark);enqueue(record);
    }
  }
  function schedule() { if(enabled&&!raf)raf=requestAnimationFrame(refresh); }
  function onPointer(event) {
    if(menuRecord&&!event.composedPath().includes(menuRecord.host)) {
      closeMenu(); dismissClick={target:event.target,until:performance.now()+600};
      event.preventDefault();event.stopImmediatePropagation();return;
    }
    dismissClick=null;
    const image=event.target instanceof HTMLImageElement?event.target:null;
    if(image&&isContentImage(image)&&!protectedImage(image))clicked={key:imageKey(image),time:performance.now()};
  }
  function onContextMenu(event) {
    // Claim only our own shadow host, before the site's document/React capture.
    // The button's transparent hit margin remains part of that same target.
    const host = event.composedPath().find(node => controls.has(node));
    const record = host && controls.get(host);
    if (!record) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (menuRecord !== record) openMenu(record);
  }
  function onKey(event) {
    if (!menuRecord) return;
    if(event.key==='Escape'||event.key==='Tab') {
      const button=menuRecord.button;closeMenu();
      if(event.key==='Escape'){button?.focus({preventScroll:true});event.preventDefault();event.stopImmediatePropagation();}
      return;
    }
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
      const buttons=[...menuRecord.menu.children],current=buttons.indexOf(menuRecord.menu.getRootNode().activeElement);
      const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:current<0
        ?event.key==='ArrowDown'?0:buttons.length-1:(current+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;
      buttons[next]?.focus();event.preventDefault();event.stopImmediatePropagation();
    }
  }
  function stop() {
    enabled=false;revision++;if(raf)cancelAnimationFrame(raf);raf=0;
    observer?.disconnect();themeObserver?.disconnect();intersection?.disconnect();
    for(const cancel of loads)cancel();pending.clear();
    for(const record of [...records.values()])removeRecord(record);
    closeMenu();document.documentElement.removeAttribute('data-cg-zhihu-small');
    document.removeEventListener('pointerdown',onPointer,true);document.removeEventListener('click',onClick,true);
    window.removeEventListener('contextmenu',onContextMenu,true);
    window.removeEventListener('keydown',onKey,true);document.removeEventListener('visibilitychange',schedule);
  }
  const onClick = event => { if(dismissClick&&performance.now()<dismissClick.until&&event.target===dismissClick.target){dismissClick=null;event.preventDefault();event.stopImmediatePropagation();return;} dismissClick=null; const image=event.target;if(image instanceof HTMLImageElement&&isContentImage(image)&&!protectedImage(image)){clicked={key:imageKey(image),time:performance.now()};schedule();} };
  function start() {
    enabled=true;
    intersection=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){const r=records.get(e.target);if(r)enqueue(r);}}, {rootMargin:'500px 0px'});
    observer=new MutationObserver(changes=>{
      // Run cached/pending presentation for new images before the next paint.
      // This runs after native click handlers, never during their activation.
      for (const change of changes) if (change.type === 'childList') for (const node of change.addedNodes) {
        if (node.nodeType !== 1 || node.matches('[data-cg-zhihu-control]')) continue;
        const images = node.matches('img') ? [node] : [...node.querySelectorAll('img')].slice(0,80);
        for (const image of images) {
          const nativeViewer = image.parentElement === document.body && clicked && imageKey(image) === clicked.key
            && performance.now() - clicked.time < 15000;
          if (isContentImage(image) || nativeViewer) { const record = addRecord(image, !!nativeViewer); if (record) { paint(record); enqueue(record); } }
        }
      }
      if(changes.some(c=>c.type==='attributes'
        ? c.target.matches('img, .RichContent, .RichText, .RichText-ConditionalImagePortal, [data-collapsed]')
        : [...c.addedNodes,...c.removedNodes].some(n=>n.nodeType===1&&!n.matches?.('[data-cg-zhihu-control]')
          && (c.target.closest?.(BODY)||c.target===document.body||n.matches?.(BODY)||n.querySelector?.(BODY)))))schedule();
    });
    observer.observe(document.body||document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','src','srcset','data-original','hidden','aria-expanded','data-collapsed']});
    themeObserver=new MutationObserver(schedule);themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['class','style','data-theme','theme','data-darkreader-mode','data-darkreader-scheme']});
    if(document.head)themeObserver.observe(document.head,{childList:true,subtree:true,attributes:true,attributeFilter:['media','disabled']});
    document.addEventListener('pointerdown',onPointer,true);document.addEventListener('click',onClick,true);
    window.addEventListener('contextmenu',onContextMenu,true);
    window.addEventListener('keydown',onKey,true);document.addEventListener('visibilitychange',schedule);
    refresh();
  }
  const announce=()=>window.dispatchEvent(new CustomEvent(EVENT('main-ready'),{detail:token}));
  function configure(event) {
    let message;try{message=JSON.parse(event.detail);}catch{return;}
    if(message?.token!==token||disposed)return;
    const next=message.config||{},active=next.active===true&&supported();
    config={smallImages:next.smallImages!==false,darkImages:next.darkImages!==false,matchPageTheme:next.matchPageTheme!==false,locale:next.locale==='zh-CN'?'zh-CN':'en-US'};
    if(active&&!enabled)start();else if(!active&&enabled)stop();else if(enabled){revision++;for(const cancel of loads)cancel();pending.clear();schedule();}
  }
  function dispose(event) {
    if(event.detail!==token)return;stop();disposed=true;choices.clear();results.clear();
    window.removeEventListener(EVENT('configure'),configure,true);window.removeEventListener(EVENT('dispose'),dispose,true);window.removeEventListener(EVENT('bridge-ready'),announce,true);
    delete globalThis[KEY];
  }
  window.addEventListener(EVENT('configure'),configure,true);window.addEventListener(EVENT('dispose'),dispose,true);window.addEventListener(EVENT('bridge-ready'),announce,true);
  Object.defineProperty(globalThis,KEY,{value:{token,announce},configurable:true});announce();
})();
