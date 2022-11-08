import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { M } from "../utils";
import { TCCPP_ID } from "../common";
import { BotComponent } from "../bot_component";
import { Wheatley } from "../wheatley";

const snowflake_command_re = /!snowflake\s*(\d+)/i;
const DISCORD_EPOCH = 1420070400000;

export function decode_snowflake(snowflake_text: string) {
    const snowflake = BigInt.asUintN(64, BigInt(snowflake_text));
    return DISCORD_EPOCH + Number(snowflake >> 22n); // milliseconds
}

export function forge_snowflake(timestamp: number) {
    assert(timestamp > DISCORD_EPOCH);
    const snowflake = BigInt(timestamp - DISCORD_EPOCH) << 22n;
    return snowflake.toString();
}

export class Snowflake extends BotComponent {
    constructor(wheatley: Wheatley) {
        super(wheatley);
    }

    override async on_message_create(message: Discord.Message) {
        if(message.author.id == this.wheatley.client.user!.id) return; // Ignore self
        if(message.author.bot) return; // Ignore bots
        if(message.guildId != TCCPP_ID) return; // Ignore messages outside TCCPP (e.g. dm's)
        const match = message.content.match(snowflake_command_re);
        if(match != null) {
            assert(match.length == 2);
            const timestamp = decode_snowflake(match[1]);
            const reply = await message.channel.send(`<t:${Math.round(timestamp / 1000)}>`);
            this.wheatley.deletable.make_message_deletable(message, reply);
        }
    }
}
