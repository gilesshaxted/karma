// moderation/warn.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    // Slash command data
    data: new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Warns a user.')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The user to warn')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('The reason for the warning')
                .setRequired(false)), // Reason is optional

    // Execute function for slash command
    async execute(interaction, { getGuildConfig, saveGuildConfig, hasPermission, isExempt, logModerationAction }) {
        const targetUser = interaction.options.getUser('target');
        const reason = interaction.options.getString('reason') || 'No reason provided.';
        const moderator = interaction.user;
        const guild = interaction.guild;
        const guildConfig = await getGuildConfig(guild.id);

        // Fetch the target member to check roles
        const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

        if (!targetMember) {
            return interaction.editReply({ content: 'Could not find that user in this server.' });
        }

        // Check if the target is exempt
        if (isExempt(targetMember, guildConfig)) {
            return interaction.editReply({ content: 'You cannot warn this user as they are exempt from moderation.' });
        }

        guildConfig.caseNumber++;
        await saveGuildConfig(guild.id, guildConfig);
        const caseNumber = guildConfig.caseNumber;

        try {
            // Attempt to send a DM to the warned user
            const dmEmbed = new EmbedBuilder()
                .setTitle('You have been warned!')
                .setDescription(`**Server:** ${guild.name}\n**Reason:** ${reason}\n**Moderator:** ${moderator.tag}`)
                .setColor(0xFFA500)
                .setTimestamp();
            await targetUser.send({ embeds: [dmEmbed] }).catch(console.error);

            // Log the moderation action (passing getGuildConfig, db, appId from index.js via interaction.client context)
            await logModerationAction(guild, 'Warning', targetUser, reason, moderator, caseNumber, null, null, getGuildConfig, interaction.client.db, interaction.client.appId);

            await interaction.editReply({ content: `Successfully warned ${targetUser.tag} for: ${reason} (Case #${caseNumber})` });
        } catch (error) {
            console.error(`Error warning user ${targetUser.tag}:`, error);
            await interaction.editReply({ content: `Failed to warn ${targetUser.tag}. An error occurred. Make sure the bot has permissions and its role is above the target's highest role, and that the user's DMs are open.` });
        }
    },

    // Execute function for emoji-based moderation
    async executeEmoji(message, targetMember, reason, moderator, caseNumber, { logModerationAction, logMessage, getGuildConfig, db, appId }) { // Added getGuildConfig, db, appId
        const guild = message.guild;
        const targetUser = targetMember.user;

        try {
            // Attempt to send a DM to the warned user
            const dmEmbed = new EmbedBuilder()
                .setTitle('You have been warned!')
                .setDescription(`**Server:** ${guild.name}\n**Reason:** ${reason}\n**Moderator:** ${moderator.tag}`)
                .setColor(0xFFA500)
                .setTimestamp();
            await targetUser.send({ embeds: [dmEmbed] }).catch(console.error);

            // Log the moderation action (passing getGuildConfig, db, appId)
            await logModerationAction(guild, 'Warning (Emoji)', targetUser, reason, moderator, caseNumber, null, message.url, getGuildConfig, db, appId);

            console.log(`Successfully warned ${targetUser.tag} via emoji for: ${reason} (Case #${caseNumber})`);
        } catch (error) {
            console.error(`Error warning user ${targetUser.tag} via emoji:`, error);
        }
    }
};
