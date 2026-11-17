/* 成绩文本解析：两种来源都收
   1) 学习通/教务的成绩卡片块：课程名 + 学分：3 + 绩点：3.2 + 最终成绩：85
   2) 行式：课程名|学分|成绩|绩点（也认中英文逗号、制表符）
   纯函数，不碰 wx API，便于 Node 单测 */

function lines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map(function (x) { return x.trim(); })
    .filter(function (x) { return !!x; });
}

function num(v) {
  const n = parseFloat(v);
  return isFinite(n) ? n : null;
}

/* 卡片块：遇到「最终成绩/总评成绩」收一条，向前找课程名、学分、绩点 */
function parseBlocks(text) {
  const out = [];
  let buf = [];
  lines(text).forEach(function (l) {
    buf.push(l);
    if (/^(最终成绩|总评成绩)[:：]/.test(l) && buf.length >= 2) {
      let name = null;
      for (let i = 0; i < buf.length; i++) {
        if (!/^(获得)?学分[:：]|^绩点[:：]|^绩点学分[:：]|^(最终成绩|总评成绩)[:：]|^成绩[:：]/.test(buf[i])) {
          name = buf[i];
          break;
        }
      }
      let credit = null;
      let gpa = null;
      let score = null;
      buf.forEach(function (x) {
        let m;
        if ((m = x.match(/^(获得)?学分[:：]\s*([\d.]+)/))) credit = num(m[2]);
        else if ((m = x.match(/^绩点[:：]\s*([\d.]+)/))) gpa = num(m[1]);
        else if ((m = x.match(/^(最终成绩|总评成绩)[:：]\s*([\d.]+)/))) score = num(m[2]);
      });
      if (name && credit !== null && score !== null) {
        out.push({ course: name, credit: credit, score: score, gpa: gpa });
      }
      buf = [];
    }
  });
  return out;
}

/* 行式：课程名|学分|成绩|绩点；跳过分隔行与表头 */
function parseLines(text) {
  const out = [];
  lines(text).forEach(function (line) {
    if (/^学期[:：]/.test(line)) return;
    if (/^(课程名称|课程|成绩单)/.test(line) && /[|,，\t]/.test(line)) return;
    const cells = line.split(/[|,，\t]/).map(function (x) { return x.trim(); });
    if (cells.length < 3) return;
    const name = cells[0];
    const credit = num(cells[1]);
    const score = num(cells[2]);
    const gpa = cells.length > 3 ? num(cells[3]) : null;
    if (!name || credit === null || score === null) return;
    out.push({ course: name, credit: credit, score: score, gpa: gpa });
  });
  return out;
}

/* 先认卡片块，再认行式；都认不出返回空数组，由页面给出示例 */
function parseAny(text) {
  const blocks = parseBlocks(text);
  if (blocks.length) return blocks;
  return parseLines(text);
}

function looksLikeGradeBlock(text) {
  return /^(最终成绩|总评成绩)[:：]/m.test(String(text || ""));
}

module.exports = {
  parseBlocks: parseBlocks,
  parseLines: parseLines,
  parseAny: parseAny,
  looksLikeGradeBlock: looksLikeGradeBlock
};
