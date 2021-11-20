
const dotEnvResult = require('dotenv').config()
if (dotEnvResult.error) {
    throw dotEnvResult.error;
}
console.log(dotEnvResult.parsed);

export class FCConstants {
    // Send Messages + Embed Links
    public static readonly DISCORD_PERMISSIONS: string = "18432";
    public static readonly DISCORD_SCOPES: string = ["bot", "identify"].join(" ")
    public static readonly MY_RECEIVE_CODE_FROM_DISCORD_URI = "http://localhost:5000/auth/discord"

    public static readonly ADD_BOT_URL = 
        `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}` + 
        `&response_type=code` +
        `&permissions=${FCConstants.DISCORD_PERMISSIONS}` +
        `&scope=${FCConstants.DISCORD_SCOPES}` + 
        `&redirect_uri=${encodeURIComponent(FCConstants.MY_RECEIVE_CODE_FROM_DISCORD_URI)}`;
    
}
