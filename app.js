// ============ KAIRON SYSTEMS - WITH YOUR DERIV APP ID & LIVE NEWS ============
// Configuration
const CONFIG = {
    currentMarket: 'R_100',
    currentTradeType: 'rise_fall',
    voiceEnabled: true,
    voiceGender: 'male',
    digitsHistory: [],
    priceData: [],
    maxHistory: 1000,
    digitsData: Array(10).fill(0),
    signalHistory: [],
    isConnected: false,
    ws: null,
    requestId: 1,
    pendingRequests: new Map(),
    currentSignal: null,
    lastVoiceTime: 0,
    voiceCooldown: 5000,
    lastConfidence: 0,
    lastSignalType: null,
    selectedOverThreshold: null,
    selectedUnderThreshold: null
};

// YOUR DERIV APP ID - Integrated
const DERIV_APP_ID = '3301jaeZWyGCapwrS0scH';
const DERIV_WS_URL = `wss://ws.binaryws.com/websockets/v3?app_id=${DERIV_APP_ID}`;

// Marketaux News API (Free, no token required)
const NEWS_API_URL = 'https://api.marketaux.com/v1/news/all?limit=15';

// Chart instances
let priceChart = null;
let digitsChart = null;

// ============ LOADER ============
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        const loader = document.getElementById('loader');
        const mainContent = document.getElementById('mainContent');
        if (loader && mainContent) {
            loader.style.opacity = '0';
            setTimeout(() => {
                loader.style.display = 'none';
                mainContent.style.display = 'block';
                initializeApp();
            }, 500);
        }
    }, 5000);
});

// ============ INITIALIZATION ============
async function initializeApp() {
    console.log('KAIRON Systems Initialized with App ID:', DERIV_APP_ID);
    initializeMarkets();
    initializeCharts();
    initializeVoice();
    setupEventListeners();
    loadEconomicCalendar();
    loadCommodities();
    await loadLiveNews(); // Load live news with images
    await connectDerivWebSocket();
}

// ============ LIVE NEWS WITH IMAGES ============
async function loadLiveNews() {
    const newsFeed = document.getElementById('newsFeed');
    if (!newsFeed) return;
    
    // Show loading state
    newsFeed.innerHTML = `
        <div class="animate-pulse space-y-3">
            <div class="h-24 bg-gray-700 rounded"></div>
            <div class="h-24 bg-gray-700 rounded"></div>
            <div class="h-24 bg-gray-700 rounded"></div>
        </div>
    `;
    
    try {
        // Fetch live news from Marketaux (free, no token needed)
        const response = await axios.get(NEWS_API_URL, {
            params: {
                limit: 15,
                language: 'en'
            },
            timeout: 10000
        });
        
        if (response.data && response.data.data && response.data.data.length > 0) {
            const news = response.data.data;
            
            newsFeed.innerHTML = news.map(item => `
                <div class="news-card bg-gray-800/30 rounded-lg p-3 transition-all cursor-pointer hover:bg-gray-800/50" onclick="window.open('${item.url || '#'}', '_blank')">
                    <div class="flex gap-3">
                        ${item.image_url ? `<img src="${item.image_url}" alt="${item.title}" class="news-image" onerror="this.style.display='none'">` : ''}
                        <div class="flex-1">
                            <div class="flex justify-between items-start mb-1">
                                <span class="text-xs font-semibold text-purple-400">${item.source || 'Market News'}</span>
                                <span class="text-xs text-gray-500">${item.published_at ? new Date(item.published_at).toLocaleTimeString() : 'Just now'}</span>
                            </div>
                            <p class="text-xs md:text-sm font-semibold text-white mb-1 line-clamp-2">${item.title}</p>
                            <p class="text-[10px] md:text-xs text-gray-400 line-clamp-2">${item.description || ''}</p>
                            <div class="flex gap-2 mt-2">
                                <span class="text-[10px] px-2 py-0.5 rounded bg-blue-900/50 text-blue-400">${item.sector || 'Market'}</span>
                                ${item.sentiment ? `<span class="text-[10px] px-2 py-0.5 rounded ${item.sentiment_score > 0 ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'}">${item.sentiment}</span>` : ''}
                            </div>
                        </div>
                    </div>
                </div>
            `).join('');
            
            console.log(`Loaded ${news.length} live news articles`);
        } else {
            // Fallback to demo news if API returns no data
            loadDemoNews();
        }
    } catch (error) {
        console.error('Failed to fetch live news:', error);
        // Fallback to demo news
        loadDemoNews();
    }
}

