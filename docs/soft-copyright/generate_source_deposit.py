from __future__ import annotations

import datetime as _dt
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "docs" / "soft-copyright"
DOCX_PATH = OUT_DIR / "德州扑克胜率分析器软件V1.0-代码交存版.docx"
TXT_PATH = OUT_DIR / "德州扑克胜率分析器软件V1.0-代码交存版.txt"

SOFTWARE_NAME = "德州扑克胜率分析器软件 V1.0"
LINES_PER_PAGE = 50
PAGES_PER_SECTION = 30

SOURCE_FILES = [
    "index.html",
    "js/app.js",
    "js/poker.js",
    "js/simulator.js",
    "js/modules/ai-advisor.js",
    "js/modules/scanner.js",
    "functions/api/chat.js",
    "functions/api/scan.js",
]


def build_full_listing() -> list[str]:
    lines: list[str] = []
    for rel in SOURCE_FILES:
        path = ROOT / rel
        file_lines = path.read_text(encoding="utf-8").splitlines()
        lines.append(f"/* ===== FILE: {rel} ===== */")
        lines.extend(file_lines)
    return lines


def build_excerpt(full_lines: list[str]) -> tuple[list[str], int, int]:
    section_lines = LINES_PER_PAGE * PAGES_PER_SECTION
    total_pages = (len(full_lines) + LINES_PER_PAGE - 1) // LINES_PER_PAGE
    first = full_lines[:section_lines]
    last = full_lines[-section_lines:] if len(full_lines) > section_lines else []
    return first, total_pages, len(last)


def paginate(lines: list[str], start_page: int, section_title: str) -> list[dict]:
    pages = []
    for i in range(0, len(lines), LINES_PER_PAGE):
        chunk = lines[i:i + LINES_PER_PAGE]
        page_no = start_page + (i // LINES_PER_PAGE)
        pages.append({
            "title": section_title,
            "page_no": page_no,
            "lines": chunk,
        })
    return pages


def build_txt(pages_front: list[dict], pages_back: list[dict], total_pages: int) -> str:
    parts = [
        f"{SOFTWARE_NAME} 代码交存版",
        f"交存规则：前{PAGES_PER_SECTION}页和后{PAGES_PER_SECTION}页，每页{LINES_PER_PAGE}行",
        "",
    ]

    for page in pages_front:
        parts.append(f"===== {page['title']} / 第 {page['page_no']} 页 =====")
        for idx, line in enumerate(page["lines"], 1):
            parts.append(f"{idx:02d} {line}")
        parts.append("")

    parts.append("===== 中间代码省略 =====")
    parts.append(f"完整程序共约 {total_pages} 页，此处按软著常见交存方式保留前后各 {PAGES_PER_SECTION} 页。")
    parts.append("")

    for page in pages_back:
        parts.append(f"===== {page['title']} / 第 {page['page_no']} 页 =====")
        for idx, line in enumerate(page["lines"], 1):
            parts.append(f"{idx:02d} {line}")
        parts.append("")

    return "\n".join(parts).rstrip() + "\n"


def paragraph_xml(text: str, *, bold: bool = False, center: bool = False, font: str = "Courier New", size: int = 16, page_break: bool = False) -> str:
    ppr = []
    if center:
        ppr.append("<w:jc w:val=\"center\"/>")
    if page_break:
        ppr.append("<w:pageBreakBefore/>")
    ppr.append("<w:spacing w:before=\"0\" w:after=\"0\" w:line=\"240\" w:lineRule=\"exact\"/>")
    ppr_xml = "<w:pPr>" + "".join(ppr) + "</w:pPr>"

    rpr = [
        f"<w:rFonts w:ascii=\"{font}\" w:hAnsi=\"{font}\" w:eastAsia=\"等线\"/>",
        f"<w:sz w:val=\"{size}\"/><w:szCs w:val=\"{size}\"/>",
    ]
    if bold:
        rpr.append("<w:b/>")
    rpr_xml = "<w:rPr>" + "".join(rpr) + "</w:rPr>"

    safe = escape(text)
    return f"<w:p>{ppr_xml}<w:r>{rpr_xml}<w:t xml:space=\"preserve\">{safe}</w:t></w:r></w:p>"


def document_xml(pages_front: list[dict], pages_back: list[dict], total_pages: int) -> str:
    paragraphs = []
    paragraphs.append(paragraph_xml(f"{SOFTWARE_NAME} 代码交存版", bold=True, center=True, font="SimSun", size=22))
    paragraphs.append(paragraph_xml(f"交存方式：源程序前{PAGES_PER_SECTION}页、后{PAGES_PER_SECTION}页；每页{LINES_PER_PAGE}行。", center=True, font="SimSun", size=18))

    first_page = True
    for page in pages_front:
        paragraphs.append(paragraph_xml(f"{SOFTWARE_NAME} 源程序交存 第 {page['page_no']} 页", bold=True, font="SimSun", size=18, page_break=not first_page))
        for idx, line in enumerate(page["lines"], 1):
            paragraphs.append(paragraph_xml(f"{idx:02d}  {line}", font="Courier New", size=16))
        first_page = False

    paragraphs.append(paragraph_xml("中间代码省略", bold=True, center=True, font="SimSun", size=18, page_break=True))
    paragraphs.append(paragraph_xml(f"完整程序共约 {total_pages} 页，本材料按软件著作权常见交存方式保留前后各 {PAGES_PER_SECTION} 页。", center=True, font="SimSun", size=18))

    for page in pages_back:
        paragraphs.append(paragraph_xml(f"{SOFTWARE_NAME} 源程序交存 第 {page['page_no']} 页", bold=True, font="SimSun", size=18, page_break=True))
        for idx, line in enumerate(page["lines"], 1):
            paragraphs.append(paragraph_xml(f"{idx:02d}  {line}", font="Courier New", size=16))

    sect = (
        "<w:sectPr>"
        "<w:pgSz w:w=\"11906\" w:h=\"16838\"/>"
        "<w:pgMar w:top=\"1134\" w:right=\"1020\" w:bottom=\"1020\" w:left=\"1020\" "
        "w:header=\"708\" w:footer=\"708\" w:gutter=\"0\"/>"
        "<w:cols w:space=\"425\"/>"
        "</w:sectPr>"
    )
    body = "".join(paragraphs) + sect
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
        f"<w:body>{body}</w:body>"
        "</w:document>"
    )


