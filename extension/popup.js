const $ = id => document.getElementById(id);
const LIMIT_ANON  = 3;
const LIMIT_EMAIL = 10;

const stripEmoji = s => s.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '').replace(/\s+/g, ' ').trim();

// ── i18n ──────────────────────────────────────────────────
window.currentLang = 'en';
function t(es, en) { return window.currentLang === 'en' ? en : es; }

function applyLang(lang) {
  window.currentLang = lang;
  document.querySelectorAll('[data-es]').forEach(el => {
    el.textContent = lang === 'en' ? el.dataset.en : el.dataset.es;
  });
  document.querySelectorAll('[data-placeholder-es]').forEach(el => {
    el.placeholder = lang === 'en' ? el.dataset.placeholderEn : el.dataset.placeholderEs;
  });
  const btn = $('lang-toggle');
  if (btn) btn.textContent = lang === 'en' ? 'ES' : 'EN';
  document.documentElement.lang = lang;
}

$('lang-toggle')?.addEventListener('click', async () => {
  const newLang = window.currentLang === 'en' ? 'es' : 'en';
  await chrome.storage.local.set({ lang: newLang });
  applyLang(newLang);
});

// ── Tab switching ─────────────────────────────────────────
let trendingLoaded = false;
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    $(`panel-${tab.dataset.tab}`).classList.add('active');
    if (tab.dataset.tab === 'trending' && !trendingLoaded) {
      trendingLoaded = true;
      loadTrending();
    }
  });
});

// ── State ─────────────────────────────────────────────────
let currentRegion = 'US';
let currentCategory = '0';

// ── Init ──────────────────────────────────────────────────
async function init() {
  const { isPro, licenseKey, totalAnalysisCount, emailRegistered, lang } =
    await chrome.storage.local.get(['isPro', 'licenseKey', 'totalAnalysisCount', 'emailRegistered', 'lang']);
  applyLang(lang || 'en');
  const total = totalAnalysisCount || 0;
  if (isPro && licenseKey) {
    showProState(licenseKey);
  } else {
    showFreeState(total, emailRegistered);
  }
  renderHistory('niche-history', 'nicheHistory');
  renderHistory('kw-history', 'kwHistory');
  renderHistory('viral-history', 'viralHistory');
  renderFavorites();
}

function showFreeState(total, emailRegistered) {
  const limit = emailRegistered ? LIMIT_EMAIL : LIMIT_ANON;
  $('plan-badge').textContent = 'Free';
  $('plan-badge').className = 'plan-badge badge-free';
  $('plan-badge2').textContent = 'Free';
  $('plan-badge2').className = 'plan-badge badge-free';
  $('plan-name').textContent = 'Free';
  $('usage-text').textContent = t(
    `${Math.min(total, limit)} de ${limit} análisis usados`,
    `${Math.min(total, limit)} of ${limit} analyses used`
  );
  $('usage-bar').style.width = `${Math.min(100, (total / limit) * 100)}%`;
  $('usage-bar').style.background = total >= limit ? '#FF5555' : 'var(--accent)';
  $('license-section').style.display = 'block';
  $('pro-active').style.display = 'none';
  $('upgrade-section').style.display = 'block';
}

function showProState(key) {
  $('plan-badge').textContent = 'Pro';
  $('plan-badge').className = 'plan-badge badge-pro';
  $('plan-badge2').textContent = 'Pro';
  $('plan-badge2').className = 'plan-badge badge-pro';
  $('plan-name').textContent = 'Pro';
  $('usage-text').textContent = t('Análisis ilimitados', 'Unlimited analyses');
  $('usage-bar').style.width = '100%';
  $('license-section').style.display = 'none';
  $('pro-active').style.display = 'block';
  $('upgrade-section').style.display = 'none';
}

// ── Usage tracking ────────────────────────────────────────
async function checkAndIncrementUsage() {
  const { isPro, totalAnalysisCount, emailRegistered } =
    await chrome.storage.local.get(['isPro', 'totalAnalysisCount', 'emailRegistered']);
  if (isPro) return true;
  const total = totalAnalysisCount || 0;
  if (total < LIMIT_ANON) {
    await chrome.storage.local.set({ totalAnalysisCount: total + 1 });
    if (total === 1 && !emailRegistered) {
      setTimeout(openModal, 1800);
    }
    return true;
  }
  if (emailRegistered && total < LIMIT_EMAIL) {
    await chrome.storage.local.set({ totalAnalysisCount: total + 1 });
    return true;
  }
  if (!emailRegistered) openModal();
  return false;
}

