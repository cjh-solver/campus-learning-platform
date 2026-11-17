const storage = require("./utils/storage");
const feedback = require("./utils/feedback");

function currentRoute() {
  try {
    const pages = getCurrentPages();
    const p = pages[pages.length - 1];
    return (p && (p.route || p.__route__)) || "";
  } catch (e) {
    return "";
  }
}

function errLine(err) {
  const raw = err && (err.message || err.errMsg || String(err));
  const s = String(raw || "未知错误").replace(/\s+/g, " ").trim();
  return s.length > 140 ? s.slice(0, 140) + "…" : s;
}

/* 从聊天里长按文件选「用课表随行打开」时，微信把文件路径放在 forwardMaterials 里 */
function pickMaterial(options) {
  const arr = options && options.forwardMaterials;
  if (!Array.isArray(arr) || !arr.length) return null;
  for (let i = 0; i < arr.length; i++) {
    const f = arr[i];
    if (f && f.path) {
      return { name: f.name || "课表文件", path: f.path, size: f.size || 0 };
    }
  }
  return null;
}

App({
  globalData: {
    state: null,
    fileOpen: null
  },

  onLaunch(options) {
    try {
      this.globalData.state = storage.loadState();
    } catch (e) {
      feedback.report(e, "启动读取本机数据");
    }
    const m = pickMaterial(options);
    if (m) this.globalData.fileOpen = m;
  },

  onShow(options) {
    const m = pickMaterial(options);
    if (m) this.globalData.fileOpen = m;
  },

  /* 兜底：任何未捕获的错误都落成一句人话，并带上真实原因和出错页面，方便定位 */
  onError(err) {
    console.error("[app onError]", err);
    const route = currentRoute();
    try {
      wx.showModal({
        title: "小程序遇到问题",
        content: errLine(err) + (route ? "\n页面：" + route : "") + "\n回到上一页重来一次；反复出现就重启小程序。",
        showCancel: false
      });
    } catch (e) {}
  },

  onUnhandledRejection(res) {
    const reason = res && res.reason;
    console.error("[app rejection]", reason);
    const route = currentRoute();
    try {
      wx.showModal({
        title: "有一步没完成",
        content: errLine(reason) + (route ? "\n页面：" + route : "") + "\n重新点一次试试。",
        showCancel: false
      });
    } catch (e) {}
  }
});
