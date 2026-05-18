// ============ DERIV WEBSOCKET CONFIGURATION ============
const DERIV_APP_ID = '67213';  // Fixed - pure numeric app ID
const DERIV_WS_URL = `wss://ws.binaryws.com/websockets/v3?app_id=${DERIV_APP_ID}`;

// All markets to display
const ALL_MARKETS = [
    'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
    '1HZ10V', '1HZ15V', '1HZ25V', '1HZ30V', 
    '1HZ50V', '1HZ75V', '1HZ90V', '1HZ100V'
];

// Store live data for each market
const MARKET_DATA = {};
ALL_MARKETS.forEach(market => {
    MARKET_DATA[market] = {
        digitsHistory: [],
        priceData: [],
        lastPrice: null,
        lastDigit: null,
        highPrice: null,
        lowPrice: null,
        change: 0,
        connected: false,
        lastUpdate: null
    };
});

// Global variables
let ws = null;
let currentMarket = 'R_100';
let currentTradeType = 'rise_fall';
let digitsData = Array(10).fill(0);
let digitsHistory = [];
let priceData = [];
let signalHistory = [];
let voiceEnabled = true;
let voiceGender = 'male';
let lastVoiceTime = 0;
let voiceCooldown = 5000;
let currentSignal = null;
let lastConfidence = 0;
let selectedOverThreshold = null;
let selectedUnderThreshold = null;
let requestId = 1;
let pendingRequests = new Map();
let priceChart = null;
let digitsChart = null;
let reconnectAttempts = 0;
let maxReconnectAttempts = 10;

// ============ UTILITY FUNCTIONS ============

function getDigitFromPrice(price) {
    const priceStr = price.toString();
    const decimalMatch = priceStr.match(/\.(\d)/);
    if (decimalMatch) {
        return parseInt(decimalMatch[1]);
    }
    return Math.floor(price) % 10;
}

function updateConnectionStatus(message, isConnected) {
    const statusDiv = document.getElementById('connectionStatus');
    if (statusDiv) {
        const dotColor = isConnected ? 'bg-green-500' : 'bg-yellow-500 animate-pulse';
        statusDiv.innerHTML = `<div class="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full ${dotColor} mr-1"></div><span class="text-[10px] md:text-xs">${message}</span>`;
    }
}

function showNotification(message, type) {
    const notification = document.createElement('div');
    notification.className = `fixed top-20 right-4 px-4 py-2 rounded-lg shadow-lg z-50 transition-all text-xs ${type === 'success' ? 'bg-green-600' : type === 'error' ? 'bg-red-600' : 'bg-blue-600'} text-white`;
    notification.innerHTML = `<div class="flex items-center"><i class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'} mr-2"></i><span>${message}</span></div>`;
    document.body.appendChild(notification);
    setTimeout(() => { notification.style.opacity = '0'; setTimeout(() => notification.remove(), 300); }, 4000);
}

function speak(message) {
    if (!voiceEnabled) return;
    if (window.speechSynthesis) {
        const utterance = new SpeechSynthesisUtterance(message);
        utterance.rate = 0.85;
        utterance.pitch = voiceGender === 'male' ? 1 : 1.3;
        utterance.volume = 0.8;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
        
        const indicator = document.getElementById('voiceIndicator');
        if (indicator) {
            indicator.classList.remove('hidden');
            indicator.classList.add('voice-speaking');
            setTimeout(() => {
                indicator.classList.add('hidden');
                indicator.classList.remove('voice-speaking');
            }, 2000);
        }
    }
}

function playAlertSound() {
    const audio = document.getElementById('alertSound');
    if (audio) {
        audio.currentTime = 0;
        audio.play().catch(e => console.log('Audio play failed:', e));
    }
}

function getDigitColor(digit) {
    const colors = ['#ef4444', '#f59e0b', '#eab308', '#84cc16', '#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#d946ef', '#ec4899'];
    return colors[digit];
}

// ============ WEBSOCKET CONNECTION ============