// ── History ───────────────────────────────────────────────
async function saveToHistory(storageKey, query) {
  const result = await chrome.storage.local.get(storageKey);
  const arr = result[storageKey] || [];
  const filtered = arr.filter(q => q !== query);
  filtered.unshift(query);
  await chrome.storage.local.set({ [storageKey]: filtered.slice(0, 10) });
}

async function renderHistory(containerId, storageKey) {
  const result = await chrome.storage.local.get(storageKey);
  const arr = result[storageKey] || [];
  const container = $(containerId);
  if (!container) return;
  if (!arr.length) { container.innerHTML = ''; return; }
  container.innerHTML = arr.slice(0, 6).map(q =>
    `<button class="history-chip" data-hist="${q.replace(/"/g, '&quot;')}">${q}</button>`
  ).join('');
}

// ── Email modal ───────────────────────────────────────────
function openModal() {
  $('modal-overlay').style.display = 'flex';
  $('modal-email').value = '';
  const msg = $('modal-msg');
  msg.style.display = 'none';
  msg.textContent = '';
}

function closeModal() {
  $('modal-overlay').style.display = 'none';
}
window.openModal = openModal;

$('send-code-btn')?.addEventListener('click', async () => {
  const email = $('modal-email').value.trim();
  if (!email || !email.includes('@') || !email.includes('.')) {
    return showModalMsg(t('Email inválido', 'Invalid email'), 'error');
  }
  $('send-code-btn').disabled = true;
  $('send-code-btn').textContent = t('Registrando…', 'Registering…');
  const resp = await chrome.runtime.sendMessage({ action: 'registerEmail', email });
  $('send-code-btn').disabled = false;
  $('send-code-btn').textContent = t('Obtener 10 análisis gratis →', 'Get 10 free analyses →');
  if (resp.success) {
    showModalMsg(t('¡Listo! 10 análisis desbloqueados.', 'Done! 10 analyses unlocked.'), 'success');
    setTimeout(() => { closeModal(); init(); }, 1200);
  } else {
    showModalMsg(resp.error || t('Error al registrar', 'Registration error'), 'error');
  }
});

$('skip-modal')?.addEventListener('click', () => {
  closeModal();
  chrome.tabs.create({ url: 'https://tube-scout-production.up.railway.app/#pricing' });
});

function showModalMsg(text, type) {
  const el = $('modal-msg');
  el.className = `modal-msg ${type}`;
  el.textContent = text;
  el.style.display = 'block';
}

// ── Favorites ─────────────────────────────────────────────
async function getFavorites() {
  const r = await chrome.storage.local.get('favorites');
  return r.favorites || [];
}

async function toggleFavorite(query, score) {
  const favs = await getFavorites();
  const idx = favs.findIndex(f => f.query === query);
  if (idx >= 0) { favs.splice(idx, 1); } else { favs.unshift({ query, score }); }
  await chrome.storage.local.set({ favorites: favs.slice(0, 20) });
  return idx < 0;
}

async function renderFavorites() {
  const favs = await getFavorites();
  const el = $('favorites-list');
  if (!el) return;
  if (!favs.length) {
    el.innerHTML = `<div class="empty-state" style="padding:12px 0"><p style="font-size:11px">${t('No hay nichos guardados aún.<br>Guardá un análisis con el icono estrella.', 'No saved niches yet.<br>Save an analysis with the star icon.')}</p></div>`;
    return;
  }
  el.innerHTML = favs.map(f => `
    <div class="fav-item">
      <div class="fav-name">${f.query}</div>
      <button class="fav-analyze" data-fav-query="${f.query.replace(/"/g,'&quot;')}">${t('Analizar', 'Analyze')}</button>
      <button class="fav-delete" data-fav-del="${f.query.replace(/"/g,'&quot;')}">×</button>
    </div>`).join('');
}

// ── Title Generator ───────────────────────────────────────
$('title-btn').addEventListener('click', generateTitles);
$('title-input').addEventListener('keydown', e => { if (e.key === 'Enter') generateTitles(); });

