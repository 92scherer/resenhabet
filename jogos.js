export default async function handler(req, res) {
  // Libera acesso CORS para qualquer origem
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  // Cache de 3 minutos na borda da Vercel para resposta instantânea
  res.setHeader('Cache-Control', 's-maxage=180, stale-while-revalidate=300');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const LEAGUES = [
    { code: 'bra.1', name: 'Brasileirão Série A' },
    { code: 'bra.2', name: 'Brasileirão Série B' },
    { code: 'conmebol.libertadores', name: 'Copa Libertadores' },
    { code: 'conmebol.sudamericana', name: 'Copa Sul-Americana' },
    { code: 'uefa.champions', name: 'Champions League' },
    { code: 'eng.1', name: 'Premier League' },
    { code: 'esp.1', name: 'La Liga' }
  ];

  // Janela de datas: ontem até +5 dias
  const formatDate = (offsetDays) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10).replace(/-/g, '');
  };
  const dateRange = `${formatDate(-1)}-${formatDate(5)}`;

  const generateOdds = (homeComp, awayComp, eventId) => {
    const parseWinRate = (comp) => {
      try {
        const summary = comp.records?.[0]?.summary;
        if (!summary) return 0.45;
        const parts = summary.split('-').map(Number);
        const total = parts.reduce((a, b) => a + b, 0);
        return total > 0 ? (parts[0] + parts[1] * 0.3) / total : 0.45;
      } catch {
        return 0.45;
      }
    };

    const hRate = parseWinRate(homeComp) + 0.08;
    const aRate = parseWinRate(awayComp);
    const seed = (parseInt(String(eventId).slice(-3), 10) || 50) / 1000;

    const odd1 = Math.max(1.35, Math.min(4.80, (1 / Math.max(0.22, hRate)) * 0.88 + seed));
    const odd2 = Math.max(1.45, Math.min(5.50, (1 / Math.max(0.18, aRate)) * 0.92 - seed));
    const oddX = Math.max(2.85, Math.min(4.20, 3.15 + Math.abs(odd1 - odd2) * 0.25));

    return {
      home: Number(odd1.toFixed(2)),
      draw: Number(oddX.toFixed(2)),
      away: Number(odd2.toFixed(2))
    };
  };

  try {
    const allMatches = [];

    await Promise.all(
      LEAGUES.map(async (league) => {
        try {
          const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${league.code}/scoreboard?dates=${dateRange}`;
          const response = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; ResenhaBet/1.0)'
            }
          });
          if (!response.ok) return;

          const data = await response.json();
          const events = data.events || [];

          events.forEach((ev) => {
            const comp = ev.competitions?.[0];
            if (!comp || !comp.competitors || comp.competitors.length < 2) return;

            const home = comp.competitors.find((c) => c.homeAway === 'home') || comp.competitors[0];
            const away = comp.competitors.find((c) => c.homeAway === 'away') || comp.competitors[1];

            allMatches.push({
              id: String(ev.id),
              leagueCode: league.code,
              leagueName: league.name,
              date: ev.date,
              status: ev.status?.type?.state || 'pre', // 'pre' | 'in' | 'post'
              statusDetail: ev.status?.type?.shortDetail || '',
              homeName: home.team?.shortDisplayName || home.team?.displayName || 'Casa',
              homeLogo: home.team?.logo || '',
              homeScore: parseInt(home.score ?? '0', 10),
              awayName: away.team?.shortDisplayName || away.team?.displayName || 'Fora',
              awayLogo: away.team?.logo || '',
              awayScore: parseInt(away.score ?? '0', 10),
              odds: generateOdds(home, away, ev.id)
            });
          });
        } catch (err) {
          console.error(`Erro na liga ${league.code}:`, err.message);
        }
      })
    );

    const orderWeight = { in: 0, pre: 1, post: 2 };
    allMatches.sort((a, b) => {
      if (orderWeight[a.status] !== orderWeight[b.status]) {
        return orderWeight[a.status] - orderWeight[b.status];
      }
      return new Date(a.date) - new Date(b.date);
    });

    return res.status(200).json({
      ok: true,
      updatedAt: new Date().toISOString(),
      total: allMatches.length,
      matches: allMatches
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: 'Falha ao consultar feed da ESPN',
      details: error.message
    });
  }
}
