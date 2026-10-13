# claude-code-mods

個人專用的 Claude Code mods，本身就是一個本機 plugin 市集。

## 安裝（含重灌電腦後）

1. 先裝好 Claude Code、Git。
2. 把 repo clone 到使用者資料夾，執行安裝腳本：

```powershell
git clone https://github.com/nozomichi00/claude-code-mods $HOME\claude-code-mods
powershell -ExecutionPolicy Bypass -File $HOME\claude-code-mods\install.ps1
```

腳本會把這個資料夾註冊成 `claude-code-mods` 市集，並以 user 範圍安裝下表所有 mod，重複執行也沒關係。裝完重開 Claude Code（或在執行中的 session 打 `/reload-plugins`）。

市集來源是資料夾，Claude Code 直接讀這個資料夾。改完程式碼執行 `/reload-plugins` 即可生效，不用重裝。

## Mods

| Mod | 說明 |
| --- | --- |
| [usage-meter](plugins/usage-meter) | 輸入框上方的圓角框用量列：目前模型、Context、5H 額度（重置時間與倒數）、7D 額度、累計 Token（↑ 輸入 ↓ 輸出），最右邊是 Cache 倒數。1/8 格精度的膠囊進度條，>50% 黃、>80% 紅，速度會在重置前用完時標 ▲；依寬度自動切換三種版面。 |
| [next-steps](plugins/next-steps) | 每輪結束後在輸入框上方建議最多三個下一步 prompt，按 1/2/3 填入輸入框、0 關閉。每輪會多花約一段短回覆的用量。複製自 [anthropics/claude-plugins-community](https://github.com/anthropics/claude-plugins-community)（commit f60f045，2026-10-05；作者 Thariq Shihipar，MIT），未修改。 |
| [handoff](plugins/handoff) | Context 用到 70%（可設定）時，輸入框上方出現「交接」按鈕（或打 `/handoff`）。按下後用 fork 寫交接摘要（目前目標、已完成、尚未完成、改過的檔案、注意事項），存到 `~/.claude/handoffs/<專案>-<時間>.md`，執行 `/clear`，再把摘要當新對話第一句送出。摘要沒寫成就不清空。改過的檔案取自 Edit／Write 工具紀錄。 |

這些 mod 都畫在輸入框上方的同一個位置，彼此會保留下層 mod 畫的內容再接上自己的，可以同時使用。

## 開發

```bash
claude plugin validate plugins/<mod>
claude plugin test plugins/<mod>
```
