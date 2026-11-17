const storage = require("../../utils/storage");
const gradeUtil = require("../../utils/grade");
const parseGrade = require("../../utils/parse-grade");
const fileLesson = require("../../utils/file-lesson");
const gradeRows = require("../../utils/grade-rows");
const ocrGrade = require("../../utils/ocr-grade");
const vkOcr = require("../../utils/vk-ocr");
const feedback = require("../../utils/feedback");

const PROMPT = "这是我的成绩单截图。请逐门提取课程信息，严格按每行一门输出，格式为：课程名|学分|成绩|绩点。没有绩点的课程最后一个字段留空。只输出这些文本行，不要解释、不要表格、不要 Markdown 符号、不要编号。";

Page({
  data: {
    cat: "personal",
    fadeFlip: false,
    cats: gradeUtil.CATS,
    hasData: false,
    sum: { avg: "—", gpa: "—", credit: "—", fail: 0, n: 0 },
    bars: [],
    gpaRows: [],
    dist: [],
    groups: [],
    simpleGroups: [],
    sheetKind: "",
  sheetLeaving: false,
    promptText: PROMPT,
    paste: { term: "", text: "" },
    ocr: { term: "", rows: [], pending: [], n: 0 },
    one: { term: "", name: "", score: "", note: "", credit: "", gpa: "" }
  },

  onLoad() {
    this.setData({ "paste.term": gradeUtil.currentTerm(), "one.term": gradeUtil.currentTerm() });
    this.refresh();
  },

  /* 页面里这块 canvas 专门用来把图摊成像素，交给识别层绘制
     比离屏 canvas 稳：部分安卓机上离屏画完取回来是空白的 */
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

  onUnload() {
    /* 页面没了，画布节点跟着失效，交回去免得下一张图往空节点上画 */
    vkOcr.setCanvas(null);
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    try {
      const state = storage.loadState();
      const cat = state.gradeCat || "personal";
      const list = gradeUtil.catGrades(state, cat);

      if (cat === "personal") {
        const res = gradeUtil.groups(state, "personal");
        const t = res.total;
        const groups = res.groups.map(function (m) {
          return {
            term: m.term,
            meta: "均 " + gradeUtil.g2(m.avg) + " · 绩点 " + gradeUtil.g2(m.gpaAvg) + " · " + m.creditText + " 学分",
            rows: m.rows.map(function (g) {
              const s = parseFloat(g.score);
              const c = parseFloat(g.credit);
              const gp = parseFloat(g.gpa);
              return {
                id: g.id,
                course: g.course,
                score: String(g.score),
                fail: s < 60,
                meta: (isFinite(c) ? c + " 学分" : "学分未填") + (isFinite(gp) ? " · 绩点 " + gp : "")
              };
            })
          };
        });
        this.setData({
          cat: cat,
          hasData: t.n > 0,
          sum: {
            avg: gradeUtil.g2(t.avg),
            gpa: gradeUtil.g2(t.gpaAvg),
            credit: gradeUtil.g2(t.credit),
            fail: t.fail,
            n: t.n
          },
          bars: gradeUtil.scoreBars(list),
          gpaRows: gradeUtil.gpaRows(list),
          dist: gradeUtil.dist(list),
          groups: groups,
          simpleGroups: []
        });
        return;
      }

      const map = {};
      const order = [];
      list.forEach(function (g) {
        const t = g.term || "未分学期";
        if (!map[t]) {
          map[t] = [];
          order.push(t);
        }
        map[t].push({
          id: g.id,
          course: g.course,
          score: String(g.score),
          note: g.note || ""
        });
      });
      const simpleGroups = order.sort(function (a, b) { return b.localeCompare(a); }).map(function (t) {
        return { term: t, rows: map[t] };
      });
      this.setData({
        cat: cat,
        hasData: list.length > 0,
        simpleGroups: simpleGroups,
        bars: [],
        gpaRows: [],
        dist: [],
        groups: []
      });
    } catch (e) {
      feedback.report(e, "读取成绩");
    }
  },

  onSwitchCat(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.cat) return;
    try {
      storage.setGradeCat(key);
      this.setData({ fadeFlip: !this.data.fadeFlip });
      this.refresh();
    } catch (err) {
      feedback.report(err, "切换分类");
    }
  },

  /* ---- 粘一段成绩 ---- */
  onOpenPaste() {
    this.setData({
      sheetKind: "paste",
      paste: { term: gradeUtil.currentTerm(), text: "" }
    });
  },

  onPasteTerm(e) {
    this.setData({ "paste.term": e.detail.value });
  },

  onPasteText(e) {
    this.setData({ "paste.text": e.detail.value });
  },

  onPasteFromClipboard() {
    wx.getClipboardData({
      success: (r) => {
        const text = r.data || "";
        if (!text) {
          feedback.tip("剪贴板是空的");
          return;
        }
        this.setData({ "paste.text": text });
        feedback.ok("已贴上");
      },
      fail: () => feedback.fail("读不到剪贴板", "长按输入框手动粘贴也行")
    });
  },

  onRunPaste() {
    const raw = this.data.paste.text;
    if (!raw || !String(raw).trim()) {
      feedback.tip("先把成绩粘进来");
      return;
    }
    try {
      const list = parseGrade.parseAny(raw);
      if (!list.length) {
        feedback.fail(
          "这段读不出来",
          "两种格式都认：\n1) 卡片式，每门带「学分：」「最终成绩：」\n2) 一行一门：课程名|学分|成绩|绩点\n粘原件，别自己改标点。"
        );
        return;
      }
      const term = (this.data.paste.term || "").trim() || "未分学期";
      const res = storage.addGrades(list, { cat: "personal", term: term });
      this.closeSheet();
      this.refresh();
      if (res.added) {
        feedback.ok("加了 " + res.added + " 门" + (res.skipped ? "，" + res.skipped + " 门已录过" : ""));
      } else {
        feedback.tip("这些课已经录过了");
      }
    } catch (e) {
      feedback.report(e, "成绩入库");
    }
  },

  /* ---- 从聊天导入整张成绩单（教务系统导出的表格）---- */
  onImportGrades() {
    if (this._importing) return;
    wx.chooseMessageFile({
      count: 1,
      type: "file",
      extension: ["xls", "xlsx", "csv", "txt", "docx", "html"],
      success: (res) => {
        const f = (res.tempFiles || [])[0];
        if (!f || !f.path) {
          feedback.fail("没拿到这个文件", "再选一次，或者把文件发到「文件传输助手」再试。");
          return;
        }
        this._importing = true;
        wx.showLoading({ title: "正在认" });
        fileLesson.readTableRows(f.path, f.name, (err, rows) => {
          this._importing = false;
          wx.hideLoading();
          if (err) {
            feedback.fail("这个文件打不开", err.code === "TYPE"
              ? "只认 xls、xlsx、csv、txt、docx 这类表格或文字文件。"
              : "文件读到一半失败了，换一份原件试试。");
            return;
          }
          let list = [];
          try {
            list = gradeRows.rowsToGrades(rows);
          } catch (e) {
            feedback.report(e, "成绩单解析");
            return;
          }
          if (!list.length) {
            feedback.fail(
              "没认出成绩行",
              "表头里要有「课程名称」和「成绩」两列，成绩得是数字。优秀、合格这类没有具体分数的先跳过了，那些用手录。"
            );
            return;
          }
          try {
            const res2 = storage.addGrades(list, { cat: "personal", term: gradeUtil.currentTerm() });
            this.setData({ cat: "personal" });
            this.refresh();
            if (res2.added) {
              feedback.ok("导进 " + res2.added + " 门" + (res2.skipped ? "，" + res2.skipped + " 门已经录过" : ""));
            } else {
              feedback.tip("这些课都已经录过了");
            }
          } catch (e) {
            feedback.report(e, "成绩入库");
          }
        });
      },
      fail: (e) => {
        if (e && e.errMsg && e.errMsg.indexOf("cancel") > -1) return;
        feedback.fail("没法选文件", "从聊天里选文件这一步被取消了，再点一次试试。");
      }
    });
  },

  /* ---- 加一条（专业考试 / 综测 / 个人单条）---- */
  onOpenOne() {
    this.setData({
      sheetKind: "one",
      one: { term: gradeUtil.currentTerm(), name: "", score: "", note: "", credit: "", gpa: "" }
    });
  },

  onOneInput(e) {
    const field = e.currentTarget.dataset.f;
    this.setData({ ["one." + field]: e.detail.value });
  },

  onSaveOne() {
    const f = this.data.one;
    const name = (f.name || "").trim();
    if (!name) {
      feedback.tip("先填名称");
      return;
    }
    const score = parseFloat(f.score);
    if (!isFinite(score)) {
      feedback.fail("分数不对", "分数只填数字，比如 86 或 86.5。");
      return;
    }
    const cat = this.data.cat;
    const rec = {
      cat: cat,
      course: name,
      score: score,
      term: (f.term || "").trim() || "未分学期",
      note: (f.note || "").trim(),
      credit: cat === "personal" && f.credit !== "" ? parseFloat(f.credit) : null,
      gpa: cat === "personal" && f.gpa !== "" ? parseFloat(f.gpa) : null
    };
    if (cat === "personal" && rec.credit !== null && !isFinite(rec.credit)) rec.credit = null;
    if (cat === "personal" && rec.gpa !== null && !isFinite(rec.gpa)) rec.gpa = null;
    try {
      const res = storage.upsertGrade(rec);
      if (!res.added) {
        feedback.fail("这条已经有了", "同一学期里同名的一条已经记过，换个名称或换学期再存。");
        return;
      }
      this.closeSheet();
      this.refresh();
      feedback.ok("加上了");
    } catch (e) {
      feedback.report(e, "保存成绩");
    }
  },

  /* ---- 拍成绩单截图，可一次选多张，逐张端侧识别后合并，核对再入库 ---- */
  onScanGrades() {
    if (this._scanning) return;
    if (!vkOcr.supported()) {
      feedback.fail("这个版本的微信还认不了图", "要微信 8.0.30 以上、基础库 2.27.0 以上。先用「粘一段成绩」或手录。");
      return;
    }
    this._scanning = true;
    wx.showLoading({ title: "准备识别", mask: true });
    const done = () => {
      this._scanning = false;
      wx.hideLoading();
    };

    vkOcr.recognizeMany((res) => {
      done();
      const list = [];
      const pending = [];
      const rawLines = [];
      let shots = 0;
      res.shots.forEach(function (s) {
        let p = null;
        try {
          /* 每张单独解析，条目不跨图串 */
          p = ocrGrade.parseAnchors(s.anchors, { imgWidth: s.width, imgHeight: s.height });
        } catch (e) {
          feedback.report(e, "识别结果解析");
          return;
        }
        if (!p) return;
        shots += 1;
        p.list.forEach(function (x) { list.push(x); });
        p.pending.forEach(function (x) { pending.push(x); });
        (p.rawLines || []).forEach(function (t) { rawLines.push(t); });
      });

      /* 同一学期两张截图内容常重叠，同名课程只留第一条。
         名字空着的不能丢：分数是对的，留到核对界面让用户补名字 */
      const seen = {};
      const uniq = [];
      list.forEach(function (x) {
        const key = String(x.course || "").replace(/\s+/g, "");
        if (key) {
          if (seen[key]) return;
          seen[key] = 1;
        }
        uniq.push(x);
      });
      const uniqPending = [];
      pending.forEach(function (x) {
        const key = String(x.course || "").replace(/\s+/g, "");
        if (key) {
          if (seen[key]) return;
          seen[key] = 1;
        }
        uniqPending.push(x);
      });

      if (!uniq.length && !uniqPending.length) {
        const peek = rawLines.filter(function (x) { return !!x; });
        if (peek.length) {
          const sample = peek.slice(0, 3).join("\n");
          feedback.fail(
            "字认到了，但没拼成成绩",
            "识别到 " + peek.length + " 行文字，里面找不到「学分」「最终成绩」这类字段。\n认到的原文：\n" + sample + "\n确认是卡片式成绩单，或者只截卡片那一块。"
          );
        } else {
          feedback.fail(
            "这几张图都没认出字",
            "对准卡片那一整块再拍，别带太多空白。也可以只截上半页、下半页分两张选。"
          );
        }
        return;
      }

      const rows = uniq.map(function (x, i) {
        return {
          key: "r" + i,
          course: x.course || "",
          nameUnknown: !!x.nameUnknown || !x.course,
          credit: x.credit,
          score: x.score,
          gpa: x.gpa,
          meta: (x.credit === null ? "学分未读到" : x.credit + " 学分") +
            (x.gpa === null ? "" : " · 绩点 " + x.gpa)
        };
      });
      this.setData({
        sheetKind: "ocr",
        ocr: {
          term: gradeUtil.currentTerm(),
          rows: rows,
          pending: uniqPending.map(function (x, i) {
            let why = "没读到分数";
            if (x.reason === "level") why = "只有「" + (x.level || "等级") + "」";
            return {
              key: "p" + i,
              course: x.course || "",
              nameUnknown: !!x.nameUnknown || !x.course,
              meta: (x.credit === null ? "学分未读到" : x.credit + " 学分") + " · " + why
            };
          }),
          n: rows.length
        }
      });
      const many = shots > 1 ? "共 " + shots + " 张，" : "";
      feedback.tip(many + "认出 " + rows.length + " 门，核对完再存");
    }, (err) => {
      done();
      if (err && err.code === "CANCEL") return;
      const where = err && err.total > 1 && err.index !== undefined
        ? "第 " + (err.index + 1) + " 张没读出来，"
        : "";
      const codeTag = err && err.code ? "（" + err.code + "）" : "";
      const diag = err && err.frameW ? "帧 " + err.frameW + "×" + err.frameH +
        (err.bufferLen ? "，缓冲 " + Math.round(err.bufferLen / 1024) + "KB" : "") +
        "，读图 " + err.frameMs + "ms" +
        (err.avg !== undefined ? "，均亮 " + err.avg + "，暗像素 " + err.darkRatio + "%" : "") + "。" : "";
      feedback.fail(vkOcr.explain(err && err.code) + codeTag, where + diag + "也可以先用「粘一段成绩」过渡。");
    }, (stage, index, total) => {
      if (stage === "done") return;
      const label = stage === "frame" ? "读图" : "识别";
      wx.showLoading({ title: label + " " + (index + 1) + "/" + total, mask: true });
    }, vkOcr.MAX_BATCH);
  },

  onOcrTerm(e) {
    this.setData({ "ocr.term": e.detail.value });
  },

  /* 课程名就地改：只改内存里的行数据，不 setData，避免输入过程中光标被顶走。
     删行或存盘前的 setData 会带上最新值 */
  onOcrName(e) {
    const i = Number(e.currentTarget.dataset.i);
    const rows = this.data.ocr.rows || [];
    if (rows[i]) {
      rows[i].course = e.detail.value;
      rows[i].nameUnknown = !String(e.detail.value).trim();
    }
  },

  onOcrPendingName(e) {
    const i = Number(e.currentTarget.dataset.i);
    const rows = this.data.ocr.pending || [];
    if (rows[i]) {
      rows[i].course = e.detail.value;
      rows[i].nameUnknown = !String(e.detail.value).trim();
    }
  },

  onOcrRemove(e) {
    const key = e.currentTarget.dataset.key;
    const rows = (this.data.ocr.rows || []).filter(function (r) { return r.key !== key; });
    this.setData({ "ocr.rows": rows, "ocr.n": rows.length });
  },

  onOcrSave() {
    const rows = this.data.ocr.rows || [];
    if (!rows.length) {
      feedback.tip("一条都没剩下");
      return;
    }
    const empty = rows.filter(function (r) { return !String(r.course || "").trim(); });
    if (empty.length) {
      feedback.fail("还有 " + empty.length + " 门没填课程名",
        "左右两列的课程名被粘在一起时认不全，点着色的名字补上，或者点 × 删掉。");
      return;
    }
    const term = (this.data.ocr.term || "").trim() || "未分学期";
    const list = rows.map(function (r) {
      return { course: String(r.course).trim(), credit: r.credit, score: r.score, gpa: r.gpa };
    });
    try {
      const res = storage.addGrades(list, { cat: "personal", term: term });
      this.closeSheet({ cat: "personal" });
      this.refresh();
      if (res.added) {
        feedback.ok("存了 " + res.added + " 门" + (res.skipped ? "，" + res.skipped + " 门已录过" : ""));
      } else {
        feedback.tip("这些课已经录过了");
      }
    } catch (e) {
      feedback.report(e, "成绩入库");
    }
  },

  /* ---- 识图取文字：给固定提示词，外部工具认完再粘回来 ---- */
  onOpenPrompt() {
    this.setData({ sheetKind: "prompt" });
  },

  onCopyPrompt() {
    wx.setClipboardData({
      data: PROMPT,
      success: () => feedback.tip("复制好了，去识图"),
      fail: () => feedback.fail("复制失败", "长按下面这段文字手动全选复制")
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

  onDelete(e) {
    const id = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name || "这条";
    wx.showModal({
      title: "删除成绩",
      content: "删掉「" + name + "」？",
      confirmText: "删除",
      confirmColor: "#E5484D",
      success: (r) => {
        if (!r.confirm) {
          feedback.tip("没删");
          return;
        }
        try {
          storage.removeGrade(id);
          this.refresh();
          feedback.ok("删掉了");
        } catch (err) {
          feedback.report(err, "删除成绩");
        }
      },
      fail: () => feedback.fail("确认框没弹出来", "再点一次 × 重试")
    });
  }
});
