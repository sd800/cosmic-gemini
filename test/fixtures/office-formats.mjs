const rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const packageRels=rows=>'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+rows.map(([id,type,target,external])=>`<Relationship Id="${id}" Type="${rel}/${type}" Target="${target}"${external?' TargetMode="External"':''}/>`).join('')+'</Relationships>';
const s='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
export function spreadsheetEntries(){return {
 '[Content_Types].xml':'<Types/>',
 'xl/workbook.xml':`<workbook xmlns="${s}" xmlns:r="${rel}"><sheets><sheet name="预算 Budget" sheetId="1" r:id="one"/><sheet name="Notes" sheetId="2" r:id="two"/></sheets></workbook>`,
 'xl/_rels/workbook.xml.rels':packageRels([['one','worksheet','worksheets/sheet1.xml'],['two','worksheet','worksheets/sheet2.xml'],['styles','styles','styles.xml'],['strings','sharedStrings','sharedStrings.xml']]),
 'xl/sharedStrings.xml':`<sst xmlns="${s}"><si><t>项目 / Item</t></si><si><r><t>Shared </t></r><r><t>string</t></r></si></sst>`,
 'xl/styles.xml':`<styleSheet xmlns="${s}"><numFmts><numFmt numFmtId="164" formatCode="$#,##0.00"/></numFmts><fonts><font><b/><sz val="12"/></font></fonts><fills><fill><patternFill patternType="solid"><fgColor rgb="FFABCDEF"/></patternFill></fill></fills><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="14"/><xf numFmtId="10"/></cellXfs></styleSheet>`,
 'xl/worksheets/sheet1.xml':`<worksheet xmlns="${s}"><cols><col min="1" max="1" width="26"/></cols><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" s="1"><v>1234.5</v></c><c r="C1" s="2"><v>45000</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>&lt;script&gt;unsafe&lt;/script&gt;</t></is></c><c r="B2" s="3"><f>WEBSERVICE("https://tracker.invalid")</f><v>0.5</v></c><c r="C2"><f>1+2</f></c></row><row r="4"><c r="A4" t="s"><v>1</v></c></row></sheetData><mergeCells><mergeCell ref="A4:C4"/></mergeCells></worksheet>`,
 'xl/worksheets/sheet2.xml':`<worksheet xmlns="${s}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>第二张表</t></is></c></row></sheetData></worksheet>`
};}
const p='http://schemas.openxmlformats.org/presentationml/2006/main',a='http://schemas.openxmlformats.org/drawingml/2006/main';
export function presentationEntries(){return {
 '[Content_Types].xml':'<Types/>',
 'ppt/presentation.xml':`<p:presentation xmlns:p="${p}" xmlns:r="${rel}"><p:sldIdLst><p:sldId id="256" r:id="one"/><p:sldId id="257" r:id="two"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>`,
 'ppt/_rels/presentation.xml.rels':packageRels([['one','slide','slides/slide1.xml'],['two','slide','slides/slide2.xml']]),
 'ppt/slides/slide1.xml':`<p:sld xmlns:p="${p}" xmlns:a="${a}"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="457200"/><a:ext cx="7315200" cy="1371600"/></a:xfrm><a:solidFill><a:srgbClr val="DDEEFF"/></a:solidFill></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="3200" b="1"/><a:t>第一张幻灯片 / First slide</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
 'ppt/slides/slide2.xml':`<p:sld xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${rel}"><p:cSld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="914400" y="457200"/><a:ext cx="7315200" cy="2743200"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>Second slide &amp; safe text</a:t></a:r></a:p></p:txBody></p:sp><p:pic><p:blipFill><a:blip r:embed="external"/></p:blipFill><p:spPr><a:xfrm><a:off x="1" y="1"/><a:ext cx="914400" cy="914400"/></a:xfrm></p:spPr></p:pic></p:spTree></p:cSld></p:sld>`,
 'ppt/slides/_rels/slide2.xml.rels':packageRels([['external','image','https://tracker.invalid/image',true]])
};}
export function samplePdf(){return new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n').buffer;}

export function darkPresentationEntries() {
 const entries=presentationEntries();
 entries['ppt/slides/_rels/slide1.xml.rels']=packageRels([['layout','slideLayout','../slideLayouts/slideLayout1.xml']]);
 entries['ppt/slideLayouts/slideLayout1.xml']=`<p:sldLayout xmlns:p="${p}" xmlns:a="${a}"><p:cSld/></p:sldLayout>`;
 entries['ppt/slideLayouts/_rels/slideLayout1.xml.rels']=packageRels([['master','slideMaster','../slideMasters/slideMaster1.xml']]);
 entries['ppt/slideMasters/slideMaster1.xml']=`<p:sldMaster xmlns:p="${p}" xmlns:a="${a}"><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg></p:cSld><p:clrMap bg1="dk1" tx1="lt1"/></p:sldMaster>`;
 entries['ppt/slideMasters/_rels/slideMaster1.xml.rels']=packageRels([['theme','theme','../theme/theme1.xml']]);
 entries['ppt/theme/theme1.xml']=`<a:theme xmlns:a="${a}"><a:themeElements><a:clrScheme name="Test"><a:dk1><a:srgbClr val="101218"/></a:dk1><a:lt1><a:srgbClr val="F4F6FA"/></a:lt1></a:clrScheme><a:fmtScheme name="Test"><a:fillStyleLst><a:solidFill><a:srgbClr val="080A0C"/></a:solidFill></a:fillStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"><a:shade val="50000"/></a:schemeClr></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
 entries['ppt/slides/slide1.xml']=entries['ppt/slides/slide1.xml'].replace('<a:srgbClr val="DDEEFF"/>','<a:srgbClr val="101218"/>').replace('<a:rPr sz="3200" b="1"/>','<a:rPr sz="3200" b="1"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr>');
 return entries;
}
