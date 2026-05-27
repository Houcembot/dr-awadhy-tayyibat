import { fetchChat, t, getLang } from './chat-core.js';

const WIDGET_CSS = `
  .cw-btn { position: fixed; bottom: 24px; right: 24px; width: 52px; height: 52px;
             border-radius: 50%; background: #1A1A18; border: 2px solid #C9A84C;
             cursor: pointer; display: flex; align-items: center; justify-content: center;
             z-index: 9999; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
  [dir="rtl"] .cw-btn { right: auto; left: 24px; }
  .cw-btn svg { width: 24px; height: 24px; fill: #E6D18A; }
  .cw-overlay { position: fixed; bottom: 88px; right: 24px; width: 360px; max-height: 520px;
                background: #F5F0E8; border: 1px solid rgba(26,26,24,0.12);
                box-shadow: 0 8px 32px rgba(0,0,0,0.2); display: none;
                flex-direction: column; z-index: 9998; }
  [dir="rtl"] .cw-overlay { right: auto; left: 24px; }
  .cw-overlay.open { display: flex; }
  .cw-header { background: #1A1A18; color: #E6D18A; padding: 12px 16px;
               font-size: 0.9rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
  .cw-messages { flex: 1; overflow-y: auto; padding: 12px; display: flex;
                 flex-direction: column; gap: 10px; }
  .cw-msg { padding: 10px 12px; font-size: 0.9rem; line-height: 1.55; max-width: 90%; }
  .cw-msg--user { align-self: flex-end; background: #1A1A18; color: #F5F0E8; }
  .cw-msg--bot { align-self: flex-start; background: #FFFCF4;
                 border: 1px solid rgba(26,26,24,0.12); }
  .cw-disclaimer { font-size: 0.75rem; color: #706D61; margin: 6px 0 0; }
  .cw-error { color: #9B2335; }
  .cw-video-card { display: block; background: #FFFCF4; border: 1px solid rgba(26,26,24,0.12);
                   padding: 7px 10px; text-decoration: none; color: #24231F; margin-top: 4px; }
  .cw-video-card:hover { border-color: #C9A84C; }
  .cw-video-title { display: block; font-family: Cairo, sans-serif; font-weight: 700;
                    font-size: 0.82rem; line-height: 1.4; direction: rtl; }
  .cw-video-meta { display: block; font-size: 0.72rem; color: #706D61; margin-top: 2px; }
  .cw-form { display: flex; border-top: 1px solid rgba(26,26,24,0.12); }
  .cw-input { flex: 1; border: none; background: #FFFCF4; padding: 10px 12px;
              font: inherit; font-size: 0.9rem; outline: none; color: #24231F; }
  .cw-send { background: #1A1A18; color: #E6D18A; border: none; padding: 10px 14px;
             cursor: pointer; font: inherit; font-size: 0.8rem; font-weight: 700;
             letter-spacing: 0.1em; text-transform: uppercase; }
`;

function injectCSS(css) {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c])
  );
}

function buildWidget() {
  injectCSS(WIDGET_CSS);

  const btn = document.createElement('button');
  btn.className = 'cw-btn';
  btn.setAttribute('aria-label', 'Chat');
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
  welcome.textContent = t('welcome');
  msgs.appendChild(welcome);

  btn.addEventListener('click', () => overlay.classList.toggle('open'));

  overlay.querySelector('#cw-form').addEventListener('submit', async e => {
    e.preventDefault();
    const input = overlay.querySelector('#cw-input');
    const question = input.value.trim();
    if (!question) return;
    input.value = '';

    const lang = getLang();
    const dir = lang === 'ar' ? 'rtl' : 'ltr';

    const userMsg = document.createElement('div');
    userMsg.className = 'cw-msg cw-msg--user';
    userMsg.innerHTML = `<span dir="${dir}">${escapeHtml(question)}</span>`;
    msgs.appendChild(userMsg);

    const botMsg = document.createElement('div');
    botMsg.className = 'cw-msg cw-msg--bot';
    botMsg.innerHTML = `<em>${t('thinking')}</em>`;
    msgs.appendChild(botMsg);
    msgs.scrollTop = msgs.scrollHeight;

    let data;
    try {
      data = await fetchChat(question, lang);
    } catch {
      botMsg.innerHTML = `<span class="cw-error">${t('error_generic')}</span>`;
      return;
    }

    if (data.error === 'rate_limit') {
      botMsg.innerHTML = `<span class="cw-error">${t('error_rate')}</span>`;
      return;
    }
    if (data.error) {
      botMsg.innerHTML = `<span class="cw-error">${t('error_model')}</span>`;
      return;
    }

    botMsg.innerHTML = `<span dir="${dir}">${escapeHtml(data.answer)}</span>
      <p class="cw-disclaimer">${t('disclaimer')}</p>`;

    (data.videos || []).forEach(v => {
      const card = document.createElement('a');
      card.className = 'cw-video-card';
      card.href = v.url;
      card.target = '_blank';
      card.rel = 'noopener';
      card.innerHTML = `<span class="cw-video-title">${escapeHtml(v.title)}</span>
        <span class="cw-video-meta">${escapeHtml(v.duration)} · ${t('source')}</span>`;
      msgs.appendChild(card);
    });

    msgs.scrollTop = msgs.scrollHeight;
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', buildWidget);
} else {
  buildWidget();
}
