// events/meow.js
const axios = require('axios');
const { EmbedBuilder } = require('discord.js');

/**
 * Handles messages containing "meow" and replies with a random cat image.
 * @param {Message} message - The message object.
 * @param {string} catApiKey - The API key for TheCatAPI.
 * @param {Function} getGuildConfig - Function to get guild configuration.
 * @param {Function} logMessage - Function to log general messages.
 * @param {Client} client - The Discord client instance.
 * @returns {Promise<boolean>} - Returns true if the message was handled, false otherwise.
 */
const handleMeow = async (message, catApiKey, getGuildConfig, logMessage, client) => {
    // Ignore bot messages and DMs
    if (message.author.bot || !message.guild) {
        return false;
    }

    const guildConfig = await getGuildConfig(message.guild.id);

    // Check if Meow Fun is enabled for this guild
    if (!guildConfig.meowFunEnabled) {
        return false; // Feature is disabled
    }

    // --- Define multiple trigger words ---
    const triggerWords = ['meow', 'cat', 'kitty', 'puss'];
    const messageContent = message.content.toLowerCase();

    // Check if the message content includes ANY of the trigger words
    const isTriggered = triggerWords.some(word => messageContent.includes(word));

    if (isTriggered) {
        console.log(`[MEOW FUN] A trigger word detected from ${message.author.tag} in #${message.channel.name}.`);
        await logMessage(message, client, `A trigger word detected from ${message.author.tag} in #${message.channel.name}.`); // Log detection

        try {
            const response = await axios.get('https://api.thecatapi.com/v1/images/search?', {
                headers: { 'x-api-key': catApiKey }
            });

            // The Cat API returns an array, we access the URL of the first element
            const imageUrl = response.data[0]?.url;

            if (imageUrl) {
                const embed = new EmbedBuilder()
                    .setTitle('Meow! 🐱')
                    .setDescription('Here is a magnificent feline just for you.')
                    .setImage(imageUrl)
                    .setColor('#FFC107') // Gold color from your theme
                    .setFooter({ text: 'Powered by TheCatAPI' })
                    .setTimestamp();

                await message.channel.send({ embeds: [embed] }).catch(console.error);
                console.log(`[MEOW FUN] Sent cat image to #${message.channel.name}: ${imageUrl}`);
                await logMessage(message, client, `Sent cat image to #${message.channel.name}: ${imageUrl}`); // Log successful send
                return true; // Return true as the message was handled
            } else {
                console.warn('[MEOW FUN] TheCatAPI did not return an image URL.');
                await logMessage(message, client, 'TheCatAPI did not return an image URL.'); // Log API failure
            }
        } catch (error) {
            console.error('[MEOW FUN] Error fetching cat image from TheCatAPI:', error.response ? error.response.data : error.message);
            await logMessage(message, client, `Error fetching cat image from TheCatAPI: ${error.message}`); // Log API error
        }
    }

    return false; // Return false if no trigger word was detected or an error occurred
};

module.exports = {
    handleMeow
};
