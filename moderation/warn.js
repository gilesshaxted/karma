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
        const guildConfig = await getGuildConfig(guild.id); // Await config fetch

        // Fetch the target member to check roles
        const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

        if (!targetMember) {
            return interaction.reply({ content: 'Could not find that user in this server.', ephemeral: true });
        }

        // Check if the target is exempt
        if (isExempt(targetMember, guildConfig)) {
            return interaction.reply({ content: 'You cannot warn this user as they are exempt from moderation.', ephemeral: true });
        }

        guildConfig.caseNumber++;
        await saveGuildConfig(guild.id, guildConfig); // Await save
        const caseNumber = guildConfig.caseNumber;

        try {
            // Attempt to send a DM to the warned user
            const dmEmbed = new EmbedBuilder()
                .setTitle('You have been warned!')
                .setDescription(`**Server:** ${guild.name}\n**Reason:** ${reason}\n**Moderator:** ${moderator.tag}`)
                .setColor(0xFFA500)
                .setTimestamp();
            await targetUser.send({ embeds: [dmEmbed] }).catch(console.error); // Catch DM errors silently

            // Log the moderation action
            await logModerationAction(guild, 'Warning', targetUser, reason, moderator, caseNumber);

            await interaction.reply({ content: `Successfully warned ${targetUser.tag} for: ${reason} (Case #${caseNumber})`, ephemeral: true });
        } catch (error) {
            console.error(`Error warning user ${targetUser.tag}:`, error);
            await interaction.reply({ content: `Failed to warn ${targetUser.tag}. An error occurred.`, ephemeral: true });
        }
    },

    // Execute function for emoji-based moderation
    async executeEmoji(message, targetMember, reason, moderator, caseNumber, { logModerationAction, logMessage }) {
        const guild = message.guild;
        const targetUser = targetMember.user;

        try {
            // Attempt to send a DM to the warned user
            const dmEmbed = new EmbedBuilder()
                .setTitle('You have been warned!')
                .setDescription(`**Server:** ${guild.name}\n**Reason:** ${reason}\n**Moderator:** ${moderator.tag}`)
                .setColor(0xFFA500)
                .setTimestamp();
            await targetUser.send({ embeds: [dmEmbed] }).catch(console.error); // Catch DM errors silently

            // Log the moderation action
            await logModerationAction(guild, 'Warning (Emoji)', targetUser, reason, moderator, caseNumber);

            console.log(`Successfully warned ${targetUser.tag} via emoji for: ${reason} (Case #${caseNumber})`);
        } catch (error) {
            console.error(`Error warning user ${targetUser.tag} via emoji:`, error);
        }
    }
};
