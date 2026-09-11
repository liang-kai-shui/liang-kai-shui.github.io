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
  var CONFIG = window.LKS_CHAT || {}
  var API = (CONFIG.api || '').replace(/\/+$/, '')
  var MAX_HISTORY = Number(CONFIG.maxHistory) > 0 ? Number(CONFIG.maxHistory) : 12

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

  function readSession (key) {
    try { return window.sessionStorage.getItem(key) } catch (e) { return null }
  }
  function writeSession (key, val) {
    try { window.sessionStorage.setItem(key, val) } catch (e) { /* 隐私模式 */ }
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

  function loadHistory () {
    var raw = readSession(HISTORY_KEY)
    if (!raw) return []
    try {
      var arr = JSON.parse(raw)
      return Array.isArray(arr) ? arr.slice(-MAX_HISTORY) : []
    } catch (e) { return [] }
  }

  function saveHistory () {
    writeSession(HISTORY_KEY, JSON.stringify(history.slice(-MAX_HISTORY)))
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
      body: JSON.stringify({ messages: msgs.slice(-MAX_HISTORY) })
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

  var root, launcher, panel, msgsBox, form, input, typing, tip, skinsBox, tabChat, tabSkin

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
    var close = el('button', 'lks-pet-close', '✕')
    close.type = 'button'
    close.title = '收起'
    head.appendChild(tabs)
    head.appendChild(close)

    var body = el('div', 'lks-pet-body')

    // —— 聊天 ——
    var chatPane = el('div', 'lks-pet-pane lks-pet-chat')
    msgsBox = el('div', 'lks-pet-msgs')
    typing = el('div', 'lks-pet-typing', '正在想…')
    typing.hidden = true
    form = el('form', 'lks-pet-form')
    input = el('textarea', 'lks-pet-input')
    input.rows = 1
    input.placeholder = '说点什么…'
    input.maxLength = 1000
    var submit = el('button', 'lks-pet-send', '发送')
    submit.type = 'submit'
    form.appendChild(input)
    form.appendChild(submit)
    tip = el('p', 'lks-pet-tip')
    chatPane.appendChild(msgsBox)
    chatPane.appendChild(typing)
    chatPane.appendChild(form)
    chatPane.appendChild(tip)

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
  function addMsg (role, text) {
    var row = el('div', 'lks-pet-msg lks-pet-msg-' + role)
    var bubble = el('div', 'lks-pet-bubble')
    bubble.textContent = text
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

    send(text).then(function (reply) {
      typing.hidden = true
      form.classList.remove('lks-pet-busy')
      sending = false
      addMsg('assistant', reply)
      history.push({ role: 'assistant', content: reply })
      saveHistory()
    }).catch(function (err) {
      typing.hidden = true
      form.classList.remove('lks-pet-busy')
      sending = false
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
    history: function () { return history }
  }
})()
