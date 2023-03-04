import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { critical_error, index_of_first_not_satisfying, is_image_link_embed, M } from "../utils.js";
import { colors, MINUTE, TCCPP_ID } from "../common.js";
import { decode_snowflake, forge_snowflake } from "./snowflake.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { TextBasedCommand, TextBasedCommandBuilder } from "../command.js";

// https://discord.com/channels/331718482485837825/802541516655951892/877257002584252426
//                              guild              channel            message
// Discord uses many domains and subdomains:
// - discord.com
// - ptb.discord.com
// - canary.discord.com
// - discordapp.com
// - and maybe more and I'm sure they'll use others in the future
// We'll just match anything containing `discord` followed by /channels/id/id/id
const raw_url_re = /https:\/\/(.*discord.*)\/channels\/(\d+)\/(\d+)\/(\d+)/;
const known_domains = new Set([
    "discord.com",
    "ptb.discord.com",
    "canary.discord.com",
    "discordapp.com",
]);
export const url_re = new RegExp(`^${raw_url_re.source}$`, "i");
const implicit_quote_re = new RegExp(`\\[${raw_url_re.source}(b?)\\]`, "gi");

const color = 0x7E78FE; //0xA931FF;

type QuoteDescriptor = {
    domain: string;
    channel_id: string;
    message_id: string;
    block: boolean;
};

// TODO: Redundant with server_suggestion_tracker
async function get_display_name(thing: Discord.Message | Discord.User, wheatley: Wheatley): Promise<string> {
    if(thing instanceof Discord.User) {
        const user = thing;
        try {
            return (await wheatley.TCCPP.members.fetch(user.id)).displayName;
        } catch {
            // user could potentially not be in the server
            return user.tag;
        }
    } else if(thing instanceof Discord.Message) {
        const message = thing;
        if(message.member == null) {
            return get_display_name(message.author, wheatley);
        } else {
            return message.member.displayName;
        }
    } else {
        assert(false);
    }
}

export async function make_quote_embeds(
    messages: Discord.Message[], requested_by: Discord.GuildMember | undefined, wheatley: Wheatley, safe_link: boolean
) {
    assert(messages.length >= 1);
    const head = messages[0];
    const contents = messages.map(m => m.content).join("\n");
    const embed = new Discord.EmbedBuilder()
        .setColor(color)
        .setAuthor({
            name: `${await get_display_name(head, wheatley)}`,
            iconURL: head.member?.avatarURL() ?? head.author.displayAvatarURL()
        })
        .setDescription(contents + `\n\nFrom <#${head.channel.id}> [[Jump to message]](${head.url})` + (
            safe_link ? "" : " ⚠️ Unexpected domain, be careful clicking this link"
        ))
        .setTimestamp(head.createdAt);
    if(requested_by) {
        embed.setFooter({
            text: `Quoted by ${requested_by.displayName}`,
            iconURL: requested_by.user.displayAvatarURL()
        });
    }
    const images = messages.map(message => [
        ...message.attachments.filter(a => a.contentType?.indexOf("image") == 0).map(a => a.url),
        ...message.embeds.filter(is_image_link_embed).map(e => e.url!)
    ]).flat();
    const other_embeds = messages.map(message => message.embeds.filter(e => !is_image_link_embed(e))).flat();
    const image_embeds: Discord.EmbedBuilder[] = [];
    if(images.length > 0) {
        embed.setImage(images[0]);
        for(const image of images.slice(1)) {
            image_embeds.push(new Discord.EmbedBuilder({
                image: {
                    url: image
                }
            }));
        }
    }
    return [ embed, ...image_embeds, ...other_embeds ];
}

