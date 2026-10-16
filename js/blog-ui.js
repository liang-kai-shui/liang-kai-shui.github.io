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
      var variants = post.coverImages || []
      var thumbnail = variants.find(function (item) { return item.width >= 480 }) || variants[variants.length - 1]
      img.src = thumbnail ? thumbnail.src : post.cover
      if (variants.length) {
        img.srcset = variants.map(function (item) { return item.src + ' ' + item.width + 'w' }).join(', ')
        img.sizes = '(max-width: 768px) calc(100vw - 24px), (max-width: 900px) 42vw, (max-width: 1320px) 30vw, 401px'
        img.width = thumbnail.width; img.height = thumbnail.height
      }
      img.alt = post.title
      img.loading = index === 0 ? 'eager' : 'lazy'
      if (index === 0) img.fetchPriority = 'high'
      img.decoding = 'async'
      img.onerror = function () { img.onerror = null; img.removeAttribute('srcset'); img.src = '/img/404.jpg' }
      coverLink.appendChild(img)
      cover.appendChild(coverLink)
      card.appendChild(cover)
    }
    var info = element('div', 'recent-post-info' + (post.cover ? '' : ' no-cover'))
    var title = element('a', 'article-title', post.title)
    title.href = post.url
    var meta = element('div', 'article-meta-wrap')
    function separator () { meta.appendChild(element('span', 'article-meta-separator', '|')) }
    function field (icon, text, href) {
      var item = element('span', 'article-meta')
      var glyph = element('i', icon); glyph.setAttribute('aria-hidden', 'true'); item.appendChild(glyph)
      var label = element(href ? 'a' : 'span', '', text)
      if (href) label.href = href
      item.appendChild(label); meta.appendChild(item)
    }
    function slug (name) { return name === 'C++' ? 'C' : name.replace(/\s+/g, '-') }
    field('far fa-calendar-alt', '发表于 ' + post.date)
    separator(); field('fas fa-history', '更新于 ' + (post.updated || post.date))
    post.categories.forEach(function (name) { separator(); field('fas fa-inbox', name, '/categories/' + encodeURIComponent(slug(name)) + '/') })
    ;(post.tags || []).forEach(function (name) { separator(); field('fas fa-tag', name, '/tags/' + encodeURIComponent(slug(name)) + '/') })
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
  function toggleMusicOrder () {
    if (!musicPlayer) return
    var random = musicPlayer.options.order !== 'random'
    musicPlayer.options.order = random ? 'random' : 'list'
    syncMusicOrder()
    musicPlayer.notice(random ? '已开启随机播放' : '已恢复顺序播放')
    document.dispatchEvent(new CustomEvent('lks:music', { detail: { event: 'orderchange' } }))
  }
  function syncMusicOrder () {
    if (!musicPlayer) return
    var random = musicPlayer.options.order === 'random'
    document.querySelectorAll('[data-music-action="order"], [data-room-action="order"]').forEach(function (button) {
      button.setAttribute('aria-pressed', String(random))
      button.setAttribute('aria-label', random ? '关闭随机播放' : '开启随机播放')
      button.title = random ? '随机播放已开启，点击恢复顺序播放' : '开启随机播放'
      button.classList.toggle('is-active', random)
      button.firstChild.className = 'fas fa-random'
    })
  }
  function initMusicShell () {
    if (!parking) {
      parking = element('div')
      parking.id = 'lks-music-parking'
      parking.hidden = true
      ;(document.getElementById('site-runtime') || document.body).appendChild(parking)
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
      ;(document.getElementById('site-runtime') || document.body).appendChild(drawer)
    }
    syncMusicButton()
  }

  function syncMusicButton () {
    var button = document.getElementById('lks-music-toggle')
    if (button) button.setAttribute('aria-expanded', String(drawer && !drawer.hidden))
  }

  function musicDestination () {
    if (drawer && !drawer.hidden) return drawer.querySelector('.lks-music-host')
    var room = document.querySelector('.lks-music-engine')
    if (room) return room
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
          return { name: String(song.name || '未命名歌曲'), artist: String(song.artist || ''), url: safeHttp(song.url), cover: safeHttp(song.pic || song.cover), lrc: safeHttp(song.lrc), type: 'lks-cors' }
        }).filter(function (song) { return song.url })
        if (!playlist.length) { playlist = null; throw new Error('歌单为空') }
        return playlist
      }).finally(function () { clearTimeout(timeout) })
  }

  function playerLibrary () {
    return window.lksLoadPlayer().then(function () {
      if (getComputedStyle(document.documentElement).getPropertyValue('--lks-player-css-ready').trim() !== '1') throw new Error('播放器样式没有加载成功')
    })
  }

  var musicObserver = null
  function scheduleMusic () {
    if (musicObserver) musicObserver.disconnect()
    if (musicPlayer) return
    if (document.querySelector('.lks-music-engine') || (drawer && !drawer.hidden)) { ensureMusic(); return }
    var card = document.querySelector('#aside-content .lks-music-card')
    if (!card || innerWidth <= 900) return
    if (!('IntersectionObserver' in window)) { ensureMusic(); return }
    musicObserver = new IntersectionObserver(function (entries) {
      if (entries.some(function (entry) { return entry.isIntersecting })) { musicObserver.disconnect(); ensureMusic() }
    }, { rootMargin: '180px' })
    musicObserver.observe(card)
  }

  function musicFailure () {
    document.dispatchEvent(new CustomEvent('lks:music-failure'))
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
      var plainAudio = new Set()
      musicPlayer = new APlayer({ container: container, audio: values[1], autoplay: false, preload: 'none', theme: '#49b1f5', volume: .6, listFolded: true, listMaxHeight: '220px', mutex: true,
        customAudioType: { 'lks-cors': function (audio, item) {
          // 在设置 src 前启用匿名 CORS，允许频谱读取。没有授权的音源仍可降级直听。
          if (plainAudio.has(item.url)) audio.removeAttribute('crossorigin')
          else audio.crossOrigin = 'anonymous'
          audio.src = item.url
        } }
      })
      musicPlayer.audio.addEventListener('error', function (event) {
        var item = values[1][musicPlayer.list.index]
        if (!item || !musicPlayer.audio.crossOrigin || plainAudio.has(item.url)) return
        event.stopImmediatePropagation()
        plainAudio.add(item.url)
        var position = musicPlayer.audio.currentTime, resume = !musicPlayer.paused
        musicPlayer.audio.removeAttribute('crossorigin')
        musicPlayer.audio.addEventListener('loadedmetadata', function () { if (position && values[1][musicPlayer.list.index] === item) musicPlayer.seek(position) }, { once: true })
        musicPlayer.audio.load()
        if (resume) musicPlayer.play()
        document.dispatchEvent(new CustomEvent('lks:music', { detail: { event: 'analysis-unavailable' } }))
      }, true)
      // 链接留在同一个播放器里，侧栏和顶栏浮层搬动它时也能继续使用。
      var coverLink = element('a', 'lks-music-room-link lks-music-cover-link')
      coverLink.href = '/music/'
      coverLink.setAttribute('aria-label', '到音乐专页听这首歌')
      container.querySelector('.aplayer-pic').appendChild(coverLink)
      var titleNode = container.querySelector('.aplayer-title')
      var titleLink = element('a', 'lks-music-room-link')
      titleLink.href = '/music/'
      titleLink.title = '到音乐专页听这首歌'
      titleNode.replaceWith(titleLink)
      titleLink.appendChild(titleNode)
      musicWrapper.addEventListener('click', function (event) {
        if (!event.target.closest('.lks-music-room-link')) return
        // 封面的原生行为会切换播放，先拦住，再保持当前进度进入专页。
        event.stopPropagation()
        if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        toggleMusic(false)
        if (location.pathname === '/music/') return
        if (window.pjax && typeof window.pjax.loadUrl === 'function') window.pjax.loadUrl('/music/')
        else location.assign('/music/')
      }, true)
      var controls = element('div', 'lks-music-controls')
      var specs = [['order', '开启随机播放', 'fa-random'], ['prev', '上一首', 'fa-step-backward'], ['toggle', '播放', 'fa-play'], ['next', '下一首', 'fa-step-forward']]
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
          else if (spec[0] === 'order') toggleMusicOrder()
        })
        controls.appendChild(button)
      })
      // 调整 APlayer 原有 DOM，原生进度、时间和歌单继续由同一个实例维护。
      var seek = element('div', 'lks-music-seek')
      var progressBar = container.querySelector('.aplayer-bar-wrap')
      progressBar.setAttribute('role', 'slider')
      progressBar.setAttribute('aria-label', '电台播放进度')
      progressBar.setAttribute('aria-valuemin', '0')
      progressBar.tabIndex = 0
      progressBar.addEventListener('keydown', function (event) {
        var duration = musicPlayer.duration
        if (!duration || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        musicPlayer.seek(event.key === 'Home' ? 0 : event.key === 'End' ? duration : musicPlayer.audio.currentTime + (event.key === 'ArrowRight' ? 5 : -5))
        syncProgress()
      })
      var times = element('div', 'lks-music-timestamps')
      times.append(musicPlayer.template.ptime, musicPlayer.template.dtime)
      seek.append(progressBar, times)
      var footer = element('div', 'lks-music-footer')
      var volumeGroup = element('div', 'lks-music-volume')
      var mute = element('button')
      mute.type = 'button'; mute.dataset.musicAction = 'mute'
      mute.appendChild(element('i', 'fas fa-volume-up'))
      mute.addEventListener('click', function () { musicPlayer.audio.muted = !musicPlayer.audio.muted; syncVolume() })
      var volume = element('input')
      volume.type = 'range'; volume.min = '0'; volume.max = '100'
      volume.setAttribute('aria-label', '电台音量')
      volume.addEventListener('input', function () { musicPlayer.volume(Number(volume.value) / 100, true); syncVolume() })
      var volumeText = element('span', 'lks-music-volume-value')
      volumeText.setAttribute('aria-hidden', 'true')
      volumeGroup.append(mute, volume, volumeText)
      var listButton = element('button', 'lks-music-list-toggle')
      listButton.type = 'button'; listButton.dataset.musicAction = 'list'
      listButton.append(element('i', 'fas fa-list-ul'), element('span', '', '歌单'))
      listButton.setAttribute('aria-controls', 'lks-player-list')
      listButton.addEventListener('click', function () { musicPlayer.list.toggle(); syncList() })
      footer.append(volumeGroup, listButton)
      var nativeList = container.querySelector('.aplayer-list')
      nativeList.id = 'lks-player-list'
      container.append(seek, controls, footer, nativeList)
      container.querySelector('.aplayer-time').setAttribute('aria-hidden', 'true')
      container.querySelectorAll('.aplayer-time button').forEach(function (node) { node.tabIndex = -1 })
      function syncProgress () {
        progressBar.setAttribute('aria-valuemax', String(musicPlayer.duration || 0))
        progressBar.setAttribute('aria-valuenow', String(Math.floor(musicPlayer.audio.currentTime || 0)))
        progressBar.setAttribute('aria-valuetext', musicPlayer.template.ptime.textContent + ' / ' + musicPlayer.template.dtime.textContent)
      }
      function syncVolume () {
        var silent = musicPlayer.audio.muted || !musicPlayer.audio.volume
        mute.setAttribute('aria-label', silent ? '取消电台静音' : '电台静音')
        mute.setAttribute('aria-pressed', String(silent))
        mute.title = mute.getAttribute('aria-label')
        mute.firstChild.className = 'fas ' + (silent ? 'fa-volume-mute' : 'fa-volume-up')
        if (document.activeElement !== volume) volume.value = String(Math.round(musicPlayer.audio.volume * 100))
        volumeText.textContent = silent ? '0%' : Math.round(musicPlayer.audio.volume * 100) + '%'
        volume.style.setProperty('--volume-fill', (silent ? 0 : musicPlayer.audio.volume * 100) + '%')
      }
      function syncList () {
        var open = !nativeList.classList.contains('aplayer-list-hide')
        listButton.setAttribute('aria-expanded', String(open))
        listButton.setAttribute('aria-label', open ? '收起歌单' : '展开歌单')
        listButton.title = listButton.getAttribute('aria-label')
        nativeList.setAttribute('aria-hidden', String(!open))
        nativeList.inert = !open
      }
      musicPlayer.on('volumechange', syncVolume)
      musicPlayer.on('timeupdate', syncProgress)
      musicPlayer.on('durationchange', syncProgress)
      ;['listshow', 'listhide'].forEach(function (name) { musicPlayer.on(name, function () { queueMicrotask(syncList) }) })
      syncVolume(); syncProgress(); syncList(); syncMusicOrder()
      var sync = function () {
        var button = controls.querySelector('[data-music-action="toggle"]')
        button.setAttribute('aria-label', musicPlayer.paused ? '播放' : '暂停')
        button.title = button.getAttribute('aria-label')
        button.firstChild.className = 'fas ' + (musicPlayer.paused ? 'fa-play' : 'fa-pause')
      }
      musicPlayer.on('play', sync)
      musicPlayer.on('pause', sync)
      ;['play', 'pause', 'ended', 'listswitch', 'timeupdate', 'loadedmetadata', 'durationchange', 'volumechange', 'error'].forEach(function (name) {
        musicPlayer.on(name, function () {
          var publish = function () { document.dispatchEvent(new CustomEvent('lks:music', { detail: { event: name } })) }
          // APlayer 在写入新 index 之前触发 listswitch，等这一轮切歌完成再读状态。
          if (name === 'listswitch') queueMicrotask(function () {
            container.querySelector('.aplayer-author').textContent = values[1][musicPlayer.list.index].artist
            syncProgress(); publish()
          })
          else publish()
        })
      })
      container.querySelector('.aplayer-author').textContent = values[1][musicPlayer.list.index].artist
      document.dispatchEvent(new CustomEvent('lks:music', { detail: { event: 'ready' } }))
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
  window.addEventListener('resize', function () { mountMusic(); scheduleMusic() })

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
    scheduleMusic()
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
  window.lksMusic = { get player () { return musicPlayer }, get songs () { return playlist || [] }, ensure: ensureMusic, toggleOrder: toggleMusicOrder, syncOrder: syncMusicOrder, open: function () { toggleMusic(true) } }
})()
