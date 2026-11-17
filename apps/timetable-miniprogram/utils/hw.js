/* 作业与考试的时间、排序、倒计时口径；不依赖 wx API，可单测 */

function pad2(n) {
  return n < 10 ? "0" + n : "" + n;
}

/* 兼容 "2026-11-15"、"2026-11-15 20:00"、"2026/11/15 20:00" 与 ISO 串
   iOS 的 JSCore 不认带空格的 "YYYY-MM-DD HH:mm"，这里统一手工拆字段 */
function parseDue(s) {
  if (s instanceof Date) {
    return isNaN(s.getTime()) ? null : s;
  }
  if (s === null || s === undefined) return null;
  const str = String(s).trim();
  if (!str) return null;

  const m = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2}))?/);
  if (m) {
    const d = new Date(
      parseInt(m[1], 10),
      parseInt(m[2], 10) - 1,
      parseInt(m[3], 10),
      m[4] ? parseInt(m[4], 10) : 0,
      m[5] ? parseInt(m[5], 10) : 0,
      0,
      0
    );
    return isNaN(d.getTime()) ? null : d;
  }

  const d2 = new Date(str);
  return isNaN(d2.getTime()) ? null : d2;
}

function daysBetween(a, b) {
  return Math.floor((b.getTime() - a.getTime()) / 86400000);
}

/* 截止状态的统一口径：72 小时内为紧急，已过为逾期，与 H5 一致 */
function dueMeta(dueStr, now) {
  const base = now || new Date();
  const d = parseDue(dueStr);
  if (!d) {
    return { has: false, over: false, urgent: false, text: "没写截止", stamp: "" };
  }
  const left = d.getTime() - base.getTime();
  const over = left < 0;
  const urgent = !over && left > 0 && left < 72 * 3600000;

  let text;
  let short;
  if (over) {
    const gone = Math.abs(left);
    text = "已过 " + Math.abs(daysBetween(d, base)) + " 天";
    short = gone >= 86400000 ? "逾期 " + Math.abs(daysBetween(d, base)) + " 天"
      : "逾期 " + Math.max(1, Math.floor(gone / 3600000)) + " 小时";
  } else if (left < 60000) {
    text = "还剩 " + Math.floor(left / 60000) + " 分钟";
    short = "不足 1 分";
  } else if (left < 3600000) {
    text = "还剩 " + Math.floor(left / 60000) + " 分钟";
    short = "剩 " + Math.floor(left / 60000) + " 分";
  } else if (left < 86400000) {
    text = "还剩 " + Math.floor(left / 86400000) + " 天 " +
      Math.floor((left % 86400000) / 3600000) + " 小时";
    short = "剩 " + Math.floor(left / 3600000) + " 小时";
  } else {
    text = "还剩 " + Math.floor(left / 86400000) + " 天 " +
      Math.floor((left % 86400000) / 3600000) + " 小时";
    short = "剩 " + Math.floor(left / 86400000) + " 天";
  }

  return {
    has: true,
    over: over,
    urgent: urgent,
    text: text,
    short: short,
    stamp: pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes())
  };
}

/* 未交按截止升序，没写截止的排末尾 */
function sortOpen(list, now) {
  const base = now || new Date();
  return (list || []).slice().sort(function (a, b) {
    const da = parseDue(a.due);
    const db = parseDue(b.due);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return da.getTime() - db.getTime();
  });
}

/* 汇总口径：未交数、三天内截止数、已逾期数、已交数 */
function summarize(all, completed, now) {
  const base = now || new Date();
  const doneIds = completed || [];
  let open = 0;
  let urgent = 0;
  let over = 0;
  let done = 0;

  (all || []).forEach(function (h) {
    if (doneIds.indexOf(h.id) > -1) {
      done++;
      return;
    }
    open++;
    const meta = dueMeta(h.due, base);
    if (meta.urgent) urgent++;
    if (meta.over) over++;
  });

  return { open: open, urgent: urgent, over: over, done: done };
}

function splitByDone(all, completed) {
  const doneIds = completed || [];
  const open = [];
  const done = [];
  (all || []).forEach(function (h) {
    if (doneIds.indexOf(h.id) > -1) done.push(h);
    else open.push(h);
  });
  return { open: open, done: done };
}

/* 考试只取今天及以后，按时间升序 */
function upcomingExams(exams, now) {
  const base = now || new Date();
  const today = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0, 0);
  return (exams || [])
    .filter(function (e) {
      const d = parseDue(e.date);
      return d && d.getTime() >= today.getTime();
    })
    .sort(function (a, b) {
      return parseDue(a.date).getTime() - parseDue(b.date).getTime();
    });
}

