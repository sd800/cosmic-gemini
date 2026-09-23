const {reader,clamp,rgb,fontFamily,numberLabel}=require('./legacy-binary.cjs');
const {localFont}=require('./fonts.cjs');
const {pt}=require('./office-package.cjs');
const COLORS=['inherit','#000000','#0000ff','#00ffff','#00ff00','#ff00ff','#ff0000','#ffff00','#ffffff','#000080','#008080','#008000','#800080','#800000','#808000','#808080','#c0c0c0'];

function properties(bytes) {
  const b=reader(bytes),out=[];let at=0;
  while(at+2<=b.length){
    if(out.length>=4096)throw Error('documentTooComplex');
    const op=b.u16(at);at+=2;let size=[1,1,2,4,2,2,0,3][op>>>13];
    if((op>>>13)===6){
      if(op===0xd608){size=b.u16(at)-1;at+=2;}
      else {size=b.u8(at++);if(op===0xc615&&size===255){const del=b.u8(at);const add=b.u8(at+1+del*4);size=2+del*4+add*3;}}
    }
    out.push([op,reader(b.slice(at,size))]);at+=size;
  }
  // Style records can end in a single zero alignment byte.
  if(at<b.length&&b.u8(at)!==0)throw Error('invalidDocument');
  return out;
}
function border(b,at=0,modern=false) {
  const color=modern?b.u32(at):null,offset=at+(modern?4:0),width=b.u8(offset)/8,type=b.u8(offset+1);
  return {style:type===0||type===255?'none':type===3?'double':[6,7,8,9,22,23].includes(type)?'dashed':type===5?'dotted':'solid',
    width:pt(clamp(width,0,12)),color:modern?(color>>>24?'inherit':rgb(color)):(COLORS[b.u8(offset+2)]||'inherit')};
}
function setBorder(css,side,b){for(const [key,value]of Object.entries(b))css['border-'+side+'-'+key]=value;}
function shading(b,modern){const value=modern?b.u32(4):null;return modern?(value>>>24?undefined:rgb(value)):(COLORS[(b.u16(0)>>>5)&31]||undefined);}
function apply(list,state,baseline=state) {
  const s={...state,css:{...state.css}};
  for(const [op,b]of list){
    const toggle=(key,on,off)=>{const v=b.u8(0);s.css[key]=v===128?baseline.css?.[key]:v===129?(baseline.css?.[key]===on?off:on):v?on:off;};
    if(op===0x0835)toggle('font-weight','700','400');
    else if(op===0x0836)toggle('font-style','italic','normal');
    else if(op===0x083a)toggle('font-variant-caps','small-caps','normal');
    else if(op===0x083b)toggle('text-transform','uppercase','none');
    else if(op===0x0837||op===0x2a53){const v=b.u8(0);s.strike=v===128?baseline.strike:v===129?!baseline.strike:!!v;}
    else if(op===0x083c){const v=b.u8(0);s.hidden=v===128?baseline.hidden:v===129?!baseline.hidden:!!v;}
    else if(op===0x2a3e)s.underline=b.u8(0);
    else if(op===0x2a48)s.script=b.u8(0);
    else if(op===0x4a43||op===0x4a61)s.css['font-size']=pt(clamp(b.u16(0)/2,4,96));
    else if(op===0x2a0c)s.css['background-color']=COLORS[b.u8(0)]||undefined;
    else if(op===0x2a42)s.css.color=COLORS[b.u8(0)]||'inherit';
    else if(op===0x6870)s.css.color=b.u32(0)>>>24?'inherit':rgb(b.u32(0));
    else if(op===0x4a4f)s.font=b.u16(0);
    else if(op===0x4a50)s.eastFont=b.u16(0);
    else if(op===0x4a51)s.otherFont=b.u16(0);
    else if(op===0x4866||op===0xca71||op===0x442d||op===0xc64d)s.css['background-color']=shading(b,op===0xca71||op===0xc64d);
    else if(op===0x2403||op===0x2461)s.css['text-align']=['left','center','right','justify','justify'][b.u8(0)]||'left';
    else if([0x840e,0x845d,0x840f,0x845e,0x8411,0x8460].includes(op))s.css[[0x840e,0x845d].includes(op)?'margin-right':[0x840f,0x845e].includes(op)?'margin-left':'text-indent']=pt(clamp(b.i16(0)/20,-720,1440));
    else if(op===0xa413||op===0xa414)s.css[op===0xa413?'margin-top':'margin-bottom']=pt(clamp(b.u16(0)/20,0,720));
    else if(op===0x6412){const line=b.i16(0),multiple=b.u16(2);s.css['line-height']=line<0?pt(clamp(-line/20,1,999)):multiple?String(Math.round(clamp(line/240,.5,10)*1000)/1000):'max(1.2em,'+pt(clamp(line/20,0,999))+')';}
    else if(op===0x2441)s.css.direction=b.u8(0)?'rtl':'ltr';
    else if(op===0x2407)s.breakBefore=!!b.u8(0);
    else if(op===0x2640)s.heading=b.u8(0)<6?b.u8(0)+1:0;
    else if(op===0x260a)s.level=clamp(b.u8(0),0,8);
    else if(op===0x460b){const v=b.u16(0);s.list=v>=0xf802?0x10000-v:v===0xf801?0:v;}
    else if(op===0x2416||op===0x244b)s.inTable=!!b.u8(0);
    else if(op===0x2417||op===0x244c)s.rowEnd=!!b.u8(0);
    else if(op===0x6649)s.inTable=b.u32(0)>0;
    else if(op===0x9407)s.rowHeight=Math.abs(b.i16(0))/20;
    else if(op===0xd608){
      const n=b.u8(0);if(n>63)throw Error('invalidDocument');b.check(1,(n+1)*2);
      const edges=Array.from({length:n+1},(_,i)=>b.i16(1+i*2));
      if(edges.some((v,i)=>i&&v<edges[i-1]))throw Error('invalidDocument');
      s.cells=Array.from({length:n},(_,i)=>{
        const at=1+(n+1)*2+i*20,cell={css:{width:pt(clamp((edges[i+1]-edges[i])/20,0,1440))},merge:0,vertical:0};
        if(at+20<=b.length){const flags=b.u16(at);cell.merge=flags&3;cell.vertical=(flags>>>5)&3;cell.css['vertical-align']=['top','middle','bottom'][(flags>>>7)&3]||'top';
          for(const [j,side]of ['top','left','bottom','right'].entries())setBorder(cell.css,side,border(b,at+4+j*4));}
        return cell;
      });s.tableWidth=pt(clamp((edges[n]-edges[0])/20,0,1440));
    }else if(op===0xd605||op===0xd613){const modern=op===0xd613;s.borders=Array.from({length:6},(_,i)=>border(b,i*(modern?8:4),modern));}
    else if([0xd609,0xd612,0xd616,0xd60c].includes(op)){const old=op===0xd609,size=old?2:10,start=op===0xd616?22:op===0xd60c?44:0;s.shades={...s.shades};for(let i=0;i+size<=b.length;i+=size)s.shades[start+i/size]=shading(reader(b.slice(i,size)),!old);}
  }
  return s;
}

