export const WORKER_URL = 'https://tayyibat-chat.houcemben.workers.dev/api/chat';

const I18N = {
  fr: {
    placeholder: 'Posez votre question de santé...',
    send: 'Envoyer',
    welcome: 'Bonjour ! Je suis l\'assistant du Système Tayyibat. Posez-moi une question sur votre santé.',
    source: 'Voir la vidéo',
    disclaimer: '⚠ Ces informations sont éducatives et ne remplacent pas un avis médical.',
    error_rate: 'Trop de questions. Réessayez dans une minute.',
    error_model: 'Erreur du modèle. Réessayez.',
    error_generic: 'Une erreur est survenue.',
    thinking: 'En cours...',
    usage: 'Questions utilisées'
  },
  en: {
    placeholder: 'Ask your health question...',
    send: 'Send',
    welcome: 'Hello! I am the Tayyibat System assistant. Ask me a health question.',
    source: 'Watch video',
    disclaimer: '⚠ This information is educational and does not replace medical advice.',
    error_rate: 'Too many requests. Try again in a minute.',
    error_model: 'Model error. Please try again.',
    error_generic: 'An error occurred.',
    thinking: 'Thinking...',
    usage: 'Questions used'
  },
  ar: {
    placeholder: 'اكتب سؤالك الصحي...',
    send: 'إرسال',
    welcome: 'مرحباً! أنا مساعد نظام الطيبات. اسألني عن صحتك.',
    source: 'شاهد الفيديو',
    disclaimer: '⚠ هذه المعلومات تعليمية ولا تغني عن استشارة طبيب متخصص.',
    error_rate: 'طلبات كثيرة جداً. حاول مرة أخرى بعد دقيقة.',
    error_model: 'خطأ في النموذج. حاول مرة أخرى.',
    error_generic: 'حدث خطأ ما.',
    thinking: 'جاري التفكير...',
    usage: 'الأسئلة المستعملة'
  }
};

export function getLang() {
  return localStorage.getItem('lang') || 'fr';
}

export function t(key) {
  const lang = getLang();
  return (I18N[lang] || I18N.fr)[key] || key;
}

export async function fetchChat(question, lang) {
  const res = await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, lang })
  });
  return res.json();
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c])
  );
}

export function createMessageEl(role, content) {
  const div = document.createElement('div');
  div.className = `chat-msg chat-msg--${role}`;
  div.innerHTML = content;
  return div;
}

export function createVideoCard(video) {
  const card = document.createElement('a');
  card.className = 'chat-video-card';
  card.href = video.url;
  card.target = '_blank';
  card.rel = 'noopener';
  card.innerHTML = `
    <span class="chat-video-title" dir="rtl">${escapeHtml(video.title)}</span>
    <span class="chat-video-meta">${escapeHtml(video.duration)} · ${t('source')}</span>
  `;
  return card;
}

function renderUsage(usage) {
  if (!usage || !usage.limit) return '';
  const used = Number(usage.used || 0);
  const limit = Number(usage.limit || 0);
  return `<p class="chat-disclaimer">${t('usage')}: ${used}/${limit}</p>`;
}

export async function sendQuestion(question, messagesEl) {
  const lang = getLang();
  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  messagesEl.appendChild(createMessageEl('user', `<span dir="${dir}">${escapeHtml(question)}</span>`));

  const thinking = createMessageEl('bot', `<em>${t('thinking')}</em>`);
  messagesEl.appendChild(thinking);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  let data;
  try {
    data = await fetchChat(question, lang);
  } catch {
    thinking.innerHTML = `<span class="chat-error">${t('error_generic')}</span>`;
    return;
  }

  if (data.error === 'rate_limit') {
    thinking.innerHTML = `<span class="chat-error">${t('error_rate')}</span>`;
    return;
  }
  if (data.error) {
    thinking.innerHTML = `<span class="chat-error">${t('error_model')}</span>`;
    return;
  }

  thinking.innerHTML = `<span dir="${dir}">${escapeHtml(data.answer)}</span>
    ${renderUsage(data.usage)}
    <p class="chat-disclaimer">${t('disclaimer')}</p>`;

  if (data.videos && data.videos.length > 0) {
    const cardsRow = document.createElement('div');
    cardsRow.className = 'chat-video-row';
    data.videos.forEach(v => cardsRow.appendChild(createVideoCard(v)));
    messagesEl.appendChild(cardsRow);
  }

  messagesEl.scrollTop = messagesEl.scrollHeight;
}
