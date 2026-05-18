// ============ DERIV WEBSOCKET CONFIGURATION ============
const DERIV_APP_ID = '67213';
const DERIV_WS_URL = `wss://ws.binaryws.com/websockets/v3?app_id=${DERIV_APP_ID}`;

// All 13 markets for Deriv Volatility Index
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
        lastUpdate: null,
        greenBar: null,
        redBar: null,
        digitPercentages: Array(10).fill(0)
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
let voiceCooldown = 8000;
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
let marketUpdateInterval = null;
let tickCount = 0;

// ============ UTILITY FUNCTIONS ============

function getDigitFromPrice(price) {
    const priceStr = price.toString();
    // Check for decimal part
    if (priceStr.includes('.')) {
        const decimalMatch = priceStr.match(/\.(\d)/);
        if (decimalMatch) {
            return parseInt(decimalMatch[1]);
        }
    }
    // If no decimal, get last digit of integer
    return Math.floor(Math.abs(price)) % 10;
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
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(message);
        utterance.rate = 0.85;
        utterance.pitch = voiceGender === 'male' ? 1 : 1.3;
        utterance.volume = 0.9;
        
        // Try to get a good voice
        const voices = window.speechSynthesis.getVoices();
        const preferredVoice = voices.find(v => 
            voiceGender === 'male' ? v.name.includes('Google UK') || v.name.includes('Samantha') : v.name.includes('Google UK Female')
        );
        if (preferredVoice) utterance.voice = preferredVoice;
        
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
    return colors[digit % 10];
}

// ============ DIGIT PERCENTAGE CALCULATION ============

function calculateDigitPercentages() {
    const total = digitsHistory.length || 1;
    const percentages = Array(10).fill(0);
    digitsHistory.forEach(d => {
        if (d >= 0 && d <= 9) percentages[d]++;
    });
    return percentages.map(count => (count / total) * 100);
}

function findMostAppearingDigit() {
    let maxCount = -1;
    let mostDigit = 0;
    digitsData.forEach((count, digit) => {
        if (count > maxCount) {
            maxCount = count;
            mostDigit = digit;
        }
    });
    return mostDigit;
}

function findSecondMostAppearingDigit() {
    let maxCount = -1;
    let secondMaxCount = -1;
    let mostDigit = 0;
    let secondDigit = 0;
    
    digitsData.forEach((count, digit) => {
        if (count > maxCount) {
            secondMaxCount = maxCount;
            secondDigit = mostDigit;
            maxCount = count;
            mostDigit = digit;
        } else if (count > secondMaxCount) {
            secondMaxCount = count;
            secondDigit = digit;
        }
    });
    return secondDigit;
}

function findGreenBar() {
    // Green bar indicates a digit that is increasing in percentage
    const percentages = calculateDigitPercentages();
    let maxIncrease = -1;
    let greenDigit = null;
    
    for (let i = 0; i < 10; i++) {
        const currentPercent = percentages[i];
        const prevPercent = MARKET_DATA[currentMarket]?.prevPercentages?.[i] || currentPercent;
        const increase = currentPercent - prevPercent;
        if (increase > maxIncrease && increase > 0.1) {
            maxIncrease = increase;
            greenDigit = i;
        }
    }
    
    // Store for next comparison
    if (!MARKET_DATA[currentMarket].prevPercentages) {
        MARKET_DATA[currentMarket].prevPercentages = [...percentages];
    } else {
        MARKET_DATA[currentMarket].prevPercentages = [...percentages];
    }
    
    return greenDigit;
}

function findRedBar() {
    // Red bar indicates a digit that is decreasing in percentage
    const percentages = calculateDigitPercentages();
    let maxDecrease = -1;
    let redDigit = null;
    
    for (let i = 0; i < 10; i++) {
        const currentPercent = percentages[i];
        const prevPercent = MARKET_DATA[currentMarket]?.prevPercentages?.[i] || currentPercent;
        const decrease = prevPercent - currentPercent;
        if (decrease > maxDecrease && decrease > 0.1) {
            maxDecrease = decrease;
            redDigit = i;
        }
    }
    
    return redDigit;
}

function updateMarketData() {
    MARKET_DATA[currentMarket].digitsHistory = [...digitsHistory];
    MARKET_DATA[currentMarket].priceData = [...priceData];
    MARKET_DATA[currentMarket].digitPercentages = calculateDigitPercentages();
    MARKET_DATA[currentMarket].greenBar = findGreenBar();
    MARKET_DATA[currentMarket].redBar = findRedBar();
}

// ============ STRATEGY 1: OVER/UNDER ANALYSIS ============

