---
name: deploy
description: body_dashboard 專案的一鍵發布流程 — build、commit 本次變更、push 到 GitHub、再部署到 Firebase Hosting。當使用者說「上 firebase」「部署」「發布」「deploy」「上線」時使用。僅適用於 body_dashboard 專案。
---

# body_dashboard 一鍵發布（build + commit + push + deploy）

## 何時用

- 使用者輸入 `/deploy`，或說「上 firebase / 部署 / 發布 / deploy / 上線」
- 前提：本次程式改動已完成、已在本機確認過（此 skill 不負責測試，只負責發布）

## 專案前提（已由使用者授權）

使用者已明確授權：**這個專案可以直接 build、commit、push、deploy，且可直接在 `main` 上進行**，不需要每步再確認。以下固定事實：

- 分支：`main`（直接 commit / push，不另開分支）
- Git remote：`origin` → `git@github.com:dreambo4/body-dashboard.git`
- Firebase project：`body-dashboard-252b6d`（Hosting URL：https://body-dashboard-252b6d.web.app）
- **這是 Vite 專案，deploy 前必須先 build**。`firebase.json` 的 `public` 是 `"public"`，
  而 Vite 的 `outDir` 是 `public/daily/`（見 `vite.config.js`）。
- **`public/daily/` 在 `.gitignore` 內**：build 產物不進版控，只上 Firebase。
  因此「git 乾淨無變更」**不代表**可以跳過 build — 產物可能是舊的或根本不存在。
- 站台有兩個頁面：`/daily/`（Vite 打包的每日量測儀表板）與 `/inbody`（手寫靜態頁，
  原始檔 `public/inbody.html`，`cleanUrls: true` 所以網址不帶 .html）。

## 執行步驟（依序，全自動）

1. **前置檢查**
   - `git branch --show-current` 確認在 `main`（若不在，先告知使用者，不要自作主張切換）
   - `git status --short` 看有無變更
   - `firebase projects:list` 確認已登入；若未登入，停下來請使用者跑 `firebase login`

2. **build（不可跳過）**
   - `npm run build`
   - 這一步會重建 `public/daily/`（`emptyOutDir: true`，舊產物會被清空）
   - build 失敗就**停止**，把錯誤攤給使用者，不要繼續 commit 或 deploy

   > 全域規則說「不要自動執行 build」，但此 skill 是使用者明確觸發的發布流程，
   > build 是 deploy 的必要前置且已授權，故在此流程內可直接執行。

3. **commit**
   - `git add -A`
   - 訊息格式：**Conventional Commits**，`type(scope): 中文摘要`，首行 ≤ 72 字。
     需要時空一行後補條列說明「做了什麼＋為什麼」。
     常用 type：`feat` / `fix` / `refactor` / `chore` / `docs` / `style`
     常用 scope：`chart` / `daily` / `inbody` / `build`
     範例：`fix(chart): 提示框數值改為最多兩位小數`
   - **不要**加「Generated with Claude Code」或 Co-Authored-By 標籤（使用者全域規則）
   - 若 `git status` 乾淨無變更（例如只是要重新發布），跳過 commit/push，直接進第 5 步並告知

4. **push**：`git push origin main`

5. **deploy**：`firebase deploy --only hosting`

6. **發布後驗證**（用 curl 確認）
   - 每日量測頁：`curl -s -o /dev/null -w "%{http_code}" https://body-dashboard-252b6d.web.app/daily/` → 期望 `200`
   - inbody 頁：`curl -s -o /dev/null -w "%{http_code}" https://body-dashboard-252b6d.web.app/inbody` → 期望 `200`
   - 若本次改的是 `src/` 下的程式，`public/daily/index.html` 引用的 assets 檔名會換 hash，
     可 `grep` 出新檔名後 curl 該 js 確認新版已上線

7. **回報**：commit hash、GitHub push 結果、Hosting URL、兩個頁面的驗證結果，簡潔條列。

## 注意

- `firebase deploy` 是**不可逆的對外發布、立即對所有使用者生效**。因為使用者已針對本專案授權自動化，可直接執行；但若當下 git 有大量非預期變更，先把 `git status` 攤給使用者看再繼續。
- **最常見的發布事故是忘記 build**：因為 `public/daily/` 不進版控，git 會顯示乾淨，
  很容易誤判「沒東西要發」而直接 deploy 舊產物。第 2 步永遠要跑。
- 快取：`/daily/assets/**` 設了 `max-age=31536000, immutable`（見 `firebase.json`），
  但 Vite 產物檔名帶 hash，改版會自動換檔名，不需手動處理版本參數。
  HTML 則是 `no-cache`，所以新版會馬上生效。
- 此 skill 僅適用 body_dashboard。其他專案的 remote / firebase project / build 流程不同，不要套用。
