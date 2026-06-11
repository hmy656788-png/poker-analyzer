from __future__ import annotations

import datetime as _dt
import html
from html.parser import HTMLParser
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parent
HTML_PATH = ROOT / "德州扑克胜率分析器软件V1.0-软件说明书.html"
DOCX_PATH = ROOT / "德州扑克胜率分析器软件V1.0-软件说明书.docx"


class ContentParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.items: list[tuple[str, str]] = []
        self._current_tag: str | None = None
        self._current_class: str = ""
        self._buffer: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"h1", "p"}:
            self._current_tag = tag
            self._current_class = ""
            for key, value in attrs:
                if key == "class" and value:
                    self._current_class = value
            self._buffer = []

    def handle_data(self, data: str) -> None:
        if self._current_tag:
            self._buffer.append(data)

    def handle_endtag(self, tag: str) -> None:
        if self._current_tag == tag:
            text = html.unescape("".join(self._buffer)).strip()
            if text:
                kind = "body"
                if tag == "h1":
                    kind = "title"
                elif "section-title" in self._current_class:
                    kind = "section"
                elif "sub-title" in self._current_class:
                    kind = "subsection"
                elif "list-item" in self._current_class:
                    kind = "list"
                elif "note" in self._current_class:
                    kind = "note"
                elif "meta" in self._current_class:
                    kind = "meta"
                self.items.append((kind, text))
            self._current_tag = None
            self._current_class = ""
            self._buffer = []


def paragraph_xml(text: str, kind: str) -> str:
    escaped = escape(text)

    if kind == "title":
        ppr = (
            "<w:pPr>"
            "<w:jc w:val=\"center\"/>"
            "<w:spacing w:before=\"0\" w:after=\"180\" w:line=\"360\" w:lineRule=\"auto\"/>"
            "</w:pPr>"
        )
        rpr = (
            "<w:rPr>"
            "<w:rFonts w:ascii=\"SimSun\" w:hAnsi=\"SimSun\" w:eastAsia=\"SimSun\"/>"
            "<w:b/>"
            "<w:sz w:val=\"28\"/>"
            "<w:szCs w:val=\"28\"/>"
            "</w:rPr>"
        )
    elif kind == "section":
        ppr = (
            "<w:pPr>"
            "<w:spacing w:before=\"120\" w:after=\"80\" w:line=\"300\" w:lineRule=\"auto\"/>"
            "</w:pPr>"
        )
        rpr = (
            "<w:rPr>"
            "<w:rFonts w:ascii=\"SimSun\" w:hAnsi=\"SimSun\" w:eastAsia=\"SimSun\"/>"
            "<w:b/>"
            "<w:sz w:val=\"24\"/>"
            "<w:szCs w:val=\"24\"/>"
            "</w:rPr>"
        )
    elif kind == "subsection":
        ppr = (
            "<w:pPr>"
            "<w:spacing w:before=\"80\" w:after=\"40\" w:line=\"300\" w:lineRule=\"auto\"/>"
            "</w:pPr>"
        )
        rpr = (
            "<w:rPr>"
            "<w:rFonts w:ascii=\"SimSun\" w:hAnsi=\"SimSun\" w:eastAsia=\"SimSun\"/>"
            "<w:b/>"
            "<w:sz w:val=\"22\"/>"
            "<w:szCs w:val=\"22\"/>"
            "</w:rPr>"
        )
    elif kind == "meta":
        ppr = (
            "<w:pPr>"
            "<w:spacing w:before=\"0\" w:after=\"20\" w:line=\"300\" w:lineRule=\"auto\"/>"
            "</w:pPr>"
        )
        rpr = (
            "<w:rPr>"
            "<w:rFonts w:ascii=\"SimSun\" w:hAnsi=\"SimSun\" w:eastAsia=\"SimSun\"/>"
            "<w:sz w:val=\"21\"/>"
            "<w:szCs w:val=\"21\"/>"
            "</w:rPr>"
        )
    elif kind == "list":
        ppr = (
            "<w:pPr>"
            "<w:ind w:leftChars=\"200\"/>"
            "<w:spacing w:before=\"0\" w:after=\"20\" w:line=\"300\" w:lineRule=\"auto\"/>"
            "</w:pPr>"
        )
        rpr = (
            "<w:rPr>"
            "<w:rFonts w:ascii=\"SimSun\" w:hAnsi=\"SimSun\" w:eastAsia=\"SimSun\"/>"
            "<w:sz w:val=\"21\"/>"
            "<w:szCs w:val=\"21\"/>"
            "</w:rPr>"
        )
    elif kind == "note":
        ppr = (
            "<w:pPr>"
            "<w:spacing w:before=\"80\" w:after=\"0\" w:line=\"300\" w:lineRule=\"auto\"/>"
            "</w:pPr>"
        )
        rpr = (
            "<w:rPr>"
            "<w:rFonts w:ascii=\"SimSun\" w:hAnsi=\"SimSun\" w:eastAsia=\"SimSun\"/>"
            "<w:sz w:val=\"20\"/>"
            "<w:szCs w:val=\"20\"/>"
            "</w:rPr>"
        )
    else:
        ppr = (
            "<w:pPr>"
            "<w:ind w:firstLineChars=\"200\"/>"
            "<w:spacing w:before=\"0\" w:after=\"20\" w:line=\"300\" w:lineRule=\"auto\"/>"
            "</w:pPr>"
        )
        rpr = (
            "<w:rPr>"
            "<w:rFonts w:ascii=\"SimSun\" w:hAnsi=\"SimSun\" w:eastAsia=\"SimSun\"/>"
            "<w:sz w:val=\"21\"/>"
            "<w:szCs w:val=\"21\"/>"
            "</w:rPr>"
        )

    return (
        "<w:p>"
        f"{ppr}"
        "<w:r>"
        f"{rpr}"
        f"<w:t xml:space=\"preserve\">{escaped}</w:t>"
        "</w:r>"
        "</w:p>"
    )


