# 斗地主 · 联机版（纯静态 / GitHub Pages 可托管）

一个**不需要服务器、不需要注册账号**的三人斗地主网页游戏：房主点一下「创建房间」拿到 4 位房号，
把房号发给两位朋友，他们输入房号就能入座开局。

联机走 WebRTC 点对点直连（PeerJS），对局逻辑完全在房主浏览器里跑，其他人只发动作、收视图。
整个网站就是几个静态文件，直接丢到 GitHub Pages 就能玩。

![纯静态](https://img.shields.io/badge/backend-none-brightgreen)
![依赖](https://img.shields.io/badge/deps-PeerJS%20(已内置)-blue)
![许可证](https://img.shields.io/badge/license-MIT-lightgrey)

---

## 目录

- [三分钟部署到 GitHub Pages](#三分钟部署到-github-pages)
- [本地试玩](#本地试玩)
- [怎么玩](#怎么玩)
- [已实现的规则](#已实现的规则)
- [联机原理](#联机原理)
- [常见问题](#常见问题)
- [进阶：自建信令服务器](#进阶自建信令服务器)
- [目录结构](#目录结构)
- [开发与测试](#开发与测试)
- [协议速查](#协议速查)
- [已知限制](#已知限制)

---

## 三分钟部署到 GitHub Pages

仓库已经准备好了（`git` 已初始化并提交、`.github/workflows/pages.yml` 自动部署、`.nojekyll` 已加）。

**1. 在 GitHub 上新建一个空仓库**（例如 `ddz-online`），不要勾选 README / .gitignore。

**2. 推送代码**（把地址换成你自己的）：

```bash
git remote add origin https://github.com/<你的用户名>/ddz-online.git
git branch -M main
git push -u origin main
```

**3. 打开仓库 → Settings → Pages → Build and deployment**
- **Source 选 `GitHub Actions`**（推荐，本仓库自带工作流，推送后自动发布）；
- 或者选 `Deploy from a branch` → `main` / `/ (root)`（仓库根目录就是网站根目录）。

**4. 等 1 分钟左右**，访问：

```
https://<你的用户名>.github.io/ddz-online/
```

把这两个链接发到群里就能开局了。手机浏览器建议加「添加到主屏幕」，和 App 差不多。

> 免费账号的 Pages 只对 **public 仓库**开放；私有仓库要用 Pro。
> 自定义域名：Settings → Pages → Custom domain 填域名，再在域名服务商加一条 CNAME。

---

## 本地试玩

浏览器的 WebRTC 只在**安全上下文**（`https://` 或 `http://localhost`）下可用，
所以**不能直接双击 `index.html`**（`file://` 会失败），必须起一个本地服务器：

```bash
node tools/serve.mjs          # 自带零依赖静态服务器，默认 http://localhost:8080
# 或者
python -m http.server 8080    # 或者 npx serve .
```

然后开**三个浏览器标签页**（或一个电脑 + 两部手机连同一 WiFi）分别创建 / 加入同一个房号，即可自己走完整流程。

---

## 怎么玩

| 步骤 | 说明 |
| --- | --- |
| 建房 | 填昵称 → 「创建房间」→ 屏幕上的 4 位房号就是房间号 |
| 加入 | 填昵称 + 4 位房号 → 「加入房间」，自动坐在空位上 |
| 开局 | 满 3 人后房主点「开始游戏」 |
| 叫分 | 轮到的人选「不叫 / 1 分 / 2 分 / 3 分」，分必须比前面高；叫 3 分立即成为地主，三家都不叫则重新发牌 |
| 出牌 | 点手牌选中（会弹起），点「出牌」；不确定就点「提示」自动选一手 |
| 不出 | 上家出牌后你可以「不出」；连续两家不出，上一手出牌的人重新自由出牌 |
| 结算 | 谁先出完谁赢，按「底分 × 倍数」算分，房主可点「再来一局」 |

**倍数**：每出现一个炸弹 / 王炸 ×2；春天（地主赢且农民一张没出）×2；反春天（农民赢且地主只出过一手）×2。

**计分**：地主赢 → 地主 `+2S`、两个农民各 `-S`；农民赢则相反（`S = 底分 × 倍数`）。三家分数永远守恒。

---

## 已实现的规则

牌点大小：`3 < 4 < … < 10 < J < Q < K < A < 2 < 小王 < 大王`

| 牌型 | 组成 | 备注 |
| --- | --- | --- |
| 单张 / 对子 / 三张 | 1 / 2 / 3 张同点 | |
| 三带一 / 三带二 | 三张 + 1 单 / + 1 对 | |
| 顺子 | ≥5 张连续单牌 | 不能含 2 和王 |
| 连对 | ≥3 组连续对子 | 不能含 2 和王 |
| 飞机 | ≥2 组连续三张 | 可带同数量的单牌或对子 |
| 四带二 / 四带两对 | 四张 + 2 单 / + 2 对 | |
| 炸弹 | 4 张同点 | 可压任何非炸弹牌型，倍数 ×2 |
| 王炸 | 双王 | 最大，倍数 ×2 |

比较规则：同牌型且张数相同才能比大小；炸弹压一切普通牌型，王炸最大。

---

## 联机原理

```
房主浏览器 ──(WebRTC DataChannel)──> 好友 A
     └──────(WebRTC DataChannel)──> 好友 B
            ↑ 只靠公共 PeerJS 信令服务器牵线（不传对局数据）
```

- **信令**：用 PeerJS 官方免费公共服务器（`0.peerjs.com`）交换 SDP，只负责"牵线"，不参与游戏。
- **对局**：房主是唯一权威，负责发牌、校验牌型、算分，并把**各自可见的视图**（只含自己的手牌）推给每个人；其他人把动作发给房主。
- **房号**：`ddzcard-` + 4 位大写字母数字，对应 PeerJS 的 peer id；撞号会自动换一个。
- **掉线重连**：座位名字会保留，同名重新加入即可坐回原位（对局中也可以）。

---

## 常见问题

**连不上 / 一直转圈**
公共信令服务器偶尔抽风，等几秒重试；公司/校园网若禁用 UDP，P2P 可能打洞失败，换手机热点再试。
实在不行就[自建信令服务器](#进阶自建信令服务器)。

**提示「房号不存在或房主已离线」**
房号错了一位，或者房主关掉了页面。房主必须保持页面在前台（可以切后台，但别关）。

**问「房主是不是能看到我的牌」**
技术上：房主浏览器负责校验和发牌，所以**能**看到所有牌。请和朋友玩；想彻底防作弊得改成服务端权威（那就不是纯静态了）。

**手机上打不开**
必须是 `https://` 或 `localhost`。GitHub Pages 天然是 https，没问题。

**第三个朋友进不来**
房间只有 3 个座位，会提示「房间已满」。

**想改成一个人也能玩**
本版本按你的要求只做真人对战；加 AI 可以在 `js/game.js` 外面套一个"机器人玩家"，用 `js/rules.js` 的 `findHints()` 选牌即可。

---

## 进阶：自建信令服务器

`js/net.js` 支持覆盖 PeerJS 配置。在 `index.html` 里 `peerjs.min.js` 之前加一段：

```html
<script>
  // 默认留空 = 使用 PeerJS 官方公共服务器
  window.PEER_OPTIONS = {
    host: 'your-peer-server.com',
    port: 443,
    path: '/',
    secure: true,
    key: 'peerjs',
  };
</script>
```

自建方式：`npx peerjs --port 9000 --path /myapp`，再用 Nginx 反代到 https。

---

## 目录结构

```
.
├── index.html              # 页面骨架（首页 / 房间 / 牌桌三个视图）
├── css/style.css           # 全部样式（移动端优先，绿色牌桌主题）
├── js/
│   ├── rules.js            # 牌型识别、大小比较、提示枚举（纯函数）
│   ├── game.js             # 对局状态机：发牌 / 叫分 / 出牌 / 倍数 / 结算
│   ├── net.js              # PeerJS 联机层（房主 HostRoom / 加入者 GuestRoom）
│   ├── ui.js               # 渲染与交互
│   ├── main.js             # 入口：大厅、对局、网络串联
│   └── vendor/peerjs.min.js# PeerJS 1.5.5 浏览器版（已内置，不依赖 CDN）
├── test/
│   ├── rules.test.mjs      # 牌型 / 大小比较 / 提示（纯逻辑，无依赖）
│   ├── game.test.mjs       # 发牌、叫分、出牌、倍数、结算（含 200 局随机对局）
│   ├── ui-smoke.mjs        # jsdom：点按钮打完整局，检查渲染与交互
│   └── e2e-smoke.mjs       # jsdom + 假 Peer：建房/入座/开局/重连全流程
├── tools/serve.mjs         # 本地静态服务器
└── .github/workflows/pages.yml  # 推送 → 跑测试 → 部署 GitHub Pages
```

---

## 开发与测试

```bash
npm install        # 只有 UI / 端到端测试需要 jsdom，纯逻辑测试零依赖
npm run test       # 规则 + 状态机单元测试（含 200 局随机对局校验）
npm run test:ui    # jsdom 里点按钮打完整局
npm run test:e2e   # jsdom + 假 PeerJS 跑完整联机流程
npm run test:all   # 上面三个一起跑（CI 跑的就是这个）
npm run serve      # 本地起服务，http://localhost:8080
```

`js/rules.js` 和 `js/game.js` 不碰 DOM、不碰网络，可以单独跑；
`js/ui.js` 只碰 DOM；`js/net.js` 只碰 PeerJS。想改规则改前两个文件即可。

CI：每次 push 到 `main` 会自动 `npm ci && npm run test:all`，测试通过才发布，所以改坏了不会上线。

> **改完记得升版本号**：GitHub Pages 的静态资源会被浏览器缓存 10 分钟。改了 `js/` 或 `css/` 后，
> 把 `index.html` 里两处 `?v=2`（`css/style.css?v=2`、`js/main.js?v=2`）的数字 +1，
> 子模块会自动继承这个版本号，朋友刷新即可看到新版。

---

## 协议速查

房主 → 成员：`{t:'joined', seat, code}`、`{t:'lobby', seats}`、`{t:'state', view}`、`{t:'toast', msg}`、`{t:'full'}`

成员 → 房主：`{t:'hello', name}`、`{t:'action', a:{type:'bid', value}}` / `{type:'play', cards:[id…]}` / `{type:'pass'}`

`view` 是某人视角的公开信息 + 自己的手牌，**不含别人的手牌**。

---

## 已知限制

- 只有经典三人斗地主，无 AI、无观战、无聊天、无记牌器。
- 房主是权威、也是"服务器"，房主退出即散局。
- 依赖公共信令服务器，极端网络环境（对称 NAT）可能连不上。
- 计分为纯娱乐分数，不做跨局累计与战绩存储。

## License

MIT
