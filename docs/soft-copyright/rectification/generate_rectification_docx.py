from __future__ import annotations

import datetime as dt
import html
import re
import struct
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parent
SCREENSHOT_DIR = ROOT / "screenshots"
DOCX_MAIN = ROOT / "德州扑克胜率分析器软件V1.0-软件文档鉴别材料-补正版.docx"
DOCX_NOTE = ROOT / "德州扑克胜率分析器软件V1.0-补正说明.docx"

EMU_PER_INCH = 914400
PAGE_CONTENT_WIDTH_EMU = int(6.2 * EMU_PER_INCH)


def read_png_size(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"Not a PNG: {path}")
    width, height = struct.unpack(">II", data[16:24])
    return width, height


def esc(text: str) -> str:
    return html.escape(text, quote=False)


def text_runs(text: str, bold: bool = False) -> str:
    rpr = (
        "<w:rPr>"
        "<w:rFonts w:ascii=\"SimSun\" w:hAnsi=\"SimSun\" w:eastAsia=\"SimSun\"/>"
        + ("<w:b/>" if bold else "")
        + "</w:rPr>"
    )
    return f"<w:r>{rpr}<w:t xml:space=\"preserve\">{esc(text)}</w:t></w:r>"


def paragraph(text: str = "", style: str = "body", align: str | None = None) -> str:
    bold = style in {"title", "heading", "subheading"}
    size = {
        "title": 32,
        "heading": 26,
        "subheading": 23,
        "caption": 20,
        "body": 21,
    }.get(style, 21)
    before = {"title": 0, "heading": 220, "subheading": 120, "caption": 60}.get(style, 0)
    after = {"title": 240, "heading": 90, "subheading": 60, "caption": 120}.get(style, 45)
    jc = f"<w:jc w:val=\"{align}\"/>" if align else ""
    indent = "<w:ind w:firstLineChars=\"200\"/>" if style == "body" and text and not re.match(r"^\\d+\\.", text) else ""
    rpr = (
        "<w:rPr>"
        "<w:rFonts w:ascii=\"SimSun\" w:hAnsi=\"SimSun\" w:eastAsia=\"SimSun\"/>"
        + ("<w:b/>" if bold else "")
        + f"<w:sz w:val=\"{size}\"/><w:szCs w:val=\"{size}\"/>"
        "</w:rPr>"
    )
    return (
        "<w:p>"
        "<w:pPr>"
        f"{jc}{indent}<w:spacing w:before=\"{before}\" w:after=\"{after}\" w:line=\"300\" w:lineRule=\"auto\"/>"
        "</w:pPr>"
        f"<w:r>{rpr}<w:t xml:space=\"preserve\">{esc(text)}</w:t></w:r>"
        "</w:p>"
    )


def image_paragraph(rel_id: str, image_path: Path, doc_pr_id: int) -> str:
    width_px, height_px = read_png_size(image_path)
    cx = PAGE_CONTENT_WIDTH_EMU
    cy = int(cx * height_px / width_px)
    if cy > int(7.6 * EMU_PER_INCH):
        cy = int(7.6 * EMU_PER_INCH)
        cx = int(cy * width_px / height_px)
    name = esc(image_path.name)
    return f"""
<w:p>
  <w:pPr><w:jc w:val="center"/><w:spacing w:before="60" w:after="60"/></w:pPr>
  <w:r>
    <w:drawing>
      <wp:inline distT="0" distB="0" distL="0" distR="0">
        <wp:extent cx="{cx}" cy="{cy}"/>
        <wp:effectExtent l="0" t="0" r="0" b="0"/>
        <wp:docPr id="{doc_pr_id}" name="{name}"/>
        <wp:cNvGraphicFramePr/>
        <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
            <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
              <pic:nvPicPr><pic:cNvPr id="{doc_pr_id}" name="{name}"/><pic:cNvPicPr/></pic:nvPicPr>
              <pic:blipFill>
                <a:blip r:embed="{rel_id}"/>
                <a:stretch><a:fillRect/></a:stretch>
              </pic:blipFill>
              <pic:spPr>
                <a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>
                <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
              </pic:spPr>
            </pic:pic>
          </a:graphicData>
        </a:graphic>
      </wp:inline>
    </w:drawing>
  </w:r>
</w:p>
"""