function wordFormatting(word,table,pairs,dataStream) {
  const w=reader(word),t=reader(table),fonts=[],definitions=[],resolved=new Map();
  function part(index){const p=pairs[index];return p?.length?reader(t.slice(p.start,p.length)):reader(new Uint8Array());}
  const ft=part(15);
  if(ft.length){const n=ft.u16(0),extra=ft.u16(2);if(n>4096)throw Error('documentTooComplex');let at=4;for(let i=0;i<n;i++){const size=ft.u8(at)+1;ft.check(at,size);if(size<40)throw Error('invalidDocument');const names=ft.utf16(at+40,(size-40)&~1),alternate=ft.u8(at+5),kind=(ft.u8(at+1)>>>4)&7;fonts.push(localFont([names.split('\0')[0],alternate?names.slice(alternate).split('\0')[0]:null],kind===2?'sans-serif':kind===3?'monospace':'serif'));at+=size+extra;}}
  const sh=part(1);let defaults={css:{'font-size':'11pt','font-family':fontFamily(['Times New Roman','Songti SC','SimSun'],'serif'),'margin-top':'0pt','margin-bottom':'0pt'},font:0,eastFont:0};
  if(sh.length){
    const header=sh.u16(0),n=sh.u16(2),baseSize=sh.u16(4);sh.check(2,header);
    if(n>4094||![10,18].includes(baseSize)||header<18)throw Error('invalidDocument');
    defaults.font=sh.u16(14);defaults.eastFont=sh.u16(16);defaults.otherFont=sh.u16(18);
    let at=2+header;
    for(let i=0;i<n;i++){
      const size=sh.u16(at);at+=2;if(!size){definitions.push(null);continue;}
      const b=reader(sh.slice(at,size));b.check(0,baseSize);const kind=b.u16(2)&15,base=b.u16(2)>>>4,cupx=b.u16(4)&15,sti=b.u16(0)&0xfff;
      let p=baseSize;const chars=b.u16(p);p+=2+chars*2+2;if(p%2)p++;
      const layers=[];for(let j=0;j<cupx;j++){const len=b.u16(p);p+=2;layers.push(b.slice(p,len));p+=len+(len%2);}
      definitions.push({kind,base,sti,paragraph:kind===1&&layers[0]?properties(layers[0].subarray(2)):[],character:layers[kind===1?1:0]?properties(layers[kind===1?1:0]):[]});at+=size+(size%2);
    }
  }
  function style(id,trail=new Set()){
    if(resolved.has(id))return resolved.get(id);
    const def=definitions[id];if(!def)return defaults;
    if(trail.has(id)||trail.size>=64)throw Error('invalidDocument');trail.add(id);
    let value=def.base===0xfff?(def.kind===2?{css:{}}:defaults):style(def.base,trail);
    value=apply(def.character,apply(def.paragraph,value));if(def.sti>=1&&def.sti<=6)value.heading=def.sti;
    resolved.set(id,value);return value;
  }
  function runs(index,paragraph){
    const b=part(index),out=[];if(!b.length)return out;
    const n=(b.length-4)/8;if(!Number.isInteger(n)||n>50000)throw Error('invalidDocument');
    const seen=new Set();
    for(let i=0;i<n;i++){
      const page=b.u32((n+1)*4+i*4)&0x3fffff;if(seen.has(page))continue;seen.add(page);
      const f=reader(w.slice(page*512,512)),count=f.u8(511),stride=paragraph?13:1;
      if(count>(paragraph?29:101))throw Error('invalidDocument');
      for(let j=0;j<count;j++){
        if(out.length>=200000)throw Error('documentTooComplex');
        const start=f.u32(j*4),end=f.u32((j+1)*4),offset=f.u8((count+1)*4+j*stride)*2;
        if(end<=start||end>w.length)throw Error('invalidDocument');let list=[],id=0;
        if(offset){
          if(offset<(count+1)*4+count*stride)throw Error('invalidDocument');
          let size=f.u8(offset),p=offset+1;if(paragraph){if(!size){size=f.u8(p++)*2;}else size=size*2-1;id=f.u16(p);p+=2;size-=2;}
          if(p+size>511)throw Error('invalidDocument');list=properties(f.slice(p,size));
          const huge=list.find(([op])=>op===0x6646||op===0x6645);
          if(huge&&dataStream){const d=reader(dataStream),pos=huge[1].u32(0);list=properties(d.slice(pos+2,d.u16(pos)));}
        }
        out.push({start,end,id,list});
      }
    }
    out.sort((a,b)=>a.start-b.start);for(let i=1;i<out.length;i++)if(out[i].start<out[i-1].end)throw Error('invalidDocument');return out;
  }
  const chars=runs(12,false),paras=runs(13,true);
  function lookup(runs,fc){let lo=0,hi=runs.length;while(lo<hi){const mid=(lo+hi)>>>1;if(runs[mid].end<=fc)lo=mid+1;else hi=mid;}return runs[lo]?.start<=fc?runs[lo]:{end:runs[lo]?.start??Infinity,list:[],id:0};}
  const page={width:'612pt',left:'72pt',right:'72pt',top:'72pt',bottom:'72pt'},sections=part(6);
  if(sections.length){const n=(sections.length-4)/16;if(!Number.isInteger(n)||n>10000)throw Error('invalidDocument');if(n){const fc=sections.u32((n+1)*4+2);if(fc!==0xffffffff){const props=properties(w.slice(fc+2,w.u16(fc)));for(const [op,b]of props){const key={45087:'width',45089:'left',45090:'right',36899:'top',36900:'bottom'}[op];if(key)page[key]=pt(clamp(Math.abs(key==='top'||key==='bottom'?b.i16(0):b.u16(0))/20,key==='width'?216:0,key==='width'?1440:144));}}}}
  function character(fc,paragraph,extra=[]){
    const run=lookup(chars,fc),all=[...run.list,...extra],id=all.find(([op])=>op===0x4a30)?.[1].u16(0);
    let base={...paragraph,css:{...paragraph.css}};
    if(id!==undefined&&definitions[id]?.kind===2){const st=style(id);base={...base,...st,css:{...base.css,...st.css}};}
    let state=apply(all,base,base);if(all.some(([op])=>op===0x2a33))state=apply(all,paragraph,paragraph);
    const family=fonts[state.font]||state.css['font-family'];if(family)state.css['font-family']=family;
    const families={ascii:family,east:fonts[state.eastFont]||family,other:fonts[state.otherFont]||family};
    if(state.underline!==undefined||state.strike!==undefined)state.css['text-decoration-line']=[state.underline?'underline':'',state.strike?'line-through':''].filter(Boolean).join(' ')||'none';
    if(state.underline===3)state.css['text-decoration-style']='double';
    // Paragraph layout belongs to its block, not every character span.
    const css=Object.fromEntries(Object.entries(state.css).filter(([k])=>/^(font-|color$|background-color$|text-decoration-|text-transform$)/.test(k)));
    return {css,families,script:state.script,hidden:state.hidden,end:run.end};
  }
  const lists=wordLists(t,pairs);
  function paragraph(fc,extra=[]){const run=lookup(paras,fc),id=[...run.list,...extra].find(([op])=>op===0x4600)?.[1].u16(0)??run.id;let state=apply([...run.list,...extra],style(id));
    const list=lists.get(state.list),level=list?.levels[state.level||0];if(level){state=apply([...level.para,...run.list,...extra],style(id));state.marker=list.next(state.level||0);state.markerCss=characterFrom(level.char,state);}
    return state;
  }
  function characterFrom(props,state){const value=apply(props,state);return {...value.css,'font-family':fonts[value.font]||fonts[value.eastFont]};}
  return {page,paragraph,character,properties};
}

