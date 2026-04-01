# ♠ 德州扑克胜率分析器 | Texas Hold'em Equity Analyzer

一款专业的德州扑克胜率分析工具，基于 **Monte Carlo 蒙特卡洛模拟算法**，支持翻前/翻牌/转牌/河牌全阶段分析，并集成 **AI 策略顾问**（DeepSeek）提供智能决策建议。

> 🎯 纯前端实现，零依赖框架，支持 PWA 离线使用

---

## ✨ 功能亮点

| 功能 | 描述 |
|------|------|
| 🎰 **蒙特卡洛模拟** | 20,000 次随机模拟，精确估算各阶段胜率 |
| 📊 **全阶段分析** | 支持翻前 → 翻牌 → 转牌 → 河牌四个阶段 |
| 🃏 **起手牌热力图** | 13×13 起手牌强度矩阵，直观展示各组合胜率 |
| 🤖 **AI 策略顾问** | 集成 DeepSeek 大模型，提供专业策略建议 |
| 👥 **多对手支持** | 支持 1-8 位对手同时模拟 |
| 📱 **PWA 离线应用** | 支持安装到主屏幕，离线也能使用 |
| ⚡ **Web Worker** | 后台线程计算，UI 完全不卡顿 |
| 🌙 **暗色主题** | 高端深色 UI，赌场氛围感拉满 |

---

## 🏗️ 技术架构

```
poker-analyzer/
├── index.html              # 主页面（单页应用入口）
├── css/
│   └── style.css           # 完整样式（暗色主题 + 响应式布局）
├── js/
│   ├── poker.js            # 🎯 核心引擎：牌型定义、评估、比较
│   ├── simulator.js        # 📊 蒙特卡洛模拟器
│   ├── app.js              # 🖥️ UI 交互逻辑（状态管理 + 渲染）
│   └── worker.js           # ⚡ Web Worker（后台模拟计算）
├── functions/
│   └── api/
│       └── chat.js         # 🤖 Cloudflare Pages Function（AI 代理）
├── manifest.json           # 📱 PWA 清单
└── sw.js                   # 💾 Service Worker（缓存策略）
```

---

## 🔧 核心算法解析

### 1. 牌型评估系统 (`poker.js`)

采用 **O(N) 统计法**替代传统的组合枚举，大幅提升评估性能：

```javascript
// 核心思路：通过统计点数和花色分布，一次遍历判断牌型
// 而非生成所有 C(7,5) = 21 种组合
function getBestHand(cards) {
    // 1. 统计各点数出现次数 & 各花色牌数
    // 2. 优先级判断：皇家同花顺 > 同花顺 > 四条 > ... > 高牌
    // 3. 返回 { handRank, values } 用于同牌型比较
}
```

**支持的10种牌型（从高到低）：**

| 等级 | 牌型 | 英文 |
|------|------|------|
| 9 | 皇家同花顺 | Royal Flush |
| 8 | 同花顺 | Straight Flush |
| 7 | 四条 | Four of a Kind |
| 6 | 葫芦 | Full House |
| 5 | 同花 | Flush |
| 4 | 顺子 | Straight |
| 3 | 三条 | Three of a Kind |
| 2 | 两对 | Two Pair |
| 1 | 一对 | One Pair |
| 0 | 高牌 | High Card |

### 2. 蒙特卡洛模拟 (`simulator.js`)

通过大量随机模拟来估算胜率，核心流程：

```
对于每次模拟：
  1. 从剩余牌组中随机抽牌，补全公共牌至5张
  2. 为每个对手随机发2张手牌
  3. 分别评估"我"和"所有对手"的最佳牌型
  4. 比较结果 → 累计胜/平/负次数
最终：胜率 = 胜次数 / 总模拟次数 × 100%
```

- **快速模式**：5,000 次模拟（用于实时预览）
- **精确模式**：20,000 次模拟（用于最终结果）
- **洗牌算法**：Fisher-Yates 算法保证随机均匀

### 3. Web Worker 多线程 (`worker.js`)

将重度计算放到后台线程，避免阻塞 UI：

```javascript
// 主线程 → Worker：发送模拟参数
worker.postMessage({ myHand, communityCards, numOpponents, numSimulations });

// Worker → 主线程：实时进度 + 最终结果
self.postMessage({ type: 'PROGRESS', progress: 50 });  // 进度 50%
self.postMessage({ type: 'DONE', result });              // 计算完成
```

### 4. 起手牌预计算 (`poker.js` → `generatePreflopChart`)

生成 13×13 的起手牌强度矩阵，每种组合通过 Monte Carlo 模拟预计算对战1位对手时的胜率：

