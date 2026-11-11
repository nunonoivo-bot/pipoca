const API_BASE = '/api';

let tvPrograms = [];
let streamingTitles = [];
let currentTab = 'tv';
let timeFilter = 'all-time';
let typeFilter = 'all-type';
let sortMode = 'sort-time';
let platformFilter = 'all-platform';
let currentSearch = '';

function loadUserData() {
    try { return JSON.parse(localStorage.getItem('pipoca_userdata') || '{}'); } catch { return {}; }
}
function saveUserData(data) {
    try { localStorage.setItem('pipoca_userdata', JSON.stringify(data)); } catch {}
}
function itemKey(item) { return `${item.source || item.category}:${item.title}`; }
function getUserStatus(item) { return loadUserData()[itemKey(item)] || null; }
function setUserStatus(item, status) {
    const data = loadUserData();
    const key = itemKey(item);
    if (status && data[key] !== status) data[key] = status;
    else if (!status || data[key] === status) delete data[key];
    else data[key] = status;
    saveUserData(data);
}
function toggleStatus(item, status) {
    const current = getUserStatus(item);
    setUserStatus(item, current === status ? null : status);
}

function formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('pt-PT', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
}

function timeFromISO(s) {
    return s ? (s.match(/T(\d{2}:\d{2})/) || [])[1] || '' : '';
}

function isNowPlaying(p) {
    const now = new Date();
    return new Date(p.start) <= now && new Date(p.end) > now;
}

function isTonight(p) {
    const h = new Date(p.start).getHours();
    return h >= 20 || h < 2;
}

function isUpcoming(p) {
    return new Date(p.end) > new Date();
}

