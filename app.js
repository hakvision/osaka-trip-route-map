let map;
let data;
let activeDayNo = 1;
let markers = [];
let routeLine = null;
let infoWindow = null;

const GOOGLE_KEY_STORAGE = 'osakaTripGoogleMapsApiKey';
const typeLabel = {
  meal: '식사', snack: '간식', shopping: '쇼핑', drugstore: '드럭스토어',
  convenience: '편의점', transfer: '이동', station: '역', arrival: '도착',
  hotel: '호텔', rest: '휴식'
};
const typeColor = {
  meal: '#ef4444', snack: '#f97316', shopping: '#8b5cf6', drugstore: '#22c55e',
  convenience: '#06b6d4', transfer: '#64748b', station: '#0ea5e9', arrival: '#2563eb',
  hotel: '#14b8a6', rest: '#84cc16'
};

function getApiKey() {
  const params = new URLSearchParams(location.search);
  const fromUrl = params.get('key') || params.get('gmaps_key') || params.get('google_maps_key');
  if (fromUrl) {
    localStorage.setItem(GOOGLE_KEY_STORAGE, fromUrl.trim());
    params.delete('key'); params.delete('gmaps_key'); params.delete('google_maps_key');
    const clean = `${location.pathname}${params.toString() ? '?' + params.toString() : ''}${location.hash}`;
    history.replaceState({}, '', clean);
    return fromUrl.trim();
  }
  return localStorage.getItem(GOOGLE_KEY_STORAGE) || '';
}

function showKeyPanel(message) {
  const panel = document.getElementById('key-panel');
  panel.classList.remove('hidden');
  if (message) panel.querySelector('p').textContent = message;
  document.getElementById('save-key').onclick = () => {
    const key = document.getElementById('api-key-input').value.trim();
    if (!key) return;
    localStorage.setItem(GOOGLE_KEY_STORAGE, key);
    location.reload();
  };
  document.getElementById('clear-key').onclick = (e) => {
    e.preventDefault();
    localStorage.removeItem(GOOGLE_KEY_STORAGE);
    document.getElementById('api-key-input').value = '';
  };
}

