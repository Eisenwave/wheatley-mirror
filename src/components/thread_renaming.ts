import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { critical_error, M } from "../utils";
import { colors, rules_channel_id, skill_role_ids, thread_based_help_channel_ids, wheatley_id } from "../common";

let client: Discord.Client;

function create_embed(title: string | undefined, color: number, msg: string) {
    const embed = new Discord.MessageEmbed()
        .setColor(color)
        .setDescription(msg);
    if(title) {
        embed.setTitle(title);
    }
    return embed;
}

async function on_message(request: Discord.Message) {
    try {
        if(request.author.bot) return; // Ignore bots
        if(request.content.match(/^!rename\s+(.+)/gm)) {
            if(request.channel.isThread()) {
                const thread = request.channel;
                const owner_id = thread.type == "GUILD_PRIVATE_THREAD" ? thread.ownerId
                    : (await thread.fetchStarterMessage()).author.id;
                if(owner_id == request.author.id) {
                    const name = request.content.substring("!rename".length).trim();
                    const old_name = thread.name;
                    await thread.setName(name);
                    M.log(`Thread ${thread.id} being renamed to "${name}"`);
                    await request.delete();
                    //await request.reply({
                    //    embeds: [create_embed(undefined, colors.green, "Success :+1:")]
                    //});
                    //await request.reply({
                    //    content: "Success :+1:"
                    //});
                    // fetch first message
                    let messages = await thread.messages.fetch({
                        after: thread.id,
                        limit: 2 // thread starter message, then wheatley's message
                    });
                    for(const [_, message] of messages) {
                        if(message.type == "DEFAULT" && message.author.id == wheatley_id) {
                            message.delete();
                        }
                    }
                    // extra logic for thread-based help channels
                    if(thread.parentId && thread_based_help_channel_ids.has(thread.parentId)) {
                        // Only bother people without skill roles with this reminder
                        const owner = await thread.guild.members.fetch(owner_id);
                        if(old_name == `Help ${owner?.displayName}`) { // only if not already renamed
                            if(owner.roles.cache.filter(r => skill_role_ids.has(r.id)).size == 0) {
                                thread.send(`<@${owner_id}> Remember: Try to provide as much relevant info as possible so people can help. Use \`!howto ask\` for tips on how to ask a programming question.`);
                            }
                        }
                    }
                } else {
                    //await request.reply({
                    //    embeds: [create_embed(undefined, colors.red, "You can only rename threads you own")]
                    //});
                    await request.reply({
                        content: "You can only rename threads you own"
                    });
                }
            } else {
                //await request.reply({
                //    embeds: [create_embed(undefined, colors.red, "You can only rename threads")]
                //});
                await request.reply({
                    content: "You can only rename threads"
                });
            }
        }
    } catch(e) {
        critical_error(e);
    }
}

async function on_thread_create(thread: Discord.ThreadChannel) {
    //if(thread.parentId == rules_channel_id) {
    if(thread.ownerId == wheatley_id) { // wheatley threads are either modlogs or thread help threads
        return;
    }
    const owner = thread.type == "GUILD_PRIVATE_THREAD" ? thread.ownerId
        : (await thread.fetchStarterMessage()).author.id;
    await thread.send({
        content: `<@${owner}>`,
        embeds: [create_embed(undefined, colors.red, `Thread created, you are the owner. You can rename the thread with \`!rename <name>\``)]
    });
}

async function on_ready() {
    try {
        client.on("messageCreate", on_message);
        client.on("threadCreate", on_thread_create);
    } catch(e) {
        critical_error(e);
    }
}

export async function setup_thread_renaming(_client: Discord.Client) {
    try {
        client = _client;
        client.on("ready", on_ready);
    } catch(e) {
        critical_error(e);
    }
}
