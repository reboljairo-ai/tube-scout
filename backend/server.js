const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const app = express();

const YT_KEY = process.env.YOUTUBE_API_KEY;
const LS_KEY = process.env.LEMON_SQUEEZY_API_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const BASE = 'https://www.googleapis.com/youtube/v3';

const CPM_MAP = [
  { kw: 'insurance', cpm: 35 }, { kw: 'mortgage', cpm: 32 }, { kw: 'loan', cpm: 28 },
  { kw: 'investing', cpm: 30 }, { kw: 'investment', cpm: 28 }, { kw: 'finance', cpm: 25 },
  { kw: 'finanzas', cpm: 25 }, { kw: 'financial', cpm: 25 }, { kw: 'tax', cpm: 25 },
  { kw: 'credit', cpm: 22 }, { kw: 'real estate', cpm: 28 }, { kw: 'business', cpm: 20 },
  { kw: 'negocio', cpm: 18 }, { kw: 'entrepreneur', cpm: 18 }, { kw: 'marketing', cpm: 18 },
  { kw: 'ecommerce', cpm: 20 }, { kw: 'crypto', cpm: 18 }, { kw: 'bitcoin', cpm: 18 },
  { kw: 'medical', cpm: 18 }, { kw: 'salud', cpm: 12 }, { kw: 'software', cpm: 16 },
  { kw: 'saas', cpm: 18 }, { kw: 'tech', cpm: 14 }, { kw: 'tecnologia', cpm: 12 },
  { kw: 'car', cpm: 12 }, { kw: 'auto', cpm: 10 }, { kw: 'automotive', cpm: 12 },
  { kw: 'mental health', cpm: 12 }, { kw: 'meditation', cpm: 10 }, { kw: 'meditacion', cpm: 9 },
  { kw: 'productivity', cpm: 10 }, { kw: 'self help', cpm: 10 }, { kw: 'course', cpm: 10 },
  { kw: 'coding', cpm: 10 }, { kw: 'programming', cpm: 10 }, { kw: 'programacion', cpm: 9 },
  { kw: 'fitness', cpm: 8 }, { kw: 'workout', cpm: 7 }, { kw: 'gym', cpm: 7 },
  { kw: 'nutrition', cpm: 9 }, { kw: 'diet', cpm: 8 }, { kw: 'yoga', cpm: 7 },
  { kw: 'cooking', cpm: 6 }, { kw: 'cocina', cpm: 5 }, { kw: 'recipe', cpm: 5 },
  { kw: 'travel', cpm: 8 }, { kw: 'viaje', cpm: 7 }, { kw: 'beauty', cpm: 7 },
  { kw: 'makeup', cpm: 8 }, { kw: 'skincare', cpm: 9 }, { kw: 'fashion', cpm: 6 },
  { kw: 'diy', cpm: 6 }, { kw: 'home', cpm: 7 }, { kw: 'garden', cpm: 6 },
  { kw: 'pets', cpm: 5 }, { kw: 'education', cpm: 8 }, { kw: 'educacion', cpm: 7 },
  { kw: 'gaming', cpm: 3 }, { kw: 'minecraft', cpm: 2 }, { kw: 'fortnite', cpm: 2 },
  { kw: 'music', cpm: 3 }, { kw: 'musica', cpm: 3 }, { kw: 'comedy', cpm: 3 },
  { kw: 'sports', cpm: 4 }, { kw: 'deporte', cpm: 4 }, { kw: 'kids', cpm: 2 },
];

function estimateCPM(query) {
  const q = (query || '').toLowerCase();
  let best = 4;
  for (const { kw, cpm } of CPM_MAP) {
    if (q.includes(kw) && cpm > best) best = cpm;
  }
  return best;
}

function estimateIncome(avgViews, cpm) {
  const monthly = avgViews * 4;
  return {
    min: Math.round((monthly * 0.30 / 1000) * cpm),
    max: Math.round((monthly * 0.55 / 1000) * cpm),
    cpm
  };
}

function getFormat(duration) {
  const m = duration?.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 'long';
  const secs = (parseInt(m[1]||0)*3600) + (parseInt(m[2]||0)*60) + parseInt(m[3]||0);
  return secs <= 61 ? 'short' : secs <= 480 ? 'medium' : 'long';
}

