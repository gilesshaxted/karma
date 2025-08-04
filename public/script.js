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

    // Function to handle loading dashboard data (with retries for 503 errors)
    async function loadDashboard() {
        showDashboardSection();
        saveStatus.textContent = 'Loading dashboard...';
        saveStatus.className = 'status-message';
        
        const MAX_RETRIES = 15;
        const INITIAL_DELAY = 3000; // 3 seconds

        async function fetchWithRetry(url, options, retries, delay) {
            try {
                const response = await fetch(url, options);
                if (response.status === 503 && retries > 0) {
                    console.warn(`Bot backend not ready (503). Retrying in ${delay / 1000} seconds...`);
                    saveStatus.textContent = `Bot is starting up... Retrying in ${delay / 1000}s.`;
                    saveStatus.className = 'status-message';
                    await new Promise(res => setTimeout(res, delay));
                    return fetchWithRetry(url, options, retries - 1, delay * 1.5);
                }
                return response;
            } catch (error) {
                console.error(`Fetch error on ${url}:`, error);
                // A network error could also indicate a temporary issue.
                if (retries > 0) {
                    console.warn(`Network error. Retrying in ${delay / 1000} seconds...`);
                    saveStatus.textContent = `Network error. Retrying in ${delay / 1000}s.`;
                    saveStatus.className = 'status-message error';
                    await new Promise(res => setTimeout(res, delay));
                    return fetchWithRetry(url, options, retries - 1, delay * 1.5);
                }
                throw error;
            }
        }

        try {
            // Fetch user info with retry
            const userResponse = await fetchWithRetry('/api/user', {
                headers: { 'Authorization': `Bearer ${discordAccessToken}` }
            }, MAX_RETRIES, INITIAL_DELAY);

            if (!userResponse.ok) {
                if (userResponse.status === 401 || userResponse.status === 403) {
                    localStorage.removeItem('discord_access_token');
                }
                throw new Error(await userResponse.text() || 'Failed to fetch user data');
            }
            const userData = await userResponse.json();
            userDisplayName.textContent = userData.username;

            // Fetch guilds with retry
            const guildsResponse = await fetchWithRetry('/api/guilds', {
                headers: { 'Authorization': `Bearer ${discordAccessToken}` }
            }, MAX_RETRIES, INITIAL_DELAY);
            
            if (!guildsResponse.ok) {
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
                option.textContent = guild.name;
                guildSelect.appendChild(option);
            });
            saveStatus.textContent = ''; // Clear status once loaded

        } catch (error) {
            console.error('Error loading dashboard:', error);
            saveStatus.textContent = `Error loading dashboard: ${error.message}. Please try again.`;
            saveStatus.className = 'status-message error';
            if (!error.message.includes('503')) {
                localStorage.removeItem('discord_access_token');
                showAuthSection();
            }
        }
    }


    // Handle OAuth callback
    const code = getUrlParameter('code');
    if (code) {
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
        selectElement.innerHTML = '<option value="">None</option>';
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

    // Load guild-specific configuration
    async function loadGuildConfig(guildId) {
        configSection.style.display = 'none';
        saveStatus.textContent = 'Loading configuration...';
        saveStatus.className = 'status-message';

        try {
            const configResponse = await fetch(`/api/guild-config?guildId=${guildId}`, {
                headers: { 'Authorization': `Bearer ${discordAccessToken}` }
            });
            if (configResponse.status === 503) {
                 saveStatus.textContent = `Bot is still starting up. Please try again in a moment.`;
                 saveStatus.className = 'status-message';
                 return;
            }

            const configData = await configResponse.json();

            if (configResponse.ok) {
                guildData = configData.guildData;
                const currentConfig = configData.currentConfig;

                selectedGuildName.textContent = guildData.name;

                // Populate role selects, sorted hierarchically
                const sortedRoles = [...guildData.roles].sort((a, b) => b.position - a.position);
                populateSelect(document.getElementById('mod-role-select'), sortedRoles, currentConfig.modRoleId);
                populateSelect(document.getElementById('admin-role-select'), sortedRoles, currentConfig.adminRoleId);
                populateSelect(document.getElementById('mod-ping-role-select'), sortedRoles, currentConfig.modPingRoleId);

                // Populate channel selects, sorted visually
                const textChannels = guildData.channels.filter(c => c.type === 0);
                const sortedChannels = [...textChannels].sort((a, b) => {
                    if (a.parentId === b.parentId) {
                        return a.position - b.position;
                    }
                    if (a.parentId && !b.parentId) return 1;
                    if (!a.parentId && b.parentId) return -1;
                    return a.parentId.localeCompare(b.parentId);
                });
                populateSelect(document.getElementById('mod-log-channel-select'), sortedChannels, currentConfig.moderationLogChannelId);
                populateSelect(document.getElementById('message-log-channel-select'), sortedChannels, currentConfig.messageLogChannelId);
                populateSelect(document.getElementById('mod-alert-channel-select'), sortedChannels, currentConfig.modAlertChannelId);
                populateSelect(document.getElementById('member-log-channel-select'), sortedChannels, currentConfig.memberLogChannelId);
                populateSelect(document.getElementById('admin-log-channel-select'), sortedChannels, currentConfig.adminLogChannelId);
                populateSelect(document.getElementById('join-leave-log-channel-select'), sortedChannels, currentConfig.joinLeaveLogChannelId);
                populateSelect(document.getElementById('boost-log-channel-select'), sortedChannels, currentConfig.boostLogChannelId);
                populateSelect(document.getElementById('karma-channel-select'), sortedChannels, currentConfig.karmaChannelId);
                populateSelect(document.getElementById('counting-channel-select'), sortedChannels, currentConfig.countingChannelId);


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
            memberLogChannelId: document.getElementById('member-log-channel-select').value || null,
            adminLogChannelId: document.getElementById('admin-log-channel-select').value || null,
            joinLeaveLogChannelId: document.getElementById('join-leave-log-channel-select').value || null,
            boostLogChannelId: document.getElementById('boost-log-channel-select').value || null,
            karmaChannelId: document.getElementById('karma-channel-select').value || null,
            countingChannelId: document.getElementById('counting-channel-select').value || null,
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
