/* 封面过渡、封面取色和频谱共用原播放器；分析分支从不接入扬声器。 */
(function () {
  'use strict'
  var room = null, current = null, coverRun = 0
  var images = new Map(), palette = { h: 205, s: 40, h2: 234, source: 'fallback' }
  var motion = matchMedia('(prefers-reduced-motion: reduce)')
  var audioContext = null, analyser = null, stream = null, source = null, audioTrack = null
  var spectrumFrame = 0, lastFrame = 0, bins = null, levels = new Float32Array(40)
  var visible = true, enabled = true, observer = null, spectrumState = ''
  var captureAudio = null, captureFailed = false

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
        analyser = audioContext.createAnalyser(); analyser.fftSize = 512; analyser.smoothingTimeConstant = .8
        analyser.minDecibels = -75; analyser.maxDecibels = -5
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
    var canvas = room.querySelector('.lks-room-spectrum canvas'), ctx = canvas.getContext('2d')
    if (!ctx) return
    var width = canvas.clientWidth, height = canvas.clientHeight, ratio = Math.min(devicePixelRatio || 1, 2)
    if (!width || !height) return
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio) }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height)
    if (live && analyser) analyser.getByteFrequencyData(bins)
    var gradient = ctx.createLinearGradient(0, 0, width, height)
    gradient.addColorStop(0, 'hsla(' + palette.h + ', ' + palette.s + '%, 65%, .75)')
    gradient.addColorStop(1, 'hsla(' + palette.h2 + ', ' + palette.s + '%, 55%, .3)')
    ctx.fillStyle = gradient
    var gap = width < 270 ? 3 : 4, barWidth = (width - gap * (levels.length - 1)) / levels.length, peak = 0
    for (var i = 0; i < levels.length; i++) {
      // 对数频段平均，左右镜像形成低矮、收束的频谱。
      var band = i < 20 ? 19 - i : i - 20
      var from = Math.floor(Math.pow(band / 20, 1.8) * 170) + 1
      var to = Math.max(from + 1, Math.floor(Math.pow((band + 1) / 20, 1.8) * 170) + 1)
      var value = 0
      if (live && bins) { for (var k = from; k < to; k++) value += bins[k] || 0; value = value / (to - from) / 255 }
      levels[i] += (value - levels[i]) * .35
      peak = Math.max(peak, value)
      var barHeight = 2 + levels[i] * (height - 9)
      ctx.beginPath(); ctx.roundRect(i * (barWidth + gap), (height - barHeight) / 2, barWidth, barHeight, Math.min(2, barWidth / 2)); ctx.fill()
    }
    canvas.dataset.energy = peak.toFixed(3)
    canvas.dataset.frames = String(Number(canvas.dataset.frames || 0) + 1)
  }
  function stopSpectrum () { cancelAnimationFrame(spectrumFrame); spectrumFrame = 0; levels.fill(0); drawSpectrum(0, false) }
  function tick (timestamp) {
    spectrumFrame = 0
    if (!room || !visible || document.hidden || !enabled || motion.matches) return
    var p = player()
    if (!p || p.audio.paused || p.audio.ended) return
    if (timestamp - lastFrame >= 1000 / 24) { lastFrame = timestamp; drawSpectrum(timestamp, true) }
    spectrumFrame = requestAnimationFrame(tick)
  }
  function syncSpectrum () {
    var p = player()
    if (!room || !room.isConnected) { stopSpectrum(); return }
    if (!enabled) { stopSpectrum(); state('off', '频谱已关闭'); return }
    if (motion.matches) { stopSpectrum(); state('reduced', '静态聆听'); return }
    if (!visible || document.hidden) { stopSpectrum(); return }
    if (!p || p.audio.paused || p.audio.ended) { stopSpectrum(); state('idle', '等待播放'); return }
    if (!ensureAnalysis()) { stopSpectrum(); state('unavailable', '安心听歌'); return }
    state('live', '随音乐起伏')
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
    stopSpectrum()
    if (observer) observer.disconnect()
    room = document.querySelector('.lks-music-room'); current = null; visible = true
    if (room) {
      applyPalette()
      var toggle = room.querySelector('.lks-spectrum-toggle')
      toggle.setAttribute('aria-pressed', String(enabled))
      toggle.addEventListener('click', function () { enabled = !enabled; toggle.setAttribute('aria-pressed', String(enabled)); toggle.setAttribute('aria-label', enabled ? '关闭音频可视化' : '打开音频可视化'); toggle.title = toggle.getAttribute('aria-label'); syncSpectrum() })
      if (window.IntersectionObserver) {
        observer = new IntersectionObserver(function (entries) { visible = entries[0].isIntersecting; syncSpectrum() })
        observer.observe(room.querySelector('.lks-room-spectrum'))
      }
    }
    bindAudio(); updateCover(); syncSpectrum()
  }
  document.addEventListener('lks:music', function (event) {
    bindAudio()
    if (event.detail.event === 'analysis-unavailable') { disconnectCapture(); captureFailed = true }
    if (['ready', 'listswitch'].includes(event.detail.event)) updateCover()
    if (event.detail.event !== 'timeupdate') syncSpectrum()
  })
  document.addEventListener('pjax:send', function () { ++coverRun; stopSpectrum(); disconnectCapture(); if (audioContext) audioContext.suspend().catch(function () {}) })
  document.addEventListener('pjax:complete', init)
  document.addEventListener('visibilitychange', syncSpectrum)
  motion.addEventListener('change', function () { document.querySelectorAll('.lks-cover-stage img').forEach(function (node) { node.getAnimations().forEach(function (animation) { animation.finish() }) }); syncSpectrum() })
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})()
