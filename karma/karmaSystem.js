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
 *
