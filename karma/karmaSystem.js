// karma/karmaSystem.js
const { EmbedBuilder } = require('discord.js');
const { doc, collection, getDoc, setDoc, updateDoc, query, where, getDocs } = require('firebase/firestore');

/**
 * Gets a user's karma data or creates a new entry if it doesn't exist.
 * This function now also initializes warnings, timeouts, kicks, and bans arrays.
 * @param {string} guildId - The ID of the guild.
 * @param {string} userId - The ID of the user.
 * @param {Firestore} db - The Firestore database instance.
 * @param {string} appId - The application ID for Firestore paths.
 * @returns {Object} The user's karma data, including moderation arrays.
 */
const getOrCreateUserKarma = async (guildId, userId, db, appId) => {
    const userRef = doc(collection(db, `artifacts/${appId}/public/data/guilds/${guildId}/users`), userId);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
        const data = userSnap.data();
        // Ensure all moderation arrays exist
        if (!data.warnings) data.warnings = [];
        if (!data.timeouts) data.timeouts = [];
        if (!data.kicks) data.kicks = []; // New: Kicks array
        if (!data.bans) data.bans = [];   // New: Bans array
        return data;
    } else {
        const defaultData = {
            karma: 0,
            messagesToday: 0,
            repliesReceivedToday: 0,
            lastActivityDate: new Date(),
            warnings: [],
            timeouts: [],
            kicks: [], // Initialize kicks array
            bans: []   // Initialize bans array
        };
        await setDoc(userRef, defaultData);
        return defaultData;
    }
};

/**
 * Updates a user's karma data in Firestore.
 * @param {string} guildId - The ID of the guild.
 * @param {string} userId - The ID of the user.
 * @param {Object} dataToUpdate - An object containing fields to update.
 * @param {Firestore} db - The Firestore database instance.
 * @param {string} appId - The application ID for Firestore paths.
 */
const updateUserKarmaData = async (guildId, userId, dataToUpdate, db, appId) => {
    const userRef = doc(collection(db, `artifacts/${appId}/public/data/guilds/${guildId}/users`), userId);
    await updateDoc(userRef, dataToUpdate);
};

/**
 * Adds karma points to a user.
 * @param {string} guildId - The ID of the guild.
 * @param {User} user - The Discord user object.
 * @param {number} points - The number of points to add.
 * @param {Firestore} db - The Firestore database instance.
 * @param {string} appId - The application ID for Firestore paths.
 * @returns {number} The new karma total.
 */
const addKarmaPoints = async (guildId, user, points, db, appId) => {
    const userData = await getOrCreateUserKarma(guildId, user.id, db, appId);
    const newKarma = (userData.karma || 0) + points;
    await updateUserKarmaData(guildId, user.id, { karma: newKarma }, db, appId);
    return newKarma;
};

/**
 * Subtracts karma points from a user.
 * @param {string} guildId - The ID of the guild.
 * @param {User} user - The Discord user object.
 * @param {number} points - The number of points to subtract.
 * @param {Firestore} db - The Firestore database instance.
 * @param {string} appId - The application ID for Firestore paths.
 * @returns {number} The new karma total.
 */
const subtractKarmaPoints = async (guildId, user, points, db, appId) => {
    return addKarmaPoints(guildId, user, -points, db, appId);
};

/**
 * Sets a user's karma points to a specific value.
 * @param {string} guildId - The ID of the guild.
 * @param {User} user - The Discord user object.
 * @param {number} points - The new karma total.
 * @param {Firestore} db - The Firestore database instance.
 * @param {string} appId - The application ID for Firestore paths.
 * @returns {number} The new karma total.
 */
const setKarmaPoints = async (guildId, user, points, db, appId) => {
    const userData = await getOrCreateUserKarma(guildId, user.id, db, appId);
    await updateUserKarmaData(guildId, user.id, { karma: points }, db, appId);
    return points;
};

