const { courseColor, PERIODS } = require("./week");

function cleanWeeks(s) {
  const t = String(s || "").replace(/周/g, "").replace(/\s/g, "")
    .replace(/，/g, ",").replace(/、/g, ",");
  /* 没写括号的单双周也要归一成 (单)/(双)，不然第 11 周会被当成普通周次 */
  return t.replace(/(\d(?:\s*[-–~]\s*\d+)?)\s*(单|双)(?![)）])/g, function (m, a, b) {
    return a + "(" + b + ")";
  });
}

function dayFromHeader(s) {
  const wm = String(s).match(/(?:星期|周)([一二三四五六日天])/);
  if (!wm) return 0;
  return { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7 }[wm[1]];
}

function dayIndex(v) {
  const s = String(v).replace(/\s/g, "");
  const n = parseInt(s, 10);
  if (n >= 1 && n <= 7) return n;
  const keys = [["一", 1], ["二", 2], ["三", 3], ["四", 4], ["五", 5], ["六", 6], ["日", 7], ["天", 7]];
  for (let i = 0; i < keys.length; i++) {
    if (s.indexOf(keys[i][0]) > -1) return keys[i][1];
  }
  return 1;
}

/* 一个单元格里可能有多门课；每门课为：课程名 / 教师【周次】 / 教室 */
function splitCellBlocks(text) {
  const raw = String(text || "").replace(/\r/g, "").split("\n")
    .map(function (x) { return x.trim(); }).filter(Boolean);
  const blocks = [];
  let i = 0;
  while (i < raw.length) {
    const name = raw[i]; i++;
    let teacher = "", weeks = "", room = "";
    if (i < raw.length && /【/.test(raw[i])) {
      const m = raw[i].match(/^(.+?)【(.+?)】/);
      if (m) { teacher = m[1].trim(); weeks = cleanWeeks(m[2]); }
      i++;
    }
    const roomParts = [];
    while (i < raw.length) {
      const nextIsName = !/【/.test(raw[i]) && i + 1 < raw.length && /【/.test(raw[i + 1]);
      if (nextIsName) break;
      roomParts.push(raw[i]); i++;
    }
    room = roomParts.join(" ").trim();
    if (name) blocks.push({ name: name, teacher: teacher, room: room, weeks: weeks });
  }
  return blocks;
}

function splitCell(text) {
  const b = splitCellBlocks(text);
  if (b.length) return b[0];
  return { name: String(text || "").trim(), room: "", teacher: "" };
}

/* 同天同名同师同室同周次的连续节次合并成一块 */
function mergeAdjacent(list) {
  const groups = {}, order = [];
  list.forEach(function (o) {
    const key = [o.day, o.name, o.teacher, o.room, o.weeks].join("|");
    if (!groups[key]) { groups[key] = []; order.push(key); }
    groups[key].push(o);
  });
  const out = [];
  order.forEach(function (key) {
    const arr = groups[key].slice().sort(function (a, b) { return a.start - b.start; });
    let cur = null;
    arr.forEach(function (o) {
      if (cur && o.start === cur.start + cur.len) { cur.len += o.len; }
      else { cur = { name: o.name, teacher: o.teacher, room: o.room, day: o.day, start: o.start, len: o.len, weeks: o.weeks }; out.push(cur); }
    });
  });
  return out;
}

function gridToLessons(rows, hIdx) {
  const head = rows[hIdx], cols = [];
  for (let j = 0; j < head.length; j++) {
    const d = dayFromHeader(head[j]);
    if (d) cols.push({ j: j, day: d });
  }
  if (!cols.length) return [];

  const body = rows.slice(hIdx + 1).filter(function (r) {
    return r.slice(1).join("").trim();
  });
  if (!body.length) return [];

  const out = [];
  let seq = 0;
  body.forEach(function (r) {
    const firstTxt = String(r[0] == null ? "" : r[0]).trim();
    const startNo = parseInt(firstTxt, 10);
    // 备注、说明、合计这类行不是课表数据
    if (isNaN(startNo) && firstTxt) return;
    let start;
    if (isNaN(startNo)) { seq += 1; start = seq; }
    else { start = startNo; seq = startNo; }
    if (start < 1 || start > PERIODS.length) return;
    cols.forEach(function (c) {
      const cell = String(r[c.j] || "").trim();
      if (!cell) return;
      if (/^(午休|休息|无|--|—)$/.test(cell)) return;
      splitCellBlocks(cell).forEach(function (p) {
        if (!p.name) return;
        out.push({ name: p.name, teacher: p.teacher, room: p.room, day: c.day, start: start, len: 1, weeks: p.weeks });
      });
    });
  });
  return mergeAdjacent(out);
}

function tableToLessons(rows) {
  let body = rows.filter(function (r) { return r.join("").trim(); });
  if (!body.length) return [];
  if (/课程|名称|course/i.test(body[0].join(""))) body = body.slice(1);
  return body.map(function (r) {
    return {
      name: r[0], teacher: r[1] || "", room: r[2] || "",
      day: dayIndex(r[3]), start: parseInt(r[4], 10) || 1,
      len: parseInt(r[5], 10) || 2, weeks: r[6] || ""
    };
  }).filter(function (o) { return o.name; });
}

