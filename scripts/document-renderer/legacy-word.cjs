const {compound}=require('./compound.cjs');
const {esc}=require('./office-package.cjs');
// MS-DOC 2.4.1: the CLX piece table selects the current text, so saved/deleted
// bytes elsewhere in WordDocument never become visible simply by scanning it.
function word(buffer) {
  const streams=compound(buffer), bytes=streams.get('WordDocument');
  if(!bytes||bytes.length<154)throw Error('invalidDocument');
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const u16=at=>v.getUint16(at,true),u32=at=>v.getUint32(at,true);
  if(u16(0)!==0xa5ec||u16(2)<0xc1||(u16(10)&0x8100))throw Error('invalidDocument');
  const table=streams.get((u16(10)&0x200)?'1Table':'0Table');if(!table)throw Error('invalidDocument');
  let at=32,words=u16(at);at+=2+words*2;
  const longs=u16(at);at+=2; if(longs<11||at+longs*4+2>bytes.length)throw Error('invalidDocument');
  const lengths=[u32(at+12),u32(at+16),u32(at+20),u32(at+28),u32(at+32),u32(at+36),u32(at+40)];
  at+=longs*4;const pairs=u16(at);at+=2;
  if(pairs<34||at+pairs*8>bytes.length)throw Error('invalidDocument');
  const start=u32(at+33*8),length=u32(at+33*8+4);
  if(start+length>table.length||length<5||lengths.reduce((a,b)=>a+b,0)>8*1024*1024)throw Error('invalidDocument');
  const tv=new DataView(table.buffer,table.byteOffset,table.byteLength);let p=start;
  while(p<start+length&&table[p]===1){if(p+3>start+length)throw Error('invalidDocument');p+=3+tv.getUint16(p+1,true);}
  if(p+5>start+length||table[p]!==2)throw Error('invalidDocument');
  const plcSize=tv.getUint32(p+1,true);p+=5;
  const n=(plcSize-4)/12;
  if(!Number.isInteger(n)||n<0||n>200000||p+plcSize>start+length)throw Error('invalidDocument');
  const pieces=[],max=lengths.reduce((a,b)=>a+b,0);let expected=0;
  for(let i=0;i<n;i++){
    const cp=tv.getUint32(p+i*4,true),end=tv.getUint32(p+(i+1)*4,true);
    const fc=tv.getUint32(p+(n+1)*4+i*8+2,true),compressed=!!(fc&0x40000000),offset=(fc&0x3fffffff)/(compressed?2:1);
    if(cp!==expected||end<cp||end>max+1||offset%1||offset+(end-cp)*(compressed?1:2)>bytes.length)throw Error('invalidDocument');
    const text=new TextDecoder(compressed?'windows-1252':'utf-16le').decode(bytes.subarray(offset,offset+(end-cp)*(compressed?1:2)));
    pieces.push(text);expected=end;
  }
  if(expected<lengths[0])throw Error('invalidDocument');
  // Field instructions are not display text. Retain only each field's result.
  function clean(text){let out='',fields=[];for(const ch of text){if(ch==='\x13'){if(fields.length>=80)throw Error('documentTooComplex');fields.push(false);}else if(ch==='\x14'){if(fields.length)fields[fields.length-1]=true;}else if(ch==='\x15')fields.pop();else if(fields.every(Boolean))out+=ch;}return out.replace(/[\x00-\x06\x08\x0e-\x1f]/g,'').replace(/\x07/g,'\t').replace(/\x0b/g,'\n');}
  const source=pieces.join(''),body=clean(source.slice(0,lengths[0]));
  const paras=body.split(/\r/);if(paras.length>100000)throw Error('documentTooComplex');
  let html=paras.map(p=>p.split('\f').map(part=>'<p>'+esc(part)+'</p>').join('<hr class="cg-page-break">')).join('');
  // Footnotes/endnotes/text boxes are separate stories; don't expose comments or
  // hidden metadata. Append readable secondary text without inferring layout.
  let offset=lengths[0];for(let i=1;i<lengths.length;i++){if([1,4,5].includes(i)&&lengths[i])html+='<hr>'+clean(source.slice(offset,offset+lengths[i])).split('\r').map(p=>'<p>'+esc(p)+'</p>').join('');offset+=lengths[i];}
  return {value:html,formatting:{styles:[]}};
}
module.exports={word};
