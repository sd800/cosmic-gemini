const {compound}=require('./compound.cjs');
const {rasterBlip}=require('./legacy-office-images.cjs');
const {styles,pt}=require('./office-package.cjs');
const {reader,clamp,rgb}=require('./legacy-binary.cjs');
const {masterStyles,renderText}=require('./legacy-powerpoint-text.cjs');
// Read the live edit chain and its slide order (MS-PPT 2.3/2.4), rather than
// scraping all strings: old saves, deleted slides and notes are not slides.
function presentation(input) {
  const streams=compound(input),bytes=streams.get('PowerPoint Document'),user=streams.get('Current User');
  if(!bytes||!user||user.length<20)throw Error('invalidDocument');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),uv=new DataView(user.buffer,user.byteOffset,user.byteLength);
  const u32=at=>view.getUint32(at,true);let records=0;
  function record(at,end=bytes.length){if(at<0||at+8>end||++records>250000)throw Error('invalidDocument');const length=u32(at+4);if(at+8+length>end)throw Error('invalidDocument');const bits=view.getUint16(at,true);return {at,start:at+8,end:at+8+length,type:view.getUint16(at+2,true),version:bits&15,instance:bits>>>4,length};}
  const childCache=new Map();
  function children(parent){if(childCache.has(parent.at))return childCache.get(parent.at);const list=[];for(let at=parent.start;at<parent.end;){const r=record(at,parent.end);list.push(r);at=r.end;}childCache.set(parent.at,list);return list;}
  function findAll(parent,type,out=[],depth=0){if(depth>64)throw Error('documentTooComplex');if(parent.type===type)out.push(parent);if(parent.version===15)for(const r of children(parent))findAll(r,type,out,depth+1);return out;}
  const data=r=>reader(bytes.subarray(r.start,r.end));
  if(uv.getUint32(12,true)===0xf3d1c4df)throw Error('invalidDocument');
  let edit=uv.getUint32(16,true),docId,seen=new Set(),directory=new Map();
  while(edit){
    if(seen.has(edit)||seen.size>4096)throw Error('invalidDocument');seen.add(edit);
    const r=record(edit);if(r.type!==4085||r.length<28)throw Error('invalidDocument');
    if(r.length>=32&&u32(r.start+28))throw Error('invalidDocument');
    if(docId===undefined)docId=u32(r.start+16);
    const pointer=record(u32(r.start+12));if(![6001,6002].includes(pointer.type))throw Error('invalidDocument');
    let at=pointer.start;
    while(at<pointer.end){if(at+4>pointer.end)throw Error('invalidDocument');const head=u32(at),base=head&0xfffff,count=head>>>20;at+=4;if(!count||at+count*4>pointer.end)throw Error('invalidDocument');for(let i=0;i<count;i++){if(!directory.has(base+i))directory.set(base+i,u32(at+i*4));}at+=count*4;}
    edit=u32(r.start+8);
  }
  const offset=directory.get(docId);if(offset===undefined)throw Error('invalidDocument');
  const doc=record(offset);if(doc.type!==1000)throw Error('invalidDocument');
  const slideList=children(doc).find(r=>r.type===4080&&r.instance===0);if(!slideList)throw Error('invalidDocument');
  const slides=[];let current;
  function text(r){if(r.type===4000){if(r.length%2)throw Error('invalidDocument');return new TextDecoder('utf-16le').decode(bytes.subarray(r.start,r.end));}if(r.type===4008)return new TextDecoder('windows-1252').decode(bytes.subarray(r.start,r.end));return '';}
  function textBlocks(records){const blocks=[];let block;
    for(const r of records){if(r.type===3999){block={kind:data(r).u32(0),text:''};blocks.push(block);}
      else if([4000,4008].includes(r.type)){if(!block||block.text){block={kind:4,text:''};blocks.push(block);}block.text=text(r);}
      else if(block&&r.type===4001)block.styles=data(r).bytes;
      else if(block&&r.type===4006)block.ruler=data(r).bytes;
    }return blocks;
  }
  for(const r of children(slideList)){
    if(r.type===1011){if(r.length<4)throw Error('invalidDocument');current={ref:u32(r.start),records:[]};slides.push(current);}
    else if(current)current.records.push(r);
  }
  if(!slides.length||slides.length>300)throw Error('documentTooComplex');
  const registered=styles(),docRecords=children(doc),atom=docRecords.find(r=>r.type===1001),size=atom?data(atom):null;
  const width=size?clamp(size.i32(0)/8,72,2880):720,height=size?clamp(size.i32(4)/8,72,2880):540;
  const fonts=[];for(const r of findAll(doc,4023)){if(r.instance>4096)throw Error('documentTooComplex');fonts[r.instance]=data(r).utf16(0,64).split('\0')[0];}
  const defaults=new Map();for(const r of findAll(doc,4003))defaults.set(r.instance,masterStyles(data(r).bytes,r.instance));
  const masterRefs=new Map();for(const list of docRecords.filter(r=>r.type===4080&&r.instance===1))for(const r of children(list))if(r.type===1011&&r.length>=16)masterRefs.set(data(r).u32(12),data(r).u32(0));
  const pictures=streams.get('Pictures'),imageCache=new Map();
  const store=findAll(doc,0xf001)[0],blips=store?children(store).filter(r=>r.type===0xf007):[];
  function image(index){
    if(imageCache.has(index))return imageCache.get(index);const entry=blips[index-1];if(!entry)return '';
    const b=data(entry);if(b.length<36)return '';const embedded=36+b.u8(33);let stream,offset;
    if(embedded+8<b.length){stream=b;offset=embedded;}else if(pictures){stream=reader(pictures);offset=b.u32(28);}else return '';
    if(offset===0xffffffff||offset+8>stream.length)return '';
    const url=rasterBlip(stream,offset);imageCache.set(index,url);return url;
  }
  let output=0,fragments=0;
  function bounded(fragment){fragments+=fragment.length;if(fragments>40*1024*1024)throw Error('documentTooLarge');return fragment;}
  const parts=slides.map((slide,i)=>{
    const at=directory.get(slide.ref);if(at===undefined)throw Error('invalidDocument');const r=record(at);if(r.type!==1006)throw Error('invalidDocument');
    const slideAtom=children(r).find(c=>c.type===1007),masterId=slideAtom&&slideAtom.length>=16?data(slideAtom).u32(12):0;
    const masterAt=directory.get(masterRefs.get(masterId)),master=masterAt===undefined?null:record(masterAt),masters=[defaults],scheme=['#ffffff','#000000','#808080','#000000','#4472c4','#ed7d31','#a5a5a5','#ffc000'];
    if(master){const levels=new Map();for(const st of findAll(master,4003))levels.set(st.instance,masterStyles(data(st).bytes,st.instance));masters.push(levels);}
    const colors=findAll(r,2032)[0]||(master&&findAll(master,2032)[0]);if(colors&&colors.length>=32)for(let j=0;j<8;j++)scheme[j]=rgb(data(colors).u32(j*4));
    const blocks=textBlocks(slide.records),used=new Set(),floating=[],fallback=[];let shapeCount=0,background=scheme[0];
    const render=block=>renderText(block,{registered,fonts,scheme,masters});
    function options(shape){const result=new Map();for(const r of children(shape).filter(c=>[0xf00b,0xf121,0xf122].includes(c.type))){const b=data(r);b.check(0,r.instance*6);for(let j=0;j<r.instance;j++){const id=b.u16(j*6);if(!(id&0x8000))result.set(id&0x3fff,b.u32(j*6+2));}}return result;}
    const shapeColor=value=>value===undefined?undefined:value&0x08000000?scheme[value&255]:value&0x10000000?undefined:rgb(value);
    function rectangle(record,child=false){const b=data(record),short=record.length===8,get=short?b.i16:b.i32,step=short?2:4;b.check(0,step*4);const a=[0,1,2,3].map(i=>get(i*step));return child?{x:a[0],y:a[1],w:a[2]-a[0],h:a[3]-a[1]}:{x:a[1],y:a[0],w:a[2]-a[1],h:a[3]-a[0]};}
    function walk(node,parent={x:0,y:0,sx:1/8,sy:1/8},isMaster=false,depth=0){
      if(depth>64)throw Error('documentTooComplex');
      if(node.type===0xf003){
        const list=children(node),group=list.find(c=>c.type===0xf004),groupRect=group&&children(group).find(c=>c.type===0xf009),anchor=group&&children(group).find(c=>[0xf010,0xf00f].includes(c.type));
        let next=parent;
        if(groupRect&&anchor){const local=rectangle(groupRect,true),target=rectangle(anchor,anchor.type===0xf00f);if(local.w&&local.h){const sx=parent.sx*target.w/local.w,sy=parent.sy*target.h/local.h;next={x:parent.x+target.x*parent.sx-local.x*sx,y:parent.y+target.y*parent.sy-local.y*sy,sx,sy};}}
        for(const child of list)if(child!==group||!groupRect)walk(child,next,isMaster,depth+1);return;
      }
      if(node.type===0xf004){
        if(++shapeCount>4000)throw Error('documentTooComplex');
        const list=children(node),fsp=list.find(c=>c.type===0xf00a),flags=fsp?data(fsp).u32(4):0,opt=options(node),placeholder=findAll(node,3011)[0];
        if(flags&8||isMaster&&placeholder)return;
        const fillFlags=opt.get(447),fill=fillFlags!==undefined&&(fillFlags&0x100000)&&!(fillFlags&16)?undefined:shapeColor(opt.get(385));
        if(flags&1024){if(fill)background=fill;return;}
        const anchor=list.find(c=>[0xf010,0xf00f].includes(c.type)),box=anchor?rectangle(anchor,anchor.type===0xf00f):null;
        const textboxes=list.filter(c=>c.type===0xf00d);let contents='';
        for(const tx of textboxes){const records=children(tx),ref=records.find(c=>c.type===3998);if(ref){const index=data(ref).u32(0);if(blocks[index]){used.add(index);contents+=render(blocks[index]);}}else for(const b of textBlocks(records))contents+=render(b);}
        const picture=image(opt.get(260));if(picture)contents='<img class="cg-slide-picture" src="'+picture+'" alt="">'+contents;
        if(!box||box.w<=0||box.h<=0){if(contents)fallback.push(bounded(contents));return;}
        const css={position:'absolute',left:pt(clamp(parent.x+box.x*parent.sx,-4000,4000)),top:pt(clamp(parent.y+box.y*parent.sy,-4000,4000)),width:pt(clamp(box.w*parent.sx,1,4000)),height:pt(clamp(box.h*parent.sy,1,4000)),'background-color':fill};
        for(const [j,side]of ['left','top','right','bottom'].entries())css['padding-'+side]=pt(clamp((opt.get(129+j)??(j%2?45720:91440))/12700,0,144));
        const lineFlags=opt.get(511),line=shapeColor(opt.get(448));if(line&&!(lineFlags!==undefined&&(lineFlags&0x80000)&&!(lineFlags&8)))for(const side of ['top','bottom','left','right']){css['border-'+side+'-width']=pt(clamp((opt.get(459)??12700)/12700,0,12));css['border-'+side+'-style']='solid';css['border-'+side+'-color']=line;}
        if(fsp?.instance===3)css['border-radius']='50%';else if(fsp?.instance===2)css['border-radius']='8pt';
        if(opt.has(4))css.transform='rotate('+Math.round((opt.get(4)|0)/65536*1000)/1000+'deg)';
        floating.push(bounded('<div class="cg-shape '+registered.add(css)+'">'+contents+'</div>'));return;
      }
      // Text containers are host-defined even when recVer is 0.
      if(node.version===15)for(const child of children(node))walk(child,parent,isMaster,depth+1);
      else if([4000,4008].includes(node.type))fallback.push(render({text:text(node),kind:4}));
    }
    if(master)for(const drawing of children(master).filter(c=>c.type===1036))walk(drawing,undefined,true);
    walk(r);
    fallback.unshift(...blocks.filter((_,j)=>!used.has(j)).map(render));
    const canvas=registered.add({width:pt(width),height:floating.length?pt(height):undefined,'min-height':pt(height),'background-color':background,...(!floating.length?{'padding-left':'36pt','padding-right':'36pt','padding-top':'28pt','padding-bottom':'28pt'}:{})});
    let html='<div class="cg-slide '+canvas+'">'+floating.join('')+(floating.length?'':fallback.join(''))+'</div>';
    if(floating.length&&fallback.length)html+='<div class="'+registered.add({width:pt(width),'background-color':background,'padding-top':'18pt','padding-left':'24pt','padding-right':'24pt','padding-bottom':'18pt'})+'">'+fallback.join('')+'</div>';
    output+=html.length;if(output>40*1024*1024)throw Error('documentTooLarge');return {name:String(i+1),html};
  });
  return {parts,formatting:{kind:'pptx',styles:registered.values}};
}
module.exports={presentation};
