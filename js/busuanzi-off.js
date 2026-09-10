/*!
 * busuanzi 的空壳替代品。
 *
 * 主题里 busuanzi 的数字显示位置（总访问量 / 访客数 / 本文阅读量）用的是固定 id：
 *   #busuanzi_value_site_pv / #busuanzi_value_site_uv / #busuanzi_value_page_pv
 * 直接关掉 busuanzi 会让这些元素消失，页面结构就跟原站不一样了。
 *
 * 所以这里保留它的 <script> 标签、只把 src 换成本文件（见 _config.butterfly.yml →
 * CDN.option.busuanzi），真正往那些元素里填数字的是 source/js/stats.js —— 数据来自
 * 自己的 Cloudflare Worker + D1，不再依赖国内经常连不上的 busuanzi.ibruce.info。
 */