function escapeHtml(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

function ratingClass(r) {
    if (r >= 8) return 'high';
    if (r >= 6) return 'medium';
    return 'low';
}

// ---- TV Rendering ----

function renderTV(items) {
    const grid = document.getElementById('grid');
    const empty = document.getElementById('empty');
    if (!items.length) { grid.innerHTML = ''; empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');

    grid.innerHTML = items.map((item, i) => {
        const time = timeFromISO(item.start);
        const endTime = timeFromISO(item.end);
        const now = isNowPlaying(item);
        const cat = item.category === 'movie' ? 'Filme' : 'Série';
        const ep = item.season && item.episode
            ? `S${String(item.season).padStart(2,'0')}E${String(item.episode).padStart(2,'0')}`
            : item.episode ? `Ep. ${item.episode}` : '';
        const imdb = item.imdb ? `★ ${item.imdb.toFixed(1)}` : '';
        const rc = item.imdb ? ratingClass(item.imdb) : '';

        const us = getUserStatus(item);
        const usBadge = us === 'watchlist' ? '<div class="card-user-badge watchlist">♡</div>'
            : us === 'watched' ? '<div class="card-user-badge watched">✓</div>' : '';

        return `
            <div class="card ${now ? 'now-playing' : ''}" data-idx="${i}" data-src="tv">
                <div class="card-image-wrap">
                    <img class="card-poster" src="${item.image}" alt="${escapeHtml(item.title)}" loading="lazy"
                         onerror="this.parentElement.innerHTML='<div class=card-no-poster>🎬</div>'">
                    ${now ? '<div class="card-live">A DAR AGORA</div>' : ''}
                    ${imdb ? `<div class="card-rating ${rc}" ${now ? 'style="top:32px"' : ''}>${imdb}</div>` : ''}
                    <div class="card-type ${item.category}">${cat}</div>
                    <div class="card-time-badge">${time}</div>
                    ${usBadge}
                </div>
                <div class="card-info">
                    <div class="card-title">${escapeHtml(item.title)}</div>
                    <div class="card-meta">
                        <span class="card-channel">${escapeHtml(item.channel)}</span>
                        <span class="card-timerange">${time} — ${endTime}</span>
                    </div>
                    ${ep ? `<div class="card-episode">${ep}</div>` : ''}
                </div>
            </div>`;
    }).join('');

    grid.querySelectorAll('.card').forEach(card => {
        card.addEventListener('click', () => openTVModal(items[+card.dataset.idx]));
    });
}

// ---- Streaming Rendering ----

function renderStreaming(items) {
    const grid = document.getElementById('grid');
    const empty = document.getElementById('empty');
    if (!items.length) { grid.innerHTML = ''; empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');

    grid.innerHTML = items.map((item, i) => {
        const cat = item.category === 'movie' ? 'Filme' : 'Série';
        const imdb = item.imdb ? `★ ${item.imdb.toFixed(1)}` : '';
        const rc = item.imdb ? ratingClass(item.imdb) : '';
        const plats = (item.platforms || []).join(' · ');

        const us = getUserStatus(item);
        const usBadge = us === 'watchlist' ? '<div class="card-user-badge watchlist">♡</div>'
            : us === 'watched' ? '<div class="card-user-badge watched">✓</div>' : '';

        return `
            <div class="card" data-idx="${i}" data-src="streaming">
                <div class="card-image-wrap poster-ratio">
                    <img class="card-poster" src="${item.image}" alt="${escapeHtml(item.title)}" loading="lazy"
                         onerror="this.parentElement.innerHTML='<div class=card-no-poster>🎬</div>'">
                    ${imdb ? `<div class="card-rating ${rc}">${imdb}</div>` : ''}
                    <div class="card-type ${item.category}">${cat}</div>
                    ${usBadge}
                    <div class="card-overlay">
                        <div class="card-title">${escapeHtml(item.title)}</div>
                        <div class="card-meta">
                            ${item.year ? `<span class="card-year">${item.year}</span>` : ''}
                            ${plats ? `<span class="card-platforms">${escapeHtml(plats)}</span>` : ''}
                        </div>
                        ${item.tomato ? `<div class="card-tomato">🍅 ${item.tomato}%</div>` : ''}
                    </div>
                </div>
            </div>`;
    }).join('');

    grid.querySelectorAll('.card').forEach(card => {
        card.addEventListener('click', () => openStreamModal(items[+card.dataset.idx]));
    });
}

// ---- Modals ----

function openTVModal(item) {
    const modal = document.getElementById('modal');
    const body = document.getElementById('modal-body');
    modal.classList.remove('hidden');
    const time = timeFromISO(item.start);
    const endTime = timeFromISO(item.end);
    const now = isNowPlaying(item);
    const cat = item.category === 'movie' ? 'Filme' : 'Série';
    const ep = item.season && item.episode
        ? `Temporada ${item.season}, Episódio ${item.episode}`
        : item.episode ? `Episódio ${item.episode}` : '';
    const imdb = item.imdb ? `★ ${item.imdb.toFixed(1)}` : '';
    const rc = item.imdb ? ratingClass(item.imdb) : '';

    body.innerHTML = `
        <div class="modal-hero">
            <img class="modal-backdrop-img" src="${item.image}" alt="" onerror="this.style.display='none'">
        </div>
        <div class="modal-body-content">
            <h2 class="modal-title">${escapeHtml(item.title)}</h2>
            <div class="modal-meta-tags">
                <span class="meta-tag cat-${item.category}">${cat}</span>
                <span class="meta-tag channel">${escapeHtml(item.channel)}</span>
                <span class="meta-tag">${time} — ${endTime}</span>
                ${now ? '<span class="meta-tag live">A DAR AGORA</span>' : ''}
            </div>
            ${imdb ? `<div class="modal-rating-row"><div class="modal-rating-big ${rc}">${imdb}</div></div>` : ''}
            ${ep ? `<div class="modal-episode">${ep}</div>` : ''}
            ${item.synopsis ? `<p class="modal-overview">${escapeHtml(item.synopsis)}</p>` : ''}
            ${renderUserActions(item)}
        </div>`;
    bindUserActions(item);
}

function openStreamModal(item) {
    const modal = document.getElementById('modal');
    const body = document.getElementById('modal-body');
    modal.classList.remove('hidden');
    const cat = item.category === 'movie' ? 'Filme' : 'Série';
    const imdb = item.imdb ? `★ ${item.imdb.toFixed(1)}` : 'Sem rating';
    const rc = item.imdb ? ratingClass(item.imdb) : '';
    const plats = (item.platforms || []).map(p =>
        `<span class="platform-badge">${escapeHtml(p)}</span>`
    ).join('');

    body.innerHTML = `
        <div class="modal-hero">
            <img class="modal-backdrop-img poster-fit" src="${item.image}" alt="" onerror="this.style.display='none'">
        </div>
        <div class="modal-body-content">
            <h2 class="modal-title">${escapeHtml(item.title)}</h2>
            <div class="modal-meta-tags">
                <span class="meta-tag cat-${item.category}">${cat}</span>
                ${item.year ? `<span class="meta-tag">${item.year}</span>` : ''}
            </div>
            <div class="modal-rating-row">
                <div class="modal-rating-big ${rc}">${imdb}</div>
                ${item.tomato ? `<div class="modal-tomato">🍅 ${item.tomato}%</div>` : ''}
            </div>
            ${plats ? `<div class="modal-platforms">${plats}</div>` : ''}
            ${item.synopsis ? `<p class="modal-overview">${escapeHtml(item.synopsis)}</p>` : ''}
            ${renderUserActions(item)}
        </div>`;
    bindUserActions(item);
}

function renderUserActions(item) {
    const status = getUserStatus(item);
    return `<div class="modal-actions">
        <button class="action-btn ${status === 'watchlist' ? 'active' : ''}" data-action="watchlist">
            ${status === 'watchlist' ? '♥' : '♡'} Para ver
        </button>
        <button class="action-btn ${status === 'watched' ? 'active' : ''}" data-action="watched">
            ${status === 'watched' ? '✓' : '○'} Já vi
        </button>
    </div>`;
}

function bindUserActions(item) {
    document.querySelectorAll('.action-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleStatus(item, btn.dataset.action);
            const container = btn.closest('.modal-actions');
            container.outerHTML = renderUserActions(item);
            bindUserActions(item);
            applyFiltersAndSort();
        });
    });
}

