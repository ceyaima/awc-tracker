export const ANILIST_GENRES = [
  'Action', 'Adventure', 'Comedy', 'Drama', 'Ecchi', 'Fantasy', 'Horror',
  'Mahou Shoujo', 'Mecha', 'Music', 'Mystery', 'Psychological', 'Romance',
  'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller'
];

export const MONTH_MAP = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9,
  sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12
};

export function extractThreadId(url) {
  if (!url) return null;
  const match = url.match(/\/thread\/(\d+)(?:\/comment\/\d+)?/i);
  return match ? match[1] : null;
}

export function parseDateYYYYMMDD(str) {
  if (!str || typeof str !== 'string') return null;
  const match = str.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const y = parseInt(match[1], 10);
  const m = parseInt(match[2], 10) - 1;
  const d = parseInt(match[3], 10);
  const parsed = new Date(y, m, d);
  return isNaN(parsed.getTime()) ? null : parsed;
}

export function isZeroDate(str) {
  if (!str || typeof str !== 'string') return false;
  const clean = str.trim();
  return clean === '0000-00-00' || clean === '00-00-0000' || clean.replace(/[-/]/g, '') === '00000000';
}

export function getMonthSeason(month) {
  if (month >= 1 && month <= 3) return 'WINTER';
  if (month >= 4 && month <= 6) return 'SPRING';
  if (month >= 7 && month <= 9) return 'SUMMER';
  if (month >= 10 && month <= 12) return 'FALL';
  return null;
}

export function parseSeasonFromTitle(title) {
  if (!title) return null;
  const match = title.match(/\b(Winter|Spring|Summer|Fall)\s+(\d{4})\b/i);
  if (!match) return null;
  return {
    season: match[1].toUpperCase(),
    year: parseInt(match[2], 10)
  };
}

export function parseMonthFromTitle(title) {
  if (!title) return null;
  const regex1 = /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(\d{4})\b/i;
  const match1 = title.match(regex1);
  if (match1) {
    return {
      month: MONTH_MAP[match1[1].toLowerCase()],
      year: parseInt(match1[2], 10)
    };
  }
  const regex2 = /\b(\d{4})\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b/i;
  const match2 = title.match(regex2);
  if (match2) {
    return {
      month: MONTH_MAP[match2[2].toLowerCase()],
      year: parseInt(match2[1], 10)
    };
  }
  return null;
}

export function extractGenreFromTitle(title) {
  if (!title) return null;
  const lower = title.toLowerCase();
  return ANILIST_GENRES.find(g => lower.includes(g.toLowerCase())) || null;
}

export function extractYearFromTitle(title) {
  if (!title) return null;
  const match = title.match(/\b(19\d{2}|20\d{2})\b/);
  return match ? parseInt(match[1], 10) : null;
}

export function getAniListUrl(item) {
  if (!item) return '#';
  if (item.anilistId) return `https://anilist.co/anime/${item.anilistId}`;
  const title = item.animeTitle || '';
  return `https://anilist.co/search/anime?search=${encodeURIComponent(title)}`;
}