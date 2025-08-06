const { SlashCommandBuilder, PermissionsBitField, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('count_set')
        .setDescription('Sets the counting game to a specific number.')
        .addIntegerOption(option =>
            option.setName('number')
                .setDescription('The number to set the count to')
                .setRequired(true)),
    async execute(interaction, { client, getGuildConfig, saveGuildConfig, hasPermission }) { // Added 'client' to destructuring
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] }); // Defer reply ephemerally

        const newNumber = interaction.options.getInteger('number');
        const guild = interaction.guild;
        const guildConfig = await getGuildConfig(guild.id);

        // Check if the user has permission (mod/admin)
        if (!hasPermission(interaction.member, guildConfig)) {
            return interaction.editReply({ content: 'You do not have permission to set the counting game.', flags: [MessageFlags.Ephemeral] });
        }

        if (!guildConfig.countingChannelId) {
            return interaction.editReply({ content: 'The counting channel is not set up. Please set it via the dashboard first.', flags: [MessageFlags.Ephemeral] });
        }

        if (newNumber < 0) {
            return interaction.editReply({ content: 'The count cannot be set to a negative number.', flags: [MessageFlags.Ephemeral] });
        }

        try {
            // Remove reaction from previous message if it exists
            if (guildConfig.lastCountMessageId) {
                try {
                    const countingChannel = guild.channels.cache.get(guildConfig.countingChannelId);
                    if (countingChannel) {
                        const lastMessage = await countingChannel.messages.fetch(guildConfig.lastCountMessageId).catch(() => null); // Catch if message not found
                        if (lastMessage) {
                            const botReaction = lastMessage.reactions.cache.get('1196558213726863491'); // Verify emoji ID
                            if (botReaction && botReaction.me) {
                                await botReaction.users.remove(client.user.id).catch(console.error); // Use client.user.id
                            }
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

            await interaction.editReply({ content: `Counting game has been set to ${newNumber}.`, flags: [MessageFlags.Ephemeral] });

        } catch (error) {
            console.error('Error setting counting game:', error);
            await interaction.editReply({ content: 'Failed to set the counting game. An error occurred.', flags: [MessageFlags.Ephemeral] });
        }
    },
};