function closeModal() {
    document.getElementById('modal').classList.add('hidden');
}

// ---- Stats ----

function renderStats(items, type) {
    const stats = document.getElementById('stats');
    const movies = items.filter(i => i.category === 'movie').length;
    const series = items.filter(i => i.category === 'series').length;

    let extra = '';
    if (type === 'tv') {
        const now = items.filter(isNowPlaying).length;
        extra = now > 0 ? `<span class="stat-sep">·</span><span class="stat-live">${now} a dar agora</span>` : '';
    } else {
        const withImdb = items.filter(i => i.imdb).length;
        extra = `<span class="stat-sep">·</span><span>${withImdb} com rating IMDB</span>`;
    }

    stats.innerHTML = `
        <span>${items.length} títulos</span>
        <span class="stat-sep">·</span>
        <span>${movies} filmes</span>
        <span class="stat-sep">·</span>
        <span>${series} séries</span>
        ${extra}
    `;
    stats.classList.remove('hidden');
}

// ---- Filter & Render ----

function getFilteredItems() {
    let items;
    if (currentTab === 'mylist') {
        const data = loadUserData();
        const allItems = [...tvPrograms, ...streamingTitles];
        const statusFilter = typeFilter === 'watched' ? 'watched' : typeFilter === 'watchlist' ? 'watchlist' : null;
        items = allItems.filter(i => {
            const s = data[itemKey(i)];
            return statusFilter ? s === statusFilter : (s === 'watchlist' || s === 'watched');
        });
    } else if (currentTab === 'tv') {
        items = [...tvPrograms].filter(isUpcoming);
        if (timeFilter === 'now') items = items.filter(isNowPlaying);
        else if (timeFilter === 'tonight') items = items.filter(isTonight);
    } else {
        items = [...streamingTitles];
    }

    if (currentTab !== 'mylist') {
        if (typeFilter === 'movies') items = items.filter(i => i.category === 'movie');
        else if (typeFilter === 'series') items = items.filter(i => i.category === 'series');
    }

    if (platformFilter !== 'all-platform') {
        items = items.filter(i => (i.platforms || []).includes(platformFilter));
    }

    if (currentSearch) {
        const q = currentSearch.toLowerCase();
        items = items.filter(i =>
            i.title.toLowerCase().includes(q) ||
            (i.channel || '').toLowerCase().includes(q) ||
            (i.synopsis || '').toLowerCase().includes(q) ||
            (i.platforms || []).some(p => p.toLowerCase().includes(q))
        );
    }

    if (sortMode === 'sort-rating') {
        items.sort((a, b) => (b.imdb || 0) - (a.imdb || 0));
    } else if (sortMode === 'sort-alpha') {
        items.sort((a, b) => a.title.localeCompare(b.title, 'pt'));
    }

    return items;
}

