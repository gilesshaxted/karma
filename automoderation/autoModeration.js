// automoderation/autoModeration.js
const { EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
// Removed direct Firestore imports as karmaSystem will handle them
// const { collection, doc, getDoc, setDoc } = require('firebase/firestore'); 
const cooldowns = new Map(); // In-memory map for spam cooldowns

// Load word lists from JSON file
const wordlists = JSON.parse(fs.readFileSync(path.join(__dirname, 'wordlists.json'), 'utf8'));

// Define regex patterns for common sensitive words to catch variations
// These patterns account for spaces, common leet speak (i, l, 1; a, @, 4; e, 3; o, 0; s, 5), and repeated characters.
const sensitiveWordRegex = {
    // Example: "fuck" with variations
    fuck: /(f[\s\.]*[uUu*][\s\.]*c[\s\.]*k)/i,
    // Example: "shit" with variations
    shit: /(s[\s\.]*h[\s\.]*i[\s\.]*t)/i,
    // Example: "bitch" with variations
    bitch: /(b[\s\.]*i[\s\.]*t[\s\.]*c[\s\.]*h)/i,
    // Example: "nigger" with variations (using non-capturing groups and character classes)
    nigger: /(n[\s\.]*[iI1!][\s\.]*g[\s\.]*[gG6][\s\.]*[eE3@a][\s\.]*r?)/i,
    // Example: "faggot" with variations
    faggot: /(f[\s\.]*[aA@4][\s\.]*g[\s\.]*[gG6][\s\.]*[oO0][\s\.]*t)/i,
    // Example: "cunt" with variations
    cunt: /(c[\s\.]*[uU*][\s\.]*n[\s\.]*t)/i,
    // Add more sensitive words with their regex patterns as needed
};


/**
 * Checks a message against all configured moderation rules and takes action.
 * @param {Message} message - The message object.
 * @param {Client} client - The Discord client.
 * @param {Function} getGuildConfig - Function to get the guild's config.
 * @param {Function} saveGuildConfig - Function to save the guild's config.
 * @param {Function} isExempt - Function to check for user/role immunity.
 * @param {Function} logModerationAction - Function to log moderation actions.
 * @param {Function} logMessage - Function to log general messages.
 * @param {Object} karmaSystem - The karmaSystem module for managing user data.
 */
const checkMessageForModeration = async (message, client, getGuildConfig, saveGuildConfig, isExempt, logModerationAction, logMessage, karmaSystem) => {
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

    // --- Check Blacklisted Words & Tiers (now using regex for sensitive words) ---
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

    // First, check against specific sensitive words using regex based on moderation level
    for (const key in sensitiveWordRegex) {
        if (sensitiveWordRegex.hasOwnProperty(key)) {
            const regex = sensitiveWordRegex[key];
            let shouldCheck = false;

            // Determine if this regex should be applied based on moderationLevel
            if (key === 'nigger' || key === 'faggot') { // All tiers
                shouldCheck = true;
            } else if (key === 'cunt' || key === 'bitch') { // Medium and High tiers
                if (guildConfig.moderationLevel === 'medium' || guildConfig.moderationLevel === 'high') {
                    shouldCheck = true;
                }
            } else if (key === 'shit' || key === 'fuck') { // Only High tier
                if (guildConfig.moderationLevel === 'high') {
                    shouldCheck = true;
                }
            }
            // Add more conditions for other sensitive words if needed

            if (shouldCheck && messageContent.match(regex)) {
                reason = `Sensitive word variation detected: "${message.content.substring(messageContent.match(regex).index, messageContent.match(regex).index + messageContent.match(regex)[0].length)}".`;
                rule = `Sensitive Word Detection (${key} - Regex)`;
                break;
            }
        }
    }

    // If no sensitive regex match, then check general blacklisted words
    if (!reason) {
        for (const word of blacklistedWords) {
            // For general blacklisted words, we can still use simple includes or more generic regex if needed
            if (messageContent.includes(word)) {
                reason = `Blacklisted word "${word}" used.`;
                rule = 'Blacklisted Words';
                break;
            }
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
        const letters = message.content.replace(/[^a-zA-Z]/g, '');
        if (letters.length > 0) { // Avoid division by zero for messages without letters
            const capsPercentage = (letters.match(/[A-Z]/g) || []).length / letters.length * 100;
            if (capsPercentage > (guildConfig.excessiveCapsPercentage || 70)) {
                reason = `Excessive caps (${capsPercentage.toFixed(0)}%/${guildConfig.excessiveCapsPercentage}%).`;
                rule = 'Excessive Caps';
            }
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
            // Reset message counter after a penalty (this is for the in-memory cooldown, not Firestore data)
            userCooldown.messages = [];
        }

        cooldowns.set(message.author.id, userCooldown);
    }
    
    // --- Apply Moderation Action if a rule was triggered ---
    if (reason) {
        console.log(`[AUTOMOD] Rule triggered for ${message.author.tag} in ${message.guild.name}: ${reason}`); // Added for debugging
        try {
            // FIX: Add specific error handling for Unknown Message
            await message.delete().catch(err => {
                if (err.code === 10008) { // DiscordAPIError[10008]: Unknown Message
                    console.warn(`[AUTOMOD WARNING] Message from ${message.author.tag} already deleted or unknown. Skipping deletion.`);
                } else {
                    console.error(`[AUTOMOD ERROR] Failed to delete message from ${message.author.tag}:`, err);
                }
            });
            
            // Get user moderation data using karmaSystem
            const modData = await karmaSystem.getOrCreateUserKarma(message.guild.id, message.author.id, client.db, client.appId);

            // Log the action and get the case number
            // FIX: Pass client object directly to logModerationAction
            const caseNumber = await logModerationAction('Warning', message.guild, message.author, client.user, reason, client); 

            // Add new warning to modData with caseNumber
            const warningTimestamp = Date.now();
            const newWarning = { timestamp: warningTimestamp, rule, reason, messageContent: message.content, caseNumber: caseNumber }; // Include caseNumber
            modData.warnings.push(newWarning);
            await karmaSystem.updateUserKarmaData(message.guild.id, message.author.id, { warnings: modData.warnings }, client.db, client.appId);

            console.log(`[AUTOMOD DEBUG] ${message.author.tag} warnings count: ${modData.warnings.length}`); // DEBUG

            // Check for 3 warnings in the last hour
            const recentWarnings = modData.warnings.filter(w => warningTimestamp - w.timestamp < 3600000); // 1 hour
            console.log(`[AUTOMOD DEBUG] ${message.author.tag} recent warnings count (last hour): ${recentWarnings.length}`); // DEBUG

            if (recentWarnings.length >= 3) {
                console.log(`[AUTOMOD] ${message.author.tag} reached 3 warnings. Applying 6-hour timeout.`); // Added for debugging
                // Time out the user for 6 hours
                const timeoutDuration = 6 * 3600000; // 6 hours
                try {
                    await member.timeout(timeoutDuration, `Automoderation: 3 warnings in 1 hour.`).catch(err => {
                        console.error(`[AUTOMOD ERROR] Failed to timeout member ${member.user.tag}:`, err);
                        // Attempt to send a message to the channel if timeout fails
                        message.channel.send(`Failed to timeout <@${member.user.id}>. Please check bot permissions.`).catch(console.error);
                    });
                    const newTimeout = { timestamp: warningTimestamp, duration: '6 hours', caseNumber: caseNumber }; // Include caseNumber
                    modData.timeouts.push(newTimeout);
                    // Clear warnings after timeout to reset the 3-warning count for the next cycle
                    modData.warnings = []; 
                    await karmaSystem.updateUserKarmaData(message.guild.id, message.author.id, { timeouts: modData.timeouts, warnings: modData.warnings }, client.db, client.appId);

                    // Notify user about timeout
                    await message.author.send(`You have been timed out in **${message.guild.name}** for 6 hours due to repeated rule violations. Reason: ${reason}`).catch(console.error);
                    // Log the timeout action
                    logModerationAction('Timeout', message.guild, message.author, client.user, `Timed out for 6 hours for 3 warnings in 1 hour.`, reason, client); 

                } catch (timeoutError) {
                    console.error(`[AUTOMOD ERROR] Error during member timeout for ${member.user.tag}:`, timeoutError);
                }
            } else {
                console.log(`[AUTOMOD] ${message.author.tag} received a warning.`); // Added for debugging
                // Notify user about warning
                await message.author.send(`You received a warning in **${message.guild.name}**. Reason: ${reason}`).catch(console.error);
            }

            // Check for 5 timeouts in the last month
            const recentTimeouts = modData.timeouts.filter(t => warningTimestamp - t.timestamp < 2592000000); // 1 month
            console.log(`[AUTOMOD DEBUG] ${message.author.tag} timeouts count: ${modData.timeouts.length}`); // DEBUG
            console.log(`[AUTOMOD DEBUG] ${message.author.tag} recent timeouts count (last month): ${recentTimeouts.length}`); // DEBUG

            if (recentTimeouts.length >= 5) {
                console.log(`[AUTOMOD] ${message.author.tag} reached 5 timeouts. Applying 7-day severe timeout.`); // Added for debugging
                // Time out for 7 days and alert mods
                const severeTimeoutDuration = 7 * 24 * 3600000; // 7 days
                try {
                    await member.timeout(severeTimeoutDuration, `Automoderation: 5 timeouts in 1 month.`).catch(err => {
                        console.error(`[AUTOMOD ERROR] Failed to apply severe timeout to member ${member.user.tag}:`, err);
                        message.channel.send(`Failed to apply severe timeout to <@${member.user.id}>. Please check bot permissions.`).catch(console.error);
                    });
                    // Clear timeouts after 7-day penalty to reset the 5-timeout count for the next cycle
                    modData.timeouts = []; 
                    await karmaSystem.updateUserKarmaData(message.guild.id, message.author.id, { timeouts: modData.timeouts }, client.db, client.appId);

                    // Notify user about severe timeout
                    await message.author.send(`You have been timed out in **${message.guild.name}** for 7 days due to severe repeated rule violations. Reason: ${reason}`).catch(console.error);
                    // Log the severe timeout action
                    logModerationAction('Timeout', message.guild, message.author, client.user, `Timed out for 7 days for 5 timeouts in 1 month.`, reason, client); 
                    
                    // Send alert to mod channel
                    if (guildConfig.modAlertChannelId) {
                        const modAlertChannel = message.guild.channels.cache.get(guildConfig.modAlertChannelId);
                        if (modAlertChannel) {
                               const alertEmbed = new EmbedBuilder()
                                .setColor('#FF0000')
                                .setTitle('Severe Moderation Alert')
                                .setDescription(`User ${message.author.tag} (<@${message.author.id}>) has been timed out for 7 days after receiving 5 timeouts in one month.`)
                                .setTimestamp();
                            modAlertChannel.send({ embeds: [alertEmbed] }).catch(console.error);
                        }
                    }
                } catch (severeTimeoutError) {
                    console.error(`[AUTOMOD ERROR] Error during severe member timeout for ${member.user.tag}:`, severeTimeoutError);
                }
            }

            // Save updated moderation data to Firestore (already done by updateUserKarmaData for warnings/timeouts)
            // await setDoc(modRef, modData, { merge: true }).catch(err => console.error(`[AUTOMOD ERROR] Failed to save moderation data for ${message.author.tag} to Firestore:`, err));

        } catch (error) {
            console.error(`[AUTOMOD ERROR] Failed to process automoderation for message from ${message.author.tag}:`, error);
        }
    }
};

module.exports = {
    checkMessageForModeration
};
