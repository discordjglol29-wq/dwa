// Vercel function: reads zon#999 from the HenrikDev API.
// The API key stays here on the server (set HENRIK_API_KEY in Vercel).
const NAME = 'zon', TAG = '999', PLATFORM = 'pc';
const REGION = process.env.VALORANT_REGION || 'ap'; // na, eu, ap or kr
const BASE = 'https://api.henrikdev.xyz/valorant';
const TN = ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Ascendant', 'Immortal'];

async function hk(path) {
  const r = await fetch(BASE + path, { headers: { Authorization: process.env.HENRIK_API_KEY || '' } });
  if (!r.ok) throw new Error(path + ' returned ' + r.status);
  return (await r.json()).data;
}
const tierName = t => (t && typeof t === 'object' ? t.name : t) || 'Unranked';
const day = d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const when = m => new Date((m.metadata && m.metadata.started_at) || 0).getTime();
const idxName = i => i < 0 ? 'Unranked' : i >= 24 ? 'Radiant' : TN[Math.floor(i / 3)] + ' ' + (i % 3 + 1);
const avgRank = ps => {
  const ids = ps.map(p => p.tid).filter(v => typeof v === 'number' && v >= 3);
  return ids.length ? idxName(Math.round(ids.reduce((a, b) => a + b, 0) / ids.length) - 3) : 'Unranked';
};

function parseMastery(d) {
  const arr = Array.isArray(d) ? d : (d && (d.agents || d.mastery || d.data)) || [];
  const out = {};
  for (const x of Array.isArray(arr) ? arr : Object.values(arr)) {
    if (!x || typeof x !== 'object') continue;
    const name = (x.agent && (x.agent.name || x.agent)) || x.agent_name || x.name;
    const lt = x.lifetime || x.lifetime_level || {};
    const lvl = (typeof lt === 'object' ? (lt.level != null ? lt.level : lt.current_level) : lt) != null
      ? (typeof lt === 'object' ? (lt.level != null ? lt.level : lt.current_level) : lt) : x.level;
    if (typeof name === 'string' && lvl != null) out[name.toLowerCase()] = lvl;
  }
  return out;
}