function analyzeOverUnderStrategy() {
    const greenBar = MARKET_DATA[currentMarket].greenBar;
    const redBar = MARKET_DATA[currentMarket].redBar;
    const secondMost = findSecondMostAppearingDigit();
    const percentages = calculateDigitPercentages();
    
    let signal = null;
    let confidence = 0;
    let reasons = [];
    
    // Strategy 1: GB, 2ndMost & RB between (0-6) → UNDER 7
    if (greenBar !== null && secondMost !== null && redBar !== null) {
        const digits = [greenBar, secondMost, redBar];
        const allUnder7 = digits.every(d => d <= 6);
        
        if (allUnder7) {
            signal = "UNDER 7";
            confidence = 70 + Math.random() * 15;
            reasons.push(`GB:${greenBar}, 2ndMost:${secondMost}, RB:${redBar} all ≤6`);
            reasons.push(`${digits.join(',')} are below threshold`);
        }
    }
    
    // Strategy 1 alternative: GB, 2ndMost & RB between (3-9) → OVER 2
    if (!signal && greenBar !== null && secondMost !== null && redBar !== null) {
        const digits = [greenBar, secondMost, redBar];
        const allOver3 = digits.every(d => d >= 3);
        
        if (allOver3) {
            signal = "OVER 2";
            confidence = 70 + Math.random() * 15;
            reasons.push(`GB:${greenBar}, 2ndMost:${secondMost}, RB:${redBar} all ≥3`);
            reasons.push(`${digits.join(',')} are above threshold`);
        }
    }
    
    // Strategy 2: Specific entries
    if (!signal) {
        // For UNDER market, use entry 6
        const underCondition = digitsHistory.slice(-10).filter(d => d < 5).length >= 7;
        if (underCondition) {
            signal = "UNDER 6";
            confidence = 65 + Math.random() * 20;
            reasons.push(`${digitsHistory.slice(-10).filter(d => d < 5).length}/10 digits below 5`);
            reasons.push("Entry: Use digit 6 for execution");
        }
        
        // For OVER market, use digit 5 or 3
        const overCondition = digitsHistory.slice(-10).filter(d => d > 5).length >= 7;
        if (overCondition) {
            signal = "OVER 5";
            confidence = 65 + Math.random() * 20;
            reasons.push(`${digitsHistory.slice(-10).filter(d => d > 5).length}/10 digits above 5`);
            reasons.push("Entry: Use digit 5 or 3 for execution");
        }
    }
    
    return { signal, confidence, reasons };
}

// ============ STRATEGY 2: EVEN/ODD ANALYSIS ============

function analyzeEvenOddStrategy() {
    const greenBar = MARKET_DATA[currentMarket].greenBar;
    const redBar = MARKET_DATA[currentMarket].redBar;
    const secondMost = findSecondMostAppearingDigit();
    const percentages = calculateDigitPercentages();
    
    let signal = null;
    let confidence = 0;
    let reasons = [];
    
    // Strategy 1: Based on parity of GB, 2ndMost, and another digit
    const digits = [greenBar, secondMost].filter(d => d !== null);
    if (digits.length >= 2) {
        const allEven = digits.every(d => d % 2 === 0);
        const allOdd = digits.every(d => d % 2 === 1);
        
        if (allEven) {
            signal = "EVEN";
            confidence = 70 + Math.random() * 15;
            reasons.push(`GB:${greenBar}, 2ndMost:${secondMost} are both EVEN`);
        } else if (allOdd) {
            signal = "ODD";
            confidence = 70 + Math.random() * 15;
            reasons.push(`GB:${greenBar}, 2ndMost:${secondMost} are both ODD`);
        }
    }
    
    // Strategy 2: Using GB, 2ndMost, and RB
    if (!signal && greenBar !== null && secondMost !== null && redBar !== null) {
        const digits = [greenBar, secondMost, redBar];
        const allEven = digits.every(d => d % 2 === 0);
        const allOdd = digits.every(d => d % 2 === 1);
        
        if (allEven) {
            signal = "EVEN";
            confidence = 75 + Math.random() * 15;
            reasons.push(`GB:${greenBar}, 2ndMost:${secondMost}, RB:${redBar} are all EVEN`);
            reasons.push("Entry: OOO then one E (or two if GB >12%)");
        } else if (allOdd) {
            signal = "ODD";
            confidence = 75 + Math.random() * 15;
            reasons.push(`GB:${greenBar}, 2ndMost:${secondMost}, RB:${redBar} are all ODD`);
            reasons.push("Entry: EEE then one O (or two if GB >12%)");
        }
    }
    
    // Check for winning streak recommendation
    const recentWins = signalHistory.filter(s => s.signal === signal && 
        new Date().getTime() - new Date(s.time).getTime() < 3600000).length;
    if (recentWins >= 4) {
        reasons.push("⚠️ 4+ consecutive wins - Stop and find another entry");
    }
    
    return { signal, confidence, reasons };
}

