const {first,children,all,text,attr,esc,num,pt,styles,openPackage,resolvePart}=require('./office-package.cjs');
const {localFont:fontFamily}=require('./fonts.cjs');
function length(value){const m=String(value).match(/^(-?\d+(?:\.\d+)?)(cm|mm|in|pt|pc|px)$/);if(!m)return '';const points=Number(m[1])*({cm:72/2.54,mm:72/25.4,in:72,pt:1,pc:12,px:.75})[m[2]];return Math.abs(points)<=4000?pt(points):'';}
async function opendocument(buffer,format){
  const pkg=await openPackage(buffer),content=await pkg.read('content.xml'),styleRoot=await pkg.read('styles.xml'),manifest=await pkg.read('META-INF/manifest.xml');
  if(!content||all(manifest,'manifest:encryption-data').length)throw Error('invalidDocument');
  const body=first(first(content,'office:body'),({odt:'office:text',ods:'office:spreadsheet',odp:'office:presentation'})[format]);if(!body)throw Error('invalidDocument');
  const registered=styles(),definitions=new Map(),defaults=new Map(),cache=new Map(),fontNames=new Map(),listStyles=new Map(),masters=new Map(),layouts=new Map();let output=0,nodes=0;
  for(const root of [styleRoot,content]){
    for(const node of all(root,'style:style'))definitions.set(attr(node,'style:family')+':'+attr(node,'style:name'),node);
    for(const node of all(root,'style:font-face'))fontNames.set(attr(node,'style:name'),attr(node,'svg:font-family'));
    for(const node of all(root,'text:list-style'))listStyles.set(attr(node,'style:name'),node);
    for(const node of all(root,'style:master-page'))masters.set(attr(node,'style:name'),node);
    for(const node of all(root,'style:page-layout'))layouts.set(attr(node,'style:name'),node);
    for(const node of all(root,'style:default-style'))defaults.set(attr(node,'style:family'),node);
  }
  function properties(node){const result={};for(const n of node?.children||[]){
    for(const [from,to] of [['fo:font-size','font-size'],['fo:margin-top','margin-top'],['fo:margin-bottom','margin-bottom'],['fo:margin-left','margin-left'],['fo:margin-right','margin-right'],['fo:text-indent','text-indent'],['style:column-width','width'],['style:row-height','height']])if(length(attr(n,from)))result[to]=length(attr(n,from));
    for(const [from,to] of [['fo:color','color'],['fo:background-color','background-color']])if(/^#[\da-f]{6}$/i.test(attr(n,from)))result[to]=attr(n,from);
    if(['bold','normal'].includes(attr(n,'fo:font-weight')))result['font-weight']=attr(n,'fo:font-weight')==='bold'?'700':'400';
    if(['italic','normal'].includes(attr(n,'fo:font-style')))result['font-style']=attr(n,'fo:font-style');
    const fonts=[attr(n,'fo:font-family')||fontNames.get(attr(n,'style:font-name')),fontNames.get(attr(n,'style:font-name-asian'))].filter(Boolean).map(v=>v.replace(/^['"]|['"]$/g,''));
    if(fonts.length)result['font-family']=fontFamily(fonts,'serif');
    const line=attr(n,'fo:line-height');if(length(line))result['line-height']=length(line);else if(/^\d+(?:\.\d+)?%$/.test(line))result['line-height']=String(Math.round(Math.max(.5,Math.min(10,parseFloat(line)/100))*1000)/1000);
    if(['rl-tb','lr-tb'].includes(attr(n,'style:writing-mode')))result.direction=attr(n,'style:writing-mode')==='rl-tb'?'rtl':'ltr';
    for(const side of ['top','bottom','left','right']){
      const padding=length(attr(n,'fo:padding-'+side)||attr(n,'fo:padding'));if(padding)result['padding-'+side]=padding;
      const border=attr(n,'fo:border-'+side)||attr(n,'fo:border');
      if(border==='none')result['border-'+side+'-style']='none';
      const m=border.match(/^(\S+) (solid|double|dotted|dashed) (#[\da-f]{6})$/i);if(m&&length(m[1])){result['border-'+side+'-width']=length(m[1]);result['border-'+side+'-style']=m[2];result['border-'+side+'-color']=m[3];}
    }
    if(attr(n,'draw:fill')==='solid'&&/^#[\da-f]{6}$/i.test(attr(n,'draw:fill-color')))result['background-color']=attr(n,'draw:fill-color');
    if(['start','end','left','right','center','justify'].includes(attr(n,'fo:text-align')))result['text-align']=attr(n,'fo:text-align');
    if(['top','middle','bottom'].includes(attr(n,'style:vertical-align')))result['vertical-align']=attr(n,'style:vertical-align');
    const decoration=[];if(attr(n,'style:text-underline-style')&&attr(n,'style:text-underline-style')!=='none')decoration.push('underline');if(attr(n,'style:text-line-through-style')&&attr(n,'style:text-line-through-style')!=='none')decoration.push('line-through');if(decoration.length||attr(n,'style:text-underline-style')==='none'||attr(n,'style:text-line-through-style')==='none')result['text-decoration-line']=decoration.join(' ')||'none';
  }return result;}
  function resolve(name,family,seen=new Set()){
    const key=family+':'+name;if(cache.has(key))return cache.get(key);
    if(seen.has(name)||seen.size>40)throw Error('invalidDocument');seen.add(name);
    const node=definitions.get(key),parent=attr(node,'style:parent-style-name');
    const result={...properties(defaults.get(family)),...(parent?resolve(parent,family,seen):{}),...properties(node)};cache.set(key,result);return result;
  }
  const css=(node,family,extra={})=>registered.add({...resolve(attr(node,'text:style-name')||attr(node,'table:style-name')||attr(node,'draw:style-name'),family),...extra});
  function bounded(value){output+=value.length;if(output>32*1024*1024)throw Error('documentTooLarge');return value;}
  async function renderChildren(node,depth=0){let value='';for(const child of node.children||[]){value+=await render(child,depth+1);if(value.length>32*1024*1024)throw Error('documentTooLarge');}return value;}
  async function render(node,depth=0){
    if(++nodes>200000||depth>64)throw Error('documentTooComplex');
    if(node?.type==='text')return esc(node.value);
    const name=node?.name;if(!name)return '';
    if(['office:scripts','text:tracked-changes','office:annotation','office:binary-data','draw:object','draw:object-ole','draw:plugin','draw:applet'].includes(name))return '';
    if(name==='text:s')return ' '.repeat(num(attr(node,'text:c'),1,1,4096));
    if(name==='text:tab')return '\t';if(name==='text:line-break')return '<br>';
    if(name==='text:soft-page-break')return '<hr class="cg-page-break">';
    if(name==='draw:image'){
      const path=resolvePart('content.xml',attr(node,'xlink:href'));if(!path)return '';
      const src=await pkg.image(path);return src?'<img src="'+src+'" alt="">':'';
    }
    if(name==='table:table')return renderTable(node,false);
    const inner=await renderChildren(node,depth);
    let tag='',family='paragraph';
    if(name==='text:p')tag='p';else if(name==='text:h')tag='h'+num(attr(node,'text:outline-level'),1,1,6);
    else if(name==='text:span'){tag='span';family='text';}
    else if(name==='text:list'){
      const def=listStyles.get(attr(node,'text:style-name')),level=first(def,'text:list-level-style-number');
      if(level){const type={'1':'decimal',a:'lower-alpha',A:'upper-alpha',i:'lower-roman',I:'upper-roman'}[attr(level,'style:num-format')]||'decimal';return '<ol start="'+num(attr(level,'text:start-value'),1,1,9999)+'" class="'+registered.add({'list-style-type':type})+'">'+inner+'</ol>';}tag='ul';
    }else if(name==='text:list-item')tag='li';
    else if(name==='text:a')return '<a href="'+esc(attr(node,'xlink:href'))+'">'+inner+'</a>';
    else if(name==='draw:frame'){return '<div class="'+registered.add({width:length(attr(node,'svg:width'))||undefined,'max-width':'100%'})+'">'+inner+'</div>';}
    if(!tag)return inner;
    const definition=definitions.get(family+':'+attr(node,'text:style-name')),breakBefore=attr(first(definition,'style:paragraph-properties'),'fo:break-before')==='page';
    return (breakBefore?'<hr class="cg-page-break">':'')+'<'+tag+' class="'+css(node,family)+'">'+inner+'</'+tag+'>';
  }
  function tableRows(table){const rows=[];function visit(node){for(const child of node.children||[])if(child.name==='table:table-row')rows.push(child);else if(['table:table-row-group','table:table-rows','table:table-header-rows'].includes(child.name))visit(child);}visit(table);return rows;}
  async function renderTable(table,sheet){
    const rows=tableRows(table),parsed=[];let rowPosition=0,lastContentRow=-1,maxCol=0;
    for(const row of rows){
      const repeat=Number(attr(row,'table:number-rows-repeated',1));if(!Number.isInteger(repeat)||repeat<1||repeat>1048576)throw Error('invalidDocument');
      const values=[];let col=0,lastContent=-1;
      for(const cell of row.children||[]){if(!['table:table-cell','table:covered-table-cell'].includes(cell.name))continue;
        const n=Number(attr(cell,'table:number-columns-repeated',1));if(!Number.isInteger(n)||n<1||n>16384)throw Error('invalidDocument');
        const visible=(cell.children||[]).some(c=>c.type==='element'&&c.name!=='office:annotation')||attr(cell,'office:value')!==''||attr(cell,'office:string-value')!==''||attr(cell,'office:date-value')!==''||attr(cell,'office:boolean-value')!==''||attr(cell,'office:time-value')!==''||attr(cell,'table:formula')!=='';
        if(visible||cell.name==='table:covered-table-cell')lastContent=col+n-1;
        values.push({cell,col,n,visible});col+=n;
      }
      if(lastContent>=0){if(rowPosition+repeat>20000||lastContent>255)throw Error('documentTooComplex');lastContentRow=rowPosition+repeat-1;maxCol=Math.max(maxCol,lastContent);}
      parsed.push({row,values,position:rowPosition,repeat,lastContent});rowPosition+=repeat;
    }
    if((lastContentRow+1)*(maxCol+1)>100000)throw Error('documentTooComplex');
    let html=sheet?'<div class="cg-sheet"><table><tbody>':'<table><tbody>';
    for(const {row,values,position,repeat} of parsed){if(position>lastContentRow)break;
      let cells=sheet?'<th>'+String(position+1)+'</th>':'';
      for(const {cell,col,n,visible} of values){if(col>maxCol)break;
        if(cell.name==='table:covered-table-cell')continue;
        const span=Number(attr(cell,'table:number-columns-spanned',1)),rows=Number(attr(cell,'table:number-rows-spanned',1));
        if(!Number.isInteger(span)||!Number.isInteger(rows)||span<1||span>256||rows<1||rows>1000)throw Error('invalidDocument');
        let value='';if(visible)value=await renderChildren(cell);
        if(!value)value=esc(attr(cell,'office:string-value')||attr(cell,'office:date-value')||attr(cell,'office:time-value')||attr(cell,'office:value')||attr(cell,'office:boolean-value')||attr(cell,'table:formula'));
        const entry='<td class="'+css(cell,'table-cell')+'"'+(span>1?' colspan="'+span+'"':'')+(rows>1?' rowspan="'+rows+'"':'')+'>'+value+'</td>';
        const copies=Math.min(n,maxCol-col+1);if(cells.length+entry.length*copies>32*1024*1024)throw Error('documentTooLarge');
        cells+=entry.repeat(copies);
      }
      if(html.length+(cells.length+100)*Math.min(repeat,lastContentRow-position+1)>32*1024*1024)throw Error('documentTooLarge');
      for(let i=0;i<Math.min(repeat,lastContentRow-position+1);i++)html+='<tr class="'+css(row,'table-row')+'">'+(sheet?cells.replace(/^<th>\d+<\/th>/,'<th>'+String(position+i+1)+'</th>'):cells)+'</tr>';
      if(html.length>32*1024*1024)throw Error('documentTooLarge');
    }
    return bounded(html+'</tbody></table>'+(sheet?'</div>':''));
  }
  if(format==='ods'){
    const tables=children(body,'table:table');if(!tables.length||tables.length>128)throw Error('documentTooComplex');
    const parts=[];for(const table of tables)parts.push({name:attr(table,'table:name').slice(0,120),html:await renderTable(table,true)});
    return {parts,formatting:{kind:'xlsx',styles:registered.values}};
  }
  if(format==='odp'){
    const pages=children(body,'draw:page');if(!pages.length||pages.length>300)throw Error('documentTooComplex');const parts=[];
    for(const [i,page] of pages.entries()){
      const master=masters.get(attr(page,'draw:master-page-name'));
      const layout=layouts.get(attr(master,'style:page-layout-name'));
      const props=first(layout,'style:page-layout-properties');
      const slide=registered.add({width:length(attr(props,'fo:page-width'))||'720pt',height:length(attr(props,'fo:page-height'))||'540pt','background-color':'#ffffff',...resolve(attr(page,'draw:style-name'),'drawing-page')});
      let html='<div class="cg-slide '+slide+'">';
      for(const shape of page.children||[]){if(shape.type!=='element'||shape.name==='presentation:notes')continue;
        const position={position:'absolute',left:length(attr(shape,'svg:x'))||'0pt',top:length(attr(shape,'svg:y'))||'0pt',width:length(attr(shape,'svg:width'))||'600pt',height:length(attr(shape,'svg:height'))||undefined};
        html+='<div class="cg-shape '+css(shape,'graphic',position)+'">'+await render(shape)+'</div>';
      }
      parts.push({name:attr(page,'draw:name')||String(i+1),html:bounded(html+'</div>')});
    }
    return {parts,formatting:{kind:'pptx',styles:registered.values}};
  }
  const value=bounded(await render(body));
  const master=masters.values().next().value,layout=layouts.get(attr(master,'style:page-layout-name')),props=first(layout,'style:page-layout-properties'),page={};
  for(const [key,name]of Object.entries({width:'page-width',left:'margin-left',right:'margin-right',top:'margin-top',bottom:'margin-bottom'})){const v=length(attr(props,'fo:'+name));if(v)page[key]=v;}
  return {value,formatting:{styles:registered.values,page}};
}
module.exports={opendocument};
