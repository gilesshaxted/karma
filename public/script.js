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

    // Handle OAuth callback
    const code = getUrlParameter('code');
    if (code) {
        // Exchange code for token
        fetch('/api/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ code })
        })
        .then(response => response.json())
        .then(data => {
            if (data.access_token) {
                discordAccessToken = data.access_token;
                localStorage.setItem('discord_access_token', discordAccessToken);
                // Remove code from URL
                window.history.replaceState({}, document.title, "/");
                loadDashboard();
            } else {
                console.error('Failed to get access token:', data);
                alert('Failed to log in with Discord. Please try again.');
                showAuthSection();
            }
        })
        .catch(error => {
            console.error('Error during token exchange:', error);
            alert('An error occurred during login. Please try again.');
            showAuthSection();
        });
    } else {
        // Check for existing token
        discordAccessToken = localStorage.getItem('discord_access_token');
        if (discordAccessToken) {
            loadDashboard();
        } else {
            showAuthSection();
        }
    }

    // Show/Hide sections
    function showAuthSection() {
        authSection.style.display = 'block';
        dashboardSection.style.display = 'none';
    }

    function showDashboardSection() {
        authSection.style.display = 'none';
        dashboardSection.style.display = 'block';
    }

    // Populate a select element with options (channels or roles)
    function populateSelect(selectElement, items, selectedId) {
        selectElement.innerHTML = '<option value="">None</option>'; // Default option
        items.forEach(item => {
            const option = document.createElement('option');
            option.value = item.id;
            option.textContent = item.name;
            if (item.id === selectedId) {
                option.selected = true;
            }
            selectElement.appendChild(option);
        });
    }

    // Load dashboard data (user info, guilds)
    async function loadDashboard() {
        showDashboardSection();
        try {
            // Fetch user info
            const userResponse = await fetch('/api/user', {
                headers: { 'Authorization': `Bearer ${discordAccessToken}` }
            });
            const userData = await userResponse.json();
            if (userResponse.ok) {
                userDisplayName.textContent = userData.username;
            } else {
                throw new Error(userData.message || 'Failed to fetch user data');
            }

            // Fetch guilds where bot is admin
            const guildsResponse = await fetch('/api/guilds', {
                headers: { 'Authorization': `Bearer ${discordAccessToken}` }
            });
            const guildsData = await guildsResponse.json();
            if (guildsResponse.ok) {
                guildSelect.innerHTML = '<option value="">-- Select a Guild --</option>';
                guildsData.forEach(guild => {
                    const option = document.createElement('option');
                    option.value = guild.id;
                    option.textContent = guild.name;
                    guildSelect.appendChild(option);
                });
            } else {
                throw new Error(guildsData.message || 'Failed to fetch guilds');
            }

        } catch (error) {
            console.error('Error loading dashboard:', error);
            alert('Error loading dashboard. Please log in again.');
            localStorage.removeItem('discord_access_token'); // Clear invalid token
            showAuthSection();
        }
    }

    // Load guild-specific configuration
    async function loadGuildConfig(guildId) {
        configSection.style.display = 'none';
        saveStatus.textContent = 'Loading configuration...';
        saveStatus.className = 'status-message';

        try {
            const configResponse = await fetch(`/api/guild-config?guildId=${guildId}`, {
                headers: { 'Authorization': `Bearer ${discordAccessToken}` }
            });
            const configData = await configResponse.json();

            if (configResponse.ok) {
                guildData = configData.guildData; // Store all guild data (roles, channels)
                const currentConfig = configData.currentConfig; // Current bot config

                selectedGuildName.textContent = guildData.name;

                // Populate role selects
                populateSelect(document.getElementById('mod-role-select'), guildData.roles, currentConfig.modRoleId);
                populateSelect(document.getElementById('admin-role-select'), guildData.roles, currentConfig.adminRoleId);

                // Populate channel selects
                const textChannels = guildData.channels.filter(c => c.type === 0); // Type 0 is GUILD_TEXT
                populateSelect(document.getElementById('mod-log-channel-select'), textChannels, currentConfig.moderationLogChannelId);
                populateSelect(document.getElementById('message-log-channel-select'), textChannels, currentConfig.messageLogChannelId);
                populateSelect(document.getElementById('mod-alert-channel-select'), textChannels, currentConfig.modAlertChannelId);
                populateSelect(document.getElementById('mod-ping-role-select'), guildData.roles, currentConfig.modPingRoleId);

                configSection.style.display = 'block';
                saveStatus.textContent = '';
            } else {
                throw new Error(configData.message || 'Failed to load guild configuration.');
            }
        } catch (error) {
            console.error('Error loading guild config:', error);
            saveStatus.textContent = `Error: ${error.message}`;
            saveStatus.className = 'status-message error';
            configSection.style.display = 'none';
        }
    }

    // Event Listeners
    loginButton.addEventListener('click', () => {
        // Redirect to backend for Discord OAuth login
        window.location.href = '/api/login';
    });

    guildSelect.addEventListener('change', (event) => {
        selectedGuildId = event.target.value;
        if (selectedGuildId) {
            loadGuildConfig(selectedGuildId);
        } else {
            configSection.style.display = 'none';
            saveStatus.textContent = '';
        }
    });

    configForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        saveStatus.textContent = 'Saving configuration...';
        saveStatus.className = 'status-message';
        saveConfigButton.disabled = true;

        const newConfig = {
            modRoleId: document.getElementById('mod-role-select').value || null,
            adminRoleId: document.getElementById('admin-role-select').value || null,
            moderationLogChannelId: document.getElementById('mod-log-channel-select').value || null,
            messageLogChannelId: document.getElementById('message-log-channel-select').value || null,
            modAlertChannelId: document.getElementById('mod-alert-channel-select').value || null,
            modPingRoleId: document.getElementById('mod-ping-role-select').value || null,
        };

        try {
            const response = await fetch(`/api/save-config?guildId=${selectedGuildId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${discordAccessToken}`
                },
                body: JSON.stringify(newConfig)
            });
            const data = await response.json();

            if (response.ok) {
                saveStatus.textContent = 'Configuration saved successfully!';
                saveStatus.className = 'status-message success';
            } else {
                throw new Error(data.message || 'Failed to save configuration.');
            }
        } catch (error) {
            console.error('Error saving config:', error);
            saveStatus.textContent = `Error: ${error.message}`;
            saveStatus.className = 'status-message error';
        } finally {
            saveConfigButton.disabled = false;
        }
    });
});
