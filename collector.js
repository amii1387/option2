import fs from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = path.resolve('data');
const LATEST_FILE = path.join(DATA_DIR, 'latest.json');
const STATUS_FILE = path.join(DATA_DIR, 'status.json');
const MIN_ROWS = 20;
const MIN_VOL = 1000000000;

let isUpdating = false;

function gregorianToJalali(gy, gm, gd) {
    const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    const gy2 = (gm > 2) ? (gy + 1) : gy;
    let days = 355666 + (365 * gy) + Math.floor((gy2 + 3) / 4)
          - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400)
          + gd + g_d_m[gm - 1];
    let jy = -1595 + (33 * Math.floor(days / 12053));
    days %= 12053;
    jy += 4 * Math.floor(days / 1461);
    days %= 1461;
    if (days > 365) {
        jy += Math.floor((days - 1) / 365);
        days = (days - 1) % 365;
    }
    let jm, jd;
    if (days < 186) {
        jm = 1 + Math.floor(days / 31);
        jd = 1 + (days % 31);
    } else {
        jm = 7 + Math.floor((days - 186) / 30);
        jd = 1 + ((days - 186) % 30);
    }
    return [jy, jm, jd];
}

function miladiToJalaliString(iso) {
    try {
        const dt = new Date(iso);
        if (isNaN(dt.getTime())) return '';
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Tehran',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric'
        }).formatToParts(dt);
        const m = {};
        for (const p of parts) m[p.type] = p.value;
        const [jy, jm, jd] = gregorianToJalali(
            parseInt(m.year, 10),
            parseInt(m.month, 10),
            parseInt(m.day, 10)
        );
        return `${String(jy).padStart(4, '0')}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
    } catch {
        return '';
    }
}

function daysLeftToJalaliString(days) {
    if (days <= 0) return '';
    try {
        const now = new Date();
        now.setDate(now.getDate() + days);
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Tehran',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric'
        }).formatToParts(now);
        const m = {};
        for (const p of parts) m[p.type] = p.value;
        const [jy, jm, jd] = gregorianToJalali(
            parseInt(m.year, 10),
            parseInt(m.month, 10),
            parseInt(m.day, 10)
        );
        return `${String(jy).padStart(4, '0')}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
    } catch {
        return '';
    }
}

function extractValue(obj) {
    if (obj === null || obj === undefined) return null;
    if (typeof obj === 'number') return obj;
    if (typeof obj === 'string') {
        const trimmed = obj.trim();
        if (trimmed === '') return null;
        const n = Number(trimmed);
        return isNaN(n) ? null : n;
    }
    if (typeof obj === 'object') {
        const v = obj.value;
        if (v === null || v === undefined || v === '') return null;
        const n = Number(v);
        return isNaN(n) ? null : n;
    }
    return null;
}

function buildRowFromSide(item, side) {
    const p = side; // 'buy' or 'sell'
    const instrumentName = (item[p + 'InstrumentName'] || '').trim();
    if (!instrumentName) return null;

    const stateName = item[p + 'statename'] || '';
    if (stateName.includes('متوقف') || stateName.includes('ممنوع')) {
        return false;
    }

    const strike = extractValue(item[p + 'QeymateEmal']);
    if (strike === null || strike <= 0) return null;

    const last = extractValue(item[p + 'LastPrice']);
    if (last === null || last <= 0) return null;

    const bid = extractValue(item[p + 'BuyPrice']) || 0;
    const ask = p === 'buy'
        ? (extractValue(item['buySellPriceSellPrice']) || 0)
        : (extractValue(item[p + 'SellPrice']) || 0);

    const tradeValue = extractValue(item[p + 'TradeValue']) || 0;
    const tradeVolume = extractValue(item[p + 'TradeVolume']) || 0;
    const basePrice = extractValue(item[p + 'QeymateMabna']) || 0;
    const daysLeft = Math.round(extractValue(item[p + 'BaqimandeTaSarresId']) || 0);
    const expiryMiladi = item[p + 'TarixSarresid'] || null;

    let expiryJalali = '';
    if (expiryMiladi) {
        expiryJalali = miladiToJalaliString(expiryMiladi);
    } else if (daysLeft > 0) {
        expiryJalali = daysLeftToJalaliString(daysLeft);
    }

    return {
        'نماد': instrumentName,
        'قیمت اعمال': strike,
        'تاریخ اعمال': expiryJalali,
        'ارزش معاملات': tradeValue,
        'آخرین قیمت': last,
        'قیمت بهترین تقاضا': bid,
        'قیمت بهترین عرضه': ask,
        '_base': basePrice,
        '_daysLeft': daysLeft,
    };
}