function applyFiltersAndSort() {
    const items = getFilteredItems();
    document.querySelector('#empty p').textContent = 'Nenhum resultado encontrado.';
    renderStats(items, currentTab);
    if (currentTab === 'mylist') renderMyList(items);
    else if (currentTab === 'tv') renderTV(items);
    else renderStreaming(items);
}

function renderMyList(items) {
    const grid = document.getElementById('grid');
    const empty = document.getElementById('empty');
    if (!items.length) {
        grid.innerHTML = '';
        empty.classList.remove('hidden');
        empty.querySelector('p').textContent = 'A tua lista está vazia. Abre um filme ou série e toca em "Para ver" ou "Já vi".';
        return;
    }
    empty.classList.add('hidden');

    const tvItems = items.filter(i => i.source === 'tv');
    const streamItems = items.filter(i => i.source === 'streaming');
    grid.classList.remove('poster-grid');

    let html = '';
    if (streamItems.length) {
        grid.classList.add('poster-grid');
    }

    html = items.map((item, i) => {
        const us = getUserStatus(item);
        const usBadge = us === 'watchlist' ? '<div class="card-user-badge watchlist">♡</div>'
            : us === 'watched' ? '<div class="card-user-badge watched">✓</div>' : '';

        if (item.source === 'streaming') {
            const cat = item.category === 'movie' ? 'Filme' : 'Série';
            const imdb = item.imdb ? `★ ${item.imdb.toFixed(1)}` : '';
            const rc = item.imdb ? ratingClass(item.imdb) : '';
            const plats = (item.platforms || []).join(' · ');
            return `
                <div class="card" data-idx="${i}" data-src="streaming">
                    <div class="card-image-wrap poster-ratio">
                        <img class="card-poster" src="${item.image}" alt="${escapeHtml(item.title)}" loading="lazy"
                             onerror="this.parentElement.innerHTML='<div class=card-no-poster>🎬</div>'">
                        ${imdb ? `<div class="card-rating ${rc}">${imdb}</div>` : ''}
                        <div class="card-type ${item.category}">${cat}</div>
                        ${usBadge}
                        <div class="card-overlay">
                            <div class="card-title">${escapeHtml(item.title)}</div>
                            <div class="card-meta">
                                ${item.year ? `<span class="card-year">${item.year}</span>` : ''}
                                ${plats ? `<span class="card-platforms">${escapeHtml(plats)}</span>` : ''}
                            </div>
                        </div>
                    </div>
                </div>`;
        } else {
            const time = timeFromISO(item.start);
            const endTime = timeFromISO(item.end);
            const cat = item.category === 'movie' ? 'Filme' : 'Série';
            const imdb = item.imdb ? `★ ${item.imdb.toFixed(1)}` : '';
            const rc = item.imdb ? ratingClass(item.imdb) : '';
            return `
                <div class="card" data-idx="${i}" data-src="tv">
                    <div class="card-image-wrap">
                        <img class="card-poster" src="${item.image}" alt="${escapeHtml(item.title)}" loading="lazy"
                             onerror="this.parentElement.innerHTML='<div class=card-no-poster>🎬</div>'">
                        ${imdb ? `<div class="card-rating ${rc}">${imdb}</div>` : ''}
                        <div class="card-type ${item.category}">${cat}</div>
                        ${usBadge}
                    </div>
                    <div class="card-info">
                        <div class="card-title">${escapeHtml(item.title)}</div>
                        <div class="card-meta">
                            <span class="card-channel">${escapeHtml(item.channel)}</span>
                            <span class="card-timerange">${time} — ${endTime}</span>
                        </div>
                    </div>
                </div>`;
        }
    }).join('');

    grid.innerHTML = html;
    grid.querySelectorAll('.card').forEach(card => {
        card.addEventListener('click', () => {
            const item = items[+card.dataset.idx];
            if (card.dataset.src === 'streaming') openStreamModal(item);
            else openTVModal(item);
        });
    });
}

