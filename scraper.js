// scraper.js
// Täglicher Fußball-Agent für https://fussballgucken.info/fussball-heute
// Holt die Seite, extrahiert Spiele + Sender mit OpenAI API (DE/TR/EN), speichert als JSON.

import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import OpenAI from "openai";

const SOURCE_URL = "https://fussballgucken.info/fussball-heute";
const OUTPUT_DIR = process.env.OUTPUT_DIR || "./public";
const OUTPUT_FILE = path.join(OUTPUT_DIR, "matches.json");
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Helper: konvertiert Berlin-Lokalzeit in ISO-Format mit Offset
function berlinLocalToISO(dateStr, timeStr) {
  const probe = new Date(`${dateStr}T12:00:00Z`);
  const berlinHour = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Berlin",
      hour: "2-digit",
      hour12: false,
    }).format(probe)
  );
  const offsetHours = berlinHour - 12; // 1 oder 2
  const offsetStr = `+${String(offsetHours).padStart(2, "0")}:00`;
  return `${dateStr}T${timeStr}:00${offsetStr}`;
}

// 1) Seite holen
async function fetchPage() {
  const res = await fetch(SOURCE_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; FussballAgent/1.0)",
      "Accept-Language": "de-DE,de;q=0.9",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} beim Laden von ${SOURCE_URL}`);
  return await res.text();
}

// 2) HTML säubern
function extractRelevantText(html) {
  const $ = cheerio.load(html);
  $("script, style, noscript, header, footer, nav, aside").remove();
  $('[class*="ad"], [class*="anzeige"], [id*="ad"]').remove();
  const mainHtml = $("main").html() || $("body").html() || "";
  const $main = cheerio.load(mainHtml);
  const text = $main.root().text()
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return text.slice(0, 60000);
}

// 3) OpenAI extrahiert Spiele in DE/TR/EN
async function extractMatchesWithLLM(pageText) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Berlin" });

  const systemPrompt = `Du bist ein Daten-Extraktions- und Übersetzungs-Assistent.
Du bekommst den Textinhalt einer deutschen Fußball-TV-Seite und extrahierst ALLE Spiele des Tages mit ihren Übertragungssendern.
Du übersetzt bestimmte Felder ins Deutsche (de), Türkische (tr) und Englische (en).
Antworte AUSSCHLIESSLICH mit gültigem JSON.`;

  const userPrompt = `Extrahiere aus dem folgenden Seiteninhalt alle Fußballspiele des heutigen Tages (${today}).

Gib das Ergebnis in diesem JSON-Schema zurück:

{
  "date": "YYYY-MM-DD",
  "summary": {
    "de": "1-2 Sätze auf Deutsch: was ist heute das Highlight?",
    "tr": "Aynı içerik Türkçe (1-2 cümle)",
    "en": "Same content in English (1-2 sentences)"
  },
  "matches": [
    {
      "time": "HH:MM",
      "competition": "z.B. Premier League (England)",
      "stage": {
        "de": "z.B. 37. Spieltag",
        "tr": "37. Hafta",
        "en": "Matchday 37"
      },
      "homeTeam": "Heimmannschaft",
      "awayTeam": "Gastmannschaft",
      "channels": ["Sender 1", "Sender 2"],
      "isHighlight": true
    }
  ]
}

Wichtige Regeln:
- ALLE Spiele extrahieren.
- Teamnamen, Wettbewerbsnamen und Sender NICHT übersetzen (Eigennamen).
- Übersetzt werden NUR "summary" und "stage" (komplett in alle 3 Sprachen).
- "isHighlight" = true bei großen Ligen (Premier League, La Liga, Bundesliga, Serie A, Ligue 1, Champions League, Europa League, etc.).
- Wenn keine Spiele: { "date": "${today}", "matches": [], "summary": { "de": "Keine Spiele.", "tr": "Maç yok.", "en": "No matches." } }

SEITENINHALT:
"""
${pageText}
"""`;

  const completion = await openai.chat.completions.create({
    model: MODEL,
    response_format: { type: "json_object" },
    temperature: 0,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const parsed = JSON.parse(completion.choices[0].message.content);
  parsed.generatedAt = new Date().toISOString();
  parsed.source = SOURCE_URL;
  parsed.languages = ["de", "tr", "en"];

  // Kickoff-Feld pro Spiel hinzufügen (ISO mit Berlin-Offset)
  if (Array.isArray(parsed.matches)) {
    parsed.matches = parsed.matches.map((m) => ({
      ...m,
      kickoff: berlinLocalToISO(parsed.date, m.time),
    }));
  }

  return parsed;
}

// 4) Schreiben
async function writeOutput(data) {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(OUTPUT_FILE, JSON.stringify(data, null, 2), "utf8");
  console.log(`✅ ${data.matches?.length ?? 0} Spiele → ${OUTPUT_FILE}`);
}

// 5) Main
async function main() {
  console.log(`▶︎ Lade ${SOURCE_URL} …`);
  const html = await fetchPage();

  console.log("▶︎ Bereinige HTML …");
  const text = extractRelevantText(html);

  console.log(`▶︎ Sende ${text.length} Zeichen an OpenAI (${MODEL}) …`);
  const data = await extractMatchesWithLLM(text);

  console.log(`▶︎ Speichere Ergebnis …`);
  await writeOutput(data);

  console.log("✨ Fertig.");
}

main().catch((err) => {
  console.error("❌ Fehler:", err);
  process.exit(1);
});
