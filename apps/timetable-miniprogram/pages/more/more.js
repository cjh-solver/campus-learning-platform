const feedback = require("../../utils/feedback");
const storage = require("../../utils/storage");

const DEFAULT_CELLS = [
  { id: "grade", title: "成绩", sub: "绩点 · 排名", target: "/pages/grade/grade" },
  { id: "contest", title: "竞赛", sub: "白名单 · 时间表", target: "/pages/contest/contest" },
  { id: "free", title: "空教室", sub: "哪儿还空着", target: "/pages/free/free" },
  { id: "countdown", title: "倒计时", sub: "四六级 · 考研 · 期末", target: "/pages/countdown/countdown" },
  { id: "pomodoro", title: "番茄钟", sub: "专注 · 休息轮换", target: "/pages/pomodoro/pomodoro" }
];

const GHOST_CELL = { id: "ghost", title: "待开发", sub: "以后加", target: "" };

/* 网格单位与卡片尺寸，均为 rpx；一列 3 个，卡内左右各 24rpx 内边距 */
const COLS = 3;
const CARD_W_RPX = 202;
const CARD_H_RPX = 196;
const PITCH_X_RPX = 226;
const PITCH_Y_RPX = 220;

const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE = 10;
const SETTLE_MS = 180;

function posX(index) {
  return (index % COLS) * PITCH_X_RPX;
}

function posY(index) {
  return Math.floor(index / COLS) * PITCH_Y_RPX;
}

