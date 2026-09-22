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
