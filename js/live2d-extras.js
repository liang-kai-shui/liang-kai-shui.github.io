/*!
 * 看板娘增强：换皮肤 + 聊天
 *
 * 一、换皮肤
 *
 *   引擎（xiaze yu 的 live2d-widget）合并配置的写法是：
 *
 *     configApplyer(新配置) → merge(内部配置, 新配置, 默认值)
 *     merge 里：目标已有值时，只有"两边都是对象"才递归往下合，
 *               否则**直接忽略新值**（字符串属于这一类）
 *
 *   所以第二次 `L2Dwidget.init({model:{jsonPath:新路径}})` 是没用的：
 *   config.model.jsonPath 已经是字符串，新路径被丢掉，等于白 init 一次。
 *   （第一版就是照"再 init 一次"写的，实测点了没反应、模型纹丝不动。）
 *
 *   解决办法是绕过 merge，直接改**引擎内部那个配置对象**：
 *   引擎的 Widget 构造函数里写着 `this.config = u.config`，而 `u.config`
 *   就是 configApplyer 往里合并的那个对象 —— 也就是说
 *   `L2Dwidget.config` 就是内部配置本体。把它上面的 jsonPath 改掉再 init()，
 *   merge 不会覆盖我们刚写的值，theRealInit 就会按新路径重建容器
 *   （它每次都会先 removeChild 掉旧容器，所以不会叠两只）。
 *
 *   另外还有一处优化：访客上次选的皮肤要"第一次 init 就生效"。
 *   插件那段 `L2Dwidget.init({...})` 是页面里的内联脚本，而主题的 inject.bottom
 *   画在它前面，所以这里能抢先用 defineProperty 拦住 window.L2Dwidget 的赋值，
 *   把 init 包一层，把选中皮肤的路径塞进去 —— 省掉一次白下载
 *   （默认那套 koharu 500KB，静香 2.6MB）。
 *
 *   加皮肤 = `npm i live2d-widget-model-xxx` + 重新构建（清单由
 *   scripts/live2d-skins.js 生成），前端不用改。
 *
 * 二、聊天
 *   对话走自建 Worker 的 /api/chat（DeepSeek 的密钥存在 Worker 上，前端拿不到也不该拿到）。
 *   配置在 _config.butterfly.yml → lks_chat；后端没配密钥时 /api/chat/status 会说没开，
 *   这里就把聊天入口收起来，只留换装。
 */