function generateTitleFormulas(query) {
  const q = query.trim();
  const Q = q.charAt(0).toUpperCase() + q.slice(1);
  return [
    `How to ${Q} (Step-by-Step for Beginners)`,
    `I Tried ${Q} for 30 Days — Here's What Happened`,
    `The Truth About ${Q} Nobody Tells You`,
    `${Q}: Everything You Need to Know in 2025`,
    `Why 90% of People Fail at ${Q} (And How to Succeed)`,
    `7 Mistakes to Avoid When Starting ${Q}`,
    `The Beginner's Complete Guide to ${Q}`,
    `I Tested Every ${Q} Strategy So You Don't Have To`,
    `What Experts Won't Tell You About ${Q}`,
    `${Q} in 2025: Is It Still Worth It?`,
    `How I Earned $X with ${Q} in 30 Days`,
    `The ${Q} Blueprint That Changed Everything`,
    `Stop Wasting Time on ${Q} — Do This Instead`,
    `${Q} vs [Alternative]: Which Is Actually Better?`,
    `I Spent $500 Testing ${Q} — Here Are My Results`,
  ];
}

// ── In-memory auth stores ─────────────────────────────────
const pendingCodes = new Map(); // email -> { code, expires }
const userTokens = new Map();  // token -> { email, dailyCount, lastReset }

function getRegisteredUser(req) {
  const auth = req.headers.authorization?.replace('Bearer ', '');
  if (!auth) return null;
  return userTokens.get(auth) || null;
}

function checkDailyLimit(userData, res) {
  const today = new Date().toDateString();
  if (userData.lastReset !== today) {
    userData.dailyCount = 0;
    userData.lastReset = today;
  }
  if (userData.dailyCount >= 10) {
    res.status(429).json({ error: 'Límite diario alcanzado. Actualiza a Pro para análisis ilimitados.' });
    return false;
  }
  userData.dailyCount++;
  return true;
}

function limitResults(data, isRegistered, type) {
  if (!isRegistered) return { ...data, locked: false, lockedCount: 0 };
  const LIMIT = 5;
  switch (type) {
    case 'niche': {
      const all = data.videos || [];
      const lockedCount = Math.max(0, all.length - LIMIT);
      return { ...data, videos: all.slice(0, LIMIT), locked: lockedCount > 0, lockedCount };
    }
    case 'keywords': {
      const all = data.keywords || [];
      const lockedCount = Math.max(0, all.length - LIMIT);
      const keywords = all.slice(0, LIMIT).map(k => ({ ...k, topViewsTotal: null, avgViews: null }));
      return { keywords, locked: lockedCount > 0, lockedCount };
    }
    case 'trending': {
      const all = data.videos || [];
      const lockedCount = Math.max(0, all.length - LIMIT);
      return { videos: all.slice(0, LIMIT), locked: lockedCount > 0, lockedCount };
    }
    case 'channel': {
      const lockedCount = (data.topVideos || []).length;
      return { ...data, topVideos: [], locked: true, lockedCount };
    }
    default: return data;
  }
}

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.options('*', cors());
app.use(express.json());
app.use(express.static('public'));

// ── Helpers ───────────────────────────────────────────────
async function ytFetch(path) {
  const res = await fetch(`${BASE}${path}`);
  return res.json();
}

function calcViralScore(views, likes, comments) {
  const engagementRate = views > 0 ? (((likes + comments) / views) * 100) : 0;
  const viewScore = Math.min(100, Math.log10(Math.max(1, views)) * 15);
  const engScore = Math.min(100, engagementRate * 20);
  return Math.round(viewScore * 0.6 + engScore * 0.4);
}

