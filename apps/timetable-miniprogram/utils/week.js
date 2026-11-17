const SEMESTER_START = "2026-09-07";
const MAX_WEEK = 20;

const PERIODS = [
  { n: 1, t: "08:20", e: "09:05" },
  { n: 2, t: "09:15", e: "10:00" },
  { n: 3, t: "10:20", e: "11:05" },
  { n: 4, t: "11:15", e: "12:00" },
  { n: 5, t: "14:00", e: "14:45" },
  { n: 6, t: "14:55", e: "15:40" },
  { n: 7, t: "16:00", e: "16:45" },
  { n: 8, t: "16:55", e: "17:40" },
  { n: 9, t: "19:00", e: "19:45" },
  { n: 10, t: "19:55", e: "20:40" }
];

const COLORS = ["--c1", "--c2", "--c3", "--c4", "--c5", "--c6", "--c7"];
const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function weekOf(d) {
  const st = new Date(SEMESTER_START + "T00:00:00");
  const diff = Math.floor((d - st) / 86400000);
  const w = Math.floor(diff / 7) + 1;
  return Math.max(1, Math.min(MAX_WEEK, w));
}

function weekDate(week, day) {
  const st = new Date(SEMESTER_START + "T00:00:00");
  const d = new Date(st);
  d.setDate(d.getDate() + (week - 1) * 7 + (day - 1));
  return d;
}

function todayDay() {
  const d = new Date().getDay();
  return d === 0 ? 7 : d;
}

function parityOf(s) {
  if (/[（(]\s*单\s*[)）]/.test(s) || /单周/.test(s)) return 1;
  if (/[（(]\s*双\s*[)）]/.test(s) || /双周/.test(s)) return 2;
  return 0;
}

function stripParity(s) {
  return String(s).replace(/[（(]\s*[单双]\s*[)）]/g, "").replace(/[单双]周/g, "")
    .replace(/第/g, "").replace(/[—－–]/g, "-").replace(/[~～]/g, "-");
}

/* 周次表达式："1-15(单)"、"1-3,5-9,11-15(单)"、"3,5,7"、"1-16" */
function inWeek(weeksStr, week) {
  if (!weeksStr) return true;
  const t = String(weeksStr).replace(/\s/g, "").replace(/，/g, ",").replace(/、/g, ",");
  if (!t) return true;
  const globalParity = parityOf(t);
  const odd = week % 2 === 1;
  const parts = t.split(",");
  for (let i = 0; i < parts.length; i++) {
    const raw = parts[i];
    if (!raw) continue;
    const parity = parityOf(raw) || globalParity;
    if (parity === 1 && !odd) continue;
    if (parity === 2 && odd) continue;
    const seg = stripParity(raw);
    if (!seg) continue;
    const m = seg.match(/^(\d+)-(\d+)/);
    if (m) {
      if (week >= parseInt(m[1], 10) && week <= parseInt(m[2], 10)) return true;
      continue;
    }
    if (/^\d+$/.test(seg) && parseInt(seg, 10) === week) return true;
  }
  return false;
}

function courseColor(name) {
  let h = 0;
  const s = String(name || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 7;
  return h;
}

module.exports = {
  SEMESTER_START: SEMESTER_START,
  MAX_WEEK: MAX_WEEK,
  PERIODS: PERIODS,
  COLORS: COLORS,
  WEEKDAYS: WEEKDAYS,
  weekOf: weekOf,
  weekDate: weekDate,
  todayDay: todayDay,
  inWeek: inWeek,
  courseColor: courseColor
};
