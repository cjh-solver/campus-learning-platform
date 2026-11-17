/* 找空教室：把全校课表按星期、节次、周次拍平，算出此刻没课的教学楼房间
   数据源是内置的 KB 快照，纯本地计算，不发网络请求 */

const KB = require("../../data/kb-data.js");
const W = require("../../utils/week.js");

/* 教室名分两类：数字楼栋的普通教室进分组，其余算特殊场地 */
function splitRooms() {
  const teaching = [];
  const others = [];
  (KB.r || []).forEach(function (full) {
    const name = String(full || "");
    if (!name) return;
    const m = name.match(/^(\d+)-(.+)$/);
    if (m) {
      teaching.push({ b: parseInt(m[1], 10), building: m[1], room: m[2], full: name });
    } else {
      others.push(name);
    }
  });
  return { teaching: teaching, others: others };
}

/* 这一时段被占用的房间，键是完整教室名；sel 为选中节次数组，任一选中节有课即占 */
function busySet(week, day, sel) {
  const busy = {};
  const c = KB.c || {};
  Object.keys(c).forEach(function (bj) {
    (c[bj] || []).forEach(function (r) {
      if (r[3] !== day) return;
      const s = r[4], e = r[4] + r[5] - 1;
      const hit = sel.some(function (p) { return p >= s && p <= e; });
      if (!hit) return;
      if (!W.inWeek(r[6], week)) return;
      const rn = KB.r[r[2]];
      if (rn) busy[rn] = 1;
    });
  });
  return busy;
}

/* 节次描述：单节 "3"，连续 "3-4"，不连续 "3、5" */
function labelOf(sel) {
  if (sel.length === 1) return String(sel[0]);
  const continuous = sel.every(function (p, i) { return i === 0 || p === sel[i - 1] + 1; });
  if (continuous) return sel[0] + "-" + sel[sel.length - 1];
  return sel.join("、");
}

function minutesOf(hhmm) {
  const p = String(hhmm).split(":");
  return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
}

/* 当前时间落在哪一节；两节之间算下一节，晚于最后一节算最后一节 */
function nowPeriod() {
  const d = new Date();
  const mins = d.getHours() * 60 + d.getMinutes();
  for (let i = 0; i < W.PERIODS.length; i++) {
    const p = W.PERIODS[i];
    if (mins >= minutesOf(p.t) && mins <= minutesOf(p.e)) return p.n;
  }
  for (let i = 0; i < W.PERIODS.length; i++) {
    if (mins < minutesOf(W.PERIODS[i].t)) return W.PERIODS[i].n;
  }
  return W.PERIODS.length;
}

function rangeText(week) {
  const a = W.weekDate(week, 1);
  const b = W.weekDate(week, 7);
  return (a.getMonth() + 1) + "-" + a.getDate() + " 至 " + (b.getMonth() + 1) + "-" + b.getDate();
}

Page({
  data: {
    week: 1,
    day: 1,
    dayName: "周一",
    periodsSel: [],
    periodLabel: "1",
    weekRange: "",
    periodText: "",
    days: [],
    periods: [],
    groups: [],
    total: 0,
    otherCount: 0,
    gen: ""
  },

  onLoad() {
    const today = W.todayDay();
    const parts = splitRooms();
    this._teaching = parts.teaching;
    this._others = parts.others;
    const sel = [nowPeriod()];
    this.setData({
      week: W.weekOf(new Date()),
      day: today,
      dayName: W.WEEKDAYS[today - 1],
      periodsSel: sel,
      days: W.WEEKDAYS.map(function (n, i) { return { d: i + 1, name: n }; }),
      periods: W.PERIODS.map(function (p) { return { n: p.n, active: sel.indexOf(p.n) > -1 }; }),
      otherCount: parts.others.length,
      gen: KB.gen || ""
    });
    this.refresh();
  },

  /* 按当前选中节次刷新 chip 选中态 */
  syncPeriods(sel) {
    this.setData({
      periods: W.PERIODS.map(function (p) { return { n: p.n, active: sel.indexOf(p.n) > -1 }; })
    });
  },

  refresh() {
    const week = this.data.week;
    const day = this.data.day;
    const sel = this.data.periodsSel.slice().sort(function (a, b) { return a - b; });
    const busy = busySet(week, day, sel);
    const map = {};
    let total = 0;

    this._teaching.forEach(function (x) {
      if (busy[x.full]) return;
      if (!map[x.building]) map[x.building] = [];
      map[x.building].push(x.room);
      total++;
    });

    const groups = Object.keys(map)
      .map(Number)
      .sort(function (a, b) { return a - b; })
      .map(function (b) {
        const rooms = map[b].slice().sort(function (a, c) { return a.localeCompare(c, "zh"); });
        return { name: b + "栋", rooms: rooms };
      });

    const first = W.PERIODS[sel[0] - 1] || W.PERIODS[0];
    const last = W.PERIODS[sel[sel.length - 1] - 1] || W.PERIODS[0];
    this.setData({
      dayName: W.WEEKDAYS[day - 1],
      weekRange: rangeText(week),
      periodLabel: labelOf(sel),
      periodText: first.t + "–" + last.e,
      groups: groups,
      total: total
    });
  },

  onWeekStep(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const step = ds.step === "next" ? 1 : -1;
    const next = Math.max(1, Math.min(W.MAX_WEEK, this.data.week + step));
    if (next === this.data.week) return;
    this.setData({ week: next });
    this.refresh();
  },

  onPickDay(e) {
    const d = Number((e.currentTarget.dataset || {}).d) || this.data.day;
    if (d === this.data.day) return;
    this.setData({ day: d });
    this.refresh();
  },

  onPickPeriod(e) {
    const p = Number((e.currentTarget.dataset || {}).p) || 0;
    if (!p) return;
    const sel = this.data.periodsSel.slice();
    const idx = sel.indexOf(p);
    if (idx > -1) {
      if (sel.length === 1) return; /* 至少保留一节 */
      sel.splice(idx, 1);
    } else {
      sel.push(p);
    }
    sel.sort(function (a, b) { return a - b; });
    this.setData({ periodsSel: sel });
    this.syncPeriods(sel);
    this.refresh();
  },

  onNow() {
    const today = W.todayDay();
    const sel = [nowPeriod()];
    this.setData({
      week: W.weekOf(new Date()),
      day: today,
      periodsSel: sel
    });
    this.syncPeriods(sel);
    this.refresh();
  }
});
