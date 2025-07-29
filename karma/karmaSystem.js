// karma/karmaSystem.js
const { doc, getDoc, setDoc, updateDoc, collection, query, where, limit, getDocs } = require('firebase/firestore');
const axios = require('axios'); // Use axios for API calls
const { EmbedBuilder } = require('discord.js'); // For sending rich embeds

/**
 * Helper function to get or create a user's karma document in Firestore.
 * @param {string} guildId - The ID of the guild.
 * @param {string} userId - The ID of the user.
 * @param {object} db - Firestore database instance.
 * @param {string} appId - The application ID for Firestore paths.
 * @returns {Promise<object>} - The user's karma data.
 */
const getOrCreateUserKarma = async (guildId, userId, db, appId) => {
    const karmaRef = doc(db, `artifacts/${appId}/public/data/guilds/${guildId}/karma_users`, userId);
    const karmaSnap = await getDoc(karmaRef);

    if (karmaSnap.exists()) {
        const data = karmaSnap.data();
        // Ensure dates are Date objects, converting from Firestore Timestamp if necessary
        if (data.lastActivityDate && typeof data.lastActivityDate.toDate === 'function') {
            data.lastActivityDate = data.lastActivityDate.toDate();
        }
        if (data.lastKarmaCalculationDate && typeof data.lastKarmaCalculationDate.toDate === 'function') {
            data.lastKarmaCalculationDate = data.lastKarmaCalculationDate.toDate();
        }
        return data;
    } else {
        const defaultKarma = {
            userId: userId,
            karmaPoints: 0,
            messagesToday: 0,
            repliesReceivedToday: 0,
            reactionsReceivedToday: 0,
            lastActivityDate: new Date(),
            lastKarmaCalculationDate: new Date()
        };
        await setDoc(karmaRef, defaultKarma);
        return defaultKarma;
    }
};

/**
 * Helper function to update user karma data in Firestore.
 * @param {string} guildId - The ID of the guild.
 * @param {string} userId - The ID of the user.
 * @param {object} data - The data to update.
 * @param {object} db - Firestore database instance.
 * @param {string} appId - The application ID for Firestore paths.
 */
const updateUserKarmaData = async (guildId, userId, data, db, appId) => {
    const karmaRef = doc(db, `artifacts/${appId}/public/data/guilds/${guildId}/karma_users`, userId);
    await updateDoc(karmaRef, data);
};

/**
 * Helper function to check if a user has any moderation actions in the last 24 hours.
 * @param {string} guildId - The ID of the guild.
 * @param {string} userIdToCheck - The ID of the user to check.
 * @param {object} db - Firestore database instance.
 * @param {string} appId - The application ID for Firestore paths.
 * @returns {Promise<boolean>} - True if recent moderation exists, false otherwise.
 */
const hasRecentModeration = async (guildId, userIdToCheck, db, appId) => {
    const twentyFourHoursAgo = new Date(Date.now() - (24 * 60 * 60 * 1000));
    const moderationRecordsRef = collection(db, `artifacts/${appId}/public/data/guilds/${guildId}/moderation_records`);
    const q = query(
        moderationRecordsRef,
        where("targetUserId", "==", userIdToCheck),
        where("timestamp", ">=", twentyFourHoursAgo),
        limit(1)
    );
    const querySnapshot = await getDocs(q);
    return !querySnapshot.empty;
};

/**
 * LLM-powered sentiment analysis.
 * @param {string} text - The text to analyze.
 * @param {string} googleApiKey - The Google API key for Gemini.
 * @returns {Promise<string>} - The sentiment ('positive', 'neutral', 'negative').
 */
