/* 分类、更新日历和电台共用这个入口；页面换掉后只重建页面内的组件。 */
(function () {
  'use strict'
  var dataPromise = null
  var home = null
  var musicPlayer = null
  var musicWrapper = null
  var musicLoading = null
  var playlist = null
  var drawer = null
  var parking = null
  var run = 0
  var githubCache = null
  var githubRequest = null

  function data () {
    if (!dataPromise) {
      dataPromise = fetch('/blog-ui-data.json').then(function (response) {
        if (!response.ok) throw new Error('文章数据不可用')
        return response.json()
      }).catch(function (error) { dataPromise = null; throw error })
    }
    return dataPromise
  }

  function element (tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }

  /* ---------------------- 首页分类 ---------------------- */
  function postCard (post, index) {
    var card = element('div', 'recent-post-item lks-filter-card')
    if (post.cover) {
      var cover = element('div', 'post_cover ' + (index % 2 ? 'right' : 'left'))
      var coverLink = element('a')
      coverLink.href = post.url
      var img = element('img', 'post-bg')
      img.src = post.cover
      img.alt = post.title
      img.loading = 'lazy'
      img.decoding = 'async'
      img.onerror = function () { img.onerror = null; img.src = '/img/404.jpg' }
      coverLink.appendChild(img)
      cover.appendChild(coverLink)
      card.appendChild(cover)
    }
    var info = element('div', 'recent-post-info' + (post.cover ? '' : ' no-cover'))
    var title = element('a', 'article-title', post.title)
    title.href = post.url
    var meta = element('div', 'article-meta-wrap')
    var date = element('time', '', post.date)
    date.dateTime = post.date
    meta.appendChild(date)
    post.categories.forEach(function (category) { meta.appendChild(element('span', 'lks-card-category', category)) })
    info.appendChild(title)
    info.appendChild(meta)
    info.appendChild(element('div', 'content', post.summary))
    card.appendChild(info)
    return card
  }

  function filterHome (payload) {
    if (!home || !home.root.isConnected) return
    var category = new URLSearchParams(location.search).get('category') || ''
    var items = home.root.querySelector('.recent-post-items')
    var pagination = home.root.querySelector('#pagination')
    var status = home.root.querySelector('.lks-filter-status')
    home.root.querySelectorAll('[data-category]').forEach(function (link) {
      var selected = link.dataset.category === category
      link.classList.toggle('is-active', selected)
      if (selected) link.setAttribute('aria-current', 'true')
      else link.removeAttribute('aria-current')
    })
    items.replaceChildren()
    status.replaceChildren()
    status.hidden = !category
    if (pagination) pagination.hidden = !!category
    if (!category) {
      home.original.forEach(function (node) { items.appendChild(node) })
    } else {
      var posts = payload.posts.filter(function (post) { return post.categories.indexOf(category) !== -1 })
      status.appendChild(element('span', '', category + ' · ' + posts.length + ' 篇文章'))
      var clear = element('button', 'lks-filter-clear', '查看全部')
      clear.type = 'button'
      clear.dataset.clearCategory = 'true'
      status.appendChild(clear)
      posts.forEach(function (post, index) { items.appendChild(postCard(post, index)) })
      if (!posts.length) items.appendChild(element('p', 'lks-filter-empty', '这个分类暂时没有文章。'))
    }
    if (window.pjax) window.pjax.refresh(items)
  }

  function selectCategory (category) {
    var url = new URL(location.href)
    if (category) url.searchParams.set('category', category)
    else url.searchParams.delete('category')
    history.pushState({}, '', url.pathname + url.search + url.hash)
    data().then(filterHome).catch(function () { location.href = category ? '/categories/' : '/' })
  }

  document.addEventListener('click', function (event) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    var link = event.target.closest('.lks-category-bar [data-category]')
    if (link) {
      event.preventDefault()
      event.stopPropagation()
      selectCategory(link.dataset.category)
    }
    if (event.target.closest('[data-clear-category]')) selectCategory('')
  }, true)
  window.addEventListener('popstate', function () { if (home) data().then(filterHome).catch(function () {}) })

  /* ---------------------- 日历与热力图 ---------------------- */
  function today () { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date()) }
  function dayKey (date) { return date.toISOString().slice(0, 10) }
  function utcDate (key) { return new Date(key + 'T00:00:00Z') }

  function heatmapStart (now) {
    var end = utcDate(now)
    var start = new Date(end)
    start.setUTCDate(end.getUTCDate() - (end.getUTCDay() + 6) % 7 - 15 * 7)
    return start
  }

  function githubRows (rows) {
    if (!Array.isArray(rows)) throw new Error('GitHub 贡献数据不可用')
    var valid = rows.filter(function (row) {
      if (!row || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) return false
      var date = utcDate(row.date)
      return !isNaN(date.getTime()) && dayKey(date) === row.date && Number.isInteger(row.count) && row.count >= 0 && Number.isInteger(row.level) && row.level >= 0 && row.level <= 4
    }).map(function (row) { return { date: row.date, count: row.count, level: row.level } })
    if (!valid.length) throw new Error('GitHub 没有返回贡献日历')
    return valid
  }

  function githubData (user) {
    var now = Date.now()
    var day = today()
    var key = 'lks-github-heatmap-' + user
    var fresh = function (cached) { return cached && cached.user === user && cached.day === day && cached.at <= now && now - cached.at < 3600000 }
    if (fresh(githubCache)) return Promise.resolve(githubCache.rows)
    try {
      var cached = JSON.parse(localStorage.getItem(key) || 'null')
      if (fresh(cached)) {
        cached.rows = githubRows(cached.rows)
        githubCache = cached
        return Promise.resolve(cached.rows)
      }
    } catch (e) {}
    if (githubRequest && githubRequest.user === user) return githubRequest.promise
    var controller = new AbortController()
    var timeout = setTimeout(function () { controller.abort() }, 8000)
    var promise = fetch('https://github-contributions-api.jogruber.de/v4/' + encodeURIComponent(user) + '?y=last', { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
      .then(function (response) { if (!response.ok) throw new Error('GitHub 贡献服务暂时不可用'); return response.json() })
      .then(function (payload) {
        var rows = githubRows(payload.contributions)
        githubCache = { user: user, day: day, at: Date.now(), rows: rows }
        try { localStorage.setItem(key, JSON.stringify(githubCache)) } catch (e) {}
        return rows
      }).finally(function () { clearTimeout(timeout); if (githubRequest && githubRequest.promise === promise) githubRequest = null })
    githubRequest = { user: user, promise: promise }
    return promise
  }

  function renderGithub (card, rows) {
    var calendar = card.lksCalendar
    var counts = Object.create(null)
    rows.forEach(function (row) { counts[row.date] = row })
    calendar.github = counts
    var start = heatmapStart(calendar.today)
    var heatmap = card.querySelector('.lks-github-heatmap')
    heatmap.replaceChildren()
    var total = 0
    for (var index = 0; index < 112; index++) {
      var date = new Date(start)
      date.setUTCDate(start.getUTCDate() + index)
      var key = dayKey(date)
      var row = counts[key] || { count: 0, level: 0 }
      var future = key > calendar.today
      if (!future) total += row.count
      var cell = element('button')
      cell.type = 'button'
      cell.dataset.githubDate = key
      cell.dataset.level = row.level
      cell.disabled = future
      cell.classList.toggle('is-future', future)
      cell.setAttribute('aria-label', key + '，' + row.count + ' 次 GitHub 贡献')
      cell.title = cell.getAttribute('aria-label')
      heatmap.appendChild(cell)
    }
    card.querySelector('#lks-github-heatmap-panel .lks-heatmap-label').textContent = '最近 16 周 · ' + total + ' 次贡献'
    card.querySelector('.lks-github-status').replaceChildren()
  }

  function loadGithub (card) {
    if (card.lksCalendar.github || card.lksGithubLoading) return
    var panel = card.querySelector('#lks-github-heatmap-panel')
    var status = card.querySelector('.lks-github-status')
    status.replaceChildren(element('p', '', '正在读取 GitHub 贡献…'))
    panel.setAttribute('aria-busy', 'true')
    card.lksGithubLoading = true
    githubData(card.dataset.githubUser).then(function (rows) {
      if (card.isConnected) renderGithub(card, rows)
    }).catch(function () {
      if (!card.isConnected) return
      status.replaceChildren(element('p', '', 'GitHub 暂时没连上，博客记录仍可查看。'))
      var retry = element('button', 'lks-recent-retry', '重新加载')
      retry.type = 'button'
      retry.dataset.githubRetry = 'true'
      status.appendChild(retry)
    }).finally(function () { card.lksGithubLoading = false; panel.removeAttribute('aria-busy') })
  }

  function selectHeatmap (card, source, focus) {
    card.querySelectorAll('[data-heatmap-source]').forEach(function (tab) {
      var active = tab.dataset.heatmapSource === source
      tab.setAttribute('aria-selected', String(active))
      tab.tabIndex = active ? 0 : -1
      card.querySelector('#' + tab.getAttribute('aria-controls')).hidden = !active
      if (active && focus) tab.focus()
    })
    if (source === 'github') loadGithub(card)
  }

  function selectGithubDay (card, key) {
    var count = (card.lksCalendar.github[key] || {}).count || 0
    var detail = card.querySelector('.lks-github-detail')
    detail.replaceChildren(element('span', '', key + ' · ' + count + ' 次贡献'))
    var link = element('a', '', '查看 GitHub 当月活动 ↗')
    var date = utcDate(key)
    var last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0))
    link.href = 'https://github.com/' + encodeURIComponent(card.dataset.githubUser) + '?tab=overview&from=' + key.slice(0, 7) + '-01&to=' + dayKey(last)
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    detail.appendChild(link)
    card.querySelectorAll('[data-github-date]').forEach(function (cell) { cell.classList.toggle('is-selected', cell.dataset.githubDate === key) })
  }

  function selectDay (card, key) {
    var calendar = card.lksCalendar
    calendar.selected = key
    calendar.month = key.slice(0, 7)
    renderCalendar(card)
    var detail = card.querySelector('.lks-calendar-detail')
    detail.replaceChildren(element('strong', '', key + ' · ' + calendar.activity[key].length + ' 条记录'))
    calendar.activity[key].forEach(function (post) {
      var link = element('a', '', post.kind + ' · ' + post.title)
      link.href = post.url
      detail.appendChild(link)
    })
    if (window.pjax) window.pjax.refresh(detail)
  }

  function renderCalendar (card) {
    var calendar = card.lksCalendar
    var month = calendar.month
    var first = utcDate(month + '-01')
    var offset = (first.getUTCDay() + 6) % 7
    var count = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
    card.querySelector('.lks-calendar-month').textContent = first.getUTCFullYear() + ' 年 ' + (first.getUTCMonth() + 1) + ' 月'
    card.querySelector('[data-month-step="1"]').disabled = month >= calendar.today.slice(0, 7)
    card.querySelector('[data-month-step="-1"]').disabled = month <= calendar.firstMonth
    var days = card.querySelector('.lks-calendar-days')
    days.replaceChildren()
    for (var blank = 0; blank < offset; blank++) days.appendChild(element('span'))
    for (var day = 1; day <= count; day++) {
      var key = month + '-' + String(day).padStart(2, '0')
      var activity = calendar.activity[key] || []
      var button = element('button', '', day)
      button.type = 'button'
      button.dataset.activityDate = key
      button.disabled = !activity.length || key > calendar.today
      button.classList.toggle('has-activity', activity.length > 0)
      button.classList.toggle('is-today', key === calendar.today)
      button.classList.toggle('is-selected', key === calendar.selected)
      button.setAttribute('aria-label', key + '，' + (activity.length ? activity.length + ' 条发布或更新' : '没有更新'))
      button.title = button.getAttribute('aria-label')
      days.appendChild(button)
    }
    card.querySelectorAll('.lks-heatmap [data-activity-date]').forEach(function (cell) {
      cell.classList.toggle('is-selected', cell.dataset.activityDate === calendar.selected)
    })
  }

  function initCalendar (card, payload) {
    var now = today()
    var keys = Object.keys(payload.activity).sort()
    card.lksCalendar = { today: now, month: now.slice(0, 7), firstMonth: keys.length ? keys[0].slice(0, 7) : now.slice(0, 7), activity: payload.activity, selected: '' }
    var start = heatmapStart(now)
    var heatmap = card.querySelector('.lks-blog-heatmap')
    heatmap.replaceChildren()
    for (var index = 0; index < 112; index++) {
      var date = new Date(start)
      date.setUTCDate(start.getUTCDate() + index)
      var key = dayKey(date)
      var count = (payload.activity[key] || []).length
      var cell = element('button')
      cell.type = 'button'
      cell.dataset.activityDate = key
      cell.dataset.level = Math.min(count, 3)
      cell.disabled = !count || key > now
      cell.classList.toggle('is-future', key > now)
      cell.setAttribute('aria-label', key + '，' + count + ' 条发布或更新')
      cell.title = cell.getAttribute('aria-label')
      heatmap.appendChild(cell)
    }
    renderCalendar(card)
    selectHeatmap(card, 'blog', false)
    card.addEventListener('click', function (event) {
      var tab = event.target.closest('[data-heatmap-source]')
      if (tab) selectHeatmap(card, tab.dataset.heatmapSource, false)
      if (event.target.closest('[data-github-retry]')) loadGithub(card)
      var githubDay = event.target.closest('[data-github-date]')
      if (githubDay && !githubDay.disabled) selectGithubDay(card, githubDay.dataset.githubDate)
      var step = event.target.closest('[data-month-step]')
      if (step) {
        var month = utcDate(card.lksCalendar.month + '-01')
        month.setUTCMonth(month.getUTCMonth() + Number(step.dataset.monthStep))
        card.lksCalendar.month = dayKey(month).slice(0, 7)
        renderCalendar(card)
      }
      var day = event.target.closest('[data-activity-date]')
      if (day && !day.disabled) selectDay(card, day.dataset.activityDate)
    })
    card.addEventListener('keydown', function (event) {
      var tab = event.target.closest('[data-heatmap-source]')
      if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      var source = event.key === 'Home' ? 'blog' : event.key === 'End' ? 'github' : tab.dataset.heatmapSource === 'blog' ? 'github' : 'blog'
      selectHeatmap(card, source, true)
    })
  }

  /* ---------------------- 持续播放的侧栏电台 ---------------------- */
  function initMusicShell () {
    if (!parking) {
      parking = element('div')
      parking.id = 'lks-music-parking'
      parking.hidden = true
      document.body.appendChild(parking)
    }
    if (!drawer) {
      drawer = element('section', 'lks-music-drawer')
      drawer.id = 'lks-music-drawer'
      drawer.hidden = true
      drawer.setAttribute('aria-label', '摸鱼电台')
      var header = element('div', 'lks-music-drawer-head')
      header.appendChild(element('strong', '', '摸鱼电台'))
      var close = element('button', '', '×')
      close.type = 'button'
      close.setAttribute('aria-label', '收起电台')
      close.addEventListener('click', function () { toggleMusic(false) })
      header.appendChild(close)
      drawer.appendChild(header)
      drawer.appendChild(element('div', 'lks-music-host'))
      document.body.appendChild(drawer)
    }
    syncMusicButton()
  }

  function syncMusicButton () {
    var button = document.getElementById('lks-music-toggle')
    if (button) button.setAttribute('aria-expanded', String(drawer && !drawer.hidden))
  }

  function musicDestination () {
    if (drawer && !drawer.hidden) return drawer.querySelector('.lks-music-host')
    if (window.innerWidth > 900) return document.querySelector('#aside-content .lks-music-host') || parking
    return parking
  }

  function mountMusic () {
    if (!musicWrapper) return
    var host = musicDestination()
    if (host && musicWrapper.parentNode !== host) {
      if (host === parking) host.appendChild(musicWrapper)
      else host.replaceChildren(musicWrapper)
    }
  }

  function safeHttp (url) {
    try { var parsed = new URL(url); return /^https?:$/.test(parsed.protocol) ? parsed.href : '' } catch (e) { return '' }
  }

  function loadPlaylist () {
    if (playlist) return Promise.resolve(playlist)
    var controller = new AbortController()
    var timeout = setTimeout(function () { controller.abort() }, 12000)
    return fetch('https://api.qijieya.cn/meting/?server=netease&type=playlist&id=5140818184', { signal: controller.signal })
      .then(function (response) { if (!response.ok) throw new Error('歌单服务暂时不可用'); return response.json() })
      .then(function (list) {
        if (!Array.isArray(list)) throw new Error('歌单没有返回歌曲')
        playlist = list.slice(0, 500).map(function (song) {
          return { name: String(song.name || '未命名歌曲'), artist: String(song.artist || ''), url: safeHttp(song.url), cover: safeHttp(song.pic || song.cover) }
        }).filter(function (song) { return song.url })
        if (!playlist.length) { playlist = null; throw new Error('歌单为空') }
        return playlist
      }).finally(function () { clearTimeout(timeout) })
  }

  function playerLibrary () {
    return new Promise(function (resolve, reject) {
      var attempts = 0
      function check () {
        var stylesheet = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).find(function (link) { return /aplayer.*\.css/i.test(link.href) })
        if (window.APlayer && stylesheet && stylesheet.sheet && stylesheet.media !== 'print') return resolve()
        if (++attempts >= 100) return reject(new Error('播放器没有加载成功'))
        setTimeout(check, 150)
      }
      check()
    })
  }

  function musicFailure () {
    document.querySelectorAll('.lks-music-host').forEach(function (host) {
      host.replaceChildren(element('p', 'lks-music-status', '歌单暂时没连上，稍后可以再试。'))
      var retry = element('button', 'lks-music-retry', '重新连接')
      retry.type = 'button'
      retry.addEventListener('click', ensureMusic)
      host.appendChild(retry)
    })
  }

  function ensureMusic () {
    if (musicPlayer) { mountMusic(); return Promise.resolve() }
    if (musicLoading) return musicLoading
    var host = musicDestination()
    if (host === parking) return Promise.resolve()
    host.replaceChildren(element('p', 'lks-music-status', '正在连接歌单…'))
    musicLoading = Promise.all([playerLibrary(), loadPlaylist()]).then(function (values) {
      var destination = musicDestination()
      if (destination === parking) return
      musicWrapper = element('div', 'lks-music-wrapper')
      var container = element('div')
      musicWrapper.appendChild(container)
      destination.replaceChildren(musicWrapper)
      musicPlayer = new APlayer({ container: container, audio: values[1], autoplay: false, preload: 'none', theme: '#49b1f5', volume: .6, listFolded: true, listMaxHeight: '220px', mutex: true })
      var controls = element('div', 'lks-music-controls')
      var specs = [['prev', '上一首', 'fa-step-backward'], ['toggle', '播放', 'fa-play'], ['next', '下一首', 'fa-step-forward'], ['list', '展开歌单', 'fa-list-ul']]
      specs.forEach(function (spec) {
        var button = element('button')
        button.type = 'button'
        button.dataset.musicAction = spec[0]
        button.setAttribute('aria-label', spec[1])
        button.title = spec[1]
        button.appendChild(element('i', 'fas ' + spec[2]))
        button.addEventListener('click', function () {
          if (spec[0] === 'prev') musicPlayer.skipBack()
          else if (spec[0] === 'next') musicPlayer.skipForward()
          else if (spec[0] === 'toggle') musicPlayer.toggle()
          else musicPlayer.list.toggle()
        })
        controls.appendChild(button)
      })
      musicWrapper.appendChild(controls)
      var sync = function () {
        var button = controls.querySelector('[data-music-action="toggle"]')
        button.setAttribute('aria-label', musicPlayer.paused ? '播放' : '暂停')
        button.title = button.getAttribute('aria-label')
        button.firstChild.className = 'fas ' + (musicPlayer.paused ? 'fa-play' : 'fa-pause')
      }
      musicPlayer.on('play', sync)
      musicPlayer.on('pause', sync)
    }).catch(function () { musicFailure() }).finally(function () { musicLoading = null })
    return musicLoading
  }

  function toggleMusic (open) {
    initMusicShell()
    drawer.hidden = open === undefined ? !drawer.hidden : !open
    syncMusicButton()
    mountMusic()
    if (!drawer.hidden) ensureMusic()
  }

  document.addEventListener('click', function (event) {
    var button = event.target.closest('#lks-music-toggle')
    if (button) toggleMusic()
    if (drawer && !drawer.hidden && !button && !drawer.contains(event.target)) toggleMusic(false)
  })
  document.addEventListener('keydown', function (event) {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.closest('#lks-music-toggle')) { event.preventDefault(); toggleMusic() }
    if (event.key === 'Escape' && drawer && !drawer.hidden) { toggleMusic(false); document.getElementById('lks-music-toggle')?.focus() }
  })
  document.addEventListener('pjax:send', function () { if (musicWrapper) parking.appendChild(musicWrapper) })
  window.addEventListener('resize', function () { mountMusic(); if (window.innerWidth > 900) ensureMusic() })

  /* ---------------------- 导航与初始化 ---------------------- */
  function selectRecentTab (card, selected, focus) {
    card.querySelectorAll('[role="tab"]').forEach(function (tab) {
      var active = tab === selected
      tab.setAttribute('aria-selected', String(active))
      tab.tabIndex = active ? 0 : -1
      card.querySelector('#' + tab.getAttribute('aria-controls')).hidden = !active
    })
    if (focus) selected.focus()
    try { sessionStorage.setItem('lks-recent-tab', selected.id) } catch (e) {}
  }
  function initRecent () {
    var card = document.querySelector('.lks-recent-card')
    if (!card || card.classList.contains('is-ready')) return
    var tabs = Array.from(card.querySelectorAll('[role="tab"]'))
    var saved
    try { saved = sessionStorage.getItem('lks-recent-tab') } catch (e) {}
    selectRecentTab(card, tabs.find(function (tab) { return tab.id === saved }) || tabs[0], false)
    card.classList.add('is-ready')
    card.addEventListener('click', function (event) {
      var tab = event.target.closest('[role="tab"]')
      if (tab) selectRecentTab(card, tab, false)
    })
    card.addEventListener('keydown', function (event) {
      var index = tabs.indexOf(event.target)
      if (index === -1 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      var next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
      selectRecentTab(card, tabs[next], true)
    })
  }
  function initNav () {
    document.querySelectorAll('#nav .menus_items a').forEach(function (link) {
      if (new URL(link.href).pathname === location.pathname) link.setAttribute('aria-current', 'page')
    })
    document.querySelectorAll('#nav .site-page.group').forEach(function (group) {
      group.tabIndex = 0
      group.setAttribute('role', 'button')
      group.setAttribute('aria-expanded', 'false')
      var item = group.parentNode
      item.addEventListener('pointerenter', function () { group.setAttribute('aria-expanded', 'true') })
      item.addEventListener('pointerleave', function () { if (!item.classList.contains('is-open')) group.setAttribute('aria-expanded', 'false') })
      item.addEventListener('focusin', function () { group.setAttribute('aria-expanded', 'true') })
      item.addEventListener('focusout', function (event) { if (!item.contains(event.relatedTarget) && !item.classList.contains('is-open')) group.setAttribute('aria-expanded', 'false') })
    })
  }
  function closeNav () {
    document.querySelectorAll('#nav .menus_item.is-open').forEach(function (item) { item.classList.remove('is-open'); item.querySelector('.group').setAttribute('aria-expanded', 'false') })
  }
  function toggleNav (group) {
    var item = group.parentNode
    var wasOpen = item.classList.contains('is-open')
    closeNav()
    item.classList.toggle('is-open', !wasOpen)
    group.setAttribute('aria-expanded', String(!wasOpen))
  }
  document.addEventListener('click', function (event) {
    var group = event.target.closest('#nav .site-page.group')
    if (group) toggleNav(group)
    else if (!event.target.closest('#nav .menus_item')) closeNav()
  })
  document.addEventListener('keydown', function (event) {
    var group = event.target.closest('#nav .site-page.group')
    if (group && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); toggleNav(group) }
    if (event.key === 'Escape') {
      closeNav()
      if (event.target.closest('#nav .menus_item')) document.querySelector('#nav .nav-site-title')?.focus()
    }
  })

  function init () {
    var currentRun = ++run
    initNav()
    initRecent()
    initMusicShell()
    mountMusic()
    if (window.innerWidth > 900) ensureMusic()
    var root = document.querySelector('.lks-category-bar') && document.querySelector('#recent-posts')
    home = root ? { root: root, original: Array.from(root.querySelector('.recent-post-items').children) } : null
    var calendar = document.querySelector('.lks-activity-card')
    if (home || calendar) data().then(function (payload) {
      if (currentRun !== run) return
      if (home) filterHome(payload)
      if (calendar) initCalendar(calendar, payload)
    }).catch(function () {
      if (calendar && calendar.isConnected) calendar.querySelector('.lks-calendar-detail').textContent = '日历暂时没有加载成功。'
    })
  }
  document.addEventListener('pjax:complete', init)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
  window.lksMusic = { get player () { return musicPlayer }, open: function () { toggleMusic(true) } }
})()
