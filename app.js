// API Configuration
const API_URL = 'http://localhost:5000/api'; // Change to your backend URL when deployed

// Global variables
let priceChart = null;
let historicalPrices = [];
let signalHistory = [];
let sessionTimer = null;
let sessionStart = null;

// Check authentication on page load
document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('token');
    const currentPage = window.location.pathname;
    
    if (currentPage.includes('dashboard.html')) {
        if (!token) {
            window.location.href = 'index.html';
        } else {
            loadDashboard();
            startSessionTimer();
            startAutoRefresh();
        }
    }
});

// ============ AUTHENTICATION FUNCTIONS ============

async function handleLogin(event) {
    event.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    
    try {
        const response = await axios.post(`${API_URL}/auth/login`, { email, password });
        
        if (response.data.token) {
            localStorage.setItem('token', response.data.token);
            localStorage.setItem('user', JSON.stringify(response.data.user));
            
            showToast('Login successful! Redirecting...', 'success');
            setTimeout(() => {
                window.location.href = 'dashboard.html';
            }, 1000);
        }
    } catch (error) {
        if (error.response?.data?.error === 'SESSION_TERMINATED') {
            showToast('Session terminated. Please purchase a new license.', 'error');
        } else {
            showToast(error.response?.data?.error || 'Login failed', 'error');
        }
    }
}

async function handleSignup(event) {
    event.preventDefault();
    const name = document.getElementById('signupName').value;
    const email = document.getElementById('signupEmail').value;
    const phone = document.getElementById('signupPhone').value;
    const password = document.getElementById('signupPassword').value;
    
    try {
        const response = await axios.post(`${API_URL}/auth/signup`, {
            fullName: name,
            email,
            phone,
            password
        });
        
        showToast('Account created! Please login.', 'success');
        closeSignupModal();
        showLoginModal();
    } catch (error) {
        showToast(error.response?.data?.error || 'Signup failed', 'error');
    }
}

async function logout() {
    try {
        const token = localStorage.getItem('token');
        if (token) {
            await axios.post(`${API_URL}/auth/logout`, {}, {
                headers: { Authorization: `Bearer ${token}` }
            });
        }
    } catch (error) {
        console.error('Logout error:', error);
    }
    
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = 'index.html';
}

// ============ DASHBOARD FUNCTIONS ============

