/* 成绩视图口径：与 H5 保持一致
   - 分组按 term，缺 term 记「未分学期」
   - 加权均分 = Σ(学分×分数)/Σ学分；加权绩点 = Σ(学分×绩点)/Σ学分
   - 分数条按分数升序；绩点贡献按 credit×gpa 降序，最大值归一
   - 分数段五档，柱高按最大值归一到 148rpx */

const CATS = [
  { key: "personal", label: "个人成绩" },
  { key: "major", label: "专业考试" },
  { key: "comp", label: "综测" }
];

const FAIL_COLOR = "#E5484D";

function catLabel(key) {
  const c = CATS.find(function (x) { return x.key === key; });
  return c ? c.label : "个人成绩";
}

function catGrades(state, cat) {
  const list = (state && state.grades) || [];
  return list.filter(function (g) { return (g.cat || "personal") === cat; });
}

function g2(x) {
  if (x === null || x === undefined || !isFinite(x)) return "—";
  return (Math.round(x * 100) / 100).toFixed(2);
}

/* 按学期分组并用明细现算，避免信任存下的汇总值 */
function groups(state, cat) {
  const list = catGrades(state, cat);
  const map = {};
  const order = [];
  list.forEach(function (g) {
    const s = parseFloat(g.score);
    if (!isFinite(s)) return;
    const t = g.term || "未分学期";
    if (!map[t]) {
      map[t] = { term: t, n: 0, credit: 0, sum: 0, gps: 0, hasGpa: false, fail: 0, rows: [] };
      order.push(t);
    }
    const m = map[t];
    const c = parseFloat(g.credit);
    m.n++;
    m.rows.push(g);
    if (isFinite(c)) {
      m.credit += c;
      m.sum += c * s;
    }
    const gp = parseFloat(g.gpa);
    if (isFinite(gp) && isFinite(c)) {
      m.gps += c * gp;
      m.hasGpa = true;
    }
    if (s < 60) m.fail++;
  });

  const out = order.map(function (t) {
    const m = map[t];
    m.avg = m.credit ? m.sum / m.credit : null;
    m.gpaAvg = m.hasGpa ? m.gps / m.credit : null;
    m.creditText = g2(m.credit);
    return m;
  });

  const total = { n: 0, credit: 0, sum: 0, gps: 0, hasGpa: false, fail: 0 };
  out.forEach(function (m) {
    total.n += m.n;
    total.credit += m.credit;
    total.sum += m.sum;
    total.gps += m.gps;
    total.fail += m.fail;
    if (m.hasGpa) total.hasGpa = true;
  });
  total.avg = total.credit ? total.sum / total.credit : null;
  total.gpaAvg = total.hasGpa ? total.gps / total.credit : null;

  return { groups: out, total: total };
}

function scoreColor(s) {
  if (s < 60) return FAIL_COLOR;
  if (s < 70) return "#9CA39B";
  if (s < 80) return "#C08A1E";
  return "#2E6B57";
}

/* 各科分数条：从低到高，宽度按分数百分比，最低留 4% 以便看见 */
function scoreBars(list) {
  return list
    .map(function (g) { return { g: g, s: parseFloat(g.score) }; })
    .filter(function (x) { return isFinite(x.s); })
    .sort(function (a, b) { return a.s - b.s; })
    .map(function (x) {
      return {
        id: x.g.id,
        name: x.g.course,
        score: x.s,
        w: Math.max(4, Math.round(x.s)),
        color: scoreColor(x.s)
      };
    });
}

/* 绩点贡献：credit×gpa，降序，最大值归一 */
function gpaRows(list) {
  const rows = list
    .map(function (g) {
      const c = parseFloat(g.credit);
      const gp = parseFloat(g.gpa);
      return { g: g, v: isFinite(c) && isFinite(gp) ? c * gp : null };
    })
    .filter(function (x) { return x.v !== null; })
    .sort(function (a, b) { return b.v - a.v; });
  if (!rows.length) return [];
  const max = rows[0].v || 1;
  return rows.map(function (x) {
    return {
      id: x.g.id,
      name: x.g.course,
      value: g2(x.v),
      w: Math.max(4, Math.round(x.v / max * 100))
    };
  });
}

/* 分数段分布：五档，柱高归一到 148rpx */
function dist(list) {
  const bins = [
    { label: "<60", n: 0 },
    { label: "60-69", n: 0 },
    { label: "70-79", n: 0 },
    { label: "80-89", n: 0 },
    { label: "90+", n: 0 }
  ];
  list.forEach(function (g) {
    const s = parseFloat(g.score);
    if (!isFinite(s)) return;
    if (s < 60) bins[0].n++;
    else if (s < 70) bins[1].n++;
    else if (s < 80) bins[2].n++;
    else if (s < 90) bins[3].n++;
    else bins[4].n++;
  });
  const max = Math.max(1, Math.max.apply(null, bins.map(function (b) { return b.n; })));
  return bins.map(function (b) {
    return {
      label: b.label,
      n: b.n,
      text: b.n ? String(b.n) : "",
      h: Math.round(b.n / max * 148)
    };
  });
}

/* 当前学期：9 月到次年 1 月算第一学期，2 到 8 月算第二学期 */
function currentTerm(now) {
  const d = now || new Date();
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  if (m >= 9) return y + "-" + (y + 1) + "-1";
  if (m <= 1) return (y - 1) + "-" + y + "-1";
  return (y - 1) + "-" + y + "-2";
}

/* 学期倒序，最近的排前面 */
function termList(state) {
  const set = [];
  ((state && state.grades) || []).forEach(function (g) {
    const t = g.term || "未分学期";
    if (set.indexOf(t) === -1) set.push(t);
  });
  return set.sort(function (a, b) { return b.localeCompare(a); });
}

module.exports = {
  CATS: CATS,
  catLabel: catLabel,
  catGrades: catGrades,
  groups: groups,
  g2: g2,
  scoreColor: scoreColor,
  scoreBars: scoreBars,
  gpaRows: gpaRows,
  dist: dist,
  currentTerm: currentTerm,
  termList: termList
};
