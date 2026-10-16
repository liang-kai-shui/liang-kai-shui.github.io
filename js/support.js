(function () {
  if (window.lksSupport) return
  var trigger
  function close() { var d = document.getElementById('lks-support-dialog'); if (d) d.close(); if (trigger && trigger.isConnected) trigger.focus() }
  window.lksSupport = { close: close }
  document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-support-open]')
    if (!button) return
    trigger = button
    var dialog = document.getElementById('lks-support-dialog')
    if (!dialog) {
      dialog = document.createElement('dialog')
      dialog.id = 'lks-support-dialog'
      dialog.setAttribute('aria-labelledby', 'lks-support-title')
      dialog.innerHTML = '<button class="lks-support-close" type="button" aria-label="关闭赞助">×</button><div class="lks-support-symbol" aria-hidden="true">♡</div><p class="lks-support-eyebrow">THANK YOU FOR READING</p><h2 id="lks-support-title">请小窝喝杯茶</h2><p class="lks-support-caption">如果这里的文字帮到了你，可以留下一点支持。<br>每一次阅读和留言，也同样珍贵。</p><a class="lks-support-qr" target="_blank" rel="noopener noreferrer"><img width="220" height="220" alt="微信或支付宝收款二维码"></a><p class="lks-support-payment">微信 / 支付宝 · 扫码支持</p><p class="lks-support-note">自愿赞助，量力而行。谢谢你的心意。</p>'
      ;(document.getElementById('site-runtime') || document.body).appendChild(dialog)
      dialog.querySelector('button').addEventListener('click', close)
      dialog.addEventListener('click', function(e) { if (e.target === dialog) { var r=dialog.getBoundingClientRect(); if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom) close() } })
    }
    var image = button.getAttribute('data-support-image')
    if (!image || !/^https?:\/\//.test(new URL(image, location.origin).href)) return
    dialog.querySelector('img').src = image
    dialog.querySelector('a').href = image
    dialog.showModal()
  })
  document.addEventListener('pjax:send', close)
})()
