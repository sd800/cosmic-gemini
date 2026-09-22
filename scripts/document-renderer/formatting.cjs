const P = require('./properties.cjs');
const {createNumbering} = require('./numbering.cjs');
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
  return {get,combine,p:properties(first(first(doc,'w:pPrDefault'),'w:pPr')),r:properties(first(first(doc,'w:rPrDefault'),'w:rPr'))};
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
  const styles=[],keys=new Map();
  const register=style=>{
    const key=JSON.stringify(clean(style));
    if(key==='{}')return '';
    if(keys.has(key))return keys.get(key);
    if(styles.length>=8192)throw Error('documentTooComplex');
    const className='cg-f'+styles.length;keys.set(key,className);styles.push(clean(style));return className;
  };
  function tableCondition(table,row,column) {
    const look=table.properties.tblLook||{},mask=parseInt(look.val||'0',16);
    const flag=(key,bit)=>look[key]!=null?!['0','false','off'].includes(look[key]):!!(mask&bit);
    const names=['wholeTable'];
    if(!flag('noHBand',0x200))names.push(row%2?'band2Horz':'band1Horz');
    if(!flag('noVBand',0x400))names.push(column%2?'band2Vert':'band1Vert');
    if(column===0&&flag('firstColumn',0x80))names.push('firstCol');
    if(column===table.columns-1&&flag('lastColumn',0x100))names.push('lastCol');
    if(row===0&&flag('firstRow',0x20))names.push('firstRow');
    if(row===table.rows-1&&flag('lastRow',0x40))names.push('lastRow');
    return names.reduce((out,name)=>catalog.combine(out,table.style.conditions?.[name]||{}),{});
  }
  function forPart(part) {
    let context={r:catalog.r,p:catalog.p};
    return {wrap(element, read) {
      const before=context;
      let css,marker,grid;
      const kind=element.name;
      if(kind==='w:tbl') {
        const direct=properties(first(element,'w:tblPr')),style=catalog.get(direct.tblStyle?.val,'table');
        const tableProps=merge(style.table,style.conditions?.wholeTable?.table,direct);
        const columns=children(first(element,'w:tblGrid'),'w:gridCol').map(col=>number(attr(col,'w'),0,28800)||0);
        context={...context,table:{properties:tableProps,style,columns:columns.length,rows:children(element,'w:tr').length,rowIndex:0},cell:null};
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
        context={...context,r:styledRun(catalog.r,rLayers),p:merge(catalog.p,table.style.p,condition.p),cell:c};
        css=cellCss(c,table.properties,{top:context.row.index===0,bottom:context.row.index===table.rows-1,left:start===0,right:start+span>=table.columns},theme);
      } else if(kind==='w:p') {
        const direct=properties(first(element,'w:pPr')),style=catalog.get(direct.pStyle?.val,'paragraph');
        let p=merge(context.p,style.p,direct),num=numbering.resolve(p);
        if(num)p=merge(context.p,num.spec.p,style.p,direct);
        const r=styledRun(context.r,style.rLayers);
        context={...context,r,p};
        css={...runCss(r,theme),...paragraphCss(p,theme)};
        delete css['text-decoration-line'];delete css['text-decoration-style'];
        if(num) {
          marker=numbering.next(num,part);
          if(css['margin-left']==null)css['margin-left']=(num.level+1)*18+'pt';
          if(css['text-indent']==null)css['text-indent']='-18pt';
          const markerCss=runCss(merge(r,marker.r),theme);
          marker.className=register(markerCss);
          marker.width=css['text-indent']?.startsWith('-')?css['text-indent'].slice(1):'1.5em';
        }
      } else if(kind==='w:r') {
        const direct=properties(first(element,'w:rPr')),style=catalog.get(direct.rStyle?.val,'character');
        const r=merge(styledRun(context.r,style.rLayers),direct);
        context={...context,r};css=runCss(r,theme);
      }
      let result;
      try {
        result=read();
        if(css) result=result.map(value=>{
          for(const node of Array.isArray(value)?value:[value]) {
            const types={'w:p':'paragraph','w:r':'run','w:tbl':'table','w:tr':'tableRow','w:tc':'tableCell'};
            if(node?.type!==types[kind])continue;
            node.cgClass=register(css);node.cgMarker=marker;node.cgGrid=grid;
            if(node.type==='paragraph')node.cgPageBefore=on(context.p.pageBreakBefore);
            if(node.type==='run') {
              for(const key of ['isBold','isItalic','isUnderline','isStrikethrough','isAllCaps','isSmallCaps'])node[key]=false;
              node.highlight=null;node.styleId=node.styleName=null;
              node.verticalAlignment=context.r.vertAlign?.val||'baseline';
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
    if(element.type==='break'&&element.breakType==='page')return [Html.freshElement('span',{class:'cg-page-break',role:'separator'},[Html.forceWrite])];
    if(element.type==='run')return element.cgClass?[Html.freshElement('span',{class:element.cgClass},nodes)]:nodes;
    if(!element.cgClass&&!element.cgMarker&&!element.cgGrid&&!element.cgPageBefore)return nodes;
    const tagNames={paragraph:/^(?:p|h[1-6]|li)$/,table:/^table$/,tableRow:/^tr$/,tableCell:/^(?:td|th)$/}[element.type];
    function find(list) {
      for(let index=0;index<list.length;index++) {
        const node=list[index];
        if(node.type!=='element')continue;
        if(tagNames?.test(node.tag.tagName)) {
          const attributes={...node.tag.attributes,class:[node.tag.attributes.class,element.cgClass,element.cgMarker&&'cg-numbered'].filter(Boolean).join(' ')};
          const content=[...node.children];
          if(element.cgMarker) {
            const marker=element.cgMarker;
            const markerClass=register({'min-width':marker.suffix==='tab'?marker.width:'0pt','text-indent':'0pt'});
            content.unshift(Html.freshElement('span',{class:['cg-list-marker',marker.className,markerClass].filter(Boolean).join(' ')},[Html.text(marker.label+(marker.suffix==='nothing'?'':'\u00a0'))]));
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
