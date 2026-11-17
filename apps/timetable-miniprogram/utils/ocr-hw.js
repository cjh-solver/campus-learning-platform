/* 作业通知截图：把 VisionKit 认出来的锚点拼成行，交给 hw 的通知解析
   只做「锚点 → 文本 → 条目」这一层，日期与课程归一仍在 hw.js 里 */

const hw = require("./hw");

/* 官方只承诺 anchor.text，坐标属于实机可能附带的东西：有就按纵向排，没有就信原顺序 */
function topOf(anchor) {
  if (!anchor) return null;
  const pts = anchor.points;
  if (Array.isArray(pts) && pts.length) {
    let min = null;
    pts.forEach(function (p) {
      if (p && typeof p.y === "number" && isFinite(p.y)) {
        if (min === null || p.y < min) min = p.y;
      }
    });
    if (min !== null) return min;
  }
  const o = anchor.origin;
  if (o && typeof o.y === "number" && isFinite(o.y)) return o.y;
  return null;
}

/* 锚点带坐标时按从上到下重排；有一个没坐标就整体保持原序，别混着排 */
function orderUnits(units) {
  const arr = (units || []).slice();
  if (arr.length < 2) return arr;
  const tops = arr.map(function (u) { return topOf(u && u.anchor); });
  if (tops.some(function (t) { return t === null; })) return arr;
  const idx = arr.map(function (_, i) { return i; });
  idx.sort(function (a, b) { return tops[a] - tops[b] || a - b; });
  return idx.map(function (i) { return arr[i]; });
}

/* OCR 常把整页文字吐成一长串、把换行吃掉，字段全挤在一行里就谁也认不出来。
   按字段名重新切回一行一条，再交给逐行解析 */
const KEY_CUT = /(你的作业还有|课程名称|所属课程|作业名称|作业标题|任务名称|结束时间|截止时间|提交截止|到期时间|开始时间|发布时间|开放时间|学习通知|课程通知|作业结束提醒|作业通知|考试通知|考试提醒|考试安排|考试课程|考试时间|考试日期|开考时间|考试地点|考试地址|考场)/g;

function resegment(line) {
  return String(line || "").replace(KEY_CUT, "\n$1");
}

function linesFromUnits(units) {
  const lines = [];
  orderUnits(units).forEach(function (u) {
    String(u && u.text !== undefined ? u.text : u)
      .split(/\r?\n/)
      .forEach(function (raw) {
        resegment(raw).split(/\r?\n/).forEach(function (t) {
          lines.push(String(t).replace(/\u00a0/g, " ").trim());
        });
      });
  });
  return lines.filter(function (l) { return l !== ""; });
}

/* 读出来那片文字，回填到输入框让人看得见、改得动 */
function linesToText(lines) {
  return (lines || []).join("\n");
}

/* units 可以是 vkOcr 返回的 anchors，也可以直接是字符串数组 */
function parseShot(units, opts) {
  const lines = linesFromUnits(units);
  const text = linesToText(lines);
  const r = hw.parseHwNotice(lines, opts || {});
  return {
    list: r.items,
    stamp: r.stamp,
    ignored: r.ignored,
    rawLines: lines,
    text: text
  };
}

/* 考试通知：字段是课程 / 时间 / 地点，一张图通常就一场 */
function parseExamShot(units, opts) {
  const lines = linesFromUnits(units);
  const text = linesToText(lines);
  const r = hw.parseExamNotice(lines, opts || {});
  return {
    list: r.items,
    ignored: r.ignored,
    rawLines: lines,
    text: text
  };
}

/* 多张图：每张单独解析，条目不跨图串；原文按张拼接，缺字段的那张也留着字
   返回的 list 里带 from（来自第几张）和 idx（全局序号） */
function mergeShots(shots, opts) {
  const items = [];
  const texts = [];
  let seen = 0;
  (shots || []).forEach(function (shot, i) {
    const units = shot && shot.anchors ? shot.anchors : shot;
    const p = parseShot(units, opts);
    if (p.text) texts.push(p.text);
    p.list.forEach(function (h) {
      items.push({
        course: h.course,
        title: h.title,
        due: h.due,
        infer: h.infer,
        approx: h.approx,
        guess: !!h.guess,
        from: i + 1,
        idx: seen++
      });
    });
  });
  return {
    list: items,
    text: texts.join("\n\n"),
    shots: (shots || []).length,
    parsed: (shots || []).length
  };
}

/* 多张图考试：每张单独解析，条目不跨图串；原文按张拼接，缺字段的那张也留着字
   返回的 list 里带 from（来自第几张）和 idx（全局序号） */
function mergeExamShots(shots, opts) {
  const items = [];
  const texts = [];
  let seen = 0;
  (shots || []).forEach(function (shot, i) {
    const units = shot && shot.anchors ? shot.anchors : shot;
    const p = parseExamShot(units, opts);
    if (p.text) texts.push(p.text);
    p.list.forEach(function (e) {
      items.push({
        course: e.course,
        date: e.date,
        time: e.time,
        place: e.place,
        guess: !!e.guess,
        from: i + 1,
        idx: seen++
      });
    });
  });
  return {
    list: items,
    text: texts.join("\n\n"),
    shots: (shots || []).length,
    parsed: (shots || []).length
  };
}

module.exports = {
  topOf: topOf,
  orderUnits: orderUnits,
  linesFromUnits: linesFromUnits,
  linesToText: linesToText,
  parseShot: parseShot,
  parseExamShot: parseExamShot,
  mergeShots: mergeShots,
  mergeExamShots: mergeExamShots
};
