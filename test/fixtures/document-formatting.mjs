// Small, deterministic OOXML fixture: no office application or network needed.
export function formattingEntries() {
  const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const p = (text, props = '', run = '') => `<w:p><w:pPr>${props}</w:pPr><w:r><w:rPr>${run}</w:rPr><w:t>${text}</w:t></w:r></w:p>`;
  const numbered = (text, level = 0, id = 7) => p(text, `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${id}"/></w:numPr>`);
  return {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="${rel}/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${['styles','numbering','theme'].map(name => `<Relationship Id="${name}" Type="${rel}/${name}" Target="${name === 'theme' ? 'theme/theme1' : name}.xml"/>`).join('')}</Relationships>`,
    'word/theme/theme1.xml': '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:clrScheme><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:accent1><a:srgbClr val="2468AC"/></a:accent1></a:clrScheme><a:fontScheme><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:font script="Hans" typeface="宋体"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>',
    'word/styles.xml': `<w:styles xmlns:w="${w}">
      <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorAscii" w:eastAsiaTheme="minorEastAsia"/><w:sz w:val="24"/><w:color w:val="000000"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120"/></w:pPr></w:pPrDefault></w:docDefaults>
      <w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>
      <w:style w:type="paragraph" w:styleId="Base"><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:line="360" w:lineRule="auto"/><w:ind w:firstLineChars="200"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>
      <w:style w:type="paragraph" w:styleId="Body"><w:name w:val="Body Text"/><w:basedOn w:val="Base"/><w:pPr><w:jc w:val="both"/><w:spacing w:before="80" w:after="200"/></w:pPr></w:style>
      <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="40"/><w:b/><w:color w:themeColor="accent1"/></w:rPr></w:style>
      <w:style w:type="table" w:styleId="Grid"><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="8" w:color="2468AC"/><w:bottom w:val="double" w:sz="12" w:color="2468AC"/><w:insideH w:val="single" w:sz="4" w:color="888888"/></w:tblBorders><w:tblCellMar><w:left w:w="120"/><w:right w:w="120"/></w:tblCellMar></w:tblPr><w:tblStylePr w:type="firstRow"><w:rPr><w:b/></w:rPr><w:tcPr><w:shd w:fill="DDEEFF"/></w:tcPr></w:tblStylePr></w:style>
    </w:styles>`,
    'word/numbering.xml': `<w:numbering xmlns:w="${w}"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="upperRoman"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="360" w:hanging="360"/></w:pPr></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%1.%2)"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="7"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="3"/></w:lvlOverride></w:num></w:numbering>`,
    'word/document.xml': `<w:document xmlns:w="${w}"><w:body>
      ${p('Document Preview — 文档样式示例', '<w:pStyle w:val="Heading1"/><w:jc w:val="center"/>')}
      ${p('保留原文的段落格式。This paragraph uses inherited styles, two-character indentation and 1.5 line spacing.', '<w:pStyle w:val="Body"/>', '<w:b w:val="0"/><w:i/><w:sz w:val="26"/><w:color w:themeColor="accent1"/>')}
      ${p('Highlight and underline', '', '<w:u w:val="double"/><w:highlight w:val="yellow"/>')}
      <w:p/>
      ${numbered('First numbered item')}${numbered('Nested item',1)}${numbered('Second nested item',1)}${numbered('Next top-level item')}${numbered('Restarted nested item',1)}
      <w:tbl><w:tblPr><w:tblStyle w:val="Grid"/><w:tblW w:type="pct" w:w="5000"/><w:tblLook w:firstRow="1"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="4800"/></w:tblGrid><w:tr><w:tc>${p('名称 / Name')}</w:tc><w:tc>${p('说明 / Description')}</w:tc></w:tr><w:tr><w:tc><w:tcPr><w:vAlign w:val="center"/></w:tcPr>${p('Table content')}</w:tc><w:tc>${p('Source column widths, borders and header shading.')}</w:tc></w:tr><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/><w:shd w:fill="F0F0F0"/></w:tcPr>${p('Merged cell')}</w:tc></w:tr></w:tbl>
      <w:p><w:r><w:t>Before explicit page break</w:t><w:br w:type="page"/><w:t>After explicit page break</w:t></w:r></w:p>
      ${p('Page-break-before paragraph', '<w:pageBreakBefore/><w:spacing w:line="360" w:lineRule="exact"/>')}
      <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1200" w:right="1200"/></w:sectPr>
    </w:body></w:document>`
  };
}

