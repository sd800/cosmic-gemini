const {first,children,all,text,attr,esc,num,pt,styles,openPackage,theme,drawingColor} = require('./office-package.cjs');
const {numberLabel}=require('./legacy-binary.cjs');
const {localFont,fontRuns}=require('./fonts.cjs');
async function presentation(buffer) {
  const pkg=await openPackage(buffer), main=await pkg.read('ppt/presentation.xml');
  if(main?.name!=='p:presentation')throw Error('invalidDocument');
  const rels=await pkg.relations('ppt/presentation.xml'),slides=children(first(main,'p:sldIdLst'),'p:sldId');
  if(!slides.length||slides.length>300)throw Error('documentTooComplex');
  const size=first(main,'p:sldSz'),width=num(attr(size,'cx'),9144000,914400,36576000)/12700,height=num(attr(size,'cy'),6858000,914400,36576000)/12700;
  const registered=styles(),parts=[];
  let outputSize=0;
  const relPath=(relations,type)=>[...relations.values()].find(rel=>rel.type===type&&!rel.external)?.path;
  const placeholders=new WeakMap(),placeholderIndices=new WeakMap();
  const ph=shape=>{if(!shape)return null;if(!placeholders.has(shape))placeholders.set(shape,all(shape,'p:ph')[0]);return placeholders.get(shape);};
  function matchPlaceholder(shape,root) {
    const placeholder=ph(shape);if(!placeholder||!root)return null;
    if(!placeholderIndices.has(root)){
      const index=new Map();for(const value of all(root,'p:sp')){const p=ph(value);if(p){const kind=attr(p,'type','body'),key=kind+':'+attr(p,'idx','0');if(!index.has(key))index.set(key,value);if(!index.has(kind))index.set(kind,value);}}placeholderIndices.set(root,index);
    }
    const index=placeholderIndices.get(root),kind=attr(placeholder,'type','body');return index.get(kind+':'+attr(placeholder,'idx','0'))||index.get(kind);
  }
  for(let index=0;index<slides.length;index++) {
    const path=rels.get(attr(slides[index],'r:id'))?.path;if(!path)throw Error('invalidDocument');
    const slide=await pkg.read(path),slideRels=await pkg.relations(path),layoutPath=relPath(slideRels,'slideLayout');
    const layout=await pkg.read(layoutPath),layoutRels=layoutPath?await pkg.relations(layoutPath):new Map(),masterPath=relPath(layoutRels,'slideMaster');
    const master=await pkg.read(masterPath),masterRels=masterPath?await pkg.relations(masterPath):new Map();
    const themeRoot=await pkg.read(relPath(slideRels,'themeOverride')||relPath(masterRels,'theme')||relPath(rels,'theme')),colors=theme(themeRoot);
    const fontScheme=first(first(themeRoot,'a:themeElements'),'a:fontScheme');
    const colorMap=first(master,'p:clrMap');
    for(const alias of ['bg1','tx1','bg2','tx2'])if(attr(colorMap,alias))colors[alias]=colors[attr(colorMap,alias)];
    const background=first(first(slide,'p:cSld'),'p:bg')||first(first(layout,'p:cSld'),'p:bg')||first(first(master,'p:cSld'),'p:bg');
    const backgroundProperties=first(background,'p:bgPr');
    const bg=drawingColor(first(backgroundProperties,'a:solidFill'),colors)||'#ffffff';
    const canvas=registered.add({width:pt(width),height:pt(height),'background-color':bg});
    let count=0;const runFonts=new WeakMap();
    function runStyle(properties={},base={}) {
      const css={...base};const fontSize=attr(properties,'sz');if(fontSize)css['font-size']=pt(num(fontSize,1800,600,9600)/100);
      if(attr(properties,'b')!=='')css['font-weight']=attr(properties,'b')==='1'?'700':'400';
      if(attr(properties,'i')!=='')css['font-style']=attr(properties,'i')==='1'?'italic':'normal';
      if(attr(properties,'u')||attr(properties,'strike'))css['text-decoration-line']=[attr(properties,'u')&&attr(properties,'u')!=='none'?'underline':'',attr(properties,'strike')&&attr(properties,'strike')!=='noStrike'?'line-through':''].filter(Boolean).join(' ')||'none';
      if(attr(properties,'spc')!=='')css['letter-spacing']=pt(num(attr(properties,'spc'),0,-2000,2000)/100);
      const fill=drawingColor(first(properties,'a:solidFill'),colors);if(fill)css.color=fill;
      const faces=['latin','ea'].map(k=>{const name=attr(first(properties,'a:'+k),'typeface');if(!name.startsWith('+'))return name;const scheme=first(fontScheme,name.startsWith('+mj-')?'a:majorFont':'a:minorFont');let face=attr(first(scheme,'a:'+k),'typeface');if(!face&&k==='ea'){const lang=attr(properties,'lang'),script=/^ja/i.test(lang)?'Jpan':/^ko/i.test(lang)?'Hang':/Hant|-(TW|HK|MO)$/i.test(lang)?'Hant':'Hans';face=attr(children(scheme,'a:font').find(n=>attr(n,'script')===script),'typeface');}return face;});
      const inherited=runFonts.get(base)||{},ascii=localFont([faces[0]])||inherited.ascii||localFont([faces[1]]),east=localFont([faces[1]])||inherited.east||ascii;
      if(ascii)css['font-family']=ascii;runFonts.set(css,{ascii,east,other:ascii});
      return css;
    }
    function paragraphs(body,inheritedBody,kind) {
      const masterStyle=first(first(master,'p:txStyles'),['title','ctrTitle'].includes(kind)?'p:titleStyle':kind==='body'?'p:bodyStyle':'p:otherStyle');
      const numbers=new Map();return children(body,'a:p').map((p,pi)=>{
        const properties=first(p,'a:pPr'),level=num(attr(properties,'lvl'),0,0,8),levelName='a:lvl'+(level+1)+'pPr';
        const inheritedP=children(inheritedBody,'a:p')[pi]||children(inheritedBody,'a:p')[0];
        const layer=[first(masterStyle,levelName),first(first(inheritedBody,'a:lstStyle'),levelName),first(inheritedP,'a:pPr'),first(first(body,'a:lstStyle'),levelName),properties].filter(Boolean);
        const combined=Object.assign({},...layer.map(node=>node.attributes));
        let base={};for(const layerNode of layer)base=runStyle(first(layerNode,'a:defRPr'),base);
        if(!base['font-size'])base['font-size']=['title','ctrTitle'].includes(kind)?'32pt':'18pt';
        const css={'text-align':{l:'left',r:'right',ctr:'center',just:'justify'}[combined.algn]||'left',
          'margin-left':combined.marL?pt(num(combined.marL)/12700):undefined,'text-indent':combined.indent?pt(num(combined.indent)/12700):undefined};
        const bullet=[...layer].reverse().find(node=>first(node,'a:buNone')||first(node,'a:buChar')||first(node,'a:buAutoNum'));
        let marker=first(bullet,'a:buChar')?attr(first(bullet,'a:buChar'),'char')+' ':'';
        const numbering=first(bullet,'a:buAutoNum');if(numbering){const type=attr(numbering,'type'),value=(numbers.get(level)??(num(attr(numbering,'startAt'),1,1,32767)-1))+1;numbers.set(level,value);for(const k of numbers.keys())if(k>level)numbers.delete(k);const format=type.startsWith('alphaLc')?4:type.startsWith('alphaUc')?3:type.startsWith('romanLc')?2:type.startsWith('romanUc')?1:0;marker=(type.endsWith('ParenBoth')?'(':'')+numberLabel(value,format)+(type.includes('Paren')?') ':type.endsWith('Plain')?' ':'. ');}
        for(const [name,key]of [['lnSpc','line-height'],['spcBef','margin-top'],['spcAft','margin-bottom']]){const node=[...layer].reverse().map(n=>first(n,'a:'+name)).find(Boolean);if(!node)continue;const points=first(node,'a:spcPts'),percent=first(node,'a:spcPct');if(points)css[key]=pt(num(attr(points,'val'),0,0,99900)/100);else if(percent){const ratio=Math.round(num(attr(percent,'val'),100000,0,1000000)/100)/1000;css[key]=key==='line-height'?String(Math.max(.5,ratio)):ratio+'em';}}
        let contents=esc(marker);
        for(const run of p.children||[]) {
          if(run.name==='a:br'){contents+='<br>';continue;}
          if(!['a:r','a:fld'].includes(run.name))continue;
          const runCss=runStyle(first(run,'a:rPr'),base);
          const baseline=num(attr(first(run,'a:rPr'),'baseline')),tag=baseline>0?'sup':baseline<0?'sub':'span';for(const piece of fontRuns(text(first(run,'a:t')),runFonts.get(runCss)))contents+='<'+tag+' class="'+registered.add({...runCss,'font-family':piece.family})+'">'+esc(piece.text)+'</'+tag+'>';
        }
        return '<p class="'+registered.add(css)+'">'+contents+'</p>';
      }).join('');
    }
    function transform(shape,fallbacks,parent) {
      const props=first(shape,'p:spPr')||first(shape,'p:grpSpPr');
      const xfrm=first(props,'a:xfrm')||first(shape,'p:xfrm')||fallbacks.map(value=>first(first(value,'p:spPr'),'a:xfrm')).find(Boolean);
      if(!xfrm)return null;
      const offset=first(xfrm,'a:off'),extent=first(xfrm,'a:ext');
      const x=num(attr(offset,'x'))/12700,y=num(attr(offset,'y'))/12700,cx=num(attr(extent,'cx'),0,0,36576000)/12700,cy=num(attr(extent,'cy'),0,0,36576000)/12700;
      const result={x:parent.x+x*parent.sx,y:parent.y+y*parent.sy,width:cx*parent.sx,height:cy*parent.sy,rotation:num(attr(xfrm,'rot'),0,-21600000,21600000)/60000};
      const childOffset=first(xfrm,'a:chOff'),childExtent=first(xfrm,'a:chExt');
      if(childExtent){result.sx=parent.sx*cx/(num(attr(childExtent,'cx'),12700,1,36576000)/12700);result.sy=parent.sy*cy/(num(attr(childExtent,'cy'),12700,1,36576000)/12700);result.x-=num(attr(childOffset,'x'))/12700*result.sx;result.y-=num(attr(childOffset,'y'))/12700*result.sy;}
      return result;
    }
    async function shapeHtml(shape,relations,parent={x:0,y:0,sx:1,sy:1},isBackground=false) {
      if(++count>4000)throw Error('documentTooComplex');
      if(isBackground&&ph(shape))return '';
      const inheritedLayout=matchPlaceholder(shape,layout),inheritedMaster=matchPlaceholder(shape,master);
      const inherited=inheritedLayout||inheritedMaster;
      const position=transform(shape,[inheritedLayout,inheritedMaster],parent);
      if(shape.name==='p:grpSp') {
        const group=position&&position.sx?position:parent;
        let html='';for(const node of shape.children||[])if(['p:sp','p:pic','p:graphicFrame','p:grpSp','p:cxnSp'].includes(node.name)){html+=await shapeHtml(node,relations,group,isBackground);if(html.length>40*1024*1024)throw Error('documentTooLarge');}return html;
      }
      if(!position)return '';
      const css={position:'absolute',left:pt(position.x),top:pt(position.y),width:pt(position.width),height:pt(position.height),overflow:'hidden',
        transform:position.rotation?'rotate('+Math.round(position.rotation*1000)/1000+'deg)':undefined};
      const properties=first(shape,'p:spPr');
      if(shape.name==='p:pic') {
        const embed=attr(all(shape,'a:blip')[0],'r:embed'),target=relations.get(embed)?.path,src=await pkg.image(target);
        if(!src)return '';
        return '<div class="cg-shape '+registered.add(css)+'"><img class="cg-slide-picture" src="'+src+'" alt="'+esc(attr(all(shape,'p:cNvPr')[0],'descr'))+'"></div>';
      }
      css['background-color']=drawingColor(first(properties,'a:solidFill'),colors)||undefined;
      const line=first(properties,'a:ln');
      if(line&&!first(line,'a:noFill'))for(const side of ['top','right','bottom','left']){
        css['border-'+side+'-style']='solid';css['border-'+side+'-width']=pt(num(attr(line,'w'),12700,0,127000)/12700);css['border-'+side+'-color']=drawingColor(first(line,'a:solidFill'),colors)||'#bfc3c8';
      }
      const preset=attr(first(properties,'a:prstGeom'),'prst');if(preset==='ellipse')css['border-radius']='50%';else if(preset==='roundRect')css['border-radius']='8pt';
      let body='';
      if(shape.name==='p:graphicFrame') {
        const table=all(shape,'a:tbl')[0];
        if(!table)return '';
        body='<table><colgroup>'+children(first(table,'a:tblGrid'),'a:gridCol').map(col=>'<col class="'+registered.add({width:pt(num(attr(col,'w'),12700,0,36576000)/12700)})+'">').join('')+'</colgroup>';
        for(const row of children(table,'a:tr')) {
          body+='<tr class="'+registered.add({height:pt(num(attr(row,'h'),0,0,36576000)/12700)})+'">';
          for(const cell of children(row,'a:tc')) {
            if(attr(cell,'hMerge')==='1'||attr(cell,'vMerge')==='1')continue;
            const cellCss=registered.add({'background-color':drawingColor(first(first(cell,'a:tcPr'),'a:solidFill'),colors)});
            body+='<td class="'+cellCss+'" colspan="'+num(attr(cell,'gridSpan'),1,1,1000)+'" rowspan="'+num(attr(cell,'rowSpan'),1,1,1000)+'">'+paragraphs(first(cell,'a:txBody'),null,'other')+'</td>';
          }
          body+='</tr>';
        }
        body+='</table>';
      } else {
        const tx=first(shape,'p:txBody'),bodyPr=first(tx,'a:bodyPr');
        for(const [short,side] of [['l','left'],['r','right'],['t','top'],['b','bottom']])css['padding-'+side]=pt(num(attr(bodyPr,short+'Ins'),short==='l'||short==='r'?91440:45720,0,1828800)/12700);
        body=paragraphs(tx,first(inherited,'p:txBody'),attr(ph(shape),'type','other'));
      }
      return '<div class="cg-shape '+registered.add(css)+'">'+body+'</div>';
    }
    const bgRel=attr(all(backgroundProperties,'a:blip')[0],'r:embed');
    let backgroundImage='';
    if(bgRel){const reference=[slideRels,layoutRels,masterRels].map(map=>map.get(bgRel)).find(Boolean);const src=await pkg.image(reference?.path);if(src)backgroundImage='<img class="cg-slide-background" src="'+src+'" alt="">';}
    let html='<div class="cg-slide '+canvas+'">'+backgroundImage;
    for(const [root,relationships,isBackground] of [[master,masterRels,true],[layout,layoutRels,true],[slide,slideRels,false]]) {
      if(isBackground&&attr(slide,'showMasterSp')==='0')continue;
      const tree=first(first(root,'p:cSld'),'p:spTree');
      for(const shape of tree?.children||[])if(['p:sp','p:pic','p:graphicFrame','p:grpSp','p:cxnSp'].includes(shape.name)){html+=await shapeHtml(shape,relationships,undefined,isBackground);if(outputSize+html.length>40*1024*1024)throw Error('documentTooLarge');}
    }
    html+='</div>';
    outputSize+=html.length;if(outputSize>40*1024*1024)throw Error('documentTooLarge');
    const titleShape=all(slide,'p:sp').find(shape=>['title','ctrTitle'].includes(attr(ph(shape),'type')));
    const title=all(titleShape,'a:t').map(text).join(' ').trim().slice(0,100);
    parts.push({name:String(index+1)+(title?' · '+title:''),html});
  }
  return {parts,formatting:{kind:'pptx',styles:registered.values}};
}
module.exports={presentation};
