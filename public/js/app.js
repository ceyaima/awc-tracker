import { writeDataToFile, readDataFromFile, exportJsonFile } from './storage.js';
import { extractThreadId, getAniListUrl } from './helpers.js';
import {
  fetchAniListCompleted,
  searchAniListAnime,
  fetchAwcProfile,
  parseAwcChallengerHtml,
  fetchDbInitData
} from './api.js';
import {
  getCardCategory,
  getCardMediaType,
  getBadgeMediaType,
  isSeasonalCard,
  isMonthlyCard,
  isTimeLimitedCard,
  isGenreCard,
  isClassicCard,
  isCardEditable,
  shouldShowCountPill,
  calculateAniListStat
} from './challenges.js';

const { createApp, ref, computed, onMounted, onBeforeUnmount } = Vue;

createApp({
  setup() {
    const isDbLoading = ref(true);
    const dbError = ref(null);
    const challengesData = ref({});
    const badgesData = ref({});

    // User Accounts State
    const allUsersData = ref({});
    const currentUser = ref('');
    const showAuthModal = ref(false);
    const authForm = ref({ username: '', password: '' });
    const authError = ref('');

    const activeTab = ref('display');
    const searchQuery = ref('');

    // Master Filter Popover
    const showMasterFilterMenu = ref(false);
    const selectedMediaTypeFilter = ref('all');
    const selectedCategoryFilter = ref('all');
    const selectedStatusFilter = ref('all');

    const isAnyFilterActive = computed(() => {
      return selectedMediaTypeFilter.value !== 'all' || 
             selectedCategoryFilter.value !== 'all' || 
             selectedStatusFilter.value !== 'all';
    });

    const toggleMasterFilterMenu = () => {
      contextMenu.value.visible = false;
      linkContextMenu.value.visible = false;
      showMasterFilterMenu.value = !showMasterFilterMenu.value;
    };

    const profile = ref({ place: '#---', rank: 'Rank', points: '0 pts' });
    const displayBadges = ref([]);
    const trackCards = ref([]);

    const todoList = ref([]);
    const showTodoListSidebar = ref(false);
    const todoViewMode = ref('challenge');

    const showAddAnimeModal = ref(false);
    const addAnimeForm = ref({ threadId: '', animeTitle: '', coverImage: '', anilistId: null });
    const animeSearchResults = ref([]);
    const addAnimeError = ref('');
    let searchDebounceTimer = null;

    const showEditBadgeModal = ref(false);
    const editingBadgeItem = ref(null);
    const editBadgeImageForm = ref({ imgSrc: '' });

    // AWC Profile Scraping Modal State
    const showAwcImportModal = ref(false);
    const awcImportUrl = ref('');
    const awcImportLoading = ref(false);
    const awcImportStatus = ref('');
    const awcImportIsError = ref(false);
    const showAwcHtmlFallback = ref(false);
    const awcHtmlInput = ref('');

    const userAnimeList = ref([]);
    const isFetchingAniList = ref(false);

    const showAddModal = ref(false);
    const newCommentInput = ref('');
    const inputError = ref('');

    const showMultiChoiceModal = ref(false);
    const multiChoiceImages = ref([]);
    const multiChoiceContext = ref(null);

    const showEditModal = ref(false);
    const editingCard = ref(null);
    const editCardForm = ref({ title: '', commentLink: '', mode: 'easy', cutOffDate: '' });

    const showClearDisplayModal = ref(false);
    const showDeleteModal = ref(false);
    const itemToDelete = ref(null);
    const deleteItemType = ref(null);

    const contextMenu = ref({ visible: false, x: 0, y: 0, targetItem: null, type: 'track' });
    const linkContextMenu = ref({ visible: false, x: 0, y: 0, url: '' });

    // Helper to look up challenge data regardless of String vs Number
    const getChallengeById = (id) => {
      if (!id) return null;
      const cleanId = String(id).trim();
      return challengesData.value[cleanId] || null;
    };

    const getBadgesById = (id) => {
      if (!id) return [];
      const cleanId = String(id).trim();
      return badgesData.value[cleanId] || [];
    };

    const openAddModal = () => {
      newCommentInput.value = '';
      inputError.value = '';
      showAddModal.value = true;
    };

    const proceedAdd = () => {
      inputError.value = '';
      const url = newCommentInput.value.trim();
      const rawId = extractThreadId(url);

      if (!rawId) {
        inputError.value = 'URL format must contain /thread/{id}';
        return;
      }
      const threadId = String(rawId).trim();

      const challenge = getChallengeById(threadId) || {
        name: `Thread #${threadId}`,
        type: 'single',
        category: 'Other',
        mediaType: 'anime'
      };

      const badgeList = getBadgesById(threadId);
      const defaultImg = badgeList[0] || '';

      if (activeTab.value === 'display') {
        if (challenge.type === 'multi' && badgeList.length > 0) {
          multiChoiceImages.value = badgeList;
          multiChoiceContext.value = {
            threadId,
            commentLink: url,
            challengeName: challenge.name,
            category: challenge.category || 'Other',
            mediaType: challenge.mediaType || challenge.media || 'anime',
            sourceCardId: null
          };
          showAddModal.value = false;
          showMultiChoiceModal.value = true;
          return;
        }

        displayBadges.value.unshift({
          id: 'display-' + Date.now(),
          threadId,
          commentLink: url,
          title: challenge.name,
          imgSrc: defaultImg,
          category: challenge.category || 'Other',
          mediaType: challenge.mediaType || challenge.media || 'anime'
        });
        persistState();
        showAddModal.value = false;
      } else {
        const isGenre = (challenge.category || '').toLowerCase() === 'genre';
        const newCard = {
          id: 'card-' + Date.now(),
          threadId,
          commentLink: url,
          title: challenge.name,
          badgeImg: defaultImg,
          status: 'planned',
          isReviewing: false,
          challengeType: challenge.type || 'single',
          category: challenge.category || 'Other',
          mediaType: challenge.mediaType || challenge.media || 'anime',
          mode: isGenre ? 'easy' : '',
          cutOffDate: ''
        };

        trackCards.value.unshift(newCard);
        if (isClassicCard(newCard, challengesData.value) || isSeasonalCard(newCard, challengesData.value) || isMonthlyCard(newCard, challengesData.value)) {
          fetchAniListCompletedData();
        }

        persistState();
        showAddModal.value = false;
      }
    };

    const availableCategories = computed(() => {
      const cats = new Set();
      const currentMedia = selectedMediaTypeFilter.value;

      Object.values(challengesData.value).forEach(c => {
        if (!c.category) return;
        const mt = c.mediaType || c.media || 'anime';
        if (currentMedia === 'all' || mt === currentMedia) cats.add(c.category);
      });

      trackCards.value.forEach(c => {
        const mt = getCardMediaType(c, challengesData.value);
        if (currentMedia === 'all' || mt === currentMedia) {
          if (c.category) cats.add(c.category);
        }
      });

      displayBadges.value.forEach(b => {
        const mt = getBadgeMediaType(b, challengesData.value);
        if (currentMedia === 'all' || mt === currentMedia) {
          if (b.category) cats.add(b.category);
        }
      });

      return ['all', ...Array.from(cats).sort((a, b) => a.localeCompare(b))];
    });

    const setMediaTypeFilter = (m) => {
      selectedMediaTypeFilter.value = m;
      if (!availableCategories.value.includes(selectedCategoryFilter.value)) {
        selectedCategoryFilter.value = 'all';
      }
    };

    const getAniListStat = (card) => {
      return calculateAniListStat(card, userAnimeList.value, challengesData.value);
    };

    const syncBadgesWithJson = () => {
      let changed = false;

      trackCards.value.forEach(card => {
        const tid = String(card.threadId || '').trim();
        const challenge = challengesData.value[tid];

        if (challenge) {
          if ((!card.title || card.title.startsWith('Thread #')) && challenge.name) {
            card.title = challenge.name;
            changed = true;
          }
          if ((!card.category || card.category.toLowerCase() === 'other') && challenge.category) {
            card.category = challenge.category;
            changed = true;
          }
          if (challenge.type && (!card.challengeType || card.challengeType === 'single')) {
            card.challengeType = challenge.type;
            changed = true;
          }
          if (challenge.media || challenge.mediaType) {
            card.mediaType = challenge.media || challenge.mediaType;
            changed = true;
          }
        }

        const bList = badgesData.value[tid];
        if (bList && bList.length > 0) {
          let expectedImg = bList[0];
          if (isGenreCard(card, challengesData.value)) {
            const modeIndexMap = { easy: 0, normal: 1, hard: 2, mastery: 3 };
            const idx = modeIndexMap[card.mode || 'easy'] ?? 0;
            expectedImg = bList[idx] || bList[0];
          }
          if (!card.badgeImg || card.badgeImg === 'N/A' || (!bList.includes(card.badgeImg) && bList.length === 1)) {
            card.badgeImg = expectedImg;
            changed = true;
          }
        }
      });

      displayBadges.value.forEach(badge => {
        const tid = String(badge.threadId || '').trim();
        if (tid === '67067') return;

        const bList = badgesData.value[tid];
        if (bList && bList.length > 0) {
          if (!bList.includes(badge.imgSrc)) {
            badge.imgSrc = bList[0];
            changed = true;
          }
        }
      });

      if (changed) persistState();
    };

    const persistState = async () => {
      if (!currentUser.value) return;
      const userKey = currentUser.value.toLowerCase().trim();
      if (!allUsersData.value[userKey]) allUsersData.value[userKey] = {};

      allUsersData.value[userKey].profile = profile.value;
      allUsersData.value[userKey].display = displayBadges.value;
      allUsersData.value[userKey].track = trackCards.value;
      allUsersData.value[userKey].todoList = todoList.value;

      await writeDataToFile({
        lastActiveUser: currentUser.value,
        users: allUsersData.value
      });
    };

    const loadUserData = async (username) => {
      const userKey = username.toLowerCase().trim();
      currentUser.value = username;
      const uData = allUsersData.value[userKey] || {};

      profile.value = uData.profile || { place: '#---', rank: 'Rank', points: '0 pts' };
      displayBadges.value = uData.display || [];
      trackCards.value = uData.track || [];
      todoList.value = uData.todoList || [];
      userAnimeList.value = [];

      syncBadgesWithJson();

      const awcStats = await fetchAwcProfile(username);
      if (awcStats) {
        if (awcStats.place) profile.value.place = awcStats.place;
        if (awcStats.rank) profile.value.rank = awcStats.rank;
        if (awcStats.points) profile.value.points = awcStats.points;
        persistState();
      }

      fetchAniListCompletedData();
    };

    const fetchAniListCompletedData = async () => {
      if (!currentUser.value || isFetchingAniList.value) return;
      isFetchingAniList.value = true;
      try {
        userAnimeList.value = await fetchAniListCompleted(currentUser.value);
      } catch (e) {
        console.error(e);
      } finally {
        isFetchingAniList.value = false;
      }
    };

    const handleAuthSubmit = () => {
      authError.value = '';
      const u = authForm.value.username.trim();
      const p = authForm.value.password.trim();
      if (!u || !p) {
        authError.value = 'Please provide both username and password.';
        return;
      }

      const userKey = u.toLowerCase();
      const existing = allUsersData.value[userKey];

      if (existing) {
        if (existing.password !== p) {
          authError.value = 'Incorrect password for this user.';
          return;
        }
      } else {
        allUsersData.value[userKey] = {
          username: u,
          password: p,
          profile: { place: '#---', rank: 'Rank', points: '0 pts' },
          display: [],
          track: [],
          todoList: []
        };
      }

      loadUserData(u);
      showAuthModal.value = false;
      authForm.value = { username: '', password: '' };
      persistState();
    };

    const openAuthModal = () => {
      authError.value = '';
      authForm.value = { username: currentUser.value || '', password: '' };
      showAuthModal.value = true;
    };

    const exportUserDataAsJson = () => {
      exportJsonFile({
        version: "5.0",
        exportedAt: new Date().toISOString(),
        username: currentUser.value,
        profile: profile.value,
        display: displayBadges.value,
        track: trackCards.value,
        todoList: todoList.value
      }, `awc_backup_${currentUser.value || 'data'}_${new Date().toISOString().slice(0, 10)}.json`);
    };

    const handleImportJsonFile = (event) => {
      const file = event.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);
          if (data.profile) profile.value = data.profile;
          if (Array.isArray(data.display)) displayBadges.value = data.display;
          if (Array.isArray(data.track)) trackCards.value = data.track;
          if (Array.isArray(data.todoList)) todoList.value = data.todoList;

          syncBadgesWithJson();
          persistState();
          alert('Data successfully restored from backup.');
        } catch (err) {
          alert('Could not parse JSON backup file: ' + err.message);
        }
      };
      reader.readAsText(file);
      event.target.value = '';
    };

    const openAwcImportModal = () => {
      awcImportUrl.value = `https://awc.moe/challenger/${currentUser.value || 'croixph'}`;
      awcImportStatus.value = '';
      awcImportIsError.value = false;
      showAwcHtmlFallback.value = false;
      awcHtmlInput.value = '';
      showAwcImportModal.value = true;
    };

    const handleAwcImport = async () => {
      awcImportStatus.value = '';
      awcImportIsError.value = false;

      let htmlContent = awcHtmlInput.value.trim();
      if (!htmlContent) {
        awcImportLoading.value = true;
        const target = awcImportUrl.value.trim();
        const proxies = [
          target,
          `https://corsproxy.io/?${encodeURIComponent(target)}`,
          `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`
        ];
        for (const url of proxies) {
          try {
            const res = await fetch(url);
            if (res.ok) {
              const text = await res.text();
              if (text && text.length > 200) {
                htmlContent = text;
                break;
              }
            }
          } catch (e) {}
        }
        awcImportLoading.value = false;
      }

      if (!htmlContent) {
        awcImportIsError.value = true;
        awcImportStatus.value = '! Blocked by CORS. View page source on AWC and paste HTML below:';
        showAwcHtmlFallback.value = true;
        return;
      }

      const { importedList, profile: newProf } = parseAwcChallengerHtml(htmlContent, challengesData.value, badgesData.value);
      if (importedList.length === 0) {
        awcImportIsError.value = true;
        awcImportStatus.value = '! No badges could be parsed. Paste the page HTML below:';
        showAwcHtmlFallback.value = true;
        return;
      }

      let addedCount = 0;
      importedList.forEach(b => {
        const exists = displayBadges.value.some(existing => 
          (existing.imgSrc && b.imgSrc && existing.imgSrc === b.imgSrc) ||
          (existing.title === b.title && existing.threadId === b.threadId)
        );
        if (!exists) {
          displayBadges.value.push(b);
          addedCount++;
        }
      });

      if (newProf.place) profile.value.place = newProf.place;
      if (newProf.rank) profile.value.rank = newProf.rank;
      if (newProf.points) profile.value.points = newProf.points;

      syncBadgesWithJson();
      persistState();
      awcImportIsError.value = false;
      awcImportStatus.value = `✓ Imported ${importedList.length} badges (${addedCount} new added).`;
      setTimeout(() => {
        showAwcImportModal.value = false;
        showAwcHtmlFallback.value = false;
        awcHtmlInput.value = '';
      }, 1500);
    };

    const handleGlobalKeydown = (e) => {
      const tag = document.activeElement?.tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable;
      if (isInput) return;

      const anyModalOpen = showAddModal.value || showAddAnimeModal.value || showEditModal.value || 
                           showEditBadgeModal.value || showDeleteModal.value || showClearDisplayModal.value || 
                           showMultiChoiceModal.value || showAuthModal.value || showAwcImportModal.value;
      if (anyModalOpen) return;

      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        openAddModal();
      } else if (e.key === 'x' || e.key === 'X') {
        e.preventDefault();
        showTodoListSidebar.value = !showTodoListSidebar.value;
      }
    };

    const filteredDisplayBadges = computed(() => {
      let badges = displayBadges.value;
      if (searchQuery.value.trim()) {
        const q = searchQuery.value.toLowerCase().trim();
        badges = badges.filter(b => b.title.toLowerCase().includes(q));
      }
      if (selectedMediaTypeFilter.value !== 'all') {
        badges = badges.filter(b => getBadgeMediaType(b, challengesData.value) === selectedMediaTypeFilter.value);
      }
      if (selectedCategoryFilter.value !== 'all') {
        badges = badges.filter(b => {
          const cat = b.category || challengesData.value[b.threadId]?.category || 'Other';
          return cat.toLowerCase() === selectedCategoryFilter.value.toLowerCase();
        });
      }
      return badges;
    });

    const filteredTrackCards = computed(() => {
      let cards = [...trackCards.value];
      if (searchQuery.value.trim()) {
        const q = searchQuery.value.toLowerCase().trim();
        cards = cards.filter(c => c.title.toLowerCase().includes(q));
      }
      if (selectedMediaTypeFilter.value !== 'all') {
        cards = cards.filter(c => getCardMediaType(c, challengesData.value) === selectedMediaTypeFilter.value);
      }
      if (selectedStatusFilter.value === 'pinned') {
        cards = cards.filter(c => c.isReviewing);
      } else if (['planned', 'construction', 'in progress'].includes(selectedStatusFilter.value)) {
        cards = cards.filter(c => c.status === selectedStatusFilter.value);
      }
      if (selectedCategoryFilter.value !== 'all') {
        cards = cards.filter(c => getCardCategory(c, challengesData.value).toLowerCase() === selectedCategoryFilter.value.toLowerCase());
      }
      return cards.sort((a, b) => (b.isReviewing === true ? 1 : 0) - (a.isReviewing === true ? 1 : 0));
    });

    const filteredTimeLimitedCards = computed(() => filteredTrackCards.value.filter(c => isTimeLimitedCard(c, challengesData.value)));
    const filteredOtherCards = computed(() => filteredTrackCards.value.filter(c => !isTimeLimitedCard(c, challengesData.value)));

    const getCardTodoList = (card) => todoList.value.filter(item => item.threadId === card.threadId);

    const groupedTodoList = computed(() => {
      const map = {};
      todoList.value.forEach(item => {
        const tid = item.threadId || 'general';
        if (!map[tid]) {
          const matchedCard = trackCards.value.find(c => c.threadId === tid);
          const challenge = challengesData.value[tid];
          const challengeName = matchedCard?.title || challenge?.name || `Thread #${tid}`;
          map[tid] = { threadId: tid, challengeName, animes: [] };
        }
        map[tid].animes.push(item);
      });
      return Object.values(map);
    });

    const groupedByAnimeTodoList = computed(() => {
      const map = {};
      todoList.value.forEach(item => {
        const key = item.animeTitle.toLowerCase().trim();
        if (!map[key]) {
          map[key] = {
            key,
            animeTitle: item.animeTitle,
            coverImage: item.coverImage,
            anilistId: item.anilistId,
            challenges: []
          };
        }
        const matchedCard = trackCards.value.find(c => c.threadId === item.threadId);
        const challengeName = matchedCard?.title || challengesData.value[item.threadId]?.name || `Thread #${item.threadId}`;
        map[key].challenges.push({ todoId: item.id, threadId: item.threadId, challengeName });
      });
      return Object.values(map);
    });

    const removeAnimeEverywhere = (animeTitle) => {
      if (!animeTitle) return;
      const target = animeTitle.toLowerCase().trim();
      todoList.value = todoList.value.filter(item => item.animeTitle.toLowerCase().trim() !== target);
      persistState();
    };

    const openAddAnimeModal = (groupOrCard) => {
      addAnimeError.value = '';
      animeSearchResults.value = [];
      addAnimeForm.value = {
        threadId: groupOrCard?.threadId || (trackCards.value[0]?.threadId || ''),
        animeTitle: '',
        coverImage: '',
        anilistId: null
      };
      showAddAnimeModal.value = true;
    };

    const onSearchAnimeInput = () => {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(async () => {
        const q = addAnimeForm.value.animeTitle.trim();
        if (q.length >= 2) animeSearchResults.value = await searchAniListAnime(q);
      }, 400);
    };

    const selectAnimeResult = (anime) => {
      addAnimeForm.value.animeTitle = anime.title.english || anime.title.romaji;
      addAnimeForm.value.coverImage = anime.coverImage?.medium || '';
      addAnimeForm.value.anilistId = anime.id;
      animeSearchResults.value = [];
    };

    const proceedAddAnime = () => {
      if (!addAnimeForm.value.threadId) {
        addAnimeError.value = 'Please select a target challenge.';
        return;
      }
      if (!addAnimeForm.value.animeTitle.trim()) {
        addAnimeError.value = 'Please specify an anime title.';
        return;
      }
      todoList.value.push({
        id: 'todo-' + Date.now(),
        threadId: addAnimeForm.value.threadId,
        animeTitle: addAnimeForm.value.animeTitle.trim(),
        coverImage: addAnimeForm.value.coverImage.trim(),
        anilistId: addAnimeForm.value.anilistId
      });
      persistState();
      showAddAnimeModal.value = false;
    };

    const removeTodoAnime = (todoId) => {
      todoList.value = todoList.value.filter(i => i.id !== todoId);
      persistState();
    };

    const closeContextMenu = () => {
      contextMenu.value.visible = false;
      linkContextMenu.value.visible = false;
      showMasterFilterMenu.value = false;
    };

    const onBodyContextMenu = () => {
      if (contextMenu.value.visible || linkContextMenu.value.visible) closeContextMenu();
    };

    const openLinkContextMenu = (event, url) => {
      if (linkContextMenu.value.visible) {
        closeContextMenu();
        return;
      }
      closeContextMenu();
      linkContextMenu.value = {
        visible: true,
        x: Math.min(event.clientX, window.innerWidth - 180),
        y: Math.min(event.clientY, window.innerHeight - 100),
        url
      };
    };

    const openTargetLink = () => {
      if (linkContextMenu.value.url) window.open(linkContextMenu.value.url, '_blank');
      linkContextMenu.value.visible = false;
    };

    const copyTargetLink = async () => {
      if (linkContextMenu.value.url) {
        try {
          await navigator.clipboard.writeText(linkContextMenu.value.url);
        } catch (e) {
          const input = document.createElement('input');
          input.value = linkContextMenu.value.url;
          document.body.appendChild(input);
          input.select();
          document.execCommand('copy');
          document.body.removeChild(input);
        }
      }
      linkContextMenu.value.visible = false;
    };

    const openContextMenu = (event, item, type) => {
      if (contextMenu.value.visible) {
        closeContextMenu();
        return;
      }
      closeContextMenu();
      contextMenu.value = {
        visible: true,
        x: Math.min(event.clientX, window.innerWidth - 180),
        y: Math.min(event.clientY, window.innerHeight - 150),
        targetItem: item,
        type
      };
    };

    onMounted(async () => {
      window.addEventListener('keydown', handleGlobalKeydown);

      try {
        isDbLoading.value = true;
        const data = await fetchDbInitData();
        const challenges = data.challenges || [];
        const badges = data.badges || [];

        const challengesMap = {};
        if (Array.isArray(challenges)) {
          challenges.forEach(c => {
            const tid = String(c.challengeId ?? c.threadId ?? c.id ?? '').trim();
            if (tid) {
              challengesMap[tid] = {
                ...c,
                name: c.name || c.title || `Thread #${tid}`,
                category: c.category || 'Other',
                type: c.type || 'single',
                mediaType: c.media || c.mediaType || 'anime'
              };
            }
          });
        }

        const badgesMap = {};
        if (Array.isArray(badges)) {
          badges.forEach(b => {
            const bid = String(b.badgeId ?? b.challengeId ?? b.threadId ?? b.id ?? '').trim();
            if (bid) {
              badgesMap[bid] = Array.isArray(b.images) ? b.images : (b.images ? [b.images] : (b.badgeImg ? [b.badgeImg] : []));
            }
          });
        }

        challengesData.value = challengesMap;
        badgesData.value = badgesMap;
        console.log(`[Archive] Loaded ${Object.keys(challengesMap).length} challenges and ${Object.keys(badgesMap).length} badges (Source: ${data.source || 'default'}).`);
      } catch (err) {
        console.error('Failed to load challenge data:', err);
        dbError.value = err.message || 'Failed to load challenge data.';
      } finally {
        isDbLoading.value = false;
      }

      const store = await readDataFromFile();
      if (store && store.users) {
        allUsersData.value = store.users;
        if (store.lastActiveUser && allUsersData.value[store.lastActiveUser.toLowerCase()]) {
          loadUserData(store.lastActiveUser);
        } else {
          showAuthModal.value = true;
        }
      } else {
        showAuthModal.value = true;
      }

      syncBadgesWithJson();
    });

    const confirmMultiChoice = (selectedImg) => {
      if (!multiChoiceContext.value) return;
      const { threadId, commentLink, challengeName, category, mediaType, sourceCardId } = multiChoiceContext.value;

      displayBadges.value.unshift({
        id: 'display-' + Date.now(),
        threadId,
        commentLink,
        title: challengeName,
        imgSrc: selectedImg,
        category: category || challengesData.value[threadId]?.category || 'Other',
        mediaType: mediaType || challengesData.value[threadId]?.mediaType || challengesData[threadId]?.media || 'anime'
      });

      if (sourceCardId) {
        trackCards.value = trackCards.value.filter(c => c.id !== sourceCardId);
      }

      persistState();
      showMultiChoiceModal.value = false;
      multiChoiceContext.value = null;
    };

    const completeCard = (card) => {
      if (!card) return;
      const threadId = String(card.threadId);
      const challenge = challengesData.value[threadId] || { name: card.title, type: card.challengeType || 'single', category: card.category || 'Other', mediaType: getCardMediaType(card, challengesData.value) };
      const badgeList = badgesData.value[threadId] || (card.badgeImg ? [card.badgeImg] : []);

      if (isGenreCard(card, challengesData.value)) {
        const mode = (card.mode || 'easy').toLowerCase();
        const modeIndexMap = { easy: 0, normal: 1, hard: 2, mastery: 3 };
        const badgeIndex = modeIndexMap[mode] ?? 0;
        const selectedImg = badgeList[badgeIndex] || badgeList[0] || card.badgeImg || '';

        displayBadges.value.unshift({
          id: 'display-' + Date.now(),
          threadId,
          commentLink: card.commentLink,
          title: `${card.title} [${mode.toUpperCase()}]`,
          imgSrc: selectedImg,
          category: 'Genre',
          mediaType: getCardMediaType(card, challengesData.value)
        });

        if (mode === 'mastery') {
          trackCards.value = trackCards.value.filter(c => c.id !== card.id);
          persistState();
        } else {
          persistState();
          openEditModal(card);
        }
        closeContextMenu();
        return;
      }

      if (challenge.type === 'multi' && badgeList.length > 1) {
        multiChoiceImages.value = badgeList;
        multiChoiceContext.value = {
          threadId,
          commentLink: card.commentLink,
          challengeName: card.title,
          category: getCardCategory(card, challengesData.value),
          mediaType: getCardMediaType(card, challengesData.value),
          sourceCardId: card.id
        };
        showMultiChoiceModal.value = true;
        closeContextMenu();
        return;
      }

      displayBadges.value.unshift({
        id: 'display-' + Date.now(),
        threadId,
        commentLink: card.commentLink,
        title: card.title,
        imgSrc: card.badgeImg || badgeList[0] || '',
        category: getCardCategory(card, challengesData.value),
        mediaType: getCardMediaType(card, challengesData.value)
      });
      trackCards.value = trackCards.value.filter(c => c.id !== card.id);
      persistState();
      closeContextMenu();
    };

    const openEditModal = (card) => {
      editingCard.value = card;
      editCardForm.value = {
        title: card.title,
        commentLink: card.commentLink,
        mode: card.mode || 'easy',
        cutOffDate: card.cutOffDate || ''
      };
      showEditModal.value = true;
    };

    const saveCardEdit = () => {
      if (!editingCard.value) return;

      editingCard.value.title = editCardForm.value.title.trim() || editingCard.value.title;
      editingCard.value.commentLink = editCardForm.value.commentLink.trim() || editingCard.value.commentLink;

      if (isGenreCard(editingCard.value, challengesData.value)) {
        editingCard.value.mode = editCardForm.value.mode || 'easy';
        editingCard.value.cutOffDate = editCardForm.value.cutOffDate.trim();
        if (editingCard.value.cutOffDate) fetchAniListCompletedData();
      }

      const newThreadId = extractThreadId(editingCard.value.commentLink);
      if (newThreadId) {
        editingCard.value.threadId = String(newThreadId);
        const bList = badgesData.value[newThreadId];
        if (bList && bList.length > 0) {
          if (isGenreCard(editingCard.value, challengesData.value)) {
            const modeIndexMap = { easy: 0, normal: 1, hard: 2, mastery: 3 };
            const idx = modeIndexMap[editingCard.value.mode] ?? 0;
            editingCard.value.badgeImg = bList[idx] || bList[0];
          } else {
            editingCard.value.badgeImg = bList[0];
          }
        }
        if (challengesData.value[newThreadId]?.category) {
          editingCard.value.category = challengesData.value[newThreadId].category;
        }
        if (challengesData.value[newThreadId]?.media || challengesData.value[newThreadId]?.mediaType) {
          editingCard.value.mediaType = challengesData.value[newThreadId].media || challengesData.value[newThreadId].mediaType;
        }
      }

      if (isSeasonalCard(editingCard.value, challengesData.value) || isMonthlyCard(editingCard.value, challengesData.value)) {
        fetchAniListCompletedData();
      }

      persistState();
      showEditModal.value = false;
      editingCard.value = null;
    };

    const openEditDisplayBadgeModal = (badge) => {
      editingBadgeItem.value = badge;
      editBadgeImageForm.value = { imgSrc: badge.imgSrc || '' };
      showEditBadgeModal.value = true;
    };

    const saveDisplayBadgeEdit = () => {
      if (!editingBadgeItem.value) return;
      const newImg = editBadgeImageForm.value.imgSrc.trim();
      editingBadgeItem.value.imgSrc = newImg;

      const tid = String(editingBadgeItem.value.threadId);
      if (tid) {
        if (!badgesData.value[tid]) badgesData.value[tid] = [];
        if (!badgesData.value[tid].includes(newImg)) badgesData.value[tid].unshift(newImg);
      }

      persistState();
      showEditBadgeModal.value = false;
      editingBadgeItem.value = null;
    };

    const confirmClearDisplay = () => {
      displayBadges.value = [];
      persistState();
      showClearDisplayModal.value = false;
    };

    const toggleReviewCard = (card) => {
      if (!card) return;
      card.isReviewing = !card.isReviewing;
      persistState();
      closeContextMenu();
    };

    const promptDelete = (item, type) => {
      itemToDelete.value = item;
      deleteItemType.value = type;
      showDeleteModal.value = true;
      closeContextMenu();
    };

    const cancelDelete = () => {
      showDeleteModal.value = false;
      itemToDelete.value = null;
      deleteItemType.value = null;
    };

    const confirmDelete = () => {
      if (!itemToDelete.value || !deleteItemType.value) return;
      if (deleteItemType.value === 'track') {
        trackCards.value = trackCards.value.filter(c => c.id !== itemToDelete.value.id);
      } else if (deleteItemType.value === 'display') {
        displayBadges.value = displayBadges.value.filter(b => b.id !== itemToDelete.value.id);
      }
      persistState();
      cancelDelete();
    };

    return {
      isDbLoading,
      dbError,
      activeTab,
      searchQuery,
      currentUser,
      showAuthModal,
      authForm,
      authError,
      openAuthModal,
      handleAuthSubmit,
      exportUserDataAsJson,
      handleImportJsonFile,
      showAwcImportModal,
      awcImportUrl,
      awcImportLoading,
      awcImportStatus,
      awcImportIsError,
      showAwcHtmlFallback,
      awcHtmlInput,
      openAwcImportModal,
      handleAwcImport,
      showMasterFilterMenu,
      isAnyFilterActive,
      toggleMasterFilterMenu,
      selectedMediaTypeFilter,
      setMediaTypeFilter,
      selectedStatusFilter,
      selectedCategoryFilter,
      availableCategories,
      getCardCategory: (c) => getCardCategory(c, challengesData.value),
      getCardMediaType: (c) => getCardMediaType(c, challengesData.value),
      getBadgeMediaType: (b) => getBadgeMediaType(b, challengesData.value),
      isGenreCard: (c) => isGenreCard(c, challengesData.value),
      isClassicCard: (c) => isClassicCard(c, challengesData.value),
      isSeasonalCard: (c) => isSeasonalCard(c, challengesData.value),
      isMonthlyCard: (c) => isMonthlyCard(c, challengesData.value),
      isTimeLimitedCard: (c) => isTimeLimitedCard(c, challengesData.value),
      isCardEditable: (c) => isCardEditable(c, challengesData.value),
      shouldShowCountPill: (c) => shouldShowCountPill(c, challengesData.value),
      getAniListStat,
      profile,
      displayBadges,
      filteredDisplayBadges,
      trackCards,
      filteredTrackCards,
      filteredTimeLimitedCards,
      filteredOtherCards,
      showTodoListSidebar,
      todoViewMode,
      todoList,
      groupedTodoList,
      groupedByAnimeTodoList,
      removeAnimeEverywhere,
      getCardTodoList,
      getAniListUrl,
      showAddAnimeModal,
      addAnimeForm,
      animeSearchResults,
      addAnimeError,
      openAddAnimeModal,
      onSearchAnimeInput,
      searchAniListAnime,
      selectAnimeResult,
      proceedAddAnime,
      removeTodoAnime,
      showEditBadgeModal,
      editingBadgeItem,
      editBadgeImageForm,
      openEditDisplayBadgeModal,
      saveDisplayBadgeEdit,
      showAddModal,
      newCommentInput,
      inputError,
      openAddModal,
      proceedAdd,
      showMultiChoiceModal,
      multiChoiceImages,
      multiChoiceContext,
      confirmMultiChoice,
      editingCard,
      showEditModal,
      editCardForm,
      openEditModal,
      saveCardEdit,
      showClearDisplayModal,
      confirmClearDisplay,
      showDeleteModal,
      itemToDelete,
      deleteItemType,
      promptDelete,
      cancelDelete,
      confirmDelete,
      contextMenu,
      linkContextMenu,
      openLinkContextMenu,
      openTargetLink,
      copyTargetLink,
      openContextMenu,
      closeContextMenu,
      onBodyContextMenu,
      toggleReviewCard,
      completeCard,
      persistState
    };
  }
}).mount('#app');