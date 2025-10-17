<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Dashboard - Emergency Reports</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Noto+Sans+Kannada:wght@700&display=swap" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css" rel="stylesheet">
    <link rel="icon" href="The-Karnataka-Government-Kannada-Logo-Vector.svg-.png" type="image/x-icon">
    <style>
        body { 
            font-family: 'Inter', 'Noto Sans Kannada', sans-serif; 
            background: linear-gradient(135deg, #e0f2fe 0%, #bfdbfe 100%); 
            min-height: 100vh;
        }
        .card { 
            border-radius: 1.5rem; 
            box-shadow: 0 10px 30px rgba(10, 40, 80, 0.1), 0 4px 10px rgba(10, 40, 80, 0.05);
            border: 1px solid #f0f4f8; 
            background: rgba(255, 255, 255, 0.98);
        }
        .btn { 
            border-radius: 1rem; 
            padding: 0.75rem 1rem; 
            font-weight: 600; 
            transition: transform 0.1s, box-shadow 0.2s; 
            box-shadow: 0 3px 6px rgba(0,0,0,0.1);
        }
        .btn:hover { 
            transform: translateY(-2px); 
            box-shadow: 0 6px 15px rgba(0,0,0,0.15); 
        }
    </style>
</head>
<body class="min-h-screen flex flex-col p-4">

        <nav class="w-full bg-white/30 backdrop-blur-sm rounded-2xl shadow-lg p-4 flex items-center justify-between mb-6">
        <div class="flex items-center gap-4">
            <img src="The-Karnataka-Government-Kannada-Logo-Vector.svg-.png" alt="Government of Karnataka" class="w-10 h-10 rounded bg-white p-1">
            <div>
                <div class="text-lg font-bold text-gray-800">ADMIN DASHBOARD</div>
                <div class="text-xs text-gray-600">Emergency Reports Management</div>
            </div>
        </div>
        <button onclick="logout()" class="btn bg-red-500 text-white text-sm">
            <i class="fas fa-sign-out-alt mr-1"></i>
            Logout
        </button>
    </nav>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <div class="card p-6 text-center">
            <i class="fas fa-exclamation-triangle text-red-500 text-3xl mb-2"></i>
            <div class="text-2xl font-bold text-gray-800" id="totalReports">0</div>
            <div class="text-sm text-gray-600">Total Reports</div>
        </div>
        <div class="card p-6 text-center">
            <i class="fas fa-clock text-yellow-500 text-3xl mb-2"></i>
            <div class="text-2xl font-bold text-gray-800" id="todayReports">0</div>
            <div class="text-sm text-gray-600">Today's Reports</div>
        </div>
        <div class="card p-6 text-center">
            <i class="fas fa-video text-blue-500 text-3xl mb-2"></i>
            <div class="text-2xl font-bold text-gray-800" id="mediaReports">0</div>
            <div class="text-sm text-gray-600">With Media</div>
        </div>
     </div>

        <main class="flex-1">
        <div class="card p-6">
            <div class="flex justify-between items-center mb-6">
                <h2 class="text-xl font-bold text-gray-800">Emergency Reports</h2>
                <button onclick="refreshReports()" class="btn bg-blue-500 text-white">
                    <i class="fas fa-refresh mr-2"></i>
                    Refresh
                </button>
            </div>

            <div id="loading" class="text-center py-8">
                <i class="fas fa-spinner fa-spin text-2xl text-gray-400"></i>
                <p class="text-gray-600 mt-2">Loading reports...</p>
            </div>

            <div id="reportsContainer" class="hidden">
                <div class="overflow-x-auto">
                    <table class="w-full">
                        <thead>
                            <tr class="border-b border-gray-200">
                                <th class="text-left py-3 px-4 font-semibold text-gray-700">Time</th>
                                <th class="text-left py-3 px-4 font-semibold text-gray-700">Name</th>
                                <th class="text-left py-3 px-4 font-semibold text-gray-700">Phone</th>
                                <th class="text-left py-3 px-4 font-semibold text-gray-700">Mode</th>
                                <th class="text-left py-3 px-4 font-semibold text-gray-700">Location</th>
                                <th class="text-left py-3 px-4 font-semibold text-gray-700">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="reportsTable">
                        </tbody>
                    </table>
                </div>
            </div>

            <div id="noReports" class="text-center py-8 hidden">
                <i class="fas fa-inbox text-4xl text-gray-300 mb-3"></i>
                <p class="text-gray-600">No reports found</p>
            </div>
        </div>
    </main>

        <div id="reportModal" class="fixed inset-0 bg-black bg-opacity-50 hidden flex items-center justify-center p-4 z-50">
        <div class="card p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-lg font-bold text-gray-800">Report Details</h3>
                <button onclick="closeModal()" class="text-gray-500 hover:text-gray-700">
                    <i class="fas fa-times text-xl"></i>
                </button>
            </div>
            <div id="reportDetails"></div>
        </div>
    </div>

    <script>
        // Check authentication
        if (!localStorage.getItem('adminLoggedIn')) {
            window.location.href = 'admin.html';
        }

        let reports = [];

        function logout() {
            localStorage.removeItem('adminLoggedIn');
            window.location.href = 'admin.html';
        }

        async function loadReports() {
            try {
                const response = await fetch('/api/reports');
                reports = await response.json();
                updateStats();
                renderReports();
            } catch (error) {
                console.error('Error loading reports:', error);
            }
        }

        function updateStats() {
            // Note: submittedAt from DB is snake_case, JS variable uses camelCase
            const today = new Date().toDateString();
            const todayReports = reports.filter(r => new Date(r.submitted_at).toDateString() === today);
            const mediaReports = reports.filter(r => r.audio_url || r.video_url);

            document.getElementById('totalReports').textContent = reports.length;
            document.getElementById('todayReports').textContent = todayReports.length;
            document.getElementById('mediaReports').textContent = mediaReports.length;
        }

        function renderReports() {
            const container = document.getElementById('reportsContainer');
            const loading = document.getElementById('loading');
            const noReports = document.getElementById('noReports');
            const tbody = document.getElementById('reportsTable');

            loading.classList.add('hidden');

            if (reports.length === 0) {
                noReports.classList.remove('hidden');
                container.classList.add('hidden');
                return;
            }

            noReports.classList.add('hidden');
            container.classList.remove('hidden');

            tbody.innerHTML = reports.map(report => `
                <tr class="border-b border-gray-100 hover:bg-gray-50 ${report.status === 'acknowledged' ? 'bg-green-50/50' : ''}">
                    <td class="py-3 px-4 text-sm">${new Date(report.submitted_at).toLocaleString()}</td>
                    <td class="py-3 px-4 text-sm">${report.name || 'Anonymous'}</td>
                    <td class="py-3 px-4 text-sm">${report.phone || 'N/A'}</td>
                    <td class="py-3 px-4">
                        <span class="px-2 py-1 text-xs rounded-full ${getModeColor(report.mode)}">
                            ${report.mode}
                        </span>
                    </td>
                    <td class="py-3 px-4 text-sm">
                        ${report.latitude && report.longitude ? 
                            `<a href="https://maps.google.com/?q=${report.latitude},${report.longitude}" target="_blank" class="text-blue-600 hover:underline">
                                <i class="fas fa-map-marker-alt mr-1"></i>View
                            </a>` : 'N/A'}
                    </td>
                    <td class="py-3 px-4">
                        <button onclick="viewReport(${report.id})" class="btn bg-blue-500 text-white text-xs">
                            View Details
                        </button>
                    </td>
                </tr>
            `).join('');
        }

        function getModeColor(mode) {
            switch(mode) {
                case 'video': return 'bg-pink-100 text-pink-800';
                case 'audio': return 'bg-teal-100 text-teal-800';
                default: return 'bg-blue-100 text-blue-800';
            }
        }

        // Modified to use report.id for lookup
        function viewReport(reportId) {
            const report = reports.find(r => r.id === reportId);
            if (!report) return;

            const modal = document.getElementById('reportModal');
            const details = document.getElementById('reportDetails');

            // --- Content rendering logic goes here (simplified for this prompt) ---
            details.innerHTML = `
                <p><strong>Complaint:</strong> ${report.complaint}</p>
                <p><strong>Submitted At:</strong> ${new Date(report.submitted_at).toLocaleString()}</p>
                ${report.status === 'acknowledged' ? `<p class="mt-2 text-green-600"><strong>Acknowledged by:</strong> ${report.acknowledged_by_user_id}</p>` : ''}
                <p class="mt-4"><strong>Media:</strong></p>
                ${report.video_url ? `<video controls src="${report.video_url}" class="w-full max-h-64 mt-2"></video>` : ''}
                ${report.audio_url ? `<audio controls src="${report.audio_url}" class="w-full mt-2"></audio>` : ''}
                <button onclick="acknowledgeReport(${report.id})" class="mt-4 btn bg-green-500 text-white ${report.status === 'acknowledged' ? 'opacity-50 cursor-not-allowed' : ''}" ${report.status === 'acknowledged' ? 'disabled' : ''}>
                    Acknowledge
                </button>
            `;

            modal.classList.remove('hidden');
        }
        
        async function acknowledgeReport(reportId) {
            if (reports.find(r => r.id === reportId)?.status === 'acknowledged') return;
            
            const adminId = localStorage.getItem('adminLoggedIn'); // Assumes admin ID is stored here
            
            try {
                const response = await fetch(`/api/reports/${reportId}/acknowledge`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: adminId || 'admin_browser_user' }) 
                });

                if (response.ok) {
                    // The server will broadcast the update, which will trigger loadReports() via WebSocket
                    closeModal();
                } else {
                    alert('Failed to acknowledge report.');
                }
            } catch (error) {
                console.error('Error acknowledging report:', error);
                alert('Network error while acknowledging report.');
            }
        }

        function closeModal() {
            document.getElementById('reportModal').classList.add('hidden');
        }

        function refreshReports() {
            document.getElementById('loading').classList.remove('hidden');
            document.getElementById('reportsContainer').classList.add('hidden');
            loadReports();
        }
        
        // --- NEW: WEBSOCKET INTEGRATION FOR REAL-TIME REFRESH ---
        const WEBSOCKET_URL = "ws://" + window.location.host; 

        function connectWebSocket() {
            const ws = new WebSocket(WEBSOCKET_URL);

            ws.onopen = () => {
                console.log("🔗 WebSocket Connected to server.");
            };

            ws.onmessage = (event) => {
                console.log("📢 WS Message received:", event.data);
                try {
                    const message = JSON.parse(event.data);
                    if (message.type === 'REFRESH_REPORTS') {
                        console.log('🔄 Server requested report refresh. Auto-refreshing...');
                        refreshReports(); // Triggers loading and rendering new data
                    }
                } catch (e) {
                    console.error("Error parsing WS message:", e);
                }
            };

            ws.onclose = (event) => {
                console.log(`🔌 WebSocket Disconnected. Code: ${event.code}. Reconnecting in 5s...`);
                // Attempt to reconnect after a delay
                setTimeout(connectWebSocket, 5000);
            };

            ws.onerror = (error) => {
                console.error("❌ WebSocket Error:", error);
                ws.close(); // Force close to trigger onclose and reconnection logic
            };
        }

        // Initialize
        loadReports();
        connectWebSocket(); // Start the WebSocket connection on load
        
        // Auto-refresh logic is now handled by WebSockets
    </script>
</body>
</html>