function loadDemoNews() {
    const newsFeed = document.getElementById('newsFeed');
    if (!newsFeed) return;
    
    const demoNews = [
        { title: 'Federal Reserve signals rate cut in September', source: 'Bloomberg', impact: 'high', time: '2h ago', image: null },
        { title: 'Gold hits all-time high above $2,400', source: 'Reuters', impact: 'high', time: '3h ago', image: null },
        { title: 'Oil prices surge 5% on Middle East tensions', source: 'CNBC', impact: 'medium', time: '5h ago', image: null },
        { title: 'Bitcoin volatility expected ahead of halving', source: 'CoinDesk', impact: 'medium', time: '6h ago', image: null },
        { title: 'European markets close higher on tech rally', source: 'FT', impact: 'low', time: '8h ago', image: null }
    ];
    
    newsFeed.innerHTML = demoNews.map(item => `
        <div class="news-card bg-gray-800/30 rounded-lg p-3 transition-all">
            <div class="flex gap-3">
                <div class="flex-1">
                    <div class="flex justify-between items-start mb-1">
                        <span class="text-xs font-semibold text-purple-400">${item.source}</span>
                        <span class="text-xs text-gray-500">${item.time}</span>
                    </div>
                    <p class="text-xs md:text-sm font-semibold text-white">${item.title}</p>
                    <div class="mt-2">
                        <span class="text-[10px] px-2 py-0.5 rounded ${item.impact === 'high' ? 'bg-red-900/50 text-red-400' : item.impact === 'medium' ? 'bg-yellow-900/50 text-yellow-400' : 'bg-gray-700 text-gray-400'}">${item.impact.toUpperCase()} IMPACT</span>
                    </div>
                </div>
            </div>
        </div>
    `).join('');
}

// ============ ALL VOLATILITY MARKETS ============
function initializeMarkets() {
    const markets = [
        { id: 'R_10', name: 'Vol 10 (1s)', icon: 'fa-bolt', type: '1s' },
        { id: 'R_25', name: 'Vol 25 (1s)', icon: 'fa-bolt', type: '1s' },
        { id: 'R_50', name: 'Vol 50 (1s)', icon: 'fa-bolt', type: '1s' },
        { id: 'R_75', name: 'Vol 75 (1s)', icon: 'fa-bolt', type: '1s' },
        { id: 'R_100', name: 'Vol 100 (1s)', icon: 'fa-bolt', type: '1s' },
        { id: '1HZ10V', name: 'Vol 10 (Index)', icon: 'fa-chart-line', type: 'index' },
        { id: '1HZ25V', name: 'Vol 25 (Index)', icon: 'fa-chart-line', type: 'index' },
        { id: '1HZ50V', name: 'Vol 50 (Index)', icon: 'fa-chart-line', type: 'index' },
        { id: '1HZ75V', name: 'Vol 75 (Index)', icon: 'fa-chart-line', type: 'index' },
        { id: '1HZ100V', name: 'Vol 100 (Index)', icon: 'fa-chart-line', type: 'index' }
    ];
    
    const marketGrid = document.getElementById('marketGrid');
    if (marketGrid) {
        marketGrid.innerHTML = markets.map(market => `
            <button class="market-btn px-2 md:px-3 py-1 md:py-1.5 rounded-lg text-[10px] md:text-xs whitespace-nowrap transition ${CONFIG.currentMarket === market.id ? 'active bg-gradient-to-r from-blue-600 to-purple-600' : 'bg-gray-800/50'}" data-market="${market.id}">
                <i class="fas ${market.icon} mr-1"></i>${market.name}
            </button>
        `).join('');
        
        document.querySelectorAll('.market-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                document.querySelectorAll('.market-btn').forEach(b => b.classList.remove('active', 'bg-gradient-to-r', 'from-blue-600', 'to-purple-600'));
                btn.classList.add('active', 'bg-gradient-to-r', 'from-blue-600', 'to-purple-600');
                const newMarket = btn.dataset.market;
                CONFIG.currentMarket = newMarket;
                document.getElementById('currentMarketDisplay').innerText = newMarket;
                showNotification(`Switched to ${newMarket}`, 'info');
                await fetchHistoricalData();
            });
        });
    }
    
    // Trading type buttons
    document.querySelectorAll('.trade-type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.trade-type-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            CONFIG.currentTradeType = btn.dataset.type;
            showNotification(`Trading type: ${CONFIG.currentTradeType.replace('_', ' ').toUpperCase()}`, 'info');
        });
    });
    
    // Tick selector
    const tickSelector = document.getElementById('tickSelector');
    if (tickSelector) {
        tickSelector.addEventListener('change', async (e) => {
            CONFIG.maxHistory = parseInt(e.target.value);
            showNotification(`Tick history set to ${CONFIG.maxHistory} ticks`, 'info');
            await fetchHistoricalData();
        });
    }
    
    // Refresh button
    const refreshBtn = document.getElementById('refreshDataBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
            await fetchHistoricalData();
            showNotification('Market data refreshed', 'success');
        });
    }
    
    // Threshold click handlers
    document.querySelectorAll('[data-over]').forEach(el => {
        el.addEventListener('click', () => {
            const threshold = parseInt(el.dataset.over);
            CONFIG.selectedOverThreshold = threshold;
            CONFIG.selectedUnderThreshold = null;
            document.querySelectorAll('[data-over], [data-under]').forEach(e => e.classList.remove('selected'));
            el.classList.add('selected');
            analyzeOverUnderThreshold();
        });
    });
    
    document.querySelectorAll('[data-under]').forEach(el => {
        el.addEventListener('click', () => {
            const threshold = parseInt(el.dataset.under);
            CONFIG.selectedUnderThreshold = threshold;
            CONFIG.selectedOverThreshold = null;
            document.querySelectorAll('[data-over], [data-under]').forEach(e => e.classList.remove('selected'));
            el.classList.add('selected');
            analyzeOverUnderThreshold();
        });
    });
}

