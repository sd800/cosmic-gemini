const {fontFamily}=require('./legacy-binary.cjs');
// Original/localized names stay first. These are local substitutes only, never
// downloaded or extracted fonts; a missing typeface cannot be restored exactly.
const aliases=[
  [['SimSun','宋体','NSimSun','新宋体'],['Songti SC','STSong'],'serif'],
  [['SimHei','黑体'],['Heiti SC','STHeiti'],'sans-serif'],
  [['Microsoft YaHei','微软雅黑','DengXian','等线'],['PingFang SC','Heiti SC'],'sans-serif'],
  [['KaiTi','楷体'],['Kaiti SC','STKaiti'],'serif'],
  [['KaiTi_GB2312','楷体_GB2312'],['KaiTi','楷体','Kaiti SC','STKaiti'],'serif'],
  [['FangSong','仿宋'],['STFangsong','Songti SC'],'serif'],
  [['FangSong_GB2312','仿宋_GB2312'],['FangSong','仿宋','STFangsong','Songti SC'],'serif'],
  [['STZhongsong','华文中宋'],['Songti SC','STSong'],'serif'],
  [['STFangsong','华文仿宋'],['FangSong','Songti SC'],'serif'],
  [['STKaiti','华文楷体'],['Kaiti SC','KaiTi'],'serif'],
  [['MingLiU','PMingLiU','新細明體','細明體'],['Songti TC','LiSong Pro'],'serif'],
  [['Microsoft JhengHei','微軟正黑體'],['PingFang TC','Heiti TC'],'sans-serif'],
  [['DFKai-SB','標楷體'],['BiauKai','Kaiti TC'],'serif'],
  [['Calibri'],['Carlito','Helvetica'],'sans-serif'],
  [['Cambria'],['Caladea','Georgia'],'serif'],
  [['Arial'],['Helvetica','Liberation Sans'],'sans-serif'],
  [['Times New Roman'],['Times','Liberation Serif'],'serif'],
  [['Courier New'],['Courier','Liberation Mono'],'monospace']
];
const lookup=new Map();for(const [names,fallbacks,generic]of aliases)for(const name of names)lookup.set(name.toLowerCase(),{names,fallbacks,generic});
const cache=new Map();
function localFont(names,generic='serif') {
  names=names.filter(name=>typeof name==='string'&&name.length<=80).slice(0,8).map(name=>name.replace(/^@/,''));
  const key=generic+':'+names.join('\0');if(cache.has(key))return cache.get(key);
  const mapped=lookup.get(names[0]?.toLowerCase());
  const value=fontFamily([...names,...(mapped?.names||[]),...(mapped?.fallbacks||[])],mapped?.generic||generic);
  if(cache.size>=256)cache.delete(cache.keys().next().value);cache.set(key,value);return value;
}
const east=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}\u3000-\u303f\uff00-\uffef]/u;
// Split only where font selection changes; runs with identical source fonts
// remain one span, irrespective of language or punctuation.
function fontRuns(text,families) {
  if(!families||families.east===families.ascii&&families.other===families.ascii)return [{text,family:families?.ascii}];
  const out=[];let last;
  for(const match of text.matchAll(/[\x00-\x7f]+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}\u3000-\u303f\uff00-\uffef]+|[^\x00-\x7f\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}\u3000-\u303f\uff00-\uffef]+/gu)){const ch=match[0],family=east.test(String.fromCodePoint(ch.codePointAt(0)))?families.east:ch.codePointAt(0)>127?families.other:families.ascii;
    if(last&&last.family===family)last.text+=ch;else {if(out.length>=100000)throw Error('documentTooComplex');last={text:ch,family};out.push(last);}
  }return out;
}
module.exports={localFont,fontRuns};
