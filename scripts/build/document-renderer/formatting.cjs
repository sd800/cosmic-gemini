const {fontRuns}=require('./fonts.cjs');
const P = require('./properties.cjs');
const {createNumbering,listLayout} = require('./numbering.cjs');
const {wordContent} = require('./word-content.cjs');
const {first,children,attr,value,properties,merge,styledRun,on,number,points,runCss,paragraphCss,tableCss,cellCss,clean} = P;

function readTheme(root) {
  const elements=first(root,'a:themeElements'), colors={}, fonts={};
  for(const item of first(elements,'a:clrScheme')?.children||[]) {
    const color=item.children?.find(child=>child.type==='element');
    if(color)colors[item.name.slice(2)]=color.name==='a:sysClr'?color.attributes.lastClr:color.attributes.val;
  }
  for(const [name,target] of [['background1','lt1'],['text1','dk1'],['background2','lt2'],['text2','dk2']])colors[name]=colors[target];
  for(const kind of ['major','minor']) {
    const node=first(first(elements,'a:fontScheme'),'a:'+kind+'Font');
    const supplemental=children(node,'a:font').find(child=>child.attributes.script==='Hans');
    fonts[kind+'Ascii']=fonts[kind+'HAnsi']=first(node,'a:latin')?.attributes.typeface;
    fonts[kind+'EastAsiaScripts']=Object.fromEntries(children(node,'a:font').map(child=>[child.attributes.script,child.attributes.typeface]));
    fonts[kind+'EastAsia']=first(node,'a:ea')?.attributes.typeface || supplemental?.attributes.typeface;
    fonts[kind+'Bidi']=first(node,'a:cs')?.attributes.typeface;
  }
  return {colors,fonts};
}
function styleCatalog(root) {
  const records=new Map(), defaults={},cache=new Map();
  for(const node of children(root,'w:style')) {
    const id=attr(node,'styleId'),kind=attr(node,'type');
    if(!id||records.has(id))continue;
    records.set(id,{node,kind});
    if(['1','true','on'].includes(attr(node,'default')))defaults[kind]=id;
  }
  function parse(node) {
    return {p:properties(first(node,'w:pPr')),rLayers:first(node,'w:rPr')?[properties(first(node,'w:rPr'))]:[],
      table:properties(first(node,'w:tblPr')),row:properties(first(node,'w:trPr')),cell:properties(first(node,'w:tcPr'))};
  }
  function combine(base, extra) {return {...merge(base,extra),rLayers:[...(base?.rLayers||[]),...(extra?.rLayers||[])]};}
  function get(id,kind,visited=new Set()) {
    id = id || defaults[kind];
    const record=records.get(id);
    if(!record||record.kind!==kind||visited.has(id)||visited.size>32)return {};
    if(cache.has(id))return cache.get(id);
    visited.add(id);
    const basedOn=value(record.node,'basedOn');
    const base=basedOn?get(basedOn,kind,visited):{}, result=combine(base,parse(record.node));
    result.conditions={...base.conditions};
    for(const condition of children(record.node,'w:tblStylePr')) {
      const key=attr(condition,'type');result.conditions[key]=combine(result.conditions[key],parse(condition));
    }
    cache.set(id,result);return result;
  }
  const doc=first(root,'w:docDefaults');
  return {get,combine,p:properties(first(first(doc,'w:pPrDefault'),'w:pPr')),r:merge({sz:{val:'22'},b:{val:'0'},i:{val:'0'}},properties(first(first(doc,'w:rPrDefault'),'w:rPr')))};
}
function pageProperties(root) {
  const body=first(root,'w:body');
  const section=first(body,'w:sectPr') || children(body,'w:p').map(node=>first(first(node,'w:pPr'),'w:sectPr')).find(Boolean);
  const margins=first(section,'w:pgMar');
  return clean({width:points(attr(first(section,'w:pgSz'),'w'),20,216,1440),
    top:points(attr(margins,'top'),20,0,144),bottom:points(attr(margins,'bottom'),20,0,144),
    left:points(attr(margins,'left'),20,0,144),right:points(attr(margins,'right'),20,0,144)});
}

