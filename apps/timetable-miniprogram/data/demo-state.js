/* 演示数据：全部虚构，仅用于仓库展示与本地预览。
   课表来自 data/kb-data.js 的示例班级，这里补作业、考试、成绩、番茄统计。
   日期按“今天 + 偏移”生成，任何时候打开都不过期。 */

function pad(n) {
  return n < 10 ? "0" + n : String(n);
}

function at(offsetDays, hour, minute) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
    " " + pad(hour) + ":" + pad(minute);
}

function termKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  if (m >= 9) return y + "-" + (y + 1) + "-1";
  if (m <= 1) return (y - 1) + "-" + y + "-1";
  return (y - 1) + "-" + y + "-2";
}

const HOMEWORK = [
  { id: "demo-hw-1", course: "数学分析", title: "第三章习题 3.1 - 3.5", due: at(0, 20, 0), color: 0 },
  { id: "demo-hw-2", course: "大学英语", title: "听力 Unit 4 精听笔记", due: at(1, 23, 59), color: 1 },
  { id: "demo-hw-3", course: "高等代数", title: "矩阵分解课后作业", due: at(2, 22, 0), color: 2 },
  { id: "demo-hw-4", course: "程序设计基础", title: "实验报告 2：循环与函数", due: at(4, 18, 0), color: 3 },
  { id: "demo-hw-5", course: "概率论", title: "习题册 P42 - P45", due: at(6, 21, 0), color: 4 },
  { id: "demo-hw-6", course: "常微分方程", title: "小组作业：一阶方程解法汇总", due: at(9, 23, 59), color: 5 },
  { id: "demo-hw-7", course: "数学建模", title: "论文初稿：校园人流预测", due: at(12, 20, 0), color: 6 },
  { id: "demo-hw-8", course: "教育心理学", title: "课堂观察记录表", due: at(15, 17, 0), color: 0 },
  { id: "demo-hw-9", course: "体育", title: "体测项目登记", due: "", color: 2 },
  { id: "demo-hw-10", course: "形势与政策", title: "专题读后感", due: at(-1, 23, 59), color: 3 }
];

const EXAMS = [
  { id: "demo-ex-1", course: "数学分析", place: "1-101", date: at(3, 9, 0) },
  { id: "demo-ex-2", course: "大学英语", place: "2-201", date: at(7, 14, 0) },
  { id: "demo-ex-3", course: "概率论", place: "1-305", date: at(14, 9, 0) },
  { id: "demo-ex-4", course: "程序设计基础", place: "实验楼A201", date: at(18, 14, 0) },
  { id: "demo-ex-5", course: "常微分方程", place: "2-305", date: at(23, 9, 0) }
];

function grade(name, credit, score) {
  return { term: termKey(), name: name, score: String(score), credit: String(credit), note: "", gpa: "", cat: "personal" };
}

const GRADES = [
  grade("数学分析", 4, 92),
  grade("高等代数", 4, 88),
  grade("解析几何", 3, 95),
  grade("大学英语", 4, 78),
  grade("程序设计基础", 3, 91),
  grade("概率论", 3, 86),
  grade("常微分方程", 3, 84),
  grade("大学物理", 4, 82),
  grade("数学建模", 2, 93),
  grade("数值分析", 3, 88),
  grade("线性规划", 2, 87),
  grade("初等数论", 2, 90),
  grade("组合数学", 2, 86),
  grade("数学史", 2, 94),
  grade("教育心理学", 3, 89),
  grade("师范技能训练", 2, 92),
  grade("体育", 1, 90),
  grade("形势与政策", 2, 85)
];

const OTHER_GRADES = [
  { term: termKey(), name: "专业分流考试", score: "85", credit: "", note: "笔试", gpa: "", cat: "major" },
  { term: termKey(), name: "英语四级", score: "452", credit: "", note: "CET-4", gpa: "", cat: "major" },
  { term: termKey(), name: "综合素质测评", score: "88", credit: "", note: "学年", gpa: "", cat: "comp" },
  { term: termKey(), name: "志愿服务时长", score: "36", credit: "", note: "小时", gpa: "", cat: "comp" }
];

module.exports = function demoState() {
  return {
    extra: HOMEWORK.map(function (x) { return Object.assign({}, x); }),
    completed: ["demo-hw-9"],
    exams: EXAMS.map(function (x) { return Object.assign({}, x); }),
    grades: GRADES.concat(OTHER_GRADES),
    gradeCat: "personal",
    weekend: true,
    weekendSet: false,
    seeded: true,
    pomo: { date: new Date().getFullYear() + "-" + pad(new Date().getMonth() + 1) + "-" + pad(new Date().getDate()), count: 3, focusSec: 4500 }
  };
};