// ============ LDP UPDATE ============
function updateLDP() {
    const ldpGrid = document.getElementById('ldpGrid');
    if (!ldpGrid) return;
    
    const last20 = CONFIG.digitsHistory.slice(-20).reverse();
    const currentLastDigit = last20.length > 0 ? last20[0] : '-';
    
    document.getElementById('currentLastDigit').innerHTML = currentLastDigit !== '-' ? currentLastDigit : '---';
    
    let html = '';
    for (let i = 0; i < 20; i++) {
        const digit = last20[i];
        if (digit !== undefined) {
            html += `<div class="ldp-digit ldp-digit-${digit}">${digit}</div>`;
        } else {
            html += `<div class="ldp-digit bg-gray-700">-</div>`;
        }
    }
    ldpGrid.innerHTML = html;
}

// ============ THRESHOLD ANALYSIS ============
function updateThresholdStats() {
    const total = CONFIG.digitsHistory.length || 1;
    
    for (let i = 0; i <= 6; i++) {
        const count = CONFIG.digitsHistory.filter(d => d > i).length;
        const percent = (count / total) * 100;
        const element = document.getElementById(`over${i}Percent`);
        if (element) element.textContent = `${percent.toFixed(1)}%`;
    }
    
    for (let i = 3; i <= 9; i++) {
        const count = CONFIG.digitsHistory.filter(d => d < i).length;
        const percent = (count / total) * 100;
        const element = document.getElementById(`under${i}Percent`);
        if (element) element.textContent = `${percent.toFixed(1)}%`;
    }
}

function analyzeOverUnderThreshold() {
    const signalDiv = document.getElementById('thresholdSignal');
    if (!signalDiv) return;
    
    const total = CONFIG.digitsHistory.length || 1;
    let signal = null;
    let confidence = 0;
    let message = '';
    
    if (CONFIG.selectedOverThreshold !== null) {
        const threshold = CONFIG.selectedOverThreshold;
        const count = CONFIG.digitsHistory.filter(d => d > threshold).length;
        const percent = (count / total) * 100;
        const recentCount = CONFIG.digitsHistory.slice(-10).filter(d => d > threshold).length;
        const recentPercent = (recentCount / 10) * 100;
        
        if (recentPercent > 70) {
            signal = `OVER ${threshold}`;
            confidence = 65 + (recentPercent - 70);
            message = `🔥 STRONG: ${recentCount}/10 recent digits are OVER ${threshold} (${recentPercent.toFixed(0)}%)`;
        } else if (percent > 60) {
            signal = `OVER ${threshold}`;
            confidence = 55 + (percent - 60);
            message = `📈 Historical trend: ${percent.toFixed(0)}% of digits are OVER ${threshold}`;
        } else {
            message = `⚡ ${percent.toFixed(0)}% of digits are OVER ${threshold} - Low probability`;
        }
    } else if (CONFIG.selectedUnderThreshold !== null) {
        const threshold = CONFIG.selectedUnderThreshold;
        const count = CONFIG.digitsHistory.filter(d => d < threshold).length;
        const percent = (count / total) * 100;
        const recentCount = CONFIG.digitsHistory.slice(-10).filter(d => d < threshold).length;
        const recentPercent = (recentCount / 10) * 100;
        
        if (recentPercent > 70) {
            signal = `UNDER ${threshold}`;
            confidence = 65 + (recentPercent - 70);
            message = `🔥 STRONG: ${recentCount}/10 recent digits are UNDER ${threshold} (${recentPercent.toFixed(0)}%)`;
        } else if (percent > 60) {
            signal = `UNDER ${threshold}`;
            confidence = 55 + (percent - 60);
            message = `📉 Historical trend: ${percent.toFixed(0)}% of digits are UNDER ${threshold}`;
        } else {
            message = `⚡ ${percent.toFixed(0)}% of digits are UNDER ${threshold} - Low probability`;
        }
    }
    
    if (signal && confidence > 55) {
        signalDiv.className = `mt-3 p-2 rounded-lg text-center ${signal.includes('OVER') ? 'bg-green-900/30 border border-green-500' : 'bg-red-900/30 border border-red-500'}`;
        signalDiv.innerHTML = `
            <p class="text-sm font-bold ${signal.includes('OVER') ? 'text-green-400' : 'text-red-400'}">${signal} SIGNAL DETECTED</p>
            <p class="text-xs">${message}</p>
            <p class="text-xs text-gray-400 mt-1">Confidence: ${Math.round(confidence)}%</p>
        `;
        signalDiv.classList.remove('hidden');
        
        const now = Date.now();
        if (now - CONFIG.lastVoiceTime > CONFIG.voiceCooldown) {
            speak(`${signal} signal with ${Math.round(confidence)} percent confidence based on threshold analysis`);
            CONFIG.lastVoiceTime = now;
        }
    } else {
        signalDiv.innerHTML = `<p class="text-xs text-center text-gray-400">${message}</p>`;
        signalDiv.classList.remove('hidden');
    }
}

