import React, { useState, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Customized,
} from "recharts";

// 目標欄位（其餘忽略）。kgKey 有值者可在圖表右上角切換 % / kg，直接讀檔內既有欄位
const FIELDS = [
  { key: "體重", unit: "kg", color: "#2f6f4e" },
  { key: "體脂肪率", unit: "%", color: "#c65d3b", kgKey: "體脂肪kg" },
  { key: "內臟脂肪率", unit: "級", color: "#8a6d3b" },
  { key: "皮下脂肪率", unit: "%", color: "#4a6fa5", kgKey: "皮下脂肪kg" },
  { key: "骨骼筋率", unit: "%", color: "#6b4a8a", kgKey: "骨骼筋kg" },
];
// 需要讀入的數值欄 = 各主欄位 + 對應 kg 欄位
const VALUE_COLS = [
  ...FIELDS.map((f) => f.key),
  ...FIELDS.filter((f) => f.kgKey).map((f) => f.kgKey),
];
const DATE_KEY = "日期";

function toDate(v) {
  if (v instanceof Date) return v;
  if (typeof v === "number") {
    // Excel serial date
    const d = XLSX.SSF ? XLSX.SSF.parse_date_code(v) : null;
    if (d) return new Date(d.y, d.m - 1, d.d, d.H || 0, d.M || 0);
  }
  const parsed = new Date(v);
  return isNaN(parsed) ? null : parsed;
}
const dayNum = (d) => Math.floor(d.getTime() / 86400000);
const pad = (n) => String(n).padStart(2, "0");
// 以本地日為基準做 day-number 與 yyyy-mm-dd 互轉，與圖表顯示一致
const dayToStr = (t) => {
  const d = new Date(t * 86400000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const strToDay = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return dayNum(new Date(y, m - 1, d));
};
const fmtDate = (t) => {
  const d = new Date(t * 86400000);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

const clean = (v) =>
  String(v == null ? "" : v).replace(/^\ufeff/, "").replace(/\s+/g, "").trim();

function parseWorkbook(wb) {
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: false });
  if (!rows.length) return { data: [], error: "檔案沒有資料" };

  // 掃描前幾列找出真正的標題列（含「日期」的那一列）
  let headerRow = -1;
  const scan = Math.min(rows.length, 15);
  for (let i = 0; i < scan; i++) {
    const cells = (rows[i] || []).map(clean);
    if (cells.includes(clean(DATE_KEY))) { headerRow = i; break; }
  }
  if (headerRow === -1) {
    const seen = rows.slice(0, scan).map((r) => (r || []).map((c) => String(c)).join(" | ")).filter(Boolean);
    return { data: [], error: `找不到「${DATE_KEY}」欄位。偵測到的前幾列為：\n${seen.join("\n") || "（空白）"}` };
  }

  const header = (rows[headerRow] || []).map(clean);
  const idx = {};
  idx[DATE_KEY] = header.indexOf(clean(DATE_KEY));
  VALUE_COLS.forEach((c) => (idx[c] = header.indexOf(clean(c))));

  const data = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r[idx[DATE_KEY]] == null) continue;
    const d = toDate(r[idx[DATE_KEY]]);
    if (!d) continue;
    const rec = { t: dayNum(d) };
    VALUE_COLS.forEach((c) => {
      const v = idx[c] === -1 ? null : r[idx[c]];
      rec[c] = typeof v === "number" ? v : v == null || v === "" ? null : Number(v);
    });
    data.push(rec);
  }
  data.sort((a, b) => a.t - b.t);
  return { data, error: null };
}

// 線性回歸斜率（每日變化）
function slope(points) {
  const pts = points.filter((p) => p.y != null);
  const n = pts.length;
  if (n < 2) return null;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  let num = 0, den = 0;
  pts.forEach((p) => { num += (p.x - mx) * (p.y - my); den += (p.x - mx) ** 2; });
  return den === 0 ? null : num / den;
}

