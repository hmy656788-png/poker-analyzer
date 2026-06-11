from __future__ import annotations

import base64
import html
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SCREENSHOT_DIR = ROOT / "screenshots"
HTML_PATH = ROOT / "德州扑克胜率分析器软件V1.0-补正材料合并版.html"


def image_data_uri(path: Path) -> str:
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def p(text: str) -> str:
    return f"<p>{html.escape(text)}</p>"


def li(text: str) -> str:
    return f"<li>{html.escape(text)}</li>"


def main() -> None:
    images = [
        ("图 1 软件主界面", "01-软件主界面.png", "展示软件启动后的主界面，包括软件标题、阶段进度条、手牌选择区、公共牌选择区、选牌器、胜率分析面板和起手牌强度表入口。"),
        ("图 2 手牌与公共牌录入界面", "02-选牌与公共牌录入.png", "展示用户选择 A♠、K♥ 作为手牌，并在翻牌阶段录入 Q♠、J♠、10♠ 公共牌的运行界面。界面同时显示对手数量设置和牌面危险度提示。"),
        ("图 3 胜率分析结果与决策指标", "03-胜率分析结果与决策指标.png", "展示点击“开始分析”后的计算结果，包括胜率、平局率、失败率、底池赔率、所需胜率、Call EV、底池规模、当前最佳牌型、牌型分布和参考建议。"),
        ("图 4 起手牌强度表", "04-起手牌强度表.png", "展示软件生成的 13×13 起手牌强度矩阵。对角线表示口袋对，上三角表示同花组合，下三角表示非同花组合，不同颜色代表不同强度区间。"),
        ("图 5 AI 德扑顾问界面", "05-AI德扑顾问界面.png", "展示 AI 德扑顾问浮层界面，包括牌力判断、策略建议、注意事项和追问输入区。该功能用于结合当前牌局信息输出辅助分析。"),
        ("图 6 拍照识牌界面", "06-拍照识牌界面.png", "展示点击“扫一扫”后的拍照识牌界面，包括摄像头画面区域、识别框、拍摄识别按钮和识别状态提示。该功能用于通过摄像头采集牌面并进行识别。"),
    ]

    features = [
        "手牌选择功能：用户可在牌面选择区选择自己的两张底牌，系统自动防止重复选牌。",
        "公共牌录入功能：支持按翻牌、转牌、河牌阶段录入最多五张公共牌。",
        "阶段进度展示功能：界面顶部展示翻前、翻牌、转牌、河牌四个阶段的进度状态。",
        "对手数量设置功能：支持设置 1 至 8 位对手参与模拟。",
        "牌局信息设置功能：可设置位置、对手类型、当前底池、需跟注金额和剩余积分等参数。",
        "胜率分析功能：通过模拟计算输出胜率、平局率、失败率和当前最佳牌型。",
        "决策建议功能：结合胜率、底池赔率和跟注金额，输出加注、跟注或弃牌等参考建议。",
        "牌型分布功能：展示皇家同花顺、同花顺、四条、葫芦、同花、顺子、三条、两对、一对、高牌等牌型出现概率。",
        "起手牌强度表功能：展示 13×13 起手牌强度矩阵，辅助用户判断翻前牌力。",
        "AI 德扑顾问功能：根据当前牌局数据生成策略分析和追问建议。",
        "拍照识牌功能：支持调用摄像头识别手牌或公共牌，并将识别结果填入牌局。",
        "重置功能：用户可一键清空当前手牌、公共牌、分析结果和牌局设置。",
    ]

    tech = [
        "使用原生 HTML、CSS、JavaScript 实现前端交互界面。",
        "使用蒙特卡洛模拟算法进行胜率估算，默认按牌局阶段和设备性能动态调整模拟次数。",
        "使用整数编码牌面和高性能牌型评估函数，提高模拟计算效率。",
        "使用 Web Worker 执行后台计算，避免主界面卡顿。",
        "支持起手牌强度预计算和缓存，提高重复分析的响应速度。",
        "AI 顾问接口通过后端函数代理调用，避免前端暴露密钥。",
        "支持 Service Worker 和 Manifest 配置，具备 PWA 离线访问和安装能力。",
    ]

    image_blocks = []
    for title, filename, caption in images:
        path = SCREENSHOT_DIR / filename
        if not path.exists():
            raise FileNotFoundError(path)
        image_blocks.append(
            f"""
            <section class="figure">
              <h3>{html.escape(title)}</h3>
              <img src="{image_data_uri(path)}" alt="{html.escape(title)}">
              <p class="caption">{html.escape(caption)}</p>
            </section>
            """
        )

    content = f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>德州扑克胜率分析器软件 V1.0 补正材料</title>
  <style>
    @page {{ size: A4; margin: 18mm 16mm; }}
    body {{ font-family: "Songti SC", "SimSun", serif; color: #111; line-height: 1.72; font-size: 13.5px; }}
    h1 {{ text-align: center; font-size: 24px; margin: 0 0 18px; }}
    h2 {{ font-size: 18px; margin: 22px 0 8px; border-bottom: 1px solid #999; padding-bottom: 4px; }}
    h3 {{ font-size: 15px; text-align: center; margin: 16px 0 8px; }}
    p {{ margin: 6px 0; text-indent: 2em; }}
    .meta p, .signature p, .caption {{ text-indent: 0; }}
    ol {{ padding-left: 24px; margin: 6px 0; }}
    li {{ margin: 3px 0; }}
    .page-break {{ page-break-before: always; }}
    .figure {{ page-break-inside: avoid; margin: 12px 0 18px; }}
    img {{ display: block; max-width: 100%; max-height: 210mm; margin: 0 auto; border: 1px solid #d9d9d9; }}
    .caption {{ font-size: 12.5px; color: #333; margin-top: 6px; }}
    .signature {{ margin-top: 24px; }}
  </style>
</head>
<body>
  <h1>德州扑克胜率分析器软件 V1.0 补正材料</h1>
  <section class="meta">
    {p("流水号：2026R11L1225249")}
    {p("软件名称：德州扑克胜率分析器软件[简称：德扑分析器]V1.0")}
    {p("申请人：何旻洋")}
    {p("补正日期：2026年5月18日")}
  </section>

  <h2>一、补正说明</h2>
  {p("尊敬的中国版权保护中心：")}
  {p("本人申请的软件著作权登记事项，流水号为 2026R11L1225249，软件名称为“德州扑克胜率分析器软件[简称：德扑分析器]V1.0”。根据贵中心出具的《软件登记补正通知书》，现对申请材料作如下补正：")}
  {p("一、关于“文档鉴别材料缺少软件运行截图”的问题，现已重新整理并提交软件文档鉴别材料补正版。补正版材料结合软件主要功能和技术特点，补充了软件实际运行界面截图，展示了软件启动主界面、手牌选择、公共牌录入、对手数量设置、牌局信息设置、胜率分析结果、牌型分布、决策建议、起手牌强度表、AI 德扑顾问及拍照识牌等主要功能和使用流程。")}
  {p("二、关于“申请确认签章页未抄写划线部分内容”的问题，申请人将按版权中心系统生成的申请确认签章页要求，在指定位置逐字手写抄写划线部分内容，并重新签名确认后提交。")}
  {p("以上补正材料真实、完整，与本次申请的软件名称、版本号、申请人信息保持一致，请予以审核。")}
  <section class="signature">
    {p("申请人：何旻洋")}
    {p("日期：2026年5月18日")}
  </section>

  <div class="page-break"></div>
  <h1>德州扑克胜率分析器软件 V1.0 软件文档鉴别材料（补正版）</h1>
  <h2>一、软件基本信息</h2>
  <section class="meta">
    {p("软件全称：德州扑克胜率分析器软件 V1.0")}
    {p("软件简称：德扑分析器")}
    {p("版本号：V1.0")}
    {p("申请人：何旻洋")}
    {p("软件类型：应用软件")}
    {p("开发方式：独立开发")}
  </section>

  <h2>二、软件概述</h2>
  {p("德州扑克胜率分析器软件 V1.0 是一款用于德州扑克牌局概率分析、牌力评估和学习复盘的应用软件。软件支持用户选择两张手牌，录入翻牌、转牌、河牌等公共牌，设置对手数量和牌局信息，并通过蒙特卡洛模拟算法计算当前牌局下的胜率、平局率、失败率、牌型分布和参考决策建议。")}
  {p("软件同时提供起手牌强度表、AI 德扑顾问、拍照识牌、PWA 安装入口等功能，用于帮助用户理解不同阶段的牌力变化和局面风险。本软件主要用于学习、复盘和娱乐分析场景。")}

  <h2>三、软件主要功能</h2>
  <ol>{''.join(li(item) for item in features)}</ol>

  <h2>四、软件技术特点</h2>
  <ol>{''.join(li(item) for item in tech)}</ol>

  <h2>五、主要使用流程</h2>
  {p("用户进入软件主界面后，选择两张手牌，并按翻牌、转牌、河牌阶段录入公共牌；随后设置对手数量和牌局信息，点击“开始分析”执行模拟计算。软件输出胜率、平局率、失败率、底池赔率、Call EV、当前最佳牌型、牌型分布和决策建议。用户还可查看起手牌强度表，打开 AI 德扑顾问获得进一步策略说明，或使用“扫一扫”进入拍照识牌界面。")}

  <h2>六、软件运行截图</h2>
  {''.join(image_blocks)}

  <h2>七、结论</h2>
  {p("以上材料补充展示了德州扑克胜率分析器软件 V1.0 的真实运行界面、主要功能、技术特点和完整使用流程，可用于替换或补充原软件文档鉴别材料中缺少运行截图的问题。")}
</body>
</html>
"""
    HTML_PATH.write_text(content, encoding="utf-8")
    print(HTML_PATH)


if __name__ == "__main__":
    main()
