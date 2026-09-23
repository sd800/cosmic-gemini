// Checked little-endian reads shared by the legacy Office formatting readers.
// These readers emit data for the existing CSS allowlist, never document CSS.
function reader(bytes) {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  function check(at,size){if(!Number.isInteger(at)||!Number.isInteger(size)||at<0||size<0||at+size>bytes.length)throw Error('invalidDocument');}
  return {bytes,length:bytes.length,check,
    u8(at){check(at,1);return bytes[at];},
    u16(at){check(at,2);return view.getUint16(at,true);},
    i16(at){check(at,2);return view.getInt16(at,true);},
    u32(at){check(at,4);return view.getUint32(at,true);},
    i32(at){check(at,4);return view.getInt32(at,true);},
    slice(at,size){check(at,size);return bytes.subarray(at,at+size);},
    utf16(at,size){check(at,size);if(size%2)throw Error('invalidDocument');return new TextDecoder('utf-16le').decode(bytes.subarray(at,at+size));}
  };
}
const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
const hex=n=>[n&255,(n>>>8)&255,(n>>>16)&255].map(v=>v.toString(16).padStart(2,'0')).join('');
const rgb=n=>'#'+hex(n);
function fontFamily(names,fallback='sans-serif') {
  const clean=[...new Set(names.filter(n=>typeof n==='string'&&/^[\p{L}\p{N} ._+-]{1,80}$/u.test(n)))].slice(0,6);
  return clean.length?clean.map(n=>'"'+n+'"').join(',')+','+fallback:undefined;
}
function numberLabel(n,format) {
  n=clamp(n,0,1000000);
  if([3,4].includes(format)){let s='',v=n;for(let i=0;v>0&&i<8;i++){v--;s=String.fromCharCode(65+v%26)+s;v=Math.floor(v/26);}return format===4?s.toLowerCase():s;}
  if([1,2].includes(format)&&n>0&&n<4000){let s='';for(const [v,t]of [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']])while(n>=v){s+=t;n-=v;}return format===2?s.toLowerCase():s;}
  return format===22?String(n).padStart(2,'0'):String(n);
}
module.exports={reader,clamp,rgb,fontFamily,numberLabel};
