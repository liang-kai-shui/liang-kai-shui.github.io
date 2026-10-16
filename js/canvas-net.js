/* 蓝色网线：空间分桶、限帧与后台暂停，避免每帧两两比较全部粒子。 */
(function () {
  'use strict'
  if (window.lksCanvasNet) return
  var script = document.getElementById('canvas_nest')
  if (!script) return
  var motion = matchMedia('(prefers-reduced-motion: reduce)')
  var canvas = document.createElement('canvas'), ctx = canvas.getContext('2d')
  if (!ctx) return
  canvas.id = 'lks-canvas-net'; canvas.setAttribute('aria-hidden', 'true')
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;'
  canvas.style.zIndex = script.getAttribute('zIndex') || '-1'
  canvas.style.opacity = script.getAttribute('opacity') || '.7'
  ;(document.getElementById('site-runtime') || document.body).appendChild(canvas)
  var color = script.getAttribute('color') || '0,0,255'
  var wanted = Math.max(1, Math.min(150, Number(script.getAttribute('count')) || 99))
  var width = 0, height = 0, points = [], frame = 0, last = 0, narrow = false
  var pointer = { x: -1000, y: -1000 }, stats = { frames: 0, checks: 0, lines: 0, particles: 0, fps: 24 }
  var distance = 125
  function resize () {
    width = innerWidth; height = innerHeight; narrow = width <= 768
    var ratio = Math.min(devicePixelRatio || 1, narrow ? 1.25 : 1.5)
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio)
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    stats.fps = narrow ? 15 : 24
    var count = Math.min(wanted, narrow ? Math.max(18, Math.min(28, Math.round(width * height / 22000))) : Math.max(32, Math.min(64, Math.round(width * height / 26000))))
    points = Array.from({ length: count }, function () { return { x: Math.random() * width, y: Math.random() * height, vx: (Math.random() - .5) * .6, vy: (Math.random() - .5) * .6 } })
    stats.particles = count
  }
  function draw (dt) {
    ctx.clearRect(0, 0, width, height)
    var cells = new Map(), size = distance, limit = distance * distance
    stats.checks = 0; stats.lines = 0
    points.forEach(function (p, i) {
      p.x += p.vx * dt; p.y += p.vy * dt
      if (p.x < 0 || p.x > width) { p.vx *= -1; p.x = Math.max(0, Math.min(width, p.x)) }
      if (p.y < 0 || p.y > height) { p.vy *= -1; p.y = Math.max(0, Math.min(height, p.y)) }
      var dx = pointer.x - p.x, dy = pointer.y - p.y, d = dx * dx + dy * dy
      if (d < 180 * 180 && d > 25 * 25) { p.x += dx * .006 * dt; p.y += dy * .006 * dt }
      var key = Math.floor(p.x / size) + ',' + Math.floor(p.y / size)
      if (!cells.has(key)) cells.set(key, [])
      cells.get(key).push(i)
      ctx.fillStyle = 'rgba(' + color + ',.35)'; ctx.fillRect(p.x, p.y, 1, 1)
    })
    function link (p, q, alpha) {
      ctx.strokeStyle = 'rgba(' + color + ',' + alpha.toFixed(3) + ')'
      ctx.lineWidth = .6; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); ++stats.lines
    }
    points.forEach(function (p, i) {
      var cx = Math.floor(p.x / size), cy = Math.floor(p.y / size), links = 0
      for (var x = cx - 1; x <= cx + 1; x++) for (var y = cy - 1; y <= cy + 1; y++) {
        var group = cells.get(x + ',' + y) || []
        for (var k = 0; k < group.length && links < 5; k++) {
          if (group[k] <= i) continue
          ++stats.checks
          var q = points[group[k]], dx = p.x - q.x, dy = p.y - q.y, d = dx * dx + dy * dy
          if (d < limit) { link(p, q, (1 - d / limit) * .6); ++links }
        }
      }
      var dx = pointer.x - p.x, dy = pointer.y - p.y, d = dx * dx + dy * dy
      if (d < 180 * 180) link(p, pointer, (1 - d / (180 * 180)) * .65)
    })
    ++stats.frames
  }
  function tick (time) {
    frame = 0
    if (document.hidden || motion.matches) return
    if (!last || time - last >= 1000 / stats.fps) { var dt = last ? Math.min(3, (time - last) / 16.67) : 1; last = time; draw(dt) }
    frame = requestAnimationFrame(tick)
  }
  function sync () {
    cancelAnimationFrame(frame); frame = 0; last = 0
    canvas.hidden = motion.matches || (narrow && script.getAttribute('mobile') === 'false')
    if (!document.hidden && !canvas.hidden) frame = requestAnimationFrame(tick)
  }
  window.addEventListener('pointermove', function (event) { if (event.pointerType === 'touch') return; pointer.x = event.clientX; pointer.y = event.clientY }, { passive: true })
  window.addEventListener('pointerout', function (event) { if (!event.relatedTarget) pointer.x = pointer.y = -1000 })
  var resizeTimer = 0
  window.addEventListener('resize', function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(function () { resize(); sync() }, 120) }, { passive: true })
  document.addEventListener('visibilitychange', sync)
  motion.addEventListener('change', sync)
  window.lksCanvasNet = { stats: stats }
  resize(); sync()
})()
