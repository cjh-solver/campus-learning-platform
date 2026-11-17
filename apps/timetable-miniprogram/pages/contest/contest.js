const { LIST, MONTH_NAME, STATE_LABEL } = require("../../utils/contest.js");
const storage = require("../../utils/storage.js");

const DEPT_NONE = "未安排";
const DEPT_NONE_LABEL = "暂未指定院部";
const DEPT_ALL_LABEL = "全部院部";

Page({
  data: {
    level: "all",
    fadeFlip: false,
    dept: "all",
    deptLabel: DEPT_ALL_LABEL,
    depts: [],
    groups: [],
    total: 0,
    shown: 0,
    aCount: 0,
    bCount: 0,
    favs: [],
    favCount: 0,
    curMonth: 0,
    showPast: false,
    openId: 0,
    deptOpen: false,
  deptLeaving: false,
    footOpen: false
  },

  onLoad() {
    let favs = [];
    try {
      favs = storage.loadState().contestFavs || [];
    } catch (e) {
      favs = [];
    }
    this.setData({
      curMonth: new Date().getMonth() + 1,
      favs: favs,
      favCount: this.countFavs(favs)
    });
    this.buildDepts();
    this.buildView();
  },

  countFavs(favs) {
    let n = 0;
    LIST.forEach((it) => {
      if (favs.indexOf(it.id) > -1) n++;
    });
    return n;
  },

  buildDepts() {
    const count = {};
    LIST.forEach((it) => {
      count[it.dept] = (count[it.dept] || 0) + 1;
    });
    const depts = Object.keys(count).map((name) => ({
      name: name,
      label: name === DEPT_NONE ? DEPT_NONE_LABEL : name,
      n: count[name]
    }));
    this.setData({ depts: depts, total: LIST.length });
  },

  buildView() {
    const level = this.data.level;
    const dept = this.data.dept;
    const openId = this.data.openId;
    const curMonth = this.data.curMonth;
    const showPast = this.data.showPast;
    const favs = this.data.favs;

    const picked = [];
    let aCount = 0;
    let bCount = 0;
    LIST.forEach((it) => {
      if (it.level === "A") aCount++;
      else bCount++;
      if (level === "fav") {
        if (favs.indexOf(it.id) < 0) return;
      } else if (level !== "all" && it.level !== level) {
        return;
      }
      if (dept !== "all" && it.dept !== dept) return;
      picked.push({
        id: it.id,
        name: it.name,
        level: it.level,
        month: it.month,
        deptLabel: it.dept === DEPT_NONE ? DEPT_NONE_LABEL : it.dept,
        span: it.span,
        state: it.state,
        stateLabel: STATE_LABEL[it.state],
        detail: it.detail,
        note: it.note || "",
        source: it.source,
        isFav: favs.indexOf(it.id) > -1,
        open: it.id === openId
      });
    });

    /* 当前月之前的赛事默认收成一行，点开才按月铺开 */
    const past = [];
    const rest = [];
    picked.forEach((r) => {
      const isPast = curMonth > 1 && r.month >= 1 && r.month < curMonth;
      if (isPast && !showPast) past.push(r);
      else rest.push(r);
    });

    const byMonth = {};
    rest.forEach((r) => {
      if (!byMonth[r.month]) byMonth[r.month] = [];
      byMonth[r.month].push(r);
    });

    const groups = [];
    if (past.length) {
      let min = 12;
      let max = 1;
      past.forEach((r) => {
        if (r.month < min) min = r.month;
        if (r.month > max) max = r.month;
      });
      groups.push({
        month: -1,
        past: true,
        name: min === max ? (min + " 月") : (min + "—" + max + " 月"),
        n: past.length,
        cur: false,
        rows: []
      });
    }

    for (let m = 1; m <= 12; m++) {
      if (byMonth[m] && byMonth[m].length) {
        groups.push({
          month: m,
          name: MONTH_NAME[m],
          n: byMonth[m].length,
          cur: m === curMonth,
          rows: byMonth[m]
        });
      }
    }
    if (byMonth[0] && byMonth[0].length) {
      groups.push({ month: 0, name: MONTH_NAME[0], n: byMonth[0].length, cur: false, rows: byMonth[0] });
    }

    this.setData({ groups: groups, shown: picked.length, aCount: aCount, bCount: bCount });
  },

  onPickLevel(e) {
    const level = e.currentTarget.dataset.level;
    if (level === this.data.level) return;
    this.setData({ level: level, fadeFlip: !this.data.fadeFlip, openId: 0 }, () => this.buildView());
  },

  onPickDept(e) {
    const dept = e.currentTarget.dataset.dept;
    const label = dept === "all"
      ? DEPT_ALL_LABEL
      : (dept === DEPT_NONE ? DEPT_NONE_LABEL : dept);
    this.setData({ dept: dept, deptLabel: label, deptOpen: false, openId: 0 }, () => this.buildView());
  },

  onOpenDept() {
    this.setData({ deptOpen: true });
  },

  onCloseDept() {
    /* 面板先播 180ms 退场动画再卸载，连点只认第一次 */
    if (!this.data.deptOpen || this._deptTimer) return;
    this.setData({ deptLeaving: true });
    this._deptTimer = setTimeout(() => {
      this._deptTimer = null;
      this.setData({ deptOpen: false, deptLeaving: false });
    }, 200);
  },

  onTogglePast() {
    this.setData({ showPast: !this.data.showPast, openId: 0 }, () => this.buildView());
  },

  onToggleFav(e) {
    const id = Number(e.currentTarget.dataset.id);
    let favs = [];
    try {
      favs = storage.toggleContestFav(id) || [];
    } catch (err) {
      favs = this.data.favs;
    }
    this.setData({ favs: favs, favCount: this.countFavs(favs) }, () => this.buildView());
  },

  onToggleFoot() {
    this.setData({ footOpen: !this.data.footOpen });
  },

  onToggle(e) {
    const id = Number(e.currentTarget.dataset.id);
    const next = this.data.openId === id ? 0 : id;
    this.setData({ openId: next }, () => this.buildView());
  }
});
