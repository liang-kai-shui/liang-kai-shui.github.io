/*!
 * 看板娘增强：换皮肤 + 聊天
 *
 * 一、换皮肤（这里的写法是被引擎逼出来的，别看晕）
 *
 *   先说结论：**换装靠"存下选择 + 重载页面"，不是就地换模型。**
 *
 *   本来以为就地换很简单：引擎的 theRealInit 每次都先
 *   `document.getElementById(config.name.div)` 把旧容器删掉再建新的
 *   （见 L2Dwidget.0.min.js 里的 createElement），所以再调一次
 *   `L2Dwidget.init({ model: { jsonPath: 新路径 } })` 应该就换好了。
 *   实测**不行**：引擎的 configApplyer 是这么合并配置的 ——
 *
 *     configApplyer(新配置) → merge(内部配置, 新配置, 默认值)
 *     merge 里：目标已有值时，只有"两边都是对象"才会递归往下合，
 *               否则**直接忽略新值**（字符串属于这一类）
 *
 *   于是第二次 init 时 `config.model.jsonPath` 已经是个字符串了，新路径被丢掉，
 *   theRealInit 只会拿老路径重建一次容器 —— 白折腾。
 *   （所以我一开始测出来"点了换装、localStorage 变了、模型没变"。）
 *
 *   那怎么让"选中皮肤"生效？答案是**在插件第一次 init 之前把配置改掉**：
 *   第一次 init 时内部配置还是空的，这时候传进去的值会被原样接收。
 *   插件的 L2Dwidget.init({...}) 是页面里的一段内联脚本，而主题的 inject.bottom
 *   正好画在它前面，所以这段代码能抢先用 defineProperty 拦住 window.L2Dwidget 的赋值，
 *   把 init 包一层：读 localStorage 里存的 {id, url}，改掉 cfg.model.jsonPath 再放行。
 *   好处是访客进站**只下载选中的那套模型**，不会先白下一套默认的（500KB～2.6MB）。
 *
 *   为什么 localStorage 里要连 URL 一起存：拦 init 的那一刻是同步的，
 *   等不了 /live2d/skins.json 那个异步请求回来，所以地址必须能同步取到。
 *   代价是模型文件改名后可能失效 —— 所以页面加载完会再拉一次清单核对，
 *   发现 id 没了就清掉选择并重载（自愈），地址变了就顺手更新存的那份。
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

  /** 换装 = 记住选择 + 重载页面（就地换模型做不到，原因见文件头注释） */
  function applySkin (skin) {
    if (!skin || !skin.url) return false
    write(SKIN_KEY, JSON.stringify({ id: skin.id, url: skin.url }))
    window.location.reload()
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
   *   · 存的皮肤已经不在清单里（模型被删/改名）→ 清掉选择并重载，免得看板娘永远出不来
   *   · 地址变了 → 更新存的那份，下次进站用新地址
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
        window.location.reload()
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
          b.textContent = '换装中…'
          applySkin(skin)
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
