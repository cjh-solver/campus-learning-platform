/* VisionKit 静态图 OCR 封装（端侧识别，图片不出手机）
   门槛：基础库 2.27.0 起才有 wx.createVKSession + runOCR；离屏 canvas 2d 用于取像素
   流程：选图 → 读到像素 → 缩到合适尺寸 → 画进 canvas → getImageData → runOCR → anchors */

/* 送进 OCR 的最长边。普通截图按原图尺寸送（对齐官方示例，不主动压缩）；
   长边超过上限才缩。快档 1280，认不到字再抬到 1600 重跑一次 */
const MAX_EDGE = 1280;
const PRECISE_EDGE = 1600;

/* anchors 少于这个数就当没认出东西，值得抬精度重试 */
const RETRY_MIN_ANCHORS = 3;

/* 最多一次选几张，chooseMedia 上限是 9，多了没意义还等更久 */
const MAX_BATCH = 5;

/* 读图与识别分开计时：长截图解码慢，识别引擎冷启动更慢，共用一个 8 秒必然误判超时 */
const FRAME_TIMEOUT = 12000;
const INFO_TIMEOUT = 6000;
const OCR_TIMEOUT = 12000;

/* 真机上偶发一张慢，不代表会话坏了。连续两次超时才重建，避免把好不容易热起来的会话扔掉 */
const TIMEOUT_LIMIT = 2;
let timeoutStreak = 0;

/* 识别会话建一次就一直用：初始化本身最贵，每张图重建等于每次都从头再来 */
let shared = null;
let pending = null;
let pendingTimer = null;

/* 离屏画布按尺寸复用，连着识别几张图时省掉重复创建 */
let canvasCache = null;
let canvasKey = "";

/* 页面里自己放一块 2d canvas 交给这里绘制。部分安卓机上离屏 canvas 画完
   getImageData 拿回来全是 0，OCR 无字可认就永远不回调，表现成超时 */
const CANVAS_SIDE = 1600;
let userCanvas = null;

/* 官方静态图示例创建会话时绑定了 WebGLRenderingContext。文档标注可选，
   但示例实测都传；这里懒建一块离屏 webgl canvas 取上下文一并传入 */
let glCanvas = null;
let glContext = null;
function getGlContext() {
  if (glContext) return glContext;
  try {
    glCanvas = wx.createOffscreenCanvas({ type: "webgl", width: 300, height: 150 });
    const gl = glCanvas.getContext("webgl");
    if (gl && typeof gl.getParameter === "function") glContext = gl;
  } catch (e) {
    glContext = null;
  }
  return glContext || undefined;
}

function getCanvas(w, h) {
  const key = w + "x" + h;
  if (canvasCache && canvasKey === key && typeof canvasCache.getContext === "function") {
    return canvasCache;
  }
  canvasCache = wx.createOffscreenCanvas({ type: "2d", width: w, height: h });
  canvasKey = key;
  return canvasCache;
}

/* 页面把 canvas node 交进来，优先用它绘制，它比离屏的可靠 */
function setCanvas(node) {
  if (!node || typeof node.getContext !== "function") {
    userCanvas = null;
    return;
  }
  try {
    /* 尺寸固定一次，之后绝不再改：改宽高会清空画布，还得等一帧重渲染 */
    node.width = CANVAS_SIDE;
    node.height = CANVAS_SIDE;
  } catch (e) {
    userCanvas = null;
    return;
  }
  userCanvas = node;
}

function getSurface(w, h) {
  if (userCanvas && w <= CANVAS_SIDE && h <= CANVAS_SIDE) return userCanvas;
  return getCanvas(w, h);
}

/* 画完图取回来的像素如果全是透明的，说明根本没画上去，
   这时候送进 OCR 也认不出字，只会一直等不到回调 */
function looksBlank(data) {
  if (!data || !data.length) return true;
  const step = Math.max(4, (Math.floor(data.length / 4 / 96) || 1) * 4);
  for (let i = 3; i < data.length; i += step) {
    if (data[i] !== 0) return false;
  }
  return true;
}

function otsuThreshold(hist, total) {
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let wB = 0, sumB = 0, best = -1, thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thr = t; }
  }
  return thr;
}

