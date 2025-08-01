// events/messageReactionAdd.js
const { EmbedBuilder } = require('discord.js');

/**
 * Handles the messageReactionAdd event for emoji-based moderation and karma tracking.
 * @param {MessageReaction} reaction - The reaction object.
 * @param {User} user - The user who added the reaction.
 * @param {Client} client - The Discord client instance.
 * @param {function} getGuildConfig - Function to retrieve guild config.
 * @param {function} saveGuildConfig - Function to save guild config.
 * @param {function} hasPermission - Function to check user permissions.
 * @param {function} isExempt - Function to check if a user is exempt.
 * @param {function} logModerationAction - Function to log moderation actions.
 * @param {function} logMessage - Function to log deleted messages.
 * @param {object} karmaSystem - Object containing karma system helper functions.
 */
module.exports = async (reaction, user, client, getGuildConfig, saveGuildConfig, hasPermission, isExempt, logModerationAction, logMessage, karmaSystem) => {
    // IMMEDIATE CHECK: If user is null or doesn't have an ID, something is wrong.
    if (!user || !user.id) {
        console.error('messageReactionAdd event received with null or invalid user object:', user);
        return;
    }

    // Ignore bot reactions or DMs
    if (user.bot || !reaction.message.guild) return;

    // When a reaction is received, check if the structure is partial
    if (reaction.partial) {
        try {
            await reaction.fetch();
        } catch (error) {
            console.error('Something went wrong when fetching the message:', error);
            return;
        }
    }

    const message = reaction.message;
    const guild = message.guild;
    const reactorMember = await guild.members.fetch(user.id);
    const guildConfig = await getGuildConfig(guild.id);

    // --- Moderation Emojis Handling ---
    // Check if the reactor has permission for moderation/flagging or karma reactions
    if (hasPermission(reactorMember, guildConfig)) {
        const targetUser = message.author; // The author of the message being reacted to
        const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

        if (!targetMember) {
            console.log(`Could not fetch target member ${targetUser.id}.`);
            reaction.users.remove(user.id).catch(console.error); // Remove reaction if target user is unresolvable
            return;
        }

        // Check if the target user is exempt from moderation actions (warn, timeout, kick)
        const isTargetExempt = isExempt(targetMember, guildConfig);

        // Safely get channel ID and name for reason
        let channelIdForReason = 'Unknown Channel ID';
        let channelNameForReason = 'Unknown Channel';
        if (message.channel) {
            let resolvedChannelForReason = message.channel;
            if (resolvedChannelForReason.partial) {
                try {
                    resolvedChannelForReason = await resolvedChannelForReason.fetch();
                } catch (err) {
                    console.warn(`Could not fetch partial channel for message ${message.id} in reason construction:`, err);
                    resolvedChannelForReason = null;
                }
            }
            if (resolvedChannelForReason) {
                channelIdForReason = resolvedChannelForReason.id;
                channelNameForReason = resolvedChannelForReason.name;
            }
        }
        const reasonContent = `Emoji moderation: "${message.content || 'No message content'}" from channel <#${channelIdForReason}> (${channelNameForReason})`;
        const messageLink = message.url;
        let actionTaken = false;

        // Handle Karma reactions (👍, 👎) from moderators/admins
        if (['👍', '👎'].includes(reaction.emoji.name)) {
            let karmaChange = 0;
            let actionText = '';

            if (reaction.emoji.name === '👍') {
                karmaChange = 1;
                actionText = '+1 Karma';
            } else { // 👎
                karmaChange = -1;
                actionText = '-1 Karma';
            }

            try {
                // No isExempt check for karma target as per new requirement: all users can receive karma
                const newKarma = await karmaSystem.addKarmaPoints(guild.id, targetUser, karmaChange, client.db, client.appId);
                // Send announcement to Karma Channel
                await karmaSystem.sendKarmaAnnouncement(guild, targetUser.id, karmaChange, newKarma, client);
            } catch (error) {
                console.error(`Error adjusting karma for ${targetUser.tag} via emoji:`, error);
                message.channel.send(`Failed to adjust Karma for <@${targetUser.id}>. An error occurred.`).catch(console.error);
            } finally {
                // Always remove the reaction after processing
                reaction.users.remove(user.id).catch(e => console.error(`Failed to remove karma emoji reaction:`, e));
            }
            return; // Stop processing this reaction, it's handled
        }

        // Handle manual flagging (🔗)
        if (reaction.emoji.name === '🔗') {
            if (guildConfig.modAlertChannelId && guildConfig.modPingRoleId) {
                const sendModAlert = require('../automoderation/autoModeration').sendModAlert;
                await sendModAlert(guild, message, `Manually flagged by ${reactorMember.tag}`, reactorMember.user, messageLink, guildConfig.modPingRoleId, getGuildConfig);
                console.log(`Message from ${targetMember.tag} manually flagged by ${reactorMember.tag}.`);
                actionTaken = true;
            } else {
                console.log(`Mod alert channel or ping role not set for guild ${guild.name}. Cannot send manual flag alert.`);
            }
        } else if (!isTargetExempt) { // Proceed with moderation actions only if target is not exempt
            guildConfig.caseNumber++;
            await saveGuildConfig(guild.id, guildConfig);
            const caseNumber = guildConfig.caseNumber;

            switch (reaction.emoji.name) {
                case '⚠️': // Warning emoji
                    try {
                        const warnCommand = client.commands.get('warn');
                        if (warnCommand) {
                            await warnCommand.executeEmoji(message, targetMember, reasonContent, reactorMember, caseNumber, { logModerationAction, logMessage, getGuildConfig, db: client.db, appId: client.appId });
                            actionTaken = true;
                        }
                    } catch (error) {
                        console.error('Error during emoji warn:', error);
                    }
                    break;
                case '⏰': // Alarm clock emoji (default timeout 1 hour)
                    try {
                        const timeoutCommand = client.commands.get('timeout');
                        if (timeoutCommand) {
                            const duration = '1h';
                            await timeoutCommand.executeEmoji(message, targetMember, 60, reasonContent, reactorMember, caseNumber, { logModerationAction, logMessage, duration, getGuildConfig, db: client.db, appId: client.appId });
                            actionTaken = true;
                        }
                    } catch (error) {
                        console.error('Error during emoji timeout:', error);
                    }
                    break;
                case '👢': // Boot emoji (kick)
                    try {
                        const kickCommand = client.commands.get('kick');
                        if (kickCommand) {
                            await kickCommand.executeEmoji(message, targetMember, reasonContent, reactorMember, caseNumber, { logModerationAction, logMessage, getGuildConfig, db: client.db, appId: client.appId });
                            actionTaken = true;
                        }
                    } catch (error) {
                        console.error('Error during emoji kick:', error);
                    }
                    break;
            }
        }

        // If a moderation action was taken, remove the reaction FIRST, then delete message (if applicable)
        if (actionTaken) {
            try {
                // Always remove the user's reaction first
                await reaction.users.remove(user.id).catch(error => {
                    if (error.code === 10008) {
                        console.warn(`DiscordAPIError[10008]: Cannot remove reaction from unknown message ${message.id}. Message likely already deleted.`);
                    } else {
                        console.error(`Failed to remove reaction from message ${message.id}:`, error);
                    }
                });

                // Then delete the original message if it was a moderation action (warn, timeout, kick)
                if (['⚠️', '⏰', '👢'].includes(reaction.emoji.name) && message.deletable) {
                    await message.delete().catch(error => {
                        if (error.code === 10008) {
                            console.warn(`DiscordAPIError[10008]: Cannot delete unknown message ${message.id}. Message likely already deleted.`);
                        } else {
                            console.error(`Failed to delete message ${message.id}:`, error);
                        }
                    });
                    console.log(`Message deleted after emoji moderation: ${message.id}`);
                    await logMessage(guild, message, user, 'Deleted (Emoji Mod)', getGuildConfig);
                }
            } catch (error) {
                console.error(`An unexpected error occurred during post-moderation cleanup for message ${message.id}:`, error);
            }
        }
    }

    // --- Karma System Reactions Handling (for passive karma, not mod-triggered) ---
    // Ignore if it's one of the moderation or mod-triggered karma emojis, as they are handled above
    if (['⚠️', '⏰', '👢', '🔗', '👍', '👎'].includes(reaction.emoji.name)) return;

    // Ignore reactions from the message author themselves for passive karma
    if (reaction.message.author.id === user.id) return;

    const originalAuthor = message.author;
    try {
        const originalAuthorKarmaData = await karmaSystem.getOrCreateUserKarma(guild.id, originalAuthor.id, client.db, client.appId);
        await karmaSystem.updateUserKarmaData(guild.id, originalAuthor.id, {
            reactionsReceivedToday: (originalAuthorKarmaData.reactionsReceivedToday || 0) + 1,
            lastActivityDate: new Date()
        }, client.db, client.appId);
        await karmaSystem.calculateAndAwardKarma(guild, originalAuthor, { ...originalAuthorKarmaData, reactionsReceivedToday: (originalAuthorKarmaData.reactionsReceivedToday || 0) + 1 }, client.db, client.appId, client.googleApiKey);
    } catch (error) {
        console.error(`Error in messageReactionAdd karma tracking for ${originalAuthor.tag}:`, error);
    }
};
