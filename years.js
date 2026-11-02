// Finds a song's original release year. Spotify only knows the date of the album a track is on,
// so compilations and remasters get the wrong year. Apple's iTunes catalog and MusicBrainz both
// track earlier releases of the same song; the earliest year any source reports usually wins.

const YEAR_SOURCES = [
  // Apple allows roughly 20 searches a minute; MusicBrainz one request a second.
  { key: "itunesYear", name: "iTunes", intervalMs: 3200, lookup: lookupItunes },
  { key: "mbYear", name: "MusicBrainz", intervalMs: 1100, lookup: lookupMusicBrainz },
];

const TITLE_NOISE =
  /\b(feat|ft|with|remaster|remastered|version|edit|mix|mono|stereo|live|demo|acoustic|bonus|deluxe|anniversary|single)\b/i;

/** "Bohemian Rhapsody - Remastered 2011" → "Bohemian Rhapsody", "Song (feat. X)" → "Song". */
function cleanTitle(title) {
  return title
    .replace(/\s+-\s+.*$/, "")
    .replace(/\s*[([][^)\]]*[)\]]/g, (part) => (TITLE_NOISE.test(part) ? "" : part))
    .trim();
}

function normalize(text) {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, "");
}

function sameArtist(a, b) {
  const x = normalize(a);
  const y = normalize(b);
  return x.length > 0 && y.length > 0 && (x.includes(y) || y.includes(x));
}

function yearOf(date) {
  const year = Number(String(date || "").slice(0, 4));
  return year >= 1900 ? year : null;
}

function earliest(years) {
  const found = years.filter((y) => typeof y === "number");
  return found.length ? Math.min(...found) : null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Fetch JSON, backing off when a service says we're going too fast (or the network blips). */
async function fetchJson(url) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url).catch(() => null);
    if (response?.ok) return response.json();
    const retryable = !response || [403, 429, 503].includes(response.status);
    if (!retryable || attempt >= 3) throw new Error(response ? "HTTP " + response.status : "network error");
    await sleep(5000 * 2 ** attempt);
  }
}

/** Returns the earliest matching year, or null if the song wasn't found. Throws on service errors. */
async function lookupItunes(track) {
  const title = cleanTitle(track.title);
  const params = new URLSearchParams({ term: `${title} ${track.primaryArtist}`, entity: "song", media: "music", limit: "25" });
  const data = await fetchJson("https://itunes.apple.com/search?" + params);
  return earliest(
    data.results
      .filter((r) => normalize(cleanTitle(r.trackName || "")) === normalize(title) && sameArtist(r.artistName || "", track.primaryArtist))
      .map((r) => yearOf(r.releaseDate)),
  );
}

async function lookupMusicBrainz(track) {
  const title = cleanTitle(track.title);
  const quote = (s) => '"' + s.replace(/[\\"]/g, "\\$&") + '"';
  const query = `recording:${quote(title)} AND artist:${quote(track.primaryArtist)}`;
  const data = await fetchJson(
    "https://musicbrainz.org/ws/2/recording?fmt=json&limit=100&query=" + encodeURIComponent(query),
  );
  return earliest(
    data.recordings
      .filter(
        (r) =>
          normalize(r.title) === normalize(title) &&
          (r["artist-credit"] || []).some((credit) => sameArtist(credit.name, track.primaryArtist)),
      )
      .map((r) => yearOf(r["first-release-date"])),
  );
}

// ---------- remembered results (this browser only) ----------

function readCache(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

function writeCache(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: lookups simply run again next time.
  }
}

function restoreYears(track) {
  const cached = readCache("years:v1:" + track.id);
  if (cached) Object.assign(track, cached);
  track.manualYear = readCache("manual-year:v1:" + track.id) || "";
}

function rememberYears(track) {
  const saved = {};
  for (const source of YEAR_SOURCES) if (track[source.key] !== undefined) saved[source.key] = track[source.key];
  writeCache("years:v1:" + track.id, saved);
}

function rememberManualYear(track) {
  writeCache("manual-year:v1:" + track.id, track.manualYear || null);
}