// ============ DERIV WEBSOCKET CONNECTION ============
async function connectDerivWebSocket() {
    updateConnectionStatus('Connecting to Deriv...', false);
    
    return new Promise((resolve, reject) => {
        CONFIG.ws = new WebSocket(DERIV_WS_URL);
        
        CONFIG.ws.onopen = async () => {
            CONFIG.isConnected = true;
            updateConnectionStatus('Connected to Deriv', true);
            console.log('Connected to Deriv WebSocket with App ID:', DERIV_APP_ID);
            await subscribeToTicks();
            await fetchHistoricalData();
            resolve();
        };
        
        CONFIG.ws.onmessage = (event) => {
            const response = JSON.parse(event.data);
            handleDerivResponse(response);
        };
        
        CONFIG.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            updateConnectionStatus('Connection error', false);
            reject(error);
        };
        
        CONFIG.ws.onclose = () => {
            CONFIG.isConnected = false;
            updateConnectionStatus('Disconnected, retrying...', false);
            setTimeout(connectDerivWebSocket, 5000);
        };
    });
}

function sendRequest(msgType, params = {}) {
    return new Promise((resolve, reject) => {
        if (!CONFIG.ws || CONFIG.ws.readyState !== WebSocket.OPEN) {
            reject(new Error('WebSocket not connected'));
            return;
        }
        
        const reqId = CONFIG.requestId++;
        const request = { [msgType]: 1, req_id: reqId, ...params };
        CONFIG.pendingRequests.set(reqId, { resolve, reject });
        
        setTimeout(() => {
            if (CONFIG.pendingRequests.has(reqId)) {
                CONFIG.pendingRequests.delete(reqId);
                reject(new Error('Request timeout'));
            }
        }, 10000);
        
        CONFIG.ws.send(JSON.stringify(request));
    });
}

async function subscribeToTicks() {
    try {
        await sendRequest('ticks', { ticks: CONFIG.currentMarket, subscribe: 1 });
        console.log(`Subscribed to ${CONFIG.currentMarket} ticks`);
    } catch (error) {
        console.error('Subscription failed:', error);
    }
}

async function fetchHistoricalData() {
    try {
        const count = CONFIG.maxHistory;
        const response = await sendRequest('ticks_history', {
            ticks_history: CONFIG.currentMarket,
            adjust_start_time: 1,
            count: count,
            end: 'latest',
            style: 'ticks'
        });
        
        if (response && response.history && response.history.prices) {
            const prices = response.history.prices;
            CONFIG.priceData = prices.map(p => parseFloat(p));
            
            CONFIG.digitsHistory = [];
            CONFIG.priceData.forEach(price => {
                const priceStr = price.toString();
                const decimalMatch = priceStr.match(/\.(\d)/);
                const digit = decimalMatch ? parseInt(decimalMatch[1]) : Math.floor(price) % 10;
                CONFIG.digitsHistory.push(digit);
            });
            
            if (CONFIG.digitsHistory.length > CONFIG.maxHistory) {
                CONFIG.digitsHistory = CONFIG.digitsHistory.slice(-CONFIG.maxHistory);
            }
            if (CONFIG.priceData.length > CONFIG.maxHistory) {
                CONFIG.priceData = CONFIG.priceData.slice(-CONFIG.maxHistory);
            }
            
            updateDigitFrequency();
            updateCharts();
            updatePriceStats();
            updateLDP();
            updateThresholdStats();
            
            console.log(`Fetched ${CONFIG.priceData.length} ticks for ${CONFIG.currentMarket}`);
            showNotification(`Loaded ${CONFIG.priceData.length} ticks from Deriv`, 'success');
        }
    } catch (error) {
        console.error('Failed to fetch historical data:', error);
        startSimulation();
    }
}

function updateDigitFrequency() {
    CONFIG.digitsData = Array(10).fill(0);
    CONFIG.digitsHistory.forEach(d => {
        if (d >= 0 && d <= 9) CONFIG.digitsData[d]++;
    });
    
    const total = CONFIG.digitsHistory.length || 1;
    const dominantDigit = CONFIG.digitsData.indexOf(Math.max(...CONFIG.digitsData));
    document.getElementById('dominantDigit').textContent = dominantDigit;
    
    const statsDiv = document.getElementById('digitsStats');
    if (statsDiv) {
        statsDiv.innerHTML = CONFIG.digitsData.map((count, i) => `
            <div class="flex justify-between items-center text-[10px] md:text-xs">
                <span class="w-5">${i}</span>
                <div class="flex-1 mx-2 bg-gray-700 rounded-full h-1.5">
                    <div class="h-1.5 rounded-full" style="width: ${(count / total) * 100}%; background: ${getDigitColor(i)}"></div>
                </div>
                <span class="w-8 text-right">${count}</span>
            </div>
        `).join('');
    }
    
    if (digitsChart) {
        digitsChart.data.datasets[0].data = CONFIG.digitsData;
        digitsChart.update();
    }
}

