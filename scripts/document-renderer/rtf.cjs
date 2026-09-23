const {localFont:fontFamily}=require('./fonts.cjs');
const {esc,styles}=require('./office-package.cjs');
const ignored=new Set('fonttbl colortbl stylesheet info pict object objdata filetbl listtable listoverridetable generator datafield datastore themedata colorschememapping xmlnstbl latentstyles fldinst header headerl headerr footer footerl footerr annotation atnauthor atnid nextfile template shppict nonshppict shp background htmltag'.split(' '));
function rtf(input) {
  const bytes=new Uint8Array(input);if(bytes.length<6)throw Error('invalidDocument');
  const chunks=[];for(let at=0;at<bytes.length;at+=8192)chunks.push(String.fromCharCode(...bytes.subarray(at,at+8192)));
  const source=chunks.join('');
  if(!/^\{\\rtf[12]\b/.test(source))throw Error('invalidDocument');
  const registered=styles(),stack=[],fonts=new Map(),fontNames=new Map(),colors=[];
  const page={width:'612pt',left:'72pt',right:'72pt',top:'72pt',bottom:'72pt'};let rowCells=[],cellStyle={},cellEdge=0,rowHeight=0;
  let state={skip:false,uc:1,cp:1252,font:0,b:false,i:false,u:false,s:false,fs:22,align:'left',hidden:false},fallback=0,raw=[],text='',run='',paragraph='',html='',cells=[],rows=[],count=0;
  // Tables contain declarations only; limit their span and never evaluate any
  // embedded destination, even when a document disguises it as a font name.
  function destination(name){
    const match=new RegExp('\\\\'+name+'\\b').exec(source);if(!match)return '';
    let depth=1,end=match.index+match[0].length;
    for(;end<source.length&&end-match.index<1024*1024;end++){
      if(source[end]==='\\'){end++;continue;}
      if(source[end]==='{')depth++;else if(source[end]==='}'&&!--depth)return source.slice(match.index,end);
    }return '';
  }
  const fontTable=destination('fonttbl');
  for(const m of fontTable.matchAll(/\\f(\d+)[^{}]{0,2048}?\\fcharset(\d+)/g))fonts.set(Number(m[1]),({0:1252,128:932,129:949,134:936,136:950,161:1253,162:1254,163:1258,177:1255,178:1256,186:1257,204:1251,222:874,238:1250})[m[2]]||1252);
  for(const m of fontTable.matchAll(/\\f(\d+)\b([^;]{0,2048});/g)){
    if(fontNames.size>4096)throw Error('documentTooComplex');
    const name=m[2].replace(/\\u(-?\d+)\??/g,(_,n)=>String.fromCharCode(Number(n)&65535)).replace(/\\[a-z]+-?\d* ?|[{}]/gi,'').trim();fontNames.set(Number(m[1]),name);
  }
  for(const item of destination('colortbl').split(';').slice(0,4096)){
    const channel=name=>Number(item.match(new RegExp('\\\\'+name+'(\\d+)'))?.[1]||0);
    colors.push(/\\(?:red|green|blue)/.test(item)?'#'+['red','green','blue'].map(k=>Math.min(255,channel(k)).toString(16).padStart(2,'0')).join(''):undefined);
  }
  const decoders=new Map();
  function flushRaw(){if(raw.length){const cp=fonts.get(state.font)||state.cp;const encoding=({65001:'utf-8',932:'shift_jis',936:'gbk',949:'euc-kr',950:'big5',874:'windows-874'})[cp]||'windows-'+cp;let decoder=decoders.get(encoding);if(!decoder){try{decoder=new TextDecoder(encoding);}catch{decoder=new TextDecoder('windows-1252');}if(decoders.size<32)decoders.set(encoding,decoder);}text+=decoder.decode(new Uint8Array(raw));raw=[];}}
  function flush(){flushRaw();if(!text)return;
    const css={'font-family':fontFamily([fontNames.get(state.font)],'serif'),'font-weight':state.b?'700':'400','font-style':state.i?'italic':'normal','font-size':Math.min(72,Math.max(6,state.fs/2))+'pt',color:colors[state.cf],
      'background-color':colors[state.highlight],'text-decoration-line':[state.u?'underline':'',state.s?'line-through':''].filter(Boolean).join(' ')||'none'};
    const tag=state.script===1?'sup':state.script===2?'sub':'span';run+='<'+tag+' class="'+registered.add(css)+'">'+esc(text)+'</'+tag+'>';text='';if(++count>100000)throw Error('documentTooComplex');
  }
  const twips=n=>Math.max(-14400,Math.min(28800,n))/20+'pt';
  function para(){flush();const css={'text-align':state.align,direction:state.rtl?'rtl':undefined,'margin-top':'0pt','margin-bottom':'0pt'};
    for(const [key,prop]of Object.entries({li:'margin-left',ri:'margin-right',fi:'text-indent',sb:'margin-top',sa:'margin-bottom'}))if(state[key]!==undefined)css[prop]=twips(state[key]);
    if(state.sl)css['line-height']=state.slmult?String(Math.max(.5,Math.min(10,state.sl/240))):twips(Math.abs(state.sl));
    paragraph+='<p class="'+registered.add(css)+'">'+run+'</p>';run='';
  }
  function finishTable(){if(cells.length){rows.push('<tr class="'+registered.add({height:rowHeight?twips(Math.abs(rowHeight)):undefined})+'">'+cells.join('')+'</tr>');cells=[];}if(rows.length){html+='<table>'+rows.join('')+'</table>';rows=[];}}
  function emit(value,byte=false){if(state.skip||state.hidden)return;if(fallback){fallback--;return;}if(byte)raw.push(value);else{flushRaw();text+=value;}}
  for(let at=0;at<source.length;){
    const ch=source[at++];
    if(ch==='{'){flush();if(stack.length>=100)throw Error('documentTooComplex');stack.push({...state});continue;}
    if(ch==='}'){flush();if(!stack.length)throw Error('invalidDocument');state=stack.pop();fallback=0;continue;}
    if(ch!=='\\'){if(ch!=='\n'&&ch!=='\r')emit(ch.charCodeAt(0),true);continue;}
    const symbol=source[at++];if(symbol===undefined)throw Error('invalidDocument');
    if(symbol==="'"){const hex=source.slice(at,at+2);if(!/^[\da-f]{2}$/i.test(hex))throw Error('invalidDocument');at+=2;emit(parseInt(hex,16),true);continue;}
    if(symbol==='\\'||symbol==='{'||symbol==='}'){emit(symbol);continue;}
    if(symbol==='*'){flush();state.skip=true;continue;}
    if(!/[a-z]/i.test(symbol)){if(symbol==='~')emit('\u00a0');else if(symbol==='_')emit('‑');else if(symbol==='-')emit('\u00ad');continue;}
    let word=symbol;while(at<source.length&&/[a-z]/i.test(source[at]))word+=source[at++];
    let number='';if(source[at]==='-')number+=source[at++];while(at<source.length&&/\d/.test(source[at]))number+=source[at++];if(source[at]===' ')at++;
    const n=number&&number!=='-'?Number(number):1;
    if(!Number.isFinite(n))throw Error('invalidDocument');
    if(word==='bin'){if(n<0||at+n>source.length)throw Error('invalidDocument');at+=n;continue;}
    if(ignored.has(word)){flush();state.skip=true;continue;}
    if(state.skip)continue;
    if(word==='u'){flushRaw();if(!state.hidden)text+=String.fromCharCode(n&65535);fallback=state.uc;continue;}
    if(word==='uc'){state.uc=Math.min(32,Math.max(0,n));continue;}
    if(['par','line','tab','cell','row','page','sect'].includes(word)){
      if(fallback){fallback--;continue;}
      if(word==='line'||word==='tab'){emit(word==='line'?'\n':'\t');continue;}
      para();
      if(word==='cell'){cells.push('<td class="'+registered.add(rowCells[cells.length]||{})+'">'+paragraph+'</td>');paragraph='';}
      else if(word==='row'){if(paragraph&&/<span/.test(paragraph)){cells.push('<td class="'+registered.add(rowCells[cells.length]||{})+'">'+paragraph+'</td>');}paragraph='';rows.push('<tr class="'+registered.add({height:rowHeight?twips(Math.abs(rowHeight)):undefined})+'">'+cells.join('')+'</tr>');cells=[];}
      else if(!state.intbl){finishTable();html+=paragraph;paragraph='';if(word==='page'||word==='sect')html+='<hr class="cg-page-break">';}
      continue;
    }
    const chars={emdash:'—',endash:'–',bullet:'•',lquote:'‘',rquote:'’',ldblquote:'“',rdblquote:'”'};if(chars[word]){emit(chars[word]);continue;}
    flush();
    if(['b','i','ul','strike'].includes(word))state[({ul:'u',strike:'s'})[word]||word]=n!==0;
    else if(word==='ulnone')state.u=false;
    else if(word==='fs')state.fs=n;
    else if(word==='f')state.font=n;
    else if(word==='ansicpg')state.cp=n;
    else if(word==='intbl')state.intbl=n!==0;
    else if(word==='plain')Object.assign(state,{b:false,i:false,u:false,s:false,fs:22,font:0,cf:0,highlight:0,script:0,hidden:false});
    else if(word==='pard')Object.assign(state,{intbl:false,align:'left',li:0,ri:0,fi:0,sa:0,sb:0,sl:0,slmult:0,rtl:false});
    else if(['ql','qr','qc','qj'].includes(word))state.align=({ql:'left',qr:'right',qc:'center',qj:'justify'})[word];
    else if(word==='v')state.hidden=n!==0;
    else if(['cf','highlight','li','ri','fi','sa','sb','sl','slmult'].includes(word))state[word]=n;
    else if(word==='rtlpar'||word==='ltrpar')state.rtl=word==='rtlpar';
    else if(['super','sub','nosupersub'].includes(word))state.script=word==='super'?1:word==='sub'?2:0;
    else if(['paperw','margl','margr','margt','margb'].includes(word)){const key={paperw:'width',margl:'left',margr:'right',margt:'top',margb:'bottom'}[word];page[key]=Math.max(key==='width'?216:0,Math.min(key==='width'?1440:144,n/20))+'pt';}
    else if(word==='trowd'){rowCells=[];cellStyle={};cellEdge=0;rowHeight=0;state.border=null;}
    else if(word==='trrh')rowHeight=n;
    else if(word==='cellx'){if(rowCells.length>=256)throw Error('documentTooComplex');rowCells.push({...cellStyle,width:twips(Math.max(0,n-cellEdge))});cellEdge=n;cellStyle={};state.border=null;}
    else if(word==='clcbpat')cellStyle['background-color']=colors[n];
    else if(['clvertalt','clvertalc','clvertalb'].includes(word))cellStyle['vertical-align']={clvertalt:'top',clvertalc:'middle',clvertalb:'bottom'}[word];
    else if(/^clbrdr[tblr]$/.test(word))state.border={t:'top',b:'bottom',l:'left',r:'right'}[word.at(-1)];
    else if(state.border&&/^brdr/.test(word)){
      const prefix='border-'+state.border+'-';
      if(word==='brdrw')cellStyle[prefix+'width']=Math.min(12,Math.max(0,n/20))+'pt';
      else if(word==='brdrcf')cellStyle[prefix+'color']=colors[n];
      else if(['brdrs','brdrdb','brdrdot','brdrdash','brdrnil','brdrnone'].includes(word))cellStyle[prefix+'style']={brdrs:'solid',brdrdb:'double',brdrdot:'dotted',brdrdash:'dashed',brdrnil:'none',brdrnone:'none'}[word];
    }
  }
  if(stack.length)throw Error('invalidDocument');para();finishTable();html+=paragraph;
  if(html.length>32*1024*1024)throw Error('documentTooLarge');
  return {value:html,formatting:{styles:registered.values,page}};
}
module.exports={rtf};
