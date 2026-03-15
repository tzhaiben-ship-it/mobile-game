# SKYFORCE — B-2 Spirit 3D

סימולטור קרב תלת-ממדי מבוסס Three.js WebGL.

## מבנה הפרויקט

```
skyforce/
├── index.html      ← מבנה ה-HTML וה-HUD
├── style.css       ← כל העיצוב (RTL, HUD, תפריטים)
├── game.js         ← לוגיקת המשחק (Three.js, פיזיקה, AI)
└── .vscode/
    ├── settings.json
    ├── launch.json
    └── extensions.json
```

## הפעלה ב-VS Code

### שיטה 1 — Live Server (מומלץ)
1. פתח את התיקייה ב-VS Code: `File → Open Folder`
2. התקן את תוסף **Live Server** (מומלץ אוטומטית)
3. לחץ **Go Live** בשורת הסטטוס בתחתית
4. הדפדפן ייפתח ב-`http://localhost:5500`

### שיטה 2 — Debugger מובנה
1. פתח את התיקייה ב-VS Code
2. לחץ `F5` או `Run → Start Debugging`
3. בחר **"Launch SKYFORCE in Chrome"**

### שיטה 3 — פתיחה ישירה
פתח את `index.html` ישירות בדפדפן.
> ⚠️ חלק מהדפדפנים חוסמים WebGL בפתיחה ישירה מהדיסק. Live Server עדיף.

## שליטה

| מקש | פעולה |
|-----|--------|
| `↑ ↓ ← →` | כיוון הטיסה |
| `W / S` | הגברת / הורדת גז |
| `Space` | ירי |
| `1 / 2 / 3` | מקלע / טיל / פצצה |
| `V` | החלפת מצלמה |
| `G` | כיסוי נחיתה |
| `Escape` | הגדרות |

## דרישות

- דפדפן עם תמיכת **WebGL 2** (Chrome 80+, Firefox 75+, Edge 80+)
- Three.js r128 נטען מ-CDN אוטומטית
