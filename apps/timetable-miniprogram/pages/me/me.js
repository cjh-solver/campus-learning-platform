const storage = require("../../utils/storage");
const week = require("../../utils/week");
const feedback = require("../../utils/feedback");

function toTab(url) {
  wx.switchTab({
    url: url,
    fail: () => feedback.fail("页面没打开", "回上一页重试；再不行就重启小程序。")
  });
}

function toPage(url) {
  wx.navigateTo({
    url: url,
    fail: () => feedback.fail("页面没打开", "回上一页重试；再不行就重启小程序。")
  });
}

Page({
  data: {
    lessonCount: 0,
    hwCount: 0,
    examCount: 0,
    gradeCount: 0,
    hiddenCount: 0,
    hiddenLessons: []
  },

  onLoad() {
    this.refresh();
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    try {
      const state = storage.loadState();
      const hidden = state.hidden || [];
      const hiddenLessons = state.my
        .filter(function (l) { return l && typeof l === "object"; })
        .filter(function (l) { return hidden.indexOf(l.id) > -1; })
        .map(function (l) {
          const day = Math.min(Math.max(Number(l.day) || 1, 1), 7);
          const start = Number(l.start) || 1;
          return {
            id: l.id,
            name: String(l.name || "未命名课程"),
            slot: week.WEEKDAYS[day - 1] + " 第" + start + "节"
          };
        });
      this.setData({
        lessonCount: state.my.filter(function (l) { return l && typeof l === "object"; }).length,
        hwCount: state.extra.length,
        examCount: state.exams.length,
        gradeCount: state.grades.length,
        hiddenCount: hiddenLessons.length,
        hiddenLessons: hiddenLessons
      });
    } catch (e) {
      feedback.report(e, "读取本机数据");
    }
  },

  onRestore(e) {
    const id = e.currentTarget.dataset.id;
    try {
      storage.unhideLesson(id);
      this.refresh();
      feedback.ok("已恢复");
    } catch (err) {
      feedback.report(err, "恢复课程");
    }
  },

  onTapStat(e) {
    const t = e.currentTarget.dataset.target;
    if (t === "lesson") this.onGoTimetable();
    else if (t === "hw" || t === "exam") this.onGoHw();
    else if (t === "grade") this.onGoGrade();
  },

  onGoTimetable() {
    toTab("/pages/timetable/timetable");
  },

  onGoHw() {
    toTab("/pages/hwexam/hwexam");
  },

  onGoGrade() {
    toPage("/pages/grade/grade");
  },

  onReset() {
    wx.showModal({
      title: "清空全部数据",
      content: "课表、作业、考试、成绩都会从本机删除，不可恢复",
      confirmText: "清空",
      confirmColor: "#E5484D",
      success: (r) => {
        if (!r.confirm) {
          feedback.tip("已取消，数据还在");
          return;
        }
        try {
          storage.resetState();
          this.refresh();
          feedback.ok("已清空");
        } catch (e) {
          feedback.report(e, "清空数据");
        }
      },
      fail: () => feedback.fail("确认框没弹出来", "再点一次清空重试")
    });
  }
});