async function generateTitles() {
  const query = $('title-input').value.trim();
  if (!query) return;
  const { emailRegistered, isPro } = await chrome.storage.local.get(['emailRegistered', 'isPro']);
  if (!isPro && !emailRegistered) {
    $('title-results').innerHTML = `<div class="empty-state"><p>${t('Registrate gratis para generar títulos optimizados.', 'Register free to generate optimized titles.')}</p><button onclick="window.openModal()" style="background:var(--accent);color:#0A0A0A;border:none;border-radius:6px;padding:9px 16px;font-size:12px;font-weight:600;cursor:pointer;margin:8px 0;display:block;width:100%">${t('📧 Registrate gratis →', '📧 Register free →')}</button></div>`;
    return;
  }
  $('title-results').innerHTML = loadingHTML(t(`Generando títulos para "${query}"…`, `Generating titles for "${query}"…`));
  $('title-btn').disabled = true;
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'generateTitles', query });
    if (resp.error) throw new Error(resp.error);
    renderTitleResults(resp.data);
  } catch (err) {
    $('title-results').innerHTML = errorHTML(err.message);
  } finally {
    $('title-btn').disabled = false;
  }
}

function renderTitleResults(data) {
  const { titles, topTitles } = data;
  const titlesHTML = titles.map((title, i) => `
    <div class="title-item">
      <div class="title-text">${title}</div>
      <button class="copy-btn" data-copy="${title.replace(/"/g,'&quot;')}">${t('Copiar', 'Copy')}</button>
    </div>`).join('');

  const refHTML = topTitles?.length ? `
    <div class="section-title" style="margin:14px 0 8px">${t('Referencia — Top videos virales', 'Reference — Top viral videos')}</div>
    ${topTitles.map(title => `<div class="ref-title">${title}</div>`).join('')}` : '';

  $('title-results').innerHTML = `
    <div class="section-title" style="margin-bottom:8px">${t('15 títulos optimizados', '15 optimized titles')}</div>
    ${titlesHTML}${refHTML}`;
}

// ── Niche Analyzer ────────────────────────────────────────
$('niche-btn').addEventListener('click', analyzeNiche);
$('niche-input').addEventListener('keydown', e => { if (e.key === 'Enter') analyzeNiche(); });

async function analyzeNiche() {
  const query = $('niche-input').value.trim();
  if (!query) return;
  if (isURL(query)) {
    $('niche-results').innerHTML = `<div class="error-msg">${t('Ingresá un tema o keyword, no una URL.<br><small style="color:var(--muted)">Para analizar un canal usá la pestaña Canal.</small>', 'Enter a topic or keyword, not a URL.<br><small style="color:var(--muted)">To analyze a channel use the Channel tab.</small>')}</div>`;
    return;
  }

  const ok = await checkAndIncrementUsage();
  if (!ok) { $('niche-results').innerHTML = limitHTML(); return; }

  $('niche-results').innerHTML = loadingHTML(t(`Analizando "${query}"…`, `Analyzing "${query}"…`));
  $('niche-btn').disabled = true;
  $('niche-history').style.display = 'none';

  try {
    const resp = await chrome.runtime.sendMessage({ action: 'analyzeNiche', query });
    if (resp.error) throw new Error(resp.error);
    await renderNicheResults(query, resp.data);
    await saveToHistory('nicheHistory', query);
    renderHistory('niche-history', 'nicheHistory');
  } catch (err) {
    $('niche-results').innerHTML = errorHTML(err.message);
    $('niche-history').style.display = '';
  } finally {
    $('niche-btn').disabled = false;
  }
}

