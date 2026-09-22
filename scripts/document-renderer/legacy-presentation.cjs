const {compound}=require('./compound.cjs');
const {esc}=require('./office-package.cjs');
// Read the live edit chain and its slide order (MS-PPT 2.3/2.4), rather than
// scraping all strings: old saves, deleted slides and notes are not slides.
function presentation(input) {
  const streams=compound(input),bytes=streams.get('PowerPoint Document'),user=streams.get('Current User');
  if(!bytes||!user||user.length<20)throw Error('invalidDocument');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),uv=new DataView(user.buffer,user.byteOffset,user.byteLength);
  const u32=at=>view.getUint32(at,true);let records=0;
  function record(at,end=bytes.length){if(at<0||at+8>end||++records>250000)throw Error('invalidDocument');const length=u32(at+4);if(at+8+length>end)throw Error('invalidDocument');const bits=view.getUint16(at,true);return {at,start:at+8,end:at+8+length,type:view.getUint16(at+2,true),version:bits&15,instance:bits>>>4,length};}
  function children(parent){const list=[];for(let at=parent.start;at<parent.end;){const r=record(at,parent.end);list.push(r);at=r.end;}return list;}
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
  for(const r of children(slideList)){
    if(r.type===1011){if(r.length<4)throw Error('invalidDocument');current={ref:u32(r.start),strings:[]};slides.push(current);}
    else if(current&&[4000,4008].includes(r.type))current.strings.push(text(r));
  }
  if(!slides.length||slides.length>300)throw Error('documentTooComplex');
  function scan(r,out,depth=0){if(depth>64)throw Error('documentTooComplex');if(r.version===15){for(const c of children(r))scan(c,out,depth+1);}else if([4000,4008].includes(r.type))out.push(text(r));}
  const parts=slides.map((slide,i)=>{
    const at=directory.get(slide.ref);if(at===undefined)throw Error('invalidDocument');const r=record(at);if(r.type!==1006)throw Error('invalidDocument');
    const inside=[];scan(r,inside);
    const strings=[...slide.strings,...inside];
    const html=strings.map(s=>s.replace(/[\x00-\x08\x0e-\x1f]/g,'').split(/[\r\v]/).map(t=>'<p>'+esc(t)+'</p>').join('')).join('')||'<p></p>';
    return {name:String(i+1),html};
  });
  return {parts,formatting:{styles:[]}};
}
module.exports={presentation};
