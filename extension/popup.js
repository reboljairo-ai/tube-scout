const $ = id => document.getElementById(id);
const FREE_LIMIT = 20;

const stripEmoji = s => s.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '').replace(/\s+/g, ' ').trim();

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
  const { isPro, licenseKey, analysisCount, lastReset } =
    await chrome.storage.local.get(['isPro', 'licenseKey', 'analysisCount', 'lastReset']);
  const today = new Date().toDateString();
  const count = lastReset === today ? (analysisCount || 0) : 0;
  if (isPro && licenseKey) {
    showProState(licenseKey);
  } else {
    showFreeState(count);
  }
  renderHistory('niche-history', 'nicheHistory');
  renderHistory('kw-history', 'kwHistory');
  renderFavorites();
  const { pendingModalStep } = await chrome.storage.local.get('pendingModalStep');
  if (pendingModalStep) openModal(pendingModalStep);
}

function showFreeState(count) {
  $('plan-badge').textContent = 'Free';
  $('plan-badge').className = 'plan-badge badge-free';
  $('plan-badge2').textContent = 'Free';
  $('plan-badge2').className = 'plan-badge badge-free';
  $('plan-name').textContent = 'Free';
  $('usage-text').textContent = `${count} de ${FREE_LIMIT} análisis usados hoy`;
  $('usage-bar').style.width = `${(count / FREE_LIMIT) * 100}%`;
  $('usage-bar').style.background = count >= FREE_LIMIT ? '#FF5555' : 'var(--accent)';
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
  $('usage-text').textContent = 'Análisis ilimitados';
  $('usage-bar').style.width = '100%';
  $('license-section').style.display = 'none';
  $('pro-active').style.display = 'block';
  $('upgrade-section').style.display = 'none';
}

// ── Usage tracking ────────────────────────────────────────
async function checkAndIncrementUsage() {
  const { isPro, accessToken, guestCount } =
    await chrome.storage.local.get(['isPro', 'accessToken', 'guestCount']);
  if (isPro) return true;
  if (accessToken) return true;
  const count = guestCount || 0;
  if (count >= 3) { openModal(); return false; }
  await chrome.storage.local.set({ guestCount: count + 1 });
  return true;
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
async function openModal(step = 'email') {
  $('modal-overlay').style.display = 'flex';
  if (step === 'code') {
    $('step-email').style.display = 'none';
    $('step-code').style.display = 'block';
    const { pendingEmail, pendingDevCode } = await chrome.storage.local.get(['pendingEmail', 'pendingDevCode']);
    if (pendingEmail) $('modal-email').value = pendingEmail;
    if (pendingDevCode) showModalMsg('code', `[DEV] Tu código: ${pendingDevCode}`, 'success');
  } else {
    $('step-email').style.display = 'block';
    $('step-code').style.display = 'none';
  }
}
async function closeModal() {
  $('modal-overlay').style.display = 'none';
  await chrome.storage.local.remove(['pendingEmail', 'pendingDevCode', 'pendingModalStep']);
}

$('send-code-btn')?.addEventListener('click', async () => {
  const email = $('modal-email').value.trim();
  if (!email || !email.includes('@')) return showModalMsg('email', 'Email inválido', 'error');
  $('send-code-btn').disabled = true;
  $('send-code-btn').textContent = 'Enviando…';
  const resp = await chrome.runtime.sendMessage({ action: 'requestCode', email });
  $('send-code-btn').disabled = false;
  $('send-code-btn').textContent = 'Enviar código';
  if (resp.success) {
    await chrome.storage.local.set({
      pendingEmail: email,
      pendingModalStep: 'code',
      ...(resp.devCode ? { pendingDevCode: resp.devCode } : {})
    });
    $('step-email').style.display = 'none';
    $('step-code').style.display = 'block';
    if (resp.devCode) showModalMsg('code', `[DEV] Tu código: ${resp.devCode}`, 'success');
  } else {
    showModalMsg('email', resp.error || 'Error al enviar', 'error');
  }
});

$('verify-code-btn')?.addEventListener('click', async () => {
  const email = $('modal-email').value.trim();
  const code = $('modal-code').value.trim();
  if (!code || code.length < 6) return showModalMsg('code', 'Ingresá el código de 6 dígitos', 'error');
  $('verify-code-btn').disabled = true;
  $('verify-code-btn').textContent = 'Verificando…';
  const resp = await chrome.runtime.sendMessage({ action: 'verifyCode', email, code });
  $('verify-code-btn').disabled = false;
  $('verify-code-btn').textContent = 'Verificar código';
  if (resp.success) {
    await chrome.storage.local.set({ accessToken: resp.token, guestCount: 0 });
    await chrome.storage.local.remove(['pendingEmail', 'pendingDevCode', 'pendingModalStep']);
    showModalMsg('code', 'Listo! 10 búsquedas/día desbloqueadas.', 'success');
    setTimeout(() => { closeModal(); init(); }, 1200);
  } else {
    showModalMsg('code', resp.error || 'Código incorrecto', 'error');
  }
});

$('back-to-email')?.addEventListener('click', async () => {
  await chrome.storage.local.remove(['pendingEmail', 'pendingDevCode', 'pendingModalStep']);
  $('step-email').style.display = 'block';
  $('step-code').style.display = 'none';
});

$('skip-modal')?.addEventListener('click', () => {
  closeModal();
  chrome.tabs.create({ url: 'https://tubescout.io/#pricing' });
});

function showModalMsg(step, text, type) {
  const el = $(`modal-msg-${step}`);
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
    el.innerHTML = '<div class="empty-state" style="padding:12px 0"><p style="font-size:11px">No hay nichos guardados aún.<br>Guardá un análisis con el icono estrella.</p></div>';
    return;
  }
  el.innerHTML = favs.map(f => `
    <div class="fav-item">
      <div class="fav-name">${f.query}</div>
      <button class="fav-analyze" data-fav-query="${f.query.replace(/"/g,'&quot;')}">Analizar</button>
      <button class="fav-delete" data-fav-del="${f.query.replace(/"/g,'&quot;')}">×</button>
    </div>`).join('');
}

