/*!
 * 摸鱼小窝 · 自建评论前端
 *
 * 配合 comment-worker/ 里的 Cloudflare Worker 使用（接口见 comment-worker/README.md）。
 * 由主题补丁 layout/includes/third-party/comments/js.pug 引入，
 * 渲染到 index.pug 里预留的 #lks-comment 容器。
 *
 * 配置来自 window.LKS_COMMENT（由同一个补丁从 _config.butterfly.yml → lks_comment 注入）：
 *   { api: 'https://comments.lksme.dpdns.org', turnstileSiteKey: '' }
 */
(function () {
  'use strict'

  var CFG = window.LKS_COMMENT || {}
  var API = (CFG.api || '').replace(/\/+$/, '')
  var CONTAINER_ID = 'lks-comment'
  var PAGE_SIZE = 20
  var TOKEN_KEY = 'lks-comment-token'
  var META_KEY = 'lks-comment-meta'   // 记住访客填过的昵称/邮箱/网址

  if (!API) {
    console.warn('[comment] 没有配置 lks_comment.api，评论组件不渲染')
    return
  }

  /* ----------------------------- 小工具 ----------------------------- */

  function el (tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined && text !== null) node.textContent = text
    return node
  }

  function getToken () {
    try { return localStorage.getItem(TOKEN_KEY) || '' } catch (e) { return '' }
  }

  function getMeta () {
    try { return JSON.parse(localStorage.getItem(META_KEY) || '{}') } catch (e) { return {} }
  }

  function saveMeta (meta) {
    try { localStorage.setItem(META_KEY, JSON.stringify(meta)) } catch (e) { /* 隐私模式下忽略 */ }
  }

  // 同一篇文章在带不带 index.html 的地址下要算同一页
  function currentPath () {
    var p = window.location.pathname || '/'
    p = p.replace(/index\.html$/, '')
    if (p.charAt(0) !== '/') p = '/' + p
    return p
  }

  function relativeTime (seconds) {
    var diff = Math.floor(Date.now() / 1000) - seconds
    if (diff < 60) return '刚刚'
    if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前'
    if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前'
    if (diff < 86400 * 30) return Math.floor(diff / 86400) + ' 天前'
    var d = new Date(seconds * 1000)
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
  }

  function pad (n) { return n < 10 ? '0' + n : String(n) }

  // 用昵称生成一个稳定的颜色，做头像底色（不请求 Gravatar，省一次外网请求也不泄露邮箱哈希）
  function hueOf (text) {
    var h = 0
    for (var i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360
    return h
  }

  // 样式按需加载：只有真的渲染评论区时才插入 <link>，
  // 首页/归档页就不会白白多一个请求。故意不返回 Promise —— 
  // 主题里的 btf.getCSS 因为没有 catch 也没有超时，请求挂起时会把后续逻辑一起卡死。
  function loadCSS (href) {
    if (document.querySelector('link[href="' + href + '"]')) return
    var link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    document.head.appendChild(link)
  }

  /* ----------------------------- 网络 ----------------------------- */

  function api (path, options) {
    return fetch(API + path, options).then(function (res) {
      return res.json().catch(function () { return {} }).then(function (body) {
        if (!res.ok || body.ok === false) {
          var err = new Error(body.error || ('请求失败（' + res.status + '）'))
          err.status = res.status
          throw err
        }
        return body.data
      })
    })
  }

  /* ----------------------------- 渲染 ----------------------------- */

  var state = {
    path: '',
    page: 1,
    total: 0,
    comments: [],
    replyTo: null,
    loading: false
  }

  function render (root) {
    root.innerHTML = ''
    root.appendChild(buildForm(root))
    var listBox = el('div', 'lks-list')
    root.appendChild(listBox)
    var footer = el('div', 'lks-footer')
    var more = el('button', 'lks-more', '加载更多')
    more.type = 'button'
    more.style.display = 'none'
    more.addEventListener('click', function () {
      state.page += 1
      load(root, true)
    })
    footer.appendChild(more)
    root.appendChild(footer)
    state.listBox = listBox
    state.moreBtn = more
  }

  function buildForm (root) {
    var meta = getMeta()
    var form = el('form', 'lks-form')

    var row = el('div', 'lks-row')
    var nick = el('input', 'lks-input')
    nick.type = 'text'; nick.placeholder = '昵称 *'; nick.maxLength = 30; nick.value = meta.nick || ''
    var mail = el('input', 'lks-input')
    mail.type = 'email'; mail.placeholder = '邮箱（选填，不会公开）'; mail.maxLength = 100; mail.value = meta.mail || ''
    var link = el('input', 'lks-input')
    link.type = 'url'; link.placeholder = '网址（选填）'; link.maxLength = 200; link.value = meta.link || ''
    row.append(nick, mail, link)

    var content = el('textarea', 'lks-textarea')
    content.placeholder = '说点什么吧～ 支持换行，别发广告哦'
    content.maxLength = 2000
    content.rows = 4

    // 蜜罐：真人看不见，机器人爱填
    var hp = el('input', 'lks-hp')
    hp.type = 'text'; hp.tabIndex = -1; hp.autocomplete = 'off'

    var replyBar = el('div', 'lks-reply-bar')
    replyBar.style.display = 'none'

    var turnstileBox = el('div', 'lks-turnstile')

    var actions = el('div', 'lks-actions')
    var msg = el('span', 'lks-msg')
    var submit = el('button', 'lks-submit', '发表评论')
    submit.type = 'submit'
    actions.append(msg, submit)

    form.append(row, content, hp, emojiBar(content), turnstileBox, replyBar, actions)

    state.msgEl = msg
    state.replyBar = replyBar

    form.addEventListener('submit', function (e) {
      e.preventDefault()
      submitComment(root, { nick: nick, mail: mail, link: link, content: content, hp: hp, submit: submit })
    })

    nick.addEventListener('change', remember)
    mail.addEventListener('change', remember)
    link.addEventListener('change', remember)
    function remember () {
      saveMeta({ nick: nick.value.trim(), mail: mail.value.trim(), link: link.value.trim() })
    }

    if (CFG.turnstileSiteKey) mountTurnstile(turnstileBox)

    return form
  }

  // 表情 / 颜文字选择器：插到光标位置（没点过输入框就追加到末尾）
  var EMOJI_GROUPS = [
    ['😄', '😂', '🤣', '😊', '😍', '🤔', '😅', '🙃', '😭', '😴', '🥲', '😎'],
    ['👍', '👏', '🙏', '💪', '🎉', '🔥', '✨', '☕', '🐟', '🌙', '🍜', '🎮'],
    ['(๑•̀ㅂ•́)و✧', '(｡•́︿•̀｡)', '(*/ω＼*)', '(╯°□°)╯', 'ヾ(≧▽≦*)o', '(๑´ㅂ`๑)']
  ]

  function emojiBar (textarea) {
    var wrap = el('div', 'lks-emoji')
    var toggle = el('button', 'lks-emoji-toggle', '表情 ▾')
    toggle.type = 'button'
    var panel = el('div', 'lks-emoji-panel')
    panel.style.display = 'none'

    EMOJI_GROUPS.forEach(function (group) {
      var row = el('div', 'lks-emoji-row')
      group.forEach(function (item) {
        var btn = el('button', 'lks-emoji-item', item)
        btn.type = 'button'
        btn.title = '插入 ' + item
        btn.addEventListener('click', function () { insertAtCursor(textarea, item) })
        row.appendChild(btn)
      })
      panel.appendChild(row)
    })

    toggle.addEventListener('click', function () {
      var open = panel.style.display !== 'none'
      panel.style.display = open ? 'none' : ''
      toggle.textContent = open ? '表情 ▾' : '表情 ▴'
    })

    wrap.append(toggle, panel)
    return wrap
  }

  function insertAtCursor (textarea, text) {
    var start = textarea.selectionStart
    var end = textarea.selectionEnd
    var value = textarea.value
    if (typeof start !== 'number') {
      textarea.value = value + text
    } else {
      textarea.value = value.slice(0, start) + text + value.slice(end)
      textarea.selectionStart = textarea.selectionEnd = start + text.length
    }
    textarea.focus()
    // 触发一下 input，方便以后有别的地方监听内容变化
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  }

  function mountTurnstile (box) {
    var siteKey = CFG.turnstileSiteKey
    function render () {
      if (!window.turnstile || !box.isConnected) return
      window.turnstile.render(box, {
        sitekey: siteKey,
        theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light',
        callback: function (token) { state.turnstileToken = token },
        'expired-callback': function () { state.turnstileToken = '' },
        'error-callback': function () { state.turnstileToken = '' }
      })
    }
    if (window.turnstile) return render()
    var existing = document.querySelector('script[data-lks-turnstile]')
    if (existing) { existing.addEventListener('load', render); return }
    var s = document.createElement('script')
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    s.async = true; s.defer = true
    s.setAttribute('data-lks-turnstile', '1')
    s.addEventListener('load', render)
    document.head.appendChild(s)
  }

  function setMsg (text, type) {
    if (!state.msgEl) return
    state.msgEl.textContent = text || ''
    state.msgEl.className = 'lks-msg' + (type ? ' lks-msg-' + type : '')
  }

  function buildItem (root, c) {
    var item = el('div', 'lks-item')
    item.setAttribute('data-id', String(c.id))

    var ava = el('div', 'lks-avatar', (c.nick || '?').trim().charAt(0).toUpperCase())
    ava.style.background = 'hsl(' + hueOf(c.nick || '') + ', 62%, 62%)'

    var main = el('div', 'lks-main')
    var head = el('div', 'lks-item-head')

    var name = c.link ? el('a', 'lks-nick', c.nick) : el('span', 'lks-nick', c.nick)
    if (c.link) { name.href = c.link; name.target = '_blank'; name.rel = 'noopener nofollow' }
    var time = el('span', 'lks-time', relativeTime(c.created_at))
    if (c.pid) {
      var target = findComment(c.pid)
      head.appendChild(el('span', 'lks-at', '回复 ' + (target ? '@' + target.nick : '某条评论')))
    }
    head.append(name, time)

    var body = el('div', 'lks-content')
    body.textContent = c.content

    var ops = el('div', 'lks-item-ops')
    var reply = el('button', 'lks-op', '回复')
    reply.type = 'button'
    reply.addEventListener('click', function () { startReply(root, c) })
    ops.appendChild(reply)

    if (getToken()) {
      var del = el('button', 'lks-op lks-op-danger', '删除')
      del.type = 'button'
      del.addEventListener('click', function () { removeComment(root, c, del) })
      ops.appendChild(del)
    }

    main.append(head, body, ops)
    item.append(ava, main)
    return item
  }

  function findComment (id) {
    for (var i = 0; i < state.comments.length; i++) {
      if (state.comments[i].id === id) return state.comments[i]
    }
    return null
  }

  function renderList () {
    var box = state.listBox
    box.innerHTML = ''
    if (!state.comments.length) {
      box.appendChild(el('div', 'lks-empty', '还没有人留言，来做第一个吧～'))
      return
    }
    for (var i = 0; i < state.comments.length; i++) box.appendChild(buildItem(state.listBox, state.comments[i]))
  }

  function startReply (root, c) {
    state.replyTo = { id: c.id, rid: c.rid || c.id, nick: c.nick }
    state.replyBar.style.display = ''
    state.replyBar.innerHTML = ''
    state.replyBar.append(
      el('span', '', '正在回复 @' + c.nick),
      (function () {
        var cancel = el('button', 'lks-op', '取消')
        cancel.type = 'button'
        cancel.addEventListener('click', function () {
          state.replyTo = null
          state.replyBar.style.display = 'none'
        })
        return cancel
      })()
    )
    var ta = root.querySelector('.lks-textarea')
    if (ta) ta.focus()
  }

  function removeComment (root, c, btn) {
    if (!window.confirm('确定删除这条评论吗？')) return
    btn.disabled = true
    api('/api/comments/' + c.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + getToken() } })
      .then(function () {
        state.comments = state.comments.filter(function (x) { return x.id !== c.id })
        state.total = Math.max(0, state.total - 1)
        renderList()
        setMsg('已删除', 'ok')
      })
      .catch(function (err) {
        btn.disabled = false
        if (err.status === 403) {
          setMsg('管理口令不对或没填。在浏览器控制台执行：localStorage.setItem("lks-comment-token","你的口令")', 'err')
        } else {
          setMsg(err.message, 'err')
        }
      })
  }

  function submitComment (root, fields) {
    var nick = fields.nick.value.trim()
    var content = fields.content.value.trim()
    if (!nick) { setMsg('昵称别空着呀～', 'err'); fields.nick.focus(); return }
    if (!content) { setMsg('还没写内容呢', 'err'); fields.content.focus(); return }
    if (CFG.turnstileSiteKey && !state.turnstileToken) { setMsg('请先完成人机验证', 'err'); return }

    var payload = {
      path: state.path,
      nick: nick,
      mail: fields.mail.value.trim(),
      link: fields.link.value.trim(),
      content: content,
      hp: fields.hp.value,
      turnstileToken: state.turnstileToken || ''
    }
    if (state.replyTo) {
      payload.pid = state.replyTo.id
      payload.rid = state.replyTo.rid
    }

    fields.submit.disabled = true
    setMsg('发送中…')
    api('/api/comments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (data) {
        saveMeta({ nick: nick, mail: payload.mail, link: payload.link })
        fields.content.value = ''
        state.replyTo = null
        state.replyBar.style.display = 'none'
        if (data.pending) {
          setMsg('已提交，等站长审核后就会显示 ✅', 'ok')
        } else if (data.comment) {
          state.comments.unshift(data.comment)
          state.total += 1
          renderList()
          setMsg('发表成功 🎉', 'ok')
        }
        if (window.turnstile && CFG.turnstileSiteKey) {
          state.turnstileToken = ''
          try { window.turnstile.reset() } catch (e) {}
        }
      })
      .catch(function (err) { setMsg(err.message, 'err') })
      .then(function () { fields.submit.disabled = false })
  }

  function load (root, append) {
    if (state.loading) return
    state.loading = true
    if (!append) setMsg('加载评论中…')
    api('/api/comments?path=' + encodeURIComponent(state.path) + '&page=' + state.page + '&pageSize=' + PAGE_SIZE)
      .then(function (data) {
        state.total = data.total
        state.comments = append ? state.comments.concat(data.comments) : data.comments
        renderList()
        state.moreBtn.style.display = data.hasMore ? '' : 'none'
        if (!append) setMsg('')
        updateHeadline()
      })
      .catch(function (err) { setMsg('评论加载失败：' + err.message, 'err') })
      .then(function () { state.loading = false })
  }

  function updateHeadline () {
    var head = document.querySelector('#post-comment .comment-headline span')
    if (head) head.textContent = ' 评论' + (state.total ? '（' + state.total + '）' : '')
  }

  function init () {
    var root = document.getElementById(CONTAINER_ID)
    if (!root) return
    var path = currentPath()
    if (root.getAttribute('data-path') === path) return   // pjax 后同页不重复初始化
    root.setAttribute('data-path', path)
    state = { path: path, page: 1, total: 0, comments: [], replyTo: null, loading: false }
    loadCSS('/css/comment.css')
    render(root)
    load(root, false)
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()

  // pjax 站内跳转后重新渲染
  if (window.btf && window.btf.addGlobalFn) window.btf.addGlobalFn('pjaxComplete', init, 'lksComment')
  document.addEventListener('pjax:complete', init)
  window.lksComment = { init: init, state: function () { return state } }
})()