/**
 * Sends a karma announcement to the configured karma channel.
 * @param {Guild} guild - The Discord guild object.
 * @param {string} userId - The ID of the user whose karma changed.
 * @param {number} karmaChange - The amount of karma changed (+/-).
 * @param {number} newKarma - The user's new total karma.
 * @param {Function} getGuildConfig - Function to get the guild's config.
 * @param {Client} client - The Discord client instance.
 * @param {boolean} isNewMember - True if this is a new member greeting.
 */
const sendKarmaAnnouncement = async (guild, userId, karmaChange, newKarma, getGuildConfig, client, isNewMember = false) => {
    const guildConfig = await getGuildConfig(guild.id);
    const karmaChannelId = guildConfig.karmaChannelId;

    if (!karmaChannelId) {
        console.warn(`[KARMA SYSTEM] No karma announcement channel configured for guild ${guild.name}.`);
        return;
    }

    const karmaChannel = guild.channels.cache.get(karmaChannelId);
    if (!karmaChannel) {
        console.warn(`[KARMA SYSTEM] Configured karma channel (${karmaChannelId}) not found in guild ${guild.name}.`);
        return;
    }

    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) {
        console.warn(`[KARMA SYSTEM] Could not fetch user ${userId} for karma announcement.`);
        return;
    }

    let description;
    if (isNewMember) {
        description = `Welcome <@${user.id}> to the server! They start with ${newKarma} Karma! �`;
    } else {
        const action = karmaChange > 0 ? 'gained' : 'lost';
        description = `<@${user.id}> has ${action} ${Math.abs(karmaChange)} Karma! Their new total is ${newKarma}.`;
    }

    const embed = new EmbedBuilder()
        .setColor(karmaChange > 0 ? '#00FF00' : (karmaChange < 0 ? '#FF0000' : '#FFFF00'))
        .setTitle('Karma Update!')
        .setDescription(description)
        .setThumbnail(user.displayAvatarURL({ dynamic: true }))
        .setTimestamp();

    await karmaChannel.send({ embeds: [embed] }).catch(console.error);
};

/**
 * Calculates and awards karma based on message activity.
 * (This function might need further refinement based on specific karma rules)
 * @param {Guild} guild - The Discord guild object.
 * @param {User} user - The Discord user object.
 * @param {Object} userData - The user's current karma data.
 * @param {Firestore} db - The Firestore database instance.
 * @param {string} appId - The application ID for Firestore paths.
 * @param {string} googleApiKey - The Google API Key (if sentiment analysis is re-introduced).
 */
const calculateAndAwardKarma = async (guild, user, userData, db, appId, googleApiKey) => {
    // Example: Award 1 karma for every 10 messages today, up to a limit
    const messagesToday = userData.messagesToday || 0;
    const repliesReceivedToday = userData.repliesReceivedToday || 0;
    let karmaAwarded = 0;

    // Simple karma for messages (e.g., 1 karma per 10 messages, max 5 per day)
    if (messagesToday > 0 && messagesToday % 10 === 0 && (messagesToday / 10) <= 5) {
        karmaAwarded += 1;
    }

    // Simple karma for replies received (e.g., 1 karma per 5 replies, max 3 per day)
    if (repliesReceivedToday > 0 && repliesReceivedToday % 5 === 0 && (repliesReceivedToday / 5) <= 3) {
        karmaAwarded += 1;
    }

    if (karmaAwarded > 0) {
        const newKarma = await addKarmaPoints(guild.id, user, karmaAwarded, db, appId);
        // We can choose to announce this or keep it silent.
        // await sendKarmaAnnouncement(guild, user.id, karmaAwarded, newKarma, client.getGuildConfig, client);
    }
};

/**
 * Retrieves a user's full moderation history (warnings, timeouts, kicks, bans).
 * @param {string} guildId - The ID of the guild.
 * @param {string} userId - The ID of the user.
 * @param {Firestore} db - The Firestore database instance.
 * @param {string} appId - The application ID for Firestore paths.
 * @returns {Object} An object containing the user's warnings, timeouts, kicks, and bans arrays.
 */
