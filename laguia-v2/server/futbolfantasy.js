const FF_ORIGIN = 'https://www.futbolfantasy.com';
const FF_FIXTURES = FF_ORIGIN + '/laliga/posibles-alineaciones';
const FF_TTL = 5 * 60 * 1000;
const ffCache = new Map();

// LaLiga and FútbolFantasy use different slugs for these clubs.
const ffClubAliases = new Map(Object.entries({
  'athletic-club': 'athletic', 'atletico-de-madrid': 'atletico', 'fc-barcelona': 'barcelona',
  'real-betis': 'betis', 'rc-celta': 'celta', 'd-alaves': 'alaves', 'rc-deportivo': 'deportivo',
  'elche-c-f': 'elche', 'rcd-espanyol': 'espanyol', 'getafe-cf': 'getafe', 'levante-ud': 'levante',
  'malaga-cf': 'malaga', 'c-a-osasuna': 'osasuna', 'r-racing-club': 'racing', 'sevilla-fc': 'sevilla',
  'valencia-cf': 'valencia', 'villarreal-cf': 'villarreal', 'girona-fc': 'girona',
  'rcd-mallorca': 'mallorca', 'real-oviedo': 'oviedo', 'cd-leganes': 'leganes',
  'r-valladolid-cf': 'valladolid', 'ud-las-palmas': 'las-palmas', 'granada-cf': 'granada',
  'ud-almeria': 'almeria', 'cadiz-cf': 'cadiz',
}));

function ffText(html = '') {
  const entities = {amp: '&', quot: '"', apos: "'", nbsp: ' ', lt: '<', gt: '>'};
  return html.replace(/<[^>]*>/g, ' ').replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|nbsp|lt|gt);/gi, (all, key) => {
    if (key[0] !== '#') return entities[key.toLowerCase()] ?? all;
    const hexadecimal = key[1].toLowerCase() === 'x';
    const code = parseInt(key.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    return code <= 0x10ffff ? String.fromCodePoint(code) : all;
  }).replace(/\s+/g, ' ').trim();
}

function ffKey(s) {
  return ffText(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

function ffAttributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key.toLowerCase(), value]));
}