def styles_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:eastAsia="等线"/>
        <w:lang w:val="zh-CN" w:eastAsia="zh-CN"/>
      </w:rPr>
    </w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
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
  <dc:title>{SOFTWARE_NAME} 代码交存版</dc:title>
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
  <AppVersion>16.0000</AppVersion>
</Properties>
"""


def write_docx(pages_front: list[dict], pages_back: list[dict], total_pages: int) -> None:
    with ZipFile(DOCX_PATH, "w", compression=ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types_xml())
        zf.writestr("_rels/.rels", root_rels_xml())
        zf.writestr("docProps/core.xml", core_xml())
        zf.writestr("docProps/app.xml", app_xml())
        zf.writestr("word/document.xml", document_xml(pages_front, pages_back, total_pages))
        zf.writestr("word/styles.xml", styles_xml())
        zf.writestr("word/_rels/document.xml.rels", document_rels_xml())


def main() -> None:
    full_listing = build_full_listing()
    front_lines, total_pages, last_len = build_excerpt(full_listing)
    if not front_lines or last_len == 0:
        raise SystemExit("Unable to build source deposit excerpt")

    section_lines = LINES_PER_PAGE * PAGES_PER_SECTION
    back_lines = full_listing[-section_lines:]
    pages_front = paginate(front_lines, 1, "前30页")
    pages_back = paginate(back_lines, total_pages - PAGES_PER_SECTION + 1, "后30页")

    TXT_PATH.write_text(build_txt(pages_front, pages_back, total_pages), encoding="utf-8")
    write_docx(pages_front, pages_back, total_pages)


if __name__ == "__main__":
    main()
