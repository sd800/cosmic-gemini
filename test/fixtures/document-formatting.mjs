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
