// Spotify login (authorization code + PKCE, no client secret needed) and the page UI.

const CLIENT_ID = "1652834e382b49d588864e2a9a3cf6f0";
// Wherever the page is hosted (GitHub Pages or start.bat); each address must be registered on the dashboard.
const REDIRECT_URI = location.origin + location.pathname.replace(/index\.html$/, "");
const SCOPES = "playlist-read-private playlist-read-collaborative";

const $ = (id) => document.getElementById(id);
let tracks = [];
let playlistName = "playlist";
let lookupSession = 0; // bumped to cancel running year lookups

// ---------- auth ----------

function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function login() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  sessionStorage.setItem("pkce_verifier", verifier);
  sessionStorage.setItem("pending_playlist", $("playlist").value);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    scope: SCOPES,
    redirect_uri: REDIRECT_URI,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });
  location.href = "https://accounts.spotify.com/authorize?" + params;
}

async function finishLogin(code) {
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: sessionStorage.getItem("pkce_verifier") || "",
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || data.error || "login failed");
  sessionStorage.setItem("token", data.access_token);
  sessionStorage.setItem("token_expires", String(Date.now() + (data.expires_in - 60) * 1000));
}

function token() {
  const expires = Number(sessionStorage.getItem("token_expires") || 0);
  return Date.now() < expires ? sessionStorage.getItem("token") : null;
}

