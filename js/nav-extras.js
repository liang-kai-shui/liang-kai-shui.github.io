/*!
 * 导航栏上加的两个小按钮：
 *   1. 夜间模式开关（图标跟着当前模式在月亮/太阳之间切）
 *   2. 随机逛一篇（点一下随机跳一篇文章）
 *
 * 为什么放导航栏：主题自带的夜间按钮在右下角那个齿轮里，得先把鼠标移上去才出现，
 * 我自己找都要找一会儿，所以挪到导航栏跟搜索图标并排常显。
 *
 * 切换逻辑直接复用主题的按钮：`#darkmode` 上挂着主题的点击处理（切 data-theme、
 * 显示 Snackbar 提示、把选择写进 localStorage），这里只是替它被点一下，
 * 不再自己维护一份状态，免得两边不一致。
 *
 * 由 _config.butterfly.yml → inject.bottom 引入。
 */
(function () {
  'use strict'

  var THEME_BUTTON = 'darkmode'
  var ICON_ID = 'lks-darkmode-icon'
  var TOGGLE_ID = 'lks-darkmode-button'
  var RANDOM_ID = 'lks-random-post'
  var POSTS_URL = '/posts-index.json'

  function currentTheme () {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
  }

  function syncIcon () {
    var icon = document.getElementById(ICON_ID)
    if (!icon) return
    var dark = currentTheme() === 'dark'
    icon.className = 'fas ' + (dark ? 'fa-sun' : 'fa-moon') + ' fa-fw'
    var btn = document.getElementById(TOGGLE_ID)
    if (btn) btn.title = dark ? '切换到日间模式' : '切换到夜间模式'
  }

  function toggleTheme () {
    var themeBtn = document.getElementById(THEME_BUTTON)
    if (themeBtn) {
      themeBtn.click()          // 主题的按钮负责真正的切换（含提示与记忆）
    } else if (window.btf && window.btf.activateDarkMode) {
      // 兜底：主题按钮不在（比如把它的开关关了），自己切
      var dark = currentTheme() === 'dark'
      if (dark) window.btf.activateLightMode()
      else window.btf.activateDarkMode()
      try { window.btf.saveToLocal.set('theme', dark ? 'light' : 'dark', 2) } catch (e) {}
    }
    // 图标要等主题改完 data-theme 再读，交给下一拍
    setTimeout(syncIcon, 0)
  }

  function bind (el, handler) {
    if (!el) return
    el.addEventListener('click', handler)
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        handler()
      }
    })
  }

  var postsCache = null

  function randomPost () {
    var go = function (list) {
      if (!list || !list.length) return
      var here = window.location.pathname
      var pick = list[Math.floor(Math.random() * list.length)]
      // 别跳到自己，最多重试 5 次
      for (var i = 0; i < 5 && list.length > 1 && pick.u === here; i++) {
        pick = list[Math.floor(Math.random() * list.length)]
      }
      window.location.href = pick.u
    }

    if (postsCache) return go(postsCache)

    var btn = document.getElementById(RANDOM_ID)
    if (btn) btn.style.opacity = '0.5'
    fetch(POSTS_URL, { cache: 'no-cache' })
      .then(function (res) { return res.json() })
      .then(function (list) {
        postsCache = list
        if (btn) btn.style.opacity = ''
        go(list)
      })
      .catch(function (err) {
        console.warn('[nav] 文章清单没拿到：', err.message)
        if (btn) btn.style.opacity = ''
      })
  }

  function init () {
    syncIcon()
    bind(document.getElementById(TOGGLE_ID), toggleTheme)
    bind(document.getElementById(RANDOM_ID), randomPost)
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()

  // 主题默认按系统/时间自动切（autoChangeMode），pjax 跳转后图标也要跟上
  if (window.btf && window.btf.addGlobalFn) window.btf.addGlobalFn('pjaxComplete', syncIcon, 'lksNav')
  document.addEventListener('pjax:complete', syncIcon)
  window.lksNav = { syncIcon: syncIcon, toggle: toggleTheme, random: randomPost, theme: currentTheme }
})()
