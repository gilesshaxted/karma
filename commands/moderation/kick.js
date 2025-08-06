const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
    // Slash command data
    data: new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kicks a user from the server.')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The user to kick')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('The reason for the kick')
                .setRequired(false)),

    // Execute function for slash command
    async execute(interaction, { client, getGuildConfig, saveGuildConfig, hasPermission, isExempt, logModerationAction, logMessage }) { // Added 'client' to destructuring
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] }); // Defer reply ephemerally

        const targetUser = interaction.options.getUser('target');
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
            return interaction.editReply({ content: 'You cannot kick this user as they are exempt from moderation.', flags: [MessageFlags.Ephemeral] });
        }

        // Removed manual guildConfig.caseNumber++ and saveGuildConfig here
        // The case number increment is now handled by logModerationAction internally.

        try {
            // Delete messages from the last 24 hours
            const textChannels = guild.channels.cache.filter(c => c.isTextBased() && c.viewable);
            const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
            let messagesLoggedCount = 0;

            for (const channel of textChannels.values()) {
                try {
                    const channelMessages = await channel.messages.fetch({ limit: 100 }); // Fetch recent messages
                    const messagesFromTargetInChannel = channelMessages.filter(msg =>
                        msg.author.id === targetUser.id &&
                        (Date.now() - msg.createdTimestamp) < (24 * 60 * 60 * 1000) // Last 24 hours
                    );

                    for (const msg of messagesFromTargetInChannel.values()) {
                        if (msg.deletable) {
                            await msg.delete().catch(console.error);
                            // FIX: Pass message object and getGuildConfig to logMessage
                            await logMessage(msg, getGuildConfig); // logMessage expects message and getGuildConfig
                            messagesLoggedCount++;
                        }
                    }
                    console.log(`Deleted ${messagesFromTargetInChannel.size} messages from ${targetUser.tag} for kick in channel ${channel.name}.`);
                } catch (channelError) {
                    console.error(`Could not fetch messages from channel ${channel.name}:`, channelError);
                }
            }
            console.log(`Logged ${messagesLoggedCount} messages from ${targetUser.tag} for ban.`);


            // Attempt to send a DM to the kicked user
            const dmEmbed = new EmbedBuilder()
                .setTitle('You have been kicked!')
                .setDescription(`**Server:** ${guild.name}\n**Reason:** ${reason}\n**Moderator:** ${moderator.tag}`)
                .setColor(0xFFA500)
                .setTimestamp();
            await targetUser.send({ embeds: [dmEmbed] }).catch(console.error);

            await targetMember.kick(reason);

            // Log the moderation action
            // FIX: Pass client object as the last parameter to logModerationAction
            await logModerationAction('Kick', guild, targetUser, moderator, reason, client); 

            await interaction.editReply({ content: `Successfully kicked ${targetUser.tag} for: ${reason}` });
        } catch (error) {
            console.error(`Error kicking user ${targetUser.tag}:`, error);
            await interaction.editReply({ content: `Failed to kick ${targetUser.tag}. Make sure the bot has permissions and its role is above the target's highest role, and that the user's DMs are open.`, flags: [MessageFlags.Ephemeral] });
        }
    },

    // Execute function for emoji-based moderation (called from messageReactionAdd.js)
    async executeEmoji(message, targetMember, reason, moderator, caseNumber, { client, logModerationAction, logMessage, getGuildConfig }) { // Added 'client' and 'getGuildConfig'
        const guild = message.guild;
        const targetUser = targetMember.user;

        try {
            // Delete messages from the last 24 hours (from the channel where the emoji was reacted)
            const messagesToDelete = await message.channel.messages.fetch({ limit: 100 }); // Fetch recent messages
            const messagesFromTarget = messagesToDelete.filter(msg =>
                msg.author.id === targetUser.id &&
                (Date.now() - msg.createdTimestamp) < (24 * 60 * 60 * 1000) // Last 24 hours
            );

            if (messagesFromTarget.size > 0) {
                for (const msg of messagesFromTarget.values()) {
                    if (msg.deletable) {
                        await msg.delete().catch(console.error);
                        // FIX: Pass message object and getGuildConfig to logMessage
                        await logMessage(msg, getGuildConfig);
                    }
                }
                console.log(`Deleted ${messagesFromTarget.size} messages from ${targetUser.tag} for emoji kick.`);
            }

            // Attempt to send a DM to the kicked user
            const dmEmbed = new EmbedBuilder()
                .setTitle('You have been kicked!')
                .setDescription(`**Server:** ${guild.name}\n**Reason:** ${reason}\n**Moderator:** ${moderator.tag}`)
                .setColor(0xFFA500)
                .setTimestamp();
            await targetUser.send({ embeds: [dmEmbed] }).catch(console.error);

            await targetMember.kick(reason);

            // Log the moderation action
            // FIX: Pass client object as the last parameter to logModerationAction
            await logModerationAction('Kick (Emoji)', guild, targetUser, moderator, reason, client);

            console.log(`Successfully kicked ${targetUser.tag} via emoji for: ${reason} (Case #${caseNumber})`);
        } catch (error) {
            console.error(`Error kicking user ${targetUser.tag} via emoji:`, error);
        }
    }
};
