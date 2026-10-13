# claude-code-mods

個人專用的 Claude Code mods，本身就是一個本機 plugin 市集。

## 安裝

```bash
claude plugin marketplace add C:\Users\nozom\claude-code-mods
claude plugin install <mod>@claude-code-mods --scope user
```

市集來源是資料夾，Claude Code 直接讀這個資料夾。改完程式碼在 Claude Code 裡執行 `/reload-plugins` 即可生效，不用重裝。

## Mods

| Mod | 說明 |
| --- | --- |
| [usage-meter](plugins/usage-meter) | 輸入框上方的圓角框用量列：目前模型、Context、5 小時額度（重置時間與倒數）、本週額度、累計 token（↑ 輸入 ↓ 輸出），最右邊是快取倒數。1/8 格精度的膠囊進度條，>50% 黃、>80% 紅，速度會在重置前用完時標 ▲；依寬度自動切換三種版面。 |

## 開發

```bash
claude plugin validate plugins/<mod>
claude plugin test plugins/<mod>
```