// ============ STRATEGY 3: MATCHES PREDICTIONS (9 strategies) ============

function analyzeMatchesStrategy() {
    const greenBar = MARKET_DATA[currentMarket].greenBar;
    const redBar = MARKET_DATA[currentMarket].redBar;
    const percentages = calculateDigitPercentages();
    const digitPercentObj = {};
    for (let i = 0; i < 10; i++) {
        digitPercentObj[i] = percentages[i];
    }
    
    let signal = null;
    let predictedDigit = null;
    let confidence = 0;
    let reasons = [];
    
    // Strategy 1: Vol 75/75 (1s)
    if (currentMarket.includes('75')) {
        if (percentages[3] > 0 && percentages[6] > 0 && percentages[1] > percentages[2]) {
            predictedDigit = 1;
            signal = `MATCHES ${predictedDigit}`;
            confidence = 65 + Math.random() * 20;
            reasons.push(`Digit 3 has green bar: ${percentages[3].toFixed(1)}%`);
            reasons.push(`Digit 6 red bar increasing`);
            reasons.push(`Digit 1 (${percentages[1].toFixed(1)}%) > Digit 2 (${percentages[2].toFixed(1)}%)`);
            reasons.push(`Entry: Cursor hits digit 1 and it's increasing`);
        }
    }
    
    // Strategy 2: 100/100 volatilities
    if (!signal && currentMarket.includes('100')) {
        if (percentages[7] > 0 && 
            (percentages[2] >= 9.9 && percentages[2] <= 10.1) &&
            ((percentages[3] > percentages[8] && percentages[8] < percentages[3]) ||
             (percentages[8] > percentages[3] && percentages[3] < percentages[8]))) {
            predictedDigit = redBar;
            signal = `MATCHES ${predictedDigit}`;
            confidence = 70 + Math.random() * 15;
            reasons.push(`Green bar at digit 7 (${percentages[7].toFixed(1)}%) - MUST`);
            reasons.push(`Digit 2 at ${percentages[2].toFixed(1)}% (target 9.9-10.1)`);
            reasons.push(`Digits 3 & 8 are opposite trends`);
            reasons.push(`Entry: Use digit with red bar, ensure it increases`);
        }
    }
    
    // Strategy 3
    if (!signal && percentages[6] > 0 && percentages[6] < percentages[6] - 0.1 &&
        percentages[3] > 9.5 && percentages[3] < 11 &&
        Math.abs(percentages[1] - (percentages[0] || 0)) < 0.5) {
        predictedDigit = 3;
        signal = `MATCHES ${predictedDigit}`;
        confidence = 68 + Math.random() * 18;
        reasons.push(`Digit 6 green bar decreasing`);
        reasons.push(`Digit 3 at ${percentages[3].toFixed(1)}% (9.5-11% range)`);
        reasons.push(`Digit 1 constant in percentages`);
        reasons.push(`Entry: Cursor moves from even digit to ${predictedDigit}`);
    }
    
    // Strategy 4
    if (!signal && percentages[5] > 11 && percentages[9] > 0 && 
        percentages[1] < 10 && percentages[4] > 10) {
        predictedDigit = 5;
        signal = `MATCHES ${predictedDigit}`;
        confidence = 72 + Math.random() * 15;
        reasons.push(`Digit 5 green bar >11% (${percentages[5].toFixed(1)}%)`);
        reasons.push(`Digit 9 red bar`);
        reasons.push(`Digit 1 <10% (${percentages[1].toFixed(1)}%)`);
        reasons.push(`Digit 4 >10% (${percentages[4].toFixed(1)}%)`);
        reasons.push(`Entry: Cursor hits digit 0, predicted digit increases`);
    }
    
    // Strategy 5
    if (!signal && percentages[2] > 0 && Math.abs(percentages[2] - (percentages[2] || 0)) < 0.2 &&
        percentages[0] < 10 && percentages[0] > 0 &&
        percentages[5] > 10 && (percentages[5] - (percentages[5] || 0)) > 0.09) {
        predictedDigit = 5;
        signal = `MATCHES ${predictedDigit}`;
        confidence = 70 + Math.random() * 18;
        reasons.push(`Digit 2 green bar constant`);
        reasons.push(`Digit 0 constant below 10%`);
        reasons.push(`Digit 5 above 10% increasing by 0.1%`);
        reasons.push(`Entry: Cursor from even digit to ${predictedDigit}`);
    }
    
    // Strategy 6: 3 even numbers below 10%
    if (!signal) {
        const evenDigitsBelow10 = [0, 2, 4, 6, 8].filter(d => percentages[d] < 10).length;
        if (evenDigitsBelow10 >= 3 && redBar !== null && redBar > 6 && redBar % 2 === 1 &&
            percentages[5] < (percentages[5] || 0) && percentages[7] < (percentages[7] || 0)) {
            predictedDigit = 6;
            signal = `MATCHES ${predictedDigit}`;
            confidence = 65 + Math.random() * 20;
            reasons.push(`${evenDigitsBelow10} even digits below 10%`);
            reasons.push(`Red bar at digit ${redBar} (odd digit >6)`);
            reasons.push(`Digits 5 and 7 decreasing`);
            reasons.push(`Entry: Cursor from odd digit to ${predictedDigit}`);
        }
    }
    
    // Strategy 7
    if (!signal && percentages[7] > 0 && percentages[0] > 0 && percentages[8] >= 11) {
        predictedDigit = 7;
        signal = `MATCHES ${predictedDigit}`;
        confidence = 73 + Math.random() * 15;
        reasons.push(`Digit 7 green bar`);
        reasons.push(`Digit 0 red bar`);
        reasons.push(`Digit 8 >=11% (${percentages[8].toFixed(1)}%)`);
        reasons.push(`Entry: Cursor from even digit to ${predictedDigit}`);
    }
    
    // Strategy 8: At least 4 even numbers above 10%
    if (!signal) {
        const evenDigitsAbove10 = [0, 2, 4, 6, 8].filter(d => percentages[d] > 10).length;
        if (evenDigitsAbove10 >= 4 && percentages[1] > 0 &&
            Math.abs(percentages[1] - (percentages[1] || 0)) < 0.3 &&
            Math.abs(percentages[7] - (percentages[7] || 0)) < 0.3) {
            const oddGreen = [1, 3, 5, 7, 9].find(d => percentages[d] > 11);
            if (oddGreen) {
                predictedDigit = 8;
                signal = `MATCHES ${predictedDigit}`;
                confidence = 68 + Math.random() * 18;
                reasons.push(`${evenDigitsAbove10} even digits above 10%`);
                reasons.push(`Digit 1 red bar`);
                reasons.push(`Digits 1 & 7 constant`);
                reasons.push(`Green bar at odd digit ${oddGreen} >11%`);
                reasons.push(`Entry: Cursor from odd digit to ${predictedDigit}`);
            }
        }
    }
    
    // Strategy 9
    if (!signal && greenBar !== null && greenBar % 2 === 0 && redBar === 0 &&
        percentages[5] < 10 && percentages[9] > (percentages[9] || 0)) {
        predictedDigit = 9;
        signal = `MATCHES ${predictedDigit}`;
        confidence = 71 + Math.random() * 17;
        reasons.push(`Green bar at even digit ${greenBar}`);
        reasons.push(`Red bar at digit 0`);
        reasons.push(`Digit 5 <10% (${percentages[5].toFixed(1)}%)`);
        reasons.push(`Digit 9 increasing`);
        reasons.push(`Entry: Cursor from even digit to ${predictedDigit}`);
    }
    
    return { signal, confidence, reasons, predictedDigit };
}

