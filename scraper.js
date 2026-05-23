// scraper.js — OHNE KI, reines Parsing mit Cheerio
import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";

const SOURCE_URL = "https://fussballgucken.info/fussball-heute";
const OUTPUT_DIR = process.env.OUTPUT_DIR || "./public";
const OUTPUT_FILE = path.join(OUTPUT_DIR, "matches.json");

function berlinLocalToISO(dateStr, timeStr) {
  const probe = new Date(`${dateStr}T12:00:00Z`);
  const berlinHour = parseInt(
    new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", hour: "2-digit", hour12: false }).format(probe)
  );
  const off = berlinHour - 12;
  return `${dateStr}T${timeStr}:00+${String(off).padStart(2, "0")}:00`;
}

function extractPageDate(html) {
  const meta = html.match(/<meta[^>]+name=["']date["'][^>]+content=["']([^"']+)["']/i);
  if (meta) { const d = meta[1].slice(0, 10); if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d; }
  const bc = html.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (bc) return `${bc[3]}-${bc[2].padStart(2, "0")}-${bc[1].padStart(2, "0")}`;
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Berlin" });
}

function translateStage(de) {
  if (!de) return { de: "", tr: "", en: "" };
  const rules = [
    [/Spieltag/gi, { tr: "Hafta", en: "Matchday" }],
    [/Halbfinale/gi, { tr: "Yarı Final", en: "Semi-final" }],
    [/Viertelfinale/gi, { tr: "Çeyrek Final", en: "Quarter-final" }],
    [/Achtelfinale/gi, { tr: "Son 16 Turu", en: "Round of 16" }],
    [/Finale/gi, { tr: "Final", en: "Final" }],
    [/Play-?off/gi, { tr: "Play-off", en: "Play-off" }],
    [/Playout/gi, { tr: "Play-out", en: "Play-out" }],
    [/Hinspiel/gi, { tr: "İlk maç", en: "First leg" }],
    [/Rückspiel/gi, { tr: "Rövanş", en: "Second leg" }],
    [/Relegation/gi, { tr: "Baraj", en: "Relegation" }],
    [/Qualifikation/gi, { tr: "Eleme", en: "Qualification" }],
    [/Aufstieg/gi, { tr: "Yükselme", en: "Promotion" }],
    [/Gruppe/gi, { tr: "Grup", en: "Group" }],
  ];
  let tr = de, en = de;
  for (const [re, t] of rules) { tr = tr.replace(re, t.tr); en = en.replace(re, t.en); }
  en = en.replace(/(\d+)\.\s*Matchday/gi, "Matchday $1");
  return { de, tr, en };
}

function isHighlight(comp) {
  const c = (comp || "").toLowerCase();
  return ["premier league", "la liga", "bundesliga", "serie a", "ligue 1",
    "champions league", "europa league", "dfb-pokal", "fa cup", "conference league"].some((k) => c.includes(k));
}

function splitTeams(slug, teamMap) {
  const keys = Object.keys(teamMap).sort((a, b) => b.length - a.length);
  for (const home of keys) {
    if (slug.startsWith(home + "-")) {
      const rest = slug.slice(home.length + 1);
      if (teamMap[rest]) return { home: teamMap[home], away: teamMap[rest] };
    }
  }
  for (const away of keys) {
    if (slug.endsWith("-" + away)) {
      const rest = slug.slice(0, slug.length - away.length - 1);
      if (teamMap[rest]) return { home: teamMap[rest], away: teamMap[away] };
    }
  }
  return { home: null, away: null };
}

function parseMatches(html) {
  const $ = cheerio.load(html);
  $("script, style, noscript, header, footer, nav").remove();

  const teamMap = {};
  $('a[href*="/team/"]').each((_, el) => {
    const href = $(el).attr("href") || "";
    const m = href.match(/\/team\/([^/"?#]+)/);
    const name = $(el).text().trim();
    if (m && name) teamMap[m[1].toLowerCase()] = name;
  });

  const tokens = [];
  $("body *").each((_, el) => {
    const $el = $(el);
    const leaf = $el.children().length === 0 ? $el.text().trim() : "";
    if (leaf && /^\d{1,2}:\d{2}$/.test(leaf)) { tokens.push({ type: "time", value: leaf }); return; }
    if (leaf && leaf.length < 60 &&
      /(\d{1,2}\.\s*Spieltag|Halbfinale|Viertelfinale|Achtelfinale|Finale|Play-?off|Playout|Hinspiel|Rückspiel|Relegation|Qualifikation|Aufstieg|Gruppe)/i.test(leaf)) {
      tokens.push({ type: "stage", value: leaf }); return;
    }
    if (el.tagName === "a") {
      const href = $el.attr("href") || "";
      if (/\/match\/\d+/.test(href)) {
        const m = href.match(/\/match\/(\d+)\/([^/]+)\/([^/"?#]+)/);
        if (m) tokens.push({ type: "match", id: m[1], compSlug: m[2], teamsSlug: m[3].toLowerCase() });
      } else if (href.includes("/wettbewerb/")) {
        const name = $el.text().trim(); if (name) tokens.push({ type: "comp", name });
      } else if (href.includes("/sender/")) {
        const name = $el.text().trim();
        if (name && !/Sender-Optionen/i.test(name)) tokens.push({ type: "sender", name });
      }
    }
  });

  const matches = [];
  let cur = null, lastTime = "", lastComp = "", stageParts = [];
  for (const t of tokens) {
    if (t.type === "time") { lastTime = t.value; stageParts = []; }
    else if (t.type === "comp") lastComp = t.name;
    else if (t.type === "stage") stageParts.push(t.value);
    else if (t.type === "match") {
      if (!cur || cur._id !== t.id) {
        const { home, away } = splitTeams(t.teamsSlug, teamMap);
        if (home && away) {
          cur = { _id: t.id, time: lastTime, competition: lastComp || t.compSlug.replace(/-/g, " "),
            stage: translateStage(stageParts.join(" ").trim()), homeTeam: home, awayTeam: away,
            channels: [], isHighlight: isHighlight(lastComp) };
          matches.push(cur); stageParts = [];
        } else cur = { _id: t.id, _skip: true };
      }
    } else if (t.type === "sender" && cur && !cur._skip) {
      if (!cur.channels.includes(t.name)) cur.channels.push(t.name);
    }
  }

  return matches.filter((m) => !m._skip && m.time).map(({ _id, _skip, ...c }) => c);
}

function buildSummary(matches) {
  const n = matches.length;
  const top = matches.find((m) => m.isHighlight) || matches[0];
  if (!top) return { de: "Heute keine Übertragungen.", tr: "Bugün yayın yok.", en: "No broadcasts today." };
  const g = `${top.homeTeam} - ${top.awayTeam}`;
  return {
    de: `${n} Übertragungen heute, u.a. ${g} (${top.time} Uhr).`,
    tr: `Bugün ${n} yayın, ${g} dahil (${top.time}).`,
    en: `${n} broadcasts today, including ${g} (${top.time}).`,
  };
}

async function fetchPage() {
  const res = await fetch(SOURCE_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; FussballAgent/1.0)", "Accept-Language": "de-DE,de;q=0.9" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

async function main() {
  console.log(`▶︎ Lade ${SOURCE_URL} …`);
  const html = await fetchPage();
  const date = extractPageDate(html);
  console.log(`📅 Datum: ${date}`);

  console.log("▶︎ Parse Spiele …");
  const matches = parseMatches(html);
  console.log(`▶︎ ${matches.length} Spiele gefunden`);
  if (matches[0]) console.log(`▶︎ Beispiel: ${matches[0].time} ${matches[0].homeTeam} - ${matches[0].awayTeam} [${matches[0].channels.slice(0,3).join(", ")}]`);

  for (const m of matches) m.kickoff = berlinLocalToISO(date, m.time);

  const data = {
    date, generatedAt: new Date().toISOString(), source: SOURCE_URL,
    languages: ["de", "tr", "en"], summary: buildSummary(matches), matches,
  };

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(OUTPUT_FILE, JSON.stringify(data, null, 2), "utf8");
  console.log(`✅ ${matches.length} Spiele für ${date} → ${OUTPUT_FILE}`);
  console.log("✨ Fertig.");
}

main().catch((err) => { console.error("❌ Fehler:", err); process.exit(1); });