export function normalizeTsetmcTradeOption(response) {
    const items = response?.Items || [];
    if (!Array.isArray(items)) {
        return { rows: [], stats: { total_pairs: 0 } };
    }

    const out = [];
    const stats = {
        total_pairs: 0,
        calls: 0,
        puts: 0,
        skipped_halted: 0,
        skipped_no_last: 0,
        skipped_no_strike: 0,
    };

    for (const item of items) {
        stats.total_pairs++;

        const callResult = buildRowFromSide(item, 'buy');
        if (callResult === false) {
            stats.skipped_halted++;
        } else if (callResult === null) {
            stats.skipped_no_last++;
        } else {
            out.push(callResult);
            stats.calls++;
        }

        const putResult = buildRowFromSide(item, 'sell');
        if (putResult === false) {
            stats.skipped_halted++;
        } else if (putResult === null) {
            stats.skipped_no_last++;
        } else {
            out.push(putResult);
            stats.puts++;
        }
    }

    return { rows: out, stats };
}

function extractUnderlying(sym) {
    const umap = {
        'هرم': 'اهرم', 'خود': 'خودرو', 'سپا': 'خساپا', 'ستا': 'شستا',
        'شنا': 'شپنا', 'ملت': 'وبملت', 'ملی': 'فملی', 'ملي': 'فملي',
        'صاد': 'وبصادر', 'جار': 'وتجارت', 'تاص': 'تاصيكو', 'جوا': 'جوانه كوچك',
        'مخا': 'اخابر', 'همن': 'خبهمن', 'ستر': 'خگستر', 'راز': 'هم تراز',
        'درو': 'دارونو'
    };

    let b = (sym || '').trim();
    const firstChar = b.charAt(0);
    if (firstChar === 'ض' || firstChar === 'ط' || firstChar === 'ح') {
        b = b.substring(1);
    }

    b = b.replace(/[0-9\u0660-\u0669\u06F0-\u06F9]+$/u, '').trim();
    return umap[b] || b;
}