function getDigitColor(digit) {
    const colors = ['#ef4444', '#f59e0b', '#eab308', '#84cc16', '#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#d946ef', '#ec4899'];
    return colors[digit];
}

function updatePriceStats() {
    if (CONFIG.priceData.length === 0) return;
    
    const lastPrice = CONFIG.priceData[CONFIG.priceData.length - 1];
    const highPrice = Math.max(...CONFIG.priceData);
    const lowPrice = Math.min(...CONFIG.priceData);
    
    document.getElementById('lastPrice').textContent = lastPrice.toFixed(4);
    document.getElementById('highPrice').textContent = highPrice.toFixed(4);
    document.getElementById('lowPrice').textContent = lowPrice.toFixed(4);
    
    if (CONFIG.priceData.length > 1) {
        const prevPrice = CONFIG.priceData[CONFIG.priceData.length - 2];
        const change = ((lastPrice - prevPrice) / prevPrice * 100).toFixed(2);
        const changeEl = document.getElementById('priceChange');
        changeEl.textContent = `${change >= 0 ? '+' : ''}${change}%`;
        changeEl.className = `font-bold ${change >= 0 ? 'text-green-400' : 'text-red-400'}`;
    }
}

function handleDerivResponse(response) {
    if (response.req_id && CONFIG.pendingRequests.has(response.req_id)) {
        const { resolve, reject } = CONFIG.pendingRequests.get(response.req_id);
        CONFIG.pendingRequests.delete(response.req_id);
        if (response.error) reject(response.error);
        else resolve(response);
        return;
    }
    
    if (response.msg_type === 'tick' && response.tick) {
        processLiveTick(response.tick);
    }
}

function processLiveTick(tick) {
    const price = parseFloat(tick.quote);
    CONFIG.priceData.push(price);
    if (CONFIG.priceData.length > CONFIG.maxHistory) {
        CONFIG.priceData.shift();
    }
    
    const priceStr = price.toString();
    const decimalMatch = priceStr.match(/\.(\d)/);
    const digit = decimalMatch ? parseInt(decimalMatch[1]) : Math.floor(price) % 10;
    
    CONFIG.digitsHistory.push(digit);
    if (CONFIG.digitsHistory.length > CONFIG.maxHistory) {
        CONFIG.digitsHistory.shift();
    }
    
    updateDigitFrequency();
    updatePriceStats();
    updateCharts();
    updateLDP();
    updateThresholdStats();
    
    analyzeSignals(price, digit);
    
    if (CONFIG.selectedOverThreshold !== null || CONFIG.selectedUnderThreshold !== null) {
        analyzeOverUnderThreshold();
    }
}

// ============ CHARTS ============
function initializeCharts() {
    const priceCtx = document.getElementById('priceChart');
    if (priceCtx) {
        priceChart = new Chart(priceCtx.getContext('2d'), {
            type: 'line',
            data: { labels: [], datasets: [{ label: 'Price', data: [], borderColor: '#667eea', backgroundColor: 'rgba(102, 126, 234, 0.1)', tension: 0.4, fill: true, pointRadius: 0 }] },
            options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { display: false } }, scales: { y: { grid: { color: '#374151' }, ticks: { color: '#9CA3AF', font: { size: 10 } } }, x: { display: false } } }
        });
    }
    
    const digitsCtx = document.getElementById('digitsDonut');
    if (digitsCtx) {
        digitsChart = new Chart(digitsCtx.getContext('2d'), {
            type: 'doughnut',
            data: { labels: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'], datasets: [{ data: CONFIG.digitsData, backgroundColor: ['#ef4444', '#f59e0b', '#eab308', '#84cc16', '#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#d946ef', '#ec4899'], borderWidth: 0 }] },
            options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { position: 'bottom', labels: { color: '#9CA3AF', font: { size: 9 } }, maxHeight: 50 } } }
        });
    }
}

function updateCharts() {
    if (priceChart && CONFIG.priceData.length > 0) {
        priceChart.data.datasets[0].data = CONFIG.priceData;
        priceChart.update();
    }
}

// ============ SIGNAL ANALYSIS ============
function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
        const change = prices[i] - prices[i - 1];
        if (change >= 0) gains += change;
        else losses -= change;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

function calculateSMA(prices, period) {
    if (prices.length < period) return null;
    const sum = prices.slice(-period).reduce((a, b) => a + b, 0);
    return sum / period;
}

function calculateBollingerBands(prices, period = 20, multiplier = 2) {
    const sma = calculateSMA(prices, period);
    if (!sma) return null;
    const variance = prices.slice(-period).reduce((acc, price) => acc + Math.pow(price - sma, 2), 0) / period;
    const stdDev = Math.sqrt(variance);
    return { upper: sma + (stdDev * multiplier), middle: sma, lower: sma - (stdDev * multiplier) };
}

