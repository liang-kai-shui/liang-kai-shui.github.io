/* 封面过渡、封面取色和频谱共用原播放器；分析分支从不接入扬声器。 */
(function () {
  'use strict'
  var room = null, current = null, coverRun = 0
  var images = new Map(), palette = { h: 205, s: 40, h2: 234, source: 'fallback' }
  var motion = matchMedia('(prefers-reduced-motion: reduce)')
  var audioContext = null, analyser = null, stream = null, source = null, audioTrack = null
  var spectrumFrame = 0, lastFrame = 0, bins = null, levels = new Float32Array(64), settleStarted = 0
  var settleFrom = new Float32Array(64), drawTime = 0, pauseDuration = 240
  var discFrame = 0, discTime = 0, discAngle = 0, discSpeed = 0
  var visible = true, enabled = true, observer = null, spectrumState = ''
  var captureAudio = null, captureFailed = false, visualMode = 'mini', lastVisualMode = 'mini'
  try {var storedMode = localStorage.getItem('lks-music-visualizer'); if (['mini', 'stage', 'off'].includes(storedMode)) visualMode = storedMode} catch (_) {}
  enabled = visualMode !== 'off'
  if (enabled) lastVisualMode = visualMode
  function syncVisualControls () {
    if (!room) return
    room.dataset.spectrumMode = visualMode
    room.querySelectorAll('[name="music-spectrum-mode"]').forEach(function (input) { input.checked = input.value === visualMode })
    var toggle = room.querySelector('.lks-spectrum-toggle')
    toggle.setAttribute('aria-pressed', String(enabled))
    toggle.setAttribute('aria-label', enabled ? '关闭音频可视化' : '打开音频可视化')
    toggle.title = toggle.getAttribute('aria-label')
    var label = room.querySelector('.lks-spectrum-mode-label')
    if (label) label.textContent = visualMode === 'stage' ? '整卡背景频谱' : enabled ? '频谱' : '可视化已关闭'
  }
  function observeVisual () {
    if (observer) observer.disconnect()
    visible = true
    if (room && window.IntersectionObserver) {
      observer = new IntersectionObserver(function (entries) { visible = entries[0].isIntersecting; syncSpectrum() })
      observer.observe(room.querySelector(visualMode === 'stage' ? '.workspace-stage' : '.lks-room-player'))
    }
  }
  function setVisualMode (value) {
    if (!['mini', 'stage', 'off'].includes(value)) return
    stopSpectrum()
    visualMode = value; enabled = value !== 'off'
    if (enabled) lastVisualMode = value
    try {localStorage.setItem('lks-music-visualizer', value)} catch (_) {}
    syncVisualControls(); observeVisual(); syncSpectrum()
  }

  function player () { return window.lksMusic && window.lksMusic.player }
  function clamp (n, a, b) { return Math.max(a, Math.min(b, n)) }
  function make (tag, cls) { var node = document.createElement(tag); node.className = cls; return node }
  function loadCover (url) {
    if (!url) return Promise.resolve(null)
    if (images.has(url)) return images.get(url)
    var task = new Promise(function (resolve) {
      var image = new Image(), done = false, timer
      function finish (result) { if (done) return; done = true; clearTimeout(timer); image.onload = image.onerror = null; resolve(result) }
      image.crossOrigin = 'anonymous'
      image.onload = function () { finish(image) }
      image.onerror = function () {
        // 无 CORS 时仍可显示封面；画布取色会安全回退。
        image.onload = function () { finish(image) }
        image.onerror = function () { finish(null) }
        image.removeAttribute('crossorigin'); image.src = url
      }
      timer = setTimeout(function () { finish(null) }, 8000)
      image.src = url
    })
    images.set(url, task)
    if (images.size > 64) images.delete(images.keys().next().value)
    task.then(function (image) { if (!image) images.delete(url) })
    return task
  }
  function pickPalette (image) {
    if (!image) return { h: 205, s: 40, h2: 234, source: 'fallback' }
    try {
      var canvas = document.createElement('canvas'); canvas.width = canvas.height = 32
      var ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(image, 0, 0, 32, 32)
      var pixels = ctx.getImageData(0, 0, 32, 32).data
      var buckets = Array.from({ length: 24 }, function () { return { weight: 0, sat: 0 } })
      for (var i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] < 180) continue
        var r = pixels[i] / 255, g = pixels[i + 1] / 255, b = pixels[i + 2] / 255
        var max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min, light = (max + min) / 2
        if (!delta || light < .08 || light > .92) continue
        var sat = delta / (1 - Math.abs(2 * light - 1))
        var hue = max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4
        var weight = sat * sat * (1 - Math.abs(light - .5))
        var bucket = buckets[Math.round(hue * 4) % 24]
        bucket.weight += weight; bucket.sat += sat * weight
      }
      var ranked = buckets.map(function (b, i) { return { h: i * 15, s: b.sat / (b.weight || 1) * 100, weight: b.weight } }).sort(function (a, b) { return b.weight - a.weight })
      var main = ranked[0]
      if (main.weight < .5) return { h: 215, s: 15, h2: 245, source: 'neutral' }
      var second = ranked.find(function (b) { var d = Math.abs(b.h - main.h); return b.weight > main.weight * .25 && Math.min(d, 360 - d) >= 30 })
      // 双主色封面用少量辅色调和底色，避免蓝/粉封面整页只剩一块蓝。
      var blend = second ? Math.min(.45, second.weight / (main.weight + second.weight)) : 0
      var hue = second ? (main.h + ((second.h - main.h + 540) % 360 - 180) * blend + 360) % 360 : main.h
      return { h: Math.round(hue), s: Math.round(clamp(main.s * .66, 26, 56)), h2: second ? second.h : (main.h + 32) % 360, source: 'cover' }
    } catch (e) { return { h: 205, s: 40, h2: 234, source: 'fallback' } }
  }
  function applyPalette () {
    if (!room) return
    room.style.setProperty('--room-hue', palette.h)
    room.style.setProperty('--room-saturation', palette.s + '%')
    room.style.setProperty('--room-hue-secondary', palette.h2)
    room.dataset.palette = palette.source
  }
  function flipCover (stage, image, url) {
    if (!stage || stage.dataset.cover === url) return
    var node = stage.querySelector('img:not(.lks-artwork-ghost)')
    if (!node) { node = make('img', 'lks-mini-cover'); node.alt = ''; stage.appendChild(node) }
    stage.querySelectorAll('.lks-artwork-ghost').forEach(function (ghost) { ghost.remove() })
    node.getAnimations().forEach(function (animation) { animation.cancel() })
    var old = node.getAttribute('src') && !node.hidden ? node.cloneNode(false) : null
    node.hidden = !image
    stage.dataset.cover = url
    if (image) node.src = image.src
    else node.removeAttribute('src')
    if (!old || !image || motion.matches || !stage.getClientRects().length || !node.animate) return
    old.className = 'lks-artwork-ghost'; old.alt = ''; old.setAttribute('aria-hidden', 'true'); stage.appendChild(old)
    var options = { duration: 680, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'both' }
    old.animate([{ transform: 'rotateY(0deg)', opacity: 1 }, { transform: 'rotateY(90deg)', opacity: 0, offset: .5 }, { transform: 'rotateY(90deg)', opacity: 0 }], options).finished.catch(function () {}).then(function () { old.remove() })
    node.animate([{ transform: 'rotateY(-90deg)', opacity: 0 }, { transform: 'rotateY(-90deg)', opacity: 0, offset: .45 }, { transform: 'rotateY(0deg)', opacity: 1 }], options).finished.catch(function () {})
  }
  function miniStage () {
    var link = document.querySelector('.lks-music-cover-link')
    if (!link) return null
    var stage = link.querySelector('.lks-cover-stage')
    if (!stage) { stage = make('span', 'lks-mini-artwork lks-cover-stage'); stage.setAttribute('aria-hidden', 'true'); link.appendChild(stage) }
    return stage
  }
  function updateCover () {
    var p = player(), next = p && window.lksMusic.songs[p.list.index]
    if (!next) return
    var stage = miniStage()
    if (next === current && (!room || room.dataset.songCover === next.cover)) return
    current = next
    var run = ++coverRun
    loadCover(next.cover).then(function (image) {
      if (run !== coverRun) return
      palette = pickPalette(image); applyPalette()
      flipCover(stage, image, next.cover)
      if (room) { room.dataset.songCover = next.cover; flipCover(room.querySelector('.lks-disc-artwork'), image, next.cover) }
    })
  }
  function state (value, text) {
    if (!room) return
    var view = room.querySelector('.lks-room-spectrum')
    if (spectrumState !== value || view.dataset.state !== value) { spectrumState = value; view.dataset.state = value; view.querySelector('.lks-spectrum-state').textContent = text }
    room.dataset.spectrumState = value
    var description = room.querySelector('[data-spectrum-description]')
    if (description && description.textContent !== text) description.textContent = text
  }
  function disconnectCapture () {
    if (source) source.disconnect()
    if (stream) { stream.getTracks().forEach(function (track) { track.stop() }); stream = null }
    source = null; audioTrack = null
  }
  function connectTrack () {
    var track = stream && stream.getAudioTracks().find(function (item) { return item.readyState === 'live' })
    if (!track || track === audioTrack || !audioContext) return
    if (source) source.disconnect()
    audioTrack = track
    source = audioContext.createMediaStreamSource(new MediaStream([track]))
    source.connect(analyser)
    // 不接 destination：原 audio 负责出声，分析支路不接管、不重复播放。
  }
  function ensureAnalysis () {
    var p = player(), Context = window.AudioContext || window.webkitAudioContext
    if (!p || !Context || captureFailed) return false
    if (!p.audio.captureStream && !p.audio.mozCaptureStream) { captureFailed = true; return false }
    try {
      if (!audioContext) {
        audioContext = new Context()
        analyser = audioContext.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = .22
        analyser.minDecibels = -85; analyser.maxDecibels = -12
        bins = new Uint8Array(analyser.frequencyBinCount)
      }
      if (!stream) {
        stream = (p.audio.captureStream || p.audio.mozCaptureStream).call(p.audio)
        stream.addEventListener('addtrack', connectTrack)
        connectTrack()
      }
      if (audioContext.state === 'suspended') audioContext.resume().catch(function () {})
      return true
    } catch (e) { disconnectCapture(); captureFailed = true; return false }
  }
  function drawSpectrum (timestamp, live) {
    if (!room) return
    var full = visualMode === 'stage' && !!room.querySelector('.workspace-spectrum-canvas')
    var canvas = room.querySelector(full ? '.workspace-spectrum-canvas' : '.lks-room-spectrum canvas'), ctx = canvas.getContext('2d')
    if (!ctx) return
    var width = canvas.clientWidth, height = canvas.clientHeight, ratio = Math.min(devicePixelRatio || 1, full ? 1.25 : 2)
    if (!width || !height) return
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio) }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height)
    if (live && analyser) analyser.getByteFrequencyData(bins)
    var gradient = ctx.createLinearGradient(0, 0, width, 0)
    var dark = document.documentElement.getAttribute('data-theme') === 'dark'
    var light = dark ? 65 : 41, saturation = Math.max(64, palette.s)
    gradient.addColorStop(0, 'hsl(' + ((palette.h + 325) % 360) + ', ' + saturation + '%, ' + light + '%)')
    gradient.addColorStop(.5, 'hsl(' + palette.h + ', ' + saturation + '%, ' + (light + 5) + '%)')
    gradient.addColorStop(1, 'hsl(' + ((palette.h + 65) % 360) + ', ' + saturation + '%, ' + light + '%)')
    ctx.strokeStyle = dark ? 'rgba(255,255,255,.045)' : 'rgba(30,50,70,.055)'
    ctx.lineWidth = 1; ctx.beginPath()
    for (var row = 1; row <= 3; row++) { var y = Math.round((height - 4) * row / 4) + .5; ctx.moveTo(0, y); ctx.lineTo(width, y) }
    if (!full) ctx.stroke()
    ctx.fillStyle = gradient
    var gap = width < 240 ? 1 : 1.5, barWidth = (width - gap * (levels.length - 1)) / levels.length, peak = 0, visualPeak = 0
    var dt = drawTime ? clamp(timestamp - drawTime, 8, 80) : 16
    drawTime = timestamp
    var maxBin = analyser ? Math.min(bins.length - 1, Math.floor(16000 / audioContext.sampleRate * analyser.fftSize)) : 700
    var settle = clamp(1 - (timestamp - settleStarted) / pauseDuration, 0, 1)
    ctx.beginPath()
    for (var i = 0; i < levels.length; i++) {
      // 从左到右是低频至高频，不镜像；保留鼓点的尖峰和高频细节。
      var from = Math.floor(Math.pow(i / levels.length, 1.55) * maxBin) + 1
      var to = Math.max(from + 1, Math.floor(Math.pow((i + 1) / levels.length, 1.55) * maxBin) + 1)
      var value = 0
      if (live && bins) { for (var k = from; k < to; k++) value += bins[k] || 0; value = value / (to - from) / 255 }
      var target = Math.min(.98, Math.pow(value, .85) * 1.1)
      if (live) levels[i] += (target - levels[i]) * (1 - Math.exp(-dt / (target > levels[i] ? 12 : 45)))
      else levels[i] = settleFrom[i] * settle * settle
      if (levels[i] < .002) levels[i] = 0
      peak = Math.max(peak, value)
      visualPeak = Math.max(visualPeak, levels[i])
      var barHeight = (full ? 0 : 1.5) + levels[i] * (full ? height * .72 : height - 6)
      ctx.rect(i * (barWidth + gap), height - 2 - barHeight, barWidth, barHeight)
    }
    ctx.fill()
    ctx.fillStyle = dark ? 'rgba(255,255,255,.42)' : 'rgba(255,255,255,.3)'
    ctx.beginPath()
    for (var cap = 0; !full && cap < levels.length; cap++) if (levels[cap] > .04) ctx.rect(cap * (barWidth + gap), height - 3.5 - levels[cap] * (height - 6), barWidth, 1.5)
    ctx.fill()
    if (full && visualPeak > .01) {
      ctx.globalCompositeOperation = 'destination-over'
      var glow = ctx.createRadialGradient(width * .38, height, 0, width * .38, height, Math.max(width * .65, height))
      glow.addColorStop(0, 'hsla(' + palette.h + ', 70%, 55%, ' + (visualPeak * .3) + ')'); glow.addColorStop(1, 'transparent')
      ctx.fillStyle = glow; ctx.fillRect(0, 0, width, height); ctx.globalCompositeOperation = 'source-over'
    }
    canvas.dataset.energy = peak.toFixed(3)
    canvas.dataset.level = visualPeak.toFixed(3)
    canvas.dataset.frames = String(Number(canvas.dataset.frames || 0) + 1)
  }
  function stopSpectrum () { cancelAnimationFrame(spectrumFrame); spectrumFrame = 0; settleStarted = 0; lastFrame = 0; drawTime = 0; levels.fill(0); settleFrom.fill(0); drawSpectrum(0, false) }
  function beginSettle (timestamp) {
    if (settleStarted) return
    settleStarted = timestamp
    settleFrom.set(levels)
    state('settling', '收拢频谱')
  }
  function tick (timestamp) {
    spectrumFrame = 0
    if (!room || !visible || document.hidden || !enabled || motion.matches) return
    var p = player()
    var live = p && !p.audio.paused && !p.audio.ended
    // 实际鼠标点击时，rAF 可能早于 audio 的 pause 事件；这里也要接住暂停。
    if (!live) beginSettle(timestamp)
    if (!live && timestamp - settleStarted >= pauseDuration) { stopSpectrum(); state('idle', '等待播放'); return }
    if (timestamp - lastFrame >= 1000 / (innerWidth <= 768 || visualMode === 'stage' ? 30 : 60) - 1) { lastFrame = timestamp; drawSpectrum(timestamp, live) }
    spectrumFrame = requestAnimationFrame(tick)
  }
  function stopDisc () { cancelAnimationFrame(discFrame); discFrame = 0; discTime = 0; discSpeed = 0 }
  function tickDisc (timestamp) {
    discFrame = 0
    if (!room || !room.isConnected || !visible || !room.querySelector('.lks-room-disc').getClientRects().length || document.hidden || motion.matches) { stopDisc(); return }
    var p = player(), live = p && !p.audio.paused && !p.audio.ended
    if (!discTime || timestamp - discTime >= 1000 / 30) {
      var dt = discTime ? Math.min(100, timestamp - discTime) : 33
      discTime = timestamp
      discSpeed += ((live ? 1 : 0) - discSpeed) * (1 - Math.exp(-dt / (live ? 170 : 145)))
      discAngle = (discAngle + dt * 360 / 28000 * discSpeed) % 360
      var disc = room.querySelector('.lks-room-disc')
      disc.style.setProperty('--disc-angle', discAngle.toFixed(3) + 'deg')
      disc.dataset.speed = discSpeed.toFixed(3)
      if (!live && discSpeed < .008) { disc.dataset.speed = '0'; stopDisc(); return }
    }
    discFrame = requestAnimationFrame(tickDisc)
  }
  function syncDisc () {
    if (!room || !room.isConnected || !visible || !room.querySelector('.lks-room-disc').getClientRects().length || document.hidden || motion.matches) { stopDisc(); return }
    var p = player()
    if (!discFrame && (discSpeed > .008 || (p && !p.audio.paused && !p.audio.ended))) discFrame = requestAnimationFrame(tickDisc)
  }
  function syncSpectrum () {
    var p = player()
    syncDisc()
    if (!room || !room.isConnected) { stopSpectrum(); return }
    if (!enabled) { stopSpectrum(); state('off', '频谱已关闭'); return }
    if (motion.matches) { stopSpectrum(); state('reduced', '静态聆听'); return }
    if (!visible || document.hidden) { stopSpectrum(); return }
    if (!p || p.audio.paused || p.audio.ended) {
      if (levels.some(function (value) { return value > .002 })) {
        beginSettle(performance.now())
        if (!spectrumFrame) spectrumFrame = requestAnimationFrame(tick)
      } else { stopSpectrum(); state('idle', '等待播放') }
      return
    }
    if (!ensureAnalysis()) { stopSpectrum(); state('unavailable', '安心听歌'); return }
    state('live', '随音乐起伏')
    settleStarted = 0
    if (!spectrumFrame) spectrumFrame = requestAnimationFrame(tick)
  }
  function bindAudio () {
    var p = player()
    if (!p || captureAudio === p.audio) return
    captureAudio = p.audio
    p.audio.addEventListener('loadeddata', function () { captureFailed = false; syncSpectrum() })
    p.audio.addEventListener('emptied', function () { disconnectCapture(); captureFailed = false })
  }
  function init () {
    stopSpectrum(); stopDisc()
    if (observer) observer.disconnect()
    room = document.querySelector('.lks-music-room'); current = null; visible = true
    if (room) {
      applyPalette()
      syncVisualControls(); observeVisual()
    }
    bindAudio(); updateCover(); syncSpectrum()
  }
  // Delegation binds each control once, including after the initial PJAX lifecycle.
  document.addEventListener('click', function (event) {
    if (event.target.closest('.lks-spectrum-toggle') && room && room.isConnected) setVisualMode(enabled ? 'off' : lastVisualMode)
  })
  document.addEventListener('change', function (event) {
    if (event.target.matches('[name="music-spectrum-mode"]') && room && room.isConnected) setVisualMode(event.target.value)
  })
  document.addEventListener('lks:music', function (event) {
    bindAudio()
    if (event.detail.event === 'analysis-unavailable') { disconnectCapture(); captureFailed = true }
    if (['ready', 'listswitch'].includes(event.detail.event)) updateCover()
    if (event.detail.event !== 'timeupdate') syncSpectrum()
  })
  document.addEventListener('pjax:send', function () { ++coverRun; stopSpectrum(); stopDisc(); disconnectCapture(); if (audioContext) audioContext.suspend().catch(function () {}) })
  document.addEventListener('pjax:complete', init)
  document.addEventListener('visibilitychange', syncSpectrum)
  motion.addEventListener('change', function () { document.querySelectorAll('.lks-cover-stage img').forEach(function (node) { node.getAnimations().forEach(function (animation) { animation.finish() }) }); syncSpectrum() })
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})()
