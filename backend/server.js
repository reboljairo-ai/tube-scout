const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { Pool } = require('pg');
const app = express();

const db = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function initDB() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT UNIQUE NOT NULL,
      is_pro BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS auth_tokens (
      token TEXT PRIMARY KEY,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      daily_count INT DEFAULT 0,
      last_reset TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS search_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      query TEXT NOT NULL,
      data JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS favorites (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      query TEXT NOT NULL,
      score INT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, query)
    );
  `);
  console.log('DB ready');
}
initDB().catch(console.error);

const YT_KEY              = process.env.YOUTUBE_API_KEY;
const LS_KEY              = process.env.LEMON_SQUEEZY_API_KEY;
const LS_WEBHOOK_SECRET   = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
const LS_CHECKOUT_MONTHLY = 'https://tubescoutt.lemonsqueezy.com/checkout/buy/1ff3c34e-6db9-431a-9114-5b2263b097de';
const LS_CHECKOUT_ANNUAL  = 'https://tubescoutt.lemonsqueezy.com/checkout/buy/3fefc3e5-ace8-4f65-a060-7401f128740e';
const RESEND_KEY          = process.env.RESEND_API_KEY;
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

// ── In-memory pending codes (short-lived, ok in-memory) ──
const pendingCodes = new Map();

async function getRegisteredUser(req) {
  const auth = req.headers.authorization?.replace('Bearer ', '');
  if (!auth) return null;
  const { rows } = await db.query(
    'SELECT t.token, t.daily_count, t.last_reset, u.id as user_id, u.email, u.is_pro FROM auth_tokens t JOIN users u ON t.user_id = u.id WHERE t.token = $1',
    [auth]
  );
  return rows[0] || null;
}

async function checkDailyLimit(userData, res) {
  const today = new Date().toDateString();
  if (userData.last_reset !== today) {
    await db.query('UPDATE auth_tokens SET daily_count = 1, last_reset = $1 WHERE token = $2', [today, userData.token]);
    return true;
  }
  const limit = userData.is_pro ? 999 : 10;
  if (userData.daily_count >= limit) {
    res.status(429).json({ error: 'Límite diario alcanzado. Actualiza a Pro para análisis ilimitados.' });
    return false;
  }
  await db.query('UPDATE auth_tokens SET daily_count = daily_count + 1 WHERE token = $1', [userData.token]);
  return true;
}

async function saveHistory(userId, type, query, data) {
  await db.query(
    'INSERT INTO search_history (user_id, type, query, data) VALUES ($1, $2, $3, $4)',
    [userId, type, query, JSON.stringify(data)]
  ).catch(() => {});
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
        from: 'TubeScout <onboarding@resend.dev>',
        to: email,
        subject: 'Tu código de acceso — TubeScout',
        html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#080910;font-family:-apple-system,BlinkMacSystemFont,'Plus Jakarta Sans',sans-serif"><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:48px 24px"><table width="480" cellpadding="0" cellspacing="0" style="background:#0E1020;border-radius:16px;border:1px solid rgba(255,255,255,0.07);overflow:hidden"><tr><td style="padding:36px 40px 28px;border-bottom:1px solid rgba(255,255,255,0.07)"><span style="font-size:18px;font-weight:800;color:#EDF0FF;letter-spacing:-0.02em">&#9678; TubeScout</span></td></tr><tr><td style="padding:36px 40px"><p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#EDF0FF;letter-spacing:-0.02em">Tu código de acceso</p><p style="margin:0 0 28px;font-size:15px;color:#8892B0;line-height:1.6">Ingresa este código en el dashboard para acceder a tu cuenta.</p><div style="background:#141729;border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:24px;text-align:center;margin-bottom:24px"><span style="font-size:42px;font-weight:800;letter-spacing:14px;color:#EDF0FF">${code}</span></div><p style="margin:0;font-size:13px;color:#5A6380;line-height:1.6">Este código expira en <strong style="color:#8892B0">15 minutos</strong>. Si no solicitaste este código, podés ignorar este email.</p></td></tr><tr><td style="padding:20px 40px;border-top:1px solid rgba(255,255,255,0.07)"><p style="margin:0;font-size:12px;color:#5A6380">© 2026 TubeScout · No afiliado a YouTube ni a Google.</p></td></tr></table></td></tr></table></body></html>`
      })
    });
  }
  console.log(`[DEV] Code for ${email}: ${code}`);
  res.json({ success: true, ...(RESEND_KEY ? {} : { devCode: code }) });
});

