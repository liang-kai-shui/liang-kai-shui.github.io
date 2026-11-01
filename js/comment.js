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

  /* Drafts contain only text and the public reply target, never contact details. */
  var DRAFT_KEY = 'lks-comment-drafts'
  var volatileDrafts = null
  function readDrafts () {
    var rows = volatileDrafts
    if (!rows) { try { rows = JSON.parse(localStorage.getItem(DRAFT_KEY) || '[]') } catch (e) { rows = [] } }
    if (!Array.isArray(rows)) rows = []
    return rows.filter(function (d) {
      return d && typeof d.path === 'string' && d.path.charAt(0) === '/' && d.path.length <= 500 && typeof d.content === 'string' && d.content.length <= 2000 && d.content.trim() && Number.isFinite(d.time) && d.time > Date.now() - 7 * 86400000 && d.time < Date.now() + 300000
    }).sort(function (a, b) { return b.time - a.time }).slice(0, 30)
  }
  function writeDrafts (rows) {
    try {
      if (rows.length) localStorage.setItem(DRAFT_KEY, JSON.stringify(rows))
      else localStorage.removeItem(DRAFT_KEY)
      volatileDrafts = null
      return true
    } catch (e) { volatileDrafts = rows; return false }
  }
  function safeReply (r) {
    return r && Number.isSafeInteger(r.id) && r.id > 0 && Number.isSafeInteger(r.rid) && r.rid > 0 && typeof r.nick === 'string' ? { id: r.id, rid: r.rid, nick: r.nick.slice(0, 30) } : null
  }
  function attachDraft (root, form, content, counter, context) {
    var tools = el('div', 'lks-draft-tools'), status = el('span', 'lks-draft-status')
    status.setAttribute('role', 'status')
    var clear = el('button', 'lks-draft-clear', '清除草稿'); clear.type = 'button'
    tools.append(status, clear); tools.hidden = true
    form.querySelector('.lks-form-tools').after(tools)
    var dirty = false, timer = 0, stored = true
    function label (text) { if (status.textContent !== text) status.textContent = text }
    function flush () {
      clearTimeout(timer)
      if (!dirty) return stored || !content.value.trim()
      var rows = readDrafts().filter(function (d) { return d.path !== context.path })
      if (content.value.trim()) rows.unshift({ path: context.path, content: content.value.slice(0, 2000), reply: safeReply(context.replyTo), time: Date.now() })
      stored = writeDrafts(rows.slice(0, 30)); dirty = !stored
      tools.hidden = !content.value.trim()
      label(stored ? '草稿已保存在此浏览器 · 保留 7 天' : '浏览器暂时无法保存，草稿仅保留在当前页面')
      return stored || !content.value.trim()
    }
    function changed () {
      dirty = true; tools.hidden = !content.value.trim(); clearTimeout(timer)
      timer = setTimeout(flush, 350)
    }
    context.flushDraft = flush; context.markDraft = changed
    content.addEventListener('input', changed)
    clear.addEventListener('click', function () {
      content.value = ''; if (context === state) clearReply()
      content.dispatchEvent(new Event('input', { bubbles: true })); flush(); content.focus()
    })
    var saved = readDrafts().find(function (d) { return d.path === context.path })
    if (saved) {
      content.value = saved.content; counter.textContent = content.value.length + ' / 2000'
      if (safeReply(saved.reply)) startReply(root, saved.reply, false)
      stored = volatileDrafts === null; dirty = !stored
      tools.hidden = false; label(stored ? '已恢复这页的草稿 · 仅此浏览器保存' : '已恢复当前会话草稿，刷新前请确认内容已保存')
    }
  }
  function forgetSubmittedDraft (path, content, time) {
    writeDrafts(readDrafts().filter(function (d) { return d.path !== path || d.content !== content || d.time > time }))
  }
  function flushDraft () {
    var saved = !state.flushDraft || state.flushDraft()
    if (volatileDrafts) { var rows = readDrafts(); return writeDrafts(rows) || !rows.length }
    return saved
  }
  document.addEventListener('astro:before-preparation', flushDraft)
  document.addEventListener('pjax:send', flushDraft)
  document.addEventListener('lks:before-reload', flushDraft)
  window.addEventListener('pagehide', flushDraft)
  document.addEventListener('visibilitychange', function () { if (document.hidden) flushDraft() })

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
    var home = el('div', 'lks-form-home'); state.formHome = home; home.append(buildForm(root)); root.append(home)
    var listHead = el('div', 'lks-list-head')
    var listTitle = el('h3', 'lks-list-title', state.path === '/comments/' ? '大家说了什么' : state.path === '/music/' ? '听友留言' : '评论区')
    var listCount = el('span', 'lks-list-count', '0 条')
    var listOrder = el('div', 'lks-list-order')
    ;[['最新讨论', 'latest'], ['最早讨论', 'earliest']].forEach(function (pair) {
      var button = el('button', 'lks-op', pair[0]); button.type = 'button'; button.dataset.order = pair[1]
      button.setAttribute('aria-pressed', String(pair[1] === (state.order || 'latest')))
      button.addEventListener('click', function () { if (state.loading) return; state.order = pair[1]; listOrder.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b === button)) }); load(root, false) })
      listOrder.append(button)
    })
    listHead.append(listTitle, listCount, listOrder)
    root.appendChild(listHead)
    var listStatus = el('div', 'lks-list-status')
    listStatus.setAttribute('role', 'status')
    var statusText = el('span', 'lks-list-status-text')
    var retry = el('button', 'lks-retry', '重新加载')
    retry.type = 'button'
    retry.hidden = true
    retry.addEventListener('click', function () {
      load(root, false).then(function (ok) { if (ok) locateTarget(root) })
    })
    listStatus.append(statusText, retry)
    root.appendChild(listStatus)
    var listBox = el('div', 'lks-list')
    var treeTools = el('div', 'lks-tree-toolbar')
    treeTools.append(el('span', '', '按分支阅读'))
    ;[['展开一层', true], ['全部收起', false]].forEach(function (pair) { var b = el('button', 'lks-op', pair[0]); b.type = 'button'; b.addEventListener('click', function () { if (state.tree) state.tree.bulk(pair[1]) }); treeTools.append(b) })
    treeTools.hidden = true; state.treeTools = treeTools
    root.append(treeTools, listBox)
    var footer = el('div', 'lks-footer')
    var more = el('button', 'lks-more', '加载更多')
    more.type = 'button'
    more.style.display = 'none'
    more.addEventListener('click', function () {
      load(root, true)
    })
    footer.appendChild(more)
    root.appendChild(footer)
    var targetStatus = el('p', 'lks-target-status')
    targetStatus.setAttribute('role', 'status')
    targetStatus.hidden = true
    listBox.before(targetStatus)
    state.targetStatusEl = targetStatus
    state.listBox = listBox
    state.moreBtn = more
    state.listStatusEl = listStatus
    state.listStatusTextEl = statusText
    state.retryBtn = retry
    state.listCountEl = listCount
  }

  function buildForm (root) {
    var meta = getMeta()
    var form = el('form', 'lks-form'); state.form = form
    var isGuestbook = state.path === '/comments/'
    var isMusic = state.path === '/music/'
    var intro = el('div', 'lks-form-intro')
    intro.append(
      el('span', 'lks-form-eyebrow', isGuestbook ? 'NEW NOTE' : 'NEW COMMENT'),
      el('h3', 'lks-form-title', isGuestbook ? '在这里留个言' : isMusic ? '一起聊聊音乐' : '聊聊这篇文章'),
      el('p', 'lks-form-desc', isGuestbook ? '想聊什么都行，写完直接发在下面。' : isMusic ? '推荐一首好歌，或说说它让你想起了什么。' : '有想法或发现哪里不对，欢迎在这里说。'),
      el('p', 'lks-form-hint', '邮箱只在后台可见，不会公开。')
    )

    var row = el('div', 'lks-row')
    var nick = el('input', 'lks-input')
    nick.type = 'text'; nick.placeholder = '怎么称呼你'; nick.maxLength = 30; nick.value = meta.nick || ''
    nick.autocomplete = 'nickname'
    var mail = el('input', 'lks-input')
    mail.type = 'email'; mail.placeholder = '可不填，不会公开'; mail.maxLength = 100; mail.value = meta.mail || ''
    mail.autocomplete = 'email'
    var link = el('input', 'lks-input')
    link.type = 'url'; link.placeholder = 'https://'; link.maxLength = 200; link.value = meta.link || ''
    link.autocomplete = 'url'
    var nickLabel = el('label', 'lks-field')
    nickLabel.append(el('span', 'lks-field-name', '昵称 · 必填'), nick)
    var avatar = el('div', 'lks-avatar lks-editor-avatar'); fillAvatar(avatar, meta.nick); row.append(avatar, nickLabel)
    var extras = el('details', 'lks-extras')
    if (meta.mail || meta.link || meta.qq) extras.open = true
    extras.appendChild(el('summary', '', '选填信息 · QQ 头像 / 邮箱 / 网站'))
    var extraRow = el('div', 'lks-extra-row')
    var mailLabel = el('label', 'lks-field')
    mailLabel.append(el('span', 'lks-field-name', '邮箱 · 不会公开'), mail)
    var linkLabel = el('label', 'lks-field')
    linkLabel.append(el('span', 'lks-field-name', '个人网站'), link)
    var qq = qqControls(meta, avatar, nick); extraRow.append(qq.label, mailLabel, linkLabel)
    extras.appendChild(extraRow)

    var content = el('textarea', 'lks-textarea')
    content.placeholder = isGuestbook ? '给小窝留句话吧…' : isMusic ? '这首歌让你想起了什么？' : '分享想法，或写下你遇到的问题…'
    content.maxLength = 2000
    content.rows = 4
    var contentLabel = el('label', 'lks-field lks-content-field')
    contentLabel.append(el('span', 'lks-field-name', (isGuestbook ? '留言内容' : '评论内容') + ' · 必填'), content)

    // 蜜罐：真人看不见，机器人爱填
    var hp = el('input', 'lks-hp')
    hp.type = 'text'; hp.tabIndex = -1; hp.autocomplete = 'off'

    var replyBar = el('div', 'lks-reply-bar')
    replyBar.style.display = 'none'

    var turnstileBox = el('div', 'lks-turnstile')

    var actions = el('div', 'lks-actions')
    var msg = el('span', 'lks-msg')
    msg.setAttribute('role', 'status')
    msg.setAttribute('aria-live', 'polite')
    var submit = el('button', 'lks-submit', isGuestbook ? '发布留言' : '发表评论')
    submit.type = 'submit'
    var shortcut = el('span', 'lks-submit-hint', 'Ctrl / ⌘ + Enter 发送')
    actions.append(msg, shortcut, submit)

    var tools = el('div', 'lks-form-tools')
    var counter = el('span', 'lks-counter', '0 / 2000')
    content.addEventListener('input', function () { counter.textContent = content.value.length + ' / 2000' })
    tools.append(emojiBar(content))
    var code = el('button', 'lks-op', '代码'); code.type = 'button'; code.addEventListener('click', function () { insertAtCursor(content, '\n```\n代码写在这里\n```\n') }); tools.append(code)
    var previewButton = el('button', 'lks-op', '预览'), preview = el('div', 'lks-content-preview'); preview.hidden = true; previewButton.type = 'button'; previewButton.setAttribute('aria-pressed', 'false')
    previewButton.addEventListener('click', function () { preview.hidden = !preview.hidden; content.hidden = !preview.hidden; preview.textContent = content.value || '还没有内容'; previewButton.setAttribute('aria-pressed', String(!preview.hidden)); previewButton.textContent = preview.hidden ? '预览' : '继续编辑' })
    tools.append(previewButton, counter)
    if (isMusic) { var quoteSong = el('button', 'lks-op', '引用歌曲'); quoteSong.type = 'button'; quoteSong.addEventListener('click', function () { var player = window.lksMusic && window.lksMusic.player, song = player && player.list.audios[player.list.index]; if (song) insertAtCursor(content, '《' + song.name + '》— ' + (song.artist || '') + '\n') }); tools.insertBefore(quoteSong, counter) }
    contentLabel.append(preview)
    form.append(replyBar, row, extras, contentLabel, tools, hp, turnstileBox, actions)

    state.msgEl = msg
    state.replyBar = replyBar
    state.contentEl = content
    state.contentPlaceholder = content.placeholder
    attachDraft(root, form, content, counter, state)

    form.addEventListener('submit', function (e) {
      e.preventDefault()
      submitComment(root, { nick: nick, qq: qq.input, mail: mail, link: link, content: content, hp: hp, submit: submit })
    })
    content.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        form.requestSubmit()
      }
    })

    qq.input.addEventListener('change', remember)
    nick.addEventListener('change', remember)
    mail.addEventListener('change', remember)
    link.addEventListener('change', remember)
    function remember () {
      saveMeta({ nick: nick.value.trim(), qq: qq.input.value.trim(), mail: mail.value.trim(), link: link.value.trim() })
    }

    if (CFG.turnstileSiteKey) mountTurnstile(turnstileBox)

    return form
  }

  // 表情 / 颜文字选择器：插到光标位置（没点过输入框就追加到末尾）
  var EMOJI_GROUPS = [
    ['😄', '😂', '🤣', '😊', '😍', '🤔', '😅', '🙃', '😭', '😴', '🥲', '😎', '🙂', '🥹', '🥺', '😮', '😤', '😡', '🫠', '👀'],
    ['👍', '👏', '🙏', '💪', '🎉', '🔥', '✨', '☕', '🐟', '🌙', '🍜', '🎮', '❤️', '💯', '🫶', '🤝', '🙌', '🎂', '🌸', '💡'],
    ['(๑•̀ㅂ•́)و✧', '(｡•́︿•̀｡)', '(*/ω＼*)', '(╯°□°)╯', 'ヾ(≧▽≦*)o', '(๑´ㅂ`๑)', '(￣▽￣)／', '(´･ω･`)', '( •̀ ω •́ )✧']
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

  function fillAvatar (avatar, nick, url) {
    avatar.replaceChildren(document.createTextNode((nick || '?').trim().charAt(0).toUpperCase()))
    avatar.style.background = 'hsl(' + hueOf(nick || '') + ', 62%, 62%)'
    if (!url) return
    var img = el('img'); img.alt = ''; img.width = 100; img.height = 100; img.decoding = 'async'; img.referrerPolicy = 'no-referrer'
    img.addEventListener('error', function () { img.remove() }, {once: true})
    img.src = url; avatar.append(img)
  }

  function qqControls (meta, avatar, nick) {
    var label = el('label', 'lks-field lks-qq-field'), qq = el('input', 'lks-input')
    qq.type = 'text'; qq.name = 'qq'; qq.inputMode = 'numeric'; qq.autocomplete = 'off'; qq.maxLength = 12
    qq.placeholder = '填写 QQ 号，使用 QQ 头像'; qq.value = typeof meta.qq === 'string' ? meta.qq : ''
    var hint = el('span', 'lks-qq-status', '仅用于获取头像，号码不在评论中展示')
    hint.id = 'lks-qq-status'; hint.setAttribute('role', 'status'); qq.setAttribute('aria-describedby', hint.id)
    label.append(el('span', 'lks-field-name', 'QQ 号 · 选填'), qq, hint)
    var context = state, timer = 0, run = 0, controller = null, objectUrl = ''
    function clearImage () { if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = ''; fillAvatar(avatar, nick.value) }
    function update () {
      clearTimeout(timer); run++; if (controller) controller.abort(); clearImage()
      var value = qq.value.trim(), invalid = !!value && !/^[1-9]\d{4,11}$/.test(value)
      qq.setCustomValidity(invalid ? '请输入 5–12 位数字的 QQ 号' : ''); qq.setAttribute('aria-invalid', String(invalid))
      hint.classList.toggle('is-error', invalid)
      hint.textContent = invalid ? '请输入 5–12 位数字，不含空格或字母' : value ? '准备获取 QQ 头像…' : '仅用于获取头像，号码不在评论中展示'
      if (!value || invalid) return
      var current = run
      timer = setTimeout(function () {
        controller = new AbortController(); var timeout = setTimeout(function () { controller.abort() }, 6500)
        hint.textContent = '正在获取头像…'
        fetch(API + '/api/avatar/preview', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({qq: value}), signal: controller.signal})
          .then(function (res) { if (!res.ok || !(res.headers.get('content-type') || '').startsWith('image/')) throw new Error('avatar'); return res.blob() })
          .then(function (blob) {
            if (run !== current || state !== context || !qq.isConnected) return
            objectUrl = URL.createObjectURL(blob); fillAvatar(avatar, nick.value, objectUrl)
            var image = avatar.querySelector('img')
            image.addEventListener('load', function () { if (run === current) hint.textContent = '已使用 QQ 头像 · 号码不在评论中展示' }, {once: true})
            image.addEventListener('error', function () { if (run === current) hint.textContent = '头像暂时无法加载，将使用默认头像' }, {once: true})
          })
          .catch(function () { if (run === current && state === context) hint.textContent = '头像暂时无法加载，将使用默认头像；不影响发表评论' })
          .finally(function () { clearTimeout(timeout) })
      }, 600)
    }
    qq.addEventListener('input', update)
    nick.addEventListener('input', function () { if (!objectUrl) fillAvatar(avatar, nick.value) })
    context.disposeAvatar = function () { run++; clearTimeout(timer); if (controller) controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
    if (qq.value) setTimeout(update, 0)
    return {label: label, input: qq}
  }

  function buildItem (root, c, isReply) {
    var item = el('div', 'lks-item' + (isReply ? ' lks-item-reply' : ''))
    item.id = 'comment-' + c.id
    item.setAttribute('data-id', String(c.id))

    var ava = el('div', 'lks-avatar', (c.nick || '?').trim().charAt(0).toUpperCase())
    fillAvatar(ava, c.nick, /^\/api\/avatar\/[a-f0-9]{32}$/.test(c.avatar || '') ? API + c.avatar : '')

    var main = el('div', 'lks-main')
    var head = el('div', 'lks-item-head')

    var name = c.link ? el('a', 'lks-nick', c.nick) : el('span', 'lks-nick', c.nick)
    if (c.link) { name.href = c.link; name.target = '_blank'; name.rel = 'noopener nofollow' }
    var time = el('span', 'lks-time', relativeTime(c.created_at))
    head.appendChild(name)
    if (c.pid) {
      var target = findComment(c.pid)
      head.appendChild(el('span', 'lks-at', '回复 ' + (target ? '@' + target.nick : '某条评论')))
    }
    head.appendChild(time)

    var body = el('div', 'lks-content')
    body.textContent = c.content

    var ops = el('div', 'lks-item-ops')
    var reply = el('button', 'lks-op', '回复')
    reply.type = 'button'
    reply.addEventListener('click', function () { startReply(root, c) })
    ops.appendChild(reply)

    var copyLink = el('button', 'lks-op', '复制链接')
    copyLink.type = 'button'
    copyLink.addEventListener('click', function () {
      var url = location.origin + location.pathname + '#comment-' + c.id
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(function () {
          if (window.btf && window.btf.snackbarShow) window.btf.snackbarShow('评论链接已复制')
          else setMsg('评论链接已复制', 'ok')
        }).catch(function () { setMsg(url, 'ok') })
      } else {
        setMsg(url, 'ok')
      }
    })
    ops.appendChild(copyLink)

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
    var root = document.getElementById(CONTAINER_ID)
    if (!state.comments.length && state.tree) { state.tree.returnForm(false); state.tree.destroy(); state.tree = null; box.replaceChildren() }
    if (!state.comments.length) {
      box.replaceChildren()
      var empty = el('div', 'lks-empty')
      var emptyIcon = el('span', 'lks-empty-icon')
      emptyIcon.innerHTML = '<i class="fas fa-comments" aria-hidden="true"></i>'
      var emptyTitle = el('p', 'lks-empty-title', state.path === '/comments/' ? '还没有留言，来做第一个吧。' : '还没有评论，来聊第一句。')
      var emptyText = el('p', 'lks-empty-text', state.path === '/comments/' ? '不用登录，留个昵称就能说。' : '说说你的想法，或者指出哪里不对。')
      var emptyCta = el('button', 'lks-empty-cta', '写第一条')
      emptyCta.type = 'button'
      emptyCta.addEventListener('click', function () {
        var ta = root.querySelector('.lks-textarea')
        if (ta) ta.focus()
      })
      empty.append(emptyIcon, emptyTitle, emptyText, emptyCta)
      box.appendChild(empty)
      return
    }
    box.querySelectorAll(':scope > .lks-empty').forEach(function (n) { n.remove() })
    if (!state.tree) state.tree = createCommentTree(root, box, state)
    state.tree.sync(); state.treeTools.hidden = !state.comments.some(function (c) { return !!c.pid })
  }

  // Persistent nodes preserve inline drafts and focus while branches animate.
  function createCommentTree (root, box, context) {
    var ns = 'http://www.w3.org/2000/svg', records = new Map(), jobs = new Map(), frame = 0, highlighted = 0, initialized = false
    var narrow = matchMedia('(max-width:520px)'), reduce = matchMedia('(prefers-reduced-motion: reduce)')
    var wires = document.createElementNS(ns, 'svg'); wires.classList.add('lks-tree-wires'); wires.setAttribute('aria-hidden', 'true'); box.append(wires)
    box.classList.add('lks-tree')
    function reduced () { return reduce.matches || document.documentElement.classList.contains('lks-motion-off') }
    function limit (rec) { return rec.parent ? 1 : narrow.matches || context.path === '/music/' ? 1 : 2 }
    function children (rec) { return rec.children || [] }
    function descendants (rec) { var stack = children(rec).slice(), seen = new Set(); while (stack.length) { var n = stack.pop(); if (seen.has(n.c.id)) continue; seen.add(n.c.id); stack.push.apply(stack, children(n)) } return seen.size }
    function button (label, action, cls) { var b = el('button', cls || 'lks-op', label); b.type = 'button'; b.addEventListener('click', action); return b }
    function animate (shell, from, closed, done) {
      var old = jobs.get(shell); if (old) { old.animation.cancel(); jobs.delete(shell) }
      shell.hidden = false; shell.inert = closed
      var target = closed ? 0 : shell.firstElementChild.getBoundingClientRect().height
      function finish () { shell.style.height = ''; shell.hidden = closed; shell.inert = closed; delete shell.dataset.treeMotion; if (done) done(); schedule() }
      if (reduced() || !root.getClientRects().length || Math.abs(from - target) < 1) { finish(); return }
      shell.style.height = from + 'px'; shell.dataset.treeMotion = closed ? 'collapse' : 'expand'
      var a = shell.animate([{height: from + 'px', opacity: closed ? 1 : .5}, {height: target + 'px', opacity: closed ? 0 : 1}], {duration: 220, easing: 'cubic-bezier(.22,.7,.2,1)'})
      var job = {animation: a, finish: finish}; jobs.set(shell, job); schedule()
      a.finished.catch(function () {}).finally(function () { if (jobs.get(shell) !== job) return; jobs.delete(shell); finish() })
    }
    function update (rec, motion) {
      if (!rec.shell) return
      var from = rec.shell.hidden ? 0 : rec.shell.getBoundingClientRect().height
      var old = jobs.get(rec.shell); if (old) { old.animation.cancel(); jobs.delete(rec.shell) }
      var shown = Math.min(rec.limit, rec.children.length)
      rec.children.forEach(function (child, i) {
        var fresh = child.node.hidden && i < shown; child.node.hidden = i >= shown
        if (fresh && motion && rec.open && !reduced()) child.item.animate([{opacity: 0, transform: 'translateY(5px)'}, {opacity: 1, transform: 'none'}], {duration: 180})
      })
      var remaining = rec.children.length - shown
      rec.more.hidden = !remaining; rec.more.textContent = '再看 ' + Math.min(3, remaining) + ' 条回复' + (remaining > 3 ? ' · 还有 ' + remaining + ' 条' : '')
      rec.less.hidden = shown <= limit(rec)
      rec.toggle.textContent = rec.open ? '收起回复' : '展开 ' + descendants(rec) + ' 条回复'
      ;[rec.toggle, rec.rail].forEach(function (b) { b.setAttribute('aria-expanded', String(rec.open)) })
      rec.rail.textContent = rec.open ? '−' : '+'; rec.rail.setAttribute('aria-label', (rec.open ? '收起' : '展开') + ' @' + rec.c.nick + ' 的回复')
      rec.shell.setAttribute('aria-hidden', String(!rec.open))
      if (motion) animate(rec.shell, from, !rec.open)
      else { rec.shell.style.height = ''; rec.shell.hidden = !rec.open; rec.shell.inert = !rec.open; delete rec.shell.dataset.treeMotion }
      schedule()
    }
    function toggle (rec, source) {
      rec.open = !rec.open
      if (!rec.open && rec.shell.contains(document.activeElement)) source.focus({preventScroll: true})
      update(rec, true); highlighted = rec.c.id
    }
    function addBranch (rec) {
      if (rec.shell) return
      rec.shell = el('div', 'lks-branch-shell'); rec.shell.id = 'comment-branch-' + rec.c.id
      rec.inner = el('div', 'lks-branch-inner'); rec.list = el('div', 'lks-tree-children'); rec.controls = el('div', 'lks-branch-tools')
      rec.more = button('', function () { rec.open = true; rec.limit += 3; update(rec, true); if (rec.more.hidden) rec.toggle.focus({preventScroll: true}) })
      rec.less = button('恢复默认', function () { rec.limit = limit(rec); update(rec, true); rec.toggle.focus({preventScroll: true}) })
      rec.controls.append(rec.more, rec.less); rec.inner.append(rec.list, rec.controls); rec.shell.append(rec.inner); rec.node.append(rec.shell)
      rec.toggle = button('', function () { toggle(rec, rec.toggle) }); rec.toggle.dataset.branchToggle = rec.c.id
      rec.rail = button('+', function () { toggle(rec, rec.rail) }, 'lks-rail-toggle'); rec.rail.dataset.railId = rec.c.id
      ;[rec.toggle, rec.rail].forEach(function (b) { b.setAttribute('aria-controls', rec.shell.id) })
      rec.item.querySelector('.lks-item-ops').append(rec.toggle); rec.item.append(rec.rail)
    }
    function mount (c) {
      var rec = records.get(c.id); if (rec) { rec.c = c; return rec }
      var node = el('div', 'lks-tree-node'), item = buildItem(root, c, !!c.pid)
      node.dataset.nodeId = c.id; node.append(item)
      rec = {c: c, node: node, item: item, avatar: item.querySelector('.lks-avatar'), children: [], parent: null, open: false, limit: 1}; records.set(c.id, rec); return rec
    }
    function sync () {
      var ids = new Set(context.comments.map(function (c) { return c.id }))
      records.forEach(function (rec, id) { if (!ids.has(id)) { if (rec.node.contains(context.form)) returnForm(false); rec.node.remove(); records.delete(id) } })
      context.comments.forEach(mount)
      records.forEach(function (rec) { rec.children = []; rec.parent = null })
      records.forEach(function (rec) {
        var parent = rec.c.pid && records.get(rec.c.pid)
        if (!parent && rec.c.rid !== rec.c.id) parent = records.get(rec.c.rid)
        var p = parent, seen = new Set([rec.c.id]); while (p) { if (seen.has(p.c.id)) { parent = null; break } seen.add(p.c.id); p = p.c.pid && records.get(p.c.pid) }
        if (parent) { rec.parent = parent; parent.children.push(rec) }
        rec.node.classList.toggle('lks-thread', !rec.parent)
      })
      var roots = Array.from(records.values()).filter(function (r) { return !r.parent }).sort(function (a, b) { return (context.order === 'earliest' ? 1 : -1) * (a.c.created_at - b.c.created_at || a.c.id - b.c.id) })
      if (!initialized && roots.length) { roots[0].open = true; initialized = true }
      records.forEach(function (rec) {
        if (!rec.configured) { rec.limit = limit(rec); rec.configured = true }
        if (rec.children.length) addBranch(rec)
        rec.children.sort(function (a, b) { return a.c.created_at - b.c.created_at || a.c.id - b.c.id })
        rec.children.forEach(function (child) { if (child.node.parentNode !== rec.list) rec.list.append(child.node) })
        if (rec.toggle) { rec.toggle.hidden = !rec.children.length; rec.rail.hidden = !rec.children.length }
      })
      roots.forEach(function (rec) { box.append(rec.node); rec.node.hidden = false })
      // Parent nodes are updated after their descendants, for accurate animation measurements.
      Array.from(records.values()).reverse().forEach(function (rec) { update(rec, false) })
      if (context.replyTo) attachForm(context.replyTo.id, false)
      schedule()
    }
    function reveal (id) {
      var rec = records.get(Number(id)), child = rec, seen = new Set()
      while (child && child.parent && !seen.has(child.c.id)) { seen.add(child.c.id); var p = child.parent; p.open = true; p.limit = Math.max(p.limit, p.children.indexOf(child) + 1); update(p, false); child = p }
      schedule(); return rec
    }
    function attachForm (id, motion) {
      var rec = reveal(id); if (!rec || !context.form) return
      if (!rec.editor) { rec.editor = el('div', 'lks-inline-shell'); rec.editor.append(el('div', 'lks-inline-inner')); rec.item.querySelector('.lks-main').append(rec.editor) }
      var inner = rec.editor.firstElementChild
      if (inner.contains(context.form)) return
      var previous = context.form.closest('.lks-inline-shell')
      inner.append(context.form); if (previous) { previous.hidden = true; previous.inert = true }
      if (motion !== false) animate(rec.editor, 0, false); else { rec.editor.hidden = false; rec.editor.inert = false }
      context.form.classList.add('is-inline'); schedule()
    }
    function returnForm (motion) {
      var form = context.form, previous = form && form.closest('.lks-inline-shell')
      if (!form || !context.formHome) return
      function move () { if (previous && form.closest('.lks-inline-shell') !== previous) return; context.formHome.append(form); form.classList.remove('is-inline') }
      if (previous && motion) animate(previous, previous.getBoundingClientRect().height, true, move)
      else { move(); if (previous) { previous.hidden = true; previous.inert = true } }
      schedule()
    }
    function bulk (open) {
      records.forEach(function (rec) { if (!rec.parent && rec.shell) { rec.open = open; rec.limit = limit(rec); update(rec, true) } else if (rec.shell) { rec.open = false; rec.limit = limit(rec); update(rec, false) } }); schedule()
    }
    function draw () {
      if (!root.isConnected || !box.getClientRects().length) return
      var bounds = box.getBoundingClientRect(); wires.setAttribute('width', bounds.width); wires.setAttribute('height', bounds.height); wires.setAttribute('viewBox', '0 0 ' + bounds.width + ' ' + Math.max(1, bounds.height)); wires.replaceChildren()
      function path (d, rec, child, x, y) { var p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); p.dataset.parentId = rec.c.id; if (child) { p.dataset.childId = child.c.id; p.dataset.endX = x; p.dataset.endY = y } p.classList.toggle('is-active', highlighted === rec.c.id); wires.append(p) }
      records.forEach(function (rec) {
        if (!rec.shell || !rec.children.length || !rec.avatar.getClientRects().length) return
        var clip = Infinity; for (var n = rec.node.parentElement; n && n !== box; n = n.parentElement) if (n.classList.contains('lks-branch-shell')) clip = n.hidden ? -Infinity : Math.min(clip, n.getBoundingClientRect().bottom)
        var a = rec.avatar.getBoundingClientRect(); if (a.top >= clip) return
        var item = rec.item.getBoundingClientRect(), ops = rec.item.querySelector('.lks-item-ops').getBoundingClientRect(), x = a.left + a.width / 2 - bounds.left, start = a.bottom + 3 - bounds.top
        var cy = Math.max(a.bottom + 13, ops.top + ops.height / 2) - bounds.top, end = cy + 8
        rec.rail.style.left = (x + bounds.left - item.left - 11) + 'px'; rec.rail.style.top = (cy + bounds.top - item.top - 11) + 'px'
        if (!rec.shell.hidden) { var bottom = Math.min(clip, rec.shell.getBoundingClientRect().bottom) - bounds.top
          rec.children.forEach(function (child) { if (child.node.hidden || !child.avatar.getClientRects().length) return; var r = child.avatar.getBoundingClientRect(), yy = r.top + r.height / 2 - bounds.top, xx = r.left - bounds.left - 3
            if (xx <= x || yy < start) return
            if (yy > bottom) { end = Math.max(end, bottom); return }
            var radius = Math.max(0, Math.min(11, (xx - x) / 2, yy - start)); end = Math.max(end, yy - radius); path('M ' + x + ' ' + (yy - radius) + ' Q ' + x + ' ' + yy + ' ' + (x + radius) + ' ' + yy + ' H ' + xx, rec, child, xx, yy)
          })
        }
        end = Math.min(end, clip - bounds.top); if (end > start) path('M ' + x + ' ' + start + ' V ' + end, rec)
      })
    }
    function tick () { frame = 0; if (!root.isConnected) return; draw(); if (jobs.size) frame = requestAnimationFrame(tick) }
    function schedule () { if (!frame) frame = requestAnimationFrame(tick) }
    var observer = new ResizeObserver(schedule); observer.observe(box)
    var visibility = new MutationObserver(function () { if (reduced()) finishJobs(); schedule() }); visibility.observe(document.documentElement, {attributes: true, attributeFilter: ['class']})
    function finishJobs () { jobs.forEach(function (job) { job.animation.cancel(); job.finish() }); jobs.clear() }
    function resized () { records.forEach(function (rec) { rec.limit = Math.min(rec.limit, limit(rec)); update(rec, false) }); schedule() }
    function onReduce () { if (reduced()) finishJobs() }
    narrow.addEventListener('change', resized); reduce.addEventListener('change', onReduce)
    box.addEventListener('pointerover', function (e) { var n = e.target.closest('.lks-tree-node'); highlighted = n ? Number(n.dataset.nodeId) : 0; schedule() })
    box.addEventListener('pointerleave', function () { highlighted = 0; schedule() })
    box.addEventListener('focusin', function (e) { var n = e.target.closest('.lks-tree-node'); highlighted = n ? Number(n.dataset.nodeId) : 0; schedule() })
    return {sync: sync, reveal: reveal, attachForm: attachForm, returnForm: returnForm, bulk: bulk, destroy: function () { observer.disconnect(); visibility.disconnect(); narrow.removeEventListener('change', resized); reduce.removeEventListener('change', onReduce); jobs.forEach(function (j) { j.animation.cancel() }); jobs.clear(); cancelAnimationFrame(frame) }}
  }

  function active (context, root) {
    return state === context && root.isConnected && context.path === currentPath()
  }

  function targetMessage (context, text) {
    context.targetStatusEl.textContent = text
    context.targetStatusEl.hidden = !text
  }

  async function locateTarget (root) {
    var context = state, hash = location.hash
    var match = /^#comment-([1-9]\d*)$/.exec(hash)
    if (!match || !active(context, root) || context.locatingHash === hash || context.resolvedHash === hash) return
    var run = (context.locateRun || 0) + 1
    context.locateRun = run
    context.locatingHash = hash
    targetMessage(context, '正在定位这条评论…')
    document.dispatchEvent(new CustomEvent('lks:comment-target'))
    function current () { return active(context, root) && location.hash === hash && context.locateRun === run }
    try {
      if (context.pending) await context.pending
      while (current() && !document.getElementById('comment-' + match[1])) {
        if (context.failed) {targetMessage(context, '评论加载中断，点击“重新加载”后会继续定位。'); return}
        if (!context.hasMore) {
          targetMessage(context, '暂时找不到这条评论，可能已删除或尚未公开。')
          context.resolvedHash = hash
          return
        }
        if (!await load(root, true)) {
          if (current()) targetMessage(context, '评论加载中断，点击“重新加载”后会继续定位。')
          return
        }
      }
      if (!current()) return
      context.resolvedHash = hash
      targetMessage(context, '')
      // Allow the music drawer's opening transition and comment CSS to settle.
      setTimeout(function () {
        if (!current()) return
        var node = document.getElementById('comment-' + match[1])
        if (!node) return
        if (context.tree) context.tree.reveal(Number(match[1]))
        node.tabIndex = -1
        node.focus({preventScroll: true})
        node.scrollIntoView({block: 'center', behavior: document.documentElement.classList.contains('lks-motion-off') || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'})
        node.classList.add('is-target')
        setTimeout(function () { node.classList.remove('is-target') }, 2600)
      }, context.path === '/music/' ? 280 : 80)
    } finally {
      if (context.locateRun === run) context.locatingHash = ''
    }
  }

  window.addEventListener('hashchange', function () {
    var root = document.getElementById(CONTAINER_ID)
    if (!root || !state.targetStatusEl) return
    state.locateRun = (state.locateRun || 0) + 1
    state.locatingHash = ''; state.resolvedHash = ''
    targetMessage(state, '')
    root.querySelectorAll('.is-target').forEach(function (node) { node.classList.remove('is-target') })
    locateTarget(root)
  })

  function clearReply () {
    state.replyTo = null
    if (state.tree) state.tree.returnForm(true)
    if (state.replyBar) state.replyBar.style.display = 'none'
    if (state.contentEl) state.contentEl.placeholder = state.contentPlaceholder
    if (state.markDraft) state.markDraft()
  }

  function startReply (root, c, focus) {
    state.replyTo = { id: c.id, rid: c.rid || c.id, nick: c.nick }
    state.replyBar.style.display = ''
    state.replyBar.innerHTML = ''
    state.replyBar.append(
      el('span', '', '正在回复 @' + c.nick),
      (function () {
        var cancel = el('button', 'lks-op', '取消')
        cancel.type = 'button'
        cancel.addEventListener('click', function () {
          clearReply(); var target = document.querySelector('#comment-' + c.id + ' .lks-item-ops button'); if (target) target.focus({preventScroll:true})
        })
        return cancel
      })()
    )
    if (state.tree) state.tree.attachForm(c.id, focus !== false)
    if (state.markDraft && focus !== false) state.markDraft()
    var ta = root.querySelector('.lks-textarea') || state.contentEl
    if (ta) {
      ta.placeholder = '回复 @' + c.nick + '…'
      if (focus !== false) ta.focus()
    }
  }

  function removeComment (root, c, btn) {
    if (!window.confirm('确定删除这条评论吗？')) return
    btn.disabled = true
    api('/api/comments/' + c.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + getToken() } })
      .then(function () {
        state.comments = state.comments.filter(function (x) { return x.id !== c.id })
        state.total = Math.max(0, state.total - 1)
        renderList()
        updateHeadline()
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
    if (fields.submit.disabled) return
    var nick = fields.nick.value.trim()
    var content = fields.content.value.trim()
    if (!nick) { setMsg('昵称别空着呀～', 'err'); fields.nick.focus(); return }
    if (!content) { setMsg('还没写内容呢', 'err'); fields.content.focus(); return }
    if (CFG.turnstileSiteKey && !state.turnstileToken) { setMsg('请先完成人机验证', 'err'); return }

    var payload = {
      path: state.path,
      nick: nick,
      qq: fields.qq.value.trim(),
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

    flushDraft()
    var context = state, sentText = fields.content.value, sentAt = Date.now()
    fields.submit.disabled = true
    setMsg('发送中…')
    api('/api/comments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (data) {
        saveMeta({ nick: nick, qq: payload.qq, mail: payload.mail, link: payload.link })
        forgetSubmittedDraft(payload.path, sentText, sentAt)
        if (!active(context, root)) return
        if (fields.content.value === sentText) {
          fields.content.value = ''
          fields.content.dispatchEvent(new Event('input', { bubbles: true }))
          clearReply(); flushDraft()
        }
        if (data.pending) {
          setMsg('已提交，等站长审核后就会显示 ✅', 'ok')
        } else if (data.comment) {
          if (state.tree && data.comment.pid) state.tree.reveal(data.comment.pid)
          state.comments.unshift(data.comment)
          state.total += 1
          renderList()
          if (state.tree) state.tree.reveal(data.comment.id)
          updateHeadline()
          setMsg('发表成功 🎉', 'ok')
        }
        if (window.turnstile && CFG.turnstileSiteKey) {
          state.turnstileToken = ''
          try { window.turnstile.reset() } catch (e) {}
        }
      })
      .catch(function (err) { if (active(context, root)) setMsg(err.message, 'err') })
      .then(function () { fields.submit.disabled = false })
  }

  function load (root, append) {
    var context = state
    if (context.loading) return context.pending
    var page = append ? context.page + 1 : 1
    context.loading = true; context.failed = false
    root.querySelectorAll('.lks-list-order button').forEach(function (b) { b.disabled = true })
    context.retryBtn.hidden = true
    context.listStatusEl.classList.add('is-loading')
    context.listStatusTextEl.textContent = append ? '' : (context.path === '/comments/' ? '正在加载留言…' : '正在加载评论…')
    context.moreBtn.disabled = true
    context.moreBtn.textContent = '加载中…'
    context.pending = api('/api/comments?path=' + encodeURIComponent(context.path) + '&page=' + page + '&pageSize=' + PAGE_SIZE + '&view=threads&order=' + (context.order || 'latest'))
      .then(function (data) {
        if (!active(context, root)) return false
        context.total = data.total
        var seen = Object.create(null)
        context.comments = (append ? context.comments.concat(data.comments) : data.comments).filter(function (comment) {
          if (seen[comment.id]) return false
          seen[comment.id] = true; return true
        })
        context.page = page
        context.hasMore = !!data.hasMore && data.comments.length > 0
        renderList()
        context.moreBtn.style.display = context.hasMore ? '' : 'none'
        context.listStatusTextEl.textContent = ''
        updateHeadline()
        return true
      })
      .catch(function () {
        if (!active(context, root)) return false
        context.failed = true
        context.listStatusTextEl.textContent = (context.path === '/comments/' ? '留言' : '评论') + '暂时没加载出来，请稍后重试。'
        context.retryBtn.hidden = false
        return false
      })
      .then(function (ok) {
        context.loading = false
        if (active(context, root)) {
          context.listStatusEl.classList.remove('is-loading')
          root.querySelectorAll('.lks-list-order button').forEach(function (b) { b.disabled = false })
          context.moreBtn.disabled = false
          context.moreBtn.textContent = '加载更多'
        }
        return ok
      })
    return context.pending
  }

  function updateHeadline () {
    var head = document.querySelector('#post-comment .comment-headline span')
    if (head) head.textContent = (state.path === '/comments/' ? ' 留言' : ' 评论') + (state.total ? '（' + state.total + '）' : '')
    if (state.listCountEl) state.listCountEl.textContent = state.total + ' 条'
  }

  function init () {
    var root = document.getElementById(CONTAINER_ID)
    if (!root) { if (state.tree) { state.tree.destroy(); state.tree = null } if (state.disposeAvatar) state.disposeAvatar(); return }
    var path = currentPath()
    if (root.getAttribute('data-path') === path) { locateTarget(root); return }   // pjax 后同页不重复初始化
    root.setAttribute('data-path', path)
    flushDraft()
    if (state.tree) state.tree.destroy()
    if (state.disposeAvatar) state.disposeAvatar()
    state = { path: path, page: 1, total: 0, comments: [], replyTo: null, loading: false }
    loadCSS('/css/comment.css?v=20261101-thread-qq-1')
    render(root)
    updateHeadline()
    load(root, false).then(function () { locateTarget(root) })
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()

  // pjax 站内跳转后重新渲染
  if (window.btf && window.btf.addGlobalFn) window.btf.addGlobalFn('pjaxComplete', init, 'lksComment')
  document.addEventListener('pjax:complete', init)
  window.lksComment = { init: init, saveDraft: flushDraft, state: function () { return state } }
})()