const analyzeSentiment = async (text, googleApiKey) => {
    try {
        const chatHistory = [{ role: "user", parts: [{ text: `Analyze the sentiment of the following text and return only one word: "positive", "neutral", or "negative".\n\nText: "${text}"` }] }];
        const payload = { contents: chatHistory };
        const apiKey = googleApiKey || "";
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

        const response = await axios.post(apiUrl, payload, { // Use axios.post
            headers: { 'Content-Type': 'application/json' },
        });

        if (response.status !== 200) { // Check response status
            console.error(`Gemini API sentiment error: ${response.status} - ${response.data}`);
            return 'neutral';
        }

        const result = response.data; // axios puts response data in .data

        if (result.candidates && result.candidates.length > 0 &&
            result.candidates[0].content && result.candidates[0].content.parts &&
            result.candidates[0].content.parts.length > 0) {
            const sentiment = result.candidates[0].content.parts[0].text.toLowerCase().trim();
            if (['positive', 'neutral', 'negative'].includes(sentiment)) {
                return sentiment;
            } else {
                console.warn(`Gemini API returned unexpected sentiment: "${sentiment}". Falling back to neutral.`);
                return 'neutral';
            }
        } else {
            console.warn('Gemini API sentiment response structure unexpected or content missing. Falling back to neutral.');
            return 'neutral';
        }
    } catch (error) {
        console.error('Error calling Gemini API for sentiment analysis:', error.response ? error.response.data : error.message);
        return 'neutral';
    }
};

/**
 * Calculates and awards karma points to a user.
 * @param {Guild} guild - The Discord guild.
 * @param {User} user - The user for whom to calculate karma.
 * @param {object} karmaData - The user's current karma data.
 * @param {object} db - Firestore database instance.
 * @param {string} appId - The application ID for Firestore paths.
 * @param {string} googleApiKey - The Google API key for Gemini.
 */
const calculateAndAwardKarma = async (guild, user, karmaData, db, appId, googleApiKey) => {
    let karmaAwarded = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const lastCalcDate = karmaData.lastKarmaCalculationDate instanceof Date ? karmaData.lastKarmaCalculationDate : new Date(karmaData.lastKarmaCalculationDate);
    lastCalcDate.setHours(0, 0, 0, 0);

    const hasModerationRecently = await hasRecentModeration(guild.id, user.id, db, appId);
    if (hasModerationRecently) {
        console.log(`${user.tag} has recent moderation, skipping karma gain.`);
        if (today.getTime() > lastCalcDate.getTime()) {
            await updateUserKarmaData(guild.id, user.id, {
                messagesToday: 0,
                repliesReceivedToday: 0,
                reactionsReceivedToday: 0,
                lastKarmaCalculationDate: new Date()
            }, db, appId);
        }
        return 0;
    }

    if (today.getTime() > lastCalcDate.getTime()) {
        if (karmaData.messagesToday >= 100) {
            karmaAwarded += 2;
            console.log(`Awarded 2 karma to ${user.tag} for hyper activity.`);
        } else if (karmaData.messagesToday >= 20) {
            karmaAwarded += 1;
            console.log(`Awarded 1 karma to ${user.tag} for activity.`);
        }

        if (karmaData.repliesReceivedToday >= 10) {
            karmaAwarded += Math.floor(karmaData.repliesReceivedToday / 10);
            console.log(`Awarded ${Math.floor(karmaData.repliesReceivedToday / 10)} karma to ${user.tag} for replies.`);
        }
        if (karmaData.reactionsReceivedToday >= 10) {
            karmaAwarded += Math.floor(karmaData.reactionsReceivedToday / 10);
            console.log(`Awarded ${Math.floor(karmaData.reactionsReceivedToday / 10)} karma to ${user.tag} for reactions.`);
        }

        await updateUserKarmaData(guild.id, user.id, {
            karmaPoints: karmaData.karmaPoints + karmaAwarded,
            messagesToday: 0,
            repliesReceivedToday: 0,
            reactionsReceivedToday: 0,
            lastKarmaCalculationDate: new Date()
        }, db, appId);
        console.log(`Karma for ${user.tag} updated. Total: ${karmaData.karmaPoints + karmaAwarded}`);
    } else {
        console.log(`No new karma calculation for ${user.tag} today.`);
    }
    return karmaAwarded;
};

