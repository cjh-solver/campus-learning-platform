const parse = require("./parse-lesson");
const docx = require("./docx-lesson");

/* SheetJS 体积大，改成用到才加载：即使这包跑不起来，也只影响导入，不至于整页报错 */
let XLSX = null;
function xlsx() {
  if (XLSX) return XLSX;
  try {
    XLSX = require("../vendor/xlsx.core.min.js");
  } catch (e) {
    XLSX = null;
  }
  if (!XLSX) {
    const le = new Error("表格解析组件加载失败");
    le.code = "LIB";
    throw le;
  }
  return XLSX;
}

/* 微信只有 FileSystemManager 有读文件方法，没有 wx.readFile */
function fsRead(filePath, encoding, cb) {
  const opt = {
    filePath: filePath,
    success(res) { cb(null, res.data); },
    fail(err) {
      const e = new Error((err && err.errMsg) || "文件读取失败");
      e.code = "READ";
      cb(e);
    }
  };
  if (encoding) opt.encoding = encoding;
  try {
    wx.getFileSystemManager().readFile(opt);
  } catch (e) {
    e.code = "READ";
    cb(e);
  }
}

function readRowsFromArrayBuffer(buf) {
  const lib = xlsx();
  const wb = lib.read(new Uint8Array(buf), { type: "array" });
  const sh = wb.Sheets[wb.SheetNames[0]];
  if (!sh) throw new Error("表格里没有工作表");
  const rows = lib.utils.sheet_to_json(sh, { header: 1, raw: false, defval: "" });
  fillVerticalMerges(rows, sh["!merges"] || []);
  return rows;
}

/* 教务导出的表把一节课竖着合并两行，合并后只剩首行的值；
   往下补一份，解析出来才是两节连排，不会变成一堆半格的课 */
function fillVerticalMerges(rows, merges) {
  merges.forEach(function (m) {
    if (!m || !m.s || !m.e) return;
    if (m.s.c !== m.e.c || m.e.r <= m.s.r) return;
    const top = rows[m.s.r];
    if (!top) return;
    const v = top[m.s.c];
    if (v === undefined || v === null || String(v).trim() === "") return;
    for (let r = m.s.r + 1; r <= m.e.r; r++) {
      if (!rows[r]) continue;
      /* 首列节次不重复填，留空让解析顺次往后数节，否则会变成同一节两门课 */
      if (m.s.c === 0) continue;
      if (String(rows[r][m.s.c] || "").trim() === "") rows[r][m.s.c] = v;
    }
  });
}

function lessonsFromText(text) {
  const list = parse.parsePasted(text) || parse.parseCSV(text);
  return parse.normalizeList(list);
}

/* 有的教务系统“导出 Excel”其实存的是网页表格（HTML），按标签扒成行 */
function looksHtml(s) {
  return /<table[\s>]/i.test(String(s || "").slice(0, 20000));
}

function htmlTableToRows(text) {
  let s = String(text || "").replace(/<(script|style)[\s\S]*?<\/\1>/gi, "");
  const tables = s.match(/<table\b[\s\S]*?<\/table>/gi) || [];
  if (!tables.length) return [];
  let best = tables[0], bestRows = 0;
  tables.forEach(function (t) {
    const n = (t.match(/<tr\b/gi) || []).length;
    if (n > bestRows) { bestRows = n; best = t; }
  });
  const rows = [];
  const trs = best.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
  /* rowspan 的格子要占住下面几行，否则整堂两节的课只剩半格 */
  const spans = {};
  trs.forEach(function (tr) {
    const cells = tr.match(/<t[hd]\b[\s\S]*?<\/t[hd]>/gi) || [];
    const row = [];
    let col = 0;
    function putPend() {
      while (spans[col]) {
        /* 首列是节次，补下去会被当成同一节重复，留空让解析按顺序数节 */
        row[col] = col === 0 ? "" : spans[col].v;
        spans[col].n -= 1;
        if (spans[col].n <= 0) delete spans[col];
        col += 1;
      }
    }
    cells.forEach(function (td) {
      putPend();
      let v = td.replace(/^<t[hd]\b[^>]*>/i, "").replace(/<\/t[hd]>$/i, "");
      v = v.replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/gi, " ")
        .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, "\"")
        .replace(/&#(\d+);/g, function (m, d) { return String.fromCharCode(parseInt(d, 10)); })
        .replace(/&amp;/gi, "&");
      v = v.split("\n").map(function (x) { return x.replace(/\s+/g, " ").trim(); }).join("\n").trim();
      row[col] = v;
      const rs = /rowspan\s*=\s*["']?(\d+)/i.exec(td);
      const n = rs ? parseInt(rs[1], 10) : 0;
      if (n > 1) spans[col] = { v: v, n: n - 1 };
      col += 1;
    });
    putPend();
    if (row.length) rows.push(row);
  });
  return rows;
}