/* 成绩截图是蓝底白字：文字比背景亮，常规暗文字检测找不到笔画。
   灰度化后按 Otsu 阈值二值化，亮部（白字）压黑、暗部（蓝底）抬白，
   变成标准白底黑字。仅成绩页开启，作业白底深字图不做这步 */
function binarizeLightText(data, w, h) {
  const total = w * h;
  const hist = new Array(256).fill(0);
  for (let i = 0; i < data.length; i += 4) {
    const g = Math.min(255, Math.round((data[i] * 3 + data[i + 1] * 6 + data[i + 2]) / 10));
    hist[g]++;
  }
  const thr = otsuThreshold(hist, total);
  for (let i = 0; i < data.length; i += 4) {
    const g = Math.min(255, Math.round((data[i] * 3 + data[i + 1] * 6 + data[i + 2]) / 10));
    const v = g > thr ? 0 : 255;
    data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
  }
  return thr;
}

/* 收掉会话，下次用的时候重新建 */
function abort() {
  const s = shared;
  shared = null;
  pending = null;
  timeoutStreak = 0;
  if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
  if (!s) return;
  try { if (typeof s.stop === "function") s.stop(); } catch (e) {}
  try { if (typeof s.destroy === "function") s.destroy(); } catch (e) {}
}

function supported() {
  return typeof wx !== "undefined" && typeof wx.createVKSession === "function";
}

function isCancel(e) {
  return !!(e && e.errMsg && String(e.errMsg).indexOf("cancel") > -1);
}

/* 选一张图；用户取消时给 CANCEL，页面据此不弹错 */
function pickImage(onOk, onErr) {
  if (!wx || !wx.chooseMedia) {
    if (wx && wx.chooseImage) {
      wx.chooseImage({
        count: 1,
        sizeType: ["original"],
        sourceType: ["album", "camera"],
        success: function (r) {
          const p = (r.tempFilePaths || [])[0];
          if (!p) { onErr({ code: "PICK" }); return; }
          onOk(p);
        },
        fail: function (e) { onErr({ code: isCancel(e) ? "CANCEL" : "PICK" }); }
      });
      return;
    }
    onErr({ code: "PICK" });
    return;
  }
  wx.chooseMedia({
    count: 1,
    mediaType: ["image"],
    sizeType: ["original"],
    sourceType: ["album", "camera"],
    success: function (r) {
      const f = (r.tempFiles || [])[0];
      if (!f || !f.tempFilePath) { onErr({ code: "PICK" }); return; }
      onOk(f.tempFilePath);
    },
    fail: function (e) { onErr({ code: isCancel(e) ? "CANCEL" : "PICK" }); }
  });
}

/* 一次选多张；返回路径数组 */
function pickImages(count, onOk, onErr) {
  const n = Math.max(1, Math.min(MAX_BATCH, Number(count) || 1));
  const back = function (paths) {
    if (!paths.length) { onErr({ code: "PICK" }); return; }
    onOk(paths);
  };
  if (!wx || !wx.chooseMedia) {
    if (wx && wx.chooseImage) {
      wx.chooseImage({
        count: n,
        sizeType: ["original"],
        sourceType: ["album", "camera"],
        success: function (r) {
          back(((r && r.tempFilePaths) || []).filter(Boolean));
        },
        fail: function (e) { onErr({ code: isCancel(e) ? "CANCEL" : "PICK" }); }
      });
      return;
    }
    onErr({ code: "PICK" });
    return;
  }
  wx.chooseMedia({
    count: n,
    mediaType: ["image"],
    sizeType: ["original"],
    sourceType: ["album", "camera"],
    success: function (r) {
      back(((r && r.tempFiles) || []).map(function (f) {
        if (f && f.size) console.log("[ocr] 选图 " + f.size + "B");
        return f && f.tempFilePath;
      }).filter(Boolean));
    },
    fail: function (e) { onErr({ code: isCancel(e) ? "CANCEL" : "PICK" }); }
  });
}

/* 图片路径 → RGBA ArrayBuffer（OCR 要的就是这个，不是路径）
   读信息和解码分开计时，卡在哪一段能直接从报错码看出来 */
