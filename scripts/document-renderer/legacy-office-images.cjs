const {reader,clamp} = require('./legacy-binary.cjs');
const {esc,pt} = require('./office-package.cjs');

// MS-ODRAW 2.2.27/28: use the record type and UID count, not magic-byte
// searching in arbitrary OfficeArt records (which also contain metafiles).
function rasterBlip(stream,offset,end=stream.length) {
  stream.check(offset,8);
  const bits=stream.u16(offset),type=stream.u16(offset+2),length=stream.u32(offset+4);
  if(length>8*1024*1024||offset+8+length>end)throw Error('invalidDocument');
  if((bits&15)!==0||![0xf01d,0xf01e,0xf02a].includes(type))return '';
  const png=type===0xf01e,instance=bits>>>4;
  const skip=(png?{0x6e0:17,0x6e1:33}:{0x46a:17,0x46b:33,0x6e2:17,0x6e3:33})[instance];
  const pos=offset+8+skip,next=offset+8+length;
  if(!skip||pos+8>next)return '';
  const signature=png?stream.u32(pos)===0x474e5089&&stream.u32(pos+4)===0x0a1a0a0d:stream.u8(pos)===255&&stream.u8(pos+1)===216&&stream.u8(pos+2)===255;
  return signature?'data:image/'+(png?'png':'jpeg')+';base64,'+Buffer.from(stream.slice(pos,next-pos)).toString('base64'):'';
}

// Follow only a live picture run's PICF reference. Never scan arbitrary compound
// bytes, launch OLE, decode metafiles or follow linked picture paths.
function wordImages(bytes, registered) {
  const cache=new Map();let total=0,records=0;
  return offset => {
    if(!bytes||!Number.isInteger(offset))return '';
    if(cache.has(offset))return cache.get(offset);
    if(cache.size>=512)throw Error('documentTooComplex');
    cache.set(offset,'');
    const d=reader(bytes);d.check(offset,68);
    const length=d.u32(offset),header=d.u16(offset+4),kind=d.u16(offset+6);
    if(header!==68||length<68||length>8*1024*1024||![100,102].includes(kind))return '';
    const p=reader(d.slice(offset,length));let start=68;
    if(kind===102){start+=1+p.u8(start);p.check(start,0);}
    let image='';
    function scan(start,end,depth=0){
      if(depth>32)throw Error('documentTooComplex');
      for(let at=start;at<end&&!image;){
        if(++records>100000||at+8>end)throw Error('invalidDocument');
        const bits=p.u16(at),type=p.u16(at+2),size=p.u32(at+4),next=at+8+size;
        if(next>end)throw Error('invalidDocument');
        if([0xf01d,0xf01e,0xf02a].includes(type)){
          image=rasterBlip(p,at,end);
        }else if((bits&15)===15)scan(at+8,next,depth+1);
        else if(type===0xf007&&size>=36){const embedded=at+8+36+p.u8(at+8+33);if(embedded<next)scan(embedded,next,depth+1);}
        at=next;
      }
    }
    scan(start,length);
    if(!image)return '';
    total+=image.length;if(total>24*1024*1024)throw Error('documentTooLarge');
    const width=clamp(p.i16(28)*p.u16(32)/20000,1,1440),height=clamp(p.i16(30)*p.u16(34)/20000,1,1440);
    const html='<img class="'+registered.add({width:pt(width),'aspect-ratio':String(Math.round(width/height*1000)/1000)})+'" src="'+esc(image)+'" alt="">';
    cache.set(offset,html);return html;
  };
}
module.exports={wordImages,rasterBlip};