def sect_pr() -> str:
    return (
        "<w:sectPr>"
        "<w:pgSz w:w=\"11906\" w:h=\"16838\"/>"
        "<w:pgMar w:top=\"1440\" w:right=\"1080\" w:bottom=\"1440\" w:left=\"1080\" w:header=\"708\" w:footer=\"708\" w:gutter=\"0\"/>"
        "<w:cols w:space=\"425\"/>"
        "<w:docGrid w:type=\"lines\" w:linePitch=\"312\"/>"
        "</w:sectPr>"
    )


def document_xml(body: str) -> str:
    return (
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        "<w:document "
        "xmlns:wpc=\"http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas\" "
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
        f"<w:body>{body}{sect_pr()}</w:body></w:document>"
    )


def styles_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="SimSun" w:hAnsi="SimSun" w:eastAsia="SimSun"/><w:lang w:val="zh-CN" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:rPr><w:rFonts w:ascii="SimSun" w:hAnsi="SimSun" w:eastAsia="SimSun"/><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:style>
</w:styles>"""


def content_types_xml(images: list[Path]) -> str:
    image_defaults = ""
    if images:
        image_defaults = '<Default Extension="png" ContentType="image/png"/>'
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  {image_defaults}
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>"""


def root_rels_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>"""


def document_rels_xml(images: list[Path]) -> str:
    rels = [
        f'<Relationship Id="rId{i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/{image.name}"/>'
        for i, image in enumerate(images)
    ]
    return (
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
        + "".join(rels)
        + "</Relationships>"
    )


def core_xml() -> str:
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>德州扑克胜率分析器软件 V1.0 补正材料</dc:title>
  <dc:creator>何旻洋</dc:creator>
  <cp:lastModifiedBy>Codex</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">{now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">{now}</dcterms:modified>
</cp:coreProperties>"""