function binaryToText(buf) {
  try {
    if (typeof TextDecoder !== "undefined") {
      return new TextDecoder("utf-8").decode(new Uint8Array(buf));
    }
  } catch (e) {}
  const b = new Uint8Array(buf);
  let out = "", i = 0;
  while (i < b.length) {
    const c = b[i++];
    if (c < 0x80) out += String.fromCharCode(c);
    else if (c < 0xE0) out += String.fromCharCode(((c & 0x1F) << 6) | (b[i++] & 0x3F));
    else if (c < 0xF0) out += String.fromCharCode(((c & 0x0F) << 12) | ((b[i++] & 0x3F) << 6) | (b[i++] & 0x3F));
    else {
      const u = (((c & 0x07) << 18) | ((b[i++] & 0x3F) << 12) | ((b[i++] & 0x3F) << 6) | (b[i++] & 0x3F)) - 0x10000;
      out += String.fromCharCode(0xD800 + (u >> 10), 0xDC00 + (u & 0x3FF));
    }
  }
  return out;
}

/* 表格文件被改成 txt/csv 后缀时会读成一堆乱码，靠控制字符比例挡掉 */
function looksBinary(s) {
  if (!s) return false;
  const n = Math.min(s.length, 2000);
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    if (c === 0) return true;
    if (c === 0xfffd) bad++;
    else if (c < 9 || (c > 13 && c < 32)) bad++;
  }
  return bad / n > 0.08;
}

/* 只要二维行，不管是不是课表；成绩单之类共用一个读取口 */
function textToRows(text) {
  const sep = text.indexOf("\t") > -1 ? "\t" : ",";
  return String(text || "").replace(/^﻿/, "").split(/\r?\n/)
    .map(function (line) {
      return line.split(sep).map(function (c) { return c.trim().replace(/^"|"$/g, ""); });
    })
    .filter(function (r) { return r.join("").trim(); });
}

function readTableRows(tempFilePath, fileName, cb) {
  const ext = String(fileName || "").split(".").pop().toLowerCase();
  if (ext === "xls" || ext === "xlsx") {
    fsRead(tempFilePath, null, function (err, data) {
      if (err) return cb(err);
      try {
        return cb(null, readRowsFromArrayBuffer(data));
      } catch (e) {
        if (e && e.code === "LIB") return cb(e);
        const rows = htmlTableToRows(binaryToText(data));
        if (rows.length) return cb(null, rows);
        const pe = new Error("表格结构没认出来");
        pe.code = "PARSE";
        return cb(pe);
      }
    });
    return;
  }
  if (ext === "docx") {
    fsRead(tempFilePath, null, function (err, data) {
      if (err) return cb(err);
      try {
        return cb(null, docx.docxToRows(data));
      } catch (e) {
        if (e && e.code === "LIB") return cb(e);
        const pe = new Error("Word 里的表格没认出来");
        pe.code = "PARSE";
        return cb(pe);
      }
    });
    return;
  }
  if (ext === "csv" || ext === "txt" || ext === "html" || ext === "htm") {
    fsRead(tempFilePath, "utf8", function (err, text) {
      if (err) return cb(err);
      if (looksBinary(text)) {
        const be = new Error("这个文件不是文本内容");
        be.code = "TYPE";
        return cb(be);
      }
      cb(null, looksHtml(text) ? htmlTableToRows(text) : textToRows(text));
    });
    return;
  }
  const te = new Error("不支持的文件类型");
  te.code = "TYPE";
  cb(te);
}

