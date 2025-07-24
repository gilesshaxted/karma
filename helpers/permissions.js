// helpers/permissions.js
const { PermissionsBitField } = require('discord.js');

/**
 * Checks if a member has a moderator or admin role based on guild configuration.
 * If no roles are set in config, only server administrators can use commands.
 * @param {GuildMember} member - The Discord guild member to check.
 * @param {object} guildConfig - The guild's configuration object from Firestore.
 * @returns {boolean} - True if the member has permission, false otherwise.
 */
const hasPermission = (member, guildConfig) => {
    // If no roles are set in config, only server administrators can use commands
    if (!guildConfig.adminRoleId && !guildConfig.modRoleId) {
        return member.permissions.has(PermissionsBitField.Flags.Administrator);
    }

    const isAdmin = guildConfig.adminRoleId && member.roles.cache.has(guildConfig.adminRoleId);
    const isMod = guildConfig.modRoleId && member.roles.cache.has(guildConfig.modRoleId);
    const isServerAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);

    return isAdmin || isMod || isServerAdmin;
};

/**
 * Checks if a target member is exempt from moderation (e.g., bot, admin, or moderator).
 * @param {GuildMember} targetMember - The Discord guild member to check for exemption.
 * @param {object} guildConfig - The guild's configuration object from Firestore.
 * @returns {boolean} - True if the member is exempt, false otherwise.
 */
const isExempt = (targetMember, guildConfig) => {
    const isAdmin = guildConfig.adminRoleId && targetMember.roles.cache.has(guildConfig.adminRoleId);
    const isMod = guildConfig.modRoleId && targetMember.roles.cache.has(guildConfig.modRoleId);
    const isBot = targetMember.user.bot; // Bots are generally exempt

    return isAdmin || isMod || isBot;
};

module.exports = {
    hasPermission,
    isExempt
};