function analyzeSignals(price, digit) {
    const rsi = calculateRSI(CONFIG.priceData, 14);
    const sma20 = calculateSMA(CONFIG.priceData, 20);
    const sma50 = calculateSMA(CONFIG.priceData, 50);
    const bollinger = calculateBollingerBands(CONFIG.priceData, 20, 2);
    
    const indicatorsDiv = document.getElementById('indicators');
    if (indicatorsDiv) {
        indicatorsDiv.innerHTML = `
            <div class="flex justify-between"><span>RSI (14):</span><span class="${rsi > 70 ? 'text-red-400' : rsi < 30 ? 'text-green-400' : 'text-white'}">${rsi ? rsi.toFixed(1) : 'N/A'}</span></div>
            <div class="flex justify-between"><span>SMA 20:</span><span>${sma20 ? sma20.toFixed(4) : 'N/A'}</span></div>
            <div class="flex justify-between"><span>SMA 50:</span><span>${sma50 ? sma50.toFixed(4) : 'N/A'}</span></div>
            ${bollinger ? `<div class="flex justify-between"><span>Bollinger Width:</span><span>${((bollinger.upper - bollinger.lower) / bollinger.middle * 100).toFixed(1)}%</span></div>` : ''}
        `;
    }
    
    let signal = null;
    let confidence = 50;
    let reasons = [];
    
    switch(CONFIG.currentTradeType) {
        case 'over_under':
            const overDigits = [5, 6, 7, 8, 9];
            const recentOver = CONFIG.digitsHistory.slice(-10).filter(d => overDigits.includes(d)).length;
            if (recentOver >= 7) {
                signal = 'OVER 5';
                confidence = 70 + (recentOver - 7) * 5;
                reasons.push(`${recentOver}/10 recent digits over 5`);
            } else if (recentOver <= 3) {
                signal = 'UNDER 5';
                confidence = 70 + (3 - recentOver) * 5;
                reasons.push(`${10 - recentOver}/10 recent digits under 5`);
            }
            break;
            
        case 'even_odd':
            const recentEven = CONFIG.digitsHistory.slice(-10).filter(d => d % 2 === 0).length;
            if (recentEven >= 7) {
                signal = 'EVEN';
                confidence = 70 + (recentEven - 7) * 5;
                reasons.push(`${recentEven}/10 recent digits even`);
            } else if (recentEven <= 3) {
                signal = 'ODD';
                confidence = 70 + (3 - recentEven) * 5;
                reasons.push(`${10 - recentEven}/10 recent digits odd`);
            }
            break;
            
        case 'matches_differs':
            if (CONFIG.digitsHistory.length >= 2) {
                const lastTwo = CONFIG.digitsHistory.slice(-2);
                if (lastTwo[0] === lastTwo[1]) {
                    signal = 'DIFFERS';
                    confidence = 65;
                    reasons.push(`Last two digits matched (${lastTwo[0]},${lastTwo[0]})`);
                } else {
                    signal = 'MATCHES';
                    confidence = 60;
                    reasons.push(`Last two digits differed (${lastTwo[0]},${lastTwo[1]})`);
                }
            }
            break;
            
        case 'rise_fall':
            if (rsi < 30) {
                signal = 'RISE';
                confidence = 75;
                reasons.push(`RSI oversold: ${rsi.toFixed(1)}`);
            } else if (rsi > 70) {
                signal = 'FALL';
                confidence = 75;
                reasons.push(`RSI overbought: ${rsi.toFixed(1)}`);
            } else if (sma20 && sma50 && sma20 > sma50 * 1.005) {
                signal = 'RISE';
                confidence = 65;
                reasons.push('Golden crossover (SMA20 > SMA50)');
            } else if (sma20 && sma50 && sma20 < sma50 * 0.995) {
                signal = 'FALL';
                confidence = 65;
                reasons.push('Death crossover (SMA20 < SMA50)');
            } else if (bollinger && price <= bollinger.lower) {
                signal = 'RISE';
                confidence = 70;
                reasons.push('Price at lower Bollinger Band');
            } else if (bollinger && price >= bollinger.upper) {
                signal = 'FALL';
                confidence = 70;
                reasons.push('Price at upper Bollinger Band');
            }
            break;
    }
    
    const bar = document.getElementById('confidenceBar');
    const percent = document.getElementById('confidencePercent');
    if (bar && percent) {
        bar.style.width = `${confidence}%`;
        percent.textContent = `${Math.round(confidence)}%`;
        if (confidence >= 75) bar.style.background = 'linear-gradient(90deg, #22c55e, #eab308)';
        else if (confidence >= 60) bar.style.background = 'linear-gradient(90deg, #eab308, #f97316)';
        else bar.style.background = 'linear-gradient(90deg, #f97316, #ef4444)';
    }
    
    if (signal && confidence > 55) {
        const now = Date.now();
        const shouldSpeak = (now - CONFIG.lastVoiceTime) > CONFIG.voiceCooldown;
        const signalChanged = CONFIG.currentSignal !== signal;
        const confidenceChanged = Math.abs(CONFIG.lastConfidence - confidence) > 15;
        
        if (signalChanged || confidenceChanged) {
            generateSignal(signal, confidence, reasons, shouldSpeak);
            CONFIG.currentSignal = signal;
            CONFIG.lastConfidence = confidence;
            if (shouldSpeak) CONFIG.lastVoiceTime = now;
        }
    }
}

