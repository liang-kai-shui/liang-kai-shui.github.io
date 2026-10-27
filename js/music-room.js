/* 音乐馆和首页歌词共用侧栏 APlayer；全站只有一个音频实例。 */
(function () {
  'use strict'
  var room = null
  var roomSong = null
  var song = null
  var lines = []
  var lyricIndex = -1
  var lyricMessage = '这首歌暂时没有歌词，听听旋律也好。'
  var lyricRequest = null
  var lyricRun = 0
  var lyricCache = new Map()
  var subtitle = null
  var quote = ''
  var quoteSource = ''
  var typingTimer = 0
  var typingRun = 0
  var typingMotion = matchMedia('(prefers-reduced-motion: reduce)')
  var quoteRun = 0
  var quoteRequest = null
  var playing = false
  var frame = 0
  var browsingLyrics = false
  var lyricResumeTimer = 0
  var quoteKey = 'lks-hitokoto-v1'
  var quotePool = []
  var previousQuote = ''
  var fallbacks = [
    { hitokoto: '行到水穷处，坐看云起时。', from: '终南别业', from_who: '王维' },
    { hitokoto: '山重水复疑无路，柳暗花明又一村。', from: '游山西村', from_who: '陆游' },
    { hitokoto: '长风破浪会有时，直挂云帆济沧海。', from: '行路难·其一', from_who: '李白' },
    { hitokoto: '明月松间照，清泉石上流。', from: '山居秋暝', from_who: '王维' },
    { hitokoto: '海内存知己，天涯若比邻。', from: '送杜少府之任蜀州', from_who: '王勃' },
    { hitokoto: '山高月小，水落石出。', from: '后赤壁赋', from_who: '苏轼' },
    { hitokoto: '人间有味是清欢。', from: '浣溪沙·细雨斜风作晓寒', from_who: '苏轼' },
    { hitokoto: '一蓑烟雨任平生。', from: '定风波·莫听穿林打叶声', from_who: '苏轼' }
  ]
  try {
    var savedQuotes = JSON.parse(localStorage.getItem(quoteKey) || '{}')
    previousQuote = typeof savedQuotes.last === 'string' ? savedQuotes.last : ''
    quotePool = Array.isArray(savedQuotes.items) ? savedQuotes.items.map(normalizeQuote).filter(Boolean).slice(-24) : []
  } catch (_) {}
  var previousVisitQuote = previousQuote

  function player () { return window.lksMusic && window.lksMusic.player }
  function el (tag, cls, text) { var node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node }
  function time (seconds) { seconds = Math.max(0, Math.floor(seconds || 0)); return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0') }

  function subtitleControl (mode, text) {
    if (!subtitle || !subtitle.isConnected) return
    mode = mode || subtitle.dataset.mode
    text = text || subtitle.dataset.text || ''
    var isQuote = mode === 'quote', busy = isQuote && !!quoteRequest
    subtitle.disabled = !isQuote
    subtitle.setAttribute('aria-busy', String(busy))
    subtitle.setAttribute('aria-disabled', String(!isQuote || busy))
    subtitle.title = isQuote ? busy ? '正在换一句…' : '点击换一句' : '正在显示歌词'
    subtitle.setAttribute('aria-label', isQuote ? '一言：' + text + (busy ? '，正在刷新' : '，点击换一句') : '当前歌词：' + text)
  }
  function noTypingMotion () { return typingMotion.matches || document.documentElement.classList.contains('lks-motion-off') }
  function subtitleText (text, isLyric) {
    if (!subtitle || !subtitle.isConnected) return
    var mode = isLyric ? 'lyric' : 'quote'
    var source = isLyric ? '' : quoteSource
    subtitleControl(mode, text)
    if (subtitle.dataset.text === text && subtitle.dataset.mode === mode && subtitle.dataset.source === source) return
    cancelTyping()
    subtitle.classList.add('lks-listening')
    subtitle.dataset.mode = mode
    subtitle.dataset.text = text
    subtitle.dataset.source = source
    var previous = subtitle.querySelector('.is-current')
    subtitle.querySelectorAll('.is-leaving').forEach(function (node) { node.remove() })
    if (previous) { previous.className = 'lks-subtitle-line is-leaving'; previous.setAttribute('aria-hidden', 'true') }
    var current = el('span', 'lks-subtitle-line is-current')
    subtitle.appendChild(current)
    if (isLyric) current.textContent = text
    else typeQuote(current, text, source)
    if (previous) setTimeout(function () { previous.remove() }, 430)
  }
  function cancelTyping () { clearTimeout(typingTimer); ++typingRun }
  function typeQuote (line, text, source) {
    var run = typingRun
    line.classList.add('lks-quote-line')
    var copy = el('span', 'lks-quote-copy')
    var caret = el('span', 'lks-type-caret', '|')
    caret.setAttribute('aria-hidden', 'true')
    var citation = el('small', 'lks-quote-source', source)
    citation.hidden = true
    line.append(copy, caret, citation)
    var chars = typeof Intl.Segmenter === 'function' ? Array.from(new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(text), function (part) { return part.segment }) : Array.from(text)
    var index = 0
    function step () {
      if (run !== typingRun || !line.isConnected) return
      if (noTypingMotion()) index = chars.length
      else ++index
      copy.textContent = chars.slice(0, index).join('')
      if (index >= chars.length) { line.classList.add('is-typed'); citation.hidden = !source; return }
      typingTimer = setTimeout(step, /[，。！？；,.!?;]/.test(chars[index - 1]) ? 160 : 55)
    }
    if (noTypingMotion()) step()
    else typingTimer = setTimeout(step, 90)
  }
  function showSubtitle () {
    if (playing && song) subtitleText(lyricIndex >= 0 ? lines[lyricIndex].text : '正在播放 · ' + song.name + (song.artist ? ' / ' + song.artist : ''), true)
    else {
      if (!quote) useQuote(localQuote())
      subtitleText(quote, false)
    }
  }
  function normalizeQuote (data) {
    if (!data || typeof data.hitokoto !== 'string' || !data.hitokoto.trim()) return null
    return { hitokoto: data.hitokoto.trim().slice(0, 240), from: typeof data.from === 'string' ? data.from.trim().slice(0, 100) : '', from_who: typeof data.from_who === 'string' ? data.from_who.trim().slice(0, 80) : '' }
  }
  function localQuote () {
    var candidates = quotePool.concat(fallbacks).filter(function (item) { return item.hitokoto !== quote && item.hitokoto !== previousQuote && item.hitokoto !== previousVisitQuote })
    return candidates[Math.floor(Math.random() * candidates.length)]
  }
  function useQuote (data, remember) {
    quote = data.hitokoto
    quoteSource = data.from ? '出自：' + data.from + (data.from_who && data.from_who !== data.from ? ' · ' + data.from_who : '') : data.from_who ? '出自：' + data.from_who : ''
    previousQuote = quote
    if (remember) quotePool = quotePool.filter(function (item) { return item.hitokoto !== quote }).concat(data).slice(-24)
    try { localStorage.setItem(quoteKey, JSON.stringify({ last: quote, items: quotePool })) } catch (_) {}
  }
  // 主线路慢时启用官方国际线路；同一句、空响应和失败都不能提前结束刷新。
  function requestQuote (controller, previous) {
    return new Promise(function (resolve, reject) {
      var endpoints = ['https://v1.hitokoto.cn/', 'https://international.v1.hitokoto.cn/']
      var pending = 0, secondary = false, settled = false
      var hedge = setTimeout(backup, 1000)
      function finish (error, data) {
        if (settled) return
        settled = true; clearTimeout(hedge)
        controller.signal.removeEventListener('abort', aborted)
        if (error) reject(error); else resolve(data)
      }
      function aborted () { finish(new Error('一言请求已取消')) }
      function backup () { if (!secondary && !settled) { secondary = true; request(1) } }
      function request (index) {
        ++pending
        fetch(endpoints[index] + '?encode=json&r=' + Date.now(), { signal: controller.signal, cache: 'no-store', credentials: 'omit' })
          .then(function (response) { if (!response.ok) throw new Error('一言暂不可用'); return response.json() })
          .then(function (data) {
            data = normalizeQuote(data)
            if (!data || data.hitokoto === previous || data.hitokoto === previousVisitQuote) throw new Error('一言未更新')
            finish(null, data)
          }).catch(function () {
            --pending
            if (settled) return
            if (index === 0) backup()
            if (!pending && secondary) finish(new Error('一言线路暂不可用'))
          })
      }
      controller.signal.addEventListener('abort', aborted, { once: true })
      request(0)
    })
  }
  function refreshQuote () {
    var run = ++quoteRun
    if (quoteRequest) quoteRequest.abort()
    var controller = new AbortController()
    quoteRequest = controller
    subtitleControl()
    var timer = setTimeout(function () { controller.abort() }, 9000)
    return requestQuote(controller, quote || previousQuote)
      .then(function (data) {
        if (run !== quoteRun || playing) return
        useQuote(data, true)
        showSubtitle()
      }).catch(function () {
        if (run !== quoteRun || playing) return
        useQuote(localQuote())
        showSubtitle()
      }).finally(function () { clearTimeout(timer); controller.abort(); if (quoteRequest === controller) { quoteRequest = null; subtitleControl() } })
  }

  function parseLrc (text) {
    var offset = /\[offset:\s*(-?\d+)\]/i.exec(text)
    offset = offset ? Number(offset[1]) / 1000 : 0
    var rows = []
    text.split(/\r?\n/).slice(0, 6000).forEach(function (line) {
      var content = line.replace(/\[[^\]]*\]/g, '').trim()
      if (!content) return
      var matches = line.matchAll(/\[(\d{1,3}):(\d{2}(?:\.\d{1,3})?)\]/g)
      for (var match of matches) rows.push({ at: Math.max(0, Number(match[1]) * 60 + Number(match[2]) + offset), text: content })
    })
    rows.sort(function (a, b) { return a.at - b.at })
    var result = []
    rows.forEach(function (row) {
      var last = result[result.length - 1]
      if (last && last.at === row.at) { if (last.text !== row.text) last.text += '\n' + row.text }
      else result.push(row)
    })
    return result
  }
  function loadLyrics () {
    var run = ++lyricRun
    if (lyricRequest) lyricRequest.abort()
    lines = []; lyricIndex = -1
    lyricMessage = song && song.lrc ? '正在找这首歌的歌词…' : '这首歌暂时没有歌词，听听旋律也好。'
    renderLyrics()
    if (!song || !song.lrc) return
    var url = song.lrc
    if (lyricCache.has(url)) { lines = lyricCache.get(url); lyricMessage = lines.length ? '' : '这首歌暂时没有歌词，听听旋律也好。'; renderLyrics(); schedule(); return }
    var controller = new AbortController()
    lyricRequest = controller
    var timer = setTimeout(function () { controller.abort() }, 9000)
    fetch(url, { signal: controller.signal, credentials: 'omit' })
      .then(function (response) { if (!response.ok) throw new Error('歌词暂不可用'); return response.text() })
      .then(function (body) {
        if (body.length > 400000) throw new Error('歌词过长')
        if (body.trim().charAt(0) === '{') { var payload = JSON.parse(body); body = payload.lyric || (payload.lrc && payload.lrc.lyric) || '' }
        var parsed = parseLrc(body)
        if (run !== lyricRun) return
        lines = parsed
        lyricMessage = parsed.length ? '' : '这首歌暂时没有歌词，听听旋律也好。'
        lyricCache.set(url, parsed)
        if (lyricCache.size > 48) lyricCache.delete(lyricCache.keys().next().value)
        renderLyrics(); schedule()
      }).catch(function () {
        if (run !== lyricRun) return
        lyricMessage = '歌词暂时没连上，音乐可以继续听。'
        renderLyrics()
      }).finally(function () { clearTimeout(timer); if (lyricRequest === controller) lyricRequest = null })
  }

  var previewIndex = -1, previewFrame = 0
  function renderLyrics () {
    if (!room || !room.isConnected) return
    resumeLyrics()
    var view = room.querySelector('.lks-room-lyrics')
    view.replaceChildren()
    if (!lines.length) { view.appendChild(el('p', 'lks-room-empty', lyricMessage)); return }
    var track = el('div', 'lks-lyric-track')
    track.setAttribute('role', 'list')
    lines.forEach(function (line, index) {
      var row = el('div', 'lks-lyric-line'), copy = el('span', 'lks-lyric-copy', line.text)
      row.dataset.lyricIndex = index; row.setAttribute('role', 'listitem')
      var actions = el('span', 'lks-lyric-jump'), stamp = el('span', 'lks-lyric-stamp', time(line.at))
      var seek = el('button', 'lks-lyric-seek')
      actions.hidden = true; seek.type = 'button'; seek.dataset.lyricSeek = index
      seek.setAttribute('aria-label', '从 ' + time(line.at) + ' 播放：' + line.text)
      seek.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m9 5 11 7-11 7Z" fill="currentColor"/></svg>'
      actions.append(stamp, seek); row.append(copy, actions); track.appendChild(row)
    })
    view.appendChild(track)
    positionLyrics()
  }
  function positionLyrics (instant) {
    if (!room || !room.isConnected) return
    var view = room.querySelector('.lks-room-lyrics')
    var track = view.querySelector('.lks-lyric-track')
    if (!track) return
    var selected = Math.max(0, lyricIndex)
    track.querySelectorAll('.lks-lyric-line').forEach(function (node, index) {
      node.classList.toggle('is-current', index === lyricIndex)
      node.dataset.distance = Math.min(3, Math.abs(index - selected))
      if (index === lyricIndex) node.setAttribute('aria-current', 'true'); else node.removeAttribute('aria-current')
    })
    var active = track.children[selected]
    if (active) {
      var viewH = view.clientHeight
      var trackH = track.offsetHeight
      // 默认是"当前句居中"（歌词流过视口的效果）。但整段歌词比视口矮的时候
      // ——纯音乐、短歌词，往往就三四句——把当前句居中会把整块歌词推到下半部分，
      // 上面空出一大片，看着像卡片被拉长了、歌词从下面才开始（用户报的就是这个）。
      // 所以：歌词比视口矮 → 整块居中，上下留白对称；
      //       比视口高 → 仍然是当前句居中，只把位移夹在可视范围内，
      //                  开头别在上面留白、结尾别在下面留白。
      var shift = viewH / 2 - active.offsetTop - active.offsetHeight / 2
      if (room.dataset.lyricLayout === 'animating' || browsingLyrics) return
      track.style.transform = trackH <= viewH ? 'translateY(' + (viewH - trackH) / 2 + 'px)' : ''
      if (!browsingLyrics) view.scrollTo({ top: trackH <= viewH ? 0 : Math.max(0, -shift), behavior: instant === true || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
    }
  }
  function selectPreview (index) {
    if (!room || !room.isConnected || !lines[index]) return
    previewIndex = index
    room.querySelectorAll('.lks-lyric-line').forEach(function (row, i) {
      row.classList.toggle('is-preview', i === index)
      row.querySelector('.lks-lyric-jump').hidden = i !== index
    })
  }
  function previewCenteredLine () {
    previewFrame = 0
    if (!room || !room.isConnected || !browsingLyrics) return
    var view = room.querySelector('.lks-room-lyrics'), rect = view.getBoundingClientRect(), middle = rect.top + rect.height / 2
    var nearest = -1, distance = Infinity
    view.querySelectorAll('.lks-lyric-line').forEach(function (row, index) {
      var r = row.getBoundingClientRect(), gap = Math.abs((r.top + r.bottom) / 2 - middle)
      if (gap < distance) { nearest = index; distance = gap }
    })
    if (nearest !== previewIndex && nearest >= 0) selectPreview(nearest)
  }
  function schedulePreview () { if (!previewFrame) previewFrame = requestAnimationFrame(previewCenteredLine) }
  function resetBrowseTimer () {
    clearTimeout(lyricResumeTimer)
    lyricResumeTimer = setTimeout(function () { resumeLyrics(); positionLyrics() }, 5000)
  }
  function resumeLyrics () {
    clearTimeout(lyricResumeTimer); cancelAnimationFrame(previewFrame); previewFrame = 0; previewIndex = -1
    browsingLyrics = false
    if (room) {
      var focusWasSeek = document.activeElement && document.activeElement.matches('[data-lyric-seek]')
      room.classList.remove('is-browsing-lyrics')
      room.querySelector('[data-room-action="follow"]').hidden = true
      room.querySelectorAll('.is-preview').forEach(function (row) { row.classList.remove('is-preview') })
      room.querySelectorAll('.lks-lyric-jump').forEach(function (actions) { actions.hidden = true })
      if (focusWasSeek) room.querySelector('.lks-room-lyrics').focus({ preventScroll: true })
    }
  }
  function browseLyrics (event, index) {
    if (!room || !lines.length || (event && event.target.closest('[data-lyric-seek]'))) return
    browsingLyrics = true
    room.classList.add('is-browsing-lyrics')
    room.querySelector('[data-room-action="follow"]').hidden = false
    resetBrowseTimer()
    if (typeof index === 'number') { cancelAnimationFrame(previewFrame); previewFrame = 0; selectPreview(index) }
    else schedulePreview()
  }
  function renderQueue () {
    if (!room || !room.isConnected) return
    var list = room.querySelector('.lks-room-queue')
    var songs = window.lksMusic.songs
    list.replaceChildren()
    songs.forEach(function (item, index) {
      var button = el('button', 'lks-room-song')
      button.type = 'button'; button.dataset.songIndex = index
      var number = el('span', 'lks-room-song-number')
      number.appendChild(el('span', 'lks-room-song-index', String(index + 1).padStart(2, '0')))
      var meter = el('span', 'lks-room-song-meter'); meter.setAttribute('aria-hidden', 'true')
      for (var bar = 0; bar < 3; bar++) meter.appendChild(el('i'))
      number.appendChild(meter)
      var artwork = el('span', 'lks-room-song-artwork')
      artwork.setAttribute('aria-hidden', 'true')
      artwork.appendChild(el('i', 'fas fa-music'))
      if (item.cover) {
        var image = el('img', 'lks-room-song-cover')
        image.alt = ''; image.loading = 'lazy'; image.decoding = 'async'
        image.onerror = function () { this.remove() }
        image.src = item.cover
        artwork.appendChild(image)
      }
      var details = el('span', 'lks-room-song-details')
      var titleRow = el('span', 'lks-room-song-title-row'), badge = el('span', 'lks-room-song-state', '播放中')
      badge.setAttribute('aria-hidden', 'true')
      titleRow.append(el('strong', '', item.name), badge)
      details.append(titleRow, el('small', '', item.artist))
      button.title = item.name + (item.artist ? ' · ' + item.artist : '')
      button.append(number, artwork, details, el('i', 'fas fa-play'))
      list.appendChild(button)
    })
    room.querySelector('.lks-room-song-count').textContent = songs.length || ''
  }
  function updateRoom (p) {
    if (!room || !room.isConnected || !p) return
    if (roomSong !== song) {
      roomSong = song
      room.querySelector('.lks-room-title').textContent = song ? song.name : '选一首喜欢的歌'
      room.querySelector('.lks-room-artist').textContent = song ? song.artist : ''
      room.querySelectorAll('[data-song-index]').forEach(function (node) { var active = Number(node.dataset.songIndex) === p.list.index; node.classList.toggle('is-current', active); if (active) node.setAttribute('aria-current', 'true'); else node.removeAttribute('aria-current') })
    }
    room.classList.toggle('is-playing', playing)
    var badge = room.querySelector('.lks-room-song.is-current .lks-room-song-state'), badgeText = playing ? '播放中' : '已暂停'
    if (badge && badge.textContent !== badgeText) badge.textContent = badgeText
    var toggle = room.querySelector('[data-room-action="toggle"]')
    toggle.setAttribute('aria-label', playing ? '暂停' : '播放')
    toggle.firstChild.className = 'fas ' + (playing ? 'fa-pause' : 'fa-play')
    var duration = Number.isFinite(p.audio.duration) ? p.audio.duration : 0
    var progress = room.querySelector('.lks-room-progress')
    progress.disabled = !duration
    if (document.activeElement !== progress) progress.value = duration ? p.audio.currentTime / duration * 1000 : 0
    room.querySelector('.lks-room-elapsed').textContent = time(p.audio.currentTime)
    room.querySelector('.lks-room-duration').textContent = time(duration)
    var volume = room.querySelector('.lks-room-volume input')
    if (document.activeElement !== volume) volume.value = p.audio.volume * 100
    var mute = room.querySelector('[data-room-action="mute"]')
    mute.setAttribute('aria-pressed', String(p.audio.muted || p.audio.volume === 0))
    mute.setAttribute('aria-label', p.audio.muted ? '取消静音' : '静音')
    mute.firstChild.className = 'fas ' + (p.audio.muted || !p.audio.volume ? 'fa-volume-mute' : 'fa-volume-up')
  }
  function update (event) {
    var p = player()
    if (!p) return
    if (event && event.detail && ['ready', 'orderchange'].includes(event.detail.event)) window.lksMusic.syncOrder()
    var next = window.lksMusic.songs[p.list.index]
    if (next !== song) { song = next; loadLyrics() }
    var wasPlaying = playing
    playing = !p.audio.paused && !p.audio.ended && !p.audio.error
    if (playing && !wasPlaying) { ++quoteRun; if (quoteRequest) quoteRequest.abort() }
    if (!playing && wasPlaying) refreshQuote()
    var index = -1
    for (var i = 0; i < lines.length && lines[i].at <= p.audio.currentTime; i++) index = i
    if (index !== lyricIndex) { lyricIndex = index; positionLyrics() }
    updateRoom(p)
    showSubtitle()
    if (room && event && event.detail) {
      var type = event.detail.event
      if (type === 'error') room.querySelector('.lks-room-status').textContent = '这首歌暂时播放不了，试试下一首。'
      else if (type === 'play' || type === 'pause' || type === 'ready' || type === 'listswitch') room.querySelector('.lks-room-status').textContent = playing ? '正在播放，慢慢听。' : '点播放，开始这一段摸鱼时间。'
    }
  }
  function schedule () { if (!frame) frame = requestAnimationFrame(function () { frame = 0; update() }) }
  function mountSubtitle () {
    var node = document.getElementById('subtitle')
    if (node === subtitle && node && node.isConnected) return
    subtitle = node
    if (!subtitle) return
    node.addEventListener('click', function () {
      if (node === subtitle && node.dataset.mode === 'quote' && !playing && !quoteRequest) refreshQuote()
    })
    subtitle.replaceChildren()
    delete subtitle.dataset.text
    update()
    showSubtitle()
    if (!playing) refreshQuote()
  }
  function selectTab (id, focus) {
    if (window.lksMusicWorkspace) { window.lksMusicWorkspace.select(id, focus); positionLyrics(); return }
    room.querySelectorAll('[role="tab"]').forEach(function (tab) {
      var active = tab.id === id
      tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1
      room.querySelector('#' + tab.getAttribute('aria-controls')).hidden = !active
      if (active && focus) tab.focus()
    })
    positionLyrics()
  }
  function initRoom () {
    clearTimeout(lyricResumeTimer); cancelAnimationFrame(previewFrame); previewFrame = 0; previewIndex = -1
    browsingLyrics = false
    room = document.querySelector('.lks-music-room')
    roomSong = null
    if (!room) { mountSubtitle(); return }
    window.lksMusic.syncOrder()
    if (!room.lksReady) {
      room.lksReady = true
      var lyricView = room.querySelector('.lks-room-lyrics')
      lyricView.addEventListener('wheel', browseLyrics, { passive: true })
      lyricView.addEventListener('touchmove', browseLyrics, { passive: true })
      lyricView.addEventListener('pointerdown', browseLyrics)
      lyricView.addEventListener('scroll', function () { if (browsingLyrics) { schedulePreview(); resetBrowseTimer() } }, { passive: true })
      lyricView.addEventListener('keydown', function (event) { if (event.key === 'Escape' && browsingLyrics) { event.preventDefault(); resumeLyrics(); positionLyrics() } else if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) browseLyrics(event) })
      room.addEventListener('click', function (event) {
        var p = player(), tab = event.target.closest('[role="tab"]')
        if (tab) selectTab(tab.id, false)
        if (!p) { window.lksMusic.ensure(); return }
        var action = event.target.closest('[data-room-action]')
        if (action) {
          var type = action.dataset.roomAction
          if (type === 'toggle') p.toggle()
          else if (type === 'follow') { resumeLyrics(); positionLyrics() }
          else if (type === 'prev') p.skipBack()
          else if (type === 'next') p.skipForward()
          else if (type === 'mute') { p.audio.muted = !p.audio.muted; update() }
          else if (type === 'order') window.lksMusic.toggleOrder()
        }
        var songButton = event.target.closest('[data-song-index]')
        if (songButton) { p.list.switch(Number(songButton.dataset.songIndex)); p.play() }
        var seek = event.target.closest('[data-lyric-seek]'), lyric = event.target.closest('[data-lyric-index]')
        if (seek) {
          var line = lines[Number(seek.dataset.lyricSeek)]
          if (line) { resumeLyrics(); p.seek(line.at); p.play(); update(); positionLyrics() }
        } else if (lyric) { browseLyrics(null, Number(lyric.dataset.lyricIndex)); lyricView.focus({ preventScroll: true }) }
      })
      room.addEventListener('input', function (event) {
        var p = player(), target = event.target
        if (target.matches('.lks-room-search input')) {
          var search = target.value.trim().toLocaleLowerCase(), visible = 0
          room.querySelectorAll('[data-song-index]').forEach(function (node) { node.hidden = !node.textContent.toLocaleLowerCase().includes(search); if (!node.hidden) visible++ })
          room.querySelector('.lks-room-queue-empty').hidden = !!visible
        } else if (p && target.matches('.lks-room-progress') && Number.isFinite(p.audio.duration)) { p.seek(target.value / 1000 * p.audio.duration); update() }
        else if (p && target.matches('.lks-room-volume input')) { p.audio.muted = false; p.volume(target.value / 100, true); update() }
      })
      room.addEventListener('keydown', function (event) {
        var tab = event.target.closest('[role="tab"]')
        if (tab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
          event.preventDefault()
          var tabs = Array.from(room.querySelectorAll('[role="tab"]')).filter(function (node) { return !node.hidden }), index = tabs.indexOf(tab)
          selectTab((event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1] : tabs[(index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length]).id, true)
        }
      })
    }
    renderQueue(); renderLyrics(); update(); mountSubtitle()
    window.lksMusic.ensure().then(function () { if (!room || !room.isConnected) return; renderQueue(); roomSong = null; update() })
  }
  document.addEventListener('lks:music', function (event) { if (event.detail.event === 'ready' && room) { renderQueue(); roomSong = null } update(event) })
  document.addEventListener('lks:music-failure', function () {
    if (!room || !room.isConnected) return
    room.querySelector('.lks-room-title').textContent = '歌单暂时没连上'
    var status = room.querySelector('.lks-room-status')
    status.replaceChildren(document.createTextNode('稍后再试试。'))
    var retry = el('button', 'lks-music-retry', '重新连接')
    retry.type = 'button'
    retry.addEventListener('click', function () { status.textContent = '正在重新连接…'; window.lksMusic.ensure() })
    status.appendChild(retry)
  })
  document.addEventListener('lks:music-layout', function (event) { positionLyrics(event.detail && event.detail.instant); schedule() })
  document.addEventListener('pjax:complete', initRoom)
  document.addEventListener('pjax:send', cancelTyping)
  function redrawQuote () { if (subtitle && subtitle.dataset.mode === 'quote') { delete subtitle.dataset.text; showSubtitle() } }
  typingMotion.addEventListener('change', redrawQuote)
  document.addEventListener('lks:motion-change', redrawQuote)
  window.addEventListener('resize', function () { positionLyrics(); schedule() }, { passive: true })
  window.lksListening = { mount: mountSubtitle, parse: parseLrc }
  document.dispatchEvent(new CustomEvent('lks:listening-ready'))
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initRoom)
  else initRoom()
})()
