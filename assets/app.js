/* ══════════════════════════════════════════════════════════════
   TSE OPTIONS TERMINAL — JAVASCRIPT ENGINE (v2.4 PRO)
   Real-time Options Matrix, Strategy Calculators & Dynamic Greeks
   ══════════════════════════════════════════════════════════════ */

let strats = { bcs: [], cc: [], collar: [], conversion: [] };
let cdSec = 60;
let cdMax = 60;
let cdInt = null;
let activeTab = 'bcs';
let goldenOnly = true;
let soundEnabled = false;
let orderBasket = [];
let _cmType = null;

// Black-Scholes Defaults
let rfRate = 28.5; // %
let ivAvg = 41.2;  // %

/* ── NUMBER FORMATTERS ── */
const fN = n => (n == null || isNaN(n)) ? '—' : Math.round(n).toLocaleString('fa-IR');
const fNEn = n => (n == null || isNaN(n)) ? '—' : Math.round(n).toLocaleString('en-US');
const f2 = n => (n == null || isNaN(n)) ? '—' : Number(n).toFixed(2);
const f1 = n => (n == null || isNaN(n)) ? '—' : Number(n).toFixed(1);
const esc = s => (s || '').toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const fVol = v => {
    if (!v) return '<span class="text-outline text-[11px] font-mono">—</span>';
    if (v >= 1e12) return `<span class="font-mono text-secondary font-bold">${(v / 1e12).toFixed(1)}T</span> <span class="text-[10px] text-outline">همت</span>`;
    if (v >= 1e9) return `<span class="font-mono text-primary font-bold">${(v / 1e9).toFixed(1)}B</span> <span class="text-[10px] text-outline">م.ر</span>`;
    if (v >= 1e6) return `<span class="font-mono text-on-surface font-bold">${(v / 1e6).toFixed(1)}M</span> <span class="text-[10px] text-outline">م.ر</span>`;
    return `<span class="font-mono">${(v / 1e3).toFixed(0)}K</span>`;
};

/* ── SOUND FEEDBACK ── */
function playTone(freq = 440, type = 'sine', duration = 0.1) {
    if (!soundEnabled) return;
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        gain.gain.setValueAtTime(0.05, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + duration);
    } catch {}
}

function toggleSound() {
    soundEnabled = !soundEnabled;
    const icon = document.getElementById('sound-icon');
    if (icon) {
        icon.textContent = soundEnabled ? 'volume_up' : 'volume_off';
        icon.style.color = soundEnabled ? 'var(--color-primary)' : '';
    }
    if (soundEnabled) playTone(587, 'sine', 0.15);
}

/* ── DARK MODE ── */
function initTheme() {
    const saved = localStorage.getItem('tse_theme');
    const isDark = saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches);
    applyTheme(isDark);
}

function applyTheme(isDark) {
    const html = document.documentElement;
    const icon = document.getElementById('theme-icon');
    if (isDark) {
        html.classList.add('dark');
        if (icon) icon.textContent = 'light_mode';
        localStorage.setItem('tse_theme', 'dark');
    } else {
        html.classList.remove('dark');
        if (icon) icon.textContent = 'dark_mode';
        localStorage.setItem('tse_theme', 'light');
    }
}

function toggleDarkMode() {
    const isDark = document.documentElement.classList.contains('dark');
    applyTheme(!isDark);
    playTone(520, 'sine', 0.08);
}

/* ── TAB NAVIGATION ── */
function switchTab(tab) {
    activeTab = tab;
    playTone(400, 'triangle', 0.05);

    // Update Tab Buttons
    document.querySelectorAll('#main-nav-tabs .tab-btn').forEach(btn => {
        const isCurrent = btn.dataset.tab === tab;
        if (isCurrent) {
            btn.className = 'tab-btn flex items-center gap-space-xs px-3 py-1.5 transition-colors bg-primary-container text-on-primary-container font-bold rounded-lg shadow-sm';
        } else {
            btn.className = 'tab-btn flex items-center gap-space-xs px-3 py-1.5 rounded-lg text-on-surface-variant hover:text-on-surface transition-colors font-title-md text-title-md';
        }
    });

    // Update Page Views
    document.querySelectorAll('.page-view').forEach(p => {
        if (p.id === 'page-' + tab) {
            p.classList.remove('hidden');
            p.classList.add('flex');
        } else {
            p.classList.add('hidden');
            p.classList.remove('flex');
        }
    });
}