function imageToFrame(path, onOk, onErr, maxEdge, opts) {
  let settled = false;
  let infoTimer = null;
  let loadTimer = null;
  const target = Number(maxEdge) > 0 ? Number(maxEdge) : MAX_EDGE;
  const options = opts || {};
  const clear = function () {
    if (infoTimer) { clearTimeout(infoTimer); infoTimer = null; }
    if (loadTimer) { clearTimeout(loadTimer); loadTimer = null; }
  };
  const finish = function (fn, arg) {
    if (settled) return;
    settled = true;
    clear();
    fn(arg);
  };
  const bad = function (code, msg) { finish(onErr, { code: code, msg: msg }); };

  infoTimer = setTimeout(function () { bad("INFO", "读取图片信息超时"); }, INFO_TIMEOUT);

  wx.getImageInfo({
    src: path,
    success: function (info) {
      clearTimeout(infoTimer);
      infoTimer = null;
      const iw = Number(info.width || info.originalWidth || 0);
      const ih = Number(info.height || info.originalHeight || 0);
      if (!isFinite(iw) || !isFinite(ih) || iw <= 0 || ih <= 0) {
        bad("SIZE");
        return;
      }
      console.log("[ocr] 图片信息 " + iw + "x" + ih);
      /* 小图也要放大到目标长边：聊天转存图常只有 960 长边，字高 15px 上下，
         端侧检测器在这个尺寸上直接漏检。插值补不出细节，但能让检测窗口在正常尺寸上工作 */
      const longEdge = Math.max(iw, ih);
      let scale = target / longEdge;
      if (scale > 2.5) scale = 2.5;
      const w = Math.max(1, Math.round(iw * scale));
      const h = Math.max(1, Math.round(ih * scale));
      if (scale > 1) console.log("[ocr] 小图放大 " + scale.toFixed(2) + "x");
      let canvas = null;
      try {
        canvas = getSurface(w, h);
      } catch (e) {
        bad("CANVAS", String((e && e.message) || e));
        return;
      }
      if (!canvas || typeof canvas.getContext !== "function") {
        bad("CANVAS");
        return;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx || typeof ctx.drawImage !== "function" || typeof ctx.getImageData !== "function") {
        bad("CANVAS2D");
        return;
      }
      /* 每次新建图片对象：复用同一个对象换 src，部分机型 onload 不再触发，表现成读图超时 */
      let decodeRetried = false;
      const retryOrBad = function (code, msg) {
        clearTimeout(loadTimer);
        loadTimer = null;
        if (!decodeRetried) {
          decodeRetried = true;
          console.log("[ocr] 解码未回调，换图片对象重试一次");
          loadImage();
          return;
        }
        bad(code, msg);
      };
      const loadImage = function () {
        const img = canvas.createImage();
        if (!img || typeof img !== "object") {
          bad("CANVAS2D", "拿不到画布里的 image");
          return;
        }
        loadTimer = setTimeout(function () { retryOrBad("LOAD", "图片解码超时"); }, Math.max(3000, FRAME_TIMEOUT - INFO_TIMEOUT));
        img.onload = function () {
          clearTimeout(loadTimer);
          loadTimer = null;
          try {
            /* 复用画布时先清掉上一张的残留，避免旧像素混进当前帧 */
            if (typeof ctx.clearRect === "function") ctx.clearRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);
            const shot = ctx.getImageData(0, 0, w, h);
            if (!shot || !shot.data || !shot.data.length) {
              bad("PIXEL");
              return;
            }
            if (looksBlank(shot.data)) {
              bad("BLANK", "画到画布上的图是空白的");
              return;
            }
            if (options.preprocess) {
              const thr = binarizeLightText(shot.data, w, h);
              console.log("[ocr] 成绩版式二值化 阈值" + thr);
            }
            /* 复用页面画布时，底层 buffer 可能是整块大画布的复用视图，
               长度不等于 w*h*4。引擎按 width*height*4 校验帧，长度对不上会静默不回调。
               这里复制一份从 0 开始、长度精确的 ArrayBuffer，对齐官方离屏全幅语义 */
            const len = w * h * 4;
            const src = shot.data;
            const buf = new ArrayBuffer(len);
            new Uint8ClampedArray(buf).set(src.subarray(0, len));
            /* 抽样统计明暗：反色版式（浅底浅字/深底深字）在 console 能直接看出来 */
            let dark = 0, sum = 0, n = 0;
            for (let i = 0; i < len; i += 16) {
              const g = (src[i] * 3 + src[i + 1] * 6 + src[i + 2]) / 10;
              sum += g; n++;
              if (g < 128) dark++;
            }
            const avg = n ? Math.round(sum / n) : 0;
            const darkRatio = n ? Math.round(dark / n * 100) : 0;
            console.log("[ocr] 解码完成 " + w + "x" + h + " buffer" + buf.byteLength +
              " 暗像素" + dark + "/" + n + " 均亮" + avg);
            finish(onOk, { buffer: buf, width: w, height: h, avg: avg, darkRatio: darkRatio });
          } catch (e2) {
            bad("PIXEL", String((e2 && e2.message) || e2));
          }
        };
        img.onerror = function () { retryOrBad("LOAD", "图片解不开"); };
        try {
          img.src = path;
        } catch (e3) {
          retryOrBad("LOAD", String((e3 && e3.message) || e3));
        }
      };
      loadImage();
    },
    fail: function () {
      clearTimeout(infoTimer);
      infoTimer = null;
      bad("INFO");
    }
  });
}