function mapVideo(v, channelMap = {}) {
  const views = parseInt(v.statistics?.viewCount || 0);
  const likes = parseInt(v.statistics?.likeCount || 0);
  const comments = parseInt(v.statistics?.commentCount || 0);
  const subs = channelMap[v.snippet?.channelId] || 0;
  const engagementRate = views > 0 ? (((likes + comments) / views) * 100).toFixed(2) : '0.00';
  const duration = v.contentDetails?.duration;
  return {
    videoId: v.id || v.id?.videoId,
    title: v.snippet?.title,
    channelName: v.snippet?.channelTitle,
    views, likes, comments,
    subscribers: subs,
    engagementRate: parseFloat(engagementRate),
    viralScore: calcViralScore(views, likes, comments),
    publishedAt: v.snippet?.publishedAt,
    format: duration ? getFormat(duration) : 'long'
  };
}

async function getChannelMap(channelIds) {
  if (!channelIds) return {};
  const data = await ytFetch(`/channels?key=${YT_KEY}&id=${channelIds}&part=statistics`);
  const map = {};
  (data.items || []).forEach(c => {
    map[c.id] = parseInt(c.statistics?.subscriberCount || 0);
  });
  return map;
}

// ── Auth ──────────────────────────────────────────────────
app.post('/api/auth/request-code', async (req, res) => {
  const { email } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Email inválido' });
  }
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  pendingCodes.set(email.toLowerCase(), { code, expires: Date.now() + 900000 });

  if (RESEND_KEY) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'TubeScout <hello@tubescout.io>',
        to: email,
        subject: 'Tu código de acceso — TubeScout',
        html: `<div style="font-family:sans-serif;max-width:420px;padding:32px;background:#0F1117;border-radius:12px"><h2 style="color:#6C63FF">🎯 TubeScout</h2><p style="color:#94A3B8;margin-bottom:20px">Tu código de verificación:</p><div style="font-size:36px;font-weight:800;letter-spacing:10px;color:#E2E8F0;padding:20px;background:#1A1D2E;border-radius:8px;text-align:center">${code}</div><p style="color:#64748b;font-size:13px;margin-top:16px">Expira en 15 minutos.</p></div>`
      })
    });
  }
  console.log(`[DEV] Code for ${email}: ${code}`);
  res.json({ success: true, devCode: code });
});

app.post('/api/auth/verify-code', (req, res) => {
  const { email, code } = req.body;
  const stored = pendingCodes.get(email?.toLowerCase());
  if (!stored || stored.code !== code) return res.status(400).json({ error: 'Código incorrecto' });
  if (Date.now() > stored.expires) {
    pendingCodes.delete(email.toLowerCase());
    return res.status(400).json({ error: 'Código expirado. Solicitá uno nuevo.' });
  }
  pendingCodes.delete(email.toLowerCase());
  const token = crypto.randomBytes(32).toString('hex');
  userTokens.set(token, { email: email.toLowerCase(), dailyCount: 0, lastReset: new Date().toDateString() });
  res.json({ success: true, token });
});

// ── Niche Analyzer ────────────────────────────────────────
app.post('/api/analyze/niche', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'Query requerida' });
    const userData = getRegisteredUser(req);
    if (userData && !checkDailyLimit(userData, res)) return;
    const isRegistered = !!userData;

    const searchData = await ytFetch(
      `/search?key=${YT_KEY}&q=${encodeURIComponent(query)}&type=video&order=viewCount&maxResults=20&part=snippet`
    );

    if (!searchData.items?.length) {
      return res.json({ data: { videos: [], stats: { avgViews: 0, avgEngagement: '0', avgSubs: 0 }, score: 0 } });
    }

    const videoIds = searchData.items.map(i => i.id.videoId).join(',');
    const channelIds = [...new Set(searchData.items.map(i => i.snippet.channelId))].join(',');

    const [videosData, channelMap] = await Promise.all([
      ytFetch(`/videos?key=${YT_KEY}&id=${videoIds}&part=statistics,snippet,contentDetails`),
      getChannelMap(channelIds)
    ]);

    const videos = (videosData.items || []).map(v => mapVideo(v, channelMap));

    const avgViews = Math.round(videos.reduce((s, v) => s + v.views, 0) / videos.length);
    const avgEngagement = (videos.reduce((s, v) => s + v.engagementRate, 0) / videos.length).toFixed(2);
    const avgSubs = Math.round(videos.reduce((s, v) => s + v.subscribers, 0) / videos.length);

    const engScore = Math.min(100, parseFloat(avgEngagement) * 20);
    const diffScore = Math.min(100, Math.log10(Math.max(1, avgSubs)) * 15);
    const score = Math.round(engScore * 0.5 + (100 - diffScore) * 0.5);

    const fmts = videos.reduce((a, v) => { a[v.format] = (a[v.format]||0)+1; return a; }, {});
    const t = videos.length || 1;
    const formatBreakdown = {
      short: Math.round((fmts.short||0)/t*100),
      medium: Math.round((fmts.medium||0)/t*100),
      long: Math.round((fmts.long||0)/t*100)
    };
    const cpm = estimateCPM(query);
    const income = estimateIncome(avgViews, cpm);

    const limited = limitResults({ videos, stats: { avgViews, avgEngagement, avgSubs }, score, formatBreakdown, income }, isRegistered, 'niche');
    res.json({ data: limited });
  } catch (err) {
    console.error('analyzeNiche error:', err);
    res.status(500).json({ error: 'Error al analizar el nicho. Intenta de nuevo.' });
  }
});

