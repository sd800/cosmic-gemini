const {first,children,all,text,attr,esc,num,pt,on,styles,openPackage,theme} = require('./office-package.cjs');
const {localFont:fontFamily}=require('./fonts.cjs');
const {DEFAULT_PALETTE}=require('./legacy-excel-format.cjs');
const {sheetGrid}=require('./sheet-grid.cjs');
const builtin={0:'General',1:'0',2:'0.00',3:'#,##0',4:'#,##0.00',9:'0%',10:'0.00%',11:'0.00E+00',14:'m/d/yy',15:'d-mmm-yy',16:'d-mmm',17:'mmm-yy',18:'h:mm AM/PM',19:'h:mm:ss AM/PM',20:'h:mm',21:'h:mm:ss',22:'m/d/yy h:mm',45:'mm:ss',46:'[h]:mm:ss',47:'mmss.0',49:'@'};
function coordinates(ref) {
  const match=String(ref).replace(/\$/g,'').match(/^([A-Z]{1,3})([1-9]\d{0,6})$/i);if(!match)return null;
  let column=0;for(const char of match[1].toUpperCase())column=column*26+char.charCodeAt(0)-64;
  return [Number(match[2])-1,column-1];
}
function columnName(index){let name='';for(index++;index;index=Math.floor((index-1)/26))name=String.fromCharCode(65+(index-1)%26)+name;return name;}
const numberFormatters=new Map();
function displayNumber(value,format,date1904) {
  const number=Number(value);if(!Number.isFinite(number)||!format||format==='General'||format==='@')return String(value);
  const sections=format.split(';'),pattern=sections[number<0?1:number===0&&sections.length>2?2:0]||sections[0];
  if(/^"[^"]*"$/.test(pattern))return pattern.slice(1,-1);
  const unquoted=pattern.replace(/"[^"]*"|\\.|\[(?!h+\])[^[\]]*\]/gi,'');
  if(/[ydh]/i.test(unquoted)||(/m/i.test(unquoted)&&/[s/\-]/i.test(unquoted))) {
    if(number<0||number>2958465)return String(value);
    const epoch=Date.UTC(date1904?1904:1899,date1904?0:11,date1904?1:number<60?31:30);
    const date=new Date(epoch+Math.round(number*86400000));
    if(!Number.isFinite(date.getTime()))return String(value);
    const pad=n=>String(n).padStart(2,'0');
    if(/\[h\]/i.test(pattern))return Math.floor(number*24)+':'+pad(date.getUTCMinutes())+':'+pad(date.getUTCSeconds());
    const hasDate=/[yd]/i.test(unquoted)||(/m/i.test(unquoted)&&!/[hs]/i.test(unquoted));
    const hasTime=/[hs]/i.test(unquoted);
    const day=!date1904&&Math.floor(number)===60?'1900-02-29':date.getUTCFullYear()+'-'+pad(date.getUTCMonth()+1)+'-'+pad(date.getUTCDate());
    const time=pad(date.getUTCHours())+':'+pad(date.getUTCMinutes())+(/s/i.test(unquoted)?':'+pad(date.getUTCSeconds()):'');
    return [hasDate?day:'',hasTime?time:''].filter(Boolean).join(' ');
  }
  if(/[eE][+-]0/.test(unquoted))return number.toExponential(Math.min(12,(unquoted.match(/\.([0#]+)/)?.[1]||'').length)).toUpperCase();
  if(!/[0#]/.test(unquoted))return String(value);
  const decimal=(unquoted.match(/\.([0#]+)/)?.[1]||'');
  const percentage=unquoted.includes('%'),symbol=pattern.match(/[$€£¥￥]/)?.[0]||'';
  const minimum=Math.min(12,(decimal.match(/0/g)||[]).length),maximum=Math.min(12,decimal.length),group=unquoted.includes(','),key=[minimum,maximum,group].join(':');
  if(!numberFormatters.has(key)){if(numberFormatters.size>=256)numberFormatters.delete(numberFormatters.keys().next().value);numberFormatters.set(key,new Intl.NumberFormat('en-US',{useGrouping:group,minimumFractionDigits:minimum,maximumFractionDigits:maximum}));}
  const separateNegative=number<0&&sections.length>1,amount=separateNegative?Math.abs(number):number;
  const formatted=numberFormatters.get(key).format(percentage?amount*100:amount);
  const parens=separateNegative&&pattern.includes('(')&&pattern.includes(')');
  return (parens?'(':separateNegative&&unquoted.includes('-')?'-':'')+symbol+formatted+(percentage?'%':'')+(parens?')':'');
}
async function spreadsheet(buffer) {
  const pkg=await openPackage(buffer), workbook=await pkg.read('xl/workbook.xml');
  if(workbook?.name!=='s:workbook')throw Error('invalidDocument');
  const rels=await pkg.relations('xl/workbook.xml');
  const byType=type=>[...rels.values()].find(rel=>rel.type===type&&!rel.external)?.path;
  const sharedNodes=children(await pkg.read(byType('sharedStrings')),'s:si');
  const root=await pkg.read(byType('styles')), palette=theme(await pkg.read(byType('theme'))), registered=styles();
  const themeOrder=['lt1','dk1','lt2','dk2','accent1','accent2','accent3','accent4','accent5','accent6','hlink','folHlink'];
  const indexed=children(first(first(root,'s:colors'),'s:indexedColors'),'s:rgbColor');
  function color(node) {
    const rgb=attr(node,'rgb');let value=/^[\da-f]{8}$/i.test(rgb)?'#'+rgb.slice(2):/^[\da-f]{6}$/i.test(rgb)?'#'+rgb:'';
    const index=Number(attr(node,'indexed'));
    value = value || (attr(node,'theme')!=='' ? palette[themeOrder[Number(attr(node,'theme'))]] : attr(node,'indexed')!=='' && index<64 ? (/^[\da-f]{8}$/i.test(attr(indexed[index],'rgb'))?'#'+attr(indexed[index],'rgb').slice(2):DEFAULT_PALETTE[index]) : '');
    if(value && attr(node,'tint')!=='') {
      const tint=num(attr(node,'tint'),0,-1,1);
      value='#'+value.slice(1).match(/../g).map(hex=>{const c=parseInt(hex,16);return Math.round(tint<0?c*(1+tint):c+(255-c)*tint).toString(16).padStart(2,'0');}).join('');
    }
    return value;
  }
  const fonts=children(first(root,'s:fonts'),'s:font'),fills=children(first(root,'s:fills'),'s:fill'),borders=children(first(root,'s:borders'),'s:border');
  const formats={...builtin};for(const item of children(first(root,'s:numFmts'),'s:numFmt'))formats[attr(item,'numFmtId')]=attr(item,'formatCode');
  function fontStyle(font) {
    return {'font-family':fontFamily([attr(first(font,'s:name'),'val')||attr(first(font,'s:rFont'),'val')],'sans-serif'),
      'font-weight':first(font,'s:b')?(on(first(font,'s:b'))?'700':'400'):undefined,
      'font-style':first(font,'s:i')?(on(first(font,'s:i'))?'italic':'normal'):undefined,
      'font-size':first(font,'s:sz')?pt(num(attr(first(font,'s:sz'),'val'),11,6,72)):undefined,color:color(first(font,'s:color')),
      'text-decoration-line':(first(font,'s:u')||first(font,'s:strike'))?[on(first(font,'s:u'))?'underline':'',on(first(font,'s:strike'))?'line-through':''].filter(Boolean).join(' ')||'none':undefined,
      'text-decoration-style':attr(first(font,'s:u'),'val')==='double'?'double':undefined};
  }
  function stringValue(node){
    // Phonetic guides are not duplicate visible cell content.
    let value='';for(const child of node?.children||[]){
      if(child.name==='s:t')value+=esc(text(child));
      else if(child.name==='s:r'){
        const props=first(child,'s:rPr'),script=attr(first(props,'s:vertAlign'),'val'),tag=script==='superscript'?'sup':script==='subscript'?'sub':'span';
        const cl=registered.add(fontStyle(props)),content=esc(text(first(child,'s:t')));value+=cl||tag!=='span'?'<'+tag+' class="'+cl+'">'+content+'</'+tag+'>':content;
      }
    }return value;
  }
  const shared=sharedNodes.map(stringValue),baseFormats=children(first(root,'s:cellStyleXfs'),'s:xf');
  const cellFormats=children(first(root,'s:cellXfs'),'s:xf');
  const formatInfo=cellFormats.map(item=>{
    const base=baseFormats[Number(attr(item,'xfId',0))];
    const id=(name,flag)=>Number(attr(item,flag)==='0'?attr(base,name,0):attr(item,name,attr(base,name,0)));
    const font=fonts[id('fontId','applyFont')],fill=first(fills[id('fillId','applyFill')],'s:patternFill'),border=borders[id('borderId','applyBorder')];
    const alignment=attr(item,'applyAlignment')==='0'?first(base,'s:alignment'):first(item,'s:alignment')||first(base,'s:alignment');
    const css={...fontStyle(font),
      'background-color':attr(fill,'patternType')==='solid'?color(first(fill,'s:fgColor')):undefined,
      'text-align':{left:'left',right:'right',center:'center',justify:'justify'}[attr(alignment,'horizontal')],
      'vertical-align':{top:'top',center:'middle',bottom:'bottom'}[attr(alignment,'vertical')],
      'white-space':attr(alignment,'wrapText')==='1'?'pre-wrap':'nowrap',
      'padding-left':attr(alignment,'indent')?pt(num(attr(alignment,'indent'),0,0,30)*9+6):undefined,
      direction:attr(alignment,'readingOrder')==='2'?'rtl':undefined};
    for(const side of ['top','bottom','left','right']) {
      const edge=first(border,'s:'+side),style=attr(edge,'style');
      if(style){css['border-'+side+'-style']=style==='double'?'double':/dash/i.test(style)?'dashed':/dot/i.test(style)?'dotted':'solid';css['border-'+side+'-width']=/thick/i.test(style)?'2pt':/medium/i.test(style)?'1.5pt':'0.75pt';css['border-'+side+'-color']=color(first(edge,'s:color'))||'#bfc3c8';}
    }
    return {css,format:formats[id('numFmtId','applyNumberFormat')]||'General'};
  });
  const sheets=children(first(workbook,'s:sheets'),'s:sheet').filter(sheet=>!['hidden','veryHidden'].includes(attr(sheet,'state')));
  if(!sheets.length||sheets.length>128)throw Error('documentTooComplex');
  const date1904=on(first(workbook,'s:workbookPr'),'date1904')&&attr(first(workbook,'s:workbookPr'),'date1904')!=='';
  let populated=0,outputSize=0;
  const parts=[];
  for(const sheet of sheets) {
    const relation=rels.get(attr(sheet,'r:id'));if(!relation?.path)continue;
    const content=await pkg.read(relation.path);if(content?.name!=='s:worksheet')continue;
    const rows=children(first(content,'s:sheetData'),'s:row'),cells=new Map(),rowStyles=new Map(),hiddenRows=new Set();
    const widths=new Map(),hiddenCols=new Set(),columnStyles=new Map();
    const defaults=first(content,'s:sheetFormatPr');
    for(const col of children(first(content,'s:cols'),'s:col'))for(let c=num(attr(col,'min'),1,1,256)-1;c<Math.min(256,num(attr(col,'max'),1));c++) {
      if(attr(col,'hidden')==='1')hiddenCols.add(c);
      if(attr(col,'style')!=='')columnStyles.set(c,Number(attr(col,'style')));
      widths.set(c,registered.add({width:pt(num(attr(col,'width'),12,1,100)*5.25+4)}));
    }
    let lastRow=0,lastCol=0;
    for(let rowIndex=0;rowIndex<rows.length;rowIndex++) {
      const row=rows[rowIndex],r=num(attr(row,'r'),rowIndex+1,1,1048576)-1;
      if(attr(row,'hidden')==='1')hiddenRows.add(r);
      rowStyles.set(r,registered.add({height:pt(num(attr(row,'ht'),num(attr(defaults,'defaultRowHeight'),15),1,400))}));
      const values=children(row,'s:c');
      for(let col=0;col<values.length;col++) {
        const cell=values[col],position=coordinates(attr(cell,'r'))||[r,col];
        const v=text(first(cell,'s:v')),inline=first(cell,'s:is'),formula=first(cell,'s:f');
        if(!v && !inline && !formula && attr(cell,'s')==='')continue;
        if(++populated>100000||position[0]>19999||position[1]>255)throw Error('documentTooComplex');
        const info=formatInfo[Number(attr(cell,'s',attr(row,'s',columnStyles.get(position[1])||0)))]||{},type=attr(cell,'t');
        let value=type==='s'?(shared[Number(v)]||''):type==='inlineStr'?stringValue(inline):type==='b'?(v==='1'?'TRUE':'FALSE'):type==='str'||type==='e'||type==='d'?v:v!==''?displayNumber(v,info.format,date1904):formula?'='+text(formula):'';
        cells.set(position.join(':'),{value:['s','inlineStr'].includes(type)?value:esc(value),className:registered.add({...info.css,'text-align':info.css?.['text-align']||(type==='b'||type==='e'?'center':(!type||type==='n')&&v!==''?'right':undefined)})});lastRow=Math.max(lastRow,position[0]);lastCol=Math.max(lastCol,position[1]);
      }
    }
    const merges=[];
    for(const merge of children(first(content,'s:mergeCells'),'s:mergeCell')) {
      const [a,b]=attr(merge,'ref').split(':').map(coordinates);if(a&&b)merges.push({s:{r:a[0],c:a[1]},e:{r:b[0],c:b[1]}});
    }
    const {rows:visibleRows,cols:visibleCols,shown,covered}=sheetGrid(merges,lastRow,lastCol,hiddenRows,hiddenCols);
    let html='<div class="cg-sheet"><table><colgroup><col class="cg-row-number">';
    for(const c of visibleCols)html+='<col class="'+(widths.get(c)||registered.add({width:pt(num(attr(defaults,'defaultColWidth'),12,1,100)*5.25+4)}))+'">';
    html+='</colgroup><thead><tr><th></th>';
    for(const c of visibleCols)html+='<th>'+columnName(c)+'</th>';
    html+='</tr></thead><tbody>';
    for(const r of visibleRows) {
      html+='<tr class="'+(rowStyles.get(r)||'')+'"><th>'+String(r+1)+'</th>';
      for(const c of visibleCols) {
        const key=r+':'+c,merge=shown.get(key);if(covered.has(key)&&!merge)continue;
        const cell=cells.get(merge?merge.s.r+':'+merge.s.c:key);
        html+='<td class="'+(cell?.className||'')+'"'+(merge?' rowspan="'+merge.rowspan+'" colspan="'+merge.colspan+'"':'')+'>'+(cell?.value||'')+'</td>';
      }
      html+='</tr>';
    }
    html+='</tbody></table></div>';
    outputSize+=html.length;if(outputSize>32*1024*1024)throw Error('documentTooLarge');
    parts.push({name:attr(sheet,'name').slice(0,120),html});
  }
  if(!parts.length)throw Error('invalidDocument');
  return {parts,formatting:{kind:'xlsx',styles:registered.values}};
}
module.exports={spreadsheet,displayNumber,coordinates};
