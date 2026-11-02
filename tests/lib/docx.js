// Word-Datei (.docx = ZIP) für Tests auslesen – nutzt den ZIP-Leser von SheetJS (CFB), der ohnehin installiert ist
const fs = require('fs');
module.exports = fp => {
  const X = require('xlsx');
  const z = X.CFB.read(fs.readFileSync(fp), { type: 'buffer' });
  const get = n => {
    const k = z.FullPaths.findIndex(f => f.endsWith('/' + n));
    return k >= 0 ? Buffer.from(z.FileIndex[k].content).toString('utf8') : '';
  };
  const xml = get('word/document.xml');
  return {
    xml,
    rels: get('word/_rels/document.xml.rels'),
    files: z.FullPaths,
    text: xml
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
  };
};