// ── Trending ──────────────────────────────────────────────
app.get('/api/trending', async (req, res) => {
  try {
    const { region = 'US', category = '0' } = req.query;
    const userData = getRegisteredUser(req);
    const isRegistered = !!userData;
    const catParam = category !== '0' ? `&videoCategoryId=${category}` : '';

    const data = await ytFetch(
      `/videos?key=${YT_KEY}&chart=mostPopular&regionCode=${region}${catParam}&maxResults=20&part=snippet,statistics`
    );

    const channelIds = [...new Set((data.items || []).map(i => i.snippet.channelId))].join(',');
    const channelMap = await getChannelMap(channelIds);

    const videos = (data.items || []).map(v => mapVideo(v, channelMap));
    const limited = limitResults({ videos }, isRegistered, 'trending');
    res.json({ data: limited });
  } catch (err) {
    console.error('trending error:', err);
    res.status(500).json({ error: 'Error al cargar tendencias.' });
  }
});

// ── Channel Analyzer ──────────────────────────────────────
app.post('/api/analyze/channel', async (req, res) => {
  try {
    const { input } = req.body;
    if (!input) return res.status(400).json({ error: 'Input requerido' });
    const userData = getRegisteredUser(req);
    if (userData && !checkDailyLimit(userData, res)) return;
    const isRegistered = !!userData;

    let channelId;

    // Extract from URL
    const handleMatch = input.match(/youtube\.com\/@([^/?]+)/);
    const idMatch = input.match(/youtube\.com\/channel\/([^/?]+)/);

    if (idMatch) {
      channelId = idMatch[1];
    } else if (handleMatch) {
      const d = await ytFetch(`/channels?key=${YT_KEY}&forHandle=${handleMatch[1]}&part=id`);
      channelId = d.items?.[0]?.id;
    }

    if (!channelId) {
      // Search by name
      const d = await ytFetch(`/search?key=${YT_KEY}&q=${encodeURIComponent(input)}&type=channel&maxResults=1&part=snippet`);
      channelId = d.items?.[0]?.id?.channelId;
    }

    if (!channelId) return res.status(404).json({ error: 'Canal no encontrado. Prueba con la URL completa.' });

    const [channelData, videosSearchData] = await Promise.all([
      ytFetch(`/channels?key=${YT_KEY}&id=${channelId}&part=statistics,snippet`),
      ytFetch(`/search?key=${YT_KEY}&channelId=${channelId}&type=video&order=viewCount&maxResults=10&part=snippet`)
    ]);

    const ch = channelData.items?.[0];
    if (!ch) return res.status(404).json({ error: 'Canal no encontrado.' });

    const videoIds = (videosSearchData.items || []).map(i => i.id.videoId).join(',');
    const videosData = videoIds
      ? await ytFetch(`/videos?key=${YT_KEY}&id=${videoIds}&part=statistics,snippet`)
      : { items: [] };

    const subs = parseInt(ch.statistics?.subscriberCount || 0);
    const channelMap = { [channelId]: subs };
    const topVideos = (videosData.items || []).map(v => mapVideo(v, channelMap));

    const avgViews = topVideos.length
      ? Math.round(topVideos.reduce((s, v) => s + v.views, 0) / topVideos.length)
      : 0;
    const avgEngagement = topVideos.length
      ? (topVideos.reduce((s, v) => s + v.engagementRate, 0) / topVideos.length).toFixed(2)
      : '0';

    const videoCount = parseInt(ch.statistics?.videoCount || 0);
    const weeksSince = Math.max(1, Math.floor((Date.now() - new Date(ch.snippet.publishedAt)) / 604800000));
    const uploadFreq = (videoCount / weeksSince).toFixed(1);

    const channelResult = {
      channel: {
        id: channelId,
        name: ch.snippet.title,
        subscribers: subs,
        totalViews: parseInt(ch.statistics?.viewCount || 0),
        videoCount,
        publishedAt: ch.snippet.publishedAt
      },
      topVideos,
      stats: { avgViews, avgEngagement, uploadFreq }
    };
    const limited = limitResults(channelResult, isRegistered, 'channel');
    res.json({ data: limited });
  } catch (err) {
    console.error('analyzeChannel error:', err);
    res.status(500).json({ error: 'Error al analizar el canal.' });
  }
});

