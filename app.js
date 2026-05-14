// ============ DERIV WEBSOCKET CONFIGURATION ============
const DERIV_CONFIG = {
    wsUrl: 'wss://ws.binaryws.com/websockets/v3?app_id=1089', // Deriv test app
    activeSymbols: [
        'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
        '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'
    ],
    granularity: 60, // 1 minute candles
    candleCount: 100,
    reconnectDelay: 3000,
    maxReconnectAttempts: 10
};

let derivSocket = null;
let reconnectAttempts = 0;
let isConnected = false;
let pendingRequests = new Map();
let requestId = 1;
let activeSubscriptions = new Set();

// Market data storage
const marketData = {
    ticks: [],
    candles: [],
    digits: Array(10).fill(0),
    digitsHistory: [],
    lastPrice: 0,
    currentCandle: null,
    indicators: {
        sma20: null,
        sma50: null,
        rsi: null,
        bollinger: null,
        macd: null
    }
};

// ============ DERIV WEBSOCKET CONNECTION ============
async function connectDerivWebSocket() {
    return new Promise((resolve, reject) => {
        if (derivSocket && derivSocket.readyState === WebSocket.OPEN) {
            resolve();
            return;
        }

        derivSocket = new WebSocket(DERIV_CONFIG.wsUrl);

        derivSocket.onopen = () => {
            console.log('✅ Connected to Deriv WebSocket');
            isConnected = true;
            reconnectAttempts = 0;
            updateConnectionStatus('Connected', true);
            
            // Authorize (optional - for trading)
            // sendDerivRequest('authorize', { authorize: 'YOUR_API_TOKEN' });
            
            resolve();
        };

        derivSocket.onmessage = (event) => {
            try {
                const response = JSON.parse(event.data);
                handleDerivResponse(response);
            } catch (error) {
                console.error('Error parsing message:', error);
            }
        };

        derivSocket.onerror = (error) => {
            console.error('WebSocket error:', error);
            updateConnectionStatus('Error', false);
            reject(error);
        };

        derivSocket.onclose = () => {
            console.log('WebSocket disconnected');
            isConnected = false;
            updateConnectionStatus('Disconnected', false);
            attemptReconnect();
        };
    });
}

function attemptReconnect() {
    if (reconnectAttempts < DERIV_CONFIG.maxReconnectAttempts) {
        reconnectAttempts++;
        console.log(`Reconnecting... Attempt ${reconnectAttempts}/${DERIV_CONFIG.maxReconnectAttempts}`);
        setTimeout(() => {
            connectDerivWebSocket().catch(console.error);
        }, DERIV_CONFIG.reconnectDelay);
    } else {
        console.error('Max reconnection attempts reached');
        updateConnectionStatus('Failed to connect', false);
    }
}

function updateConnectionStatus(status, isOnline) {
    const statusElement = document.getElementById('connectionStatus');
    if (statusElement) {
        statusElement.innerHTML = `
            <div class="flex items-center">
                <div class="w-2 h-2 rounded-full ${isOnline ? 'bg-green-500' : 'bg-red-500'} mr-2 animate-pulse"></div>
                <span class="text-xs">Deriv: ${status}</span>
            </div>
        `;
    }
}

// ============ DERIV API REQUESTS ============
function sendDerivRequest(msgType, params = {}) {
    return new Promise((resolve, reject) => {
        if (!derivSocket || derivSocket.readyState !== WebSocket.OPEN) {
            reject(new Error('WebSocket not connected'));
            return;
        }

        const reqId = requestId++;
        const request = {
            [msgType]: 1,
            req_id: reqId,
            ...params
        };

        pendingRequests.set(reqId, { resolve, reject, timestamp: Date.now() });

        // Set timeout for request
        setTimeout(() => {
            if (pendingRequests.has(reqId)) {
                pendingRequests.delete(reqId);
                reject(new Error(`Request timeout: ${msgType}`));
            }
        }, 30000);

        derivSocket.send(JSON.stringify(request));
    });
}