function rowsToLessons(rows) {
  let hIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    let cnt = 0;
    for (let j = 0; j < rows[i].length; j++) { if (dayFromHeader(rows[i][j])) cnt++; }
    if (cnt >= 3) { hIdx = i; break; }
  }
  if (hIdx > -1) return gridToLessons(rows, hIdx);
  return tableToLessons(rows);
}

function parseCSV(text) {
  const t = String(text).replace(/^﻿/, "");
  const sep = (t.indexOf("\t") > -1 && t.indexOf(",") === -1) ? "\t" : ",";
  const rows = t.split(/\r?\n/).map(function (line) {
    return line.split(sep).map(function (c) { return c.trim().replace(/^"|"$/g, ""); });
  }).filter(function (r) { return r.join("").trim(); });
  if (!rows.length) return [];
  const body = /课程|名称|course/i.test(rows[0].join("")) ? rows.slice(1) : rows;
  return body.map(function (r) {
    return {
      name: r[0], teacher: r[1] || "", room: r[2] || "",
      day: dayIndex(r[3]), start: parseInt(r[4], 10) || 1,
      len: parseInt(r[5], 10) || 2, weeks: r[6] || ""
    };
  }).filter(function (o) { return o.name; });
}

function parsePasted(text) {
  const t = String(text || "").trim().replace(/^```[a-zA-Z]*\s*/, "").replace(/```$/, "").trim();
  try {
    const d = JSON.parse(t);
    if (Array.isArray(d)) return d;
    if (d && Array.isArray(d.lessons)) return d.lessons;
  } catch (e) {}
  return null;
}

/* 行式课表：周一|1-2|数学分析III|张老师|7-305|1-10周
   给「把课表截图丢给 AI 转文字」这条路用，字段顺序宽松，星期和节次靠内容认 */
function parseLessonLines(text) {
  const out = [];
  String(text || "").split(/\r?\n/).forEach(function (line) {
    let raw = line.trim().replace(/^[-*·]\s*/, "");
    if (!raw || /^```/.test(raw)) return;
    if (!/[|｜]/.test(raw)) return;
    const cells = raw.split(/[|｜]/).map(function (c) {
      return c.replace(/`/g, "").trim();
    });
    let day = 0, start = 0, len = 0;
    const rest = [];
    cells.forEach(function (c) {
      if (!c) { rest.push(""); return; }
      const dm = c.match(/^(?:周|星期|礼拜)?\s*([一二三四五六日天]|\d)$/);
      if (!day && dm) {
        day = dayIndex(dm[1]);
        return;
      }
      const pm = c.match(/^(?:第\s*)?(\d{1,2})\s*(?:[-—–~至到]\s*(\d{1,2}))?\s*节?$/);
      if (!start && pm) {
        start = parseInt(pm[1], 10);
        len = pm[2] ? Math.max(1, parseInt(pm[2], 10) - start + 1) : 1;
        return;
      }
      rest.push(c);
    });
    if (!day || !start) return;
    while (rest.length && !rest[0]) rest.shift();
    const name = rest.shift() || "";
    if (!name) return;
    if (/^(课程|课表|课程名|名称)/.test(name)) return;
    /* 周次可能落在任意位置（教师或教室那格空着的时候），先挑出来 */
    let weeks = "";
    for (let i = rest.length - 1; i >= 0; i--) {
      if (/周/.test(rest[i])) {
        weeks = cleanWeeks(rest[i]);
        rest.splice(i, 1);
        break;
      }
    }
    const teacher = rest[0] || "";
    const room = rest[1] || "";
    out.push({
      name: name,
      teacher: teacher,
      room: room,
      day: day,
      start: start > 10 ? 9 : start,
      len: Math.min(len || 1, 10 - Math.min(start, 9) + 1),
      weeks: weeks
    });
  });
  return out;
}

function lessonKey(name, day, start, weeks, room) {
  return [name, day, start, String(weeks || "").replace(/\s/g, ""), String(room || "")].join("|");
}

/* 归一化为内部 lesson 结构；id 由存储层生成 */
function normalizeList(rawList) {
  return (rawList || []).filter(function (o) { return o && o.name; }).map(function (o) {
    const day = dayIndex(o.day !== undefined ? o.day : o.dayOfWeek);
    const start = parseInt(o.start !== undefined ? o.start : o.beginNumber, 10) || 1;
    const len = parseInt(o.len !== undefined ? o.len : (o.length || 2), 10) || 2;
    const name = String(o.name);
    return {
      name: name,
      teacher: o.teacher || o.teacherName || "",
      room: o.room || o.location || "",
      day: day,
      start: start,
      len: len,
      weeks: o.weeks || "",
      color: courseColor(name)
    };
  });
}

module.exports = {
  cleanWeeks: cleanWeeks,
  dayFromHeader: dayFromHeader,
  dayIndex: dayIndex,
  splitCellBlocks: splitCellBlocks,
  splitCell: splitCell,
  mergeAdjacent: mergeAdjacent,
  gridToLessons: gridToLessons,
  tableToLessons: tableToLessons,
  rowsToLessons: rowsToLessons,
  parseCSV: parseCSV,
  parsePasted: parsePasted,
  parseLessonLines: parseLessonLines,
  lessonKey: lessonKey,
  normalizeList: normalizeList
};
