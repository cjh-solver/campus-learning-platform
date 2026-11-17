/* 成绩截图 OCR 结果解析：把 VisionKit 的 anchors 还原成课程列表
   只认学习通/教务的卡片式成绩单（课程名 + 学分 + 获得学分 + 绩点 + 最终成绩）
   纯函数，不碰 wx，便于 Node 断言

   为什么不能直接按行拼：成绩单是左右两列卡片。OCR 的 anchor 只有 text，
   官方接口没承诺坐标，所以两种返回顺序都可能出现：
     A 每张卡片一个 anchor（text 里带换行）      → 行流天然是「一门五条」
     B 每个文本块一个 anchor，按阅读序从左到右   → 行流是「名L 名R 学分L 学分R …」
   B 的情况如果按「遇到最终成绩就收」会串课，因此这里按「课程名连续几条 = 几列」
   来判列数，再把同类字段轮流分给各列。 */

function norm(s) {
  return String(s === null || s === undefined ? "" : s)
    .replace(/：/g, ":")
    .replace(/[|｜]/g, " ")
    .replace(/[，,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toNum(v) {
  const n = parseFloat(String(v === null || v === undefined ? "" : v).replace(/[^\d.]/g, ""));
  return isFinite(n) ? n : null;
}

/* 只认明确的等级词，免得「成绩单」这类标题被当成一门成绩 */
const LEVEL_RE = /^(优秀|良好|合格|不合格|及格|不及格|通过|未通过|优|良|中|差|A|B|C|D|F)$/;

/* 一行属于哪种字段；kind 为 null 表示不是字段行（可能是课程名） */
function fieldOf(raw) {
  const s = norm(raw);
  if (!s) return { kind: "noise" };
  let m;
  if ((m = s.match(/^获[得取]\s*学分\s*:?\s*([\d.]+)/))) return { kind: "earned", value: toNum(m[1]), text: s };
  if (/^获[得取]\s*学分/.test(s)) return { kind: "earned", value: null, text: s };
  if ((m = s.match(/^学分\s*:?\s*([\d.]+)/))) return { kind: "credit", value: toNum(m[1]), text: s };
  if (/^学分/.test(s)) return { kind: "credit", value: null, text: s };
  if ((m = s.match(/^绩点\s*:?\s*([\d.]+)/))) return { kind: "gpa", value: toNum(m[1]), text: s };
  if (/^绩点/.test(s)) return { kind: "gpa", value: null, text: s };
  if ((m = s.match(/^(?:最终成绩|总评成绩|总成绩|最终|成绩)\s*:?\s*(\S.*)$/))) {
    const v = m[1].trim();
    if (/^[\d.]+$/.test(v)) return { kind: "score", value: toNum(v), text: s };
    if (LEVEL_RE.test(v)) {
      return { kind: "score", value: null, level: v, text: s };
    }
    return { kind: null, text: s };
  }
  return { kind: null, text: s };
}

/* 字段标签 + 取值。标签后必须紧跟冒号或数字/等级词，
   所以「学分银行」这类真课程名不会被误判，而「学分:5」粘在汉字后面也能抽出来 */
const FIELD_RE = /(获[得取]\s*学分|学分|绩点|最终成绩|总评成绩|总成绩)\s*[:：]?\s*([\d.]+|优秀|良好|合格|不合格|及格|不及格|通过|未通过|优|良|中|差)/g;

/* 把一行文本按字段位置切成 token 流：字段之间的文字就是课程名残片。
   这样左右两列粘成一整段、标签贴在汉字后没有空格的文本也能拆开 */
function scanTokens(raw) {
  const s = norm(raw);
  const tokens = [];
  if (!s) return tokens;
  FIELD_RE.lastIndex = 0;
  let prev = 0;
  let m;
  while ((m = FIELD_RE.exec(s))) {
    const chunk = s.slice(prev, m.index).trim();
    if (chunk) tokens.push({ type: "name", text: chunk });
    const label = m[1].replace(/\s+/g, "");
    let kind = "score";
    if (label.indexOf("获") === 0) kind = "earned";
    else if (label === "学分") kind = "credit";
    else if (label === "绩点") kind = "gpa";
    const v = m[2];
    const num = toNum(v);
    tokens.push({
      type: "field",
      kind: kind,
      value: num,
      level: num === null && LEVEL_RE.test(v) ? v : ""
    });
    prev = FIELD_RE.lastIndex;
  }
  const tail = s.slice(prev).trim();
  if (tail) tokens.push({ type: "name", text: tail });
  return tokens;
}

/* 去掉课程名残片里的页眉噪声：时间、电量、「成绩单」这类标题。
   只在残片里真的出现标题词时才从标题后截，避免误伤「C语言程序设计」的开头 */
function cleanNameChunk(raw) {
  let t = String(raw === null || raw === undefined ? "" : raw).trim();
  const m = t.match(/(成绩单|成绩表|成绩明细|学科成绩|学生总成绩|课程成绩|成绩统计|课程名称)/);
  if (m) t = t.slice(m.index + m[0].length);
  return t.trim();
}

/* 可作为右半开头的强名词尾词。切点后一段若以这些词开头，多半切点落在左半内部。
   「思想」「道德」「军事」这类既能收尾又能起头的词不进表，避免误杀「军事理论」 */
const STRONG_TAIL = [
  "课程", "教育", "工程", "基础", "技术", "设计", "方法", "实验", "实践", "概论",
  "导论", "原理", "理论", "代数", "几何", "物理", "化学", "英语", "体育", "法律",
  "历史", "哲学", "经济", "管理", "统计", "计算", "编程", "文学", "艺术", "音乐",
  "美术", "心理", "健康", "安全", "专题", "论文", "纲要", "简史", "通史", "党史",
  "网络", "系统", "结构", "材料", "电路", "力学", "生物", "地理", "数学", "外语",
  "综合", "创新", "创业", "视听说", "名著", "文选", "演讲", "辩论", "绘画", "摄影",
  "书法", "舞蹈", "戏剧", "实训", "实习", "讲座", "研讨", "研究", "训练", "测量",
  "制图", "技能", "素养"
];
const TAIL_WORDS = [
  "教育", "概论", "导论", "基础", "原理", "理论", "方法", "技术", "设计", "分析",
  "代数", "几何", "物理", "化学", "英语", "体育", "军训", "政策", "法治", "历史",
  "哲学", "经济", "管理", "统计", "计算", "编程", "实验", "实践", "写作", "阅读",
  "听力", "口语", "文学", "艺术", "音乐", "美术", "心理", "健康", "安全", "法律",
  "地理", "生物", "数学", "力学", "电路", "网络", "系统", "结构", "材料", "工程",
  "制图", "测量", "训练", "研究", "研讨", "讲座", "技能", "素养", "礼仪", "形势",
  "思想", "道德", "政治", "军事", "课程", "专题", "实训", "实习", "论文", "纲要",
  "史纲", "简史", "通史", "党史", "选讲", "精讲", "创新", "创业", "外语", "综合",
  "视听说", "名著", "文选", "演讲", "辩论", "绘画", "摄影", "书法", "舞蹈", "戏剧"
];

function endsWithTail(s) {
  if (!s) return false;
  for (let i = 0; i < TAIL_WORDS.length; i++) {
    const w = TAIL_WORDS[i];
    if (s.slice(-w.length) === w) return true;
  }
  /* 「…教育01」「…基础2」这类带序号的写法也算收尾 */
  if (/[0-9A-Za-z)]$/.test(s)) {
    const cut = s.replace(/[0-9A-Za-z)\]]+$/, "");
    for (let i = 0; i < TAIL_WORDS.length; i++) {
      const w = TAIL_WORDS[i];
      if (cut.slice(-w.length) === w) return true;
    }
  }
  return false;
}

