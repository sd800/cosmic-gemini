import { DOCUMENT_TYPES } from '../../extension/core/document-preview.js';
const uri='urn:oasis:names:tc:opendocument:xmlns:';
const namespaces=['office','text','table','style','manifest','presentation'].map(n=>`xmlns:${n}="${uri}${n}:1.0"`).join(' ')+` xmlns:draw="${uri}drawing:1.0" xmlns:fo="${uri}xsl-fo-compatible:1.0" xmlns:svg="${uri}svg-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink"`;
export function odfEntries(format){
 const style='<office:automatic-styles><style:style style:name="Heading" style:family="paragraph"><style:text-properties fo:font-weight="bold" fo:font-size="22pt" fo:color="#003366"/></style:style><style:style style:name="Cell" style:family="table-cell"><style:table-cell-properties fo:background-color="#ddeeff"/></style:style></office:automatic-styles>';
 const text='<text:h text:style-name="Heading">开放文档 / Open document</text:h><text:p>中文 English 123<text:tab/>tab<text:s text:c="3"/>spaces</text:p><text:soft-page-break/><text:p>Second page</text:p>';
 const table='<table:table table:name="预算 Budget"><table:table-row><table:table-cell table:style-name="Cell"><text:p>项目 Item</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="1200.5"><text:p>1,200.50</text:p></table:table-cell></table:table-row><table:table-row><table:table-cell table:number-columns-spanned="2"><text:p>Merged text</text:p></table:table-cell><table:covered-table-cell/></table:table-row><table:table-row table:number-rows-repeated="1048574"><table:table-cell table:number-columns-repeated="16384"/></table:table-row></table:table>';
 const external='<draw:frame><draw:image xlink:href="https://tracker.invalid/image.png"/></draw:frame><office:scripts><text:p>HIDDEN EXECUTABLE CONTENT</text:p></office:scripts>';
 const contents=format==='odt'?'<office:text>'+text+external+'</office:text>':format==='ods'?'<office:spreadsheet>'+table+'<table:table table:name="Second"><table:table-row><table:table-cell><text:p>Another worksheet</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet>':'<office:presentation><draw:page draw:name="第一页"><draw:frame svg:x="2cm" svg:y="1cm" svg:width="18cm" svg:height="10cm"><draw:text-box>'+text+'</draw:text-box></draw:frame>'+external+'</draw:page><draw:page draw:name="Second slide"><draw:frame><draw:text-box><text:p>Second slide content</text:p></draw:text-box></draw:frame></draw:page></office:presentation>';
 return {mimetype:DOCUMENT_TYPES[format],'META-INF/manifest.xml':`<manifest:manifest ${namespaces}><manifest:file-entry manifest:full-path="/" manifest:media-type="${DOCUMENT_TYPES[format]}"/></manifest:manifest>`,'content.xml':`<office:document-content ${namespaces}>${style}<office:body>${contents}</office:body></office:document-content>`};
}
export const rtfSample=String.raw`{\rtf1\ansi\ansicpg936{\fonttbl{\f0\fcharset134 SimSun;}}\f0\fs28\b RTF document\b0\par \'d6\'d0\'ce\'c4\par \uc1\u20013?\u25991?\par {\field{\*\fldinst INCLUDEPICTURE "https://tracker.invalid/pixel"}{\fldrslt Safe field result}}\par {\object\objdata PROGRAM-MUST-NOT-APPEAR}\page Second page\par \intbl Cell one\cell Cell two\cell\row\pard End.}`;
export const emailSample='From: =?UTF-8?B?5rWL6K+V?= <author@example.test>\r\nTo: reader@example.test\r\nSubject: =?UTF-8?B?6YKu5Lu26aKE6KeI?=\r\nDate: Tue, 22 Sep 2026 10:00:00 +0000\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="mixed"\r\n\r\n--mixed\r\nContent-Type: multipart/alternative; boundary="alt"\r\n\r\n--alt\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\nPlain fallback 中文\r\n--alt\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n<h2>Email content</h2><p>HTML body</p><img src=3D"https://tracker.invalid/pixel"><iframe src=3D"https://tracker.invalid/frame"></iframe><style>@import "https://tracker.invalid/style";</style><script>alert(1)</script>\r\n--alt--\r\n--mixed\r\nContent-Type: application/octet-stream; name="test.exe"\r\nContent-Disposition: attachment; filename="test.exe"\r\nContent-Transfer-Encoding: base64\r\n\r\nTVpOb3RBY3R1YWxFeGVjdXRhYmxl\r\n--mixed--\r\n';
export function cfbFile(XLSX,streams){const cfb=XLSX.CFB.utils.cfb_new();for(const[name,data]of Object.entries(streams))XLSX.CFB.utils.cfb_add(cfb,name,Buffer.from(data));const bytes=XLSX.CFB.write(cfb,{type:'buffer'});return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}
export function wordStreams(){
 const text='Word 97 中文正文\rNext paragraph\r\x13HYPERLINK secret\x14Display result\x15\r';
 const body=Buffer.alloc(4096),table=Buffer.alloc(512),utf=Buffer.from(text,'utf16le');
 body.writeUInt16LE(0xa5ec,0);body.writeUInt16LE(0xc1,2);body.writeUInt16LE(0x200,10);body.writeUInt16LE(14,32);body.writeUInt16LE(22,62);body.writeUInt32LE(text.length,76);body.writeUInt16LE(93,152);body.writeUInt32LE(0,154+33*8);body.writeUInt32LE(21,154+33*8+4);utf.copy(body,1024);
 table[0]=2;table.writeUInt32LE(16,1);table.writeUInt32LE(0,5);table.writeUInt32LE(text.length,9);table.writeUInt32LE(1024,15);
 return {'WordDocument':body,'1Table':table};
}
function record(type,body,instance=0,container=false){const out=Buffer.alloc(8+body.length);out.writeUInt16LE((instance<<4)|(container?15:0));out.writeUInt16LE(type,2);out.writeUInt32LE(body.length,4);Buffer.from(body).copy(out,8);return out;}
export function presentationStreams(){
 const tx=s=>record(4000,Buffer.from(s,'utf16le'));
 const slide1=record(1006,record(0xf002,tx('First shape 中文'),0,true),0,true),slide2=record(1006,record(0xf002,tx('Second shape'),0,true),0,true);
 const persist=id=>{const b=Buffer.alloc(20);b.writeUInt32LE(id);return record(1011,b);};
 const document=record(1000,record(4080,Buffer.concat([persist(3),tx('Second title'),persist(2),tx('First title')]),0,true),0,true);
 const deleted=record(1006,tx('DELETED SLIDE'),0,true),offsetDoc=slide1.length+slide2.length+deleted.length;
 const pointers=Buffer.alloc(16);pointers.writeUInt32LE((3<<20)|1);pointers.writeUInt32LE(offsetDoc,4);pointers.writeUInt32LE(0,8);pointers.writeUInt32LE(slide1.length,12);
 const persistBlock=record(6002,pointers),editBody=Buffer.alloc(28);editBody.writeUInt32LE(offsetDoc+document.length,12);editBody.writeUInt32LE(1,16);
 const editAt=offsetDoc+document.length+persistBlock.length,edit=record(4085,editBody),current=Buffer.alloc(28);current.writeUInt16LE(4086,2);current.writeUInt32LE(20,4);current.writeUInt32LE(0xe391c05f,12);current.writeUInt32LE(editAt,16);
 return {'PowerPoint Document':Buffer.concat([slide1,slide2,deleted,document,persistBlock,edit]),'Current User':current};
}