// ── Title Generator ───────────────────────────────────────
$('title-btn').addEventListener('click', generateTitles);
$('title-input').addEventListener('keydown', e => { if (e.key === 'Enter') generateTitles(); });

async function generateTitles() {
  const query = $('title-input').value.trim();
  if (!query) return;
  $('title-results').innerHTML = loadingHTML(`Generando títulos para "${query}"…`);
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
  const titlesHTML = titles.map((t, i) => `
    <div class="title-item">
      <div class="title-text">${t}</div>
      <button class="copy-btn" data-copy="${t.replace(/"/g,'&quot;')}">Copiar</button>
    </div>`).join('');

  const refHTML = topTitles?.length ? `
    <div class="section-title" style="margin:14px 0 8px">Referencia — Top videos virales</div>
    ${topTitles.map(t => `<div class="ref-title">${t}</div>`).join('')}` : '';

  $('title-results').innerHTML = `
    <div class="section-title" style="margin-bottom:8px">15 títulos optimizados</div>
    ${titlesHTML}${refHTML}`;
}

// ── Niche Analyzer ────────────────────────────────────────
$('niche-btn').addEventListener('click', analyzeNiche);
$('niche-input').addEventListener('keydown', e => { if (e.key === 'Enter') analyzeNiche(); });

async function analyzeNiche() {
  const query = $('niche-input').value.trim();
  if (!query) return;

  const ok = await checkAndIncrementUsage();
  if (!ok) { $('niche-results').innerHTML = limitHTML(); return; }

  $('niche-results').innerHTML = loadingHTML(`Analizando "${query}"…`);
  $('niche-btn').disabled = true;

  try {
    const resp = await chrome.runtime.sendMessage({ action: 'analyzeNiche', query });
    if (resp.error) throw new Error(resp.error);
    await renderNicheResults(query, resp.data);
    await saveToHistory('nicheHistory', query);
    renderHistory('niche-history', 'nicheHistory');
  } catch (err) {
    $('niche-results').innerHTML = errorHTML(err.message);
  } finally {
    $('niche-btn').disabled = false;
  }
}

