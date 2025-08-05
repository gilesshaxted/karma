// events/spam.js
const axios = require('axios'); // Needed for making HTTP requests

/**
 * Checks if a message should be handled by the spam filter.
 * @param {Message} message - The message to check.
 * @param {Object} guildConfig - The guild's configuration from Firestore.
 * @returns {boolean} - True if the message contains a configured keyword and is in the correct channel, false otherwise.
 */
const shouldHandle = (message, guildConfig) => {
    // Check if spam keywords and channel are configured
    if (!guildConfig.spamChannelId || !guildConfig.spamKeywords) {
        return false;
    }

    // Split the keywords string into an array and trim whitespace
    const keywords = guildConfig.spamKeywords.split(',').map(keyword => keyword.trim().toLowerCase());
    const messageContent = message.content.toLowerCase();

    // Check if the message is in the correct channel AND contains any of the keywords
    const keywordFound = keywords.some(keyword => messageContent.includes(keyword));
    return message.channel.id === guildConfig.spamChannelId && keywordFound;
};

/**
 * Handles a message containing a spam keyword by replying with an emoji or a GIF.
 * @param {Message} message - The message to handle.
 * @param {string} tenorApiKey - The API key for the Tenor API.
 */
const handleMessage = async (message, tenorApiKey) => {
    const isGif = Math.random() < 0.5; // 50% chance to send a GIF
    
    if (isGif && tenorApiKey) {
        // Send a random spam-related GIF from Tenor
        try {
            const tenorUrl = `https://tenor.googleapis.com/v2/search?q=spam%20filter&key=${tenorApiKey}&client_key=my_app_name&limit=50&random=true`;
            const response = await axios.get(tenorUrl);
            const gifs = response.data.results;
            
            if (gifs && gifs.length > 0) {
                const randomGif = gifs[Math.floor(Math.random() * gifs.length)];
                await message.reply(randomGif.url);
            } else {
                // Fallback to emojis if no GIF is found
                await sendSpamReaction(message);
            }
        } catch (error) {
            console.error('Error fetching GIF from Tenor:', error);
            // Fallback to emojis if API call fails
            await sendSpamReaction(message);
        }
    } else {
        // Send a generic spam reaction emoji
        await sendSpamReaction(message);
    }
};

/**
 * Adds a reaction to a message to indicate it was flagged as spam.
 * @param {Message} message - The message to react to.
 */
const sendSpamReaction = async (message) => {
    // You can customize this emoji as you see fit
    await message.react('🚫').catch(console.error);
};

module.exports = {
    shouldHandle,
    handleMessage
};