// ============ FETCH HISTORICAL CANDLES ============
async function fetchHistoricalCandles(symbol, count = 100, granularity = 60) {
    const end = 'latest';
    
    const response = await sendDerivRequest('ticks_history', {
        ticks_history: symbol,
        adjust_start_time: 1,
        count: count,
        end: end,
        granularity: granularity,
        style: 'candles'
    });
    
    if (response.error) {
        console.error('Error fetching candles:', response.error);
        return [];
    }
    
    // Parse candles from response
    const candles = [];
    if (response.candles) {
        for (const candle of response.candles) {
            candles.push({
                epoch: candle.epoch * 1000, // Convert to milliseconds
                open: parseFloat(candle.open),
                high: parseFloat(candle.high),
                low: parseFloat(candle.low),
                close: parseFloat(candle.close)
            });
        }
    }
    
    console.log(`Fetched ${candles.length} candles for ${symbol}`);
    return candles;
}

// ============ SUBSCRIBE TO LIVE TICKS ============
async function subscribeToTicks(symbol) {
    // Unsubscribe from previous subscription
    if (activeSubscriptions.has('ticks')) {
        await sendDerivRequest('forget', { forget: 'ticks' });
        activeSubscriptions.delete('ticks');
    }
    
    const response = await sendDerivRequest('ticks', {
        ticks: symbol,
        subscribe: 1
    });
    
    if (response.error) {
        console.error('Error subscribing to ticks:', response.error);
        return false;
    }
    
    activeSubscriptions.add('ticks');
    console.log(`Subscribed to ticks for ${symbol}`);
    return true;
}

// ============ SUBSCRIBE TO CANDLES ============
async function subscribeToCandles(symbol, granularity = 60) {
    // Unsubscribe from previous subscription
    if (activeSubscriptions.has('candles')) {
        await sendDerivRequest('forget', { forget: 'candles' });
        activeSubscriptions.delete('candles');
    }
    
    const response = await sendDerivRequest('ticks_history', {
        ticks_history: symbol,
        adjust_start_time: 1,
        count: 1,
        end: 'latest',
        granularity: granularity,
        style: 'candles',
        subscribe: 1
    });
    
    if (response.error) {
        console.error('Error subscribing to candles:', response.error);
        return false;
    }
    
    activeSubscriptions.add('candles');
    console.log(`Subscribed to candles for ${symbol}`);
    return true;
}

// ============ FETCH ACTIVE SYMBOLS ============
async function fetchActiveSymbols() {
    const response = await sendDerivRequest('active_symbols', {
        active_symbols: 'brief',
        product_type: 'basic'
    });
    
    if (response.error) {
        console.error('Error fetching symbols:', response.error);
        return [];
    }
    
    return response.active_symbols || [];
}

// ============ HANDLE DERIV RESPONSES ============
function handleDerivResponse(response) {
    // Handle pending request responses
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
    
    // Handle tick updates
    if (response.msg_type === 'tick' && response.tick) {
        handleTickUpdate(response.tick);
    }
    
    // Handle candle updates
    if (response.msg_type === 'candles' && response.candles) {
        handleCandleUpdate(response.candles);
    }
}

// ============ PROCESS TICK UPDATE ============
function handleTickUpdate(tick) {
    const price = parseFloat(tick.quote);
    const epoch = tick.epoch * 1000;
    
    marketData.lastPrice = price;
    
    // Extract digit from price
    const priceStr = price.toString();
    const digitMatch = priceStr.match(/\.(\d)/);
    const digit = digitMatch ? parseInt(digitMatch[1]) : Math.floor(price) % 10;
    
    // Update digits history
    marketData.digitsHistory.push(digit);
    if (marketData.digitsHistory.length > CONFIG.maxHistory) {
        marketData.digitsHistory.shift();
    }
    
    // Update digit frequency
    marketData.digits = Array(10).fill(0);
    marketData.digitsHistory.forEach(d => marketData.digits[d]++);
    
    // Add to price data for chart
    CONFIG.priceData.push(price);
    if (CONFIG.priceData.length > 100) {
        CONFIG.priceData.shift();
    }
    
    // Update UI
    updatePriceDisplay(price);
    updateDigitsDisplay();
    updateDigitsDonutChart();
    updatePriceChart();
    
    // Analyze for signals
    analyzeDigitsPattern();
    analyzePriceActionForSignal(price);
}

