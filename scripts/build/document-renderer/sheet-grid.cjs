// One bounded walk of merge areas, shared by BIFF and OOXML. Hidden roots keep
// their content in the first visible cell without shifting neighboring cells.
function sheetGrid(merges,lastRow,lastCol,hiddenRows,hiddenCols) {
  let visits=0;
  for(const m of merges){
    if(![m.s.r,m.s.c,m.e.r,m.e.c].every(Number.isInteger)||m.s.r<0||m.s.c<0||m.e.r<m.s.r||m.e.c<m.s.c||m.e.r>19999||m.e.c>255)throw Error('documentTooComplex');
    visits+=(m.e.r-m.s.r+1)*(m.e.c-m.s.c+1);
    if(visits>150000)throw Error('documentTooComplex');
    lastRow=Math.max(lastRow,m.e.r);lastCol=Math.max(lastCol,m.e.c);
  }
  if((lastRow+1)*(lastCol+1)>150000)throw Error('documentTooComplex');
  const rows=Array.from({length:lastRow+1},(_,i)=>i).filter(i=>!hiddenRows.has(i));
  const cols=Array.from({length:lastCol+1},(_,i)=>i).filter(i=>!hiddenCols.has(i));
  const covered=new Set(),shown=new Map();
  for(const m of merges){
    let firstRow=-1,firstCol=-1,rowspan=0,colspan=0;
    for(let r=m.s.r;r<=m.e.r;r++)if(!hiddenRows.has(r)){if(firstRow<0)firstRow=r;rowspan++;}
    for(let c=m.s.c;c<=m.e.c;c++)if(!hiddenCols.has(c)){if(firstCol<0)firstCol=c;colspan++;}
    for(let r=m.s.r;r<=m.e.r;r++)for(let c=m.s.c;c<=m.e.c;c++){
      const key=r+':'+c;if(covered.has(key))throw Error('invalidDocument');covered.add(key);
    }
    if(rowspan&&colspan)shown.set(firstRow+':'+firstCol,{...m,rowspan,colspan});
  }
  return {rows,cols,covered,shown};
}
module.exports={sheetGrid};
