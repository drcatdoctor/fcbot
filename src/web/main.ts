import express = require ('express');
import path = require ('path');
import { Client as OICClient, Issuer } from 'openid-client';
import request = require('request');
import { Client as FCClient } from '../fc/Client';

export class FCApp {

    discordIssuer: Issuer<OICClient>;
    fcIssuer: Issuer<OICClient>;
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

        this.discordIssuer = new Issuer({
            issuer: 'Discord',
            authorization_endpoint: 'https://discord.com/api/oauth2/authorize',
            token_endpoint: 'https://discord.com/api/oauth2/token',
            revocation_endpoint: 'https://discord.com/api/oauth2/token/revoke'
        });

        this.fcIssuer = await Issuer.discover(this.fc.SITE_URL);
    }

    handleDiscordAuthCallback(req: express.Request, res: express.Response) {
        var code = req.query['code'];
        var guild_id = req.query['guild_id'];


    }
}