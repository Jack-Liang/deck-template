# deck-template — 双击就能放的 HTML 幻灯片

A no-build, zero-dependency HTML slide deck template. Write slides in one
`index.html`, double-click to present, export to PDF / single-file HTML / a
zip to share. （中文说明如下）

没有框架、没有构建步骤、没有运行时依赖：一份 `index.html` 写内容，
`css/` 定外观，`js/` 管行为，双击就能放映。内容是纯文本，可以 diff、
可以 code review、可以进 git；导出的 PDF 每页一张 16:9、深色底保真，
单文件 HTML 一个 `.html` 发出去对方双击就能看。

改编自 larshp 的 [dsag-git-2026](https://github.com/larshp/dsag-git-2026)
（感谢！），类名通用化成一套设计系统，并补了演讲者视图、代码步进、
语法高亮和三个导出脚本。

## 快速开始

```bash
# 拿到仓库（或点 GitHub 上的 Use this template）
git clone https://github.com/<you>/deck-template.git my-talk
cd my-talk

# 放映：直接双击 index.html，或起个本地服务（彩排推荐，手机同 Wi-Fi 可预览）
python3 -m http.server 8644     # 打开 http://127.0.0.1:8644
```

改内容只动两个文件：

- `index.html` — 全部幻灯片内容（示例稿 16 页就是版式说明书，照抄改字）
- `css/custom.css` — `:root` 里的色板字体，以及你自己的扩展样式

## 示例稿导览

`index.html` 自带的 16 页示例正好把每种版式用一遍，页面内容同时在讲
这个版式怎么用，每页备注栏（演讲者视图可见）写着要点：

| 页 | 版式 | 演示什么 |
| --- | --- | --- |
| 1 | `slide-title` | 深色开场页：场次顶行、主副标题、讲者、logo 位 |
| 2 | `slide-content` + `steps-3` | 总览页三步卡片 |
| 3 | `slide-speakers` | 讲者卡 ×2（含联系方式图标） |
| 4 | `slide-chapter` | 深色章节页 |
| 5 | `stats` + `takeaway` | 三个大数字 + 结论条（takeaway 带 fragment 步进） |
| 6 | `facts` + `init` | 三栏事实卡 + 首字母高亮 |
| 7 | `timeline` | 竖向时间线 |
| 8 | `path` | A → B 路径图（三元素各自步进） |
| 9 | `pills` | 标签墙 |
| 10 | `slide-sparse` + `quote` | 一句话独占整页 |
| 11 | `cards` + `file-ref` | 链接卡 ×2 |
| 12 | `pre[data-lines]` | 代码逐段点亮 + 内置语法高亮 |
| 13 | `split-body` + `mech` + `shot-inline` | 左机制图右截图的双栏体 |
| 14 | `slide-screen` | 整页截图 / 录屏 GIF |
| 15 | `slide-interlude` | 深色过场页（大字 + 太阳装饰） |
| 16 | `slide-closing` | 深色结束页：Q&A + 可点击二维码 |

## 目录结构

```
index.html            幻灯片内容（你主要改的文件）
handout.md            配套讲义模板（随包分发，可删）
css/
  deck.css            引擎层样式：缩放、总览、打印分页（一般不动）
  custom.css          设计系统：色板、版式、组件（换色在 :root）
js/
  deck.js             引擎：翻页/缩放/总览/演讲者视图/代码步进
  highlight.js        轻量语法高亮（bash/json/yaml/diff）
  easter-egg.js       源码彩蛋（Shift+E，内容可自己改）
assets/               图片素材；占位图换成的你的截图/二维码/logo
export_pdf.py         导出 PDF（Chrome/Edge 无头打印）
export_single.py      导出单文件 HTML（全资源内联）
build_zip.py          打分发包 zip（附打开说明 + 顺手导 PDF）
```

## 放映

| 键 | 作用 |
| --- | --- |
| → / 空格 / ← | 翻页（触屏滑动也行） |
| `o` | 总览模式：全部页缩略图，点选跳转 |
| `f` | 全屏 |
| `b` | 黑屏（备稿/吸引注意力） |
| `s` | 演讲者视图：弹出第二窗口——当前页、下一页预览、备注、计时器 |
| `?` | 完整快捷键一览 |

- 带 `class="fragment"` 的块按 → 逐个亮起；打印和 PDF 里自动全展开。
- `pre` 加 `data-lines="1-2,3,5"`（1 基行号，逗号分步、支持区间），
  代码按 → 逐段点亮，未点到的行压暗不隐藏。
- URL 用 1 基页码定位：`index.html#/8` 直接开第 8 页。
- 每页 `<aside class="notes">` 是备注，只在演讲者视图里出现。

## 导出与分发

```bash
python build_zip.py      # dist/deck.zip（+ 同名 PDF）：发群文件，解压双击即看
python export_pdf.py     # dist/deck.pdf：每页一张 16:9、无页边距、深色底保真
python export_single.py  # dist/deck.html：CSS/JS/图片全内联，一个文件发出去就能放
```

- PDF 走无头 Chromium 打印，自动探测 Chrome / Edge / Chromium / Brave；
  fragment 与代码步进全展开、GIF 截首帧。
- 二维码的口径可按场合选：PDF/打印稿里隐藏，放开 `css/custom.css`
  打印段里注释掉的两条规则即可；单文件导出加 `--no-qr`，元素、图片、
  链接全部从产物里摘除。
- 打包规则：只收 `index.html + css/ + js/ + handout.md` 和被引用到的素材，
  附一份「打开说明.txt」；`--include-dev` 连 README 一起打。

## 定制

- **换色**：`css/custom.css` 顶部 `:root`——`--accent`（强调红）、
  `--deep`（深蓝）两个主色加对应的 `*-rgb` 三元组，全站随之变。
- **换字体**：同在 `:root`（`--sans` / `--mono`）。
- **logo**：开场页标题右侧可加 `.title-logos` 一行（样式在 custom.css，
  `assets/logo-a.svg`、`logo-b.svg` 是占位图），换成主办方/公司标识。
- **加高亮语法**：`js/highlight.js` 顶部 `GRAMMARS` 加一组正则即可。
- **彩蛋**：`js/easter-egg.js` 的 `CARD` 字符串随便改，样式通用。
- **删功能**：不需要的脚本直接从 `index.html` 底部摘掉 `<script>` 即可，
  引擎之间无耦合（`deck.js` 只依赖 `highlight.js` 的全局可选）。

## 致谢与许可

- 设计与引擎血统来自 larshp 的
  [dsag-git-2026](https://github.com/larshp/dsag-git-2026)，感谢原版的
  「no framework, no build step」实践。
- 本模板以 [MIT](LICENSE) 发布；示例稿内容可随意取用替换。
