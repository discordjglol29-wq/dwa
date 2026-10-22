// Netlify function: reads zon#999 from the HenrikDev API.
// The API key stays here on the server (set HENRIK_API_KEY in Netlify).
const NAME = 'zon', TAG = '999', PLATFORM = 'pc';
const REGION = process.env.VALORANT_REGION || 'ap'; // na, eu, ap or kr
const BASE = 'https://api.henrikdev.xyz/valorant';

async function hk(path) {
  const r = await fetch(BASE + path, { headers: { Authorization: process.env.HENRIK_API_KEY || '' } });
  if (!r.ok) throw new Error(path + ' returned ' + r.status);
  return (await r.json()).data;
}
const tierName = t => (t && typeof t === 'object' ? t.name : t) || 'Unranked';
const day = d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

exports.handler = async () => {
  try {
    const id = `${REGION}/${PLATFORM}/${encodeURIComponent(NAME)}/${encodeURIComponent(TAG)}`;
    const [mmr, hist, raw] = await Promise.all([
      hk('/v3/mmr/' + id),
      hk('/v2/mmr-history/' + id),
      hk(`/v4/matches/${id}?mode=competitive&size=10`).catch(() => [])
    ]);

    const history = (hist.history || []).slice(0, 15).reverse()
      .map(h => ({ d: day(h.date), elo: h.elo }));

    let kills = 0, deaths = 0, hs = 0, shots = 0, wins = 0;
    const agents = {}, matches = [];
    for (const m of raw || []) {
      const list = Array.isArray(m.players) ? m.players : (m.players && m.players.all_players) || [];
      const me = list.find(p => (p.name || '').toLowerCase() === NAME && String(p.tag) === TAG);
      if (!me) continue;
      const team = (m.teams || []).find(t => t.team_id === me.team_id) || {};
      const won = !!team.won, s = me.stats || {};
      const agent = (me.agent && me.agent.name) || 'Unknown';
      kills += s.kills || 0; deaths += s.deaths || 0;
      hs += s.headshots || 0;
      shots += (s.headshots || 0) + (s.bodyshots || 0) + (s.legshots || 0);
      if (won) wins++;
      const a = agents[agent] || (agents[agent] = { n: agent, games: 0, w: 0 });
      a.games++; if (won) a.w++;
      matches.push({
        res: won ? 'W' : 'L',
        map: (m.metadata && m.metadata.map && m.metadata.map.name) || '-',
        agent,
        score: team.rounds ? team.rounds.won + '-' + team.rounds.lost : '-',
        k: s.kills || 0, d: s.deaths || 0, a: s.assists || 0
      });
    }
    const n = matches.length;
    const out = {
      name: NAME + '#' + TAG,
      updated: 'Updated ' + new Date().toLocaleString('en-US'),
      current: { tier: tierName(mmr.current && mmr.current.tier), rr: (mmr.current && mmr.current.rr) || 0 },
      history,
      stats: {
        kd: deaths ? +(kills / deaths).toFixed(2) : kills,
        winrate: n ? Math.round(wins / n * 100) : 0,
        hs: shots ? Math.round(hs / shots * 100) : 0,
        matches: n
      },
      agents: Object.values(agents).sort((x, y) => y.games - x.games).slice(0, 5)
        .map(a => ({ n: a.n, games: a.games, wr: Math.round(a.w / a.games * 100) })),
      matches
    };
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=0, s-maxage=120, stale-while-revalidate=300' },
      body: JSON.stringify(out)
    };
  } catch (e) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: e.message }) };
  }
};