async function renderNicheResults(query, data) {
  const { videos, stats, score, income, formatBreakdown } = data;
  const scoreClass = score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';
  const scoreLabel = score >= 70
    ? t('Alta Oportunidad', 'High Opportunity')
    : score >= 40
    ? t('Oportunidad Media', 'Medium Opportunity')
    : t('Alta Competencia', 'High Competition');
  const scoreDesc = score >= 70
    ? t('Buena demanda y competencia manejable. Buen momento para entrar.', 'Good demand and manageable competition. Good time to enter.')
    : score >= 40
    ? t('Nicho establecido. Necesitas diferenciación clara de contenido.', 'Established niche. You need clear content differentiation.')
    : t('Nicho muy competitivo. Dominado por canales grandes.', 'Very competitive niche. Dominated by large channels.');
  const barColor = score >= 70 ? '#00C896' : score >= 40 ? '#F5A623' : '#FF5555';

  const favs = await getFavorites();
  const isSaved = favs.some(f => f.query === query);

  const incomeHTML = income ? `
    <div class="income-card">
      <div class="income-row">
        <div class="income-stat">
          <span class="income-val">$${income.cpm} CPM</span>
          <span class="income-label">${t('CPM estimado', 'Est. CPM')}</span>
        </div>
        <div class="income-stat">
          <span class="income-val">$${fmtNum(income.min)}–$${fmtNum(income.max)}</span>
          <span class="income-label">${t('Ingresos/mes est.', 'Est. monthly revenue')}</span>
        </div>
      </div>
      ${formatBreakdown ? `<div class="format-row">
        <div class="fmt-badge short">${formatBreakdown.short}%<span class="fmt-label">Shorts</span></div>
        <div class="fmt-badge medium">${formatBreakdown.medium}%<span class="fmt-label">${t('Medio', 'Medium')}</span></div>
        <div class="fmt-badge long">${formatBreakdown.long}%<span class="fmt-label">${t('Largo', 'Long')}</span></div>
      </div>` : ''}
    </div>` : '';

  const ringDeg = Math.round(score * 3.6);
  $('niche-results').innerHTML = `
    <button class="btn-back-history" id="btn-back-niche">← ${t('Búsquedas recientes', 'Recent searches')}</button>
    <div class="score-card ${scoreClass}">
      <div class="score-ring" style="background:conic-gradient(${barColor} ${ringDeg}deg,#252525 ${ringDeg}deg)">
        <div class="score-num">${score}</div>
      </div>
      <div class="score-info">
        <div class="score-sublabel">${scoreLabel}</div>
        <p>${scoreDesc}</p>
      </div>
      <button class="fav-btn ${isSaved ? 'saved' : ''}" id="fav-btn" data-fav-query="${query.replace(/"/g,'&quot;')}" data-fav-score="${score}">
        <svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
      </button>
    </div>
    ${incomeHTML}
    <div class="stats-row">
      <div class="stat-card" style="--stat-accent:#00C896">
        <div class="stat-value">${fmtNum(stats.avgViews)}</div>
        <div class="stat-label">${t('Views prom.', 'Avg. views')}</div>
      </div>
      <div class="stat-card" style="--stat-accent:#F5A623">
        <div class="stat-value">${stats.avgEngagement}%</div>
        <div class="stat-label">Engagement</div>
      </div>
      <div class="stat-card" style="--stat-accent:#6C8EF5">
        <div class="stat-value">${fmtNum(stats.avgSubs)}</div>
        <div class="stat-label">${t('Subs prom.', 'Avg. subs')}</div>
      </div>
    </div>
    <div class="section-title">${t('Top Videos del Nicho', 'Top Niche Videos')}</div>
    ${videos.map((v, i) => videoItemHTML(v, i + 1)).join('')}
    ${data.locked ? lockBannerHTML(data.lockedCount, t('videos', 'videos')) : ''}
  `;
}

// ── Trending ──────────────────────────────────────────────
document.querySelectorAll('[data-cat]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-cat]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentCategory = btn.dataset.cat;
    if (trendingLoaded) loadTrending();
  });
});

document.querySelectorAll('[data-region]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-region]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentRegion = btn.dataset.region;
    if (trendingLoaded) loadTrending();
  });
});

// ── Viral search ──────────────────────────────────────────
$('viral-btn').addEventListener('click', searchViral);
$('viral-input').addEventListener('keydown', e => { if (e.key === 'Enter') searchViral(); });

async function searchViral() {
  const query = $('viral-input').value.trim();
  if (!query) { loadTrending(); return; }
  if (isURL(query)) {
    $('trending-results').innerHTML = `<div class="error-msg">${t('Ingresá un tema, no una URL.', 'Enter a topic, not a URL.')}</div>`;
    return;
  }
  const ok = await checkAndIncrementUsage();
  if (!ok) { $('trending-results').innerHTML = limitHTML(); return; }
  $('trending-results').innerHTML = loadingHTML(t(`Buscando videos virales de "${query}"…`, `Searching viral videos for "${query}"…`));
  $('viral-btn').disabled = true;
  $('viral-history').style.display = 'none';
  $('viral-filters').style.display = 'none';
  $('viral-region-filters').style.display = 'none';

  try {
    const resp = await chrome.runtime.sendMessage({ action: 'analyzeNiche', query });
    if (resp.error) throw new Error(resp.error);
    const videos = resp.data?.videos || [];
    if (!videos.length) throw new Error(t('No se encontraron videos.', 'No videos found.'));
    $('trending-results').innerHTML = `
      <button class="btn-back-history" id="btn-back-viral">← ${t('Búsquedas recientes', 'Recent searches')}</button>
      <div class="section-title" style="margin-bottom:8px">${t('Videos virales', 'Viral videos')} — ${query}</div>
      ${videos.map((v, i) => videoItemHTML(v, i + 1)).join('')}
    `;
    await saveToHistory('viralHistory', query);
    renderHistory('viral-history', 'viralHistory');
  } catch (err) {
    $('trending-results').innerHTML = errorHTML(err.message);
    $('viral-history').style.display = '';
    $('viral-filters').style.display = '';
    $('viral-region-filters').style.display = '';
  } finally {
    $('viral-btn').disabled = false;
  }
}

