/*!
 * 点击特效：蔚蓝档案风格的点击圆环 + 光标拖尾
 *
 * 用的是第三方库 ba-click-fx（MIT），原样存在 source/js/vendor/ 下，说明见那里的 README.txt。
 * 换掉的是主题自带的 click_heart（点一下冒个爱心），配置里已经关掉了。
 *
 * 三个决定，都是踩过坑之后选的：
 *
 * 1. **首次鼠标移动或触屏点击时加载**。这个库 621KB（gzip 还有 240KB），
 *    不参与首屏启动；加载期间的第一次点击会在准备好后补播。
 *
 * 2. **动态 import，静态文件不进 HTML**。这样页面里只会多一个 <script src="/js/click-fx.js">，
 *    库本身是运行时才去拉的（也顺带让还原度校验少一条归一化规则）。
 *
 * 3. **系统开了"减少动态效果"就整个不加载**，连这 621KB 都不下。
 *    跟底图那个视频是同一套判断，这类纯装饰的东西不该跟系统设置较劲。
 *
 * 另外：手机上不动 touchAction（默认 auto）。库里说想要手指拖动也有拖尾，得设 touchAction: 'none'，
 * 但那会改掉页面的滚动手势 —— 为了个特效把滚动搞坏不值当。点按的特效在手机上照常有。
 *
 * 由 _config.butterfly.yml → inject.bottom 引入。
 */
(function () {
  'use strict'

  var LIB = '/js/vendor/ba-click-fx.js'

  // 想关掉整个特效：把 _config.butterfly.yml 里这行 <script src="/js/click-fx.js"></script> 删掉
  // （同时记得把 compare-with-original.js 里对应那条归一化也删掉）

  // 桌面精细指针移动时显示拖尾；触屏保持原生滚动。true = 鼠标一动就有拖尾，
  // 觉得晃眼就改成 false，那样只有按住指针拖的时候才出拖尾。
  var pointer = window.matchMedia('(hover: hover) and (pointer: fine)')
  var TRAIL_ALWAYS = pointer.matches
  var starting = null
  var pendingTap = null
  var interacted = false

  // 特效的透明度，1 是库的默认值。觉得太抢眼可以降到 0.7 左右。
  var OPACITY = 0.9

  // 特效的主题色。**故意写死，不去读 CSS 变量**：
  // 主题的 --btn-bg 在浅色模式下是站上那个蓝 #49b1f5（正合适），但深色模式下是 #1f1f1f 的深灰，
  // 拿它当特效色的话圆环在深色底上基本看不见（实测被这个坑了一下）。
  // 这个蓝在两个模式下都成立，也跟按钮、链接的颜色一致。
  var THEME_COLOR = '#49b1f5'

  function reducedMotion () {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    } catch (e) {
      return false
    }
  }

  // The pinned library creates a viewport overlay under body. Astro replaces body
  // on navigation, so retain its mount parent inside the persistent runtime.
  function retain () {
    var fx = window.lksClickFx, runtime = document.getElementById('site-runtime')
    if (!fx || !runtime || !fx.overlayRoot) return
    fx.overlayMountParent = runtime
    fx.overlayRoot.id = 'lks-click-fx-overlay'
    if (fx.overlayRoot.parentNode !== runtime) runtime.appendChild(fx.overlayRoot)
  }

  function start () {
    if (reducedMotion()) return
    if (window.lksClickFx) { retain(); window.lksClickFx.setPaused(false); return }
    if (starting) return starting

    starting = import(LIB).then(function (mod) {
      var BAClickFX = mod && mod.BAClickFX
      if (typeof BAClickFX !== 'function') {
        console.warn('[click-fx] 库里没导出 BAClickFX，跳过')
        return
      }

      // 这三项是库文档里给"背景未知的普通网页"的推荐配置
      var fx = new BAClickFX({
        outputCompositing: 'browser-overlay',
        hostCompositing: 'screen',
        hostCompositingSurface: 'dom-backdrop'
      })

      fx.updateConfig({ trailAlways: TRAIL_ALWAYS, opacity: OPACITY })
      fx.setThemeColor(THEME_COLOR)

      window.lksClickFx = fx
      retain()
      fx.setPaused(reducedMotion(), { clear: true })
      if (pendingTap && !reducedMotion()) { fx.boom(pendingTap.x, pendingTap.y); pendingTap = null }
    }).catch(function (err) {
      starting = null
      console.warn('[click-fx] 没加载起来：', err && err.message)
    })
  }

  document.addEventListener('astro:before-swap', retain)
  document.addEventListener('astro:after-swap', retain)
  document.addEventListener('pjax:complete', retain)
  pointer.addEventListener('change', function () {
    TRAIL_ALWAYS = pointer.matches
    if (window.lksClickFx) window.lksClickFx.updateConfig({ trailAlways: TRAIL_ALWAYS })
  })
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', function () {
    if (window.lksClickFx) window.lksClickFx.setPaused(reducedMotion(), { clear: true })
    else if (!reducedMotion() && interacted) start()
  })

  // No heavy decorative library during an untouched first paint. On desktop,
  // mouse movement starts the native trail; a first tap is replayed once ready.
  function activate (event) {
    interacted = true
    if (reducedMotion()) return
    if (event.type === 'pointerdown' && !window.lksClickFx) pendingTap = { x: event.clientX, y: event.clientY }
    start()
  }
  window.addEventListener('pointermove', activate, { once: true, passive: true })
  window.addEventListener('pointerdown', activate, { passive: true })
})()
