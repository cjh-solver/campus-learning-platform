---
name: wechat-miniprogram-timetable
description: 微信原生小程序里做课表、周视图、日历网格，需要三屏缓冲区跟手翻周、固定节次列、跨周连续滚动，或要把小程序视觉与按压反馈收敛成一套统一口径时使用。含坐标系、手势状态机、屏宽测量与踩坑清单。
---

# 微信小程序课表页：三屏跟手翻周

面向微信原生框架，不用 swiper，不用第三方库。核心是把一周的课表当一张可横向拖动的画布，当前周居中，前后各备一周在两侧待命。

## 适用与不适用

适用：周维度的网格视图，列是星期，行是节次，需要左右滑动切换周次且保持连续视觉。

不适用：只需要点箭头切周、不需要跟手平移的场合，直接换数据更省事。数据量在几百条以内的单校课表都够用，超出后要考虑虚拟滚动。

## 一 渲染结构

### 1.1 网格坐标系

左侧节次列固定，不参与平移。右侧是可平移的轨道。

```text
.swipe  display:flex
  .fixed-col   68rpx，周次时间与节次号，永不移动
  .track       flex:1 min-width:0 position:relative
    .pane      三屏
```

行高用常量 `ROW_H = 84`，单位 rpx。课程块的位置由数据算出，不依赖表格布局：

```js
top: (start - 1) * ROW_H
height: len * ROW_H
left: (day - 1) / days * 100 + '%'
w: 1 / days * 100 + '%'
```

这样课程块直接绝对定位在 `.day-cols` 里，跨节次的课一次画完，不用合并单元格。列数在 5 和 7 之间切换时，只需改 `days`，百分比自动重算。

页面留白 `padding: 8rpx 12rpx 132rpx`，底部 132rpx 是给固定操作栏让位。整块课表是白卡，`border-radius: 16rpx` 加 `overflow: hidden`，让轨道超出部分被卡片裁掉。

### 1.2 三屏缓冲区

三屏不是横向排开，而是绝对定位叠在同一位置，靠 `left` 错开：

```css
.pane        width: 100%
.pane-prev   position: absolute; top: 0; left: -100%
.pane-next   position: absolute; top: 0; left: 100%
```

中间那一屏留在文档流里，负责把轨道撑到正常高度。左右两屏脱离流，不参与高度计算。

wxml 按数组下标给类名：

```html
<view class="pane {{index === 0 ? 'pane-prev' : index === 2 ? 'pane-next' : ''}}"
      wx:for="{{panes}}" wx:key="week" wx:for-item="pane">
```

为什么不用 flex 横排：小程序 webview 里，flex 子项的百分比 basis 可能按内容宽解析，屏宽和实测轨道宽对不齐，平移一屏之后位置差出一列，首屏会露出邻周的一列。绝对定位加 `width: 100%` 不吃这个亏。

### 1.3 数据派生

把按周过滤的逻辑收成一个闭包，三屏各调一次：

```js
function buildWeek(wk) {
  // 返回 { heads, blocks }
  // heads 是这周的星期与日期号，blocks 是这周生效的课程块
}
const cur = buildWeek(viewWeek);
const prevPane = viewWeek > 1 ? Object.assign({ week: viewWeek - 1 }, buildWeek(viewWeek - 1))
                             : { week: 0, heads: [], blocks: [] };
const nextPane = viewWeek < MAX_WEEK ? Object.assign({ week: viewWeek + 1 }, buildWeek(viewWeek + 1))
                                     : { week: 0, heads: [], blocks: [] };
const panes = [prevPane, Object.assign({ week: viewWeek }, cur), nextPane];
```

下标固定：0 是上周，1 是本周，2 是下周。越界时给空屏，保证三屏数量和定位类永远成立。

同时保留 `heads` 和 `blocks` 两个顶层字段指向本周数据，页面里按 id 查找课程、渲染顶部信息都直接读它们，不必每次从 `panes[1]` 里取。

## 二 跟手翻周状态机

### 2.1 坐标体系

三屏绝对定位之后，平移基准与 flex 方案不同，这是最容易出错的地方。

| 状态 | trackX |
| --- | --- |
| 本周居中 | `0` |
| 拖出上周 | `+paneW` |
| 拖出下周 | `-paneW` |
| 拖动范围 | `[-paneW, +paneW]` |
| 回弹 | `0` |

旧 flex 方案里本周在中间，基准是 `-paneW`。改成绝对定位后所有基准都要归零，包括初始渲染、测量回调、手势起点兜底、落定位，四处都要一致，漏一处就会出现首屏错位或拖动越界。

### 2.2 参数表

| 参数 | 取值 | 作用 |
| --- | --- | --- |
| 方向判定阈值 | 10px | 位移超过 10px 才锁定横或纵，避免轻微抖动误判 |
| 翻周距离阈值 | 屏宽 25% | 拖过四分之一屏就翻 |
| 甩速阈值 | 0.35 px/ms | 短距离快速甩也翻 |
| 边界阻尼 | 0.35 | 首尾周再往外拖，位移乘 0.35 |
| 落定动画 | `0.22s cubic-bezier(0.22, 1, 0.36, 1)` | 先快后稳的减速 |
| 落定等待 | 230ms | 略大于动画时长，动画播完再换数据 |

方向锁定只做一次。判定为纵向后本次手势不再处理横向位移，交给页面滚动。判定为横向后，把 `_moved` 置真，用来拦截触摸结束时的点按，避免拖动误触发课程详情或空格加课。