const getModerationHistory = async (guildId, userId, db, appId) => {
    const userData = await getOrCreateUserKarma(guildId, userId, db, appId);
    return {
        warnings: userData.warnings || [],
        timeouts: userData.timeouts || [],
        kicks: userData.kicks || [],
        bans: userData.bans || []
    };
};

/**
 * Adds a warning to a user's moderation record.
 * @param {string} guildId - The ID of the guild.
 * @param {string} userId - The ID of the user.
 * @param {Object} warningDetails - Object containing { timestamp, rule, reason, messageContent, caseNumber, moderatorId, moderatorTag }.
 * @param {Firestore} db - The Firestore database instance.
 * @param {string} appId - The application ID for Firestore paths.
 * @returns {Array} The updated list of warnings.
 */
const addWarning = async (guildId, userId, warningDetails, db, appId) => {
    const userData = await getOrCreateUserKarma(guildId, userId, db, appId);
    userData.warnings.push(warningDetails);
    await updateUserKarmaData(guildId, userId, { warnings: userData.warnings }, db, appId);
    return userData.warnings;
};

/**
 * Adds a timeout to a user's moderation record.
 * @param {string} guildId - The ID of the guild.
 * @param {string} userId - The ID of the user.
 * @param {Object} timeoutDetails - Object containing { timestamp, duration, caseNumber, moderatorId, moderatorTag }.
 * @param {Firestore} db - The Firestore database instance.
 * @param {string} appId - The application ID for Firestore paths.
 * @returns {Array} The updated list of timeouts.
 */
const addTimeout = async (guildId, userId, timeoutDetails, db, appId) => {
    const userData = await getOrCreateUserKarma(guildId, userId, db, appId);
    userData.timeouts.push(timeoutDetails);
    await updateUserKarmaData(guildId, userId, { timeouts: userData.timeouts }, db, appId);
    return userData.timeouts;
};

/**
 * Adds a kick record to a user's moderation history.
 * @param {string} guildId - The ID of the guild.
 * @param {string} userId - The ID of the user.
 * @param {Object} kickDetails - Object containing { timestamp, reason, caseNumber, moderatorId, moderatorTag }.
 * @param {Firestore} db - The Firestore database instance.
 * @param {string} appId - The application ID for Firestore paths.
 * @returns {Array} The updated list of kicks.
 */
const addKickRecord = async (guildId, userId, kickDetails, db, appId) => {
    const userData = await getOrCreateUserKarma(guildId, userId, db, appId);
    userData.kicks.push(kickDetails);
    await updateUserKarmaData(guildId, userId, { kicks: userData.kicks }, db, appId);
    return userData.kicks;
};

/**
 * Adds a ban record to a user's moderation history.
 * @param {string} guildId - The ID of the guild.
 * @param {string} userId - The ID of the user.
 * @param {Object} banDetails - Object containing { timestamp, duration, reason, caseNumber, moderatorId, moderatorTag }.
 * @param {Firestore} db - The Firestore database instance.
 * @param {string} appId - The application ID for Firestore paths.
 * @returns {Array} The updated list of bans.
 */
const addBanRecord = async (guildId, userId, banDetails, db, appId) => {
    const userData = await getOrCreateUserKarma(guildId, userId, db, appId);
    userData.bans.push(banDetails);
    await updateUserKarmaData(guildId, userId, { bans: userData.bans }, db, appId);
    return userData.bans;
};


module.exports = {
    getOrCreateUserKarma,
    updateUserKarmaData,
    addKarmaPoints,
    subtractKarmaPoints,
    setKarmaPoints,
    sendKarmaAnnouncement,
    calculateAndAwardKarma,
    getModerationHistory, // Export new moderation history retrieval
    addWarning,           // Export new warning function
    addTimeout,           // Export new timeout function
    addKickRecord,        // Export new kick function
    addBanRecord          // Export new ban function
};
�
