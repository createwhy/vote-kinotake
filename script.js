'use strict';

/* =============================================================
   SUPABASE セットアップ（使用する場合のみ設定）
   ---------------------------------------------------------------
   Supabase Dashboard → SQL Editor で以下を実行：

   CREATE TABLE public.votes (
     id       TEXT PRIMARY KEY,
     kinoko   BIGINT NOT NULL DEFAULT 0,
     takenoko BIGINT NOT NULL DEFAULT 0,
     updated_at TIMESTAMPTZ DEFAULT now()
   );
   INSERT INTO public.votes (id, kinoko, takenoko)
   VALUES ('main', 0, 0) ON CONFLICT DO NOTHING;
   ALTER TABLE public.votes ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "read_all"   ON public.votes FOR SELECT USING (true);
   CREATE POLICY "update_all" ON public.votes FOR UPDATE USING (true);

   CREATE OR REPLACE FUNCTION public.increment_vote(p_side TEXT)
   RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
   BEGIN
     IF p_side = 'kinoko' THEN
       UPDATE public.votes SET kinoko   = kinoko   + 1, updated_at = now() WHERE id = 'main';
     ELSIF p_side = 'takenoko' THEN
       UPDATE public.votes SET takenoko = takenoko + 1, updated_at = now() WHERE id = 'main';
     END IF;
   END; $$;
   GRANT EXECUTE ON FUNCTION public.increment_vote TO anon;

   -- OGP画像ストレージ（Supabase Dashboard → Storage → New Bucket）
   -- バケット名: ogp  / Public bucket: ON
   =============================================================*/

const SUPABASE_URL      = 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
const USE_SUPABASE      = !SUPABASE_URL.startsWith('YOUR_');

/* =============================================================
   データ比較テーブル
   左：きのこの山 ／ 右：たけのこの里
============================================================= */
const COMPARE_DATA = [
  {
    label: '発売開始年',
    kDisplay: '1975年', tDisplay: '1979年',
    winner: 'kinoko',
    kNote: null, tNote: null,
  },
  {
    label: '内容量（標準箱）',
    kDisplay: '約74g', tDisplay: '約70g',
    winner: 'kinoko',
    kNote: '※一時66gへ', tNote: '※一時63gへ',
  },
  {
    label: 'カロリー / 箱',
    kDisplay: '417〜453kcal', tDisplay: '391〜426kcal',
    winner: null,
    kNote: null, tNote: null,
  },
  {
    label: '1箱の個数',
    kDisplay: '約30個', tDisplay: '約29個',
    winner: 'kinoko',
    kNote: null, tNote: null,
  },
  {
    label: '価格',
    kDisplay: '約200円前後', tDisplay: '約200円前後',
    winner: null,
    kNote: null, tNote: null,
  },
];

/* =============================================================
   STATE & STORAGE
============================================================= */
const STORAGE_KEY = 'ktv_votes_v3';

function loadState() {
  if (USE_SUPABASE) return { kinoko: 0, takenoko: 0 }; // DBから上書き
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (typeof s.kinoko === 'number' && typeof s.takenoko === 'number') return s;
    }
  } catch (_) {}
  return { kinoko: 0, takenoko: 0 };
}

const state = loadState();

