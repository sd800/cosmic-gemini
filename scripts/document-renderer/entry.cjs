const mammoth = require('mammoth');
const unzip = require('mammoth/lib/unzip');
const docxReader = require('mammoth/lib/docx/docx-reader');
const officeXml = require('mammoth/lib/docx/office-xml-reader');
const readOptions = require('mammoth/lib/options-reader').readOptions;
const readStyle = require('mammoth/lib/style-reader').readStyle;
const DocumentConverter = require('mammoth/lib/document-to-html').DocumentConverter;
const Html = require('mammoth/lib/html');
const {createFormatting} = require('./formatting.cjs');

module.exports = {...mammoth,
  convertLegacyWord: require('./legacy-word.cjs').word,
  convertLegacyPresentation: require('./legacy-presentation.cjs').presentation,
  convertLegacySpreadsheet: require('./legacy-spreadsheet.cjs').spreadsheet,
  convertRtf: require('./rtf.cjs').rtf,
  convertOpenDocument: require('./opendocument.cjs').opendocument,
  convertEmail: require('./email.cjs').email,
  convertSpreadsheet: require('./spreadsheet.cjs').spreadsheet,
  convertPresentation: require('./presentation.cjs').presentation,
  convertToHtml:async function(input,options) {
  const zip=await unzip.openZip(input),paths=await docxReader._findPartPaths(zip);
  const directory=paths.mainDocument.slice(0,paths.mainDocument.lastIndexOf('/')+1);
  const rels=await officeXml.readXmlFromZipFile(zip,directory+'_rels/'+paths.mainDocument.slice(directory.length)+'.rels');
  const themeRel=rels?.children?.find(node=>node.attributes?.Type?.endsWith('/theme')&&node.attributes.TargetMode!=='External');
  const themePath=themeRel?.attributes.Target;
  // Resolve only package-local paths. No remote font or theme file is loaded.
  const themeName=themePath&&!/^[a-z]+:|^\/|\\|(?:^|\/)\.\.(?:\/|$)/i.test(themePath)?directory+themePath:directory+'theme/theme1.xml';
  const parts=Object.fromEntries(await Promise.all(Object.entries({styles:paths.styles,numbering:paths.numbering,document:paths.mainDocument,theme:themeName}).map(async([key,path])=>[key,await officeXml.readXmlFromZipFile(zip,path)])));
  zip.cgXmlCache=new Map([[paths.styles,parts.styles],[paths.numbering,parts.numbering],[paths.mainDocument,parts.document]]);
  const formatting=createFormatting(parts,Html);
  const config=readOptions({...options,ignoreEmptyParagraphs:false,includeEmbeddedStyleMap:false,cgFormatting:formatting});
  const doc=await docxReader.read(zip,input,config);
  const styleMap=config.readStyleMap().map(line=>readStyle(line).value).filter(Boolean);
  const result=await new DocumentConverter({...config,styleMap}).convertToHtml(doc.value);
  return {...result,formatting:formatting.export()};
}};
