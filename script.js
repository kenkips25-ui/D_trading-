(() => {
    "use strict";

    const TICK_MS = 1000;
    const TICKS_PER_CANDLE = 12;

    const TIMEFRAMES = {
        "1m": 60e3,
        "5m": 300e3,
        "15m": 900e3,
        "1h": 3600e3,
        "4h": 14400e3,
        "1d": 86400e3,
    };

    const MARKETS = [
        { base: "BTC", name: "Bitcoin", price: 64230.5, vol: 0.0016, dec: 2, qtyDec: 5 },
        { base: "ETH", name: "Ethereum", price: 3120.4, vol: 0.0019, dec: 2, qtyDec: 4 },
        { base: "SOL", name: "Solana", price: 148.22, vol: 0.0026, dec: 2, qtyDec: 3 },
        { base: "AVAX", name: "Avalanche", price: 34.87, vol: 0.0028, dec: 3, qtyDec: 2 },
        { base: "LINK", name: "Chainlink", price: 17.42, vol: 0.0024, dec: 3, qtyDec: 2 },
        { base: "DOGE", name: "Dogecoin", price: 0.1634, vol: 0.0032, dec: 5, qtyDec: 0 },
    ].map((m) => {
        const open24 = m.price * (1 + gaussian() * 0.025);
        return {
            ...m,
            pair: `${m.base}/USD`,
            open24,
            high24: Math.max(m.price, open24) * (1 + Math.random() * 0.01),
            low24: Math.min(m.price, open24) * (1 - Math.random() * 0.01),
            volume24: m.price * (2e4 + Math.random() * 8e4) / Math.sqrt(m.price),
        };
    });

    const state = {
        market: MARKETS[0],
        timeframe: "15m",
        candles: [],
        tickCount: 0,
        hover: null,
        side: "buy",
        orderType: "limit",
        priceEdited: false,
        balances: { USD: 25000, BTC: 0.25, ETH: 3, SOL: 20, AVAX: 0, LINK: 0, DOGE: 0 },
        openOrders: [],
        history: [],
        trades: [],
        nextOrderId: 1,
    };

    const $ = (id) => document.getElementById(id);
    const el = {
        symbolName: $("symbolName"),
        lastPrice: $("lastPrice"),
        change24: $("change24"),
        high24: $("high24"),
        low24: $("low24"),
        vol24: $("vol24"),
        ohlc: $("ohlc"),
        canvas: $("tradingChart"),
        chart: $("chart"),
        asks: $("asks"),
        bids: $("bids"),
        bookPrice: $("bookPrice"),
        spread: $("spread"),
        trades: $("trades"),
        watchlist: $("watchlist"),
        form: $("orderForm"),
        priceInput: $("priceInput"),
        amountInput: $("amountInput"),
        baseUnit: $("baseUnit"),
        available: $("available"),
        orderTotal: $("orderTotal"),
        formError: $("formError"),
        submitBtn: $("submitBtn"),
        openOrders: $("openOrders"),
        openCount: $("openCount"),
        orderHistory: $("orderHistory"),
        balances: $("balances"),
        toasts: $("toasts"),
    };

    /* ---------- Helpers ---------- */

    function gaussian() {
        let u = 0;
        let v = 0;
        while (u === 0) u = Math.random();
        while (v === 0) v = Math.random();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }

    const formatters = new Map();
    function fmt(n, dec = 2) {
        const key = dec;
        if (!formatters.has(key)) {
            formatters.set(key, new Intl.NumberFormat("en-US", {
                minimumFractionDigits: dec,
                maximumFractionDigits: dec,
            }));
        }
        return formatters.get(key).format(n);
    }

    const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });
    const usd = (n, dec = 2) => `$${fmt(n, dec)}`;
    const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    const axisTimeFmt = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    const axisDateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }

    function cssVar(name) {
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }

    const colors = {
        up: cssVar("--up"),
        down: cssVar("--down"),
        text: cssVar("--text"),
        muted: cssVar("--muted"),
        border: cssVar("--border"),
        surface: cssVar("--surface"),
        accent: cssVar("--accent"),
    };

    /* ---------- Market data simulation ---------- */

    function generateCandles(market, timeframe, count = 160) {
        const interval = TIMEFRAMES[timeframe];
        const tfScale = Math.sqrt(interval / TIMEFRAMES["1m"]) * 0.6;
        const vol = market.vol * tfScale;
        const candles = [];
        let price = market.price;
        const now = Math.floor(Date.now() / interval) * interval;

        for (let i = 0; i < count; i++) {
            const o = price;
            const c = o * (1 + gaussian() * vol);
            const h = Math.max(o, c) * (1 + Math.random() * vol * 0.6);
            const l = Math.min(o, c) * (1 - Math.random() * vol * 0.6);
            const v = (0.4 + Math.random()) * (1 + Math.abs(c - o) / o / vol);
            candles.push({ t: now - (count - 1 - i) * interval, o, h, l, c, v });
            price = c;
        }

        const scale = market.price / price;
        for (const k of candles) {
            k.o *= scale;
            k.h *= scale;
            k.l *= scale;
            k.c *= scale;
        }
        return candles;
    }

    function stepMarket(m) {
        const next = m.price * (1 + gaussian() * m.vol * 0.35);
        m.price = Math.max(next, 10 ** -m.dec);
        m.high24 = Math.max(m.high24, m.price);
        m.low24 = Math.min(m.low24, m.price);
        m.volume24 += Math.random() * m.price * 0.2;
    }

    function tick() {
        const prev = state.market.price;
        MARKETS.forEach(stepMarket);
        const m = state.market;

        const last = state.candles[state.candles.length - 1];
        state.tickCount++;
        if (state.tickCount % TICKS_PER_CANDLE === 0) {
            state.candles.push({ t: last.t + TIMEFRAMES[state.timeframe], o: last.c, h: Math.max(last.c, m.price), l: Math.min(last.c, m.price), c: m.price, v: 0.3 });
            if (state.candles.length > 400) state.candles.shift();
        } else {
            last.c = m.price;
            last.h = Math.max(last.h, m.price);
            last.l = Math.min(last.l, m.price);
            last.v += Math.random() * 0.15;
        }

        addMarketTrades(m, prev);
        matchOpenOrders();
        renderTicker(prev);
        renderBook();
        renderTrades();
        renderWatchlist();
        renderAvailable();
        if (state.orderType === "market" || !state.priceEdited) syncPriceInput();
        drawChart();
    }

    function addMarketTrades(m, prev) {
        const count = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < count; i++) {
            const price = m.price * (1 + gaussian() * m.vol * 0.05);
            state.trades.unshift({
                price,
                size: (Math.random() ** 2) * (2000 / m.price) * 5,
                side: price >= prev ? "buy" : "sell",
                time: Date.now(),
                fresh: true,
            });
        }
        state.trades.length = Math.min(state.trades.length, 24);
    }

    /* ---------- Rendering ---------- */

    function renderTicker(prev) {
        const m = state.market;
        const change = ((m.price - m.open24) / m.open24) * 100;
        el.symbolName.textContent = m.pair;
        el.lastPrice.textContent = usd(m.price, m.dec);
        if (prev !== undefined && prev !== m.price) {
            el.lastPrice.className = `price mono ${m.price > prev ? "up" : "down"}`;
        }
        el.change24.textContent = `${change >= 0 ? "+" : ""}${fmt(change, 2)}%`;
        el.change24.className = `change mono ${change >= 0 ? "up" : "down"}`;
        el.high24.textContent = fmt(m.high24, m.dec);
        el.low24.textContent = fmt(m.low24, m.dec);
        el.vol24.textContent = `$${compact.format(m.volume24 * m.price / 50)}`;
        document.title = `${fmt(m.price, m.dec)} ${m.pair} · TradePro`;
    }

    function renderBook() {
        const m = state.market;
        const step = m.price * 0.00012;
        const rows = 11;
        const unit = 1500 / m.price;
        const asks = [];
        const bids = [];
        let askTotal = 0;
        let bidTotal = 0;

        for (let i = 0; i < rows; i++) {
            const askSize = (0.2 + Math.random() ** 2 * 3) * unit;
            const bidSize = (0.2 + Math.random() ** 2 * 3) * unit;
            askTotal += askSize;
            bidTotal += bidSize;
            asks.push({ price: m.price + step * (i + 1 + Math.random() * 0.3), size: askSize, total: askTotal });
            bids.push({ price: m.price - step * (i + 1 + Math.random() * 0.3), size: bidSize, total: bidTotal });
        }

        const maxTotal = Math.max(askTotal, bidTotal);
        const row = (r) =>
            `<li style="--depth:${(r.total / maxTotal) * 100}%" data-price="${r.price}"><span>${fmt(r.price, m.dec)}</span><span>${fmt(r.size, Math.max(m.qtyDec, 2))}</span><span>${fmt(r.total, Math.max(m.qtyDec, 2))}</span></li>`;

        el.asks.innerHTML = asks.slice().reverse().map(row).join("");
        el.bids.innerHTML = bids.map(row).join("");
        el.bookPrice.textContent = fmt(m.price, m.dec);
        el.bookPrice.className = el.lastPrice.classList.contains("down") ? "down" : "up";
        const spread = asks[0].price - bids[0].price;
        el.spread.textContent = `Spread ${fmt(spread, m.dec)} (${fmt((spread / m.price) * 100, 3)}%)`;
    }

    function renderTrades() {
        const m = state.market;
        el.trades.innerHTML = state.trades
            .map((t) => {
                const cls = t.fresh ? ' class="new"' : "";
                t.fresh = false;
                return `<li${cls}><span class="${t.side === "buy" ? "up" : "down"}">${fmt(t.price, m.dec)}</span><span>${fmt(t.size, Math.max(m.qtyDec, 2))}</span><span>${timeFmt.format(t.time)}</span></li>`;
            })
            .join("");
    }

    function renderWatchlist() {
        el.watchlist.innerHTML = MARKETS.map((m) => {
            const change = ((m.price - m.open24) / m.open24) * 100;
            const dir = change >= 0 ? "up" : "down";
            const current = m === state.market;
            return `<li><button type="button" class="watch-item" data-base="${m.base}" aria-current="${current}">
                <span class="sym">${m.pair}<small>${m.name}</small></span>
                <span class="wprice mono">${fmt(m.price, m.dec)}</span>
                <span class="wchg mono ${dir}">${change >= 0 ? "+" : ""}${fmt(change, 2)}%</span>
            </button></li>`;
        }).join("");
    }

    function renderOrders() {
        el.openCount.textContent = state.openOrders.length;
        el.openOrders.innerHTML = state.openOrders.length
            ? state.openOrders
                  .map((o) => {
                      const m = MARKETS.find((x) => x.base === o.base);
                      return `<tr>
                        <td>${timeFmt.format(o.time)}</td>
                        <td>${m.pair}</td>
                        <td class="${o.side === "buy" ? "up" : "down"}">${o.side.toUpperCase()}</td>
                        <td>${fmt(o.price, m.dec)}</td>
                        <td>${fmt(o.amount, m.qtyDec)}</td>
                        <td>${usd(o.price * o.amount)}</td>
                        <td><button type="button" class="cancel-btn" data-cancel="${o.id}" aria-label="Cancel ${o.side} order for ${fmt(o.amount, m.qtyDec)} ${m.base}">Cancel</button></td>
                    </tr>`;
                  })
                  .join("")
            : `<tr><td colspan="7" class="empty">No open orders</td></tr>`;

        el.orderHistory.innerHTML = state.history.length
            ? state.history
                  .map((o) => {
                      const m = MARKETS.find((x) => x.base === o.base);
                      return `<tr>
                        <td>${timeFmt.format(o.time)}</td>
                        <td>${m.pair}</td>
                        <td class="${o.side === "buy" ? "up" : "down"}">${o.side.toUpperCase()}</td>
                        <td>${o.type}</td>
                        <td>${fmt(o.price, m.dec)}</td>
                        <td>${fmt(o.amount, m.qtyDec)}</td>
                        <td class="${o.status === "Filled" ? "up" : "muted"}">${o.status}</td>
                    </tr>`;
                  })
                  .join("")
            : `<tr><td colspan="7" class="empty">No order history yet</td></tr>`;

        renderBalances();
    }

    function lockedIn(asset) {
        return state.openOrders.reduce((sum, o) => {
            if (asset === "USD" && o.side === "buy") return sum + o.price * o.amount;
            if (asset === o.base && o.side === "sell") return sum + o.amount;
            return sum;
        }, 0);
    }

    function renderBalances() {
        const assets = ["USD", ...MARKETS.map((m) => m.base)];
        el.balances.innerHTML = assets
            .map((a) => {
                const m = MARKETS.find((x) => x.base === a);
                const dec = m ? Math.max(m.qtyDec, 2) : 2;
                const free = state.balances[a];
                const locked = lockedIn(a);
                const value = (free + locked) * (m ? m.price : 1);
                return `<tr><td>${a}</td><td>${fmt(free, dec)}</td><td>${fmt(locked, dec)}</td><td>${usd(value)}</td></tr>`;
            })
            .join("");
    }

    function renderAvailable() {
        const m = state.market;
        el.available.textContent = state.side === "buy"
            ? `${fmt(state.balances.USD, 2)} USD`
            : `${fmt(state.balances[m.base], Math.max(m.qtyDec, 2))} ${m.base}`;
        updateTotal();
    }

    /* ---------- Chart ---------- */

    const ctx = el.canvas.getContext("2d");
    let chartSize = { w: 0, h: 0 };

    function resizeCanvas() {
        const rect = el.chart.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        chartSize = { w: rect.width, h: rect.height };
        el.canvas.width = Math.round(rect.width * dpr);
        el.canvas.height = Math.round(rect.height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawChart();
    }

    function chartLayout() {
        const { w, h } = chartSize;
        const pad = { top: 12, right: 72, bottom: 24, left: 8 };
        const plotW = w - pad.left - pad.right;
        const plotH = h - pad.top - pad.bottom;
        const count = Math.max(10, Math.min(state.candles.length, Math.floor(plotW / 9)));
        const visible = state.candles.slice(-count);
        const slot = plotW / count;

        let max = -Infinity;
        let min = Infinity;
        let maxVol = 0;
        for (const k of visible) {
            max = Math.max(max, k.h);
            min = Math.min(min, k.l);
            maxVol = Math.max(maxVol, k.v);
        }
        const range = max - min || max * 0.01;
        max += range * 0.08;
        min -= range * 0.08;

        const priceH = plotH * 0.8;
        const y = (p) => pad.top + ((max - p) / (max - min)) * priceH;
        const x = (i) => pad.left + slot * i + slot / 2;
        return { w, h, pad, plotW, plotH, priceH, visible, slot, max, min, maxVol, x, y };
    }

    function drawChart() {
        if (!chartSize.w || !state.candles.length) return;
        const L = chartLayout();
        const { w, h, pad, plotW, plotH, priceH, visible, slot, max, min, maxVol, x, y } = L;
        const m = state.market;

        ctx.clearRect(0, 0, w, h);
        ctx.font = `11px ${cssVar("--font-mono")}`;
        ctx.textBaseline = "middle";

        ctx.strokeStyle = colors.border;
        ctx.lineWidth = 1;
        ctx.fillStyle = colors.muted;
        ctx.textAlign = "left";
        const lines = 6;
        for (let i = 0; i <= lines; i++) {
            const p = min + ((max - min) * i) / lines;
            const yy = Math.round(y(p)) + 0.5;
            ctx.beginPath();
            ctx.moveTo(pad.left, yy);
            ctx.lineTo(pad.left + plotW, yy);
            ctx.stroke();
            ctx.fillText(fmt(p, m.dec), pad.left + plotW + 8, yy);
        }

        ctx.textAlign = "center";
        const labelEvery = Math.max(1, Math.ceil(90 / slot));
        const daily = TIMEFRAMES[state.timeframe] >= TIMEFRAMES["4h"];
        visible.forEach((k, i) => {
            if ((visible.length - 1 - i) % labelEvery !== 0) return;
            const xx = Math.round(x(i)) + 0.5;
            ctx.strokeStyle = colors.border;
            ctx.beginPath();
            ctx.moveTo(xx, pad.top);
            ctx.lineTo(xx, pad.top + plotH);
            ctx.stroke();
            ctx.fillStyle = colors.muted;
            ctx.fillText(daily ? axisDateFmt.format(k.t) : axisTimeFmt.format(k.t), xx, h - pad.bottom / 2);
        });

        const bodyW = Math.max(1, slot * 0.68);
        const volTop = pad.top + priceH;
        const volH = plotH - priceH;
        visible.forEach((k, i) => {
            const up = k.c >= k.o;
            const color = up ? colors.up : colors.down;
            const cx = Math.round(x(i)) + 0.5;

            ctx.globalAlpha = 0.3;
            ctx.fillStyle = color;
            const vh = (k.v / maxVol) * (volH - 4);
            ctx.fillRect(cx - bodyW / 2, volTop + volH - vh, bodyW, vh);
            ctx.globalAlpha = 1;

            ctx.strokeStyle = color;
            ctx.beginPath();
            ctx.moveTo(cx, y(k.h));
            ctx.lineTo(cx, y(k.l));
            ctx.stroke();

            const top = y(Math.max(k.o, k.c));
            const bh = Math.max(1, Math.abs(y(k.o) - y(k.c)));
            ctx.fillRect(cx - bodyW / 2, top, bodyW, bh);
        });

        const last = visible[visible.length - 1];
        const lastUp = last.c >= last.o;
        const ly = Math.round(y(last.c)) + 0.5;
        ctx.strokeStyle = lastUp ? colors.up : colors.down;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(pad.left, ly);
        ctx.lineTo(pad.left + plotW, ly);
        ctx.stroke();
        ctx.setLineDash([]);
        drawAxisTag(fmt(last.c, m.dec), ly, lastUp ? colors.up : colors.down, lastUp ? "#04140d" : "#fff", L);

        if (state.hover) {
            const idx = Math.min(visible.length - 1, Math.max(0, Math.floor((state.hover.x - pad.left) / slot)));
            const hx = Math.round(x(idx)) + 0.5;
            const hy = Math.min(Math.max(state.hover.y, pad.top), pad.top + priceH);
            ctx.strokeStyle = colors.muted;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(hx, pad.top);
            ctx.lineTo(hx, pad.top + plotH);
            ctx.moveTo(pad.left, hy);
            ctx.lineTo(pad.left + plotW, hy);
            ctx.stroke();
            ctx.setLineDash([]);
            const hoverPrice = max - ((hy - pad.top) / priceH) * (max - min);
            drawAxisTag(fmt(hoverPrice, m.dec), hy, colors.accent, "#fff", L);
            renderOhlc(visible[idx]);
        } else {
            renderOhlc(last);
        }
    }

    function drawAxisTag(text, yy, bg, fg, L) {
        const tagX = L.pad.left + L.plotW + 2;
        ctx.fillStyle = bg;
        ctx.fillRect(tagX, yy - 9, L.pad.right - 4, 18);
        ctx.fillStyle = fg;
        ctx.textAlign = "left";
        ctx.fillText(text, tagX + 6, yy);
    }

    function renderOhlc(k) {
        const m = state.market;
        const change = ((k.c - k.o) / k.o) * 100;
        const cls = change >= 0 ? "up" : "down";
        el.ohlc.innerHTML =
            `<span>O <b class="${cls}">${fmt(k.o, m.dec)}</b></span>` +
            `<span>H <b class="${cls}">${fmt(k.h, m.dec)}</b></span>` +
            `<span>L <b class="${cls}">${fmt(k.l, m.dec)}</b></span>` +
            `<span>C <b class="${cls}">${fmt(k.c, m.dec)}</b></span>` +
            `<span class="${cls}">${change >= 0 ? "+" : ""}${fmt(change, 2)}%</span>`;
    }

    el.canvas.addEventListener("pointermove", (e) => {
        const rect = el.canvas.getBoundingClientRect();
        state.hover = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        drawChart();
    });
    el.canvas.addEventListener("pointerleave", () => {
        state.hover = null;
        drawChart();
    });

    new ResizeObserver(resizeCanvas).observe(el.chart);

    /* ---------- Order entry ---------- */

    function syncPriceInput() {
        el.priceInput.value = state.market.price.toFixed(state.market.dec);
        updateTotal();
    }

    function effectivePrice() {
        return state.orderType === "market" ? state.market.price : parseFloat(el.priceInput.value);
    }

    function updateTotal() {
        const price = effectivePrice();
        const amount = parseFloat(el.amountInput.value);
        const total = price > 0 && amount > 0 ? price * amount : 0;
        el.orderTotal.textContent = `${state.orderType === "market" && total ? "≈ " : ""}${usd(total)}`;
    }

    function setSide(side) {
        state.side = side;
        document.querySelectorAll(".side-btn").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.side === side)));
        el.submitBtn.className = `btn submit ${side}`;
        el.submitBtn.textContent = `${side === "buy" ? "Buy" : "Sell"} ${state.market.base}`;
        el.formError.textContent = "";
        renderAvailable();
    }

    function setOrderType(type) {
        state.orderType = type;
        document.querySelectorAll("[data-type]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.type === type)));
        el.priceInput.disabled = type === "market";
        if (type === "market") state.priceEdited = false;
        syncPriceInput();
    }

    function selectMarket(base) {
        const m = MARKETS.find((x) => x.base === base);
        if (!m || m === state.market) return;
        state.market = m;
        state.trades = [];
        state.priceEdited = false;
        loadCandles();
        el.baseUnit.textContent = m.base;
        el.amountInput.value = "";
        setSide(state.side);
        syncPriceInput();
        renderTicker();
        renderBook();
        renderTrades();
        renderWatchlist();
    }

    function loadCandles() {
        state.candles = generateCandles(state.market, state.timeframe);
        state.tickCount = 0;
        drawChart();
    }

    function fillOrder(o, price) {
        if (o.side === "buy") {
            state.balances[o.base] += o.amount;
        } else {
            state.balances.USD += price * o.amount;
        }
    }

    function reserve(o) {
        if (o.side === "buy") state.balances.USD -= o.price * o.amount;
        else state.balances[o.base] -= o.amount;
    }

    function release(o) {
        if (o.side === "buy") state.balances.USD += o.price * o.amount;
        else state.balances[o.base] += o.amount;
    }

    function matchOpenOrders() {
        let changed = false;
        state.openOrders = state.openOrders.filter((o) => {
            const m = MARKETS.find((x) => x.base === o.base);
            const hit = o.side === "buy" ? m.price <= o.price : m.price >= o.price;
            if (!hit) return true;
            fillOrder(o, o.price);
            state.history.unshift({ ...o, status: "Filled", time: Date.now() });
            toast(`${o.side === "buy" ? "Bought" : "Sold"} ${fmt(o.amount, m.qtyDec)} ${m.base}`, `Limit filled at ${usd(o.price, m.dec)}`, o.side === "buy" ? "up" : "down");
            changed = true;
            return false;
        });
        if (changed) renderOrders();
    }

    function submitOrder(e) {
        e.preventDefault();
        const m = state.market;
        const price = effectivePrice();
        const amount = parseFloat(el.amountInput.value);
        el.formError.textContent = "";

        if (!(price > 0) || !Number.isFinite(price)) {
            el.formError.textContent = "Enter a valid price.";
            el.priceInput.focus();
            return;
        }
        if (!(amount > 0) || !Number.isFinite(amount)) {
            el.formError.textContent = "Enter an amount greater than zero.";
            el.amountInput.focus();
            return;
        }
        const cost = price * amount;
        if (state.side === "buy" && cost > state.balances.USD + 1e-9) {
            el.formError.textContent = `Insufficient USD. You need ${usd(cost)}.`;
            return;
        }
        if (state.side === "sell" && amount > state.balances[m.base] + 1e-12) {
            el.formError.textContent = `Insufficient ${m.base} balance.`;
            return;
        }

        const order = {
            id: state.nextOrderId++,
            base: m.base,
            side: state.side,
            type: state.orderType === "market" ? "Market" : "Limit",
            price,
            amount,
            time: Date.now(),
        };

        const marketable = state.side === "buy" ? price >= m.price : price <= m.price;
        if (state.orderType === "market" || marketable) {
            const fillPrice = state.orderType === "market" ? m.price : price;
            if (order.side === "buy") state.balances.USD -= fillPrice * amount;
            else state.balances[m.base] -= amount;
            fillOrder(order, fillPrice);
            state.history.unshift({ ...order, price: fillPrice, status: "Filled" });
            toast(`${order.side === "buy" ? "Bought" : "Sold"} ${fmt(amount, m.qtyDec)} ${m.base}`, `Filled at ${usd(fillPrice, m.dec)}`, order.side === "buy" ? "up" : "down");
        } else {
            reserve(order);
            state.openOrders.unshift(order);
            toast("Limit order placed", `${order.side.toUpperCase()} ${fmt(amount, m.qtyDec)} ${m.base} @ ${usd(price, m.dec)}`);
        }

        el.amountInput.value = "";
        renderOrders();
        renderAvailable();
    }

    function cancelOrder(id) {
        const idx = state.openOrders.findIndex((o) => o.id === id);
        if (idx === -1) return;
        const [o] = state.openOrders.splice(idx, 1);
        release(o);
        state.history.unshift({ ...o, status: "Canceled", time: Date.now() });
        toast("Order canceled", `${o.side.toUpperCase()} ${o.base} @ ${usd(o.price, MARKETS.find((x) => x.base === o.base).dec)}`);
        renderOrders();
        renderAvailable();
    }

    function applyPercent(pct) {
        const m = state.market;
        const price = effectivePrice();
        let amount = state.side === "buy"
            ? price > 0 ? (state.balances.USD * pct) / 100 / price : 0
            : (state.balances[m.base] * pct) / 100;
        const factor = 10 ** m.qtyDec;
        amount = Math.floor(amount * factor) / factor;
        el.amountInput.value = amount > 0 ? amount.toFixed(m.qtyDec) : "";
        updateTotal();
    }

    /* ---------- Toasts ---------- */

    function toast(title, body, tone = "") {
        const node = document.createElement("div");
        node.className = `toast ${tone}`;
        node.innerHTML = `<strong>${escapeHtml(title)}</strong><span class="muted">${escapeHtml(body)}</span>`;
        el.toasts.appendChild(node);
        setTimeout(() => node.remove(), 3500);
    }

    /* ---------- Events ---------- */

    document.getElementById("timeframes").addEventListener("click", (e) => {
        const btn = e.target.closest("[data-tf]");
        if (!btn) return;
        state.timeframe = btn.dataset.tf;
        document.querySelectorAll("[data-tf]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
        loadCandles();
    });

    document.querySelectorAll(".side-btn").forEach((b) => b.addEventListener("click", () => setSide(b.dataset.side)));
    document.querySelectorAll("[data-type]").forEach((b) => b.addEventListener("click", () => setOrderType(b.dataset.type)));
    document.querySelectorAll("[data-pct]").forEach((b) => b.addEventListener("click", () => applyPercent(Number(b.dataset.pct))));

    document.querySelectorAll("[data-quick-side]").forEach((b) =>
        b.addEventListener("click", () => {
            setSide(b.dataset.quickSide);
            el.amountInput.focus();
        })
    );

    el.priceInput.addEventListener("input", () => {
        state.priceEdited = true;
        updateTotal();
    });
    el.amountInput.addEventListener("input", updateTotal);
    el.form.addEventListener("submit", submitOrder);

    el.watchlist.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-base]");
        if (btn) selectMarket(btn.dataset.base);
    });

    [el.asks, el.bids].forEach((list) =>
        list.addEventListener("click", (e) => {
            const li = e.target.closest("li[data-price]");
            if (!li || state.orderType === "market") return;
            state.priceEdited = true;
            el.priceInput.value = Number(li.dataset.price).toFixed(state.market.dec);
            updateTotal();
        })
    );

    el.openOrders.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-cancel]");
        if (btn) cancelOrder(Number(btn.dataset.cancel));
    });

    const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
    function selectTab(tab) {
        tabs.forEach((t) => {
            const selected = t === tab;
            t.setAttribute("aria-selected", String(selected));
            t.tabIndex = selected ? 0 : -1;
            document.getElementById(t.getAttribute("aria-controls")).hidden = !selected;
        });
        tab.focus();
    }
    tabs.forEach((t, i) => {
        t.addEventListener("click", () => selectTab(t));
        t.addEventListener("keydown", (e) => {
            if (e.key === "ArrowRight") selectTab(tabs[(i + 1) % tabs.length]);
            if (e.key === "ArrowLeft") selectTab(tabs[(i - 1 + tabs.length) % tabs.length]);
        });
    });

    /* ---------- Init ---------- */

    loadCandles();
    setSide("buy");
    setOrderType("limit");
    renderTicker();
    renderBook();
    for (let i = 0; i < 8; i++) addMarketTrades(state.market, state.market.price);
    renderTrades();
    renderWatchlist();
    renderOrders();
    resizeCanvas();
    setInterval(tick, TICK_MS);
})();
