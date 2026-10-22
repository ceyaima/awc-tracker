import { extractThreadId, parseMonthFromTitle, extractGenreFromTitle } from './helpers.js';

export async function fetchAniListCompleted(userName) {
  if (!userName) return [];
  const query = `
    query ($userName: String) {
      MediaListCollection(userName: $userName, type: ANIME, status: COMPLETED) {
        lists {
          entries {
            id
            startedAt { year month day }
            completedAt { year month day }
            media {
              id
              title { romaji english }
              genres
              season
              duration
              episodes
              startDate { year month day }
            }
          }
        }
      }
    }
  `;

  const response = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ query, variables: { userName } })
  });

  const json = await response.json();
  if (!json.data || !json.data.MediaListCollection) return [];

  const mediaMap = new Map();
  json.data.MediaListCollection.lists.forEach(list => {
    if (Array.isArray(list.entries)) {
      list.entries.forEach(entry => {
        if (entry?.media?.id) {
          const mediaId = entry.media.id;
          if (!mediaMap.has(mediaId)) {
            mediaMap.set(mediaId, entry);
          } else {
            const existing = mediaMap.get(mediaId);
            const existingHasStart = !!(existing.startedAt && existing.startedAt.year);
            const entryHasStart = !!(entry.startedAt && entry.startedAt.year);
            if (!existingHasStart && entryHasStart) {
              mediaMap.set(mediaId, entry);
            }
          }
        }
      });
    }
  });

  return Array.from(mediaMap.values());
}

export async function searchAniListMedia(searchTerm, mediaType = 'ANIME') {
  if (!searchTerm || searchTerm.length < 2) return [];
  const anilistType = String(mediaType || 'ANIME').toUpperCase() === 'MANGA' ? 'MANGA' : 'ANIME';
  const query = `
    query ($search: String, $type: MediaType) {
      Page(perPage: 6) {
        media(search: $search, type: $type) {
          id
          title { romaji english }
          coverImage { medium }
          format
          startDate { year }
        }
      }
    }
  `;

  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { search: searchTerm, type: anilistType } })
  });
  const data = await res.json();
  return data?.data?.Page?.media || [];
}

export async function searchAniListAnime(searchTerm) {
  return searchAniListMedia(searchTerm, 'ANIME');
}

