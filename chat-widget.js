import { fetchChatV2, escapeHtml, t, getLang } from './chat-core.js';

const WIDGET_CSS = `
  .cw-btn { position: fixed; bottom: 24px; right: 24px; width: 52px; height: 52px;
             border-radius: 50%; background: #1A1A18; border: 2px solid #C9A84C;
             cursor: pointer; display: flex; align-items: center; justify-content: center;
             z-index: 9999; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
  [dir="rtl"] .cw-btn { right: auto; left: 24px; }
  .cw-btn svg { width: 24px; height: 24px; fill: #E6D18A; }
  .cw-overlay { position: fixed; bottom: 88px; right: 24px;
                width: min(360px, calc(100vw - 16px));
                max-height: 560px;
                background: #F5F0E8; border: 1px solid rgba(26,26,24,0.12);
                box-shadow: 0 8px 32px rgba(0,0,0,0.2); display: none;
                flex-direction: column; z-index: 9998; }
  [dir="rtl"] .cw-overlay { right: auto; left: 24px; }
  .cw-overlay.open { display: flex; }
  .cw-header { background: #1A1A18; color: #E6D18A; padding: 12px 16px;
               font-size: 0.9rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
  .cw-messages { flex: 1; overflow-y: auto; padding: 12px; display: flex;
                 flex-direction: column; gap: 10px; }
  .cw-msg { padding: 10px 12px; font-size: 0.9rem; line-height: 1.55;
            max-width: 95%; }
  .cw-msg--user { align-self: flex-end; background: #1A1A18; color: #F5F0E8; }
  .cw-msg--bot  { align-self: flex-start; background: #FFFCF4;
                  border: 1px solid rgba(26,26,24,0.12); }
  .cw-disclaimer { font-size: 0.73rem; color: #706D61; margin: 8px 0 0; direction: rtl; }
  .cw-error { color: #9B2335; }
  .cw-form { display: flex; border-top: 1px solid rgba(26,26,24,0.12); }
  .cw-input { flex: 1; border: none; background: #FFFCF4; padding: 10px 12px;
              font: inherit; font-size: 0.9rem; outline: none; color: #24231F; }
  .cw-send { background: #1A1A18; color: #E6D18A; border: none; padding: 10px 14px;
             cursor: pointer; font: inherit; font-size: 0.8rem; font-weight: 700;
             letter-spacing: 0.1em; text-transform: uppercase; }

  /* ── V2 Phase 3 ─────────────────────────────────────────────────────── */
  .cw-v2-label {
    display: block; font-family: Cairo, sans-serif; font-size: 0.73rem;
    color: #706D61; direction: rtl; text-align: right;
    padding-bottom: 6px; margin-bottom: 8px;
    border-bottom: 1px solid rgba(201,168,76,0.25);
  }
  /* Summary — texte lisible en évidence */
  .cw-v2-summary {
    direction: rtl; text-align: right; margin: 0 0 10px;
    font-family: Cairo, sans-serif; font-size: 0.92rem; line-height: 1.75;
    color: #24231F; font-weight: 600;
  }
  /* Fallback quand pas de summary : blockquote discret */
  .cw-v2-quote {
    direction: rtl; text-align: right; margin: 0 0 10px; padding: 8px 10px 8px 8px;
    font-family: Cairo, sans-serif; font-size: 0.85rem; line-height: 1.7;
    background: rgba(201,168,76,0.07); border-right: 3px solid #C9A84C; color: #24231F;
  }
  /* Bouton YouTube principal */
  .cw-v2-yt {
    display: flex; align-items: center; gap: 8px;
    background: #1A1A18; color: #E6D18A; text-decoration: none;
    padding: 8px 10px; margin-bottom: 8px;
  }
  .cw-v2-yt:hover { background: #2c2c28; }
  .cw-v2-yt-icon { width: 15px; height: 15px; fill: #E6D18A; flex-shrink: 0; }
  .cw-v2-yt-info { flex: 1; min-width: 0; direction: rtl; text-align: right; }
  .cw-v2-yt-title { display: block; font-family: Cairo, sans-serif; font-weight: 700;
    font-size: 0.78rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cw-v2-yt-ts { display: block; font-size: 0.7rem; opacity: 0.7; margin-top: 1px; }
  .cw-v2-yt-cta { font-size: 0.73rem; letter-spacing: 0.07em; flex-shrink: 0; white-space: nowrap; }
  /* Transcript replié */
  .cw-v2-transcript { margin-bottom: 6px; }
  .cw-v2-transcript summary {
    font-size: 0.74rem; color: #706D61; cursor: pointer; padding: 3px 0;
    list-style: none; direction: rtl; user-select: none;
  }
  .cw-v2-transcript summary::-webkit-details-marker { display: none; }
  .cw-v2-raw {
    direction: rtl; text-align: right; margin: 6px 0 0; padding: 8px 10px;
    font-family: Cairo, sans-serif; font-size: 0.8rem; line-height: 1.65;
    background: rgba(201,168,76,0.06); border-right: 2px solid rgba(201,168,76,0.4);
    color: #4a4840; font-style: italic;
  }
  /* Sources secondaires */
  .cw-v2-more { margin-bottom: 4px; }
  .cw-v2-more summary {
    font-size: 0.73rem; color: #706D61; cursor: pointer; padding: 3px 0;
    list-style: none; direction: rtl; user-select: none;
  }
  .cw-v2-more summary::-webkit-details-marker { display: none; }
  .cw-v2-more-item {
    display: flex; align-items: center; gap: 6px; padding: 5px 2px;
    border-bottom: 1px solid rgba(26,26,24,0.07);
    text-decoration: none; color: #24231F; direction: rtl;
  }
  .cw-v2-more-item:last-child { border-bottom: none; }
  .cw-v2-more-title { font-family: Cairo, sans-serif; font-size: 0.75rem; font-weight: 600;
    flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cw-v2-more-ts { font-size: 0.7rem; color: #706D61; flex-shrink: 0; }
`;