async function loadTrending() {
  $('trending-results').innerHTML = loadingHTML(t('Cargando tendencias…', 'Loading trends…'));
  $('viral-filters').style.display = '';
  $('viral-region-filters').style.display = '';
  try {
    const resp = await chrome.runtime.sendMessage({
      action: 'getTrending',
      region: currentRegion,
      category: currentCategory
    });
    if (resp.error) throw new Error(resp.error);
    $('trending-results').innerHTML = resp.data.videos.map((v, i) => videoItemHTML(v, i + 1)).join('');
  } catch (err) {
    $('trending-results').innerHTML = errorHTML(err.message);
  }
}

// ── Channel Analyzer ──────────────────────────────────────
$('channel-btn').addEventListener('click', analyzeChannel);
$('channel-input').addEventListener('keydown', e => { if (e.key === 'Enter') analyzeChannel(); });

async function analyzeChannel() {
  const input = $('channel-input').value.trim();
  if (!input) return;

  const ok = await checkAndIncrementUsage();
  if (!ok) { $('channel-results').innerHTML = limitHTML(); return; }

  $('channel-results').innerHTML = loadingHTML(t('Analizando canal…', 'Analyzing channel…'));
  $('channel-btn').disabled = true;

  try {
    const resp = await chrome.runtime.sendMessage({ action: 'analyzeChannel', input });
    if (resp.error) throw new Error(resp.error);
    renderChannelResults(resp.data);
  } catch (err) {
    $('channel-results').innerHTML = errorHTML(err.message);
  } finally {
    $('channel-btn').disabled = false;
  }
}

function renderChannelResults(data) {
  const { channel, topVideos, stats } = data;
  $('channel-results').innerHTML = `
    <div class="channel-header">
      <div class="channel-avatar">${channel.name[0].toUpperCase()}</div>
      <div>
        <div class="channel-name">${channel.name}</div>
        <div class="channel-subs">${fmtNum(channel.subscribers)} ${t('suscriptores', 'subscribers')} · ${fmtNum(channel.totalViews)} ${t('vistas totales', 'total views')}</div>
        <div style="font-size:10px;color:var(--muted);margin-top:2px">${fmtNum(channel.videoCount)} ${t('videos · Creado', 'videos · Created')} ${fmtDate(channel.publishedAt)}</div>
      </div>
    </div>
    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-value">${fmtNum(stats.avgViews)}</div>
        <div class="stat-label">${t('Views prom.', 'Avg. views')}</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.uploadFreq}/${t('sem', 'wk')}</div>
        <div class="stat-label">${t('Frecuencia', 'Frequency')}</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.avgEngagement}%</div>
        <div class="stat-label">Engagement</div>
      </div>
    </div>
    <div class="section-title">${t('Top Videos del Canal', 'Top Channel Videos')}</div>
    ${topVideos.length ? topVideos.map((v, i) => videoItemHTML(v, i + 1)).join('') : ''}
    ${data.locked ? lockBannerHTML(data.lockedCount, t('videos del canal', 'channel videos')) : ''}
  `;
}

// ── Keyword Research ──────────────────────────────────────
$('kw-btn').addEventListener('click', searchKeywords);
$('kw-input').addEventListener('keydown', e => { if (e.key === 'Enter') searchKeywords(); });

function isURL(str) {
  return /^https?:\/\//i.test(str) || /^www\./i.test(str) || str.includes('youtube.com');
}

async function searchKeywords() {
  const query = $('kw-input').value.trim();
  if (!query) return;
  if (isURL(query)) {
    $('kw-results').innerHTML = `<div class="error-msg">${t('Ingresá un tema o keyword, no una URL.<br><small style="color:var(--muted)">Para analizar un canal usá la pestaña Canal.</small>', 'Enter a topic or keyword, not a URL.<br><small style="color:var(--muted)">To analyze a channel use the Channel tab.</small>')}</div>`;
    return;
  }

  const ok = await checkAndIncrementUsage();
  if (!ok) { $('kw-results').innerHTML = limitHTML(); return; }

  $('kw-results').innerHTML = loadingHTML(t(`Buscando keywords para "${query}"…`, `Searching keywords for "${query}"…`));
  $('kw-btn').disabled = true;
  $('kw-history').style.display = 'none';

  try {
    const resp = await chrome.runtime.sendMessage({ action: 'searchKeywords', query });
    if (resp.error) throw new Error(resp.error);
    renderKeywordResults(resp.data);
    await saveToHistory('kwHistory', query);
    renderHistory('kw-history', 'kwHistory');
    loadTags(query);
  } catch (err) {
    $('kw-results').innerHTML = errorHTML(err.message);
    $('kw-history').style.display = '';
  } finally {
    $('kw-btn').disabled = false;
  }
}

