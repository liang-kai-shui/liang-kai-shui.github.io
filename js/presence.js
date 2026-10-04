/* 文章页的同页共读：实时人数走 WebSocket，断线时显示近 24 小时的阅读数。 */
(function () {
  'use strict'

  var API = ((window.LKS_STATS || window.LKS_COMMENT || {}).api || '').replace(/\/+$/, '')
  var box = null
  var toggle = null
  var label = null
  var panel = null
  var panelTitle = null
  var panelDots = null
  var panelMore = null
  var socket = null
  var timer = null
  var path = ''
  var online = null
  var recent = 0
  var attempts = 0
  var generation = 0

  function disconnect () {
    clearTimeout(timer)
    timer = null
    if (!socket) return
    socket.onmessage = socket.onclose = socket.onerror = null
    try { socket.close() } catch (e) {}
    socket = null
  }

  function closePanel () {
    if (!panel || panel.hidden) return
    panel.hidden = true
    toggle.setAttribute('aria-expanded', 'false')
  }

  function positionPanel () {
    var rect = toggle.getBoundingClientRect()
    var left = Math.max(12, Math.min(rect.left, window.innerWidth - panel.offsetWidth - 12))
    var top = rect.bottom + 8
    if (top + panel.offsetHeight > window.innerHeight - 12) top = rect.top - panel.offsetHeight - 8
    panel.style.left = left + 'px'
    panel.style.top = Math.max(12, top) + 'px'
  }

  function render () {
    if (!box) return
    var text = ''
    if (online !== null) {
      text = online <= 1 ? '你正在读' : '你和另外 ' + (online - 1) + ' 人正在读'
      if (recent > online) text += ' · 近 24 小时 ' + recent + ' 人来过'
    } else if (recent > 0) {
      text = '近 24 小时 ' + recent + ' 人读过'
    }
    box.hidden = !text
    label.textContent = text
    if (!text) closePanel()
    panelTitle.textContent = online !== null ? '此刻同页共读' : '近期阅读'
    panelDots.replaceChildren()
    panelMore.textContent = ''
    if (online !== null) {
      for (var i = 0; i < Math.min(online, 8); i++) {
        var dot = document.createElement('i')
        dot.setAttribute('aria-hidden', 'true')
        panelDots.appendChild(dot)
      }
      if (online > 8) panelMore.textContent = '还有 ' + (online - 8) + ' 个连接'
    } else {
      panelMore.textContent = '近 24 小时有 ' + recent + ' 位访客读过'
    }
  }

  function connect (run) {
    if (run !== generation || document.hidden || socket || !window.WebSocket) return
    var url = API.replace(/^http/i, 'ws') + '/api/presence/socket?path=' + encodeURIComponent(path)
    try { socket = new WebSocket(url) } catch (e) { socket = null; return }
    var current = socket
    current.onmessage = function (event) {
      if (run !== generation || current !== socket) return
      try {
        var data = JSON.parse(event.data)
        if (data.type !== 'readers' || !Number.isFinite(data.count)) return
        online = Math.max(1, Math.min(100, data.count))
        attempts = 0
        render()
      } catch (e) {}
    }
    current.onclose = function () {
      if (run !== generation || current !== socket) return
      socket = null
      online = null
      render()
      if (!document.hidden && attempts < 5) {
        var delay = Math.min(30000, 2000 * Math.pow(2, Math.min(attempts++, 4)))
        timer = setTimeout(function () { connect(run) }, delay)
      }
    }
    current.onerror = function () { current.close() }
  }

  function init () {
    generation++
    disconnect()
    if (box) box.remove()
    if (panel) panel.remove()
    box = toggle = label = panel = panelTitle = panelDots = panelMore = null
    online = null
    recent = 0
    attempts = 0

    var meta = document.querySelector('#post #post-info #post-meta') || document.querySelector('#post-info #post-meta')
    var article = document.querySelector('#post #article-container')
    var match = location.pathname.match(/^\/posts\/[a-z0-9_-]{1,80}\.html$/i)
    if (!API || !meta || !article || !match) return
    path = match[0]

    box = document.createElement('div')
    box.className = 'lks-presence'
    box.hidden = true
    toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.className = 'lks-presence-toggle'
    toggle.setAttribute('aria-expanded', 'false')
    toggle.setAttribute('aria-controls', 'lks-presence-panel')
    var indicator = document.createElement('i')
    indicator.className = 'lks-presence-indicator'
    indicator.setAttribute('aria-hidden', 'true')
    label = document.createElement('span')
    label.setAttribute('aria-live', 'polite')
    toggle.appendChild(indicator)
    toggle.appendChild(label)
    box.appendChild(toggle)
    meta.appendChild(box)

    panel = document.createElement('div')
    panel.id = 'lks-presence-panel'
    panel.className = 'lks-presence-panel'
    panel.hidden = true
    panelTitle = document.createElement('strong')
    panelDots = document.createElement('div')
    panelDots.className = 'lks-presence-dots'
    panelDots.setAttribute('aria-hidden', 'true')
    panelMore = document.createElement('small')
    var note = document.createElement('p')
    note.textContent = '匿名显示，只统计当前连接，不显示身份和阅读位置。'
    panel.appendChild(panelTitle)
    panel.appendChild(panelDots)
    panel.appendChild(panelMore)
    panel.appendChild(note)
    document.body.appendChild(panel)
    toggle.addEventListener('click', function () {
      panel.hidden = !panel.hidden
      toggle.setAttribute('aria-expanded', String(!panel.hidden))
      if (!panel.hidden) positionPanel()
    })

    var run = generation
    fetch(API + '/api/presence/recent?path=' + encodeURIComponent(path))
      .then(function (response) { if (!response.ok) throw new Error('接口不可用'); return response.json() })
      .then(function (body) {
        if (run !== generation) return
        recent = Math.max(0, Number(body.data && body.data.readers) || 0)
        render()
        connect(run)
      })
      .catch(function () {
        if (run !== generation) return
        // 前端先上线、后端还没部署时，不留一个坏掉的空组件。
        if (box) box.remove()
        if (panel) panel.remove()
        box = toggle = label = panel = panelTitle = panelDots = panelMore = null
      })
  }

  document.addEventListener('click', function (event) {
    if (panel && !panel.hidden && !panel.contains(event.target) && !box.contains(event.target)) closePanel()
  })
  document.addEventListener('keydown', function (event) { if (event.key === 'Escape') closePanel() })
  window.addEventListener('scroll', closePanel, { passive: true })
  window.addEventListener('resize', closePanel)

  document.addEventListener('visibilitychange', function () {
    if (!box) return
    if (document.hidden) {
      disconnect()
      online = null
      render()
    } else connect(generation)
  })
  window.addEventListener('pagehide', disconnect)
  window.addEventListener('pageshow', function () { if (box && !socket) connect(generation) })
  document.addEventListener('pjax:complete', init)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})()
