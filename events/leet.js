// events/leet.js
const axios = require('axios');
const { EmbedBuilder } = require('discord.js');

/**
 * Handles messages and potentially replies with a Leet Speak translation.
 * There is a 5% chance for the bot to respond.
 * @param {Message} message - The message object.
 * @param {string} leetApiUserId - The user ID for the Leet Speak API.
 * @param {Function} getGuildConfig - Function to get guild configuration.
 * @param {Function} logMessage - Function to log general messages.
 * @param {Client} client - The Discord client instance.
 * @returns {Promise<boolean>} - Returns true if the message was handled (bot responded), false otherwise.
 */
const handleLeet = async (message, leetApiUserId, getGuildConfig, logMessage, client) => {
    // Ignore bot messages and DMs
    if (message.author.bot || !message.guild) {
        return false;
    }

    // Check for a 5% chance to respond
    const randomChance = Math.random(); // Generates a number between 0 (inclusive) and 1 (exclusive)
    const LEET_RESPONSE_CHANCE = 1.00; // 5% chance
    if (randomChance > LEET_RESPONSE_CHANCE) {
        return false; // Not within the 5% chance, so don't respond
    }

    const guildConfig = await getGuildConfig(message.guild.id);

    // Check if Leet Fun is enabled for this guild
    if (!guildConfig.leetFunEnabled) { // This setting needs to be added to your guild config
        return false; // Feature is disabled
    }

    // Only respond if the message content is not empty
    if (message.content.trim().length === 0) {
        return false;
    }

    console.log(`[LEET FUN] Leet response triggered for ${message.author.tag} in #${message.channel.name}.`);
    await logMessage(message, client, `Leet response triggered for ${message.author.tag} in #${message.channel.name}.`); // Log detection

    try {
        const encodedText = encodeURIComponent(message.content);
        const leetApiUrl = `https://genr8rs.com/api/Content/Fun/LeetSpeakGenerator?genr8rsUserId=${leetApiUserId}&_sText=${encodedText}&_sCharacterSet=ultra`;

        const response = await axios.get(leetApiUrl);
        const leetText = response.data; // The API returns the translated text directly

        if (leetText) {
            const embed = new EmbedBuilder()
                .setTitle('1337 5p34k! 🤖') // Leet Speak title
                .setDescription(`\`\`\`\n${leetText}\n\`\`\``) // Display translated text in a code block
                .setColor('#00FF00') // A bright green color might fit Leet Speak
                .setFooter({ text: 'Translated by Genr8rs.com Leet Speak API' })
                .setTimestamp();

            await message.channel.send({ embeds: [embed] }).catch(console.error);
            console.log(`[LEET FUN] Sent Leet Speak response to #${message.channel.name}: ${leetText}`);
            await logMessage(message, client, `Sent Leet Speak response to #${message.channel.name}: ${leetText}`); // Log successful send
            return true; // Message was handled
        } else {
            console.warn('[LEET FUN] Leet Speak API did not return a translation.');
            await logMessage(message, client, 'Leet Speak API did not return a translation.'); // Log API failure
        }
    } catch (error) {
        console.error('[LEET FUN] Error fetching Leet Speak translation:', error.response ? error.response.data : error.message);
        await logMessage(message, client, `Error fetching Leet Speak translation: ${error.message}`); // Log API error
    }

    return false; // Message not handled (e.g., API error, empty message)
};

module.exports = {
    handleLeet
};
