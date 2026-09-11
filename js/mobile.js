/*!
 * 手机端交互增强
 *   1. 图片灯箱：点正文里的图片 → 全屏看大图（点任意处 / 按 Esc / 向下滑 关闭）
 *   2. 抽屉菜单或灯箱打开时，锁住背后页面的滚动
 *
 * 为什么不用主题自带的 lightbox（fancybox / medium_zoom）：
 *   那套会往每个页面注入整套 JS/CSS，而且会在渲染阶段给 <img> 加属性，
 *   等于动到 HTML 结构；站里只是"点开看大图"这一个需求，自己写几十行更省。
 *
 * 和 nav-extras.js 一样，事件全部委托在 document 上：
 *   pjax 站内跳转会换掉整个内容区，绑在元素上的监听器会跟着旧元素一起失效。
 *
 * 由 _config.butterfly.yml → inject.bottom 引入；样式在 source/css/mobile.css。
 */
(function () {
  'use strict'

  var IMG_SELECTOR = '#article-container img, .post-content img'
  var MIN_SIZE = 80          // 小于这个尺寸的图不当内容图（表情、徽章之类）
  var SWIPE_CLOSE = 80       // 向下滑多少像素算"关闭"

  /* ------------------------------------------------------------------ *
   * 滚动锁：抽屉和灯箱都要用
   * 手机上直接给 body 加 overflow:hidden 是没用的（滚的是 html），
   * 所以用经典的 position:fixed + 负 top 方案，关闭时再滚回原位。
   * ------------------------------------------------------------------ */
  var lockedY = 0
  var locked = false

  function lockScroll (on) {
    var body = document.body
    if (on === locked) return
    if (on) {
      lockedY = window.pageYOffset || document.documentElement.scrollTop || 0
      // 桌面端滚动条会消失导致内容横移，用 padding 补上
      var gap = window.innerWidth - document.documentElement.clientWidth
      if (gap > 0) body.style.paddingRight = gap + 'px'
      body.style.top = -lockedY + 'px'
      body.classList.add('lks-lock')
      locked = true
    } else {
      body.classList.remove('lks-lock')
      body.style.top = ''
      body.style.paddingRight = ''
      locked = false
      if (lockedY) window.scrollTo(0, lockedY)
    }
  }

  /* ------------------------------------------------------------------ *
   * 抽屉菜单：打开时锁滚动
   * 抽屉是主题自己的 JS 在管（加/删 #sidebar-menus.open），
   * 这里只在点完之后对一下状态，不去改它的逻辑。
   * ------------------------------------------------------------------ */
  function drawerOpen () {
    var el = document.getElementById('sidebar-menus')
    return !!(el && el.classList.contains('open'))
  }

  function syncDrawerLock () {
    // 灯箱开着的时候不要被抽屉解锁
    if (lightboxOpen) return
    lockScroll(drawerOpen())
  }

  document.addEventListener('click', function (e) {
    var t = e.target
    var inToggle = t.closest && t.closest('#toggle-menu')
    var inMask = t.closest && t.closest('#menu-mask')
    if (!inToggle && !inMask) return
    // 主题是同步加类，这里等一拍再读
    setTimeout(syncDrawerLock, 0)
    setTimeout(syncDrawerLock, 320)
  })

  if (window.btf && window.btf.addGlobalFn) {
    window.btf.addGlobalFn('pjaxComplete', syncDrawerLock, 'lksMobile')
  }
  document.addEventListener('pjax:complete', function () { setTimeout(syncDrawerLock, 60) })

  /* ------------------------------------------------------------------ *
   * 图片灯箱
   * ------------------------------------------------------------------ */
  var box = null
  var boxImg = null
  var boxHint = null
  var lightboxOpen = false
  var touchStartY = 0

  function build () {
    box = document.createElement('div')
    box.className = 'lks-lightbox'
    box.setAttribute('role', 'dialog')
    box.setAttribute('aria-modal', 'true')

    boxImg = document.createElement('img')
    boxImg.alt = ''
    box.appendChild(boxImg)

    boxHint = document.createElement('div')
    boxHint.className = 'lks-lightbox-hint'
    box.appendChild(boxHint)

    // 点空白处关闭；点图片本身不关（方便双击放大看细节）
    box.addEventListener('click', function (e) {
      if (e.target === box) close()
    })

    // 手机上向下滑关闭。
    // 只在这张图没超出屏幕时才启用 —— 长图本身要能上下拖着看，
    // 否则想滚下去看图会被当成"关闭"。
    function swipeClosable () {
      if (!boxImg) return false
      return boxImg.getBoundingClientRect().height <= window.innerHeight - 40
    }

    box.addEventListener('touchstart', function (e) {
      touchStartY = swipeClosable() ? e.touches[0].clientY : 0
    }, { passive: true })
    box.addEventListener('touchmove', function (e) {
      if (!touchStartY) return
      if (e.touches[0].clientY - touchStartY > SWIPE_CLOSE) {
        touchStartY = 0
        close()
      }
    }, { passive: true })
    box.addEventListener('touchend', function () { touchStartY = 0 }, { passive: true })

    document.body.appendChild(box)
  }

  function open (img) {
    if (!box) build()
    boxImg.src = img.currentSrc || img.src
    boxImg.alt = img.alt || ''
    boxHint.textContent = (img.alt ? img.alt + ' · ' : '') + '点空白处或按 Esc 关闭'
    document.body.appendChild(box)
    lightboxOpen = true
    lockScroll(true)
    // 下一帧再加 show，否则 transition 不生效
    requestAnimationFrame(function () { box.classList.add('show') })
  }

  function close () {
    if (!box || !lightboxOpen) return
    lightboxOpen = false
    box.classList.remove('show')
    setTimeout(function () {
      if (!lightboxOpen && box && box.parentNode) box.parentNode.removeChild(box)
    }, 240)
    lockScroll(false)
    // 如果抽屉还开着，把锁交还给抽屉
    setTimeout(syncDrawerLock, 260)
  }

  document.addEventListener('click', function (e) {
    if (lightboxOpen) return
    var img = e.target
    if (!img || img.tagName !== 'IMG') return
    if (!img.matches || !img.matches(IMG_SELECTOR)) return
    // 包在链接里的图（比如友链卡片）让链接正常工作
    if (img.closest('a')) return
    var r = img.getBoundingClientRect()
    if (r.width < MIN_SIZE || r.height < MIN_SIZE) return
    e.preventDefault()
    open(img)
  })

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && lightboxOpen) close()
  })

  window.lksMobile = { openLightbox: open, closeLightbox: close, lockScroll: lockScroll }
})()