/* 一个残片里粘了几门课名：能切就切，切不准就留空让用户补，绝不猜错名字 */
function splitNames(chunk, k) {
  const s = cleanNameChunk(chunk);
  if (!s) return [""];
  if (k <= 1) return [s];
  if (/\s/.test(s)) {
    const parts = s.split(/\s+/).filter(Boolean);
    if (parts.length >= k) {
      return parts.slice(0, k - 1).concat([parts.slice(k - 1).join("")]);
    }
  }
  const cuts = [];
  let m;
  const ell = /(\.{2,}|…+)/g;
  while ((m = ell.exec(s))) {
    const end = m.index + m[0].length;
    if (end < s.length) cuts.push(end);
  }
  /* 数字、字母、右括号后面接汉字，通常就是左列课程名的结束处 */
  const al = /[\dA-Za-z)\]]+(?=[\u4e00-\u9fa5（(])/g;
  while ((m = al.exec(s))) {
    const end = m.index + m[0].length;
    if (end < s.length) cuts.push(end);
  }
  const uniq = cuts.filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(function (a, b) { return a - b; });

  /* 字母数字线索不够时，改用「左半像课程名结尾」的切点；
     右半是整串末尾，课名常被省略号或括号截断，结尾词不强制匹配，长度够即可 */
  const dictCuts = [];
  for (let p = 2; p <= s.length - 2; p++) {
    const left = s.slice(0, p);
    const right = s.slice(p);
    if (right.length < 2) continue;
    /* 右半以冒号开头是课名内部副标题标点，不是两列边界 */
    if (/^[:：]/.test(right)) continue;
    const leftTail = endsWithTail(left);
    const rightStrong = STRONG_TAIL.some(function (w) { return right.slice(0, w.length) === w; });
    /* 左半收尾像课名，或右半起头像另一门课名，切点才成立 */
    if (!leftTail && !rightStrong) continue;
    /* 两字左半后面跟冒号副标题，说明右半才是完整课名，切点错了 */
    if (left.length === 2 && right.indexOf(":") >= 0) continue;
    dictCuts.push(p);
  }

  let pool = uniq.slice();
  if (pool.length < k - 1) {
    dictCuts.forEach(function (p) {
      if (pool.indexOf(p) < 0) pool.push(p);
    });
    pool.sort(function (a, b) { return a - b; });
  }
  if (!pool.length || pool.length < k - 1) return [s];
  let picked;
  if (pool.length === k - 1) {
    picked = pool;
  } else if (k === 2) {
    /* 两列时候选切点选最接近整串中点的，避免把左列课名的尾词误当边界 */
    const mid = s.length / 2;
    let best = pool[0], bd = Math.abs(pool[0] - mid);
    pool.forEach(function (p) {
      const d = Math.abs(p - mid);
      if (d < bd) { bd = d; best = p; }
    });
    picked = [best];
  } else {
    /* 候选多于列数时按位置均匀挑，靠前的那组更可能是左列 */
    picked = [];
    for (let i = 0; i < k - 1; i++) {
      picked.push(pool[Math.round((i + 1) * pool.length / k) - 1]);
    }
  }
  const parts = [];
  let prev = 0;
  picked.forEach(function (p) {
    parts.push(s.slice(prev, p).trim());
    prev = p;
  });
  parts.push(s.slice(prev).trim());
  while (parts.length < k) parts.push("");
  return parts;
}

