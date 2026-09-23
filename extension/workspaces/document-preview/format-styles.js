// The worker sends data, never executable document CSS. Both properties and
// their values are restricted here before they reach the sandbox stylesheet.
const lengths = /^-?\d{1,4}(?:\.\d{1,3})?(?:pt|em|%)$/;
const fonts = /^(?:"[\p{L}\p{N} ._+-]{1,80}",){1,8}(?:serif|sans-serif|monospace)$/u;
const values = {
  'tab-size':/^\d{1,4}(?:\.\d{1,3})?pt$/,
  'list-style-type':/^(?:decimal|lower-alpha|upper-alpha|lower-roman|upper-roman)$/,
  position:/^absolute$/, overflow:/^hidden$/, 'white-space':/^(?:pre-wrap|nowrap)$/,
  transform:/^rotate\(-?\d{1,3}(?:\.\d{1,3})?deg\)$/,
  'font-family':fonts,'font-size':/^\d{1,2}(?:\.\d{1,3})?pt$/,'font-weight':/^(?:400|700)$/,
  'font-style':/^(?:normal|italic)$/,'font-variant-caps':/^(?:normal|small-caps)$/,
  'text-decoration-line':/^(?:none|underline|line-through|underline line-through)$/,
  'text-decoration-style':/^(?:solid|double|dotted|dashed|wavy)$/,
  'text-transform':/^(?:none|uppercase)$/,'text-align':/^(?:left|right|center|justify|start|end)$/,
  direction:/^(?:ltr|rtl)$/,'vertical-align':/^(?:top|middle|bottom)$/,'table-layout':/^(?:auto|fixed)$/,
  'line-height':/^(?:\d{1,3}(?:\.\d{1,3})?(?:pt)?|max\(1\.2em,\d{1,3}(?:\.\d{1,3})?pt\))$/
};
for(const property of ['width','min-width','max-width','height','min-height','left','top','border-radius','text-indent','letter-spacing',...['top','bottom','left','right'].flatMap(side=>['margin-'+side,'padding-'+side])])values[property]=lengths;
for(const side of ['top','bottom','left','right']){
  values['border-'+side+'-width']=lengths;
  values['border-'+side+'-style']=/^(?:none|solid|double|dotted|dashed)$/;
}
const colorValue=/^(?:#[a-f\d]{6}|inherit|transparent)$/i;
export const DOCUMENT_DARK_TEXT = '#f1f3f4';
function darkColor(value,kind) {
  if(!value.startsWith('#'))return value;
  const rgb=value.slice(1).match(/../g).map(part=>parseInt(part,16));
  // Neutral document text uses the same white as the preview filename.
  if(kind==='color'&&Math.max(...rgb)-Math.min(...rgb)<=12)return DOCUMENT_DARK_TEXT;
  const light=rgb.reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0)/255;
  const target=kind==='background-color'?.16:kind.startsWith('border-')?.48:.82;
  const amount=kind==='background-color'?(light>target?1-target/light:0):(light<target?(target-light)/(1-light):0);
  const mixed=rgb.map(c=>kind==='background-color'?c*(1-amount):c+(255-c)*amount);
  return '#'+mixed.map(c=>Math.round(c).toString(16).padStart(2,'0')).join('');
}
export function acceptedStyles(formatting) {
  if(!Array.isArray(formatting?.styles)||formatting.styles.length>8192)return [];
  return formatting.styles.map(style=>{
    if(!style||typeof style!=='object'||Object.keys(style).length>64)return {};
    return Object.fromEntries(Object.entries(style).filter(([key,val])=>{
      if(typeof val!=='string'||val.length>800)return false;
      if(key==='color'||key==='background-color'||/^border-(?:top|bottom|left|right)-color$/.test(key))return colorValue.test(val);
      if((key==='margin-left'||key==='margin-right')&&val==='auto')return true;
      return Object.hasOwn(values,key)&&values[key].test(val);
    }));
  });
}
export function formatStylesheet(formatting) {
  const styles=acceptedStyles(formatting),light=[],dark=[];
  for(let index=0;index<styles.length;index++) {
    const normal=[],night=[];
    for(const [key,value] of Object.entries(styles[index])) {
      normal.push(key+':'+value);
      if(key==='color'||key==='background-color'||key.endsWith('-color'))night.push(key+':'+darkColor(value,key));
    }
    // Authored document properties outrank family defaults such as .cg-shape p
    // and .cg-sheet td without accepting arbitrary selectors or !important.
    const selector='.cg-f'+index+'.cg-f'+index;
    if(normal.length)light.push(selector+'{'+normal.join(';')+'}');
    if(night.length)dark.push(selector+'{'+night.join(';')+'}');
  }
  const page=formatting?.page||{},paper=[];
  for(const [property,key] of [['max-width','width'],['padding-top','top'],['padding-bottom','bottom'],['padding-left','left'],['padding-right','right']]) {
    if(typeof page[key]==='string'&&/^\d{1,4}(?:\.\d{1,3})?pt$/.test(page[key])) {
      const num=parseFloat(page[key]);
      if((key==='width'&&num>=216&&num<=1440)||(key!=='width'&&num<=144))paper.push(property+':'+page[key]);
    }
  }
  return 'body{'+paper.join(';')+'}'+light.join('')+'@media(prefers-color-scheme:dark){'+dark.join('')+'}';
}