function createFormatting(parts, Html) {
  const theme=readTheme(parts.theme), catalog=styleCatalog(parts.styles), numbering=createNumbering(parts.numbering,catalog.get);
  const tabSize=points(value(parts.settings,'defaultTabStop')||'720',20,1,1440);
  const styles=[],keys=new Map();
  const register=style=>{
    const key=JSON.stringify(clean(style));
    if(key==='{}')return '';
    if(keys.has(key))return keys.get(key);
    if(styles.length>=8192)throw Error('documentTooComplex');
    const className='cg-f'+styles.length;keys.set(key,className);styles.push(clean(style));return className;
  };
  const specialContent=wordContent(Html,register,theme);
  function tableCondition(table,row,column) {
    const look=table.properties.tblLook||{},mask=parseInt(look.val||'0',16);
    const flag=(key,bit)=>look[key]!=null?!['0','false','off'].includes(look[key]):!!(mask&bit);
    const names=['wholeTable'];
    const rowBand=number(table.properties.tblStyleRowBandSize?.val||'1',1,1000),colBand=number(table.properties.tblStyleColBandSize?.val||'1',1,1000);
    if(!flag('noHBand',0x200))names.push(Math.floor(Math.max(0,row-(flag('firstRow',0x20)?1:0))/rowBand)%2?'band2Horz':'band1Horz');
    if(!flag('noVBand',0x400))names.push(Math.floor(Math.max(0,column-(flag('firstColumn',0x80)?1:0))/colBand)%2?'band2Vert':'band1Vert');
    if(column===0&&flag('firstColumn',0x80))names.push('firstCol');
    if(column===table.columns-1&&flag('lastColumn',0x100))names.push('lastCol');
    if(row===0&&flag('firstRow',0x20))names.push('firstRow');
    if(row===table.rows-1&&flag('lastRow',0x40))names.push('lastRow');
    if(row===0&&flag('firstRow',0x20)&&column===0&&flag('firstColumn',0x80))names.push('nwCell');
    if(row===0&&flag('firstRow',0x20)&&column===table.columns-1&&flag('lastColumn',0x100))names.push('neCell');
    if(row===table.rows-1&&flag('lastRow',0x40)&&column===0&&flag('firstColumn',0x80))names.push('swCell');
    if(row===table.rows-1&&flag('lastRow',0x40)&&column===table.columns-1&&flag('lastColumn',0x100))names.push('seCell');
    return names.reduce((out,name)=>catalog.combine(out,table.style.conditions?.[name]||{}),{});
  }
  function forPart(part) {
    let context={r:catalog.r,p:catalog.p,flow:{}};
    return {isSpecial:element=>['m:oMath','m:oMathPara','w:ruby'].includes(element.name),wrap(element, read) {
      const before=context;
      let css,marker,grid;
      const kind=element.name;
      const custom=specialContent(element,context.r);
      if(custom)return read().map(()=>[{type:'run',children:[],cgContent:custom}]);
      if(kind==='w:tbl') {
        context.flow.previous=null;
        const direct=properties(first(element,'w:tblPr')),style=catalog.get(direct.tblStyle?.val,'table');
        const tableProps=merge(style.table,style.conditions?.wholeTable?.table,direct);
        const columns=children(first(element,'w:tblGrid'),'w:gridCol').map(col=>number(attr(col,'w'),0,28800)||0);
        context={...context,table:{properties:tableProps,style,columns:columns.length||children(children(element,'w:tr')[0],'w:tc').length,rows:children(element,'w:tr').length,rowIndex:0},cell:null,flow:{}};
        css=tableCss(tableProps,theme);grid=columns;
      } else if(kind==='w:tr'&&context.table) {
        const index=context.table.rowIndex++;
        context={...context,row:{index,column:0}};
        const direct=properties(first(element,'w:trPr'));
        css=clean({height:points(direct.trHeight?.val,20,0,288)});
      } else if(kind==='w:tc'&&context.table&&context.row) {
        const direct=properties(first(element,'w:tcPr')),start=context.row.column;
        const span=number(direct.gridSpan?.val||'1',1,1000);
        context.row.column+=span;
        const table=context.table,condition=tableCondition(table,context.row.index,start);
        const c=merge(table.style.cell,condition.cell,direct);
        const rLayers=[...(table.style.rLayers||[]),...(condition.rLayers||[])];
        context={...context,r:styledRun(catalog.r,rLayers),p:merge(catalog.p,table.style.p,condition.p),cell:c,flow:{}};
        css=cellCss(c,table.properties,{top:context.row.index===0,bottom:context.row.index===table.rows-1,left:start===0,right:start+span>=table.columns},theme);
      } else if(kind==='w:p') {
        const direct=properties(first(element,'w:pPr')),style=catalog.get(direct.pStyle?.val,'paragraph');
        let p=merge(context.p,style.p,direct),num=numbering.resolve(p);
        if(num)p=merge(context.p,num.spec.p,style.p,direct);
        const r=styledRun(context.r,style.rLayers);
        context={...context,r,p};
        css={...runCss(r,theme),...paragraphCss(p,theme)};
        // The paragraph mark controls the paragraph's spacing metrics, not the
        // character formatting of its text. Every run retains its own size.
        const mark=properties(first(first(element,'w:pPr'),'w:rPr'));
        if(mark.sz?.val)css['font-size']=points(mark.sz.val,2,4,96);
        css['tab-size']=tabSize;
        delete css['text-decoration-line'];delete css['text-decoration-style'];
        if(num) {
          marker=numbering.next(num,part);
          if(css['margin-left']==null)css['margin-left']=(num.level+1)*18+'pt';
          if(css['text-indent']==null)css['text-indent']='-18pt';
          const markerCss=runCss(merge(r,marker.r),theme);
          // Dingbat bullets have already become Unicode, so a missing Symbol
          // font must not turn them back into unrelated glyphs.
          if(num.spec.format==='bullet')delete markerCss['font-family'];
          const layout=listLayout(css,marker);css=layout.paragraph;
          marker.className=register({...markerCss,...layout.marker});
        }
      } else if(kind==='w:r') {
        const direct=properties(first(element,'w:rPr')),style=catalog.get(direct.rStyle?.val,'character');
        const r=merge(styledRun(context.r,style.rLayers),direct);
        if(on(r.vanish)||on(r.webHidden))return read().map(()=>[]);
        context={...context,r};css=runCss(r,theme);
      }
      let result;
      try {
        result=read();
        if(kind==='wp:inline'||kind==='wp:anchor'){
          const extent=first(element,'wp:extent'),width=points(extent?.attributes.cx,12700,1,1440),height=points(extent?.attributes.cy,12700,1,1440);
          if(width)result=result.map(value=>{
            function size(node,depth=0){if(depth>64)throw Error('documentTooComplex');if(node?.type==='image')node.cgClass=register({width,...(height?{'aspect-ratio':P.rounded(parseFloat(width)/parseFloat(height))}:{})});for(const child of node?.children||[])size(child,depth+1);}
            for(const node of Array.isArray(value)?value:[value])size(node);return value;
          });
        }
        if(css) result=result.map(value=>{
          for(const node of Array.isArray(value)?value:[value]) {
            const types={'w:p':'paragraph','w:r':'run','w:tbl':'table','w:tr':'tableRow','w:tc':'tableCell'};
            if(node?.type!==types[kind])continue;
            node.cgClass=register(css);node.cgMarker=marker;node.cgGrid=grid;
            if(node.type==='paragraph'){
              node.cgPageBefore=on(context.p.pageBreakBefore);
              const style=context.p.pStyle?.val||'',previous=context.flow.previous;
              if(previous?.style===style){
                if(on(context.p.contextualSpacing))css['margin-top']='0pt';
                if(previous.contextual)previous.node.cgClass=register({...previous.css,'margin-bottom':'0pt'});
              }
              node.cgClass=register(css);context.flow.previous={node,css,style,contextual:on(context.p.contextualSpacing)};
            }
            if(node.type==='run') {
              for(const key of ['isBold','isItalic','isUnderline','isStrikethrough','isAllCaps','isSmallCaps'])node[key]=false;
              node.highlight=null;node.styleId=node.styleName=null;
              node.verticalAlignment=context.r.vertAlign?.val||'baseline';
              node.cgFonts=P.fontFamilies(context.r,theme);node.cgCss=css;
              node.cgLanguage=context.r.lang?.val;
            }
            if(node.type==='paragraph'&&(marker||context.p.numPr?.numId?.val==='0'))node.numbering=null;
          }
          return value;
        });
        return result;
      } finally {context=before;}
    }};
  }
  function decorate(element,nodes) {
    if(element.cgContent)return element.cgContent;
    if(element.type==='checkbox')return [Html.freshElement('span',{},[Html.text(element.checked?'☑':'☐')])];
    if(element.type==='image'&&element.cgClass){
      for(const node of nodes)if(node.type==='deferred'){
        const read=node.value;node.value=()=>read().then(images=>images.map(image=>Html.freshElement('img',{...image.tag.attributes,class:element.cgClass},[])));
      }
      return nodes;
    }
    if(element.type==='break'&&element.breakType==='page')return [Html.freshElement('span',{class:'cg-page-break',role:'separator'},[Html.forceWrite])];
    if(element.type==='run'){
      const fonts=element.cgFonts;
      if(fonts&&(fonts.ascii!==fonts.east||fonts.ascii!==fonts.other)){
        let count=0;
        function apply(list,depth=0){if(depth>64)throw Error('documentTooComplex');const out=[];for(const node of list){if(++count>100000)throw Error('documentTooComplex');
          if(node.type==='text')for(const part of fontRuns(node.value,fonts)){if(++count>100000)throw Error('documentTooComplex');out.push(part.family===fonts.ascii?Html.text(part.text):Html.freshElement('span',{class:register({...element.cgCss,'font-family':part.family})},[Html.text(part.text)]));}
          else {if(node.children)node.children=apply(node.children,depth+1);out.push(node);}
        }return out;}
        nodes=apply(nodes);
      }
      return element.cgClass?[Html.freshElement('span',{class:element.cgClass,...(element.cgLanguage?{lang:element.cgLanguage}:{})},nodes)]:nodes;
    }
    if(!element.cgClass&&!element.cgMarker&&!element.cgGrid&&!element.cgPageBefore)return nodes;
    const tagNames={paragraph:/^(?:p|h[1-6]|li)$/,table:/^table$/,tableRow:/^tr$/,tableCell:/^(?:td|th)$/}[element.type];
    function find(list) {
      for(let index=0;index<list.length;index++) {
        const node=list[index];
        if(node.type!=='element')continue;
        if(tagNames?.test(node.tag.tagName)) {
          const attributes={...node.tag.attributes,class:[node.tag.attributes.class,element.cgClass,element.cgMarker&&'cg-numbered'].filter(Boolean).join(' ')};
          let content=[...node.children];
          if(element.cgMarker) {
            const marker=element.cgMarker;
            content=[Html.freshElement('span',{class:['cg-list-marker',marker.className].filter(Boolean).join(' ')},[Html.text(marker.label+(marker.label&&marker.suffix!=='nothing'?' ':''))]),Html.freshElement('span',{class:'cg-list-content'},content)];
          }
          if(element.cgGrid?.some(Boolean)) {
            const total=element.cgGrid.reduce((sum,n)=>sum+n,0);
            content.unshift(Html.freshElement('colgroup',{},element.cgGrid.map(w=>Html.freshElement('col',{class:register({width:P.rounded(w/total*100)+'%'})},[Html.forceWrite]))));
          }
          list[index]=Html.freshElement(node.tag.tagName,attributes,content);return true;
        }
        if(node.children&&find(node.children))return true;
      }
      return false;
    }
    find(nodes);
    if(element.cgPageBefore)nodes.unshift(Html.freshElement('hr',{class:'cg-page-break'},[]));
    return nodes;
  }
  return {forPart,decorate,export:()=>({styles,page:pageProperties(parts.document)})};
}
module.exports={createFormatting};