/* 从一行里抽出全部字段片段。标签不再要求行首或空白边界，
   粘连文本按 scanTokens 的位置切分 */
function extractLine(raw) {
  const s = norm(raw);
  if (!s) return null;
  const tokens = scanTokens(s);
  const fields = [];
  const names = [];
  tokens.forEach(function (t) {
    if (t.type === "name") { names.push(t.text); return; }
    if (t.kind === "score" && t.value === null && !t.level) return;
    fields.push({ kind: t.kind, value: t.value, level: t.level || undefined });
  });
  if (!fields.length) return { fields: [], namePart: raw };
  const namePart = names.map(cleanNameChunk).filter(Boolean).join(" ").trim();
  return { fields: fields, namePart: namePart };
}

/* 明显不是课程名的行：标题、表头、纯数字、纯符号。
   标题词和课程名粘在同一段时（如「学科成绩数学分析II」），先剥掉标题前缀再判，
   不能整段删掉，否则下面这门课的名字就没了 */
function isNoiseName(s) {
  if (!s || s.length < 2) return true;
  if (/^[\d.\-+/#*%]+$/.test(s)) return true;
  const t = cleanNameChunk(s);
  if (!t) return true;
  if (/^(序号|学期|课程名称|课程名|合计|总计|平均分|备注|学生姓名|姓名|学号)/.test(t)) return true;
  return false;
}

/* 把行流切成「一批课程名 + 一批字段」，再按列数分配字段。
   列数不靠课程名个数猜，改看同一批里学分字段出现几次：
   识别结果把左右两列挤成一段时，课程名个数永远只有 1，但学分会出现 2 次 */
function buildFromLines(rawLines) {
  const groups = [];
  let cur = null;

  for (let i = 0; i < rawLines.length; i++) {
    const raw = String(rawLines[i] === null || rawLines[i] === undefined ? "" : rawLines[i]).trim();
    if (!raw) continue;
    const tokens = scanTokens(raw);
    tokens.forEach(function (t) {
      if (t.type === "name") {
        const chunk = t.text;
        if (isNoiseName(chunk)) return;
        if (!cur || cur.fields.length) {
          cur = { chunks: [], fields: [] };
          groups.push(cur);
        }
        cur.chunks.push(chunk);
        return;
      }
      if (!cur) {
        cur = { chunks: [], fields: [] };
        groups.push(cur);
      }
      cur.fields.push(t);
    });
  }

  const list = [];
  const pending = [];
  groups.forEach(function (g) {
    if (!g.fields.length) return;
    const creditN = g.fields.filter(function (f) { return f.kind === "credit"; }).length;
    const k = creditN > 0 ? creditN : Math.max(1, g.chunks.length);
    let names = splitNames(g.chunks.join(" ").trim(), k);
    while (names.length < k) names.push("");
    const cols = [];
    for (let i = 0; i < k; i++) cols.push({ credit: null, earned: null, gpa: null, score: null, level: "" });
    const seen = {};
    g.fields.forEach(function (f) {
      const idx = seen[f.kind] || 0;
      const col = cols[idx % k];
      if (f.kind === "score") {
        if (col.score === null && f.value !== null) col.score = f.value;
        if (!col.level && f.value === null) col.level = f.level || "";
      } else if (col[f.kind] === null && f.value !== null) {
        col[f.kind] = f.value;
      }
      seen[f.kind] = idx + 1;
    });
    for (let i = 0; i < k; i++) {
      const name = names[i] || "";
      const c = cols[i];
      if (c.credit === null && c.score === null && !c.level) continue;
      /* 名字空着，或整串粘得过长，都标成待核对，让用户在确认界面补 */
      const unknown = !name || name.length > 14;
      if (c.score === null) {
        pending.push({ course: name, credit: c.credit, gpa: c.gpa, level: c.level, reason: c.level ? "level" : "noscore", nameUnknown: unknown });
        continue;
      }
      list.push({ course: name, credit: c.credit, score: c.score, gpa: c.gpa, nameUnknown: unknown });
    }
  });

  return { list: list, pending: pending };
}

/* anchor 若带坐标（实机若给），取左上角与尺寸；给不出返回 null */
function anchorBox(a) {
  if (!a) return null;
  if (a.origin && a.size) {
    const ox = Number(a.origin.x);
    const oy = Number(a.origin.y);
    const w = Number(a.size.w !== undefined ? a.size.w : a.size.width);
    const h = Number(a.size.h !== undefined ? a.size.h : a.size.height);
    if (isFinite(ox) && isFinite(oy)) return { x: ox, y: oy, w: isFinite(w) ? w : 0, h: isFinite(h) ? h : 0 };
  }
  const p = a.points || a.box;
  if (p && p.length) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < p.length; i++) {
      const pt = p[i];
      if (!pt) continue;
      const x = Number(pt.x !== undefined ? pt.x : pt[0]);
      const y = Number(pt.y !== undefined ? pt.y : pt[1]);
      if (!isFinite(x) || !isFinite(y)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (minX !== Infinity && minY !== Infinity) {
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
  }
  return null;
}

/* 有坐标时按 x 切成若干列，列内按 y 排序。切不出来返回 null */
function splitByColumns(units, imgWidth) {
  if (!imgWidth || !isFinite(imgWidth)) return null;
  const boxes = units.map(function (u) { return anchorBox(u.anchor); });
  if (boxes.some(function (b) { return !b; })) return null;
  const centers = boxes.map(function (b) { return b.x + (b.w || 0) / 2; });
  const sorted = centers.slice().sort(function (a, b) { return a - b; });
  let gapAt = -1;
  let gapMax = 0;
  for (let i = 1; i < sorted.length; i++) {
    const g = sorted[i] - sorted[i - 1];
    if (g > gapMax) { gapMax = g; gapAt = i; }
  }
  if (gapAt < 0 || gapMax < imgWidth * 0.12) return null;
  const cut = (sorted[gapAt - 1] + sorted[gapAt]) / 2;
  const left = [];
  const right = [];
  units.forEach(function (u, i) {
    (centers[i] < cut ? left : right).push({ u: u, y: boxes[i].y, x: boxes[i].x });
  });
  const byY = function (a, b) { return a.y - b.y || a.x - b.x; };
  left.sort(byY);
  right.sort(byY);
  return [left.map(function (o) { return o.u; }), right.map(function (o) { return o.u; })];
}

/* 主入口
   units: [{ text, anchor }] 或裸 anchors
   opts.imgWidth/imgHeight: 输入像素尺寸，用于列切分 */
function parseAnchors(units, opts) {
  const arr = [];
  (units || []).forEach(function (u) {
    if (!u) return;
    const text = typeof u === "string" ? u : String(u.text === undefined ? "" : u.text);
    const anchor = typeof u === "string" ? null : (u.anchor || u);
    if (!text) return;
    arr.push({ text: text, anchor: anchor });
  });

  const imgW = opts && opts.imgWidth;
  const cols = splitByColumns(arr, imgW);
  if (cols) {
    const all = { list: [], pending: [] };
    [cols[0], cols[1]].forEach(function (col, ci) {
      const lines = [];
      col.forEach(function (u) {
        String(u.text).split(/\r?\n/).forEach(function (t) { lines.push(t); });
      });
      const res = buildFromLines(lines);
      res.list.forEach(function (x) { all.list.push(x); });
      res.pending.forEach(function (x) { all.pending.push(x); });
      if (!res.list.length && !res.pending.length) {
        /* 这一列没读出东西，记一笔，页面好提示 */
        all.emptyCols = (all.emptyCols || 0) + 1;
      }
    });
    all.mode = "columns";
    all.rawLines = [];
    [cols[0], cols[1]].forEach(function (col) {
      col.forEach(function (u) {
        String(u.text).split(/\r?\n/).forEach(function (t) { all.rawLines.push(t); });
      });
    });
    return all;
  }

  const lines = [];
  arr.forEach(function (u) {
    String(u.text).split(/\r?\n/).forEach(function (t) { lines.push(t); });
  });
  const res = buildFromLines(lines);
  res.mode = "linear";
  res.rawLines = lines;
  return res;
}

module.exports = {
  parseAnchors: parseAnchors,
  fieldOf: fieldOf,
  extractLine: extractLine,
  buildFromLines: buildFromLines,
  splitByColumns: splitByColumns,
  anchorBox: anchorBox,
  scanTokens: scanTokens,
  splitNames: splitNames,
  cleanNameChunk: cleanNameChunk
};
