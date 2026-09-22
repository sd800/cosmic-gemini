const {children,first,attr,value,properties,merge,number} = require('./properties.cjs');
function roman(value) {
  let out = '';
  for (const [n,s] of [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']]) while(value >= n){out+=s;value-=n;}
  return out;
}
function chinese(value, legal) {
  if (value < 0 || value > 9999) return String(value);
  const digits = legal ? '零壹贰叁肆伍陆柒捌玖' : '零一二三四五六七八九', units = legal ? ['','拾','佰','仟'] : ['','十','百','千'];
  if(!value) return digits[0];
  let text='', zero=false;
  for(let power=3;power>=0;power--){const digit=Math.floor(value/10**power)%10;if(digit){if(zero)text+=digits[0];text+=digits[digit]+units[power];zero=false;}else if(text)zero=true;}
  return legal ? text : text.replace(/^一十/,'十');
}
function formatted(value, type) {
  value = Math.max(0,Math.min(999999,value));
  if(type==='upperRoman'||type==='lowerRoman') {const text=value > 3999 || !value ? String(value):roman(value);return type==='lowerRoman'?text.toLowerCase():text;}
  if(type==='upperLetter'||type==='lowerLetter'){let n=value,out='';while(n>0){n--;out=String.fromCharCode(65+n%26)+out;n=Math.floor(n/26);}return type==='lowerLetter'?out.toLowerCase():out;}
  if(['chineseCounting','chineseCountingThousand','ideographTraditional','chineseLegalSimplified'].includes(type))return chinese(value,type==='chineseLegalSimplified');
  return type==='decimalZero' ? String(value).padStart(2,'0') : String(value);
}
function createNumbering(root, getStyle) {
  const abstracts=new Map(children(root,'w:abstractNum').map(node=>[attr(node,'abstractNumId'),node]));
  const nums=new Map(children(root,'w:num').map(node=>[attr(node,'numId'),node]));
  const cache=new Map(),counts=new Map();
  function levels(id, visited=new Set()) {
    if(cache.has(id))return cache.get(id);
    if(visited.has(id)||visited.size>16)return new Map();
    visited.add(id);
    const num=nums.get(id),abstract=abstracts.get(value(num,'abstractNumId'));
    let result=new Map();
    const linked=value(abstract,'numStyleLink');
    if(linked)result=new Map(levels(getStyle(linked,'numbering').p?.numPr?.numId?.val,visited));
    for(const node of children(abstract,'w:lvl'))result.set(Number(attr(node,'ilvl')),readLevel(node));
    for(const override of children(num,'w:lvlOverride')) {
      const level=Number(attr(override,'ilvl')),node=first(override,'w:lvl');
      let spec=node?readLevel(node):result.get(level);
      const start=value(override,'startOverride');
      if(spec)result.set(level,{...spec,...(start!=null?{start:number(start,0,999999)}:{})});
    }
    cache.set(id,result);return result;
  }
  function readLevel(node){return {start:number(value(node,'start')??'1',0,999999),format:value(node,'numFmt')||'decimal',text:value(node,'lvlText'),suffix:value(node,'suff')||'tab',restart:number(value(node,'lvlRestart'),0,9),legal:!!first(node,'w:isLgl'),p:properties(first(node,'w:pPr')),r:properties(first(node,'w:rPr'))};}
  function resolve(p) {
    const id=p.numPr?.numId?.val, level=number(p.numPr?.ilvl?.val??'0',0,8);
    if(!id || id==='0')return null;
    const all=levels(id),spec=all.get(level);
    return spec?{id,level,all,spec}:null;
  }
  function next(info,part) {
    const {id,level,all,spec}=info,key=part+':'+id;
    const state=counts.get(key)||[];
    state[level]=state[level]==null?spec.start:state[level]+1;
    for(let child=level+1;child<9;child++) {
      const restart=all.get(child)?.restart;
      if(restart!==0 && level <= (restart==null?child-1:restart-1))state[child]=undefined;
    }
    counts.set(key,state);
    let label=spec.text??('%'+(level+1)+'.');
    if(spec.format==='none')label='';
    else if(spec.format==='bullet')label=({'\uf0b7':'•','\uf0a7':'▪','\uf0d8':'➢','o':'○'}[label]||label);
    else label=label.replace(/%([1-9])/g,(_,digit)=>{const index=Number(digit)-1,ref=all.get(index);return formatted(state[index]??ref?.start??1,spec.legal?'decimal':ref?.format||'decimal');});
    return {label:label.slice(0,120),suffix:spec.suffix,r:spec.r};
  }
  return {resolve,next};
}
module.exports={createNumbering,formatted};