function loadGoogleMaps(key) {
  return new Promise((resolve, reject) => {
    window.__initOsakaGoogleMap = () => resolve();
    window.gm_authFailure = () => reject(new Error('Google Maps API 키 인증 실패'));
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=__initOsakaGoogleMap&language=ko&region=JP&v=weekly`;
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error('Google Maps 스크립트 로드 실패'));
    document.head.appendChild(script);
  });
}

function markerSvg(order, type) {
  const color = typeColor[type] || '#2563eb';
  const text = String(order);
  const fs = text.length > 1 ? 24 : 28;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="54" viewBox="0 0 44 54">
    <path d="M22 52s18-19.6 18-32A18 18 0 1 0 4 20c0 12.4 18 32 18 32z" fill="${color}" stroke="white" stroke-width="3"/>
    <circle cx="22" cy="20" r="13" fill="rgba(0,0,0,.18)"/>
    <text x="22" y="29" text-anchor="middle" font-family="Arial, sans-serif" font-size="${fs}" font-weight="900" fill="white">${text}</text>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function clearMap() {
  markers.forEach(m => m.setMap(null));
  markers = [];
  if (routeLine) { routeLine.setMap(null); routeLine = null; }
  document.getElementById('detail').classList.add('hidden');
}

function routeUrl(day) {
  if (!day.places.length) return '#';
  const origin = `${day.places[0].lat},${day.places[0].lng}`;
  const destination = `${day.places[day.places.length - 1].lat},${day.places[day.places.length - 1].lng}`;
  const middle = day.places.slice(1, -1).map(p => `${p.lat},${p.lng}`).join('|');
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}${middle ? '&waypoints=' + encodeURIComponent(middle) : ''}&travelmode=walking`;
}

function showDetail(p) {
  const el = document.getElementById('detail');
  el.classList.remove('hidden');
  el.innerHTML = `<button class="close" aria-label="닫기">×</button>
    <div class="detail-kicker">${p.time} · ${typeLabel[p.type] || p.type} · ${p.status}</div>
    <h2>${p.order}. ${p.title}</h2>
    <p class="name">${p.name}</p>
    <p>${p.note}</p>
    <p class="meta">근거: ${p.evidence}<br>좌표: ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)} · ${p.geocode_source}</p>
    <div class="actions">
      <a href="${p.google_maps_url}" target="_blank" rel="noopener">Google Maps에서 열기</a>
      <a href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=walking" target="_blank" rel="noopener">길찾기</a>
    </div>`;
  el.querySelector('.close').onclick = () => el.classList.add('hidden');
  if (infoWindow && map) {
    infoWindow.setContent(`<strong>${p.order}. ${p.title}</strong><br>${p.time} · ${p.name}`);
    infoWindow.setPosition({ lat: p.lat, lng: p.lng });
    infoWindow.open({ map });
  }
}

function renderDay(dayNo) {
  activeDayNo = dayNo;
  const day = data.days.find(d => d.day === dayNo);
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', Number(b.dataset.day) === dayNo));
  document.getElementById('day-summary').textContent = day.summary || '자료 추가 예정';
  clearMap();
  const timeline = document.getElementById('timeline');
  timeline.innerHTML = '';
  if (!day.places.length) {
    timeline.innerHTML = '<div class="empty"><b>자료 추가 예정</b><br>2~4일차 영수증/메모를 보내면 같은 방식으로 추가할게.</div>';
    return;
  }

  const bounds = new google.maps.LatLngBounds();
  const path = [];
  day.places.forEach(p => {
    const pos = { lat: Number(p.lat), lng: Number(p.lng) };
    path.push(pos);
    bounds.extend(pos);
    const marker = new google.maps.Marker({
      position: pos,
      map,
      title: `${p.order}. ${p.title}`,
      icon: { url: markerSvg(p.order, p.type), scaledSize: new google.maps.Size(44, 54), anchor: new google.maps.Point(22, 52) },
      zIndex: 1000 + p.order
    });
    marker.addListener('click', () => { map.panTo(pos); map.setZoom(Math.max(map.getZoom() || 14, 15)); showDetail(p); });
    markers.push(marker);

    const step = document.createElement('button');
    step.className = 'step';
    step.innerHTML = `<span class="time">${p.time}</span><span class="num">${p.order}</span><span class="step-body"><b>${p.title}</b><small>${p.name} · ${typeLabel[p.type] || p.type}<br>${p.note}</small></span>`;
    step.onclick = () => { map.panTo(pos); map.setZoom(16); showDetail(p); closeDrawerOnMobile(); };
    timeline.appendChild(step);
  });
  routeLine = new google.maps.Polyline({ path, geodesic: true, strokeColor: '#0ea5e9', strokeOpacity: 0.88, strokeWeight: 5, map });
  map.fitBounds(bounds, { top: 170, right: 40, bottom: 280, left: 40 });

  const route = document.createElement('a');
  route.className = 'route-link';
  route.href = routeUrl(day);
  route.target = '_blank';
  route.rel = 'noopener';
  route.textContent = '이 날짜 전체 Google Maps 길찾기';
  timeline.prepend(route);
}

function setupTabs() {
  const tabs = document.getElementById('day-tabs');
  tabs.innerHTML = '';
  data.days.forEach(d => {
    const b = document.createElement('button');
    b.className = 'tab';
    b.dataset.day = d.day;
    b.textContent = d.label;
    b.onclick = () => renderDay(d.day);
    tabs.appendChild(b);
  });
}

function setupFloatingControls() {
  const body = document.body;
  document.getElementById('menu-toggle').onclick = () => body.classList.toggle('drawer-open');
  document.getElementById('locate').onclick = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(pos => map.setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude }));
  };
}
function closeDrawerOnMobile() { if (innerWidth < 760) document.body.classList.remove('drawer-open'); }

async function init() {
  data = await fetch('./data/itinerary.json?v=20260906-google-1').then(r => r.json());
  setupFloatingControls();
  setupTabs();
  const key = getApiKey();
  if (!key) { showKeyPanel(); return; }
  try {
    await loadGoogleMaps(key);
  } catch (err) {
    showKeyPanel(String(err.message || err));
    return;
  }
  map = new google.maps.Map(document.getElementById('map'), {
    center: { lat: 34.682, lng: 135.502 },
    zoom: 12,
    mapTypeControl: false,
    fullscreenControl: false,
    streetViewControl: false,
    clickableIcons: true,
    gestureHandling: 'greedy',
    styles: [
      { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'on' }] },
      { featureType: 'transit', elementType: 'labels', stylers: [{ visibility: 'on' }] }
    ]
  });
  infoWindow = new google.maps.InfoWindow();
  renderDay(1);
}

init().catch(err => {
  const e = document.getElementById('map-error');
  e.classList.remove('hidden');
  e.textContent = `지도 초기화 실패: ${err.message || err}`;
});
