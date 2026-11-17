const STORAGE_KEY = "ct-state-v1";
const cd = require("./countdown.js");
const pomo = require("./pomodoro.js");

function defaultState() {
  return {
    bound: false,
    mode: "local",
    uuid: "",
    proxy: "",
    completed: [],
    extra: [],
    noticeClosed: false,
    my: [],
    hidden: [],
    exams: [],
    grades: [],
    gradeCat: "personal",
    weekend: true,
    weekendSet: false,
    seeded: false,
    moreOrder: [],
    exceptions: [],
    contestFavs: [],
    countdown: cd.DEFAULT_ITEMS.map(function (x) { return Object.assign({}, x); }),
    pomo: { date: "", count: 0, focusSec: 0 }
  };
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function normalize(d) {
  const s = Object.assign(defaultState(), d || {});
  s.completed = asArray(s.completed);
  s.extra = asArray(s.extra);
  s.my = asArray(s.my);
  s.hidden = asArray(s.hidden);
  s.exams = asArray(s.exams);
  s.grades = asArray(s.grades);
  s.moreOrder = asArray(s.moreOrder);
  s.exceptions = asArray(s.exceptions);
  s.contestFavs = asArray(s.contestFavs).map(Number).filter(function (n) { return isFinite(n) && n > 0; });
  s.countdown = asArray(s.countdown).filter(function (x) {
    return x && typeof x.id === "string" && typeof x.title === "string";
  }).map(function (x) {
    return {
      id: x.id,
      title: x.title,
      date: typeof x.date === "string" ? x.date : "",
      selected: Number(x.selected) || 0,
      note: typeof x.note === "string" ? x.note : "",
      fixed: !!x.fixed
    };
  });
  if (!s.gradeCat) s.gradeCat = "personal";

  /* 周末列默认展开；用户手动收起过才会记住，没点过就按默认走 */
  s.weekendSet = !!s.weekendSet;
  if (!s.weekendSet) s.weekend = true;

  /* 番茄统计按天清零；结构缺字段或跨天都回到今日空统计 */
  const today = pomo.todayKey();
  if (!s.pomo || typeof s.pomo !== "object" || s.pomo.date !== today) {
    s.pomo = { date: today, count: 0, focusSec: 0 };
  } else {
    s.pomo.count = Math.max(0, Number(s.pomo.count) || 0);
    s.pomo.focusSec = Math.max(0, Number(s.pomo.focusSec) || 0);
  }

  s.grades.forEach(function (g) {
    if (!g.cat) g.cat = "personal";
  });

  /* 首次打开不带任何演示数据，课表就是空表，由课表页引导用户导入 */
  if (!s.seeded) s.seeded = true;

  return s;
}

function loadState() {
  let raw = {};
  try {
    raw = wx.getStorageSync(STORAGE_KEY) || {};
  } catch (e) {
    raw = {};
  }
  const s = normalize(raw);
  if (!raw.seeded) {
    /* 首次打开写入虚构演示数据，让各页面都有内容可看；清空后回到空态 */
    try {
      const demo = require("../data/demo-state.js");
      Object.assign(s, demo());
    } catch (e) {}
    try {
      wx.setStorageSync(STORAGE_KEY, s);
    } catch (e) {}
  }
  return s;
}

/* 写失败不能静默：配额满或存储异常时给用户一条明确的补救路径 */
function saveState(state) {
  try {
    wx.setStorageSync(STORAGE_KEY, state);
    return true;
  } catch (e) {
    try {
      wx.showModal({
        title: "保存失败",
        content: "本机存储写不进去了，可能是空间满了。先到「我的」清空一部分数据，或重启小程序再试。",
        showCancel: false
      });
    } catch (e2) {}
    console.error("[storage] save failed", e);
    return false;
  }
}

function updateState(patch) {
  const next = Object.assign({}, loadState(), patch || {});
  saveState(next);
  return next;
}

function resetState() {
  const empty = normalize({ my: [], seeded: true });
  saveState(empty);
  return empty;
}

function genId(prefix) {
  return prefix + Date.now() + Math.floor(Math.random() * 9999);
}

/* 文件导入：整包替换本机课程，旧记录与隐藏标记一并清掉 */
function replaceLessons(list) {
  const state = loadState();
  state.my = (list || []).map(function (o) {
    return Object.assign({ id: genId("m") }, o);
  });
  state.hidden = [];
  saveState(state);
  return state.my.length;
}

/* 新增或更新单门课程；带 id 走更新，否则追加 */
function upsertLesson(o) {
  const state = loadState();
  if (o.id) {
    const idx = state.my.findIndex(function (l) { return l.id === o.id; });
    if (idx > -1) {
      state.my[idx] = Object.assign({}, state.my[idx], o);
      saveState(state);
      return state.my[idx];
    }
  }
  const rec = Object.assign({ id: genId("m") }, o);
  state.my.push(rec);
  saveState(state);
  return rec;
}

function removeLesson(id) {
  const state = loadState();
  state.my = state.my.filter(function (l) { return l.id !== id; });
  state.hidden = state.hidden.filter(function (x) { return x !== id; });
  state.exceptions = state.exceptions.filter(function (x) { return x.lessonId !== id; });
  saveState(state);
}

function hideLesson(id) {
  const state = loadState();
  if (state.hidden.indexOf(id) === -1) state.hidden.push(id);
  saveState(state);
}

function unhideLesson(id) {
  const state = loadState();
  state.hidden = state.hidden.filter(function (x) { return x !== id; });
  saveState(state);
}

/* 作业：带 id 走更新，否则追加；标题或课程改了视为新记录不覆盖 id */
function upsertHw(o) {
  const state = loadState();
  if (o.id) {
    const idx = state.extra.findIndex(function (h) { return h.id === o.id; });
    if (idx > -1) {
      state.extra[idx] = Object.assign({}, state.extra[idx], o);
      saveState(state);
      return state.extra[idx];
    }
  }
  const rec = Object.assign({ id: genId("h") }, o);
  state.extra.push(rec);
  saveState(state);
  return rec;
}

function removeHw(id) {
  const state = loadState();
  state.extra = state.extra.filter(function (h) { return h.id !== id; });
  state.completed = state.completed.filter(function (x) { return x !== id; });
  saveState(state);
}

/* 返回切换后的完成状态 */
function toggleHwDone(id) {
  const state = loadState();
  const i = state.completed.indexOf(id);
  if (i > -1) state.completed.splice(i, 1);
  else state.completed.push(id);
  saveState(state);
  return state.completed.indexOf(id) > -1;
}

function upsertExam(o) {
  const state = loadState();
  if (o.id) {
    const idx = state.exams.findIndex(function (e) { return e.id === o.id; });
    if (idx > -1) {
      state.exams[idx] = Object.assign({}, state.exams[idx], o);
      saveState(state);
      return state.exams[idx];
    }
  }
  const rec = Object.assign({ id: genId("e") }, o);
  state.exams.push(rec);
  saveState(state);
  return rec;
}

function removeExam(id) {
  const state = loadState();
  state.exams = state.exams.filter(function (e) { return e.id !== id; });
  saveState(state);
}

/* 批量录入考试：按「课程 + 截止时间」本机去重，跳过已存在记录 */
function mergeExams(list) {
  const state = loadState();
  const exist = {};
  state.exams.forEach(function (e) {
    exist[(e.course || "") + "|" + (e.date || "")] = 1;
  });
  let added = 0;
  (list || []).forEach(function (x) {
    if (!x || !x.course) return;
    const k = (x.course || "") + "|" + (x.date || "");
    if (exist[k]) return;
    exist[k] = 1;
    state.exams.push(Object.assign({ id: genId("e") }, x));
    added++;
  });
  saveState(state);
  return added;
}

/* 批量录入作业：按「课程+标题」本机去重，跳过已存在记录 */
function mergeHws(list) {
  const state = loadState();
  const exist = {};
  state.extra.forEach(function (h) {
    exist[(h.course || "") + "|" + (h.title || "")] = 1;
  });
  let added = 0;
  (list || []).forEach(function (h) {
    if (!h.title) return;
    const k = (h.course || "") + "|" + h.title;
    if (exist[k]) return;
    exist[k] = 1;
    state.extra.push(Object.assign({ id: genId("h") }, h));
    added++;
  });
  saveState(state);
  return added;
}

/* 成绩：去重键「分类 + 学期 + 课程名」，同名课不同学期各算一条 */
function gradeKey(g) {
  return (g.cat || "personal") + "|" + (g.term || "未分学期") + "|" + (g.course || "");
}

/* 批量入库；返回 {added, skipped} 便于页面区分「加了 N 门」与「都录过了」 */
function addGrades(list, opts) {
  const state = loadState();
  const cat = (opts && opts.cat) || "personal";
  const term = (opts && opts.term) || "未分学期";
  const exist = {};
  state.grades.forEach(function (g) { exist[gradeKey(g)] = 1; });
  let added = 0;
  let skipped = 0;
  (list || []).forEach(function (o) {
    if (!o || !o.course) return;
    const rec = {
      id: genId("g"),
      cat: cat,
      course: String(o.course).trim(),
      credit: o.credit === null || o.credit === undefined || o.credit === "" ? null : Number(o.credit),
      score: Number(o.score),
      gpa: o.gpa === null || o.gpa === undefined || o.gpa === "" ? null : Number(o.gpa),
      term: (o.term && String(o.term).trim()) || term,
      note: o.note || ""
    };
    if (!isFinite(rec.score)) return;
    if (rec.credit !== null && !isFinite(rec.credit)) rec.credit = null;
    if (rec.gpa !== null && !isFinite(rec.gpa)) rec.gpa = null;
    const k = gradeKey(rec);
    if (exist[k]) {
      skipped++;
      return;
    }
    exist[k] = 1;
    state.grades.push(rec);
    added++;
  });
  saveState(state);
  return { added: added, skipped: skipped };
}

/* 单条新增或更新；带 id 走更新，否则按去重键判断是否重复 */
function upsertGrade(o) {
  const state = loadState();
  if (o.id) {
    const idx = state.grades.findIndex(function (g) { return g.id === o.id; });
    if (idx > -1) {
      state.grades[idx] = Object.assign({}, state.grades[idx], o);
      saveState(state);
      return { rec: state.grades[idx], added: false };
    }
  }
  const rec = Object.assign({ id: genId("g"), cat: "personal" }, o);
  const k = gradeKey(rec);
  const dup = state.grades.some(function (g) { return gradeKey(g) === k; });
  if (dup) return { rec: null, added: false };
  state.grades.push(rec);
  saveState(state);
  return { rec: rec, added: true };
}

function removeGrade(id) {
  const state = loadState();
  state.grades = state.grades.filter(function (g) { return g.id !== id; });
  saveState(state);
}

function setGradeCat(cat) {
  const state = loadState();
  state.gradeCat = cat || "personal";
  saveState(state);
}

/* 更多页功能格顺序：存功能 id 数组，ghost 格不参与 */
function setMoreOrder(order) {
  const state = loadState();
  state.moreOrder = (order || []).filter(function (x) { return typeof x === "string"; });
  saveState(state);
}

/* 竞赛关注：存赛事 id，切换后返回最新列表 */
function toggleContestFav(id) {
  const state = loadState();
  const n = Number(id);
  if (!isFinite(n)) return asArray(state.contestFavs);
  const idx = state.contestFavs.indexOf(n);
  if (idx > -1) state.contestFavs.splice(idx, 1);
  else state.contestFavs.push(n);
  saveState(state);
  return state.contestFavs.slice();
}

/* ---- 倒计时：内置卡片改场次，期末卡自增改删 ---- */

function setCountdownOption(id, selected) {
  const state = loadState();
  state.countdown.forEach(function (x) {
    if (x.id === id) x.selected = Math.max(0, Number(selected) || 0);
  });
  saveState(state);
  return state.countdown;
}

function setCountdownDate(id, date) {
  const state = loadState();
  state.countdown.forEach(function (x) {
    if (x.id === id) x.date = typeof date === "string" ? date : "";
  });
  saveState(state);
  return state.countdown;
}

function addCountdownItem(title) {
  const state = loadState();
  const rec = {
    id: genId("cd"),
    title: (title || "期末").slice(0, 12),
    date: "",
    selected: 0,
    fixed: false
  };
  state.countdown.push(rec);
  saveState(state);
  return rec;
}

function setCountdownNote(id, note) {
  const state = loadState();
  state.countdown.forEach(function (x) {
    if (x.id === id) x.note = typeof note === "string" ? note.slice(0, 60) : "";
  });
  saveState(state);
  return state.countdown;
}

function removeCountdownItem(id) {
  const state = loadState();
  state.countdown = state.countdown.filter(function (x) {
    return x.id !== id || x.fixed;
  });
  saveState(state);
  return state.countdown;
}

/* ---- 番茄钟：今日完成数与专注秒数，跨天自动清零 ---- */

function recordPomo(focusSec) {
  const state = loadState();
  const today = pomo.todayKey();
  if (!state.pomo || state.pomo.date !== today) {
    state.pomo = { date: today, count: 0, focusSec: 0 };
  }
  state.pomo.count += 1;
  state.pomo.focusSec += Math.max(0, Number(focusSec) || 0);
  saveState(state);
  return state.pomo;
}

function getPomo() {
  const state = loadState();
  const today = pomo.todayKey();
  if (!state.pomo || state.pomo.date !== today) {
    return { date: today, count: 0, focusSec: 0 };
  }
  return {
    date: today,
    count: Math.max(0, Number(state.pomo.count) || 0),
    focusSec: Math.max(0, Number(state.pomo.focusSec) || 0)
  };
}

/* ---- 单周例外：cancel 停课 / move 调课 / add 临时加课，独立于常规课程 ---- */

function exNum(v) {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

function upsertException(o) {
  const state = loadState();
  if (o.id) {
    const idx = state.exceptions.findIndex(function (x) { return x.id === o.id; });
    if (idx > -1) {
      state.exceptions[idx] = Object.assign({}, state.exceptions[idx], o);
      saveState(state);
      return state.exceptions[idx];
    }
  }
  const rec = Object.assign({ id: genId("x"), orphan: false, lessonId: "", scope: "student", clsFull: "" }, o);
  state.exceptions.push(rec);
  saveState(state);
  return rec;
}

function removeException(id) {
  const state = loadState();
  state.exceptions = state.exceptions.filter(function (x) { return x.id !== id; });
  saveState(state);
}

function removeExceptionsForLesson(lessonId) {
  const state = loadState();
  state.exceptions = state.exceptions.filter(function (x) {
    if ((x.scope || "student") !== "student") return true;
    return x.lessonId !== lessonId;
  });
  saveState(state);
}

/* 导入新课表后按课程名 + 原位置快照重关联；命中换 id，未命中保留并标 orphan，不静默删除 */
function rematchExceptions(lessons) {
  const state = loadState();
  const list = lessons || state.my;
  let matched = 0;
  let orphan = 0;
  state.exceptions.forEach(function (ex) {
    if ((ex.scope || "student") === "teacher") return;
    if (ex.kind === "add") { ex.orphan = false; return; }
    if (!ex.srcName) { ex.orphan = true; orphan++; return; }
    const hit = list.find(function (l) {
      return String(l.name || "").trim() === String(ex.srcName || "").trim()
        && exNum(l.day) === exNum(ex.fromDay)
        && exNum(l.start) === exNum(ex.fromStart);
    });
    if (hit) { ex.lessonId = hit.id; ex.orphan = false; matched++; }
    else { ex.orphan = true; orphan++; }
  });
  saveState(state);
  return { matched: matched, orphan: orphan };
}

module.exports = {
  STORAGE_KEY: STORAGE_KEY,
  defaultState: defaultState,
  loadState: loadState,
  saveState: saveState,
  updateState: updateState,
  resetState: resetState,
  replaceLessons: replaceLessons,
  upsertLesson: upsertLesson,
  removeLesson: removeLesson,
  hideLesson: hideLesson,
  unhideLesson: unhideLesson,
  upsertHw: upsertHw,
  removeHw: removeHw,
  toggleHwDone: toggleHwDone,
  mergeHws: mergeHws,
  upsertExam: upsertExam,
  removeExam: removeExam,
  mergeExams: mergeExams,
  addGrades: addGrades,
  upsertGrade: upsertGrade,
  removeGrade: removeGrade,
  setGradeCat: setGradeCat,
  setMoreOrder: setMoreOrder,
  toggleContestFav: toggleContestFav,
  setCountdownOption: setCountdownOption,
  setCountdownDate: setCountdownDate,
  addCountdownItem: addCountdownItem,
  setCountdownNote: setCountdownNote,
  removeCountdownItem: removeCountdownItem,
  recordPomo: recordPomo,
  getPomo: getPomo,
  upsertException: upsertException,
  removeException: removeException,
  removeExceptionsForLesson: removeExceptionsForLesson,
  rematchExceptions: rematchExceptions
};
