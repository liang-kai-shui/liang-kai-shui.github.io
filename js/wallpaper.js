/* 顶栏的壁纸选项只决定下一张；点击“换一张”后交给 bg.js 加载。 */
(function () {
  'use strict'
  var panel
  var options
  var status
  var current
  var refresh
  var download
  var original
  var downloadStatus
  var downloading = false
  var lastUrl = null
  var close

  function node (tag, className, text) {
    var result = document.createElement(tag)
    if (className) result.className = className
    if (text !== undefined) result.textContent = text
    return result
  }

  function sync () {
    var api = window.lksBg
    if (!api) return
    var state = api.state()
    var toggle = document.getElementById('lks-wallpaper-toggle')
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(!!panel && !panel.hidden))
      toggle.setAttribute('aria-busy', String(state.loading))
    }
    if (!panel) return
    options.querySelectorAll('input').forEach(function (input) { input.checked = input.value === state.type })
    current.textContent = state.source ? '当前壁纸 · ' + state.source.label : '当前是默认壁纸'
    status.textContent = state.message || '选择类型，再换一张。设置会记住。'
    refresh.disabled = state.loading
    refresh.textContent = state.loading ? '正在换壁纸…' : '换一张'
    var url = api.current()
    if (url !== lastUrl && !downloading) downloadStatus.textContent = ''
    lastUrl = url
    download.disabled = downloading || !url
    download.textContent = downloading ? '正在准备…' : state.kind === 'video' ? '下载当前视频' : '下载当前壁纸'
    original.hidden = !url
    if (url) original.href = url
  }

  function downloadCurrent () {
    var api = window.lksBg
    var url = api && api.current()
    if (!url || downloading) return
    // 捕获点击时的文件。下载中再换壁纸也不会保存错对象。
    downloading = true
    downloadStatus.textContent = '正在准备原文件…'
    sync()
    var controller = new AbortController()
    var timer = setTimeout(function () { controller.abort() }, 20000)
    fetch(url, { mode: 'cors', credentials: 'omit', signal: controller.signal })
      .then(function (response) {
        if (!response.ok) throw new Error('下载失败')
        return response.blob()
      })
      .then(function (blob) {
        if (!blob.size || !/^(image|video)\//i.test(blob.type)) throw new Error('不是图片或视频')
        var extensions = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/avif': 'avif', 'video/mp4': 'mp4', 'video/webm': 'webm' }
        var extension = extensions[blob.type.split(';')[0]] || (new URL(url).pathname.match(/\.([a-z0-9]+)$/i) || [null, 'bin'])[1]
        var objectUrl = URL.createObjectURL(blob)
        var link = node('a')
        link.href = objectUrl
        link.setAttribute('data-pjax', 'false')
        // 临时下载链接在面板外，不触发面板的“点击外部收起”。
        link.addEventListener('click', function (event) { event.stopPropagation() })
        link.download = 'lks-wallpaper-' + Date.now() + '.' + extension
        document.body.appendChild(link)
        link.click()
        link.remove()
        setTimeout(function () { URL.revokeObjectURL(objectUrl) }, 60000)
        downloadStatus.textContent = '已发起保存，请查看浏览器下载。'
      })
      .catch(function () {
        downloadStatus.replaceChildren(document.createTextNode('图源限制或网络异常，'))
        var link = node('a', '', '打开这份原文件保存')
        link.href = url
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        link.setAttribute('data-pjax', 'false')
        downloadStatus.appendChild(link)
      })
      .finally(function () { clearTimeout(timer); downloading = false; sync() })
  }

  function build () {
    if (panel || !window.lksBg) return
    panel = node('section', 'lks-wallpaper-panel')
    panel.id = 'lks-wallpaper-panel'
    panel.hidden = true
    panel.setAttribute('aria-label', '壁纸设置')
    var header = node('div', 'lks-wallpaper-head')
    var title = node('strong', '', '换张壁纸')
    close = node('button', 'lks-wallpaper-close', '×')
    close.type = 'button'
    close.setAttribute('aria-label', '收起壁纸设置')
    close.addEventListener('click', function () { show(false, true) })
    header.append(title, close)
    current = node('p', 'lks-wallpaper-current')
    var fieldset = node('fieldset', 'lks-wallpaper-fieldset')
    fieldset.appendChild(node('legend', '', '下一张壁纸的类型'))
    options = node('div', 'lks-wallpaper-options')
    window.lksBg.types().forEach(function (type) {
      var label = node('label', 'lks-wallpaper-option')
      var input = node('input')
      input.type = 'radio'
      input.name = 'lks-wallpaper-type'
      input.value = type.id
      var text = node('span')
      text.append(node('strong', '', type.label), node('small', '', type.note))
      label.append(input, text)
      options.appendChild(label)
    })
    options.addEventListener('change', function (event) {
      if (event.target.matches('input[type="radio"]')) window.lksBg.setType(event.target.value)
    })
    fieldset.appendChild(options)
    var hint = node('p', 'lks-wallpaper-hint', '选择只影响下一张，不会刷新页面。')
    status = node('p', 'lks-wallpaper-status')
    status.setAttribute('role', 'status')
    refresh = node('button', 'lks-wallpaper-refresh', '换一张')
    refresh.type = 'button'
    refresh.addEventListener('click', function () { window.lksBg.refresh() })
    download = node('button', 'lks-wallpaper-download', '下载当前壁纸')
    download.type = 'button'
    download.addEventListener('click', downloadCurrent)
    var actions = node('div', 'lks-wallpaper-actions')
    actions.append(refresh, download)
    original = node('a', 'lks-wallpaper-original', '打开原文件 ↗')
    original.target = '_blank'
    original.rel = 'noopener noreferrer'
    original.setAttribute('data-pjax', 'false')
    downloadStatus = node('p', 'lks-wallpaper-download-status')
    downloadStatus.setAttribute('role', 'status')
    panel.append(header, current, fieldset, hint, actions, original, status, downloadStatus)
    document.body.appendChild(panel)
    sync()
  }

  function show (open, focus) {
    if (!panel && open !== false) build()
    if (!panel) return
    panel.hidden = open === undefined ? !panel.hidden : !open
    sync()
    if (focus) {
      var target = panel.hidden ? document.getElementById('lks-wallpaper-toggle') : close
      if (target) target.focus({ preventScroll: true })
    }
  }

  document.addEventListener('click', function (event) {
    var button = event.target.closest('#lks-wallpaper-toggle')
    if (button) { show(undefined, true); return }
    if (panel && !panel.hidden && !panel.contains(event.target)) show(false, false)
  })
  document.addEventListener('keydown', function (event) {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.closest('#lks-wallpaper-toggle')) {
      event.preventDefault()
      show(undefined, true)
    }
    if (event.key === 'Escape' && panel && !panel.hidden) { event.preventDefault(); show(false, true) }
    if (event.key === 'Tab' && panel && !panel.hidden) {
      // 只有焦点在面板中时保持循环；鼠标点到页面其他地方仍可关闭。
      var targets = Array.from(panel.querySelectorAll('button:not(:disabled), input:checked'))
      var first = targets[0]
      var last = targets[targets.length - 1]
      if (event.shiftKey && event.target === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && event.target === last) { event.preventDefault(); first.focus() }
    }
  })
  document.addEventListener('lks:bg-change', sync)
  document.addEventListener('pjax:send', function () { show(false, false) })
  document.addEventListener('pjax:complete', sync)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync)
  else sync()
})()