function renderKeywordResults(data) {
  const { keywords, parsedTopic, lang, locked, lockedCount } = data;
  if (!keywords.length) {
    $('kw-results').innerHTML = errorHTML(t('No se encontraron keywords. Probá con otro término.', 'No keywords found. Try another term.'));
    return;
  }

  const langLabel = lang === 'en' ? 'English' : lang === 'es' ? 'Español' : lang === 'pt' ? 'Português' : '';
  const topicBadge = parsedTopic ? `
    <div style="background:rgba(0,200,150,0.07);border:1px solid rgba(0,200,150,0.15);border-radius:5px;padding:7px 10px;margin-bottom:10px;font-size:11px;color:var(--muted)">
      ${t('Buscando', 'Searching')}: <strong style="color:var(--accent)">${parsedTopic}</strong>${langLabel ? ` &nbsp;·&nbsp; ${langLabel}` : ''}
    </div>` : '';

  const compLabel = { 'Baja': t('Baja', 'Low'), 'Media': t('Media', 'Med'), 'Alta': t('Alta', 'High'), 'N/A': 'N/A' };

  const html = keywords.map(kw => {
    const scoreColor = kw.score >= 70 ? '#00C896' : kw.score >= 40 ? '#F5A623' : '#7A7A7A';
    const compColor = kw.competition === 'Baja' ? 'hot' : '';
    const barColor = kw.score >= 70 ? '#00C896' : kw.score >= 40 ? '#F5A623' : '#555';
    return `
      <div class="keyword-item" data-keyword="${kw.keyword.replace(/"/g, '&quot;')}">
        <div class="kw-info">
          <div class="kw-text">${kw.keyword}</div>
          <div class="video-meta">
            <span class="meta-tag">${fmtNum(kw.avgViews)} views/${t('video','video')}</span>
            <span class="meta-tag">${fmtNum(kw.topViewsTotal)} total</span>
            <span class="meta-tag">${kw.avgEngagement}% eng</span>
            <span class="meta-tag ${compColor}">${t('Comp', 'Comp')}: ${compLabel[kw.competition] || kw.competition}</span>
          </div>
          <div class="kw-bar-wrap">
            <div class="kw-bar" style="width:${kw.score}%;background:${barColor}"></div>
          </div>
        </div>
        <div class="kw-score" style="color:${scoreColor}">${kw.score}</div>
        <a class="btn-open-tab" href="https://www.youtube.com/results?search_query=${encodeURIComponent(kw.keyword)}" target="_blank" title="${t('Buscar en YouTube', 'Search on YouTube')}"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>
      </div>`;
  }).join('');

  $('kw-results').innerHTML = `
    <button class="btn-back-history" id="btn-back-kw">← ${t('Búsquedas recientes', 'Recent searches')}</button>
    ${topicBadge}
    <div class="section-title" style="margin-bottom:10px">${t('Keywords — click para analizar nicho', 'Keywords — click to analyze niche')}</div>
    ${html}
    ${locked ? lockBannerHTML(lockedCount, 'keywords') : ''}
    <div id="tags-section" style="margin-top:10px"></div>
  `;
}

async function loadTags(query) {
  const el = $('tags-section');
  if (!el) return;
  el.innerHTML = `<div class="section-title" style="margin-bottom:6px">${t('Tags para tu video', 'Tags for your video')}</div><div class="loading" style="padding:8px 0"><div class="spinner" style="width:14px;height:14px;margin-bottom:5px"></div>${t('Generando tags…', 'Generating tags…')}</div>`;
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'generateTags', query });
    if (resp.error || !resp.data?.tags?.length) { el.innerHTML = ''; return; }
    const allTags = resp.data.tags.join(', ');
    el.innerHTML = `
      <div class="section-title" style="margin-bottom:6px">${t('Tags para tu video', 'Tags for your video')}</div>
      <div class="tags-wrap">${resp.data.tags.map(tag => `<span class="tag-chip">${tag}</span>`).join('')}</div>
      <button class="copy-all-btn" data-copy="${allTags.replace(/"/g,'&quot;')}">${t('Copiar todos los tags', 'Copy all tags')}</button>`;
  } catch { el.innerHTML = ''; }
}