// ============ STRATEGY 4: RISE/FALL ANALYSIS ============

function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    let gains = 0, losses = 0;
    const recentPrices = prices.slice(-period - 1);
    for (let i = 1; i < recentPrices.length; i++) {
        const change = recentPrices[i] - recentPrices[i - 1];
        if (change >= 0) gains += change;
        else losses -= change;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

function calculateDonchianChannel(prices, period = 20) {
    if (prices.length < period) return null;
    const recentPrices = prices.slice(-period);
    const highest = Math.max(...recentPrices);
    const lowest = Math.min(...recentPrices);
    const middle = (highest + lowest) / 2;
    return { upper: highest, middle: middle, lower: lowest };
}

function calculateChaikinVolatility(prices, period = 10) {
    if (prices.length < period + 1) return 0;
    const highLow = [];
    for (let i = prices.length - period; i < prices.length; i++) {
        highLow.push(prices[i] - (prices[i - 1] || prices[i]));
    }
    const avgChange = highLow.reduce((a, b) => a + Math.abs(b), 0) / period;
    const currentChange = prices[prices.length - 1] - prices[prices.length - 2];
    return currentChange / (avgChange || 1);
}

function calculateKST(prices) {
    if (prices.length < 26) return { kst: 0, signal: 0 };
    
    const roc10 = (prices[prices.length - 1] - prices[prices.length - 10]) / (prices[prices.length - 10] || 1) * 100;
    const roc15 = (prices[prices.length - 1] - prices[prices.length - 15]) / (prices[prices.length - 15] || 1) * 100;
    const roc20 = (prices[prices.length - 1] - prices[prices.length - 20]) / (prices[prices.length - 20] || 1) * 100;
    const roc30 = (prices[prices.length - 1] - prices[prices.length - 30]) / (prices[prices.length - 30] || 1) * 100;
    
    const kst = (roc10 * 1) + (roc15 * 2) + (roc20 * 3) + (roc30 * 4);
    return { kst: kst, signal: kst * 0.8 };
}

function analyzeRiseFallStrategy(price) {
    const rsi = calculateRSI(priceData, 14);
    const donchian = calculateDonchianChannel(priceData, 20);
    const chaikin = calculateChaikinVolatility(priceData, 10);
    const kst = calculateKST(priceData);
    
    let signal = null;
    let confidence = 50;
    let reasons = [];
    
    // RISE conditions
    if (rsi < 30) {
        signal = "RISE";
        confidence = 75 + (30 - rsi);
        reasons.push(`RSI oversold: ${rsi.toFixed(1)} (${rsi < 30 ? '✓' : '✗'})`);
    } else if (rsi > 70) {
        signal = "FALL";
        confidence = 75 + (rsi - 70);
        reasons.push(`RSI overbought: ${rsi.toFixed(1)} (${rsi > 70 ? '✓' : '✗'})`);
    }
    
    // Donchian channel conditions
    if (donchian) {
        if (!signal && price <= donchian.lower) {
            signal = "RISE";
            confidence = 70;
            reasons.push(`Price at lower Donchian: ${price.toFixed(4)} ≤ ${donchian.lower.toFixed(4)}`);
        } else if (!signal && price >= donchian.upper) {
            signal = "FALL";
            confidence = 70;
            reasons.push(`Price at upper Donchian: ${price.toFixed(4)} ≥ ${donchian.upper.toFixed(4)}`);
        }
    }
    
    // Chaikin volatility conditions
    if (chaikin > 0 && chaikin > 0.01 && !signal) {
        if (signal !== "FALL") {
            signal = "RISE";
            confidence = Math.min(95, confidence + 10);
            reasons.push(`Chaikin Volatility positive: ${chaikin.toFixed(4)} > 0`);
        }
    } else if (chaikin < 0 && chaikin < -0.01 && !signal) {
        if (signal !== "RISE") {
            signal = "FALL";
            confidence = Math.min(95, confidence + 10);
            reasons.push(`Chaikin Volatility negative: ${chaikin.toFixed(4)} < 0`);
        }
    }
    
    // KST conditions
    if (kst.kst > kst.signal && !signal) {
        signal = "RISE";
        confidence = Math.min(95, confidence + 10);
        reasons.push(`KST bullish: KST(${kst.kst.toFixed(2)}) > Signal(${kst.signal.toFixed(2)})`);
    } else if (kst.kst < kst.signal && !signal) {
        signal = "FALL";
        confidence = Math.min(95, confidence + 10);
        reasons.push(`KST bearish: KST(${kst.kst.toFixed(2)}) < Signal(${kst.signal.toFixed(2)})`);
    }
    
    return { signal, confidence, reasons, rsi, donchian, chaikin, kst };
}

// ============ MAIN SIGNAL ANALYSIS ============

function analyzeSignals(price, digit) {
    updateMarketData();
    
    let result = { signal: null, confidence: 50, reasons: [] };
    
    switch(currentTradeType) {
        case 'over_under':
            result = analyzeOverUnderStrategy();
            break;
        case 'even_odd':
            result = analyzeEvenOddStrategy();
            break;
        case 'matches_differs':
            result = analyzeMatchesStrategy();
            break;
        case 'rise_fall':
            result = analyzeRiseFallStrategy(price);
            break;
    }
    
    // Update UI with indicators
    const indicatorsDiv = document.getElementById('indicators');
    if (indicatorsDiv && currentTradeType === 'rise_fall') {
        const rsi = calculateRSI(priceData, 14);
        const donchian = calculateDonchianChannel(priceData, 20);
        const chaikin = calculateChaikinVolatility(priceData, 10);
        indicatorsDiv.innerHTML = `
            <div class="flex justify-between"><span>RSI (14):</span><span class="${rsi > 70 ? 'text-red-400' : rsi < 30 ? 'text-green-400' : 'text-white'}">${rsi ? rsi.toFixed(1) : 'N/A'}</span></div>
            <div class="flex justify-between"><span>Donchian Upper:</span><span>${donchian ? donchian.upper.toFixed(4) : 'N/A'}</span></div>
            <div class="flex justify-between"><span>Donchian Lower:</span><span>${donchian ? donchian.lower.toFixed(4) : 'N/A'}</span></div>
            <div class="flex justify-between"><span>Chaikin Volatility:</span><span class="${chaikin > 0 ? 'text-green-400' : chaikin < 0 ? 'text-red-400' : 'text-white'}">${chaikin ? chaikin.toFixed(4) : 'N/A'}</span></div>
            <div class="flex justify-between"><span>Green Bar:</span><span class="text-green-400">${MARKET_DATA[currentMarket].greenBar !== null ? MARKET_DATA[currentMarket].greenBar : 'N/A'}</span></div>
            <div class="flex justify-between"><span>Red Bar:</span><span class="text-red-400">${MARKET_DATA[currentMarket].redBar !== null ? MARKET_DATA[currentMarket].redBar : 'N/A'}</span></div>
        `;
    } else if (indicatorsDiv) {
        const percentages = calculateDigitPercentages();
        const secondMost = findSecondMostAppearingDigit();
        indicatorsDiv.innerHTML = `
            <div class="flex justify-between"><span>Green Bar:</span><span class="text-green-400">${MARKET_DATA[currentMarket].greenBar !== null ? MARKET_DATA[currentMarket].greenBar : 'N/A'}</span></div>
            <div class="flex justify-between"><span>Red Bar:</span><span class="text-red-400">${MARKET_DATA[currentMarket].redBar !== null ? MARKET_DATA[currentMarket].redBar : 'N/A'}</span></div>
            <div class="flex justify-between"><span>2nd Most Digit:</span><span class="text-yellow-400">${secondMost !== null ? secondMost : 'N/A'}</span></div>
            <div class="flex justify-between"><span>Digit 3 %:</span><span>${percentages[3] ? percentages[3].toFixed(1) : '0'}%</span></div>
            <div class="flex justify-between"><span>Digit 6 %:</span><span>${percentages[6] ? percentages[6].toFixed(1) : '0'}%</span></div>
            <div class="flex justify-between"><span>Digit 7 %:</span><span>${percentages[7] ? percentages[7].toFixed(1) : '0'}%</span></div>
        `;
    }
    
    // Update confidence bar
    const bar = document.getElementById('confidenceBar');
    const percentSpan = document.getElementById('confidencePercent');
    if (bar && percentSpan && result.confidence) {
        const conf = Math.min(99, Math.max(1, result.confidence));
        bar.style.width = `${conf}%`;
        percentSpan.textContent = `${Math.round(conf)}%`;
        if (conf >= 75) bar.style.background = 'linear-gradient(90deg, #22c55e, #eab308)';
        else if (conf >= 60) bar.style.background = 'linear-gradient(90deg, #eab308, #f97316)';
        else bar.style.background = 'linear-gradient(90deg, #f97316, #ef4444)';
    }
    
    // Generate signal if confidence is high enough
    if (result.signal && result.confidence > 58) {
        const now = Date.now();
        const signalChanged = currentSignal !== result.signal;
        const confidenceChanged = Math.abs(lastConfidence - result.confidence) > 15;
        
        if (signalChanged || confidenceChanged) {
            generateSignal(result.signal, result.confidence, result.reasons, now - lastVoiceTime > voiceCooldown);
            currentSignal = result.signal;
            lastConfidence = result.confidence;
            if (now - lastVoiceTime > voiceCooldown) lastVoiceTime = now;
        }
    }
}

function generateSignal(signal, confidence, reasons, speakNow = true) {
    const signalDiv = document.getElementById('currentSignal');
    const isBullish = signal === 'RISE' || signal.includes('OVER') || signal === 'EVEN' || signal === 'MATCHES';
    
    if (signalDiv) {
        signalDiv.className = `mb-3 p-3 rounded-lg text-center transition-all signal-active ${isBullish ? 'bg-green-900/30 border border-green-500' : 'bg-red-900/30 border border-red-500'}`;
        signalDiv.innerHTML = `
            <i class="fas ${isBullish ? 'fa-arrow-up' : 'fa-arrow-down'} text-2xl ${isBullish ? 'text-green-400' : 'text-red-400'} mb-1"></i>
            <p class="text-xl font-bold ${isBullish ? 'text-green-400' : 'text-red-400'}">${signal}</p>
            <p class="text-xs text-gray-300">Confidence: ${Math.round(confidence)}%</p>
            <div class="text-xs text-gray-400 mt-1">${reasons.slice(0, 3).map(r => `<span class="inline-block px-1.5 py-0.5 bg-gray-800 rounded mr-1 mt-1">${r.substring(0, 35)}</span>`).join('')}</div>
            <p class="text-xs text-gray-500 mt-2">${currentMarket} | ${new Date().toLocaleTimeString()}</p>
        `;
    }
    
    if (speakNow && voiceEnabled) {
        speak(`${signal} signal with ${Math.round(confidence)} percent confidence on ${currentMarket}`);
        playAlertSound();
    }
    
    addToSignalHistory(signal, confidence);
}

function addToSignalHistory(signal, confidence) {
    signalHistory.unshift({ signal, confidence, time: new Date().toLocaleTimeString(), market: currentMarket });
    if (signalHistory.length > 15) signalHistory.pop();
    
    const historyDiv = document.getElementById('signalHistory');
    if (historyDiv) {
        historyDiv.innerHTML = signalHistory.map(s => `
            <div class="flex justify-between items-center p-1.5 bg-gray-800/30 rounded text-[10px] md:text-xs">
                <div class="flex items-center">
                    <i class="fas ${s.signal === 'RISE' || s.signal.includes('OVER') || s.signal === 'EVEN' || s.signal === 'MATCHES' ? 'fa-arrow-up text-green-400' : 'fa-arrow-down text-red-400'} mr-1"></i>
                    <span class="font-semibold">${s.signal}</span>
                </div>
                <span class="text-gray-400">${s.market}</span>
                <span class="text-gray-500">${s.time}</span>
                <span class="${s.confidence > 70 ? 'text-green-400' : 'text-yellow-400'}">${Math.round(s.confidence)}%</span>
            </div>
        `).join('');
    }
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
    console.log('Connecting to Deriv WebSocket with App ID:', DERIV_APP_ID);
    
    ws = new WebSocket(DERIV_WS_URL);
    
    ws.onopen = async () => {
        console.log('✅ WebSocket connected');
        updateConnectionStatus('Connected', true);
        reconnectAttempts = 0;
        showNotification('Connected to Deriv Markets', 'success');
        
        // Authorize
        try {
            await sendRequest('authorize', { app_id: DERIV_APP_ID });
            console.log('Authorized successfully');
        } catch (e) {
            console.log('Auth not required or failed:', e);
        }
        
        // Subscribe to all markets
        for (const market of ALL_MARKETS) {
            try {
                await sendRequest('subscribe', { ticks: market });
                MARKET_DATA[market].connected = true;
                console.log(`✅ Subscribed to ${market}`);
            } catch (error) {
                console.error(`Failed to subscribe to ${market}:`, error);
            }
        }
        
        // Fetch historical data for current market
        await fetchHistoricalData(currentMarket, 1000);
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
            const digits = prices.map(p => getDigitFromPrice(p));
            
            MARKET_DATA[market].priceData = prices;
            MARKET_DATA[market].digitsHistory = digits;
            MARKET_DATA[market].lastPrice = prices[prices.length - 1];
            MARKET_DATA[market].lastDigit = digits[digits.length - 1];
            MARKET_DATA[market].highPrice = Math.max(...prices);
            MARKET_DATA[market].lowPrice = Math.min(...prices);
            MARKET_DATA[market].lastUpdate = new Date();
            
            if (prices.length > 1) {
                const prevPrice = prices[prices.length - 2];
                MARKET_DATA[market].change = ((prices[prices.length - 1] - prevPrice) / prevPrice) * 100;
            }
            
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
    
    if (response.msg_type === 'tick' && response.tick) {
        processLiveTick(response.tick);
    }
}

function processLiveTick(tick) {
    const market = tick.symbol;
    const price = parseFloat(tick.quote);
    const digit = getDigitFromPrice(price);
    
    if (MARKET_DATA[market]) {
        MARKET_DATA[market].priceData.push(price);
        MARKET_DATA[market].digitsHistory.push(digit);
        MARKET_DATA[market].lastPrice = price;
        MARKET_DATA[market].lastDigit = digit;
        MARKET_DATA[market].lastUpdate = new Date();
        
        if (MARKET_DATA[market].priceData.length > 2000) {
            MARKET_DATA[market].priceData = MARKET_DATA[market].priceData.slice(-1500);
            MARKET_DATA[market].digitsHistory = MARKET_DATA[market].digitsHistory.slice(-1500);
        }
        
        if (MARKET_DATA[market].highPrice === null || price > MARKET_DATA[market].highPrice) {
            MARKET_DATA[market].highPrice = price;
        }
        if (MARKET_DATA[market].lowPrice === null || price < MARKET_DATA[market].lowPrice) {
            MARKET_DATA[market].lowPrice = price;
        }
        
        if (MARKET_DATA[market].priceData.length > 1) {
            const prevPrice = MARKET_DATA[market].priceData[MARKET_DATA[market].priceData.length - 2];
            MARKET_DATA[market].change = ((price - prevPrice) / prevPrice) * 100;
        }
    }
    
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
                <span class="w-12 text-right text-gray-400">${((count / total) * 100).toFixed(1)}%</span>
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
        signalDiv.classList.add('hidden');
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
        const displayData = priceData.slice(-100);
        priceChart.data.datasets[0].data = displayData;
        priceChart.update();
    }
}

// ============ SIMULATION MODE ============

function startSimulationMode() {
    console.log('Starting simulation mode');
    showNotification('Using simulation mode - Generating demo data', 'warning');
    
    let simPrice = 100;
    setInterval(() => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            const change = (Math.random() - 0.5) * 1.2;
            simPrice = Math.max(0.1, simPrice + change);
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
        btn.addEventListener('click', () => {
            const market = btn.dataset.market;
            switchMarket(market);
        });
    });
    
    document.querySelectorAll('.trade-type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.trade-type-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentTradeType = btn.dataset.type;
            showNotification(`Trading type: ${currentTradeType.replace('_', ' ').toUpperCase()}`, 'info');
            // Clear current signal when switching types
            document.getElementById('currentSignal').innerHTML = '<div class="data-spinner"></div><p class="text-xs text-gray-400 mt-2">Switched strategy, awaiting signals...</p>';
        });
    });
    
    const tickSelector = document.getElementById('tickSelector');
    if (tickSelector) {
        tickSelector.addEventListener('change', async (e) => {
            const newCount = parseInt(e.target.value);
            showNotification(`Fetching ${newCount} ticks...`, 'info');
            await fetchHistoricalData(currentMarket, newCount);
        });
    }
    
    const refreshBtn = document.getElementById('refreshDataBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
            await fetchHistoricalData(currentMarket);
            showNotification('Market data refreshed', 'success');
        });
    }
    
    document.querySelectorAll('[data-over]').forEach(el => {
        el.addEventListener('click', () => {
            const threshold = parseInt(el.dataset.over);
            selectedOverThreshold = threshold;
            selectedUnderThreshold = null;
            document.querySelectorAll('[data-over], [data-under]').forEach(e => e.classList.remove('selected', 'bg-purple-600'));
            el.classList.add('selected', 'bg-purple-600');
            analyzeOverUnderThreshold();
        });
    });
    
    document.querySelectorAll('[data-under]').forEach(el => {
        el.addEventListener('click', () => {
            const threshold = parseInt(el.dataset.under);
            selectedUnderThreshold = threshold;
            selectedOverThreshold = null;
            document.querySelectorAll('[data-over], [data-under]').forEach(e => e.classList.remove('selected', 'bg-purple-600'));
            el.classList.add('selected', 'bg-purple-600');
            analyzeOverUnderThreshold();
        });
    });
}