function buildBCS(calls, minVol) {
    const bcs = [];
    const groups = {};

    for (const c of calls) {
        if (c.uprice <= 0) continue;
        const key = `${c.underlying}|${c.expiry}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(c);
    }

    for (const key of Object.keys(groups)) {
        const group = groups[key];
        group.sort((a, b) => a.strike - b.strike);
        const len = group.length;

        for (let i = 0; i < len - 1; i++) {
            for (let j = i + 1; j < len; j++) {
                const buy = group[i];
                const sell = group[j];

                if (buy.volume < minVol || sell.volume < minVol) continue;

                const nd = buy.lastP - sell.lastP;
                if (nd <= 0) continue;

                const ks = sell.strike - buy.strike;
                const mp = ks - nd;
                if (mp <= 0) continue;

                const be = buy.strike + nd;
                const rr = mp / nd;
                const sm = ((buy.uprice - be) / buy.uprice) * 100;

                const ndb = (buy.bid > 0 && sell.ask > 0) ? buy.bid - sell.ask : null;
                const rb = (ndb !== null && ndb > 0) ? (((ks - ndb) / ndb) * 100) : null;

                const ndw = (buy.ask > 0 && sell.bid > 0) ? buy.ask - sell.bid : null;
                const rw = (ndw !== null && ndw > 0) ? (((ks - ndw) / ndw) * 100) : null;

                bcs.push({
                    underlying: buy.underlying, expiry: buy.expiry, days: buy.days,
                    uprice: buy.uprice, k1: buy.strike, k2: sell.strike,
                    sym1: buy.symRaw, sym2: sell.symRaw, p1: buy.lastP, p2: sell.lastP,
                    v1: buy.volume, v2: sell.volume,
                    netDebit: nd, maxProfit: mp, maxLoss: nd, breakeven: be,
                    retBest: rb, retWorst: rw,
                    returnPct: rr * 100, safetyMargin: sm
                });
            }
        }
    }
    return bcs;
}

function buildCC(calls) {
    const cc = [];
    for (const c of calls) {
        if (c.uprice <= 0 || c.days <= 0) continue;

        const tp = c.strike + c.lastP - c.uprice;
        if (tp <= 0) continue;

        const status = c.strike > c.uprice * 1.02 ? 'OTM' : (c.strike < c.uprice * 0.98 ? 'ITM' : 'ATM');

        cc.push({
            symRaw: c.symRaw, underlying: c.underlying, expiry: c.expiry,
            days: c.days, uprice: c.uprice, strike: c.strike,
            premium: c.lastP, volume: c.volume,
            tpct: (tp / c.uprice) * 100,
            mpct: ((tp / c.uprice) * 100) / c.days * 30,
            breakeven: c.uprice - c.lastP,
            spct: (c.lastP / c.uprice) * 100,
            mpStartPct: ((c.strike - c.uprice) / c.uprice) * 100,
            status
        });
    }
    return cc;
}

function buildCollar(calls, puts, minVol) {
    const collar = [];
    const putMap = {};

    for (const p of puts) {
        if (p.uprice <= 0) continue;
        const key = `${p.underlying}|${p.expiry}`;
        if (!putMap[key]) putMap[key] = [];
        putMap[key].push(p);
    }

    for (const c of calls) {
        if (c.uprice <= 0 || c.volume < minVol) continue;

        const key = `${c.underlying}|${c.expiry}`;
        if (!putMap[key]) continue;

        for (const p of putMap[key]) {
            if (p.strike >= c.strike) continue;

            const netP = c.lastP - p.lastP;
            const maxProfit = c.strike - c.uprice + netP;
            if (maxProfit <= 0) continue;

            const maxLoss = p.strike - c.uprice + netP;

            collar.push({
                callSym: c.symRaw, putSym: p.symRaw, underlying: c.underlying,
                expiry: c.expiry, days: c.days, uprice: c.uprice,
                Kc: c.strike, Kp: p.strike, Pc: c.lastP, Pp: p.lastP,
                netP, maxProfit, maxLoss,
                breakeven: c.uprice - netP,
                profitPct: (maxProfit / c.uprice) * 100,
                lossPct: (maxLoss / c.uprice) * 100,
                livePnLPct: (netP / c.uprice) * 100,
                callVol: c.volume, putVol: p.volume
            });
        }
    }
    return collar;
}

function buildConversion(calls, puts, minVol) {
    const conv = [];
    const putMap = {};

    for (const p of puts) {
        if (p.uprice <= 0) continue;
        const key = `${p.underlying}|${p.expiry}|${p.strike}`;
        putMap[key] = p;
    }

    for (const c of calls) {
        if (c.uprice <= 0 || c.days <= 0 || c.volume < minVol) continue;

        const key = `${c.underlying}|${c.expiry}|${c.strike}`;
        if (!putMap[key]) continue;

        const p = putMap[key];
        const netCost = c.uprice + p.lastP - c.lastP;
        if (netCost <= 0) continue;

        const profit = c.strike - netCost;
        if (profit <= 0) continue;

        const retPct = (profit / netCost) * 100;

        conv.push({
            underlying: c.underlying, callSym: c.symRaw, putSym: p.symRaw,
            expiry: c.expiry, days: c.days, uprice: c.uprice,
            strike: c.strike, Pc: c.lastP, Pp: p.lastP,
            netCost, profit, retPct,
            annualPct: (retPct / c.days) * 365,
            monthlyPct: (retPct / c.days) * 30,
            callVol: c.volume, putVol: p.volume
        });
    }
    return conv;
}

export function calculateStrategies(rows) {
    const calls = [];
    const puts = [];

    for (const row of rows) {
        const sym = (row['نماد'] || '').trim();
        const isCall = sym.startsWith('ض');
        const item = {
            underlying: extractUnderlying(sym),
            expiry: row['تاریخ اعمال'],
            days: row['_daysLeft'],
            uprice: row['_base'],
            strike: row['قیمت اعمال'],
            lastP: row['آخرین قیمت'],
            symRaw: sym,
            volume: row['ارزش معاملات'],
            bid: row['قیمت بهترین تقاضا'],
            ask: row['قیمت بهترین عرضه'],
        };

        if (isCall && item.strike > 0 && item.lastP > 0) {
            calls.push(item);
        } else if (!isCall && item.strike > 0 && item.lastP > 0 && item.volume >= MIN_VOL) {
            puts.push(item);
        }
    }

    return {
        bcs: buildBCS(calls, MIN_VOL),
        cc: buildCC(calls),
        collar: buildCollar(calls, puts, MIN_VOL),
        conversion: buildConversion(calls, puts, MIN_VOL)
    };
}

export function getTehranDateString() {
    const d = new Date();
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Tehran',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).formatToParts(d);
    const m = {};
    for (const p of parts) m[p.type] = p.value;
    return `${m.year}-${m.month}-${m.day} ${m.hour}:${m.minute}:${m.second}`;
}

async function writeAtomic(filePath, content) {
    const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
    await fs.writeFile(tmp, content, 'utf-8');
    await fs.rename(tmp, filePath);
}

export async function fetchAndProcessTsetmc() {
    if (isUpdating) {
        return { ok: false, message: 'بروزرسانی در پس‌زمینه در حال انجام است.' };
    }
    isUpdating = true;

    try {
        await fs.mkdir(DATA_DIR, { recursive: true });

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 25000);

        let parsed;
        try {
            const res = await fetch('https://webgw.tse.ir/InstrumentProvider/api/v1/MarketWatch/MarketWatchTradeOption/fa', {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'application/json, text/plain, */*',
                    'Accept-Language': 'fa-IR,fa;q=0.9,en;q=0.8',
                    'Referer': 'https://www.tse.ir/',
                },
                signal: controller.signal
            });
            if (!res.ok) throw new Error(`TSETMC HTTP ${res.status}`);
            parsed = await res.json();
        } finally {
            clearTimeout(timeout);
        }

        const result = normalizeTsetmcTradeOption(parsed);
        const rows = result.rows;
        const stats = result.stats;

        if (rows.length < MIN_ROWS) {
            throw new Error(`Too few rows: ${rows.length}`);
        }

        const strategies = calculateStrategies(rows);
        const nowTs = Math.floor(Date.now() / 1000);
        const nowStr = getTehranDateString();

        const payload = {
            meta: {
                updated_at: nowStr,
                updated_ts: nowTs,
                source: 'TSETMC MarketWatchTradeOption',
                rows: rows.length,
                stats
            },
            data: strategies
        };

        await writeAtomic(LATEST_FILE, JSON.stringify(payload));
        await writeAtomic(STATUS_FILE, JSON.stringify({
            success: true,
            last_success: nowStr,
            rows: rows.length
        }));

        return { ok: true, message: 'بروزرسانی با موفقیت انجام شد' };
    } catch (err) {
        let prev = {};
        try {
            prev = JSON.parse(await fs.readFile(STATUS_FILE, 'utf-8'));
        } catch {}

        const nowStr = getTehranDateString();
        try {
            await writeAtomic(STATUS_FILE, JSON.stringify({
                success: false,
                last_success: prev.last_success || null,
                error: err.message,
                at: nowStr
            }));
        } catch {}

        return { ok: false, message: err.message };
    } finally {
        isUpdating = false;
    }
}
