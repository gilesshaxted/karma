// events/meow.js
const axios = require('axios');
const { EmbedBuilder } = require('discord.js');

/**
 * Handles messages containing "meow" and replies with a random cat image.
 * @param {Message} message - The message object.
 * @param {string} catApiKey - The API key for TheCatAPI.
 * @param {Function} getGuildConfig - Function to get guild configuration.
 */
const handleMeow = async (message, catApiKey, getGuildConfig) => {
    // Ignore bot messages and DMs
    if (message.author.bot || !message.guild) {
        return;
    }

    const guildConfig = await getGuildConfig(message.guild.id);

    // Check if Meow Fun is enabled for this guild
    if (!guildConfig.meowFunEnabled) {
        return; // Feature is disabled
    }

    // Check if the message content is exactly "meow" (case-insensitive)
    if (message.content.toLowerCase() === 'meow') {
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
            } else {
                console.warn('TheCatAPI did not return an image URL.');
                // Optionally, reply with a fallback message
                // await message.channel.send('Meow! I tried to find a cat, but it ran away! 😿').catch(console.error);
            }
        } catch (error) {
            console.error('Error fetching cat image from TheCatAPI:', error.response ? error.response.data : error.message);
            // Optionally, reply with an error message
            // await message.channel.send('Meow! I\'m having trouble finding a cat right now. 😿').catch(console.error);
        }
    }
};

module.exports = {
    handleMeow
};
