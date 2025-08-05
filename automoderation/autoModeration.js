// automoderation/autoModeration.js
const { EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const cooldowns = new Map(); // In-memory map for spam cooldowns

// Load word lists from JSON file
const wordlists = JSON.parse(fs.readFileSync(path.join(__dirname, 'wordlists.json'), 'utf8'));

/**
 * Checks a message against all configured moderation rules and takes action.
 * @param {Message} message - The message object.
 * @param {Client} client - The Discord client.
 * @param {Function} getGuildConfig - Function to get the guild's config.
 * @param {Function} saveGuildConfig - Function to save the guild's config.
 * @param {Function} isExempt - Function to check for user/role immunity.
 * @param {Function} logModerationAction - Function to log moderation actions.
 * @param {Function} logMessage - Function to log general messages.
 */
const checkMessageForModeration = async (message, client, getGuildConfig, saveGuildConfig, isExempt, logModerationAction, logMessage) => {
    // Ignore bots and DMs
    if (message.author.bot || !message.guild) {
        return;
    }

    const guildConfig = await getGuildConfig(message.guild.id);
    const member = message.member;

    // Check for immunity (Admins/Mods are always immune)
    if (isExempt(member, guildConfig)) {
        return;
    }

    const messageContent = message.content.toLowerCase();
    let reason = null;
    let rule = null;

    // --- Check Whitelisted Words (Override) ---
    const whitelist = guildConfig.whitelistedWords ? guildConfig.whitelistedWords.split(',').map(w => w.trim().toLowerCase()) : [];
    if (whitelist.some(w => messageContent.includes(w))) {
        return; // Whitelisted content overrides all other rules.
    }

    // --- Check Blacklisted Words & Tiers ---
    const blacklistedWords = new Set();
    // Add words based on moderation tier
    if (guildConfig.moderationLevel === 'high') {
        wordlists.highLevel.forEach(w => blacklistedWords.add(w));
    } else if (guildConfig.moderationLevel === 'medium') {
        wordlists.mediumLevel.forEach(w => blacklistedWords.add(w));
    } else if (guildConfig.moderationLevel === 'low') {
        wordlists.lowLevel.forEach(w => blacklistedWords.add(w));
    }
    // Add custom blacklisted words from config
    if (guildConfig.blacklistedWords) {
        guildConfig.blacklistedWords.split(',').map(w => w.trim().toLowerCase()).forEach(w => blacklistedWords.add(w));
    }

    for (const word of blacklistedWords) {
        if (messageContent.includes(word)) {
            reason = `Blacklisted word "${word}" used.`;
            rule = 'Blacklisted Words';
            break;
        }
    }

    // --- Check Repeated Text ---
    if (!reason && guildConfig.repeatedTextEnabled) {
        const lastMessage = await message.channel.messages.fetch({ limit: 2 }).then(msgs => msgs.last()).catch(() => null);
        if (lastMessage && lastMessage.author.id === message.author.id && lastMessage.content === message.content) {
            reason = 'Repeated text.';
            rule = 'Repeated Text';
        }
    }

    // --- Check External Links ---
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    if (!reason && guildConfig.externalLinksEnabled && messageContent.match(urlRegex)) {
        reason = 'External link posted.';
        rule = 'External Links';
    }

    // --- Check Discord Invite Links ---
    const inviteRegex = /(discord\.gg\/|discordapp\.com\/invite\/)/g;
    if (!reason && guildConfig.discordInviteLinksEnabled && messageContent.match(inviteRegex)) {
        reason = 'Discord invite link posted.';
        rule = 'Discord Invites';
    }

    // --- Check Excessive Emojis ---
    if (!reason && guildConfig.excessiveEmojiEnabled) {
        const emojiCount = (message.content.match(/(<a?:[a-zA-Z0-9_]+:\d+>|[\u00A9\u00AE\u2000-\u3300\uD83C-\uDBFF\uDC00-\uDFFF])/g) || []).length;
        if (emojiCount > (guildConfig.excessiveEmojiCount || 5)) {
            reason = `Excessive emojis (${emojiCount}/${guildConfig.excessiveEmojiCount}).`;
            rule = 'Excessive Emojis';
        }
    }
    
    // --- Check Excessive Mentions ---
    if (!reason && guildConfig.excessiveMentionsEnabled && message.mentions.users.size + message.mentions.roles.size > (guildConfig.excessiveMentionsCount || 5)) {
        reason = `Excessive mentions (${message.mentions.users.size + message.mentions.roles.size}/${guildConfig.excessiveMentionsCount}).`;
        rule = 'Excessive Mentions';
    }

    // --- Check Excessive Caps ---
    if (!reason && guildConfig.excessiveCapsEnabled) {
        const capsPercentage = (message.content.replace(/[^a-zA-Z]/g, '').match(/[A-Z]/g) || []).length / message.content.replace(/[^a-zA-Z]/g, '').length * 100;
        if (capsPercentage > (guildConfig.excessiveCapsPercentage || 70)) {
            reason = `Excessive caps (${capsPercentage.toFixed(0)}%/${guildConfig.excessiveCapsPercentage}%).`;
            rule = 'Excessive Caps';
        }
    }

    // --- Spam Detection ---
    if (!reason && guildConfig.spamDetectionEnabled) {
        const now = Date.now();
        const userCooldown = cooldowns.get(message.author.id) || { messages: [], lastTimeout: 0, timeouts: [] };
        
        // Filter out old messages
        userCooldown.messages = userCooldown.messages.filter(time => now - time < (guildConfig.timeframeSeconds * 1000 || 5000));
        userCooldown.messages.push(now);

        if (userCooldown.messages.length > (guildConfig.maxMessages || 5)) {
            reason = `Spamming detected (${userCooldown.messages.length} messages in ${guildConfig.timeframeSeconds || 5}s).`;
            rule = 'Spam Detection';
            // Reset message counter after a penalty
            userCooldown.messages = [];
        }

        cooldowns.set(message.author.id, userCooldown);
    }
    
    // --- Apply Moderation Action if a rule was triggered ---
    if (reason) {
        try {
            await message.delete();
            
            // Get or create user moderation data in Firestore
            const modRef = client.db.collection(`artifacts/${client.appId}/public/data/guilds/${message.guild.id}/mod_data`).doc(message.author.id);
            const modSnap = await modRef.get();
            const modData = modSnap.exists ? modSnap.data() : { warnings: [], timeouts: [] };

            // Add new warning
            const warningTimestamp = Date.now();
            modData.warnings.push({ timestamp: warningTimestamp, rule, reason, messageContent: message.content });

            // Check for 3 warnings in the last hour
            const recentWarnings = modData.warnings.filter(w => warningTimestamp - w.timestamp < 3600000); // 1 hour
            if (recentWarnings.length >= 3) {
                // Time out the user for 6 hours
                const timeoutUntil = new Date(Date.now() + 6 * 3600000); // 6 hours
                await member.timeout(6 * 3600000, `Automoderation: 3 warnings in 1 hour.`);
                modData.timeouts.push({ timestamp: warningTimestamp, duration: '6 hours' });
                logModerationAction('Timeout', message.guild, message.author, client.user, `Timed out for 6 hours for 3 warnings in 1 hour.`, reason);
                modData.warnings = []; // Clear warnings after timeout
            } else {
                logModerationAction('Warning', message.guild, message.author, client.user, reason);
            }

            // Check for 5 timeouts in the last month
            const recentTimeouts = modData.timeouts.filter(t => warningTimestamp - t.timestamp < 2592000000); // 1 month
            if (recentTimeouts.length >= 5) {
                // Time out for 7 days and alert mods
                const timeoutUntil = new Date(Date.now() + 7 * 24 * 3600000); // 7 days
                await member.timeout(7 * 24 * 3600000, `Automoderation: 5 timeouts in 1 month.`);
                logModerationAction('Timeout', message.guild, message.author, client.user, `Timed out for 7 days for 5 timeouts in 1 month.`, reason);
                modData.timeouts = []; // Clear timeouts after 7-day penalty
                
                // Send alert to mod channel
                if (guildConfig.modAlertChannelId) {
                    const modAlertChannel = message.guild.channels.cache.get(guildConfig.modAlertChannelId);
                    if (modAlertChannel) {
                         const alertEmbed = new EmbedBuilder()
                            .setColor('#FF0000')
                            .setTitle('Severe Moderation Alert')
                            .setDescription(`User ${message.author.tag} (<@${message.author.id}>) has been timed out for 7 days after receiving 5 timeouts in one month.`)
                            .setTimestamp();
                        modAlertChannel.send({ embeds: [alertEmbed] });
                    }
                }
            }

            // Save updated moderation data to Firestore
            await modRef.set(modData, { merge: true });

        } catch (error) {
            console.error(`Failed to moderate message from ${message.author.tag}:`, error);
        }
    }
};

module.exports = {
    checkMessageForModeration
};

