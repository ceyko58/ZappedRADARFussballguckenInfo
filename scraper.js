// scraper.js
import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import OpenAI from "openai";

const SOURCE_URL = "https://fussballgucken.info/fussball-heute";
const OUTPUT_DIR = process.env.OUTPUT_DIR || "./public";
const OUTPUT_FILE = path.join(OUTPUT_DIR, "matches.json");
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function berlinLocalToISO(dateStr, timeStr) {
  const probe = new Date(`${dateStr}T12:00:00Z`);
  const berlinHour = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Berlin",
      hour: "2-digit",
      hour12: false,
    }).format(probe)
  );
  const offsetHours = berlinHour - 12;
  const offsetStr = `+${String(offsetHours).padStart(2, "0")}:00`;
  return `${dateStr}T${timeStr}:00${offsetStr}`;
}

// NEU: Datum direkt aus HTML extrahieren
function extractPageDate(html) {
  // Versuch 1: meta-date Tag
  const metaMatch = html.match(/<meta[^>]+name=["']date["'][^>]+content=["']([^"']+)["']/i);
  if (metaMatch) {
    const dateStr = metaMatch[1].slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      console.log(`📅 Datum aus meta-date: ${dateStr}`);
      return dateStr;
    }
  }

  // Versuch 2: Breadcrumb "DD.MM.YYYY"
  const breadcrumbMatch = html.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (breadcrumbMatch) {
    const [, d, m, y] = breadcrumbMatch;
    const dateStr = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    console.log(`📅 Datum aus Breadcrumb: ${dateStr}`);
    return dateStr;
  }

  // Fallback: heute in Berlin
  const fallback = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Berlin" });
  console.log(`📅 Datum-Fallback (heute Berlin): ${fallback}`);
  return fallback;
}

async function fetchPage() {
  const res = await fetch(SOURCE_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; FussballAgent/1.0)",
      "Accept-Language": "de-DE,de;q=0.9",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

function extractRelevantText(html) {
  const $ = cheerio.load(html);
  $("script, style, noscript, header, footer, nav, aside").remove();
  $('[class*="ad"], [class*="anzeige"], [id*="ad"]').remove();
  const mainHtml = $("main").html() || $("body").html() || "";
  const $main = cheerio.load(mainHtml);
  return $main.root().text()
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
    .slice(0, 60000);
}

async function extractMatchesWithLLM(pageText, pageDate) {
  const systemPrompt = `Du bist ein Daten-Extraktions- und Übersetzungs-Assistent.
Antworte AUSSCHLIESSLICH mit gültigem JSON.`;

  const userPrompt = `Extrahiere ALLE Fußballspiele aus dem folgenden Text einer deutschen Fußball-TV-Übersichtsseite.

WICHTIG: Extrahiere JEDES einzelne Spiel das du im Text findest. Filtere NICHT nach Datum. Der Text enthält bereits nur die Spiele eines Tages.

Format pro Spiel im Text:
- Uhrzeit (z.B. "21:00")
- Wettbewerb (z.B. "Premier League (England)")
- Heim-Team und Auswärts-Team (durch Match-Link getrennt)
- "N Sender-Optionen" und Liste der Sender

JSON-Schema:

{
  "summary": {
    "de": "1-2 Sätze: was ist das Highlight?",
    "tr": "Türkçe (1-2 cümle)",
    "en": "English (1-2 sentences)"
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
      "homeTeam": "Heim",
      "awayTeam": "Auswärts",
      "channels": ["Sender 1", "Sender 2"],
      "isHighlight": true
    }
  ]
}

Regeln:
- ALLE Spiele extrahieren - lass NICHTS aus.
- Eigennamen (Teams, Wettbewerbe, Sender) NICHT übersetzen.
- "isHighlight" = true bei Premier League, La Liga, Bundesliga, Serie A, Ligue 1, Champions League, Europa League, DFB-Pokal-Finale, FA Cup Finale.

TEXT:
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
  parsed.date = pageDate; // Datum aus HTML, nicht aus LLM!
  parsed.generatedAt = new Date().toISOString();
  parsed.source = SOURCE_URL;
  parsed.languages = ["de", "tr", "en"];

  if (Array.isArray(parsed.matches)) {
    parsed.matches = parsed.matches.map((m) => ({
      ...m,
      kickoff: berlinLocalToISO(parsed.date, m.time),
    }));
  }

  return parsed;
}

async function writeOutput(data) {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(OUTPUT_FILE, JSON.stringify(data, null, 2), "utf8");
  console.log(`✅ ${data.matches?.length ?? 0} Spiele für ${data.date} → ${OUTPUT_FILE}`);
}

async function main() {
  console.log(`▶︎ Lade ${SOURCE_URL} …`);
  const html = await fetchPage();

  const pageDate = extractPageDate(html);

  console.log("▶︎ Bereinige HTML …");
  const text = extractRelevantText(html);
  console.log(`▶︎ ${text.length} Zeichen extrahiert`);

  console.log(`▶︎ Sende an OpenAI (${MODEL}) …`);
  const data = await extractMatchesWithLLM(text, pageDate);

  console.log(`▶︎ Speichere ${data.matches?.length ?? 0} Spiele …`);
  await writeOutput(data);

  console.log("✨ Fertig.");
}

main().catch((err) => {
  console.error("❌ Fehler:", err);
  process.exit(1);
});
