/**
 * Minimal but REAL OOXML fixtures (DOCX/XLSX/PPTX) generated at runtime.
 *
 * These are hand-assembled valid packages (store-mode ZIP) that LibreOffice can
 * actually open and export — not mocks. They include Chinese text, structure,
 * tables, hyperlinks and (for docx/pptx) an embedded image. Kept tiny on purpose;
 * generated into tmp at test time and deleted afterwards.
 */
import { Buffer } from 'node:buffer';
import { makeZip } from './fixtures.js';

type Entry = { name: string; data: Buffer };

// 1x1 blue PNG (91 bytes, sharp-generated, valid CRC) used as embedded image.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGNgCDjxHwADhAIY265XUgAAAABJRU5ErkJggg==',
  'base64',
);

const xml = (s: string): Buffer => Buffer.from(s, 'utf8');

// ── DOCX ───────────────────────────────────────────────────────────────────
export function buildDocx(opts: { externalRel?: { type: string; target: string; hyperlink?: boolean } } = {}): Buffer {
  const ct = xml(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
</Types>`);
  const rootRels = xml(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  const extType = opts.externalRel
    ? (opts.externalRel.hyperlink
      ? 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink'
      : opts.externalRel.type)
    : 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink';
  const extTarget = opts.externalRel?.target ?? 'https://example.invalid/';
  const docRels = xml(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
<Relationship Id="rIdHdr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
<Relationship Id="rIdFtr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
<Relationship Id="rIdLink" Type="${extType}" Target="${extTarget}" TargetMode="External"/>
</Relationships>`);
  const document = xml(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
<w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>主标题 Heading 中文</w:t></w:r></w:p>
<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>加粗 bold</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t> italic 斜体</w:t></w:r></w:p>
<w:p><w:r><w:t>普通段落 English sentence with emoji 😀.</w:t></w:r></w:p>
<w:p><w:hyperlink r:id="rIdLink"><w:r><w:t>外部超链接 ordinary link</w:t></w:r></w:hyperlink></w:p>
<w:numPr/>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>列表项 list item 一</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>列表项 list item 二</w:t></w:r></w:p>
<w:tbl>
<w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>
<w:tr><w:tc><w:p><w:r><w:t>表头A 中文</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl>
<w:p><w:r><w:drawing><wp:inline><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:embed="rIdImg"/></pic:blipFill><pic:spPr><a:xfrm><a:ext cx="9525" cy="9525"/></a:xfrm></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
<w:p><w:r><w:br w:type="page"/></w:r></w:p>
<w:p><w:r><w:t>第二页 page two</w:t></w:r></w:p>
<w:sectPr><w:headerReference r:id="rIdHdr" w:type="default"/><w:footerReference r:id="rIdFtr" w:type="default"/><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>
</w:body></w:document>`);
  const header = xml(`<?xml version="1.0"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>页眉 Header 中文</w:t></w:r></w:p></w:hdr>`);
  const footer = xml(`<?xml version="1.0"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>页脚 Footer</w:t></w:r></w:p></w:ftr>`);
  const entries: Entry[] = [
    { name: '[Content_Types].xml', data: ct },
    { name: '_rels/.rels', data: rootRels },
    { name: 'word/_rels/document.xml.rels', data: docRels },
    { name: 'word/document.xml', data: document },
    { name: 'word/header1.xml', data: header },
    { name: 'word/footer1.xml', data: footer },
    { name: 'word/media/image1.png', data: TINY_PNG },
  ];
  return makeZip(entries);
}

// ── XLSX ────────────────────────────────────────────────────────────────────
export function buildXlsx(): Buffer {
  const ct = xml(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`);
  const rootRels = xml(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);
  const wbRels = xml(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`);
  const workbook = xml(
    `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="数据 Data" sheetId="1" r:id="rId1"/><sheet name="第二 Sheet" sheetId="2" r:id="rId2"/></sheets></workbook>`);
  const styles = xml(
    `<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" applyFont="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  // shared strings: 0=中文标题 1=名称 2=数值
  const shared = xml(
    `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="4" uniqueCount="3">
<si><t>中文标题</t></si><si><t>名称</t></si><si><t>数值</t></si></sst>`);
  // sheet1: strings + formula + merged cells + date + landscape + print area, force >1 print page width via many columns
  const sheet1 = xml(
    `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:J60"/>
<sheetViews><sheetView workbookViewId="0"/></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<sheetPr><pageSetUpPr fitToPage="0"/></sheetPr>
<mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells>
<sheetData>
<row r="1"><c r="A1" t="s" s="1"><v>0</v></c></row>
<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="s"><v>2</v></c></row>
<row r="3"><c r="A3"><v>10</v></c><c r="B3"><f>A3*2</f><v>20</v></c></row>
<row r="4"><c r="A4" t="d"><v>2024-01-15</v></c></row>
${manyRows(5, 60)}
</sheetData>
<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75"/>
<pageSetup orientation="landscape" paperSize="9"/>
<definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">数据 Data!$A$1:$J$60</definedName></definedNames>
</worksheet>`);
  const sheet2 = xml(
    `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2"><v>42</v></c></row></sheetData></worksheet>`);
  return makeZip([
    { name: '[Content_Types].xml', data: ct },
    { name: '_rels/.rels', data: rootRels },
    { name: 'xl/_rels/workbook.xml.rels', data: wbRels },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/styles.xml', data: styles },
    { name: 'xl/sharedStrings.xml', data: shared },
    { name: 'xl/worksheets/sheet1.xml', data: sheet1 },
    { name: 'xl/worksheets/sheet2.xml', data: sheet2 },
  ]);
}

function manyRows(from: number, to: number): string {
  let s = '';
  for (let r = from; r <= to; r++) {
    let cells = '';
    for (let c = 0; c < 10; c++) {
      const col = String.fromCharCode(65 + c);
      cells += `<c r="${col}${r}"><v>${r * (c + 1)}</v></c>`;
    }
    s += `<row r="${r}">${cells}</row>`;
  }
  return s;
}

// ── PPTX ────────────────────────────────────────────────────────────────────
export function buildPptx(): Buffer {
  const ct = xml(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
<Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
<Override PartName="/ppt/slides/slide3.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`);
  const rootRels = xml(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`);
  const presRels = xml(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide3.xml"/>
</Relationships>`);
  const presentation = xml(
    `<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/><p:sldId id="258" r:id="rId4"/></p:sldIdLst>
<p:sldSz cx="9144000" cy="6858000" type="screen4x3"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
  const master = xml(
    `<?xml version="1.0"?><p:sldMaster xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
<p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`);
  const masterRels = xml(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`);
  const layout = xml(
    `<?xml version="1.0"?><p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" type="obj">
<p:cSld name="Title and Content"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
<p:clrMapOvr><a:masterClrMapping xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/></p:clrMapOvr></p:sldLayout>`);
  const layoutRels = xml(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`);
  const slide = (id: number, body: string, rels?: string): { parts: Entry[]; rels?: string } => {
    const n = id + 1;
    const part = xml(
      `<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<p:cSld><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
${body}
</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
    const e: Entry[] = [{ name: `ppt/slides/slide${n}.xml`, data: part }];
    return { parts: e, rels };
  };
  const textbox = (id: number, name: string, x: number, y: number, cx: number, cy: number, text: string) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm></p:spPr>
<p:txBody><a:bodyPr/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
  const shape = (id: number) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Shape"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="600000" y="4000000"/><a:ext cx="2000000" cy="1000000"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:p/></p:txBody></p:sp>`;
  const picShape = (id: number) =>
    `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Pic"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdImg"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="5000000" y="3500000"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
  const table = (id: number) =>
    `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Tbl"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
<p:xfrm><a:off x="1000000" y="3000000"/><a:ext cx="4000000" cy="1500000"/></p:xfrm>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1"><a:tableStyleId/></a:tblPr>
<a:tblGrid><a:gridCol w="2000000"/><a:gridCol w="2000000"/></a:tblGrid>
<a:tr h="500000"><a:tc><a:txBody><a:p><a:r><a:t>表头 中文</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc><a:tc><a:txBody><a:p><a:r><a:t>B</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr>
<a:tr h="500000"><a:tc><a:txBody><a:p><a:r><a:t>1</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc><a:tc><a:txBody><a:p><a:r><a:t>2</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr>
</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
  const linkRun = (id: number) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Link"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:rPr><a:hlinkClick r:id="rIdLink"/></a:rPr><a:t>超链接 link</a:t></a:r></a:p></p:txBody></p:sp>`;

  const s1 = slide(0, textbox(2, 'Title', 500000, 300000, 8000000, 1000000, '幻灯片一 Slide 标题 中文') + textbox(3, 'Body', 500000, 1500000, 8000000, 1000000, '正文 body text'));
  const s2 = slide(1, shape(2) + table(3));
  const s3 = slide(2, picShape(2) + linkRun(3), 'img+link');
  const s3Rels = xml(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
<Relationship Id="rIdLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.invalid/" TargetMode="External"/>
</Relationships>`);

  return makeZip([
    { name: '[Content_Types].xml', data: ct },
    { name: '_rels/.rels', data: rootRels },
    { name: 'ppt/_rels/presentation.xml.rels', data: presRels },
    { name: 'ppt/presentation.xml', data: presentation },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: master },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: masterRels },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: layout },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: layoutRels },
    ...s1.parts, ...s2.parts, ...s3.parts,
    { name: 'ppt/slides/_rels/slide3.xml.rels', data: s3Rels },
    { name: 'ppt/media/image1.png', data: TINY_PNG },
  ]);
}