const run = async () => {
  try {
    const id = `${REGION}/${PLATFORM}/${encodeURIComponent(NAME)}/${encodeURIComponent(TAG)}`;
    const [mmr, hist, raw, masteryRaw] = await Promise.all([
      hk('/v3/mmr/' + id),
      hk('/v2/mmr-history/' + id),
      hk(`/v4/matches/${id}?mode=competitive&size=10`).catch(() => []),
      hk('/v1/agent-mastery/' + id).catch(() => null)
    ]);

    const history = (hist.history || []).slice(0, 15).reverse()
      .map(h => ({ d: day(h.date), elo: h.elo }));

    let kills = 0, deaths = 0, hs = 0, shots = 0, wins = 0, pts = 0, dmg = 0, rounds = 0, fb = 0, fbKnown = false;
    const agents = {}, maps = {}, matches = [], weapons = {};
    let wKnown = false, best = null;

    const sorted = (raw || []).slice().sort((a, b) => when(b) - when(a)); // newest first
    for (const m of sorted) {
      const list = Array.isArray(m.players) ? m.players : (m.players && m.players.all_players) || [];
      const me = list.find(p => (p.name || '').toLowerCase() === NAME && String(p.tag) === TAG);
      if (!me) continue;
      const team = (m.teams || []).find(t => t.team_id === me.team_id) || {};
      const enemy = (m.teams || []).find(t => t.team_id !== me.team_id) || {};
      const won = !!team.won, s = me.stats || {};
      const agent = (me.agent && me.agent.name) || 'Unknown';
      const map = (m.metadata && m.metadata.map && m.metadata.map.name) || '-';
      const rw = team.rounds ? (team.rounds.won || 0) + (team.rounds.lost || 0) : (m.rounds || []).length;
      const dealt = (s.damage && s.damage.dealt) || 0;

      kills += s.kills || 0; deaths += s.deaths || 0;
      hs += s.headshots || 0;
      shots += (s.headshots || 0) + (s.bodyshots || 0) + (s.legshots || 0);
      pts += s.score || 0; dmg += dealt; rounds += rw;
      if (won) wins++;

      // round details: first kills, first deaths, multi-kills, weapons
      const fkc = {}, fdc = {}, perRound = {};
      const kn = Array.isArray(m.kills) && m.kills.length > 0;
      if (kn) {
        const first = {};
        for (const k of m.kills) {
          const kp = k.killer && k.killer.puuid, vp = k.victim && k.victim.puuid;
          const t = k.time_in_round_in_ms != null ? k.time_in_round_in_ms : 0;
          if (!(k.round in first) || t < first[k.round].t) first[k.round] = { t, killer: kp, victim: vp };
          if (kp) { const key = kp + '|' + k.round; perRound[key] = (perRound[key] || 0) + 1; }
          if (kp && kp === me.puuid) {
            const wn = (k.weapon && k.weapon.name) || 'Ability or melee';
            weapons[wn] = (weapons[wn] || 0) + 1;
            wKnown = true;
          }
        }
        for (const f of Object.values(first)) {
          if (f.killer) fkc[f.killer] = (fkc[f.killer] || 0) + 1;
          if (f.victim) fdc[f.victim] = (fdc[f.victim] || 0) + 1;
        }
        fb += fkc[me.puuid] || 0;
        fbKnown = true;
      }

      const a = agents[agent] || (agents[agent] = { n: agent, games: 0, w: 0 });
      a.games++; if (won) a.w++;
      const mp = maps[map] || (maps[map] = { n: map, games: 0, w: 0 });
      mp.games++; if (won) mp.w++;

      // full scoreboard for this match
      const total = rw || (m.rounds || []).length;
      const players = list.map(p => {
        const st = p.stats || {};
        const dl = (st.damage && st.damage.dealt) || 0, rc = (st.damage && st.damage.received) || 0;
        const sh = (st.headshots || 0) + (st.bodyshots || 0) + (st.legshots || 0);
        const mk = Object.keys(perRound).filter(key => key.startsWith(p.puuid + '|') && perRound[key] >= 2).length;
        return {
          n: p.name, t: p.tag, agent: (p.agent && p.agent.name) || '-',
          team: p.team_id === me.team_id ? 'me' : 'enemy',
          tier: tierName(p.tier), tid: p.tier && p.tier.id,
          acs: total ? Math.round((st.score || 0) / total) : null,
          k: st.kills || 0, d: st.deaths || 0, a: st.assists || 0,
          pm: (st.kills || 0) - (st.deaths || 0),
          kd: st.deaths ? +((st.kills || 0) / st.deaths).toFixed(1) : (st.kills || 0),
          dd: total ? Math.round((dl - rc) / total) : null,
          adr: total ? +(dl / total).toFixed(1) : null,
          hs: sh ? Math.round((st.headshots || 0) / sh * 100) : 0,
          fk: kn ? (fkc[p.puuid] || 0) : null, fd: kn ? (fdc[p.puuid] || 0) : null, mk: kn ? mk : null,
          me: p.puuid === me.puuid
        };
      }).sort((x, y) => (y.acs || 0) - (x.acs || 0));
      const mineP = players.filter(p => p.team === 'me'), enP = players.filter(p => p.team !== 'me');

      const row = {
        res: won ? 'W' : 'L', map, agent,
        score: team.rounds ? team.rounds.won + '-' + team.rounds.lost : '-',
        k: s.kills || 0, d: s.deaths || 0, a: s.assists || 0,
        teams: {
          me: { won, score: team.rounds ? team.rounds.won + '-' + team.rounds.lost : '-', avg: avgRank(mineP) },
          enemy: { won: !!enemy.won, score: enemy.rounds ? enemy.rounds.won + '-' + enemy.rounds.lost : '-', avg: avgRank(enP) }
        },
        players: players.map(({ tid, ...rest }) => rest)
      };
      matches.push(row);
      if (!best || row.k > best.k) best = row;
    }

    let streak = '-';
    if (matches.length) {
      let n = 0;
      while (n < matches.length && matches[n].res === matches[0].res) n++;
      streak = matches[0].res + n;
    }
    const n = matches.length;
    const top = o => Object.values(o).sort((x, y) => y.games - x.games).slice(0, 5)
      .map(x => ({ n: x.n, games: x.games, wr: Math.round(x.w / x.games * 100) }));
    const lv = parseMastery(masteryRaw);
    const totalK = Object.values(weapons).reduce((x, y) => x + y, 0);
    const weaponList = wKnown ? Object.entries(weapons).sort((x, y) => y[1] - x[1]).slice(0, 5)
      .map(([nm, k]) => ({ n: nm, kills: k, pct: Math.round(k / totalK * 100) })) : null;
    const bestOut = best ? { res: best.res, map: best.map, agent: best.agent, score: best.score, k: best.k, d: best.d, a: best.a } : null;

    const out = {
      name: NAME + '#' + TAG,
      updated: 'Updated ' + new Date().toLocaleString('en-US'),
      current: { tier: tierName(mmr.current && mmr.current.tier), rr: (mmr.current && mmr.current.rr) || 0 },
      history,
      stats: {
        kd: deaths ? +(kills / deaths).toFixed(2) : kills,
        winrate: n ? Math.round(wins / n * 100) : 0,
        hs: shots ? Math.round(hs / shots * 100) : 0,
        matches: n,
        acs: rounds ? Math.round(pts / rounds) : null,
        adr: rounds ? Math.round(dmg / rounds) : null,
        fb: fbKnown ? fb : null,
        streak
      },
      best: bestOut,
      agents: top(agents).map(a => ({ ...a, lvl: lv[a.n.toLowerCase()] != null ? 'Lv ' + lv[a.n.toLowerCase()] : null })),
      weapons: weaponList,
      maps: top(maps),
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

module.exports = async (req, res) => {
  const r = await run();
  res.setHeader('Content-Type', 'application/json');
  if (r.statusCode === 200) res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
  res.status(r.statusCode).send(r.body);
};
