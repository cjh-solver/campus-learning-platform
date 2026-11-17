/* 成绩单表格 → 成绩记录：按表头找列，不认死列序
   教务系统导出的成绩单列序各不相同，只认关键词：
   课程名 / 学分 / 成绩 / 绩点 / 学期 / 备注
   纯函数，不碰 wx API */

function norm(s) {
  return String(s == null ? "" : s).replace(/\s/g, "");
}

function num(v) {
  const n = parseFloat(String(v == null ? "" : v).replace(/[^\d.\-]/g, ""));
  return isFinite(n) ? n : null;
}

/* 表头最多看前 10 行，找同时有课程列和成绩列的那一行 */
function findHeader(rows) {
  const limit = Math.min(rows.length, 10);
  for (let i = 0; i < limit; i++) {
    const r = rows[i] || [];
    let courseCol = -1, scoreCol = -1, creditCol = -1, gpaCol = -1, termCol = -1, noteCol = -1;
    for (let j = 0; j < r.length; j++) {
      const h = norm(r[j]);
      if (!h || h.length > 12) continue;
      if (courseCol < 0 && /课程|科目/.test(h) && !/代码|性质|类型|属性|门数|数$/.test(h)) courseCol = j;
      if (scoreCol < 0 && /成绩|分数|总评|最终/.test(h) && !/学分|绩点/.test(h)) scoreCol = j;
      if (creditCol < 0 && /^学分$|学分$/.test(h) && !/绩点/.test(h)) creditCol = j;
      if (gpaCol < 0 && /绩点|GPA/i.test(h)) gpaCol = j;
      if (termCol < 0 && /学期|学年/.test(h)) termCol = j;
      if (noteCol < 0 && /备注|说明/.test(h)) noteCol = j;
    }
    if (courseCol > -1 && scoreCol > -1) {
      return { row: i, courseCol: courseCol, scoreCol: scoreCol, creditCol: creditCol, gpaCol: gpaCol, termCol: termCol, noteCol: noteCol };
    }
  }
  return null;
}

/* 2025-2026学年第一学期 / 2025-2026-1 / 2025-2026上 都归成 2025-2026-1 */
function normTerm(v) {
  const s = norm(v);
  if (!s) return "";
  let m = s.match(/(\d{4})\s*[-—~]\s*(\d{4})\s*[-—]?\s*([12])/);
  if (m) return m[1] + "-" + m[2] + "-" + m[3];
  m = s.match(/(\d{4})\s*[-—~]\s*(\d{4})/);
  if (m) {
    if (/第一|上|一学期|学期1/.test(s)) return m[1] + "-" + m[2] + "-1";
    if (/第二|下|二学期|学期2/.test(s)) return m[1] + "-" + m[2] + "-2";
  }
  return "";
}

function rowsToGrades(rows) {
  const h = findHeader(rows || []);
  if (!h) return [];
  const out = [];
  for (let i = h.row + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const course = String(r[h.courseCol] == null ? "" : r[h.courseCol]).trim();
    if (!course) continue;
    if (/^(合计|总计|平均|小计|备注|说明)/.test(course)) continue;
    const score = num(r[h.scoreCol]);
    /* 优秀/合格这类没有分数的先跳过，免得凑出一个假分数 */
    if (score === null) continue;
    out.push({
      course: course,
      credit: h.creditCol > -1 ? num(r[h.creditCol]) : null,
      score: score,
      gpa: h.gpaCol > -1 ? num(r[h.gpaCol]) : null,
      term: h.termCol > -1 ? normTerm(r[h.termCol]) : "",
      note: h.noteCol > -1 ? String(r[h.noteCol] == null ? "" : r[h.noteCol]).trim() : ""
    });
  }
  return out;
}

module.exports = {
  rowsToGrades: rowsToGrades,
  findHeader: findHeader,
  normTerm: normTerm
};
