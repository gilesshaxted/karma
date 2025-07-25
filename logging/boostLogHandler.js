// logging/boostLogHandler.js
const { EmbedBuilder } = require('discord.js');

/**
 * Handles guild member updates to detect boost changes.
 * @param {GuildMember} oldMember - The member before the update.
 * @param {GuildMember} newMember - The member after the update.
 * @param {function} getGuildConfig - Function to retrieve guild configuration.
 */
const handleBoostUpdate = async (oldMember, newMember, getGuildConfig) => {
    // Check if the boost status changed
    if (oldMember.premiumSince !== newMember.premiumSince) {
        const guildConfig = await getGuildConfig(newMember.guild.id);
        const logChannelId = guildConfig.boostLogChannelId;

        if (!logChannelId) return;
        const logChannel = newMember.guild.channels.cache.get(logChannelId);
        if (!logChannel) return;

        let embed;
        if (newMember.premiumSince) {
            // User started boosting
            embed = new EmbedBuilder()
                .setTitle('Server Boosted! 🎉')
                .setDescription(`**${newMember.user.tag}** has started boosting the server!`)
                .setThumbnail(newMember.user.displayAvatarURL({ dynamic: true }))
                .setColor(0xFF69B4) // Hot Pink (Discord Boost color)
                .setTimestamp();
        } else {
            // User stopped boosting
            embed = new EmbedBuilder()
                .setTitle('Server Boost Ended 💔')
                .setDescription(`**${newMember.user.tag}** is no longer boosting the server.`)
                .setThumbnail(newMember.user.displayAvatarURL({ dynamic: true }))
                .setColor(0x800080) // Purple
                .setTimestamp();
        }
        await logChannel.send({ embeds: [embed] }).catch(console.error);
    }
};

module.exports = {
    handleBoostUpdate
};
