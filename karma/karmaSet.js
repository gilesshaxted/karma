// karma/karmaSet.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('karma_set')
        .setDescription('Sets a user\'s Karma points to a specific total.')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The user to set Karma for')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('total')
                .setDescription('The new total Karma points')
                .setRequired(true)),
    async execute(interaction, { db, appId, getGuildConfig, hasPermission, isExempt, logModerationAction, setKarmaPoints }) {
        // interaction.deferReply() is now handled by bot.js for all slash commands.
        // So, we use editReply here.

        const targetUser = interaction.options.getUser('target');
        const newTotal = interaction.options.getInteger('total');
        const moderator = interaction.user;
        const guild = interaction.guild;
        const guildConfig = await getGuildConfig(guild.id);

        const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

        if (!targetMember) {
            return interaction.editReply('Could not find that user in this server.');
        }

        // Check if the target is exempt
        if (isExempt(targetMember, guildConfig) && targetUser.id !== moderator.id) {
            return interaction.editReply('You cannot manually adjust Karma for this user as they are exempt from moderation (unless you are adjusting your own karma).');
        }

        try {
            const oldKarmaData = await interaction.client.karmaSystem.getOrCreateUserKarma(guild.id, targetUser.id, db, appId);
            const oldKarma = oldKarmaData.karmaPoints;

            await setKarmaPoints(guild.id, targetUser, newTotal, db, appId);

            // Log the action
            guildConfig.caseNumber++;
            await interaction.client.saveGuildConfig(guild.id, guildConfig);
            const caseNumber = guildConfig.caseNumber;

            const reason = `Manually set Karma from ${oldKarma} to ${newTotal}.`;
            await logModerationAction(guild, 'Karma Set', targetUser, reason, moderator, caseNumber, null, null, getGuildConfig, db, appId);

            await interaction.editReply(`Successfully set ${targetUser.tag}'s Karma to ${newTotal}.`);

        } catch (error) {
            console.error(`Error setting Karma for ${targetUser.tag}:`, error);
            await interaction.editReply('Failed to set Karma. An error occurred.');
        }
    },
};
