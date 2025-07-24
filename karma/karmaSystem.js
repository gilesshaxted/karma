// karma/karmaSystem.js
const { doc, getDoc, setDoc, updateDoc, collection, query, where, limit, getDocs } = require('firebase/firestore');
const axios = require('axios'); // Use axios for API calls

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

module.exports = {
    getOrCreateUserKarma,
    updateUserKarmaData,
    hasRecentModeration,
    analyzeSentiment,
    calculateAndAwardKarma
};