function ffFixtureIndex(html) {
  const clubs = new Map();
  for (const [tag] of html.matchAll(/<a\s[^>]*\/laliga\/equipos\/[a-z0-9-]+"[^>]*>/g)) {
    const attrs = ffAttributes(tag);
    const slug = attrs.href?.match(/\/laliga\/equipos\/([a-z0-9-]+)$/)?.[1];
    const clubId = attrs.class?.match(/\bteam-(\d+)\b/)?.[1];
    if (slug && clubId && attrs.title) clubs.set(ffKey(attrs.title), {slug, clubId, name: ffText(attrs.title)});
  }

  // The last fixture list is scoped to the selected LaLiga matchday.
  const fixtureList = html.match(/<h3>Posibles onces jornada<\/h3>\s*<ul>([\s\S]*?)<\/ul>/)?.[1] || '';
  const week = ffNumber(html.match(/<option\s+selected\s+value="[^"]*\/laliga\/posibles-alineaciones\/(\d+)"/)?.[1]);
  const fixtures = new Map();
  for (const [, id, label] of fixtureList.matchAll(/href="[^"]*\/partidos\/(\d+)-[a-z0-9-]+">([^<]+)<\/a>/g)) {
    const [home, away] = ffText(label).split(' - ').map(name => clubs.get(ffKey(name)));
    if (!home || !away) continue;
    fixtures.set(home.slug, {...home, matchId: id, rival: away.name, home: true});
    fixtures.set(away.slug, {...away, matchId: id, rival: home.name, home: false});
  }
  if (!week || !fixtures.size) throw Error('FútbolFantasy no ha publicado las alineaciones de la jornada.');
  return {week, fixtures};
}

function ffNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function ffPlayerStats(html) {
  // The public lineup API returns one prefabricated list row per player.
  const rows = [...html.matchAll(/<div class="jugador_(\d+) jugador tipo_lista[^>]*>/g)];
  return rows.flatMap(([tag, id], index) => {
    const a = ffAttributes(tag);
    const row = html.slice(rows[index].index + tag.length, rows[index + 1]?.index ?? html.length);
    const playerLink = row.match(/<a class="jugador my-auto"\s+href="https:\/\/www\.futbolfantasy\.com\/jugadores\/([a-z0-9-]+)(?:\/[a-z0-9-]+)?"[^>]*>\s*<span class="nombre">([^<]+)/);
    if (!playerLink) return [];
    const [, slug, name] = playerLink;
    const count = key => ffNumber(a['data-' + key]);
    const setPieces = {};
    for (const [, kind, accurate, attempted] of row.matchAll(/<span class="value (fc|c|fd|p)">(\d+)<\/span>\s*<span class="fraction"><\/span>\s*<span class="value">(\d+)<\/span>/g)) {
      setPieces[kind] = {accurate: Number(accurate), attempted: Number(attempted)};
    }
    const rank = row.match(/class="[^"]*\bview jerarquias x2\b[^"]*"[^>]*>[\s\S]*?<span class="text-truncate ml-2"[^>]*>([^<]*)/)?.[1];
    const market = row.match(/class="[^"]*\bview mercado x2\b[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1];
    const difficulty = a['data-rival_dificultad']?.match(/\bid-([a-z-]+)/)?.[1];
    const probability = a['data-probabilidad']?.match(/^(\d+)%$/)?.[1];

    return [{
      id, slug, name: ffText(name),
      probability: ffNumber(probability),
      nationality: /^[A-Z]{2}$/.test(a['data-nacionalidad']) ? a['data-nacionalidad'] : null,
      age: count('edad') || null, height: count('altura') || null,
      foot: ffText(a['data-pie']) || null, rank: ffText(rank) || null,
      difficulty: difficulty || null, marketStatus: ffText(market) || null,
      value: count('valor-laliga-fantasy'), dailyChange: count('valor-diff-laliga-fantasy'),
      appearances: count('totalpartidosjugados'), minutes: count('totalminutosjugados'),
      goals: count('totalgoles'), assists: count('totalasistencias'),
      yellow: count('totalamarillas'), red: count('totalrojas'),
      subIn: count('totalpartidosjugadossuplente'), subOut: count('totalpartidossustituido'),
      setPieces,
    }];
  });
}

function ffCached(key, load) {
  const entry = ffCache.get(key);
  if (entry && entry.expires > Date.now()) return entry.result;
  const result = load().catch(error => {
    if (ffCache.get(key)?.result === result) ffCache.delete(key);
    throw error;
  });
  ffCache.set(key, {expires: Date.now() + FF_TTL, result});
  // Remove the old round's entries when the fixture list changes.
  for (const [cachedKey, item] of ffCache) if (item.expires <= Date.now()) ffCache.delete(cachedKey);
  return result;
}

async function ffHtml(url, fetcher) {
  const result = await fetcher(url, {headers: {accept: 'text/html'}, signal: AbortSignal.timeout(12000)});
  if (!result.ok) throw Error('FútbolFantasy no está disponible.');
  return result.text();
}

function ffCurrentStatus(html) {
  const section = html.split('id="profile-status"')[1]?.split('id="profile-partidos"')[0] ?? '';
  const notice = section.match(/<div class="[^"]*\bcomentario\b[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1];
  if (notice) {
    const badge = section.match(/<img\b[^>]*\balt="([^"]+)"[^>]*_box_min\.png"[^>]*>/)?.[1];
    const detail = notice.match(/<span class="[^"]*\blesion\b[^"]*"[^>]*>([\s\S]*?)<\/span>/)?.[1];
    const forecast = notice.match(/<span>([\s\S]*?)<\/span>/)?.[1];
    return {label: ffText(badge) || 'Estado en seguimiento', detail: ffText(detail), forecast: ffText(forecast)};
  }
  const available = section.match(/<span class="[^"]*\bdisponible\b[^"]*"[^>]*>([\s\S]*?)<\/span>/)?.[1];
  return available ? {label: ffText(available), detail: '', forecast: ''} : null;
}

function ffRelatedNews(html) {
  const section = html.split('id="noticiasBox"')[1]?.split(/<\w+\b[^>]*\bclass="[^"]*\bjs-profile-section\b/)[0] ?? '';
  const rows = section.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').split(/<div class="noticiaJugador\b/).slice(1);
  const news = new Map();
  for (const row of rows) {
    const date = row.match(/<div class="date\b[^"]*"[^>]*>\s*(\d{2}\/\d{2})\s*<\/div>/)?.[1] ?? '';
    const link = row.match(/<a\s[^>]*href="https:\/\/www\.futbolfantasy\.com(\/[a-z0-9-]+\/noticias\/[a-z0-9-]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!link) continue;
    const url = FF_ORIGIN + link[1];
    const title = ffText(link[2]);
    if (title && !news.has(url)) news.set(url, {title, url, date});
    if (news.size === 5) break;
  }
  return [...news.values()];
}

export async function footballFantasyPlayer(slug, fetcher) {
  return ffCached('player/' + slug, async () => {
    const html = await ffHtml(FF_ORIGIN + '/jugadores/' + slug, fetcher);
    return {status: ffCurrentStatus(html), news: ffRelatedNews(html)};
  });
}

export async function footballFantasyTeam(teamSlug, fetcher) {
  const slug = ffClubAliases.get(teamSlug) || teamSlug;
  const {week, fixtures} = await ffCached('fixtures', async () => ffFixtureIndex(await ffHtml(FF_FIXTURES, fetcher)));
  const fixture = fixtures.get(slug);
  if (!fixture) return null;
  const {matchId, clubId, name, rival, home} = fixture;

  return ffCached(matchId + '/' + clubId, async () => {
    const url = FF_ORIGIN + '/api/alineaciones/' + matchId + '/' + clubId + '?ignoreOver=true&lineup_info=1';
    const players = ffPlayerStats(await ffHtml(url, fetcher));
    if (!players.length) throw Error('FútbolFantasy no ha devuelto datos de jugadores de este equipo.');
    return {team: name, week, rival, home, players};
  });
}
