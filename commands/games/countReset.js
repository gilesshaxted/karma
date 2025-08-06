const { SlashCommandBuilder, PermissionsBitField, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('count_reset')
        .setDescription('Resets the counting game to 0.'),
    async execute(interaction, { client, getGuildConfig, saveGuildConfig, hasPermission }) { // Added 'client' to destructuring
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] }); // Defer reply ephemerally

        const guild = interaction.guild;
        const guildConfig = await getGuildConfig(guild.id);

        // Check if the user has permission (mod/admin)
        if (!hasPermission(interaction.member, guildConfig)) {
            return interaction.editReply({ content: 'You do not have permission to reset the counting game.', flags: [MessageFlags.Ephemeral] });
        }

        if (!guildConfig.countingChannelId) {
            return interaction.editReply({ content: 'The counting channel is not set up. Please set it via the dashboard first.', flags: [MessageFlags.Ephemeral] });
        }

        try {
            // Reset count and last message ID
            guildConfig.currentCount = 0;
            guildConfig.lastCountMessageId = null;
            await saveGuildConfig(guild.id, guildConfig);

            const countingChannel = guild.channels.cache.get(guildConfig.countingChannelId);
            if (countingChannel) {
                // Remove reactions from the last known correct message if it exists and is still in cache
                if (guildConfig.lastCountMessageId) { // Check the stored ID, not a client property
                    try {
                        const lastMessage = await countingChannel.messages.fetch(guildConfig.lastCountMessageId).catch(() => null); // Fetch by ID
                        if (lastMessage) {
                            const botReaction = lastMessage.reactions.cache.get('1196558213726863491'); // Verify emoji ID
                            if (botReaction && botReaction.me) {
                                await botReaction.users.remove(client.user.id).catch(console.error); // Use client.user.id
                            }
                        }
                    } catch (error) {
                        console.warn(`Failed to remove reaction from old count message during reset:`, error);
                    }
                }
                await countingChannel.send(`The counting game has been reset to **0** by ${interaction.user.tag}. Start counting from 1!`).catch(console.error);
            }

            await interaction.editReply({ content: 'Counting game has been reset to 0.', flags: [MessageFlags.Ephemeral] });

        } catch (error) {
            console.error('Error resetting counting game:', error);
            await interaction.editReply({ content: 'Failed to reset the counting game. An error occurred.', flags: [MessageFlags.Ephemeral] });
        }
    },
};
