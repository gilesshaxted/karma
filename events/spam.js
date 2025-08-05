// events/lemons.js
const axios = require('axios'); // Needed for making HTTP requests

/**
 * Checks if a message should be handled by the lemons game.
 * @param {Message} message - The message to check.
 * @returns {boolean} - True if the message contains 'lemon' or 'lemons' and is in the correct channel, false otherwise.
 */
const shouldHandle = (message) => {
    // The specific channel ID where the bot should respond
    const LEMONS_CHANNEL_ID = '1400536719585181726';
    
    // Check if the message is in the correct channel AND contains the keywords
    return message.channel.id === LEMONS_CHANNEL_ID && (message.content.toLowerCase().includes('lemon') || message.content.toLowerCase().includes('lemons'));
};

/**
 * Handles a message containing 'lemon' or 'lemons' by replying with emojis or a GIF.
 * @param {Message} message - The message to handle.
 * @param {string} tenorApiKey - The API key for the Tenor API.
 */
const handleMessage = async (message, tenorApiKey) => {
    const isGif = Math.random() < 0.5; // 50% chance to send a GIF
    
    if (isGif && tenorApiKey) {
        // Send a random lemon GIF from Tenor
        try {
            const tenorUrl = `https://tenor.googleapis.com/v2/search?q=lemon%20fruit&key=${tenorApiKey}&client_key=my_app_name&limit=50&random=true`;
            const response = await axios.get(tenorUrl);
            const gifs = response.data.results;
            
            if (gifs && gifs.length > 0) {
                const randomGif = gifs[Math.floor(Math.random() * gifs.length)];
                await message.reply(randomGif.url);
            } else {
                // Fallback to emojis if no GIF is found
                await sendLemonEmojis(message);
            }
        } catch (error) {
            console.error('Error fetching GIF from Tenor:', error);
            // Fallback to emojis if API call fails
            await sendLemonEmojis(message);
        }
    } else {
        // Send a random number of lemon emojis
        await sendLemonEmojis(message);
    }
};

/**
 * Sends a random number of lemon emojis to a channel.
 * @param {Message} message - The message to reply to.
 */
const sendLemonEmojis = async (message) => {
    const minEmojis = 6;
    const maxEmojis = 18;
    const emojiCount = Math.floor(Math.random() * (maxEmojis - minEmojis + 1)) + minEmojis;
    const emojis = '🍋'.repeat(emojiCount);
    await message.reply(emojis);
};

module.exports = {
    shouldHandle,
    handleMessage
};