/**
 * Adds karma points to a user.
 * @param {string} guildId - The ID of the guild.
 * @param {User} targetUser - The user to add karma to.
 * @param {number} points - The number of points to add.
 * @param {object} db - Firestore database instance.
 * @param {string} appId - The application ID for Firestore paths.
 * @returns {Promise<number>} The new karma total.
 */
const addKarmaPoints = async (guildId, targetUser, points, db, appId) => {
    const karmaData = await getOrCreateUserKarma(guildId, targetUser.id, db, appId);
    const newKarma = karmaData.karmaPoints + points;
    await updateUserKarmaData(guildId, targetUser.id, { karmaPoints: newKarma }, db, appId);
    return newKarma;
};

/**
 * Subtracts karma points from a user.
 * @param {string} guildId - The ID of the guild.
 * @param {User} targetUser - The user to subtract karma from.
 * @param {number} points - The number of points to subtract.
 * @param {object} db - Firestore database instance.
 * @param {string} appId - The application ID for Firestore paths.
 * @returns {Promise<number>} The new karma total.
 */
const subtractKarmaPoints = async (guildId, targetUser, points, db, appId) => {
    const karmaData = await getOrCreateUserKarma(guildId, targetUser.id, db, appId);
    const newKarma = karmaData.karmaPoints - points;
    await updateUserKarmaData(guildId, targetUser.id, { karmaPoints: newKarma }, db, appId);
    return newKarma;
};

/**
 * Sets a user's karma points to a specific total.
 * @param {string} guildId - The ID of the guild.
 * @param {User} targetUser - The user to set karma for.
 * @param {number} newTotal - The new total karma points.
 * @param {object} db - Firestore database instance.
 * @param {string} appId - The application ID for Firestore paths.
 * @returns {Promise<number>} The new karma total.
 */
const setKarmaPoints = async (guildId, targetUser, newTotal, db, appId) => {
    await updateUserKarmaData(guildId, targetUser.id, { karmaPoints: newTotal }, db, appId);
    return newTotal;
};

const karmaGainMessages = [
    "Way to go <@${userId}>! I just gave you +${karmaChange} Karma for being awesome!",
    "Fantastic! <@${userId}> earned +${karmaChange} Karma. Keep up the great work!",
    "Boom! +${karmaChange} Karma for <@${userId}>. You're on fire!",
    "A well-deserved +${karmaChange} Karma for <@${userId}>. Nice one!",
    "Karma's smiling on <@${userId}> with +${karmaChange} points! Total: ${newTotal}."
];

const karmaLossMessages = [
    "Oh dear <@${userId}>, that is ${karmaChange} less karma for you. Be better!",
    "Oops! <@${userId}> lost ${karmaChange} Karma. Better luck next time!",
    "A moment of silence for <@${userId}>, who just lost ${karmaChange} Karma. Don't worry, you'll get it back!",
    "Uh oh, <@${userId}> just took a hit of ${karmaChange} Karma. Total: ${newTotal}.",
    "Looks like Karma wasn't on <@${userId}>'s side this time. -${karmaChange} Karma."
];

const newMemberGreetingMessages = [
    "Welcome to the server, <@${userId}>! Here's +1 Karma to start your journey!",
    "A warm welcome to <@${userId}>! You just got +1 Karma for joining our awesome community!",
    "Hello, <@${userId}>! The Karma bot is happy to see you and has given you +1 Karma!",
    "Glad to have you, <@${userId}>! Enjoy your stay, and here's +1 Karma on the house!"
];

/**
 * Sends a varied karma announcement message to the configured Karma Channel.
 * @param {Guild} guild - The Discord guild.
 * @param {string} userId - The ID of the user whose karma changed.
 * @param {number} karmaChange - The amount of karma changed (+1, -1, etc.).
 * @param {number} newTotal - The user's new total karma.
 * @param {function} getGuildConfig - The function to retrieve guild configuration.
 * @param {Client} client - The Discord client instance (for fetching user, channels etc.)
 * @param {boolean} [isNewMember=false] - True if this is a new member greeting.
 */
