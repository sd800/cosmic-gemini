const {fontRuns}=require('./fonts.cjs');
const {compound}=require('./compound.cjs');
const {esc,styles}=require('./office-package.cjs');
const {wordFormatting,properties,setBorder}=require('./legacy-word-format.cjs');
// MS-DOC 2.4.1: the CLX piece table selects the current text, so saved/deleted
// bytes elsewhere in WordDocument never become visible simply by scanning it.
function word(buffer) {
  const streams=compound(buffer), bytes=streams.get('WordDocument');
  if(!bytes||bytes.length<154)throw Error('invalidDocument');
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const u16=at=>v.getUint16(at,true),u32=at=>v.getUint32(at,true);
  if(u16(0)!==0xa5ec||u16(2)<0xc1||(u16(10)&0x8100))throw Error('invalidDocument');
  const table=streams.get((u16(10)&0x200)?'1Table':'0Table');if(!table)throw Error('invalidDocument');
  let at=32,words=u16(at);at+=2+words*2;
  const longs=u16(at);at+=2; if(longs<11||at+longs*4+2>bytes.length)throw Error('invalidDocument');
  const lengths=[u32(at+12),u32(at+16),u32(at+20),u32(at+28),u32(at+32),u32(at+36),u32(at+40)];
  at+=longs*4;const pairs=u16(at);at+=2;
  if(pairs<34||at+pairs*8>bytes.length)throw Error('invalidDocument');
  const entries=Array.from({length:pairs},(_,i)=>({start:u32(at+i*8),length:u32(at+i*8+4)}));
  const start=entries[33].start,length=entries[33].length;
  if(start+length>table.length||length<5||lengths.reduce((a,b)=>a+b,0)>8*1024*1024)throw Error('invalidDocument');
  const tv=new DataView(table.buffer,table.byteOffset,table.byteLength),prms=[];let p=start;
  while(p<start+length&&table[p]===1){if(p+3>start+length)throw Error('invalidDocument');const size=tv.getUint16(p+1,true);if(p+3+size>start+length||prms.length>32767)throw Error('invalidDocument');prms.push(properties(table.subarray(p+3,p+3+size)));p+=3+size;}
  if(p+5>start+length||table[p]!==2)throw Error('invalidDocument');
  const plcSize=tv.getUint32(p+1,true);p+=5;
  const n=(plcSize-4)/12;
  if(!Number.isInteger(n)||n<0||n>200000||p+plcSize>start+length)throw Error('invalidDocument');
  const simplePrm={5:0x2461,9:0x2407,12:0x260a,24:0x2416,25:0x2417,77:0x2a0c,85:0x0835,86:0x0836,87:0x0837,90:0x083a,91:0x083b,92:0x083c,94:0x2a3e,98:0x2a42,104:0x2a48,115:0x2a53,120:0x2640};
  const pieces=[],max=lengths.reduce((a,b)=>a+b,0);let expected=0;
  for(let i=0;i<n;i++){
    const cp=tv.getUint32(p+i*4,true),end=tv.getUint32(p+(i+1)*4,true);
    const fc=tv.getUint32(p+(n+1)*4+i*8+2,true),compressed=!!(fc&0x40000000),offset=(fc&0x3fffffff)/(compressed?2:1);
    if(cp!==expected||end<cp||end>max+1||offset%1||offset+(end-cp)*(compressed?1:2)>bytes.length)throw Error('invalidDocument');
    const text=new TextDecoder(compressed?'windows-1252':'utf-16le').decode(bytes.subarray(offset,offset+(end-cp)*(compressed?1:2)));
    const prm=tv.getUint16(p+(n+1)*4+i*8+6,true);
    if((prm&1)&&(prm>>>1)>=prms.length)throw Error('invalidDocument');
    const op=simplePrm[(prm>>>1)&127],extra=prm&1?prms[prm>>>1]:op?properties(new Uint8Array([op&255,op>>>8,prm>>>8])):[];
    pieces.push({text,cp,end,offset,step:compressed?1:2,extra});expected=end;
  }
  if(expected<lengths[0])throw Error('invalidDocument');
  const formatting=wordFormatting(bytes,table,entries,streams.get('Data')),registered=styles();
  // Mask field instructions without changing CP offsets used by formatting.
  const source=pieces.map(piece=>piece.text).join(''),fields=[],chunks=[];
  for(const match of source.matchAll(/[\x13-\x15]|[^\x13-\x15]+/g)){
    const value=match[0];if(value==='\x13'){if(fields.length>=80)throw Error('documentTooComplex');fields.push(false);chunks.push('\0');}
    else if(value==='\x14'){if(fields.length)fields[fields.length-1]=true;chunks.push('\0');}
    else if(value==='\x15'){fields.pop();chunks.push('\0');}
    else chunks.push(fields.every(Boolean)?value:'\0'.repeat(value.length));
  }
  const visible=chunks.join('');
  function pieceAt(cp){let lo=0,hi=pieces.length;while(lo<hi){const mid=(lo+hi)>>>1;if(pieces[mid].end<=cp)lo=mid+1;else hi=mid;}const piece=pieces[lo];if(!piece)throw Error('invalidDocument');return piece;}
  const clean=text=>text.replace(/[\x00-\x08\x0e-\x1f]/g,'').replace(/\x0b/g,'\n');
  let nodes=0;
  function runs(begin,end,state){let html='';for(let cp=begin;cp<end;){
    if(++nodes>120000)throw Error('documentTooComplex');
    const piece=pieceAt(cp),fc=piece.offset+(cp-piece.cp)*piece.step,run=formatting.character(fc,state,piece.extra),stop=Math.min(end,piece.end,cp+Math.max(1,Math.ceil((run.end-fc)/piece.step)));
    const text=clean(visible.slice(cp,stop));if(text&&!run.hidden){const tag=run.script===1?'sup':run.script===2?'sub':'span';for(const part of fontRuns(text,run.families)){if(++nodes>120000)throw Error('documentTooComplex');html+='<'+tag+' class="'+registered.add({...run.css,'font-family':part.family})+'">'+esc(part.text)+'</'+tag+'>';}}
    cp=stop;
  }return html;}
  function renderStory(begin,length){
    const out=[],rows=[];let cell='',cells=[],count=0;
    function finishRow(state){if(cell)cells.push(cell);cell='';if(cells.length){if(rows.length>=10000||cells.length>63)throw Error('documentTooComplex');rows.push({cells:cells.map(html=>({html,span:1,down:1})),state});}cells=[];}
    function flushTable(){
      finishRow({});if(!rows.length)return;
      // Only merge consecutive cells described by the current live row data.
      const vertical=new Map();let body='';
      for(const {cells,state}of rows){let previous=null;
        for(let i=0;i<cells.length;i++){
          const c=cells[i],meta=state.cells?.[i];c.css={...meta?.css};if(state.shades?.[i])c.css['background-color']=state.shades[i];
          if(state.borders)for(const [j,side]of ['top','left','bottom','right'].entries())if(!meta)setBorder(c.css,side,state.borders[j]);
          if(meta?.merge===1&&previous){previous.span++;const sum=parseFloat(previous.css.width)+parseFloat(c.css.width);if(Number.isFinite(sum))previous.css.width=sum+'pt';c.skip=true;continue;}
          previous=c;
          if(meta?.vertical===1&&vertical.has(i)){vertical.get(i).down++;c.skip=true;}else if(meta?.vertical===3)vertical.set(i,c);else vertical.delete(i);
        }
      }
      for(const {cells,state}of rows){body+='<tr class="'+registered.add({height:state.rowHeight?Math.min(600,state.rowHeight)+'pt':undefined})+'">'+cells.filter(c=>!c.skip).map(c=>'<td class="'+registered.add(c.css)+'" colspan="'+c.span+'" rowspan="'+c.down+'">'+c.html+'</td>').join('')+'</tr>';}
      out.push('<table class="'+registered.add({'table-layout':'fixed',width:rows.find(r=>r.state.tableWidth)?.state.tableWidth||'100%'})+'"><tbody>'+body+'</tbody></table>');rows.length=0;
    }
    for(const match of visible.slice(begin,begin+length).matchAll(/[^\r\x07]*[\r\x07]|[^\r\x07]+$/g)){
      if(++count>100000)throw Error('documentTooComplex');
      const start=begin+match.index,raw=match[0],terminated=/[\r\x07]$/.test(raw),end=start+raw.length-(terminated?1:0),mark=terminated?end:Math.max(start,end-1),piece=pieceAt(mark);
      const state=formatting.paragraph(piece.offset+(mark-piece.cp)*piece.step,piece.extra);
      let content='',cursor=start;
      for(const segment of visible.slice(start,end).split('\f')){
        if(cursor>start)content+='<hr class="cg-page-break">';
        const tag=state.heading?'h'+state.heading:'p',css={...state.css};delete css['text-decoration-line'];
        content+='<'+tag+' class="'+registered.add(css)+'">'+(state.marker?'<span class="cg-list-marker '+registered.add(state.markerCss||{})+'">'+esc(state.marker)+'</span>':'')+runs(cursor,cursor+segment.length,state)+'</'+tag+'>';cursor+=segment.length+1;
      }
      if(state.inTable||state.rowEnd||raw.endsWith('\x07')){
        if(!state.rowEnd||clean(visible.slice(start,end)).trim())cell+=content;
        if(state.rowEnd)finishRow(state);else if(raw.endsWith('\x07')){cells.push(cell);cell='';}
      }else{flushTable();if(state.breakBefore)out.push('<hr class="cg-page-break">');out.push(content);}
    }
    flushTable();return out.join('');
  }
  let html=renderStory(0,lengths[0]);
  // Footnotes/endnotes/text boxes are separate stories; don't expose comments or
  // hidden metadata. Append readable secondary text without inferring layout.
  let offset=lengths[0];for(let i=1;i<lengths.length;i++){if([1,4,5].includes(i)&&lengths[i])html+='<hr>'+renderStory(offset,lengths[i]);offset+=lengths[i];}
  if(html.length>32*1024*1024)throw Error('documentTooLarge');
  return {value:html,formatting:{styles:registered.values,page:formatting.page}};
}
module.exports={word};
