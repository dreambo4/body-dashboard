# 體成分儀表板

兩個獨立的體成分分析儀表板，部署於同一個 Firebase Hosting 站台。
所有資料皆在瀏覽器本機解析，不會上傳至伺服器。

## 頁面

| 路徑 | 內容 | 技術 | 開發模型 |
|---|---|---|---|
| `/` | 入口選單 | 靜態 HTML | — |
| `/inbody` | InBody 體成分追蹤：節段分析、肌肉脂肪、肥胖分析、區間評估 | 靜態 HTML + Chart.js（CDN） | Claude Sonnet 5 |
| `/daily/` | 每日量測趨勢：體重、體脂肪、內臟脂肪、皮下脂肪、骨骼筋走勢與回歸線 | React + Recharts（Vite 打包） | Claude Opus 4.8 |

兩者皆支援 Excel（.xlsx / .xls）與 CSV 上傳。

## AI 模型說明

本專案的兩個儀表板分別由不同的 Claude 模型協助開發：

- **每日體重與體組成斜率**（`/daily/`）— Claude Opus 4.8
- **InBody 體成分追蹤**（`/inbody`）— Claude Sonnet 5

部署架構整併（Vite 建置、Firebase Hosting 設定、入口選單）由 Claude Opus 5 協助完成，
過程中未更動兩個儀表板原有的分析邏輯與視覺呈現。

## 專案結構

```
├── index.html                    Vite 進入點（僅供 build 使用，不會部署）
├── vite.config.js                建置設定，產物輸出至 public/daily/
├── firebase.json                 Hosting 設定
├── src/
│   ├── main.jsx                  React 掛載點
│   └── daily_measurement.jsx     每日量測趨勢主元件
└── public/                       ← Firebase Hosting 部署目錄
    ├── index.html                入口選單
    ├── inbody.html               InBody 儀表板（純靜態，無需建置）
    └── daily/                    Vite 建置產物（不進版控）
```

`public/daily/` 由建置產生，已列入 `.gitignore`。首次 clone 後必須先 build 才有該目錄。

## 開發

```bash
npm install
npm run dev      # 開發伺服器，僅預覽 /daily 頁面
```

`npm run dev` 只服務 React 那支。要同時預覽兩頁與實際路由，請用：

```bash
npm run build
npx firebase emulators:start --only hosting
```

## 部署

```bash
npm run build                              # 產出 public/daily/
npx firebase deploy --only hosting         # 部署整個 public/
```

或合併為一步：

```bash
npm run deploy
```

**修改 `src/` 底下的檔案後必須重新 build**，否則部署的仍是舊產物。
`public/inbody.html` 與 `public/index.html` 是純靜態檔，改完直接 deploy 即可。

## 已知事項

- `xlsx` 0.18.5 在 npm registry 上有未修補的 advisory（prototype pollution / ReDoS），
  上游已停止在 npm 發布新版。本專案中檔案由使用者自行上傳並僅在本機解析，
  無第三方輸入路徑。`inbody.html` 亦使用同版本 CDN 版本以保持一致。
- `recharts` 打包後約 560 kB（gzip 158 kB），為套件本身體積。