首尾周的处理是阻尼而不是钳死。拖到第 1 周继续往右拖，位移打折但不归零，给一点"拉到头了"的手感，同时因为钳制范围只有 ±一屏，不会拉出空白屏。

### 2.3 落定与换周

松手后先把轨道动画推到落定位，等动画播完再换数据：

```js
setData({ trackAnim: 'transform 0.22s cubic-bezier(0.22, 1, 0.36, 1)', trackX: settleX });
this._settleTimer = setTimeout(() => {
  if (targetWeek) { setData({ viewWeek: targetWeek }); refresh(); }
  setData({ trackAnim: '', trackX: 0 });
}, 230);
```

关键在 `refresh()` 与归零写在同一次 setData 里。新的上一周此刻正好停在 `left: -100%`，本周停在 0 位，所以内容和坐标一起换，画面上看不出跳变。如果先归零再换数据，会闪一下。

动画没播完就被再次触摸时，不能直接接着拖。要先清掉待落定定时器，把当前 `trackX` 作为新的起点 `_baseX`，并关掉过渡。这样用户随时能接管，不会卡在半路。

页面卸载时清理定时器，否则回调会往已销毁的页面写状态。

### 2.4 屏宽测量

优先实测，其次估算。

```js
onReady() {
  wx.createSelectorQuery().select('.track').boundingClientRect(rect => {
    if (rect && rect.width > 0) {
      this._paneW = rect.width;
      setData({ paneW: rect.width, trackX: 0 });
    }
  }).exec();
}
```

兜底估算按 rpx 换算，页面左右内边距共 24rpx，固定列 68rpx：

```js
this._paneW = w - (24 + 68) / 750 * w;
```

实测值会覆盖估算值，估算只在测量回调尚未返回时起作用。首次触摸可能发生在 onReady 之前，此时用估算值也能得到接近的结果。

## 三 视觉口径

色板集中在 `styles/vars.wxss`，页面只引用变量。

| 变量 | 值 | 用途 |
| --- | --- | --- |
| `--bg` | `#FAF9F6` | 页面底 |
| `--card` | `#FFFFFF` | 卡片 |
| `--ink` | `#1A1E1C` | 正文 |
| `--muted` | `#6D736C` | 次要文字，压白底约 4.86:1 |
| `--line` | `#E8E5DC` | 分隔线 |
| `--accent` | `#2E6B57` | 品牌绿，主按钮与强调 |
| `--brand-soft` | `#E7F0EB` | 今日列浅底 |
| `--warn` | `#C08A1E` | 警示 |
| `--r` | `14px` | 统一圆角 |

课程块用七色实底配白字，颜色按课程名做稳定哈希分配，同名课程每次打开都是同一个颜色。七个色值是 `#6CC666`、`#F0B43C`、`#B48AE4`、`#F08454`、`#F06084`、`#30CCAE`、`#E0682F`。

按压反馈只有五档，全部定义在 `app.wxss`，页面通过 `hover-class` 引用，不自造新类。

| 类 | 效果 | 场景 |
| --- | --- | --- |
| `tap-press` | 透明度 0.6 | 一般可点元素 |
| `tap-row` | 浅底 `#F7F5EF` | 列表行、网格空格 |
| `tap-accent` | 文字转品牌绿，透明度 0.75 | 文字链 |
| `press-brand` | 实底加深 `#285E4D` | 品牌主按钮 |
| `press-red` | 红色渐变 | 删除类 |

主按钮按压用加深底色，不让文字压透明度，否则白字会发灰。

图标统一规则：3rpx 描边，圆角端点，颜色走 `currentColor` 或 `var(--accent)`，主体落在 24 网格内居中。箭头做成基元复用：

```css
.arrow-r { border-top: 3rpx solid currentColor; border-right: 3rpx solid currentColor; transform: rotate(45deg); }
```

不给每个箭头各写一套边框，否则线宽和角度很快就不一致。

## 四 验证

纯逻辑层都放在 `utils/`，不依赖 `wx`，可以直接用 Node 跑断言。页面改动后按三层验证：

1. 语法：`node --check` 过一遍所有 js。
2. 编译：用微信开发者工具自带的 `wcc.exe` 编译 wxml，`wcsc.exe` 编译 wxss。`app.wxss` 里有 `@import` 中文路径时 wcsc 可能解析不通，这一层靠人工核对。
3. 断言：把样式常量、hover 计数、热区尺寸、禁用色写成脚本静态扫描，改动前后各跑一次。

手势这类没法静态验证的，列一份真机清单：首屏不露邻周、跟手时邻周从边缘进入、短拖回弹、过半屏或快甩翻周、首尾周阻尼、拖动后不误触发点按、5 天与 7 天切换后位置正常。

## 五 复用清单

接到一个新项目时按这个顺序改：

1. `styles/vars.wxss` 换色板，`--accent` 决定整套强调色。
2. `utils/week.js` 改 `SEMESTER_START`、`MAX_WEEK`、`PERIODS`。
3. `data/kb-data.js` 换成自己的快照，字段结构见 README。
4. `pages/timetable/timetable.js` 里 `ROW_H` 按自己的节次高度调，`buildBlock` 里调整课程卡文案截断规则。
5. 检查三屏坐标的四处基准是否都归零。
6. 跑一遍真机清单。

更细的踩坑记录见 `references/pitfalls.md`。