function sendRequest(msgType, params = {}) {
    return new Promise((resolve, reject) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            reject(new Error('WebSocket not connected'));
            return;
        }
        const reqId = requestId++;
        const request = { [msgType]: 1, req_id: reqId, ...params };
        pendingRequests.set(reqId, { resolve, reject });
        
        setTimeout(() => {
            if (pendingRequests.has(reqId)) {
                pendingRequests.delete(reqId);
                reject(new Error(`Request timeout for ${msgType}`));
            }
        }, 10000);
        
        ws.send(JSON.stringify(request));
    });
}

function connectDerivWebSocket() {
    updateConnectionStatus('Connecting to Deriv...', false);
    console.log('Connecting to Deriv WebSocket...');
    
    ws = new WebSocket(DERIV_WS_URL);
    
    ws.onopen = async () => {
        console.log('✅ WebSocket connected');
        updateConnectionStatus('Connected', true);
        reconnectAttempts = 0;
        showNotification('Connected to Deriv Markets', 'success');
        
        // Subscribe to all markets
        await subscribeToAllMarkets();
        
        // Fetch initial data for current market
        await fetchHistoricalData(currentMarket);
    };
    
    ws.onmessage = (event) => {
        try {
            const response = JSON.parse(event.data);
            handleDerivResponse(response);
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
        }
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        updateConnectionStatus('Connection error', false);
    };
    
    ws.onclose = () => {
        console.log('WebSocket disconnected');
        updateConnectionStatus('Disconnected, reconnecting...', false);
        
        // Attempt to reconnect
        if (reconnectAttempts < maxReconnectAttempts) {
            reconnectAttempts++;
            setTimeout(connectDerivWebSocket, 5000 * Math.min(reconnectAttempts, 5));
        } else {
            updateConnectionStatus('Connection failed', false);
            showNotification('Unable to connect to Deriv. Using simulation mode.', 'error');
            startSimulationMode();
        }
    };
}

async function subscribeToAllMarkets() {
    console.log('Subscribing to all markets...');
    
    for (const market of ALL_MARKETS) {
        try {
            await sendRequest('ticks', { ticks: market, subscribe: 1 });
            MARKET_DATA[market].connected = true;
            console.log(`✅ Subscribed to ${market}`);
        } catch (error) {
            console.error(`Failed to subscribe to ${market}:`, error);
            MARKET_DATA[market].connected = false;
        }
    }
    
    showNotification(`Subscribed to ${ALL_MARKETS.length} markets`, 'success');
}

async function fetchHistoricalData(market, count = 1000) {
    try {
        const response = await sendRequest('ticks_history', {
            ticks_history: market,
            adjust_start_time: 1,
            count: count,
            end: 'latest',
            style: 'ticks'
        });
        
        if (response && response.history && response.history.prices) {
            const prices = response.history.prices.map(p => parseFloat(p));
            const digits = [];
            
            prices.forEach(price => {
                digits.push(getDigitFromPrice(price));
            });
            
            // Update market data
            MARKET_DATA[market].priceData = prices;
            MARKET_DATA[market].digitsHistory = digits;
            MARKET_DATA[market].lastPrice = prices[prices.length - 1];
            MARKET_DATA[market].lastDigit = digits[digits.length - 1];
            MARKET_DATA[market].highPrice = Math.max(...prices);
            MARKET_DATA[market].lowPrice = Math.min(...prices);
            MARKET_DATA[market].lastUpdate = new Date();
            
            // If this is the current market, update the UI
            if (market === currentMarket) {
                priceData = prices;
                digitsHistory = digits;
                updateDigitFrequency();
                updatePriceStats();
                updateCharts();
                updateLDP();
                updateThresholdStats();
            }
            
            console.log(`Fetched ${prices.length} ticks for ${market}`);
        }
    } catch (error) {
        console.error(`Failed to fetch historical data for ${market}:`, error);
    }
}

function handleDerivResponse(response) {
    // Handle request responses
    if (response.req_id && pendingRequests.has(response.req_id)) {
        const { resolve, reject } = pendingRequests.get(response.req_id);
        pendingRequests.delete(response.req_id);
        if (response.error) {
            reject(response.error);
        } else {
            resolve(response);
        }
        return;
    }
    
    // Handle live tick data
    if (response.msg_type === 'tick' && response.tick) {
        processLiveTick(response.tick);
    }
}