- **对角线**：口袋对（AA, KK, QQ...）
- **上三角**：同花组合（AKs, AQs...）
- **下三角**：非同花组合（AKo, AQo...）

### 5. AI 策略顾问 (`functions/api/chat.js`)

通过 **Cloudflare Pages Functions** 安全代理 DeepSeek API：

```
前端 → /api/chat → Cloudflare Worker → DeepSeek API
                    (API Key 安全存储在环境变量中)
```

AI 会根据当前牌面情况（手牌、公共牌、胜率、对手数量）给出专业的策略分析。

---

## 🚀 快速开始

### 本地运行

如果你只想体验牌力计算，不需要 AI：

```bash
# 克隆仓库
git clone https://github.com/yourusername/poker-analyzer.git
cd poker-analyzer

# 由于是纯静态站点，直接用任意 HTTP 服务器启动即可
# 方法一：Python
python3 -m http.server 8080

# 方法二：Node.js
npx serve .

# 方法三：VS Code Live Server 插件
# 右键 index.html → Open with Live Server
```

然后访问 `http://localhost:8080`

如果你要在本地测试 AI 接口 `/api/chat`，不要只开静态服务器，而是要运行 Cloudflare Pages Functions：

```bash
# 推荐：本地同时启动静态资源 + functions/api/*
npm run dev
```

补充说明：

- `python3 -m http.server` / `npx serve .` 只会提供静态文件，点击 AI 按钮会因为没有 `/api/chat` 而失败。
- `npm run dev` 底层使用 `wrangler pages dev .`，这样本地才会真正加载 `functions/` 目录。
- 本地调试 AI 前，仍然需要先在 Cloudflare / Wrangler 中配置 `DEEPSEEK_API_KEY`。

### 部署到 Cloudflare Pages

```bash
# 1. 安装 Wrangler CLI
npm install -g wrangler

# 2. 登录 Cloudflare
wrangler login

# 3. 部署（自动识别 functions/ 目录作为 Pages Functions）
wrangler pages deploy .

# 4. 设置 AI 功能的 API 密钥（可选）
wrangler pages secret put DEEPSEEK_API_KEY

# 5. 设置允许调用 /api/chat 的来源域名（必配，多个用逗号分隔）
# 例如：正式域名 + pages.dev 域名
wrangler pages secret put ALLOWED_ORIGINS

# 6. 设置 AI 接口最小请求间隔（毫秒，可选，默认 2500）
wrangler pages secret put CHAT_MIN_INTERVAL_MS
```

---

## 🎮 使用指南

1. **选择手牌**：点击卡牌选择器，选择你的2张底牌
2. **添加公共牌**（可选）：按阶段添加已知的公共牌
3. **设置对手数量**：滑动条选择 1-8 位对手
4. **开始分析**：点击"开始分析"按钮，等待模拟计算
5. **查看结果**：胜率、牌型分布、决策建议一目了然
6. **AI 策略**（可选）：点击"AI 策略分析"获取深度建议

---

## 🛠️ 技术栈

- **前端**：原生 HTML5 + CSS3 + JavaScript（零框架依赖）
- **计算**：Web Worker + Monte Carlo 模拟
- **AI**：DeepSeek API（通过 Cloudflare Pages Functions 安全代理）
- **离线**：Service Worker + Cache API（PWA）
- **部署**：Cloudflare Pages

---

## 🔒 安全与风控说明（微信/QQ 拦截）

如果你在微信或 QQ 内置浏览器看到“该网页所属平台可能存在被恶意利用”的提示，通常是平台检测到站点存在可滥用接口（例如开放 AI 代理）。

本项目现在已在 [`functions/api/chat.js`](functions/api/chat.js) 增加：

- 来源域名校验（`ALLOWED_ORIGINS`）
- 基于 IP 的最小间隔限流（`CHAT_MIN_INTERVAL_MS`）
- 请求体大小和消息字段白名单
- 固定模型与参数上限，避免任意透传

建议处理流程：

1. 先部署最新版本并确认 `ALLOWED_ORIGINS` 已配置。
2. 在微信拦截页点击“申请恢复访问”，说明“已完成接口滥用防护与限流”。
3. 尽量绑定自定义域名（不要长期只用 `pages.dev` 子域）。

---

## 📝 License

MIT License - 详见 [LICENSE](LICENSE)

---

<p align="center">
  <strong>♠♥♦♣</strong><br>
  <em>Made with ❤️ for poker enthusiasts</em><br>
  基于蒙特卡洛模拟 · 仅供参考学习
</p>