function saveLocal() {
  if (!USE_SUPABASE) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/* =============================================================
   DOM REFS
============================================================= */
const $ = id => document.getElementById(id);

const elTotal       = $('total-count');
const elKinokoNum   = $('kinoko-num');
const elTakenokoNum = $('takenoko-num');
const elBtnK        = $('btn-kinoko');
const elBtnT        = $('btn-takenoko');
const elSideK       = $('side-kinoko');
const elSideT       = $('side-takenoko');
const elVsCircle    = $('vs-circle');
const elCloseBattle = $('close-battle');
const elDot         = $('realtime-dot');

const elDataOverlay  = $('data-overlay');
const elShareOverlay = $('share-overlay');
const elHowtoOverlay = $('howto-overlay');
const elDataList     = $('data-list');

/* =============================================================
   SUPABASE CLIENT
============================================================= */
let sbClient = null;

async function initSupabase() {
  if (!USE_SUPABASE) return;
  try {
    const { createClient } = window.supabase;
    sbClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // 初期データ取得
    const { data, error } = await sbClient
      .from('votes')
      .select('kinoko, takenoko')
      .eq('id', 'main')
      .single();

    if (error) throw error;
    applyDBData(data, true);

    // リアルタイム購読
    sbClient.channel('votes-rt')
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'votes', filter: 'id=eq.main' },
        ({ new: row }) => applyDBData(row, false))
      .subscribe(status => {
        elDot.className = 'realtime-dot ' +
          (status === 'SUBSCRIBED' ? 'connected' : 'error');
      });

  } catch (e) {
    console.warn('[Supabase] init failed, falling back to localStorage', e);
    elDot.className = 'realtime-dot error';
    // ローカル0スタート
    state.kinoko   = 0;
    state.takenoko = 0;
    renderAll(true);
  }
}

function applyDBData(row, animate) {
  const prevK = state.kinoko;
  const prevT = state.takenoko;
  state.kinoko   = row.kinoko;
  state.takenoko = row.takenoko;
  if (animate) {
    animateCount(elKinokoNum,   0,     state.kinoko,   750);
    animateCount(elTakenokoNum, 0,     state.takenoko, 750);
    animateCount(elTotal,       0,     state.kinoko + state.takenoko, 850);
  } else {
    animateCount(elKinokoNum,   prevK, state.kinoko,   380);
    animateCount(elTakenokoNum, prevT, state.takenoko, 380);
    animateCount(elTotal, prevK + prevT, state.kinoko + state.takenoko, 320);
  }
  updateCloseBattle();
}

async function dbVote(side) {
  if (!sbClient) return false;
  try {
    const { error } = await sbClient.rpc('increment_vote', { p_side: side });
    if (error) throw error;
    return true;
  } catch (e) {
    console.warn('[Supabase] vote failed', e);
    return false;
  }
}

/* =============================================================
   ANIMATION UTILS
============================================================= */
function animateCount(el, from, to, dur) {
  const start = performance.now();
  const tick = now => {
    const t = Math.min((now - start) / dur, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(from + (to - from) * eased).toLocaleString('ja-JP');
    if (t < 1) requestAnimationFrame(tick);
    else el.textContent = to.toLocaleString('ja-JP');
  };
  requestAnimationFrame(tick);
}

function popEl(el) {
  el.classList.remove('pop');
  void el.offsetWidth;
  el.classList.add('pop');
  el.addEventListener('animationend', () => el.classList.remove('pop'), { once: true });
}

function flashSide(sideEl) {
  sideEl.classList.remove('flash');
  void sideEl.offsetWidth;
  sideEl.classList.add('flash');
  sideEl.addEventListener('animationend', () => sideEl.classList.remove('flash'), { once: true });
}

function showToast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2400);
}

/* =============================================================
   接戦中バッジ
============================================================= */
const CLOSE_THRESHOLD = 100;

function updateCloseBattle() {
  const diff = Math.abs(state.kinoko - state.takenoko);
  const isClose = diff <= CLOSE_THRESHOLD;
  elVsCircle.classList.toggle('hidden', isClose);
  elCloseBattle.classList.toggle('visible', isClose);
}

/* =============================================================
   VOTE LOGIC
============================================================= */
let lastTap = 0;
const DEBOUNCE = 80;

