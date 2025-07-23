// moderation/timeout.js
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js'); // Added MessageFlags

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
    async execute(interaction, { getGuildConfig, saveGuildConfig, hasPermission, isExempt, logModerationAction, MessageFlags }) { // Received MessageFlags
        const targetUser = interaction.options.getUser('target');
        const durationString = interaction.options.getString('duration') || '1h'; // Default to 1 hour
        const reason = interaction.options.getString('reason') || 'No reason provided.';
        const moderator = interaction.user;
        const guild = interaction.guild;
        const guildConfig = await getGuildConfig(guild.id); // Await config fetch

        const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

        if (!targetMember) {
            return interaction.editReply({ content: 'Could not find that user in this server.' });
        }

        // Check if the target is exempt
        if (isExempt(targetMember, guildConfig)) {
            return interaction.editReply({ content: 'You cannot timeout this user as they are exempt from moderation.' });
        }

        const durationMs = parseDuration(durationString);

        if (durationMs === null) {
            return interaction.editReply({ content: 'Invalid duration format. Please use formats like `30m`, `1h`, `2d`.' });
        }

        // Discord's timeout limit is 28 days (2,419,200,000 milliseconds)
        const maxTimeoutMs = 28 * 24 * 60 * 60 * 1000;
        if (durationMs > maxTimeoutMs) {
            return interaction.editReply({ content: 'Timeout duration cannot exceed 28 days.' });
        }

        guildConfig.caseNumber++;
        await saveGuildConfig(guild.id, guildConfig); // Await save
        const caseNumber = guildConfig.caseNumber;

        try {
            await targetMember.timeout(durationMs, reason);

            // Attempt to send a DM to the timed out user
            const dmEmbed = new EmbedBuilder()
                .setTitle('You have been timed out!')
                .setDescription(`**Server:** ${guild.name}\n**Duration:** ${durationString}\n**Reason:** ${reason}\n**Moderator:** ${moderator.tag}`)
                .setColor(0xFFA500)
                .setTimestamp();
            await targetUser.send({ embeds: [dmEmbed] }).catch(console.error);

            // Log the moderation action
            await logModerationAction(guild, `Timeout (${durationString})`, targetUser, reason, moderator, caseNumber);

            await interaction.editReply({ content: `Successfully timed out ${targetUser.tag} for ${durationString} for: ${reason} (Case #${caseNumber})` });
        } catch (error) {
            console.error(`Error timing out user ${targetUser.tag}:`, error);
            await interaction.editReply({ content: `Failed to timeout ${targetUser.tag}. Make sure the bot has permissions and its role is above the target's highest role, and that the user's DMs are open.` });
        }
    },

    // Execute function for emoji-based moderation
    async executeEmoji(message, targetMember, durationMinutes, reason, moderator, caseNumber, { logModerationAction, logMessage }) {
        const guild = message.guild;
        const targetUser = targetMember.user;
        const durationMs = durationMinutes * 60 * 1000; // Convert minutes to milliseconds

        try {
            await targetMember.timeout(durationMs, reason);

            // Attempt to send a DM to the timed out user
            const dmEmbed = new EmbedBuilder()
                .setTitle('You have been timed out!')
                .setDescription(`**Server:** ${guild.name}\n**Duration:** ${durationMinutes} minutes\n**Reason:** ${reason}\n**Moderator:** ${moderator.tag}`)
                .setColor(0xFFA500)
                .setTimestamp();
            await targetUser.send({ embeds: [dmEmbed] }).catch(console.error);

            // Log the moderation action
            await logModerationAction(guild, `Timeout (Emoji - ${durationMinutes}m)`, targetUser, reason, moderator, caseNumber);

            console.log(`Successfully timed out ${targetUser.tag} via emoji for ${durationMinutes} minutes for: ${reason} (Case #${caseNumber})`);
        } catch (error) {
            console.error(`Error timing out user ${targetUser.tag} via emoji:`, error);
        }
    }
};
