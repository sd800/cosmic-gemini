// Small authored fixture: real PDF objects/xref, mixed page sizes, selectable
// text, an outline, safe/unsafe links and an inert document JavaScript action.
export function viewerPdf(count = 80) {
  const objects = [], add = value => (objects.push(value), objects.length);
  add(''); add(''); add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pages = [];
  const link = add('<< /Type /Annot /Subtype /Link /Rect [50 620 230 655] /A << /S /URI /URI (https://example.com/pdf-link) >> >>');
  const unsafe = add('<< /Type /Annot /Subtype /Link /Rect [50 560 230 590] /A << /S /URI /URI (javascript:globalThis.PDF_ATTACK=true) >> >>');
  for (let i = 0; i < count; i++) {
    const content = `BT /F1 24 Tf 50 700 Td (PDF Viewer page ${i + 1}) Tj 0 -50 Td (Searchable needle ${i + 1}) Tj ET\n0.9 0.2 0.1 rg 50 400 150 120 re f\n`;
    const stream = add(`<< /Length ${content.length} >>\nstream\n${content}endstream`);
    pages.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${i % 3 ? 595 : 650} 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${stream} 0 R /Annots [${link} 0 R ${unsafe} 0 R] >>`));
  }
  const outlines = add(''), item = add(`<< /Title (Go to final page) /Parent ${outlines} 0 R /Dest [${pages.at(-1)} 0 R /Fit] >>`);
  objects[outlines - 1] = `<< /Type /Outlines /First ${item} 0 R /Last ${item} 0 R /Count 1 >>`;
  objects[0] = `<< /Type /Catalog /Pages 2 0 R /Outlines ${outlines} 0 R /OpenAction << /S /JavaScript /JS (globalThis.PDF_ATTACK=true) >> >>`;
  objects[1] = `<< /Type /Pages /Kids [${pages.map(id => `${id} 0 R`).join(' ')}] /Count ${count} >>`;
  let pdf = '%PDF-1.7\n'; const offsets = [0];
  objects.forEach((value, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${value}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}
