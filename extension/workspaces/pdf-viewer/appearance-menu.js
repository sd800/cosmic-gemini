const modes = ['auto', 'light', 'dark'];
// Packaged, local popover; document data never supplies menu markup or actions.
export function createAppearanceMenu({text,signal,getMode,getPage=()=>1,enabled=()=>true,onChoose,trigger=document.getElementById('theme'),menu=document.getElementById('appearance-menu')}) {
  let buttons=[], headings={}, pointerDown=false, pending=false, skipClick=false, openedPage=1,focusAnchor=trigger;
  const isOpen=()=>menu.matches(':popover-open');
  function close(focus=false){pending=false;const open=isOpen();if(open)menu.hidePopover();trigger.setAttribute('aria-expanded','false');if(open&&focus)focusAnchor.focus({preventScroll:true});}
  function refresh(){
    menu.setAttribute('aria-label',text.themeMenu);
    if(isOpen()&&openedPage!==getPage()){close();return;}
    for(const scope of ['global','page'])if(headings[scope])headings[scope].textContent=scope==='global'?text.themeGlobal:`${text.themePage} ${getPage()}`;
    for(const button of buttons){button.lastElementChild.textContent=text[{auto:'themeAuto',light:'themeLight',dark:'themeDark'}[button.dataset.mode]];button.setAttribute('aria-checked',String(button.dataset.mode===getMode(button.dataset.scope)));button.title=button.dataset.scope==='page'&&button.dataset.mode==='auto'?text.themeFollowDocument||'':'';}
  }
  function build(){
    if(buttons.length)return;
    for(const scope of ['global','page']){
      const group=document.createElement('div');group.className='appearance-group';group.role='group';
      const heading=document.createElement('div');heading.className='appearance-heading';heading.id=menu.id+'-'+scope;headings[scope]=heading;group.setAttribute('aria-labelledby',heading.id);group.append(heading);
      for(const mode of modes){
        const button=document.createElement('button');button.type='button';button.className='menu-action';button.role='menuitemradio';button.tabIndex=-1;button.dataset.mode=mode;button.dataset.scope=scope;
        const check=document.createElement('span');check.className='appearance-check';check.setAttribute('aria-hidden','true');check.textContent='✓';button.append(check,document.createElement('span'));
        button.addEventListener('click',()=>{const page=openedPage;close(true);if(scope!=='page'||page===getPage())onChoose(mode,scope,page);},{signal});group.append(button);buttons.push(button);
      }
      menu.append(group);
    }
  }
  function open(keyboard=false,anchor=trigger){
    if(trigger.disabled||!enabled())return;
    build();focusAnchor=anchor;openedPage=getPage();refresh();const rect=anchor.getBoundingClientRect();
    menu.style.right=Math.max(8,innerWidth-rect.right)+'px';menu.style.top=rect.bottom+6+'px';menu.style.maxHeight=Math.max(40,innerHeight-16)+'px';
    if(!isOpen())menu.showPopover();
    const height=menu.getBoundingClientRect().height;
    if(rect.bottom+6+height>innerHeight-8)menu.style.top=Math.max(8,rect.top-height-6)+'px';
    trigger.setAttribute('aria-expanded','true');
    if(keyboard)(buttons.find(button=>button.dataset.scope==='global'&&button.dataset.mode===getMode('global'))||buttons[0]).focus({preventScroll:true});else menu.focus({preventScroll:true});
  }
  trigger.setAttribute('aria-haspopup','menu');trigger.setAttribute('aria-controls',menu.id);trigger.setAttribute('aria-expanded','false');
  // Defer until pointerup on platforms that dispatch contextmenu on mousedown.
  trigger.addEventListener('pointerdown',()=>{pointerDown=true;skipClick=false;},{signal});
  document.addEventListener('pointerup',()=>{if(!pointerDown)return;pointerDown=false;if(pending){pending=false;queueMicrotask(()=>{if(!signal.aborted)open();});}},{capture:true,signal});
  document.addEventListener('pointercancel',()=>{pointerDown=pending=skipClick=false;},{capture:true,signal});
  trigger.addEventListener('click',event=>{if(skipClick){skipClick=false;event.preventDefault();event.stopImmediatePropagation();}},{capture:true,signal});
  trigger.addEventListener('contextmenu',event=>{event.preventDefault();event.stopPropagation();skipClick=pointerDown;if(pointerDown)pending=true;else open();},{signal});
  trigger.addEventListener('keydown',event=>{skipClick=false;if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'||event.key==='ArrowDown'){event.preventDefault();event.stopPropagation();open(true);}},{signal});
  menu.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}
    else if(event.key==='Tab')close();
    else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();event.stopPropagation();const current=buttons.indexOf(document.activeElement);
      const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:current<0?(event.key==='ArrowUp'?buttons.length-1:0):(current+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;
      buttons[next].focus({preventScroll:true});
    }
  },{signal});
  menu.addEventListener('toggle',()=>trigger.setAttribute('aria-expanded',String(isOpen())),{signal});
  window.addEventListener('blur',()=>{pointerDown=skipClick=false;close();},{signal});
  window.addEventListener('resize',()=>close(),{signal});signal.addEventListener('abort',()=>close(),{once:true});
  return {refresh,close,open};
}