const YT_ICON = `<svg class="cw-v2-yt-icon" viewBox="0 0 24 24" aria-hidden="true">
  <path d="M23.5 6.2a3 3 0 00-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.5A3 3 0 00.5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 002.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 002.1-2.1C24 15.9 24 12 24 12s0-3.9-.5-5.8zM9.8 15.5V8.5l6.3 3.5-6.3 3.5z"/>
</svg>`;

function injectCSS(css) {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}

function renderV2Msg(data) {
  const el = document.createElement('div');
  el.className = 'cw-msg cw-msg--bot';

  const disclaimer = `<p class="cw-disclaimer">⚠ هذه المعلومات تعليمية ولا تغني عن استشارة طبيب متخصص.</p>`;

  if (!data || data.mode === 'v2_rate_limited') {
    el.innerHTML = `<p dir="rtl" style="font-family:Cairo,sans-serif;margin:0 0 4px">${escapeHtml(data?.answer || 'يرجى التمهل قليلاً.')}</p>${disclaimer}`;
    return el;
  }
  // Phase Finale: handle both legacy v2_no_result and new v3_no_result.
  if (data.mode === 'v2_no_result' || data.mode === 'v3_no_result') {
    el.innerHTML = `<p dir="rtl" style="font-family:Cairo,sans-serif;margin:0 0 4px">${escapeHtml(data.answer || 'لم أجد مقطعاً واضحاً من كلام الدكتور ضياء حول هذا السؤال.')}</p>${disclaimer}`;
    return el;
  }

  const sources  = data.sources || [];
  const main     = sources[0] || {};
  const rest     = sources.slice(1);
  const quote    = escapeHtml((main.quote || '').slice(0, 300));
  const title    = escapeHtml((main.title || main.id || '').slice(0, 42));
  const ts       = escapeHtml(main.timestamp || '');
  const url      = escapeHtml(main.url || '#');

  // Phase Finale db_resume 3-couches : object {verdict, simple, explanation?}.
  const dbResume   = (data.db_resume && typeof data.db_resume === 'object') ? data.db_resume : null;
  const dbSimple   = dbResume?.simple || '';
  const dbExplain  = dbResume?.explanation || '';

  // Composed-dish prefix (worker preprends it to data.answer when the principal
  // canonical of the question is missing from the best block).
  const answerFirstLine = (data.answer || '').split('\n')[0] || '';
  const composedPrefix  = answerFirstLine.startsWith('لم أجد كلاماً مباشراً') ? answerFirstLine : '';

  // Layer 1: prefer db_resume.simple > raw quote
  let mainContent;
  if (dbSimple) {
    const prefixHtml = composedPrefix
      ? `<p class="cw-v2-prefix" dir="rtl" style="font-style:italic;color:#666;font-size:0.92em;margin:0 0 8px">${escapeHtml(composedPrefix)}</p>`
      : '';
    mainContent = `${prefixHtml}<p class="cw-v2-summary">${escapeHtml(dbSimple)}</p>`;
  } else if (quote) {
    mainContent = `<blockquote class="cw-v2-quote">"${quote}…"</blockquote>`;
  } else {
    mainContent = `<p class="cw-v2-summary">${escapeHtml(data.answer || '')}</p>`;
  }

  // Layer 2 (optional): pedagogic explanation, collapsible
  const explanationHtml = dbExplain
    ? `<details class="cw-v2-transcript">
        <summary>▾ شرح أكثر</summary>
        <p class="cw-v2-raw">${escapeHtml(dbExplain)}</p>
      </details>`
    : '';

  // Layer 3: raw Dr quote, always collapsible if available
  const transcriptHtml = quote
    ? `<details class="cw-v2-transcript">
        <summary>${dbSimple ? '🗣 كلام الدكتور الأصلي' : '▾ عرض المقطع كاملاً'}</summary>
        <p class="cw-v2-raw">"${quote}…"</p>
      </details>`
    : '';

  // Sources secondaires repliées
  const moreHtml = rest.length > 0
    ? `<details class="cw-v2-more">
        <summary>▾ مصادر أخرى (${rest.length})</summary>
        ${rest.map(s => `
          <a class="cw-v2-more-item" href="${escapeHtml(s.url || '#')}" target="_blank" rel="noopener">
            <span class="cw-v2-more-title">${escapeHtml((s.title || '').slice(0, 38))}</span>
            <span class="cw-v2-more-ts">⏱ ${escapeHtml(s.timestamp || '')}</span>
          </a>`).join('')}
      </details>`
    : '';

  el.innerHTML = `
    ${mainContent}
    <a class="cw-v2-yt" href="${url}" target="_blank" rel="noopener">
      ${YT_ICON}
      <span class="cw-v2-yt-info">
        <span class="cw-v2-yt-title">${title}</span>
        <span class="cw-v2-yt-ts">⏱ ${ts}</span>
      </span>
      <span class="cw-v2-yt-cta">شاهد كلام الدكتور ▶</span>
    </a>
    ${explanationHtml}
    ${transcriptHtml}
    ${moreHtml}
    ${disclaimer}`;

  return el;
}

