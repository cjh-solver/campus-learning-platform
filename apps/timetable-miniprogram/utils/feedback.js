/* 统一提示层：短消息用 toast，长消息与错误用 modal
   约定：每个动作闭环——成功给一句，失败给原因和下一步 */

const DONE_PREFIX = "✓ ";

function tip(msg, duration) {
  if (!msg) return;
  wx.showToast({ title: String(msg), icon: "none", duration: duration || 1800 });
}

function ok(msg) {
  if (!msg) return;
  wx.showToast({ title: DONE_PREFIX + String(msg), icon: "none", duration: 1600 });
}

function fail(title, content) {
  wx.showModal({
    title: title || "没成功",
    content: content || "再试一次。连续失败就回上一页重进。",
    showCancel: false,
    confirmText: "知道了"
  });
}

/* 兜底：包一层同步异常，保证不会静默 */
function guard(fn, label) {
  return function () {
    try {
      return fn.apply(this, arguments);
    } catch (e) {
      report(e, label);
    }
  };
}

function report(err, label) {
  const msg = (err && (err.message || err.errMsg)) || "未知错误";
  console.error("[feedback]", label || "", err);
  fail(label ? label + "失败" : "出错了", msg);
}

/* 触感反馈：关键操作用轻振，失败静默降级，不打断流程 */
function haptic(type) {
  try {
    if (typeof wx !== "undefined" && typeof wx.vibrateShort === "function") {
      wx.vibrateShort({ type: type === "medium" ? "medium" : "light", fail: function () {} });
    }
  } catch (e) {}
}

module.exports = {
  tip: tip,
  ok: ok,
  fail: fail,
  guard: guard,
  report: report,
  haptic: haptic
};
