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
  var quoteRun = 0
  var quoteRequest = null
  var playing = false
  var frame = 0
  var fallbacks = ['生活明朗，万物可爱。', '歇一会儿，听听风，也听听歌。', '今天也留一点时间给自己。']
  var fallbackIndex = 0

  function player () { return window.lksMusic && window.lksMusic.player }
  function el (tag, cls, text) { var node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node }
  function time (seconds) { seconds = Math.max(0, Math.floor(seconds || 0)); return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0') }

  function subtitleText (text, isLyric) {
    if (!subtitle || !subtitle.isConnected) return
    subtitle.classList.add('lks-listening')
    subtitle.dataset.mode = isLyric ? 'lyric' : 'quote'
    subtitle.setAttribute('aria-label', isLyric ? '当前歌词' : '一言')
    if (subtitle.dataset.text === text) return
    subtitle.dataset.text = text
    var previous = subtitle.querySelector('.is-current')
    subtitle.querySelectorAll('.is-leaving').forEach(function (node) { node.remove() })
    if (previous) { previous.className = 'lks-subtitle-line is-leaving'; previous.setAttribute('aria-hidden', 'true') }
    var current = el('span', 'lks-subtitle-line is-current', text)
    subtitle.appendChild(current)
    if (previous) setTimeout(function () { previous.remove() }, 430)
  }
  function showSubtitle () {
    if (playing && song) subtitleText(lyricIndex >= 0 ? lines[lyricIndex].text : '正在播放 · ' + song.name + (song.artist ? ' / ' + song.artist : ''), true)
    else subtitleText(quote || '生活明朗，万物可爱。', false)
  }
  function refreshQuote () {
    var run = ++quoteRun
    if (quoteRequest) quoteRequest.abort()
    var controller = new AbortController()
    quoteRequest = controller
    var timer = setTimeout(function () { controller.abort() }, 6500)
    return fetch('https://v1.hitokoto.cn/?r=' + Date.now(), { signal: controller.signal, cache: 'no-store', credentials: 'omit' })
      .then(function (response) { if (!response.ok) throw new Error('一言暂不可用'); return response.json() })
      .then(function (data) {
        if (run !== quoteRun || playing) return
        var next = typeof data.hitokoto === 'string' ? data.hitokoto.trim().slice(0, 240) : ''
        quote = next && next !== quote ? next : fallbacks[fallbackIndex++ % fallbacks.length]
        showSubtitle()
      }).catch(function () {
        if (run !== quoteRun || playing) return
        quote = fallbacks[fallbackIndex++ % fallbacks.length]
        showSubtitle()
      }).finally(function () { clearTimeout(timer); if (quoteRequest === controller) quoteRequest = null })
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

  function renderLyrics () {
    if (!room || !room.isConnected) return
    var view = room.querySelector('.lks-room-lyrics')
    view.replaceChildren()
    if (!lines.length) { view.appendChild(el('p', 'lks-room-empty', lyricMessage)); return }
    var track = el('div', 'lks-lyric-track')
    lines.forEach(function (line, index) {
      var button = el('button', 'lks-lyric-line', line.text)
      button.type = 'button'; button.dataset.lyricIndex = index
      button.setAttribute('aria-label', time(line.at) + ' ' + line.text)
      track.appendChild(button)
    })
    view.appendChild(track)
    positionLyrics()
  }
  function positionLyrics () {
    if (!room || !room.isConnected) return
    var view = room.querySelector('.lks-room-lyrics')
    var track = view.querySelector('.lks-lyric-track')
    if (!track) return
    var selected = Math.max(0, lyricIndex)
    track.querySelectorAll('button').forEach(function (node, index) {
      node.classList.toggle('is-current', index === lyricIndex)
      node.dataset.distance = Math.min(3, Math.abs(index - selected))
      if (index === lyricIndex) node.setAttribute('aria-current', 'true'); else node.removeAttribute('aria-current')
    })
    var active = track.children[selected]
    if (active) track.style.transform = 'translateY(' + (view.clientHeight / 2 - active.offsetTop - active.offsetHeight / 2) + 'px)'
  }
  function renderQueue () {
    if (!room || !room.isConnected) return
    var list = room.querySelector('.lks-room-queue')
    var songs = window.lksMusic.songs
    list.replaceChildren()
    songs.forEach(function (item, index) {
      var button = el('button', 'lks-room-song')
      button.type = 'button'; button.dataset.songIndex = index
      var number = el('span', 'lks-room-song-number', String(index + 1).padStart(2, '0'))
      var details = el('span', 'lks-room-song-details')
      details.append(el('strong', '', item.name), el('small', '', item.artist))
      button.append(number, details, el('i', 'fas fa-play'))
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
      var cover = room.querySelector('.lks-room-cover')
      cover.onerror = function () { cover.hidden = true }
      cover.hidden = !song || !song.cover
      if (!cover.hidden) cover.src = song.cover
      room.querySelectorAll('[data-song-index]').forEach(function (node) { var active = Number(node.dataset.songIndex) === p.list.index; node.classList.toggle('is-current', active); if (active) node.setAttribute('aria-current', 'true'); else node.removeAttribute('aria-current') })
    }
    room.classList.toggle('is-playing', playing)
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
    subtitle.replaceChildren()
    delete subtitle.dataset.text
    update()
    showSubtitle()
    if (!playing) refreshQuote()
  }
  function selectTab (id, focus) {
    room.querySelectorAll('[role="tab"]').forEach(function (tab) {
      var active = tab.id === id
      tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1
      room.querySelector('#' + tab.getAttribute('aria-controls')).hidden = !active
      if (active && focus) tab.focus()
    })
    positionLyrics()
  }
  function initRoom () {
    room = document.querySelector('.lks-music-room')
    roomSong = null
    if (!room) { mountSubtitle(); return }
    if (!room.lksReady) {
      room.lksReady = true
      room.addEventListener('click', function (event) {
        var p = player(), tab = event.target.closest('[role="tab"]')
        if (tab) selectTab(tab.id, false)
        if (!p) { window.lksMusic.ensure(); return }
        var action = event.target.closest('[data-room-action]')
        if (action) {
          var type = action.dataset.roomAction
          if (type === 'toggle') p.toggle()
          else if (type === 'prev') p.skipBack()
          else if (type === 'next') p.skipForward()
          else if (type === 'mute') { p.audio.muted = !p.audio.muted; update() }
          else if (type === 'order') { var random = p.options.order !== 'random'; p.options.order = random ? 'random' : 'list'; p.notice(random ? '随机播放' : '顺序播放'); action.title = random ? '随机播放' : '顺序播放'; action.setAttribute('aria-label', action.title); action.classList.toggle('is-active', random) }
        }
        var songButton = event.target.closest('[data-song-index]')
        if (songButton) { p.list.switch(Number(songButton.dataset.songIndex)); p.play() }
        var lyric = event.target.closest('[data-lyric-index]')
        if (lyric) { p.seek(lines[Number(lyric.dataset.lyricIndex)].at); update() }
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
        if (tab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); selectTab(event.key === 'Home' ? 'lks-room-lyrics-tab' : event.key === 'End' ? 'lks-room-queue-tab' : tab.id === 'lks-room-lyrics-tab' ? 'lks-room-queue-tab' : 'lks-room-lyrics-tab', true) }
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
  document.addEventListener('pjax:complete', initRoom)
  window.addEventListener('resize', function () { positionLyrics(); schedule() }, { passive: true })
  window.lksListening = { mount: mountSubtitle, parse: parseLrc }
  document.dispatchEvent(new CustomEvent('lks:listening-ready'))
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initRoom)
  else initRoom()
})()
