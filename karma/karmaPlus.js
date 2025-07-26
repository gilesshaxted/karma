// karma/karmaPlus.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('karma_plus')
        .setDescription('Adds 1 Karma point to a user.')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The user to give Karma to')
                .setRequired(true)),
    async execute(interaction, { db, appId, getGuildConfig, hasPermission, isExempt, logModerationAction, addKarmaPoints }) {
        // interaction.deferReply() is now handled by bot.js for all slash commands.
        // So, we use editReply here.

        const targetUser = interaction.options.getUser('target');
        const moderator = interaction.user;
        const guild = interaction.guild;
        const guildConfig = await getGuildConfig(guild.id);

        const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

        if (!targetMember) {
            return interaction.editReply('Could not find that user in this server.');
        }

        // Check if the target is exempt (moderators/admins should not have karma manually adjusted by others)
        if (isExempt(targetMember, guildConfig) && targetUser.id !== moderator.id) {
            return interaction.editReply('You cannot manually adjust Karma for this user as they are exempt from moderation (unless you are adjusting your own karma).');
        }

        try {
            const newKarma = await addKarmaPoints(guild.id, targetUser, 1, db, appId);

            // Log the action (using the bot's own case number system if desired, or a separate log)
            guildConfig.caseNumber++;
            await interaction.client.saveGuildConfig(guild.id, guildConfig); // Use client's saveGuildConfig
            const caseNumber = guildConfig.caseNumber;

            const reason = `Manually added 1 Karma point. New total: ${newKarma}`;
            await logModerationAction(guild, 'Karma Plus', targetUser, reason, moderator, caseNumber, null, null, getGuildConfig, db, appId);

            await interaction.editReply(`Successfully added 1 Karma point to ${targetUser.tag}. Their new Karma total is ${newKarma}.`);

        } catch (error) {
            console.error(`Error adding Karma to ${targetUser.tag}:`, error);
            await interaction.editReply('Failed to add Karma. An error occurred.');
        }
    },
};
