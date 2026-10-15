/*!
 * 摸鱼小窝 · 随机底图与顶栏手动换壁纸
 *
 * 图源优先用「栗次元 API」（https://t.alcy.cc）：
 *   桌面端：二次元自适应 /ycy  ｜ PC 横图 /pc  ｜ ACG 动图 /acg   ← 按权重随机挑一个
 *   移动端：移动竖图 /mp                                        ← 屏幕窄就用竖图
 * 使用接口的 ?json 输出取得固定原文件地址（实际返回纯文本 URL），所以：
 *   - 每次刷新都能换（URL 上带随机参数，绕开浏览器/CDN 缓存）
 *   - /acg 是视频，用 <video> 铺在背景层，不是 CSS background-image
 *
 * 兜底：接口超时/挂了，就退回自己的图床底图池（img/bg/，由 tools/pick-backgrounds.py 维护）。
 *
 * 行为：
 *   1. 预加载成功才换上去，避免半张图闪一下
 *   2. 换的是网站背景底图 #web_bg；本来就有头图的非文章页（比如首页）头图跟着用同一张
 *   3. 文章页头图是文章自己的封面，不动它
 *   4. pjax 站内跳转不重新抽；刷新页面或使用顶栏入口才换
 *   5. 动图在「系统开了减少动态效果」或「浏览器开了省流量」时自动跳过
 *
 * 由 _config.butterfly.yml → inject.bottom 引入。
 */
