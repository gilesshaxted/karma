// games/countingGame.js
const { PermissionsBitField } = require('discord.js');

const VERIFY_EMOJI_ID = '1196558213726863491'; // ID of <a:verifyanimated:1196558213726863491>

/**
 * Checks a message in the counting channel to see if it's the correct next number.
 * @param {Message} message - The message sent in the counting channel.
 * @param {Client} client - The Discord client instance.
 * @param {function} getGuildConfig - Function to retrieve guild config.
 * @param {function} saveGuildConfig - Function to save guild config.
 * @param {function} isExempt - Function to check if a user is exempt from moderation.
 * @param {function} logMessage - Function to log deleted messages.
 * @returns {Promise<boolean>} - True if the message was handled by the counting game, false otherwise.
 */
const checkCountMessage = async (message, client, getGuildConfig, saveGuildConfig, isExempt, logMessage) => {
    const guild = message.guild;
    const guildConfig = await getGuildConfig(guild.id);

    // Ensure counting channel is set and message is in that channel
    if (!guildConfig.countingChannelId || message.channel.id !== guildConfig.countingChannelId) {
        return false; // Not the counting channel
    }

    const expectedNumber = guildConfig.currentCount + 1;
    const receivedNumber = parseInt(message.content);

    // Check if the author is exempt (mods/admins should not be timed out by the game)
    const authorMember = await guild.members.fetch(message.author.id).catch(() => null);
    const authorIsExempt = authorMember ? isExempt(authorMember, guildConfig) : false;

    if (receivedNumber === expectedNumber) {
        // Correct number!
        try {
            // Remove reaction from previous message if it exists
            if (guildConfig.lastCountMessageId) {
                try {
                    const lastMessage = await message.channel.messages.fetch(guildConfig.lastCountMessageId);
                    const botReaction = lastMessage.reactions.cache.get(VERIFY_EMOJI_ID);
                    if (botReaction && botReaction.me) {
                        await botReaction.users.remove(client.user.id);
                    }
                } catch (error) {
                    // Log error but don't stop the current count
                    console.warn(`Failed to remove reaction from previous counting message ${guildConfig.lastCountMessageId}:`, error);
                }
            }

            // Add reaction to current message
            await message.react(`<a:verifyanimated:${VERIFY_EMOJI_ID}>`).catch(console.error);

            // Update count and last message ID in Firestore
            guildConfig.currentCount = expectedNumber;
            guildConfig.lastCountMessageId = message.id;
            await saveGuildConfig(guild.id, guildConfig);

            return true; // Message was handled
        } catch (error) {
            console.error(`Error processing correct count message ${message.id}:`, error);
            // If an error occurs, still try to update count to avoid getting stuck
            guildConfig.currentCount = expectedNumber;
            guildConfig.lastCountMessageId = message.id;
            await saveGuildConfig(guild.id, guildConfig);
            return true;
        }

    } else {
        // Incorrect number!
        const responseMessage = `Oh No Karma got you, that was wrong! The next number was ${expectedNumber}.`;
        try {
            await message.channel.send(responseMessage).catch(console.error);

            // Delete the incorrect message
            if (message.deletable) {
                await message.delete().catch(console.error);
                // Log the deleted message
                await logMessage(guild, message, client.user, 'Counting Game Fail', client.getGuildConfig);
            }

            // Timeout the user if they are not exempt
            if (authorMember && authorMember.manageable && !authorIsExempt) {
                await authorMember.timeout(60 * 1000, 'Incorrect number in counting game (60 seconds)').catch(console.error); // 60 seconds timeout
            } else if (authorIsExempt) {
                console.log(`Skipping timeout for exempt user ${message.author.tag} in counting game.`);
            } else {
                console.warn(`Could not timeout user ${message.author.tag} in counting game (not manageable).`);
            }

            // Reset count if incorrect (optional, but common for counting games)
            guildConfig.currentCount = 0; // Reset to 0 on incorrect count
            guildConfig.lastCountMessageId = null; // Clear last message ID
            await saveGuildConfig(guild.id, guildConfig);

            return true; // Message was handled
        } catch (error) {
            console.error(`Error processing incorrect count message ${message.id}:`, error);
            // Even if error, try to reset count to prevent game from getting stuck
            guildConfig.currentCount = 0;
            guildConfig.lastCountMessageId = null;
            await saveGuildConfig(guild.id, guildConfig);
            return true;
        }
    }
};

module.exports = {
    checkCountMessage
};