// ---------- Spotify API ----------

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function api(url) {
  const response = await fetch(url.startsWith("http") ? url : "https://api.spotify.com/v1" + url, {
    headers: { Authorization: "Bearer " + token() },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(response.status, body.error?.message || response.statusText);
  }
  return response.json();
}

function playlistId(input) {
  const match = input.trim().match(/(?:playlist[/:])([A-Za-z0-9]{22})/) || input.trim().match(/^([A-Za-z0-9]{22})$/);
  return match ? match[1] : null;
}

async function loadPlaylist() {
  const id = playlistId($("playlist").value);
  if (!id) return showStatus("That doesn't look like a Spotify playlist link.", "error");
  if (!token()) return login();

  lookupSession++;
  showStatus("Loading playlist…");
  $("tracks-section").hidden = true;
  try {
    const meta = await api(`/playlists/${id}?fields=name,owner(display_name)`);
    playlistName = meta.name || "playlist";
    const loaded = [];
    let next = `/playlists/${id}/items?limit=50`;
    while (next) {
      const page = await api(next);
      for (const row of page.items) {
        // Spotify renamed "track" to "item" in 2026; accept either.
        const t = row.item && typeof row.item === "object" ? row.item : row.track;
        if (!t || t.type !== "track" || row.is_local || !t.id) continue;
        const track = {
          id: t.id,
          url: "https://open.spotify.com/track/" + t.id,
          title: t.name,
          artist: (t.artists || []).map((a) => a.name).join(", "),
          primaryArtist: t.artists?.[0]?.name || "",
          spotifyYear: yearOf(t.album?.release_date),
          include: true,
        };
        restoreYears(track);
        loaded.push(track);
      }
      next = page.next;
      showStatus(`Loading playlist… ${loaded.length} songs`);
    }
    tracks = loaded;
    renderTracks();
    showStatus(`Loaded “${playlistName}” by ${meta.owner?.display_name || "unknown"}: ${tracks.length} songs.`, "ok");
    startYearLookups();
  } catch (e) {
    if (e.status === 401) return login();
    if (e.status === 403) {
      return showStatus(
        "Spotify only lets this app read playlists you own or collaborate on. " +
          "Open the playlist in Spotify, choose “⋯ → Add to other playlist → New playlist”, " +
          "then paste the link of that copy here.",
        "error",
      );
    }
    if (e.status === 404) return showStatus("Playlist not found. Is the link right?", "error");
    showStatus("Could not load the playlist: " + e.message, "error");
  }
}

// ---------- years ----------

function betterYears() {
  return $("better-years").checked;
}

function looked(track, source) {
  return track[source.key] !== undefined || track[source.key + "Failed"];
}

/** The year printed on the card. */
function cardYear(track) {
  if (track.manualYear) return track.manualYear;
  const year = betterYears() ? earliest([track.spotifyYear, track.itunesYear, track.mbYear]) : track.spotifyYear;
  return year ? String(year) : "";
}

/** Why a row deserves a second look, or "" when it looks fine. */
function checkReason(track) {
  if (!betterYears() || track.manualYear || !YEAR_SOURCES.every((s) => looked(track, s))) return "";
  const { itunesYear: it, mbYear: mb } = track;
  if (typeof it !== "number" && typeof mb !== "number") return "Not found in iTunes or MusicBrainz, so this is Spotify's year.";
  if (typeof it === "number" && typeof mb === "number" && Math.abs(it - mb) > 1) return "iTunes and MusicBrainz disagree.";
  return "";
}

function startYearLookups() {
  const session = ++lookupSession;
  if (!betterYears()) return updateProgress();
  for (const source of YEAR_SOURCES) runYearSource(source, session);
  updateProgress();
}

async function runYearSource(source, session) {
  for (const track of tracks) {
    if (session !== lookupSession) return;
    if (looked(track, source)) continue;
    const started = Date.now();
    try {
      track[source.key] = await source.lookup(track);
      rememberYears(track);
    } catch {
      // Not remembered, so it's retried the next time this song is loaded.
      track[source.key + "Failed"] = true;
    }
    if (session !== lookupSession) return;
    updateRow(track);
    updateProgress();
    await sleep(source.intervalMs - (Date.now() - started));
  }
}

function updateProgress() {
  const el = $("year-progress");
  if (!betterYears() || tracks.length === 0) {
    el.hidden = true;
    return;
  }
  const parts = YEAR_SOURCES.map((s) => `${s.name} ${tracks.filter((t) => looked(t, s)).length}/${tracks.length}`);
  const secondsLeft = Math.max(
    ...YEAR_SOURCES.map((s) => (tracks.filter((t) => !looked(t, s)).length * s.intervalMs) / 1000),
  );
  const toCheck = tracks.filter((t) => checkReason(t)).length;
  el.hidden = false;
  if (secondsLeft > 0) {
    const left = secondsLeft < 90 ? `${Math.ceil(secondsLeft)} s` : `${Math.ceil(secondsLeft / 60)} min`;
    el.textContent = `Finding original years… ${parts.join(" · ")} · about ${left} left. You can already review rows or download.`;
  } else {
    el.textContent =
      `Original years found for ${tracks.length} songs.` +
      (toCheck ? ` ${toCheck} highlighted row${toCheck === 1 ? "" : "s"} could use a check.` : "");
  }
}

// ---------- UI ----------

function showStatus(text, kind = "") {
  const el = $("status");
  el.textContent = text;
  el.className = "status " + kind;
  el.hidden = !text;
}

function sourceCell(track, source) {
  if (track[source.key + "Failed"]) return "error";
  if (track[source.key] === undefined) return "…";
  return track[source.key] ?? "–";
}

function renderTracks() {
  const body = $("track-rows");
  body.replaceChildren();
  tracks.forEach((t, i) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><input type="checkbox" aria-label="Include"></td>
      <td class="num">${i + 1}</td>
      <td></td>
      <td></td>
      <td class="num source"></td>
      <td class="num source"></td>
      <td class="num source"></td>
      <td><input class="year" inputmode="numeric" maxlength="4" aria-label="Year on card"></td>`;
    row.cells[2].textContent = t.title;
    row.cells[3].textContent = t.artist;
    const [include, year] = row.querySelectorAll("input");
    include.checked = t.include;
    include.onchange = () => {
      t.include = include.checked;
      updateCount();
    };
    year.oninput = () => {
      t.manualYear = year.value.trim();
      rememberManualYear(t);
      updateRow(t);
      updateProgress();
    };
    t.row = row;
    updateRow(t);
    body.append(row);
  });
  $("tracks-section").hidden = false;
  updateColumns();
  updateCount();
}

function updateRow(track) {
  const row = track.row;
  if (!row) return;
  row.cells[4].textContent = track.spotifyYear ?? "–";
  YEAR_SOURCES.forEach((source, i) => (row.cells[5 + i].textContent = sourceCell(track, source)));
  const year = row.querySelector("input.year");
  // The input shows the computed year as a placeholder; typing overrides it, clearing restores it.
  year.placeholder = cardYear({ ...track, manualYear: "" }) || "?";
  if (document.activeElement !== year) year.value = track.manualYear;
  const reason = checkReason(track);
  row.classList.toggle("check", !!reason);
  row.title = reason;
}

function updateColumns() {
  $("track-table").classList.toggle("spotify-only", !betterYears());
}

function updateCount() {
  const n = tracks.filter((t) => t.include).length;
  const sheets = Math.ceil(n / 12);
  $("count").textContent = `${n} cards selected · ${sheets} sheet${sheets === 1 ? "" : "s"} (${sheets * 2} pages)`;
  $("generate").disabled = n === 0;
}

function onBetterYearsChange() {
  try {
    localStorage.setItem("better_years", betterYears() ? "1" : "0");
  } catch {}
  if (tracks.length) {
    tracks.forEach(updateRow);
    updateColumns();
    startYearLookups();
  }
}

function generatePdf() {
  const chosen = tracks
    .filter((t) => t.include)
    .map((t) => ({ url: t.url, title: t.title, artist: t.artist, year: cardYear(t) }));
  const doc = buildCardsPdf(chosen, { flip: $("flip").value, cutLines: $("cut-lines").checked });
  const safeName = playlistName.replace(/[^\w\- ]+/g, "").trim() || "playlist";
  doc.save(`${safeName} - song cards.pdf`);
}

function updateLoginState() {
  $("login-state").textContent = token() ? "Logged in to Spotify" : "Not logged in yet. You'll be asked when you load a playlist.";
}

async function init() {
  $("load").onclick = loadPlaylist;
  $("playlist").addEventListener("keydown", (e) => {
    if (e.key === "Enter") loadPlaylist();
  });
  $("generate").onclick = generatePdf;
  $("select-all").onclick = () => {
    const all = tracks.every((t) => t.include);
    tracks.forEach((t) => (t.include = !all));
    renderTracks();
  };
  try {
    $("better-years").checked = localStorage.getItem("better_years") !== "0";
  } catch {}
  $("better-years").onchange = onBetterYearsChange;

  const params = new URLSearchParams(location.search);
  history.replaceState(null, "", location.pathname);
  if (params.get("error")) showStatus("Spotify login was cancelled: " + params.get("error"), "error");
  if (params.get("code")) {
    try {
      await finishLogin(params.get("code"));
      const pending = sessionStorage.getItem("pending_playlist");
      if (pending) {
        $("playlist").value = pending;
        sessionStorage.removeItem("pending_playlist");
        loadPlaylist();
      }
    } catch (e) {
      showStatus("Spotify login failed: " + e.message, "error");
    }
  }
  updateLoginState();
}

if (location.hostname === "localhost") {
  // Spotify rejects "localhost" redirect URIs; the loopback IP is allowed.
  location.replace(location.href.replace("//localhost", "//127.0.0.1"));
} else {
  init();
}