// ── License ───────────────────────────────────────────────
$('activate-btn')?.addEventListener('click', async () => {
  const key = $('license-input').value.trim();
  if (!key) return showMsg(t('Ingresa una clave de licencia', 'Enter a license key'), 'error');
  $('activate-btn').disabled = true;
  $('activate-btn').textContent = t('Verificando…', 'Verifying…');
  const resp = await chrome.runtime.sendMessage({ action: 'activateLicense', licenseKey: key });
  $('activate-btn').disabled = false;
  $('activate-btn').dataset.es = 'Activar';
  $('activate-btn').dataset.en = 'Activate';
  $('activate-btn').textContent = t('Activar', 'Activate');
  if (resp.success) {
    showMsg(t('Licencia activada. Plan Pro activo.', 'License activated. Pro plan active.'), 'success');
    setTimeout(() => init(), 800);
  } else {
    showMsg(resp.error || t('Licencia inválida', 'Invalid license'), 'error');
  }
});

$('deactivate-btn')?.addEventListener('click', async () => {
  await chrome.storage.local.remove(['licenseKey', 'isPro']);
  init();
});

function showMsg(text, type) {
  const el = $('activation-msg');
  el.className = `msg msg-${type}`;
  el.textContent = text;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}

// ── External links ────────────────────────────────────────
$('footer-home')?.addEventListener('click', e => {
  e.preventDefault();
  chrome.tabs.create({ url: 'https://tube-scout-production.up.railway.app' });
});
$('footer-dashboard')?.addEventListener('click', e => {
  e.preventDefault();
  chrome.tabs.create({ url: 'https://tube-scout-production.up.railway.app/dashboard.html' });
});
$('footer-pricing')?.addEventListener('click', e => {
  e.preventDefault();
  chrome.tabs.create({ url: 'https://tube-scout-production.up.railway.app/#pricing' });
});
$('upgrade-btn')?.addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://tubescoutt.lemonsqueezy.com/checkout/buy/c9bd902c-3d7c-4650-97ac-1a8fba1fbc4a' });
});

// ── Templates ─────────────────────────────────────────────
function videoItemHTML(v, rank) {
  const engClass = v.engagementRate > 5 ? 'hot' : '';
  const scoreColor = v.viralScore >= 70 ? '#00C896' : v.viralScore >= 40 ? '#F5A623' : '#7A7A7A';
  const scoreBg = v.viralScore >= 70 ? 'rgba(0,200,150,0.1)' : v.viralScore >= 40 ? 'rgba(245,166,35,0.1)' : 'rgba(122,122,122,0.1)';
  const fmtLabel = v.format === 'short' ? 'Short' : v.format === 'medium' ? t('Medio', 'Medium') : t('Largo', 'Long');
  const fmtClass = v.format || 'long';
  const ytUrl = v.videoId ? `https://www.youtube.com/watch?v=${v.videoId}` : '';
  return `
    <div class="video-item">
      <div class="video-rank">#${rank}</div>
      <div class="video-info">
        <div class="video-title">${stripEmoji(v.title)}</div>
        <div class="video-meta">
          <span class="meta-tag">${fmtNum(v.views)} views</span>
          <span class="meta-tag ${engClass}">${v.engagementRate}% eng</span>
          <span class="meta-tag">${v.channelName}</span>
          <span class="meta-tag">${fmtDate(v.publishedAt)}</span>
          <span class="vid-format ${fmtClass}">${fmtLabel}</span>
        </div>
      </div>
      <div class="score-pill" style="background:${scoreBg};color:${scoreColor}">${v.viralScore}</div>
      ${ytUrl ? `<a class="btn-open-tab" href="${ytUrl}" target="_blank" title="${t('Abrir en YouTube', 'Open on YouTube')}"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>` : ''}
    </div>`;
}

function lockBannerHTML(count, type) {
  return `
    <div class="lock-banner">
      <p><strong>${count} ${type} ${t('más', 'more')}</strong> ${t('disponibles en Pro', 'available in Pro')}</p>
      <button class="btn-lock-upgrade js-upgrade">${t('Ver plan Pro', 'View Pro plan')}</button>
    </div>`;
}

function loadingHTML(text) {
  return `<div class="loading"><div class="spinner"></div>${text}</div>`;
}

function errorHTML(msg) {
  return `<div class="empty-state"><p>${msg}</p></div>`;
}

