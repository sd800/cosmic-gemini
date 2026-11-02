const {compound}=require('./compound.cjs');
const {esc,styles,pt}=require('./office-package.cjs');
const {sheetGrid}=require('./sheet-grid.cjs');
const {excelFormatting}=require('./legacy-excel-format.cjs');
function spreadsheet(input,XLSX){
  let bytes=new Uint8Array(input);
  if(bytes[0]===0xd0){const streams=compound(input);bytes=streams.get('Workbook')||streams.get('Book');if(!bytes)throw Error('invalidDocument');}
  // Parse only the BIFF workbook stream; never hand OLE embedded objects to the
  // library. FILEPASS is rejected even if a library could decode its password.
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let at=0;
  while(at+4<=bytes.length){const id=view.getUint16(at,true),len=view.getUint16(at+2,true);if(id===0x002f)throw Error('invalidDocument');if(at+4+len>bytes.length)throw Error('invalidDocument');at+=4+len;}
  const visual=excelFormatting(bytes);
  const book=XLSX.read(bytes,{type:'array',cellHTML:false,cellFormula:false,cellStyles:true,bookVBA:false,bookFiles:false,cellDates:false});
  if(!book.SheetNames?.length||book.SheetNames.length>128)throw Error('documentTooComplex');
  const registered=styles(),parts=[];let count=0,output=0;
  for(const [i,name] of book.SheetNames.entries()){
    if(book.Workbook?.Sheets?.[i]?.Hidden)continue;
    const sheet=book.Sheets[name],range=XLSX.utils.decode_range(sheet['!ref']||'A1'),layout=visual.sheets[i];
    if(range.e.r>19999||range.e.c>255||range.s.r<0||range.s.c<0||(range.e.r+1)*(range.e.c+1)>100000)throw Error('documentTooComplex');
    const hiddenCols=new Set(),hiddenRows=new Set();
    for(let c=0;c<=range.e.c;c++)if(layout?.cols.get(c)?.hidden||sheet['!cols']?.[c]?.hidden)hiddenCols.add(c);
    for(let r=0;r<=range.e.r;r++)if(layout?.rows.get(r)?.hidden||sheet['!rows']?.[r]?.hidden)hiddenRows.add(r);
    const {rows:visibleRows,cols:visibleCols,shown,covered}=sheetGrid(sheet['!merges']||[],range.e.r,range.e.c,hiddenRows,hiddenCols);
    let html='<div class="cg-sheet"><table><colgroup><col class="cg-row-number">';
    for(const c of visibleCols)html+='<col class="'+registered.add({width:pt(layout?.cols.get(c)?.width||layout?.defaultWidth||64)})+'">';
    html+='</colgroup><thead><tr><th></th>';
    for(const c of visibleCols)html+='<th>'+XLSX.utils.encode_col(c)+'</th>';html+='</tr></thead><tbody>';
    for(const r of visibleRows){
      const row=layout?.rows.get(r),height=row?.height||layout?.defaultHeight;
      html+='<tr class="'+registered.add({height:height?pt(Math.min(600,height)):undefined})+'"><th>'+String(r+1)+'</th>';
      for(const c of visibleCols){
        if(++count>150000)throw Error('documentTooComplex');const merge=shown.get(r+':'+c);if(covered.has(r+':'+c)&&!merge)continue;
        const origin=merge?merge.s:{r,c},cell=sheet[XLSX.utils.encode_cell(origin)],value=cell?cell.w??XLSX.utils.format_cell(cell):'';
        const xf=layout?.cells.get(origin.r+':'+origin.c)??row?.xf??layout?.cols.get(c)?.xf??0;
        const css={...visual.style(xf)};if(!css['text-align'])css['text-align']=cell?.t==='n'?'right':cell?.t==='b'||cell?.t==='e'?'center':'left';
        html+='<td class="'+registered.add(css)+'"'+(merge?' rowspan="'+merge.rowspan+'" colspan="'+merge.colspan+'"':'')+'>'+esc(value)+'</td>';
      }
      html+='</tr>';
    }
    html+='</tbody></table></div>';output+=html.length;if(output>32*1024*1024)throw Error('documentTooLarge');parts.push({name:name.slice(0,120),html});
  }
  if(!parts.length)throw Error('invalidDocument');return {parts,formatting:{kind:'xlsx',styles:registered.values}};
}
module.exports={spreadsheet};