/* 距今天数按自然日算，今天 0、明天 1 */
function examCountdown(dateStr, now) {
  const base = now || new Date();
  const d = parseDue(dateStr);
  if (!d) return { days: null, text: "" };
  const a = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0, 0);
  const b = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const days = Math.round((b.getTime() - a.getTime()) / 86400000);
  let text;
  if (days === 0) text = "今天";
  else if (days === 1) text = "明天";
  else text = "还有 " + days + " 天";
  return { days: days, text: text };
}

/* 待交作业按截止自然日分组：已逾期 / 今天 / 明天 / 近期 / 稍后 / 没写截止
   items 为页面映射后的平铺项，需带 over 与 dueTs（时间戳或 null） */
function groupOpenByDate(items, now) {
  const base = now || new Date();
  const today = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0, 0);
  const buckets = { over: [], today: [], tomorrow: [], soon: [], later: [], nodate: [] };
  (items || []).forEach(function (it) {
    if (!it.dueTs) { buckets.nodate.push(it); return; }
    if (it.over) { buckets.over.push(it); return; }
    const d0 = new Date(it.dueTs);
    const day = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate(), 0, 0, 0, 0);
    const diff = Math.round((day.getTime() - today.getTime()) / 86400000);
    if (diff <= 0) buckets.today.push(it);
    else if (diff === 1) buckets.tomorrow.push(it);
    else if (diff <= 3) buckets.soon.push(it);
    else buckets.later.push(it);
  });
  const order = [
    { key: "over", label: "已逾期" },
    { key: "today", label: "今天" },
    { key: "tomorrow", label: "明天" },
    { key: "soon", label: "近期" },
    { key: "later", label: "稍后" },
    { key: "nodate", label: "没写截止" }
  ];
  return order.filter(function (g) { return buckets[g.key].length > 0; })
    .map(function (g) { return { key: g.key, label: g.label, items: buckets[g.key] }; });
}

