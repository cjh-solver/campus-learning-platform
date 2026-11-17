const storage = require("../../utils/storage");
const week = require("../../utils/week");
const parse = require("../../utils/parse-lesson");
const fileLesson = require("../../utils/file-lesson");
const feedback = require("../../utils/feedback");
const KB = require("../../data/kb-data.js");

const ROW_H = 84;
const CN_DAY = ["一", "二", "三", "四", "五", "六", "日"];
/* 老师列表里固定排第一的那个名字 */
const TEACHER_PIN = "王雨思";

/* 让外部 AI 把课表截图转成固定行格式，粘回来就能导入 */
const PASTE_PROMPT = "这是我的课表截图。请逐门提取，严格按每行一门输出，格式为：周一|1-2|课程名|教师|教室|1-10周。星期写周一到周日，节次写起止两节，周次写成 1-10周 或 1-4,6-10周。没有的信息留空，竖线照留。只输出这些行，不要解释、不要表格、不要 Markdown、不要编号。";

/* 课都是成对的节次：1-2、3-4、5-6、7-8、9-10，或者连上两对（1-4、5-8） */
const START_OPTIONS = ["第 1-2 节", "第 3-4 节", "第 5-6 节", "第 7-8 节", "第 9-10 节"];
const LEN_2 = ["2 节"];
const LEN_4 = ["2 节", "4 节"];
const WEEK_OPTIONS = [];
for (let wi = 1; wi <= week.MAX_WEEK; wi++) WEEK_OPTIONS.push("第 " + wi + " 周");

/* 落在双数节就归到这一对的起始节 */
function snapStart(n) {
  const v = num(n, 1);
  if (v >= 9) return 9;
  return v % 2 === 0 ? v - 1 : v;
}

/* 存储里若混入旧格式（字符串色值、字符串节次），先转成数字再计算，避免整页渲染失败 */
function num(v, fallback) {
  const n = Number(v);
  return isFinite(n) ? n : (fallback === undefined ? 0 : fallback);
}

/* "08:20" 转成当日分钟数，用于比对当前落在哪一节 */
function toMin(s) {
  const p = String(s || "").split(":");
  return num(p[0], 0) * 60 + num(p[1], 0);
}

/* 老师态课块不在本机课表里，靠课程名+位置+班级快照匹配例外记录 */
function snapKey(name, day, start, len, clsFull) {
  return [String(name || "").trim(), num(day), num(start), num(len), String(clsFull || "").trim()].join("|");
}

/* 课程名在五列布局里一行最多放五个汉字，超了就在语义处断，别让浏览器按字数硬切 */
function splitHalf(t) {
  const half = Math.ceil(t.length / 2);
  /* 断点落在开引号开括号前面时往前挪一格，别让「留在上一行末尾 */
  const OPEN = "「『（《“【";
  const cut = half > 2 && OPEN.indexOf(t.charAt(half - 1)) >= 0 ? half - 1 : half;
  return t.slice(0, cut) + "\n" + t.slice(cut);
}

function breakName(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (s.length <= 5) return s;

  const a = s.search(/[A-Za-z0-9]/);
  if (a === 0) {
    /* 开头就是英文，切在英文段结束处；剩下的中文超过五个字再对半劈一次 */
    const head = s.match(/[A-Za-z0-9 ]+/);
    const cut = head ? head[0].length : 0;
    if (cut > 0 && cut < s.length) {
      const rest = s.slice(cut).trim();
      return s.slice(0, cut) + "\n" + (rest.length > 5 ? splitHalf(rest) : rest);
    }
  } else if (a > 0) {
    /* 中文打头再跟英文，切在英文之前：大学英语A3 → 大学英语 / A3 */
    return s.slice(0, a) + "\n" + s.slice(a);
  }

  const m = s.match(/^(.{2,6}?(?:与|和|及))(.+)$/);
  if (m && m[2].length >= 2) {
    return m[1] + "\n" + (m[2].length > 5 ? splitHalf(m[2]) : m[2]);
  }
  return splitHalf(s);
}

/* 快照里班级就是一串班名，转成弹层里能点的行 */
function classList(names) {
  return (names || []).map(function (n) {
    return { name: n, count: 0, kind: "class" };
  });
}

function monthDay(d) {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return m + "." + (day < 10 ? "0" + day : day);
}