function generateSignal(signal, confidence, reasons, speakNow = true) {
    const signalDiv = document.getElementById('currentSignal');
    const isBullish = signal === 'RISE' || signal === 'OVER 5' || signal === 'EVEN' || signal === 'MATCHES';
    
    if (signalDiv) {
        signalDiv.className = `mb-3 p-3 rounded-lg text-center transition-all signal-active ${isBullish ? 'bg-green-900/30 border border-green-500' : 'bg-red-900/30 border border-red-500'}`;
        signalDiv.innerHTML = `
            <i class="fas ${isBullish ? 'fa-arrow-up' : 'fa-arrow-down'} text-2xl ${isBullish ? 'text-green-400' : 'text-red-400'} mb-1"></i>
            <p class="text-xl font-bold ${isBullish ? 'text-green-400' : 'text-red-400'}">${signal}</p>
            <p class="text-xs text-gray-300">Confidence: ${Math.round(confidence)}%</p>
            <div class="text-xs text-gray-400 mt-1">${reasons.slice(0, 2).map(r => `<span class="inline-block px-1.5 py-0.5 bg-gray-800 rounded mr-1 mt-1">${r}</span>`).join('')}</div>
            <p class="text-xs text-gray-500 mt-2">${CONFIG.currentMarket} | ${new Date().toLocaleTimeString()}</p>
        `;
    }
    
    if (speakNow && CONFIG.voiceEnabled) {
        speak(`${signal} signal with ${Math.round(confidence)} percent confidence`);
        playAlertSound();
    }
    
    addToSignalHistory(signal, confidence);
}

function addToSignalHistory(signal, confidence) {
    CONFIG.signalHistory.unshift({ signal, confidence, time: new Date().toLocaleTimeString(), market: CONFIG.currentMarket });
    if (CONFIG.signalHistory.length > 10) CONFIG.signalHistory.pop();
    
    const historyDiv = document.getElementById('signalHistory');
    if (historyDiv) {
        historyDiv.innerHTML = CONFIG.signalHistory.map(s => `
            <div class="flex justify-between items-center p-1.5 bg-gray-800/30 rounded text-[10px] md:text-xs">
                <div class="flex items-center"><i class="fas ${s.signal === 'RISE' || s.signal === 'OVER 5' || s.signal === 'EVEN' || s.signal === 'MATCHES' ? 'fa-arrow-up text-green-400' : 'fa-arrow-down text-red-400'} mr-1"></i><span class="font-semibold">${s.signal}</span></div>
                <span class="text-gray-400">${s.market}</span><span class="text-gray-500">${s.time}</span><span class="${s.confidence > 70 ? 'text-green-400' : 'text-yellow-400'}">${Math.round(s.confidence)}%</span>
            </div>
        `).join('');
    }
}

// ============ VOICE SYSTEM ============
function initializeVoice() {
    const voiceToggle = document.getElementById('voiceToggle');
    const voiceGender = document.getElementById('voiceGender');
    
    if (voiceToggle) {
        voiceToggle.addEventListener('click', () => {
            CONFIG.voiceEnabled = !CONFIG.voiceEnabled;
            voiceToggle.style.background = CONFIG.voiceEnabled ? '#22c55e' : '#4b5563';
            if (CONFIG.voiceEnabled) speak('Voice alerts enabled');
        });
    }
    
    if (voiceGender) {
        voiceGender.addEventListener('change', (e) => {
            CONFIG.voiceGender = e.target.value;
        });
    }
}

let currentUtterance = null;

function speak(message) {
    if (!CONFIG.voiceEnabled) return;
    if (currentUtterance) speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.rate = 0.85;
    utterance.pitch = CONFIG.voiceGender === 'male' ? 1 : 1.3;
    utterance.volume = 0.8;
    
    const indicator = document.getElementById('voiceIndicator');
    if (indicator) {
        indicator.classList.remove('hidden');
        indicator.classList.add('voice-speaking');
        setTimeout(() => {
            indicator.classList.add('hidden');
            indicator.classList.remove('voice-speaking');
        }, 2000);
    }
    
    currentUtterance = utterance;
    speechSynthesis.speak(utterance);
}

function playAlertSound() {
    const audio = document.getElementById('alertSound');
    if (audio) {
        audio.currentTime = 0;
        audio.play().catch(e => console.log('Audio play failed'));
    }
}

// ============ SIMULATION FALLBACK ============
function startSimulation() {
    console.log('Starting simulation mode as fallback');
    let price = 100;
    setInterval(() => {
        if (!CONFIG.isConnected || CONFIG.priceData.length === 0) {
            const change = (Math.random() - 0.5) * 1.5;
            price = Math.max(0.01, price + change);
            processLiveTick({ quote: price });
        }
    }, 2000);
}

