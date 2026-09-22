// Bounded MS-CFB reader. Follow the directory tree, not orphan/deleted streams.
// A sector may belong to only one chain; loops, overlaps and forged sizes fail.
function compound(input) {
  const bytes = new Uint8Array(input), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bad = () => { throw Error('invalidDocument'); };
  const u32 = at => { if (at < 0 || at + 4 > bytes.length) bad(); return view.getUint32(at, true); };
  if (bytes.length < 512 || ![208,207,17,224,161,177,26,225].every((v,i) => bytes[i] === v)) bad();
  const major = view.getUint16(26,true), shift = view.getUint16(30,true);
  if (view.getUint16(28,true) !== 65534 || !((major === 3 && shift === 9) || (major === 4 && shift === 12)) || view.getUint16(32,true) !== 6 || u32(56) !== 4096) bad();
  const size = 2 ** shift, count = Math.floor(bytes.length / size) - 1, used = new Set();
  if (count < 1 || bytes.length % size) bad();
  const END = 0xfffffffe, FREE = 0xffffffff;
  function sector(id) { if (id >= count || used.has(id)) bad(); used.add(id); return (id + 1) * size; }
  const fatIds = [];
  for (let i=0;i<109;i++) { const id=u32(76+i*4); if(id!==FREE)fatIds.push(id); }
  let dif = u32(68); const difCount = u32(72);
  if(difCount>count)bad();
  for(let i=0;i<difCount;i++) { const at=sector(dif); for(let j=0;j<size/4-1;j++){const id=u32(at+j*4);if(id!==FREE)fatIds.push(id);}dif=u32(at+size-4); }
  if(difCount && dif!==END || fatIds.length!==u32(44) || fatIds.length>count)bad();
  const fat = [];
  for(const id of fatIds) { const at=sector(id); for(let j=0;j<size;j+=4)fat.push(u32(at+j)); }
  function chain(start, length) {
    const ids=[];let id=start;
    while(id!==END) { if(ids.length>=count)bad();const at=sector(id);ids.push(at);id=fat[id]; }
    if(length!==undefined && ids.length!==Math.ceil(length/size))bad();
    const result=new Uint8Array(length ?? ids.length*size);
    for(let i=0;i<ids.length;i++)result.set(bytes.subarray(ids[i],ids[i]+Math.min(size,result.length-i*size)),i*size);
    return result;
  }
  const directory = chain(u32(48)), dv = new DataView(directory.buffer);
  if(!directory.length||directory.length/128>32768)bad();
  const entries=[];
  for(let at=0;at+128<=directory.length;at+=128){
    const type=directory[at+66]; if(!type){entries.push(null);continue;}
    const len=dv.getUint16(at+64,true), high=dv.getUint32(at+124,true), length=dv.getUint32(at+120,true);
    if(![1,2,5].includes(type)||len<2||len>64||len%2||high||length>bytes.length)bad();
    entries.push({name:new TextDecoder('utf-16le').decode(directory.subarray(at,at+len-2)),type,start:dv.getUint32(at+116,true),length,
      left:dv.getUint32(at+68,true),right:dv.getUint32(at+72,true),child:dv.getUint32(at+76,true)});
  }
  if(entries[0]?.type!==5)bad();
  const miniFatBytes=u32(64)?chain(u32(60),u32(64)*size):new Uint8Array(), miniFat=new DataView(miniFatBytes.buffer);
  const root=entries[0],mini=root.length?chain(root.start,root.length):new Uint8Array(),miniUsed=new Set();
  const found=new Map(),visited=new Set();let total=0;
  function visit(id,parent='',depth=0){
    if(id===FREE)return;if(depth>80||visited.has(id)||!entries[id])bad();visited.add(id);
    const e=entries[id];visit(e.left,parent,depth+1);
    if(/[\/\\\0]/.test(e.name))bad();const path=parent+e.name;
    if(found.has(path))bad();
    if(e.type===1)visit(e.child,path+'/',depth+1);
    else if(e.type===2){
      total+=e.length;if(total>bytes.length)bad();
      let result;
      if(!e.length)result=new Uint8Array();
      else if(e.length>=4096)result=chain(e.start,e.length);
      else{
        result=new Uint8Array(e.length);let sectorId=e.start,at=0;
        while(sectorId!==END){
          if(at>=e.length||sectorId*64>=mini.length||sectorId*4+4>miniFat.byteLength||miniUsed.has(sectorId))bad();miniUsed.add(sectorId);
          result.set(mini.subarray(sectorId*64,sectorId*64+Math.min(64,e.length-at)),at);at+=64;sectorId=miniFat.getUint32(sectorId*4,true);
        }
        if(at<e.length)bad();
      }
      found.set(path,result);
    }else bad();
    visit(e.right,parent,depth+1);
  }
  visit(root.child);
  return found;
}
module.exports={compound};
