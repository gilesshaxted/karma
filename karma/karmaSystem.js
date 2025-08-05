// karma/karmaSystem.js
const { doc, getDoc, setDoc, getFirestore } = require('firebase/firestore');

/**
 * Gets or creates a user's karma data from Firestore.
 * @param {string} guildId - The guild ID.
 * @param {string} userId - The user ID.
 * @param {Firestore} db - The Firestore database instance.
 * @param {string} appId - The app ID for Firestore.
 * @returns {Promise<Object>} The user's karma data.
 */
const getOrCreateUserKarma = async (guildId, userId, db, appId) => {
    const userRef = doc(db, `artifacts/${appId}/public/data/guilds/${guildId}/karma`, userId);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
        return userSnap.data();
    } else {
        const defaultKarma = {
            points: 0,
            messagesToday: 0,
            repliesReceivedToday: 0,
            lastActivityDate: new Date(),
        };
        await setDoc(userRef, defaultKarma);
        return defaultKarma;
    }
};

/**
 * Updates a user's karma data in Firestore.
 * @param {string} guildId - The guild ID.
 * @param {string} userId - The user ID.
 * @param {Object} dataToUpdate - The data to merge into the existing document.
 * @param {Firestore} db - The Firestore database instance.
 * @param {string} appId - The app ID for Firestore.
 */
const updateUserKarmaData = async (guildId, userId, dataToUpdate, db, appId) => {
    const userRef = doc(db, `artifacts/${appId}/public/data/guilds/${guildId}/karma`, userId);
    await setDoc(userRef, dataToUpdate, { merge: true });
};

/**
 * Adds karma points to a user.
 * @param {string} guildId - The guild ID.
 * @param {User} user - The user object.
 * @param {number} points - The number of points to add.
 * @param {Firestore} db - The Firestore database instance.
 * @param {string} appId - The app ID for Firestore.
 * @returns {Promise<number>} The user's new karma total.
 */
const addKarmaPoints = async (guildId, user, points, db, appId) => {
    const karmaData = await getOrCreateUserKarma(guildId, user.id, db, appId);
    const newPoints = karmaData.points + points;
    await updateUserKarmaData(guildId, user.id, { points: newPoints }, db, appId);
    return newPoints;
};

/**
 * Subtracts karma points from a user.
 * @param {string} guildId - The guild ID.
 * @param {User} user - The user object.
 * @param {number} points - The number of points to subtract.
 * @param {Firestore} db - The Firestore database instance.
 * @param {string} appId - The app ID for Firestore.
 * @returns {Promise<number>} The user's new karma total.
 */
const subtractKarmaPoints = async (guildId, user, points, db, appId) => {
    const karmaData = await getOrCreateUserKarma(guildId, user.id, db, appId);
    const newPoints = karmaData.points - points;
    await updateUserKarmaData(guildId, user.id, { points: newPoints }, db, appId);
    return newPoints;
};

/**
 * Sets a user's karma points to a specific value.
 * @param {string} guildId - The guild ID.
 * @param {User} user - The user object.
 * @param {number} points - The new karma point total.
 * @param {Firestore} db - The Firestore database instance.
 * @param {string} appId - The app ID for Firestore.
 * @returns {Promise<number>} The user's new karma total.
 */
const setKarmaPoints = async (guildId, user, points, db, appId) => {
    await updateUserKarmaData(guildId, user.id, { points: points }, db, appId);
    return points;
};

/**
 * Calculates and awards passive karma based on message activity.
 * @param {Guild} guild - The guild object.
 * @param {User} user - The user object.
 * @param {Object} karmaData - The user's karma data.
 * @param {Firestore} db - The Firestore database instance.
 * @param {string} appId - The app ID for Firestore.
 */
const calculateAndAwardKarma = async (guild, user, karmaData, db, appId) => {
    // Karma awarded for messages and replies is now handled by other systems,
    // so this function can be simplified or removed if not needed.
    // Keeping it here for future expansion but removing the AI dependency.
    return;
};

/**
 * Sends a karma announcement to the configured karma channel.
 * @param {Guild} guild - The guild object.
 * @param {string} userId - The ID of the user whose karma changed.
 * @param {number} karmaChange - The amount of karma changed.
 * @param {number} newKarmaTotal - The user's new karma total.
 * @param {Function} getGuildConfig - Function to get the guild's config.
 * @param {Client} client - The Discord client.
 * @param {boolean} isNewMember - Whether the user is a new member.
 */
const sendKarmaAnnouncement = async (guild, userId, karmaChange, newKarmaTotal, getGuildConfig, client, isNewMember = false) => {
    const guildConfig = await getGuildConfig(guild.id);
    if (!guildConfig.karmaChannelId) return;

    const karmaChannel = guild.channels.cache.get(guildConfig.karmaChannelId);
    if (!karmaChannel) return;

    let emoji = karmaChange > 0 ? '✨' : '🔻';
    let verb = karmaChange > 0 ? 'gained' : 'lost';
    let announcementMessage;

    if (isNewMember) {
        announcementMessage = `<@${userId}> has joined the server and ${verb} their first ${karmaChange} Karma point! Their total is now **${newKarmaTotal}**.`;
    } else {
        announcementMessage = `<@${userId}> has ${verb} ${Math.abs(karmaChange)} Karma point(s)! Their total is now **${newKarmaTotal}**.`;
    }

    karmaChannel.send(announcementMessage).catch(console.error);
};

// Removed analyzeSentiment as it is no longer needed
// const analyzeSentiment = async (text, apiKey) => { ... };

module.exports = {
    getOrCreateUserKarma,
    updateUserKarmaData,
    addKarmaPoints,
    subtractKarmaPoints,
    setKarmaPoints,
    calculateAndAwardKarma,
    sendKarmaAnnouncement
};
