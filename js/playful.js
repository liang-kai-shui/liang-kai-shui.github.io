/* 五个小动效共用一个入口；PJAX 换页后只重建页面内的部分。 */
(function () {
  'use strict'

  var headingObserver = null
  var themeReplay = false
  var cardMedia = window.matchMedia('(hover: hover) and (pointer: fine)')
  var motionMedia = window.matchMedia('(prefers-reduced-motion: reduce)')

  function reducedMotion () { return motionMedia.matches }

  // 首页卡片跟着鼠标轻轻偏转，离开后立刻回正。
  document.addEventListener('pointermove', function (event) {
    if (!cardMedia.matches || reducedMotion()) return
    var card = event.target.closest && event.target.closest('#recent-posts .recent-post-item')
    if (!card) return
    var rect = card.getBoundingClientRect()
    var x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
    var y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
    card.style.setProperty('--lks-rx', ((0.5 - y) * 5).toFixed(2) + 'deg')
    card.style.setProperty('--lks-ry', ((x - 0.5) * 5).toFixed(2) + 'deg')
    card.style.setProperty('--lks-mx', (x * 100).toFixed(0) + '%')
    card.style.setProperty('--lks-my', (y * 100).toFixed(0) + '%')
    card.classList.add('lks-tilt')
  }, { passive: true })

  document.addEventListener('pointerout', function (event) {
    var card = event.target.closest && event.target.closest('#recent-posts .recent-post-item.lks-tilt')
    if (card && (!event.relatedTarget || !card.contains(event.relatedTarget))) {
      card.classList.remove('lks-tilt')
      card.style.removeProperty('--lks-rx')
      card.style.removeProperty('--lks-ry')
    }
  }, { passive: true })

  // 用主题原本的按钮切换，保留它的记忆、提示和其他主题回调。
  document.addEventListener('click', function (event) {
    var button = event.target.closest && event.target.closest('#darkmode, #lks-darkmode-button')
    if (!button || themeReplay || reducedMotion() || typeof document.startViewTransition !== 'function') return
    event.preventDefault()
    event.stopPropagation()
    var rect = button.getBoundingClientRect()
    var root = document.documentElement
    root.classList.add('lks-theme-switching')
    root.style.setProperty('--lks-vt-x', (rect.left + rect.width / 2) + 'px')
    root.style.setProperty('--lks-vt-y', (rect.top + rect.height / 2) + 'px')
    var clean = function () {
      root.style.removeProperty('--lks-vt-x')
      root.style.removeProperty('--lks-vt-y')
      root.classList.remove('lks-theme-switching')
    }
    try {
      var transition = document.startViewTransition(function () {
        themeReplay = true
        try { button.click() } finally { themeReplay = false }
        if (window.lksNav && window.lksNav.syncIcon) window.lksNav.syncIcon()
      })
      transition.finished.then(clean, clean)
    } catch (err) {
      clean()
      themeReplay = true
      try { button.click() } finally { themeReplay = false }
    }
  }, true)

  // 主题自带的复制按钮由 main.js 创建；这里接管点击，等复制成功再反馈。
  function showCopyMessage (message) {
    if (window.btf && typeof window.btf.snackbarShow === 'function') window.btf.snackbarShow(message)
  }

  document.addEventListener('click', function (event) {
    var button = event.target.closest && event.target.closest('#article-container .copy-button')
    if (!button) return
    var block = button.closest('figure.highlight')
    var code = block && block.querySelector('table .code pre, pre code')
    if (!code) return
    event.preventDefault()
    event.stopPropagation()
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      showCopyMessage('浏览器暂不支持一键复制')
      return
    }
    navigator.clipboard.writeText(code.innerText).then(function () {
      button.classList.remove('fa-paste')
      button.classList.add('fa-check')
      button.setAttribute('aria-label', '复制成功')
      block.classList.remove('lks-copied')
      void block.offsetWidth // 连续复制时重新播放一次
      block.classList.add('lks-copied')
      showCopyMessage('复制成功')
      clearTimeout(button.lksResetTimer)
      button.lksResetTimer = setTimeout(function () {
        button.classList.remove('fa-check')
        button.classList.add('fa-paste')
        button.setAttribute('aria-label', '复制代码')
        block.classList.remove('lks-copied')
      }, 1200)
    }).catch(function () { showCopyMessage('复制失败，请手动选择代码') })
  }, true)

  document.addEventListener('keydown', function (event) {
    var button = event.target.closest && event.target.closest('#article-container .copy-button')
    if (button && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault()
      button.click()
    }
  })

  function initHeadings () {
    if (headingObserver) headingObserver.disconnect()
    if (reducedMotion() || typeof IntersectionObserver === 'undefined') return
    var headings = document.querySelectorAll('#article-container h2, #article-container h3, #article-container h4')
    if (!headings.length) return
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return
        entry.target.classList.add('lks-heading-lit')
        observer.unobserve(entry.target)
      })
    }, { rootMargin: '0px 0px -25% 0px', threshold: 0 })
    headingObserver = observer
    headings.forEach(function (heading) { observer.observe(heading) })
  }

  function initCopyButtons () {
    document.querySelectorAll('#article-container .copy-button').forEach(function (button) {
      button.setAttribute('role', 'button')
      button.setAttribute('tabindex', '0')
      button.setAttribute('aria-label', '复制代码')
    })
  }

  function initLostPage () {
    var info = document.querySelector('.type-404 .error-info, #error-wrap .error-info')
    if (!info || info.querySelector('.lks-lost-actions')) return
    var actions = document.createElement('div')
    actions.className = 'lks-lost-actions'
    var stars = document.createElement('div')
    stars.className = 'lks-lost-stars'
    stars.setAttribute('aria-hidden', 'true')
    for (var i = 0; i < 7; i++) {
      var star = document.createElement('i')
      star.style.setProperty('--lks-star-x', ((i - 3) * 20) + 'px')
      star.style.setProperty('--lks-star-delay', (i * -0.31) + 's')
      stars.appendChild(star)
    }
    var note = document.createElement('p')
    note.className = 'lks-lost-note'
    note.textContent = '好像走错路了，换篇文章逛逛？'
    var link = document.createElement('a')
    link.className = 'lks-lost-link'
    link.href = '/'
    link.textContent = '带我随机逛一篇 →'
    link.addEventListener('click', function (event) {
      event.preventDefault()
      fetch('/posts-index.json').then(function (response) {
        if (!response.ok) throw new Error('文章列表不可用')
        return response.json()
      }).then(function (posts) {
        if (!posts.length) throw new Error('文章列表为空')
        window.location.href = posts[Math.floor(Math.random() * posts.length)].u
      }).catch(function () { window.location.href = '/' })
    })
    actions.appendChild(stars)
    actions.appendChild(note)
    actions.appendChild(link)
    info.appendChild(actions)
  }

  function initPage () {
    initHeadings()
    initCopyButtons()
    initLostPage()
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPage)
  else initPage()
  document.addEventListener('pjax:complete', function () { setTimeout(initPage, 0) })
})()