def app_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Codex</Application>
</Properties>"""


def write_docx(path: Path, body: str, images: list[Path]) -> None:
    with ZipFile(path, "w", ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types_xml(images))
        zf.writestr("_rels/.rels", root_rels_xml())
        zf.writestr("word/document.xml", document_xml(body))
        zf.writestr("word/styles.xml", styles_xml())
        zf.writestr("word/_rels/document.xml.rels", document_rels_xml(images))
        zf.writestr("docProps/core.xml", core_xml())
        zf.writestr("docProps/app.xml", app_xml())
        for image in images:
            zf.write(image, f"word/media/{image.name}")


def main_doc_body(images: list[Path]) -> str:
    parts: list[str] = [
        paragraph("德州扑克胜率分析器软件 V1.0 软件文档鉴别材料（补正版）", "title", "center"),
        paragraph("一、软件基本信息", "heading"),
        paragraph("软件全称：德州扑克胜率分析器软件 V1.0"),
        paragraph("软件简称：德扑分析器"),
        paragraph("版本号：V1.0"),
        paragraph("申请人：何旻洋"),
        paragraph("软件类型：应用软件"),
        paragraph("开发方式：独立开发"),
        paragraph("二、软件概述", "heading"),
        paragraph("德州扑克胜率分析器软件 V1.0 是一款用于德州扑克牌局概率分析、牌力评估和学习复盘的应用软件。软件支持用户选择两张手牌，录入翻牌、转牌、河牌等公共牌，设置对手数量和牌局信息，并通过蒙特卡洛模拟算法计算当前牌局下的胜率、平局率、失败率、牌型分布和参考决策建议。"),
        paragraph("软件同时提供起手牌强度表、AI 德扑顾问、拍照识牌、PWA 安装入口等功能，用于帮助用户理解不同阶段的牌力变化和局面风险。本软件主要用于学习、复盘和娱乐分析场景。"),
        paragraph("三、软件主要功能", "heading"),
    ]
    features = [
        "1. 手牌选择功能：用户可在牌面选择区选择自己的两张底牌，系统自动防止重复选牌。",
        "2. 公共牌录入功能：支持按翻牌、转牌、河牌阶段录入最多五张公共牌。",
        "3. 阶段进度展示功能：界面顶部展示翻前、翻牌、转牌、河牌四个阶段的进度状态。",
        "4. 对手数量设置功能：支持设置 1 至 8 位对手参与模拟。",
        "5. 牌局信息设置功能：可设置位置、对手类型、当前底池、需跟注金额和剩余积分等参数。",
        "6. 胜率分析功能：通过模拟计算输出胜率、平局率、失败率和当前最佳牌型。",
        "7. 决策建议功能：结合胜率、底池赔率和跟注金额，输出加注、跟注或弃牌等参考建议。",
        "8. 牌型分布功能：展示皇家同花顺、同花顺、四条、葫芦、同花、顺子、三条、两对、一对、高牌等牌型出现概率。",
        "9. 起手牌强度表功能：展示 13×13 起手牌强度矩阵，辅助用户判断翻前牌力。",
        "10. AI 德扑顾问功能：根据当前牌局数据生成策略分析和追问建议。",
        "11. 拍照识牌功能：支持调用摄像头识别手牌或公共牌，并将识别结果填入牌局。",
        "12. 重置功能：用户可一键清空当前手牌、公共牌、分析结果和牌局设置。",
    ]
    parts.extend(paragraph(item) for item in features)
    parts.extend([
        paragraph("四、软件技术特点", "heading"),
        paragraph("1. 使用原生 HTML、CSS、JavaScript 实现前端交互界面。"),
        paragraph("2. 使用蒙特卡洛模拟算法进行胜率估算，默认按牌局阶段和设备性能动态调整模拟次数。"),
        paragraph("3. 使用整数编码牌面和高性能牌型评估函数，提高模拟计算效率。"),
        paragraph("4. 使用 Web Worker 执行后台计算，避免主界面卡顿。"),
        paragraph("5. 支持起手牌强度预计算和缓存，提高重复分析的响应速度。"),
        paragraph("6. AI 顾问接口通过后端函数代理调用，避免前端暴露密钥。"),
        paragraph("7. 支持 Service Worker 和 Manifest 配置，具备 PWA 离线访问和安装能力。"),
        paragraph("五、主要使用流程", "heading"),
        paragraph("用户进入软件主界面后，选择两张手牌，并按翻牌、转牌、河牌阶段录入公共牌；随后设置对手数量和牌局信息，点击“开始分析”执行模拟计算。软件输出胜率、平局率、失败率、底池赔率、Call EV、当前最佳牌型、牌型分布和决策建议。用户还可查看起手牌强度表，打开 AI 德扑顾问获得进一步策略说明，或使用“扫一扫”进入拍照识牌界面。"),
        paragraph("六、软件运行截图", "heading"),
    ])
    captions = [
        ("图 1 软件主界面", "展示软件启动后的主界面，包括软件标题、阶段进度条、手牌选择区、公共牌选择区、选牌器、胜率分析面板和起手牌强度表入口。"),
        ("图 2 手牌与公共牌录入界面", "展示用户选择 A♠、K♥ 作为手牌，并在翻牌阶段录入 Q♠、J♠、10♠ 公共牌的运行界面。界面同时显示对手数量设置和牌面危险度提示。"),
        ("图 3 胜率分析结果与决策指标", "展示点击“开始分析”后的计算结果，包括胜率、平局率、失败率、底池赔率、所需胜率、Call EV、底池规模、当前最佳牌型、牌型分布和参考建议。"),
        ("图 4 起手牌强度表", "展示软件生成的 13×13 起手牌强度矩阵。对角线表示口袋对，上三角表示同花组合，下三角表示非同花组合，不同颜色代表不同强度区间。"),
        ("图 5 AI 德扑顾问界面", "展示 AI 德扑顾问浮层界面，包括牌力判断、策略建议、注意事项和追问输入区。该功能用于结合当前牌局信息输出辅助分析。"),
        ("图 6 拍照识牌界面", "展示点击“扫一扫”后的拍照识牌界面，包括摄像头画面区域、识别框、拍摄识别按钮和识别状态提示。该功能用于通过摄像头采集牌面并进行识别。"),
    ]
    for index, image in enumerate(images):
        title, desc = captions[index]
        parts.append(paragraph(title, "subheading", "center"))
        parts.append(image_paragraph(f"rId{index + 1}", image, index + 1))
        parts.append(paragraph(desc, "caption"))
    parts.extend([
        paragraph("七、结论", "heading"),
        paragraph("以上材料补充展示了德州扑克胜率分析器软件 V1.0 的真实运行界面、主要功能、技术特点和完整使用流程，可用于替换或补充原软件文档鉴别材料中缺少运行截图的问题。"),
    ])
    return "".join(parts)


def note_doc_body() -> str:
    lines = [
        ("德州扑克胜率分析器软件 V1.0 补正说明", "title", "center"),
        ("流水号：2026R11L1225249", "body", None),
        ("软件名称：德州扑克胜率分析器软件[简称：德扑分析器]V1.0", "body", None),
        ("申请人：何旻洋", "body", None),
        ("补正日期：2026年5月18日", "body", None),
        ("尊敬的中国版权保护中心：", "body", None),
        ("本人申请的软件著作权登记事项，流水号为 2026R11L1225249，软件名称为“德州扑克胜率分析器软件[简称：德扑分析器]V1.0”。根据贵中心出具的《软件登记补正通知书》，现对申请材料作如下补正：", "body", None),
        ("一、关于“文档鉴别材料缺少软件运行截图”的问题，现已重新整理并提交软件文档鉴别材料补正版。补正版材料结合软件主要功能和技术特点，补充了软件实际运行界面截图，展示了软件启动主界面、手牌选择、公共牌录入、对手数量设置、牌局信息设置、胜率分析结果、牌型分布、决策建议、起手牌强度表、AI 德扑顾问及拍照识牌等主要功能和使用流程。", "body", None),
        ("二、关于“申请确认签章页未抄写划线部分内容”的问题，本人将按版权中心系统生成的申请确认签章页要求，在指定位置逐字手写抄写划线部分内容，并重新签名确认后提交。", "body", None),
        ("以上补正材料真实、完整，与本次申请的软件名称、版本号、申请人信息保持一致，请予以审核。", "body", None),
        ("申请人：何旻洋", "body", None),
        ("日期：2026年5月18日", "body", None),
    ]
    return "".join(paragraph(text, style, align) for text, style, align in lines)


def main() -> None:
    images = [
        SCREENSHOT_DIR / "01-软件主界面.png",
        SCREENSHOT_DIR / "02-选牌与公共牌录入.png",
        SCREENSHOT_DIR / "03-胜率分析结果与决策指标.png",
        SCREENSHOT_DIR / "04-起手牌强度表.png",
        SCREENSHOT_DIR / "05-AI德扑顾问界面.png",
        SCREENSHOT_DIR / "06-拍照识牌界面.png",
    ]
    missing = [str(path) for path in images if not path.exists()]
    if missing:
        raise FileNotFoundError("Missing screenshots: " + ", ".join(missing))
    write_docx(DOCX_MAIN, main_doc_body(images), images)
    write_docx(DOCX_NOTE, note_doc_body(), [])
    print(DOCX_MAIN)
    print(DOCX_NOTE)


if __name__ == "__main__":
    main()