Page({
  data: {
    cells: [],
    gridH: 0,
    editing: false,
    settling: false,
    dragId: "",
    dragCellTitle: "",
    floatX: 0,
    floatY: 0,
    floatW: 0,
    floatH: 0
  },

  _timer: null,
  _startX: 0,
  _startY: 0,
  _dragId: "",
  _dragIndex: -1,
  _targetIndex: -1,
  _offsetX: 0,
  _offsetY: 0,
  _baseX: 0,
  _baseY: 0,
  _pitchX: 0,
  _pitchY: 0,
  _cardW: 0,
  _cardH: 0,

  onLoad() {
    this.reloadCells();
  },

  onShow() {
    this.reloadCells();
  },

  /* 按存储顺序拼出展示顺序，末尾追加待开发占位格 */
  reloadCells() {
    const state = storage.loadState();
    const order = state.moreOrder || [];
    const cells = [];
    order.forEach((id) => {
      const found = DEFAULT_CELLS.find((c) => c.id === id);
      if (found) cells.push(found);
    });
    DEFAULT_CELLS.forEach((c) => {
      if (cells.every((x) => x.id !== c.id)) cells.push(c);
    });
    cells.push(GHOST_CELL);
    this.setData({ cells: this.layout(cells), gridH: this.gridHeight(cells.length) });
  },

  gridHeight(count) {
    const rows = Math.ceil(count / COLS);
    return rows > 0 ? rows * PITCH_Y_RPX - 24 : 0;
  },

  /* 位置全部由索引推出，写进 transform，重排后目标值不变，避免松手抖动 */
  layout(cells) {
    return cells.map((c, i) => {
      const item = Object.assign({}, c);
      item.tx = posX(i);
      item.ty = posY(i);
      return item;
    });
  },

  onCellTap(e) {
    if (this.data.editing) return;
    const id = e.currentTarget.dataset.id;
    if (id === "ghost") {
      feedback.fail("这个还没做", "以后会补上，先放着。");
      return;
    }
    const cell = this.data.cells.find((c) => c.id === id);
    if (!cell || !cell.target) return;
    wx.navigateTo({
      url: cell.target,
      fail: () => feedback.fail("页面没打开", "回上一页重试；再不行就重启小程序。")
    });
  },

  onCellTouchStart(e) {
    const id = e.currentTarget.dataset.id;
    if (id === "ghost") return;
    const t = e.touches[0];
    this._startX = t.clientX;
    this._startY = t.clientY;
    this._dragId = id;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.beginDrag(id, t), LONG_PRESS_MS);
  },

  /* 长按成立时查一次格子位置，之后整个拖动过程不再查页面 */
  beginDrag(id, t) {
    const index = this.data.cells.findIndex((c) => c.id === id);
    if (index < 0) return;
    feedback.haptic("medium");
    wx.createSelectorQuery().in(this)
      .selectAll(".cell")
      .boundingClientRect((rects) => {
        if (!rects || !rects.length) return;
        const rpx = this.rpxFactor();
        const self = rects[index] || rects[0];
        const origin = rects[0];
        this._dragIndex = index;
        this._targetIndex = index;
        this._offsetX = t.clientX - self.left;
        this._offsetY = t.clientY - self.top;
        this._baseX = origin.left;
        this._baseY = origin.top;
        this._cardW = self.width;
        this._cardH = self.height;
        this._pitchX = PITCH_X_RPX * rpx;
        this._pitchY = PITCH_Y_RPX * rpx;
        this.setData({
          editing: true,
          dragId: id,
          dragCellTitle: (this.data.cells[index] || {}).title || "",
          floatX: self.left,
          floatY: self.top,
          floatW: self.width,
          floatH: self.height
        });
      })
      .exec();
  },

  rpxFactor() {
    const info = wx.getSystemInfoSync();
    return info.windowWidth / 750;
  },

  onCellTouchMove(e) {
    if (!this.data.editing) {
      const t = e.touches[0];
      if (Math.abs(t.clientX - this._startX) > MOVE_TOLERANCE ||
        Math.abs(t.clientY - this._startY) > MOVE_TOLERANCE) {
        clearTimeout(this._timer);
      }
      return;
    }
    const t = e.touches[0];
    const fx = t.clientX - this._offsetX;
    const fy = t.clientY - this._offsetY;
    const target = this.slotAt(fx, fy);

    if (target === this._targetIndex || target < 0) {
      this.setData({ floatX: fx, floatY: fy });
      return;
    }
    this._targetIndex = target;
    this.setData({
      floatX: fx,
      floatY: fy,
      cells: this.shiftLayout(this.data.cells, this._dragIndex, target)
    });
  },

  /* 用浮层左上角相对网格原点找最近槽位，纯本地计算，不查页面 */
  slotAt(fx, fy) {
    const ox = fx - this._baseX;
    const oy = fy - this._baseY;
    const col = Math.round(ox / this._pitchX);
    const row = Math.round(oy / this._pitchY);
    if (col < 0 || col >= COLS || row < 0) return -1;
    const index = row * COLS + col;
    if (index < 0 || index >= this.data.cells.length) return -1;
    if (index === this._dragIndex) return -1;
    return index;
  },

  /* 插入式让位：被拖格跟到目标槽，区间内其余格依次让出一格
     槽位与格子严格一一对应，不会出现两格叠在同一位置 */
  shiftLayout(cells, from, to) {
    return cells.map((c, i) => {
      const item = Object.assign({}, c);
      let slot = i;
      if (i === from) {
        slot = to;
      } else if (from < to && i > from && i <= to) {
        slot = i - 1;
      } else if (to < from && i >= to && i < from) {
        slot = i + 1;
      }
      item.tx = posX(slot);
      item.ty = posY(slot);
      return item;
    });
  },

  onCellTouchEnd() {
    clearTimeout(this._timer);
    if (this.data.editing) {
      const from = this._dragIndex;
      const to = this._targetIndex;
      if (from > -1 && to > -1 && from !== to) {
        this.settleDrag(from, to);
      } else {
        this.finishDrag();
      }
    }
    this._dragId = "";
  },

  /* 浮层滑到目标槽位落定后再收起，收尾不做瞬移 */
  settleDrag(from, to) {
    const rpx = this.rpxFactor();
    this.setData({
      settling: true,
      floatX: this._baseX + posX(to) * rpx,
      floatY: this._baseY + posY(to) * rpx
    });
    clearTimeout(this._settleTimer);
    this._settleTimer = setTimeout(() => this.finishDrag(), SETTLE_MS);
  },

  finishDrag() {
    clearTimeout(this._settleTimer);
    const from = this._dragIndex;
    const to = this._targetIndex;
    let cells = this.data.cells.slice();
    if (from > -1 && to > -1 && from !== to) {
      const moved = cells.splice(from, 1)[0];
      cells.splice(to, 0, moved);
      this.setData({ cells: this.layout(cells), gridH: this.gridHeight(cells.length) });
      storage.setMoreOrder(cells.filter((c) => c.id !== "ghost").map((c) => c.id));
    }
    this.setData({
      editing: false,
      settling: false,
      dragId: "",
      dragCellTitle: "",
      floatX: 0,
      floatY: 0,
      floatW: 0,
      floatH: 0
    });
    this._dragIndex = -1;
    this._targetIndex = -1;
  }
});