def document_xml(items: list[tuple[str, str]]) -> str:
    paragraphs = "".join(paragraph_xml(text, kind) for kind, text in items)
    sect = (
        "<w:sectPr>"
        "<w:pgSz w:w=\"11906\" w:h=\"16838\"/>"
        "<w:pgMar w:top=\"1474\" w:right=\"1247\" w:bottom=\"1361\" w:left=\"1247\" "
        "w:header=\"708\" w:footer=\"708\" w:gutter=\"0\"/>"
        "<w:cols w:space=\"425\"/>"
        "<w:docGrid w:type=\"lines\" w:linePitch=\"312\"/>"
        "</w:sectPr>"
    )
    return (
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        "<w:document xmlns:wpc=\"http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas\" "
        "xmlns:mc=\"http://schemas.openxmlformats.org/markup-compatibility/2006\" "
        "xmlns:o=\"urn:schemas-microsoft-com:office:office\" "
        "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" "
        "xmlns:m=\"http://schemas.openxmlformats.org/officeDocument/2006/math\" "
        "xmlns:v=\"urn:schemas-microsoft-com:vml\" "
        "xmlns:wp14=\"http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing\" "
        "xmlns:wp=\"http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing\" "
        "xmlns:w10=\"urn:schemas-microsoft-com:office:word\" "
        "xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" "
        "xmlns:w14=\"http://schemas.microsoft.com/office/word/2010/wordml\" "
        "xmlns:wpg=\"http://schemas.microsoft.com/office/word/2010/wordprocessingGroup\" "
        "xmlns:wpi=\"http://schemas.microsoft.com/office/word/2010/wordprocessingInk\" "
        "xmlns:wne=\"http://schemas.microsoft.com/office/word/2006/wordml\" "
        "xmlns:wps=\"http://schemas.microsoft.com/office/word/2010/wordprocessingShape\" "
        "mc:Ignorable=\"w14 wp14\">"
        "<w:body>"
        f"{paragraphs}"
        f"{sect}"
        "</w:body>"
        "</w:document>"
    )


def styles_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="SimSun" w:hAnsi="SimSun" w:eastAsia="SimSun"/>
        <w:lang w:val="zh-CN" w:eastAsia="zh-CN"/>
      </w:rPr>
    </w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
    <w:rPr>
      <w:rFonts w:ascii="SimSun" w:hAnsi="SimSun" w:eastAsia="SimSun"/>
      <w:sz w:val="21"/>
      <w:szCs w:val="21"/>
    </w:rPr>
  </w:style>
</w:styles>
"""


def content_types_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>
"""


def root_rels_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>
"""


def document_rels_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>
"""


def core_xml() -> str:
    now = _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/"
 xmlns:dcterms="http://purl.org/dc/terms/"
 xmlns:dcmitype="http://purl.org/dc/dcmitype/"
 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>德州扑克胜率分析器软件 V1.0 软件说明书</dc:title>
  <dc:creator>何旻洋</dc:creator>
  <cp:lastModifiedBy>Codex</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">{now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">{now}</dcterms:modified>
</cp:coreProperties>
"""


def app_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
 xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Microsoft Office Word</Application>
  <DocSecurity>0</DocSecurity>
  <ScaleCrop>false</ScaleCrop>
  <SharedDoc>false</SharedDoc>
  <HyperlinksChanged>false</HyperlinksChanged>
  <AppVersion>16.0000</AppVersion>
</Properties>
"""


def main() -> None:
    parser = ContentParser()
    parser.feed(HTML_PATH.read_text(encoding="utf-8"))
    items = parser.items
    if not items:
      raise SystemExit("No content parsed from HTML source")

    with ZipFile(DOCX_PATH, "w", compression=ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types_xml())
        zf.writestr("_rels/.rels", root_rels_xml())
        zf.writestr("docProps/core.xml", core_xml())
        zf.writestr("docProps/app.xml", app_xml())
        zf.writestr("word/document.xml", document_xml(items))
        zf.writestr("word/styles.xml", styles_xml())
        zf.writestr("word/_rels/document.xml.rels", document_rels_xml())


if __name__ == "__main__":
    main()
