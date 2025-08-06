const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

// Function to parse duration string (e.g., "1h", "30m", "2d") to milliseconds
function parseDuration(durationString) {
    const unit = durationString.slice(-1).toLowerCase();
    const value = parseInt(durationString.slice(0, -1));

    if (isNaN(value)) {
        return null;
    }

    switch (unit) {
        case 'm': // Minutes
            return value * 60 * 1000;
        case 'h': // Hours
            return value * 60 * 60 * 1000;
        case 'd': // Days
            return value * 24 * 60 * 60 * 1000;
        default:
            return null; // Invalid unit
    }
}

module.exports = {
    // Slash command data
    data: new SlashCommandBuilder()
        .setName('timeout')
        .setDescription('Puts a user in timeout.')
        .addUserOption(option => // Required option first
            option.setName('target')
                .setDescription('The user to timeout')
                .setRequired(true))
        .addStringOption(option => // Optional option second
            option.setName('duration')
                .setDescription('Duration of timeout (e.g., 30m, 1h, 2d). Default: 1h.')
                .setRequired(false))
        .addStringOption(option => // Optional option third
            option.setName('reason')
                .setDescription('The reason for the timeout')
                .setRequired(false)),

    // Execute function for slash command
    async execute(interaction, { client, getGuildConfig, saveGuildConfig, hasPermission, isExempt, logModerationAction, logMessage, karmaSystem }) { // Added 'client', 'karmaSystem'
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] }); // Defer reply ephemerally

        const targetUser = interaction.options.getUser('target');
        const durationString = interaction.options.getString('duration') || '1h'; // Default to 1 hour
        const reason = interaction.options.getString('reason') || 'No reason provided.';
        const moderator = interaction.user;
        const guild = interaction.guild;
        const guildConfig = await getGuildConfig(guild.id);

        const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

        if (!targetMember) {
            return interaction.editReply({ content: 'Could not find that user in this server.', flags: [MessageFlags.Ephemeral] });
        }

        // Check if the target is exempt
        if (isExempt(targetMember, guildConfig)) {
            return interaction.editReply({ content: 'You cannot timeout this user as they are exempt from moderation.', flags: [MessageFlags.Ephemeral] });
        }

        const durationMs = parseDuration(durationString);

        if (durationMs === null) {
            return interaction.editReply({ content: 'Invalid duration format. Please use formats like `30m`, `1h`, `2d`.', flags: [MessageFlags.Ephemeral] });
        }

        // Discord's timeout limit is 28 days (2,419,200,000 milliseconds)
        const maxTimeoutMs = 28 * 24 * 60 * 60 * 1000;
        if (durationMs > maxTimeoutMs) {
            return interaction.editReply({ content: 'Timeout duration cannot exceed 28 days.', flags: [MessageFlags.Ephemeral] });
        }

        // Removed manual guildConfig.caseNumber++ and saveGuildConfig here
        // The case number increment is now handled by logModerationAction internally.

        try {
            await targetMember.timeout(durationMs, reason);

            // Attempt to send a DM to the timed out user
            const dmEmbed = new EmbedBuilder()
                .setTitle('You have been timed out!')
                .setDescription(`**Server:** ${guild.name}\n**Duration:** ${durationString}\n**Reason:** ${reason}\n**Moderator:** ${moderator.tag}`)
                .setColor(0xFFA500)
                .setTimestamp();
            await targetUser.send({ embeds: [dmEmbed] }).catch(console.error);

            // Log the moderation action and get the case number
            const caseNumber = await logModerationAction('Timeout', guild, targetUser, moderator, reason, client);

            // Record the timeout in karmaSystem
            if (caseNumber) { // Only add if logging was successful and returned a case number
                const timeoutDetails = { timestamp: Date.now(), duration: durationString, caseNumber: caseNumber };
                await karmaSystem.addTimeout(guild.id, targetUser.id, timeoutDetails, client.db, client.appId);
            }

            await interaction.editReply({ content: `Successfully timed out ${targetUser.tag} for ${durationString} for: ${reason}${caseNumber ? ` (Case #${caseNumber})` : ''}` });
        } catch (error) {
            console.error(`Error timing out user ${targetUser.tag}:`, error);
            await interaction.editReply({ content: `Failed to timeout ${targetUser.tag}. Make sure the bot has permissions and its role is above the target's highest role, and that the user's DMs are open.`, flags: [MessageFlags.Ephemeral] });
        }
    },

    // Execute function for emoji-based moderation (called from messageReactionAdd.js)
    async executeEmoji(message, targetMember, durationMinutes, reason, moderator, caseNumber, { client, logModerationAction, logMessage, getGuildConfig, karmaSystem }) { // Added 'client', 'karmaSystem'
        const guild = message.guild;
        const targetUser = targetMember.user;
        const durationMs = durationMinutes * 60 * 1000;

        try {
            await targetMember.timeout(durationMs, reason);

            // Attempt to send a DM to the timed out user
            const dmEmbed = new EmbedBuilder()
                .setTitle('You have been timed out!')
                .setDescription(`**Server:** ${guild.name}\n**Duration:** ${durationMinutes} minutes\n**Reason:** ${reason}\n**Moderator:** ${moderator.tag}`)
                .setColor(0xFFA500)
                .setTimestamp();
            await targetUser.send({ embeds: [dmEmbed] }).catch(console.error);

            // Log the moderation action (caseNumber is passed from messageReactionAdd)
            const loggedCaseNumber = await logModerationAction('Timeout (Emoji)', guild, targetUser, moderator, reason, client);

            // Record the timeout in karmaSystem
            if (loggedCaseNumber) { // Use the case number returned by logModerationAction
                const timeoutDetails = { timestamp: Date.now(), duration: `${durationMinutes}m`, caseNumber: loggedCaseNumber };
                await karmaSystem.addTimeout(guild.id, targetUser.id, timeoutDetails, client.db, client.appId);
            }

            console.log(`Successfully timed out ${targetUser.tag} via emoji for ${durationMinutes} minutes for: ${reason} (Case #${loggedCaseNumber || caseNumber})`);
        } catch (error) {
            console.error(`Error timing out user ${targetUser.tag} via emoji:`, error);
        }
    }
};
