import * as _ from "lodash";
import * as Discord from 'discord.js';
import { FCMemcache } from './FCMemcache'
import { GuildWorker } from './GuildWorker'
import { FCMongo } from './FCMongo';

require('dotenv').config()

export class FCBot {

    public static readonly NEEDS_PERMISSIONS = 18432;

    discord: Discord.Client;
    memcache: FCMemcache;
    mongo: FCMongo;
    workers: _.Dictionary<GuildWorker> = {};

    constructor() {
        this.memcache = new FCMemcache();
        this.mongo = new FCMongo();

        this.discord = new Discord.Client();

        // attach events
        this.discord.on('message', this.handleMessage.bind(this));
        this.discord.on('ready', this.handleReady.bind(this));
        this.discord.on('guildCreate', this.handleGuildCreate.bind(this));
        this.discord.on('guildDelete', this.handleGuildDelete.bind(this));
        console.log("Initialized FCBot!");
        this.discord.login(process.env.BOT_TOKEN);
    }

    private getGuildWorker(guild: Discord.Guild): GuildWorker | undefined {
        return this.workers[guild.id];
    }

    reportChannels(toChannel: Discord.TextChannel, worker: GuildWorker) {
        const channelNamesList = worker.getChannelNamesList();
        if (channelNamesList.length == 0) {
            this.send(toChannel, "No update channel is set.");
        }
        else {
            this.send(toChannel, `Updates will be sent to ${channelNamesList.join(', ')}`)
        }
    }

    async handleMessage(message: Discord.Message) {
        if (message.channel.type != "text")
            return;
        const channel: Discord.TextChannel = <Discord.TextChannel>message.channel;
        const guild = channel.guild;

        if(!guild || message.author.bot) return;


        const originator = message.member;

        var isAdmin = false;
        if (originator) {
            // any of these perms counts as bot admin.
            isAdmin = originator.hasPermission('ADMINISTRATOR')
                      || originator.hasPermission('MANAGE_GUILD') 
                      || originator.hasPermission('MANAGE_CHANNELS');
        }
        else {
            console.log("message.member was null");
        }

        const args = message.content.split(/\s+/g);
        if (!args)
            return; // empty message?
        const command = args.shift().toLowerCase();
        
        if(!command.startsWith("!fc")) return;

        const worker = this.getGuildWorker(guild);

        if (!worker) {
            console.log("Received possible command but no worker for guild", guild.name, guild.id);
            return;
        }

        FCBot.logRecv(message);

        if (isAdmin)
            this.doAdminCommand(channel, command, args, worker);
        this.doEveryoneCommand(channel, command, args, worker);
    }

    static logSend(channel:Discord.TextChannel, s: string) {
        console.log(`"${channel.guild.name}"/#${channel.name}@FCBot:`, s);
    }

    static logRecv(message: Discord.Message) {
        console.log(`"${message.guild.name}"/#${(<Discord.TextChannel>message.channel).name}@${message.author.tag}:`, message.content);
    }

    send(channel: Discord.TextChannel, s: string) {
        FCBot.logSend(channel, s);
        channel.send(s);
    }

