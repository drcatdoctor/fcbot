# fcbot

Hello and welcome to fcbot!

I didn't know if this would work out or not so there's not much documentation.

fcbot is a bot for https://www.fantasycritic.games/ that will show you:
* Any changes to master games (new release dates, new games added, new critic scores)
* Publisher actions in your league (bid won, game dropped, etc)
* New scores in your league ("Blahblah Co is now in 2nd!" etc)
* A leaderboard ("!fcscore")

See below on how to use it.

## Table of contents
- Using fcbot
  - [Setup without league updates](#setup-without-league-updates)
  - [Setup with a public league](#setup-with-a-public-league)
  - [Setup with a private league](#setup-with-a-public-league)
- Commands
  - [For everyone](#for-everyone)
  - [Admin-only](#admin-only)
- [FAQ](#faq)

## Using fcbot

You can add fcbot to your Discord, if you're an admin, by going to

https://discord.com/api/oauth2/authorize?client_id=671814513967890459&permissions=2048&scope=bot


Then, you'll have to set it up.

### Setup without league updates

In ANY channel in your server that Fantasy Critic Bot is in:
```
    !fcadd <name of a channel you want updates to go to>
    !fcstart
```
Example:
```
    !fcadd fantasy-critic
    !fcstart
```

That's it!

You can !fcadd multiple channels if you want.

### Setup with a public league

In ANY channel in your server that Fantasy Critic Bot is in:
```
    !fcadd <name of a channel you want updates to go to>
    !fcleague <league ID> <league year>
    !fcstart
```

Example:
```
    !fcadd fantasy-critic
    !fcleague abb1234f-44c0-2c7d-9901-80aa314d26f6 2021
    !fcstart
```

You can find your league ID (and year) in the URL of your league's page. 
https://www.fantasycritic.games/league/YOUR-LEAGUE-ID-HERE/YEAR

### Setup with a private league

In ANY channel in your server that Fantasy Critic Bot is in:
```
    !fcadd <name of a channel you want updates to go to>
    !fclogin <login email> <password> <league ID> <league year>
    !fcstart
```

Example:
```
    !fcadd fantasy-critic
    !fclogin supergreg@gmail.com s3cr3tpa55w0rd abb1234f-44c0-2c7d-9901-80aa314d26f6 2021
    !fcstart
```

Yes, typing your password into discord is a bad, stupid idea. 
You can do it in a private channel, you can delete the message after you 
send it. Sorry. This bot was just for me at first. Hopefully this will improve
soon. It should be in a PM or something.

You can find your league ID (and year) in the URL of your league's page. 
https://www.fantasycritic.games/league/YOUR-LEAGUE-ID-HERE/YEAR

## Command list

### For everyone

 * `!fcscore`: Show a leaderboard for your league.
 * `!fccheck <search string>`: searches for a game and tells you about it. (Score, classification, release date, etc.)
 * `!fchelp`: Show available commands.

### Admin-only

 * `!fcadd <channel name>`: Add a channel that should receive updates from fcbot.
 * `!fcremove <channel name>`: Remove a channel from receiving updates.
 * `!fcleague <league ID> <league year>`: Set this fcbot to monitor the given public league.
 * `!fclogin <email> <password> <league ID> <league year>`: Set this fcbot to monitor the given private league.
 * `!fcstart`: Begin posting updates to added channels.
 * `!fcstop`: Stop posting any updates.
 * `!fcstatus`: List added channels, whether updates are active, etc.
 * `!fcadminhelp`: Show admin commands.
 * `!fcyear <league year>`: Switch the bot to track the same league, but with a different year. Happy New Year!

## FAQ

### Why does it sometimes report news twice?

It's an intermittent bug, it will go away. I will fix it some day. I think it's something to do with memcache.


### It's broken aahhh

I'm on discord as DrCat#2160, send me a PM and I will try to help.