/* 读取本地选择的表格或文本文件，回调归一化后的 lesson 列表
   出错时 e.code 为 READ（读不了文件）或 PARSE（读到了但认不出课程行） */
function importFromFile(tempFilePath, fileName, cb) {
  const ext = String(fileName || "").split(".").pop().toLowerCase();

  if (ext === "xls" || ext === "xlsx") {
    fsRead(tempFilePath, null, function (err, data) {
      if (err) return cb(err);
      let list = [];
      try {
        list = parse.normalizeList(parse.rowsToLessons(readRowsFromArrayBuffer(data)));
      } catch (e) {
        if (e && e.code === "LIB") return cb(e);
        /* 后缀是 xls、内容其实是网页表格的情况，按 HTML 再试一次 */
        const htmlRows = htmlTableToRows(binaryToText(data));
        if (htmlRows.length) {
          const hl = parse.normalizeList(parse.rowsToLessons(htmlRows));
          if (hl.length) return cb(null, hl);
        }
        const pe = new Error("表格结构没认出来");
        pe.code = "PARSE";
        return cb(pe);
      }
      cb(null, list);
    });
    return;
  }

  if (ext === "csv" || ext === "txt" || ext === "html" || ext === "htm") {
    fsRead(tempFilePath, "utf8", function (err, text) {
      if (err) return cb(err);
      if (looksBinary(text)) {
        const be = new Error("这个文件不是文本内容");
        be.code = "TYPE";
        return cb(be);
      }
      let list = [];
      try {
        if (looksHtml(text)) {
          const rows = htmlTableToRows(text);
          list = parse.normalizeList(parse.rowsToLessons(rows));
        } else {
          list = lessonsFromText(text) || [];
        }
      } catch (e) {
        const pe = new Error("文本里没认出课程行");
        pe.code = "PARSE";
        return cb(pe);
      }
      cb(null, list);
    });
    return;
  }

  if (ext === "docx") {
    fsRead(tempFilePath, null, function (err, data) {
      if (err) return cb(err);
      let list = [];
      try {
        list = docx.docxToLessons(data);
      } catch (e) {
        if (e && e.code === "LIB") return cb(e);
        const pe = new Error("Word 里的课表没认出来");
        pe.code = "PARSE";
        return cb(pe);
      }
      cb(null, list);
    });
    return;
  }

  /* 老式 .doc 是二进制格式，小程序里解不开，只能让发文件的人另存 */
  if (ext === "doc") {
    const de = new Error("老版 Word（.doc）读不了，请另存为 .docx");
    de.code = "TYPE";
    return cb(de);
  }

  /* PDF 里是排版好的文字和字体，小程序解不出表格结构，只给替代做法 */
  if (ext === "pdf") {
    const pe = new Error("PDF 读不了，请另存为 Word(.docx) 或 Excel 再发");
    pe.code = "PDF";
    return cb(pe);
  }

  const te = new Error("不支持的文件类型");
  te.code = "TYPE";
  cb(te);
}

module.exports = {
  importFromFile: importFromFile,
  readTableRows: readTableRows,
  lessonsFromText: lessonsFromText,
  readRowsFromArrayBuffer: readRowsFromArrayBuffer,
  fillVerticalMerges: fillVerticalMerges,
  htmlTableToRows: htmlTableToRows,
  looksHtml: looksHtml,
  looksBinary: looksBinary
};