async function loadDashboard() {
    try {
        const token = localStorage.getItem('token');
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        
        // Load performance stats
        const performance = await axios.get(`${API_URL}/trading/performance`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        
        document.getElementById('winRate').innerText = `${Math.round(performance.data.win_rate || 0)}%`;
        document.getElementById('successfulTrades').innerText = performance.data.successful_signals || 0;
        document.getElementById('totalSignals').innerText = performance.data.total_signals || 0;
        
        // Load subscription info
        const subscriptionStatus = await axios.get(`${API_URL}/auth/subscription-status`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        
        const subInfo = document.getElementById('subscriptionInfo');
        if (subscriptionStatus.data.hasActiveSubscription) {
            subInfo.innerHTML = '<i class="fas fa-check-circle text-green-400 mr-1"></i> Active until Dec 31, 2024';
        } else {
            subInfo.innerHTML = '<i class="fas fa-exclamation-triangle text-yellow-400 mr-1"></i> No active subscription';
        }
        
        // Load historical data for chart
        await loadHistoricalData();
        
    } catch (error) {
        if (error.response?.status === 401) {
            showToast('Session expired. Please login again.', 'error');
            setTimeout(() => logout(), 2000);
        }
    }
}

async function loadHistoricalData() {
    const token = localStorage.getItem('token');
    const symbol = document.getElementById('symbol').value;
    
    try {
        const response = await axios.post(`${API_URL}/trading/historical`, 
            { symbol, count: 50 },
            { headers: { Authorization: `Bearer ${token}` } }
        );
        
        historicalPrices = response.data.data;
        updateChart();
        
        document.getElementById('lastUpdate').innerHTML = `Last updated: ${new Date().toLocaleTimeString()}`;
    } catch (error) {
        console.error('Failed to load historical data:', error);
    }
}

function updateChart() {
    const ctx = document.getElementById('priceChart').getContext('2d');
    
    if (priceChart) {
        priceChart.destroy();
    }
    
    priceChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: historicalPrices.map((_, i) => i),
            datasets: [{
                label: 'Price',
                data: historicalPrices.map(p => p.price),
                borderColor: '#3B82F6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
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
}

async function getSignal() {
    const token = localStorage.getItem('token');
    const symbol = document.getElementById('symbol').value;
    const marketType = document.getElementById('marketType').value;
    const btn = document.getElementById('getSignalBtn');
    
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Analyzing...';
    
    try {
        const response = await axios.post(`${API_URL}/trading/signal`,
            { symbol, market: marketType },
            { headers: { Authorization: `Bearer ${token}` } }
        );
        
        displaySignal(response.data);
        
        // Add to history
        if (response.data.hasSignal) {
            addToHistory(response.data);
        }
        
        // Refresh chart after signal
        await loadHistoricalData();
        
    } catch (error) {
        if (error.response?.status === 401) {
            showToast('Session expired. Please login again.', 'error');
            setTimeout(() => logout(), 2000);
        } else {
            showToast(error.response?.data?.error || 'Failed to get signal', 'error');
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-chart-line mr-2"></i>Get Signal';
    }
}

function displaySignal(data) {
    const signalDiv = document.getElementById('signalDisplay');
    
    if (!data.hasSignal) {
        signalDiv.className = 'mt-6 p-4 rounded-lg border border-gray-600 bg-gray-700/30 text-center';
        signalDiv.innerHTML = `
            <i class="fas fa-clock text-yellow-400 text-3xl mb-2"></i>
            <p class="text-gray-300">No clear signal at this time</p>
            <p class="text-gray-500 text-sm mt-1">Waiting for better market conditions</p>
        `;
        signalDiv.classList.remove('hidden');
        return;
    }
    
    const isRise = data.signal === 'RISE';
    signalDiv.className = `mt-6 p-4 rounded-lg border transition-all ${
        isRise ? 'bg-green-900/30 border-green-700' : 'bg-red-900/30 border-red-700'
    }`;
    
    signalDiv.innerHTML = `
        <div class="text-center">
            <i class="fas ${isRise ? 'fa-arrow-up' : 'fa-arrow-down'} text-4xl ${isRise ? 'text-green-400' : 'text-red-400'} mb-2"></i>
            <div class="text-2xl font-bold ${isRise ? 'text-green-400' : 'text-red-400'} mb-1">
                ${data.recommendation || (data.signal === 'RISE' ? 'BUY CALL' : 'BUY PUT')}
            </div>
            <div class="text-sm text-gray-300 mb-2">
                Confidence: ${data.confidence || 75}%
            </div>
            ${data.reasons ? `
                <div class="text-xs text-gray-400 mt-2">
                    ${data.reasons.map(r => `<span class="inline-block px-2 py-1 bg-gray-700 rounded mr-1 mb-1">${r}</span>`).join('')}
                </div>
            ` : ''}
            <div class="text-xs text-gray-500 mt-3">
                Price: ${data.currentPrice} | ${new Date(data.timestamp).toLocaleTimeString()}
            </div>
        </div>
    `;
    
    signalDiv.classList.remove('hidden');
    
    // Play sound alert (optional)
    const audio = new Audio('https://www.soundjay.com/misc/sounds/bell-ringing-05.mp3');
    audio.play().catch(e => console.log('Audio not supported'));
}

function addToHistory(signal) {
    signalHistory.unshift(signal);
    if (signalHistory.length > 10) signalHistory.pop();
    
    const historyDiv = document.getElementById('signalHistory');
    
    if (signalHistory.length === 0) {
        historyDiv.innerHTML = '<p class="text-gray-500 text-center py-4">No signals yet. Click "Get Signal" to start.</p>';
        return;
    }
    
    historyDiv.innerHTML = signalHistory.map(s => `
        <div class="flex justify-between items-center p-3 bg-gray-700/30 rounded-lg border border-gray-700">
            <div class="flex items-center">
                <i class="fas ${s.signal === 'RISE' ? 'fa-arrow-up text-green-400' : 'fa-arrow-down text-red-400'} mr-2"></i>
                <span class="text-white font-medium">${s.signal === 'RISE' ? 'CALL' : 'PUT'}</span>
            </div>
            <div class="text-sm text-gray-400">${s.symbol || 'R_100'}</div>
            <div class="text-sm text-gray-400">${new Date(s.timestamp).toLocaleTimeString()}</div>
            <div class="text-xs ${s.confidence >= 70 ? 'text-green-400' : 'text-yellow-400'}">${s.confidence || 75}%</div>
        </div>
    `).join('');
}

// ============ PAYMENT FUNCTIONS ============

function showPaymentModal(planId, amount, planName) {
    const modal = document.getElementById('paymentModal');
    const content = document.getElementById('paymentContent');
    
    content.innerHTML = `
        <div class="mb-6 p-4 bg-blue-900/20 rounded-lg border border-blue-700">
            <div class="flex justify-between mb-2">
                <span class="text-gray-300">Plan:</span>
                <span class="text-white font-semibold">${planName}</span>
            </div>
            <div class="flex justify-between">
                <span class="text-gray-300">Amount:</span>
                <span class="text-2xl font-bold text-blue-400">KSh ${amount.toLocaleString()}</span>
            </div>
        </div>
        
        <div class="mb-4">
            <label class="block text-sm font-medium text-gray-300 mb-2">M-Pesa Phone Number</label>
            <div class="relative">
                <i class="fas fa-phone absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500"></i>
                <input type="tel" id="mpesaPhone" placeholder="0712345678" class="w-full pl-10 pr-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white">
            </div>
            <p class="text-xs text-gray-500 mt-1">You will receive an STK Push on this number</p>
        </div>
        
        <button onclick="initiatePayment('${planId}', ${amount})" class="w-full py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition">
            <i class="fas fa-credit-card mr-2"></i>Pay with M-Pesa
        </button>
    `;
    
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

async function initiatePayment(planId, amount) {
    const phone = document.getElementById('mpesaPhone').value;
    const token = localStorage.getItem('token');
    
    if (!phone) {
        showToast('Please enter your M-Pesa phone number', 'error');
        return;
    }
    
    try {
        const response = await axios.post(`${API_URL}/payment/initiate`, 
            { planId, phoneNumber: phone },
            { headers: { Authorization: `Bearer ${token}` } }
        );
        
        if (response.data.success) {
            showToast('STK Push sent! Check your phone and enter PIN', 'success');
            
            // Poll for payment status
            pollPaymentStatus(response.data.checkoutRequestId);
        }
    } catch (error) {
        showToast(error.response?.data?.error || 'Payment failed', 'error');
    }
}

async function pollPaymentStatus(checkoutId) {
    const token = localStorage.getItem('token');
    const interval = setInterval(async () => {
        try {
            const response = await axios.get(`${API_URL}/payment/status/${checkoutId}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            
            if (response.data.success && response.data.resultCode === '0') {
                clearInterval(interval);
                showToast('Payment successful! Subscription activated.', 'success');
                closePaymentModal();
                loadDashboard(); // Refresh dashboard
            }
        } catch (error) {
            // Continue polling
        }
    }, 3000);
    
    // Stop polling after 2 minutes
    setTimeout(() => clearInterval(interval), 120000);
}

// ============ UI HELPER FUNCTIONS ============

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast px-6 py-3 rounded-lg shadow-lg ${
        type === 'success' ? 'bg-green-600' : type === 'error' ? 'bg-red-600' : 'bg-blue-600'
    } text-white`;
    toast.innerHTML = `
        <div class="flex items-center">
            <i class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'} mr-2"></i>
            <span>${message}</span>
        </div>
    `;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 5000);
}

function startSessionTimer() {
    sessionStart = Date.now();
    sessionTimer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - sessionStart) / 1000);
        const hours = Math.floor(elapsed / 3600);
        const minutes = Math.floor((elapsed % 3600) / 60);
        const seconds = elapsed % 60;
        
        const timerElement = document.getElementById('sessionTime');
        if (timerElement) {
            timerElement.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }
    }, 1000);
}

function startAutoRefresh() {
    // Refresh chart every 30 seconds
    setInterval(() => {
        if (window.location.pathname.includes('dashboard.html')) {
            loadHistoricalData();
        }
    }, 30000);
}

function showLoginModal() {
    document.getElementById('loginModal').classList.remove('hidden');
    document.getElementById('loginModal').classList.add('flex');
}

function closeLoginModal() {
    document.getElementById('loginModal').classList.add('hidden');
    document.getElementById('loginModal').classList.remove('flex');
}

function showSignupModal() {
    document.getElementById('signupModal').classList.remove('hidden');
    document.getElementById('signupModal').classList.add('flex');
}

function closeSignupModal() {
    document.getElementById('signupModal').classList.add('hidden');
    document.getElementById('signupModal').classList.remove('flex');
}

function closePaymentModal() {
    document.getElementById('paymentModal').classList.add('hidden');
    document.getElementById('paymentModal').classList.remove('flex');
}

function showUpgradeModal() {
    const plans = [
        { id: 'basic_monthly', name: 'Basic Trader', price: 5000 },
        { id: 'pro_monthly', name: 'Pro Trader', price: 10000 },
        { id: 'enterprise_monthly', name: 'Enterprise', price: 30000 }
    ];
    
    const content = document.getElementById('paymentContent');
    content.innerHTML = `
        <div class="space-y-3">
            ${plans.map(plan => `
                <button onclick="showPaymentModal('${plan.id}', ${plan.price}, '${plan.name}')" 
                        class="w-full p-4 bg-gray-700 hover:bg-gray-600 rounded-lg text-left transition">
                    <div class="flex justify-between items-center">
                        <div>
                            <h4 class="font-semibold text-white">${plan.name}</h4>
                            <p class="text-sm text-gray-400">KSh ${plan.price.toLocaleString()}/month</p>
                        </div>
                        <i class="fas fa-chevron-right text-gray-400"></i>
                    </div>
                </button>
            `).join('')}
        </div>
    `;
    
    document.getElementById('paymentModal').classList.remove('hidden');
    document.getElementById('paymentModal').classList.add('flex');
}

function switchToLogin() {
    closeSignupModal();
    showLoginModal();
}

function switchToSignup() {
    closeLoginModal();
    showSignupModal();
}

function scrollToFeatures() {
    document.getElementById('features').scrollIntoView({ behavior: 'smooth' });
}