async function renderNicheResults(query, data) {
  const { videos, stats, score, income, formatBreakdown } = data;
  const scoreClass = score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';
  const scoreLabel = score >= 70 ? 'Alta Oportunidad' : score >= 40 ? 'Oportunidad Media' : 'Alta Competencia';
  const scoreDesc = score >= 70
    ? 'Buena demanda y competencia manejable. Buen momento para entrar.'
    : score >= 40
    ? 'Nicho establecido. Necesitas diferenciación clara de contenido.'
    : 'Nicho muy competitivo. Dominado por canales grandes.';
  const barColor = score >= 70 ? '#00C896' : score >= 40 ? '#F5A623' : '#FF5555';

  const favs = await getFavorites();
  const isSaved = favs.some(f => f.query === query);

  const incomeHTML = income ? `
    <div class="income-card">
      <div class="income-row">
        <div class="income-stat">
          <span class="income-val">$${income.cpm} CPM</span>
          <span class="income-label">CPM estimado</span>
        </div>
        <div class="income-stat">
          <span class="income-val">$${fmtNum(income.min)}–$${fmtNum(income.max)}</span>
          <span class="income-label">Ingresos/mes estimados</span>
        </div>
      </div>
      ${formatBreakdown ? `<div class="format-row">
        <div class="fmt-badge short">${formatBreakdown.short}%<span class="fmt-label">Shorts</span></div>
        <div class="fmt-badge medium">${formatBreakdown.medium}%<span class="fmt-label">Medio</span></div>
        <div class="fmt-badge long">${formatBreakdown.long}%<span class="fmt-label">Largo</span></div>
      </div>` : ''}
    </div>` : '';

  const ringDeg = Math.round(score * 3.6);
  $('niche-results').innerHTML = `
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
        <div class="stat-label">Views prom.</div>
      </div>
      <div class="stat-card" style="--stat-accent:#F5A623">
        <div class="stat-value">${stats.avgEngagement}%</div>
        <div class="stat-label">Engagement</div>
      </div>
      <div class="stat-card" style="--stat-accent:#6C8EF5">
        <div class="stat-value">${fmtNum(stats.avgSubs)}</div>
        <div class="stat-label">Subs prom.</div>
      </div>
    </div>
    <div class="section-title">Top Videos del Nicho</div>
    ${videos.map((v, i) => videoItemHTML(v, i + 1)).join('')}
    ${data.locked ? lockBannerHTML(data.lockedCount, 'videos') : ''}
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

async function loadTrending() {
  $('trending-results').innerHTML = loadingHTML('Cargando tendencias…');
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

  $('channel-results').innerHTML = loadingHTML('Analizando canal…');
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
        <div class="channel-subs">${fmtNum(channel.subscribers)} suscriptores · ${fmtNum(channel.totalViews)} vistas totales</div>
        <div style="font-size:10px;color:var(--muted);margin-top:2px">${fmtNum(channel.videoCount)} videos · Creado ${fmtDate(channel.publishedAt)}</div>
      </div>
    </div>
    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-value">${fmtNum(stats.avgViews)}</div>
        <div class="stat-label">Views prom.</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.uploadFreq}/sem</div>
        <div class="stat-label">Frecuencia</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.avgEngagement}%</div>
        <div class="stat-label">Engagement</div>
      </div>
    </div>
    <div class="section-title">Top Videos del Canal</div>
    ${topVideos.length ? topVideos.map((v, i) => videoItemHTML(v, i + 1)).join('') : ''}
    ${data.locked ? lockBannerHTML(data.lockedCount, 'videos del canal') : ''}
  `;
}

// ── Keyword Research ──────────────────────────────────────
$('kw-btn').addEventListener('click', searchKeywords);
$('kw-input').addEventListener('keydown', e => { if (e.key === 'Enter') searchKeywords(); });

async function searchKeywords() {
  const query = $('kw-input').value.trim();
  if (!query) return;

  const ok = await checkAndIncrementUsage();
  if (!ok) { $('kw-results').innerHTML = limitHTML(); return; }

  $('kw-results').innerHTML = loadingHTML(`Buscando keywords para "${query}"…`);
  $('kw-btn').disabled = true;

  try {
    const resp = await chrome.runtime.sendMessage({ action: 'searchKeywords', query });
    if (resp.error) throw new Error(resp.error);
    renderKeywordResults(resp.data);
    await saveToHistory('kwHistory', query);
    renderHistory('kw-history', 'kwHistory');
    loadTags(query);
  } catch (err) {
    $('kw-results').innerHTML = errorHTML(err.message);
  } finally {
    $('kw-btn').disabled = false;
  }
}

function renderKeywordResults(data) {
  const { keywords, parsedTopic, lang, locked, lockedCount } = data;
  if (!keywords.length) {
    $('kw-results').innerHTML = errorHTML('No se encontraron keywords. Probá con otro término.');
    return;
  }

  const langLabel = lang === 'en' ? 'English' : lang === 'es' ? 'Español' : lang === 'pt' ? 'Português' : '';
  const topicBadge = parsedTopic ? `
    <div style="background:rgba(0,200,150,0.07);border:1px solid rgba(0,200,150,0.15);border-radius:5px;padding:7px 10px;margin-bottom:10px;font-size:11px;color:var(--muted)">
      Buscando: <strong style="color:var(--accent)">${parsedTopic}</strong>${langLabel ? ` &nbsp;·&nbsp; ${langLabel}` : ''}
    </div>` : '';

  const html = keywords.map(kw => {
    const scoreColor = kw.score >= 70 ? '#00C896' : kw.score >= 40 ? '#F5A623' : '#7A7A7A';
    const compColor = kw.competition === 'Baja' ? 'hot' : '';
    const barColor = kw.score >= 70 ? '#00C896' : kw.score >= 40 ? '#F5A623' : '#555';
    return `
      <div class="keyword-item" data-keyword="${kw.keyword.replace(/"/g, '&quot;')}">
        <div class="kw-info">
          <div class="kw-text">${kw.keyword}</div>
          <div class="video-meta">
            <span class="meta-tag">${fmtNum(kw.avgViews)} views/video</span>
            <span class="meta-tag">${fmtNum(kw.topViewsTotal)} total</span>
            <span class="meta-tag">${kw.avgEngagement}% eng</span>
            <span class="meta-tag ${compColor}">Comp: ${kw.competition}</span>
          </div>
          <div class="kw-bar-wrap">
            <div class="kw-bar" style="width:${kw.score}%;background:${barColor}"></div>
          </div>
        </div>
        <div class="kw-score" style="color:${scoreColor}">${kw.score}</div>
      </div>`;
  }).join('');

  $('kw-results').innerHTML = `
    ${topicBadge}
    <div class="section-title" style="margin-bottom:10px">Keywords — click para analizar nicho</div>
    ${html}
    ${locked ? lockBannerHTML(lockedCount, 'keywords') : ''}
    <div id="tags-section" style="margin-top:10px"></div>
  `;
}

