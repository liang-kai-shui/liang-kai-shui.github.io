/*!
 * 摸鱼小窝 · 每次刷新随机换底图
 *
 * 图床里有个人底图池（https://pic-bed-e0x.pages.dev/img/bg/），
 * 池子里的清单 list.json 由 tools/pick-backgrounds.py 生成 ——
 * 所以以后加图只要重跑那个脚本再把图床仓库 push 上去，这里不用改任何代码。
 *
 * 行为：
 *   1. 取清单（拿过一次就缓存在 localStorage 里 6 小时，之后刷新不再请求）
 *   2. 随机挑一张，尽量避开上次用过的那张（同一张连出两次会很出戏）
 *   3. 预加载完成后再换上去，避免半张图闪一下
 *   4. 换的是「网站背景底图」#web_bg；页面头图（首页那张大图）跟着用同一张，
 *      这样上半屏和下半屏是同一张图，看起来是连贯的
 *   5. 文章页的头图是文章自己的封面，不动它
 *   6. pjax 站内跳转不会重新抽（同一张图用到底，刷新才换）
 *
 * 由 _config.butterfly.yml → inject.bottom 引入。
 */
(function () {
  'use strict'

  var BED = 'https://pic-bed-e0x.pages.dev'
  var BG_DIR = '/img/bg/'
  var MANIFEST_URL = BED + BG_DIR + 'list.json'
  var CACHE_KEY = 'lks-bg-manifest'
  var LAST_KEY = 'lks-bg-last'
  var CACHE_TTL = 6 * 60 * 60 * 1000   // 清单缓存 6 小时

  // 图床挂了也能随机换（内置一小撮兜底文件名）
  var FALLBACK = ['bg001.webp', 'bg013.webp', 'bg024.webp', 'bg037.webp', 'bg050.webp']

  var SWAP_BACKGROUND = true   // 换网站背景底图
  var SWAP_HEADER = true       // 头图跟着一起换（仅限本来就有头图的非文章页）

  var currentUrl = null        // 本次会话选中的图

  /* ------------------------- 工具 ------------------------- */

  function urlOf (name) {
    return BED + BG_DIR + name
  }

  function readCache () {
    try {
      var raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
      if (raw && raw.list && raw.list.length && Date.now() - raw.t < CACHE_TTL) return raw.list
    } catch (e) { /* 忽略 */ }
    return null
  }

  function writeCache (list) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), list: list })) } catch (e) { /* 隐私模式忽略 */ }
  }

  function lastUsed () {
    try { return localStorage.getItem(LAST_KEY) || '' } catch (e) { return '' }
  }

  function rememberUsed (url) {
    try { localStorage.setItem(LAST_KEY, url) } catch (e) { /* 忽略 */ }
  }

  function loadManifest () {
    var cached = readCache()
    if (cached) return Promise.resolve(cached)

    return fetch(MANIFEST_URL, { cache: 'no-cache' })
      .then(function (res) { return res.json() })
      .then(function (data) {
        var list = (data && data.images) || []
        if (!list.length) throw new Error('清单是空的')
        writeCache(list)
        return list
      })
      .catch(function (err) {
        console.warn('[bg] 底图清单拉取失败，用内置列表兜底：', err.message)
        return FALLBACK
      })
  }

  function pickRandom (list) {
    if (list.length < 2) return list[0]
    var last = lastUsed()
    var pool = list.filter(function (name) { return urlOf(name) !== last })
    if (!pool.length) pool = list
    return pool[Math.floor(Math.random() * pool.length)]
  }

  /* ------------------------- 应用 ------------------------- */

  function applyBackground (url) {
    var bg = document.getElementById('web_bg')
    if (!bg) return false
    bg.style.backgroundImage = 'url("' + url + '")'
    return true
  }

  function applyHeader (url) {
    var header = document.getElementById('page-header')
    if (!header) return false
    // 文章页的头图是这篇自己的封面，别覆盖
    if (header.classList.contains('post-bg')) return false
    // 本来就没有头图的页面（比如关于页）也不硬塞一张
    if (!header.style.backgroundImage) return false
    header.style.backgroundImage = 'url("' + url + '")'
    return true
  }

  function swap (url) {
    var didBg = SWAP_BACKGROUND && applyBackground(url)
    var didHeader = SWAP_HEADER && applyHeader(url)
    currentUrl = url
    if (didBg || didHeader) rememberUsed(url)
  }

  function preload (url) {
    return new Promise(function (resolve) {
      var img = new Image()
      img.onload = function () { resolve(true) }
      img.onerror = function () { resolve(false) }
      img.src = url
    })
  }

  function init () {
    loadManifest()
      .then(function (list) {
        var name = pickRandom(list)
        var url = urlOf(name)
        return preload(url).then(function (ok) {
          if (!ok) {
            console.warn('[bg] 底图加载失败，保持原背景：', url)
            return
          }
          swap(url)
        })
      })
      .catch(function (err) { console.warn('[bg] 随机底图失败：', err.message) })
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()

  // pjax 跳转后页面结构被换掉，把「本次会话选中的那张」重新贴回去（不重新抽）
  function reapply () {
    if (currentUrl) swap(currentUrl)
  }
  if (window.btf && window.btf.addGlobalFn) window.btf.addGlobalFn('pjaxComplete', reapply, 'lksBg')
  document.addEventListener('pjax:complete', reapply)

  // 方便自检脚本查看状态
  window.lksBg = {
    init: init,
    current: function () { return currentUrl },
    manifestUrl: MANIFEST_URL,
    pool: function () { return readCache() || FALLBACK }
  }
})()
