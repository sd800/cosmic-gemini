const {localFont}=require('./fonts.cjs');
// Read only formatting properties. Relationship targets and document CSS never
// enter this model. All emitted values are checked again at the display boundary.
const first = (node, name) => node?.children?.find(child => child.name === name);
const children = (node, name) => (node?.children || []).filter(child => child.name === name);
const attr = (node, key = 'val') => node?.attributes?.['w:' + key];
const value = (node, name, key = 'val') => attr(first(node, 'w:' + name), key);
const on = item => item != null && !['0', 'false', 'off', 'none'].includes(item.val);
const number = (input, min, max) => input != null && /^-?\d+(?:\.\d+)?$/.test(input) ? Math.max(min, Math.min(max, Number(input))) : undefined;
const rounded = num => String(Math.round(num * 1000) / 1000);
const points = (input, divisor = 20, min = 0, max = 144) => {
  const num = number(input, min * divisor, max * divisor);
  return num == null ? undefined : rounded(num / divisor) + 'pt';
};
const containers = new Set(['numPr', 'tblBorders', 'tcBorders', 'pBdr', 'tblCellMar', 'tcMar', 'tabs']);
function properties(node) {
  const result = Object.create(null);
  for (const child of node?.children || []) {
    if (!child.name?.startsWith('w:')) continue;
    const name = child.name.slice(2);
    if (containers.has(name)) result[name] = properties(child);
    else if (!child.children?.some(item => item.type === 'element')) {
      result[name] = Object.fromEntries(Object.entries(child.attributes || {}).filter(([key]) => key.startsWith('w:')).map(([key, val]) => [key.slice(2), val]));
    }
  }
  return result;
}
function merge(...sources) {
  const result = Object.create(null);
  for (const source of sources) for (const [key, val] of Object.entries(source || {})) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
    const inherited=key==='rFonts'?{...result[key]}:result[key];
    if(key==='rFonts'&&val)for(const [name,themeKey]of [['ascii','asciiTheme'],['hAnsi','hAnsiTheme'],['eastAsia','eastAsiaTheme'],['cs','cstheme']])if(val[name]&&!val[themeKey])delete inherited[themeKey];
    result[key] = val && typeof val === 'object' && !Array.isArray(val) ? merge(inherited, val) : val;
  }
  return result;
}
const toggles = ['b', 'i', 'strike', 'dstrike', 'caps', 'smallCaps'];
function styledRun(base, layers) {
  let result = merge(base);
  for (const layer of layers || []) {
    const next = merge(result, layer);
    // In style definitions these are toggles; direct run properties are not.
    for (const key of toggles) if (layer[key]) next[key] = { val: String(on(result[key]) !== on(layer[key])) };
    result = next;
  }
  return result;
}
function clean(result) { return Object.fromEntries(Object.entries(result).filter(([, val]) => val !== undefined)); }
function color(spec, theme) {
  if (!spec) return undefined;
  let hex = theme.colors[spec.themeColor || spec.themeFill] || spec.val || spec.fill;
  if (!/^[a-f\d]{6}$/i.test(hex || '')) return hex === 'auto' ? 'inherit' : undefined;
  let rgb = hex.match(/../g).map(part => parseInt(part, 16));
  const shade = spec.themeShade || spec.themeFillShade, tint = spec.themeTint || spec.themeFillTint;
  if (/^[a-f\d]{2}$/i.test(shade || '')) rgb = rgb.map(c => c * parseInt(shade, 16) / 255);
  if (/^[a-f\d]{2}$/i.test(tint || '')) rgb = rgb.map(c => c + (255 - c) * (1 - parseInt(tint, 16) / 255));
  return '#' + rgb.map(c => Math.round(c).toString(16).padStart(2, '0')).join('');
}
const highlightColors = { black:'000000', blue:'0000ff', cyan:'00ffff', green:'00ff00', magenta:'ff00ff', red:'ff0000', yellow:'ffff00', white:'ffffff', darkBlue:'000080', darkCyan:'008080', darkGreen:'008000', darkMagenta:'800080', darkRed:'800000', darkYellow:'808000', darkGray:'808080', lightGray:'c0c0c0' };
function fontFamilies(run,theme) {
  const fonts=run.rFonts;if(!fonts)return {};
  const name=(key,themeKey)=>theme.fonts[fonts[themeKey]]||fonts[key];
  let east=name('eastAsia','eastAsiaTheme');
  const locale=run.lang?.eastAsia||'',script=/^ja/i.test(locale)?'Jpan':/^ko/i.test(locale)?'Hang':/Hant|-(TW|HK|MO)$/i.test(locale)?'Hant':'Hans';
  const themeName=fonts.eastAsiaTheme;if(themeName&&theme.fonts[themeName+'Scripts']?.[script])east=theme.fonts[themeName+'Scripts'][script];
  const ascii=localFont([name('ascii','asciiTheme')||name('hAnsi','hAnsiTheme')||east],'sans-serif');
  return {ascii,east:localFont([east])||ascii,other:localFont([name('hAnsi','hAnsiTheme')])||ascii};
}
function runCss(run, theme) {
  const underline = run.u && !['none','0','false'].includes(run.u.val), strike = on(run.strike) || on(run.dstrike);
  return clean({
    'font-family':fontFamilies(run,theme).ascii, 'font-size':points(run.sz?.val || run.szCs?.val, 2, 4, 96),
    'font-weight':run.b ? (on(run.b) ? '700' : '400') : undefined,
    'font-style':run.i ? (on(run.i) ? 'italic' : 'normal') : undefined,
    color:color(run.color, theme),
    'background-color':run.highlight ? (highlightColors[run.highlight.val] ? '#' + highlightColors[run.highlight.val] : 'transparent') : color(run.shd && {...run.shd, val:run.shd.fill}, theme),
    'text-decoration-line':run.u || run.strike || run.dstrike ? ([underline && 'underline', strike && 'line-through'].filter(Boolean).join(' ') || 'none') : undefined,
    'text-decoration-style':underline ? ({double:'double', dotted:'dotted', dash:'dashed', wave:'wavy'}[run.u.val] || 'solid') : undefined,
    'text-transform':run.caps ? (on(run.caps) ? 'uppercase' : 'none') : undefined,
    'font-variant-caps':run.smallCaps ? (on(run.smallCaps) ? 'small-caps' : 'normal') : undefined,
    'letter-spacing':points(run.spacing?.val, 20, -2, 12)
  });
}
function indentValue(spec, pointKey, charKey, negative = false) {
  const chars = number(spec?.[charKey], 0, 2400);
  const output = chars == null ? points(spec?.[pointKey], 20, -144, 144) : rounded(chars / 100) + 'em';
  return output && negative ? '-' + output : output;
}
function paragraphCss(p, theme) {
  const spacing = p.spacing || {}, ind = p.ind || {};
  const css = runCss({}, theme);
  Object.assign(css, {
    'text-align':({both:'justify',distribute:'justify',center:'center',left:'left',right:'right',start:'start',end:'end'}[p.jc?.val]),
    direction:p.bidi ? (on(p.bidi) ? 'rtl' : 'ltr') : undefined,
    'margin-left':indentValue(ind, ind.start != null ? 'start' : 'left', ind.startChars != null ? 'startChars' : 'leftChars'),
    'margin-right':indentValue(ind, ind.end != null ? 'end' : 'right', ind.endChars != null ? 'endChars' : 'rightChars'),
    'text-indent':ind.hanging != null || ind.hangingChars != null ? indentValue(ind, 'hanging', 'hangingChars', true) : indentValue(ind, 'firstLine', 'firstLineChars'),
    'margin-top':spacing.beforeLines != null ? rounded((number(spacing.beforeLines, 0, 2000) || 0) / 100) + 'em' : points(spacing.before || '0'),
    'margin-bottom':spacing.afterLines != null ? rounded((number(spacing.afterLines, 0, 2000) || 0) / 100) + 'em' : points(spacing.after || '0'),
    'background-color':color(p.shd && {...p.shd,val:p.shd.fill}, theme)
  });
  if (spacing.line != null) {
    const rule = spacing.lineRule || 'auto';
    css['line-height'] = rule === 'auto' ? rounded((number(spacing.line, 120, 2400) || 240) / 240)
      : rule === 'atLeast' ? 'max(1.2em,' + (points(spacing.line, 20, 1, 144) || '12pt') + ')'
      : points(spacing.line, 20, 1, 144);
  }
  for (const side of ['top','bottom','left','right']) Object.assign(css, borderCss(side, p.pBdr?.[side], theme));
  return clean(css);
}
function borderCss(side, spec, theme) {
  if (!spec) return {};
  const style = {nil:'none',none:'none',single:'solid',thick:'solid',double:'double',dotted:'dotted',dashed:'dashed',dashSmallGap:'dashed',dotDash:'dashed',dotDotDash:'dashed'}[spec.val] || 'solid';
  return clean({['border-'+side+'-style']:style,['border-'+side+'-width']:style === 'none' ? '0pt' : points(spec.sz || '4', 8, 0, 12),['border-'+side+'-color']:color({...spec,val:spec.color}, theme)});
}
function width(spec) { return spec?.type === 'pct' ? rounded((number(spec.w, 0, 5000) || 0) / 50) + '%' : spec?.type === 'dxa' ? points(spec.w,20,0,1440) : undefined; }
function tableCss(t, theme) {
  return clean({width:width(t.tblW),'table-layout':t.tblLayout?.type === 'fixed' ? 'fixed' : undefined,
    'margin-left':t.jc?.val === 'center' || t.jc?.val === 'right' ? 'auto' : points(t.tblInd?.w),
    'margin-right':t.jc?.val === 'center' ? 'auto' : t.jc?.val === 'right' ? '0pt' : undefined,
    'background-color':color(t.shd && {...t.shd,val:t.shd.fill},theme)});
}
function cellCss(c, table, position, theme) {
  const css = clean({width:width(c.tcW),'vertical-align':({top:'top',center:'middle',bottom:'bottom'}[c.vAlign?.val]),
    'background-color':color(c.shd && {...c.shd,val:c.shd.fill},theme)});
  for (const side of ['top','bottom','left','right']) {
    const edge = position[side], inside = ['top','bottom'].includes(side) ? 'insideH' : 'insideV';
    Object.assign(css,borderCss(side,c.tcBorders?.[side] || table.tblBorders?.[edge ? side : inside],theme));
    const pad = c.tcMar?.[side] || table.tblCellMar?.[side];
    if (pad?.w != null) css['padding-'+side] = points(pad.w,20,0,36);
  }
  return clean(css);
}
module.exports = {first,children,attr,value,on,number,points,rounded,properties,merge,styledRun,clean,color,fontFamilies,runCss,paragraphCss,tableCss,cellCss};