function wordLists(table,pairs){
  const definitions=new Map(),lists=new Map(),p=pairs[73],o=pairs[74];if(!p?.length||!o?.length)return lists;
  // MS-DOC stores LVLs immediately after PlfLst, outside its lcbPlfLst length.
  const b=reader(table.slice(p.start,table.length-p.start));let at=2,n=b.u16(0);if(n>2048)throw Error('documentTooComplex');b.check(2,n*28);
  const heads=Array.from({length:n},(_,i)=>({id:b.u32(2+i*28),count:b.u8(2+i*28+26)&1?1:9}));at+=n*28;
  function level(r,pos){
    r.check(pos,28);const start=r.u32(pos),format=r.u8(pos+4),flags=r.u8(pos+5),follow=r.u8(pos+15),c=r.u8(pos+24),p=r.u8(pos+25);
    const para=properties(r.slice(pos+28,p)),char=properties(r.slice(pos+28+p,c));let end=pos+28+p+c;const chars=r.u16(end);end+=2;
    if(chars>1024)throw Error('documentTooComplex');const pattern=r.utf16(end,chars*2);end+=chars*2;
    return {value:{start:clamp(start,0,32767),format,flags,follow,para,char,pattern},end};
  }
  for(const h of heads){const levels=[];for(let i=0;i<h.count;i++){const l=level(b,at);levels.push(l.value);at=l.end;}definitions.set(h.id,levels);}
  const overrides=reader(table.slice(o.start,o.length)),count=overrides.u32(0);if(count>2048)throw Error('documentTooComplex');overrides.check(4,count*16);at=4+count*16;
  for(let i=0;i<count;i++){
    const base=4+i*16,levels=(definitions.get(overrides.u32(base))||[]).map(l=>({...l})),n=overrides.u8(base+12);if(n>9)throw Error('invalidDocument');overrides.check(at,4);at+=4;
    for(let j=0;j<n;j++){
      const start=overrides.u32(at),flags=overrides.u8(at+4),index=flags&15;overrides.check(at,8);at+=8;if(index>8)throw Error('invalidDocument');
      if(flags&32){const l=level(overrides,at);levels[index]=l.value;at=l.end;}else if(flags&16&&levels[index])levels[index]={...levels[index],start:clamp(start,0,32767)};
    }
    const counters=[];
    lists.set(i+1,{levels,next(index){const l=levels[index];if(!l)return '';counters[index]=counters[index]===undefined?l.start:counters[index]+1;
      for(let j=index+1;j<9;j++)if(!(levels[j]?.flags&8))counters[j]=undefined;
      const label=l.pattern.replace(/[\x00-\x08]/g,ch=>{const k=ch.charCodeAt(0);return numberLabel(counters[k]??levels[k]?.start??1,l.flags&4?0:levels[k]?.format??0);});
      return (l.format===23?label.replace(/[\uf000-\uf0ff]/g,'•'):label)+(l.follow===2?'':l.follow===1?' ':'\t');}});
  }
  return lists;
}
module.exports={wordFormatting,properties,setBorder};
