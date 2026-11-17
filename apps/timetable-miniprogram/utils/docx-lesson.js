const parse = require("./parse-lesson");

/* pako 只用来解压 docx 里的 document.xml，不需要 deflate 那一半 */
let pako = null;
function inflateLib() {
  if (pako) return pako;
  try {
    pako = require("../vendor/pako_inflate.min.js");
  } catch (e) {
    pako = null;
  }
  if (!pako || !pako.inflateRaw) {
    const le = new Error("Word 解析组件加载失败");
    le.code = "LIB";
    throw le;
  }
  return pako;
}

function u16(dv, off) { return dv.getUint16(off, true); }
function u32(dv, off) { return dv.getUint32(off, true); }

function utf8(bytes, start, len) {
  let out = "", i = start, end = start + len;
  while (i < end) {
    const c = bytes[i++];
    if (c < 0x80) {
      out += String.fromCharCode(c);
    } else if (c < 0xE0) {
      out += String.fromCharCode(((c & 0x1F) << 6) | (bytes[i++] & 0x3F));
    } else if (c < 0xF0) {
      out += String.fromCharCode(((c & 0x0F) << 12) | ((bytes[i++] & 0x3F) << 6) | (bytes[i++] & 0x3F));
    } else {
      const u = (((c & 0x07) << 18) | ((bytes[i++] & 0x3F) << 12) | ((bytes[i++] & 0x3F) << 6) | (bytes[i++] & 0x3F)) - 0x10000;
      out += String.fromCharCode(0xD800 + (u >> 10), 0xDC00 + (u & 0x3FF));
    }
  }
  return out;
}

function toArrayBuffer(buf) {
  if (buf instanceof ArrayBuffer) return buf;
  const v = new Uint8Array(buf);
  const out = new ArrayBuffer(v.length);
  new Uint8Array(out).set(v);
  return out;
}

/* 从 docx（zip）里取出一个文件；只处理未压缩和 deflate 两种 */
function unzipEntry(buf, want) {
  buf = toArrayBuffer(buf);
  const dv = new DataView(buf);
  const all = new Uint8Array(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= 0; i--) {
    if (u32(dv, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) {
    const e = new Error("不是有效的 docx");
    e.code = "PARSE";
    throw e;
  }
  const total = u16(dv, eocd + 10);
  let p = u32(dv, eocd + 16);
  for (let k = 0; k < total; k++) {
    if (p + 46 > buf.byteLength || u32(dv, p) !== 0x02014b50) break;
    const method = u16(dv, p + 10);
    const compSize = u32(dv, p + 20);
    const nameLen = u16(dv, p + 28);
    const extraLen = u16(dv, p + 30);
    const commentLen = u16(dv, p + 32);
    const localOff = u32(dv, p + 42);
    const name = utf8(all, p + 46, nameLen);
    if (name === want) {
      const lName = u16(dv, localOff + 26);
      const lExtra = u16(dv, localOff + 28);
      const off = localOff + 30 + lName + lExtra;
      if (off + compSize > buf.byteLength) {
        const e = new Error("docx 内容不完整");
        e.code = "PARSE";
        throw e;
      }
      const raw = new Uint8Array(buf, off, compSize);
      if (method === 0) return raw;
      if (method === 8) return inflateLib().inflateRaw(raw);
      const e = new Error("docx 压缩方式不支持");
      e.code = "PARSE";
      throw e;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  const e = new Error("docx 里没找到 " + want);
  e.code = "PARSE";
  throw e;
}

function unescapeXml(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, function (m, d) { return String.fromCharCode(parseInt(d, 10)); })
    .replace(/&#x([0-9a-fA-F]+);/g, function (m, h) { return String.fromCharCode(parseInt(h, 16)); })
    .replace(/&amp;/g, "&");
}

/* 一个单元格里的文字：按段落拼，段内 run 直接相连 */
function cellText(tcXml) {
  const paras = tcXml.match(/<w:p\b[\s\S]*?<\/w:p>/g) || [];
  if (!paras.length) return "";
  const lines = paras.map(function (p) {
    const ts = p.match(/<w:t\b[^>]*>[\s\S]*?<\/w:t>/g) || [];
    return ts.map(function (t) {
      return unescapeXml(t.replace(/<w:t\b[^>]*>/, "").replace(/<\/w:t>/, ""));
    }).join("");
  });
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.join("\n").trim();
}

/* 竖向合并的格子：上一节的内容延续到这一节，不是空课 */
function vMergeOf(tcXml) {
  const m = /<w:vMerge([^/>]*)\/>/.exec(tcXml);
  if (!m) return "";
  return /w:val="(restart|continue)"/.test(m[1]) ? (/w:val="(restart|continue)"/.exec(m[1])[1]) : "continue";
}

/* “教师”和“【周次】”被拆成两行时，合回一行再交给通用解析 */
function joinTeacherWeeks(line) {
  const out = [];
  line.split("\n").forEach(function (x) {
    const t = x.trim();
    if (!t) { out.push(x); return; }
    const prev = out.length ? out[out.length - 1] : "";
    if (/^【[^】]*】$/.test(t) && prev && prev.trim() && !/【/.test(prev)) {
      out[out.length - 1] = prev.trim() + t;
      return;
    }
    out.push(x);
  });
  return out.join("\n");
}

/* 【…】 里被换行劈开的周次先合回去 */
function joinSplitWeeks(text) {
  return String(text || "")
    .replace(/【([^】]*)】/g, function (m, inner) { return "【" + inner.replace(/\s*\n\s*/g, "") + "】"; });
}

function normalizeCell(text) {
  return joinTeacherWeeks(joinSplitWeeks(text));
}

/* docx 的表格转成行数组，和 xlsx 走同一套 rowsToLessons */
function rowsFromXml(xml) {
  const tables = xml.match(/<w:tbl\b[\s\S]*?<\/w:tbl>/g) || [];
  if (!tables.length) {
    const e = new Error("Word 里没有表格");
    e.code = "PARSE";
    throw e;
  }
  let best = tables[0], bestRows = 0;
  tables.forEach(function (t) {
    const n = (t.match(/<w:tr\b/g) || []).length;
    if (n > bestRows) { bestRows = n; best = t; }
  });
  const trs = best.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || [];
  const carry = {};
  return trs.map(function (tr) {
    const tcs = tr.match(/<w:tc\b[\s\S]*?<\/w:tc>/g) || [];
    const row = [];
    let col = 0;
    tcs.forEach(function (tc) {
      const span = /<w:gridSpan w:val="(\d+)"/.exec(tc);
      const n = span ? Math.max(1, parseInt(span[1], 10)) : 1;
      const vm = vMergeOf(tc);
      let txt = cellText(tc);
      if (vm === "continue") txt = carry[col] || "";
      else if (txt) carry[col] = txt;
      for (let i = 0; i < n; i++) {
        if (i === 0) row.push(normalizeCell(txt));
        else {
          row.push("");
          if (vm === "continue") carry[col + i] = carry[col];
        }
      }
      col += n;
    });
    return row;
  });
}

function docxToRows(buf) {
  const bytes = unzipEntry(buf, "word/document.xml");
  return rowsFromXml(utf8(bytes, 0, bytes.length));
}

function docxToLessons(buf) {
  return parse.normalizeList(parse.rowsToLessons(docxToRows(buf)));
}

module.exports = {
  docxToRows: docxToRows,
  docxToLessons: docxToLessons,
  normalizeCell: normalizeCell
};