// ---- Tab switching ----

function setTab(tab) {
    currentTab = tab;
    timeFilter = 'all-time';
    typeFilter = tab === 'mylist' ? 'all-list' : 'all-type';
    sortMode = tab === 'tv' ? 'sort-time' : 'sort-rating';
    platformFilter = 'all-platform';
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));

    const tvFilters = document.getElementById('tv-filters');
    const streamFilters = document.getElementById('stream-filters');
    const mylistFilters = document.getElementById('mylist-filters');
    tvFilters.classList.toggle('hidden', tab !== 'tv');
    streamFilters.classList.toggle('hidden', tab !== 'streaming');
    mylistFilters.classList.toggle('hidden', tab !== 'mylist');

    document.querySelectorAll('.filter-btn').forEach(b => {
        b.classList.remove('active');
    });
    if (tab === 'mylist') {
        document.querySelector('#mylist-filters [data-filter="all-list"]').classList.add('active');
        document.querySelector('#mylist-filters [data-filter="sort-rating"]').classList.add('active');
    } else if (tab === 'tv') {
        document.querySelector('#tv-filters [data-filter="all-time"]').classList.add('active');
        document.querySelector('#tv-filters [data-filter="all-type"]').classList.add('active');
        document.querySelector('#tv-filters [data-filter="sort-time"]').classList.add('active');
    } else {
        document.querySelector('#stream-filters [data-filter="all-type"]').classList.add('active');
        document.querySelector('#stream-filters [data-filter="all-platform"]').classList.add('active');
        document.querySelector('#stream-filters [data-filter="sort-rating"]').classList.add('active');
    }

    document.getElementById('grid').classList.toggle('poster-grid', tab === 'streaming');

    applyFiltersAndSort();
}

// ---- Load ----

async function loadAll() {
    const loading = document.getElementById('loading');
    const dateDisplay = document.getElementById('date-display');
    const today = new Date().toISOString().slice(0, 10);
    dateDisplay.textContent = formatDate(today);

    try {
        const res = await fetch(`${API_BASE}/all?date=${today}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        tvPrograms = data.tv?.programs || [];
        streamingTitles = data.streaming?.titles || [];

        loading.classList.add('hidden');
        applyFiltersAndSort();
    } catch (err) {
        loading.innerHTML = `
            <p style="color:var(--rating-red);">Não foi possível carregar.</p>
            <p style="color:var(--text-muted);font-size:13px;margin-top:8px;">
                Verifica que o servidor está a correr:<br>
                <code style="color:var(--accent);">python3 server.py</code>
            </p>`;
    }
}

// ---- Events ----

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => setTab(btn.dataset.tab));
    });

    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const row = btn.closest('.filter-row');
            row.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const group = row.dataset.group;
            if (group === 'time') timeFilter = btn.dataset.filter;
            else if (group === 'sort') sortMode = btn.dataset.filter;
            else if (group === 'platform') platformFilter = btn.dataset.filter;
            else typeFilter = btn.dataset.filter;
            applyFiltersAndSort();
        });
    });

    let timer;
    document.getElementById('search').addEventListener('input', (e) => {
        clearTimeout(timer);
        timer = setTimeout(() => { currentSearch = e.target.value.trim(); applyFiltersAndSort(); }, 250);
    });

    document.querySelector('.modal-backdrop').addEventListener('click', closeModal);
    document.querySelector('.modal-close').addEventListener('click', closeModal);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

    loadAll();
});