export default function App() {
  const [data, setData] = useState([]);
  const [error, setError] = useState(null);
  const [fileName, setFileName] = useState("");
  const [winMode, setWinMode] = useState("30"); // 'overall' | '7' | '30' | 'custom'
  const [customDays, setCustomDays] = useState(14);
  const [showLabels, setShowLabels] = useState(true);
  const [showBand, setShowBand] = useState(true);
  const [fromStr, setFromStr] = useState("");
  const [toStr, setToStr] = useState("");
  const [unitSel, setUnitSel] = useState({}); // { 欄位: 'kg' | 'pct' }，預設 %
  const fileRef = useRef();
  const setUnit = (key, mode) => setUnitSel((p) => ({ ...p, [key]: mode }));

  const onFile = async (file) => {
    if (!file) return;
    setError(null);
    setFileName(file.name);
    try {
      const isCsv = /\.(csv|tsv|txt)$/i.test(file.name) || file.type === "text/csv";
      let wb;
      if (isCsv) {
        // CSV 以 UTF-8 解碼成文字，避免中文被當成 Latin-1 變亂碼
        const text = await file.text();
        wb = XLSX.read(text, { type: "string", cellDates: true });
      } else {
        const buf = await file.arrayBuffer();
        wb = XLSX.read(buf, { type: "array", cellDates: true });
      }
      const { data, error } = parseWorkbook(wb);
      if (error) { setError(error); setData([]); return; }
      if (!data.length) { setError("解析後沒有有效資料列"); return; }
      setData(data);
      setFromStr(dayToStr(data[0].t));
      setToStr(dayToStr(data[data.length - 1].t));
    } catch (e) {
      setError(
        `無法讀取此檔案。.numbers 原生格式瀏覽器無法解析，請在 Numbers 中「檔案 → 輸出成 → CSV 或 Excel」後再上傳。（${e.message}）`
      );
      setData([]);
    }
  };

  const bounds = useMemo(() => {
    if (!data.length) return null;
    return { min: data[0].t, max: data[data.length - 1].t };
  }, [data]);

  const viewData = useMemo(() => {
    if (!data.length) return [];
    const lo = fromStr ? strToDay(fromStr) : -Infinity;
    const hi = toStr ? strToDay(toStr) : Infinity;
    return data.filter((d) => d.t >= lo && d.t <= hi);
  }, [data, fromStr, toStr]);

  const setPreset = (days) => {
    if (!bounds) return;
    if (days === "all") { setFromStr(dayToStr(bounds.min)); setToStr(dayToStr(bounds.max)); return; }
    const from = Math.max(bounds.min, bounds.max - days);
    setFromStr(dayToStr(from));
    setToStr(dayToStr(bounds.max));
  };

  const stats = useMemo(() => {
    return FIELDS.map((f) => {
      const kg = f.kgKey && unitSel[f.key] === "kg";
      const vkey = kg ? f.kgKey : f.key;
      const unit = kg ? "kg" : f.unit;
      const pts = viewData.map((d) => ({ x: d.t, y: d[vkey] })).filter((p) => p.y != null);
      const s = slope(pts);
      const first = pts[0]?.y ?? null;
      const last = pts[pts.length - 1]?.y ?? null;
      const spanDays = pts.length >= 2 ? pts[pts.length - 1].x - pts[0].x : 0;
      return {
        ...f, unit, vkey, isKg: kg,
        slope: s, first, last,
        delta: first != null && last != null ? last - first : null,
        spanDays, count: pts.length,
      };
    });
  }, [viewData, unitSel]);

  const domain = useMemo(() => {
    if (!viewData.length) return [0, 1];
    return [viewData[0].t, viewData[viewData.length - 1].t];
  }, [viewData]);

  // 脂肪 vs 肌肉 拆解：此範圍體重變化中，脂肪 / 骨骼肌 / 其他各佔多少（用檔內既有 kg 欄位）
  const decomp = useMemo(() => {
    const get = (key) => viewData.map((d) => ({ t: d.t, v: d[key] }));
    const w = fitEndpoints(get("體重"));
    const fat = fitEndpoints(get("體脂肪kg"));
    const mus = fitEndpoints(get("骨骼筋kg"));
    if (!w || !fat || !mus) return null;
    const dW = w.end - w.start, dFat = fat.end - fat.start, dMus = mus.end - mus.start;
    return { dW, dFat, dMus, other: dW - dFat - dMus, days: w.days };
  }, [viewData]);

  const windowDays =
    winMode === "overall" ? null
    : winMode === "custom" ? Math.max(2, Math.round(Number(customDays) || 0))
    : Number(winMode);

  return (
    <div style={S.page}>
      <style>{globalCss}</style>
      <header style={S.header}>
        <a href="/" style={S.homeLink}>← 返回首頁</a>
        <div style={S.eyebrow}>身體組成 · 趨勢分析</div>
        <h1 style={S.h1}>每日體重與體組成斜率</h1>
        <p style={S.sub}>
          淺色圓點為原始每日量測，粗線為分段回歸斜率（趨勢主角），灰色虛線為區間整體趨勢。
          可調整斜率窗格與日期範圍。只讀取：日期、體重、體脂肪率、內臟脂肪率、皮下脂肪率、骨骼筋率。
        </p>
        <button style={S.upload} onClick={() => fileRef.current.click()}>
          {fileName ? `已載入：${fileName} · 重新選擇` : "選擇檔案"}
        </button>
        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.numbers" style={{ display: "none" }}
          onChange={(e) => onFile(e.target.files[0])} />
        {error && <div style={S.error}>{error}</div>}
      </header>

      {data.length > 0 && (
        <>
          <section style={S.statGrid}>
            {stats.map((s) => (
              <div key={s.key} style={{ ...S.statCard, borderTopColor: s.color }}>
                <div style={S.statName}>{s.key}</div>
                <div style={S.statVal}>
                  {s.last != null ? s.last.toFixed(1) : "—"}
                  <span style={S.statUnit}>{s.unit}</span>
                </div>
                <div style={S.statRow}>
                  <span>整體斜率</span>
                  <b style={{ color: s.slope != null && s.slope < 0 ? s.color : s.slope > 0 ? "#b03a2e" : "#555" }}>
                    {s.slope != null ? `${s.slope >= 0 ? "+" : ""}${s.slope.toFixed(4)} ${s.unit}/日` : "—"}
                  </b>
                </div>
                <div style={S.statRow}>
                  <span>週變化</span>
                  <b>{s.slope != null ? `${s.slope >= 0 ? "+" : ""}${(s.slope * 7).toFixed(2)} ${s.unit}` : "—"}</b>
                </div>
                <div style={S.statRow}>
                  <span>總變化</span>
                  <b>{s.delta != null ? `${s.delta >= 0 ? "+" : ""}${s.delta.toFixed(1)} ${s.unit}` : "—"}</b>
                </div>
                <div style={S.statMeta}>{s.count} 筆 · 跨 {s.spanDays} 天</div>
              </div>
            ))}
          </section>

          <section style={S.controls}>
            <div style={S.ctrlGroup}>
              <span style={S.ctrlLabel}>斜率窗格</span>
              {[
                { v: "overall", t: "整體" },
                { v: "7", t: "7 天" },
                { v: "30", t: "30 天" },
                { v: "custom", t: "自訂" },
              ].map((o) => (
                <button key={o.v}
                  onClick={() => setWinMode(o.v)}
                  style={{ ...S.seg, ...(winMode === o.v ? S.segOn : {}) }}>
                  {o.t}
                </button>
              ))}
              {winMode === "custom" && (
                <span style={S.customWrap}>
                  <input type="number" min={2} value={customDays}
                    onChange={(e) => setCustomDays(e.target.value)}
                    style={S.numInput} />
                  <span style={S.ctrlHint}>天</span>
                </span>
              )}
            </div>
            <div style={S.ctrlGroup}>
              <label style={S.checkWrap}>
                <input type="checkbox" checked={showBand}
                  onChange={(e) => setShowBand(e.target.checked)} />
                平滑趨勢帶
              </label>
              <label style={S.checkWrap}>
                <input type="checkbox" checked={showLabels}
                  onChange={(e) => setShowLabels(e.target.checked)} />
                顯示斜率數值
              </label>
            </div>
          </section>

          <section style={S.controls}>
            <div style={S.ctrlGroup}>
              <span style={S.ctrlLabel}>日期範圍</span>
              <input type="date" value={fromStr}
                min={bounds ? dayToStr(bounds.min) : undefined}
                max={toStr || (bounds ? dayToStr(bounds.max) : undefined)}
                onChange={(e) => setFromStr(e.target.value)} style={S.dateInput} />
              <span style={S.ctrlHint}>→</span>
              <input type="date" value={toStr}
                min={fromStr || (bounds ? dayToStr(bounds.min) : undefined)}
                max={bounds ? dayToStr(bounds.max) : undefined}
                onChange={(e) => setToStr(e.target.value)} style={S.dateInput} />
            </div>
            <div style={S.ctrlGroup}>
              {[
                { v: 30, t: "近 30 天" },
                { v: 90, t: "近 90 天" },
                { v: 180, t: "近 180 天" },
                { v: "all", t: "全部" },
              ].map((o) => (
                <button key={o.t} onClick={() => setPreset(o.v)} style={S.presetBtn}>
                  {o.t}
                </button>
              ))}
            </div>
          </section>
          {windowDays && (
            <p style={S.winNote}>
              每 {windowDays} 天為一段，以「日曆天」計算（含無數據的空白日）。採連續分段回歸：
              各段在節點相接、無垂直段差，橫跨資料斷點的變化會計入斜率。標註數字為該段「每週變化量」（單位/週）。
              開啟「平滑趨勢帶」時的淺色區塊為 ±2σ 正常波動範圍：帶內的起伏多屬雜訊。
            </p>
          )}

          {decomp && Math.abs(decomp.dW) > 0.05 && (() => {
            const { dW, dFat, dMus, other, days } = decomp;
            const parts = [
              { name: "脂肪", val: dFat, color: "#c65d3b" },
              { name: "骨骼肌", val: dMus, color: "#6b4a8a" },
              { name: "其他", val: other, color: "#b8b0a0" },
            ];
            const totalAbs = parts.reduce((s, p) => s + Math.abs(p.val), 0) || 1;
            const fmt = (x) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)}`;
            // 中性判讀：僅描述，不做醫療或飲食指示
            let verdict;
            if (dW < -0.3) {
              verdict = dMus >= -0.2
                ? "體重下降主要來自脂肪，骨骼肌大致維持——組成理想。"
                : `脂肪與骨骼肌同時下降（肌肉 ${fmt(dMus)} kg）。`;
            } else if (dW > 0.3) {
              verdict = `此範圍體重上升，其中脂肪 ${fmt(dFat)} kg、骨骼肌 ${fmt(dMus)} kg。`;
            } else {
              verdict = "體重大致持平，變化多落在雜訊範圍內。";
            }
            return (
              <section style={S.decompCard}>
                <div style={S.decompHead}>
                  <h2 style={S.decompTitle}>減脂品質拆解</h2>
                  <span style={S.decompSub}>
                    此範圍 {days} 天 · 體重{" "}
                    <b style={{ color: dW <= 0 ? "#2f6f4e" : "#b03a2e" }}>{fmt(dW)} kg</b>
                  </span>
                </div>
                <div style={S.decompBar}>
                  {parts.map((p) => (
                    <div key={p.name} title={`${p.name} ${fmt(p.val)} kg`}
                      style={{ width: `${(Math.abs(p.val) / totalAbs) * 100}%`, background: p.color }} />
                  ))}
                </div>
                <div style={S.decompLegend}>
                  {parts.map((p) => (
                    <span key={p.name} style={S.decompItem}>
                      <i style={{ ...S.dot, background: p.color }} />
                      {p.name} <b>{fmt(p.val)} kg</b>
                      <span style={S.decompPct}>({Math.round((Math.abs(p.val) / totalAbs) * 100)}%)</span>
                    </span>
                  ))}
                </div>
                <p style={S.decompVerdict}>{verdict}</p>
                <p style={S.decompNote}>
                  脂肪／肌肉為體脂計（生物電阻）推估，單點誤差較大；數值取自區間回歸首尾，範圍越長越可靠。
                </p>
              </section>
            );
          })()}

          {FIELDS.map((f) => {
            const st = stats.find((s) => s.key === f.key);
            const series = viewData
              .map((d) => ({ t: d.t, v: d[st.vkey] }))
              .filter((p) => p.v != null); // 過濾 null → 斷點以斜線連接前後點
            const trendData = series.length >= 2 && st.slope != null ? buildTrend(series, st) : null;
            const segs = windowDays ? buildSegments(series, windowDays) : [];
            const labelsOn = showLabels && segs.length <= 32;
            const rawDim = !!windowDays || showBand;
            const sm = showBand && series.length >= 3 ? smooth(series) : null;
            const chartData = sm ? sm.data : series;
            return (
              <section key={f.key} style={S.chartCard}>
                <div style={S.chartHead}>
                  <div>
                    <h2 style={{ ...S.h2, color: f.color }}>{f.key}</h2>
                    <span style={S.chartUnit}>單位：{st.unit}</span>
                  </div>
                  <div style={S.headRight}>
                    {f.kgKey && (
                      <div style={S.unitToggle}>
                        <button onClick={() => setUnit(f.key, "pct")}
                          style={{ ...S.unitBtn, ...(!st.isKg ? S.unitBtnOn : {}) }}>%</button>
                        <button onClick={() => setUnit(f.key, "kg")}
                          style={{ ...S.unitBtn, ...(st.isKg ? S.unitBtnOn : {}) }}>kg</button>
                      </div>
                    )}
                    {st.slope != null && (
                      <div style={S.chartTrend}>
                        區間趨勢{" "}
                        <b style={{ color: st.slope <= 0 ? f.color : "#b03a2e" }}>
                          {fmtSlopeWk(st.slope)} {st.unit}/週
                        </b>
                      </div>
                    )}
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={250}>
                  <ComposedChart data={chartData} margin={{ top: 14, right: 22, left: -8, bottom: 0 }}>
                    <CartesianGrid stroke="#eee9df" strokeDasharray="0" vertical={false} />
                    <XAxis type="number" dataKey="t" domain={domain} scale="linear"
                      tickFormatter={fmtDate} tick={{ fontSize: 10.5, fill: "#a8a291" }}
                      tickCount={8} axisLine={{ stroke: "#e0dacf" }} tickLine={false}
                      allowDataOverflow />
                    <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10.5, fill: "#a8a291" }}
                      width={44} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartTooltip unit={st.unit} />} />
                    {/* 正常波動帶 (±2σ)：帶內的變化視為雜訊 */}
                    {sm && (
                      <Area dataKey="band" stroke="none" fill={f.color} fillOpacity={0.1}
                        isAnimationActive={false} activeDot={false} connectNulls />
                    )}
                    {/* 原始每日量測：淡化為背景資料雲，斷點仍以細線連接 */}
                    <Line type="linear" dataKey="v" stroke={f.color}
                      strokeWidth={rawDim ? 1 : 1.6} strokeOpacity={rawDim ? 0.25 : 0.85}
                      dot={{ r: rawDim ? 1.4 : 2, fill: f.color, fillOpacity: rawDim ? 0.3 : 0.9, strokeWidth: 0 }}
                      activeDot={{ r: 4 }} isAnimationActive={false} />
                    {/* EWMA 平滑趨勢線：僅整體模式顯示；分段模式的趨勢由分段線表達，避免兩條線打架 */}
                    {sm && !windowDays && (
                      <Line type="monotone" dataKey="ewma" stroke={f.color} strokeWidth={2.4}
                        strokeOpacity={0.9} dot={false} isAnimationActive={false} />
                    )}
                    {/* 整體趨勢對照線（僅整體模式且未開平滑帶時；否則由 EWMA 或分段線呈現） */}
                    {!windowDays && !sm && trendData && (
                      <ReferenceLine
                        segment={[
                          { x: trendData[0].t, y: trendData[0].v },
                          { x: trendData[1].t, y: trendData[1].v },
                        ]}
                        stroke={f.color} strokeDasharray="5 5" strokeOpacity={0.5} />
                    )}
                    {/* 分段斜率線 + 標籤（自繪，最上層） */}
                    {segs.length > 0 && (
                      <Customized component={(p) => (
                        <SlopeLayer {...p} segments={segs} color={f.color} showLabels={labelsOn} />
                      )} />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
                {windowDays && !labelsOn && segs.length > 0 && (
                  <div style={S.tooMany}>
                    此範圍共 {segs.length} 段，段數過多已隱藏數字；縮小日期範圍或改用較大窗格即可顯示。
                  </div>
                )}
              </section>
            );
          })}
        </>
      )}
      <footer style={S.aiNote}>此頁面由 Claude Opus 4.8 協助開發／純前端渲染，資料不會上傳或儲存。</footer>
    </div>
  );
}

function buildTrend(series, st) {
  // 回歸線兩端點
  const x0 = series[0].t, x1 = series[series.length - 1].t;
  const xs = series.map((s) => s.t);
  const ys = series.map((s) => s.v);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const b = st.slope;
  const a = my - b * mx;
  return [
    { t: x0, v: a + b * x0 },
    { t: x1, v: a + b * x1 },
  ];
}

// 小型最小平方解（正規方程 + 高斯消去），用於連續分段回歸
function solveLLS(X, y) {
  const n = X.length, p = X[0].length;
  const A = Array.from({ length: p }, () => new Array(p).fill(0));
  const b = new Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < p; a++) {
      b[a] += X[i][a] * y[i];
      for (let c = 0; c < p; c++) A[a][c] += X[i][a] * X[i][c];
    }
  }
  for (let a = 0; a < p; a++) A[a][a] += 1e-6; // 微量脊回歸，提升條件數
  for (let col = 0; col < p; col++) {
    let pv = col;
    for (let r = col + 1; r < p; r++) if (Math.abs(A[r][col]) > Math.abs(A[pv][col])) pv = r;
    [A[col], A[pv]] = [A[pv], A[col]]; [b[col], b[pv]] = [b[pv], b[col]];
    const d = A[col][col];
    if (Math.abs(d) < 1e-12) continue;
    for (let r = 0; r < p; r++) {
      if (r === col) continue;
      const f = A[r][col] / d;
      for (let c = col; c < p; c++) A[r][c] -= f * A[col][c];
      b[r] -= f * b[col];
    }
  }
  return b.map((bi, i) => bi / A[i][i]);
}

// 連續分段回歸：窗格為固定「日曆天數」（含無數據的空白日），並強制各段在節點相接（無垂直段差）。
// 用 hinge 基底 [1, t, (t-k)+...] 一次擬合，各段斜率 = 基準斜率 + 累積節點係數；畫出的線斜率即等於標籤值。
function buildSegments(series, windowDays) {
  if (series.length < 2 || !windowDays) return [];
  // 以資料點界定各窗格範圍（每段起點 = 前段終點，連續）
  const wins = [];
  let i = 0, prev = null;
  while (i < series.length) {
    const start = series[i].t;
    const pts = [];
    let j = i;
    while (j < series.length && series[j].t - start < windowDays) { pts.push(series[j]); j++; }
    const wp = prev ? [prev, ...pts] : pts;
    wins.push({ x0: wp[0].t, x1: wp[wp.length - 1].t });
    prev = series[j - 1];
    i = j;
  }
  const knots = wins.slice(1).map((w) => w.x0); // 內部節點 = 各段邊界（前段終點）
  const t0 = series[0].t;
  const X = series.map((p) => {
    const row = [1, p.t - t0];
    knots.forEach((k) => row.push(Math.max(0, p.t - k)));
    return row;
  });
  const beta = solveLLS(X, series.map((p) => p.v));
  const fit = (t) => {
    let v = beta[0] + beta[1] * (t - t0);
    knots.forEach((k, idx) => { v += beta[2 + idx] * Math.max(0, t - k); });
    return v;
  };
  let cum = beta[1];
  return wins.map((w, idx) => {
    if (idx > 0) cum += beta[2 + (idx - 1)]; // 進入此段時累加該節點的斜率變化
    return { x0: w.x0, x1: w.x1, y0: fit(w.x0), y1: fit(w.x1), slope: cum };
  });
}
const fmtSlopeWk = (s) => `${s >= 0 ? "+" : ""}${(s * 7).toFixed(2)}`;

// 時間感知 EWMA（半衰期以「天」計，能正確處理日期斷點）+ 以殘差標準差建立正常波動帶
function smooth(series, halflife = 14, k = 2) {
  if (!series.length) return { data: [], sigma: 0 };
  const out = [{ t: series[0].t, v: series[0].v, ewma: series[0].v }];
  let ewma = series[0].v;
  for (let i = 1; i < series.length; i++) {
    const dt = Math.max(1, series[i].t - series[i - 1].t);
    const alpha = 1 - Math.pow(0.5, dt / halflife); // 間隔越大→新值權重越高（舊值已過時）
    ewma = alpha * series[i].v + (1 - alpha) * ewma;
    out.push({ t: series[i].t, v: series[i].v, ewma });
  }
  const res = out.map((p) => p.v - p.ewma);
  const m = res.reduce((a, b) => a + b, 0) / res.length;
  const sigma = Math.sqrt(res.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, res.length - 1));
  out.forEach((p) => { p.band = [p.ewma - k * sigma, p.ewma + k * sigma]; });
  return { data: out, sigma };
}

// 線性回歸在區間首尾的擬合值（比首末單點穩健，用於脂肪/肌肉拆解）
function fitEndpoints(series) {
  const pts = series.filter((p) => p.v != null);
  if (pts.length < 2) return null;
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.t, 0) / n;
  const my = pts.reduce((s, p) => s + p.v, 0) / n;
  let num = 0, den = 0;
  pts.forEach((p) => { num += (p.t - mx) * (p.v - my); den += (p.t - mx) ** 2; });
  const b = den ? num / den : 0, a = my - b * mx;
  const x0 = pts[0].t, x1 = pts[pts.length - 1].t;
  return { start: a + b * x0, end: a + b * x1, days: x1 - x0 };
}

// 用 recharts 內部座標尺自繪分段斜率線與標籤，標籤加白色描邊確保雜訊上仍可讀
function SlopeLayer({ xAxisMap, yAxisMap, segments, color, showLabels }) {
  if (!xAxisMap || !yAxisMap || !segments.length) return null;
  const xs = Object.values(xAxisMap)[0]?.scale;
  const ys = Object.values(yAxisMap)[0]?.scale;
  if (!xs || !ys) return null;
  return (
    <g>
      {segments.map((sg, i) => {
        const X0 = xs(sg.x0), Y0 = ys(sg.y0), X1 = xs(sg.x1), Y1 = ys(sg.y1);
        const mx = (X0 + X1) / 2, my = (Y0 + Y1) / 2;
        // 依斜率方向把標籤放在線的上或下側，減少與線重疊
        const yOff = sg.slope <= 0 ? -7 : 13;
        return (
          <g key={i}>
            <line x1={X0} y1={Y0} x2={X1} y2={Y1} stroke={color} strokeWidth={2.6}
              strokeLinecap="round" opacity={0.95} />
            <circle cx={X0} cy={Y0} r={2.4} fill={color} />
            <circle cx={X1} cy={Y1} r={2.4} fill={color} />
            {showLabels && (
              <text x={mx} y={my + yOff} textAnchor="middle" fontSize={9.5} fontWeight={700}
                fill={color} stroke="#ffffff" strokeWidth={3.2} paintOrder="stroke"
                style={{ paintOrder: "stroke" }}>
                {fmtSlopeWk(sg.slope)}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

const fmtDateFull = (t) => {  const d = new Date(t * 86400000);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
};

// 最多到小數點後第二位，並去掉尾端多餘的 0（76.30000000000001 → 76.3）
const fmtNum2 = (x) => (x == null ? "—" : String(Math.round(x * 100) / 100));

// 只顯示「量測」與「趨勢」，不把波動帶塞進提示框
function ChartTooltip({ active, payload, unit }) {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0]?.payload || {};
  const raw = row.v, ewma = row.ewma;
  return (
    <div style={{ background: "#fff", border: "1px solid #e0dacf", borderRadius: 8, padding: "7px 10px", fontSize: 12.5, boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}>
      <div style={{ color: "#8a8578", marginBottom: 3 }}>{fmtDateFull(row.t)}</div>
      {raw != null && <div>量測 <b>{fmtNum2(raw)} {unit}</b></div>}
      {ewma != null && <div style={{ color: "#8a8578" }}>趨勢 {fmtNum2(ewma)} {unit}</div>}
    </div>
  );
}

const globalCss = `
  * { box-sizing: border-box; }
  body { margin: 0; }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
`;

const S = {
  page: { minHeight: "100vh", background: "#faf8f3", fontFamily: "'Noto Sans TC', system-ui, sans-serif", color: "#2b2822", padding: "32px 20px 60px", maxWidth: 900, margin: "0 auto" },
  header: { marginBottom: 28 },
  homeLink: { display: "inline-block", fontSize: 12, color: "#a89f8d", textDecoration: "none", marginBottom: 12, fontWeight: 600 },
  eyebrow: { fontSize: 12, letterSpacing: 2, color: "#a89f8d", fontWeight: 600, marginBottom: 8 },
  h1: { fontSize: 30, fontWeight: 800, margin: "0 0 10px", lineHeight: 1.2 },
  sub: { fontSize: 13.5, color: "#6f6a5e", lineHeight: 1.7, maxWidth: 640, margin: "0 0 18px" },
  upload: { background: "#2b2822", color: "#faf8f3", border: "none", borderRadius: 8, padding: "11px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer" },
  error: { marginTop: 14, background: "#fdecea", color: "#a03428", border: "1px solid #f3c9c3", borderRadius: 8, padding: "10px 14px", fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" },
  statGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(155px, 1fr))", gap: 12, marginBottom: 20 },
  controls: { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, background: "#fff", borderRadius: 10, padding: "12px 14px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)", marginBottom: 8 },
  ctrlGroup: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
  ctrlLabel: { fontSize: 13, fontWeight: 700, color: "#2b2822", marginRight: 4 },
  seg: { border: "1px solid #e0dacf", background: "#faf8f3", color: "#6f6a5e", borderRadius: 7, padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  segOn: { background: "#2b2822", color: "#faf8f3", borderColor: "#2b2822" },
  customWrap: { display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 2 },
  numInput: { width: 58, border: "1px solid #e0dacf", borderRadius: 7, padding: "6px 8px", fontSize: 13, textAlign: "center" },
  ctrlHint: { fontSize: 12, color: "#a89f8d" },
  checkWrap: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#6f6a5e", cursor: "pointer" },
  winNote: { fontSize: 12, color: "#8a8578", lineHeight: 1.6, margin: "0 4px 18px" },
  decompCard: { background: "#fff", borderRadius: 12, padding: "16px 18px", marginBottom: 18, boxShadow: "0 1px 3px rgba(0,0,0,0.04)", borderLeft: "3px solid #2f6f4e" },
  decompHead: { display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  decompTitle: { fontSize: 16, fontWeight: 700, margin: 0, color: "#2b2822" },
  decompSub: { fontSize: 13, color: "#6f6a5e" },
  decompBar: { display: "flex", height: 18, borderRadius: 5, overflow: "hidden", background: "#f0ece3", marginBottom: 10 },
  decompLegend: { display: "flex", flexWrap: "wrap", gap: "6px 18px", marginBottom: 10 },
  decompItem: { fontSize: 13, color: "#4a463d", display: "inline-flex", alignItems: "center", gap: 5 },
  dot: { width: 9, height: 9, borderRadius: 2, display: "inline-block" },
  decompPct: { color: "#a89f8d", fontSize: 12 },
  decompVerdict: { fontSize: 13.5, color: "#2b2822", margin: "0 0 6px", lineHeight: 1.6, fontWeight: 600 },
  decompNote: { fontSize: 11.5, color: "#a89f8d", margin: 0, lineHeight: 1.5 },
  statCard: { background: "#fff", borderRadius: 10, borderTop: "3px solid", padding: "14px 15px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" },
  statName: { fontSize: 13, color: "#6f6a5e", fontWeight: 600, marginBottom: 6 },
  statVal: { fontSize: 26, fontWeight: 800, marginBottom: 10, lineHeight: 1 },
  statUnit: { fontSize: 13, fontWeight: 500, color: "#a89f8d", marginLeft: 3 },
  statRow: { display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "#6f6a5e", padding: "3px 0" },
  statMeta: { fontSize: 11, color: "#b0a894", marginTop: 6, paddingTop: 6, borderTop: "1px solid #f0ece3" },
  chartCard: { background: "#fff", borderRadius: 12, padding: "16px 16px 12px", marginBottom: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" },
  chartHead: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "0 4px 10px", gap: 10 },
  headRight: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 },
  unitToggle: { display: "inline-flex", border: "1px solid #e0dacf", borderRadius: 7, overflow: "hidden" },
  unitBtn: { border: "none", background: "#faf8f3", color: "#8a8578", padding: "4px 11px", fontSize: 12, fontWeight: 700, cursor: "pointer" },
  unitBtnOn: { background: "#2b2822", color: "#faf8f3" },
  h2: { fontSize: 17, fontWeight: 700, margin: 0, display: "inline" },
  chartUnit: { fontSize: 11.5, color: "#a89f8d", marginLeft: 8 },
  chartTrend: { fontSize: 12, color: "#8a8578", whiteSpace: "nowrap" },
  tooMany: { fontSize: 11.5, color: "#a89f8d", padding: "2px 6px 0", lineHeight: 1.5 },
  aiNote: { marginTop: 36, fontSize: 11, color: "#b0a894", textAlign: "center", lineHeight: 1.6 },
  dateInput: { border: "1px solid #e0dacf", borderRadius: 7, padding: "5px 8px", fontSize: 12.5, color: "#2b2822", background: "#faf8f3", fontFamily: "inherit" },
  presetBtn: { border: "1px solid #e0dacf", background: "#faf8f3", color: "#6f6a5e", borderRadius: 7, padding: "5px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer" },
};
