// Passive Word content which the upstream semantic converter omits. Construct
// fixed HTML/MathML nodes only: never carry source markup, CSS or relationships.
const P = require('./properties.cjs');
const {fontRuns} = require('./fonts.cjs');

function wordContent(Html, register, theme) {
  let count = 0;
  const el = (name, content = [], attributes = {}) => {
    if (++count > 40000) throw Error('documentTooComplex');
    return Html.freshElement(name, attributes, content);
  };
  const text = (node, depth = 0) => {
    if (++count > 40000 || depth > 64) throw Error('documentTooComplex');
    return node?.type === 'text' ? node.value : (node?.children || []).map(child=>text(child,depth+1)).join('');
  };
  const mval = (node, name, fallback) => P.first(node, 'm:' + name)?.attributes?.['m:val'] ?? fallback;
  function math(node, depth = 0) {
    if (!node) return el('mrow');
    if (++count > 40000 || depth > 64) throw Error('documentTooComplex');
    const name = node.name?.slice(2), props = P.first(node, 'm:' + name + 'Pr');
    const part = name => math(P.first(node, 'm:' + name), depth + 1);
    const descendants = () => (node.children || []).filter(n => n.type === 'element' && !/Pr$/.test(n.name)).map(n => math(n, depth + 1));
    if (name === 't') {
      const tokens = [];
      for(const [t] of text(node).matchAll(/\s+|\d+(?:[.,]\d+)?|[\p{L}]+|[^\s\p{L}\d]/gu))tokens.push(el(/^\s+$/.test(t) ? 'mtext' : /^\d/.test(t) ? 'mn' : /^\p{L}/u.test(t) ? 'mi' : 'mo', [Html.text(t)]));
      return el('mrow', tokens);
    }
    if (name === 'r') {
      const style = mval(P.first(node,'m:rPr'),'sty','i');
      return el('mrow', descendants(), {mathvariant: {p:'normal',b:'bold',bi:'bold-italic',i:'italic'}[style] || 'normal'});
    }
    if (name === 'f') return el('mfrac', [part('num'), part('den')], mval(props,'type') === 'noBar' ? {linethickness:'0'} : {});
    if (name === 'rad') return ['1','true','on'].includes(mval(props,'degHide')) || !text(P.first(node,'m:deg'))
      ? el('msqrt', [part('e')]) : el('mroot', [part('e'), part('deg')]);
    if (name === 'sSup') return el('msup', [part('e'), part('sup')]);
    if (name === 'sSub') return el('msub', [part('e'), part('sub')]);
    if (name === 'sSubSup') return el('msubsup', [part('e'), part('sub'), part('sup')]);
    if (name === 'limLow' || name === 'limUpp') return el(name === 'limLow' ? 'munder' : 'mover', [part('e'), part('lim')]);
    if (name === 'nary') {
      let operator = el('mo', [Html.text(mval(props,'chr','∫'))]);
      const sub = !['1','true'].includes(mval(props,'subHide')) && P.first(node,'m:sub');
      const sup = !['1','true'].includes(mval(props,'supHide')) && P.first(node,'m:sup');
      if (sub || sup) operator = el(sub && sup ? 'munderover' : sub ? 'munder' : 'mover', [operator, ...(sub ? [part('sub')] : []), ...(sup ? [part('sup')] : [])]);
      return el('mrow', [operator, part('e')]);
    }
    if (name === 'd') {
      const out = [el('mo', [Html.text(mval(props,'begChr','('))], {fence:'true',stretchy:'true'})];
      P.children(node,'m:e').forEach((n,i) => { if(i)out.push(el('mo',[Html.text(mval(props,'sepChr','|'))]));out.push(math(n,depth+1)); });
      out.push(el('mo', [Html.text(mval(props,'endChr',')'))], {fence:'true',stretchy:'true'}));return el('mrow', out);
    }
    if (name === 'm') return el('mtable', P.children(node,'m:mr').map(row => el('mtr', P.children(row,'m:e').map(n => el('mtd',[math(n,depth+1)])))));
    if (name === 'eqArr') return el('mtable', P.children(node,'m:e').map(n => el('mtr',[el('mtd',[math(n,depth+1)])])));
    if (name === 'acc' || name === 'bar' || name === 'groupChr') {
      const below = mval(props,'pos','top') === 'bot';
      return el(below?'munder':'mover', [part('e'),el('mo',[Html.text(mval(props,'chr',name==='acc'?'̂':name==='bar'?'―':'⏞'))],{stretchy:'true'})]);
    }
    return el('mrow', descendants());
  }
  function rubyRuns(node, inherited, depth = 0) {
    if (++count > 40000 || depth > 64) throw Error('documentTooComplex');
    if (node?.name === 'w:r') {
      const run = P.merge(inherited,P.properties(P.first(node,'w:rPr')));
      if(P.on(run.vanish)||P.on(run.webHidden))return [];
      return [el('span',(node.children||[]).filter(n=>n.name!=='w:rPr').flatMap(n=>rubyRuns(n,run,depth+1)),{class:register(P.runCss(run,theme))})];
    }
    if (node?.name === 'w:t') return fontRuns(text(node),P.fontFamilies(inherited,theme)).map(part=>el('span',[Html.text(part.text)],{class:register({'font-family':part.family})}));
    if (node?.name === 'w:tab') return [Html.text('\t')];
    if (node?.name === 'w:br') return [el('br')];
    return (node?.children||[]).filter(n=>n.type==='element').flatMap(n=>rubyRuns(n,inherited,depth+1));
  }
  return (node, inherited) => {
    if (node.name === 'm:oMath' || node.name === 'm:oMathPara') {
      const formulas = node.name === 'm:oMathPara' ? P.children(node,'m:oMath') : [node];
      return [el('math',formulas.map(n=>math(n)),{display:node.name==='m:oMathPara'?'block':'inline'})];
    }
    if (node.name === 'w:ruby') {
      const annotation=P.merge(inherited,{sz:{val:P.value(P.first(node,'w:rubyPr'),'hps')||String(Number(inherited.sz?.val||22)/2)}});
      return [el('ruby',[
      ...rubyRuns(P.first(node,'w:rubyBase'),inherited),el('rp',[Html.text('(')]),
      el('rt',rubyRuns(P.first(node,'w:rt'),annotation)),el('rp',[Html.text(')')])
      ])];
    }
    return null;
  };
}
module.exports = {wordContent};
