/* 倒计时数据：四六级、考研有多场次可选，期末由用户自己加 */

/* 场次选项，按 id 挂到卡片上；date 为空表示官方还没公布 */
const OPTIONS = {
  cet: [
    {
      label: "2026 年 6 月 13 日",
      date: "2026-06-13",
      note: "四级 9:00—11:20，六级 15:00—17:25"
    },
    {
      label: "2026 年 12 月 12 日",
      date: "2026-12-12",
      note: "四级 9:00—11:20，六级 15:00—17:25"
    },
    {
      label: "2027 年 6 月（待公布）",
      date: "",
      note: "官方还没公布，先占个位"
    }
  ],
  kaoyan: [
    {
      label: "2027 届 · 2026 年 12 月 19—20 日",
      date: "2026-12-19",
      note: "两天，19 日政治与外语，20 日业务课"
    },
    {
      label: "2028 届 · 2027 年 12 月（待公布）",
      date: "",
      note: "官方还没公布，先占个位"
    }
  ]
};

const DEFAULT_ITEMS = [
  { id: "cet", title: "四六级笔试", date: "", selected: 1, fixed: true },
  { id: "kaoyan", title: "考研初试", date: "", selected: 0, fixed: true },
  { id: "final", title: "期末", date: "", selected: 0, fixed: false }
];

function parseDay(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str || "");
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function today(now) {
  const d = now ? new Date(now) : new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/* 距离目标日期还有几天，今天算 0，已过为负，日期不合法返回 null */
function daysLeft(dateStr, now) {
  const t = parseDay(dateStr);
  if (!t) return null;
  return Math.round((t.getTime() - today(now).getTime()) / 86400000);
}

function fmtDate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || "");
  if (!m) return "未设定";
  return Number(m[2]) + " 月 " + Number(m[3]) + " 日";
}

/* 取卡片当前生效的日期与说明：有场次的按选中项，没有的用自带日期 */
function effective(item) {
  const list = OPTIONS[item.id];
  if (list && list.length) {
    const idx = Math.min(Math.max(item.selected || 0, 0), list.length - 1);
    return { date: list[idx].date, note: list[idx].note, label: list[idx].label };
  }
  return { date: item.date || "", note: item.note || "", label: "" };
}

/* 按剩余时间分档的鼓励语库。每档一组，进页面随机抽一句。 */
const QUOTES = {
  /* 还剩 90 天以上：打基础，别慌 */
  far: [
    "时间还早，先把最拖的那一章啃掉",
    "别等整块时间，零碎时间也能记东西",
    "现在每天多做一点，后面就不会慌",
    "先养成坐下来学的习惯，速度自然会来",
    "还有余量，够你把基础过两遍",
    "慢一点没关系，别停在原地",
    "先把教材过一遍，再谈刷题",
    "每天留一点时间给最薄弱的那门",
    "单词和公式这种慢功夫，现在攒最划算",
    "基础题先做熟，难题后面再碰",
    "别一上来就追进度，先把框架搭起来",
    "今天翻开书，就比昨天多走一步"
  ],
  /* 31 到 90 天：推进度，回头补漏 */
  mid: [
    "把计划砍一半，先做完再说",
    "状态不好就先做十分钟，做着做着就有了",
    "别跟别人比进度，比谁今天真坐下来了",
    "错题比新题值钱，回去翻翻",
    "今天做的事，考试那天会替你说出来",
    "一天推一点，好过周末通宵补",
    "每做完一章，回头把要点串一遍",
    "卡壳的地方先标记，别在一道题上耗太久",
    "听课不如动手写一遍，写过才算会",
    "固定一个时段专攻弱项，比东翻西翻管用",
    "计划写在纸上，做完一条划掉一条",
    "累了就歇十分钟，别硬撑到效率归零"
  ],
  /* 7 到 30 天：真题优先，稳住节奏 */
  near: [
    "真题优先，别再到处搜新资料",
    "把会做的题做对，比死磕难题划算",
    "睡够比多刷一套更要紧",
    "按考试时间调作息，让身体先适应",
    "剩下的日子，稳节奏比加量有用",
    "不熟的那块单独拿出来过一遍",
    "错题本翻一遍，比再做新题实在",
    "作文和模板提前备好，别留到最后一晚",
    "按考试时间做套卷，练一下节奏",
    "容易忘的点写在便签上，随身看",
    "资料够了，别再囤新的",
    "把之前错过的题再做一次，确认真会了"
  ],
  /* 7 天以内：不开新坑，收拾妥当 */
  week: [
    "就这几天了，别开新坑",
    "把最不放心的那一块再过一遍就够",
    "今晚早点睡，脑子清醒比多背十条强",
    "提前把考场路线和时间确认好",
    "收拾好东西，别到那天手忙脚乱",
    "证件和文具今晚装进包里",
    "翻一遍错题和笔记，不用再做新题",
    "作息往考试时间靠，别再熬夜",
    "把公式和高频词最后过一遍",
    "紧张就深呼吸，慢慢把节奏稳住"
  ],
  /* 当天上场 */
  today: [
    "今天上场，正常发挥就是超水平",
    "会的先拿稳，不会的先跳过",
    "深呼吸，就当一次普通的练习",
    "写完再检查一遍，别提前交卷",
    "拿到卷子先通读一遍，心里有数",
    "字迹写清楚，别让卷面吃亏",
    "一道题卡住别死磕，先往下走",
    "考完一门放一门，别对答案"
  ],
  /* 已经考完 */
  past: [
    "这一场结束了，别在心里反复回放",
    "结果没出来之前，先往前走一步",
    "不管考成什么样，日子还在继续",
    "把这场当垫脚石，下一场还在前面",
    "考得好就记着，考砸了就翻篇",
    "先歇一晚，再看接下来要做什么",
    "别用一场考试否定前面所有的准备",
    "复盘留到有空的时候，现在先松口气"
  ],
  /* 日期还没公布 */
  wait: [
    "日子还没定，先按老节奏走",
    "等通知下来再规划，别自己吓自己",
    "先把该背的词背着，时间一公布就能上轨道",
    "日期没出，复习别跟着停",
    "先把通用的基础打牢，哪场都用得上",
    "留意官方通知，别错过报名和时间"
  ]
};

function stageOf(days) {
  if (days === null) return "wait";
  if (days === 0) return "today";
  if (days < 0) return "past";
  if (days < 7) return "week";
  if (days < 31) return "near";
  if (days <= 90) return "mid";
  return "far";
}

/* 按档随机挑一句，每次进页面都可能不一样 */
function pickQuote(days) {
  const pool = QUOTES[stageOf(days)] || QUOTES.far;
  return pool[Math.floor(Math.random() * pool.length)];
}

module.exports = {
  DEFAULT_ITEMS: DEFAULT_ITEMS,
  OPTIONS: OPTIONS,
  QUOTES: QUOTES,
  stageOf: stageOf,
  pickQuote: pickQuote,
  daysLeft: daysLeft,
  fmtDate: fmtDate,
  parseDay: parseDay,
  effective: effective
};
