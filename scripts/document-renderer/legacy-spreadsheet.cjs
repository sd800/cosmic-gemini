const {compound}=require('./compound.cjs');
const {esc,styles}=require('./office-package.cjs');
function spreadsheet(input,XLSX){
  let bytes=new Uint8Array(input);
  if(bytes[0]===0xd0){const streams=compound(input);bytes=streams.get('Workbook')||streams.get('Book');if(!bytes)throw Error('invalidDocument');}
  // Parse only the BIFF workbook stream; never hand OLE embedded objects to the
  // library. FILEPASS is rejected even if a library could decode its password.
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let at=0;
  while(at+4<=bytes.length){const id=view.getUint16(at,true),len=view.getUint16(at+2,true);if(id===0x002f)throw Error('invalidDocument');if(at+4+len>bytes.length)throw Error('invalidDocument');at+=4+len;}
  const book=XLSX.read(bytes,{type:'array',cellHTML:false,cellFormula:false,cellStyles:true,bookVBA:false,bookFiles:false,cellDates:false});
  if(!book.SheetNames?.length||book.SheetNames.length>128)throw Error('documentTooComplex');
  const registered=styles(),parts=[];let count=0,output=0;
  for(const [i,name] of book.SheetNames.entries()){
    if(book.Workbook?.Sheets?.[i]?.Hidden)continue;
    const sheet=book.Sheets[name],range=XLSX.utils.decode_range(sheet['!ref']||'A1');
    if(range.e.r>19999||range.e.c>255||range.s.r<0||range.s.c<0||(range.e.r+1)*(range.e.c+1)>100000)throw Error('documentTooComplex');
    const merges=new Map(),covered=new Set();
    for(const m of sheet['!merges']||[]){if(m.s.r<0||m.s.c<0||m.e.r>19999||m.e.c>255||m.e.r<m.s.r||m.e.c<m.s.c||(m.e.r-m.s.r+1)*(m.e.c-m.s.c+1)>50000)throw Error('documentTooComplex');merges.set(m.s.r+':'+m.s.c,m);for(let r=m.s.r;r<=m.e.r;r++)for(let c=m.s.c;c<=m.e.c;c++){if(covered.size>100000)throw Error('documentTooComplex');if(r!==m.s.r||c!==m.s.c)covered.add(r+':'+c);}}
    let html='<div class="cg-sheet"><table><thead><tr><th></th>';
    for(let c=0;c<=range.e.c;c++)html+='<th>'+XLSX.utils.encode_col(c)+'</th>';html+='</tr></thead><tbody>';
    for(let r=0;r<=range.e.r;r++){
      if(sheet['!rows']?.[r]?.hidden)continue;
      html+='<tr><th>'+String(r+1)+'</th>';
      for(let c=0;c<=range.e.c;c++){
        if(++count>150000)throw Error('documentTooComplex');if(covered.has(r+':'+c))continue;
        const cell=sheet[XLSX.utils.encode_cell({r,c})],merge=merges.get(r+':'+c),value=cell?cell.w??XLSX.utils.format_cell(cell):'';
        html+='<td'+(merge?' rowspan="'+(merge.e.r-merge.s.r+1)+'" colspan="'+(merge.e.c-merge.s.c+1)+'"':'')+'>'+esc(value)+'</td>';
      }
      html+='</tr>';
    }
    html+='</tbody></table></div>';output+=html.length;if(output>32*1024*1024)throw Error('documentTooLarge');parts.push({name:name.slice(0,120),html});
  }
  if(!parts.length)throw Error('invalidDocument');return {parts,formatting:{kind:'xlsx',styles:registered.values}};
}
module.exports={spreadsheet};