(function () {
  'use strict'

  var SKIN_KEY = 'lks_live2d_skin'
  var HISTORY_KEY = 'lks_chat_history'
  var SESSION_KEY = 'lks_chat_session'
  var CONFIG = window.LKS_CHAT || {}
  var API = (CONFIG.api || '').replace(/\/+$/, '')
  var MAX_HISTORY = Number(CONFIG.maxHistory) > 0 ? Number(CONFIG.maxHistory) : 20

  /* ==================================================================== *
   * 小工具
   * ==================================================================== */
  function el (tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }

  function read (key) {
    try { return window.localStorage.getItem(key) } catch (e) { return null }
  }
  function write (key, val) {
    try { window.localStorage.setItem(key, val) } catch (e) { /* 隐私模式 */ }
  }

  /* ==================================================================== *
   * 一、换皮肤
   * ==================================================================== */

  var skinsCache = null

  /** 存的是 {id, url}：拦 init 的那一刻必须能同步拿到地址，等不了异步清单 */
  function savedSkin () {
    var raw = read(SKIN_KEY)
    if (!raw) return null
    try {
      var o = JSON.parse(raw)
      return (o && o.id && o.url) ? o : null
    } catch (e) {
      return null
    }
  }

  function loadSkins () {
    if (skinsCache) return Promise.resolve(skinsCache)
    return fetch('/live2d/skins.json', { cache: 'no-cache' })
      .then(function (r) { return r.json() })
      .then(function (data) {
        skinsCache = (data && data.skins) || []
        return skinsCache
      })
      .catch(function () { return null })   // null = 没拉到，和"拉到了但是空"区分开
  }

  /** 从页面里那段 `L2Dwidget.init({...})` 抠出插件用的配置（位置、大小、tagMode 这些） */
  function baseConfig () {
    var scripts = document.querySelectorAll('script')
    for (var i = 0; i < scripts.length; i++) {
      var text = scripts[i].textContent || ''
      var m = text.match(/L2Dwidget\.init\(\s*(\{[\s\S]*\})\s*\)/)
      if (m) {
        try { return JSON.parse(m[1]) } catch (e) { /* 不是 JSON 就算了 */ }
      }
    }
    return null
  }

  /**
   * 换皮肤：不刷新页面。
   * 关键点是直接改引擎内部那个配置对象（L2Dwidget.config 就是它），
   * 因为走 init 的参数会被引擎的 merge 丢掉 —— 原因见文件头注释。
   */
  function applySkin (skin) {
    if (!skin || !skin.url) return false
    var w = window.L2Dwidget
    if (!w || !w.config || typeof w.init !== 'function') return false

    write(SKIN_KEY, JSON.stringify({ id: skin.id, url: skin.url }))

    w.config.model = w.config.model || {}
    w.config.model.jsonPath = skin.url

    // 再 init 一次：theRealInit 会先 removeChild 掉旧容器再建新的，不会叠两只。
    // 传插件那份原始配置是为了把位置/大小/tagMode 都摆回原样；
    // 里面的旧 jsonPath 会被 merge 忽略掉（正是那个"坑"帮了我们）。
    w.init(baseConfig() || {})
    return true
  }

  // 抢在插件的 init 之前把 jsonPath 换成上次选的，顺带省掉一次白下载
  try {
    var real = null
    Object.defineProperty(window, 'L2Dwidget', {
      configurable: true,
      get: function () { return real },
      set: function (v) {
        real = v
        if (v && typeof v.init === 'function' && !v.__lksWrapped) {
          var orig = v.init.bind(v)
          v.init = function (cfg) {
            var want = savedSkin()
            if (want && want.url && cfg && cfg.model) cfg.model.jsonPath = want.url
            return orig(cfg)
          }
          v.__lksWrapped = true
        }
      }
    })
  } catch (e) { /* 不支持 defineProperty 就退回默认皮肤，不影响别的功能 */ }

  /**
   * 页面加载完之后拿清单核对一次：
   *   · 存的皮肤已经不在清单里（模型被删/改名）→ 清掉选择，就地换回默认那套
   *   · 地址变了 → 更新存的那份，免得下次进站拿着老地址扑空
   * 只在真的拉到清单时才动手，拉失败就保持现状（否则会清掉用户的选择）
   */
  function reconcileSkin () {
    var want = savedSkin()
    if (!want) return
    loadSkins().then(function (skins) {
      if (!skins) return
      var hit = skins.filter(function (s) { return s.id === want.id })[0]
      if (!hit) {
        try { window.localStorage.removeItem(SKIN_KEY) } catch (e) { /* 忽略 */ }
        return
      }
      if (hit.url !== want.url) write(SKIN_KEY, JSON.stringify({ id: hit.id, url: hit.url }))
    })
  }

  /* ==================================================================== *
   * 二、聊天
   * ==================================================================== */

  var chatReady = null          // null 未探测 / true 可用 / false 不可用
  var sending = false
  var history = []

  // 快捷问法：点了直接发出去。挑的都是"能体现它读过博客"的问题
  var QUICK_ASKS = ['这个站都写了啥？', '帮我总结最新那篇', '最近在折腾什么？']

  /**
   * 对话历史存 localStorage（不是 sessionStorage）：
   * 刷新页面、切到别的标签再回来，上下文都还在 —— 不然聊到一半刷新就"失忆"了。
   */
  function loadHistory () {
    var raw = read(HISTORY_KEY)
    if (!raw) return []
    try {
      var arr = JSON.parse(raw)
      return Array.isArray(arr) ? arr.slice(-MAX_HISTORY) : []
    } catch (e) { return [] }
  }

  function saveHistory () {
    write(HISTORY_KEY, JSON.stringify(history.slice(-MAX_HISTORY)))
  }

  /** 一次对话的 id：后台拿它把消息串成一个会话；清空对话会换一个新的 */
  function currentSession () {
    var s = read(SESSION_KEY)
    if (!s || !/^[A-Za-z0-9_-]{1,64}$/.test(s)) {
      s = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
      write(SESSION_KEY, s)
    }
    return s
  }

  /** 清空对话：丢掉历史 + 换会话 id，下次提问就是全新的一段（避免之前的上下文带偏） */
  function clearChat () {
    history = []
    try { window.localStorage.removeItem(HISTORY_KEY) } catch (e) { /* 忽略 */ }
    try { window.localStorage.removeItem(SESSION_KEY) } catch (e) { /* 忽略 */ }
    currentSession()
    if (msgsBox) msgsBox.textContent = ''
    if (tip) tip.textContent = ''
    renderHistory()
  }

  function checkChat () {
    if (chatReady !== null) return Promise.resolve(chatReady)
    if (!API) { chatReady = false; return Promise.resolve(false) }
    return fetch(API + '/api/chat/status', { cache: 'no-cache' })
      .then(function (r) { return r.json() })
      .then(function (j) {
        chatReady = !!(j && j.ok && j.data && j.data.enabled)
        return chatReady
      })
      .catch(function () { chatReady = false; return false })
  }

  function send (text) {
    var msgs = history.concat([{ role: 'user', content: text }])
    return fetch(API + '/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: msgs.slice(-MAX_HISTORY),
        // session 用来把一次对话串起来（后台按会话查看/统计）；
        // 点"清空对话"会换一个新的 session，所以清空之后是干净的一段
        session: currentSession(),
        path: window.location.pathname
      })
    }).then(function (r) {
      return r.json().catch(function () { return {} }).then(function (j) {
        if (r.ok && j && j.ok && j.data && j.data.reply) return j.data.reply
        var err = new Error((j && j.error) || '服务暂时不可用')
        err.status = r.status
        throw err
      })
    })
  }

  function friendlyError (err) {
    if (!err) return '出了点问题，再试一次？'
    if (err.status === 429) return err.message
    if (err.status === 503) return '聊天还没开通，站主配好密钥就会出现了。'
    if (err.status === 502) return '后端连不上模型，过一会儿再试试。'
    if (err.status === 400) return err.message || '这条消息发不出去，换个说法试试。'
    if (err.name === 'TypeError' || /fetch/i.test(err.message || '')) return '网络不太好，检查一下连接？'
    return err.message || '出了点问题，再试一次？'
  }

  /* ==================================================================== *
   * 三、界面
   * ==================================================================== */

  var root, launcher, panel, msgsBox, form, input, typing, tip, note, clearBtn, skinsBox, tabChat, tabSkin

  function buildUI () {
    root = el('div', 'lks-pet')
    root.id = 'lks-pet'

    launcher = el('button', 'lks-pet-launcher')
    launcher.type = 'button'
    launcher.title = '和小窝助手聊聊'
    launcher.setAttribute('aria-label', '和小窝助手聊聊')
    launcher.appendChild(el('span', 'lks-pet-launcher-icon', '💬'))

    panel = el('section', 'lks-pet-panel')
    panel.hidden = true

    var head = el('header', 'lks-pet-head')
    var tabs = el('div', 'lks-pet-tabs')
    tabChat = el('button', 'lks-pet-tab on', '聊天')
    tabChat.type = 'button'
    tabSkin = el('button', 'lks-pet-tab', '换装')
    tabSkin.type = 'button'
    tabs.appendChild(tabChat)
    tabs.appendChild(tabSkin)
    // 清空对话：把聊过的一整段丢掉，换一个新的会话 id。
    // 为什么需要它：上下文是整段发给模型的，之前聊跑偏了会一直影响后面的回答
    clearBtn = el('button', 'lks-pet-clear', '清空')
    clearBtn.type = 'button'
    clearBtn.title = '清空这次对话（之前聊的就不再带进上下文了）'
    var close = el('button', 'lks-pet-close', '✕')
    close.type = 'button'
    close.title = '收起'
    head.appendChild(tabs)
    head.appendChild(clearBtn)
    head.appendChild(close)

    var body = el('div', 'lks-pet-body')

    // —— 聊天 ——
    var chatPane = el('div', 'lks-pet-pane lks-pet-chat')
    msgsBox = el('div', 'lks-pet-msgs')
    typing = el('div', 'lks-pet-typing', '正在想…')
    typing.hidden = true

    // 快捷问法：既省事，也顺便告诉访客"这玩意能问博客里的事"
    var quick = el('div', 'lks-pet-quick')
    QUICK_ASKS.forEach(function (text) {
      var b = el('button', 'lks-pet-quick-btn', text)
      b.type = 'button'
      b.addEventListener('click', function () {
        input.value = text
        submitMsg()
      })
      quick.appendChild(b)
    })

    form = el('form', 'lks-pet-form')
    input = el('textarea', 'lks-pet-input')
    input.rows = 1
    input.placeholder = '说点什么…（Enter 发送，Shift+Enter 换行）'
    input.maxLength = 1000
    var submit = el('button', 'lks-pet-send', '发送')
    submit.type = 'submit'
    form.appendChild(input)
    form.appendChild(submit)
    tip = el('p', 'lks-pet-tip')
    note = el('p', 'lks-pet-note', '聊天内容会被记录，用来改进这个看板娘，别发隐私信息。')
    chatPane.appendChild(msgsBox)
    chatPane.appendChild(typing)
    chatPane.appendChild(quick)
    chatPane.appendChild(form)
    chatPane.appendChild(tip)
    chatPane.appendChild(note)

    // —— 换装 ——
    var skinPane = el('div', 'lks-pet-pane lks-pet-skins')
    skinPane.hidden = true
    skinsBox = skinPane

    body.appendChild(chatPane)
    body.appendChild(skinPane)
    panel.appendChild(head)
    panel.appendChild(body)
    root.appendChild(launcher)
    root.appendChild(panel)
    document.body.appendChild(root)

    launcher.addEventListener('click', togglePanel)
    close.addEventListener('click', function () { setOpen(false) })
    clearBtn.addEventListener('click', clearChat)

    tabChat.addEventListener('click', function () { switchTab('chat') })
    tabSkin.addEventListener('click', function () { switchTab('skin') })

    form.addEventListener('submit', function (e) {
      e.preventDefault()
      submitMsg()
    })
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault()
        submitMsg()
      }
    })
    input.addEventListener('input', function () {
      input.style.height = 'auto'
      input.style.height = Math.min(input.scrollHeight, 96) + 'px'
    })

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !panel.hidden) setOpen(false)
    })

    renderHistory()
  }

  function switchTab (which) {
    var isChat = which === 'chat'
    tabChat.classList.toggle('on', isChat)
    tabSkin.classList.toggle('on', !isChat)
    panel.querySelector('.lks-pet-chat').hidden = !isChat
    panel.querySelector('.lks-pet-skins').hidden = isChat
    if (!isChat) renderSkins()
  }

  function setOpen (open) {
    panel.hidden = !open
    root.classList.toggle('lks-pet-open', open)
    if (open) {
      checkChat().then(function (ok) {
        if (!ok) {
          // 后端没开聊天：直接把换装页摆出来，省得访客点进去看到一句"没开通"
          tabChat.hidden = true
          switchTab('skin')
          tip.textContent = ''
        } else {
          tabChat.hidden = false
          switchTab('chat')
          setTimeout(function () { input.focus() }, 60)
        }
      })
    }
  }

  function togglePanel () { setOpen(panel.hidden) }

  // —— 消息渲染 ——

  /**
   * 把回复里的链接变成可点的。
   * 注意：**不能**用 innerHTML —— 那是模型输出的内容，等于给自己开一个 XSS 口子。
   * 这里按 URL 切开，剩下的部分一律用 createTextNode 拼上去。
   */
  var LINK_RE = /(https?:\/\/[^\s，。！？；：'"）)】\]]+|\/posts\/[A-Za-z0-9]+\.html?)/g

  function fillBubble (bubble, text) {
    var parts = String(text).split(LINK_RE)
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i]
      if (!part) continue
      if (LINK_RE.test(part) && /^(https?:\/\/|\/posts\/)/.test(part)) {
        LINK_RE.lastIndex = 0
        var a = document.createElement('a')
        a.textContent = part
        a.href = part
        a.target = '_blank'
        a.rel = 'noopener noreferrer'
        bubble.appendChild(a)
      } else {
        LINK_RE.lastIndex = 0
        bubble.appendChild(document.createTextNode(part))
      }
    }
  }

  function addMsg (role, text) {
    var row = el('div', 'lks-pet-msg lks-pet-msg-' + role)
    var bubble = el('div', 'lks-pet-bubble')
    if (role === 'assistant') fillBubble(bubble, text)
    else bubble.textContent = text
    row.appendChild(bubble)
    msgsBox.appendChild(row)
    msgsBox.scrollTop = msgsBox.scrollHeight
    return row
  }

  function renderHistory () {
    history = loadHistory()
    if (!history.length) {
      addMsg('assistant', CONFIG.greeting || '你好呀，随便聊点什么？')
      return
    }
    for (var i = 0; i < history.length; i++) addMsg(history[i].role, history[i].content)
  }

  function submitMsg () {
    if (sending) return
    var text = (input.value || '').trim()
    if (!text) return
    input.value = ''
    input.style.height = 'auto'
    tip.textContent = ''
    addMsg('user', text)
    history.push({ role: 'user', content: text })
    saveHistory()

    sending = true
    typing.hidden = false
    form.classList.add('lks-pet-busy')

    // 记下这次请求属于哪一段对话：如果期间用户点了"清空"，
    // 回来的回复（或报错）就不该再插进新会话里
    var sessionAtSend = currentSession()

    send(text).then(function (reply) {
      typing.hidden = true
      form.classList.remove('lks-pet-busy')
      sending = false
      if (currentSession() !== sessionAtSend) return
      addMsg('assistant', reply)
      history.push({ role: 'assistant', content: reply })
      saveHistory()
    }).catch(function (err) {
      typing.hidden = true
      form.classList.remove('lks-pet-busy')
      sending = false
      if (currentSession() !== sessionAtSend) return
      tip.textContent = friendlyError(err)
    })
  }

  // —— 皮肤列表 ——
  function renderSkins () {
    if (skinsBox.getAttribute('data-ready')) return
    skinsBox.setAttribute('data-ready', '1')
    skinsBox.appendChild(el('p', 'lks-pet-hint', '换个看板娘（会记住你的选择）：'))
    loadSkins().then(function (skins) {
      if (!skins || !skins.length) {
        skinsBox.appendChild(el('p', 'lks-pet-hint', '没找到皮肤，检查一下 /live2d/skins.json 有没有生成'))
        return
      }
      var current = savedSkin()
      var currentId = (current && current.id) || ((skins.filter(function (s) { return s.isDefault })[0]) || {}).id
      var wrap = el('div', 'lks-pet-skin-list')
      skins.forEach(function (skin) {
        var b = el('button', 'lks-pet-skin', skin.name)
        b.type = 'button'
        if (skin.id === currentId) b.classList.add('on')
        b.addEventListener('click', function () {
          if (skin.id === currentId) return
          if (!applySkin(skin)) {
            tip.textContent = '看板娘还没加载好，过一会儿再换试试。'
            return
          }
          tip.textContent = ''
          currentId = skin.id
          var on = wrap.querySelector('.on')
          if (on) on.classList.remove('on')
          b.classList.add('on')
        })
        wrap.appendChild(b)
      })
      skinsBox.appendChild(wrap)
    })
  }

  /* ==================================================================== *
   * 启动
   * ==================================================================== */
  /** 按钮位置跟着看板娘走。看板娘容器是异步建出来的，所以多查几次 */
  function syncPetSide () {
    if (!root) return
    root.classList.toggle('lks-pet-on-left', !!document.querySelector('.live2d-widget-container'))
  }

  function boot () {
    // 手机上 _config.yml 里 mobile.show 是 false，看板娘本身不渲染；
    // 但按钮还是要给（CSS 里换成左下角一个悬浮按钮）
    buildUI()
    syncPetSide()
    setTimeout(syncPetSide, 400)
    setTimeout(syncPetSide, 1500)
    setTimeout(syncPetSide, 3500)
    reconcileSkin()
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()

  // 主题的 pjax 只换 #page 里的内容，看板娘和这个面板都在外面，不用重建；
  // 但保险起见还是把按钮位置跟一下
  document.addEventListener('pjax:complete', function () {
    if (!root) return
    syncPetSide()
  })

  window.lksPet = {
    applySkin: applySkin,
    skins: loadSkins,
    saved: savedSkin,
    open: function () { setOpen(true) },
    close: function () { setOpen(false) },
    send: send,
    clear: clearChat,
    history: function () { return history }
  }
})()
