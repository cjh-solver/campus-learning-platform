/* 番茄钟：模式时长、时间格式化、轮换规则，纯函数便于核对 */

const MODES = {
  focus: { label: "专注", sec: 25 * 60 },
  short: { label: "短休", sec: 5 * 60 },
  long: { label: "长休", sec: 15 * 60 }
};

const MODE_KEYS = ["focus", "short", "long"];

function pad(n) {
  return String(n).padStart(2, "0");
}

/* 剩余秒数转 mm:ss，向上取整，避免最后一秒提前跳到 00:00 */
function fmtClock(totalSec) {
  const s = Math.max(0, Math.ceil(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return pad(m) + ":" + pad(r);
}

/* 本地日期键，统计按天清零 */
function todayKey() {
  const d = new Date();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  return d.getFullYear() + "-" + m + "-" + day;
}

/* 一轮结束后下一段进哪个模式：四个专注后长休，其余短休；休息结束回专注 */
function nextMode(mode, focusCount) {
  if (mode !== "focus") return "focus";
  return focusCount > 0 && focusCount % 4 === 0 ? "long" : "short";
}

module.exports = {
  MODES: MODES,
  MODE_KEYS: MODE_KEYS,
  pad: pad,
  fmtClock: fmtClock,
  todayKey: todayKey,
  nextMode: nextMode
};