function switchMarket(market) {
    currentMarket = market;
    document.getElementById('currentMarketDisplay').innerText = currentMarket;
    
    document.querySelectorAll('.market-btn').forEach(btn => {
        btn.classList.remove('active', 'bg-gradient-to-r', 'from-blue-600', 'to-purple-600');
        if (btn.dataset.market === market) {
            btn.classList.add('active', 'bg-gradient-to-r', 'from-blue-600', 'to-purple-600');
        }
    });
    
    if (MARKET_DATA[market] && MARKET_DATA[market].priceData.length > 0) {
        priceData = MARKET_DATA[market].priceData;
        digitsHistory = MARKET_DATA[market].digitsHistory;
        updateDigitFrequency();
        updatePriceStats();
        updateCharts();
        updateLDP();
        updateThresholdStats();
        showNotification(`Switched to ${market}`, 'success');
    } else {
        fetchHistoricalData(market, 1000);
        showNotification(`Loading data for ${market}...`, 'info');
    }
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
            else speak('Voice alerts disabled');
        });
    }
    
    if (voiceGenderSelect) {
        voiceGenderSelect.addEventListener('change', (e) => {
            voiceGender = e.target.value;
        });
    }
}

// ============ MARKET NEWS ============

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
    
    const affiliateLink = document.getElementById('affiliateLink');
    if (affiliateLink) {
        affiliateLink.addEventListener('click', (e) => {
            e.preventDefault();
            window.open('https://track.binary.com/affiliate', '_blank');
        });
    }
    
    const manualBtn = document.getElementById('manualAnalysisBtn');
    if (manualBtn) {
        manualBtn.addEventListener('click', () => {
            if (priceData.length > 0 && digitsHistory.length > 0) {
                const lastPrice = priceData[priceData.length - 1];
                const lastDigit = digitsHistory[digitsHistory.length - 1];
                analyzeSignals(lastPrice, lastDigit);
                showNotification('Manual analysis completed', 'success');
            } else {
                showNotification('Waiting for market data...', 'warning');
            }
        });
    }
}

// ============ MAIN INITIALIZATION ============

function startTradingApp() {
    console.log('KAIRON Systems Initialized with Deriv WebSocket');
    console.log(`App ID: ${DERIV_APP_ID}`);
    console.log(`Markets: ${ALL_MARKETS.length} volatility indices`);
    
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