// ── Keyword Research ──────────────────────────────────────
function parseKeywordQuery(raw) {
  let q = raw;
  let lang = null;
  let region = null;

  // Detect language intent
  if (/ingl[eé]s|english/i.test(q)) { lang = 'en'; region = 'US'; }
  else if (/espa[nñ]ol|spanish/i.test(q)) { lang = 'es'; region = 'MX'; }
  else if (/portugu[eê]s|portuguese/i.test(q)) { lang = 'pt'; region = 'BR'; }
  else if (/franc[eé]s|french/i.test(q)) { lang = 'fr'; region = 'FR'; }

  // Strip filler phrases (order matters: longer first)
  const fillers = [
    'busca las palabras claves mas virales del nicho de',
    'busca las palabras clave mas virales del nicho de',
    'palabras claves mas virales del nicho de',
    'palabras clave mas virales del nicho de',
    'palabras claves del nicho de',
    'palabras clave del nicho de',
    'keywords mas virales de',
    'keywords virales de',
    'las keywords de',
    'las palabras claves de',
    'busca keywords sobre',
    'busca keywords de',
    'encuentra keywords de',
    'palabras claves sobre',
    'palabras claves de',
    'palabras clave de',
    'palabras clave sobre',
    'keywords sobre',
    'keywords de',
    'del nicho de',
    'en el nicho de',
    'nicho de',
    'busca las',
    'busca',
    'encuentra',
    'dame',
    'mostrame',
    'muéstrame',
    'en inglés', 'en ingles', 'in english',
    'en español', 'en espanol', 'in spanish',
    'en portugués', 'in portuguese',
    'en francés', 'in french',
    'más virales', 'mas virales',
    'más populares', 'mas populares',
    'virales', 'popular', 'populares',
  ];

  for (const f of fillers) {
    q = q.replace(new RegExp(`\\b${f}\\b`, 'gi'), ' ');
  }
  q = q.trim().replace(/\s+/g, ' ').replace(/^[^a-záéíóúüña-z0-9]+/i, '').trim();

  return { topic: q || raw, lang, region };
}