const sendKarmaAnnouncement = async (guild, userId, karmaChange, newTotal, getGuildConfig, client, isNewMember = false) => {
    // Now getGuildConfig is passed directly, not accessed via client
    const guildConfig = await getGuildConfig(guild.id);
    const karmaChannelId = guildConfig.karmaChannelId;

    if (!karmaChannelId) {
        console.warn(`Karma channel not set for guild ${guild.name}. Cannot send karma announcement.`);
        return;
    }

    const karmaChannel = guild.channels.cache.get(karmaChannelId);
    if (!karmaChannel) {
        console.error(`Karma channel with ID ${karmaChannelId} not found in guild ${guild.name}. Cannot send karma announcement.`);
        return;
    }

    let messageArray;
    let color;

    if (isNewMember) {
        messageArray = newMemberGreetingMessages;
        color = '#FFD700'; // Gold for new member
    } else if (karmaChange > 0) {
        messageArray = karmaGainMessages;
        color = '#00FF00'; // Green for gain
    } else {
        messageArray = karmaLossMessages;
        color = '#FF0000'; // Red for loss
    }

    const randomIndex = Math.floor(Math.random() * messageArray.length);
    let messageContent = messageArray[randomIndex];

    // Replace placeholders
    messageContent = messageContent.replace(/\$\{(\w+)\}/g, (match, p1) => {
        if (p1 === 'userId') return userId;
        if (p1 === 'karmaChange') return Math.abs(karmaChange); // Always positive for display
        if (p1 === 'newTotal') return newTotal;
        return match;
    });

    const embed = new EmbedBuilder()
        .setDescription(messageContent)
        .setColor(color)
        .setTimestamp();

    await karmaChannel.send({ embeds: [embed] }).catch(console.error);
};

/**
 * Checks for members who haven't chatted in a week and deducts karma.
 * @param {Guild} guild - The Discord guild.
 * @param {Client} client - The Discord client instance.
 * @param {function} getGuildConfig - The function to retrieve guild configuration.
 */
const checkWeeklyInactivityKarma = async (guild, client, getGuildConfig) => {
    console.log(`Checking for inactive members in guild ${guild.name}...`);
    const oneWeekAgo = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000));

    const karmaUsersRef = collection(client.db, `artifacts/${client.appId}/public/data/guilds/${guild.id}/karma_users`);
    const q = query(karmaUsersRef); // Fetch all karma users

    const querySnapshot = await getDocs(q);

    for (const docSnapshot of querySnapshot.docs) {
        const karmaData = docSnapshot.data();
        const lastActivityDate = karmaData.lastActivityDate ? karmaData.lastActivityDate.toDate() : null;

        if (lastActivityDate && lastActivityDate < oneWeekAgo) {
            const targetUser = await client.users.fetch(karmaData.userId).catch(() => null);
            if (targetUser && !targetUser.bot) { // Only penalize human users
                const newKarma = await subtractKarmaPoints(guild.id, targetUser, 1, client.db, client.appId);
                console.log(`Deducted 1 karma from ${targetUser.tag} for inactivity. New total: ${newKarma}`);
                // Pass getGuildConfig to sendKarmaAnnouncement here
                await sendKarmaAnnouncement(guild, targetUser.id, -1, newKarma, getGuildConfig, client);
            }
        }
    }
    console.log(`Finished checking inactive members in guild ${guild.name}.`);
};


module.exports = {
    getOrCreateUserKarma,
    updateUserKarmaData,
    hasRecentModeration,
    analyzeSentiment,
    calculateAndAwardKarma,
    addKarmaPoints,
    subtractKarmaPoints,
    setKarmaPoints,
    sendKarmaAnnouncement, // Export new function
    checkWeeklyInactivityKarma // Export new function
};