async function vote(side) {
  const now = Date.now();
  if (now - lastTap < DEBOUNCE) return;
  lastTap = now;

  const prevK = state.kinoko;
  const prevT = state.takenoko;

  // 楽観的更新
  state[side] += 1;
  saveLocal();
  renderVote(side, prevK, prevT);

  // Supabase へ書き込み（失敗時はロールバック）
  if (USE_SUPABASE) {
    const ok = await dbVote(side);
    if (!ok) {
      state[side] -= 1;
      renderVote(side, state.kinoko, state.takenoko);
    }
  }

  // OGP画像を5秒後に更新（連打の最後だけ処理）
  scheduleOGPUpdate();
}

function renderVote(side, prevK, prevT) {
  const total = state.kinoko + state.takenoko;
  const prevTotal = prevK + prevT;

  if (side === 'kinoko') {
    animateCount(elKinokoNum, prevK, state.kinoko, 380);
    popEl(elKinokoNum);
    flashSide(elSideK);
  } else {
    animateCount(elTakenokoNum, prevT, state.takenoko, 380);
    popEl(elTakenokoNum);
    flashSide(elSideT);
  }
  animateCount(elTotal, prevTotal, total, 320);
  updateCloseBattle();
}

function renderAll(animate) {
  if (animate) {
    animateCount(elKinokoNum,   0, state.kinoko,   750);
    animateCount(elTakenokoNum, 0, state.takenoko, 750);
    animateCount(elTotal,       0, state.kinoko + state.takenoko, 850);
  } else {
    elKinokoNum.textContent   = state.kinoko.toLocaleString('ja-JP');
    elTakenokoNum.textContent = state.takenoko.toLocaleString('ja-JP');
    elTotal.textContent       = (state.kinoko + state.takenoko).toLocaleString('ja-JP');
  }
  updateCloseBattle();
}

/* =============================================================
   OGP 動的画像生成
============================================================= */
let ogpTimer = null;

function scheduleOGPUpdate() {
  clearTimeout(ogpTimer);
  ogpTimer = setTimeout(updateOGP, 5000);
}

async function generateOGPCanvas() {
  const canvas = $('ogp-canvas');
  const ctx = canvas.getContext('2d');
  const W = 1200, H = 630;

  // 背景グラデーション
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0,    '#2E7D32');
  grad.addColorStop(0.48, '#4CAF50');
  grad.addColorStop(0.52, '#FFA000');
  grad.addColorStop(1,    '#E65100');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // 半透明オーバーレイ
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(0, 0, W, H);

  const k = state.kinoko.toLocaleString('ja-JP');
  const t = state.takenoko.toLocaleString('ja-JP');

  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur  = 12;

  // タイトル
  ctx.fillStyle   = '#fff';
  ctx.font        = 'bold 46px sans-serif';
  ctx.textAlign   = 'center';
  ctx.fillText('きのこの山 vs たけのこの里', W / 2, 110);

  // VS
  ctx.font      = 'bold 72px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillText('VS', W / 2, 360);

  // 左：きのこ票数
  ctx.textAlign   = 'left';
  ctx.font        = 'bold 110px sans-serif';
  ctx.fillStyle   = '#fff';
  ctx.fillText(k, 60, 370);
  ctx.font        = 'bold 38px sans-serif';
  ctx.fillStyle   = 'rgba(255,255,255,0.8)';
  ctx.fillText('票', 60 + ctx.measureText(k).width + 6, 370);

  // 右：たけのこ票数
  ctx.textAlign   = 'right';
  ctx.font        = 'bold 110px sans-serif';
  ctx.fillStyle   = '#fff';
  ctx.fillText(t, W - 60, 370);
  ctx.font        = 'bold 38px sans-serif';
  ctx.fillStyle   = 'rgba(255,255,255,0.8)';
  ctx.fillText('票', W - 60, 420);

  // サブコピー
  ctx.shadowBlur  = 0;
  ctx.font        = 'bold 28px sans-serif';
  ctx.textAlign   = 'center';
  ctx.fillStyle   = 'rgba(255,255,255,0.7)';
  ctx.fillText('あなたはどっち派？タップして投票！', W / 2, 560);

  return canvas.toDataURL('image/png');
}

