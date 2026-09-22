const {esc,styles}=require('./office-package.cjs');
const ignored=new Set('fonttbl colortbl stylesheet info pict object objdata filetbl listtable listoverridetable generator datafield datastore themedata colorschememapping xmlnstbl latentstyles fldinst header headerl headerr footer footerl footerr annotation atnauthor atnid nextfile template shppict nonshppict shp background htmltag'.split(' '));
function rtf(input) {
  const bytes=new Uint8Array(input);if(bytes.length<6)throw Error('invalidDocument');
  const chunks=[];for(let at=0;at<bytes.length;at+=8192)chunks.push(String.fromCharCode(...bytes.subarray(at,at+8192)));
  const source=chunks.join('');
  if(!/^\{\\rtf[12]\b/.test(source))throw Error('invalidDocument');
  const registered=styles(),stack=[],fonts=new Map();let state={skip:false,uc:1,cp:1252,font:0,b:false,i:false,u:false,s:false,fs:22,align:'left'},fallback=0,raw=[],text='',run='',paragraph='',html='',cells=[],rows=[],count=0;
  // Font tables contain codepage hints even when their visible content is skipped.
  for(const m of source.matchAll(/\\f(\d+)[^{}]{0,2048}?\\fcharset(\d+)/g))fonts.set(Number(m[1]),({0:1252,128:932,129:949,134:936,136:950,161:1253,162:1254,163:1258,177:1255,178:1256,186:1257,204:1251,222:874,238:1250})[m[2]]||1252);
  function flushRaw(){if(raw.length){const cp=fonts.get(state.font)||state.cp;const encoding=({65001:'utf-8',932:'shift_jis',936:'gbk',949:'euc-kr',950:'big5',874:'windows-874'})[cp]||'windows-'+cp;try{text+=new TextDecoder(encoding).decode(new Uint8Array(raw));}catch{text+=new TextDecoder('windows-1252').decode(new Uint8Array(raw));}raw=[];}}
  function flush(){flushRaw();if(!text)return;const css={'font-weight':state.b?'700':undefined,'font-style':state.i?'italic':undefined,'font-size':Math.min(72,Math.max(6,state.fs/2))+'pt','text-decoration-line':[state.u?'underline':'',state.s?'line-through':''].filter(Boolean).join(' ')};const cl=registered.add(css);run+='<span class="'+cl+'">'+esc(text)+'</span>';text='';if(++count>100000)throw Error('documentTooComplex');}
  function para(){flush();paragraph+='<p class="'+registered.add({'text-align':state.align})+'">'+run+'</p>';run='';}
  function finishTable(){if(cells.length){rows.push('<tr>'+cells.join('')+'</tr>');cells=[];}if(rows.length){html+='<table>'+rows.join('')+'</table>';rows=[];}}
  function emit(value,byte=false){if(state.skip)return;if(fallback){fallback--;return;}if(byte)raw.push(value);else{flushRaw();text+=value;}}
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
    if(word==='u'){flushRaw();text+=String.fromCharCode(n&65535);fallback=state.uc;continue;}
    if(word==='uc'){state.uc=Math.min(32,Math.max(0,n));continue;}
    if(['par','line','tab','cell','row','page','sect'].includes(word)){
      if(fallback){fallback--;continue;}
      if(word==='line'||word==='tab'){emit(word==='line'?'\n':'\t');continue;}
      para();
      if(word==='cell'){cells.push('<td>'+paragraph+'</td>');paragraph='';}
      else if(word==='row'){if(paragraph&&/<span/.test(paragraph)){cells.push('<td>'+paragraph+'</td>');}paragraph='';rows.push('<tr>'+cells.join('')+'</tr>');cells=[];}
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
    else if(word==='plain')Object.assign(state,{b:false,i:false,u:false,s:false,fs:22,font:0});
    else if(word==='pard')Object.assign(state,{intbl:false,align:'left'});
    else if(['ql','qr','qc','qj'].includes(word))state.align=({ql:'left',qr:'right',qc:'center',qj:'justify'})[word];
    else if(word==='v')state.skip=n!==0;
  }
  if(stack.length)throw Error('invalidDocument');para();finishTable();html+=paragraph;
  if(html.length>32*1024*1024)throw Error('documentTooLarge');
  return {value:html,formatting:{styles:registered.values}};
}
module.exports={rtf};
