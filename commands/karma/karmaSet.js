const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('karma_set')
        .setDescription('Sets a user\'s Karma points to a specific value.')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The user whose Karma to set')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('The new Karma amount')
                .setRequired(true)),
    async execute(interaction, { client, db, appId, getGuildConfig, setKarmaPoints, sendKarmaAnnouncement }) { // Added client, sendKarmaAnnouncement
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] }); // Defer reply ephemerally

        const targetUser = interaction.options.getUser('target');
        const amount = interaction.options.getInteger('amount');
        const moderator = interaction.user;
        const guild = interaction.guild;

        const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

        if (!targetMember) {
            return interaction.editReply({ content: 'Could not find that user in this server.', flags: [MessageFlags.Ephemeral] });
        }

        try {
            const oldKarma = (await client.getOrCreateUserKarma(guild.id, targetUser.id, db, appId)).karma; // Fetch old karma for logging/announcement
            const newKarma = await setKarmaPoints(guild.id, targetUser, amount, db, appId);

            // Send announcement to Karma Channel
            // Pass client.getGuildConfig and client to sendKarmaAnnouncement
            await sendKarmaAnnouncement(guild, targetUser.id, newKarma - oldKarma, newKarma, client.getGuildConfig, client);

            await interaction.editReply({ content: `Successfully set ${targetUser.tag}'s Karma to ${newKarma}.` });

        } catch (error) {
            console.error(`Error setting Karma for ${targetUser.tag}:`, error);
            await interaction.editReply({ content: 'Failed to set Karma. An error occurred.', flags: [MessageFlags.Ephemeral] });
        }
    },
};