async function loadTags(query) {
  const el = $('tags-section');
  if (!el) return;
  el.innerHTML = `<div class="section-title" style="margin-bottom:6px">Tags para tu video</div><div class="loading" style="padding:8px 0"><div class="spinner" style="width:14px;height:14px;margin-bottom:5px"></div>Generando tags…</div>`;
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'generateTags', query });
    if (resp.error || !resp.data?.tags?.length) { el.innerHTML = ''; return; }
    const allTags = resp.data.tags.join(', ');
    el.innerHTML = `
      <div class="section-title" style="margin-bottom:6px">Tags para tu video</div>
      <div class="tags-wrap">${resp.data.tags.map(t => `<span class="tag-chip">${t}</span>`).join('')}</div>
      <button class="copy-all-btn" data-copy="${allTags.replace(/"/g,'&quot;')}">Copiar todos los tags</button>`;
  } catch { el.innerHTML = ''; }
}

// ── License ───────────────────────────────────────────────
$('activate-btn')?.addEventListener('click', async () => {
  const key = $('license-input').value.trim();
  if (!key) return showMsg('Ingresa una clave de licencia', 'error');
  $('activate-btn').disabled = true;
  $('activate-btn').textContent = 'Verificando…';
  const resp = await chrome.runtime.sendMessage({ action: 'activateLicense', licenseKey: key });
  $('activate-btn').disabled = false;
  $('activate-btn').textContent = 'Activar';
  if (resp.success) {
    showMsg('Licencia activada. Plan Pro activo.', 'success');
    setTimeout(() => init(), 800);
  } else {
    showMsg(resp.error || 'Licencia inválida', 'error');
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
  chrome.tabs.create({ url: 'https://www.tubescout.io' });
});
$('footer-help')?.addEventListener('click', e => {
  e.preventDefault();
  chrome.tabs.create({ url: 'mailto:hello@tubescout.io' });
});
$('upgrade-btn')?.addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://tubescout.lemonsqueezy.com/checkout' });
});

// ── Templates ─────────────────────────────────────────────
function videoItemHTML(v, rank) {
  const engClass = v.engagementRate > 5 ? 'hot' : '';
  const scoreColor = v.viralScore >= 70 ? '#00C896' : v.viralScore >= 40 ? '#F5A623' : '#7A7A7A';
  const scoreBg = v.viralScore >= 70 ? 'rgba(0,200,150,0.1)' : v.viralScore >= 40 ? 'rgba(245,166,35,0.1)' : 'rgba(122,122,122,0.1)';
  const fmtLabel = v.format === 'short' ? 'Short' : v.format === 'medium' ? 'Medio' : 'Largo';
  const fmtClass = v.format || 'long';
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
    </div>`;
}

function lockBannerHTML(count, type) {
  return `
    <div class="lock-banner">
      <p><strong>${count} ${type} más</strong> disponibles en Pro</p>
      <button class="btn-lock-upgrade js-upgrade">Ver plan Pro</button>
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
      <p>Llegaste al límite diario gratuito (${FREE_LIMIT} análisis).<br>
      <strong style="color:var(--accent)">Actualiza a Pro</strong> para análisis ilimitados.</p>
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
  if (days === 0) return 'Hoy';
  if (days === 1) return 'Ayer';
  if (days < 30) return `Hace ${days}d`;
  if (days < 365) return `Hace ${Math.floor(days / 30)}m`;
  return `Hace ${Math.floor(days / 365)}a`;
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
    chrome.tabs.create({ url: 'https://tubescout.io/#pricing' });
    return;
  }

  const copyBtn = e.target.closest('[data-copy]');
  if (copyBtn) {
    const text = copyBtn.dataset.copy;
    navigator.clipboard.writeText(text).then(() => {
      const orig = copyBtn.textContent;
      copyBtn.textContent = 'Copiado!';
      copyBtn.classList.add('copied');
      setTimeout(() => { copyBtn.textContent = orig; copyBtn.classList.remove('copied'); }, 1500);
    });
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