export class Quote extends BotComponent {
    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new TextBasedCommandBuilder([ "quote", "quoteb" ])
                .set_description([ "Quote a message", "Quote a block of messages" ])
                .add_string_option({
                    title: "url",
                    description: "url",
                    required: true
                })
                .set_handler(this.quote.bind(this))
        );
    }

    async quote(command: TextBasedCommand, url: string) {
        const match = url.trim().match(url_re);
        if(match != null) {
            M.log("Received quote command", command.user.tag, command.user.id, url, command.get_or_forge_url());
            assert(match.length == 5);
            const [ domain, guild_id, channel_id, message_id ] = match.slice(1);
            if(guild_id == TCCPP_ID) {
                await this.do_quote(command, [{
                    domain,
                    channel_id,
                    message_id,
                    block: command.name == "quoteb"
                }]);
            } else {
                await command.reply({
                    embeds: [
                        new Discord.EmbedBuilder()
                            .setDescription("Error: Can only quote from TCCPP")
                            .setColor(colors.red)
                    ],
                    ephemeral_if_possible: true
                });
            }
        } else {
            await command.reply({
                embeds: [
                    new Discord.EmbedBuilder()
                        .setDescription("Usage: `!quote <url>`\n"
                                      + "`!quoteb` can be used to quote a continuous block of messages")
                        .setColor(colors.red)
                ],
                ephemeral_if_possible: true
            });
        }
    }

    override async on_message_create(message: Discord.Message) {
        if(message.author.id == this.wheatley.client.user!.id) return; // Ignore self
        if(message.author.bot) return; // Ignore bots
        if(message.guildId != TCCPP_ID) return; // Ignore messages outside TCCPP (e.g. dm's)
        if(message.content.includes("[https://")) {
            // if the message might contain a link, look at it
            const quote_descriptors = [...message.content.matchAll(implicit_quote_re)]
                .filter(([ _, guild_id ]) => guild_id == TCCPP_ID)
                .map(arr => arr.slice(2))
                .map(([ domain, channel_id, message_id, block_flag ]) => ({
                    domain,
                    channel_id,
                    message_id,
                    block: block_flag == "b"
                }));
            if(quote_descriptors.length >= 1) {
                M.log(
                    "Implicit quote request",
                    message.author.tag,
                    message.author.id,
                    ...quote_descriptors.map(d => `${d.channel_id}/${d.message_id}` + (d.block ? " block" : "")),
                    message.url
                );
                const command = new TextBasedCommand("quote", message, this.wheatley);
                await this.do_quote(command, quote_descriptors);
                const reply = command.get_reply();
                assert(reply instanceof Discord.Message);
                this.wheatley.make_deletable(message, reply);
                await message.suppressEmbeds();
            }
        }
    }

    async do_quote(command: TextBasedCommand, messages: QuoteDescriptor[]) {
        const embeds: (Discord.EmbedBuilder | Discord.Embed)[] = [];
        for(const { domain, channel_id, message_id, block } of messages) {
            const channel = await this.wheatley.TCCPP.channels.fetch(channel_id);
            if(channel instanceof Discord.TextChannel
            || channel instanceof Discord.ThreadChannel
            || channel instanceof Discord.NewsChannel) {
                const member = await command.get_member();
                const permissions = [
                    channel.permissionsFor(member).has(Discord.PermissionsBitField.Flags.ViewChannel),
                    channel.permissionsFor(member).has(Discord.PermissionsBitField.Flags.ReadMessageHistory),
                ];
                if(!permissions.every(b => b)) {
                    embeds.push(
                        new Discord.EmbedBuilder()
                            .setColor(colors.red)
                            .setDescription("Error: You don't have permissions for that channel")
                    );
                    this.wheatley.zelis.send("quote exploit attempt");
                    continue;
                }
                let messages: Discord.Message[] = [];
                if(block) {
                    const fetched_messages = (await channel.messages.fetch({
                        after: forge_snowflake(decode_snowflake(message_id) - 1),
                        limit: 50
                    })).map(m => m).reverse();
                    const start_time = fetched_messages.length > 0 ? fetched_messages[0].createdTimestamp : undefined;
                    const end = index_of_first_not_satisfying(fetched_messages,
                                                              m => m.author.id == fetched_messages[0].author.id
                                                                   && m.createdTimestamp - start_time! <= 60 * MINUTE);
                    messages = fetched_messages.slice(0, end == -1 ? fetched_messages.length : end);
                } else {
                    const quote_message = await channel.messages.fetch(message_id);
                    messages = [quote_message];
                }
                assert(messages.length >= 1);
                const quote_embeds = await make_quote_embeds(
                    messages,
                    member,
                    this.wheatley,
                    known_domains.has(domain)
                );
                embeds.push(...quote_embeds);
            } else {
                embeds.push(
                    new Discord.EmbedBuilder()
                        .setColor(colors.red)
                        .setDescription("Error: Channel not a text channel")
                );
                critical_error("Error: Channel not a text channel");
            }
        }
        if(embeds.length > 0) {
            await command.reply({ embeds: embeds });
            // log
            // TODO: Can probably improve how this is done. Figure out later.
            /*this.wheatley.staff_message_log.send({
                content: "Message quoted"
                        + `\nIn <#${command.channel_id}> ${command.get_or_forge_url()}`
                        + `\nFrom <#${channel_id}> ${messages[0].url}`
                        + `\nBy ${command.user.tag} ${command.user.id}`,
                embeds
            });*/
        } else {
            throw "No quote embeds";
        }
    }
}
