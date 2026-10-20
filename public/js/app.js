import { writeDataToFile, readDataFromFile, exportJsonFile } from './storage.js';
import { extractThreadId, getAniListUrl } from './helpers.js';
import {
  fetchAniListCompleted,
  searchAniListMedia,
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
  isHighPriorityCard,
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
    const todoMediaFilter = ref('all'); // 'all', 'anime', 'manga'

    const toggleTodoMediaFilter = () => {
      if (todoMediaFilter.value === 'all') todoMediaFilter.value = 'anime';
      else if (todoMediaFilter.value === 'anime') todoMediaFilter.value = 'manga';
      else todoMediaFilter.value = 'all';
    };

    const getChallengeLink = (tid) => {
      if (!tid) return '#';
      const cleanId = String(tid).trim();
      const matched = trackCards.value.find(c => String(c.threadId).trim() === cleanId);
      if (matched?.commentLink) return matched.commentLink;
      return `https://anilist.co/forum/thread/${cleanId}`;
    };

    const showAddAnimeModal = ref(false);
    const addAnimeForm = ref({ threadId: '', animeTitle: '', coverImage: '', anilistId: null, mediaType: 'anime' });
    const animeSearchResults = ref([]);
    const addAnimeError = ref('');
    let searchDebounceTimer = null;

    const currentTargetMediaType = computed(() => {
      const tid = addAnimeForm.value.threadId;
      if (!tid) return 'anime';
      const card = trackCards.value.find(c => String(c.threadId).trim() === String(tid).trim());
      const cData = challengesData.value[String(tid).trim()];
      return getCardMediaType(card, challengesData.value) || cData?.media || cData?.mediaType || 'anime';
    });

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

    // Helper to look up challenge data regardless of String vs Number or Media type
    const getChallengeById = (id, media = null) => {
      if (!id) return null;
      const cleanId = String(id).trim();
      if (media && challengesData.value[`${String(media).toLowerCase()}:${cleanId}`]) {
        return challengesData.value[`${String(media).toLowerCase()}:${cleanId}`];
      }
      return challengesData.value[cleanId] || null;
    };

    const getBadgesById = (id, media = null) => {
      if (!id) return [];
      const cleanId = String(id).trim();
      if (media && badgesData.value[`${String(media).toLowerCase()}:${cleanId}`]) {
        return badgesData.value[`${String(media).toLowerCase()}:${cleanId}`];
      }
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
        const isGenre = isGenreCard({ category: challenge.category, title: challenge.name }, challengesData.value);
        const isMonthly = isMonthlyCard({ category: challenge.category, title: challenge.name }, challengesData.value);

        if (badgeList.length > 1) {
          multiChoiceImages.value = badgeList;
          multiChoiceContext.value = {
            threadId,
            commentLink: url,
            challengeName: challenge.name,
            category: challenge.category || (isGenre ? 'Genre' : (isMonthly ? 'Monthly' : 'Other')),
            mediaType: challenge.mediaType || challenge.media || 'anime',
            sourceCardId: null,
            isGenre,
            isMonthly
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
        return;
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

    const resetAllFilters = () => {
      selectedMediaTypeFilter.value = 'all';
      selectedCategoryFilter.value = 'all';
      selectedStatusFilter.value = 'all';
      searchQuery.value = '';
    };

    const onMediaTypeChange = () => {
      if (!availableCategories.value.includes(selectedCategoryFilter.value)) {
        selectedCategoryFilter.value = 'all';
      }
    };

    const getAniListStat = (card) => {
      return calculateAniListStat(card, userAnimeList.value, challengesData.value);
    };

    const syncBadgesWithDb = () => {
      let changed = false;

      trackCards.value.forEach(card => {
        const tid = String(card.threadId || '').trim();
        const challenge = getChallengeById(tid, card.mediaType);

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

        const bList = getBadgesById(tid, card.mediaType);
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

        const bList = getBadgesById(tid, badge.mediaType);
        if (bList && bList.length > 0) {
          const tLower = (badge.title || '').toLowerCase();
          const isGenre = isGenreCard(badge, challengesData.value);
          const isMonthly = isMonthlyCard(badge, challengesData.value);

          if (isGenre) {
            // Genre mode mapping:
            // easy mode: 1st image link
            // normal mode: 2nd image link
            // hard mode: 3rd image link
            // mastery: 4th image link
            let idx = 0;
            if (tLower.includes('mastery')) idx = 3;
            else if (tLower.includes('hard')) idx = 2;
            else if (tLower.includes('normal')) idx = 1;
            else idx = 0;
            const expectedImg = bList[idx] || bList[0];
            if (badge.imgSrc !== expectedImg) {
              badge.imgSrc = expectedImg;
              changed = true;
            }
          } else if (isMonthly) {
            // Monthly mode mapping:
            // easy mode: 1st image link
            // hard mode: 2nd image link
            const idx = tLower.includes('hard') ? 1 : 0;
            const expectedImg = bList[idx] || bList[0];
            if (badge.imgSrc !== expectedImg) {
              badge.imgSrc = expectedImg;
              changed = true;
            }
          } else {
            // For other challenges, preserve user choice if already set
            if (!badge.imgSrc) {
              badge.imgSrc = bList[0];
              changed = true;
            }
          }
        }
      });

      if (changed) persistState();
    };

    const syncBadgesWithJson = syncBadgesWithDb;

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

      trackCards.value.forEach(card => {
        const count = todoList.value.filter(i => String(i.threadId).trim() === String(card.threadId).trim()).length;
        if (count > 0) card.hadTodos = true;
      });

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
        cards = cards.filter(c => c.isReviewing && !c.isCompletedTodo);
      } else if (selectedStatusFilter.value === 'completed') {
        cards = cards.filter(c => c.isReviewing && c.isCompletedTodo);
      } else if (selectedStatusFilter.value === 'has to-dos') {
        cards = cards.filter(c => getCardTodoList(c).length > 0);
      } else if (['planned', 'construction', 'in progress', 'reviewing'].includes(selectedStatusFilter.value)) {
        cards = cards.filter(c => c.status === selectedStatusFilter.value);
      }
      if (selectedCategoryFilter.value !== 'all') {
        cards = cards.filter(c => getCardCategory(c, challengesData.value).toLowerCase() === selectedCategoryFilter.value.toLowerCase());
      }
      return cards.sort((a, b) => (b.isReviewing === true ? 1 : 0) - (a.isReviewing === true ? 1 : 0));
    });

    const filteredHighPriorityCards = computed(() => filteredTrackCards.value.filter(c => isHighPriorityCard(c, challengesData.value)));
    const filteredOtherCards = computed(() => filteredTrackCards.value.filter(c => !isHighPriorityCard(c, challengesData.value)));
    const filteredTimeLimitedCards = filteredHighPriorityCards;

    const getCardTodoList = (card) => todoList.value.filter(item => String(item.threadId).trim() === String(card.threadId).trim());

    const filteredTodoListItems = computed(() => {
      if (todoMediaFilter.value === 'all') return todoList.value;
      return todoList.value.filter(item => {
        const matchedCard = trackCards.value.find(c => String(c.threadId).trim() === String(item.threadId).trim());
        const itemMedia = item.mediaType || getCardMediaType(matchedCard, challengesData.value) || challengesData.value[item.threadId]?.media || 'anime';
        return itemMedia.toLowerCase() === todoMediaFilter.value.toLowerCase();
      });
    });

    const groupedTodoList = computed(() => {
      const map = {};
      filteredTodoListItems.value.forEach(item => {
        const tid = item.threadId || 'general';
        if (!map[tid]) {
          const matchedCard = trackCards.value.find(c => String(c.threadId).trim() === String(tid).trim());
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
      filteredTodoListItems.value.forEach(item => {
        const key = item.animeTitle.toLowerCase().trim();
        if (!map[key]) {
          map[key] = {
            key,
            animeTitle: item.animeTitle,
            coverImage: item.coverImage,
            anilistId: item.anilistId,
            mediaType: item.mediaType || 'anime',
            challenges: []
          };
        }
        const matchedCard = trackCards.value.find(c => String(c.threadId).trim() === String(item.threadId).trim());
        const challengeName = matchedCard?.title || challengesData.value[item.threadId]?.name || `Thread #${item.threadId}`;
        map[key].challenges.push({ todoId: item.id, threadId: item.threadId, challengeName });
      });
      return Object.values(map);
    });

    const removeAnimeEverywhere = (animeTitle) => {
      if (!animeTitle) return;
      const target = animeTitle.toLowerCase().trim();
      const affectedItems = todoList.value.filter(item => item.animeTitle.toLowerCase().trim() === target);
      const affectedThreadIds = new Set(affectedItems.map(i => String(i.threadId).trim()));

      todoList.value = todoList.value.filter(item => item.animeTitle.toLowerCase().trim() !== target);

      affectedThreadIds.forEach(tid => {
        if (!tid) return;
        const remaining = todoList.value.filter(i => String(i.threadId).trim() === tid).length;
        if (remaining === 0) {
          const card = trackCards.value.find(c => String(c.threadId).trim() === tid);
          if (card && card.hadTodos) {
            card.isReviewing = true;
            card.isCompletedTodo = true;
          }
        }
      });

      persistState();
    };

    const openAddAnimeModal = (groupOrCard) => {
      addAnimeError.value = '';
      animeSearchResults.value = [];
      const defaultThreadId = groupOrCard?.threadId || (trackCards.value[0]?.threadId || '');
      addAnimeForm.value = {
        threadId: defaultThreadId,
        animeTitle: '',
        coverImage: '',
        anilistId: null,
        mediaType: 'anime'
      };
      showAddAnimeModal.value = true;
    };

    const onSearchAnimeInput = () => {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(async () => {
        const q = addAnimeForm.value.animeTitle.trim();
        if (q.length >= 2) {
          animeSearchResults.value = await searchAniListMedia(q, currentTargetMediaType.value);
        }
      }, 400);
    };

    const searchAniListAnime = async () => {
      const q = addAnimeForm.value.animeTitle.trim();
      if (q.length >= 2) {
        animeSearchResults.value = await searchAniListMedia(q, currentTargetMediaType.value);
      }
    };

    const selectAnimeResult = (anime) => {
      addAnimeForm.value.animeTitle = anime.title.english || anime.title.romaji;
      addAnimeForm.value.coverImage = anime.coverImage?.medium || '';
      addAnimeForm.value.anilistId = anime.id;
      addAnimeForm.value.mediaType = currentTargetMediaType.value;
      animeSearchResults.value = [];
    };

    const proceedAddAnime = () => {
      if (!addAnimeForm.value.threadId) {
        addAnimeError.value = 'Please select a target challenge.';
        return;
      }
      if (!addAnimeForm.value.animeTitle.trim()) {
        addAnimeError.value = 'Please specify a title.';
        return;
      }
      const mediaType = currentTargetMediaType.value || 'anime';
      todoList.value.push({
        id: 'todo-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
        threadId: addAnimeForm.value.threadId,
        animeTitle: addAnimeForm.value.animeTitle.trim(),
        coverImage: addAnimeForm.value.coverImage.trim(),
        anilistId: addAnimeForm.value.anilistId,
        mediaType
      });

      const matched = trackCards.value.find(c => String(c.threadId).trim() === String(addAnimeForm.value.threadId).trim());
      if (matched) {
        matched.hadTodos = true;
        matched.isCompletedTodo = false;
      }

      persistState();
      showAddAnimeModal.value = false;
    };

    const removeTodoAnime = (todoId) => {
      const item = todoList.value.find(i => i.id === todoId);
      const affectedThreadId = item ? String(item.threadId).trim() : null;

      todoList.value = todoList.value.filter(i => i.id !== todoId);

      if (affectedThreadId) {
        const remaining = todoList.value.filter(i => String(i.threadId).trim() === affectedThreadId).length;
        if (remaining === 0) {
          const card = trackCards.value.find(c => String(c.threadId).trim() === affectedThreadId);
          if (card && card.hadTodos) {
            card.isReviewing = true;
            card.isCompletedTodo = true;
          }
        }
      }

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
              const m = String(c.media || c.mediaType || 'anime').toLowerCase();
              const obj = {
                ...c,
                name: c.name || c.title || `Thread #${tid}`,
                category: c.category || 'Other',
                type: c.type || 'single',
                mediaType: m
              };
              challengesMap[`${m}:${tid}`] = obj;
              if (!challengesMap[tid] || m === 'anime') {
                challengesMap[tid] = obj;
              }
            }
          });
        }

        const badgesMap = {};
        if (Array.isArray(badges)) {
          badges.forEach(b => {
            const bid = String(b.badgeId ?? b.challengeId ?? b.threadId ?? b.id ?? '').trim();
            if (bid) {
              const imgs = Array.isArray(b.images) ? b.images : (b.images ? [b.images] : (b.badgeImg ? [b.badgeImg] : []));
              const m = String(b.media || 'anime').toLowerCase();
              badgesMap[`${m}:${bid}`] = imgs;
              if (!badgesMap[bid] || m === 'anime') {
                badgesMap[bid] = imgs;
              }
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
          await loadUserData(store.lastActiveUser);
        } else {
          showAuthModal.value = true;
        }
      } else {
        showAuthModal.value = true;
      }

      syncBadgesWithDb();
    });

    const getGenreModeBadgeChoices = (itemOrCtx) => {
      if (!itemOrCtx) return [];
      const tid = itemOrCtx.threadId;
      const media = itemOrCtx.mediaType || getCardMediaType(itemOrCtx, challengesData.value);
      const bList = getBadgesById(tid, media);
      const modes = [
        { label: 'EASY MODE', img: bList[0] || '' },
        { label: 'NORMAL MODE', img: bList[1] || bList[0] || '' },
        { label: 'HARD MODE', img: bList[2] || bList[0] || '' },
        { label: 'MASTERY', img: bList[3] || bList[0] || '' }
      ];
      return modes.filter(m => !!m.img);
    };

    const getMonthlyModeBadgeChoices = (itemOrCtx) => {
      if (!itemOrCtx) return [];
      const tid = itemOrCtx.threadId;
      const media = itemOrCtx.mediaType || getCardMediaType(itemOrCtx, challengesData.value);
      const bList = getBadgesById(tid, media);
      const modes = [
        { label: 'EASY MODE', img: bList[0] || '' },
        { label: 'HARD MODE', img: bList[1] || bList[0] || '' }
      ];
      return modes.filter(m => !!m.img);
    };

    const confirmModeChoice = (selectedImg, modeLabel) => {
      if (!multiChoiceContext.value) return;
      const { threadId, commentLink, challengeName, category, mediaType, sourceCardId } = multiChoiceContext.value;

      const titleSuffix = modeLabel ? ` [${modeLabel}]` : '';
      const finalTitle = titleSuffix && !challengeName.toUpperCase().includes('MODE')
        ? `${challengeName}${titleSuffix}`
        : challengeName;

      displayBadges.value.unshift({
        id: 'display-' + Date.now(),
        threadId,
        commentLink,
        title: finalTitle,
        imgSrc: selectedImg,
        category: category || challengesData.value[threadId]?.category || 'Other',
        mediaType: mediaType || challengesData.value[threadId]?.mediaType || 'anime'
      });

      if (sourceCardId) {
        trackCards.value = trackCards.value.filter(c => c.id !== sourceCardId);
      }

      persistState();
      showMultiChoiceModal.value = false;
      multiChoiceContext.value = null;
    };

    const confirmMultiChoice = (selectedImg) => {
      if (!multiChoiceContext.value) return;
      const { threadId, commentLink, challengeName, category, mediaType, sourceCardId, isGenre, isMonthly } = multiChoiceContext.value;
      const badgeList = getBadgesById(threadId, mediaType);
      const idx = badgeList.indexOf(selectedImg);

      let titleSuffix = '';
      if (isGenre) {
        const genreModes = [' [EASY MODE]', ' [NORMAL MODE]', ' [HARD MODE]', ' [MASTERY]'];
        titleSuffix = genreModes[idx] || '';
      } else if (isMonthly) {
        titleSuffix = idx === 1 ? ' [HARD MODE]' : ' [EASY MODE]';
      }

      const finalTitle = titleSuffix && !challengeName.toUpperCase().includes('MODE')
        ? `${challengeName}${titleSuffix}`
        : challengeName;

      displayBadges.value.unshift({
        id: 'display-' + Date.now(),
        threadId,
        commentLink,
        title: finalTitle,
        imgSrc: selectedImg,
        category: category || challengesData.value[threadId]?.category || 'Other',
        mediaType: mediaType || challengesData.value[threadId]?.mediaType || 'anime'
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

      // 1. Genre:
      // easy mode: first image link from the array of images stored in the badges database
      // normal mode: second image link
      // hard mode: third image link
      // mastery: fourth image link
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

      // 2. Monthly:
      // easy mode: first image link
      // hard mode: second image link
      if (isMonthlyCard(card, challengesData.value)) {
        const mLower = (card.mode || '').toLowerCase();
        const titleLower = (card.title || '').toLowerCase();
        const isHard = mLower === 'hard' || titleLower.includes('hard');
        const badgeIndex = isHard ? 1 : 0;
        const selectedImg = badgeList[badgeIndex] || badgeList[0] || card.badgeImg || '';
        const modeLabel = isHard ? 'HARD MODE' : 'EASY MODE';

        displayBadges.value.unshift({
          id: 'display-' + Date.now(),
          threadId,
          commentLink: card.commentLink,
          title: card.title.toUpperCase().includes('MODE') ? card.title : `${card.title} [${modeLabel}]`,
          imgSrc: selectedImg,
          category: 'Monthly',
          mediaType: getCardMediaType(card, challengesData.value)
        });

        trackCards.value = trackCards.value.filter(c => c.id !== card.id);
        persistState();
        closeContextMenu();
        return;
      }

      // 3. For every other challenge with more than one badge: ask the user
      if (badgeList.length > 1) {
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
      if (!card.isReviewing) {
        card.isCompletedTodo = false;
      }
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
      isHighPriorityCard: (c) => isHighPriorityCard(c, challengesData.value),
      isTimeLimitedCard: (c) => isTimeLimitedCard(c, challengesData.value),
      isCardEditable: (c) => isCardEditable(c, challengesData.value),
      shouldShowCountPill: (c) => shouldShowCountPill(c, challengesData.value),
      getAniListStat,
      profile,
      displayBadges,
      filteredDisplayBadges,
      trackCards,
      filteredTrackCards,
      filteredHighPriorityCards,
      filteredTimeLimitedCards,
      filteredOtherCards,
      showTodoListSidebar,
      todoViewMode,
      todoMediaFilter,
      toggleTodoMediaFilter,
      currentTargetMediaType,
      getChallengeLink,
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