(function () {
  'use strict'

  /* ------------------------- 配置 ------------------------- */

  var API_BASE = 'https://t.alcy.cc'

  // 每个接口的 weight 就是被抽中的概率权重（acg 是几 MB 的 mp4，所以权重压得低）
  var SOURCES = {
    desktop: [
      { name: 'ycy', label: '二次元自适应', weight: 3 },
      { name: 'pc', label: 'PC 横图', weight: 3 },
      { name: 'acg', label: 'ACG 动图', weight: 1, video: true }
    ],
    mobile: [
      { name: 'mp', label: '移动竖图', weight: 1 }
    ]
  }

  var MOBILE_MAX_WIDTH = 768      // 屏幕宽度小于它就当手机，用竖图
  var USE_VIDEO = true            // 是否允许用 /acg 的 mp4 当背景（false = 只用静态图）

  // 兜底用的图床底图池
  var POOL = {
    base: 'https://pic-bed-e0x.pages.dev',
    dir: '/img/bg/',
    cacheKey: 'lks-bg-manifest',
    lastKey: 'lks-bg-last',
    ttl: 6 * 60 * 60 * 1000,
    fallback: ['bg001.webp', 'bg013.webp', 'bg024.webp', 'bg037.webp', 'bg050.webp']
  }

  var VIDEO_ID = 'lks-bg-video'
  var currentUrl = null
  var currentSource = null
  var currentKind = null          // 'image' | 'video' | 'pool'
  var pending = null
  var loading = false
  var message = ''
  var TYPE_KEY = 'lks-bg-type'
  var TYPES = [
    { id: 'auto', label: '随机推荐', note: '按屏幕挑选，偶尔来张动态' },
    { id: 'static', label: '静态随机', note: '只挑静态壁纸' },
    { id: 'acg', label: '动态壁纸', note: '静音循环的动态背景' },
    { id: 'ycy', label: '二次元插画', note: '根据屏幕自适应' },
    { id: 'pc', label: '横屏插画', note: '适合电脑横屏' },
    { id: 'mp', label: '手机竖图', note: '适合竖屏浏览' },
    { id: 'pool', label: '收藏图池', note: '从博客自有图池挑一张' }
  ]
  var selectedType = 'auto'
  try { selectedType = normalType(localStorage.getItem(TYPE_KEY)) } catch (e) {}

  function normalType (type) { return TYPES.some(function (item) { return item.id === type }) ? type : 'auto' }
  function setType (type) {
    selectedType = normalType(type)
    try { localStorage.setItem(TYPE_KEY, selectedType) } catch (e) {}
    announce()
  }
  function announce () { document.dispatchEvent(new CustomEvent('lks:bg-change')) }
  function alive (job) { return !job || !job.cancelled }
  function discardVideo (video) {
    if (!video) return
    video.pause()
    video.removeAttribute('src')
    video.load()
    video.remove()
  }

  /* ------------------------- 小工具 ------------------------- */

  function isMobile () {
    return window.matchMedia('(max-width: ' + MOBILE_MAX_WIDTH + 'px)').matches
  }

  function prefersReducedMotion () {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  function saveDataOn () {
    var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection
    return !!(c && c.saveData)
  }

  function weightedPick (list) {
    var total = list.reduce(function (sum, s) { return sum + (s.weight || 1) }, 0)
    var r = Math.random() * total
    for (var i = 0; i < list.length; i++) {
      r -= (list[i].weight || 1)
      if (r <= 0) return list[i]
    }
    return list[list.length - 1]
  }

  // 接口地址：带随机参数，绕开缓存，保证每次刷新都是一张新的
  function apiUrl (name) {
    return API_BASE + '/' + name + '?json&r=' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  }

  // 先固定这一张的地址，下载时不再访问随机接口，避免保存成另一张。
  function resolveSource (source, job) {
    var controller = new AbortController()
    var timer = setTimeout(function () { controller.abort() }, 6000)
    if (job) job.cancel.push(function () { controller.abort() })
    return fetch(apiUrl(source.name), { signal: controller.signal, credentials: 'omit', cache: 'no-store' })
      .then(function (res) { if (!res.ok) throw new Error('图源暂不可用'); return res.text() })
      .then(function (text) {
        var url = new URL(text.trim())
        if (url.origin !== API_BASE || !/^\/pic\/[a-z0-9/_-]+\.(webp|png|jpe?g|gif|mp4|webm)$/i.test(url.pathname)) throw new Error('原文件地址不可用')
        return url.href
      })
      .finally(function () { clearTimeout(timer) })
  }

  function injectStyleOnce () {
    if (document.getElementById('lks-bg-style')) return
    var style = document.createElement('style')
    style.id = 'lks-bg-style'
    style.textContent =
      '#' + VIDEO_ID + '{position:absolute;inset:0;width:100%;height:100%;' +
      'object-fit:cover;pointer-events:none;z-index:-1;}' +
      '#web_bg{overflow:hidden;}'
    document.head.appendChild(style)
  }

  // 手动指定：网址后面加 ?bg=pc / ?bg=acg / ?bg=mp 只出这一类，?bg=off 完全不换
  function urlOverride () {
    var m = /[?&]bg=([a-z0-9]+)/i.exec(window.location.search || '')
    return m ? m[1].toLowerCase() : ''
  }

  /* ------------------------- 应用 ------------------------- */

  function applyBackground (url) {
    var bg = document.getElementById('web_bg')
    if (!bg) return false
    bg.style.backgroundImage = 'url("' + url + '")'
    var video = document.getElementById(VIDEO_ID)
    discardVideo(video)
    return true
  }

  function applyHeader (url, kind) {
    var header = document.getElementById('page-header')
    if (!header) return false
    if (header.classList.contains('post-bg')) return false   // 文章页头图是这篇自己的封面
    if (!header.style.backgroundImage) return false          // 本来没头图的页面不硬塞
    if (header.lksOriginalBgColor === undefined) header.lksOriginalBgColor = header.style.backgroundColor
    header.style.backgroundImage = kind === 'video' ? 'none' : 'url("' + url + '")'
    header.style.backgroundColor = kind === 'video' ? 'transparent' : header.lksOriginalBgColor
    return true
  }

  function remember (url, source, kind) {
    currentUrl = url
    currentSource = source
    currentKind = kind
    try { localStorage.setItem(POOL.lastKey, url) } catch (e) { /* 隐私模式忽略 */ }
  }

  function preloadImage (url, job) {
    return new Promise(function (resolve) {
      var img = new Image()
      var done = false
      var timer
      var finish = function (ok) {
        if (done) return
        done = true
        clearTimeout(timer)
        img.onload = img.onerror = null
        if (!ok) img.removeAttribute('src')
        resolve(ok && alive(job))
      }
      if (job) job.cancel.push(function () { finish(false) })
      img.onload = function () { finish(true) }
      img.onerror = function () { finish(false) }
      timer = setTimeout(function () { finish(false) }, 12000)
      img.src = url
    })
  }

  function applyImage (url, source, job) {
    return preloadImage(url, job).then(function (ok) {
      if (!ok || !alive(job)) return false
      var didBg = applyBackground(url)
      applyHeader(url)
      if (didBg) remember(url, source, 'image')
      return didBg
    })
  }

  function applyVideo (url, source, job) {
    var bg = document.getElementById('web_bg')
    if (!bg) return Promise.resolve(false)

    injectStyleOnce()
    return new Promise(function (resolve) {
      // 先加载新视频，能播放后再替换；旧背景不会在加载期间消失。
      var video = document.createElement('video')
      video.id = VIDEO_ID
      video.muted = true
      video.loop = true
      video.autoplay = true
      video.playsInline = true
      video.setAttribute('muted', '')
      video.setAttribute('playsinline', '')
      video.setAttribute('webkit-playsinline', '')
      var done = false
      var timer
      var finish = function (ok) {
        if (done) return
        done = true
        clearTimeout(timer)
        video.oncanplay = video.onerror = null
        ok = ok && alive(job)
        if (ok) {
          discardVideo(document.getElementById(VIDEO_ID))
          bg.appendChild(video)
          applyHeader(url, 'video')
          remember(url, source, 'video')
          var p = video.play()
          if (p && p.catch) p.catch(function () { /* 自动播放被拦就静默降级成首帧 */ })
        } else discardVideo(video)
        resolve(ok)
      }
      if (job) job.cancel.push(function () { finish(false) })
      video.oncanplay = function () { finish(true) }
      video.onerror = function () { finish(false) }
      timer = setTimeout(function () { finish(false) }, 12000)
      video.src = url
      video.load()
    })
  }

  /* ------------------------- 图床池兜底 ------------------------- */

  function urlOf (name) { return POOL.base + POOL.dir + name }

  function readPoolCache () {
    try {
      var raw = JSON.parse(localStorage.getItem(POOL.cacheKey) || 'null')
      if (raw && raw.list && raw.list.length && Date.now() - raw.t < POOL.ttl) return raw.list
    } catch (e) { /* 忽略 */ }
    return null
  }

  function loadPool (job) {
    var cached = readPoolCache()
    if (cached) return Promise.resolve(cached)
    var controller = new AbortController()
    var timer = setTimeout(function () { controller.abort() }, 6000)
    if (job) job.cancel.push(function () { controller.abort() })
    return fetch(POOL.base + POOL.dir + 'list.json', { cache: 'no-cache', signal: controller.signal })
      .then(function (res) { if (!res.ok) throw new Error('图池暂不可用'); return res.json() })
      .then(function (data) {
        var list = ((data && data.images) || []).filter(function (name) { return typeof name === 'string' && /^[a-z0-9_-]+\.(webp|png|jpg|jpeg)$/i.test(name) })
        if (!list.length) throw new Error('清单是空的')
        try { localStorage.setItem(POOL.cacheKey, JSON.stringify({ t: Date.now(), list: list })) } catch (e) { /* 忽略 */ }
        return list
      })
      .catch(function () { return POOL.fallback })
      .finally(function () { clearTimeout(timer) })
  }

  function pickFromPool (list) {
    if (list.length < 2) return list[0]
    var last = ''
    try { last = localStorage.getItem(POOL.lastKey) || '' } catch (e) { /* 忽略 */ }
    var pool = list.filter(function (n) { return urlOf(n) !== last })
    if (!pool.length) pool = list
    return pool[Math.floor(Math.random() * pool.length)]
  }

  function usePool (why, job) {
    if (!alive(job)) return Promise.resolve(false)
    console.warn('[bg] 改用图床底图池兜底：' + why)
    return loadPool(job).then(function (list) {
      if (!alive(job)) return false
      return applyImage(urlOf(pickFromPool(list)), { name: 'pool', label: '收藏图池' }, job)
    })
  }

  /* ------------------------- 主流程 ------------------------- */

  function change (type, persist) {
    type = normalType(type)
    if (pending) {
      pending.cancelled = true
      pending.cancel.forEach(function (cancel) { cancel() })
    }
    var job = { cancelled: false, cancel: [] }
    pending = job
    selectedType = type
    if (persist) { try { localStorage.setItem(TYPE_KEY, type) } catch (e) {} }
    loading = true
    message = '正在加载下一张壁纸，原来的先留着…'
    announce()
    var mobile = isMobile()
    var list = mobile ? SOURCES.mobile : SOURCES.desktop
    var source = null
    var limited = false
    var fallback = false
    if (type !== 'auto' && type !== 'static' && type !== 'pool') {
      var all = SOURCES.desktop.concat(SOURCES.mobile)
      for (var i = 0; i < all.length; i++) {
        if (all[i].name === type) { source = all[i]; break }
      }
    }
    if (!source) {
      var candidates = list.filter(function (s) {
        return !s.video || (type !== 'static' && USE_VIDEO && !prefersReducedMotion() && !saveDataOn())
      })
      if (!candidates.length) candidates = list.filter(function (s) { return !s.video })
      if (candidates.length) source = weightedPick(candidates)
    } else if (source.video && (!USE_VIDEO || prefersReducedMotion() || saveDataOn())) {
      limited = true
      source = list.filter(function (s) { return !s.video })[0] || list[0]
    }
    var task
    if (type === 'pool' || !source) task = usePool('选择收藏图池', job)
    else {
      task = resolveSource(source, job).then(function (url) {
        if (!alive(job)) return false
        return source.video ? applyVideo(url, source, job) : applyImage(url, source, job)
      }).catch(function () { return false })
      task = task.then(function (ok) {
        if (ok || !alive(job)) return ok
        fallback = true
        message = '图源暂时没连上，正在试试收藏图池…'
        announce()
        return usePool(source.label + ' 加载失败', job)
      })
    }
    return task.then(function (ok) {
      if (!alive(job)) return false
      message = ok
        ? (limited ? '系统开启了减少动态效果或省流量，改用静态壁纸。' : fallback ? '图源暂不可用，已换成收藏图池里的壁纸。' : '已换好 · ' + currentSource.label)
        : '这次没有加载成功，原来的壁纸还在，可以再试一次。'
      if (ok) return true
      return false
    }).catch(function () {
      if (alive(job)) message = '这次没有加载成功，原来的壁纸还在，可以再试一次。'
      return false
    }).finally(function () {
      if (pending !== job) return
      pending = null
      loading = false
      announce()
    })
  }

  function init () {
    var override = urlOverride()
    if (override === 'off' || override === 'none' || override === 'false') return Promise.resolve(false)
    return change(override && TYPES.some(function (item) { return item.id === override }) ? override : selectedType, false)
  }

  // pjax 跳转后页面结构被换掉，把「本次会话选中的那张」贴回去（不重新抽）
  function reapply () {
    if (!currentUrl) return
    if (currentKind === 'video') {
      var bg = document.getElementById('web_bg')
      if (bg && !document.getElementById(VIDEO_ID)) {
        applyVideo(currentUrl, currentSource)
      }
      applyHeader(currentUrl, 'video')
    } else {
      applyBackground(currentUrl)
      applyHeader(currentUrl)
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()

  document.addEventListener('pjax:complete', reapply)

  // 只处理背景层，标题和正文保持清晰；最大 5px，回到顶部恢复原图。
  var blurFrame = 0
  function updateBlur () {
    blurFrame = 0
    var progress = Math.min(1, Math.max(0, window.scrollY / Math.max(320, window.innerHeight * .75)))
    document.documentElement.style.setProperty('--lks-bg-blur', (progress * 5).toFixed(2) + 'px')
    document.documentElement.style.setProperty('--lks-bg-scale', (1 + progress * .025).toFixed(4))
  }
  function scheduleBlur () { if (!blurFrame) blurFrame = requestAnimationFrame(updateBlur) }
  window.addEventListener('scroll', scheduleBlur, { passive: true })
  window.addEventListener('resize', scheduleBlur, { passive: true })
  document.addEventListener('pjax:complete', scheduleBlur)
  scheduleBlur()

  // 方便自检脚本查看状态
  window.lksBg = {
    init: init,
    refresh: function (type) { return change(type || selectedType, true) },
    setType: setType,
    type: function () { return selectedType },
    types: function () { return TYPES.slice() },
    state: function () { return { loading: loading, message: message, type: selectedType, source: currentSource, kind: currentKind } },
    current: function () { return currentUrl },
    source: function () { return currentSource },
    kind: function () { return currentKind },
    device: function () { return isMobile() ? 'mobile' : 'desktop' },
    api: API_BASE,
    pool: function () { return readPoolCache() || POOL.fallback }
  }
})()
