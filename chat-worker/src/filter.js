export function tokenize(text) {
  return text
    .toLowerCase()
    .split(/[\s,،.。،؟?!،;:]+/)
    .filter(t => t.length > 1);
}

export function filterVideos(question, videos, limit = 25) {
  const tokens = tokenize(question);
  if (tokens.length === 0) return videos.slice(0, limit);

  const scored = videos.map(video => ({
    video,
    score: computeScore(tokens, video)
  }));

  const matched = scored
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ video }) => video);

  if (matched.length < limit) {
    const matchedIds = new Set(matched.map(v => v.id));
    const unmatched = videos
      .filter(v => !matchedIds.has(v.id))
      .slice(0, limit - matched.length);
    return [...matched, ...unmatched];
  }
  return matched;
}

function computeScore(tokens, video) {
  const topicText = (video.primary_topic || '').toLowerCase();
  const titleText = (video.title_original || '').toLowerCase();
  const tagsText = (video.tags || []).join(' ').toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (topicText.includes(token)) score += 3;
    if (titleText.includes(token)) score += 2;
    if (tagsText.includes(token)) score += 1;
  }
  return score;
}
