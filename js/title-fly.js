/*!
 * 标签页标题彩蛋 —— 切走 / 切回来时换标题
 *
 * 行为：
 *   1. 标签页失去焦点（切走、最小化、切到别的 App）→ 标题变成随机一句「挽留」文案 + 颜文字
 *   2. 只要还不在前台，每 4 秒随机换一句（不会连续重复同一句）
 *   3. 切回前台 → 显示随机一句「欢迎回来」文案，约 3 秒后恢复原来的标题
 *   4. 兼容 pjax：站内跳转后自动记住新页面的标题作为「原标题」
 *
 * 注入方式：_config.butterfly.yml → inject.bottom
 */
(function () {
  'use strict'

  // 切走时随机显示 / 轮播
  var AWAY = [
    '这就要走了吗 (｡•́︿•̀｡)',
    '别走嘛，再摸会儿鱼～ (๑•́ ₃ •̀๑)',
    '走啦？记得回来哦 (｡･ω･｡)ﾉ♡',
    '鱼还没摸够呢 (๑´ㅂ`๑)',
    '偷偷溜走被我发现了 (｀・ω・´)',
    '小窝会一直等你回来的 (｡•́‿•̀｡)',
    '再待一会儿嘛 (つ﹏⊂)',
    '走神啦？我先自己玩会儿 (๑¯ω¯๑)',
    '别走开太久，鱼会凉的 (｡•̀ᴗ-)✧',
    '喂喂，页面还开着呢 (・∀・)',
    '摸鱼小窝：已进入待机模式 ᕕ( ᐛ )ᕗ',
    '这里有个小窝在等你 (๑˃̵ᴗ˂̵)و'
  ]

  // 切回来时显示（3 秒后恢复原标题）
  var BACK = [
    '你终于回来了 (ﾉ´ヮ`)ﾉ*: ･ﾟ',
    '欢迎回来～ (๑˃̵ᴗ˂̵)و',
    '想你了呢 (๑•́ ₃ •̀๑)',
    '回来啦，继续摸鱼吧 (๑´ㅂ`๑)',
    '就知道你会回来的 (｡•̀ᴗ-)✧',
    '欢迎回家 (｡･ω･｡)ﾉ♡',
    '等你好久了 (๑•̀ㅂ•́)و✧',
    '回来得正好，茶刚泡好 (｡•́‿•̀｡)'
  ]

  var ROTATE_MS = 4000   // 离开时轮播间隔
  var RESTORE_MS = 3000  // 回来后多久恢复原标题

  var originalTitle = document.title
  var rotateTimer = null
  var restoreTimer = null
  var lastAwayIndex = -1

  // 随机取一句，尽量不和上一句重复
  function pickRandom(list, lastIndex) {
    if (list.length <= 1) return { text: list[0], index: 0 }
    var index
    do {
      index = Math.floor(Math.random() * list.length)
    } while (index === lastIndex)
    return { text: list[index], index: index }
  }

  function clearTimers() {
    if (rotateTimer !== null) { clearInterval(rotateTimer); rotateTimer = null }
    if (restoreTimer !== null) { clearTimeout(restoreTimer); restoreTimer = null }
  }

  function showAway() {
    clearTimers()
    var picked = pickRandom(AWAY, lastAwayIndex)
    lastAwayIndex = picked.index
    document.title = picked.text
    // 一直没回来就继续换
    rotateTimer = setInterval(function () {
      var next = pickRandom(AWAY, lastAwayIndex)
      lastAwayIndex = next.index
      document.title = next.text
    }, ROTATE_MS)
  }

  function showBack() {
    clearTimers()
    document.title = pickRandom(BACK, -1).text
    restoreTimer = setTimeout(function () {
      document.title = originalTitle
      restoreTimer = null
    }, RESTORE_MS)
  }

  function handleVisibility() {
    if (document.hidden) showAway()
    else showBack()
  }

  document.addEventListener('visibilitychange', handleVisibility)

  // pjax 站内跳转后，记住新页面的标题
  document.addEventListener('pjax:complete', function () {
    // pjax 完成时标题刚被替换成新页面的，等一拍再取
    setTimeout(function () {
      if (!document.hidden) originalTitle = document.title
    }, 0)
  })

  // 如果页面在后台被打开（少数情况），直接进入离开状态
  if (document.hidden) showAway()
})()
