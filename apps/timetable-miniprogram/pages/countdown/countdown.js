const cd = require("../../utils/countdown.js");
const storage = require("../../utils/storage.js");

/* 剩多少天，换成一眼能看懂的说法 */
function tipOf(days) {
  if (days === null) return "日子还没定";
  if (days === 0) return "就是今天";
  if (days < 0) return "已经过了";
  if (days < 7) return "就这一周了";
  const weeks = Math.floor(days / 7);
  const rest = days % 7;
  return "还有 " + weeks + " 周" + (rest ? "零 " + rest + " 天" : "");
}

/* 按周切刻度，满格是整周，半格是零头 */
function weeksOf(days) {
  if (days === null || days < 7 || days > 120) return [];
  const weeks = Math.floor(days / 7);
  const arr = [];
  for (let i = 0; i < weeks; i++) arr.push("f");
  if (days % 7) arr.push("h");
  return arr;
}

function buildOne(it) {
  const eff = cd.effective(it);
  const days = cd.daysLeft(eff.date);
  let big = "";
  let unit = "";
  let tone = "ok";
  let sizeClass = "";
  if (days === null) {
    big = "待定";
    unit = "";
    tone = "none";
    sizeClass = "short";
  } else if (days === 0) {
    big = "今天";
    unit = "";
    tone = "soon";
    sizeClass = "short";
  } else if (days > 0) {
    big = String(days);
    unit = "天";
    tone = days <= 7 ? "soon" : "ok";
    if (big.length >= 3) sizeClass = "lg";
  } else {
    big = String(-days);
    unit = "天前";
    tone = "past";
    if (big.length >= 3) sizeClass = "lg";
  }
  return {
    id: it.id,
    title: it.title,
    fixed: it.fixed,
    note: it.note || "",
    date: eff.date,
    pickerValue: eff.date || "2027-06-01",
    dateText: eff.date ? cd.fmtDate(eff.date) : "",
    options: cd.OPTIONS[it.id] || [],
    selected: it.selected || 0,
    big: big,
    unit: unit,
    tone: tone,
    sizeClass: sizeClass,
    tip: days === null ? "点一下卡片，选个日期" : tipOf(days),
    weeks: weeksOf(days),
    quote: cd.pickQuote(days)
  };
}

Page({
  data: {
    cards: [],
    current: 0,
    dots: 1,
    flipOn: false,
    isAdd: false,
    note: "",
    noteId: "",
    editing: false,
    noteLeaving: false,
    draft: "",
    maxLen: 60
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    let items = [];
    try {
      items = (storage.loadState() || {}).countdown || [];
    } catch (e) {
      items = [];
    }
    const list = items.map(buildOne);
    const current = Math.min(this.data.current, list.length);
    const cards = list.map(function (c, i) {
      return Object.assign({}, c, { off: i - current });
    });
    const onCard = cards[current];
    this.setData({
      cards: cards,
      current: current,
      dots: items.length + 1,
      flipOn: !this.data.flipOn,
      isAdd: !onCard,
      note: onCard ? onCard.note : "",
      noteId: onCard ? onCard.id : "",
      editing: false,
      draft: ""
    });
  },

  onSwipe(e) {
    const cur = e.detail.current;
    if (cur === this.data.current) return;
    const cards = this.data.cards.map(function (c, i) {
      return Object.assign({}, c, { off: i - cur });
    });
    const onCard = cards[cur];
    this.setData({
      current: cur,
      cards: cards,
      isAdd: !onCard,
      note: onCard ? onCard.note : "",
      noteId: onCard ? onCard.id : "",
      editing: false,
      draft: ""
    });
  },

  onPickOption(e) {
    const id = e.currentTarget.dataset.id;
    const list = cd.OPTIONS[id] || [];
    if (!list.length) return;
    wx.showActionSheet({
      itemList: list.map(function (x) {
        return x.label;
      }),
      success: (res) => {
        try {
          storage.setCountdownOption(id, res.tapIndex);
        } catch (err) {}
        this.refresh();
      }
    });
  },

  onPickDate(e) {
    const id = e.currentTarget.dataset.id;
    try {
      storage.setCountdownDate(id, e.detail.value);
    } catch (err) {}
    this.refresh();
  },

  onAdd() {
    wx.showModal({
      title: "加一个倒计时",
      editable: true,
      placeholderText: "科目名，比如 高等数学",
      success: (res) => {
        if (!res.confirm) return;
        const name = (res.content || "").trim() || "期末";
        let rec = null;
        try {
          rec = storage.addCountdownItem(name);
        } catch (err) {}
        if (!rec) return;
        const idx = (storage.loadState().countdown || []).findIndex(function (c) {
          return c.id === rec.id;
        });
        this.setData({ current: idx >= 0 ? idx : 0 });
        this.refresh();
      }
    });
  },

  onRemove(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: "删掉这个？",
      content: "删了之后这条倒计时就没了。",
      success: (res) => {
        if (!res.confirm) return;
        try {
          storage.removeCountdownItem(id);
        } catch (err) {}
        this.refresh();
      }
    });
  },

  /* ---- 对自己说的话：跟着当前卡走，存在本机 ---- */
  onEditNote() {
    if (this.data.isAdd || !this.data.noteId) {
      wx.showToast({ title: "先选一张卡", icon: "none" });
      return;
    }
    this.setData({ editing: true, draft: this.data.note || "" });
  },

  onDraft(e) {
    this.setData({ draft: e.detail.value || "" });
  },

  onCancelNote() {
    this.closeNote();
  },

  /* 写字面板先播 180ms 退场动画再卸载，连点只认第一次 */
  closeNote(after) {
    if (!this.data.editing || this._noteTimer) {
      if (after) after();
      return;
    }
    this.setData({ noteLeaving: true });
    this._noteTimer = setTimeout(() => {
      this._noteTimer = null;
      this.setData({ editing: false, noteLeaving: false, draft: "" });
      if (after) after();
    }, 200);
  },

  onSaveNote() {
    const id = this.data.noteId;
    if (!id) return;
    try {
      storage.setCountdownNote(id, (this.data.draft || "").trim());
    } catch (err) {}
    this.closeNote(() => this.refresh());
  },

  onNoop() {}
});