    async doAdminCommand(channel: Discord.TextChannel, command: string, args: string[], worker: GuildWorker) {
        switch (command) {
        case "!fcstop":
            worker.stopSchedule();
            this.send(channel, "Stopping updates.");
            break;

        case "!fcstatus":
            if (worker.running) {
                this.send(channel, "Updates are running for this server.")
            } else {
                this.send(channel, "Updates are not running for this server.")
            }
            this.reportChannels(channel, worker);
            break;

        case "!fcstart":
            const channelNamesList = worker.getChannelNamesList();
            if (channelNamesList.length == 0) {
                this.send(channel, "No update channel is set. Use !fcadd <channelname>. (No # in the channel name)");
                return;
            }

            if (!worker.hasLeague()) {
                this.send(channel, "Please register your league first. Use !fclogin for private leagues* or !fcleague for public leagues.");
                this.send(channel, "(* note - !fclogin requires you to put your password in the channel so you may want to do it in a private channel and/or delete your message after you do it. (Sorry, this will be changed someday.)");
                return;
            }
            
            try {
                await worker.startSchedule();
                this.send(channel, "Updates active.")
                this.reportChannels(channel, worker);
            }
            catch (err) {
                this.send(channel, "Error starting updates: " + err.message);
            }
            break;

        case "!fcadd":
            if (args.length != 1) {
                this.send(channel, "Use !fcadd <channel name>");
            }
            var channelName = args[0];
            if (channelName[0] == "#") {
                channelName = channelName.substring(1);
            }
            var foundChannel = <Discord.TextChannel>channel.guild.channels.cache.find(
                c => c.name == channelName && c.type == "text"
            );
            if (!foundChannel) {
                this.send(channel, `I couldn't find a channel matching "${channelName}".`);
            } else {
                worker.addChannel(foundChannel);
            }
            this.reportChannels(channel, worker);
            break;

        case "!fcremove":
            if (args.length != 1) {
                this.send(channel, "Use !fcremove <channel name>");
            }
            var channelName = args[0];
            if (channelName[0] == "#") {
                channelName = channelName.substring(1);
            }
            var foundChannel = <Discord.TextChannel>channel.guild.channels.cache.find(c => c.name == channelName && c.type == "text");
            if (!foundChannel) {
                this.send(channel, `I couldn't find a channel matching "${channelName}".`);
            } else {
                worker.removeChannel(foundChannel);
            }
            this.reportChannels(channel, worker);
            break;

        case "!fcleague": 
            if (args.length != 2) {
                this.send(channel, "Usage: !fcleague <leagueId> <leagueYear>");
                this.send(channel, "Your league ID is in the url for the league page - https://www.fantasycritic.games/league/YOUR-LEAGUE-ID-HERE/YEAR")
                return;
            }
            worker.setLeague(args[0], Number(args[1]));
            this.send(channel, "Now tracking league " + args[0] + " for league year " + args[1] + ".");
            break;

        case "!fcyear": 
            if (!worker.hasLeague()) {
                this.send(channel, "I am not currently tracking a league, so you can't switch the league year with !fcyear.");
                return;
            }
            if (args.length == 0) {
                this.send(channel, "The current league year is " + worker.getLeague().year)
                return;
            }
            if (args.length != 1) {
                this.send(channel, "Usage: !fcyear <leagueYear>");
                return;
            }
            var oldLeague = worker.getLeague();
            worker.setLeague(oldLeague.id, Number(args[0]));
            this.send(channel, "Now tracking league " + oldLeague.id + " for league year " + args[0] + ".");
            break;

        case "!fclogin":
            if (args.length != 4) {
                this.send(channel, "Usage: !fclogin <email> <password> <leagueId> <year>");
                return;
            }

            await worker.doFCLogin(args[0], args[1]);
            worker.setLeague(args[2], Number(args[3]));
            this.send(channel, "Now tracking league " + args[2] + " for league year " + args[3] + ".");
            break;

        case "!fcadminhelp":
            this.send(channel, "Commands: !fcstop, !fcstatus, !fcstart, !fcadd, !fcremove, !fclogin, !fcleague, !fcyear. Type them for more help.");
            break;
        }
    }

    async doEveryoneCommand(channel: Discord.TextChannel, command: string, args: string[], worker: GuildWorker) {
        switch (command) {
        case "!fcscore":
            try {
                await worker.doScoreReport(channel);
            }
            catch (err) {
                this.send(channel, "Error: " + err.message);
            }
            break;

        case "!fcup":
            try {
                await worker.doUpcoming(channel);
            }
            catch (err) {
                this.send(channel, "Error: " + err.message);
            }
            break;

        case "!fcpub":
            if (args.length == 0) {
                this.send(channel, "Usage: !fcpub <publisher name (or part of it)>");
                return;
            }
            try {
                await worker.doPublisherReport(channel, args.join(" "));
            }
            catch (err) {
                this.send(channel, "Error: " + err.message);
            }
            break;
    
        case "!fccheck":
            if (args.length == 0) {
                this.send(channel, "Usage: !fccheck <game name to search>");
                return;
            }
            if (!worker.hasLeague()) {
                this.send(channel, "A league must be set before using !fccheck, so I know what year to look at.");
                return;
            }

            try {
                await worker.checkOne(channel, args.join(" "));
            }
            catch (err) {
                this.send(channel, "Error: " + err.message);
            }
            break;

        case "!fchelp":
            this.send(channel, "Commands: !fccheck <game name to search>, !fcpub <publisher name>, !fcscore, !fcup. Also see !fcadminhelp");
            break;
        }
    }

    handleReady() {
        console.log(`Logged in as ${this.discord.user.tag}`);
        var myGuilds: Discord.Collection<string, Discord.Guild>;
        if (process.env.LIMIT_TO_GUILD_ID) {
            myGuilds = this.discord.guilds.cache.filter( (value, key) => key == process.env.LIMIT_TO_GUILD_ID);
        } else {
            myGuilds = this.discord.guilds.cache;
        }
        myGuilds.forEach(g => this.initializeGuild(g));
    }

    handleGuildCreate(guild: Discord.Guild) {
        if (this.workers[guild.id]) {
            console.log(`ERROR: ${guild.id} already in workers set - not creating a new one`);
            return;
        }
        console.log(`Added to guild "${guild.name}" (${guild.id})`);
        this.initializeGuild(guild);
    }

    handleGuildDelete(guild: Discord.Guild) {
        console.log(`Removed from guild "${guild.name}" (${guild.id})`);
        this.workers[guild.id].stopSchedule();
        delete this.workers[guild.id];
    }

    initializeGuild(guild: Discord.Guild) {
        const worker = new GuildWorker(guild, this.memcache, this.mongo);
        console.log(`New worker created for "${guild.name}" (${guild.id})`)
        this.workers[guild.id] = worker;
    }
}
