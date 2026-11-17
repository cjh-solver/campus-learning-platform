const storage = require("../../utils/storage");
const week = require("../../utils/week");
const hwUtil = require("../../utils/hw");
const feedback = require("../../utils/feedback");
const vkOcr = require("../../utils/vk-ocr");
const ocrHw = require("../../utils/ocr-hw");

const COLOR_LIST = week.COLORS;

/* 撤销条停留与淡出，合计约 3 秒 */
const UNDO_HOLD = 2740;
const UNDO_FADE = 260;

/* 核对列表行内补字段：改完重算时间戳，已认出的课程和时间保留不动 */
function updateExamPasteRow(self, idx, patch) {
  const list = (self.data.examPasteList || []).slice();
  const i = list.findIndex(function (x) { return x.idx === idx; });
  if (i < 0) return;
  Object.assign(list[i], patch);
  const x = list[i];
  const due = x.date ? hwUtil.joinDateTime(x.date, x.time) : "";
  const meta = due ? hwUtil.dueMeta(due) : null;
  x.stamp = meta ? meta.stamp : "没写时间";
  self.setData({ examPasteList: list });
}

Page({
  data: {
    tab: "hw",
    fadeFlip: false,
    sum: { open: 0, urgent: 0, over: 0, done: 0 },
    openList: [],
    groups: [],
    doneList: [],
    exams: [],
    showDone: true,
    doneRate: 0,
    undo: null,
    undoLeaving: false,
    fabOpen: false,
    fabHidden: false,
    sheetKind: "",
  sheetLeaving: false,
    hwForm: { id: "", course: "", title: "", dueDate: "", dueTime: "" },
    examForm: { id: "", course: "", date: "", time: "", place: "" },
    pasteText: "",
    pasteList: [],
    pasteSkipped: 0,
    examPasteText: "",
    examPasteList: [],
    scan: { on: false, done: 0, total: 0, pct: 0, label: "" }
  },

  onLoad() {
    this.refresh();
  },

  onReady() {
    this.bindOcrCanvas();
  },

  bindOcrCanvas() {
    wx.createSelectorQuery()
      .select("#ocrCanvas")
      .fields({ node: true, size: true })
      .exec(function (res) {
        const node = res && res[0] && res[0].node;
        if (!node) return;
        try {
          vkOcr.setCanvas(node);
        } catch (e) {
          feedback.report(e, "绑定识别画布");
        }
      });
  },

  onShow() {
    this._lastTop = undefined;
    this.setData({ fabHidden: false });
    this.refresh();
  },

  onHide() {
    this.clearUndoTimer();
  },

  onUnload() {
    this.clearUndoTimer();
    vkOcr.setCanvas(null);
    /* 会话挂在原生层，页面走了必须收掉，否则下次进来可能起不来 */
    if (vkOcr && vkOcr.abort) vkOcr.abort();
  },

  onSwitchTab(e) {
    const t = e.currentTarget.dataset.t;
    if (t === this.data.tab) return;
    this.clearUndoTimer();
    this._lastTop = undefined;
    this.setData({ tab: t, fadeFlip: !this.data.fadeFlip, fabOpen: false, fabHidden: false, undo: null, undoLeaving: false });
  },

  onPageScroll(e) {
    const top = (e && e.scrollTop) || 0;
    if (this.data.fabOpen) { this._lastTop = top; return; }
    if (this._lastTop === undefined) { this._lastTop = top; return; }
    const delta = top - this._lastTop;
    if (top > 80 && delta > 6 && !this.data.fabHidden) {
      this.setData({ fabHidden: true });
    } else if ((delta < -6 || top <= 40) && this.data.fabHidden) {
      this.setData({ fabHidden: false });
    }
    this._lastTop = top;
  },

  refresh() {
    const state = storage.loadState();
    const all = state.extra || [];
    const now = new Date();

    const sum = hwUtil.summarize(all, state.completed, now);
    const split = hwUtil.splitByDone(all, state.completed);

    const openRaw = hwUtil.sortOpen(split.open, now);
    const openList = openRaw.map(function (h) {
      const meta = hwUtil.dueMeta(h.due, now);
      const parts = (meta.stamp || "").split(" ");
      const d = hwUtil.parseDue(h.due);
      return {
        id: h.id,
        course: h.course || "未分类",
        title: h.title,
        hasDue: meta.has,
        over: meta.over,
        urgent: meta.urgent,
        md: parts[0] || "",
        hm: parts[1] || "",
        left: meta.short || "",
        dueText: meta.text,
        stamp: meta.stamp,
        dueTs: d ? d.getTime() : null,
        color: COLOR_LIST[((h.color || 0) % 7 + 7) % 7]
      };
    });
    const groups = hwUtil.groupOpenByDate(openList, now);

    const doneList = split.done.map(function (h) {
      const meta = hwUtil.dueMeta(h.due, now);
      return {
        id: h.id,
        course: h.course || "未分类",
        title: h.title,
        dueText: meta.has ? meta.stamp : "没写截止",
        color: COLOR_LIST[((h.color || 0) % 7 + 7) % 7]
      };
    });

    const upcoming = hwUtil.upcomingExams(state.exams, now);
    const exams = upcoming.map(function (e) {
      const cd = hwUtil.examCountdown(e.date, now);
      const idx = week.courseColor(e.course || "");
      return {
        id: e.id,
        course: e.course || "未命名考试",
        place: e.place || "考场待定",
        stamp: hwUtil.fmtExamStamp(e.date),
        time: hwUtil.fmtExamTime(e.date),
        days: cd.days,
        cdText: cd.text,
        soon: cd.days !== null && cd.days <= 3,
        color: COLOR_LIST[((idx % 7) + 7) % 7]
      };
    });

    const total = openList.length + doneList.length;
    const doneRate = total ? Math.round((doneList.length * 100) / total) : 0;

    this.setData({
      sum: sum,
      openList: openList,
      groups: groups,
      doneList: doneList,
      exams: exams,
      doneRate: doneRate
    });
  },

  clearUndoTimer() {
    if (this._undoTimer) {
      clearTimeout(this._undoTimer);
      this._undoTimer = null;
    }
    if (this._undoOutTimer) {
      clearTimeout(this._undoOutTimer);
      this._undoOutTimer = null;
    }
  },

  onToggleDone(e) {
    const id = e.currentTarget.dataset.id;
    try {
      const done = storage.toggleHwDone(id);
      feedback.haptic();
      this.refresh();
      if (done) {
        const rec = (storage.loadState().extra || []).find(function (x) { return x.id === id; });
        const raw = rec ? String(rec.title || rec.course || "这条作业") : "这条作业";
        this.setData({ undo: { id: id, title: raw.length > 14 ? raw.slice(0, 14) + "…" : raw }, undoLeaving: false });
        this.clearUndoTimer();
        this._undoTimer = setTimeout(() => {
          this.setData({ undoLeaving: true });
          this._undoTimer = null;
          this._undoOutTimer = setTimeout(() => {
            this.setData({ undo: null, undoLeaving: false });
            this._undoOutTimer = null;
          }, UNDO_FADE);
        }, UNDO_HOLD);
      } else {
        this.clearUndoTimer();
        this.setData({ undo: null, undoLeaving: false });
        feedback.tip("已放回没交");
      }
    } catch (err) {
      feedback.report(err, "切换完成状态");
    }
  },

  onUndo() {
    const u = this.data.undo;
    if (!u) return;
    this.clearUndoTimer();
    try {
      storage.toggleHwDone(u.id);
      this.setData({ undo: null, undoLeaving: false });
      this.refresh();
      feedback.ok("已改回没交");
    } catch (err) {
      feedback.report(err, "撤销完成状态");
    }
  },

  onToggleFab() {
    const open = !this.data.fabOpen;
    this.setData({ fabOpen: open, fabHidden: false });
  },

  onCloseFab() {
    if (this.data.fabOpen) this.setData({ fabOpen: false, fabHidden: false });
  },

  onFabAction(e) {
    const action = e.currentTarget.dataset.action;
    this.setData({ fabOpen: false, fabHidden: false });
    if (action === "hwManual") this.onOpenHwForm();
    else if (action === "hwPaste") this.onOpenHwPaste();
    else if (action === "hwScan") this.onScanHw();
    else if (action === "examManual") this.onOpenExamForm();
    else if (action === "examPaste") this.onOpenExamPaste();
    else if (action === "examScan") this.onScanExam();
  },

  onDeleteHwFromForm() {
    const f = this.data.hwForm;
    if (!f.id) return;
    wx.showModal({
      title: "删除作业",
      content: "删除这条作业？",
      confirmText: "删除",
      confirmColor: "#E5484D",
      success: (r) => {
        if (!r.confirm) {
          feedback.tip("没删");
          return;
        }
        try {
          storage.removeHw(f.id);
          this.closeSheet();
          this.refresh();
          feedback.ok("删掉了");
        } catch (err) {
          feedback.report(err, "删除作业");
        }
      },
      fail: () => feedback.fail("确认框没弹出来", "再点一次删除重试")
    });
  },

  onToggleDoneList() {
    this.setData({ showDone: !this.data.showDone });
  },

  onOpenHwForm(e) {
    const id = e && e.currentTarget ? e.currentTarget.dataset.id : "";
    if (id) {
      const h = storage.loadState().extra.find(function (x) { return x.id === id; });
      if (!h) return;
      this.setData({
        sheetKind: "hwForm",
        hwForm: {
          id: h.id,
          course: h.course || "",
          title: h.title || "",
          dueDate: hwUtil.datePart(h.due),
          dueTime: hwUtil.timePart(h.due)
        }
      });
      return;
    }
    this.setData({
      sheetKind: "hwForm",
      hwForm: { id: "", course: "", title: "", dueDate: "", dueTime: "" }
    });
  },

  onHwInput(e) {
    const field = e.currentTarget.dataset.f;
    this.setData({ ["hwForm." + field]: e.detail.value });
  },

  onHwDate(e) {
    this.setData({ "hwForm.dueDate": e.detail.value });
  },

  onHwTime(e) {
    this.setData({ "hwForm.dueTime": e.detail.value });
  },

  onClearDue() {
    this.setData({ "hwForm.dueDate": "", "hwForm.dueTime": "" });
  },

  onSaveHw() {
    const f = this.data.hwForm;
    const title = (f.title || "").trim();
    if (!title) {
      feedback.tip("先填作业标题");
      return;
    }
    const course = (f.course || "").trim();
    const rec = {
      course: course,
      title: title,
      due: hwUtil.joinDateTime(f.dueDate, f.dueTime),
      color: week.courseColor(course || title)
    };
    if (f.id) rec.id = f.id;
    try {
      storage.upsertHw(rec);
      this.closeSheet();
      this.refresh();
      feedback.ok(f.id ? "作业已更新" : "作业已加上");
    } catch (e) {
      feedback.report(e, "保存作业");
    }
  },

  /* ---- 粘贴老师发的作业，一句话拆成多条 ---- */

  /* ---- 拍学习通作业通知，可一次选多张，识别完核对再入库 ---- */

  onScanHw() {
    if (this._scanning) return;
    if (!vkOcr.supported()) {
      feedback.fail("这个版本的微信还认不了图", "要微信 8.0.30 以上、基础库 2.27.0 以上。先用「粘贴作业」把通知文字粘进来。");
      return;
    }
    this._scanning = true;
    wx.showLoading({ title: "正在识别", mask: true });
    const done = () => {
      this._scanning = false;
      wx.hideLoading();
      this.setData({ scan: { on: false, done: 0, total: 0, pct: 0, label: "" } });
    };

    vkOcr.recognizeMany((res) => {
      done();
      const courses = (storage.loadState().my || []).map(function (l) { return l.name; });
      /* 每张单独解析，条目不跨图串；原文按张拼起来，缺字段的那张也能看到字 */
      let merged = null;
      try {
        merged = ocrHw.mergeShots(res.shots, { courses: courses });
      } catch (e) {
        feedback.report(e, "作业识别结果解析");
        return;
      }

      const rows = merged.list.map(function (h) {
        const meta = h.due ? hwUtil.dueMeta(h.due) : null;
        const idx = week.courseColor(h.course || h.title);
        return {
          idx: h.idx,
          course: h.course || "未分类",
          title: h.title,
          due: h.due || "",
          stamp: meta ? meta.stamp : "没写截止",
          approx: !!h.approx,
          infer: !!h.infer,
          guess: !!h.guess,
          color: COLOR_LIST[((idx % 7) + 7) % 7],
          from: h.from
        };
      });

      if (!rows.length) {
        if (merged.text) {
          /* 字认出来了，只是没凑成字段：把原文放进输入框，让人看得见也能改 */
          this.setData({
            sheetKind: "hwPaste",
            pasteText: merged.text,
            pasteList: [],
            pasteSkipped: 0
          });
          feedback.fail(
            "字认到了，但没认出作业字段",
            "已经把这些文字放进输入框。看看有没有「课程名称」「结束时间」，缺的补上再点识别。"
          );
        } else {
          feedback.fail(
            "这几张图都没认出字",
            "对准通知正文那一块再拍，别把状态栏和底部评论框一起拍进去。"
          );
        }
        return;
      }

      this.setData({
        sheetKind: "hwPaste",
        pasteText: merged.text,
        pasteList: rows,
        pasteSkipped: 0
      });
      const many = merged.shots > 1 ? "共 " + merged.shots + " 张，" : "";
      feedback.tip(many + "认出 " + rows.length + " 条，核对完再存");
    }, (err) => {
      done();
      if (err && err.code === "CANCEL") return;
      const where = err && err.total > 1 && err.index !== undefined
        ? "第 " + (err.index + 1) + " 张没读出来，"
        : "";
      feedback.fail(vkOcr.explain(err && err.code), where + "也可以先用「粘贴作业」把通知文字粘进来。");
    }, (stage, index, total) => {
      if (stage === "done") return;
      const at = index + 1;
      const label = stage === "frame" ? "读图" : "识别";
      /* 识别阶段算半格，进度条至少往前走一点 */
      const unit = index + (stage === "ocr" ? 0.5 : 0);
      wx.showLoading({ title: label + " " + at + "/" + total, mask: true });
      this.setData({
        scan: {
          on: true,
          done: index,
          total: total,
          pct: total ? Math.min(99, Math.round((unit / total) * 100)) : 0,
          label: label + " " + at + "/" + total
        }
      });
    }, vkOcr.MAX_BATCH);
  },

  /* ---- 拍学习通考试通知：一门课一场，认完填进「加考试」，人核对过再存 ---- */

  onScanExam() {
    if (this._scanning) return;
    if (!vkOcr.supported()) {
      feedback.fail("这个版本的微信还认不了图", "要微信 8.0.30 以上、基础库 2.27.0 以上。先手动加一场。");
      return;
    }
    this._scanning = true;
    wx.showLoading({ title: "正在识别", mask: true });
    const done = () => {
      this._scanning = false;
      wx.hideLoading();
      this.setData({ scan: { on: false, done: 0, total: 0, pct: 0, label: "" } });
    };

    vkOcr.recognizeMany((res) => {
      done();
      const courses = (storage.loadState().my || []).map(function (l) { return l.name; });
      /* 每张单独解析，条目不跨图串；原文按张拼起来，缺字段的那张也能看到字 */
      let merged = null;
      try {
        merged = ocrHw.mergeExamShots(res.shots, { courses: courses });
      } catch (e) {
        feedback.report(e, "考试识别结果解析");
        return;
      }

      const rows = merged.list.map(function (e) {
        const due = e.date ? hwUtil.joinDateTime(e.date, e.time) : "";
        const meta = due ? hwUtil.dueMeta(due) : null;
        const idx = week.courseColor(e.course || "考试");
        return {
          idx: e.idx,
          course: e.course || "",
          place: e.place || "",
          date: e.date || "",
          time: e.time || "",
          stamp: meta ? meta.stamp : "没写时间",
          guess: !!e.guess,
          color: COLOR_LIST[((idx % 7) + 7) % 7],
          from: e.from
        };
      });

      if (!rows.length) {
        if (merged.text) {
          /* 字认出来了，只是没凑成字段：放进考试粘贴面板，让人看得见也能改 */
          this.setData({
            sheetKind: "examPaste",
            examPasteText: merged.text,
            examPasteList: []
          });
          feedback.fail(
            "字认到了，但没认出考试字段",
            "已经把这些文字放进输入框。看看有没有「考试名称」「考试时间」，缺的补上再点识别。"
          );
        } else {
          feedback.fail("这几张图都没认出字", "对准考试详情正文再拍一次，别把状态栏一起拍进去。");
        }
        return;
      }

      this.setData({
        sheetKind: "examPaste",
        examPasteText: merged.text,
        examPasteList: rows
      });
      const many = merged.shots > 1 ? "共 " + merged.shots + " 张，" : "";
      feedback.tip(many + "认出 " + rows.length + " 场，核对完再存");
    }, (err) => {
      done();
      if (err && err.code === "CANCEL") return;
      feedback.fail(vkOcr.explain(err && err.code), "也可以手动加一场考试。");
    }, (stage, index, total) => {
      if (stage === "done") return;
      const at = index + 1;
      const label = stage === "frame" ? "读图" : "识别";
      const unit = index + (stage === "ocr" ? 0.5 : 0);
      wx.showLoading({ title: label + " " + at + "/" + total, mask: true });
      this.setData({
        scan: {
          on: true,
          done: index,
          total: total,
          pct: total ? Math.min(99, Math.round((unit / total) * 100)) : 0,
          label: label + " " + at + "/" + total
        }
      });
    }, vkOcr.MAX_BATCH);
  },

  onOpenHwPaste() {
    this.setData({
      sheetKind: "hwPaste",
      pasteText: "",
      pasteList: [],
      pasteSkipped: 0
    });
  },

  onPasteInput(e) {
    this.setData({ pasteText: e.detail.value });
  },

  onPasteFromClipboard() {
    wx.getClipboardData({
      success: (r) => {
        const text = r.data || "";
        if (!text) {
          feedback.tip("剪贴板是空的");
          return;
        }
        this.setData({ pasteText: text });
        feedback.ok("已贴上");
      },
      fail: () => {
        feedback.fail("读不到剪贴板", "微信可能没允许读取。长按输入框手动粘贴。");
      }
    });
  },

  onParsePaste() {
    const text = (this.data.pasteText || "").trim();
    if (!text) {
      feedback.tip("先把老师发的那段粘进来");
      return;
    }
    try {
      const state = storage.loadState();
      const courses = (state.my || []).map(function (l) { return l.name; });
      const r = hwUtil.parseHwText(text, { courses: courses });

      if (!r.items.length) {
        feedback.fail("没认出作业", "至少要有一行课程名或作业标题，再来一行带「截止时间」的日期，例如 11-15 22:19。");
        return;
      }

      const list = r.items.map(function (h, i) {
        const meta = h.due ? hwUtil.dueMeta(h.due) : null;
        const idx = week.courseColor(h.course || h.title);
        return {
          idx: i,
          course: h.course || "未分类",
          title: h.title,
          due: h.due,
          stamp: meta ? meta.stamp : "没写截止",
          approx: !!h.approx,
          infer: !!h.infer,
          color: COLOR_LIST[((idx % 7) + 7) % 7]
        };
      });

      this.setData({ pasteList: list, pasteSkipped: r.skipped.length });
      feedback.ok("认出 " + list.length + " 条");
    } catch (e) {
      feedback.report(e, "认出这段作业");
    }
  },

  onRemovePasteItem(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const list = this.data.pasteList.filter(function (x) { return x.idx !== idx; });
    this.setData({ pasteList: list });
  },

  onSavePaste() {
    const list = this.data.pasteList || [];
    if (!list.length) {
      feedback.tip("先点识别");
      return;
    }
    try {
      const hws = list.map(function (h) {
        return {
          course: h.course === "未分类" ? "" : h.course,
          title: h.title,
          due: h.due,
          color: week.courseColor(h.course || h.title)
        };
      });
      const added = storage.mergeHws(hws);
      this.closeSheet();
      this.refresh();
      if (added) feedback.ok("加了 " + added + " 条");
      else feedback.tip("这些本机都有了，没重复加");
    } catch (e) {
      feedback.report(e, "保存这批作业");
    }
  },

  /* ---- 粘贴学习通考试详情：一场一条，认完核对再入库 ---- */

  onOpenExamPaste() {
    this.setData({
      sheetKind: "examPaste",
      examPasteText: "",
      examPasteList: []
    });
  },

  onExamPasteInput(e) {
    this.setData({ examPasteText: e.detail.value });
  },

  onExamPasteFromClipboard() {
    wx.getClipboardData({
      success: (r) => {
        const text = r.data || "";
        if (!text) {
          feedback.tip("剪贴板是空的");
          return;
        }
        this.setData({ examPasteText: text });
        feedback.ok("已贴上");
      },
      fail: () => feedback.fail("读不到剪贴板", "长按输入框手动粘贴。")
    });
  },

  onParseExamPaste() {
    const text = (this.data.examPasteText || "").trim();
    if (!text) {
      feedback.tip("先把考试详情那段粘进来");
      return;
    }
    try {
      const state = storage.loadState();
      const courses = (state.my || []).map(function (l) { return l.name; });
      const r = hwUtil.parseExamText(text, { courses: courses });

      if (!r.items.length) {
        feedback.fail("没认出考试", "至少要有考试名称，或一行带「考试时间」「截止时间」的日期，例如 10-29 00:00 至 2027-01-15 23:59。课程名没认到时先存成空，核对时补上。");
        return;
      }

      const list = r.items.map(function (e, i) {
        const due = e.date ? hwUtil.joinDateTime(e.date, e.time) : "";
        const meta = due ? hwUtil.dueMeta(due) : null;
        const idx = week.courseColor(e.course || "考试");
        return {
          idx: i,
          course: e.course || "",
          place: e.place || "",
          date: e.date || "",
          time: e.time || "",
          stamp: meta ? meta.stamp : "没写时间",
          guess: !!e.guess,
          color: COLOR_LIST[((idx % 7) + 7) % 7]
        };
      });

      this.setData({ examPasteList: list });
      feedback.ok("认出 " + list.length + " 场");
    } catch (e) {
      feedback.report(e, "认出这段考试");
    }
  },

  onRemoveExamPasteItem(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    this.setData({ examPasteList: this.data.examPasteList.filter(function (x) { return x.idx !== idx; }) });
  },

  onExamPasteInput(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const field = e.currentTarget.dataset.f;
    const patch = {};
    patch[field] = e.detail.value;
    updateExamPasteRow(this, idx, patch);
  },

  onExamPasteDate(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    updateExamPasteRow(this, idx, { date: e.detail.value });
  },

  onExamPasteTime(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    updateExamPasteRow(this, idx, { time: e.detail.value });
  },

  onSaveExamPaste() {
    const list = this.data.examPasteList || [];
    if (!list.length) {
      feedback.tip("先点识别");
      return;
    }
    if (list.some(function (x) { return !x.course; })) {
      feedback.tip("有考试没填课程名，补上再存");
      return;
    }
    if (list.some(function (x) { return !x.date; })) {
      feedback.tip("有考试没认出截止日期，手动补上再存");
      return;
    }
    try {
      const exams = list.map(function (x) {
        return {
          course: x.course,
          date: hwUtil.joinDateTime(x.date, x.time),
          place: x.place || ""
        };
      });
      const added = storage.mergeExams(exams);
      this.closeSheet();
      this.refresh();
      if (added) feedback.ok("加了 " + added + " 场");
      else feedback.tip("这些本机都有了，没重复加");
    } catch (e) {
      feedback.report(e, "保存这批考试");
    }
  },

  onOpenExamForm(e) {
    const id = e && e.currentTarget ? e.currentTarget.dataset.id : "";
    if (id) {
      const x = storage.loadState().exams.find(function (v) { return v.id === id; });
      if (!x) return;
      this.setData({
        sheetKind: "examForm",
        examForm: {
          id: x.id,
          course: x.course || "",
          date: hwUtil.datePart(x.date),
          time: hwUtil.timePart(x.date),
          place: x.place || ""
        }
      });
      return;
    }
    this.setData({
      sheetKind: "examForm",
      examForm: { id: "", course: "", date: "", time: "", place: "" }
    });
  },

  onExamInput(e) {
    const field = e.currentTarget.dataset.f;
    this.setData({ ["examForm." + field]: e.detail.value });
  },

  onExamDate(e) {
    this.setData({ "examForm.date": e.detail.value });
  },

  onExamTime(e) {
    this.setData({ "examForm.time": e.detail.value });
  },

  onSaveExam() {
    const f = this.data.examForm;
    const course = (f.course || "").trim();
    if (!course) {
      feedback.tip("先填考试课程");
      return;
    }
    if (!f.date) {
      feedback.tip("选一下考试日期");
      return;
    }
    const rec = {
      course: course,
      date: hwUtil.joinDateTime(f.date, f.time),
      place: (f.place || "").trim()
    };
    if (f.id) rec.id = f.id;
    try {
      storage.upsertExam(rec);
      this.closeSheet();
      this.refresh();
      feedback.ok(f.id ? "考试已更新" : "考试已加上");
    } catch (e) {
      feedback.report(e, "保存考试");
    }
  },

  onDeleteExam() {
    const f = this.data.examForm;
    if (!f.id) {
      feedback.tip("这场考试没有记录可删");
      return;
    }
    wx.showModal({
      title: "删除考试",
      content: "删除这场考试？",
      confirmText: "删除",
      confirmColor: "#E5484D",
      success: (r) => {
        if (!r.confirm) {
          feedback.tip("没删");
          return;
        }
        try {
          storage.removeExam(f.id);
          this.closeSheet();
          this.refresh();
          feedback.ok("删掉了");
        } catch (e) {
          feedback.report(e, "删除考试");
        }
      },
      fail: () => feedback.fail("确认框没弹出来", "再点一次删除重试")
    });
  },

  closeSheet(extra) {
    /* 面板先播 180ms 退场动画再卸载，连点只认第一次 */
    if (!this.data.sheetKind || this._sheetTimer) return;
    this.setData({ sheetLeaving: true });
    this._sheetTimer = setTimeout(() => {
      this._sheetTimer = null;
      this.setData(Object.assign({ sheetKind: "", sheetLeaving: false }, extra || {}));
    }, 200);
  },

  onCloseSheet() {
    this.closeSheet();
  },

  noop() {}
});
