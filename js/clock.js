/*!
 * 侧边栏电子钟 —— 本地定制版
 *
 * 为什么自己写：
 *   插件自带的 clock.min.js 把 IP 定位接口硬编码成了 api.nsmao.net，
 *   该域名已注销（DNS 都解析不到），于是永远走 fallback —— 无论访客在哪，
 *   天气都固定显示 clock_rectangle（长沙芙蓉区）。
 *
 * 定位顺序：
 *   1. 配置 electric_clock.default_rectangle: true  → 直接用 clock_rectangle
 *   2. 高德 IP 定位（国内访客最准，用 gaud_map_key，接口允许跨域）
 *   3. ipapi.co（国外访客兜底）
 *   4. 兜底 clock_rectangle
 *
 * 依赖的全局变量由 hexo-butterfly-clock-anzhiyu 的注入脚本提供：
 *   qweather_key / qweather_api_host / clock_rectangle /
 *   gaud_map_key / clock_default_rectangle_enable
 */
(function () {
  'use strict'

  var DEFAULT_CITY = '长沙市'
  var WEEK = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

  var cfg = {
    qweatherKey: typeof qweather_key !== 'undefined' ? qweather_key : '',
    qweatherHost: typeof qweather_api_host !== 'undefined' ? qweather_api_host : 'devapi.qweather.com',
    rectangle: typeof clock_rectangle !== 'undefined' ? clock_rectangle : '112.982279,28.19409',
    amapKey: typeof gaud_map_key !== 'undefined' ? gaud_map_key : '',
    fixed: typeof clock_default_rectangle_enable !== 'undefined' && clock_default_rectangle_enable === 'true'
  }

  function getJSON(url, timeout) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error('timeout')) }, timeout || 6000)
      fetch(url)
        .then(function (res) { return res.json() })
        .then(function (data) { clearTimeout(timer); resolve(data) })
        .catch(function (err) { clearTimeout(timer); reject(err) })
    })
  }

  // 高德返回的 rectangle 是「城市范围」：lng1,lat1;lng2,lat2 → 取中心点
  function centerOfRectangle(rect) {
    if (typeof rect !== 'string' || rect.indexOf(';') < 0) return null
    var parts = rect.split(';')
    var p1 = parts[0].split(',')
    var p2 = parts[1].split(',')
    var lng1 = parseFloat(p1[0]), lat1 = parseFloat(p1[1])
    var lng2 = parseFloat(p2[0]), lat2 = parseFloat(p2[1])
    if ([lng1, lat1, lng2, lat2].some(function (n) { return isNaN(n) })) return null
    return { lng: ((lng1 + lng2) / 2).toFixed(6), lat: ((lat1 + lat2) / 2).toFixed(6) }
  }

  // 高德有时把 city 返回成空数组
  function pickName(v, fallback) {
    if (typeof v === 'string' && v) return v
    if (Array.isArray(v) && typeof v[0] === 'string' && v[0]) return v[0]
    return fallback
  }

  function fromAmap() {
    if (!cfg.amapKey) return Promise.reject(new Error('no amap key'))
    return getJSON('https://restapi.amap.com/v3/ip?key=' + encodeURIComponent(cfg.amapKey))
      .then(function (data) {
        if (data && data.status === '1') {
          var center = centerOfRectangle(data.rectangle)
          var city = pickName(data.city, '') || pickName(data.province, '')
          if (center && city) return { lng: center.lng, lat: center.lat, city: city }
        }
        throw new Error('amap: ' + JSON.stringify(data))
      })
  }

  function fromIpapiCo() {
    return getJSON('https://ipapi.co/json/').then(function (data) {
      if (data && data.latitude && data.longitude) {
        return { lng: String(data.longitude), lat: String(data.latitude), city: data.city || DEFAULT_CITY }
      }
      throw new Error('ipapi.co: no location')
    })
  }

  function fallbackLocation() {
    var parts = cfg.rectangle.split(',')
    return Promise.resolve({ lng: parts[0], lat: parts[1], city: DEFAULT_CITY })
  }

  function resolveLocation() {
    if (cfg.fixed) return fallbackLocation()
    return fromAmap()
      .catch(function (e) { console.warn('[clock] 高德 IP 定位失败，改用 ipapi.co：', e.message); return fromIpapiCo() })
      .catch(function (e) { console.warn('[clock] ipapi.co 也失败，使用默认坐标：', e.message); return fallbackLocation() })
  }

  function fetchWeather(loc) {
    var url = 'https://' + cfg.qweatherHost + '/v7/weather/now?location=' +
      loc.lng + ',' + loc.lat + '&key=' + encodeURIComponent(cfg.qweatherKey)
    return getJSON(url).then(function (data) {
      if (!data || data.code !== '200') throw new Error('qweather: ' + JSON.stringify(data))
      return { data: data, city: loc.city }
    })
  }

  function zeroPadding(num, digit) {
    var zero = ''
    for (var i = 0; i < digit; i++) zero += '0'
    return (zero + num).slice(-digit)
  }

  // 天气图标配色（照搬插件原逻辑）
  function iconColor(icon) {
    switch (icon) {
      case '100': return '#fdcc45'
      case '101': return '#fe6976'
      case '102': case '103': return '#fe7f5b'
      case '104': case '150': case '151': case '152': case '153': case '154':
      case '800': case '801': case '802': case '803': case '804': case '805':
      case '806': case '807': return '#2152d1'
      case '300': case '301': case '305': case '306': case '307': case '308':
      case '309': case '310': case '311': case '312': case '313': case '314':
      case '315': case '316': case '317': case '318': case '350': case '351':
      case '399': return '#49b1f5'
      case '302': case '303': case '304': return '#fdcc46'
      case '400': case '401': case '402': case '403': case '404': case '405':
      case '406': case '407': case '408': case '409': case '410': case '456':
      case '457': case '499': return '#a3c2dc'
      case '500': case '501': case '502': case '503': case '504': case '507':
      case '508': case '509': case '510': case '511': case '512': case '513':
      case '514': case '515': return '#97acba'
      case '900': case '999': return 'red'
      case '901': return '#179fff'
      default: return '#000'
    }
  }

  function render(info, city) {
    var box = document.getElementById('hexo_electric_clock')
    if (!box) return

    var color = iconColor(info.now.icon)
    var loading = document.getElementById('card-clock-loading')
    if (loading) loading.innerHTML = ''

    box.innerHTML =
      '<div class="clock-row">' +
        '<span id="card-clock-clockdate" class="card-clock-clockdate"></span>' +
        '<span class="card-clock-weather"><i class="qi-' + info.now.icon + '-fill" style="color:' + color + '"></i> ' +
          info.now.text + '<span>' + info.now.temp + '</span> ℃</span>' +
        '<span class="card-clock-humidity">💧 ' + info.now.humidity + '%</span>' +
      '</div>' +
      '<div class="clock-row">' +
        '<span id="card-clock-time" class="card-clock-time"></span>' +
      '</div>' +
      '<div class="clock-row">' +
        '<span class="card-clock-windDir"> <i class="qi-gale"></i> ' + info.now.windDir + '</span>' +
        '<span class="card-clock-location">' + city + '</span>' +
        '<span id="card-clock-dackorlight" class="card-clock-dackorlight"></span>' +
      '</div>'

    function updateTime() {
      var cd = new Date()
      var time = zeroPadding(cd.getHours(), 2) + ':' + zeroPadding(cd.getMinutes(), 2) + ':' + zeroPadding(cd.getSeconds(), 2)
      var date = zeroPadding(cd.getFullYear(), 4) + '-' + zeroPadding(cd.getMonth() + 1, 2) + '-' +
        zeroPadding(cd.getDate(), 2) + ' ' + WEEK[cd.getDay()]
      var hour = cd.getHours()
      var ampm = hour > 12 ? ' P M' : ' A M'

      var t = document.getElementById('card-clock-time')
      var d = document.getElementById('card-clock-clockdate')
      var a = document.getElementById('card-clock-dackorlight')
      if (t) t.innerHTML = time
      if (d) d.innerHTML = date
      if (a) a.innerHTML = ampm
    }

    setInterval(updateTime, 1000)
    updateTime()
  }

  function init() {
    if (!cfg.qweatherKey) {
      console.error('[clock] 缺少 qweather_key，跳过')
      return
    }
    resolveLocation()
      .then(fetchWeather)
      .then(function (r) { render(r.data, r.city) })
      .catch(function (err) { console.error('[clock] 天气数据获取失败：', err) })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
