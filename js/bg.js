/*!
 * 摸鱼小窝 · 每次刷新随机换底图
 *
 * 图源优先用「栗次元 API」（https://t.alcy.cc）：
 *   桌面端：二次元自适应 /ycy  ｜ PC 横图 /pc  ｜ ACG 动图 /acg   ← 按权重随机挑一个
 *   移动端：移动竖图 /mp                                        ← 屏幕窄就用竖图
 * 这些接口每次请求会 302 到一张随机图（/acg 是 mp4），所以：
 *   - 每次刷新都能换（URL 上带随机参数，绕开浏览器/CDN 缓存）
 *   - /acg 是视频，用 <video> 铺在背景层，不是 CSS background-image
 *
 * 兜底：接口超时/挂了，就退回自己的图床底图池（img/bg/，由 tools/pick-backgrounds.py 维护）。
 *
 * 行为：
 *   1. 预加载成功才换上去，避免半张图闪一下
 *   2. 换的是网站背景底图 #web_bg；本来就有头图的非文章页（比如首页）头图跟着用同一张
 *   3. 文章页头图是文章自己的封面，不动它
 *   4. pjax 站内跳转不重新抽（同一张用到底，刷新才换）
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
    return API_BASE + '/' + name + '?r=' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
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
    if (video) video.remove()      // 换成静态图时把上一个视频撤掉
    return true
  }

  function applyHeader (url) {
    var header = document.getElementById('page-header')
    if (!header) return false
    if (header.classList.contains('post-bg')) return false   // 文章页头图是这篇自己的封面
    if (!header.style.backgroundImage) return false          // 本来没头图的页面不硬塞
    header.style.backgroundImage = 'url("' + url + '")'
    return true
  }

  function remember (url, source, kind) {
    currentUrl = url
    currentSource = source
    currentKind = kind
    try { localStorage.setItem(POOL.lastKey, url) } catch (e) { /* 隐私模式忽略 */ }
  }

  function preloadImage (url) {
    return new Promise(function (resolve) {
      var img = new Image()
      img.onload = function () { resolve(true) }
      img.onerror = function () { resolve(false) }
      img.src = url
    })
  }

  function applyImage (url, source) {
    return preloadImage(url).then(function (ok) {
      if (!ok) return false
      var didBg = applyBackground(url)
      applyHeader(url)
      if (didBg) remember(url, source, 'image')
      return didBg
    })
  }

  function applyVideo (url, source) {
    var bg = document.getElementById('web_bg')
    if (!bg) return Promise.resolve(false)

    injectStyleOnce()
    return new Promise(function (resolve) {
      var video = document.getElementById(VIDEO_ID)
      if (!video) {
        video = document.createElement('video')
        video.id = VIDEO_ID
        video.muted = true
        video.loop = true
        video.autoplay = true
        video.playsInline = true
        video.setAttribute('muted', '')
        video.setAttribute('playsinline', '')
        video.setAttribute('webkit-playsinline', '')
        bg.appendChild(video)
      }
      var done = false
      var finish = function (ok) {
        if (done) return
        done = true
        if (ok) {
          remember(url, source, 'video')
          var p = video.play()
          if (p && p.catch) p.catch(function () { /* 自动播放被拦就静默降级成首帧 */ })
        }
        resolve(ok)
      }
      video.addEventListener('canplay', function () { finish(true) }, { once: true })
      video.addEventListener('error', function () { finish(false) }, { once: true })
      video.src = url
      video.load()
      setTimeout(function () { finish(false) }, 12000)   // 12 秒还没就绪就算失败（mp4 有几 MB，慢网络会走到这里）
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

  function loadPool () {
    var cached = readPoolCache()
    if (cached) return Promise.resolve(cached)
    return fetch(POOL.base + POOL.dir + 'list.json', { cache: 'no-cache' })
      .then(function (res) { return res.json() })
      .then(function (data) {
        var list = (data && data.images) || []
        if (!list.length) throw new Error('清单是空的')
        try { localStorage.setItem(POOL.cacheKey, JSON.stringify({ t: Date.now(), list: list })) } catch (e) { /* 忽略 */ }
        return list
      })
      .catch(function () { return POOL.fallback })
  }

  function pickFromPool (list) {
    if (list.length < 2) return list[0]
    var last = ''
    try { last = localStorage.getItem(POOL.lastKey) || '' } catch (e) { /* 忽略 */ }
    var pool = list.filter(function (n) { return urlOf(n) !== last })
    if (!pool.length) pool = list
    return pool[Math.floor(Math.random() * pool.length)]
  }

  function usePool (why) {
    console.warn('[bg] 改用图床底图池兜底：' + why)
    return loadPool().then(function (list) {
      return applyImage(urlOf(pickFromPool(list)), { name: 'pool', label: '图床底图池' })
    })
  }

  /* ------------------------- 主流程 ------------------------- */

  function init () {
    var override = urlOverride()
    if (override === 'off' || override === 'none' || override === 'false') {
      console.log('[bg] 网址带 bg=' + override + '，本次不换底图')
      return Promise.resolve(false)
    }

    var mobile = isMobile()
    var list = mobile ? SOURCES.mobile : SOURCES.desktop
    var source = null

    if (override) {
      var all = SOURCES.desktop.concat(SOURCES.mobile)
      for (var i = 0; i < all.length; i++) {
        if (all[i].name === override) { source = all[i]; break }
      }
      if (source) console.log('[bg] 网址带 bg=' + override + '，强制使用「' + source.label + '」')
      else console.warn('[bg] 不认识的 bg=' + override + '，按默认随机')
    }

    if (!source) {
      var candidates = list.filter(function (s) {
        return !s.video || (USE_VIDEO && !prefersReducedMotion() && !saveDataOn())
      })
      if (!candidates.length) candidates = list.filter(function (s) { return !s.video })
      if (!candidates.length) return usePool('没有可用的接口')
      source = weightedPick(candidates)
    } else if (source.video && (!USE_VIDEO || prefersReducedMotion() || saveDataOn())) {
      console.warn('[bg] 动图不可用（被设置或省流量模式禁用），换成静态图')
      source = list.filter(function (s) { return !s.video })[0] || list[0]
    }

    var url = apiUrl(source.name)
    var label = source.label + '（' + (mobile ? '移动端' : '桌面端') + '）'

    var task = source.video ? applyVideo(url, source) : applyImage(url, source)
    return task.then(function (ok) {
      if (ok) return true
      return usePool(source.label + ' 加载失败')
    }).catch(function (err) {
      return usePool('出错了：' + (err && err.message))
    })
  }

  // pjax 跳转后页面结构被换掉，把「本次会话选中的那张」贴回去（不重新抽）
  function reapply () {
    if (!currentUrl) return
    if (currentKind === 'video') {
      var bg = document.getElementById('web_bg')
      if (bg && !document.getElementById(VIDEO_ID)) {
        applyVideo(currentUrl, currentSource)
      }
    } else {
      applyBackground(currentUrl)
      applyHeader(currentUrl)
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()

  if (window.btf && window.btf.addGlobalFn) window.btf.addGlobalFn('pjaxComplete', reapply, 'lksBg')
  document.addEventListener('pjax:complete', reapply)

  // 方便自检脚本查看状态
  window.lksBg = {
    init: init,
    current: function () { return currentUrl },
    source: function () { return currentSource },
    kind: function () { return currentKind },
    device: function () { return isMobile() ? 'mobile' : 'desktop' },
    api: API_BASE,
    pool: function () { return readPoolCache() || POOL.fallback }
  }
})()
