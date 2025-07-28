// public/script.js
document.addEventListener('DOMContentLoaded', () => {
    const loginButton = document.getElementById('login-button');
    const authSection = document.getElementById('auth-section');
    const dashboardSection = document.getElementById('dashboard-section');
    const userDisplayName = document.getElementById('user-display-name');
    const guildSelect = document.getElementById('guild-select');
    const configSection = document.getElementById('config-section');
    const selectedGuildName = document.getElementById('selected-guild-name');
    const configForm = document.getElementById('config-form');
    const saveConfigButton = document.getElementById('save-config-button');
    const saveStatus = document.getElementById('save-status');

    let discordAccessToken = null;
    let selectedGuildId = null;
    let guildData = {}; // To store roles and channels for the selected guild

    // Function to get URL parameters
    const getUrlParameter = (name) => {
        name = name.replace(/[\[]/, '\\[').replace(/[\]]/, '\\]');
        const regex = new RegExp('[\\?&]' + name + '=([^&#]*)');
        const results = regex.exec(location.search);
        return results === null ? '' : decodeURIComponent(results[1].replace(/\+/g, ' '));
    };

    // Function to handle loading dashboard data (simplified, without aggressive retries/token clearing)
    async function loadDashboard() {
        showDashboardSection();
        saveStatus.textContent = 'Loading dashboard...';
        saveStatus.className = 'status-message';

        try {
            // Fetch user info
            const userResponse = await fetch('/api/user', {
                headers: { 'Authorization': `Bearer ${discordAccessToken}` }
            });

            if (!userResponse.ok) {
                // Only clear token for explicit auth failures, not 503 (bot not ready)
                if (userResponse.status === 401 || userResponse.status === 403) {
                    localStorage.removeItem('discord_access_token');
                }
                throw new Error(await userResponse.text() || 'Failed to fetch user data');
            }
            const userData = await userResponse.json();
            userDisplayName.textContent = userData.username;

            // Fetch guilds where bot is admin
            const guildsResponse = await fetch('/api/guilds', {
                headers: { 'Authorization': `Bearer ${discordAccessToken}` }
            });
            if (!guildsResponse.ok) {
                // Only clear token for explicit auth failures, not 503 (bot not ready)
                if (guildsResponse.status === 401 || guildsResponse.status === 403) {
                    localStorage.removeItem('discord_access_token');
                }
                throw new Error(await guildsResponse.text() || 'Failed to fetch guilds');
            }
            const guildsData = await guildsResponse.json();
            
            guildSelect.innerHTML = '<option value="">-- Select a Guild --</option>';
            guildsData.forEach(guild => {
                const option = document.createElement('option');
                option.value = guild.id;
                option.textConten
