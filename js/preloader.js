/* 遮罩有独立上限；只有首屏和 PJAX 导航会启用，不跟踪普通 API 请求。 */
(function () {
  'use strict'
  var box = document.getElementById('loading-box')
  if (!box) return
  var timer = 0
  var run = 0
  function end () {
    ++run
    clearTimeout(timer)
    box.classList.add('loaded')
    // 不改 body.overflow，避免覆盖搜索弹层和手机抽屉的滚动锁。
    if (window.Pace) window.Pace.stop()
  }
  function start () {
    ++run
    box.classList.remove('loaded')
    clearTimeout(timer)
    timer = setTimeout(end, 1800)
    if (window.Pace) window.Pace.restart()
  }
  function ready () {
    var current = run
    requestAnimationFrame(function () { requestAnimationFrame(function () { if (current === run) end() }) })
  }
  timer = setTimeout(end, 1800)
  box.addEventListener('click', end)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true })
  else ready()
  document.addEventListener('pjax:send', start)
  document.addEventListener('pjax:complete', end)
  document.addEventListener('pjax:error', end)
  window.addEventListener('pageshow', function (event) { if (event.persisted) end() })
})()