function scrollToCalc() {
    switchTab('bcs');
    const el = document.getElementById('calc-container');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function scrollToCalcCC() {
    const el = document.getElementById('calc-cc-box');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ── LIVE DATA FETCHER ── */
async function loadLiveData(manual = false) {
    try {
        const r = await fetch('/api/options?t=' + Date.now());
        if (!r.ok && r.status !== 304) {
            console.warn('API returned status:', r.status);
            return;
        }

        const payload = await r.json();
        if (!payload.data || !payload.data.bcs) {
            console.warn('Payload missing strategies, attempting force update...');
            if (!manual) forceUpdateData();
            return;
        }

        strats = {
            bcs: payload.data.bcs || [],
            cc: payload.data.cc || [],
            collar: payload.data.collar || [],
            conversion: payload.data.conversion || []
        };

        // Update tab badges
        document.getElementById('tab-badge-bcs').textContent = (strats.bcs.length).toLocaleString('fa-IR');
        document.getElementById('tab-badge-cc').textContent = (strats.cc.length).toLocaleString('fa-IR');
        document.getElementById('tab-badge-collar').textContent = (strats.collar.length).toLocaleString('fa-IR');
        document.getElementById('tab-badge-conversion').textContent = (strats.conversion.length).toLocaleString('fa-IR');

        // Populate filters
        updateGenericFilters(strats.bcs, 'fu', 'fe');
        updateGenericFilters(strats.cc, 'cc-fu', 'cc-fe');
        updateGenericFilters(strats.collar, 'col-fu', 'col-fe');
        updateGenericFilters(strats.conversion, 'cv-fu', 'cv-fe');

        // Render Views
        renderBCS();
        renderCC();
        renderCollar();
        renderConversion();

        // Update footer and meta
        const lupd = document.getElementById('lupd');
        if (lupd && payload.meta) {
            lupd.textContent = payload.meta.updated_at ? payload.meta.updated_at.split(' ')[1] || payload.meta.updated_at : 'زنده';
        }

        const ftrTotal = document.getElementById('ftr-total-contracts');
        if (ftrTotal && payload.meta?.rows) {
            ftrTotal.textContent = (payload.meta.rows).toLocaleString('fa-IR') + ' قرارداد';
        }

        // Hide loader overlay smoothly
        const loader = document.getElementById('loader-overlay');
        if (loader) {
            loader.style.opacity = '0';
            loader.style.pointerEvents = 'none';
            setTimeout(() => loader.remove(), 400);
        }

        // Auto-load first contract in BCS calculator if available
        if (strats.bcs.length > 0 && manual) {
            const first = strats.bcs[0];
            loadContractIntoCalc(first.underlying, first.k1, first.k2, first.p1, first.p2, first.uprice);
        }

    } catch (err) {
        console.error('Error loading options data:', err);
    }
}

async function forceUpdateData() {
    playTone(600, 'sine', 0.1);
    const textEl = document.getElementById('loader-text');
    if (textEl) textEl.textContent = 'در حال ارتباط زنده با سرور مشتقه بورس تهران...';
    
    try {
        const r = await fetch('/api/force_update');
        const res = await r.json();
        await loadLiveData(true);
        cdSec = cdMax;
    } catch (e) {
        console.error('Force update failed:', e);
        await loadLiveData(true);
    }
}

function manRefresh() {
    playTone(700, 'sine', 0.08);
    cdSec = cdMax;
    loadLiveData(true);
}

function updateGenericFilters(data, symId, expId) {
    if (!data || !Array.isArray(data)) return;
    const symbols = [...new Set(data.map(d => d.underlying).filter(Boolean))].sort();
    const expiries = [...new Set(data.map(d => d.expiry).filter(Boolean))].sort();

    const fillSelect = (id, items, defaultLabel) => {
        const el = document.getElementById(id);
        if (!el) return;
        const cur = el.value;
        el.innerHTML = `<option value="">${defaultLabel}</option>` + 
            items.map(v => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(v)}</option>`).join('');
    };

    fillSelect(symId, symbols, 'همه نمادهای پایه');
    fillSelect(expId, expiries, 'همه سررسیدها');
}

/* ══════════════════════════════════════════════════════════════
   SCREEN 1: BULL CALL SPREAD LOGIC
   ══════════════════════════════════════════════════════════════ */

function updateFilterLabel(type) {
    if (type === 'safety') {
        const v = document.getElementById('gf-safety').value;
        document.getElementById('lbl-gf-safety').textContent = `≥ ${v}٪`;
    } else if (type === 'ret') {
        const v = document.getElementById('gf-ret').value;
        document.getElementById('lbl-gf-ret').textContent = `≥ ${v}٪`;
    } else if (type === 'vol') {
        const v = document.getElementById('fvol').value;
        document.getElementById('lbl-gf-vol').textContent = `≥ ${v} م.ر`;
    } else if (type === 'worst') {
        const v = document.getElementById('gf-worst').value;
        document.getElementById('lbl-gf-worst').textContent = `≥ ${v}٪`;
    } else if (type === 'days') {
        const v = document.getElementById('gf-days').value;
        document.getElementById('lbl-gf-days').textContent = `≤ ${v} روز`;
    }
}

function setK1StatusFilter(st) {
    document.getElementById('gf-status').value = st;
    document.querySelectorAll('.k1-btn').forEach(btn => {
        if (btn.dataset.status === st) {
            btn.className = 'k1-btn flex-1 py-1 rounded bg-secondary-container text-on-secondary-container font-label-sm text-label-sm font-bold';
        } else {
            btn.className = 'k1-btn flex-1 py-1 rounded bg-surface-container text-on-surface font-label-sm text-label-sm';
        }
    });
    const hint = document.getElementById('k1-status-hint');
    if (hint) {
        hint.textContent = st ? `فیلتر روی استرایک‌های ${st}` : 'نمایش تمام وضعیت‌ها';
    }
    renderBCS();
}

function toggleGoldenFilterMaster(checkbox) {
    if (checkbox) {
        goldenOnly = checkbox.checked;
    } else {
        const cb = document.getElementById('goldenToggle');
        if (cb) {
            cb.checked = !cb.checked;
            goldenOnly = cb.checked;
        }
    }
    
    const stText = document.getElementById('golden-status-text');
    if (stText) {
        stText.innerHTML = goldenOnly 
            ? `<span class="h-2 w-2 rounded-full bg-secondary animate-pulse"></span> فعال (<span id="bcs-golden-matched">۰</span> قرارداد)`
            : `<span class="h-2 w-2 rounded-full bg-outline"></span> غیرفعال (نمایش همه)`;
    }
    renderBCS();
}

function showAllStrategies() {
    const cb = document.getElementById('goldenToggle');
    if (cb) cb.checked = false;
    goldenOnly = false;
    toggleGoldenFilterMaster(cb);
}

function toggleQuickITM() {
    const cur = document.getElementById('gf-status').value;
    const btn = document.getElementById('btn-quick-itm');
    if (cur === 'ITM') {
        setK1StatusFilter('');
        btn.classList.remove('bg-primary-container', 'text-on-primary-container');
    } else {
        setK1StatusFilter('ITM');
        btn.classList.add('bg-primary-container', 'text-on-primary-container');
    }
}

function resetBCSFilters() {
    document.getElementById('fu').value = '';
    document.getElementById('fe').value = '';
    document.getElementById('fs').value = 'gold';
    document.getElementById('gf-safety').value = 5;
    document.getElementById('gf-ret').value = 10;
    document.getElementById('fvol').value = 1;
    document.getElementById('gf-worst').value = 5;
    document.getElementById('gf-days').value = 90;
    setK1StatusFilter('');
    updateFilterLabel('safety');
    updateFilterLabel('ret');
    updateFilterLabel('vol');
    updateFilterLabel('worst');
    updateFilterLabel('days');
    renderBCS();
}

function renderBCS() {
    const fU = document.getElementById('fu')?.value || '';
    const fE = document.getElementById('fe')?.value || '';
    const fS = document.getElementById('fs')?.value || 'gold';

    const minVol = (parseFloat(document.getElementById('fvol')?.value) || 0) * 1e9;
    const gS = parseFloat(document.getElementById('gf-safety')?.value) || 0;
    const gR = parseFloat(document.getElementById('gf-ret')?.value) || 0;
    const gW = parseFloat(document.getElementById('gf-worst')?.value) || -999;
    const maxDays = parseFloat(document.getElementById('gf-days')?.value) || 180;
    const gSt = document.getElementById('gf-status')?.value || '';

    let list = (strats.bcs || []).filter(s => {
        if (fU && s.underlying !== fU) return false;
        if (fE && s.expiry !== fE) return false;
        if (s.v1 < minVol || s.v2 < minVol) return false;
        if (s.days > maxDays) return false;
        return true;
    });

    // Tag Golden Contracts
    let goldenCount = 0;
    list.forEach(s => {
        const st = s.k1 < s.uprice * 0.98 ? 'ITM' : (s.k1 <= s.uprice * 1.02 ? 'ATM' : 'OTM');
        s._st = st;
        const passSafety = (s.safetyMargin || 0) >= gS;
        const passRet = (s.returnPct || 0) >= gR;
        const passWorst = (s.retWorst == null || s.retWorst >= gW);
        const passStatus = !gSt || st === gSt;

        s._gold = passSafety && passRet && passWorst && passStatus;
        if (s._gold) goldenCount++;
    });

    // If master golden filter is on, show only golden
    let displayList = goldenOnly ? list.filter(s => s._gold) : list;

    // Sorting
    if (fS === 'gold') {
        displayList.sort((a, b) => (b._gold ? 1 : 0) - (a._gold ? 1 : 0) || (b.safetyMargin || 0) - (a.safetyMargin || 0));
    } else if (fS === 'ret') {
        displayList.sort((a, b) => (b.returnPct || 0) - (a.returnPct || 0));
    } else if (fS === 'profit') {
        displayList.sort((a, b) => (b.safetyMargin || 0) - (a.safetyMargin || 0));
    } else if (fS === 'loss') {
        displayList.sort((a, b) => (a.netDebit || 0) - (b.netDebit || 0));
    } else if (fS === 'days') {
        displayList.sort((a, b) => (a.days || 0) - (b.days || 0));
    } else if (fS === 'atm') {
        displayList.sort((a, b) => Math.abs(a.breakeven - a.uprice) - Math.abs(b.breakeven - b.uprice));
    }

    // Top cards update
    document.getElementById('bcs-st').textContent = (list.length).toLocaleString('fa-IR');
    document.getElementById('bcs-gold').textContent = (goldenCount).toLocaleString('fa-IR');
    document.getElementById('bcs-su').textContent = (new Set(list.map(s => s.underlying))).size.toLocaleString('fa-IR');
    document.getElementById('bcs-se').textContent = (new Set(list.map(s => s.expiry))).size.toLocaleString('fa-IR');

    const matchedEl = document.getElementById('bcs-golden-matched');
    if (matchedEl) matchedEl.textContent = goldenCount.toLocaleString('fa-IR');

    const maxRoiItem = list.reduce((max, s) => (s.returnPct > (max?.returnPct || 0) ? s : max), null);
    if (maxRoiItem) {
        document.getElementById('bcs-max-roi').textContent = `Max ROI: +${f1(maxRoiItem.returnPct)}٪`;
    }

    document.getElementById('bcs-active-summary').textContent = `${list.length} موقعیت فعال شناسایی‌شده`;
    document.getElementById('tcnt').textContent = `نمایش ${displayList.length} موقعیت از ${list.length} فرصت ${goldenOnly ? '(فیلتر طلایی فعال)' : ''}`;

    // Render Table Rows
    const tbody = document.getElementById('tb');
    if (!tbody) return;

    if (displayList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="14" class="text-center py-8 text-on-surface-variant">
            هیچ موقعیتی با فیلترهای فعلی یافت نشد. می‌توانید 
            <button class="text-primary underline font-bold" onclick="showAllStrategies()">فیلتر طلایی را غیرفعال کنید</button> 
            یا مقادیر را تغییر دهید.
        </td></tr>`;
        return;
    }

    tbody.innerHTML = displayList.map((s, idx) => {
        const isGold = s._gold;
        const bepDist = s.uprice > 0 ? (((s.breakeven - s.uprice) / s.uprice) * 100).toFixed(1) : '0';
        const distSign = Number(bepDist) > 0 ? '+' : '';
        const safetyWidth = Math.min(100, Math.max(0, (s.safetyMargin || 0) * 2)).toFixed(0);

        const statusTag = s._st === 'ITM' 
            ? '<span class="px-1.5 py-0.5 rounded bg-secondary-container text-on-secondary-container font-bold font-mono">ITM</span>'
            : (s._st === 'ATM' 
                ? '<span class="px-1.5 py-0.5 rounded bg-surface-container-high text-on-surface font-bold font-mono">ATM</span>'
                : '<span class="px-1.5 py-0.5 rounded bg-surface-container text-outline font-mono">OTM</span>');

        const symD = encodeURIComponent(JSON.stringify({
            sym: s.underlying,
            k1: s.k1,
            k2: s.k2,
            p1: s.p1,
            p2: s.p2,
            spot: s.uprice
        }));

        return `<tr class="${isGold ? 'is-golden-row' : 'hover:bg-surface-container-low'} transition-colors h-11">
            <td class="px-space-md py-1 text-center font-mono">
                ${isGold 
                    ? `<span class="inline-flex items-center gap-0.5 px-2 py-0.5 rounded bg-tertiary-fixed text-tertiary font-label-sm text-label-sm font-bold"><span class="material-symbols-outlined text-[13px] text-tertiary">star</span>${idx + 1}</span>`
                    : `<span class="text-on-surface-variant font-mono text-[12px]">${idx + 1}</span>`}
            </td>
            <td class="px-space-md py-1">
                <div class="flex flex-col">
                    <div class="flex items-center gap-1.5">
                        <span class="font-title-md text-title-md font-bold text-primary">${esc(s.underlying)}</span>
                        ${isGold ? '<span class="text-[10px] text-tertiary font-bold">⭐ سوپر آلفا</span>' : ''}
                    </div>
                    <div class="flex items-center gap-1 font-label-sm text-label-sm text-secondary font-bold font-mono">
                        <span>${fNEn(s.uprice)} R</span>
                    </div>
                </div>
            </td>
            <td class="px-space-md py-1 font-mono">
                <div class="flex flex-col">
                    <span class="font-label-sm text-label-sm font-bold text-on-surface">${esc(s.expiry)}</span>
                    <span class="font-label-sm text-[11px] text-outline">${s.days} روز مانده</span>
                </div>
            </td>
            <td class="px-space-md py-1 font-mono">
                <div class="flex flex-col">
                    <span class="font-label-md text-label-md font-bold text-on-surface">${esc(s.sym1)}</span>
                    <div class="flex items-center gap-2 font-label-sm text-label-sm text-on-surface-variant">
                        <span>K₁: <strong class="text-on-surface">${fNEn(s.k1)}</strong></span>
                        <span>Ask: <strong class="text-primary font-bold">${fNEn(s.p1)}</strong></span>
                    </div>
                </div>
            </td>
            <td class="px-space-md py-1 font-mono">
                <div class="flex flex-col">
                    <span class="font-label-md text-label-md font-bold text-on-surface">${esc(s.sym2)}</span>
                    <div class="flex items-center gap-2 font-label-sm text-label-sm text-on-surface-variant">
                        <span>K₂: <strong class="text-on-surface">${fNEn(s.k2)}</strong></span>
                        <span>Bid: <strong class="text-secondary font-bold">${fNEn(s.p2)}</strong></span>
                    </div>
                </div>
            </td>
            <td class="px-space-md py-1 text-center">
                ${statusTag}
            </td>
            <td class="px-space-md py-1 text-left font-label-md text-label-md font-bold text-primary font-mono">
                ${fNEn(s.netDebit)} R
            </td>
            <td class="px-space-md py-1 text-left font-mono">
                <div class="flex flex-col items-start font-label-sm text-label-sm">
                    <span class="font-bold text-on-surface">${fNEn(s.breakeven)} R</span>
                    <span class="${Number(bepDist) <= 2 ? 'text-secondary font-bold' : 'text-outline'} text-[11px]">${distSign}${bepDist}% فاصله</span>
                </div>
            </td>
            <td class="px-space-md py-1">
                <div class="flex flex-col gap-1 w-32 mx-auto font-mono">
                    <div class="flex justify-between font-label-sm text-label-sm font-bold ${s.safetyMargin > 15 ? 'text-secondary' : 'text-on-surface'}">
                        <span>+${f1(s.safetyMargin)}٪</span>
                        <span class="text-outline text-[10px]">${s.safetyMargin >= 20 ? 'بسیار امن' : 'مطلوب'}</span>
                    </div>
                    <div class="w-full bg-surface-container-high rounded-full h-1.5 overflow-hidden">
                        <div class="bg-secondary h-full rounded-full" style="width: ${safetyWidth}%"></div>
                    </div>
                </div>
            </td>
            <td class="px-space-md py-1 text-left font-label-md text-label-md font-bold text-on-surface font-mono">
                ${fNEn(s.maxProfit)} R
            </td>
            <td class="px-space-md py-1 text-left font-mono">
                <span class="font-label-lg text-label-lg font-bold text-secondary bg-secondary-container/40 px-2 py-0.5 rounded">
                    +${f1(s.returnPct)}٪
                </span>
            </td>
            <td class="px-space-md py-1 text-center font-label-sm text-label-sm font-bold font-mono">
                1 : ${s.netDebit > 0 ? f2(s.maxProfit / s.netDebit) : '—'}
            </td>
            <td class="px-space-md py-1 text-left font-label-sm text-label-sm font-mono">
                ${fVol(s.v1 + s.v2)}
            </td>
            <td class="px-space-md py-1 text-center">
                <div class="flex items-center justify-center gap-1">
                    <button class="p-1 rounded bg-surface-container-high hover:bg-primary hover:text-on-primary transition-colors text-primary cursor-pointer" onclick="loadContractIntoCalc('${esc(s.underlying)}', ${s.k1}, ${s.k2}, ${s.p1}, ${s.p2}, ${s.uprice})" title="شبیه‌سازی در ماشین‌حساب">
                        <span class="material-symbols-outlined text-[17px]">calculate</span>
                    </button>
                    <button onclick="openOrderModal('${esc(s.underlying)}', '${esc(s.sym1)}', '${esc(s.sym2)}', ${s.k1}, ${s.k2}, ${s.p1}, ${s.p2})" class="px-2 py-1 rounded bg-primary text-on-primary hover:bg-primary-container font-body-sm text-body-sm font-bold transition-colors cursor-pointer">
                        سفارش دوپایه
                    </button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

/* ══════════════════════════════════════════════════════════════
   INTERACTIVE SPREAD CALCULATOR & DYNAMIC SVG PAYOFF
   ══════════════════════════════════════════════════════════════ */

function loadContractIntoCalc(symbol, k1, k2, ask, bid, spot) {
    document.getElementById('calcAssetTag').innerText = symbol + ' (بارگذاری شد)';
    document.getElementById('calcK1').value = k1;
    document.getElementById('calcK2').value = k2;
    document.getElementById('calcAsk').value = ask;
    document.getElementById('calcBid').value = bid;
    if (spot) document.getElementById('calcSpot').value = spot;
    recalcSpread();
    scrollToCalc();
    playTone(550, 'sine', 0.08);
}

function updateContractCount(val) {
    const totalShares = (val * 1000).toLocaleString('fa-IR');
    document.getElementById('contractCountLabel').innerText = Number(val).toLocaleString('fa-IR') + ' قرارداد (معادل ' + totalShares + ' سهم)';
    recalcSpread();
}

function recalcSpread() {
    const k1 = parseFloat(document.getElementById('calcK1').value) || 0;
    const k2 = parseFloat(document.getElementById('calcK2').value) || 0;
    const ask = parseFloat(document.getElementById('calcAsk').value) || 0;
    const bid = parseFloat(document.getElementById('calcBid').value) || 0;
    const spot = parseFloat(document.getElementById('calcSpot').value) || k1;
    const contracts = parseInt(document.getElementById('calcContracts').value) || 100;

    const netDebit = Math.max(0, ask - bid);
    const maxProfit = Math.max(0, (k2 - k1) - netDebit);
    const bep = k1 + netDebit;
    const roi = netDebit > 0 ? ((maxProfit / netDebit) * 100).toFixed(1) : 0;
    const totalCostToman = Math.round((netDebit * contracts * 1000) / 10).toLocaleString('fa-IR');

    document.getElementById('outNetDebit').innerText = netDebit.toLocaleString('fa-IR') + ' ریال';
    document.getElementById('outMaxProfit').innerText = maxProfit.toLocaleString('fa-IR') + ' ریال';
    document.getElementById('outBEP').innerText = bep.toLocaleString('fa-IR') + ' ریال';
    document.getElementById('outROI').innerText = '+' + Number(roi).toLocaleString('fa-IR') + '٪';
    document.getElementById('totalCapitalRequired').innerText = totalCostToman + ' تومان';

    // Black-Scholes Greeks Sandbox Estimation
    calculateGreeks(spot, k1, k2);

    // Draw Dynamic SVG Payoff Diagram
    drawPayoffCurve(k1, k2, ask, bid, spot, bep, netDebit, maxProfit);
}

function calculateGreeks(S, k1, k2) {
    // Normal CDF approximation
    const cdf = x => {
        const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
        const sign = x < 0 ? -1 : 1;
        const absX = Math.abs(x) / Math.sqrt(2);
        const t = 1.0 / (1.0 + p * absX);
        const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
        return 0.5 * (1.0 + sign * y);
    };

    const T = 45 / 365;
    const r = rfRate / 100;
    const sig = ivAvg / 100;

    if (S <= 0 || k1 <= 0 || k2 <= 0) return;

    const d1_1 = (Math.log(S / k1) + (r + 0.5 * sig * sig) * T) / (sig * Math.sqrt(T));
    const d1_2 = (Math.log(S / k2) + (r + 0.5 * sig * sig) * T) / (sig * Math.sqrt(T));

    const delta = Math.max(0.01, Math.min(0.99, cdf(d1_1) - cdf(d1_2)));
    const gamma = Math.max(0.0001, (Math.exp(-0.5 * d1_1 * d1_1) / (Math.sqrt(2 * Math.PI) * S * sig * Math.sqrt(T))));
    const theta = -Math.abs((S * sig * Math.exp(-0.5 * d1_1 * d1_1)) / (2 * Math.sqrt(2 * Math.PI * T) * 365));
    const vega = Math.max(0.1, (S * Math.sqrt(T) * Math.exp(-0.5 * d1_1 * d1_1)) / (Math.sqrt(2 * Math.PI) * 100));

    const dEl = document.getElementById('greek-delta');
    const gEl = document.getElementById('greek-gamma');
    const tEl = document.getElementById('greek-theta');
    const vEl = document.getElementById('greek-vega');

    if (dEl) dEl.textContent = `+${delta.toFixed(2)}`;
    if (gEl) gEl.textContent = `+${gamma.toFixed(4)}`;
    if (tEl) tEl.textContent = `${theta.toFixed(1)} R`;
    if (vEl) vEl.textContent = `+${vega.toFixed(1)}`;
}

function drawPayoffCurve(k1, k2, ask, bid, spot, bep, netDebit, maxProfit) {
    const svg = document.getElementById('payoff-svg');
    if (!svg) return;

    // SVG Canvas is 700 x 240
    const w = 700;
    const h = 240;
    const zeroY = 130;
    const minX = 50;
    const maxX = 650;

    // Relative X positioning
    const xK1 = 220;
    const xBEP = 370;
    const xK2 = 520;

    // Y values: Loss Y and Profit Y
    const yLoss = 190;
    const yProfit = 50;

    // Spot position mapping relative to K1 and K2
    let xSpot = xBEP;
    if (k2 > k1) {
        const frac = (spot - k1) / (k2 - k1);
        xSpot = Math.max(80, Math.min(620, xK1 + frac * (xK2 - xK1)));
    }

    svg.innerHTML = `
      <defs>
        <linearGradient id="profitGrad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="#006c4a" stop-opacity="0.4"></stop>
          <stop offset="100%" stop-color="#006c4a" stop-opacity="0.0"></stop>
        </linearGradient>
        <linearGradient id="lossGrad" x1="0" x2="0" y1="1" y2="0">
          <stop offset="0%" stop-color="#ba1a1a" stop-opacity="0.35"></stop>
          <stop offset="100%" stop-color="#ba1a1a" stop-opacity="0.0"></stop>
        </linearGradient>
      </defs>

      <!-- Grid lines -->
      <line opacity="0.3" stroke="#c2c6d5" stroke-dasharray="3,3" x1="${minX}" x2="${maxX}" y1="${yProfit}" y2="${yProfit}"></line>
      <line opacity="0.6" stroke="#091d2f" stroke-width="1.5" x1="${minX}" x2="${maxX}" y1="${zeroY}" y2="${zeroY}"></line>
      <line opacity="0.3" stroke="#c2c6d5" stroke-dasharray="3,3" x1="${minX}" x2="${maxX}" y1="${yLoss}" y2="${yLoss}"></line>

      <!-- Axis Labels -->
      <text fill="#727784" font-family="JetBrains Mono" font-size="10" text-anchor="start" x="${maxX + 5}" y="${zeroY + 4}">سود/زیان = ۰</text>
      <text fill="#006c4a" font-family="JetBrains Mono" font-size="11" font-weight="bold" text-anchor="end" x="${minX - 8}" y="${yProfit + 4}">+${fNEn(maxProfit)} R</text>
      <text fill="#ba1a1a" font-family="JetBrains Mono" font-size="11" font-weight="bold" text-anchor="end" x="${minX - 8}" y="${yLoss + 4}">-${fNEn(netDebit)} R</text>

      <!-- Fill Polygons -->
      <polygon fill="url(#profitGrad)" points="${xBEP},${zeroY} ${xK2},${yProfit} ${maxX},${yProfit} ${maxX},${zeroY}"></polygon>
      <polygon fill="url(#lossGrad)" points="${minX},${yLoss} ${xK1},${yLoss} ${xBEP},${zeroY} ${minX},${zeroY}"></polygon>

      <!-- Polyline Payoff Curve -->
      <polyline fill="none" points="${minX},${yLoss} ${xK1},${yLoss} ${xK2},${yProfit} ${maxX},${yProfit}" stroke="#0048a0" stroke-linecap="round" stroke-linejoin="round" stroke-width="3.5"></polyline>

      <!-- K1 Pin -->
      <line stroke="#727784" stroke-dasharray="4,4" stroke-width="1" x1="${xK1}" x2="${xK1}" y1="30" y2="210"></line>
      <circle cx="${xK1}" cy="${yLoss}" fill="#0048a0" r="5"></circle>
      <text fill="#091d2f" font-family="JetBrains Mono" font-size="11" font-weight="bold" text-anchor="middle" x="${xK1}" y="225">K₁: ${fNEn(k1)}</text>

      <!-- BEP Pin -->
      <line stroke="#1560c9" stroke-dasharray="2,2" stroke-width="1.5" x1="${xBEP}" x2="${xBEP}" y1="30" y2="210"></line>
      <circle cx="${xBEP}" cy="${zeroY}" fill="#1560c9" r="6"></circle>
      <text fill="#1560c9" font-family="JetBrains Mono" font-size="11" font-weight="bold" text-anchor="middle" x="${xBEP}" y="118">نقطه BEP: ${fNEn(bep)}</text>
      <text fill="#1560c9" font-family="Vazirmatn" font-size="10" font-weight="bold" text-anchor="middle" x="${xBEP}" y="225">سر‌به‌سر</text>

      <!-- K2 Pin -->
      <line stroke="#727784" stroke-dasharray="4,4" stroke-width="1" x1="${xK2}" x2="${xK2}" y1="30" y2="210"></line>
      <circle cx="${xK2}" cy="${yProfit}" fill="#006c4a" r="5"></circle>
      <text fill="#091d2f" font-family="JetBrains Mono" font-size="11" font-weight="bold" text-anchor="middle" x="${xK2}" y="225">K₂: ${fNEn(k2)}</text>

      <!-- Current Spot Price Indicator -->
      <line stroke="#ffb86e" stroke-width="2.5" x1="${xSpot}" x2="${xSpot}" y1="20" y2="200"></line>
      <rect fill="#714100" height="18" rx="4" width="80" x="${xSpot - 40}" y="10"></rect>
      <text fill="#ffffff" font-family="Vazirmatn" font-size="9.5" font-weight="bold" text-anchor="middle" x="${xSpot}" y="22.5">سهم: ${fNEn(spot)}</text>
    `;
}

/* ══════════════════════════════════════════════════════════════
   SCREEN 2: COVERED CALL LOGIC
   ══════════════════════════════════════════════════════════════ */

function renderCC() {
    const fU = document.getElementById('cc-fu')?.value || '';
    const fE = document.getElementById('cc-fe')?.value || '';
    const fSt = document.getElementById('cc-fst')?.value || '';
    const fS = document.getElementById('cc-fs')?.value || 'monthly';

    let list = (strats.cc || []).filter(o => {
        if (fU && o.underlying !== fU) return false;
        if (fE && o.expiry !== fE) return false;
        if (fSt && o.status !== fSt) return false;
        return true;
    });

    let goldenCount = 0;
    list.forEach(o => {
        o._gold = (o.mpct >= 4 && o.spct >= 8);
        if (o._gold) goldenCount++;
    });

    if (fS === 'monthly') list.sort((a, b) => (b.mpct || 0) - (a.mpct || 0));
    else if (fS === 'total') list.sort((a, b) => (b.tpct || 0) - (a.tpct || 0));
    else if (fS === 'safety') list.sort((a, b) => (b.spct || 0) - (a.spct || 0));
    else if (fS === 'volume') list.sort((a, b) => (b.volume || 0) - (a.volume || 0));

    document.getElementById('cc-st').textContent = list.length.toLocaleString('fa-IR');
    document.getElementById('cc-gold').textContent = goldenCount.toLocaleString('fa-IR');

    const bestMonthly = list.length ? Math.max(...list.map(o => o.mpct || 0)) : 0;
    const bestSafety = list.length ? Math.max(...list.map(o => o.spct || 0)) : 0;

    document.getElementById('cc-sb').textContent = bestMonthly > 0 ? `+${f1(bestMonthly)}٪` : '—';
    document.getElementById('cc-sa').textContent = bestSafety > 0 ? `+${f1(bestSafety)}٪` : '—';
    document.getElementById('cc-tcnt').textContent = `${list.length} فرصت کاوردکال فعال`;

    const tbody = document.getElementById('cc-tb');
    if (!tbody) return;

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="14" class="text-center py-8 text-on-surface-variant">موردی یافت نشد.</td></tr>`;
        return;
    }

    tbody.innerHTML = list.map((o, idx) => {
        const isGold = o._gold;
        const dJson = encodeURIComponent(JSON.stringify({
            t: 'cc',
            sym: o.symRaw,
            u: o.underlying,
            S: o.uprice,
            K: o.strike,
            P: o.premium,
            days: o.days,
            exp: o.expiry
        }));

        return `<tr class="${isGold ? 'is-golden-row' : 'hover:bg-surface-container-low'} transition-colors h-10 font-mono">
            <td class="px-space-md py-1 text-center font-mono text-[12px] text-on-surface-variant">${idx + 1}</td>
            <td class="px-space-md py-1 font-bold text-on-surface">${esc(o.symRaw)} ${isGold ? '⭐' : ''}</td>
            <td class="px-space-md py-1 font-bold text-primary font-title-md">${esc(o.underlying)}</td>
            <td class="px-space-md py-1">${esc(o.expiry)}</td>
            <td class="px-space-md py-1 text-center">${o.days}</td>
            <td class="px-space-md py-1 text-on-surface-variant">${fNEn(o.uprice)}</td>
            <td class="px-space-md py-1 text-secondary font-bold">${fNEn(o.strike)}</td>
            <td class="px-space-md py-1 text-primary font-bold">${fNEn(o.premium)}</td>
            <td class="px-space-md py-1">${fVol(o.volume)}</td>
            <td class="px-space-md py-1 font-bold ${o.tpct >= 15 ? 'text-secondary' : 'text-on-surface'}">+${f1(o.tpct)}٪</td>
            <td class="px-space-md py-1 font-bold text-secondary bg-secondary-container/20 px-2 rounded">+${f1(o.mpct)}٪</td>
            <td class="px-space-md py-1">${fNEn(o.breakeven)} <span class="text-secondary text-[11px] font-bold">(${f1(o.spct)}٪)</span></td>
            <td class="px-space-md py-1 text-center">
                <span class="px-1.5 py-0.5 rounded font-label-sm font-bold ${o.status === 'ITM' ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container-high text-on-surface'}">${o.status}</span>
            </td>
            <td class="px-space-md py-1 text-center">
                <button onclick="openCalc('${dJson}')" class="p-1 rounded bg-surface-container-high hover:bg-primary hover:text-on-primary transition-colors text-primary cursor-pointer" title="محاسبه‌گر">
                    <span class="material-symbols-outlined text-[16px]">calculate</span>
                </button>
            </td>
        </tr>`;
    }).join('');
}

function calcCCOffset() {
    const s0 = parseFloat(document.getElementById('cco-s0')?.value) || 0;
    const snow = parseFloat(document.getElementById('cco-snow')?.value) || 0;
    const psold = parseFloat(document.getElementById('cco-psold')?.value) || 0;
    const pnow = parseFloat(document.getElementById('cco-pnow')?.value) || 0;

    const origEl = document.getElementById('cco-orig');
    const nowEl = document.getElementById('cco-now');
    const covEl = document.getElementById('cco-cov');

    if (!s0 || !psold) {
        if (origEl) origEl.textContent = '—';
        if (nowEl) nowEl.textContent = '—';
        if (covEl) covEl.textContent = '—';
        return;
    }

    const cb = s0 - psold;
    const origRet = (psold / cb) * 100;
    if (origEl) origEl.textContent = `+${f1(origRet)}٪`;

    if (!snow && !pnow) return;

    const sPnL = snow - s0;
    const oPnL = psold - pnow;
    const tPnL = sPnL + oPnL;
    const nowRet = (tPnL / cb) * 100;
    const cov = psold > 0 ? (tPnL / psold) * 100 : 0;

    if (nowEl) nowEl.textContent = `${nowRet >= 0 ? '+' : ''}${f1(nowRet)}٪`;
    if (covEl) covEl.textContent = `${cov >= 0 ? '+' : ''}${f1(cov)}٪`;
}

/* ══════════════════════════════════════════════════════════════
   SCREEN 3: COLLAR LOGIC
   ══════════════════════════════════════════════════════════════ */

function renderCollar() {
    const fU = document.getElementById('col-fu')?.value || '';
    const fE = document.getElementById('col-fe')?.value || '';
    const fS = document.getElementById('col-fs')?.value || 'gold';

    let list = (strats.collar || []).filter(o => {
        if (fU && o.underlying !== fU) return false;
        if (fE && o.expiry !== fE) return false;
        return true;
    });

    let goldenCount = 0;
    list.forEach(o => {
        o._gold = (o.profitPct >= 10 && o.lossPct >= -5);
        if (o._gold) goldenCount++;
    });

    if (fS === 'gold') list.sort((a, b) => (b._gold ? 1 : 0) - (a._gold ? 1 : 0) || (b.profitPct || 0) - (a.profitPct || 0));
    else if (fS === 'profit') list.sort((a, b) => (b.profitPct || 0) - (a.profitPct || 0));
    else if (fS === 'loss') list.sort((a, b) => (b.lossPct || 0) - (a.lossPct || 0));
    else if (fS === 'net') list.sort((a, b) => (b.netP || 0) - (a.netP || 0));

    document.getElementById('col-st').textContent = list.length.toLocaleString('fa-IR');
    document.getElementById('col-gold').textContent = goldenCount.toLocaleString('fa-IR');

    const bestProfit = list.length ? Math.max(...list.map(o => o.profitPct || 0)) : 0;
    const lowestLoss = list.length ? Math.max(...list.map(o => o.lossPct || -100)) : 0;

    document.getElementById('col-sbp').textContent = bestProfit > 0 ? `+${f1(bestProfit)}٪` : '—';
    document.getElementById('col-sbl').textContent = lowestLoss !== -100 ? `${f1(lowestLoss)}٪` : '—';
    document.getElementById('col-tcnt').textContent = `${list.length} ترکیب کولار فعال`;

    const tbody = document.getElementById('col-tb');
    if (!tbody) return;

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="16" class="text-center py-8 text-on-surface-variant">موردی یافت نشد.</td></tr>`;
        return;
    }

    tbody.innerHTML = list.map((o, idx) => {
        const isGold = o._gold;
        const dJson = encodeURIComponent(JSON.stringify({
            t: 'collar',
            u: o.underlying,
            S: o.uprice,
            Kc: o.Kc,
            Kp: o.Kp,
            Pc: o.Pc,
            Pp: o.Pp,
            exp: o.expiry,
            days: o.days
        }));

        return `<tr class="${isGold ? 'is-golden-row' : 'hover:bg-surface-container-low'} transition-colors h-10 font-mono">
            <td class="px-space-md py-1 text-center font-mono text-[12px] text-on-surface-variant">${idx + 1}</td>
            <td class="px-space-md py-1 font-bold text-primary font-title-md">${esc(o.underlying)} ${isGold ? '⭐' : ''}</td>
            <td class="px-space-md py-1 font-bold text-on-surface">${esc(o.callSym)}</td>
            <td class="px-space-md py-1 font-bold text-on-surface-variant">${esc(o.putSym)}</td>
            <td class="px-space-md py-1">${esc(o.expiry)}</td>
            <td class="px-space-md py-1 text-center">${o.days}</td>
            <td class="px-space-md py-1 text-on-surface-variant">${fNEn(o.uprice)}</td>
            <td class="px-space-md py-1">${fNEn(o.Kp)}</td>
            <td class="px-space-md py-1 text-secondary font-bold">${fNEn(o.Kc)}</td>
            <td class="px-space-md py-1 text-error font-bold">${fNEn(o.Pp)}</td>
            <td class="px-space-md py-1 text-secondary font-bold">${fNEn(o.Pc)}</td>
            <td class="px-space-md py-1 font-bold ${o.netP >= 0 ? 'text-secondary' : 'text-error'}">${o.netP >= 0 ? '+' : ''}${fNEn(o.netP)}</td>
            <td class="px-space-md py-1 font-bold text-secondary bg-secondary-container/20 px-1.5 rounded">+${f1(o.profitPct)}٪</td>
            <td class="px-space-md py-1 font-bold text-error">${f1(o.lossPct)}٪</td>
            <td class="px-space-md py-1">${fNEn(o.breakeven)}</td>
            <td class="px-space-md py-1 text-center">
                <button onclick="openCalc('${dJson}')" class="p-1 rounded bg-surface-container-high hover:bg-primary hover:text-on-primary transition-colors text-primary cursor-pointer">
                    <span class="material-symbols-outlined text-[16px]">calculate</span>
                </button>
            </td>
        </tr>`;
    }).join('');
}

/* ══════════════════════════════════════════════════════════════
   SCREEN 4: CONVERSION (ARBITRAGE) LOGIC
   ══════════════════════════════════════════════════════════════ */

function renderConversion() {
    const fU = document.getElementById('cv-fu')?.value || '';
    const fE = document.getElementById('cv-fe')?.value || '';
    const fS = document.getElementById('cv-fs')?.value || 'annual';

    let list = (strats.conversion || []).filter(o => {
        if (fU && o.underlying !== fU) return false;
        if (fE && o.expiry !== fE) return false;
        return true;
    });

    if (fS === 'annual') list.sort((a, b) => (b.annualPct || 0) - (a.annualPct || 0));
    else if (fS === 'ret') list.sort((a, b) => (b.retPct || 0) - (a.retPct || 0));

    document.getElementById('cv-st').textContent = list.length.toLocaleString('fa-IR');
    const bestAnnual = list.length ? Math.max(...list.map(o => o.annualPct || 0)) : 0;
    document.getElementById('cv-sbr').textContent = bestAnnual > 0 ? `+${f1(bestAnnual)}٪` : '—';

    const avgDays = list.length ? Math.round(list.reduce((sum, o) => sum + (o.days || 0), 0) / list.length) : 0;
    document.getElementById('cv-savg').textContent = avgDays > 0 ? `${avgDays.toLocaleString('fa-IR')} روز` : '—';
    document.getElementById('cv-su').textContent = (new Set(list.map(o => o.underlying))).size.toLocaleString('fa-IR');

    document.getElementById('cv-tcnt').textContent = `${list.length} فرصت آربیتراژ شناسایی‌شده`;

    const tbody = document.getElementById('cv-tb');
    if (!tbody) return;

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="12" class="text-center py-8 text-on-surface-variant">موردی یافت نشد.</td></tr>`;
        return;
    }

    tbody.innerHTML = list.map((o, idx) => {
        const dJson = encodeURIComponent(JSON.stringify({
            t: 'conversion',
            u: o.underlying,
            S: o.uprice,
            K: o.strike,
            Pc: o.Pc,
            Pp: o.Pp,
            days: o.days,
            exp: o.expiry
        }));

        return `<tr class="hover:bg-surface-container-low transition-colors h-10 font-mono">
            <td class="px-space-md py-1 text-center font-mono text-[12px] text-on-surface-variant">${idx + 1}</td>
            <td class="px-space-md py-1 font-bold text-primary font-title-md">${esc(o.underlying)}</td>
            <td class="px-space-md py-1 font-bold text-on-surface">${esc(o.callSym)}</td>
            <td class="px-space-md py-1 font-bold text-on-surface-variant">${esc(o.putSym)}</td>
            <td class="px-space-md py-1">${esc(o.expiry)}</td>
            <td class="px-space-md py-1 text-center">${o.days}</td>
            <td class="px-space-md py-1 text-on-surface-variant">${fNEn(o.uprice)}</td>
            <td class="px-space-md py-1 text-secondary font-bold">${fNEn(o.strike)}</td>
            <td class="px-space-md py-1 text-primary font-bold">${fNEn(o.netCost)}</td>
            <td class="px-space-md py-1 font-bold text-secondary">+${f1(o.monthlyPct)}٪</td>
            <td class="px-space-md py-1">
                <span class="font-bold text-secondary bg-secondary-container/40 px-2 py-0.5 rounded font-mono text-[13px]">
                    +${f1(o.annualPct)}٪ سالانه
                </span>
            </td>
            <td class="px-space-md py-1 text-center">
                <button onclick="openCalc('${dJson}')" class="p-1 rounded bg-surface-container-high hover:bg-primary hover:text-on-primary transition-colors text-primary cursor-pointer">
                    <span class="material-symbols-outlined text-[16px]">calculate</span>
                </button>
            </td>
        </tr>`;
    }).join('');
}

/* ══════════════════════════════════════════════════════════════
   MODAL: GENERAL STRATEGY CALCULATOR
   ══════════════════════════════════════════════════════════════ */

function closeCalc() {
    const modal = document.getElementById('cm-overlay');
    if (modal) modal.classList.add('hidden');
    document.body.style.overflow = '';
}

function openCalc(jsonData) {
    const d = JSON.parse(decodeURIComponent(jsonData));
    _cmType = d.t;
    const modal = document.getElementById('cm-overlay');
    if (modal) modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    let title, subtitle, inputs;
    if (d.t === 'bcs') {
        title = '🧮 شبیه‌ساز Bull Call Spread';
        subtitle = `نماد پایه: ${d.u} | سررسید: ${d.exp || ''} (${d.days || 0} روز)`;
        inputs = `
            <div class="flex flex-col"><label class="text-[11px] text-on-surface-variant mb-1 font-body-sm">قیمت سهم (S):</label><input id="cm-S" type="number" value="${d.S || 0}" class="bg-surface-container-low px-3 py-1.5 rounded-lg font-mono text-left" oninput="updateModalCalc()"/></div>
            <div class="flex flex-col"><label class="text-[11px] text-on-surface-variant mb-1 font-body-sm">اعمال پایین K₁:</label><input id="cm-k1" type="number" value="${d.k1 || 0}" class="bg-surface-container-low px-3 py-1.5 rounded-lg font-mono text-left" oninput="updateModalCalc()"/></div>
            <div class="flex flex-col"><label class="text-[11px] text-on-surface-variant mb-1 font-body-sm">اعمال بالا K₂:</label><input id="cm-k2" type="number" value="${d.k2 || 0}" class="bg-surface-container-low px-3 py-1.5 rounded-lg font-mono text-left" oninput="updateModalCalc()"/></div>
            <div class="flex flex-col"><label class="text-[11px] text-on-surface-variant mb-1 font-body-sm">پرمیوم کال پایین P₁:</label><input id="cm-p1" type="number" value="${d.p1 || 0}" class="bg-surface-container-low px-3 py-1.5 rounded-lg font-mono text-left text-primary font-bold" oninput="updateModalCalc()"/></div>
            <div class="flex flex-col col-span-2"><label class="text-[11px] text-on-surface-variant mb-1 font-body-sm">پرمیوم کال بالا P₂:</label><input id="cm-p2" type="number" value="${d.p2 || 0}" class="bg-surface-container-low px-3 py-1.5 rounded-lg font-mono text-left text-secondary font-bold" oninput="updateModalCalc()"/></div>
        `;
    } else if (d.t === 'cc') {
        title = '🧮 شبیه‌ساز Covered Call';
        subtitle = `نماد: ${d.sym || ''} | نماد پایه: ${d.u || ''} (${d.days || 0} روز)`;
        inputs = `
            <div class="flex flex-col"><label class="text-[11px] text-on-surface-variant mb-1 font-body-sm">قیمت سهم (S):</label><input id="cm-S" type="number" value="${d.S || 0}" class="bg-surface-container-low px-3 py-1.5 rounded-lg font-mono text-left" oninput="updateModalCalc()"/></div>
            <div class="flex flex-col"><label class="text-[11px] text-on-surface-variant mb-1 font-body-sm">قیمت اعمال (K):</label><input id="cm-K" type="number" value="${d.K || 0}" class="bg-surface-container-low px-3 py-1.5 rounded-lg font-mono text-left" oninput="updateModalCalc()"/></div>
            <div class="flex flex-col"><label class="text-[11px] text-on-surface-variant mb-1 font-body-sm">پرمیوم دریافتی (P):</label><input id="cm-P" type="number" value="${d.P || 0}" class="bg-surface-container-low px-3 py-1.5 rounded-lg font-mono text-left text-secondary font-bold" oninput="updateModalCalc()"/></div>
            <div class="flex flex-col"><label class="text-[11px] text-on-surface-variant mb-1 font-body-sm">روزهای مانده تا سررسید:</label><input id="cm-days" type="number" value="${d.days || 0}" class="bg-surface-container-low px-3 py-1.5 rounded-lg font-mono text-left" oninput="updateModalCalc()"/></div>
        `;
    } else if (d.t === 'collar') {
        title = '🧮 شبیه‌ساز استراتژی Collar';
        subtitle = `نماد پایه: ${d.u || ''} | سررسید: ${d.exp || ''} (${d.days || 0} روز)`;
        inputs = `
            <div class="flex flex-col"><label class="text-[11px] text-on-surface-variant mb-1 font-body-sm">قیمت سهم (S):</label><input id="cm-S" type="number" value="${d.S || 0}" class="bg-surface-container-low px-3 py-1.5 rounded-lg font-mono text-left" oninput="updateModalCalc()"/></div>
            <div class="flex flex-col"><label class="text-[11px] text-on-surface-variant mb-1 font-body-sm">اعمال کال (Kc):</label><input id="cm-Kc" type="number" value="${d.Kc || 0}" class="bg-surface-container-low px-3 py-1.5 rounded-lg font-mono text-left" oninput="updateModalCalc()"/></div>
            <div class="flex flex-col"><label class="text-[11px] text-on-surface-variant mb-1 font-body-sm">اعمال پوت (Kp):</label><input id="cm-Kp" type="number" value="${d.Kp || 0}" class="bg-surface-container-low px-3 py-1.5 rounded-lg font-mono text-left" oninput="updateModalCalc()"/></div>
            <div class="flex flex-col"><label class="text-[11px] text-on-surface-variant mb-1 font-body-sm">پرمیوم کال دریافتی (Pc):</label><input id="cm-Pc" type="number" value="${d.Pc || 0}" class="bg-surface-container-low px-3 py-1.5 rounded-lg font-mono text-left text-secondary font-bold" oninput="updateModalCalc()"/></div>
            <div class="flex flex-col col-span-2"><label class="text-[11px] text-on-surface-variant mb-1 font-body-sm">پرمیوم پوت پرداختی (Pp):</label><input id="cm-Pp" type="number" value="${d.Pp || 0}" class="bg-surface-container-low px-3 py-1.5 rounded-lg font-mono text-left text-error font-bold" oninput="updateModalCalc()"/></div>
        `;
    } else if (d.t === 'conversion') {
        title = '🧮 شبیه‌ساز آربیتراژ Conversion';
        subtitle = `نماد پایه: ${d.u || ''} | سررسید: ${d.exp || ''} (${d.days || 0} روز)`;
        inputs = `
            <div class="flex flex-col"><label class="text-[11px] text-on-surface-variant mb-1 font-body-sm">قیمت سهم (S):</label><input id="cm-S" type="number" value="${d.S || 0}" class="bg-surface-container-low px-3 py-1.5 rounded-lg font-mono text-left" oninput="updateModalCalc()"/></div>
            <div class="flex flex-col"><label class="text-[11px] text-on-surface-variant mb-1 font-body-sm">قیمت اعمال مشترک (K):</label><input id="cm-K" type="number" value="${d.K || 0}" class="bg-surface-container-low px-3 py-1.5 rounded-lg font-mono text-left" oninput="updateModalCalc()"/></div>
            <div class="flex flex-col"><label class="text-[11px] text-on-surface-variant mb-1 font-body-sm">پرمیوم کال دریافتی (Pc):</label><input id="cm-Pc" type="number" value="${d.Pc || 0}" class="bg-surface-container-low px-3 py-1.5 rounded-lg font-mono text-left text-secondary font-bold" oninput="updateModalCalc()"/></div>
            <div class="flex flex-col"><label class="text-[11px] text-on-surface-variant mb-1 font-body-sm">پرمیوم پوت پرداختی (Pp):</label><input id="cm-Pp" type="number" value="${d.Pp || 0}" class="bg-surface-container-low px-3 py-1.5 rounded-lg font-mono text-left text-error font-bold" oninput="updateModalCalc()"/></div>
            <div class="flex flex-col col-span-2"><label class="text-[11px] text-on-surface-variant mb-1 font-body-sm">روزهای مانده:</label><input id="cm-days" type="number" value="${d.days || 0}" class="bg-surface-container-low px-3 py-1.5 rounded-lg font-mono text-left" oninput="updateModalCalc()"/></div>
        `;
    }

    document.getElementById('cm-title').textContent = title;
    document.getElementById('cm-subtitle').textContent = subtitle;
    document.getElementById('cm-inputs').innerHTML = inputs;
    updateModalCalc();
}

function updateModalCalc() {
    const g = id => {
        const el = document.getElementById(id);
        return el ? parseFloat(el.value) || 0 : 0;
    };
    const res = document.getElementById('cm-results');
    if (!res) return;

    let html = '';
    if (_cmType === 'bcs') {
        const S = g('cm-S'), k1 = g('cm-k1'), k2 = g('cm-k2'), p1 = g('cm-p1'), p2 = g('cm-p2');
        const nd = p1 - p2;
        const mp = (k2 - k1) - nd;
        const be = k1 + nd;
        const sm = S > 0 ? ((S - be) / S) * 100 : 0;
        const roi = nd > 0 ? (mp / nd) * 100 : 0;

        html = `
            <div class="bg-surface-container-low p-2 rounded text-center font-mono">
                <span class="text-[10px] text-on-surface-variant font-body-sm">خالص هزینه (Debit)</span>
                <div class="font-bold text-primary mt-1">${fNEn(nd)} R</div>
            </div>
            <div class="bg-surface-container-low p-2 rounded text-center font-mono">
                <span class="text-[10px] text-on-surface-variant font-body-sm">حداکثر سود</span>
                <div class="font-bold text-secondary mt-1">${fNEn(mp)} R</div>
            </div>
            <div class="bg-surface-container-low p-2 rounded text-center font-mono">
                <span class="text-[10px] text-on-surface-variant font-body-sm">نقطه سر به سر</span>
                <div class="font-bold text-on-surface mt-1">${fNEn(be)} R</div>
            </div>
            <div class="bg-surface-container-low p-2 rounded text-center font-mono">
                <span class="text-[10px] text-on-surface-variant font-body-sm">حاشیه امنیت</span>
                <div class="font-bold text-secondary mt-1">+${f1(sm)}٪</div>
            </div>
            <div class="bg-surface-container-low p-2 rounded text-center font-mono">
                <span class="text-[10px] text-on-surface-variant font-body-sm">بازدهی ROI</span>
                <div class="font-bold text-secondary mt-1">+${f1(roi)}٪</div>
            </div>
            <div class="bg-surface-container-low p-2 rounded text-center font-mono">
                <span class="text-[10px] text-on-surface-variant font-body-sm">نسبت R/R</span>
                <div class="font-bold text-on-surface mt-1">1 : ${nd > 0 ? f2(mp / nd) : '—'}</div>
            </div>
        `;
    } else if (_cmType === 'cc') {
        const S = g('cm-S'), K = g('cm-K'), P = g('cm-P'), days = g('cm-days');
        const mp = K - S + P;
        const be = S - P;
        const tpct = S > 0 ? (mp / S) * 100 : 0;
        const mpct = days > 0 ? (tpct / days) * 30 : 0;
        const spct = S > 0 ? (P / S) * 100 : 0;

        html = `
            <div class="bg-surface-container-low p-2 rounded text-center font-mono">
                <span class="text-[10px] text-on-surface-variant font-body-sm">حداکثر سود ریالی</span>
                <div class="font-bold text-secondary mt-1">${fNEn(mp)} R</div>
            </div>
            <div class="bg-surface-container-low p-2 rounded text-center font-mono">
                <span class="text-[10px] text-on-surface-variant font-body-sm">نقطه سر به سر</span>
                <div class="font-bold text-primary mt-1">${fNEn(be)} R</div>
            </div>
            <div class="bg-surface-container-low p-2 rounded text-center font-mono">
                <span class="text-[10px] text-on-surface-variant font-body-sm">سود کل %</span>
                <div class="font-bold text-secondary mt-1">+${f1(tpct)}٪</div>
            </div>
            <div class="bg-surface-container-low p-2 rounded text-center font-mono">
                <span class="text-[10px] text-on-surface-variant font-body-sm">سود ماهانه %</span>
                <div class="font-bold text-secondary mt-1">+${f1(mpct)}٪</div>
            </div>
            <div class="bg-surface-container-low p-2 rounded text-center font-mono">
                <span class="text-[10px] text-on-surface-variant font-body-sm">حاشیه امنیت (درصد پرمیوم)</span>
                <div class="font-bold text-tertiary mt-1">+${f1(spct)}٪</div>
            </div>
        `;
    } else if (_cmType === 'collar') {
        const S = g('cm-S'), Kc = g('cm-Kc'), Kp = g('cm-Kp'), Pc = g('cm-Pc'), Pp = g('cm-Pp');
        const netP = Pc - Pp;
        const mp = Kc - S + netP;
        const ml = Kp - S + netP;
        const be = S - netP;
        const profPct = S > 0 ? (mp / S) * 100 : 0;
        const lossPct = S > 0 ? (ml / S) * 100 : 0;

        html = `
            <div class="bg-surface-container-low p-2 rounded text-center font-mono">
                <span class="text-[10px] text-on-surface-variant font-body-sm">خالص پرمیوم</span>
                <div class="font-bold ${netP >= 0 ? 'text-secondary' : 'text-error'} mt-1">${netP >= 0 ? '+' : ''}${fNEn(netP)} R</div>
            </div>
            <div class="bg-surface-container-low p-2 rounded text-center font-mono">
                <span class="text-[10px] text-on-surface-variant font-body-sm">سقف سود</span>
                <div class="font-bold text-secondary mt-1">+${f1(profPct)}٪ (${fNEn(mp)} R)</div>
            </div>
            <div class="bg-surface-container-low p-2 rounded text-center font-mono">
                <span class="text-[10px] text-on-surface-variant font-body-sm">کف ضرر مجاز</span>
                <div class="font-bold text-error mt-1">${f1(lossPct)}٪ (${fNEn(ml)} R)</div>
            </div>
            <div class="bg-surface-container-low p-2 rounded text-center font-mono">
                <span class="text-[10px] text-on-surface-variant font-body-sm">سر به سر</span>
                <div class="font-bold text-primary mt-1">${fNEn(be)} R</div>
            </div>
        `;
    } else if (_cmType === 'conversion') {
        const S = g('cm-S'), K = g('cm-K'), Pc = g('cm-Pc'), Pp = g('cm-Pp'), days = g('cm-days');
        const netCost = S + Pp - Pc;
        const profit = K - netCost;
        const retPct = netCost > 0 ? (profit / netCost) * 100 : 0;
        const annualPct = days > 0 ? (retPct / days) * 365 : 0;

        html = `
            <div class="bg-surface-container-low p-2 rounded text-center font-mono">
                <span class="text-[10px] text-on-surface-variant font-body-sm">هزینه اولیه خرید موقعیت</span>
                <div class="font-bold text-primary mt-1">${fNEn(netCost)} R</div>
            </div>
            <div class="bg-surface-container-low p-2 rounded text-center font-mono">
                <span class="text-[10px] text-on-surface-variant font-body-sm">سود قفل‌شده قطعی</span>
                <div class="font-bold text-secondary mt-1">${fNEn(profit)} R</div>
            </div>
            <div class="bg-surface-container-low p-2 rounded text-center font-mono">
                <span class="text-[10px] text-on-surface-variant font-body-sm">بازده کل %</span>
                <div class="font-bold text-secondary mt-1">+${f1(retPct)}٪</div>
            </div>
            <div class="bg-surface-container-low p-2 rounded text-center font-mono">
                <span class="text-[10px] text-on-surface-variant font-body-sm">بازده معادل سالانه %</span>
                <div class="font-bold text-secondary mt-1">+${f1(annualPct)}٪</div>
            </div>
        `;
    }
    res.innerHTML = html;
}

/* ══════════════════════════════════════════════════════════════
   BASKET & ORDER DRAFTING
   ══════════════════════════════════════════════════════════════ */

function addCurrentSpreadToBasket() {
    const k1 = document.getElementById('calcK1').value;
    const k2 = document.getElementById('calcK2').value;
    const ask = document.getElementById('calcAsk').value;
    const bid = document.getElementById('calcBid').value;
    const contracts = document.getElementById('calcContracts').value;
    const asset = document.getElementById('calcAssetTag').innerText.replace('(بارگذاری شد)', '').replace('(فعال)', '').trim();

    orderBasket.push({
        id: Date.now(),
        type: 'Bull Call Spread',
        symbol: asset,
        leg1: `خرید کال K₁=${k1} (قیمت: ${ask})`,
        leg2: `فروش کال K₂=${k2} (قیمت: ${bid})`,
        contracts: contracts
    });

    updateBasketUI();
    openBasketModal();
    playTone(650, 'sine', 0.12);
}

function openOrderModal(symbol, sym1, sym2, k1, k2, p1, p2) {
    orderBasket.push({
        id: Date.now(),
        type: 'سفارش دوپایه Bull Call',
        symbol: symbol,
        leg1: `خرید ${sym1} (K₁: ${k1}, Ask: ${p1})`,
        leg2: `فروش ${sym2} (K₂: ${k2}, Bid: ${p2})`,
        contracts: 10
    });
    updateBasketUI();
    openBasketModal();
    playTone(550, 'sine', 0.1);
}

function updateBasketUI() {
    const countEl = document.getElementById('basket-count');
    if (countEl) countEl.textContent = orderBasket.length.toLocaleString('fa-IR');

    const emptyEl = document.getElementById('basket-empty');
    const listEl = document.getElementById('basket-items-list');

    if (!emptyEl || !listEl) return;

    if (orderBasket.length === 0) {
        emptyEl.classList.remove('hidden');
        listEl.classList.add('hidden');
    } else {
        emptyEl.classList.add('hidden');
        listEl.classList.remove('hidden');

        listEl.innerHTML = orderBasket.map((item, idx) => `
            <div class="bg-surface-container-low p-3 rounded-lg border border-outline-variant/30 flex items-center justify-between font-mono text-[12px]">
                <div class="flex flex-col gap-0.5">
                    <div class="flex items-center gap-1 font-bold font-title-md text-primary">
                        <span>${item.symbol}</span>
                        <span class="text-[11px] text-on-surface-variant">(${item.type})</span>
                    </div>
                    <div class="text-on-surface">${item.leg1}</div>
                    <div class="text-on-surface-variant">${item.leg2}</div>
                    <div class="text-secondary font-bold">تعداد: ${item.contracts} قرارداد</div>
                </div>
                <button onclick="removeBasketItem(${item.id})" class="text-error hover:underline p-1 cursor-pointer font-body-sm">
                    حذف
                </button>
            </div>
        `).join('');
    }
}

function openBasketModal() {
    const m = document.getElementById('basket-modal');
    if (m) m.classList.remove('hidden');
}

function closeBasketModal() {
    const m = document.getElementById('basket-modal');
    if (m) m.classList.add('hidden');
}

function removeBasketItem(id) {
    orderBasket = orderBasket.filter(x => x.id !== id);
    updateBasketUI();
}

function clearBasket() {
    orderBasket = [];
    updateBasketUI();
}

/* ══════════════════════════════════════════════════════════════
   SETTINGS MODAL
   ══════════════════════════════════════════════════════════════ */

function openSettingsModal() {
    document.getElementById('setting-rf').value = rfRate;
    document.getElementById('setting-iv').value = ivAvg;
    document.getElementById('setting-refresh-sec').value = cdMax;
    document.getElementById('settings-modal').classList.remove('hidden');
}

function closeSettingsModal() {
    document.getElementById('settings-modal').classList.add('hidden');
}

function saveSettings() {
    rfRate = parseFloat(document.getElementById('setting-rf').value) || 28.5;
    ivAvg = parseFloat(document.getElementById('setting-iv').value) || 41.2;
    cdMax = parseInt(document.getElementById('setting-refresh-sec').value) || 60;
    cdSec = cdMax;

    document.getElementById('bcs-rf-rate').textContent = `${rfRate}٪`;
    document.getElementById('bcs-iv-avg').textContent = `${ivAvg}٪`;

    closeSettingsModal();
    recalcSpread();
    playTone(500, 'sine', 0.1);
}

/* ══════════════════════════════════════════════════════════════
   BOOT APPLICATION & TIMER
   ══════════════════════════════════════════════════════════════ */

function startCD() {
    clearInterval(cdInt);
    cdSec = cdMax;
    cdInt = setInterval(() => {
        cdSec--;
        const cdEl = document.getElementById('cd');
        if (cdEl) cdEl.textContent = `${cdSec}s`;

        const circle = document.getElementById('cd-circle');
        if (circle) {
            const pct = Math.max(0, Math.min(100, Math.round((cdSec / cdMax) * 100)));
            circle.setAttribute('stroke-dasharray', `${pct}, 100`);
        }

        if (cdSec <= 0) {
            cdSec = cdMax;
            loadLiveData(false);
        }
    }, 1000);
}

function bootTerminal() {
    initTheme();
    loadLiveData(true);
    startCD();
    recalcSpread();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootTerminal);
} else {
    bootTerminal();
}
