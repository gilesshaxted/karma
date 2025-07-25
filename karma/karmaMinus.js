// karma/karmaMinus.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('karma_minus')
        .setDescription('Subtracts 1 Karma point from a user.')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The user to remove Karma from')
                .setRequired(true)),
    async execute(interaction, { db, appId, getGuildConfig, hasPermission, isExempt, logModerationAction, subtractKarmaPoints }) {
        await interaction.deferReply({ ephemeral: true });

        const targetUser = interaction.options.getUser('target');
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
            const newKarma = await subtractKarmaPoints(guild.id, targetUser, 1, db, appId);

            // Log the action
            guildConfig.caseNumber++;
            await interaction.client.saveGuildConfig(guild.id, guildConfig);
            const caseNumber = guildConfig.caseNumber;

            const reason = `Manually subtracted 1 Karma point. New total: ${newKarma}`;
            await logModerationAction(guild, 'Karma Minus', targetUser, reason, moderator, caseNumber, null, null, getGuildConfig, db, appId);

            await interaction.editReply(`Successfully subtracted 1 Karma point from ${targetUser.tag}. Their new Karma total is ${newKarma}.`);

        } catch (error) {
            console.error(`Error subtracting Karma from ${targetUser.tag}:`, error);
            await interaction.editReply('Failed to subtract Karma. An error occurred.');
        }
    },
};