app.post('/api/auth/verify-code', async (req, res) => {
  const { email, code } = req.body;
  const stored = pendingCodes.get(email?.toLowerCase());
  if (!stored || stored.code !== code) return res.status(400).json({ error: 'Código incorrecto' });
  if (Date.now() > stored.expires) {
    pendingCodes.delete(email.toLowerCase());
    return res.status(400).json({ error: 'Código expirado. Solicitá uno nuevo.' });
  }
  pendingCodes.delete(email.toLowerCase());
  const token = crypto.randomBytes(32).toString('hex');
  const today = new Date().toDateString();
  const { rows } = await db.query(
    'INSERT INTO users (email) VALUES ($1) ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id',
    [email.toLowerCase()]
  );
  await db.query(
    'INSERT INTO auth_tokens (token, user_id, daily_count, last_reset) VALUES ($1, $2, 0, $3)',
    [token, rows[0].id, today]
  );
  res.json({ success: true, accessToken: token });
});

// ── Niche Analyzer ────────────────────────────────────────
app.post('/api/analyze/niche', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'Query requerida' });
    const userData = await getRegisteredUser(req);
    if (userData && !await checkDailyLimit(userData, res)) return;
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
    if (userData) saveHistory(userData.user_id, 'niche', query, { score, income, stats: { avgViews, avgEngagement, avgSubs } });
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
    const userData = await getRegisteredUser(req);
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
    const userData = await getRegisteredUser(req);
    if (userData && !await checkDailyLimit(userData, res)) return;
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
    const userData2 = await getRegisteredUser(req);
    if (userData2 && !await checkDailyLimit(userData2, res)) return;
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
    const userData = await getRegisteredUser(req);
    if (!userData) return res.status(401).json({ error: 'Registrate gratis para usar el generador de títulos.' });
    if (!await checkDailyLimit(userData, res)) return;
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
    const userData = await getRegisteredUser(req);
    if (userData && !await checkDailyLimit(userData, res)) return;
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

