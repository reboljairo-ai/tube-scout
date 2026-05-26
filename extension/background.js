const BACKEND_URL = 'https://tube-scout-production.up.railway.app';

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ totalAnalysisCount: 0, analysisCount: 0, reviewPromptCount: 0 });
  chrome.sidePanel.setOptions({ enabled: false });
});

chrome.action.onClicked.addListener(async (tab) => {
  const options = await chrome.sidePanel.getOptions({ tabId: tab.id });
  if (options.enabled) {
    chrome.sidePanel.setOptions({ tabId: tab.id, enabled: false });
  } else {
    await chrome.sidePanel.setOptions({ tabId: tab.id, enabled: true, path: 'popup.html' });
    chrome.sidePanel.open({ tabId: tab.id });
  }
});

chrome.tabs.onRemoved.addListener(tabId => {
  chrome.sidePanel.setOptions({ tabId, enabled: false }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg).then(sendResponse).catch(err => sendResponse({ error: err.message }));
  return true;
});

async function handleMessage(msg) {
  switch (msg.action) {
    case 'analyzeNiche':    return analyzeNiche(msg.query);
    case 'searchKeywords':  return searchKeywords(msg.query);
    case 'generateTitles':  return generateTitles(msg.query);
    case 'generateTags':    return generateTags(msg.query);
    case 'requestCode':     return requestCode(msg.email);
    case 'verifyCode':      return verifyCode(msg.email, msg.code);
    case 'getTrending':     return getTrending(msg.region, msg.category);
    case 'analyzeChannel':  return analyzeChannel(msg.input);
    case 'activateLicense': return activateLicense(msg.licenseKey);
    default: return { error: 'Unknown action' };
  }
}

async function apiFetch(path, options = {}) {
  const { accessToken } = await chrome.storage.local.get('accessToken');
  const headers = { 'Content-Type': 'application/json' };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  const res = await fetch(`${BACKEND_URL}${path}`, { headers, ...options });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

async function analyzeNiche(query) {
  return apiFetch('/api/analyze/niche', {
    method: 'POST',
    body: JSON.stringify({ query })
  });
}

async function getTrending(region = 'US', category = '0') {
  return apiFetch(`/api/trending?region=${region}&category=${category}`);
}

async function analyzeChannel(input) {
  return apiFetch('/api/analyze/channel', {
    method: 'POST',
    body: JSON.stringify({ input })
  });
}

async function searchKeywords(query) {
  return apiFetch('/api/keywords', {
    method: 'POST',
    body: JSON.stringify({ query })
  });
}

async function generateTitles(query) {
  return apiFetch('/api/titles', { method: 'POST', body: JSON.stringify({ query }) });
}

async function generateTags(query) {
  return apiFetch('/api/tags', { method: 'POST', body: JSON.stringify({ query }) });
}

async function requestCode(email) {
  try {
    return await apiFetch('/api/auth/request-code', { method: 'POST', body: JSON.stringify({ email }) });
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function verifyCode(email, code) {
  try {
    return await apiFetch('/api/auth/verify-code', { method: 'POST', body: JSON.stringify({ email, code }) });
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function activateLicense(licenseKey) {
  try {
    const data = await apiFetch('/api/license/validate', {
      method: 'POST',
      body: JSON.stringify({ licenseKey })
    });
    if (data.valid) {
      await chrome.storage.local.set({ isPro: true, licenseKey });
      return { success: true };
    }
    return { success: false, error: data.error || 'Licencia inválida' };
  } catch {
    return { success: false, error: 'Error de conexión con el servidor' };
  }
}
