const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

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
    async execute(interaction, { client, getGuildConfig, saveGuildConfig, hasPermission, isExempt, logModerationAction, karmaSystem }) { // Added 'client', 'karmaSystem'
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] }); // Defer reply ephemerally

        const targetUser = interaction.options.getUser('target');
        const reason = interaction.options.getString('reason') || 'No reason provided.';
        const moderator = interaction.user;
        const guild = interaction.guild;
        const guildConfig = await getGuildConfig(guild.id);

        // Fetch the target member to check roles
        const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

        if (!targetMember) {
            return interaction.editReply({ content: 'Could not find that user in this server.', flags: [MessageFlags.Ephemeral] });
        }

        // Check if the target is exempt
        if (isExempt(targetMember, guildConfig)) {
            return interaction.editReply({ content: 'You cannot warn this user as they are exempt from moderation.', flags: [MessageFlags.Ephemeral] });
        }

        // Removed manual guildConfig.caseNumber++ and saveGuildConfig here
        // The case number increment is now handled by logModerationAction internally.

        try {
            // Attempt to send a DM to the warned user
            const dmEmbed = new EmbedBuilder()
                .setTitle('You have been warned!')
                .setDescription(`**Server:** ${guild.name}\n**Reason:** ${reason}\n**Moderator:** ${moderator.tag}`)
                .setColor(0xFFA500)
                .setTimestamp();
            await targetUser.send({ embeds: [dmEmbed] }).catch(console.error);

            // Log the moderation action and get the case number
            const caseNumber = await logModerationAction('Warning', guild, targetUser, moderator, reason, client);

            // Record the warning in karmaSystem
            if (caseNumber) { // Only add if logging was successful and returned a case number
                const warningDetails = { timestamp: Date.now(), rule: 'Manual Warning', reason: reason, messageContent: null, caseNumber: caseNumber };
                await karmaSystem.addWarning(guild.id, targetUser.id, warningDetails, client.db, client.appId);
            }

            await interaction.editReply({ content: `Successfully warned ${targetUser.tag} for: ${reason}${caseNumber ? ` (Case #${caseNumber})` : ''}` });
        } catch (error) {
            console.error(`Error warning user ${targetUser.tag}:`, error);
            await interaction.editReply({ content: `Failed to warn ${targetUser.tag}. An error occurred. Make sure the bot has permissions and its role is above the target's highest role, and that the user's DMs are open.`, flags: [MessageFlags.Ephemeral] });
        }
    },

    // Execute function for emoji-based moderation (called from messageReactionAdd.js)
    async executeEmoji(message, targetMember, reason, moderator, { client, logModerationAction, logMessage, getGuildConfig, karmaSystem }) { // Added 'client', 'karmaSystem'
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

            // Log the moderation action and get the case number
            const caseNumber = await logModerationAction('Warning (Emoji)', guild, targetUser, moderator, reason, client);

            // Record the warning in karmaSystem
            if (caseNumber) { // Only add if logging was successful and returned a case number
                const warningDetails = { timestamp: Date.now(), rule: 'Emoji Warning', reason: reason, messageContent: message.content, caseNumber: caseNumber };
                await karmaSystem.addWarning(guild.id, targetUser.id, warningDetails, client.db, client.appId);
            }

            console.log(`Successfully warned ${targetUser.tag} via emoji for: ${reason}${caseNumber ? ` (Case #${caseNumber})` : ''}`);
        } catch (error) {
            console.error(`Error warning user ${targetUser.tag} via emoji:`, error);
        }
    }
};