// ============ PROCESS CANDLE UPDATE ============
function handleCandleUpdate(candles) {
    if (!candles || candles.length === 0) return;
    
    const candle = candles[candles.length - 1];
    marketData.currentCandle = {
        epoch: candle.epoch * 1000,
        open: parseFloat(candle.open),
        high: parseFloat(candle.high),
        low: parseFloat(candle.low),
        close: parseFloat(candle.close)
    };
    
    // Add to price data
    CONFIG.priceData.push(marketData.currentCandle.close);
    if (CONFIG.priceData.length > 100) {
        CONFIG.priceData.shift();
    }
    
    updatePriceChart();
    
    // Recalculate indicators on candle close
    calculateTechnicalIndicators();
}

// ============ TECHNICAL INDICATORS ============
function calculateSMA(prices, period) {
    if (prices.length < period) return null;
    const sum = prices.slice(-period).reduce((a, b) => a + b, 0);
    return sum / period;
}

function calculateEMA(prices, period) {
    if (prices.length < period) return null;
    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    
    for (let i = period; i < prices.length; i++) {
        ema = prices[i] * k + ema * (1 - k);
    }
    return ema;
}

function calculateRSI(prices, period = 14) {
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

function calculateBollingerBands(prices, period = 20, multiplier = 2) {
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

function calculateMACD(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    if (prices.length < slowPeriod + signalPeriod) return null;
    
    const emaFast = calculateEMA(prices, fastPeriod);
    const emaSlow = calculateEMA(prices, slowPeriod);
    
    if (emaFast === null || emaSlow === null) return null;
    
    const macdLine = emaFast - emaSlow;
    
    // Simple approximation for signal line
    const macdHistory = [];
    for (let i = prices.length - 50; i < prices.length; i++) {
        const ef = calculateEMA(prices.slice(0, i + 1), fastPeriod);
        const es = calculateEMA(prices.slice(0, i + 1), slowPeriod);
        if (ef && es) macdHistory.push(ef - es);
    }
    
    const signalLine = macdHistory.length >= signalPeriod 
        ? macdHistory.slice(-signalPeriod).reduce((a, b) => a + b, 0) / signalPeriod
        : macdLine;
    
    return {
        macd: macdLine,
        signal: signalLine,
        histogram: macdLine - signalLine
    };
}

function calculateTechnicalIndicators() {
    const prices = CONFIG.priceData;
    
    marketData.indicators.sma20 = calculateSMA(prices, 20);
    marketData.indicators.sma50 = calculateSMA(prices, 50);
    marketData.indicators.rsi = calculateRSI(prices, 14);
    marketData.indicators.bollinger = calculateBollingerBands(prices, 20, 2);
    marketData.indicators.macd = calculateMACD(prices, 12, 26, 9);
    
    updateIndicatorsDisplay();
}

// ============ DIGITS PATTERN ANALYSIS ============
function analyzeDigitsPattern() {
    const history = marketData.digitsHistory;
    if (history.length < 20) return;
    
    const overDigits = [5, 6, 7, 8, 9];
    const underDigits = [0, 1, 2, 3, 4];
    
    let overCount = 0, underCount = 0;
    let last10Over = 0, last10Under = 0;
    let last5Over = 0, last5Under = 0;
    
    history.forEach((digit, index) => {
        const isOver = overDigits.includes(digit);
        const isUnder = underDigits.includes(digit);
        
        if (isOver) overCount++;
        if (isUnder) underCount++;
        
        if (index >= history.length - 10) {
            if (isOver) last10Over++;
            if (isUnder) last10Under++;
        }
        
        if (index >= history.length - 5) {
            if (isOver) last5Over++;
            if (isUnder) last5Under++;
        }
    });
    
    const overPercentage = (overCount / history.length) * 100;
    const underPercentage = (underCount / history.length) * 100;
    const last10OverPercentage = (last10Over / 10) * 100;
    const last5OverPercentage = (last5Over / 5) * 100;
    
    // Pattern detection
    let pattern = null;
    let confidence = 50;
    let signal = null;
    
    // Strong over trend detection
    if (last5OverPercentage >= 80) {
        pattern = 'STRONG_OVER';
        signal = 'OVER 5';
        confidence = 85;
    } else if (last10OverPercentage >= 70) {
        pattern = 'OVER_Trend';
        signal = 'OVER 5';
        confidence = 70;
    } else if (last5UnderPercentage >= 80) {
        pattern = 'STRONG_UNDER';
        signal = 'UNDER 5';
        confidence = 85;
    } else if (last10UnderPercentage >= 70) {
        pattern = 'UNDER_Trend';
        signal = 'UNDER 5';
        confidence = 70;
    }
    
    // Pattern streak detection
    let currentStreak = 1;
    let maxStreak = 1;
    for (let i = history.length - 1; i > 0; i--) {
        const isOverCurrent = overDigits.includes(history[i]);
        const isOverPrev = overDigits.includes(history[i - 1]);
        
        if (isOverCurrent === isOverPrev) {
            currentStreak++;
            maxStreak = Math.max(maxStreak, currentStreak);
        } else {
            break;
        }
    }
    
    if (maxStreak >= 4) {
        pattern = 'STREAK';
        signal = overDigits.includes(history[history.length - 1]) ? 'OVER 5' : 'UNDER 5';
        confidence = Math.min(90, 60 + (maxStreak * 5));
    }
    
    // Update UI
    document.getElementById('overTrend').textContent = `${overPercentage.toFixed(1)}%`;
    document.getElementById('underTrend').textContent = `${underPercentage.toFixed(1)}%`;
    document.getElementById('last10Over').textContent = `${last10OverPercentage.toFixed(0)}%`;
    document.getElementById('patternType').textContent = pattern || 'NEUTRAL';
    
    // Generate signal if conditions met
    if (signal && confidence > 65) {
        const priceActionSignal = analyzePriceActionForSignal(marketData.lastPrice);
        const finalSignal = combineSignals(signal, confidence, priceActionSignal);
        
        if (finalSignal) {
            displaySignal(finalSignal.signal, finalSignal.confidence, finalSignal.reasons, CONFIG.currentMarket);
        }
    }
    
    return { signal, confidence, pattern, overPercentage, underPercentage };
}

// ============ PRICE ACTION ANALYSIS ============
function analyzePriceActionForSignal(currentPrice) {
    const indicators = marketData.indicators;
    const prices = CONFIG.priceData;
    
    let signal = null;
    let confidence = 0;
    let reasons = [];
    
    // RSI signals
    if (indicators.rsi) {
        if (indicators.rsi < 30) {
            signal = 'RISE';
            confidence += 35;
            reasons.push(`RSI oversold: ${indicators.rsi.toFixed(1)}`);
        } else if (indicators.rsi > 70) {
            signal = 'FALL';
            confidence += 35;
            reasons.push(`RSI overbought: ${indicators.rsi.toFixed(1)}`);
        }
    }
    
    // Bollinger Bands signals
    if (indicators.bollinger) {
        if (currentPrice <= indicators.bollinger.lower) {
            signal = 'RISE';
            confidence += 30;
            reasons.push('Price at lower Bollinger Band');
        } else if (currentPrice >= indicators.bollinger.upper) {
            signal = 'FALL';
            confidence += 30;
            reasons.push('Price at upper Bollinger Band');
        }
        
        // Bollinger squeeze detection
        const bandWidth = (indicators.bollinger.upper - indicators.bollinger.lower) / indicators.bollinger.middle;
        if (bandWidth < 0.05) {
            reasons.push('Bollinger Squeeze - volatility expected');
        }
    }
    
    // MACD signals
    if (indicators.macd) {
        if (indicators.macd.macd > indicators.macd.signal && indicators.macd.histogram > 0) {
            if (!signal) signal = 'RISE';
            confidence += 20;
            reasons.push('MACD bullish crossover');
        } else if (indicators.macd.macd < indicators.macd.signal && indicators.macd.histogram < 0) {
            if (!signal) signal = 'FALL';
            confidence += 20;
            reasons.push('MACD bearish crossover');
        }
    }
    
    // Moving average signals
    if (indicators.sma20 && indicators.sma50) {
        if (indicators.sma20 > indicators.sma50 && prices[prices.length - 1] > indicators.sma20) {
            if (!signal) signal = 'RISE';
            confidence += 15;
            reasons.push('Golden crossover setup');
        } else if (indicators.sma20 < indicators.sma50 && prices[prices.length - 1] < indicators.sma20) {
            if (!signal) signal = 'FALL';
            confidence += 15;
            reasons.push('Death crossover setup');
        }
    }
    
    return { signal, confidence: Math.min(confidence, 95), reasons };
}

function combineSignals(digitSignal, digitConfidence, priceSignal) {
    if (!priceSignal.signal) {
        if (digitSignal && digitConfidence > 65) {
            return {
                signal: digitSignal,
                confidence: digitConfidence,
                reasons: ['Digits pattern detected']
            };
        }
        return null;
    }
    
    // Combine signals
    let finalSignal = priceSignal.signal;
    let finalConfidence = priceSignal.confidence;
    let allReasons = [...priceSignal.reasons];
    
    // Add digit signal if it confirms
    const digitMatches = (digitSignal === 'OVER 5' && priceSignal.signal === 'RISE') ||
                        (digitSignal === 'UNDER 5' && priceSignal.signal === 'FALL');
    
    if (digitMatches) {
        finalConfidence += digitConfidence * 0.3;
        allReasons.push('Digits pattern confirmation');
    }
    
    finalConfidence = Math.min(finalConfidence, 95);
    
    return {
        signal: finalSignal,
        confidence: finalConfidence,
        reasons: allReasons
    };
}

// ============ BEST MARKET DETECTION ============
async function findBestMarket() {
    const markets = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'];
    const marketScores = [];
    
    for (const market of markets) {
        try {
            const candles = await fetchHistoricalCandles(market, 50, 60);
            if (candles.length > 20) {
                const prices = candles.map(c => c.close);
                const volatility = calculateVolatility(prices);
                const trend = detectTrend(prices);
                
                let score = 0;
                if (volatility > 0.02) score += 30;
                if (trend === 'bullish') score += 40;
                if (trend === 'bearish') score += 20;
                
                marketScores.push({ market, score, volatility, trend });
            }
        } catch (error) {
            console.error(`Error analyzing ${market}:`, error);
        }
    }
    
    marketScores.sort((a, b) => b.score - a.score);
    return marketScores[0] || { market: CONFIG.currentMarket, score: 0 };
}

function calculateVolatility(prices) {
    if (prices.length < 2) return 0;
    let sum = 0;
    for (let i = 1; i < prices.length; i++) {
        sum += Math.abs((prices[i] - prices[i-1]) / prices[i-1]);
    }
    return sum / (prices.length - 1);
}

function detectTrend(prices) {
    if (prices.length < 20) return 'neutral';
    
    const sma20 = calculateSMA(prices, 20);
    const sma50 = calculateSMA(prices, 50);
    
    if (sma20 && sma50) {
        if (sma20 > sma50 * 1.01) return 'bullish';
        if (sma20 < sma50 * 0.99) return 'bearish';
    }
    return 'neutral';
}

// ============ UI UPDATE FUNCTIONS ============
function updatePriceDisplay(price) {
    const lastPriceEl = document.getElementById('lastPrice');
    const changeEl = document.getElementById('priceChange');
    
    if (lastPriceEl) {
        const previousPrice = CONFIG.priceData[CONFIG.priceData.length - 2] || price;
        const change = ((price - previousPrice) / previousPrice * 100).toFixed(2);
        
        lastPriceEl.textContent = price.toFixed(4);
        
        if (changeEl) {
            changeEl.innerHTML = `${change >= 0 ? '+' : ''}${change}%`;
            changeEl.className = `text-sm font-semibold ${change >= 0 ? 'text-green-400' : 'text-red-400'}`;
        }
    }
    
    // Update high/low
    if (CONFIG.priceData.length > 0) {
        document.getElementById('highPrice').textContent = Math.max(...CONFIG.priceData).toFixed(4);
        document.getElementById('lowPrice').textContent = Math.min(...CONFIG.priceData).toFixed(4);
    }
}

function updateDigitsDisplay() {
    const statsDiv = document.getElementById('digitsStats');
    if (!statsDiv) return;
    
    const total = marketData.digitsHistory.length || 1;
    statsDiv.innerHTML = marketData.digits.map((count, i) => `
        <div class="flex justify-between items-center">
            <span class="text-sm">Digit ${i}</span>
            <div class="flex-1 mx-3 bg-gray-700 rounded-full h-2">
                <div class="h-2 rounded-full transition-all" style="width: ${(count / total) * 100}%; background: ${getDigitColor(i)}"></div>
            </div>
            <span class="text-sm font-semibold">${count}</span>
        </div>
    `).join('');
}

function getDigitColor(digit) {
    const colors = ['#ef4444', '#f59e0b', '#eab308', '#84cc16', '#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#d946ef', '#ec4899'];
    return colors[digit];
}

function updateDigitsDonutChart() {
    if (CONFIG.digitsChart) {
        CONFIG.digitsChart.data.datasets[0].data = marketData.digits;
        CONFIG.digitsChart.update();
        
        // Find dominant digit
        const dominantDigit = marketData.digits.indexOf(Math.max(...marketData.digits));
        document.getElementById('dominantDigit').textContent = dominantDigit;
    }
}

function updatePriceChart() {
    if (CONFIG.priceChart) {
        CONFIG.priceChart.data.datasets[0].data = CONFIG.priceData;
        CONFIG.priceChart.update();
    }
}

function updateIndicatorsDisplay() {
    const indicators = marketData.indicators;
    const indicatorsDiv = document.getElementById('indicators');
    if (!indicatorsDiv) return;
    
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
            <span class="text-sm text-gray-400">RSI (14):</span>
            <span class="text-sm font-semibold ${indicators.rsi && indicators.rsi > 70 ? 'text-red-400' : indicators.rsi && indicators.rsi < 30 ? 'text-green-400' : 'text-white'}">${indicators.rsi ? indicators.rsi.toFixed(1) : 'N/A'}</span>
        </div>
        ${indicators.macd ? `
        <div class="flex justify-between">
            <span class="text-sm text-gray-400">MACD:</span>
            <span class="text-sm font-semibold ${indicators.macd.histogram > 0 ? 'text-green-400' : 'text-red-400'}">${indicators.macd.histogram > 0 ? 'Bullish' : 'Bearish'}</span>
        </div>
        ` : ''}
        ${indicators.bollinger ? `
        <div class="flex justify-between">
            <span class="text-sm text-gray-400">Bollinger Width:</span>
            <span class="text-sm font-semibold">${((indicators.bollinger.upper - indicators.bollinger.lower) / indicators.bollinger.middle * 100).toFixed(1)}%</span>
        </div>
        ` : ''}
    `;
}

// ============ SIGNAL GENERATION ============
function generateSignal() {
    const digitAnalysis = analyzeDigitsPattern();
    const priceAnalysis = analyzePriceActionForSignal(marketData.lastPrice);
    
    const combined = combineSignals(digitAnalysis.signal, digitAnalysis.confidence, priceAnalysis);
    
    if (combined && combined.confidence > 60) {
        displaySignal(combined.signal, combined.confidence, combined.reasons, CONFIG.currentMarket);
        updateSignalStrength(combined.confidence);
        
        // Auto-suggest best market
        findBestMarket().then(bestMarket => {
            if (bestMarket && bestMarket.market !== CONFIG.currentMarket) {
                const suggestionMsg = `Better market detected: ${bestMarket.market} with ${bestMarket.score}% rating`;
                speak(suggestionMsg);
                showNotification(suggestionMsg, 'info');
            }
        });
        
        return true;
    }
    
    return false;
}

// ============ MARKET SWITCH FUNCTION ============
async function switchMarket(symbol) {
    CONFIG.currentMarket = symbol;
    marketData.ticks = [];
    marketData.candles = [];
    marketData.digitsHistory = [];
    marketData.digits = Array(10).fill(0);
    CONFIG.priceData = [];
    
    showNotification(`Switching to ${symbol}...`, 'info');
    
    try {
        // Fetch historical candles
        const candles = await fetchHistoricalCandles(symbol, DERIV_CONFIG.candleCount, DERIV_CONFIG.granularity);
        
        // Populate price data from candles
        candles.forEach(candle => {
            CONFIG.priceData.push(candle.close);
            
            // Extract digit from close price
            const priceStr = candle.close.toString();
            const digitMatch = priceStr.match(/\.(\d)/);
            const digit = digitMatch ? parseInt(digitMatch[1]) : Math.floor(candle.close) % 10;
            marketData.digitsHistory.push(digit);
        });
        
        // Update digit frequency
        marketData.digits = Array(10).fill(0);
        marketData.digitsHistory.forEach(d => marketData.digits[d]++);
        
        // Subscribe to live ticks
        await subscribeToTicks(symbol);
        await subscribeToCandles(symbol, DERIV_CONFIG.granularity);
        
        // Update UI
        updateDigitsDisplay();
        updateDigitsDonutChart();
        updatePriceChart();
        
        showNotification(`Connected to ${symbol}`, 'success');
        speak(`Now analyzing ${symbol} market`);
        
    } catch (error) {
        console.error('Error switching market:', error);
        showNotification(`Failed to connect to ${symbol}`, 'error');
    }
}

// ============ INITIALIZE DERIV CONNECTION ============
async function initializeDerivConnection() {
    showNotification('Connecting to Deriv markets...', 'info');
    
    try {
        await connectDerivWebSocket();
        
        // Fetch and display available symbols
        const symbols = await fetchActiveSymbols();
        console.log(`Found ${symbols.length} active symbols`);
        
        // Initialize with default market
        await switchMarket(CONFIG.currentMarket);
        
        showNotification('Connected to Deriv API - Live data streaming active', 'success');
        speak('KAIRON system online. Live market analysis active.');
        
        // Start periodic analysis
        setInterval(() => {
            if (isConnected && marketData.digitsHistory.length > 20) {
                generateSignal();
            }
        }, 15000);
        
    } catch (error) {
        console.error('Failed to initialize Deriv connection:', error);
        showNotification('Failed to connect to Deriv. Check your internet connection.', 'error');
        
        // Fallback to simulation mode
        startMarketSimulation();
        showNotification('Using simulation mode - connect to internet for live data', 'warning');
    }
}

// ============ UPDATE HTML FOR INDICATORS PANEL ============
function updateIndicatorsPanel() {
    const indicatorsHtml = `
        <div class="space-y-2">
            <div class="flex justify-between items-center p-2 bg-gray-800/30 rounded">
                <span class="text-sm text-gray-400">RSI (14)</span>
                <span id="rsiValue" class="text-sm font-mono font-bold">--</span>
            </div>
            <div class="flex justify-between items-center p-2 bg-gray-800/30 rounded">
                <span class="text-sm text-gray-400">SMA 20</span>
                <span id="sma20Value" class="text-sm font-mono">--</span>
            </div>
            <div class="flex justify-between items-center p-2 bg-gray-800/30 rounded">
                <span class="text-sm text-gray-400">SMA 50</span>
                <span id="sma50Value" class="text-sm font-mono">--</span>
            </div>
            <div class="flex justify-between items-center p-2 bg-gray-800/30 rounded">
                <span class="text-sm text-gray-400">Bollinger</span>
                <span id="bollingerStatus" class="text-sm">--</span>
            </div>
            <div class="flex justify-between items-center p-2 bg-gray-800/30 rounded">
                <span class="text-sm text-gray-400">MACD</span>
                <span id="macdStatus" class="text-sm">--</span>
            </div>
        </div>
    `;
    
    const indicatorsDiv = document.getElementById('indicators');
    if (indicatorsDiv) {
        indicatorsDiv.innerHTML = indicatorsHtml;
    }
}

// Update the existing displaySignal function to be more comprehensive
function displaySignal(signal, confidence, reasons, suggestedMarket) {
    const signalDiv = document.getElementById('currentSignal');
    const isBullish = signal === 'RISE' || signal === 'OVER 5';
    
    if (signalDiv) {
        signalDiv.className = `p-4 rounded-lg text-center transition-all ${isBullish ? 'bg-green-900/30 border border-green-500 glow-green' : 'bg-red-900/30 border border-red-500 glow-red'}`;
        signalDiv.innerHTML = `
            <div class="signal-pulse">
                <i class="fas ${isBullish ? 'fa-arrow-up' : 'fa-arrow-down'} text-4xl ${isBullish ? 'text-green-400' : 'text-red-400'} mb-2"></i>
                <p class="text-2xl font-bold ${isBullish ? 'text-green-400' : 'text-red-400'}">${signal}</p>
                <p class="text-sm text-gray-300 mt-2">Confidence: ${confidence.toFixed(0)}%</p>
                <p class="text-xs text-gray-400 mt-1">Best Market: ${suggestedMarket}</p>
                ${reasons && reasons.length ? `<div class="text-xs text-gray-400 mt-2">${reasons.map(r => `<span class="inline-block px-2 py-1 bg-gray-800 rounded mr-1 mt-1">${r}</span>`).join('')}</div>` : ''}
                <div class="text-xs text-gray-500 mt-3 mt-2">
                    <i class="fas fa-database mr-1"></i>Live Deriv Data | ${new Date().toLocaleTimeString()}
                </div>
            </div>
        `;
    }
    
    // Voice alert
    const confidenceWord = confidence >= 80 ? 'Strong' : confidence >= 65 ? 'Moderate' : 'Weak';
    speak(`${confidenceWord} ${signal} signal detected with ${confidence.toFixed(0)} percent confidence on ${suggestedMarket}`);
    playAlertSound();
    
    // Add to history
    addToSignalHistory(signal, confidence, suggestedMarket);
}

// Start the application
document.addEventListener('DOMContentLoaded', () => {
    initializeMarkets();
    initializeCharts();
    initializeVoice();
    updateIndicatorsPanel();
    setupEventListeners();
    startMatrixEffect();
    loadNews();
    loadEconomicCalendar();
    loadCommodities();
    
    // Initialize Deriv connection
    initializeDerivConnection();
});

// Export for global access
window.getSignal = generateSignal;
window.speak = speak;
window.switchMarket = switchMarket;
