// Copyright © 2026 The Things Network Foundation, The Things Industries B.V.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Search page powered by Pagefind (https://pagefind.app). The index is a set of
// static files generated at build time, so search runs entirely in the browser.

const PAGE_SIZE = 10
const MAX_SUB_RESULTS = 3

const root = document.querySelector('.search-page')
const form = document.getElementById('search-form')
const input = document.getElementById('search-input')
const statusEl = document.getElementById('search-status')
const resultsEl = document.getElementById('search-results')
const filtersEl = document.getElementById('search-filters')
const moreButton = document.getElementById('search-more')

const state = {
  query: '',
  section: '',
  results: [],
  shown: 0,
  token: 0,
}

let pagefind = null
const baseTitle = document.title
const siteTitle = root.dataset.siteTitle || ''

function escapeHTML (value) {
  return String(value).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  })
}

function setStatus (text) {
  statusEl.textContent = text
}

async function loadPagefind () {
  if (pagefind) return pagefind
  try {
    pagefind = await import(root.dataset.pagefindUrl)
    await pagefind.options({ baseUrl: root.dataset.baseUrl, excerptLength: 24 })
    // Loading the filters first makes search results include per-section counts
    await pagefind.filters()
    return pagefind
  } catch (e) {
    setStatus('Search is not available right now. The search index has not been built for this site. Run "make search.index" when developing locally.')
    throw e
  }
}

function updateURL () {
  const params = new URLSearchParams()
  if (state.query) params.set('q', state.query)
  if (state.section) params.set('section', state.section)
  const qs = params.toString()
  history.replaceState(null, '', qs ? '?' + qs : location.pathname)
  document.title = state.query ? 'Search: ' + state.query + (siteTitle ? ' | ' + siteTitle : '') : baseTitle
}

function renderFilters (totalFilters, unfilteredCount) {
  const sections = (totalFilters && totalFilters.section) || {}
  const entries = Object.entries(sections).filter(function (e) { return e[1] > 0 })
  if (!state.query || entries.length === 0) {
    filtersEl.hidden = true
    filtersEl.innerHTML = ''
    return
  }
  entries.sort(function (a, b) { return b[1] - a[1] })
  const chip = function (value, label, count) {
    const pressed = state.section === value
    return '<button type="button" class="search-filter' + (pressed ? ' is-active' : '') + '" aria-pressed="' + pressed + '" data-section="' + escapeHTML(value) + '">' +
      escapeHTML(label) + ' <span class="search-filter__count">' + count + '</span></button>'
  }
  filtersEl.innerHTML = chip('', 'All', unfilteredCount) +
    entries.map(function (e) { return chip(e[0], e[0], e[1]) }).join('')
  filtersEl.hidden = false
}

function renderResult (data) {
  const section = data.filters && data.filters.section ? data.filters.section[0] : ''
  const subs = (data.sub_results || [])
    .filter(function (s) { return s.url !== data.url && s.title && s.title !== data.meta.title })
    .slice(0, MAX_SUB_RESULTS)
  const subList = subs.length
    ? '<ul class="search-result__subs">' + subs.map(function (s) {
      return '<li><a href="' + escapeHTML(s.url) + '">' + escapeHTML(s.title) + '</a></li>'
    }).join('') + '</ul>'
    : ''
  // Pagefind excerpts are HTML-escaped text with <mark> around matches.
  return '<li class="search-result">' +
    (section ? '<p class="search-result__section">' + escapeHTML(section) + '</p>' : '') +
    '<h2 class="search-result__title"><a href="' + escapeHTML(data.url) + '">' + escapeHTML(data.meta.title || data.url) + '</a></h2>' +
    '<p class="search-result__excerpt">' + data.excerpt + '</p>' +
    subList +
    '</li>'
}

async function showMore () {
  const token = state.token
  const next = state.results.slice(state.shown, state.shown + PAGE_SIZE)
  const data = []
  for (const r of next) {
    data.push(await r.data())
  }
  if (token !== state.token) return
  resultsEl.insertAdjacentHTML('beforeend', data.map(renderResult).join(''))
  state.shown += next.length
  moreButton.hidden = state.shown >= state.results.length
}

async function runSearch () {
  const token = ++state.token
  updateURL()
  if (!state.query) {
    resultsEl.innerHTML = ''
    filtersEl.hidden = true
    moreButton.hidden = true
    setStatus('')
    return
  }
  const pf = await loadPagefind()
  const filters = state.section ? { section: state.section } : {}
  const search = await pf.search(state.query, { filters: filters })
  if (token !== state.token || !search) return

  state.results = search.results
  state.shown = 0
  resultsEl.innerHTML = ''
  renderFilters(search.totalFilters, search.unfilteredResultCount)

  const count = search.results.length
  if (count === 0 && state.section && search.unfilteredResultCount === 0) {
    // Nothing matches in any section: drop the section filter
    state.section = ''
    updateURL()
  }
  if (count === 0) {
    setStatus('No results for "' + state.query + '"' + (state.section ? ' in ' + state.section : '') + '. Try a different or shorter search term.')
    moreButton.hidden = true
    return
  }
  setStatus(count + (count === 1 ? ' result' : ' results') + ' for "' + state.query + '"' + (state.section ? ' in ' + state.section : '') + '.')
  await showMore()
}

let debounceTimer = null
function scheduleSearch () {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(runSearch, 200)
}

input.addEventListener('input', function () {
  state.query = input.value.trim()
  scheduleSearch()
})

form.addEventListener('submit', function (e) {
  e.preventDefault()
  state.query = input.value.trim()
  clearTimeout(debounceTimer)
  runSearch()
})

filtersEl.addEventListener('click', function (e) {
  const button = e.target.closest('button[data-section]')
  if (!button) return
  state.section = button.dataset.section
  runSearch().then(function () {
    const active = filtersEl.querySelector('[data-section="' + CSS.escape(state.section) + '"]')
    if (active) active.focus()
  })
})

moreButton.addEventListener('click', function () {
  const firstNew = state.shown
  showMore().then(function () {
    const link = resultsEl.children[firstNew] && resultsEl.children[firstNew].querySelector('a')
    if (link) link.focus()
  })
})

// Initial state from the URL (?q=...&section=...), e.g. from the navigation field
const params = new URLSearchParams(location.search)
state.query = (params.get('q') || '').trim()
state.section = params.get('section') || ''
input.value = state.query
if (state.query) {
  runSearch()
} else {
  loadPagefind().catch(function () {})
}