export function readingEntries() {
  const entries = formattingEntries();
  const p = (text, props = '', run = '') => `<w:p><w:pPr>${props}</w:pPr><w:r><w:rPr>${run}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  const equation = '<m:oMath><m:f><m:num><m:r><m:t>x+1</m:t></m:r></m:num><m:den><m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:e><m:r><m:t>y</m:t></m:r></m:e></m:rad></m:den></m:f></m:oMath>';
  entries['word/settings.xml'] = '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:defaultTabStop w:val="960"/></w:settings>';
  entries['word/document.xml'] = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:body>
    ${p('Name:    ')}${p('                    ', '', '<w:u w:color="2468AC"/><w:rFonts w:ascii="Courier New"/><w:spacing w:val="20"/>')}
    ${p('Italic', '', '<w:i/><w:position w:val="4"/><w:kern w:val="16"/><w:lang w:val="en-US"/>')}
    ${p('HIDDEN', '', '<w:vanish/>')}${p('ALSO HIDDEN', '', '<w:webHidden/>')}
    ${p('First contextual', '<w:contextualSpacing/><w:spacing w:before="240" w:after="240"/>')}${p('Second contextual', '<w:spacing w:before="240"/>')}
    ${p('Bordered', '<w:jc w:val="distribute"/><w:pBdr><w:bottom w:val="single" w:color="2468AC" w:space="6"/></w:pBdr>')}
    <w:p><w:r><w:t>Inline equation </w:t></w:r>${equation}</w:p><m:oMathPara>${equation}</m:oMathPara>
    <w:p><w:r><w:ruby><w:rt><w:r><w:t>hàn</w:t></w:r></w:rt><w:rubyBase><w:r><w:t>汉</w:t></w:r></w:rubyBase></w:ruby></w:r></w:p>
    <w:p><w:sdt><w:sdtPr><w14:checkbox><w14:checked w14:val="1"/></w14:checkbox></w:sdtPr><w:sdtContent><w:r><w:t>LOST CHECKBOX</w:t></w:r></w:sdtContent></w:sdt></w:p>
    <w:p><w:r><w:drawing><wp:inline><wp:extent cx="1270000" cy="635000"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="picture"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
    <w:tbl><w:tblPr/><w:tr><w:tc>${p('Borderless')}</w:tc></w:tr></w:tbl>
  </w:body></w:document>`;
  entries['word/_rels/document.xml.rels'] = entries['word/_rels/document.xml.rels'].replace('</Relationships>', '<Relationship Id="picture" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/pixel.png"/></Relationships>');
  entries['[Content_Types].xml'] = entries['[Content_Types].xml'].replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>');
  entries['word/media/pixel.png'] = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGmgAAAAASUVORK5CYII=', 'base64');
  return entries;
}

export function listEntries() {
 const entries=formattingEntries(),w='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
 const level=(n,format,label,extra='')=>`<w:lvl w:ilvl="${n}"><w:start w:val="1"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${label}"/><w:lvlJc w:val="right"/><w:pPr><w:ind w:left="${720+n*360}" w:hanging="360"/></w:pPr>${extra}</w:lvl>`;
 entries['word/numbering.xml']=`<w:numbering xmlns:w="${w}"><w:abstractNum w:abstractNumId="10">${level(0,'chineseCounting','%1、')}${level(1,'lowerLetter','%1.%2)', '<w:lvlRestart w:val="0"/><w:pStyle w:val="ListTwo"/><w:isLgl w:val="0"/>')}${level(2,'decimal','%1.%2.%3)', '<w:lvlRestart w:val="2"/><w:isLgl/>')}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="10"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="10"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="12"/></w:lvlOverride></w:num><w:abstractNum w:abstractNumId="11">${level(0,'bullet','&#xF0B7;', '<w:rPr><w:rFonts w:ascii="Symbol"/></w:rPr>')}</w:abstractNum><w:num w:numId="3"><w:abstractNumId w:val="11"/></w:num><w:abstractNum w:abstractNumId="12">${level(0,'decimal','%1.')}</w:abstractNum><w:num w:numId="4"><w:abstractNumId w:val="12"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="998"/></w:lvlOverride></w:num></w:numbering>`;
 entries['word/styles.xml']=entries['word/styles.xml'].replace('</w:styles>','<w:style w:type="paragraph" w:styleId="ListTwo"><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style></w:styles>');
 const p=(text,id,ilvl=0,extra='')=>`<w:p><w:pPr><w:numPr><w:numId w:val="${id}"/><w:ilvl w:val="${ilvl}"/></w:numPr>${extra}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
 const text='A long list item that wraps over multiple lines; each continuation must align with the text, never beneath the marker. 中文多行列表内容也应当对齐。';
 entries['word/document.xml']=`<w:document xmlns:w="${w}"><w:body>${p('Parent',1)}${p(text,1,1)}${p('Legal nested',1,2)}${p('Parent again',1)}<w:p><w:r><w:t>Ordinary paragraph does not reset numbering.</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="ListTwo"/></w:pPr><w:r><w:t>Style linked level</w:t></w:r></w:p>${p('Restart third level',1,2)}${p('Separate list',2)}${p('Bullet',3)}${p(text,4)}${p(text,4)}${p(text,4)}${p('Cancelled numbering',0)}</w:body></w:document>`;
 return entries;
}