// ── User Stats ────────────────────────────────────────────
app.get('/api/user/stats', async (req, res) => {
  try {
    const userData = await getRegisteredUser(req);
    if (!userData) return res.status(401).json({ error: 'No autenticado' });
    const today = new Date().toDateString();
    const todayCount = userData.last_reset === today ? userData.daily_count : 0;
    const { rows: totalRows } = await db.query(
      'SELECT COUNT(*) as total FROM search_history WHERE user_id = $1',
      [userData.user_id]
    );
    res.json({
      email: userData.email,
      isPro: userData.is_pro,
      todayCount,
      totalSearches: parseInt(totalRows[0].total),
      dailyLimit: userData.is_pro ? 'Ilimitado' : 10
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

// ── History ───────────────────────────────────────────────
app.get('/api/history', async (req, res) => {
  try {
    const userData = await getRegisteredUser(req);
    if (!userData) return res.status(401).json({ error: 'No autenticado' });
    const limit = userData.is_pro ? 100 : 30;
    const { rows } = await db.query(
      'SELECT id, type, query, created_at FROM search_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [userData.user_id, limit]
    );
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener historial' });
  }
});

// ── Favorites CRUD ────────────────────────────────────────
app.get('/api/favorites', async (req, res) => {
  try {
    const userData = await getRegisteredUser(req);
    if (!userData) return res.status(401).json({ error: 'No autenticado' });
    const { rows } = await db.query(
      'SELECT id, query, score, created_at FROM favorites WHERE user_id = $1 ORDER BY created_at DESC',
      [userData.user_id]
    );
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener favoritos' });
  }
});

app.post('/api/favorites', async (req, res) => {
  try {
    const userData = await getRegisteredUser(req);
    if (!userData) return res.status(401).json({ error: 'No autenticado' });
    const { query, score } = req.body;
    if (!query) return res.status(400).json({ error: 'Query requerida' });
    await db.query(
      'INSERT INTO favorites (user_id, query, score) VALUES ($1, $2, $3) ON CONFLICT (user_id, query) DO NOTHING',
      [userData.user_id, query, score || null]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al guardar favorito' });
  }
});

app.delete('/api/favorites/:id', async (req, res) => {
  try {
    const userData = await getRegisteredUser(req);
    if (!userData) return res.status(401).json({ error: 'No autenticado' });
    await db.query(
      'DELETE FROM favorites WHERE id = $1 AND user_id = $2',
      [req.params.id, userData.user_id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar favorito' });
  }
});

// ── Lemon Squeezy Webhook ─────────────────────────────────
app.post('/api/webhooks/lemonsqueezy', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    if (LS_WEBHOOK_SECRET) {
      const sig  = req.headers['x-signature'];
      const hash = crypto.createHmac('sha256', LS_WEBHOOK_SECRET).update(req.body).digest('hex');
      if (sig !== hash) return res.status(401).json({ error: 'Invalid signature' });
    }

    const payload = JSON.parse(req.body.toString());
    const event   = payload.meta?.event_name;
    const attrs   = payload.data?.attributes;
    const email   = attrs?.user_email;

    if (!email) return res.json({ ok: true });

    if (['subscription_created', 'subscription_updated'].includes(event)) {
      if (['active', 'trialing'].includes(attrs?.status)) {
        await db.query('UPDATE users SET is_pro = true WHERE LOWER(email) = LOWER($1)', [email]);
        console.log(`[LS] Pro activado: ${email}`);
      }
    }

    if (['subscription_expired', 'subscription_cancelled'].includes(event)) {
      await db.query('UPDATE users SET is_pro = false WHERE LOWER(email) = LOWER($1)', [email]);
      console.log(`[LS] Pro removido: ${email}`);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[LS webhook]', err.message);
    res.status(500).json({ error: 'Webhook error' });
  }
});

// ── Admin Login ───────────────────────────────────────────
app.post('/api/auth/admin-login', async (req, res) => {
  try {
    const { password } = req.body;
    const masterPwd  = process.env.MASTER_PASSWORD;
    const adminEmail = process.env.ADMIN_EMAIL;
    if (!masterPwd || !adminEmail) return res.status(503).json({ error: 'No configurado' });
    if (password !== masterPwd) return res.status(401).json({ error: 'Contraseña incorrecta' });

    const token = crypto.randomBytes(32).toString('hex');
    const today = new Date().toDateString();
    const { rows } = await db.query(
      'INSERT INTO users (email, is_pro) VALUES ($1, true) ON CONFLICT (email) DO UPDATE SET is_pro = true RETURNING id',
      [adminEmail.toLowerCase()]
    );
    await db.query(
      'INSERT INTO auth_tokens (token, user_id, daily_count, last_reset) VALUES ($1, $2, 0, $3)',
      [token, rows[0].id, today]
    );
    res.json({ accessToken: token });
  } catch (err) {
    console.error('admin-login error:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── Checkout URL ──────────────────────────────────────────
app.get('/api/checkout/:plan', async (req, res) => {
  const base     = req.params.plan === 'annual' ? LS_CHECKOUT_ANNUAL : LS_CHECKOUT_MONTHLY;
  const userData = await getRegisteredUser(req).catch(() => null);
  const url      = userData?.email
    ? `${base}?checkout[email]=${encodeURIComponent(userData.email)}`
    : base;
  res.json({ url });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`TubeScout API running on :${PORT}`));
