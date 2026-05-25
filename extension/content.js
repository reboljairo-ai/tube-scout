let panelVisible = false;

function insertButton() {
  if (document.getElementById('ts-btn')) return;
  const target = document.querySelector('#owner') || document.querySelector('ytd-channel-name');
  if (!target) return;

  const btn = document.createElement('button');
  btn.id = 'ts-btn';
  btn.textContent = '🎯 TubeScout';
  btn.addEventListener('click', togglePanel);
  target.insertAdjacentElement('afterend', btn);
}

function getVideoData() {
  const videoId = new URLSearchParams(window.location.search).get('v');
  if (!videoId) return null;

  const views = parseInt(
    (document.querySelector('.view-count')?.textContent ||
     document.querySelector('#count .view-count-sub-count')?.textContent || '0')
      .replace(/[^0-9]/g, '')
  ) || 0;

  const likesEl = document.querySelector('ytd-toggle-button-renderer #text');
  const likes = likesEl ? parseInt(likesEl.textContent.replace(/[^0-9]/g, '')) || 0 : 0;

  const subsEl = document.querySelector('#owner-sub-count');
  const subsText = subsEl?.textContent?.trim() || '—';

  const engagementRate = views > 0 ? ((likes / views) * 100).toFixed(2) : '0';
  const viewScore = Math.min(100, Math.log10(Math.max(1, views)) * 15);
  const engScore = Math.min(100, parseFloat(engagementRate) * 20);
  const viralScore = Math.round(viewScore * 0.6 + engScore * 0.4);

  return { videoId, views, likes, subsText, engagementRate, viralScore };
}

function fmtNum(n) {
  if (!n) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
}

function togglePanel() {
  let panel = document.getElementById('ts-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'ts-panel';
    document.body.appendChild(panel);
  }

  if (panelVisible) {
    panel.style.display = 'none';
    panelVisible = false;
    return;
  }

  panel.style.display = 'block';
  panelVisible = true;

  const data = getVideoData();
  if (!data) {
    panel.innerHTML = '<div class="ts-header"><span class="ts-logo">🎯 TubeScout</span><button class="ts-close" id="ts-close-btn">✕</button></div><div class="ts-body"><p style="color:#94A3B8;font-size:12px;text-align:center;padding:16px">No se pudo leer los datos del video.</p></div>';
    document.getElementById('ts-close-btn').addEventListener('click', () => {
      panel.style.display = 'none';
      panelVisible = false;
    });
    return;
  }

  const scoreColor = data.viralScore >= 70 ? '#4ADE80' : data.viralScore >= 40 ? '#FBBF24' : '#94A3B8';

  panel.innerHTML = `
    <div class="ts-header">
      <span class="ts-logo">🎯 TubeScout</span>
      <button class="ts-close" id="ts-close-btn">✕</button>
    </div>
    <div class="ts-body">
      <div class="ts-score" style="color:${scoreColor}">${data.viralScore}<span style="font-size:12px;font-weight:normal;color:#94A3B8"> /100</span></div>
      <div class="ts-score-label">Viral Score</div>
      <div class="ts-divider"></div>
      <div class="ts-stat-row">
        <div class="ts-stat"><div class="ts-stat-val">${fmtNum(data.views)}</div><div class="ts-stat-lbl">Views</div></div>
        <div class="ts-stat"><div class="ts-stat-val">${data.engagementRate}%</div><div class="ts-stat-lbl">Engagement</div></div>
      </div>
      <div class="ts-stat-row" style="margin-top:8px">
        <div class="ts-stat"><div class="ts-stat-val">${fmtNum(data.likes)}</div><div class="ts-stat-lbl">Likes</div></div>
        <div class="ts-stat"><div class="ts-stat-val">${data.subsText}</div><div class="ts-stat-lbl">Subs canal</div></div>
      </div>
    </div>
  `;

  document.getElementById('ts-close-btn').addEventListener('click', () => {
    panel.style.display = 'none';
    panelVisible = false;
  });
}

// YouTube is a SPA — observe navigation changes
const observer = new MutationObserver(() => {
  if (window.location.pathname === '/watch') {
    setTimeout(insertButton, 1500);
  }
});
observer.observe(document.body, { childList: true, subtree: true });

if (window.location.pathname === '/watch') {
  setTimeout(insertButton, 1500);
}