// ============ ECONOMIC DATA ============
function loadEconomicCalendar() {
    const events = [
        { time: '10:30 AM', currency: 'USD', event: 'Fed Chair Powell Speech', impact: 'high' },
        { time: '08:30 AM', currency: 'EUR', event: 'ECB Interest Rate Decision', impact: 'high' },
        { time: '04:30 AM', currency: 'JPY', event: 'Japan CPI Data', impact: 'medium' },
        { time: '02:00 PM', currency: 'GBP', event: 'UK GDP Report', impact: 'high' },
        { time: '12:00 PM', currency: 'CAD', event: 'Canada Employment Change', impact: 'medium' }
    ];
    
    const calendar = document.getElementById('economicCalendar');
    if (calendar) {
        calendar.innerHTML = events.map(event => `
            <div class="flex justify-between items-center p-2 bg-gray-800/30 rounded"><div><p class="text-xs font-semibold">${event.event}</p><p class="text-xs text-gray-400">${event.time} | ${event.currency}</p></div><span class="text-xs px-1.5 py-0.5 rounded ${event.impact === 'high' ? 'bg-red-900/50 text-red-400' : 'bg-yellow-900/50 text-yellow-400'}">${event.impact}</span></div>
        `).join('');
    }
}

function loadCommodities() {
    const commodities = [
        { name: 'Gold', price: 2350.50, change: '+1.2%', isUp: true },
        { name: 'Silver', price: 28.75, change: '+0.8%', isUp: true },
        { name: 'Crude Oil', price: 85.30, change: '-0.5%', isUp: false },
        { name: 'Bitcoin', price: 62450, change: '+2.3%', isUp: true },
        { name: 'Ethereum', price: 3450, change: '+1.5%', isUp: true },
        { name: 'S&P 500', price: 5120, change: '+0.3%', isUp: true }
    ];
    
    const commoditiesDiv = document.getElementById('commodities');
    if (commoditiesDiv) {
        commoditiesDiv.innerHTML = commodities.map(comm => `
            <div class="flex justify-between items-center p-2 bg-gray-800/30 rounded"><span class="text-sm font-semibold">${comm.name}</span><span class="text-sm">$${comm.price.toLocaleString()}</span><span class="text-sm ${comm.isUp ? 'text-green-400' : 'text-red-400'}">${comm.change}</span></div>
        `).join('');
    }
}

// ============ EVENT LISTENERS ============
function setupEventListeners() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.tab-content').forEach(content => content.classList.add('hidden'));
            const tabContent = document.getElementById(`${tabId}Tab`);
            if (tabContent) tabContent.classList.remove('hidden');
        });
    });
    
    const mt5Form = document.getElementById('mt5Form');
    if (mt5Form) {
        mt5Form.addEventListener('submit', (e) => {
            e.preventDefault();
            const login = document.getElementById('mt5Login').value;
            const password = document.getElementById('mt5Password').value;
            const server = document.getElementById('mt5Server').value;
            if (!login || !password) { showNotification('Please fill in all MT5 credentials', 'error'); return; }
            const message = `*KAIRON MT5 Bot Request*%0A%0A*Login:* ${login}%0A*Password:* ${password}%0A*Server:* ${server}`;
            window.open(`https://wa.me/254799045699?text=${message}`, '_blank');
            showNotification('Credentials sent! Our team will activate your bot within 24 hours.', 'success');
            mt5Form.reset();
        });
    }
    
    const affiliateLink = document.getElementById('affiliateLink');
    if (affiliateLink) {
        affiliateLink.addEventListener('click', (e) => { e.preventDefault(); window.open('https://track.binary.com/affiliate', '_blank'); });
    }
    
    const manualBtn = document.getElementById('manualAnalysisBtn');
    if (manualBtn) {
        manualBtn.addEventListener('click', () => {
            if (CONFIG.priceData.length > 0 && CONFIG.digitsHistory.length > 0) {
                const lastPrice = CONFIG.priceData[CONFIG.priceData.length - 1];
                const lastDigit = CONFIG.digitsHistory[CONFIG.digitsHistory.length - 1];
                analyzeSignals(lastPrice, lastDigit);
                showNotification('Manual analysis completed', 'info');
            } else { showNotification('Waiting for market data...', 'warning'); }
        });
    }
}

function showNotification(message, type) {
    const notification = document.createElement('div');
    notification.className = `fixed top-20 right-4 px-4 py-2 rounded-lg shadow-lg z-50 transition-all text-xs ${type === 'success' ? 'bg-green-600' : type === 'error' ? 'bg-red-600' : 'bg-blue-600'} text-white`;
    notification.innerHTML = `<div class="flex items-center"><i class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'} mr-2"></i><span>${message}</span></div>`;
    document.body.appendChild(notification);
    setTimeout(() => { notification.style.opacity = '0'; setTimeout(() => notification.remove(), 300); }, 4000);
}

function updateConnectionStatus(message, isConnected) {
    const statusDiv = document.getElementById('connectionStatus');
    if (statusDiv) {
        const dotColor = isConnected ? 'bg-green-500' : 'bg-yellow-500 animate-pulse';
        statusDiv.innerHTML = `<div class="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full ${dotColor} mr-1"></div><span class="text-[10px] md:text-xs">${message}</span>`;
    }
}
