const unzip = require('mammoth/lib/unzip');
const xml = require('mammoth/lib/xml');
const NS = {};
for (const name of ['office','text','style','table','presentation','manifest']) NS['urn:oasis:names:tc:opendocument:xmlns:'+name+':1.0'] = name;
for (const [name,prefix] of [['drawing','draw'],['xsl-fo-compatible','fo'],['svg-compatible','svg'],['datastyle','number']]) NS['urn:oasis:names:tc:opendocument:xmlns:'+name+':1.0'] = prefix;
NS['http://www.w3.org/1999/xlink'] = 'xlink';
for (const [name, prefix] of [['spreadsheetml','s'],['presentationml','p'],['drawingml','a']]) {
  NS['http://schemas.openxmlformats.org/'+name+'/2006/main'] = prefix;
  NS['http://purl.oclc.org/ooxml/'+name+'/main'] = prefix;
}
NS['http://schemas.openxmlformats.org/officeDocument/2006/relationships'] = 'r';
NS['http://purl.oclc.org/ooxml/officeDocument/relationships'] = 'r';
NS['http://schemas.openxmlformats.org/package/2006/relationships'] = 'rels';
NS['http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing'] = 'xdr';
NS['http://purl.oclc.org/ooxml/drawingml/spreadsheetDrawing'] = 'xdr';
const first = (node,name) => node?.children?.find(child => child.name === name);
const children = (node,name) => (node?.children || []).filter(child => child.name === name);
function all(node,name,out = []) {
  if (node?.name === name) out.push(node);
  for (const child of node?.children || []) if (child.type === 'element') all(child,name,out);
  return out;
}
function text(node) { return node?.type === 'text' ? node.value : (node?.children || []).map(text).join(''); }
const attr = (node,key,otherwise='') => node?.attributes?.[key] ?? otherwise;
const esc = value => String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const num = (value,fallback=0,min=-36576000,max=36576000) => Number.isFinite(Number(value)) && value !== '' && value != null ? Math.min(max,Math.max(min,Number(value))) : fallback;
const pt = value => String(Math.round(value*1000)/1000)+'pt';
const on = (node,key='val') => !!node && !['0','false','off'].includes(attr(node,key,'1'));
function resolvePart(base,target) {
  if (!target || /[\\\x00-\x1f?#]|^[a-z][a-z0-9+.-]*:|^\/\//i.test(target)) return '';
  const segments = target.startsWith('/') ? [] : base.split('/').slice(0,-1);
  for (const segment of target.split('/')) {
    if (segment === '..') { if (!segments.length) return ''; segments.pop(); }
    else if (segment && segment !== '.') segments.push(segment);
  }
  return segments.join('/');
}
function styles() {
  const values=[], keys=new Map();
  return {
    values,
    add(style) {
      const clean=Object.fromEntries(Object.entries(style).filter(([,value])=>value != null && value !== ''));
      const key=JSON.stringify(clean);if(key==='{}')return '';
      if(!keys.has(key)){if(values.length>=8192)throw Error('documentTooComplex');keys.set(key,'cg-f'+values.length);values.push(clean);}
      return keys.get(key);
    }
  };
}
async function openPackage(buffer) {
  const zip=await unzip.openZip({arrayBuffer:buffer}), cache=new Map(),images=new Map();
  async function read(path) {
    if(!path || !zip.exists(path))return null;
    if(!cache.has(path))cache.set(path,(async()=>{
      const source=await zip.read(path,'utf-8');
      if(source.length>16*1024*1024 || /<!DOCTYPE|<!ENTITY/i.test(source))throw Error('invalidDocument');
      const tree=await xml.readString(source,NS);
      let count=0;
      function check(node,depth=0){if(++count>250000||depth>80)throw Error('documentTooComplex');for(const child of node?.children||[])check(child,depth+1);}
      check(tree);return tree;
    })());
    return cache.get(path);
  }
  async function relations(path) {
    const split=path.lastIndexOf('/'), directory=path.slice(0,split+1), filename=path.slice(split+1);
    const root=await read(directory+'_rels/'+filename+'.rels');
    const result=new Map();
    for(const rel of children(root,'rels:Relationship')) {
      const external=attr(rel,'TargetMode').toLowerCase()==='external';
      result.set(attr(rel,'Id'),{type:attr(rel,'Type').split('/').pop(),path:external?'':resolvePart(path,attr(rel,'Target')),external});
    }
    return result;
  }
  async function readImage(path) {
    const type={png:'png',jpg:'jpeg',jpeg:'jpeg',gif:'gif',webp:'webp'}[String(path).split('.').pop().toLowerCase()];
    if(!type || !zip.exists(path))return '';
    const bytes=await zip.read(path);
    if(bytes.length>8*1024*1024)return '';
    // Never allow XML/SVG or HTML to masquerade as a bitmap.
    const signatures={png:bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71,jpeg:bytes[0]===255&&bytes[1]===216&&bytes[2]===255,
      gif:bytes[0]===71&&bytes[1]===73&&bytes[2]===70,webp:bytes[0]===82&&bytes[1]===73&&bytes[8]===87&&bytes[9]===69};
    if(!signatures[type])return '';
    return 'data:image/'+type+';base64,'+await zip.read(path,'base64');
  }
  function image(path){if(!images.has(path))images.set(path,readImage(path));return images.get(path);}
  return {read,relations,image};
}
function theme(root) {
  const scheme=first(first(root,'a:themeElements'),'a:clrScheme'), colors={};
  for(const entry of scheme?.children||[]) {
    const value=entry.children?.find(node=>node.type==='element');
    const hex=attr(value,value?.name==='a:sysClr'?'lastClr':'val');
    if(/^[a-f0-9]{6}$/i.test(hex))colors[entry.name.split(':').pop()]='#'+hex;
  }
  return {dk1:'#000000',lt1:'#ffffff',dk2:'#202124',lt2:'#eeeeee',accent1:'#4472c4',accent2:'#ed7d31',...colors};
}
function drawingColor(root,colors) {
  const node=(root?.children||[]).find(n=>['a:srgbClr','a:schemeClr','a:sysClr'].includes(n.name));
  if(!node)return '';
  const value=attr(node,node.name==='a:sysClr'?'lastClr':'val');
  let color=node.name==='a:schemeClr'?(colors[value]||colors[value==='tx1'?'dk1':value==='bg1'?'lt1':value==='tx2'?'dk2':value==='bg2'?'lt2':value]):/^[a-f0-9]{6}$/i.test(value)?'#'+value:'';
  if(!color)return '';
  let rgb=color.slice(1).match(/../g).map(value=>parseInt(value,16));
  for(const change of node.children||[]) {
    const amount=num(attr(change,'val'),0,0,100000)/100000;
    if(change.name==='a:lumMod'||change.name==='a:shade')rgb=rgb.map(c=>c*amount);
    if(change.name==='a:lumOff')rgb=rgb.map(c=>c+255*amount);
    if(change.name==='a:tint')rgb=rgb.map(c=>c+(255-c)*amount);
  }
  return '#'+rgb.map(c=>Math.min(255,Math.max(0,Math.round(c))).toString(16).padStart(2,'0')).join('');
}
module.exports={first,children,all,text,attr,esc,num,pt,on,resolvePart,styles,openPackage,theme,drawingColor};
