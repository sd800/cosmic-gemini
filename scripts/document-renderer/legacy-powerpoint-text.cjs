const {reader,clamp,rgb}=require('./legacy-binary.cjs');
const {localFont:fontFamily,fontRuns}=require('./fonts.cjs');
const {pt,esc}=require('./office-package.cjs');
function cursor(bytes){const b=reader(bytes);let at=0;return {u16(){const v=b.u16(at);at+=2;return v;},i16(){const v=b.i16(at);at+=2;return v;},u32(){const v=b.u32(at);at+=4;return v;},skip(n){b.check(at,n);at+=n;},get at(){return at;}};}
function pf(c){
  const mask=c.u32(),s={css:{}};
  if(mask&15){const flags=c.u16();if(mask&1)s.bullet=!!(flags&1);}
  if(mask&128)s.bulletChar=String.fromCharCode(c.u16());
  if(mask&16)s.bulletFont=c.u16();if(mask&64)s.bulletSize=c.i16();if(mask&32)s.bulletColor=c.u32();
  if(mask&2048)s.css['text-align']=['left','center','right','justify','justify','justify','justify'][c.u16()]||'left';
  for(const [bit,key]of [[4096,'line-height'],[8192,'margin-top'],[16384,'margin-bottom']])if(mask&bit){const v=c.i16();s.css[key]=v<0?pt(clamp(-v/8,0,999)):key==='line-height'?String(clamp(v/100,.5,10)):String(Math.round(clamp(v/100,0,10)*1000)/1000)+'em';}
  if(mask&256)s.left=c.i16()/8;if(mask&1024)s.indent=c.i16()/8;
  if(mask&32768)c.u16();if(mask&0x100000){const n=c.u16();if(n>4096)throw Error('documentTooComplex');c.skip(n*4);}
  if(mask&65536)c.u16();if(mask&0xe0000)c.u16();if(mask&0x200000)s.css.direction=c.u16()?'rtl':'ltr';
  return s;
}
function cf(c){
  const mask=c.u32(),s={css:{}};
  if(mask&0xffff){const flags=c.u16();if(mask&1)s.css['font-weight']=flags&1?'700':'400';if(mask&2)s.css['font-style']=flags&2?'italic':'normal';if(mask&4)s.css['text-decoration-line']=flags&4?'underline':'none';}
  if(mask&0x10000)s.font=c.u16();if(mask&0x200000)s.eastFont=c.u16();if(mask&0x400000)s.ansiFont=c.u16();if(mask&0x800000)c.u16();
  if(mask&0x20000)s.css['font-size']=pt(clamp(c.i16(),4,96));
  if(mask&0x40000)s.color=c.u32();if(mask&0x80000)s.script=c.i16();return s;
}
const merge=(a={},b={})=>({...a,...b,css:{...a.css,...b.css}});
function textStyles(bytes,length){
  function parse(expected){const c=cursor(bytes),paragraphs=[],characters=[];
    for(let cp=0;cp<expected;){const n=c.u32(),level=c.u16();if(!n||cp+n>expected||level>8||paragraphs.length>100000)throw Error('invalidDocument');paragraphs.push({start:cp,end:cp+n,level,...pf(c)});cp+=n;}
    for(let cp=0;cp<expected;){const n=c.u32();if(!n||cp+n>expected||characters.length>100000)throw Error('invalidDocument');characters.push({start:cp,end:cp+n,...cf(c)});cp+=n;}
    if(c.at!==bytes.length)throw Error('invalidDocument');return {paragraphs,characters};}
  // The implied final paragraph mark is included by Word-compatible writers.
  try{return parse(length+1);}catch(error){if(error.message==='documentTooComplex')throw error;return parse(length);}
}
function masterStyles(bytes,instance){const c=cursor(bytes),n=c.u16(),levels=[];if(n>5)throw Error('invalidDocument');for(let i=0;i<n;i++){const index=instance>=5?c.u16():i;if(index>8)throw Error('invalidDocument');levels[index]={paragraph:pf(c),character:cf(c)};}return levels;}
function ruler(bytes){const c=cursor(bytes),mask=c.u32(),levels=[];if(mask&2)c.u16();if(mask&1)c.u16();if(mask&4){const n=c.u16();if(n>4096)throw Error('documentTooComplex');c.skip(n*4);}for(let i=0;i<5;i++){const s={};if(mask&(8<<i))s.left=c.i16()/8;if(mask&(256<<i))s.indent=c.i16()/8;levels.push(s);}return levels;}
function renderText(block,{registered,fonts,scheme,masters=[]}) {
  const raw=block.text||'',parsed=block.styles?textStyles(block.styles,raw.length):{paragraphs:[],characters:[]},rulers=block.ruler?ruler(block.ruler):[];
  const color=value=>(value>>>24)<8?scheme[value>>>24]:rgb(value),title=[0,6].includes(block.kind);
  let pi=0,ci=0,out='',paragraphCount=0;
  for(const m of raw.matchAll(/[^\r]*\r|[^\r]+$/g)){
    if(++paragraphCount>100000)throw Error('documentTooComplex');const start=m.index,end=start+m[0].length-(m[0].endsWith('\r')?1:0);
    while(parsed.paragraphs[pi]?.end<=start)pi++;const direct=parsed.paragraphs[pi]||{},level=direct.level||0;
    let para={css:{'margin-top':'0pt','margin-bottom':'6pt'}},base={css:{'font-size':title?'32pt':'20pt'}};
    for(const master of masters){const item=master.get(block.kind)?.[level]||master.get(block.kind)?.[0];para=merge(para,item?.paragraph);base=merge(base,item?.character);}
    para=merge(para,direct);Object.assign(para,rulers[level]);
    if(para.left!==undefined)para.css['margin-left']=pt(clamp(para.left,-720,1440));
    if(para.indent!==undefined)para.css['text-indent']=pt(clamp(para.indent-(para.left||0),-720,1440));
    let content='';
    if(para.bullet){const marker=(para.bulletChar||'•').replace(/[\uf000-\uf0ff]/g,'•');const markerCss={'font-family':fontFamily([fonts[para.bulletFont]]),color:para.bulletColor===undefined?undefined:color(para.bulletColor)};content+='<span class="cg-list-marker '+registered.add(markerCss)+'">'+esc(marker)+' </span>';}
    for(let at=start;at<end;){
      while(parsed.characters[ci]?.end<=at)ci++;const run=parsed.characters[ci],next=Math.min(end,run?.end??end),state=merge(base,run),css={...state.css};
      const ascii=fontFamily([fonts[state.font]||fonts[state.ansiFont]||fonts[state.eastFont]]);
      const families={ascii,east:fontFamily([fonts[state.eastFont]])||ascii,other:fontFamily([fonts[state.ansiFont]])||ascii};
      css.color=state.color===undefined?(title?scheme[3]:scheme[1]):color(state.color);
      const tag=state.script>0?'sup':state.script<0?'sub':'span';
      for(const run of fontRuns(raw.slice(at,next).replace(/[\x00-\x08\x0e-\x1f]/g,''),families))content+='<'+tag+' class="'+registered.add({...css,'font-family':run.family})+'">'+esc(run.text).replace(/\v/g,'<br>')+'</'+tag+'>';at=next;
    }
    out+='<p class="'+registered.add(para.css)+'">'+content+'</p>';
  }
  return out||'<p></p>';
}
module.exports={textStyles,masterStyles,renderText};
