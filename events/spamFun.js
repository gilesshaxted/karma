// events/spamFun.js
const axios = require('axios'); // Needed for making HTTP requests

/**
 * Checks if a message should trigger the spam fun game.
 * @param {Message} message - The message to check.
 * @param {Object} guildConfig - The guild's configuration from Firestore.
 * @returns {boolean} - True if the message contains a configured keyword and is in the correct channel, false otherwise.
 */
const shouldTriggerGame = (message, guildConfig) => {
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
 * Handles a message containing a spam keyword by replying with emojis or a GIF.
 * @param {Message} message - The message to handle.
 * @param {string} tenorApiKey - The API key for the Tenor API.
 * @param {string} spamKeywords - The comma-separated list of keywords from the dashboard.
 */
const handleSpamMessage = async (message, tenorApiKey, spamKeywords) => {
    const isGif = Math.random() < 0.5; // 50% chance to send a GIF
    const keywordsArray = spamKeywords.split(',').map(keyword => keyword.trim());
    const randomKeyword = keywordsArray[Math.floor(Math.random() * keywordsArray.length)];

    if (isGif && tenorApiKey && randomKeyword) {
        // Use the randomly selected keyword from the dashboard for the GIF search
        try {
            // Encode the keyword for the URL
            const encodedKeyword = encodeURIComponent(randomKeyword);
            const tenorUrl = `https://tenor.googleapis.com/v2/search?q=${encodedKeyword}&key=${tenorApiKey}&client_key=my_app_name&limit=50&random=true`;
            const response = await axios.get(tenorUrl);
            const gifs = response.data.results;
            
            if (gifs && gifs.length > 0) {
                const randomGif = gifs[Math.floor(Math.random() * gifs.length)];
                await message.reply(randomGif.url);
            } else {
                // Fallback to emojis if no GIF is found
                await sendSpamEmojis(message);
            }
        } catch (error) {
            console.error('Error fetching GIF from Tenor:', error);
            // Fallback to emojis if API call fails
            await sendSpamEmojis(message);
        }
    } else {
        // Send a random number of fun emojis
        await sendSpamEmojis(message);
    }
};

/**
 * Sends a random number of fun emojis to a channel.
 * @param {Message} message - The message to reply to.
 */
const sendSpamEmojis = async (message) => {
    const minEmojis = 6;
    const maxEmojis = 18;
    const emojiCount = Math.floor(Math.random() * (maxEmojis - minEmojis + 1)) + minEmojis;
    const funEmojis = ['🎉', '🥳', '🎊', '✨', '🎈', '❤️', '🤩', '👍', '😊'];
    let emojis = '';
    for (let i = 0; i < emojiCount; i++) {
        emojis += funEmojis[Math.floor(Math.random() * funEmojis.length)];
    }
    await message.reply(emojis);
};

module.exports = {
    shouldHandle: shouldTriggerGame,
    handleMessage: handleSpamMessage
};