function processLiveTick(tick) {
    const market = tick.symbol;
    const price = parseFloat(tick.quote);
    const digit = getDigitFromPrice(price);
    
    // Update market data
    if (MARKET_DATA[market]) {
        MARKET_DATA[market].priceData.push(price);
        MARKET_DATA[market].digitsHistory.push(digit);
        MARKET_DATA[market].lastPrice = price;
        MARKET_DATA[market].lastDigit = digit;
        MARKET_DATA[market].lastUpdate = new Date();
        
        // Limit history size
        if (MARKET_DATA[market].priceData.length > 1000) {
            MARKET_DATA[market].priceData.shift();
            MARKET_DATA[market].digitsHistory.shift();
        }
        
        // Update high/low
        if (MARKET_DATA[market].highPrice === null || price > MARKET_DATA[market].highPrice) {
            MARKET_DATA[market].highPrice = price;
        }
        if (MARKET_DATA[market].lowPrice === null || price < MARKET_DATA[market].lowPrice) {
            MARKET_DATA[market].lowPrice = price;
        }
        
        // Calculate change
        if (MARKET_DATA[market].priceData.length > 1) {
            const prevPrice = MARKET_DATA[market].priceData[MARKET_DATA[market].priceData.length - 2];
            MARKET_DATA[market].change = ((price - prevPrice) / prevPrice) * 100;
        }
    }
    
    // If this is the current market, update UI
    if (market === currentMarket) {
        priceData = MARKET_DATA[market].priceData;
        digitsHistory = MARKET_DATA[market].digitsHistory;
        
        updateDigitFrequency();
        updatePriceStats();
        updateCharts();
        updateLDP();
        updateThresholdStats();
        analyzeSignals(price, digit);
        
        if (selectedOverThreshold !== null || selectedUnderThreshold !== null) {
            analyzeOverUnderThreshold();
        }
    }
}

// ============ UI UPDATE FUNCTIONS ============