// Minimal, structurally valid formatting records; values are independent of the
// production readers so changes to byte offsets cannot silently update fixtures.
export function formattedWordStreams({mixedFonts=false}={}){
 const streams=wordStreams(),body=Buffer.alloc(8192),table=Buffer.alloc(4096);streams.WordDocument.copy(body,0,0,1024);
 const paragraphs=['Heading\r',mixedFonts?'Indented 中文body\r':'Indented body\r','One\r','Left\x07','Right\x07','\x07','Hidden visible\r'],content=paragraphs.join('');
 body.writeUInt32LE(content.length,76);Buffer.from(content,'utf16le').copy(body,1024);let at=64;
 function part(index,bytes){body.writeUInt32LE(at,154+index*8);body.writeUInt32LE(bytes.length,158+index*8);bytes.copy(table,at);at+=bytes.length+(bytes.length%2);}
 const u16=n=>{const b=Buffer.alloc(2);b.writeUInt16LE(n);return b;},u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
 const prop=(op,value)=>Buffer.concat([u16(op),Array.isArray(value)?Buffer.from(value):Buffer.from(value)]);
 const clx=Buffer.alloc(21);clx[0]=2;clx.writeUInt32LE(16,1);clx.writeUInt32LE(content.length,9);clx.writeUInt32LE(1024,15);part(33,clx);
 function style(id,kind,base,name,pap,chp){const head=Buffer.alloc(10);head.writeUInt16LE(id);head.writeUInt16LE((base<<4)|kind,2);head.writeUInt16LE(kind===1?2:1,4);const n=Buffer.from(name+'\0','utf16le');const upx=bytes=>Buffer.concat([u16(bytes.length),bytes,Buffer.alloc(bytes.length%2)]);const value=Buffer.concat([head,u16(name.length),n,...(kind===1?[upx(Buffer.concat([u16(id),pap]))]:[]),upx(chp)]);return Buffer.concat([u16(value.length),value,Buffer.alloc(value.length%2)]);}
 const header=Buffer.alloc(20);header.writeUInt16LE(18);header.writeUInt16LE(3,2);header.writeUInt16LE(10,4);if(mixedFonts)header.writeUInt16LE(1,16);
 part(1,Buffer.concat([header,style(0,1,0xfff,'Normal',Buffer.alloc(0),prop(0x4a43,u16(26))),style(1,1,0,'Heading 1',prop(0x2403,[1]),Buffer.concat([prop(0x0835,[1]),prop(0x4a43,u16(40))])),style(2,2,0xfff,'Emphasis',Buffer.alloc(0),prop(0x0836,[1]))]));
 const name=Buffer.from('Courier New\0','utf16le'),ffn=Buffer.alloc(40+name.length);ffn[0]=ffn.length-1;name.copy(ffn,40);const eastName=Buffer.from('仿宋_GB2312\0','utf16le'),eastFont=Buffer.alloc(40+eastName.length);eastFont[0]=eastFont.length-1;eastName.copy(eastFont,40);part(15,Buffer.concat([u16(mixedFonts?2:1),u16(0),ffn,...(mixedFonts?[eastFont]:[])]));
 const tdef=Buffer.alloc(47);tdef[0]=2;tdef.writeInt16LE(2400,3);tdef.writeInt16LE(6000,5);for(let i=0;i<2;i++)for(let j=0;j<4;j++){tdef[7+i*20+4+j*4]=8;tdef[7+i*20+5+j*4]=1;tdef[7+i*20+6+j*4]=1;}
 const inTable=prop(0x2416,[1]);
 const pap=[{id:1,data:Buffer.alloc(0)},{id:0,data:Buffer.concat([prop(0x840f,u16(720)),prop(0x8411,u16(360)),prop(0xa414,u16(240))])},{id:0,data:Buffer.concat([prop(0x460b,u16(1)),prop(0x260a,[0])])},{id:0,data:inTable},{id:0,data:inTable},{id:0,data:Buffer.concat([inTable,prop(0x2417,[1]),prop(0xd608,Buffer.concat([u16(tdef.length+1),tdef]))])},{id:0,data:Buffer.alloc(0)}];
 let cp=0;const boundaries=[1024];for(const p of paragraphs){cp+=p.length;boundaries.push(1024+cp*2);}
 function fkp(page,bounds,values,pap){const f=Buffer.alloc(512);bounds.forEach((n,i)=>f.writeUInt32LE(n,i*4));f[511]=values.length;let free=510;values.forEach((v,i)=>{let bytes;if(pap){const data=Buffer.concat([u16(v.id),v.data]);bytes=data.length%2?Buffer.concat([Buffer.from([(data.length+1)/2]),data]):Buffer.concat([Buffer.from([0,data.length/2]),data]);}else bytes=Buffer.concat([Buffer.from([v.length]),v]);free=(free-bytes.length)&~1;bytes.copy(f,free);f[(values.length+1)*4+i*(pap?13:1)]=free/2;});f.copy(body,page*512);return Buffer.concat([u32(bounds[0]),u32(bounds.at(-1)),u32(page)]);}
 part(13,fkp(4,boundaries,pap,true));
 const hidden=content.indexOf('Hidden'),emphasis=content.indexOf('body'),cb=[1024,1024+emphasis*2,1024+(emphasis+4)*2,1024+hidden*2,1024+(hidden+6)*2,1024+content.length*2];
 part(12,fkp(5,cb,[Buffer.alloc(0),prop(0x4a30,u16(2)),Buffer.alloc(0),prop(0x083c,[1]),Buffer.alloc(0)],false));
 const lst=Buffer.alloc(30);lst.writeUInt16LE(1);lst.writeUInt32LE(101,2);lst[28]=1;part(73,lst);
 const lvl=Buffer.alloc(28);lvl.writeUInt32LE(1);lvl[15]=1;const pattern=Buffer.from('\0.','utf16le');Buffer.concat([lvl,u16(2),pattern]).copy(table,at);at+=34;
 const lfo=Buffer.alloc(24);lfo.writeUInt32LE(1);lfo.writeUInt32LE(101,4);part(74,lfo);
 return {WordDocument:body,'1Table':table};
}
export function styledXls(XLSX){
 const book=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([['Styled workbook',1234.5],['Merged']]);sheet.B1.z='#,##0.00';sheet['!merges']=[{s:{r:1,c:0},e:{r:1,c:1}}];XLSX.utils.book_append_sheet(book,sheet,'Styled');
 const file=XLSX.CFB.read(new Uint8Array(XLSX.write(book,{bookType:'biff8',type:'array'})),{type:'array'}),stream=Buffer.from(XLSX.CFB.find(file,'Workbook').content);
 for(let at=0;at+4<=stream.length;){const id=stream.readUInt16LE(at),length=stream.readUInt16LE(at+2),pos=at+4;
  if(id===0x31){stream.writeUInt16LE(320,pos);stream.writeUInt16LE(2,pos+2);stream.writeUInt16LE(10,pos+4);stream.writeUInt16LE(700,pos+6);stream[pos+10]=1;}
  if(id===0xe0){stream[pos+6]=0x1a;stream[pos+9]=0x78;stream.writeUInt32LE(0x00001111,pos+10);stream.writeUInt32LE(1<<26,pos+14);stream.writeUInt16LE(13,pos+18);}
  at+=4+length;
 }
 return cfbFile(XLSX,{Workbook:stream});
}
export function formattedPresentationStreams(){
 const u16=n=>{const b=Buffer.alloc(2);b.writeUInt16LE(n);return b;},u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
 const content='Positioned title',header=record(3999,u32(0)),tx=record(4000,Buffer.from(content,'utf16le'));
 const textStyle=record(4001,Buffer.concat([u32(content.length+1),u16(0),u32(2048|4096),u16(1),u16(150),u32(content.length+1),u32(1|0x10000|0x20000|0x40000),u16(1),u16(0),u16(28),u32(0xfe663300)]));
 const anchor=record(0xf010,Buffer.concat([u16(288),u16(576),u16(5184),u16(1440)]));
 const options=Buffer.alloc(6);options.writeUInt16LE(385);options.writeUInt32LE(0x00eeddcc,2);
 const shape=record(0xf004,Buffer.concat([record(0xf00a,Buffer.concat([u32(1),u32(0)]),1),anchor,record(0xf00b,options,1),record(0xf00d,Buffer.concat([header,tx,textStyle]))]),0,true);
 const slide=record(1006,record(1036,record(0xf002,shape,0,true),0,true),0,true);
 const persist=Buffer.alloc(20);persist.writeUInt32LE(2);const size=Buffer.alloc(40);size.writeInt32LE(5760);size.writeInt32LE(4320,4);
 const font=Buffer.alloc(68);Buffer.from('Arial\0','utf16le').copy(font);
 const doc=record(1000,Buffer.concat([record(1001,size),record(4023,font),record(4080,record(1011,persist),0,true)]),0,true);
 const ptr=record(6002,Buffer.concat([u32((2<<20)|1),u32(slide.length),u32(0)])),editBody=Buffer.alloc(28);editBody.writeUInt32LE(slide.length+doc.length,12);editBody.writeUInt32LE(1,16);
 const editAt=slide.length+doc.length+ptr.length,current=Buffer.alloc(28);current.writeUInt16LE(4086,2);current.writeUInt32LE(20,4);current.writeUInt32LE(0xe391c05f,12);current.writeUInt32LE(editAt,16);
 return {'PowerPoint Document':Buffer.concat([slide,doc,ptr,record(4085,editBody)]),'Current User':current};
}
