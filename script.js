(() => {
    "use strict";

    const MARKETS = [
        { sym: "BTC", name: "Bitcoin", price: 64230.5, vol: 0.004 },
        { sym: "ETH", name: "Ethereum", price: 3120.42, vol: 0.005 },
        { sym: "SOL", name: "Solana", price: 148.73, vol: 0.008 },
        { sym: "XRP", name: "Ripple", price: 0.5231, vol: 0.006 },
        { sym: "ADA", name: "Cardano", price: 0.4412, vol: 0.007 },
        { sym: "AVAX", name: "Avalanche", price: 35.18, vol: 0.008 },
    ];
    const TF_SECONDS = { "1m": 60, "5m": 300, "1h": 3600, "4h": 14400, "1d": 86400 };
    const CANDLE_COUNT = 90;
    const FEE_RATE = 0.001;

    const COLORS = { up: "#16c784", down: "#ea3943", grid: "#1a2029", text: "#8a93a0", cross: "#4a5361", accent: "#f0b90b" };

    const state = {
        market: MARKETS[0],
        tf: "1h",
        candles: [],
        side: "buy",
        orderType: "market",
        balance: 25000,
        positions: [],
        hoverIndex: null,
        lastPrice: MARKETS[0].price,
    };

    const $ = (id) => document.getElementById(id);
    const el = {
        canvas: $("tradingChart"), chart: $("chart"), ohlc: $("ohlc"),
        lastPrice: $("lastPrice"), priceChange: $("priceChange"),
        pairName: $("pairName"), pairSub: $("pairSub"), pairIcon: $("pairIcon"),
        statHigh: $("statHigh"), statLow: $("statLow"), statVol: $("statVol"), balance: $("balance"),
        asks: $("asks"), bids: $("bids"), bookMid: $("bookMid"), spread: $("spread"),
        watchlist: $("watchlist"), positions: $("positions"), positionsEmpty: $("positionsEmpty"), trades: $("trades"),
        form: $("orderForm"), amount: $("amount"), amountUnit: $("amountUnit"), limitField: $("limitField"),
        limitPrice: $("limitPrice"), orderTotal: $("orderTotal"), orderFee: $("orderFee"),
        submitBtn: $("submitBtn"), formError: $("formError"), toast: $("toast"),
    };
    const ctx = el.canvas.getContext("2d");

    /* ---------- Formatting ---------- */
    const decimalsFor = (p) => (p >= 1000 ? 2 : p >= 1 ? 2 : 4);
    const fmtPrice = (p, dollar = true) =>
        (dollar ? "$" : "") + p.toLocaleString("en-US", { minimumFractionDigits: decimalsFor(p), maximumFractionDigits: decimalsFor(p) });
    const fmtUsd = (v) => "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtSize = (v) => v.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
    const fmtCompact = (v) => "$" + Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(v);
    const fmtPct = (v) => (v >= 0 ? "+" : "") + v.toFixed(2) + "%";

    /* ---------- Data generation ---------- */
    function gaussian() {
        let u = 0, v = 0;
        while (u === 0) u = Math.random();
        while (v === 0) v = Math.random();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }

    function generateCandles(market, tf) {
        const step = TF_SECONDS[tf];
        const scale = market.vol * Math.sqrt(step / 3600);
        const now = Math.floor(Date.now() / 1000 / step) * step;
        const candles = [];
        let price = market.price * (1 - scale * 6 * (Math.random() - 0.3));
        for (let i = CANDLE_COUNT - 1; i >= 0; i--) {
            const open = price;
            const close = open * (1 + gaussian() * scale);
            const high = Math.max(open, close) * (1 + Math.abs(gaussian()) * scale * 0.5);
            const low = Math.min(open, close) * (1 - Math.abs(gaussian()) * scale * 0.5);
            const volume = (0.5 + Math.random()) * 1e6 * (market.price / 1000 + 1);
            candles.push({ time: (now - i * step) * 1000, open, high, low, close, volume });
            price = close;
        }
        // Anchor the last close to the market's current price so all views agree.
        const ratio = market.price / candles[candles.length - 1].close;
        candles.forEach((c) => { c.open *= ratio; c.high *= ratio; c.low *= ratio; c.close *= ratio; });
        return candles;
    }

    /* ---------- Chart ---------- */
    let chartW = 0, chartH = 0;
    const PAD = { top: 16, right: 72, bottom: 24, left: 8 };

    function resizeCanvas() {
        const rect = el.chart.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        chartW = rect.width;
        chartH = rect.height;
        el.canvas.width = Math.round(chartW * dpr);
        el.canvas.height = Math.round(chartH * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawChart();
    }

    function drawChart() {
        const candles = state.candles;
        if (!candles.length || !chartW) return;

        ctx.clearRect(0, 0, chartW, chartH);
        const plotW = chartW - PAD.left - PAD.right;
        const plotH = chartH - PAD.top - PAD.bottom;
        const volH = plotH * 0.18;
        const priceH = plotH - volH - 8;

        let hi = -Infinity, lo = Infinity, maxVol = 0;
        for (const c of candles) { hi = Math.max(hi, c.high); lo = Math.min(lo, c.low); maxVol = Math.max(maxVol, c.volume); }
        const range = hi - lo || 1;
        hi += range * 0.06; lo -= range * 0.06;

        const slot = plotW / candles.length;
        const bodyW = Math.max(1, slot * 0.64);
        const yOf = (p) => PAD.top + ((hi - p) / (hi - lo)) * priceH;
        const xOf = (i) => PAD.left + i * slot + slot / 2;

        // Grid + price axis
        ctx.font = "11px 'JetBrains Mono', monospace";
        ctx.textBaseline = "middle";
        ctx.lineWidth = 1;
        const rows = 5;
        for (let r = 0; r <= rows; r++) {
            const p = lo + ((hi - lo) * r) / rows;
            const y = Math.round(yOf(p)) + 0.5;
            ctx.strokeStyle = COLORS.grid;
            ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + plotW, y); ctx.stroke();
            ctx.fillStyle = COLORS.text;
            ctx.fillText(fmtPrice(p, false), PAD.left + plotW + 8, y);
        }

        // Time axis
        const labelEvery = Math.max(1, Math.ceil(candles.length / Math.max(2, Math.floor(plotW / 90))));
        ctx.textBaseline = "alphabetic";
        ctx.textAlign = "center";
        for (let i = 0; i < candles.length; i += labelEvery) {
            const x = Math.round(xOf(i)) + 0.5;
            ctx.strokeStyle = COLORS.grid;
            ctx.beginPath(); ctx.moveTo(x, PAD.top); ctx.lineTo(x, PAD.top + plotH); ctx.stroke();
            ctx.fillStyle = COLORS.text;
            ctx.fillText(timeLabel(candles[i].time), x, chartH - 6);
        }
        ctx.textAlign = "left";

        // Volume + candles
        candles.forEach((c, i) => {
            const up = c.close >= c.open;
            const color = up ? COLORS.up : COLORS.down;
            const x = xOf(i);

            ctx.globalAlpha = 0.25;
            ctx.fillStyle = color;
            const vh = (c.volume / maxVol) * volH;
            ctx.fillRect(x - bodyW / 2, PAD.top + plotH - vh, bodyW, vh);
            ctx.globalAlpha = 1;

            ctx.strokeStyle = color;
            ctx.beginPath();
            ctx.moveTo(Math.round(x) + 0.5, yOf(c.high));
            ctx.lineTo(Math.round(x) + 0.5, yOf(c.low));
            ctx.stroke();

            const yO = yOf(c.open), yC = yOf(c.close);
            ctx.fillRect(x - bodyW / 2, Math.min(yO, yC), bodyW, Math.max(1, Math.abs(yC - yO)));
        });

        // Last price line
        const last = candles[candles.length - 1];
        const lastUp = last.close >= last.open;
        const ly = Math.round(yOf(last.close)) + 0.5;
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = lastUp ? COLORS.up : COLORS.down;
        ctx.beginPath(); ctx.moveTo(PAD.left, ly); ctx.lineTo(PAD.left + plotW, ly); ctx.stroke();
        ctx.setLineDash([]);
        drawAxisTag(ly, fmtPrice(last.close, false), lastUp ? COLORS.up : COLORS.down, lastUp ? "#04150e" : "#fff", plotW);

        // Crosshair
        if (state.hoverIndex !== null && hoverPoint) {
            const i = state.hoverIndex;
            const x = Math.round(xOf(i)) + 0.5;
            const y = Math.min(Math.max(hoverPoint.y, PAD.top), PAD.top + priceH);
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = COLORS.cross;
            ctx.beginPath();
            ctx.moveTo(x, PAD.top); ctx.lineTo(x, PAD.top + plotH);
            ctx.moveTo(PAD.left, Math.round(y) + 0.5); ctx.lineTo(PAD.left + plotW, Math.round(y) + 0.5);
            ctx.stroke();
            ctx.setLineDash([]);
            const p = hi - ((y - PAD.top) / priceH) * (hi - lo);
            drawAxisTag(Math.round(y) + 0.5, fmtPrice(p, false), "#2a3240", "#e6e8eb", plotW);
        }
    }

    function drawAxisTag(y, text, bg, fg, plotW) {
        const x = PAD.left + plotW + 2;
        ctx.fillStyle = bg;
        ctx.fillRect(x, y - 9, PAD.right - 4, 18);
        ctx.fillStyle = fg;
        ctx.textBaseline = "middle";
        ctx.fillText(text, x + 6, y);
    }

    function timeLabel(ms) {
        const d = new Date(ms);
        if (state.tf === "1d") return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    }

    let hoverPoint = null;
    function onPointerMove(e) {
        const rect = el.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const plotW = chartW - PAD.left - PAD.right;
        const idx = Math.floor(((x - PAD.left) / plotW) * state.candles.length);
        if (idx < 0 || idx >= state.candles.length) return onPointerLeave();
        hoverPoint = { x, y: e.clientY - rect.top };
        state.hoverIndex = idx;
        renderOhlc(state.candles[idx]);
        drawChart();
    }
    function onPointerLeave() {
        hoverPoint = null;
        state.hoverIndex = null;
        renderOhlc(state.candles[state.candles.length - 1]);
        drawChart();
    }

    function renderOhlc(c) {
        if (!c) return;
        const cls = c.close >= c.open ? "up" : "down";
        const chg = ((c.close - c.open) / c.open) * 100;
        el.ohlc.innerHTML =
            `<span>O <b class="${cls}">${fmtPrice(c.open, false)}</b></span>` +
            `<span>H <b class="${cls}">${fmtPrice(c.high, false)}</b></span>` +
            `<span>L <b class="${cls}">${fmtPrice(c.low, false)}</b></span>` +
            `<span>C <b class="${cls}">${fmtPrice(c.close, false)}</b></span>` +
            `<span class="${cls}">${fmtPct(chg)}</span>`;
    }

    /* ---------- Header stats ---------- */
    function renderHeader() {
        const m = state.market;
        const c = state.candles;
        const first = c[0].open;
        const last = c[c.length - 1].close;
        const chg = ((last - first) / first) * 100;
        m.change = chg;

        el.lastPrice.textContent = fmtPrice(last);
        el.priceChange.textContent = fmtPct(chg);
        el.priceChange.className = "change mono " + (chg >= 0 ? "up" : "down");
        el.statHigh.textContent = fmtPrice(Math.max(...c.map((x) => x.high)));
        el.statLow.textContent = fmtPrice(Math.min(...c.map((x) => x.low)));
        el.statVol.textContent = fmtCompact(c.reduce((s, x) => s + x.volume, 0));
        el.balance.textContent = fmtUsd(state.balance);
        el.bookMid.textContent = fmtPrice(last);
        el.bookMid.className = "book-mid mono " + (last >= state.lastPrice ? "up" : "down");
        document.title = `${fmtPrice(last)} ${m.sym}/USD · TradePro Terminal`;
    }

    function flashPrice(dir) {
        el.lastPrice.classList.remove("flash-up", "flash-down");
        void el.lastPrice.offsetWidth;
        el.lastPrice.classList.add(dir > 0 ? "flash-up" : "flash-down");
        clearTimeout(flashPrice.t);
        flashPrice.t = setTimeout(() => el.lastPrice.classList.remove("flash-up", "flash-down"), 500);
    }

    /* ---------- Order book ---------- */
    function renderBook() {
        const mid = state.market.price;
        const tick = mid * 0.00012;
        const levels = window.innerWidth < 720 ? 6 : 10;
        const mk = (dir) => {
            let total = 0;
            return Array.from({ length: levels }, (_, i) => {
                const size = (Math.random() * 2 + 0.05) * (1000 / Math.max(mid, 1)) * 40;
                total += size;
                return { price: mid + dir * tick * (i + 1 + Math.random() * 0.3), size, total };
            });
        };
        const asks = mk(1), bids = mk(-1);
        const maxTotal = Math.max(asks[asks.length - 1].total, bids[bids.length - 1].total);

        const row = (lvl, cls) =>
            `<div class="book-row ${cls}"><div class="depth" style="width:${((lvl.total / maxTotal) * 100).toFixed(1)}%"></div>` +
            `<span>${fmtPrice(lvl.price, false)}</span><span>${fmtSize(lvl.size)}</span><span>${fmtSize(lvl.total)}</span></div>`;

        el.asks.innerHTML = asks.slice().reverse().map((l) => row(l, "ask")).join("");
        el.bids.innerHTML = bids.map((l) => row(l, "bid")).join("");
        el.spread.textContent = fmtPrice(asks[0].price - bids[0].price, false);
    }

    /* ---------- Market trades ---------- */
    const tradeLog = [];
    function pushTrade(price, up) {
        tradeLog.unshift({ time: new Date(), price, size: Math.random() * (5000 / price), up });
        if (tradeLog.length > 14) tradeLog.pop();
        el.trades.innerHTML = tradeLog.map((t) =>
            `<tr><td class="muted">${t.time.toLocaleTimeString("en-US", { hour12: false })}</td>` +
            `<td class="${t.up ? "up" : "down"}">${fmtPrice(t.price, false)}</td><td>${fmtSize(t.size)}</td></tr>`
        ).join("");
    }

    /* ---------- Watchlist ---------- */
    function renderWatchlist() {
        el.watchlist.innerHTML = MARKETS.map((m) => {
            const chg = m.change ?? 0;
            return `<li><button class="watch-item" data-sym="${m.sym}" aria-pressed="${m === state.market}">
                <span><span class="watch-sym">${m.sym}/USD</span><span class="watch-name">${m.name}</span></span>
                <span class="watch-price">${fmtPrice(m.price, false)}</span>
                <span class="watch-chg ${chg >= 0 ? "up" : "down"}">${fmtPct(chg)}</span>
            </button></li>`;
        }).join("");
    }

    el.watchlist.addEventListener("click", (e) => {
        const btn = e.target.closest(".watch-item");
        if (!btn) return;
        const m = MARKETS.find((x) => x.sym === btn.dataset.sym);
        if (m && m !== state.market) selectMarket(m);
    });

    function selectMarket(m) {
        state.market = m;
        state.lastPrice = m.price;
        el.pairName.textContent = `${m.sym}/USD`;
        el.pairSub.textContent = m.name;
        el.pairIcon.textContent = m.sym[0];
        el.amountUnit.textContent = m.sym;
        loadCandles();
        renderWatchlist();
        renderBook();
        updateSubmitLabel();
        updateOrderSummary();
    }

    function loadCandles() {
        state.candles = generateCandles(state.market, state.tf);
        state.hoverIndex = null;
        renderHeader();
        renderOhlc(state.candles[state.candles.length - 1]);
        drawChart();
    }

    /* ---------- Timeframes & tabs ---------- */
    function bindTabs(containerId, attr, onChange, ariaAttr = "aria-selected") {
        const container = $(containerId);
        container.addEventListener("click", (e) => {
            const btn = e.target.closest(`button[data-${attr}]`);
            if (!btn) return;
            container.querySelectorAll("button").forEach((b) => b.setAttribute(ariaAttr, String(b === btn)));
            onChange(btn.dataset[attr]);
        });
    }

    bindTabs("timeframes", "tf", (tf) => { state.tf = tf; loadCandles(); });
    bindTabs("activityTabs", "tab", (tab) => {
        document.querySelectorAll("[data-pane]").forEach((p) => { p.hidden = p.dataset.pane !== tab; });
    });
    bindTabs("orderType", "type", (type) => {
        state.orderType = type;
        el.limitField.hidden = type !== "limit";
        if (type === "limit") el.limitPrice.value = state.market.price.toFixed(decimalsFor(state.market.price));
        updateOrderSummary();
    }, "aria-checked");

    /* ---------- Order form ---------- */
    document.querySelector(".side-toggle").addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-side]");
        if (!btn) return;
        state.side = btn.dataset.side;
        document.querySelectorAll(".side-toggle button").forEach((b) => {
            const on = b === btn;
            b.classList.toggle("active", on);
            b.setAttribute("aria-selected", String(on));
        });
        updateSubmitLabel();
    });

    function updateSubmitLabel() {
        el.submitBtn.textContent = `${state.side === "buy" ? "Buy" : "Sell"} ${state.market.sym}`;
        el.submitBtn.className = `submit ${state.side}`;
    }

    const execPrice = () =>
        state.orderType === "limit" ? parseFloat(el.limitPrice.value) || 0 : state.market.price;

    function updateOrderSummary() {
        const amt = parseFloat(el.amount.value) || 0;
        const total = amt * execPrice();
        el.orderTotal.textContent = fmtUsd(total);
        el.orderFee.textContent = fmtUsd(total * FEE_RATE);
        el.formError.textContent = "";
    }

    el.amount.addEventListener("input", updateOrderSummary);
    el.limitPrice.addEventListener("input", updateOrderSummary);

    document.querySelector(".pct-row").addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-pct]");
        if (!btn) return;
        const price = execPrice();
        if (!price) return;
        const usd = (state.balance * Number(btn.dataset.pct)) / 100 / (1 + FEE_RATE);
        el.amount.value = (Math.floor((usd / price) * 1e4) / 1e4).toString();
        updateOrderSummary();
    });

    el.form.addEventListener("submit", (e) => {
        e.preventDefault();
        const amt = parseFloat(el.amount.value);
        const price = execPrice();
        if (!amt || amt <= 0) return (el.formError.textContent = "Enter an amount greater than 0.");
        if (!price || price <= 0) return (el.formError.textContent = "Enter a valid limit price.");
        const cost = amt * price * (1 + FEE_RATE);
        if (state.side === "buy" && cost > state.balance) return (el.formError.textContent = "Insufficient balance.");

        state.balance += state.side === "buy" ? -cost : amt * price * (1 - FEE_RATE);
        state.positions.unshift({ market: state.market, side: state.side, size: amt, entry: price });
        el.amount.value = "";
        updateOrderSummary();
        renderPositions();
        el.balance.textContent = fmtUsd(state.balance);
        showToast(`${state.side === "buy" ? "Bought" : "Sold"} ${fmtSize(amt)} ${state.market.sym} at ${fmtPrice(price)}`);
    });

    function renderPositions() {
        el.positionsEmpty.hidden = state.positions.length > 0;
        el.positions.innerHTML = state.positions.map((p) => {
            const mark = p.market.price;
            const pnl = (mark - p.entry) * p.size * (p.side === "buy" ? 1 : -1);
            const pct = (pnl / (p.entry * p.size)) * 100;
            const cls = pnl >= 0 ? "up" : "down";
            return `<tr>
                <td>${p.market.sym}/USD</td>
                <td class="side-pill ${p.side === "buy" ? "up" : "down"}">${p.side === "buy" ? "Long" : "Short"}</td>
                <td>${fmtSize(p.size)}</td>
                <td>${fmtPrice(p.entry)}</td>
                <td>${fmtPrice(mark)}</td>
                <td class="${cls}">${pnl >= 0 ? "+" : "-"}${fmtUsd(Math.abs(pnl))} (${fmtPct(pct)})</td>
            </tr>`;
        }).join("");
    }

    function showToast(msg) {
        el.toast.textContent = msg;
        el.toast.classList.add("show");
        clearTimeout(showToast.t);
        showToast.t = setTimeout(() => el.toast.classList.remove("show"), 2600);
    }

    /* ---------- Live ticks ---------- */
    function tick() {
        MARKETS.forEach((m) => {
            if (m !== state.market) {
                m.price *= 1 + gaussian() * m.vol * 0.15;
                m.change = (m.change ?? (Math.random() - 0.4) * 6) + gaussian() * 0.05;
            }
        });

        const m = state.market;
        const prev = m.price;
        m.price *= 1 + gaussian() * m.vol * 0.15;
        const last = state.candles[state.candles.length - 1];
        last.close = m.price;
        last.high = Math.max(last.high, m.price);
        last.low = Math.min(last.low, m.price);
        last.volume += Math.random() * 2e4;

        const dir = m.price - prev;
        flashPrice(dir);
        pushTrade(m.price, dir >= 0);
        renderHeader();
        state.lastPrice = m.price;
        if (state.hoverIndex === null) renderOhlc(last);
        drawChart();
        renderBook();
        renderWatchlist();
        if (state.positions.length) renderPositions();
        if (state.orderType === "market") updateOrderSummaryQuiet();
    }

    function updateOrderSummaryQuiet() {
        const amt = parseFloat(el.amount.value) || 0;
        const total = amt * execPrice();
        el.orderTotal.textContent = fmtUsd(total);
        el.orderFee.textContent = fmtUsd(total * FEE_RATE);
    }

    /* ---------- Init ---------- */
    MARKETS.forEach((m) => { if (m !== state.market) m.change = (Math.random() - 0.4) * 6; });
    el.canvas.addEventListener("pointermove", onPointerMove);
    el.canvas.addEventListener("pointerleave", onPointerLeave);
    new ResizeObserver(resizeCanvas).observe(el.chart);

    loadCandles();
    renderBook();
    renderWatchlist();
    renderPositions();
    updateSubmitLabel();
    for (let i = 0; i < 8; i++) pushTrade(state.market.price * (1 + gaussian() * 0.0004), Math.random() > 0.5);

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setInterval(tick, reduceMotion ? 3000 : 1200);
})();