function updateDigitFrequency() {
    digitsData = Array(10).fill(0);
    digitsHistory.forEach(d => {
        if (d >= 0 && d <= 9) digitsData[d]++;
    });
    
    const total = digitsHistory.length || 1;
    const dominantDigit = digitsData.indexOf(Math.max(...digitsData));
    document.getElementById('dominantDigit').textContent = dominantDigit;
    
    const statsDiv = document.getElementById('digitsStats');
    if (statsDiv) {
        statsDiv.innerHTML = digitsData.map((count, i) => `
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
        digitsChart.data.datasets[0].data = digitsData;
        digitsChart.update();
    }
}

function updatePriceStats() {
    if (priceData.length === 0) return;
    
    const lastPrice = priceData[priceData.length - 1];
    const highPrice = Math.max(...priceData);
    const lowPrice = Math.min(...priceData);
    
    document.getElementById('lastPrice').textContent = lastPrice.toFixed(4);
    document.getElementById('highPrice').textContent = highPrice.toFixed(4);
    document.getElementById('lowPrice').textContent = lowPrice.toFixed(4);
    
    if (priceData.length > 1) {
        const prevPrice = priceData[priceData.length - 2];
        const change = ((lastPrice - prevPrice) / prevPrice * 100);
        const changeEl = document.getElementById('priceChange');
        changeEl.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
        changeEl.className = `font-bold ${change >= 0 ? 'text-green-400' : 'text-red-400'}`;
    }
}

function updateLDP() {
    const ldpGrid = document.getElementById('ldpGrid');
    if (!ldpGrid) return;
    
    const last20 = [...digitsHistory].slice(-20).reverse();
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

function updateThresholdStats() {
    const total = digitsHistory.length || 1;
    
    for (let i = 0; i <= 6; i++) {
        const count = digitsHistory.filter(d => d > i).length;
        const percent = (count / total) * 100;
        const element = document.getElementById(`over${i}Percent`);
        if (element) element.textContent = `${percent.toFixed(1)}%`;
    }
    
    for (let i = 3; i <= 9; i++) {
        const count = digitsHistory.filter(d => d < i).length;
        const percent = (count / total) * 100;
        const element = document.getElementById(`under${i}Percent`);
        if (element) element.textContent = `${percent.toFixed(1)}%`;
    }
}

function analyzeOverUnderThreshold() {
    const signalDiv = document.getElementById('thresholdSignal');
    if (!signalDiv) return;
    
    const total = digitsHistory.length || 1;
    let signal = null;
    let confidence = 0;
    let message = '';
    
    if (selectedOverThreshold !== null) {
        const threshold = selectedOverThreshold;
        const count = digitsHistory.filter(d => d > threshold).length;
        const percent = (count / total) * 100;
        const recentCount = digitsHistory.slice(-10).filter(d => d > threshold).length;
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
    } else if (selectedUnderThreshold !== null) {
        const threshold = selectedUnderThreshold;
        const count = digitsHistory.filter(d => d < threshold).length;
        const percent = (count / total) * 100;
        const recentCount = digitsHistory.slice(-10).filter(d => d < threshold).length;
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
        signalDiv.innerHTML = `<p class="text-sm font-bold ${signal.includes('OVER') ? 'text-green-400' : 'text-red-400'}">${signal} SIGNAL DETECTED</p><p class="text-xs">${message}</p><p class="text-xs text-gray-400 mt-1">Confidence: ${Math.round(confidence)}%</p>`;
        signalDiv.classList.remove('hidden');
        
        const now = Date.now();
        if (now - lastVoiceTime > voiceCooldown) {
            speak(`${signal} signal with ${Math.round(confidence)} percent confidence based on threshold analysis`);
            lastVoiceTime = now;
        }
    } else {
        signalDiv.innerHTML = `<p class="text-xs text-center text-gray-400">${message}</p>`;
        signalDiv.classList.remove('hidden');
    }
}

function initializeCharts() {
    const priceCtx = document.getElementById('priceChart');
    if (priceCtx) {
        priceChart = new Chart(priceCtx.getContext('2d'), {
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
                    x: { display: false }
                }
            }
        });
    }
    
    const digitsCtx = document.getElementById('digitsDonut');
    if (digitsCtx) {
        digitsChart = new Chart(digitsCtx.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
                datasets: [{
                    data: digitsData,
                    backgroundColor: ['#ef4444', '#f59e0b', '#eab308', '#84cc16', '#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#d946ef', '#ec4899'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: { position: 'bottom', labels: { color: '#9CA3AF', font: { size: 9 } }, maxHeight: 50 }
                }
            }
        });
    }
}

function updateCharts() {
    if (priceChart && priceData.length > 0) {
        priceChart.data.datasets[0].data = priceData;
        priceChart.update();
    }
}

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
    const rsi = calculateRSI(priceData, 14);
    const sma20 = calculateSMA(priceData, 20);
    const sma50 = calculateSMA(priceData, 50);
    const bollinger = calculateBollingerBands(priceData, 20, 2);
    
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
    
    switch(currentTradeType) {
        case 'over_under':
            const overDigits = [5, 6, 7, 8, 9];
            const recentOver = digitsHistory.slice(-10).filter(d => overDigits.includes(d)).length;
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
            const recentEven = digitsHistory.slice(-10).filter(d => d % 2 === 0).length;
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
            if (digitsHistory.length >= 2) {
                const lastTwo = digitsHistory.slice(-2);
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
        const shouldSpeak = (now - lastVoiceTime) > voiceCooldown;
        const signalChanged = currentSignal !== signal;
        const confidenceChanged = Math.abs(lastConfidence - confidence) > 15;
        
        if (signalChanged || confidenceChanged) {
            generateSignal(signal, confidence, reasons, shouldSpeak);
            currentSignal = signal;
            lastConfidence = confidence;
            if (shouldSpeak) lastVoiceTime = now;
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
            <p class="text-xs text-gray-500 mt-2">${currentMarket} | ${new Date().toLocaleTimeString()}</p>
        `;
    }
    
    if (speakNow && voiceEnabled) {
        speak(`${signal} signal with ${Math.round(confidence)} percent confidence`);
        playAlertSound();
    }
    
    addToSignalHistory(signal, confidence);
}

function addToSignalHistory(signal, confidence) {
    signalHistory.unshift({ signal, confidence, time: new Date().toLocaleTimeString(), market: currentMarket });
    if (signalHistory.length > 10) signalHistory.pop();
    
    const historyDiv = document.getElementById('signalHistory');
    if (historyDiv) {
        historyDiv.innerHTML = signalHistory.map(s => `
            <div class="flex justify-between items-center p-1.5 bg-gray-800/30 rounded text-[10px] md:text-xs">
                <div class="flex items-center">
                    <i class="fas ${s.signal === 'RISE' || s.signal === 'OVER 5' || s.signal === 'EVEN' || s.signal === 'MATCHES' ? 'fa-arrow-up text-green-400' : 'fa-arrow-down text-red-400'} mr-1"></i>
                    <span class="font-semibold">${s.signal}</span>
                </div>
                <span class="text-gray-400">${s.market}</span>
                <span class="text-gray-500">${s.time}</span>
                <span class="${s.confidence > 70 ? 'text-green-400' : 'text-yellow-400'}">${Math.round(s.confidence)}%</span>
            </div>
        `).join('');
    }
}

// ============ SIMULATION MODE (FALLBACK) ============

function startSimulationMode() {
    console.log('Starting simulation mode as fallback');
    showNotification('Using simulation mode - WebSocket unavailable', 'warning');
    
    let simPrice = 100;
    setInterval(() => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            const change = (Math.random() - 0.5) * 1.5;
            simPrice = Math.max(0.01, simPrice + change);
            processLiveTick({ symbol: currentMarket, quote: simPrice });
        }
    }, 2000);
}

