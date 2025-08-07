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
 */
const handleMeow = async (message, catApiKey, getGuildConfig, logMessage, client) => {
    // Ignore bot messages and DMs
    if (message.author.bot || !message.guild) {
        return;
    }

    const guildConfig = await getGuildConfig(message.guild.id);

    // Check if Meow Fun is enabled for this guild
    if (!guildConfig.meowFunEnabled) {
        return; // Feature is disabled
    }

    // Check if the message content contains "meow" (case-insensitive)
    if (message.content.toLowerCase().includes('meow')) { // Changed from === to .includes()
        console.log(`[MEOW FUN] 'meow' detected from ${message.author.tag} in #${message.channel.name}.`);
        await logMessage(message, client, `'meow' detected from ${message.author.tag} in #${message.channel.name}.`); // Log detection

        try {
            const response = await axios.get('https://api.thecatapi.com/v1/images/search?', {
                headers: { 'x-api-key': catApiKey }
            });

            const imageUrl = response.data[0]?.url;

            if (imageUrl) {
                const embed = new EmbedBuilder()
                    .setTitle('Meow! 🐱')
                    .setImage(imageUrl)
                    .setColor('#FFC107') // Gold color from your theme
                    .setFooter({ text: 'Powered by TheCatAPI' })
                    .setTimestamp();

                await message.channel.send({ embeds: [embed] }).catch(console.error);
                console.log(`[MEOW FUN] Sent cat image to #${message.channel.name}: ${imageUrl}`);
                await logMessage(message, client, `Sent cat image to #${message.channel.name}: ${imageUrl}`); // Log successful send
            } else {
                console.warn('[MEOW FUN] TheCatAPI did not return an image URL.');
                await logMessage(message, client, 'TheCatAPI did not return an image URL.'); // Log API failure
                // Optionally, reply with a fallback message
                // await message.channel.send('Meow! I tried to find a cat, but it ran away! 😿').catch(console.error);
            }
        } catch (error) {
            console.error('[MEOW FUN] Error fetching cat image from TheCatAPI:', error.response ? error.response.data : error.message);
            await logMessage(message, client, `Error fetching cat image from TheCatAPI: ${error.message}`); // Log API error
            // Optionally, reply with an error message
            // await message.channel.send('Meow! I\'m having trouble finding a cat right now. 😿').catch(console.error);
        }
    }
};

module.exports = {
    handleMeow
};
