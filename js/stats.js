/*!
 * 摸鱼小窝 · 浏览量 + 文章反应
 *
 * 为什么要自己写：busuanzi（busuanzi.ibruce.info）在国内经常超时，数字时有时无。
 * 现在把统计放在自己的 Cloudflare Worker + D1 上（后端见 comment-worker/）。
 *
 * 做法上有个取巧的地方，但很有用：
 *   主题里「总访问量 / 访客数 / 本文阅读量」这些位置是写死给 busuanzi 用的
 *   （<span id="busuanzi_value_site_pv"> 之类），我们不改主题模板，
 *   而是把 busuanzi 的脚本换成一个空文件（/js/busuanzi-off.js），再由本脚本往同样的
 *   元素里填自己的数据 —— 页面结构不变、只有一个数据写入方，不会互相覆盖。
 *
 * 文章反应是额外插入的：文章页正文下面会出现三个按钮（👍 有用 / 💡 学到了 / ❤️ 喜欢），
 * 同一 IP 对同一篇文章的同一种反应每天只算一次。
 *
 * 由 _config.butterfly.yml → inject.bottom 引入；后端地址复用 window.LKS_COMMENT.api。
 */
(function () {
  'use strict'

  var CFG = window.LKS_COMMENT || {}
  var API = (CFG.api || '').replace(/\/+$/, '')
  if (!API) {
    console.warn('[stats] 没有配置后端地址（lks_comment.api），统计与反应不启用')
    return
  }

  var REACTIONS = [
    { kind: 'useful', emoji: '👍', label: '有用' },
    { kind: 'learned', emoji: '💡', label: '学到了' },
    { kind: 'love', emoji: '❤️', label: '喜欢' }
  ]
  var HEART_KEY = 'lks-reactions'   // 本地记一下点过的，避免刷新后 UI 状态回退

  function currentPath () {
    var p = window.location.pathname || '/'
    p = p.replace(/index\.html$/, '')
    if (p.charAt(0) !== '/') p = '/' + p
    return p
  }

  function api (path, options) {
    return fetch(API + path, options).then(function (res) {
      return res.json().catch(function () { return {} }).then(function (body) {
        if (!res.ok || body.ok === false) throw new Error(body.error || ('请求失败 ' + res.status))
        return body.data
      })
    })
  }

  function loadCSS (href) {
    if (document.querySelector('link[href="' + href + '"]')) return
    var link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    document.head.appendChild(link)
  }

  function fill (id, value) {
    var el = document.getElementById(id)
    if (el) el.textContent = value
  }

  function localHearts () {
    try { return JSON.parse(localStorage.getItem(HEART_KEY) || '{}') } catch (e) { return {} }
  }

  function markHeart (path, kind) {
    try {
      var data = localHearts()
      data[path] = data[path] || {}
      data[path][kind] = true
      localStorage.setItem(HEART_KEY, JSON.stringify(data))
    } catch (e) { /* 隐私模式忽略 */ }
  }

  /* ------------------------- 浏览量 ------------------------- */

  function countView () {
    var path = currentPath()
    api('/api/pv', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: path })
    })
      .then(function (data) { fill('busuanzi_value_page_pv', data.views) })
      .catch(function (err) { console.warn('[stats] 记录浏览失败：', err.message) })

    api('/api/stats')
      .then(function (data) {
        fill('busuanzi_value_site_pv', data.site_pv)
        fill('busuanzi_value_site_uv', data.site_uv)
      })
      .catch(function (err) { console.warn('[stats] 读取站点统计失败：', err.message) })
  }

  /* ------------------------- 文章反应 ------------------------- */

  function renderReactions () {
    if (GLOBAL_CONFIG_SITE.pageType !== 'post') return

    var path = currentPath()
    var existing = document.getElementById('lks-reactions')
    if (existing) existing.parentNode.removeChild(existing)

    var box = document.createElement('div')
    box.id = 'lks-reactions'
    box.className = 'lks-reactions'
    box.innerHTML = '<div class="lks-reactions-tip">觉得有用的话，点一下呗～</div>'

    var bar = document.createElement('div')
    bar.className = 'lks-reactions-bar'

    var buttons = {}
    REACTIONS.forEach(function (item) {
      var btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'lks-reaction'
      btn.dataset.kind = item.kind
      btn.innerHTML = '<span class="lks-reaction-emoji">' + item.emoji + '</span>' +
        '<span class="lks-reaction-label">' + item.label + '</span>' +
        '<span class="lks-reaction-count">0</span>'
      btn.disabled = true
      btn.addEventListener('click', function () { react(path, item.kind, buttons) })
      buttons[item.kind] = btn
      bar.appendChild(btn)
    })

    box.appendChild(bar)

    // 插到文章正文之后、评论区之前
    var anchor = document.querySelector('#post-comment') || document.querySelector('.post-copyright')
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(box, anchor)
    else {
      var content = document.getElementById('article-container')
      if (content) content.appendChild(box)
    }

    loadCSS('/css/stats.css')

    api('/api/reaction?path=' + encodeURIComponent(path))
      .then(function (data) {
        var mine = localHearts()[path] || {}
        REACTIONS.forEach(function (item) {
          var btn = buttons[item.kind]
          btn.disabled = false
          btn.querySelector('.lks-reaction-count').textContent = data.counts[item.kind] || 0
          if (data.reacted[item.kind] || mine[item.kind]) btn.classList.add('is-done')
        })
      })
      .catch(function (err) { console.warn('[stats] 读取反应失败：', err.message) })
  }

  function react (path, kind, buttons) {
    var btn = buttons[kind]
    if (!btn || btn.classList.contains('is-done')) return
    btn.disabled = true
    api('/api/reaction', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: path, kind: kind })
    })
      .then(function (data) {
        REACTIONS.forEach(function (item) {
          var b = buttons[item.kind]
          b.querySelector('.lks-reaction-count').textContent = data.counts[item.kind] || 0
        })
        btn.classList.add('is-done')
        btn.disabled = false
        markHeart(path, kind)
      })
      .catch(function (err) {
        console.warn('[stats] 点赞失败：', err.message)
        btn.disabled = false
      })
  }

  /* ------------------------- 初始化 ------------------------- */

  function init () {
    countView()
    renderReactions()
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()

  if (window.btf && window.btf.addGlobalFn) window.btf.addGlobalFn('pjaxComplete', init, 'lksStats')
  document.addEventListener('pjax:complete', init)

  window.lksStats = { init: init, api: API }
})()
