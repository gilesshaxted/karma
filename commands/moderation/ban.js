const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');

module.exports = {
    // Slash command data
    data: new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Bans a user from the server.')
        .addUserOption(option => // Required option first
            option.setName('target')
                .setDescription('The user to ban')
                .setRequired(true))
        .addStringOption(option => // Optional option second
            option.setName('duration')
                .setDescription('Duration of ban in days (e.g., 7) or "forever". Default: forever.')
                .setRequired(false))
        .addStringOption(option => // Optional option third
            option.setName('reason')
                .setDescription('The reason for the ban')
                .setRequired(false)),

    // Execute function for slash command
    async execute(interaction, { client, getGuildConfig, saveGuildConfig, hasPermission, isExempt, logModerationAction, logMessage }) {
        const targetUser = interaction.options.getUser('target');
        const durationInput = interaction.options.getString('duration') || 'forever'; // Default to forever
        const reason = interaction.options.getString('reason') || 'No reason provided.';
        const moderator = interaction.user;
        const guild = interaction.guild;
        const guildConfig = await getGuildConfig(guild.id);

        const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

        if (targetMember && isExempt(targetMember, guildConfig)) {
            return interaction.editReply({ content: 'You cannot ban this user as they are exempt from moderation.', flags: [MessageFlags.Ephemeral] });
        }

        let deleteMessageSeconds = 24 * 60 * 60; // Default to delete messages from the last 24 hours (1 day)
        let banDurationText = 'forever';

        if (durationInput.toLowerCase() !== 'forever') {
            const days = parseInt(durationInput);
            if (isNaN(days) || days <= 0) {
                return interaction.editReply({ content: 'Invalid duration. Please enter a number of days or "forever".', flags: [MessageFlags.Ephemeral] });
            }
            // Discord's ban message deletion is limited to 7 days (604800 seconds)
            deleteMessageSeconds = Math.min(days * 24 * 60 * 60, 7 * 24 * 60 * 60);
            banDurationText = `${days} day(s)`;
        }

        // Removed manual guildConfig.caseNumber++ and saveGuildConfig here
        // The case number increment is now handled by logModerationAction internally.

        try {
            // Fetch messages from the last 24 hours from all channels and log them
            // Note: This is a more intensive operation and might take time for large servers.
            // Discord's API for fetching messages is per channel.
            // For simplicity, we'll iterate through text channels.
            const textChannels = guild.channels.cache.filter(c => c.isTextBased() && c.viewable);
            const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
            let messagesLoggedCount = 0;

            for (const channel of textChannels.values()) {
                try {
                    const channelMessages = await channel.messages.fetch({ limit: 100 }); // Fetch recent messages
                    const messagesFromTargetInChannel = channelMessages.filter(msg =>
                        msg.author.id === targetUser.id &&
                        msg.createdTimestamp > oneDayAgo
                    );

                    for (const msg of messagesFromTargetInChannel.values()) {
                        // FIX: Pass message object directly to logMessage as it expects
                        await logMessage(msg, getGuildConfig); // logMessage expects message and getGuildConfig
                        messagesLoggedCount++;
                    }
                } catch (channelError) {
                    console.error(`Could not fetch messages from channel ${channel.name}:`, channelError);
                }
            }
            console.log(`Logged ${messagesLoggedCount} messages from ${targetUser.tag} for ban.`);


            // Attempt to send a DM to the banned user
            const dmEmbed = new EmbedBuilder()
                .setTitle('You have been banned!')
                .setDescription(`**Server:** ${guild.name}\n**Duration:** ${banDurationText}\n**Reason:** ${reason}\n**Moderator:** ${moderator.tag}`)
                .setColor(0xFFA500)
                .setTimestamp();
            await targetUser.send({ embeds: [dmEmbed] }).catch(console.error);

            await guild.members.ban(targetUser.id, {
                deleteMessageSeconds: deleteMessageSeconds,
                reason: reason
            });

            // Log the moderation action
            // FIX: Pass client object as the last parameter to logModerationAction
            await logModerationAction('Ban', guild, targetUser, moderator, reason, client); 

            await interaction.editReply({ content: `Successfully banned ${targetUser.tag} for ${banDurationText} for: ${reason}` });
        } catch (error) {
            console.error(`Error banning user ${targetUser.tag}:`, error);
            await interaction.editReply({ content: `Failed to ban ${targetUser.tag}. Make sure the bot has permissions and its role is above the target's highest role, and that the user's DMs are open.`, flags: [MessageFlags.Ephemeral] });
        }
    }
};