Page({
  data: {
    viewWeek: 0,
    isThisWeek: true,
    days: 5,
    weekend: true,
    farWeek: false,
    todayDay: 1,
    monthLabel: "",
    weekRange: "",
    heads: [],
    periods: week.PERIODS,
    blocks: [],
    panes: [],
    trackX: 0,
    trackAnim: "",
    paneW: 0,
    lessonCount: 0,
    weekdays: week.WEEKDAYS,
    startOptions: START_OPTIONS,
    lenOptions: LEN_4,
    sheetKind: "",
  sheetLeaving: false,
    actionLesson: null,
    formSlot: "",
    pasteText: "",
    pasteList: [],
    pastePrompt: PASTE_PROMPT,
    form: { id: "", name: "", teacher: "", room: "", day: 1, start: 1, len: 2, weeks: "", oneWeek: false },
    weekOptions: WEEK_OPTIONS,
    excForm: {
      lessonId: "", srcName: "", srcTeacher: "", srcRoom: "",
      fromWeek: 1, fromDay: 1, fromStart: 1, fromLen: 2,
      toWeek: 1, toDay: 1, toStart: 1, toLen: 2, room: ""
    },

    /* 班级课表选完直接落成本机课表，这里只留来源和弹层状态 */
    heroMain: "",
    heroSub: "",
    kbNote: "",
    /* student 按班级查，teacher 按老师姓名查 */
    role: "student",
    /* 老师态选中的那位，空串表示还没选 */
    tvName: "",
    /* 当前视图该不该画网格：学生态看有没课，老师态看有没选人 */
    hasGrid: false,
    /* 当前正在上的节次号，0 表示不在任何一节课内；仅本周视图有效 */
    currentPeriod: 0,
    todayIsView: false,
    teacherQuery: "",
    teacherList: [],
    teacherMore: 0,
    teacherTotal: 0,
    kbHeight: 0,
    pickStep: "",
    pickTitle: "",
    pickList: [],
    pickColIdx: -1,
    pickMajorIdx: -1
  },

  onLoad() {
    this.refresh();
    /* 弹层是固定在底部的，键盘弹起不会自动把它顶上去；监听键盘高度手动抬 */
    this._onKbHeight = (e) => {
      this.setData({ kbHeight: (e && Number(e.height)) || 0 });
    };
    if (typeof wx.onKeyboardHeightChange === "function") {
      wx.onKeyboardHeightChange(this._onKbHeight);
    }
  },

  onUnload() {
    if (this._settleTimer) {
      clearTimeout(this._settleTimer);
      this._settleTimer = null;
    }
    if (typeof wx.offKeyboardHeightChange === "function" && this._onKbHeight) {
      wx.offKeyboardHeightChange(this._onKbHeight);
    }
  },

  /* 首屏渲染完成后实测轨道宽度，替换 rpx 估算值，落定位置不偏 */
  onReady() {
    wx.createSelectorQuery().select(".track").boundingClientRect((rect) => {
      if (rect && rect.width > 0) {
        this._paneW = rect.width;
        this.setData({ paneW: rect.width, trackX: 0 });
      }
    }).exec();
  },

  onShow() {
    this.refresh();
    this.consumeMaterial();
  },

  /* 从聊天文件「用课表随行打开」进来自动接住这份表格 */
  consumeMaterial() {
    const app = getApp();
    const m = app && app.globalData ? app.globalData.fileOpen : null;
    if (!m || !m.path) return;
    app.globalData.fileOpen = null;
    wx.showModal({
      title: "导入这份课表",
      content: "识别到「" + m.name + "」，导入后替换当前 " + this.data.lessonCount + " 门课",
      confirmText: "导入",
      success: (r) => {
        if (!r.confirm) {
          feedback.tip("没导入，课表没变");
          return;
        }
        this.importPath(m.path, m.name);
      },
      fail: () => feedback.tip("再试一次，或从课表页手动导入")
    });
  },

  refresh() {
    try {
      this.render();
    } catch (e) {
      feedback.report(e, "刷新课表");
    }
  },

  render() {
    const state = storage.loadState();
    const curWeek = week.weekOf(new Date());
    const viewWeek = this.data.viewWeek || curWeek;
    /* 周末列默认带上，用户在存储里手动收起过才会变 5 天 */
    const weekend = !!state.weekend;
    const days = weekend ? 7 : 5;
    /* 翻到离本周三周以外，给一个一步回来的入口 */
    const farWeek = Math.abs(viewWeek - curWeek) >= 3;
    const hidden = state.hidden || [];

    const role = this.data.role === "teacher" ? "teacher" : "student";
    const tvName = String(this.data.tvName || "");
    /* 学生态例外只作用本机课表；老师态例外是本机备注，按老师名圈定 */
    const allExc = state.exceptions || [];
    const exceptions = role === "teacher"
      ? allExc.filter(function (x) { return x.scope === "teacher" && (x.srcTeacher || "") === tvName; })
      : allExc.filter(function (x) { return (x.scope || "student") === "student"; });
    const self = this;

    /* 按周派生表头与课程块；前/中/后三屏各调一次，跟手翻页时邻周已在屏侧就位 */
    function buildWeek(wk) {
      const heads = [];
      for (let i = 1; i <= days; i++) {
        const d = week.weekDate(wk, i);
        const dd = d.getDate();
        heads.push({
          day: i,
          date: dd < 10 ? "0" + dd : String(dd),
          label: week.WEEKDAYS[i - 1],
          today: curWeek === wk && i === week.todayDay()
        });
      }

      const suppressedId = {};
      const suppressedSnap = {};
      exceptions.forEach(function (ex) {
        if ((ex.kind !== "cancel" && ex.kind !== "move") || num(ex.fromWeek) !== wk) return;
        if ((ex.scope || "student") === "teacher") {
          suppressedSnap[snapKey(ex.srcName, ex.fromDay, ex.fromStart, ex.fromLen, ex.clsFull)] = 1;
        } else if (ex.lessonId) {
          suppressedId[ex.lessonId] = 1;
        }
      });

      let shown;
      if (role === "teacher") {
        /* 老师的课是别人的课，只在内存里算，不写本机课表 */
        shown = tvName
          ? self.teacherLessons(tvName).filter(function (l) {
            if (num(l.day) > days || !week.inWeek(l.weeks, wk)) return false;
            return suppressedSnap[snapKey(l.name, l.day, l.start, l.len, l.clsFull)] !== 1;
          })
          : [];
      } else {
        shown = state.my
          .filter(function (l) { return l && typeof l === "object"; })
          .filter(function (l) { return hidden.indexOf(l.id) === -1; })
          .filter(function (l) { return suppressedId[l.id] !== 1; })
          .filter(function (l) {
            return num(l.day) <= days && week.inWeek(l.weeks, wk);
          });
      }

    /* 例外目标块：调课落到本周的部分、本周临时加课；占位：本周停课原位 */
    const exTargets = [];
    const exPlaceholders = [];
    exceptions.forEach(function (ex) {
      if (ex.kind === "cancel" && num(ex.fromWeek) === wk) {
        exPlaceholders.push({
          ex: ex,
          name: String(ex.srcName || "课程"),
          day: num(ex.fromDay, 1),
          start: Math.min(Math.max(num(ex.fromStart, 1), 1), week.PERIODS.length),
          len: Math.min(Math.max(num(ex.fromLen, 1), 1), week.PERIODS.length)
        });
        return;
      }
      if (ex.kind === "add" && num(ex.toWeek) === wk) {
        exTargets.push({
          ex: ex,
          name: String(ex.name || "临时加课"),
          teacher: String(ex.teacher || ""),
          room: String(ex.room || ""),
          clsFull: String(ex.clsFull || ""),
          day: num(ex.toDay, 1),
          start: Math.min(Math.max(num(ex.toStart, 1), 1), week.PERIODS.length),
          len: Math.min(Math.max(num(ex.toLen, 1), 1), week.PERIODS.length)
        });
        return;
      }
      if (ex.kind === "move" && num(ex.toWeek) === wk) {
        exTargets.push({
          ex: ex,
          name: String(ex.srcName || "调课"),
          teacher: String(ex.srcTeacher || ""),
          room: String(ex.room || ex.srcRoom || ""),
          clsFull: String(ex.clsFull || ""),
          day: num(ex.toDay, 1),
          start: Math.min(Math.max(num(ex.toStart, 1), 1), week.PERIODS.length),
          len: Math.min(Math.max(num(ex.toLen, 1), 1), week.PERIODS.length)
        });
      }
    });

    /* 同一门课在多天出现时必须同色，否则一屏出现两个绿两个橙，看着就是乱 */
    const colorMap = {};
    let colorSeq = 0;
    shown.concat(exTargets).forEach(function (l) {
      const nm = String(l.name || "未命名课程");
      if (colorMap[nm] === undefined) {
        colorMap[nm] = colorSeq % 7;
        colorSeq += 1;
      }
    });

    /* 班级课表里不同周次的课会压在同一格，按同格数量横向劈开，谁也别盖住谁 */
    const slotTotal = {};
    const slotSeq = {};
    shown.concat(exTargets).forEach(function (l) {
      const k = num(l.day, 1) + "|" + num(l.start, 1);
      slotTotal[k] = (slotTotal[k] || 0) + 1;
    });

    function buildBlock(l, opts) {
      opts = opts || {};
      const name0 = String(l.name || "未命名课程");
      const colorIdx = colorMap[name0] === undefined ? 0 : colorMap[name0];
      const day = num(l.day, 1);
      const start = Math.min(Math.max(num(l.start, 1), 1), week.PERIODS.length);
      const len = Math.min(Math.max(num(l.len, 1), 1), week.PERIODS.length - start + 1);
      const rawRoom = String(l.room || "");
      const teacher = String(l.teacher || "");
      const roomShort = rawRoom.length > 8
        ? (rawRoom.split(/[（(]/)[0].trim() || rawRoom)
        : rawRoom;
      const withRoom = rawRoom ? (/^[（(]/.test(rawRoom) ? rawRoom : "(" + rawRoom + ")") : "";
      const text = name0 + withRoom + teacher;
      const slotKey = day + "|" + start;
      const colTotal = slotTotal[slotKey] || 1;
      const colIdx = slotSeq[slotKey] || 0;
      slotSeq[slotKey] = colIdx + 1;
      const cellW = 100 / days;
      return {
        id: opts.id || l.id,
        name: name0,
        teacher: l.teacher,
        room: l.room,
        day: day,
        start: start,
        len: len,
        weeks: l.weeks || "",
        color: week.COLORS[colorIdx],
        text: text,
        nameText: breakName(name0),
        roomText: roomShort,
        teacherText: role === "teacher" ? String(l.clsText || l.clsFull || "") : teacher,
        clsFull: String(l.clsFull || ""),
        dense: text.length > 22 || colTotal > 1,
        clamp: len * 6,
        left: (((day - 1) / days * 100) + colIdx * (cellW / colTotal)).toFixed(4),
        w: (cellW / colTotal).toFixed(4),
        top: (start - 1) * ROW_H,
        height: len * ROW_H,
        exKind: opts.exKind || "",
        exId: opts.exId || ""
      };
    }

    const blocks = shown
      .filter(function (l) { return num(l.day, 1) <= days; })
      .map(function (l) { return buildBlock(l, {}); });

    exTargets.forEach(function (t) {
      if (t.day > days) return;
      blocks.push(buildBlock(t, {
        id: "x|" + t.ex.id,
        exKind: t.ex.kind,
        exId: t.ex.id
      }));
    });

    exPlaceholders.forEach(function (p) {
      if (p.day > days) return;
      const cellW = 100 / days;
      blocks.push({
        id: "xp|" + p.ex.id,
        name: p.name,
        teacher: "",
        room: "",
        day: p.day,
        start: p.start,
        len: p.len,
        weeks: "",
        color: "",
        text: "本周停课",
        nameText: "本周停课",
        roomText: "",
        teacherText: "",
        clsFull: "",
        dense: false,
        clamp: p.len * 6,
        left: (((p.day - 1) / days * 100)).toFixed(4),
        w: cellW.toFixed(4),
        top: (p.start - 1) * ROW_H,
        height: p.len * ROW_H,
        exKind: "cancel",
        exId: p.ex.id
      });
    });

      return { heads: heads, blocks: blocks };
    }

    const cur = buildWeek(viewWeek);
    const prevW = viewWeek - 1;
    const nextW = viewWeek + 1;
    const emptyPane = { week: 0, heads: [], blocks: [] };
    const prevPane = prevW >= 1 ? Object.assign({ week: prevW }, buildWeek(prevW)) : emptyPane;
    const nextPane = nextW <= week.MAX_WEEK ? Object.assign({ week: nextW }, buildWeek(nextW)) : emptyPane;
    const panes = [prevPane, Object.assign({ week: viewWeek }, cur), nextPane];

    const firstDay = week.weekDate(viewWeek, 1);
    const range = monthDay(firstDay) + " – " + monthDay(week.weekDate(viewWeek, days));
    const clsCount = role === "teacher" && tvName ? this.teacherClassCount(tvName) : 0;
    const teacherCount = role === "teacher" && tvName ? self.teacherLessons(tvName).length : 0;

    const todayIsView = curWeek === viewWeek;
    let currentPeriod = 0;
    if (todayIsView) {
      const now = new Date();
      const nm = now.getHours() * 60 + now.getMinutes();
      for (let i = 0; i < week.PERIODS.length; i++) {
        const pd = week.PERIODS[i];
        if (nm >= toMin(pd.t) && nm <= toMin(pd.e)) { currentPeriod = pd.n; break; }
      }
    }

    const paneW = this._measurePane();

    this.setData({
      viewWeek: viewWeek,
      isThisWeek: todayIsView,
      todayIsView: todayIsView,
      currentPeriod: currentPeriod,
      days: days,
      weekend: weekend,
      farWeek: farWeek,
      heroMain: "2026–2027 · 第 " + viewWeek + " 周",
      heroSub: range,
      kbNote: role === "teacher"
        ? (tvName ? (tvName + " · 带 " + clsCount + " 个班 · 数据截至 " + KB.gen + "，调课以教务为准") : "")
        : (state.kbFrom ? ("来自 " + state.kbFrom + " · 数据截至 " + ((KB.g && KB.g[state.kbFrom]) || KB.gen) + "，调课以教务为准") : ""),
      todayDay: week.todayDay(),
      monthLabel: (firstDay.getMonth() + 1) + "月",
      weekRange: range,
      heads: cur.heads,
      blocks: cur.blocks,
      panes: panes,
      paneW: paneW,
      trackX: 0,
      trackAnim: "",
      lessonCount: role === "teacher" ? teacherCount : state.my.length,
      hasGrid: role === "teacher" ? !!tvName : state.my.length > 0
    });
  },

  /* 内置快照的一行：[课程,教师,教室,星期,起始节,节数,周次]，转成跟本机课表同构 */
  kbLessons(bj) {
    const rows = (KB.c && KB.c[bj]) || [];
    const out = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r) continue;
      out.push({
        name: KB.n[r[0]] || "未命名课程",
        teacher: KB.t[r[1]] || "",
        room: KB.r[r[2]] || "",
        day: r[3],
        start: r[4],
        len: r[5],
        weeks: r[6]
      });
    }
    return out;
  },

  /* 反查：把快照里的班按老师归堆，同一时段被多个班共用的只留一条
     一次算完挂实例上，切周切日不再重算 */
  teacherIndex() {
    if (this._tIndex) return this._tIndex;
    const idx = {};
    const classes = Object.keys(KB.c || {});
    for (let ci = 0; ci < classes.length; ci++) {
      const bj = classes[ci];
      const rows = KB.c[bj] || [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (!r) continue;
        const tn = KB.t[r[1]] || "";
        if (!tn) continue;
        if (!idx[tn]) idx[tn] = { rows: [], classes: [] };
        const bucket = idx[tn];
        if (bucket.classes.indexOf(bj) === -1) bucket.classes.push(bj);
        const key = [r[0], r[2], r[3], r[4], r[5], r[6]].join("|");
        let hit = null;
        for (let k = 0; k < bucket.rows.length; k++) {
          if (bucket.rows[k]._k === key) { hit = bucket.rows[k]; break; }
        }
        if (!hit) {
          hit = {
            _k: key,
            name: KB.n[r[0]] || "未命名课程",
            room: KB.r[r[2]] || "",
            day: r[3],
            start: r[4],
            len: r[5],
            weeks: r[6],
            cls: []
          };
          bucket.rows.push(hit);
        }
        if (hit.cls.indexOf(bj) === -1) hit.cls.push(bj);
      }
    }
    this._tIndex = idx;
    return idx;
  },

  teacherLessons(name) {
    const idx = this.teacherIndex();
    const b = idx[name];
    if (!b) return [];
    return b.rows.map(function (o, i) {
      const clsFull = o.cls.join("、");
      return {
        id: "t|" + name + "|" + i,
        name: o.name,
        teacher: name,
        room: o.room,
        day: o.day,
        start: o.start,
        len: o.len,
        weeks: o.weeks,
        clsFull: clsFull,
        clsText: o.cls.length > 1 ? (o.cls[0] + " 等" + o.cls.length + "班") : o.cls[0]
      };
    });
  },

  teacherClassCount(name) {
    const idx = this.teacherIndex();
    return idx[name] ? idx[name].classes.length : 0;
  },

  onPrev() {
    if (this.data.viewWeek > 1) {
      this.setData({ viewWeek: this.data.viewWeek - 1 });
      this.refresh();
    }
  },

  onNext() {
    if (this.data.viewWeek < week.MAX_WEEK) {
      this.setData({ viewWeek: this.data.viewWeek + 1 });
      this.refresh();
    }
  },

  /* 量出一屏宽度（px）：窗口宽减去页面左右内边距，再减左侧固定节次列 */
  _measurePane() {
    if (this._paneW) return this._paneW;
    try {
      const info = wx.getSystemInfoSync();
      const w = info.windowWidth || 375;
      this._paneW = w - (24 + 68) / 750 * w;
    } catch (e) {
      this._paneW = 300;
    }
    return this._paneW;
  },

  /* 跟手翻周：记起点横纵与时间，跟手阶段关掉过渡，位置由手指直接带 */
  onTouchStart(e) {
    const t = e.touches && e.touches[0];
    if (!t) return;
    /* 上一轮落定动画还没播完就再次触摸：取消待落定，按当前位置接管 */
    if (this._settleTimer) {
      clearTimeout(this._settleTimer);
      this._settleTimer = null;
    }
    this._animating = false;
    this._tx = t.clientX;
    this._ty = t.clientY;
    this._tt = Date.now();
    this._dir = "";
    this._moved = false;
    this._baseX = typeof this.data.trackX === "number" ? this.data.trackX : 0;
    this.setData({ trackAnim: "" });
  },

  onTouchMove(e) {
    if (this._animating || this._tx === undefined) return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    const dx = t.clientX - this._tx;
    const dy = t.clientY - this._ty;
    if (!this._dir) {
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) { this._dir = "v"; return; }
      if (Math.abs(dx) > 10) this._dir = "h";
    }
    if (this._dir !== "h") return;
    this._moved = true;

    const paneW = this._paneW;
    const canPrev = this.data.viewWeek > 1;
    const canNext = this.data.viewWeek < week.MAX_WEEK;
    let d = dx;
    /* 首尾周边界：再往外拖给阻尼，不拉出空白屏 */
    if ((!canPrev && d > 0) || (!canNext && d < 0)) d = d * 0.35;
    let x = this._baseX + d;
    if (x > paneW) x = paneW;
    if (x < -paneW) x = -paneW;
    this.setData({ trackX: x });
  },

  onTouchEnd(e) {
    if (this._animating || this._tx === undefined) return;
    const t = e.changedTouches && e.changedTouches[0];
    const dx = t ? t.clientX - this._tx : 0;
    const dt = Date.now() - this._tt || 1;
    const velocity = dx / dt;
    const paneW = this._paneW;
    const canPrev = this.data.viewWeek > 1;
    const canNext = this.data.viewWeek < week.MAX_WEEK;

    const wantPrev = canPrev && dx > 0 && (dx > paneW * 0.25 || velocity > 0.35);
    const wantNext = canNext && dx < 0 && (-dx > paneW * 0.25 || velocity < -0.35);

    let targetWeek = 0;
    let settleX = 0;
    if (wantPrev) { targetWeek = this.data.viewWeek - 1; settleX = paneW; }
    else if (wantNext) { targetWeek = this.data.viewWeek + 1; settleX = -paneW; }

    this._animating = true;
    this.setData({ trackAnim: "transform 0.22s cubic-bezier(0.22, 1, 0.36, 1)", trackX: settleX });

    this._settleTimer = setTimeout(() => {
      this._settleTimer = null;
      if (targetWeek) {
        this.setData({ viewWeek: targetWeek });
        this.refresh();
      }
      /* 三屏已按新周重排，关过渡把轨道复位到居中，避免可见回跳 */
      this.setData({ trackAnim: "", trackX: 0 });
      this._animating = false;
      this._moved = false;
      this._tx = undefined;
    }, 230);
  },

  onToggleWeekend() {
    /* 点过一次就记住，之后不再按默认走 */
    const next = !this.data.weekend;
    storage.updateState({ weekend: next, weekendSet: true });
    this.refresh();
    feedback.tip(next ? "已显示周末" : "已收起周末");
  },

  /* 翻到远处看别的周时，一步回到本周 */
  onBackCur() {
    const w = week.weekOf(new Date());
    if (this.data.viewWeek === w) return;
    this.setData({ viewWeek: w });
    this.refresh();
    feedback.tip("回到第 " + w + " 周");
  },

  onImport() {
    this.backToOwn();
    try {
      this.pickAndImport();
    } catch (e) {
      feedback.report(e, "打开文件选择");
    }
  },

  /* 导入和粘贴都是动自己的课表，老师态下先切回学生态，否则导完看不见结果 */
  backToOwn() {
    if (this.data.role !== "teacher") return;
    this.setData({ role: "student" });
    this.refresh();
  },

  /* ---- 身份切换：学生按班级，老师按姓名 ---- */
  onRoleSwitch(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const next = ds.role === "teacher" ? "teacher" : "student";
    if (this.data.role === next) return;
    this.setData({ role: next });
    this.refresh();
  },

  /* 底栏主键：学生态选班级，老师态找老师 */
  onMainAction() {
    if (this.data.role === "teacher") {
      this.onOpenTeacherPick();
      return;
    }
    this.onOpenClassPick();
  },

  /* 底栏次键：不分身份，都是导自己的教务文件 */
  onSubAction() {
    this.onImport();
  },

  /* ---- 老师面板：姓名搜索 + 列表 ---- */
  onOpenTeacherPick() {
    if (!this._tAll) {
      const all = [];
      const seen = {};
      (KB.t || []).forEach(function (n) {
        if (n && !seen[n]) { seen[n] = 1; all.push(n); }
      });
      all.sort(function (a, b) { return a.localeCompare(b, "zh"); });
      /* 常用老师置顶：只提这一个人，其余顺序原样不动 */
      const pin = all.indexOf(TEACHER_PIN);
      if (pin > -1) {
        all.splice(pin, 1);
        all.unshift(TEACHER_PIN);
      }
      this._tAll = all;
    }
    const first = this._tAll.slice(0, 60);
    this.setData({
      sheetKind: "teacher",
      teacherQuery: "",
      teacherList: first,
      teacherMore: Math.max(0, this._tAll.length - 60),
      teacherTotal: this._tAll.length,
      kbHeight: 0
    });
  },

  onTeacherQuery(e) {
    const q = String((e && e.detail && e.detail.value) || "").trim();
    const all = this._tAll || [];
    const hit = q ? all.filter(function (n) { return n.indexOf(q) > -1; }) : all;
    this.setData({
      teacherQuery: q,
      teacherList: hit.slice(0, 60),
      teacherMore: Math.max(0, hit.length - 60),
      teacherTotal: hit.length
    });
  },

  onPickTeacher(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const name = String(ds.name || "");
    if (!name) return;
    const n = this.teacherClassCount(name);
    this.setData({ sheetKind: "", tvName: name });
    this.refresh();
    feedback.tip(name + " · 带 " + n + " 个班");
  },

  /* ---- 选班级：学院 → 专业 → 班级，选完直接落成本机课表 ---- */
  onOpenClassPick() {
    const last = wx.getStorageSync("classkb-last");
    let colIdx = -1;
    let majorIdx = -1;
    if (last) {
      KB.cols.forEach(function (c, ci) {
        c.majors.forEach(function (m, mi) {
          if (m.classes.indexOf(last) > -1) {
            colIdx = ci;
            majorIdx = mi;
          }
        });
      });
    }
    /* 上次选过的班直接摊开列出来，省得又从学院开始点三级 */
    if (colIdx > -1) {
      const m = KB.cols[colIdx].majors[majorIdx];
      this.setData({
        sheetKind: "class",
        pickStep: "class",
        pickTitle: m.name,
        pickColIdx: colIdx,
        pickMajorIdx: majorIdx,
        pickList: classList(m.classes)
      });
      return;
    }
    this.setData({
      sheetKind: "class",
      pickStep: "col",
      pickTitle: "选个学院",
      pickColIdx: -1,
      pickMajorIdx: -1,
      pickList: this.colList()
    });
  },

  colList() {
    return KB.cols.map(function (c) {
      let n = 0;
      c.majors.forEach(function (m) { n += m.classes.length; });
      return { name: c.name, count: n, kind: "col" };
    });
  },

  majorList(colIdx) {
    const c = KB.cols[colIdx];
    return c.majors.map(function (m) {
      return { name: m.name, count: m.classes.length, kind: "major" };
    });
  },

  onPickItem(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const i = num(ds.i, -1);
    const item = (this.data.pickList || [])[i];
    if (!item) return;

    if (item.kind === "col") {
      this.setData({
        pickStep: "major",
        pickTitle: item.name,
        pickColIdx: i,
        pickMajorIdx: -1,
        pickList: this.majorList(i)
      });
      return;
    }

    if (item.kind === "major") {
      const m = KB.cols[this.data.pickColIdx].majors[i];
      this.setData({
        pickStep: "class",
        pickTitle: m.name,
        pickMajorIdx: i,
        pickList: classList(m.classes)
      });
      return;
    }

    /* 选到班了：直接把这一班的排课落成本机课表，之后就是自己的课表 */
    this.applyClass(item.name);
  },

  applyClass(bj) {
    const lessons = this.kbLessons(bj);
    if (!lessons.length) {
      feedback.tip("这个班在库里没有排课记录");
      return;
    }
    const cur = storage.loadState().my.length;
    const me = this;
    wx.showModal({
      title: bj + "的课表",
      content: cur
        ? ("会替换你现在 " + cur + " 门课。导进来就当成你的课表用，之后点空格能加课，点课程能改教室。")
        : "导进来就当成你的课表用，之后点空格能加课，点课程能改教室。",
      confirmText: "用这份",
      cancelText: "再看看",
      success: function (r) {
        if (!r.confirm) return;
        storage.replaceLessons(lessons);
        storage.rematchExceptions();
        storage.updateState({ kbFrom: bj });
        wx.setStorageSync("classkb-last", bj);
        me.setData({ sheetKind: "", pickStep: "" });
        feedback.haptic("medium");
        me.refresh();
        feedback.ok("已换成 " + bj + " 的课表");
      },
      fail: function () {
        feedback.tip("没换成，课表还是原来那份");
      }
    });
  },

  onPickBack() {
    const step = this.data.pickStep;
    if (step === "class" && this.data.pickColIdx > -1) {
      const c = KB.cols[this.data.pickColIdx];
      this.setData({
        pickStep: "major",
        pickTitle: c.name,
        pickMajorIdx: -1,
        pickList: this.majorList(this.data.pickColIdx)
      });
      return;
    }
    if (step === "major" && this.data.pickColIdx > -1) {
      this.setData({
        pickStep: "col",
        pickTitle: "选个学院",
        pickColIdx: -1,
        pickMajorIdx: -1,
        pickList: this.colList()
      });
      return;
    }
    this.setData({ sheetKind: "", pickStep: "" });
  },

  pickAndImport() {
    wx.chooseMessageFile({
      count: 1,
      type: "file",
      extension: ["xls", "xlsx", "csv", "txt", "docx", "html"],
      success: (res) => {
        const f = (res.tempFiles || [])[0];
        if (!f) {
          feedback.fail("没拿到文件", "重新点一次「导入文件」，选好文件后再确认。");
          return;
        }
        this.importPath(f.path, f.name);
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || "";
        if (msg.indexOf("cancel") > -1) return;
        wx.showModal({
          title: "打开文件选择失败",
          content: msg || "换个入口再试：先把文件发到「文件传输助手」，再从聊天里选",
          showCancel: false
        });
      }
    });
  },

  /* 解析并整包替换课表；聊天选文件和「打开方式」进来的都走这里 */
  importPath(path, fileName) {
    if (this._importing) return;
    this._importing = true;
    wx.showLoading({ title: "正在解析", mask: true });
    fileLesson.importFromFile(path, fileName, (err, list) => {
      this._importing = false;
      wx.hideLoading();
      if (err) {
        const msg = err.code === "READ"
          ? "这个文件读不了。重新选一次；真机上先把文件发到「文件传输助手」，再从聊天里选。"
          : err.code === "TYPE"
            ? "只支持 xls / xlsx / csv / docx，别把表格改了后缀；老版 .doc 另存成 .docx 再发。"
            : err.code === "PDF"
              ? "这份 PDF 里没有文字，整页是画出来的图形，读不出表格。要 Excel 或 Word 原文件；只有 PDF 的话，用电脑上的 WPS「PDF 转 Excel」开着 OCR 转一份再发。"
              : err.code === "LIB"
                ? "解析组件没起来。删掉小程序重进一次；还不行就是这版包有问题，把这句话截图给开发者。"
                : "文件读到了，但没认出课程行。确认是教务系统导出的原表，不要自己另存成别的格式。";
        feedback.fail("导入失败", msg);
        return;
      }
      if (!list || !list.length) {
        feedback.fail("导入失败", "表格读到了，但没匹配到课程行。确认是教务导出的原文件，表头带「星期」「节次」。");
        return;
      }
      wx.showModal({
        title: "导入课表",
        content: `将覆盖当前 ${this.data.lessonCount} 门课，导入 ${list.length} 门`,
        confirmText: "覆盖导入",
        success: (r) => {
          if (!r.confirm) {
            feedback.tip("已取消，课表没变");
            return;
          }
          try {
            const n = storage.replaceLessons(list);
            storage.rematchExceptions();
            /* 自己导的表，不再挂着某个班的来源 */
            storage.updateState({ kbFrom: "" });
            this.setData({ viewWeek: week.weekOf(new Date()) });
            this.refresh();
            feedback.ok(`导入 ${n} 门课`);
          } catch (e) {
            feedback.report(e, "导入课表");
          }
        },
        fail: (m) => {
          feedback.fail("确认框没弹出来", (m && m.errMsg) || "再点一次导入");
        }
      });
    });
  },

  onLessonTap(e) {
    if (this._moved) return;
    const id = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.id : "";
    const b = (this.data.blocks || []).find(function (x) { return x.id === id; });
    if (!b) return;
    /* 例外块：停课占位 / 调课 / 临时加课，点开只能撤销 */
    if (b.exKind) {
      this.setData({ sheetKind: "exView", actionLesson: b });
      return;
    }
    this.setData({ sheetKind: "action", actionLesson: b });
  },

  /* 点空格：按那一对的起始节起一门新课，星期和起始节已填好 */
  onCellTap(e) {
    if (this._moved) return;
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const day = parseInt(ds.day, 10) || 1;
    const start = snapStart(ds.start);
    const asTeacher = this.data.role === "teacher";
    this.setData({
      sheetKind: "form",
      actionLesson: null,
      lenOptions: start >= 9 ? LEN_2 : LEN_4,
      formSlot: "周" + CN_DAY[day - 1] + " 第" + start + "节起",
      form: {
        id: "",
        name: "",
        teacher: "",
        room: "",
        day: day,
        start: start,
        len: 2,
        weeks: "",
        oneWeek: asTeacher
      }
    });
  },

  onCloseSheet() {
    /* 先播 180ms 退场动画再卸载面板，期间再点不会重复关闭 */
    if (!this.data.sheetKind || this._sheetTimer) return;
    this.setData({ sheetLeaving: true });
    this._sheetTimer = setTimeout(() => {
      this._sheetTimer = null;
      this.setData({ sheetKind: "", sheetLeaving: false, actionLesson: null, kbHeight: 0 });
    }, 200);
  },

  onEditFromAction() {
    const b = this.data.actionLesson;
    if (!b) {
      feedback.fail("没选中课程", "先点一下课表里的课程块，再点编辑。");
      return;
    }
    /* 导入的真实课表里也有 1 节、3 节的课，编辑时先归到成对的节次上 */
    const start = snapStart(num(b.start, 1));
    const len = start >= 9 ? 2 : (num(b.len, 2) >= 4 ? 4 : 2);
    this.setData({
      sheetKind: "form",
      lenOptions: start >= 9 ? LEN_2 : LEN_4,
      formSlot: "周" + CN_DAY[num(b.day, 1) - 1] + " 第" + start + "节起",
      form: {
        id: b.id,
        name: b.name,
        teacher: b.teacher || "",
        room: b.room || "",
        day: num(b.day, 1),
        start: start,
        len: len,
        weeks: b.weeks || ""
      }
    });
  },

  onHideFromAction() {
    const b = this.data.actionLesson;
    if (!b) return;
    try {
      storage.hideLesson(b.id);
      this.onCloseSheet();
      this.refresh();
      feedback.ok("已隐藏，可在我的页恢复");
    } catch (e) {
      feedback.report(e, "隐藏课程");
    }
  },

  onDeleteFromAction() {
    const b = this.data.actionLesson;
    if (!b) return;
    wx.showModal({
      title: "确认删除",
      content: `「${b.name}」删掉后不再出现在课表里，不能撤销。`,
      confirmText: "删除",
      confirmColor: "#E5484D",
      success: (r) => {
        if (!r.confirm) {
          feedback.tip("没删");
          return;
        }
        try {
          storage.removeLesson(b.id);
          this.onCloseSheet();
          this.refresh();
          feedback.ok("删掉了");
        } catch (e) {
          feedback.report(e, "删除课程");
        }
      },
      fail: () => feedback.fail("确认框没弹出来", "再点一次课程块重试")
    });
  },

  /* 目标位置是否已被常规课或其他例外占用；返回占用课程名，没冲突返回 null */
  findSlotConflict(weekNum, day, start, len, excludeExId) {
    const state = storage.loadState();
    const role = this.data.role === "teacher" ? "teacher" : "student";
    const s = num(start, 1);
    const e = s + num(len, 1) - 1;
    const overlaps = function (ls, le) { return s <= le && ls <= e; };
    let hit;
    if (role === "teacher") {
      const tv = String(this.data.tvName || "");
      hit = this.teacherLessons(tv).find(function (l) {
        if (num(l.day, 1) !== day || !week.inWeek(l.weeks, weekNum)) return false;
        const ls = num(l.start, 1);
        return overlaps(ls, ls + num(l.len, 1) - 1);
      });
    } else {
      hit = (state.my || []).find(function (l) {
        if (num(l.day, 1) !== day) return false;
        if (!week.inWeek(l.weeks, weekNum)) return false;
        const ls = num(l.start, 1);
        const le = ls + num(l.len, 1) - 1;
        return overlaps(ls, le);
      });
    }
    if (hit) return String(hit.name || "已有课程");
    const hitEx = (state.exceptions || []).find(function (x) {
      if (x.id === excludeExId || x.kind === "cancel") return false;
      if (role === "teacher") {
        if (x.scope !== "teacher" || (x.srcTeacher || "") !== this.data.tvName) return false;
      } else if ((x.scope || "student") !== "student") {
        return false;
      }
      if (num(x.toWeek, 0) !== weekNum) return false;
      if (num(x.toDay, 1) !== day) return false;
      const xs = num(x.toStart, 1);
      const xe = xs + num(x.toLen, 1) - 1;
      return overlaps(xs, xe);
    }, this);
    if (hitEx) return String(hitEx.srcName || hitEx.name || "已有课程");
    return null;
  },

  /* 本周停课：只压当前查看周，不动常规课程 */
  onCancelFromAction() {
    const b = this.data.actionLesson;
    if (!b) return;
    const viewWeek = this.data.viewWeek;
    const role = this.data.role === "teacher" ? "teacher" : "student";
    const state = storage.loadState();
    const snap = snapKey(b.name, b.day, b.start, b.len, b.clsFull);
    const dup = (state.exceptions || []).some(function (x) {
      if (x.kind !== "cancel" || num(x.fromWeek) !== viewWeek) return false;
      if (role === "teacher") {
        return snapKey(x.srcName, x.fromDay, x.fromStart, x.fromLen, x.clsFull) === snap;
      }
      return x.lessonId === b.id;
    });
    if (dup) { feedback.tip("这一周已经停过了"); return; }
    storage.upsertException({
      kind: "cancel",
      scope: role,
      lessonId: role === "teacher" ? "" : b.id,
      srcName: b.name,
      srcTeacher: role === "teacher" ? String(this.data.tvName || "") : (b.teacher || ""),
      srcRoom: b.room || "",
      clsFull: b.clsFull || "",
      fromWeek: viewWeek,
      fromDay: b.day,
      fromStart: b.start,
      fromLen: b.len
    });
    this.onCloseSheet();
    this.refresh();
    feedback.ok("已标记本周停课");
  },

  /* 选调课：弹层里选目标周、星期、节次、教室 */
  onMoveFromAction() {
    const b = this.data.actionLesson;
    if (!b) return;
    const viewWeek = this.data.viewWeek;
    const role = this.data.role === "teacher" ? "teacher" : "student";
    this.setData({
      sheetKind: "excMove",
      lenOptions: b.start >= 9 ? LEN_2 : LEN_4,
      excForm: {
        scope: role,
        lessonId: role === "teacher" ? "" : b.id,
        srcName: b.name,
        srcTeacher: role === "teacher" ? String(this.data.tvName || "") : (b.teacher || ""),
        srcRoom: b.room || "",
        clsFull: b.clsFull || "",
        fromWeek: viewWeek,
        fromDay: b.day,
        fromStart: b.start,
        fromLen: b.len,
        toWeek: viewWeek,
        toDay: b.day,
        toStart: b.start,
        toLen: b.len,
        room: b.room || ""
      }
    });
  },

  onExcWeekChange(e) {
    this.setData({ "excForm.toWeek": parseInt(e.detail.value, 10) + 1 });
  },

  onExcDayChange(e) {
    this.setData({ "excForm.toDay": parseInt(e.detail.value, 10) + 1 });
  },

  onExcStartChange(e) {
    const start = parseInt(e.detail.value, 10) * 2 + 1;
    const lenOptions = start >= 9 ? LEN_2 : LEN_4;
    const len = start >= 9 ? 2 : this.data.excForm.toLen;
    this.setData({ "excForm.toStart": start, "excForm.toLen": len, lenOptions: lenOptions });
  },

  onExcLenChange(e) {
    this.setData({ "excForm.toLen": (parseInt(e.detail.value, 10) + 1) * 2 });
  },

  onExcRoomInput(e) {
    this.setData({ "excForm.room": e.detail.value });
  },

  onSaveExcMove() {
    const f = this.data.excForm;
    if (f.toStart % 2 === 0 || f.toStart < 1 || f.toStart > 9) {
      feedback.fail("节次要成对", "手动安排按 1-2、3-4 这样成对排，起始节选单数节。");
      return;
    }
    if (f.toLen !== 2 && f.toLen !== 4) {
      feedback.fail("节次要成对", "一次占两节，连堂可以选四节。");
      return;
    }
    if (f.toStart + f.toLen - 1 > 10) {
      feedback.fail("节次超出范围", "第 9 节起只剩两节，四节连堂放到第 7 节或更早。");
      return;
    }
    const sameSlot = f.toWeek === f.fromWeek && f.toDay === f.fromDay
      && f.toStart === f.fromStart && f.toLen === f.fromLen;
    if (sameSlot) { feedback.tip("位置没改动"); return; }
    const conflict = this.findSlotConflict(f.toWeek, f.toDay, f.toStart, f.toLen, "");
    if (conflict) {
      feedback.fail("这个位置已有课", "换个星期或节次，别和「" + conflict + "」撞上。");
      return;
    }
    storage.upsertException({
      kind: "move",
      scope: f.scope || "student",
      lessonId: f.scope === "teacher" ? "" : f.lessonId,
      srcName: f.srcName,
      srcTeacher: f.srcTeacher,
      srcRoom: f.srcRoom,
      clsFull: f.clsFull || "",
      fromWeek: f.fromWeek,
      fromDay: f.fromDay,
      fromStart: f.fromStart,
      fromLen: f.fromLen,
      toWeek: f.toWeek,
      toDay: f.toDay,
      toStart: f.toStart,
      toLen: f.toLen,
      room: (f.room || "").trim()
    });
    this.onCloseSheet();
    this.refresh();
    feedback.ok("已调好课");
  },

  /* 撤销一条停课 / 调课 / 加课 */
  onUndoException() {
    const b = this.data.actionLesson;
    if (!b || !b.exId) return;
    const tip = b.exKind === "cancel"
      ? "恢复这一周的「" + b.name + "」？"
      : "撤掉这条" + (b.exKind === "add" ? "临时加课" : "调课") + "安排？";
    wx.showModal({
      title: "撤销这条安排",
      content: tip,
      confirmText: "撤销",
      success: (r) => {
        if (!r.confirm) { feedback.tip("没撤"); return; }
        storage.removeException(b.exId);
        this.onCloseSheet();
        this.refresh();
        feedback.ok("已撤销");
      },
      fail: () => feedback.fail("确认框没弹出来", "再点一次试试")
    });
  },

  onAddLesson() {
    this.setData({
      sheetKind: "form",
      actionLesson: null,
      lenOptions: LEN_4,
      formSlot: "周一 第1节起",
      form: { id: "", name: "", teacher: "", room: "", day: 1, start: 1, len: 2, weeks: "", oneWeek: false }
    });
  },

  /* ---- 没有文件：粘贴文字或 AI 转出来的行 ---- */
  onOpenPaste() {
    this.backToOwn();
    this.setData({ sheetKind: "paste", pasteText: "", pasteList: [] });
  },

  onPasteInput(e) {
    this.setData({ pasteText: e.detail.value });
  },

  onPasteFromClipboard() {
    wx.getClipboardData({
      success: (r) => {
        const text = r.data || "";
        if (!text.trim()) {
          feedback.tip("剪贴板是空的");
          return;
        }
        this.setData({ pasteText: text });
        feedback.ok("已贴上，点「认一下」");
      },
      fail: () => feedback.fail("读不到剪贴板", "长按输入框手动粘贴也行")
    });
  },

  onCopyPrompt() {
    wx.setClipboardData({
      data: PASTE_PROMPT,
      success: () => feedback.tip("复制好了，连截图一起发给 AI"),
      fail: () => feedback.fail("复制失败", "长按下面那段文字手动全选复制")
    });
  },

  onParsePaste() {
    const raw = String(this.data.pasteText || "").trim();
    if (!raw) {
      feedback.tip("先把课表文字粘进来");
      return;
    }
    let list = [];
    try {
      list = parse.normalizeList(parse.parseLessonLines(raw) || parse.parsePasted(raw) || []);
    } catch (e) {
      feedback.report(e, "识别粘贴的课表");
      return;
    }
    if (!list.length) {
      feedback.fail(
        "这几行没认出来",
        "每行要是「周一|1-2|课程名|教师|教室|1-10周」这种。先把提示词复制给 AI，让它按格式转一遍再粘回来。"
      );
      return;
    }
    this.setData({ pasteList: list });
  },

  onSavePaste() {
    const list = this.data.pasteList || [];
    if (!list.length) {
      feedback.tip("先点「认一下」");
      return;
    }
    wx.showModal({
      title: "导入课表",
      content: "将覆盖当前 " + this.data.lessonCount + " 门课，导入 " + list.length + " 门",
      confirmText: "覆盖导入",
      success: (r) => {
        if (!r.confirm) {
          feedback.tip("已取消，课表没变");
          return;
        }
        try {
          const n = storage.replaceLessons(list);
          storage.rematchExceptions();
          storage.updateState({ kbFrom: "" });
          this.setData({ sheetKind: "", viewWeek: week.weekOf(new Date()), pasteText: "", pasteList: [] });
          this.refresh();
          feedback.ok("导入 " + n + " 门课");
        } catch (e) {
          feedback.report(e, "导入课表");
        }
      },
      fail: () => feedback.fail("确认框没弹出来", "再点一次保存")
    });
  },

  onToggleOneWeek() {
    this.setData({ "form.oneWeek": !this.data.form.oneWeek });
  },

  onFormInput(e) {
    const field = e.currentTarget.dataset.f;
    this.setData({ ["form." + field]: e.detail.value });
  },

  onDayChange(e) {
    const day = parseInt(e.detail.value, 10) + 1;
    this.setData({
      "form.day": day,
      formSlot: "周" + CN_DAY[day - 1] + " 第" + this.data.form.start + "节起"
    });
  },

  onStartChange(e) {
    const start = parseInt(e.detail.value, 10) * 2 + 1;
    /* 第 9 节起只剩一节，放不下四节连堂 */
    const lenOptions = start >= 9 ? LEN_2 : LEN_4;
    const len = start >= 9 ? 2 : this.data.form.len;
    this.setData({
      "form.start": start,
      "form.len": len,
      lenOptions: lenOptions,
      formSlot: "周" + CN_DAY[num(this.data.form.day, 1) - 1] + " 第" + start + "节起"
    });
  },

  onLenChange(e) {
    this.setData({ "form.len": (parseInt(e.detail.value, 10) + 1) * 2 });
  },

  onSaveForm() {
    const f = this.data.form;
    const name = (f.name || "").trim();
    if (!name) {
      feedback.tip("先填课程名");
      return;
    }
    if (f.start % 2 === 0 || f.start < 1 || f.start > 9) {
      feedback.fail("节次要成对", "手动录入按 1-2、3-4 这样成对排，起始节选单数节。");
      return;
    }
    if (f.len !== 2 && f.len !== 4) {
      feedback.fail("节次要成对", "一门课占两节，连堂可以选四节。");
      return;
    }
    if (f.start + f.len - 1 > 10) {
      feedback.fail("节次超出范围", "第 9 节起只剩两节，四节连堂放到第 7 节或更早。");
      return;
    }
    const rec = {
      name: name,
      teacher: (f.teacher || "").trim(),
      room: (f.room || "").trim(),
      day: f.day,
      start: f.start,
      len: f.len,
      weeks: (f.weeks || "").trim(),
      color: week.courseColor(name)
    };
    try {
      if (f.oneWeek) {
        const asTeacher = this.data.role === "teacher";
        const conflict = this.findSlotConflict(this.data.viewWeek, f.day, f.start, f.len, "");
        if (conflict) {
          feedback.fail("这个位置已有课", "换个星期或节次，别和「" + conflict + "」撞上。");
          return;
        }
        storage.upsertException({
          kind: "add",
          scope: asTeacher ? "teacher" : "student",
          srcTeacher: asTeacher ? String(this.data.tvName || "") : "",
          clsFull: "",
          name: name,
          teacher: asTeacher ? String(this.data.tvName || "") : rec.teacher,
          room: rec.room,
          toWeek: this.data.viewWeek,
          toDay: f.day,
          toStart: f.start,
          toLen: f.len
        });
        feedback.ok(asTeacher ? "已为本周补一节" : "已加到本周");
      } else {
        if (f.id) rec.id = f.id;
        storage.upsertLesson(rec);
        feedback.ok(f.id ? "已更新" : "加上了");
      }
      this.onCloseSheet();
      this.refresh();
    } catch (e) {
      feedback.report(e, "保存课程");
    }
  }
});