// ============ MARKET INITIALIZATION ============

function initializeMarkets() {
    const marketGrid = document.getElementById('marketGrid');
    if (!marketGrid) return;
    
    marketGrid.innerHTML = ALL_MARKETS.map(market => `
        <button class="market-btn px-2 md:px-3 py-1 md:py-1.5 rounded-lg text-[10px] md:text-xs whitespace-nowrap transition ${currentMarket === market ? 'active bg-gradient-to-r from-blue-600 to-purple-600' : 'bg-gray-800/50'}" data-market="${market}">
            <i class="fas fa-chart-line mr-1"></i>${market}
        </button>
    `).join('');
    
    document.querySelectorAll('.market-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            document.querySelectorAll('.market-btn').forEach(b => b.classList.remove('active', 'bg-gradient-to-r', 'from-blue-600', 'to-purple-600'));
            btn.classList.add('active', 'bg-gradient-to-r', 'from-blue-600', 'to-purple-600');
            
            const newMarket = btn.dataset.market;
            currentMarket = newMarket;
            document.getElementById('currentMarketDisplay').innerText = currentMarket;
            
            // Load data for the selected market
            if (MARKET_DATA[newMarket] && MARKET_DATA[newMarket].priceData.length > 0) {
                priceData = MARKET_DATA[newMarket].priceData;
                digitsHistory = MARKET_DATA[newMarket].digitsHistory;
                updateDigitFrequency();
                updatePriceStats();
                updateCharts();
                updateLDP();
                updateThresholdStats();
                showNotification(`Switched to ${newMarket}`, 'info');
            } else {
                await fetchHistoricalData(newMarket);
            }
        });
    });
    
    // Trade type buttons
    document.querySelectorAll('.trade-type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.trade-type-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentTradeType = btn.dataset.type;
            showNotification(`Trading type: ${currentTradeType.replace('_', ' ').toUpperCase()}`, 'info');
        });
    });
    
    // Tick selector
    const tickSelector = document.getElementById('tickSelector');
    if (tickSelector) {
        tickSelector.addEventListener('change', async (e) => {
            const newCount = parseInt(e.target.value);
            showNotification(`Fetching ${newCount} ticks...`, 'info');
            await fetchHistoricalData(currentMarket, newCount);
        });
    }
    
    // Refresh button
    const refreshBtn = document.getElementById('refreshDataBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
            await fetchHistoricalData(currentMarket);
            showNotification('Market data refreshed', 'success');
        });
    }
    
    // Over/Under threshold buttons
    document.querySelectorAll('[data-over]').forEach(el => {
        el.addEventListener('click', () => {
            const threshold = parseInt(el.dataset.over);
            selectedOverThreshold = threshold;
            selectedUnderThreshold = null;
            document.querySelectorAll('[data-over], [data-under]').forEach(e => e.classList.remove('selected'));
            el.classList.add('selected');
            analyzeOverUnderThreshold();
        });
    });
    
    document.querySelectorAll('[data-under]').forEach(el => {
        el.addEventListener('click', () => {
            const threshold = parseInt(el.dataset.under);
            selectedUnderThreshold = threshold;
            selectedOverThreshold = null;
            document.querySelectorAll('[data-over], [data-under]').forEach(e => e.classList.remove('selected'));
            el.classList.add('selected');
            analyzeOverUnderThreshold();
        });
    });
}

