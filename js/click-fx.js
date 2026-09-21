/*!
 * 点击特效：蔚蓝档案风格的点击圆环 + 光标拖尾
 *
 * 用的是第三方库 ba-click-fx（MIT），原样存在 source/js/vendor/ 下，说明见那里的 README.txt。
 * 换掉的是主题自带的 click_heart（点一下冒个爱心），配置里已经关掉了。
 *
 * 三个决定，都是踩过坑之后选的：
 *
 * 1. **加载时机放在页面 load 之后、浏览器空闲时**。这个库 621KB（gzip 还有 240KB），
 *    塞进主流程会让首屏明显变慢。推迟加载的代价是"进站第一秒内点击看不到特效"，
 *    我认为比拖慢首屏划算。用 requestIdleCallback，不支持就退回 setTimeout。
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

  // 拖尾常显还是按住才显示。true = 鼠标一动就有拖尾（库的招牌效果），
  // 觉得晃眼就改成 false，那样只有按住指针拖的时候才出拖尾。
  var TRAIL_ALWAYS = true

  // 特效的透明度，1 是库的默认值。觉得太抢眼可以降到 0.7 左右。
  var OPACITY = 0.9

  function reducedMotion () {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    } catch (e) {
      return false
    }
  }

  /** 主题色能读出来就用主题色（和按钮、链接一致），读不到就用库默认的游戏蓝 */
  function themeColor () {
    try {
      var c = getComputedStyle(document.documentElement).getPropertyValue('--btn-bg').trim()
      return /^#[0-9a-fA-F]{6}$/.test(c) ? c : ''
    } catch (e) {
      return ''
    }
  }

  function start () {
    if (reducedMotion()) return

    import(LIB).then(function (mod) {
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

      var color = themeColor()
      if (color) fx.setThemeColor(color)

      // pjax 站内跳转不重建实例：#page 之外的东西不会被换掉，画布留着就行。
      // 万一哪天主题换成整页替换，这里重新初始化一次即可。
      window.lksClickFx = fx
    }).catch(function (err) {
      console.warn('[click-fx] 没加载起来：', err && err.message)
    })
  }

  function whenIdle (fn) {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(fn, { timeout: 3000 })
    } else {
      setTimeout(fn, 1200)
    }
  }

  // 等 load（图片什么的都别抢），再等浏览器空闲
  if (document.readyState === 'complete') whenIdle(start)
  else window.addEventListener('load', function () { whenIdle(start) })
})()