/* 会话建一次就一直用：start 只做一次，之后每张图只调 runOCR
   官方口径：静态图模式下每调一次 runOCR 触发一次 updateAnchors */
function boot(onOk, onErr) {
  if (shared) { onOk(shared); return; }
  let s = null;
  try {
    const params = { track: { OCR: { mode: 2 } }, version: "v1" };
    const gl = getGlContext();
    if (gl) params.gl = gl;
    s = wx.createVKSession(params);
  } catch (e) {
    onErr({ code: "INIT", msg: String((e && (e.errMsg || e.message)) || e) });
    return;
  }
  if (!s) { onErr({ code: "INIT" }); return; }

  try {
    s.on("updateAnchors", function (anchors) {
      const p = pending;
      pending = null;
      if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
      timeoutStreak = 0;
      if (!p) return;
      const mapped = (anchors || []).map(function (a) {
        return { text: String((a && a.text) || ""), anchor: a };
      });
      /* 临时诊断：dump anchor 数量、坐标与文字片段，定位解析分组依据 */
      console.log("[ocr] anchors=" + mapped.length);
      mapped.slice(0, 30).forEach(function (a, i) {
        const box = a.anchor && (a.anchor.box || a.anchor.points || a.anchor.origin);
        console.log("[ocr] #" + i + " box=" + (box ? JSON.stringify(box) : "none") + " text=" + a.text.slice(0, 50));
      });
      p.ok(mapped);
    });
  } catch (e) {
    try { if (typeof s.destroy === "function") s.destroy(); } catch (e2) {}
    onErr({ code: "ON", msg: String((e && e.message) || e) });
    return;
  }

  s.start(function (res) {
    /* 有的机型回调给 errno 数字，有的给对象 */
    const errno = res && typeof res === "object" ? res.errno : res;
    if (errno) {
      try { if (typeof s.destroy === "function") s.destroy(); } catch (e) {}
      onErr({ code: "START", msg: "errno " + errno });
      return;
    }
    shared = s;
    onOk(s);
  });
}

/* 跑一张图：会话复用，只换 frameBuffer */
function runOcr(frame, onOk, onErr) {
  if (!supported()) {
    onErr({ code: "UNSUPPORT" });
    return;
  }
  boot(function (s) {
    pending = { ok: onOk, bad: onErr };
    pendingTimer = setTimeout(function () {
      const p = pending;
      pending = null;
      pendingTimer = null;
      timeoutStreak += 1;
      /* 连续超时说明会话确实不行了才重建，单张慢一次不该让下次更慢 */
      if (timeoutStreak >= TIMEOUT_LIMIT) abort();
      if (p) p.bad({ code: "TIMEOUT" });
    }, OCR_TIMEOUT);

    try {
      s.runOCR({ frameBuffer: frame.buffer, width: frame.width, height: frame.height });
    } catch (e) {
      const p = pending;
      pending = null;
      if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
      if (p) p.bad({ code: "RUN", msg: String((e && e.message) || e) });
    }
  }, onErr);
}

/* 一步识别：返回 { anchors, width, height }
   onStage("frame"|"ocr") 让页面能显示卡在哪一步，原生层卡住时至少知道停在哪 */
function recognize(onOk, onErr, onStage, opts) {
  recognizeMany(function (r) {
    if (!r.shots.length) { onErr({ code: "PICK" }); return; }
    onOk(r.shots[0]);
  }, onErr, onStage, 1, opts);
}