// ============ VOICE SETUP ============

function initializeVoice() {
    const voiceToggle = document.getElementById('voiceToggle');
    const voiceGenderSelect = document.getElementById('voiceGender');
    
    if (voiceToggle) {
        voiceToggle.addEventListener('click', () => {
            voiceEnabled = !voiceEnabled;
            voiceToggle.style.background = voiceEnabled ? '#22c55e' : '#4b5563';
            if (voiceEnabled) speak('Voice alerts enabled');
        });
    }
    
    if (voiceGenderSelect) {
        voiceGenderSelect.addEventListener('change', (e) => {
            voiceGender = e.target.value;
        });
    }
}

// ============ MARKET NEWS & DATA ============

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
            <div class="flex justify-between items-center p-2 bg-gray-800/30 rounded">
                <div>
                    <p class="text-xs font-semibold">${event.event}</p>
                    <p class="text-xs text-gray-400">${event.time} | ${event.currency}</p>
                </div>
                <span class="text-xs px-1.5 py-0.5 rounded ${event.impact === 'high' ? 'bg-red-900/50 text-red-400' : 'bg-yellow-900/50 text-yellow-400'}">${event.impact}</span>
            </div>
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
            <div class="flex justify-between items-center p-2 bg-gray-800/30 rounded">
                <span class="text-sm font-semibold">${comm.name}</span>
                <span class="text-sm">$${comm.price.toLocaleString()}</span>
                <span class="text-sm ${comm.isUp ? 'text-green-400' : 'text-red-400'}">${comm.change}</span>
            </div>
        `).join('');
    }
}

async function loadLiveNews() {
    const newsFeed = document.getElementById('newsFeed');
    if (!newsFeed) return;
    
    const demoNews = [
        { title: 'Federal Reserve signals rate cut in September', source: 'Bloomberg', impact: 'high', time: '2h ago' },
        { title: 'Gold hits all-time high above $2,400', source: 'Reuters', impact: 'high', time: '3h ago' },
        { title: 'Oil prices surge 5% on Middle East tensions', source: 'CNBC', impact: 'medium', time: '5h ago' },
        { title: 'Bitcoin volatility expected ahead of halving', source: 'CoinDesk', impact: 'medium', time: '6h ago' },
        { title: 'European markets close higher on tech rally', source: 'FT', impact: 'low', time: '8h ago' }
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

// ============ EVENT LISTENERS ============

function setupEventListeners() {
    // Tab switching
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
    
    // MT5 Form
    const mt5Form = document.getElementById('mt5Form');
    if (mt5Form) {
        mt5Form.addEventListener('submit', (e) => {
            e.preventDefault();
            const login = document.getElementById('mt5Login').value;
            const password = document.getElementById('mt5Password').value;
            const server = document.getElementById('mt5Server').value;
            
            if (!login || !password) {
                showNotification('Please fill in all MT5 credentials', 'error');
                return;
            }
            
            const message = `*KAIRON MT5 Bot Request*%0A%0A*Login:* ${login}%0A*Password:* ${password}%0A*Server:* ${server}`;
            window.open(`https://wa.me/254799045699?text=${message}`, '_blank');
            showNotification('Credentials sent! Our team will activate your bot within 24 hours.', 'success');
            mt5Form.reset();
        });
    }
    
    // Affiliate link
    const affiliateLink = document.getElementById('affiliateLink');
    if (affiliateLink) {
        affiliateLink.addEventListener('click', (e) => {
            e.preventDefault();
            window.open('https://track.binary.com/affiliate', '_blank');
        });
    }
    
    // Manual analysis button
    const manualBtn = document.getElementById('manualAnalysisBtn');
    if (manualBtn) {
        manualBtn.addEventListener('click', () => {
            if (priceData.length > 0 && digitsHistory.length > 0) {
                const lastPrice = priceData[priceData.length - 1];
                const lastDigit = digitsHistory[digitsHistory.length - 1];
                analyzeSignals(lastPrice, lastDigit);
                showNotification('Manual analysis completed', 'info');
            } else {
                showNotification('Waiting for market data...', 'warning');
            }
        });
    }
}