export async function fetchAwcProfile(username) {
  if (!username) return null;

  // 1. First priority: Server-side proxy to completely bypass CORS and get exact SVG attributes
  try {
    const srvRes = await fetch(`/api/awc-profile/${encodeURIComponent(username)}`);
    if (srvRes.ok) {
      const srvData = await srvRes.json();
      if (srvData && (srvData.place || srvData.rank || srvData.points)) {
        return {
          place: srvData.place || null,
          rank: srvData.rank || null,
          points: srvData.points || null
        };
      }
    }
  } catch (e) {
    console.warn('Server AWC proxy unavailable, trying fallback:', e);
  }

  // 2. Direct or CORS proxy fallback
  const targetUrl = `https://awc.moe/challenger/${encodeURIComponent(username)}/card`;
  const proxies = [
    targetUrl,
    `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`
  ];

  let rawHtml = '';
  for (const url of proxies) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        rawHtml = await res.text();
        if (rawHtml && rawHtml.length > 50) break;
      }
    } catch (e) {}
  }

  if (!rawHtml) return null;

  // Check if SVG format
  const svgPlaceMatch = rawHtml.match(/class=["'][^"']*placement[^"']*["'][^>]*>\s*(#\d+)\s*<\/text>/i);
  const svgLabelMatch = rawHtml.match(/class=["'][^"']*label[^"']*["'][^>]*>\s*(\d+)\s*p\s*-\s*([A-Za-z0-9\s]+?)\s*<\/text>/i);
  if (svgPlaceMatch || svgLabelMatch) {
    return {
      place: svgPlaceMatch ? svgPlaceMatch[1] : null,
      rank: svgLabelMatch ? svgLabelMatch[2].trim() : null,
      points: svgLabelMatch ? `${svgLabelMatch[1]} points` : null
    };
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, 'text/html');
  const text = doc.body ? doc.body.innerText : rawHtml;

  const placeMatch = text.match(/Place\s*[:\.]*\s*(#\d+)/i);
  const rankMatch = text.match(/Rank\s*[:\.]*\s*([A-Za-z]+?)(?=(?:Points|Point|\d|\.|\s|$))/i) || text.match(/Rank\s*[:\.]*\s*([A-Za-z]+)/i);
  const pointsMatch = text.match(/Points\s*[:\.]*\s*(\d+)/i);

  // Guard against bogus matches like '#1' when Place was not actually found
  if (!placeMatch && !rankMatch && !pointsMatch) return null;

  return {
    place: placeMatch ? placeMatch[1] : null,
    rank: rankMatch ? rankMatch[1].replace(/points?$/i, '').trim() : null,
    points: pointsMatch ? `${pointsMatch[1]} points` : null
  };
}

export function parseAwcChallengerHtml(htmlString, challengesData = {}, badgesData = {}) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, 'text/html');

  const anchors = doc.querySelectorAll('a[href*="anilist.co/forum/thread/"]');
  const importedList = [];
  const threadOccurrence = {};

  anchors.forEach(a => {
    const link = a.getAttribute('href').trim();
    const rawId = String(extractThreadId(link) || '').trim();
    if (!rawId) return;

    // Track 1-based occurrence of this forum ID on the AWC profile
    threadOccurrence[rawId] = (threadOccurrence[rawId] || 0) + 1;
    const occurrence = threadOccurrence[rawId];

    const imgEl = a.querySelector('img');
    const customSrc = imgEl ? (imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || imgEl.src || '') : '';
    const challenge = challengesData[rawId] || {};
    const bList = badgesData[rawId] || [];

    let baseName = challenge.name || imgEl?.getAttribute('alt') || `Thread #${rawId}`;
    // Strip any pre-existing suffixes if present
    baseName = baseName.replace(/:\s*(Easy Mode|Normal Mode|Hard Mode|Easy|Normal|Hard|Mastery|Mode \d+|Tier \d+|#\d+).*$/i, '').trim();

    const cat = (challenge.category || '').toLowerCase();
    const isGacha = rawId === '67067' || cat === 'gacha' || baseName.toLowerCase().includes('gacha');
    const isMonthly = cat === 'monthly' || !!parseMonthFromTitle(baseName);
    const isGenre = cat === 'genre' || !!extractGenreFromTitle(baseName);

    // 1. Resolve Badge Image
    let finalImg = '';
    if (isGacha) {
      finalImg = customSrc || (bList[occurrence - 1] || bList[0] || '');
    } else {
      if (bList.length > 0) {
        finalImg = bList[occurrence - 1] || bList[bList.length - 1] || bList[0];
      } else {
        finalImg = customSrc;
      }
    }

    // 2. Resolve Challenge Title Suffix
    let suffix = '';

    if (isMonthly) {
      if (occurrence === 1) suffix = ': Easy Mode';
      else if (occurrence === 2) suffix = ': Hard Mode';
      else suffix = `: Mode ${occurrence}`;
    } else if (isGenre) {
      // 1st: Easy Mode, 2nd: Normal Mode, 3rd: Hard Mode, 4th: Mastery
      const genreModes = [': Easy Mode', ': Normal Mode', ': Hard Mode', ': Mastery'];
      suffix = genreModes[occurrence - 1] || `: Tier ${occurrence}`;
    } else if (isGacha) {
      suffix = `: #${occurrence}`;
    } else if (occurrence > 1) {
      suffix = `: #${occurrence}`;
    }

    const finalTitle = suffix ? `${baseName}${suffix}` : baseName;

    importedList.push({
      id: 'display-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
      threadId: rawId,
      commentLink: link,
      title: finalTitle,
      imgSrc: finalImg,
      category: challenge.category || (isGenre ? 'Genre' : (isMonthly ? 'Monthly' : 'Other')),
      mediaType: challenge.mediaType || challenge.media || 'anime'
    });
  });

  const text = doc.body ? doc.body.innerText : htmlString;
  const placeMatch = text.match(/Place\s*[:\.]*\s*(#\d+)/i) || text.match(/(#\d{1,5})/);
  const rankMatch = text.match(/Rank\s*[:\.]*\s*([A-Za-z]+?)(?=(?:Points|Point|\d|\.|\s|$))/i) || text.match(/Rank\s*[:\.]*\s*([A-Za-z]+)/i);
  const pointsMatch = text.match(/Points\s*[:\.]*\s*(\d+)/i);

  const profile = {
    place: placeMatch ? placeMatch[1] : null,
    rank: rankMatch ? rankMatch[1].replace(/points?$/i, '').trim() : null,
    points: pointsMatch ? `${pointsMatch[1]} points` : null
  };

  return { importedList, profile };
}

// ==========================================
// ==========================================
// MONGODB API ENDPOINTS
// ==========================================

export async function fetchDbInitData() {
  const res = await fetch('/api/init-data');
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Failed to fetch data from MongoDB (HTTP ${res.status})`);
  }
  const data = await res.json();
  return data;
}

export async function fetchDbChallenges() {
  const res = await fetch('/api/challenges');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

export async function fetchDbBadges() {
  const res = await fetch('/api/badges');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}