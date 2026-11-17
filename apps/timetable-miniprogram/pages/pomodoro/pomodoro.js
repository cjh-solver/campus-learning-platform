const pomo = require("../../utils/pomodoro.js");
const storage = require("../../utils/storage.js");

/* 用户上次选的专注时长，独立键存本机；秒列 5 秒一档 */
const DUR_KEY = "ct-pomo-dur-v1";
const SEC_STEP = 5;
const PRESETS = [5, 15, 25, 45, 60];

function range(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(i);
  return out;
}

function secRange() {
  const out = [];
  for (let s = 0; s < 60; s += SEC_STEP) {
    out.push({ v: s, label: s < 10 ? "0" + s : String(s) });
  }
  return out;
}

Page({
  data: {
    modes: pomo.MODE_KEYS.map(function (k) {
      return { key: k, label: pomo.MODES[k].label };
    }),
    presets: PRESETS,
    minList: range(100),
    secList: secRange(),
    wheelVal: [25, 0],
    wheelMin: 25,
    wheelSec: 0,

    mode: "focus",
    state: "idle", // idle running paused done
    clock: "25:00",
    totalSec: 1500,
    remainSec: 1500,
    focusCount: 0,
    pomoCount: 0,
    focusMin: 0,
    flipOn: false,
    stateLabel: "准备开始",
    primaryText: "开始专注",
    showPicker: true
  },

  _timer: null,
  _endAt: 0,
  _keepSec: 0,
  _pausedRemain: 0,
  _focusSec: 1500,

  onLoad() {
    const saved = Number(wx.getStorageSync(DUR_KEY)) || 0;
    this._focusSec = saved > 0 ? saved : pomo.MODES.focus.sec;
    this.syncStats();
    this.applyMode("focus");
  },

  /* 回到前台按结束时间戳校准，后台期间走完的直接结算 */
  onShow() {
    if (this.data.state === "running") this.tick();
  },

  onUnload() {
    this.clearTimer();
  },

  syncStats() {
    const s = storage.getPomo();
    this.setData({
      pomoCount: s.count,
      focusMin: Math.floor(s.focusSec / 60)
    });
  },

  /* 专注用用户选的时长，休息固定 5 / 15 分钟 */
  durationOf(mode) {
    return mode === "focus" ? this._focusSec : pomo.MODES[mode].sec;
  },

  applyMode(mode) {
    const dur = this.durationOf(mode);
    this.clearTimer();
    this._keepSec = dur;
    this._pausedRemain = 0;

    const patch = {
      mode: mode,
      state: "idle",
      totalSec: dur,
      remainSec: dur,
      clock: pomo.fmtClock(dur),
      stateLabel: "准备开始",
      primaryText: mode === "focus" ? "开始专注" : "开始休息",
      showPicker: mode === "focus",
      flipOn: !this.data.flipOn
    };

    if (mode === "focus") {
      patch.wheelVal = [Math.floor(dur / 60), Math.round((dur % 60) / SEC_STEP)];
      patch.wheelMin = Math.floor(dur / 60);
      patch.wheelSec = dur % 60;
    }

    this.setData(patch);
  },

  onWheel(e) {
    const v = e.detail.value;
    const min = v[0];
    const sec = v[1] * SEC_STEP;
    this._focusSec = min * 60 + sec;
    wx.setStorageSync(DUR_KEY, this._focusSec);
    this.setData({
      wheelMin: min,
      wheelSec: sec,
      clock: pomo.fmtClock(this._focusSec),
      totalSec: this._focusSec,
      remainSec: this._focusSec
    });
  },

  onPreset(e) {
    const min = Number(e.currentTarget.dataset.min);
    this._focusSec = min * 60;
    wx.setStorageSync(DUR_KEY, this._focusSec);
    this.setData({
      wheelVal: [min, 0],
      wheelMin: min,
      wheelSec: 0,
      clock: pomo.fmtClock(this._focusSec),
      totalSec: this._focusSec,
      remainSec: this._focusSec
    });
  },

  onSwitchMode(e) {
    const key = e.currentTarget.dataset.key;
    if (this.data.state === "running" || this.data.state === "paused") return;
    if (key === this.data.mode) return;
    this.applyMode(key);
  },

  onPrimary() {
    const st = this.data.state;
    if (st === "running") { this.pause(); return; }
    if (st === "paused") { this.resume(); return; }
    if (st === "done") { this.nextRound(); return; }
    this.start();
  },

  start() {
    if (this.data.totalSec <= 0) {
      wx.showToast({ title: "先选个时长", icon: "none" });
      return;
    }
    this._keepSec = this.data.totalSec;
    this._endAt = Date.now() + this._keepSec * 1000;
    this.setData({
      state: "running",
      stateLabel: "进行中",
      primaryText: "暂停",
      showPicker: false
    });
    this.runTimer();
  },

  resume() {
    this._endAt = Date.now() + this._pausedRemain * 1000;
    this.setData({
      state: "running",
      stateLabel: "进行中",
      primaryText: "暂停",
      showPicker: false
    });
    this.runTimer();
  },

  pause() {
    this.clearTimer();
    this._pausedRemain = this.data.remainSec;
    this.setData({ state: "paused", stateLabel: "已暂停", primaryText: "继续" });
  },

  onReset() {
    this.applyMode(this.data.mode);
  },

  nextRound() {
    /* complete 已把下一段的模式与时长预设好，这里直接开始 */
    this.start();
  },

  runTimer() {
    this.clearTimer();
    this._timer = setInterval(() => this.tick(), 1000);
  },

  clearTimer() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  },

  tick() {
    const remain = (this._endAt - Date.now()) / 1000;
    if (remain <= 0) { this.complete(); return; }
    this.setData({
      remainSec: Math.ceil(remain),
      clock: pomo.fmtClock(remain),
      flipOn: !this.data.flipOn
    });
  },

  complete() {
    this.clearTimer();
    const finishedMode = this.data.mode;
    const keepSec = this._keepSec;
    let focusCount = this.data.focusCount;

    if (finishedMode === "focus") {
      focusCount += 1;
      storage.recordPomo(keepSec);
      this.setData({ focusCount: focusCount });
      this.syncStats();
      wx.vibrateShort({ type: "medium" });
      wx.showToast({ title: "这一段完成了", icon: "none", duration: 1600 });
    } else {
      wx.vibrateShort({ type: "light" });
      wx.showToast({ title: "休息结束", icon: "none", duration: 1600 });
    }

    const next = pomo.nextMode(finishedMode, focusCount);
    const nextSec = this.durationOf(next);
    this._keepSec = nextSec;
    this.setData({
      mode: next,
      state: "done",
      totalSec: nextSec,
      remainSec: nextSec,
      clock: pomo.fmtClock(nextSec),
      stateLabel: finishedMode === "focus" ? "专注完成" : "休息结束",
      primaryText: "下一段",
      showPicker: false
    });
  }
});