/* 多图识别：一次选 count 张，按顺序一张张跑，结果一起回
   onStage(phase, index, total)  phase: frame | ocr | done */
function recognizeMany(onOk, onErr, onStage, count, opts) {
  const stage = typeof onStage === "function" ? onStage : function () {};
  if (!supported()) {
    onErr({ code: "UNSUPPORT" });
    return;
  }
  pickImages(count || 1, function (paths) {
    const shots = [];
    const total = paths.length;
    let at = 0;
    const stop = function (err) {
      console.log("[ocr] 识别失败 code=" + err.code + " msg=" + (err.msg || "") + " 第" + (at + 1) + "/" + total +
        " 帧" + err.frameW + "x" + err.frameH + " 缓冲" + err.bufferLen + "B 读图" + err.frameMs + "ms");
      onErr({ code: err.code, msg: err.msg, index: at, total: total, frameW: err.frameW, frameH: err.frameH, frameMs: err.frameMs, bufferLen: err.bufferLen, avg: err.avg, darkRatio: err.darkRatio });
    };
    const next = function () {
      if (at >= total) {
        stage("done", at, total);
        onOk({ shots: shots });
        return;
      }
      const idx = at;
      const path = paths[idx];
      /* 先用快档，认到的字太少再抬精度重跑同一张；每张最多重试一次 */
      const attempt = function (edge, canRetry, canRebuild) {
        const t0 = Date.now();
        stage("frame", idx, total);
        imageToFrame(path, function (frame) {
          const tFrame = Date.now();
          stage("ocr", idx, total);
          runOcr(frame, function (anchors) {
            const got = (anchors || []).filter(function (a) { return a && a.text; }).length;
            console.log("[ocr] 第" + (idx + 1) + "张 " + frame.width + "x" + frame.height +
              " 读图" + (tFrame - t0) + "ms 识别" + (Date.now() - tFrame) + "ms 共" + (Date.now() - t0) + "ms");
            if (canRetry && got < RETRY_MIN_ANCHORS && edge < PRECISE_EDGE) {
              attempt(PRECISE_EDGE, false, false);
              return;
            }
            shots.push({ anchors: anchors, width: frame.width, height: frame.height, index: idx });
            at++;
            next();
          }, function (err) {
            const diag = { frameW: frame.width, frameH: frame.height, frameMs: tFrame - t0, bufferLen: frame.buffer && frame.buffer.byteLength, avg: frame.avg, darkRatio: frame.darkRatio };
            /* 会话可能已经失效，扔掉换新的，同一张再跑一次 */
            if (canRebuild && err && err.code === "TIMEOUT") {
              console.log("[ocr] 第" + (idx + 1) + "张识别超时，重建会话重试");
              abort();
              attempt(edge, canRetry, false);
              return;
            }
            stop(Object.assign({}, err, diag));
          });
        }, stop, edge, opts);
      };
      attempt(MAX_EDGE, true, true);
    };
    next();
  }, onErr);
}

/* 失败码翻人话，页面直接拿去提示 */
function explain(code) {
  switch (code) {
    case "UNSUPPORT": return "这个版本的微信还认不了图";
    case "CANCEL": return "";
    case "PICK": return "没选到图片";
    case "INFO": return "这张图读不出来";
    case "LOAD": return "读图超时，图片太大或者解不开";
    case "SIZE": return "拿不到这张图的尺寸";
    case "CANVAS":
    case "CANVAS2D": return "取不到图片像素";
    case "PIXEL": return "图片像素读取失败";
    case "BLANK": return "取到的像素是空白的，图没画上去";
    case "INIT": return "识别引擎没能启动";
    case "START": return "识别引擎启动失败";
    case "RUN": return "识别没跑起来";
    case "TIMEOUT": return "识别超时了，再点一次通常就过了";
    default: return "识别出错了";
  }
}

module.exports = {
  MAX_EDGE: MAX_EDGE,
  PRECISE_EDGE: PRECISE_EDGE,
  MAX_BATCH: MAX_BATCH,
  supported: supported,
  setCanvas: setCanvas,
  pickImage: pickImage,
  pickImages: pickImages,
  imageToFrame: imageToFrame,
  runOcr: runOcr,
  recognize: recognize,
  recognizeMany: recognizeMany,
  abort: abort,
  explain: explain
};
