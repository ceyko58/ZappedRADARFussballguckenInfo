# Fußball-Agent ⚽🤖

Täglicher Scraper für **fussballgucken.info/fussball-heute**.
Holt die Seite, lässt **OpenAI** die Spiele + Übertragungssender extrahieren und übersetzt Summary + Stage in **Deutsch, Türkisch und Englisch**. Speichert alles als `matches.json`, das deine App lädt.

---

## So funktioniert es

```
GitHub Actions (täglich 07:00) ─► scraper.js
       │
       ▼
   fussballgucken.info ─► HTML säubern ─► OpenAI API (DE/TR/EN) ─► matches.json
                                                                         │
                                                                         ▼
                                                                  deine App (fetch)
                                                              mit Sprach-Umschalter
```

---

## Setup in 5 Schritten

### 1) Neues GitHub-Repo erstellen
Erstelle ein neues Repo und lade alle Dateien hoch:

```
fussball-agent/
├── scraper.js
├── package.json
├── app-integration.html
├── .github/workflows/daily-scrape.yml
└── public/             (wird automatisch erstellt)
```

### 2) OpenAI API Key als Secret hinterlegen
Im Repo: **Settings → Secrets and variables → Actions → New repository secret**

- Name: `OPENAI_API_KEY`
- Value: dein OpenAI-Key (sk-...)

### 3) Workflow aktivieren
Tab **Actions** → Workflow „Daily Fußball-Scraper" → **Run workflow** klicken (Testlauf).
Danach läuft er **täglich automatisch um 07:00 Uhr deutscher Zeit**.

### 4) JSON-URL kopieren
Nach dem ersten Lauf liegt die Datei hier:

```
https://raw.githubusercontent.com/DEIN-USER/DEIN-REPO/main/public/matches.json
```

### 5) In die App einbauen
In `app-integration.html` die Konstante `MATCHES_URL` mit der URL aus Schritt 4 ersetzen. Dann den Block in deine App einfügen.

Die App zeigt automatisch einen **Sprach-Umschalter DE / TR / EN** und merkt sich die Auswahl im `localStorage`.

---

## Lokal testen

```bash
cd fussball-agent
npm install
export OPENAI_API_KEY=sk-xxxxx
npm start
# → public/matches.json wird erzeugt
```

---

## JSON-Struktur (mehrsprachig)

```json
{
  "date": "2026-05-15",
  "generatedAt": "2026-05-15T05:00:12.000Z",
  "source": "https://fussballgucken.info/fussball-heute",
  "languages": ["de", "tr", "en"],
  "summary": {
    "de": "Highlight heute: Aston Villa gegen FC Liverpool um 21 Uhr live bei Sky/WOW.",
    "tr": "Günün öne çıkan maçı: Aston Villa - Liverpool, saat 21:00, Sky/WOW.",
    "en": "Today's highlight: Aston Villa vs Liverpool at 9pm live on Sky/WOW."
  },
  "matches": [
    {
      "time": "21:00",
      "competition": "Premier League (England)",
      "stage": {
        "de": "37. Spieltag",
        "tr": "37. Hafta",
        "en": "Matchday 37"
      },
      "homeTeam": "Aston Villa",
      "awayTeam": "FC Liverpool",
      "channels": ["Sky Sport Premier League", "Sky Sport Top Event", "WOW", "Sky Go"],
      "isHighlight": true
    }
  ]
}
```

**Was wird übersetzt?**
- ✅ `summary` (Tages-Highlight-Beschreibung)
- ✅ `stage` (z. B. Spieltag, Halbfinale, Playoff)
- ❌ Teamnamen, Wettbewerbsnamen, Sender → bleiben als Eigennamen unverändert

---

## Kosten

Pro Lauf (1× täglich) mit `gpt-4o-mini`, DE/TR/EN-Output:
- Input: ~15.000 Tokens (≈ 0,002 €)
- Output: ~3.000 Tokens (≈ 0,002 €)
- **Ca. 0,004 € pro Tag = unter 1,50 € pro Jahr**

Höhere Qualität? `OPENAI_MODEL=gpt-4o` in der Action-YAML setzen.

---

## Troubleshooting

- **Leeres `matches`-Array** → Seitenstruktur evtl. geändert. `pageText` im Action-Log prüfen.
- **Auth-Fehler bei OpenAI** → API-Key prüfen + Guthaben auf platform.openai.com.
- **Push schlägt fehl** → **Settings → Actions → General → Workflow permissions** auf „Read and write" stellen.
- **Cron läuft nicht** → GitHub stoppt Schedules nach 60 Tagen Inaktivität. 1× manuell pushen.
- **Türkische Sonderzeichen kaputt** → Sicherstellen, dass deine HTML-App `<meta charset="utf-8">` hat.

---

## Erweiterungen (optional)

- **Weitere Sprachen** (z. B. Kabardisch): Im Prompt in `scraper.js` einfach `"kbd"` als Key dem Schema hinzufügen, und in `app-integration.html` zur Sprachliste in `I18N` ergänzen.
- **Push-Notification**: Nach dem Schreiben einen Telegram-/Discord-Webhook in `scraper.js` aufrufen.
- **Filter nach Liga**: In der App nur Spiele anzeigen, wo `competition` bestimmte Strings enthält.
