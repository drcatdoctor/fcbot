// leave constants at the top, because it reads environment vars from dotenv
import { FCConstants } from '../common/FCConstants';

import express = require ('express');
import path = require ('path');
import { Client as OICClient, Issuer } from 'openid-client';
import rp = require('request-promise');
import { Client as FCClient } from '../fc/Client';
export class FCApp {

    discordAuthClient: OICClient;
    fcAuthClient: OICClient;
    app: express.Express;
    fc: FCClient;

    constructor() {
        this.app = express();
        this.fc = new FCClient();
                
        this.setup().then( () => {
            const port = process.env.PORT || 5000;
            this.app.listen(port, () => console.log(`FCApp listening on ${port}`));
        } ).catch( (e) => {
            console.error(e);
            process.exit(1);
        });
    }

    async setup() {
        this.app.use(express.static(path.join(__dirname, '../../web/static')))
        this.app.set('view engine', 'ejs');
        this.app.set('views', path.join(__dirname, '../../web/views'))
        this.app.get('/', (req, res) => res.render('pages/index'))
        this.app.get('/auth/discord', this.handleDiscordAuthCallback.bind(this));

        const discordIssuer = new Issuer({
            issuer: 'Discord',
            authorization_endpoint: 'https://discord.com/api/oauth2/authorize',
            token_endpoint: 'https://discord.com/api/oauth2/token',
            revocation_endpoint: 'https://discord.com/api/oauth2/token/revoke'
        });

        var fcIssuer: Issuer<OICClient>;
        try {
            fcIssuer = await Issuer.discover(this.fc.SITE_URL);
        }
        catch (e) {
            // don't do anything for now -- beta
            console.error(e);
        }

        // setup imports for inside templates
        this.app.locals.FCConstants = FCConstants;

        // make oauth clients
        this.discordAuthClient = new discordIssuer.Client({
            client_id: process.env.DISCORD_CLIENT_ID,
            client_secret: process.env.DISCORD_CLIENT_SECRET
        });
        if (fcIssuer) {
            this.fcAuthClient = new fcIssuer.Client({
                client_id: process.env.FC_CLIENT_ID,
                client_secret: process.env.FC_CLIENT_SECRET
            });
        }
    }

    handleDiscordAuthCallback(req: express.Request, res: express.Response) {
        const code = req.query['code'];
        const guild_id = req.query['guild_id'];

        const promiseOfTokenSet = this.discordAuthClient.grant({
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: FCConstants.MY_RECEIVE_CODE_FROM_DISCORD_URI
        });

        res.send(`OK. (got ${code}, ${guild_id}).`);
        res.end();
    }
}