// ============ MAIN INITIALIZATION ============

function startTradingApp() {
    console.log('KAIRON Systems Initialized with Deriv WebSocket');
    console.log(`Using App ID: ${DERIV_APP_ID}`);
    console.log(`Connecting to: ${DERIV_WS_URL}`);
    
    initializeMarkets();
    initializeCharts();
    initializeVoice();
    setupEventListeners();
    loadEconomicCalendar();
    loadCommodities();
    loadLiveNews();
    connectDerivWebSocket();
}

// ============ SECURE LOGIN SYSTEM ============
(function() {
    const SECRET_UNLOCK_CODE = "42055578";
    const VALID_EMAIL = "caleborenge08@gmail.com";
    const VALID_PASSWORD = "@Calekyzfx22";
    
    const STORAGE_KEYS = {
        ACTIVE_DEVICES: "kairon_active_devices",
        CURRENT_DEVICE: "kairon_device_id",
        IS_LOCKED: "kairon_is_locked",
        IS_AUTHENTICATED: "kairon_authenticated"
    };
    
    function getOrCreateDeviceId() {
        let deviceId = localStorage.getItem(STORAGE_KEYS.CURRENT_DEVICE);
        if (!deviceId) {
            deviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem(STORAGE_KEYS.CURRENT_DEVICE, deviceId);
        }
        return deviceId;
    }
    
    function getActiveDevices() {
        const devices = localStorage.getItem(STORAGE_KEYS.ACTIVE_DEVICES);
        if (!devices) return [];
        try {
            return JSON.parse(devices);
        } catch(e) {
            return [];
        }
    }
    
    function saveActiveDevices(devices) {
        localStorage.setItem(STORAGE_KEYS.ACTIVE_DEVICES, JSON.stringify(devices));
    }
    
    function registerDevice() {
        const deviceId = getOrCreateDeviceId();
        let devices = getActiveDevices();
        if (!devices.includes(deviceId)) {
            devices.push(deviceId);
            saveActiveDevices(devices);
        }
        return devices;
    }
    
    function checkForMultiDevice() {
        const devices = getActiveDevices();
        const uniqueDevices = [...new Set(devices)];
        if (uniqueDevices.length > 1) {
            localStorage.setItem(STORAGE_KEYS.IS_LOCKED, "true");
            localStorage.removeItem(STORAGE_KEYS.IS_AUTHENTICATED);
            return true;
        }
        return false;
    }
    
    function unlockSystem(unlockCode) {
        if (unlockCode === SECRET_UNLOCK_CODE) {
            localStorage.setItem(STORAGE_KEYS.IS_LOCKED, "false");
            const currentDevice = getOrCreateDeviceId();
            saveActiveDevices([currentDevice]);
            localStorage.setItem(STORAGE_KEYS.IS_AUTHENTICATED, "true");
            return true;
        }
        return false;
    }
    
    function login(email, password) {
        if (email === VALID_EMAIL && password === VALID_PASSWORD) {
            const isLocked = localStorage.getItem(STORAGE_KEYS.IS_LOCKED) === "true";
            if (isLocked) {
                return { success: false, locked: true, message: "System is locked. Please enter unlock code." };
            }
            registerDevice();
            const multiDeviceLock = checkForMultiDevice();
            if (multiDeviceLock) {
                return { success: false, locked: true, message: "Multiple devices detected! System locked. Enter unlock code." };
            }
            localStorage.setItem(STORAGE_KEYS.IS_AUTHENTICATED, "true");
            return { success: true };
        }
        return { success: false, locked: false, message: "Invalid email or password" };
    }
    
    function checkAuthStatus() {
        const isAuthenticated = localStorage.getItem(STORAGE_KEYS.IS_AUTHENTICATED) === "true";
        const isLocked = localStorage.getItem(STORAGE_KEYS.IS_LOCKED) === "true";
        
        if (isLocked) {
            return { authenticated: false, locked: true };
        }
        if (isAuthenticated) {
            const devices = getActiveDevices();
            if (devices.length > 1) {
                localStorage.setItem(STORAGE_KEYS.IS_LOCKED, "true");
                localStorage.removeItem(STORAGE_KEYS.IS_AUTHENTICATED);
                return { authenticated: false, locked: true };
            }
            return { authenticated: true, locked: false };
        }
        return { authenticated: false, locked: false };
    }
    
    function showLoginModal() {
        const overlay = document.createElement('div');
        overlay.className = 'login-overlay';
        overlay.id = 'loginOverlay';
        overlay.innerHTML = `
            <div class="login-modal">
                <h2><i class="fas fa-shield-alt mr-2"></i>KAIRON SECURE ACCESS</h2>
                <input type="email" id="loginEmail" placeholder="Email Address" autocomplete="off">
                <input type="password" id="loginPassword" placeholder="Password">
                <button id="loginBtn">ACCESS PLATFORM</button>
                <div id="loginError" class="error-message"></div>
            </div>
        `;
        document.body.appendChild(overlay);
        
        document.getElementById('loginBtn').addEventListener('click', () => {
            const email = document.getElementById('loginEmail').value;
            const password = document.getElementById('loginPassword').value;
            const result = login(email, password);
            
            if (result.success) {
                overlay.remove();
                initializeFullApp();
            } else if (result.locked) {
                showLockModal();
                overlay.remove();
            } else {
                document.getElementById('loginError').textContent = result.message;
            }
        });
        
        overlay.querySelectorAll('input').forEach(input => {
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    document.getElementById('loginBtn').click();
                }
            });
        });
    }
    
    function showLockModal() {
        const overlay = document.createElement('div');
        overlay.className = 'lock-overlay';
        overlay.id = 'lockOverlay';
        overlay.innerHTML = `
            <div class="lock-modal">
                <h2><i class="fas fa-lock mr-2"></i>SYSTEM LOCKED</h2>
                <div class="lock-warning">
                    <i class="fas fa-exclamation-triangle mr-2"></i>
                    Multiple devices detected! Access blocked for security.
                </div>
                <input type="text" id="unlockCode" placeholder="Enter Unlock Code" maxlength="8" autocomplete="off">
                <button id="unlockBtn">UNLOCK SYSTEM</button>
                <div id="unlockError" class="error-message"></div>
            </div>
        `;
        document.body.appendChild(overlay);
        
        document.getElementById('unlockBtn').addEventListener('click', () => {
            const code = document.getElementById('unlockCode').value;
            if (unlockSystem(code)) {
                overlay.remove();
                showLoginModal();
            } else {
                document.getElementById('unlockError').textContent = 'Invalid unlock code. Please try again.';
            }
        });
        
        document.getElementById('unlockCode').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                document.getElementById('unlockBtn').click();
            }
        });
    }
    
    function initializeFullApp() {
        setTimeout(() => {
            const loader = document.getElementById('loader');
            const mainContent = document.getElementById('mainContent');
            if (loader && mainContent) {
                loader.style.opacity = '0';
                setTimeout(() => {
                    loader.style.display = 'none';
                    mainContent.style.display = 'block';
                    startTradingApp();
                }, 500);
            }
        }, 2000);
    }
    
    function initAuth() {
        const status = checkAuthStatus();
        if (status.authenticated) {
            const devices = getActiveDevices();
            if (devices.length > 1) {
                localStorage.setItem(STORAGE_KEYS.IS_LOCKED, "true");
                localStorage.removeItem(STORAGE_KEYS.IS_AUTHENTICATED);
                showLockModal();
            } else {
                initializeFullApp();
            }
        } else if (status.locked) {
            showLockModal();
        } else {
            showLoginModal();
        }
    }
    
    setTimeout(initAuth, 3000);
})();