function limitHTML() {
  return `
    <div class="empty-state">
      <p>${t('Llegaste al límite de análisis gratuitos.', 'You reached the free analysis limit.')}</p>
      <button onclick="window.openModal()" style="background:var(--accent);color:#0A0A0A;border:none;border-radius:6px;padding:9px 16px;font-size:12px;font-weight:600;cursor:pointer;margin:8px 0;display:block;width:100%">${t('📧 Registrate gratis → 10 análisis/día', '📧 Register free → 10 analyses/day')}</button>
      <p style="font-size:10px;color:var(--muted);margin-top:4px">${t('o', 'or')} <span class="js-upgrade" style="cursor:pointer;color:var(--accent)">${t('actualiza a Pro para ilimitados', 'upgrade to Pro for unlimited')}</span></p>
    </div>`;
}

// ── Helpers ───────────────────────────────────────────────
function fmtNum(n) {
  if (n == null) return '—';
  n = parseInt(n);
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
}

function fmtDate(str) {
  if (!str) return '—';
  const days = Math.floor((Date.now() - new Date(str)) / 86400000);
  if (days === 0) return t('Hoy', 'Today');
  if (days === 1) return t('Ayer', 'Yesterday');
  if (days < 30) return t(`Hace ${days}d`, `${days}d ago`);
  if (days < 365) return t(`Hace ${Math.floor(days / 30)}m`, `${Math.floor(days / 30)}mo ago`);
  return t(`Hace ${Math.floor(days / 365)}a`, `${Math.floor(days / 365)}y ago`);
}

// ── Event delegation ──────────────────────────────────────
document.addEventListener('click', async e => {
  const histChip = e.target.closest('.history-chip');
  if (histChip) {
    const query = histChip.dataset.hist;
    const containerId = histChip.parentElement.id;
    if (containerId === 'niche-history') {
      $('niche-input').value = query;
      analyzeNiche();
    } else if (containerId === 'kw-history') {
      $('kw-input').value = query;
      searchKeywords();
    } else if (containerId === 'viral-history') {
      $('viral-input').value = query;
      searchViral();
    }
    return;
  }

  const kwItem = e.target.closest('[data-keyword]');
  if (kwItem) {
    const keyword = kwItem.dataset.keyword;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.querySelector('[data-tab="niche"]').classList.add('active');
    $('panel-niche').classList.add('active');
    $('niche-input').value = keyword;
    analyzeNiche();
    return;
  }

  if (e.target.classList.contains('js-upgrade')) {
    chrome.tabs.create({ url: 'https://tube-scout-production.up.railway.app/#pricing' });
    return;
  }

  const copyBtn = e.target.closest('[data-copy]');
  if (copyBtn) {
    const text = copyBtn.dataset.copy;
    navigator.clipboard.writeText(text).then(() => {
      const orig = copyBtn.textContent;
      copyBtn.textContent = t('Copiado!', 'Copied!');
      copyBtn.classList.add('copied');
      setTimeout(() => { copyBtn.textContent = orig; copyBtn.classList.remove('copied'); }, 1500);
    });
    return;
  }

  if (e.target.id === 'btn-back-niche') {
    $('niche-results').innerHTML = '';
    $('niche-history').style.display = '';
    return;
  }

  if (e.target.id === 'btn-back-kw') {
    $('kw-results').innerHTML = '';
    $('kw-history').style.display = '';
    return;
  }

  if (e.target.id === 'btn-back-viral') {
    $('viral-input').value = '';
    $('viral-history').style.display = '';
    $('viral-filters').style.display = '';
    $('viral-region-filters').style.display = '';
    loadTrending();
    return;
  }

  const favBtn = e.target.closest('[data-fav-query]');
  if (favBtn && favBtn.id === 'fav-btn') {
    const query = favBtn.dataset.favQuery;
    const score = parseInt(favBtn.dataset.favScore || 0);
    const saved = await toggleFavorite(query, score);
    favBtn.classList.toggle('saved', saved);
    renderFavorites();
    return;
  }

  const favAnalyze = e.target.closest('.fav-analyze');
  if (favAnalyze) {
    const query = favAnalyze.dataset.favQuery;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.querySelector('[data-tab="niche"]').classList.add('active');
    $('panel-niche').classList.add('active');
    $('niche-input').value = query;
    analyzeNiche();
    return;
  }

  const favDel = e.target.closest('[data-fav-del]');
  if (favDel) {
    const query = favDel.dataset.favDel;
    const favs = await getFavorites();
    await chrome.storage.local.set({ favorites: favs.filter(f => f.query !== query) });
    renderFavorites();
    return;
  }
});

init();
