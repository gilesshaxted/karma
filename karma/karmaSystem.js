// karma/karmaSystem.js - Core functions for managing the karma system.
const { collection, addDoc, getDocs, doc, getDoc, setDoc, updateDoc } = require('firebase/firestore');

// Removed the AI-related import and function as requested.
// const axios = require('axios'); // For making HTTP requests to Google AI

const getOrCreateUserKarma = async (guildId, userId, db, appId) => {
    const userRef = doc(db, `artifacts/${appId}/public/data/guilds/${guildId}/users`, userId);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
        return userSnap.data();
    } else {
        const defaultData = {
            karma: 0,
            messagesToday: 0,
            repliesReceivedToday: 0,
            lastActivityDate: new Date().toISOString()
        };
        await setDoc(userRef, defaultData);
        return defaultData;
    }
};

const updateUserKarmaData = async (guildId, userId, data, db, appId) => {
    const userRef = doc(db, `artifacts/${appId}/public/data/guilds/${guildId}/users`, userId);
    await setDoc(userRef, data, { merge: true });
};

// Removed the analyzeSentiment function as it is no longer used.
// const analyzeSentiment = async (text, googleApiKey) => { ... }


// Helper to send a karma announcement to the designated channel
const sendKarmaAnnouncement = async (guild, targetUserId, karmaChange, newKarma, getGuildConfig, client, isNewMember = false) => {
    const guildConfig = await getGuildConfig(guild.id);
    if (!guildConfig || !guildConfig.karmaChannelId) {
        return;
    }

    const karmaChannel = guild.channels.cache.get(guildConfig.karmaChannelId);
    if (!karmaChannel) {
        console.warn(`Karma channel with ID ${guildConfig.karmaChannelId} not found.`);
        return;
    }

    let message;
    if (isNewMember) {
        message = `Welcome <@${targetUserId}> to the server! They have been awarded 1 Karma point for joining! Their current Karma is **${newKarma}**.`;
    } else {
        const changeText = karmaChange > 0 ? `gained **${karmaChange}**` : `lost **${Math.abs(karmaChange)}**`;
        message = `<@${targetUserId}> has ${changeText} Karma! Their new total is **${newKarma}**.`;
    }

    try {
        await karmaChannel.send(message);
    } catch (error) {
        console.error(`Failed to send karma announcement in channel ${karmaChannel.name}:`, error);
    }
};


// Functions to add, subtract, and set karma points
const addKarmaPoints = async (guildId, user, points, db, appId) => {
    const karmaData = await getOrCreateUserKarma(guildId, user.id, db, appId);
    const newKarma = karmaData.karma + points;
    await updateUserKarmaData(guildId, user.id, { karma: newKarma }, db, appId);
    return newKarma;
};

const subtractKarmaPoints = async (guildId, user, points, db, appId) => {
    return await addKarmaPoints(guildId, user, -points, db, appId);
};

const setKarmaPoints = async (guildId, user, points, db, appId) => {
    await updateUserKarmaData(guildId, user.id, { karma: points }, db, appId);
    return points;
};


module.exports = {
    getOrCreateUserKarma,
    updateUserKarmaData,
    sendKarmaAnnouncement,
    addKarmaPoints,
    subtractKarmaPoints,
    setKarmaPoints,
};