async function updateOGP() {
  try {
    const dataURL = await generateOGPCanvas();

    // og:image にデータURLを設定（ローカル用）
    const meta = document.getElementById('og-image-meta');
    if (meta) meta.content = dataURL;

    // Supabase Storageにアップロード（設定済みの場合）
    if (sbClient) {
      const blob = await (await fetch(dataURL)).blob();
      const { error } = await sbClient.storage
        .from('ogp')
        .upload('og-image.png', blob, {
          upsert: true,
          contentType: 'image/png',
          cacheControl: '60',
        });
      if (!error) {
        const { data: { publicUrl } } = sbClient.storage
          .from('ogp')
          .getPublicUrl('og-image.png');
        if (meta) meta.content = publicUrl;
      }
    }
  } catch (e) {
    console.warn('[OGP] generation failed', e);
  }
}

/* =============================================================
   DATA MODAL
============================================================= */
function buildDataList() {
  elDataList.innerHTML = '';
  COMPARE_DATA.forEach(item => {
    const kNote = item.kNote ? `<span class="dc-note">${item.kNote}</span>` : '';
    const tNote = item.tNote ? `<span class="dc-note">${item.tNote}</span>` : '';

    const row = document.createElement('div');
    row.className = 'dc-row';
    row.innerHTML = `
      <div class="dc-kinoko">
        <span class="dc-value">${item.kDisplay}</span>
        ${kNote}
      </div>
      <div class="dc-label">${item.label}</div>
      <div class="dc-takenoko">
        <span class="dc-value">${item.tDisplay}</span>
        ${tNote}
      </div>
    `;
    elDataList.appendChild(row);
  });
}

/* =============================================================
   MODAL / OVERLAY HELPERS
============================================================= */
function openOverlay(el) {
  el.classList.add('active');
}
function closeOverlay(el) {
  el.classList.remove('active');
}

// 背景タップで閉じる
[elDataOverlay, elShareOverlay, elHowtoOverlay].forEach(ov => {
  ov.addEventListener('click', e => { if (e.target === ov) closeOverlay(ov); });
});

/* Data */
$('nav-data').addEventListener('click', () => { buildDataList(); openOverlay(elDataOverlay); });
$('data-close').addEventListener('click', () => closeOverlay(elDataOverlay));

/* Howto */
$('nav-howto').addEventListener('click', () => openOverlay(elHowtoOverlay));
$('howto-close').addEventListener('click', () => closeOverlay(elHowtoOverlay));

/* Share */
$('nav-share').addEventListener('click', () => openOverlay(elShareOverlay));
$('share-cancel').addEventListener('click', () => closeOverlay(elShareOverlay));

$('share-x').addEventListener('click', () => {
  const k = state.kinoko.toLocaleString('ja-JP');
  const t = state.takenoko.toLocaleString('ja-JP');
  const text = `きのこの山 vs たけのこの里\n\n今の結果は…\nきのこ：${k}票\nたけのこ：${t}票\n\nあなたはどっち派？`;
  window.open(
    `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(location.href)}`,
    '_blank', 'noopener'
  );
  closeOverlay(elShareOverlay);
});

$('share-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    showToast('✅ URLをコピーしました！');
  } catch {
    showToast('コピーできませんでした');
  }
  closeOverlay(elShareOverlay);
});

/* =============================================================
   VOTE EVENTS
============================================================= */
elBtnK.addEventListener('click',  () => vote('kinoko'));
elBtnT.addEventListener('click',  () => vote('takenoko'));
elSideK.addEventListener('click', () => vote('kinoko'));
elSideT.addEventListener('click', () => vote('takenoko'));

/* =============================================================
   INIT
============================================================= */
async function init() {
  if (USE_SUPABASE) {
    elDot.className = 'realtime-dot';
    await initSupabase();
  } else {
    renderAll(true);
  }
}

init();
