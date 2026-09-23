const {reader,clamp,rgb}=require('./legacy-binary.cjs');
const {localFont:fontFamily}=require('./fonts.cjs');
const {pt}=require('./office-package.cjs');
const DEFAULT_PALETTE=('000000 ffffff ff0000 00ff00 0000ff ffff00 ff00ff 00ffff '+
  '000000 ffffff ff0000 00ff00 0000ff ffff00 ff00ff 00ffff 800000 008000 000080 808000 800080 008080 c0c0c0 808080 '+
  '9999ff 993366 ffffcc ccffff 660066 ff8080 0066cc ccccff 000080 ff00ff ffff00 00ffff 800080 800000 008080 0000ff '+
  '00ccff ccffff ccffcc ffff99 99ccff ff99cc cc99ff ffcc99 3366ff 33cccc 99cc00 ffcc00 ff9900 ff6600 666699 969696 '+
  '003366 339966 003300 333300 993300 993366 333399 333333').split(' ').map(v=>'#'+v);

// SheetJS CE retains values/number formats but discards most BIFF XF fields.
// Read only BIFF8 visual records alongside it; never inspect formula tokens,
// links, VBA or drawing/embedded-object streams.
function excelFormatting(bytes) {
  const data=reader(bytes),fonts=[],xfs=[],palette=[...DEFAULT_PALETTE],sheets=new Map(),offsets=[];
  if(data.length<8||data.u16(0)!==0x0809||data.u16(4)!==0x0600)return {sheets,style:()=>({})};
  let current=null,depth=0,count=0,cells=0;
  for(let at=0;at+4<=data.length;){
    if(++count>300000)throw Error('documentTooComplex');
    const id=data.u16(at),length=data.u16(at+2),b=reader(data.slice(at+4,length));
    if(id===0x0809){depth++;if(offsets.includes(at)){current={cells:new Map(),cols:new Map(),rows:new Map()};sheets.set(at,current);}}
    if(depth===1&&id===0x0085){b.check(0,8);offsets.push(b.u32(0));}
    if(depth===1&&id===0x0031){
      if(fonts.length===4)fonts.push(null);if(fonts.length>4096)throw Error('documentTooComplex');
      const n=b.u8(14),wide=b.u8(15)&1,name=wide?b.utf16(16,n*2):String.fromCharCode(...b.slice(16,n));
      fonts.push({name,size:b.u16(0)/20,flags:b.u16(2),color:b.u16(4),weight:b.u16(6),underline:b.u8(10)});
    }
    if(depth===1&&id===0x00e0){if(xfs.length>8192)throw Error('documentTooComplex');b.check(0,20);xfs.push(b);}
    if(depth===1&&id===0x0092){const n=b.u16(0);if(n>56)throw Error('invalidDocument');for(let i=0;i<n;i++)palette[8+i]=rgb(b.u32(2+i*4));}
    if(current&&depth===1){
      if([0x0203,0x027e,0x00fd,0x0204,0x0201,0x0205,0x0006,0x00d6].includes(id)){
        const r=b.u16(0),c=b.u16(2);if(++cells>150000)throw Error('documentTooComplex');current.cells.set(r+':'+c,b.u16(4));
      }else if(id===0x00bd||id===0x00be){
        const r=b.u16(0),first=b.u16(2),last=b.u16(length-2),step=id===0x00bd?6:2;
        if(last<first||last>255||6+(last-first+1)*step!==length)throw Error('invalidDocument');
        for(let c=first;c<=last;c++){if(++cells>150000)throw Error('documentTooComplex');current.cells.set(r+':'+c,b.u16(4+(c-first)*step));}
      }else if(id===0x007d){
        const first=b.u16(0),last=b.u16(2);if(last<first||last>256)throw Error('invalidDocument');
        for(let c=first;c<=last;c++)current.cols.set(c,{width:clamp((b.u16(4)/256*7+5)*.75,4,1000),xf:b.u16(6),hidden:!!(b.u16(8)&1)});
      }else if(id===0x0208){
        b.check(0,16);const flags=b.u32(12);current.rows.set(b.u16(0),{height:(b.u16(6)&0x7fff)/20,hidden:!!(flags&32),xf:flags&128?(flags>>>16)&0xfff:undefined});
      }else if(id===0x0055)current.defaultWidth=clamp((b.u16(0)/256*7+5)*.75,4,1000);
      else if(id===0x0025)current.defaultHeight=b.u16(2)/20;
    }
    if(id===0x000a){depth=Math.max(0,depth-1);if(!depth)current=null;}
    at+=4+length;
  }
  const cache=new Map();
  const color=(i,background=false)=>palette[i]||(background?'#ffffff':'#000000');
  function style(index){
    if(cache.has(index))return cache.get(index);
    const x=xfs[index];if(!x)return {};
    const flags=x.u16(4),parent=xfs[flags>>>4],applied=x.u8(9),base=parent&&parent.u16(4)&4?parent:x;
    const group=bit=>flags&4||applied&bit?x:base;
    const font=fonts[group(8).u16(0)],a=group(16),border=group(32),fill=group(64),css={};
    if(font){css['font-family']=fontFamily([font.name]);css['font-size']=pt(clamp(font.size,4,96));css['font-weight']=font.weight>=600?'700':'400';css['font-style']=font.flags&2?'italic':'normal';css.color=color(font.color);
      css['text-decoration-line']=[font.underline?'underline':'',font.flags&8?'line-through':''].filter(Boolean).join(' ')||'none';
      if([2,0x22].includes(font.underline))css['text-decoration-style']='double';}
    css['text-align']={1:'left',2:'center',3:'right',5:'justify',6:'center',7:'justify'}[a.u8(6)&7];
    css['vertical-align']={0:'top',1:'middle',2:'bottom',3:'middle',4:'middle'}[(a.u8(6)>>>4)&7]||'bottom';
    css['white-space']=a.u8(6)&8?'pre-wrap':'nowrap';
    if(a.u8(8)&15)css['padding-left']=pt((a.u8(8)&15)*9+4);
    if((a.u8(8)>>>6)===2)css.direction='rtl';
    if((fill.u32(14)>>>26)===1)css['background-color']=color(fill.u16(18)&127,true);
    const edges=border.u32(10),colors=border.u32(14);
    for(const [side,type,ci]of [['left',edges&15,(edges>>>16)&127],['right',(edges>>>4)&15,(edges>>>23)&127],['top',(edges>>>8)&15,colors&127],['bottom',(edges>>>12)&15,(colors>>>7)&127]]){
      // A workbook's absent borders retain the preview's subtle gridlines.
      if(!type)continue;
      css['border-'+side+'-style']=type===6?'double':[3,8,9,10,11,12,13].includes(type)?'dashed':type===4||type===7?'dotted':'solid';
      css['border-'+side+'-width']=pt(type===5||type===6?2.25:[2,8,10,12,13].includes(type)?1.5:.75);css['border-'+side+'-color']=color(ci);
    }
    cache.set(index,css);return css;
  }
  return {sheets:offsets.map(offset=>sheets.get(offset)),style};
}
module.exports={excelFormatting,DEFAULT_PALETTE};
