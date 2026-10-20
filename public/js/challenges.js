import {
  parseSeasonFromTitle,
  parseMonthFromTitle,
  getMonthSeason,
  extractGenreFromTitle,
  extractYearFromTitle,
  parseDateYYYYMMDD,
  isZeroDate
} from './helpers.js';

export function getCardCategory(card, challengesData = {}) {
  return card?.category || challengesData[card?.threadId]?.category || 'Other';
}

export function getCardMediaType(card, challengesData = {}) {
  return card?.mediaType || card?.media || challengesData[card?.threadId]?.mediaType || challengesData[card?.threadId]?.media || 'anime';
}

export function getBadgeMediaType(badge, challengesData = {}) {
  return badge?.mediaType || badge?.media || challengesData[badge?.threadId]?.mediaType || challengesData[badge?.threadId]?.media || 'anime';
}

export function isSeasonalCard(card, challengesData) {
  return getCardCategory(card, challengesData).toLowerCase() === 'seasonal' || !!parseSeasonFromTitle(card?.title);
}

export function isMonthlyCard(card, challengesData) {
  return getCardCategory(card, challengesData).toLowerCase() === 'monthly' || !!parseMonthFromTitle(card?.title);
}

export function isHighPriorityCard(card, challengesData = {}) {
  if (!card) return false;
  const tid = String(card.threadId || card.challengeId || '').trim();
  if (tid === '67067' || tid === '69234') return true;

  const cat = getCardCategory(card, challengesData).toLowerCase();
  if (cat === 'monthly' || cat === 'seasonal' || cat === 'gacha') return true;
  if (isSeasonalCard(card, challengesData) || isMonthlyCard(card, challengesData)) return true;

  const title = (card.title || card.name || '').toLowerCase();
  if (title.includes('gacha')) return true;

  return false;
}

export const isTimeLimitedCard = isHighPriorityCard;

export function isGenreCard(card, challengesData) {
  return getCardCategory(card, challengesData).toLowerCase() === 'genre';
}

export function isClassicCard(card, challengesData) {
  return getCardCategory(card, challengesData).toLowerCase() === 'classic';
}

export function isCardEditable(card, challengesData) {
  return card?.challengeType === 'upgrade' || isGenreCard(card, challengesData) || isClassicCard(card, challengesData) || isTimeLimitedCard(card, challengesData);
}

export function shouldShowCountPill(card, challengesData) {
  return isClassicCard(card, challengesData) || 
         isSeasonalCard(card, challengesData) || 
         isMonthlyCard(card, challengesData) || 
         (isGenreCard(card, challengesData) && card.cutOffDate);
}

export function calculateAniListStat(card, userAnimeList, challengesData) {
  if (!userAnimeList || userAnimeList.length === 0) {
    return { total: 0, winter: 0, spring: 0, summer: 0, fall: 0 };
  }

  // 1. Seasonal
  if (isSeasonalCard(card, challengesData)) {
    const seasonInfo = parseSeasonFromTitle(card.title);
    if (!seasonInfo) return { total: 0, winter: 0, spring: 0, summer: 0, fall: 0 };

    const count = userAnimeList.filter(entry => {
      if (entry.media?.startDate?.year !== seasonInfo.year) return false;
      const animeSeason = (entry.media.season || '').toUpperCase();
      const derivedSeason = getMonthSeason(entry.media.startDate.month);
      return animeSeason === seasonInfo.season || derivedSeason === seasonInfo.season;
    }).length;

    return { total: count, winter: 0, spring: 0, summer: 0, fall: 0 };
  }

  // 2. Monthly
  if (isMonthlyCard(card, challengesData)) {
    const monthInfo = parseMonthFromTitle(card.title);
    if (!monthInfo) return { total: 0, winter: 0, spring: 0, summer: 0, fall: 0 };

    const count = userAnimeList.filter(entry => {
      if (!entry.startedAt?.year || !entry.completedAt?.year) return false;
      return entry.startedAt.year === monthInfo.year && entry.startedAt.month === monthInfo.month &&
             entry.completedAt.year === monthInfo.year && entry.completedAt.month === monthInfo.month;
    }).length;

    return { total: count, winter: 0, spring: 0, summer: 0, fall: 0 };
  }

  // 3. Genre
  if (isGenreCard(card, challengesData)) {
    if (!card.cutOffDate) return { total: 0, winter: 0, spring: 0, summer: 0, fall: 0 };
    const zeroDate = isZeroDate(card.cutOffDate);
    const cutOff = zeroDate ? null : parseDateYYYYMMDD(card.cutOffDate);
    if (!zeroDate && !cutOff) return { total: 0, winter: 0, spring: 0, summer: 0, fall: 0 };

    const targetGenre = extractGenreFromTitle(card.title);
    if (!targetGenre) return { total: 0, winter: 0, spring: 0, summer: 0, fall: 0 };

    const count = userAnimeList.filter(entry => {
      if (!zeroDate) {
        if (!entry.startedAt?.year) return false;
        const entryStart = new Date(
          entry.startedAt.year,
          (entry.startedAt.month || 1) - 1,
          entry.startedAt.day || 1
        );
        if (entryStart <= cutOff) return false;
      }

      const hasGenre = Array.isArray(entry.media?.genres) && 
        entry.media.genres.some(g => g.toLowerCase() === targetGenre.toLowerCase());
      if (!hasGenre) return false;

      const duration = entry.media?.duration || 0;
      const episodes = entry.media?.episodes || 1;
      return (duration * episodes) > 30;
    }).length;

    return { total: count, winter: 0, spring: 0, summer: 0, fall: 0 };
  }

  // 4. Classic
  if (isClassicCard(card, challengesData)) {
    const targetYear = extractYearFromTitle(card.title);
    if (!targetYear) return { total: 0, winter: 0, spring: 0, summer: 0, fall: 0 };

    let total = 0, winter = 0, spring = 0, summer = 0, fall = 0;
    userAnimeList.forEach(entry => {
      if (entry.media?.startDate?.year === targetYear) {
        total++;
        const s = (entry.media.season || '').toUpperCase();
        if (s === 'WINTER') winter++;
        else if (s === 'SPRING') spring++;
        else if (s === 'SUMMER') summer++;
        else if (s === 'FALL') fall++;
        else {
          const m = entry.media?.startDate?.month;
          if (m >= 1 && m <= 3) winter++;
          else if (m >= 4 && m <= 6) spring++;
          else if (m >= 7 && m <= 9) summer++;
          else if (m >= 10 && m <= 12) fall++;
        }
      }
    });
    return { total, winter, spring, summer, fall };
  }

  return { total: 0, winter: 0, spring: 0, summer: 0, fall: 0 };
}