app.post('/api/keywords', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'Query requerida' });

    const { topic, lang, region } = parseKeywordQuery(query);

    // YouTube autocomplete with language targeting
    const langParam = lang ? `&hl=${lang}` : '';
    const autocompleteRes = await fetch(
      `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(topic)}${langParam}`
    );
    const autocompleteData = await autocompleteRes.json();
    const suggestions = (autocompleteData[1] || []).slice(0, 10);

    if (!suggestions.length) {
      return res.json({ data: { keywords: [] } });
    }

    // For each suggestion, get search results + engagement data
    const keywordData = await Promise.all(
      suggestions.map(async (keyword) => {
        try {
          const regionParam = region ? `&regionCode=${region}` : '';
          const langSearchParam = lang ? `&relevantLanguage=${lang}` : '';
          const searchData = await ytFetch(
            `/search?key=${YT_KEY}&q=${encodeURIComponent(keyword)}&type=video&maxResults=5&part=snippet${regionParam}${langSearchParam}`
          );

          const totalResults = searchData.pageInfo?.totalResults || 0;
          const videoIds = (searchData.items || []).map(i => i.id.videoId).filter(Boolean).join(',');

          let avgEngagement = '0.00';
          let topViewsTotal = 0;
          let avgViews = 0;

          if (videoIds) {
            const videosData = await ytFetch(
              `/videos?key=${YT_KEY}&id=${videoIds}&part=statistics`
            );
            const videos = videosData.items || [];
            topViewsTotal = videos.reduce((s, v) => s + parseInt(v.statistics?.viewCount || 0), 0);
            const totalLikes = videos.reduce((s, v) => s + parseInt(v.statistics?.likeCount || 0), 0);
            const totalComments = videos.reduce((s, v) => s + parseInt(v.statistics?.commentCount || 0), 0);
            avgViews = videos.length ? Math.round(topViewsTotal / videos.length) : 0;
            avgEngagement = topViewsTotal > 0
              ? (((totalLikes + totalComments) / topViewsTotal) * 100).toFixed(2)
              : '0.00';
          }

          const competitionScore = Math.min(100, Math.log10(Math.max(1, totalResults)) * 15);
          const engScore = Math.min(100, parseFloat(avgEngagement) * 20);
          const score = Math.round(engScore * 0.5 + (100 - competitionScore) * 0.5);
          const competition = competitionScore > 65 ? 'Alta' : competitionScore > 35 ? 'Media' : 'Baja';

          return { keyword, score, competition, totalResults, avgEngagement, topViewsTotal, avgViews };
        } catch {
          return { keyword, score: 0, competition: 'N/A', totalResults: 0, avgEngagement: '0' };
        }
      })
    );

    keywordData.sort((a, b) => b.score - a.score);
    const userData2 = getRegisteredUser(req);
    if (userData2 && !checkDailyLimit(userData2, res)) return;
    const limited2 = limitResults({ keywords: keywordData }, !!userData2, 'keywords');
    res.json({ data: { ...limited2, parsedTopic: topic, lang, region } });
  } catch (err) {
    console.error('keywords error:', err);
    res.status(500).json({ error: 'Error al buscar palabras clave.' });
  }
});

// ── Title Generator ───────────────────────────────────────
app.post('/api/titles', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'Query requerida' });
    const userData = getRegisteredUser(req);
    if (!userData) return res.status(401).json({ error: 'Registrate gratis para usar el generador de títulos.' });
    if (!checkDailyLimit(userData, res)) return;
    const searchData = await ytFetch(`/search?key=${YT_KEY}&q=${encodeURIComponent(query)}&type=video&order=viewCount&maxResults=8&part=snippet`);
    const topTitles = (searchData.items || []).map(v => v.snippet.title).slice(0, 5);
    res.json({ data: { titles: generateTitleFormulas(query), topTitles } });
  } catch (err) {
    res.status(500).json({ error: 'Error al generar títulos.' });
  }
});

// ── Tag Generator ─────────────────────────────────────────
app.post('/api/tags', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'Query requerida' });
    const userData = getRegisteredUser(req);
    if (userData && !checkDailyLimit(userData, res)) return;
    const r = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(query)}`);
    const d = await r.json();
    const suggestions = (d[1] || []).slice(0, 10);
    const base = query.toLowerCase().trim();
    const tags = [...new Set([base, ...suggestions, `${base} 2025`, `${base} tutorial`, `${base} tips`, `${base} for beginners`, `how to ${base}`, `best ${base}`])].filter(Boolean).slice(0, 20);
    res.json({ data: { tags } });
  } catch (err) {
    res.status(500).json({ error: 'Error al generar tags.' });
  }
});

// ── License Validation ────────────────────────────────────
app.post('/api/license/validate', async (req, res) => {
  try {
    const { licenseKey } = req.body;
    const lsRes = await fetch('https://api.lemonsqueezy.com/v1/licenses/validate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ license_key: licenseKey })
    });
    const data = await lsRes.json();
    res.json({ valid: !!data.valid, error: data.error });
  } catch {
    res.status(500).json({ valid: false, error: 'Error al verificar la licencia.' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`TubeScout API running on :${PORT}`));