function fmtExamStamp(dateStr) {
  const d = parseDue(dateStr);
  if (!d) return "";
  return pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

function fmtExamTime(dateStr) {
  const d = parseDue(dateStr);
  if (!d) return "";
  return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}

/* 表单回填：Date 值转 picker 需要的字符串 */
function datePart(dateStr) {
  const d = parseDue(dateStr);
  if (!d) return "";
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

function timePart(dateStr) {
  const d = parseDue(dateStr);
  if (!d) return "";
  return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}

/* 表单提交：日期与时间拼成统一可解析串，没选时间按 23:59 兜底 */
function joinDateTime(dateStr, timeStr) {
  const day = (dateStr || "").trim();
  if (!day) return "";
  const t = (timeStr || "").trim() || "23:59";
  return day + " " + t;
}

/* ---------- 老师发的作业文本：一句话几条作业 ---------- */

const ZERO_WIDTH = /[\u200b-\u200f\u2060\ufeff]/g;
const DASH = /[－—–]/g;
/* 日期片：可带年份，月与日之间用 - / . 月 日 号，时间用 : 或全角冒号 */
const DATE_SRC = "(?:(\\d{4})\\s*[-/.年]\\s*)?(\\d{1,2})\\s*[-/.月]\\s*(\\d{1,2})\\s*[日号]?(?:\\s*(\\d{1,2})\\s*[:：]\\s*(\\d{1,2}))?";
/* 含这些词的整行按时间行处理：开始到底算不算，先认下来再决定收不收 */
const TIME_WORD = /截止|ddl|deadline|到期|提交时间|交作业|开始时间|上课时间|结束时间/i;

function cleanLine(s) {
  return String(s === null || s === undefined ? "" : s)
    .replace(ZERO_WIDTH, "")
    .replace(/\u00a0/g, " ")
    .replace(DASH, "-")
    .trim();
}

/* 取这一行里第一个能构成合法日期的时间点 */
function firstTime(str, now) {
  const re = new RegExp(DATE_SRC, "g");
  let m;
  while ((m = re.exec(str)) !== null) {
    const mo = parseInt(m[2], 10);
    const dd = parseInt(m[3], 10);
    const hh = m[4] === undefined ? 23 : parseInt(m[4], 10);
    const mi = m[5] === undefined ? 59 : parseInt(m[5], 10);
    if (mo < 1 || mo > 12 || dd < 1 || dd > 31 || hh > 23 || mi > 59) continue;

    let year = m[1] ? parseInt(m[1], 10) : now.getFullYear();
    /* 没写年份又跨了半年的月份（例如一月看到「12-20」），算明年 */
    if (!m[1] && mo - (now.getMonth() + 1) > 6) year += 1;

    const dt = new Date(year, mo - 1, dd, hh, mi, 0, 0);
    if (dt.getMonth() !== mo - 1 || dt.getDate() !== dd) continue;
    return dt;
  }
  return null;
}

function isTimeLine(line, now) {
  if (TIME_WORD.test(line)) return true;
  /* 整行除了一个日期片没有别的字，且能构成合法时间：多半是单独一行的截止 */
  const rest = line.replace(new RegExp(DATE_SRC, "g"), "").replace(/[：:，,。;；、\s]/g, "");
  return rest === "" && firstTime(line, now) !== null;
}

/* 「截止」后面那个时间才算交作业的期限；只有开始时间就不猜 */
function deadlineOf(line, now) {
  const idx = line.search(/截止|ddl|deadline|到期|提交时间|交作业/i);
  if (idx > -1) {
    const t = firstTime(line.slice(idx), now);
    if (t) return t;
    return firstTime(line, now);
  }
  /* 只写了开始时间，宁可留空，也不要把开课时间当截止算紧急 */
  if (/开始时间|上课时间/.test(line)) return null;
  return firstTime(line, now);
}

function pad(n) {
  return n < 10 ? "0" + n : "" + n;
}

function fmtDue(d) {
  if (!d) return "";
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
    " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

function cleanTitle(s) {
  return String(s || "")
    /* 只去「1、」「1)」「1. 」这类序号，17.3-17.4 这种章节号要留着 */
    .replace(/^(?:[①-⑩]\s*|\d{1,2}\s*[、)）]\s*|\d{1,2}\.\s+)/, "")
    .replace(/^(?:课后)?(?:作业|习题)\s*[:：]\s*/, "")
    .trim();
}

/* 整行等于某门已知课；写成简称（数学分析 → 数学分析III）且只对上一门时也算 */
function exactCourse(text, courses) {
  const t = String(text || "").trim();
  if (!t) return "";
  for (let i = 0; i < (courses || []).length; i++) {
    if (courses[i] && t === courses[i]) return courses[i];
  }
  if (t.length < 3) return "";
  const hits = [];
  (courses || []).forEach(function (n) {
    if (!n || n.length <= t.length || n.indexOf(t) !== 0) return;
    if (hits.indexOf(n) === -1) hits.push(n);
  });
  return hits.length === 1 ? hits[0] : "";
}

/* 「课程名 + 标题」挤在同一行 */
function prefixCourse(text, courses) {
  const t = String(text || "").trim();
  let best = null;
  (courses || []).forEach(function (name) {
    if (!name || t === name || t.indexOf(name) !== 0) return;
    const rest = t.slice(name.length).replace(/^[\s:：·\-]+/, "").trim();
    if (!rest) return;
    if (!best || name.length > best.course.length) best = { course: name, rest: rest };
  });
  return best;
}

/* 一大段里掺了开场白时，从第一门已知课开始切 */
function buildItem(parts, due, courses) {
  let arr = parts.slice();
  let course = "";
  const head = cleanTitle(arr[0]);

  const exact = exactCourse(head, courses);
  if (exact) {
    course = exact;
    arr = arr.slice(1);
  } else {
    const pref = prefixCourse(head, courses);
    if (pref) {
      course = pref.course;
      arr = [pref.rest].concat(arr.slice(1));
    } else if (arr.length > 2) {
      let at = -1;
      for (let k = 1; k < arr.length; k++) {
        if (exactCourse(cleanTitle(arr[k]), courses)) {
          at = k;
          break;
        }
      }
      if (at > 0) {
        course = cleanTitle(arr[at]);
        arr = arr.slice(at + 1);
      } else {
        course = head;
        arr = arr.slice(1);
      }
    } else {
      course = head;
      arr = arr.slice(1);
    }
  }

  const title = arr
    .map(cleanTitle)
    .filter(function (x) { return x; })
    .join(" ")
    .trim();

  return { course: course, title: title, due: fmtDue(due), known: !!course };
}

/* 时间行前面可能还挤着课程名和标题，切下来继续用 */
function inlineHead(line) {
  const at = line.search(TIME_WORD);
  if (at <= 0) return "";
  const head = line.slice(0, at).trim();
  if (!head) return "";
  /* 纯日期片当前缀不算标题 */
  if (!/[^\d\s\-/.：:月日号，,、]/.test(head)) return "";
  return head;
}

/* ---------- 学习通 App 的课程通知：课程名称 / 作业名称 / 还有 N 小时 ---------- */
const NOTICE_COURSE = /^(?:课程名称|所属课程)\s*[：:]?\s*(.+)$/;
const NOTICE_TITLE = /^(?:作业名称|作业标题|任务名称)\s*[：:]?\s*(.+)$/;
const NOTICE_END = /^(?:结束时间|截止时间|提交截止|到期时间)\s*[：:]?\s*(.+)$/;
const NOTICE_START = /^(?:开始时间|发布时间|开放时间)\s*[：:]?\s*(.+)$/;
/* 截图顶部那行「作业:《课程名》作业名」，字段行没认出来时用它兜底 */
const NOTICE_HEAD = /^作业\s*[：:]?\s*《(.+?)》\s*(.+)$/;
/* 出现这些字样就按通知页处理 */
const NOTICE_HINT = /学习通知|课程通知|作业通知|作业结束提醒/;
const NOTICE_LEFT = /还有\s*(\d+)\s*(个?小时|天|分钟)/;
/* 通知顶上那行时间戳，如 11-12 23:59；有它才能把「还有 72 小时」落到具体时刻。
   截图里常和「学习通知」挤在同一行，所以允许一小段前缀，但带字段名的行要排除 */
const NOTICE_STAMP = /^(.{0,12}?)(?:(\d{4})\s*[-/.年]\s*)?(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*(\d{1,2})\s*[:：]\s*(\d{1,2})\s*$/;
const STAMP_HEAD_BAD = /时间|截止|结束|开始|日期|ddl|deadline/i;
/* 字段值后面常粘着提示语和底部卡片，取到这些字样就截断 */
const HINT_CUT = /你的作业|还有\s*\d|请尽快|评论已关闭|去完成|已完成|作业结束提醒|学习通知/;

function cutHintTail(s) {
  const t = String(s || "");
  const m = t.match(HINT_CUT);
  if (m && m.index > 0) return t.slice(0, m.index).trim();
  return t.trim();
}

function addLeft(base, n, unit) {
  if (!base || !isFinite(n)) return null;
  const step = unit === "天" ? 86400000 : (unit.indexOf("小时") > -1 ? 3600000 : 60000);
  return new Date(base.getTime() + n * step);
}

/* 只留能比对的字符：空格、括号、连接符都不参与比较 */
function courseKey(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()（）\[\]【】·:：\-—_]/g, "");
}

/* 两个字符串差几个字 */
function editDist(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = [];
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

/* 识别偶尔吞掉或多认一个字（数学分析II 认成 数学分析III），
   只差一两字且只有唯一最接近的课程时才认，打平就放弃，不瞎猜 */
function looseCourse(text, courses) {
  const t = courseKey(text);
  if (t.length < 4) return "";
  const cand = [];
  (courses || []).forEach(function (n) {
    const k = courseKey(n);
    if (!k || k === t) return;
    const d = editDist(t, k);
    const maxLen = Math.max(t.length, k.length);
    const allow = maxLen >= 10 ? 2 : 1;
    if (d <= allow) cand.push({ name: n, d: d });
  });
  if (!cand.length) return "";
  cand.sort(function (a, b) { return a.d - b.d; });
  if (cand.length > 1 && cand[0].d === cand[1].d) return "";
  return cand[0].name;
}

/* 通知里的课程名常带专业后缀，能对上本机课程就归一；guess=true 表示靠字错了推出来的 */
function normCourseInfo(raw, courses) {
  const t = String(raw || "").trim();
  if (!t) return { name: "", guess: false };
  const exact = exactCourse(t, courses);
  if (exact) return { name: exact, guess: false };
  const pref = prefixCourse(t, courses);
  if (pref && pref.course) return { name: pref.course, guess: false };
  const loose = looseCourse(t, courses);
  if (loose) return { name: loose, guess: true };
  return { name: t, guess: false };
}

function normCourseName(raw, courses) {
  return normCourseInfo(raw, courses).name;
}

/* 单行解析成通知时间戳；带「时间」这类字样的是字段行，不是通知时间 */
function noticeStampOf(line, now) {
  const m = String(line || "").match(NOTICE_STAMP);
  if (!m) return null;
  const head = (m[1] || "").trim();
  if (STAMP_HEAD_BAD.test(head)) return null;
  const mo = parseInt(m[3], 10);
  const dd = parseInt(m[4], 10);
  const hh = parseInt(m[5], 10);
  const mi = parseInt(m[6], 10);
  if (mo < 1 || mo > 12 || dd < 1 || dd > 31 || hh > 23 || mi > 59) return null;
  let year = m[2] ? parseInt(m[2], 10) : now.getFullYear();
  /* 一月看到「12-20」的通知，是去年发的 */
  if (!m[2] && mo > now.getMonth() + 1) year -= 1;
  const d = new Date(year, mo - 1, dd, hh, mi, 0, 0);
  if (d.getMonth() !== mo - 1 || d.getDate() !== dd) return null;
  return d;
}

function findNoticeStamp(lines, now) {
  for (let i = 0; i < lines.length; i++) {
    const d = noticeStampOf(lines[i], now);
    if (d) return { at: i, date: d };
  }
  return null;
}

/* 把通知块整体抠出来，返回条目和已被消费的行号，剩下的交给通用解析 */
function extractNotices(lines, now, courses) {
  const items = [];
  const consumed = [];
  const stamp = findNoticeStamp(lines, now);
  const base = stamp ? stamp.date : null;
  let cur = null;

  function push() {
    if (!cur) return;
    if (cur.course || cur.title) items.push(cur);
    cur = null;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    const cm = line.match(NOTICE_COURSE);
    if (cm) {
      push();
      cur = { course: normCourseName(cm[1], courses), title: "", due: "", approx: false };
      consumed.push(i);
      continue;
    }

    const tm = line.match(NOTICE_TITLE);
    if (tm) {
      if (!cur) cur = { course: "", title: "", due: "", approx: false };
      cur.title = cleanTitle(tm[1]);
      consumed.push(i);
      continue;
    }

    if (!cur) continue;

    const lm = line.match(NOTICE_LEFT);
    if (lm) {
      const d = addLeft(base || now, parseInt(lm[1], 10), lm[2]);
      if (d) {
        cur.due = fmtDue(d);
        /* 没有通知时间戳时只能从粘贴这一刻往前推，标出来别让人误以为是原文写的 */
        cur.approx = !base;
      }
      consumed.push(i);
      continue;
    }

    if (isTimeLine(line, now)) {
      const dl = deadlineOf(line, now);
      if (dl) {
        cur.due = fmtDue(dl);
        cur.approx = false;
      }
      consumed.push(i);
    }
  }
  push();

  if (items.length) {
    lines.forEach(function (l, i) {
      if (/^学习通知$/.test(l)) consumed.push(i);
    });
    if (stamp) consumed.push(stamp.at);
  }

  return { items: items, consumed: consumed };
}

/* 课程名前的学期前缀：「26-27第一学期 」「26-27-1-」「2026-2027-1-」
   只在有学期字样、或第三段是纯数字、或以横线结尾时才剥，避免吃掉课程真名 */
function stripTermPrefix(name) {
  const t = String(name || "").trim();
  const m = t.match(/^(?:20\d{2}|\d{2})\s*-\s*(?:20\d{2}|\d{2})(?:\s*-\s*\d)?\s*(?:第[一二三四]\s*学期)?\s*[-—－·]?\s*/);
  if (!m || !m[0]) return t;
  const head = m[0];
  const hasTermWord = /第[一二三四]\s*学期/.test(head);
  const hasThird = /(?:20\d{2}|\d{2})\s*-\s*(?:20\d{2}|\d{2})\s*-\s*\d/.test(head);
  const hasDash = /[-—－·]\s*$/.test(head);
  if (!hasTermWord && !hasThird && !hasDash) return t;
  const rest = t.slice(head.length).trim();
  if (rest.length < 2) return t;
  return rest;
}

/* 学习通作业通知页：课程名称 / 作业名称 / 开始时间 / 结束时间 固定分行。
   截图和整段粘贴都走这里，比通用解析稳，也不会把顶部标题和底部卡片当成第二条作业 */
function parseHwNotice(lines, opts) {
  const o = opts || {};
  const now = o.now || new Date();
  const courses = o.courses || [];
  const items = [];
  const ignored = [];
  let base = null;
  let cur = null;
  let headHit = null;

  function empty() {
    return { course: "", title: "", due: "", infer: false, approx: false, guess: false };
  }

  function push() {
    if (!cur) return;
    const c = cur;
    cur = null;
    if (!c.course && !c.title) return;
    items.push(c);
  }

  for (let i = 0; i < lines.length; i++) {
    const line = cleanLine(lines[i]);
    if (!line) continue;

    const st = noticeStampOf(line, now);
    if (st) {
      if (!base) base = st;
      continue;
    }

    const cm = line.match(NOTICE_COURSE);
    if (cm) {
      if (cur && cur.course) push();
      if (!cur) cur = empty();
      const ci = normCourseInfo(stripTermPrefix(cutHintTail(cm[1])), courses);
      cur.course = ci.name;
      cur.guess = ci.guess;
      continue;
    }

    const tm = line.match(NOTICE_TITLE);
    if (tm) {
      if (!cur) cur = empty();
      cur.title = cleanTitle(cutHintTail(tm[1]));
      continue;
    }

    const em = line.match(NOTICE_END);
    if (em) {
      if (!cur) cur = empty();
      const d = firstTime(em[1], now);
      if (d) {
        cur.due = fmtDue(d);
        cur.infer = false;
        cur.approx = false;
      }
      continue;
    }

    /* 开始时间不是交作业的期限，认下来但不用 */
    if (NOTICE_START.test(line)) continue;

    const lm = line.match(NOTICE_LEFT);
    if (lm) {
      if (!cur) cur = empty();
      const d = addLeft(base || now, parseInt(lm[1], 10), lm[2]);
      if (d) {
        cur.due = fmtDue(d);
        cur.infer = true;
        /* 没有通知时间戳时只能从认出这一刻往前推，标出来别当成原文写的 */
        cur.approx = !base;
      }
      continue;
    }

    const hm2 = line.match(NOTICE_HEAD);
    if (hm2) {
      if (!headHit) headHit = { course: stripTermPrefix(hm2[1]), title: cleanTitle(hm2[2]) };
      ignored.push(line);
      continue;
    }

    ignored.push(line);
  }
  push();

  /* 字段行一个都没认到，只有顶部那行标题，至少保住课程和作业名 */
  if (!items.length && headHit && headHit.title) {
    const ci = normCourseInfo(headHit.course, courses);
    items.push({
      course: ci.name,
      guess: ci.guess,
      title: headHit.title,
      due: "",
      infer: false,
      approx: false
    });
  }

  return { items: items, stamp: base, ignored: ignored };
}

/* ---------- 学习通考试通知：考试名称 / 考试时间区间 / 考场 ---------- */
const EXAM_COURSE = /^(?:考试名称|课程名称|所属课程|考试课程)\s*[：:]?\s*(.+)$/;
const EXAM_TIME = /^(?:考试时间|考试日期|开考时间|考试开始时间|截止时间|考试截止时间)\s*[：:]?\s*(.+)$/;
const EXAM_START = /^(?:开始时间|发布时间|开放时间)\s*[：:]?\s*(.+)$/;
const EXAM_PLACE = /^(?:考试地点|考试地址|考场|地点)\s*[：:]?\s*(.+)$/;
const EXAM_HEAD = /^[\[【]?(?:考试通知|考试提醒|考试安排)[\]】]?\s*(.+)?$/;

/* 字段关键词：长词排前面，避免「开始时间」先把「考试开始时间」切断 */
const EXAM_FIELD_KEYS = [
  "考试截止时间", "考试名称", "课程名称", "所属课程", "考试课程",
  "考试时间", "考试日期", "开考时间", "考试开始时间", "截止时间",
  "开始时间", "发布时间", "开放时间",
  "考试地点", "考试地址", "考场", "地点",
  "姓名", "学号", "答题时长", "考试时长", "本试卷", "考试说明", "考试须知",
  "我已阅读", "考试尚未开始", "开始考试"
];
const EXAM_FIELD_RE = new RegExp("(" + EXAM_FIELD_KEYS.join("|") + ")", "g");

/* 标题兜底要排除的噪声：字段行、时间日期片、空态提示、按钮、纯导航词 */
const EXAM_TITLE_NOISE = /(姓名|学号|开始时间|截止时间|考试时间|考试日期|开考时间|考试开始时间|考试地点|考试地址|考场|地点|答题时长|考试时长|本试卷|考试说明|考试须知|我已阅读|考试尚未开始|开始考试|考试通知|考试提醒|考试安排|\d{1,2}\s*[-/月]\s*\d{1,2}|\d{1,2}\s*[:：]\s*\d{1,2})/;
const EXAM_TITLE_BARE = /^考试(详情|页面|通知|提醒|安排)?$/;

function examFieldType(key) {
  if (/考试名称|课程名称|所属课程|考试课程/.test(key)) return "course";
  if (/考试截止时间|考试时间|考试日期|开考时间|考试开始时间|截止时间/.test(key)) return "due";
  if (/开始时间|发布时间|开放时间/.test(key)) return "start";
  if (/考试地点|考试地址|考场|地点/.test(key)) return "place";
  return "drop";
}

/* 把粘连一长串按字段关键词切成片段；OCR 常丢掉换行和冒号，行首正则认不出，这里按词切回 */
function splitExamSegments(text) {
  const re = new RegExp(EXAM_FIELD_RE.source, "g");
  const hits = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    hits.push({ key: m[0], index: m.index, end: re.lastIndex });
  }
  const segs = [];
  hits.forEach(function (h, i) {
    const next = hits[i + 1];
    segs.push({
      type: examFieldType(h.key),
      key: h.key,
      value: String(text || "").slice(h.end, next ? next.index : String(text || "").length)
    });
  });
  return segs;
}

/* 从「2026-11-20 14:00-16:00」「10-29 00:00 至 2027-01-15 23:59」里取截止右端点 */
function examAt(raw, now) {
  const s = String(raw || "");
  const base = now || new Date();
  let date = "";
  let time = "";

  const dateRe = /(\d{4}\s*[-/.年]\s*)?(\d{1,2})\s*[-/.月]\s*(\d{1,2})/g;
  const dateHits = [];
  let dm;
  while ((dm = dateRe.exec(s)) !== null) dateHits.push(dm);
  if (dateHits.length) {
    const hit = dateHits[dateHits.length - 1];
    const mo = parseInt(hit[2], 10);
    const dd = parseInt(hit[3], 10);
    if (mo >= 1 && mo <= 12 && dd >= 1 && dd <= 31) {
      let year = hit[1] ? parseInt(hit[1], 10) : base.getFullYear();
      if (!hit[1] && mo - (base.getMonth() + 1) > 6) year += 1;
      date = year + "-" + pad2(mo) + "-" + pad2(dd);
    }
  }
  if (!date) {
    const md = s.match(/(\d{1,2})\s*[-/月]\s*(\d{1,2})/);
    if (md) {
      const mo = parseInt(md[1], 10);
      const dd = parseInt(md[2], 10);
      if (mo >= 1 && mo <= 12 && dd >= 1 && dd <= 31) {
        date = base.getFullYear() + "-" + pad2(mo) + "-" + pad2(dd);
      }
    }
  }

  const timeRe = /(\d{1,2})\s*[:：]\s*(\d{1,2})/g;
  const timeHits = [];
  let tm;
  while ((tm = timeRe.exec(s)) !== null) timeHits.push(tm);
  if (timeHits.length) {
    const hit = timeHits[timeHits.length - 1];
    const hh = parseInt(hit[1], 10);
    const mi = parseInt(hit[2], 10);
    if (hh >= 0 && hh <= 23 && mi >= 0 && mi <= 59) time = pad2(hh) + ":" + pad2(mi);
  }
  return { date: date, time: time };
}

/* 考试通知多半一门课一场，字段行认清就够了，不用推算
   兼容两种输入：规整分行的通知页，以及 OCR 把字段挤成一行、丢掉冒号的粘连文本 */
function parseExamNotice(lines, opts) {
  const o = opts || {};
  const now = o.now || new Date();
  const courses = o.courses || [];
  const items = [];
  const ignored = [];
  let cur = null;

  function empty() {
    return { course: "", guess: false, date: "", time: "", place: "", dueRaw: "" };
  }
  function filled() {
    return !!(cur && (cur.course || cur.date || cur.place || cur.dueRaw));
  }
  function push() {
    if (!cur) return;
    if (cur.dueRaw) {
      const at = examAt(cur.dueRaw, now);
      if (at.date) cur.date = at.date;
      if (at.time) cur.time = at.time;
    }
    if (!cur.course && titleCandidates.length) {
      cur.course = titleCandidates.shift();
    }
    if (!cur.course && !cur.date && !cur.place) { cur = null; return; }
    delete cur.dueRaw;
    items.push(cur);
    cur = null;
  }

  const rawLines = (lines || []).map(function (l) { return cleanLine(l); }).filter(function (l) { return l; });

  /* 课程名只在「考试名称」字段里拿；学习通空态页把课名放在导航栏标题，正文没有字段，
     这时从干净的独立标题行兜底。含字段词、日期时间片、空态提示、按钮的行都排除 */
  const titleCandidates = [];
  rawLines.forEach(function (l) {
    if (EXAM_FIELD_RE.test(l) || EXAM_TITLE_NOISE.test(l)) return;
    if (EXAM_TITLE_BARE.test(l)) return;
    const t = stripTermPrefix(cutHintTail(l)).trim();
    if (t.length < 2 || t.length > 30) return;
    titleCandidates.push(t);
  });

  const text = rawLines.join(" ");

  /* 粘连态：第一个字段关键词之前的前缀通常就是导航栏标题，一并作为兜底候选 */
  const headRe = new RegExp(EXAM_FIELD_RE.source);
  const headHit = headRe.exec(text);
  if (headHit && headHit.index > 0) {
    const prefix = String(text).slice(0, headHit.index).replace(/^[^\u4e00-\u9fa5A-Za-z0-9·]+/, "").trim();
    if (prefix && !EXAM_TITLE_NOISE.test(prefix) && !EXAM_TITLE_BARE.test(prefix) && prefix.length >= 2 && prefix.length <= 30) {
      titleCandidates.unshift(prefix);
    }
  }

  splitExamSegments(text).forEach(function (seg) {
    const v = String(seg.value || "").replace(/^[：:\s]+/, "").trim();

    if (seg.type === "course") {
      if (filled()) push();
      if (!cur) cur = empty();
      const ci = normCourseInfo(stripTermPrefix(cutHintTail(v)), courses);
      cur.course = ci.name;
      cur.guess = ci.guess;
      return;
    }

    if (seg.type === "due") {
      if (!cur) cur = empty();
      cur.dueRaw = (cur.dueRaw ? cur.dueRaw + " " : "") + v;
      return;
    }

    /* 开始时间不是截止时间，认下来但不用 */
    if (seg.type === "start") return;

    if (seg.type === "place") {
      if (!cur) cur = empty();
      cur.place = cutHintTail(v).trim();
      return;
    }

    /* 姓名学号、时长、题量、说明都不构成条目；粘连态下日期可能被时长片段带着，
       片段里若夹着日期片，仍并入截止口径，别丢掉 */
    if (cur && /\d{1,2}\s*[-/月]\s*\d{1,2}/.test(v)) {
      cur.dueRaw = (cur.dueRaw ? cur.dueRaw + " " : "") + v;
    } else if (v) {
      ignored.push(v);
    }
  });

  push();
  return { items: items, ignored: ignored };
}

/* 解析老师发的作业文本，返回可入库的作业条目
   opts: { now, courses } —— courses 是本机已有课程名，用来拆「课程名 + 标题」同一行的情况 */function parseHwText(text, opts) {
  const o = opts || {};
  const now = o.now || new Date();
  const courses = o.courses || [];
  const items = [];
  const skipped = [];

  const rawLines = String(text || "").replace(/\r/g, "").split("\n").map(cleanLine);

  /* 学习通通知页字段齐整，先走专用解析；一条都认不出再退回通用拆句 */
  const looksNotice = NOTICE_HINT.test(String(text || "")) ||
    rawLines.some(function (l) { return NOTICE_COURSE.test(l) || NOTICE_END.test(l); });
  if (looksNotice) {
    const n = parseHwNotice(rawLines, o);
    if (n.items.length) return { items: n.items, skipped: [] };
  }

  const notice = extractNotices(rawLines, now, courses);
  const lines = rawLines.filter(function (_, i) { return notice.consumed.indexOf(i) === -1; });

  let buf = [];

  function flush(due, tail) {
    if (!buf.length) return;
    const parts = buf.slice();
    buf = [];

    let item;
    if (parts.length === 1) {
      const one = cleanTitle(parts[0]);
      const exact = exactCourse(one, courses);
      if (exact) {
        item = {
          course: exact,
          title: due ? "作业 " + pad(due.getMonth() + 1) + "-" + pad(due.getDate()) : "作业",
          due: fmtDue(due),
          known: true
        };
      } else {
        /* 「数学分析 17.3-17.4」挤成一行时，第一个空格前当课程 */
        const sp = one.search(/\s+/);
        if (sp > 1) {
          const c = one.slice(0, sp).trim();
          const t = one.slice(sp).trim();
          item = { course: c, title: t, due: fmtDue(due), known: true };
        } else {
          item = { course: "", title: one, due: fmtDue(due), known: false };
        }
      }
    } else {
      item = buildItem(parts, due, courses);
      if (!item.title && !due) {
        item.title = "";
      }
    }

    /* 文末残留的一段既没有时间、也没认出课程，多半是「收到请回复」这类话 */
    if (tail && !due && !item.known) {
      skipped.push(parts.join(" "));
      return;
    }

    if (!item.title) {
      if (item.known) {
        item.title = due ? "作业 " + pad(due.getMonth() + 1) + "-" + pad(due.getDate()) : "作业";
      } else {
        skipped.push(parts.join(" "));
        return;
      }
    }

    items.push({ course: item.course, title: item.title, due: item.due });
  }

  lines.forEach(function (raw) {
    const line = cleanLine(raw);
    if (!line) return;

    if (isTimeLine(line, now)) {
      const head = inlineHead(line);
      if (head) buf.push(head);
      flush(deadlineOf(line, now), false);
      return;
    }

    /* 「1、数学分析 / 习题5.2 / 2、大学物理B / 实验报告」这种编号清单，
       编号后面是另一门已知课就切一刀，别把两门并成一条 */
    if (buf.length >= 2 && /^[①-⑩]|^\d{1,2}\s*[、)）]/.test(line) &&
        exactCourse(cleanTitle(line), courses)) {
      flush(null, false);
    }

    buf.push(line);
    /* 攒太多行还没碰到时间，说明这段不是作业格式，别越滚越大 */
    if (buf.length > 6) {
      skipped.push(buf.join(" "));
      buf = [];
    }
  });
  flush(null, true);

  return { items: notice.items.concat(items), skipped: skipped };
}

/* 解析粘贴进来的考试详情文本：一段里可能连着几场，逐场返回课程 / 截止日期时间 / 考场 */
function parseExamText(text, opts) {
  const o = opts || {};
  const rawLines = String(text || "").replace(/\r/g, "").split("\n").map(cleanLine);
  const n = parseExamNotice(rawLines, o);
  return { items: n.items, ignored: n.ignored || [] };
}

module.exports = {
  pad2: pad2,
  parseDue: parseDue,
  daysBetween: daysBetween,
  dueMeta: dueMeta,
  sortOpen: sortOpen,
  groupOpenByDate: groupOpenByDate,
  summarize: summarize,
  splitByDone: splitByDone,
  upcomingExams: upcomingExams,
  examCountdown: examCountdown,
  fmtExamStamp: fmtExamStamp,
  fmtExamTime: fmtExamTime,
  datePart: datePart,
  timePart: timePart,
  joinDateTime: joinDateTime,
  parseHwText: parseHwText,
  parseHwNotice: parseHwNotice,
  parseExamNotice: parseExamNotice,
  parseExamText: parseExamText,
  examAt: examAt,
  stripTermPrefix: stripTermPrefix,
  normCourseInfo: normCourseInfo,
  looseCourse: looseCourse
};
