// games/countSet.js
const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('count_set')
        .setDescription('Sets the counting game to a specific number.')
        .addIntegerOption(option =>
            option.setName('number')
                .setDescription('The number to set the count to')
                .setRequired(true)),
    async execute(interaction, { getGuildConfig, saveGuildConfig, hasPermission }) {
        // interaction.deferReply() is now handled by index.js for all slash commands.
        // REMOVED: await interaction.deferReply({ ephemeral: true });

        const newNumber = interaction.options.getInteger('number');
        const guild = interaction.guild;
        const guildConfig = await getGuildConfig(guild.id);

        // Check if the user has permission (mod/admin)
        if (!hasPermission(interaction.member, guildConfig)) {
            return interaction.editReply('You do not have permission to set the counting game.');
        }

        if (!guildConfig.countingChannelId) {
            return interaction.editReply('The counting channel is not set up. Please set it via the dashboard first.');
        }

        if (newNumber < 0) {
            return interaction.editReply('The count cannot be set to a negative number.');
        }

        try {
            // Remove reaction from previous message if it exists
            if (guildConfig.lastCountMessageId) {
                try {
                    const countingChannel = guild.channels.cache.get(guildConfig.countingChannelId);
                    if (countingChannel) {
                        const lastMessage = await countingChannel.messages.fetch(guildConfig.lastCountMessageId);
                        const botReaction = lastMessage.reactions.cache.get('1196558213726863491'); // Verify emoji ID
                        if (botReaction && botReaction.me) {
                            await botReaction.users.remove(interaction.client.user.id);
                        }
                    }
                } catch (error) {
                    console.warn(`Failed to remove reaction from old count message during set:`, error);
                }
            }

            // Update count and clear last message ID (new message will get reaction)
            guildConfig.currentCount = newNumber;
            guildConfig.lastCountMessageId = null; // Clear last message ID as this is a manual set, not a new count
            await saveGuildConfig(guild.id, guildConfig);

            const countingChannel = guild.channels.cache.get(guildConfig.countingChannelId);
            if (countingChannel) {
                await countingChannel.send(`The counting game has been manually set to **${newNumber}** by ${interaction.user.tag}. The next number is ${newNumber + 1}!`).catch(console.error);
            }

            await interaction.editReply(`Counting game has been set to ${newNumber}.`);

        } catch (error) {
            console.error('Error setting counting game:', error);
            await interaction.editReply('Failed to set the counting game. An error occurred.');
        }
    },
};