function buildWidget() {
  injectCSS(WIDGET_CSS);

  const btn = document.createElement('button');
  btn.className = 'cw-btn';
  btn.setAttribute('aria-label', 'Chat Dr Diaa');
  btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M20 2H4a2 2 0 00-2 2v12a2 2 0 002 2h14l4 4V4a2 2 0 00-2-2z"/></svg>`;

  const overlay = document.createElement('div');
  overlay.className = 'cw-overlay';
  overlay.innerHTML = `
    <div class="cw-header">Dr Dhiaa Al Awadhy</div>
    <div class="cw-messages" id="cw-msgs"></div>
    <form class="cw-form" id="cw-form">
      <input class="cw-input" id="cw-input" type="text" placeholder="${t('placeholder')}" autocomplete="off">
      <button class="cw-send" type="submit">${t('send')}</button>
    </form>
  `;

  document.body.appendChild(btn);
  document.body.appendChild(overlay);

  const msgs = overlay.querySelector('#cw-msgs');
  const welcome = document.createElement('div');
  welcome.className = 'cw-msg cw-msg--bot';
  welcome.setAttribute('dir', 'rtl');
  welcome.style.fontFamily = 'Cairo, sans-serif';
  welcome.textContent = t('welcome');
  msgs.appendChild(welcome);

  btn.addEventListener('click', () => overlay.classList.toggle('open'));

  overlay.querySelector('#cw-form').addEventListener('submit', async e => {
    e.preventDefault();
    const input = overlay.querySelector('#cw-input');
    const question = input.value.trim();
    if (!question) return;
    input.value = '';
    input.disabled = true;

    const userMsg = document.createElement('div');
    userMsg.className = 'cw-msg cw-msg--user';
    userMsg.innerHTML = `<span dir="rtl">${escapeHtml(question)}</span>`;
    msgs.appendChild(userMsg);

    const thinking = document.createElement('div');
    thinking.className = 'cw-msg cw-msg--bot';
    thinking.innerHTML = `<em>${t('thinking')}</em>`;
    msgs.appendChild(thinking);
    msgs.scrollTop = msgs.scrollHeight;

    let data;
    try {
      data = await fetchChatV2(question);
    } catch {
      thinking.innerHTML = `<span class="cw-error">${t('error_generic')}</span>`;
      input.disabled = false;
      return;
    }

    thinking.replaceWith(renderV2Msg(data));
    msgs.scrollTop = msgs.scrollHeight;
    input.disabled = false;
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', buildWidget);
} else {
  buildWidget();
}
